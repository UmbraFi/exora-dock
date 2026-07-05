package order

import (
	"testing"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/product"
)

func TestCreateListAndSimulatePayment(t *testing.T) {
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
		Seller:       "seller-1",
		SellerPubkey: "seller-1",
	}); err != nil {
		t.Fatalf("Save product error = %v", err)
	}

	store := NewStore(c)
	orders, err := store.Create(CreateRequest{
		BuyerPubkey: "buyer-1",
		Items:       []CreateItem{{ProductID: "product-1", Quantity: 2}},
	}, products)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if len(orders) != 1 {
		t.Fatalf("len(orders) = %d, want 1", len(orders))
	}
	o := orders[0]
	if o.Status != StatusPendingPayment {
		t.Fatalf("status = %q, want %q", o.Status, StatusPendingPayment)
	}
	if o.TotalPrice != 5 {
		t.Fatalf("total = %v, want 5", o.TotalPrice)
	}
	if o.ChatOrderID != o.ID {
		t.Fatalf("chatOrderID = %q, want %q", o.ChatOrderID, o.ID)
	}

	buyerOrders := store.ListByParty("buyer-1", "buyer")
	if len(buyerOrders) != 1 || buyerOrders[0].ID != o.ID {
		t.Fatalf("buyer orders = %#v", buyerOrders)
	}
	sellerOrders := store.ListByParty("seller-1", "seller")
	if len(sellerOrders) != 1 || sellerOrders[0].ID != o.ID {
		t.Fatalf("seller orders = %#v", sellerOrders)
	}

	paid, err := store.SimulatePayment(o.ID)
	if err != nil {
		t.Fatalf("SimulatePayment() error = %v", err)
	}
	if paid.Status != StatusPaidSimulated {
		t.Fatalf("paid status = %q, want %q", paid.Status, StatusPaidSimulated)
	}
	if paid.PaymentRef == "" {
		t.Fatalf("payment ref is empty")
	}
}

func TestCreateRejectsInvalidRequests(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	defer c.Close()

	products := product.NewStore(c)
	if err := products.Save(product.Product{
		ID:           "product-1",
		Name:         "Local Phone",
		Price:        2.5,
		SellerPubkey: "seller-1",
	}); err != nil {
		t.Fatalf("Save product error = %v", err)
	}

	store := NewStore(c)
	cases := []struct {
		name string
		req  CreateRequest
	}{
		{"empty buyer", CreateRequest{Items: []CreateItem{{ProductID: "product-1", Quantity: 1}}}},
		{"missing product", CreateRequest{BuyerPubkey: "buyer-1", Items: []CreateItem{{ProductID: "missing", Quantity: 1}}}},
		{"seller is buyer", CreateRequest{BuyerPubkey: "seller-1", Items: []CreateItem{{ProductID: "product-1", Quantity: 1}}}},
		{"zero quantity", CreateRequest{BuyerPubkey: "buyer-1", Items: []CreateItem{{ProductID: "product-1", Quantity: 0}}}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := store.Create(tc.req, products); err == nil {
				t.Fatalf("Create() error = nil, want error")
			}
		})
	}
}

func TestUpdateStatusRejectsInvalidTransition(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	defer c.Close()

	store := NewStore(c)
	o := Order{
		ID:           "order-1",
		ProductID:    "product-1",
		BuyerPubkey:  "buyer-1",
		SellerPubkey: "seller-1",
		Status:       StatusPendingPayment,
		PaymentMode:  "simulated",
		ChatOrderID:  "order-1",
	}
	if err := store.Save(o); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	if _, err := store.UpdateStatus(o.ID, StatusShipped); err == nil {
		t.Fatalf("UpdateStatus() error = nil, want invalid transition")
	}
	if _, err := store.UpdateStatus(o.ID, StatusPaidSimulated); err != nil {
		t.Fatalf("UpdateStatus() valid transition error = %v", err)
	}
}
