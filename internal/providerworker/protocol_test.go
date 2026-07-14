package providerworker

import (
	"testing"
	"time"
)

func TestPersistentWorkerCommandRejectsReplayMutationAndExpiredDeadline(t *testing.T) {
	root := t.TempDir()
	executions := 0
	input := map[string]any{"commandId": "cmd-1", "deadline": time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), "value": "original"}
	execute := func() (map[string]any, error) {
		executions++
		return map[string]any{"execution": executions}, nil
	}
	first, err := persistentWorkerCommand(root, "lease_recheck", input, execute)
	if err != nil || first["execution"] != 1 {
		t.Fatalf("first=%v err=%v", first, err)
	}
	second, err := persistentWorkerCommand(root, "lease_recheck", input, execute)
	if err != nil || second["execution"].(float64) != 1 || executions != 1 {
		t.Fatalf("replay=%v executions=%d err=%v", second, executions, err)
	}
	mutated := map[string]any{"commandId": "cmd-1", "deadline": input["deadline"], "value": "changed"}
	if _, err := persistentWorkerCommand(root, "lease_recheck", mutated, execute); err == nil {
		t.Fatal("mutated replay was accepted")
	}
	expired := map[string]any{"commandId": "cmd-expired", "deadline": time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano)}
	if _, err := persistentWorkerCommand(root, "lease_recheck", expired, execute); err == nil || executions != 1 {
		t.Fatalf("expired err=%v executions=%d", err, executions)
	}
}

func TestPersistentWorkerLeaseEpochMustAdvanceAndReset(t *testing.T) {
	root := t.TempDir()
	run := func(command, id string, epoch int64) error {
		_, err := persistentWorkerCommand(root, command, map[string]any{"commandId": id, "leaseId": "lease-1", "leaseEpoch": epoch, "deadline": time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)}, func() (map[string]any, error) { return map[string]any{"ok": true}, nil })
		return err
	}
	if err := run("provision_lease", "cmd-provision", 1); err != nil {
		t.Fatal(err)
	}
	if err := run("renew_lease_epoch", "cmd-renew-stale", 1); err == nil {
		t.Fatal("stale renewal was accepted")
	}
	if err := run("renew_lease_epoch", "cmd-renew", 2); err != nil {
		t.Fatal(err)
	}
	if err := run("reset_lease", "cmd-reset-stale", 1); err == nil {
		t.Fatal("stale reset was accepted")
	}
	if err := run("reset_lease", "cmd-reset", 2); err != nil {
		t.Fatal(err)
	}
	if err := run("provision_lease", "cmd-provision-next", 3); err != nil {
		t.Fatal(err)
	}
}
