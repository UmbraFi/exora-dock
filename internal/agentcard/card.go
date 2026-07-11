package agentcard

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type Role string

const (
	RoleBuyer  Role = "buyer"
	RoleSeller Role = "seller"
)

type Status string

const (
	StatusDraft     Status = "draft"
	StatusSaved     Status = "saved"
	StatusPublished Status = "published"
)

type ReviewStatus string

const (
	ReviewStatusApproved ReviewStatus = "approved"
	ReviewStatusRejected ReviewStatus = "rejected"
	ReviewStatusPending  ReviewStatus = "pending_review"
)

type DisclosureLevel string

const (
	DisclosurePublic       DisclosureLevel = "public"
	DisclosureBuyerVisible DisclosureLevel = "buyer-visible"
	DisclosurePostConsent  DisclosureLevel = "post-consent"
	DisclosureAuditorOnly  DisclosureLevel = "auditor-only"
)

type AgentCard struct {
	ID           string                     `json:"id"`
	Role         Role                       `json:"role"`
	Status       Status                     `json:"status"`
	DockID       string                     `json:"dockId"`
	AgentID      string                     `json:"agentId"`
	CardVersion  string                     `json:"cardVersion"`
	UpdatedAt    string                     `json:"updatedAt"`
	ExpiresAt    string                     `json:"expiresAt,omitempty"`
	PublishedAt  string                     `json:"publishedAt,omitempty"`
	ManualFields ManualFields               `json:"manualFields"`
	Diagnostics  Diagnostics                `json:"diagnostics"`
	Disclosure   map[string]DisclosureLevel `json:"disclosure,omitempty"`
	ContentHash  string                     `json:"contentHash"`
	Signature    string                     `json:"signature,omitempty"`
	Review       *ReviewResult              `json:"review,omitempty"`
}

type ReviewResult struct {
	Status     ReviewStatus `json:"status"`
	Categories []string     `json:"categories,omitempty"`
	Reason     string       `json:"reason"`
	Source     string       `json:"source"`
	Confidence float64      `json:"confidence,omitempty"`
	ReviewedAt string       `json:"reviewedAt"`
}

type ManualFields struct {
	Buyer  BuyerManualFields  `json:"buyer,omitempty"`
	Seller SellerManualFields `json:"seller,omitempty"`
}

type BuyerManualFields struct {
	DisplayName           string   `json:"displayName,omitempty"`
	SupportedAgentTypes   []string `json:"supportedAgentTypes,omitempty"`
	Notes                 string   `json:"notes,omitempty"`
	Budget                string   `json:"budget,omitempty"`
	Preferences           []string `json:"preferences,omitempty"`
	RiskBoundary          string   `json:"riskBoundary,omitempty"`
	AuthorizationStrategy string   `json:"authorizationStrategy,omitempty"`
	AcceptedTaskTypes     []string `json:"acceptedTaskTypes,omitempty"`
	IdentityDisclosure    string   `json:"identityDisclosure,omitempty"`
	FileDisclosure        string   `json:"fileDisclosure,omitempty"`
	DataRetention         string   `json:"dataRetention,omitempty"`
	EscrowPreference      string   `json:"escrowPreference,omitempty"`
}

type SellerManualFields struct {
	SellIntent          string   `json:"sellIntent,omitempty"`
	PricingPrinciples   string   `json:"pricingPrinciples,omitempty"`
	Offerings           []string `json:"offerings,omitempty"`
	PricingProcess      []string `json:"pricingProcess,omitempty"`
	StructuredByAgent   string   `json:"structuredByAgent,omitempty"`
	StructuredAt        string   `json:"structuredAt,omitempty"`
	SetupStatus         string   `json:"setupStatus,omitempty"`
	AllowedAgentActions []string `json:"allowedAgentActions,omitempty"`
	ApprovalRequired    []string `json:"approvalRequiredActions,omitempty"`
	CredentialPolicy    string   `json:"credentialPolicy,omitempty"`
	NetworkPolicy       string   `json:"networkPolicy,omitempty"`
	DisplayName         string   `json:"displayName,omitempty"`
	CapabilitySummary   string   `json:"capabilitySummary,omitempty"`
	CapabilityTypes     []string `json:"capabilityTypes,omitempty"`
	Pricing             string   `json:"pricing,omitempty"`
	Availability        string   `json:"availability,omitempty"`
	HumanConfirmation   string   `json:"humanConfirmation,omitempty"`
	DataBoundary        string   `json:"dataBoundary,omitempty"`
	ManagedAPIs         []string `json:"managedApis,omitempty"`
	OutputFormats       []string `json:"outputFormats,omitempty"`
	AutoQuote           *bool    `json:"autoQuote,omitempty"`
	AutoAcceptLowRisk   *bool    `json:"autoAcceptLowRisk,omitempty"`
	ExternalWritePolicy string   `json:"externalWritePolicy,omitempty"`
}

type Diagnostics struct {
	CollectedAt        string           `json:"collectedAt"`
	ExpiresAt          string           `json:"expiresAt"`
	OS                 string           `json:"os"`
	OSVersion          string           `json:"osVersion,omitempty"`
	KernelVersion      string           `json:"kernelVersion,omitempty"`
	Arch               string           `json:"arch"`
	CPUCores           int              `json:"cpuCores"`
	CPUModel           string           `json:"cpuModel,omitempty"`
	RAMGB              int              `json:"ramGb,omitempty"`
	GPUs               []GPUInfo        `json:"gpus,omitempty"`
	Storage            []StorageInfo    `json:"storage,omitempty"`
	DockerAvailable    bool             `json:"dockerAvailable"`
	DockerVersion      string           `json:"dockerVersion,omitempty"`
	PythonVersion      string           `json:"pythonVersion,omitempty"`
	NodeVersion        string           `json:"nodeVersion,omitempty"`
	NPMVersion         string           `json:"npmVersion,omitempty"`
	CodeEnvironment    []DependencyInfo `json:"codeEnvironment,omitempty"`
	Dependencies       []DependencyInfo `json:"dependencies,omitempty"`
	MCPAvailable       bool             `json:"mcpAvailable"`
	MCPEntrypoint      string           `json:"mcpEntrypoint,omitempty"`
	CommandExecutor    bool             `json:"commandExecutor"`
	NetworkCheck       string           `json:"networkCheck,omitempty"`
	RedactionSummary   string           `json:"redactionSummary"`
	DiagnosticsVersion string           `json:"diagnosticsVersion"`
}

type GPUInfo struct {
	Name          string `json:"name"`
	Chip          string `json:"chip,omitempty"`
	DeviceID      string `json:"deviceId,omitempty"`
	DriverVersion string `json:"driverVersion,omitempty"`
	VRAMGB        int    `json:"vramGb,omitempty"`
}

type StorageInfo struct {
	Label       string `json:"label"`
	TotalGB     int    `json:"totalGb,omitempty"`
	FreeGB      int    `json:"freeGb,omitempty"`
	UsedPercent int    `json:"usedPercent,omitempty"`
}

type DependencyInfo struct {
	Name     string `json:"name"`
	Version  string `json:"version,omitempty"`
	Source   string `json:"source,omitempty"`
	Location string `json:"location,omitempty"`
}

type DraftRequest struct {
	Role        Role                       `json:"role"`
	DockID      string                     `json:"dockId,omitempty"`
	AgentID     string                     `json:"agentId,omitempty"`
	Diagnostics Diagnostics                `json:"diagnostics"`
	Buyer       BuyerManualFields          `json:"buyer,omitempty"`
	Seller      SellerManualFields         `json:"seller,omitempty"`
	Disclosure  map[string]DisclosureLevel `json:"disclosure,omitempty"`
}

type SaveRequest struct {
	Card AgentCard `json:"card"`
}

func NormalizeRole(value string) (Role, error) {
	switch Role(strings.ToLower(strings.TrimSpace(value))) {
	case RoleBuyer:
		return RoleBuyer, nil
	case RoleSeller:
		return RoleSeller, nil
	default:
		return "", fmt.Errorf("role must be buyer or seller")
	}
}

func NewDraft(req DraftRequest) (AgentCard, error) {
	if req.Role != RoleBuyer && req.Role != RoleSeller {
		return AgentCard{}, fmt.Errorf("role must be buyer or seller")
	}
	now := time.Now().UTC()
	dockID := strings.TrimSpace(req.DockID)
	if dockID == "" {
		dockID = "exora-dock-local"
	}
	agentID := strings.TrimSpace(req.AgentID)
	if agentID == "" {
		agentID = "exora-desktop-agent"
	}
	card := AgentCard{
		ID:           fmt.Sprintf("%s-%s-card", dockID, req.Role),
		Role:         req.Role,
		Status:       StatusDraft,
		DockID:       dockID,
		AgentID:      agentID,
		CardVersion:  "exora-agent-card/v0.1",
		UpdatedAt:    now.Format(time.RFC3339),
		ExpiresAt:    now.Add(7 * 24 * time.Hour).Format(time.RFC3339),
		Diagnostics:  req.Diagnostics,
		Disclosure:   defaultDisclosure(req.Disclosure),
		ManualFields: ManualFields{},
	}
	if card.Diagnostics.CollectedAt == "" {
		card.Diagnostics.CollectedAt = now.Format(time.RFC3339)
	}
	if card.Diagnostics.ExpiresAt == "" {
		card.Diagnostics.ExpiresAt = now.Add(24 * time.Hour).Format(time.RFC3339)
	}
	if card.Diagnostics.RedactionSummary == "" {
		card.Diagnostics.RedactionSummary = "Secrets, private keys, raw credentials, internal endpoints, and full private paths are excluded."
	}
	if card.Diagnostics.DiagnosticsVersion == "" {
		card.Diagnostics.DiagnosticsVersion = diagnosticsVersion
	}
	switch req.Role {
	case RoleBuyer:
		card.ManualFields.Buyer = req.Buyer.withDefaults()
	case RoleSeller:
		card.ManualFields.Seller = req.Seller.withDefaults(req.Diagnostics)
	}
	return Stamp(card)
}

func Stamp(card AgentCard) (AgentCard, error) {
	card.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	card.ContentHash = ""
	card.Signature = ""
	data, err := json.Marshal(card)
	if err != nil {
		return AgentCard{}, err
	}
	sum := sha256.Sum256(data)
	card.ContentHash = hex.EncodeToString(sum[:])
	return card, nil
}

func PrepareForSave(card AgentCard) (AgentCard, error) {
	if card.Role != RoleBuyer && card.Role != RoleSeller {
		return AgentCard{}, fmt.Errorf("role must be buyer or seller")
	}
	if strings.TrimSpace(card.DockID) == "" {
		card.DockID = "exora-dock-local"
	}
	if strings.TrimSpace(card.AgentID) == "" {
		card.AgentID = "exora-desktop-agent"
	}
	if strings.TrimSpace(card.CardVersion) == "" {
		card.CardVersion = "exora-agent-card/v0.1"
	}
	if card.Status == "" || card.Status == StatusDraft {
		card.Status = StatusSaved
	}
	card.Disclosure = defaultDisclosure(card.Disclosure)
	return Stamp(card)
}

func PrepareForPublish(card AgentCard) (AgentCard, error) {
	if err := ValidatePublish(card); err != nil {
		return AgentCard{}, err
	}
	card.Status = StatusPublished
	card.PublishedAt = time.Now().UTC().Format(time.RFC3339)
	card.Disclosure = defaultDisclosure(card.Disclosure)
	return Stamp(card)
}

func ValidatePublish(card AgentCard) error {
	if card.Role != RoleBuyer && card.Role != RoleSeller {
		return fmt.Errorf("role must be buyer or seller")
	}
	if strings.TrimSpace(card.DockID) == "" {
		return fmt.Errorf("dockId required")
	}
	if strings.TrimSpace(card.AgentID) == "" {
		return fmt.Errorf("agentId required")
	}
	if card.Diagnostics.CollectedAt == "" {
		return fmt.Errorf("diagnostics required")
	}
	switch card.Role {
	case RoleBuyer:
		buyer := card.ManualFields.Buyer
		if strings.TrimSpace(buyer.DisplayName) == "" {
			return fmt.Errorf("buyer displayName required")
		}
		if strings.TrimSpace(buyer.RiskBoundary) == "" {
			return fmt.Errorf("buyer riskBoundary required")
		}
		if strings.TrimSpace(buyer.AuthorizationStrategy) == "" {
			return fmt.Errorf("buyer authorizationStrategy required")
		}
		if strings.TrimSpace(buyer.IdentityDisclosure) == "" {
			return fmt.Errorf("buyer identityDisclosure required")
		}
		if strings.TrimSpace(buyer.FileDisclosure) == "" {
			return fmt.Errorf("buyer fileDisclosure required")
		}
	case RoleSeller:
		seller := card.ManualFields.Seller
		if strings.TrimSpace(seller.SellIntent) == "" {
			return fmt.Errorf("seller sellIntent required")
		}
		if strings.TrimSpace(seller.PricingPrinciples) == "" {
			return fmt.Errorf("seller pricingPrinciples required")
		}
		if strings.TrimSpace(seller.DisplayName) == "" {
			return fmt.Errorf("seller displayName required")
		}
		if strings.TrimSpace(seller.CapabilitySummary) == "" && len(seller.CapabilityTypes) == 0 {
			return fmt.Errorf("seller capability required")
		}
		if strings.TrimSpace(seller.Pricing) == "" {
			return fmt.Errorf("seller pricing required")
		}
		if strings.TrimSpace(seller.Availability) == "" {
			return fmt.Errorf("seller availability required")
		}
		if strings.TrimSpace(seller.HumanConfirmation) == "" {
			return fmt.Errorf("seller humanConfirmation required")
		}
		if strings.TrimSpace(seller.SetupStatus) != "complete" {
			return fmt.Errorf("seller setup incomplete")
		}
		if strings.TrimSpace(seller.StructuredByAgent) == "" || strings.TrimSpace(seller.StructuredAt) == "" {
			return fmt.Errorf("seller agent-structured setup required")
		}
		if len(seller.AllowedAgentActions) == 0 {
			return fmt.Errorf("seller allowedAgentActions required")
		}
		if len(seller.ApprovalRequired) == 0 {
			return fmt.Errorf("seller approvalRequiredActions required")
		}
		if strings.TrimSpace(seller.CredentialPolicy) == "" {
			return fmt.Errorf("seller credentialPolicy required")
		}
		if strings.TrimSpace(seller.NetworkPolicy) == "" {
			return fmt.Errorf("seller networkPolicy required")
		}
	}
	return nil
}

func (b BuyerManualFields) withDefaults() BuyerManualFields {
	if strings.TrimSpace(b.DisplayName) == "" {
		b.DisplayName = "Exora Buyer"
	}
	if len(b.SupportedAgentTypes) == 0 {
		b.SupportedAgentTypes = []string{"Codex", "Claude Code", "OpenCode", "Exora agent"}
	}
	if strings.TrimSpace(b.Budget) == "" {
		b.Budget = "Budget is provided per task."
	}
	if strings.TrimSpace(b.RiskBoundary) == "" {
		b.RiskBoundary = "Low-risk compute, research, data, code, and automation only unless the owner approves more."
	}
	if strings.TrimSpace(b.AuthorizationStrategy) == "" {
		b.AuthorizationStrategy = "Human confirmation is required for payments, file disclosure, external writes, and public publishing."
	}
	if strings.TrimSpace(b.IdentityDisclosure) == "" {
		b.IdentityDisclosure = "Minimal identity disclosure before consent."
	}
	if strings.TrimSpace(b.FileDisclosure) == "" {
		b.FileDisclosure = "Task-scoped file metadata only unless the owner confirms more."
	}
	if strings.TrimSpace(b.DataRetention) == "" {
		b.DataRetention = "Inputs may only be retained for the active task unless separately approved."
	}
	if strings.TrimSpace(b.EscrowPreference) == "" {
		b.EscrowPreference = "Use escrow or verifiable payment proof for paid work."
	}
	if len(b.AcceptedTaskTypes) == 0 {
		b.AcceptedTaskTypes = []string{"compute", "research", "data", "code", "automation"}
	}
	return b
}

func (s SellerManualFields) withDefaults(diag Diagnostics) SellerManualFields {
	if strings.TrimSpace(s.SetupStatus) == "" {
		s.SetupStatus = "incomplete"
	}
	if strings.TrimSpace(s.DisplayName) == "" {
		s.DisplayName = "Exora Seller"
	}
	if strings.TrimSpace(s.CapabilitySummary) == "" {
		s.CapabilitySummary = "Local seller agent offering task-scoped compute, code, or agent work."
	}
	if len(s.CapabilityTypes) == 0 {
		s.CapabilityTypes = inferCapabilityTypes(diag)
	}
	if strings.TrimSpace(s.Pricing) == "" {
		s.Pricing = "Task-specific quotes are generated by the seller agent from local pricing policy."
	}
	if strings.TrimSpace(s.SellIntent) == "" {
		s.SellIntent = s.CapabilitySummary
	}
	if strings.TrimSpace(s.PricingPrinciples) == "" {
		s.PricingPrinciples = s.Pricing
	}
	if strings.TrimSpace(s.Availability) == "" {
		s.Availability = "Local availability is checked during seller-agent negotiation."
	}
	if strings.TrimSpace(s.HumanConfirmation) == "" {
		s.HumanConfirmation = "Human confirmation is required for external writes, payments, credential use, and public disclosure."
	}
	if strings.TrimSpace(s.DataBoundary) == "" {
		s.DataBoundary = "Buyer inputs are task-scoped and are not reused for training or resale without consent."
	}
	if strings.TrimSpace(s.ExternalWritePolicy) == "" {
		s.ExternalWritePolicy = "External writes require explicit owner approval."
	}
	if len(s.OutputFormats) == 0 {
		s.OutputFormats = []string{"artifact", "log summary", "receipt"}
	}
	if len(s.Offerings) == 0 && strings.TrimSpace(s.SellIntent) != "" {
		s.Offerings = []string{strings.TrimSpace(s.SellIntent)}
	}
	if len(s.PricingProcess) == 0 && strings.TrimSpace(s.PricingPrinciples) != "" {
		s.PricingProcess = []string{
			"Check whether the requested work matches the published offering and local environment.",
			"Estimate workload, resource use, delivery scope, and execution risk.",
			"Apply the seller's pricing principles and return a task-specific quote.",
		}
	}
	return s
}

func inferCapabilityTypes(diag Diagnostics) []string {
	out := []string{}
	if len(diag.GPUs) > 0 {
		out = append(out, "Compute Capability")
	}
	if diag.PythonVersion != "" || diag.NodeVersion != "" || diag.DockerAvailable {
		out = append(out, "Skill Capability")
	}
	if len(out) == 0 {
		out = append(out, "Skill Capability")
	}
	return out
}

func defaultDisclosure(in map[string]DisclosureLevel) map[string]DisclosureLevel {
	out := map[string]DisclosureLevel{
		"identity":     DisclosurePublic,
		"agent":        DisclosurePublic,
		"environment":  DisclosurePublic,
		"performance":  DisclosureBuyerVisible,
		"pricing":      DisclosurePublic,
		"dataBoundary": DisclosurePublic,
		"credentials":  DisclosureAuditorOnly,
	}
	for key, value := range in {
		if key == "" {
			continue
		}
		switch value {
		case DisclosurePublic, DisclosureBuyerVisible, DisclosurePostConsent, DisclosureAuditorOnly:
			out[key] = value
		}
	}
	return out
}
