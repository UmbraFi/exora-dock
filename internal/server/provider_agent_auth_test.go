package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/discovery"
	"github.com/exora-dock/exora-dock/internal/localauth"
	"github.com/exora-dock/exora-dock/internal/sellerdraft"
)

func TestProviderAgentTokenHasExactSellerDraftRouteWhitelist(t *testing.T) {
	directory := t.TempDir()
	c, err := cache.New(64, filepath.Join(directory, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	auth, err := localauth.LoadOrCreate(filepath.Join(directory, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	service := sellerdraft.NewService(sellerdraft.ServiceOptions{
		Store: sellerdraft.NewStore(c), Vault: sellerdraft.NewCredentialVault(directory), DataDir: directory,
	})
	manifest := discovery.Build("127.0.0.1:8080", "dock")
	router := New(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "dock", RuntimeStores{Auth: auth, SellerDrafts: service, Discovery: &manifest})

	tests := []struct {
		name   string
		method string
		path   string
		token  string
		want   int
	}{
		{"provider capability", http.MethodGet, "/v3/provider-agent/capabilities", auth.ProviderAgentToken(), http.StatusOK},
		{"owner can inspect provider capability", http.MethodGet, "/v3/provider-agent/capabilities", auth.OwnerToken(), http.StatusOK},
		{"buyer agent rejected", http.MethodGet, "/v3/provider-agent/capabilities", auth.AgentToken(), http.StatusForbidden},
		{"provider cannot read buyer routes", http.MethodGet, "/v1/mcp/connections", auth.ProviderAgentToken(), http.StatusForbidden},
		{"provider cannot read settings", http.MethodGet, "/v3/local/seller-automation/policy", auth.ProviderAgentToken(), http.StatusForbidden},
		{"provider cannot proxy provider API", http.MethodGet, "/v3/provider/listings", auth.ProviderAgentToken(), http.StatusForbidden},
		{"provider cannot publish", http.MethodPost, "/v3/provider/listings/lst_test/publish", auth.ProviderAgentToken(), http.StatusForbidden},
		{"wrong token rejected", http.MethodGet, "/v3/provider-agent/capabilities", "invalid", http.StatusUnauthorized},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := authReq(test.method, test.path, `{}`, test.token)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status=%d want=%d body=%s", response.Code, test.want, response.Body.String())
			}
		})
	}

	before := httptest.NewRecorder()
	router.ServeHTTP(before, authReq(http.MethodGet, "/.well-known/exora-dock.json", "", ""))
	if strings.Contains(before.Body.String(), "provider.listing_drafts.mcp.v1") {
		t.Fatal("disabled seller automation leaked into discovery manifest")
	}
	if _, err := service.SavePolicy(sellerdraft.SellerAutomationPolicy{Enabled: true, EnabledKinds: []string{sellerdraft.KindResources}, Attestations: sellerdraft.Attestations{Pricing: true, Rights: true}}); err != nil {
		t.Fatal(err)
	}
	after := httptest.NewRecorder()
	router.ServeHTTP(after, authReq(http.MethodGet, "/.well-known/exora-dock.json", "", ""))
	if !strings.Contains(after.Body.String(), "provider.listing_drafts.mcp.v1") {
		t.Fatalf("enabled seller automation missing from live discovery manifest: %s", after.Body.String())
	}
}
