package sellerdraft

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	APISchemaVersion         = "exora.api.v3"
	OperationSchemaVersion   = "exora.operation.v3"
	APIContractSchemaVersion = "exora.api-contract.v1"
)

var operationIDPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9._-]{0,127}$`)

type ValidationIssue struct {
	OperationID string `json:"operationId,omitempty"`
	FieldPath   string `json:"fieldPath"`
	ErrorCode   string `json:"errorCode"`
	Message     string `json:"message"`
}

type APIValidation struct {
	Status         string            `json:"status"`
	CapabilityHash string            `json:"capabilitySha256,omitempty"`
	OperationHash  map[string]string `json:"operationSha256,omitempty"`
	Issues         []ValidationIssue `json:"issues"`
	CheckedAt      time.Time         `json:"checkedAt"`
}

type OperationReview struct {
	OperationID             string         `json:"operationId"`
	OperationHash           string         `json:"operationSha256"`
	Enabled                 bool           `json:"enabled"`
	CapabilityReview        string         `json:"capabilityReview"`
	PricingReview           string         `json:"pricingReview"`
	Qualification           string         `json:"qualification"`
	Pricing                 map[string]any `json:"pricing,omitempty"`
	QualificationReceipt    map[string]any `json:"qualificationReceipt,omitempty"`
	ConfirmedAt             *time.Time     `json:"confirmedAt,omitempty"`
	IntegrationStatus       string         `json:"integrationStatus"`
	PricingStatus           string         `json:"pricingStatus"`
	ValidationPlan          map[string]any `json:"validationPlan,omitempty"`
	ValidationRun           map[string]any `json:"validationRun,omitempty"`
	ConnectivityReceipt     map[string]any `json:"validationReceipt,omitempty"`
	PricingDraft            map[string]any `json:"pricingDraft,omitempty"`
	BillingPlan             map[string]any `json:"billingPlan,omitempty"`
	BillingRun              map[string]any `json:"billingRun,omitempty"`
	PricingBillingReceipt   map[string]any `json:"pricingBillingReceipt,omitempty"`
	IntegrationLockedAt     *time.Time     `json:"integrationLockedAt,omitempty"`
	PricingLockedAt         *time.Time     `json:"pricingLockedAt,omitempty"`
	OperationalState        string         `json:"operationalState"`
	OperationalStatusReason string         `json:"operationalStatusReason,omitempty"`
	OperationalMetrics      map[string]any `json:"operationalMetrics,omitempty"`
	OperationalSettings     map[string]any `json:"operationalSettings,omitempty"`
}

type APIDraft struct {
	APIID                  string                     `json:"apiId"`
	Version                int64                      `json:"version"`
	Source                 string                     `json:"source"`
	Status                 string                     `json:"status"`
	DeliveryMode           string                     `json:"deliveryMode"`
	DisplayName            string                     `json:"displayName,omitempty"`
	Icon                   string                     `json:"icon,omitempty"`
	Title                  string                     `json:"title"`
	Description            string                     `json:"description"`
	CloudAPIID             string                     `json:"cloudApiId,omitempty"`
	Capability             map[string]any             `json:"capability"`
	ContractPackage        map[string]any             `json:"contractPackage,omitempty"`
	ContractPackageHash    string                     `json:"contractPackageSha256,omitempty"`
	Validation             APIValidation              `json:"validation"`
	Operations             map[string]OperationReview `json:"operationReviews"`
	CreationIdempotencyKey string                     `json:"creationIdempotencyKey,omitempty"`
	LastIdempotencyKey     string                     `json:"lastIdempotencyKey,omitempty"`
	CreatedAt              time.Time                  `json:"createdAt"`
	UpdatedAt              time.Time                  `json:"updatedAt"`
}

type SubmitAPIContractInput struct {
	ExpectedVersion       int64          `json:"expectedVersion"`
	Contract              map[string]any `json:"contract"`
	IdempotencyKey        string         `json:"idempotencyKey"`
	ReplaceLockedContract bool           `json:"replaceLockedContract,omitempty"`
	Source                string         `json:"source,omitempty"`
}

type ClearAPIContractInput struct {
	ExpectedVersion    int64 `json:"expectedVersion"`
	InvalidateEvidence bool  `json:"invalidateEvidence,omitempty"`
}

type ContractValidationInput struct {
	ExpectedVersion int64  `json:"expectedVersion"`
	IdempotencyKey  string `json:"idempotencyKey"`
}

type SubmitCapabilityInput struct {
	APIID           string         `json:"apiId,omitempty"`
	Capability      map[string]any `json:"capability"`
	ExpectedVersion int64          `json:"expectedVersion,omitempty"`
	IdempotencyKey  string         `json:"idempotencyKey"`
	Source          string         `json:"source,omitempty"`
}

type CreateAPIDraftInput struct {
	DeliveryMode   string `json:"deliveryMode"`
	DisplayName    string `json:"displayName,omitempty"`
	IdempotencyKey string `json:"idempotencyKey,omitempty"`
	Source         string `json:"source,omitempty"`
}

type DeleteAPIDraftInput struct {
	ExpectedVersion int64 `json:"expectedVersion"`
}

type UpdateDraftIdentityInput struct {
	ExpectedVersion int64  `json:"expectedVersion"`
	DisplayName     string `json:"displayName"`
	Icon            string `json:"icon"`
}

type UpdateOperationInput struct {
	ExpectedVersion int64          `json:"expectedVersion"`
	Operation       map[string]any `json:"operation"`
}

type UpdateCapabilityInput struct {
	ExpectedVersion          int64          `json:"expectedVersion"`
	Capability               map[string]any `json:"capability"`
	ReplaceLockedIntegration bool           `json:"replaceLockedIntegration,omitempty"`
}

type OwnerOperationReviewInput struct {
	ExpectedVersion int64          `json:"expectedVersion"`
	OperationHash   string         `json:"operationSha256"`
	Pricing         map[string]any `json:"pricing,omitempty"`
}

type ValidationRunInput struct {
	ExpectedVersion int64  `json:"expectedVersion"`
	OperationHash   string `json:"operationSha256"`
	IdempotencyKey  string `json:"idempotencyKey"`
}

type CancelValidationRunInput struct {
	ExpectedVersion int64 `json:"expectedVersion"`
}

type QualificationInput struct {
	ExpectedVersion    int64             `json:"expectedVersion"`
	OperationHash      string            `json:"operationSha256"`
	RuntimeHash        string            `json:"runtimeSha256"`
	ReceiptID          string            `json:"receiptId"`
	Passed             bool              `json:"passed"`
	VerifiedDimensions []string          `json:"verifiedDimensions,omitempty"`
	DimensionUnits     map[string]string `json:"dimensionUnits,omitempty"`
	SampleUsage        map[string]int64  `json:"sampleUsage,omitempty"`
}

type ConnectivityReceiptInput = QualificationInput

type PricingDraftInput struct {
	ExpectedVersion int64          `json:"expectedVersion"`
	OperationHash   string         `json:"operationSha256"`
	Pricing         map[string]any `json:"pricing"`
	IdempotencyKey  string         `json:"idempotencyKey,omitempty"`
}

type OperationLifecycleInput struct {
	ExpectedVersion int64  `json:"expectedVersion"`
	OperationHash   string `json:"operationSha256"`
	Action          string `json:"action"`
}

type OperationSettingsInput struct {
	ExpectedVersion  int64  `json:"expectedVersion"`
	OperationHash    string `json:"operationSha256"`
	ConcurrencyLimit int    `json:"concurrencyLimit"`
}

func issue(operationID, path, code, message string) ValidationIssue {
	return ValidationIssue{OperationID: operationID, FieldPath: path, ErrorCode: code, Message: message}
}

func mapValue(value any) map[string]any {
	out, _ := value.(map[string]any)
	return out
}

func sliceValue(value any) []any {
	out, _ := value.([]any)
	return out
}

func capabilityString(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func containsSensitiveField(value any) bool {
	switch item := value.(type) {
	case map[string]any:
		for key, child := range item {
			if regexp.MustCompile(`(?i)secret|password|private.?key|authorization|access.?token|credential.?value`).MatchString(key) {
				return true
			}
			if containsSensitiveField(child) {
				return true
			}
		}
	case []any:
		for _, child := range item {
			if containsSensitiveField(child) {
				return true
			}
		}
	}
	return false
}

func hashJSON(value any) string {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func validateCapability(value map[string]any) APIValidation {
	now := time.Now().UTC()
	result := APIValidation{Status: "failed", OperationHash: map[string]string{}, Issues: []ValidationIssue{}, CheckedAt: now}
	if capabilityString(value["schemaVersion"]) != APISchemaVersion {
		result.Issues = append(result.Issues, issue("", "schemaVersion", "invalid_version", "schemaVersion must be "+APISchemaVersion))
	}
	for _, key := range []string{"title", "description", "deliveryMode", "interface", "runtime", "operations"} {
		if value[key] == nil || capabilityString(value[key]) == "" {
			result.Issues = append(result.Issues, issue("", key, "required", key+" is required"))
		}
	}
	delivery := capabilityString(value["deliveryMode"])
	if delivery != "local_dock" && delivery != "cloud_direct" {
		result.Issues = append(result.Issues, issue("", "deliveryMode", "invalid_delivery_mode", "deliveryMode must be local_dock or cloud_direct"))
	}
	openapi := mapValue(value["interface"])
	if !strings.HasPrefix(capabilityString(openapi["openapi"]), "3.1.") || len(mapValue(openapi["paths"])) == 0 {
		result.Issues = append(result.Issues, issue("", "interface", "invalid_openapi", "interface must contain OpenAPI 3.1 paths"))
	}
	if containsSensitiveField(value) {
		result.Issues = append(result.Issues, issue("", "$", "sensitive_field_forbidden", "Capability Form must not contain secrets or credential values"))
	}
	runtime := mapValue(value["runtime"])
	baseURL, baseErr := url.Parse(capabilityString(runtime["publicBaseUrl"]))
	if baseErr != nil || baseURL.Hostname() == "" || baseURL.User != nil || baseURL.RawQuery != "" || baseURL.Fragment != "" || capabilityString(runtime["healthPath"]) == "" {
		result.Issues = append(result.Issues, issue("", "runtime", "invalid_runtime", "runtime requires a credential-free publicBaseUrl and healthPath"))
	} else if delivery == "local_dock" {
		ip := net.ParseIP(baseURL.Hostname())
		if baseURL.Scheme != "http" || ip == nil || !ip.IsLoopback() {
			result.Issues = append(result.Issues, issue("", "runtime.publicBaseUrl", "invalid_local_runtime", "local_dock requires a loopback HTTP publicBaseUrl"))
		}
	} else if delivery == "cloud_direct" && baseURL.Scheme != "https" {
		result.Issues = append(result.Issues, issue("", "runtime.publicBaseUrl", "invalid_cloud_runtime", "cloud_direct requires an HTTPS publicBaseUrl"))
	}
	operations := sliceValue(value["operations"])
	if len(operations) == 0 {
		result.Issues = append(result.Issues, issue("", "operations", "operation_required", "at least one Operation is required"))
	}
	seen := map[string]bool{}
	for index, raw := range operations {
		operation := mapValue(raw)
		path := fmt.Sprintf("operations[%d]", index)
		operationID := capabilityString(operation["operationId"])
		if !operationIDPattern.MatchString(operationID) {
			result.Issues = append(result.Issues, issue(operationID, path+".operationId", "invalid_operation_id", "operationId is invalid"))
		} else if seen[operationID] {
			result.Issues = append(result.Issues, issue(operationID, path+".operationId", "duplicate_operation_id", "operationId must be unique within the API"))
		}
		seen[operationID] = true
		if capabilityString(operation["schemaVersion"]) != OperationSchemaVersion {
			result.Issues = append(result.Issues, issue(operationID, path+".schemaVersion", "invalid_version", "Operation schemaVersion must be "+OperationSchemaVersion))
		}
		for _, key := range []string{"title", "description", "usage", "api", "behavior", "interaction", "limits", "metering", "qualification"} {
			if operation[key] == nil || capabilityString(operation[key]) == "" {
				result.Issues = append(result.Issues, issue(operationID, path+"."+key, "required", key+" is required"))
			}
		}
		usage := mapValue(operation["usage"])
		if len(sliceValue(usage["useCases"])) == 0 || len(sliceValue(usage["instructions"])) == 0 {
			result.Issues = append(result.Issues, issue(operationID, path+".usage", "usage_incomplete", "useCases and instructions are required"))
		}
		api := mapValue(operation["api"])
		method, route := strings.ToUpper(capabilityString(api["method"])), capabilityString(api["path"])
		if !map[string]bool{"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true}[method] || !strings.HasPrefix(route, "/") {
			result.Issues = append(result.Issues, issue(operationID, path+".api", "invalid_api_route", "a supported method and absolute path are required"))
		}
		if capabilityString(api["openapiOperationRef"]) == "" {
			result.Issues = append(result.Issues, issue(operationID, path+".api.openapiOperationRef", "openapi_ref_required", "OpenAPI 3.1 is the only authoritative request and response contract"))
		}
		interaction := mapValue(operation["interaction"])
		mode := capabilityString(interaction["mode"])
		if mode != "request_response" && mode != "server_stream" && mode != "async_job" {
			result.Issues = append(result.Issues, issue(operationID, path+".interaction.mode", "invalid_interaction", "interaction mode is invalid"))
		}
		if mode == "server_stream" && (len(mapValue(interaction["eventSchema"])) == 0 || capabilityString(interaction["completionEvent"]) == "" || capabilityString(interaction["errorEvent"]) == "" || capabilityString(interaction["sequencePointer"]) == "" || interaction["maximumWaitSeconds"] == nil) {
			result.Issues = append(result.Issues, issue(operationID, path+".interaction", "stream_protocol_required", "server_stream requires event, completion, error, sequence and timeout declarations"))
		}
		if mode == "async_job" && (capabilityString(interaction["jobIdPointer"]) == "" || capabilityString(interaction["statusPointer"]) == "" || capabilityString(interaction["pollPath"]) == "" || len(sliceValue(interaction["terminalStates"])) == 0 || interaction["maximumWaitSeconds"] == nil) {
			result.Issues = append(result.Issues, issue(operationID, path+".interaction", "job_policy_required", "async_job requires duration and terminal states"))
		}
		behavior := mapValue(operation["behavior"])
		sideEffect := mapValue(behavior["sideEffect"])
		if sideEffect["present"] == true && (capabilityString(sideEffect["testMode"]) == "" || capabilityString(sideEffect["testMode"]) == "none") {
			result.Issues = append(result.Issues, issue(operationID, path+".behavior.sideEffect.testMode", "safe_test_required", "side effects require a safe test mode"))
		}
		for meterIndex, rawMeter := range sliceValue(mapValue(operation["metering"])["capabilities"]) {
			meter := mapValue(rawMeter)
			meterPath := fmt.Sprintf("%s.metering.capabilities[%d]", path, meterIndex)
			dimension, source := capabilityString(meter["dimension"]), capabilityString(meter["source"])
			maximum, maximumOK := pricingInteger(meter["maximumPerInvocation"])
			if !operationIDPattern.MatchString(dimension) || capabilityString(meter["unit"]) == "" || capabilityString(meter["description"]) == "" {
				result.Issues = append(result.Issues, issue(operationID, meterPath, "metering_metadata_required", "identifier-safe dimension, unit and description are required"))
			}
			if source != "cloud" && source != "provider_attested" {
				result.Issues = append(result.Issues, issue(operationID, meterPath+".source", "invalid_metering_source", "source must be cloud or provider_attested"))
			}
			if !maximumOK || maximum < 1 {
				result.Issues = append(result.Issues, issue(operationID, meterPath+".maximumPerInvocation", "invalid_metering_maximum", "maximumPerInvocation must be positive"))
			}
			if source == "provider_attested" && capabilityString(meter["evidencePointer"]) == "" {
				result.Issues = append(result.Issues, issue(operationID, meterPath+".evidencePointer", "metering_evidence_required", "provider_attested metering requires an evidencePointer"))
			}
		}
		fixtures := sliceValue(mapValue(operation["qualification"])["fixtures"])
		if len(fixtures) == 0 {
			result.Issues = append(result.Issues, issue(operationID, path+".qualification", "qualification_incomplete", "at least one safe Seller fixture is required"))
		}
		hasSuccess, hasStream, hasAsyncComplete, hasAsyncCancel, hasArtifact := false, false, false, false, false
		errorFixtures := map[string]bool{}
		for fixtureIndex, rawFixture := range fixtures {
			fixture := mapValue(rawFixture)
			protocol := mapValue(fixture["expectedProtocol"])
			fixturePath := fmt.Sprintf("%s.qualification.fixtures[%d]", path, fixtureIndex)
			status, statusOK := pricingInteger(protocol["status"])
			kind := capabilityString(fixture["kind"])
			hasSuccess, hasStream = hasSuccess || kind == "success", hasStream || kind == "stream"
			hasAsyncComplete, hasAsyncCancel, hasArtifact = hasAsyncComplete || kind == "async_complete", hasAsyncCancel || kind == "async_cancel", hasArtifact || kind == "artifact"
			if kind == "business_error" {
				errorFixtures[capabilityString(fixture["errorCode"])] = true
			}
			if capabilityString(fixture["id"]) == "" || len(mapValue(fixture["request"])) == 0 || fixture["safeToRepeat"] != true || !statusOK || status < 100 || status > 599 || capabilityString(protocol["mediaType"]) == "" || capabilityString(protocol["openapiResponseRef"]) == "" {
				result.Issues = append(result.Issues, issue(operationID, fixturePath, "invalid_fixture", "safe fixture id, request and expected protocol are required"))
			}
		}
		if !hasSuccess {
			result.Issues = append(result.Issues, issue(operationID, path+".qualification.fixtures", "success_fixture_required", "at least one safe success fixture is required"))
		}
		for _, rawError := range sliceValue(api["errors"]) {
			errorCode := capabilityString(mapValue(rawError)["code"])
			if errorCode != "" && !errorFixtures[errorCode] {
				result.Issues = append(result.Issues, issue(operationID, path+".qualification.fixtures", "business_error_fixture_required", "public error "+errorCode+" requires a safe Seller fixture"))
			}
		}
		if mode == "server_stream" && !hasStream {
			result.Issues = append(result.Issues, issue(operationID, path+".qualification.fixtures", "stream_fixture_required", "server_stream requires a safe stream fixture"))
		}
		if mode == "async_job" && !hasAsyncComplete {
			result.Issues = append(result.Issues, issue(operationID, path+".qualification.fixtures", "async_complete_fixture_required", "async_job requires a safe completion fixture"))
		}
		if mode == "async_job" && capabilityString(interaction["cancelPath"]) != "" && !hasAsyncCancel {
			result.Issues = append(result.Issues, issue(operationID, path+".qualification.fixtures", "async_cancel_fixture_required", "cancelable async_job requires a safe cancellation fixture"))
		}
		if len(sliceValue(mapValue(operation["artifacts"])["outputs"])) > 0 && !hasArtifact {
			result.Issues = append(result.Issues, issue(operationID, path+".qualification.fixtures", "artifact_fixture_required", "Artifact output requires a safe Artifact fixture"))
		}
		operationHash := hashJSON(operation)
		if _, err := compileValidationPlan("", value, operation, operationHash); err != nil {
			result.Issues = append(result.Issues, issue(operationID, path+".qualification", "validation_plan_invalid", err.Error()))
		}
		if operationID != "" {
			result.OperationHash[operationID] = operationHash
		}
	}
	result.CapabilityHash = hashJSON(value)
	if len(result.Issues) == 0 {
		result.Status = "passed"
	}
	return result
}

func newOperationReviews(apiID string, capability map[string]any, validation APIValidation) map[string]OperationReview {
	reviews := make(map[string]OperationReview, len(validation.OperationHash))
	for operationID, operationHash := range validation.OperationHash {
		operation := operationFromCapability(capability, operationID)
		plan, _ := compileValidationPlan(apiID, capability, operation, operationHash)
		maximum, _ := pricingInteger(mapValue(operation["limits"])["maximumConcurrency"])
		if maximum < 1 {
			maximum = 1
		}
		reviews[operationID] = OperationReview{OperationID: operationID, OperationHash: operationHash, Enabled: true, CapabilityReview: "pending", PricingReview: "empty", Qualification: "pending", IntegrationStatus: "editable", PricingStatus: "blocked", ValidationPlan: plan, OperationalState: "offline", OperationalMetrics: emptyOperationalMetrics(), OperationalSettings: map[string]any{"concurrencyLimit": maximum}}
	}
	return reviews
}

type cloudDraftMutationResponse struct {
	APIDraft struct {
		APIID   string `json:"apiId"`
		Version int64  `json:"version"`
	} `json:"apiDraft"`
}

func cloneAPIDraft(value APIDraft) (APIDraft, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return APIDraft{}, err
	}
	var cloned APIDraft
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return APIDraft{}, err
	}
	return cloned, nil
}

func (s *Service) syncCloudDraft(ctx context.Context, method string, value APIDraft, expectedVersion int64) error {
	path := "/v4/provider/api-drafts"
	if method != http.MethodPost {
		path += "/" + url.PathEscape(value.APIID)
	}
	payload := map[string]any{"apiDraft": value}
	if expectedVersion > 0 {
		payload["expectedVersion"] = expectedVersion
	}
	var response cloudDraftMutationResponse
	if err := s.cloud.JSON(ctx, method, path, payload, &response); err != nil {
		return err
	}
	if response.APIDraft.APIID != value.APIID {
		return fmt.Errorf("Cloud returned API id %q, expected stable API id %q", response.APIDraft.APIID, value.APIID)
	}
	if response.APIDraft.Version != value.Version {
		return fmt.Errorf("Cloud returned API draft version %d, expected %d", response.APIDraft.Version, value.Version)
	}
	return nil
}

func (s *Service) persistCloudSyncedDraft(ctx context.Context, value APIDraft, previous *APIDraft) error {
	value.CloudAPIID = value.APIID
	method, expectedVersion := http.MethodPost, int64(0)
	if previous != nil {
		method, expectedVersion = http.MethodPut, previous.Version
	}
	if err := s.syncCloudDraft(ctx, method, value, expectedVersion); err != nil {
		var cloudErr *cloudHTTPError
		cloudDraftMissing := previous != nil && errors.As(err, &cloudErr) && cloudErr.StatusCode == http.StatusNotFound && cloudErr.ErrorCode == "api_draft_not_found"
		cloudDraftOneVersionBehind := previous != nil && previous.Version > 1 && errors.As(err, &cloudErr) && cloudErr.StatusCode == http.StatusConflict && cloudErr.ErrorCode == "api_draft_version_conflict"
		if cloudDraftOneVersionBehind {
			// Releases created before publish-version synchronization left the
			// Cloud editing snapshot exactly one version behind the authoritative
			// Dock snapshot. Bring that snapshot current, then apply this mutation.
			if repairErr := s.syncCloudDraft(ctx, http.MethodPut, *previous, previous.Version-1); repairErr != nil {
				return repairErr
			}
			if repairErr := s.syncCloudDraft(ctx, http.MethodPut, value, previous.Version); repairErr != nil {
				return repairErr
			}
		} else if !cloudDraftMissing {
			return err
		} else {
			// Cloud draft metadata can be rebuilt from Dock's authoritative local
			// snapshot after a Cloud process restart. Preserve the stable UID and
			// current version instead of forcing the owner to recreate the API.
			if err := s.syncCloudDraft(ctx, http.MethodPost, value, 0); err != nil {
				return err
			}
		}
	}
	if err := s.store.SaveAPIDraft(value); err != nil {
		if previous == nil {
			_ = s.cloud.JSON(context.Background(), http.MethodDelete, "/v4/provider/api-drafts/"+url.PathEscape(value.APIID), map[string]any{"expectedVersion": value.Version}, nil)
		} else {
			_ = s.syncCloudDraft(context.Background(), http.MethodPut, *previous, value.Version)
		}
		return err
	}
	if err := s.syncTunnelEndpoint(ctx, value); err != nil {
		return err
	}
	return nil
}

func (s *Service) CreateAPIDraft(input CreateAPIDraftInput) (APIDraft, error) {
	return s.CreateAPIDraftContext(context.Background(), input)
}

func (s *Service) CreateAPIDraftContext(ctx context.Context, input CreateAPIDraftInput) (APIDraft, error) {
	if s == nil || s.store == nil {
		return APIDraft{}, errors.New("provider API draft service unavailable")
	}
	deliveryMode := strings.TrimSpace(input.DeliveryMode)
	if deliveryMode != "local_dock" && deliveryMode != "cloud_direct" {
		return APIDraft{}, errors.New("deliveryMode must be local_dock or cloud_direct")
	}
	displayName := strings.TrimSpace(input.DisplayName)
	if len([]rune(displayName)) > 160 {
		return APIDraft{}, errors.New("API display name must be 160 characters or fewer")
	}
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	if idempotencyKey != "" {
		for _, existing := range s.store.APIDrafts() {
			if existing.CreationIdempotencyKey != idempotencyKey {
				continue
			}
			if existing.DeliveryMode != deliveryMode || existing.DisplayName != displayName {
				return APIDraft{}, errors.New("idempotencyKey was already used with different draft inputs")
			}
			return existing, nil
		}
	}
	now := time.Now().UTC()
	capability := map[string]any{
		"schemaVersion": APISchemaVersion,
		"title":         "",
		"description":   "",
		"deliveryMode":  deliveryMode,
		"interface":     map[string]any{},
		"runtime":       map[string]any{},
		"operations":    []any{},
	}
	value := APIDraft{
		APIID:                  newID("api"),
		Version:                1,
		Source:                 firstNonEmpty(input.Source, "manual"),
		Status:                 "local_draft",
		DeliveryMode:           deliveryMode,
		DisplayName:            displayName,
		Icon:                   map[bool]string{true: "code", false: "cloud"}[deliveryMode == "local_dock"],
		Capability:             capability,
		Validation:             validateCapability(capability),
		Operations:             map[string]OperationReview{},
		CreationIdempotencyKey: idempotencyKey,
		CreatedAt:              now,
		UpdatedAt:              now,
	}
	value.CloudAPIID = value.APIID
	if err := s.persistCloudSyncedDraft(ctx, value, nil); err != nil {
		return APIDraft{}, err
	}
	return value, nil
}

var draftIconNames = map[string]bool{
	"bot": true, "cloud": true, "code": true, "database": true,
	"globe": true, "sparkles": true, "terminal": true,
}

func (s *Service) UpdateDraftIdentityContext(ctx context.Context, id string, input UpdateDraftIdentityInput) (APIDraft, error) {
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
		return APIDraft{}, errors.New("a live or draining API must be offline before its identity can change")
	}
	if input.ExpectedVersion != value.Version {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		return APIDraft{}, errors.New("API display name is required")
	}
	if len([]rune(displayName)) > 160 {
		return APIDraft{}, errors.New("API display name must be 160 characters or fewer")
	}
	iconName := strings.TrimSpace(input.Icon)
	if !draftIconNames[iconName] {
		return APIDraft{}, errors.New("unsupported API icon")
	}
	if value.DisplayName == displayName && value.Icon == iconName {
		return value, nil
	}
	previous, err := cloneAPIDraft(value)
	if err != nil {
		return APIDraft{}, err
	}
	value.DisplayName = displayName
	value.Icon = iconName
	value.Version++
	value.UpdatedAt = time.Now().UTC()
	if err := s.persistCloudSyncedDraft(ctx, value, &previous); err != nil {
		return APIDraft{}, err
	}
	return value, nil
}

func (s *Service) SubmitAPICapability(input SubmitCapabilityInput) (APIDraft, error) {
	return s.SubmitAPICapabilityContext(context.Background(), input)
}

func (s *Service) SubmitAPICapabilityContext(ctx context.Context, input SubmitCapabilityInput) (APIDraft, error) {
	if s == nil || s.store == nil {
		return APIDraft{}, errors.New("provider API draft service unavailable")
	}
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	key := strings.TrimSpace(input.IdempotencyKey)
	if key == "" {
		return APIDraft{}, errors.New("idempotencyKey is required")
	}
	validation := validateCapability(input.Capability)
	if validation.Status != "passed" {
		return APIDraft{Validation: validation}, &CapabilityValidationError{Issues: validation.Issues}
	}
	apiID := strings.TrimSpace(input.APIID)
	if apiID != "" {
		value, ok := s.store.APIDraft(apiID)
		if !ok {
			return APIDraft{}, errors.New("API draft not found")
		}
		if value.LastIdempotencyKey == key {
			if hashJSON(input.Capability) != value.Validation.CapabilityHash {
				return APIDraft{}, errors.New("idempotencyKey was already used with different content")
			}
			return value, nil
		}
		if value.Status == "live" {
			return APIDraft{}, errors.New("a live API cannot be overwritten")
		}
		if hasLockedIntegration(value) {
			return APIDraft{}, errors.New("unlock every locked Integration before replacing the Capability Form")
		}
		if input.ExpectedVersion != value.Version {
			return APIDraft{}, errors.New("API draft version conflict")
		}
		previous, err := cloneAPIDraft(value)
		if err != nil {
			return APIDraft{}, err
		}
		capability, err := cloneCapability(input.Capability)
		if err != nil {
			return APIDraft{}, err
		}
		value.Title = capabilityString(capability["title"])
		value.Description = capabilityString(capability["description"])
		value.DeliveryMode = capabilityString(capability["deliveryMode"])
		value.Capability = capability
		value.Validation = validation
		value.Operations = newOperationReviews(value.APIID, capability, validation)
		value.Status = "review_required"
		value.Source = firstNonEmpty(input.Source, value.Source, "agent")
		value.LastIdempotencyKey = key
		value.CloudAPIID = value.APIID
		value.Version++
		value.UpdatedAt = time.Now().UTC()
		if err := s.persistCloudSyncedDraft(ctx, value, &previous); err != nil {
			return APIDraft{}, err
		}
		return value, nil
	}
	for _, existing := range s.store.APIDrafts() {
		if existing.CreationIdempotencyKey == key || existing.LastIdempotencyKey == key {
			if hashJSON(input.Capability) != existing.Validation.CapabilityHash {
				return APIDraft{}, errors.New("idempotencyKey was already used with different content")
			}
			return existing, nil
		}
	}
	now := time.Now().UTC()
	apiID = newID("api")
	reviews := newOperationReviews(apiID, input.Capability, validation)
	value := APIDraft{APIID: apiID, Version: 1, Source: firstNonEmpty(input.Source, "agent"), Status: "review_required", DeliveryMode: capabilityString(input.Capability["deliveryMode"]), Title: capabilityString(input.Capability["title"]), Description: capabilityString(input.Capability["description"]), CloudAPIID: apiID, Capability: input.Capability, Validation: validation, Operations: reviews, CreationIdempotencyKey: key, LastIdempotencyKey: key, CreatedAt: now, UpdatedAt: now}
	if err := s.persistCloudSyncedDraft(ctx, value, nil); err != nil {
		return APIDraft{}, err
	}
	return value, nil
}

type CapabilityValidationError struct{ Issues []ValidationIssue }

func (e *CapabilityValidationError) Error() string { return "Capability Form validation failed" }

func (s *Service) ListAPIDrafts() []APIDraft {
	return s.ListAPIDraftsContext(context.Background())
}

func (s *Service) ListAPIDraftsContext(ctx context.Context) []APIDraft {
	values := s.store.APIDrafts()
	for index := range values {
		values[index] = sanitizedPricingDraft(values[index])
		for operationID, review := range values[index].Operations {
			if review.OperationalState != "live" && review.OperationalState != "draining" {
				continue
			}
			path := "/v4/provider/apis/" + url.PathEscape(values[index].APIID) + "/operations/" + url.PathEscape(operationID) + "/operational-status"
			var status cloudOperationStatusResponse
			if err := s.cloud.JSON(ctx, http.MethodGet, path, nil, &status); err == nil {
				applyCloudOperationStatus(&review, status)
				values[index].Operations[operationID] = review
			}
		}
	}
	sort.Slice(values, func(i, j int) bool { return values[i].UpdatedAt.After(values[j].UpdatedAt) })
	return values
}

func (s *Service) GetAPIDraft(id string) (APIDraft, bool) {
	value, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, false
	}
	return sanitizedPricingDraft(value), true
}

func sanitizedPricingDraft(value APIDraft) APIDraft {
	for operationID, review := range value.Operations {
		operation := operationFromCapability(value.Capability, operationID)
		invalid := false
		if len(review.Pricing) > 0 {
			pricing, err := cloneCapability(review.Pricing)
			if _, normalizeErr := normalizeOperationPricingV4(value.APIID, operationID, review.OperationHash, pricing, operation, review.ConnectivityReceipt, "confirmed"); err != nil || normalizeErr != nil {
				invalid = true
			} else {
				review.Pricing = pricing
			}
		}
		if len(review.PricingDraft) > 0 && capabilityString(review.PricingDraft["schemaVersion"]) != "exora.operation-pricing.v4" {
			invalid = true
		}
		if invalid {
			review.PricingDraft, review.Pricing, review.BillingPlan, review.BillingRun, review.PricingBillingReceipt = nil, nil, nil, nil, nil
			review.PricingLockedAt = nil
			review.PricingReview = "empty"
			if review.IntegrationStatus == "locked" {
				review.PricingStatus = "editable"
			} else {
				review.PricingStatus = "blocked"
			}
		}
		value.Operations[operationID] = review
	}
	return value
}

func (s *Service) DeleteAPIDraft(id string, input DeleteAPIDraftInput) error {
	return s.DeleteAPIDraftContext(context.Background(), id, input)
}

func (s *Service) DeleteAPIDraftContext(ctx context.Context, id string, input DeleteAPIDraftInput) error {
	if s == nil || s.store == nil {
		return errors.New("provider API draft service unavailable")
	}
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	value, ok := s.store.APIDraft(id)
	if !ok {
		return errors.New("API draft not found")
	}
	if value.Status == "live" || value.Status == "draining" || hasActiveOperation(value) {
		return errors.New("a live or draining API cannot be deleted as a draft")
	}
	if input.ExpectedVersion != value.Version {
		return errors.New("API draft version conflict")
	}
	path := "/v4/provider/api-drafts/" + url.PathEscape(value.APIID)
	if err := s.cloud.JSON(ctx, http.MethodDelete, path, map[string]any{"expectedVersion": value.Version}, nil); err != nil {
		return err
	}
	if err := s.store.DeleteAPIDraft(id); err != nil {
		_ = s.syncCloudDraft(context.Background(), http.MethodPost, value, 0)
		return err
	}
	if s.endpointStore != nil {
		s.endpointStore.Delete(v4TunnelEndpointID(value.APIID))
		s.notifyTunnelEndpoint()
	}
	return nil
}

func cloneCapability(value map[string]any) (map[string]any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var cloned map[string]any
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return nil, err
	}
	return cloned, nil
}

func (s *Service) UpdateCapability(id string, input UpdateCapabilityInput) (APIDraft, error) {
	return s.UpdateCapabilityContext(context.Background(), id, input)
}

func (s *Service) UpdateCapabilityContext(ctx context.Context, id string, input UpdateCapabilityInput) (APIDraft, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	value, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	if value.Status == "live" || value.Status == "draining" || hasActiveOperation(value) {
		return APIDraft{}, errors.New("a live or draining API must be offline before its Capability Form can change")
	}
	if hasLockedIntegration(value) && !input.ReplaceLockedIntegration {
		return APIDraft{}, errors.New("unlock every locked Integration before replacing the Capability Form")
	}
	if input.ExpectedVersion != value.Version {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	previous, err := cloneAPIDraft(value)
	if err != nil {
		return APIDraft{}, err
	}
	capability, err := cloneCapability(input.Capability)
	if err != nil {
		return APIDraft{}, err
	}
	validation := validateCapability(capability)
	if validation.Status != "passed" {
		return APIDraft{APIID: value.APIID, Validation: validation}, &CapabilityValidationError{Issues: validation.Issues}
	}
	reviews := newOperationReviews(value.APIID, capability, validation)
	value.Title = capabilityString(capability["title"])
	value.Description = capabilityString(capability["description"])
	value.DeliveryMode = capabilityString(capability["deliveryMode"])
	value.Capability = capability
	value.Validation = validation
	value.Operations = reviews
	value.Status = "review_required"
	value.CloudAPIID = value.APIID
	value.Version++
	value.UpdatedAt = time.Now().UTC()
	if err := s.persistCloudSyncedDraft(ctx, value, &previous); err != nil {
		return APIDraft{}, err
	}
	return value, nil
}

func (s *Service) UpdateOperation(id, operationID string, input UpdateOperationInput) (APIDraft, error) {
	return s.UpdateOperationContext(context.Background(), id, operationID, input)
}

func (s *Service) UpdateOperationContext(ctx context.Context, id, operationID string, input UpdateOperationInput) (APIDraft, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	value, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	if value.Status == "live" {
		return APIDraft{}, errors.New("a live API requires a new revision before its Operations can change")
	}
	if input.ExpectedVersion != value.Version {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	previous, err := cloneAPIDraft(value)
	if err != nil {
		return APIDraft{}, err
	}
	review, found := value.Operations[operationID]
	if !found {
		return APIDraft{}, fmt.Errorf("unknown operationId %q", operationID)
	}
	if review.IntegrationStatus == "locked" {
		return APIDraft{}, errors.New("unlock Integration validation before editing this Operation")
	}
	if capabilityString(input.Operation["operationId"]) != operationID {
		return APIDraft{}, errors.New("Operation operationId must match the edited row")
	}
	capability, err := cloneCapability(value.Capability)
	if err != nil {
		return APIDraft{}, err
	}
	operations := sliceValue(capability["operations"])
	replaced := false
	for index, raw := range operations {
		if capabilityString(mapValue(raw)["operationId"]) == operationID {
			operation, err := cloneCapability(input.Operation)
			if err != nil {
				return APIDraft{}, err
			}
			operations[index] = operation
			replaced = true
			break
		}
	}
	if !replaced {
		return APIDraft{}, fmt.Errorf("unknown operationId %q", operationID)
	}
	capability["operations"] = operations
	validation := validateCapability(capability)
	if validation.Status != "passed" {
		return APIDraft{APIID: value.APIID, Validation: validation}, &CapabilityValidationError{Issues: validation.Issues}
	}
	review.OperationHash = validation.OperationHash[operationID]
	review.ValidationPlan, _ = compileValidationPlan(value.APIID, capability, operationFromCapability(capability, operationID), review.OperationHash)
	review.ValidationRun = nil
	review.IntegrationStatus = "editable"
	review.PricingStatus = "blocked"
	review.CapabilityReview = "pending"
	review.PricingReview = "empty"
	review.Qualification = "pending"
	review.Pricing = nil
	review.QualificationReceipt = nil
	review.ConnectivityReceipt = nil
	review.PricingDraft = nil
	review.BillingPlan = nil
	review.BillingRun = nil
	review.PricingBillingReceipt = nil
	review.IntegrationLockedAt = nil
	review.PricingLockedAt = nil
	review.ConfirmedAt = nil
	value.Capability = capability
	value.Validation = validation
	value.Operations[operationID] = review
	refreshAPIDraftLifecycleStatus(&value)
	value.Status = "review_required"
	value.Version++
	value.UpdatedAt = time.Now().UTC()
	if err := s.persistCloudSyncedDraft(ctx, value, &previous); err != nil {
		return APIDraft{}, err
	}
	return value, nil
}

func operationFromCapability(capability map[string]any, operationID string) map[string]any {
	for _, raw := range sliceValue(capability["operations"]) {
		operation := mapValue(raw)
		if capabilityString(operation["operationId"]) == operationID {
			return operation
		}
	}
	return nil
}

func pricingInteger(value any) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), typed >= 0
	case int64:
		return typed, typed >= 0
	case float64:
		return int64(typed), typed >= 0 && math.Trunc(typed) == typed && typed <= math.MaxInt64
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil && parsed >= 0
	default:
		return 0, false
	}
}

func operationMeteringDimensions(operation map[string]any) map[string]bool {
	dimensions := map[string]bool{}
	for _, raw := range sliceValue(mapValue(operation["metering"])["capabilities"]) {
		dimension := ""
		if text, ok := raw.(string); ok {
			dimension = strings.TrimSpace(text)
		} else {
			dimension = capabilityString(mapValue(raw)["dimension"])
		}
		if dimension != "" {
			dimensions[dimension] = true
		}
	}
	return dimensions
}

func operationMeteringUnits(operation map[string]any) map[string]string {
	units := map[string]string{}
	standard := map[string]string{
		"request": "request", "successful_request": "request", "input_tokens": "token", "output_tokens": "token",
		"input_bytes": "byte", "output_bytes": "byte", "execution_second": "second", "page": "page", "image": "image",
		"audio_second": "second", "record": "record", "item": "item", "batch": "batch",
	}
	for _, raw := range sliceValue(mapValue(operation["metering"])["capabilities"]) {
		dimension, unit := "", ""
		if text, ok := raw.(string); ok {
			dimension = strings.TrimSpace(text)
		} else {
			capability := mapValue(raw)
			dimension, unit = capabilityString(capability["dimension"]), capabilityString(capability["unit"])
		}
		if dimension != "" {
			if unit == "" {
				unit = standard[dimension]
			}
			if unit == "" {
				unit = dimension
			}
			units[dimension] = unit
		}
	}
	return units
}

func verifiedPricingDimensions(receipt map[string]any) map[string]bool {
	dimensions := map[string]bool{}
	for _, raw := range sliceValue(receipt["verifiedDimensions"]) {
		dimension := capabilityString(raw)
		if dimension != "" {
			dimensions[dimension] = true
		}
	}
	return dimensions
}

func pricingSampleUsage(receipt map[string]any, variables []string) map[string]int64 {
	usage := map[string]int64{}
	raw := mapValue(receipt["sampleUsage"])
	for _, variable := range variables {
		if value, ok := pricingInteger(raw[variable]); ok {
			usage[variable] = value
		} else {
			usage[variable] = 0
		}
	}
	return usage
}

func normalizeOperationPricing(apiID, operationID, operationHash string, pricing, operation, receipt map[string]any, requiredStatus string) error {
	_, err := normalizeOperationPricingV4(apiID, operationID, operationHash, pricing, operation, receipt, requiredStatus)
	return err
}

func (s *Service) RecordQualification(id, operationID string, input QualificationInput) (APIDraft, error) {
	return s.updateOperationReview(id, operationID, input.ExpectedVersion, input.OperationHash, func(review *OperationReview, draft APIDraft) error {
		if strings.TrimSpace(input.RuntimeHash) == "" || strings.TrimSpace(input.ReceiptID) == "" {
			return errors.New("runtimeSha256 and receiptId are required")
		}
		// A fresh test receipt supersedes all owner decisions and prices derived
		// from the previous evidence, even when the Operation hash is unchanged.
		review.CapabilityReview = "pending"
		review.PricingReview = "empty"
		review.Pricing = nil
		review.ConfirmedAt = nil
		if input.Passed {
			review.Qualification = "passed"
		} else {
			review.Qualification = "failed"
		}
		verified := make([]any, 0, len(input.VerifiedDimensions))
		seen := map[string]bool{}
		operation := operationFromCapability(draft.Capability, operationID)
		declared := operationMeteringDimensions(operation)
		declaredUnits := operationMeteringUnits(operation)
		for _, dimension := range input.VerifiedDimensions {
			dimension = strings.TrimSpace(dimension)
			if dimension != "" && declared[dimension] && !seen[dimension] {
				verified = append(verified, dimension)
				seen[dimension] = true
			}
		}
		sample := map[string]any{}
		units := map[string]any{}
		for dimension, quantity := range input.SampleUsage {
			if quantity >= 0 && seen[dimension] {
				sample[dimension] = quantity
			}
		}
		for dimension := range seen {
			unit := strings.TrimSpace(input.DimensionUnits[dimension])
			if unit == "" {
				unit = declaredUnits[dimension]
			}
			units[dimension] = unit
		}
		review.QualificationReceipt = map[string]any{"receiptId": input.ReceiptID, "operationId": operationID, "operationSha256": input.OperationHash, "runtimeSha256": input.RuntimeHash, "passed": input.Passed, "verifiedDimensions": verified, "dimensionUnits": units, "sampleUsage": sample}
		return nil
	})
}

func (s *Service) updateOperationReview(id, operationID string, expectedVersion int64, operationHash string, update func(*OperationReview, APIDraft) error) (APIDraft, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	value, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	if expectedVersion != value.Version {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	review, ok := value.Operations[operationID]
	if !ok {
		return APIDraft{}, fmt.Errorf("unknown operationId %q", operationID)
	}
	if strings.TrimSpace(operationHash) == "" || operationHash != review.OperationHash {
		return APIDraft{}, errors.New("operationSha256 does not match the current Operation")
	}
	previous, err := cloneAPIDraft(value)
	if err != nil {
		return APIDraft{}, err
	}
	if err := update(&review, value); err != nil {
		return APIDraft{}, err
	}
	value.Operations[operationID] = review
	refreshAPIDraftLifecycleStatus(&value)
	value.Version++
	value.UpdatedAt = time.Now().UTC()
	if err := s.persistCloudSyncedDraft(context.Background(), value, &previous); err != nil {
		return APIDraft{}, err
	}
	return value, nil
}

func (s *Service) publishAPIDraftLegacy(ctx context.Context, id string, expectedVersion int64) (APIDraft, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	value, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	if value.Version != expectedVersion {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	enabled := 0
	receipts := []map[string]any{}
	for operationID, review := range value.Operations {
		if !review.Enabled {
			continue
		}
		enabled++
		if review.CapabilityReview != "confirmed" || review.PricingReview != "confirmed" || review.Qualification != "passed" || len(review.Pricing) == 0 || len(review.QualificationReceipt) == 0 {
			return APIDraft{}, fmt.Errorf("Operation %s has not completed capability, pricing, qualification and rights review", review.OperationID)
		}
		pricing, err := cloneCapability(review.Pricing)
		if err != nil {
			return APIDraft{}, err
		}
		if err := normalizeOperationPricing(value.APIID, review.OperationID, review.OperationHash, pricing, operationFromCapability(value.Capability, review.OperationID), review.QualificationReceipt, "confirmed"); err != nil {
			return APIDraft{}, fmt.Errorf("Operation %s pricing is not current formula pricing: %w", review.OperationID, err)
		}
		review.Pricing = pricing
		value.Operations[operationID] = review
		receipts = append(receipts, review.QualificationReceipt)
	}
	if enabled == 0 {
		return APIDraft{}, errors.New("at least one enabled Operation is required")
	}
	cloudID := strings.TrimSpace(value.CloudAPIID)
	if cloudID == "" {
		return APIDraft{}, errors.New("Cloud API draft is not synchronized")
	}
	if cloudID != value.APIID {
		return APIDraft{}, fmt.Errorf("Cloud API id %q does not match stable API id %q", cloudID, value.APIID)
	}
	var promoted struct {
		API struct {
			APIID string `json:"apiId"`
		} `json:"api"`
	}
	createPayload, err := cloneCapability(value.Capability)
	if err != nil {
		return APIDraft{}, err
	}
	createPayload["apiId"] = value.APIID
	createPayload["draftVersion"] = value.Version
	if err := s.cloud.JSON(ctx, http.MethodPost, "/v4/provider/apis", createPayload, &promoted); err != nil {
		return APIDraft{}, err
	}
	promotedID := strings.TrimSpace(promoted.API.APIID)
	if promotedID != value.APIID {
		return APIDraft{}, fmt.Errorf("Cloud returned API id %q, expected stable API id %q", promotedID, value.APIID)
	}
	for _, review := range value.Operations {
		if !review.Enabled {
			continue
		}
		path := "/v4/provider/apis/" + cloudID + "/operations/" + review.OperationID
		if err := s.cloud.JSON(ctx, http.MethodPost, path+"/confirm-capability", map[string]any{"operationSha256": review.OperationHash, "rightsConfirmed": true}, nil); err != nil {
			return APIDraft{}, err
		}
		if err := s.cloud.JSON(ctx, http.MethodPost, path+"/confirm-pricing", review.Pricing, nil); err != nil {
			return APIDraft{}, err
		}
	}
	runtime := map[string]any{}
	for key, item := range mapValue(value.Capability["runtime"]) {
		runtime[key] = item
	}
	runtime["healthStatus"] = "healthy"
	base := "/v4/provider/apis/" + cloudID
	if err := s.cloud.JSON(ctx, http.MethodPut, base+"/runtime", runtime, nil); err != nil {
		return APIDraft{}, err
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, base+"/validate", map[string]any{"qualificationReceipts": receipts}, nil); err != nil {
		return APIDraft{}, err
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, base+"/publish", map[string]any{}, nil); err != nil {
		return APIDraft{}, err
	}
	value.CloudAPIID, value.Status, value.Version, value.UpdatedAt = cloudID, "live", value.Version+1, time.Now().UTC()
	if err := s.store.SaveAPIDraft(value); err != nil {
		return APIDraft{}, err
	}
	return value, nil
}

func (s *Service) QualifyOperation(ctx context.Context, id, operationID string, expectedVersion int64, operationHash string) (APIDraft, error) {
	value, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	if value.Version != expectedVersion {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	review, ok := value.Operations[operationID]
	if !ok || review.OperationHash != operationHash {
		return APIDraft{}, errors.New("operationSha256 does not match the current Operation")
	}
	runtime := mapValue(value.Capability["runtime"])
	base, err := url.Parse(capabilityString(runtime["publicBaseUrl"]))
	if err != nil || base.Hostname() == "" {
		return APIDraft{}, errors.New("Runtime publicBaseUrl is required for qualification")
	}
	if value.DeliveryMode == "cloud_direct" && base.Scheme != "https" {
		return APIDraft{}, errors.New("Cloud API qualification requires HTTPS")
	}
	if value.DeliveryMode == "local_dock" {
		ip := net.ParseIP(base.Hostname())
		if base.Scheme != "http" || ip == nil || !ip.IsLoopback() {
			return APIDraft{}, errors.New("Local API qualification requires a loopback HTTP publicBaseUrl")
		}
	}
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	healthURL, _ := base.Parse(capabilityString(runtime["healthPath"]))
	healthRequest, _ := http.NewRequestWithContext(ctx, http.MethodGet, healthURL.String(), nil)
	healthResponse, err := client.Do(healthRequest)
	if err != nil {
		return APIDraft{}, fmt.Errorf("Runtime Health failed: %w", err)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(healthResponse.Body, 64<<10))
	healthResponse.Body.Close()
	if healthResponse.StatusCode < 200 || healthResponse.StatusCode >= 300 {
		return APIDraft{}, fmt.Errorf("Runtime Health returned HTTP %d", healthResponse.StatusCode)
	}
	var operation map[string]any
	for _, raw := range sliceValue(value.Capability["operations"]) {
		candidate := mapValue(raw)
		if capabilityString(candidate["operationId"]) == operationID {
			operation = candidate
			break
		}
	}
	examples := sliceValue(mapValue(operation["usage"])["examples"])
	if len(examples) == 0 {
		return APIDraft{}, errors.New("a safe success example is required")
	}
	example := mapValue(examples[0])
	body, _ := json.Marshal(example["request"])
	contract := mapValue(operation["api"])
	target, _ := base.Parse(capabilityString(contract["path"]))
	smokeRequest, err := http.NewRequestWithContext(ctx, capabilityString(contract["method"]), target.String(), bytes.NewReader(body))
	if err != nil {
		return APIDraft{}, err
	}
	smokeRequest.Header.Set("Content-Type", "application/json")
	sideEffect := mapValue(mapValue(operation["behavior"])["sideEffect"])
	if sideEffect["present"] == true {
		smokeRequest.Header.Set("X-Exora-Test-Mode", capabilityString(sideEffect["testMode"]))
	}
	smokeStarted := time.Now()
	smokeResponse, err := client.Do(smokeRequest)
	if err != nil {
		return APIDraft{}, fmt.Errorf("Operation Smoke Test failed: %w", err)
	}
	responseBody, _ := io.ReadAll(io.LimitReader(smokeResponse.Body, 8<<20))
	smokeResponse.Body.Close()
	if smokeResponse.StatusCode < 200 || smokeResponse.StatusCode >= 300 {
		return APIDraft{}, fmt.Errorf("Operation Smoke Test returned HTTP %d", smokeResponse.StatusCode)
	}
	runtimeHash := hashJSON(runtime)
	receiptID := "qual_" + hashJSON(map[string]any{"apiId": id, "operationId": operationID, "operationSha256": operationHash, "runtimeSha256": runtimeHash, "checkedAt": time.Now().UTC()})[:24]
	declaredDimensions := operationMeteringDimensions(operation)
	sampleUsage := map[string]int64{}
	builtInUsage := map[string]int64{
		"request": 1, "successful_request": 1, "input_bytes": int64(len(body)), "output_bytes": int64(len(responseBody)),
		"execution_second": int64(math.Max(1, math.Ceil(time.Since(smokeStarted).Seconds()))),
	}
	for dimension, quantity := range builtInUsage {
		if declaredDimensions[dimension] {
			sampleUsage[dimension] = quantity
		}
	}
	if encoded := strings.TrimSpace(smokeResponse.Header.Get("X-Exora-Usage")); encoded != "" {
		var reported map[string]any
		if json.Unmarshal([]byte(encoded), &reported) == nil {
			for dimension, raw := range reported {
				if quantity, ok := pricingInteger(raw); ok && declaredDimensions[dimension] {
					sampleUsage[dimension] = quantity
				}
			}
		}
	}
	verifiedDimensions := make([]string, 0, len(sampleUsage))
	dimensionUnits := map[string]string{}
	declaredUnits := operationMeteringUnits(operation)
	for dimension := range sampleUsage {
		verifiedDimensions = append(verifiedDimensions, dimension)
		dimensionUnits[dimension] = declaredUnits[dimension]
	}
	sort.Strings(verifiedDimensions)
	return s.RecordQualification(id, operationID, QualificationInput{ExpectedVersion: expectedVersion, OperationHash: operationHash, RuntimeHash: runtimeHash, ReceiptID: receiptID, Passed: true, VerifiedDimensions: verifiedDimensions, DimensionUnits: dimensionUnits, SampleUsage: sampleUsage})
}
