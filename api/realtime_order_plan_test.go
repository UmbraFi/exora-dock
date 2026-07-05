package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/market"
	"github.com/exora-dock/exora-dock/internal/mcp"
	"github.com/exora-dock/exora-dock/internal/orderplan"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/exora-dock/exora-dock/internal/wallet"
	"github.com/go-chi/chi/v5"
)

func TestSearchSellersCreatesRealtimeDockerOrderPlan(t *testing.T) {
	providerRouter, providerAddress, buyerWallet := newProviderProtocolTestRouter(t, true)
	providerServer := httptest.NewServer(providerRouter)
	defer providerServer.Close()

	dir := t.TempDir()
	c, err := cache.New(128, filepath.Join(dir, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	resources := resource.NewStore(c)
	if err := resources.Save(resource.Resource{
		ID:             "gpu-1",
		Name:           "Realtime Docker GPU",
		Type:           resource.TypeGPU,
		ProviderPubkey: providerAddress,
		PricePerUnit:   1.5,
		BillingUnit:    resource.BillingHour,
		Availability:   "available",
		Spec:           resource.Spec{Runtime: "docker", Endpoint: providerServer.URL, VRAMGB: 24, GPUCount: 1},
		UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, resources, nil, nil, "buyer", RuntimeStores{
		Wallet:     buyerWallet,
		Tasks:      task.NewStore(c, filepath.Join(dir, "artifacts")),
		Approvals:  approval.NewStore(c),
		OrderPlans: orderplan.NewStore(c),
	})
	router := chi.NewRouter()
	router.Post("/agent/search-sellers", handler.SearchSellers)
	router.Get("/order-plans/{id}", handler.GetOrderPlan)

	body := []byte(`{
		"query":"rent a GPU server and run a Docker job",
		"agentId":"codex",
		"constraints":{"type":"gpu","minVramGb":20},
		"requireRealtimeQuotes":true,
		"prepareOrderOptions":true,
		"createSelectionRequest":true,
		"maxOptions":6,
		"taskTemplate":{"type":"compute.gpu","goal":"run docker job","requirements":{"docker":{"image":"python:3.12-alpine","command":"python","args":["-V"]}}}
	}`)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/agent/search-sellers", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("search status=%d body=%s", rec.Code, rec.Body.String())
	}
	var result market.SearchResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.SelectionRequest == nil || len(result.OrderDraftOptions) != 1 {
		t.Fatalf("result = %#v body=%s", result, rec.Body.String())
	}
	if result.OrderDraftOptions[0].RealtimeStatus != "quoted" || result.OrderDraftOptions[0].QuoteID == "" {
		t.Fatalf("option not realtime quoted: %#v", result.OrderDraftOptions[0])
	}

	get := httptest.NewRecorder()
	router.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/order-plans/"+result.SelectionRequest.PlanID, nil))
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), `"status":"quoted"`) {
		t.Fatalf("plan status=%d body=%s", get.Code, get.Body.String())
	}
}

func TestClosedLoopRealtimeSearchWithTenTraceScaleSellersReturnsSixOptions(t *testing.T) {
	router := newTraceScaleClosedLoopBuyerRouter(t, 10)

	body := []byte(`{
		"query":"rent a TraceScale GPU seller and run a Docker job",
		"agentId":"closed-loop-agent",
		"constraints":{"type":"gpu","minVramGb":20},
		"requireRealtimeQuotes":true,
		"prepareOrderOptions":true,
		"createSelectionRequest":true,
		"maxResults":10,
		"maxOptions":6,
		"taskTemplate":{"type":"compute.gpu","goal":"closed loop docker smoke","requirements":{"docker":{"image":"python:3.12-alpine","command":"python","args":["-V"]}}}
	}`)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/agent/search-sellers", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("search status=%d body=%s", rec.Code, rec.Body.String())
	}
	var result market.SearchResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Candidates) != 10 {
		t.Fatalf("candidates = %d, want 10", len(result.Candidates))
	}
	if len(result.OrderDraftOptions) != 6 {
		t.Fatalf("options = %d, want 6; body=%s", len(result.OrderDraftOptions), rec.Body.String())
	}
	for _, option := range result.OrderDraftOptions {
		if option.RealtimeStatus != "quoted" || option.QuoteID == "" || option.ProviderEndpoint == "" {
			t.Fatalf("option is not realtime selectable: %#v", option)
		}
	}
	if result.SelectionRequest == nil || result.SelectionRequest.PlanID == "" {
		t.Fatalf("missing selection request: %#v", result.SelectionRequest)
	}

	get := httptest.NewRecorder()
	router.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/order-plans/"+result.SelectionRequest.PlanID, nil))
	if get.Code != http.StatusOK {
		t.Fatalf("plan status=%d body=%s", get.Code, get.Body.String())
	}
	if count := strings.Count(get.Body.String(), `"status":"quoted"`); count != 6 {
		t.Fatalf("quoted candidate states = %d, want 6; body=%s", count, get.Body.String())
	}
}

func TestMCPTaskFlowSurfacesFrontendSellerChoiceSnapshot(t *testing.T) {
	router := newTraceScaleClosedLoopBuyerRouter(t, 10)
	buyerServer := httptest.NewServer(router)
	defer buyerServer.Close()

	server := mcp.NewServer(mcp.Options{BaseURL: buyerServer.URL})
	resp := server.HandleJSON(context.Background(), []byte(`{
		"jsonrpc":"2.0",
		"id":42,
		"method":"tools/call",
		"params":{
			"name":"exora.start_task_flow",
			"arguments":{
				"query":"rent a TraceScale GPU seller and run a Docker job",
				"agentId":"agenstaff-smoke",
				"constraints":{"type":"gpu","minVramGb":20},
				"maxResults":10,
				"maxOptions":6,
				"taskTemplate":{"type":"compute.gpu","goal":"frontend handoff docker smoke","requirements":{"docker":{"image":"python:3.12-alpine","command":"python","args":["-V"]}}}
			}
		}
	}`))
	var toolResp struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error,omitempty"`
		Result struct {
			IsError           bool                `json:"isError,omitempty"`
			StructuredContent market.SearchResult `json:"structuredContent"`
		} `json:"result"`
	}
	respData, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(respData, &toolResp); err != nil {
		t.Fatalf("decode mcp response: %v; body=%s", err, respData)
	}
	if toolResp.Error != nil || toolResp.Result.IsError {
		t.Fatalf("mcp task flow failed: %#v body=%s", toolResp.Error, respData)
	}
	result := toolResp.Result.StructuredContent
	if result.SelectionRequest == nil || result.SelectionRequest.PlanID == "" {
		t.Fatalf("missing selection request from MCP result: %#v", result)
	}
	if len(result.OrderDraftOptions) != 6 {
		t.Fatalf("mcp options = %d, want 6; body=%s", len(result.OrderDraftOptions), respData)
	}

	snapshotResp, err := http.Get(buyerServer.URL + "/v1/order-plans?status=pending_selection")
	if err != nil {
		t.Fatal(err)
	}
	defer snapshotResp.Body.Close()
	if snapshotResp.StatusCode != http.StatusOK {
		t.Fatalf("frontend snapshot status=%d", snapshotResp.StatusCode)
	}
	var snapshot struct {
		OrderPlans []orderplan.Plan `json:"orderPlans"`
	}
	if err := json.NewDecoder(snapshotResp.Body).Decode(&snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.OrderPlans) != 1 {
		t.Fatalf("frontend pending plans = %d, want 1", len(snapshot.OrderPlans))
	}
	plan := snapshot.OrderPlans[0]
	if plan.ID != result.SelectionRequest.PlanID {
		t.Fatalf("snapshot plan id = %q, want %q", plan.ID, result.SelectionRequest.PlanID)
	}
	if plan.AgentID != "agenstaff-smoke" || plan.Status != orderplan.StatusPendingSelection || !plan.RealtimeRequired {
		t.Fatalf("snapshot plan is not an external realtime pending choice: %#v", plan)
	}
	if plan.NextAction != "choose_seller_option" || len(plan.Options) != 6 {
		t.Fatalf("snapshot plan not ready for seller choice: next=%q options=%d", plan.NextAction, len(plan.Options))
	}
	for _, option := range plan.Options {
		if option.OptionID == "" || option.ProviderEndpoint == "" || option.RealtimeStatus != "quoted" || option.QuoteID == "" {
			t.Fatalf("frontend option is not selectable realtime quote: %#v", option)
		}
	}
	if countQuotedCandidates(plan.Candidates) != 6 || !hasPlanEvent(plan.Events, "provider_quoted") {
		t.Fatalf("snapshot missing realtime progress: candidates=%#v events=%#v", plan.Candidates, plan.Events)
	}
}

func newTraceScaleClosedLoopBuyerRouter(t *testing.T, sellerCount int) *chi.Mux {
	t.Helper()
	dir := t.TempDir()
	buyerWallet := wallet.NewStore(filepath.Join(dir, "buyer-wallet"))
	if _, err := buyerWallet.Create(wallet.CreateRequest{}); err != nil {
		t.Fatal(err)
	}

	c, err := cache.New(128, filepath.Join(dir, "buyer-cache"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	resources := resource.NewStore(c)

	for i := 0; i < sellerCount; i++ {
		resourceID := fmt.Sprintf("tracescale-gpu-%02d", i+1)
		providerRouter, providerAddress := newSimulatedTraceScaleProvider(t, resourceID, 2.5+float64(i)/10, 24+i)
		providerServer := httptest.NewServer(providerRouter)
		t.Cleanup(providerServer.Close)
		if err := resources.Save(resource.Resource{
			ID:             resourceID,
			Name:           fmt.Sprintf("TraceScale Seller %02d", i+1),
			Type:           resource.TypeGPU,
			ProviderPubkey: providerAddress,
			PricePerUnit:   2.5 + float64(i)/10,
			BillingUnit:    resource.BillingHour,
			Availability:   "available",
			QualityScore:   100 - i,
			Reputation:     90 - i,
			Spec: resource.Spec{
				Runtime:  "docker",
				Endpoint: providerServer.URL,
				VRAMGB:   24 + i,
				GPUCount: 1,
				GPUModel: "TraceScale RTX",
			},
			UpdatedAt: time.Now().UTC().Add(time.Duration(i) * time.Second).Format(time.RFC3339),
		}); err != nil {
			t.Fatal(err)
		}
	}

	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, resources, nil, nil, "buyer", RuntimeStores{
		Wallet:     buyerWallet,
		Tasks:      task.NewStore(c, filepath.Join(dir, "artifacts")),
		Approvals:  approval.NewStore(c),
		OrderPlans: orderplan.NewStore(c),
	})
	router := chi.NewRouter()
	router.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Post("/agent/search-sellers", handler.SearchSellers)
	router.Get("/order-plans", handler.ListOrderPlans)
	router.Get("/order-plans/{id}", handler.GetOrderPlan)
	router.Post("/v1/agent/search-sellers", handler.SearchSellers)
	router.Get("/v1/order-plans", handler.ListOrderPlans)
	router.Get("/v1/order-plans/{id}", handler.GetOrderPlan)
	return router
}

func countQuotedCandidates(states []orderplan.CandidateState) int {
	count := 0
	for _, state := range states {
		if state.Status == "quoted" {
			count++
		}
	}
	return count
}

func hasPlanEvent(events []orderplan.Event, typ string) bool {
	for _, event := range events {
		if event.Type == typ {
			return true
		}
	}
	return false
}

func newSimulatedTraceScaleProvider(t *testing.T, resourceID string, price float64, vram int) (*chi.Mux, string) {
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
	resources := resource.NewStore(c)
	if err := resources.Save(resource.Resource{
		ID:             resourceID,
		Name:           "TraceScale simulated Docker seller",
		Type:           resource.TypeGPU,
		ProviderPubkey: providerStatus.Address,
		PricePerUnit:   price,
		BillingUnit:    resource.BillingHour,
		Availability:   "available",
		Spec:           resource.Spec{Runtime: "docker", VRAMGB: vram, GPUCount: 1},
		UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	executor := task.NewExecutor(task.ExecutorConfig{
		WorkspaceDir: filepath.Join(dir, "jobs"),
		Docker: task.DockerExecutorConfig{
			Enabled:             true,
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
	router.Post("/v1/provider/quote-requests", handler.CreateProviderQuoteRequest)
	return router, providerStatus.Address
}
