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

	routes := []Route{{OperationID: "run", Method: "POST", Path: "/run"}, {OperationID: "events", Method: "GET", Path: "/events"}}
	status := Probe(context.Background(), ProbeInput{Config: Config{EndpointID: "epd_test_12345678", LocalBaseURL: server.URL, HealthPath: "/health", Routes: routes, TimeoutSeconds: 5, Concurrency: 2}, AuthType: "none"})
	if !status.Healthy || status.RouteFingerprint == "" {
		t.Fatalf("local probe failed: %+v", status)
	}

	c, err := cache.New(16, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	store := NewStore(c)
	saved, err := store.Save(context.Background(), Config{EndpointID: "epd_test_12345678", LocalBaseURL: server.URL, HealthPath: "/health", Routes: routes, RouteFingerprint: status.RouteFingerprint, LastProbeHealthy: true, TimeoutSeconds: 5, Concurrency: 2})
	if err != nil {
		t.Fatalf("save endpoint: %v", err)
	}
	if saved.LocalBaseURL != server.URL || len(store.List()) != 1 || saved.RouteFingerprint != RouteFingerprint(routes) {
		t.Fatalf("stored endpoint contract mismatch: %+v", saved)
	}
}

func TestRouteFingerprintIgnoresRouteOrder(t *testing.T) {
	a := []Route{{OperationID: "a", Method: "GET", Path: "/a"}, {OperationID: "b", Method: "POST", Path: "/b"}}
	b := []Route{{OperationID: "b", Method: "post", Path: "/b"}, {OperationID: "a", Method: "get", Path: "/a"}}
	if RouteFingerprint(a) != RouteFingerprint(b) {
		t.Fatal("route fingerprint changed when only route order/case changed")
	}
}
