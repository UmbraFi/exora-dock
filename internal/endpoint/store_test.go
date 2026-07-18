package endpoint

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cache"
)

func TestValidateLocalBaseURLBlocksUnsafeTargets(t *testing.T) {
	blocked := []string{
		"https://example.com",
		"http://169.254.169.254/latest/meta-data",
		"http://0.0.0.0:8000",
		"http://224.0.0.1",
		"ftp://127.0.0.1/file",
	}
	for _, target := range blocked {
		if _, err := ValidateLocalBaseURL(context.Background(), target); err == nil {
			t.Fatalf("unsafe target accepted: %s", target)
		}
	}
	if _, err := ValidateLocalBaseURL(context.Background(), "http://127.0.0.1:8000"); err != nil {
		t.Fatalf("loopback target rejected: %v", err)
	}
	if _, err := ValidateLocalBaseURL(context.Background(), "http://10.20.30.40:8080"); err != nil {
		t.Fatalf("RFC1918 target rejected: %v", err)
	}
}

func TestProbeAndStoreEndpointContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	c, err := cache.New(16, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	store := NewStore(c)
	saved, err := store.Save(context.Background(), Config{EndpointID: "epd_test_12345678", LocalBaseURL: server.URL, HealthPath: "/health", ServiceManifest: endpointTestManifest(), LastProbeHealthy: true, TimeoutSeconds: 5, Concurrency: 2})
	if err != nil {
		t.Fatalf("save endpoint: %v", err)
	}
	status := Probe(context.Background(), ProbeInput{Config: saved, AuthType: "none"})
	if !status.Healthy || status.ContractSHA256 == "" {
		t.Fatalf("local probe failed: %+v", status)
	}
	if saved.LocalBaseURL != server.URL || len(store.List()) != 1 || saved.ContractSHA256 != status.ContractSHA256 || len(saved.Routes) != 2 {
		t.Fatalf("stored endpoint contract mismatch: %+v", saved)
	}
}

func endpointTestManifest() map[string]any {
	limits := map[string]any{"timeoutSeconds": 30, "maxRequestBytes": 1048576, "maxResponseBytes": 1048576, "maxConcurrency": 4}
	return map[string]any{
		"interface": map[string]any{"openapi": "3.1.0", "info": map[string]any{"title": "Test", "version": "1"}, "paths": map[string]any{
			"/run": map[string]any{"post": map[string]any{"operationId": "run", "responses": map[string]any{"200": map[string]any{"description": "ok", "content": map[string]any{"application/json": map[string]any{}}}}}},
			"/events": map[string]any{"get": map[string]any{"operationId": "events", "responses": map[string]any{"200": map[string]any{"description": "events", "content": map[string]any{"text/event-stream": map[string]any{}}}}}},
		}},
		"delivery": "dock_tunnel",
		"operationPolicies": []any{
			map[string]any{"operationId": "run", "interaction": "request_response", "sideEffect": false, "idempotent": true, "limits": limits, "meteringCapabilities": []any{"request"}},
			map[string]any{"operationId": "events", "interaction": "server_stream", "sideEffect": false, "idempotent": true, "limits": limits, "meteringCapabilities": []any{"request"}},
		},
		"pricingTemplate": map[string]any{"currency": "USDC", "defaults": []any{map[string]any{"dimension": "request", "rateAtomic": 1, "per": 1, "meterSource": "gateway", "chargeOn": "started"}}},
	}
}
