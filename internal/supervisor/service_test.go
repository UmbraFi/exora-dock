package supervisor

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/agentdriver"
	"github.com/exora-dock/exora-dock/internal/runcapability"
)

type fakeDriver struct {
	mu             sync.Mutex
	started        int
	resumed        []string
	resumeRequest  agentdriver.ResumeRequest
	turns          int
	sessionRequest agentdriver.SessionRequest
	sessionErr     error
	sink           agentdriver.EventSink
}

type recordingLifecycleReporter struct {
	mu     sync.Mutex
	events []RunLifecycleEvent
}

func (r *recordingLifecycleReporter) ReportRun(_ context.Context, _ AutomationRun, event RunLifecycleEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, event)
	return nil
}

func (f *fakeDriver) Kind() string { return "codex" }
func (f *fakeDriver) Probe(context.Context) (agentdriver.CapabilityReport, error) {
	return agentdriver.CapabilityReport{Installed: true, Authenticated: true}, nil
}
func (f *fakeDriver) StartSession(_ context.Context, req agentdriver.SessionRequest) (agentdriver.Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.started++
	f.sessionRequest = req
	if f.sessionErr != nil {
		return agentdriver.Session{}, f.sessionErr
	}
	return agentdriver.Session{ThreadID: "thread-exact"}, nil
}

func TestHandleWakeCheckpointsPermissionProtocolFailureAsWaitingAgent(t *testing.T) {
	store := NewStore(nil)
	driver := &fakeDriver{sessionErr: errors.New("Codex permission profile unavailable after protocol change")}
	service := NewService(store, runcapability.NewEphemeral([]byte("supervisor-profile-secret-that-is-long-enough")), "dock", func(AutomationRun, string) agentdriver.Driver {
		return driver
	})
	service.SetPolicy(Policy{Enabled: true, PermissionProfile: "workspace-write", MaxConcurrency: 1})
	run, err := service.HandleWake(context.Background(), WakeRequest{JobID: "profile-change", TransactionID: "tx-profile", Role: "seller"})
	if err == nil {
		t.Fatal("expected permission protocol failure")
	}
	if run.Status != RunWaitingAgent || !strings.Contains(run.LastError, "permission profile") {
		t.Fatalf("run = %#v", run)
	}
}

func TestHandleWakeEnforcesLocalRoleWorkspacePermissionAndConcurrencyPolicy(t *testing.T) {
	store := NewStore(nil)
	caps := runcapability.NewEphemeral([]byte("supervisor-policy-secret-that-is-long-enough"))
	driver := &fakeDriver{}
	var issuedToken string
	service := NewService(store, caps, "dock", func(_ AutomationRun, token string) agentdriver.Driver {
		issuedToken = token
		return driver
	})
	root := t.TempDir()
	secondRoot := t.TempDir()
	service.SetPolicy(Policy{
		Enabled: true, AllowedRoles: []string{"seller"}, WorkspaceRoot: root, WorkspaceRoots: []string{secondRoot}, AutomationMode: "guarded",
		PermissionProfile: "workspace-write", MaxConcurrency: 1,
	})

	if _, err := service.HandleWake(context.Background(), WakeRequest{JobID: "buyer", TransactionID: "tx-b", Role: "buyer", Workspace: root}); err == nil || !strings.Contains(err.Error(), "role") {
		t.Fatalf("role error = %v", err)
	}
	outside := filepath.Join(filepath.Dir(root), "outside")
	if _, err := service.HandleWake(context.Background(), WakeRequest{JobID: "outside", TransactionID: "tx-o", Role: "seller", Workspace: outside}); err == nil || !strings.Contains(err.Error(), "workspace") {
		t.Fatalf("workspace error = %v", err)
	}
	if _, err := service.HandleWake(context.Background(), WakeRequest{JobID: "danger", TransactionID: "tx-d", Role: "seller", Workspace: root, PermissionProfile: "danger-full-access"}); err == nil || !strings.Contains(err.Error(), "permission") {
		t.Fatalf("permission error = %v", err)
	}

	first, err := service.HandleWake(context.Background(), WakeRequest{JobID: "one", TransactionID: "tx-1", Role: "seller", Workspace: filepath.Join(secondRoot, "child"), PermissionProfile: "read-only"})
	if err != nil {
		t.Fatal(err)
	}
	driver.mu.Lock()
	request := driver.sessionRequest
	driver.mu.Unlock()
	if request.PermissionProfile != "read-only" || request.CWD != filepath.Join(secondRoot, "child") || first.AutomationMode != "guarded" {
		t.Fatalf("session request = %#v", request)
	}
	if _, err := service.HandleWake(context.Background(), WakeRequest{JobID: "two", TransactionID: "tx-2", Role: "seller", Workspace: root}); err == nil || !strings.Contains(err.Error(), "maxConcurrency") {
		t.Fatalf("concurrency error = %v", err)
	}
	if err := service.Interrupt(context.Background(), first.RunID); err != nil {
		t.Fatal(err)
	}
	if _, err := caps.Verify(issuedToken, runcapability.Requirement{}); !errors.Is(err, runcapability.ErrRevoked) {
		t.Fatalf("capability after cancel = %v", err)
	}
	if _, err := service.HandleWake(context.Background(), WakeRequest{JobID: "after-cancel", TransactionID: "tx-3", Role: "seller", Workspace: root}); err != nil {
		t.Fatalf("cancel did not release concurrency: %v", err)
	}
}

func TestHandleWakeHonorsManualAutomationMode(t *testing.T) {
	store := NewStore(nil)
	called := false
	service := NewService(store, runcapability.NewEphemeral([]byte("supervisor-manual-secret-that-is-long-enough")), "dock", func(AutomationRun, string) agentdriver.Driver {
		called = true
		return &fakeDriver{}
	})
	service.SetPolicy(Policy{Enabled: true, AutomationMode: "manual", WorkspaceRoots: []string{t.TempDir()}, MaxConcurrency: 1})
	if _, err := service.HandleWake(context.Background(), WakeRequest{JobID: "manual", TransactionID: "tx", Role: "seller"}); err == nil || !strings.Contains(err.Error(), "manual") {
		t.Fatalf("manual mode error = %v", err)
	}
	if called || len(store.List("")) != 0 {
		t.Fatalf("manual mode started driver=%v runs=%d", called, len(store.List("")))
	}
}

func TestWakeAllowedActionsSnapshotNarrowsMutationCapability(t *testing.T) {
	store := NewStore(nil)
	caps := runcapability.NewEphemeral([]byte("supervisor-actions-secret-that-is-long-enough"))
	var token string
	service := NewService(store, caps, "dock", func(_ AutomationRun, issued string) agentdriver.Driver {
		token = issued
		return &fakeDriver{}
	})
	run, err := service.HandleWake(context.Background(), WakeRequest{
		JobID: "actions", RunID: "cloud-actions", TransactionID: "tx-actions", Role: "seller",
		AllowedActions: []string{"report_progress", "request_user_input"}, AllowedActionsSet: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := caps.Verify(token, runcapability.Requirement{RunID: run.RunID, LeaseEpoch: run.Lease.Epoch, Action: "report_progress"}); err != nil {
		t.Fatalf("allowed action rejected: %v", err)
	}
	if _, err := caps.Verify(token, runcapability.Requirement{RunID: run.RunID, Action: "submit_offer"}); !errors.Is(err, runcapability.ErrForbidden) {
		t.Fatalf("snapshot-excluded action = %v, want forbidden", err)
	}
	if err := service.Interrupt(context.Background(), run.RunID); err != nil {
		t.Fatal(err)
	}
	readOnly := capabilityActions(nil, true)
	if len(readOnly) != 5 || readOnly[0] != "claim_run" || readOnly[4] != "finish_run" {
		t.Fatalf("explicit empty snapshot = %#v", readOnly)
	}
}
func (f *fakeDriver) ResumeSession(_ context.Context, req agentdriver.ResumeRequest) (agentdriver.Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resumed = append(f.resumed, req.ThreadID)
	f.resumeRequest = req
	return agentdriver.Session{ThreadID: req.ThreadID}, nil
}
func (f *fakeDriver) StartTurn(_ context.Context, req agentdriver.TurnRequest, sink agentdriver.EventSink) (agentdriver.Turn, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.turns++
	f.sink = sink
	return agentdriver.Turn{ThreadID: req.ThreadID, TurnID: "turn-1"}, nil
}
func (f *fakeDriver) Steer(context.Context, agentdriver.TurnRequest) error { return nil }
func (f *fakeDriver) Interrupt(context.Context, string, string) error      { return nil }
func (f *fakeDriver) Close() error                                         { return nil }

func TestHandleWakeIsIdempotentAndPersistsExactThread(t *testing.T) {
	store := NewStore(nil)
	caps := runcapability.NewEphemeral([]byte("supervisor-test-secret-that-is-long-enough"))
	driver := &fakeDriver{}
	service := NewService(store, caps, "dock", func(run AutomationRun, token string) agentdriver.Driver {
		if token == "" {
			t.Fatal("missing run capability")
		}
		return driver
	})
	wake := WakeRequest{JobID: "job-1", RunID: "cloud-run-1", TransactionID: "tx-1", Role: "seller", ExpectedStateVersion: 4}
	first, err := service.HandleWake(context.Background(), wake)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.HandleWake(context.Background(), wake)
	if err != nil {
		t.Fatal(err)
	}
	if first.RunID != "cloud-run-1" || first.RunID != second.RunID || first.VendorThreadID != "thread-exact" {
		t.Fatalf("first=%#v second=%#v", first, second)
	}
	driver.mu.Lock()
	defer driver.mu.Unlock()
	if driver.started != 1 || driver.turns != 1 {
		t.Fatalf("start=%d turns=%d", driver.started, driver.turns)
	}
}

func TestDriverTerminalEventSurvivesWakeRequestContextCancellation(t *testing.T) {
	store := NewStore(nil)
	driver := &fakeDriver{}
	service := NewService(store, runcapability.NewEphemeral([]byte("supervisor-event-secret-that-is-long-enough")), "dock", func(AutomationRun, string) agentdriver.Driver { return driver })
	ctx, cancel := context.WithCancel(context.Background())
	run, err := service.HandleWake(ctx, WakeRequest{JobID: "event", TransactionID: "tx-event", Role: "seller"})
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	driver.mu.Lock()
	sink := driver.sink
	driver.mu.Unlock()
	if sink == nil {
		t.Fatal("driver sink missing")
	}
	sink.OnEvent(agentdriver.Event{Method: "turn/completed", ThreadID: run.VendorThreadID, TurnID: run.VendorTurnID})
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		updated, _ := store.Get(run.RunID)
		if updated.Status == RunCompleted {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	updated, _ := store.Get(run.RunID)
	t.Fatalf("terminal event was dropped: %#v", updated)
}

func TestDriverTerminalWithoutMCPReportsMissingCheckpoint(t *testing.T) {
	store := NewStore(nil)
	driver := &fakeDriver{}
	reporter := &recordingLifecycleReporter{}
	service := NewService(store, runcapability.NewEphemeral([]byte("supervisor-lifecycle-secret-that-is-long-enough")), "dock", func(AutomationRun, string) agentdriver.Driver { return driver })
	service.SetRunLifecycleReporter(reporter)
	run, err := service.HandleWake(context.Background(), WakeRequest{JobID: "lifecycle", TransactionID: "tx-lifecycle", Role: "buyer"})
	if err != nil {
		t.Fatal(err)
	}
	driver.mu.Lock()
	sink := driver.sink
	driver.mu.Unlock()
	sink.OnEvent(agentdriver.Event{Method: "turn/completed", ThreadID: run.VendorThreadID, TurnID: run.VendorTurnID})
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		reporter.mu.Lock()
		events := append([]RunLifecycleEvent(nil), reporter.events...)
		reporter.mu.Unlock()
		if len(events) >= 2 {
			if events[0].Type != "started" || events[len(events)-1].Outcome != "missing_checkpoint" {
				t.Fatalf("events=%#v", events)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("missing lifecycle finish event")
}

func TestActiveAutomationRunLeaseRenewsUntilTurnEnds(t *testing.T) {
	store := NewStore(nil)
	base := time.Unix(2000, 0).UTC()
	current := base
	var clockMu sync.Mutex
	store.now = func() time.Time {
		clockMu.Lock()
		defer clockMu.Unlock()
		return current
	}
	driver := &fakeDriver{}
	service := NewService(store, runcapability.NewEphemeral([]byte("supervisor-renew-secret-that-is-long-enough")), "dock", func(AutomationRun, string) agentdriver.Driver { return driver })
	service.leaseTTL = 60 * time.Millisecond
	service.leaseRenewal = 10 * time.Millisecond
	run, err := service.HandleWake(context.Background(), WakeRequest{JobID: "renew", TransactionID: "tx-renew", Role: "seller"})
	if err != nil {
		t.Fatal(err)
	}
	initialUntil, _ := time.Parse(time.RFC3339Nano, run.Lease.Until)
	clockMu.Lock()
	current = base.Add(50 * time.Millisecond)
	clockMu.Unlock()
	deadline := time.Now().Add(time.Second)
	var renewed AutomationRun
	for time.Now().Before(deadline) {
		renewed, _ = store.Get(run.RunID)
		until, _ := time.Parse(time.RFC3339Nano, renewed.Lease.Until)
		if until.After(initialUntil) {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	renewedUntil, _ := time.Parse(time.RFC3339Nano, renewed.Lease.Until)
	if !renewedUntil.After(initialUntil) {
		t.Fatalf("lease was not renewed: initial=%s current=%s", initialUntil, renewedUntil)
	}
	clockMu.Lock()
	current = base.Add(70 * time.Millisecond)
	clockMu.Unlock()
	if _, err := store.Claim(ClaimRequest{RunID: run.RunID, WorkerID: "other", LeaseTTL: time.Minute}); !errors.Is(err, ErrLeaseHeld) {
		t.Fatalf("renewed lease was stealable: %v", err)
	}
	if err := service.Interrupt(context.Background(), run.RunID); err != nil {
		t.Fatal(err)
	}
}

func TestHandleWakeResumesStoredThread(t *testing.T) {
	store := NewStore(nil)
	run, _, _ := store.Create(CreateRequest{TransactionID: "tx", Role: "buyer", ExpectedStateVersion: 1, IdempotencyKey: "wake:old"})
	run, _ = store.SetVendorSession(run.RunID, "thread-original", "")
	_, _ = store.Finish(run.RunID, "", 0, RunWaitingAgent, "offline")
	driver := &fakeDriver{}
	service := NewService(store, runcapability.NewEphemeral([]byte("supervisor-test-secret-that-is-long-enough")), "dock", func(AutomationRun, string) agentdriver.Driver { return driver })
	// A new Cloud event creates a new AutomationRun but continues the exact
	// vendor thread dedicated to this transaction and role.
	service2 := NewService(store, service.capabilities, "dock", func(AutomationRun, string) agentdriver.Driver { return driver })
	service2.SetPolicy(Policy{Enabled: true, PermissionProfile: "read-only", MaxConcurrency: 1})
	_, err := service2.HandleWake(context.Background(), WakeRequest{JobID: "new", TransactionID: "tx", Role: "buyer", ExpectedStateVersion: 2})
	if err != nil {
		t.Fatal(err)
	}
	driver.mu.Lock()
	defer driver.mu.Unlock()
	if len(driver.resumed) != 1 || driver.resumed[0] != "thread-original" || driver.resumeRequest.PermissionProfile != "read-only" {
		t.Fatalf("resumed=%v request=%#v", driver.resumed, driver.resumeRequest)
	}
}

func TestDuplicateRunningWakeRecoversPersistedThreadAfterSupervisorRestart(t *testing.T) {
	store := NewStore(nil)
	now := time.Unix(1000, 0).UTC()
	store.now = func() time.Time { return now }
	run, _, err := store.Create(CreateRequest{TransactionID: "tx-restart", Role: "seller", ExpectedStateVersion: 3, IdempotencyKey: "wake:same-job"})
	if err != nil {
		t.Fatal(err)
	}
	run, err = store.Claim(ClaimRequest{RunID: run.RunID, WorkerID: "old-process", LeaseTTL: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetVendorSession(run.RunID, "thread-before-crash", "turn-before-crash"); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Minute)
	driver := &fakeDriver{}
	service := NewService(store, runcapability.NewEphemeral([]byte("supervisor-restart-secret-that-is-long-enough")), "new-process", func(AutomationRun, string) agentdriver.Driver { return driver })
	recovered, err := service.HandleWake(context.Background(), WakeRequest{JobID: "same-job", TransactionID: "tx-restart", Role: "seller", ExpectedStateVersion: 3})
	if err != nil {
		t.Fatal(err)
	}
	if recovered.RunID != run.RunID || recovered.Lease.Epoch <= run.Lease.Epoch {
		t.Fatalf("recovered run = %#v, old lease = %#v", recovered, run.Lease)
	}
	driver.mu.Lock()
	defer driver.mu.Unlock()
	if len(driver.resumed) != 1 || driver.resumed[0] != "thread-before-crash" {
		t.Fatalf("resume calls = %#v", driver.resumed)
	}
}
