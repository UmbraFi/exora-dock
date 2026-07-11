package runcapability

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestCapabilityIsBoundToRunRoleActionAndWorkspace(t *testing.T) {
	m := NewEphemeral([]byte("test-secret-with-at-least-thirty-two-bytes"))
	root := t.TempDir()
	token, _, err := m.Issue(Claims{
		RunID: "run-1", TransactionID: "tx-1", Role: "seller",
		Actions: []string{"get_transaction_state", "report_progress"}, Workspace: root, LeaseEpoch: 4,
	}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Verify(token, Requirement{RunID: "run-1", TransactionID: "tx-1", Role: "seller", Action: "report_progress", Workspace: filepath.Join(root, "child")}); err != nil {
		t.Fatalf("valid capability rejected: %v", err)
	}
	for _, req := range []Requirement{
		{RunID: "run-2"},
		{TransactionID: "tx-2"},
		{Role: "buyer"},
		{Action: "submit_payment"},
		{LeaseEpoch: 5},
		{Workspace: filepath.Join(filepath.Dir(root), "outside")},
	} {
		if _, err := m.Verify(token, req); !errors.Is(err, ErrForbidden) {
			t.Fatalf("requirement %#v: got %v, want forbidden", req, err)
		}
	}
}

func TestCapabilityExpiryAndRevocation(t *testing.T) {
	m := NewEphemeral([]byte("test-secret-with-at-least-thirty-two-bytes"))
	now := time.Unix(1000, 0).UTC()
	m.now = func() time.Time { return now }
	token, _, err := m.Issue(Claims{RunID: "run", TransactionID: "tx", Role: "buyer", Actions: []string{"*"}}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Revoke(token); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Verify(token, Requirement{}); !errors.Is(err, ErrRevoked) {
		t.Fatalf("got %v, want revoked", err)
	}
	token, _, _ = m.Issue(Claims{RunID: "run", TransactionID: "tx", Role: "buyer", Actions: []string{"read"}}, time.Minute)
	now = now.Add(2 * time.Minute)
	if _, err := m.Verify(token, Requirement{}); !errors.Is(err, ErrExpired) {
		t.Fatalf("got %v, want expired", err)
	}
}

func TestPersistentCapabilityStateCanBeUpdatedAndReloaded(t *testing.T) {
	path := filepath.Join(t.TempDir(), "run-capabilities.json")
	manager, err := LoadOrCreate(path)
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := manager.Issue(Claims{RunID: "run", TransactionID: "tx", Role: "seller", Actions: []string{"report_progress"}}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Revoke(token); err != nil {
		t.Fatal(err)
	}
	reloaded, err := LoadOrCreate(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reloaded.Verify(token, Requirement{}); !errors.Is(err, ErrRevoked) {
		t.Fatalf("reloaded capability = %v, want revoked", err)
	}
}
