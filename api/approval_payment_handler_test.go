package api

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
	"github.com/exora-dock/exora-dock/internal/payment"
	"github.com/exora-dock/exora-dock/internal/paymentpin"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/go-chi/chi/v5"
)

func TestPaidApprovalRequiresPaymentPINAndWritesLedger(t *testing.T) {
	dir := t.TempDir()
	c, err := cache.New(128, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()

	tasks := task.NewStore(c, filepath.Join(dir, "artifacts"))
	approvals := approval.NewStore(c)
	pins := paymentpin.New(filepath.Join(dir, "payment-pin.json"))
	payments := payment.NewStore(c)
	if _, err := pins.Set("123456"); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "local-dev-miner", RuntimeStores{
		Tasks:      tasks,
		Approvals:  approvals,
		PaymentPIN: pins,
		Payments:   payments,
	})
	router := chi.NewRouter()
	router.Post("/tasks", handler.CreateTask)
	router.Post("/tasks/{id}/quote", handler.QuoteTask)
	router.Post("/approvals", handler.CreateApproval)
	router.Post("/approvals/{id}/decide", handler.DecideApproval)
	router.Get("/payments", handler.ListPayments)

	taskID := createQuotedTask(t, router, "user-1", "agent-alpha", "provider-1")
	createApprovalReq := httptest.NewRequest(http.MethodPost, "/approvals", bytes.NewReader([]byte(`{"taskId":"`+taskID+`"}`)))
	createApprovalRec := httptest.NewRecorder()
	router.ServeHTTP(createApprovalRec, createApprovalReq)
	if createApprovalRec.Code != http.StatusCreated {
		t.Fatalf("approval create status = %d body = %s", createApprovalRec.Code, createApprovalRec.Body.String())
	}
	var createApprovalResp struct {
		Approval approval.Approval `json:"approval"`
		Payment  payment.Record    `json:"payment"`
	}
	if err := json.Unmarshal(createApprovalRec.Body.Bytes(), &createApprovalResp); err != nil {
		t.Fatal(err)
	}
	if !createApprovalResp.Approval.PaymentRequired || createApprovalResp.Payment.Status != payment.StatusRequiresConfirmation {
		t.Fatalf("approval/payment = %#v %#v", createApprovalResp.Approval, createApprovalResp.Payment)
	}

	missingReq := httptest.NewRequest(http.MethodPost, "/approvals/"+createApprovalResp.Approval.ID+"/decide", bytes.NewReader([]byte(`{"approved":true}`)))
	missingRec := httptest.NewRecorder()
	router.ServeHTTP(missingRec, missingReq)
	if missingRec.Code != http.StatusForbidden || !strings.Contains(missingRec.Body.String(), "payment_pin_required") {
		t.Fatalf("missing pin status/body = %d %s", missingRec.Code, missingRec.Body.String())
	}

	wrongReq := httptest.NewRequest(http.MethodPost, "/approvals/"+createApprovalResp.Approval.ID+"/decide", bytes.NewReader([]byte(`{"approved":true,"paymentPin":"000000"}`)))
	wrongRec := httptest.NewRecorder()
	router.ServeHTTP(wrongRec, wrongReq)
	if wrongRec.Code != http.StatusForbidden || !strings.Contains(wrongRec.Body.String(), "invalid_payment_pin") {
		t.Fatalf("wrong pin status/body = %d %s", wrongRec.Code, wrongRec.Body.String())
	}

	okReq := httptest.NewRequest(http.MethodPost, "/approvals/"+createApprovalResp.Approval.ID+"/decide", bytes.NewReader([]byte(`{"approved":true,"paymentPin":"123456"}`)))
	okRec := httptest.NewRecorder()
	router.ServeHTTP(okRec, okReq)
	if okRec.Code != http.StatusOK || !strings.Contains(okRec.Body.String(), string(task.StatusConsented)) || !strings.Contains(okRec.Body.String(), string(payment.StatusConfirmedSimulated)) {
		t.Fatalf("correct pin status/body = %d %s", okRec.Code, okRec.Body.String())
	}
}
