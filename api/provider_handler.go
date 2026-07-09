package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/market"
	"github.com/exora-dock/exora-dock/internal/orderplan"
	"github.com/exora-dock/exora-dock/internal/providerprotocol"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) CreateProviderQuoteRequest(w http.ResponseWriter, r *http.Request) {
	if h.resources == nil || h.executor == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provider docker service not configured"})
		return
	}
	var req providerprotocol.QuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := providerprotocol.ValidateTimestamp(req.Timestamp); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}
	payload, err := providerprotocol.QuoteRequestPayload(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := providerprotocol.Verify(req.RequesterPubkey, req.Signature, payload); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}
	reply := h.buildProviderQuoteReply(req)
	if reply.Status == "quoted" {
		if err := h.signQuoteReply(&reply); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
	}
	writeJSON(w, http.StatusOK, reply)
}

func (h *Handler) CreateProviderJob(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil || h.resources == nil || h.executor == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provider task executor not configured"})
		return
	}
	var req providerprotocol.JobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := providerprotocol.ValidateTimestamp(req.Timestamp); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}
	payload, err := providerprotocol.JobRequestPayload(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := providerprotocol.Verify(req.RequesterPubkey, req.Signature, payload); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}
	if strings.TrimSpace(req.PaymentID) != "" && !providerPaymentEvidenceFinalized(req.PaymentEvidence) {
		writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": "payment_evidence_required: paid provider jobs require found_finalized Cloud/chain evidence"})
		return
	}
	quote := h.buildProviderQuoteReply(providerprotocol.QuoteRequest{
		RequestID:       req.RequestID,
		RequesterPubkey: req.RequesterPubkey,
		AgentID:         req.AgentID,
		ProviderPubkey:  req.ProviderPubkey,
		ResourceID:      req.ResourceID,
		Draft:           req.Draft,
		Timestamp:       req.Timestamp,
	})
	if quote.Status != "quoted" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": firstNonEmpty(quote.Error, "provider rejected job")})
		return
	}
	created, err := h.tasks.Create(req.Draft.TaskCreateRequest())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	quoted, err := h.tasks.Quote(created.ID, task.QuoteRequest{
		ProviderPubkey:   req.ProviderPubkey,
		PriceAmount:      quote.PriceAmount,
		Currency:         firstNonEmpty(quote.Currency, "USDC"),
		EstimatedSeconds: quote.EstimatedSeconds,
		Notes:            quote.Notes,
		ExpiresAt:        quote.ExpiresAt,
	})
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	consented, err := h.tasks.Consent(quoted.ID, task.ConsentRequest{Approved: true, ApprovalRequestID: req.ApprovalID})
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	claimed, err := h.tasks.Claim(consented.ID, task.ClaimRequest{ProviderPubkey: req.ProviderPubkey})
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	go h.runProviderDockerJob(claimed.ID, req.ProviderPubkey)
	writeJSON(w, http.StatusAccepted, map[string]any{"job": providerprotocol.JobReply{
		JobID:          claimed.ID,
		TaskID:         claimed.ID,
		Status:         string(claimed.Status),
		ProviderPubkey: req.ProviderPubkey,
		NextAction:     "poll_provider_job",
	}, "task": claimed})
}

func (h *Handler) GetProviderJob(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	t, ok := h.tasks.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "provider job not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"job": providerprotocol.JobReply{
		JobID:          t.ID,
		TaskID:         t.ID,
		Status:         string(t.Status),
		ProviderPubkey: t.ProviderPubkey,
		NextAction:     providerJobNextAction(t.Status),
	}, "task": t})
}

func (h *Handler) GetProviderJobArtifactManifest(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	artifacts, ok := h.tasks.ArtifactManifest(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "provider job not found"})
		return
	}
	for i := range artifacts {
		artifacts[i].URL = "/v1/provider/jobs/" + url.PathEscape(chi.URLParam(r, "id")) + "/artifacts/" + url.PathEscape(artifacts[i].Name)
	}
	writeJSON(w, http.StatusOK, map[string]any{"artifacts": artifacts})
}

func (h *Handler) GetProviderJobArtifact(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	path, ok := h.tasks.ArtifactPath(chi.URLParam(r, "id"), chi.URLParam(r, "name"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "artifact not found"})
		return
	}
	http.ServeFile(w, r, path)
}

func (h *Handler) buildProviderQuoteReply(req providerprotocol.QuoteRequest) providerprotocol.QuoteReply {
	now := time.Now().UTC()
	reply := providerprotocol.QuoteReply{
		RequestID:      req.RequestID,
		Status:         "rejected",
		ProviderPubkey: req.ProviderPubkey,
		ResourceID:     req.ResourceID,
		Currency:       "USDC",
		Timestamp:      now.Format(time.RFC3339),
	}
	res, ok := h.resources.Get(req.ResourceID)
	if !ok {
		reply.Error = "resource unavailable"
		return reply
	}
	provider := firstNonEmpty(res.ProviderPubkey, res.Provider)
	if strings.TrimSpace(req.ProviderPubkey) != "" && provider != "" && req.ProviderPubkey != provider {
		reply.Error = "resource belongs to a different provider"
		return reply
	}
	if !strings.EqualFold(res.Availability, "available") {
		reply.Error = "resource unavailable"
		return reply
	}
	providerPubkey := firstNonEmpty(req.ProviderPubkey, provider, h.selfPubkey)
	temp := task.Task{
		ID:              "quote-" + req.RequestID,
		RequesterPubkey: req.RequesterPubkey,
		AgentID:         req.AgentID,
		Type:            req.Draft.Type,
		Goal:            req.Draft.Goal,
		Requirements:    req.Draft.Requirements,
		TimeoutSeconds:  req.Draft.TimeoutSeconds,
		ProviderPubkey:  providerPubkey,
	}
	spec, err := h.executor.ValidateDockerTask(temp, task.RunRequest{ProviderPubkey: providerPubkey, Runtime: "docker"})
	if err != nil {
		reply.Error = err.Error()
		return reply
	}
	estimated := req.Draft.TimeoutSeconds
	if estimated <= 0 {
		estimated = 60
	}
	reply.Status = "quoted"
	reply.ProviderPubkey = providerPubkey
	reply.PriceAmount = res.PricePerUnit
	reply.Currency = "USDC"
	reply.EstimatedSeconds = estimated
	reply.Notes = "Realtime Docker quote confirmed by provider."
	reply.ExpiresAt = now.Add(30 * time.Minute).Format(time.RFC3339)
	reply.Runtime = "docker"
	reply.Docker = spec
	return reply
}

func (h *Handler) signQuoteReply(reply *providerprotocol.QuoteReply) error {
	if h.wallets == nil {
		return fmt.Errorf("provider local wallet keypair required for signed quote response")
	}
	payload, err := providerprotocol.QuoteReplyPayload(*reply)
	if err != nil {
		return err
	}
	address, signature, err := h.wallets.SignPayload(payload)
	if err != nil {
		return err
	}
	if strings.TrimSpace(reply.ProviderPubkey) == "" {
		reply.ProviderPubkey = address
		payload, err = providerprotocol.QuoteReplyPayload(*reply)
		if err != nil {
			return err
		}
		_, signature, err = h.wallets.SignPayload(payload)
		if err != nil {
			return err
		}
	} else if reply.ProviderPubkey != address {
		return fmt.Errorf("provider pubkey must match local signing wallet")
	}
	reply.Signature = signature
	return nil
}

func (h *Handler) runProviderDockerJob(taskID, providerPubkey string) {
	t, ok := h.tasks.Get(taskID)
	if !ok {
		return
	}
	artifacts, err := h.executor.Run(context.Background(), t, task.RunRequest{ProviderPubkey: providerPubkey, Runtime: "docker"})
	if err != nil {
		_, _ = h.tasks.Fail(taskID, task.FailRequest{ProviderPubkey: providerPubkey, Error: err.Error()})
		return
	}
	_, _ = h.tasks.Complete(taskID, task.CompleteRequest{ProviderPubkey: providerPubkey, Artifacts: artifacts})
}

func providerJobNextAction(status task.Status) string {
	switch status {
	case task.StatusCompleted:
		return "fetch_artifact_manifest"
	case task.StatusFailed:
		return "inspect_failure"
	case task.StatusRunning, task.StatusClaimed:
		return "poll_provider_job"
	default:
		return "wait_for_provider_job"
	}
}

func (h *Handler) requestProviderQuote(r *http.Request, req market.SearchRequest, option market.OrderDraftOption) (providerprotocol.QuoteReply, error) {
	if h.wallets == nil {
		return providerprotocol.QuoteReply{}, fmt.Errorf("local wallet keypair required for signed provider quote request")
	}
	requestID := fmt.Sprintf("qreq-%d-%s", time.Now().UnixNano(), option.OptionID)
	quoteReq := providerprotocol.QuoteRequest{
		RequestID:       requestID,
		RequesterPubkey: option.Draft.RequesterPubkey,
		AgentID:         option.Draft.AgentID,
		ProviderPubkey:  option.ProviderPubkey,
		ResourceID:      option.ResourceID,
		Draft:           option.Draft,
		Timestamp:       time.Now().UTC().Format(time.RFC3339),
	}
	payload, err := providerprotocol.QuoteRequestPayload(quoteReq)
	if err != nil {
		return providerprotocol.QuoteReply{}, err
	}
	address, signature, err := h.wallets.SignPayload(payload)
	if err != nil {
		return providerprotocol.QuoteReply{}, err
	}
	if strings.TrimSpace(quoteReq.RequesterPubkey) == "" {
		quoteReq.RequesterPubkey = address
		quoteReq.Draft.RequesterPubkey = address
		payload, err = providerprotocol.QuoteRequestPayload(quoteReq)
		if err != nil {
			return providerprotocol.QuoteReply{}, err
		}
		_, signature, err = h.wallets.SignPayload(payload)
		if err != nil {
			return providerprotocol.QuoteReply{}, err
		}
	} else if quoteReq.RequesterPubkey != address {
		return providerprotocol.QuoteReply{}, fmt.Errorf("requester pubkey must match local signing wallet")
	}
	quoteReq.Signature = signature

	endpoint, err := providerEndpoint(option.ProviderEndpoint, "/v1/provider/quote-requests")
	if err != nil {
		return providerprotocol.QuoteReply{}, err
	}
	data, _ := json.Marshal(quoteReq)
	client := &http.Client{Timeout: 8 * time.Second}
	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return providerprotocol.QuoteReply{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(httpReq)
	if err != nil {
		return providerprotocol.QuoteReply{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return providerprotocol.QuoteReply{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return providerprotocol.QuoteReply{}, fmt.Errorf("provider quote returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var reply providerprotocol.QuoteReply
	if err := json.Unmarshal(body, &reply); err != nil {
		return providerprotocol.QuoteReply{}, err
	}
	if reply.Status != "quoted" {
		return reply, nil
	}
	if strings.TrimSpace(reply.Signature) == "" {
		return providerprotocol.QuoteReply{}, fmt.Errorf("provider quote response missing signature")
	}
	payload, err = providerprotocol.QuoteReplyPayload(reply)
	if err != nil {
		return providerprotocol.QuoteReply{}, err
	}
	if err := providerprotocol.Verify(reply.ProviderPubkey, reply.Signature, payload); err != nil {
		return providerprotocol.QuoteReply{}, err
	}
	return reply, nil
}

func (h *Handler) submitProviderJob(ctx context.Context, plan orderplan.Plan, option market.OrderDraftOption, localTask task.Task, a approval.Approval, paymentID string) (providerprotocol.JobReply, error) {
	if h.wallets == nil {
		return providerprotocol.JobReply{}, fmt.Errorf("local wallet keypair required for signed provider job request")
	}
	req := providerprotocol.JobRequest{
		RequestID:       fmt.Sprintf("jobreq-%d-%s", time.Now().UnixNano(), option.OptionID),
		RequesterPubkey: localTask.RequesterPubkey,
		AgentID:         localTask.AgentID,
		ProviderPubkey:  option.ProviderPubkey,
		ResourceID:      option.ResourceID,
		Draft:           option.Draft,
		QuoteID:         option.QuoteID,
		ApprovalID:      a.ID,
		PaymentID:       paymentID,
		Timestamp:       time.Now().UTC().Format(time.RFC3339),
	}
	if paymentID != "" && h.payments != nil {
		if record, ok := h.payments.Get(paymentID); ok {
			req.PaymentEvidence = providerPaymentEvidenceFromRecord(record)
			if req.PaymentEvidence == nil {
				return providerprotocol.JobReply{}, fmt.Errorf("payment_evidence_required: call find_payment_evidence/sync_payment_evidence until found_finalized before submitting paid provider jobs")
			}
		}
	}
	payload, err := providerprotocol.JobRequestPayload(req)
	if err != nil {
		return providerprotocol.JobReply{}, err
	}
	address, signature, err := h.wallets.SignPayload(payload)
	if err != nil {
		return providerprotocol.JobReply{}, err
	}
	if req.RequesterPubkey != address {
		return providerprotocol.JobReply{}, fmt.Errorf("task requester pubkey must match local signing wallet")
	}
	req.Signature = signature
	endpoint, err := providerEndpoint(option.ProviderEndpoint, "/v1/provider/jobs")
	if err != nil {
		return providerprotocol.JobReply{}, err
	}
	data, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return providerprotocol.JobReply{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return providerprotocol.JobReply{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return providerprotocol.JobReply{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return providerprotocol.JobReply{}, fmt.Errorf("provider job returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var wrapped struct {
		Job providerprotocol.JobReply `json:"job"`
	}
	if err := json.Unmarshal(body, &wrapped); err != nil {
		return providerprotocol.JobReply{}, err
	}
	if strings.TrimSpace(wrapped.Job.JobID) == "" {
		return providerprotocol.JobReply{}, fmt.Errorf("provider job response missing jobId")
	}
	_ = plan
	return wrapped.Job, nil
}

func (h *Handler) watchProviderJob(planID, localTaskID, endpoint, jobID, providerPubkey string) {
	client := &http.Client{Timeout: 8 * time.Second}
	for i := 0; i < 120; i++ {
		time.Sleep(500 * time.Millisecond)
		status, err := fetchProviderJob(client, endpoint, jobID)
		if err != nil {
			continue
		}
		if status.Status == string(task.StatusCompleted) {
			artifacts := h.fetchProviderArtifacts(client, endpoint, jobID)
			_, _ = h.tasks.Complete(localTaskID, task.CompleteRequest{ProviderPubkey: providerPubkey, Artifacts: artifacts})
			if h.orderPlans != nil {
				if plan, ok := h.orderPlans.Get(planID); ok {
					_, _ = h.orderPlans.AddEvent(plan, "completed", "Provider Docker job completed.", "")
				}
			}
			return
		}
		if status.Status == string(task.StatusFailed) {
			_, _ = h.tasks.Fail(localTaskID, task.FailRequest{ProviderPubkey: providerPubkey, Error: "provider Docker job failed"})
			if h.orderPlans != nil {
				if plan, ok := h.orderPlans.Get(planID); ok {
					_, _ = h.orderPlans.AddEvent(plan, "failed", "Provider Docker job failed.", "")
				}
			}
			return
		}
	}
	if h.orderPlans != nil {
		if plan, ok := h.orderPlans.Get(planID); ok {
			_, _ = h.orderPlans.AddEvent(plan, "provider_job_poll_timeout", "Provider job is still running or unreachable.", "")
		}
	}
}

func fetchProviderJob(client *http.Client, endpoint, jobID string) (providerprotocol.JobReply, error) {
	url, err := providerEndpoint(endpoint, "/v1/provider/jobs/"+url.PathEscape(jobID))
	if err != nil {
		return providerprotocol.JobReply{}, err
	}
	resp, err := client.Get(url)
	if err != nil {
		return providerprotocol.JobReply{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return providerprotocol.JobReply{}, fmt.Errorf("provider job status %s", resp.Status)
	}
	var wrapped struct {
		Job providerprotocol.JobReply `json:"job"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&wrapped); err != nil {
		return providerprotocol.JobReply{}, err
	}
	return wrapped.Job, nil
}

func (h *Handler) fetchProviderArtifacts(client *http.Client, endpoint, jobID string) []task.ArtifactInput {
	manifestURL, err := providerEndpoint(endpoint, "/v1/provider/jobs/"+url.PathEscape(jobID)+"/artifacts")
	if err != nil {
		return nil
	}
	resp, err := client.Get(manifestURL)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil
	}
	var wrapped struct {
		Artifacts []task.Artifact `json:"artifacts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&wrapped); err != nil {
		return nil
	}
	out := make([]task.ArtifactInput, 0, len(wrapped.Artifacts))
	for _, artifact := range wrapped.Artifacts {
		artifactURL := strings.TrimSpace(artifact.URL)
		if artifactURL == "" {
			continue
		}
		if strings.HasPrefix(artifactURL, "/") {
			artifactURL, err = providerEndpoint(endpoint, artifactURL)
			if err != nil {
				continue
			}
		}
		itemResp, err := client.Get(artifactURL)
		if err != nil {
			continue
		}
		data, readErr := io.ReadAll(itemResp.Body)
		_ = itemResp.Body.Close()
		if readErr != nil || itemResp.StatusCode < 200 || itemResp.StatusCode >= 300 {
			continue
		}
		out = append(out, task.ArtifactInput{
			Name:        artifact.Name,
			Content:     base64.StdEncoding.EncodeToString(data),
			Encoding:    "base64",
			ContentType: artifact.ContentType,
		})
	}
	return out
}

func providerEndpoint(base, path string) (string, error) {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return "", fmt.Errorf("provider endpoint required")
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("provider endpoint must be absolute")
	}
	if strings.HasSuffix(parsed.Path, "/v1") {
		parsed.Path = strings.TrimSuffix(parsed.Path, "/v1")
	}
	rel := strings.TrimLeft(path, "/")
	joined, err := parsed.Parse(rel)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(path, "/") {
		joined.Path = strings.TrimRight(parsed.Path, "/") + path
	}
	return joined.String(), nil
}
