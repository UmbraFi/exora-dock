package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/agent"
	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/negotiation"
	"github.com/exora-dock/exora-dock/internal/orderplan"
	"github.com/exora-dock/exora-dock/internal/payment"
	"github.com/exora-dock/exora-dock/internal/task"
)

// GetDisputeEvidence returns a redacted, summary-only evidence bundle for Cloud arbitration.
func (h *Handler) GetDisputeEvidence(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	side := normalizeEvidenceSide(query.Get("side"))
	disputeID := strings.TrimSpace(query.Get("disputeId"))
	orderPlanID := strings.TrimSpace(query.Get("orderPlanId"))
	taskID := strings.TrimSpace(query.Get("taskId"))
	negotiationIDs := splitEvidenceIDs(query.Get("negotiationIds"))
	agentRunIDs := splitEvidenceIDs(query.Get("agentRunIds"))

	records := map[string]any{
		"side":      side,
		"disputeId": disputeID,
		"dockId":    h.selfPubkey,
	}

	if h.orderPlans != nil {
		if orderPlanID != "" {
			if plan, ok := h.orderPlans.Get(orderPlanID); ok {
				records["orderPlan"] = redactEvidenceValue(mapFromJSON(plan))
				if taskID == "" {
					taskID = strings.TrimSpace(plan.TaskID)
				}
			}
		} else if taskID != "" {
			for _, plan := range h.orderPlans.List(orderplan.ListFilter{}) {
				if strings.TrimSpace(plan.TaskID) == taskID {
					orderPlanID = plan.ID
					records["orderPlan"] = redactEvidenceValue(mapFromJSON(plan))
					break
				}
			}
		}
	}

	if h.tasks != nil && taskID != "" {
		if found, ok := h.tasks.Get(taskID); ok {
			records["task"] = safeTaskEvidence(found)
			if strings.TrimSpace(found.ApprovalRequestID) != "" {
				records["taskApprovalRequestId"] = found.ApprovalRequestID
			}
		}
		if artifacts, ok := h.tasks.ArtifactManifest(taskID); ok {
			records["artifactManifest"] = safeArtifactManifest(artifacts)
		}
	}

	approvalIDs := map[string]bool{}
	if h.approvals != nil {
		if taskID != "" {
			for _, a := range h.approvals.List(approval.ListFilter{TaskID: taskID}) {
				approvalIDs[a.ID] = true
			}
		}
		if taskID == "" {
			for _, a := range h.approvals.List(approval.ListFilter{}) {
				if orderPlanID != "" && strings.Contains(mustMarshalString(a), orderPlanID) {
					approvalIDs[a.ID] = true
				}
			}
		}
		approvals := make([]any, 0, len(approvalIDs))
		for id := range approvalIDs {
			if a, ok := h.approvals.Get(id); ok {
				approvals = append(approvals, redactEvidenceValue(mapFromJSON(a)))
			}
		}
		if len(approvals) > 0 {
			records["approvals"] = approvals
		}
	}

	if h.payments != nil {
		payments := []any{}
		if taskID != "" {
			for _, record := range h.payments.List(payment.ListFilter{TaskID: taskID}) {
				payments = append(payments, redactEvidenceValue(mapFromJSON(record)))
			}
		}
		for approvalID := range approvalIDs {
			for _, record := range h.payments.List(payment.ListFilter{ApprovalID: approvalID}) {
				payments = append(payments, redactEvidenceValue(mapFromJSON(record)))
			}
		}
		if len(payments) > 0 {
			records["payments"] = payments
		}
	}

	if h.negotiations != nil {
		negotiations := []any{}
		if len(negotiationIDs) == 0 && orderPlanID != "" {
			for _, n := range h.negotiations.List(negotiation.ListFilter{OrderPlanID: orderPlanID}) {
				negotiations = append(negotiations, safeNegotiationEvidence(n))
			}
		}
		for _, id := range negotiationIDs {
			if n, ok := h.negotiations.Get(id); ok {
				negotiations = append(negotiations, safeNegotiationEvidence(n))
			}
		}
		if len(negotiations) > 0 {
			records["negotiations"] = negotiations
		}
	}

	if h.agentRuns != nil && len(agentRunIDs) > 0 {
		runs := []any{}
		for _, id := range agentRunIDs {
			if run, ok := h.agentRuns.Get(id); ok {
				runs = append(runs, safeAgentRunEvidence(run))
			}
		}
		if len(runs) > 0 {
			records["agentRuns"] = runs
		}
	}

	records = redactEvidenceValue(records).(map[string]any)
	bundle := map[string]any{
		"bundleId":    evidenceBundleID(disputeID, side),
		"side":        side,
		"dockId":      h.selfPubkey,
		"source":      "dock_dispute_evidence",
		"summary":     evidenceSummary(records),
		"records":     records,
		"contentHash": evidenceContentHash(records),
		"redactions":  []string{"owner_token", "credentials", "payment_pin", "private_paths", "raw_artifacts"},
		"collectedAt": time.Now().UTC().Format(time.RFC3339),
	}
	writeJSON(w, http.StatusOK, map[string]any{"bundle": bundle})
}

func normalizeEvidenceSide(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "seller" {
		return "seller"
	}
	return "buyer"
}

func splitEvidenceIDs(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		id := strings.TrimSpace(part)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func safeTaskEvidence(t task.Task) map[string]any {
	record := mapFromJSON(t)
	delete(record, "projectPath")
	delete(record, "artifacts")
	if files, ok := record["inputFiles"].([]any); ok {
		for i, item := range files {
			if file, ok := item.(map[string]any); ok {
				delete(file, "uri")
				files[i] = file
			}
		}
		record["inputFiles"] = files
	}
	return redactEvidenceValue(record).(map[string]any)
}

func safeArtifactManifest(artifacts []task.Artifact) []map[string]any {
	out := make([]map[string]any, 0, len(artifacts))
	for _, artifact := range artifacts {
		out = append(out, map[string]any{
			"name":        artifact.Name,
			"contentType": artifact.ContentType,
			"sizeBytes":   artifact.SizeBytes,
			"sha256":      artifact.SHA256,
		})
	}
	return out
}

func safeNegotiationEvidence(n negotiation.Negotiation) map[string]any {
	record := mapFromJSON(n)
	delete(record, "providerEndpoint")
	if messages, ok := record["messages"].([]any); ok {
		for i, item := range messages {
			if msg, ok := item.(map[string]any); ok {
				if content, _ := msg["content"].(string); len(content) > 1200 {
					msg["content"] = content[:1200] + "...[truncated]"
				}
				messages[i] = msg
			}
		}
		record["messages"] = messages
	}
	return redactEvidenceValue(record).(map[string]any)
}

func safeAgentRunEvidence(run agent.AgentRun) map[string]any {
	record := mapFromJSON(run)
	turns, _ := record["turns"].([]any)
	if len(turns) > 20 {
		turns = turns[len(turns)-20:]
	}
	for i, item := range turns {
		if turn, ok := item.(map[string]any); ok {
			if content, _ := turn["content"].(string); len(content) > 1200 {
				turn["content"] = content[:1200] + "...[truncated]"
			}
			if result, ok := turn["toolResult"]; ok {
				turn["toolResult"] = redactEvidenceValue(result)
			}
			turns[i] = turn
		}
	}
	record["turns"] = turns
	return redactEvidenceValue(record).(map[string]any)
}

func mapFromJSON(value any) map[string]any {
	data, err := json.Marshal(value)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return map[string]any{}
	}
	return out
}

func redactEvidenceValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			if sensitiveEvidenceKey(key) {
				out[key] = "[redacted]"
				continue
			}
			out[key] = redactEvidenceValue(item)
		}
		return out
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, redactEvidenceValue(item))
		}
		return out
	case []map[string]any:
		out := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, redactEvidenceValue(item).(map[string]any))
		}
		return out
	default:
		return value
	}
}

func sensitiveEvidenceKey(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	return strings.Contains(normalized, "token") ||
		strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "credential") ||
		strings.Contains(normalized, "password") ||
		strings.Contains(normalized, "paymentpin") ||
		strings.Contains(normalized, "payment_pin") ||
		strings.Contains(normalized, "privatekey") ||
		strings.Contains(normalized, "private_key") ||
		strings.Contains(normalized, "mnemonic") ||
		normalized == "pin" ||
		normalized == "api_key" ||
		normalized == "apikey" ||
		normalized == "uri" ||
		normalized == "url" ||
		strings.Contains(normalized, "path")
}

func evidenceContentHash(value any) string {
	data, _ := json.Marshal(redactEvidenceValue(value))
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func evidenceBundleID(disputeID string, side string) string {
	seed := firstNonEmpty(disputeID, time.Now().UTC().Format("20060102150405.000000000")) + "_" + side
	return "ev_" + strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return r
		}
		return '_'
	}, seed)
}

func evidenceSummary(records map[string]any) string {
	parts := []string{}
	for _, key := range []string{"orderPlan", "task", "artifactManifest", "approvals", "payments", "negotiations", "agentRuns"} {
		if value, ok := records[key]; ok {
			parts = append(parts, fmt.Sprintf("%s=%d", key, evidenceCount(value)))
		}
	}
	if len(parts) == 0 {
		return "No matching local records were found for the supplied dispute identifiers."
	}
	return "Collected redacted dispute evidence: " + strings.Join(parts, ", ") + "."
}

func evidenceCount(value any) int {
	switch typed := value.(type) {
	case []any:
		return len(typed)
	case []map[string]any:
		return len(typed)
	default:
		return 1
	}
}

func mustMarshalString(value any) string {
	data, _ := json.Marshal(value)
	return string(data)
}
