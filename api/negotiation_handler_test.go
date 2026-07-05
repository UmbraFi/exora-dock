package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/market"
	"github.com/exora-dock/exora-dock/internal/negotiation"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/exora-dock/exora-dock/internal/wallet"
	"github.com/go-chi/chi/v5"
)

func TestNegotiationFlowStoresPendingThenResumesSignedQuote(t *testing.T) {
	dir := t.TempDir()
	providerCache, err := cache.New(128, filepath.Join(dir, "provider-cache"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { providerCache.Close() })
	providerWallet := wallet.NewStore(filepath.Join(dir, "provider-wallet"))
	providerStatus, err := providerWallet.Create(wallet.CreateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	providerNegotiations := negotiation.NewStore(providerCache)
	providerResources := resource.NewStore(providerCache)
	if err := providerResources.Save(resource.Resource{
		ID:             "gpu-1",
		Name:           "Docker GPU",
		Type:           resource.TypeGPU,
		ProviderPubkey: providerStatus.Address,
		PricePerUnit:   2,
		BillingUnit:    resource.BillingHour,
		Availability:   "available",
		Spec:           resource.Spec{Runtime: "docker", VRAMGB: 24, GPUCount: 1},
		UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	providerExecutor := task.NewExecutor(task.ExecutorConfig{
		WorkspaceDir: filepath.Join(dir, "provider-jobs"),
		Docker: task.DockerExecutorConfig{
			Enabled:             true,
			DefaultImage:        "python:3.12-alpine",
			AllowedImages:       []string{"python:3.12-alpine"},
			NetworkMode:         "none",
			AllowedNetworkModes: []string{"none"},
		},
	})
	providerHandler := NewHandler(providerCache, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, providerResources, nil, nil, providerStatus.Address, RuntimeStores{
		Wallet:       providerWallet,
		Negotiations: providerNegotiations,
		TaskExecutor: providerExecutor,
	})
	providerRouter := chi.NewRouter()
	providerRouter.Post("/v1/provider/negotiations", providerHandler.CreateProviderNegotiation)
	providerRouter.Get("/v1/provider/negotiations/{id}", providerHandler.GetProviderNegotiation)
	providerServer := httptest.NewServer(providerRouter)
	defer providerServer.Close()

	buyerCache, err := cache.New(128, filepath.Join(dir, "buyer-cache"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { buyerCache.Close() })
	buyerWallet := wallet.NewStore(filepath.Join(dir, "buyer-wallet"))
	if _, err := buyerWallet.Create(wallet.CreateRequest{}); err != nil {
		t.Fatal(err)
	}
	buyerNegotiations := negotiation.NewStore(buyerCache)
	buyerHandler := NewHandler(buyerCache, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "buyer", RuntimeStores{
		Wallet:       buyerWallet,
		Negotiations: buyerNegotiations,
	})
	buyerRouter := chi.NewRouter()
	buyerRouter.Post("/v1/negotiations", buyerHandler.CreateNegotiations)
	buyerRouter.Post("/v1/negotiations/{id}/resume", buyerHandler.ResumeNegotiation)

	body, _ := json.Marshal(createNegotiationsRequest{
		Intent:           "run docker job",
		ProviderPubkey:   providerStatus.Address,
		ResourceID:       "gpu-1",
		ProviderEndpoint: providerServer.URL,
		Draft: market.OrderDraft{
			Type: "compute.gpu",
			Goal: "run docker job",
			Requirements: map[string]any{
				"docker": map[string]any{"image": "python:3.12-alpine", "command": "python", "args": []string{"-V"}},
			},
			ConsentPolicy: task.ConsentPolicy{RequireHumanApproval: true},
		},
	})
	rec := httptest.NewRecorder()
	buyerRouter.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/negotiations", bytes.NewReader(body)))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		Negotiations []negotiation.Negotiation `json:"negotiations"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if len(created.Negotiations) != 1 || created.Negotiations[0].Status != negotiation.StatusPendingSellerDecision {
		t.Fatalf("created = %#v", created.Negotiations)
	}
	negotiationID := created.Negotiations[0].ID
	if _, err := providerNegotiations.MarkQuoted(negotiationID, negotiation.QuoteRequest{
		ProviderPubkey:       providerStatus.Address,
		ResourceID:           "gpu-1",
		PriceAmount:          3.5,
		Currency:             "USD",
		EstimatedSeconds:     120,
		ExecutionPlanSummary: "Run the Docker job and return artifacts.",
		DeliveryFormat:       "artifact manifest",
	}); err != nil {
		t.Fatal(err)
	}

	resume := httptest.NewRecorder()
	buyerRouter.ServeHTTP(resume, httptest.NewRequest(http.MethodPost, "/v1/negotiations/"+negotiationID+"/resume", nil))
	if resume.Code != http.StatusOK {
		t.Fatalf("resume status=%d body=%s", resume.Code, resume.Body.String())
	}
	var resumed struct {
		Negotiation negotiation.Negotiation `json:"negotiation"`
	}
	if err := json.Unmarshal(resume.Body.Bytes(), &resumed); err != nil {
		t.Fatal(err)
	}
	if resumed.Negotiation.Status != negotiation.StatusQuoted || resumed.Negotiation.Quote == nil || resumed.Negotiation.Quote.Signature == "" {
		t.Fatalf("resumed negotiation = %#v", resumed.Negotiation)
	}
}
