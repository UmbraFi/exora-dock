package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/dgraph-io/badger/v4"
	"github.com/exora-dock/exora-dock/internal/agent"
	"github.com/exora-dock/exora-dock/internal/agentcard"
	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/exora-dock/exora-dock/internal/config"
	"github.com/exora-dock/exora-dock/internal/delegation"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/discovery"
	"github.com/exora-dock/exora-dock/internal/fetcher"
	"github.com/exora-dock/exora-dock/internal/ipfs"
	"github.com/exora-dock/exora-dock/internal/lease"
	"github.com/exora-dock/exora-dock/internal/localauth"
	"github.com/exora-dock/exora-dock/internal/mcp"
	"github.com/exora-dock/exora-dock/internal/negotiation"
	orderpkg "github.com/exora-dock/exora-dock/internal/order"
	"github.com/exora-dock/exora-dock/internal/orderplan"
	"github.com/exora-dock/exora-dock/internal/payment"
	"github.com/exora-dock/exora-dock/internal/paymentpin"
	"github.com/exora-dock/exora-dock/internal/product"
	"github.com/exora-dock/exora-dock/internal/registry"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/exora-dock/exora-dock/internal/samplemarket"
	"github.com/exora-dock/exora-dock/internal/server"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/exora-dock/exora-dock/internal/wallet"
	"golang.org/x/term"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "wallet" {
		if err := runWalletCommand(os.Args[2:]); err != nil {
			log.Fatalf("wallet: %v", err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "discover" {
		if err := runDiscoverCommand(); err != nil {
			log.Fatalf("discover: %v", err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "mcp" {
		if err := runMCPCommand(os.Args[2:]); err != nil {
			log.Fatalf("mcp: %v", err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "approvals" {
		if err := runApprovalsCommand(os.Args[2:]); err != nil {
			log.Fatalf("approvals: %v", err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "auth" {
		if err := runAuthCommand(os.Args[2:]); err != nil {
			log.Fatalf("auth: %v", err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "payment-pin" {
		if err := runPaymentPINCommand(os.Args[2:]); err != nil {
			log.Fatalf("payment-pin: %v", err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "order-plans" {
		if err := runOrderPlansCommand(os.Args[2:]); err != nil {
			log.Fatalf("order-plans: %v", err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "agent" {
		if err := runAgentCommand(os.Args[2:]); err != nil {
			log.Fatalf("agent: %v", err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "negotiations" {
		if err := runNegotiationsCommand(os.Args[2:]); err != nil {
			log.Fatalf("negotiations: %v", err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "cloud" {
		if err := runCloudCommand(os.Args[2:]); err != nil {
			log.Fatalf("cloud: %v", err)
		}
		return
	}

	cfgPath := "config.yaml"
	if len(os.Args) > 1 {
		cfgPath = os.Args[1]
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Printf("[config] using defaults: %v", err)
	}
	if err := os.MkdirAll(cfg.DataDir, 0700); err != nil {
		log.Fatalf("data dir init: %v", err)
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
	orderStore := orderpkg.NewStore(c)
	resourceStore := resource.NewStore(c)
	agentCardStore := agentcard.NewStore(c)
	delegationStore := delegation.NewStore(c)
	leaseStore := lease.NewStore(c)
	walletStore := wallet.NewStore(cfg.WalletPath)
	authStore, err := localauth.LoadOrCreate(cfg.AuthTokenPath)
	if err != nil {
		log.Fatalf("auth init: %v", err)
	}
	paymentPINStore := paymentpin.New(cfg.PaymentPINPath)
	paymentStore := payment.NewStore(c)
	orderPlanStore := orderplan.NewStore(c)
	negotiationStore := negotiation.NewStore(c)
	agentRunStore := agent.NewRunStore(c)
	taskStore := task.NewStore(c, filepath.Join(cfg.DataDir, "artifacts"))
	approvalStore := approval.NewStore(c)
	taskExecutor := task.NewExecutor(task.ExecutorConfig{
		Enabled:         cfg.Provider.AllowCommandExecutor,
		WorkspaceDir:    cfg.Provider.WorkspaceDir,
		AllowedCommands: cfg.Provider.AllowedCommands,
		MaxJobSeconds:   cfg.Provider.MaxJobSeconds,
		Docker: task.DockerExecutorConfig{
			Enabled:             cfg.Provider.Docker.Enabled,
			DefaultImage:        cfg.Provider.Docker.DefaultImage,
			AllowedImages:       cfg.Provider.Docker.AllowedImages,
			NetworkMode:         cfg.Provider.Docker.NetworkMode,
			AllowedNetworkModes: cfg.Provider.Docker.AllowedNetworkModes,
			AllowGPU:            cfg.Provider.Docker.AllowGPU,
			MaxCPUs:             cfg.Provider.Docker.MaxCPUs,
			MaxMemoryMB:         cfg.Provider.Docker.MaxMemoryMB,
			PullPolicy:          cfg.Provider.Docker.PullPolicy,
		},
	})

	buyerLLMConfig := llmClientConfigFromRole(cfg.BuyerLLM)

	// Review agent
	reviewAgent := agent.NewReviewAgentWithConfig(buyerLLMConfig, ipfsClient)
	if reviewAgent.Configured() {
		log.Printf("[agent] review agent configured with model %s", cfg.BuyerLLM.ResearchModel)
	}

	sellerProvider := strings.TrimSpace(cfg.SellerAgent.ProviderPubkey)
	if sellerProvider == "" {
		sellerProvider = selfPubkey
	}
	sampleDockID := strings.TrimSpace(cfg.DockID)
	if sampleDockID == "" {
		sampleDockID = selfPubkey
	}
	if err := samplemarket.Seed(resourceStore, agentCardStore, sampleDockID, sellerProvider); err != nil {
		log.Printf("[sample-market] seed skipped: %v", err)
	}
	sellerAgent := agent.NewSellerAgent(agent.SellerAgentConfig{
		Enabled:                    cfg.SellerAgent.Enabled,
		AutoQuote:                  cfg.SellerAgent.AutoQuote,
		AutoAcceptLowRisk:          cfg.SellerAgent.AutoAcceptLowRisk,
		AutoCompleteTextTasks:      cfg.SellerAgent.AutoCompleteTextTasks,
		ProviderPubkey:             sellerProvider,
		PollInterval:               time.Duration(cfg.SellerAgent.PollIntervalSec) * time.Second,
		DefaultQuotePrice:          cfg.SellerAgent.DefaultQuotePrice,
		DefaultQuoteCurrency:       cfg.SellerAgent.DefaultQuoteCurrency,
		DefaultEstimatedSec:        cfg.SellerAgent.DefaultEstimatedSec,
		DataDir:                    cfg.DataDir,
		PricingPolicyPath:          filepath.Join(cfg.DataDir, "seller_pricing_policy.json"),
		LLMBaseURL:                 cfg.SellerLLM.BaseURL,
		LLMAPIKey:                  cfg.SellerLLM.APIKey,
		LLMProviderPreset:          cfg.SellerLLM.ProviderPreset,
		LLMModel:                   cfg.SellerLLM.Model,
		LLMWireAPI:                 cfg.SellerLLM.WireAPI,
		LLMCapabilities:            llmCapabilitiesFromConfig(cfg.SellerLLM.Capabilities),
		LLMExtraHeaders:            cfg.SellerLLM.ExtraHeaders,
		LLMResearchModel:           cfg.SellerLLM.ResearchModel,
		LLMResearchReasoningEffort: cfg.SellerLLM.ResearchReasoningEffort,
		LLMUtilityModel:            cfg.SellerLLM.UtilityModel,
		LLMUtilityReasoningEffort:  cfg.SellerLLM.UtilityReasoningEffort,
		LLMDisableResponseStorage:  cfg.SellerLLM.DisableResponseStorage,
	}, taskStore, resourceStore).AttachNegotiations(negotiationStore).AttachExecutor(taskExecutor)
	if sellerAgent.Configured() {
		go sellerAgent.Run(ctx)
	} else if cfg.SellerAgent.Enabled {
		log.Printf("[seller-agent] enabled but missing LLM API configuration")
	}

	relay := chat.NewRelay(ring, chatStore, hub, selfPubkey)
	discoveryManifest := discovery.Build(cfg.ListenAddr, selfPubkey)
	discoveryManifest.ConfigPath = cfgPath
	if discoveryManifest.ExecutablePath != "" {
		discoveryManifest.StartCommand = []string{discoveryManifest.ExecutablePath, cfgPath}
		discoveryManifest.MCPCommand = []string{discoveryManifest.ExecutablePath, "mcp", cfgPath}
		discoveryManifest.OpenCodeConfig = discovery.OpenCodeConfig(discoveryManifest.MCPCommand)
	}
	discoveryManifest.DiscoveryFiles = discovery.CandidatePaths()

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
		Addr: cfg.ListenAddr,
		Handler: server.New(c, chatStore, relay, hub, ring, ipfsClient, pinStore, reviewAgent, productStore, orderStore, resourceStore, delegationStore, leaseStore, selfPubkey, server.RuntimeStores{
			Wallet:         walletStore,
			Tasks:          taskStore,
			Approvals:      approvalStore,
			OrderPlans:     orderPlanStore,
			Negotiations:   negotiationStore,
			PaymentPIN:     paymentPINStore,
			Payments:       paymentStore,
			TaskExecutor:   taskExecutor,
			Discovery:      &discoveryManifest,
			AgentCards:     agentCardStore,
			AgentRuns:      agentRunStore,
			AgentLLMConfig: buyerLLMConfig,
			CardDiagnostics: agentcard.DiagnosticsConfig{
				LLMProvider:        cfg.BuyerLLM.BaseURL,
				LLMConfigured:      strings.TrimSpace(cfg.BuyerLLM.APIKey) != "" || providerDoesNotRequireAPIKey(cfg.BuyerLLM.ProviderPreset, cfg.BuyerLLM.BaseURL),
				SellerAgentEnabled: cfg.SellerAgent.Enabled,
				CommandExecutor:    cfg.Provider.AllowCommandExecutor,
				MCPAvailable:       discoveryManifest.ExecutablePath != "",
			},
			CardPublisher: agentcard.CloudPublisher{
				CloudURL:  cfg.CloudURL,
				TokenPath: cfg.CloudTokenPath,
				DockID:    cfg.DockID,
			},
			EscrowProgramID: cfg.EscrowProgramID,
			SolanaNetwork:   cfg.SolanaNetwork,
			USDCMint:        cfg.USDCMint,
			USDCDecimals:    cfg.USDCDecimals,
			CloudURL:        cfg.CloudURL,
			CloudTokenPath:  cfg.CloudTokenPath,
			DockID:          cfg.DockID,
			ConfigPath:      cfgPath,
			Auth:            authStore,
			AllowedOrigins:  cfg.CORSAllowedOrigins,
		}),
	}

	listener, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		log.Fatalf("server listen: %v", err)
	}
	if paths, err := discovery.Write(discoveryManifest); err != nil {
		log.Printf("[discovery] manifest unavailable: %v", err)
	} else {
		log.Printf("[discovery] manifest written: %s", strings.Join(paths, ", "))
	}

	go func() {
		log.Printf("[server] listening on %s", cfg.ListenAddr)
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()
	startCloudPoller(ctx, cfg, selfPubkey, authStore)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("[server] shutting down...")
	cancel()
	srv.Shutdown(context.Background())
}

func runCloudCommand(args []string) error {
	if len(args) == 0 || args[0] != "link" {
		return fmt.Errorf("usage: exora-dock cloud link")
	}
	cfgPath := "config.yaml"
	if raw := strings.TrimSpace(os.Getenv("EXORA_CONFIG")); raw != "" {
		cfgPath = raw
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Printf("[config] using defaults for cloud link: %v", err)
	}
	cloudURL := strings.TrimSpace(cfg.CloudURL)
	if cloudURL == "" {
		cloudURL = "http://127.0.0.1:8090"
	}
	dockID := strings.TrimSpace(cfg.DockID)
	if dockID == "" {
		dockID = "local-dev-miner"
	}
	link, token, err := cloudlink.Link(context.Background(), cloudURL, cfg.CloudTokenPath, cloudlink.DeviceLinkRequest{
		DockID:        dockID,
		DisplayName:   "Exora Dock",
		Mode:          cfg.Mode,
		PublicBaseURL: discovery.BaseURL(cfg.ListenAddr),
		Version:       "0.1.0",
		Capabilities:  []string{"remote.console", "approvals.queue", "mcp.stdio"},
	}, 10*time.Minute, nil)
	if err != nil {
		_ = printJSON(map[string]any{
			"status":          "pending",
			"userCode":        link.UserCode,
			"verificationUrl": link.VerificationURL,
			"expiresAt":       link.ExpiresAt,
			"message":         err.Error(),
		})
		return nil
	}
	return printJSON(map[string]any{
		"status":          token.Status,
		"dockId":          token.DockID,
		"accountId":       token.AccountID,
		"tokenPath":       cfg.CloudTokenPath,
		"userCode":        link.UserCode,
		"verificationUrl": link.VerificationURL,
	})
}

func providerDoesNotRequireAPIKey(preset, baseURL string) bool {
	normalized := strings.ToLower(strings.TrimSpace(preset))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	base := strings.ToLower(strings.TrimSpace(baseURL))
	if strings.Contains(base, "127.0.0.1") || strings.Contains(base, "localhost") || strings.Contains(base, "[::1]") {
		return true
	}
	switch normalized {
	case "litellm", "ollama", "lm_studio", "vllm", "localai", "llama_cpp", "textgen", "koboldcpp", "custom_openai_compatible":
		return true
	default:
		return false
	}
}

func llmClientConfigFromRole(role config.RoleLLMConfig) agent.LLMClientConfig {
	return agent.LLMClientConfig{
		BaseURL:                 role.BaseURL,
		APIKey:                  role.APIKey,
		ProviderPreset:          role.ProviderPreset,
		WireAPI:                 role.WireAPI,
		Capabilities:            llmCapabilitiesFromConfig(role.Capabilities),
		ExtraHeaders:            role.ExtraHeaders,
		DisableResponseStorage:  role.DisableResponseStorage,
		ResearchModel:           role.ResearchModel,
		ResearchReasoningEffort: role.ResearchReasoningEffort,
		UtilityModel:            role.UtilityModel,
		UtilityReasoningEffort:  role.UtilityReasoningEffort,
	}
}

func llmCapabilitiesFromConfig(caps config.LLMCapabilities) agent.LLMCapabilities {
	return agent.LLMCapabilities{
		SupportsResponses:          caps.SupportsResponses,
		SupportsChatCompletions:    caps.SupportsChatCompletions,
		SupportsSystemMessage:      caps.SupportsSystemMessage,
		SupportsJSONResponseFormat: caps.SupportsJSONResponseFormat,
		SupportsStreaming:          caps.SupportsStreaming,
		SupportsTools:              caps.SupportsTools,
		SupportsReasoningEffort:    caps.SupportsReasoningEffort,
	}
}

func runWalletCommand(args []string) error {
	cfgPath := "config.yaml"
	if raw := strings.TrimSpace(os.Getenv("EXORA_CONFIG")); raw != "" {
		cfgPath = raw
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Printf("[config] using defaults: %v", err)
	}
	store := wallet.NewStore(cfg.WalletPath)
	if len(args) == 0 {
		return fmt.Errorf("usage: exora-dock wallet create|show")
	}
	switch args[0] {
	case "create":
		status, err := store.Create(wallet.CreateRequest{})
		if err != nil {
			return err
		}
		return printJSON(status)
	case "show":
		status, err := store.Current()
		if err != nil {
			return err
		}
		return printJSON(status)
	default:
		return fmt.Errorf("unknown wallet command: %s", args[0])
	}
}

func runDiscoverCommand() error {
	manifest, path, err := discovery.ReadFirst()
	if err != nil {
		return err
	}
	return printJSON(map[string]any{
		"manifestPath": path,
		"manifest":     manifest,
	})
}

func runMCPCommand(args []string) error {
	cfgPath := "config.yaml"
	if len(args) > 0 && strings.TrimSpace(args[0]) != "" {
		cfgPath = args[0]
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Printf("[config] using defaults for MCP fallback: %v", err)
	}
	executable, _ := os.Executable()
	startCommand := []string{}
	if strings.TrimSpace(executable) != "" {
		startCommand = []string{executable, cfgPath}
	}
	cwd, _ := os.Getwd()
	role := strings.TrimSpace(os.Getenv("EXORA_MCP_ROLE"))
	if role == "" {
		role = "buyer"
	}
	clientName := strings.TrimSpace(os.Getenv("EXORA_MCP_CLIENT_NAME"))
	if clientName == "" {
		clientName = "Local Agent"
	}
	server := mcp.NewServer(mcp.Options{
		ConfigPath:     cfgPath,
		BaseURL:        discovery.BaseURL(cfg.ListenAddr),
		StartCommand:   startCommand,
		AgentToken:     loadAgentToken(cfg),
		ClientCWD:      cwd,
		ConnectionRole: role,
		ClientName:     clientName,
	})
	return server.Serve(context.Background(), os.Stdin, os.Stdout)
}

func runAuthCommand(args []string) error {
	if len(args) == 0 || args[0] != "status" {
		return fmt.Errorf("usage: exora-dock auth status")
	}
	cfgPath := "config.yaml"
	if raw := strings.TrimSpace(os.Getenv("EXORA_CONFIG")); raw != "" {
		cfgPath = raw
	}
	if manifest, _, err := discovery.ReadFirst(); err == nil && strings.TrimSpace(manifest.ConfigPath) != "" {
		cfgPath = manifest.ConfigPath
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Printf("[config] using defaults for auth status: %v", err)
	}
	store, err := localauth.LoadOrCreate(cfg.AuthTokenPath)
	if err != nil {
		return err
	}
	tokens := store.Tokens()
	return printJSON(map[string]any{
		"authPath":       store.Path(),
		"ownerTokenSet":  tokens.OwnerToken != "",
		"agentTokenSet":  tokens.AgentToken != "",
		"ownerTokenHint": tokenHint(tokens.OwnerToken),
		"agentTokenHint": tokenHint(tokens.AgentToken),
		"createdAt":      tokens.CreatedAt,
		"updatedAt":      tokens.UpdatedAt,
	})
}

func runPaymentPINCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: exora-dock payment-pin status|set")
	}
	switch args[0] {
	case "status":
		return requestDaemonJSON(http.MethodGet, "/v1/payment-pin/status", nil, "owner")
	case "set":
		pin, err := paymentPINFromEnvOrPrompt(true)
		if err != nil {
			return err
		}
		return requestDaemonJSON(http.MethodPost, "/v1/payment-pin/set", map[string]any{"pin": pin}, "owner")
	default:
		return fmt.Errorf("unknown payment-pin command: %s", args[0])
	}
}

func runOrderPlansCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: exora-dock order-plans list|get|select|cancel")
	}
	switch args[0] {
	case "list":
		status := "pending_selection"
		if len(args) > 1 && strings.TrimSpace(args[1]) != "" {
			status = strings.TrimSpace(args[1])
		}
		return requestDaemonJSON(http.MethodGet, "/v1/order-plans?status="+url.QueryEscape(status), nil, "owner")
	case "get":
		if len(args) < 2 {
			return fmt.Errorf("usage: exora-dock order-plans get <plan-id>")
		}
		return requestDaemonJSON(http.MethodGet, "/v1/order-plans/"+url.PathEscape(args[1]), nil, "owner")
	case "select":
		if len(args) < 3 {
			return fmt.Errorf("usage: exora-dock order-plans select <plan-id> <option-id> [note]")
		}
		body := map[string]any{
			"optionId": args[2],
		}
		if len(args) > 3 {
			body["userNote"] = strings.Join(args[3:], " ")
		}
		needsPayment, err := orderPlanOptionNeedsPayment(args[1], args[2])
		if err != nil {
			return err
		}
		if needsPayment {
			pin, err := paymentPINFromEnvOrPrompt(false)
			if err != nil {
				return err
			}
			body["paymentPin"] = pin
		}
		return requestDaemonJSON(http.MethodPost, "/v1/order-plans/"+url.PathEscape(args[1])+"/select", body, "owner")
	case "cancel":
		if len(args) < 2 {
			return fmt.Errorf("usage: exora-dock order-plans cancel <plan-id> [note]")
		}
		body := map[string]any{}
		if len(args) > 2 {
			body["userNote"] = strings.Join(args[2:], " ")
		}
		return requestDaemonJSON(http.MethodPost, "/v1/order-plans/"+url.PathEscape(args[1])+"/cancel", body, "owner")
	default:
		return fmt.Errorf("unknown order-plans command: %s", args[0])
	}
}

func runAgentCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: exora-dock agent run|list|status|resume|stop")
	}
	switch args[0] {
	case "run":
		if len(args) < 2 || strings.TrimSpace(strings.Join(args[1:], " ")) == "" {
			return fmt.Errorf("usage: exora-dock agent run \"<intent>\"")
		}
		intent := strings.TrimSpace(strings.Join(args[1:], " "))
		return requestDaemonJSON(http.MethodPost, "/v1/agent/runs", map[string]any{"intent": intent}, "owner")
	case "list":
		return requestDaemonJSON(http.MethodGet, "/v1/agent/runs", nil, "owner")
	case "status":
		if len(args) < 2 {
			return fmt.Errorf("usage: exora-dock agent status <run-id>")
		}
		return requestDaemonJSON(http.MethodGet, "/v1/agent/runs/"+url.PathEscape(args[1]), nil, "owner")
	case "resume":
		if len(args) < 2 {
			return fmt.Errorf("usage: exora-dock agent resume <run-id>")
		}
		return requestDaemonJSON(http.MethodPost, "/v1/agent/runs/"+url.PathEscape(args[1])+"/resume", map[string]any{}, "owner")
	case "stop":
		if len(args) < 2 {
			return fmt.Errorf("usage: exora-dock agent stop <run-id>")
		}
		return requestDaemonJSON(http.MethodPost, "/v1/agent/runs/"+url.PathEscape(args[1])+"/stop", map[string]any{}, "owner")
	default:
		return fmt.Errorf("unknown agent command: %s", args[0])
	}
}

func runNegotiationsCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: exora-dock negotiations list|status|resume|cancel")
	}
	switch args[0] {
	case "list":
		path := "/v1/negotiations"
		if len(args) > 1 && strings.TrimSpace(args[1]) != "" {
			path += "?status=" + url.QueryEscape(strings.TrimSpace(args[1]))
		}
		return requestDaemonJSON(http.MethodGet, path, nil, "owner")
	case "status":
		if len(args) < 2 {
			return fmt.Errorf("usage: exora-dock negotiations status <negotiation-id>")
		}
		return requestDaemonJSON(http.MethodGet, "/v1/negotiations/"+url.PathEscape(args[1]), nil, "owner")
	case "resume":
		if len(args) < 2 {
			return fmt.Errorf("usage: exora-dock negotiations resume <negotiation-id>")
		}
		return requestDaemonJSON(http.MethodPost, "/v1/negotiations/"+url.PathEscape(args[1])+"/resume", map[string]any{}, "owner")
	case "cancel":
		if len(args) < 2 {
			return fmt.Errorf("usage: exora-dock negotiations cancel <negotiation-id> [note]")
		}
		body := map[string]any{}
		if len(args) > 2 {
			body["userNote"] = strings.Join(args[2:], " ")
		}
		return requestDaemonJSON(http.MethodPost, "/v1/negotiations/"+url.PathEscape(args[1])+"/cancel", body, "owner")
	default:
		return fmt.Errorf("unknown negotiations command: %s", args[0])
	}
}

func orderPlanOptionNeedsPayment(planID, optionID string) (bool, error) {
	resp, err := requestDaemonValue(http.MethodGet, "/v1/order-plans/"+url.PathEscape(planID), nil, "owner")
	if err != nil {
		return false, err
	}
	planValue, _ := resp["orderPlan"].(map[string]any)
	options, _ := planValue["options"].([]any)
	for _, raw := range options {
		option, _ := raw.(map[string]any)
		if option == nil || strings.TrimSpace(fmt.Sprint(option["optionId"])) != strings.TrimSpace(optionID) {
			continue
		}
		price, _ := option["priceSnapshot"].(map[string]any)
		amount, _ := price["pricePerUnit"].(float64)
		return amount > 0, nil
	}
	return false, fmt.Errorf("option %s not found in order plan %s", optionID, planID)
}

func runApprovalsCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: exora-dock approvals list|get|approve|reject")
	}
	switch args[0] {
	case "list":
		path := "/v1/approvals"
		if len(args) > 1 && strings.TrimSpace(args[1]) != "" {
			path += "?status=" + strings.TrimSpace(args[1])
		}
		return requestDaemonJSON(http.MethodGet, path, nil, "owner")
	case "get":
		if len(args) < 2 {
			return fmt.Errorf("usage: exora-dock approvals get <approval-id>")
		}
		return requestDaemonJSON(http.MethodGet, "/v1/approvals/"+args[1], nil, "owner")
	case "approve", "reject":
		if len(args) < 2 {
			return fmt.Errorf("usage: exora-dock approvals %s <approval-id> [note]", args[0])
		}
		body := map[string]any{
			"approved":  args[0] == "approve",
			"decidedBy": "exora-dockctl",
		}
		if len(args) > 2 {
			body["userNote"] = strings.Join(args[2:], " ")
		}
		if args[0] == "approve" {
			needsPayment, err := approvalNeedsPayment(args[1])
			if err != nil {
				return err
			}
			if needsPayment {
				pin, err := paymentPINFromEnvOrPrompt(false)
				if err != nil {
					return err
				}
				body["paymentPin"] = pin
			}
		}
		return requestDaemonJSON(http.MethodPost, "/v1/approvals/"+args[1]+"/decide", body, "owner")
	default:
		return fmt.Errorf("unknown approvals command: %s", args[0])
	}
}

func approvalNeedsPayment(approvalID string) (bool, error) {
	resp, err := requestDaemonValue(http.MethodGet, "/v1/approvals/"+approvalID, nil, "owner")
	if err != nil {
		return false, err
	}
	approvalValue, _ := resp["approval"].(map[string]any)
	required, _ := approvalValue["paymentRequired"].(bool)
	return required, nil
}

func paymentPINFromEnvOrPrompt(confirm bool) (string, error) {
	if pin := strings.TrimSpace(os.Getenv("EXORA_PAYMENT_PIN")); pin != "" {
		return pin, nil
	}
	pin, err := readSecret("Payment PIN: ")
	if err != nil {
		return "", err
	}
	if confirm {
		again, err := readSecret("Confirm Payment PIN: ")
		if err != nil {
			return "", err
		}
		if pin != again {
			return "", fmt.Errorf("payment PIN confirmation did not match")
		}
	}
	return pin, nil
}

func readSecret(prompt string) (string, error) {
	fmt.Fprint(os.Stderr, prompt)
	if term.IsTerminal(int(os.Stdin.Fd())) {
		data, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(data)), nil
	}
	var value string
	if _, err := fmt.Fscanln(os.Stdin, &value); err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func printJSON(value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(data))
	return nil
}

func requestDaemonJSON(method, path string, body any, tokenScope string) error {
	value, err := requestDaemonValue(method, path, body, tokenScope)
	if err != nil {
		return err
	}
	return printJSON(value)
}

func requestDaemonValue(method, path string, body any, tokenScope string) (map[string]any, error) {
	manifest, _, err := discovery.ReadFirst()
	if err != nil {
		return nil, err
	}
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, strings.TrimRight(manifest.BaseURL, "/")+path, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token := loadDaemonToken(manifest, tokenScope); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("daemon returned %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func loadAgentToken(cfg *config.Config) string {
	if cfg == nil {
		return ""
	}
	store, err := localauth.LoadOrCreate(cfg.AuthTokenPath)
	if err != nil {
		log.Printf("[auth] agent token unavailable: %v", err)
		return ""
	}
	return store.AgentToken()
}

func loadDaemonToken(manifest discovery.Manifest, scope string) string {
	cfgPath := strings.TrimSpace(manifest.ConfigPath)
	if cfgPath == "" {
		cfgPath = "config.yaml"
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Printf("[config] using defaults for daemon token: %v", err)
	}
	store, err := localauth.LoadOrCreate(cfg.AuthTokenPath)
	if err != nil {
		log.Printf("[auth] token unavailable: %v", err)
		return ""
	}
	if scope == "owner" {
		return store.OwnerToken()
	}
	return store.AgentToken()
}

func tokenHint(token string) string {
	if len(token) <= 16 {
		return token
	}
	return token[:12] + "..." + token[len(token)-6:]
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

func startCloudPoller(ctx context.Context, cfg *config.Config, selfPubkey string, authStore *localauth.Store) {
	if cfg == nil || strings.TrimSpace(cfg.CloudURL) == "" || authStore == nil {
		return
	}
	tokenFile, err := cloudlink.LoadToken(cfg.CloudTokenPath)
	if err != nil {
		log.Printf("[cloud-link] disabled: %v", err)
		return
	}
	dockID := strings.TrimSpace(cfg.DockID)
	if dockID == "" {
		dockID = tokenFile.DockID
	}
	if dockID == "" {
		dockID = selfPubkey
	}
	go cloudlink.Poller{
		CloudURL:     cfg.CloudURL,
		DockID:       dockID,
		TokenPath:    cfg.CloudTokenPath,
		BaseURL:      discovery.BaseURL(cfg.ListenAddr),
		OwnerToken:   authStore.OwnerToken(),
		PollInterval: time.Duration(cfg.CloudPollIntervalSec) * time.Second,
	}.Run(ctx)
	log.Printf("[cloud-link] remote console poller enabled for dock %s", dockID)
}
