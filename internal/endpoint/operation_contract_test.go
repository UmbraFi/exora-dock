package endpoint

import (
	"context"
	"net/http"
	"testing"
)

func TestRouteTemplatesMatchEncodedSegmentsAndRejectAmbiguity(t *testing.T) {
	routes := []Route{{OperationID: "user", Method: "GET", Path: "/users/{userId}"}}
	if !routeAllowed(routes, "get", "/users/alice%20smith") {
		t.Fatal("encoded path parameter did not match")
	}
	if routeAllowed(routes, "GET", "/users/a/b") || routeAllowed(routes, "GET", "/users/%2F") {
		t.Fatal("path parameter escaped its encoded segment boundary")
	}
	if err := validateRouteConflicts([]Route{{Method: "GET", Path: "/users/{id}"}, {Method: "GET", Path: "/users/{name}"}}); err == nil {
		t.Fatal("ambiguous templates were accepted")
	}
	if err := validateRouteConflicts([]Route{{Method: "GET", Path: "/users/me"}, {Method: "GET", Path: "/users/{id}"}}); err != nil {
		t.Fatalf("static route should have priority over a template: %v", err)
	}
}

func TestAPIKeyAuthenticationLocations(t *testing.T) {
	for _, test := range []struct{ authType, name string }{{"header_api_key", "X-Key"}, {"query_api_key", "key"}, {"cookie_api_key", "key"}} {
		request, _ := http.NewRequest(http.MethodGet, "https://service.example/infer", nil)
		if _, err := applyRequestCredential(context.Background(), request, test.authType, test.name, "secret"); err != nil {
			t.Fatal(err)
		}
		switch test.authType {
		case "header_api_key":
			if request.Header.Get(test.name) != "secret" {
				t.Fatal("header API key missing")
			}
		case "query_api_key":
			if request.URL.Query().Get(test.name) != "secret" {
				t.Fatal("query API key missing")
			}
		case "cookie_api_key":
			cookie, err := request.Cookie(test.name)
			if err != nil || cookie.Value != "secret" {
				t.Fatal("cookie API key missing")
			}
		}
	}
}

func TestServiceManifestRejectsOldFieldsAndWebhooks(t *testing.T) {
	legacy := endpointTestManifest()
	legacy["routes"] = []any{}
	if _, _, _, err := ValidateServiceManifest(legacy); err == nil {
		t.Fatal("legacy routes mirror was accepted")
	}
	manifest := endpointTestManifest()
	manifest["interface"].(map[string]any)["webhooks"] = map[string]any{"event": map[string]any{}}
	if _, _, _, err := ValidateServiceManifest(manifest); err == nil {
		t.Fatal("OpenAPI webhook was accepted")
	}
}
