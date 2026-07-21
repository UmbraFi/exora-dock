package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func initializedTestServer(scopes ...string) *Server {
	server := NewServer(Options{})
	server.sessionToken = "internal-only"
	server.sessionMeta = map[string]any{"sessionId": "session", "scopes": scopes}
	server.initialized, server.ready = true, true
	return server
}

func TestInitializeNegotiatesLifecycleWithoutExposingSessionKey(t *testing.T) {
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.URL.Path == "/v4/local/agent-sessions" && r.Method == http.MethodPost {
			_ = json.NewEncoder(w).Encode(map[string]any{"sessionKey": "sk-exora-session-secret", "baseUrl": "http://127.0.0.1", "session": map[string]any{"sessionId": "ases_test", "scopes": []string{"market.read"}, "idleExpiresAt": "later", "expiresAt": "later"}})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer daemon.Close()
	server := NewServer(Options{BaseURL: daemon.URL, OwnerToken: "owner", HTTPClient: daemon.Client()})
	response := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`))
	raw, _ := json.Marshal(response)
	if strings.Contains(string(raw), "sk-exora-session-secret") || strings.Contains(string(raw), "sessionKey") {
		t.Fatalf("initialize leaked session credential: %s", raw)
	}
	blocked := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`)).(rpcResponse)
	if blocked.Error == nil || blocked.Error.Code != -32002 {
		t.Fatalf("operation before initialized notification was not blocked: %#v", blocked)
	}
	server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}`))
	listed := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}`)).(rpcResponse)
	if listed.Error != nil {
		t.Fatalf("tools/list after initialization failed: %#v", listed)
	}
}

func TestToolsAreFilteredByScopeAndArgumentsAreValidated(t *testing.T) {
	server := initializedTestServer("account.read")
	definitions := server.availableToolDefinitions()
	names := map[string]bool{}
	for _, definition := range definitions {
		names[definition.Name] = true
	}
	for _, required := range []string{"exora.get_ledger", "exora.get_usage", "exora.list_api_orders", "exora.get_api_order"} {
		if !names[required] {
			t.Fatalf("missing account tool %s", required)
		}
	}
	if names["exora.invoke_operation"] || names["exora.get_invocation"] || names["exora.create_artifact_download_grant"] || names["exora.submit_api_contract"] {
		t.Fatalf("scope leaked unavailable tools: %#v", names)
	}
	unknown := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"exora.invoke_operation","arguments":{}}}`)).(rpcResponse)
	if unknown.Error == nil || unknown.Error.Code != -32602 {
		t.Fatalf("unavailable tool was callable: %#v", unknown)
	}
	invalid := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"exora.list_api_orders","arguments":{"limit":101,"unexpected":true}}}`)).(rpcResponse)
	if invalid.Error == nil || invalid.Error.Code != -32602 {
		t.Fatalf("invalid arguments were accepted: %#v", invalid)
	}
}

func TestBuyerClosureToolsRequireTheirResourceIDs(t *testing.T) {
	server := initializedTestServer("api.invoke")
	for _, name := range []string{"exora.get_invocation", "exora.create_artifact_download_grant"} {
		request := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"` + name + `","arguments":{}}}`
		response := server.HandleJSON(context.Background(), []byte(request)).(rpcResponse)
		if response.Error == nil || response.Error.Code != -32602 {
			t.Fatalf("%s accepted a missing resource id: %#v", name, response)
		}
	}
}

func TestDefaultScopeToolSurfaceHasTwentyTwoCurrentTools(t *testing.T) {
	server := initializedTestServer("market.read", "api.invoke", "account.read", "provider.integrate")
	definitions := server.availableToolDefinitions()
	if len(definitions) != 22 {
		t.Fatalf("tool count=%d want 22", len(definitions))
	}
	seen := map[string]bool{}
	for _, definition := range definitions {
		if seen[definition.Name] || definition.RequiredScope == "" || len(definition.Annotations) == 0 {
			t.Fatalf("invalid tool definition: %#v", definition)
		}
		seen[definition.Name] = true
	}
}

func TestGetUsageIsAnExplicitCompatibilityAlias(t *testing.T) {
	server := initializedTestServer("account.read")
	definition, found := server.availableToolDefinition("exora.get_usage")
	if !found {
		t.Fatal("deprecated compatibility alias is missing")
	}
	if definition.Meta["exora/deprecated"] != true || definition.Meta["exora/replacement"] != "exora.get_ledger" {
		t.Fatalf("compatibility metadata=%#v", definition.Meta)
	}
}

func TestBuyerClosureToolsProxyTheAuthoritativeV4Routes(t *testing.T) {
	type request struct {
		method   string
		path     string
		rawQuery string
		auth     string
	}
	requests := []request{}
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		requests = append(requests, request{method: r.Method, path: r.URL.Path, rawQuery: r.URL.RawQuery, auth: r.Header.Get("Authorization")})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer daemon.Close()

	server := initializedTestServer("api.invoke", "account.read")
	server.opts.BaseURL = daemon.URL
	server.client = daemon.Client()
	cases := []struct {
		name string
		args map[string]any
	}{
		{name: "exora.get_invocation", args: map[string]any{"invocationId": "inv_one"}},
		{name: "exora.create_artifact_download_grant", args: map[string]any{"artifactId": "art_one"}},
		{name: "exora.get_ledger", args: map[string]any{}},
		{name: "exora.get_usage", args: map[string]any{}},
	}
	for _, testCase := range cases {
		result, err := server.callTool(context.Background(), testCase.name, testCase.args)
		if err != nil || result.IsError {
			t.Fatalf("%s failed: result=%#v err=%v", testCase.name, result, err)
		}
	}

	want := []request{
		{method: http.MethodGet, path: "/v4/invocations/inv_one", auth: "Bearer internal-only"},
		{method: http.MethodPost, path: "/v4/artifacts/art_one/download-grants", auth: "Bearer internal-only"},
		{method: http.MethodGet, path: "/v4/ledger", auth: "Bearer internal-only"},
		{method: http.MethodGet, path: "/v4/ledger", auth: "Bearer internal-only"},
	}
	if len(requests) != len(want) {
		t.Fatalf("proxied requests=%#v", requests)
	}
	for index := range want {
		if requests[index] != want[index] {
			t.Fatalf("request[%d]=%#v want %#v", index, requests[index], want[index])
		}
	}
}

func TestUnsupportedProtocolVersionReportsSupportedVersion(t *testing.T) {
	server := NewServer(Options{})
	response := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"old","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`)).(rpcResponse)
	if response.Error == nil || response.Error.Code != -32602 {
		t.Fatalf("unsupported version accepted: %#v", response)
	}
}

func TestServeCompletesQueuedRequestsAfterClientClosesStdin(t *testing.T) {
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			w.WriteHeader(http.StatusOK)
		case "/v4/local/agent-sessions":
			_ = json.NewEncoder(w).Encode(map[string]any{"sessionKey": "sk-exora-session-secret", "baseUrl": daemonURLForRequest(r), "session": map[string]any{"sessionId": "ases_test", "scopes": []string{"market.read"}, "idleExpiresAt": "later", "expiresAt": "later"}})
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	defer daemon.Close()
	input := strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
	}, "\n") + "\n"
	server := NewServer(Options{BaseURL: daemon.URL, OwnerToken: "owner", HTTPClient: daemon.Client()})
	var output bytes.Buffer
	if err := server.Serve(context.Background(), strings.NewReader(input), &output); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("queued response lost after EOF: %q", output.String())
	}
	if strings.Contains(output.String(), "sk-exora-session-secret") {
		t.Fatalf("stdio response leaked secret: %s", output.String())
	}
}

func daemonURLForRequest(r *http.Request) string {
	return "http://" + r.Host
}

func TestCancelledNotificationStopsInFlightToolCall(t *testing.T) {
	started := make(chan struct{})
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			w.WriteHeader(http.StatusOK)
		case "/v4/local/agent-sessions":
			_ = json.NewEncoder(w).Encode(map[string]any{"sessionKey": "internal", "baseUrl": daemonURLForRequest(r), "session": map[string]any{"sessionId": "ases_test", "scopes": []string{"market.read"}, "idleExpiresAt": "later", "expiresAt": "later"}})
		case "/v4/catalog/operations":
			close(started)
			<-r.Context().Done()
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	defer daemon.Close()
	reader, writer := io.Pipe()
	server := NewServer(Options{BaseURL: daemon.URL, OwnerToken: "owner", HTTPClient: daemon.Client()})
	var output bytes.Buffer
	done := make(chan error, 1)
	go func() { done <- server.Serve(context.Background(), reader, &output) }()
	for _, message := range []string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"exora.search_operations","arguments":{}}}`,
	} {
		_, _ = writer.Write([]byte(message + "\n"))
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("tool call did not reach daemon")
	}
	_, _ = writer.Write([]byte(`{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2}}` + "\n"))
	_ = writer.Close()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled tool call did not finish")
	}
	responses := strings.Split(strings.TrimSpace(output.String()), "\n")
	var cancelled bool
	for _, line := range responses {
		var response map[string]any
		_ = json.Unmarshal([]byte(line), &response)
		if response["id"] == float64(2) {
			result, _ := response["result"].(map[string]any)
			cancelled, _ = result["isError"].(bool)
		}
	}
	if !cancelled {
		t.Fatalf("cancelled call did not return a tool error: %s", output.String())
	}
}
