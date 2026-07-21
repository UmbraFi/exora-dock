package sellerdraft

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/endpoint"
)

func TestLiveLocalAPISynchronizesTunnelEndpoint(t *testing.T) {
	runtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"ok"}`))
	}))
	defer runtime.Close()
	c, err := cache.New(100, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	endpointStore := endpoint.NewStore(c, "account-test")
	service := NewService(ServiceOptions{Store: NewStore(c, "account-test"), EndpointStore: endpointStore})
	capability := validCapability()
	mapValue(capability["runtime"])["publicBaseUrl"] = runtime.URL
	draft := APIDraft{
		APIID: "api_tunnel_test", DeliveryMode: "local_dock", Status: "live", Capability: capability,
		Operations: map[string]OperationReview{"convert_document": {OperationID: "convert_document", Enabled: true, OperationalState: "live"}},
	}
	if err := service.syncTunnelEndpoint(context.Background(), draft); err != nil {
		t.Fatal(err)
	}
	cfg, found := endpointStore.Get(v4TunnelEndpointID(draft.APIID))
	if !found || cfg.LocalBaseURL != runtime.URL || len(cfg.Routes) != 1 || cfg.Routes[0].Method != http.MethodPost || cfg.Routes[0].Path != "/convert" {
		t.Fatalf("tunnel endpoint not synchronized: found=%v cfg=%#v", found, cfg)
	}
	draft.Status = "offline"
	if err := service.syncTunnelEndpoint(context.Background(), draft); err != nil {
		t.Fatal(err)
	}
	if _, found := endpointStore.Get(v4TunnelEndpointID(draft.APIID)); found {
		t.Fatal("offline local API remained registered in the tunnel")
	}
}

func TestAsyncLocalAPIProducesValidTunnelManifest(t *testing.T) {
	capability := validCapability()
	operation := mapValue(sliceValue(capability["operations"])[0])
	mapValue(operation["interaction"])["mode"] = "async_job"
	draft := APIDraft{APIID: "api_async_tunnel", Capability: capability}
	manifest, _, _, err := tunnelManifestFromDraft(draft)
	if err != nil {
		t.Fatal(err)
	}
	if _, routes, _, err := endpoint.ValidateServiceManifest(manifest); err != nil || len(routes) != 1 || routes[0].Streaming != "async_job" {
		t.Fatalf("async tunnel manifest invalid: routes=%#v err=%v", routes, err)
	}
}
