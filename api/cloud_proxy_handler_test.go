package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/go-chi/chi/v5"
)

func TestNarrowCloudOwnerProxyMappingsUseDockTokenAndRedact(t *testing.T) {
	type observed struct {
		Method string
		Path   string
		Query  string
		Auth   string
		Body   map[string]any
	}
	var mu sync.Mutex
	requests := []observed{}
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entry := observed{Method: r.Method, Path: r.URL.Path, Query: r.URL.RawQuery, Auth: r.Header.Get("Authorization")}
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&entry.Body)
		}
		mu.Lock()
		requests = append(requests, entry)
		mu.Unlock()
		writeJSON(w, http.StatusCreated, map[string]any{
			"ok": true, "envelope": map[string]any{"cloudToken": "must-not-leak", "id": "safe"},
		})
	}))
	defer cloud.Close()

	tokenPath := filepath.Join(t.TempDir(), "cloud-token.json")
	if err := cloudlink.SaveToken(tokenPath, cloudlink.TokenFile{DockID: "dock", CloudURL: cloud.URL, CloudToken: "dock-cloud-token"}); err != nil {
		t.Fatal(err)
	}
	h := NewHandler(nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, "dock", RuntimeStores{CloudURL: cloud.URL, CloudTokenPath: tokenPath})
	router := chi.NewRouter()
	router.Get("/v1/cloud/transactions", h.ListCloudTransactions)
	router.Post("/v1/cloud/transactions", h.CreateCloudTransaction)
	router.Get("/v1/cloud/inbox", h.GetCloudInbox)
	router.Get("/v1/cloud/agent-cards", h.ListCloudAgentCards)
	router.Post("/v1/cloud/human-requests/{id}/respond", h.RespondCloudHumanRequest)

	cases := []struct {
		method, path, body string
	}{
		{http.MethodGet, "/v1/cloud/transactions?status=open", ""},
		{http.MethodPost, "/v1/cloud/transactions", `{"kind":"order","paymentPin":"123456"}`},
		{http.MethodGet, "/v1/cloud/inbox?cursor=next", ""},
		{http.MethodGet, "/v1/cloud/agent-cards?query=gpu&ignored=no", ""},
		{http.MethodPost, "/v1/cloud/human-requests/hr-1/respond", `{"answer":"yes","ownerToken":"local-secret"}`},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated || strings.Contains(rec.Body.String(), "must-not-leak") {
			t.Fatalf("%s %s status=%d body=%s", tc.method, tc.path, rec.Code, rec.Body.String())
		}
	}

	mu.Lock()
	defer mu.Unlock()
	wantPaths := []string{"/v2/transactions", "/v2/transactions", "/v2/inbox", "/v2/agent-cards", "/v2/human-requests/hr-1/respond"}
	if len(requests) != len(wantPaths) {
		t.Fatalf("requests=%#v", requests)
	}
	for i, request := range requests {
		if request.Path != wantPaths[i] || request.Auth != "Bearer dock-cloud-token" {
			t.Fatalf("request %d = %#v", i, request)
		}
	}
	if requests[3].Query != "query=gpu" {
		t.Fatalf("agent-card query = %q", requests[3].Query)
	}
	if requests[1].Body["paymentPin"] != "[redacted]" || requests[4].Body["ownerToken"] != "[redacted]" {
		t.Fatalf("sensitive request fields were not filtered: %#v %#v", requests[1].Body, requests[4].Body)
	}
}
