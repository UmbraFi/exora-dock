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
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/exora-dock/exora-dock/internal/config"
	"github.com/exora-dock/exora-dock/internal/discovery"
	"github.com/exora-dock/exora-dock/internal/endpoint"
	"github.com/exora-dock/exora-dock/internal/localauth"
	"github.com/exora-dock/exora-dock/internal/mcp"
	"github.com/exora-dock/exora-dock/internal/providerworker"
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
	authStore, err := localauth.LoadOrCreate(cfg.AuthTokenPath)
	if err != nil {
		return fmt.Errorf("auth init: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	endpointStore := endpoint.NewStore(c)
	endpointTunnel := endpoint.NewTunnelClient(cfg.CloudURL, cfg.CloudTokenPath, endpointStore)
	sellerVault := sellerdraft.NewCredentialVault(cfg.DataDir)
	sellerService := sellerdraft.NewService(sellerdraft.ServiceOptions{Store: sellerdraft.NewStore(c), Vault: sellerVault, DataDir: cfg.DataDir, CloudURL: cfg.CloudURL, CloudTokenPath: cfg.CloudTokenPath, Endpoints: endpointStore, NotifyEndpoint: endpointTunnel.Notify})
	endpointTunnel.CredentialResolver = func(ref string) (string, string, string, error) {
		metadata, secret, err := sellerVault.Resolve(ref, "")
		return metadata.AuthType, metadata.APIKeyHeader, secret, err
	}
	go endpointTunnel.Run(ctx)
	sellerService.RecoverInterrupted()
	dockID := firstNonEmptyString(cfg.DockID, "local-dock")
	manifest := discovery.Build(cfg.ListenAddr, dockID)
	manifest.ConfigPath = cfgPath
	if manifest.ExecutablePath != "" {
		manifest.StartCommand = []string{manifest.ExecutablePath, cfgPath}
		manifest.MCPCommand = []string{manifest.ExecutablePath, "mcp", cfgPath}
		manifest.OpenCodeConfig = discovery.OpenCodeConfig(manifest.MCPCommand)
	}
	manifest.DiscoveryFiles = discovery.CandidatePaths()
	if policy, configured := sellerService.Policy(); configured && policy.Enabled {
		manifest.Capabilities = append(manifest.Capabilities, discovery.Capability{Name: "provider.listing_drafts.mcp.v1", Description: "Create private VM, Resources, Endpoint, and API Bridge drafts from seller-authorized local materials."})
		manifest.Endpoints["provider.listing_drafts"] = discovery.Endpoint{Method: "MCP", Description: "ProviderAgent-scoped draft tools; publishing remains owner-only."}
	}
	srv := &http.Server{Addr: cfg.ListenAddr, Handler: server.New(server.Options{Auth: authStore, AllowedOrigins: cfg.CORSAllowedOrigins, Discovery: &manifest, CloudURL: cfg.CloudURL, CloudTokenPath: cfg.CloudTokenPath, Endpoints: endpointStore, EndpointTunnel: endpointTunnel, SellerDrafts: sellerService})}
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
	startProviderCapacitySupervisor(ctx, cfg)
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

func startProviderCapacitySupervisor(ctx context.Context, cfg *config.Config) {
	if runtime.GOOS != "linux" || strings.TrimSpace(cfg.CloudTokenPath) == "" {
		return
	}
	token, err := cloudlink.LoadToken(cfg.CloudTokenPath)
	if err != nil || strings.TrimSpace(token.CloudToken) == "" {
		return
	}
	cloudURL := strings.TrimRight(firstNonEmptyString(cfg.CloudURL, token.CloudURL), "/")
	if cloudURL == "" {
		return
	}
	go func() {
		light := time.NewTicker(30 * time.Second)
		full := time.NewTicker(5 * time.Minute)
		defer light.Stop()
		defer full.Stop()
		recoveryPasses := 0
		report := func(level string) {
			checkCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			defer cancel()
			result, err := (providerworker.Client{}).Call(checkCtx, "capacity_check", map[string]any{"checkLevel": level})
			if err != nil {
				log.Printf("[provider-capacity] %s check failed: %v", level, err)
				return
			}
			busy, _ := result["providerBusy"].(bool)
			healthy := !busy
			if level == "full" {
				if healthy {
					recoveryPasses++
				} else {
					recoveryPasses = 0
				}
			}
			result["checkLevel"] = level
			result["healthy"] = healthy
			result["recoveryPasses"] = recoveryPasses
			body, _ := json.Marshal(result)
			req, err := http.NewRequestWithContext(checkCtx, http.MethodPost, cloudURL+"/v3/provider/capacity-snapshots", bytes.NewReader(body))
			if err != nil {
				return
			}
			req.Header.Set("Authorization", "Bearer "+token.CloudToken)
			req.Header.Set("Content-Type", "application/json")
			resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
			if err != nil {
				log.Printf("[provider-capacity] report failed: %v", err)
				return
			}
			defer resp.Body.Close()
			if resp.StatusCode >= 300 {
				message, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
				log.Printf("[provider-capacity] cloud status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(message)))
			}
		}
		report("light")
		for {
			select {
			case <-ctx.Done():
				return
			case <-light.C:
				report("light")
			case <-full.C:
				report("full")
			}
		}
	}()
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
	link, token, err := cloudlink.Link(context.Background(), cloudURL, cfg.CloudTokenPath, cloudlink.DeviceLinkRequest{DockID: dockID, ClientKind: "cli", DisplayName: "Exora Dock", Mode: cfg.Mode, PublicBaseURL: discovery.BaseURL(cfg.ListenAddr), Version: "0.1.0", Capabilities: []string{"marketplace.v3", "vm.ssh", "resources.s3", "endpoint.tunnel", "api_bridge.cloud", "seller.drafts"}}, 10*time.Minute, nil)
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
