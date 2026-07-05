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
	"github.com/exora-dock/exora-dock/internal/market"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestSearchSellersEndpointUsesMarketSearch(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	resources := resource.NewStore(c)
	if err := resources.Save(resource.Resource{
		ID:             "res-1",
		Name:           "A100 Worker",
		Type:           resource.TypeGPU,
		ProviderPubkey: "provider-1",
		Availability:   "available",
		QualityScore:   90,
		Reputation:     90,
		Spec:           resource.Spec{VRAMGB: 40, GPUModel: "A100"},
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, resources, nil, nil, "local-dev-miner")
	router := chi.NewRouter()
	router.Post("/agent/search-sellers", handler.SearchSellers)

	req := httptest.NewRequest(http.MethodPost, "/agent/search-sellers", bytes.NewReader([]byte(`{"query":"帮我找 20G 显存以上服务器"}`)))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body market.SearchResult
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.NormalizedQuery.Type != resource.TypeGPU || body.NormalizedQuery.MinVRAMGB != 20 {
		t.Fatalf("normalized = %#v", body.NormalizedQuery)
	}
	if len(body.Candidates) != 1 || body.Candidates[0].ProviderPubkey != "provider-1" {
		t.Fatalf("candidates = %#v", body.Candidates)
	}
}
