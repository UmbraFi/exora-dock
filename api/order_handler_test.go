package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	orderpkg "github.com/exora-dock/exora-dock/internal/order"
	"github.com/exora-dock/exora-dock/internal/product"
	"github.com/go-chi/chi/v5"
)

func TestOrderHandlersCreateListAndSimulatePayment(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	defer c.Close()

	products := product.NewStore(c)
	if err := products.Save(product.Product{
		ID:           "product-1",
		Name:         "Local Phone",
		Image:        "/v1/ipfs/local-phone.jpg",
		Price:        2.5,
		SellerPubkey: "seller-1",
	}); err != nil {
		t.Fatalf("Save product error = %v", err)
	}
	orders := orderpkg.NewStore(c)

	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, products, orders, nil, nil, nil, "local-dev-miner")
	router := chi.NewRouter()
	router.Post("/orders", handler.CreateOrders)
	router.Get("/orders", handler.ListOrders)
	router.Get("/orders/{id}", handler.GetOrder)
	router.Post("/orders/{id}/simulate-payment", handler.SimulateOrderPayment)
	router.Post("/orders/{id}/status", handler.UpdateOrderStatus)

	createBody := []byte(`{"buyerPubkey":"buyer-1","items":[{"productId":"product-1","quantity":2}]}`)
	createReq := httptest.NewRequest(http.MethodPost, "/orders", bytes.NewReader(createBody))
	createRec := httptest.NewRecorder()
	router.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body = %s", createRec.Code, createRec.Body.String())
	}
	var createResp struct {
		Orders []orderpkg.Order `json:"orders"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("create json error = %v", err)
	}
	if len(createResp.Orders) != 1 {
		t.Fatalf("orders length = %d, want 1", len(createResp.Orders))
	}
	orderID := createResp.Orders[0].ID

	getReq := httptest.NewRequest(http.MethodGet, "/orders/"+orderID, nil)
	getRec := httptest.NewRecorder()
	router.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("get status = %d body = %s", getRec.Code, getRec.Body.String())
	}
	var getResp orderpkg.Order
	if err := json.Unmarshal(getRec.Body.Bytes(), &getResp); err != nil {
		t.Fatalf("get json error = %v", err)
	}
	if getResp.ID != orderID {
		t.Fatalf("get order id = %q, want %q", getResp.ID, orderID)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/orders?party=buyer-1&role=buyer", nil)
	listRec := httptest.NewRecorder()
	router.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("list status = %d", listRec.Code)
	}
	badListReq := httptest.NewRequest(http.MethodGet, "/orders?role=buyer", nil)
	badListRec := httptest.NewRecorder()
	router.ServeHTTP(badListRec, badListReq)
	if badListRec.Code != http.StatusBadRequest {
		t.Fatalf("bad list status = %d, want 400", badListRec.Code)
	}

	badRoleReq := httptest.NewRequest(http.MethodGet, "/orders?party=buyer-1&role=viewer", nil)
	badRoleRec := httptest.NewRecorder()
	router.ServeHTTP(badRoleRec, badRoleReq)
	if badRoleRec.Code != http.StatusBadRequest {
		t.Fatalf("bad role status = %d, want 400", badRoleRec.Code)
	}

	payReq := httptest.NewRequest(http.MethodPost, "/orders/"+orderID+"/simulate-payment", nil)
	payRec := httptest.NewRecorder()
	router.ServeHTTP(payRec, payReq)
	if payRec.Code != http.StatusOK {
		t.Fatalf("pay status = %d body = %s", payRec.Code, payRec.Body.String())
	}
	if !strings.Contains(payRec.Body.String(), string(orderpkg.StatusPaidSimulated)) {
		t.Fatalf("pay body = %s", payRec.Body.String())
	}

	statusReq := httptest.NewRequest(http.MethodPost, "/orders/"+orderID+"/status", bytes.NewReader([]byte(`{"status":"seller_confirmed"}`)))
	statusRec := httptest.NewRecorder()
	router.ServeHTTP(statusRec, statusReq)
	if statusRec.Code != http.StatusOK {
		t.Fatalf("status update = %d body = %s", statusRec.Code, statusRec.Body.String())
	}
	var statusResp struct {
		Order orderpkg.Order `json:"order"`
	}
	if err := json.Unmarshal(statusRec.Body.Bytes(), &statusResp); err != nil {
		t.Fatalf("status json error = %v", err)
	}
	if statusResp.Order.Status != orderpkg.StatusSellerConfirmed {
		t.Fatalf("status = %s, want %s", statusResp.Order.Status, orderpkg.StatusSellerConfirmed)
	}

	badStatusReq := httptest.NewRequest(http.MethodPost, "/orders/"+orderID+"/status", bytes.NewReader([]byte(`{"status":"lost"}`)))
	badStatusRec := httptest.NewRecorder()
	router.ServeHTTP(badStatusRec, badStatusReq)
	if badStatusRec.Code != http.StatusBadRequest {
		t.Fatalf("bad status update = %d, want 400", badStatusRec.Code)
	}

	missingReq := httptest.NewRequest(http.MethodGet, "/orders/missing", nil)
	missingRec := httptest.NewRecorder()
	router.ServeHTTP(missingRec, missingReq)
	if missingRec.Code != http.StatusNotFound {
		t.Fatalf("missing get status = %d, want 404", missingRec.Code)
	}
}

func TestOrderHandlersRejectInvalidCreate(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	defer c.Close()

	products := product.NewStore(c)
	orders := orderpkg.NewStore(c)
	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, products, orders, nil, nil, nil, "local-dev-miner")
	router := chi.NewRouter()
	router.Post("/orders", handler.CreateOrders)

	req := httptest.NewRequest(http.MethodPost, "/orders", bytes.NewReader([]byte(`{"buyerPubkey":"","items":[]}`)))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
