package agentcard

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cloudlink"
)

type CloudPublisher struct {
	CloudURL  string
	TokenPath string
	DockID    string
	Client    *http.Client
}

type PublishResult struct {
	Card           AgentCard     `json:"card"`
	CloudPublished bool          `json:"cloudPublished"`
	CloudStatus    int           `json:"cloudStatus,omitempty"`
	CloudMessage   string        `json:"cloudMessage,omitempty"`
	Review         *ReviewResult `json:"review,omitempty"`
}

type PublishError struct {
	StatusCode int
	Message    string
	Review     *ReviewResult
}

func (e *PublishError) Error() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Message) != "" {
		return e.Message
	}
	return "cloud publish failed"
}

func (p CloudPublisher) Publish(ctx context.Context, card AgentCard) (PublishResult, error) {
	card, err := PrepareForPublish(card)
	if err != nil {
		return PublishResult{}, err
	}
	cloudURL := strings.TrimRight(strings.TrimSpace(p.CloudURL), "/")
	if cloudURL == "" {
		return PublishResult{}, fmt.Errorf("cloud_url required before publishing")
	}
	tokenFile, err := cloudlink.LoadToken(p.TokenPath)
	if err != nil {
		return PublishResult{}, fmt.Errorf("cloud link required before publishing: %w", err)
	}
	dockID := strings.TrimSpace(p.DockID)
	if dockID == "" {
		dockID = tokenFile.DockID
	}
	if dockID == "" {
		dockID = card.DockID
	}
	if dockID == "" {
		return PublishResult{}, fmt.Errorf("dockId required before publishing")
	}
	card.DockID = dockID
	card, err = PrepareForPublish(card)
	if err != nil {
		return PublishResult{}, err
	}
	body, err := json.Marshal(card)
	if err != nil {
		return PublishResult{}, err
	}
	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	endpoint := cloudURL + "/v1/docks/" + url.PathEscape(dockID) + "/agent-cards/" + url.PathEscape(string(card.Role))
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, bytes.NewReader(body))
	if err != nil {
		return PublishResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+tokenFile.CloudToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return PublishResult{}, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	envelope := parseCloudPublishEnvelope(data)
	if resp.StatusCode == http.StatusAccepted {
		return PublishResult{
				CloudStatus:  resp.StatusCode,
				CloudMessage: strings.TrimSpace(string(data)),
				Review:       envelope.review(),
			}, &PublishError{
				StatusCode: resp.StatusCode,
				Message:    firstNonEmpty(envelope.Error, "agent card pending review"),
				Review:     envelope.review(),
			}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return PublishResult{}, &PublishError{
			StatusCode: resp.StatusCode,
			Message:    firstNonEmpty(envelope.Error, fmt.Sprintf("cloud publish returned %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))),
			Review:     envelope.review(),
		}
	}
	if review := envelope.review(); review != nil {
		card.Review = review
	}
	return PublishResult{
		Card:           card,
		CloudPublished: true,
		CloudStatus:    resp.StatusCode,
		CloudMessage:   strings.TrimSpace(string(data)),
		Review:         card.Review,
	}, nil
}

type cloudPublishEnvelope struct {
	Error  string        `json:"error"`
	Review *ReviewResult `json:"review"`
	Card   struct {
		Review *ReviewResult `json:"review"`
	} `json:"card"`
}

func parseCloudPublishEnvelope(data []byte) cloudPublishEnvelope {
	var envelope cloudPublishEnvelope
	_ = json.Unmarshal(data, &envelope)
	return envelope
}

func (e cloudPublishEnvelope) review() *ReviewResult {
	if e.Review != nil && e.Review.Status != "" {
		return e.Review
	}
	if e.Card.Review != nil && e.Card.Review.Status != "" {
		return e.Card.Review
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
