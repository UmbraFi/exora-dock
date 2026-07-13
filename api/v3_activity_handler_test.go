package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/go-chi/chi/v5"
)

func TestV3ActivityHistoryProxyUsesDockIdentity(t *testing.T) {
	type observed struct{ path, query, auth string }
	requests := make([]observed, 0, 2)
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, observed{path: r.URL.Path, query: r.URL.RawQuery, auth: r.Header.Get("Authorization")})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}))
	defer cloud.Close()
	tokenPath := filepath.Join(t.TempDir(), "cloud-token.json")
	if err := cloudlink.SaveToken(tokenPath, cloudlink.TokenFile{DockID: "dock", CloudURL: cloud.URL, CloudToken: "dock-cloud-token"}); err != nil {
		t.Fatal(err)
	}
	h := NewHandler(nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, "dock", RuntimeStores{CloudURL: cloud.URL, CloudTokenPath: tokenPath})
	router := chi.NewRouter()
	router.Get("/v3/activity-sessions", h.V3ActivitySessions)
	router.Get("/v3/activity-sessions/{id}", h.V3ActivitySession)

	for _, path := range []string{"/v3/activity-sessions?role=buyer&kind=api_operation&limit=20", "/v3/activity-sessions/act_123"} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, recorder.Code, recorder.Body.String())
		}
	}
	if len(requests) != 2 {
		t.Fatalf("requests=%#v", requests)
	}
	if requests[0].path != "/v3/activity-sessions" || requests[0].query != "role=buyer&kind=api_operation&limit=20" {
		t.Fatalf("unexpected list request: %#v", requests[0])
	}
	if requests[1].path != "/v3/activity-sessions/act_123" {
		t.Fatalf("unexpected detail request: %#v", requests[1])
	}
	for _, request := range requests {
		if request.auth != "Bearer dock-cloud-token" {
			t.Fatalf("missing dock identity: %#v", request)
		}
	}
}
