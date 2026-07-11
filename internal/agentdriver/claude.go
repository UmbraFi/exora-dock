package agentdriver

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type ClaudeConfig struct {
	Command        string
	MCPCommand     []string
	MCPEnvironment map[string]string
	ProbeTimeout   time.Duration
}

type ClaudeDriver struct {
	cfg    ClaudeConfig
	mu     sync.Mutex
	active map[string]*exec.Cmd
	fresh  map[string]bool
	closed bool
}

func NewClaude(cfg ClaudeConfig) *ClaudeDriver {
	if strings.TrimSpace(cfg.Command) == "" {
		cfg.Command = "claude"
	}
	if cfg.ProbeTimeout <= 0 {
		cfg.ProbeTimeout = 8 * time.Second
	}
	return &ClaudeDriver{cfg: cfg, active: map[string]*exec.Cmd{}, fresh: map[string]bool{}}
}

func (d *ClaudeDriver) Kind() string { return "claude-code" }

func (d *ClaudeDriver) Probe(ctx context.Context) (CapabilityReport, error) {
	report := CapabilityReport{Kind: d.Kind(), Protocol: "stream-json", Methods: []string{"session/start", "session/resume", "turn/start", "turn/interrupt"}, ProbedAt: receivedNow()}
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
	out, authErr := exec.CommandContext(probeCtx, command, "auth", "status").CombinedOutput()
	report.Authenticated = authErr == nil
	report.AuthStatus = strings.TrimSpace(string(out))
	if authErr != nil && report.AuthStatus == "" {
		report.AuthStatus = "Claude Code login required"
	}
	return report, nil
}

func (d *ClaudeDriver) StartSession(_ context.Context, _ SessionRequest) (Session, error) {
	id := randomIdentifier()
	d.mu.Lock()
	d.fresh[id] = true
	d.mu.Unlock()
	return Session{ThreadID: id}, nil
}

func (d *ClaudeDriver) ResumeSession(_ context.Context, req ResumeRequest) (Session, error) {
	if strings.TrimSpace(req.ThreadID) == "" {
		return Session{}, fmt.Errorf("threadId required")
	}
	d.mu.Lock()
	d.fresh[req.ThreadID] = false
	d.mu.Unlock()
	return Session{ThreadID: req.ThreadID}, nil
}

func (d *ClaudeDriver) StartTurn(_ context.Context, req TurnRequest, sink EventSink) (Turn, error) {
	threadID, prompt := strings.TrimSpace(req.ThreadID), strings.TrimSpace(req.Prompt)
	if threadID == "" || prompt == "" {
		return Turn{}, fmt.Errorf("threadId and prompt required")
	}
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return Turn{}, fmt.Errorf("claude driver closed")
	}
	if d.active[threadID] != nil {
		d.mu.Unlock()
		return Turn{}, fmt.Errorf("Claude Code turn already active")
	}
	fresh := d.fresh[threadID]
	d.mu.Unlock()
	turnID := randomIdentifier()
	args := []string{"-p", "--output-format", "stream-json", "--verbose"}
	if fresh {
		args = append(args, "--session-id", threadID)
	} else {
		args = append(args, "--resume", threadID)
	}
	if config := d.mcpConfig(); config != "" {
		args = append(args, "--strict-mcp-config", "--mcp-config", config)
	}
	cmd := exec.Command(d.cfg.Command, args...)
	cmd.Env = os.Environ()
	cmd.Stdin = strings.NewReader(prompt)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return Turn{}, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return Turn{}, err
	}
	if err := cmd.Start(); err != nil {
		return Turn{}, fmt.Errorf("start Claude Code: %w", err)
	}
	d.mu.Lock()
	d.active[threadID] = cmd
	d.fresh[threadID] = false
	d.mu.Unlock()
	go d.readTurn(threadID, turnID, cmd, stdout, stderr, sink)
	return Turn{ThreadID: threadID, TurnID: turnID}, nil
}

func (d *ClaudeDriver) Steer(context.Context, TurnRequest) error {
	return fmt.Errorf("Claude Code queues follow-up turns instead of steering an active turn")
}

func (d *ClaudeDriver) Interrupt(_ context.Context, threadID, _ string) error {
	d.mu.Lock()
	cmd := d.active[strings.TrimSpace(threadID)]
	d.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}

func (d *ClaudeDriver) Close() error {
	d.mu.Lock()
	d.closed = true
	active := d.active
	d.active = map[string]*exec.Cmd{}
	d.mu.Unlock()
	for _, cmd := range active {
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	}
	return nil
}

func (d *ClaudeDriver) readTurn(threadID, turnID string, cmd *exec.Cmd, stdout, stderr io.Reader, sink EventSink) {
	var stderrText strings.Builder
	go func() { _, _ = io.Copy(&stderrText, io.LimitReader(stderr, 1<<20)) }()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		var value map[string]any
		if json.Unmarshal(line, &value) != nil {
			continue
		}
		typeName := strings.ToLower(stringValue(value["type"]))
		switch typeName {
		case "assistant":
			text := nestedText(value)
			if text != "" {
				emit(sink, "agent/message/delta", threadID, turnID, map[string]any{"text": text})
			}
		case "result":
			text := stringValue(value["result"])
			if text != "" {
				emit(sink, "agent/message/completed", threadID, turnID, map[string]any{"text": text})
			}
		default:
			if strings.Contains(typeName, "tool") {
				emit(sink, "tool/event", threadID, turnID, value)
			}
		}
	}
	err := cmd.Wait()
	d.mu.Lock()
	if d.active[threadID] == cmd {
		delete(d.active, threadID)
	}
	d.mu.Unlock()
	if err != nil {
		message := strings.TrimSpace(stderrText.String())
		if message == "" {
			message = err.Error()
		}
		emit(sink, "driver/failure", threadID, turnID, map[string]any{"error": message})
		return
	}
	emit(sink, "turn/completed", threadID, turnID, map[string]any{"status": "completed"})
}

func (d *ClaudeDriver) mcpConfig() string {
	if len(d.cfg.MCPCommand) == 0 {
		return ""
	}
	env := map[string]string{}
	for key, value := range d.cfg.MCPEnvironment {
		env[key] = value
	}
	value := map[string]any{"mcpServers": map[string]any{"exora": map[string]any{"command": d.cfg.MCPCommand[0], "args": d.cfg.MCPCommand[1:], "env": env}}}
	data, _ := json.Marshal(value)
	return string(data)
}
