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

type WakeJob struct {
	JobID                string         `json:"jobId"`
	RunID                string         `json:"runId"`
	TargetDockID         string         `json:"targetDockId"`
	TransactionID        string         `json:"transactionId"`
	Role                 string         `json:"role"`
	TriggerEventID       string         `json:"triggerEventId"`
	ExpectedStateVersion int64          `json:"expectedVersion"`
	LeaseEpoch           int64          `json:"leaseEpoch"`
	LeaseUntil           string         `json:"leaseUntil"`
	Attempt              int            `json:"attempt"`
	Deadline             string         `json:"deadline,omitempty"`
	PermissionProfile    string         `json:"permissionProfile,omitempty"`
	Workspace            string         `json:"workspace,omitempty"`
	Prompt               string         `json:"prompt,omitempty"`
	Payload              map[string]any `json:"payload,omitempty"`
}

func (j *WakeJob) UnmarshalJSON(data []byte) error {
	type wakeAlias WakeJob
	var wire struct {
		wakeAlias
		CompatibleExpectedStateVersion *int64 `json:"expectedStateVersion"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	*j = WakeJob(wire.wakeAlias)
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(data, &fields)
	_, canonicalPresent := fields["expectedVersion"]
	if !canonicalPresent && wire.CompatibleExpectedStateVersion != nil {
		j.ExpectedStateVersion = *wire.CompatibleExpectedStateVersion
	}
	return nil
}

type WakeResult struct {
	RunID          string `json:"runId"`
	VendorThreadID string `json:"vendorThreadId,omitempty"`
	VendorTurnID   string `json:"vendorTurnId,omitempty"`
	Status         string `json:"status"`
}

func (j WakeJob) AllowedActions() ([]string, bool) {
	raw, ok := j.Payload["allowedActions"]
	if !ok {
		return nil, false
	}
	values := make([]string, 0)
	switch typed := raw.(type) {
	case []string:
		values = append(values, typed...)
	case []any:
		for _, value := range typed {
			if text, ok := value.(string); ok {
				values = append(values, text)
			}
		}
	}
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out, true
}

type WakeHandler interface {
	HandleWake(context.Context, WakeJob) (WakeResult, error)
}

type WakeHandlerFunc func(context.Context, WakeJob) (WakeResult, error)

func (f WakeHandlerFunc) HandleWake(ctx context.Context, job WakeJob) (WakeResult, error) {
	return f(ctx, job)
}

// WakePoller is the only Cloud-to-Dock execution channel in V2. It accepts a
// typed WakeJob and never proxies an arbitrary HTTP method/path or injects the
// local owner token.
type WakePoller struct {
	CloudURL     string
	DockID       string
	WorkerID     string
	TokenPath    string
	PollInterval time.Duration
	LeaseTTL     time.Duration
	HTTPClient   *http.Client
	Handler      WakeHandler
}

func (p WakePoller) Run(ctx context.Context) {
	interval := p.PollInterval
	if interval <= 0 {
		interval = 3 * time.Second
	}
	client := p.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 35 * time.Second}
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		_, _ = p.RunOnce(ctx, client)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (p WakePoller) RunOnce(ctx context.Context, client *http.Client) (bool, error) {
	if p.Handler == nil {
		return false, fmt.Errorf("wake handler required")
	}
	if client == nil {
		client = &http.Client{Timeout: 35 * time.Second}
	}
	job, found, err := p.claim(ctx, client)
	if err != nil {
		if found && strings.TrimSpace(job.JobID) != "" {
			_ = p.fail(ctx, client, job, err)
		}
		return found, err
	}
	if !found {
		return false, nil
	}
	if target := strings.TrimSpace(job.TargetDockID); target != "" && target != strings.TrimSpace(p.DockID) {
		err := fmt.Errorf("wake job targets dock %q, not %q", target, strings.TrimSpace(p.DockID))
		_ = p.fail(ctx, client, job, err)
		return true, err
	}
	if deadline := strings.TrimSpace(job.Deadline); deadline != "" {
		at, err := time.Parse(time.RFC3339Nano, deadline)
		if err != nil || !at.After(time.Now().UTC()) {
			err := fmt.Errorf("wake job deadline is invalid or expired")
			_ = p.fail(ctx, client, job, err)
			return true, err
		}
	}
	handlerCtx, cancelHandler := context.WithCancel(ctx)
	done := make(chan struct{})
	renewStopped := make(chan struct{})
	renewErrors := make(chan error, 1)
	go func() {
		defer close(renewStopped)
		if err := p.renewLoop(handlerCtx, client, job, done); err != nil {
			renewErrors <- err
			cancelHandler()
		}
	}()
	result, handleErr := p.Handler.HandleWake(handlerCtx, job)
	close(done)
	cancelHandler()
	<-renewStopped
	select {
	case renewErr := <-renewErrors:
		_ = p.fail(ctx, client, job, renewErr)
		return true, renewErr
	default:
	}
	if handleErr != nil {
		_ = p.fail(ctx, client, job, handleErr)
		return true, handleErr
	}
	if err := p.complete(ctx, client, job, result); err != nil {
		return true, err
	}
	return true, nil
}

func (p WakePoller) claim(ctx context.Context, client *http.Client) (WakeJob, bool, error) {
	endpoint := p.endpoint("/v2/docks/" + url.PathEscape(strings.TrimSpace(p.DockID)) + "/wake-jobs/claim")
	lease := p.LeaseTTL
	if lease <= 0 {
		lease = 60 * time.Second
	}
	var envelope struct {
		WakeJob *WakeJob `json:"wakeJob"`
		Job     *WakeJob `json:"job"`
	}
	status, body, err := p.do(ctx, client, http.MethodPost, endpoint, map[string]any{
		"workerId": firstNonEmpty(p.WorkerID, p.DockID), "leaseSeconds": durationSeconds(lease),
	})
	if err != nil {
		return WakeJob{}, false, err
	}
	if status == http.StatusNoContent || status == http.StatusNotFound {
		return WakeJob{}, false, nil
	}
	if status < 200 || status >= 300 {
		return WakeJob{}, false, fmt.Errorf("wake claim returned %d: %s", status, strings.TrimSpace(string(body)))
	}
	if err := json.Unmarshal(body, &envelope); err == nil {
		if envelope.WakeJob != nil {
			return validateWake(*envelope.WakeJob)
		}
		if envelope.Job != nil {
			return validateWake(*envelope.Job)
		}
	}
	var job WakeJob
	if err := json.Unmarshal(body, &job); err != nil {
		return WakeJob{}, false, fmt.Errorf("decode wake job: %w", err)
	}
	return validateWake(job)
}

func validateWake(job WakeJob) (WakeJob, bool, error) {
	job.JobID = strings.TrimSpace(job.JobID)
	job.RunID = strings.TrimSpace(job.RunID)
	job.TransactionID = strings.TrimSpace(job.TransactionID)
	job.Role = strings.ToLower(strings.TrimSpace(job.Role))
	if job.JobID == "" || job.RunID == "" || job.TransactionID == "" || job.ExpectedStateVersion < 0 || (job.Role != "buyer" && job.Role != "seller" && job.Role != "verifier") {
		return job, true, fmt.Errorf("invalid typed wake job")
	}
	return job, true, nil
}

func (p WakePoller) renewLoop(ctx context.Context, client *http.Client, job WakeJob, done <-chan struct{}) error {
	ttl := p.LeaseTTL
	if ttl <= 0 {
		ttl = 60 * time.Second
	}
	interval := ttl / 3
	if interval < time.Millisecond {
		interval = time.Millisecond
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-done:
			return nil
		case <-ticker.C:
			endpoint := p.jobEndpoint(job, "renew")
			status, body, err := p.do(ctx, client, http.MethodPost, endpoint, map[string]any{
				"workerId": firstNonEmpty(p.WorkerID, p.DockID), "leaseEpoch": job.LeaseEpoch, "leaseSeconds": durationSeconds(ttl),
			})
			select {
			case <-done:
				return nil
			default:
			}
			if err != nil {
				return fmt.Errorf("wake lease renew failed: %w", err)
			}
			if status < 200 || status >= 300 {
				return fmt.Errorf("wake lease renew returned %d: %s", status, strings.TrimSpace(string(body)))
			}
		}
	}
}

func durationSeconds(value time.Duration) int {
	if value <= 0 {
		return 1
	}
	seconds := int(value / time.Second)
	if value%time.Second != 0 {
		seconds++
	}
	if seconds < 1 {
		return 1
	}
	return seconds
}

func (p WakePoller) complete(ctx context.Context, client *http.Client, job WakeJob, result WakeResult) error {
	status, body, err := p.do(ctx, client, http.MethodPost, p.jobEndpoint(job, "complete"), map[string]any{
		"workerId": firstNonEmpty(p.WorkerID, p.DockID), "leaseEpoch": job.LeaseEpoch, "result": result,
	})
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("wake complete returned %d: %s", status, strings.TrimSpace(string(body)))
	}
	return nil
}

func (p WakePoller) fail(ctx context.Context, client *http.Client, job WakeJob, cause error) error {
	message := "wake failed"
	if cause != nil {
		message = cause.Error()
	}
	status, body, err := p.do(ctx, client, http.MethodPost, p.jobEndpoint(job, "fail"), map[string]any{
		"workerId": firstNonEmpty(p.WorkerID, p.DockID), "leaseEpoch": job.LeaseEpoch, "error": message,
	})
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("wake fail returned %d: %s", status, strings.TrimSpace(string(body)))
	}
	return nil
}

func (p WakePoller) jobEndpoint(job WakeJob, action string) string {
	return p.endpoint("/v2/docks/" + url.PathEscape(strings.TrimSpace(p.DockID)) + "/wake-jobs/" + url.PathEscape(job.JobID) + "/" + action)
}

func (p WakePoller) endpoint(path string) string {
	return strings.TrimRight(strings.TrimSpace(p.CloudURL), "/") + path
}

func (p WakePoller) do(ctx context.Context, client *http.Client, method, endpoint string, payload any) (int, []byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(data))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	token, err := LoadToken(p.TokenPath)
	if err != nil {
		return 0, nil, fmt.Errorf("load Dock cloud token: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token.CloudToken))
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	return resp.StatusCode, body, err
}
