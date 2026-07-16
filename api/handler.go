package api

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/agent"
	"github.com/exora-dock/exora-dock/internal/agentcard"
	"github.com/exora-dock/exora-dock/internal/agentdriver"
	"github.com/exora-dock/exora-dock/internal/agentsession"
	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/buyerflow"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/exora-dock/exora-dock/internal/delegation"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/discovery"
	"github.com/exora-dock/exora-dock/internal/endpoint"
	"github.com/exora-dock/exora-dock/internal/ipfs"
	"github.com/exora-dock/exora-dock/internal/lease"
	"github.com/exora-dock/exora-dock/internal/market"
	"github.com/exora-dock/exora-dock/internal/negotiation"
	orderpkg "github.com/exora-dock/exora-dock/internal/order"
	"github.com/exora-dock/exora-dock/internal/orderplan"
	"github.com/exora-dock/exora-dock/internal/payment"
	"github.com/exora-dock/exora-dock/internal/paymentpin"
	"github.com/exora-dock/exora-dock/internal/product"
	"github.com/exora-dock/exora-dock/internal/providerprotocol"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/exora-dock/exora-dock/internal/runcapability"
	"github.com/exora-dock/exora-dock/internal/samplemarket"
	"github.com/exora-dock/exora-dock/internal/sellerdraft"
	"github.com/exora-dock/exora-dock/internal/supervisor"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/exora-dock/exora-dock/internal/wallet"
	"github.com/exora-dock/exora-dock/internal/workrun"
	"github.com/gagliardetto/solana-go"
	"github.com/go-chi/chi/v5"
)

type RuntimeStores struct {
	Wallet          *wallet.Store
	Tasks           *task.Store
	Approvals       *approval.Store
	OrderPlans      *orderplan.Store
	Negotiations    *negotiation.Store
	PaymentPIN      *paymentpin.Store
	Payments        *payment.Store
	TaskExecutor    *task.Executor
	Discovery       *discovery.Manifest
	AgentCards      *agentcard.Store
	AutomationRuns  *supervisor.Store
	Supervisor      *supervisor.Service
	AgentSessions   *agentsession.Manager
	RunCapabilities *runcapability.Manager
	CodexProbe      func(context.Context) (agentdriver.CapabilityReport, error)
	CodexAgent      agentdriver.LocalAgentConfig
	CardDiagnostics agentcard.DiagnosticsConfig
	CardPublisher   agentcard.CloudPublisher
	WorkRuns        *workrun.Store
	BuyerFlows      *buyerflow.Store
	EscrowProgramID string
	SolanaNetwork   string
	USDCMint        string
	USDCDecimals    uint8
	CloudURL        string
	CloudTokenPath  string
	DockID          string
	ConfigPath      string
	Endpoints       *endpoint.Store
	EndpointTunnel  *endpoint.TunnelClient
	SellerDrafts    *sellerdraft.Service
}

type Handler struct {
	cache           *cache.Cache
	chatStore       *chat.Store
	relay           *chat.Relay
	hub             *chat.Hub
	ring            *dht.Ring
	ipfsClient      *ipfs.Client
	pinStore        *ipfs.PinStore
	reviewAgent     *agent.ReviewAgent
	products        *product.Store
	orders          *orderpkg.Store
	resources       *resource.Store
	delegations     *delegation.Store
	leases          *lease.Store
	wallets         *wallet.Store
	tasks           *task.Store
	approvals       *approval.Store
	orderPlans      *orderplan.Store
	negotiations    *negotiation.Store
	paymentPIN      *paymentpin.Store
	payments        *payment.Store
	executor        *task.Executor
	discovery       *discovery.Manifest
	agentCards      *agentcard.Store
	automationRuns  *supervisor.Store
	supervisor      *supervisor.Service
	agentSessions   *agentsession.Manager
	runCapabilities *runcapability.Manager
	codexProbe      func(context.Context) (agentdriver.CapabilityReport, error)
	codexAgent      agentdriver.LocalAgentConfig
	workRuns        *workrun.Store
	buyerFlows      *buyerflow.Store
	cardDiagnostics agentcard.DiagnosticsConfig
	cardPublisher   agentcard.CloudPublisher
	escrowProgramID string
	solanaNetwork   string
	usdcMint        string
	usdcDecimals    uint8
	cloudURL        string
	cloudTokenPath  string
	dockID          string
	configPath      string
	endpoints       *endpoint.Store
	endpointTunnel  *endpoint.TunnelClient
	sellerDrafts    *sellerdraft.Service
	selfPubkey      string
	startTime       time.Time
}

const (
	mcpConnectionsKey = "mcp:connections:index"
	mcpConnectionsTTL = 365 * 24 * time.Hour
)

type MCPConnection struct {
	ID          string `json:"id"`
	Role        string `json:"role"`
	CWD         string `json:"cwd,omitempty"`
	ProjectPath string `json:"projectPath,omitempty"`
	ProjectName string `json:"projectName,omitempty"`
	Source      string `json:"source,omitempty"`
	ClientName  string `json:"clientName,omitempty"`
	CreatedAt   string `json:"createdAt"`
	LastSeen    string `json:"lastSeen"`
}

func NewHandler(c *cache.Cache, cs *chat.Store, relay *chat.Relay, hub *chat.Hub, ring *dht.Ring, ic *ipfs.Client, ps *ipfs.PinStore, ra *agent.ReviewAgent, products *product.Store, orders *orderpkg.Store, resources *resource.Store, delegations *delegation.Store, leases *lease.Store, selfPubkey string, runtime ...RuntimeStores) *Handler {
	var stores RuntimeStores
	if len(runtime) > 0 {
		stores = runtime[0]
	}
	h := &Handler{
		cache:           c,
		chatStore:       cs,
		relay:           relay,
		hub:             hub,
		ring:            ring,
		ipfsClient:      ic,
		pinStore:        ps,
		reviewAgent:     ra,
		products:        products,
		orders:          orders,
		resources:       resources,
		delegations:     delegations,
		leases:          leases,
		wallets:         stores.Wallet,
		tasks:           stores.Tasks,
		approvals:       stores.Approvals,
		orderPlans:      stores.OrderPlans,
		negotiations:    stores.Negotiations,
		paymentPIN:      stores.PaymentPIN,
		payments:        stores.Payments,
		executor:        stores.TaskExecutor,
		discovery:       stores.Discovery,
		agentCards:      stores.AgentCards,
		automationRuns:  stores.AutomationRuns,
		supervisor:      stores.Supervisor,
		agentSessions:   stores.AgentSessions,
		runCapabilities: stores.RunCapabilities,
		codexProbe:      stores.CodexProbe,
		codexAgent:      stores.CodexAgent,
		workRuns:        stores.WorkRuns,
		buyerFlows:      stores.BuyerFlows,
		cardDiagnostics: stores.CardDiagnostics,
		cardPublisher:   stores.CardPublisher,
		escrowProgramID: strings.TrimSpace(stores.EscrowProgramID),
		solanaNetwork:   firstNonEmpty(strings.TrimSpace(stores.SolanaNetwork), "devnet"),
		usdcMint:        strings.TrimSpace(stores.USDCMint),
		usdcDecimals:    stores.USDCDecimals,
		cloudURL:        strings.TrimRight(strings.TrimSpace(stores.CloudURL), "/"),
		cloudTokenPath:  strings.TrimSpace(stores.CloudTokenPath),
		dockID:          strings.TrimSpace(stores.DockID),
		configPath:      strings.TrimSpace(stores.ConfigPath),
		endpoints:       stores.Endpoints,
		endpointTunnel:  stores.EndpointTunnel,
		sellerDrafts:    stores.SellerDrafts,
		selfPubkey:      selfPubkey,
		startTime:       time.Now(),
	}
	if h.usdcDecimals == 0 {
		h.usdcDecimals = 6
	}
	if h.workRuns == nil {
		h.workRuns = workrun.NewStore(c)
	}
	if h.buyerFlows == nil {
		h.buyerFlows = buyerflow.NewStore(c)
	}
	if h.automationRuns == nil {
		h.automationRuns = supervisor.NewStore(c)
	}
	if h.negotiations == nil {
		h.negotiations = negotiation.NewStore(c)
	}
	return h
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	payload := map[string]any{
		"status":       "ok",
		"dock":         "exora-dock",
		"uptime":       time.Since(h.startTime).String(),
		"online_users": h.hub.OnlineCount(),
		"discovery":    "/.well-known/exora-dock.json",
	}
	if h.ring != nil && len(h.ring.Miners()) > 0 {
		payload["legacyMiners"] = len(h.ring.Miners())
	}
	writeJSON(w, http.StatusOK, payload)
}

func (h *Handler) DiscoveryManifest(w http.ResponseWriter, r *http.Request) {
	if h.discovery != nil {
		manifest := *h.discovery
		manifest.Capabilities = append([]discovery.Capability(nil), h.discovery.Capabilities...)
		sellerEnabled := false
		if h.sellerDrafts != nil {
			policy, configured := h.sellerDrafts.Policy()
			sellerEnabled = configured && policy.Enabled
		}
		filtered := manifest.Capabilities[:0]
		for _, capability := range manifest.Capabilities {
			if capability.Name != "provider.listing_drafts.mcp.v1" {
				filtered = append(filtered, capability)
			}
		}
		manifest.Capabilities = filtered
		if sellerEnabled {
			manifest.Capabilities = append(manifest.Capabilities, discovery.Capability{Name: "provider.listing_drafts.mcp.v1", Description: "Discover authorized seller resources and create private Listing drafts over ProviderAgent-scoped MCP. Public Listing actions remain owner-only."})
		}
		base := strings.TrimRight(requestBaseURL(r), "/")
		manifest.BaseURL = base
		manifest.HealthURL = base + "/health"
		manifest.ManifestURL = base + "/.well-known/exora-dock.json"
		manifest.Endpoints = maps.Clone(h.discovery.Endpoints)
		if manifest.Endpoints == nil {
			manifest.Endpoints = map[string]discovery.Endpoint{}
		}
		delete(manifest.Endpoints, "provider.listing_drafts")
		if sellerEnabled {
			manifest.Endpoints["provider.listing_drafts"] = discovery.Endpoint{Method: "MCP", Description: "ProviderAgent-scoped private seller draft tools; no publish, pause, resume Listing, or retire permission."}
		}
		for key, endpoint := range manifest.Endpoints {
			if endpoint.Path != "" && endpoint.Method != "STDIO" {
				endpoint.URL = base + endpoint.Path
				manifest.Endpoints[key] = endpoint
			}
		}
		manifest.RESTFallback = maps.Clone(h.discovery.RESTFallback)
		manifest.RESTFallback["baseUrl"] = base
		manifest.RESTFallback["health"] = manifest.HealthURL
		manifest.RESTFallback["manifest"] = manifest.ManifestURL
		manifest.LastSeen = time.Now().UTC().Format(time.RFC3339)
		writeJSON(w, http.StatusOK, manifest)
		return
	}
	writeJSON(w, http.StatusOK, discovery.BuildWithBaseURL(requestBaseURL(r), h.selfPubkey))
}

func (h *Handler) RegisterMCPConnection(w http.ResponseWriter, r *http.Request) {
	var req MCPConnection
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	role := normalizeMCPConnectionRole(req.Role)
	cwd := cleanLocalProjectPath(req.CWD)
	projectPath := cleanLocalProjectPath(req.ProjectPath)
	if role == "buyer" && projectPath == "" {
		projectPath = cwd
	}
	projectName := strings.TrimSpace(req.ProjectName)
	if projectName == "" && projectPath != "" {
		projectName = filepath.Base(projectPath)
	}
	source := firstNonEmpty(req.Source, "mcp.stdio")
	clientName := firstNonEmpty(req.ClientName, "Local Agent")
	id := firstNonEmpty(req.ID, mcpConnectionID(role, cwd, projectPath, source, clientName))
	connection := MCPConnection{
		ID:          id,
		Role:        role,
		CWD:         cwd,
		ProjectPath: projectPath,
		ProjectName: projectName,
		Source:      source,
		ClientName:  clientName,
		CreatedAt:   now,
		LastSeen:    now,
	}

	connections := h.loadMCPConnections()
	for i := range connections {
		if connections[i].ID != connection.ID {
			continue
		}
		connection.CreatedAt = firstNonEmpty(connections[i].CreatedAt, now)
		connections[i] = connection
		h.saveMCPConnections(connections)
		writeJSON(w, http.StatusOK, map[string]any{"connection": connection})
		return
	}
	connections = append([]MCPConnection{connection}, connections...)
	h.saveMCPConnections(connections)
	writeJSON(w, http.StatusCreated, map[string]any{"connection": connection})
}

func (h *Handler) ListMCPConnections(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"mcpConnections": h.loadMCPConnections()})
}

func (h *Handler) loadMCPConnections() []MCPConnection {
	if h.cache == nil {
		return nil
	}
	data, ok := h.cache.Get(mcpConnectionsKey)
	if !ok {
		return nil
	}
	var connections []MCPConnection
	if err := json.Unmarshal(data, &connections); err != nil {
		return nil
	}
	return connections
}

func (h *Handler) saveMCPConnections(connections []MCPConnection) {
	if h.cache == nil {
		return
	}
	data, err := json.Marshal(connections)
	if err != nil {
		return
	}
	h.cache.Set(mcpConnectionsKey, data, mcpConnectionsTTL)
}

func normalizeMCPConnectionRole(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "seller", "provider":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "buyer"
	}
}

func cleanLocalProjectPath(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || !filepath.IsAbs(trimmed) {
		return ""
	}
	return filepath.Clean(trimmed)
}

func mcpConnectionID(role, cwd, projectPath, source, clientName string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{role, cwd, projectPath, source, clientName}, "\x00")))
	return fmt.Sprintf("mcp-%x", sum[:8])
}

// --- Local wallet endpoints ---

func (h *Handler) GetWallet(w http.ResponseWriter, r *http.Request) {
	if h.wallets == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "wallet service not configured"})
		return
	}
	status, err := h.wallets.Current()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	status = h.enrichWalletStatus(status)
	writeJSON(w, http.StatusOK, map[string]any{"wallet": status})
}

func (h *Handler) CreateWallet(w http.ResponseWriter, r *http.Request) {
	if h.wallets == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "wallet service not configured"})
		return
	}
	var req wallet.CreateRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	status, err := h.wallets.Create(req)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	status = h.enrichWalletStatus(status)
	resp := map[string]any{"wallet": status}
	if strings.TrimSpace(req.RecoveryPassword) != "" {
		if backup, err := h.wallets.Backup(); err == nil {
			if accountWallet, err := cloudlink.PutAccountWallet(r.Context(), h.cloudURL, h.cloudTokenPath, h.dockID, backup, nil); err == nil {
				status.BackupStatus = "encrypted_cloud_backed_up"
				resp["wallet"] = status
				resp["accountWallet"] = accountWallet
			} else {
				resp["backupWarning"] = err.Error()
			}
		}
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) UnlockWallet(w http.ResponseWriter, r *http.Request) {
	if h.wallets == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "wallet service not configured"})
		return
	}
	var req wallet.UnlockRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	status, err := h.wallets.Unlock(req)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"wallet": h.enrichWalletStatus(status)})
}

func (h *Handler) RestoreWallet(w http.ResponseWriter, r *http.Request) {
	if h.wallets == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "wallet service not configured"})
		return
	}
	var req wallet.RestoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(req.Backup.Data) == "" {
		accountWallet, err := cloudlink.GetAccountWallet(r.Context(), h.cloudURL, h.cloudTokenPath, h.dockID, nil)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "wallet backup unavailable: " + err.Error()})
			return
		}
		req.Backup = accountWallet.EncryptedBackup
	}
	status, err := h.wallets.Restore(req)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"wallet": h.enrichWalletStatus(status)})
}

func (h *Handler) WithdrawWallet(w http.ResponseWriter, r *http.Request) {
	if h.wallets == nil || h.paymentPIN == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "wallet withdrawal service not configured"})
		return
	}
	if strings.TrimSpace(h.usdcMint) == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "usdc_mint_not_configured"})
		return
	}
	var req struct {
		ToAddress    string `json:"toAddress"`
		AmountAtomic uint64 `json:"amountAtomic"`
		PaymentPin   string `json:"paymentPin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(req.PaymentPin) == "" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "payment_pin_required"})
		return
	}
	if err := h.paymentPIN.Verify(req.PaymentPin); err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "invalid_payment_pin"})
		return
	}
	if strings.TrimSpace(req.ToAddress) == "" || req.AmountAtomic == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "toAddress and amountAtomic required"})
		return
	}
	if _, err := solana.PublicKeyFromBase58(strings.TrimSpace(req.ToAddress)); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_to_address"})
		return
	}
	payload := []byte(fmt.Sprintf("exora.wallet.withdraw.v1\n%s\n%d\n%s\n%s", strings.TrimSpace(req.ToAddress), req.AmountAtomic, h.usdcMint, time.Now().UTC().Format(time.RFC3339Nano)))
	address, signature, err := h.wallets.SignPayload(payload)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"withdrawal": map[string]any{
			"fromAddress":  address,
			"toAddress":    strings.TrimSpace(req.ToAddress),
			"amountAtomic": req.AmountAtomic,
			"currency":     "USDC",
			"mint":         h.usdcMint,
			"decimals":     h.usdcDecimals,
			"signature":    signature,
			"status":       "relayer_required",
		},
		"nextAction": "submit_to_cloud_relayer",
		"feePolicy":  h.walletFeePolicy(),
	})
}

func (h *Handler) ClearWallet(w http.ResponseWriter, r *http.Request) {
	if h.wallets == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "wallet service not configured"})
		return
	}
	var req wallet.ClearRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	status, err := h.wallets.Clear(req)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"wallet": status})
}

func (h *Handler) enrichWalletStatus(status wallet.Status) wallet.Status {
	status.AccountBound = status.Configured && !status.BoundOnly
	status.USDCMint = h.usdcMint
	status.FeePolicy = h.walletFeePolicy()
	status.Balances = map[string]wallet.Balance{
		"usdc": {
			AmountAtomic: 0,
			Decimals:     h.usdcDecimals,
			Currency:     "USDC",
			Mint:         h.usdcMint,
			Status:       h.walletBalanceStatus(),
			UpdatedAt:    time.Now().UTC().Format(time.RFC3339),
		},
	}
	return status
}

func (h *Handler) walletFeePolicy() *wallet.FeePolicy {
	return &wallet.FeePolicy{
		Currency:            "USDC",
		RelayFeeAtomic:      0,
		RelayFeeDescription: "Exora relayer pays Solana gas; protocol fee can be added here when configured.",
		GasPaidBy:           "exora_relayer",
	}
}

func (h *Handler) walletBalanceStatus() string {
	if strings.TrimSpace(h.usdcMint) == "" {
		return "usdc_mint_not_configured"
	}
	return "not_fetched"
}

// --- Remote job task endpoints ---

func (h *Handler) CreateTask(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	var req task.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	t, err := h.tasks.Create(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	payload := map[string]any{"task": t, "summary": "Task draft created.", "nextAction": "request_approval"}
	payload = h.decorateWorkRunPayload(payload, workRunContext{
		RunID:       req.RunID,
		WorkUID:     req.WorkUID,
		ProjectPath: req.ProjectPath,
		Controller:  firstNonEmpty(req.Controller, workrun.ControllerInternalAPI),
		Intent:      req.Goal,
		CurrentStep: workrun.StepRequestApproval,
	}, payload)
	writeJSON(w, http.StatusCreated, payload)
}

func (h *Handler) ListTasks(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	status := task.Status(strings.TrimSpace(r.URL.Query().Get("status")))
	party := strings.TrimSpace(r.URL.Query().Get("party"))
	writeJSON(w, http.StatusOK, map[string]any{"tasks": h.tasks.List(status, party)})
}

func (h *Handler) GetTask(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	t, ok := h.tasks.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "task not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": t})
}

func (h *Handler) QuoteTask(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	var req task.QuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	t, err := h.tasks.Quote(chi.URLParam(r, "id"), req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": t})
}

func (h *Handler) ConsentTask(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	var req task.ConsentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	t, err := h.tasks.Consent(chi.URLParam(r, "id"), req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": t})
}

func (h *Handler) NextProviderTask(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	status := task.Status(strings.TrimSpace(r.URL.Query().Get("status")))
	provider := strings.TrimSpace(r.URL.Query().Get("providerPubkey"))
	t, ok := h.tasks.Next(status, provider)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no task available"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": t})
}

func (h *Handler) ClaimTask(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	var req task.ClaimRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	t, err := h.tasks.Claim(chi.URLParam(r, "id"), req)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": t})
}

func (h *Handler) RunTask(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil || h.executor == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task executor not configured"})
		return
	}
	t, ok := h.tasks.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "task not found"})
		return
	}
	var req task.RunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	artifacts, err := h.executor.Run(r.Context(), t, req)
	if err != nil {
		_, _ = h.tasks.Fail(t.ID, task.FailRequest{ProviderPubkey: req.ProviderPubkey, Error: err.Error()})
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	updated, err := h.tasks.Complete(t.ID, task.CompleteRequest{ProviderPubkey: req.ProviderPubkey, Artifacts: artifacts})
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": updated})
}

func (h *Handler) CompleteTask(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	var req task.CompleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	t, err := h.tasks.Complete(chi.URLParam(r, "id"), req)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": t})
}

func (h *Handler) FailTask(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	var req task.FailRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	t, err := h.tasks.Fail(chi.URLParam(r, "id"), req)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": t})
}

func (h *Handler) GetTaskArtifact(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	path, ok := h.tasks.ArtifactPath(chi.URLParam(r, "id"), chi.URLParam(r, "name"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "artifact not found"})
		return
	}
	http.ServeFile(w, r, path)
}

func (h *Handler) GetTaskArtifactManifest(w http.ResponseWriter, r *http.Request) {
	if h.tasks == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
		return
	}
	artifacts, ok := h.tasks.ArtifactManifest(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "task not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"artifacts": artifacts})
}

// --- Built-in requester agent endpoints ---

func (h *Handler) SearchSellers(w http.ResponseWriter, r *http.Request) {
	if h.resources == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "resource service not configured"})
		return
	}
	var req market.SearchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if req.CreateSelectionRequest {
		req.PrepareOrderOptions = true
	}
	if strings.TrimSpace(req.ProjectPath) == "" {
		req.ProjectPath = req.TaskTemplate.ProjectPath
	}
	if strings.TrimSpace(req.WorkUID) == "" {
		req.WorkUID = req.TaskTemplate.WorkUID
	}
	if req.RequireRealtimeQuotes {
		req.PrepareOrderOptions = true
		if req.MaxOptions <= 0 {
			req.MaxOptions = market.MaxOrderOptions
		}
		if req.MaxResults <= 0 || req.MaxResults < req.MaxOptions {
			req.MaxResults = req.MaxOptions
		}
		if h.wallets != nil {
			if status, err := h.wallets.Current(); err == nil && status.LocalKeypair && strings.TrimSpace(status.Address) != "" {
				req.RequesterPubkey = status.Address
				req.TaskTemplate.RequesterPubkey = status.Address
			}
		}
	}
	result := market.Search(req, h.resources)
	candidateStates := []orderplan.CandidateState{}
	events := []orderplan.Event{{Type: "market_search", Message: result.Summary}}
	if req.RequireRealtimeQuotes && len(result.OrderDraftOptions) > 0 {
		var quoteEvents []orderplan.Event
		result.OrderDraftOptions, candidateStates, quoteEvents = h.realtimeOrderOptions(r, req, result.OrderDraftOptions)
		events = append(events, quoteEvents...)
		if len(result.OrderDraftOptions) == 0 {
			result.NextAction = "no_realtime_quotes_available"
			result.Summary = "No realtime-confirmed Docker quotes are available from the matching providers."
		} else {
			result.NextAction = "ask_user_to_choose_realtime_quote"
			result.Summary = fmt.Sprintf("Received %d realtime-confirmed Docker quote(s).", len(result.OrderDraftOptions))
		}
	}
	if req.CreateSelectionRequest && len(result.OrderDraftOptions) > 0 {
		if h.orderPlans == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order plan service not configured"})
			return
		}
		plan, err := h.orderPlans.Create(orderplan.CreateRequest{
			Query:            req.Query,
			ProjectPath:      req.ProjectPath,
			WorkUID:          req.WorkUID,
			RequesterPubkey:  req.RequesterPubkey,
			AgentID:          req.AgentID,
			NormalizedQuery:  result.NormalizedQuery,
			Options:          result.OrderDraftOptions,
			RealtimeRequired: req.RequireRealtimeQuotes,
			Candidates:       candidateStates,
			Events:           events,
			ExpiresAt:        result.OrderDraftOptions[0].ExpiresAt,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		result.SelectionRequest = &market.SelectionRequestSummary{
			PlanID:      plan.ID,
			Status:      string(plan.Status),
			ApprovalURL: requestBaseURL(r) + "/order-plans/" + plan.ID,
			ExpiresAt:   plan.ExpiresAt,
			NextAction:  plan.NextAction,
		}
	} else if req.CreateSelectionRequest && req.RequireRealtimeQuotes {
		if h.orderPlans == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order plan service not configured"})
			return
		}
		plan, err := h.orderPlans.Create(orderplan.CreateRequest{
			Query:            req.Query,
			ProjectPath:      req.ProjectPath,
			WorkUID:          req.WorkUID,
			RequesterPubkey:  req.RequesterPubkey,
			AgentID:          req.AgentID,
			NormalizedQuery:  result.NormalizedQuery,
			RealtimeRequired: true,
			Candidates:       candidateStates,
			Events:           events,
			ExpiresAt:        time.Now().UTC().Add(10 * time.Minute).Format(time.RFC3339),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		result.SelectionRequest = &market.SelectionRequestSummary{
			PlanID:      plan.ID,
			Status:      string(plan.Status),
			ApprovalURL: requestBaseURL(r) + "/order-plans/" + plan.ID,
			ExpiresAt:   plan.ExpiresAt,
			NextAction:  "no_realtime_quotes_available",
		}
	}
	payload := map[string]any{}
	if data, err := json.Marshal(result); err == nil {
		_ = json.Unmarshal(data, &payload)
	}
	if len(payload) == 0 {
		payload = map[string]any{"summary": result.Summary, "nextAction": result.NextAction}
	}
	payload = h.decorateWorkRunPayload(payload, workRunContext{
		RunID:       req.RunID,
		WorkUID:     req.WorkUID,
		ProjectPath: req.ProjectPath,
		Controller:  firstNonEmpty(req.Controller, workrun.ControllerInternalAPI),
		Intent:      req.Query,
		CurrentStep: workrun.StepStartTaskFlow,
	}, payload)
	writeJSON(w, http.StatusOK, payload)
}

func (h *Handler) MarketRailCards(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, samplemarket.RailCards(h.agentCards))
}

func (h *Handler) realtimeOrderOptions(r *http.Request, req market.SearchRequest, options []market.OrderDraftOption) ([]market.OrderDraftOption, []orderplan.CandidateState, []orderplan.Event) {
	confirmed := make([]market.OrderDraftOption, 0, len(options))
	states := make([]orderplan.CandidateState, 0, len(options))
	events := []orderplan.Event{}
	for _, option := range options {
		state := orderplan.CandidateState{
			OptionID:       option.OptionID,
			ResourceID:     option.ResourceID,
			ProviderPubkey: option.ProviderPubkey,
			Endpoint:       option.ProviderEndpoint,
			Status:         "contacting",
			UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
		}
		if strings.TrimSpace(option.ProviderEndpoint) == "" {
			state.Status = "unreachable"
			state.Message = "provider endpoint missing"
			states = append(states, state)
			events = append(events, orderplan.Event{Type: "provider_unreachable", Message: state.Message, OptionID: option.OptionID})
			continue
		}
		reply, err := h.requestProviderQuote(r, req, option)
		if err != nil {
			state.Status = "unreachable"
			state.Message = err.Error()
			states = append(states, state)
			events = append(events, orderplan.Event{Type: "provider_quote_failed", Message: err.Error(), OptionID: option.OptionID})
			continue
		}
		if reply.Status != "quoted" {
			state.Status = "rejected"
			state.Message = firstNonEmpty(reply.Error, reply.Notes, "provider rejected quote request")
			states = append(states, state)
			events = append(events, orderplan.Event{Type: "provider_rejected", Message: state.Message, OptionID: option.OptionID})
			continue
		}
		option.PriceSnapshot.PricePerUnit = reply.PriceAmount
		option.PriceSnapshot.Currency = firstNonEmpty(reply.Currency, option.PriceSnapshot.Currency, "USDC")
		option.QuoteID = reply.RequestID
		option.RealtimeStatus = "quoted"
		option.ConfirmedAt = time.Now().UTC().Format(time.RFC3339)
		option.ExpiresAt = reply.ExpiresAt
		option.Draft.Requirements = task.WithDockerRequirement(option.Draft.Requirements, reply.Docker)
		state.Status = "quoted"
		state.QuoteID = reply.RequestID
		state.PriceAmount = reply.PriceAmount
		state.Currency = firstNonEmpty(reply.Currency, "USDC")
		state.ExpiresAt = reply.ExpiresAt
		state.Message = reply.Notes
		state.UpdatedAt = option.ConfirmedAt
		confirmed = append(confirmed, option)
		states = append(states, state)
		events = append(events, orderplan.Event{Type: "provider_quoted", Message: reply.Notes, OptionID: option.OptionID})
	}
	return confirmed, states, events
}

// --- Agent Card endpoints ---

func (h *Handler) ListMyAgentCards(w http.ResponseWriter, r *http.Request) {
	if h.agentCards == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent card service not configured"})
		return
	}
	cards := h.agentCards.List()
	body := map[string]any{"cards": cards}
	if buyer, ok := h.agentCards.Get(agentcard.RoleBuyer); ok {
		body["buyer"] = buyer
	}
	if seller, ok := h.agentCards.Get(agentcard.RoleSeller); ok {
		body["seller"] = seller
	}
	writeJSON(w, http.StatusOK, body)
}

func (h *Handler) RunAgentCardDiagnostics(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"diagnostics": agentcard.CollectDiagnostics(h.cardDiagnostics),
	})
}

func (h *Handler) DraftAgentCard(w http.ResponseWriter, r *http.Request) {
	var req agentcard.DraftRequest
	if r.Body != nil && r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
	}
	if req.Role == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "role required"})
		return
	}
	if req.Diagnostics.CollectedAt == "" {
		req.Diagnostics = agentcard.CollectDiagnostics(h.cardDiagnostics)
	}
	if strings.TrimSpace(req.DockID) == "" {
		req.DockID = h.defaultDockID()
	}
	if strings.TrimSpace(req.AgentID) == "" {
		req.AgentID = "exora-desktop-agent"
	}
	card, err := agentcard.NewDraft(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"card": card})
}

func (h *Handler) SaveAgentCard(w http.ResponseWriter, r *http.Request) {
	if h.agentCards == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent card service not configured"})
		return
	}
	role, err := agentcard.NormalizeRole(chi.URLParam(r, "role"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	var req agentcard.SaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	card := req.Card
	if card.Role == "" {
		card.Role = role
	}
	if card.Role != role {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "card role does not match route"})
		return
	}
	if strings.TrimSpace(card.DockID) == "" {
		card.DockID = h.defaultDockID()
	}
	if err := h.agentCards.Save(card); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	saved, _ := h.agentCards.Get(role)
	writeJSON(w, http.StatusOK, map[string]any{"card": saved})
}

func (h *Handler) PublishAgentCard(w http.ResponseWriter, r *http.Request) {
	if h.agentCards == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent card service not configured"})
		return
	}
	role, err := agentcard.NormalizeRole(chi.URLParam(r, "role"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	card, ok := h.agentCards.Get(role)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent card not found"})
		return
	}
	result, err := h.cardPublisher.Publish(r.Context(), card)
	if err != nil {
		var publishErr *agentcard.PublishError
		if errors.As(err, &publishErr) {
			status := publishErr.StatusCode
			if status == 0 {
				status = http.StatusConflict
			}
			body := map[string]any{"error": publishErr.Error()}
			if publishErr.Review != nil {
				body["review"] = publishErr.Review
			}
			writeJSON(w, status, body)
			return
		}
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	if err := h.agentCards.SavePublished(result.Card); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) defaultDockID() string {
	if strings.TrimSpace(h.cardPublisher.DockID) != "" {
		return strings.TrimSpace(h.cardPublisher.DockID)
	}
	if strings.TrimSpace(h.selfPubkey) != "" {
		return strings.TrimSpace(h.selfPubkey)
	}
	return "exora-dock-local"
}

// --- Approval queue endpoints ---

func (h *Handler) CreateApproval(w http.ResponseWriter, r *http.Request) {
	if h.approvals == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "approval service not configured"})
		return
	}
	var req approval.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(req.TaskID) != "" {
		if h.tasks == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
			return
		}
		t, ok := h.tasks.Get(strings.TrimSpace(req.TaskID))
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "task not found"})
			return
		}
		req = mergeApprovalRequest(req, t)
	}
	a, err := h.approvals.Create(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if strings.TrimSpace(a.TaskID) != "" {
		if h.tasks == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
			return
		}
		if _, err := h.tasks.SetApprovalRequest(a.TaskID, a.ID); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
	}
	a = decorateApproval(a, requestBaseURL(r))
	resp := map[string]any{"approval": a}
	if a.PaymentRequired && h.payments != nil {
		paymentRecord, intent, err := h.ensurePaymentIntentForApproval(a, "")
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		resp["payment"] = paymentRecord
		if intent.PaymentID != "" {
			resp["paymentIntent"] = intent
		}
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) ListApprovals(w http.ResponseWriter, r *http.Request) {
	if h.approvals == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "approval service not configured"})
		return
	}
	filter := approval.ListFilter{
		Status:      approval.Status(strings.TrimSpace(r.URL.Query().Get("status"))),
		UserPubkey:  firstQueryValue(r, "userPubkey", "user"),
		AgentID:     strings.TrimSpace(r.URL.Query().Get("agentId")),
		TaskID:      strings.TrimSpace(r.URL.Query().Get("taskId")),
		SubjectType: strings.TrimSpace(r.URL.Query().Get("subjectType")),
		SubjectID:   strings.TrimSpace(r.URL.Query().Get("subjectId")),
		WorkRunID:   strings.TrimSpace(r.URL.Query().Get("workRunId")),
		PlanID:      strings.TrimSpace(r.URL.Query().Get("planId")),
	}
	approvals := h.approvals.List(filter)
	for i := range approvals {
		approvals[i] = decorateApproval(approvals[i], requestBaseURL(r))
	}
	writeJSON(w, http.StatusOK, map[string]any{"approvals": approvals})
}

func (h *Handler) GetApproval(w http.ResponseWriter, r *http.Request) {
	if h.approvals == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "approval service not configured"})
		return
	}
	a, ok := h.approvals.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "approval not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"approval": decorateApproval(a, requestBaseURL(r))})
}

func (h *Handler) DecideApproval(w http.ResponseWriter, r *http.Request) {
	if h.approvals == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "approval service not configured"})
		return
	}
	var req approval.DecisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	existing, ok := h.approvals.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "approval not found"})
		return
	}
	if existing.Status != approval.StatusPending {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "approval is not pending"})
		return
	}
	var currentTask task.Task
	hasTask := strings.TrimSpace(existing.TaskID) != ""
	if hasTask {
		if h.tasks == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "task service not configured"})
			return
		}
		var ok bool
		currentTask, ok = h.tasks.Get(existing.TaskID)
		if !ok {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "approval task not found"})
			return
		}
		if req.Approved && currentTask.Quote == nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "quote required before consent"})
			return
		}
	}
	var paymentRecord payment.Record
	var paymentIntent payment.PaymentIntent
	paymentConfirmed := false
	if req.Approved && existing.PaymentRequired {
		if !hasTask {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "payment approvals require a task"})
			return
		}
		if h.paymentPIN == nil || h.payments == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "payment confirmation service not configured"})
			return
		}
		if strings.TrimSpace(req.PaymentPin) == "" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "payment_pin_required"})
			return
		}
		if err := h.paymentPIN.Verify(req.PaymentPin); err != nil {
			code := "invalid_payment_pin"
			if strings.Contains(err.Error(), "not_configured") {
				code = "payment_pin_not_configured"
			}
			writeJSON(w, http.StatusForbidden, map[string]string{"error": code})
			return
		}
		record, intent, err := h.confirmApprovalPayment(existing, "")
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		paymentRecord = record
		paymentIntent = intent
		paymentConfirmed = true
	}
	a, err := h.approvals.Decide(chi.URLParam(r, "id"), req)
	if err != nil {
		status := http.StatusConflict
		if strings.Contains(err.Error(), "not found") {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	if !hasTask {
		writeJSON(w, http.StatusOK, map[string]any{"approval": decorateApproval(a, requestBaseURL(r))})
		return
	}
	consent := task.ConsentRequest{
		Approved:          req.Approved,
		UserNote:          req.UserNote,
		ApprovalRequestID: a.ID,
	}
	updated, err := h.tasks.Consent(a.TaskID, consent)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	resp := map[string]any{"approval": decorateApproval(a, requestBaseURL(r)), "task": updated}
	if paymentConfirmed {
		resp["payment"] = paymentRecord
		if paymentIntent.PaymentID != "" {
			resp["paymentIntent"] = paymentIntent
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// --- Seller selection order-plan endpoints ---

func (h *Handler) ListOrderPlans(w http.ResponseWriter, r *http.Request) {
	if h.orderPlans == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order plan service not configured"})
		return
	}
	filter := orderplan.ListFilter{Status: orderplan.Status(strings.TrimSpace(r.URL.Query().Get("status")))}
	writeJSON(w, http.StatusOK, map[string]any{"orderPlans": h.orderPlans.List(filter)})
}

func (h *Handler) GetOrderPlan(w http.ResponseWriter, r *http.Request) {
	if h.orderPlans == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order plan service not configured"})
		return
	}
	plan, ok := h.orderPlans.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "order plan not found"})
		return
	}
	writeJSON(w, http.StatusOK, h.orderPlanResponse(plan, false))
}

func (h *Handler) SelectOrderPlan(w http.ResponseWriter, r *http.Request) {
	if h.orderPlans == nil || h.tasks == nil || h.approvals == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order plan service not configured"})
		return
	}
	var req orderplan.SelectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	plan, ok := h.orderPlans.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "order plan not found"})
		return
	}
	if plan.Status == orderplan.StatusSelected {
		if plan.SelectedOptionID == strings.TrimSpace(req.OptionID) {
			writeJSON(w, http.StatusOK, h.orderPlanResponse(plan, true))
			return
		}
		writeJSON(w, http.StatusConflict, map[string]string{"error": "plan_already_selected"})
		return
	}
	if plan.Status != orderplan.StatusPendingSelection {
		writeJSON(w, http.StatusConflict, map[string]string{"error": string(plan.Status)})
		return
	}
	option, ok := h.orderPlans.FindOption(plan, req.OptionID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "order option not found"})
		return
	}
	if plan.RealtimeRequired && option.RealtimeStatus != "quoted" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "option is not realtime-confirmed"})
		return
	}
	if err := h.validateOrderOption(plan, option); err != nil {
		updated, _ := h.orderPlans.MarkInvalidated(plan, err.Error())
		writeJSON(w, http.StatusConflict, map[string]any{"error": "offer_expired", "orderPlan": updated})
		return
	}
	amount := option.PriceSnapshot.PricePerUnit
	if amount > 0 {
		if h.paymentPIN == nil || h.payments == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "payment confirmation service not configured"})
			return
		}
		if strings.TrimSpace(req.PaymentPin) == "" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "payment_pin_required"})
			return
		}
		if err := h.paymentPIN.Verify(req.PaymentPin); err != nil {
			code := "invalid_payment_pin"
			if strings.Contains(err.Error(), "not_configured") {
				code = "payment_pin_not_configured"
			}
			writeJSON(w, http.StatusForbidden, map[string]string{"error": code})
			return
		}
	}

	taskReq := option.Draft.TaskCreateRequest()
	if strings.TrimSpace(taskReq.ProjectPath) == "" {
		taskReq.ProjectPath = plan.ProjectPath
	}
	created, err := h.tasks.Create(taskReq)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	currency := firstNonEmpty(option.PriceSnapshot.Currency, "USDC")
	quoted, err := h.tasks.Quote(created.ID, task.QuoteRequest{
		ProviderPubkey:   option.ProviderPubkey,
		PriceAmount:      amount,
		Currency:         currency,
		EstimatedSeconds: 60,
		Notes:            "Quote generated from Exora market order plan.",
		ExpiresAt:        option.ExpiresAt,
	})
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	a, err := h.approvals.Create(approval.CreateRequest{
		TaskID:         quoted.ID,
		Action:         "approve_quote",
		UserPubkey:     quoted.RequesterPubkey,
		AgentID:        quoted.AgentID,
		ProviderPubkey: option.ProviderPubkey,
		Quote: approval.QuoteSummary{
			ID:               quoted.Quote.ID,
			ProviderPubkey:   option.ProviderPubkey,
			PriceAmount:      amount,
			Currency:         currency,
			EstimatedSeconds: quoted.Quote.EstimatedSeconds,
			Notes:            quoted.Quote.Notes,
			ExpiresAt:        quoted.Quote.ExpiresAt,
		},
		Amount:    approval.Amount{Value: amount, Currency: currency},
		ExpiresAt: option.ExpiresAt,
	})
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	if _, err := h.tasks.SetApprovalRequest(a.TaskID, a.ID); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	var paymentRecord payment.Record
	var paymentIntent payment.PaymentIntent
	if a.PaymentRequired {
		record, intent, err := h.confirmApprovalPayment(a, plan.ID)
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		paymentRecord = record
		paymentIntent = intent
	}
	a, err = h.approvals.Decide(a.ID, approval.DecisionRequest{Approved: true, DecidedBy: "exora-order-plan", UserNote: req.UserNote})
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	updatedTask, err := h.tasks.Consent(a.TaskID, task.ConsentRequest{
		Approved:          true,
		UserNote:          req.UserNote,
		ApprovalRequestID: a.ID,
	})
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	paymentID := paymentRecord.ID
	plan, err = h.orderPlans.MarkSelected(plan, option.OptionID, updatedTask.ID, a.ID, paymentID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if paymentRecord.ID != "" && paymentRecord.Mode == "chain_escrow" && providerPaymentEvidenceFromRecord(paymentRecord) == nil {
		plan.NextAction = "fund_chain_escrow"
		plan.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		_ = h.orderPlans.Save(plan)
		resp := h.orderPlanResponse(plan, true)
		resp["task"] = updatedTask
		resp["approval"] = decorateApproval(a, requestBaseURL(r))
		resp["payment"] = paymentRecord
		if paymentIntent.PaymentID != "" {
			resp["paymentIntent"] = paymentIntent
		}
		resp["nextAction"] = "fund_chain_escrow"
		writeJSON(w, http.StatusOK, resp)
		return
	}
	if plan.RealtimeRequired {
		job, err := h.submitProviderJob(r.Context(), plan, option, updatedTask, a, paymentID)
		if err != nil {
			_, _ = h.tasks.Fail(updatedTask.ID, task.FailRequest{ProviderPubkey: option.ProviderPubkey, Error: err.Error()})
			plan, _ = h.orderPlans.AddEvent(plan, "provider_job_submit_failed", err.Error(), option.OptionID)
			writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "orderPlan": plan, "task": updatedTask})
			return
		}
		plan, _ = h.orderPlans.MarkProviderJob(plan, job.JobID)
		plan, _ = h.orderPlans.AddEvent(plan, "provider_job_submitted", "Provider Docker job submitted.", option.OptionID)
		go h.watchProviderJob(plan.ID, updatedTask.ID, option.ProviderEndpoint, job.JobID, option.ProviderPubkey)
	}
	resp := h.orderPlanResponse(plan, true)
	resp["task"] = updatedTask
	resp["approval"] = decorateApproval(a, requestBaseURL(r))
	if paymentRecord.ID != "" {
		resp["payment"] = paymentRecord
		if paymentIntent.PaymentID != "" {
			resp["paymentIntent"] = paymentIntent
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CancelOrderPlan(w http.ResponseWriter, r *http.Request) {
	if h.orderPlans == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order plan service not configured"})
		return
	}
	var req struct {
		UserNote string `json:"userNote"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	plan, ok := h.orderPlans.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "order plan not found"})
		return
	}
	if plan.Status == orderplan.StatusSelected {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "plan_already_selected"})
		return
	}
	plan, err := h.orderPlans.Cancel(plan, req.UserNote)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, h.orderPlanResponse(plan, false))
}

func (h *Handler) SubmitOrderPlanProviderJob(w http.ResponseWriter, r *http.Request) {
	if h.orderPlans == nil || h.tasks == nil || h.approvals == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order plan service not configured"})
		return
	}
	plan, ok := h.orderPlans.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "order plan not found"})
		return
	}
	if plan.Status != orderplan.StatusSelected {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "plan_not_selected"})
		return
	}
	if strings.TrimSpace(plan.ProviderJobID) != "" {
		writeJSON(w, http.StatusOK, h.orderPlanResponse(plan, true))
		return
	}
	option, ok := h.orderPlans.FindOption(plan, plan.SelectedOptionID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "selected order option not found"})
		return
	}
	localTask, ok := h.tasks.Get(plan.TaskID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "task not found"})
		return
	}
	a, ok := h.approvals.Get(plan.ApprovalID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "approval not found"})
		return
	}
	if strings.TrimSpace(plan.PaymentID) != "" {
		if h.payments == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "payment ledger service not configured"})
			return
		}
		record, ok := h.payments.Get(plan.PaymentID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "payment not found"})
			return
		}
		if providerPaymentEvidenceFromRecord(record) == nil {
			writeJSON(w, http.StatusPaymentRequired, map[string]any{
				"error":      "payment_evidence_required",
				"orderPlan":  plan,
				"task":       localTask,
				"payment":    record,
				"nextAction": paymentEvidenceNextAction(record),
			})
			return
		}
	}
	job, err := h.submitProviderJob(r.Context(), plan, option, localTask, a, plan.PaymentID)
	if err != nil {
		_, _ = h.tasks.Fail(localTask.ID, task.FailRequest{ProviderPubkey: option.ProviderPubkey, Error: err.Error()})
		plan, _ = h.orderPlans.AddEvent(plan, "provider_job_submit_failed", err.Error(), option.OptionID)
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "orderPlan": plan, "task": localTask})
		return
	}
	plan, _ = h.orderPlans.MarkProviderJob(plan, job.JobID)
	plan, _ = h.orderPlans.AddEvent(plan, "provider_job_submitted", "Provider Docker job submitted.", option.OptionID)
	go h.watchProviderJob(plan.ID, localTask.ID, option.ProviderEndpoint, job.JobID, option.ProviderPubkey)
	resp := h.orderPlanResponse(plan, true)
	resp["task"] = localTask
	resp["approval"] = decorateApproval(a, requestBaseURL(r))
	resp["providerJob"] = job
	writeJSON(w, http.StatusOK, resp)
}

// --- Local payment confirmation endpoints ---

func (h *Handler) PaymentPINStatus(w http.ResponseWriter, r *http.Request) {
	if h.paymentPIN == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "payment pin service not configured"})
		return
	}
	status, err := h.paymentPIN.Status()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"paymentPin": status})
}

func (h *Handler) SetPaymentPIN(w http.ResponseWriter, r *http.Request) {
	if h.paymentPIN == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "payment pin service not configured"})
		return
	}
	var req struct {
		Pin       string `json:"pin"`
		AccountID string `json:"accountId,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	status, err := h.paymentPIN.SetForAccount(req.Pin, req.AccountID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"paymentPin": status})
}

func (h *Handler) VerifyPaymentPIN(w http.ResponseWriter, r *http.Request) {
	if h.paymentPIN == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "payment pin service not configured"})
		return
	}
	var req struct {
		Pin       string `json:"pin"`
		AccountID string `json:"accountId,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := h.paymentPIN.VerifyForAccount(req.Pin, req.AccountID); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"verified": true})
}

func (h *Handler) ListPayments(w http.ResponseWriter, r *http.Request) {
	if h.payments == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "payment ledger service not configured"})
		return
	}
	filter := payment.ListFilter{
		ApprovalID: strings.TrimSpace(r.URL.Query().Get("approvalId")),
		TaskID:     strings.TrimSpace(r.URL.Query().Get("taskId")),
	}
	writeJSON(w, http.StatusOK, map[string]any{"payments": h.payments.List(filter)})
}

func (h *Handler) GetPayment(w http.ResponseWriter, r *http.Request) {
	if h.payments == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "payment ledger service not configured"})
		return
	}
	record, ok := h.payments.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "payment not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"payment": record})
}

func (h *Handler) PayWithWallet(w http.ResponseWriter, r *http.Request) {
	if h.payments == nil || h.wallets == nil || h.paymentPIN == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "wallet payment service not configured"})
		return
	}
	if strings.TrimSpace(h.usdcMint) == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "usdc_mint_not_configured"})
		return
	}
	record, ok := h.payments.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "payment not found"})
		return
	}
	var req struct {
		PaymentPin string `json:"paymentPin"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
	}
	if strings.TrimSpace(req.PaymentPin) == "" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "payment_pin_required"})
		return
	}
	if err := h.paymentPIN.Verify(req.PaymentPin); err != nil {
		code := "invalid_payment_pin"
		if strings.Contains(err.Error(), "not_configured") {
			code = "payment_pin_not_configured"
		}
		writeJSON(w, http.StatusForbidden, map[string]string{"error": code})
		return
	}
	address, err := h.wallets.PublicSigningAddress()
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
		return
	}
	updated, intent, err := h.payments.AttachChainIntent(record.ID, h.defaultChainIntentRequest(record, payment.ChainIntentRequest{
		BuyerPubkey: address,
		Currency:    "USDC",
		Mint:        h.usdcMint,
		Decimals:    h.usdcDecimals,
		NativeSOL:   false,
	}))
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	payload := []byte("exora.wallet.pay.v1\n" + intent.CanonicalIntentHash)
	_, signature, err := h.wallets.SignPayload(payload)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
		return
	}
	updated, err = h.payments.MarkChainConfirming(updated.ID, "", 0)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"payment":         updated,
		"intent":          intent,
		"walletSignature": signature,
		"feePolicy":       h.walletFeePolicy(),
		"nextAction":      "submit_to_cloud_relayer",
		"source":          "exora_builtin_wallet",
	})
}

func (h *Handler) PreparePaymentChainIntent(w http.ResponseWriter, r *http.Request) {
	if h.payments == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "payment ledger service not configured"})
		return
	}
	record, ok := h.payments.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "payment not found"})
		return
	}
	var req payment.ChainIntentRequest
	if r.Body != nil && r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
	}
	req = h.defaultChainIntentRequest(record, req)
	updated, intent, err := h.payments.AttachChainIntent(record.ID, req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"payment":      updated,
		"intent":       intent,
		"nextAction":   "fund_chain_escrow",
		"resumeHint":   "After the owner funds escrow, call sync_payment_evidence/find_payment_evidence until found_finalized.",
		"redactions":   []string{"payment_pin", "private_key", "owner_token"},
		"source":       "dock_chain_intent",
		"status":       updated.Status,
		"evidence":     paymentEvidenceSummary(updated),
		"paymentId":    updated.ID,
		"escrowPda":    intent.EscrowPDA,
		"programId":    intent.ProgramID,
		"intentHash":   intent.CanonicalIntentHash,
		"amountAtomic": intent.AmountAtomic,
		"currency":     intent.Currency,
		"mint":         intent.Mint,
		"decimals":     intent.Decimals,
		"nativeSol":    intent.NativeSOL,
		"chain":        intent.Chain,
		"network":      intent.Network,
		"orderPlanId":  intent.OrderPlanID,
		"taskId":       intent.TaskID,
	})
}

func (h *Handler) SyncPaymentEvidence(w http.ResponseWriter, r *http.Request) {
	if h.payments == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "payment ledger service not configured"})
		return
	}
	paymentID := chi.URLParam(r, "id")
	record, ok := h.payments.Get(paymentID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "payment not found"})
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	var evidence payment.PaymentEvidence
	if raw, ok := body["evidence"]; ok {
		if err := decodeMapValue(raw, &evidence); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	} else if len(body) > 0 {
		if err := decodeMapValue(body, &evidence); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}
	if strings.TrimSpace(evidence.PaymentID) == "" {
		evidence.PaymentID = paymentID
	}
	if evidence.Status == "" {
		evidence.Status = payment.EvidencePendingChainConfirmation
	}
	if strings.TrimSpace(evidence.Chain) == "" {
		evidence.Chain = firstNonEmpty(record.Chain, "solana")
	}
	if strings.TrimSpace(evidence.Network) == "" {
		evidence.Network = firstNonEmpty(record.Network, h.solanaNetwork)
	}
	if strings.TrimSpace(evidence.ProgramID) == "" {
		evidence.ProgramID = firstNonEmpty(record.ProgramID, h.escrowProgramID)
	}
	if strings.TrimSpace(evidence.EscrowPDA) == "" {
		evidence.EscrowPDA = record.EscrowPDA
	}
	if evidence.AmountAtomic == 0 {
		evidence.AmountAtomic = record.AmountAtomic
	}
	if strings.TrimSpace(evidence.Currency) == "" {
		evidence.Currency = record.Currency
	}
	if strings.TrimSpace(evidence.Mint) == "" {
		evidence.Mint = record.Mint
	}
	if evidence.Decimals == 0 {
		evidence.Decimals = record.Decimals
	}
	if record.NativeSOL {
		evidence.NativeSOL = true
	}
	updated, err := h.payments.ApplyEvidence(evidence)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "payment": updated, "evidence": evidence})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"payment":    updated,
		"evidence":   evidence,
		"nextAction": paymentEvidenceNextAction(updated),
		"source":     "dock_payment_evidence_sync",
	})
}

func (h *Handler) FindPaymentEvidence(w http.ResponseWriter, r *http.Request) {
	if h.payments == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "payment ledger service not configured"})
		return
	}
	record, ok := h.payments.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "payment not found"})
		return
	}
	intent, _ := payment.BuildPaymentIntent(record, h.defaultChainIntentRequest(record, payment.ChainIntentRequest{}))
	nextAction := paymentEvidenceNextAction(record)
	writeJSON(w, http.StatusOK, map[string]any{
		"payment":      record,
		"intent":       intent,
		"evidence":     paymentEvidenceSummary(record),
		"nextAction":   nextAction,
		"source":       "dock_payment_ledger",
		"cloudAction":  "Call Exora Cloud /v1/payment-evidence/resolve or /v1/payment-evidence/{paymentId}; do not submit paid worker jobs until status is found_finalized.",
		"mustVerify":   true,
		"safeForAgent": true,
	})
}

func (h *Handler) defaultChainIntentRequest(record payment.Record, req payment.ChainIntentRequest) payment.ChainIntentRequest {
	req.BuyerPubkey = firstNonEmpty(req.BuyerPubkey, record.BuyerPubkey, h.selfPubkey)
	req.SellerPubkey = firstNonEmpty(req.SellerPubkey, record.ProviderPubkey)
	req.Network = firstNonEmpty(req.Network, record.Network, h.solanaNetwork, "devnet")
	req.ProgramID = firstNonEmpty(req.ProgramID, record.ProgramID, h.escrowProgramID)
	req.TaskID = firstNonEmpty(req.TaskID, record.TaskID)
	req.Currency = firstNonEmpty(req.Currency, record.Currency, "USDC")
	req.AmountLamports = firstPositiveUint64(req.AmountLamports, record.AmountLamports, payment.LamportsFromAmount(record.Amount, req.Currency))
	req.AmountAtomic = firstPositiveUint64(req.AmountAtomic, record.AmountAtomic)
	if req.AmountAtomic == 0 {
		amountAtomic, mint, decimals, nativeSOL := payment.AtomicAmountFromAmount(record.Amount, req.Currency, h.usdcMint, h.usdcDecimals)
		req.AmountAtomic = amountAtomic
		req.Mint = firstNonEmpty(req.Mint, record.Mint, mint)
		if req.Decimals == 0 {
			req.Decimals = decimals
		}
		if nativeSOL {
			req.NativeSOL = true
		}
	}
	if req.AmountLamports > 0 {
		req.AmountAtomic = firstPositiveUint64(req.AmountAtomic, req.AmountLamports)
		req.Decimals = firstNonZeroUint8(req.Decimals, 9)
		req.NativeSOL = true
		req.Mint = ""
	} else {
		req.Mint = firstNonEmpty(req.Mint, record.Mint, h.usdcMint)
		req.Decimals = firstNonZeroUint8(req.Decimals, record.Decimals, h.usdcDecimals, 6)
	}
	return req
}

func paymentEvidenceSummary(record payment.Record) map[string]any {
	status := record.EvidenceStatus
	if status == "" && record.Status == payment.StatusChainConfirmed {
		status = payment.EvidenceFoundFinalized
	}
	return map[string]any{
		"evidenceId":     record.EvidenceID,
		"paymentId":      record.ID,
		"status":         status,
		"chain":          record.Chain,
		"network":        record.Network,
		"programId":      record.ProgramID,
		"escrowPda":      record.EscrowPDA,
		"txSignature":    record.TxSignature,
		"slot":           record.Slot,
		"finality":       record.Finality,
		"buyerPubkey":    record.BuyerPubkey,
		"sellerPubkey":   record.ProviderPubkey,
		"amountLamports": record.AmountLamports,
		"amountAtomic":   record.AmountAtomic,
		"currency":       record.Currency,
		"mint":           record.Mint,
		"decimals":       record.Decimals,
		"nativeSol":      record.NativeSOL,
		"source":         "chain_scan_required",
	}
}

func paymentEvidenceNextAction(record payment.Record) string {
	switch record.EvidenceStatus {
	case payment.EvidenceFoundFinalized, payment.EvidenceReleased:
		return "submit_worker_job"
	case payment.EvidenceMismatch:
		return "stop_and_show_payment_evidence_mismatch"
	default:
		return "sync_payment_evidence"
	}
}

func providerPaymentEvidenceFromRecord(record payment.Record) *providerprotocol.PaymentEvidence {
	if record.EvidenceStatus != payment.EvidenceFoundFinalized && record.EvidenceStatus != payment.EvidenceReleased {
		return nil
	}
	return &providerprotocol.PaymentEvidence{
		EvidenceID:     record.EvidenceID,
		PaymentID:      record.ID,
		Status:         string(record.EvidenceStatus),
		Chain:          record.Chain,
		Network:        record.Network,
		ProgramID:      record.ProgramID,
		EscrowPDA:      record.EscrowPDA,
		TxSignature:    record.TxSignature,
		Slot:           record.Slot,
		Finality:       record.Finality,
		BuyerPubkey:    record.BuyerPubkey,
		SellerPubkey:   record.ProviderPubkey,
		AmountLamports: record.AmountLamports,
		AmountAtomic:   record.AmountAtomic,
		Currency:       record.Currency,
		Mint:           record.Mint,
		Decimals:       record.Decimals,
		NativeSOL:      record.NativeSOL,
		Source:         "chain_scan",
	}
}

func providerPaymentEvidenceFinalized(evidence *providerprotocol.PaymentEvidence) bool {
	if evidence == nil {
		return false
	}
	status := strings.ToLower(strings.TrimSpace(evidence.Status))
	if status != string(payment.EvidenceFoundFinalized) && status != string(payment.EvidenceReleased) {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(evidence.Chain), "solana") &&
		strings.TrimSpace(evidence.EscrowPDA) != "" &&
		strings.TrimSpace(evidence.PaymentID) != "" &&
		strings.EqualFold(strings.TrimSpace(evidence.Source), "chain_scan") &&
		strings.EqualFold(strings.TrimSpace(evidence.Finality), "finalized")
}

func (h *Handler) ensurePaymentIntentForApproval(a approval.Approval, orderPlanID string) (payment.Record, payment.PaymentIntent, error) {
	if h.payments == nil {
		return payment.Record{}, payment.PaymentIntent{}, fmt.Errorf("payment ledger service not configured")
	}
	record, err := h.payments.EnsureIntent(a)
	if err != nil {
		return payment.Record{}, payment.PaymentIntent{}, err
	}
	if strings.TrimSpace(h.escrowProgramID) == "" {
		return record, payment.PaymentIntent{}, nil
	}
	req := h.defaultChainIntentRequest(record, payment.ChainIntentRequest{
		OrderPlanID:  strings.TrimSpace(orderPlanID),
		TaskID:       a.TaskID,
		SellerPubkey: firstNonEmpty(a.ProviderPubkey, a.Quote.ProviderPubkey),
	})
	return h.payments.AttachChainIntent(record.ID, req)
}

func (h *Handler) confirmApprovalPayment(a approval.Approval, orderPlanID string) (payment.Record, payment.PaymentIntent, error) {
	if h.payments == nil {
		return payment.Record{}, payment.PaymentIntent{}, fmt.Errorf("payment ledger service not configured")
	}
	if strings.TrimSpace(h.escrowProgramID) == "" {
		record, err := h.payments.ConfirmSimulated(a)
		return record, payment.PaymentIntent{}, err
	}
	record, intent, err := h.ensurePaymentIntentForApproval(a, orderPlanID)
	if err != nil {
		return payment.Record{}, payment.PaymentIntent{}, err
	}
	record, err = h.payments.MarkChainConfirming(record.ID, "", 0)
	if err != nil {
		return payment.Record{}, payment.PaymentIntent{}, err
	}
	return record, intent, nil
}

// --- Cache endpoints ---

func (h *Handler) GetAccount(w http.ResponseWriter, r *http.Request) {
	addr := chi.URLParam(r, "address")
	data, ok := h.cache.Get(fmt.Sprintf("account:%s", addr))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (h *Handler) GetProduct(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if h.products != nil {
		if p, ok := h.products.Get(id); ok {
			writeJSON(w, http.StatusOK, p)
			return
		}
	}
	data, ok := h.cache.Get(fmt.Sprintf("product:%s", id))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (h *Handler) ListProducts(w http.ResponseWriter, r *http.Request) {
	products := []product.Product{}
	if h.products != nil {
		products = h.products.List()
	}
	writeJSON(w, http.StatusOK, map[string]any{"products": products})
}

func (h *Handler) CreateProduct(w http.ResponseWriter, r *http.Request) {
	var req product.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if h.reviewAgent == nil || h.products == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "product service not configured"})
		return
	}

	category, title := "Marketplace", productTitle(req.Description)
	reviewReq := agent.ReviewRequest{
		ProductID:    fmt.Sprintf("draft-%d", time.Now().UnixNano()),
		Title:        title,
		Description:  req.Description,
		Category:     category,
		Price:        req.Price,
		ImageCIDs:    req.ImageCIDs,
		SellerPubkey: req.SellerPubkey,
	}

	review, err := h.reviewAgent.Review(r.Context(), reviewReq)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "review failed: " + err.Error()})
		return
	}
	review.MinerPubkey = h.selfPubkey
	if !review.Approved {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"approved": false, "review": review})
		return
	}

	p, err := product.Build(req, review)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := h.products.Save(p); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "product save failed"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"product": p, "review": review})
}

// --- Agent capability resource endpoints ---

func (h *Handler) ListResources(w http.ResponseWriter, r *http.Request) {
	if h.resources == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "resource service not configured"})
		return
	}
	kind := resource.Type(strings.TrimSpace(r.URL.Query().Get("type")))
	provider := strings.TrimSpace(r.URL.Query().Get("provider"))
	query := r.URL.Query().Get("q")
	region := strings.TrimSpace(r.URL.Query().Get("region"))
	availability := strings.TrimSpace(r.URL.Query().Get("availability"))
	minVRAMGB, hasMinVRAMGB, err := optionalQueryInt(r, "minVramGb", "min_vram_gb", "vramGbMin", "vram_gb_min")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	minGPUCount, hasMinGPUCount, err := optionalQueryInt(r, "minGpuCount", "min_gpu_count", "gpuCountMin", "gpu_count_min")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if kind != "" && !resource.IsKnownType(kind) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown resource type"})
		return
	}
	resources := h.resources.Search(kind, query)
	if provider != "" {
		filtered := make([]resource.Resource, 0, len(resources))
		for _, res := range resources {
			if res.ProviderPubkey == provider || res.Provider == provider {
				filtered = append(filtered, res)
			}
		}
		resources = filtered
	}
	if region != "" || availability != "" || hasMinVRAMGB || hasMinGPUCount {
		filtered := make([]resource.Resource, 0, len(resources))
		for _, res := range resources {
			if region != "" && !strings.EqualFold(res.Spec.Region, region) {
				continue
			}
			if availability != "" && !strings.EqualFold(res.Availability, availability) {
				continue
			}
			if hasMinVRAMGB && res.Spec.VRAMGB < minVRAMGB {
				continue
			}
			if hasMinGPUCount && res.Spec.GPUCount < minGPUCount {
				continue
			}
			filtered = append(filtered, res)
		}
		resources = filtered
	}
	writeJSON(w, http.StatusOK, map[string]any{"resources": resources})
}

func (h *Handler) CreateResource(w http.ResponseWriter, r *http.Request) {
	if h.resources == nil || h.reviewAgent == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "resource service not configured"})
		return
	}
	var req resource.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	reviewReq := agent.ReviewRequest{
		ProductID:    fmt.Sprintf("resource-draft-%d", time.Now().UnixNano()),
		Title:        req.Name,
		Description:  req.Description,
		Category:     string(req.Type),
		Price:        req.PricePerUnit,
		SellerPubkey: req.ProviderPubkey,
	}
	review, err := h.reviewAgent.Review(r.Context(), reviewReq)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "review failed: " + err.Error()})
		return
	}
	review.MinerPubkey = h.selfPubkey
	if !review.Approved {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"approved": false, "review": review})
		return
	}

	res, err := resource.Build(req, resource.ReviewInput{
		Approved:    review.Approved,
		Reason:      review.Reason,
		MinerPubkey: review.MinerPubkey,
		Timestamp:   review.Timestamp,
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := h.resources.Save(res); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "resource save failed"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"resource": res, "review": review})
}

func (h *Handler) GetResource(w http.ResponseWriter, r *http.Request) {
	if h.resources == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "resource service not configured"})
		return
	}
	res, ok := h.resources.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "resource not found"})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *Handler) CreateDelegation(w http.ResponseWriter, r *http.Request) {
	if h.delegations == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "delegation service not configured"})
		return
	}
	var req delegation.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	d, err := h.delegations.Create(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"delegation": d})
}

func (h *Handler) ListDelegations(w http.ResponseWriter, r *http.Request) {
	if h.delegations == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "delegation service not configured"})
		return
	}
	user := strings.TrimSpace(r.URL.Query().Get("userPubkey"))
	if user == "" {
		user = strings.TrimSpace(r.URL.Query().Get("user"))
	}
	agentID := strings.TrimSpace(r.URL.Query().Get("agentId"))
	delegations := h.delegations.ListByUser(user)
	if agentID != "" {
		filtered := make([]delegation.Delegation, 0, len(delegations))
		for _, d := range delegations {
			if d.AgentID == agentID {
				filtered = append(filtered, d)
			}
		}
		delegations = filtered
	}
	writeJSON(w, http.StatusOK, map[string]any{"delegations": delegations})
}

func (h *Handler) CreateLease(w http.ResponseWriter, r *http.Request) {
	if h.leases == nil || h.resources == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "lease service not configured"})
		return
	}
	var req lease.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	l, err := h.leases.Create(req, h.resources, h.delegations)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"lease": l})
}

func (h *Handler) ListLeases(w http.ResponseWriter, r *http.Request) {
	if h.leases == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "lease service not configured"})
		return
	}
	party := strings.TrimSpace(r.URL.Query().Get("party"))
	role := strings.TrimSpace(r.URL.Query().Get("role"))
	if user := strings.TrimSpace(r.URL.Query().Get("userPubkey")); user != "" {
		party = user
		role = "user"
	}
	if provider := strings.TrimSpace(r.URL.Query().Get("providerPubkey")); provider != "" {
		party = provider
		role = "provider"
	}
	if agentID := strings.TrimSpace(r.URL.Query().Get("agentId")); agentID != "" {
		party = agentID
		role = "agent"
	}
	if party != "" && role != "user" && role != "provider" && role != "agent" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "role must be user, provider, or agent"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"leases": h.leases.ListByParty(party, role)})
}

func (h *Handler) GetLease(w http.ResponseWriter, r *http.Request) {
	if h.leases == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "lease service not configured"})
		return
	}
	l, ok := h.leases.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "lease not found"})
		return
	}
	writeJSON(w, http.StatusOK, l)
}

func (h *Handler) RevokeLease(w http.ResponseWriter, r *http.Request) {
	if h.leases == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "lease service not configured"})
		return
	}
	l, err := h.leases.Revoke(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lease": l})
}

func (h *Handler) GetLeaseCredentials(w http.ResponseWriter, r *http.Request) {
	if h.leases == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "lease service not configured"})
		return
	}
	cred, err := h.leases.Credentials(chi.URLParam(r, "id"))
	if err != nil {
		status := http.StatusConflict
		if strings.Contains(err.Error(), "not found") {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"credential": cred})
}

func (h *Handler) GetTx(w http.ResponseWriter, r *http.Request) {
	sig := chi.URLParam(r, "signature")
	data, ok := h.cache.Get(fmt.Sprintf("tx:%s", sig))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// --- Order endpoints ---

func (h *Handler) CreateOrders(w http.ResponseWriter, r *http.Request) {
	if h.orders == nil || h.products == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order service not configured"})
		return
	}

	var req orderpkg.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	orders, err := h.orders.Create(req, h.products)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"orders": orders})
}

func (h *Handler) ListOrders(w http.ResponseWriter, r *http.Request) {
	if h.orders == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order service not configured"})
		return
	}
	party := strings.TrimSpace(r.URL.Query().Get("party"))
	role := strings.TrimSpace(r.URL.Query().Get("role"))
	if party == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "party required"})
		return
	}
	if role != "buyer" && role != "seller" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "role must be buyer or seller"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"orders": h.orders.ListByParty(party, role)})
}

func (h *Handler) GetOrder(w http.ResponseWriter, r *http.Request) {
	if h.orders == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order service not configured"})
		return
	}
	id := chi.URLParam(r, "id")
	o, ok := h.orders.Get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "order not found"})
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (h *Handler) SimulateOrderPayment(w http.ResponseWriter, r *http.Request) {
	if h.orders == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order service not configured"})
		return
	}
	o, err := h.orders.SimulatePayment(chi.URLParam(r, "id"))
	if err != nil {
		status := http.StatusConflict
		if strings.Contains(err.Error(), "not found") {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"order": o})
}

func (h *Handler) UpdateOrderStatus(w http.ResponseWriter, r *http.Request) {
	if h.orders == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order service not configured"})
		return
	}
	var req orderpkg.StatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	o, err := h.orders.UpdateStatus(chi.URLParam(r, "id"), req.Status)
	if err != nil {
		status := http.StatusConflict
		if strings.Contains(err.Error(), "not found") {
			status = http.StatusNotFound
		}
		if strings.Contains(err.Error(), "unknown status") {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"order": o})
}

// --- Chat endpoints ---

// SendMessage: a client sends a signed message, and the miner forwards it to responsible peers.
// POST /v1/chat/send
func (h *Handler) SendMessage(w http.ResponseWriter, r *http.Request) {
	var msg chat.Message
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	if err := msg.Verify(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	if err := h.relay.Forward(&msg); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "sent", "hash": msg.Hash})
}

// ReceiveMessage: peer miner pushes a message to this miner for storage.
// POST /v1/chat/receive
func (h *Handler) ReceiveMessage(w http.ResponseWriter, r *http.Request) {
	var msg chat.Message
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	if err := h.chatStore.Append(&msg); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "stored"})
}

// GetMessages: fetch messages for an order.
// GET /v1/chat/messages/{orderID}?after=0
func (h *Handler) GetMessages(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderID")
	afterStr := r.URL.Query().Get("after")
	after := 0
	if afterStr != "" {
		after, _ = strconv.Atoi(afterStr)
	}

	// Try to sync from peers first if we have few messages
	local := h.chatStore.GetMessages(orderID, 0)
	if len(local) == 0 && h.relay != nil {
		h.relay.FetchFromPeers(r.Context(), orderID)
	}

	msgs := h.chatStore.GetMessages(orderID, after)
	writeJSON(w, http.StatusOK, map[string]any{"messages": msgs})
}

// GetUnread: check which orders have unread messages for a user.
// GET /v1/chat/unread/{pubkey}
func (h *Handler) GetUnread(w http.ResponseWriter, r *http.Request) {
	pubkey := chi.URLParam(r, "pubkey")
	orders := h.chatStore.GetUnreadOrders(pubkey)
	writeJSON(w, http.StatusOK, map[string]any{
		"order_ids": orders,
	})
}

// ExportChat: export full chat chain for dispute evidence.
// GET /v1/chat/export/{orderID}
func (h *Handler) ExportChat(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderID")

	// Sync from peers to get complete chain
	h.relay.FetchFromPeers(r.Context(), orderID)

	data, err := h.chatStore.ExportChain(orderID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// WebSocket: real-time message push to connected web clients.
// GET /ws
func (h *Handler) WebSocket(w http.ResponseWriter, r *http.Request) {
	h.hub.HandleWS(w, r)
}

// LookupMiners lets clients query which miners are responsible for an order.
// GET /v1/chat/lookup/{orderID}
func (h *Handler) LookupMiners(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderID")
	miners := h.ring.Lookup(orderID, chat.ReplicaCount)
	writeJSON(w, http.StatusOK, miners)
}

// --- IPFS endpoints ---

const maxUploadSize = 10 << 20 // 10 MB

// IPFSUpload handles POST /v1/ipfs/upload
// Accepts multipart form with 1-3 files under field "files" and a "product_id" field.
func (h *Handler) IPFSUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body too large or invalid multipart"})
		return
	}

	productID := r.FormValue("product_id")
	if productID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "product_id required"})
		return
	}

	files := r.MultipartForm.File["files"]
	if len(files) == 0 || len(files) > 3 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "upload 1-3 files"})
		return
	}

	var cids []string
	for _, fh := range files {
		f, err := fh.Open()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot open file"})
			return
		}
		cid, err := h.ipfsClient.Add(fh.Filename, f)
		f.Close()
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ipfs add failed: " + err.Error()})
			return
		}
		cids = append(cids, cid)
	}

	if err := h.pinStore.Save(productID, cids); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "pin record save failed"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"cids": cids})
}

// IPFSGet handles GET /v1/ipfs/{cid}
// Proxies IPFS cat and streams raw bytes back.
func (h *Handler) IPFSGet(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "cid")
	rc, err := h.ipfsClient.Cat(cid)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ipfs cat failed"})
		return
	}
	defer rc.Close()

	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, rc)
}

// IPFSUnpin handles DELETE /v1/ipfs/{productID}
// Unpins all CIDs associated with a product.
func (h *Handler) IPFSUnpin(w http.ResponseWriter, r *http.Request) {
	productID := chi.URLParam(r, "productID")
	rec, ok := h.pinStore.Get(productID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no pins for product"})
		return
	}

	for _, cid := range rec.CIDs {
		_ = h.ipfsClient.Unpin(cid) // best-effort
	}
	h.pinStore.Delete(productID)

	writeJSON(w, http.StatusOK, map[string]string{"status": "unpinned"})
}

// --- Review endpoints ---

// SubmitReview handles POST /v1/review/submit
// A client submits a product for review; this node votes locally and collects peer votes.
func (h *Handler) SubmitReview(w http.ResponseWriter, r *http.Request) {
	if h.reviewAgent == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "review agent not configured"})
		return
	}

	var req agent.ReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if req.ProductID == "" || req.Title == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "product_id and title required"})
		return
	}

	// Local vote
	selfResult, err := h.reviewAgent.Review(r.Context(), req)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "local review failed: " + err.Error()})
		return
	}
	selfResult.MinerPubkey = h.selfPubkey

	// Collect peer votes
	consensus := agent.CollectVotes(r.Context(), h.ring, req, selfResult)

	// Persist result
	data, _ := json.Marshal(consensus)
	h.cache.Set(agent.FormatResultKey(req.ProductID), data, 30*24*time.Hour)

	writeJSON(w, http.StatusOK, consensus)
}

// Vote handles POST /v1/review/vote
// Called by peer nodes to get this node's review vote.
func (h *Handler) Vote(w http.ResponseWriter, r *http.Request) {
	if h.reviewAgent == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "review agent not configured"})
		return
	}

	var req agent.ReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	result, err := h.reviewAgent.Review(r.Context(), req)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "review failed: " + err.Error()})
		return
	}
	result.MinerPubkey = h.selfPubkey

	writeJSON(w, http.StatusOK, result)
}

// GetReview handles GET /v1/review/{productID}
// Returns a previously stored review result.
func (h *Handler) GetReview(w http.ResponseWriter, r *http.Request) {
	productID := chi.URLParam(r, "productID")
	data, ok := h.cache.Get(agent.FormatResultKey(productID))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "review not found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func productTitle(desc string) string {
	desc = strings.TrimSpace(desc)
	if desc == "" {
		return "Draft listing"
	}
	for _, sep := range []string{".", ","} {
		if idx := strings.Index(desc, sep); idx > 0 {
			desc = desc[:idx]
			break
		}
	}
	if len(desc) > 56 {
		desc = desc[:56]
	}
	return strings.TrimSpace(desc)
}

func requestBaseURL(r *http.Request) string {
	scheme := "http"
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); forwarded != "" {
		scheme = strings.Split(forwarded, ",")[0]
	} else if r.TLS != nil {
		scheme = "https"
	}
	host := strings.TrimSpace(r.Host)
	if host == "" {
		host = "127.0.0.1:8080"
	}
	return scheme + "://" + host
}

func optionalQueryInt(r *http.Request, names ...string) (int, bool, error) {
	for _, name := range names {
		raw := strings.TrimSpace(r.URL.Query().Get(name))
		if raw == "" {
			continue
		}
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			return 0, false, fmt.Errorf("%s must be a non-negative integer", name)
		}
		return value, true, nil
	}
	return 0, false, nil
}

func firstQueryValue(r *http.Request, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(r.URL.Query().Get(name)); value != "" {
			return value
		}
	}
	return ""
}

func mergeApprovalRequest(req approval.CreateRequest, t task.Task) approval.CreateRequest {
	if strings.TrimSpace(req.TaskID) == "" {
		req.TaskID = t.ID
	}
	if strings.TrimSpace(req.Action) == "" {
		req.Action = "approve_quote"
	}
	if strings.TrimSpace(req.UserPubkey) == "" {
		req.UserPubkey = t.RequesterPubkey
	}
	if strings.TrimSpace(req.AgentID) == "" {
		req.AgentID = t.AgentID
	}
	if strings.TrimSpace(req.ProviderPubkey) == "" {
		req.ProviderPubkey = t.ProviderPubkey
	}
	if t.Quote != nil {
		if strings.TrimSpace(req.Quote.ID) == "" {
			req.Quote.ID = t.Quote.ID
		}
		if strings.TrimSpace(req.Quote.ProviderPubkey) == "" {
			req.Quote.ProviderPubkey = t.Quote.ProviderPubkey
		}
		if req.Quote.PriceAmount == 0 {
			req.Quote.PriceAmount = t.Quote.PriceAmount
		}
		if strings.TrimSpace(req.Quote.Currency) == "" {
			req.Quote.Currency = t.Quote.Currency
		}
		if req.Quote.EstimatedSeconds == 0 {
			req.Quote.EstimatedSeconds = t.Quote.EstimatedSeconds
		}
		if strings.TrimSpace(req.Quote.Notes) == "" {
			req.Quote.Notes = t.Quote.Notes
		}
		if strings.TrimSpace(req.Quote.ExpiresAt) == "" {
			req.Quote.ExpiresAt = t.Quote.ExpiresAt
		}
		if strings.TrimSpace(req.ProviderPubkey) == "" {
			req.ProviderPubkey = t.Quote.ProviderPubkey
		}
		if req.Amount.Value == 0 {
			req.Amount.Value = t.Quote.PriceAmount
		}
		if strings.TrimSpace(req.Amount.Currency) == "" {
			req.Amount.Currency = t.Quote.Currency
		}
	}
	if len(req.FileScope) == 0 {
		req.FileScope = make([]approval.FileScope, 0, len(t.InputFiles))
		for _, file := range t.InputFiles {
			req.FileScope = append(req.FileScope, approval.FileScope{
				Name:        file.Name,
				SizeBytes:   file.SizeBytes,
				ContentType: file.ContentType,
				URI:         file.URI,
				SHA256:      file.SHA256,
			})
		}
	}
	return req
}

func decorateApproval(a approval.Approval, baseURL string) approval.Approval {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if a.ApprovalURL == "" && baseURL != "" && a.ID != "" {
		a.ApprovalURL = baseURL + "/approvals/" + a.ID
	}
	if a.RiskSummary == "" {
		a.RiskSummary = "Approval required before this action can continue."
	}
	a.RequiresOwnerAuth = true
	if a.NextAction == "" {
		switch a.Status {
		case approval.StatusPending:
			switch a.Action {
			case "submit_remote_task_manifest":
				a.NextAction = "review_remote_task_manifest"
			case "seller_execution_plan":
				a.NextAction = "review_seller_execution_plan"
			default:
				a.NextAction = "approve_or_reject"
			}
		case approval.StatusApproved:
			switch a.Action {
			case "submit_remote_task_manifest":
				a.NextAction = "submit_manifest_for_matching"
			case "seller_execution_plan":
				a.NextAction = "run_seller_execution_plan"
			default:
				if strings.TrimSpace(a.TaskID) == "" {
					a.NextAction = "approval_recorded"
				} else {
					a.NextAction = "wait_for_task_execution"
				}
			}
		case approval.StatusRejected:
			if strings.TrimSpace(a.TaskID) == "" {
				a.NextAction = "approval_rejected"
			} else {
				a.NextAction = "task_rejected"
			}
		case approval.StatusExpired:
			a.NextAction = "create_new_approval"
		}
	}
	return a
}

func (h *Handler) validateOrderOption(plan orderplan.Plan, option market.OrderDraftOption) error {
	if h.resources == nil {
		return fmt.Errorf("resource service not configured")
	}
	res, ok := h.resources.Get(option.ResourceID)
	if !ok {
		return fmt.Errorf("resource unavailable")
	}
	if strings.TrimSpace(res.ProviderPubkey) != strings.TrimSpace(option.ProviderPubkey) && strings.TrimSpace(res.Provider) != strings.TrimSpace(option.ProviderPubkey) {
		return fmt.Errorf("provider changed")
	}
	if !strings.EqualFold(res.Availability, "available") {
		return fmt.Errorf("resource unavailable")
	}
	if !plan.RealtimeRequired {
		if res.PricePerUnit != option.PriceSnapshot.PricePerUnit ||
			string(res.BillingUnit) != option.PriceSnapshot.BillingUnit ||
			market.ResourceSnapshotHash(res) != option.PriceSnapshot.ResourceHash {
			return fmt.Errorf("resource changed")
		}
	}
	if plan.NormalizedQuery.Type != "" && res.Type != plan.NormalizedQuery.Type {
		return fmt.Errorf("resource type changed")
	}
	if plan.NormalizedQuery.MinVRAMGB > 0 && res.Spec.VRAMGB < plan.NormalizedQuery.MinVRAMGB {
		return fmt.Errorf("resource no longer satisfies vram")
	}
	if plan.NormalizedQuery.MinGPUCount > 0 && res.Spec.GPUCount < plan.NormalizedQuery.MinGPUCount {
		return fmt.Errorf("resource no longer satisfies gpu count")
	}
	if plan.NormalizedQuery.Region != "" && !strings.EqualFold(res.Spec.Region, plan.NormalizedQuery.Region) {
		return fmt.Errorf("resource region changed")
	}
	return nil
}

func (h *Handler) orderPlanResponse(plan orderplan.Plan, includePayment bool) map[string]any {
	resp := map[string]any{"orderPlan": plan}
	if h.tasks != nil && strings.TrimSpace(plan.TaskID) != "" {
		if t, ok := h.tasks.Get(plan.TaskID); ok {
			resp["task"] = t
		}
	}
	if strings.TrimSpace(plan.ProviderJobID) != "" {
		resp["providerJob"] = map[string]any{"jobId": plan.ProviderJobID, "providerPubkey": selectedProvider(plan)}
	}
	if h.approvals != nil && strings.TrimSpace(plan.ApprovalID) != "" {
		if a, ok := h.approvals.Get(plan.ApprovalID); ok {
			resp["approval"] = decorateApproval(a, "")
		}
	}
	if includePayment && h.payments != nil && strings.TrimSpace(plan.PaymentID) != "" {
		if p, ok := h.payments.Get(plan.PaymentID); ok {
			resp["payment"] = p
		}
	}
	resp["orderState"] = h.orderStateForPlan(plan)
	return resp
}

func (h *Handler) orderStateForPlan(plan orderplan.Plan) map[string]any {
	state := "quote_review"
	owner := "buyer_user"
	waitingFor := "user_input"
	terminalReason := ""
	switch plan.Status {
	case orderplan.StatusPendingSelection:
		state = "quote_review"
	case orderplan.StatusSelected:
		state = "order_authorized"
		if h.tasks != nil && strings.TrimSpace(plan.TaskID) != "" {
			if t, ok := h.tasks.Get(plan.TaskID); ok {
				switch t.Status {
				case task.StatusPendingConsent:
					state = "order_authorized"
					waitingFor = "user_input"
				case task.StatusConsented, task.StatusClaimed:
					state = "input_transfer"
					owner = "provider_docker"
					waitingFor = "provider_response"
				case task.StatusRunning:
					state = "provider_execution"
					owner = "provider_docker"
					waitingFor = "local_supervisor"
				case task.StatusCompleted:
					state = "buyer_verification"
					waitingFor = "user_input"
				case task.StatusFailed:
					state = "settlement_or_dispute"
					waitingFor = "user_input"
					terminalReason = "provider_task_failed"
				}
			}
		}
		if strings.TrimSpace(plan.ProviderJobID) != "" && state != "buyer_verification" && state != "settlement_or_dispute" {
			state = "provider_execution"
			owner = "provider_docker"
			waitingFor = "local_supervisor"
		}
	case orderplan.StatusExpired:
		state = "closed"
		owner = "cloud"
		waitingFor = "none"
		terminalReason = "expired"
	case orderplan.StatusInvalidated:
		state = "closed"
		owner = "cloud"
		waitingFor = "none"
		terminalReason = firstNonEmpty(plan.InvalidationCause, "invalidated")
	}
	return map[string]any{
		"planId":         plan.ID,
		"orderId":        plan.ID,
		"taskId":         plan.TaskID,
		"state":          state,
		"owner":          owner,
		"waitingFor":     waitingFor,
		"terminalReason": terminalReason,
		"updatedAt":      plan.UpdatedAt,
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstPositiveUint64(values ...uint64) uint64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func firstNonZeroUint8(values ...uint8) uint8 {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

func decodeMapValue(value any, out any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("invalid payment evidence: %w", err)
	}
	return nil
}

func selectedProvider(plan orderplan.Plan) string {
	for _, option := range plan.Options {
		if option.OptionID == plan.SelectedOptionID {
			return option.ProviderPubkey
		}
	}
	return ""
}
