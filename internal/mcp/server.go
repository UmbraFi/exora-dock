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
	"sort"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/discovery"
	"github.com/exora-dock/exora-dock/internal/runcapability"
)

const defaultBuyerQuestionFreedomHint = "If none of these suggestions fits, describe your concrete task, desired outcome, or materials you already have, and I will adapt the recommendation to your requirement."

const (
	protocolVersion   = "2025-06-18"
	workMCPLeaseTTL   = 5 * time.Minute
	workMCPLeaseLimit = 100
)

type Options struct {
	ConfigPath         string
	BaseURL            string
	StartCommand       []string
	AgentToken         string
	ProviderAgentToken string
	ClientCWD          string
	ConnectionRole     string
	ClientName         string
	HTTPClient         *http.Client
	LegacyMarket       bool
	AgentSessionID     string
	WorkUID            string
	ProjectPath        string
	TransactionID      string
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
		if !s.v2Surface() {
			s.registerConnection(ctx)
		}
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
			"instructions": s.instructions(),
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
		if s.v2Surface() {
			definitions := v2ToolDefinitions()
			if !s.v2Automation() {
				definitions = append(definitions, marketplaceToolDefinitions()...)
			}
			if !s.v2Automation() && s.sellerToolsEnabled(ctx) {
				definitions = append(definitions, sellerDraftToolDefinitions()...)
			}
			return rpcResult(req.ID, map[string]any{"tools": definitions})
		}
		return rpcResult(req.ID, map[string]any{"tools": s.toolDefinitions(ctx)})
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
	if s.interactiveSession() {
		locked, err := s.lockInteractiveWorkContext(args)
		if err != nil {
			return errorResult(err.Error(), nil), nil
		}
		args = locked
	}
	result, err := s.callToolInner(ctx, name, args)
	if s.interactiveSession() {
		s.recordSessionToolEvent(ctx, name, result, err)
	}
	return result, err
}

func (s *Server) callToolInner(ctx context.Context, name string, args map[string]any) (toolResult, error) {
	if s.interactiveSession() && s.connectionRole() == "buyer" && name != "exora.session_request_user_input" && name != "exora.session_submit_plan" {
		return errorResult("buyer interview phase only allows structured questions or local plan submission", nil), nil
	}
	if s.interactiveSession() {
		switch name {
		case "exora.session_request_user_input":
			question := firstString(args, "question")
			if question == "" {
				return errorResult("question required", nil), nil
			}
			if s.connectionRole() != "buyer" {
				return successResult(map[string]any{"recorded": true, "sessionId": s.opts.AgentSessionID, "waitingFor": "user", "question": question}), nil
			}
			inputType := firstString(args, "inputType")
			switch inputType {
			case "single_select", "multi_select":
			default:
				return errorResult("buyer questions must use single_select or multi_select", nil), nil
			}
			options := anySlice(args["options"])
			if len(options) < 2 || len(options) > 3 {
				return errorResult("buyer questions require exactly two or three suggested options", nil), nil
			}
			request := map[string]any{
				"id": firstString(args, "id"), "title": firstString(args, "title"), "question": question,
				"why": firstString(args, "why"), "inputType": inputType, "options": options,
				"allowCustom": true, "required": args["required"] != false,
				"placeholder": firstString(args, "placeholder"), "freedomHint": firstNonEmptyString(firstString(args, "freedomHint"), defaultBuyerQuestionFreedomHint),
			}
			return successResult(map[string]any{"recorded": true, "sessionId": s.opts.AgentSessionID, "waitingFor": "user", "request": request, "question": question}), nil
		case "exora.session_submit_plan":
			if s.connectionRole() != "buyer" {
				return toolResult{}, fmt.Errorf("Unknown session tool: %s", name)
			}
			plans, ok := args["plans"].(map[string]any)
			if !ok {
				return errorResult("plans object required", nil), nil
			}
			if err := validateBuyerPlanBundle(plans); err != nil {
				return errorResult(err.Error(), nil), nil
			}
			return successResult(map[string]any{"recorded": true, "sessionId": s.opts.AgentSessionID, "waitingFor": "plan_review", "plans": plans}), nil
		}
	}
	if isSellerDraftTool(name) {
		if s.interactiveSession() || s.v2Automation() || strings.TrimSpace(s.opts.ProviderAgentToken) == "" {
			return errorResult("seller draft tools are unavailable in this bound or restricted MCP session", nil), nil
		}
		if !s.sellerToolsEnabled(ctx) {
			return errorResult("seller draft tools are disabled until the owner completes seller automation setup", nil), nil
		}
		return s.callSellerDraftTool(ctx, name, args)
	}
	if s.v2Surface() && (!isMarketplaceTool(name) || s.v2Automation()) {
		if !s.v2Automation() {
			shortName := strings.TrimPrefix(strings.TrimSpace(name), "exora.")
			for _, allowed := range v2ToolShortNames {
				if shortName == allowed {
					return errorResult("run capability required", nil), nil
				}
			}
			return toolResult{}, fmt.Errorf("Unknown V2 tool: %s", name)
		}
		return s.callV2Tool(ctx, name, args)
	}
	switch name {
	case "exora.search_products":
		query := url.Values{}
		copyStringArg(query, args, "q")
		copyStringArg(query, args, "applicationSource")
		return s.proxy(ctx, http.MethodGet, "/v3/catalog/listings", query, nil)
	case "exora.get_product_manifest":
		listingID := firstString(args, "listingId")
		if listingID == "" {
			return errorResult("listingId required", nil), nil
		}
		return s.proxy(ctx, http.MethodGet, "/v3/catalog/listings/"+url.PathEscape(listingID), nil, nil)
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
		purchaseID := firstString(args, "purchaseId")
		if purchaseID == "" || firstString(args, "idempotencyKey") == "" {
			return errorResult("purchaseId and idempotencyKey required", nil), nil
		}
		body := cloneArgs(args)
		delete(body, "purchaseId")
		return s.proxy(ctx, http.MethodPost, "/v3/compute-purchases/"+url.PathEscape(purchaseID)+"/extend", nil, body)
	case "exora.purchase_download":
		if firstString(args, "listingId") == "" || firstString(args, "idempotencyKey") == "" {
			return errorResult("listingId and idempotencyKey required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v3/download-grants", nil, args)
	case "exora.create_download_transfer":
		grantID := firstString(args, "grantId")
		if grantID == "" {
			return errorResult("grantId required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v3/download-grants/"+url.PathEscape(grantID)+"/transfers", nil, map[string]any{})
	case "exora.invoke_operation":
		if firstString(args, "listingId") == "" || firstString(args, "operationId") == "" || firstString(args, "idempotencyKey") == "" {
			return errorResult("listingId, operationId, and idempotencyKey required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v3/invocations", nil, args)
	case "exora.get_lease":
		leaseID := firstString(args, "leaseId")
		if leaseID == "" {
			return errorResult("leaseId required", nil), nil
		}
		return s.proxy(ctx, http.MethodGet, "/v3/leases/"+url.PathEscape(leaseID), nil, nil)
	case "exora.release_lease":
		leaseID := firstString(args, "leaseId")
		if leaseID == "" {
			return errorResult("leaseId required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v3/leases/"+url.PathEscape(leaseID)+"/release", nil, map[string]any{})
	case "exora.get_usage":
		if leaseID := firstString(args, "leaseId"); leaseID != "" {
			return s.proxy(ctx, http.MethodGet, "/v3/leases/"+url.PathEscape(leaseID), nil, nil)
		}
		return s.proxy(ctx, http.MethodGet, "/v3/ledger", nil, nil)
	case "exora.save_api_bridge_draft":
		// Deliberately forwards only the public draft schema. Provider credentials,
		// seller attestation, listing creation, and publishing are UI-only actions.
		body := cloneArgs(args)
		for _, forbidden := range []string{"secret", "providerSecret", "sellerAttestationConfirmed", "publish", "status"} {
			delete(body, forbidden)
		}
		return s.proxy(ctx, http.MethodPost, "/v3/provider/api-bridge-drafts", nil, body)
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
		injectExternalWorkRunContext(body)
		setDefaultBool(body, "prepareOrderOptions", true)
		setDefaultBool(body, "createSelectionRequest", true)
		setDefaultNumber(body, "maxOptions", 5)
		setDefaultNumber(body, "maxResults", 5)
		result, err := s.proxy(ctx, http.MethodPost, "/v1/agent/search-sellers", nil, body)
		return s.withWorkRunCheckpoint(ctx, args, "find_sellers", result, err)
	case "exora.start_task_flow":
		body := cloneArgs(args)
		if err := s.injectWorkContext(body); err != nil {
			return workContextError(err), nil
		}
		injectExternalWorkRunContext(body)
		setDefaultBool(body, "prepareOrderOptions", true)
		setDefaultBool(body, "createSelectionRequest", true)
		setDefaultBool(body, "requireRealtimeQuotes", true)
		setDefaultNumber(body, "maxOptions", 6)
		setDefaultNumber(body, "maxResults", 6)
		result, err := s.proxy(ctx, http.MethodPost, "/v1/agent/search-sellers", nil, body)
		return s.withWorkRunCheckpoint(ctx, args, "start_task_flow", result, err)
	case "exora.run_buyer_work":
		body := cloneArgs(args)
		if err := s.injectWorkContext(body); err != nil {
			return workContextError(err), nil
		}
		injectExternalWorkRunContext(body)
		setDefaultNumber(body, "maxCandidates", 3)
		setDefaultNumber(body, "maxOptions", 6)
		setDefaultNumber(body, "maxResults", 6)
		result, err := s.proxy(ctx, http.MethodPost, "/v1/agent/buyer-work", nil, body)
		return s.withWorkRunCheckpoint(ctx, args, "run_buyer_work", result, err)
	case "exora.negotiate_task":
		body := cloneArgs(args)
		if err := s.injectWorkContext(body); err != nil {
			return workContextError(err), nil
		}
		injectExternalWorkRunContext(body)
		setDefaultNumber(body, "maxCandidates", 3)
		result, err := s.proxy(ctx, http.MethodPost, "/v1/negotiations", nil, body)
		return s.withWorkRunCheckpoint(ctx, args, "negotiate_task", result, err)
	case "exora.list_negotiations":
		query := url.Values{}
		copyStringArg(query, args, "status")
		copyStringArg(query, args, "providerPubkey")
		copyStringArg(query, args, "requesterPubkey")
		copyStringArg(query, args, "orderPlanId")
		result, err := s.proxy(ctx, http.MethodGet, "/v1/negotiations", query, nil)
		return s.withWorkRunCheckpoint(ctx, args, "compare_quotes", result, err)
	case "exora.get_negotiation":
		id := firstString(args, "negotiationId", "id")
		if id == "" {
			return errorResult("negotiationId required", nil), nil
		}
		result, err := s.proxy(ctx, http.MethodGet, "/v1/negotiations/"+url.PathEscape(id), nil, nil)
		return s.withWorkRunCheckpoint(ctx, args, "compare_quotes", result, err)
	case "exora.resume_negotiation":
		id := firstString(args, "negotiationId", "id")
		if id == "" {
			return errorResult("negotiationId required", nil), nil
		}
		result, err := s.proxy(ctx, http.MethodPost, "/v1/negotiations/"+url.PathEscape(id)+"/resume", nil, map[string]any{})
		return s.withWorkRunCheckpoint(ctx, args, "negotiate_task", result, err)
	case "exora.create_order_plan_from_quote":
		body := cloneArgs(args)
		if err := s.injectWorkContext(body); err != nil {
			return workContextError(err), nil
		}
		injectExternalWorkRunContext(body)
		result, err := s.proxy(ctx, http.MethodPost, "/v1/order-plans/from-negotiations", nil, body)
		return s.withWorkRunCheckpoint(ctx, args, "create_order_plan", result, err)
	case "exora.create_order_draft":
		body := cloneArgs(args)
		if err := s.injectWorkContext(body); err != nil {
			return workContextError(err), nil
		}
		injectExternalWorkRunContext(body)
		result, err := s.proxy(ctx, http.MethodPost, "/v1/tasks", nil, body)
		return s.withWorkRunCheckpoint(ctx, args, "request_approval", result, err)
	case "exora.prepare_task_bundle":
		return s.prepareTaskBundle(ctx, args)
	case "exora.request_approval":
		body := cloneArgs(args)
		injectExternalWorkRunContext(body)
		result, err := s.proxy(ctx, http.MethodPost, "/v1/approvals", nil, body)
		return s.withWorkRunCheckpoint(ctx, args, "request_approval", result, err)
	case "exora.find_payment_evidence":
		paymentID, err := s.paymentIDFromArgs(ctx, args)
		if err != nil {
			return errorResult(err.Error(), nil), nil
		}
		result, err := s.proxy(ctx, http.MethodGet, "/v1/payments/"+url.PathEscape(paymentID)+"/evidence", nil, nil)
		return s.withWorkRunCheckpoint(ctx, args, "verify_payment_evidence", result, err)
	case "exora.sync_payment_evidence":
		paymentID, err := s.paymentIDFromArgs(ctx, args)
		if err != nil {
			return errorResult(err.Error(), nil), nil
		}
		body := cloneArgs(args)
		result, err := s.proxy(ctx, http.MethodPost, "/v1/payments/"+url.PathEscape(paymentID)+"/chain/evidence", nil, body)
		return s.withWorkRunCheckpoint(ctx, args, "sync_payment_evidence", result, err)
	case "exora.get_order_status":
		id, err := requiredTaskID(args)
		if err != nil {
			return errorResult(err.Error(), nil), nil
		}
		result, err := s.proxy(ctx, http.MethodGet, "/v1/tasks/"+url.PathEscape(id), nil, nil)
		return s.withWorkRunCheckpoint(ctx, args, "poll_worker_job", result, err)
	case "exora.resume_order":
		id, err := requiredTaskID(args)
		if err != nil {
			return errorResult(err.Error(), nil), nil
		}
		result, err := s.proxy(ctx, http.MethodGet, "/v1/tasks/"+url.PathEscape(id), nil, nil)
		if err != nil || result.IsError {
			return result, err
		}
		result = withNextAction(result)
		return s.withWorkRunCheckpoint(ctx, args, "poll_worker_job", result, nil)
	case "exora.list_pending_orders":
		result, err := s.listPendingOrders(ctx, args)
		return s.withWorkRunCheckpoint(ctx, args, "poll_worker_job", result, err)
	case "exora.list_order_plans":
		query := url.Values{}
		copyStringArg(query, args, "status")
		result, err := s.proxy(ctx, http.MethodGet, "/v1/order-plans", query, nil)
		return s.withWorkRunCheckpoint(ctx, args, "wait_owner_seller_choice", result, err)
	case "exora.get_order_plan", "exora.resume_task_flow":
		id := firstString(args, "planId", "orderPlanId", "id")
		if id == "" {
			return errorResult("planId required", nil), nil
		}
		result, err := s.proxy(ctx, http.MethodGet, "/v1/order-plans/"+url.PathEscape(id), nil, nil)
		if err != nil || result.IsError {
			return result, err
		}
		result = withOrderPlanNextAction(result)
		return s.withWorkRunCheckpoint(ctx, args, "wait_owner_seller_choice", result, nil)
	case "exora.get_artifact_manifest":
		id, err := requiredTaskID(args)
		if err != nil {
			return errorResult(err.Error(), nil), nil
		}
		result, err := s.proxy(ctx, http.MethodGet, "/v1/tasks/"+url.PathEscape(id)+"/artifacts", nil, nil)
		return s.withWorkRunCheckpoint(ctx, args, "fetch_artifacts", result, err)
	case "exora.get_work_checkpoint":
		return s.getWorkCheckpoint(ctx, args)
	case "exora.resume_work_run":
		return s.resumeWorkRun(ctx, args)
	case "exora.stop_work_run":
		return s.stopWorkRun(ctx, args)
	default:
		return toolResult{}, fmt.Errorf("Unknown tool: %s", name)
	}
}

func (s *Server) v2Automation() bool {
	return runcapability.IsToken(s.opts.AgentToken)
}

func (s *Server) v2Surface() bool {
	if s.interactiveSession() && !s.v2Automation() {
		return false
	}
	return !s.opts.LegacyMarket || s.v2Automation()
}

func (s *Server) interactiveSession() bool { return strings.TrimSpace(s.opts.AgentSessionID) != "" }

func (s *Server) instructions() string {
	if s.v2Automation() {
		return "This MCP connection is bound to one Exora AutomationRun. Call exora.claim_run first. Read transaction state and allowed actions before proposing a mutation. Every mutation requires runId, expectedStateVersion, and a stable idempotencyKey. A tool result never grants human approval, moves funds, reveals credentials, or expands workspace access."
	}
	if s.v2Surface() {
		return "This is the Exora V2 AutomationRun MCP surface. The listed tools require a short-lived run capability issued by Dock Supervisor; restart this MCP server through a claimed AutomationRun. No tool grants human approval, moves funds, reveals credentials, or expands workspace access."
	}
	if s.interactiveSession() {
		if s.connectionRole() == "buyer" {
			return "This MCP connection is locked to Exora buyer interview session " + s.opts.AgentSessionID + " and Work UID " + s.opts.WorkUID + ". Before a plan is reviewed, your only purpose is to learn exactly what the user wants to buy. End every turn with exactly one structured action: call exora.session_request_user_input for the next necessary question, or call exora.session_submit_plan once the requirements are mature. Every question must first offer exactly two or three reasonable, context-specific answer options, then preserve a separate free-form path through allowCustom and freedomHint. Use single_select by default and multi_select only when answers can genuinely coexist. Do not use an option slot for Other or Not sure because the custom input already covers that path. Do not search sellers, request quotes, create manifests, start remote work, request approval, or discuss payment. The Dock rejects another workUid or projectPath."
		}
		return "This MCP connection is locked to Exora chat session " + s.opts.AgentSessionID + " and Work UID " + s.opts.WorkUID + ". Use Exora session tools for structured progress and questions. The Dock rejects another workUid or projectPath. Ordinary chat text cannot change transaction state. Never request payment PINs, private keys, owner tokens, model credentials, or arbitration authority."
	}
	return "Use Exora Dock tools as a continuous task flow. For buyer work, call exora.run_buyer_work first; it is plan-first. It classifies the request, stops for clarification or local plan confirmation when needed, writes .exora/agent-plans/<plan_id>/ files only after confirmation, and requires Dock owner approval of submit_remote_task_manifest before seller matching or quoting. Include the copied workUid on every related request when the Dock prompt provides one; if the UID is not registered yet, also include the copied projectPath. Preserve and pass the returned resumeJson or runId on every follow-up so each step can checkpoint and resume through JSON. Calls with workUid mark that Work as actively controlled by this external MCP agent for a short renewable lease so the built-in Dock buyer composer does not race the same task. Do not call exora.negotiate_task as the default path for an unreviewed manifest; use it only as a low-level compatibility tool after the owner has approved an equivalent manifest. Never approve, select, pay, reveal credentials, or call Docker directly."
}

func (s *Server) callV2Tool(ctx context.Context, name string, args map[string]any) (toolResult, error) {
	shortName := strings.TrimPrefix(strings.TrimSpace(name), "exora.")
	switch shortName {
	case "claim_run":
		if unknown := unknownArguments(args, "runId"); len(unknown) > 0 {
			return errorResult("unsupported arguments: "+strings.Join(unknown, ", "), nil), nil
		}
		runID := firstString(args, "runId")
		if runID == "" {
			return errorResult("runId required", nil), nil
		}
		return s.proxy(ctx, http.MethodPost, "/v1/automation-runs/"+url.PathEscape(runID)+"/claim", nil, map[string]any{})
	case "get_transaction_state":
		if unknown := unknownArguments(args, "transactionId"); len(unknown) > 0 {
			return errorResult("unsupported arguments: "+strings.Join(unknown, ", "), nil), nil
		}
		transactionID := firstString(args, "transactionId")
		if transactionID == "" {
			return errorResult("transactionId required", nil), nil
		}
		return s.proxy(ctx, http.MethodGet, "/v1/automation/transactions/"+url.PathEscape(transactionID), nil, nil)
	case "get_allowed_actions":
		if unknown := unknownArguments(args, "transactionId"); len(unknown) > 0 {
			return errorResult("unsupported arguments: "+strings.Join(unknown, ", "), nil), nil
		}
		transactionID := firstString(args, "transactionId")
		if transactionID == "" {
			return errorResult("transactionId required", nil), nil
		}
		return s.proxy(ctx, http.MethodGet, "/v1/automation/transactions/"+url.PathEscape(transactionID)+"/allowed-actions", nil, nil)
	case "search_agent_cards":
		if unknown := unknownArguments(args, "query", "role"); len(unknown) > 0 {
			return errorResult("unsupported arguments: "+strings.Join(unknown, ", "), nil), nil
		}
		query := url.Values{}
		copyStringArg(query, args, "role")
		if value := firstString(args, "query"); value != "" {
			query.Set("query", value)
		}
		return s.proxy(ctx, http.MethodGet, "/v1/automation/agent-cards/search", query, nil)
	case "report_progress", "request_user_input", "request_approval", "propose_transition", "submit_offer", "submit_deliverable", "report_blocked", "finish_run":
		if unknown := unknownArguments(args, "runId", "expectedStateVersion", "idempotencyKey", "payload"); len(unknown) > 0 {
			return errorResult("unsupported arguments: "+strings.Join(unknown, ", "), nil), nil
		}
		runID := firstString(args, "runId")
		idempotencyKey := firstString(args, "idempotencyKey")
		expected, ok := requiredInt64(args, "expectedStateVersion")
		if runID == "" || idempotencyKey == "" || !ok {
			return errorResult("runId, expectedStateVersion and idempotencyKey are required", nil), nil
		}
		payload := map[string]any{}
		if explicit, supplied := args["payload"]; supplied {
			mapped, ok := explicit.(map[string]any)
			if !ok {
				return errorResult("payload must be an object", nil), nil
			}
			payload = cloneArgs(mapped)
		}
		body := map[string]any{
			"type": shortName, "expectedStateVersion": expected,
			"idempotencyKey": idempotencyKey, "payload": payload,
		}
		return s.proxy(ctx, http.MethodPost, "/v1/automation-runs/"+url.PathEscape(runID)+"/actions", nil, body)
	default:
		return toolResult{}, fmt.Errorf("Unknown V2 automation tool: %s", name)
	}
}

func unknownArguments(args map[string]any, allowed ...string) []string {
	allow := make(map[string]struct{}, len(allowed))
	for _, name := range allowed {
		allow[name] = struct{}{}
	}
	unknown := make([]string, 0)
	for name := range args {
		if _, ok := allow[name]; !ok {
			unknown = append(unknown, name)
		}
	}
	sort.Strings(unknown)
	return unknown
}

func requiredInt64(args map[string]any, key string) (int64, bool) {
	value, ok := args[key]
	if !ok {
		return 0, false
	}
	switch typed := value.(type) {
	case float64:
		converted := int64(typed)
		return converted, float64(converted) == typed && typed >= 0
	case float32:
		converted := int64(typed)
		return converted, float32(converted) == typed && typed >= 0
	case int:
		return int64(typed), typed >= 0
	case int64:
		return typed, typed >= 0
	case json.Number:
		converted, err := typed.Int64()
		return converted, err == nil && converted >= 0
	default:
		return 0, false
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

func injectExternalWorkRunContext(body map[string]any) {
	if body == nil {
		return
	}
	if firstString(body, "controller") == "" {
		body["controller"] = "external-mcp"
	}
	if firstString(body, "runId") == "" {
		if runID := stringFromNestedMap(body, "resumeJson", "runId"); runID != "" {
			body["runId"] = runID
		}
	}
	if firstString(body, "workUid") == "" {
		if workUID := stringFromNestedMap(body, "resumeJson", "workUid"); workUID != "" {
			body["workUid"] = workUID
		}
	}
	if firstString(body, "projectPath") == "" {
		if projectPath := stringFromNestedMap(body, "resumeJson", "projectPath"); projectPath != "" {
			body["projectPath"] = projectPath
		}
	}
}

func (s *Server) withWorkRunCheckpoint(ctx context.Context, args map[string]any, step string, result toolResult, err error) (toolResult, error) {
	if err != nil || result.IsError {
		return result, err
	}
	payload, ok := result.StructuredContent.(map[string]any)
	if !ok {
		return result, nil
	}
	if _, ok := payload["resumeJson"]; ok {
		_ = s.bindWorkRunLease(args, payload)
		return result, nil
	}
	runID, shouldRecord, resolveErr := s.resolveWorkRunID(ctx, args)
	if resolveErr != nil {
		if workRunEndpointUnavailable(resolveErr) {
			payload["workRunError"] = resolveErr.Error()
			return successResult(payload), nil
		}
		return workContextError(resolveErr), nil
	}
	if !shouldRecord {
		return result, nil
	}
	body := map[string]any{
		"controller":  "external-mcp",
		"currentStep": step,
		"nextAction":  stringFromAny(payload["nextAction"]),
		"summary":     stringFromAny(payload["summary"]),
		"result":      payload,
	}
	if intent := firstString(args, "intent", "query", "q"); intent != "" {
		body["intent"] = intent
	}
	if workUID := workUIDFromBody(args); workUID != "" {
		body["workUid"] = workUID
	}
	if projectPath := projectPathFromBody(args); projectPath != "" {
		body["projectPath"] = projectPath
	}
	if resume, ok := args["resumeJson"].(map[string]any); ok {
		body["resumeJson"] = resume
	}
	recorded, recordErr := s.daemonJSON(ctx, http.MethodPost, "/v1/work-runs/"+url.PathEscape(runID)+"/resume", nil, body)
	if recordErr != nil {
		payload["workRunError"] = recordErr.Error()
		return successResult(payload), nil
	}
	if recordedMap, ok := recorded.(map[string]any); ok {
		for _, key := range []string{"workRun", "checkpoint", "resumeJson"} {
			if value, exists := recordedMap[key]; exists {
				payload[key] = value
			}
		}
	}
	_ = s.bindWorkRunLease(args, payload)
	return successResult(payload), nil
}

func workRunEndpointUnavailable(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "404") || strings.Contains(text, "not found")
}

func (s *Server) bindWorkRunLease(args map[string]any, payload map[string]any) error {
	statePath := s.desktopStatePath()
	if statePath == "" {
		return nil
	}
	workUID := firstNonEmptyString(workUIDFromBody(args), stringFromAny(payload["workUid"]))
	runID := ""
	checkpointID := ""
	status := ""
	step := ""
	if run, ok := payload["workRun"].(map[string]any); ok {
		workUID = firstNonEmptyString(workUID, stringFromAny(run["workUid"]))
		runID = stringFromAny(run["runId"])
		status = stringFromAny(run["status"])
		step = stringFromAny(run["currentStep"])
	}
	if resume, ok := payload["resumeJson"].(map[string]any); ok {
		workUID = firstNonEmptyString(workUID, stringFromAny(resume["workUid"]))
		runID = firstNonEmptyString(runID, stringFromAny(resume["runId"]))
		checkpointID = stringFromAny(resume["checkpointId"])
		status = firstNonEmptyString(status, stringFromAny(resume["status"]))
		step = firstNonEmptyString(step, stringFromAny(resume["currentStep"]))
	}
	if checkpoint, ok := payload["checkpoint"].(map[string]any); ok {
		checkpointID = firstNonEmptyString(checkpointID, stringFromAny(checkpoint["checkpointId"]))
		status = firstNonEmptyString(status, stringFromAny(checkpoint["status"]))
		step = firstNonEmptyString(step, stringFromAny(checkpoint["currentStep"]))
	}
	if workUID == "" || runID == "" {
		return nil
	}
	state, err := readDesktopStateMap(statePath)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	changed := false
	items := []any{}
	for _, item := range anySlice(state["workMcpLeases"]) {
		lease, ok := item.(map[string]any)
		if !ok {
			items = append(items, item)
			continue
		}
		if stringFromAny(lease["workUid"]) == workUID {
			lease["runId"] = runID
			if checkpointID != "" {
				lease["checkpointId"] = checkpointID
			}
			if status != "" {
				lease["workRunStatus"] = status
			}
			if step != "" {
				lease["currentStep"] = step
			}
			lease["updatedAt"] = now
			changed = true
		}
		items = append(items, lease)
	}
	if !changed {
		return nil
	}
	state["workMcpLeases"] = items
	return writeDesktopStateMap(statePath, state)
}

func (s *Server) resolveWorkRunID(ctx context.Context, args map[string]any) (string, bool, error) {
	runID := firstString(args, "runId")
	if runID == "" {
		runID = stringFromNestedMap(args, "resumeJson", "runId")
	}
	workUID := workUIDFromBody(args)
	projectPath := projectPathFromBody(args)
	if runID != "" {
		return runID, true, nil
	}
	if workUID == "" && projectPath == "" {
		return "", false, nil
	}
	if workUID != "" {
		query := url.Values{}
		query.Set("workUid", workUID)
		if listed, err := s.daemonJSON(ctx, http.MethodGet, "/v1/work-runs", query, nil); err == nil {
			if payload, ok := listed.(map[string]any); ok {
				for _, item := range anySlice(payload["workRuns"]) {
					if run, ok := item.(map[string]any); ok {
						if id := stringFromAny(run["runId"]); id != "" {
							return id, true, nil
						}
					}
				}
			}
		}
		if projectPath == "" {
			return "", true, fmt.Errorf("workUid %q has no WorkRun yet; include the copied projectPath or call exora.run_buyer_work first", workUID)
		}
	}
	createBody := map[string]any{
		"workUid":     workUID,
		"projectPath": projectPath,
		"controller":  "external-mcp",
		"intent":      firstString(args, "intent", "query", "q"),
		"currentStep": "discover_agent_cards",
	}
	if resume, ok := args["resumeJson"].(map[string]any); ok {
		createBody["resumeJson"] = resume
	}
	created, err := s.daemonJSON(ctx, http.MethodPost, "/v1/work-runs", nil, createBody)
	if err != nil {
		return "", true, err
	}
	if payload, ok := created.(map[string]any); ok {
		if run, ok := payload["workRun"].(map[string]any); ok {
			if id := stringFromAny(run["runId"]); id != "" {
				return id, true, nil
			}
		}
	}
	return "", true, fmt.Errorf("work run creation returned no runId")
}

func (s *Server) getWorkCheckpoint(ctx context.Context, args map[string]any) (toolResult, error) {
	runID, shouldRecord, err := s.resolveWorkRunID(ctx, args)
	if err != nil {
		return workContextError(err), nil
	}
	if !shouldRecord || runID == "" {
		return errorResult("runId or workUid required", nil), nil
	}
	return s.proxy(ctx, http.MethodGet, "/v1/work-runs/"+url.PathEscape(runID), nil, nil)
}

func (s *Server) resumeWorkRun(ctx context.Context, args map[string]any) (toolResult, error) {
	runID, shouldRecord, err := s.resolveWorkRunID(ctx, args)
	if err != nil {
		return workContextError(err), nil
	}
	if !shouldRecord || runID == "" {
		return errorResult("runId or workUid required", nil), nil
	}
	body := cloneArgs(args)
	injectExternalWorkRunContext(body)
	return s.proxy(ctx, http.MethodPost, "/v1/work-runs/"+url.PathEscape(runID)+"/resume", nil, body)
}

func (s *Server) stopWorkRun(ctx context.Context, args map[string]any) (toolResult, error) {
	runID, shouldRecord, err := s.resolveWorkRunID(ctx, args)
	if err != nil {
		return workContextError(err), nil
	}
	if !shouldRecord || runID == "" {
		return errorResult("runId or workUid required", nil), nil
	}
	return s.proxy(ctx, http.MethodPost, "/v1/work-runs/"+url.PathEscape(runID)+"/stop", nil, map[string]any{
		"reason": firstNonEmptyString(firstString(args, "reason"), "Stopped through external MCP agent."),
	})
}

func (s *Server) paymentIDFromArgs(ctx context.Context, args map[string]any) (string, error) {
	if paymentID := firstString(args, "paymentId", "id"); paymentID != "" {
		return paymentID, nil
	}
	if planID := firstString(args, "orderPlanId", "planId"); planID != "" {
		payload, err := s.daemonJSON(ctx, http.MethodGet, "/v1/order-plans/"+url.PathEscape(planID), nil, nil)
		if err != nil {
			return "", err
		}
		if mapped, ok := payload.(map[string]any); ok {
			if id := stringFromAny(mapped["paymentId"]); id != "" {
				return id, nil
			}
			if plan, ok := mapped["orderPlan"].(map[string]any); ok {
				if id := stringFromAny(plan["paymentId"]); id != "" {
					return id, nil
				}
			}
			if payment, ok := mapped["payment"].(map[string]any); ok {
				if id := stringFromAny(payment["paymentId"]); id != "" {
					return id, nil
				}
			}
		}
	}
	if resume, ok := args["resumeJson"].(map[string]any); ok {
		if entities, ok := resume["knownEntities"].(map[string]any); ok {
			if id := stringFromAny(entities["paymentId"]); id != "" {
				return id, nil
			}
		}
	}
	return "", fmt.Errorf("paymentId required; resolve the order plan/payment first")
}

func stringFromNestedMap(args map[string]any, parent, key string) string {
	if nested, ok := args[parent].(map[string]any); ok {
		return firstString(nested, key)
	}
	return ""
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
	nowTime := time.Now().UTC()
	now := nowTime.Format(time.RFC3339)
	expiresAt := nowTime.Add(workMCPLeaseTTL).Format(time.RFC3339)
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
	upsertWorkMCPLease(state, map[string]any{
		"workUid":     workUID,
		"projectPath": projectPath,
		"projectName": projectName,
		"controller":  "external-mcp",
		"source":      "mcp.stdio",
		"clientName":  firstNonEmptyString(s.opts.ClientName, "MCP stdio client"),
		"sessionId":   s.workMCPLeaseSessionID(workUID),
		"status":      "active",
		"startedAt":   now,
		"lastSeenAt":  now,
		"expiresAt":   expiresAt,
		"updatedAt":   now,
	})
	if err := writeDesktopStateMap(statePath, state); err != nil {
		return fmt.Errorf("write desktop work state: %w", err)
	}
	return nil
}

func (s *Server) workMCPLeaseSessionID(workUID string) string {
	seed := strings.Join([]string{
		strings.TrimSpace(workUID),
		s.connectionRole(),
		strings.TrimSpace(s.opts.ClientCWD),
		firstNonEmptyString(s.opts.ClientName, "MCP stdio client"),
	}, "\x00")
	sum := sha256.Sum256([]byte(seed))
	return fmt.Sprintf("mcp-%x", sum[:8])
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

func upsertWorkMCPLease(state map[string]any, entry map[string]any) {
	workUID := stringFromAny(entry["workUid"])
	projectPath := stringFromAny(entry["projectPath"])
	if workUID == "" || projectPath == "" {
		return
	}
	items := []any{entry}
	for _, item := range anySlice(state["workMcpLeases"]) {
		existing, ok := item.(map[string]any)
		if !ok {
			items = append(items, item)
			continue
		}
		if stringFromAny(existing["workUid"]) == workUID {
			if stringFromAny(existing["status"]) == "active" {
				if startedAt := stringFromAny(existing["startedAt"]); startedAt != "" {
					entry["startedAt"] = startedAt
				}
			}
			continue
		}
		items = append(items, existing)
	}
	if len(items) > workMCPLeaseLimit {
		items = items[:workMCPLeaseLimit]
	}
	state["workMcpLeases"] = items
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
	return s.daemonJSONWithToken(ctx, method, path, query, body, s.opts.AgentToken)
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
	if s.interactiveSession() {
		req.Header.Set("X-Exora-Agent-Session", strings.TrimSpace(s.opts.AgentSessionID))
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
	if strings.TrimSpace(s.opts.BaseURL) != "" {
		candidates = append(candidates, s.opts.BaseURL)
	}
	if manifest, _, err := discovery.ReadFirst(); err == nil {
		if strings.TrimSpace(manifest.BaseURL) != "" {
			candidates = append(candidates, manifest.BaseURL)
		}
		if len(manifest.StartCommand) > 0 {
			startCommand = manifest.StartCommand
		}
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

var v2ToolShortNames = []string{
	"claim_run",
	"get_transaction_state",
	"get_allowed_actions",
	"search_agent_cards",
	"report_progress",
	"request_user_input",
	"request_approval",
	"propose_transition",
	"submit_offer",
	"submit_deliverable",
	"report_blocked",
	"finish_run",
}

func V2ToolNames() []string {
	out := make([]string, 0, len(v2ToolShortNames))
	for _, name := range v2ToolShortNames {
		out = append(out, "exora."+name)
	}
	return out
}

var marketplaceToolNames = map[string]bool{
	"exora.search_products": true, "exora.get_product_manifest": true, "exora.estimate_purchase": true,
	"exora.purchase_compute_minutes": true, "exora.extend_compute_minutes": true, "exora.purchase_download": true,
	"exora.create_download_transfer": true, "exora.invoke_operation": true, "exora.get_lease": true,
	"exora.release_lease": true, "exora.get_usage": true,
}

func isMarketplaceTool(name string) bool { return marketplaceToolNames[strings.TrimSpace(name)] }

func marketplaceToolDefinitions() []toolDefinition {
	all := toolDefinitions()
	out := make([]toolDefinition, 0, len(marketplaceToolNames))
	for _, definition := range all {
		if isMarketplaceTool(definition.Name) {
			out = append(out, definition)
		}
	}
	return out
}

func v2ToolDefinitions() []toolDefinition {
	definitions := []toolDefinition{
		{
			Name: "exora.claim_run", Title: "Claim Automation Run",
			Description: "Bind this Codex turn to its pre-claimed AutomationRun and return the transaction, role, and expected state version.",
			InputSchema: strictObjectSchema(map[string]any{"runId": stringProp("AutomationRun id from the wake prompt.")}, []string{"runId"}),
		},
		{
			Name: "exora.get_transaction_state", Title: "Get Transaction State",
			Description: "Read the Cloud V2 transaction projection authorized by this run capability.",
			InputSchema: strictObjectSchema(map[string]any{"transactionId": stringProp("Transaction id returned by claim_run.")}, []string{"transactionId"}),
		},
		{
			Name: "exora.get_allowed_actions", Title: "Get Allowed Actions",
			Description: "Read the authoritative state version and currently allowed Cloud transitions.",
			InputSchema: strictObjectSchema(map[string]any{"transactionId": stringProp("Transaction id returned by claim_run.")}, []string{"transactionId"}),
		},
		{
			Name: "exora.search_agent_cards", Title: "Search Agent Cards",
			Description: "Search Cloud V2 Agent Cards without exposing Dock credentials.",
			InputSchema: strictObjectSchema(map[string]any{
				"query": stringProp("Optional free-text query."),
				"role":  stringProp("Optional buyer, seller, or verifier role."),
			}, nil),
		},
	}
	for _, action := range []string{"report_progress", "request_user_input", "request_approval", "propose_transition", "submit_offer", "submit_deliverable", "report_blocked", "finish_run"} {
		definitions = append(definitions, toolDefinition{
			Name:        "exora." + action,
			Title:       strings.ReplaceAll(strings.Title(strings.ReplaceAll(action, "_", " ")), " ", " "),
			Description: "Submit an idempotent, version-checked " + action + " event for the current AutomationRun. This never grants human approval or moves funds locally.",
			InputSchema: strictObjectSchema(map[string]any{
				"runId":                stringProp("AutomationRun id."),
				"expectedStateVersion": integerProp("Exact transaction state version read from Cloud."),
				"idempotencyKey":       stringProp("Stable unique key for this logical mutation; reuse it on retries."),
				"payload":              objectProp("Action-specific structured payload."),
			}, []string{"runId", "expectedStateVersion", "idempotencyKey"}),
		})
	}
	return definitions
}

func strictObjectSchema(properties map[string]any, required []string) map[string]any {
	schema := objectSchema(properties, required)
	schema["additionalProperties"] = false
	return schema
}

func toolDefinitions() []toolDefinition {
	return []toolDefinition{
		{Name: "exora.search_products", Title: "Search Exora Products", Description: "Browse the same four-project published catalog shown in Exora Dock.", InputSchema: strictObjectSchema(map[string]any{"q": stringProp("Optional title or description query."), "applicationSource": stringProp("Optional vm, resources, endpoint, or api_bridge project.")}, nil)},
		{Name: "exora.get_product_manifest", Title: "Get Product Manifest", Description: "Read a published listing, its manifest, price, availability, and isolation disclosure.", InputSchema: strictObjectSchema(map[string]any{"listingId": stringProp("Published listing id.")}, []string{"listingId"})},
		{Name: "exora.estimate_purchase", Title: "Estimate Purchase", Description: "Estimate the authoritative charge, balance, and approval requirement before spending.", InputSchema: strictObjectSchema(map[string]any{"listingId": stringProp("Published listing id."), "durationMinutes": integerProp("Positive whole minutes for compute products.")}, []string{"listingId"})},
		{Name: "exora.purchase_compute_minutes", Title: "Purchase VM Minutes", Description: "Reserve funds and provision a VM Lease. Code and results move only through Lease SSH/SFTP/rsync.", InputSchema: strictObjectSchema(map[string]any{"listingId": stringProp("Published VM listing id."), "durationMinutes": integerProp("Positive whole minutes."), "idempotencyKey": stringProp("Stable retry key."), "maxChargeAtomic": integerProp("Maximum authorized USDC atomic charge."), "approvalId": stringProp("Approved over-budget request id, when required."), "activitySessionId": stringProp("Stable history grouping id."), "sshPublicKey": stringProp("Required OpenSSH public key installed in the guest; the private key must remain local.")}, []string{"listingId", "durationMinutes", "idempotencyKey", "maxChargeAtomic", "sshPublicKey"})},
		{Name: "exora.extend_compute_minutes", Title: "Extend Compute Minutes", Description: "Purchase additional whole minutes for an active lease.", InputSchema: strictObjectSchema(map[string]any{"purchaseId": stringProp("Original compute purchase id."), "durationMinutes": integerProp("Additional whole minutes."), "idempotencyKey": stringProp("Stable retry key."), "maxChargeAtomic": integerProp("Maximum authorized charge."), "approvalId": stringProp("Approved over-budget request id, when required.")}, []string{"purchaseId", "durationMinutes", "idempotencyKey", "maxChargeAtomic"})},
		{Name: "exora.purchase_download", Title: "Purchase Resources", Description: "Charge once and issue a non-transferable DownloadGrant for one fixed Resources version stored in S3. It is never mounted into a VM.", InputSchema: strictObjectSchema(map[string]any{"listingId": stringProp("Published Resources listing id."), "idempotencyKey": stringProp("Stable retry key."), "maxChargeAtomic": integerProp("Maximum authorized charge."), "approvalId": stringProp("Approved over-budget request id, when required."), "activitySessionId": stringProp("Stable history grouping id.")}, []string{"listingId", "idempotencyKey", "maxChargeAtomic"})},
		{Name: "exora.create_download_transfer", Title: "Create Download Transfer", Description: "Issue a short-lived resumable transfer URL from an active DownloadGrant without charging again.", InputSchema: strictObjectSchema(map[string]any{"grantId": stringProp("Active download grant id.")}, []string{"grantId"})},
		{Name: "exora.invoke_operation", Title: "Invoke Marketplace Operation", Description: "Invoke a paid operation using the reviewed OpenAPI contract and deterministic adapter.", InputSchema: strictObjectSchema(map[string]any{"listingId": stringProp("Published API listing id."), "operationId": stringProp("Declared operation id."), "idempotencyKey": stringProp("Stable retry key."), "maxChargeAtomic": integerProp("Maximum authorized charge."), "approvalId": stringProp("Approved request id when required."), "activitySessionId": stringProp("Stable history grouping id."), "arguments": objectProp("Operation arguments validated against the published contract.")}, []string{"listingId", "operationId", "idempotencyKey", "maxChargeAtomic"})},
		{Name: "exora.get_lease", Title: "Get Lease", Description: "Read lease state, expiry, backend disclosure, and current guest capability.", InputSchema: strictObjectSchema(map[string]any{"leaseId": stringProp("Lease id.")}, []string{"leaseId"})},
		{Name: "exora.release_lease", Title: "Release Lease", Description: "End an active lease and request provider reset. Voluntary early release has no refund.", InputSchema: strictObjectSchema(map[string]any{"leaseId": stringProp("Lease id.")}, []string{"leaseId"})},
		{Name: "exora.get_usage", Title: "Get Marketplace Usage", Description: "Read an active lease or the account's append-only marketplace ledger.", InputSchema: strictObjectSchema(map[string]any{"leaseId": stringProp("Optional lease id; omit for account ledger.")}, nil)},
		{
			Name: "exora.save_api_bridge_draft", Title: "Save API Bridge Draft",
			Description: "Create or version-update a seller API Bridge or Dock Endpoint draft. The Agent standardizes routes, metering, and pricing but cannot submit credentials, attest seller responsibility, create a Listing, or publish.",
			InputSchema: strictObjectSchema(map[string]any{
				"draftId": stringProp("Use the preallocated desktop draft id when supplied; otherwise omit to create."), "expectedVersion": numberProp("Use 0 for a preallocated id's first save; use the current version for updates."),
				"title": stringProp("Seller-facing service title."), "description": stringProp("Service description supplied by the seller."),
				"bridgeMode":    stringProp("transparent for API Bridge or dock_tunnel for a local Endpoint."),
				"interfaceMode": stringProp("passthrough preserves the provider wire format; agent_managed uses a reviewed deterministic adapter."),
				"protocol":      stringProp("openapi, openai, generic_http, or sse."), "baseUrl": stringProp("Public HTTPS provider base URL. Omit for dock_tunnel."),
				"healthPath": stringProp("Seller-declared side-effect-free probe path."), "routes": arrayProp("Routes. Each route includes operationId, method, path, displayName, pricing[], and maxChargePerInvocationAtomic when variable-priced."),
				"contract": objectProp("Complete OpenAPI 3.1 contract."), "adapter": objectProp("exora.adapter.v1 deterministic mappings; omit for passthrough."),
				"agentNotes": stringProp("Notes for human review."), "unresolvedFields": arrayProp("Fields the agent could not determine."),
			}, []string{"title", "bridgeMode", "interfaceMode", "protocol", "healthPath", "routes", "contract"}),
		},
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
				"runId":                  stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson":             objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
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
				"runId":           stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson":      objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
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
			Description: "Plan-first buyer workflow: classify the request, confirm remote-task planning, write local plan/manifest files, require owner manifest approval, then match sellers and create an owner-selectable order plan only from signed quotes.",
			InputSchema: objectSchema(map[string]any{
				"query":            stringProp("Concrete task or resource need."),
				"intent":           stringProp("Alias for query."),
				"workUid":          stringProp("Optional Work UID copied from the Dock Local agent via MCP prompt. Use it on every related request."),
				"runId":            stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson":       objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
				"projectPath":      stringProp("Optional project folder path. If omitted, Dock resolves it from workUid when possible."),
				"prePlanConfirmed": boolProp("Set true only after the user confirms Exora should generate local plan files. This does not approve remote submission."),
				"approvalId":       stringProp("Owner approval id for a reviewed submit_remote_task_manifest approval. Required before seller matching continues."),
				"planId":           stringProp("Optional plan id returned by an earlier run_buyer_work response."),
				"manifestHash":     stringProp("Optional manifest hash to verify against the owner approval before seller matching."),
				"requesterPubkey":  stringProp("Optional requester/user public key. The Dock may replace this with the local signing wallet."),
				"agentId":          stringProp("Optional buyer agent identifier."),
				"constraints":      objectProp("Optional structured constraints such as type, minVramGb, minGpuCount, or region."),
				"maxCandidates":    numberProp("Optional number of sellers to negotiate with. MCP defaults to 3."),
				"maxResults":       numberProp("Optional fallback search result count. MCP defaults to 6."),
				"maxOptions":       numberProp("Optional owner-selectable option count. MCP defaults to 6."),
				"taskTemplate":     objectProp("Optional task template. Put Docker settings under requirements.docker."),
			}, []string{"query"}),
		},
		{
			Name:        "exora.negotiate_task",
			Title:       "Negotiate Exora Task",
			Description: "Low-level compatibility tool. Send signed discussion requests to candidate seller agents only after the owner has reviewed and approved an equivalent remote task manifest.",
			InputSchema: objectSchema(map[string]any{
				"intent":            stringProp("Concrete task intent. Alias: query."),
				"query":             stringProp("Concrete task intent. Alias for intent."),
				"workUid":           stringProp("Optional Work UID copied from the Dock Local agent via MCP prompt. Use it on every related request."),
				"runId":             stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson":        objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
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
				"workUid":         stringProp("Optional Work UID for checkpoint continuation."),
				"runId":           stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson":      objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
				"providerPubkey":  stringProp("Optional provider filter."),
				"requesterPubkey": stringProp("Optional requester filter."),
				"orderPlanId":     stringProp("Optional order plan filter."),
			}, nil),
		},
		{
			Name:        "exora.get_negotiation",
			Title:       "Get Exora Negotiation",
			Description: "Fetch a pre-order seller discussion by id.",
			InputSchema: objectSchema(map[string]any{
				"negotiationId": stringProp("Negotiation id."),
				"workUid":       stringProp("Optional Work UID for checkpoint continuation."),
				"runId":         stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson":    objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
			}, []string{"negotiationId"}),
		},
		{
			Name:        "exora.resume_negotiation",
			Title:       "Resume Exora Negotiation",
			Description: "Refresh a pending negotiation from the provider and return its next action.",
			InputSchema: objectSchema(map[string]any{
				"negotiationId": stringProp("Negotiation id."),
				"workUid":       stringProp("Optional Work UID for checkpoint continuation."),
				"runId":         stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson":    objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
			}, []string{"negotiationId"}),
		},
		{
			Name:        "exora.create_order_plan_from_quote",
			Title:       "Create Order Plan From Quote",
			Description: "Create a pending owner seller-selection order plan from quoted negotiations. This does not select, approve, or pay.",
			InputSchema: objectSchema(map[string]any{
				"negotiationIds": arrayProp("Quoted negotiation ids."),
				"query":          stringProp("Optional original task query."),
				"workUid":        stringProp("Optional Work UID copied from the Dock Local agent via MCP prompt. Use it on every related request."),
				"runId":          stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson":     objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
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
				"runId":             stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson":        objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
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
				"taskId":     stringProp("Task id requiring approval."),
				"action":     stringProp("Approval action, defaults to approve_quote."),
				"expiresAt":  stringProp("Optional RFC3339 expiry."),
				"workUid":    stringProp("Optional Work UID for checkpoint continuation."),
				"runId":      stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson": objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
			}, []string{"taskId"}),
		},
		{
			Name:        "exora.find_payment_evidence",
			Title:       "Find Payment Evidence",
			Description: "Read chain payment evidence for paid work. External agents must call this and require found_finalized Cloud/chain evidence before continuing to any paid worker/job submission.",
			InputSchema: objectSchema(map[string]any{
				"paymentId":   stringProp("Payment id. Preferred when known."),
				"orderPlanId": stringProp("Optional order plan id used to discover paymentId."),
				"planId":      stringProp("Alias for orderPlanId."),
				"workUid":     stringProp("Optional Work UID for checkpoint continuation."),
				"runId":       stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson":  objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
			}, nil),
		},
		{
			Name:        "exora.sync_payment_evidence",
			Title:       "Sync Payment Evidence",
			Description: "Store Cloud/chain payment evidence in the Dock payment ledger. This does not approve payment or move funds; it only records independently resolved chain_scan evidence.",
			InputSchema: objectSchema(map[string]any{
				"paymentId":   stringProp("Payment id. Preferred when known."),
				"orderPlanId": stringProp("Optional order plan id used to discover paymentId."),
				"planId":      stringProp("Alias for orderPlanId."),
				"evidence":    objectProp("PaymentEvidence JSON returned by Exora Cloud, usually with status found_finalized."),
				"workUid":     stringProp("Optional Work UID for checkpoint continuation."),
				"runId":       stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson":  objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
			}, nil),
		},
		{
			Name:        "exora.get_order_status",
			Title:       "Get Order Status",
			Description: "Read a task/order ledger entry.",
			InputSchema: objectSchema(map[string]any{
				"taskId":     stringProp("Task id."),
				"workUid":    stringProp("Optional Work UID for checkpoint continuation."),
				"runId":      stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson": objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
			}, []string{"taskId"}),
		},
		{
			Name:        "exora.resume_order",
			Title:       "Resume Order",
			Description: "Read a task/order ledger entry and include the next suggested protocol action.",
			InputSchema: objectSchema(map[string]any{
				"taskId":     stringProp("Task id."),
				"workUid":    stringProp("Optional Work UID for checkpoint continuation."),
				"runId":      stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson": objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
			}, []string{"taskId"}),
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
				"workUid":    stringProp("Optional Work UID for checkpoint continuation."),
				"runId":      stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson": objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
			}, nil),
		},
		{
			Name:        "exora.list_order_plans",
			Title:       "List Order Plans",
			Description: "List durable seller-selection/task-flow plans, including realtime provider candidate states.",
			InputSchema: objectSchema(map[string]any{
				"status":     stringProp("Optional order plan status, for example pending_selection or selected."),
				"workUid":    stringProp("Optional Work UID for checkpoint continuation."),
				"runId":      stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson": objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
			}, nil),
		},
		{
			Name:        "exora.get_order_plan",
			Title:       "Get Order Plan",
			Description: "Fetch a durable seller-selection/task-flow plan with realtime candidate state and progress events.",
			InputSchema: objectSchema(map[string]any{
				"planId":     stringProp("Order plan id."),
				"workUid":    stringProp("Optional Work UID for checkpoint continuation."),
				"runId":      stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson": objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
			}, []string{"planId"}),
		},
		{
			Name:        "exora.resume_task_flow",
			Title:       "Resume Task Flow",
			Description: "Resume a durable task flow/order plan and return the next suggested action.",
			InputSchema: objectSchema(map[string]any{
				"planId":     stringProp("Order plan id."),
				"workUid":    stringProp("Optional Work UID for checkpoint continuation."),
				"runId":      stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson": objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
			}, []string{"planId"}),
		},
		{
			Name:        "exora.get_artifact_manifest",
			Title:       "Get Artifact Manifest",
			Description: "Fetch artifact metadata for a completed task.",
			InputSchema: objectSchema(map[string]any{
				"taskId":     stringProp("Task id."),
				"workUid":    stringProp("Optional Work UID for checkpoint continuation."),
				"runId":      stringProp("Optional WorkRun id from a previous checkpoint/resumeJson."),
				"resumeJson": objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
			}, []string{"taskId"}),
		},
		{
			Name:        "exora.get_work_checkpoint",
			Title:       "Get Work Checkpoint",
			Description: "Fetch the latest WorkRun checkpoint and resumeJson for a runId or workUid.",
			InputSchema: objectSchema(map[string]any{
				"runId":   stringProp("Optional WorkRun id."),
				"workUid": stringProp("Optional Work UID copied from Dock."),
			}, nil),
		},
		{
			Name:        "exora.resume_work_run",
			Title:       "Resume Work Run",
			Description: "Record or resume a WorkRun from resumeJson. Returns the updated checkpoint and resumeJson.",
			InputSchema: objectSchema(map[string]any{
				"runId":       stringProp("Optional WorkRun id."),
				"workUid":     stringProp("Optional Work UID copied from Dock."),
				"projectPath": stringProp("Optional project folder path when the workUid has no WorkRun yet."),
				"resumeJson":  objectProp("resumeJson returned by a prior Exora MCP/API step."),
				"currentStep": stringProp("Optional current resumable step."),
				"nextAction":  stringProp("Optional next suggested action."),
				"summary":     stringProp("Optional safe summary to disclose."),
			}, nil),
		},
		{
			Name:        "exora.stop_work_run",
			Title:       "Stop Work Run",
			Description: "Cooperatively stop an externally controlled WorkRun and return a checkpoint that can be resumed later.",
			InputSchema: objectSchema(map[string]any{
				"runId":      stringProp("Optional WorkRun id."),
				"workUid":    stringProp("Optional Work UID copied from Dock."),
				"resumeJson": objectProp("Optional resumeJson returned by a prior Exora MCP/API step."),
				"reason":     stringProp("Optional stop reason."),
			}, nil),
		},
	}
}

func (s *Server) toolDefinitions(ctx context.Context) []toolDefinition {
	definitions := toolDefinitions()
	if !s.interactiveSession() {
		if s.sellerToolsEnabled(ctx) {
			definitions = append(definitions, sellerDraftToolDefinitions()...)
		}
		return definitions
	}
	if s.connectionRole() == "buyer" {
		return buyerInterviewToolDefinitions()
	}
	return append(definitions,
		toolDefinition{Name: "exora.session_report_progress", Title: "Report Chat Progress", Description: "Record a safe progress update in the bound Exora chat. This cannot change transaction state.", InputSchema: objectSchema(map[string]any{"message": stringProp("Visible progress message."), "summary": stringProp("Alias for message.")}, nil)},
		toolDefinition{Name: "exora.session_request_user_input", Title: "Request Chat User Input", Description: "Ask the human a question through the bound Exora chat. This grants no approval.", InputSchema: objectSchema(map[string]any{"question": stringProp("Question for the human user.")}, []string{"question"})},
	)
}

func buyerInterviewToolDefinitions() []toolDefinition {
	optionSchema := map[string]any{
		"type": "object", "additionalProperties": false,
		"properties": map[string]any{
			"id": stringProp("Stable option id."), "label": stringProp("Short user-facing label."),
			"description": stringProp("Optional one-sentence explanation."),
		},
		"required": []string{"id", "label"},
	}
	questionSchema := strictObjectSchema(map[string]any{
		"id":          stringProp("Stable question id in snake_case."),
		"title":       stringProp("Short popup heading, no more than 40 characters."),
		"question":    stringProp("One concrete question for the buyer."),
		"why":         stringProp("One short sentence explaining why this is needed for the plan."),
		"inputType":   map[string]any{"type": "string", "enum": []string{"single_select", "multi_select"}},
		"options":     map[string]any{"type": "array", "items": optionSchema, "minItems": 2, "maxItems": 3, "description": "Exactly two or three reasonable, context-specific candidate answers. Do not include Other or Not sure; the custom input provides that path."},
		"allowCustom": boolProp("Must be true. Every question must allow a free-form answer in addition to any suggested options."),
		"required":    boolProp("Whether an answer is required before continuing."),
		"placeholder": stringProp("Optional hint for a custom answer."),
		"freedomHint": stringProp("A supportive user-facing sentence in the user's language explaining that if none of the suggested options fits, the buyer may type a different requirement or describe the concrete task so the agent can adapt its recommendation."),
	}, []string{"id", "title", "question", "why", "inputType", "options", "allowCustom", "required", "freedomHint"})
	localFileSchema := strictObjectSchema(map[string]any{
		"id":                 stringProp("Stable file id referenced by the remote plan; use snake_case."),
		"name":               stringProp("User-facing file or folder name."),
		"pathSuggestion":     stringProp("Suggested path relative to the locked workspace; never use an absolute path."),
		"purpose":            stringProp("Why this material is needed."),
		"preparationSteps":   arrayProp("Concrete local steps to create, collect, sanitize, or validate this material."),
		"sensitivity":        map[string]any{"type": "string", "enum": []string{"public", "private", "sensitive"}},
		"remoteDisclosure":   map[string]any{"type": "string", "enum": []string{"full", "redacted", "metadata_only", "never"}},
		"required":           boolProp("Whether remote execution is blocked until this material is ready."),
		"completionCriteria": arrayProp("Checks proving this material is ready."),
	}, []string{"id", "name", "pathSuggestion", "purpose", "preparationSteps", "sensitivity", "remoteDisclosure", "required", "completionCriteria"})
	remoteFileSchema := strictObjectSchema(map[string]any{
		"localFileId":  stringProp("The exact id of a file declared by localPreparationPlan.filesToPrepare."),
		"usage":        stringProp("How the remote agent will use the prepared file."),
		"required":     boolProp("Whether remote execution must stop if the file is unavailable."),
		"transferMode": map[string]any{"type": "string", "enum": []string{"full", "redacted", "metadata_only"}},
		"destination":  stringProp("Relative destination or logical input name in the remote workspace."),
	}, []string{"localFileId", "usage", "required", "transferMode", "destination"})
	planSchema := strictObjectSchema(map[string]any{
		"plans": map[string]any{
			"type": "object", "additionalProperties": false,
			"properties": map[string]any{
				"localPreparationPlan": strictObjectSchema(map[string]any{
					"version":            stringProp("Plan schema version; use 1.0."),
					"title":              stringProp("Title for the buyer agent's local preparation work."),
					"summary":            stringProp("What must be prepared locally before remote execution."),
					"objective":          stringProp("Definition of ready for handoff."),
					"steps":              arrayProp("Ordered local preparation steps."),
					"filesToPrepare":     map[string]any{"type": "array", "items": localFileSchema, "minItems": 1},
					"safetyChecks":       arrayProp("Checks for secrets, privacy, licensing, and data minimization."),
					"completionCriteria": arrayProp("Checks that make the complete local preparation plan ready."),
				}, []string{"version", "title", "summary", "objective", "steps", "filesToPrepare", "safetyChecks", "completionCriteria"}),
				"remoteExecutionPlan": strictObjectSchema(map[string]any{
					"version":            stringProp("Plan schema version; use 1.0."),
					"title":              stringProp("Concise remote task title."),
					"summary":            stringProp("Plain-language remote task summary."),
					"goal":               stringProp("Outcome the remote agent must achieve."),
					"requiredFiles":      map[string]any{"type": "array", "items": remoteFileSchema, "minItems": 1},
					"executionSteps":     arrayProp("Ordered instructions for the remote agent after it obtains the prepared files."),
					"requirements":       arrayProp("Functional and technical requirements."),
					"constraints":        objectProp("Budget, deadline, technical, privacy, and operational constraints."),
					"deliverables":       arrayProp("Concrete outputs the remote agent must return."),
					"acceptanceCriteria": arrayProp("Objective checks used to accept delivery."),
					"prohibitedActions":  arrayProp("Actions the remote agent must never perform."),
					"assumptions":        arrayProp("Assumptions that the buyer must review."),
					"risks":              arrayProp("Known risks and mitigations."),
					"outOfScope":         arrayProp("Explicit exclusions."),
				}, []string{"version", "title", "summary", "goal", "requiredFiles", "executionSteps", "requirements", "constraints", "deliverables", "acceptanceCriteria", "prohibitedActions", "assumptions", "risks", "outOfScope"}),
			},
			"required": []string{"localPreparationPlan", "remoteExecutionPlan"},
		},
	}, []string{"plans"})
	return []toolDefinition{
		{Name: "exora.session_request_user_input", Title: "Ask Buyer Question", Description: "Put one structured requirement question into the Dock composer with exactly 2–3 reasonable suggested answers plus a separate custom-input path, then wait for the buyer.", InputSchema: questionSchema},
		{Name: "exora.session_submit_plan", Title: "Submit Two Buyer Plans For Review", Description: "Show a local material-preparation plan and a remote execution plan together. Every remote requiredFiles entry must reference a prepared local file by localFileId. This does not start remote work.", InputSchema: planSchema},
	}
}

func validateBuyerPlanBundle(plans map[string]any) error {
	local, localOK := plans["localPreparationPlan"].(map[string]any)
	remote, remoteOK := plans["remoteExecutionPlan"].(map[string]any)
	if !localOK || !remoteOK {
		return fmt.Errorf("plans.localPreparationPlan and plans.remoteExecutionPlan required")
	}
	for name, plan := range map[string]map[string]any{"localPreparationPlan": local, "remoteExecutionPlan": remote} {
		for _, field := range []string{"title", "summary"} {
			if firstString(plan, field) == "" {
				return fmt.Errorf("plans.%s.%s required", name, field)
			}
		}
	}
	files := map[string]string{}
	for _, value := range anySlice(local["filesToPrepare"]) {
		file, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("localPreparationPlan.filesToPrepare entries must be objects")
		}
		id := firstString(file, "id")
		if id == "" {
			return fmt.Errorf("local prepared file id required")
		}
		if _, exists := files[id]; exists {
			return fmt.Errorf("duplicate local prepared file id %q", id)
		}
		path := firstString(file, "pathSuggestion")
		cleanPath := filepath.Clean(path)
		if path == "" || filepath.IsAbs(path) || cleanPath == ".." || strings.HasPrefix(cleanPath, ".."+string(filepath.Separator)) {
			return fmt.Errorf("local prepared file %q must use a workspace-relative pathSuggestion", id)
		}
		disclosure := firstString(file, "remoteDisclosure")
		switch disclosure {
		case "full", "redacted", "metadata_only", "never":
		default:
			return fmt.Errorf("local prepared file %q has invalid remoteDisclosure", id)
		}
		files[id] = disclosure
	}
	if len(files) == 0 {
		return fmt.Errorf("localPreparationPlan.filesToPrepare must not be empty")
	}
	refs := anySlice(remote["requiredFiles"])
	if len(refs) == 0 {
		return fmt.Errorf("remoteExecutionPlan.requiredFiles must not be empty")
	}
	seenRefs := map[string]bool{}
	for _, value := range refs {
		ref, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("remoteExecutionPlan.requiredFiles entries must be objects")
		}
		id := firstString(ref, "localFileId")
		if seenRefs[id] {
			return fmt.Errorf("duplicate remote file reference %q", id)
		}
		seenRefs[id] = true
		disclosure, exists := files[id]
		if !exists {
			return fmt.Errorf("remote file reference %q is not declared by localPreparationPlan.filesToPrepare", id)
		}
		if disclosure == "never" {
			return fmt.Errorf("remote file reference %q points to material marked never for disclosure", id)
		}
		transferMode := firstString(ref, "transferMode")
		if transferMode != "full" && transferMode != "redacted" && transferMode != "metadata_only" {
			return fmt.Errorf("remote file reference %q has invalid transferMode", id)
		}
		if (disclosure == "redacted" && transferMode == "full") || (disclosure == "metadata_only" && transferMode != "metadata_only") {
			return fmt.Errorf("remote file reference %q requests more disclosure than localPreparationPlan permits", id)
		}
	}
	if len(anySlice(remote["deliverables"])) == 0 || len(anySlice(remote["acceptanceCriteria"])) == 0 {
		return fmt.Errorf("remoteExecutionPlan.deliverables and acceptanceCriteria must not be empty")
	}
	return nil
}

func (s *Server) lockInteractiveWorkContext(args map[string]any) (map[string]any, error) {
	out := cloneArgs(args)
	if expected := strings.TrimSpace(s.opts.WorkUID); expected != "" {
		if supplied := firstString(out, "workUid", "workUID", "uid"); supplied != "" && supplied != expected {
			return nil, fmt.Errorf("workUid is locked to this Exora chat")
		}
		out["workUid"] = expected
	}
	if expected := strings.TrimSpace(s.opts.ProjectPath); expected != "" {
		if supplied := firstString(out, "projectPath"); supplied != "" && !samePath(supplied, expected) {
			return nil, fmt.Errorf("projectPath is locked to this Exora chat")
		}
		out["projectPath"] = expected
	}
	return out, nil
}

func samePath(left, right string) bool {
	a, errA := filepath.Abs(strings.TrimSpace(left))
	b, errB := filepath.Abs(strings.TrimSpace(right))
	if errA != nil || errB != nil {
		return false
	}
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

func (s *Server) recordSessionToolEvent(ctx context.Context, name string, result toolResult, callErr error) {
	if !strings.HasPrefix(strings.TrimSpace(name), "exora.") {
		return
	}
	text := ""
	if len(result.Content) > 0 {
		text = result.Content[0].Text
	}
	if len(text) > 1000 {
		text = text[:1000]
	}
	payload := map[string]any{"isError": result.IsError, "data": result.StructuredContent}
	if callErr != nil {
		payload["error"] = callErr.Error()
	}
	_, _ = s.proxy(ctx, http.MethodPost, "/v1/local-agent-sessions/"+url.PathEscape(s.opts.AgentSessionID)+"/mcp-events", nil, map[string]any{"tool": name, "text": text, "payload": payload})
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

func integerProp(description string) map[string]any {
	return map[string]any{"type": "integer", "minimum": 0, "description": description}
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
