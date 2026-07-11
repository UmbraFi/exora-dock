package supervisor

import (
	"errors"
	"testing"
	"time"
)

func TestCreateAndActionAreIdempotent(t *testing.T) {
	s := NewStore(nil)
	req := CreateRequest{TransactionID: "tx-1", Role: "buyer", IdempotencyKey: "wake-1", ExpectedStateVersion: 7}
	run, duplicate, err := s.Create(req)
	if err != nil || duplicate {
		t.Fatalf("create: duplicate=%v err=%v", duplicate, err)
	}
	again, duplicate, err := s.Create(req)
	if err != nil || !duplicate || again.RunID != run.RunID {
		t.Fatalf("idempotent create = %#v duplicate=%v err=%v", again, duplicate, err)
	}

	claimed, err := s.Claim(ClaimRequest{RunID: run.RunID, WorkerID: "dock-1", LeaseTTL: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	action := ActionRequest{Type: "report_progress", ExpectedRunVersion: claimed.Version, ExpectedStateVersion: 7, IdempotencyKey: "action-1", Payload: map[string]any{"message": "working"}}
	updated, duplicate, err := s.RecordAction(run.RunID, action)
	if err != nil || duplicate {
		t.Fatalf("action: duplicate=%v err=%v", duplicate, err)
	}
	eventCount := len(updated.Events)
	updated, duplicate, err = s.RecordAction(run.RunID, action)
	if err != nil || !duplicate || len(updated.Events) != eventCount {
		t.Fatalf("idempotent action: duplicate=%v events=%d err=%v", duplicate, len(updated.Events), err)
	}
	updated, err = s.AdvanceExpectedStateVersion(run.RunID, 7, 8)
	if err != nil || updated.ExpectedStateVersion != 8 || len(updated.Events) != eventCount+1 {
		t.Fatalf("advance transaction version: run=%#v err=%v", updated, err)
	}
	advancedEventCount := len(updated.Events)
	updated, duplicate, err = s.RecordAction(run.RunID, action)
	if err != nil || !duplicate || updated.ExpectedStateVersion != 8 || len(updated.Events) != advancedEventCount {
		t.Fatalf("idempotent action after advance: duplicate=%v run=%#v err=%v", duplicate, updated, err)
	}
	updated, err = s.AdvanceExpectedStateVersion(run.RunID, 7, 8)
	if err != nil || len(updated.Events) != advancedEventCount {
		t.Fatalf("idempotent version advance: run=%#v err=%v", updated, err)
	}
	conflicting := action
	conflicting.Payload = map[string]any{"message": "different"}
	if _, _, err := s.RecordAction(run.RunID, conflicting); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("idempotency key reuse = %v, want conflict", err)
	}
}

func TestAdvanceExpectedStateVersionRejectsDrift(t *testing.T) {
	store := NewStore(nil)
	run, _, _ := store.Create(CreateRequest{TransactionID: "tx-version", Role: "buyer", IdempotencyKey: "wake", ExpectedStateVersion: 4})
	if _, err := store.AdvanceExpectedStateVersion(run.RunID, 3, 5); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("drift advance = %v, want version conflict", err)
	}
	if _, err := store.AdvanceExpectedStateVersion(run.RunID, 4, 3); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("regression = %v, want version conflict", err)
	}
	unchanged, ok := store.Get(run.RunID)
	if !ok || unchanged.ExpectedStateVersion != 4 || len(unchanged.Events) != 1 {
		t.Fatalf("failed advance mutated run: %#v", unchanged)
	}
}

func TestCreateUsesAuthoritativeCloudRunID(t *testing.T) {
	store := NewStore(nil)
	run, duplicate, err := store.Create(CreateRequest{RunID: "cloud-run_123", TransactionID: "tx-cloud", Role: "seller", IdempotencyKey: "wake-cloud"})
	if err != nil || duplicate || run.RunID != "cloud-run_123" {
		t.Fatalf("run=%#v duplicate=%v err=%v", run, duplicate, err)
	}
	again, duplicate, err := store.Create(CreateRequest{RunID: "cloud-run_123", TransactionID: "tx-cloud", Role: "seller", IdempotencyKey: "wake-cloud"})
	if err != nil || !duplicate || again.RunID != run.RunID {
		t.Fatalf("duplicate run=%#v duplicate=%v err=%v", again, duplicate, err)
	}
	if _, _, err := store.Create(CreateRequest{RunID: "../escape", TransactionID: "tx", Role: "seller", IdempotencyKey: "bad"}); err == nil {
		t.Fatal("unsafe Cloud runId accepted")
	}
}

func TestLeaseEpochRejectsStaleWorkerAndVersionConflict(t *testing.T) {
	s := NewStore(nil)
	now := time.Unix(1000, 0).UTC()
	s.now = func() time.Time { return now }
	run, _, _ := s.Create(CreateRequest{TransactionID: "tx", Role: "seller", IdempotencyKey: "wake", ExpectedStateVersion: 2})
	first, err := s.Claim(ClaimRequest{RunID: run.RunID, WorkerID: "one", LeaseTTL: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Claim(ClaimRequest{RunID: run.RunID, WorkerID: "two", LeaseTTL: time.Second}); !errors.Is(err, ErrLeaseHeld) {
		t.Fatalf("got %v, want lease held", err)
	}
	now = now.Add(2 * time.Second)
	second, err := s.Claim(ClaimRequest{RunID: run.RunID, WorkerID: "two", LeaseTTL: time.Minute})
	if err != nil || second.Lease.Epoch <= first.Lease.Epoch {
		t.Fatalf("second claim %#v err=%v", second.Lease, err)
	}
	if _, err := s.Finish(run.RunID, "one", first.Lease.Epoch, RunCompleted, ""); !errors.Is(err, ErrStaleLease) {
		t.Fatalf("got %v, want stale", err)
	}
	_, _, err = s.RecordAction(run.RunID, ActionRequest{Type: "report_progress", ExpectedRunVersion: 1, ExpectedStateVersion: 2, IdempotencyKey: "x"})
	if !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("got %v, want version conflict", err)
	}
}

func TestEventHashChain(t *testing.T) {
	s := NewStore(nil)
	run, _, _ := s.Create(CreateRequest{TransactionID: "tx", Role: "buyer", IdempotencyKey: "wake"})
	run, _ = s.Claim(ClaimRequest{RunID: run.RunID, WorkerID: "dock", LeaseTTL: time.Minute})
	run, _, _ = s.RecordAction(run.RunID, ActionRequest{Type: "report_progress", ExpectedRunVersion: run.Version, ExpectedStateVersion: 0, IdempotencyKey: "a"})
	if len(run.Events) != 3 || run.Events[1].PrevHash != run.Events[0].EventHash || run.Events[2].PrevHash != run.Events[1].EventHash || run.Events[2].EventHash == "" {
		t.Fatalf("broken chain: %#v", run.Events)
	}
}

func TestWaitingRunRejectsNewMutationButAllowsIdempotentRetry(t *testing.T) {
	store := NewStore(nil)
	run, _, _ := store.Create(CreateRequest{TransactionID: "tx-wait", Role: "seller", IdempotencyKey: "wake"})
	run, _ = store.Claim(ClaimRequest{RunID: run.RunID, WorkerID: "dock", LeaseTTL: time.Minute})
	action := ActionRequest{Type: "request_user_input", ExpectedStateVersion: 0, IdempotencyKey: "question", Payload: map[string]any{"question": "continue?"}}
	if _, duplicate, err := store.RecordAction(run.RunID, action); err != nil || duplicate {
		t.Fatalf("first action duplicate=%v err=%v", duplicate, err)
	}
	if _, duplicate, err := store.RecordAction(run.RunID, action); err != nil || !duplicate {
		t.Fatalf("retry duplicate=%v err=%v", duplicate, err)
	}
	if _, _, err := store.RecordAction(run.RunID, ActionRequest{Type: "report_progress", ExpectedStateVersion: 0, IdempotencyKey: "late"}); !errors.Is(err, ErrRunNotActive) {
		t.Fatalf("waiting mutation = %v, want inactive", err)
	}
}
