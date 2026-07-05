package negotiation

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"sort"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/market"
	"github.com/exora-dock/exora-dock/internal/task"
)

const (
	indexKey = "negotiations:index"
	ttl      = 365 * 24 * time.Hour
)

type Status string

const (
	StatusPendingSellerDecision Status = "pending_seller_decision"
	StatusQuoted                Status = "quoted"
	StatusRejected              Status = "rejected"
	StatusManualReview          Status = "manual_review"
	StatusExpired               Status = "expired"
	StatusCancelled             Status = "cancelled"
)

type Message struct {
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

type Quote struct {
	ID                   string             `json:"id"`
	ProviderPubkey       string             `json:"providerPubkey"`
	ResourceID           string             `json:"resourceId,omitempty"`
	PriceAmount          float64            `json:"priceAmount,omitempty"`
	Currency             string             `json:"currency,omitempty"`
	EstimatedSeconds     int                `json:"estimatedSeconds,omitempty"`
	RequiredInputs       []string           `json:"requiredInputs,omitempty"`
	RequiredPermissions  []string           `json:"requiredPermissions,omitempty"`
	ExecutionPlanSummary string             `json:"executionPlanSummary,omitempty"`
	FailurePolicy        string             `json:"failurePolicy,omitempty"`
	DeliveryFormat       string             `json:"deliveryFormat,omitempty"`
	DataProvenance       string             `json:"dataProvenance,omitempty"`
	RetentionCommitment  string             `json:"retentionCommitment,omitempty"`
	SellerApprovalMode   string             `json:"sellerApprovalMode,omitempty"`
	Notes                string             `json:"notes,omitempty"`
	Runtime              string             `json:"runtime,omitempty"`
	Docker               task.DockerRunSpec `json:"docker,omitempty"`
	CreatedAt            string             `json:"createdAt"`
	ExpiresAt            string             `json:"expiresAt,omitempty"`
	Signature            string             `json:"signature,omitempty"`
}

type Rejection struct {
	Reason        string   `json:"reason"`
	RiskSummary   string   `json:"riskSummary,omitempty"`
	MissingInputs []string `json:"missingInputs,omitempty"`
	CreatedAt     string   `json:"createdAt"`
	Signature     string   `json:"signature,omitempty"`
}

type Negotiation struct {
	ID                string            `json:"negotiationId"`
	Status            Status            `json:"status"`
	Intent            string            `json:"intent"`
	BuyerAgentCardID  string            `json:"buyerAgentCardId,omitempty"`
	SellerAgentCardID string            `json:"sellerAgentCardId,omitempty"`
	RequesterPubkey   string            `json:"requesterPubkey,omitempty"`
	AgentID           string            `json:"agentId,omitempty"`
	ProviderPubkey    string            `json:"providerPubkey,omitempty"`
	ResourceID        string            `json:"resourceId,omitempty"`
	ProviderEndpoint  string            `json:"providerEndpoint,omitempty"`
	Draft             market.OrderDraft `json:"draft"`
	Messages          []Message         `json:"messages,omitempty"`
	Quote             *Quote            `json:"quote,omitempty"`
	Rejection         *Rejection        `json:"rejection,omitempty"`
	OrderPlanID       string            `json:"orderPlanId,omitempty"`
	NextAction        string            `json:"nextAction,omitempty"`
	Error             string            `json:"error,omitempty"`
	CreatedAt         string            `json:"createdAt"`
	UpdatedAt         string            `json:"updatedAt"`
	ExpiresAt         string            `json:"expiresAt"`
}

type CreateRequest struct {
	Intent            string
	BuyerAgentCardID  string
	SellerAgentCardID string
	RequesterPubkey   string
	AgentID           string
	ProviderPubkey    string
	ResourceID        string
	ProviderEndpoint  string
	Draft             market.OrderDraft
	Messages          []Message
	ExpiresAt         string
	ID                string
}

type QuoteRequest struct {
	QuoteID              string
	ProviderPubkey       string
	ResourceID           string
	PriceAmount          float64
	Currency             string
	EstimatedSeconds     int
	RequiredInputs       []string
	RequiredPermissions  []string
	ExecutionPlanSummary string
	FailurePolicy        string
	DeliveryFormat       string
	DataProvenance       string
	RetentionCommitment  string
	SellerApprovalMode   string
	Notes                string
	Runtime              string
	Docker               task.DockerRunSpec
	ExpiresAt            string
	Signature            string
}

type RejectRequest struct {
	Reason        string
	RiskSummary   string
	MissingInputs []string
	Signature     string
}

type ListFilter struct {
	Status          Status
	ProviderPubkey  string
	RequesterPubkey string
	OrderPlanID     string
}

type Store struct {
	cache *cache.Cache
}

func NewStore(c *cache.Cache) *Store {
	return &Store{cache: c}
}

func (s *Store) Create(req CreateRequest) (Negotiation, error) {
	if s == nil || s.cache == nil {
		return Negotiation{}, fmt.Errorf("negotiation store not configured")
	}
	intent := strings.TrimSpace(req.Intent)
	if intent == "" {
		intent = strings.TrimSpace(req.Draft.Goal)
	}
	if intent == "" {
		return Negotiation{}, fmt.Errorf("intent required")
	}
	now := time.Now().UTC()
	expires := now.Add(30 * time.Minute)
	if strings.TrimSpace(req.ExpiresAt) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(req.ExpiresAt))
		if err != nil {
			return Negotiation{}, fmt.Errorf("expires_at must be RFC3339")
		}
		expires = parsed.UTC()
	}
	if !expires.After(now) {
		return Negotiation{}, fmt.Errorf("expires_at must be in the future")
	}
	id := strings.TrimSpace(req.ID)
	if id == "" {
		id = fmt.Sprintf("nego-%d-%s", now.UnixNano(), shortHash(intent+req.ProviderPubkey+req.ResourceID))
	}
	n := Negotiation{
		ID:                id,
		Status:            StatusPendingSellerDecision,
		Intent:            intent,
		BuyerAgentCardID:  strings.TrimSpace(req.BuyerAgentCardID),
		SellerAgentCardID: strings.TrimSpace(req.SellerAgentCardID),
		RequesterPubkey:   strings.TrimSpace(req.RequesterPubkey),
		AgentID:           strings.TrimSpace(req.AgentID),
		ProviderPubkey:    strings.TrimSpace(req.ProviderPubkey),
		ResourceID:        strings.TrimSpace(req.ResourceID),
		ProviderEndpoint:  strings.TrimSpace(req.ProviderEndpoint),
		Draft:             req.Draft,
		Messages:          normalizeMessages(req.Messages, now),
		NextAction:        "wait_for_seller_decision",
		CreatedAt:         now.Format(time.RFC3339),
		UpdatedAt:         now.Format(time.RFC3339),
		ExpiresAt:         expires.Format(time.RFC3339),
	}
	if strings.TrimSpace(n.Draft.ProviderPubkey) == "" {
		n.Draft.ProviderPubkey = n.ProviderPubkey
	}
	if strings.TrimSpace(n.Draft.ResourceID) == "" {
		n.Draft.ResourceID = n.ResourceID
	}
	if strings.TrimSpace(n.Draft.RequesterPubkey) == "" {
		n.Draft.RequesterPubkey = n.RequesterPubkey
	}
	if strings.TrimSpace(n.Draft.AgentID) == "" {
		n.Draft.AgentID = n.AgentID
	}
	return n, s.Save(n)
}

func (s *Store) Save(n Negotiation) error {
	if s == nil || s.cache == nil {
		return fmt.Errorf("negotiation store not configured")
	}
	if strings.TrimSpace(n.ID) == "" {
		return fmt.Errorf("negotiation_id required")
	}
	data, err := json.Marshal(n)
	if err != nil {
		return err
	}
	s.cache.Set(FormatNegotiationKey(n.ID), data, ttl)
	ids := s.loadIndex()
	found := false
	for _, id := range ids {
		if id == n.ID {
			found = true
			break
		}
	}
	if !found {
		ids = append([]string{n.ID}, ids...)
	}
	indexData, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	s.cache.Set(indexKey, indexData, ttl)
	return nil
}

func (s *Store) Get(id string) (Negotiation, bool) {
	if s == nil || s.cache == nil {
		return Negotiation{}, false
	}
	data, ok := s.cache.Get(FormatNegotiationKey(id))
	if !ok {
		return Negotiation{}, false
	}
	var n Negotiation
	if err := json.Unmarshal(data, &n); err != nil {
		return Negotiation{}, false
	}
	if isActive(n.Status) && isExpired(n.ExpiresAt) {
		n.Status = StatusExpired
		n.NextAction = "start_negotiation_again"
		n.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		_ = s.Save(n)
	}
	return n, true
}

func (s *Store) List(filter ListFilter) []Negotiation {
	ids := s.loadIndex()
	out := make([]Negotiation, 0, len(ids))
	for _, id := range ids {
		n, ok := s.Get(id)
		if !ok || !filter.matches(n) {
			continue
		}
		out = append(out, n)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

func (s *Store) MarkQuoted(id string, req QuoteRequest) (Negotiation, error) {
	n, ok := s.Get(id)
	if !ok {
		return Negotiation{}, fmt.Errorf("negotiation not found")
	}
	provider := strings.TrimSpace(req.ProviderPubkey)
	if provider == "" {
		provider = n.ProviderPubkey
	}
	if provider == "" {
		return Negotiation{}, fmt.Errorf("provider_pubkey required")
	}
	if req.PriceAmount < 0 {
		return Negotiation{}, fmt.Errorf("price_amount cannot be negative")
	}
	now := time.Now().UTC()
	currency := strings.TrimSpace(req.Currency)
	if currency == "" {
		currency = "USD"
	}
	expires := strings.TrimSpace(req.ExpiresAt)
	if expires == "" {
		expires = now.Add(30 * time.Minute).Format(time.RFC3339)
	}
	n.Status = StatusQuoted
	n.ProviderPubkey = provider
	if strings.TrimSpace(req.ResourceID) != "" {
		n.ResourceID = strings.TrimSpace(req.ResourceID)
	}
	quoteID := strings.TrimSpace(req.QuoteID)
	if quoteID == "" {
		quoteID = fmt.Sprintf("quote-%d-%s", now.UnixNano(), shortHash(id+provider))
	}
	n.Quote = &Quote{
		ID:                   quoteID,
		ProviderPubkey:       provider,
		ResourceID:           firstNonEmpty(strings.TrimSpace(req.ResourceID), n.ResourceID),
		PriceAmount:          req.PriceAmount,
		Currency:             currency,
		EstimatedSeconds:     req.EstimatedSeconds,
		RequiredInputs:       compactStrings(req.RequiredInputs),
		RequiredPermissions:  compactStrings(req.RequiredPermissions),
		ExecutionPlanSummary: strings.TrimSpace(req.ExecutionPlanSummary),
		FailurePolicy:        strings.TrimSpace(req.FailurePolicy),
		DeliveryFormat:       strings.TrimSpace(req.DeliveryFormat),
		DataProvenance:       strings.TrimSpace(req.DataProvenance),
		RetentionCommitment:  strings.TrimSpace(req.RetentionCommitment),
		SellerApprovalMode:   strings.TrimSpace(req.SellerApprovalMode),
		Notes:                strings.TrimSpace(req.Notes),
		Runtime:              strings.TrimSpace(req.Runtime),
		Docker:               req.Docker,
		CreatedAt:            now.Format(time.RFC3339),
		ExpiresAt:            expires,
		Signature:            strings.TrimSpace(req.Signature),
	}
	n.Rejection = nil
	n.NextAction = "create_order_plan_from_quote"
	n.Error = ""
	n.UpdatedAt = now.Format(time.RFC3339)
	return n, s.Save(n)
}

func (s *Store) MarkRejected(id string, req RejectRequest) (Negotiation, error) {
	n, ok := s.Get(id)
	if !ok {
		return Negotiation{}, fmt.Errorf("negotiation not found")
	}
	now := time.Now().UTC()
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "seller rejected the task"
	}
	n.Status = StatusRejected
	n.Rejection = &Rejection{
		Reason:        reason,
		RiskSummary:   strings.TrimSpace(req.RiskSummary),
		MissingInputs: compactStrings(req.MissingInputs),
		CreatedAt:     now.Format(time.RFC3339),
		Signature:     strings.TrimSpace(req.Signature),
	}
	n.Quote = nil
	n.NextAction = "inspect_rejection_or_try_another_seller"
	n.Error = reason
	n.UpdatedAt = now.Format(time.RFC3339)
	return n, s.Save(n)
}

func (s *Store) MarkManualReview(id string, reason string) (Negotiation, error) {
	n, ok := s.Get(id)
	if !ok {
		return Negotiation{}, fmt.Errorf("negotiation not found")
	}
	n.Status = StatusManualReview
	n.NextAction = "wait_for_seller_manual_review"
	n.Error = strings.TrimSpace(reason)
	if n.Error == "" {
		n.Error = "seller manual review required"
	}
	n.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return n, s.Save(n)
}

func (s *Store) AttachOrderPlan(id string, planID string) (Negotiation, error) {
	n, ok := s.Get(id)
	if !ok {
		return Negotiation{}, fmt.Errorf("negotiation not found")
	}
	n.OrderPlanID = strings.TrimSpace(planID)
	n.NextAction = "wait_for_owner_to_choose_order_plan"
	n.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return n, s.Save(n)
}

func (s *Store) Cancel(id string, note string) (Negotiation, error) {
	n, ok := s.Get(id)
	if !ok {
		return Negotiation{}, fmt.Errorf("negotiation not found")
	}
	n.Status = StatusCancelled
	n.NextAction = "cancelled"
	n.Error = strings.TrimSpace(note)
	if n.Error == "" {
		n.Error = "cancelled"
	}
	n.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return n, s.Save(n)
}

func FormatNegotiationKey(id string) string {
	return "negotiation:" + strings.TrimSpace(id)
}

func (f ListFilter) matches(n Negotiation) bool {
	if f.Status != "" && n.Status != f.Status {
		return false
	}
	if strings.TrimSpace(f.ProviderPubkey) != "" && n.ProviderPubkey != strings.TrimSpace(f.ProviderPubkey) {
		return false
	}
	if strings.TrimSpace(f.RequesterPubkey) != "" && n.RequesterPubkey != strings.TrimSpace(f.RequesterPubkey) {
		return false
	}
	if strings.TrimSpace(f.OrderPlanID) != "" && n.OrderPlanID != strings.TrimSpace(f.OrderPlanID) {
		return false
	}
	return true
}

func (s *Store) loadIndex() []string {
	if s == nil || s.cache == nil {
		return nil
	}
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

func normalizeMessages(values []Message, now time.Time) []Message {
	out := make([]Message, 0, len(values))
	for _, msg := range values {
		msg.Role = strings.TrimSpace(msg.Role)
		msg.Content = strings.TrimSpace(msg.Content)
		if msg.Role == "" || msg.Content == "" {
			continue
		}
		if strings.TrimSpace(msg.CreatedAt) == "" {
			msg.CreatedAt = now.Format(time.RFC3339)
		}
		out = append(out, msg)
	}
	return out
}

func compactStrings(values []string) []string {
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func isActive(status Status) bool {
	return status == StatusPendingSellerDecision || status == StatusManualReview
}

func isExpired(value string) bool {
	t, err := time.Parse(time.RFC3339, value)
	return err == nil && !t.After(time.Now().UTC())
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func shortHash(value string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return fmt.Sprintf("%08x", h.Sum32())
}
