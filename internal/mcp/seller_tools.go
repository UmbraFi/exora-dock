package mcp

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var sellerDraftToolNames = map[string]bool{
	"exora.get_seller_draft_capabilities":   true,
	"exora.discover_sellable_resources":     true,
	"exora.read_seller_material":            true,
	"exora.create_vm_listing_draft":         true,
	"exora.create_resource_listing_draft":   true,
	"exora.create_endpoint_listing_draft":   true,
	"exora.create_api_bridge_listing_draft": true,
	"exora.get_seller_draft_run":            true,
	"exora.resume_seller_draft_run":         true,
	"exora.cancel_seller_draft_run":         true,
	"exora.list_my_listing_drafts":          true,
}

func isSellerDraftTool(name string) bool { return sellerDraftToolNames[strings.TrimSpace(name)] }

func (s *Server) sellerToolsEnabled(ctx context.Context) bool {
	if strings.TrimSpace(s.opts.ProviderAgentToken) == "" {
		return false
	}
	checkCtx, cancel := context.WithTimeout(ctx, sellerCapabilityTimeout)
	defer cancel()
	payload, err := s.daemonJSONWithToken(checkCtx, http.MethodGet, "/v3/provider-agent/capabilities", nil, nil, s.opts.ProviderAgentToken)
	if err != nil {
		return false
	}
	values, _ := payload.(map[string]any)
	enabled, _ := values["enabled"].(bool)
	return enabled
}

const sellerCapabilityTimeout = time.Second

func (s *Server) sellerProxy(ctx context.Context, method, path string, query url.Values, body any) (toolResult, error) {
	payload, err := s.daemonJSONWithToken(ctx, method, path, query, body, s.opts.ProviderAgentToken)
	if err != nil {
		return errorResult(err.Error(), nil), nil
	}
	return successResult(payload), nil
}

func (s *Server) callSellerDraftTool(ctx context.Context, name string, args map[string]any) (toolResult, error) {
	switch name {
	case "exora.get_seller_draft_capabilities":
		return s.sellerProxy(ctx, http.MethodGet, "/v3/provider-agent/capabilities", nil, nil)
	case "exora.discover_sellable_resources":
		return s.sellerProxy(ctx, http.MethodPost, "/v3/provider-agent/candidates/discover", nil, args)
	case "exora.read_seller_material":
		return s.sellerProxy(ctx, http.MethodPost, "/v3/provider-agent/materials/read", nil, args)
	case "exora.create_vm_listing_draft", "exora.create_resource_listing_draft", "exora.create_endpoint_listing_draft", "exora.create_api_bridge_listing_draft":
		body := cloneArgs(args)
		body["kind"] = map[string]string{
			"exora.create_vm_listing_draft":         "vm",
			"exora.create_resource_listing_draft":   "resources",
			"exora.create_endpoint_listing_draft":   "endpoint",
			"exora.create_api_bridge_listing_draft": "api_bridge",
		}[name]
		// Connection provenance is assigned by the MCP server, never trusted from
		// Agent-supplied tool arguments.
		body["mcpConnectionId"] = strings.TrimSpace(s.opts.ClientName)
		return s.sellerProxy(ctx, http.MethodPost, "/v3/provider-agent/draft-runs", nil, body)
	case "exora.get_seller_draft_run":
		runID := firstString(args, "runId")
		if runID == "" {
			return errorResult("runId required", nil), nil
		}
		return s.sellerProxy(ctx, http.MethodGet, "/v3/provider-agent/draft-runs/"+url.PathEscape(runID), nil, nil)
	case "exora.resume_seller_draft_run":
		runID := firstString(args, "runId")
		if runID == "" {
			return errorResult("runId required", nil), nil
		}
		body := cloneArgs(args)
		delete(body, "runId")
		return s.sellerProxy(ctx, http.MethodPost, "/v3/provider-agent/draft-runs/"+url.PathEscape(runID)+"/resume", nil, body)
	case "exora.cancel_seller_draft_run":
		runID := firstString(args, "runId")
		if runID == "" {
			return errorResult("runId required", nil), nil
		}
		body := cloneArgs(args)
		delete(body, "runId")
		return s.sellerProxy(ctx, http.MethodPost, "/v3/provider-agent/draft-runs/"+url.PathEscape(runID)+"/cancel", nil, body)
	case "exora.list_my_listing_drafts":
		query := url.Values{}
		if limit, ok := args["limit"].(float64); ok && limit > 0 {
			query.Set("limit", strconv.Itoa(int(limit)))
		}
		return s.sellerProxy(ctx, http.MethodGet, "/v3/provider-agent/draft-runs", query, nil)
	}
	return errorResult("unknown seller draft tool", nil), nil
}

func sellerDraftToolDefinitions() []toolDefinition {
	commonCreate := func(kind string) map[string]any {
		return strictObjectSchema(map[string]any{
			"candidateIds":   arrayProp("One or more short-lived candidateIds returned by discover_sellable_resources."),
			"title":          stringProp("Optional explicit title; otherwise the saved kind default or candidate name is used."),
			"description":    stringProp("Optional explicit description."),
			"credentialRef":  stringProp("Optional safe credential alias. Never pass plaintext credentials."),
			"commercial":     objectProp("Explicit commercial values. These override saved defaults and are never inferred by the Agent."),
			"specification":  objectProp("Kind-specific technical specification, routes, healthPath, or VM environment selection."),
			"idempotencyKey": stringProp("Stable 8 to 128 character key; reuse it on retries."),
		}, []string{"candidateIds", "idempotencyKey"})
	}
	return []toolDefinition{
		{Name: "exora.get_seller_draft_capabilities", Title: "Get Seller Draft Capabilities", Description: "Read enabled seller resource kinds, authorized roots/services, saved commercial defaults, policy receipt, host support, and credential metadata. Secrets are never returned.", InputSchema: strictObjectSchema(map[string]any{}, nil)},
		{Name: "exora.discover_sellable_resources", Title: "Discover Sellable Resources", Description: "Discover candidates only inside seller-authorized roots, registered services, and verified VM runtimes. Returns short-lived candidateIds, never arbitrary filesystem access.", InputSchema: strictObjectSchema(map[string]any{"kinds": arrayProp("Optional subset: vm, resources, endpoint, api_bridge."), "targetHints": arrayProp("Names or authorized relative paths mentioned by the seller."), "query": stringProp("Optional text filter."), "maxResults": integerProp("Bounded result count.")}, nil)},
		{Name: "exora.read_seller_material", Title: "Read Seller Material", Description: "Read a bounded chunk of an authorized text-material candidate. This cannot read arbitrary paths.", InputSchema: strictObjectSchema(map[string]any{"candidateId": stringProp("Short-lived discovered candidate id."), "offset": integerProp("Byte offset."), "limit": integerProp("Chunk size up to 256 KiB.")}, []string{"candidateId"})},
		{Name: "exora.create_vm_listing_draft", Title: "Create VM Listing Draft", Description: "Validate a verified WSL2/KVM environment, reserve capacity for 24 hours, and create a private compute Listing draft. Never publishes.", InputSchema: commonCreate("vm")},
		{Name: "exora.create_resource_listing_draft", Title: "Create Resources Listing Draft", Description: "Revalidate authorized files, package ZIP, upload and verify SHA-256, then create a private download Listing draft. Never publishes.", InputSchema: commonCreate("resources")},
		{Name: "exora.create_endpoint_listing_draft", Title: "Create Endpoint Listing Draft", Description: "Probe an authorized private/loopback service, bind a local credentialRef, persist tunnel config, and create a private Endpoint Listing draft. Never publishes.", InputSchema: commonCreate("endpoint")},
		{Name: "exora.create_api_bridge_listing_draft", Title: "Create API Bridge Listing Draft", Description: "Probe an authorized public HTTPS service with DNS-rebinding and redirect protection, send credential directly from Dock to Cloud, and create a private API Listing draft. Never publishes.", InputSchema: commonCreate("api_bridge")},
		{Name: "exora.get_seller_draft_run", Title: "Get Seller Draft Run", Description: "Read durable progress, stateVersion, missing fields, safe failure details, and private draft result.", InputSchema: strictObjectSchema(map[string]any{"runId": stringProp("SellerDraftRun id.")}, []string{"runId"})},
		{Name: "exora.resume_seller_draft_run", Title: "Resume Seller Draft Run", Description: "Resume a needs_input or failed run with seller-provided values using optimistic concurrency and idempotency.", InputSchema: strictObjectSchema(map[string]any{"runId": stringProp("SellerDraftRun id."), "expectedStateVersion": integerProp("Exact current stateVersion."), "idempotencyKey": stringProp("Stable retry key."), "values": objectProp("Only the values explicitly supplied by the seller.")}, []string{"runId", "expectedStateVersion", "idempotencyKey", "values"})},
		{Name: "exora.cancel_seller_draft_run", Title: "Cancel Seller Draft Run", Description: "Cooperatively cancel a private draft run and clean up in-flight upload state. This does not alter public Listings.", InputSchema: strictObjectSchema(map[string]any{"runId": stringProp("SellerDraftRun id."), "expectedStateVersion": integerProp("Exact current stateVersion."), "idempotencyKey": stringProp("Stable retry key.")}, []string{"runId", "expectedStateVersion", "idempotencyKey"})},
		{Name: "exora.list_my_listing_drafts", Title: "List My Listing Drafts", Description: "List durable Agent-created private draft runs and Ready-to-publish results. No public Listing actions are available.", InputSchema: strictObjectSchema(map[string]any{"limit": integerProp("Maximum 100 runs.")}, nil)},
	}
}
