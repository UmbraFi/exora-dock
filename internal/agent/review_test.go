package agent

import (
	"context"
	"testing"
)

func TestDevReviewFallbackApprovesValidListing(t *testing.T) {
	agent := NewReviewAgent("", "", "", nil)

	result, err := agent.Review(context.Background(), ReviewRequest{
		ProductID:    "p1",
		Title:        "Mechanical keyboard",
		Description:  "Mechanical keyboard in good condition",
		Category:     "Electronics",
		Price:        "1.2",
		ImageCIDs:    []string{"local-photo"},
		SellerPubkey: "seller",
	})
	if err != nil {
		t.Fatalf("Review() error = %v", err)
	}
	if !result.Approved {
		t.Fatalf("Approved = false, reason = %q", result.Reason)
	}
}

func TestDevReviewFallbackRejectsMissingImages(t *testing.T) {
	agent := NewReviewAgent("", "", "", nil)

	result, err := agent.Review(context.Background(), ReviewRequest{
		ProductID:    "p1",
		Title:        "Mechanical keyboard",
		Description:  "Mechanical keyboard in good condition",
		Category:     "Electronics",
		Price:        "1.2",
		SellerPubkey: "seller",
	})
	if err != nil {
		t.Fatalf("Review() error = %v", err)
	}
	if result.Approved {
		t.Fatal("Approved = true, want rejection")
	}
}
