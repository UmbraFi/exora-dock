package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInteractiveSessionUsesScopedBuyerSurface(t *testing.T) {
	server := NewServer(Options{
		LegacyMarket:   false,
		AgentSessionID: "agent-session-1",
		WorkUID:        "work-locked",
		ProjectPath:    t.TempDir(),
	})
	response := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	data, _ := json.Marshal(response)
	text := string(data)
	if !strings.Contains(text, "exora.session_submit_plan") || !strings.Contains(text, "exora.session_request_user_input") {
		t.Fatalf("interactive tools missing: %s", text)
	}
	if !strings.Contains(text, "freedomHint") || !strings.Contains(text, "free-form answer") || !strings.Contains(text, `"minItems":2`) || !strings.Contains(text, `"maxItems":3`) {
		t.Fatalf("buyer question schema does not require 2-3 options plus a free-form path: %s", text)
	}
	if strings.Contains(text, "exora.claim_run") || strings.Contains(text, "exora.run_buyer_work") || strings.Contains(text, "exora.search_agent_cards") {
		t.Fatalf("buyer interview leaked transaction tools: %s", text)
	}

	blocked := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"exora.session_report_progress","arguments":{"message":"working","workUid":"work-other"}}}`))
	blockedJSON, _ := json.Marshal(blocked)
	if !strings.Contains(string(blockedJSON), "workUid is locked") {
		t.Fatalf("mismatched workUid was not rejected: %s", blockedJSON)
	}

	remote := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"exora.search_agent_cards","arguments":{"role":"seller"}}}`))
	remoteJSON, _ := json.Marshal(remote)
	if !strings.Contains(string(remoteJSON), "buyer interview phase") {
		t.Fatalf("buyer interview executed a remote-capable tool: %s", remoteJSON)
	}

	invalidQuestion := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"exora.session_request_user_input","arguments":{"id":"runtime","title":"Runtime","question":"Describe the runtime.","why":"Choose compute.","inputType":"text","allowCustom":true,"required":true,"freedomHint":"Describe the task instead."}}}`))
	invalidQuestionJSON, _ := json.Marshal(invalidQuestion)
	if !strings.Contains(string(invalidQuestionJSON), "single_select or multi_select") {
		t.Fatalf("non-option buyer question was accepted: %s", invalidQuestionJSON)
	}
}

func TestInteractiveBuyerAcceptsCompletePlanForLocalReview(t *testing.T) {
	server := NewServer(Options{AgentSessionID: "agent-session-plan", ConnectionRole: "buyer", WorkUID: "work-plan", ProjectPath: t.TempDir(), LegacyMarket: false})
	response := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"exora.session_submit_plan","arguments":{"plans":{"localPreparationPlan":{"version":"1.0","title":"Prepare API spec","summary":"Sanitize the API specification","objective":"Produce a safe input file","steps":["redact secrets"],"filesToPrepare":[{"id":"api_spec","name":"API spec","pathSuggestion":"inputs/api.json","purpose":"Describe endpoints","preparationSteps":["redact tokens"],"sensitivity":"private","remoteDisclosure":"redacted","required":true,"completionCriteria":["no secrets"]}],"safetyChecks":["scan secrets"],"completionCriteria":["api_spec ready"]},"remoteExecutionPlan":{"version":"1.0","title":"Buy an audit","summary":"Audit one service","goal":"Find defects","requiredFiles":[{"localFileId":"api_spec","usage":"Discover endpoints","required":true,"transferMode":"redacted","destination":"inputs/api.json"}],"executionSteps":["read spec","audit"],"requirements":["test API"],"constraints":{"budget":"100 USDC"},"deliverables":["report"],"acceptanceCriteria":["report lists evidence"],"prohibitedActions":["do not use production credentials"],"assumptions":[],"risks":[],"outOfScope":[]}}}}}`))
	data, _ := json.Marshal(response)
	if !strings.Contains(string(data), "plan_review") || !strings.Contains(string(data), "Buy an audit") {
		t.Fatalf("unexpected plan response: %s", data)
	}

	invalid := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"exora.session_submit_plan","arguments":{"plans":{"localPreparationPlan":{"title":"Local","summary":"Prepare","filesToPrepare":[{"id":"declared","pathSuggestion":"inputs/file.txt","remoteDisclosure":"full"}]},"remoteExecutionPlan":{"title":"Remote","summary":"Run","requiredFiles":[{"localFileId":"missing","transferMode":"full"}],"deliverables":["out"],"acceptanceCriteria":["done"]}}}}}`))
	invalidData, _ := json.Marshal(invalid)
	if !strings.Contains(string(invalidData), "not declared") {
		t.Fatalf("missing local file dependency was accepted: %s", invalidData)
	}
}

func TestInteractiveSessionReportsMCPEventWithoutOwnerToken(t *testing.T) {
	var observedPath, observedSessionHeader string
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observedPath = r.URL.Path
		observedSessionHeader = r.Header.Get("X-Exora-Agent-Session")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer httpServer.Close()
	server := NewServer(Options{BaseURL: httpServer.URL, AgentToken: "agent-token", AgentSessionID: "agent-session-2", WorkUID: "work-2", ProjectPath: t.TempDir(), LegacyMarket: false})
	response := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"exora.session_request_user_input","arguments":{"id":"budget","title":"Budget","question":"Which budget range works?","why":"This bounds seller options.","inputType":"single_select","options":[{"id":"small","label":"Under 25 USDC"},{"id":"standard","label":"25–100 USDC"}],"allowCustom":false,"required":true}}}`))
	data, _ := json.Marshal(response)
	if !strings.Contains(string(data), "waitingFor") {
		t.Fatalf("unexpected session tool response: %s", data)
	}
	if !strings.Contains(string(data), `"allowCustom":true`) || !strings.Contains(string(data), "concrete task") {
		t.Fatalf("question response did not enforce a free-form fallback: %s", data)
	}
	if observedPath != "/v1/local-agent-sessions/agent-session-2/mcp-events" || observedSessionHeader != "agent-session-2" {
		t.Fatalf("event path/header = %q %q", observedPath, observedSessionHeader)
	}
}
