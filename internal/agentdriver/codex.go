package agentdriver

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type CodexConfig struct {
	Command           string
	AppServerArgs     []string
	Environment       []string
	RequestTimeout    time.Duration
	ProbeTimeout      time.Duration
	SchemaDir         string
	SessionParams     map[string]any
	ResumeParams      map[string]any
	CleanupFiles      []string
	ExpectedMCPServer string
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *rpcError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("app-server rpc %d: %s", e.Code, e.Message)
}

type pendingResponse struct {
	result json.RawMessage
	err    error
}

type sinkRegistration struct {
	threadID string
	turnID   string
	sink     EventSink
	pending  []Event
}

type CodexDriver struct {
	cfg CodexConfig

	startMu  sync.Mutex
	writeMu  sync.Mutex
	mu       sync.Mutex
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	closed   bool
	readErr  error
	pending  map[string]chan pendingResponse
	sinks    map[uint64]sinkRegistration
	nextSink uint64
	nextID   atomic.Int64
	done     chan struct{}
}

func NewCodex(cfg CodexConfig) *CodexDriver {
	if strings.TrimSpace(cfg.Command) == "" {
		cfg.Command = "codex"
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 30 * time.Second
	}
	if cfg.ProbeTimeout <= 0 {
		cfg.ProbeTimeout = 8 * time.Second
	}
	return &CodexDriver{cfg: cfg, pending: map[string]chan pendingResponse{}, sinks: map[uint64]sinkRegistration{}, done: make(chan struct{})}
}

func (d *CodexDriver) Kind() string { return "codex" }

func (d *CodexDriver) Probe(ctx context.Context) (CapabilityReport, error) {
	report := CapabilityReport{Kind: d.Kind(), Protocol: "app-server-jsonl", Methods: append([]string(nil), defaultMethods...), ProbedAt: receivedNow()}
	command, err := exec.LookPath(d.cfg.Command)
	if err != nil {
		report.Error = err.Error()
		return report, nil
	}
	report.Installed = true
	report.Path = command
	probeCtx, cancel := context.WithTimeout(ctx, d.cfg.ProbeTimeout)
	defer cancel()
	if out, err := exec.CommandContext(probeCtx, command, "--version").CombinedOutput(); err == nil {
		report.Version = strings.TrimSpace(string(out))
	} else {
		report.Error = strings.TrimSpace(string(out))
	}
	if out, err := exec.CommandContext(probeCtx, command, "login", "status").CombinedOutput(); err == nil {
		report.Authenticated = true
		report.AuthStatus = strings.TrimSpace(string(out))
	} else {
		report.AuthStatus = strings.TrimSpace(string(out))
	}
	if values, generated := d.probeSchema(probeCtx, command); generated {
		report.SchemaGenerated = true
		report.SandboxValues = values
	}
	return report, nil
}

func (d *CodexDriver) probeSchema(ctx context.Context, command string) ([]string, bool) {
	dir := strings.TrimSpace(d.cfg.SchemaDir)
	remove := false
	if dir == "" {
		var err error
		dir, err = os.MkdirTemp("", "exora-codex-schema-")
		if err != nil {
			return nil, false
		}
		remove = true
	}
	if remove {
		defer os.RemoveAll(dir)
	}
	cmd := exec.CommandContext(ctx, command, "app-server", "generate-json-schema", "--out", dir)
	cmd.Env = append(os.Environ(), d.cfg.Environment...)
	if err := cmd.Run(); err != nil {
		return nil, false
	}
	values := map[string]struct{}{}
	_ = filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !strings.HasSuffix(strings.ToLower(path), ".json") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		collectSandboxEnums(data, values)
		return nil
	})
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out, true
}

func collectSandboxEnums(data []byte, values map[string]struct{}) {
	var root any
	if json.Unmarshal(data, &root) != nil {
		return
	}
	var walk func(any, bool)
	walk = func(value any, inSandbox bool) {
		switch typed := value.(type) {
		case map[string]any:
			for key, child := range typed {
				lower := strings.ToLower(key)
				walk(child, inSandbox || strings.Contains(lower, "sandbox"))
			}
		case []any:
			if inSandbox {
				for _, item := range typed {
					if text, ok := item.(string); ok && text != "" {
						values[text] = struct{}{}
					}
				}
			}
			for _, child := range typed {
				walk(child, inSandbox)
			}
		}
	}
	walk(root, false)
}

func (d *CodexDriver) StartSession(ctx context.Context, req SessionRequest) (Session, error) {
	params := mergeParams(d.cfg.SessionParams, req.AdditionalParams)
	if cwd := strings.TrimSpace(req.CWD); cwd != "" {
		params["cwd"] = cwd
	}
	if _, requested := params["runtimeWorkspaceRoots"]; requested {
		return Session{}, fmt.Errorf("runtimeWorkspaceRoots requires initialize.experimentalApi capability negotiation, which this driver does not enable")
	}
	if err := d.applyPermissionProfile(ctx, params, req.PermissionProfile); err != nil {
		return Session{}, err
	}
	raw, err := d.request(ctx, "thread/start", params)
	if err != nil {
		return Session{}, err
	}
	threadID := firstNestedString(raw, []string{"thread", "id"}, []string{"threadId"}, []string{"id"})
	if threadID == "" {
		return Session{}, fmt.Errorf("thread/start returned no thread id")
	}
	if err := d.verifyMCPServer(ctx, threadID); err != nil {
		return Session{}, err
	}
	return Session{ThreadID: threadID, Raw: decodeMap(raw)}, nil
}

func (d *CodexDriver) verifyMCPServer(ctx context.Context, threadID string) error {
	expected := strings.TrimSpace(d.cfg.ExpectedMCPServer)
	if expected == "" {
		return nil
	}
	raw, err := d.request(ctx, "mcpServerStatus/list", map[string]any{
		"threadId": threadID,
		"detail":   "toolsAndAuthOnly",
	})
	if err != nil {
		return fmt.Errorf("verify MCP server %q: %w", expected, err)
	}
	var response struct {
		Data []struct {
			Name  string         `json:"name"`
			Tools map[string]any `json:"tools"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return fmt.Errorf("verify MCP server %q response: %w", expected, err)
	}
	available := make([]string, 0, len(response.Data))
	for _, server := range response.Data {
		available = append(available, server.Name)
		if server.Name == expected {
			if len(server.Tools) == 0 {
				return fmt.Errorf("MCP server %q loaded without tools", expected)
			}
			return nil
		}
	}
	return fmt.Errorf("MCP server %q was not loaded; available servers: %s", expected, strings.Join(available, ", "))
}

func (d *CodexDriver) ResumeSession(ctx context.Context, req ResumeRequest) (Session, error) {
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" {
		return Session{}, fmt.Errorf("threadId required")
	}
	params := mergeParams(d.cfg.ResumeParams, req.AdditionalParams)
	if _, requested := params["runtimeWorkspaceRoots"]; requested {
		return Session{}, fmt.Errorf("runtimeWorkspaceRoots requires initialize.experimentalApi capability negotiation, which this driver does not enable")
	}
	params["threadId"] = threadID
	if err := d.applyPermissionProfile(ctx, params, req.PermissionProfile); err != nil {
		return Session{}, err
	}
	raw, err := d.request(ctx, "thread/resume", params)
	if err != nil {
		return Session{}, err
	}
	returned := firstNestedString(raw, []string{"thread", "id"}, []string{"threadId"}, []string{"id"})
	if returned != "" && returned != threadID {
		return Session{}, fmt.Errorf("thread/resume returned mismatched thread id %q", returned)
	}
	return Session{ThreadID: threadID, Raw: decodeMap(raw)}, nil
}

func (d *CodexDriver) StartTurn(ctx context.Context, req TurnRequest, sink EventSink) (Turn, error) {
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" {
		return Turn{}, fmt.Errorf("threadId required")
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return Turn{}, fmt.Errorf("prompt required")
	}
	params := cloneParams(req.Params)
	params["threadId"] = threadID
	if _, ok := params["input"]; !ok {
		params["input"] = []map[string]any{{"type": "text", "text": prompt}}
	}
	sinkID := d.addSink(sinkRegistration{threadID: threadID, sink: sink})
	raw, err := d.request(ctx, "turn/start", params)
	if err != nil {
		d.removeSink(sinkID)
		return Turn{}, err
	}
	turnID := firstNestedString(raw, []string{"turn", "id"}, []string{"turnId"}, []string{"id"})
	if turnID == "" {
		d.removeSink(sinkID)
		return Turn{}, fmt.Errorf("turn/start returned no turn id")
	}
	d.activateSink(sinkID, turnID)
	return Turn{ThreadID: threadID, TurnID: turnID, Raw: decodeMap(raw)}, nil
}

func (d *CodexDriver) Steer(ctx context.Context, req TurnRequest) error {
	threadID := strings.TrimSpace(req.ThreadID)
	turnID := strings.TrimSpace(req.TurnID)
	prompt := strings.TrimSpace(req.Prompt)
	if threadID == "" || turnID == "" || prompt == "" {
		return fmt.Errorf("threadId, turnId and prompt required")
	}
	params := cloneParams(req.Params)
	params["threadId"] = threadID
	params["expectedTurnId"] = turnID
	if _, ok := params["input"]; !ok {
		params["input"] = []map[string]any{{"type": "text", "text": prompt}}
	}
	_, err := d.request(ctx, "turn/steer", params)
	return err
}

func (d *CodexDriver) Interrupt(ctx context.Context, threadID, turnID string) error {
	threadID = strings.TrimSpace(threadID)
	turnID = strings.TrimSpace(turnID)
	if threadID == "" {
		return fmt.Errorf("threadId required")
	}
	params := map[string]any{"threadId": threadID}
	if turnID != "" {
		params["turnId"] = turnID
	}
	_, err := d.request(ctx, "turn/interrupt", params)
	return err
}

func (d *CodexDriver) request(ctx context.Context, method string, params any) (json.RawMessage, error) {
	if err := d.ensureStarted(ctx); err != nil {
		return nil, err
	}
	id := d.nextID.Add(1)
	key := strconv.FormatInt(id, 10)
	response := make(chan pendingResponse, 1)
	d.mu.Lock()
	if d.readErr != nil {
		err := d.readErr
		d.mu.Unlock()
		return nil, err
	}
	d.pending[key] = response
	d.mu.Unlock()
	payload := map[string]any{"id": id, "method": method, "params": params}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	d.writeMu.Lock()
	_, err = d.stdin.Write(append(data, '\n'))
	d.writeMu.Unlock()
	if err != nil {
		d.removePending(key)
		return nil, fmt.Errorf("write app-server request: %w", err)
	}
	timeout := d.cfg.RequestTimeout
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		d.removePending(key)
		return nil, ctx.Err()
	case <-timer.C:
		d.removePending(key)
		return nil, fmt.Errorf("app-server %s timed out after %s", method, timeout)
	case result := <-response:
		return result.result, result.err
	case <-d.done:
		return nil, fmt.Errorf("app-server stopped")
	}
}

func (d *CodexDriver) ensureStarted(ctx context.Context) error {
	d.startMu.Lock()
	closeOnError := false
	defer func() {
		d.startMu.Unlock()
		if closeOnError {
			_ = d.Close()
		}
	}()
	d.mu.Lock()
	if d.cmd != nil {
		err := d.readErr
		d.mu.Unlock()
		return err
	}
	if d.closed {
		d.mu.Unlock()
		return fmt.Errorf("codex driver closed")
	}
	d.mu.Unlock()
	args := append([]string(nil), d.cfg.AppServerArgs...)
	if len(args) == 0 {
		args = []string{"app-server"}
	}
	cmd := exec.Command(d.cfg.Command, args...)
	cmd.Env = append(os.Environ(), d.cfg.Environment...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start codex app-server: %w", err)
	}
	d.mu.Lock()
	d.cmd = cmd
	d.stdin = stdin
	d.mu.Unlock()
	go d.readLoop(stdout)
	go d.drainStderr(stderr)
	initParams := map[string]any{"clientInfo": map[string]any{"name": "exora-dock", "title": "Exora Dock", "version": "2.0.0"}}
	initCtx, cancel := context.WithTimeout(ctx, d.cfg.RequestTimeout)
	defer cancel()
	if _, err := d.requestInitialized(initCtx, initParams); err != nil {
		closeOnError = true
		return err
	}
	if err := d.notify("initialized", map[string]any{}); err != nil {
		closeOnError = true
		return fmt.Errorf("send initialized notification: %w", err)
	}
	return nil
}

func (d *CodexDriver) requestInitialized(ctx context.Context, params any) (json.RawMessage, error) {
	// ensureStarted cannot recursively call request while holding startMu.
	id := d.nextID.Add(1)
	key := strconv.FormatInt(id, 10)
	response := make(chan pendingResponse, 1)
	d.mu.Lock()
	d.pending[key] = response
	d.mu.Unlock()
	data, _ := json.Marshal(map[string]any{"id": id, "method": "initialize", "params": params})
	d.writeMu.Lock()
	_, err := d.stdin.Write(append(data, '\n'))
	d.writeMu.Unlock()
	if err != nil {
		return nil, err
	}
	select {
	case <-ctx.Done():
		d.removePending(key)
		return nil, ctx.Err()
	case result := <-response:
		return result.result, result.err
	case <-d.done:
		return nil, fmt.Errorf("app-server stopped")
	}
}

func (d *CodexDriver) notify(method string, params any) error {
	data, err := json.Marshal(map[string]any{"method": method, "params": params})
	if err != nil {
		return err
	}
	d.writeMu.Lock()
	defer d.writeMu.Unlock()
	if d.stdin == nil {
		return fmt.Errorf("app-server stdin unavailable")
	}
	_, err = d.stdin.Write(append(data, '\n'))
	return err
}

func (d *CodexDriver) readLoop(stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		d.handleLine(append([]byte(nil), line...))
	}
	err := scanner.Err()
	if err == nil {
		err = io.EOF
	}
	d.failAll(fmt.Errorf("codex app-server output closed: %w", err))
}

func (d *CodexDriver) handleLine(line []byte) {
	var envelope map[string]json.RawMessage
	if json.Unmarshal(line, &envelope) != nil {
		return
	}
	if rawID, ok := envelope["id"]; ok && len(rawID) > 0 && string(rawID) != "null" {
		// App-server can initiate requests on the same bidirectional stream.
		// This driver never grants interactive approvals: automation threads use
		// approvalPolicy=never and any unexpected request is rejected explicitly
		// so the server cannot hang waiting for a response.
		if methodRaw, hasMethod := envelope["method"]; hasMethod {
			var method string
			_ = json.Unmarshal(methodRaw, &method)
			d.rejectServerRequest(rawID, method)
			return
		}
		key := normalizeID(rawID)
		var response rpcResponse
		if json.Unmarshal(line, &response) != nil {
			return
		}
		d.mu.Lock()
		pending := d.pending[key]
		delete(d.pending, key)
		d.mu.Unlock()
		if pending != nil {
			if response.Error != nil {
				pending <- pendingResponse{err: response.Error}
			} else {
				pending <- pendingResponse{result: response.Result}
			}
		}
		return
	}
	var notification struct {
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	if json.Unmarshal(line, &notification) != nil || notification.Method == "" {
		return
	}
	event := Event{Method: notification.Method, Params: notification.Params, Received: receivedNow()}
	event.ThreadID = firstNestedString(notification.Params, []string{"threadId"}, []string{"thread", "id"})
	event.TurnID = firstNestedString(notification.Params, []string{"turnId"}, []string{"turn", "id"})
	d.mu.Lock()
	registrations := make([]sinkRegistration, 0, len(d.sinks))
	for id, reg := range d.sinks {
		// turn/start can emit notifications before its response gives us the new
		// turn ID. Keep those events private until the registration is activated;
		// otherwise a late event from the previous turn can become the new reply.
		if reg.turnID == "" {
			reg.pending = append(reg.pending, event)
			d.sinks[id] = reg
			continue
		}
		registrations = append(registrations, reg)
		if isTerminalEvent(notification.Method, event.TurnID, reg) {
			delete(d.sinks, id)
		}
	}
	d.mu.Unlock()
	for _, reg := range registrations {
		if reg.sink == nil {
			continue
		}
		if reg.threadID != "" && event.ThreadID != "" && reg.threadID != event.ThreadID {
			continue
		}
		if reg.turnID != "" && event.TurnID != "" && reg.turnID != event.TurnID {
			continue
		}
		reg.sink.OnEvent(event)
	}
}

func (d *CodexDriver) rejectServerRequest(id json.RawMessage, method string) {
	var wireID any
	if err := json.Unmarshal(id, &wireID); err != nil {
		return
	}
	data, err := json.Marshal(map[string]any{
		"id": wireID,
		"error": map[string]any{
			"code":    -32601,
			"message": "Exora automation does not handle app-server request " + strings.TrimSpace(method),
		},
	})
	if err != nil {
		return
	}
	d.writeMu.Lock()
	if d.stdin != nil {
		_, _ = d.stdin.Write(append(data, '\n'))
	}
	d.writeMu.Unlock()
}

func isTerminalEvent(method, turnID string, reg sinkRegistration) bool {
	lower := strings.ToLower(method)
	return (strings.Contains(lower, "turn/completed") || strings.Contains(lower, "turn/failed") || strings.Contains(lower, "turn/cancel")) && (turnID == "" || reg.turnID == "" || turnID == reg.turnID)
}

func (d *CodexDriver) drainStderr(stderr io.Reader) { _, _ = io.Copy(io.Discard, stderr) }

func (d *CodexDriver) failAll(err error) {
	d.mu.Lock()
	firstFailure := d.readErr == nil
	if d.readErr == nil {
		d.readErr = err
	}
	pending := d.pending
	d.pending = map[string]chan pendingResponse{}
	registrations := []sinkRegistration{}
	if firstFailure {
		registrations = make([]sinkRegistration, 0, len(d.sinks))
		for _, registration := range d.sinks {
			registrations = append(registrations, registration)
		}
		d.sinks = map[uint64]sinkRegistration{}
	}
	d.mu.Unlock()
	for _, ch := range pending {
		ch <- pendingResponse{err: err}
	}
	if len(registrations) > 0 {
		params, _ := json.Marshal(map[string]any{"error": err.Error()})
		for _, registration := range registrations {
			if registration.sink != nil {
				registration.sink.OnEvent(Event{
					Method: "driver/stopped", ThreadID: registration.threadID, TurnID: registration.turnID,
					Params: params, Received: receivedNow(),
				})
			}
		}
	}
}

func (d *CodexDriver) Close() error {
	d.startMu.Lock()
	defer d.startMu.Unlock()
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return nil
	}
	d.closed = true
	cmd := d.cmd
	stdin := d.stdin
	d.mu.Unlock()
	closeQuietly(stdin)
	var err error
	if cmd != nil && cmd.Process != nil {
		err = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}
	select {
	case <-d.done:
	default:
		close(d.done)
	}
	for _, path := range d.cfg.CleanupFiles {
		path = strings.TrimSpace(path)
		if path != "" {
			_ = os.Remove(path)
		}
	}
	return err
}

func (d *CodexDriver) addSink(reg sinkRegistration) uint64 {
	if reg.sink == nil {
		return 0
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.nextSink++
	d.sinks[d.nextSink] = reg
	return d.nextSink
}
func (d *CodexDriver) removeSink(id uint64) {
	if id == 0 {
		return
	}
	d.mu.Lock()
	delete(d.sinks, id)
	d.mu.Unlock()
}

func (d *CodexDriver) activateSink(id uint64, turnID string) {
	d.mu.Lock()
	reg, ok := d.sinks[id]
	if !ok {
		d.mu.Unlock()
		return
	}
	reg.turnID = turnID
	pending := reg.pending
	reg.pending = nil
	d.sinks[id] = reg
	d.mu.Unlock()

	for _, event := range pending {
		if event.TurnID != "" && event.TurnID != turnID {
			continue
		}
		if reg.sink != nil {
			reg.sink.OnEvent(event)
		}
		if isTerminalEvent(event.Method, event.TurnID, reg) {
			d.removeSink(id)
			return
		}
	}
}
func (d *CodexDriver) removePending(id string) { d.mu.Lock(); delete(d.pending, id); d.mu.Unlock() }

func normalizeID(raw json.RawMessage) string {
	var number json.Number
	if json.Unmarshal(raw, &number) == nil {
		return number.String()
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	return strings.Trim(string(raw), "\"")
}
func cloneParams(input map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range input {
		out[key] = value
	}
	return out
}

func mergeParams(inputs ...map[string]any) map[string]any {
	out := map[string]any{}
	for _, input := range inputs {
		for key, value := range input {
			out[key] = value
		}
	}
	return out
}

func (d *CodexDriver) applyPermissionProfile(ctx context.Context, params map[string]any, profile string) error {
	profileID := permissionProfileID(profile)
	if profileID == "" {
		return nil
	}
	if _, legacySandbox := params["sandbox"]; legacySandbox {
		return fmt.Errorf("permission profile %q conflicts with legacy sandbox parameter", profile)
	}
	listParams := map[string]any{}
	if cwd, _ := params["cwd"].(string); strings.TrimSpace(cwd) != "" {
		listParams["cwd"] = strings.TrimSpace(cwd)
	}
	raw, err := d.request(ctx, "permissionProfile/list", listParams)
	if err != nil {
		return fmt.Errorf("Codex permission-profile protocol unavailable: %w", err)
	}
	var response struct {
		Data []struct {
			ID      string `json:"id"`
			Allowed bool   `json:"allowed"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return fmt.Errorf("Codex permissionProfile/list returned invalid data: %w", err)
	}
	found := false
	for _, available := range response.Data {
		if strings.EqualFold(strings.TrimSpace(available.ID), profileID) {
			found = true
			if !available.Allowed {
				return fmt.Errorf("Codex permission profile %q is disallowed by local requirements", profileID)
			}
			profileID = strings.TrimSpace(available.ID)
			break
		}
	}
	if !found {
		return fmt.Errorf("Codex permission profile %q is unavailable in the local app-server", profileID)
	}
	config := map[string]any{}
	if existing, ok := params["config"]; ok && existing != nil {
		mapped, ok := existing.(map[string]any)
		if !ok {
			return fmt.Errorf("thread config must be an object before applying permission profile %q", profileID)
		}
		config = cloneParams(mapped)
	}
	config["default_permissions"] = profileID
	params["config"] = config
	return nil
}

func permissionProfileID(profile string) string {
	profile = strings.ToLower(strings.TrimSpace(profile))
	switch profile {
	case "workspace-write", "workspace", ":workspace":
		return ":workspace"
	case "read-only", "readonly", ":read-only":
		return ":read-only"
	case "danger-full-access", ":danger-full-access":
		return ":danger-full-access"
	default:
		return profile
	}
}
func decodeMap(raw json.RawMessage) map[string]any {
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return out
}
func firstNestedString(raw json.RawMessage, paths ...[]string) string {
	var root any
	if json.Unmarshal(raw, &root) != nil {
		return ""
	}
	for _, path := range paths {
		value := root
		for _, key := range path {
			mapped, ok := value.(map[string]any)
			if !ok {
				value = nil
				break
			}
			value = mapped[key]
		}
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

var _ Driver = (*CodexDriver)(nil)
var _ = errors.Is
