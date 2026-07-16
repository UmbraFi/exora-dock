package endpoint

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/exora-dock/exora-dock/internal/providerworker"
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
	Control    *ControlCommand     `json:"control,omitempty"`
	Result     map[string]any      `json:"result,omitempty"`
	Features   []string            `json:"features,omitempty"`
	StreamID   string              `json:"streamId,omitempty"`
	LeaseID    string              `json:"leaseId,omitempty"`
	LeaseEpoch int64               `json:"leaseEpoch,omitempty"`
}

type ControlCommand struct {
	CommandID  string         `json:"commandId"`
	Command    string         `json:"command"`
	LeaseID    string         `json:"leaseId,omitempty"`
	LeaseEpoch int64          `json:"leaseEpoch"`
	Deadline   time.Time      `json:"deadline"`
	Input      map[string]any `json:"input,omitempty"`
	Signature  string         `json:"signature"`
}

type TunnelStatus struct {
	EndpointID       string    `json:"endpointId"`
	Healthy          bool      `json:"healthy"`
	RouteFingerprint string    `json:"routeFingerprint"`
	LastSeenAt       time.Time `json:"lastSeenAt"`
	Error            string    `json:"error,omitempty"`
}

type requestState struct {
	cancel context.CancelFunc
	pipe   *io.PipeWriter
}

type streamState struct {
	conn net.Conn
	once sync.Once
}

type TunnelClient struct {
	CloudURL  string
	TokenPath string
	Store     *Store
	// CredentialResolver returns auth metadata and the plaintext only at the
	// final local forwarding boundary. Callers must never log its return value.
	CredentialResolver func(string) (authType, apiKeyHeader, secret string, err error)

	writeMu    sync.Mutex
	stateMu    sync.Mutex
	requests   map[string]*requestState
	streams    map[string]*streamState
	semaphores map[string]chan struct{}
	notify     chan struct{}
	controlKey []byte
}

func NewTunnelClient(cloudURL, tokenPath string, store *Store) *TunnelClient {
	return &TunnelClient{CloudURL: strings.TrimRight(strings.TrimSpace(cloudURL), "/"), TokenPath: strings.TrimSpace(tokenPath), Store: store, requests: map[string]*requestState{}, streams: map[string]*streamState{}, semaphores: map[string]chan struct{}{}, notify: make(chan struct{}, 1)}
}

func (c *TunnelClient) Notify() {
	select {
	case c.notify <- struct{}{}:
	default:
	}
}

func (c *TunnelClient) Run(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		err := c.runConnection(ctx)
		if ctx.Err() != nil {
			return
		}
		if err == nil {
			backoff = time.Second
		}
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
	token, err := cloudlink.LoadToken(c.TokenPath)
	if err != nil || strings.TrimSpace(token.CloudToken) == "" {
		return errors.New("Cloud link is not configured")
	}
	c.stateMu.Lock()
	c.controlKey = []byte(strings.TrimSpace(token.CloudToken))
	c.stateMu.Unlock()
	base := c.CloudURL
	if base == "" {
		base = strings.TrimRight(strings.TrimSpace(token.CloudURL), "/")
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return err
	}
	if parsed.Scheme == "https" {
		parsed.Scheme = "wss"
	} else {
		parsed.Scheme = "ws"
	}
	parsed.Path = "/v3/provider/tunnels/connect"
	parsed.RawQuery = ""
	headers := http.Header{"Authorization": []string{"Bearer " + strings.TrimSpace(token.CloudToken)}}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, parsed.String(), headers)
	if err != nil {
		return err
	}
	defer func() {
		c.closeAllStreams()
		_ = conn.Close()
	}()
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(45 * time.Second))
		return nil
	})
	if err := c.sendRegister(ctx, conn); err != nil {
		return err
	}
	connectionCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go c.healthLoop(connectionCtx, conn)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(45 * time.Second))
		var frame Frame
		if err := conn.ReadJSON(&frame); err != nil {
			return err
		}
		if frame.Version != 1 && frame.Version != frameVersion {
			return errors.New("unsupported tunnel frame version")
		}
		if err := c.handleFrame(connectionCtx, conn, frame); err != nil {
			responseType := "response_error"
			if frame.Type == "control_command" {
				responseType = "control_error"
			} else if strings.HasPrefix(frame.Type, "stream_") {
				responseType = "stream_error"
			}
			_ = c.send(conn, Frame{Version: frameVersion, Type: responseType, RequestID: frame.RequestID, EndpointID: frame.EndpointID, StreamID: frame.StreamID, Error: err.Error()})
		}
	}
}

func (c *TunnelClient) healthLoop(ctx context.Context, conn *websocket.Conn) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = c.sendRegister(ctx, conn)
		case <-c.notify:
			_ = c.sendRegister(ctx, conn)
		}
	}
}

func (c *TunnelClient) sendRegister(ctx context.Context, conn *websocket.Conn) error {
	statuses := make([]TunnelStatus, 0)
	for _, cfg := range c.Store.List() {
		status := Status{EndpointID: cfg.EndpointID, Healthy: cfg.LastProbeHealthy, RouteFingerprint: cfg.RouteFingerprint, CheckedAt: cfg.LastProbeAt, Error: cfg.LastProbeError}
		if strings.TrimSpace(cfg.AuthType) == "" || cfg.AuthType == "none" {
			probeCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
			status = Probe(probeCtx, ProbeInput{Config: cfg})
			cancel()
		} else if c.CredentialResolver != nil && cfg.CredentialRef != "" {
			authType, header, secret, resolveErr := c.CredentialResolver(cfg.CredentialRef)
			if resolveErr != nil {
				status.Healthy = false
				status.Error = "configured endpoint credential is unavailable"
			} else {
				probeCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
				status = Probe(probeCtx, ProbeInput{Config: cfg, AuthType: authType, APIKeyHeader: header, Secret: secret})
				cancel()
			}
		}
		statuses = append(statuses, TunnelStatus{EndpointID: cfg.EndpointID, Healthy: status.Healthy, RouteFingerprint: cfg.RouteFingerprint, LastSeenAt: status.CheckedAt, Error: status.Error})
	}
	return c.send(conn, Frame{Version: frameVersion, Type: "register", Endpoints: statuses, Features: []string{"lease_tcp_v1"}})
}

func (c *TunnelClient) send(conn *websocket.Conn, frame Frame) error {
	frame.Version = frameVersion
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(15 * time.Second))
	return conn.WriteJSON(frame)
}

func (c *TunnelClient) handleFrame(ctx context.Context, conn *websocket.Conn, frame Frame) error {
	switch frame.Type {
	case "stream_open":
		return c.openStream(ctx, conn, frame)
	case "stream_data":
		return c.writeStream(frame)
	case "stream_eof":
		c.halfCloseStream(frame.StreamID)
	case "stream_close", "stream_error":
		c.finishStream(frame.StreamID, false, conn, "")
	case "control_command":
		return c.handleControl(ctx, conn, frame)
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

func (c *TunnelClient) openStream(ctx context.Context, ws *websocket.Conn, frame Frame) error {
	if strings.TrimSpace(frame.StreamID) == "" || strings.TrimSpace(frame.LeaseID) == "" || frame.LeaseEpoch <= 0 {
		return errors.New("invalid lease stream envelope")
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	target, err := (providerworker.Client{}).Call(lookupCtx, "lease_ssh_target", map[string]any{"leaseId": frame.LeaseID, "leaseEpoch": frame.LeaseEpoch})
	if err != nil {
		return err
	}
	host, _ := target["host"].(string)
	port := intFromAny(target["port"])
	if net.ParseIP(strings.TrimSpace(host)) == nil || port != 22 {
		return errors.New("provider worker returned an invalid managed SSH target")
	}
	guest, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(lookupCtx, "tcp", net.JoinHostPort(host, "22"))
	if err != nil {
		return fmt.Errorf("connect managed guest SSH: %w", err)
	}
	state := &streamState{conn: guest}
	c.stateMu.Lock()
	if c.streams[frame.StreamID] != nil {
		c.stateMu.Unlock()
		_ = guest.Close()
		return errors.New("duplicate streamId")
	}
	c.streams[frame.StreamID] = state
	c.stateMu.Unlock()
	if err := c.send(ws, Frame{Type: "stream_opened", StreamID: frame.StreamID, LeaseID: frame.LeaseID, LeaseEpoch: frame.LeaseEpoch}); err != nil {
		c.finishStream(frame.StreamID, false, ws, "")
		return err
	}
	go c.readStream(ws, frame.StreamID, state)
	return nil
}

func (c *TunnelClient) readStream(ws *websocket.Conn, streamID string, state *streamState) {
	buffer := make([]byte, 64<<10)
	for {
		n, err := state.conn.Read(buffer)
		if n > 0 {
			if sendErr := c.send(ws, Frame{Type: "stream_data", StreamID: streamID, DataBase64: base64.StdEncoding.EncodeToString(buffer[:n])}); sendErr != nil {
				c.finishStream(streamID, false, ws, "")
				return
			}
		}
		if err != nil {
			message := ""
			if !errors.Is(err, io.EOF) {
				message = err.Error()
			}
			c.finishStream(streamID, true, ws, message)
			return
		}
	}
}

func (c *TunnelClient) writeStream(frame Frame) error {
	data, err := decodeChunk(frame.DataBase64)
	if err != nil {
		return err
	}
	c.stateMu.Lock()
	state := c.streams[frame.StreamID]
	c.stateMu.Unlock()
	if state == nil {
		return errors.New("unknown lease stream")
	}
	_, err = state.conn.Write(data)
	return err
}

func (c *TunnelClient) halfCloseStream(id string) {
	c.stateMu.Lock()
	state := c.streams[id]
	c.stateMu.Unlock()
	if state != nil {
		if tcp, ok := state.conn.(*net.TCPConn); ok {
			_ = tcp.CloseWrite()
		}
	}
}

func (c *TunnelClient) finishStream(id string, notify bool, ws *websocket.Conn, message string) {
	c.stateMu.Lock()
	state := c.streams[id]
	delete(c.streams, id)
	c.stateMu.Unlock()
	if state == nil {
		return
	}
	state.once.Do(func() {
		_ = state.conn.Close()
		if notify {
			kind := "stream_close"
			if message != "" {
				kind = "stream_error"
			}
			_ = c.send(ws, Frame{Type: kind, StreamID: id, Error: message})
		}
	})
}

func (c *TunnelClient) closeAllStreams() {
	c.stateMu.Lock()
	streams := c.streams
	c.streams = map[string]*streamState{}
	c.stateMu.Unlock()
	for _, state := range streams {
		state.once.Do(func() { _ = state.conn.Close() })
	}
}

func intFromAny(value any) int {
	switch x := value.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case json.Number:
		n, _ := x.Int64()
		return int(n)
	default:
		return 0
	}
}

func (c *TunnelClient) handleControl(ctx context.Context, conn *websocket.Conn, frame Frame) error {
	command := frame.Control
	if command == nil || command.CommandID == "" || command.CommandID != frame.RequestID {
		return errors.New("invalid control command envelope")
	}
	if command.Deadline.IsZero() || time.Now().After(command.Deadline) {
		return c.send(conn, Frame{Version: frameVersion, Type: "control_error", RequestID: frame.RequestID, Error: "control command deadline has expired"})
	}
	c.stateMu.Lock()
	key := append([]byte(nil), c.controlKey...)
	c.stateMu.Unlock()
	if err := verifyControlCommandSignature(*command, key); err != nil {
		return err
	}
	workerCommand := map[string]string{"ProvisionLease": "provision_lease", "RenewLeaseEpoch": "renew_lease_epoch", "ResetVM": "reset_lease", "CapacityRecheck": "lease_recheck"}[command.Command]
	if workerCommand == "" {
		return c.send(conn, Frame{Version: frameVersion, Type: "control_error", RequestID: frame.RequestID, Error: "unsupported provider control command"})
	}
	input := map[string]any{}
	for key, value := range command.Input {
		input[key] = value
	}
	input["commandId"] = command.CommandID
	input["leaseId"] = command.LeaseID
	input["leaseEpoch"] = command.LeaseEpoch
	input["deadline"] = command.Deadline.UTC().Format(time.RFC3339Nano)
	commandCtx, cancel := context.WithDeadline(ctx, command.Deadline)
	defer cancel()
	result, callErr := (providerworker.Client{}).Call(commandCtx, workerCommand, input)
	if callErr != nil {
		return c.send(conn, Frame{Version: frameVersion, Type: "control_error", RequestID: frame.RequestID, Error: callErr.Error()})
	}
	return c.send(conn, Frame{Version: frameVersion, Type: "control_result", RequestID: frame.RequestID, Result: result})
}

func verifyControlCommandSignature(command ControlCommand, key []byte) error {
	if len(key) == 0 {
		return errors.New("provider control signing key is unavailable")
	}
	want, err := hex.DecodeString(command.Signature)
	if err != nil {
		return errors.New("invalid control command signature")
	}
	unsigned := command
	unsigned.Signature = ""
	raw, err := canonicalControlCommandJSON(unsigned)
	if err != nil {
		return errors.New("invalid control command payload")
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(raw)
	if !hmac.Equal(want, mac.Sum(nil)) {
		return errors.New("invalid control command signature")
	}
	return nil
}

func canonicalControlCommandJSON(command ControlCommand) ([]byte, error) {
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var canonical any
	if err := decoder.Decode(&canonical); err != nil {
		return nil, err
	}
	return json.Marshal(canonical)
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
	if cfg.CredentialRef != "" {
		if c.CredentialResolver == nil {
			return errors.New("endpoint credential resolver is unavailable")
		}
		authType, header, secret, err := c.CredentialResolver(cfg.CredentialRef)
		if err != nil {
			return errors.New("configured endpoint credential is unavailable")
		}
		applyCredential(request.Header, authType, header, secret)
	}
	client := &http.Client{Timeout: time.Duration(cfg.TimeoutSeconds) * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
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
		if strings.EqualFold(route.Method, method) && route.Path == path {
			return true
		}
	}
	return false
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
