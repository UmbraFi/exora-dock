package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
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
	AutoAcceptLowRisk          bool
	AutoCompleteTextTasks      bool
	ProviderPubkey             string
	PollInterval               time.Duration
	DefaultQuotePrice          float64
	DefaultQuoteCurrency       string
	DefaultEstimatedSec        int
	DataDir                    string
	PricingPolicyPath          string
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
	Enabled               bool   `json:"enabled"`
	Configured            bool   `json:"configured"`
	Discoverable          bool   `json:"discoverable"`
	ResourceListingCount  int    `json:"resourceListingCount"`
	Discoverability       string `json:"discoverability"`
	LastRunAt             string `json:"lastRunAt,omitempty"`
	LastError             string `json:"lastError,omitempty"`
	QuotedCount           int    `json:"quotedCount"`
	RejectedCount         int    `json:"rejectedCount"`
	ManualReviewCount     int    `json:"manualReviewCount"`
	NegotiationCount      int    `json:"negotiationCount"`
	CompletedCount        int    `json:"completedCount"`
	PricingPolicyID       string `json:"pricingPolicyId,omitempty"`
	PricingPolicyLoaded   bool   `json:"pricingPolicyLoaded"`
	LastValuationDecision string `json:"lastValuationDecision,omitempty"`
	LastValuationHash     string `json:"lastValuationHash,omitempty"`
	LastExecutionPlanHash string `json:"lastExecutionPlanHash,omitempty"`
}

type SellerPricingPolicy struct {
	SchemaVersion        string             `json:"schema_version"`
	PolicyID             string             `json:"policy_id"`
	CreatedAt            string             `json:"created_at,omitempty"`
	UpdatedAt            string             `json:"updated_at,omitempty"`
	Currency             string             `json:"currency,omitempty"`
	MinQuotePrice        float64            `json:"min_quote_price,omitempty"`
	DefaultQuotePrice    float64            `json:"default_quote_price,omitempty"`
	DefaultEstimatedSec  int                `json:"default_estimated_seconds,omitempty"`
	AutoAcceptLowRisk    bool               `json:"auto_accept_low_risk,omitempty"`
	AllowedTaskTypes     []string           `json:"allowed_task_types,omitempty"`
	DisallowedTaskTypes  []string           `json:"disallowed_task_types,omitempty"`
	HumanReviewTaskTypes []string           `json:"human_review_task_types,omitempty"`
	TaskPriceFloors      map[string]float64 `json:"task_price_floors,omitempty"`
	ExternalWritePolicy  string             `json:"external_write_policy,omitempty"`
	DataBoundary         string             `json:"data_boundary,omitempty"`
}

type ProviderStateSnapshot struct {
	SchemaVersion        string   `json:"schema_version"`
	ProviderPubkey       string   `json:"provider_pubkey,omitempty"`
	ResourceListingCount int      `json:"resource_listing_count"`
	ResourceTypes        []string `json:"resource_types,omitempty"`
	DockerPreflight      string   `json:"docker_preflight"`
	Availability         string   `json:"availability"`
	CapturedAt           string   `json:"captured_at"`
}

type SellerValuation struct {
	SchemaVersion     string  `json:"schema_version"`
	Decision          string  `json:"decision"`
	PriceAmount       float64 `json:"price_amount,omitempty"`
	Currency          string  `json:"currency,omitempty"`
	EstimatedSeconds  int     `json:"estimated_seconds,omitempty"`
	PolicyID          string  `json:"pricing_policy_id,omitempty"`
	ValuationHash     string  `json:"valuation_hash,omitempty"`
	QuoteBindingHash  string  `json:"quote_binding_hash,omitempty"`
	CapabilitySummary string  `json:"capability_summary,omitempty"`
	RiskSummary       string  `json:"risk_summary,omitempty"`
	Reason            string  `json:"reason,omitempty"`
}

type SellerExecutionPlan struct {
	SchemaVersion     string   `json:"schema_version"`
	PlanID            string   `json:"plan_id"`
	TaskID            string   `json:"task_id"`
	Steps             []string `json:"steps"`
	Inputs            []string `json:"inputs,omitempty"`
	Outputs           []string `json:"outputs,omitempty"`
	FileScope         []string `json:"file_scope,omitempty"`
	NetworkAccess     string   `json:"network_access"`
	ManagedAPIs       []string `json:"managed_apis,omitempty"`
	ExternalWrites    string   `json:"external_writes"`
	SensitiveActions  []string `json:"sensitive_actions,omitempty"`
	RiskLevel         string   `json:"risk_level"`
	AutoExecutable    bool     `json:"auto_executable"`
	ExecutionPlanHash string   `json:"execution_plan_hash"`
	CreatedAt         string   `json:"created_at"`
}

type SellerAgent struct {
	cfg           SellerAgentConfig
	tasks         *task.Store
	resources     *resource.Store
	negotiations  *negotiation.Store
	executor      *task.Executor
	httpClient    *http.Client
	llm           *OpenAICompatibleClient
	mu            sync.Mutex
	status        SellerAgentStatus
	pricingPolicy SellerPricingPolicy
	policyLoaded  bool
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
		cfg.DefaultQuoteCurrency = "USDC"
	}
	if cfg.DefaultEstimatedSec <= 0 {
		cfg.DefaultEstimatedSec = 60
	}
	cfg.DataDir = strings.TrimSpace(cfg.DataDir)
	cfg.PricingPolicyPath = strings.TrimSpace(cfg.PricingPolicyPath)
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
	policy, policyLoaded, policyErr := loadSellerPricingPolicy(cfg)
	agent := &SellerAgent{
		cfg:           cfg,
		tasks:         tasks,
		resources:     resourceStore,
		httpClient:    &http.Client{Timeout: 60 * time.Second},
		llm:           llm,
		pricingPolicy: policy,
		policyLoaded:  policyLoaded,
		status: SellerAgentStatus{
			Enabled:             cfg.Enabled,
			Configured:          cfg.Enabled && llm.Enabled(),
			PricingPolicyID:     policy.PolicyID,
			PricingPolicyLoaded: policyLoaded,
		},
	}
	if policyErr != nil {
		agent.status.LastError = policyErr.Error()
	}
	agent.refreshDiscoverabilityLocked()
	return agent
}

func loadSellerPricingPolicy(cfg SellerAgentConfig) (SellerPricingPolicy, bool, error) {
	path := strings.TrimSpace(cfg.PricingPolicyPath)
	if path == "" && strings.TrimSpace(cfg.DataDir) != "" {
		path = filepath.Join(strings.TrimSpace(cfg.DataDir), "seller_pricing_policy.json")
	}
	if path != "" {
		data, err := os.ReadFile(path)
		if err == nil {
			var policy SellerPricingPolicy
			if err := json.Unmarshal(data, &policy); err != nil {
				return defaultSellerPricingPolicy(cfg), false, fmt.Errorf("pricing policy parse failed: %w", err)
			}
			policy = normalizeSellerPricingPolicy(policy, cfg)
			return policy, true, nil
		}
		if !os.IsNotExist(err) {
			return defaultSellerPricingPolicy(cfg), false, fmt.Errorf("pricing policy read failed: %w", err)
		}
	}
	return defaultSellerPricingPolicy(cfg), false, nil
}

func defaultSellerPricingPolicy(cfg SellerAgentConfig) SellerPricingPolicy {
	now := time.Now().UTC().Format(time.RFC3339)
	policy := SellerPricingPolicy{
		SchemaVersion:       "exora.seller_pricing_policy.v0.1",
		PolicyID:            "seller-policy-default",
		CreatedAt:           now,
		UpdatedAt:           now,
		Currency:            firstNonEmpty(cfg.DefaultQuoteCurrency, "USDC"),
		MinQuotePrice:       0,
		DefaultQuotePrice:   cfg.DefaultQuotePrice,
		DefaultEstimatedSec: cfg.DefaultEstimatedSec,
		AutoAcceptLowRisk:   cfg.AutoAcceptLowRisk,
		AllowedTaskTypes:    []string{"text.*", "agent.*", "connectivity.smoke", "compute.*", "data.*"},
		TaskPriceFloors:     map[string]float64{},
		ExternalWritePolicy: "deny_by_default",
		DataBoundary:        "task_scope_only",
	}
	if policy.DefaultEstimatedSec <= 0 {
		policy.DefaultEstimatedSec = 60
	}
	return policy
}

func normalizeSellerPricingPolicy(policy SellerPricingPolicy, cfg SellerAgentConfig) SellerPricingPolicy {
	if strings.TrimSpace(policy.SchemaVersion) == "" {
		policy.SchemaVersion = "exora.seller_pricing_policy.v0.1"
	}
	if strings.TrimSpace(policy.PolicyID) == "" {
		policy.PolicyID = "seller-policy-local"
	}
	if strings.TrimSpace(policy.Currency) == "" {
		policy.Currency = firstNonEmpty(cfg.DefaultQuoteCurrency, "USDC")
	}
	if policy.DefaultQuotePrice == 0 && cfg.DefaultQuotePrice > 0 {
		policy.DefaultQuotePrice = cfg.DefaultQuotePrice
	}
	if policy.DefaultEstimatedSec <= 0 {
		policy.DefaultEstimatedSec = firstPositive(cfg.DefaultEstimatedSec, 60)
	}
	if policy.TaskPriceFloors == nil {
		policy.TaskPriceFloors = map[string]float64{}
	}
	if strings.TrimSpace(policy.ExternalWritePolicy) == "" {
		policy.ExternalWritePolicy = "deny_by_default"
	}
	if strings.TrimSpace(policy.DataBoundary) == "" {
		policy.DataBoundary = "task_scope_only"
	}
	return policy
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
	if a.cfg.AutoAcceptLowRisk || a.cfg.AutoCompleteTextTasks {
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
		case "needs_negotiation", "negotiate":
			updated, err := a.negotiations.MarkNeedsNegotiation(n.ID, negotiation.NeedsNegotiationRequest{
				Reason:              firstNonEmpty(decision.Notes, decision.RiskSummary, "seller needs more details before quoting"),
				RiskSummary:         decision.RiskSummary,
				MissingInputs:       decision.MissingInputs,
				RequiredPermissions: decision.RequiredPermissions,
			})
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
				ValuationDecision:    firstNonEmpty(decision.ValuationDecision, "can_accept"),
				SellerAgentCardID:    decision.SellerAgentCardID,
				CapabilitySummary:    decision.CapabilitySummary,
				PricingPolicyID:      firstNonEmpty(decision.PricingPolicyID, a.pricingPolicy.PolicyID),
				ValuationHash:        decision.ValuationHash,
				QuoteBindingHash:     decision.QuoteBindingHash,
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
			if floor := a.policyFloorFor(n); req.PriceAmount < floor {
				req.PriceAmount = floor
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
		executionPlan := a.buildSellerExecutionPlan(t)
		if !executionPlan.AutoExecutable {
			a.recordRun("seller execution plan requires manual review")
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
		a.status.LastExecutionPlanHash = executionPlan.ExecutionPlanHash
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
{"priceAmount":0,"currency":"USDC","estimatedSeconds":60,"notes":"brief seller note"}

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
	if floor := a.policyFloorForTask(t); req.PriceAmount < floor {
		req.PriceAmount = floor
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
	ValuationDecision    string   `json:"valuationDecision"`
	SellerAgentCardID    string   `json:"sellerAgentCardId"`
	CapabilitySummary    string   `json:"capabilitySummary"`
	PricingPolicyID      string   `json:"pricingPolicyId"`
	ValuationHash        string   `json:"valuationHash"`
	QuoteBindingHash     string   `json:"quoteBindingHash"`
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
	if reason := a.policyRejectReason(n); reason != "" {
		return negotiationDecisionJSON{Decision: "reject", RejectReason: reason, RiskSummary: reason, PricingPolicyID: a.pricingPolicy.PolicyID}, dockerSpec, nil
	}
	if reason := a.policyManualReviewReason(n); reason != "" {
		return negotiationDecisionJSON{Decision: "manual_review", Notes: reason, RiskSummary: reason, PricingPolicyID: a.pricingPolicy.PolicyID}, dockerSpec, nil
	}
	snapshot := a.providerStateSnapshot(dockerSpec)
	prompt := fmt.Sprintf(`You are the local seller agent for Exora Dock.
Read this buyer discussion request and produce a controlled provider valuation.
Respond ONLY as JSON:
{"decision":"quote","valuationDecision":"can_accept","priceAmount":0,"currency":"USDC","estimatedSeconds":60,"requiredInputs":[],"requiredPermissions":[],"executionPlanSummary":"brief plan","failurePolicy":"brief failure policy","deliveryFormat":"artifact manifest","dataProvenance":"provider generated task artifacts","retentionCommitment":"task-scoped retention only","sellerApprovalMode":"auto_quote","capabilitySummary":"brief capability fit","notes":"brief seller note","rejectReason":"","riskSummary":"","missingInputs":[]}

Rules:
- Use "reject" if the task is outside seller capability, violates policy, misses critical inputs, exceeds budget, or cannot pass Docker/resource constraints.
- Use "manual_review" only when seller human confirmation is needed before quoting.
- Use "needs_negotiation" when the seller may accept but needs missing inputs, permissions, or scope clarification before a binding quote.
- Do not approve buyer payment or consent.
- Never quote below the pricing policy floor.

Negotiation:
id=%s
intent=%s
resourceId=%s
provider=%s
pricingPolicy=%s
providerState=%s
draft=%s
messages=%s`,
		n.ID,
		n.Intent,
		n.ResourceID,
		firstNonEmpty(n.ProviderPubkey, a.cfg.ProviderPubkey),
		mustJSON(a.pricingPolicy),
		mustJSON(snapshot),
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
	parsed = a.finalizeNegotiationDecision(n, parsed, snapshot)
	return parsed, dockerSpec, nil
}

func (a *SellerAgent) finalizeNegotiationDecision(n negotiation.Negotiation, decision negotiationDecisionJSON, snapshot ProviderStateSnapshot) negotiationDecisionJSON {
	decision.Decision = strings.ToLower(strings.TrimSpace(decision.Decision))
	if decision.Decision == "quote" || decision.Decision == "quoted" || decision.Decision == "" {
		decision.Decision = "quote"
		decision.ValuationDecision = "can_accept"
	} else if decision.Decision == "needs_negotiation" {
		decision.ValuationDecision = "needs_negotiation"
	} else if decision.Decision == "manual_review" {
		decision.ValuationDecision = "needs_negotiation"
	} else {
		decision.ValuationDecision = "reject"
	}
	if decision.Currency == "" {
		decision.Currency = firstNonEmpty(a.pricingPolicy.Currency, a.cfg.DefaultQuoteCurrency, "USDC")
	}
	if decision.EstimatedSeconds <= 0 {
		decision.EstimatedSeconds = firstPositive(n.Draft.TimeoutSeconds, a.pricingPolicy.DefaultEstimatedSec, a.cfg.DefaultEstimatedSec, 60)
	}
	if decision.PriceAmount == 0 && a.pricingPolicy.DefaultQuotePrice > 0 {
		decision.PriceAmount = a.pricingPolicy.DefaultQuotePrice
	}
	if floor := a.policyFloorFor(n); decision.PriceAmount < floor {
		decision.PriceAmount = floor
	}
	decision.PricingPolicyID = firstNonEmpty(decision.PricingPolicyID, a.pricingPolicy.PolicyID)
	decision.CapabilitySummary = firstNonEmpty(decision.CapabilitySummary, fmt.Sprintf("%d local resource listing(s), %s availability", snapshot.ResourceListingCount, snapshot.Availability))
	valuation := SellerValuation{
		SchemaVersion:     "exora.seller_valuation.v0.1",
		Decision:          decision.ValuationDecision,
		PriceAmount:       decision.PriceAmount,
		Currency:          decision.Currency,
		EstimatedSeconds:  decision.EstimatedSeconds,
		PolicyID:          decision.PricingPolicyID,
		CapabilitySummary: decision.CapabilitySummary,
		RiskSummary:       decision.RiskSummary,
		Reason:            firstNonEmpty(decision.Notes, decision.RejectReason),
	}
	decision.ValuationHash = firstNonEmpty(decision.ValuationHash, hashAny("valuation", valuation, snapshot, n.ID))
	decision.QuoteBindingHash = firstNonEmpty(decision.QuoteBindingHash, hashAny("quote_binding", n.ID, n.Intent, n.ResourceID, decision.PricingPolicyID, decision.ValuationHash, decision.PriceAmount, decision.Currency, decision.EstimatedSeconds))
	a.mu.Lock()
	a.status.LastValuationDecision = decision.ValuationDecision
	a.status.LastValuationHash = decision.ValuationHash
	a.mu.Unlock()
	return decision
}

func (a *SellerAgent) providerStateSnapshot(dockerSpec task.DockerRunSpec) ProviderStateSnapshot {
	listings := a.ownResourceListings()
	types := []string{}
	for _, listing := range listings {
		types = appendUniqueString(types, string(listing.Type))
	}
	dockerPreflight := "not_configured"
	if a.executor != nil {
		dockerPreflight = "passed"
	}
	if strings.TrimSpace(dockerSpec.Image) != "" {
		dockerPreflight = "passed"
	}
	availability := "available"
	if a.resources != nil && len(listings) == 0 {
		availability = "no_resource_listing"
	}
	return ProviderStateSnapshot{
		SchemaVersion:        "exora.provider_state_snapshot.v0.1",
		ProviderPubkey:       a.cfg.ProviderPubkey,
		ResourceListingCount: len(listings),
		ResourceTypes:        types,
		DockerPreflight:      dockerPreflight,
		Availability:         availability,
		CapturedAt:           time.Now().UTC().Format(time.RFC3339),
	}
}

func (a *SellerAgent) policyRejectReason(n negotiation.Negotiation) string {
	taskType := firstNonEmpty(n.Draft.Type, stringFromMap(n.Draft.Requirements, "type"))
	if matchesAnyTaskType(taskType, a.pricingPolicy.DisallowedTaskTypes) {
		return "pricing policy disallows task type " + taskType
	}
	if len(a.pricingPolicy.AllowedTaskTypes) > 0 && taskType != "" && !matchesAnyTaskType(taskType, a.pricingPolicy.AllowedTaskTypes) {
		return "pricing policy does not allow task type " + taskType
	}
	return ""
}

func (a *SellerAgent) policyManualReviewReason(n negotiation.Negotiation) string {
	taskType := firstNonEmpty(n.Draft.Type, stringFromMap(n.Draft.Requirements, "type"))
	if taskType != "" && matchesAnyTaskType(taskType, a.pricingPolicy.HumanReviewTaskTypes) {
		return "pricing policy requires seller human confirmation for task type " + taskType
	}
	return ""
}

func (a *SellerAgent) policyFloorFor(n negotiation.Negotiation) float64 {
	floor := a.pricingPolicy.MinQuotePrice
	taskType := firstNonEmpty(n.Draft.Type, stringFromMap(n.Draft.Requirements, "type"))
	for pattern, value := range a.pricingPolicy.TaskPriceFloors {
		if value > floor && matchesTaskType(taskType, pattern) {
			floor = value
		}
	}
	return floor
}

func (a *SellerAgent) policyFloorForTask(t task.Task) float64 {
	floor := a.pricingPolicy.MinQuotePrice
	taskType := firstNonEmpty(t.Type, stringFromMap(t.Requirements, "type"))
	for pattern, value := range a.pricingPolicy.TaskPriceFloors {
		if value > floor && matchesTaskType(taskType, pattern) {
			floor = value
		}
	}
	return floor
}

func matchesAnyTaskType(taskType string, patterns []string) bool {
	for _, pattern := range patterns {
		if matchesTaskType(taskType, pattern) {
			return true
		}
	}
	return false
}

func matchesTaskType(taskType, pattern string) bool {
	taskType = strings.ToLower(strings.TrimSpace(taskType))
	pattern = strings.ToLower(strings.TrimSpace(pattern))
	if pattern == "" {
		return false
	}
	if pattern == "*" {
		return true
	}
	if strings.HasSuffix(pattern, ".*") {
		return strings.HasPrefix(taskType, strings.TrimSuffix(pattern, "*"))
	}
	return taskType == pattern
}

func stringFromMap(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	if text, ok := values[key].(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

func hashAny(parts ...any) string {
	data, _ := json.Marshal(parts)
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func appendUniqueString(values []string, item string) []string {
	item = strings.TrimSpace(item)
	if item == "" {
		return values
	}
	for _, value := range values {
		if value == item {
			return values
		}
	}
	return append(values, item)
}

func compactNonEmptyStrings(values []string) []string {
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
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

func (a *SellerAgent) buildSellerExecutionPlan(t task.Task) SellerExecutionPlan {
	inputs := []string{}
	for _, file := range t.InputFiles {
		inputs = append(inputs, firstNonEmpty(file.Name, file.URI, file.SHA256))
	}
	outputs := append([]string(nil), t.ExpectedOutputs...)
	if len(outputs) == 0 {
		outputs = []string{"answer.md"}
	}
	risk := "low"
	if strings.Contains(strings.ToLower(mustJSON(t.Requirements)), "external_write") {
		risk = "high"
	}
	autoExecutable := risk == "low" && (a.cfg.AutoAcceptLowRisk || a.cfg.AutoCompleteTextTasks || a.pricingPolicy.AutoAcceptLowRisk)
	plan := SellerExecutionPlan{
		SchemaVersion:    "exora.seller_execution_plan.v0.1",
		PlanID:           "seller-exec-" + t.ID,
		TaskID:           t.ID,
		Steps:            []string{"claim_task", "generate_task_scoped_artifact", "complete_task_with_artifacts"},
		Inputs:           compactNonEmptyStrings(inputs),
		Outputs:          compactNonEmptyStrings(outputs),
		NetworkAccess:    "none_by_default",
		ExternalWrites:   firstNonEmpty(a.pricingPolicy.ExternalWritePolicy, "deny_by_default"),
		SensitiveActions: []string{},
		RiskLevel:        risk,
		AutoExecutable:   autoExecutable,
		CreatedAt:        time.Now().UTC().Format(time.RFC3339),
	}
	plan.ExecutionPlanHash = hashAny("seller_execution_plan", plan.PlanID, plan.TaskID, plan.Steps, plan.Inputs, plan.Outputs, plan.NetworkAccess, plan.ExternalWrites, plan.RiskLevel, plan.AutoExecutable)
	return plan
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
	a.status.PricingPolicyID = a.pricingPolicy.PolicyID
	a.status.PricingPolicyLoaded = a.policyLoaded
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
	case negotiation.StatusNeedsNegotiation:
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
