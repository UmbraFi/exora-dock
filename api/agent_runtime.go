package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"

	"github.com/exora-dock/exora-dock/internal/agent"
	"github.com/exora-dock/exora-dock/internal/agentcard"
	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/market"
	"github.com/exora-dock/exora-dock/internal/negotiation"
	"github.com/exora-dock/exora-dock/internal/orderplan"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/go-chi/chi/v5"
)

type agentRunStartRequest struct {
	Intent   string `json:"intent"`
	Profile  string `json:"profile,omitempty"`
	MaxTurns int    `json:"maxTurns,omitempty"`
	Wait     bool   `json:"wait,omitempty"`
}

type agentRunResumeRequest struct {
	Wait bool `json:"wait,omitempty"`
}

func (h *Handler) StartAgentRun(w http.ResponseWriter, r *http.Request) {
	if h.agentRuntime == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent runtime not configured"})
		return
	}
	var req agentRunStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	run, err := h.agentRuntime.Start(r.Context(), agent.StartRequest{
		Intent:   req.Intent,
		Profile:  req.Profile,
		MaxTurns: req.MaxTurns,
	}, req.Wait)
	if err != nil && run.RunID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	status := http.StatusAccepted
	if req.Wait || run.Status == agent.RunStatusFailed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"run": run})
}

func (h *Handler) ListAgentRuns(w http.ResponseWriter, r *http.Request) {
	if h.agentRuns == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent run store not configured"})
		return
	}
	profile := strings.TrimSpace(r.URL.Query().Get("profile"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	runs := h.agentRuns.List()
	out := make([]agent.AgentRun, 0, len(runs))
	for _, run := range runs {
		if profile != "" && run.Profile != profile {
			continue
		}
		if status != "" && run.Status != status {
			continue
		}
		run.Turns = nil
		out = append(out, run)
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": out})
}

func (h *Handler) GetAgentRun(w http.ResponseWriter, r *http.Request) {
	if h.agentRuns == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent run store not configured"})
		return
	}
	run, ok := h.agentRuns.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent run not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"run": run, "turns": run.Turns})
}

func (h *Handler) ResumeAgentRun(w http.ResponseWriter, r *http.Request) {
	if h.agentRuntime == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent runtime not configured"})
		return
	}
	var req agentRunResumeRequest
	if r.Body != nil && r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
	}
	run, err := h.agentRuntime.Resume(r.Context(), chi.URLParam(r, "id"), req.Wait)
	if err != nil && run.RunID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "run": run})
		return
	}
	status := http.StatusAccepted
	if req.Wait {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"run": run})
}

func (h *Handler) StopAgentRun(w http.ResponseWriter, r *http.Request) {
	if h.agentRuntime == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent runtime not configured"})
		return
	}
	run, err := h.agentRuntime.Stop(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"run": run})
}

func (h *Handler) SearchCloudAgentCards(w http.ResponseWriter, r *http.Request) {
	role := strings.TrimSpace(r.URL.Query().Get("role"))
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	payload := h.searchAgentCards(r.Context(), role, query)
	writeJSON(w, http.StatusOK, payload)
}

func (h *Handler) agentTools() []agent.AgentTool {
	buyerAndVerifier := []string{agent.ProfileBuyerCoordinator, agent.ProfileVerifier}
	allProfiles := []string{agent.ProfileBuyerCoordinator, agent.ProfileSellerWorker, agent.ProfileVerifier}
	return []agent.AgentTool{
		{
			Name:            "get_my_agent_card",
			Description:     "Read local buyer/seller Agent Cards and safe diagnostics summary.",
			ReadOnly:        true,
			AllowedProfiles: allProfiles,
			NextAction:      "search_agent_cards_or_negotiate_task",
			Handler:         h.toolGetMyAgentCard,
		},
		{
			Name:            "search_agent_cards",
			Description:     "Search published Agent Cards via Exora Cloud when available, with local card fallback.",
			ReadOnly:        true,
			AllowedProfiles: allProfiles,
			NextAction:      "negotiate_task_or_search_offers",
			Handler:         h.toolSearchAgentCards,
		},
		{
			Name:            "search_offers",
			Description:     "Search local capability/resource offers without creating orders or approvals.",
			ReadOnly:        true,
			AllowedProfiles: buyerAndVerifier,
			NextAction:      "start_task_flow",
			Handler:         h.toolSearchOffers,
		},
		{
			Name:            "start_task_flow",
			Description:     "Compatibility fallback: start market search, realtime provider quote, and durable order-plan flow. Does not select, approve, or pay.",
			Mutating:        true,
			AllowedProfiles: []string{agent.ProfileBuyerCoordinator},
			NextAction:      "wait_for_owner_to_choose_order_plan",
			Handler:         h.toolStartTaskFlow,
		},
		{
			Name:            "negotiate_task",
			Description:     "Start signed buyer-to-seller discussion requests so seller agents can quote or reject before any order is created.",
			Mutating:        true,
			AllowedProfiles: []string{agent.ProfileBuyerCoordinator},
			NextAction:      "compare_quotes_or_wait_for_seller_decision",
			Handler:         h.toolNegotiateTask,
		},
		{
			Name:            "list_negotiations",
			Description:     "List pre-order seller negotiations and their quote/rejection status.",
			ReadOnly:        true,
			AllowedProfiles: buyerAndVerifier,
			NextAction:      "compare_quotes",
			Handler:         h.toolListNegotiations,
		},
		{
			Name:            "get_negotiation",
			Description:     "Read one negotiation, refreshing provider status when possible.",
			ReadOnly:        true,
			AllowedProfiles: buyerAndVerifier,
			NextAction:      "compare_quotes_or_wait_for_seller_decision",
			Handler:         h.toolGetNegotiation,
		},
		{
			Name:            "compare_quotes",
			Description:     "Compare quoted seller negotiations and summarize rejections. Does not choose or approve.",
			ReadOnly:        true,
			AllowedProfiles: buyerAndVerifier,
			NextAction:      "create_order_plan_from_quote",
			Handler:         h.toolCompareQuotes,
		},
		{
			Name:            "create_order_plan_from_quote",
			Description:     "Create a pending owner seller-selection order plan from quoted negotiations. Does not select, approve, or pay.",
			Mutating:        true,
			AllowedProfiles: []string{agent.ProfileBuyerCoordinator},
			NextAction:      "wait_for_owner_to_choose_order_plan",
			Handler:         h.toolCreateOrderPlanFromQuote,
		},
		{
			Name:            "list_order_plans",
			Description:     "List durable order plans and realtime quote states.",
			ReadOnly:        true,
			AllowedProfiles: buyerAndVerifier,
			NextAction:      "resume_task_flow",
			Handler:         h.toolListOrderPlans,
		},
		{
			Name:            "resume_task_flow",
			Description:     "Read an order plan and compute the next safe action.",
			ReadOnly:        true,
			AllowedProfiles: buyerAndVerifier,
			NextAction:      "wait_or_fetch_artifacts",
			Handler:         h.toolResumeTaskFlow,
		},
		{
			Name:            "request_approval",
			Description:     "Create a human approval request for a task. Does not decide the approval.",
			Mutating:        true,
			AllowedProfiles: []string{agent.ProfileBuyerCoordinator, agent.ProfileSellerWorker},
			NextAction:      "wait_for_owner_approval",
			Handler:         h.toolRequestApproval,
		},
		{
			Name:            "get_artifact_manifest",
			Description:     "Read artifact metadata for a completed task or provider job.",
			ReadOnly:        true,
			AllowedProfiles: allProfiles,
			NextAction:      "verify_artifacts",
			Handler:         h.toolGetArtifactManifest,
		},
		{
			Name:            "docker_preflight",
			Description:     "Validate Docker task requirements through the provider executor policy without running Docker.",
			ReadOnly:        true,
			AllowedProfiles: []string{agent.ProfileSellerWorker, agent.ProfileVerifier},
			NextAction:      "quote_or_reject_task",
			Handler:         h.toolDockerPreflight,
		},
	}
}

func (h *Handler) toolGetMyAgentCard(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	if h.agentCards == nil {
		return agent.ToolResult{}, fmt.Errorf("agent card service not configured")
	}
	payload := map[string]any{"cards": h.agentCards.List()}
	if buyer, ok := h.agentCards.Get(agentcard.RoleBuyer); ok {
		payload["buyer"] = buyer
	}
	if seller, ok := h.agentCards.Get(agentcard.RoleSeller); ok {
		payload["seller"] = seller
	}
	payload["diagnostics"] = agentcard.CollectDiagnostics(h.cardDiagnostics)
	return agent.ToolResult{Content: payload, Summary: "Loaded local Agent Cards.", NextAction: "search_agent_cards"}, nil
}

func (h *Handler) toolSearchAgentCards(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	role := agentArgString(args, "role")
	query := firstAgentArgString(args, "q", "query")
	if query == "" {
		query = run.Intent
	}
	payload := h.searchAgentCards(ctx, role, query)
	return agent.ToolResult{Content: payload, Summary: "Searched Agent Cards.", NextAction: "negotiate_task"}, nil
}

func (h *Handler) toolSearchOffers(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	if h.resources == nil {
		return agent.ToolResult{}, fmt.Errorf("resource service not configured")
	}
	req := market.SearchRequest{
		Query:       firstAgentArgString(args, "query", "q"),
		MaxResults:  agentArgInt(args, "maxResults"),
		Constraints: map[string]any{},
	}
	if req.Query == "" {
		req.Query = run.Intent
	}
	if constraints, ok := args["constraints"].(map[string]any); ok {
		req.Constraints = constraints
	}
	for _, key := range []string{"type", "minVramGb", "minGpuCount", "region"} {
		if value, ok := args[key]; ok && req.Constraints[key] == nil {
			req.Constraints[key] = value
		}
	}
	result := market.Search(req, h.resources)
	return agent.ToolResult{Content: result, Summary: result.Summary, NextAction: result.NextAction}, nil
}

func (h *Handler) toolStartTaskFlow(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	body := cloneAgentArgs(args)
	if firstAgentArgString(body, "query", "q") == "" {
		body["query"] = run.Intent
	}
	setAgentDefault(body, "agentId", "exora-agent-runtime")
	setAgentDefault(body, "prepareOrderOptions", true)
	setAgentDefault(body, "createSelectionRequest", true)
	setAgentDefault(body, "requireRealtimeQuotes", true)
	setAgentDefault(body, "maxOptions", float64(6))
	setAgentDefault(body, "maxResults", float64(6))

	payload, err := h.invokeJSONHandler(ctx, http.MethodPost, "/v1/agent/search-sellers", body, h.SearchSellers)
	if err != nil {
		return agent.ToolResult{}, err
	}
	result := agent.ToolResult{
		Content:    payload,
		Summary:    stringFromAny(payload["summary"]),
		NextAction: stringFromAny(payload["nextAction"]),
	}
	if selection, ok := payload["selectionRequest"].(map[string]any); ok {
		result.OrderPlanID = stringFromAny(selection["planId"])
		result.NextAction = firstNonEmpty(stringFromAny(selection["nextAction"]), result.NextAction)
		result.Waiting = true
	}
	if result.NextAction == "" {
		result.NextAction = "wait_for_owner_to_choose_order_plan"
	}
	return result, nil
}

func (h *Handler) toolNegotiateTask(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	body := cloneAgentArgs(args)
	if firstAgentArgString(body, "intent", "query", "q") == "" {
		body["intent"] = run.Intent
	}
	setAgentDefault(body, "agentId", "exora-agent-runtime")
	setAgentDefault(body, "maxCandidates", float64(3))
	payload, err := h.invokeJSONHandler(ctx, http.MethodPost, "/v1/negotiations", body, h.CreateNegotiations)
	if err != nil {
		return agent.ToolResult{}, err
	}
	ids, quoted, rejected := negotiationStats(payload)
	next := stringFromAny(payload["nextAction"])
	waiting := next == "wait_for_seller_decision"
	return agent.ToolResult{
		Content:        payload,
		Summary:        stringFromAny(payload["summary"]),
		NextAction:     next,
		NegotiationIDs: ids,
		QuoteCount:     quoted,
		RejectionCount: rejected,
		Waiting:        waiting,
	}, nil
}

func (h *Handler) toolListNegotiations(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	if h.negotiations == nil {
		return agent.ToolResult{}, fmt.Errorf("negotiation service not configured")
	}
	filter := negotiation.ListFilter{Status: negotiation.Status(agentArgString(args, "status"))}
	items := h.negotiations.List(filter)
	ids := make([]string, 0, len(items))
	quoted, rejected := 0, 0
	for _, item := range items {
		ids = append(ids, item.ID)
		if item.Status == negotiation.StatusQuoted {
			quoted++
		}
		if item.Status == negotiation.StatusRejected {
			rejected++
		}
	}
	return agent.ToolResult{
		Content:        map[string]any{"negotiations": items, "negotiationIds": ids},
		Summary:        fmt.Sprintf("Found %d negotiation(s).", len(items)),
		NextAction:     "compare_quotes",
		NegotiationIDs: ids,
		QuoteCount:     quoted,
		RejectionCount: rejected,
	}, nil
}

func (h *Handler) toolGetNegotiation(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	if h.negotiations == nil {
		return agent.ToolResult{}, fmt.Errorf("negotiation service not configured")
	}
	id := firstAgentArgString(args, "negotiationId", "id")
	if id == "" && len(run.NegotiationIDs) > 0 {
		id = run.NegotiationIDs[0]
	}
	if id == "" {
		return agent.ToolResult{}, fmt.Errorf("negotiationId required")
	}
	item, ok := h.negotiations.Get(id)
	if !ok {
		return agent.ToolResult{}, fmt.Errorf("negotiation not found")
	}
	payload := map[string]any{"negotiation": item, "nextAction": item.NextAction}
	ids, quoted, rejected := negotiationStats(payload)
	if len(ids) == 0 {
		ids = []string{id}
	}
	return agent.ToolResult{
		Content:        payload,
		Summary:        "Loaded negotiation status.",
		NextAction:     stringFromAny(payload["nextAction"]),
		NegotiationIDs: ids,
		QuoteCount:     quoted,
		RejectionCount: rejected,
	}, nil
}

func (h *Handler) toolCompareQuotes(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	if h.negotiations == nil {
		return agent.ToolResult{}, fmt.Errorf("negotiation service not configured")
	}
	ids := agentArgStringList(args, "negotiationIds")
	if len(ids) == 0 {
		ids = run.NegotiationIDs
	}
	if len(ids) == 0 {
		return agent.ToolResult{}, fmt.Errorf("negotiationIds required")
	}
	quoted := []negotiation.Negotiation{}
	rejected := []negotiation.Negotiation{}
	pending := []negotiation.Negotiation{}
	for _, id := range ids {
		item, ok := h.negotiations.Get(id)
		if !ok {
			continue
		}
		switch item.Status {
		case negotiation.StatusQuoted:
			quoted = append(quoted, item)
		case negotiation.StatusRejected:
			rejected = append(rejected, item)
		default:
			pending = append(pending, item)
		}
	}
	next := "wait_for_seller_decision"
	if len(quoted) > 0 {
		next = "create_order_plan_from_quote"
	}
	return agent.ToolResult{
		Content: map[string]any{
			"quoted":         quoted,
			"rejected":       rejected,
			"pending":        pending,
			"negotiationIds": ids,
			"quoteCount":     len(quoted),
			"rejectionCount": len(rejected),
			"nextAction":     next,
		},
		Summary:        fmt.Sprintf("%d quote(s), %d rejection(s), %d pending negotiation(s).", len(quoted), len(rejected), len(pending)),
		NextAction:     next,
		NegotiationIDs: ids,
		QuoteCount:     len(quoted),
		RejectionCount: len(rejected),
		Waiting:        len(quoted) == 0 && len(pending) > 0,
	}, nil
}

func (h *Handler) toolCreateOrderPlanFromQuote(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	body := cloneAgentArgs(args)
	ids := agentArgStringList(body, "negotiationIds")
	if len(ids) == 0 {
		ids = run.NegotiationIDs
		body["negotiationIds"] = ids
	}
	if firstAgentArgString(body, "query", "intent") == "" {
		body["query"] = run.Intent
	}
	setAgentDefault(body, "agentId", "exora-agent-runtime")
	payload, err := h.invokeJSONHandler(ctx, http.MethodPost, "/v1/order-plans/from-negotiations", body, h.CreateOrderPlanFromNegotiations)
	if err != nil {
		return agent.ToolResult{}, err
	}
	result := agent.ToolResult{
		Content:        payload,
		Summary:        stringFromAny(payload["summary"]),
		NextAction:     stringFromAny(payload["nextAction"]),
		NegotiationIDs: ids,
		Waiting:        true,
	}
	if selection, ok := payload["selectionRequest"].(map[string]any); ok {
		result.OrderPlanID = stringFromAny(selection["planId"])
	}
	if result.OrderPlanID == "" {
		result.OrderPlanID = stringFromAny(payload["planId"])
	}
	return result, nil
}

func (h *Handler) toolListOrderPlans(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	if h.orderPlans == nil {
		return agent.ToolResult{}, fmt.Errorf("order plan service not configured")
	}
	filter := orderplan.ListFilter{Status: orderplan.Status(agentArgString(args, "status"))}
	plans := h.orderPlans.List(filter)
	return agent.ToolResult{Content: map[string]any{"orderPlans": plans}, Summary: fmt.Sprintf("Found %d order plan(s).", len(plans)), NextAction: "resume_task_flow"}, nil
}

func (h *Handler) toolResumeTaskFlow(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	if h.orderPlans == nil {
		return agent.ToolResult{}, fmt.Errorf("order plan service not configured")
	}
	id := firstAgentArgString(args, "planId", "orderPlanId", "id")
	if id == "" {
		id = run.OrderPlanID
	}
	if id == "" {
		return agent.ToolResult{}, fmt.Errorf("planId required")
	}
	plan, ok := h.orderPlans.Get(id)
	if !ok {
		return agent.ToolResult{}, fmt.Errorf("order plan not found")
	}
	payload := h.orderPlanResponse(plan, false)
	next := plan.NextAction
	if next == "" {
		next = "inspect_order_plan"
	}
	payload["nextAction"] = next
	waiting := plan.Status == orderplan.StatusPendingSelection
	return agent.ToolResult{
		Content:     payload,
		Summary:     fmt.Sprintf("Order plan %s is %s.", plan.ID, plan.Status),
		NextAction:  next,
		OrderPlanID: plan.ID,
		TaskID:      plan.TaskID,
		ApprovalID:  plan.ApprovalID,
		Waiting:     waiting,
	}, nil
}

func (h *Handler) toolRequestApproval(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	if h.approvals == nil || h.tasks == nil {
		return agent.ToolResult{}, fmt.Errorf("approval service not configured")
	}
	var req approval.CreateRequest
	if err := decodeAgentArgs(args, &req); err != nil {
		return agent.ToolResult{}, err
	}
	if strings.TrimSpace(req.TaskID) == "" {
		req.TaskID = run.TaskID
	}
	if strings.TrimSpace(req.TaskID) != "" {
		t, ok := h.tasks.Get(req.TaskID)
		if !ok {
			return agent.ToolResult{}, fmt.Errorf("task not found")
		}
		req = mergeApprovalRequest(req, t)
	}
	a, err := h.approvals.Create(req)
	if err != nil {
		return agent.ToolResult{}, err
	}
	updated, err := h.tasks.SetApprovalRequest(a.TaskID, a.ID)
	if err != nil {
		return agent.ToolResult{}, err
	}
	a = decorateApproval(a, "")
	return agent.ToolResult{
		Content:    map[string]any{"approval": a, "task": updated},
		Summary:    "Approval request created.",
		NextAction: "wait_for_owner_approval",
		TaskID:     updated.ID,
		ApprovalID: a.ID,
		Waiting:    true,
	}, nil
}

func (h *Handler) toolGetArtifactManifest(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	if h.tasks == nil {
		return agent.ToolResult{}, fmt.Errorf("task service not configured")
	}
	id := firstAgentArgString(args, "taskId", "jobId", "id")
	if id == "" {
		id = run.TaskID
	}
	if id == "" {
		return agent.ToolResult{}, fmt.Errorf("taskId required")
	}
	artifacts, ok := h.tasks.ArtifactManifest(id)
	if !ok {
		return agent.ToolResult{}, fmt.Errorf("task not found")
	}
	return agent.ToolResult{Content: map[string]any{"artifacts": artifacts}, Summary: fmt.Sprintf("Found %d artifact(s).", len(artifacts)), NextAction: "verify_artifacts", TaskID: id}, nil
}

func (h *Handler) toolDockerPreflight(ctx context.Context, run agent.AgentRun, args map[string]any) (agent.ToolResult, error) {
	if h.executor == nil {
		return agent.ToolResult{}, fmt.Errorf("task executor not configured")
	}
	var target task.Task
	id := firstAgentArgString(args, "taskId", "id")
	if id != "" {
		if h.tasks == nil {
			return agent.ToolResult{}, fmt.Errorf("task service not configured")
		}
		t, ok := h.tasks.Get(id)
		if !ok {
			return agent.ToolResult{}, fmt.Errorf("task not found")
		}
		target = t
	} else if raw, ok := args["task"]; ok {
		if err := decodeAgentValue(raw, &target); err != nil {
			return agent.ToolResult{}, err
		}
	} else {
		target = task.Task{
			ID:           "docker-preflight",
			Type:         firstAgentArgString(args, "type"),
			Goal:         firstAgentArgString(args, "goal"),
			Requirements: map[string]any{},
		}
		if requirements, ok := args["requirements"].(map[string]any); ok {
			target.Requirements = requirements
		}
		if docker, ok := args["docker"]; ok {
			target.Requirements["docker"] = docker
		}
	}
	var runReq task.RunRequest
	_ = decodeAgentArgs(args, &runReq)
	runReq.Runtime = "docker"
	spec, err := h.executor.ValidateDockerTask(target, runReq)
	if err != nil {
		return agent.ToolResult{}, err
	}
	return agent.ToolResult{
		Content:    map[string]any{"allowed": true, "docker": spec},
		Summary:    "Docker task passed provider preflight.",
		NextAction: "quote_or_track_job",
		TaskID:     target.ID,
	}, nil
}

func (h *Handler) searchAgentCards(ctx context.Context, role string, query string) map[string]any {
	role = strings.TrimSpace(role)
	query = strings.TrimSpace(query)
	cloudURL := strings.TrimRight(strings.TrimSpace(h.cardPublisher.CloudURL), "/")
	if cloudURL != "" {
		endpoint, err := url.Parse(cloudURL + "/v1/agent-cards")
		if err == nil {
			q := endpoint.Query()
			if role != "" {
				q.Set("role", role)
			}
			if query != "" {
				q.Set("q", query)
			}
			endpoint.RawQuery = q.Encode()
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
			if err == nil {
				client := h.cardPublisher.Client
				if client == nil {
					client = http.DefaultClient
				}
				resp, err := client.Do(req)
				if err == nil {
					defer resp.Body.Close()
					var payload map[string]any
					if resp.StatusCode >= 200 && resp.StatusCode < 300 && json.NewDecoder(resp.Body).Decode(&payload) == nil {
						payload["source"] = "cloud"
						return payload
					}
				}
			}
		}
	}
	cards := h.localAgentCards(role, query)
	return map[string]any{"cards": cards, "source": "local"}
}

func (h *Handler) localAgentCards(role string, query string) []agentcard.AgentCard {
	if h.agentCards == nil {
		return []agentcard.AgentCard{}
	}
	query = strings.ToLower(strings.TrimSpace(query))
	role = strings.ToLower(strings.TrimSpace(role))
	out := []agentcard.AgentCard{}
	for _, card := range h.agentCards.List() {
		if role != "" && string(card.Role) != role {
			continue
		}
		if query != "" {
			data, _ := json.Marshal(card)
			if !strings.Contains(strings.ToLower(string(data)), query) {
				continue
			}
		}
		out = append(out, card)
	}
	return out
}

func (h *Handler) invokeJSONHandler(ctx context.Context, method string, path string, body map[string]any, handler http.HandlerFunc) (map[string]any, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req := httptest.NewRequest(method, "http://127.0.0.1"+path, bytes.NewReader(data)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler(rec, req)
	resp := rec.Result()
	defer resp.Body.Close()
	out, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if len(bytes.TrimSpace(out)) > 0 {
		if err := json.Unmarshal(out, &payload); err != nil {
			return nil, err
		}
	} else {
		payload = map[string]any{}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("handler returned %s: %s", resp.Status, strings.TrimSpace(string(out)))
	}
	return payload, nil
}

func decodeAgentArgs(args map[string]any, out any) error {
	return decodeAgentValue(args, out)
}

func decodeAgentValue(value any, out any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("invalid tool args: %w", err)
	}
	return nil
}

func cloneAgentArgs(args map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range args {
		out[key] = value
	}
	return out
}

func setAgentDefault(args map[string]any, key string, value any) {
	if _, ok := args[key]; !ok {
		args[key] = value
	}
}

func firstAgentArgString(args map[string]any, names ...string) string {
	for _, name := range names {
		if value := agentArgString(args, name); value != "" {
			return value
		}
	}
	return ""
}

func agentArgString(args map[string]any, name string) string {
	value, ok := args[name]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func agentArgInt(args map[string]any, name string) int {
	value, ok := args[name]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return typed
	case float64:
		return int(typed)
	case json.Number:
		var out int
		_, _ = fmt.Sscanf(string(typed), "%d", &out)
		return out
	case string:
		var out int
		_, _ = fmt.Sscanf(strings.TrimSpace(typed), "%d", &out)
		return out
	default:
		return 0
	}
}

func agentArgStringList(args map[string]any, name string) []string {
	value, ok := args[name]
	if !ok || value == nil {
		return nil
	}
	switch typed := value.(type) {
	case []string:
		out := []string{}
		for _, item := range typed {
			if strings.TrimSpace(item) != "" {
				out = append(out, strings.TrimSpace(item))
			}
		}
		return out
	case []any:
		out := []string{}
		for _, item := range typed {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				out = append(out, strings.TrimSpace(text))
			}
		}
		return out
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return []string{strings.TrimSpace(typed)}
	default:
		return nil
	}
}

func negotiationStats(payload map[string]any) ([]string, int, int) {
	ids := []string{}
	quoted, rejected := 0, 0
	var walk func(any)
	walk = func(value any) {
		switch typed := value.(type) {
		case map[string]any:
			if id, _ := typed["negotiationId"].(string); strings.TrimSpace(id) != "" {
				ids = append(ids, strings.TrimSpace(id))
				status, _ := typed["status"].(string)
				switch strings.ToLower(strings.TrimSpace(status)) {
				case "quoted":
					quoted++
				case "rejected":
					rejected++
				}
			}
			for _, child := range typed {
				walk(child)
			}
		case []any:
			for _, child := range typed {
				walk(child)
			}
		}
	}
	walk(payload)
	return uniqueStrings(ids), quoted, rejected
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func resourceTypeFromString(value string) resource.Type {
	typed := resource.Type(strings.TrimSpace(value))
	if resource.IsKnownType(typed) {
		return typed
	}
	return ""
}
