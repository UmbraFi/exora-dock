package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/exora-dock/exora-dock/internal/wallet"
	"github.com/go-chi/chi/v5"
)

func TestWalletHandlersCreateAndShowAccountWallet(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	defer c.Close()

	wallets := wallet.NewStore(t.TempDir())
	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "local-dev-miner", RuntimeStores{Wallet: wallets})
	router := chi.NewRouter()
	router.Get("/wallet", handler.GetWallet)
	router.Post("/wallet/create", handler.CreateWallet)

	createReq := httptest.NewRequest(http.MethodPost, "/wallet/create", nil)
	createRec := httptest.NewRecorder()
	router.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body = %s", createRec.Code, createRec.Body.String())
	}
	if !strings.Contains(createRec.Body.String(), `"localKeypair":true`) {
		t.Fatalf("create body = %s", createRec.Body.String())
	}

	showReq := httptest.NewRequest(http.MethodGet, "/wallet", nil)
	showRec := httptest.NewRecorder()
	router.ServeHTTP(showRec, showReq)
	if showRec.Code != http.StatusOK || !strings.Contains(showRec.Body.String(), `"accountBound":true`) {
		t.Fatalf("show status/body = %d %s", showRec.Code, showRec.Body.String())
	}
}

func TestTaskHandlersRemoteJobFlow(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	defer c.Close()

	tasks := task.NewStore(c, t.TempDir())
	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "local-dev-miner", RuntimeStores{Tasks: tasks})
	router := chi.NewRouter()
	router.Post("/tasks", handler.CreateTask)
	router.Get("/tasks/{id}", handler.GetTask)
	router.Post("/tasks/{id}/quote", handler.QuoteTask)
	router.Post("/tasks/{id}/consent", handler.ConsentTask)
	router.Get("/provider/tasks/next", handler.NextProviderTask)
	router.Post("/provider/tasks/{id}/claim", handler.ClaimTask)
	router.Post("/provider/tasks/{id}/complete", handler.CompleteTask)
	router.Get("/tasks/{id}/artifacts", handler.GetTaskArtifactManifest)
	router.Get("/tasks/{id}/artifacts/{name}", handler.GetTaskArtifact)

	createBody := []byte(`{
		"requesterPubkey":"user-1",
		"agentId":"agent-alpha",
		"type":"compute.inference",
		"goal":"Run inference over a prompt batch",
		"requirements":{"gpu_vram":">=40GB"},
		"budget":{"maxAmount":8,"currency":"USD"},
		"expectedOutputs":["results.json"]
	}`)
	createReq := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewReader(createBody))
	createRec := httptest.NewRecorder()
	router.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body = %s", createRec.Code, createRec.Body.String())
	}
	var createResp struct {
		Task task.Task `json:"task"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("create json error = %v", err)
	}

	quoteReq := httptest.NewRequest(http.MethodPost, "/tasks/"+createResp.Task.ID+"/quote", bytes.NewReader([]byte(`{"providerPubkey":"provider-1","priceAmount":2.5,"currency":"USD","estimatedSeconds":60}`)))
	quoteRec := httptest.NewRecorder()
	router.ServeHTTP(quoteRec, quoteReq)
	if quoteRec.Code != http.StatusOK {
		t.Fatalf("quote status = %d body = %s", quoteRec.Code, quoteRec.Body.String())
	}

	consentReq := httptest.NewRequest(http.MethodPost, "/tasks/"+createResp.Task.ID+"/consent", bytes.NewReader([]byte(`{"approved":true}`)))
	consentRec := httptest.NewRecorder()
	router.ServeHTTP(consentRec, consentReq)
	if consentRec.Code != http.StatusOK {
		t.Fatalf("consent status = %d body = %s", consentRec.Code, consentRec.Body.String())
	}

	nextReq := httptest.NewRequest(http.MethodGet, "/provider/tasks/next?providerPubkey=provider-1", nil)
	nextRec := httptest.NewRecorder()
	router.ServeHTTP(nextRec, nextReq)
	if nextRec.Code != http.StatusOK || !strings.Contains(nextRec.Body.String(), createResp.Task.ID) {
		t.Fatalf("next status/body = %d %s", nextRec.Code, nextRec.Body.String())
	}

	claimReq := httptest.NewRequest(http.MethodPost, "/provider/tasks/"+createResp.Task.ID+"/claim", bytes.NewReader([]byte(`{"providerPubkey":"provider-1"}`)))
	claimRec := httptest.NewRecorder()
	router.ServeHTTP(claimRec, claimReq)
	if claimRec.Code != http.StatusOK {
		t.Fatalf("claim status = %d body = %s", claimRec.Code, claimRec.Body.String())
	}

	completeBody := []byte(`{"providerPubkey":"provider-1","artifacts":[{"name":"results.json","content":"{\"ok\":true}","encoding":"text","contentType":"application/json"}]}`)
	completeReq := httptest.NewRequest(http.MethodPost, "/provider/tasks/"+createResp.Task.ID+"/complete", bytes.NewReader(completeBody))
	completeRec := httptest.NewRecorder()
	router.ServeHTTP(completeRec, completeReq)
	if completeRec.Code != http.StatusOK || !strings.Contains(completeRec.Body.String(), string(task.StatusCompleted)) {
		t.Fatalf("complete status/body = %d %s", completeRec.Code, completeRec.Body.String())
	}
	if !strings.Contains(completeRec.Body.String(), `"sha256"`) {
		t.Fatalf("complete body missing artifact hash = %s", completeRec.Body.String())
	}

	manifestReq := httptest.NewRequest(http.MethodGet, "/tasks/"+createResp.Task.ID+"/artifacts", nil)
	manifestRec := httptest.NewRecorder()
	router.ServeHTTP(manifestRec, manifestReq)
	if manifestRec.Code != http.StatusOK || !strings.Contains(manifestRec.Body.String(), `"sha256"`) || !strings.Contains(manifestRec.Body.String(), "results.json") {
		t.Fatalf("artifact manifest status/body = %d %s", manifestRec.Code, manifestRec.Body.String())
	}

	artifactReq := httptest.NewRequest(http.MethodGet, "/tasks/"+createResp.Task.ID+"/artifacts/results.json", nil)
	artifactRec := httptest.NewRecorder()
	router.ServeHTTP(artifactRec, artifactReq)
	if artifactRec.Code != http.StatusOK || !strings.Contains(artifactRec.Body.String(), `"ok":true`) {
		t.Fatalf("artifact status/body = %d %s", artifactRec.Code, artifactRec.Body.String())
	}
}
