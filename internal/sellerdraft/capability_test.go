package sellerdraft

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/cloudlink"
)

func cloudDraftSyncHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v4/provider/billing-sandbox/runs" {
			var payload struct {
				Plan          map[string]any `json:"plan"`
				Pricing       map[string]any `json:"pricing"`
				DockPreflight map[string]any `json:"dockPreflight"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			receipt := map[string]any{"schemaVersion": billingReceiptVersion, "receiptId": "bill_cloud_test", "apiId": payload.Plan["apiId"], "operationId": payload.Plan["operationId"], "operationSha256": payload.Plan["operationSha256"], "validationReceiptSha256": payload.Plan["validationReceiptSha256"], "pricingSha256": payload.Plan["pricingSha256"], "formulaAstSha256": payload.Plan["formulaAstSha256"], "planSha256": payload.Plan["planSha256"], "passed": true, "sandbox": true, "scenarios": payload.DockPreflight["scenarios"], "testedAt": time.Now().UTC().Format(time.RFC3339Nano)}
			public, private, _ := ed25519.GenerateKey(rand.Reader)
			raw, _ := json.Marshal(receipt)
			receipt["signature"] = map[string]any{"algorithm": "Ed25519", "keyId": "test-cloud", "publicKey": base64.StdEncoding.EncodeToString(public), "value": base64.StdEncoding.EncodeToString(ed25519.Sign(private, raw))}
			write := json.NewEncoder(w).Encode
			w.Header().Set("Content-Type", "application/json")
			_ = write(map[string]any{"receipt": receipt})
			return
		}
		if r.URL.Path == "/v4/provider/api-drafts" || strings.HasPrefix(r.URL.Path, "/v4/provider/api-drafts/") {
			w.Header().Set("Content-Type", "application/json")
			if r.Method == http.MethodDelete {
				_, _ = w.Write([]byte(`{"deleted":true}`))
				return
			}
			var payload struct {
				APIDraft APIDraft `json:"apiDraft"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"apiDraft": map[string]any{"apiId": payload.APIDraft.APIID, "version": payload.APIDraft.Version}})
			return
		}
		if next != nil {
			next.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	})
}

func cloudBackedTestService(t *testing.T, cloudHandler http.Handler) *Service {
	t.Helper()
	value, err := cache.New(100, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = value.Close() })
	server := httptest.NewServer(cloudHandler)
	t.Cleanup(server.Close)
	tokenPath := filepath.Join(t.TempDir(), "cloud-token.json")
	if err := cloudlink.SaveToken(tokenPath, cloudlink.TokenFile{CloudURL: server.URL, CloudToken: "test-token"}); err != nil {
		t.Fatal(err)
	}
	return NewService(ServiceOptions{Store: NewStore(value, "test-account"), Vault: NewCredentialVault(t.TempDir(), "test-account"), CloudURL: server.URL, CloudTokenPath: tokenPath, HTTPClient: server.Client()})
}

func capabilityTestService(t *testing.T) *Service {
	return cloudBackedTestService(t, cloudDraftSyncHandler(nil))
}

func TestDraftIdentityCanBeEditedBeforeCapabilityIsComplete(t *testing.T) {
	service := capabilityTestService(t)
	draft, err := service.CreateAPIDraft(CreateAPIDraftInput{DeliveryMode: "local_dock", Source: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	if draft.Icon != "code" {
		t.Fatalf("unexpected default icon: %q", draft.Icon)
	}
	updated, err := service.UpdateDraftIdentityContext(t.Context(), draft.APIID, UpdateDraftIdentityInput{
		ExpectedVersion: draft.Version,
		DisplayName:     "Research Opera",
		Icon:            "sparkles",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.DisplayName != "Research Opera" || updated.Icon != "sparkles" || updated.Version != draft.Version+1 {
		t.Fatalf("unexpected updated identity: %#v", updated)
	}
	stored, ok := service.GetAPIDraft(draft.APIID)
	if !ok || stored.DisplayName != updated.DisplayName || stored.Icon != updated.Icon {
		t.Fatalf("identity was not persisted: %#v", stored)
	}
	if _, err := service.UpdateDraftIdentityContext(t.Context(), draft.APIID, UpdateDraftIdentityInput{ExpectedVersion: updated.Version, DisplayName: "Research Opera", Icon: "arbitrary-svg"}); err == nil {
		t.Fatal("unsupported icon was accepted")
	}
}

func TestAgentDraftCreationIsRetrySafe(t *testing.T) {
	service := capabilityTestService(t)
	input := CreateAPIDraftInput{DeliveryMode: "local_dock", DisplayName: "Random Three-Card Tarot API", IdempotencyKey: "agent-create-tarot", Source: "agent"}
	first, err := service.CreateAPIDraftContext(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := service.CreateAPIDraftContext(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	if retry.APIID != first.APIID || retry.Version != first.Version || retry.DisplayName != input.DisplayName {
		t.Fatalf("retry created a different Draft: first=%#v retry=%#v", first, retry)
	}
	conflict := input
	conflict.DeliveryMode = "cloud_direct"
	if _, err := service.CreateAPIDraftContext(t.Context(), conflict); err == nil || !strings.Contains(err.Error(), "different draft inputs") {
		t.Fatalf("idempotency conflict was not rejected: %v", err)
	}
}

func TestCloudDraftIsRecreatedFromAuthoritativeDockSnapshot(t *testing.T) {
	posts, puts, forgetNextPut := 0, 0, false
	cloud := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v4/provider/api-drafts" && !strings.HasPrefix(r.URL.Path, "/v4/provider/api-drafts/") {
			http.NotFound(w, r)
			return
		}
		var payload struct {
			APIDraft APIDraft `json:"apiDraft"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPut {
			puts++
			if forgetNextPut {
				forgetNextPut = false
				w.WriteHeader(http.StatusNotFound)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": "API draft not found", "errorCode": "api_draft_not_found"})
				return
			}
		}
		if r.Method == http.MethodPost {
			posts++
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"apiDraft": map[string]any{"apiId": payload.APIDraft.APIID, "version": payload.APIDraft.Version}})
	})
	service := cloudBackedTestService(t, cloud)
	empty, err := service.CreateAPIDraft(CreateAPIDraftInput{DeliveryMode: "local_dock", Source: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	forgetNextPut = true
	updated, err := service.SubmitAPICapability(SubmitCapabilityInput{APIID: empty.APIID, ExpectedVersion: empty.Version, Capability: validCapability(), IdempotencyKey: "recreate-cloud-draft"})
	if err != nil {
		t.Fatalf("Dock did not recreate missing Cloud draft metadata: %v", err)
	}
	if updated.APIID != empty.APIID || updated.Version != empty.Version+1 || posts != 2 || puts != 1 {
		t.Fatalf("unexpected Cloud recreation result: api=%s version=%d posts=%d puts=%d", updated.APIID, updated.Version, posts, puts)
	}
}

func TestCloudDraftSingleVersionPublishGapIsRepaired(t *testing.T) {
	remoteVersion, conflicts := int64(0), 0
	service := cloudBackedTestService(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var payload struct {
			APIDraft        APIDraft `json:"apiDraft"`
			ExpectedVersion int64    `json:"expectedVersion"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if r.Method == http.MethodPost {
			remoteVersion = payload.APIDraft.Version
			_ = json.NewEncoder(w).Encode(map[string]any{"apiDraft": map[string]any{"apiId": payload.APIDraft.APIID, "version": remoteVersion}})
			return
		}
		if payload.ExpectedVersion != remoteVersion {
			conflicts++
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "API draft version conflict", "errorCode": "api_draft_version_conflict"})
			return
		}
		remoteVersion = payload.APIDraft.Version
		_ = json.NewEncoder(w).Encode(map[string]any{"apiDraft": map[string]any{"apiId": payload.APIDraft.APIID, "version": remoteVersion}})
	}))
	draft, err := service.CreateAPIDraftContext(t.Context(), CreateAPIDraftInput{DeliveryMode: "local_dock", Source: "version-gap-test"})
	if err != nil {
		t.Fatal(err)
	}
	draft, err = service.UpdateDraftIdentityContext(t.Context(), draft.APIID, UpdateDraftIdentityInput{ExpectedVersion: draft.Version, DisplayName: "Before publish", Icon: "code"})
	if err != nil {
		t.Fatal(err)
	}
	remoteVersion = draft.Version - 1
	draft, err = service.UpdateDraftIdentityContext(t.Context(), draft.APIID, UpdateDraftIdentityInput{ExpectedVersion: draft.Version, DisplayName: "After publish", Icon: "code"})
	if err != nil {
		t.Fatal(err)
	}
	if conflicts != 1 || remoteVersion != draft.Version || draft.DisplayName != "After publish" {
		t.Fatalf("publish version gap was not repaired: conflicts=%d remote=%d draft=%#v", conflicts, remoteVersion, draft)
	}
}

func validCapability() map[string]any {
	return map[string]any{
		"schemaVersion": APISchemaVersion, "title": "Document API", "description": "Converts a document.", "deliveryMode": "local_dock",
		"interface": map[string]any{"openapi": "3.1.0", "info": map[string]any{"title": "Document API", "version": "1.0.0"}, "paths": map[string]any{"/convert": map[string]any{"post": map[string]any{"operationId": "convert_document", "requestBody": map[string]any{"content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"type": "object", "required": []any{"url"}, "properties": map[string]any{"url": map[string]any{"type": "string"}}}}}}, "responses": map[string]any{"200": map[string]any{"description": "Converted", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"type": "object", "required": []any{"text"}, "properties": map[string]any{"text": map[string]any{"type": "string"}}}}}}}}}}},
		"runtime":   map[string]any{"publicBaseUrl": "http://127.0.0.1:1", "healthPath": "/health"},
		"operations": []any{map[string]any{
			"schemaVersion": OperationSchemaVersion, "operationId": "convert_document", "title": "Convert document", "description": "Converts one document.",
			"usage":       map[string]any{"useCases": []any{"Extract text"}, "instructions": []any{"Send a URL"}},
			"api":         map[string]any{"method": "POST", "path": "/convert", "openapiOperationRef": "#/paths/~1convert/post", "errors": []any{}},
			"behavior":    map[string]any{"sideEffect": map[string]any{"present": false, "description": "No external changes", "reversible": false, "testMode": "none"}, "idempotency": map[string]any{"supported": true, "retentionSeconds": 86400}},
			"interaction": map[string]any{"mode": "request_response"}, "limits": map[string]any{"timeoutSeconds": 30, "maximumRequestBytes": 1048576, "maximumResponseBytes": 1048576, "maximumConcurrency": 4},
			"metering":      map[string]any{"capabilities": []any{map[string]any{"dimension": "request", "unit": "request", "description": "Completed requests", "source": "cloud", "maximumPerInvocation": 1}}},
			"qualification": map[string]any{"fixtures": []any{map[string]any{"id": "success", "kind": "success", "request": map[string]any{"body": map[string]any{"url": "https://example.test/a.pdf"}}, "safeToRepeat": true, "expectedProtocol": map[string]any{"status": 200, "mediaType": "application/json", "openapiResponseRef": "#/paths/~1convert/post/responses/200"}}}},
		}},
	}
}

func manualPricing(draft APIDraft, review OperationReview, chargeFormula string) map[string]any {
	return map[string]any{"schemaVersion": "exora.operation-pricing.v4", "apiId": draft.APIID, "operationId": review.OperationID, "operationSha256": review.OperationHash, "currency": "USDC", "chargeFormula": map[string]any{"language": priceFormulaLanguage, "expression": chargeFormula}, "maximumChargePerInvocationAtomic": 250000, "settlementPolicy": settlementPolicyV4, "reviewStatus": "edited"}
}

func connectAndLock(t *testing.T, service *Service, draft APIDraft) APIDraft {
	t.Helper()
	review := draft.Operations["convert_document"]
	connected, err := service.RecordConnectivityReceipt(draft.APIID, review.OperationID, ConnectivityReceiptInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, RuntimeHash: strings.Repeat("a", 64), ReceiptID: "connect_test", Passed: true, VerifiedDimensions: []string{"request"}, DimensionUnits: map[string]string{"request": "request"}, SampleUsage: map[string]int64{"request": 1}})
	if err != nil {
		t.Fatal(err)
	}
	review = connected.Operations[review.OperationID]
	locked, err := service.LockIntegration(connected.APIID, review.OperationID, OwnerOperationReviewInput{ExpectedVersion: connected.Version, OperationHash: review.OperationHash})
	if err != nil {
		t.Fatal(err)
	}
	return locked
}

func priceTestAndLock(t *testing.T, service *Service, draft APIDraft, expression string) APIDraft {
	t.Helper()
	review := draft.Operations["convert_document"]
	pricing := manualPricing(draft, review, expression)
	tested, err := service.RunBillingTest(draft.APIID, review.OperationID, PricingDraftInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, Pricing: pricing, IdempotencyKey: "billing:" + draft.APIID})
	if err != nil {
		t.Fatal(err)
	}
	review = tested.Operations[review.OperationID]
	locked, err := service.LockPricing(tested.APIID, review.OperationID, OwnerOperationReviewInput{ExpectedVersion: tested.Version, OperationHash: review.OperationHash})
	if err != nil {
		t.Fatal(err)
	}
	return locked
}

func TestStableUIDAndV4Workflow(t *testing.T) {
	service := capabilityTestService(t)
	empty, err := service.CreateAPIDraft(CreateAPIDraftInput{DeliveryMode: "local_dock", Source: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{APIID: empty.APIID, ExpectedVersion: empty.Version, Capability: validCapability(), IdempotencyKey: "same-uid"})
	if err != nil {
		t.Fatal(err)
	}
	if draft.APIID != empty.APIID || draft.Operations["convert_document"].IntegrationStatus != "editable" {
		t.Fatalf("unexpected draft: %#v", draft)
	}
	draft = connectAndLock(t, service, draft)
	if draft.Operations["convert_document"].IntegrationStatus != "locked" || draft.Operations["convert_document"].PricingStatus != "editable" {
		t.Fatalf("integration did not lock: %#v", draft.Operations["convert_document"])
	}
	draft = priceTestAndLock(t, service, draft, "0")
	if draft.Operations["convert_document"].PricingStatus != "locked" || draft.Operations["convert_document"].PricingBillingReceipt["passed"] != true {
		t.Fatalf("pricing did not lock: %#v", draft.Operations["convert_document"])
	}
}

func TestFirstAPIContractDoesNotReplaceLegacyLockedIntegration(t *testing.T) {
	service := capabilityTestService(t)
	empty, err := service.CreateAPIDraft(CreateAPIDraftInput{DeliveryMode: "local_dock", Source: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	capability := validCapability()
	legacy, err := service.SubmitAPICapability(SubmitCapabilityInput{APIID: empty.APIID, ExpectedVersion: empty.Version, Capability: capability, IdempotencyKey: "legacy-capability"})
	if err != nil {
		t.Fatal(err)
	}
	legacy = connectAndLock(t, service, legacy)
	if legacy.ContractPackageHash != "" || len(legacy.ContractPackage) != 0 {
		t.Fatalf("legacy draft unexpectedly contained an API contract: %#v", legacy)
	}
	contract := map[string]any{
		"schemaVersion": APIContractSchemaVersion,
		"apiId":         legacy.APIID,
		"capability":    capability,
		"billing": []any{map[string]any{
			"operationId": "convert_document", "currency": "USDC",
			"chargeFormula":                    map[string]any{"language": priceFormulaLanguage, "expression": "request * 0.01"},
			"maximumChargePerInvocationAtomic": 250000,
			"settlementPolicy":                 settlementPolicyV4,
		}},
	}
	submitted, err := service.SubmitAPIContractContext(t.Context(), legacy.APIID, SubmitAPIContractInput{ExpectedVersion: legacy.Version, Contract: contract, IdempotencyKey: "first-api-contract"})
	if err != nil {
		t.Fatalf("first API contract was incorrectly treated as a replacement: %v", err)
	}
	if submitted.ContractPackageHash == "" || len(submitted.ContractPackage) == 0 {
		t.Fatalf("first API contract was not stored: %#v", submitted)
	}
	locked := connectAndLock(t, service, submitted)
	replacement, err := cloneCapability(contract)
	if err != nil {
		t.Fatal(err)
	}
	mapValue(replacement["capability"])["description"] = "Replacement contract"
	_, err = service.SubmitAPIContractContext(t.Context(), locked.APIID, SubmitAPIContractInput{ExpectedVersion: locked.Version, Contract: replacement, IdempotencyKey: "replacement-without-confirmation"})
	if err == nil || !strings.Contains(err.Error(), "replaceLockedContract is required") {
		t.Fatalf("an existing locked API contract lost its replacement guard: %v", err)
	}
}

func TestSingleAPIContractRunsBothValidationsBeforeOneOwnerConfirmation(t *testing.T) {
	runtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/health" {
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		if r.URL.Path == "/convert" {
			_, _ = w.Write([]byte(`{"text":"converted"}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer runtime.Close()

	service := capabilityTestService(t)
	empty, err := service.CreateAPIDraft(CreateAPIDraftInput{DeliveryMode: "local_dock", Source: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	capability := validCapability()
	mapValue(capability["runtime"])["publicBaseUrl"] = runtime.URL
	operation := operationFromCapability(capability, "convert_document")
	mapValue(operation["metering"])["capabilities"] = []any{}
	contract := map[string]any{
		"schemaVersion": APIContractSchemaVersion,
		"capability":    capability,
		"billing": []any{map[string]any{
			"operationId": "convert_document", "currency": "USDC",
			"chargeFormula":                    map[string]any{"language": priceFormulaLanguage, "expression": "delivered * 0.01"},
			"maximumChargePerInvocationAtomic": 250000,
			"settlementPolicy":                 settlementPolicyV4,
		}},
	}
	submitted, err := service.SubmitAPIContractContext(t.Context(), empty.APIID, SubmitAPIContractInput{ExpectedVersion: empty.Version, Contract: contract, IdempotencyKey: "contract-submit"})
	if err != nil {
		t.Fatal(err)
	}
	if submitted.APIID != empty.APIID || submitted.ContractPackageHash == "" || capabilityString(submitted.ContractPackage["apiId"]) != empty.APIID || capabilityString(submitted.Capability["apiId"]) != empty.APIID {
		t.Fatalf("contract did not preserve the stable UID: %#v", submitted)
	}
	tested, err := service.RunContractValidation(t.Context(), submitted.APIID, "convert_document", ContractValidationInput{ExpectedVersion: submitted.Version, IdempotencyKey: "contract-test"})
	if err != nil {
		t.Fatal(err)
	}
	review := tested.Operations["convert_document"]
	if review.IntegrationStatus != "locked" || review.CapabilityReview != "pending" || review.PricingStatus != "awaiting_confirmation" || review.ConnectivityReceipt["passed"] != true || review.PricingBillingReceipt["passed"] != true {
		t.Fatalf("combined validation did not stop at one owner gate: %#v", review)
	}
	confirmed, err := service.ConfirmContract(tested.APIID, review.OperationID, OwnerOperationReviewInput{ExpectedVersion: tested.Version, OperationHash: review.OperationHash})
	if err != nil {
		t.Fatal(err)
	}
	review = confirmed.Operations["convert_document"]
	if review.CapabilityReview != "confirmed" || review.PricingReview != "confirmed" || review.IntegrationStatus != "locked" || review.PricingStatus != "locked" {
		t.Fatalf("one confirmation did not lock both projections: %#v", review)
	}
}

func TestClearAPIContractPreservesDraftUIDAndGuardsEvidence(t *testing.T) {
	service := capabilityTestService(t)
	empty, err := service.CreateAPIDraft(CreateAPIDraftInput{DeliveryMode: "local_dock", Source: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	capability := validCapability()
	capability["apiId"] = empty.APIID
	contract := map[string]any{
		"schemaVersion": APIContractSchemaVersion,
		"apiId":         empty.APIID,
		"capability":    capability,
		"billing": []any{map[string]any{
			"operationId":                      "convert_document",
			"currency":                         "USDC",
			"chargeFormula":                    map[string]any{"language": priceFormulaLanguage, "expression": "request * 0.01"},
			"maximumChargePerInvocationAtomic": 250000,
			"settlementPolicy":                 settlementPolicyV4,
		}},
	}
	submitted, err := service.SubmitAPIContractContext(t.Context(), empty.APIID, SubmitAPIContractInput{ExpectedVersion: empty.Version, Contract: contract, IdempotencyKey: "clear-contract-submit"})
	if err != nil {
		t.Fatal(err)
	}
	withEvidence := connectAndLock(t, service, submitted)
	if _, err := service.ClearAPIContractContext(t.Context(), withEvidence.APIID, ClearAPIContractInput{ExpectedVersion: withEvidence.Version}); err == nil || !strings.Contains(err.Error(), "invalidateEvidence") {
		t.Fatalf("tested contract was cleared without an explicit evidence invalidation: %v", err)
	}
	cleared, err := service.ClearAPIContractContext(t.Context(), withEvidence.APIID, ClearAPIContractInput{ExpectedVersion: withEvidence.Version, InvalidateEvidence: true})
	if err != nil {
		t.Fatal(err)
	}
	if cleared.APIID != empty.APIID || cleared.Status != "local_draft" || len(cleared.ContractPackage) != 0 || cleared.ContractPackageHash != "" || len(cleared.Operations) != 0 || capabilityString(cleared.Capability["deliveryMode"]) != "local_dock" {
		t.Fatalf("clearing the contract did not restore the stable empty Draft: %#v", cleared)
	}
}

func TestCapabilityAllowsConstantPricingWithoutSyntheticRequestMeter(t *testing.T) {
	capability := validCapability()
	operation := operationFromCapability(capability, "convert_document")
	mapValue(operation["metering"])["capabilities"] = []any{}
	validation := validateCapability(capability)
	if validation.Status != "passed" {
		t.Fatalf("meterless capability should support constant or delivered-only pricing: %#v", validation.Issues)
	}
}

func TestValidationPlanIncludesOnlyApplicableFaultChecks(t *testing.T) {
	capability := validCapability()
	operation := operationFromCapability(capability, "convert_document")
	plan, err := compileValidationPlan("api_test", capability, operation, strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	hasCheck := func(candidate map[string]any, id string) bool {
		for _, raw := range sliceValue(candidate["checks"]) {
			if capabilityString(mapValue(raw)["id"]) == id {
				return true
			}
		}
		return false
	}
	for _, id := range []string{"platform_fault:connection_failure", "platform_fault:timeout", "platform_fault:invalid_schema"} {
		if !hasCheck(plan, id) {
			t.Fatalf("missing universal fault check %s", id)
		}
	}
	for _, id := range []string{"platform_fault:stream_interruption", "platform_fault:artifact_corruption"} {
		if hasCheck(plan, id) {
			t.Fatalf("request-response Operation received inapplicable check %s", id)
		}
	}
	mapValue(operation["interaction"])["mode"] = "server_stream"
	operation["artifacts"] = map[string]any{"outputs": []any{map[string]any{"name": "result", "artifactField": "/artifact"}}}
	conditional, err := compileValidationPlan("api_test", capability, operation, strings.Repeat("b", 64))
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"platform_fault:stream_interruption", "platform_fault:artifact_corruption"} {
		if !hasCheck(conditional, id) {
			t.Fatalf("missing applicable fault check %s", id)
		}
	}
}

func TestPricingIsOwnerOnlyAndRequiresIntegrationLock(t *testing.T) {
	service := capabilityTestService(t)
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "manual-price"})
	if err != nil {
		t.Fatal(err)
	}
	review := draft.Operations["convert_document"]
	if _, err := service.RunBillingTest(draft.APIID, review.OperationID, PricingDraftInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, Pricing: manualPricing(draft, review, "0"), IdempotencyKey: "before-lock"}); err == nil {
		t.Fatal("pricing was accepted before integration lock")
	}
}

func TestValidationAcceptsDynamicValuesButRejectsWrongResponseFormat(t *testing.T) {
	for _, test := range []struct {
		name       string
		response   string
		wantPassed bool
	}{{name: "dynamic string", response: `{"text":"different dynamic value on every call"}`, wantPassed: true}, {name: "wrong field type", response: `{"text":42}`, wantPassed: false}} {
		t.Run(test.name, func(t *testing.T) {
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/health" {
					w.WriteHeader(http.StatusNoContent)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(test.response))
			}))
			defer provider.Close()
			service := capabilityTestService(t)
			capability := validCapability()
			mapValue(capability["runtime"])["publicBaseUrl"] = provider.URL
			draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: capability, IdempotencyKey: "format-" + strings.ReplaceAll(test.name, " ", "-")})
			if err != nil {
				t.Fatal(err)
			}
			review := draft.Operations["convert_document"]
			validated, runErr := service.RunConnectivityTest(t.Context(), draft.APIID, review.OperationID, draft.Version, review.OperationHash)
			if test.wantPassed {
				if runErr != nil {
					t.Fatal(runErr)
				}
				if validated.Operations[review.OperationID].ConnectivityReceipt["passed"] != true {
					t.Fatal("format-valid dynamic response did not pass")
				}
			} else if runErr == nil {
				t.Fatal("schema-invalid response passed because its business value looked plausible")
			}
		})
	}
}

func TestStrictFormulaRejectsDynamicDivisionAndHiddenNegative(t *testing.T) {
	service := capabilityTestService(t)
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "formula-safety"})
	if err != nil {
		t.Fatal(err)
	}
	draft = connectAndLock(t, service, draft)
	review := draft.Operations["convert_document"]
	for _, expression := range []string{"1 / ((request - 2) * (request - 2))", "request - 2"} {
		pricing := manualPricing(draft, review, expression)
		if _, err := service.RunBillingTest(draft.APIID, review.OperationID, PricingDraftInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, Pricing: pricing, IdempotencyKey: "unsafe:" + expression}); err == nil {
			t.Fatalf("unsafe formula accepted: %s", expression)
		}
	}
}

func TestBillingReceiptRunsSettlementAndPreservesFunds(t *testing.T) {
	service := capabilityTestService(t)
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "billing-ledger"})
	if err != nil {
		t.Fatal(err)
	}
	draft = connectAndLock(t, service, draft)
	review := draft.Operations["convert_document"]
	pricing := manualPricing(draft, review, "request * 0.01 + delivered * 0.02")
	tested, err := service.RunBillingTest(draft.APIID, review.OperationID, PricingDraftInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, Pricing: pricing, IdempotencyKey: "billing-ledger-run"})
	if err != nil {
		t.Fatal(err)
	}
	matched := map[string]bool{}
	for _, raw := range sliceValue(tested.Operations[review.OperationID].PricingBillingReceipt["scenarios"]) {
		scenario := mapValue(raw)
		reserved, _ := pricingInteger(scenario["reservedAtomic"])
		charged, _ := pricingInteger(scenario["chargedAtomic"])
		refunded, _ := pricingInteger(scenario["refundedAtomic"])
		if charged+refunded != reserved {
			t.Fatalf("settlement does not conserve reservation: %#v", scenario)
		}
		if strings.Contains(capabilityString(scenario["outcome"]), "fault") && charged != 0 {
			t.Fatalf("fault was charged: %#v", scenario)
		}
		usage := meteringUsageMap(scenario["actualUsage"])
		delivered, _ := pricingInteger(scenario["delivered"])
		if usage["request"] != 1 {
			continue
		}
		switch capabilityString(scenario["outcome"]) {
		case "success":
			matched["success"] = true
			if charged != 30000 || delivered != 1 {
				t.Fatalf("successful delivery did not include delivered=1: %#v", scenario)
			}
		case "cancel_after_execution":
			matched["cancel_after_execution"] = true
			if charged != 10000 || delivered != 0 {
				t.Fatalf("post-execution cancellation charged delivery: %#v", scenario)
			}
		case "business_error", "cancel_before_execution", "provider_fault", "cloud_fault", "timeout_fault", "schema_fault", "artifact_fault", "forced_stop":
			if charged != 0 {
				t.Fatalf("non-billable outcome was charged: %#v", scenario)
			}
		}
	}
	if !matched["success"] || !matched["cancel_after_execution"] {
		t.Fatalf("missing delivered settlement cases: %#v", matched)
	}
}

func TestPricingV4RejectsV3AndReservedDeliveredMetering(t *testing.T) {
	service := capabilityTestService(t)
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "v4-only"})
	if err != nil {
		t.Fatal(err)
	}
	draft = connectAndLock(t, service, draft)
	review := draft.Operations["convert_document"]
	legacy := manualPricing(draft, review, "request * 0.01")
	legacy["schemaVersion"] = "exora.operation-pricing.v3"
	if _, err := service.RunBillingTest(draft.APIID, review.OperationID, PricingDraftInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, Pricing: legacy, IdempotencyKey: "reject-v3"}); err == nil || !strings.Contains(err.Error(), "exora.operation-pricing.v4") {
		t.Fatalf("Pricing V3 was not rejected clearly: %v", err)
	}

	operation, _ := cloneCapability(operationFromCapability(draft.Capability, review.OperationID))
	mapValue(operation["metering"])["capabilities"] = []any{map[string]any{"dimension": "delivered", "unit": "boolean", "source": "cloud", "maximumPerInvocation": 1}}
	receipt, _ := cloneCapability(review.ConnectivityReceipt)
	receipt["verifiedMetering"] = []any{map[string]any{"dimension": "delivered", "unit": "boolean", "source": "cloud", "maximumPerInvocation": 1}}
	pricing := manualPricing(draft, review, "delivered * 0.02")
	if _, err := normalizeOperationPricingV4(draft.APIID, review.OperationID, review.OperationHash, pricing, operation, receipt, "edited"); err == nil || !strings.Contains(err.Error(), "reserved by Exora") {
		t.Fatalf("seller-declared delivered metering was not rejected: %v", err)
	}
}

func TestLockedPricingChangesOnlyWhenNewSnapshotIsTested(t *testing.T) {
	service := capabilityTestService(t)
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "pricing-working-copy"})
	if err != nil {
		t.Fatal(err)
	}
	draft = priceTestAndLock(t, service, connectAndLock(t, service, draft), "request * 0.01")
	locked := draft.Operations["convert_document"]
	if locked.PricingStatus != "locked" || len(locked.Pricing) == 0 || locked.PricingLockedAt == nil {
		t.Fatalf("initial pricing was not locked: %#v", locked)
	}
	retested, err := service.RunBillingTest(draft.APIID, locked.OperationID, PricingDraftInput{ExpectedVersion: draft.Version, OperationHash: locked.OperationHash, Pricing: manualPricing(draft, locked, "request * 0.02 + delivered * 0.01"), IdempotencyKey: "pricing-working-copy-retest"})
	if err != nil {
		t.Fatal(err)
	}
	changed := retested.Operations[locked.OperationID]
	if changed.PricingStatus != "awaiting_confirmation" || changed.PricingReview != "pending" || changed.PricingLockedAt != nil || len(changed.Pricing) != 0 || capabilityString(mapValue(changed.PricingDraft["chargeFormula"])["expression"]) != "request * 0.02 + delivered * 0.01" {
		t.Fatalf("tested pricing snapshot did not replace the lock cleanly: %#v", changed)
	}
}

func TestEditingIntegrationClearsEveryDownstreamArtifact(t *testing.T) {
	service := capabilityTestService(t)
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "reset"})
	if err != nil {
		t.Fatal(err)
	}
	draft = priceTestAndLock(t, service, connectAndLock(t, service, draft), "0")
	lockedReview := draft.Operations["convert_document"]
	draft, err = service.UnlockIntegration(draft.APIID, lockedReview.OperationID, OwnerOperationReviewInput{ExpectedVersion: draft.Version, OperationHash: lockedReview.OperationHash})
	if err != nil {
		t.Fatal(err)
	}
	operation, _ := cloneCapability(operationFromCapability(draft.Capability, "convert_document"))
	operation["description"] = "Changed"
	updated, err := service.UpdateOperation(draft.APIID, "convert_document", UpdateOperationInput{ExpectedVersion: draft.Version, Operation: operation})
	if err != nil {
		t.Fatal(err)
	}
	review := updated.Operations["convert_document"]
	if review.IntegrationStatus != "editable" || review.PricingStatus != "blocked" || len(review.ConnectivityReceipt) != 0 || len(review.Pricing) != 0 || len(review.PricingBillingReceipt) != 0 {
		t.Fatalf("downstream state survived edit: %#v", review)
	}
}

func TestReplacingLockedIntegrationIsAtomic(t *testing.T) {
	service := capabilityTestService(t)
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "atomic-replace"})
	if err != nil {
		t.Fatal(err)
	}
	draft = priceTestAndLock(t, service, connectAndLock(t, service, draft), "0")
	invalid, _ := cloneCapability(draft.Capability)
	delete(invalid, "interface")
	if _, err = service.UpdateCapability(draft.APIID, UpdateCapabilityInput{ExpectedVersion: draft.Version, Capability: invalid, ReplaceLockedIntegration: true}); err == nil {
		t.Fatal("invalid replacement was accepted")
	}
	unchanged, ok := service.GetAPIDraft(draft.APIID)
	if !ok {
		t.Fatal("draft disappeared after rejected replacement")
	}
	unchangedReview := unchanged.Operations["convert_document"]
	if unchanged.Version != draft.Version || unchangedReview.IntegrationStatus != "locked" || unchangedReview.PricingStatus != "locked" {
		t.Fatalf("rejected replacement mutated the submitted version: %#v", unchangedReview)
	}
	replacement, _ := cloneCapability(draft.Capability)
	replacement["description"] = "Changed atomically"
	updated, err := service.UpdateCapability(draft.APIID, UpdateCapabilityInput{ExpectedVersion: draft.Version, Capability: replacement, ReplaceLockedIntegration: true})
	if err != nil {
		t.Fatal(err)
	}
	review := updated.Operations["convert_document"]
	if review.IntegrationStatus != "editable" || review.PricingStatus != "blocked" || len(review.ConnectivityReceipt) != 0 || len(review.Pricing) != 0 || len(review.PricingBillingReceipt) != 0 {
		t.Fatalf("successful replacement retained downstream state: %#v", review)
	}
}

func TestPublishUsesStableUIDAndV3Receipts(t *testing.T) {
	var createdUID string
	configuredConcurrency := 0
	service := cloudBackedTestService(t, cloudDraftSyncHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/v4/provider/apis" {
			var payload map[string]any
			_ = json.NewDecoder(r.Body).Decode(&payload)
			createdUID = capabilityString(payload["apiId"])
			_, _ = w.Write([]byte(`{"api":{"apiId":"` + createdUID + `"}}`))
			return
		}
		if r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/operational-settings") {
			var payload map[string]any
			_ = json.NewDecoder(r.Body).Decode(&payload)
			value, _ := pricingInteger(payload["concurrencyLimit"])
			configuredConcurrency = int(value)
			_, _ = w.Write([]byte(`{"operationalStatus":{"concurrencyLimit":2,"contractMaximumConcurrency":4}}`))
			return
		}
		_, _ = w.Write([]byte(`{}`))
	})))
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "publish"})
	if err != nil {
		t.Fatal(err)
	}
	draft = priceTestAndLock(t, service, connectAndLock(t, service, draft), "0")
	review := draft.Operations["convert_document"]
	draft, err = service.UpdateOperationSettings(t.Context(), draft.APIID, review.OperationID, OperationSettingsInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, ConcurrencyLimit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.UpdateOperationSettings(t.Context(), draft.APIID, review.OperationID, OperationSettingsInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, ConcurrencyLimit: 5}); err == nil {
		t.Fatal("operational concurrency exceeded the contract ceiling")
	}
	published, err := service.PublishAPIDraft(t.Context(), draft.APIID, draft.Version)
	if err != nil {
		t.Fatal(err)
	}
	if createdUID != draft.APIID || configuredConcurrency != 2 || published.APIID != draft.APIID || published.Status != "live" || published.Operations["convert_document"].OperationalState != "live" {
		t.Fatalf("publish drifted: %#v", published)
	}
}

func TestPublishSupportsLegacyCloudWithoutDefaultOperationalSettingsRoute(t *testing.T) {
	service := cloudBackedTestService(t, cloudDraftSyncHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/v4/provider/apis" {
			var payload map[string]any
			_ = json.NewDecoder(r.Body).Decode(&payload)
			_, _ = w.Write([]byte(`{"api":{"apiId":"` + capabilityString(payload["apiId"]) + `"}}`))
			return
		}
		if r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/operational-settings") {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	})))
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "publish-legacy-cloud"})
	if err != nil {
		t.Fatal(err)
	}
	draft = priceTestAndLock(t, service, connectAndLock(t, service, draft), "0")
	published, err := service.PublishAPIDraft(t.Context(), draft.APIID, draft.Version)
	if err != nil {
		t.Fatal(err)
	}
	if published.Status != "live" {
		t.Fatalf("legacy Cloud publish did not complete: %#v", published)
	}
}

func TestRepublishUpdatesExistingCloudAPIWithStableUID(t *testing.T) {
	apiID, createCalls, updateCalls := "", 0, 0
	service := cloudBackedTestService(t, cloudDraftSyncHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/v4/provider/apis" {
			createCalls++
			var payload map[string]any
			_ = json.NewDecoder(r.Body).Decode(&payload)
			if apiID == "" {
				apiID = capabilityString(payload["apiId"])
				_, _ = w.Write([]byte(`{"api":{"apiId":"` + apiID + `"}}`))
				return
			}
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":"apiId conflicts with an existing API","errorCode":"api_id_conflict"}`))
			return
		}
		if r.Method == http.MethodPut && apiID != "" && r.URL.Path == "/v4/provider/apis/"+apiID {
			updateCalls++
			_, _ = w.Write([]byte(`{"api":{"apiId":"` + apiID + `"}}`))
			return
		}
		if r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/operational-settings") {
			_, _ = w.Write([]byte(`{"operationalStatus":{"concurrencyLimit":4,"contractMaximumConcurrency":4}}`))
			return
		}
		_, _ = w.Write([]byte(`{}`))
	})))
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "republish-stable-uid"})
	if err != nil {
		t.Fatal(err)
	}
	draft = priceTestAndLock(t, service, connectAndLock(t, service, draft), "0")
	draft, err = service.PublishAPIDraft(t.Context(), draft.APIID, draft.Version)
	if err != nil {
		t.Fatal(err)
	}
	review := draft.Operations["convert_document"]
	draft, err = service.UpdateOperationLifecycle(draft.APIID, review.OperationID, OperationLifecycleInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, Action: "take_offline"})
	if err != nil {
		t.Fatal(err)
	}
	review = draft.Operations[review.OperationID]
	draft, err = service.UpdateOperationLifecycle(draft.APIID, review.OperationID, OperationLifecycleInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, Action: "complete_draining"})
	if err != nil {
		t.Fatal(err)
	}
	republished, err := service.PublishAPIDraft(t.Context(), draft.APIID, draft.Version)
	if err != nil {
		t.Fatal(err)
	}
	if createCalls != 2 || updateCalls != 1 || republished.APIID != apiID || republished.Status != "live" {
		t.Fatalf("republish did not update the stable Cloud API: creates=%d updates=%d draft=%#v", createCalls, updateCalls, republished)
	}
}

func TestPublishRejectsLegacyCloudWhenCustomOperationalSettingsCannotSync(t *testing.T) {
	service := cloudBackedTestService(t, cloudDraftSyncHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/v4/provider/apis" {
			var payload map[string]any
			_ = json.NewDecoder(r.Body).Decode(&payload)
			_, _ = w.Write([]byte(`{"api":{"apiId":"` + capabilityString(payload["apiId"]) + `"}}`))
			return
		}
		if r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/operational-settings") {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	})))
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "publish-legacy-cloud-custom-limit"})
	if err != nil {
		t.Fatal(err)
	}
	draft = priceTestAndLock(t, service, connectAndLock(t, service, draft), "0")
	review := draft.Operations["convert_document"]
	draft, err = service.UpdateOperationSettings(t.Context(), draft.APIID, review.OperationID, OperationSettingsInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, ConcurrencyLimit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.PublishAPIDraft(t.Context(), draft.APIID, draft.Version); err == nil || !strings.Contains(err.Error(), "operational-settings") {
		t.Fatalf("custom concurrency limit should require Cloud route support, got %v", err)
	}
}

func TestLifecycleAggregatesAPIStateAndProtectsActiveOperations(t *testing.T) {
	pauseCalls := 0
	service := cloudBackedTestService(t, cloudDraftSyncHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/v4/provider/apis" {
			var payload map[string]any
			_ = json.NewDecoder(r.Body).Decode(&payload)
			_, _ = w.Write([]byte(`{"api":{"apiId":"` + capabilityString(payload["apiId"]) + `"}}`))
			return
		}
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/pause") {
			pauseCalls++
			_, _ = w.Write([]byte(`{"api":{"lifecycle":"paused"}}`))
			return
		}
		_, _ = w.Write([]byte(`{}`))
	})))
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "lifecycle"})
	if err != nil {
		t.Fatal(err)
	}
	draft = priceTestAndLock(t, service, connectAndLock(t, service, draft), "0")
	draft, err = service.PublishAPIDraft(t.Context(), draft.APIID, draft.Version)
	if err != nil {
		t.Fatal(err)
	}
	review := draft.Operations["convert_document"]
	if err := service.DeleteAPIDraft(draft.APIID, DeleteAPIDraftInput{ExpectedVersion: draft.Version}); err == nil {
		t.Fatal("live API was deleted")
	}
	draft, err = service.UpdateOperationLifecycle(draft.APIID, review.OperationID, OperationLifecycleInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, Action: "take_offline"})
	if err != nil {
		t.Fatal(err)
	}
	if draft.Status != "draining" || draft.Operations[review.OperationID].OperationalState != "draining" {
		t.Fatalf("API did not enter draining: %#v", draft)
	}
	if err := service.DeleteAPIDraft(draft.APIID, DeleteAPIDraftInput{ExpectedVersion: draft.Version}); err == nil {
		t.Fatal("draining API was deleted")
	}
	review = draft.Operations[review.OperationID]
	draft, err = service.UpdateOperationLifecycle(draft.APIID, review.OperationID, OperationLifecycleInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, Action: "complete_draining"})
	if err != nil {
		t.Fatal(err)
	}
	if draft.Status != "review_required" || draft.Operations[review.OperationID].OperationalState != "offline" {
		t.Fatalf("API did not return offline: %#v", draft)
	}
	draft, err = service.PublishAPIDraft(t.Context(), draft.APIID, draft.Version)
	if err != nil {
		t.Fatal(err)
	}
	review = draft.Operations[review.OperationID]
	draft, err = service.UpdateOperationLifecycle(draft.APIID, review.OperationID, OperationLifecycleInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, Action: "force_stop"})
	if err != nil {
		t.Fatal(err)
	}
	review = draft.Operations[review.OperationID]
	if draft.Status != "review_required" || review.OperationalState != "offline" || review.OperationalMetrics["blocked"] != true || review.OperationalMetrics["sellerLiabilityRecorded"] != true {
		t.Fatalf("force stop did not record protection state: %#v", draft)
	}
	if pauseCalls != 2 {
		t.Fatalf("Cloud pause should be called for graceful and forced live shutdowns, got %d", pauseCalls)
	}
}

func TestLogoutTakesEveryLiveAPIOfflineBeforeDisconnectingDock(t *testing.T) {
	apiID, pauseCalls := "", 0
	service := cloudBackedTestService(t, cloudDraftSyncHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/v4/provider/apis" {
			var payload map[string]any
			_ = json.NewDecoder(r.Body).Decode(&payload)
			apiID = capabilityString(payload["apiId"])
			_, _ = w.Write([]byte(`{"api":{"apiId":"` + apiID + `"}}`))
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/v4/provider/apis" {
			_, _ = w.Write([]byte(`{"apis":[{"apiId":"` + apiID + `","lifecycle":"live"}]}`))
			return
		}
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/pause") {
			pauseCalls++
			_, _ = w.Write([]byte(`{"api":{"lifecycle":"paused"}}`))
			return
		}
		_, _ = w.Write([]byte(`{}`))
	})))
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: validCapability(), IdempotencyKey: "logout-offline"})
	if err != nil {
		t.Fatal(err)
	}
	draft = priceTestAndLock(t, service, connectAndLock(t, service, draft), "0")
	draft, err = service.PublishAPIDraft(t.Context(), draft.APIID, draft.Version)
	if err != nil {
		t.Fatal(err)
	}
	review := draft.Operations["convert_document"]
	review.OperationalMetrics["inFlight"] = 2
	draft.Operations[review.OperationID] = review
	if err := service.store.SaveAPIDraft(draft); err != nil {
		t.Fatal(err)
	}
	values, err := service.OfflineAllForLogout(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(values) != 1 || pauseCalls != 1 {
		t.Fatalf("logout did not pause every active API: pauses=%d values=%#v", pauseCalls, values)
	}
	offline := values[0].Operations[review.OperationID]
	if values[0].Status != "review_required" || offline.OperationalState != "offline" || offline.OperationalMetrics["inFlight"] != 0 || offline.OperationalMetrics["blocked"] != true || offline.OperationalMetrics["sellerLiabilityRecorded"] != true {
		t.Fatalf("logout did not force active fulfillment offline safely: %#v", values[0])
	}
}

func TestLogoutAlsoPausesCloudAPIsWithoutALocalDraft(t *testing.T) {
	pauseCalls := 0
	service := cloudBackedTestService(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet && r.URL.Path == "/v4/provider/apis" {
			_, _ = w.Write([]byte(`{"apis":[{"apiId":"api_cloud_only","lifecycle":"live"}]}`))
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/v4/provider/apis/api_cloud_only/pause" {
			pauseCalls++
			_, _ = w.Write([]byte(`{"api":{"apiId":"api_cloud_only","lifecycle":"paused"}}`))
			return
		}
		http.NotFound(w, r)
	}))
	values, err := service.OfflineAllForLogout(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(values) != 0 || pauseCalls != 1 {
		t.Fatalf("Cloud-only API was not paused during logout: pauses=%d values=%#v", pauseCalls, values)
	}
}

func TestProviderAttestedMeteringRequiresEvidenceAndBoundedReceiptUsage(t *testing.T) {
	service := capabilityTestService(t)
	capability := validCapability()
	operation := mapValue(sliceValue(capability["operations"])[0])
	meter := mapValue(sliceValue(mapValue(operation["metering"])["capabilities"])[0])
	meter["source"] = "provider_attested"
	invalid, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: capability, IdempotencyKey: "metering-no-evidence"})
	if err == nil || invalid.Validation.Status == "passed" {
		t.Fatal("provider-attested metering without evidencePointer passed validation")
	}
	meter["evidencePointer"] = "/response/usage/request"
	draft, err := service.SubmitAPICapability(SubmitCapabilityInput{Capability: capability, IdempotencyKey: "metering-evidence"})
	if err != nil {
		t.Fatal(err)
	}
	review := draft.Operations["convert_document"]
	_, err = service.RecordConnectivityReceipt(draft.APIID, review.OperationID, ConnectivityReceiptInput{ExpectedVersion: draft.Version, OperationHash: review.OperationHash, RuntimeHash: strings.Repeat("b", 64), ReceiptID: "bad_usage", Passed: true, VerifiedDimensions: []string{"request"}, SampleUsage: map[string]int64{"request": 2}})
	if err == nil {
		t.Fatal("out-of-range metering sample was accepted")
	}
}

func TestNewServicePurgesLegacyPricingAndOperationDraftsWithoutMigration(t *testing.T) {
	value, err := cache.New(100, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = value.Close() })
	store := NewStore(value, "test-account")
	legacy := APIDraft{APIID: "api_legacy_test", Version: 1, Status: "local_draft", Capability: map[string]any{"schemaVersion": "exora.api.v1", "operations": []any{map[string]any{"schemaVersion": "exora.operation.v1"}}}}
	if err := store.SaveAPIDraft(legacy); err != nil {
		t.Fatal(err)
	}
	_ = NewService(ServiceOptions{Store: store})
	if _, ok := store.APIDraft(legacy.APIID); ok {
		t.Fatal("legacy API draft survived the V3 no-migration cleanup")
	}
}
