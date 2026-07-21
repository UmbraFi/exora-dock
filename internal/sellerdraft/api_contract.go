package sellerdraft

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// normalizeAPIContractV1 converts the single seller-authored contract into the
// existing independently hashed integration and billing projections. Seller
// fixtures remain part of capability. Billing identifiers, hashes and review
// state are platform-owned and are deliberately absent from the source file.
func normalizeAPIContractV1(apiID string, input map[string]any) (map[string]any, map[string]any, map[string]map[string]any, APIValidation, error) {
	contract, err := cloneCapability(input)
	if err != nil {
		return nil, nil, nil, APIValidation{}, err
	}
	allowedTop := map[string]bool{"schemaVersion": true, "apiId": true, "capability": true, "billing": true}
	for key := range contract {
		if !allowedTop[key] {
			return nil, nil, nil, APIValidation{}, fmt.Errorf("contract field %s is not allowed", key)
		}
	}
	if capabilityString(contract["schemaVersion"]) != APIContractSchemaVersion {
		return nil, nil, nil, APIValidation{}, fmt.Errorf("contract schemaVersion must be %s", APIContractSchemaVersion)
	}
	if suppliedAPIID := capabilityString(contract["apiId"]); suppliedAPIID != "" && suppliedAPIID != apiID {
		return nil, nil, nil, APIValidation{}, errors.New("contract apiId must match the stable API UID")
	}
	capability, err := cloneCapability(mapValue(contract["capability"]))
	if err != nil || len(capability) == 0 {
		return nil, nil, nil, APIValidation{}, errors.New("contract capability is required")
	}
	capability["apiId"] = apiID
	validation := validateCapability(capability)
	if validation.Status != "passed" {
		return nil, nil, nil, validation, &CapabilityValidationError{Issues: validation.Issues}
	}

	billingByOperation := map[string]map[string]any{}
	for index, raw := range sliceValue(contract["billing"]) {
		billing := mapValue(raw)
		allowed := map[string]bool{"operationId": true, "currency": true, "chargeFormula": true, "maximumChargePerInvocationAtomic": true, "settlementPolicy": true}
		for key := range billing {
			if !allowed[key] {
				return nil, nil, nil, validation, fmt.Errorf("billing[%d] field %s is not allowed", index, key)
			}
		}
		operationID := capabilityString(billing["operationId"])
		operation := operationFromCapability(capability, operationID)
		if operationID == "" || len(operation) == 0 {
			return nil, nil, nil, validation, fmt.Errorf("billing[%d] references an unknown operationId", index)
		}
		if _, exists := billingByOperation[operationID]; exists {
			return nil, nil, nil, validation, fmt.Errorf("billing for Operation %s is duplicated", operationID)
		}
		if capabilityString(billing["currency"]) != "USDC" || capabilityString(billing["settlementPolicy"]) != settlementPolicyV4 {
			return nil, nil, nil, validation, fmt.Errorf("billing for Operation %s must use USDC and %s", operationID, settlementPolicyV4)
		}
		maximum, ok := pricingInteger(billing["maximumChargePerInvocationAtomic"])
		if !ok || maximum < 1 {
			return nil, nil, nil, validation, fmt.Errorf("billing for Operation %s requires a positive invocation maximum", operationID)
		}
		formula := mapValue(billing["chargeFormula"])
		if len(formula) != 2 || capabilityString(formula["language"]) != priceFormulaLanguage || capabilityString(formula["expression"]) == "" {
			return nil, nil, nil, validation, fmt.Errorf("billing for Operation %s requires a %s expression", operationID, priceFormulaLanguage)
		}
		allowedVariables := operationMeteringDimensions(operation)
		if allowedVariables["delivered"] {
			return nil, nil, nil, validation, errors.New("metering dimension delivered is reserved by Exora")
		}
		allowedVariables["delivered"] = true
		compiled, compileErr := compilePriceFormula(capabilityString(formula["expression"]), allowedVariables)
		if compileErr != nil {
			return nil, nil, nil, validation, fmt.Errorf("billing for Operation %s: %w", operationID, compileErr)
		}
		bounds := operationMeteringBounds(operation)
		bounds["delivered"] = 1
		if safeErr := validateSafeChargeFormula(compiled, bounds); safeErr != nil {
			return nil, nil, nil, validation, fmt.Errorf("billing for Operation %s: %w", operationID, safeErr)
		}
		billingByOperation[operationID] = map[string]any{
			"operationId":                      operationID,
			"currency":                         "USDC",
			"chargeFormula":                    map[string]any{"language": priceFormulaLanguage, "expression": capabilityString(formula["expression"])},
			"maximumChargePerInvocationAtomic": maximum,
			"settlementPolicy":                 settlementPolicyV4,
		}
	}
	if len(billingByOperation) != len(validation.OperationHash) {
		return nil, nil, nil, validation, errors.New("exactly one billing rule is required for every Operation")
	}
	canonicalBilling := make([]any, 0, len(billingByOperation))
	for _, operationID := range sortedKeys(validation.OperationHash) {
		canonicalBilling = append(canonicalBilling, billingByOperation[operationID])
	}
	canonical := map[string]any{"schemaVersion": APIContractSchemaVersion, "apiId": apiID, "capability": capability, "billing": canonicalBilling}
	return canonical, capability, billingByOperation, validation, nil
}

func contractPricing(apiID, operationID, operationHash string, billing map[string]any) map[string]any {
	return map[string]any{
		"schemaVersion":                    "exora.operation-pricing.v4",
		"apiId":                            apiID,
		"operationId":                      operationID,
		"operationSha256":                  operationHash,
		"currency":                         billing["currency"],
		"chargeFormula":                    billing["chargeFormula"],
		"maximumChargePerInvocationAtomic": billing["maximumChargePerInvocationAtomic"],
		"settlementPolicy":                 billing["settlementPolicy"],
		"reviewStatus":                     "edited",
	}
}

func contractBilling(contract map[string]any, operationID string) map[string]any {
	for _, raw := range sliceValue(contract["billing"]) {
		billing := mapValue(raw)
		if capabilityString(billing["operationId"]) == operationID {
			return billing
		}
	}
	return nil
}

func (s *Service) SubmitAPIContractContext(ctx context.Context, id string, input SubmitAPIContractInput) (APIDraft, error) {
	if strings.TrimSpace(input.IdempotencyKey) == "" {
		return APIDraft{}, errors.New("idempotencyKey is required")
	}
	canonical, capability, _, validation, err := normalizeAPIContractV1(id, input.Contract)
	if err != nil {
		if validation.Status != "" {
			return APIDraft{APIID: id, Validation: validation}, err
		}
		return APIDraft{}, err
	}
	contractHash := hashJSON(canonical)
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	value, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	if value.LastIdempotencyKey == input.IdempotencyKey {
		if value.ContractPackageHash != contractHash {
			return APIDraft{}, errors.New("idempotencyKey was already used with different content")
		}
		return value, nil
	}
	if value.Status == "live" || value.Status == "draining" || hasActiveOperation(value) {
		return APIDraft{}, errors.New("a live or draining API must be offline before its contract can change")
	}
	hasExistingContract := len(value.ContractPackage) > 0 || strings.TrimSpace(value.ContractPackageHash) != ""
	if hasExistingContract && hasLockedIntegration(value) && !input.ReplaceLockedContract {
		return APIDraft{}, errors.New("replaceLockedContract is required to invalidate the confirmed contract")
	}
	if input.ExpectedVersion != value.Version {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	if value.ContractPackageHash == contractHash {
		return value, nil
	}
	previous, cloneErr := cloneAPIDraft(value)
	if cloneErr != nil {
		return APIDraft{}, cloneErr
	}
	value.Title = capabilityString(capability["title"])
	value.Description = capabilityString(capability["description"])
	value.DeliveryMode = capabilityString(capability["deliveryMode"])
	value.Capability = capability
	value.ContractPackage = canonical
	value.ContractPackageHash = contractHash
	value.Validation = validation
	value.Operations = newOperationReviews(value.APIID, capability, validation)
	value.Status = "review_required"
	value.Source = firstNonEmpty(input.Source, value.Source, "manual")
	value.LastIdempotencyKey = input.IdempotencyKey
	value.CloudAPIID = value.APIID
	value.Version++
	value.UpdatedAt = time.Now().UTC()
	if persistErr := s.persistCloudSyncedDraft(ctx, value, &previous); persistErr != nil {
		return APIDraft{}, persistErr
	}
	return value, nil
}

func contractHasReviewEvidence(value APIDraft) bool {
	for _, review := range value.Operations {
		if len(review.ConnectivityReceipt) > 0 || len(review.PricingBillingReceipt) > 0 || len(review.ValidationRun) > 0 || len(review.BillingRun) > 0 || review.ConfirmedAt != nil {
			return true
		}
	}
	return false
}

// ClearAPIContractContext removes the uploaded source contract while keeping
// the platform-issued API UID and Draft itself. Any derived Operations,
// validation receipts, and billing projections are removed with the source.
func (s *Service) ClearAPIContractContext(ctx context.Context, id string, input ClearAPIContractInput) (APIDraft, error) {
	if s == nil || s.store == nil {
		return APIDraft{}, errors.New("provider API draft service unavailable")
	}
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	value, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	if value.Status == "live" || value.Status == "draining" || hasActiveOperation(value) {
		return APIDraft{}, errors.New("a live or draining API must be offline before its contract can be removed")
	}
	if input.ExpectedVersion != value.Version {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	if len(value.ContractPackage) == 0 && strings.TrimSpace(value.ContractPackageHash) == "" {
		return value, nil
	}
	if contractHasReviewEvidence(value) && !input.InvalidateEvidence {
		return APIDraft{}, errors.New("invalidateEvidence is required to remove a tested contract")
	}
	previous, err := cloneAPIDraft(value)
	if err != nil {
		return APIDraft{}, err
	}
	capability := map[string]any{
		"schemaVersion": APISchemaVersion,
		"title":         "",
		"description":   "",
		"deliveryMode":  value.DeliveryMode,
		"interface":     map[string]any{},
		"runtime":       map[string]any{},
		"operations":    []any{},
	}
	value.Title = ""
	value.Description = ""
	value.Capability = capability
	value.ContractPackage = nil
	value.ContractPackageHash = ""
	value.Validation = validateCapability(capability)
	value.Operations = map[string]OperationReview{}
	value.Status = "local_draft"
	value.LastIdempotencyKey = ""
	value.Version++
	value.UpdatedAt = time.Now().UTC()
	if err := s.persistCloudSyncedDraft(ctx, value, &previous); err != nil {
		return APIDraft{}, err
	}
	return value, nil
}

func (s *Service) advanceContractIntegration(id, operationID string, input OwnerOperationReviewInput) (APIDraft, error) {
	return s.updateOperationReview(id, operationID, input.ExpectedVersion, input.OperationHash, func(review *OperationReview, _ APIDraft) error {
		if review.IntegrationStatus != "awaiting_confirmation" || review.ConnectivityReceipt["passed"] != true || capabilityString(review.ConnectivityReceipt["schemaVersion"]) != validationReceiptVersion || capabilityString(review.ConnectivityReceipt["planSha256"]) != capabilityString(review.ValidationPlan["planSha256"]) {
			return errors.New("current integration validation must pass before billing validation")
		}
		review.IntegrationStatus, review.CapabilityReview, review.PricingStatus = "locked", "pending", "editable"
		now := time.Now().UTC()
		review.IntegrationLockedAt = &now
		return nil
	})
}

func (s *Service) RunContractValidation(ctx context.Context, id, operationID string, input ContractValidationInput) (APIDraft, error) {
	if strings.TrimSpace(input.IdempotencyKey) == "" {
		return APIDraft{}, errors.New("idempotencyKey is required")
	}
	draft, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	if draft.Version != input.ExpectedVersion {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	if capabilityString(draft.ContractPackage["schemaVersion"]) != APIContractSchemaVersion || draft.ContractPackageHash == "" {
		return APIDraft{}, errors.New("upload a complete exora.api-contract.v1 file before validation")
	}
	review, ok := draft.Operations[operationID]
	if !ok {
		return APIDraft{}, fmt.Errorf("unknown operationId %q", operationID)
	}
	if capabilityString(review.BillingRun["idempotencyKey"]) == input.IdempotencyKey && (review.PricingStatus == "awaiting_confirmation" || review.PricingStatus == "locked") {
		return draft, nil
	}
	current := draft
	var err error
	if review.IntegrationStatus != "locked" {
		current, err = s.RunConnectivityTest(ctx, id, operationID, current.Version, review.OperationHash)
		if err != nil {
			return APIDraft{}, err
		}
		review = current.Operations[operationID]
		current, err = s.advanceContractIntegration(id, operationID, OwnerOperationReviewInput{ExpectedVersion: current.Version, OperationHash: review.OperationHash})
		if err != nil {
			return APIDraft{}, err
		}
		review = current.Operations[operationID]
	}
	billing := contractBilling(current.ContractPackage, operationID)
	if len(billing) == 0 {
		return APIDraft{}, errors.New("the current contract has no billing rule for this Operation")
	}
	return s.RunBillingTest(id, operationID, PricingDraftInput{
		ExpectedVersion: current.Version,
		OperationHash:   review.OperationHash,
		Pricing:         contractPricing(id, operationID, review.OperationHash, billing),
		IdempotencyKey:  input.IdempotencyKey,
	})
}

func (s *Service) ConfirmContract(id, operationID string, input OwnerOperationReviewInput) (APIDraft, error) {
	return s.updateOperationReview(id, operationID, input.ExpectedVersion, input.OperationHash, func(review *OperationReview, draft APIDraft) error {
		if review.IntegrationStatus != "locked" || review.ConnectivityReceipt["passed"] != true || review.PricingStatus != "awaiting_confirmation" || review.PricingBillingReceipt["passed"] != true {
			return errors.New("integration and Cloud billing validation must both pass before contract confirmation")
		}
		pricing, err := cloneCapability(review.PricingDraft)
		if err != nil {
			return err
		}
		pricing["reviewStatus"], pricing["confirmedAt"] = "confirmed", time.Now().UTC().Format(time.RFC3339Nano)
		compiled, err := normalizeOperationPricingV4(id, operationID, review.OperationHash, pricing, operationFromCapability(draft.Capability, operationID), review.ConnectivityReceipt, "confirmed")
		if err != nil {
			return err
		}
		if err := verifyCloudBillingReceipt(review.PricingBillingReceipt, id, operationID, review.OperationHash, hashJSON(review.ConnectivityReceipt), pricingPlanHash(pricing), compiled.sha256, capabilityString(review.BillingPlan["planSha256"])); err != nil {
			return err
		}
		review.Pricing = pricing
		review.IntegrationStatus, review.PricingStatus = "locked", "locked"
		review.CapabilityReview, review.PricingReview, review.Qualification = "confirmed", "confirmed", "passed"
		now := time.Now().UTC()
		review.ConfirmedAt, review.IntegrationLockedAt, review.PricingLockedAt = &now, &now, &now
		return nil
	})
}
