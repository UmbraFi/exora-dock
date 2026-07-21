package mcp

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

var integrationToolNames = map[string]bool{
	"exora.get_api_preparation_guide": true,
	"exora.create_api_draft":          true,
	"exora.submit_api_contract":       true,
	"exora.list_api_drafts":           true,
	"exora.get_api_draft":             true,
	"exora.get_api_validation":        true,
}

func isIntegrationTool(name string) bool { return integrationToolNames[strings.TrimSpace(name)] }

func (s *Server) integrationToolsEnabled(context.Context) bool {
	s.sessionMu.RLock()
	defer s.sessionMu.RUnlock()
	if strings.TrimSpace(s.sessionToken) == "" {
		return false
	}
	switch scopes := s.sessionMeta["scopes"].(type) {
	case []any:
		for _, scope := range scopes {
			if value, ok := scope.(string); ok && value == "provider.integrate" {
				return true
			}
		}
	case []string:
		for _, scope := range scopes {
			if scope == "provider.integrate" {
				return true
			}
		}
	}
	return false
}

func (s *Server) integrationProxy(ctx context.Context, method, path string, query url.Values, body any, _ ...map[string]string) (toolResult, error) {
	payload, err := s.daemonJSONWithToken(ctx, method, path, query, body, s.currentSessionToken())
	if err != nil {
		return daemonToolError(err), nil
	}
	return successResult(payload), nil
}

func (s *Server) callIntegrationTool(ctx context.Context, name string, args map[string]any) (toolResult, error) {
	base := "/v4/api-drafts"
	apiID := firstString(args, "apiId")
	switch name {
	case "exora.get_api_preparation_guide":
		guide, err := apiPreparationGuide(args)
		if err != nil {
			return errorResult(err.Error(), map[string]any{"error": err.Error(), "errorCode": "invalid_guide_request"}), nil
		}
		return successResult(guide), nil
	case "exora.create_api_draft":
		deliveryMode := strings.TrimSpace(firstString(args, "deliveryMode"))
		if deliveryMode != "local_dock" && deliveryMode != "cloud_direct" {
			return errorResult("deliveryMode must be local_dock or cloud_direct", map[string]any{"errorCode": "invalid_delivery_mode"}), nil
		}
		idempotencyKey := strings.TrimSpace(firstString(args, "idempotencyKey"))
		if idempotencyKey == "" {
			return errorResult("idempotencyKey required", map[string]any{"errorCode": "idempotency_key_required"}), nil
		}
		body := map[string]any{
			"deliveryMode":   deliveryMode,
			"displayName":    strings.TrimSpace(firstString(args, "title")),
			"idempotencyKey": idempotencyKey,
			"source":         "agent",
		}
		return s.integrationProxy(ctx, http.MethodPost, "/v4/local/api-drafts", nil, body)
	case "exora.submit_api_contract":
		if apiID == "" {
			return errorResult("apiId required; create or select a stable local API draft first", nil), nil
		}
		body := map[string]any{"expectedVersion": int64(firstNumber(args, "expectedVersion")), "contract": args["contract"], "idempotencyKey": firstString(args, "idempotencyKey"), "source": "agent", "replaceLockedContract": false}
		return s.integrationProxy(ctx, http.MethodPut, "/v4/local/api-drafts/"+url.PathEscape(apiID)+"/contract", nil, body)
	case "exora.list_api_drafts":
		return s.integrationProxy(ctx, http.MethodGet, base, nil, nil)
	case "exora.get_api_draft":
		if apiID == "" {
			return errorResult("apiId required", nil), nil
		}
		return s.integrationProxy(ctx, http.MethodGet, base+"/"+url.PathEscape(apiID), nil, nil)
	case "exora.get_api_validation":
		if apiID == "" {
			return errorResult("apiId required", nil), nil
		}
		return s.integrationProxy(ctx, http.MethodGet, base+"/"+url.PathEscape(apiID)+"/validation", nil, nil)
	}
	return errorResult("unknown API capability tool", nil), nil
}

func integrationToolDefinitions() []toolDefinition {
	definitions := []toolDefinition{
		{Name: "exora.get_api_preparation_guide", Title: "Get API Contract Guide", Description: "Read one stateless step of Exora's Seller Agent contract guide. The final artifact is one exora.api-contract.v1 JSON file containing capability, Seller cases and automated billing rules. This tool never runs validation or confirms a contract.", InputSchema: strictObjectSchema(map[string]any{"startingPoint": enumStringProp("Current form of the seller capability.", "description_only", "code_or_cli", "undocumented_http", "partial_contract", "openapi_3_1", "complete_candidate"), "deliveryMode": enumStringProp("How the API will be delivered.", "local_dock", "cloud_direct"), "step": enumStringProp("Guide step. Omit to start at assess.", "assess", "make_runnable", "define_operations", "document_contract", "prepare_qualification", "assemble_form", "submit", "pricing")}, []string{"startingPoint", "deliveryMode"})},
		{Name: "exora.create_api_draft", Title: "Create Exora API Draft", Description: "Create one empty, non-Live API Draft with a new Dock-owned stable UID. Use the returned apiId and version when submitting a UID-free exora.api-contract.v1 contract. This tool cannot validate, confirm, publish, or change lifecycle.", InputSchema: strictObjectSchema(map[string]any{"title": stringProp("Seller-supplied display name for the new Draft."), "deliveryMode": enumStringProp("How the API will be delivered.", "local_dock", "cloud_direct"), "idempotencyKey": stringProp("Unique retry-safe Draft creation key.")}, []string{"title", "deliveryMode", "idempotencyKey"})},
		{Name: "exora.submit_api_contract", Title: "Submit Exora API Contract", Description: "Submit one complete exora.api-contract.v1 source file to an existing stable API UID. The contract includes exora.api.v3 capability, safe Seller cases and one exora.price-formula.v4 billing rule per Operation. The Agent may author and submit the file, but cannot run either validation, confirm, publish or change lifecycle.", InputSchema: strictObjectSchema(map[string]any{"apiId": stringProp("Existing stable API UID."), "expectedVersion": integerProp("Current version of the API Draft."), "contract": objectProp("Complete exora.api-contract.v1 JSON object."), "idempotencyKey": stringProp("Unique retry-safe submission key.")}, []string{"apiId", "expectedVersion", "contract", "idempotencyKey"})},
		{Name: "exora.list_api_drafts", Title: "List Exora API Drafts", Description: "List persisted local preparation drafts as well as accepted API Drafts and their per-Operation owner review state.", InputSchema: strictObjectSchema(map[string]any{}, nil)},
		{Name: "exora.get_api_draft", Title: "Get Exora API Draft", Description: "Read one persisted API Draft by its stable UID, including an incomplete local preparation draft, Capability Form and per-Operation review state.", InputSchema: strictObjectSchema(map[string]any{"apiId": stringProp("Stable API UID.")}, []string{"apiId"})},
		{Name: "exora.get_api_validation", Title: "Get Exora API Validation", Description: "Read independent Dock validation results and current per-Operation hashes. This tool does not run or approve a Runtime.", InputSchema: strictObjectSchema(map[string]any{"apiId": stringProp("API Draft id.")}, []string{"apiId"})},
	}
	for index := range definitions {
		definitions[index].RequiredScope = "provider.integrate"
		definitions[index].Annotations = readOnlyAnnotations(false)
	}
	for index := range definitions {
		switch definitions[index].Name {
		case "exora.create_api_draft", "exora.submit_api_contract":
			definitions[index].Annotations = writeAnnotations(false, true, true)
		}
	}
	return definitions
}

var preparationGuideRoutes = map[string][]string{
	"description_only":   {"assess", "make_runnable", "define_operations", "document_contract", "prepare_qualification", "assemble_form", "submit"},
	"code_or_cli":        {"assess", "make_runnable", "define_operations", "document_contract", "prepare_qualification", "assemble_form", "submit"},
	"undocumented_http":  {"assess", "define_operations", "document_contract", "prepare_qualification", "assemble_form", "submit"},
	"partial_contract":   {"assess", "define_operations", "document_contract", "prepare_qualification", "assemble_form", "submit"},
	"openapi_3_1":        {"assess", "define_operations", "document_contract", "prepare_qualification", "assemble_form", "submit"},
	"complete_candidate": {"assess", "prepare_qualification", "assemble_form", "submit"},
}

var preparationGuideSteps = map[string]map[string]any{
	"assess": {
		"title": "Assess the authorized starting material", "purpose": "Establish what actually exists before describing or adapting it.",
		"actions":             []string{"Inspect only seller-authorized material.", "Identify runnable behavior, inputs, outputs, dependencies and commercial-rights gaps.", "Confirm the selected delivery mode without collecting credential values."},
		"requiredEvidence":    []string{"Authorized source reference", "Observed implementation or service shape", "Seller-controlled delivery target"},
		"completionChecklist": []string{"The starting point is accurate.", "No capability, schema or result has been invented.", "Any rights or access uncertainty is reported to the seller."},
		"blockingConditions":  []string{"No authorized source is available.", "The seller cannot establish a runnable implementation path."},
	},
	"make_runnable": {
		"title": "Establish a runnable HTTP boundary", "purpose": "Create a real API boundary before preparing Exora contracts.",
		"actions":             []string{"For description-only material, build a runnable implementation before continuing.", "For code, functions, scripts or CLIs, create an isolated HTTP Adapter without modifying the seller source.", "Add a bounded health route and use an executable plus structured arguments, never a shell command string.", "Obtain owner approval before executing local code."},
		"requiredEvidence":    []string{"Runnable implementation or isolated Adapter", "Health behavior", "Documented executable and structured arguments when local"},
		"completionChecklist": []string{"The HTTP boundary is runnable.", "Source files remain unchanged.", "No secret is embedded in generated output."},
		"blockingConditions":  []string{"Only a description exists and no implementation was built.", "Execution is required but owner approval is absent."},
	},
	"define_operations": {
		"title": "Define buyer-valued Operations", "purpose": "Make each row independently understandable, reviewable, testable, billable and invocable.",
		"actions":             []string{"Create one Operation for each buyer-valued business function.", "Exclude health, authentication, Job polling, cancellation, Artifact transport, callbacks and administration routes.", "Choose exactly one interaction mode: request_response, server_stream or async_job.", "Declare side effects, idempotency, limits and observable metering capabilities."},
		"requiredEvidence":    []string{"Stable operationId for every business function", "Buyer-facing description and use cases", "Behavior and interaction declarations"},
		"completionChecklist": []string{"Every Operation is a complete paid-call unit.", "Job lifecycle support is not modeled or priced as another Operation.", "Each Operation maps to one real method and path."},
		"blockingConditions":  []string{"A proposed Operation is only infrastructure or lifecycle support.", "Actual behavior cannot be verified."},
	},
	"document_contract": {
		"title": "Document the OpenAPI and usage contract", "purpose": "Make the human-facing Operation and machine-facing OpenAPI describe the same callable behavior.",
		"actions":             []string{"Produce OpenAPI 3.1 for the shared API.", "Align operationId, method, path, request and response schemas with every Operation.", "Add instructions, at least one verified success example and one structured error per Operation.", "For streams define event and termination behavior; for async jobs define duration, progress, cancellation and terminal states; declare Artifact use when needed."},
		"requiredEvidence":    []string{"OpenAPI 3.1 document", "Verified success example per Operation", "Declared error contract per Operation"},
		"completionChecklist": []string{"Examples conform to the declared schemas.", "OpenAPI contains every Operation and no unsupported sellable route.", "Conditional stream, Job and Artifact fields are complete."},
		"blockingConditions":  []string{"Examples are fabricated or unverified.", "OpenAPI and observed behavior disagree."},
	},
	"prepare_qualification": {
		"title": "Prepare safe qualification declarations", "purpose": "Give Dock enough truthful test declarations to qualify each enabled Operation.",
		"actions":             []string{"Declare health and a safe smoke test for every Operation.", "Declare response-contract, timeout and termination expectations.", "For side effects, provide dry-run, sandbox, test account or rollback fixture.", "For streams cover event schema, heartbeat, termination and mid-stream failure; for async jobs cover queued, running, terminal, progress, cancellation, retry and Artifact hash."},
		"requiredEvidence":    []string{"Safe test path per Operation", "Expected success and failure assertions", "Side-effect fixture when applicable"},
		"completionChecklist": []string{"Tests are safe to run with owner approval.", "Metering can be observed for every priced dimension.", "No Qualification result is claimed before Dock runs it."},
		"blockingConditions":  []string{"A side-effecting Operation has no safe test mode.", "Required runtime or test account is unavailable."},
	},
	"assemble_form": {
		"title": "Assemble the single API Contract", "purpose": "Create the only seller-authored source file used by both automatic validations.",
		"actions":             []string{"Assemble one UID-free exora.api-contract.v1 object containing one complete exora.api.v3 capability projection and one billing rule per Operation. Dock injects the selected Draft UID during submission.", "Prepare at least one safe success fixture per Operation and required error, stream, async or artifact fixtures. Fixtures select status, media type and an OpenAPI response reference; they never assert dynamic business values.", "Declare only real trusted metering dimensions with source, unit, evidence pointer and maximum per invocation. Do not invent a request meter for fixed pricing.", "Encode the seller-provided pricing intent with exora.price-formula.v4 and an explicit invocation maximum; never invent or recommend rates.", "Remove credentials, tokens, authorization headers, private keys, owner confirmation and publication state."},
		"requiredEvidence":    []string{"Complete exora.api-contract.v1 file", "Complete capability and OpenAPI parameter semantics", "At least one safe repeatable success fixture per Operation", "One explicit billing rule per Operation", "No dynamic business-value oracle", "No unresolved fields", "No secret-shaped values"},
		"completionChecklist": []string{"Every required source-contract field is present.", "All evidence comes from the seller implementation.", "Every price value reflects explicit seller intent and remains unconfirmed."},
		"blockingConditions":  []string{"Any required field remains unresolved.", "The form contains secrets or invented evidence."},
	},
	"submit": {
		"title": "Submit the complete contract", "purpose": "Store one source file against the existing stable API UID.",
		"actions":             []string{"Call exora.submit_api_contract with the complete contract, current apiId/version and a stable idempotency key.", "If rejected, use operationId, fieldPath and errorCode to correct and resubmit the entire file.", "After acceptance, call exora.get_api_validation and stop for the seller to run Contract validation."},
		"requiredEvidence":    []string{"Complete exora.api-contract.v1 file", "Existing stable apiId and current version", "Stable retry-safe idempotency key"},
		"completionChecklist": []string{"Dock accepted the complete source contract.", "Current validation state was read.", "No test, owner confirmation or publication action was performed by the Agent."},
		"blockingConditions":  []string{"Dock reports any validation issue.", "Submission would include credentials or owner-only state."},
	},
	"pricing": {
		"title": "Encode seller-directed billing", "purpose": "Explain the billing language and encode only pricing intent explicitly supplied by the seller.",
		"actions":             []string{"Enter this step only when the seller explicitly asks for help understanding pricing.", "Explain chargeFormula, maximumChargePerInvocationAtomic and the Cloud-owned delivered variable.", "Describe how settlement V4 treats success, cancellation and faults.", "The Agent may encode values explicitly supplied by the seller into the source contract, but must not choose rates, run validation or confirm the contract."},
		"requiredEvidence":    []string{"Seller request or explicit pricing intent", "Declared metering dimensions and bounds", "Explicit maximum and formula inputs when encoding"},
		"completionChecklist": []string{"The seller understands every field and settlement consequence.", "No rate was invented or recommended by the Agent.", "The owner must run both validations and confirm the contract in Dock."},
		"blockingConditions":  []string{"The seller has not supplied required pricing intent.", "The proposed formula references an undeclared meter.", "The request asks the Agent to run validation or confirm the contract."},
	},
}

func apiPreparationGuide(args map[string]any) (map[string]any, error) {
	startingPoint := strings.TrimSpace(firstString(args, "startingPoint"))
	deliveryMode := strings.TrimSpace(firstString(args, "deliveryMode"))
	step := strings.TrimSpace(firstString(args, "step"))
	if step == "" {
		step = "assess"
	}
	route, ok := preparationGuideRoutes[startingPoint]
	if !ok {
		return nil, fmt.Errorf("startingPoint must be one of description_only, code_or_cli, undocumented_http, partial_contract, openapi_3_1, complete_candidate")
	}
	if deliveryMode != "local_dock" && deliveryMode != "cloud_direct" {
		return nil, fmt.Errorf("deliveryMode must be local_dock or cloud_direct")
	}
	current, ok := preparationGuideSteps[step]
	if !ok {
		return nil, fmt.Errorf("unknown preparation step %q", step)
	}
	if step != "pricing" && !containsGuideStep(route, step) {
		return nil, fmt.Errorf("step %q is not part of the %s route", step, startingPoint)
	}
	nextStep := ""
	if step == "submit" {
		nextStep = "pricing (only when the seller explicitly requests pricing help)"
	} else if step != "pricing" {
		for index, candidate := range route {
			if candidate == step && index+1 < len(route) {
				nextStep = route[index+1]
				break
			}
		}
	}
	stepCopy := map[string]any{}
	for key, value := range current {
		stepCopy[key] = value
	}
	stepCopy["id"] = step
	stepCopy["deliveryRequirements"] = deliveryGuideRequirements(deliveryMode)
	stepCopy["relevantTools"] = preparationGuideTools(step)
	return map[string]any{
		"guideVersion": "exora.api-preparation-guide.v3", "stateful": false, "authoritativeValidation": false,
		"startingPoint": startingPoint, "deliveryMode": deliveryMode, "route": route, "currentStep": stepCopy, "nextStep": nextStep,
		"schemaVersions": map[string]string{"contract": "exora.api-contract.v1", "api": "exora.api.v3", "operation": "exora.operation.v3", "pricing": "exora.operation-pricing.v4"},
		"contractRefs":   []string{"contracts/exora.api-contract.v1.schema.json", "contracts/exora.api.v3.schema.json", "contracts/exora.operation.v3.schema.json", "contracts/exora.operation-validation-plan.v3.schema.json", "contracts/exora.operation-validation-receipt.v3.schema.json", "contracts/exora.operation-pricing.v4.schema.json", "contracts/exora.price-formula.v4.conformance.json", "contracts/exora.operation-billing-plan.v4.schema.json", "contracts/exora.operation-billing-receipt.v4.schema.json", "contracts/exora.operation-settlement.v4.schema.json"},
		"ownerOnly":      []string{"run integration and billing validation", "confirm the tested contract", "approve Runtime execution", "provide credential values", "declare commercial rights", "publish or change lifecycle"},
	}, nil
}

func containsGuideStep(route []string, step string) bool {
	for _, candidate := range route {
		if candidate == step {
			return true
		}
	}
	return false
}

func deliveryGuideRequirements(deliveryMode string) []string {
	if deliveryMode == "local_dock" {
		return []string{"Declare an approved executable and structured args.", "Declare local health behavior and owner-approved startup.", "Prepare Tunnel round-trip, timeout and process-termination checks."}
	}
	return []string{"Use a public HTTPS Runtime with bounded DNS and redirect behavior.", "Declare health and an authentication alias without credential values.", "Prepare authentication, response-contract and timeout checks."}
}

func preparationGuideTools(step string) []string {
	switch step {
	case "submit":
		return []string{"exora.submit_api_contract", "exora.get_api_validation"}
	case "pricing":
		return []string{"exora.get_api_draft"}
	default:
		return []string{"exora.get_api_preparation_guide"}
	}
}

func firstNumber(args map[string]any, name string) float64 {
	switch value := args[name].(type) {
	case float64:
		return value
	case int:
		return float64(value)
	case int64:
		return float64(value)
	}
	return 0
}
