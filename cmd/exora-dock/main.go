package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/exora-dock/exora-dock/internal/accountscope"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/exora-dock/exora-dock/internal/config"
	"github.com/exora-dock/exora-dock/internal/discovery"
	"github.com/exora-dock/exora-dock/internal/endpoint"
	"github.com/exora-dock/exora-dock/internal/localauth"
	"github.com/exora-dock/exora-dock/internal/mcp"
	"github.com/exora-dock/exora-dock/internal/sellerdraft"
	"github.com/exora-dock/exora-dock/internal/server"
)

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "discover":
			must(runDiscoverCommand())
			return
		case "mcp":
			must(runMCPCommand(os.Args[2:]))
			return
		case "auth":
			must(runAuthCommand(os.Args[2:]))
			return
		case "cloud":
			must(runCloudCommand(os.Args[2:]))
			return
		}
	}
	cfgPath := "config.yaml"
	if len(os.Args) > 1 {
		cfgPath = os.Args[1]
	}
	must(runDaemon(cfgPath))
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

func runDaemon(cfgPath string) error {
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Printf("[config] using defaults: %v", err)
	}
	if err := os.MkdirAll(cfg.DataDir, 0700); err != nil {
		return fmt.Errorf("data dir init: %w", err)
	}
	c, err := cache.New(cfg.CacheMaxMB*1024, cfg.DataDir)
	if err != nil {
		return fmt.Errorf("cache init: %w", err)
	}
	defer c.Close()
	if err := accountscope.MigrateLegacy(c, cfg.DataDir); err != nil {
		return fmt.Errorf("account scope migration: %w", err)
	}
	activeAccountID := ""
	if token, tokenErr := cloudlink.LoadToken(cfg.CloudTokenPath); tokenErr == nil {
		activeAccountID = strings.TrimSpace(token.AccountID)
	}
	authStore, err := localauth.LoadOrCreate(cfg.AuthTokenPath)
	if err != nil {
		return fmt.Errorf("auth init: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	endpointStore := endpoint.NewStore(c, activeAccountID)
	endpointTunnel := endpoint.NewTunnelClient(cfg.CloudURL, cfg.CloudTokenPath, endpointStore)
	sellerVault := sellerdraft.NewCredentialVault(cfg.DataDir, activeAccountID)
	sellerService := sellerdraft.NewService(sellerdraft.ServiceOptions{Store: sellerdraft.NewStore(c, activeAccountID), Vault: sellerVault, DataDir: cfg.DataDir, CloudURL: cfg.CloudURL, CloudTokenPath: cfg.CloudTokenPath, EndpointStore: endpointStore, NotifyEndpoint: endpointTunnel.Notify})
	endpointTunnel.CredentialResolver = func(ref string) (string, string, string, error) {
		metadata, secret, err := sellerVault.Resolve(ref, "")
		return metadata.AuthType, metadata.APIKeyHeader, secret, err
	}
	go endpointTunnel.Run(ctx)
	dockID := firstNonEmptyString(cfg.DockID, "local-dock")
	manifest := discovery.Build(cfg.ListenAddr, dockID)
	manifest.ConfigPath = cfgPath
	if manifest.ExecutablePath != "" {
		manifest.StartCommand = []string{manifest.ExecutablePath, cfgPath}
		manifest.MCPCommand = []string{manifest.ExecutablePath, "mcp", cfgPath}
		manifest.OpenCodeConfig = discovery.OpenCodeConfig(manifest.MCPCommand)
	}
	manifest.DiscoveryFiles = discovery.CandidatePaths()
	manifest.Capabilities = append(manifest.Capabilities, discovery.Capability{Name: "provider.api-capability.mcp.v3", Description: "Accept complete exora.api.v3 Capability Forms; external validation, owner confirmation, formal pricing, and publication remain owner-only."})
	manifest.Endpoints["provider.api-drafts"] = discovery.Endpoint{Method: "MCP", Description: "Final-form API Draft submission; integration locks, pricing entry and testing, execution and publication remain owner-only."}
	srv := &http.Server{Addr: cfg.ListenAddr, Handler: server.New(server.Options{Auth: authStore, AllowedOrigins: cfg.CORSAllowedOrigins, Discovery: &manifest, CloudURL: cfg.CloudURL, CloudTokenPath: cfg.CloudTokenPath, ActiveAccountID: activeAccountID, EnforceAccountScope: true, Endpoints: endpointStore, EndpointTunnel: endpointTunnel, SellerDrafts: sellerService})}
	listener, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		return fmt.Errorf("server listen: %w", err)
	}
	if strings.TrimSpace(os.Getenv("EXORA_DISABLE_DISCOVERY")) == "" {
		if paths, err := discovery.Write(manifest); err != nil {
			log.Printf("[discovery] unavailable: %v", err)
		} else {
			log.Printf("[discovery] written: %s", strings.Join(paths, ", "))
		}
	}
	go func() {
		log.Printf("[server] listening on %s", cfg.ListenAddr)
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Printf("[server] %v", err)
			cancel()
		}
	}()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-signals:
	case <-ctx.Done():
	}
	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	return srv.Shutdown(shutdownCtx)
}

func runCloudCommand(args []string) error {
	if len(args) == 0 || args[0] != "link" {
		return fmt.Errorf("usage: exora-dock cloud link")
	}
	cfgPath := firstNonEmptyString(os.Getenv("EXORA_CONFIG"), "config.yaml")
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Printf("[config] using defaults for cloud link: %v", err)
	}
	cloudURL := firstNonEmptyString(cfg.CloudURL, "http://127.0.0.1:8090")
	dockID := firstNonEmptyString(cfg.DockID, "local-dock")
	link, token, err := cloudlink.Link(context.Background(), cloudURL, cfg.CloudTokenPath, cloudlink.DeviceLinkRequest{DockID: dockID, ClientKind: "cli", DisplayName: "Exora Dock", Mode: cfg.Mode, PublicBaseURL: discovery.BaseURL(cfg.ListenAddr), Version: "0.1.0", Capabilities: []string{"marketplace.v4.api", "delivery.local_dock", "delivery.cloud_direct", "api.async_job", "api.artifacts", "provider.integrations"}}, 10*time.Minute, nil)
	if err != nil {
		return printJSON(map[string]any{"status": "pending", "userCode": link.UserCode, "verificationUrl": link.VerificationURL, "expiresAt": link.ExpiresAt, "message": err.Error()})
	}
	return printJSON(map[string]any{"status": token.Status, "dockId": token.DockID, "accountId": token.AccountID, "tokenPath": cfg.CloudTokenPath, "userCode": link.UserCode, "verificationUrl": link.VerificationURL})
}
func runDiscoverCommand() error {
	manifest, path, err := discovery.ReadFirst()
	if err != nil {
		return err
	}
	return printJSON(map[string]any{"manifestPath": path, "manifest": manifest})
}
func runMCPCommand(args []string) error {
	cfgPath := "config.yaml"
	if len(args) > 0 && strings.TrimSpace(args[0]) != "" {
		cfgPath = args[0]
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Printf("[config] using defaults for MCP: %v", err)
	}
	store, err := localauth.LoadOrCreate(cfg.AuthTokenPath)
	if err != nil {
		return err
	}
	executable, _ := os.Executable()
	start := []string{}
	if executable != "" {
		start = []string{executable, cfgPath}
	}
	clientName := firstNonEmptyString(os.Getenv("EXORA_MCP_CLIENT_NAME"), "Local Agent")
	return mcp.NewServer(mcp.Options{BaseURL: discovery.BaseURL(cfg.ListenAddr), StartCommand: start, OwnerToken: store.OwnerToken(), ClientName: clientName}).Serve(context.Background(), os.Stdin, os.Stdout)
}
func runAuthCommand(args []string) error {
	if len(args) == 0 || args[0] != "status" {
		return fmt.Errorf("usage: exora-dock auth status")
	}
	cfgPath := firstNonEmptyString(os.Getenv("EXORA_CONFIG"), "config.yaml")
	if manifest, _, err := discovery.ReadFirst(); err == nil && manifest.ConfigPath != "" {
		cfgPath = manifest.ConfigPath
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Printf("[config] using defaults: %v", err)
	}
	store, err := localauth.LoadOrCreate(cfg.AuthTokenPath)
	if err != nil {
		return err
	}
	tokens := store.Tokens()
	return printJSON(map[string]any{"authTokenPath": store.Path(), "ownerTokenHint": tokenHint(tokens.OwnerToken), "agentSessions": "created in memory by each MCP initialize"})
}
func printJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}
func tokenHint(token string) string {
	if len(token) <= 16 {
		return token
	}
	return token[:12] + "..." + token[len(token)-6:]
}
func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
