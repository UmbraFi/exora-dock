package agentcard

import "testing"

func TestDraftsRequireManualFieldsBeforePublish(t *testing.T) {
	diag := Diagnostics{CollectedAt: "2026-07-04T00:00:00Z", OS: "windows", Arch: "amd64", CPUCores: 8}
	buyer, err := NewDraft(DraftRequest{Role: RoleBuyer, DockID: "dock-1", Diagnostics: diag})
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidatePublish(buyer); err == nil {
		t.Fatalf("expected buyer draft to require manual fields")
	}
	buyer.ManualFields.Buyer.Budget = "80 USDC / task"
	buyer.ManualFields.Buyer.RiskBoundary = "Low-risk compute and research only."
	if err := ValidatePublish(buyer); err != nil {
		t.Fatalf("buyer should be publishable after required fields: %v", err)
	}

	seller, err := NewDraft(DraftRequest{Role: RoleSeller, DockID: "dock-1", Diagnostics: diag})
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidatePublish(seller); err == nil {
		t.Fatalf("expected seller draft to require manual fields")
	}
	seller.ManualFields.Seller.DisplayName = "Local Provider"
	seller.ManualFields.Seller.CapabilitySummary = "Safe local code and compute work."
	seller.ManualFields.Seller.Pricing = "Quote first."
	seller.ManualFields.Seller.Availability = "Manual approval."
	if err := ValidatePublish(seller); err != nil {
		t.Fatalf("seller should be publishable after required fields: %v", err)
	}
}

func TestDiagnosticsAvoidSensitiveDetails(t *testing.T) {
	diag := CollectDiagnostics(DiagnosticsConfig{LLMProvider: "https://api.openai.com/v1", LLMConfigured: true, MCPAvailable: true})
	if diag.LLMProvider != "api.openai.com" {
		t.Fatalf("provider should be summarized, got %q", diag.LLMProvider)
	}
	if diag.RedactionSummary == "" {
		t.Fatalf("expected redaction summary")
	}
	if diag.MCPEntrypoint != "exora-dock mcp" {
		t.Fatalf("expected generic MCP entrypoint, got %q", diag.MCPEntrypoint)
	}
}
