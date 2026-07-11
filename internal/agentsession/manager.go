package agentsession

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/agentdriver"
)

type DriverFactory func(Session) (agentdriver.Driver, error)

type Manager struct {
	store   *Store
	factory DriverFactory

	mu          sync.Mutex
	drivers     map[string]agentdriver.Driver
	dispatching map[string]bool
}

func NewManager(store *Store, factory DriverFactory) *Manager {
	if store == nil {
		store = NewStore(nil)
	}
	return &Manager{store: store, factory: factory, drivers: map[string]agentdriver.Driver{}, dispatching: map[string]bool{}}
}

func (m *Manager) Start(ctx context.Context, req StartRequest) (Session, error) {
	if err := normalizeStartRequest(&req); err != nil {
		return Session{}, err
	}
	req.Binding.Executable = req.ExecutablePath
	if req.WorkUID == "" {
		req.WorkUID = newID("work")
	}
	record, duplicate, err := m.store.Create(req)
	if err != nil {
		return Session{}, err
	}
	if duplicate && record.Status != StatusStopped && record.Status != StatusFailed {
		m.mu.Lock()
		active := m.drivers[record.ID] != nil
		m.mu.Unlock()
		if active {
			return record, nil
		}
	}
	return m.open(ctx, record.ID)
}

func (m *Manager) Get(id string) (Session, bool) { return m.store.Get(id) }

func (m *Manager) Find(conversationID, role string) (Session, bool) {
	return m.store.Find(strings.TrimSpace(conversationID), normalizeRole(role))
}

func (m *Manager) Events(id string, after int64) ([]Event, error) {
	return m.store.Events(id, after)
}

func (m *Manager) RecordMCPEvent(id, tool, text string, payload map[string]any) (Session, error) {
	tool = strings.TrimSpace(tool)
	if tool == "" || !strings.HasPrefix(tool, "exora.") {
		return Session{}, fmt.Errorf("invalid Exora MCP tool name")
	}
	if len(text) > 2000 {
		text = text[:2000]
	}
	return m.store.AddEvent(id, Event{Kind: "mcp.event", Text: strings.TrimSpace(text), Payload: map[string]any{"tool": tool, "result": payload}})
}

func (m *Manager) Send(ctx context.Context, id string, req MessageRequest) (Session, error) {
	req.ClientMessageID = strings.TrimSpace(req.ClientMessageID)
	req.Text = strings.TrimSpace(req.Text)
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.ClientMessageID == "" || req.Text == "" || req.IdempotencyKey == "" {
		return Session{}, fmt.Errorf("clientMessageId, text and idempotencyKey are required")
	}
	m.mu.Lock()
	activeDriver := m.drivers[id] != nil
	m.mu.Unlock()
	if !activeDriver {
		if _, err := m.open(ctx, id); err != nil {
			return Session{}, err
		}
	}
	record, err := m.store.Update(id, func(record *Session) error {
		if record.Status == StatusStopped || record.Status == StatusFailed || record.Status == StatusStarting {
			return fmt.Errorf("local agent session is %s", record.Status)
		}
		if record.Idempotency == nil {
			record.Idempotency = map[string]string{}
		}
		if prior := record.Idempotency[req.IdempotencyKey]; prior != "" {
			if prior != req.ClientMessageID {
				return fmt.Errorf("idempotency key was reused for another message")
			}
			return nil
		}
		record.Idempotency[req.IdempotencyKey] = req.ClientMessageID
		record.Queue = append(record.Queue, QueuedMessage{
			ClientMessageID: req.ClientMessageID, Text: req.Text,
			IdempotencyKey: req.IdempotencyKey, CreatedAt: nowString(),
		})
		return nil
	})
	if err != nil {
		return Session{}, err
	}
	_, _ = m.store.AddEvent(id, Event{Kind: "message.queued", MessageID: req.ClientMessageID})
	go m.dispatch(id)
	return record, nil
}

func (m *Manager) Interrupt(ctx context.Context, id string) (Session, error) {
	record, ok := m.store.Get(id)
	if !ok {
		return Session{}, ErrNotFound
	}
	m.mu.Lock()
	driver := m.drivers[id]
	m.mu.Unlock()
	if driver != nil && record.VendorTurnID != "" {
		if err := driver.Interrupt(ctx, record.VendorSessionID, record.VendorTurnID); err != nil {
			return Session{}, err
		}
	}
	updated, err := m.store.Update(id, func(current *Session) error {
		current.Status = StatusReady
		current.VendorTurnID = ""
		current.LastError = ""
		return nil
	})
	if err == nil {
		_, _ = m.store.AddEvent(id, Event{Kind: "turn.interrupted", TurnID: record.VendorTurnID})
	}
	return updated, err
}

func (m *Manager) Stop(ctx context.Context, id string) (Session, error) {
	record, ok := m.store.Get(id)
	if !ok {
		return Session{}, ErrNotFound
	}
	m.mu.Lock()
	driver := m.drivers[id]
	delete(m.drivers, id)
	delete(m.dispatching, id)
	m.mu.Unlock()
	if driver != nil {
		if record.VendorTurnID != "" {
			_ = driver.Interrupt(ctx, record.VendorSessionID, record.VendorTurnID)
		}
		_ = driver.Close()
	}
	updated, err := m.store.Update(id, func(current *Session) error {
		current.Status = StatusStopped
		current.VendorTurnID = ""
		current.Queue = nil
		return nil
	})
	if err == nil {
		_, _ = m.store.AddEvent(id, Event{Kind: "session.stopped"})
	}
	return updated, err
}

func (m *Manager) Resume(ctx context.Context, id string) (Session, error) {
	if _, ok := m.store.Get(id); !ok {
		return Session{}, ErrNotFound
	}
	return m.open(ctx, id)
}

func (m *Manager) Respond(ctx context.Context, id, requestID string, response HumanResponse) (Session, error) {
	record, ok := m.store.Get(id)
	if !ok {
		return Session{}, ErrNotFound
	}
	m.mu.Lock()
	driver := m.drivers[id]
	m.mu.Unlock()
	responder, ok := driver.(agentdriver.HostRequestResponder)
	if !ok {
		return Session{}, fmt.Errorf("%s does not expose a host-request response protocol", record.Driver)
	}
	if err := responder.RespondHostRequest(ctx, strings.TrimSpace(requestID), response); err != nil {
		return Session{}, err
	}
	updated, err := m.store.Update(id, func(current *Session) error {
		current.Status = StatusBusy
		return nil
	})
	if err == nil {
		_, _ = m.store.AddEvent(id, Event{Kind: "human_request.responded", Payload: map[string]any{"requestId": requestID}})
	}
	return updated, err
}

func (m *Manager) Close() error {
	m.mu.Lock()
	drivers := m.drivers
	m.drivers = map[string]agentdriver.Driver{}
	m.dispatching = map[string]bool{}
	m.mu.Unlock()
	var firstErr error
	for id, driver := range drivers {
		if err := driver.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
		_, _ = m.store.Update(id, func(record *Session) error {
			record.Status = StatusStopped
			record.VendorTurnID = ""
			return nil
		})
	}
	return firstErr
}

func (m *Manager) open(ctx context.Context, id string) (Session, error) {
	record, ok := m.store.Get(id)
	if !ok {
		return Session{}, ErrNotFound
	}
	if m.factory == nil {
		return m.fail(id, fmt.Errorf("local agent driver factory is unavailable"))
	}
	_, _ = m.store.Update(id, func(current *Session) error {
		current.Status = StatusStarting
		current.LastError = ""
		return nil
	})
	driver, err := m.factory(record)
	if err != nil {
		return m.fail(id, err)
	}
	report, err := driver.Probe(ctx)
	if err != nil {
		_ = driver.Close()
		return m.fail(id, err)
	}
	if !report.Installed {
		_ = driver.Close()
		return m.fail(id, fmt.Errorf("%s executable is unavailable", record.Driver))
	}
	if !report.Authenticated {
		_ = driver.Close()
		reason := strings.TrimSpace(report.AuthStatus)
		if reason == "" {
			reason = record.Driver + " login required"
		}
		return m.fail(id, fmt.Errorf("%s", reason))
	}
	var vendor agentdriver.Session
	if record.VendorSessionID != "" {
		vendor, err = driver.ResumeSession(ctx, agentdriver.ResumeRequest{ThreadID: record.VendorSessionID, PermissionProfile: record.PermissionProfile, AdditionalParams: map[string]any{"cwd": record.Workspace}})
	} else {
		vendor, err = driver.StartSession(ctx, agentdriver.SessionRequest{CWD: record.Workspace, PermissionProfile: record.PermissionProfile})
	}
	if err != nil {
		_ = driver.Close()
		return m.fail(id, err)
	}
	m.mu.Lock()
	if old := m.drivers[id]; old != nil && old != driver {
		_ = old.Close()
	}
	m.drivers[id] = driver
	m.mu.Unlock()
	updated, err := m.store.Update(id, func(current *Session) error {
		current.Status = StatusReady
		current.VendorSessionID = vendor.ThreadID
		current.VendorTurnID = ""
		current.LastError = ""
		return nil
	})
	if err != nil {
		_ = driver.Close()
		return Session{}, err
	}
	_, _ = m.store.AddEvent(id, Event{Kind: "session.ready", Payload: map[string]any{"driver": record.Driver}})
	go m.dispatch(id)
	return updated, nil
}

func (m *Manager) dispatch(id string) {
	m.mu.Lock()
	if m.dispatching[id] {
		m.mu.Unlock()
		return
	}
	m.dispatching[id] = true
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		delete(m.dispatching, id)
		m.mu.Unlock()
	}()
	record, ok := m.store.Get(id)
	if !ok || record.Status != StatusReady || len(record.Queue) == 0 {
		return
	}
	m.mu.Lock()
	driver := m.drivers[id]
	m.mu.Unlock()
	if driver == nil {
		return
	}
	message := record.Queue[0]
	_, err := m.store.Update(id, func(current *Session) error {
		if len(current.Queue) == 0 || current.Queue[0].ClientMessageID != message.ClientMessageID {
			return fmt.Errorf("message queue changed")
		}
		current.Queue = current.Queue[1:]
		current.Status = StatusBusy
		return nil
	})
	if err != nil {
		return
	}
	prompt := sessionPrompt(record, message.Text)
	turn, err := driver.StartTurn(context.Background(), agentdriver.TurnRequest{ThreadID: record.VendorSessionID, Prompt: prompt}, agentdriver.EventSinkFunc(func(event agentdriver.Event) {
		m.handleDriverEvent(id, message.ClientMessageID, event)
	}))
	if err != nil {
		_, _ = m.fail(id, err)
		return
	}
	_, _ = m.store.Update(id, func(current *Session) error {
		current.VendorTurnID = turn.TurnID
		return nil
	})
	_, _ = m.store.AddEvent(id, Event{Kind: "turn.started", MessageID: message.ClientMessageID, TurnID: turn.TurnID})
}

func (m *Manager) handleDriverEvent(id, messageID string, incoming agentdriver.Event) {
	event, terminal, failed := normalizeDriverEvent(messageID, incoming)
	if event.Kind != "" {
		_, _ = m.store.AddEvent(id, event)
	}
	if !terminal {
		return
	}
	_, _ = m.store.Update(id, func(record *Session) error {
		record.VendorTurnID = ""
		if failed {
			record.Status = StatusFailed
			record.LastError = event.Text
		} else {
			record.Status = StatusReady
			record.LastError = ""
		}
		return nil
	})
	if !failed {
		go m.dispatch(id)
	}
}

func (m *Manager) fail(id string, cause error) (Session, error) {
	updated, _ := m.store.Update(id, func(record *Session) error {
		record.Status = StatusFailed
		record.LastError = cause.Error()
		record.VendorTurnID = ""
		return nil
	})
	_, _ = m.store.AddEvent(id, Event{Kind: "driver.failure", Text: cause.Error()})
	return updated, cause
}

func normalizeStartRequest(req *StartRequest) error {
	req.ConversationID = strings.TrimSpace(req.ConversationID)
	req.Role = normalizeRole(req.Role)
	req.Purpose = strings.ToLower(strings.TrimSpace(req.Purpose))
	req.Binding.Driver = strings.ToLower(strings.TrimSpace(req.Binding.Driver))
	req.ExecutablePath = strings.TrimSpace(req.ExecutablePath)
	req.Workspace = filepath.Clean(strings.TrimSpace(req.Workspace))
	req.PermissionMode = strings.ToLower(strings.TrimSpace(req.PermissionMode))
	req.PermissionProfile = strings.ToLower(strings.TrimSpace(req.PermissionProfile))
	req.TransactionID = strings.TrimSpace(req.TransactionID)
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.ConversationID == "" || len(req.ConversationID) > 240 || req.Role == "" || req.IdempotencyKey == "" {
		return fmt.Errorf("conversationId, buyer/seller role and idempotencyKey are required")
	}
	if req.Purpose != "" && req.Purpose != "seller_card" {
		return fmt.Errorf("unsupported local agent session purpose")
	}
	if req.Role == "seller" && req.TransactionID == "" && req.Purpose != "seller_card" {
		return fmt.Errorf("seller sessions require an authoritative transactionId")
	}
	if !supportedDriver(req.Binding.Driver) {
		return fmt.Errorf("local agent driver %q is detection-only or unsupported", req.Binding.Driver)
	}
	if !filepath.IsAbs(req.ExecutablePath) || !executableMatches(req.Binding.Driver, req.ExecutablePath) {
		return fmt.Errorf("bound local agent executable is invalid")
	}
	info, err := os.Stat(req.ExecutablePath)
	if err != nil || info.IsDir() {
		return fmt.Errorf("bound local agent executable no longer exists; scan again")
	}
	if req.Workspace != "." && req.Workspace != "" && !filepath.IsAbs(req.Workspace) {
		return fmt.Errorf("workspace must be an absolute path")
	}
	switch req.PermissionMode {
	case "", "ask", "approve", "full", "custom":
	default:
		return fmt.Errorf("unsupported permission mode")
	}
	if req.PermissionMode == "" {
		req.PermissionMode = "ask"
	}
	return nil
}

func supportedDriver(driver string) bool {
	switch driver {
	case "codex", "claude-code", "gemini", "github-copilot", "opencode":
		return true
	default:
		return false
	}
}

func executableMatches(driver, executable string) bool {
	base := strings.ToLower(filepath.Base(executable))
	base = strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(base, ".exe"), ".cmd"), ".bat")
	want := map[string]string{"codex": "codex", "claude-code": "claude", "gemini": "gemini", "github-copilot": "copilot", "opencode": "opencode"}
	return base == want[driver]
}

func normalizeRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "buyer", "seller":
		return strings.ToLower(strings.TrimSpace(role))
	default:
		return ""
	}
}

func sessionPrompt(record Session, userText string) string {
	if record.Purpose == "seller_card" {
		return strings.Join([]string{
			"Exora Dock Seller Setup conversation instructions:",
			"You are the seller's bound local agent. Exora has already collected a redacted environment snapshot with local tools.",
			"Analyze only the seller's stated offering, pricing principles, supplied diagnostics, and answers in this setup conversation. Do not inspect unrelated files, call transaction tools, propose payments, or change transaction state.",
			"You may ask compact batches of required questions over multiple turns. Return exactly one JSON object matching the requested envelope schema. Do not wrap it in markdown and do not add commentary.",
			"Settle permission boundaries using credential aliases, allowed actions, human approval cases, network scopes, and rate or spend limits. Never request, read, reveal, infer, or accept actual keys, tokens, passwords, cookies, private keys, recovery codes, wallet data, owner tokens, or model secrets.",
			"Permission mode: read-only. Workspace: " + record.Workspace + ".",
			"",
			"Seller Card request:",
			userText,
		}, "\n")
	}
	transaction := "No Cloud transaction is attached yet. Use the buyer planning tools to establish intent before proposing any transaction action."
	if record.TransactionID != "" {
		transaction = "Attached transaction: " + record.TransactionID + ". Read authoritative state and allowed actions through Exora MCP before proposing a transition."
	}
	return strings.Join([]string{
		"Exora Dock local-agent session instructions:",
		"You are the user's bound local agent in an Exora " + record.Role + " conversation.",
		"Use Exora MCP for progress, questions, approvals, offers, deliverables, blocking reasons, and every transaction-state proposal. Ordinary assistant text is visible to the user but cannot change transaction state.",
		"Work UID: " + record.WorkUID + ". Workspace: " + record.Workspace + ". " + transaction,
		"Never request, read, reveal, or infer payment PINs, wallet private keys, Dock owner tokens, model credentials, or arbitration authority. A chat reply or MCP call is never payment consent.",
		"Permission mode: " + record.PermissionMode + ". Stay inside the declared workspace and ask through Exora MCP whenever authority is absent or ambiguous.",
		"",
		"User message:",
		userText,
	}, "\n")
}

func normalizeDriverEvent(messageID string, incoming agentdriver.Event) (Event, bool, bool) {
	method := strings.ToLower(strings.TrimSpace(incoming.Method))
	event := Event{MessageID: messageID, TurnID: incoming.TurnID}
	terminal, failed := false, false
	switch {
	case method == "agent/message/delta" || strings.Contains(method, "agentmessage/delta") || strings.Contains(method, "assistant/delta"):
		event.Kind = "agent.message.delta"
		event.Text = eventText(incoming.Params)
	case method == "agent/message/completed" || strings.Contains(method, "agentmessage/completed") || method == "assistant/message":
		event.Kind = "agent.message.completed"
		event.Text = eventText(incoming.Params)
	case strings.Contains(method, "mcp") || strings.Contains(eventText(incoming.Params), "exora."):
		event.Kind = "mcp.event"
		event.Text = eventText(incoming.Params)
		event.Payload = decodePayload(incoming.Params)
	case method == "turn/completed" || method == "session/prompt/completed":
		event.Kind, terminal = "turn.completed", true
		event.Text = eventText(incoming.Params)
	case method == "turn/failed" || method == "driver/failure":
		event.Kind, terminal, failed = "turn.failed", true, true
		event.Text = eventText(incoming.Params)
	default:
		return Event{}, false, false
	}
	return event, terminal, failed
}

func eventText(raw json.RawMessage) string {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	return findText(value)
}

func findText(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case map[string]any:
		for _, key := range []string{"delta", "text", "message", "result", "error"} {
			if candidate := strings.TrimSpace(findText(typed[key])); candidate != "" {
				return candidate
			}
		}
		for _, child := range typed {
			if candidate := strings.TrimSpace(findText(child)); candidate != "" {
				return candidate
			}
		}
	case []any:
		var out []string
		for _, child := range typed {
			if candidate := strings.TrimSpace(findText(child)); candidate != "" {
				out = append(out, candidate)
			}
		}
		return strings.Join(out, "")
	}
	return ""
}

func decodePayload(raw json.RawMessage) map[string]any {
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return out
}

func newID(prefix string) string {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(data)
}
