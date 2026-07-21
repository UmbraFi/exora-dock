package sellerdraft

import (
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

func TestSellerDraftStoreAndVaultAreAccountScoped(t *testing.T) {
	dataDir := t.TempDir()
	c, err := cache.New(100, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	storeA, storeB := NewStore(c, "account_a"), NewStore(c, "account_b")
	draft := APIDraft{APIID: "api_scoped", Version: 1, Title: "Only A", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
	if err := storeA.SaveAPIDraft(draft); err != nil {
		t.Fatal(err)
	}
	if _, found := storeB.APIDraft(draft.APIID); found || len(storeB.APIDrafts()) != 0 {
		t.Fatal("account B can read account A's API draft")
	}
	if value, found := storeA.APIDraft(draft.APIID); !found || value.Title != "Only A" {
		t.Fatal("account A lost its scoped API draft")
	}
	vaultA, vaultB := NewCredentialVault(dataDir, "account_a"), NewCredentialVault(dataDir, "account_b")
	credential, err := vaultA.Put(CredentialMetadata{Label: "Only A", AuthType: "bearer"}, "secret-a")
	if err != nil {
		t.Fatal(err)
	}
	if values, err := vaultB.List(); err != nil || len(values) != 0 {
		t.Fatalf("account B can list account A credentials: %#v err=%v", values, err)
	}
	if _, _, err := vaultB.Resolve(credential.CredentialRef, ""); err == nil {
		t.Fatal("account B can resolve account A credential")
	}
}
