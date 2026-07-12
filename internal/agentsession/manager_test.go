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

func (f *fakeDriver) completeEmpty(index int) {
	f.mu.Lock()
	sink := f.sinks[index]
	f.mu.Unlock()
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
	if !strings.Contains(prompt, "exactly 2 or 3") || !strings.Contains(prompt, "allowCustom to true") || !strings.Contains(prompt, "freedomHint") || !strings.Contains(prompt, "must not include Other") {
		t.Fatalf("buyer prompt does not guarantee 2-3 suggestions plus an open-ended answer path: %s", prompt)
	}
}

func TestDriverDeltaPreservesWhitespaceAndMCPRequestBecomesOneQuestion(t *testing.T) {
	params := json.RawMessage(`{"delta":" hello "}`)
	event, _, _ := normalizeDriverEvent("message-1", agentdriver.Event{Method: "agent/message/delta", Params: params})
	if event.Kind != "agent.message.delta" || event.Text != " hello " {
		t.Fatalf("delta whitespace was changed: %#v", event)
	}
	if lifecycle, _, _ := normalizeDriverEvent("message-1", agentdriver.Event{Method: "mcp/tool/completed", Params: json.RawMessage(`{"text":"exora.session_request_user_input"}`)}); lifecycle.Kind != "" {
		t.Fatal("driver MCP lifecycle notification must not become a business event")
	}

	dir := t.TempDir()
	executable := filepath.Join(dir, "codex.exe")
	_ = os.WriteFile(executable, []byte("test"), 0600)
	driver := &fakeDriver{}
	manager := NewManager(NewStore(nil), func(Session) (agentdriver.Driver, error) { return driver, nil })
	record, err := manager.Start(context.Background(), StartRequest{ConversationID: "chat-question", Role: "buyer", Binding: BindingSnapshot{Driver: "codex"}, ExecutablePath: executable, Workspace: dir, PermissionMode: "ask", IdempotencyKey: "start-question"})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := manager.RecordMCPEvent(record.ID, "exora.session_request_user_input", `{"recorded":true,"question":"What should 1123 mean?"}`, nil)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != StatusWaitingUser || len(updated.Events) == 0 || updated.Events[len(updated.Events)-1].Kind != "human.request" || updated.Events[len(updated.Events)-1].Text != "What should 1123 mean?" {
		t.Fatalf("unexpected question event: %#v", updated)
	}
}

func TestEmptyBuyerTurnIsVisibleAndSessionRemainsReady(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "codex.exe")
	_ = os.WriteFile(executable, []byte("test"), 0600)
	driver := &fakeDriver{}
	manager := NewManager(NewStore(nil), func(Session) (agentdriver.Driver, error) { return driver, nil })
	record, err := manager.Start(context.Background(), StartRequest{ConversationID: "chat-empty", Role: "buyer", Binding: BindingSnapshot{Driver: "codex"}, ExecutablePath: executable, Workspace: dir, PermissionMode: "ask", IdempotencyKey: "start-empty"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Send(context.Background(), record.ID, MessageRequest{ClientMessageID: "message-empty", Text: "buy GPU", IdempotencyKey: "send-empty"}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { driver.mu.Lock(); defer driver.mu.Unlock(); return len(driver.turns) == 1 })
	driver.completeEmpty(0)
	waitFor(t, func() bool { current, _ := manager.Get(record.ID); return current.Status == StatusReady })
	events, err := manager.Events(record.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	last := events[len(events)-1]
	if last.Kind != "turn.empty" || !strings.Contains(last.Text, "without a visible reply") {
		t.Fatalf("empty turn was not surfaced: %#v", events)
	}
}

func TestEventTextNeverLeaksCodexProtocolIDs(t *testing.T) {
	uuid := "019f52f6-98fc-7a12-b460-4728eb696a7c"
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{
			name: "completed item content",
			raw:  `{"threadId":"thread-1","turnId":"turn-1","item":{"id":"019f52f6-98fc-7a12-b460-4728eb696a7c","type":"agent_message","content":[{"type":"output_text","text":"真正的回复"},{"type":"metadata","id":"019f52f6-98fc-7a12-b460-4728eb696a7c"}]}}`,
			want: "真正的回复",
		},
		{
			name: "nested delta content",
			raw:  `{"itemId":"019f52f6-98fc-7a12-b460-4728eb696a7c","delta":{"content":[{"type":"output_text","text":"第一段"},{"type":"output_text","text":"第二段"}]}}`,
			want: "第一段第二段",
		},
		{
			name: "ids without content",
			raw:  `{"id":"019f52f6-98fc-7a12-b460-4728eb696a7c","threadId":"thread-1","turnId":"turn-1","type":"agent_message","status":"completed"}`,
			want: "",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := eventText(json.RawMessage(test.raw))
			if got != test.want {
				t.Fatalf("eventText()=%q want %q", got, test.want)
			}
			if strings.Contains(got, uuid) {
				t.Fatalf("protocol UUID leaked into text: %q", got)
			}
		})
	}
}

func TestBuyerPlanMCPEventBecomesLocalReviewRequest(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "codex.exe")
	_ = os.WriteFile(executable, []byte("test"), 0600)
	manager := NewManager(NewStore(nil), func(Session) (agentdriver.Driver, error) { return &fakeDriver{}, nil })
	record, err := manager.Start(context.Background(), StartRequest{ConversationID: "chat-plan", Role: "buyer", Binding: BindingSnapshot{Driver: "codex"}, ExecutablePath: executable, Workspace: dir, PermissionMode: "ask", IdempotencyKey: "start-plan"})
	if err != nil {
		t.Fatal(err)
	}
	plans := map[string]any{"localPreparationPlan": map[string]any{"title": "Prepare files"}, "remoteExecutionPlan": map[string]any{"title": "Audit service"}}
	updated, err := manager.RecordMCPEvent(record.ID, "exora.session_submit_plan", "", map[string]any{"data": map[string]any{"plans": plans}})
	if err != nil {
		t.Fatal(err)
	}
	last := updated.Events[len(updated.Events)-1]
	if updated.Status != StatusWaitingUser || last.Kind != "plan.review_requested" || last.Payload["plans"].(map[string]any)["remoteExecutionPlan"].(map[string]any)["title"] != "Audit service" {
		t.Fatalf("unexpected plan review event: %#v", updated)
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
