package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/workrun"
	"github.com/go-chi/chi/v5"
)

func TestWorkRunEndpointsCreateResumeStop(t *testing.T) {
	c, err := cache.New(100, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "dock-test")
	router := chi.NewRouter()
	router.Post("/v1/work-runs", handler.CreateWorkRun)
	router.Post("/v1/work-runs/{id}/resume", handler.ResumeWorkRun)
	router.Post("/v1/work-runs/{id}/stop", handler.StopWorkRun)
	projectPath := t.TempDir()

	createBody := map[string]any{
		"workUid":     "work-api",
		"projectPath": projectPath,
		"controller":  workrun.ControllerExternalMCP,
		"intent":      "test task",
	}
	create := performJSON(http.MethodPost, "/v1/work-runs", createBody, router)
	if create.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", create.Code, create.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(create.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	run := created["workRun"].(map[string]any)
	runID := run["runId"].(string)
	if created["resumeJson"] == nil || runID == "" {
		t.Fatalf("create missing run/resume json: %#v", created)
	}

	resume := performJSON(http.MethodPost, "/v1/work-runs/"+runID+"/resume", map[string]any{
		"currentStep": "create_order_plan",
		"nextAction":  "choose_seller_option",
		"result": map[string]any{
			"orderPlan": map[string]any{"planId": "opln-api"},
		},
	}, router)
	if resume.Code != http.StatusAccepted {
		t.Fatalf("resume status = %d body=%s", resume.Code, resume.Body.String())
	}
	var resumed map[string]any
	if err := json.Unmarshal(resume.Body.Bytes(), &resumed); err != nil {
		t.Fatal(err)
	}
	checkpoint := resumed["checkpoint"].(map[string]any)
	known := checkpoint["knownEntities"].(map[string]any)
	if known["orderPlanId"] != "opln-api" {
		t.Fatalf("knownEntities = %#v", known)
	}

	stop := performJSON(http.MethodPost, "/v1/work-runs/"+runID+"/stop", map[string]any{"reason": "owner stop"}, router)
	if stop.Code != http.StatusOK {
		t.Fatalf("stop status = %d body=%s", stop.Code, stop.Body.String())
	}
}

func performJSON(method, path string, body map[string]any, handler http.Handler) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}
