package payment

import (
	"testing"

	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/cache"
)

func TestChainIntentDerivesEscrowPDAAndAppliesEvidence(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	store := NewStore(c)
	a := approval.Approval{
		ID:              "appr-1",
		TaskID:          "task-1",
		UserPubkey:      "buyer-wallet",
		ProviderPubkey:  "seller-wallet",
		Amount:          approval.Amount{Value: 2, Currency: "lamports"},
		PaymentRequired: true,
	}
	record, intent, err := store.EnsureChainIntent(a, ChainIntentRequest{
		ProgramID:   "11111111111111111111111111111111",
		Network:     "devnet",
		OrderPlanID: "plan-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if intent.EscrowPDA == "" || intent.CanonicalIntentHash == "" || intent.AmountLamports != 2 {
		t.Fatalf("unexpected intent: %#v", intent)
	}
	if record.Status != StatusChainIntentCreated || record.EvidenceStatus != EvidencePendingChainConfirmation {
		t.Fatalf("unexpected record: %#v", record)
	}
	confirmed, err := store.ApplyEvidence(PaymentEvidence{
		EvidenceID:     "pevd-1",
		PaymentID:      record.ID,
		Status:         EvidenceFoundFinalized,
		Chain:          "solana",
		Network:        "devnet",
		ProgramID:      intent.ProgramID,
		EscrowPDA:      intent.EscrowPDA,
		BuyerPubkey:    "buyer-wallet",
		SellerPubkey:   "seller-wallet",
		AmountLamports: 2,
		Finality:       "finalized",
		Slot:           42,
	})
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Status != StatusChainConfirmed || confirmed.EvidenceStatus != EvidenceFoundFinalized {
		t.Fatalf("unexpected confirmed record: %#v", confirmed)
	}
}

func TestEvidenceMismatchDoesNotMarkPaid(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	store := NewStore(c)
	a := approval.Approval{
		ID:              "appr-2",
		TaskID:          "task-2",
		UserPubkey:      "buyer-wallet",
		ProviderPubkey:  "seller-wallet",
		Amount:          approval.Amount{Value: 1, Currency: "lamports"},
		PaymentRequired: true,
	}
	record, _, err := store.EnsureChainIntent(a, ChainIntentRequest{ProgramID: "11111111111111111111111111111111"})
	if err != nil {
		t.Fatal(err)
	}
	mismatched, err := store.ApplyEvidence(PaymentEvidence{
		PaymentID:      record.ID,
		Status:         EvidenceFoundFinalized,
		EscrowPDA:      "different",
		AmountLamports: 1,
	})
	if err == nil {
		t.Fatalf("expected mismatch error")
	}
	if mismatched.Status != StatusEvidenceMismatch || mismatched.EvidenceStatus != EvidenceMismatch {
		t.Fatalf("mismatch was marked paid: %#v", mismatched)
	}
}
