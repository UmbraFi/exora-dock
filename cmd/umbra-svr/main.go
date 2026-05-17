package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/UmbraFi/Umbra_SVR/internal/agent"
	"github.com/UmbraFi/Umbra_SVR/internal/cache"
	"github.com/UmbraFi/Umbra_SVR/internal/chat"
	"github.com/UmbraFi/Umbra_SVR/internal/config"
	"github.com/UmbraFi/Umbra_SVR/internal/dht"
	"github.com/UmbraFi/Umbra_SVR/internal/fetcher"
	"github.com/UmbraFi/Umbra_SVR/internal/ipfs"
	"github.com/UmbraFi/Umbra_SVR/internal/product"
	"github.com/UmbraFi/Umbra_SVR/internal/registry"
	"github.com/UmbraFi/Umbra_SVR/internal/server"
	"github.com/dgraph-io/badger/v4"
)

func main() {
	cfgPath := "config.yaml"
	if len(os.Args) > 1 {
		cfgPath = os.Args[1]
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Printf("[config] using defaults: %v", err)
	}

	c, err := cache.New(cfg.CacheMaxMB*1024, cfg.DataDir)
	if err != nil {
		log.Fatalf("cache init: %v", err)
	}
	defer c.Close()

	// Open a separate Badger DB for chat persistence
	chatDBPath := filepath.Join(cfg.DataDir, "chat")
	chatDBOpts := badger.DefaultOptions(chatDBPath).WithLoggingLevel(badger.WARNING)
	chatDB, err := badger.Open(chatDBOpts)
	if err != nil {
		log.Fatalf("chat db init: %v", err)
	}
	defer chatDB.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// DHT ring for message routing
	ring := dht.NewRing()

	// Chat store (with Badger persistence), WebSocket hub & relay
	chatStore := chat.NewStore(chatDB)
	hub := chat.NewHub()
	selfPubkey := "local"

	// Registry (optional)
	if cfg.KeyPath != "" && cfg.ProgramID != "" {
		reg, err := registry.New(cfg.RPC, cfg.ProgramID, cfg.KeyPath)
		if err != nil {
			log.Printf("[registry] skipped: %v", err)
		} else {
			selfPubkey = reg.PublicKey().String()
			endpoint := "http://localhost" + cfg.ListenAddr
			if err := reg.Register(ctx, endpoint); err != nil {
				log.Printf("[registry] register failed: %v", err)
			}
			ring.AddMiner(dht.Miner{
				Pubkey:   selfPubkey,
				Endpoint: endpoint,
				Rating:   100,
			})
		}
	}

	selfPubkey = ensureLocalMiner(ring, selfPubkey, cfg.ListenAddr)

	// IPFS client & pin store
	ipfsClient := ipfs.NewClient(cfg.IPFSApiURL, filepath.Join(cfg.DataDir, "media"))
	pinStore := ipfs.NewPinStore(c)
	productStore := product.NewStore(c)

	// Review agent
	reviewAgent := agent.NewReviewAgent(cfg.LLMBaseURL, cfg.LLMAPIKey, cfg.LLMModel, ipfsClient)
	if reviewAgent.Configured() {
		log.Printf("[agent] review agent configured with model %s", cfg.LLMModel)
	}

	relay := chat.NewRelay(ring, chatStore, hub, selfPubkey)

	// Wire up offline message delivery on WebSocket connect
	hub.OnConnect = relay.DeliverOffline

	// Wire up ACK handling: client ACK -> mark order as read
	hub.SetOnAck(chatStore.MarkRead)

	// Start relay sync
	go relay.RunSync(ctx)

	// Fetcher
	if cfg.RPC != "" {
		f := fetcher.New(cfg.RPC, c, cfg.FetchInterv)
		go f.Run(ctx)
	}

	// HTTP + WebSocket server
	srv := &http.Server{
		Addr:    cfg.ListenAddr,
		Handler: server.New(c, chatStore, relay, hub, ring, ipfsClient, pinStore, reviewAgent, productStore, selfPubkey),
	}

	go func() {
		log.Printf("[server] listening on %s", cfg.ListenAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("[server] shutting down...")
	cancel()
	srv.Shutdown(context.Background())
}

func ensureLocalMiner(ring *dht.Ring, selfPubkey string, listenAddr string) string {
	if len(ring.Miners()) > 0 {
		return selfPubkey
	}
	if selfPubkey == "" || selfPubkey == "local" {
		selfPubkey = "local-dev-miner"
	}
	ring.AddMiner(dht.Miner{
		Pubkey:   selfPubkey,
		Endpoint: "http://localhost" + listenAddr,
		Rating:   100,
	})
	log.Printf("[registry] dev miner active: %s", selfPubkey)
	return selfPubkey
}
