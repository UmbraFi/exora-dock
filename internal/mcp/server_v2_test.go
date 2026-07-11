package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/runcapability"
)

func TestV2CapabilityConnectionExposesOnlyAutomationTools(t *testing.T) {
	capability, _, err := runcapability.NewEphemeral([]byte("mcp-v2-secret-with-at-least-thirty-two-bytes")).Issue(runcapability.Claims{
		RunID: "run-1", TransactionID: "tx-1", Role: "seller", Actions: []string{"*"},
	}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	var observedPath string
	var observedBody map[string]any
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+capability {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		observedPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&observedBody)
		_ = json.NewEncoder(w).Encode(map[string]any{"automationRun": map[string]any{"runId": "run-1"}})
	}))
	defer daemon.Close()

	server := NewServer(Options{BaseURL: daemon.URL, AgentToken: capability, HTTPClient: daemon.Client()})
	listed := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)))
	result := listed["result"].(map[string]any)
	tools := result["tools"].([]any)
	if len(tools) != len(V2ToolNames()) {
		t.Fatalf("tools=%d names=%v", len(tools), V2ToolNames())
	}
	for i, raw := range tools {
		tool := raw.(map[string]any)
		name := tool["name"].(string)
		if name != V2ToolNames()[i] || strings.Contains(name, "buyer_work") {
			t.Fatalf("tool %d = %#v", i, tool)
		}
		if strings.HasSuffix(name, "report_progress") {
			schema := tool["inputSchema"].(map[string]any)
			properties := schema["properties"].(map[string]any)
			versionSchema := properties["expectedStateVersion"].(map[string]any)
			if versionSchema["type"] != "integer" || versionSchema["minimum"] != float64(0) {
				t.Fatalf("expectedStateVersion schema = %#v", versionSchema)
			}
			required := schema["required"].([]any)
			joinedParts := make([]string, 0, len(required))
			for _, item := range required {
				joinedParts = append(joinedParts, item.(string))
			}
			joined := strings.Join(joinedParts, ",")
			for _, name := range []string{"runId", "expectedStateVersion", "idempotencyKey"} {
				if !strings.Contains(joined, name) {
					t.Fatalf("mutation schema missing %s: %#v", name, schema)
				}
			}
		}
	}

	called := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"exora.report_progress","arguments":{"runId":"run-1","expectedStateVersion":7,"idempotencyKey":"progress-1","payload":{"message":"working"}}}}`)))
	if _, ok := called["result"]; !ok {
		t.Fatalf("call response = %#v", called)
	}
	if observedPath != "/v1/automation-runs/run-1/actions" || observedBody["type"] != "report_progress" || observedBody["expectedStateVersion"] != float64(7) {
		t.Fatalf("observed path/body = %s %#v", observedPath, observedBody)
	}

	legacy := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"exora.run_buyer_work","arguments":{"query":"secret"}}}`)))
	if _, ok := legacy["error"]; !ok {
		t.Fatalf("legacy tool should be unavailable: %#v", legacy)
	}

	extra := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"exora.report_progress","arguments":{"runId":"run-1","expectedStateVersion":7,"idempotencyKey":"progress-2","ownerToken":"must-not-be-payload"}}}`)))
	extraResult, _ := extra["result"].(map[string]any)
	if extraResult["isError"] != true || !strings.Contains(extraResult["content"].([]any)[0].(map[string]any)["text"].(string), "unsupported arguments") {
		t.Fatalf("undeclared mutation argument accepted: %#v", extra)
	}
}
