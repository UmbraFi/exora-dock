package orderplan

import (
	"fmt"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/market"
)

func TestCreateCapsOptionsAtMarketMaximum(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	options := make([]market.OrderDraftOption, 0, market.MaxOrderOptions+2)
	for i := 0; i < market.MaxOrderOptions+2; i++ {
		options = append(options, market.OrderDraftOption{
			OptionID:       fmt.Sprintf("opt_%d", i+1),
			ResourceID:     fmt.Sprintf("res_%d", i+1),
			ProviderPubkey: "provider",
		})
	}

	plan, err := NewStore(c).Create(CreateRequest{
		Query:   "find GPU server",
		Options: options,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Options) != market.MaxOrderOptions {
		t.Fatalf("options = %d, want %d", len(plan.Options), market.MaxOrderOptions)
	}
}
