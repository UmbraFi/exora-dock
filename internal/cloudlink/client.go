package cloudlink

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type TokenFile struct {
	DockID     string `json:"dockId"`
	AccountID  string `json:"accountId,omitempty"`
	CloudURL   string `json:"cloudUrl"`
	CloudToken string `json:"cloudToken"`
	LinkedAt   string `json:"linkedAt"`
}

type DeviceLinkRequest struct {
	DockID        string   `json:"dockId"`
	ClientKind    string   `json:"clientKind,omitempty"`
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
	ClientKind string `json:"clientKind,omitempty"`
	CloudToken string `json:"cloudToken"`
	ExpiresAt  string `json:"expiresAt"`
}

func Link(ctx context.Context, cloudURL, tokenPath string, req DeviceLinkRequest, wait time.Duration, client *http.Client) (DeviceLinkResult, DeviceTokenResult, error) {
	cloudURL = strings.TrimRight(strings.TrimSpace(cloudURL), "/")
	if cloudURL == "" {
		return DeviceLinkResult{}, DeviceTokenResult{}, fmt.Errorf("cloud_url required")
	}
	if strings.TrimSpace(req.ClientKind) == "" {
		req.ClientKind = "cli"
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
		if err == nil && status == http.StatusOK && strings.TrimSpace(token.CloudToken) != "" {
			err = SaveToken(tokenPath, TokenFile{
				DockID: token.DockID, AccountID: token.AccountID, CloudURL: cloudURL, CloudToken: token.CloudToken,
				LinkedAt: time.Now().UTC().Format(time.RFC3339),
			})
			return link, token, err
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func postJSON(ctx context.Context, client *http.Client, endpoint, token string, body, out any) error {
	status, err := postJSONStatus(ctx, client, endpoint, token, body, out)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("%s returned %d", endpoint, status)
	}
	return nil
}

func postJSONStatus(ctx context.Context, client *http.Client, endpoint, token string, body, out any) (int, error) {
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

func doJSON(ctx context.Context, client *http.Client, method, endpoint, token string, body, out any) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%s returned %d: %s", endpoint, resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}
