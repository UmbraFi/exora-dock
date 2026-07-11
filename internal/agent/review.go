package agent

import (
	"context"
	"strings"
	"time"
)

// ReviewRequest is the product listing review request from PWA.
type ReviewRequest struct {
	ProductID    string   `json:"product_id"`
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	Category     string   `json:"category"`
	Price        string   `json:"price"`
	ImageCIDs    []string `json:"image_cids"`
	SellerPubkey string   `json:"seller_pubkey"`
}

// ReviewResult is a single node's vote on a review request.
type ReviewResult struct {
	Approved    bool   `json:"approved"`
	Reason      string `json:"reason"`
	MinerPubkey string `json:"miner_pubkey"`
	Timestamp   int64  `json:"timestamp"`
}

// ReviewAgent applies local deterministic listing rules. Executable model
// automation is provided separately through a user-installed local driver.
type ReviewAgent struct{}

// NewReviewAgent accepts ignored legacy arguments so older embedding callers
// can upgrade without reintroducing provider credentials.
func NewReviewAgent(_ ...any) *ReviewAgent { return &ReviewAgent{} }

func (a *ReviewAgent) Review(ctx context.Context, req ReviewRequest) (ReviewResult, error) {
	_ = ctx
	return devReview(req), nil
}

func (a *ReviewAgent) Configured() bool { return a != nil }

func devReview(req ReviewRequest) ReviewResult {
	approved := true
	reason := "Dev review approved by local deterministic rules."
	text := strings.ToLower(strings.TrimSpace(req.Title + " " + req.Description))

	switch {
	case strings.TrimSpace(req.Description) == "":
		approved = false
		reason = "Description is required."
	case len(req.ImageCIDs) == 0 && !isAgentResourceCategory(req.Category):
		approved = false
		reason = "At least one product image is required."
	default:
		blocked := []string{
			"weapon",
			"gun",
			"explosive",
			"stolen",
			"counterfeit currency",
			"passport",
			"password",
			"credential",
			"drug",
			"cocaine",
			"heroin",
		}
		for _, term := range blocked {
			if strings.Contains(text, term) {
				approved = false
				reason = "Listing contains prohibited or high-risk terms: " + term
				break
			}
		}
	}

	return ReviewResult{
		Approved:  approved,
		Reason:    reason,
		Timestamp: time.Now().Unix(),
	}
}

func isAgentResourceCategory(category string) bool {
	switch strings.ToLower(strings.TrimSpace(category)) {
	case "vps", "gpu", "dataset", "repository", "project", "storage":
		return true
	default:
		return false
	}
}
