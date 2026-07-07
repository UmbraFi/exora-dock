package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

const (
	ProfileBuyerCoordinator = "buyer-coordinator"
	ProfileSellerWorker     = "seller-worker"
	ProfileVerifier         = "verifier"

	RunStatusQueued          = "queued"
	RunStatusRunning         = "running"
	RunStatusWaitingApproval = "waiting_approval"
	RunStatusCompleted       = "completed"
	RunStatusFailed          = "failed"
	RunStatusStopped         = "stopped"

	runIndexKey = "agent-runs:index"
	runTTL      = 365 * 24 * time.Hour
)

type Generator interface {
	Generate(ctx context.Context, system string, user any, opts LLMRequestOptions) (string, error)
}

type AgentRun struct {
	RunID          string      `json:"runId"`
	Profile        string      `json:"profile"`
	Status         string      `json:"status"`
	Intent         string      `json:"intent"`
	WorkUID        string      `json:"workUid,omitempty"`
	ProjectPath    string      `json:"projectPath,omitempty"`
	Controller     string      `json:"controller,omitempty"`
	Summary        string      `json:"summary,omitempty"`
	NextAction     string      `json:"nextAction,omitempty"`
	OrderPlanID    string      `json:"orderPlanId,omitempty"`
	NegotiationIDs []string    `json:"negotiationIds,omitempty"`
	QuoteCount     int         `json:"quoteCount,omitempty"`
	RejectionCount int         `json:"rejectionCount,omitempty"`
	TaskID         string      `json:"taskId,omitempty"`
	ApprovalID     string      `json:"approvalId,omitempty"`
	Error          string      `json:"error,omitempty"`
	CreatedAt      string      `json:"createdAt"`
	UpdatedAt      string      `json:"updatedAt"`
	CompletedAt    string      `json:"completedAt,omitempty"`
	Turns          []AgentTurn `json:"turns,omitempty"`
	MaxTurns       int         `json:"maxTurns,omitempty"`
}

type AgentTurn struct {
	TurnID     string         `json:"turnId"`
	Role       string         `json:"role"`
	Content    string         `json:"content,omitempty"`
	ToolName   string         `json:"toolName,omitempty"`
	ToolArgs   map[string]any `json:"toolArgs,omitempty"`
	ToolResult any            `json:"toolResult,omitempty"`
	CreatedAt  string         `json:"createdAt"`
}

type AgentTool struct {
	Name            string
	Description     string
	ReadOnly        bool
	Mutating        bool
	RequiresOwner   bool
	AllowedProfiles []string
	NextAction      string
	Handler         AgentToolHandler
}

type AgentToolHandler func(ctx context.Context, run AgentRun, args map[string]any) (ToolResult, error)

type ToolResult struct {
	Content        any
	Summary        string
	NextAction     string
	OrderPlanID    string
	NegotiationIDs []string
	QuoteCount     int
	RejectionCount int
	TaskID         string
	ApprovalID     string
	Waiting        bool
}

type RuntimeConfig struct {
	Store     *RunStore
	Generator Generator
	Tools     []AgentTool
	MaxTurns  int
}

type StartRequest struct {
	Intent      string `json:"intent"`
	Profile     string `json:"profile,omitempty"`
	WorkUID     string `json:"workUid,omitempty"`
	ProjectPath string `json:"projectPath,omitempty"`
	Controller  string `json:"controller,omitempty"`
	MaxTurns    int    `json:"maxTurns,omitempty"`
}

type Runtime struct {
	store     *RunStore
	generator Generator
	tools     map[string]AgentTool
	maxTurns  int

	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func NewRuntime(cfg RuntimeConfig) *Runtime {
	maxTurns := cfg.MaxTurns
	if maxTurns <= 0 {
		maxTurns = 8
	}
	tools := map[string]AgentTool{}
	for _, tool := range cfg.Tools {
		name := strings.TrimSpace(tool.Name)
		if name == "" || tool.Handler == nil {
			continue
		}
		tool.Name = name
		tools[name] = tool
	}
	if cfg.Store == nil {
		cfg.Store = NewRunStore(nil)
	}
	return &Runtime{
		store:     cfg.Store,
		generator: cfg.Generator,
		tools:     tools,
		maxTurns:  maxTurns,
		cancels:   map[string]context.CancelFunc{},
	}
}

func (r *Runtime) Start(ctx context.Context, req StartRequest, wait bool) (AgentRun, error) {
	if r == nil {
		return AgentRun{}, fmt.Errorf("agent runtime not configured")
	}
	intent := strings.TrimSpace(req.Intent)
	if intent == "" {
		return AgentRun{}, fmt.Errorf("intent required")
	}
	profile := normalizeProfile(req.Profile)
	maxTurns := req.MaxTurns
	if maxTurns <= 0 {
		maxTurns = r.maxTurns
	}
	if maxTurns <= 0 {
		maxTurns = 8
	}
	if maxTurns > 24 {
		maxTurns = 24
	}
	now := time.Now().UTC().Format(time.RFC3339)
	run := AgentRun{
		RunID:       newRunID("arun"),
		Profile:     profile,
		Status:      RunStatusQueued,
		Intent:      intent,
		WorkUID:     strings.TrimSpace(req.WorkUID),
		ProjectPath: strings.TrimSpace(req.ProjectPath),
		Controller:  strings.TrimSpace(req.Controller),
		Summary:     "Agent run queued.",
		NextAction:  "agent_execute",
		CreatedAt:   now,
		UpdatedAt:   now,
		MaxTurns:    maxTurns,
	}
	if err := r.store.Save(run); err != nil {
		return AgentRun{}, err
	}
	if wait {
		return r.execute(ctx, run.RunID)
	}
	go func() {
		_, _ = r.execute(context.Background(), run.RunID)
	}()
	return run, nil
}

func (r *Runtime) Resume(ctx context.Context, runID string, wait bool) (AgentRun, error) {
	if r == nil {
		return AgentRun{}, fmt.Errorf("agent runtime not configured")
	}
	runID = strings.TrimSpace(runID)
	run, ok := r.store.Get(runID)
	if !ok {
		return AgentRun{}, fmt.Errorf("agent run not found")
	}
	switch run.Status {
	case RunStatusCompleted:
		return run, nil
	case RunStatusStopped:
		return run, fmt.Errorf("agent run is stopped")
	}
	run.Error = ""
	run.Status = RunStatusQueued
	run.NextAction = "agent_resume"
	run.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := r.store.Save(run); err != nil {
		return AgentRun{}, err
	}
	if wait {
		return r.execute(ctx, runID)
	}
	go func() {
		_, _ = r.execute(context.Background(), runID)
	}()
	return run, nil
}

func (r *Runtime) Stop(runID string) (AgentRun, error) {
	if r == nil {
		return AgentRun{}, fmt.Errorf("agent runtime not configured")
	}
	runID = strings.TrimSpace(runID)
	run, ok := r.store.Get(runID)
	if !ok {
		return AgentRun{}, fmt.Errorf("agent run not found")
	}
	r.mu.Lock()
	cancel := r.cancels[runID]
	delete(r.cancels, runID)
	r.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	now := time.Now().UTC().Format(time.RFC3339)
	run.Status = RunStatusStopped
	run.NextAction = "stopped"
	run.Summary = "Agent run stopped."
	run.UpdatedAt = now
	run.CompletedAt = now
	if err := r.store.Save(run); err != nil {
		return AgentRun{}, err
	}
	return run, nil
}

func (r *Runtime) execute(parent context.Context, runID string) (AgentRun, error) {
	run, ok := r.store.Get(runID)
	if !ok {
		return AgentRun{}, fmt.Errorf("agent run not found")
	}
	ctx, cancel := context.WithCancel(parent)
	r.mu.Lock()
	r.cancels[runID] = cancel
	r.mu.Unlock()
	defer func() {
		cancel()
		r.mu.Lock()
		delete(r.cancels, runID)
		r.mu.Unlock()
	}()

	run.Status = RunStatusRunning
	run.Summary = "Agent is working."
	run.NextAction = "agent_think"
	run.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	_ = r.store.Save(run)

	if !generatorEnabled(r.generator) {
		run = r.fallbackRun(ctx, run)
		_ = r.store.Save(run)
		return run, statusError(run)
	}

	maxTurns := run.MaxTurns
	if maxTurns <= 0 {
		maxTurns = r.maxTurns
	}
	for turn := 0; turn < maxTurns; turn++ {
		select {
		case <-ctx.Done():
			run = finishRun(run, RunStatusStopped, "Agent run stopped.", "stopped", ctx.Err().Error())
			_ = r.store.Save(run)
			return run, ctx.Err()
		default:
		}
		raw, err := r.generator.Generate(ctx, r.systemPrompt(run), r.userPayload(run), LLMRequestOptions{
			Profile:        LLMProfileUtility,
			MaxTokens:      1200,
			ResponseFormat: JSONResponseFormat(),
		})
		if err != nil {
			run = finishRun(run, RunStatusFailed, "LLM action failed.", "review_agent_error", err.Error())
			_ = r.store.Save(run)
			return run, err
		}
		run.Turns = append(run.Turns, AgentTurn{
			TurnID:    newRunID("turn"),
			Role:      "assistant",
			Content:   raw,
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		})
		action, err := parseAgentActionJSON(raw)
		if err != nil {
			run = finishRun(run, RunStatusFailed, "Invalid agent JSON action.", "fix_agent_action", err.Error())
			_ = r.store.Save(run)
			return run, err
		}
		switch strings.ToLower(strings.TrimSpace(action.Action)) {
		case "finish", "final":
			status := RunStatusCompleted
			if humanAction(action.NextAction) {
				status = RunStatusWaitingApproval
			}
			run = finishRun(run, status, firstText(action.Summary, "Agent run finished."), action.NextAction, "")
			_ = r.store.Save(run)
			return run, nil
		case "tool":
			tool, ok := r.tools[strings.TrimSpace(action.Tool)]
			if !ok {
				err := fmt.Errorf("unknown tool: %s", action.Tool)
				run = finishRun(run, RunStatusFailed, "Agent requested an unknown tool.", "fix_agent_tool", err.Error())
				_ = r.store.Save(run)
				return run, err
			}
			if !toolAllowedForProfile(tool, run.Profile) {
				err := fmt.Errorf("tool %s is not allowed for profile %s", tool.Name, run.Profile)
				run = finishRun(run, RunStatusFailed, "Agent requested a disallowed tool.", "fix_agent_tool_profile", err.Error())
				_ = r.store.Save(run)
				return run, err
			}
			if action.ReadOnlyPhase() && (tool.Mutating || !tool.ReadOnly) {
				err := fmt.Errorf("tool %s cannot run during read-only phase", tool.Name)
				run = finishRun(run, RunStatusFailed, "Read-only phase blocked a mutating tool.", "retry_with_execute_phase", err.Error())
				_ = r.store.Save(run)
				return run, err
			}
			result, err := tool.Handler(ctx, run, action.Args)
			toolTurn := AgentTurn{
				TurnID:     newRunID("turn"),
				Role:       "tool",
				ToolName:   tool.Name,
				ToolArgs:   action.Args,
				ToolResult: result.Content,
				CreatedAt:  time.Now().UTC().Format(time.RFC3339),
			}
			if err != nil {
				toolTurn.Content = err.Error()
				run.Turns = append(run.Turns, toolTurn)
				run = finishRun(run, RunStatusFailed, "Agent tool failed.", "review_tool_error", err.Error())
				_ = r.store.Save(run)
				return run, err
			}
			run.Turns = append(run.Turns, toolTurn)
			applyToolResult(&run, result, tool)
			run.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
			if result.Waiting || humanAction(run.NextAction) {
				run.Status = RunStatusWaitingApproval
				_ = r.store.Save(run)
				return run, nil
			}
			run.Status = RunStatusRunning
			_ = r.store.Save(run)
		default:
			err := fmt.Errorf("unsupported action %q", action.Action)
			run = finishRun(run, RunStatusFailed, "Agent returned an unsupported action.", "fix_agent_action", err.Error())
			_ = r.store.Save(run)
			return run, err
		}
	}
	err := fmt.Errorf("agent exceeded max turns (%d)", maxTurns)
	run = finishRun(run, RunStatusFailed, "Agent exceeded max turns.", "review_agent_loop", err.Error())
	_ = r.store.Save(run)
	return run, err
}

func (r *Runtime) fallbackRun(ctx context.Context, run AgentRun) AgentRun {
	tool, ok := r.tools["negotiate_task"]
	toolName := "negotiate_task"
	if !ok {
		tool, ok = r.tools["start_task_flow"]
		toolName = "start_task_flow"
	}
	if !ok || run.Profile != ProfileBuyerCoordinator {
		return finishRun(run, RunStatusFailed, "Agent LLM is not configured.", "configure_llm", "LLM API is not configured and no deterministic fallback is available")
	}
	args := map[string]any{
		"query":                  run.Intent,
		"agentId":                "exora-agent-runtime",
		"prepareOrderOptions":    true,
		"createSelectionRequest": true,
		"requireRealtimeQuotes":  true,
		"maxOptions":             float64(6),
		"maxResults":             float64(6),
	}
	if toolName == "negotiate_task" {
		args = map[string]any{"query": run.Intent, "maxCandidates": float64(3)}
	}
	actionData, _ := json.Marshal(map[string]any{"action": "tool", "tool": toolName, "args": map[string]any{"query": run.Intent}})
	run.Turns = append(run.Turns, AgentTurn{
		TurnID:    newRunID("turn"),
		Role:      "assistant",
		Content:   string(actionData),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})
	result, err := tool.Handler(ctx, run, args)
	toolTurn := AgentTurn{
		TurnID:     newRunID("turn"),
		Role:       "tool",
		ToolName:   tool.Name,
		ToolArgs:   args,
		ToolResult: nil,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	if err != nil {
		toolTurn.Content = err.Error()
		run.Turns = append(run.Turns, toolTurn)
		return finishRun(run, RunStatusFailed, "Fallback task flow failed.", "review_tool_error", err.Error())
	}
	toolTurn.ToolResult = result.Content
	run.Turns = append(run.Turns, toolTurn)
	applyToolResult(&run, result, tool)
	if toolName == "negotiate_task" && result.QuoteCount > 0 {
		if planTool, ok := r.tools["create_order_plan_from_quote"]; ok {
			args := map[string]any{"negotiationIds": run.NegotiationIDs, "query": run.Intent}
			actionData, _ := json.Marshal(map[string]any{"action": "tool", "tool": "create_order_plan_from_quote", "args": args})
			run.Turns = append(run.Turns, AgentTurn{
				TurnID:    newRunID("turn"),
				Role:      "assistant",
				Content:   string(actionData),
				CreatedAt: time.Now().UTC().Format(time.RFC3339),
			})
			planResult, err := planTool.Handler(ctx, run, args)
			planTurn := AgentTurn{
				TurnID:     newRunID("turn"),
				Role:       "tool",
				ToolName:   planTool.Name,
				ToolArgs:   args,
				ToolResult: nil,
				CreatedAt:  time.Now().UTC().Format(time.RFC3339),
			}
			if err != nil {
				planTurn.Content = err.Error()
				run.Turns = append(run.Turns, planTurn)
				return finishRun(run, RunStatusFailed, "Fallback order plan failed.", "review_tool_error", err.Error())
			}
			planTurn.ToolResult = planResult.Content
			run.Turns = append(run.Turns, planTurn)
			applyToolResult(&run, planResult, planTool)
			result = planResult
		}
	}
	if result.Waiting || humanAction(run.NextAction) {
		run.Status = RunStatusWaitingApproval
	} else {
		run.Status = RunStatusCompleted
		run.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	}
	run.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return run
}

func (r *Runtime) systemPrompt(run AgentRun) string {
	return strings.TrimSpace(fmt.Sprintf(`
You are Exora Agent v1 running inside Exora Dock.
Profile: %s.
Return exactly one JSON object per turn. No markdown.
Allowed actions:
{"action":"tool","tool":"tool_name","args":{...},"phase":"execute","summary":"short state","nextAction":"optional"}
{"action":"finish","summary":"short result","nextAction":"optional"}

Hard boundaries:
- You coordinate Exora market, Agent Card, order-plan, approval, Docker job status, and artifacts.
- Never approve, reject, select order plans, pay, set wallet/payment PIN, reveal credentials, or read arbitrary local files.
- Docker is never called directly by you; use task flow, docker_preflight, status polling, and artifact manifest tools only.
- If a human must choose, approve, pay, or provide consent, stop with a clear nextAction.
- For paid work, never continue to submit_worker_job from a local payment record alone; first call/find payment evidence and require found_finalized Cloud/chain evidence.
- Plan/read-only phases may only use readOnly tools.
- Prefer Agent Card search before offer fallback for buyer work.
- Buyer work should be negotiation-first: search seller Agent Cards, negotiate with 2-3 sellers, compare formal quotes/rejections, then create an order plan and stop for owner choice.

Tools:
%s
`, run.Profile, r.toolSpecJSON(run.Profile)))
}

func (r *Runtime) userPayload(run AgentRun) map[string]any {
	return map[string]any{
		"runId":          run.RunID,
		"intent":         run.Intent,
		"workUid":        run.WorkUID,
		"projectPath":    run.ProjectPath,
		"controller":     run.Controller,
		"profile":        run.Profile,
		"status":         run.Status,
		"summary":        run.Summary,
		"nextAction":     run.NextAction,
		"orderPlanId":    run.OrderPlanID,
		"negotiationIds": run.NegotiationIDs,
		"quoteCount":     run.QuoteCount,
		"rejectionCount": run.RejectionCount,
		"taskId":         run.TaskID,
		"approvalId":     run.ApprovalID,
		"turns":          run.Turns,
	}
}

func (r *Runtime) toolSpecJSON(profile string) string {
	specs := []map[string]any{}
	for _, tool := range r.tools {
		if !toolAllowedForProfile(tool, profile) {
			continue
		}
		specs = append(specs, map[string]any{
			"name":            tool.Name,
			"description":     tool.Description,
			"readOnly":        tool.ReadOnly,
			"mutating":        tool.Mutating,
			"requiresOwner":   tool.RequiresOwner,
			"allowedProfiles": tool.AllowedProfiles,
			"nextAction":      tool.NextAction,
		})
	}
	data, _ := json.Marshal(specs)
	return string(data)
}

type agentAction struct {
	Action     string         `json:"action"`
	Tool       string         `json:"tool,omitempty"`
	Args       map[string]any `json:"args,omitempty"`
	Phase      string         `json:"phase,omitempty"`
	Summary    string         `json:"summary,omitempty"`
	NextAction string         `json:"nextAction,omitempty"`
}

func (a agentAction) ReadOnlyPhase() bool {
	phase := strings.ToLower(strings.TrimSpace(a.Phase))
	return phase == "plan" || phase == "read_only" || phase == "readonly" || phase == "explore"
}

func parseAgentActionJSON(raw string) (agentAction, error) {
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)
	var action agentAction
	if err := json.Unmarshal([]byte(cleaned), &action); err != nil {
		return agentAction{}, fmt.Errorf("invalid JSON action: %w", err)
	}
	action.Action = strings.TrimSpace(action.Action)
	action.Tool = strings.TrimSpace(action.Tool)
	if action.Args == nil {
		action.Args = map[string]any{}
	}
	if action.Action == "" {
		return agentAction{}, fmt.Errorf("action required")
	}
	if strings.EqualFold(action.Action, "tool") && action.Tool == "" {
		return agentAction{}, fmt.Errorf("tool action requires tool")
	}
	return action, nil
}

func applyToolResult(run *AgentRun, result ToolResult, tool AgentTool) {
	run.Summary = firstText(result.Summary, run.Summary, tool.Description)
	run.NextAction = firstText(result.NextAction, tool.NextAction, run.NextAction)
	run.OrderPlanID = firstText(result.OrderPlanID, run.OrderPlanID)
	if len(result.NegotiationIDs) > 0 {
		run.NegotiationIDs = mergeUniqueStrings(run.NegotiationIDs, result.NegotiationIDs)
	}
	if result.QuoteCount > 0 {
		run.QuoteCount = result.QuoteCount
	}
	if result.RejectionCount > 0 {
		run.RejectionCount = result.RejectionCount
	}
	run.TaskID = firstText(result.TaskID, run.TaskID)
	run.ApprovalID = firstText(result.ApprovalID, run.ApprovalID)
	extractRunIDs(run, result.Content)
}

func extractRunIDs(run *AgentRun, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return
	}
	if id := nestedString(payload, "orderPlanId"); id != "" {
		run.OrderPlanID = id
	}
	if ids := nestedStringList(payload, "negotiationIds"); len(ids) > 0 {
		run.NegotiationIDs = mergeUniqueStrings(run.NegotiationIDs, ids)
	}
	if id := nestedString(payload, "planId"); id != "" {
		run.OrderPlanID = id
	}
	if id := nestedString(payload, "taskId"); id != "" {
		run.TaskID = id
	}
	if id := nestedString(payload, "approvalId"); id != "" {
		run.ApprovalID = id
	}
	if next := nestedString(payload, "nextAction"); next != "" {
		run.NextAction = next
	}
	if summary := nestedString(payload, "summary"); summary != "" {
		run.Summary = summary
	}
}

func nestedString(value any, key string) string {
	switch typed := value.(type) {
	case map[string]any:
		if raw, ok := typed[key]; ok {
			if text, ok := raw.(string); ok && strings.TrimSpace(text) != "" {
				return strings.TrimSpace(text)
			}
		}
		for _, child := range typed {
			if found := nestedString(child, key); found != "" {
				return found
			}
		}
	case []any:
		for _, child := range typed {
			if found := nestedString(child, key); found != "" {
				return found
			}
		}
	}
	return ""
}

func nestedStringList(value any, key string) []string {
	switch typed := value.(type) {
	case map[string]any:
		if raw, ok := typed[key]; ok {
			switch values := raw.(type) {
			case []string:
				return compactStringList(values)
			case []any:
				out := []string{}
				for _, item := range values {
					if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
						out = append(out, strings.TrimSpace(text))
					}
				}
				if len(out) > 0 {
					return out
				}
			}
		}
		for _, child := range typed {
			if found := nestedStringList(child, key); len(found) > 0 {
				return found
			}
		}
	case []any:
		for _, child := range typed {
			if found := nestedStringList(child, key); len(found) > 0 {
				return found
			}
		}
	}
	return nil
}

func finishRun(run AgentRun, status, summary, nextAction, errText string) AgentRun {
	now := time.Now().UTC().Format(time.RFC3339)
	run.Status = status
	run.Summary = firstText(summary, run.Summary)
	run.NextAction = strings.TrimSpace(nextAction)
	run.Error = strings.TrimSpace(errText)
	run.UpdatedAt = now
	if status == RunStatusCompleted || status == RunStatusFailed || status == RunStatusStopped {
		run.CompletedAt = now
	}
	return run
}

func statusError(run AgentRun) error {
	if run.Status == RunStatusFailed && strings.TrimSpace(run.Error) != "" {
		return errors.New(run.Error)
	}
	return nil
}

func humanAction(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	if lower == "" {
		return false
	}
	for _, marker := range []string{"approval", "approve", "choose", "select", "payment", "pay", "pin", "human", "user", "owner", "consent", "seller_option", "realtime_quote"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func normalizeProfile(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", ProfileBuyerCoordinator:
		return ProfileBuyerCoordinator
	case ProfileSellerWorker:
		return ProfileSellerWorker
	case ProfileVerifier:
		return ProfileVerifier
	default:
		return ProfileBuyerCoordinator
	}
}

func toolAllowedForProfile(tool AgentTool, profile string) bool {
	if len(tool.AllowedProfiles) == 0 {
		return true
	}
	for _, allowed := range tool.AllowedProfiles {
		if strings.TrimSpace(allowed) == profile {
			return true
		}
	}
	return false
}

func generatorEnabled(generator Generator) bool {
	if generator == nil {
		return false
	}
	if enabled, ok := generator.(interface{ Enabled() bool }); ok {
		return enabled.Enabled()
	}
	return true
}

func firstText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func newRunID(prefix string) string {
	var buf [6]byte
	if _, err := rand.Read(buf[:]); err == nil {
		return fmt.Sprintf("%s-%d-%s", prefix, time.Now().UTC().UnixNano(), hex.EncodeToString(buf[:]))
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(fmt.Sprintf("%d", time.Now().UTC().UnixNano())))
	return fmt.Sprintf("%s-%d-%08x", prefix, time.Now().UTC().UnixNano(), h.Sum32())
}

type RunStore struct {
	cache *cache.Cache
	mu    sync.RWMutex
	runs  map[string]AgentRun
	index []string
}

func NewRunStore(c *cache.Cache) *RunStore {
	return &RunStore{
		cache: c,
		runs:  map[string]AgentRun{},
	}
}

func (s *RunStore) Save(run AgentRun) error {
	if s == nil {
		return fmt.Errorf("agent run store not configured")
	}
	if strings.TrimSpace(run.RunID) == "" {
		return fmt.Errorf("runId required")
	}
	s.mu.Lock()
	s.runs[run.RunID] = run
	if !containsString(s.index, run.RunID) {
		s.index = append([]string{run.RunID}, s.index...)
	}
	index := append([]string(nil), s.index...)
	s.mu.Unlock()

	if s.cache != nil {
		data, err := json.Marshal(run)
		if err != nil {
			return err
		}
		s.cache.Set(runKey(run.RunID), data, runTTL)
		indexData, err := json.Marshal(index)
		if err != nil {
			return err
		}
		s.cache.Set(runIndexKey, indexData, runTTL)
	}
	return nil
}

func (s *RunStore) Get(id string) (AgentRun, bool) {
	if s == nil {
		return AgentRun{}, false
	}
	id = strings.TrimSpace(id)
	s.mu.RLock()
	run, ok := s.runs[id]
	s.mu.RUnlock()
	if ok {
		return run, true
	}
	if s.cache == nil {
		return AgentRun{}, false
	}
	data, ok := s.cache.Get(runKey(id))
	if !ok {
		return AgentRun{}, false
	}
	if err := json.Unmarshal(data, &run); err != nil {
		return AgentRun{}, false
	}
	s.mu.Lock()
	s.runs[id] = run
	if !containsString(s.index, id) {
		s.index = append(s.index, id)
	}
	s.mu.Unlock()
	return run, true
}

func (s *RunStore) List() []AgentRun {
	if s == nil {
		return nil
	}
	ids := s.loadIndex()
	out := make([]AgentRun, 0, len(ids))
	for _, id := range ids {
		if run, ok := s.Get(id); ok {
			out = append(out, run)
		}
	}
	return out
}

func (s *RunStore) loadIndex() []string {
	s.mu.RLock()
	ids := append([]string(nil), s.index...)
	s.mu.RUnlock()
	if len(ids) > 0 || s.cache == nil {
		return ids
	}
	data, ok := s.cache.Get(runIndexKey)
	if !ok {
		return nil
	}
	if err := json.Unmarshal(data, &ids); err != nil {
		return nil
	}
	s.mu.Lock()
	s.index = append([]string(nil), ids...)
	s.mu.Unlock()
	return ids
}

func runKey(id string) string {
	return "agent-run:" + strings.TrimSpace(id)
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func mergeUniqueStrings(base []string, additions []string) []string {
	out := append([]string(nil), base...)
	for _, value := range additions {
		value = strings.TrimSpace(value)
		if value == "" || containsString(out, value) {
			continue
		}
		out = append(out, value)
	}
	return out
}

func compactStringList(values []string) []string {
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}
