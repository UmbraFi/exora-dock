package cloudlink

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/remotecontrol"
)

type TokenFile struct {
	DockID     string `json:"dockId"`
	CloudURL   string `json:"cloudUrl"`
	CloudToken string `json:"cloudToken"`
	LinkedAt   string `json:"linkedAt"`
}

type DeviceLinkRequest struct {
	DockID        string   `json:"dockId"`
	DisplayName   string   `json:"displayName"`
	Mode          string   `json:"mode"`
	PublicBaseURL string   `json:"publicBaseUrl"`
	Version       string   `json:"version"`
	Capabilities  []string `json:"capabilities"`
}

type DeviceLinkResult struct {
	DeviceCode      string `json:"deviceCode"`
	UserCode        string `json:"userCode"`
	VerificationURL string `json:"verificationUrl"`
	ExpiresAt       string `json:"expiresAt"`
}

type DeviceTokenResult struct {
	Status     string `json:"status"`
	DockID     string `json:"dockId"`
	AccountID  string `json:"accountId"`
	CloudToken string `json:"cloudToken"`
	ExpiresAt  string `json:"expiresAt"`
}

type RemoteCommand struct {
	ID     string         `json:"commandId"`
	Method string         `json:"method"`
	Path   string         `json:"path"`
	Body   map[string]any `json:"body,omitempty"`
}

type Poller struct {
	CloudURL     string
	DockID       string
	TokenPath    string
	BaseURL      string
	OwnerToken   string
	PollInterval time.Duration
	HTTPClient   *http.Client
}

func Link(ctx context.Context, cloudURL string, tokenPath string, req DeviceLinkRequest, wait time.Duration, client *http.Client) (DeviceLinkResult, DeviceTokenResult, error) {
	cloudURL = strings.TrimRight(strings.TrimSpace(cloudURL), "/")
	if cloudURL == "" {
		return DeviceLinkResult{}, DeviceTokenResult{}, fmt.Errorf("cloud_url required")
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	var link DeviceLinkResult
	if err := postJSON(ctx, client, cloudURL+"/v1/device-links", "", req, &link); err != nil {
		return DeviceLinkResult{}, DeviceTokenResult{}, err
	}
	if wait <= 0 {
		return link, DeviceTokenResult{Status: "pending"}, nil
	}
	deadline := time.Now().Add(wait)
	for {
		var token DeviceTokenResult
		status, err := postJSONStatus(ctx, client, cloudURL+"/v1/device-links/token", "", map[string]string{"deviceCode": link.DeviceCode}, &token)
		if err == nil && status == http.StatusOK && token.CloudToken != "" {
			if err := SaveToken(tokenPath, TokenFile{
				DockID:     token.DockID,
				CloudURL:   cloudURL,
				CloudToken: token.CloudToken,
				LinkedAt:   time.Now().UTC().Format(time.RFC3339),
			}); err != nil {
				return link, token, err
			}
			return link, token, nil
		}
		if time.Now().After(deadline) {
			return link, token, fmt.Errorf("device link still pending; confirm code %s at %s", link.UserCode, link.VerificationURL)
		}
		select {
		case <-ctx.Done():
			return link, token, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

func SaveToken(path string, file TokenFile) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0600)
}

func LoadToken(path string) (TokenFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return TokenFile{}, err
	}
	var file TokenFile
	if err := json.Unmarshal(data, &file); err != nil {
		return TokenFile{}, err
	}
	if strings.TrimSpace(file.CloudToken) == "" {
		return TokenFile{}, fmt.Errorf("cloud token missing")
	}
	return file, nil
}

func (p Poller) Run(ctx context.Context) {
	interval := p.PollInterval
	if interval <= 0 {
		interval = 3 * time.Second
	}
	client := p.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	for {
		handled, err := p.pollOnce(ctx, client)
		if err != nil && !strings.Contains(err.Error(), "404") {
			log.Printf("[cloud-link] poll error: %v", err)
		}
		sleepFor := interval
		if handled {
			sleepFor = 100 * time.Millisecond
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(sleepFor):
		}
	}
}

func (p Poller) pollOnce(ctx context.Context, client *http.Client) (bool, error) {
	cloudURL := strings.TrimRight(strings.TrimSpace(p.CloudURL), "/")
	dockID := strings.TrimSpace(p.DockID)
	if cloudURL == "" || dockID == "" || strings.TrimSpace(p.OwnerToken) == "" {
		return false, fmt.Errorf("cloud poller is not configured")
	}
	bearer := p.bearer()
	if bearer == "" {
		return false, fmt.Errorf("cloud token unavailable")
	}
	endpoint := cloudURL + "/v1/docks/" + url.PathEscape(dockID) + "/commands/next"
	var wrapped struct {
		Command RemoteCommand `json:"command"`
	}
	status, err := getJSONStatus(ctx, client, endpoint, bearer, &wrapped)
	if err != nil {
		return false, err
	}
	if status == http.StatusNotFound {
		return false, nil
	}
	if status < 200 || status >= 300 {
		return false, fmt.Errorf("next command returned %d", status)
	}
	resultStatus, body, execErr := p.executeLocal(ctx, client, wrapped.Command)
	resultBody := body
	errText := ""
	if execErr != nil {
		errText = execErr.Error()
		if resultStatus == 0 {
			resultStatus = http.StatusConflict
		}
	}
	resultEndpoint := cloudURL + "/v1/docks/" + url.PathEscape(dockID) + "/commands/" + url.PathEscape(wrapped.Command.ID) + "/result"
	return true, postJSON(ctx, client, resultEndpoint, bearer, map[string]any{
		"status": resultStatus,
		"body":   resultBody,
		"error":  errText,
	}, nil)
}

func (p Poller) executeLocal(ctx context.Context, client *http.Client, cmd RemoteCommand) (int, map[string]any, error) {
	method := strings.ToUpper(strings.TrimSpace(cmd.Method))
	if method == "" {
		method = http.MethodGet
	}
	if !remotecontrol.Allowed(method, cmd.Path) {
		return http.StatusForbidden, map[string]any{"error": "remote command not allowed by local dock"}, fmt.Errorf("remote command not allowed")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8080"
	}
	var reader io.Reader
	if cmd.Body != nil {
		data, err := json.Marshal(cmd.Body)
		if err != nil {
			return http.StatusBadRequest, nil, err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, baseURL+cmd.Path, reader)
	if err != nil {
		return http.StatusBadRequest, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.OwnerToken)
	if cmd.Body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, err
	}
	body := map[string]any{}
	if len(bytes.TrimSpace(data)) > 0 {
		if err := json.Unmarshal(data, &body); err != nil {
			body = map[string]any{"raw": string(data)}
		}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, body, fmt.Errorf("local dock returned %s", resp.Status)
	}
	return resp.StatusCode, body, nil
}

func (p Poller) bearer() string {
	token := strings.TrimSpace(p.TokenPath)
	_ = token
	file, err := LoadToken(p.TokenPath)
	if err == nil {
		return file.CloudToken
	}
	return ""
}

func postJSON(ctx context.Context, client *http.Client, endpoint string, token string, body any, out any) error {
	status, err := postJSONStatus(ctx, client, endpoint, token, body, out)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("%s returned %d", endpoint, status)
	}
	return nil
}

func postJSONStatus(ctx context.Context, client *http.Client, endpoint string, token string, body any, out any) (int, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return resp.StatusCode, err
		}
	}
	return resp.StatusCode, nil
}

func getJSONStatus(ctx context.Context, client *http.Client, endpoint string, token string, out any) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if out != nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return resp.StatusCode, err
		}
	}
	return resp.StatusCode, nil
}
