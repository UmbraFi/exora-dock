package agentsession

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/agentdriver"
)

type fakeDriver struct {
	mu       sync.Mutex
	threadID string
	turns    []agentdriver.TurnRequest
	sinks    []agentdriver.EventSink
	closed   bool
}

func (f *fakeDriver) Kind() string { return "codex" }
func (f *fakeDriver) Probe(context.Context) (agentdriver.CapabilityReport, error) {
	return agentdriver.CapabilityReport{Installed: true, Authenticated: true}, nil
}
func (f *fakeDriver) StartSession(context.Context, agentdriver.SessionRequest) (agentdriver.Session, error) {
	f.threadID = "vendor-thread"
	return agentdriver.Session{ThreadID: f.threadID}, nil
}
func (f *fakeDriver) ResumeSession(_ context.Context, req agentdriver.ResumeRequest) (agentdriver.Session, error) {
	f.threadID = req.ThreadID
	return agentdriver.Session{ThreadID: req.ThreadID}, nil
}
func (f *fakeDriver) StartTurn(_ context.Context, req agentdriver.TurnRequest, sink agentdriver.EventSink) (agentdriver.Turn, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.turns = append(f.turns, req)
	f.sinks = append(f.sinks, sink)
	return agentdriver.Turn{ThreadID: req.ThreadID, TurnID: "turn-" + string(rune('1'+len(f.turns)-1))}, nil
}
func (f *fakeDriver) Steer(context.Context, agentdriver.TurnRequest) error { return nil }
func (f *fakeDriver) Interrupt(context.Context, string, string) error      { return nil }
func (f *fakeDriver) Close() error                                         { f.closed = true; return nil }
func (f *fakeDriver) complete(index int, text string) {
	f.mu.Lock()
	sink := f.sinks[index]
	f.mu.Unlock()
	data, _ := json.Marshal(map[string]any{"text": text})
	sink.OnEvent(agentdriver.Event{Method: "agent/message/completed", ThreadID: f.threadID, TurnID: "turn", Params: data})
	sink.OnEvent(agentdriver.Event{Method: "turn/completed", ThreadID: f.threadID, TurnID: "turn", Params: json.RawMessage(`{"status":"completed"}`)})
}

func TestManagerQueuesTurnsAndPersistsVendorSession(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "codex.exe")
	if err := os.WriteFile(executable, []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	driver := &fakeDriver{}
	manager := NewManager(NewStore(nil), func(Session) (agentdriver.Driver, error) { return driver, nil })
	record, err := manager.Start(context.Background(), StartRequest{ConversationID: "chat-1", Role: "buyer", Binding: BindingSnapshot{BindingID: "binding-1", Driver: "codex"}, ExecutablePath: executable, Workspace: dir, PermissionMode: "ask", IdempotencyKey: "start-1"})
	if err != nil {
		t.Fatal(err)
	}
	if record.Status != StatusReady || record.VendorSessionID != "vendor-thread" {
		t.Fatalf("unexpected session %#v", record)
	}
	_, err = manager.Send(context.Background(), record.ID, MessageRequest{ClientMessageID: "message-1", Text: "buy compute", IdempotencyKey: "send-1"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = manager.Send(context.Background(), record.ID, MessageRequest{ClientMessageID: "message-2", Text: "under 10 USDC", IdempotencyKey: "send-2"})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { driver.mu.Lock(); defer driver.mu.Unlock(); return len(driver.turns) == 1 })
	driver.complete(0, "first")
	waitFor(t, func() bool { driver.mu.Lock(); defer driver.mu.Unlock(); return len(driver.turns) == 2 })
	driver.complete(1, "second")
	waitFor(t, func() bool { current, _ := manager.Get(record.ID); return current.Status == StatusReady })
	events, err := manager.Events(record.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	var replies int
	for _, event := range events {
		if event.Kind == "agent.message.completed" {
			replies++
		}
	}
	if replies != 2 {
		t.Fatalf("replies=%d events=%#v", replies, events)
	}
	driver.mu.Lock()
	prompt := driver.turns[0].Prompt
	driver.mu.Unlock()
	if !strings.Contains(prompt, "Exora MCP") || !strings.Contains(prompt, "buy compute") {
		t.Fatalf("missing guarded prompt: %s", prompt)
	}
}

func TestManagerRejectsSellerWithoutTransactionAndDetectionOnlyDriver(t *testing.T) {
	dir := t.TempDir()
	cursor := filepath.Join(dir, "cursor-agent.exe")
	_ = os.WriteFile(cursor, []byte("test"), 0600)
	manager := NewManager(NewStore(nil), nil)
	_, err := manager.Start(context.Background(), StartRequest{ConversationID: "seller", Role: "seller", Binding: BindingSnapshot{Driver: "cursor-agent"}, ExecutablePath: cursor, Workspace: dir, IdempotencyKey: "start"})
	if err == nil || (!strings.Contains(err.Error(), "transactionId") && !strings.Contains(err.Error(), "detection-only")) {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestSellerCardPurposeUsesReadOnlySetupPromptWithoutTransaction(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "codex.exe")
	if err := os.WriteFile(executable, []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	driver := &fakeDriver{}
	manager := NewManager(NewStore(nil), func(Session) (agentdriver.Driver, error) { return driver, nil })
	record, err := manager.Start(context.Background(), StartRequest{
		ConversationID: "seller-card-1", Role: "seller", Purpose: "seller_card",
		Binding:        BindingSnapshot{BindingID: "binding-1", Driver: "codex"},
		ExecutablePath: executable, Workspace: dir, PermissionMode: "ask", IdempotencyKey: "start-card-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if record.Purpose != "seller_card" || record.TransactionID != "" {
		t.Fatalf("unexpected seller-card session %#v", record)
	}
	if _, err := manager.Send(context.Background(), record.ID, MessageRequest{ClientMessageID: "message-1", Text: "structure my offering", IdempotencyKey: "send-1"}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { driver.mu.Lock(); defer driver.mu.Unlock(); return len(driver.turns) == 1 })
	driver.mu.Lock()
	prompt := driver.turns[0].Prompt
	driver.mu.Unlock()
	if !strings.Contains(prompt, "Seller Setup conversation") || !strings.Contains(prompt, "Return exactly one JSON object") || !strings.Contains(prompt, "credential aliases") || strings.Contains(prompt, "buyer planning tools") {
		t.Fatalf("unexpected Seller Card setup prompt: %s", prompt)
	}
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition not met")
}
