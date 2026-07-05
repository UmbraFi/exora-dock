package market

import (
	"testing"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/resource"
)

func TestNormalizeChineseGPUVRAMQuery(t *testing.T) {
	normalized := Normalize(SearchRequest{Query: "帮我找 20G 显存以上服务器"})
	if normalized.Type != resource.TypeGPU {
		t.Fatalf("type = %q, want gpu", normalized.Type)
	}
	if normalized.MinVRAMGB != 20 {
		t.Fatalf("min vram = %d, want 20", normalized.MinVRAMGB)
	}
}

func TestSearchRanksMatchingGPUSellers(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	store := resource.NewStore(c)
	if err := store.Save(resource.Resource{
		ID:             "gpu-48",
		Name:           "RTX 6000 Ada",
		Type:           resource.TypeGPU,
		Provider:       "provider-gpu",
		ProviderPubkey: "provider-gpu",
		PricePerUnit:   2.5,
		BillingUnit:    resource.BillingHour,
		Availability:   "available",
		QualityScore:   90,
		Reputation:     92,
		Spec: resource.Spec{
			GPUModel: "RTX 6000 Ada",
			GPUCount: 1,
			VRAMGB:   48,
		},
		UpdatedAt: "2026-01-01T00:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(resource.Resource{
		ID:             "gpu-16",
		Name:           "RTX 4080",
		Type:           resource.TypeGPU,
		Provider:       "provider-small",
		ProviderPubkey: "provider-small",
		Availability:   "available",
		QualityScore:   90,
		Reputation:     92,
		Spec:           resource.Spec{VRAMGB: 16, GPUCount: 1},
		UpdatedAt:      "2026-01-02T00:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}

	result := Search(SearchRequest{Query: "帮我找 20G 显存以上服务器"}, store)
	if len(result.Candidates) != 1 {
		t.Fatalf("candidates = %d, want 1: %#v", len(result.Candidates), result.Candidates)
	}
	if result.Candidates[0].ProviderPubkey != "provider-gpu" {
		t.Fatalf("provider = %q", result.Candidates[0].ProviderPubkey)
	}
}

func TestSearchPreparesTopSixOrderDraftOptions(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	store := resource.NewStore(c)
	for i := 0; i < 6; i++ {
		if err := store.Save(resource.Resource{
			ID:             "gpu-option-" + string(rune('a'+i)),
			Name:           "GPU Option",
			Type:           resource.TypeGPU,
			ProviderPubkey: "provider-option",
			PricePerUnit:   float64(i + 1),
			BillingUnit:    resource.BillingHour,
			Availability:   "available",
			QualityScore:   90 - i,
			Reputation:     90 - i,
			Spec:           resource.Spec{VRAMGB: 24 + i, GPUCount: 1},
			UpdatedAt:      "2026-01-01T00:00:00Z",
		}); err != nil {
			t.Fatal(err)
		}
	}

	result := Search(SearchRequest{
		Query:               "find GPU servers with at least 20GB VRAM",
		RequesterPubkey:     "user-1",
		AgentID:             "codex",
		MaxResults:          6,
		PrepareOrderOptions: true,
		MaxOptions:          99,
	}, store)
	if len(result.OrderDraftOptions) != 6 {
		t.Fatalf("options = %d, want 6", len(result.OrderDraftOptions))
	}
	first := result.OrderDraftOptions[0]
	if first.OptionID != "opt_1" || first.Draft.RequesterPubkey != "user-1" || first.Draft.AgentID != "codex" {
		t.Fatalf("first option = %#v", first)
	}
	createReq := first.Draft.TaskCreateRequest()
	if createReq.Type != "compute.gpu" || createReq.Requirements["minVramGb"] != 20 {
		t.Fatalf("draft is not task-create compatible: %#v", createReq)
	}
	if first.PriceSnapshot.ResourceHash == "" || first.ExpiresAt == "" {
		t.Fatalf("missing price snapshot metadata: %#v", first.PriceSnapshot)
	}
}

func TestSearchPreparesFewerOrderOptionsWhenOnlyFewerMatch(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	store := resource.NewStore(c)
	for i := 0; i < 2; i++ {
		if err := store.Save(resource.Resource{
			ID:             "small-pool-" + string(rune('a'+i)),
			Name:           "GPU Option",
			Type:           resource.TypeGPU,
			ProviderPubkey: "provider-option",
			PricePerUnit:   float64(i + 1),
			BillingUnit:    resource.BillingHour,
			Availability:   "available",
			QualityScore:   90 - i,
			Reputation:     90 - i,
			Spec:           resource.Spec{VRAMGB: 24 + i, GPUCount: 1},
			UpdatedAt:      "2026-01-01T00:00:00Z",
		}); err != nil {
			t.Fatal(err)
		}
	}

	result := Search(SearchRequest{
		Query:               "find GPU servers with at least 20GB VRAM",
		MaxResults:          10,
		PrepareOrderOptions: true,
		MaxOptions:          5,
	}, store)
	if len(result.OrderDraftOptions) != 2 {
		t.Fatalf("options = %d, want 2", len(result.OrderDraftOptions))
	}
}
