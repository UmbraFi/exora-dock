package samplemarket

import (
	"fmt"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/agentcard"
	"github.com/exora-dock/exora-dock/internal/resource"
)

type BuyerSettings struct {
	DisplayName           string   `json:"displayName,omitempty"`
	Budget                string   `json:"budget,omitempty"`
	RiskBoundary          string   `json:"riskBoundary,omitempty"`
	AuthorizationStrategy string   `json:"authorizationStrategy,omitempty"`
	IdentityDisclosure    string   `json:"identityDisclosure,omitempty"`
	FileDisclosure        string   `json:"fileDisclosure,omitempty"`
	DataRetention         string   `json:"dataRetention,omitempty"`
	EscrowPreference      string   `json:"escrowPreference,omitempty"`
	Preferences           []string `json:"preferences,omitempty"`
	AcceptedTaskTypes     []string `json:"acceptedTaskTypes,omitempty"`
}

type Metric struct {
	Label string `json:"label"`
	Value string `json:"value"`
	Hint  string `json:"hint,omitempty"`
}

type SourceRef struct {
	Label string `json:"label"`
	Path  string `json:"path"`
}

type MarketRailCard struct {
	ID         string      `json:"id"`
	Stage      string      `json:"stage"`
	Status     string      `json:"status"`
	Title      string      `json:"title"`
	Provider   string      `json:"provider,omitempty"`
	Summary    string      `json:"summary"`
	Metrics    []Metric    `json:"metrics,omitempty"`
	Chips      []string    `json:"chips,omitempty"`
	Risk       string      `json:"risk,omitempty"`
	NextAction string      `json:"nextAction,omitempty"`
	SourceRefs []SourceRef `json:"sourceRefs,omitempty"`
}

type RailResponse struct {
	BuyerSettings BuyerSettings    `json:"buyerSettings"`
	Cards         []MarketRailCard `json:"cards"`
}

func Seed(resources *resource.Store, cards *agentcard.Store, dockID string, providerPubkey string) error {
	var errs []string
	if resources != nil && len(resources.List()) == 0 {
		for _, res := range sampleResources(firstNonEmpty(providerPubkey, dockID, "sample-provider-a6000")) {
			if err := resources.Save(res); err != nil {
				errs = append(errs, err.Error())
			}
		}
	}
	if cards != nil {
		if _, ok := cards.Get(agentcard.RoleBuyer); !ok {
			card, err := sampleBuyerCard(firstNonEmpty(dockID, "sample-buyer-dock"))
			if err != nil {
				errs = append(errs, err.Error())
			} else if err := cards.Save(card); err != nil {
				errs = append(errs, err.Error())
			}
		}
		if _, ok := cards.Get(agentcard.RoleSeller); !ok {
			card, err := sampleSellerCard(firstNonEmpty(dockID, "sample-seller-dock"), firstNonEmpty(providerPubkey, "sample-provider-a6000"))
			if err != nil {
				errs = append(errs, err.Error())
			} else if err := cards.Save(card); err != nil {
				errs = append(errs, err.Error())
			}
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return nil
}

func RailCards(cards *agentcard.Store) RailResponse {
	return RailResponse{
		BuyerSettings: buyerSettings(cards),
		Cards:         sampleRailCards(),
	}
}

func buyerSettings(cards *agentcard.Store) BuyerSettings {
	if cards != nil {
		if card, ok := cards.Get(agentcard.RoleBuyer); ok {
			buyer := card.ManualFields.Buyer
			return BuyerSettings{
				DisplayName:           buyer.DisplayName,
				Budget:                buyer.Budget,
				RiskBoundary:          buyer.RiskBoundary,
				AuthorizationStrategy: buyer.AuthorizationStrategy,
				IdentityDisclosure:    buyer.IdentityDisclosure,
				FileDisclosure:        buyer.FileDisclosure,
				DataRetention:         buyer.DataRetention,
				EscrowPreference:      buyer.EscrowPreference,
				Preferences:           buyer.Preferences,
				AcceptedTaskTypes:     buyer.AcceptedTaskTypes,
			}
		}
	}
	card, _ := sampleBuyerCard("sample-buyer-dock")
	buyer := card.ManualFields.Buyer
	return BuyerSettings{
		DisplayName:           buyer.DisplayName,
		Budget:                buyer.Budget,
		RiskBoundary:          buyer.RiskBoundary,
		AuthorizationStrategy: buyer.AuthorizationStrategy,
		IdentityDisclosure:    buyer.IdentityDisclosure,
		FileDisclosure:        buyer.FileDisclosure,
		DataRetention:         buyer.DataRetention,
		EscrowPreference:      buyer.EscrowPreference,
		Preferences:           buyer.Preferences,
		AcceptedTaskTypes:     buyer.AcceptedTaskTypes,
	}
}

func sampleRailCards() []MarketRailCard {
	return []MarketRailCard{
		{
			ID:       "sample-seller-card-gpu",
			Stage:    "Seller Agent Card",
			Status:   "published",
			Title:    "A6000 Inference Seller",
			Provider: "sample-provider-a6000",
			Summary:  "48GB VRAM A6000 worker with CUDA 12, Docker isolation, Python 3.11, and gpu-standard-v3. Low-risk inference quotes can be automated; external writes, credentials, or public disclosure require human confirmation.",
			Metrics: []Metric{
				{Label: "VRAM", Value: "48GB", Hint: "A6000 available memory"},
				{Label: "Runtime", Value: "CUDA 12", Hint: "Docker isolated"},
				{Label: "Policy", Value: "low-risk auto", Hint: "gpu-standard-v3"},
			},
			Chips:      []string{"A6000", "Docker isolation", "Python 3.11", "gpu-standard-v3"},
			Risk:       "External writes, credential use, public disclosure, and payment require human confirmation.",
			NextAction: "Use this public card for matching; disclose task files only after consent.",
			SourceRefs: agentCardSourceRefs(),
		},
		{
			ID:       "sample-match-gpu",
			Stage:    "Match",
			Status:   "matched",
			Title:    "40GB+ inference match",
			Provider: "sample-provider-a6000",
			Summary:  "Buyer intent asks for a large-VRAM inference run. The seller matches VRAM, CUDA, isolated execution, and verifiable output requirements.",
			Metrics: []Metric{
				{Label: "Score", Value: "0.91", Hint: "Capability and risk fit"},
				{Label: "Requirement", Value: "40GB+", Hint: "Minimum VRAM"},
				{Label: "Evidence", Value: "hashes", Hint: "Artifact manifest required"},
			},
			Chips:      []string{"gpu_vram_gb >= 40", "cuda available", "isolated execution", "returns artifact hashes"},
			Risk:       "New provider with limited reputation history; keep budget and input scope bounded.",
			NextAction: "Contact up to three sellers for valuation before asking the user to choose.",
			SourceRefs: negotiationSourceRefs(),
		},
		{
			ID:       "sample-quote-gpu",
			Stage:    "Quote",
			Status:   "can_accept",
			Title:    "Inference quote ready",
			Provider: "sample-provider-a6000",
			Summary:  "Seller can accept for 12.5 USDC with a 45m ETA. Live snapshot is 47GB VRAM available, queue 0, and 320GB disk; deliver results.jsonl, logs.txt, and artifact_manifest.json.",
			Metrics: []Metric{
				{Label: "Price", Value: "12.5 USDC", Hint: "Minimum plus runtime estimate"},
				{Label: "ETA", Value: "45m", Hint: "Quote valid for 30 minutes"},
				{Label: "Snapshot", Value: "47GB / q0", Hint: "320GB disk free"},
			},
			Chips:      []string{"results.jsonl", "logs.txt", "artifact_manifest.json"},
			Risk:       "Model download time can extend ETA if the requested model is not cached.",
			NextAction: "Create owner selection and payment approval; do not execute before acceptance.",
			SourceRefs: negotiationSourceRefs(),
		},
		{
			ID:       "sample-needs-render",
			Stage:    "Needs Negotiation",
			Status:   "needs_negotiation",
			Title:    "Render task missing inputs",
			Provider: "sample-render-provider",
			Summary:  "Seller can quote the render job only after the task manifest includes the project package and concrete render settings.",
			Metrics: []Metric{
				{Label: "Budget", Value: "20 -> 28 USDC", Hint: "Requested adjustment"},
				{Label: "Missing", Value: "6 fields", Hint: "Inputs needed for firm quote"},
				{Label: "State", Value: "valuation", Hint: "No execution yet"},
			},
			Chips:      []string{"project archive", "software version", "frame range", "render engine", "output format", "asset manifest"},
			Risk:       "Do not guess assets, plugins, frame ranges, or output format.",
			NextAction: "Ask buyer to provide missing fields or relax price/deadline before quote review.",
			SourceRefs: []SourceRef{{Label: "Agent render example", Path: "exora-dock/docs/agent-whitepaper.md#render-task-example"}},
		},
		{
			ID:       "sample-reject-data",
			Stage:    "Reject",
			Status:   "rejected",
			Title:    "Data request rejected",
			Provider: "sample-data-vault",
			Summary:  "Provider refuses to sell unauthorized or non-retainable data, and suggests a public filings dataset with source summaries and 7-day input deletion.",
			Metrics: []Metric{
				{Label: "Decision", Value: "reject", Hint: "Policy boundary"},
				{Label: "Retention", Value: "7d", Hint: "For accepted public data tasks"},
				{Label: "Output", Value: "sourced summary", Hint: "Include timestamps"},
			},
			Chips:      []string{"public filings", "source citations", "updated-at", "no resale"},
			Risk:       "Data provider must declare provenance, update time, license scope, and allowed use.",
			NextAction: "Revise task to use licensed sources or request an aggregated answer with provenance.",
			SourceRefs: []SourceRef{{Label: "Data boundary", Path: "WHITEPAPER.md#data-capability"}},
		},
		{
			ID:       "sample-consent-travel",
			Stage:    "Consent",
			Status:   "managed_api_guarded",
			Title:    "Managed travel API guardrail",
			Provider: "sample-travel-agent",
			Summary:  "Seller can query live flight options and booking links, but booking, payment, and identity disclosure require a separate approval.",
			Metrics: []Metric{
				{Label: "Action", Value: "query only", Hint: "Before consent"},
				{Label: "Writes", Value: "blocked", Hint: "No booking without approval"},
				{Label: "Receipt", Value: "redacted", Hint: "Trace after execution"},
			},
			Chips:      []string{"prices", "times", "baggage", "cancellation", "booking links", "receipt summary"},
			Risk:       "Real booking, payment, passenger identity, and external account writes must enter the Dock approval queue.",
			NextAction: "Return options first; ask for explicit consent before any irreversible action.",
			SourceRefs: []SourceRef{{Label: "Managed API boundary", Path: "WHITEPAPER.md#managed-api-capability"}},
		},
	}
}

func sampleResources(provider string) []resource.Resource {
	now := time.Now().UTC()
	created := now.Add(-2 * time.Hour).Format(time.RFC3339)
	updated := now.Format(time.RFC3339)
	return []resource.Resource{
		{
			ID:                 "sample-a6000-inference-seller",
			Name:               "A6000 Inference Seller",
			Type:               resource.TypeGPU,
			Summary:            "Task-scoped 48GB VRAM inference with artifact hashes.",
			Description:        "CUDA 12, Python 3.11, and Docker-isolated inference runs. External writes, credential use, public disclosure, and payment require human confirmation.",
			Provider:           provider,
			ProviderPubkey:     provider,
			PricePerUnit:       12.5,
			BillingUnit:        resource.BillingHour,
			MinDurationMinutes: 30,
			MaxDurationMinutes: 180,
			Availability:       "available",
			Tags:               []string{"sample", "gpu", "inference", "agent-card"},
			Spec:               resource.Spec{GPUModel: "RTX A6000", GPUCount: 1, VRAMGB: 48, CPUCores: 16, RAMGB: 128, StorageGB: 1024, Region: "us-west", Runtime: "CUDA 12 / Python 3.11 / Docker"},
			CredentialHint:     "No direct SSH; task-scoped artifact channel only.",
			Reputation:         82,
			QualityScore:       91,
			CreatedAt:          created,
			UpdatedAt:          updated,
			Review:             sampleReview(updated),
		},
		{
			ID:                 "sample-render-a6000",
			Name:               "Render Negotiation Worker",
			Type:               resource.TypeGPU,
			Summary:            "Render valuation worker that requires explicit project and frame settings.",
			Description:        "Quotes render jobs only after receiving a project archive, software version, frame range, render engine, output format, and asset manifest.",
			Provider:           "sample-render-provider",
			ProviderPubkey:     "sample-render-provider",
			PricePerUnit:       28,
			BillingUnit:        resource.BillingHour,
			MinDurationMinutes: 30,
			MaxDurationMinutes: 240,
			Availability:       "quote_required",
			Tags:               []string{"sample", "render", "needs-negotiation"},
			Spec:               resource.Spec{GPUModel: "RTX A6000", GPUCount: 1, VRAMGB: 48, Region: "us-west", Runtime: "Blender / Docker"},
			CredentialHint:     "Project package transferred only after quote acceptance.",
			Reputation:         80,
			QualityScore:       88,
			CreatedAt:          created,
			UpdatedAt:          updated,
			Review:             sampleReview(updated),
		},
		{
			ID:                 "sample-public-filings-dataset",
			Name:               "Public Filings Dataset",
			Type:               resource.TypeDataset,
			Summary:            "Licensed public-filings data with provenance and update timestamps.",
			Description:        "Provider rejects unauthorized data resale and offers a licensed public-filings alternative with sourced summaries and 7-day input retention.",
			Provider:           "sample-data-vault",
			ProviderPubkey:     "sample-data-vault",
			PricePerUnit:       4,
			BillingUnit:        resource.BillingRequest,
			MinDurationMinutes: 1,
			MaxDurationMinutes: 60,
			Availability:       "available",
			Tags:               []string{"sample", "data", "provenance"},
			Spec:               resource.Spec{DatasetSizeGB: 38, License: "commercial-eval", Region: "global", AccessMode: "sourced-answer"},
			CredentialHint:     "No raw credential disclosure.",
			Reputation:         84,
			QualityScore:       90,
			CreatedAt:          created,
			UpdatedAt:          updated,
			Review:             sampleReview(updated),
		},
		{
			ID:                 "sample-travel-managed-api",
			Name:               "Managed Travel API Agent",
			Type:               resource.TypeProject,
			Summary:            "Live flight options and booking links without payment or booking before consent.",
			Description:        "Managed API provider can query prices, times, baggage, cancellation terms, and booking links. Real booking and identity disclosure require separate Dock approval.",
			Provider:           "sample-travel-agent",
			ProviderPubkey:     "sample-travel-agent",
			PricePerUnit:       2.5,
			BillingUnit:        resource.BillingRequest,
			MinDurationMinutes: 1,
			MaxDurationMinutes: 30,
			Availability:       "available",
			Tags:               []string{"sample", "managed-api", "travel", "consent"},
			Spec:               resource.Spec{Region: "global", AccessMode: "managed-api", Runtime: "Travel supplier API proxy"},
			CredentialHint:     "Provider credentials stay private.",
			Reputation:         79,
			QualityScore:       87,
			CreatedAt:          created,
			UpdatedAt:          updated,
			Review:             sampleReview(updated),
		},
	}
}

func sampleBuyerCard(dockID string) (agentcard.AgentCard, error) {
	return agentcard.NewDraft(agentcard.DraftRequest{
		Role:    agentcard.RoleBuyer,
		DockID:  dockID,
		AgentID: "sample-buyer-agent",
		Buyer: agentcard.BuyerManualFields{
			DisplayName:           "Exora Buyer Sample",
			Budget:                "20 USDC default task cap unless the owner approves more.",
			Preferences:           []string{"balanced price and speed", "privacy first", "prefer verifiable artifacts"},
			RiskBoundary:          "Low-risk compute, data, code, and managed API research only before explicit consent.",
			AuthorizationStrategy: "Human confirmation is required for payments, identity disclosure, file transfer, external writes, and public publishing.",
			AcceptedTaskTypes:     []string{"compute", "research", "data", "code", "managed_api"},
			IdentityDisclosure:    "Minimal identity disclosure before consent.",
			FileDisclosure:        "Task-scoped file metadata only unless the owner confirms more.",
			DataRetention:         "Inputs may only be retained for the active task unless separately approved.",
			EscrowPreference:      "Use escrow or verifiable payment proof for paid work.",
		},
		Diagnostics: sampleDiagnostics(),
	})
}

func sampleSellerCard(dockID string, provider string) (agentcard.AgentCard, error) {
	autoQuote := true
	autoAcceptLowRisk := false
	return agentcard.NewDraft(agentcard.DraftRequest{
		Role:    agentcard.RoleSeller,
		DockID:  dockID,
		AgentID: "sample-seller-agent",
		Seller: agentcard.SellerManualFields{
			DisplayName:         "A6000 Inference Seller",
			CapabilitySummary:   "48GB VRAM inference runs with CUDA 12, Docker isolation, Python 3.11, and artifact hash delivery.",
			CapabilityTypes:     []string{"Compute Capability", "Skill Capability"},
			Pricing:             "gpu-standard-v3: 12.5 USDC sample quote for a 45 minute inference run; real price must use live device state.",
			Availability:        "Available when queue length is 0 and 47GB+ VRAM is free.",
			HumanConfirmation:   "Human confirmation is required for external writes, credential use, public disclosure, and payment.",
			DataBoundary:        "Buyer inputs are task-scoped, not reused for training, and deleted within 7 days unless separately approved.",
			ManagedAPIs:         []string{"none public in sample gpu card"},
			OutputFormats:       []string{"results.jsonl", "logs.txt", "artifact_manifest.json"},
			AutoQuote:           &autoQuote,
			AutoAcceptLowRisk:   &autoAcceptLowRisk,
			ExternalWritePolicy: "External writes require explicit owner approval.",
		},
		Diagnostics: sampleDiagnosticsForProvider(provider),
	})
}

func sampleDiagnostics() agentcard.Diagnostics {
	now := time.Now().UTC()
	return agentcard.Diagnostics{
		CollectedAt:        now.Format(time.RFC3339),
		ExpiresAt:          now.Add(24 * time.Hour).Format(time.RFC3339),
		OS:                 "sample",
		Arch:               "amd64",
		CPUCores:           8,
		RAMGB:              32,
		DockerAvailable:    true,
		PythonVersion:      "3.11",
		NodeVersion:        "22",
		MCPAvailable:       true,
		MCPEntrypoint:      "exora-dock mcp",
		LLMProvider:        "OpenAI-compatible",
		LLMConfigured:      true,
		SellerAgentEnabled: true,
		CommandExecutor:    false,
		NetworkCheck:       "sample",
		RedactionSummary:   "Secrets, private keys, raw credentials, internal endpoints, and full private paths are excluded.",
		DiagnosticsVersion: "samplemarket/v0.1",
	}
}

func sampleDiagnosticsForProvider(provider string) agentcard.Diagnostics {
	diag := sampleDiagnostics()
	diag.GPUs = []agentcard.GPUInfo{{Name: "NVIDIA RTX A6000", Chip: "A6000", DeviceID: provider, DriverVersion: "sample", VRAMGB: 48}}
	diag.Storage = []agentcard.StorageInfo{{Label: "sample-workspace", TotalGB: 1024, FreeGB: 320, UsedPercent: 69}}
	diag.Dependencies = []agentcard.DependencyInfo{
		{Name: "CUDA", Version: "12", Source: "diagnostics"},
		{Name: "Docker", Version: "available", Source: "diagnostics"},
		{Name: "Python", Version: "3.11", Source: "diagnostics"},
	}
	return diag
}

func sampleReview(_ string) resource.ReviewMeta {
	return resource.ReviewMeta{
		Approved:    true,
		Reason:      "sample market card for local demo",
		MinerPubkey: "samplemarket",
		Timestamp:   time.Now().Unix(),
	}
}

func agentCardSourceRefs() []SourceRef {
	return []SourceRef{
		{Label: "Agent Card fields", Path: "WHITEPAPER.md#agent-card-agent-card"},
		{Label: "Seller policy", Path: "exora-dock/docs/agent-whitepaper.md#seller-agent"},
	}
}

func negotiationSourceRefs() []SourceRef {
	return []SourceRef{
		{Label: "Discover -> Negotiate -> Quote", Path: "WHITEPAPER.md#core-flow"},
		{Label: "Provider valuation", Path: "exora-dock/docs/agent-whitepaper.md#task-valuation"},
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
