package delegation

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"sort"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/resource"
)

const (
	indexKey = "delegations:index"
	ttl      = 365 * 24 * time.Hour
)

type Status string

const (
	StatusActive  Status = "active"
	StatusRevoked Status = "revoked"
	StatusExpired Status = "expired"
)

type Delegation struct {
	ID                 string          `json:"id"`
	UserPubkey         string          `json:"userPubkey"`
	AgentID            string          `json:"agentId"`
	ResourceTypes      []resource.Type `json:"resourceTypes"`
	BudgetLimit        float64         `json:"budgetLimit"`
	MaxDurationMinutes int             `json:"maxDurationMinutes"`
	AllowedRegions     []string        `json:"allowedRegions,omitempty"`
	AutoRenew          bool            `json:"autoRenew"`
	Status             Status          `json:"status"`
	CreatedAt          string          `json:"createdAt"`
	UpdatedAt          string          `json:"updatedAt"`
	ExpiresAt          string          `json:"expiresAt"`
}

type CreateRequest struct {
	UserPubkey         string          `json:"userPubkey"`
	AgentID            string          `json:"agentId"`
	ResourceTypes      []resource.Type `json:"resourceTypes"`
	BudgetLimit        float64         `json:"budgetLimit"`
	MaxDurationMinutes int             `json:"maxDurationMinutes"`
	AllowedRegions     []string        `json:"allowedRegions"`
	AutoRenew          bool            `json:"autoRenew"`
	ExpiresAt          string          `json:"expiresAt"`
}

type Store struct {
	cache *cache.Cache
}

func NewStore(c *cache.Cache) *Store {
	return &Store{cache: c}
}

func (s *Store) Create(req CreateRequest) (Delegation, error) {
	user := strings.TrimSpace(req.UserPubkey)
	agent := strings.TrimSpace(req.AgentID)
	if user == "" {
		return Delegation{}, fmt.Errorf("user_pubkey required")
	}
	if agent == "" {
		return Delegation{}, fmt.Errorf("agent_id required")
	}
	if req.BudgetLimit <= 0 {
		return Delegation{}, fmt.Errorf("budget_limit must be greater than 0")
	}
	if req.MaxDurationMinutes <= 0 {
		return Delegation{}, fmt.Errorf("max_duration_minutes must be greater than 0")
	}
	for _, kind := range req.ResourceTypes {
		if !resource.IsKnownType(kind) {
			return Delegation{}, fmt.Errorf("unknown resource type: %s", kind)
		}
	}

	now := time.Now().UTC()
	expires := now.Add(24 * time.Hour)
	if req.ExpiresAt != "" {
		parsed, err := time.Parse(time.RFC3339, req.ExpiresAt)
		if err != nil {
			return Delegation{}, fmt.Errorf("expires_at must be RFC3339")
		}
		expires = parsed.UTC()
	}
	if !expires.After(now) {
		return Delegation{}, fmt.Errorf("expires_at must be in the future")
	}

	d := Delegation{
		ID:                 fmt.Sprintf("del-%d-%s", now.UnixNano(), shortHash(user+agent)),
		UserPubkey:         user,
		AgentID:            agent,
		ResourceTypes:      uniqueTypes(req.ResourceTypes),
		BudgetLimit:        req.BudgetLimit,
		MaxDurationMinutes: req.MaxDurationMinutes,
		AllowedRegions:     uniqueStrings(req.AllowedRegions),
		AutoRenew:          req.AutoRenew,
		Status:             StatusActive,
		CreatedAt:          now.Format(time.RFC3339),
		UpdatedAt:          now.Format(time.RFC3339),
		ExpiresAt:          expires.Format(time.RFC3339),
	}
	return d, s.Save(d)
}

func (s *Store) Save(d Delegation) error {
	data, err := json.Marshal(d)
	if err != nil {
		return err
	}
	s.cache.Set(FormatDelegationKey(d.ID), data, ttl)

	ids := s.loadIndex()
	found := false
	for _, id := range ids {
		if id == d.ID {
			found = true
			break
		}
	}
	if !found {
		ids = append([]string{d.ID}, ids...)
	}
	indexData, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	s.cache.Set(indexKey, indexData, ttl)
	return nil
}

func (s *Store) Get(id string) (Delegation, bool) {
	data, ok := s.cache.Get(FormatDelegationKey(id))
	if !ok {
		return Delegation{}, false
	}
	var d Delegation
	if err := json.Unmarshal(data, &d); err != nil {
		return Delegation{}, false
	}
	if d.Status == StatusActive && isExpired(d.ExpiresAt) {
		d.Status = StatusExpired
		_ = s.Save(d)
	}
	return d, true
}

func (s *Store) List() []Delegation {
	ids := s.loadIndex()
	out := make([]Delegation, 0, len(ids))
	for _, id := range ids {
		if d, ok := s.Get(id); ok {
			out = append(out, d)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

func (s *Store) ListByUser(user string) []Delegation {
	user = strings.TrimSpace(user)
	out := []Delegation{}
	for _, d := range s.List() {
		if user == "" || d.UserPubkey == user {
			out = append(out, d)
		}
	}
	return out
}

func (s *Store) FindAllowed(user, agent string, r resource.Resource, totalPrice float64, durationMinutes int) (Delegation, bool) {
	for _, d := range s.ListByUser(user) {
		if Allows(d, agent, r, totalPrice, durationMinutes) {
			return d, true
		}
	}
	return Delegation{}, false
}

func Allows(d Delegation, agent string, r resource.Resource, totalPrice float64, durationMinutes int) bool {
	if d.Status != StatusActive || isExpired(d.ExpiresAt) {
		return false
	}
	if strings.TrimSpace(agent) != d.AgentID {
		return false
	}
	if durationMinutes <= 0 || durationMinutes > d.MaxDurationMinutes {
		return false
	}
	if totalPrice <= 0 || totalPrice > d.BudgetLimit {
		return false
	}
	if len(d.ResourceTypes) > 0 && !typeAllowed(d.ResourceTypes, r.Type) {
		return false
	}
	if len(d.AllowedRegions) > 0 && r.Spec.Region != "" && !stringAllowed(d.AllowedRegions, r.Spec.Region) {
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

func FormatDelegationKey(id string) string {
	return fmt.Sprintf("delegation:%s", id)
}

func uniqueTypes(values []resource.Type) []resource.Type {
	seen := map[resource.Type]bool{}
	out := []resource.Type{}
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
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

func typeAllowed(values []resource.Type, target resource.Type) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func stringAllowed(values []string, target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return true
	}
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), target) {
			return true
		}
	}
	return false
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
