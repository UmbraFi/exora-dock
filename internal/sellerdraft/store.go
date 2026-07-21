package sellerdraft

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/accountscope"
	"github.com/exora-dock/exora-dock/internal/cache"
)

const policyKey = "seller-api:policy"
const candidateKeyPrefix = "seller-api:candidate:"
const apiDraftKeyPrefix = "provider-api:draft:"
const apiDraftIndexKey = "provider-api:draft-index"

type Store struct {
	cache     *cache.Cache
	accountID string
	namespace string
}

func NewStore(value *cache.Cache, accountID string) *Store {
	accountID = strings.TrimSpace(accountID)
	return &Store{cache: value, accountID: accountID, namespace: accountscope.Namespace(accountID)}
}
func (s *Store) AccountID() string { return s.accountID }
func (s *Store) key(value string) string {
	if s.namespace == "" {
		return "inactive:" + value
	}
	return "account:" + s.namespace + ":" + value
}
func (s *Store) SavePolicy(value SellerAutomationPolicy) error {
	if s == nil || s.cache == nil {
		return errors.New("seller store unavailable")
	}
	raw, err := json.Marshal(value)
	if err == nil {
		s.cache.Set(s.key(policyKey), raw, RecordTTL)
	}
	return err
}
func (s *Store) Policy() (SellerAutomationPolicy, bool) {
	if s == nil || s.cache == nil {
		return SellerAutomationPolicy{}, false
	}
	raw, ok := s.cache.Get(s.key(policyKey))
	var value SellerAutomationPolicy
	if !ok || json.Unmarshal(raw, &value) != nil {
		return SellerAutomationPolicy{}, false
	}
	return value, true
}
func (s *Store) SaveCandidate(value Candidate) error {
	raw, err := json.Marshal(struct {
		Candidate Candidate `json:"candidate"`
		LocalPath string    `json:"localPath"`
	}{value, value.LocalPath})
	if err == nil {
		s.cache.Set(s.key(candidateKeyPrefix+value.CandidateID), raw, CandidateTTL)
	}
	return err
}
func (s *Store) Candidate(id string) (Candidate, bool) {
	raw, ok := s.cache.Get(s.key(candidateKeyPrefix + strings.TrimSpace(id)))
	var record struct {
		Candidate Candidate `json:"candidate"`
		LocalPath string    `json:"localPath"`
	}
	if !ok || json.Unmarshal(raw, &record) != nil {
		return Candidate{}, false
	}
	expires, err := time.Parse(time.RFC3339Nano, record.Candidate.ExpiresAt)
	if err != nil || time.Now().After(expires) {
		return Candidate{}, false
	}
	record.Candidate.LocalPath = record.LocalPath
	return record.Candidate, true
}

func (s *Store) SaveAPIDraft(value APIDraft) error {
	if s == nil || s.cache == nil {
		return errors.New("provider API draft store unavailable")
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	s.cache.Set(s.key(apiDraftKeyPrefix+value.APIID), raw, RecordTTL)
	ids := s.apiDraftIDs()
	for _, id := range ids {
		if id == value.APIID {
			return nil
		}
	}
	ids = append(ids, value.APIID)
	index, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	s.cache.Set(s.key(apiDraftIndexKey), index, RecordTTL)
	return nil
}

func (s *Store) APIDraft(id string) (APIDraft, bool) {
	if s == nil || s.cache == nil {
		return APIDraft{}, false
	}
	raw, ok := s.cache.Get(s.key(apiDraftKeyPrefix + strings.TrimSpace(id)))
	var value APIDraft
	if !ok || json.Unmarshal(raw, &value) != nil {
		return APIDraft{}, false
	}
	return value, true
}

func (s *Store) APIDrafts() []APIDraft {
	out := []APIDraft{}
	for _, id := range s.apiDraftIDs() {
		if value, ok := s.APIDraft(id); ok {
			out = append(out, value)
		}
	}
	return out
}

// PurgeLegacyAPIDrafts intentionally performs no pricing migration. Legacy API
// contracts are removed; otherwise incompatible pricing and billing evidence is
// cleared while the validated integration draft and stable API UID are retained.
func (s *Store) PurgeLegacyAPIDrafts() error {
	for _, draft := range s.APIDrafts() {
		legacy := capabilityString(draft.Capability["schemaVersion"]) != APISchemaVersion
		for _, raw := range sliceValue(draft.Capability["operations"]) {
			if capabilityString(mapValue(raw)["schemaVersion"]) != OperationSchemaVersion {
				legacy = true
				break
			}
		}
		if legacy {
			if err := s.DeleteAPIDraft(draft.APIID); err != nil {
				return err
			}
			continue
		}
		changed := false
		for operationID, review := range draft.Operations {
			pricingVersion := capabilityString(review.Pricing["schemaVersion"])
			draftVersion := capabilityString(review.PricingDraft["schemaVersion"])
			planVersion := capabilityString(review.BillingPlan["schemaVersion"])
			receiptVersion := capabilityString(review.PricingBillingReceipt["schemaVersion"])
			if pricingVersion != "" && pricingVersion != "exora.operation-pricing.v4" ||
				draftVersion != "" && draftVersion != "exora.operation-pricing.v4" ||
				planVersion != "" && planVersion != billingPlanVersion ||
				receiptVersion != "" && receiptVersion != billingReceiptVersion {
				review.PricingDraft, review.Pricing, review.BillingPlan, review.BillingRun, review.PricingBillingReceipt = nil, nil, nil, nil, nil
				review.PricingLockedAt = nil
				review.PricingReview = "empty"
				if review.IntegrationStatus == "locked" {
					review.PricingStatus = "editable"
				} else {
					review.PricingStatus = "blocked"
				}
				review.OperationalState = "offline"
				draft.Operations[operationID] = review
				changed = true
			}
		}
		if changed {
			refreshAPIDraftLifecycleStatus(&draft)
			draft.Version++
			draft.UpdatedAt = time.Now().UTC()
			if err := s.SaveAPIDraft(draft); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) DeleteAPIDraft(id string) error {
	if s == nil || s.cache == nil {
		return errors.New("provider API draft store unavailable")
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("apiId is required")
	}
	s.cache.Delete(s.key(apiDraftKeyPrefix + id))
	ids := s.apiDraftIDs()
	kept := ids[:0]
	for _, candidate := range ids {
		if candidate != id {
			kept = append(kept, candidate)
		}
	}
	index, err := json.Marshal(kept)
	if err != nil {
		return err
	}
	s.cache.Set(s.key(apiDraftIndexKey), index, RecordTTL)
	return nil
}

func (s *Store) apiDraftIDs() []string {
	if s == nil || s.cache == nil {
		return nil
	}
	raw, ok := s.cache.Get(s.key(apiDraftIndexKey))
	var ids []string
	if !ok || json.Unmarshal(raw, &ids) != nil {
		return nil
	}
	return ids
}
func newID(prefix string) string {
	raw := make([]byte, 12)
	_, _ = rand.Read(raw)
	return prefix + "_" + hex.EncodeToString(raw)
}
