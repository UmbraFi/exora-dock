package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/UmbraFi/Umbra_SVR/internal/ipfs"
)

// ReviewRequest is the product listing review request from PWA.
type ReviewRequest struct {
	ProductID   string   `json:"product_id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	Price       string   `json:"price"`
	ImageCIDs   []string `json:"image_cids"`
	SellerPubkey string  `json:"seller_pubkey"`
}

// ReviewResult is a single node's vote on a review request.
type ReviewResult struct {
	Approved    bool   `json:"approved"`
	Reason      string `json:"reason"`
	MinerPubkey string `json:"miner_pubkey"`
	Timestamp   int64  `json:"timestamp"`
}

const systemPrompt = `You are a product listing review agent for a decentralized marketplace.
Review the product listing and decide whether to APPROVE or REJECT it.

REJECT if any of the following apply:
- Prohibited items: weapons, drugs, explosives, stolen goods, counterfeit currency
- Fraudulent or misleading description that does not match the images
- Pornographic, sexually explicit, or excessively violent content
- Personal data, accounts, or credentials being sold
- Items that violate intellectual property laws (clear counterfeits)
- Empty, nonsensical, or spam listings
- Price seems unreasonable for the described item (potential scam)

APPROVE if the listing is a legitimate product with a reasonable description and appropriate images.

Respond with ONLY a JSON object (no markdown, no extra text):
{"approved": true, "reason": "brief explanation"}
or
{"approved": false, "reason": "brief explanation"}`

// ReviewAgent performs LLM-based product listing reviews.
type ReviewAgent struct {
	httpClient *http.Client
	baseURL    string
	apiKey     string
	model      string
	ipfsClient *ipfs.Client
}

// NewReviewAgent creates a new ReviewAgent.
func NewReviewAgent(baseURL, apiKey, model string, ipfsClient *ipfs.Client) *ReviewAgent {
	return &ReviewAgent{
		httpClient: &http.Client{Timeout: 60 * time.Second},
		baseURL:    strings.TrimRight(baseURL, "/"),
		apiKey:     apiKey,
		model:      model,
		ipfsClient: ipfsClient,
	}
}

// Review performs an LLM review of the given product listing.
func (a *ReviewAgent) Review(ctx context.Context, req ReviewRequest) (ReviewResult, error) {
	// Build user content parts
	content := []map[string]any{
		{
			"type": "text",
			"text": fmt.Sprintf("Product: %s\nCategory: %s\nPrice: %s\nDescription: %s",
				req.Title, req.Category, req.Price, req.Description),
		},
	}

	// Fetch images from IPFS and encode as base64
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

	body := map[string]any{
		"model": a.model,
		"messages": []map[string]any{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": content},
		},
		"max_tokens": 256,
	}

	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return ReviewResult{}, fmt.Errorf("agent: marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", a.baseURL+"/chat/completions", bytes.NewReader(bodyJSON))
	if err != nil {
		return ReviewResult{}, fmt.Errorf("agent: new request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+a.apiKey)

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return ReviewResult{}, fmt.Errorf("agent: llm request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return ReviewResult{}, fmt.Errorf("agent: llm status %d: %s", resp.StatusCode, b)
	}

	var llmResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&llmResp); err != nil {
		return ReviewResult{}, fmt.Errorf("agent: decode llm response: %w", err)
	}

	if len(llmResp.Choices) == 0 {
		return ReviewResult{}, fmt.Errorf("agent: no choices in llm response")
	}

	raw := strings.TrimSpace(llmResp.Choices[0].Message.Content)
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
	return a.baseURL != "" && a.apiKey != ""
}
