package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/exora-dock/exora-dock/internal/agentcard"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/samplemarket"
	"github.com/go-chi/chi/v5"
)

func TestMarketRailCardsEndpointReturnsSixCards(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })

	cards := agentcard.NewStore(c)
	if err := samplemarket.Seed(nil, cards, "dock-test", "provider-test"); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "dock-test", RuntimeStores{
		AgentCards: cards,
	})
	router := chi.NewRouter()
	router.Get("/market/rail-cards", handler.MarketRailCards)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/market/rail-cards", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body samplemarket.RailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Cards) != 6 {
		t.Fatalf("cards=%d body=%s", len(body.Cards), rec.Body.String())
	}
	if body.BuyerSettings.RiskBoundary == "" || body.BuyerSettings.AuthorizationStrategy == "" {
		t.Fatalf("buyer settings missing policy fields: %#v", body.BuyerSettings)
	}
}
