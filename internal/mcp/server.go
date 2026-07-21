package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/discovery"
)

const protocolVersion = "2025-06-18"

var mcpSecretPattern = regexp.MustCompile(`(?i)(?:sk-exora(?:-session)?|exora_owner_)-?[a-z0-9._-]+`)

type daemonHTTPError struct {
	StatusCode int
	Message    string
}

func (e *daemonHTTPError) Error() string { return e.Message }

func sanitizeMCPText(value string) string {
	return mcpSecretPattern.ReplaceAllString(strings.TrimSpace(value), "[REDACTED]")
}

type Options struct {
	BaseURL      string
	StartCommand []string
	OwnerToken   string
	ClientName   string
	HTTPClient   *http.Client
}

type Server struct {
	opts         Options
	client       *http.Client
	sessionMu    sync.RWMutex
	sessionID    string
	sessionToken string
	sessionMeta  map[string]any
	lifecycleMu  sync.RWMutex
	initialized  bool
	ready        bool
	requestsMu   sync.Mutex
	requests     map[string]context.CancelFunc
	cancelled    map[string]bool
	toolSem      chan struct{}
}

func NewServer(opts Options) *Server {
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{}
	}
	return &Server{opts: opts, client: client, requests: map[string]context.CancelFunc{}, cancelled: map[string]bool{}, toolSem: make(chan struct{}, 8)}
}

func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	serveCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	defer s.revokeSession(context.Background())
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	encoder := json.NewEncoder(out)
	var encoderMu sync.Mutex
	var requests sync.WaitGroup
	for scanner.Scan() {
		line := append([]byte(nil), bytes.TrimSpace(scanner.Bytes())...)
		if len(line) == 0 {
			continue
		}
		var envelope rpcRequest
		_ = json.Unmarshal(line, &envelope)
		handle := func() error {
			response := s.handleJSONTracked(serveCtx, line)
			if response == nil {
				return nil
			}
			encoderMu.Lock()
			defer encoderMu.Unlock()
			return encoder.Encode(response)
		}
		if envelope.Method == "initialize" || envelope.Method == "notifications/initialized" || envelope.Method == "notifications/cancelled" {
			if err := handle(); err != nil {
				return err
			}
			continue
		}
		requests.Add(1)
		go func() {
			defer requests.Done()
			_ = handle()
		}()
	}
	requests.Wait()
	cancel()
	if err := scanner.Err(); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "token too long") {
			encoderMu.Lock()
			encodeErr := encoder.Encode(rpcError(nil, -32600, "MCP message exceeds the 8 MiB limit", nil))
			encoderMu.Unlock()
			return encodeErr
		}
		return err
	}
	return nil
}

func requestKey(id *json.RawMessage) string {
	if id == nil {
		return ""
	}
	return string(*id)
}

func (s *Server) handleJSONTracked(ctx context.Context, data []byte) any {
	var req rpcRequest
	if json.Unmarshal(data, &req) != nil || req.ID == nil {
		return s.HandleJSON(ctx, data)
	}
	requestCtx, cancel := context.WithCancel(ctx)
	key := requestKey(req.ID)
	s.requestsMu.Lock()
	s.requests[key] = cancel
	wasCancelled := s.cancelled[key]
	delete(s.cancelled, key)
	s.requestsMu.Unlock()
	if wasCancelled {
		cancel()
	}
	defer func() {
		cancel()
		s.requestsMu.Lock()
		delete(s.requests, key)
		s.requestsMu.Unlock()
	}()
	return s.HandleJSON(requestCtx, data)
}

func (s *Server) cancelRequest(id any) {
	raw, _ := json.Marshal(id)
	s.requestsMu.Lock()
	cancel := s.requests[string(raw)]
	if cancel == nil {
		s.cancelled[string(raw)] = true
	}
	s.requestsMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *Server) cancelAllRequests() {
	s.requestsMu.Lock()
	for _, cancel := range s.requests {
		cancel()
	}
	s.requestsMu.Unlock()
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
	if req.Method != "initialize" && req.Method != "ping" && req.Method != "notifications/initialized" && req.Method != "notifications/cancelled" {
		s.lifecycleMu.RLock()
		ready := s.ready
		s.lifecycleMu.RUnlock()
		if !ready {
			if notification {
				return nil
			}
			return rpcError(req.ID, -32002, "Server is not initialized", nil)
		}
	}
	switch req.Method {
	case "initialize":
		if notification {
			return nil
		}
		var params initializeParams
		if err := json.Unmarshal(req.Params, &params); err != nil || strings.TrimSpace(params.ProtocolVersion) == "" || strings.TrimSpace(params.ClientInfo.Name) == "" {
			return rpcError(req.ID, -32602, "Invalid initialize params", nil)
		}
		if params.ProtocolVersion != protocolVersion {
			return rpcError(req.ID, -32602, "Unsupported protocol version", map[string]any{"supported": []string{protocolVersion}, "requested": params.ProtocolVersion})
		}
		s.lifecycleMu.Lock()
		if s.initialized {
			s.lifecycleMu.Unlock()
			return rpcError(req.ID, -32600, "Server is already initialized", nil)
		}
		s.initialized = true
		s.lifecycleMu.Unlock()
		connection, err := s.ensureSession(ctx)
		if err != nil {
			s.lifecycleMu.Lock()
			s.initialized = false
			s.lifecycleMu.Unlock()
			return rpcError(req.ID, -32001, "Unable to create a local Exora session", err.Error())
		}
		return rpcResult(req.ID, map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": "exora-dock", "title": "Exora Dock", "version": "0.1.0"},
			"instructions":    "Use Exora's API to Operation to Invocation marketplace. Buyer tools use apiId + operationId, recover calls with exora.get_invocation, and request short-lived output downloads with exora.create_artifact_download_grant. Use exora.get_ledger for account ledger entries; exora.get_usage is a deprecated compatibility alias. Provider Agents must begin with exora.get_api_preparation_guide, author one exora.api-contract.v1 file from the seller's explicit API and billing intent, and submit it with exora.submit_api_contract. Never submit credential values, choose prices, run validation, confirm the contract, publish, or change lifecycle on the owner's behalf. API Order reactivation always requires human PIN approval.",
			"_meta":           map[string]any{"exoraConnection": connection, "apiPreparationGuideVersion": "exora.api-preparation-guide.v3", "apiContractSchemaVersion": "exora.api-contract.v1", "capabilitySchemaVersion": "exora.api.v3", "operationSchemaVersion": "exora.operation.v3", "pricingSchemaVersion": "exora.operation-pricing.v4", "bundledSkill": "skills/prepare-exora-api/SKILL.md"},
		})
	case "notifications/initialized":
		s.lifecycleMu.Lock()
		if s.initialized {
			s.ready = true
		}
		s.lifecycleMu.Unlock()
		return nil
	case "notifications/cancelled":
		var params struct {
			RequestID any `json:"requestId"`
		}
		if json.Unmarshal(req.Params, &params) == nil {
			s.cancelRequest(params.RequestID)
		}
		return nil
	case "ping":
		if notification {
			return nil
		}
		_ = s.heartbeatSession(ctx)
		return rpcResult(req.ID, map[string]any{})
	case "tools/list":
		if notification {
			return nil
		}
		definitions := s.availableToolDefinitions()
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
		definition, found := s.availableToolDefinition(params.Name)
		if !found {
			return rpcError(req.ID, -32602, "Unknown or unavailable tool: "+params.Name, nil)
		}
		if err := validateSchemaValue(params.Arguments, definition.InputSchema, "arguments"); err != nil {
			return rpcError(req.ID, -32602, "Invalid tool arguments", err.Error())
		}
		select {
		case s.toolSem <- struct{}{}:
			defer func() { <-s.toolSem }()
		case <-ctx.Done():
			return rpcResult(req.ID, errorResult("tool call cancelled", map[string]any{"error": "cancelled", "retryable": true}))
		}
		result, err := s.callTool(ctx, params.Name, params.Arguments)
		if err != nil {
			return rpcError(req.ID, -32602, err.Error(), nil)
		}
		return rpcResult(req.ID, result)
	default:
		if notification {
			return nil
		}
		return rpcError(req.ID, -32601, "Method not found", req.Method)
	}
}

func (s *Server) callTool(ctx context.Context, name string, args map[string]any) (toolResult, error) {
	if isIntegrationTool(name) {
		if !s.integrationToolsEnabled(ctx) {
			return errorResult("provider integration tools are unavailable", nil), nil
		}
		return s.callIntegrationTool(ctx, name, args)
	}
	switch name {
	case "exora.search_operations":
		query := url.Values{}
		copyStringArg(query, args, "q")
		return s.proxy(ctx, http.MethodGet, "/v4/catalog/operations", query, nil)
	case "exora.get_api":
		return s.proxyRequiredID(ctx, http.MethodGet, "/v4/catalog/apis/", args, "apiId", "apiId")
	case "exora.estimate_operation":
		if firstString(args, "apiId") == "" || firstString(args, "operationId") == "" {
			return errorResult("apiId and operationId required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v4/operation-estimates", nil, args)
	case "exora.invoke_operation":
		if firstString(args, "apiId") == "" || firstString(args, "operationId") == "" || firstString(args, "idempotencyKey") == "" {
			return errorResult("apiId, operationId, and idempotencyKey required", nil), nil
		}
		apiID, operationID := firstString(args, "apiId"), firstString(args, "operationId")
		return s.proxy(ctx, http.MethodPost, "/v4/apis/"+url.PathEscape(apiID)+"/operations/"+url.PathEscape(operationID)+"/invocations", nil, args)
	case "exora.get_invocation":
		return s.proxyRequiredID(ctx, http.MethodGet, "/v4/invocations/", args, "invocationId", "invocationId")
	case "exora.get_job":
		return s.proxyRequiredID(ctx, http.MethodGet, "/v4/jobs/", args, "jobId", "jobId")
	case "exora.cancel_job":
		id := firstString(args, "jobId")
		if id == "" {
			return errorResult("jobId required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v4/jobs/"+url.PathEscape(id)+"/cancel", nil, map[string]any{})
	case "exora.create_artifact_upload":
		return s.proxy(ctx, http.MethodPost, "/v4/artifact-uploads", nil, args)
	case "exora.complete_artifact_upload":
		id := firstString(args, "artifactId")
		if id == "" {
			return errorResult("artifactId required", nil), nil
		}
		body := cloneArgs(args)
		delete(body, "artifactId")
		return s.proxy(ctx, http.MethodPost, "/v4/artifact-uploads/"+url.PathEscape(id)+"/complete", nil, body)
	case "exora.create_artifact_download_grant":
		id := firstString(args, "artifactId")
		if id == "" {
			return errorResult("artifactId required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v4/artifacts/"+url.PathEscape(id)+"/download-grants", nil, map[string]any{})
	case "exora.get_ledger", "exora.get_usage":
		return s.proxy(ctx, http.MethodGet, "/v4/ledger", nil, nil)
	case "exora.list_api_orders":
		query := url.Values{}
		status := firstString(args, "status")
		if status == "" {
			status = "active"
		}
		query.Set("status", status)
		if value, ok := args["limit"].(float64); ok {
			query.Set("limit", fmt.Sprintf("%d", int(value)))
		}
		copyStringArg(query, args, "cursor")
		return s.proxy(ctx, http.MethodGet, "/v4/api-orders", query, nil)
	case "exora.get_api_order":
		return s.proxyRequiredID(ctx, http.MethodGet, "/v4/api-orders/", args, "apiOrderId", "apiOrderId")
	case "exora.deactivate_api_order":
		id := firstString(args, "apiOrderId")
		return s.proxy(ctx, http.MethodPost, "/v4/api-orders/"+url.PathEscape(id)+"/deactivate", nil, map[string]any{})
	case "exora.request_api_order_reactivation":
		id := firstString(args, "apiOrderId")
		return s.proxy(ctx, http.MethodPost, "/v4/api-orders/"+url.PathEscape(id)+"/reactivation-requests", nil, map[string]any{})
	default:
		return toolResult{}, fmt.Errorf("Unknown tool: %s", name)
	}
}

func (s *Server) saveServiceDraft(ctx context.Context, args map[string]any) (toolResult, error) {
	body := cloneArgs(args)
	for _, forbidden := range []string{"secret", "providerSecret", "credentialRef", "baseUrl", "localBaseUrl", "endpointId", "healthPath", "authType", "sellerAttestationConfirmed", "publish", "status"} {
		if _, supplied := body[forbidden]; supplied {
			return errorResult("service drafts must not include runtime, credentials, seller confirmation, or publishing fields", nil), nil
		}
	}
	manifest, ok := body["serviceManifest"].(map[string]any)
	if !ok {
		return errorResult("serviceManifest is required", nil), nil
	}
	delivery := firstString(manifest, "deliveryMode")
	if delivery != "local_dock" && delivery != "cloud_direct" {
		return errorResult("serviceManifest.deliveryMode must be local_dock or cloud_direct", nil), nil
	}
	manifest["applicationSource"] = "api"
	manifest["schemaVersion"] = "exora.service_manifest.v2"
	body["serviceManifest"] = manifest
	body["applicationSource"] = "api"
	method, path := http.MethodPost, "/v4/provider/api-drafts"
	if draftID := firstString(body, "draftId"); draftID != "" {
		method = http.MethodPut
		path += "/" + url.PathEscape(draftID)
	}
	return s.proxy(ctx, method, path, nil, body)
}

func (s *Server) proxyRequiredID(ctx context.Context, method, prefix string, args map[string]any, key, label string) (toolResult, error) {
	id := firstString(args, key)
	if id == "" {
		return errorResult(label+" required", nil), nil
	}
	return s.proxy(ctx, method, prefix+url.PathEscape(id), nil, nil)
}

func (s *Server) proxy(ctx context.Context, method, path string, query url.Values, body any) (toolResult, error) {
	token := s.currentSessionToken()
	payload, err := s.daemonJSONWithToken(ctx, method, path, query, body, token)
	if err != nil {
		return daemonToolError(err), nil
	}
	return successResult(payload), nil
}

func (s *Server) ensureSession(ctx context.Context) (map[string]any, error) {
	s.sessionMu.RLock()
	if s.sessionToken != "" {
		meta := cloneMap(s.sessionMeta)
		s.sessionMu.RUnlock()
		return meta, nil
	}
	s.sessionMu.RUnlock()
	if strings.TrimSpace(s.opts.OwnerToken) == "" {
		return nil, fmt.Errorf("Dock owner authorization is unavailable")
	}
	payload, err := s.daemonJSONWithToken(ctx, http.MethodPost, "/v4/local/agent-sessions", nil, map[string]any{
		"clientName": s.opts.ClientName,
	}, s.opts.OwnerToken)
	if err != nil {
		return nil, err
	}
	values, ok := payload.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("Dock returned an invalid session response")
	}
	token, _ := values["sessionKey"].(string)
	session, _ := values["session"].(map[string]any)
	sessionID, _ := session["sessionId"].(string)
	if strings.TrimSpace(token) == "" || strings.TrimSpace(sessionID) == "" {
		return nil, fmt.Errorf("Dock did not return a session credential")
	}
	meta := map[string]any{
		"sessionId":     sessionID,
		"baseUrl":       values["baseUrl"],
		"scopes":        session["scopes"],
		"idleExpiresAt": session["idleExpiresAt"],
		"expiresAt":     session["expiresAt"],
	}
	s.sessionMu.Lock()
	if s.sessionToken == "" {
		s.sessionID = sessionID
		s.sessionToken = token
		s.sessionMeta = cloneMap(meta)
	}
	meta = cloneMap(s.sessionMeta)
	s.sessionMu.Unlock()
	return meta, nil
}

func (s *Server) currentSessionToken() string {
	s.sessionMu.RLock()
	defer s.sessionMu.RUnlock()
	return s.sessionToken
}

func (s *Server) sessionHasScope(required string) bool {
	if strings.TrimSpace(required) == "" {
		return true
	}
	s.sessionMu.RLock()
	defer s.sessionMu.RUnlock()
	switch scopes := s.sessionMeta["scopes"].(type) {
	case []any:
		for _, raw := range scopes {
			if value, ok := raw.(string); ok && value == required {
				return true
			}
		}
	case []string:
		for _, value := range scopes {
			if value == required {
				return true
			}
		}
	}
	return false
}

func (s *Server) availableToolDefinitions() []toolDefinition {
	all := append(marketplaceToolDefinitions(), integrationToolDefinitions()...)
	available := make([]toolDefinition, 0, len(all))
	for _, definition := range all {
		if s.sessionHasScope(definition.RequiredScope) {
			available = append(available, definition)
		}
	}
	return available
}

func (s *Server) availableToolDefinition(name string) (toolDefinition, bool) {
	for _, definition := range s.availableToolDefinitions() {
		if definition.Name == strings.TrimSpace(name) {
			return definition, true
		}
	}
	return toolDefinition{}, false
}

func (s *Server) heartbeatSession(ctx context.Context) error {
	s.sessionMu.RLock()
	id, token := s.sessionID, s.sessionToken
	s.sessionMu.RUnlock()
	if id == "" || token == "" {
		return nil
	}
	_, err := s.daemonJSONWithToken(ctx, http.MethodPost, "/v4/local/agent-sessions/"+url.PathEscape(id)+"/heartbeat", nil, map[string]any{}, token)
	return err
}

func (s *Server) revokeSession(ctx context.Context) {
	s.sessionMu.Lock()
	id := s.sessionID
	s.sessionID, s.sessionToken, s.sessionMeta = "", "", nil
	s.sessionMu.Unlock()
	if id == "" || strings.TrimSpace(s.opts.OwnerToken) == "" {
		return
	}
	_, _ = s.daemonJSONWithToken(ctx, http.MethodDelete, "/v4/local/agent-sessions/"+url.PathEscape(id), nil, nil, s.opts.OwnerToken)
}

func cloneMap(source map[string]any) map[string]any {
	copy := make(map[string]any, len(source))
	for key, value := range source {
		copy[key] = value
	}
	return copy
}

func (s *Server) daemonJSONWithToken(ctx context.Context, method, path string, query url.Values, body any, token string) (any, error) {
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		timeout := 15 * time.Second
		if strings.Contains(path, "/invocations") && method == http.MethodPost {
			timeout = 75 * time.Second
		} else if method != http.MethodGet {
			timeout = 30 * time.Second
		}
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
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
		message := sanitizeMCPText(string(data))
		var payload map[string]any
		if json.Unmarshal(data, &payload) == nil {
			if value, ok := payload["error"].(string); ok && strings.TrimSpace(value) != "" {
				message = sanitizeMCPText(value)
			}
		}
		if message == "" {
			message = http.StatusText(resp.StatusCode)
		}
		return nil, &daemonHTTPError{StatusCode: resp.StatusCode, Message: message}
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
	healthCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(healthCtx, http.MethodGet, strings.TrimRight(baseURL, "/")+"/health", nil)
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
		tool("exora.search_operations", "Search Operations", "Search the authoritative V4 Operation catalog. Each result includes its parent API summary.", "market.read", readOnlyAnnotations(true), map[string]any{"q": stringProp("Search text.")}, nil),
		tool("exora.get_api", "Get API", "Read one API and all of its Operations.", "market.read", readOnlyAnnotations(false), map[string]any{"apiId": stringProp("API id.")}, []string{"apiId"}),
		tool("exora.estimate_operation", "Estimate Operation", "Estimate one Operation invocation without reserving funds. The response binds the current formula hash, identifies known and unknown metering variables, and reports the sample amount, mandatory cap and eventual reservation amount.", "market.read", readOnlyAnnotations(true), map[string]any{"apiId": stringProp("API id."), "operationId": stringProp("Operation id."), "input": objectProp("Operation input used for metering estimation.")}, []string{"apiId", "operationId"}),
		tool("exora.invoke_operation", "Invoke Operation", "Invoke a request/response, server-stream, or asynchronous Operation.", "api.invoke", writeAnnotations(true, true, true), map[string]any{"apiId": stringProp("API id."), "operationId": stringProp("Declared Operation id."), "input": objectProp("Operation input."), "inputArtifactIds": arrayProp("Uploaded input Artifact ids."), "idempotencyKey": stringProp("Stable retry key.")}, []string{"apiId", "operationId", "idempotencyKey"}),
		tool("exora.get_invocation", "Get Invocation", "Recover one buyer-owned Invocation, including its status, result and ready output Artifacts.", "api.invoke", readOnlyAnnotations(true), map[string]any{"invocationId": stringProp("Invocation id returned by exora.invoke_operation.")}, []string{"invocationId"}),
		tool("exora.get_job", "Get Job", "Read asynchronous Job state and progress.", "api.invoke", readOnlyAnnotations(true), map[string]any{"jobId": stringProp("Job id.")}, []string{"jobId"}),
		tool("exora.cancel_job", "Cancel Job", "Request cancellation of an asynchronous Job.", "api.invoke", writeAnnotations(true, true, true), map[string]any{"jobId": stringProp("Job id.")}, []string{"jobId"}),
		tool("exora.create_artifact_upload", "Create Artifact Upload", "Create a time-limited upload for a declared API input Artifact.", "api.invoke", writeAnnotations(false, false, true), map[string]any{"name": stringProp("Artifact name."), "mimeType": stringProp("MIME type."), "sizeBytes": integerProp("Exact byte size."), "sha256": stringProp("Exact SHA-256."), "purpose": stringProp("Declared purpose.")}, []string{"name", "mimeType", "sizeBytes", "sha256", "purpose"}),
		tool("exora.complete_artifact_upload", "Complete Artifact Upload", "Verify and seal an uploaded Artifact.", "api.invoke", writeAnnotations(false, true, true), map[string]any{"artifactId": stringProp("Artifact id.")}, []string{"artifactId"}),
		tool("exora.create_artifact_download_grant", "Create Artifact Download Grant", "Create a short-lived download URL for one ready buyer-owned output Artifact.", "api.invoke", writeAnnotations(false, false, true), map[string]any{"artifactId": stringProp("Ready output Artifact id returned by an Invocation or Job.")}, []string{"artifactId"}),
		tool("exora.get_ledger", "Get Ledger", "Read the account API ledger.", "account.read", readOnlyAnnotations(true), map[string]any{}, nil),
		deprecatedTool("exora.get_usage", "Get Usage (Deprecated)", "Deprecated compatibility alias for exora.get_ledger. Read the account API ledger.", "account.read", readOnlyAnnotations(true), map[string]any{}, nil, "exora.get_ledger"),
		tool("exora.list_api_orders", "List API Orders", "List this buyer account's V4 Operation Orders. Defaults to active orders.", "account.read", readOnlyAnnotations(true), map[string]any{"status": enumStringProp("Order status filter.", "active", "inactive", "all"), "limit": boundedIntegerProp("Maximum orders to return.", 1, 100), "cursor": stringProp("Opaque pagination cursor.")}, nil),
		tool("exora.get_api_order", "Get API Order", "Read one V4 Operation Order owned by this buyer account.", "account.read", readOnlyAnnotations(true), map[string]any{"apiOrderId": stringProp("API Order id.")}, []string{"apiOrderId"}),
		tool("exora.deactivate_api_order", "Deactivate API Order", "Immediately deactivate one V4 Operation Order. Repeated calls are idempotent.", "api.invoke", writeAnnotations(true, true, true), map[string]any{"apiOrderId": stringProp("API Order id.")}, []string{"apiOrderId"}),
		tool("exora.request_api_order_reactivation", "Request API Order Reactivation", "Create or return a pending human PIN approval for an inactive V4 Operation Order.", "api.invoke", writeAnnotations(false, true, true), map[string]any{"apiOrderId": stringProp("API Order id.")}, []string{"apiOrderId"}),
	}
}

func tool(name, title, description, requiredScope string, annotations map[string]any, properties map[string]any, required []string) toolDefinition {
	return toolDefinition{Name: name, Title: title, Description: description, InputSchema: strictObjectSchema(properties, required), Annotations: annotations, RequiredScope: requiredScope}
}

func deprecatedTool(name, title, description, requiredScope string, annotations map[string]any, properties map[string]any, required []string, replacement string) toolDefinition {
	definition := tool(name, title, description, requiredScope, annotations, properties, required)
	definition.Meta = map[string]any{"exora/deprecated": true, "exora/replacement": replacement}
	return definition
}

func readOnlyAnnotations(openWorld bool) map[string]any {
	return map[string]any{"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": openWorld}
}

func writeAnnotations(destructive, idempotent, openWorld bool) map[string]any {
	return map[string]any{"readOnlyHint": false, "destructiveHint": destructive, "idempotentHint": idempotent, "openWorldHint": openWorld}
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
type initializeParams struct {
	ProtocolVersion string `json:"protocolVersion"`
	ClientInfo      struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	} `json:"clientInfo"`
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
	Name          string         `json:"name"`
	Title         string         `json:"title,omitempty"`
	Description   string         `json:"description"`
	InputSchema   map[string]any `json:"inputSchema"`
	Annotations   map[string]any `json:"annotations,omitempty"`
	Meta          map[string]any `json:"_meta,omitempty"`
	RequiredScope string         `json:"-"`
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
	message = sanitizeMCPText(message)
	if data == nil {
		data = map[string]any{"error": message}
	}
	return toolResult{Content: []textContent{{Type: "text", Text: message}}, StructuredContent: data, IsError: true}
}

func daemonToolError(err error) toolResult {
	status := 0
	retryable := false
	code := "daemon_error"
	if value, ok := err.(*daemonHTTPError); ok {
		status = value.StatusCode
		retryable = status == http.StatusTooManyRequests || status >= 500
		code = "http_error"
	} else if errors.Is(err, context.Canceled) {
		code, retryable = "cancelled", true
	} else if errors.Is(err, context.DeadlineExceeded) {
		code, retryable = "timeout", true
	}
	message := sanitizeMCPText(err.Error())
	return errorResult(message, map[string]any{"error": map[string]any{"code": code, "message": message, "httpStatus": status, "retryable": retryable}})
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
func boundedIntegerProp(description string, minimum, maximum int) map[string]any {
	return map[string]any{"type": "integer", "minimum": minimum, "maximum": maximum, "description": description}
}
func boolProp(description string) map[string]any {
	return map[string]any{"type": "boolean", "description": description}
}
func objectProp(description string) map[string]any {
	return map[string]any{"type": "object", "description": description, "additionalProperties": true}
}
func arrayProp(description string) map[string]any {
	return map[string]any{"type": "array", "description": description, "items": map[string]any{}}
}

func validateSchemaValue(value any, schema map[string]any, path string) error {
	typeName, _ := schema["type"].(string)
	switch typeName {
	case "object":
		object, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be an object", path)
		}
		properties, _ := schema["properties"].(map[string]any)
		if required, ok := schema["required"].([]string); ok {
			for _, name := range required {
				if _, exists := object[name]; !exists {
					return fmt.Errorf("%s.%s is required", path, name)
				}
			}
		} else if rawRequired, ok := schema["required"].([]any); ok {
			for _, raw := range rawRequired {
				name, _ := raw.(string)
				if _, exists := object[name]; !exists {
					return fmt.Errorf("%s.%s is required", path, name)
				}
			}
		}
		additional, hasAdditional := schema["additionalProperties"].(bool)
		for name, child := range object {
			rawSchema, exists := properties[name]
			if !exists {
				if hasAdditional && !additional {
					return fmt.Errorf("%s.%s is not allowed", path, name)
				}
				continue
			}
			childSchema, _ := rawSchema.(map[string]any)
			if err := validateSchemaValue(child, childSchema, path+"."+name); err != nil {
				return err
			}
		}
	case "string":
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("%s must be a string", path)
		}
		if values, ok := schema["enum"].([]string); ok && len(values) > 0 {
			matched := false
			for _, candidate := range values {
				matched = matched || text == candidate
			}
			if !matched {
				return fmt.Errorf("%s has an unsupported value", path)
			}
		}
	case "integer":
		number, ok := value.(float64)
		if !ok || math.Trunc(number) != number {
			return fmt.Errorf("%s must be an integer", path)
		}
		if minimum, ok := schemaNumber(schema["minimum"]); ok && number < minimum {
			return fmt.Errorf("%s must be at least %v", path, minimum)
		}
		if maximum, ok := schemaNumber(schema["maximum"]); ok && number > maximum {
			return fmt.Errorf("%s must be at most %v", path, maximum)
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("%s must be a boolean", path)
		}
	case "array":
		items, ok := value.([]any)
		if !ok {
			return fmt.Errorf("%s must be an array", path)
		}
		itemSchema, _ := schema["items"].(map[string]any)
		if len(itemSchema) > 0 {
			for index, item := range items {
				if err := validateSchemaValue(item, itemSchema, fmt.Sprintf("%s[%d]", path, index)); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func schemaNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case float64:
		return typed, true
	default:
		return 0, false
	}
}
