package product

import (
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/agent"
	"github.com/exora-dock/exora-dock/internal/cache"
)

func TestStoreSaveGetList(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	defer c.Close()

	store := NewStore(c)
	product := Product{
		ID:                   "p1",
		Name:                 "Local Listing",
		Price:                1.2,
		Image:                "/v1/ipfs/local-photo",
		Category:             "Electronics",
		FeedType:             "electronics",
		Description:          "Keyboard",
		Seller:               "seller",
		ListedAt:             time.Now().UTC().Format(time.RFC3339),
		Condition:            "New",
		SellerReputation:     90,
		QualityScore:         91,
		ShipFromCountry:      "Local",
		DeliverableCountries: []string{"Local"},
	}

	if err := store.Save(product); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	got, ok := store.Get("p1")
	if !ok {
		t.Fatal("Get() ok = false")
	}
	if got.Name != product.Name {
		t.Fatalf("Get().Name = %q, want %q", got.Name, product.Name)
	}
	if len(store.List()) != 1 {
		t.Fatalf("List() length = %d, want 1", len(store.List()))
	}
}

func TestBuildProductFromCreateRequest(t *testing.T) {
	p, err := Build(CreateRequest{
		Description:    "iPhone 15 Pro, 256GB, mint condition",
		Price:          "4.5",
		SellType:       "regular",
		ImageCIDs:      []string{"local-photo"},
		SellerPubkey:   "seller",
		ShippingMethod: "standard",
	}, agent.ReviewResult{Approved: true, Reason: "ok", MinerPubkey: "miner", Timestamp: 1})
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	if p.FeedType != "electronics" {
		t.Fatalf("FeedType = %q, want electronics", p.FeedType)
	}
	if p.Image != "/v1/ipfs/local-photo" {
		t.Fatalf("Image = %q", p.Image)
	}
}
