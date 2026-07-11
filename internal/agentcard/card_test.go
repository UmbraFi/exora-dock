package agentcard

import "testing"

func TestDraftsPublishWithWhitepaperDefaults(t *testing.T) {
	diag := Diagnostics{CollectedAt: "2026-07-04T00:00:00Z", OS: "windows", Arch: "amd64", CPUCores: 8}
	buyer, err := NewDraft(DraftRequest{Role: RoleBuyer, DockID: "dock-1", Diagnostics: diag})
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidatePublish(buyer); err != nil {
		t.Fatalf("buyer card should be publishable with default policy fields: %v", err)
	}
	if buyer.ManualFields.Buyer.RiskBoundary == "" || buyer.ManualFields.Buyer.AuthorizationStrategy == "" {
		t.Fatalf("buyer defaults missing policy fields: %#v", buyer.ManualFields.Buyer)
	}

	seller, err := NewDraft(DraftRequest{Role: RoleSeller, DockID: "dock-1", Diagnostics: diag})
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidatePublish(seller); err == nil {
		t.Fatalf("seller card should remain incomplete until the Agent permission interview finishes")
	}
	if seller.ManualFields.Seller.SellIntent == "" || seller.ManualFields.Seller.PricingPrinciples == "" || seller.ManualFields.Seller.Pricing == "" || seller.ManualFields.Seller.Availability == "" {
		t.Fatalf("seller defaults missing market fields: %#v", seller.ManualFields.Seller)
	}
	seller.ManualFields.Seller.SetupStatus = "complete"
	seller.ManualFields.Seller.StructuredByAgent = "codex"
	seller.ManualFields.Seller.StructuredAt = "2026-07-04T00:01:00Z"
	seller.ManualFields.Seller.AllowedAgentActions = []string{"inspect accepted task inputs", "prepare a quote"}
	seller.ManualFields.Seller.ApprovalRequired = []string{"use credential alias", "write outside task output"}
	seller.ManualFields.Seller.CredentialPolicy = "Credential aliases only; secret values stay in local owner storage."
	seller.ManualFields.Seller.NetworkPolicy = "Only seller-declared service endpoints are allowed."
	if err := ValidatePublish(seller); err != nil {
		t.Fatalf("seller card should publish after the permission interview completes: %v", err)
	}
}

func TestValidatePublishRequiresRoleMinimumFields(t *testing.T) {
	diag := Diagnostics{CollectedAt: "2026-07-04T00:00:00Z", OS: "windows", Arch: "amd64", CPUCores: 8}
	buyer := AgentCard{
		Role:        RoleBuyer,
		DockID:      "dock-1",
		AgentID:     "agent-1",
		Diagnostics: diag,
		ManualFields: ManualFields{Buyer: BuyerManualFields{
			DisplayName:           "Buyer",
			AuthorizationStrategy: "owner approves risky actions",
			IdentityDisclosure:    "minimal",
			FileDisclosure:        "task-scoped",
		}},
	}
	if err := ValidatePublish(buyer); err == nil {
		t.Fatalf("expected missing buyer riskBoundary to block publish")
	}

	seller := AgentCard{
		Role:        RoleSeller,
		DockID:      "dock-1",
		AgentID:     "agent-1",
		Diagnostics: diag,
		ManualFields: ManualFields{Seller: SellerManualFields{
			DisplayName:       "Seller",
			CapabilitySummary: "compute",
			Availability:      "weekdays",
			HumanConfirmation: "owner confirms risky actions",
		}},
	}
	if err := ValidatePublish(seller); err == nil {
		t.Fatalf("expected missing seller pricing to block publish")
	}
}

func TestDiagnosticsAvoidSensitiveDetails(t *testing.T) {
	diag := CollectDiagnostics(DiagnosticsConfig{MCPAvailable: true})
	if diag.RedactionSummary == "" {
		t.Fatalf("expected redaction summary")
	}
	if diag.MCPEntrypoint != "exora-dock mcp" {
		t.Fatalf("expected generic MCP entrypoint, got %q", diag.MCPEntrypoint)
	}
}
