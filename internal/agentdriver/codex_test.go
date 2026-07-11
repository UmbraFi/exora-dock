package agentdriver

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCodexDriverStartResumeTurnInterrupt(t *testing.T) {
	d := NewCodex(CodexConfig{Command: os.Args[0], AppServerArgs: []string{"-test.run=TestCodexHelperProcess", "--"}, Environment: []string{"GO_WANT_CODEX_HELPER=1"}, RequestTimeout: 3 * time.Second})
	defer d.Close()
	ctx := context.Background()
	session, err := d.StartSession(ctx, SessionRequest{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if session.ThreadID != "thread-1" {
		t.Fatalf("thread id=%q", session.ThreadID)
	}
	resumed, err := d.ResumeSession(ctx, ResumeRequest{ThreadID: session.ThreadID})
	if err != nil || resumed.ThreadID != session.ThreadID {
		t.Fatalf("resume=%#v err=%v", resumed, err)
	}
	var mu sync.Mutex
	events := []Event{}
	turn, err := d.StartTurn(ctx, TurnRequest{ThreadID: session.ThreadID, Prompt: "do work"}, EventSinkFunc(func(event Event) { mu.Lock(); events = append(events, event); mu.Unlock() }))
	if err != nil {
		t.Fatal(err)
	}
	if turn.TurnID != "turn-1" {
		t.Fatalf("turn id=%q", turn.TurnID)
	}
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	count := len(events)
	mu.Unlock()
	if count == 0 {
		t.Fatal("expected streamed notification")
	}
	if err := d.Interrupt(ctx, session.ThreadID, turn.TurnID); err != nil {
		t.Fatal(err)
	}
}

func TestCodexDriverRevalidatesPermissionProfileOnResume(t *testing.T) {
	d := NewCodex(CodexConfig{Command: os.Args[0], AppServerArgs: []string{"-test.run=TestCodexHelperProcess", "--"}, Environment: []string{"GO_WANT_CODEX_HELPER=1"}, RequestTimeout: 3 * time.Second})
	defer d.Close()
	resumed, err := d.ResumeSession(context.Background(), ResumeRequest{ThreadID: "thread-1", PermissionProfile: "read-only", AdditionalParams: map[string]any{"cwd": t.TempDir()}})
	if err != nil {
		t.Fatal(err)
	}
	params, _ := resumed.Raw["receivedParams"].(map[string]any)
	config, _ := params["config"].(map[string]any)
	if config["default_permissions"] != ":read-only" {
		t.Fatalf("resume permission config = %#v", config)
	}
}

func TestCodexDriverRejectsMismatchedResume(t *testing.T) {
	d := NewCodex(CodexConfig{Command: os.Args[0], AppServerArgs: []string{"-test.run=TestCodexHelperProcess", "--", "mismatch"}, Environment: []string{"GO_WANT_CODEX_HELPER=1"}, RequestTimeout: 3 * time.Second})
	defer d.Close()
	_, err := d.ResumeSession(context.Background(), ResumeRequest{ThreadID: "expected"})
	if err == nil || !strings.Contains(err.Error(), "mismatched") {
		t.Fatalf("err=%v", err)
	}
}

func TestCodexDriverInitializationFailureDoesNotDeadlock(t *testing.T) {
	d := NewCodex(CodexConfig{Command: os.Args[0], AppServerArgs: []string{"-test.run=TestCodexHelperProcess", "--", "initialize-error"}, Environment: []string{"GO_WANT_CODEX_HELPER=1"}, RequestTimeout: time.Second})
	done := make(chan error, 1)
	go func() {
		_, err := d.StartSession(context.Background(), SessionRequest{})
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "initialize rejected") {
			t.Fatalf("error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("initialization failure deadlocked driver cleanup")
	}
}

func TestCodexDriverReportsAppServerCrashToActiveTurn(t *testing.T) {
	d := NewCodex(CodexConfig{Command: os.Args[0], AppServerArgs: []string{"-test.run=TestCodexHelperProcess", "--", "crash-after-turn"}, Environment: []string{"GO_WANT_CODEX_HELPER=1"}, RequestTimeout: time.Second})
	defer d.Close()
	session, err := d.StartSession(context.Background(), SessionRequest{})
	if err != nil {
		t.Fatal(err)
	}
	events := make(chan Event, 4)
	if _, err := d.StartTurn(context.Background(), TurnRequest{ThreadID: session.ThreadID, Prompt: "work"}, EventSinkFunc(func(event Event) { events <- event })); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for {
		select {
		case event := <-events:
			if event.Method == "driver/stopped" {
				return
			}
		case <-deadline:
			t.Fatal("active turn received no driver/stopped event")
		}
	}
}

func TestCodexDriverUsesValidatedNamedPermissionProfile(t *testing.T) {
	d := NewCodex(CodexConfig{Command: os.Args[0], AppServerArgs: []string{"-test.run=TestCodexHelperProcess", "--"}, Environment: []string{"GO_WANT_CODEX_HELPER=1"}, RequestTimeout: 3 * time.Second})
	defer d.Close()
	session, err := d.StartSession(context.Background(), SessionRequest{CWD: t.TempDir(), PermissionProfile: "workspace-write"})
	if err != nil {
		t.Fatal(err)
	}
	params, _ := session.Raw["receivedParams"].(map[string]any)
	if _, guessedSandbox := params["sandbox"]; guessedSandbox {
		t.Fatalf("driver guessed legacy sandbox enum: %#v", params)
	}
	config, _ := params["config"].(map[string]any)
	if config["default_permissions"] != ":workspace" {
		t.Fatalf("thread permission config = %#v", config)
	}
}

func TestCodexDriverRejectsUnknownOrChangedPermissionProfileProtocol(t *testing.T) {
	tests := []struct {
		name, mode, profile, want string
	}{
		{name: "unknown profile", profile: "missing-profile", want: "unavailable"},
		{name: "protocol method removed", mode: "no-permission-profile-method", profile: "workspace-write", want: "protocol unavailable"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			args := []string{"-test.run=TestCodexHelperProcess", "--"}
			if tc.mode != "" {
				args = append(args, tc.mode)
			}
			d := NewCodex(CodexConfig{Command: os.Args[0], AppServerArgs: args, Environment: []string{"GO_WANT_CODEX_HELPER=1"}, RequestTimeout: 3 * time.Second})
			defer d.Close()
			_, err := d.StartSession(context.Background(), SessionRequest{CWD: t.TempDir(), PermissionProfile: tc.profile})
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestCodexDriverRejectsUnnegotiatedRuntimeWorkspaceRoots(t *testing.T) {
	d := NewCodex(CodexConfig{Command: os.Args[0]})
	_, err := d.StartSession(context.Background(), SessionRequest{AdditionalParams: map[string]any{"runtimeWorkspaceRoots": []string{t.TempDir()}}})
	if err == nil || !strings.Contains(err.Error(), "experimentalApi") {
		t.Fatalf("error = %v", err)
	}
}

func TestCodexHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_CODEX_HELPER") != "1" {
		return
	}
	mode := ""
	if len(os.Args) > 0 {
		mode = os.Args[len(os.Args)-1]
	}
	mismatch := mode == "mismatch"
	scanner := bufio.NewScanner(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	initialized := false
	for scanner.Scan() {
		var envelope map[string]json.RawMessage
		if json.Unmarshal(scanner.Bytes(), &envelope) != nil {
			continue
		}
		var req struct {
			ID     any            `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if json.Unmarshal(scanner.Bytes(), &req) != nil {
			continue
		}
		if _, hasJSONRPC := envelope["jsonrpc"]; hasJSONRPC {
			_ = encoder.Encode(map[string]any{"id": req.ID, "error": map[string]any{"code": -32600, "message": "jsonrpc header must be omitted"}})
			continue
		}
		if req.Method == "initialized" {
			initialized = true
			continue
		}
		if req.Method != "initialize" && !initialized {
			_ = encoder.Encode(map[string]any{"id": req.ID, "error": map[string]any{"code": -32000, "message": "initialized notification missing"}})
			continue
		}
		result := map[string]any{}
		switch req.Method {
		case "initialize":
			if mode == "initialize-error" {
				_ = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": -32600, "message": "initialize rejected"}})
				continue
			}
			result = map[string]any{"serverInfo": map[string]any{"name": "fake"}}
		case "permissionProfile/list":
			if mode == "no-permission-profile-method" {
				_ = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": -32601, "message": "method removed"}})
				continue
			}
			result = map[string]any{"data": []map[string]any{
				{"id": ":read-only", "allowed": true},
				{"id": ":workspace", "allowed": true},
				{"id": ":danger-full-access", "allowed": false},
			}}
		case "thread/start":
			result = map[string]any{"thread": map[string]any{"id": "thread-1"}, "receivedParams": req.Params}
		case "thread/resume":
			id, _ := req.Params["threadId"].(string)
			if mismatch {
				id = "other"
			}
			result = map[string]any{"thread": map[string]any{"id": id}, "receivedParams": req.Params}
		case "turn/start":
			result = map[string]any{"turn": map[string]any{"id": "turn-1"}}
			_ = encoder.Encode(map[string]any{"jsonrpc": "2.0", "method": "turn/started", "params": map[string]any{"threadId": "thread-1", "turn": map[string]any{"id": "turn-1"}}})
			if mode == "crash-after-turn" {
				_ = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
				os.Exit(0)
			}
		case "turn/interrupt":
			result = map[string]any{"ok": true}
		default:
			_ = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": -32601, "message": fmt.Sprintf("unknown %s", req.Method)}})
			continue
		}
		_ = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	}
	os.Exit(0)
}
