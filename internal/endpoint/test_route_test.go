package endpoint

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRouteSmokeTestUsesDeclaredMethodPathBodyAndCredential(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/items/42" || r.URL.Query().Get("dry") != "true" {
			t.Errorf("unexpected request target: %s %s", r.Method, r.URL.String())
		}
		if r.Header.Get("X-Upstream-Key") != "secret" {
			t.Errorf("credential was not injected")
		}
		body := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"received":%q}`, string(body))
	}))
	defer server.Close()

	route := Route{OperationID: "create", Method: "POST", Path: "/items/{id}"}
	result := TestRoute(context.Background(), RouteTestInput{
		Config: Config{LocalBaseURL: server.URL, Routes: []Route{route}, TimeoutSeconds: 5},
		Route:  route, TestPath: "/items/42", RawQuery: "dry=true", ContentType: "application/json", Body: `{"name":"demo"}`,
		AuthType: "api_key", APIKeyHeader: "X-Upstream-Key", Secret: "secret",
	})
	if !result.OK || result.Status != http.StatusOK || !strings.Contains(result.Preview, "demo") {
		t.Fatalf("unexpected route test result: %+v", result)
	}
}

func TestRouteSmokeTestRejectsUndeclaredAndUnsafeInputs(t *testing.T) {
	route := Route{OperationID: "read", Method: "GET", Path: "/items/{id}"}
	base := RouteTestInput{Config: Config{LocalBaseURL: "http://127.0.0.1:1", Routes: []Route{route}}, Route: route, TestPath: "/items/42"}

	undeclared := base
	undeclared.Route.OperationID = "other"
	if result := TestRoute(context.Background(), undeclared); result.Error == "" {
		t.Fatal("undeclared route was accepted")
	}
	encodedSlash := base
	encodedSlash.TestPath = "/items/a%2Fb"
	if result := TestRoute(context.Background(), encodedSlash); result.Error == "" {
		t.Fatal("encoded path separator was accepted as one template segment")
	}
	oversized := base
	oversized.Body = strings.Repeat("x", maxRouteTestBody+1)
	if result := TestRoute(context.Background(), oversized); !strings.Contains(result.Error, "exceeds") {
		t.Fatalf("oversized body was not rejected: %+v", result)
	}
	public := base
	public.LocalBaseURL = "https://example.com"
	if result := TestRoute(context.Background(), public); result.Error == "" {
		t.Fatal("public route target was accepted")
	}
}

func TestRouteSmokeTestBoundsSSEPreview(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		for index := 0; index < 20; index++ {
			_, _ = fmt.Fprintf(w, "event: message\ndata: %d\n\n", index)
			flusher.Flush()
		}
	}))
	defer server.Close()
	route := Route{OperationID: "events", Method: "GET", Path: "/events"}
	result := TestRoute(context.Background(), RouteTestInput{Config: Config{LocalBaseURL: server.URL, Routes: []Route{route}, TimeoutSeconds: 5}, Route: route, TestPath: "/events"})
	if !result.OK || len(result.SSEEvents) != 10 || !result.Truncated || result.StreamEndStatus != "preview_limit" || result.FirstEventLatencyMS < 0 {
		t.Fatalf("SSE limits were not applied: %+v", result)
	}
}

func TestRouteSmokeTestRecognizesOpenAIDoneEvent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"delta\":\"hello\"}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	route := Route{OperationID: "chat", Method: "GET", Path: "/chat"}
	result := TestRoute(context.Background(), RouteTestInput{Config: Config{LocalBaseURL: server.URL, Routes: []Route{route}, TimeoutSeconds: 5}, Route: route, TestPath: "/chat"})
	if !result.OK || len(result.SSEEvents) != 2 || result.StreamEndStatus != "done" || result.Truncated {
		t.Fatalf("OpenAI SSE completion was not reported: %+v", result)
	}
}
