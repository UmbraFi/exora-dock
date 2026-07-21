package sellerdraft

import "time"

const (
	KindAPI      = "api"
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
	Mode          string   `json:"deliveryMode"`
	BaseURL       string   `json:"baseUrl"`
	AllowedPorts  []int    `json:"allowedPorts,omitempty"`
	AllowedHosts  []string `json:"allowedHosts,omitempty"`
	CredentialRef string   `json:"credentialRef,omitempty"`
}

type SellerAutomationPolicy struct {
	SchemaVersion   string           `json:"schemaVersion"`
	PolicyID        string           `json:"policyId"`
	Version         int64            `json:"version"`
	Enabled         bool             `json:"enabled"`
	EnabledKinds    []string         `json:"enabledKinds"`
	AllowedRoots    []AllowedRoot    `json:"allowedRoots"`
	AllowedServices []AllowedService `json:"allowedServices"`
	ApprovedAt      string           `json:"approvedAt,omitempty"`
	UpdatedAt       string           `json:"updatedAt"`
	Hash            string           `json:"hash"`
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
	CreatedAt         string         `json:"createdAt"`
	ExpiresAt         string         `json:"expiresAt"`
	LocalPath         string         `json:"-"`
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
