package agent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/ipfs"
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

const systemPrompt = `You are a resource listing review agent for an agent capability marketplace.
Review the resource listing and decide whether to APPROVE or REJECT it.

REJECT if any of the following apply:
- Prohibited items: weapons, drugs, explosives, stolen goods, counterfeit currency
- Fraudulent or misleading description that does not match the provided metadata
- Pornographic, sexually explicit, or excessively violent content
- Personal data, accounts, or credentials being sold
- Items that violate intellectual property laws (clear counterfeits)
- Empty, nonsensical, or spam resource listings
- Price seems unreasonable for the described resource (potential scam)

APPROVE if the listing is a legitimate compute, runtime, storage, repository, project, or dataset resource with a reasonable description.

Respond with ONLY a JSON object (no markdown, no extra text):
{"approved": true, "reason": "brief explanation"}
or
{"approved": false, "reason": "brief explanation"}`

// ReviewAgent performs LLM-based product listing reviews.
type ReviewAgent struct {
	llm        *OpenAICompatibleClient
	ipfsClient *ipfs.Client
}

// NewReviewAgent creates a new ReviewAgent.
func NewReviewAgent(baseURL, apiKey, model string, ipfsClient *ipfs.Client) *ReviewAgent {
	return NewReviewAgentWithConfig(LLMClientConfig{
		BaseURL:                 baseURL,
		APIKey:                  apiKey,
		WireAPI:                 LLMWireChatCompletions,
		ResearchModel:           model,
		UtilityModel:            model,
		ResearchReasoningEffort: "high",
		UtilityReasoningEffort:  "low",
	}, ipfsClient)
}

func NewReviewAgentWithConfig(cfg LLMClientConfig, ipfsClient *ipfs.Client) *ReviewAgent {
	return &ReviewAgent{
		llm:        NewOpenAICompatibleClient(cfg),
		ipfsClient: ipfsClient,
	}
}

// Review performs an LLM review of the given product listing.
func (a *ReviewAgent) Review(ctx context.Context, req ReviewRequest) (ReviewResult, error) {
	if !a.Configured() {
		return devReview(req), nil
	}

	// Build user content parts
	content := []map[string]any{
		{
			"type": "text",
			"text": fmt.Sprintf("Product: %s\nCategory: %s\nPrice: %s\nDescription: %s",
				req.Title, req.Category, req.Price, req.Description),
		},
	}

	// Fetch images from IPFS and encode as base64
	if a.ipfsClient != nil {
		for _, cid := range req.ImageCIDs {
			rc, err := a.ipfsClient.Cat(cid)
			if err != nil {
				continue // skip images that fail to fetch
			}
			data, err := io.ReadAll(io.LimitReader(rc, 10<<20))
			rc.Close()
			if err != nil {
				continue
			}
			b64 := base64.StdEncoding.EncodeToString(data)
			content = append(content, map[string]any{
				"type": "image_url",
				"image_url": map[string]string{
					"url": "data:image/jpeg;base64," + b64,
				},
			})
		}
	}

	raw, err := a.llm.Generate(ctx, systemPrompt, content, LLMRequestOptions{
		Profile:        LLMProfileResearch,
		MaxTokens:      256,
		ResponseFormat: JSONResponseFormat(),
	})
	if err != nil {
		return ReviewResult{}, fmt.Errorf("agent: llm request: %w", err)
	}

	raw = strings.TrimSpace(raw)
	// Strip markdown code fences if present
	raw = strings.TrimPrefix(raw, "```json")
	raw = strings.TrimPrefix(raw, "```")
	raw = strings.TrimSuffix(raw, "```")
	raw = strings.TrimSpace(raw)

	var result struct {
		Approved bool   `json:"approved"`
		Reason   string `json:"reason"`
	}
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return ReviewResult{}, fmt.Errorf("agent: parse llm json: %w (raw: %s)", err, raw)
	}

	return ReviewResult{
		Approved:  result.Approved,
		Reason:    result.Reason,
		Timestamp: time.Now().Unix(),
	}, nil
}

// Configured reports whether the agent has LLM credentials configured.
func (a *ReviewAgent) Configured() bool {
	return a != nil && a.llm.Enabled()
}

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
