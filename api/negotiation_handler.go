package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/agentcard"
	"github.com/exora-dock/exora-dock/internal/market"
	"github.com/exora-dock/exora-dock/internal/negotiation"
	"github.com/exora-dock/exora-dock/internal/orderplan"
	"github.com/exora-dock/exora-dock/internal/providerprotocol"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/go-chi/chi/v5"
)

type createNegotiationsRequest struct {
	Intent            string                    `json:"intent,omitempty"`
	Query             string                    `json:"query,omitempty"`
	ProjectPath       string                    `json:"projectPath,omitempty"`
	WorkUID           string                    `json:"workUid,omitempty"`
	BuyerAgentCardID  string                    `json:"buyerAgentCardId,omitempty"`
	SellerAgentCardID string                    `json:"sellerAgentCardId,omitempty"`
	RequesterPubkey   string                    `json:"requesterPubkey,omitempty"`
	AgentID           string                    `json:"agentId,omitempty"`
	ProviderPubkey    string                    `json:"providerPubkey,omitempty"`
	ResourceID        string                    `json:"resourceId,omitempty"`
	ProviderEndpoint  string                    `json:"providerEndpoint,omitempty"`
	Draft             market.OrderDraft         `json:"draft,omitempty"`
	Option            market.OrderDraftOption   `json:"option,omitempty"`
	Options           []market.OrderDraftOption `json:"options,omitempty"`
	Constraints       map[string]any            `json:"constraints,omitempty"`
	TaskTemplate      task.CreateRequest        `json:"taskTemplate,omitempty"`
	MaxCandidates     int                       `json:"maxCandidates,omitempty"`
}

type createOrderPlanFromNegotiationsRequest struct {
	NegotiationIDs  []string `json:"negotiationIds"`
	Query           string   `json:"query,omitempty"`
	ProjectPath     string   `json:"projectPath,omitempty"`
	WorkUID         string   `json:"workUid,omitempty"`
	AgentID         string   `json:"agentId,omitempty"`
	RequesterPubkey string   `json:"requesterPubkey,omitempty"`
}

type coordinateBuyerWorkRequest struct {
	Query            string             `json:"query,omitempty"`
	Intent           string             `json:"intent,omitempty"`
	ProjectPath      string             `json:"projectPath,omitempty"`
	WorkUID          string             `json:"workUid,omitempty"`
	RequesterPubkey  string             `json:"requesterPubkey,omitempty"`
	AgentID          string             `json:"agentId,omitempty"`
	Constraints      map[string]any     `json:"constraints,omitempty"`
	TaskTemplate     task.CreateRequest `json:"taskTemplate,omitempty"`
	MaxCandidates    int                `json:"maxCandidates,omitempty"`
	MaxResults       int                `json:"maxResults,omitempty"`
	MaxOptions       int                `json:"maxOptions,omitempty"`
	FallbackToQuotes bool               `json:"fallbackToQuotes,omitempty"`
}

func (h *Handler) CoordinateBuyerWork(w http.ResponseWriter, r *http.Request) {
	var req coordinateBuyerWorkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	intent := firstNonEmpty(req.Intent, req.Query, req.TaskTemplate.Goal)
	if strings.TrimSpace(intent) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "query required"})
		return
	}
	if strings.TrimSpace(req.RequesterPubkey) == "" {
		req.RequesterPubkey = h.localRequesterPubkey()
	}
	if strings.TrimSpace(req.AgentID) == "" {
		req.AgentID = "exora-buyer-work"
	}
	if strings.TrimSpace(req.ProjectPath) == "" {
		req.ProjectPath = req.TaskTemplate.ProjectPath
	}
	if strings.TrimSpace(req.WorkUID) == "" {
		req.WorkUID = req.TaskTemplate.WorkUID
	}
	if strings.TrimSpace(req.TaskTemplate.ProjectPath) == "" {
		req.TaskTemplate.ProjectPath = req.ProjectPath
	}
	if strings.TrimSpace(req.TaskTemplate.WorkUID) == "" {
		req.TaskTemplate.WorkUID = req.WorkUID
	}
	if strings.TrimSpace(req.TaskTemplate.RequesterPubkey) == "" {
		req.TaskTemplate.RequesterPubkey = req.RequesterPubkey
	}
	if strings.TrimSpace(req.TaskTemplate.AgentID) == "" {
		req.TaskTemplate.AgentID = req.AgentID
	}
	maxCandidates := req.MaxCandidates
	if maxCandidates <= 0 {
		maxCandidates = 3
	}
	agentCardSearch := h.searchAgentCards(r.Context(), string(agentcard.RoleSeller), intent)
	negotiationBody := map[string]any{
		"intent":          intent,
		"query":           intent,
		"projectPath":     req.ProjectPath,
		"workUid":         req.WorkUID,
		"requesterPubkey": req.RequesterPubkey,
		"agentId":         req.AgentID,
		"constraints":     req.Constraints,
		"taskTemplate":    req.TaskTemplate,
		"maxCandidates":   maxCandidates,
	}
	negotiationPayload, err := h.invokeJSONHandler(r.Context(), http.MethodPost, "/v1/negotiations", negotiationBody, h.CreateNegotiations)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	ids, quoted, rejected := negotiationStats(negotiationPayload)
	result := map[string]any{
		"mode":            "negotiation_first",
		"query":           intent,
		"projectPath":     req.ProjectPath,
		"workUid":         req.WorkUID,
		"agentCardSearch": agentCardSearch,
		"negotiations":    negotiationPayload["negotiations"],
		"negotiationIds":  ids,
		"quoteCount":      quoted,
		"rejectionCount":  rejected,
		"summary":         stringFromAny(negotiationPayload["summary"]),
		"nextAction":      stringFromAny(negotiationPayload["nextAction"]),
	}
	if events, ok := negotiationPayload["events"]; ok {
		result["events"] = events
	}
	if quoted > 0 {
		planBody := map[string]any{
			"negotiationIds":  ids,
			"query":           intent,
			"projectPath":     req.ProjectPath,
			"workUid":         req.WorkUID,
			"requesterPubkey": req.RequesterPubkey,
			"agentId":         req.AgentID,
		}
		planPayload, err := h.invokeJSONHandler(r.Context(), http.MethodPost, "/v1/order-plans/from-negotiations", planBody, h.CreateOrderPlanFromNegotiations)
		if err != nil {
			result["nextAction"] = "review_negotiations_before_order_plan"
			result["orderPlanError"] = err.Error()
			writeJSON(w, http.StatusAccepted, result)
			return
		}
		for key, value := range planPayload {
			result[key] = value
		}
		if plan, ok := planPayload["orderPlan"].(map[string]any); ok {
			result["orderDraftOptions"] = plan["options"]
		}
		result["summary"] = firstNonEmpty(stringFromAny(planPayload["summary"]), fmt.Sprintf("Created owner seller choice from %d quoted negotiation(s).", quoted))
		result["nextAction"] = firstNonEmpty(stringFromAny(planPayload["nextAction"]), "choose_seller_option")
		writeJSON(w, http.StatusCreated, result)
		return
	}
	if result["nextAction"] == "" {
		result["nextAction"] = "wait_for_seller_decision"
	}
	writeJSON(w, http.StatusAccepted, result)
}

func (h *Handler) CreateNegotiations(w http.ResponseWriter, r *http.Request) {
	if h.negotiations == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "negotiation service not configured"})
		return
	}
	var req createNegotiationsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	intent := firstNonEmpty(req.Intent, req.Query, req.Draft.Goal, req.TaskTemplate.Goal)
	if strings.TrimSpace(intent) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "intent required"})
		return
	}
	if strings.TrimSpace(req.ProjectPath) == "" {
		req.ProjectPath = req.TaskTemplate.ProjectPath
	}
	if strings.TrimSpace(req.WorkUID) == "" {
		req.WorkUID = req.TaskTemplate.WorkUID
	}
	if strings.TrimSpace(req.RequesterPubkey) == "" {
		req.RequesterPubkey = h.localRequesterPubkey()
	}
	if strings.TrimSpace(req.AgentID) == "" {
		req.AgentID = "exora-agent-runtime"
	}
	options := h.negotiationOptions(req, intent)
	if len(options) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"negotiations": []negotiation.Negotiation{},
			"summary":      "No seller candidates were available for negotiation.",
			"nextAction":   "search_agent_cards_or_refine_task",
		})
		return
	}

	created := make([]negotiation.Negotiation, 0, len(options))
	events := []string{}
	for _, option := range options {
		draft := option.Draft
		if strings.TrimSpace(draft.Goal) == "" {
			draft = req.Draft
		}
		if strings.TrimSpace(draft.Goal) == "" {
			draft.Goal = intent
		}
		if strings.TrimSpace(draft.RequesterPubkey) == "" {
			draft.RequesterPubkey = req.RequesterPubkey
		}
		if strings.TrimSpace(draft.AgentID) == "" {
			draft.AgentID = req.AgentID
		}
		if strings.TrimSpace(draft.ProjectPath) == "" {
			draft.ProjectPath = req.ProjectPath
		}
		if strings.TrimSpace(draft.WorkUID) == "" {
			draft.WorkUID = req.WorkUID
		}
		if strings.TrimSpace(draft.ProviderPubkey) == "" {
			draft.ProviderPubkey = firstNonEmpty(option.ProviderPubkey, req.ProviderPubkey)
		}
		if strings.TrimSpace(draft.ResourceID) == "" {
			draft.ResourceID = firstNonEmpty(option.ResourceID, req.ResourceID)
		}
		n, err := h.negotiations.Create(negotiation.CreateRequest{
			Intent:            intent,
			BuyerAgentCardID:  req.BuyerAgentCardID,
			SellerAgentCardID: firstNonEmpty(req.SellerAgentCardID, option.ProviderPubkey),
			RequesterPubkey:   req.RequesterPubkey,
			AgentID:           req.AgentID,
			ProviderPubkey:    firstNonEmpty(option.ProviderPubkey, req.ProviderPubkey),
			ResourceID:        firstNonEmpty(option.ResourceID, req.ResourceID),
			ProviderEndpoint:  firstNonEmpty(option.ProviderEndpoint, req.ProviderEndpoint),
			Draft:             draft,
			Messages: []negotiation.Message{{
				Role:    "buyer",
				Content: intent,
			}},
			ExpiresAt: firstNonEmpty(option.ExpiresAt, time.Now().UTC().Add(30*time.Minute).Format(time.RFC3339)),
		})
		if err != nil {
			events = append(events, err.Error())
			continue
		}
		if strings.TrimSpace(n.ProviderEndpoint) == "" {
			n, _ = h.negotiations.MarkRejected(n.ID, negotiation.RejectRequest{Reason: "provider endpoint missing"})
			created = append(created, n)
			continue
		}
		reply, err := h.requestProviderNegotiation(r, n)
		if err != nil {
			n, _ = h.negotiations.MarkRejected(n.ID, negotiation.RejectRequest{Reason: err.Error()})
			created = append(created, n)
			continue
		}
		if updated, ok, err := h.applyNegotiationReply(n.ID, reply, true); err == nil && ok {
			n = updated
		} else if err != nil {
			n, _ = h.negotiations.MarkRejected(n.ID, negotiation.RejectRequest{Reason: err.Error()})
		}
		created = append(created, n)
	}
	summary, next := negotiationSummary(created)
	payload := map[string]any{"negotiations": created, "summary": summary, "nextAction": next}
	if len(events) > 0 {
		payload["events"] = events
	}
	writeJSON(w, http.StatusAccepted, payload)
}

func (h *Handler) ListNegotiations(w http.ResponseWriter, r *http.Request) {
	if h.negotiations == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "negotiation service not configured"})
		return
	}
	filter := negotiation.ListFilter{
		Status:          negotiation.Status(strings.TrimSpace(r.URL.Query().Get("status"))),
		ProviderPubkey:  strings.TrimSpace(r.URL.Query().Get("providerPubkey")),
		RequesterPubkey: strings.TrimSpace(r.URL.Query().Get("requesterPubkey")),
		OrderPlanID:     strings.TrimSpace(r.URL.Query().Get("orderPlanId")),
	}
	writeJSON(w, http.StatusOK, map[string]any{"negotiations": h.negotiations.List(filter)})
}

func (h *Handler) GetNegotiation(w http.ResponseWriter, r *http.Request) {
	if h.negotiations == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "negotiation service not configured"})
		return
	}
	n, ok := h.negotiations.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "negotiation not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"negotiation": n})
}

func (h *Handler) ResumeNegotiation(w http.ResponseWriter, r *http.Request) {
	if h.negotiations == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "negotiation service not configured"})
		return
	}
	n, ok := h.negotiations.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "negotiation not found"})
		return
	}
	if (n.Status == negotiation.StatusPendingSellerDecision || n.Status == negotiation.StatusManualReview) && strings.TrimSpace(n.ProviderEndpoint) != "" {
		if reply, err := h.fetchProviderNegotiation(r, n); err == nil {
			if updated, ok, err := h.applyNegotiationReply(n.ID, reply, true); err == nil && ok {
				n = updated
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"negotiation": n, "nextAction": n.NextAction})
}

func (h *Handler) CancelNegotiation(w http.ResponseWriter, r *http.Request) {
	if h.negotiations == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "negotiation service not configured"})
		return
	}
	var req struct {
		UserNote string `json:"userNote"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	n, err := h.negotiations.Cancel(chi.URLParam(r, "id"), req.UserNote)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"negotiation": n})
}

func (h *Handler) CreateProviderNegotiation(w http.ResponseWriter, r *http.Request) {
	if h.negotiations == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "negotiation service not configured"})
		return
	}
	var req providerprotocol.NegotiationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := providerprotocol.ValidateTimestamp(req.Timestamp); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}
	payload, err := providerprotocol.NegotiationRequestPayload(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := providerprotocol.Verify(req.RequesterPubkey, req.Signature, payload); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}
	n, ok := h.negotiations.Get(req.NegotiationID)
	if !ok {
		messages := make([]negotiation.Message, 0, len(req.Messages))
		for _, msg := range req.Messages {
			messages = append(messages, negotiation.Message{Role: msg.Role, Content: msg.Content})
		}
		n, err = h.negotiations.Create(negotiation.CreateRequest{
			ID:                req.NegotiationID,
			Intent:            req.Intent,
			BuyerAgentCardID:  req.BuyerAgentCardID,
			SellerAgentCardID: req.SellerAgentCardID,
			RequesterPubkey:   req.RequesterPubkey,
			AgentID:           req.AgentID,
			ProviderPubkey:    firstNonEmpty(req.ProviderPubkey, h.selfPubkey),
			ResourceID:        req.ResourceID,
			Draft:             req.Draft,
			Messages:          messages,
			ExpiresAt:         req.ExpiresAt,
		})
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		n = h.preflightProviderNegotiation(n)
	}
	reply := h.buildNegotiationReply(n)
	if isTerminalNegotiationReply(reply.Status) {
		if err := h.signNegotiationReply(&reply); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
	}
	writeJSON(w, http.StatusAccepted, reply)
}

func (h *Handler) GetProviderNegotiation(w http.ResponseWriter, r *http.Request) {
	if h.negotiations == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "negotiation service not configured"})
		return
	}
	n, ok := h.negotiations.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "provider negotiation not found"})
		return
	}
	reply := h.buildNegotiationReply(n)
	if isTerminalNegotiationReply(reply.Status) {
		if err := h.signNegotiationReply(&reply); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
	}
	writeJSON(w, http.StatusOK, reply)
}

func (h *Handler) CreateOrderPlanFromNegotiations(w http.ResponseWriter, r *http.Request) {
	if h.negotiations == nil || h.orderPlans == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "order plan or negotiation service not configured"})
		return
	}
	var req createOrderPlanFromNegotiationsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	ids := compactStringList(req.NegotiationIDs)
	if len(ids) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "negotiationIds required"})
		return
	}
	options := []market.OrderDraftOption{}
	candidates := []orderplan.CandidateState{}
	events := []orderplan.Event{}
	query := strings.TrimSpace(req.Query)
	projectPath := strings.TrimSpace(req.ProjectPath)
	workUID := strings.TrimSpace(req.WorkUID)
	requester := strings.TrimSpace(req.RequesterPubkey)
	agentID := strings.TrimSpace(req.AgentID)
	expiresAt := ""
	for _, id := range ids {
		n, ok := h.negotiations.Get(id)
		if !ok || n.Status != negotiation.StatusQuoted || n.Quote == nil {
			continue
		}
		if query == "" {
			query = n.Intent
		}
		if requester == "" {
			requester = n.RequesterPubkey
		}
		if agentID == "" {
			agentID = n.AgentID
		}
		if projectPath == "" {
			projectPath = n.Draft.ProjectPath
		}
		if workUID == "" {
			workUID = n.Draft.WorkUID
		}
		optionID := fmt.Sprintf("opt_%d", len(options)+1)
		if expiresAt == "" || (n.Quote.ExpiresAt != "" && n.Quote.ExpiresAt < expiresAt) {
			expiresAt = n.Quote.ExpiresAt
		}
		options = append(options, market.OrderDraftOption{
			OptionID:         optionID,
			ResourceID:       n.ResourceID,
			ProviderPubkey:   n.Quote.ProviderPubkey,
			ProviderEndpoint: n.ProviderEndpoint,
			Score:            100 - len(options),
			Reason:           firstNonEmpty(n.Quote.ExecutionPlanSummary, n.Quote.Notes, "formal seller quote"),
			QuoteID:          n.Quote.ID,
			RealtimeStatus:   "quoted",
			ConfirmedAt:      n.Quote.CreatedAt,
			ExpiresAt:        n.Quote.ExpiresAt,
			PriceSnapshot: market.PriceSnapshot{
				PricePerUnit: n.Quote.PriceAmount,
				BillingUnit:  "task",
				Currency:     firstNonEmpty(n.Quote.Currency, "USD"),
				Availability: "quoted",
			},
			Draft: n.Draft,
		})
		candidates = append(candidates, orderplan.CandidateState{
			OptionID:       optionID,
			ResourceID:     n.ResourceID,
			ProviderPubkey: n.Quote.ProviderPubkey,
			Endpoint:       n.ProviderEndpoint,
			Status:         "quoted",
			Message:        firstNonEmpty(n.Quote.Notes, n.Quote.ExecutionPlanSummary),
			QuoteID:        n.Quote.ID,
			PriceAmount:    n.Quote.PriceAmount,
			Currency:       firstNonEmpty(n.Quote.Currency, "USD"),
			ExpiresAt:      n.Quote.ExpiresAt,
			UpdatedAt:      n.UpdatedAt,
		})
		events = append(events, orderplan.Event{Type: "seller_negotiation_quoted", Message: firstNonEmpty(n.Quote.Notes, n.Quote.ExecutionPlanSummary), OptionID: optionID})
	}
	if len(options) == 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "no quoted negotiations available"})
		return
	}
	plan, err := h.orderPlans.Create(orderplan.CreateRequest{
		Query:            query,
		ProjectPath:      projectPath,
		WorkUID:          workUID,
		RequesterPubkey:  requester,
		AgentID:          agentID,
		Options:          options,
		RealtimeRequired: true,
		Candidates:       candidates,
		Events:           events,
		ExpiresAt:        expiresAt,
	})
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	for _, id := range ids {
		_, _ = h.negotiations.AttachOrderPlan(id, plan.ID)
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"orderPlan": plan,
		"selectionRequest": market.SelectionRequestSummary{
			PlanID:      plan.ID,
			Status:      string(plan.Status),
			ApprovalURL: requestBaseURL(r) + "/order-plans/" + plan.ID,
			ExpiresAt:   plan.ExpiresAt,
			NextAction:  plan.NextAction,
		},
		"summary":    fmt.Sprintf("Created order plan from %d quoted negotiation(s).", len(options)),
		"nextAction": plan.NextAction,
	})
}

func (h *Handler) negotiationOptions(req createNegotiationsRequest, intent string) []market.OrderDraftOption {
	maxCandidates := req.MaxCandidates
	if maxCandidates <= 0 {
		maxCandidates = 3
	}
	if maxCandidates > market.MaxOrderOptions {
		maxCandidates = market.MaxOrderOptions
	}
	options := append([]market.OrderDraftOption(nil), req.Options...)
	if strings.TrimSpace(req.Option.OptionID) != "" || strings.TrimSpace(req.Option.ProviderPubkey) != "" || strings.TrimSpace(req.Option.ProviderEndpoint) != "" {
		options = append([]market.OrderDraftOption{req.Option}, options...)
	}
	if len(options) == 0 && (strings.TrimSpace(req.ProviderEndpoint) != "" || strings.TrimSpace(req.ProviderPubkey) != "" || strings.TrimSpace(req.ResourceID) != "" || strings.TrimSpace(req.Draft.Goal) != "") {
		draft := req.Draft
		if strings.TrimSpace(draft.ProjectPath) == "" {
			draft.ProjectPath = req.ProjectPath
		}
		options = append(options, market.OrderDraftOption{
			OptionID:         "opt_1",
			ResourceID:       req.ResourceID,
			ProviderPubkey:   req.ProviderPubkey,
			ProviderEndpoint: req.ProviderEndpoint,
			ExpiresAt:        time.Now().UTC().Add(30 * time.Minute).Format(time.RFC3339),
			Draft:            draft,
		})
	}
	if len(options) == 0 && h.resources != nil {
		search := market.Search(market.SearchRequest{
			Query:               intent,
			ProjectPath:         req.ProjectPath,
			WorkUID:             req.WorkUID,
			RequesterPubkey:     req.RequesterPubkey,
			AgentID:             req.AgentID,
			Constraints:         req.Constraints,
			MaxResults:          maxCandidates,
			PrepareOrderOptions: true,
			MaxOptions:          maxCandidates,
			TaskTemplate:        req.TaskTemplate,
		}, h.resources)
		options = search.OrderDraftOptions
	}
	if len(options) > maxCandidates {
		options = options[:maxCandidates]
	}
	return options
}

func (h *Handler) requestProviderNegotiation(r *http.Request, n negotiation.Negotiation) (providerprotocol.NegotiationReply, error) {
	if h.wallets == nil {
		return providerprotocol.NegotiationReply{}, fmt.Errorf("local wallet keypair required for signed negotiation request")
	}
	req := providerprotocol.NegotiationRequest{
		NegotiationID:     n.ID,
		RequesterPubkey:   n.RequesterPubkey,
		AgentID:           n.AgentID,
		BuyerAgentCardID:  n.BuyerAgentCardID,
		SellerAgentCardID: n.SellerAgentCardID,
		ProviderPubkey:    n.ProviderPubkey,
		ResourceID:        n.ResourceID,
		Intent:            n.Intent,
		Draft:             n.Draft,
		ExpiresAt:         n.ExpiresAt,
		Timestamp:         time.Now().UTC().Format(time.RFC3339),
	}
	for _, msg := range n.Messages {
		req.Messages = append(req.Messages, providerprotocol.NegotiationMessage{Role: msg.Role, Content: msg.Content})
	}
	payload, err := providerprotocol.NegotiationRequestPayload(req)
	if err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	address, signature, err := h.wallets.SignPayload(payload)
	if err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	if strings.TrimSpace(req.RequesterPubkey) == "" {
		req.RequesterPubkey = address
		req.Draft.RequesterPubkey = address
		payload, err = providerprotocol.NegotiationRequestPayload(req)
		if err != nil {
			return providerprotocol.NegotiationReply{}, err
		}
		_, signature, err = h.wallets.SignPayload(payload)
		if err != nil {
			return providerprotocol.NegotiationReply{}, err
		}
	} else if req.RequesterPubkey != address {
		return providerprotocol.NegotiationReply{}, fmt.Errorf("requester pubkey must match local signing wallet")
	}
	req.Signature = signature
	endpoint, err := providerEndpoint(n.ProviderEndpoint, "/v1/provider/negotiations")
	if err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	data, _ := json.Marshal(req)
	client := &http.Client{Timeout: 10 * time.Second}
	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(httpReq)
	if err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return providerprotocol.NegotiationReply{}, fmt.Errorf("provider negotiation returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var reply providerprotocol.NegotiationReply
	if err := json.Unmarshal(body, &reply); err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	if err := verifyNegotiationReply(reply); err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	return reply, nil
}

func (h *Handler) fetchProviderNegotiation(r *http.Request, n negotiation.Negotiation) (providerprotocol.NegotiationReply, error) {
	endpoint, err := providerEndpoint(n.ProviderEndpoint, "/v1/provider/negotiations/"+url.PathEscape(n.ID))
	if err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Get(endpoint)
	if err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return providerprotocol.NegotiationReply{}, fmt.Errorf("provider negotiation returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var reply providerprotocol.NegotiationReply
	if err := json.Unmarshal(body, &reply); err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	if err := verifyNegotiationReply(reply); err != nil {
		return providerprotocol.NegotiationReply{}, err
	}
	return reply, nil
}

func (h *Handler) applyNegotiationReply(id string, reply providerprotocol.NegotiationReply, verified bool) (negotiation.Negotiation, bool, error) {
	status := strings.ToLower(strings.TrimSpace(reply.Status))
	switch status {
	case "quoted":
		if !verified {
			if err := verifyNegotiationReply(reply); err != nil {
				return negotiation.Negotiation{}, false, err
			}
		}
		n, err := h.negotiations.MarkQuoted(id, negotiation.QuoteRequest{
			QuoteID:              reply.QuoteID,
			ProviderPubkey:       reply.ProviderPubkey,
			ResourceID:           reply.ResourceID,
			PriceAmount:          reply.PriceAmount,
			Currency:             reply.Currency,
			EstimatedSeconds:     reply.EstimatedSeconds,
			RequiredInputs:       reply.RequiredInputs,
			RequiredPermissions:  reply.RequiredPermissions,
			ExecutionPlanSummary: reply.ExecutionPlanSummary,
			FailurePolicy:        reply.FailurePolicy,
			DeliveryFormat:       reply.DeliveryFormat,
			DataProvenance:       reply.DataProvenance,
			RetentionCommitment:  reply.RetentionCommitment,
			SellerApprovalMode:   reply.SellerApprovalMode,
			Notes:                reply.Notes,
			Runtime:              reply.Runtime,
			Docker:               reply.Docker,
			ExpiresAt:            reply.ExpiresAt,
			Signature:            reply.Signature,
		})
		return n, true, err
	case "rejected":
		if !verified {
			if err := verifyNegotiationReply(reply); err != nil {
				return negotiation.Negotiation{}, false, err
			}
		}
		n, err := h.negotiations.MarkRejected(id, negotiation.RejectRequest{
			Reason:        firstNonEmpty(reply.RejectReason, reply.Error, "provider rejected negotiation"),
			RiskSummary:   reply.RejectRiskSummary,
			MissingInputs: reply.RejectMissingInputs,
			Signature:     reply.Signature,
		})
		return n, true, err
	case "manual_review":
		n, err := h.negotiations.MarkManualReview(id, firstNonEmpty(reply.Notes, reply.Error, "seller manual review required"))
		return n, true, err
	default:
		return negotiation.Negotiation{}, false, nil
	}
}

func (h *Handler) preflightProviderNegotiation(n negotiation.Negotiation) negotiation.Negotiation {
	if h.resources != nil && strings.TrimSpace(n.ResourceID) != "" {
		res, ok := h.resources.Get(n.ResourceID)
		if !ok {
			updated, _ := h.negotiations.MarkRejected(n.ID, negotiation.RejectRequest{Reason: "resource unavailable"})
			return updated
		}
		provider := firstNonEmpty(res.ProviderPubkey, res.Provider)
		if strings.TrimSpace(n.ProviderPubkey) != "" && provider != "" && n.ProviderPubkey != provider {
			updated, _ := h.negotiations.MarkRejected(n.ID, negotiation.RejectRequest{Reason: "resource belongs to a different provider"})
			return updated
		}
		if !strings.EqualFold(res.Availability, "available") {
			updated, _ := h.negotiations.MarkRejected(n.ID, negotiation.RejectRequest{Reason: "resource unavailable"})
			return updated
		}
	}
	if h.executor != nil {
		provider := firstNonEmpty(n.ProviderPubkey, h.selfPubkey)
		temp := task.Task{
			ID:              "negotiation-" + n.ID,
			RequesterPubkey: n.RequesterPubkey,
			AgentID:         n.AgentID,
			Type:            n.Draft.Type,
			Goal:            n.Draft.Goal,
			Requirements:    n.Draft.Requirements,
			TimeoutSeconds:  n.Draft.TimeoutSeconds,
			ProviderPubkey:  provider,
		}
		if _, err := h.executor.ValidateDockerTask(temp, task.RunRequest{ProviderPubkey: provider, Runtime: "docker"}); err != nil {
			updated, _ := h.negotiations.MarkRejected(n.ID, negotiation.RejectRequest{Reason: err.Error()})
			return updated
		}
	}
	return n
}

func (h *Handler) buildNegotiationReply(n negotiation.Negotiation) providerprotocol.NegotiationReply {
	reply := providerprotocol.NegotiationReply{
		NegotiationID:  n.ID,
		Status:         string(n.Status),
		ProviderPubkey: firstNonEmpty(n.ProviderPubkey, h.selfPubkey),
		ResourceID:     n.ResourceID,
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
	}
	switch n.Status {
	case negotiation.StatusQuoted:
		if n.Quote != nil {
			reply.Status = "quoted"
			reply.ProviderPubkey = firstNonEmpty(n.Quote.ProviderPubkey, reply.ProviderPubkey)
			reply.ResourceID = firstNonEmpty(n.Quote.ResourceID, reply.ResourceID)
			reply.QuoteID = n.Quote.ID
			reply.PriceAmount = n.Quote.PriceAmount
			reply.Currency = n.Quote.Currency
			reply.EstimatedSeconds = n.Quote.EstimatedSeconds
			reply.RequiredInputs = n.Quote.RequiredInputs
			reply.RequiredPermissions = n.Quote.RequiredPermissions
			reply.ExecutionPlanSummary = n.Quote.ExecutionPlanSummary
			reply.FailurePolicy = n.Quote.FailurePolicy
			reply.DeliveryFormat = n.Quote.DeliveryFormat
			reply.DataProvenance = n.Quote.DataProvenance
			reply.RetentionCommitment = n.Quote.RetentionCommitment
			reply.SellerApprovalMode = n.Quote.SellerApprovalMode
			reply.Notes = n.Quote.Notes
			reply.Runtime = n.Quote.Runtime
			reply.Docker = n.Quote.Docker
			reply.ExpiresAt = n.Quote.ExpiresAt
		}
	case negotiation.StatusRejected:
		reply.Status = "rejected"
		if n.Rejection != nil {
			reply.RejectReason = n.Rejection.Reason
			reply.RejectRiskSummary = n.Rejection.RiskSummary
			reply.RejectMissingInputs = n.Rejection.MissingInputs
			reply.Error = n.Rejection.Reason
		} else {
			reply.Error = firstNonEmpty(n.Error, "seller rejected negotiation")
		}
	case negotiation.StatusManualReview:
		reply.Status = "manual_review"
		reply.Notes = firstNonEmpty(n.Error, "seller manual review required")
	default:
		reply.Status = "pending_seller_decision"
		reply.Notes = "Seller agent has not returned a quote or rejection yet."
	}
	return reply
}

func (h *Handler) signNegotiationReply(reply *providerprotocol.NegotiationReply) error {
	if h.wallets == nil {
		return fmt.Errorf("provider local wallet keypair required for signed negotiation response")
	}
	payload, err := providerprotocol.NegotiationReplyPayload(*reply)
	if err != nil {
		return err
	}
	address, signature, err := h.wallets.SignPayload(payload)
	if err != nil {
		return err
	}
	if strings.TrimSpace(reply.ProviderPubkey) == "" {
		reply.ProviderPubkey = address
		payload, err = providerprotocol.NegotiationReplyPayload(*reply)
		if err != nil {
			return err
		}
		_, signature, err = h.wallets.SignPayload(payload)
		if err != nil {
			return err
		}
	} else if reply.ProviderPubkey != address {
		return fmt.Errorf("provider pubkey must match local signing wallet")
	}
	reply.Signature = signature
	return nil
}

func verifyNegotiationReply(reply providerprotocol.NegotiationReply) error {
	if !isTerminalNegotiationReply(reply.Status) {
		return nil
	}
	if strings.TrimSpace(reply.Signature) == "" {
		return fmt.Errorf("provider negotiation response missing signature")
	}
	payload, err := providerprotocol.NegotiationReplyPayload(reply)
	if err != nil {
		return err
	}
	return providerprotocol.Verify(reply.ProviderPubkey, reply.Signature, payload)
}

func isTerminalNegotiationReply(status string) bool {
	status = strings.ToLower(strings.TrimSpace(status))
	return status == "quoted" || status == "rejected"
}

func negotiationSummary(items []negotiation.Negotiation) (string, string) {
	quoted, rejected, pending, manual := 0, 0, 0, 0
	for _, item := range items {
		switch item.Status {
		case negotiation.StatusQuoted:
			quoted++
		case negotiation.StatusRejected:
			rejected++
		case negotiation.StatusManualReview:
			manual++
		default:
			pending++
		}
	}
	switch {
	case quoted > 0:
		return fmt.Sprintf("Received %d seller quote(s), %d rejection(s), %d pending.", quoted, rejected, pending+manual), "create_order_plan_from_quote"
	case pending+manual > 0:
		return fmt.Sprintf("Negotiation started with %d seller(s).", pending+manual), "wait_for_seller_decision"
	default:
		return fmt.Sprintf("No seller quotes received; %d seller(s) rejected.", rejected), "search_agent_cards_or_refine_task"
	}
}

func compactStringList(values []string) []string {
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func (h *Handler) localRequesterPubkey() string {
	if h.wallets != nil {
		if status, err := h.wallets.Current(); err == nil && status.LocalKeypair && strings.TrimSpace(status.Address) != "" {
			return status.Address
		}
	}
	return ""
}
