package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/discovery"
)

const protocolVersion = "2025-06-18"

type Options struct {
	BaseURL            string
	StartCommand       []string
	AgentToken         string
	ProviderAgentToken string
	ClientName         string
	HTTPClient         *http.Client
}

type Server struct {
	opts   Options
	client *http.Client
}

func NewServer(opts Options) *Server {
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &Server{opts: opts, client: client}
}

func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	encoder := json.NewEncoder(out)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		response := s.HandleJSON(ctx, line)
		if response != nil {
			if err := encoder.Encode(response); err != nil {
				return err
			}
		}
	}
	return scanner.Err()
}

func (s *Server) HandleJSON(ctx context.Context, data []byte) any {
	var req rpcRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return rpcError(nil, -32700, "Parse error", err.Error())
	}
	if req.JSONRPC != "2.0" || req.Method == "" {
		return rpcError(req.ID, -32600, "Invalid Request", nil)
	}
	return s.handle(ctx, req)
}

func (s *Server) handle(ctx context.Context, req rpcRequest) any {
	notification := req.ID == nil
	switch req.Method {
	case "initialize":
		if notification {
			return nil
		}
		return rpcResult(req.ID, map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": "exora-dock", "title": "Exora Dock", "version": "0.1.0"},
			"instructions":    "Use the four authoritative Exora marketplace categories: vm, resources, endpoint, and api_bridge. VM files move through lease-scoped SSH/SFTP/rsync; Resources use DownloadGrants; Endpoint requires an online Dock; API Bridge is Cloud-hosted. Seller tools create private drafts only and never publish or reveal credentials.",
		})
	case "notifications/initialized":
		return nil
	case "ping":
		if notification {
			return nil
		}
		return rpcResult(req.ID, map[string]any{})
	case "tools/list":
		if notification {
			return nil
		}
		definitions := marketplaceToolDefinitions()
		if s.sellerToolsEnabled(ctx) {
			definitions = append(definitions, sellerDraftToolDefinitions()...)
		}
		return rpcResult(req.ID, map[string]any{"tools": definitions})
	case "tools/call":
		if notification {
			return nil
		}
		var params toolCallParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return rpcError(req.ID, -32602, "Invalid params", err.Error())
		}
		if params.Arguments == nil {
			params.Arguments = map[string]any{}
		}
		result, err := s.callTool(ctx, params.Name, params.Arguments)
		if err != nil {
			return rpcError(req.ID, -32602, err.Error(), nil)
		}
		return rpcResult(req.ID, result)
	case "resources/list":
		if notification {
			return nil
		}
		return rpcResult(req.ID, map[string]any{"resources": []any{}})
	case "prompts/list":
		if notification {
			return nil
		}
		return rpcResult(req.ID, map[string]any{"prompts": []any{}})
	default:
		if notification {
			return nil
		}
		return rpcError(req.ID, -32601, "Method not found", req.Method)
	}
}

func (s *Server) callTool(ctx context.Context, name string, args map[string]any) (toolResult, error) {
	if isSellerDraftTool(name) {
		if strings.TrimSpace(s.opts.ProviderAgentToken) == "" {
			return errorResult("seller draft tools are unavailable", nil), nil
		}
		return s.callSellerDraftTool(ctx, name, args)
	}
	switch name {
	case "exora.search_products":
		query := url.Values{}
		copyStringArg(query, args, "q")
		copyStringArg(query, args, "applicationSource")
		return s.proxy(ctx, http.MethodGet, "/v3/catalog/listings", query, nil)
	case "exora.get_product_manifest":
		return s.proxyRequiredID(ctx, http.MethodGet, "/v3/catalog/listings/", args, "listingId", "listingId")
	case "exora.estimate_purchase":
		if firstString(args, "listingId") == "" {
			return errorResult("listingId required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v3/purchase-estimates", nil, args)
	case "exora.purchase_compute_minutes":
		if firstString(args, "listingId") == "" || firstString(args, "idempotencyKey") == "" {
			return errorResult("listingId and idempotencyKey required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v3/compute-purchases", nil, args)
	case "exora.extend_compute_minutes":
		id := firstString(args, "purchaseId")
		if id == "" || firstString(args, "idempotencyKey") == "" {
			return errorResult("purchaseId and idempotencyKey required", nil), nil
		}
		body := cloneArgs(args)
		delete(body, "purchaseId")
		return s.proxy(ctx, http.MethodPost, "/v3/compute-purchases/"+url.PathEscape(id)+"/extend", nil, body)
	case "exora.purchase_download":
		if firstString(args, "listingId") == "" || firstString(args, "idempotencyKey") == "" {
			return errorResult("listingId and idempotencyKey required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v3/download-grants", nil, args)
	case "exora.create_download_transfer":
		id := firstString(args, "grantId")
		if id == "" {
			return errorResult("grantId required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v3/download-grants/"+url.PathEscape(id)+"/transfers", nil, map[string]any{})
	case "exora.invoke_operation":
		if firstString(args, "listingId") == "" || firstString(args, "operationId") == "" || firstString(args, "idempotencyKey") == "" {
			return errorResult("listingId, operationId, and idempotencyKey required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v3/invocations", nil, args)
	case "exora.get_lease":
		return s.proxyRequiredID(ctx, http.MethodGet, "/v3/leases/", args, "leaseId", "leaseId")
	case "exora.release_lease":
		id := firstString(args, "leaseId")
		if id == "" {
			return errorResult("leaseId required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v3/leases/"+url.PathEscape(id)+"/release", nil, map[string]any{})
	case "exora.get_usage":
		if id := firstString(args, "leaseId"); id != "" {
			return s.proxy(ctx, http.MethodGet, "/v3/leases/"+url.PathEscape(id), nil, nil)
		}
		return s.proxy(ctx, http.MethodGet, "/v3/ledger", nil, nil)
	case "exora.save_endpoint_draft":
		return s.saveAPIDraft(ctx, args, "dock_tunnel")
	case "exora.save_api_bridge_draft":
		return s.saveAPIDraft(ctx, args, "transparent")
	default:
		return toolResult{}, fmt.Errorf("Unknown tool: %s", name)
	}
}

func (s *Server) saveAPIDraft(ctx context.Context, args map[string]any, bridgeMode string) (toolResult, error) {
	body := cloneArgs(args)
	for _, forbidden := range []string{"secret", "providerSecret", "credentialRef", "sellerAttestationConfirmed", "publish", "status"} {
		delete(body, forbidden)
	}
	if supplied := firstString(body, "bridgeMode"); supplied != "" && supplied != bridgeMode {
		return errorResult("bridgeMode must be "+bridgeMode, nil), nil
	}
	body["bridgeMode"] = bridgeMode
	baseURL := firstString(body, "baseUrl")
	if bridgeMode == "dock_tunnel" && baseURL != "" {
		return errorResult("Endpoint drafts must not include baseUrl", nil), nil
	}
	if bridgeMode == "transparent" {
		parsed, err := url.Parse(baseURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			return errorResult("API Bridge drafts require a public HTTPS baseUrl", nil), nil
		}
	}
	return s.proxy(ctx, http.MethodPost, "/v3/provider/api-bridge-drafts", nil, body)
}

func (s *Server) proxyRequiredID(ctx context.Context, method, prefix string, args map[string]any, key, label string) (toolResult, error) {
	id := firstString(args, key)
	if id == "" {
		return errorResult(label+" required", nil), nil
	}
	return s.proxy(ctx, method, prefix+url.PathEscape(id), nil, nil)
}

func (s *Server) proxy(ctx context.Context, method, path string, query url.Values, body any) (toolResult, error) {
	payload, err := s.daemonJSONWithToken(ctx, method, path, query, body, s.opts.AgentToken)
	if err != nil {
		return errorResult(err.Error(), nil), nil
	}
	return successResult(payload), nil
}

func (s *Server) daemonJSONWithToken(ctx context.Context, method, path string, query url.Values, body any, token string) (any, error) {
	baseURL, err := s.resolveDaemon(ctx)
	if err != nil {
		return nil, err
	}
	endpoint, err := url.Parse(strings.TrimRight(baseURL, "/") + path)
	if err != nil {
		return nil, err
	}
	if query != nil {
		endpoint.RawQuery = query.Encode()
	}
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint.String(), reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(token) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("daemon returned %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return map[string]any{}, nil
	}
	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

func (s *Server) resolveDaemon(ctx context.Context) (string, error) {
	candidates := []string{s.opts.BaseURL}
	start := s.opts.StartCommand
	if manifest, _, err := discovery.ReadFirst(); err == nil {
		candidates = append(candidates, manifest.BaseURL)
		if len(manifest.StartCommand) > 0 {
			start = manifest.StartCommand
		}
	}
	for _, candidate := range uniqueStrings(candidates) {
		if s.healthOK(ctx, candidate) {
			return candidate, nil
		}
	}
	if len(start) > 0 {
		return "", fmt.Errorf("Exora Dock daemon is not reachable. Start it with: %s", strings.Join(start, " "))
	}
	return "", fmt.Errorf("Exora Dock daemon is not reachable")
}

func (s *Server) healthOK(ctx context.Context, baseURL string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+"/health", nil)
	if err != nil {
		return false
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

func marketplaceToolDefinitions() []toolDefinition {
	return []toolDefinition{
		tool("exora.search_products", "Search Products", "Search authoritative V3 Listings by text and applicationSource.", map[string]any{"q": stringProp("Search text."), "applicationSource": enumStringProp("Authoritative category.", "vm", "resources", "endpoint", "api_bridge")}, nil),
		tool("exora.get_product_manifest", "Get Product Manifest", "Read one Listing and its AgentProductManifest.", map[string]any{"listingId": stringProp("Listing id.")}, []string{"listingId"}),
		tool("exora.estimate_purchase", "Estimate Purchase", "Estimate a purchase without reserving funds.", map[string]any{"listingId": stringProp("Listing id."), "durationMinutes": integerProp("VM duration."), "operationId": stringProp("Operation id.")}, []string{"listingId"}),
		tool("exora.purchase_compute_minutes", "Purchase Compute Minutes", "Purchase an exclusive VM Lease.", purchaseProps(true), []string{"listingId", "idempotencyKey"}),
		tool("exora.extend_compute_minutes", "Extend Compute Minutes", "Extend an active VM purchase.", map[string]any{"purchaseId": stringProp("Purchase id."), "durationMinutes": integerProp("Additional whole minutes."), "idempotencyKey": stringProp("Stable retry key.")}, []string{"purchaseId", "durationMinutes", "idempotencyKey"}),
		tool("exora.purchase_download", "Purchase Resources", "Purchase a time-limited S3 DownloadGrant.", purchaseProps(false), []string{"listingId", "idempotencyKey"}),
		tool("exora.create_download_transfer", "Create Download Transfer", "Create or resume a signed object-store transfer.", map[string]any{"grantId": stringProp("DownloadGrant id.")}, []string{"grantId"}),
		tool("exora.invoke_operation", "Invoke Operation", "Invoke a declared Endpoint or API Bridge operation.", map[string]any{"listingId": stringProp("Listing id."), "operationId": stringProp("Declared operation id."), "input": objectProp("Operation input."), "idempotencyKey": stringProp("Stable retry key.")}, []string{"listingId", "operationId", "idempotencyKey"}),
		tool("exora.get_lease", "Get Lease", "Read Lease state and SSH capability metadata.", map[string]any{"leaseId": stringProp("Lease id.")}, []string{"leaseId"}),
		tool("exora.release_lease", "Release Lease", "Release an active VM Lease.", map[string]any{"leaseId": stringProp("Lease id.")}, []string{"leaseId"}),
		tool("exora.get_usage", "Get Usage", "Read Lease or account usage.", map[string]any{"leaseId": stringProp("Optional Lease id.")}, nil),
		tool("exora.save_endpoint_draft", "Save Endpoint Draft", "Save a private dock_tunnel Endpoint draft without URL or credentials.", draftProps(false), []string{"draftId", "expectedVersion"}),
		tool("exora.save_api_bridge_draft", "Save API Bridge Draft", "Save a private transparent API Bridge draft for a public HTTPS service.", draftProps(true), []string{"draftId", "expectedVersion", "baseUrl"}),
	}
}

func purchaseProps(withDuration bool) map[string]any {
	props := map[string]any{"listingId": stringProp("Listing id."), "idempotencyKey": stringProp("Stable retry key.")}
	if withDuration {
		props["durationMinutes"] = integerProp("Whole purchased minutes.")
	}
	return props
}

func draftProps(withBaseURL bool) map[string]any {
	props := map[string]any{"draftId": stringProp("Existing private draft id."), "expectedVersion": integerProp("Optimistic concurrency version."), "interfaceMode": enumStringProp("Interface mode.", "passthrough", "agent_managed"), "openapi": objectProp("Reviewed OpenAPI 3.1 document."), "adapter": objectProp("Optional exora.adapter.v1 mappings."), "routes": arrayProp("Reviewed routes."), "pricing": objectProp("Explicit seller pricing."), "unresolvedFields": arrayProp("Uncertain field paths."), "agentNotes": stringProp("Safe notes.")}
	if withBaseURL {
		props["baseUrl"] = stringProp("Public HTTPS base URL.")
	}
	return props
}

func tool(name, title, description string, properties map[string]any, required []string) toolDefinition {
	return toolDefinition{Name: name, Title: title, Description: description, InputSchema: strictObjectSchema(properties, required)}
}

type rpcRequest struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Method  string           `json:"method"`
	Params  json.RawMessage  `json:"params,omitempty"`
}
type rpcResponse struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Result  any              `json:"result,omitempty"`
	Error   *rpcErrorObject  `json:"error,omitempty"`
}
type rpcErrorObject struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}
type toolCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}
type toolResult struct {
	Content           []textContent `json:"content"`
	StructuredContent any           `json:"structuredContent,omitempty"`
	IsError           bool          `json:"isError,omitempty"`
}
type textContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}
type toolDefinition struct {
	Name        string         `json:"name"`
	Title       string         `json:"title,omitempty"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

func rpcResult(id *json.RawMessage, result any) rpcResponse {
	return rpcResponse{JSONRPC: "2.0", ID: id, Result: result}
}
func rpcError(id *json.RawMessage, code int, message string, data any) rpcResponse {
	return rpcResponse{JSONRPC: "2.0", ID: id, Error: &rpcErrorObject{Code: code, Message: message, Data: data}}
}
func successResult(value any) toolResult {
	data, _ := json.Marshal(value)
	return toolResult{Content: []textContent{{Type: "text", Text: string(data)}}, StructuredContent: value}
}
func errorResult(message string, data any) toolResult {
	if data == nil {
		data = map[string]any{"error": message}
	}
	return toolResult{Content: []textContent{{Type: "text", Text: message}}, StructuredContent: data, IsError: true}
}
func firstString(args map[string]any, names ...string) string {
	for _, name := range names {
		if value, ok := args[name].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
func copyStringArg(query url.Values, args map[string]any, name string) {
	if value := firstString(args, name); value != "" {
		query.Set(name, value)
	}
}
func cloneArgs(args map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range args {
		out[key] = value
	}
	return out
}
func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimRight(strings.TrimSpace(value), "/")
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}
func strictObjectSchema(properties map[string]any, required []string) map[string]any {
	schema := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}
func stringProp(description string) map[string]any {
	return map[string]any{"type": "string", "description": description}
}
func enumStringProp(description string, values ...string) map[string]any {
	return map[string]any{"type": "string", "description": description, "enum": values}
}
func integerProp(description string) map[string]any {
	return map[string]any{"type": "integer", "minimum": 0, "description": description}
}
func objectProp(description string) map[string]any {
	return map[string]any{"type": "object", "description": description, "additionalProperties": true}
}
func arrayProp(description string) map[string]any {
	return map[string]any{"type": "array", "description": description, "items": map[string]any{}}
}
