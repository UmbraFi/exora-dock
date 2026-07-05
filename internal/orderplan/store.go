package orderplan

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"sort"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/market"
)

const (
	indexKey = "order-plans:index"
	ttl      = 365 * 24 * time.Hour
)

type Status string

const (
	StatusPendingSelection Status = "pending_selection"
	StatusSelected         Status = "selected"
	StatusExpired          Status = "expired"
	StatusInvalidated      Status = "invalidated"
)

type Plan struct {
	ID                string                    `json:"planId"`
	Query             string                    `json:"query"`
	ProjectPath       string                    `json:"projectPath,omitempty"`
	WorkUID           string                    `json:"workUid,omitempty"`
	RequesterPubkey   string                    `json:"requesterPubkey,omitempty"`
	AgentID           string                    `json:"agentId,omitempty"`
	NormalizedQuery   market.NormalizedQuery    `json:"normalizedQuery"`
	Status            Status                    `json:"status"`
	Options           []market.OrderDraftOption `json:"options"`
	RealtimeRequired  bool                      `json:"realtimeRequired,omitempty"`
	Candidates        []CandidateState          `json:"candidates,omitempty"`
	Events            []Event                   `json:"events,omitempty"`
	SelectedOptionID  string                    `json:"selectedOptionId,omitempty"`
	TaskID            string                    `json:"taskId,omitempty"`
	ApprovalID        string                    `json:"approvalId,omitempty"`
	PaymentID         string                    `json:"paymentId,omitempty"`
	ProviderJobID     string                    `json:"providerJobId,omitempty"`
	InvalidationCause string                    `json:"invalidationCause,omitempty"`
	CreatedAt         string                    `json:"createdAt"`
	UpdatedAt         string                    `json:"updatedAt"`
	ExpiresAt         string                    `json:"expiresAt"`
	NextAction        string                    `json:"nextAction,omitempty"`
}

type CreateRequest struct {
	Query            string
	ProjectPath      string
	WorkUID          string
	RequesterPubkey  string
	AgentID          string
	NormalizedQuery  market.NormalizedQuery
	Options          []market.OrderDraftOption
	RealtimeRequired bool
	Candidates       []CandidateState
	Events           []Event
	ExpiresAt        string
}

type CandidateState struct {
	OptionID       string  `json:"optionId,omitempty"`
	ResourceID     string  `json:"resourceId,omitempty"`
	ProviderPubkey string  `json:"providerPubkey,omitempty"`
	Endpoint       string  `json:"endpoint,omitempty"`
	Status         string  `json:"status"`
	Message        string  `json:"message,omitempty"`
	QuoteID        string  `json:"quoteId,omitempty"`
	PriceAmount    float64 `json:"priceAmount,omitempty"`
	Currency       string  `json:"currency,omitempty"`
	ExpiresAt      string  `json:"expiresAt,omitempty"`
	UpdatedAt      string  `json:"updatedAt,omitempty"`
}

type Event struct {
	Time     string `json:"time"`
	Type     string `json:"type"`
	Message  string `json:"message,omitempty"`
	OptionID string `json:"optionId,omitempty"`
}

type SelectionRequest struct {
	OptionID   string `json:"optionId"`
	PaymentPin string `json:"paymentPin,omitempty"`
	UserNote   string `json:"userNote,omitempty"`
}

type ListFilter struct {
	Status Status
}

type Store struct {
	cache *cache.Cache
}

func NewStore(c *cache.Cache) *Store {
	return &Store{cache: c}
}

func (s *Store) Create(req CreateRequest) (Plan, error) {
	if len(req.Options) == 0 && !req.RealtimeRequired {
		return Plan{}, fmt.Errorf("order plan requires at least one option")
	}
	options := append([]market.OrderDraftOption(nil), req.Options...)
	if len(options) > market.MaxOrderOptions {
		options = options[:market.MaxOrderOptions]
	}
	now := time.Now().UTC()
	expires := now.Add(30 * time.Minute)
	if strings.TrimSpace(req.ExpiresAt) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(req.ExpiresAt))
		if err != nil {
			return Plan{}, fmt.Errorf("expires_at must be RFC3339")
		}
		expires = parsed.UTC()
	}
	seed := strings.TrimSpace(req.Query)
	for _, option := range options {
		seed += option.ResourceID + option.ProviderPubkey
	}
	plan := Plan{
		ID:               fmt.Sprintf("opln-%d-%s", now.UnixNano(), shortHash(seed)),
		Query:            strings.TrimSpace(req.Query),
		ProjectPath:      strings.TrimSpace(req.ProjectPath),
		WorkUID:          strings.TrimSpace(req.WorkUID),
		RequesterPubkey:  strings.TrimSpace(req.RequesterPubkey),
		AgentID:          strings.TrimSpace(req.AgentID),
		NormalizedQuery:  req.NormalizedQuery,
		Status:           StatusPendingSelection,
		Options:          options,
		RealtimeRequired: req.RealtimeRequired,
		Candidates:       req.Candidates,
		Events:           withEventTimes(req.Events, now),
		CreatedAt:        now.Format(time.RFC3339),
		UpdatedAt:        now.Format(time.RFC3339),
		ExpiresAt:        expires.Format(time.RFC3339),
		NextAction:       "choose_seller_option",
	}
	return plan, s.Save(plan)
}

func (s *Store) Save(plan Plan) error {
	data, err := json.Marshal(plan)
	if err != nil {
		return err
	}
	s.cache.Set(FormatPlanKey(plan.ID), data, ttl)
	ids := s.loadIndex()
	found := false
	for _, id := range ids {
		if id == plan.ID {
			found = true
			break
		}
	}
	if !found {
		ids = append([]string{plan.ID}, ids...)
	}
	indexData, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	s.cache.Set(indexKey, indexData, ttl)
	return nil
}

func (s *Store) Get(id string) (Plan, bool) {
	data, ok := s.cache.Get(FormatPlanKey(id))
	if !ok {
		return Plan{}, false
	}
	var plan Plan
	if err := json.Unmarshal(data, &plan); err != nil {
		return Plan{}, false
	}
	if plan.Status == StatusPendingSelection && isExpired(plan.ExpiresAt) {
		plan.Status = StatusExpired
		plan.NextAction = "run_find_sellers_again"
		plan.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		_ = s.Save(plan)
	}
	return plan, true
}

func (s *Store) List(filter ListFilter) []Plan {
	ids := s.loadIndex()
	out := make([]Plan, 0, len(ids))
	for _, id := range ids {
		plan, ok := s.Get(id)
		if !ok {
			continue
		}
		if filter.Status != "" && plan.Status != filter.Status {
			continue
		}
		out = append(out, plan)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

func (s *Store) FindOption(plan Plan, optionID string) (market.OrderDraftOption, bool) {
	optionID = strings.TrimSpace(optionID)
	for _, option := range plan.Options {
		if option.OptionID == optionID {
			return option, true
		}
	}
	return market.OrderDraftOption{}, false
}

func (s *Store) MarkSelected(plan Plan, optionID, taskID, approvalID, paymentID string) (Plan, error) {
	plan.Status = StatusSelected
	plan.SelectedOptionID = strings.TrimSpace(optionID)
	plan.TaskID = strings.TrimSpace(taskID)
	plan.ApprovalID = strings.TrimSpace(approvalID)
	plan.PaymentID = strings.TrimSpace(paymentID)
	plan.NextAction = "wait_for_task_execution"
	plan.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return plan, s.Save(plan)
}

func (s *Store) MarkProviderJob(plan Plan, jobID string) (Plan, error) {
	plan.ProviderJobID = strings.TrimSpace(jobID)
	if plan.NextAction == "" || plan.NextAction == "wait_for_task_execution" {
		plan.NextAction = "wait_for_provider_job"
	}
	plan.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return plan, s.Save(plan)
}

func (s *Store) AddEvent(plan Plan, typ, message, optionID string) (Plan, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	plan.Events = append(plan.Events, Event{
		Time:     now,
		Type:     strings.TrimSpace(typ),
		Message:  strings.TrimSpace(message),
		OptionID: strings.TrimSpace(optionID),
	})
	plan.UpdatedAt = now
	return plan, s.Save(plan)
}

func (s *Store) MarkInvalidated(plan Plan, cause string) (Plan, error) {
	plan.Status = StatusInvalidated
	plan.InvalidationCause = strings.TrimSpace(cause)
	plan.NextAction = "run_find_sellers_again"
	plan.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return plan, s.Save(plan)
}

func (s *Store) Cancel(plan Plan, note string) (Plan, error) {
	plan.Status = StatusInvalidated
	plan.InvalidationCause = strings.TrimSpace(note)
	if plan.InvalidationCause == "" {
		plan.InvalidationCause = "cancelled"
	}
	plan.NextAction = "cancelled"
	plan.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return plan, s.Save(plan)
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

func FormatPlanKey(id string) string {
	return fmt.Sprintf("order-plan:%s", id)
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

func withEventTimes(events []Event, now time.Time) []Event {
	if len(events) == 0 {
		return nil
	}
	out := append([]Event(nil), events...)
	for i := range out {
		if strings.TrimSpace(out[i].Time) == "" {
			out[i].Time = now.Format(time.RFC3339)
		}
	}
	return out
}
