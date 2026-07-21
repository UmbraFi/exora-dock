package endpoint

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/gorilla/websocket"
)

const frameVersion = 2

type Frame struct {
	Version    int                 `json:"version"`
	Type       string              `json:"type"`
	RequestID  string              `json:"requestId,omitempty"`
	EndpointID string              `json:"endpointId,omitempty"`
	Method     string              `json:"method,omitempty"`
	Path       string              `json:"path,omitempty"`
	RawQuery   string              `json:"rawQuery,omitempty"`
	Headers    map[string][]string `json:"headers,omitempty"`
	Status     int                 `json:"status,omitempty"`
	DataBase64 string              `json:"dataBase64,omitempty"`
	Error      string              `json:"error,omitempty"`
	TimeoutSec int                 `json:"timeoutSeconds,omitempty"`
	Endpoints  []TunnelStatus      `json:"endpoints,omitempty"`
}

type TunnelStatus struct {
	EndpointID     string    `json:"endpointId"`
	Healthy        bool      `json:"healthy"`
	ContractSHA256 string    `json:"contractSha256"`
	LastSeenAt     time.Time `json:"lastSeenAt"`
	Error          string    `json:"error,omitempty"`
}

type requestState struct {
	cancel context.CancelFunc
	pipe   *io.PipeWriter
}

type TunnelClient struct {
	CloudURL  string
	TokenPath string
	Store     *Store
	// CredentialResolver returns auth metadata and the plaintext only at the
	// final local forwarding boundary. Callers must never log its return value.
	CredentialResolver func(string) (authType, apiKeyHeader, secret string, err error)

	writeMu          sync.Mutex
	stateMu          sync.Mutex
	requests         map[string]*requestState
	semaphores       map[string]chan struct{}
	notify           chan struct{}
	readTimeout      time.Duration
	writeTimeout     time.Duration
	pingWriteTimeout time.Duration
	healthInterval   time.Duration
}

func NewTunnelClient(cloudURL, tokenPath string, store *Store) *TunnelClient {
	return &TunnelClient{CloudURL: strings.TrimRight(strings.TrimSpace(cloudURL), "/"), TokenPath: strings.TrimSpace(tokenPath), Store: store, requests: map[string]*requestState{}, semaphores: map[string]chan struct{}{}, notify: make(chan struct{}, 1), readTimeout: 45 * time.Second, writeTimeout: 15 * time.Second, pingWriteTimeout: 5 * time.Second, healthInterval: 30 * time.Second}
}

func (c *TunnelClient) Notify() {
	select {
	case c.notify <- struct{}{}:
	default:
	}
}

func (c *TunnelClient) Run(ctx context.Context) {
	backoff := time.Second
	reconnects := 0
	for ctx.Err() == nil {
		established, err := c.runConnectionSession(ctx)
		if ctx.Err() != nil {
			return
		}
		if established {
			backoff = time.Second
		}
		reconnects++
		log.Printf("[provider-tunnel] offline reconnect=%d retry=%s error=%s", reconnects, backoff, c.sanitizeTunnelError(err))
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
}

func (c *TunnelClient) runConnection(ctx context.Context) error {
	_, err := c.runConnectionSession(ctx)
	return err
}

func (c *TunnelClient) runConnectionSession(ctx context.Context) (bool, error) {
	token, err := cloudlink.LoadToken(c.TokenPath)
	if err != nil || strings.TrimSpace(token.CloudToken) == "" {
		return false, errors.New("Cloud link is not configured")
	}
	base := c.CloudURL
	if base == "" {
		base = strings.TrimRight(strings.TrimSpace(token.CloudURL), "/")
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return false, err
	}
	if parsed.Scheme == "https" {
		parsed.Scheme = "wss"
	} else {
		parsed.Scheme = "ws"
	}
	parsed.Path = "/v4/provider/tunnels/connect"
	parsed.RawQuery = ""
	headers := http.Header{"Authorization": []string{"Bearer " + strings.TrimSpace(token.CloudToken)}}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, parsed.String(), headers)
	if err != nil {
		return false, err
	}
	connectedAt := time.Now()
	defer func() {
		_ = conn.Close()
	}()
	refreshReadDeadline := func() error {
		return conn.SetReadDeadline(time.Now().Add(c.readTimeout))
	}
	conn.SetPingHandler(func(data string) error {
		if err := refreshReadDeadline(); err != nil {
			return err
		}
		c.writeMu.Lock()
		defer c.writeMu.Unlock()
		return conn.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(c.pingWriteTimeout))
	})
	conn.SetPongHandler(func(string) error {
		return refreshReadDeadline()
	})
	if err := c.sendRegister(ctx, conn); err != nil {
		return false, err
	}
	log.Printf("[provider-tunnel] online")
	connectionCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	connectionDone := make(chan struct{})
	defer close(connectionDone)
	go func() {
		select {
		case <-connectionCtx.Done():
			_ = conn.Close()
		case <-connectionDone:
		}
	}()
	healthErr := make(chan error, 1)
	go c.healthLoop(connectionCtx, conn, healthErr)
	for {
		if err := refreshReadDeadline(); err != nil {
			return true, err
		}
		var frame Frame
		if err := conn.ReadJSON(&frame); err != nil {
			select {
			case healthError := <-healthErr:
				return true, fmt.Errorf("health registration failed after %s: %w", time.Since(connectedAt).Round(time.Millisecond), healthError)
			default:
				return true, err
			}
		}
		if err := refreshReadDeadline(); err != nil {
			return true, err
		}
		if frame.Version != 1 && frame.Version != frameVersion {
			return true, errors.New("unsupported tunnel frame version")
		}
		if err := c.handleFrame(connectionCtx, conn, frame); err != nil {
			_ = c.send(conn, Frame{Version: frameVersion, Type: "response_error", RequestID: frame.RequestID, EndpointID: frame.EndpointID, Error: err.Error()})
		}
	}
}

func (c *TunnelClient) healthLoop(ctx context.Context, conn *websocket.Conn, failures chan<- error) {
	ticker := time.NewTicker(c.healthInterval)
	defer ticker.Stop()
	report := func(err error) {
		select {
		case failures <- err:
		default:
		}
		_ = conn.Close()
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.sendRegister(ctx, conn); err != nil {
				report(err)
				return
			}
		case <-c.notify:
			if err := c.sendRegister(ctx, conn); err != nil {
				report(err)
				return
			}
		}
	}
}

func (c *TunnelClient) sanitizeTunnelError(err error) string {
	if err == nil {
		return "connection closed"
	}
	var urlError *url.Error
	if errors.As(err, &urlError) {
		return strings.TrimSpace(urlError.Op + ": " + urlError.Err.Error())
	}
	message := err.Error()
	for _, sensitive := range []string{c.CloudURL, c.TokenPath} {
		if strings.TrimSpace(sensitive) != "" {
			message = strings.ReplaceAll(message, sensitive, "[redacted]")
		}
	}
	return message
}

func (c *TunnelClient) sendRegister(ctx context.Context, conn *websocket.Conn) error {
	statuses := make([]TunnelStatus, 0)
	for _, cfg := range c.Store.List() {
		status := Status{EndpointID: cfg.EndpointID, Healthy: cfg.LastProbeHealthy, ContractSHA256: cfg.ContractSHA256, CheckedAt: cfg.LastProbeAt, Error: cfg.LastProbeError}
		if strings.TrimSpace(cfg.AuthType) == "" || cfg.AuthType == "none" {
			probeCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
			status = Probe(probeCtx, ProbeInput{Config: cfg})
			cancel()
		} else if c.CredentialResolver != nil && cfg.CredentialRef != "" {
			authType, header, secret, resolveErr := c.CredentialResolver(cfg.CredentialRef)
			if resolveErr != nil {
				status.Healthy = false
				status.Error = "configured Adapter credential is unavailable"
			} else {
				probeCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
				status = Probe(probeCtx, ProbeInput{Config: cfg, AuthType: authType, APIKeyHeader: header, Secret: secret})
				cancel()
			}
		}
		statuses = append(statuses, TunnelStatus{EndpointID: cfg.EndpointID, Healthy: status.Healthy, ContractSHA256: cfg.ContractSHA256, LastSeenAt: status.CheckedAt, Error: status.Error})
	}
	return c.send(conn, Frame{Version: frameVersion, Type: "register", Endpoints: statuses})
}

func (c *TunnelClient) send(conn *websocket.Conn, frame Frame) error {
	frame.Version = frameVersion
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(c.writeTimeout))
	return conn.WriteJSON(frame)
}

func (c *TunnelClient) handleFrame(ctx context.Context, conn *websocket.Conn, frame Frame) error {
	switch frame.Type {
	case "request_start":
		return c.startRequest(ctx, conn, frame)
	case "request_chunk":
		data, err := decodeChunk(frame.DataBase64)
		if err != nil {
			return err
		}
		c.stateMu.Lock()
		state := c.requests[frame.RequestID]
		c.stateMu.Unlock()
		if state == nil {
			return errors.New("unknown tunnel request")
		}
		_, err = state.pipe.Write(data)
		return err
	case "request_end":
		c.stateMu.Lock()
		state := c.requests[frame.RequestID]
		c.stateMu.Unlock()
		if state != nil {
			return state.pipe.Close()
		}
	case "cancel":
		c.finishRequest(frame.RequestID, true)
	}
	return nil
}

func (c *TunnelClient) startRequest(parent context.Context, conn *websocket.Conn, frame Frame) error {
	cfg, found := c.Store.Get(frame.EndpointID)
	if !found {
		return errors.New("local endpoint is not configured")
	}
	healthCheck := firstFrameHeader(frame.Headers, "X-Exora-Health-Check") == "1" && frame.Path == cfg.HealthPath && (strings.EqualFold(frame.Method, http.MethodHead) || strings.EqualFold(frame.Method, http.MethodGet))
	if !healthCheck && !routeAllowed(cfg.Routes, frame.Method, frame.Path) {
		return errors.New("route is not declared by this endpoint")
	}
	semaphore := c.semaphore(cfg)
	select {
	case semaphore <- struct{}{}:
	default:
		return errors.New("endpoint concurrency limit reached")
	}
	timeout := clamp(frame.TimeoutSec, 1, 300, cfg.TimeoutSeconds)
	requestCtx, cancel := context.WithTimeout(parent, time.Duration(timeout)*time.Second)
	reader, writer := io.Pipe()
	state := &requestState{cancel: cancel, pipe: writer}
	c.stateMu.Lock()
	if previous := c.requests[frame.RequestID]; previous != nil {
		c.stateMu.Unlock()
		cancel()
		<-semaphore
		return errors.New("duplicate tunnel requestId")
	}
	c.requests[frame.RequestID] = state
	c.stateMu.Unlock()
	go func() {
		defer func() {
			<-semaphore
			c.finishRequest(frame.RequestID, false)
		}()
		if err := c.forward(requestCtx, conn, cfg, frame, reader); err != nil {
			_ = c.send(conn, Frame{Version: frameVersion, Type: "response_error", RequestID: frame.RequestID, EndpointID: frame.EndpointID, Error: err.Error()})
		}
	}()
	return nil
}

func (c *TunnelClient) semaphore(cfg Config) chan struct{} {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	current := c.semaphores[cfg.EndpointID]
	if current == nil || cap(current) != cfg.Concurrency {
		current = make(chan struct{}, cfg.Concurrency)
		c.semaphores[cfg.EndpointID] = current
	}
	return current
}

func (c *TunnelClient) finishRequest(requestID string, cancelRequest bool) {
	c.stateMu.Lock()
	state := c.requests[requestID]
	delete(c.requests, requestID)
	c.stateMu.Unlock()
	if state != nil {
		if cancelRequest {
			state.cancel()
			_ = state.pipe.CloseWithError(context.Canceled)
		} else {
			state.cancel()
		}
	}
}

func (c *TunnelClient) forward(ctx context.Context, conn *websocket.Conn, cfg Config, frame Frame, body io.Reader) error {
	base, err := ValidateLocalBaseURL(ctx, cfg.LocalBaseURL)
	if err != nil {
		return err
	}
	target := *base
	target.Path = strings.TrimRight(base.Path, "/") + "/" + strings.TrimPrefix(frame.Path, "/")
	target.RawQuery = frame.RawQuery
	request, err := http.NewRequestWithContext(ctx, strings.ToUpper(frame.Method), target.String(), body)
	if err != nil {
		return err
	}
	for key, values := range frame.Headers {
		if protectedHeader(key) {
			continue
		}
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	// These values are minted by Cloud after the buyer-facing request boundary.
	// They remain protected from arbitrary forwarding, but async V4 runtimes
	// need them to authenticate job callbacks and correlate invocations.
	for _, name := range []string{"X-Exora-Invocation-Id", "X-Exora-Cloud-Job-Id", "X-Exora-Provider-Job-Token"} {
		if value := firstFrameHeader(frame.Headers, name); value != "" {
			request.Header.Set(name, value)
		}
	}
	if cfg.CredentialRef != "" {
		if c.CredentialResolver == nil {
			return errors.New("endpoint credential resolver is unavailable")
		}
		authType, header, secret, err := c.CredentialResolver(cfg.CredentialRef)
		if err != nil {
			return errors.New("configured endpoint credential is unavailable")
		}
		transport, authErr := applyRequestCredential(ctx, request, authType, header, secret)
		if authErr != nil {
			return errors.New("configured endpoint credential is invalid")
		}
		client, clientErr := privateHTTPClient(ctx, base, time.Duration(cfg.TimeoutSeconds)*time.Second)
		if clientErr != nil {
			return clientErr
		}
		if transport != nil {
			if secured, ok := client.Transport.(*http.Transport); ok {
				secured.TLSClientConfig = transport.TLSClientConfig
			}
		}
		return c.forwardWithClient(ctx, conn, cfg, frame, request, client)
	}
	client, clientErr := privateHTTPClient(ctx, base, time.Duration(cfg.TimeoutSeconds)*time.Second)
	if clientErr != nil {
		return clientErr
	}
	return c.forwardWithClient(ctx, conn, cfg, frame, request, client)
}

func (c *TunnelClient) forwardWithClient(ctx context.Context, conn *websocket.Conn, cfg Config, frame Frame, request *http.Request, client *http.Client) error {
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	headers := map[string][]string{}
	for key, values := range response.Header {
		if !protectedHeader(key) {
			headers[key] = append([]string(nil), values...)
		}
	}
	if err := c.send(conn, Frame{Version: frameVersion, Type: "response_start", RequestID: frame.RequestID, EndpointID: frame.EndpointID, Status: response.StatusCode, Headers: headers}); err != nil {
		return err
	}
	chunk := make([]byte, 64<<10)
	for {
		n, readErr := response.Body.Read(chunk)
		if n > 0 {
			if err := c.send(conn, Frame{Version: frameVersion, Type: "response_chunk", RequestID: frame.RequestID, EndpointID: frame.EndpointID, DataBase64: base64.StdEncoding.EncodeToString(chunk[:n])}); err != nil {
				return err
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	return c.send(conn, Frame{Version: frameVersion, Type: "response_end", RequestID: frame.RequestID, EndpointID: frame.EndpointID})
}

func routeAllowed(routes []Route, method, path string) bool {
	for _, route := range routes {
		if strings.EqualFold(route.Method, method) && matchPathTemplate(route.Path, path) {
			return true
		}
	}
	return false
}

func matchPathTemplate(template, actual string) bool {
	templateParts := strings.Split(strings.Trim(template, "/"), "/")
	actualParts := strings.Split(strings.Trim(actual, "/"), "/")
	if len(templateParts) != len(actualParts) {
		return false
	}
	for index, expected := range templateParts {
		if strings.HasPrefix(expected, "{") && strings.HasSuffix(expected, "}") {
			decoded, err := url.PathUnescape(actualParts[index])
			if err != nil || decoded == "" || strings.Contains(decoded, "/") {
				return false
			}
			continue
		}
		if expected != actualParts[index] {
			return false
		}
	}
	return true
}

func protectedHeader(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "host", "connection", "keep-alive", "proxy-authorization", "transfer-encoding", "te", "trailer", "upgrade", "content-length":
		return true
	}
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(name)), "x-exora-")
}

func firstFrameHeader(headers map[string][]string, name string) string {
	for key, values := range headers {
		if strings.EqualFold(key, name) && len(values) > 0 {
			return values[0]
		}
	}
	return ""
}

func decodeChunk(encoded string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	if len(raw) > 64<<10 {
		return nil, fmt.Errorf("tunnel chunk exceeds 64 KiB")
	}
	return raw, nil
}
