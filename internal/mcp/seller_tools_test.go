package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSellerDraftToolsArePolicyGatedAndUseProviderAgentToken(t *testing.T) {
	var createAuth string
	var createBody map[string]any
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			w.WriteHeader(http.StatusOK)
		case "/v3/provider-agent/capabilities":
			if r.Header.Get("Authorization") != "Bearer provider-agent-secret" {
				t.Fatalf("capability authorization=%q", r.Header.Get("Authorization"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"enabled": true})
		case "/v3/provider-agent/draft-runs":
			createAuth = r.Header.Get("Authorization")
			_ = json.NewDecoder(r.Body).Decode(&createBody)
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(map[string]any{"run": map[string]any{"runId": "sdrun_1", "status": "queued"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer daemon.Close()

	server := NewServer(Options{BaseURL: daemon.URL, AgentToken: "buyer-agent-secret", ProviderAgentToken: "provider-agent-secret", HTTPClient: daemon.Client()})
	listed := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)))
	tools := listed["result"].(map[string]any)["tools"].([]any)
	serialized := mustJSON(t, tools)
	if len(tools) != len(V2ToolNames())+len(marketplaceToolNames)+len(sellerDraftToolNames) {
		t.Fatalf("tool count=%d seller tools=%s", len(tools), serialized)
	}
	for name := range sellerDraftToolNames {
		if !strings.Contains(serialized, name) {
			t.Fatalf("seller tool %s missing", name)
		}
	}
	if strings.Contains(serialized, "publish_listing") || strings.Contains(serialized, "pause_listing") || strings.Contains(serialized, "retire_listing") {
		t.Fatalf("public listing mutation leaked into MCP: %s", serialized)
	}

	called := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"exora.create_resource_listing_draft","arguments":{"candidateIds":["cand_1"],"commercial":{"price":{"amount":1}},"idempotencyKey":"resource-stable-1"}}}`)))
	if !strings.Contains(mustJSON(t, called["result"]), "sdrun_1") {
		t.Fatalf("create response=%#v", called)
	}
	if createAuth != "Bearer provider-agent-secret" || createBody["kind"] != "resources" {
		t.Fatalf("create auth=%q body=%#v", createAuth, createBody)
	}
}

func TestSellerDraftToolsHiddenWhenPolicyDisabledOrSessionBound(t *testing.T) {
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.URL.Path == "/v3/provider-agent/capabilities" {
			_ = json.NewEncoder(w).Encode(map[string]any{"enabled": false})
			return
		}
		http.NotFound(w, r)
	}))
	defer daemon.Close()
	server := NewServer(Options{BaseURL: daemon.URL, AgentToken: "agent", ProviderAgentToken: "provider", HTTPClient: daemon.Client()})
	listed := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)))
	if strings.Contains(mustJSON(t, listed), "get_seller_draft_capabilities") {
		t.Fatal("disabled seller policy exposed MCP tools")
	}
	direct := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"exora.list_my_listing_drafts","arguments":{}}}`)))
	if !strings.Contains(mustJSON(t, direct), "disabled until the owner") {
		t.Fatalf("disabled seller tool remained directly callable: %#v", direct)
	}

	bound := NewServer(Options{BaseURL: daemon.URL, AgentToken: "agent", ProviderAgentToken: "provider", AgentSessionID: "session-1", ConnectionRole: "seller", HTTPClient: daemon.Client()})
	boundList := responseMap(t, bound.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)))
	if strings.Contains(mustJSON(t, boundList), "get_seller_draft_capabilities") {
		t.Fatal("bound interactive session exposed seller draft tools")
	}
}
