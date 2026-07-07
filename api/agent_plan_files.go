package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func writeAgentPlanFiles(projectPath, planID, query string, args map[string]any, result map[string]any) (map[string]string, error) {
	projectPath = strings.TrimSpace(projectPath)
	planID = safePlanID(planID)
	if projectPath == "" || planID == "" {
		return nil, nil
	}
	base := filepath.Join(projectPath, ".exora", "agent-plans", planID)
	if err := os.MkdirAll(base, 0o755); err != nil {
		return nil, err
	}
	taskRequirements := buildTaskRequirements(query, args, result)
	agentRequirements := buildAgentRequirements(args, result)
	remoteManifest := buildRemoteTaskManifest(planID, query, taskRequirements, agentRequirements, args, result)
	files := map[string]any{
		"task_requirements.json":    taskRequirements,
		"agent_requirements.json":   agentRequirements,
		"remote_task_manifest.json": remoteManifest,
	}
	paths := map[string]string{}
	for name, value := range files {
		path := filepath.Join(base, name)
		data, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return nil, err
		}
		data = append(data, '\n')
		if err := os.WriteFile(path, data, 0o644); err != nil {
			return nil, err
		}
		paths[strings.TrimSuffix(name, ".json")] = path
	}
	reviewPath := filepath.Join(base, "user_review.md")
	if err := os.WriteFile(reviewPath, []byte(buildUserReviewMarkdown(remoteManifest)), 0o644); err != nil {
		return nil, err
	}
	paths["user_review"] = reviewPath
	return paths, nil
}

func buildTaskRequirements(query string, args map[string]any, result map[string]any) map[string]any {
	taskTemplate := mapFromAny(args["taskTemplate"])
	requirements := mapFromAny(taskTemplate["requirements"])
	out := map[string]any{
		"schema_version": "exora.task_requirements.v0.1",
		"query":         firstNonEmpty(strings.TrimSpace(query), firstAgentArgString(args, "query", "intent", "q")),
		"requirements":  requirements,
		"created_at":    time.Now().UTC().Format(time.RFC3339),
	}
	copyPlanField(out, taskTemplate, "type")
	copyPlanField(out, taskTemplate, "goal")
	copyPlanField(out, taskTemplate, "intent")
	copyPlanFieldAs(out, taskTemplate, "inputFiles", "input_files")
	copyPlanFieldAs(out, taskTemplate, "expectedOutputs", "expected_outputs")
	copyPlanField(out, taskTemplate, "budget")
	copyPlanFieldAs(out, taskTemplate, "timeoutSeconds", "timeout_seconds")
	copyPlanFieldAs(out, taskTemplate, "privacyPolicy", "privacy_policy")
	copyPlanFieldAs(out, taskTemplate, "retentionPolicy", "retention_policy")
	copyPlanFieldAs(out, result, "normalizedQuery", "normalized_query")
	return out
}

func buildAgentRequirements(args map[string]any, result map[string]any) map[string]any {
	taskTemplate := mapFromAny(args["taskTemplate"])
	requirements := mapFromAny(taskTemplate["requirements"])
	out := map[string]any{
		"schema_version": "exora.agent_requirements.v0.1",
		"max_sellers":   firstNonNilValue(args["maxCandidates"], args["maxOptions"], args["maxResults"], 5),
		"constraints":   firstNonNilValue(args["constraints"], map[string]any{}),
		"capabilities":  inferAgentCapabilities(requirements, args),
		"created_at":    time.Now().UTC().Format(time.RFC3339),
	}
	if docker := firstNonNilValue(requirements["docker"], args["docker"], nil); docker != nil {
		out["docker"] = docker
	}
	copyPlanField(out, result, "cards")
	copyPlanField(out, result, "candidates")
	copyPlanField(out, result, "quoted")
	copyPlanField(out, result, "rejected")
	return out
}

func buildRemoteTaskManifest(planID, query string, taskRequirements map[string]any, agentRequirements map[string]any, args map[string]any, result map[string]any) map[string]any {
	taskType := firstNonEmpty(
		stringFromAny(taskRequirements["type"]),
		stringFromAny(mapFromAny(result["normalizedQuery"])["type"]),
		stringFromAny(mapFromAny(args["constraints"])["type"]),
		"external_agent_task",
	)
	title := firstNonEmpty(stringFromAny(taskRequirements["goal"]), query, firstAgentArgString(args, "query", "intent", "q"))
	manifest := map[string]any{
		"schema_version":     "exora.remote_task_manifest.v0.1",
		"plan_id":            planID,
		"task_type":          taskType,
		"title":              title,
		"summary":            title,
		"task_requirements":  taskRequirements,
		"agent_requirements": agentRequirements,
		"ambiguity_policy":   "remote task must not contain ambiguous requirements; ask buyer for clarification before provider execution",
		"external_only":      true,
		"review_status":      "owner_review_required",
		"created_at":         time.Now().UTC().Format(time.RFC3339),
	}
	manifest["manifest_hash"] = manifestHash(manifest)
	return manifest
}

func inferAgentCapabilities(requirements map[string]any, args map[string]any) []string {
	caps := []string{"external_agent"}
	if _, ok := requirements["docker"]; ok {
		caps = append(caps, "docker")
	}
	if containsText(args, "gpu") || containsText(requirements, "gpu") {
		caps = append(caps, "gpu")
	}
	return caps
}

func containsText(value any, needle string) bool {
	data, _ := json.Marshal(value)
	return strings.Contains(strings.ToLower(string(data)), strings.ToLower(needle))
}

func copyPlanField(dst map[string]any, src map[string]any, key string) {
	if value, ok := src[key]; ok && value != nil {
		dst[key] = value
	}
}

func copyPlanFieldAs(dst map[string]any, src map[string]any, key string, dstKey string) {
	if value, ok := src[key]; ok && value != nil {
		dst[dstKey] = value
	}
}

func mapFromAny(value any) map[string]any {
	if typed, ok := value.(map[string]any); ok && typed != nil {
		return typed
	}
	return map[string]any{}
}

func firstNonNilValue(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func safePlanID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
			continue
		}
		b.WriteRune('_')
	}
	return b.String()
}

func manifestHash(value map[string]any) string {
	data, err := json.Marshal(normalizeManifestForHash(value))
	if err != nil {
		return fmt.Sprintf("sha256:%064x", 0)
	}
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func normalizeManifestForHash(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := map[string]any{}
		for key, item := range typed {
			switch key {
			case "manifest_hash", "created_at", "createdAt":
				continue
			default:
				out[key] = normalizeManifestForHash(item)
			}
		}
		return out
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, normalizeManifestForHash(item))
		}
		return out
	default:
		return value
	}
}

func buildUserReviewMarkdown(manifest map[string]any) string {
	lines := []string{
		"# Exora Remote Task Manifest Review",
		"",
		"Review this manifest before allowing Exora Dock to contact remote sellers.",
		"",
		fmt.Sprintf("- Plan ID: %s", stringFromAny(manifest["plan_id"])),
		fmt.Sprintf("- Manifest hash: %s", stringFromAny(manifest["manifest_hash"])),
		fmt.Sprintf("- Task type: %s", stringFromAny(manifest["task_type"])),
		fmt.Sprintf("- Title: %s", stringFromAny(manifest["title"])),
		"",
		"## Disclosure",
		"",
		"- Remote sellers receive the task and agent requirements below.",
		"- Local private paths, API keys, credentials, wallet secrets, and raw diagnostics must stay local.",
		"- Submitting requires a Dock owner approval whose manifest hash matches this file.",
		"",
		"## Manifest JSON",
		"",
		"```json",
	}
	if data, err := json.MarshalIndent(manifest, "", "  "); err == nil {
		lines = append(lines, string(data))
	}
	lines = append(lines, "```", "")
	return strings.Join(lines, "\n")
}

func readManifestHash(path string) string {
	data, err := os.ReadFile(strings.TrimSpace(path))
	if err != nil {
		return ""
	}
	var manifest map[string]any
	if err := json.Unmarshal(data, &manifest); err != nil {
		return ""
	}
	return firstNonEmpty(stringFromAny(manifest["manifest_hash"]), stringFromAny(manifest["manifestHash"]))
}

func writeQuoteReviewFiles(projectPath, planID string, payload map[string]any) (map[string]string, error) {
	projectPath = strings.TrimSpace(projectPath)
	planID = safePlanID(planID)
	if projectPath == "" || planID == "" {
		return nil, nil
	}
	base := filepath.Join(projectPath, ".exora", "agent-plans", planID)
	if err := os.MkdirAll(base, 0o755); err != nil {
		return nil, err
	}
	review := map[string]any{
		"schema_version": "exora.quote_review.v0.1",
		"plan_id":        planID,
		"created_at":     time.Now().UTC().Format(time.RFC3339),
		"quote_count":    payload["quoteCount"],
		"rejection_count": payload["rejectionCount"],
		"negotiation_ids": payload["negotiationIds"],
		"next_action":    payload["nextAction"],
		"summary":        payload["summary"],
	}
	if value, ok := payload["negotiations"]; ok {
		review["negotiations"] = value
	}
	if value, ok := payload["orderPlan"]; ok {
		review["order_plan"] = value
	}
	jsonPath := filepath.Join(base, "quote_review.json")
	data, err := json.MarshalIndent(review, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(jsonPath, append(data, '\n'), 0o644); err != nil {
		return nil, err
	}
	mdPath := filepath.Join(base, "quote_review.md")
	lines := []string{
		"# Exora Quote Review",
		"",
		fmt.Sprintf("- Plan ID: %s", planID),
		fmt.Sprintf("- Summary: %s", stringFromAny(review["summary"])),
		fmt.Sprintf("- Next action: %s", stringFromAny(review["next_action"])),
		fmt.Sprintf("- Quote count: %s", stringFromAny(review["quote_count"])),
		fmt.Sprintf("- Rejection count: %s", stringFromAny(review["rejection_count"])),
		"",
		"Review the returned seller quote options in Exora Dock before choosing a seller.",
		"",
	}
	if err := os.WriteFile(mdPath, []byte(strings.Join(lines, "\n")), 0o644); err != nil {
		return nil, err
	}
	return map[string]string{"quote_review": jsonPath, "quote_review_markdown": mdPath}, nil
}
