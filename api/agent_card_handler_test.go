package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/agentcard"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/go-chi/chi/v5"
)

func TestAgentCardDraftSaveAndPublishValidation(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	cards := agentcard.NewStore(c)
	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "dock-test", RuntimeStores{
		AgentCards: cards,
		CardDiagnostics: agentcard.DiagnosticsConfig{
			LLMProvider:   "https://api.openai.com/v1",
			LLMConfigured: true,
			MCPAvailable:  true,
		},
	})
	router := chi.NewRouter()
	router.Post("/agent-cards/draft", handler.DraftAgentCard)
	router.Put("/agent-cards/{role}", handler.SaveAgentCard)
	router.Post("/agent-cards/{role}/publish", handler.PublishAgentCard)

	req := httptest.NewRequest(http.MethodPost, "/agent-cards/draft", bytes.NewReader([]byte(`{"role":"buyer"}`)))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("draft status=%d body=%s", rec.Code, rec.Body.String())
	}
	var draft struct {
		Card agentcard.AgentCard `json:"card"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &draft); err != nil {
		t.Fatal(err)
	}
	draft.Card.ManualFields.Buyer.Budget = "80 USDC / task"
	draft.Card.ManualFields.Buyer.RiskBoundary = "Low-risk compute only."
	body, _ := json.Marshal(agentcard.SaveRequest{Card: draft.Card})
	req = httptest.NewRequest(http.MethodPut, "/agent-cards/buyer", bytes.NewReader(body))
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("save status=%d body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/agent-cards/buyer/publish", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("publish without cloud link should conflict, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAgentCardPublishPropagatesCloudReviewRejection(t *testing.T) {
	handler, cards := agentCardPublishHandler(t, http.StatusUnprocessableEntity, map[string]any{
		"error": "agent card rejected by review",
		"review": map[string]any{
			"status":     "rejected",
			"categories": []string{"controlled_substances"},
			"reason":     "prohibited content",
			"source":     "rules",
			"reviewedAt": time.Now().UTC().Format(time.RFC3339),
		},
	})
	router := chi.NewRouter()
	router.Post("/agent-cards/{role}/publish", handler.PublishAgentCard)
	req := httptest.NewRequest(http.MethodPost, "/agent-cards/seller/publish", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Review agentcard.ReviewResult `json:"review"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Review.Status != agentcard.ReviewStatusRejected || body.Review.Categories[0] != "controlled_substances" {
		t.Fatalf("review = %#v", body.Review)
	}
	stored, _ := cards.Get(agentcard.RoleSeller)
	if stored.Status == agentcard.StatusPublished {
		t.Fatalf("rejected publish should not mark local card published: %#v", stored)
	}
}

func TestAgentCardPublishPropagatesCloudPendingReview(t *testing.T) {
	handler, cards := agentCardPublishHandler(t, http.StatusAccepted, map[string]any{
		"error": "agent card pending review",
		"review": map[string]any{
			"status":     "pending_review",
			"reason":     "manual review required",
			"source":     "llm",
			"reviewedAt": time.Now().UTC().Format(time.RFC3339),
		},
	})
	router := chi.NewRouter()
	router.Post("/agent-cards/{role}/publish", handler.PublishAgentCard)
	req := httptest.NewRequest(http.MethodPost, "/agent-cards/seller/publish", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Review agentcard.ReviewResult `json:"review"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Review.Status != agentcard.ReviewStatusPending {
		t.Fatalf("review = %#v", body.Review)
	}
	stored, _ := cards.Get(agentcard.RoleSeller)
	if stored.Status == agentcard.StatusPublished {
		t.Fatalf("pending publish should not mark local card published: %#v", stored)
	}
}

func TestAgentCardPublishStoresApprovedCloudReview(t *testing.T) {
	handler, cards := agentCardPublishHandler(t, http.StatusOK, map[string]any{
		"card": map[string]any{
			"review": map[string]any{
				"status":     "approved",
				"reason":     "ok",
				"source":     "rules",
				"reviewedAt": time.Now().UTC().Format(time.RFC3339),
			},
		},
	})
	router := chi.NewRouter()
	router.Post("/agent-cards/{role}/publish", handler.PublishAgentCard)
	req := httptest.NewRequest(http.MethodPost, "/agent-cards/seller/publish", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	stored, _ := cards.Get(agentcard.RoleSeller)
	if stored.Status != agentcard.StatusPublished || stored.Review == nil || stored.Review.Status != agentcard.ReviewStatusApproved {
		t.Fatalf("approved publish should save published card with review: %#v", stored)
	}
}

func agentCardPublishHandler(t *testing.T, cloudStatus int, cloudBody map[string]any) (*Handler, *agentcard.Store) {
	t.Helper()
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	cards := agentcard.NewStore(c)
	if err := cards.Save(validSellerAgentCard(t)); err != nil {
		t.Fatal(err)
	}
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/v1/docks/dock-test/agent-cards/seller" {
			t.Fatalf("unexpected cloud request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer cloud-token" {
			t.Fatalf("missing cloud token: %s", r.Header.Get("Authorization"))
		}
		writeJSON(w, cloudStatus, cloudBody)
	}))
	t.Cleanup(cloud.Close)
	tokenPath := filepath.Join(t.TempDir(), "cloud-token.json")
	if err := cloudlink.SaveToken(tokenPath, cloudlink.TokenFile{DockID: "dock-test", CloudURL: cloud.URL, CloudToken: "cloud-token"}); err != nil {
		t.Fatal(err)
	}
	return NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "dock-test", RuntimeStores{
		AgentCards: cards,
		CardPublisher: agentcard.CloudPublisher{
			CloudURL:  cloud.URL,
			TokenPath: tokenPath,
			DockID:    "dock-test",
		},
	}), cards
}

func validSellerAgentCard(t *testing.T) agentcard.AgentCard {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339)
	card, err := agentcard.NewDraft(agentcard.DraftRequest{
		Role:   agentcard.RoleSeller,
		DockID: "dock-test",
		Diagnostics: agentcard.Diagnostics{
			CollectedAt:        now,
			ExpiresAt:          now,
			DockerAvailable:    true,
			DiagnosticsVersion: "test",
		},
		Seller: agentcard.SellerManualFields{
			DisplayName:       "GPU Provider",
			CapabilitySummary: "48GB GPU inference runs",
			Pricing:           "10 USDC per job",
			Availability:      "weekdays",
			HumanConfirmation: "owner confirms risky tasks",
			DataBoundary:      "task scoped",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return card
}
