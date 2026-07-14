package paymentpin

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSetStatusAndVerifyPaymentPIN(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "payment-pin.json"))
	status, err := store.Status()
	if err != nil {
		t.Fatal(err)
	}
	if status.Configured {
		t.Fatalf("status configured before set")
	}
	if _, err := store.Set("12345"); err == nil {
		t.Fatalf("Set accepted short pin")
	}
	if _, err := store.Set("123456"); err != nil {
		t.Fatalf("Set error = %v", err)
	}
	raw, err := os.ReadFile(store.Path())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "123456") {
		t.Fatalf("pin file contains plaintext pin: %s", string(raw))
	}
	if err := store.Verify("000000"); err == nil {
		t.Fatalf("wrong pin verified")
	}
	if err := store.Verify("123456"); err != nil {
		t.Fatalf("Verify error = %v", err)
	}
}

func TestPaymentPINBindsToAccount(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "payment-pin.json"))
	status, err := store.SetForAccount("654321", "acct_one")
	if err != nil {
		t.Fatal(err)
	}
	if status.BoundAccountID != "acct_one" {
		t.Fatalf("bound account = %q", status.BoundAccountID)
	}
	if err := store.VerifyForAccount("654321", "acct_one"); err != nil {
		t.Fatalf("same-account verification: %v", err)
	}
	if err := store.VerifyForAccount("654321", "acct_two"); err == nil || err.Error() != "payment_pin_account_mismatch" {
		t.Fatalf("different-account verification error = %v", err)
	}
	if _, err := store.Set("123456"); err != nil {
		t.Fatal(err)
	}
	if err := store.VerifyForAccount("123456", "acct_one"); err == nil || err.Error() != "payment_pin_needs_account_binding" {
		t.Fatalf("legacy/unbound verification error = %v", err)
	}
}
