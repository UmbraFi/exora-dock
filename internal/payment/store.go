package payment

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"sort"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/cache"
)

const (
	indexKey = "payments:index"
	ttl      = 365 * 24 * time.Hour
)

type Status string

const (
	StatusRequiresConfirmation Status = "requires_confirmation"
	StatusConfirmedSimulated   Status = "confirmed_simulated"
)

type Record struct {
	ID             string  `json:"paymentId"`
	ApprovalID     string  `json:"approvalId"`
	TaskID         string  `json:"taskId"`
	ProviderPubkey string  `json:"providerPubkey,omitempty"`
	Amount         float64 `json:"amount,omitempty"`
	Currency       string  `json:"currency,omitempty"`
	Mode           string  `json:"mode"`
	Status         Status  `json:"status"`
	ProofRef       string  `json:"proofRef,omitempty"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
	ConfirmedAt    string  `json:"confirmedAt,omitempty"`
}

type ListFilter struct {
	ApprovalID string
	TaskID     string
}

type Store struct {
	cache *cache.Cache
}

func NewStore(c *cache.Cache) *Store {
	return &Store{cache: c}
}

func (s *Store) EnsureIntent(a approval.Approval) (Record, error) {
	if !a.PaymentRequired {
		return Record{}, fmt.Errorf("payment is not required")
	}
	if existing, ok := s.GetByApproval(a.ID); ok {
		return existing, nil
	}
	now := time.Now().UTC()
	record := Record{
		ID:             fmt.Sprintf("pay-%d-%s", now.UnixNano(), shortHash(a.ID+a.TaskID)),
		ApprovalID:     a.ID,
		TaskID:         a.TaskID,
		ProviderPubkey: firstNonEmpty(a.ProviderPubkey, a.Quote.ProviderPubkey),
		Amount:         firstPositive(a.Amount.Value, a.Quote.PriceAmount),
		Currency:       strings.TrimSpace(a.Amount.Currency),
		Mode:           "simulated",
		Status:         StatusRequiresConfirmation,
		CreatedAt:      now.Format(time.RFC3339),
		UpdatedAt:      now.Format(time.RFC3339),
	}
	if record.Currency == "" {
		record.Currency = strings.TrimSpace(a.Quote.Currency)
	}
	return record, s.Save(record)
}

func (s *Store) ConfirmSimulated(a approval.Approval) (Record, error) {
	record, err := s.EnsureIntent(a)
	if err != nil {
		return Record{}, err
	}
	now := time.Now().UTC()
	record.Status = StatusConfirmedSimulated
	record.ProofRef = "simulated:" + shortHash(record.ID+now.Format(time.RFC3339Nano))
	record.UpdatedAt = now.Format(time.RFC3339)
	record.ConfirmedAt = now.Format(time.RFC3339)
	return record, s.Save(record)
}

func (s *Store) Save(record Record) error {
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	s.cache.Set(FormatPaymentKey(record.ID), data, ttl)
	ids := s.loadIndex()
	found := false
	for _, id := range ids {
		if id == record.ID {
			found = true
			break
		}
	}
	if !found {
		ids = append([]string{record.ID}, ids...)
	}
	indexData, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	s.cache.Set(indexKey, indexData, ttl)
	return nil
}

func (s *Store) Get(id string) (Record, bool) {
	data, ok := s.cache.Get(FormatPaymentKey(id))
	if !ok {
		return Record{}, false
	}
	var record Record
	if err := json.Unmarshal(data, &record); err != nil {
		return Record{}, false
	}
	return record, true
}

func (s *Store) GetByApproval(approvalID string) (Record, bool) {
	for _, record := range s.List(ListFilter{ApprovalID: approvalID}) {
		return record, true
	}
	return Record{}, false
}

func (s *Store) List(filter ListFilter) []Record {
	ids := s.loadIndex()
	out := make([]Record, 0, len(ids))
	for _, id := range ids {
		record, ok := s.Get(id)
		if !ok {
			continue
		}
		if filter.ApprovalID != "" && record.ApprovalID != filter.ApprovalID {
			continue
		}
		if filter.TaskID != "" && record.TaskID != filter.TaskID {
			continue
		}
		out = append(out, record)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
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

func FormatPaymentKey(id string) string {
	return fmt.Sprintf("payment:%s", id)
}

func shortHash(value string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return fmt.Sprintf("%08x", h.Sum32())
}

func firstPositive(values ...float64) float64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
