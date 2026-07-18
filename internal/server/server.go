package server

import (
	"net"
	"net/http"
	"strings"

	"github.com/exora-dock/exora-dock/api"
	"github.com/exora-dock/exora-dock/internal/discovery"
	"github.com/exora-dock/exora-dock/internal/endpoint"
	"github.com/exora-dock/exora-dock/internal/localauth"
	"github.com/exora-dock/exora-dock/internal/sellerdraft"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

type Options struct {
	Auth           *localauth.Store
	AllowedOrigins []string
	Discovery      *discovery.Manifest
	CloudURL       string
	CloudTokenPath string
	Endpoints      *endpoint.Store
	EndpointTunnel *endpoint.TunnelClient
	SellerDrafts   *sellerdraft.Service
}

func New(opts Options) http.Handler {
	h := api.NewHandler(api.Options{Discovery: opts.Discovery, CloudURL: opts.CloudURL, CloudTokenPath: opts.CloudTokenPath, Endpoints: opts.Endpoints, EndpointTunnel: opts.EndpointTunnel, SellerDrafts: opts.SellerDrafts, LocalAuth: opts.Auth})
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{AllowedOrigins: allowedOrigins(opts.AllowedOrigins), AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}, AllowedHeaders: []string{"Content-Type", "Authorization"}, AllowCredentials: false, MaxAge: 300}))
	r.Use(authMiddleware(opts.Auth))
	r.Get("/health", h.Health)
	r.Get("/.well-known/exora-dock.json", h.DiscoveryManifest)
	r.Route("/v3", func(r chi.Router) {
		r.Post("/local/agent-sessions", h.V3CreateAgentSession)
		r.Get("/local/agent-sessions", h.V3AgentSessions)
		r.Get("/local/agent-session-policy", h.V3AgentSessionPolicy)
		r.Put("/local/agent-session-policy", h.V3AgentSessionPolicy)
		r.Delete("/local/agent-sessions/{id}", h.V3RevokeAgentSession)
		r.Post("/local/agent-sessions/{id}/heartbeat", h.V3AgentSessionHeartbeat)
		r.Put("/local/account-key", h.V3SetAccountKey)
		r.Get("/local/account-key", h.V3AccountKeyStatus)
		r.Delete("/local/account-key", h.V3LockLocalAccount)
		r.Get("/local/seller-automation/policy", h.V3SellerAutomationPolicy)
		r.Put("/local/seller-automation/policy", h.V3SaveSellerAutomationPolicy)
		r.Get("/local/seller-automation/credentials", h.V3SellerCredentials)
		r.Post("/local/seller-automation/credentials", h.V3SaveSellerCredential)
		r.Delete("/local/seller-automation/credentials/{id}", h.V3DeleteSellerCredential)
		r.Get("/provider-agent/capabilities", h.V3SellerDraftCapabilities)
		r.Post("/provider-agent/candidates/discover", h.V3DiscoverSellerCandidates)
		r.Post("/provider-agent/materials/read", h.V3ReadSellerMaterial)
		r.Get("/provider-agent/draft-runs", h.V3ListSellerDraftRuns)
		r.Post("/provider-agent/draft-runs", h.V3CreateSellerDraftRun)
		r.Get("/provider-agent/draft-runs/{id}", h.V3GetSellerDraftRun)
		r.Post("/provider-agent/draft-runs/{id}/resume", h.V3ResumeSellerDraftRun)
		r.Post("/provider-agent/draft-runs/{id}/cancel", h.V3CancelSellerDraftRun)
		r.Get("/local/endpoints", h.V3LocalEndpoints)
		r.Put("/local/endpoints/{id}", h.V3SaveLocalEndpoint)
		r.Post("/local/endpoints/probe", h.V3ProbeLocalEndpoint)
		r.Post("/local/endpoints/test-route", h.V3TestLocalEndpointRoute)
		r.HandleFunc("/gateway/{listingId}/*", h.V3Gateway)
		r.Get("/catalog/products", h.V3Catalog)
		r.Get("/catalog/products/{id}", h.V3CatalogProduct)
		r.Get("/catalog/listings", h.V3ConsumerProxy)
		r.Get("/catalog/listings/{id}", h.V3ConsumerProxy)
		r.Post("/purchase-estimates", h.V3ConsumerProxy)
		r.Post("/invocations", h.V3ConsumerProxy)
		r.Get("/api-orders", h.V3ConsumerProxy)
		r.Get("/api-orders/{id}", h.V3ConsumerProxy)
		r.Post("/api-orders/{id}/deactivate", h.V3ConsumerProxy)
		r.Post("/api-orders/{id}/reactivation-requests", h.V3ConsumerProxy)
		r.Post("/download-grants", h.V3ConsumerProxy)
		r.Post("/download-grants/{id}/transfers", h.V3ConsumerProxy)
		r.Post("/compute-purchases", h.V3ConsumerProxy)
		r.Get("/compute-purchases/{id}", h.V3ConsumerProxy)
		r.Post("/compute-purchases/{id}/extend", h.V3ConsumerProxy)
		r.Post("/compute-purchases/{id}/extension-estimates", h.V3ConsumerProxy)
		r.Get("/leases/{id}", h.V3ConsumerProxy)
		r.Post("/leases/{id}/release", h.V3ConsumerProxy)
		r.Post("/leases/{id}/terminal-sessions", h.V3ConsumerProxy)
		r.Delete("/terminal-sessions/{id}", h.V3ConsumerProxy)
		r.Post("/leases/{id}/commands", h.V3ConsumerProxy)
		r.Get("/compute-commands/{id}", h.V3ConsumerProxy)
		r.Post("/local/compute-transfers", h.V3StartLocalComputeTransfer)
		r.Get("/local/compute-transfers/{id}", h.V3LocalComputeTransfer)
		r.Get("/local/device-identity", h.V3LocalDeviceIdentity)
		r.Get("/account/balance", h.V3ConsumerProxy)
		r.Get("/account/spend-policy", h.V3ConsumerProxy)
		r.Get("/ledger", h.V3ConsumerProxy)
		r.Get("/activity-sessions", h.V3ActivitySessions)
		r.Get("/activity-sessions/{id}", h.V3ActivitySession)
		r.Get("/catalog/environment-images", h.V3EnvironmentImageCatalog)
		r.Get("/catalog/environment-images/{id}", h.V3EnvironmentImageCatalogItem)
		r.HandleFunc("/provider/worker/{command}", h.V3WorkerCommand)
		r.HandleFunc("/provider/*", h.V3ProviderProxy)
	})
	return r
}

func allowedOrigins(configured []string) []string {
	if len(configured) > 0 {
		return configured
	}
	return []string{"http://localhost:*", "http://127.0.0.1:*", "tauri://localhost", "https://exoradock.com", "https://www.exoradock.com"}
}

func authMiddleware(store *localauth.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			required := requiredScope(r)
			if required == localauth.ScopeNone || store == nil {
				next.ServeHTTP(w, r)
				return
			}
			token := bearerToken(r)
			scope := store.ScopeForToken(token)
			if scope == localauth.ScopeNone {
				http.Error(w, `{"error":"authorization token required"}`, http.StatusUnauthorized)
				return
			}
			if scope == localauth.ScopeAgent {
				if !loopbackRequest(r) {
					http.Error(w, `{"error":"Agent session keys are accepted only from this computer"}`, http.StatusForbidden)
					return
				}
				requiredPermission := requiredAgentPermission(r)
				if requiredPermission == "owner" || !store.SessionPermits(token, requiredPermission) {
					http.Error(w, `{"error":"Agent session does not permit this route"}`, http.StatusForbidden)
					return
				}
				next.ServeHTTP(w, r)
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

func loopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil {
		host = strings.Trim(strings.TrimSpace(r.RemoteAddr), "[]")
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func requiredAgentPermission(r *http.Request) string {
	path := r.URL.Path
	if strings.HasSuffix(path, "/heartbeat") {
		return "account.read"
	}
	if strings.HasPrefix(path, "/v3/provider-agent/") {
		return "seller.draft"
	}
	if strings.HasPrefix(path, "/v3/catalog/") || path == "/v3/purchase-estimates" {
		return "market.read"
	}
	if strings.HasPrefix(path, "/v3/compute-purchases") || strings.HasPrefix(path, "/v3/leases/") || strings.HasPrefix(path, "/v3/local/compute-transfers") || strings.HasPrefix(path, "/v3/compute-commands/") || strings.HasPrefix(path, "/v3/terminal-sessions/") {
		return "compute.use"
	}
	if strings.HasPrefix(path, "/v3/download-grants") {
		return "resources.use"
	}
	if path == "/v3/invocations" || strings.HasPrefix(path, "/v3/gateway/") || strings.HasPrefix(path, "/v3/api-orders") {
		return "api.invoke"
	}
	if strings.HasPrefix(path, "/v3/account/") || path == "/v3/ledger" || strings.HasPrefix(path, "/v3/activity-sessions") {
		return "account.read"
	}
	return "owner"
}
func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
}
func requiredScope(r *http.Request) localauth.Scope {
	path := r.URL.Path
	if path == "/health" || path == "/.well-known/exora-dock.json" {
		return localauth.ScopeNone
	}
	if strings.HasPrefix(path, "/v3/provider-agent/") {
		return localauth.ScopeProviderAgent
	}
	for _, prefix := range []string{"/v3/catalog/", "/v3/purchase-estimates", "/v3/invocations", "/v3/api-orders", "/v3/download-grants", "/v3/compute-purchases", "/v3/leases/", "/v3/local/compute-transfers", "/v3/compute-commands/", "/v3/terminal-sessions/", "/v3/account/", "/v3/ledger", "/v3/activity-sessions", "/v3/gateway/"} {
		if path == strings.TrimSuffix(prefix, "/") || strings.HasPrefix(path, prefix) {
			return localauth.ScopeAgent
		}
	}
	return localauth.ScopeOwner
}
