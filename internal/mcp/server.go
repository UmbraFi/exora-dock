package mcp

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/discovery"
)

const protocolVersion = "2025-06-18"

type Options struct {
	ConfigPath     string
	BaseURL        string
	StartCommand   []string
	AgentToken     string
	ClientCWD      string
	ConnectionRole string
	ClientName     string
	HTTPClient     *http.Client
}

type Server struct {
	opts   Options
	client *http.Client
}

func NewServer(opts Options) *Server {
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
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
		resp := s.HandleJSON(ctx, line)
		if resp == nil {
			continue
		}
		if err := encoder.Encode(resp); err != nil {
			return err
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return nil
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
	isNotification := req.ID == nil
	switch req.Method {
	case "initialize":
		s.registerConnection(ctx)
		if isNotification {
			return nil
		}
		return rpcResult(req.ID, map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities": map[string]any{
				"tools": map[string]any{"listChanged": false},
			},
			"serverInfo": map[string]any{
				"name":    "exora-dock",
				"title":   "Exora Dock",
				"version": "0.1.0",
			},
			"instructions": "Use Exora Dock tools as a continuous task flow. For buyer work, call exora.run_buyer_work first; it searches suitable sellers, negotiates with the best candidates, creates a durable owner seller-choice plan from quoted sellers, and then stops for the owner choice. Include the copied workUid on every related request when the Dock prompt provides one; if the UID is not registered yet, also include the copied projectPath. If run_buyer_work returns pending negotiations, continue with resume_negotiation and create_order_plan_from_quote without making the user prompt each step. start_task_flow remains a realtime quote fallback. Never treat MCP tool invocation as user approval, seller selection, or payment consent.",
		})
	case "notifications/initialized":
		return nil
	case "ping":
		if isNotification {
			return nil
		}
		return rpcResult(req.ID, map[string]any{})
	case "tools/list":
		if isNotification {
			return nil
		}
		return rpcResult(req.ID, map[string]any{"tools": toolDefinitions()})
	case "tools/call":
		if isNotification {
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
		if isNotification {
			return nil
		}
		return rpcResult(req.ID, map[string]any{"resources": []any{}})
	case "prompts/list":
		if isNotification {
			return nil
		}
		return rpcResult(req.ID, map[string]any{"prompts": []any{}})
	default:
		if isNotification {
			return nil
		}
		return rpcError(req.ID, -32601, "Method not found", req.Method)
	}
}

func (s *Server) callTool(ctx context.Context, name string, args map[string]any) (toolResult, error) {
	switch name {
	case "exora.get_my_agent_card":
		return s.proxy(ctx, http.MethodGet, "/v1/agent-cards/mine", nil, nil)
	case "exora.search_agent_cards":
		query := url.Values{}
		copyStringArg(query, args, "role")
		if q := firstString(args, "q", "query"); q != "" {
			query.Set("q", q)
		}
		return s.proxy(ctx, http.MethodGet, "/v1/agent-cards/search", query, nil)
	case "exora.search_offers":
		query := url.Values{}
		copyStringArg(query, args, "type")
		copyStringArg(query, args, "q")
		copyStringArg(query, args, "provider")
		copyStringArg(query, args, "region")
		copyStringArg(query, args, "availability")
		copyAnyArg(query, args, "minVramGb")
		copyAnyArg(query, args, "minGpuCount")
		return s.proxy(ctx, http.MethodGet, "/v1/resources", query, nil)
	case "exora.find_sellers":
		body := cloneArgs(args)
		if err := s.injectWorkContext(body); err != nil {
			return workContextError(err), nil
		}
		setDefaultBool(body, "prepareOrderOptions", true)
		setDefaultBool(body, "createSelectionRequest", true)
		setDefaultNumber(body, "maxOptions", 5)
		setDefaultNumber(body, "maxResults", 5)
		return s.proxy(ctx, http.MethodPost, "/v1/agent/search-sellers", nil, body)
	case "exora.start_task_flow":
		body := cloneArgs(args)
		if err := s.injectWorkContext(body); err != nil {
			return workContextError(err), nil
		}
		setDefaultBool(body, "prepareOrderOptions", true)
		setDefaultBool(body, "createSelectionRequest", true)
		setDefaultBool(body, "requireRealtimeQuotes", true)
		setDefaultNumber(body, "maxOptions", 6)
		setDefaultNumber(body, "maxResults", 6)
		return s.proxy(ctx, http.MethodPost, "/v1/agent/search-sellers", nil, body)
	case "exora.run_buyer_work":
		body := cloneArgs(args)
		if err := s.injectWorkContext(body); err != nil {
			return workContextError(err), nil
		}
		setDefaultNumber(body, "maxCandidates", 3)
		setDefaultNumber(body, "maxOptions", 6)
		setDefaultNumber(body, "maxResults", 6)
		return s.proxy(ctx, http.MethodPost, "/v1/agent/buyer-work", nil, body)
	case "exora.negotiate_task":
		body := cloneArgs(args)
		if err := s.injectWorkContext(body); err != nil {
			return workContextError(err), nil
		}
		setDefaultNumber(body, "maxCandidates", 3)
		return s.proxy(ctx, http.MethodPost, "/v1/negotiations", nil, body)
	case "exora.list_negotiations":
		query := url.Values{}
		copyStringArg(query, args, "status")
		copyStringArg(query, args, "providerPubkey")
		copyStringArg(query, args, "requesterPubkey")
		copyStringArg(query, args, "orderPlanId")
		return s.proxy(ctx, http.MethodGet, "/v1/negotiations", query, nil)
	case "exora.get_negotiation":
		id := firstString(args, "negotiationId", "id")
		if id == "" {
			return errorResult("negotiationId required", nil), nil
		}
		return s.proxy(ctx, http.MethodGet, "/v1/negotiations/"+url.PathEscape(id), nil, nil)
	case "exora.resume_negotiation":
		id := firstString(args, "negotiationId", "id")
		if id == "" {
			return errorResult("negotiationId required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v1/negotiations/"+url.PathEscape(id)+"/resume", nil, map[string]any{})
	case "exora.create_order_plan_from_quote":
		body := cloneArgs(args)
		if err := s.injectWorkContext(body); err != nil {
			return workContextError(err), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v1/order-plans/from-negotiations", nil, body)
	case "exora.create_order_draft":
		body := cloneArgs(args)
		if err := s.injectWorkContext(body); err != nil {
			return workContextError(err), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v1/tasks", nil, body)
	case "exora.prepare_task_bundle":
		return s.prepareTaskBundle(ctx, args)
	case "exora.request_approval":
		return s.proxy(ctx, http.MethodPost, "/v1/approvals", nil, args)
	case "exora.get_order_status":
		id, err := requiredTaskID(args)
		if err != nil {
			return errorResult(err.Error(), nil), nil
		}
		return s.proxy(ctx, http.MethodGet, "/v1/tasks/"+url.PathEscape(id), nil, nil)
	case "exora.resume_order":
		id, err := requiredTaskID(args)
		if err != nil {
			return errorResult(err.Error(), nil), nil
		}
		result, err := s.proxy(ctx, http.MethodGet, "/v1/tasks/"+url.PathEscape(id), nil, nil)
		if err != nil || result.IsError {
			return result, err
		}
		return withNextAction(result), nil
	case "exora.list_pending_orders":
		return s.listPendingOrders(ctx, args)
	case "exora.list_order_plans":
		query := url.Values{}
		copyStringArg(query, args, "status")
		return s.proxy(ctx, http.MethodGet, "/v1/order-plans", query, nil)
	case "exora.get_order_plan", "exora.resume_task_flow":
		id := firstString(args, "planId", "orderPlanId", "id")
		if id == "" {
			return errorResult("planId required", nil), nil
		}
		result, err := s.proxy(ctx, http.MethodGet, "/v1/order-plans/"+url.PathEscape(id), nil, nil)
		if err != nil || result.IsError {
			return result, err
		}
		return withOrderPlanNextAction(result), nil
	case "exora.get_artifact_manifest":
		id, err := requiredTaskID(args)
		if err != nil {
			return errorResult(err.Error(), nil), nil
		}
		return s.proxy(ctx, http.MethodGet, "/v1/tasks/"+url.PathEscape(id)+"/artifacts", nil, nil)
	default:
		return toolResult{}, fmt.Errorf("Unknown tool: %s", name)
	}
}

func (s *Server) registerConnection(ctx context.Context) {
	projectPath := s.projectPath()
	body := map[string]any{
		"role":       s.connectionRole(),
		"cwd":        strings.TrimSpace(s.opts.ClientCWD),
		"source":     "mcp.stdio",
		"clientName": firstNonEmptyString(s.opts.ClientName, "MCP stdio client"),
	}
	if projectPath != "" {
		body["projectPath"] = projectPath
		body["projectName"] = filepath.Base(projectPath)
	}
	_, _ = s.daemonJSON(ctx, http.MethodPost, "/v1/mcp/connections", nil, body)
}

func (s *Server) injectProjectContext(body map[string]any) {
	if body == nil {
		return
	}
	if firstString(body, "projectPath") != "" {
		return
	}
	projectPath := s.projectPath()
	if projectPath == "" {
		return
	}
	body["projectPath"] = projectPath
	if template, ok := body["taskTemplate"].(map[string]any); ok {
		if firstString(template, "projectPath") == "" {
			template["projectPath"] = projectPath
		}
	}
	if draft, ok := body["draft"].(map[string]any); ok {
		if firstString(draft, "projectPath") == "" {
			draft["projectPath"] = projectPath
		}
	}
}

func (s *Server) injectWorkContext(body map[string]any) error {
	if body == nil {
		return nil
	}
	workUID := workUIDFromBody(body)
	projectPath := projectPathFromBody(body)
	if workUID != "" {
		body["workUid"] = workUID
		if projectPath == "" {
			projectPath = s.projectPathForWorkUID(workUID)
			if projectPath == "" {
				return fmt.Errorf("workUid %q is not registered with this Dock; include the projectPath copied from the Dock prompt on this MCP request", workUID)
			}
		} else {
			projectPath = cleanWorkProjectPath(projectPath)
			if projectPath == "" {
				return fmt.Errorf("projectPath must resolve to a local folder when workUid %q is provided", workUID)
			}
		}
		if err := s.ensureWorkProjectFolder(workUID, projectPath); err != nil {
			return err
		}
		body["projectPath"] = projectPath
	} else {
		s.injectProjectContext(body)
		if projectPath == "" {
			projectPath = firstString(body, "projectPath")
		}
	}
	for _, key := range []string{"taskTemplate", "draft"} {
		nested, ok := body[key].(map[string]any)
		if !ok {
			continue
		}
		if projectPath != "" {
			body["projectPath"] = projectPath
		}
		if projectPath != "" {
			nested["projectPath"] = projectPath
		}
		if workUID != "" {
			nested["workUid"] = workUID
		}
	}
	return nil
}

func workUIDFromBody(body map[string]any) string {
	if workUID := firstString(body, "workUid", "workUID", "uid"); workUID != "" {
		return workUID
	}
	for _, key := range []string{"taskTemplate", "draft"} {
		if nested, ok := body[key].(map[string]any); ok {
			if workUID := firstString(nested, "workUid", "workUID", "uid"); workUID != "" {
				return workUID
			}
		}
	}
	return ""
}

func projectPathFromBody(body map[string]any) string {
	if projectPath := firstString(body, "projectPath"); projectPath != "" {
		return projectPath
	}
	for _, key := range []string{"taskTemplate", "draft"} {
		if nested, ok := body[key].(map[string]any); ok {
			if projectPath := firstString(nested, "projectPath"); projectPath != "" {
				return projectPath
			}
		}
	}
	return ""
}

func (s *Server) projectPathForWorkUID(workUID string) string {
	workUID = strings.TrimSpace(workUID)
	if workUID == "" || strings.TrimSpace(s.opts.ConfigPath) == "" {
		return ""
	}
	configPath := s.opts.ConfigPath
	if abs, err := filepath.Abs(configPath); err == nil {
		configPath = abs
	}
	data, err := os.ReadFile(filepath.Join(filepath.Dir(configPath), "desktop-state.json"))
	if err != nil {
		return ""
	}
	var state struct {
		WorkMCPUIDs []struct {
			WorkUID     string `json:"workUid"`
			ProjectPath string `json:"projectPath"`
		} `json:"workMcpUids"`
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return ""
	}
	for _, item := range state.WorkMCPUIDs {
		if strings.TrimSpace(item.WorkUID) != workUID {
			continue
		}
		projectPath := strings.TrimSpace(item.ProjectPath)
		if projectPath == "" || !filepath.IsAbs(projectPath) {
			return ""
		}
		return filepath.Clean(projectPath)
	}
	return ""
}

func (s *Server) ensureWorkProjectFolder(workUID, projectPath string) error {
	workUID = strings.TrimSpace(workUID)
	projectPath = cleanWorkProjectPath(projectPath)
	if workUID == "" || projectPath == "" {
		return nil
	}
	if err := os.MkdirAll(projectPath, 0o755); err != nil {
		return fmt.Errorf("create work project folder %q: %w", projectPath, err)
	}
	statePath := s.desktopStatePath()
	if statePath == "" {
		return nil
	}
	state, err := readDesktopStateMap(statePath)
	if err != nil {
		return fmt.Errorf("read desktop work state: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	projectName := filepath.Base(projectPath)
	upsertWorkMCPUID(state, map[string]any{
		"workUid":     workUID,
		"projectPath": projectPath,
		"projectName": projectName,
		"createdAt":   now,
		"updatedAt":   now,
	})
	upsertProjectFolder(state, map[string]any{
		"name": projectName,
		"path": projectPath,
	})
	if err := writeDesktopStateMap(statePath, state); err != nil {
		return fmt.Errorf("write desktop work state: %w", err)
	}
	return nil
}

func (s *Server) desktopStatePath() string {
	configPath := strings.TrimSpace(s.opts.ConfigPath)
	if configPath == "" {
		return ""
	}
	if abs, err := filepath.Abs(configPath); err == nil {
		configPath = abs
	}
	return filepath.Join(filepath.Dir(configPath), "desktop-state.json")
}

func readDesktopStateMap(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	state := map[string]any{}
	if len(bytes.TrimSpace(data)) == 0 {
		return state, nil
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	return state, nil
}

func writeDesktopStateMap(path string, state map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func upsertWorkMCPUID(state map[string]any, entry map[string]any) {
	workUID := stringFromAny(entry["workUid"])
	projectPath := stringFromAny(entry["projectPath"])
	items := []any{entry}
	for _, item := range anySlice(state["workMcpUids"]) {
		existing, ok := item.(map[string]any)
		if !ok {
			items = append(items, item)
			continue
		}
		if stringFromAny(existing["workUid"]) == workUID {
			if createdAt := stringFromAny(existing["createdAt"]); createdAt != "" {
				entry["createdAt"] = createdAt
			}
			if task := stringFromAny(existing["task"]); task != "" {
				entry["task"] = task
			}
			continue
		}
		items = append(items, existing)
	}
	if len(items) > 100 {
		items = items[:100]
	}
	if projectPath != "" {
		entry["projectPath"] = projectPath
	}
	state["workMcpUids"] = items
}

func upsertProjectFolder(state map[string]any, entry map[string]any) {
	projectPath := stringFromAny(entry["path"])
	if projectPath == "" {
		return
	}
	items := []any{}
	found := false
	for _, item := range anySlice(state["projectFolders"]) {
		existing, ok := item.(map[string]any)
		if !ok {
			items = append(items, item)
			continue
		}
		if sameCleanPath(stringFromAny(existing["path"]), projectPath) {
			if stringFromAny(existing["name"]) == "" {
				existing["name"] = entry["name"]
			}
			existing["path"] = projectPath
			found = true
		}
		items = append(items, existing)
	}
	if !found {
		items = append(items, entry)
	}
	state["projectFolders"] = items
}

func cleanWorkProjectPath(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if abs, err := filepath.Abs(trimmed); err == nil {
		trimmed = abs
	}
	return filepath.Clean(trimmed)
}

func sameCleanPath(left, right string) bool {
	left = filepath.Clean(strings.TrimSpace(left))
	right = filepath.Clean(strings.TrimSpace(right))
	if left == "." || right == "." {
		return left == right
	}
	if os.PathSeparator == '\\' {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func anySlice(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []map[string]any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, item)
		}
		return out
	default:
		return nil
	}
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return ""
	}
}

func (s *Server) projectPath() string {
	if s.connectionRole() != "buyer" {
		return ""
	}
	cwd := strings.TrimSpace(s.opts.ClientCWD)
	if cwd == "" {
		return ""
	}
	abs, err := filepath.Abs(cwd)
	if err != nil {
		return ""
	}
	return filepath.Clean(abs)
}

func (s *Server) connectionRole() string {
	role := strings.ToLower(strings.TrimSpace(s.opts.ConnectionRole))
	if role == "seller" || role == "provider" {
		return role
	}
	return "buyer"
}

func (s *Server) prepareTaskBundle(ctx context.Context, args map[string]any) (toolResult, error) {
	manifest := map[string]any{
		"generatedAt": time.Now().UTC().Format(time.RFC3339),
		"format":      "exora-task-bundle-manifest/v1",
	}
	if id := firstString(args, "taskId", "orderId"); id != "" {
		result, err := s.proxy(ctx, http.MethodGet, "/v1/tasks/"+url.PathEscape(id), nil, nil)
		if err != nil || result.IsError {
			return result, err
		}
		if wrapped, ok := result.StructuredContent.(map[string]any); ok {
			if taskValue, ok := wrapped["task"].(map[string]any); ok {
				manifest["taskId"] = id
				copyMapValue(manifest, taskValue, "inputFiles")
				copyMapValue(manifest, taskValue, "privacyPolicy")
				copyMapValue(manifest, taskValue, "retentionPolicy")
				copyMapValue(manifest, taskValue, "expectedOutputs")
			}
		}
	} else {
		copyMapValue(manifest, args, "inputFiles")
		copyMapValue(manifest, args, "privacyPolicy")
		copyMapValue(manifest, args, "retentionPolicy")
		copyMapValue(manifest, args, "expectedOutputs")
	}
	data, _ := json.Marshal(manifest)
	sum := sha256.Sum256(data)
	out := map[string]any{
		"manifest":          manifest,
		"inputManifestHash": fmt.Sprintf("%x", sum[:]),
	}
	return successResult(out), nil
}

func (s *Server) listPendingOrders(ctx context.Context, args map[string]any) (toolResult, error) {
	query := url.Values{}
	copyStringArg(query, args, "status")
	copyStringArg(query, args, "party")
	result, err := s.proxy(ctx, http.MethodGet, "/v1/tasks", query, nil)
	if err != nil || result.IsError {
		return result, err
	}
	payload, _ := result.StructuredContent.(map[string]any)
	tasks, _ := payload["tasks"].([]any)
	if query.Get("status") == "" {
		filtered := []any{}
		for _, item := range tasks {
			taskMap, ok := item.(map[string]any)
			if !ok {
				continue
			}
			status, _ := taskMap["status"].(string)
			if status != "completed" && status != "failed" {
				filtered = append(filtered, item)
			}
		}
		payload["tasks"] = filtered
	}

	approvalQuery := url.Values{}
	approvalQuery.Set("status", "pending")
	if value := firstString(args, "userPubkey", "user"); value != "" {
		approvalQuery.Set("userPubkey", value)
	}
	if value := firstString(args, "agentId"); value != "" {
		approvalQuery.Set("agentId", value)
	}
	approvals, approvalErr := s.proxy(ctx, http.MethodGet, "/v1/approvals", approvalQuery, nil)
	if approvalErr == nil && !approvals.IsError {
		if approvalPayload, ok := approvals.StructuredContent.(map[string]any); ok {
			payload["approvals"] = approvalPayload["approvals"]
		}
	}
	return successResult(payload), nil
}

func (s *Server) proxy(ctx context.Context, method, path string, query url.Values, body any) (toolResult, error) {
	payload, err := s.daemonJSON(ctx, method, path, query, body)
	if err != nil {
		return errorResult(err.Error(), nil), nil
	}
	return successResult(payload), nil
}

func (s *Server) daemonJSON(ctx context.Context, method, path string, query url.Values, body any) (any, error) {
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
	if strings.TrimSpace(s.opts.AgentToken) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(s.opts.AgentToken))
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("daemon returned %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	var decoded any
	if len(bytes.TrimSpace(data)) == 0 {
		decoded = map[string]any{}
	} else if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

func (s *Server) resolveDaemon(ctx context.Context) (string, error) {
	candidates := []string{}
	startCommand := s.opts.StartCommand
	if manifest, _, err := discovery.ReadFirst(); err == nil {
		if strings.TrimSpace(manifest.BaseURL) != "" {
			candidates = append(candidates, manifest.BaseURL)
		}
		if len(manifest.StartCommand) > 0 {
			startCommand = manifest.StartCommand
		}
	}
	if strings.TrimSpace(s.opts.BaseURL) != "" {
		candidates = append(candidates, s.opts.BaseURL)
	}
	for _, candidate := range uniqueStrings(candidates) {
		if s.healthOK(ctx, candidate) {
			return strings.TrimRight(candidate, "/"), nil
		}
	}
	if len(startCommand) > 0 {
		return "", fmt.Errorf("Exora Dock daemon is not reachable. Start it with: %s", strings.Join(startCommand, " "))
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
	return rpcResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &rpcErrorObject{Code: code, Message: message, Data: data},
	}
}

func successResult(value any) toolResult {
	data, _ := json.Marshal(value)
	return toolResult{
		Content:           []textContent{{Type: "text", Text: string(data)}},
		StructuredContent: value,
	}
}

func errorResult(message string, data any) toolResult {
	if data == nil {
		data = map[string]any{"error": message}
	}
	return toolResult{
		Content:           []textContent{{Type: "text", Text: message}},
		StructuredContent: data,
		IsError:           true,
	}
}

func workContextError(err error) toolResult {
	return errorResult(err.Error(), map[string]any{
		"error":   "work_context_error",
		"message": err.Error(),
	})
}

func withNextAction(result toolResult) toolResult {
	payload, ok := result.StructuredContent.(map[string]any)
	if !ok {
		return result
	}
	taskValue, _ := payload["task"].(map[string]any)
	status, _ := taskValue["status"].(string)
	next := "inspect_task"
	switch status {
	case "pending_quote":
		next = "wait_for_provider_quote"
	case "pending_consent":
		next = "request_human_approval"
	case "consented":
		next = "wait_for_provider_claim"
	case "claimed", "running":
		next = "wait_for_delivery"
	case "completed":
		next = "inspect_artifacts"
	case "failed":
		next = "review_failure"
	}
	payload["nextAction"] = next
	return successResult(payload)
}

func withOrderPlanNextAction(result toolResult) toolResult {
	payload, ok := result.StructuredContent.(map[string]any)
	if !ok {
		return result
	}
	planValue, _ := payload["orderPlan"].(map[string]any)
	status, _ := planValue["status"].(string)
	next := "inspect_order_plan"
	if action, _ := planValue["nextAction"].(string); strings.TrimSpace(action) != "" {
		next = action
	} else {
		switch status {
		case "pending_selection":
			next = "wait_for_user_to_select_realtime_quote"
		case "selected":
			next = "poll_provider_job_or_task_status"
		case "expired", "invalidated":
			next = "start_task_flow_again"
		}
	}
	payload["nextAction"] = next
	return successResult(payload)
}

func requiredTaskID(args map[string]any) (string, error) {
	if id := firstString(args, "taskId", "orderId", "id"); id != "" {
		return id, nil
	}
	return "", fmt.Errorf("taskId required")
}

func firstString(args map[string]any, names ...string) string {
	for _, name := range names {
		value, ok := args[name]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		case fmt.Stringer:
			if strings.TrimSpace(typed.String()) != "" {
				return strings.TrimSpace(typed.String())
			}
		}
	}
	return ""
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
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

func copyAnyArg(query url.Values, args map[string]any, name string) {
	value, ok := args[name]
	if !ok || value == nil {
		return
	}
	switch typed := value.(type) {
	case string:
		if strings.TrimSpace(typed) != "" {
			query.Set(name, strings.TrimSpace(typed))
		}
	case float64:
		query.Set(name, fmt.Sprintf("%.0f", typed))
	case int:
		query.Set(name, fmt.Sprintf("%d", typed))
	default:
		query.Set(name, fmt.Sprint(value))
	}
}

func copyMapValue(dst map[string]any, src map[string]any, key string) {
	if value, ok := src[key]; ok {
		dst[key] = value
	}
}

func cloneArgs(args map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range args {
		out[key] = value
	}
	return out
}

func setDefaultBool(args map[string]any, key string, value bool) {
	if _, ok := args[key]; !ok {
		args[key] = value
	}
}

func setDefaultNumber(args map[string]any, key string, value float64) {
	if _, ok := args[key]; !ok {
		args[key] = value
	}
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimRight(strings.TrimSpace(value), "/")
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func toolDefinitions() []toolDefinition {
	return []toolDefinition{
		{
			Name:        "exora.get_my_agent_card",
			Title:       "Get My Exora Agent Card",
			Description: "Read the local Dock buyer/seller Agent Cards and safe diagnostics summary. Secrets and owner tokens are not exposed.",
			InputSchema: objectSchema(map[string]any{}, nil),
		},
		{
			Name:        "exora.search_agent_cards",
			Title:       "Search Exora Agent Cards",
			Description: "Search seller or buyer Agent Cards through Exora Cloud when configured, falling back to local cards. Use this before offer search when matching agents.",
			InputSchema: objectSchema(map[string]any{
				"role":  stringProp("Optional role: buyer or seller."),
				"q":     stringProp("Optional free-text Agent Card search query."),
				"query": stringProp("Alias for q."),
			}, nil),
		},
		{
			Name:        "exora.search_offers",
			Title:       "Search Exora Offers",
			Description: "Search local Exora Dock capability listings. Use this before drafting a task.",
			InputSchema: objectSchema(map[string]any{
				"type":         stringProp("Optional resource type: vps, gpu, dataset, repository, project, or storage."),
				"q":            stringProp("Optional free-text query."),
				"provider":     stringProp("Optional provider public key."),
				"region":       stringProp("Optional region."),
				"availability": stringProp("Optional availability value."),
				"minVramGb":    numberProp("Optional minimum GPU VRAM in GB."),
				"minGpuCount":  numberProp("Optional minimum GPU count."),
			}, nil),
		},
		{
			Name:        "exora.find_sellers",
			Title:       "Find Exora Sellers",
			Description: "Parse a natural-language need, return ranked Exora seller candidates, prepare order options, and create a pending Dock-side seller selection. This does not approve or pay.",
			InputSchema: objectSchema(map[string]any{
				"query":                  stringProp("Natural-language request, for example: find servers with at least 20GB VRAM."),
				"workUid":                stringProp("Optional Work UID copied from the Dock Local agent via MCP prompt. Use it on every related request."),
				"projectPath":            stringProp("Optional project folder path. If omitted, Dock resolves it from workUid when possible."),
				"requesterPubkey":        stringProp("Optional requester/user public key."),
				"agentId":                stringProp("Optional agent identifier."),
				"constraints":            objectProp("Optional structured constraints such as type, minVramGb, minGpuCount, or region."),
				"maxResults":             numberProp("Optional maximum result count. MCP defaults to 5."),
				"prepareOrderOptions":    boolProp("Optional. Defaults to true for MCP so the Dock can prepare order draft options."),
				"createSelectionRequest": boolProp("Optional. Defaults to true for MCP so the Dock creates a pending seller choice."),
				"maxOptions":             numberProp("Optional number of prepared order options. MCP defaults to 5."),
				"taskTemplate":           objectProp("Optional task template merged into each generated order draft."),
			}, []string{"query"}),
		},
		{
			Name:        "exora.start_task_flow",
			Title:       "Start Exora Task Flow",
			Description: "Start the end-to-end server-to-Docker flow for a concrete task: market search, realtime provider quote requests, durable order plan, and next action. This does not approve, select, or pay.",
			InputSchema: objectSchema(map[string]any{
				"query":           stringProp("Concrete task or resource need, for example: rent a GPU server and run a Docker job."),
				"workUid":         stringProp("Optional Work UID copied from the Dock Local agent via MCP prompt. Use it on every related request."),
				"projectPath":     stringProp("Optional project folder path. If omitted, Dock resolves it from workUid when possible."),
				"requesterPubkey": stringProp("Optional requester/user public key. The Dock may replace this with the local signing wallet for realtime provider requests."),
				"agentId":         stringProp("Optional agent identifier."),
				"constraints":     objectProp("Optional structured constraints such as type, minVramGb, minGpuCount, or region."),
				"maxResults":      numberProp("Optional maximum result count. MCP defaults to 6."),
				"maxOptions":      numberProp("Optional number of providers to contact. MCP defaults to 6."),
				"taskTemplate":    objectProp("Optional task template. Put Docker settings under requirements.docker."),
			}, []string{"query"}),
		},
		{
			Name:        "exora.run_buyer_work",
			Title:       "Run Buyer Work",
			Description: "Negotiation-first buyer workflow: find suitable seller agents, negotiate with the best candidates, create an owner-selectable order plan from quoted sellers, and stop for owner choice. Include the copied workUid on every related request when provided by the Dock prompt.",
			InputSchema: objectSchema(map[string]any{
				"query":           stringProp("Concrete task or resource need."),
				"intent":          stringProp("Alias for query."),
				"workUid":         stringProp("Optional Work UID copied from the Dock Local agent via MCP prompt. Use it on every related request."),
				"projectPath":     stringProp("Optional project folder path. If omitted, Dock resolves it from workUid when possible."),
				"requesterPubkey": stringProp("Optional requester/user public key. The Dock may replace this with the local signing wallet."),
				"agentId":         stringProp("Optional buyer agent identifier."),
				"constraints":     objectProp("Optional structured constraints such as type, minVramGb, minGpuCount, or region."),
				"maxCandidates":   numberProp("Optional number of sellers to negotiate with. MCP defaults to 3."),
				"maxResults":      numberProp("Optional fallback search result count. MCP defaults to 6."),
				"maxOptions":      numberProp("Optional owner-selectable option count. MCP defaults to 6."),
				"taskTemplate":    objectProp("Optional task template. Put Docker settings under requirements.docker."),
			}, []string{"query"}),
		},
		{
			Name:        "exora.negotiate_task",
			Title:       "Negotiate Exora Task",
			Description: "Send signed discussion requests to candidate seller agents so each seller can return a formal quote or rejection before any order is created.",
			InputSchema: objectSchema(map[string]any{
				"intent":            stringProp("Concrete task intent. Alias: query."),
				"query":             stringProp("Concrete task intent. Alias for intent."),
				"workUid":           stringProp("Optional Work UID copied from the Dock Local agent via MCP prompt. Use it on every related request."),
				"projectPath":       stringProp("Optional project folder path. If omitted, Dock resolves it from workUid when possible."),
				"buyerAgentCardId":  stringProp("Optional buyer Agent Card id."),
				"sellerAgentCardId": stringProp("Optional seller Agent Card id when targeting one seller."),
				"requesterPubkey":   stringProp("Optional requester public key; the Dock may replace it with the local signing wallet."),
				"agentId":           stringProp("Optional buyer agent identifier."),
				"providerPubkey":    stringProp("Optional provider public key when targeting one seller."),
				"resourceId":        stringProp("Optional resource id when targeting one seller."),
				"providerEndpoint":  stringProp("Optional provider Dock endpoint when targeting one seller."),
				"constraints":       objectProp("Optional search constraints used when options are omitted."),
				"taskTemplate":      objectProp("Optional task template merged into generated order drafts."),
				"options":           arrayProp("Optional prepared order draft options from search_agent_cards or search_offers."),
				"maxCandidates":     numberProp("Optional number of sellers to negotiate with. MCP defaults to 3."),
			}, nil),
		},
		{
			Name:        "exora.list_negotiations",
			Title:       "List Exora Negotiations",
			Description: "List pre-order seller discussions with quote, rejection, manual-review, or pending status.",
			InputSchema: objectSchema(map[string]any{
				"status":          stringProp("Optional negotiation status."),
				"providerPubkey":  stringProp("Optional provider filter."),
				"requesterPubkey": stringProp("Optional requester filter."),
				"orderPlanId":     stringProp("Optional order plan filter."),
			}, nil),
		},
		{
			Name:        "exora.get_negotiation",
			Title:       "Get Exora Negotiation",
			Description: "Fetch a pre-order seller discussion by id.",
			InputSchema: objectSchema(map[string]any{"negotiationId": stringProp("Negotiation id.")}, []string{"negotiationId"}),
		},
		{
			Name:        "exora.resume_negotiation",
			Title:       "Resume Exora Negotiation",
			Description: "Refresh a pending negotiation from the provider and return its next action.",
			InputSchema: objectSchema(map[string]any{"negotiationId": stringProp("Negotiation id.")}, []string{"negotiationId"}),
		},
		{
			Name:        "exora.create_order_plan_from_quote",
			Title:       "Create Order Plan From Quote",
			Description: "Create a pending owner seller-selection order plan from quoted negotiations. This does not select, approve, or pay.",
			InputSchema: objectSchema(map[string]any{
				"negotiationIds": arrayProp("Quoted negotiation ids."),
				"query":          stringProp("Optional original task query."),
				"workUid":        stringProp("Optional Work UID copied from the Dock Local agent via MCP prompt. Use it on every related request."),
				"projectPath":    stringProp("Optional project folder path. If omitted, Dock resolves it from workUid when possible."),
			}, []string{"negotiationIds"}),
		},
		{
			Name:        "exora.create_order_draft",
			Title:       "Create Exora Order Draft",
			Description: "Create a capability task draft in the local Dock order ledger.",
			InputSchema: objectSchema(map[string]any{
				"requesterPubkey":   stringProp("Requester/user public key."),
				"agentId":           stringProp("Agent identifier."),
				"workUid":           stringProp("Optional Work UID copied from the Dock Local agent via MCP prompt. Use it on every related request."),
				"projectPath":       stringProp("Optional project folder path. If omitted, Dock resolves it from workUid when possible."),
				"type":              stringProp("Task type, for example compute.inference."),
				"goal":              stringProp("Human-readable task goal."),
				"intent":            objectProp("Structured task intent."),
				"requirements":      objectProp("Structured task requirements."),
				"inputFiles":        arrayProp("Task input file metadata."),
				"budget":            objectProp("Budget limit."),
				"timeoutSeconds":    numberProp("Task timeout in seconds."),
				"expectedOutputs":   arrayProp("Expected output names or formats."),
				"consentPolicy":     objectProp("Consent requirements."),
				"inputManifestHash": stringProp("Optional task bundle manifest hash."),
				"privacyPolicy":     objectProp("Optional privacy policy."),
				"retentionPolicy":   objectProp("Optional retention policy."),
			}, []string{"requesterPubkey", "agentId", "type", "goal"}),
		},
		{
			Name:        "exora.prepare_task_bundle",
			Title:       "Prepare Task Bundle Manifest",
			Description: "Generate a metadata-only task bundle manifest and hash. This tool does not read or package local files.",
			InputSchema: objectSchema(map[string]any{
				"taskId":          stringProp("Optional existing task id."),
				"inputFiles":      arrayProp("Input file metadata when taskId is omitted."),
				"expectedOutputs": arrayProp("Expected outputs when taskId is omitted."),
				"privacyPolicy":   objectProp("Optional privacy policy."),
				"retentionPolicy": objectProp("Optional retention policy."),
			}, nil),
		},
		{
			Name:        "exora.request_approval",
			Title:       "Request Human Approval",
			Description: "Create a human approval request for a task action. This does not approve the action.",
			InputSchema: objectSchema(map[string]any{
				"taskId":    stringProp("Task id requiring approval."),
				"action":    stringProp("Approval action, defaults to approve_quote."),
				"expiresAt": stringProp("Optional RFC3339 expiry."),
			}, []string{"taskId"}),
		},
		{
			Name:        "exora.get_order_status",
			Title:       "Get Order Status",
			Description: "Read a task/order ledger entry.",
			InputSchema: objectSchema(map[string]any{"taskId": stringProp("Task id.")}, []string{"taskId"}),
		},
		{
			Name:        "exora.resume_order",
			Title:       "Resume Order",
			Description: "Read a task/order ledger entry and include the next suggested protocol action.",
			InputSchema: objectSchema(map[string]any{"taskId": stringProp("Task id.")}, []string{"taskId"}),
		},
		{
			Name:        "exora.list_pending_orders",
			Title:       "List Pending Orders",
			Description: "List non-terminal task/order ledger entries and pending approval requests.",
			InputSchema: objectSchema(map[string]any{
				"party":      stringProp("Optional requester, provider, or agent filter for tasks."),
				"status":     stringProp("Optional task status filter."),
				"userPubkey": stringProp("Optional user filter for approvals."),
				"agentId":    stringProp("Optional agent filter for approvals."),
			}, nil),
		},
		{
			Name:        "exora.list_order_plans",
			Title:       "List Order Plans",
			Description: "List durable seller-selection/task-flow plans, including realtime provider candidate states.",
			InputSchema: objectSchema(map[string]any{
				"status": stringProp("Optional order plan status, for example pending_selection or selected."),
			}, nil),
		},
		{
			Name:        "exora.get_order_plan",
			Title:       "Get Order Plan",
			Description: "Fetch a durable seller-selection/task-flow plan with realtime candidate state and progress events.",
			InputSchema: objectSchema(map[string]any{"planId": stringProp("Order plan id.")}, []string{"planId"}),
		},
		{
			Name:        "exora.resume_task_flow",
			Title:       "Resume Task Flow",
			Description: "Resume a durable task flow/order plan and return the next suggested action.",
			InputSchema: objectSchema(map[string]any{"planId": stringProp("Order plan id.")}, []string{"planId"}),
		},
		{
			Name:        "exora.get_artifact_manifest",
			Title:       "Get Artifact Manifest",
			Description: "Fetch artifact metadata for a completed task.",
			InputSchema: objectSchema(map[string]any{"taskId": stringProp("Task id.")}, []string{"taskId"}),
		},
	}
}

func objectSchema(properties map[string]any, required []string) map[string]any {
	schema := map[string]any{
		"type":                 "object",
		"properties":           properties,
		"additionalProperties": true,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func stringProp(description string) map[string]any {
	return map[string]any{"type": "string", "description": description}
}

func numberProp(description string) map[string]any {
	return map[string]any{"type": "number", "description": description}
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
