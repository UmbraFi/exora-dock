package supervisor

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

var (
	ErrNotFound            = errors.New("automation run not found")
	ErrVersionConflict     = errors.New("automation run version conflict")
	ErrLeaseHeld           = errors.New("automation run lease is held by another worker")
	ErrStaleLease          = errors.New("automation run lease epoch is stale")
	ErrInvalidAction       = errors.New("unsupported automation action")
	ErrIdempotencyConflict = errors.New("automation idempotency key was reused for a different action")
	ErrRunNotActive        = errors.New("automation run is not active")
	ErrTerminalRun         = errors.New("automation run is terminal")
)

const (
	indexKey         = "automation-runs:v2:index"
	sessionKeyPrefix = "automation-session:v2:"
	runTTL           = 365 * 24 * time.Hour
)

type Store struct {
	mu                sync.RWMutex
	cache             *cache.Cache
	runs              map[string]AutomationRun
	index             []string
	createIdempotency map[string]string
	vendorSessions    map[string]string
	now               func() time.Time
}

func NewStore(c *cache.Cache) *Store {
	return &Store{
		cache: c, runs: map[string]AutomationRun{},
		createIdempotency: map[string]string{}, vendorSessions: map[string]string{}, now: time.Now,
	}
}

func (s *Store) Create(req CreateRequest) (AutomationRun, bool, error) {
	if s == nil {
		return AutomationRun{}, false, fmt.Errorf("automation run store unavailable")
	}
	req.TransactionID = strings.TrimSpace(req.TransactionID)
	req.RunID = strings.TrimSpace(req.RunID)
	req.Role = normalizeRole(req.Role)
	req.Driver = strings.ToLower(strings.TrimSpace(req.Driver))
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.TransactionID == "" || req.Role == "" || req.IdempotencyKey == "" {
		return AutomationRun{}, false, fmt.Errorf("transactionId, role and idempotencyKey are required")
	}
	if req.RunID != "" && !validRunID(req.RunID) {
		return AutomationRun{}, false, fmt.Errorf("invalid Cloud runId")
	}
	if req.Driver == "" {
		req.Driver = DriverCodex
	}
	if req.Driver != DriverCodex {
		return AutomationRun{}, false, fmt.Errorf("unsupported local agent driver %q", req.Driver)
	}
	createKey := req.TransactionID + "\x00" + req.Role + "\x00" + req.IdempotencyKey
	s.mu.Lock()
	if id := s.createIdempotency[createKey]; id != "" {
		if req.RunID != "" && req.RunID != id {
			s.mu.Unlock()
			return AutomationRun{}, false, fmt.Errorf("Cloud runId conflicts with idempotent AutomationRun")
		}
		run := s.runs[id]
		s.mu.Unlock()
		return cloneRun(run), true, nil
	}
	if req.RunID != "" {
		if existing, ok := s.loadLocked(req.RunID); ok {
			if existing.TransactionID == req.TransactionID && existing.Role == req.Role {
				for _, event := range existing.Events {
					if event.Type == "run.created" && event.IdempotencyKey == req.IdempotencyKey {
						s.createIdempotency[createKey] = existing.RunID
						s.mu.Unlock()
						return cloneRun(existing), true, nil
					}
				}
			}
			s.mu.Unlock()
			return AutomationRun{}, false, fmt.Errorf("Cloud runId %q already exists for transaction %s role %s", req.RunID, existing.TransactionID, existing.Role)
		}
	}
	for _, id := range s.loadIndexLocked() {
		candidate, ok := s.loadLocked(id)
		if !ok || candidate.TransactionID != req.TransactionID || candidate.Role != req.Role {
			continue
		}
		for _, event := range candidate.Events {
			if event.IdempotencyKey == req.IdempotencyKey && event.Type == "run.created" {
				if req.RunID != "" && req.RunID != candidate.RunID {
					s.mu.Unlock()
					return AutomationRun{}, false, fmt.Errorf("Cloud runId conflicts with persisted idempotent AutomationRun")
				}
				s.createIdempotency[createKey] = candidate.RunID
				s.mu.Unlock()
				return cloneRun(candidate), true, nil
			}
		}
	}
	now := s.now().UTC()
	runID := req.RunID
	if runID == "" {
		runID = newID("run")
	}
	run := AutomationRun{
		RunID: runID, TransactionID: req.TransactionID, Role: req.Role,
		Driver: req.Driver, Status: RunQueued, TriggerEventID: strings.TrimSpace(req.TriggerEventID),
		ExpectedStateVersion: req.ExpectedStateVersion, Version: 1,
		PermissionProfile: strings.TrimSpace(req.PermissionProfile), Workspace: cleanWorkspace(req.Workspace),
		AutomationMode:    normalizeAutomationMode(req.AutomationMode, true),
		AllowedActions:    normalizeActionSnapshot(req.AllowedActions),
		AllowedActionsSet: req.AllowedActionsSet,
		CreatedAt:         now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano),
		Idempotency: map[string]int{},
	}
	run.VendorThreadID = s.loadVendorSessionLocked(req.TransactionID, req.Role)
	run = appendEvent(run, RunEvent{Type: "run.created", Actor: "dock", Role: run.Role, IdempotencyKey: req.IdempotencyKey, Payload: map[string]any{"triggerEventId": run.TriggerEventID}}, now)
	s.runs[run.RunID] = run
	s.index = append([]string{run.RunID}, s.index...)
	s.createIdempotency[createKey] = run.RunID
	s.mu.Unlock()
	if err := s.persist(run); err != nil {
		return AutomationRun{}, false, err
	}
	return cloneRun(run), false, nil
}

func (s *Store) Claim(req ClaimRequest) (AutomationRun, error) {
	if s == nil {
		return AutomationRun{}, ErrNotFound
	}
	req.WorkerID = strings.TrimSpace(req.WorkerID)
	if req.WorkerID == "" {
		return AutomationRun{}, fmt.Errorf("workerId required")
	}
	ttl := req.LeaseTTL
	if ttl <= 0 && req.LeaseSeconds > 0 {
		ttl = time.Duration(req.LeaseSeconds) * time.Second
	}
	if ttl <= 0 || ttl > 10*time.Minute {
		ttl = 45 * time.Second
	}
	s.mu.Lock()
	id := strings.TrimSpace(req.RunID)
	if id == "" {
		id = s.findClaimableLocked(req.TransactionID, req.Role)
	}
	run, ok := s.loadLocked(id)
	if !ok {
		s.mu.Unlock()
		return AutomationRun{}, ErrNotFound
	}
	if run.Status == RunCompleted || run.Status == RunFailed || run.Status == RunCancelled {
		s.mu.Unlock()
		return AutomationRun{}, ErrTerminalRun
	}
	now := s.now().UTC()
	if !run.Lease.Expired(now) && run.Lease.WorkerID != req.WorkerID {
		s.mu.Unlock()
		return AutomationRun{}, ErrLeaseHeld
	}
	if run.Lease.WorkerID != req.WorkerID || run.Lease.Expired(now) {
		run.Lease.Epoch++
	}
	run.Lease.WorkerID = req.WorkerID
	run.Lease.Until = now.Add(ttl).Format(time.RFC3339Nano)
	run.Status = RunRunning
	run.Version++
	run.UpdatedAt = now.Format(time.RFC3339Nano)
	run = appendEvent(run, RunEvent{Type: "run.claimed", Actor: req.WorkerID, Role: run.Role, Payload: map[string]any{"leaseEpoch": run.Lease.Epoch}}, now)
	s.runs[id] = run
	s.mu.Unlock()
	return cloneRun(run), s.persist(run)
}

func (s *Store) Renew(runID, workerID string, epoch int64, ttl time.Duration) (AutomationRun, error) {
	if ttl <= 0 || ttl > 10*time.Minute {
		ttl = 45 * time.Second
	}
	s.mu.Lock()
	run, ok := s.loadLocked(strings.TrimSpace(runID))
	if !ok {
		s.mu.Unlock()
		return AutomationRun{}, ErrNotFound
	}
	if run.Lease.WorkerID != strings.TrimSpace(workerID) || run.Lease.Epoch != epoch {
		s.mu.Unlock()
		return AutomationRun{}, ErrStaleLease
	}
	now := s.now().UTC()
	if run.Lease.Expired(now) {
		s.mu.Unlock()
		return AutomationRun{}, ErrStaleLease
	}
	run.Lease.Until = now.Add(ttl).Format(time.RFC3339Nano)
	run.UpdatedAt = now.Format(time.RFC3339Nano)
	s.runs[run.RunID] = run
	s.mu.Unlock()
	return cloneRun(run), s.persist(run)
}

func (s *Store) RecordAction(runID string, req ActionRequest) (AutomationRun, bool, error) {
	req.Type = strings.ToLower(strings.TrimSpace(req.Type))
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if !isAgentAction(req.Type) || req.IdempotencyKey == "" || req.ExpectedStateVersion < 0 {
		return AutomationRun{}, false, ErrInvalidAction
	}
	s.mu.Lock()
	run, ok := s.loadLocked(strings.TrimSpace(runID))
	if !ok {
		s.mu.Unlock()
		return AutomationRun{}, false, ErrNotFound
	}
	if seq, exists := run.Idempotency[req.IdempotencyKey]; exists {
		if seq <= 0 || seq > len(run.Events) {
			s.mu.Unlock()
			return AutomationRun{}, false, ErrVersionConflict
		}
		original := run.Events[seq-1]
		if original.Type != req.Type || !samePayload(original.Payload, req.Payload) {
			s.mu.Unlock()
			return AutomationRun{}, false, ErrIdempotencyConflict
		}
		// A Cloud replay keeps the original expected version even after this
		// run has observed the mutation's newer transaction projection.
		if original.ExpectedStateVersion != req.ExpectedStateVersion {
			s.mu.Unlock()
			return AutomationRun{}, false, ErrVersionConflict
		}
		s.mu.Unlock()
		return cloneRun(run), true, nil
	}
	if req.ExpectedRunVersion > 0 && req.ExpectedRunVersion != run.Version {
		s.mu.Unlock()
		return AutomationRun{}, false, ErrVersionConflict
	}
	if req.ExpectedStateVersion != run.ExpectedStateVersion {
		s.mu.Unlock()
		return AutomationRun{}, false, ErrVersionConflict
	}
	if run.Status == RunCompleted || run.Status == RunFailed || run.Status == RunCancelled {
		s.mu.Unlock()
		return AutomationRun{}, false, ErrTerminalRun
	}
	if run.Status != RunRunning {
		s.mu.Unlock()
		return AutomationRun{}, false, ErrRunNotActive
	}
	now := s.now().UTC()
	run.Version++
	run.LastAction = req.Type
	run.UpdatedAt = now.Format(time.RFC3339Nano)
	switch req.Type {
	case "request_user_input", "request_approval":
		run.Status = RunWaitingUser
	case "report_blocked":
		run.Status = RunBlocked
	case "propose_transition", "submit_offer", "submit_deliverable", "finish_run":
		run.Status = RunWaitingAgent
	default:
		run.Status = RunRunning
	}
	run = appendEvent(run, RunEvent{Type: req.Type, Actor: strings.TrimSpace(req.Actor), Role: normalizeRole(first(req.Role, run.Role)), IdempotencyKey: req.IdempotencyKey, ExpectedStateVersion: req.ExpectedStateVersion, Payload: cloneMap(req.Payload)}, now)
	run.Idempotency[req.IdempotencyKey] = len(run.Events)
	s.runs[run.RunID] = run
	s.mu.Unlock()
	return cloneRun(run), false, s.persist(run)
}

// AdvanceExpectedStateVersion records the authoritative transaction version
// returned by Exora Cloud after a successful agent mutation. Replaying an
// already-observed mutation is a no-op, including after later mutations have
// advanced the run further.
func (s *Store) AdvanceExpectedStateVersion(runID string, fromVersion, nextVersion int64) (AutomationRun, error) {
	if fromVersion < 0 || nextVersion < fromVersion {
		return AutomationRun{}, ErrVersionConflict
	}
	s.mu.Lock()
	run, ok := s.loadLocked(strings.TrimSpace(runID))
	if !ok {
		s.mu.Unlock()
		return AutomationRun{}, ErrNotFound
	}
	if run.ExpectedStateVersion >= nextVersion {
		s.mu.Unlock()
		return cloneRun(run), nil
	}
	if run.ExpectedStateVersion != fromVersion {
		s.mu.Unlock()
		return AutomationRun{}, ErrVersionConflict
	}
	now := s.now().UTC()
	run.ExpectedStateVersion = nextVersion
	run.Version++
	run.UpdatedAt = now.Format(time.RFC3339Nano)
	run = appendEvent(run, RunEvent{
		Type: "transaction.version_advanced", Actor: "cloud", Role: run.Role,
		Payload: map[string]any{"fromVersion": fromVersion, "nextVersion": nextVersion},
	}, now)
	s.runs[run.RunID] = run
	s.mu.Unlock()
	return cloneRun(run), s.persist(run)
}

func (s *Store) SetVendorSession(runID, threadID, turnID string) (AutomationRun, error) {
	s.mu.Lock()
	run, ok := s.loadLocked(strings.TrimSpace(runID))
	if !ok {
		s.mu.Unlock()
		return AutomationRun{}, ErrNotFound
	}
	if run.Status == RunCompleted || run.Status == RunFailed || run.Status == RunCancelled {
		s.mu.Unlock()
		return AutomationRun{}, ErrTerminalRun
	}
	if strings.TrimSpace(threadID) == "" {
		s.mu.Unlock()
		return AutomationRun{}, fmt.Errorf("vendor thread id required")
	}
	now := s.now().UTC()
	run.VendorThreadID = strings.TrimSpace(threadID)
	run.VendorTurnID = strings.TrimSpace(turnID)
	run.Version++
	run.UpdatedAt = now.Format(time.RFC3339Nano)
	run = appendEvent(run, RunEvent{Type: "driver.session", Actor: "dock", Role: run.Role, Payload: map[string]any{"threadId": run.VendorThreadID, "turnId": run.VendorTurnID}}, now)
	s.runs[run.RunID] = run
	s.vendorSessions[transactionRoleKey(run.TransactionID, run.Role)] = run.VendorThreadID
	s.mu.Unlock()
	if err := s.persist(run); err != nil {
		return AutomationRun{}, err
	}
	if s.cache != nil {
		s.cache.Set(sessionKeyPrefix+transactionRoleKey(run.TransactionID, run.Role), []byte(run.VendorThreadID), runTTL)
	}
	return cloneRun(run), nil
}

func (s *Store) Finish(runID, workerID string, epoch int64, status, errText string) (AutomationRun, error) {
	status = strings.ToLower(strings.TrimSpace(status))
	if status != RunCompleted && status != RunFailed && status != RunCancelled && status != RunWaitingAgent {
		return AutomationRun{}, fmt.Errorf("invalid terminal status %q", status)
	}
	s.mu.Lock()
	run, ok := s.loadLocked(strings.TrimSpace(runID))
	if !ok {
		s.mu.Unlock()
		return AutomationRun{}, ErrNotFound
	}
	if run.Status == RunCompleted || run.Status == RunFailed || run.Status == RunCancelled {
		if run.Status == status {
			s.mu.Unlock()
			return cloneRun(run), nil
		}
		s.mu.Unlock()
		return AutomationRun{}, ErrTerminalRun
	}
	if workerID != "" && (run.Lease.WorkerID != workerID || run.Lease.Epoch != epoch) {
		s.mu.Unlock()
		return AutomationRun{}, ErrStaleLease
	}
	now := s.now().UTC()
	run.Status = status
	run.LastError = strings.TrimSpace(errText)
	run.Lease = Lease{Epoch: run.Lease.Epoch}
	run.Version++
	run.UpdatedAt = now.Format(time.RFC3339Nano)
	if status == RunCompleted || status == RunFailed || status == RunCancelled {
		run.CompletedAt = now.Format(time.RFC3339Nano)
	}
	run = appendEvent(run, RunEvent{Type: "run." + status, Actor: first(workerID, "dock"), Role: run.Role, Payload: map[string]any{"error": run.LastError}}, now)
	s.runs[run.RunID] = run
	s.mu.Unlock()
	return cloneRun(run), s.persist(run)
}

func (s *Store) Get(id string) (AutomationRun, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, ok := s.loadLocked(strings.TrimSpace(id))
	return cloneRun(run), ok
}

func (s *Store) List(transactionID string) []AutomationRun {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids := s.loadIndexLocked()
	out := make([]AutomationRun, 0, len(ids))
	for _, id := range ids {
		if run, ok := s.loadLocked(id); ok && (strings.TrimSpace(transactionID) == "" || run.TransactionID == strings.TrimSpace(transactionID)) {
			out = append(out, cloneRun(run))
		}
	}
	return out
}

func (s *Store) loadLocked(id string) (AutomationRun, bool) {
	if id == "" {
		return AutomationRun{}, false
	}
	if run, ok := s.runs[id]; ok {
		if run.Idempotency == nil {
			run.Idempotency = rebuildIdempotency(run.Events)
		}
		return run, true
	}
	if s.cache == nil {
		return AutomationRun{}, false
	}
	data, ok := s.cache.Get(runKey(id))
	if !ok {
		return AutomationRun{}, false
	}
	var run AutomationRun
	if json.Unmarshal(data, &run) != nil {
		return AutomationRun{}, false
	}
	run.Idempotency = rebuildIdempotency(run.Events)
	s.runs[id] = run
	return run, true
}

func (s *Store) loadIndexLocked() []string {
	if len(s.index) > 0 || s.cache == nil {
		return append([]string(nil), s.index...)
	}
	data, ok := s.cache.Get(indexKey)
	if ok {
		_ = json.Unmarshal(data, &s.index)
	}
	return append([]string(nil), s.index...)
}

func (s *Store) loadVendorSessionLocked(transactionID, role string) string {
	key := transactionRoleKey(transactionID, role)
	if threadID := s.vendorSessions[key]; threadID != "" {
		return threadID
	}
	if s.cache == nil {
		return ""
	}
	if data, ok := s.cache.Get(sessionKeyPrefix + key); ok {
		threadID := strings.TrimSpace(string(data))
		s.vendorSessions[key] = threadID
		return threadID
	}
	return ""
}

func (s *Store) findClaimableLocked(transactionID, role string) string {
	transactionID = strings.TrimSpace(transactionID)
	role = normalizeRole(role)
	for _, id := range s.loadIndexLocked() {
		run, ok := s.loadLocked(id)
		if !ok || (transactionID != "" && run.TransactionID != transactionID) || (role != "" && run.Role != role) {
			continue
		}
		if run.Status == RunQueued || run.Status == RunWaitingAgent || run.Status == RunWaitingUser || run.Lease.Expired(s.now().UTC()) {
			return id
		}
	}
	return ""
}

func (s *Store) persist(run AutomationRun) error {
	if s.cache == nil {
		return nil
	}
	copyRun := cloneRun(run)
	copyRun.Idempotency = nil
	data, err := json.Marshal(copyRun)
	if err != nil {
		return err
	}
	s.cache.Set(runKey(run.RunID), data, runTTL)
	s.mu.RLock()
	index := append([]string(nil), s.index...)
	s.mu.RUnlock()
	indexData, _ := json.Marshal(index)
	s.cache.Set(indexKey, indexData, runTTL)
	return nil
}

func appendEvent(run AutomationRun, event RunEvent, now time.Time) AutomationRun {
	event.Seq = int64(len(run.Events) + 1)
	if len(run.Events) > 0 {
		event.PrevHash = run.Events[len(run.Events)-1].EventHash
	}
	event.CreatedAt = now.UTC().Format(time.RFC3339Nano)
	canonical, _ := json.Marshal(struct {
		Seq                                                    int64 `json:"seq"`
		Type, Actor, Role, IdempotencyKey, PrevHash, CreatedAt string
		ExpectedStateVersion                                   int64          `json:"expectedStateVersion,omitempty"`
		Payload                                                map[string]any `json:"payload,omitempty"`
	}{event.Seq, event.Type, event.Actor, event.Role, event.IdempotencyKey, event.PrevHash, event.CreatedAt, event.ExpectedStateVersion, event.Payload})
	sum := sha256.Sum256(canonical)
	event.EventHash = hex.EncodeToString(sum[:])
	run.Events = append(run.Events, event)
	return run
}

func isAgentAction(action string) bool {
	for _, allowed := range AgentActions {
		if action == allowed && action != "claim_run" && action != "get_transaction_state" && action != "get_allowed_actions" && action != "search_agent_cards" {
			return true
		}
	}
	return false
}

func rebuildIdempotency(events []RunEvent) map[string]int {
	out := map[string]int{}
	for i, event := range events {
		if event.IdempotencyKey != "" {
			out[event.IdempotencyKey] = i + 1
		}
	}
	return out
}

func cloneRun(run AutomationRun) AutomationRun {
	data, _ := json.Marshal(run)
	var out AutomationRun
	_ = json.Unmarshal(data, &out)
	out.Idempotency = rebuildIdempotency(out.Events)
	return out
}

func cloneMap(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	data, _ := json.Marshal(value)
	var out map[string]any
	_ = json.Unmarshal(data, &out)
	return out
}

func samePayload(left, right map[string]any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftJSON, rightJSON)
}

func runKey(id string) string { return "automation-run:v2:" + strings.TrimSpace(id) }
func transactionRoleKey(transactionID, role string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(transactionID) + "\x00" + normalizeRole(role)))
	return hex.EncodeToString(sum[:])
}
func normalizeRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "buyer", "seller", "verifier":
		return strings.ToLower(strings.TrimSpace(role))
	default:
		return ""
	}
}
func first(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
func cleanWorkspace(path string) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	out, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return ""
	}
	return out
}
func newID(prefix string) string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err == nil {
		return prefix + "-" + hex.EncodeToString(b)
	}
	return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
}

func validRunID(value string) bool {
	if value == "" || len(value) > 160 {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			continue
		}
		switch char {
		case '-', '_', '.', ':':
			continue
		default:
			return false
		}
	}
	return true
}

func normalizeActionSnapshot(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	requested := map[string]bool{}
	for _, value := range values {
		requested[strings.ToLower(strings.TrimSpace(value))] = true
	}
	out := make([]string, 0, len(values))
	for _, action := range AgentActions[4:] {
		if requested[action] {
			out = append(out, action)
		}
	}
	return out
}
