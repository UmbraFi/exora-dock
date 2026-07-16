package sellerdraft

import "time"

const (
	SchemaVersion = "seller-draft-run.v1"

	KindVM        = "vm"
	KindResources = "resources"
	KindEndpoint  = "endpoint"
	KindAPIBridge = "api_bridge"

	StatusQueued        = "queued"
	StatusDiscovering   = "discovering"
	StatusValidating    = "validating"
	StatusPackaging     = "packaging"
	StatusUploading     = "uploading"
	StatusProbing       = "probing"
	StatusReserving     = "reserving"
	StatusCreatingDraft = "creating_draft"
	StatusNeedsInput    = "needs_input"
	StatusCompleted     = "completed"
	StatusFailed        = "failed"
	StatusCancelled     = "cancelled"

	CandidateTTL = 30 * time.Minute
	RecordTTL    = 365 * 24 * time.Hour
)

type AllowedRoot struct {
	ID          string   `json:"id"`
	Path        string   `json:"path"`
	DisplayName string   `json:"displayName,omitempty"`
	Kinds       []string `json:"kinds,omitempty"`
}

type AllowedService struct {
	ID            string   `json:"id"`
	DisplayName   string   `json:"displayName,omitempty"`
	Mode          string   `json:"mode"`
	BaseURL       string   `json:"baseUrl"`
	AllowedPorts  []int    `json:"allowedPorts,omitempty"`
	AllowedHosts  []string `json:"allowedHosts,omitempty"`
	CredentialRef string   `json:"credentialRef,omitempty"`
}

type Attestations struct {
	Pricing  bool `json:"pricing"`
	Rights   bool `json:"rights"`
	Runtime  bool `json:"runtime"`
	APIUsage bool `json:"apiUsage"`
}

type PolicyLimits struct {
	MaxBatch          int   `json:"maxBatch"`
	MaxFiles          int   `json:"maxFiles"`
	MaxBundleBytes    int64 `json:"maxBundleBytes"`
	MaxConcurrentRuns int   `json:"maxConcurrentRuns"`
}

type SellerAutomationPolicy struct {
	SchemaVersion     string                    `json:"schemaVersion"`
	PolicyID          string                    `json:"policyId"`
	Version           int64                     `json:"version"`
	Enabled           bool                      `json:"enabled"`
	EnabledKinds      []string                  `json:"enabledKinds"`
	AllowedRoots      []AllowedRoot             `json:"allowedRoots"`
	AllowedServices   []AllowedService          `json:"allowedServices"`
	Defaults          map[string]map[string]any `json:"defaults"`
	Attestations      Attestations              `json:"attestations"`
	Limits            PolicyLimits              `json:"limits"`
	AutoInstallImages bool                      `json:"autoInstallImages"`
	ApprovedAt        string                    `json:"approvedAt,omitempty"`
	UpdatedAt         string                    `json:"updatedAt"`
	Hash              string                    `json:"hash"`
}

type PolicyReceipt struct {
	PolicyID     string       `json:"policyId"`
	Version      int64        `json:"version"`
	Hash         string       `json:"hash"`
	ApprovedAt   string       `json:"approvedAt"`
	Attestations Attestations `json:"attestations"`
}

type CredentialMetadata struct {
	CredentialRef string   `json:"credentialRef"`
	Label         string   `json:"label"`
	AuthType      string   `json:"authType"`
	ServiceIDs    []string `json:"serviceIds,omitempty"`
	APIKeyHeader  string   `json:"apiKeyHeader,omitempty"`
	CreatedAt     string   `json:"createdAt"`
	UpdatedAt     string   `json:"updatedAt"`
}

type Candidate struct {
	CandidateID       string         `json:"candidateId"`
	Kind              string         `json:"kind"`
	DisplayName       string         `json:"displayName"`
	Summary           string         `json:"summary,omitempty"`
	RootID            string         `json:"rootId,omitempty"`
	ServiceID         string         `json:"serviceId,omitempty"`
	SourceFingerprint string         `json:"sourceFingerprint"`
	Metadata          map[string]any `json:"metadata,omitempty"`
	MissingFields     []string       `json:"missingFields,omitempty"`
	CreatedAt         string         `json:"createdAt"`
	ExpiresAt         string         `json:"expiresAt"`
	// LocalPath is persisted locally and deliberately hidden from JSON/MCP results.
	LocalPath string `json:"-"`
}

type CreateRequest struct {
	Kind            string         `json:"kind"`
	CandidateIDs    []string       `json:"candidateIds"`
	Title           string         `json:"title,omitempty"`
	Description     string         `json:"description,omitempty"`
	CredentialRef   string         `json:"credentialRef,omitempty"`
	Commercial      map[string]any `json:"commercial,omitempty"`
	Specification   map[string]any `json:"specification,omitempty"`
	IdempotencyKey  string         `json:"idempotencyKey"`
	MCPConnectionID string         `json:"mcpConnectionId,omitempty"`
}

type RunResult struct {
	ProductID       string            `json:"productId,omitempty"`
	ListingID       string            `json:"listingId,omitempty"`
	DraftID         string            `json:"draftId,omitempty"`
	EndpointID      string            `json:"endpointId,omitempty"`
	UploadSessionID string            `json:"uploadSessionId,omitempty"`
	UploadedParts   map[string]string `json:"uploadedParts,omitempty"`
	ReadyToPublish  bool              `json:"readyToPublish"`
}

type Run struct {
	SchemaVersion        string         `json:"schemaVersion"`
	RunID                string         `json:"runId"`
	Kind                 string         `json:"kind"`
	Status               string         `json:"status"`
	StateVersion         int64          `json:"stateVersion"`
	Progress             int            `json:"progress"`
	CurrentStep          string         `json:"currentStep,omitempty"`
	NextAction           string         `json:"nextAction,omitempty"`
	MissingFields        []string       `json:"missingFields,omitempty"`
	Error                string         `json:"error,omitempty"`
	Request              CreateRequest  `json:"request"`
	NormalizedSpec       map[string]any `json:"normalizedSpec,omitempty"`
	SourceFingerprint    string         `json:"sourceFingerprint,omitempty"`
	PolicyReceipt        PolicyReceipt  `json:"sellerPolicyReceipt"`
	Result               RunResult      `json:"result"`
	ReservationExpiresAt string         `json:"reservationExpiresAt,omitempty"`
	CreatedAt            string         `json:"createdAt"`
	UpdatedAt            string         `json:"updatedAt"`
	CompletedAt          string         `json:"completedAt,omitempty"`
}

type ResumeRequest struct {
	RunID                string         `json:"runId"`
	ExpectedStateVersion int64          `json:"expectedStateVersion"`
	IdempotencyKey       string         `json:"idempotencyKey"`
	Values               map[string]any `json:"values"`
}

type CancelRequest struct {
	RunID                string `json:"runId"`
	ExpectedStateVersion int64  `json:"expectedStateVersion"`
	IdempotencyKey       string `json:"idempotencyKey"`
}

type DiscoverRequest struct {
	Kinds       []string `json:"kinds,omitempty"`
	TargetHints []string `json:"targetHints,omitempty"`
	Query       string   `json:"query,omitempty"`
	MaxResults  int      `json:"maxResults,omitempty"`
}

type ReadRequest struct {
	CandidateID string `json:"candidateId"`
	Offset      int64  `json:"offset,omitempty"`
	Limit       int    `json:"limit,omitempty"`
}

type MaterialChunk struct {
	CandidateID string `json:"candidateId"`
	Content     string `json:"content"`
	Offset      int64  `json:"offset"`
	NextOffset  int64  `json:"nextOffset,omitempty"`
	EOF         bool   `json:"eof"`
	SHA256      string `json:"sha256"`
}
