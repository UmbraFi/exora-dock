package agentdriver

import (
	"context"
	"encoding/json"
	"io"
	"time"
)

type CapabilityReport struct {
	Kind            string   `json:"kind"`
	Installed       bool     `json:"installed"`
	Path            string   `json:"path,omitempty"`
	Version         string   `json:"version,omitempty"`
	Authenticated   bool     `json:"authenticated"`
	AuthStatus      string   `json:"authStatus,omitempty"`
	Protocol        string   `json:"protocol"`
	Methods         []string `json:"methods"`
	SandboxValues   []string `json:"sandboxValues,omitempty"`
	SchemaGenerated bool     `json:"schemaGenerated"`
	Error           string   `json:"error,omitempty"`
	ProbedAt        string   `json:"probedAt"`
}

type LocalAgentConfig struct {
	ID                string   `json:"id"`
	Kind              string   `json:"kind"`
	Enabled           bool     `json:"enabled"`
	Roles             []string `json:"roles"`
	Automation        bool     `json:"automation"`
	AutomationMode    string   `json:"automationMode"`
	Workspace         string   `json:"workspace,omitempty"`
	WorkspaceRoots    []string `json:"workspaceRoots,omitempty"`
	PermissionProfile string   `json:"permissionProfile,omitempty"`
	MaxConcurrency    int      `json:"maxConcurrency"`
}

type SessionRequest struct {
	CWD               string         `json:"cwd,omitempty"`
	PermissionProfile string         `json:"permissionProfile,omitempty"`
	AdditionalParams  map[string]any `json:"additionalParams,omitempty"`
}

type ResumeRequest struct {
	ThreadID          string         `json:"threadId"`
	PermissionProfile string         `json:"permissionProfile,omitempty"`
	AdditionalParams  map[string]any `json:"additionalParams,omitempty"`
}

type Session struct {
	ThreadID string         `json:"threadId"`
	Raw      map[string]any `json:"raw,omitempty"`
}

type TurnRequest struct {
	ThreadID string         `json:"threadId"`
	TurnID   string         `json:"turnId,omitempty"`
	Prompt   string         `json:"prompt"`
	Params   map[string]any `json:"params,omitempty"`
}

type Turn struct {
	ThreadID string         `json:"threadId"`
	TurnID   string         `json:"turnId"`
	Raw      map[string]any `json:"raw,omitempty"`
}

type Event struct {
	Method   string          `json:"method"`
	ThreadID string          `json:"threadId,omitempty"`
	TurnID   string          `json:"turnId,omitempty"`
	Params   json.RawMessage `json:"params,omitempty"`
	Received string          `json:"receivedAt"`
}

type EventSink interface {
	OnEvent(Event)
}

type EventSinkFunc func(Event)

func (f EventSinkFunc) OnEvent(event Event) { f(event) }

type Driver interface {
	Kind() string
	Probe(context.Context) (CapabilityReport, error)
	StartSession(context.Context, SessionRequest) (Session, error)
	ResumeSession(context.Context, ResumeRequest) (Session, error)
	StartTurn(context.Context, TurnRequest, EventSink) (Turn, error)
	Steer(context.Context, TurnRequest) error
	Interrupt(context.Context, string, string) error
	Close() error
}

// HostRequestResponder is implemented by protocols that can pause for a
// native vendor question or approval and accept the owner's response later.
// The payload is intentionally provider-neutral; transaction authority still
// belongs to Exora MCP, not to this callback.
type HostRequestResponder interface {
	RespondHostRequest(context.Context, string, any) error
}

var defaultMethods = []string{
	"initialize",
	"initialized",
	"permissionProfile/list",
	"thread/start",
	"thread/resume",
	"turn/start",
	"turn/steer",
	"turn/interrupt",
}

func receivedNow() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func closeQuietly(closer io.Closer) {
	if closer != nil {
		_ = closer.Close()
	}
}
