package sellerdraft

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cloudlink"
)

type cloudClient struct {
	baseURL   string
	tokenPath string
	client    *http.Client
}

type cloudHTTPError struct {
	Method     string
	Path       string
	StatusCode int
	ErrorCode  string
	Message    string
}

func (e *cloudHTTPError) Error() string {
	return fmt.Sprintf("Cloud %s %s failed: %s", e.Method, e.Path, e.Message)
}

func isUnregisteredCloudRoute(err error) bool {
	var cloudErr *cloudHTTPError
	if !errors.As(err, &cloudErr) || cloudErr.StatusCode != http.StatusNotFound || cloudErr.ErrorCode != "" {
		return false
	}
	message := strings.ToLower(strings.TrimSpace(cloudErr.Message))
	return message == strings.ToLower(http.StatusText(http.StatusNotFound)) || strings.Contains(message, "page not found")
}

func isExistingCloudAPIConflict(err error) bool {
	var cloudErr *cloudHTTPError
	if !errors.As(err, &cloudErr) || cloudErr.StatusCode != http.StatusConflict {
		return false
	}
	message := strings.ToLower(strings.TrimSpace(cloudErr.Message))
	return cloudErr.ErrorCode == "api_id_conflict" || strings.Contains(message, "apiid conflicts with an existing api")
}

func newCloudClient(baseURL, tokenPath string, client *http.Client) cloudClient {
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Second}
	}
	return cloudClient{baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"), tokenPath: strings.TrimSpace(tokenPath), client: client}
}

func (c cloudClient) JSON(ctx context.Context, method, path string, body any, out any) error {
	token, err := cloudlink.LoadToken(c.tokenPath)
	if err != nil {
		return errors.New("Exora Cloud is not configured")
	}
	base := c.baseURL
	if base == "" {
		base = strings.TrimRight(strings.TrimSpace(token.CloudURL), "/")
	}
	if base == "" || strings.TrimSpace(token.CloudToken) == "" {
		return errors.New("Exora Cloud is not configured")
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	request, err := http.NewRequestWithContext(ctx, method, base+path, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token.CloudToken))
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.Unmarshal(raw, &payload)
		message := firstNonEmpty(stringValue(payload, "error"), strings.TrimSpace(string(raw)), response.Status)
		return &cloudHTTPError{Method: method, Path: path, StatusCode: response.StatusCode, ErrorCode: stringValue(payload, "errorCode"), Message: message}
	}
	if out != nil && len(bytes.TrimSpace(raw)) != 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return err
		}
	}
	return nil
}

func (c cloudClient) PUTPart(ctx context.Context, target string, body io.Reader, size int64) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(target))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("multipart upload URL is invalid")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, parsed.String(), body)
	if err != nil {
		return "", err
	}
	request.ContentLength = size
	response, err := c.client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4<<10))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("multipart part upload returned HTTP %d", response.StatusCode)
	}
	return response.Header.Get("ETag"), nil
}

func stringValue(value map[string]any, key string) string {
	if value == nil {
		return ""
	}
	text, _ := value[key].(string)
	return strings.TrimSpace(text)
}
