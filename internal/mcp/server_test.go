package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestMarketplaceToolSurfaceIsExact(t *testing.T) {
	want := []string{
		"exora.search_products",
		"exora.get_product_manifest",
		"exora.estimate_purchase",
		"exora.purchase_compute_minutes",
		"exora.estimate_compute_extension",
		"exora.extend_compute_minutes",
		"exora.run_compute_command",
		"exora.read_compute_command_output",
		"exora.transfer_compute_file",
		"exora.get_compute_transfer",
		"exora.purchase_download",
		"exora.create_download_transfer",
		"exora.invoke_operation",
		"exora.get_lease",
		"exora.release_lease",
		"exora.get_usage",
		"exora.save_endpoint_draft",
		"exora.save_api_bridge_draft",
	}
	definitions := marketplaceToolDefinitions()
	got := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		got = append(got, definition.Name)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("marketplace tools mismatch\n got: %#v\nwant: %#v", got, want)
	}
}

func TestInitializeReturnsUniqueLocalSessionConnection(t *testing.T) {
	issued := 0
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.URL.Path == "/v3/local/agent-sessions" && r.Method == http.MethodPost {
			issued++
			if r.Header.Get("Authorization") != "Bearer owner" {
				t.Fatalf("owner credential missing: %q", r.Header.Get("Authorization"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"sessionKey": "sk-exora-session-key-" + string(rune('0'+issued)), "baseUrl": daemonURL(r) + "/v3", "session": map[string]any{"sessionId": "ases-" + string(rune('0'+issued)), "scopes": []string{"market.read"}, "idleAt": "2026-07-17T00:30:00Z", "expiresAt": "2026-07-18T00:00:00Z"}})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer daemon.Close()
	request := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`)
	first := NewServer(Options{BaseURL: daemon.URL, OwnerToken: "owner", ClientName: "Codex"}).HandleJSON(context.Background(), request)
	second := NewServer(Options{BaseURL: daemon.URL, OwnerToken: "owner", ClientName: "Codex"}).HandleJSON(context.Background(), request)
	one, _ := json.Marshal(first)
	two, _ := json.Marshal(second)
	if !strings.Contains(string(one), "sk-exora-session-key-1") || !strings.Contains(string(two), "sk-exora-session-key-2") {
		t.Fatalf("initialize did not return distinct local sessions: %s %s", one, two)
	}
	if strings.Contains(string(one), "owner") || strings.Contains(string(two), "owner") {
		t.Fatal("initialize exposed the Dock owner credential")
	}
}

func daemonURL(r *http.Request) string { return "http://" + r.Host }

func TestSellerDraftToolSurfaceIsExact(t *testing.T) {
	want := []string{
		"exora.get_seller_draft_capabilities",
		"exora.discover_sellable_resources",
		"exora.read_seller_material",
		"exora.create_vm_listing_draft",
		"exora.create_resource_listing_draft",
		"exora.get_seller_draft_run",
		"exora.resume_seller_draft_run",
		"exora.cancel_seller_draft_run",
		"exora.list_my_listing_drafts",
	}
	definitions := sellerDraftToolDefinitions()
	got := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		got = append(got, definition.Name)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("seller tools mismatch\n got: %#v\nwant: %#v", got, want)
	}
}

func TestServiceDraftBoundariesRejectRuntimeAndCrossedDelivery(t *testing.T) {
	server := NewServer(Options{})
	endpoint, err := server.saveServiceDraft(context.Background(), map[string]any{"baseUrl": "https://seller.example", "serviceManifest": map[string]any{}}, "endpoint", "dock_tunnel")
	if err != nil || !endpoint.IsError {
		t.Fatalf("Endpoint with baseUrl must be rejected: result=%#v err=%v", endpoint, err)
	}
	bridge, err := server.saveServiceDraft(context.Background(), map[string]any{"serviceManifest": map[string]any{"delivery": "dock_tunnel"}}, "api_bridge", "cloud_direct")
	if err != nil || !bridge.IsError {
		t.Fatalf("API Bridge with Endpoint delivery must be rejected: result=%#v err=%v", bridge, err)
	}
}

func TestInitializedSessionSearchesAllFourMarketplaceCategories(t *testing.T) {
	seen := map[string]bool{}
	revoked := false
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/health":
			w.WriteHeader(http.StatusOK)
		case r.URL.Path == "/v3/local/agent-sessions" && r.Method == http.MethodPost:
			if r.Header.Get("Authorization") != "Bearer owner" {
				t.Fatalf("session creation did not use owner authorization: %q", r.Header.Get("Authorization"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"sessionKey": "sk-exora-session-connectivity",
				"baseUrl":    daemonURL(r) + "/v3",
				"session": map[string]any{
					"sessionId": "ases-connectivity",
					"scopes":    []string{"market.read"},
				},
			})
		case r.URL.Path == "/v3/local/agent-sessions/ases-connectivity" && r.Method == http.MethodDelete:
			revoked = r.Header.Get("Authorization") == "Bearer owner"
			w.WriteHeader(http.StatusNoContent)
		case r.URL.Path == "/v3/catalog/listings" && r.Method == http.MethodGet:
			if r.Header.Get("Authorization") != "Bearer sk-exora-session-connectivity" {
				t.Fatalf("catalog search did not use the issued session: %q", r.Header.Get("Authorization"))
			}
			category := r.URL.Query().Get("applicationSource")
			seen[category] = true
			_ = json.NewEncoder(w).Encode(map[string]any{"listings": []any{}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer daemon.Close()

	server := NewServer(Options{BaseURL: daemon.URL, OwnerToken: "owner", ClientName: "connectivity-test"})
	initialized := server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`))
	encoded, _ := json.Marshal(initialized)
	if !strings.Contains(string(encoded), "ases-connectivity") || strings.Contains(string(encoded), "Unable to create") {
		t.Fatalf("MCP initialize failed: %s", encoded)
	}
	for _, category := range []string{"vm", "resources", "endpoint", "api_bridge"} {
		result, err := server.callTool(context.Background(), "exora.search_products", map[string]any{"applicationSource": category})
		if err != nil || result.IsError {
			t.Fatalf("%s search failed: result=%#v err=%v", category, result, err)
		}
	}
	server.revokeSession(context.Background())
	for _, category := range []string{"vm", "resources", "endpoint", "api_bridge"} {
		if !seen[category] {
			t.Errorf("%s catalog search did not reach the daemon", category)
		}
	}
	if !revoked {
		t.Error("MCP process did not revoke its local session")
	}
}
