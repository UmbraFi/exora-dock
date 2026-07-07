package approval

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"sort"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

const (
	indexKey = "approvals:index"
	ttl      = 365 * 24 * time.Hour
)

type Status string

const (
	StatusPending  Status = "pending"
	StatusApproved Status = "approved"
	StatusRejected Status = "rejected"
	StatusExpired  Status = "expired"
)

type QuoteSummary struct {
	ID               string  `json:"id,omitempty"`
	ProviderPubkey   string  `json:"providerPubkey,omitempty"`
	PriceAmount      float64 `json:"priceAmount,omitempty"`
	Currency         string  `json:"currency,omitempty"`
	EstimatedSeconds int     `json:"estimatedSeconds,omitempty"`
	Notes            string  `json:"notes,omitempty"`
	ExpiresAt        string  `json:"expiresAt,omitempty"`
}

type FileScope struct {
	Name        string `json:"name"`
	SizeBytes   int64  `json:"sizeBytes,omitempty"`
	ContentType string `json:"contentType,omitempty"`
	URI         string `json:"uri,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
}

type Amount struct {
	Value    float64 `json:"value,omitempty"`
	Currency string  `json:"currency,omitempty"`
}

type DecisionReceipt struct {
	Approved  bool   `json:"approved"`
	DecidedBy string `json:"decidedBy,omitempty"`
	UserNote  string `json:"userNote,omitempty"`
	DecidedAt string `json:"decidedAt"`
}

type Approval struct {
	ID                string           `json:"approvalId"`
	TaskID            string           `json:"taskId,omitempty"`
	SubjectType       string           `json:"subjectType,omitempty"`
	SubjectID         string           `json:"subjectId,omitempty"`
	WorkRunID         string           `json:"workRunId,omitempty"`
	PlanID            string           `json:"planId,omitempty"`
	ManifestHash      string           `json:"manifestHash,omitempty"`
	Action            string           `json:"action"`
	UserPubkey        string           `json:"userPubkey"`
	AgentID           string           `json:"agentId"`
	ProviderPubkey    string           `json:"providerPubkey,omitempty"`
	Quote             QuoteSummary     `json:"quote,omitempty"`
	FileScope         []FileScope      `json:"fileScope,omitempty"`
	Amount            Amount           `json:"amount,omitempty"`
	PaymentRequired   bool             `json:"paymentRequired"`
	Status            Status           `json:"status"`
	ApprovalURL       string           `json:"approvalUrl,omitempty"`
	RiskSummary       string           `json:"riskSummary,omitempty"`
	RequiresOwnerAuth bool             `json:"requiresOwnerAuth"`
	NextAction        string           `json:"nextAction,omitempty"`
	CreatedAt         string           `json:"createdAt"`
	UpdatedAt         string           `json:"updatedAt"`
	ExpiresAt         string           `json:"expiresAt"`
	Decision          *DecisionReceipt `json:"decision,omitempty"`
	Metadata          map[string]any   `json:"metadata,omitempty"`
}

type CreateRequest struct {
	TaskID         string         `json:"taskId"`
	SubjectType    string         `json:"subjectType,omitempty"`
	SubjectID      string         `json:"subjectId,omitempty"`
	WorkRunID      string         `json:"workRunId,omitempty"`
	PlanID         string         `json:"planId,omitempty"`
	ManifestHash   string         `json:"manifestHash,omitempty"`
	Action         string         `json:"action"`
	UserPubkey     string         `json:"userPubkey"`
	AgentID        string         `json:"agentId"`
	ProviderPubkey string         `json:"providerPubkey"`
	Quote          QuoteSummary   `json:"quote"`
	FileScope      []FileScope    `json:"fileScope"`
	Amount         Amount         `json:"amount"`
	ExpiresAt      string         `json:"expiresAt"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

type DecisionRequest struct {
	Approved   bool   `json:"approved"`
	DecidedBy  string `json:"decidedBy"`
	UserNote   string `json:"userNote"`
	PaymentPin string `json:"paymentPin,omitempty"`
}

type Store struct {
	cache *cache.Cache
}

func NewStore(c *cache.Cache) *Store {
	return &Store{cache: c}
}

func (s *Store) Create(req CreateRequest) (Approval, error) {
	taskID := strings.TrimSpace(req.TaskID)
	subjectType := strings.TrimSpace(req.SubjectType)
	subjectID := strings.TrimSpace(req.SubjectID)
	workRunID := strings.TrimSpace(req.WorkRunID)
	planID := strings.TrimSpace(req.PlanID)
	manifestHash := strings.TrimSpace(req.ManifestHash)
	action := defaultAction(strings.TrimSpace(req.Action), subjectType, manifestHash)
	user := strings.TrimSpace(req.UserPubkey)
	agent := strings.TrimSpace(req.AgentID)
	if taskID == "" && subjectType == "" && subjectID == "" && planID == "" && manifestHash == "" {
		return Approval{}, fmt.Errorf("task_id or subject required")
	}
	if user == "" {
		return Approval{}, fmt.Errorf("user_pubkey required")
	}
	if agent == "" {
		return Approval{}, fmt.Errorf("agent_id required")
	}

	now := time.Now().UTC()
	expires := now.Add(30 * time.Minute)
	if strings.TrimSpace(req.ExpiresAt) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(req.ExpiresAt))
		if err != nil {
			return Approval{}, fmt.Errorf("expires_at must be RFC3339")
		}
		expires = parsed.UTC()
	}
	if !expires.After(now) {
		return Approval{}, fmt.Errorf("expires_at must be in the future")
	}

	a := Approval{
		ID:             fmt.Sprintf("appr-%d-%s", now.UnixNano(), shortHash(taskID+subjectType+subjectID+planID+manifestHash+user+agent+action)),
		TaskID:         taskID,
		SubjectType:    subjectType,
		SubjectID:      subjectID,
		WorkRunID:      workRunID,
		PlanID:         planID,
		ManifestHash:   manifestHash,
		Action:         action,
		UserPubkey:     user,
		AgentID:        agent,
		ProviderPubkey: strings.TrimSpace(req.ProviderPubkey),
		Quote:          normalizeQuote(req.Quote),
		FileScope:      normalizeFiles(req.FileScope),
		Amount: Amount{
			Value:    req.Amount.Value,
			Currency: strings.TrimSpace(req.Amount.Currency),
		},
		PaymentRequired:   paymentRequired(req),
		Status:            StatusPending,
		RiskSummary:       riskSummary(req),
		RequiresOwnerAuth: true,
		NextAction:        pendingNextAction(action),
		CreatedAt:         now.Format(time.RFC3339),
		UpdatedAt:         now.Format(time.RFC3339),
		ExpiresAt:         expires.Format(time.RFC3339),
		Metadata:          copyMetadata(req.Metadata),
	}
	return a, s.Save(a)
}

func (s *Store) Decide(id string, req DecisionRequest) (Approval, error) {
	a, ok := s.Get(id)
	if !ok {
		return Approval{}, fmt.Errorf("approval not found")
	}
	if a.Status != StatusPending {
		return Approval{}, fmt.Errorf("approval is not pending")
	}
	if isExpired(a.ExpiresAt) {
		a.Status = StatusExpired
		a.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		_ = s.Save(a)
		return Approval{}, fmt.Errorf("approval expired")
	}
	now := time.Now().UTC()
	if req.Approved {
		a.Status = StatusApproved
		a.NextAction = approvedNextAction(a)
	} else {
		a.Status = StatusRejected
		a.NextAction = rejectedNextAction(a)
	}
	a.Decision = &DecisionReceipt{
		Approved:  req.Approved,
		DecidedBy: strings.TrimSpace(req.DecidedBy),
		UserNote:  strings.TrimSpace(req.UserNote),
		DecidedAt: now.Format(time.RFC3339),
	}
	a.UpdatedAt = now.Format(time.RFC3339)
	return a, s.Save(a)
}

func (s *Store) Save(a Approval) error {
	data, err := json.Marshal(a)
	if err != nil {
		return err
	}
	s.cache.Set(FormatApprovalKey(a.ID), data, ttl)

	ids := s.loadIndex()
	found := false
	for _, id := range ids {
		if id == a.ID {
			found = true
			break
		}
	}
	if !found {
		ids = append([]string{a.ID}, ids...)
	}
	indexData, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	s.cache.Set(indexKey, indexData, ttl)
	return nil
}

func (s *Store) Get(id string) (Approval, bool) {
	data, ok := s.cache.Get(FormatApprovalKey(id))
	if !ok {
		return Approval{}, false
	}
	var a Approval
	if err := json.Unmarshal(data, &a); err != nil {
		return Approval{}, false
	}
	if a.Status == StatusPending && isExpired(a.ExpiresAt) {
		a.Status = StatusExpired
		a.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		_ = s.Save(a)
	}
	return a, true
}

func (s *Store) List(filter ListFilter) []Approval {
	ids := s.loadIndex()
	out := make([]Approval, 0, len(ids))
	for _, id := range ids {
		a, ok := s.Get(id)
		if !ok || !filter.matches(a) {
			continue
		}
		out = append(out, a)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

type ListFilter struct {
	Status      Status
	UserPubkey  string
	AgentID     string
	TaskID      string
	SubjectType string
	SubjectID   string
	WorkRunID   string
	PlanID      string
}

func (f ListFilter) matches(a Approval) bool {
	if f.Status != "" && a.Status != f.Status {
		return false
	}
	if strings.TrimSpace(f.UserPubkey) != "" && a.UserPubkey != strings.TrimSpace(f.UserPubkey) {
		return false
	}
	if strings.TrimSpace(f.AgentID) != "" && a.AgentID != strings.TrimSpace(f.AgentID) {
		return false
	}
	if strings.TrimSpace(f.TaskID) != "" && a.TaskID != strings.TrimSpace(f.TaskID) {
		return false
	}
	if strings.TrimSpace(f.SubjectType) != "" && a.SubjectType != strings.TrimSpace(f.SubjectType) {
		return false
	}
	if strings.TrimSpace(f.SubjectID) != "" && a.SubjectID != strings.TrimSpace(f.SubjectID) {
		return false
	}
	if strings.TrimSpace(f.WorkRunID) != "" && a.WorkRunID != strings.TrimSpace(f.WorkRunID) {
		return false
	}
	if strings.TrimSpace(f.PlanID) != "" && a.PlanID != strings.TrimSpace(f.PlanID) {
		return false
	}
	return true
}

func (s *Store) loadIndex() []string {
	data, ok := s.cache.Get(indexKey)
	if !ok {
		return nil
	}
	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		return nil
	}
	return ids
}

func FormatApprovalKey(id string) string {
	return fmt.Sprintf("approval:%s", id)
}

func normalizeQuote(q QuoteSummary) QuoteSummary {
	q.ID = strings.TrimSpace(q.ID)
	q.ProviderPubkey = strings.TrimSpace(q.ProviderPubkey)
	q.Currency = strings.TrimSpace(q.Currency)
	q.Notes = strings.TrimSpace(q.Notes)
	q.ExpiresAt = strings.TrimSpace(q.ExpiresAt)
	return q
}

func normalizeFiles(files []FileScope) []FileScope {
	out := make([]FileScope, 0, len(files))
	for _, file := range files {
		file.Name = strings.TrimSpace(file.Name)
		file.ContentType = strings.TrimSpace(file.ContentType)
		file.URI = strings.TrimSpace(file.URI)
		file.SHA256 = strings.TrimSpace(file.SHA256)
		if file.Name != "" || file.URI != "" || file.SHA256 != "" {
			out = append(out, file)
		}
	}
	return out
}

func riskSummary(req CreateRequest) string {
	parts := []string{}
	if strings.TrimSpace(req.SubjectType) != "" {
		parts = append(parts, "subject "+strings.TrimSpace(req.SubjectType))
	}
	if strings.TrimSpace(req.PlanID) != "" {
		parts = append(parts, "plan "+strings.TrimSpace(req.PlanID))
	}
	if strings.TrimSpace(req.ManifestHash) != "" {
		parts = append(parts, "manifest "+shortDisplayHash(req.ManifestHash))
	}
	if strings.TrimSpace(req.ProviderPubkey) != "" {
		parts = append(parts, "provider "+strings.TrimSpace(req.ProviderPubkey))
	}
	amount := req.Amount.Value
	if amount == 0 {
		amount = req.Quote.PriceAmount
	}
	if amount > 0 {
		currency := strings.TrimSpace(req.Amount.Currency)
		if currency == "" {
			currency = strings.TrimSpace(req.Quote.Currency)
		}
		parts = append(parts, fmt.Sprintf("spend %.4g %s", amount, currency))
	}
	if len(req.FileScope) > 0 {
		parts = append(parts, fmt.Sprintf("%d input file(s)", len(req.FileScope)))
	}
	if len(parts) == 0 {
		return "Approval required before this action can continue."
	}
	return "Approval required for " + strings.Join(parts, ", ") + "."
}

func paymentRequired(req CreateRequest) bool {
	return req.Amount.Value > 0 || req.Quote.PriceAmount > 0
}

func defaultAction(action, subjectType, manifestHash string) string {
	if action != "" {
		return action
	}
	if subjectType == "buyer_manifest" || manifestHash != "" {
		return "submit_remote_task_manifest"
	}
	return "approve_quote"
}

func pendingNextAction(action string) string {
	switch strings.TrimSpace(action) {
	case "submit_remote_task_manifest":
		return "review_remote_task_manifest"
	case "seller_execution_plan":
		return "review_seller_execution_plan"
	default:
		return "approve_or_reject"
	}
}

func approvedNextAction(a Approval) string {
	switch strings.TrimSpace(a.Action) {
	case "submit_remote_task_manifest":
		return "submit_manifest_for_matching"
	case "seller_execution_plan":
		return "run_seller_execution_plan"
	default:
		if strings.TrimSpace(a.TaskID) == "" {
			return "approval_recorded"
		}
		return "wait_for_task_execution"
	}
}

func rejectedNextAction(a Approval) string {
	switch strings.TrimSpace(a.Action) {
	case "submit_remote_task_manifest":
		return "manifest_submission_rejected"
	case "seller_execution_plan":
		return "seller_execution_rejected"
	default:
		if strings.TrimSpace(a.TaskID) == "" {
			return "approval_rejected"
		}
		return "task_rejected"
	}
}

func copyMetadata(value map[string]any) map[string]any {
	if len(value) == 0 {
		return nil
	}
	out := make(map[string]any, len(value))
	for key, item := range value {
		key = strings.TrimSpace(key)
		if key != "" {
			out[key] = item
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func shortDisplayHash(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 20 {
		return value
	}
	return value[:20]
}

func isExpired(value string) bool {
	t, err := time.Parse(time.RFC3339, value)
	return err == nil && !t.After(time.Now().UTC())
}

func shortHash(value string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return fmt.Sprintf("%08x", h.Sum32())
}
