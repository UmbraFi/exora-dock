package wallet

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func TestEncryptedAccountWalletCreateUnlockAndRestore(t *testing.T) {
	password := "correct horse battery staple"
	store := NewStore(t.TempDir())

	created, err := store.Create(CreateRequest{RecoveryPassword: password})
	if err != nil {
		t.Fatalf("create wallet: %v", err)
	}
	if !created.Configured || !created.AccountBound || !created.Unlocked || created.BoundOnly {
		t.Fatalf("unexpected created status: %#v", created)
	}
	if created.Address == "" || created.BackupStatus != "encrypted_local" {
		t.Fatalf("wallet was not encrypted/backed up locally: %#v", created)
	}
	if _, err := os.Stat(store.KeypairPath()); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("plaintext keypair should not be written, stat err=%v", err)
	}
	backup, err := store.Backup()
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if backup.PublicKey != created.Address || backup.Data == "" || backup.KDF.Salt == "" {
		t.Fatalf("invalid backup metadata: %#v", backup)
	}

	cold := NewStore(store.dir)
	current, err := cold.Current()
	if err != nil {
		t.Fatalf("current: %v", err)
	}
	if current.Unlocked {
		t.Fatalf("cold store should start locked: %#v", current)
	}
	if _, _, err := cold.SignPayload([]byte("payload")); err == nil || !strings.Contains(err.Error(), "wallet locked") {
		t.Fatalf("expected wallet locked signing error, got %v", err)
	}
	if _, err := cold.Unlock(UnlockRequest{RecoveryPassword: "wrong password"}); err == nil {
		t.Fatalf("wrong recovery password should fail")
	}
	unlocked, err := cold.Unlock(UnlockRequest{RecoveryPassword: password})
	if err != nil {
		t.Fatalf("unlock: %v", err)
	}
	if !unlocked.Unlocked || unlocked.Address != created.Address {
		t.Fatalf("unexpected unlocked status: %#v", unlocked)
	}
	address, signature, err := cold.SignPayload([]byte("payload"))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if address != created.Address || signature == "" {
		t.Fatalf("unexpected signature result address=%q sig=%q", address, signature)
	}

	restoredStore := NewStore(t.TempDir())
	if _, err := restoredStore.Restore(RestoreRequest{RecoveryPassword: "wrong password", Backup: backup}); err == nil {
		t.Fatalf("restore with wrong password should fail")
	}
	restored, err := restoredStore.Restore(RestoreRequest{RecoveryPassword: password, Backup: backup})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if !restored.AccountBound || !restored.Unlocked || restored.Address != created.Address {
		t.Fatalf("unexpected restored status: %#v", restored)
	}
}
