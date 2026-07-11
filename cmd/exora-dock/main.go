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
	"github.com/exora-dock/exora-dock/internal/agentdriver"
	"github.com/exora-dock/exora-dock/internal/agentsession"
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
	"github.com/exora-dock/exora-dock/internal/runcapability"
	"github.com/exora-dock/exora-dock/internal/samplemarket"
	"github.com/exora-dock/exora-dock/internal/server"
	"github.com/exora-dock/exora-dock/internal/supervisor"
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
	for _, workspaceRoot := range cfg.LocalAgents.Codex.WorkspaceRoots {
		if err := os.MkdirAll(workspaceRoot, 0700); err != nil {
			log.Fatalf("automation workspace root %s: %v", workspaceRoot, err)
		}
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
	selfPubkey := firstNonEmptyString(cfg.DockID, "local-dock")

	// The miner registry/DHT market is a legacy compatibility surface and is
	// never joined by the V2 production default.
	if cfg.LegacyMarketEnabled && cfg.KeyPath != "" && cfg.ProgramID != "" {
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

	if cfg.LegacyMarketEnabled {
		selfPubkey = ensureLocalMiner(ring, selfPubkey, cfg.ListenAddr)
	}

	// IPFS client & pin store
	ipfsClient := ipfs.NewClient(cfg.IPFSApiURL, filepath.Join(cfg.DataDir, "media"))
	pinStore := ipfs.NewPinStore(c)
	var productStore *product.Store
	var orderStore *orderpkg.Store
	if cfg.LegacyMarketEnabled {
		productStore = product.NewStore(c)
		orderStore = orderpkg.NewStore(c)
	}
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
	automationRunStore := supervisor.NewStore(c)
	interactiveAgentStore := agentsession.NewStore(c)
	runCapabilities, err := runcapability.LoadOrCreate(cfg.RunCapabilityPath)
	if err != nil {
		log.Fatalf("run capability init: %v", err)
	}
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

	// Listing review stays local and deterministic. Model execution is owned by
	// an installed local agent driver (Codex app-server), never by Dock API keys.
	reviewAgent := agent.NewReviewAgent(ipfsClient)

	sellerProvider := strings.TrimSpace(cfg.SellerAgent.ProviderPubkey)
	if sellerProvider == "" {
		sellerProvider = selfPubkey
	}
	sampleDockID := strings.TrimSpace(cfg.DockID)
	if sampleDockID == "" {
		sampleDockID = selfPubkey
	}
	if cfg.LegacyMarketEnabled {
		if err := samplemarket.Seed(resourceStore, agentCardStore, sampleDockID, sellerProvider); err != nil {
			log.Printf("[sample-market] seed skipped: %v", err)
		}
	}
	relay := chat.NewRelay(ring, chatStore, hub, selfPubkey)
	discoveryManifest := discovery.Build(cfg.ListenAddr, selfPubkey)
	if cfg.LegacyMarketEnabled {
		discoveryManifest = discovery.BuildLegacy(cfg.ListenAddr, selfPubkey)
	}
	discoveryManifest.ConfigPath = cfgPath
	if discoveryManifest.ExecutablePath != "" {
		discoveryManifest.StartCommand = []string{discoveryManifest.ExecutablePath, cfgPath}
		discoveryManifest.MCPCommand = []string{discoveryManifest.ExecutablePath, "mcp", cfgPath}
		discoveryManifest.OpenCodeConfig = discovery.OpenCodeConfig(discoveryManifest.MCPCommand)
	}
	discoveryManifest.DiscoveryFiles = discovery.CandidatePaths()

	if cfg.LegacyMarketEnabled {
		// Legacy peer chat and account-cache synchronization remain available
		// only when an operator explicitly opts into the compatibility market.
		hub.OnConnect = relay.DeliverOffline
		hub.SetOnAck(chatStore.MarkRead)
		go relay.RunSync(ctx)
	}

	if cfg.LegacyMarketEnabled && cfg.RPC != "" {
		f := fetcher.New(cfg.RPC, c, cfg.FetchInterv)
		go f.Run(ctx)
	}

	// HTTP + WebSocket server
	executable, _ := os.Executable()
	codexFactory := newCodexDriverFactory(cfg, cfgPath, executable)
	interactiveAgentManager := agentsession.NewManager(interactiveAgentStore, newInteractiveDriverFactory(cfgPath, executable))
	defer interactiveAgentManager.Close()
	automationWorkerID := fmt.Sprintf("%s:%d", firstNonEmptyString(cfg.DockID, selfPubkey), os.Getpid())
	automationSupervisor := supervisor.NewService(automationRunStore, runCapabilities, automationWorkerID, codexFactory)
	automationSupervisor.SetPolicy(supervisor.Policy{
		Enabled:           cfg.LocalAgents.Codex.Enabled,
		AllowedRoles:      cfg.LocalAgents.Codex.Roles,
		WorkspaceRoot:     cfg.LocalAgents.Codex.Workspace,
		WorkspaceRoots:    append([]string(nil), cfg.LocalAgents.Codex.WorkspaceRoots...),
		AutomationMode:    cfg.LocalAgents.Codex.AutomationMode,
		PermissionProfile: cfg.LocalAgents.Codex.PermissionProfile,
		MaxConcurrency:    cfg.LocalAgents.Codex.MaxConcurrency,
	})
	defer automationSupervisor.Close()
	codexProbe := func(probeCtx context.Context) (agentdriver.CapabilityReport, error) {
		driver := agentdriver.NewCodex(agentdriver.CodexConfig{
			Command:        cfg.LocalAgents.Codex.Command,
			RequestTimeout: time.Duration(cfg.LocalAgents.Codex.RequestTimeoutSec) * time.Second,
			ProbeTimeout:   time.Duration(cfg.LocalAgents.Codex.ProbeTimeoutSec) * time.Second,
		})
		defer driver.Close()
		return driver.Probe(probeCtx)
	}
	srv := &http.Server{
		Addr: cfg.ListenAddr,
		Handler: server.New(c, chatStore, relay, hub, ring, ipfsClient, pinStore, reviewAgent, productStore, orderStore, resourceStore, delegationStore, leaseStore, selfPubkey, server.RuntimeStores{
			Wallet:          walletStore,
			Tasks:           taskStore,
			Approvals:       approvalStore,
			OrderPlans:      orderPlanStore,
			Negotiations:    negotiationStore,
			PaymentPIN:      paymentPINStore,
			Payments:        paymentStore,
			TaskExecutor:    taskExecutor,
			Discovery:       &discoveryManifest,
			AgentCards:      agentCardStore,
			AutomationRuns:  automationRunStore,
			Supervisor:      automationSupervisor,
			AgentSessions:   interactiveAgentManager,
			RunCapabilities: runCapabilities,
			CodexProbe:      codexProbe,
			CodexAgent: agentdriver.LocalAgentConfig{
				ID: "codex", Kind: "codex", Enabled: cfg.LocalAgents.Codex.Enabled,
				Roles:             append([]string(nil), cfg.LocalAgents.Codex.Roles...),
				Automation:        cfg.LocalAgents.Codex.Automation,
				AutomationMode:    cfg.LocalAgents.Codex.AutomationMode,
				Workspace:         cfg.LocalAgents.Codex.Workspace,
				WorkspaceRoots:    append([]string(nil), cfg.LocalAgents.Codex.WorkspaceRoots...),
				PermissionProfile: cfg.LocalAgents.Codex.PermissionProfile,
				MaxConcurrency:    cfg.LocalAgents.Codex.MaxConcurrency,
			},
			CardDiagnostics: agentcard.DiagnosticsConfig{
				CommandExecutor: cfg.Provider.AllowCommandExecutor,
				MCPAvailable:    discoveryManifest.ExecutablePath != "",
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
			LegacyMarket:    cfg.LegacyMarketEnabled,
		}),
	}

	listener, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		log.Fatalf("server listen: %v", err)
	}
	if strings.TrimSpace(os.Getenv("EXORA_DISABLE_DISCOVERY")) == "" {
		if paths, err := discovery.Write(discoveryManifest); err != nil {
			log.Printf("[discovery] manifest unavailable: %v", err)
		} else {
			log.Printf("[discovery] manifest written: %s", strings.Join(paths, ", "))
		}
	}

	go func() {
		log.Printf("[server] listening on %s", cfg.ListenAddr)
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()
	startWakePoller(ctx, cfg, selfPubkey, automationSupervisor)

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
		dockID = "local-dock"
	}
	link, token, err := cloudlink.Link(context.Background(), cloudURL, cfg.CloudTokenPath, cloudlink.DeviceLinkRequest{
		DockID:        dockID,
		ClientKind:    "cli",
		DisplayName:   "Exora Dock",
		Mode:          cfg.Mode,
		PublicBaseURL: discovery.BaseURL(cfg.ListenAddr),
		Version:       "0.1.0",
		Capabilities:  []string{"automation.wake.v2", "automation.codex", "agent.cards", "mcp.run-capability"},
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
	mcpToken, err := loadMCPToken(cfg)
	if err != nil {
		return err
	}
	server := mcp.NewServer(mcp.Options{
		ConfigPath:     cfgPath,
		BaseURL:        discovery.BaseURL(cfg.ListenAddr),
		StartCommand:   startCommand,
		AgentToken:     mcpToken,
		ClientCWD:      cwd,
		ConnectionRole: role,
		ClientName:     clientName,
		LegacyMarket:   cfg.LegacyMarketEnabled,
		AgentSessionID: strings.TrimSpace(os.Getenv("EXORA_AGENT_SESSION_ID")),
		WorkUID:        strings.TrimSpace(os.Getenv("EXORA_AGENT_WORK_UID")),
		ProjectPath:    strings.TrimSpace(os.Getenv("EXORA_AGENT_PROJECT_PATH")),
		TransactionID:  strings.TrimSpace(os.Getenv("EXORA_AGENT_TRANSACTION_ID")),
	})
	return server.Serve(context.Background(), os.Stdin, os.Stdout)
}

func loadMCPToken(cfg *config.Config) (string, error) {
	if path := strings.TrimSpace(os.Getenv("EXORA_RUN_CAPABILITY_PATH")); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("read run capability: %w", err)
		}
		if len(data) > 16<<10 {
			return "", fmt.Errorf("run capability file is too large")
		}
		token := strings.TrimSpace(string(data))
		if !runcapability.IsToken(token) {
			return "", fmt.Errorf("run capability file is invalid")
		}
		return token, nil
	}
	if token := strings.TrimSpace(os.Getenv("EXORA_RUN_CAPABILITY")); token != "" {
		if !runcapability.IsToken(token) {
			return "", fmt.Errorf("run capability is invalid")
		}
		return token, nil
	}
	return loadAgentToken(cfg), nil
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

func newCodexDriverFactory(cfg *config.Config, cfgPath, executable string) supervisor.DriverFactory {
	return func(run supervisor.AutomationRun, capabilityToken string) agentdriver.Driver {
		if cfg == nil || strings.TrimSpace(executable) == "" || strings.TrimSpace(capabilityToken) == "" {
			return nil
		}
		if strings.EqualFold(strings.TrimSpace(run.AutomationMode), "manual") {
			return nil
		}
		secretDir := filepath.Join(cfg.DataDir, "run-capabilities")
		if err := os.MkdirAll(secretDir, 0700); err != nil {
			log.Printf("[automation] capability directory: %v", err)
			return nil
		}
		file, err := os.CreateTemp(secretDir, "run-*.token")
		if err != nil {
			log.Printf("[automation] capability file: %v", err)
			return nil
		}
		capabilityPath := file.Name()
		_ = file.Chmod(0600)
		if _, err := file.WriteString(strings.TrimSpace(capabilityToken) + "\n"); err != nil {
			_ = file.Close()
			_ = os.Remove(capabilityPath)
			return nil
		}
		if err := file.Close(); err != nil {
			_ = os.Remove(capabilityPath)
			return nil
		}

		// app-server's per-thread config is a map of config paths to values. A
		// nested mcp_servers object is accepted by JSON-RPC but silently ignored,
		// leaving the thread without Exora tools.
		mcpConfig := codexMCPConfig(executable, []string{"mcp", cfgPath}, run.Workspace, map[string]string{
			"EXORA_RUN_CAPABILITY_PATH": capabilityPath,
			"EXORA_MCP_ROLE":            run.Role,
			"EXORA_MCP_CLIENT_NAME":     "Exora Automation " + run.RunID,
		}, mcp.V2ToolNames())
		modeInstructions := "Guarded mode: use request_approval for any external side effect not already and explicitly authorized by the current Cloud allowed-actions projection."
		if strings.EqualFold(strings.TrimSpace(run.AutomationMode), "autonomous") {
			modeInstructions = "Autonomous mode: act only within the explicit transaction grants and current Cloud allowed-actions projection; request approval whenever authority is absent or ambiguous."
		}
		params := map[string]any{
			"approvalPolicy":        "never",
			"cwd":                   run.Workspace,
			"config":                mcpConfig,
			"developerInstructions": "You are an Exora transaction-role automation worker. Use Exora V2 MCP as the exclusive source of transaction facts and the exclusive path for transaction actions. You may use your normal local tools inside the configured workspace to perform the authorized task itself. Every turn must end with a durable transaction action or exora.finish_run; ordinary text is not progress. When an authorized completion action such as submit_deliverable is available and the task can be completed now, perform the work instead of repeatedly calling report_progress. Do not read or reveal credentials, wallet material, payment PINs, Dock owner tokens, or files outside the configured workspace. No MCP mutation is human approval or permission to move funds. " + modeInstructions,
		}
		if model := strings.TrimSpace(cfg.LocalAgents.Codex.Model); model != "" {
			params["model"] = model
		}
		return agentdriver.NewCodex(agentdriver.CodexConfig{
			Command:           cfg.LocalAgents.Codex.Command,
			RequestTimeout:    time.Duration(cfg.LocalAgents.Codex.RequestTimeoutSec) * time.Second,
			ProbeTimeout:      time.Duration(cfg.LocalAgents.Codex.ProbeTimeoutSec) * time.Second,
			SessionParams:     params,
			ResumeParams:      params,
			CleanupFiles:      []string{capabilityPath},
			ExpectedMCPServer: "exora",
		})
	}
}

func newInteractiveDriverFactory(cfgPath, dockExecutable string) agentsession.DriverFactory {
	return func(session agentsession.Session) (agentdriver.Driver, error) {
		command := strings.TrimSpace(session.Binding.Executable)
		if command == "" {
			return nil, fmt.Errorf("saved %s binding has no executable; scan and reconnect the local agent", session.Driver)
		}
		mcpCommand := []string{dockExecutable, "mcp", cfgPath}
		mcpEnvironment := map[string]string{
			"EXORA_MCP_ROLE":              session.Role,
			"EXORA_MCP_CLIENT_NAME":       "Exora Chat " + session.ID,
			"EXORA_AGENT_SESSION_ID":      session.ID,
			"EXORA_AGENT_CONVERSATION_ID": session.ConversationID,
			"EXORA_AGENT_WORK_UID":        session.WorkUID,
			"EXORA_AGENT_PROJECT_PATH":    session.Workspace,
		}
		if session.TransactionID != "" {
			mcpEnvironment["EXORA_AGENT_TRANSACTION_ID"] = session.TransactionID
		}
		sellerCardSetup := session.Purpose == "seller_card"
		if sellerCardSetup {
			mcpCommand = nil
			mcpEnvironment = nil
		}
		permissionProfile := strings.TrimSpace(session.PermissionProfile)
		if permissionProfile == "" {
			switch session.PermissionMode {
			case "approve":
				permissionProfile = "workspace-write"
			case "full":
				permissionProfile = "danger-full-access"
			case "ask":
				permissionProfile = "read-only"
			}
		}
		switch session.Driver {
		case "codex":
			params := map[string]any{
				"cwd":                   session.Workspace,
				"developerInstructions": "You are the user's bound Exora local agent. Use Exora MCP for every transaction fact, question, approval, offer, deliverable, progress update, or state proposal. Ordinary text cannot change transaction state. Never request payment PINs, wallet private keys, Dock owner tokens, model credentials, or arbitration authority.",
			}
			if sellerCardSetup {
				params["developerInstructions"] = "You are conducting a multi-turn Exora Seller Setup from seller-authored intent, pricing principles, a redacted environment snapshot, and seller answers. Stay read-only, do not inspect unrelated files, never request or accept real secret values, and return only the requested JSON envelope. Do not declare setup complete until allowed actions, approval cases, credential aliases, and network boundaries are explicit."
			} else {
				params["config"] = codexMCPConfig(mcpCommand[0], mcpCommand[1:], session.Workspace, mcpEnvironment, nil)
			}
			return agentdriver.NewCodex(agentdriver.CodexConfig{Command: command, RequestTimeout: 45 * time.Second, ProbeTimeout: 8 * time.Second, SessionParams: params, ResumeParams: params}), nil
		case "claude-code":
			return agentdriver.NewClaude(agentdriver.ClaudeConfig{Command: command, MCPCommand: mcpCommand, MCPEnvironment: mcpEnvironment}), nil
		case "gemini":
			return agentdriver.NewACP(agentdriver.ACPConfig{Kind: "gemini", Command: command, Args: []string{"--acp"}, MCPCommand: mcpCommand, MCPEnvironment: mcpEnvironment}), nil
		case "github-copilot":
			return agentdriver.NewACP(agentdriver.ACPConfig{Kind: "github-copilot", Command: command, Args: []string{"--acp", "--stdio"}, MCPCommand: mcpCommand, MCPEnvironment: mcpEnvironment}), nil
		case "opencode":
			return agentdriver.NewOpenCode(agentdriver.OpenCodeConfig{Command: command, MCPCommand: mcpCommand, MCPEnvironment: mcpEnvironment}), nil
		default:
			return nil, fmt.Errorf("local agent driver %q is detection-only", session.Driver)
		}
	}
}

func codexMCPConfig(command string, args []string, cwd string, environment map[string]string, enabledTools []string) map[string]any {
	config := map[string]any{
		"mcp_servers.exora.command": command,
		"mcp_servers.exora.args":    append([]string(nil), args...),
		"mcp_servers.exora.cwd":     cwd,
		"mcp_servers.exora.env":     environment,
		"mcp_servers.exora.enabled": true,
	}
	if len(enabledTools) > 0 {
		config["mcp_servers.exora.enabled_tools"] = append([]string(nil), enabledTools...)
		config["mcp_servers.exora.default_tools_approval_mode"] = "approve"
	}
	return config
}

func startWakePoller(ctx context.Context, cfg *config.Config, selfPubkey string, service *supervisor.Service) {
	if cfg == nil || service == nil || !cfg.LocalAgents.Codex.Enabled || strings.EqualFold(strings.TrimSpace(cfg.LocalAgents.Codex.AutomationMode), "manual") {
		return
	}
	tokenFile, err := cloudlink.LoadToken(cfg.CloudTokenPath)
	if err != nil {
		log.Printf("[wake-v2] disabled: %v", err)
		return
	}
	cloudURL := firstNonEmptyString(cfg.CloudURL, tokenFile.CloudURL)
	if cloudURL == "" {
		log.Printf("[wake-v2] disabled: cloud URL missing")
		return
	}
	dockID := strings.TrimSpace(cfg.DockID)
	if dockID == "" {
		dockID = tokenFile.DockID
	}
	if dockID == "" {
		dockID = selfPubkey
	}
	runReporter := cloudlink.RunReporter{CloudURL: cloudURL, TokenPath: cfg.CloudTokenPath}
	service.SetRunLifecycleReporter(supervisor.RunLifecycleReporterFunc(func(reportCtx context.Context, run supervisor.AutomationRun, event supervisor.RunLifecycleEvent) error {
		var retryAt *time.Time
		if value := strings.TrimSpace(event.RetryAt); value != "" {
			parsed, err := time.Parse(time.RFC3339Nano, value)
			if err != nil {
				return fmt.Errorf("invalid retryAt: %w", err)
			}
			retryAt = &parsed
		}
		return runReporter.Report(reportCtx, run.RunID, cloudlink.RunEvent{
			Type: event.Type, TransactionID: run.TransactionID, Role: run.Role,
			ExpectedStateVersion: run.ExpectedStateVersion, IdempotencyKey: event.IdempotencyKey,
			Driver: run.Driver, VendorThreadID: firstNonEmptyString(event.VendorThreadID, run.VendorThreadID), VendorTurnID: firstNonEmptyString(event.VendorTurnID, run.VendorTurnID),
			Outcome: event.Outcome, NextAction: event.NextAction, TargetRole: event.TargetRole, RetryAt: retryAt, Reason: event.Reason,
		})
	}))
	go cloudlink.WakePoller{
		CloudURL:     cloudURL,
		DockID:       dockID,
		WorkerID:     dockID,
		TokenPath:    cfg.CloudTokenPath,
		PollInterval: time.Duration(cfg.CloudPollIntervalSec) * time.Second,
		Handler: cloudlink.WakeHandlerFunc(func(wakeCtx context.Context, job cloudlink.WakeJob) (cloudlink.WakeResult, error) {
			allowedActions, allowedActionsSet := job.AllowedActions()
			run, err := service.HandleWake(wakeCtx, supervisor.WakeRequest{
				JobID: job.JobID, RunID: job.RunID, TransactionID: job.TransactionID, Role: job.Role,
				TriggerEventID: job.TriggerEventID, ExpectedStateVersion: job.ExpectedStateVersion,
				PermissionProfile: job.PermissionProfile, Workspace: job.Workspace, Prompt: job.Prompt,
				AllowedActions: allowedActions, AllowedActionsSet: allowedActionsSet,
			})
			if err != nil {
				return cloudlink.WakeResult{RunID: run.RunID, VendorThreadID: run.VendorThreadID, VendorTurnID: run.VendorTurnID, Status: run.Status}, err
			}
			return cloudlink.WakeResult{RunID: run.RunID, VendorThreadID: run.VendorThreadID, VendorTurnID: run.VendorTurnID, Status: run.Status}, nil
		}),
	}.Run(ctx)
	log.Printf("[wake-v2] typed automation poller enabled for dock %s", dockID)
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
