package fetcher

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/UmbraFi/Umbra_SVR/internal/cache"
	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

type Fetcher struct {
	client   *rpc.Client
	cache    *cache.Cache
	interval time.Duration
	// Accounts to watch — populated via API or config
	watchAccounts []solana.PublicKey
}

func New(rpcURL string, c *cache.Cache, intervalSec int) *Fetcher {
	return &Fetcher{
		client:   rpc.New(rpcURL),
		cache:    c,
		interval: time.Duration(intervalSec) * time.Second,
	}
}

func (f *Fetcher) AddWatchAccount(pubkey solana.PublicKey) {
	f.watchAccounts = append(f.watchAccounts, pubkey)
}

func (f *Fetcher) Run(ctx context.Context) {
	ticker := time.NewTicker(f.interval)
	defer ticker.Stop()

	log.Println("[fetcher] started")
	f.fetchAll(ctx)

	for {
		select {
		case <-ctx.Done():
			log.Println("[fetcher] stopped")
			return
		case <-ticker.C:
			f.fetchAll(ctx)
		}
	}
}

func (f *Fetcher) fetchAll(ctx context.Context) {
	for _, pk := range f.watchAccounts {
		info, err := f.client.GetAccountInfo(ctx, pk)
		if err != nil {
			log.Printf("[fetcher] account %s: %v", pk, err)
			continue
		}
		data, _ := json.Marshal(info)
		f.cache.Set(fmt.Sprintf("account:%s", pk), data, 30*time.Second)
	}
}
