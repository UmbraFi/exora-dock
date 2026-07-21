package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/exora-dock/exora-dock/internal/discovery"
)

func TestAgentSessionRemoteAddressMustBeLoopback(t *testing.T) {
	for address, want := range map[string]bool{"127.0.0.1:5000": true, "[::1]:5000": true, "192.0.2.10:5000": false, "invalid": false} {
		request := httptest.NewRequest(http.MethodGet, "/v4/catalog/operations", nil)
		request.RemoteAddr = address
		if got := loopbackRequest(request); got != want {
			t.Fatalf("loopbackRequest(%q)=%v want %v", address, got, want)
		}
	}
}

func TestRetiredRoutesAreNotRegistered(t *testing.T) {
	manifest := discovery.BuildWithBaseURL("http://127.0.0.1:8080", "test-dock")
	handler := New(Options{Discovery: &manifest})
	for _, path := range []string{
		"/v3/catalog/listings",
		"/v3/compute-purchases",
		"/v3/download-grants",
		"/v1/tasks",
		"/v1/orders",
		"/v1/chat",
		"/v2/transactions",
		"/v4/gateway/listing/operation",
		"/v4/local/endpoints",
		"/ws",
	} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("%s returned %d, want 404", path, recorder.Code)
		}
	}
}

func TestDiscoveryIsAPIOnlyV4(t *testing.T) {
	manifest := discovery.BuildWithBaseURL("http://127.0.0.1:8080", "test-dock")
	if manifest.Endpoints["catalog"].Path != "/v4/catalog/operations" || manifest.Endpoints["invocation"].Path != "/v4/apis/{apiId}/operations/{operationId}/invocations" {
		t.Fatalf("unexpected V4 discovery endpoints: %#v", manifest.Endpoints)
	}
	for _, capability := range manifest.Capabilities {
		if capability.Name == "marketplace.vm.ssh" || capability.Name == "marketplace.resources.s3" {
			t.Fatalf("retired capability leaked into discovery: %s", capability.Name)
		}
	}
}

func TestPublicDiscoverySurfaceRemainsAvailable(t *testing.T) {
	manifest := discovery.BuildWithBaseURL("http://127.0.0.1:8080", "test-dock")
	handler := New(Options{Discovery: &manifest})
	for _, path := range []string{"/health", "/.well-known/exora-dock.json"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s returned %d, want 200", path, recorder.Code)
		}
	}
}
