package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/exora-dock/exora-dock/internal/discovery"
)

func TestAgentSessionRemoteAddressMustBeLoopback(t *testing.T) {
	for address, want := range map[string]bool{"127.0.0.1:5000": true, "[::1]:5000": true, "192.0.2.10:5000": false, "invalid": false} {
		request := httptest.NewRequest(http.MethodGet, "/v3/catalog/listings", nil)
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
		"/v1/tasks",
		"/v1/orders",
		"/v1/chat",
		"/v2/transactions",
		"/ws",
	} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("%s returned %d, want 404", path, recorder.Code)
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
