package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/exora-dock/exora-dock/internal/agent"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/delegation"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/lease"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestResourceDelegationLeaseFlow(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	defer c.Close()

	resources := resource.NewStore(c)
	delegations := delegation.NewStore(c)
	leases := lease.NewStore(c)
	reviewAgent := agent.NewReviewAgent("", "", "", nil)

	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, reviewAgent, nil, nil, resources, delegations, leases, "local-dev-miner")
	router := chi.NewRouter()
	router.Get("/.well-known/exora-dock.json", handler.DiscoveryManifest)
	router.Post("/resources", handler.CreateResource)
	router.Get("/resources", handler.ListResources)
	router.Post("/delegations", handler.CreateDelegation)
	router.Post("/leases", handler.CreateLease)
	router.Get("/leases/{id}/credentials", handler.GetLeaseCredentials)
	router.Post("/leases/{id}/revoke", handler.RevokeLease)

	resourceBody := []byte(`{
		"name":"A100 burst GPU",
		"type":"gpu",
		"summary":"Single A100 for short agent jobs",
		"description":"A100 80GB GPU worker with Python runtime for autonomous agents.",
		"providerPubkey":"provider-1",
		"pricePerUnit":"0.25",
		"billingUnit":"hour",
		"minDurationMinutes":30,
		"maxDurationMinutes":180,
		"spec":{"gpuModel":"A100","gpuCount":1,"vramGb":80,"region":"us-east"}
	}`)
	resourceReq := httptest.NewRequest(http.MethodPost, "/resources", bytes.NewReader(resourceBody))
	resourceRec := httptest.NewRecorder()
	router.ServeHTTP(resourceRec, resourceReq)
	if resourceRec.Code != http.StatusCreated {
		t.Fatalf("resource status = %d body = %s", resourceRec.Code, resourceRec.Body.String())
	}
	var resourceResp struct {
		Resource resource.Resource `json:"resource"`
	}
	if err := json.Unmarshal(resourceRec.Body.Bytes(), &resourceResp); err != nil {
		t.Fatalf("resource json error = %v", err)
	}
	smallResourceBody := []byte(`{
		"name":"T4 utility GPU",
		"type":"gpu",
		"summary":"Small GPU for tiny jobs",
		"description":"T4 16GB GPU worker for lightweight agent tasks.",
		"providerPubkey":"provider-2",
		"pricePerUnit":"0.08",
		"billingUnit":"hour",
		"minDurationMinutes":30,
		"maxDurationMinutes":180,
		"spec":{"gpuModel":"T4","gpuCount":1,"vramGb":16,"region":"us-east"}
	}`)
	smallResourceReq := httptest.NewRequest(http.MethodPost, "/resources", bytes.NewReader(smallResourceBody))
	smallResourceRec := httptest.NewRecorder()
	router.ServeHTTP(smallResourceRec, smallResourceReq)
	if smallResourceRec.Code != http.StatusCreated {
		t.Fatalf("small resource status = %d body = %s", smallResourceRec.Code, smallResourceRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/resources?type=gpu&q=a100", nil)
	listRec := httptest.NewRecorder()
	router.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK || !strings.Contains(listRec.Body.String(), resourceResp.Resource.ID) {
		t.Fatalf("list status/body = %d %s", listRec.Code, listRec.Body.String())
	}
	vramReq := httptest.NewRequest(http.MethodGet, "/resources?type=gpu&minVramGb=20", nil)
	vramRec := httptest.NewRecorder()
	router.ServeHTTP(vramRec, vramReq)
	if vramRec.Code != http.StatusOK || !strings.Contains(vramRec.Body.String(), resourceResp.Resource.ID) || strings.Contains(vramRec.Body.String(), "T4 utility GPU") {
		t.Fatalf("vram status/body = %d %s", vramRec.Code, vramRec.Body.String())
	}
	discoveryReq := httptest.NewRequest(http.MethodGet, "/.well-known/exora-dock.json", nil)
	discoveryReq.Host = "127.0.0.1:8080"
	discoveryRec := httptest.NewRecorder()
	router.ServeHTTP(discoveryRec, discoveryReq)
	if discoveryRec.Code != http.StatusOK || !strings.Contains(discoveryRec.Body.String(), "resources.search") {
		t.Fatalf("discovery status/body = %d %s", discoveryRec.Code, discoveryRec.Body.String())
	}

	delegationBody := []byte(`{
		"userPubkey":"user-1",
		"agentId":"agent-alpha",
		"resourceTypes":["gpu"],
		"budgetLimit":1.0,
		"maxDurationMinutes":120,
		"allowedRegions":["us-east"]
	}`)
	delegationReq := httptest.NewRequest(http.MethodPost, "/delegations", bytes.NewReader(delegationBody))
	delegationRec := httptest.NewRecorder()
	router.ServeHTTP(delegationRec, delegationReq)
	if delegationRec.Code != http.StatusCreated {
		t.Fatalf("delegation status = %d body = %s", delegationRec.Code, delegationRec.Body.String())
	}

	leaseBody := []byte(`{"userPubkey":"user-1","agentId":"agent-alpha","resourceId":"` + resourceResp.Resource.ID + `","durationMinutes":60}`)
	leaseReq := httptest.NewRequest(http.MethodPost, "/leases", bytes.NewReader(leaseBody))
	leaseRec := httptest.NewRecorder()
	router.ServeHTTP(leaseRec, leaseReq)
	if leaseRec.Code != http.StatusCreated {
		t.Fatalf("lease status = %d body = %s", leaseRec.Code, leaseRec.Body.String())
	}
	var leaseResp struct {
		Lease lease.Lease `json:"lease"`
	}
	if err := json.Unmarshal(leaseRec.Body.Bytes(), &leaseResp); err != nil {
		t.Fatalf("lease json error = %v", err)
	}
	if leaseResp.Lease.Status != lease.StatusActive {
		t.Fatalf("lease status = %s, want active", leaseResp.Lease.Status)
	}

	credReq := httptest.NewRequest(http.MethodGet, "/leases/"+leaseResp.Lease.ID+"/credentials", nil)
	credRec := httptest.NewRecorder()
	router.ServeHTTP(credRec, credReq)
	if credRec.Code != http.StatusOK || !strings.Contains(credRec.Body.String(), "exora_") {
		t.Fatalf("credentials status/body = %d %s", credRec.Code, credRec.Body.String())
	}

	revokeReq := httptest.NewRequest(http.MethodPost, "/leases/"+leaseResp.Lease.ID+"/revoke", nil)
	revokeRec := httptest.NewRecorder()
	router.ServeHTTP(revokeRec, revokeReq)
	if revokeRec.Code != http.StatusOK || !strings.Contains(revokeRec.Body.String(), string(lease.StatusRevoked)) {
		t.Fatalf("revoke status/body = %d %s", revokeRec.Code, revokeRec.Body.String())
	}
}
