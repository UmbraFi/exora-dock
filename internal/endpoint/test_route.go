package endpoint

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	maxRouteTestBody    = 1 << 20
	maxRouteTestPreview = 64 << 10
)

type RouteTestInput struct {
	Config
	Route        Route  `json:"route"`
	TestPath     string `json:"testPath"`
	RawQuery     string `json:"rawQuery"`
	ContentType  string `json:"contentType"`
	Body         string `json:"body"`
	AuthType     string `json:"authType"`
	APIKeyHeader string `json:"apiKeyHeader"`
	Secret       string `json:"secret"`
}

type RouteTestResult struct {
	OK          bool      `json:"ok"`
	Status      int       `json:"status,omitempty"`
	LatencyMS   int64     `json:"latencyMs"`
	ContentType string    `json:"contentType,omitempty"`
	BytesRead   int64     `json:"bytesRead"`
	Truncated   bool      `json:"truncated"`
	Preview     string    `json:"preview,omitempty"`
	SSEEvents   []string  `json:"sseEvents,omitempty"`
	CheckedAt   time.Time `json:"checkedAt"`
	Error       string    `json:"error,omitempty"`
}

// TestRoute runs a bounded, transient request against one Agent-declared route.
// Credentials are applied to the request but are never included in the result.
func TestRoute(ctx context.Context, input RouteTestInput) RouteTestResult {
	started := time.Now()
	result := RouteTestResult{CheckedAt: started.UTC()}
	fail := func(err error) RouteTestResult {
		result.LatencyMS = time.Since(started).Milliseconds()
		result.Error = err.Error()
		return result
	}

	if len([]byte(input.Body)) > maxRouteTestBody {
		return fail(fmt.Errorf("route test body exceeds %d bytes", maxRouteTestBody))
	}
	method := strings.ToUpper(strings.TrimSpace(input.Route.Method))
	if !allowedRouteTestMethod(method) {
		return fail(errors.New("route method is not allowed for a smoke test"))
	}
	if !declaredRoute(input.Routes, input.Route) {
		return fail(errors.New("selected route is not present in the reviewed route allowlist"))
	}
	testPath := strings.TrimSpace(input.TestPath)
	if !safeEndpointPath(testPath) || !matchesRouteTemplate(input.Route.Path, testPath) {
		return fail(errors.New("testPath does not match the selected declared route"))
	}
	query, err := url.ParseQuery(strings.TrimPrefix(strings.TrimSpace(input.RawQuery), "?"))
	if err != nil {
		return fail(errors.New("rawQuery is invalid"))
	}
	base, err := ValidateLocalBaseURL(ctx, input.LocalBaseURL)
	if err != nil {
		return fail(err)
	}
	target := *base
	target.Path = strings.TrimRight(base.Path, "/") + "/" + strings.TrimPrefix(testPath, "/")
	target.RawPath = ""
	target.RawQuery = query.Encode()
	target.Fragment = ""

	timeout := time.Duration(clamp(input.TimeoutSeconds, 1, 30, 30)) * time.Second
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, method, target.String(), bytes.NewReader([]byte(input.Body)))
	if err != nil {
		return fail(err)
	}
	request.Header.Set("Accept", "application/json, text/event-stream;q=0.9, text/plain;q=0.8, */*;q=0.5")
	if contentType := strings.TrimSpace(input.ContentType); contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	applyCredential(request.Header, input.AuthType, input.APIKeyHeader, input.Secret)
	client, err := privateHTTPClient(requestCtx, base, timeout)
	if err != nil {
		return fail(err)
	}
	response, err := client.Do(request)
	if err != nil {
		return fail(err)
	}
	defer response.Body.Close()
	result.Status = response.StatusCode
	result.ContentType = response.Header.Get("Content-Type")
	result.OK = response.StatusCode >= 200 && response.StatusCode < 400

	if strings.HasPrefix(strings.ToLower(result.ContentType), "text/event-stream") {
		readSSEPreview(requestCtx, response.Body, &result)
	} else {
		preview, readErr := io.ReadAll(io.LimitReader(response.Body, maxRouteTestPreview+1))
		result.Truncated = len(preview) > maxRouteTestPreview
		if result.Truncated {
			preview = preview[:maxRouteTestPreview]
		}
		result.BytesRead = int64(len(preview))
		result.Preview = strings.ToValidUTF8(string(preview), "�")
		if readErr != nil {
			result.Error = readErr.Error()
		}
	}
	result.LatencyMS = time.Since(started).Milliseconds()
	if !result.OK && result.Error == "" {
		result.Error = fmt.Sprintf("local provider returned HTTP %d", response.StatusCode)
	}
	return result
}

func allowedRouteTestMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions:
		return true
	default:
		return false
	}
}

func declaredRoute(routes []Route, selected Route) bool {
	for _, route := range routes {
		if strings.TrimSpace(route.OperationID) == strings.TrimSpace(selected.OperationID) &&
			strings.EqualFold(strings.TrimSpace(route.Method), strings.TrimSpace(selected.Method)) &&
			strings.TrimSpace(route.Path) == strings.TrimSpace(selected.Path) {
			return true
		}
	}
	return false
}

func matchesRouteTemplate(template, actual string) bool {
	if !safeEndpointPath(template) || !safeEndpointPath(actual) {
		return false
	}
	decodedActual, err := url.PathUnescape(actual)
	if err != nil {
		return false
	}
	templateParts := strings.Split(strings.TrimPrefix(template, "/"), "/")
	actualParts := strings.Split(strings.TrimPrefix(decodedActual, "/"), "/")
	if len(templateParts) != len(actualParts) {
		return false
	}
	for index := range templateParts {
		part := templateParts[index]
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") && len(part) > 2 {
			if actualParts[index] == "" {
				return false
			}
			continue
		}
		if part != actualParts[index] {
			return false
		}
	}
	return true
}

func privateHTTPClient(ctx context.Context, target *url.URL, timeout time.Duration) (*http.Client, error) {
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, target.Hostname())
	if err != nil || len(addresses) == 0 {
		return nil, errors.New("localBaseUrl hostname could not be resolved")
	}
	for _, address := range addresses {
		ip := address.IP
		if ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || (!ip.IsLoopback() && !ip.IsPrivate()) {
			return nil, errors.New("localBaseUrl must resolve only to loopback or private network addresses")
		}
	}
	port := target.Port()
	if port == "" {
		if target.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	pinnedAddress := net.JoinHostPort(addresses[0].IP.String(), port)
	dialer := &net.Dialer{Timeout: timeout}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(dialCtx context.Context, network, _ string) (net.Conn, error) {
			return dialer.DialContext(dialCtx, network, pinnedAddress)
		},
		ForceAttemptHTTP2: false,
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}, nil
}

func readSSEPreview(parent context.Context, body io.Reader, result *RouteTestResult) {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	reader := bufio.NewReader(body)
	var event bytes.Buffer
	for len(result.SSEEvents) < 10 && result.BytesRead < maxRouteTestPreview {
		line, err := readLineWithContext(ctx, reader)
		if len(line) > 0 {
			remaining := maxRouteTestPreview - int(result.BytesRead)
			if len(line) > remaining {
				line = line[:remaining]
				result.Truncated = true
			}
			result.BytesRead += int64(len(line))
			if strings.TrimSpace(string(line)) == "" {
				if event.Len() > 0 {
					result.SSEEvents = append(result.SSEEvents, strings.ToValidUTF8(strings.TrimSpace(event.String()), "�"))
					event.Reset()
				}
			} else {
				event.Write(line)
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) && !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, context.Canceled) {
				result.Error = err.Error()
			}
			break
		}
	}
	if event.Len() > 0 && len(result.SSEEvents) < 10 {
		result.SSEEvents = append(result.SSEEvents, strings.ToValidUTF8(strings.TrimSpace(event.String()), "�"))
	}
	result.Truncated = result.Truncated || len(result.SSEEvents) == 10 || result.BytesRead >= maxRouteTestPreview
	result.Preview = strings.Join(result.SSEEvents, "\n\n")
}

type lineResult struct {
	line []byte
	err  error
}

func readLineWithContext(ctx context.Context, reader *bufio.Reader) ([]byte, error) {
	channel := make(chan lineResult, 1)
	go func() {
		line, err := reader.ReadBytes('\n')
		channel <- lineResult{line: line, err: err}
	}()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case result := <-channel:
		return result.line, result.err
	}
}
