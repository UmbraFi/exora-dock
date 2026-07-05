package lease

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/delegation"
	"github.com/exora-dock/exora-dock/internal/resource"
)

const (
	indexKey = "leases:index"
	ttl      = 365 * 24 * time.Hour
)

type Status string

const (
	StatusPendingAuthorization Status = "pending_authorization"
	StatusAuthorized           Status = "authorized"
	StatusProvisioning         Status = "provisioning"
	StatusActive               Status = "active"
	StatusExpired              Status = "expired"
	StatusRevoked              Status = "revoked"
	StatusFailed               Status = "failed"
)

type CredentialRef struct {
	Endpoint  string `json:"endpoint,omitempty"`
	Token     string `json:"token,omitempty"`
	Status    string `json:"status"`
	ExpiresAt string `json:"expiresAt"`
}

type UsageMeter struct {
	Unit        resource.BillingUnit `json:"unit"`
	Purchased   float64              `json:"purchased"`
	Used        float64              `json:"used"`
	LastMeterAt string               `json:"lastMeterAt,omitempty"`
}

type Lease struct {
	ID              string        `json:"id"`
	ResourceID      string        `json:"resourceId"`
	ResourceName    string        `json:"resourceName"`
	ResourceType    resource.Type `json:"resourceType"`
	UserPubkey      string        `json:"userPubkey"`
	AgentID         string        `json:"agentId"`
	ProviderPubkey  string        `json:"providerPubkey"`
	DelegationID    string        `json:"delegationId,omitempty"`
	Quantity        int           `json:"quantity"`
	DurationMinutes int           `json:"durationMinutes"`
	TotalPrice      float64       `json:"totalPrice"`
	Status          Status        `json:"status"`
	CreatedAt       string        `json:"createdAt"`
	UpdatedAt       string        `json:"updatedAt"`
	ExpiresAt       string        `json:"expiresAt"`
	Credential      CredentialRef `json:"credential"`
	Usage           UsageMeter    `json:"usage"`
}

type CreateRequest struct {
	UserPubkey      string `json:"userPubkey"`
	AgentID         string `json:"agentId"`
	ResourceID      string `json:"resourceId"`
	DurationMinutes int    `json:"durationMinutes"`
	Quantity        int    `json:"quantity"`
	DelegationID    string `json:"delegationId"`
	Purpose         string `json:"purpose"`
}

type Store struct {
	cache *cache.Cache
}

func NewStore(c *cache.Cache) *Store {
	return &Store{cache: c}
}

func (s *Store) Create(req CreateRequest, resources *resource.Store, delegations *delegation.Store) (Lease, error) {
	user := strings.TrimSpace(req.UserPubkey)
	agent := strings.TrimSpace(req.AgentID)
	resourceID := strings.TrimSpace(req.ResourceID)
	if user == "" {
		return Lease{}, fmt.Errorf("user_pubkey required")
	}
	if agent == "" {
		return Lease{}, fmt.Errorf("agent_id required")
	}
	if resourceID == "" {
		return Lease{}, fmt.Errorf("resource_id required")
	}
	if resources == nil {
		return Lease{}, fmt.Errorf("resource store not configured")
	}
	r, ok := resources.Get(resourceID)
	if !ok {
		return Lease{}, fmt.Errorf("resource not found: %s", resourceID)
	}
	duration := req.DurationMinutes
	if duration <= 0 {
		duration = r.MinDurationMinutes
	}
	if duration < r.MinDurationMinutes || duration > r.MaxDurationMinutes {
		return Lease{}, fmt.Errorf("duration outside resource bounds")
	}
	quantity := req.Quantity
	if quantity <= 0 {
		quantity = 1
	}
	total := round2(r.PricePerUnit * float64(quantity) * resource.UnitsForDuration(duration, r.BillingUnit))

	var d delegation.Delegation
	authorized := false
	if delegations != nil && strings.TrimSpace(req.DelegationID) != "" {
		if found, ok := delegations.Get(strings.TrimSpace(req.DelegationID)); ok && found.UserPubkey == user {
			d = found
			authorized = delegation.Allows(found, agent, r, total, duration)
		}
	}
	if !authorized && delegations != nil {
		if found, ok := delegations.FindAllowed(user, agent, r, total, duration); ok {
			d = found
			authorized = true
		}
	}

	now := time.Now().UTC()
	status := StatusPendingAuthorization
	expires := now
	credential := CredentialRef{Status: "pending_authorization"}
	if authorized {
		status = StatusActive
		expires = now.Add(time.Duration(duration) * time.Minute)
		credential = buildCredential(r, now, expires, user+agent+resourceID)
	}

	l := Lease{
		ID:              fmt.Sprintf("lease-%d-%s", now.UnixNano(), shortHash(user+agent+resourceID)),
		ResourceID:      r.ID,
		ResourceName:    r.Name,
		ResourceType:    r.Type,
		UserPubkey:      user,
		AgentID:         agent,
		ProviderPubkey:  r.ProviderPubkey,
		DelegationID:    d.ID,
		Quantity:        quantity,
		DurationMinutes: duration,
		TotalPrice:      total,
		Status:          status,
		CreatedAt:       now.Format(time.RFC3339),
		UpdatedAt:       now.Format(time.RFC3339),
		ExpiresAt:       expires.Format(time.RFC3339),
		Credential:      credential,
		Usage: UsageMeter{
			Unit:      r.BillingUnit,
			Purchased: resource.UnitsForDuration(duration, r.BillingUnit) * float64(quantity),
			Used:      0,
		},
	}
	return l, s.Save(l)
}

func (s *Store) Save(l Lease) error {
	data, err := json.Marshal(l)
	if err != nil {
		return err
	}
	s.cache.Set(FormatLeaseKey(l.ID), data, ttl)

	ids := s.loadIndex()
	found := false
	for _, id := range ids {
		if id == l.ID {
			found = true
			break
		}
	}
	if !found {
		ids = append([]string{l.ID}, ids...)
	}
	indexData, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	s.cache.Set(indexKey, indexData, ttl)
	return nil
}

func (s *Store) Get(id string) (Lease, bool) {
	data, ok := s.cache.Get(FormatLeaseKey(id))
	if !ok {
		return Lease{}, false
	}
	var l Lease
	if err := json.Unmarshal(data, &l); err != nil {
		return Lease{}, false
	}
	if l.Status == StatusActive && isExpired(l.ExpiresAt) {
		l.Status = StatusExpired
		l.Credential.Status = "expired"
		_ = s.Save(l)
	}
	return l, true
}

func (s *Store) List() []Lease {
	ids := s.loadIndex()
	out := make([]Lease, 0, len(ids))
	for _, id := range ids {
		if l, ok := s.Get(id); ok {
			out = append(out, l)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

func (s *Store) ListByParty(party string, role string) []Lease {
	party = strings.TrimSpace(party)
	role = strings.TrimSpace(role)
	out := []Lease{}
	for _, l := range s.List() {
		if party == "" {
			out = append(out, l)
			continue
		}
		switch role {
		case "user":
			if l.UserPubkey == party {
				out = append(out, l)
			}
		case "provider":
			if l.ProviderPubkey == party {
				out = append(out, l)
			}
		case "agent":
			if l.AgentID == party {
				out = append(out, l)
			}
		}
	}
	return out
}

func (s *Store) Revoke(id string) (Lease, error) {
	l, ok := s.Get(id)
	if !ok {
		return Lease{}, fmt.Errorf("lease not found")
	}
	if l.Status == StatusExpired || l.Status == StatusRevoked {
		return l, nil
	}
	l.Status = StatusRevoked
	l.Credential.Status = "revoked"
	l.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return l, s.Save(l)
}

func (s *Store) Credentials(id string) (CredentialRef, error) {
	l, ok := s.Get(id)
	if !ok {
		return CredentialRef{}, fmt.Errorf("lease not found")
	}
	if l.Status != StatusActive {
		return CredentialRef{}, fmt.Errorf("lease is not active")
	}
	if isExpired(l.ExpiresAt) {
		return CredentialRef{}, fmt.Errorf("lease expired")
	}
	return l.Credential, nil
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

func FormatLeaseKey(id string) string {
	return fmt.Sprintf("lease:%s", id)
}

func buildCredential(r resource.Resource, issuedAt, expiresAt time.Time, seed string) CredentialRef {
	endpoint := strings.TrimSpace(r.Spec.Endpoint)
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://dock.exora.local/resources/%s", r.ID)
	}
	return CredentialRef{
		Endpoint:  endpoint,
		Token:     "exora_" + shortHash(seed+issuedAt.Format(time.RFC3339Nano)),
		Status:    "active",
		ExpiresAt: expiresAt.Format(time.RFC3339),
	}
}

func isExpired(value string) bool {
	t, err := time.Parse(time.RFC3339, value)
	return err == nil && !t.After(time.Now().UTC())
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func shortHash(value string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return fmt.Sprintf("%08x", h.Sum32())
}
