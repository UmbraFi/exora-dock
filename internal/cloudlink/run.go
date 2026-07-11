package cloudlink

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
)

type RunEvent struct {
	Type                 string         `json:"type"`
	TransactionID        string         `json:"transactionId"`
	Role                 string         `json:"role"`
	ExpectedStateVersion int64          `json:"expectedStateVersion"`
	IdempotencyKey       string         `json:"idempotencyKey"`
	Driver               string         `json:"driver,omitempty"`
	VendorThreadID       string         `json:"vendorThreadId,omitempty"`
	VendorTurnID         string         `json:"vendorTurnId,omitempty"`
	Progress             map[string]any `json:"progress,omitempty"`
	Outcome              string         `json:"outcome,omitempty"`
	NextAction           string         `json:"nextAction,omitempty"`
	TargetRole           string         `json:"targetRole,omitempty"`
	RetryAt              *time.Time     `json:"retryAt,omitempty"`
	Reason               string         `json:"reason,omitempty"`
}

type RunReporter struct {
	CloudURL  string
	TokenPath string
	Client    *http.Client
}

func (r RunReporter) Report(ctx context.Context, runID string, event RunEvent) error {
	token, err := LoadToken(r.TokenPath)
	if err != nil {
		return err
	}
	base := strings.TrimRight(firstRunValue(r.CloudURL, token.CloudURL), "/")
	if base == "" {
		return fmt.Errorf("Cloud URL missing")
	}
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v2/automation-runs/"+url.PathEscape(runID)+"/events", bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token.CloudToken))
	req.Header.Set("Content-Type", "application/json")
	client := r.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Cloud run event returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func firstRunValue(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
