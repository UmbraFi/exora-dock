package agent

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

type fakeGenerator struct {
	responses []string
	calls     int
}

func (f *fakeGenerator) Generate(ctx context.Context, system string, user any, opts LLMRequestOptions) (string, error) {
	if f.calls >= len(f.responses) {
		return `{"action":"finish","summary":"done"}`, nil
	}
	out := f.responses[f.calls]
	f.calls++
	return out, nil
}

func TestRuntimeBuyerFlowStopsAtPendingApproval(t *testing.T) {
	gen := &fakeGenerator{responses: []string{
		`{"action":"tool","tool":"search_agent_cards","args":{"role":"seller","q":"gpu"},"phase":"plan"}`,
		`{"action":"tool","tool":"start_task_flow","args":{"query":"run gpu docker"},"phase":"execute"}`,
	}}
	rt := NewRuntime(RuntimeConfig{
		Store:     NewRunStore(nil),
		Generator: gen,
		Tools: []AgentTool{
			{
				Name:            "search_agent_cards",
				ReadOnly:        true,
				AllowedProfiles: []string{ProfileBuyerCoordinator},
				Handler: func(ctx context.Context, run AgentRun, args map[string]any) (ToolResult, error) {
					return ToolResult{Content: map[string]any{"cards": []any{map[string]any{"id": "seller-1"}}}, Summary: "cards found", NextAction: "start_task_flow"}, nil
				},
			},
			{
				Name:            "start_task_flow",
				Mutating:        true,
				AllowedProfiles: []string{ProfileBuyerCoordinator},
				Handler: func(ctx context.Context, run AgentRun, args map[string]any) (ToolResult, error) {
					return ToolResult{
						Content: map[string]any{
							"summary":    "Received 1 realtime quote.",
							"nextAction": "ask_user_to_choose_realtime_quote",
							"selectionRequest": map[string]any{
								"planId": "opln-1",
							},
						},
						Summary:     "Received 1 realtime quote.",
						NextAction:  "ask_user_to_choose_realtime_quote",
						OrderPlanID: "opln-1",
						Waiting:     true,
					}, nil
				},
			},
		},
	})
	run, err := rt.Start(context.Background(), StartRequest{Intent: "run gpu docker"}, true)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if run.Status != RunStatusWaitingApproval {
		t.Fatalf("status = %s", run.Status)
	}
	if run.OrderPlanID != "opln-1" {
		t.Fatalf("order plan = %q", run.OrderPlanID)
	}
	if len(run.Turns) != 4 {
		t.Fatalf("turns = %d", len(run.Turns))
	}
}

func TestRuntimeBuyerNegotiationFlowCreatesPendingOrderPlan(t *testing.T) {
	gen := &fakeGenerator{responses: []string{
		`{"action":"tool","tool":"search_agent_cards","args":{"role":"seller","q":"gpu"},"phase":"plan"}`,
		`{"action":"tool","tool":"negotiate_task","args":{"query":"run gpu docker"},"phase":"execute"}`,
		`{"action":"tool","tool":"create_order_plan_from_quote","args":{"negotiationIds":["nego-1"]},"phase":"execute"}`,
	}}
	rt := NewRuntime(RuntimeConfig{
		Store:     NewRunStore(nil),
		Generator: gen,
		Tools: []AgentTool{
			{
				Name:            "search_agent_cards",
				ReadOnly:        true,
				AllowedProfiles: []string{ProfileBuyerCoordinator},
				Handler: func(ctx context.Context, run AgentRun, args map[string]any) (ToolResult, error) {
					return ToolResult{Content: map[string]any{"cards": []any{map[string]any{"id": "seller-1"}}}, Summary: "cards found", NextAction: "negotiate_task"}, nil
				},
			},
			{
				Name:            "negotiate_task",
				Mutating:        true,
				AllowedProfiles: []string{ProfileBuyerCoordinator},
				Handler: func(ctx context.Context, run AgentRun, args map[string]any) (ToolResult, error) {
					return ToolResult{
						Content:        map[string]any{"negotiationIds": []any{"nego-1"}, "quoteCount": 1, "rejectionCount": 1, "nextAction": "create_order_plan_from_quote"},
						Summary:        "1 quote, 1 rejection.",
						NextAction:     "create_order_plan_from_quote",
						NegotiationIDs: []string{"nego-1"},
						QuoteCount:     1,
						RejectionCount: 1,
					}, nil
				},
			},
			{
				Name:            "create_order_plan_from_quote",
				Mutating:        true,
				AllowedProfiles: []string{ProfileBuyerCoordinator},
				Handler: func(ctx context.Context, run AgentRun, args map[string]any) (ToolResult, error) {
					if len(run.NegotiationIDs) != 1 || run.NegotiationIDs[0] != "nego-1" {
						t.Fatalf("run negotiation ids = %#v", run.NegotiationIDs)
					}
					return ToolResult{
						Content:     map[string]any{"selectionRequest": map[string]any{"planId": "opln-nego"}},
						Summary:     "order plan created",
						NextAction:  "wait_for_owner_to_choose_order_plan",
						OrderPlanID: "opln-nego",
						Waiting:     true,
					}, nil
				},
			},
		},
	})
	run, err := rt.Start(context.Background(), StartRequest{Intent: "run gpu docker"}, true)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if run.Status != RunStatusWaitingApproval || run.OrderPlanID != "opln-nego" {
		t.Fatalf("run = %#v", run)
	}
	if run.QuoteCount != 1 || run.RejectionCount != 1 {
		t.Fatalf("quote/rejection count = %d/%d", run.QuoteCount, run.RejectionCount)
	}
}

func TestRuntimeInvalidJSONActionFailsRun(t *testing.T) {
	rt := runtimeWithResponses([]string{`not json`}, nil)
	run, err := rt.Start(context.Background(), StartRequest{Intent: "x"}, true)
	if err == nil {
		t.Fatalf("expected error")
	}
	if run.Status != RunStatusFailed || !strings.Contains(run.Error, "invalid JSON action") {
		t.Fatalf("run = %#v", run)
	}
}

func TestRuntimeUnknownToolFailsRun(t *testing.T) {
	rt := runtimeWithResponses([]string{`{"action":"tool","tool":"missing","args":{}}`}, nil)
	run, err := rt.Start(context.Background(), StartRequest{Intent: "x"}, true)
	if err == nil {
		t.Fatalf("expected error")
	}
	if run.Status != RunStatusFailed || !strings.Contains(run.Error, "unknown tool") {
		t.Fatalf("run = %#v", run)
	}
}

func TestRuntimeMaxTurnsFailsRun(t *testing.T) {
	tools := []AgentTool{{
		Name:     "noop",
		ReadOnly: true,
		Handler: func(ctx context.Context, run AgentRun, args map[string]any) (ToolResult, error) {
			return ToolResult{Content: map[string]any{"ok": true}, Summary: "ok", NextAction: "continue"}, nil
		},
	}}
	rt := runtimeWithResponses([]string{
		`{"action":"tool","tool":"noop","args":{}}`,
		`{"action":"tool","tool":"noop","args":{}}`,
	}, tools)
	run, err := rt.Start(context.Background(), StartRequest{Intent: "x", MaxTurns: 2}, true)
	if err == nil {
		t.Fatalf("expected max turns error")
	}
	if run.Status != RunStatusFailed || !strings.Contains(run.Error, "max turns") {
		t.Fatalf("run = %#v", run)
	}
}

func TestRuntimeToolErrorFailsRun(t *testing.T) {
	tools := []AgentTool{{
		Name:     "boom",
		ReadOnly: true,
		Handler: func(ctx context.Context, run AgentRun, args map[string]any) (ToolResult, error) {
			return ToolResult{}, fmt.Errorf("tool exploded")
		},
	}}
	rt := runtimeWithResponses([]string{`{"action":"tool","tool":"boom","args":{}}`}, tools)
	run, err := rt.Start(context.Background(), StartRequest{Intent: "x"}, true)
	if err == nil {
		t.Fatalf("expected tool error")
	}
	if run.Status != RunStatusFailed || !strings.Contains(run.Error, "tool exploded") {
		t.Fatalf("run = %#v", run)
	}
}

func TestRuntimeResumeAndStop(t *testing.T) {
	store := NewRunStore(nil)
	gen := &fakeGenerator{responses: []string{
		`{"action":"tool","tool":"wait","args":{}}`,
		`{"action":"finish","summary":"resumed"}`,
	}}
	rt := NewRuntime(RuntimeConfig{
		Store:     store,
		Generator: gen,
		Tools: []AgentTool{{
			Name:     "wait",
			ReadOnly: true,
			Handler: func(ctx context.Context, run AgentRun, args map[string]any) (ToolResult, error) {
				return ToolResult{Content: map[string]any{"nextAction": "wait_for_owner_approval"}, Summary: "waiting", NextAction: "wait_for_owner_approval", Waiting: true}, nil
			},
		}},
	})
	run, err := rt.Start(context.Background(), StartRequest{Intent: "x"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != RunStatusWaitingApproval {
		t.Fatalf("status = %s", run.Status)
	}
	run, err = rt.Resume(context.Background(), run.RunID, true)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != RunStatusCompleted || run.Summary != "resumed" {
		t.Fatalf("run = %#v", run)
	}

	stopRun, err := rt.Start(context.Background(), StartRequest{Intent: "y"}, false)
	if err != nil {
		t.Fatal(err)
	}
	stopped, err := rt.Stop(stopRun.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Status != RunStatusStopped {
		t.Fatalf("stopped = %#v", stopped)
	}
	time.Sleep(10 * time.Millisecond)
}

func runtimeWithResponses(responses []string, tools []AgentTool) *Runtime {
	if tools == nil {
		tools = []AgentTool{{Name: "noop", ReadOnly: true, Handler: func(ctx context.Context, run AgentRun, args map[string]any) (ToolResult, error) {
			return ToolResult{Content: map[string]any{"ok": true}}, nil
		}}}
	}
	return NewRuntime(RuntimeConfig{
		Store:     NewRunStore(nil),
		Generator: &fakeGenerator{responses: responses},
		Tools:     tools,
		MaxTurns:  4,
	})
}
