package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/negotiation"
	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/exora-dock/exora-dock/internal/task"
)

type SellerAgentConfig struct {
	Enabled                    bool
	AutoQuote                  bool
	AutoCompleteTextTasks      bool
	ProviderPubkey             string
	PollInterval               time.Duration
	DefaultQuotePrice          float64
	DefaultQuoteCurrency       string
	DefaultEstimatedSec        int
	LLMBaseURL                 string
	LLMAPIKey                  string
	LLMProviderPreset          string
	LLMModel                   string
	LLMWireAPI                 string
	LLMCapabilities            LLMCapabilities
	LLMExtraHeaders            map[string]string
	LLMResearchModel           string
	LLMResearchReasoningEffort string
	LLMUtilityModel            string
	LLMUtilityReasoningEffort  string
	LLMDisableResponseStorage  bool
}

type SellerAgentStatus struct {
	Enabled              bool   `json:"enabled"`
	Configured           bool   `json:"configured"`
	Discoverable         bool   `json:"discoverable"`
	ResourceListingCount int    `json:"resourceListingCount"`
	Discoverability      string `json:"discoverability"`
	LastRunAt            string `json:"lastRunAt,omitempty"`
	LastError            string `json:"lastError,omitempty"`
	QuotedCount          int    `json:"quotedCount"`
	RejectedCount        int    `json:"rejectedCount"`
	ManualReviewCount    int    `json:"manualReviewCount"`
	NegotiationCount     int    `json:"negotiationCount"`
	CompletedCount       int    `json:"completedCount"`
}

type SellerAgent struct {
	cfg          SellerAgentConfig
	tasks        *task.Store
	resources    *resource.Store
	negotiations *negotiation.Store
	executor     *task.Executor
	httpClient   *http.Client
	llm          *OpenAICompatibleClient
	mu           sync.Mutex
	status       SellerAgentStatus
}

func (a *SellerAgent) AttachNegotiations(store *negotiation.Store) *SellerAgent {
	if a != nil {
		a.negotiations = store
	}
	return a
}

func (a *SellerAgent) AttachExecutor(executor *task.Executor) *SellerAgent {
	if a != nil {
		a.executor = executor
	}
	return a
}

func NewSellerAgent(cfg SellerAgentConfig, tasks *task.Store, resources ...*resource.Store) *SellerAgent {
	cfg.LLMBaseURL = strings.TrimRight(strings.TrimSpace(cfg.LLMBaseURL), "/")
	cfg.LLMAPIKey = strings.TrimSpace(cfg.LLMAPIKey)
	cfg.LLMModel = strings.TrimSpace(cfg.LLMModel)
	cfg.LLMResearchModel = strings.TrimSpace(cfg.LLMResearchModel)
	cfg.LLMUtilityModel = strings.TrimSpace(cfg.LLMUtilityModel)
	cfg.ProviderPubkey = strings.TrimSpace(cfg.ProviderPubkey)
	cfg.DefaultQuoteCurrency = strings.TrimSpace(cfg.DefaultQuoteCurrency)
	if cfg.ProviderPubkey == "" {
		cfg.ProviderPubkey = "local-seller"
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 2 * time.Second
	}
	if cfg.DefaultQuoteCurrency == "" {
		cfg.DefaultQuoteCurrency = "USD"
	}
	if cfg.DefaultEstimatedSec <= 0 {
		cfg.DefaultEstimatedSec = 60
	}
	if cfg.LLMResearchModel == "" {
		if cfg.LLMModel != "" {
			cfg.LLMResearchModel = cfg.LLMModel
		} else {
			cfg.LLMResearchModel = "gpt-5.5"
		}
	}
	if cfg.LLMUtilityModel == "" {
		if cfg.LLMModel != "" {
			cfg.LLMUtilityModel = cfg.LLMModel
		} else {
			cfg.LLMUtilityModel = cfg.LLMResearchModel
		}
	}
	if cfg.LLMModel == "" {
		cfg.LLMModel = cfg.LLMResearchModel
	}
	llm := NewOpenAICompatibleClient(LLMClientConfig{
		BaseURL:                 cfg.LLMBaseURL,
		APIKey:                  cfg.LLMAPIKey,
		ProviderPreset:          cfg.LLMProviderPreset,
		WireAPI:                 cfg.LLMWireAPI,
		Capabilities:            cfg.LLMCapabilities,
		ExtraHeaders:            cfg.LLMExtraHeaders,
		DisableResponseStorage:  cfg.LLMDisableResponseStorage,
		ResearchModel:           cfg.LLMResearchModel,
		ResearchReasoningEffort: cfg.LLMResearchReasoningEffort,
		UtilityModel:            cfg.LLMUtilityModel,
		UtilityReasoningEffort:  cfg.LLMUtilityReasoningEffort,
	})
	var resourceStore *resource.Store
	if len(resources) > 0 {
		resourceStore = resources[0]
	}
	agent := &SellerAgent{
		cfg:        cfg,
		tasks:      tasks,
		resources:  resourceStore,
		httpClient: &http.Client{Timeout: 60 * time.Second},
		llm:        llm,
		status: SellerAgentStatus{
			Enabled:    cfg.Enabled,
			Configured: cfg.Enabled && llm.Enabled(),
		},
	}
	agent.refreshDiscoverabilityLocked()
	return agent
}

func (a *SellerAgent) Configured() bool {
	return a != nil && a.cfg.Enabled && a.llm.Enabled() && a.tasks != nil
}

func (a *SellerAgent) Status() SellerAgentStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.refreshDiscoverabilityLocked()
	return a.status
}

func (a *SellerAgent) Run(ctx context.Context) {
	if !a.Configured() {
		return
	}
	log.Printf("[seller-agent] started provider=%s wire=%s research_model=%s utility_model=%s", a.cfg.ProviderPubkey, a.llm.Config().WireAPI, a.llm.Config().ResearchModel, a.llm.Config().UtilityModel)
	a.Tick(ctx)
	ticker := time.NewTicker(a.cfg.PollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Printf("[seller-agent] stopped")
			return
		case <-ticker.C:
			a.Tick(ctx)
		}
	}
}

func (a *SellerAgent) Tick(ctx context.Context) {
	if !a.Configured() {
		return
	}
	if a.negotiations != nil {
		if a.cfg.AutoQuote {
			a.decidePendingNegotiations(ctx)
		} else {
			a.markPendingNegotiationsManualReview()
		}
	}
	if a.cfg.AutoQuote {
		a.quotePending(ctx)
	}
	if a.cfg.AutoCompleteTextTasks {
		a.completeConsented(ctx)
	}
	a.recordRun("")
}

func (a *SellerAgent) decidePendingNegotiations(ctx context.Context) {
	for _, n := range a.negotiations.List(negotiation.ListFilter{Status: negotiation.StatusPendingSellerDecision}) {
		if !a.ownsNegotiation(n) {
			continue
		}
		decision, dockerSpec, err := a.generateNegotiationDecision(ctx, n)
		if err != nil {
			updated, _ := a.negotiations.MarkRejected(n.ID, negotiation.RejectRequest{Reason: err.Error()})
			a.recordNegotiationDecision(updated.Status, err.Error())
			log.Printf("[seller-agent] negotiation rejected id=%s: %v", n.ID, err)
			continue
		}
		switch strings.ToLower(strings.TrimSpace(decision.Decision)) {
		case "reject", "rejected":
			updated, err := a.negotiations.MarkRejected(n.ID, negotiation.RejectRequest{
				Reason:        firstNonEmpty(decision.RejectReason, decision.Notes, "seller rejected the task"),
				RiskSummary:   decision.RiskSummary,
				MissingInputs: decision.MissingInputs,
			})
			a.recordNegotiationDecision(statusOrZero(updated, err), errorString(err))
		case "manual_review":
			updated, err := a.negotiations.MarkManualReview(n.ID, firstNonEmpty(decision.Notes, "seller manual review required"))
			a.recordNegotiationDecision(statusOrZero(updated, err), errorString(err))
		default:
			req := negotiation.QuoteRequest{
				ProviderPubkey:       firstNonEmpty(n.ProviderPubkey, a.cfg.ProviderPubkey),
				ResourceID:           n.ResourceID,
				PriceAmount:          decision.PriceAmount,
				Currency:             firstNonEmpty(decision.Currency, a.cfg.DefaultQuoteCurrency),
				EstimatedSeconds:     decision.EstimatedSeconds,
				RequiredInputs:       decision.RequiredInputs,
				RequiredPermissions:  decision.RequiredPermissions,
				ExecutionPlanSummary: decision.ExecutionPlanSummary,
				FailurePolicy:        firstNonEmpty(decision.FailurePolicy, "If execution fails, return logs and no completion claim."),
				DeliveryFormat:       firstNonEmpty(decision.DeliveryFormat, "artifact manifest"),
				DataProvenance:       firstNonEmpty(decision.DataProvenance, "provider generated task artifacts"),
				RetentionCommitment:  firstNonEmpty(decision.RetentionCommitment, "task-scoped retention only"),
				SellerApprovalMode:   firstNonEmpty(decision.SellerApprovalMode, "auto_quote"),
				Notes:                firstNonEmpty(decision.Notes, "Quoted by local Exora Dock seller agent."),
				Runtime:              "docker",
				Docker:               dockerSpec,
			}
			if req.PriceAmount < 0 || (req.PriceAmount == 0 && a.cfg.DefaultQuotePrice > 0) {
				req.PriceAmount = a.cfg.DefaultQuotePrice
			}
			if req.EstimatedSeconds <= 0 {
				req.EstimatedSeconds = firstPositive(decision.EstimatedSeconds, n.Draft.TimeoutSeconds, a.cfg.DefaultEstimatedSec)
			}
			updated, err := a.negotiations.MarkQuoted(n.ID, req)
			a.recordNegotiationDecision(statusOrZero(updated, err), errorString(err))
		}
	}
}

func (a *SellerAgent) markPendingNegotiationsManualReview() {
	for _, n := range a.negotiations.List(negotiation.ListFilter{Status: negotiation.StatusPendingSellerDecision}) {
		if !a.ownsNegotiation(n) {
			continue
		}
		updated, err := a.negotiations.MarkManualReview(n.ID, "seller auto quote is disabled")
		a.recordNegotiationDecision(statusOrZero(updated, err), errorString(err))
	}
}

func (a *SellerAgent) quotePending(ctx context.Context) {
	for _, t := range a.tasks.List(task.StatusPendingQuote, "") {
		if !a.matchesTask(t) {
			continue
		}
		req, err := a.generateQuote(ctx, t)
		if err != nil {
			a.recordRun(err.Error())
			log.Printf("[seller-agent] quote skipped task=%s: %v", t.ID, err)
			continue
		}
		if _, err := a.tasks.Quote(t.ID, req); err != nil {
			a.recordRun(err.Error())
			log.Printf("[seller-agent] quote failed task=%s: %v", t.ID, err)
			continue
		}
		a.mu.Lock()
		a.status.QuotedCount++
		a.mu.Unlock()
	}
}

func (a *SellerAgent) completeConsented(ctx context.Context) {
	for _, t := range a.tasks.List(task.StatusConsented, "") {
		if !a.ownsTask(t) || !autoCompletableTaskType(t.Type) {
			continue
		}
		answer, err := a.generateAnswer(ctx, t)
		if err != nil {
			a.recordRun(err.Error())
			log.Printf("[seller-agent] answer failed task=%s: %v", t.ID, err)
			continue
		}
		claimed, err := a.tasks.Claim(t.ID, task.ClaimRequest{ProviderPubkey: a.cfg.ProviderPubkey})
		if err != nil {
			a.recordRun(err.Error())
			log.Printf("[seller-agent] claim failed task=%s: %v", t.ID, err)
			continue
		}
		_, err = a.tasks.Complete(claimed.ID, task.CompleteRequest{
			ProviderPubkey: a.cfg.ProviderPubkey,
			Artifacts: []task.ArtifactInput{
				{
					Name:        "answer.md",
					Content:     answer,
					Encoding:    "text",
					ContentType: "text/markdown",
				},
			},
		})
		if err != nil {
			a.recordRun(err.Error())
			log.Printf("[seller-agent] complete failed task=%s: %v", t.ID, err)
			continue
		}
		a.mu.Lock()
		a.status.CompletedCount++
		a.mu.Unlock()
	}
}

func (a *SellerAgent) generateQuote(ctx context.Context, t task.Task) (task.QuoteRequest, error) {
	type quoteJSON struct {
		PriceAmount      float64 `json:"priceAmount"`
		Currency         string  `json:"currency"`
		EstimatedSeconds int     `json:"estimatedSeconds"`
		Notes            string  `json:"notes"`
	}
	prompt := fmt.Sprintf(`You are the local seller agent for Exora Dock.
Decide a quick quote for this task. Respond ONLY as JSON:
{"priceAmount":0,"currency":"USD","estimatedSeconds":60,"notes":"brief seller note"}

Task:
id=%s
type=%s
goal=%s
requirements=%s
budget=%s
expectedOutputs=%s`,
		t.ID,
		t.Type,
		t.Goal,
		mustJSON(t.Requirements),
		mustJSON(t.Budget),
		mustJSON(t.ExpectedOutputs),
	)
	raw, err := a.chat(ctx, prompt, 220, LLMProfileUtility, true)
	if err != nil {
		return task.QuoteRequest{}, err
	}
	var parsed quoteJSON
	if err := parseLLMJSON(raw, &parsed); err != nil {
		return task.QuoteRequest{}, err
	}
	req := task.QuoteRequest{
		ProviderPubkey:   a.cfg.ProviderPubkey,
		PriceAmount:      parsed.PriceAmount,
		Currency:         strings.TrimSpace(parsed.Currency),
		EstimatedSeconds: parsed.EstimatedSeconds,
		Notes:            strings.TrimSpace(parsed.Notes),
	}
	if req.PriceAmount < 0 {
		req.PriceAmount = a.cfg.DefaultQuotePrice
	}
	if req.PriceAmount == 0 && a.cfg.DefaultQuotePrice > 0 {
		req.PriceAmount = a.cfg.DefaultQuotePrice
	}
	if req.Currency == "" {
		req.Currency = a.cfg.DefaultQuoteCurrency
	}
	if req.EstimatedSeconds <= 0 {
		req.EstimatedSeconds = a.cfg.DefaultEstimatedSec
	}
	if req.Notes == "" {
		req.Notes = "Quoted by local Exora Dock seller agent."
	}
	return req, nil
}

type negotiationDecisionJSON struct {
	Decision             string   `json:"decision"`
	PriceAmount          float64  `json:"priceAmount"`
	Currency             string   `json:"currency"`
	EstimatedSeconds     int      `json:"estimatedSeconds"`
	RequiredInputs       []string `json:"requiredInputs"`
	RequiredPermissions  []string `json:"requiredPermissions"`
	ExecutionPlanSummary string   `json:"executionPlanSummary"`
	FailurePolicy        string   `json:"failurePolicy"`
	DeliveryFormat       string   `json:"deliveryFormat"`
	DataProvenance       string   `json:"dataProvenance"`
	RetentionCommitment  string   `json:"retentionCommitment"`
	SellerApprovalMode   string   `json:"sellerApprovalMode"`
	Notes                string   `json:"notes"`
	RejectReason         string   `json:"rejectReason"`
	RiskSummary          string   `json:"riskSummary"`
	MissingInputs        []string `json:"missingInputs"`
}

func (a *SellerAgent) generateNegotiationDecision(ctx context.Context, n negotiation.Negotiation) (negotiationDecisionJSON, task.DockerRunSpec, error) {
	if err := a.validateNegotiationResource(n); err != nil {
		return negotiationDecisionJSON{Decision: "reject", RejectReason: err.Error()}, task.DockerRunSpec{}, err
	}
	var dockerSpec task.DockerRunSpec
	if a.executor != nil {
		provider := firstNonEmpty(n.ProviderPubkey, a.cfg.ProviderPubkey)
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
		spec, err := a.executor.ValidateDockerTask(temp, task.RunRequest{ProviderPubkey: provider, Runtime: "docker"})
		if err != nil {
			return negotiationDecisionJSON{Decision: "reject", RejectReason: err.Error()}, task.DockerRunSpec{}, err
		}
		dockerSpec = spec
	}
	prompt := fmt.Sprintf(`You are the local seller agent for Exora Dock.
Read this buyer discussion request and decide whether to return a formal quote or reject it.
Respond ONLY as JSON:
{"decision":"quote","priceAmount":0,"currency":"USD","estimatedSeconds":60,"requiredInputs":[],"requiredPermissions":[],"executionPlanSummary":"brief plan","failurePolicy":"brief failure policy","deliveryFormat":"artifact manifest","dataProvenance":"provider generated task artifacts","retentionCommitment":"task-scoped retention only","sellerApprovalMode":"auto_quote","notes":"brief seller note","rejectReason":"","riskSummary":"","missingInputs":[]}

Rules:
- Use "reject" if the task is outside seller capability, violates policy, misses critical inputs, exceeds budget, or cannot pass Docker/resource constraints.
- Use "manual_review" only when seller human confirmation is needed before quoting.
- Do not approve buyer payment or consent.

Negotiation:
id=%s
intent=%s
resourceId=%s
provider=%s
draft=%s
messages=%s`,
		n.ID,
		n.Intent,
		n.ResourceID,
		firstNonEmpty(n.ProviderPubkey, a.cfg.ProviderPubkey),
		mustJSON(n.Draft),
		mustJSON(n.Messages),
	)
	raw, err := a.chat(ctx, prompt, 700, LLMProfileUtility, true)
	if err != nil {
		return negotiationDecisionJSON{}, dockerSpec, err
	}
	var parsed negotiationDecisionJSON
	if err := parseLLMJSON(raw, &parsed); err != nil {
		return negotiationDecisionJSON{}, dockerSpec, err
	}
	if strings.TrimSpace(parsed.Decision) == "" {
		parsed.Decision = "quote"
	}
	return parsed, dockerSpec, nil
}

func (a *SellerAgent) generateAnswer(ctx context.Context, t task.Task) (string, error) {
	prompt := fmt.Sprintf(`You are the local seller agent for Exora Dock.
Complete this lightweight text task. Return concise markdown only.

Task:
id=%s
type=%s
goal=%s
intent=%s
requirements=%s
expectedOutputs=%s`,
		t.ID,
		t.Type,
		t.Goal,
		mustJSON(t.Intent),
		mustJSON(t.Requirements),
		mustJSON(t.ExpectedOutputs),
	)
	answer, err := a.chat(ctx, prompt, 1200, answerProfile(t.Type), false)
	if err != nil {
		return "", err
	}
	answer = strings.TrimSpace(answer)
	if answer == "" {
		return "", fmt.Errorf("seller agent returned empty answer")
	}
	return answer, nil
}

func (a *SellerAgent) chat(ctx context.Context, prompt string, maxTokens int, profile string, jsonOutput bool) (string, error) {
	opts := LLMRequestOptions{
		Profile:   profile,
		MaxTokens: maxTokens,
	}
	if jsonOutput {
		opts.ResponseFormat = JSONResponseFormat()
	}
	return a.llm.Generate(
		ctx,
		"You are a reliable local seller agent inside Exora Dock. Follow output format instructions exactly.",
		prompt,
		opts,
	)
}

func (a *SellerAgent) ownsTask(t task.Task) bool {
	provider := strings.TrimSpace(t.ProviderPubkey)
	return provider == "" || provider == a.cfg.ProviderPubkey
}

func (a *SellerAgent) ownsNegotiation(n negotiation.Negotiation) bool {
	provider := strings.TrimSpace(n.ProviderPubkey)
	return provider == "" || provider == a.cfg.ProviderPubkey
}

func (a *SellerAgent) validateNegotiationResource(n negotiation.Negotiation) error {
	if !a.ownsNegotiation(n) {
		return fmt.Errorf("negotiation belongs to a different provider")
	}
	if a.resources == nil || strings.TrimSpace(n.ResourceID) == "" {
		return nil
	}
	res, ok := a.resources.Get(n.ResourceID)
	if !ok {
		return fmt.Errorf("resource unavailable")
	}
	provider := firstNonEmpty(res.ProviderPubkey, res.Provider)
	if provider != "" && provider != a.cfg.ProviderPubkey {
		return fmt.Errorf("resource belongs to a different provider")
	}
	if !strings.EqualFold(res.Availability, "available") {
		return fmt.Errorf("resource unavailable")
	}
	resourceType := inferNegotiationResourceType(n)
	if resourceType != "" && res.Type != resourceType {
		return fmt.Errorf("resource type does not match task")
	}
	return nil
}

func (a *SellerAgent) matchesTask(t task.Task) bool {
	if !a.ownsTask(t) {
		return false
	}
	if a.resources == nil {
		return true
	}
	listings := a.ownResourceListings()
	if len(listings) == 0 {
		return false
	}
	resourceType := inferTaskResourceType(t)
	if resourceType == "" {
		return true
	}
	for _, listing := range listings {
		if listing.Type == resourceType {
			return true
		}
	}
	return false
}

func inferNegotiationResourceType(n negotiation.Negotiation) resource.Type {
	if typed, ok := n.Draft.Requirements["type"].(string); ok && resource.IsKnownType(resource.Type(typed)) {
		return resource.Type(typed)
	}
	return inferTaskResourceType(task.Task{
		Type:         n.Draft.Type,
		Goal:         firstNonEmpty(n.Draft.Goal, n.Intent),
		Requirements: n.Draft.Requirements,
	})
}

func inferTaskResourceType(t task.Task) resource.Type {
	text := strings.ToLower(strings.TrimSpace(t.Type + " " + t.Goal + " " + mustJSON(t.Requirements)))
	switch {
	case strings.Contains(text, "gpu") ||
		strings.Contains(text, "cuda") ||
		strings.Contains(text, "vram") ||
		strings.Contains(text, "nvidia") ||
		strings.Contains(text, "\u663e\u5b58") ||
		strings.Contains(text, "\u663e\u5361"):
		return resource.TypeGPU
	case strings.Contains(text, "dataset") ||
		strings.Contains(text, "database") ||
		strings.Contains(text, "\u6570\u636e\u5e93") ||
		strings.Contains(text, "\u6570\u636e\u96c6"):
		return resource.TypeDataset
	case strings.Contains(text, "repo") || strings.Contains(text, "repository"):
		return resource.TypeRepository
	case strings.Contains(text, "storage"):
		return resource.TypeStorage
	case strings.Contains(text, "vps") || strings.Contains(text, "server"):
		return resource.TypeVPS
	default:
		return ""
	}
}

func (a *SellerAgent) ownResourceListings() []resource.Resource {
	if a.resources == nil {
		return nil
	}
	out := []resource.Resource{}
	for _, listing := range a.resources.List() {
		if strings.TrimSpace(listing.ProviderPubkey) == a.cfg.ProviderPubkey || strings.TrimSpace(listing.Provider) == a.cfg.ProviderPubkey {
			out = append(out, listing)
		}
	}
	return out
}

func (a *SellerAgent) refreshDiscoverabilityLocked() {
	a.status.Enabled = a.cfg.Enabled
	a.status.Configured = a.Configured()
	if a.resources == nil {
		a.status.Discoverable = false
		a.status.ResourceListingCount = 0
		a.status.Discoverability = "resource_store_unavailable"
		return
	}
	count := len(a.ownResourceListings())
	a.status.ResourceListingCount = count
	if !a.cfg.Enabled {
		a.status.Discoverable = false
		a.status.Discoverability = "seller_agent_disabled"
		return
	}
	if !a.Configured() {
		a.status.Discoverable = false
		a.status.Discoverability = "seller_agent_missing_llm_config"
		return
	}
	if count == 0 {
		a.status.Discoverable = false
		a.status.Discoverability = "no_provider_resource_listing"
		return
	}
	a.status.Discoverable = true
	a.status.Discoverability = "market_search_ready"
}

func (a *SellerAgent) recordRun(lastError string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.refreshDiscoverabilityLocked()
	a.status.LastRunAt = time.Now().UTC().Format(time.RFC3339)
	if strings.TrimSpace(lastError) != "" {
		a.status.LastError = strings.TrimSpace(lastError)
	}
}

func (a *SellerAgent) recordNegotiationDecision(status negotiation.Status, lastError string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.status.NegotiationCount++
	switch status {
	case negotiation.StatusQuoted:
		a.status.QuotedCount++
	case negotiation.StatusRejected:
		a.status.RejectedCount++
	case negotiation.StatusManualReview:
		a.status.ManualReviewCount++
	}
	a.status.LastRunAt = time.Now().UTC().Format(time.RFC3339)
	if strings.TrimSpace(lastError) != "" {
		a.status.LastError = strings.TrimSpace(lastError)
	}
}

func autoCompletableTaskType(kind string) bool {
	kind = strings.ToLower(strings.TrimSpace(kind))
	return strings.HasPrefix(kind, "text.") ||
		strings.HasPrefix(kind, "agent.") ||
		kind == "connectivity.smoke"
}

func answerProfile(kind string) string {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind == "connectivity.smoke" || strings.HasPrefix(kind, "agent.status") {
		return LLMProfileUtility
	}
	return LLMProfileResearch
}

func parseLLMJSON(raw string, out any) error {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "```json")
	raw = strings.TrimPrefix(raw, "```")
	raw = strings.TrimSuffix(raw, "```")
	raw = strings.TrimSpace(raw)
	if err := json.Unmarshal([]byte(raw), out); err != nil {
		return fmt.Errorf("seller agent parse llm json: %w (raw: %s)", err, raw)
	}
	return nil
}

func mustJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstPositive(values ...int) int {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func statusOrZero(n negotiation.Negotiation, err error) negotiation.Status {
	if err != nil {
		return ""
	}
	return n.Status
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
