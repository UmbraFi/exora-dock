package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/localauth"
	"github.com/exora-dock/exora-dock/internal/orderplan"
	"github.com/exora-dock/exora-dock/internal/payment"
	"github.com/exora-dock/exora-dock/internal/paymentpin"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/exora-dock/exora-dock/internal/task"
)

func TestAuthScopesProtectApprovalDecision(t *testing.T) {
	dir := t.TempDir()
	c, err := cache.New(128, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()

	authStore, err := localauth.LoadOrCreate(filepath.Join(dir, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	tasks := task.NewStore(c, filepath.Join(dir, "artifacts"))
	approvals := approval.NewStore(c)
	orderPlans := orderplan.NewStore(c)
	pins := paymentpin.New(filepath.Join(dir, "payment-pin.json"))
	if _, err := pins.Set("123456"); err != nil {
		t.Fatal(err)
	}
	resources := resource.NewStore(c)
	if err := resources.Save(resource.Resource{
		ID:             "res-gpu",
		Name:           "GPU Seller",
		Type:           resource.TypeGPU,
		ProviderPubkey: "provider-1",
		Availability:   "available",
		QualityScore:   90,
		Reputation:     90,
		Spec:           resource.Spec{VRAMGB: 24},
	}); err != nil {
		t.Fatal(err)
	}
	router := New(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, resources, nil, nil, "local-dev-miner", RuntimeStores{
		Tasks:        tasks,
		Approvals:    approvals,
		OrderPlans:   orderPlans,
		PaymentPIN:   pins,
		Payments:     payment.NewStore(c),
		Auth:         authStore,
		LegacyMarket: true,
	})

	createTask := authReq(http.MethodPost, "/v1/tasks", `{"requesterPubkey":"user-1","agentId":"agent-1","type":"compute.inference","goal":"run gpu job"}`, authStore.AgentToken())
	taskRec := httptest.NewRecorder()
	router.ServeHTTP(taskRec, createTask)
	if taskRec.Code != http.StatusCreated {
		t.Fatalf("create task status=%d body=%s", taskRec.Code, taskRec.Body.String())
	}
	var taskBody struct {
		Task task.Task `json:"task"`
	}
	if err := json.Unmarshal(taskRec.Body.Bytes(), &taskBody); err != nil {
		t.Fatal(err)
	}

	if _, err := tasks.Quote(taskBody.Task.ID, task.QuoteRequest{ProviderPubkey: "provider-1", PriceAmount: 1, Currency: "USD"}); err != nil {
		t.Fatal(err)
	}

	createApproval := authReq(http.MethodPost, "/v1/approvals", `{"taskId":"`+taskBody.Task.ID+`"}`, authStore.AgentToken())
	approvalRec := httptest.NewRecorder()
	router.ServeHTTP(approvalRec, createApproval)
	if approvalRec.Code != http.StatusCreated {
		t.Fatalf("create approval status=%d body=%s", approvalRec.Code, approvalRec.Body.String())
	}
	var approvalBody struct {
		Approval approval.Approval `json:"approval"`
	}
	if err := json.Unmarshal(approvalRec.Body.Bytes(), &approvalBody); err != nil {
		t.Fatal(err)
	}

	search := authReq(http.MethodPost, "/v1/agent/search-sellers", `{"query":"20G 显存以上服务器"}`, authStore.AgentToken())
	searchRec := httptest.NewRecorder()
	router.ServeHTTP(searchRec, search)
	if searchRec.Code != http.StatusOK || !strings.Contains(searchRec.Body.String(), "provider-1") {
		t.Fatalf("agent search status=%d body=%s", searchRec.Code, searchRec.Body.String())
	}

	selection := authReq(http.MethodPost, "/v1/agent/search-sellers", `{"query":"20G VRAM server","prepareOrderOptions":true,"createSelectionRequest":true}`, authStore.AgentToken())
	selectionRec := httptest.NewRecorder()
	router.ServeHTTP(selectionRec, selection)
	if selectionRec.Code != http.StatusOK || !strings.Contains(selectionRec.Body.String(), "selectionRequest") {
		t.Fatalf("agent selection search status=%d body=%s", selectionRec.Code, selectionRec.Body.String())
	}
	negotiationReq := authReq(http.MethodPost, "/v1/negotiations", `{"intent":"run gpu job","providerPubkey":"provider-1","resourceId":"res-gpu","draft":{"goal":"run gpu job","type":"compute.gpu"}}`, authStore.AgentToken())
	negotiationRec := httptest.NewRecorder()
	router.ServeHTTP(negotiationRec, negotiationReq)
	if negotiationRec.Code != http.StatusAccepted {
		t.Fatalf("agent negotiation status=%d body=%s", negotiationRec.Code, negotiationRec.Body.String())
	}
	listNegotiations := authReq(http.MethodGet, "/v1/negotiations", "", authStore.AgentToken())
	listNegotiationsRec := httptest.NewRecorder()
	router.ServeHTTP(listNegotiationsRec, listNegotiations)
	if listNegotiationsRec.Code != http.StatusOK || !strings.Contains(listNegotiationsRec.Body.String(), "negotiations") {
		t.Fatalf("agent list negotiations status=%d body=%s", listNegotiationsRec.Code, listNegotiationsRec.Body.String())
	}
	plans := orderPlans.List(orderplan.ListFilter{Status: orderplan.StatusPendingSelection})
	if len(plans) != 1 {
		t.Fatalf("order plans = %d, want 1", len(plans))
	}
	agentSelect := authReq(http.MethodPost, "/v1/order-plans/"+plans[0].ID+"/select", `{"optionId":"opt_1"}`, authStore.AgentToken())
	agentSelectRec := httptest.NewRecorder()
	router.ServeHTTP(agentSelectRec, agentSelect)
	if agentSelectRec.Code != http.StatusForbidden {
		t.Fatalf("agent select order plan status=%d body=%s", agentSelectRec.Code, agentSelectRec.Body.String())
	}

	missing := authReq(http.MethodPost, "/v1/approvals/"+approvalBody.Approval.ID+"/decide", `{"approved":true}`, "")
	missingRec := httptest.NewRecorder()
	router.ServeHTTP(missingRec, missing)
	if missingRec.Code != http.StatusUnauthorized {
		t.Fatalf("missing token status=%d", missingRec.Code)
	}

	agent := authReq(http.MethodPost, "/v1/approvals/"+approvalBody.Approval.ID+"/decide", `{"approved":true}`, authStore.AgentToken())
	agentRec := httptest.NewRecorder()
	router.ServeHTTP(agentRec, agent)
	if agentRec.Code != http.StatusForbidden {
		t.Fatalf("agent decide status=%d body=%s", agentRec.Code, agentRec.Body.String())
	}

	agentPayment := authReq(http.MethodGet, "/v1/payment-pin/status", "", authStore.AgentToken())
	agentPaymentRec := httptest.NewRecorder()
	router.ServeHTTP(agentPaymentRec, agentPayment)
	if agentPaymentRec.Code != http.StatusForbidden {
		t.Fatalf("agent payment pin status=%d body=%s", agentPaymentRec.Code, agentPaymentRec.Body.String())
	}

	agentLedger := authReq(http.MethodGet, "/v1/payments", "", authStore.AgentToken())
	agentLedgerRec := httptest.NewRecorder()
	router.ServeHTTP(agentLedgerRec, agentLedger)
	if agentLedgerRec.Code != http.StatusForbidden {
		t.Fatalf("agent payment ledger status=%d body=%s", agentLedgerRec.Code, agentLedgerRec.Body.String())
	}

	agentRun := authReq(http.MethodPost, "/v1/agent/runs", `{"intent":"find a seller"}`, authStore.AgentToken())
	agentRunRec := httptest.NewRecorder()
	router.ServeHTTP(agentRunRec, agentRun)
	if agentRunRec.Code != http.StatusForbidden {
		t.Fatalf("agent run with agent token status=%d body=%s", agentRunRec.Code, agentRunRec.Body.String())
	}

	ownerRun := authReq(http.MethodPost, "/v1/agent/runs", `{"intent":"find a seller"}`, authStore.OwnerToken())
	ownerRunRec := httptest.NewRecorder()
	router.ServeHTTP(ownerRunRec, ownerRun)
	if ownerRunRec.Code != http.StatusNotFound {
		t.Fatalf("removed direct agent run route status=%d body=%s", ownerRunRec.Code, ownerRunRec.Body.String())
	}

	owner := authReq(http.MethodPost, "/v1/approvals/"+approvalBody.Approval.ID+"/decide", `{"approved":true,"paymentPin":"123456"}`, authStore.OwnerToken())
	ownerRec := httptest.NewRecorder()
	router.ServeHTTP(ownerRec, owner)
	if ownerRec.Code != http.StatusOK || !strings.Contains(ownerRec.Body.String(), string(task.StatusConsented)) {
		t.Fatalf("owner decide status=%d body=%s", ownerRec.Code, ownerRec.Body.String())
	}
}

func TestCORSDoesNotAllowArbitraryOrigins(t *testing.T) {
	router := New(nil, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "local")
	req := httptest.NewRequest(http.MethodOptions, "/v1/resources", nil)
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Access-Control-Request-Method", "GET")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got == "*" || got == "https://evil.example" {
		t.Fatalf("unexpected CORS origin %q", got)
	}
}

func authReq(method string, path string, body string, token string) *http.Request {
	req := httptest.NewRequest(method, path, bytes.NewReader([]byte(body)))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req
}
