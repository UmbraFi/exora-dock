package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/payment"
	"github.com/exora-dock/exora-dock/internal/paymentpin"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/go-chi/chi/v5"
)

func TestApprovalQueueApprovesAndRejectsTasks(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	defer c.Close()

	tasks := task.NewStore(c, t.TempDir())
	approvals := approval.NewStore(c)
	pins := paymentpin.New(t.TempDir() + "/payment-pin.json")
	if _, err := pins.Set("123456"); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "local-dev-miner", RuntimeStores{Tasks: tasks, Approvals: approvals, PaymentPIN: pins, Payments: payment.NewStore(c)})
	router := chi.NewRouter()
	router.Post("/tasks", handler.CreateTask)
	router.Post("/tasks/{id}/quote", handler.QuoteTask)
	router.Get("/tasks/{id}", handler.GetTask)
	router.Post("/approvals", handler.CreateApproval)
	router.Get("/approvals", handler.ListApprovals)
	router.Post("/approvals/{id}/decide", handler.DecideApproval)

	taskID := createQuotedTask(t, router, "user-1", "agent-alpha", "provider-1")

	createApprovalReq := httptest.NewRequest(http.MethodPost, "/approvals", bytes.NewReader([]byte(`{"taskId":"`+taskID+`"}`)))
	createApprovalRec := httptest.NewRecorder()
	router.ServeHTTP(createApprovalRec, createApprovalReq)
	if createApprovalRec.Code != http.StatusCreated {
		t.Fatalf("approval create status = %d body = %s", createApprovalRec.Code, createApprovalRec.Body.String())
	}
	var createApprovalResp struct {
		Approval approval.Approval `json:"approval"`
	}
	if err := json.Unmarshal(createApprovalRec.Body.Bytes(), &createApprovalResp); err != nil {
		t.Fatalf("approval json error = %v", err)
	}
	if createApprovalResp.Approval.Status != approval.StatusPending || createApprovalResp.Approval.ProviderPubkey != "provider-1" {
		t.Fatalf("approval = %#v", createApprovalResp.Approval)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/approvals?status=pending&userPubkey=user-1&agentId=agent-alpha&taskId="+taskID, nil)
	listRec := httptest.NewRecorder()
	router.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK || !strings.Contains(listRec.Body.String(), createApprovalResp.Approval.ID) {
		t.Fatalf("approval list status/body = %d %s", listRec.Code, listRec.Body.String())
	}

	decideReq := httptest.NewRequest(http.MethodPost, "/approvals/"+createApprovalResp.Approval.ID+"/decide", bytes.NewReader([]byte(`{"approved":true,"decidedBy":"tester","paymentPin":"123456"}`)))
	decideRec := httptest.NewRecorder()
	router.ServeHTTP(decideRec, decideReq)
	if decideRec.Code != http.StatusOK || !strings.Contains(decideRec.Body.String(), string(task.StatusConsented)) {
		t.Fatalf("approval decide status/body = %d %s", decideRec.Code, decideRec.Body.String())
	}

	duplicateReq := httptest.NewRequest(http.MethodPost, "/approvals/"+createApprovalResp.Approval.ID+"/decide", bytes.NewReader([]byte(`{"approved":false}`)))
	duplicateRec := httptest.NewRecorder()
	router.ServeHTTP(duplicateRec, duplicateReq)
	if duplicateRec.Code != http.StatusConflict {
		t.Fatalf("duplicate decide status = %d body = %s", duplicateRec.Code, duplicateRec.Body.String())
	}

	rejectTaskID := createQuotedTask(t, router, "user-2", "agent-beta", "provider-2")
	rejectApprovalReq := httptest.NewRequest(http.MethodPost, "/approvals", bytes.NewReader([]byte(`{"taskId":"`+rejectTaskID+`"}`)))
	rejectApprovalRec := httptest.NewRecorder()
	router.ServeHTTP(rejectApprovalRec, rejectApprovalReq)
	if rejectApprovalRec.Code != http.StatusCreated {
		t.Fatalf("reject approval create status/body = %d %s", rejectApprovalRec.Code, rejectApprovalRec.Body.String())
	}
	var rejectApprovalResp struct {
		Approval approval.Approval `json:"approval"`
	}
	if err := json.Unmarshal(rejectApprovalRec.Body.Bytes(), &rejectApprovalResp); err != nil {
		t.Fatalf("reject approval json error = %v", err)
	}
	rejectReq := httptest.NewRequest(http.MethodPost, "/approvals/"+rejectApprovalResp.Approval.ID+"/decide", bytes.NewReader([]byte(`{"approved":false,"userNote":"no"}`)))
	rejectRec := httptest.NewRecorder()
	router.ServeHTTP(rejectRec, rejectReq)
	if rejectRec.Code != http.StatusOK || !strings.Contains(rejectRec.Body.String(), string(task.StatusFailed)) {
		t.Fatalf("reject decide status/body = %d %s", rejectRec.Code, rejectRec.Body.String())
	}
}

func createQuotedTask(t *testing.T, router http.Handler, user string, agent string, provider string) string {
	t.Helper()
	createBody := []byte(`{
		"requesterPubkey":"` + user + `",
		"agentId":"` + agent + `",
		"type":"compute.inference",
		"goal":"Run inference over prompts",
		"inputFiles":[{"name":"prompts.jsonl","sizeBytes":12,"sha256":"abc"}],
		"privacyPolicy":{"retention":"order-only"},
		"retentionPolicy":{"provider":"no-retain"}
	}`)
	createReq := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewReader(createBody))
	createRec := httptest.NewRecorder()
	router.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("task create status/body = %d %s", createRec.Code, createRec.Body.String())
	}
	var createResp struct {
		Task task.Task `json:"task"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("task create json error = %v", err)
	}

	quoteReq := httptest.NewRequest(http.MethodPost, "/tasks/"+createResp.Task.ID+"/quote", bytes.NewReader([]byte(`{"providerPubkey":"`+provider+`","priceAmount":2.5,"currency":"USD","estimatedSeconds":60}`)))
	quoteRec := httptest.NewRecorder()
	router.ServeHTTP(quoteRec, quoteReq)
	if quoteRec.Code != http.StatusOK {
		t.Fatalf("task quote status/body = %d %s", quoteRec.Code, quoteRec.Body.String())
	}
	return createResp.Task.ID
}
