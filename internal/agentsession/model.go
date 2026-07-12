package agentsession

import "time"

const (
	StatusStarting    = "starting"
	StatusReady       = "ready"
	StatusBusy        = "busy"
	StatusWaitingUser = "waiting_user"
	StatusFailed      = "failed"
	StatusStopped     = "stopped"
)

type BindingSnapshot struct {
	BindingID    string `json:"bindingId,omitempty"`
	Driver       string `json:"driver"`
	Executable   string `json:"executablePath,omitempty"`
	Version      string `json:"version,omitempty"`
	LastVerified string `json:"lastVerifiedAt,omitempty"`
}

type Session struct {
	ID                string            `json:"id"`
	ConversationID    string            `json:"conversationId"`
	Role              string            `json:"role"`
	Purpose           string            `json:"purpose,omitempty"`
	Driver            string            `json:"driver"`
	Binding           BindingSnapshot   `json:"binding"`
	Status            string            `json:"status"`
	VendorSessionID   string            `json:"vendorSessionId,omitempty"`
	VendorTurnID      string            `json:"vendorTurnId,omitempty"`
	Workspace         string            `json:"workspace,omitempty"`
	PermissionMode    string            `json:"permissionMode"`
	PermissionProfile string            `json:"permissionProfile,omitempty"`
	Model             string            `json:"model,omitempty"`
	ReasoningEffort   string            `json:"reasoningEffort,omitempty"`
	WorkUID           string            `json:"workUid,omitempty"`
	TransactionID     string            `json:"transactionId,omitempty"`
	RunID             string            `json:"runId,omitempty"`
	EventCursor       int64             `json:"eventCursor"`
	LastError         string            `json:"lastError,omitempty"`
	CreatedAt         string            `json:"createdAt"`
	UpdatedAt         string            `json:"updatedAt"`
	Events            []Event           `json:"events,omitempty"`
	Queue             []QueuedMessage   `json:"queue,omitempty"`
	Idempotency       map[string]string `json:"idempotency,omitempty"`
}

type Event struct {
	Seq       int64          `json:"seq"`
	Kind      string         `json:"kind"`
	MessageID string         `json:"messageId,omitempty"`
	TurnID    string         `json:"turnId,omitempty"`
	Text      string         `json:"text,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt string         `json:"createdAt"`
}

type QueuedMessage struct {
	ClientMessageID string `json:"clientMessageId"`
	Text            string `json:"text"`
	IdempotencyKey  string `json:"idempotencyKey"`
	CreatedAt       string `json:"createdAt"`
}

type HumanRequest struct {
	ID        string         `json:"id"`
	SessionID string         `json:"sessionId"`
	Kind      string         `json:"kind"`
	Question  string         `json:"question,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
	Status    string         `json:"status"`
	CreatedAt string         `json:"createdAt"`
}

type StartRequest struct {
	ConversationID    string          `json:"conversationId"`
	Role              string          `json:"role"`
	Purpose           string          `json:"purpose,omitempty"`
	Binding           BindingSnapshot `json:"binding"`
	ExecutablePath    string          `json:"executablePath"`
	Workspace         string          `json:"workspace,omitempty"`
	PermissionMode    string          `json:"permissionMode,omitempty"`
	PermissionProfile string          `json:"permissionProfile,omitempty"`
	Model             string          `json:"model,omitempty"`
	ReasoningEffort   string          `json:"reasoningEffort,omitempty"`
	WorkUID           string          `json:"workUid,omitempty"`
	TransactionID     string          `json:"transactionId,omitempty"`
	RunID             string          `json:"runId,omitempty"`
	IdempotencyKey    string          `json:"idempotencyKey"`
}

type MessageRequest struct {
	ClientMessageID string `json:"clientMessageId"`
	Text            string `json:"text"`
	IdempotencyKey  string `json:"idempotencyKey"`
}

type HumanResponse struct {
	Approved       *bool          `json:"approved,omitempty"`
	Answer         string         `json:"answer,omitempty"`
	SelectedOption string         `json:"selectedOption,omitempty"`
	Payload        map[string]any `json:"payload,omitempty"`
}

func nowString() string { return time.Now().UTC().Format(time.RFC3339Nano) }
