package api

import (
	"net/http"
	"strings"

	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/negotiation"
	"github.com/exora-dock/exora-dock/internal/orderplan"
	"github.com/exora-dock/exora-dock/internal/payment"
	"github.com/exora-dock/exora-dock/internal/samplemarket"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/exora-dock/exora-dock/internal/workrun"
)

func (h *Handler) ConsoleSnapshot(w http.ResponseWriter, r *http.Request) {
	side := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("side")))
	if side != "buyer" && side != "seller" {
		side = "all"
	}
	walletStatus := any(nil)
	if h.wallets != nil {
		if status, err := h.wallets.Current(); err == nil {
			status = h.enrichWalletStatus(status)
			status.KeypairPath = ""
			status.EncryptedKeypairPath = ""
			walletStatus = status
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"health": map[string]any{
			"status": "ok",
			"dock":   "exora-dock",
			"uptime": h.startTime.Format("2006-01-02T15:04:05Z07:00"),
		},
		"dock": map[string]any{
			"dockId":       firstNonEmpty(h.dockID, h.selfPubkey),
			"displayName":  "Exora Dock",
			"mode":         "local-supervisor-v2",
			"capabilities": []string{"automation.wake.v2", "agent.cards", "approvals.queue", "provider.docker"},
		},
		"side":               side,
		"wallet":             walletStatus,
		"agentCards":         h.safeAgentCards(),
		"buyerAgent":         h.buyerAgentSettings(),
		"sellerAgent":        h.safeSellerSettings(),
		"sellerMarketStatus": h.safeSellerMarketStatus(),
		"localAgents":        []any{h.codexAgent},
		"resources":          h.safeResources(),
		"marketRail":         h.safeMarketRail(),
		"orderPlans":         h.safeOrderPlans(),
		"approvals":          h.safeApprovals(),
		"tasks":              h.safeTasks(side),
		"payments":           h.safePayments(),
		"automationRuns":     h.safeAutomationRuns(),
		"workRuns":           h.safeWorkRuns(),
		"negotiations":       h.safeNegotiations(),
	})
}

func (h *Handler) safeAgentCards() any {
	if h.agentCards == nil {
		return map[string]any{"cards": []any{}}
	}
	cards := h.agentCards.List()
	out := map[string]any{"cards": cards}
	for _, card := range cards {
		out[string(card.Role)] = card
	}
	return out
}

func (h *Handler) safeSellerSettings() any {
	cfg, _ := h.loadConfig()
	return sellerSettingsFromConfig(cfg)
}

func (h *Handler) safeSellerMarketStatus() any {
	settings := h.safeSellerSettings().(SellerAgentSettings)
	count := 0
	if h.resources != nil {
		for _, item := range h.resources.List() {
			if settings.ProviderID == "" || item.ProviderPubkey == settings.ProviderID || item.Provider == settings.ProviderID {
				count++
			}
		}
	}
	return map[string]any{
		"discoverable":          settings.Enabled && count > 0,
		"resourceListingCount":  count,
		"providerId":            settings.ProviderID,
		"redactedSecretSummary": []string{"walletSecret", "localPaths"},
	}
}

func (h *Handler) safeResources() any {
	if h.resources == nil {
		return []any{}
	}
	return h.resources.List()
}

func (h *Handler) safeMarketRail() any {
	if h.agentCards == nil {
		return nil
	}
	return samplemarket.RailCards(h.agentCards)
}

func (h *Handler) safeOrderPlans() any {
	if h.orderPlans == nil {
		return []any{}
	}
	return h.orderPlans.List(orderplan.ListFilter{})
}

func (h *Handler) safeApprovals() any {
	if h.approvals == nil {
		return []any{}
	}
	return h.approvals.List(approval.ListFilter{})
}

func (h *Handler) safeTasks(side string) any {
	if h.tasks == nil {
		return []any{}
	}
	tasks := h.tasks.List(task.Status(""), "")
	if side == "all" {
		return tasks
	}
	filtered := make([]task.Task, 0, len(tasks))
	self := firstNonEmpty(h.selfPubkey, h.dockID)
	settings := h.safeSellerSettings().(SellerAgentSettings)
	sellerProvider := firstNonEmpty(settings.ProviderID, self)
	for _, item := range tasks {
		itemProvider := strings.TrimSpace(item.ProviderPubkey)
		if itemProvider == "" && item.Quote != nil {
			itemProvider = strings.TrimSpace(item.Quote.ProviderPubkey)
		}
		isSellerTask := itemProvider != "" && (itemProvider == self || itemProvider == sellerProvider)
		if side == "seller" {
			if isSellerTask {
				filtered = append(filtered, item)
			}
			continue
		}
		if !isSellerTask {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func (h *Handler) safePayments() any {
	if h.payments == nil {
		return []any{}
	}
	return h.payments.List(payment.ListFilter{})
}

func (h *Handler) safeAutomationRuns() any {
	if h.automationRuns == nil {
		return []any{}
	}
	return h.automationRuns.List("")
}

func (h *Handler) safeWorkRuns() any {
	if h.workRuns == nil {
		return []any{}
	}
	return h.workRuns.List(workrun.ListFilter{})
}

func (h *Handler) safeNegotiations() any {
	if h.negotiations == nil {
		return []any{}
	}
	return h.negotiations.List(negotiation.ListFilter{})
}
