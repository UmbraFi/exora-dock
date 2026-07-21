package localauth

import (
	"path/filepath"
	"testing"
	"time"
)

func TestAgentSessionsAreHashedScopedAndExpire(t *testing.T) {
	now := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)
	store := newStore("", Tokens{OwnerToken: "owner"})
	store.now = func() time.Time { return now }
	first, firstKey, err := store.CreateSession("Codex", []string{"market.read", "api.invoke"})
	if err != nil {
		t.Fatal(err)
	}
	_, secondKey, err := store.CreateSession("Codex", nil)
	if err != nil {
		t.Fatal(err)
	}
	if firstKey == secondKey || firstKey == string(first.TokenHash[:]) {
		t.Fatal("MCP sessions did not receive distinct hashed credentials")
	}
	if !store.SessionPermits(firstKey, "api.invoke") || store.SessionPermits(firstKey, "provider.publish") {
		t.Fatal("session scope boundary was not enforced")
	}
	now = now.Add(DefaultSessionIdle + time.Second)
	if _, ok := store.SessionForToken(firstKey); ok {
		t.Fatal("idle session remained valid")
	}
	if len(store.ListSessions()) != 0 {
		t.Fatal("expired sessions remained listed")
	}
}

func TestSessionPolicyPersistsWithoutPersistingSessions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.json")
	store, err := LoadOrCreate(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetSessionPolicy([]string{"market.read", "api.invoke"}); err != nil {
		t.Fatal(err)
	}
	_, _, _ = store.CreateSession("Agent", nil)
	reloaded, err := LoadOrCreate(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.SessionPolicy(); len(got) != 2 || got[0] != "market.read" || got[1] != "api.invoke" {
		t.Fatalf("session policy was not restored: %v", got)
	}
	if len(reloaded.ListSessions()) != 0 {
		t.Fatal("ephemeral Agent sessions were persisted")
	}
}

func TestRetiredAgentScopesAreRejectedAndDiscarded(t *testing.T) {
	store := newStore("", Tokens{OwnerToken: "owner", SessionPolicyConfigured: true, DefaultSessionScopes: []string{"compute.use", "resources.use", "api.invoke"}})
	if got := store.SessionPolicy(); len(got) != 1 || got[0] != "api.invoke" {
		t.Fatalf("retired persisted scopes survived V4 load: %v", got)
	}
	for _, scope := range []string{"provider.publish", "owner.credentials", "admin"} {
		if _, _, err := store.CreateSession("Agent", []string{scope}); err == nil {
			t.Fatalf("retired scope %q was accepted", scope)
		}
	}
}

func TestAccountKeyIsMemoryOnlyAndLogoutRevokesSessions(t *testing.T) {
	store := newStore("", Tokens{OwnerToken: "owner"})
	_, sessionKey, _ := store.CreateSession("Agent", nil)
	if err := store.SetAccountKey("acct", "sk-exora-1234"); err != nil {
		t.Fatal(err)
	}
	store.LockAccount()
	if _, _, ok := store.AccountKey(); ok {
		t.Fatal("account key survived local logout")
	}
	if _, ok := store.SessionForToken(sessionKey); ok {
		t.Fatal("Agent session survived local logout")
	}
}
