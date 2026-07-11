package supervisor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/agentdriver"
	"github.com/exora-dock/exora-dock/internal/runcapability"
)

type WakeRequest struct {
	JobID                string
	RunID                string
	TransactionID        string
	Role                 string
	TriggerEventID       string
	ExpectedStateVersion int64
	PermissionProfile    string
	Workspace            string
	Prompt               string
	AllowedActions       []string
	AllowedActionsSet    bool
}

type DriverFactory func(run AutomationRun, capabilityToken string) agentdriver.Driver

type RunLifecycleEvent struct {
	Type           string
	IdempotencyKey string
	Outcome        string
	NextAction     string
	TargetRole     string
	RetryAt        string
	Reason         string
	VendorThreadID string
	VendorTurnID   string
}

type RunLifecycleReporter interface {
	ReportRun(context.Context, AutomationRun, RunLifecycleEvent) error
}

type RunLifecycleReporterFunc func(context.Context, AutomationRun, RunLifecycleEvent) error

func (f RunLifecycleReporterFunc) ReportRun(ctx context.Context, run AutomationRun, event RunLifecycleEvent) error {
	return f(ctx, run, event)
}

type Service struct {
	store        *Store
	capabilities *runcapability.Manager
	workerID     string
	factory      DriverFactory
	policy       Policy

	mu           sync.Mutex
	drivers      map[string]agentdriver.Driver
	starting     map[string]struct{}
	cancelled    map[string]struct{}
	tokens       map[string]string
	leaseCancels map[string]context.CancelFunc
	leaseTTL     time.Duration
	leaseRenewal time.Duration
	reporter     RunLifecycleReporter
}

func NewService(store *Store, capabilities *runcapability.Manager, workerID string, factory DriverFactory) *Service {
	if store == nil {
		store = NewStore(nil)
	}
	return &Service{
		store: store, capabilities: capabilities, workerID: first(workerID, "local-dock"), factory: factory,
		policy: Policy{Enabled: true, AutomationMode: "guarded", MaxConcurrency: 1}, drivers: map[string]agentdriver.Driver{},
		starting: map[string]struct{}{}, cancelled: map[string]struct{}{}, tokens: map[string]string{}, leaseCancels: map[string]context.CancelFunc{},
		leaseTTL: 2 * time.Minute, leaseRenewal: 40 * time.Second,
	}
}

func (s *Service) Store() *Store { return s.store }

func (s *Service) SetRunLifecycleReporter(reporter RunLifecycleReporter) {
	s.mu.Lock()
	s.reporter = reporter
	s.mu.Unlock()
}

func (s *Service) SetPolicy(policy Policy) {
	if s == nil {
		return
	}
	policy.WorkspaceRoots = mergeWorkspaceRoots(policy.WorkspaceRoot, policy.WorkspaceRoots)
	if len(policy.WorkspaceRoots) > 0 {
		policy.WorkspaceRoot = policy.WorkspaceRoots[0]
	} else {
		policy.WorkspaceRoot = ""
	}
	policy.AutomationMode = normalizeAutomationMode(policy.AutomationMode, policy.Enabled)
	policy.PermissionProfile = strings.TrimSpace(policy.PermissionProfile)
	if policy.MaxConcurrency <= 0 {
		policy.MaxConcurrency = 1
	}
	roles := make([]string, 0, len(policy.AllowedRoles))
	for _, role := range policy.AllowedRoles {
		if normalized := normalizeRole(role); normalized != "" && !containsRole(roles, normalized) {
			roles = append(roles, normalized)
		}
	}
	policy.AllowedRoles = roles
	s.mu.Lock()
	s.policy = policy
	s.mu.Unlock()
}

// HandleWake starts or resumes exactly one vendor thread for a (transaction,
// role) run. Duplicate WakeJobs return the original run without starting a
// second turn.
func (s *Service) HandleWake(ctx context.Context, wake WakeRequest) (AutomationRun, error) {
	if s == nil || s.factory == nil || s.capabilities == nil {
		return AutomationRun{}, fmt.Errorf("automation supervisor is not configured")
	}
	jobID := strings.TrimSpace(wake.JobID)
	if jobID == "" {
		return AutomationRun{}, fmt.Errorf("wake job id required")
	}
	wake.Role = normalizeRole(wake.Role)
	if wake.Role == "" {
		return AutomationRun{}, fmt.Errorf("wake role must be buyer, seller or verifier")
	}
	s.mu.Lock()
	policy := s.policy
	s.mu.Unlock()
	if !policy.Enabled {
		return AutomationRun{}, fmt.Errorf("Codex automation is disabled")
	}
	if policy.AutomationMode == "manual" {
		return AutomationRun{}, fmt.Errorf("Codex automation mode is manual")
	}
	if len(policy.AllowedRoles) > 0 && !containsRole(policy.AllowedRoles, wake.Role) {
		return AutomationRun{}, fmt.Errorf("Codex automation role %q is disabled", wake.Role)
	}
	workspace, err := resolveWorkspace(wake.Workspace, policy.WorkspaceRoots)
	if err != nil {
		return AutomationRun{}, err
	}
	wake.Workspace = workspace
	wake.PermissionProfile, err = resolvePermissionProfile(wake.PermissionProfile, policy.PermissionProfile)
	if err != nil {
		return AutomationRun{}, err
	}
	run, duplicate, err := s.store.Create(CreateRequest{
		RunID: wake.RunID, TransactionID: wake.TransactionID, Role: wake.Role, Driver: DriverCodex,
		TriggerEventID: wake.TriggerEventID, ExpectedStateVersion: wake.ExpectedStateVersion,
		PermissionProfile: wake.PermissionProfile, Workspace: wake.Workspace,
		AutomationMode: policy.AutomationMode, AllowedActions: wake.AllowedActions, AllowedActionsSet: wake.AllowedActionsSet,
		IdempotencyKey: "wake:" + jobID,
	})
	if err != nil {
		return AutomationRun{}, err
	}
	if duplicate {
		switch run.Status {
		case RunWaitingUser, RunBlocked, RunCompleted, RunFailed, RunCancelled:
			return run, nil
		}
	}
	if current, active, err := s.reserve(run.RunID, policy.MaxConcurrency); active || err != nil {
		if active {
			return current, nil
		}
		return run, err
	}
	reserved := true
	defer func() {
		if reserved {
			s.releaseStarting(run.RunID)
		}
	}()
	run, err = s.store.Claim(ClaimRequest{RunID: run.RunID, WorkerID: s.workerID, LeaseTTL: s.leaseTTL})
	if err != nil {
		return AutomationRun{}, err
	}
	token, _, err := s.capabilities.Issue(runcapability.Claims{
		RunID: run.RunID, TransactionID: run.TransactionID, Role: run.Role,
		Actions: capabilityActions(run.AllowedActions, run.AllowedActionsSet), Workspace: run.Workspace, LeaseEpoch: run.Lease.Epoch,
	}, 30*time.Minute)
	if err != nil {
		_, _ = s.store.Finish(run.RunID, s.workerID, run.Lease.Epoch, RunWaitingAgent, err.Error())
		return AutomationRun{}, err
	}
	s.mu.Lock()
	s.tokens[run.RunID] = token
	s.mu.Unlock()
	driver := s.factory(run, token)
	if driver == nil {
		err := fmt.Errorf("codex driver unavailable")
		s.revoke(run.RunID)
		waiting, _ := s.store.Finish(run.RunID, s.workerID, run.Lease.Epoch, RunWaitingAgent, err.Error())
		return waiting, err
	}
	report, err := driver.Probe(ctx)
	if err != nil || !report.Installed || !report.Authenticated {
		reason := "Codex is not ready"
		if err != nil {
			reason = err.Error()
		} else if report.Error != "" {
			reason = report.Error
		} else if !report.Installed {
			reason = "Codex executable not found"
		} else if !report.Authenticated {
			reason = first(report.AuthStatus, "Codex login required")
		}
		_ = driver.Close()
		s.revoke(run.RunID)
		waiting, _ := s.store.Finish(run.RunID, s.workerID, run.Lease.Epoch, RunWaitingAgent, reason)
		return waiting, fmt.Errorf("%s", reason)
	}
	var session agentdriver.Session
	if run.VendorThreadID != "" {
		session, err = driver.ResumeSession(ctx, agentdriver.ResumeRequest{ThreadID: run.VendorThreadID, PermissionProfile: run.PermissionProfile, AdditionalParams: map[string]any{"cwd": run.Workspace}})
	} else {
		session, err = driver.StartSession(ctx, agentdriver.SessionRequest{CWD: run.Workspace, PermissionProfile: run.PermissionProfile})
	}
	if err != nil {
		_ = driver.Close()
		s.revoke(run.RunID)
		waiting, _ := s.store.Finish(run.RunID, s.workerID, run.Lease.Epoch, RunWaitingAgent, err.Error())
		return waiting, err
	}
	run, err = s.store.SetVendorSession(run.RunID, session.ThreadID, "")
	if err != nil {
		_ = driver.Close()
		s.revoke(run.RunID)
		return AutomationRun{}, err
	}
	prompt := strings.TrimSpace(wake.Prompt)
	if prompt == "" {
		prompt = fmt.Sprintf("Exora transaction %s has a new event (%s). Continue as the %s agent. First call exora.claim_run with runId %s, then read the transaction state and allowed actions through Exora MCP. Before ending the turn, submit a durable transaction action or call exora.finish_run; ordinary text is not progress. Never request or expose wallet keys, payment PINs, owner tokens, or model credentials.", run.TransactionID, first(wake.TriggerEventID, jobID), run.Role, run.RunID)
	}
	registered := make(chan struct{})
	acceptEvents := false
	registrationDone := false
	defer func() {
		if !registrationDone {
			close(registered)
		}
	}()
	turn, err := driver.StartTurn(ctx, agentdriver.TurnRequest{ThreadID: session.ThreadID, Prompt: prompt}, agentdriver.EventSinkFunc(func(event agentdriver.Event) {
		go func() {
			<-registered
			if acceptEvents {
				s.handleDriverEvent(run.RunID, run.Lease.Epoch, driver, event)
			}
		}()
	}))
	if err != nil {
		_ = driver.Close()
		s.revoke(run.RunID)
		waiting, _ := s.store.Finish(run.RunID, s.workerID, run.Lease.Epoch, RunWaitingAgent, err.Error())
		return waiting, err
	}
	run, err = s.store.SetVendorSession(run.RunID, session.ThreadID, turn.TurnID)
	if err != nil {
		_ = driver.Close()
		s.revoke(run.RunID)
		return AutomationRun{}, err
	}
	s.mu.Lock()
	if _, cancelled := s.cancelled[run.RunID]; cancelled {
		s.mu.Unlock()
		_ = driver.Close()
		s.revoke(run.RunID)
		cancelledRun, _ := s.store.Get(run.RunID)
		return cancelledRun, fmt.Errorf("automation run was cancelled while starting")
	}
	if old := s.drivers[run.RunID]; old != nil && old != driver {
		_ = old.Close()
	}
	s.drivers[run.RunID] = driver
	leaseCtx, cancelLease := context.WithCancel(context.Background())
	s.leaseCancels[run.RunID] = cancelLease
	delete(s.starting, run.RunID)
	s.mu.Unlock()
	go s.renewRunLease(leaseCtx, run.RunID, run.Lease.Epoch)
	reserved = false
	acceptEvents = true
	close(registered)
	registrationDone = true
	s.reportLifecycle(context.Background(), run, RunLifecycleEvent{Type: "started", IdempotencyKey: "started:" + run.RunID + ":" + turn.TurnID, VendorThreadID: session.ThreadID, VendorTurnID: turn.TurnID})
	return run, nil
}

func capabilityActions(snapshot []string, restricted bool) []string {
	if !restricted {
		return append([]string(nil), AgentActions...)
	}
	allowed := map[string]bool{}
	for _, action := range snapshot {
		allowed[strings.ToLower(strings.TrimSpace(action))] = true
	}
	out := append([]string(nil), AgentActions[:4]...)
	out = append(out, "finish_run")
	for _, action := range AgentActions[4:] {
		if action == "finish_run" {
			continue
		}
		if allowed[action] {
			out = append(out, action)
		}
	}
	return out
}

func (s *Service) Interrupt(ctx context.Context, runID string) error {
	run, ok := s.store.Get(runID)
	if !ok {
		return ErrNotFound
	}
	s.mu.Lock()
	driver := s.drivers[runID]
	s.cancelled[runID] = struct{}{}
	s.mu.Unlock()
	if driver == nil {
		s.mu.Lock()
		if cancelLease := s.leaseCancels[runID]; cancelLease != nil {
			cancelLease()
			delete(s.leaseCancels, runID)
		}
		s.mu.Unlock()
		_, err := s.store.Finish(run.RunID, "", 0, RunCancelled, "cancelled by owner")
		s.revoke(run.RunID)
		s.mu.Lock()
		delete(s.cancelled, runID)
		s.mu.Unlock()
		return err
	}
	if err := driver.Interrupt(ctx, run.VendorThreadID, run.VendorTurnID); err != nil {
		s.mu.Lock()
		delete(s.cancelled, runID)
		s.mu.Unlock()
		return err
	}
	_, err := s.store.Finish(run.RunID, "", 0, RunCancelled, "interrupted by owner")
	s.mu.Lock()
	if cancelLease := s.leaseCancels[runID]; cancelLease != nil {
		cancelLease()
		delete(s.leaseCancels, runID)
	}
	if s.drivers[runID] == driver {
		delete(s.drivers, runID)
	}
	s.mu.Unlock()
	_ = driver.Close()
	s.revoke(run.RunID)
	s.mu.Lock()
	delete(s.cancelled, runID)
	s.mu.Unlock()
	return err
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	drivers := s.drivers
	s.drivers = map[string]agentdriver.Driver{}
	leaseCancels := s.leaseCancels
	s.leaseCancels = map[string]context.CancelFunc{}
	tokens := s.tokens
	s.tokens = map[string]string{}
	s.mu.Unlock()
	for _, cancelLease := range leaseCancels {
		cancelLease()
	}
	var firstErr error
	for runID, driver := range drivers {
		if err := driver.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
		if run, ok := s.store.Get(runID); ok && run.Status == RunRunning {
			_, _ = s.store.Finish(runID, s.workerID, run.Lease.Epoch, RunWaitingAgent, "Dock supervisor stopped")
		}
	}
	if s.capabilities != nil {
		for _, token := range tokens {
			_ = s.capabilities.Revoke(token)
		}
	}
	return firstErr
}

func (s *Service) handleDriverEvent(runID string, epoch int64, source agentdriver.Driver, event agentdriver.Event) {
	if !driverTurnTerminal(event.Method) {
		return
	}
	s.mu.Lock()
	driver := s.drivers[runID]
	if driver == nil || driver != source {
		s.mu.Unlock()
		return
	}
	delete(s.drivers, runID)
	if cancelLease := s.leaseCancels[runID]; cancelLease != nil {
		cancelLease()
		delete(s.leaseCancels, runID)
	}
	s.mu.Unlock()
	if driver != nil {
		_ = driver.Close()
	}
	s.revoke(runID)
	// A completed Codex turn is not permission to advance the transaction.
	// Mutating MCP calls determine the next durable run state. If no such call
	// occurred, leave a checkpoint that can be awakened again.
	run, ok := s.store.Get(runID)
	if !ok || run.Lease.Epoch != epoch {
		return
	}
	status, errText := terminalRunStatus(event)
	lifecycle := lifecycleOutcome(run, status, errText)
	s.reportLifecycle(context.Background(), run, lifecycle)
	if run.Status != RunRunning {
		return
	}
	_, _ = s.store.Finish(runID, s.workerID, epoch, status, errText)
}

func (s *Service) renewRunLease(ctx context.Context, runID string, epoch int64) {
	interval := s.leaseRenewal
	if interval <= 0 {
		interval = 40 * time.Second
	}
	ttl := s.leaseTTL
	if ttl <= 0 {
		ttl = 2 * time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := s.store.Renew(runID, s.workerID, epoch, ttl); err != nil {
				s.handleLeaseLoss(runID, epoch, err)
				return
			}
			if run, ok := s.store.Get(runID); ok {
				s.reportLifecycle(context.Background(), run, RunLifecycleEvent{Type: "heartbeat", IdempotencyKey: fmt.Sprintf("heartbeat:%s:%d", runID, time.Now().UTC().Unix()/30)})
			}
		}
	}
}

func (s *Service) reportLifecycle(ctx context.Context, run AutomationRun, event RunLifecycleEvent) {
	s.mu.Lock()
	reporter := s.reporter
	s.mu.Unlock()
	if reporter == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	_ = reporter.ReportRun(ctx, run, event)
}

func lifecycleOutcome(run AutomationRun, status, errText string) RunLifecycleEvent {
	event := RunLifecycleEvent{Type: "finished", IdempotencyKey: "finished:" + run.RunID + ":" + run.VendorTurnID, VendorThreadID: run.VendorThreadID, VendorTurnID: run.VendorTurnID}
	if status == RunFailed || status == RunCancelled {
		event.Outcome, event.Reason = "missing_checkpoint", first(errText, "driver_turn_failed")
		return event
	}
	if len(run.Events) == 0 {
		event.Outcome, event.Reason = "missing_checkpoint", "turn_ended_without_mcp_checkpoint"
		return event
	}
	last := run.Events[len(run.Events)-1]
	switch last.Type {
	case "finish_run":
		event.Outcome, _ = last.Payload["outcome"].(string)
		event.NextAction, _ = last.Payload["nextAction"].(string)
		event.TargetRole, _ = last.Payload["targetRole"].(string)
		event.RetryAt, _ = last.Payload["retryAt"].(string)
		event.Reason, _ = last.Payload["reason"].(string)
		if strings.TrimSpace(event.Outcome) == "" {
			event.Outcome, event.Reason = "missing_checkpoint", "finish_run_missing_outcome"
		}
	case "request_user_input", "request_approval", "propose_transition", "submit_offer", "submit_deliverable", "report_blocked":
		event.Outcome = "progressed"
	default:
		event.Outcome, event.Reason = "missing_checkpoint", "turn_ended_without_terminal_mcp_checkpoint"
	}
	return event
}

func (s *Service) handleLeaseLoss(runID string, epoch int64, cause error) {
	s.mu.Lock()
	driver := s.drivers[runID]
	delete(s.drivers, runID)
	delete(s.leaseCancels, runID)
	s.mu.Unlock()
	if driver != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if run, ok := s.store.Get(runID); ok {
			_ = driver.Interrupt(ctx, run.VendorThreadID, run.VendorTurnID)
		}
		cancel()
		_ = driver.Close()
	}
	s.revoke(runID)
	if !errors.Is(cause, ErrStaleLease) && !errors.Is(cause, ErrNotFound) {
		_, _ = s.store.Finish(runID, s.workerID, epoch, RunWaitingAgent, cause.Error())
	}
}

func (s *Service) reserve(runID string, maxConcurrency int) (AutomationRun, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.starting[runID]; ok {
		run, _ := s.store.Get(runID)
		return run, true, nil
	}
	if _, ok := s.drivers[runID]; ok {
		run, _ := s.store.Get(runID)
		return run, true, nil
	}
	if maxConcurrency <= 0 {
		maxConcurrency = 1
	}
	if len(s.starting)+len(s.drivers) >= maxConcurrency {
		return AutomationRun{}, false, fmt.Errorf("Codex automation maxConcurrency %d reached", maxConcurrency)
	}
	s.starting[runID] = struct{}{}
	return AutomationRun{}, false, nil
}

func (s *Service) releaseStarting(runID string) {
	s.mu.Lock()
	delete(s.starting, runID)
	delete(s.cancelled, runID)
	s.mu.Unlock()
}

func (s *Service) revoke(runID string) {
	if s == nil || s.capabilities == nil {
		return
	}
	s.mu.Lock()
	token := s.tokens[runID]
	delete(s.tokens, runID)
	s.mu.Unlock()
	if token != "" {
		_ = s.capabilities.Revoke(token)
	}
}

func resolveWorkspace(candidate string, roots []string) (string, error) {
	roots = mergeWorkspaceRoots("", roots)
	candidate = cleanWorkspace(candidate)
	if candidate == "" {
		if len(roots) > 0 {
			candidate = roots[0]
		}
	}
	if candidate == "" {
		return "", nil
	}
	if len(roots) > 0 {
		allowed := false
		for _, root := range roots {
			rel, err := filepath.Rel(root, candidate)
			if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				allowed = true
				break
			}
		}
		if !allowed {
			return "", fmt.Errorf("automation workspace must stay within one of: %s", strings.Join(roots, ", "))
		}
	}
	return candidate, nil
}

func mergeWorkspaceRoots(legacy string, roots []string) []string {
	values := make([]string, 0, len(roots)+1)
	if strings.TrimSpace(legacy) != "" {
		values = append(values, legacy)
	}
	values = append(values, roots...)
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		root := cleanWorkspace(value)
		if root == "" {
			continue
		}
		key := root
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, root)
	}
	return out
}

func normalizeAutomationMode(mode string, legacyEnabled bool) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "manual":
		return "manual"
	case "guarded":
		return "guarded"
	case "autonomous":
		return "autonomous"
	default:
		if legacyEnabled {
			return "guarded"
		}
		return "manual"
	}
}

func resolvePermissionProfile(requested, configured string) (string, error) {
	requested = strings.ToLower(strings.TrimSpace(requested))
	configured = strings.ToLower(strings.TrimSpace(configured))
	if requested == "" {
		return configured, nil
	}
	if configured == "" || requested == configured {
		return requested, nil
	}
	rank := func(value string) (int, bool) {
		switch value {
		case "read-only", "readonly", ":read-only":
			return 1, true
		case "workspace-write", "workspace", ":workspace":
			return 2, true
		case "danger-full-access", ":danger-full-access":
			return 3, true
		default:
			return 0, false
		}
	}
	requestedRank, requestedKnown := rank(requested)
	configuredRank, configuredKnown := rank(configured)
	if requestedKnown && configuredKnown && requestedRank <= configuredRank {
		return requested, nil
	}
	return "", fmt.Errorf("wake permission profile %q exceeds local policy %q", requested, configured)
}

func containsRole(roles []string, role string) bool {
	for _, candidate := range roles {
		if candidate == role {
			return true
		}
	}
	return false
}

func driverTurnTerminal(method string) bool {
	lower := strings.ToLower(strings.TrimSpace(method))
	return strings.Contains(lower, "turn/completed") || strings.Contains(lower, "turn/failed") || strings.Contains(lower, "turn/cancel") || lower == "driver/stopped"
}

func terminalRunStatus(event agentdriver.Event) (string, string) {
	method := strings.ToLower(strings.TrimSpace(event.Method))
	if method == "driver/stopped" {
		var params map[string]any
		_ = json.Unmarshal(event.Params, &params)
		return RunWaitingAgent, first(firstNestedText(params, "error"), "Codex app-server stopped")
	}
	if strings.Contains(method, "failed") {
		return RunFailed, "Codex turn failed"
	}
	if strings.Contains(method, "cancel") || strings.Contains(method, "interrupt") {
		return RunCancelled, "Codex turn interrupted"
	}
	var params map[string]any
	if len(event.Params) > 0 && json.Unmarshal(event.Params, &params) == nil {
		status := strings.ToLower(strings.TrimSpace(firstNestedText(params, "turn", "status")))
		switch status {
		case "failed", "error":
			return RunFailed, firstNestedText(params, "turn", "error", "message")
		case "cancelled", "canceled", "interrupted":
			return RunCancelled, "Codex turn interrupted"
		}
	}
	return RunCompleted, ""
}

func firstNestedText(root map[string]any, path ...string) string {
	var value any = root
	for _, key := range path {
		mapped, ok := value.(map[string]any)
		if !ok {
			return ""
		}
		value = mapped[key]
	}
	text, _ := value.(string)
	return strings.TrimSpace(text)
}
