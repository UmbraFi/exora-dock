package sellerdraft

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

const (
	policyKey          = "seller-drafts:policy"
	runIndexKey        = "seller-drafts:runs:index"
	candidateKeyPrefix = "seller-drafts:candidate:"
	runKeyPrefix       = "seller-drafts:run:"
	mutationKeyPrefix  = "seller-drafts:mutation:"
)

type Store struct {
	cache *cache.Cache
	mu    sync.RWMutex
}

func NewStore(c *cache.Cache) *Store { return &Store{cache: c} }

func (s *Store) SavePolicy(policy SellerAutomationPolicy) error {
	if s == nil || s.cache == nil {
		return fmt.Errorf("seller draft store unavailable")
	}
	raw, err := json.Marshal(policy)
	if err != nil {
		return err
	}
	s.cache.Set(policyKey, raw, RecordTTL)
	return nil
}

func (s *Store) Policy() (SellerAutomationPolicy, bool) {
	if s == nil || s.cache == nil {
		return SellerAutomationPolicy{}, false
	}
	raw, ok := s.cache.Get(policyKey)
	if !ok {
		return SellerAutomationPolicy{}, false
	}
	var policy SellerAutomationPolicy
	if json.Unmarshal(raw, &policy) != nil {
		return SellerAutomationPolicy{}, false
	}
	return policy, true
}

func (s *Store) SaveCandidate(candidate Candidate) error {
	if s == nil || s.cache == nil {
		return fmt.Errorf("seller draft store unavailable")
	}
	raw, err := json.Marshal(struct {
		Candidate Candidate `json:"candidate"`
		LocalPath string    `json:"localPath,omitempty"`
	}{Candidate: candidate, LocalPath: candidate.LocalPath})
	if err != nil {
		return err
	}
	s.cache.Set(candidateKeyPrefix+candidate.CandidateID, raw, CandidateTTL)
	return nil
}

func (s *Store) Candidate(id string) (Candidate, bool) {
	if s == nil || s.cache == nil {
		return Candidate{}, false
	}
	raw, ok := s.cache.Get(candidateKeyPrefix + strings.TrimSpace(id))
	if !ok {
		return Candidate{}, false
	}
	var record struct {
		Candidate Candidate `json:"candidate"`
		LocalPath string    `json:"localPath,omitempty"`
	}
	if json.Unmarshal(raw, &record) != nil {
		return Candidate{}, false
	}
	candidate := record.Candidate
	candidate.LocalPath = record.LocalPath
	expires, err := time.Parse(time.RFC3339Nano, candidate.ExpiresAt)
	if err != nil || time.Now().After(expires) {
		return Candidate{}, false
	}
	return candidate, true
}

func (s *Store) CreateRun(request CreateRequest, receipt PolicyReceipt) (Run, error) {
	if s == nil || s.cache == nil {
		return Run{}, fmt.Errorf("seller draft store unavailable")
	}
	now := time.Now().UTC()
	run := Run{
		SchemaVersion: SchemaVersion,
		RunID:         newID("sdrun"),
		Kind:          request.Kind,
		Status:        StatusQueued,
		StateVersion:  1,
		CurrentStep:   StatusQueued,
		NextAction:    "Dock will validate the selected seller resource.",
		Request:       request,
		PolicyReceipt: receipt,
		CreatedAt:     now.Format(time.RFC3339Nano),
		UpdatedAt:     now.Format(time.RFC3339Nano),
	}
	if err := s.saveRun(run); err != nil {
		return Run{}, err
	}
	return run, nil
}

func (s *Store) FindRunByIdempotency(kind, key string) (Run, bool) {
	key = strings.TrimSpace(key)
	if key == "" {
		return Run{}, false
	}
	for _, run := range s.ListRuns(500) {
		if run.Kind == kind && run.Request.IdempotencyKey == key {
			return run, true
		}
	}
	return Run{}, false
}

type mutationRecord struct {
	Fingerprint string `json:"fingerprint"`
	Run         Run    `json:"run"`
}

func (s *Store) ReplayMutation(scope, key, fingerprint string) (Run, bool, error) {
	if s == nil || s.cache == nil || strings.TrimSpace(key) == "" {
		return Run{}, false, nil
	}
	raw, ok := s.cache.Get(mutationKeyPrefix + strings.TrimSpace(scope) + ":" + strings.TrimSpace(key))
	if !ok {
		return Run{}, false, nil
	}
	var record mutationRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		return Run{}, false, err
	}
	if record.Fingerprint != fingerprint {
		return Run{}, false, fmt.Errorf("idempotencyKey reused with different input")
	}
	return record.Run, true, nil
}

func (s *Store) SaveMutation(scope, key, fingerprint string, run Run) error {
	if s == nil || s.cache == nil || strings.TrimSpace(key) == "" {
		return nil
	}
	raw, err := json.Marshal(mutationRecord{Fingerprint: fingerprint, Run: run})
	if err != nil {
		return err
	}
	s.cache.Set(mutationKeyPrefix+strings.TrimSpace(scope)+":"+strings.TrimSpace(key), raw, RecordTTL)
	return nil
}

func (s *Store) GetRun(id string) (Run, bool) {
	if s == nil || s.cache == nil {
		return Run{}, false
	}
	raw, ok := s.cache.Get(runKeyPrefix + strings.TrimSpace(id))
	if !ok {
		return Run{}, false
	}
	var run Run
	if json.Unmarshal(raw, &run) != nil {
		return Run{}, false
	}
	return run, true
}

func (s *Store) UpdateRun(id string, expectedVersion int64, update func(*Run) error) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, ok := s.GetRun(id)
	if !ok {
		return Run{}, fmt.Errorf("seller draft run not found")
	}
	if expectedVersion > 0 && run.StateVersion != expectedVersion {
		return Run{}, fmt.Errorf("seller draft state version conflict: expected %d, current %d", expectedVersion, run.StateVersion)
	}
	if err := update(&run); err != nil {
		return Run{}, err
	}
	run.StateVersion++
	run.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if run.Status == StatusCompleted || run.Status == StatusFailed || run.Status == StatusCancelled {
		run.CompletedAt = run.UpdatedAt
	}
	if err := s.saveRunUnlocked(run); err != nil {
		return Run{}, err
	}
	return run, nil
}

func (s *Store) ListRuns(limit int) []Run {
	if limit <= 0 {
		limit = 50
	} else if limit > 500 {
		limit = 500
	}
	ids := s.loadRunIndex()
	out := make([]Run, 0, min(limit, len(ids)))
	for _, id := range ids {
		if run, ok := s.GetRun(id); ok {
			out = append(out, run)
			if len(out) >= limit {
				break
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out
}

func (s *Store) saveRun(run Run) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveRunUnlocked(run)
}

func (s *Store) saveRunUnlocked(run Run) error {
	raw, err := json.Marshal(run)
	if err != nil {
		return err
	}
	s.cache.Set(runKeyPrefix+run.RunID, raw, RecordTTL)
	ids := s.loadRunIndex()
	next := []string{run.RunID}
	for _, id := range ids {
		if id != run.RunID {
			next = append(next, id)
		}
		if len(next) >= 500 {
			break
		}
	}
	indexRaw, _ := json.Marshal(next)
	s.cache.Set(runIndexKey, indexRaw, RecordTTL)
	return nil
}

func (s *Store) loadRunIndex() []string {
	raw, ok := s.cache.Get(runIndexKey)
	if !ok {
		return nil
	}
	var ids []string
	_ = json.Unmarshal(raw, &ids)
	return ids
}

func newID(prefix string) string {
	raw := make([]byte, 12)
	_, _ = rand.Read(raw)
	return prefix + "_" + hex.EncodeToString(raw)
}
