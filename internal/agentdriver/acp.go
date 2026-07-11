package agentdriver

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type ACPConfig struct {
	Kind           string
	Command        string
	Args           []string
	MCPCommand     []string
	MCPEnvironment map[string]string
	ProbeTimeout   time.Duration
	RequestTimeout time.Duration
}

type acpResult struct {
	raw json.RawMessage
	err error
}

type ACPDriver struct {
	cfg     ACPConfig
	startMu sync.Mutex
	writeMu sync.Mutex
	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	pending map[string]chan acpResult
	sinks   map[string]EventSink
	closed  bool
	readErr error
	nextID  atomic.Int64
}

func NewACP(cfg ACPConfig) *ACPDriver {
	if cfg.ProbeTimeout <= 0 {
		cfg.ProbeTimeout = 8 * time.Second
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 30 * time.Second
	}
	return &ACPDriver{cfg: cfg, pending: map[string]chan acpResult{}, sinks: map[string]EventSink{}}
}

func (d *ACPDriver) Kind() string { return d.cfg.Kind }

func (d *ACPDriver) Probe(ctx context.Context) (CapabilityReport, error) {
	report := CapabilityReport{Kind: d.Kind(), Protocol: "acp-jsonrpc-stdio", Methods: []string{"initialize", "session/new", "session/load", "session/prompt", "session/cancel"}, ProbedAt: receivedNow()}
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
	// ACP agents own their login state. A failed initialize/prompt produces an
	// actionable session error without Exora reading or storing credentials.
	report.Authenticated = true
	report.AuthStatus = "managed by local CLI"
	return report, nil
}

func (d *ACPDriver) StartSession(ctx context.Context, req SessionRequest) (Session, error) {
	params := map[string]any{"cwd": req.CWD, "mcpServers": d.mcpServers()}
	raw, err := d.request(ctx, "session/new", params)
	if err != nil {
		return Session{}, err
	}
	id := firstNestedString(raw, []string{"sessionId"}, []string{"session", "id"}, []string{"id"})
	if id == "" {
		return Session{}, fmt.Errorf("ACP session/new returned no session id")
	}
	return Session{ThreadID: id, Raw: decodeMap(raw)}, nil
}

func (d *ACPDriver) ResumeSession(ctx context.Context, req ResumeRequest) (Session, error) {
	if strings.TrimSpace(req.ThreadID) == "" {
		return Session{}, fmt.Errorf("threadId required")
	}
	_, err := d.request(ctx, "session/load", map[string]any{"sessionId": req.ThreadID, "cwd": req.AdditionalParams["cwd"], "mcpServers": d.mcpServers()})
	if err != nil {
		return Session{}, err
	}
	return Session{ThreadID: req.ThreadID}, nil
}

func (d *ACPDriver) StartTurn(_ context.Context, req TurnRequest, sink EventSink) (Turn, error) {
	threadID, prompt := strings.TrimSpace(req.ThreadID), strings.TrimSpace(req.Prompt)
	if threadID == "" || prompt == "" {
		return Turn{}, fmt.Errorf("threadId and prompt required")
	}
	turnID := randomIdentifier()
	d.mu.Lock()
	d.sinks[threadID] = sink
	d.mu.Unlock()
	go func() {
		raw, err := d.request(context.Background(), "session/prompt", map[string]any{"sessionId": threadID, "prompt": []map[string]any{{"type": "text", "text": prompt}}})
		if err != nil {
			emit(sink, "driver/failure", threadID, turnID, map[string]any{"error": err.Error()})
			return
		}
		text := nestedText(decodeAny(raw))
		if text != "" {
			emit(sink, "agent/message/completed", threadID, turnID, map[string]any{"text": text})
		}
		emit(sink, "turn/completed", threadID, turnID, map[string]any{"status": "completed"})
		d.mu.Lock()
		delete(d.sinks, threadID)
		d.mu.Unlock()
	}()
	return Turn{ThreadID: threadID, TurnID: turnID}, nil
}

func (d *ACPDriver) Steer(context.Context, TurnRequest) error {
	return fmt.Errorf("ACP follow-up is queued as a new prompt")
}

func (d *ACPDriver) Interrupt(ctx context.Context, threadID, _ string) error {
	_, err := d.request(ctx, "session/cancel", map[string]any{"sessionId": strings.TrimSpace(threadID)})
	return err
}

func (d *ACPDriver) Close() error {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return nil
	}
	d.closed = true
	cmd, stdin := d.cmd, d.stdin
	d.cmd, d.stdin = nil, nil
	d.mu.Unlock()
	closeQuietly(stdin)
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}
	return nil
}

func (d *ACPDriver) request(ctx context.Context, method string, params any) (json.RawMessage, error) {
	if err := d.ensureStarted(ctx); err != nil {
		return nil, err
	}
	id := d.nextID.Add(1)
	key := strconv.FormatInt(id, 10)
	result := make(chan acpResult, 1)
	d.mu.Lock()
	d.pending[key] = result
	d.mu.Unlock()
	data, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	d.writeMu.Lock()
	_, err := d.stdin.Write(append(data, '\n'))
	d.writeMu.Unlock()
	if err != nil {
		return nil, err
	}
	timer := time.NewTimer(d.cfg.RequestTimeout)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return nil, fmt.Errorf("ACP %s timed out", method)
	case response := <-result:
		return response.raw, response.err
	}
}

func (d *ACPDriver) ensureStarted(ctx context.Context) error {
	d.startMu.Lock()
	defer d.startMu.Unlock()
	d.mu.Lock()
	if d.cmd != nil {
		err := d.readErr
		d.mu.Unlock()
		return err
	}
	if d.closed {
		d.mu.Unlock()
		return fmt.Errorf("ACP driver closed")
	}
	d.mu.Unlock()
	cmd := exec.Command(d.cfg.Command, d.cfg.Args...)
	cmd.Env = os.Environ()
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
		return fmt.Errorf("start %s ACP: %w", d.cfg.Kind, err)
	}
	d.mu.Lock()
	d.cmd, d.stdin = cmd, stdin
	d.mu.Unlock()
	go d.readLoop(stdout)
	go io.Copy(io.Discard, io.LimitReader(stderr, 2<<20))
	initID := d.nextID.Add(1)
	key := strconv.FormatInt(initID, 10)
	response := make(chan acpResult, 1)
	d.mu.Lock()
	d.pending[key] = response
	d.mu.Unlock()
	data, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": initID, "method": "initialize", "params": map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}, "clientInfo": map[string]any{"name": "exora-dock", "version": "2.0.0"}}})
	d.writeMu.Lock()
	_, err = stdin.Write(append(data, '\n'))
	d.writeMu.Unlock()
	if err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case result := <-response:
		return result.err
	case <-time.After(d.cfg.RequestTimeout):
		return fmt.Errorf("ACP initialize timed out")
	}
}

func (d *ACPDriver) readLoop(reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) > 0 {
			d.handleLine(append([]byte(nil), line...))
		}
	}
	err := scanner.Err()
	if err == nil {
		err = io.EOF
	}
	d.mu.Lock()
	d.readErr = err
	pending := d.pending
	d.pending = map[string]chan acpResult{}
	d.mu.Unlock()
	for _, ch := range pending {
		ch <- acpResult{err: fmt.Errorf("ACP output closed: %w", err)}
	}
}

func (d *ACPDriver) handleLine(line []byte) {
	var env map[string]json.RawMessage
	if json.Unmarshal(line, &env) != nil {
		return
	}
	if idRaw := env["id"]; len(idRaw) > 0 && string(idRaw) != "null" && len(env["method"]) == 0 {
		key := normalizeID(idRaw)
		var rpc struct {
			Result json.RawMessage `json:"result"`
			Error  *rpcError       `json:"error"`
		}
		_ = json.Unmarshal(line, &rpc)
		d.mu.Lock()
		ch := d.pending[key]
		delete(d.pending, key)
		d.mu.Unlock()
		if ch != nil {
			if rpc.Error != nil {
				ch <- acpResult{err: rpc.Error}
			} else {
				ch <- acpResult{raw: rpc.Result}
			}
		}
		return
	}
	var note struct {
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	if json.Unmarshal(line, &note) != nil || note.Method == "" {
		return
	}
	threadID := firstNestedString(note.Params, []string{"sessionId"}, []string{"session", "id"})
	d.mu.Lock()
	sink := d.sinks[threadID]
	d.mu.Unlock()
	if sink == nil {
		return
	}
	method := note.Method
	if strings.Contains(strings.ToLower(method), "update") {
		method = "agent/message/delta"
	}
	sink.OnEvent(Event{Method: method, ThreadID: threadID, Params: note.Params, Received: receivedNow()})
}

func (d *ACPDriver) mcpServers() []map[string]any {
	if len(d.cfg.MCPCommand) == 0 {
		return nil
	}
	env := map[string]string{}
	for k, v := range d.cfg.MCPEnvironment {
		env[k] = v
	}
	return []map[string]any{{"name": "exora", "command": d.cfg.MCPCommand[0], "args": d.cfg.MCPCommand[1:], "env": env}}
}

func decodeAny(raw json.RawMessage) any { var value any; _ = json.Unmarshal(raw, &value); return value }
