package agentdriver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type OpenCodeConfig struct {
	Command        string
	MCPCommand     []string
	MCPEnvironment map[string]string
	ProbeTimeout   time.Duration
	RequestTimeout time.Duration
}

type OpenCodeDriver struct {
	cfg      OpenCodeConfig
	mu       sync.Mutex
	cmd      *exec.Cmd
	baseURL  string
	password string
	client   *http.Client
	active   map[string]context.CancelFunc
	closed   bool
	mcpAdded bool
}

func NewOpenCode(cfg OpenCodeConfig) *OpenCodeDriver {
	if strings.TrimSpace(cfg.Command) == "" {
		cfg.Command = "opencode"
	}
	if cfg.ProbeTimeout <= 0 {
		cfg.ProbeTimeout = 8 * time.Second
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 5 * time.Minute
	}
	return &OpenCodeDriver{cfg: cfg, client: &http.Client{Timeout: cfg.RequestTimeout}, active: map[string]context.CancelFunc{}}
}

func (d *OpenCodeDriver) Kind() string { return "opencode" }

func (d *OpenCodeDriver) Probe(ctx context.Context) (CapabilityReport, error) {
	report := CapabilityReport{Kind: d.Kind(), Protocol: "http-sse", Methods: []string{"session/create", "session/message", "session/abort", "mcp/add"}, ProbedAt: receivedNow()}
	command, err := exec.LookPath(d.cfg.Command)
	if err != nil {
		report.Error = err.Error()
		return report, nil
	}
	report.Installed, report.Path = true, command
	probeCtx, cancel := context.WithTimeout(ctx, d.cfg.ProbeTimeout)
	defer cancel()
	if out, err := exec.CommandContext(probeCtx, command, "--version").CombinedOutput(); err == nil {
		report.Version = strings.TrimSpace(string(out))
	}
	// OpenCode provider credentials stay in OpenCode. Server startup/message
	// errors surface missing configuration without Exora reading provider keys.
	report.Authenticated = true
	report.AuthStatus = "managed by local CLI"
	return report, nil
}

func (d *OpenCodeDriver) StartSession(ctx context.Context, req SessionRequest) (Session, error) {
	if err := d.ensureStarted(ctx); err != nil {
		return Session{}, err
	}
	var response map[string]any
	if err := d.doJSON(ctx, http.MethodPost, "/session", map[string]any{"title": "Exora Dock", "directory": req.CWD}, &response); err != nil {
		return Session{}, err
	}
	id := stringValue(response["id"])
	if id == "" {
		id = stringValue(response["sessionID"])
	}
	if id == "" {
		return Session{}, fmt.Errorf("OpenCode session create returned no id")
	}
	return Session{ThreadID: id, Raw: response}, nil
}

func (d *OpenCodeDriver) ResumeSession(ctx context.Context, req ResumeRequest) (Session, error) {
	if strings.TrimSpace(req.ThreadID) == "" {
		return Session{}, fmt.Errorf("threadId required")
	}
	if err := d.ensureStarted(ctx); err != nil {
		return Session{}, err
	}
	var response map[string]any
	if err := d.doJSON(ctx, http.MethodGet, "/session/"+req.ThreadID, nil, &response); err != nil {
		return Session{}, err
	}
	return Session{ThreadID: req.ThreadID, Raw: response}, nil
}

func (d *OpenCodeDriver) StartTurn(_ context.Context, req TurnRequest, sink EventSink) (Turn, error) {
	if err := d.ensureStarted(context.Background()); err != nil {
		return Turn{}, err
	}
	threadID, prompt := strings.TrimSpace(req.ThreadID), strings.TrimSpace(req.Prompt)
	if threadID == "" || prompt == "" {
		return Turn{}, fmt.Errorf("threadId and prompt required")
	}
	turnID := randomIdentifier()
	turnCtx, cancel := context.WithCancel(context.Background())
	d.mu.Lock()
	if d.active[threadID] != nil {
		d.mu.Unlock()
		cancel()
		return Turn{}, fmt.Errorf("OpenCode turn already active")
	}
	d.active[threadID] = cancel
	d.mu.Unlock()
	go func() {
		defer func() { d.mu.Lock(); delete(d.active, threadID); d.mu.Unlock(); cancel() }()
		var response map[string]any
		err := d.doJSON(turnCtx, http.MethodPost, "/session/"+threadID+"/message", map[string]any{"parts": []map[string]any{{"type": "text", "text": prompt}}}, &response)
		if err != nil {
			emit(sink, "driver/failure", threadID, turnID, map[string]any{"error": err.Error()})
			return
		}
		text := nestedText(response["parts"])
		if text == "" {
			text = nestedText(response)
		}
		if text != "" {
			emit(sink, "agent/message/completed", threadID, turnID, map[string]any{"text": text})
		}
		emit(sink, "turn/completed", threadID, turnID, map[string]any{"status": "completed"})
	}()
	return Turn{ThreadID: threadID, TurnID: turnID}, nil
}

func (d *OpenCodeDriver) Steer(context.Context, TurnRequest) error {
	return fmt.Errorf("OpenCode follow-up is queued as a new message")
}
func (d *OpenCodeDriver) Interrupt(ctx context.Context, threadID, _ string) error {
	d.mu.Lock()
	cancel := d.active[threadID]
	d.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return d.doJSON(ctx, http.MethodPost, "/session/"+threadID+"/abort", map[string]any{}, nil)
}
func (d *OpenCodeDriver) Close() error {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return nil
	}
	d.closed = true
	cmd := d.cmd
	active := d.active
	d.active = map[string]context.CancelFunc{}
	d.mu.Unlock()
	for _, cancel := range active {
		cancel()
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}
	return nil
}

func (d *OpenCodeDriver) ensureStarted(ctx context.Context) error {
	d.mu.Lock()
	if d.cmd != nil {
		d.mu.Unlock()
		return nil
	}
	if d.closed {
		d.mu.Unlock()
		return fmt.Errorf("OpenCode driver closed")
	}
	d.mu.Unlock()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	password := randomIdentifier()
	cmd := exec.Command(d.cfg.Command, "serve", "--hostname", "127.0.0.1", "--port", fmt.Sprint(port))
	cmd.Env = append(os.Environ(), "OPENCODE_SERVER_PASSWORD="+password)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start OpenCode server: %w", err)
	}
	d.mu.Lock()
	d.cmd = cmd
	d.baseURL = fmt.Sprintf("http://127.0.0.1:%d", port)
	d.password = password
	d.mu.Unlock()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		probeCtx, cancel := context.WithTimeout(ctx, 400*time.Millisecond)
		err = d.doJSON(probeCtx, http.MethodGet, "/global/health", nil, nil)
		cancel()
		if err == nil {
			return d.addMCP(ctx)
		}
		time.Sleep(100 * time.Millisecond)
	}
	_ = cmd.Process.Kill()
	return fmt.Errorf("OpenCode server did not become ready")
}

func (d *OpenCodeDriver) addMCP(ctx context.Context) error {
	d.mu.Lock()
	if d.mcpAdded || len(d.cfg.MCPCommand) == 0 {
		d.mu.Unlock()
		return nil
	}
	d.mu.Unlock()
	env := map[string]string{}
	for k, v := range d.cfg.MCPEnvironment {
		env[k] = v
	}
	config := map[string]any{"type": "local", "command": d.cfg.MCPCommand, "environment": env, "enabled": true}
	if err := d.doJSON(ctx, http.MethodPost, "/mcp", map[string]any{"name": "exora", "config": config}, nil); err != nil {
		return err
	}
	d.mu.Lock()
	d.mcpAdded = true
	d.mu.Unlock()
	return nil
}

func (d *OpenCodeDriver) doJSON(ctx context.Context, method, route string, body any, out any) error {
	d.mu.Lock()
	baseURL, password := d.baseURL, d.password
	d.mu.Unlock()
	if baseURL == "" {
		return fmt.Errorf("OpenCode server unavailable")
	}
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, baseURL+route, reader)
	if err != nil {
		return err
	}
	req.SetBasicAuth("opencode", password)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("OpenCode returned %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if out != nil && len(bytes.TrimSpace(data)) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}
