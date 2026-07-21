package mcp

import (
	"context"
	"strings"
	"testing"
)

func TestProviderToolsRequireIssuedIntegrationScope(t *testing.T) {
	server := NewServer(Options{})
	if server.integrationToolsEnabled(context.Background()) {
		t.Fatal("provider tools must be hidden without a session")
	}
	server.sessionToken = "sk-exora-session-test"
	server.sessionMeta = map[string]any{"scopes": []any{"market.read"}}
	if server.integrationToolsEnabled(context.Background()) {
		t.Fatal("provider tools must be hidden without provider.integrate")
	}
	server.sessionMeta = map[string]any{"scopes": []any{"market.read", "provider.integrate"}}
	if !server.integrationToolsEnabled(context.Background()) {
		t.Fatal("provider tools must be visible with provider.integrate")
	}
}

func TestProviderMCPExposesOnlyFinalFormTools(t *testing.T) {
	want := map[string]bool{
		"exora.get_api_preparation_guide": true,
		"exora.create_api_draft":          true,
		"exora.submit_api_contract":       true,
		"exora.list_api_drafts":           true,
		"exora.get_api_draft":             true,
		"exora.get_api_validation":        true,
	}
	if len(integrationToolNames) != len(want) {
		t.Fatalf("provider tool count=%d want %d", len(integrationToolNames), len(want))
	}
	for name := range want {
		if !integrationToolNames[name] {
			t.Fatalf("missing final-form tool %s", name)
		}
	}
	definitions := map[string]bool{}
	for _, definition := range integrationToolDefinitions() {
		definitions[definition.Name] = true
	}
	if len(definitions) != len(want) {
		t.Fatalf("provider tool definition count=%d want %d", len(definitions), len(want))
	}
	for name := range want {
		if !definitions[name] {
			t.Fatalf("missing provider tool definition %s", name)
		}
	}
}

func TestCreateDraftToolIsRetrySafeAndCannotPublish(t *testing.T) {
	var create toolDefinition
	for _, definition := range integrationToolDefinitions() {
		if definition.Name == "exora.create_api_draft" {
			create = definition
			break
		}
	}
	properties, _ := create.InputSchema["properties"].(map[string]any)
	for _, name := range []string{"title", "deliveryMode", "idempotencyKey"} {
		if properties[name] == nil {
			t.Fatalf("create Draft input %s is missing: %#v", name, create.InputSchema)
		}
	}
	if properties["apiId"] != nil || properties["publish"] != nil || properties["status"] != nil {
		t.Fatalf("create Draft tool accepts owner-only state: %#v", create.InputSchema)
	}
	if !strings.Contains(create.Description, "new Dock-owned stable UID") || !strings.Contains(create.Description, "cannot validate, confirm, publish") {
		t.Fatalf("create Draft boundary is unclear: %q", create.Description)
	}
}

func TestSubmitContractToolRequiresStableUIDInPlaceUpdate(t *testing.T) {
	var submit toolDefinition
	for _, definition := range integrationToolDefinitions() {
		if definition.Name == "exora.submit_api_contract" {
			submit = definition
			break
		}
	}
	properties, _ := submit.InputSchema["properties"].(map[string]any)
	if properties["apiId"] == nil || properties["expectedVersion"] == nil {
		t.Fatalf("stable UID update inputs are missing: %#v", submit.InputSchema)
	}
	required, _ := submit.InputSchema["required"].([]string)
	requiredText := strings.Join(required, " ")
	if !strings.Contains(requiredText, "apiId") || !strings.Contains(requiredText, "expectedVersion") || !strings.Contains(requiredText, "contract") {
		t.Fatalf("contract submission must bind the stable UID and version: %#v", required)
	}
	if !strings.Contains(submit.Description, "stable API UID") {
		t.Fatalf("tool does not explain stable UID behavior: %q", submit.Description)
	}
}

func TestPreparationGuideIsStatelessAndStartsAtAssess(t *testing.T) {
	guide, err := apiPreparationGuide(map[string]any{"startingPoint": "code_or_cli", "deliveryMode": "local_dock"})
	if err != nil {
		t.Fatal(err)
	}
	if guide["stateful"] != false || guide["authoritativeValidation"] != false {
		t.Fatalf("guide must be non-authoritative and stateless: %#v", guide)
	}
	step := guide["currentStep"].(map[string]any)
	if step["id"] != "assess" || guide["nextStep"] != "make_runnable" {
		t.Fatalf("unexpected initial guide step: %#v", guide)
	}
	if strings.Contains(strings.Join(step["relevantTools"].([]string), " "), "submit_api_capability") {
		t.Fatal("assessment must not submit or create a Draft")
	}
}

func TestPreparationGuideRoutesByStartingPointAndDelivery(t *testing.T) {
	guide, err := apiPreparationGuide(map[string]any{"startingPoint": "openapi_3_1", "deliveryMode": "cloud_direct", "step": "define_operations"})
	if err != nil {
		t.Fatal(err)
	}
	route := strings.Join(guide["route"].([]string), ",")
	if strings.Contains(route, "make_runnable") {
		t.Fatalf("OpenAPI route should not rebuild an existing runtime: %s", route)
	}
	step := guide["currentStep"].(map[string]any)
	delivery := strings.Join(step["deliveryRequirements"].([]string), " ")
	if !strings.Contains(delivery, "HTTPS") || !strings.Contains(delivery, "authentication alias") {
		t.Fatalf("Cloud guide is missing delivery requirements: %s", delivery)
	}
}

func TestPreparationGuideSubmitAndOptionalPricingBoundary(t *testing.T) {
	guide, err := apiPreparationGuide(map[string]any{"startingPoint": "complete_candidate", "deliveryMode": "local_dock", "step": "submit"})
	if err != nil {
		t.Fatal(err)
	}
	tools := strings.Join(guide["currentStep"].(map[string]any)["relevantTools"].([]string), " ")
	if !strings.Contains(tools, "exora.submit_api_contract") || !strings.Contains(tools, "exora.get_api_validation") {
		t.Fatalf("submit guide is missing final-form tools: %s", tools)
	}
	if !strings.Contains(guide["nextStep"].(string), "only when the seller explicitly requests") {
		t.Fatalf("pricing must remain optional: %#v", guide["nextStep"])
	}
}

func TestPreparationGuideCanEncodeButCannotChooseOrConfirmPricing(t *testing.T) {
	guide, err := apiPreparationGuide(map[string]any{
		"startingPoint": "complete_candidate",
		"deliveryMode":  "local_dock",
		"step":          "pricing",
	})
	if err != nil {
		t.Fatal(err)
	}
	step := guide["currentStep"].(map[string]any)
	evidence := strings.Join(step["requiredEvidence"].([]string), " ")
	blockers := strings.Join(step["blockingConditions"].([]string), " ")
	tools := strings.Join(step["relevantTools"].([]string), " ")
	if !strings.Contains(evidence, "Explicit maximum") || !strings.Contains(blockers, "confirm the contract") {
		t.Fatalf("pricing guide must require explicit seller intent and preserve the owner gate: evidence=%q blockers=%q", evidence, blockers)
	}
	if strings.Contains(tools, "submit") || integrationToolNames["exora.submit_pricing_suggestions"] {
		t.Fatalf("Agent pricing mutation is still exposed: %q", tools)
	}
}

func TestPreparationGuideRejectsInvalidOrSkippedSteps(t *testing.T) {
	if _, err := apiPreparationGuide(map[string]any{"startingPoint": "unknown", "deliveryMode": "local_dock"}); err == nil {
		t.Fatal("expected invalid startingPoint to fail")
	}
	if _, err := apiPreparationGuide(map[string]any{"startingPoint": "complete_candidate", "deliveryMode": "cloud_direct", "step": "make_runnable"}); err == nil {
		t.Fatal("expected a step outside the selected route to fail")
	}
	if _, err := apiPreparationGuide(map[string]any{"startingPoint": "code_or_cli", "deliveryMode": "other"}); err == nil {
		t.Fatal("expected invalid deliveryMode to fail")
	}
}

func TestBuyerMCPUsesAPIAndOperationIDs(t *testing.T) {
	want := map[string]bool{"exora.search_operations": true, "exora.get_api": true, "exora.estimate_operation": true, "exora.invoke_operation": true, "exora.get_invocation": true, "exora.create_artifact_download_grant": true, "exora.get_ledger": true}
	for _, definition := range marketplaceToolDefinitions() {
		delete(want, definition.Name)
	}
	if len(want) != 0 {
		t.Fatalf("missing Buyer tools: %#v", want)
	}
}
