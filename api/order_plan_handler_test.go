package api

import (
	"bytes"
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
	"github.com/exora-dock/exora-dock/internal/orderplan"
	"github.com/exora-dock/exora-dock/internal/payment"
	"github.com/exora-dock/exora-dock/internal/paymentpin"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/go-chi/chi/v5"
)

func TestSearchSellersCreatesPendingOrderPlan(t *testing.T) {
	env := newOrderPlanTestEnv(t)
	seedGPUOptions(t, env.resources, 6)

	result := createOrderPlanFromSearch(t, env.router)
	if len(result.OrderDraftOptions) != 5 {
		t.Fatalf("order options = %d, want 5", len(result.OrderDraftOptions))
	}
	if result.SelectionRequest == nil || result.SelectionRequest.PlanID == "" {
		t.Fatalf("missing selection request: %#v", result.SelectionRequest)
	}
	if result.SelectionRequest.Status != string(orderplan.StatusPendingSelection) {
		t.Fatalf("selection status = %q", result.SelectionRequest.Status)
	}

	rec := httptest.NewRecorder()
	env.router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/order-plans?status=pending_selection", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), result.SelectionRequest.PlanID) {
		t.Fatalf("list order plans status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestSelectOrderPlanRequiresPINAndConsentsPaidTask(t *testing.T) {
	env := newOrderPlanTestEnv(t)
	seedGPUOptions(t, env.resources, 2)
	if _, err := env.pins.Set("123456"); err != nil {
		t.Fatal(err)
	}
	result := createOrderPlanFromSearch(t, env.router)
	planID := result.SelectionRequest.PlanID

	missing := postPlanSelection(env.router, planID, `{"optionId":"opt_1"}`)
	if missing.Code != http.StatusForbidden || !strings.Contains(missing.Body.String(), "payment_pin_required") {
		t.Fatalf("missing pin status=%d body=%s", missing.Code, missing.Body.String())
	}

	wrong := postPlanSelection(env.router, planID, `{"optionId":"opt_1","paymentPin":"000000"}`)
	if wrong.Code != http.StatusForbidden || !strings.Contains(wrong.Body.String(), "invalid_payment_pin") {
		t.Fatalf("wrong pin status=%d body=%s", wrong.Code, wrong.Body.String())
	}

	ok := postPlanSelection(env.router, planID, `{"optionId":"opt_1","paymentPin":"123456","userNote":"go"}`)
	if ok.Code != http.StatusOK {
		t.Fatalf("select status=%d body=%s", ok.Code, ok.Body.String())
	}
	var body struct {
		OrderPlan orderplan.Plan    `json:"orderPlan"`
		Task      task.Task         `json:"task"`
		Approval  approval.Approval `json:"approval"`
		Payment   payment.Record    `json:"payment"`
	}
	if err := json.Unmarshal(ok.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.OrderPlan.Status != orderplan.StatusSelected || body.OrderPlan.SelectedOptionID != "opt_1" {
		t.Fatalf("order plan = %#v", body.OrderPlan)
	}
	if body.Task.Status != task.StatusConsented {
		t.Fatalf("task status = %q", body.Task.Status)
	}
	if body.Approval.Status != approval.StatusApproved {
		t.Fatalf("approval status = %q", body.Approval.Status)
	}
	if body.Payment.Status != payment.StatusConfirmedSimulated {
		t.Fatalf("payment status = %q", body.Payment.Status)
	}

	again := postPlanSelection(env.router, planID, `{"optionId":"opt_1","paymentPin":"123456"}`)
	if again.Code != http.StatusOK || !strings.Contains(again.Body.String(), body.Task.ID) {
		t.Fatalf("idempotent select status=%d body=%s", again.Code, again.Body.String())
	}

	different := postPlanSelection(env.router, planID, `{"optionId":"opt_2","paymentPin":"123456"}`)
	if different.Code != http.StatusConflict || !strings.Contains(different.Body.String(), "plan_already_selected") {
		t.Fatalf("different select status=%d body=%s", different.Code, different.Body.String())
	}
}

func TestSelectOrderPlanInvalidatesChangedOfferWithoutCreatingTask(t *testing.T) {
	env := newOrderPlanTestEnv(t)
	seedGPUOptions(t, env.resources, 1)
	if _, err := env.pins.Set("123456"); err != nil {
		t.Fatal(err)
	}
	result := createOrderPlanFromSearch(t, env.router)
	option := result.OrderDraftOptions[0]
	res, ok := env.resources.Get(option.ResourceID)
	if !ok {
		t.Fatalf("resource %s not found", option.ResourceID)
	}
	res.PricePerUnit += 1
	if err := env.resources.Save(res); err != nil {
		t.Fatal(err)
	}

	rec := postPlanSelection(env.router, result.SelectionRequest.PlanID, `{"optionId":"opt_1","paymentPin":"123456"}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "offer_expired") {
		t.Fatalf("changed offer status=%d body=%s", rec.Code, rec.Body.String())
	}
	if got := len(env.tasks.List("", "")); got != 0 {
		t.Fatalf("tasks created = %d, want 0", got)
	}
}

type orderPlanTestEnv struct {
	router    *chi.Mux
	resources *resource.Store
	tasks     *task.Store
	pins      *paymentpin.Store
}

func newOrderPlanTestEnv(t *testing.T) orderPlanTestEnv {
	t.Helper()
	dir := t.TempDir()
	c, err := cache.New(128, dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	resources := resource.NewStore(c)
	tasks := task.NewStore(c, filepath.Join(dir, "artifacts"))
	approvals := approval.NewStore(c)
	pins := paymentpin.New(filepath.Join(dir, "payment-pin.json"))
	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, resources, nil, nil, "local-dev-miner", RuntimeStores{
		Tasks:      tasks,
		Approvals:  approvals,
		OrderPlans: orderplan.NewStore(c),
		PaymentPIN: pins,
		Payments:   payment.NewStore(c),
	})
	router := chi.NewRouter()
	router.Post("/agent/search-sellers", handler.SearchSellers)
	router.Get("/order-plans", handler.ListOrderPlans)
	router.Get("/order-plans/{id}", handler.GetOrderPlan)
	router.Post("/order-plans/{id}/select", handler.SelectOrderPlan)
	router.Post("/order-plans/{id}/cancel", handler.CancelOrderPlan)
	return orderPlanTestEnv{router: router, resources: resources, tasks: tasks, pins: pins}
}

func seedGPUOptions(t *testing.T, store *resource.Store, count int) {
	t.Helper()
	now := time.Now().UTC()
	for i := 0; i < count; i++ {
		if err := store.Save(resource.Resource{
			ID:             fmt.Sprintf("gpu-%d", i+1),
			Name:           fmt.Sprintf("GPU Seller %d", i+1),
			Type:           resource.TypeGPU,
			ProviderPubkey: fmt.Sprintf("provider-%d", i+1),
			PricePerUnit:   float64(i + 1),
			BillingUnit:    resource.BillingHour,
			Availability:   "available",
			QualityScore:   100 - i,
			Reputation:     90 - i,
			Spec:           resource.Spec{VRAMGB: 24 + i, GPUCount: 1, GPUModel: "RTX"},
			CreatedAt:      now.Add(time.Duration(i) * time.Second).Format(time.RFC3339),
			UpdatedAt:      now.Add(time.Duration(i) * time.Second).Format(time.RFC3339),
		}); err != nil {
			t.Fatal(err)
		}
	}
}

func createOrderPlanFromSearch(t *testing.T, router http.Handler) market.SearchResult {
	t.Helper()
	body := []byte(`{
		"query":"find GPU server with at least 20GB VRAM",
		"requesterPubkey":"user-1",
		"agentId":"codex",
		"maxResults":6,
		"prepareOrderOptions":true,
		"createSelectionRequest":true,
		"maxOptions":5
	}`)
	req := httptest.NewRequest(http.MethodPost, "/agent/search-sellers", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("search status=%d body=%s", rec.Code, rec.Body.String())
	}
	var result market.SearchResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.SelectionRequest == nil {
		t.Fatalf("missing selection request: %s", rec.Body.String())
	}
	return result
}

func postPlanSelection(router http.Handler, planID string, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/order-plans/"+planID+"/select", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}
