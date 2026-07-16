package mcp

import (
	"context"
	"reflect"
	"testing"
)

func TestMarketplaceToolSurfaceIsExact(t *testing.T) {
	want := []string{
		"exora.search_products",
		"exora.get_product_manifest",
		"exora.estimate_purchase",
		"exora.purchase_compute_minutes",
		"exora.extend_compute_minutes",
		"exora.purchase_download",
		"exora.create_download_transfer",
		"exora.invoke_operation",
		"exora.get_lease",
		"exora.release_lease",
		"exora.get_usage",
		"exora.save_endpoint_draft",
		"exora.save_api_bridge_draft",
	}
	definitions := marketplaceToolDefinitions()
	got := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		got = append(got, definition.Name)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("marketplace tools mismatch\n got: %#v\nwant: %#v", got, want)
	}
}

func TestSellerDraftToolSurfaceIsExact(t *testing.T) {
	want := []string{
		"exora.get_seller_draft_capabilities",
		"exora.discover_sellable_resources",
		"exora.read_seller_material",
		"exora.create_vm_listing_draft",
		"exora.create_resource_listing_draft",
		"exora.create_endpoint_listing_draft",
		"exora.create_api_bridge_listing_draft",
		"exora.get_seller_draft_run",
		"exora.resume_seller_draft_run",
		"exora.cancel_seller_draft_run",
		"exora.list_my_listing_drafts",
	}
	definitions := sellerDraftToolDefinitions()
	got := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		got = append(got, definition.Name)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("seller tools mismatch\n got: %#v\nwant: %#v", got, want)
	}
}

func TestAPIDraftBoundariesRejectCrossedDeliveryModes(t *testing.T) {
	server := NewServer(Options{})
	endpoint, err := server.saveAPIDraft(context.Background(), map[string]any{"baseUrl": "https://seller.example"}, "dock_tunnel")
	if err != nil || !endpoint.IsError {
		t.Fatalf("Endpoint with baseUrl must be rejected: result=%#v err=%v", endpoint, err)
	}
	bridge, err := server.saveAPIDraft(context.Background(), map[string]any{"baseUrl": "http://seller.example"}, "transparent")
	if err != nil || !bridge.IsError {
		t.Fatalf("API Bridge without public HTTPS must be rejected: result=%#v err=%v", bridge, err)
	}
}
