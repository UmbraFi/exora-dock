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
	text = strings.TrimSpace(text)
	if tool == "exora.session_request_user_input" {
		data := sessionToolData(text, payload)
		request, _ := data["request"].(map[string]any)
		question, _ := request["question"].(string)
		question = strings.TrimSpace(question)
		if question == "" {
			question = sessionToolResultText(text, "question")
		}
		if question == "" {
			question = "The local Agent needs more information before it can continue."
		}
		if _, err := m.store.Update(id, func(record *Session) error {
			record.Status = StatusWaitingUser
			return nil
		}); err != nil {
			return Session{}, err
		}
		return m.store.AddEvent(id, Event{Kind: "human.request", Text: question, Payload: map[string]any{"tool": tool, "request": request}})
	}
	if tool == "exora.session_submit_plan" {
		data := sessionToolData(text, payload)
		plans, _ := data["plans"].(map[string]any)
		if len(plans) == 0 {
			return Session{}, fmt.Errorf("structured local and remote plans required")
		}
		remote, _ := plans["remoteExecutionPlan"].(map[string]any)
		title, _ := remote["title"].(string)
		if _, err := m.store.Update(id, func(record *Session) error {
			record.Status = StatusWaitingUser
			return nil
		}); err != nil {
			return Session{}, err
		}
		return m.store.AddEvent(id, Event{Kind: "plan.review_requested", Text: strings.TrimSpace(title), Payload: map[string]any{"tool": tool, "plans": plans}})
	}
	message := sessionToolResultText(text, "message", "summary", "question")
	if message == "" {
		message = strings.TrimPrefix(tool, "exora.")
	}
	return m.store.AddEvent(id, Event{Kind: "mcp.event", Text: message, Payload: map[string]any{"tool": tool, "result": payload}})
}

func sessionToolData(text string, payload map[string]any) map[string]any {
	if data, ok := payload["data"].(map[string]any); ok {
		return data
	}
	var data map[string]any
	_ = json.Unmarshal([]byte(text), &data)
	return data
}

func sessionToolResultText(text string, keys ...string) string {
	var value map[string]any
	if json.Unmarshal([]byte(text), &value) != nil {
		return ""
	}
	for _, key := range keys {
		if candidate, ok := value[key].(string); ok && strings.TrimSpace(candidate) != "" {
			return strings.TrimSpace(candidate)
		}
	}
	return ""
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
		params := map[string]any{}
		if record.Model != "" {
			params["model"] = record.Model
		}
		if record.ReasoningEffort != "" {
			params["config"] = map[string]any{"model_reasoning_effort": record.ReasoningEffort}
		}
		vendor, err = driver.StartSession(ctx, agentdriver.SessionRequest{CWD: record.Workspace, PermissionProfile: record.PermissionProfile, AdditionalParams: params})
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
	if terminal && !failed && event.Kind == "turn.completed" && !m.turnProducedOutput(id, messageID) {
		event.Kind = "turn.empty"
		event.Text = "The Agent completed without a visible reply or required Exora question/plan action. The session remains ready; retry this message."
	}
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

func (m *Manager) turnProducedOutput(id, messageID string) bool {
	events, err := m.store.Events(id, 0)
	if err != nil {
		return false
	}
	start := -1
	for index := len(events) - 1; index >= 0; index-- {
		if events[index].Kind == "turn.started" && events[index].MessageID == messageID {
			start = index
			break
		}
	}
	if start < 0 {
		return false
	}
	for _, event := range events[start+1:] {
		switch event.Kind {
		case "human.request", "plan.review_requested", "mcp.event":
			return true
		case "agent.message.delta", "agent.message.completed":
			if strings.TrimSpace(event.Text) != "" {
				return true
			}
		}
	}
	return false
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
	req.Model = strings.TrimSpace(req.Model)
	if req.Model != "" && !validModelID(req.Model) {
		return fmt.Errorf("invalid model")
	}
	req.ReasoningEffort = strings.ToLower(strings.TrimSpace(req.ReasoningEffort))
	if req.ReasoningEffort != "" && !validReasoningEffort(req.ReasoningEffort) {
		return fmt.Errorf("invalid reasoning effort")
	}
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

func validModelID(value string) bool {
	if len(value) < 1 || len(value) > 100 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			continue
		}
		return false
	}
	return true
}

func validReasoningEffort(value string) bool {
	switch value {
	case "minimal", "low", "medium", "high", "xhigh", "max", "ultra":
		return true
	default:
		return false
	}
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
	if record.Role != "buyer" {
		return strings.Join([]string{
			"Exora Dock local-agent session instructions:",
			"You are the user's bound local agent in an Exora " + record.Role + " conversation.",
			"Use Exora MCP for progress, questions, approvals, offers, deliverables, blocking reasons, and every transaction-state proposal. Ordinary assistant text is visible to the user but cannot change transaction state.",
			"If the user's intent is unclear, call exora.session_request_user_input with a concrete question, then end the turn and wait for the user's next chat message.",
			"Work UID: " + record.WorkUID + ". Workspace: " + record.Workspace + ". " + transaction,
			"Never request, read, reveal, or infer payment PINs, wallet private keys, Dock owner tokens, model credentials, or arbitration authority. A chat reply or MCP call is never payment consent.",
			"Permission mode: " + record.PermissionMode + ". Stay inside the declared workspace and ask through Exora MCP whenever authority is absent or ambiguous.",
			"", "User message:", userText,
		}, "\n")
	}
	buyerContext := "No remote transaction is started during this interview."
	if record.TransactionID != "" {
		buyerContext = "Attached transaction identifier: " + record.TransactionID + ". It is context only during this interview; do not read or mutate transaction state before plan review."
	}
	return strings.Join([]string{
		"Exora Dock buyer requirement-interview instructions:",
		"You are the user's bound local buyer-planning agent. Before the user reviews a plan, your one and only objective is to learn precisely what they want to buy.",
		"Interview the user iteratively. Ask one high-value question at a time. Cover the desired outcome, deliverables, inputs and disclosure boundaries, functional and technical requirements, budget, deadline, quality bar, acceptance criteria, constraints, assumptions, risks, and explicit exclusions.",
		"Make every question easy to answer. First infer exactly two or three reasonable candidate answers from the user's context and present those as options. Then preserve a separate custom-input path so the user can describe their own requirement, concrete task, desired outcome, current materials or environment instead.",
		"Do not search for sellers, request quotes, create or submit a remote manifest, start work, request transaction approval, or discuss payment during this phase.",
		"Do not put a question or plan only in ordinary assistant text. End every turn with exactly one MCP action and then stop: exora.session_request_user_input when information is missing, or exora.session_submit_plan when the requirements are mature.",
		"For questions, follow the tool schema exactly so Dock can put the question into its special composer state. Ask only one concrete question. Use single_select by default; use multi_select only when two answers can genuinely apply together. Supply exactly 2 or 3 context-specific options with short labels and useful descriptions. Options must be plausible answers, mutually exclusive for single_select, and must not include Other, Custom, Not sure, or Ask me—those are handled by the separate custom input. Set allowCustom to true and always provide freedomHint in the user's language, naturally inviting the user to type a different requirement or describe the specific task so you can recommend a suitable answer. Never ask for secrets or credentials.",
		"The final result must contain two linked plans: localPreparationPlan tells this buyer agent how to prepare and sanitize local files; remoteExecutionPlan tells the remote agent how to execute the task. Every remoteExecutionPlan.requiredFiles item must reference exactly one localPreparationPlan.filesToPrepare item by localFileId. Never invent an absolute path or let the remote plan request an undeclared file.",
		"The two-plan bundle is mature only when it is internally consistent, contains no material unanswered question, has objective acceptance criteria, and every remote file dependency resolves to locally prepared material whose disclosure policy permits transfer. Submit both plans together for local user review. Submitting them does not authorize any remote action.",
		"Work UID: " + record.WorkUID + ". Workspace: " + record.Workspace + ". " + buyerContext,
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
		// Codex emits several lifecycle notifications for one MCP call. The MCP
		// server records the single authoritative semantic event separately.
		return Event{}, false, false
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
		// App-server notifications contain IDs, item types, status values, and
		// other protocol strings next to the assistant text. Only traverse known
		// content-bearing fields; walking every map value leaks item/message UUIDs
		// into the visible chat when a notification shape changes.
		for _, key := range []string{"delta", "text", "output_text", "outputText", "content", "message", "parts", "item", "result", "error", "data", "output"} {
			child, ok := typed[key]
			if !ok {
				continue
			}
			if candidate := findText(child); strings.TrimSpace(candidate) != "" {
				return candidate
			}
		}
	case []any:
		var out []string
		for _, child := range typed {
			if candidate := findText(child); strings.TrimSpace(candidate) != "" {
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
