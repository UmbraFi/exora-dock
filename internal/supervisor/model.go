package supervisor

import "time"

const (
	DriverCodex = "codex"

	RunQueued       = "queued"
	RunRunning      = "running"
	RunWaitingUser  = "waiting_user"
	RunWaitingAgent = "waiting_agent"
	RunBlocked      = "blocked"
	RunCompleted    = "completed"
	RunFailed       = "failed"
	RunCancelled    = "cancelled"
)

var AgentActions = []string{
	"claim_run",
	"get_transaction_state",
	"get_allowed_actions",
	"search_agent_cards",
	"report_progress",
	"request_user_input",
	"request_approval",
	"propose_transition",
	"submit_offer",
	"submit_deliverable",
	"report_blocked",
	"finish_run",
}

type Policy struct {
	Enabled           bool
	AllowedRoles      []string
	WorkspaceRoot     string
	WorkspaceRoots    []string
	AutomationMode    string
	PermissionProfile string
	MaxConcurrency    int
}

type AutomationRun struct {
	RunID                string         `json:"runId"`
	TransactionID        string         `json:"transactionId"`
	Role                 string         `json:"role"`
	Driver               string         `json:"driver"`
	Status               string         `json:"status"`
	TriggerEventID       string         `json:"triggerEventId,omitempty"`
	ExpectedStateVersion int64          `json:"expectedStateVersion"`
	Version              int64          `json:"version"`
	VendorThreadID       string         `json:"vendorThreadId,omitempty"`
	VendorTurnID         string         `json:"vendorTurnId,omitempty"`
	PermissionProfile    string         `json:"permissionProfile,omitempty"`
	Workspace            string         `json:"workspace,omitempty"`
	AutomationMode       string         `json:"automationMode,omitempty"`
	AllowedActions       []string       `json:"allowedActionsSnapshot,omitempty"`
	AllowedActionsSet    bool           `json:"allowedActionsSnapshotPresent,omitempty"`
	EventCursor          int64          `json:"eventCursor,omitempty"`
	Lease                Lease          `json:"lease"`
	LastError            string         `json:"lastError,omitempty"`
	LastAction           string         `json:"lastAction,omitempty"`
	CreatedAt            string         `json:"createdAt"`
	UpdatedAt            string         `json:"updatedAt"`
	CompletedAt          string         `json:"completedAt,omitempty"`
	Events               []RunEvent     `json:"events,omitempty"`
	Idempotency          map[string]int `json:"-"`
}

type Lease struct {
	WorkerID string `json:"workerId,omitempty"`
	Epoch    int64  `json:"epoch"`
	Until    string `json:"until,omitempty"`
}

func (l Lease) Expired(now time.Time) bool {
	if l.WorkerID == "" || l.Until == "" {
		return true
	}
	until, err := time.Parse(time.RFC3339Nano, l.Until)
	return err != nil || !until.After(now.UTC())
}

type RunEvent struct {
	Seq                  int64          `json:"seq"`
	Type                 string         `json:"type"`
	Actor                string         `json:"actor,omitempty"`
	Role                 string         `json:"role,omitempty"`
	IdempotencyKey       string         `json:"idempotencyKey,omitempty"`
	ExpectedStateVersion int64          `json:"expectedStateVersion,omitempty"`
	Payload              map[string]any `json:"payload,omitempty"`
	PrevHash             string         `json:"prevHash,omitempty"`
	EventHash            string         `json:"eventHash"`
	CreatedAt            string         `json:"createdAt"`
}

type CreateRequest struct {
	RunID                string   `json:"runId,omitempty"`
	TransactionID        string   `json:"transactionId"`
	Role                 string   `json:"role"`
	Driver               string   `json:"driver,omitempty"`
	TriggerEventID       string   `json:"triggerEventId,omitempty"`
	ExpectedStateVersion int64    `json:"expectedStateVersion"`
	PermissionProfile    string   `json:"permissionProfile,omitempty"`
	Workspace            string   `json:"workspace,omitempty"`
	AutomationMode       string   `json:"automationMode,omitempty"`
	AllowedActions       []string `json:"allowedActions,omitempty"`
	AllowedActionsSet    bool     `json:"allowedActionsPresent,omitempty"`
	IdempotencyKey       string   `json:"idempotencyKey"`
}

type ClaimRequest struct {
	RunID         string        `json:"runId,omitempty"`
	TransactionID string        `json:"transactionId,omitempty"`
	Role          string        `json:"role,omitempty"`
	WorkerID      string        `json:"workerId"`
	LeaseTTL      time.Duration `json:"-"`
	LeaseSeconds  int           `json:"leaseSeconds,omitempty"`
}

type ActionRequest struct {
	Type                 string         `json:"type"`
	ExpectedRunVersion   int64          `json:"expectedRunVersion,omitempty"`
	ExpectedStateVersion int64          `json:"expectedStateVersion"`
	IdempotencyKey       string         `json:"idempotencyKey"`
	Actor                string         `json:"actor,omitempty"`
	Role                 string         `json:"role,omitempty"`
	Payload              map[string]any `json:"payload,omitempty"`
}

type TransactionProjection struct {
	TransactionID  string           `json:"transactionId"`
	Version        int64            `json:"version"`
	Phase          string           `json:"phase"`
	Condition      string           `json:"condition"`
	Participants   map[string]any   `json:"participants,omitempty"`
	PlanHash       string           `json:"planHash,omitempty"`
	AllowedActions []string         `json:"allowedActions"`
	Pending        []map[string]any `json:"pendingRequests,omitempty"`
	LastEventSeq   int64            `json:"lastEventSeq"`
	UpdatedAt      string           `json:"updatedAt"`
}
