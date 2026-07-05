package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/market"
	"github.com/exora-dock/exora-dock/internal/providerprotocol"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/exora-dock/exora-dock/internal/wallet"
	"github.com/go-chi/chi/v5"
)

func TestProviderQuoteRequestRequiresSignatureAndDockerPolicy(t *testing.T) {
	router, providerAddress, buyerWallet := newProviderProtocolTestRouter(t, true)
	req := signedQuoteRequest(t, buyerWallet, providerAddress, "python:3.12-alpine")

	body, _ := json.Marshal(req)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/provider/quote-requests", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("quote status=%d body=%s", rec.Code, rec.Body.String())
	}
	var reply providerprotocol.QuoteReply
	if err := json.Unmarshal(rec.Body.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	if reply.Status != "quoted" || reply.Signature == "" || reply.Docker.Image != "python:3.12-alpine" {
		t.Fatalf("reply = %#v", reply)
	}

	req.Signature = "bad-signature"
	body, _ = json.Marshal(req)
	bad := httptest.NewRecorder()
	router.ServeHTTP(bad, httptest.NewRequest(http.MethodPost, "/provider/quote-requests", bytes.NewReader(body)))
	if bad.Code != http.StatusUnauthorized {
		t.Fatalf("bad signature status=%d body=%s", bad.Code, bad.Body.String())
	}
}

func TestProviderQuoteRejectsDisallowedDockerImage(t *testing.T) {
	router, providerAddress, buyerWallet := newProviderProtocolTestRouter(t, true)
	req := signedQuoteRequest(t, buyerWallet, providerAddress, "ubuntu:latest")
	body, _ := json.Marshal(req)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/provider/quote-requests", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("quote status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "not allowed") {
		t.Fatalf("expected docker policy rejection, body=%s", rec.Body.String())
	}
}

func newProviderProtocolTestRouter(t *testing.T, dockerEnabled bool) (*chi.Mux, string, *wallet.Store) {
	t.Helper()
	dir := t.TempDir()
	c, err := cache.New(128, filepath.Join(dir, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	providerWallet := wallet.NewStore(filepath.Join(dir, "provider-wallet"))
	providerStatus, err := providerWallet.Create(wallet.CreateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	buyerWallet := wallet.NewStore(filepath.Join(dir, "buyer-wallet"))
	if _, err := buyerWallet.Create(wallet.CreateRequest{}); err != nil {
		t.Fatal(err)
	}
	resources := resource.NewStore(c)
	if err := resources.Save(resource.Resource{
		ID:             "gpu-1",
		Name:           "Docker GPU",
		Type:           resource.TypeGPU,
		ProviderPubkey: providerStatus.Address,
		PricePerUnit:   1.5,
		BillingUnit:    resource.BillingHour,
		Availability:   "available",
		Spec:           resource.Spec{Runtime: "docker", VRAMGB: 24, GPUCount: 1},
		UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	executor := task.NewExecutor(task.ExecutorConfig{
		WorkspaceDir: filepath.Join(dir, "jobs"),
		Docker: task.DockerExecutorConfig{
			Enabled:             dockerEnabled,
			DefaultImage:        "python:3.12-alpine",
			AllowedImages:       []string{"python:3.12-alpine"},
			NetworkMode:         "none",
			AllowedNetworkModes: []string{"none"},
			PullPolicy:          "missing",
		},
	})
	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, resources, nil, nil, providerStatus.Address, RuntimeStores{
		Wallet:       providerWallet,
		Tasks:        task.NewStore(c, filepath.Join(dir, "artifacts")),
		TaskExecutor: executor,
	})
	router := chi.NewRouter()
	router.Post("/provider/quote-requests", handler.CreateProviderQuoteRequest)
	router.Post("/v1/provider/quote-requests", handler.CreateProviderQuoteRequest)
	return router, providerStatus.Address, buyerWallet
}

func signedQuoteRequest(t *testing.T, buyerWallet *wallet.Store, providerAddress string, image string) providerprotocol.QuoteRequest {
	t.Helper()
	buyerStatus, err := buyerWallet.Current()
	if err != nil {
		t.Fatal(err)
	}
	req := providerprotocol.QuoteRequest{
		RequestID:       "qreq-test",
		RequesterPubkey: buyerStatus.Address,
		AgentID:         "test-agent",
		ProviderPubkey:  providerAddress,
		ResourceID:      "gpu-1",
		Draft: market.OrderDraft{
			RequesterPubkey: buyerStatus.Address,
			AgentID:         "test-agent",
			Type:            "compute.gpu",
			Goal:            "run docker job",
			Requirements: map[string]any{
				"docker": map[string]any{"image": image, "command": "python", "args": []string{"-V"}},
			},
			ConsentPolicy: task.ConsentPolicy{RequireHumanApproval: true},
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	payload, err := providerprotocol.QuoteRequestPayload(req)
	if err != nil {
		t.Fatal(err)
	}
	_, sig, err := buyerWallet.SignPayload(payload)
	if err != nil {
		t.Fatal(err)
	}
	req.Signature = sig
	return req
}
