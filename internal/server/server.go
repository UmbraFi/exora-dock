package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/exora-dock/exora-dock/api"
	"github.com/exora-dock/exora-dock/internal/agent"
	"github.com/exora-dock/exora-dock/internal/agentcard"
	"github.com/exora-dock/exora-dock/internal/agentdriver"
	"github.com/exora-dock/exora-dock/internal/agentsession"
	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/delegation"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/discovery"
	"github.com/exora-dock/exora-dock/internal/ipfs"
	"github.com/exora-dock/exora-dock/internal/lease"
	"github.com/exora-dock/exora-dock/internal/localauth"
	"github.com/exora-dock/exora-dock/internal/negotiation"
	orderpkg "github.com/exora-dock/exora-dock/internal/order"
	"github.com/exora-dock/exora-dock/internal/orderplan"
	"github.com/exora-dock/exora-dock/internal/payment"
	"github.com/exora-dock/exora-dock/internal/paymentpin"
	"github.com/exora-dock/exora-dock/internal/product"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/exora-dock/exora-dock/internal/runcapability"
	"github.com/exora-dock/exora-dock/internal/supervisor"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/exora-dock/exora-dock/internal/wallet"
	"github.com/exora-dock/exora-dock/internal/workrun"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
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
	EscrowProgramID string
	SolanaNetwork   string
	USDCMint        string
	USDCDecimals    uint8
	CloudURL        string
	CloudTokenPath  string
	DockID          string
	ConfigPath      string
	Auth            *localauth.Store
	AllowedOrigins  []string
	LegacyMarket    bool
}

func New(c *cache.Cache, cs *chat.Store, relay *chat.Relay, hub *chat.Hub, ring *dht.Ring, ic *ipfs.Client, ps *ipfs.PinStore, ra *agent.ReviewAgent, products *product.Store, orders *orderpkg.Store, resources *resource.Store, delegations *delegation.Store, leases *lease.Store, selfPubkey string, runtime ...RuntimeStores) http.Handler {
	var stores RuntimeStores
	if len(runtime) > 0 {
		stores = runtime[0]
	}
	h := api.NewHandler(c, cs, relay, hub, ring, ic, ps, ra, products, orders, resources, delegations, leases, selfPubkey, api.RuntimeStores{
		Wallet:          stores.Wallet,
		Tasks:           stores.Tasks,
		Approvals:       stores.Approvals,
		OrderPlans:      stores.OrderPlans,
		Negotiations:    stores.Negotiations,
		PaymentPIN:      stores.PaymentPIN,
		Payments:        stores.Payments,
		TaskExecutor:    stores.TaskExecutor,
		Discovery:       stores.Discovery,
		AgentCards:      stores.AgentCards,
		AutomationRuns:  stores.AutomationRuns,
		Supervisor:      stores.Supervisor,
		AgentSessions:   stores.AgentSessions,
		RunCapabilities: stores.RunCapabilities,
		CodexProbe:      stores.CodexProbe,
		CodexAgent:      stores.CodexAgent,
		CardDiagnostics: stores.CardDiagnostics,
		CardPublisher:   stores.CardPublisher,
		WorkRuns:        stores.WorkRuns,
		EscrowProgramID: stores.EscrowProgramID,
		SolanaNetwork:   stores.SolanaNetwork,
		USDCMint:        stores.USDCMint,
		USDCDecimals:    stores.USDCDecimals,
		CloudURL:        stores.CloudURL,
		CloudTokenPath:  stores.CloudTokenPath,
		DockID:          stores.DockID,
		ConfigPath:      stores.ConfigPath,
	})
	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins(stores.AllowedOrigins),
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: false,
		MaxAge:           300,
	}))
	r.Use(legacyMarketGate(stores.LegacyMarket, stores.AgentSessions))
	r.Use(authMiddleware(stores.Auth, stores.RunCapabilities))

	r.Get("/health", h.Health)
	r.Get("/.well-known/exora-dock.json", h.DiscoveryManifest)
	r.Get("/ws", h.WebSocket)

	r.Route("/v1", func(r chi.Router) {
		// Cache endpoints
		r.Get("/account/{address}", h.GetAccount)
		r.Get("/products", h.ListProducts)
		r.Post("/products", h.CreateProduct)
		r.Get("/product/{id}", h.GetProduct)
		r.Get("/tx/{signature}", h.GetTx)

		// Local wallet endpoints
		r.Get("/wallet", h.GetWallet)
		r.Post("/wallet/create", h.CreateWallet)
		r.Post("/wallet/restore", h.RestoreWallet)
		r.Post("/wallet/unlock", h.UnlockWallet)
		r.Post("/wallet/withdraw", h.WithdrawWallet)
		r.Delete("/wallet", h.ClearWallet)

		// MCP connection registry
		r.Post("/mcp/connections", h.RegisterMCPConnection)
		r.Get("/mcp/connections", h.ListMCPConnections)

		// Built-in requester agent endpoints
		r.Post("/agent/search-sellers", h.SearchSellers)
		r.Get("/market/rail-cards", h.MarketRailCards)
		r.Get("/console/snapshot", h.ConsoleSnapshot)
		r.Post("/agent/buyer-work", h.CoordinateBuyerWork)
		r.Post("/work-runs", h.CreateWorkRun)
		r.Get("/work-runs", h.ListWorkRuns)
		r.Get("/work-runs/{id}", h.GetWorkRun)
		r.Post("/work-runs/{id}/resume", h.ResumeWorkRun)
		r.Post("/work-runs/{id}/stop", h.StopWorkRun)
		r.Get("/work-runs/{id}/events", h.ListWorkRunEvents)
		r.Get("/dispute-evidence", h.GetDisputeEvidence)
		// V2 BYOA automation. These routes accept narrowly-scoped run
		// capabilities; owner routes continue to use the local owner token.
		r.Get("/local-agents", h.ListLocalAgents)
		r.Post("/local-agents/scan", h.ScanLocalAgents)
		r.Post("/automation-runs", h.CreateAutomationRun)
		r.Get("/automation-runs", h.ListAutomationRuns)
		r.Get("/automation-runs/{id}", h.GetAutomationRun)
		r.Post("/automation-runs/{id}/claim", h.ClaimAutomationRun)
		r.Post("/automation-runs/{id}/actions", h.RecordAutomationAction)
		r.Post("/automation-runs/{id}/cancel", h.CancelAutomationRun)
		r.Post("/local-agent-sessions", h.StartLocalAgentSession)
		r.Get("/local-agent-sessions/{id}", h.GetLocalAgentSession)
		r.Get("/local-agent-sessions/{id}/stream", h.StreamLocalAgentSession)
		r.Post("/local-agent-sessions/{id}/messages", h.SendLocalAgentMessage)
		r.Post("/local-agent-sessions/{id}/interrupt", h.InterruptLocalAgentSession)
		r.Post("/local-agent-sessions/{id}/stop", h.StopLocalAgentSession)
		r.Post("/local-agent-sessions/{id}/resume", h.ResumeLocalAgentSession)
		r.Post("/local-agent-sessions/{id}/human-requests/{requestId}/respond", h.RespondLocalAgentHumanRequest)
		r.Post("/local-agent-sessions/{id}/mcp-events", h.RecordLocalAgentMCPEvent)
		r.Get("/automation/transactions/{id}", h.GetAutomationTransaction)
		r.Get("/automation/transactions/{id}/allowed-actions", h.GetAutomationAllowedActions)
		r.Get("/automation/agent-cards/search", h.SearchAutomationAgentCards)

		// Narrow owner-only Cloud projections for the local Electron client.
		r.Get("/cloud/transactions", h.ListCloudTransactions)
		r.Post("/cloud/transactions", h.CreateCloudTransaction)
		r.Get("/cloud/inbox", h.GetCloudInbox)
		r.Get("/cloud/agent-cards", h.ListCloudAgentCards)
		r.Post("/cloud/human-requests/{id}/respond", h.RespondCloudHumanRequest)
		r.Post("/negotiations", h.CreateNegotiations)
		r.Get("/negotiations", h.ListNegotiations)
		r.Get("/negotiations/{id}", h.GetNegotiation)
		r.Post("/negotiations/{id}/resume", h.ResumeNegotiation)
		r.Post("/negotiations/{id}/cancel", h.CancelNegotiation)
		r.Post("/order-plans/from-negotiations", h.CreateOrderPlanFromNegotiations)
		r.Get("/agent-cards/mine", h.ListMyAgentCards)
		r.Get("/agent-cards/search", h.SearchCloudAgentCards)
		r.Post("/agent-cards/diagnostics", h.RunAgentCardDiagnostics)
		r.Post("/agent-cards/draft", h.DraftAgentCard)
		r.Put("/agent-cards/{role}", h.SaveAgentCard)
		r.Post("/agent-cards/{role}/publish", h.PublishAgentCard)
		r.Get("/settings/buyer-agent", h.GetBuyerAgentSettings)
		r.Put("/settings/buyer-agent", h.SaveBuyerAgentSettings)
		r.Get("/settings/seller-agent", h.GetSellerAgentSettings)
		r.Put("/settings/seller-agent", h.SaveSellerAgentSettings)

		// Remote job task endpoints
		r.Post("/tasks", h.CreateTask)
		r.Get("/tasks", h.ListTasks)
		r.Get("/tasks/{id}", h.GetTask)
		r.Post("/tasks/{id}/quote", h.QuoteTask)
		r.Post("/tasks/{id}/consent", h.ConsentTask)
		r.Get("/tasks/{id}/artifacts", h.GetTaskArtifactManifest)
		r.Get("/tasks/{id}/artifacts/{name}", h.GetTaskArtifact)
		r.Get("/provider/tasks/next", h.NextProviderTask)
		r.Post("/provider/tasks/{id}/claim", h.ClaimTask)
		r.Post("/provider/tasks/{id}/run", h.RunTask)
		r.Post("/provider/tasks/{id}/complete", h.CompleteTask)
		r.Post("/provider/tasks/{id}/fail", h.FailTask)
		r.Post("/provider/quote-requests", h.CreateProviderQuoteRequest)
		r.Post("/provider/negotiations", h.CreateProviderNegotiation)
		r.Get("/provider/negotiations/{id}", h.GetProviderNegotiation)
		r.Post("/provider/jobs", h.CreateProviderJob)
		r.Get("/provider/jobs/{id}", h.GetProviderJob)
		r.Get("/provider/jobs/{id}/artifacts", h.GetProviderJobArtifactManifest)
		r.Get("/provider/jobs/{id}/artifacts/{name}", h.GetProviderJobArtifact)

		// Agent capability resource endpoints
		r.Get("/resources", h.ListResources)
		r.Post("/resources", h.CreateResource)
		r.Get("/resources/{id}", h.GetResource)
		r.Post("/delegations", h.CreateDelegation)
		r.Get("/delegations", h.ListDelegations)
		r.Post("/leases", h.CreateLease)
		r.Get("/leases", h.ListLeases)
		r.Get("/leases/{id}", h.GetLease)
		r.Post("/leases/{id}/revoke", h.RevokeLease)
		r.Get("/leases/{id}/credentials", h.GetLeaseCredentials)

		// Human approval queue endpoints
		r.Post("/approvals", h.CreateApproval)
		r.Get("/approvals", h.ListApprovals)
		r.Get("/approvals/{id}", h.GetApproval)
		r.Post("/approvals/{id}/decide", h.DecideApproval)

		// Seller choice / order-plan endpoints
		r.Get("/order-plans", h.ListOrderPlans)
		r.Get("/order-plans/{id}", h.GetOrderPlan)
		r.Post("/order-plans/{id}/select", h.SelectOrderPlan)
		r.Post("/order-plans/{id}/submit-provider-job", h.SubmitOrderPlanProviderJob)
		r.Post("/order-plans/{id}/cancel", h.CancelOrderPlan)

		// Local payment confirmation endpoints
		r.Get("/payment-pin/status", h.PaymentPINStatus)
		r.Post("/payment-pin/set", h.SetPaymentPIN)
		r.Get("/payments", h.ListPayments)
		r.Get("/payments/{id}", h.GetPayment)
		r.Get("/payments/{id}/evidence", h.FindPaymentEvidence)
		r.Post("/payments/{id}/pay-wallet", h.PayWithWallet)
		r.Post("/payments/{id}/chain/intent", h.PreparePaymentChainIntent)
		r.Post("/payments/{id}/chain/evidence", h.SyncPaymentEvidence)

		// Order endpoints
		r.Post("/orders", h.CreateOrders)
		r.Get("/orders", h.ListOrders)
		r.Get("/orders/{id}", h.GetOrder)
		r.Post("/orders/{id}/simulate-payment", h.SimulateOrderPayment)
		r.Post("/orders/{id}/status", h.UpdateOrderStatus)

		// Chat endpoints
		r.Post("/chat/send", h.SendMessage)
		r.Post("/chat/receive", h.ReceiveMessage)
		r.Get("/chat/messages/{orderID}", h.GetMessages)
		r.Get("/chat/unread/{pubkey}", h.GetUnread)
		r.Get("/chat/export/{orderID}", h.ExportChat)
		r.Get("/chat/lookup/{orderID}", h.LookupMiners)

		// IPFS endpoints
		r.Post("/ipfs/upload", h.IPFSUpload)
		r.Get("/ipfs/{cid}", h.IPFSGet)
		r.Delete("/ipfs/{productID}", h.IPFSUnpin)

		// Review endpoints
		r.Post("/review/submit", h.SubmitReview)
		r.Post("/review/vote", h.Vote)
		r.Get("/review/{productID}", h.GetReview)
	})

	return r
}

func legacyMarketGate(enabled bool, sessions *agentsession.Manager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !enabled && isLegacyMarketPath(r.URL.Path) {
				sessionID := strings.TrimSpace(r.Header.Get("X-Exora-Agent-Session"))
				session, active := agentsession.Session{}, false
				if sessions != nil && sessionID != "" {
					session, active = sessions.Get(sessionID)
					active = active && session.Status != agentsession.StatusStopped && session.Status != agentsession.StatusFailed
				}
				if !active || (r.URL.Path == "/v1/agent/buyer-work" && session.Role != "buyer") {
					http.NotFound(w, r)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func isLegacyMarketPath(path string) bool {
	if path == "/ws" || path == "/v1/products" || path == "/v1/agent/search-sellers" || path == "/v1/agent/buyer-work" || path == "/v1/market/rail-cards" {
		return true
	}
	for _, prefix := range []string{
		"/v1/account", "/v1/product", "/v1/tx", "/v1/work-runs", "/v1/negotiations",
		"/v1/order-plans", "/v1/resources", "/v1/delegations", "/v1/leases", "/v1/orders",
		"/v1/chat", "/v1/review", "/v1/provider/negotiations",
	} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

func allowedOrigins(configured []string) []string {
	if len(configured) > 0 {
		return configured
	}
	return []string{
		"http://localhost:*",
		"http://127.0.0.1:*",
		"tauri://localhost",
		"https://exora-dock.github.io",
	}
}

func authMiddleware(store *localauth.Store, capabilities ...*runcapability.Manager) func(http.Handler) http.Handler {
	var runCapabilities *runcapability.Manager
	if len(capabilities) > 0 {
		runCapabilities = capabilities[0]
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			required := requiredScope(r)
			if required == localauth.ScopeNone || store == nil {
				next.ServeHTTP(w, r)
				return
			}
			scope := store.ScopeForToken(bearerToken(r))
			if scope == localauth.ScopeNone {
				if runCapabilities != nil && runCapabilityPath(r.URL.Path) {
					if _, err := runCapabilities.Verify(bearerToken(r), runcapability.Requirement{}); err == nil {
						next.ServeHTTP(w, r)
						return
					}
				}
				http.Error(w, `{"error":"authorization token required"}`, http.StatusUnauthorized)
				return
			}
			if scope < required {
				http.Error(w, `{"error":"owner authorization required"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func runCapabilityPath(path string) bool {
	return strings.HasPrefix(path, "/v1/automation-runs/") ||
		strings.HasPrefix(path, "/v1/automation/transactions/") ||
		path == "/v1/automation/agent-cards/search"
}

func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if header == "" {
		return ""
	}
	const prefix = "Bearer "
	if len(header) < len(prefix) || header[:len(prefix)] != prefix {
		return ""
	}
	return header[len(prefix):]
}

func requiredScope(r *http.Request) localauth.Scope {
	path := r.URL.Path
	method := r.Method
	if path == "/health" || path == "/.well-known/exora-dock.json" || path == "/ws" {
		return localauth.ScopeNone
	}
	if path == "/v1/agent/search-sellers" && method == http.MethodPost {
		return localauth.ScopeAgent
	}
	if path == "/v1/market/rail-cards" && method == http.MethodGet {
		return localauth.ScopeAgent
	}
	if path == "/v1/agent/buyer-work" && method == http.MethodPost {
		return localauth.ScopeAgent
	}
	if path == "/v1/work-runs" && (method == http.MethodGet || method == http.MethodPost) {
		return localauth.ScopeAgent
	}
	if strings.HasPrefix(path, "/v1/work-runs/") {
		if method == http.MethodGet || strings.HasSuffix(path, "/resume") || strings.HasSuffix(path, "/stop") {
			return localauth.ScopeAgent
		}
	}
	if path == "/v1/mcp/connections" && (method == http.MethodGet || method == http.MethodPost) {
		return localauth.ScopeAgent
	}
	if strings.HasPrefix(path, "/v1/local-agent-sessions/") && strings.HasSuffix(path, "/mcp-events") && method == http.MethodPost {
		return localauth.ScopeAgent
	}
	if path == "/v1/negotiations" && (method == http.MethodGet || method == http.MethodPost) {
		return localauth.ScopeAgent
	}
	if strings.HasPrefix(path, "/v1/negotiations/") {
		if strings.HasSuffix(path, "/cancel") {
			return localauth.ScopeOwner
		}
		if method == http.MethodGet || strings.HasSuffix(path, "/resume") {
			return localauth.ScopeAgent
		}
	}
	if path == "/v1/order-plans/from-negotiations" && method == http.MethodPost {
		return localauth.ScopeAgent
	}
	if path == "/v1/agent-cards/mine" && method == http.MethodGet {
		return localauth.ScopeAgent
	}
	if path == "/v1/agent-cards/search" && method == http.MethodGet {
		return localauth.ScopeAgent
	}
	if path == "/v1/resources" && method == http.MethodGet {
		return localauth.ScopeAgent
	}
	if strings.HasPrefix(path, "/v1/resources/") && method == http.MethodGet {
		return localauth.ScopeAgent
	}
	if path == "/v1/tasks" && (method == http.MethodGet || method == http.MethodPost) {
		return localauth.ScopeAgent
	}
	if providerProtocolAllowed(method, path) {
		return localauth.ScopeNone
	}
	if strings.HasPrefix(path, "/v1/tasks/") && method == http.MethodGet {
		parts := strings.Split(strings.Trim(path, "/"), "/")
		if len(parts) == 3 {
			return localauth.ScopeAgent
		}
		if len(parts) == 4 && parts[3] == "artifacts" {
			return localauth.ScopeAgent
		}
		return localauth.ScopeOwner
	}
	if path == "/v1/approvals" && (method == http.MethodGet || method == http.MethodPost) {
		return localauth.ScopeAgent
	}
	if strings.HasPrefix(path, "/v1/approvals/") {
		if strings.HasSuffix(path, "/decide") {
			return localauth.ScopeOwner
		}
		if method == http.MethodGet {
			return localauth.ScopeAgent
		}
	}
	if path == "/v1/order-plans" && method == http.MethodGet {
		return localauth.ScopeAgent
	}
	if strings.HasPrefix(path, "/v1/order-plans/") {
		if strings.HasSuffix(path, "/select") || strings.HasSuffix(path, "/submit-provider-job") || strings.HasSuffix(path, "/cancel") {
			return localauth.ScopeOwner
		}
		if method == http.MethodGet {
			return localauth.ScopeAgent
		}
	}
	if strings.HasPrefix(path, "/v1/payments/") {
		parts := strings.Split(strings.Trim(path, "/"), "/")
		if len(parts) == 4 && parts[3] == "evidence" && method == http.MethodGet {
			return localauth.ScopeAgent
		}
		if len(parts) == 5 && parts[3] == "chain" && (parts[4] == "intent" || parts[4] == "evidence") && method == http.MethodPost {
			return localauth.ScopeAgent
		}
	}
	if strings.HasPrefix(path, "/v1/payment-pin") || strings.HasPrefix(path, "/v1/payments") {
		return localauth.ScopeOwner
	}
	return localauth.ScopeOwner
}

func providerProtocolAllowed(method string, path string) bool {
	if path == "/v1/provider/quote-requests" {
		return method == http.MethodPost
	}
	if path == "/v1/provider/negotiations" {
		return method == http.MethodPost
	}
	if strings.HasPrefix(path, "/v1/provider/negotiations/") {
		parts := strings.Split(strings.Trim(path, "/"), "/")
		return len(parts) == 4 && method == http.MethodGet
	}
	if path == "/v1/provider/jobs" {
		return method == http.MethodPost
	}
	if !strings.HasPrefix(path, "/v1/provider/jobs/") {
		return false
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 4 {
		return method == http.MethodGet
	}
	if len(parts) == 5 && parts[4] == "artifacts" {
		return method == http.MethodGet
	}
	if len(parts) == 6 && parts[4] == "artifacts" {
		return method == http.MethodGet
	}
	return false
}
