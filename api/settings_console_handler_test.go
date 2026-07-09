package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/go-chi/chi/v5"
)

func TestLLMProfileSettingsNeverReturnAPIKey(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(cfgPath, []byte(`
buyer_llm:
  base_url: https://api.openai.com/v1
  provider_preset: openai_responses
  api_key: sk-buyer-secret
  model: gpt-5.5
seller_llm:
  base_url: https://api.openai.com/v1
  provider_preset: openai_responses
  api_key: sk-seller-secret
  model: gpt-5.5
seller_agent:
  enabled: true
  provider_pubkey: seller-1
provider:
  docker:
    enabled: true
`), 0600); err != nil {
		t.Fatal(err)
	}
	handler := newSettingsTestHandler(t, cfgPath, nil)
	router := chi.NewRouter()
	router.Get("/settings/llm-profiles", handler.ListLLMProfiles)
	router.Put("/settings/llm-profiles", handler.SaveLLMProfile)

	req := httptest.NewRequest(http.MethodGet, "/settings/llm-profiles", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", rec.Code, rec.Body.String())
	}
	if bytes.Contains(rec.Body.Bytes(), []byte("sk-buyer-secret")) || bytes.Contains(rec.Body.Bytes(), []byte("sk-seller-secret")) || bytes.Contains(rec.Body.Bytes(), []byte(`"apiKey":`)) {
		t.Fatalf("settings response leaked key material: %s", rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"hasApiKey":true`)) {
		t.Fatalf("settings response should expose hasApiKey only: %s", rec.Body.String())
	}

	body := []byte(`{"id":"buyer-llm","name":"Buyer API","useForBuyer":true,"providerPreset":"openai_responses","llmBaseUrl":"https://api.openai.com/v1","wireApi":"responses","researchModel":"gpt-5.5","utilityModel":"gpt-5.5","apiKey":"sk-new-buyer-secret"}`)
	req = httptest.NewRequest(http.MethodPut, "/settings/llm-profiles", bytes.NewReader(body))
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("save status=%d body=%s", rec.Code, rec.Body.String())
	}
	if bytes.Contains(rec.Body.Bytes(), []byte("sk-new-buyer-secret")) || bytes.Contains(rec.Body.Bytes(), []byte(`"apiKey":`)) {
		t.Fatalf("save response leaked key material: %s", rec.Body.String())
	}
	saved, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(saved, []byte("sk-new-buyer-secret")) {
		t.Fatalf("config did not persist write-only key: %s", string(saved))
	}
}

func TestConsoleSnapshotSideFilteringAndRedaction(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(cfgPath, []byte(`
seller_agent:
  enabled: true
  provider_pubkey: seller-1
seller_llm:
  api_key: sk-seller-secret
provider:
  docker:
    enabled: true
`), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	tasks := task.NewStore(c, filepath.Join(t.TempDir(), "artifacts"))
	buyerTask, err := tasks.Create(task.CreateRequest{RequesterPubkey: "buyer", AgentID: "agent", Type: "text", Goal: "buyer-only"})
	if err != nil {
		t.Fatal(err)
	}
	sellerTask, err := tasks.Create(task.CreateRequest{RequesterPubkey: "buyer", AgentID: "agent", Type: "text", Goal: "seller-owned"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tasks.Quote(sellerTask.ID, task.QuoteRequest{ProviderPubkey: "seller-1", PriceAmount: 1, Currency: "USDC"}); err != nil {
		t.Fatal(err)
	}

	handler := newSettingsTestHandler(t, cfgPath, tasks)
	router := chi.NewRouter()
	router.Get("/console/snapshot", handler.ConsoleSnapshot)

	seller := snapshotForTest(t, router, "/console/snapshot?side=seller")
	if len(seller.Tasks) != 1 || seller.Tasks[0].ID != sellerTask.ID {
		t.Fatalf("seller tasks = %#v", seller.Tasks)
	}
	buyer := snapshotForTest(t, router, "/console/snapshot?side=buyer")
	if len(buyer.Tasks) != 1 || buyer.Tasks[0].ID != buyerTask.ID {
		t.Fatalf("buyer tasks = %#v", buyer.Tasks)
	}
	if bytes.Contains(seller.Raw, []byte("sk-seller-secret")) || bytes.Contains(seller.Raw, []byte(`"apiKey":`)) {
		t.Fatalf("snapshot leaked key material: %s", string(seller.Raw))
	}
}

func newSettingsTestHandler(t *testing.T, cfgPath string, tasks *task.Store) *Handler {
	t.Helper()
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	return NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "dock-test", RuntimeStores{
		ConfigPath: cfgPath,
		Tasks:      tasks,
	})
}

type snapshotTestResponse struct {
	Raw   []byte
	Tasks []task.Task `json:"tasks"`
}

func snapshotForTest(t *testing.T, router http.Handler, path string) snapshotTestResponse {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("snapshot status=%d body=%s", rec.Code, rec.Body.String())
	}
	var out snapshotTestResponse
	out.Raw = rec.Body.Bytes()
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}
