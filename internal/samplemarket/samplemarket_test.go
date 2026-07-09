package samplemarket

import (
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/agentcard"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/resource"
)

func TestSeedAddsSamplesWithoutOverwritingExistingStores(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })

	resources := resource.NewStore(c)
	cards := agentcard.NewStore(c)
	now := time.Now().UTC().Format(time.RFC3339)
	original := resource.Resource{
		ID:             "real-gpu",
		Name:           "Real GPU",
		Type:           resource.TypeGPU,
		ProviderPubkey: "real-provider",
		PricePerUnit:   1,
		BillingUnit:    resource.BillingHour,
		Availability:   "available",
		Spec:           resource.Spec{VRAMGB: 80, GPUCount: 1},
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := resources.Save(original); err != nil {
		t.Fatal(err)
	}
	buyer, err := agentcard.NewDraft(agentcard.DraftRequest{
		Role:   agentcard.RoleBuyer,
		DockID: "real-dock",
		Buyer:  agentcard.BuyerManualFields{DisplayName: "Real Buyer", Budget: "99 USDC"},
		Diagnostics: agentcard.Diagnostics{
			CollectedAt:        now,
			ExpiresAt:          now,
			DockerAvailable:    true,
			DiagnosticsVersion: "test",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := cards.Save(buyer); err != nil {
		t.Fatal(err)
	}

	if err := Seed(resources, cards, "sample-dock", "sample-provider"); err != nil {
		t.Fatal(err)
	}
	if got := resources.List(); len(got) != 1 || got[0].ID != original.ID {
		t.Fatalf("resources overwritten or sample inserted into non-empty store: %#v", got)
	}
	storedBuyer, ok := cards.Get(agentcard.RoleBuyer)
	if !ok || storedBuyer.ManualFields.Buyer.DisplayName != "Real Buyer" || storedBuyer.ManualFields.Buyer.Budget != "99 USDC" {
		t.Fatalf("buyer card overwritten: ok=%v card=%#v", ok, storedBuyer.ManualFields.Buyer)
	}
	if _, ok := cards.Get(agentcard.RoleSeller); !ok {
		t.Fatalf("missing seller sample for absent seller role")
	}
}

func TestSeedAddsSearchableSampleResourcesAndRailCards(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })

	resources := resource.NewStore(c)
	cards := agentcard.NewStore(c)
	if err := Seed(resources, cards, "sample-dock", "sample-provider"); err != nil {
		t.Fatal(err)
	}
	if got := resources.Search(resource.TypeGPU, "48gb"); len(got) == 0 {
		t.Fatalf("expected sample GPU to be searchable by VRAM")
	}
	resp := RailCards(cards)
	if len(resp.Cards) != 6 {
		t.Fatalf("rail cards = %d, want 6", len(resp.Cards))
	}
	if resp.BuyerSettings.AuthorizationStrategy == "" || resp.BuyerSettings.RiskBoundary == "" {
		t.Fatalf("buyer settings missing policy fields: %#v", resp.BuyerSettings)
	}
}
