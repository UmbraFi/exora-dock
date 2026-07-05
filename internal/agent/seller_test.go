package agent

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/market"
	"github.com/exora-dock/exora-dock/internal/negotiation"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/exora-dock/exora-dock/internal/task"
)

func TestSellerAgentAutoQuotesPendingTask(t *testing.T) {
	store, cleanup := newSellerTestTaskStore(t)
	defer cleanup()
	ts := fakeSellerLLM(t, `{"priceAmount":1.25,"currency":"USD","estimatedSeconds":90,"notes":"Ready to help."}`)
	defer ts.Close()

	created := createSellerTestTask(t, store, "text.summary")
	agent := NewSellerAgent(SellerAgentConfig{
		Enabled:              true,
		AutoQuote:            true,
		ProviderPubkey:       "provider-1",
		LLMBaseURL:           ts.URL,
		LLMAPIKey:            "test-key",
		LLMModel:             "test-model",
		DefaultQuoteCurrency: "USD",
		DefaultEstimatedSec:  60,
		PollInterval:         time.Millisecond,
	}, store)

	agent.Tick(context.Background())

	updated, ok := store.Get(created.ID)
	if !ok {
		t.Fatalf("task disappeared")
	}
	if updated.Status != task.StatusPendingConsent || updated.Quote == nil {
		t.Fatalf("task status/quote = %s %#v", updated.Status, updated.Quote)
	}
	if updated.Quote.ProviderPubkey != "provider-1" || updated.Quote.PriceAmount != 1.25 || updated.Quote.EstimatedSeconds != 90 {
		t.Fatalf("quote = %#v", updated.Quote)
	}
}

func TestSellerAgentChatCompletionsAutoQuotesPendingTask(t *testing.T) {
	store, cleanup := newSellerTestTaskStore(t)
	defer cleanup()
	ts := fakeSellerLLM(t, `{"priceAmount":1.25,"currency":"USD","estimatedSeconds":90,"notes":"Ready to help."}`)
	defer ts.Close()

	created := createSellerTestTask(t, store, "text.summary")
	agent := NewSellerAgent(SellerAgentConfig{
		Enabled:              true,
		AutoQuote:            true,
		ProviderPubkey:       "provider-1",
		LLMBaseURL:           ts.URL + "/v1",
		LLMAPIKey:            "test-key",
		LLMWireAPI:           LLMWireChatCompletions,
		LLMUtilityModel:      "utility-model",
		DefaultQuoteCurrency: "USD",
		DefaultEstimatedSec:  60,
		PollInterval:         time.Millisecond,
	}, store)

	agent.Tick(context.Background())

	updated, ok := store.Get(created.ID)
	if !ok {
		t.Fatalf("task disappeared")
	}
	if updated.Status != task.StatusPendingConsent || updated.Quote == nil {
		t.Fatalf("task status/quote = %s %#v", updated.Status, updated.Quote)
	}
}

func TestSellerAgentCompletesConsentedTextTask(t *testing.T) {
	store, cleanup := newSellerTestTaskStore(t)
	defer cleanup()
	ts := fakeSellerLLM(t, "")
	defer ts.Close()

	created := createSellerTestTask(t, store, "text.summary")
	quoted, err := store.Quote(created.ID, task.QuoteRequest{
		ProviderPubkey:   "provider-1",
		PriceAmount:      0,
		Currency:         "USD",
		EstimatedSeconds: 60,
		Notes:            "ok",
	})
	if err != nil {
		t.Fatalf("Quote() error = %v", err)
	}
	if _, err := store.Consent(quoted.ID, task.ConsentRequest{Approved: true}); err != nil {
		t.Fatalf("Consent() error = %v", err)
	}
	agent := NewSellerAgent(SellerAgentConfig{
		Enabled:               true,
		AutoCompleteTextTasks: true,
		ProviderPubkey:        "provider-1",
		LLMBaseURL:            ts.URL,
		LLMAPIKey:             "test-key",
		LLMModel:              "test-model",
	}, store)

	agent.Tick(context.Background())

	completed, ok := store.Get(created.ID)
	if !ok {
		t.Fatalf("task disappeared")
	}
	if completed.Status != task.StatusCompleted {
		t.Fatalf("status = %s, want completed", completed.Status)
	}
	artifacts, ok := store.ArtifactManifest(created.ID)
	if !ok || len(artifacts) != 1 || artifacts[0].Name != "answer.md" || artifacts[0].SHA256 == "" {
		t.Fatalf("artifacts = %#v", artifacts)
	}
}

func TestSellerAgentUsesUtilityForQuoteAndResearchForTextCompletion(t *testing.T) {
	store, cleanup := newSellerTestTaskStore(t)
	defer cleanup()
	var models []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("payload decode: %v", err)
		}
		if model, _ := payload["model"].(string); model != "" {
			models = append(models, model)
		}
		input, _ := payload["input"].(string)
		content := `{"priceAmount":0,"currency":"USD","estimatedSeconds":60,"notes":"ok"}`
		if strings.Contains(input, "Complete this lightweight text task") {
			content = "## Completed\n\nSeller agent response."
		}
		_, _ = w.Write([]byte(`{"output_text":` + quote(content) + `}`))
	}))
	defer ts.Close()

	created := createSellerTestTask(t, store, "text.summary")
	agent := NewSellerAgent(SellerAgentConfig{
		Enabled:               true,
		AutoQuote:             true,
		AutoCompleteTextTasks: true,
		ProviderPubkey:        "provider-1",
		LLMBaseURL:            ts.URL + "/v1",
		LLMAPIKey:             "test-key",
		LLMResearchModel:      "research-model",
		LLMUtilityModel:       "utility-model",
	}, store)

	agent.Tick(context.Background())
	if _, err := store.Consent(created.ID, task.ConsentRequest{Approved: true}); err != nil {
		t.Fatalf("Consent() error = %v", err)
	}
	agent.Tick(context.Background())

	if len(models) < 2 || models[0] != "utility-model" || models[1] != "research-model" {
		t.Fatalf("models = %#v", models)
	}
}

func TestSellerAgentRequiresConfiguration(t *testing.T) {
	store, cleanup := newSellerTestTaskStore(t)
	defer cleanup()
	created := createSellerTestTask(t, store, "text.summary")
	agent := NewSellerAgent(SellerAgentConfig{
		Enabled:    true,
		AutoQuote:  true,
		LLMBaseURL: "http://127.0.0.1:1",
	}, store)

	if agent.Configured() {
		t.Fatalf("Configured() = true without API key")
	}
	agent.Tick(context.Background())

	updated, _ := store.Get(created.ID)
	if updated.Status != task.StatusPendingQuote || updated.Quote != nil {
		t.Fatalf("task changed without config: %#v", updated)
	}
}

func TestSellerAgentInvalidQuoteJSONDoesNotMutateTask(t *testing.T) {
	store, cleanup := newSellerTestTaskStore(t)
	defer cleanup()
	ts := fakeSellerLLM(t, `not json`)
	defer ts.Close()
	created := createSellerTestTask(t, store, "text.summary")
	agent := NewSellerAgent(SellerAgentConfig{
		Enabled:        true,
		AutoQuote:      true,
		ProviderPubkey: "provider-1",
		LLMBaseURL:     ts.URL,
		LLMAPIKey:      "test-key",
		LLMModel:       "test-model",
	}, store)

	agent.Tick(context.Background())

	updated, _ := store.Get(created.ID)
	if updated.Status != task.StatusPendingQuote || updated.Quote != nil {
		t.Fatalf("task changed after invalid JSON: %#v", updated)
	}
	if agent.Status().LastError == "" {
		t.Fatalf("LastError was not recorded")
	}
}

func TestSellerAgentQuotesOnlyMatchingResourceListings(t *testing.T) {
	store, cleanup := newSellerTestTaskStore(t)
	defer cleanup()
	resourceStore, resourceCleanup := newSellerTestResourceStore(t)
	defer resourceCleanup()
	if err := resourceStore.Save(resource.Resource{
		ID:             "gpu-1",
		Name:           "GPU worker",
		Type:           resource.TypeGPU,
		ProviderPubkey: "provider-1",
		Spec:           resource.Spec{VRAMGB: 48},
	}); err != nil {
		t.Fatal(err)
	}
	ts := fakeSellerLLM(t, `{"priceAmount":1.25,"currency":"USD","estimatedSeconds":90,"notes":"Ready."}`)
	defer ts.Close()
	gpuTask := createSellerTestTask(t, store, "compute.gpu")
	datasetTask := createSellerTestTask(t, store, "dataset.analysis")
	agent := NewSellerAgent(SellerAgentConfig{
		Enabled:        true,
		AutoQuote:      true,
		ProviderPubkey: "provider-1",
		LLMBaseURL:     ts.URL,
		LLMAPIKey:      "test-key",
		LLMModel:       "test-model",
	}, store, resourceStore)

	agent.Tick(context.Background())

	quoted, _ := store.Get(gpuTask.ID)
	if quoted.Quote == nil || quoted.Status != task.StatusPendingConsent {
		t.Fatalf("gpu task was not quoted: %#v", quoted)
	}
	skipped, _ := store.Get(datasetTask.ID)
	if skipped.Quote != nil || skipped.Status != task.StatusPendingQuote {
		t.Fatalf("dataset task should not be quoted: %#v", skipped)
	}
	if !agent.Status().Discoverable || agent.Status().ResourceListingCount != 1 {
		t.Fatalf("seller status = %#v", agent.Status())
	}
}

func TestSellerAgentNegotiationQuoteAndReject(t *testing.T) {
	store, cleanup := newSellerTestTaskStore(t)
	defer cleanup()
	negotiations, negotiationCleanup := newSellerTestNegotiationStore(t)
	defer negotiationCleanup()
	resourceStore, resourceCleanup := newSellerTestResourceStore(t)
	defer resourceCleanup()
	if err := resourceStore.Save(resource.Resource{
		ID:             "gpu-1",
		Name:           "GPU worker",
		Type:           resource.TypeGPU,
		ProviderPubkey: "provider-1",
		Availability:   "available",
		Spec:           resource.Spec{VRAMGB: 48},
	}); err != nil {
		t.Fatal(err)
	}
	quotedRequest, err := negotiations.Create(negotiation.CreateRequest{
		Intent:          "run gpu docker",
		RequesterPubkey: "buyer-1",
		AgentID:         "buyer-agent",
		ProviderPubkey:  "provider-1",
		ResourceID:      "gpu-1",
		Draft: market.OrderDraft{
			Type:         "compute.gpu",
			Goal:         "run gpu docker",
			Requirements: map[string]any{"type": "gpu"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	rejectedRequest, err := negotiations.Create(negotiation.CreateRequest{
		Intent:          "run missing dataset",
		RequesterPubkey: "buyer-1",
		AgentID:         "buyer-agent",
		ProviderPubkey:  "provider-1",
		ResourceID:      "missing",
		Draft: market.OrderDraft{
			Type:         "data.query",
			Goal:         "run missing dataset",
			Requirements: map[string]any{"type": "dataset"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	ts := fakeSellerLLM(t, `{"decision":"quote","priceAmount":2.5,"currency":"USD","estimatedSeconds":120,"executionPlanSummary":"run task","deliveryFormat":"artifact manifest","notes":"ready"}`)
	defer ts.Close()
	agent := NewSellerAgent(SellerAgentConfig{
		Enabled:        true,
		AutoQuote:      true,
		ProviderPubkey: "provider-1",
		LLMBaseURL:     ts.URL,
		LLMAPIKey:      "test-key",
		LLMModel:       "test-model",
	}, store, resourceStore).AttachNegotiations(negotiations)

	agent.Tick(context.Background())

	quoted, _ := negotiations.Get(quotedRequest.ID)
	if quoted.Status != negotiation.StatusQuoted || quoted.Quote == nil || quoted.Quote.PriceAmount != 2.5 {
		t.Fatalf("quoted negotiation = %#v", quoted)
	}
	rejected, _ := negotiations.Get(rejectedRequest.ID)
	if rejected.Status != negotiation.StatusRejected || rejected.Rejection == nil {
		t.Fatalf("rejected negotiation = %#v", rejected)
	}
}

func fakeSellerLLM(t *testing.T, quoteContent string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" && r.URL.Path != "/v1/chat/completions" && r.URL.Path != "/chat/completions" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		data, _ := io.ReadAll(r.Body)
		content := quoteContent
		if strings.Contains(string(data), "Complete this lightweight text task") {
			content = "## Completed\n\nSeller agent response."
		}
		if content == "" {
			content = `{"priceAmount":0,"currency":"USD","estimatedSeconds":60,"notes":"ok"}`
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "responses") {
			_, _ = w.Write([]byte(`{"output_text":` + quote(content) + `}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":` + quote(content) + `}}]}`))
	}))
}

func newSellerTestTaskStore(t *testing.T) (*task.Store, func()) {
	t.Helper()
	dir := t.TempDir()
	c, err := cache.New(1024, dir)
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	return task.NewStore(c, dir+"/artifacts"), func() { _ = c.Close() }
}

func newSellerTestResourceStore(t *testing.T) (*resource.Store, func()) {
	t.Helper()
	dir := t.TempDir()
	c, err := cache.New(1024, dir)
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	return resource.NewStore(c), func() { _ = c.Close() }
}

func newSellerTestNegotiationStore(t *testing.T) (*negotiation.Store, func()) {
	t.Helper()
	dir := t.TempDir()
	c, err := cache.New(1024, dir)
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	return negotiation.NewStore(c), func() { _ = c.Close() }
}

func createSellerTestTask(t *testing.T, store *task.Store, kind string) task.Task {
	t.Helper()
	created, err := store.Create(task.CreateRequest{
		RequesterPubkey: "user-1",
		AgentID:         "agent-1",
		Type:            kind,
		Goal:            "Summarize a short note.",
		ExpectedOutputs: []string{"answer.md"},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	return created
}

func quote(value string) string {
	data, _ := json.Marshal(value)
	return string(data)
}
