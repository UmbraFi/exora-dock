package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/exora-dock/exora-dock/internal/runcapability"
	"github.com/exora-dock/exora-dock/internal/supervisor"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) ListLocalAgents(w http.ResponseWriter, r *http.Request) {
	h.scanLocalAgents(w, r)
}

func (h *Handler) ScanLocalAgents(w http.ResponseWriter, r *http.Request) {
	h.scanLocalAgents(w, r)
}

func (h *Handler) scanLocalAgents(w http.ResponseWriter, r *http.Request) {
	configured := h.codexAgent
	if configured.ID == "" {
		configured.ID = "codex"
	}
	if configured.Kind == "" {
		configured.Kind = "codex"
	}
	if configured.MaxConcurrency <= 0 {
		configured.MaxConcurrency = 1
	}
	entry := mapFromJSON(configured)
	if h.codexProbe == nil {
		entry["installed"] = false
		entry["authenticated"] = false
		entry["protocol"] = "app-server-jsonl"
		entry["error"] = "Codex driver is not configured"
		writeJSON(w, http.StatusOK, map[string]any{"localAgents": []any{entry}})
		return
	}
	report, err := h.codexProbe(r.Context())
	if err != nil {
		report.Error = err.Error()
	}
	for key, value := range mapFromJSON(report) {
		entry[key] = value
	}
	writeJSON(w, http.StatusOK, map[string]any{"localAgents": []any{entry}})
}

func (h *Handler) CreateAutomationRun(w http.ResponseWriter, r *http.Request) {
	var req supervisor.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	run, duplicate, err := h.automationRuns.Create(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"automationRun": run, "duplicate": duplicate})
}

func (h *Handler) ListAutomationRuns(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"automationRuns": h.automationRuns.List(r.URL.Query().Get("transactionId"))})
}

func (h *Handler) GetAutomationRun(w http.ResponseWriter, r *http.Request) {
	run, ok := h.automationRuns.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "automation run not found"})
		return
	}
	if !h.authorizeRunCapability(w, r, run, "get_transaction_state") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"automationRun": run})
}

func (h *Handler) ClaimAutomationRun(w http.ResponseWriter, r *http.Request) {
	run, ok := h.automationRuns.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "automation run not found"})
		return
	}
	if !h.authorizeRunCapability(w, r, run, "claim_run") {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"automationRun": run,
		"claim":         map[string]any{"runId": run.RunID, "transactionId": run.TransactionID, "role": run.Role, "expectedStateVersion": run.ExpectedStateVersion},
	})
}

func (h *Handler) RecordAutomationAction(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "id")
	run, ok := h.automationRuns.Get(runID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "automation run not found"})
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	var fields map[string]json.RawMessage
	var req supervisor.ActionRequest
	if json.Unmarshal(data, &fields) != nil || json.Unmarshal(data, &req) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if _, ok := fields["expectedStateVersion"]; !ok || strings.TrimSpace(req.Type) == "" || strings.TrimSpace(req.IdempotencyKey) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "type, expectedStateVersion and idempotencyKey are required"})
		return
	}
	if req.Type == "propose_transition" {
		if req.Payload == nil {
			req.Payload = map[string]any{}
		}
		target, _ := req.Payload["targetPhase"].(string)
		if strings.TrimSpace(target) == "" {
			for _, alias := range []string{"toPhase", "phase"} {
				if value, _ := req.Payload[alias].(string); strings.TrimSpace(value) != "" {
					target = value
					break
				}
			}
		}
		if strings.TrimSpace(target) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "propose_transition payload.targetPhase is required"})
			return
		}
		req.Payload["targetPhase"] = strings.TrimSpace(target)
	}
	if !h.authorizeRunCapability(w, r, run, req.Type) {
		return
	}
	req.Role = run.Role
	updated, duplicate, err := h.automationRuns.RecordAction(runID, req)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, supervisor.ErrVersionConflict) || errors.Is(err, supervisor.ErrIdempotencyConflict) || errors.Is(err, supervisor.ErrRunNotActive) || errors.Is(err, supervisor.ErrTerminalRun) {
			status = http.StatusConflict
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	if req.Type == "finish_run" {
		writeJSON(w, http.StatusOK, map[string]any{"automationRun": updated, "duplicate": duplicate})
		return
	}
	nextStateVersion, err := h.forwardAgentEvent(r, updated, req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "automationRun": updated, "duplicate": duplicate})
		return
	}
	advanced, err := h.automationRuns.AdvanceExpectedStateVersion(runID, req.ExpectedStateVersion, nextStateVersion)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "automationRun": updated, "duplicate": duplicate})
		return
	}
	updated = advanced
	writeJSON(w, http.StatusOK, map[string]any{"automationRun": updated, "duplicate": duplicate})
}

func (h *Handler) CancelAutomationRun(w http.ResponseWriter, r *http.Request) {
	if runcapability.IsToken(requestBearer(r)) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "owner authorization required"})
		return
	}
	runID := chi.URLParam(r, "id")
	if h.supervisor != nil {
		if err := h.supervisor.Interrupt(r.Context(), runID); err == nil {
			run, _ := h.automationRuns.Get(runID)
			writeJSON(w, http.StatusOK, map[string]any{"automationRun": run})
			return
		}
	}
	run, err := h.automationRuns.Finish(runID, "", 0, supervisor.RunCancelled, "cancelled by owner")
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"automationRun": run})
}

func (h *Handler) GetAutomationTransaction(w http.ResponseWriter, r *http.Request) {
	transactionID := strings.TrimSpace(chi.URLParam(r, "id"))
	if !h.authorizeTransactionCapability(w, r, transactionID, "get_transaction_state") {
		return
	}
	h.proxyCloudTransaction(w, r, transactionID, false)
}

func (h *Handler) GetAutomationAllowedActions(w http.ResponseWriter, r *http.Request) {
	transactionID := strings.TrimSpace(chi.URLParam(r, "id"))
	if !h.authorizeTransactionCapability(w, r, transactionID, "get_allowed_actions") {
		return
	}
	h.proxyCloudTransaction(w, r, transactionID, true)
}

func (h *Handler) SearchAutomationAgentCards(w http.ResponseWriter, r *http.Request) {
	if !h.authorizeFreeCapability(w, r, "search_agent_cards") {
		return
	}
	role := strings.TrimSpace(r.URL.Query().Get("role"))
	if role == "" {
		role = "seller"
	}
	query := firstNonEmpty(r.URL.Query().Get("q"), r.URL.Query().Get("query"))
	values := url.Values{}
	values.Set("role", role)
	if query != "" {
		values.Set("query", query)
	}
	status, payload, err := h.cloudV2Request(r, http.MethodGet, "/v2/agent-cards?"+values.Encode(), nil)
	if err == nil && status >= 200 && status < 300 {
		writeCloudPayload(w, status, payload)
		return
	}
	if err == nil {
		writeCloudPayload(w, status, payload)
		return
	}
	// Local cards remain useful while the Dock is offline, but a configured
	// Cloud error is surfaced rather than silently changing protocol state.
	if strings.TrimSpace(h.cloudURL) != "" && err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, h.searchAgentCards(r.Context(), role, query))
}

func (h *Handler) authorizeRunCapability(w http.ResponseWriter, r *http.Request, run supervisor.AutomationRun, action string) bool {
	token := requestBearer(r)
	if !runcapability.IsToken(token) {
		return true // auth middleware already required the local owner token.
	}
	if h.runCapabilities == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "run capability service unavailable"})
		return false
	}
	claims, err := h.runCapabilities.Verify(token, runcapability.Requirement{
		RunID: run.RunID, TransactionID: run.TransactionID, Role: run.Role, Action: strings.ToLower(strings.TrimSpace(action)), Workspace: run.Workspace, LeaseEpoch: run.Lease.Epoch,
	})
	if err == nil {
		err = h.verifyActiveRunClaims(claims)
	}
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
		return false
	}
	return true
}

func (h *Handler) authorizeTransactionCapability(w http.ResponseWriter, r *http.Request, transactionID, action string) bool {
	token := requestBearer(r)
	if !runcapability.IsToken(token) {
		return true
	}
	if h.runCapabilities == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "run capability service unavailable"})
		return false
	}
	claims, err := h.runCapabilities.Verify(token, runcapability.Requirement{TransactionID: transactionID, Action: action})
	if err == nil {
		err = h.verifyActiveRunClaims(claims)
	}
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
		return false
	}
	return true
}

func (h *Handler) authorizeFreeCapability(w http.ResponseWriter, r *http.Request, action string) bool {
	token := requestBearer(r)
	if !runcapability.IsToken(token) {
		return true
	}
	if h.runCapabilities == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "run capability service unavailable"})
		return false
	}
	claims, err := h.runCapabilities.Verify(token, runcapability.Requirement{Action: action})
	if err == nil {
		err = h.verifyActiveRunClaims(claims)
	}
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
		return false
	}
	return true
}

func (h *Handler) verifyActiveRunClaims(claims runcapability.Claims) error {
	if h.automationRuns == nil {
		return runcapability.ErrForbidden
	}
	run, ok := h.automationRuns.Get(claims.RunID)
	if !ok || run.TransactionID != claims.TransactionID || run.Role != claims.Role {
		return runcapability.ErrForbidden
	}
	if claims.LeaseEpoch > 0 && run.Lease.Epoch != claims.LeaseEpoch {
		return runcapability.ErrForbidden
	}
	switch run.Status {
	case supervisor.RunCompleted, supervisor.RunFailed, supervisor.RunCancelled:
		return runcapability.ErrForbidden
	default:
		return nil
	}
}

func (h *Handler) proxyCloudTransaction(w http.ResponseWriter, r *http.Request, transactionID string, actionsOnly bool) {
	if transactionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "transaction id required"})
		return
	}
	path := "/v2/transactions/" + url.PathEscape(transactionID)
	status, payload, err := h.cloudV2Request(r, http.MethodGet, path, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	if status < 200 || status >= 300 {
		writeCloudPayload(w, status, payload)
		return
	}
	if !actionsOnly {
		writeCloudPayload(w, http.StatusOK, payload)
		return
	}
	var state map[string]any
	if json.Unmarshal(payload, &state) != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Cloud returned invalid transaction state"})
		return
	}
	projection := state
	if nested, ok := state["transaction"].(map[string]any); ok {
		projection = nested
	}
	writeJSON(w, http.StatusOK, redactCloudValue(map[string]any{
		"transactionId": transactionID, "version": projection["version"], "allowedActions": projection["allowedActions"],
	}))
}

func (h *Handler) forwardAgentEvent(r *http.Request, run supervisor.AutomationRun, action supervisor.ActionRequest) (int64, error) {
	if strings.TrimSpace(h.cloudURL) == "" {
		if _, err := cloudlink.LoadToken(h.cloudTokenPath); err != nil {
			// Local/manual mode has no authoritative Cloud projection to advance.
			return action.ExpectedStateVersion, nil
		}
	}
	status, payload, err := h.cloudV2Request(r, http.MethodPost, "/v2/transactions/"+url.PathEscape(run.TransactionID)+"/agent-events", map[string]any{
		"runId": run.RunID, "role": run.Role, "type": action.Type,
		"expectedStateVersion": action.ExpectedStateVersion, "idempotencyKey": action.IdempotencyKey,
		"payload": redactCloudValue(action.Payload),
	})
	if err != nil {
		return 0, err
	}
	if status < 200 || status >= 300 {
		return 0, fmt.Errorf("Cloud agent event returned %d: %s", status, strings.TrimSpace(string(payload)))
	}
	var result struct {
		Transaction struct {
			Version *int64 `json:"version"`
		} `json:"transaction"`
	}
	if err := json.Unmarshal(payload, &result); err != nil || result.Transaction.Version == nil {
		return 0, fmt.Errorf("Cloud agent event returned an invalid transaction projection")
	}
	if *result.Transaction.Version <= action.ExpectedStateVersion {
		return 0, fmt.Errorf("Cloud agent event did not advance transaction version")
	}
	return *result.Transaction.Version, nil
}

func (h *Handler) cloudV2Request(r *http.Request, method, path string, body any) (int, []byte, error) {
	token, err := cloudlink.LoadToken(h.cloudTokenPath)
	if err != nil {
		return 0, nil, fmt.Errorf("Dock cloud token unavailable: %w", err)
	}
	cloudURL := firstNonEmpty(strings.TrimSpace(h.cloudURL), strings.TrimSpace(token.CloudURL))
	if cloudURL == "" {
		return 0, nil, fmt.Errorf("Exora Cloud is not configured")
	}
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		reader = bytes.NewReader(data)
	}
	ctx, cancel := contextWithTimeout(r, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(cloudURL, "/")+path, reader)
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token.CloudToken))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return resp.StatusCode, payload, err
}

func requestBearer(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(header, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
}

func contextWithTimeout(r *http.Request, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), timeout)
}
