package market

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/resource"
	"github.com/exora-dock/exora-dock/internal/task"
)

const MaxOrderOptions = 6

type SearchRequest struct {
	Query                  string             `json:"query"`
	ProjectPath            string             `json:"projectPath,omitempty"`
	WorkUID                string             `json:"workUid,omitempty"`
	RequesterPubkey        string             `json:"requesterPubkey,omitempty"`
	AgentID                string             `json:"agentId,omitempty"`
	Constraints            map[string]any     `json:"constraints,omitempty"`
	MaxResults             int                `json:"maxResults,omitempty"`
	PrepareOrderOptions    bool               `json:"prepareOrderOptions,omitempty"`
	CreateSelectionRequest bool               `json:"createSelectionRequest,omitempty"`
	RequireRealtimeQuotes  bool               `json:"requireRealtimeQuotes,omitempty"`
	MaxOptions             int                `json:"maxOptions,omitempty"`
	TaskTemplate           task.CreateRequest `json:"taskTemplate,omitempty"`
}

type NormalizedQuery struct {
	Query       string        `json:"query"`
	Type        resource.Type `json:"type,omitempty"`
	MinVRAMGB   int           `json:"minVramGb,omitempty"`
	MinGPUCount int           `json:"minGpuCount,omitempty"`
	Region      string        `json:"region,omitempty"`
}

type Candidate struct {
	Resource       resource.Resource `json:"resource"`
	ProviderPubkey string            `json:"providerPubkey"`
	Score          int               `json:"score"`
	Reasons        []string          `json:"reasons"`
}

type PriceSnapshot struct {
	PricePerUnit float64 `json:"pricePerUnit,omitempty"`
	BillingUnit  string  `json:"billingUnit,omitempty"`
	Currency     string  `json:"currency,omitempty"`
	Availability string  `json:"availability,omitempty"`
	ResourceHash string  `json:"resourceHash,omitempty"`
}

type OrderDraft struct {
	RequesterPubkey   string             `json:"requesterPubkey"`
	AgentID           string             `json:"agentId"`
	ProjectPath       string             `json:"projectPath,omitempty"`
	WorkUID           string             `json:"workUid,omitempty"`
	Type              string             `json:"type"`
	Goal              string             `json:"goal"`
	Intent            map[string]any     `json:"intent,omitempty"`
	Requirements      map[string]any     `json:"requirements,omitempty"`
	InputManifestHash string             `json:"inputManifestHash,omitempty"`
	InputFiles        []task.InputFile   `json:"inputFiles,omitempty"`
	PrivacyPolicy     map[string]any     `json:"privacyPolicy,omitempty"`
	RetentionPolicy   map[string]any     `json:"retentionPolicy,omitempty"`
	Budget            task.Budget        `json:"budget,omitempty"`
	TimeoutSeconds    int                `json:"timeoutSeconds,omitempty"`
	ExpectedOutputs   []string           `json:"expectedOutputs,omitempty"`
	ConsentPolicy     task.ConsentPolicy `json:"consentPolicy"`
	ProviderPubkey    string             `json:"providerPubkey,omitempty"`
	ResourceID        string             `json:"resourceId,omitempty"`
}

type OrderDraftOption struct {
	OptionID         string        `json:"optionId"`
	ResourceID       string        `json:"resourceId"`
	ProviderPubkey   string        `json:"providerPubkey"`
	ProviderEndpoint string        `json:"providerEndpoint,omitempty"`
	Score            int           `json:"score"`
	Reason           string        `json:"reason"`
	PriceSnapshot    PriceSnapshot `json:"priceSnapshot"`
	QuoteID          string        `json:"quoteId,omitempty"`
	RealtimeStatus   string        `json:"realtimeStatus,omitempty"`
	ConfirmedAt      string        `json:"confirmedAt,omitempty"`
	ExpiresAt        string        `json:"expiresAt"`
	Draft            OrderDraft    `json:"draft"`
}

type SelectionRequestSummary struct {
	PlanID      string `json:"planId"`
	Status      string `json:"status"`
	ApprovalURL string `json:"approvalUrl,omitempty"`
	ExpiresAt   string `json:"expiresAt"`
	NextAction  string `json:"nextAction"`
}

type SearchResult struct {
	NormalizedQuery   NormalizedQuery          `json:"normalizedQuery"`
	Candidates        []Candidate              `json:"candidates"`
	OrderDraftOptions []OrderDraftOption       `json:"orderDraftOptions,omitempty"`
	SelectionRequest  *SelectionRequestSummary `json:"selectionRequest,omitempty"`
	Summary           string                   `json:"summary"`
	NextAction        string                   `json:"nextAction"`
}

func Search(req SearchRequest, store *resource.Store) SearchResult {
	normalized := Normalize(req)
	out := SearchResult{
		NormalizedQuery: normalized,
		Candidates:      []Candidate{},
		NextAction:      "create_order_draft_or_refine_search",
	}
	if store == nil {
		out.Summary = "Resource store is not configured."
		return out
	}
	for _, res := range store.List() {
		candidate, ok := scoreResource(res, normalized)
		if !ok {
			continue
		}
		out.Candidates = append(out.Candidates, candidate)
	}
	sort.SliceStable(out.Candidates, func(i, j int) bool {
		if out.Candidates[i].Score == out.Candidates[j].Score {
			return out.Candidates[i].Resource.UpdatedAt > out.Candidates[j].Resource.UpdatedAt
		}
		return out.Candidates[i].Score > out.Candidates[j].Score
	})
	maxResults := req.MaxResults
	if maxResults <= 0 {
		maxResults = 10
	}
	if len(out.Candidates) > maxResults {
		out.Candidates = out.Candidates[:maxResults]
	}
	if len(out.Candidates) == 0 {
		out.Summary = "No matching sellers found. Try relaxing the query or publishing a demand request."
		out.NextAction = "refine_search_or_publish_demand"
		return out
	}
	if req.PrepareOrderOptions || req.CreateSelectionRequest {
		out.OrderDraftOptions = buildOrderDraftOptions(req, normalized, out.Candidates)
		if len(out.OrderDraftOptions) > 0 {
			out.NextAction = "ask_user_to_choose_seller"
		}
	}
	out.Summary = fmt.Sprintf("Found %d candidate seller(s) for %s.", len(out.Candidates), summaryTarget(normalized))
	return out
}

func (d OrderDraft) TaskCreateRequest() task.CreateRequest {
	return task.CreateRequest{
		RequesterPubkey:   d.RequesterPubkey,
		AgentID:           d.AgentID,
		ProjectPath:       d.ProjectPath,
		WorkUID:           d.WorkUID,
		Type:              d.Type,
		Goal:              d.Goal,
		Intent:            d.Intent,
		Requirements:      d.Requirements,
		InputManifestHash: d.InputManifestHash,
		InputFiles:        d.InputFiles,
		PrivacyPolicy:     d.PrivacyPolicy,
		RetentionPolicy:   d.RetentionPolicy,
		Budget:            d.Budget,
		TimeoutSeconds:    d.TimeoutSeconds,
		ExpectedOutputs:   d.ExpectedOutputs,
		ConsentPolicy:     d.ConsentPolicy,
	}
}

func Normalize(req SearchRequest) NormalizedQuery {
	raw := strings.TrimSpace(req.Query)
	lower := strings.ToLower(raw)
	out := NormalizedQuery{Query: raw}
	if typed := stringConstraint(req.Constraints, "type"); typed != "" && resource.IsKnownType(resource.Type(typed)) {
		out.Type = resource.Type(typed)
	}
	if out.Type == "" {
		out.Type = inferType(lower)
	}
	if value := intConstraint(req.Constraints, "minVramGb"); value > 0 {
		out.MinVRAMGB = value
	}
	if out.MinVRAMGB == 0 {
		out.MinVRAMGB = inferMinVRAM(lower)
	}
	if value := intConstraint(req.Constraints, "minGpuCount"); value > 0 {
		out.MinGPUCount = value
	}
	if region := stringConstraint(req.Constraints, "region"); region != "" {
		out.Region = region
	}
	return out
}

func scoreResource(res resource.Resource, query NormalizedQuery) (Candidate, bool) {
	if query.Type != "" && res.Type != query.Type {
		return Candidate{}, false
	}
	if query.Region != "" && !strings.EqualFold(res.Spec.Region, query.Region) {
		return Candidate{}, false
	}
	if query.MinVRAMGB > 0 && res.Spec.VRAMGB < query.MinVRAMGB {
		return Candidate{}, false
	}
	if query.MinGPUCount > 0 && res.Spec.GPUCount < query.MinGPUCount {
		return Candidate{}, false
	}
	score := 40 + res.QualityScore/4 + res.Reputation/4
	reasons := []string{}
	if query.Type != "" && res.Type == query.Type {
		score += 15
		reasons = append(reasons, "matches requested capability type")
	}
	if query.MinVRAMGB > 0 {
		score += 20
		reasons = append(reasons, fmt.Sprintf("has %dGB VRAM", res.Spec.VRAMGB))
	}
	if query.MinGPUCount > 0 {
		score += 8
		reasons = append(reasons, fmt.Sprintf("has %d GPU(s)", res.Spec.GPUCount))
	}
	if strings.EqualFold(res.Availability, "available") {
		score += 8
		reasons = append(reasons, "currently available")
	}
	if res.PricePerUnit > 0 {
		reasons = append(reasons, fmt.Sprintf("%.2f per %s", res.PricePerUnit, res.BillingUnit))
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "matches market search")
	}
	return Candidate{
		Resource:       res,
		ProviderPubkey: firstNonEmpty(res.ProviderPubkey, res.Provider),
		Score:          score,
		Reasons:        reasons,
	}, true
}

func buildOrderDraftOptions(req SearchRequest, normalized NormalizedQuery, candidates []Candidate) []OrderDraftOption {
	maxOptions := req.MaxOptions
	if maxOptions <= 0 {
		maxOptions = MaxOrderOptions
	}
	if maxOptions > MaxOrderOptions {
		maxOptions = MaxOrderOptions
	}
	if maxOptions > len(candidates) {
		maxOptions = len(candidates)
	}
	expiresAt := time.Now().UTC().Add(30 * time.Minute).Format(time.RFC3339)
	options := make([]OrderDraftOption, 0, maxOptions)
	for i := 0; i < maxOptions; i++ {
		candidate := candidates[i]
		res := candidate.Resource
		provider := firstNonEmpty(candidate.ProviderPubkey, res.ProviderPubkey, res.Provider)
		options = append(options, OrderDraftOption{
			OptionID:         fmt.Sprintf("opt_%d", i+1),
			ResourceID:       res.ID,
			ProviderPubkey:   provider,
			ProviderEndpoint: strings.TrimSpace(res.Spec.Endpoint),
			Score:            candidate.Score,
			Reason:           strings.Join(candidate.Reasons, ", "),
			PriceSnapshot: PriceSnapshot{
				PricePerUnit: res.PricePerUnit,
				BillingUnit:  string(res.BillingUnit),
				Currency:     "USD",
				Availability: res.Availability,
				ResourceHash: ResourceSnapshotHash(res),
			},
			ExpiresAt: expiresAt,
			Draft:     buildOrderDraft(req, normalized, candidate),
		})
	}
	return options
}

func buildOrderDraft(req SearchRequest, normalized NormalizedQuery, candidate Candidate) OrderDraft {
	res := candidate.Resource
	provider := firstNonEmpty(candidate.ProviderPubkey, res.ProviderPubkey, res.Provider)
	template := req.TaskTemplate
	requester := firstNonEmpty(template.RequesterPubkey, req.RequesterPubkey, "local-user")
	agentID := firstNonEmpty(template.AgentID, req.AgentID, "external-agent")
	kind := firstNonEmpty(template.Type, defaultTaskType(normalized.Type))
	goal := firstNonEmpty(template.Goal, req.Query, res.Summary, res.Name)
	requirements := mergeMaps(template.Requirements, normalizedRequirements(normalized, res, provider))
	if consentPolicyEmpty(template.ConsentPolicy) {
		template.ConsentPolicy = task.ConsentPolicy{RequireHumanApproval: true}
	}
	timeout := template.TimeoutSeconds
	if timeout <= 0 {
		timeout = 600
	}
	return OrderDraft{
		RequesterPubkey:   requester,
		AgentID:           agentID,
		ProjectPath:       firstNonEmpty(template.ProjectPath, req.ProjectPath),
		WorkUID:           firstNonEmpty(template.WorkUID, req.WorkUID),
		Type:              kind,
		Goal:              goal,
		Intent:            template.Intent,
		Requirements:      requirements,
		InputManifestHash: template.InputManifestHash,
		InputFiles:        template.InputFiles,
		PrivacyPolicy:     template.PrivacyPolicy,
		RetentionPolicy:   template.RetentionPolicy,
		Budget:            template.Budget,
		TimeoutSeconds:    timeout,
		ExpectedOutputs:   template.ExpectedOutputs,
		ConsentPolicy:     template.ConsentPolicy,
		ProviderPubkey:    provider,
		ResourceID:        res.ID,
	}
}

func consentPolicyEmpty(policy task.ConsentPolicy) bool {
	return !policy.RequireHumanApproval && policy.MaxAutoAmount == 0 && len(policy.IdentityScopes) == 0
}

func normalizedRequirements(normalized NormalizedQuery, res resource.Resource, provider string) map[string]any {
	out := map[string]any{
		"resourceId":     res.ID,
		"providerPubkey": provider,
	}
	if normalized.Type != "" {
		out["type"] = string(normalized.Type)
	}
	if normalized.MinVRAMGB > 0 {
		out["minVramGb"] = normalized.MinVRAMGB
	}
	if normalized.MinGPUCount > 0 {
		out["minGpuCount"] = normalized.MinGPUCount
	}
	if normalized.Region != "" {
		out["region"] = normalized.Region
	}
	return out
}

func mergeMaps(base map[string]any, overlay map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range base {
		out[key] = value
	}
	for key, value := range overlay {
		out[key] = value
	}
	return out
}

func defaultTaskType(kind resource.Type) string {
	switch kind {
	case resource.TypeGPU:
		return "compute.gpu"
	case resource.TypeDataset:
		return "data.query"
	case resource.TypeRepository:
		return "code.repository"
	case resource.TypeStorage:
		return "storage.transfer"
	case resource.TypeVPS:
		return "compute.vps"
	default:
		return "agent.market_request"
	}
}

func ResourceSnapshotHash(res resource.Resource) string {
	return fmt.Sprintf("%s|%s|%.8f|%s|%s|%d|%d|%s",
		res.ID,
		res.ProviderPubkey,
		res.PricePerUnit,
		res.BillingUnit,
		res.Availability,
		res.Spec.VRAMGB,
		res.Spec.GPUCount,
		res.UpdatedAt,
	)
}

func inferType(query string) resource.Type {
	switch {
	case containsAny(query, "\u663e\u5b58", "vram", "gpu", "cuda", "nvidia", "a100", "h100", "4090", "\u663e\u5361"):
		return resource.TypeGPU
	case containsAny(query, "\u6570\u636e\u5e93", "\u6570\u636e\u96c6", "\u6570\u636e", "dataset", "\u884c\u60c5", "\u8d22\u62a5", "\u7814\u62a5", "\u7d20\u6750", "footage", "database"):
		return resource.TypeDataset
	case containsAny(query, "repo", "repository", "\u4ee3\u7801\u5e93", "\u4ed3\u5e93"):
		return resource.TypeRepository
	case containsAny(query, "\u5b58\u50a8", "storage"):
		return resource.TypeStorage
	case containsAny(query, "\u670d\u52a1\u5668", "vps", "server", "\u4e3b\u673a"):
		return resource.TypeVPS
	default:
		return ""
	}
}

func inferMinVRAM(query string) int {
	if !containsAny(query, "\u663e\u5b58", "vram", "gpu", "cuda", "\u663e\u5361") {
		return 0
	}
	re := regexp.MustCompile(`(?i)(\d{1,4})\s*(g|gb)`)
	match := re.FindStringSubmatch(query)
	if len(match) < 2 {
		return 0
	}
	var value int
	_, _ = fmt.Sscanf(match[1], "%d", &value)
	return value
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, strings.ToLower(needle)) {
			return true
		}
	}
	return false
}

func stringConstraint(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	if value, ok := values[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func intConstraint(values map[string]any, key string) int {
	if values == nil {
		return 0
	}
	switch value := values[key].(type) {
	case int:
		return value
	case float64:
		return int(value)
	case string:
		var out int
		_, _ = fmt.Sscanf(strings.TrimSpace(value), "%d", &out)
		return out
	default:
		return 0
	}
}

func summaryTarget(query NormalizedQuery) string {
	if query.MinVRAMGB > 0 && query.Type == resource.TypeGPU {
		return fmt.Sprintf("GPU sellers with at least %dGB VRAM", query.MinVRAMGB)
	}
	if query.Type != "" {
		return string(query.Type)
	}
	if query.Query != "" {
		return query.Query
	}
	return "your request"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
