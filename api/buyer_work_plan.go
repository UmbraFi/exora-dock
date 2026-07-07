package api

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"net/http"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/agentcard"
	"github.com/exora-dock/exora-dock/internal/negotiation"
)

type BuyerIntentClassification struct {
	SchemaVersion      string   `json:"schema_version"`
	Mode               string   `json:"mode"`
	Reason             string   `json:"reason,omitempty"`
	Confidence         float64  `json:"confidence,omitempty"`
	ClarifyingQuestion string   `json:"clarifying_question,omitempty"`
	Signals            []string `json:"signals,omitempty"`
}

func classifyBuyerIntent(req coordinateBuyerWorkRequest, intent string) BuyerIntentClassification {
	text := strings.ToLower(strings.TrimSpace(intent + " " + buyerMustJSON(req.Constraints) + " " + buyerMustJSON(req.TaskTemplate.Requirements)))
	signals := []string{}
	addSignal := func(signal string) {
		if !containsString(signals, signal) {
			signals = append(signals, signal)
		}
	}
	for _, marker := range []string{"manual_plan", "manifest", "计划", "plan first", "plan-first"} {
		if strings.Contains(text, marker) {
			addSignal("explicit_plan_request")
			return BuyerIntentClassification{
				SchemaVersion: "exora.buyer_intent_classification.v0.1",
				Mode:          "manual_plan",
				Reason:        "The buyer explicitly asked to prepare or submit an Exora plan.",
				Confidence:    0.9,
				Signals:       signals,
			}
		}
	}
	for _, marker := range []string{"agent", "seller", "provider", "报价", "询价", "远端", "外部", "gpu", "cuda", "vram", "显存", "docker", "api", "服务器", "resource", "rent", "租"} {
		if strings.Contains(text, marker) {
			addSignal(marker)
		}
	}
	if strings.TrimSpace(req.TaskTemplate.Goal) != "" || strings.TrimSpace(req.TaskTemplate.Type) != "" || len(req.TaskTemplate.ExpectedOutputs) > 0 {
		addSignal("task_template")
	}
	if len(signals) > 0 {
		return BuyerIntentClassification{
			SchemaVersion: "exora.buyer_intent_classification.v0.1",
			Mode:          "candidate_task",
			Reason:        "The request appears to need external seller discovery, quote, or execution.",
			Confidence:    0.78,
			Signals:       signals,
		}
	}
	for _, marker := range []string{"how", "what", "why", "什么", "怎么", "为什么", "介绍", "explain"} {
		if strings.Contains(text, marker) {
			addSignal(marker)
			return BuyerIntentClassification{
				SchemaVersion:      "exora.buyer_intent_classification.v0.1",
				Mode:               "chat",
				Reason:             "The buyer is asking an informational question rather than requesting remote seller work.",
				Confidence:         0.7,
				ClarifyingQuestion: "",
				Signals:            signals,
			}
		}
	}
	return BuyerIntentClassification{
		SchemaVersion:      "exora.buyer_intent_classification.v0.1",
		Mode:               "clarify",
		Reason:             "The request is not yet specific enough to safely produce a remote task manifest.",
		Confidence:         0.62,
		ClarifyingQuestion: "What should the remote seller do, what inputs may be shared, and what budget or constraints should apply?",
		Signals:            signals,
	}
}

func (h *Handler) ensureBuyerManifestApproval(req coordinateBuyerWorkRequest, planID, manifestHash string, files map[string]string) (approval.Approval, error) {
	if h.approvals == nil {
		return approval.Approval{}, fmt.Errorf("approval service not configured")
	}
	metadata := map[string]any{
		"projectPath": req.ProjectPath,
		"workUid":     req.WorkUID,
		"planFiles":   files,
		"disclosure": map[string]any{
			"remote": []string{"task_requirements", "agent_requirements", "remote_task_manifest"},
			"local_only": []string{"api_keys", "credentials", "private_paths", "raw_diagnostics"},
		},
	}
	return h.approvals.Create(approval.CreateRequest{
		Action:       "submit_remote_task_manifest",
		SubjectType:  "buyer_manifest",
		SubjectID:    planID,
		WorkRunID:    req.RunID,
		PlanID:       planID,
		ManifestHash: manifestHash,
		UserPubkey:   req.RequesterPubkey,
		AgentID:      req.AgentID,
		ExpiresAt:    time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339),
		Metadata:     metadata,
	})
}

func (h *Handler) approvedManifestApproval(req coordinateBuyerWorkRequest) (approval.Approval, error) {
	if h.approvals == nil {
		return approval.Approval{}, fmt.Errorf("approval service not configured")
	}
	approvalID := strings.TrimSpace(req.ApprovalID)
	if approvalID == "" {
		return approval.Approval{}, fmt.Errorf("approvalId required")
	}
	a, ok := h.approvals.Get(approvalID)
	if !ok {
		return approval.Approval{}, fmt.Errorf("approval not found")
	}
	if a.Action != "submit_remote_task_manifest" {
		return approval.Approval{}, fmt.Errorf("approval action mismatch")
	}
	if a.Status != approval.StatusApproved {
		return approval.Approval{}, fmt.Errorf("manifest approval is not approved")
	}
	if strings.TrimSpace(req.PlanID) != "" && strings.TrimSpace(a.PlanID) != strings.TrimSpace(req.PlanID) {
		return approval.Approval{}, fmt.Errorf("plan_id mismatch")
	}
	if strings.TrimSpace(req.ManifestHash) != "" && strings.TrimSpace(a.ManifestHash) != strings.TrimSpace(req.ManifestHash) {
		return approval.Approval{}, fmt.Errorf("manifest_hash mismatch")
	}
	return a, nil
}

func buyerPlanID(req coordinateBuyerWorkRequest, intent string) string {
	for _, value := range []string{req.PlanID, req.RunID, req.WorkUID} {
		if id := safePlanID(value); id != "" {
			return id
		}
	}
	seed := strings.TrimSpace(intent)
	if len(seed) > 48 {
		seed = seed[:48]
	}
	return safePlanID(fmt.Sprintf("plan-%d-%s", time.Now().UTC().Unix(), buyerShortHash(seed)))
}

func buyerWorkArgs(req coordinateBuyerWorkRequest) map[string]any {
	return map[string]any{
		"query":            firstNonEmpty(req.Query, req.Intent),
		"intent":           req.Intent,
		"runId":            req.RunID,
		"controller":       req.Controller,
		"projectPath":      req.ProjectPath,
		"workUid":          req.WorkUID,
		"buyerAgentCardId": req.BuyerAgentCardID,
		"requesterPubkey":  req.RequesterPubkey,
		"agentId":          req.AgentID,
		"constraints":      req.Constraints,
		"taskTemplate":     req.TaskTemplate,
		"maxCandidates":    req.MaxCandidates,
		"maxResults":       req.MaxResults,
		"maxOptions":       req.MaxOptions,
		"fallbackToQuotes": req.FallbackToQuotes,
	}
}

func planFilesPayload(paths map[string]string, manifestHash string) map[string]any {
	return map[string]any{
		"paths":         paths,
		"manifest_hash": manifestHash,
		"manifestHash":  manifestHash,
	}
}

func isSignedQuotedNegotiation(n negotiation.Negotiation) bool {
	return n.Status == negotiation.StatusQuoted && n.Quote != nil && strings.TrimSpace(n.Quote.Signature) != ""
}

func signedQuotedIDsFromStore(h *Handler, ids []string) []string {
	if h == nil || h.negotiations == nil {
		return nil
	}
	out := []string{}
	for _, id := range ids {
		n, ok := h.negotiations.Get(id)
		if ok && isSignedQuotedNegotiation(n) {
			out = append(out, n.ID)
		}
	}
	return out
}

func signedNegotiationIDs(payload map[string]any) []string {
	out := []string{}
	for _, item := range anySlice(payload["negotiations"]) {
		data, err := json.Marshal(item)
		if err != nil {
			continue
		}
		var n negotiation.Negotiation
		if err := json.Unmarshal(data, &n); err == nil && isSignedQuotedNegotiation(n) {
			out = append(out, n.ID)
		}
	}
	return out
}

func anySlice(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	default:
		return nil
	}
}

func buyerMustJSON(value any) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func buyerShortHash(value string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return fmt.Sprintf("%08x", h.Sum32())
}

func shouldCreateOrderPlanFromQuotes(payload map[string]any) bool {
	return len(signedNegotiationIDs(payload)) > 0
}

func searchSellerCards(h *Handler, r *http.Request, intent string) any {
	if h == nil {
		return nil
	}
	return h.searchAgentCards(r.Context(), string(agentcard.RoleSeller), intent)
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
