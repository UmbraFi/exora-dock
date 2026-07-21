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
	Auth                *localauth.Store
	AllowedOrigins      []string
	Discovery           *discovery.Manifest
	CloudURL            string
	CloudTokenPath      string
	ActiveAccountID     string
	EnforceAccountScope bool
	Endpoints           *endpoint.Store
	EndpointTunnel      *endpoint.TunnelClient
	SellerDrafts        *sellerdraft.Service
}

func New(opts Options) http.Handler {
	h := api.NewHandler(api.Options{Discovery: opts.Discovery, CloudURL: opts.CloudURL, CloudTokenPath: opts.CloudTokenPath, ActiveAccountID: opts.ActiveAccountID, EnforceAccountScope: opts.EnforceAccountScope, Endpoints: opts.Endpoints, EndpointTunnel: opts.EndpointTunnel, SellerDrafts: opts.SellerDrafts, LocalAuth: opts.Auth})
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{AllowedOrigins: allowedOrigins(opts.AllowedOrigins), AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}, AllowedHeaders: []string{"Content-Type", "Authorization"}, AllowCredentials: false, MaxAge: 300}))
	r.Use(authMiddleware(opts.Auth))
	r.Get("/health", h.Health)
	r.Get("/.well-known/exora-dock.json", h.DiscoveryManifest)
	r.Route("/v4", func(r chi.Router) {
		r.Post("/local/agent-sessions", h.V3CreateAgentSession)
		r.Get("/local/agent-sessions", h.V3AgentSessions)
		r.Get("/local/agent-session-policy", h.V3AgentSessionPolicy)
		r.Put("/local/agent-session-policy", h.V3AgentSessionPolicy)
		r.Delete("/local/agent-sessions/{id}", h.V3RevokeAgentSession)
		r.Post("/local/agent-sessions/{id}/heartbeat", h.V3AgentSessionHeartbeat)
		r.Put("/local/account-key", h.V3SetAccountKey)
		r.Get("/local/account-key", h.V3AccountKeyStatus)
		r.Delete("/local/account-key", h.V3LockLocalAccount)
		r.Get("/local/provider-integration/policy", h.V3SellerAutomationPolicy)
		r.Put("/local/provider-integration/policy", h.V3SaveSellerAutomationPolicy)
		r.Get("/local/provider-integration/credentials", h.V3SellerCredentials)
		r.Post("/local/provider-integration/credentials", h.V3SaveSellerCredential)
		r.Delete("/local/provider-integration/credentials/{id}", h.V3DeleteSellerCredential)
		r.Post("/local/provider/offline-for-logout", h.V4OfflineProviderAPIsForLogout)
		r.Get("/api-drafts", h.V4ListAPIDrafts)
		r.Post("/api-drafts", h.V4SubmitAPICapability)
		r.Get("/api-drafts/{apiId}", h.V4GetAPIDraft)
		r.Get("/api-drafts/{apiId}/validation", h.V4GetAPIValidation)
		// Review, qualification, runtime and publication remain owner-only human gates.
		r.Post("/local/api-drafts", h.V4CreateLocalAPIDraft)
		r.Put("/local/api-drafts/{apiId}/identity", h.V4UpdateAPIDraftIdentity)
		r.Put("/local/api-drafts/{apiId}", h.V4UpdateAPICapability)
		r.Put("/local/api-drafts/{apiId}/contract", h.V4SubmitAPIContract)
		r.Delete("/local/api-drafts/{apiId}/contract", h.V4ClearAPIContract)
		r.Delete("/local/api-drafts/{apiId}", h.V4DeleteAPIDraft)
		r.Put("/local/api-drafts/{apiId}/operations/{operationId}", h.V4UpdateAPIOperation)
		r.Get("/local/api-drafts/{apiId}/operations/{operationId}/validation-plan", h.V4GetOperationValidationPlan)
		r.Post("/local/api-drafts/{apiId}/operations/{operationId}/validation-runs", h.V4StartOperationValidationRun)
		r.Get("/local/api-drafts/{apiId}/operations/{operationId}/validation-runs/{runId}", h.V4GetOperationValidationRun)
		r.Delete("/local/api-drafts/{apiId}/operations/{operationId}/validation-runs/{runId}", h.V4CancelOperationValidationRun)
		r.Get("/local/api-drafts/{apiId}/operations/{operationId}/validation-runs/{runId}/events", h.V4OperationValidationRunEvents)
		r.Post("/local/api-drafts/{apiId}/operations/{operationId}/lock-integration", h.V4LockOperationIntegration)
		r.Post("/local/api-drafts/{apiId}/operations/{operationId}/unlock-integration", h.V4UnlockOperationIntegration)
		r.Post("/local/api-drafts/{apiId}/operations/{operationId}/billing-runs", h.V4RunOperationBillingTest)
		r.Post("/local/api-drafts/{apiId}/operations/{operationId}/contract-validation", h.V4RunOperationContractValidation)
		r.Post("/local/api-drafts/{apiId}/operations/{operationId}/confirm-contract", h.V4ConfirmOperationContract)
		r.Get("/local/api-drafts/{apiId}/operations/{operationId}/billing-runs/{runId}", h.V4GetOperationBillingRun)
		r.Post("/local/api-drafts/{apiId}/operations/{operationId}/lock-pricing", h.V4LockOperationPricing)
		r.Post("/local/api-drafts/{apiId}/operations/{operationId}/unlock-pricing", h.V4UnlockOperationPricing)
		r.Post("/local/api-drafts/{apiId}/operations/{operationId}/lifecycle", h.V4UpdateOperationLifecycle)
		r.Put("/local/api-drafts/{apiId}/operations/{operationId}/operational-settings", h.V4UpdateOperationSettings)
		r.Get("/local/api-drafts/{apiId}/operations/{operationId}/events", h.V4OperationConsoleEvents)
		r.Post("/local/api-drafts/{apiId}/publish", h.V4PublishAPIDraft)
		r.Get("/catalog/operations", h.V3ConsumerProxy)
		r.Get("/catalog/apis/{apiId}", h.V3ConsumerProxy)
		r.Post("/operation-estimates", h.V3ConsumerProxy)
		r.Post("/apis/{apiId}/operations/{operationId}/invocations", h.V3ConsumerProxy)
		r.Get("/invocations/{id}", h.V3ConsumerProxy)
		r.Get("/jobs/{id}", h.V3ConsumerProxy)
		r.Get("/jobs/{id}/events", h.V3ConsumerProxy)
		r.Post("/jobs/{id}/cancel", h.V3ConsumerProxy)
		r.Post("/artifact-uploads", h.V3ConsumerProxy)
		r.Post("/artifact-uploads/{id}/complete", h.V3ConsumerProxy)
		r.Post("/artifacts/{id}/download-grants", h.V3ConsumerProxy)
		r.Get("/api-orders", h.V3ConsumerProxy)
		r.Get("/api-orders/{id}", h.V3ConsumerProxy)
		r.Get("/api-orders/{id}/invocations", h.V3ConsumerProxy)
		r.Post("/api-orders/{id}/deactivate", h.V3ConsumerProxy)
		r.Post("/api-orders/{id}/reactivation-requests", h.V3ConsumerProxy)
		r.Put("/api-orders/{id}/review", h.V3ConsumerProxy)
		r.Post("/reviews/{id}/reply", h.V3ConsumerProxy)
		r.Post("/reviews/{id}/reports", h.V3ConsumerProxy)
		r.Get("/sellers/{id}/reputation", h.V3ConsumerProxy)
		r.Get("/disputes", h.V3ConsumerProxy)
		r.Get("/disputes/{id}", h.V3ConsumerProxy)
		r.Get("/account/balance", h.V3ConsumerProxy)
		r.Get("/account/spend-policy", h.V3ConsumerProxy)
		r.Get("/ledger", h.V3ConsumerProxy)
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
	if strings.HasPrefix(path, "/v4/api-drafts") {
		return "provider.integrate"
	}
	if providerIntegrationMutation(r) {
		return "provider.integrate"
	}
	if strings.HasPrefix(path, "/v4/api-orders") && r.Method == http.MethodGet {
		return "account.read"
	}
	if strings.HasPrefix(path, "/v4/catalog/") || path == "/v4/operation-estimates" {
		return "market.read"
	}
	if strings.HasPrefix(path, "/v4/apis/") || strings.HasPrefix(path, "/v4/invocations/") || strings.HasPrefix(path, "/v4/api-orders") || strings.HasPrefix(path, "/v4/jobs/") || strings.HasPrefix(path, "/v4/artifact") || strings.HasPrefix(path, "/v4/reviews/") || strings.HasPrefix(path, "/v4/disputes") {
		return "api.invoke"
	}
	if strings.HasPrefix(path, "/v4/account/") || path == "/v4/ledger" || strings.HasPrefix(path, "/v4/sellers/") {
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
	if strings.HasPrefix(path, "/v4/api-drafts") {
		return localauth.ScopeIntegrationAgent
	}
	if providerIntegrationMutation(r) {
		return localauth.ScopeIntegrationAgent
	}
	for _, prefix := range []string{"/v4/catalog/", "/v4/operation-estimates", "/v4/apis/", "/v4/invocations/", "/v4/api-orders", "/v4/jobs/", "/v4/artifact", "/v4/reviews/", "/v4/disputes", "/v4/sellers/", "/v4/account/", "/v4/ledger"} {
		if path == strings.TrimSuffix(prefix, "/") || strings.HasPrefix(path, prefix) {
			return localauth.ScopeAgent
		}
	}
	return localauth.ScopeOwner
}

func providerIntegrationMutation(r *http.Request) bool {
	path := r.URL.Path
	if r.Method == http.MethodPost && path == "/v4/local/api-drafts" {
		return true
	}
	return r.Method == http.MethodPut && strings.HasPrefix(path, "/v4/local/api-drafts/") && strings.HasSuffix(path, "/contract")
}
