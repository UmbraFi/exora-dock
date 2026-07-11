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
	if !strings.Contains(text, "exora.run_buyer_work") || !strings.Contains(text, "exora.session_request_user_input") {
		t.Fatalf("interactive tools missing: %s", text)
	}
	if strings.Contains(text, "exora.claim_run") {
		t.Fatalf("interactive pre-transaction session leaked run-capability surface: %s", text)
	}

	blocked := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"exora.session_report_progress","arguments":{"message":"working","workUid":"work-other"}}}`))
	blockedJSON, _ := json.Marshal(blocked)
	if !strings.Contains(string(blockedJSON), "workUid is locked") {
		t.Fatalf("mismatched workUid was not rejected: %s", blockedJSON)
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
	response := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"exora.session_request_user_input","arguments":{"question":"Which budget?"}}}`))
	data, _ := json.Marshal(response)
	if !strings.Contains(string(data), "waitingFor") {
		t.Fatalf("unexpected session tool response: %s", data)
	}
	if observedPath != "/v1/local-agent-sessions/agent-session-2/mcp-events" || observedSessionHeader != "agent-session-2" {
		t.Fatalf("event path/header = %q %q", observedPath, observedSessionHeader)
	}
}
