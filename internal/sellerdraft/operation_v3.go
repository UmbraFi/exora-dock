package sellerdraft

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	jsonschema "github.com/santhosh-tekuri/jsonschema/v6"
)

const (
	validationPlanVersion    = "exora.operation-validation-plan.v3"
	validationReceiptVersion = "exora.operation-validation-receipt.v3"
	billingPlanVersion       = "exora.operation-billing-plan.v4"
	billingReceiptVersion    = "exora.operation-billing-receipt.v4"
)

func escapeJSONPointer(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, "~", "~0"), "/", "~1")
}

func resolveJSONPointer(document any, pointer string) (any, error) {
	if pointer == "#" || pointer == "" {
		return document, nil
	}
	if !strings.HasPrefix(pointer, "#/") {
		return nil, fmt.Errorf("JSON Pointer %q must be document-local", pointer)
	}
	current := document
	for _, token := range strings.Split(strings.TrimPrefix(pointer, "#/"), "/") {
		token = strings.ReplaceAll(strings.ReplaceAll(token, "~1", "/"), "~0", "~")
		switch typed := current.(type) {
		case map[string]any:
			var ok bool
			current, ok = typed[token]
			if !ok {
				return nil, fmt.Errorf("JSON Pointer %q does not exist", pointer)
			}
		case []any:
			index, err := strconv.Atoi(token)
			if err != nil || index < 0 || index >= len(typed) {
				return nil, fmt.Errorf("JSON Pointer %q does not exist", pointer)
			}
			current = typed[index]
		default:
			return nil, fmt.Errorf("JSON Pointer %q crosses a scalar value", pointer)
		}
	}
	return current, nil
}

func operationOpenAPIRef(operation map[string]any) string {
	return capabilityString(mapValue(operation["api"])["openapiOperationRef"])
}

func compileValidationPlan(apiID string, capability, operation map[string]any, operationHash string) (map[string]any, error) {
	if len(operation) == 0 {
		return nil, errors.New("Operation is missing")
	}
	openapi := mapValue(capability["interface"])
	operationRef := operationOpenAPIRef(operation)
	resolved, err := resolveJSONPointer(openapi, operationRef)
	if err != nil || len(mapValue(resolved)) == 0 {
		return nil, fmt.Errorf("openapiOperationRef is invalid: %w", err)
	}
	checks := []any{
		map[string]any{"id": "runtime_health", "category": "contract", "type": "health"},
		map[string]any{"id": "request_schema", "category": "contract", "type": "json_schema_2020_12", "openapiOperationRef": operationRef},
	}
	fixtures := sliceValue(mapValue(operation["qualification"])["fixtures"])
	for _, raw := range fixtures {
		fixture := mapValue(raw)
		protocol := mapValue(fixture["expectedProtocol"])
		responseRef := capabilityString(protocol["openapiResponseRef"])
		response, responseErr := resolveJSONPointer(openapi, responseRef)
		if responseErr != nil || len(mapValue(response)) == 0 {
			return nil, fmt.Errorf("fixture %s has invalid openapiResponseRef: %w", capabilityString(fixture["id"]), responseErr)
		}
		checks = append(checks, map[string]any{
			"id": "seller_case:" + capabilityString(fixture["id"]), "category": "seller_case", "type": capabilityString(fixture["kind"]),
			"status": protocol["status"], "mediaType": protocol["mediaType"], "openapiResponseRef": responseRef,
		})
	}
	interaction := mapValue(operation["interaction"])
	checks = append(checks, map[string]any{"id": "protocol:" + capabilityString(interaction["mode"]), "category": "protocol", "type": capabilityString(interaction["mode"])})
	for _, raw := range sliceValue(mapValue(operation["metering"])["capabilities"]) {
		meter := mapValue(raw)
		checks = append(checks, map[string]any{"id": "metering:" + capabilityString(meter["dimension"]), "category": "metering", "type": capabilityString(meter["source"]), "unit": meter["unit"], "maximumPerInvocation": meter["maximumPerInvocation"]})
	}
	faults := []string{"connection_failure", "timeout", "invalid_schema"}
	if capabilityString(interaction["mode"]) == "server_stream" {
		faults = append(faults, "stream_interruption")
	}
	if len(sliceValue(mapValue(operation["artifacts"])["outputs"])) > 0 {
		faults = append(faults, "artifact_corruption")
	}
	for _, fault := range faults {
		checks = append(checks, map[string]any{"id": "platform_fault:" + fault, "category": "platform_fault", "type": fault})
	}
	plan := map[string]any{
		"schemaVersion": validationPlanVersion, "apiId": apiID, "operationId": capabilityString(operation["operationId"]),
		"operationSha256": operationHash, "openapiSha256": hashJSON(openapi), "checks": checks,
	}
	plan["planSha256"] = hashJSON(plan)
	return plan, nil
}

func validateAgainstOpenAPISchema(openapi map[string]any, schemaPointer string, value any) error {
	compiler := jsonschema.NewCompiler()
	compiler.AssertFormat()
	if err := compiler.AddResource("https://exora.local/openapi.json", openapi); err != nil {
		return err
	}
	schema, err := compiler.Compile("https://exora.local/openapi.json" + schemaPointer)
	if err != nil {
		return err
	}
	return schema.Validate(value)
}

func openAPISchemaPointer(baseRef, mediaType string) string {
	return baseRef + "/content/" + escapeJSONPointer(mediaType) + "/schema"
}

func boundedRedactedSummary(value any) string {
	var redact func(any) any
	redact = func(candidate any) any {
		switch typed := candidate.(type) {
		case map[string]any:
			out := map[string]any{}
			for key, child := range typed {
				lower := strings.ToLower(key)
				if strings.Contains(lower, "token") || strings.Contains(lower, "secret") || strings.Contains(lower, "password") || strings.Contains(lower, "authorization") || strings.Contains(lower, "credential") {
					out[key] = "[REDACTED]"
				} else {
					out[key] = redact(child)
				}
			}
			return out
		case []any:
			out := make([]any, len(typed))
			for index, child := range typed {
				out[index] = redact(child)
			}
			return out
		default:
			return candidate
		}
	}
	raw, _ := json.Marshal(redact(value))
	if len(raw) > 4096 {
		raw = raw[:4096]
	}
	return string(raw)
}

func extractPointerInteger(document any, pointer string) (int64, bool) {
	value, err := resolveJSONPointer(document, "#"+pointer)
	if err != nil {
		return 0, false
	}
	return pricingInteger(value)
}

func extractPointerValue(document any, pointer string) (any, bool) {
	value, err := resolveJSONPointer(document, "#"+pointer)
	return value, err == nil
}

func validateInlineSchema(schema map[string]any, value any) error {
	compiler := jsonschema.NewCompiler()
	compiler.AssertFormat()
	if err := compiler.AddResource("https://exora.local/inline-schema.json", schema); err != nil {
		return err
	}
	compiled, err := compiler.Compile("https://exora.local/inline-schema.json")
	if err != nil {
		return err
	}
	return compiled.Validate(value)
}

func validateSSEPayload(body []byte, interaction map[string]any) (any, error) {
	eventSchema := mapValue(interaction["eventSchema"])
	completion, failure := capabilityString(interaction["completionEvent"]), capabilityString(interaction["errorEvent"])
	sequencePointer := capabilityString(interaction["sequencePointer"])
	completed, previousSequence := false, int64(-1)
	var last any
	for _, block := range strings.Split(strings.ReplaceAll(string(body), "\r\n", "\n"), "\n\n") {
		eventName, dataLines := "message", []string{}
		for _, line := range strings.Split(block, "\n") {
			if strings.HasPrefix(line, "event:") {
				eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			}
			if strings.HasPrefix(line, "data:") {
				dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			}
		}
		if len(dataLines) == 0 {
			continue
		}
		var document any
		if err := json.Unmarshal([]byte(strings.Join(dataLines, "\n")), &document); err != nil {
			return nil, fmt.Errorf("SSE event %s contains invalid JSON: %w", eventName, err)
		}
		if err := validateInlineSchema(eventSchema, document); err != nil {
			return nil, fmt.Errorf("SSE event %s violates eventSchema: %w", eventName, err)
		}
		if sequencePointer != "" {
			sequence, ok := extractPointerInteger(document, sequencePointer)
			if !ok || sequence <= previousSequence {
				return nil, errors.New("SSE event sequence is missing or not strictly increasing")
			}
			previousSequence = sequence
		}
		if eventName == failure {
			return nil, errors.New("SSE emitted its declared error event")
		}
		if eventName == completion {
			completed = true
		}
		last = document
	}
	if !completed {
		return nil, errors.New("SSE ended without its declared completion event")
	}
	return last, nil
}

func validateAsyncFlow(ctx context.Context, client *http.Client, base *url.URL, interaction map[string]any, initial any, cancelCase bool) (any, error) {
	jobValue, ok := extractPointerValue(initial, capabilityString(interaction["jobIdPointer"]))
	jobID := capabilityString(jobValue)
	if !ok || jobID == "" {
		return nil, errors.New("Async response is missing the declared Job ID")
	}
	if cancelCase {
		cancelPath := strings.ReplaceAll(capabilityString(interaction["cancelPath"]), "{jobId}", url.PathEscape(jobID))
		if cancelPath == "" {
			return nil, errors.New("Async cancellation fixture requires cancelPath")
		}
		target, _ := base.Parse(cancelPath)
		request, _ := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), nil)
		response, err := client.Do(request)
		if err != nil {
			return nil, fmt.Errorf("Async cancellation failed: %w", err)
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
		response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, fmt.Errorf("Async cancellation returned HTTP %d", response.StatusCode)
		}
		return initial, nil
	}
	terminal := map[string]bool{}
	for _, state := range sliceValue(interaction["terminalStates"]) {
		terminal[capabilityString(state)] = true
	}
	maximumWait, _ := pricingInteger(interaction["maximumWaitSeconds"])
	deadline := time.Now().Add(time.Duration(maximumWait) * time.Second)
	current := initial
	for {
		statusValue, statusOK := extractPointerValue(current, capabilityString(interaction["statusPointer"]))
		if statusOK && terminal[capabilityString(statusValue)] {
			return current, nil
		}
		if time.Now().After(deadline) {
			return nil, errors.New("Async Job exceeded maximumWaitSeconds")
		}
		pollPath := strings.ReplaceAll(capabilityString(interaction["pollPath"]), "{jobId}", url.PathEscape(jobID))
		target, _ := base.Parse(pollPath)
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
		response, err := client.Do(request)
		if err != nil {
			return nil, fmt.Errorf("Async poll failed: %w", err)
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		response.Body.Close()
		if readErr != nil || response.StatusCode < 200 || response.StatusCode >= 300 || json.Unmarshal(body, &current) != nil {
			return nil, errors.New("Async poll returned an invalid response")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func validateArtifactMetadata(document any, operation map[string]any) error {
	for _, raw := range sliceValue(mapValue(operation["artifacts"])["outputs"]) {
		declaration := mapValue(raw)
		value, ok := extractPointerValue(document, capabilityString(declaration["artifactField"]))
		artifact := mapValue(value)
		if !ok || len(artifact) == 0 {
			return fmt.Errorf("Artifact %s is missing", capabilityString(declaration["name"]))
		}
		size, sizeOK := pricingInteger(artifact["sizeBytes"])
		maximum, _ := pricingInteger(declaration["maximumBytes"])
		mimeType, digest := capabilityString(artifact["mimeType"]), capabilityString(artifact["sha256"])
		allowedMIME := false
		for _, rawMIME := range sliceValue(declaration["mimeTypes"]) {
			allowedMIME = allowedMIME || capabilityString(rawMIME) == mimeType
		}
		if !sizeOK || size > maximum || !allowedMIME || len(digest) != 64 {
			return fmt.Errorf("Artifact %s metadata violates its declaration", capabilityString(declaration["name"]))
		}
	}
	return nil
}

type validationRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn validationRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func runPlatformFaultChecks(operation map[string]any) ([]any, error) {
	checks := []any{}
	connectionClient := &http.Client{Transport: validationRoundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("injected connection failure") })}
	connectionRequest, _ := http.NewRequest(http.MethodGet, "http://exora.invalid/", nil)
	if _, err := connectionClient.Do(connectionRequest); err == nil {
		return nil, errors.New("controlled validator did not detect an injected connection failure")
	}
	checks = append(checks, map[string]any{"id": "platform_fault:connection_failure", "passed": true, "injectedBy": "dock_controlled_transport"})

	timeoutContext, cancel := context.WithCancel(context.Background())
	cancel()
	timeoutClient := &http.Client{Transport: validationRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})}
	timeoutRequest, _ := http.NewRequestWithContext(timeoutContext, http.MethodGet, "http://exora.invalid/", nil)
	if _, err := timeoutClient.Do(timeoutRequest); err == nil {
		return nil, errors.New("controlled validator did not detect an injected timeout/cancellation")
	}
	checks = append(checks, map[string]any{"id": "platform_fault:timeout", "passed": true, "injectedBy": "dock_controlled_transport"})

	var malformed any
	if json.Unmarshal([]byte(`{"truncated":`), &malformed) == nil {
		return nil, errors.New("controlled validator accepted malformed JSON")
	}
	checks = append(checks, map[string]any{"id": "platform_fault:invalid_schema", "passed": true, "injectedBy": "dock_controlled_validator", "detail": "malformed JSON rejection verified"})

	interaction := mapValue(operation["interaction"])
	if capabilityString(interaction["mode"]) == "server_stream" {
		if _, err := validateSSEPayload([]byte("event: message\ndata: {}\n\n"), interaction); err == nil {
			return nil, errors.New("controlled validator accepted an interrupted SSE stream")
		}
		checks = append(checks, map[string]any{"id": "platform_fault:stream_interruption", "passed": true, "injectedBy": "dock_controlled_validator"})
	}
	if len(sliceValue(mapValue(operation["artifacts"])["outputs"])) > 0 {
		if err := validateArtifactMetadata(map[string]any{}, operation); err == nil {
			return nil, errors.New("controlled validator accepted corrupted Artifact metadata")
		}
		checks = append(checks, map[string]any{"id": "platform_fault:artifact_corruption", "passed": true, "injectedBy": "dock_controlled_validator"})
	}
	return checks, nil
}

func (s *Service) executeValidationV3(ctx context.Context, draft APIDraft, operationID string) (map[string]any, error) {
	operation := operationFromCapability(draft.Capability, operationID)
	review := draft.Operations[operationID]
	plan := review.ValidationPlan
	if capabilityString(plan["schemaVersion"]) != validationPlanVersion || capabilityString(plan["operationSha256"]) != review.OperationHash {
		return nil, errors.New("validation plan is missing or stale")
	}
	runtime := mapValue(draft.Capability["runtime"])
	base, err := url.Parse(capabilityString(runtime["publicBaseUrl"]))
	if err != nil || base.Hostname() == "" {
		return nil, errors.New("Runtime publicBaseUrl is required for validation")
	}
	if draft.DeliveryMode == "cloud_direct" && base.Scheme != "https" {
		return nil, errors.New("Cloud API validation requires HTTPS")
	}
	if draft.DeliveryMode == "local_dock" {
		ip := net.ParseIP(base.Hostname())
		if base.Scheme != "http" || ip == nil || !ip.IsLoopback() {
			return nil, errors.New("Local API validation requires a loopback HTTP publicBaseUrl")
		}
	}
	timeout, ok := pricingInteger(mapValue(operation["limits"])["timeoutSeconds"])
	if !ok || timeout < 1 || timeout > 86400 {
		timeout = 30
	}
	client := &http.Client{Timeout: time.Duration(timeout) * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	checks := []any{}
	healthURL, _ := base.Parse(capabilityString(runtime["healthPath"]))
	healthRequest, _ := http.NewRequestWithContext(ctx, http.MethodGet, healthURL.String(), nil)
	healthResponse, healthErr := client.Do(healthRequest)
	if healthErr != nil {
		return nil, fmt.Errorf("Runtime health failed: %w", healthErr)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(healthResponse.Body, 64<<10))
	healthResponse.Body.Close()
	if healthResponse.StatusCode < 200 || healthResponse.StatusCode >= 300 {
		return nil, fmt.Errorf("Runtime health returned HTTP %d", healthResponse.StatusCode)
	}
	checks = append(checks, map[string]any{"id": "runtime_health", "passed": true, "status": healthResponse.StatusCode})

	openapi := mapValue(draft.Capability["interface"])
	contract := mapValue(operation["api"])
	method, route := strings.ToUpper(capabilityString(contract["method"])), capabilityString(contract["path"])
	requestMedia := "application/json"
	requestSchemaPointer := operationOpenAPIRef(operation) + "/requestBody/content/" + escapeJSONPointer(requestMedia) + "/schema"
	fixtures := sliceValue(mapValue(operation["qualification"])["fixtures"])
	interaction := mapValue(operation["interaction"])
	interactionMode := capabilityString(interaction["mode"])
	declared := operationMeteringDimensions(operation)
	bounds := operationMeteringBounds(operation)
	units := operationMeteringUnits(operation)
	sampleUsage := map[string]int64{}
	verified := map[string]bool{}
	evidence := []any{}
	remainingEvidenceBytes := 4096
	for _, rawFixture := range fixtures {
		fixture := mapValue(rawFixture)
		requestSpec := mapValue(fixture["request"])
		requestBody := requestSpec["body"]
		if err := validateAgainstOpenAPISchema(openapi, requestSchemaPointer, requestBody); err != nil {
			return nil, fmt.Errorf("fixture %s request does not match OpenAPI: %w", capabilityString(fixture["id"]), err)
		}
		body, _ := json.Marshal(requestBody)
		target, _ := base.Parse(route)
		request, requestErr := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewReader(body))
		if requestErr != nil {
			return nil, requestErr
		}
		request.Header.Set("Content-Type", requestMedia)
		for key, value := range mapValue(requestSpec["headers"]) {
			lower := strings.ToLower(strings.TrimSpace(key))
			if lower == "authorization" || lower == "cookie" || lower == "proxy-authorization" || strings.Contains(lower, "token") || strings.Contains(lower, "secret") {
				return nil, fmt.Errorf("fixture %s contains a forbidden credential header", capabilityString(fixture["id"]))
			}
			request.Header.Set(key, capabilityString(value))
		}
		query := request.URL.Query()
		for key, value := range mapValue(requestSpec["query"]) {
			query.Set(key, capabilityString(value))
		}
		request.URL.RawQuery = query.Encode()
		sideEffect := mapValue(mapValue(operation["behavior"])["sideEffect"])
		if sideEffect["present"] == true {
			request.Header.Set("X-Exora-Test-Mode", capabilityString(sideEffect["testMode"]))
		}
		started := time.Now()
		response, callErr := client.Do(request)
		if callErr != nil {
			return nil, fmt.Errorf("fixture %s call failed: %w", capabilityString(fixture["id"]), callErr)
		}
		limit, _ := pricingInteger(mapValue(operation["limits"])["maximumResponseBytes"])
		if limit <= 0 {
			limit = 8 << 20
		}
		responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, limit+1))
		response.Body.Close()
		if readErr != nil || int64(len(responseBody)) > limit {
			return nil, fmt.Errorf("fixture %s response exceeds maximumResponseBytes", capabilityString(fixture["id"]))
		}
		protocol := mapValue(fixture["expectedProtocol"])
		expectedStatus, _ := pricingInteger(protocol["status"])
		mediaType := strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
		if int64(response.StatusCode) != expectedStatus {
			return nil, fmt.Errorf("fixture %s returned HTTP %d, expected %d", capabilityString(fixture["id"]), response.StatusCode, expectedStatus)
		}
		if !strings.EqualFold(mediaType, capabilityString(protocol["mediaType"])) {
			return nil, fmt.Errorf("fixture %s returned Content-Type %q", capabilityString(fixture["id"]), mediaType)
		}
		var responseDocument any
		if strings.Contains(strings.ToLower(mediaType), "json") {
			if err := json.Unmarshal(responseBody, &responseDocument); err != nil {
				return nil, fmt.Errorf("fixture %s returned invalid JSON: %w", capabilityString(fixture["id"]), err)
			}
			pointer := openAPISchemaPointer(capabilityString(protocol["openapiResponseRef"]), capabilityString(protocol["mediaType"]))
			if err := validateAgainstOpenAPISchema(openapi, pointer, responseDocument); err != nil {
				return nil, fmt.Errorf("fixture %s response format does not match OpenAPI: %w", capabilityString(fixture["id"]), err)
			}
		}
		if interactionMode == "server_stream" {
			responseDocument, err = validateSSEPayload(responseBody, interaction)
			if err != nil {
				return nil, fmt.Errorf("fixture %s stream protocol failed: %w", capabilityString(fixture["id"]), err)
			}
		}
		if interactionMode == "async_job" {
			responseDocument, err = validateAsyncFlow(ctx, client, base, interaction, responseDocument, capabilityString(fixture["kind"]) == "async_cancel")
			if err != nil {
				return nil, fmt.Errorf("fixture %s async protocol failed: %w", capabilityString(fixture["id"]), err)
			}
		}
		if capabilityString(fixture["kind"]) == "artifact" {
			if err := validateArtifactMetadata(responseDocument, operation); err != nil {
				return nil, fmt.Errorf("fixture %s Artifact protocol failed: %w", capabilityString(fixture["id"]), err)
			}
		}
		builtIn := map[string]int64{"request": 1, "successful_request": 0, "input_bytes": int64(len(body)), "output_bytes": int64(len(responseBody)), "execution_second": 1}
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			builtIn["successful_request"] = 1
		}
		for dimension, quantity := range builtIn {
			if declared[dimension] {
				sampleUsage[dimension], verified[dimension] = quantity, true
			}
		}
		if encoded := strings.TrimSpace(response.Header.Get("X-Exora-Usage")); encoded != "" {
			var reported map[string]any
			if json.Unmarshal([]byte(encoded), &reported) != nil {
				return nil, errors.New("X-Exora-Usage must be a JSON object")
			}
			for dimension, raw := range reported {
				quantity, quantityOK := pricingInteger(raw)
				if !declared[dimension] || !quantityOK || quantity < 0 || quantity > bounds[dimension] {
					return nil, fmt.Errorf("invalid metering evidence for %q", dimension)
				}
				sampleUsage[dimension], verified[dimension] = quantity, true
			}
		}
		for _, rawMeter := range sliceValue(mapValue(operation["metering"])["capabilities"]) {
			meter := mapValue(rawMeter)
			dimension := capabilityString(meter["dimension"])
			if capabilityString(meter["source"]) == "provider_attested" && responseDocument != nil {
				quantity, quantityOK := extractPointerInteger(responseDocument, capabilityString(meter["evidencePointer"]))
				if !quantityOK || quantity < 0 || quantity > bounds[dimension] {
					return nil, fmt.Errorf("provider-attested metering %q is missing or out of range", dimension)
				}
				sampleUsage[dimension], verified[dimension] = quantity, true
			}
		}
		checks = append(checks, map[string]any{"id": "seller_case:" + capabilityString(fixture["id"]), "passed": true, "status": response.StatusCode, "mediaType": mediaType, "durationMs": time.Since(started).Milliseconds(), "responseBytes": len(responseBody), "schemaValid": true, "bodySha256": hashJSON(responseDocument)})
		summary := boundedRedactedSummary(responseDocument)
		if len(summary) > remainingEvidenceBytes {
			summary = summary[:remainingEvidenceBytes]
		}
		remainingEvidenceBytes -= len(summary)
		evidence = append(evidence, map[string]any{"fixtureId": fixture["id"], "responseSummary": summary})
	}
	verifiedMeters := []any{}
	for _, rawMeter := range sliceValue(mapValue(operation["metering"])["capabilities"]) {
		meter := mapValue(rawMeter)
		dimension := capabilityString(meter["dimension"])
		if !verified[dimension] {
			return nil, fmt.Errorf("metering dimension %q was not evidenced by any seller fixture", dimension)
		}
		verifiedMeters = append(verifiedMeters, map[string]any{"dimension": dimension, "unit": units[dimension], "source": meter["source"], "evidencePointer": meter["evidencePointer"], "maximumPerInvocation": bounds[dimension]})
	}
	faultChecks, faultErr := runPlatformFaultChecks(operation)
	if faultErr != nil {
		return nil, faultErr
	}
	checks = append(checks, faultChecks...)
	now := time.Now().UTC()
	receipt := map[string]any{
		"schemaVersion": validationReceiptVersion, "receiptId": newID("val"), "apiId": draft.APIID, "operationId": operationID,
		"operationSha256": review.OperationHash, "openapiSha256": hashJSON(openapi), "planSha256": plan["planSha256"], "runtimeSha256": hashJSON(runtime),
		"passed": true, "checks": checks, "evidence": map[string]any{"items": evidence, "redacted": true, "maximumExcerptBytes": 4096},
		"verifiedMetering": verifiedMeters, "sampleUsage": sampleUsage, "testedAt": now.Format(time.RFC3339Nano),
	}
	return receipt, nil
}

func (s *Service) runIntegrationValidationV3(ctx context.Context, id, operationID string, expectedVersion int64, operationHash string) (APIDraft, error) {
	draft, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	if draft.Version != expectedVersion {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	review, ok := draft.Operations[operationID]
	if !ok || review.OperationHash != operationHash {
		return APIDraft{}, errors.New("operationSha256 does not match the current Operation")
	}
	receipt, err := s.executeValidationV3(ctx, draft, operationID)
	if err != nil {
		return APIDraft{}, err
	}
	return s.updateOperationReview(id, operationID, expectedVersion, operationHash, func(current *OperationReview, _ APIDraft) error {
		current.ConnectivityReceipt = receipt
		current.ValidationRun = map[string]any{"runId": newID("vrun"), "status": "passed", "planSha256": current.ValidationPlan["planSha256"], "startedAt": receipt["testedAt"], "completedAt": receipt["testedAt"]}
		current.IntegrationStatus = "awaiting_confirmation"
		current.PricingStatus, current.PricingDraft, current.Pricing, current.BillingPlan, current.BillingRun, current.PricingBillingReceipt = "blocked", nil, nil, nil, nil, nil
		current.IntegrationLockedAt, current.PricingLockedAt = nil, nil
		return nil
	})
}

func (s *Service) StartValidationRun(id, operationID string, input ValidationRunInput) (APIDraft, error) {
	if strings.TrimSpace(input.IdempotencyKey) == "" {
		return APIDraft{}, errors.New("idempotencyKey is required")
	}
	if existing, found := s.store.APIDraft(id); found {
		if review, ok := existing.Operations[operationID]; ok && capabilityString(review.ValidationRun["idempotencyKey"]) == input.IdempotencyKey {
			return existing, nil
		}
		if review, ok := existing.Operations[operationID]; ok && capabilityString(review.ValidationRun["status"]) == "running" {
			return APIDraft{}, errors.New("a validation run is already active for this Operation")
		}
	}
	runID := newID("vrun")
	startedAt := time.Now().UTC()
	started, err := s.updateOperationReview(id, operationID, input.ExpectedVersion, input.OperationHash, func(review *OperationReview, draft APIDraft) error {
		if review.IntegrationStatus == "locked" {
			return errors.New("unlock Integration validation before running it again")
		}
		review.ConnectivityReceipt = nil
		review.ValidationRun = map[string]any{
			"runId": runID, "status": "running", "idempotencyKey": input.IdempotencyKey,
			"createdVersion": draft.Version, "planSha256": review.ValidationPlan["planSha256"], "startedAt": startedAt.Format(time.RFC3339Nano),
		}
		review.IntegrationStatus = "editable"
		return nil
	})
	if err != nil {
		return APIDraft{}, err
	}
	snapshot, _ := cloneAPIDraft(started)
	runContext, cancelRun := context.WithTimeout(context.Background(), 24*time.Hour)
	s.runMu.Lock()
	s.validationCancels[runID] = cancelRun
	s.runMu.Unlock()
	go func() {
		defer cancelRun()
		defer func() { s.runMu.Lock(); delete(s.validationCancels, runID); s.runMu.Unlock() }()
		receipt, runErr := s.executeValidationV3(runContext, snapshot, operationID)
		_, _ = s.updateOperationReview(id, operationID, started.Version, input.OperationHash, func(review *OperationReview, _ APIDraft) error {
			if capabilityString(review.ValidationRun["runId"]) != runID || capabilityString(review.ValidationRun["status"]) != "running" {
				return errors.New("validation run is no longer current")
			}
			completedAt := time.Now().UTC().Format(time.RFC3339Nano)
			if runErr != nil {
				review.ValidationRun["status"], review.ValidationRun["completedAt"], review.ValidationRun["failure"] = "failed", completedAt, boundedRedactedSummary(map[string]any{"message": runErr.Error()})
				review.IntegrationStatus = "failed"
				return nil
			}
			review.ValidationRun["status"], review.ValidationRun["completedAt"] = "passed", completedAt
			review.ConnectivityReceipt = receipt
			review.IntegrationStatus = "awaiting_confirmation"
			review.PricingStatus, review.PricingDraft, review.Pricing, review.BillingPlan, review.BillingRun, review.PricingBillingReceipt = "blocked", nil, nil, nil, nil, nil
			review.IntegrationLockedAt, review.PricingLockedAt = nil, nil
			return nil
		})
	}()
	return started, nil
}

func (s *Service) CancelValidationRun(id, operationID, runID string, input CancelValidationRunInput) (APIDraft, error) {
	draft, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	review, ok := draft.Operations[operationID]
	if !ok || capabilityString(review.ValidationRun["runId"]) != runID {
		return APIDraft{}, errors.New("validation run not found")
	}
	updated, err := s.updateOperationReview(id, operationID, input.ExpectedVersion, review.OperationHash, func(current *OperationReview, _ APIDraft) error {
		if capabilityString(current.ValidationRun["status"]) != "running" {
			return errors.New("only a running validation can be cancelled")
		}
		current.ValidationRun["status"] = "cancelled"
		current.ValidationRun["completedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
		current.IntegrationStatus = "editable"
		return nil
	})
	if err != nil {
		return APIDraft{}, err
	}
	s.runMu.Lock()
	cancel := s.validationCancels[runID]
	s.runMu.Unlock()
	if cancel != nil {
		cancel()
	}
	return updated, nil
}

func compileBillingPlan(apiID, operationID, operationHash string, validationReceipt, pricing map[string]any, compiled compiledPriceFormula, sample map[string]int64) map[string]any {
	scenarios := []any{}
	seenUsage := map[string]bool{}
	for _, usage := range priceFormulaValidationSamples(compiled, sample) {
		delete(usage, "delivered")
		usageKey := hashJSON(usage)
		if seenUsage[usageKey] {
			continue
		}
		seenUsage[usageKey] = true
		for _, outcome := range []string{"success", "business_error", "cancel_before_execution", "cancel_after_execution", "provider_fault", "cloud_fault", "timeout_fault", "schema_fault", "artifact_fault", "forced_stop"} {
			scenarios = append(scenarios, map[string]any{"outcome": outcome, "usage": usage})
		}
	}
	plan := map[string]any{"schemaVersion": billingPlanVersion, "apiId": apiID, "operationId": operationID, "operationSha256": operationHash, "validationReceiptSha256": hashJSON(validationReceipt), "pricingSha256": pricingPlanHash(pricing), "formulaAstSha256": compiled.sha256, "scenarios": scenarios}
	plan["planSha256"] = hashJSON(plan)
	return plan
}

func verifyCloudBillingReceipt(receipt map[string]any, apiID, operationID, operationHash, validationHash, pricingHash, formulaHash, planHash string) error {
	if capabilityString(receipt["schemaVersion"]) != billingReceiptVersion || receipt["passed"] != true || receipt["sandbox"] != true || capabilityString(receipt["apiId"]) != apiID || capabilityString(receipt["operationId"]) != operationID || capabilityString(receipt["operationSha256"]) != operationHash || capabilityString(receipt["validationReceiptSha256"]) != validationHash || capabilityString(receipt["pricingSha256"]) != pricingHash || capabilityString(receipt["formulaAstSha256"]) != formulaHash || capabilityString(receipt["planSha256"]) != planHash {
		return errors.New("Cloud Sandbox Ledger receipt is stale")
	}
	signature := mapValue(receipt["signature"])
	if capabilityString(signature["algorithm"]) != "Ed25519" || capabilityString(signature["keyId"]) == "" || capabilityString(signature["publicKey"]) == "" || capabilityString(signature["value"]) == "" {
		return errors.New("Cloud Sandbox Ledger receipt signature is missing")
	}
	unsigned, err := cloneCapability(receipt)
	if err != nil {
		return err
	}
	delete(unsigned, "signature")
	publicKey, publicErr := base64.StdEncoding.DecodeString(capabilityString(signature["publicKey"]))
	signed, signatureErr := base64.StdEncoding.DecodeString(capabilityString(signature["value"]))
	raw, _ := json.Marshal(unsigned)
	if publicErr != nil || signatureErr != nil || len(publicKey) != ed25519.PublicKeySize || !ed25519.Verify(ed25519.PublicKey(publicKey), raw, signed) {
		return errors.New("Cloud Sandbox Ledger receipt signature is invalid")
	}
	return nil
}

func sortedStrings(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func operationMeteringBounds(operation map[string]any) map[string]int64 {
	bounds := map[string]int64{}
	for _, raw := range sliceValue(mapValue(operation["metering"])["capabilities"]) {
		meter := mapValue(raw)
		maximum, ok := pricingInteger(meter["maximumPerInvocation"])
		if ok && maximum > 0 {
			bounds[capabilityString(meter["dimension"])] = maximum
		}
	}
	return bounds
}

func pricingPlanHash(pricing map[string]any) string {
	return hashJSON(map[string]any{"schemaVersion": pricing["schemaVersion"], "apiId": pricing["apiId"], "operationId": pricing["operationId"], "operationSha256": pricing["operationSha256"], "currency": pricing["currency"], "chargeFormula": pricing["chargeFormula"], "maximumChargePerInvocationAtomic": pricing["maximumChargePerInvocationAtomic"], "settlementPolicy": pricing["settlementPolicy"]})
}

func meteringUsageMap(value any) map[string]int64 {
	out := map[string]int64{}
	switch typed := value.(type) {
	case map[string]int64:
		for key, quantity := range typed {
			out[key] = quantity
		}
	case map[string]any:
		for key, raw := range typed {
			if quantity, ok := pricingInteger(raw); ok {
				out[key] = quantity
			}
		}
	}
	return out
}

func normalizeOperationPricingV4(apiID, operationID, operationHash string, pricing, operation, receipt map[string]any, requiredStatus string) (compiledPriceFormula, error) {
	allowedFields := map[string]bool{"schemaVersion": true, "apiId": true, "operationId": true, "operationSha256": true, "currency": true, "chargeFormula": true, "maximumChargePerInvocationAtomic": true, "settlementPolicy": true, "reviewStatus": true, "confirmedAt": true}
	for key := range pricing {
		if !allowedFields[key] {
			return compiledPriceFormula{}, fmt.Errorf("pricing field %s is not allowed", key)
		}
	}
	if capabilityString(pricing["schemaVersion"]) != "exora.operation-pricing.v4" {
		return compiledPriceFormula{}, errors.New("pricing schemaVersion must be exora.operation-pricing.v4")
	}
	if capabilityString(pricing["apiId"]) != apiID || capabilityString(pricing["operationId"]) != operationID || capabilityString(pricing["operationSha256"]) != operationHash {
		return compiledPriceFormula{}, errors.New("pricing must bind the current API and Operation hash")
	}
	if capabilityString(pricing["currency"]) != "USDC" || capabilityString(pricing["settlementPolicy"]) != settlementPolicyV4 || capabilityString(pricing["reviewStatus"]) != requiredStatus {
		return compiledPriceFormula{}, errors.New("pricing currency, settlement policy or review status is invalid")
	}
	maximum, maximumOK := pricingInteger(pricing["maximumChargePerInvocationAtomic"])
	if !maximumOK || maximum < 1 {
		return compiledPriceFormula{}, errors.New("a positive invocation maximum is required")
	}
	formula := mapValue(pricing["chargeFormula"])
	if capabilityString(formula["language"]) != priceFormulaLanguage {
		return compiledPriceFormula{}, fmt.Errorf("chargeFormula language must be %s", priceFormulaLanguage)
	}
	verified := map[string]bool{}
	for _, raw := range sliceValue(receipt["verifiedMetering"]) {
		dimension := capabilityString(mapValue(raw)["dimension"])
		if dimension != "" {
			verified[dimension] = true
		}
	}
	allowed := map[string]bool{}
	for dimension := range operationMeteringDimensions(operation) {
		if dimension == "delivered" {
			return compiledPriceFormula{}, errors.New("metering dimension delivered is reserved by Exora")
		}
		if verified[dimension] {
			allowed[dimension] = true
		}
	}
	allowed["delivered"] = true
	compiled, err := compilePriceFormula(capabilityString(formula["expression"]), allowed)
	if err != nil {
		return compiledPriceFormula{}, err
	}
	bounds := operationMeteringBounds(operation)
	bounds["delivered"] = 1
	if err := validateSafeChargeFormula(compiled, bounds); err != nil {
		return compiledPriceFormula{}, err
	}
	formula["astSha256"] = compiled.sha256
	refs := make([]any, len(compiled.variables))
	for index, variable := range compiled.variables {
		refs[index] = variable
	}
	formula["referencedVariables"] = refs
	pricing["chargeFormula"] = formula
	return compiled, nil
}

func sandboxSettlementV4(outcome string, pricing map[string]any, compiled compiledPriceFormula, usage map[string]int64) (map[string]any, error) {
	maximum, _ := pricingInteger(pricing["maximumChargePerInvocationAtomic"])
	actualUsage := map[string]int64{}
	for dimension, quantity := range usage {
		if dimension != "delivered" {
			actualUsage[dimension] = quantity
		}
	}
	delivered, billable := int64(0), false
	switch outcome {
	case "success":
		delivered, billable = 1, true
	case "cancel_after_execution":
		billable = true
	case "business_error", "cancel_before_execution", "provider_fault", "cloud_fault", "timeout_fault", "schema_fault", "artifact_fault", "forced_stop":
	default:
		return nil, fmt.Errorf("unsupported settlement outcome %s", outcome)
	}
	formulaCharge, charged := int64(0), int64(0)
	if billable {
		inputs := map[string]int64{"delivered": delivered}
		for dimension, quantity := range actualUsage {
			inputs[dimension] = quantity
		}
		var err error
		formulaCharge, charged, err = evaluateCompiledPriceFormula(compiled, inputs, maximum)
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{"schemaVersion": settlementPolicyV4, "outcome": outcome, "delivered": delivered, "actualUsage": actualUsage, "formulaChargeAtomic": formulaCharge, "reservedAtomic": maximum, "chargedAtomic": charged, "refundedAtomic": maximum - charged}, nil
}

func emptyOperationalMetrics() map[string]any {
	return map[string]any{"inFlight": 0, "invocations": 0, "usage": map[string]any{}, "grossRevenueAtomic": 0, "refundedAtomic": 0, "providerFaultRate": 0, "healthFailureStreak": 0, "blocked": false}
}

func (s *Service) RunConnectivityTest(ctx context.Context, id, operationID string, expectedVersion int64, operationHash string) (APIDraft, error) {
	return s.runIntegrationValidationV3(ctx, id, operationID, expectedVersion, operationHash)
}

func (s *Service) RecordConnectivityReceipt(id, operationID string, input ConnectivityReceiptInput) (APIDraft, error) {
	return s.updateOperationReview(id, operationID, input.ExpectedVersion, input.OperationHash, func(review *OperationReview, draft APIDraft) error {
		operation := operationFromCapability(draft.Capability, operationID)
		declared, units, bounds := operationMeteringDimensions(operation), operationMeteringUnits(operation), operationMeteringBounds(operation)
		verified, sample := []any{}, map[string]any{}
		for _, dimension := range input.VerifiedDimensions {
			if !declared[dimension] {
				return fmt.Errorf("unknown metering dimension %q", dimension)
			}
			quantity, exists := input.SampleUsage[dimension]
			if input.Passed && !exists {
				return fmt.Errorf("sample usage is required for %q", dimension)
			}
			if quantity < 0 || quantity > bounds[dimension] {
				return fmt.Errorf("sample usage for %q is out of range", dimension)
			}
			verified = append(verified, map[string]any{"dimension": dimension, "unit": units[dimension], "maximumPerInvocation": bounds[dimension]})
			sample[dimension] = quantity
		}
		if input.Passed && len(verified) != len(declared) {
			return errors.New("a passing receipt must verify every declared metering dimension")
		}
		review.ConnectivityReceipt = map[string]any{"schemaVersion": validationReceiptVersion, "receiptId": input.ReceiptID, "apiId": id, "operationId": operationID, "operationSha256": review.OperationHash, "openapiSha256": hashJSON(mapValue(draft.Capability["interface"])), "planSha256": review.ValidationPlan["planSha256"], "runtimeSha256": input.RuntimeHash, "passed": input.Passed, "checks": []any{map[string]any{"id": "owner-imported-format-evidence", "passed": input.Passed}}, "evidence": map[string]any{"redacted": true}, "verifiedMetering": verified, "sampleUsage": sample, "testedAt": time.Now().UTC().Format(time.RFC3339Nano)}
		review.IntegrationStatus = "failed"
		if input.Passed {
			review.IntegrationStatus = "awaiting_confirmation"
		}
		review.PricingStatus, review.PricingDraft, review.Pricing, review.BillingPlan, review.BillingRun, review.PricingBillingReceipt = "blocked", nil, nil, nil, nil, nil
		return nil
	})
}

func (s *Service) LockIntegration(id, operationID string, input OwnerOperationReviewInput) (APIDraft, error) {
	return s.updateOperationReview(id, operationID, input.ExpectedVersion, input.OperationHash, func(review *OperationReview, _ APIDraft) error {
		if review.IntegrationStatus != "awaiting_confirmation" || review.ConnectivityReceipt["passed"] != true || capabilityString(review.ConnectivityReceipt["schemaVersion"]) != validationReceiptVersion || capabilityString(review.ConnectivityReceipt["planSha256"]) != capabilityString(review.ValidationPlan["planSha256"]) {
			return errors.New("current V3 contract-format validation must pass before capability confirmation")
		}
		review.IntegrationStatus, review.CapabilityReview, review.PricingStatus = "locked", "confirmed", "editable"
		now := time.Now().UTC()
		review.IntegrationLockedAt = &now
		return nil
	})
}

func (s *Service) UnlockIntegration(id, operationID string, input OwnerOperationReviewInput) (APIDraft, error) {
	return s.updateOperationReview(id, operationID, input.ExpectedVersion, input.OperationHash, func(review *OperationReview, draft APIDraft) error {
		if review.OperationalState != "offline" || draft.Status == "live" || draft.Status == "draining" {
			return errors.New("a live or draining Operation must be offline before integration can be unlocked")
		}
		review.IntegrationStatus, review.CapabilityReview, review.PricingStatus = "editable", "pending", "blocked"
		review.ConnectivityReceipt, review.ValidationRun, review.PricingDraft, review.Pricing, review.BillingPlan, review.BillingRun, review.PricingBillingReceipt = nil, nil, nil, nil, nil, nil, nil
		review.IntegrationLockedAt, review.PricingLockedAt = nil, nil
		return nil
	})
}

func (s *Service) RunBillingTest(id, operationID string, input PricingDraftInput) (APIDraft, error) {
	if strings.TrimSpace(input.IdempotencyKey) == "" {
		return APIDraft{}, errors.New("idempotencyKey is required for billing validation")
	}
	if draft, found := s.store.APIDraft(id); found {
		if review, ok := draft.Operations[operationID]; ok && capabilityString(review.BillingRun["idempotencyKey"]) == input.IdempotencyKey {
			return draft, nil
		}
	}
	runID, startedAt := newID("brun"), time.Now().UTC()
	return s.updateOperationReview(id, operationID, input.ExpectedVersion, input.OperationHash, func(review *OperationReview, draft APIDraft) error {
		if review.IntegrationStatus != "locked" || review.OperationalState != "offline" {
			return errors.New("locked integration and offline state are required before billing validation")
		}
		pricing, err := cloneCapability(input.Pricing)
		if err != nil {
			return err
		}
		pricing["reviewStatus"] = "edited"
		compiled, err := normalizeOperationPricingV4(id, operationID, review.OperationHash, pricing, operationFromCapability(draft.Capability, operationID), review.ConnectivityReceipt, "edited")
		if err != nil {
			review.PricingStatus = "failed"
			return err
		}
		plan := compileBillingPlan(id, operationID, review.OperationHash, review.ConnectivityReceipt, pricing, compiled, pricingSampleUsage(review.ConnectivityReceipt, compiled.variables))
		scenarios := []any{}
		for _, raw := range sliceValue(plan["scenarios"]) {
			scenario := mapValue(raw)
			usage := meteringUsageMap(scenario["usage"])
			settlement, err := sandboxSettlementV4(capabilityString(scenario["outcome"]), pricing, compiled, usage)
			if err != nil {
				return err
			}
			reserved, _ := pricingInteger(settlement["reservedAtomic"])
			charged, _ := pricingInteger(settlement["chargedAtomic"])
			refunded, _ := pricingInteger(settlement["refundedAtomic"])
			if charged+refunded != reserved {
				return errors.New("Dock preflight violated amount conservation")
			}
			scenarios = append(scenarios, settlement)
		}
		pricing["reviewStatus"] = "tested"
		var cloudResult struct {
			Receipt map[string]any `json:"receipt"`
		}
		if err := s.cloud.JSON(context.Background(), http.MethodPost, "/v4/provider/billing-sandbox/runs", map[string]any{"plan": plan, "pricing": pricing, "validationReceipt": review.ConnectivityReceipt, "dockPreflight": map[string]any{"passed": true, "scenarios": scenarios}}, &cloudResult); err != nil {
			return fmt.Errorf("Cloud Sandbox Ledger is required: %w", err)
		}
		if err := verifyCloudBillingReceipt(cloudResult.Receipt, id, operationID, review.OperationHash, hashJSON(review.ConnectivityReceipt), pricingPlanHash(pricing), compiled.sha256, capabilityString(plan["planSha256"])); err != nil {
			return err
		}
		review.PricingDraft, review.Pricing, review.BillingPlan, review.PricingBillingReceipt = pricing, nil, plan, cloudResult.Receipt
		review.PricingStatus, review.PricingReview, review.PricingLockedAt = "awaiting_confirmation", "pending", nil
		review.BillingRun = map[string]any{"runId": runID, "status": "passed", "idempotencyKey": input.IdempotencyKey, "createdVersion": draft.Version, "planSha256": plan["planSha256"], "startedAt": startedAt.Format(time.RFC3339Nano), "completedAt": time.Now().UTC().Format(time.RFC3339Nano)}
		return nil
	})
}

func (s *Service) LockPricing(id, operationID string, input OwnerOperationReviewInput) (APIDraft, error) {
	return s.updateOperationReview(id, operationID, input.ExpectedVersion, input.OperationHash, func(review *OperationReview, draft APIDraft) error {
		if review.PricingStatus != "awaiting_confirmation" || review.PricingBillingReceipt["passed"] != true {
			return errors.New("Cloud billing validation must pass before price confirmation")
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
		review.Pricing, review.PricingStatus, review.PricingReview = pricing, "locked", "confirmed"
		now := time.Now().UTC()
		review.PricingLockedAt = &now
		return nil
	})
}

func (s *Service) UnlockPricing(id, operationID string, input OwnerOperationReviewInput) (APIDraft, error) {
	return s.updateOperationReview(id, operationID, input.ExpectedVersion, input.OperationHash, func(review *OperationReview, draft APIDraft) error {
		if review.OperationalState != "offline" || draft.Status == "live" || draft.Status == "draining" {
			return errors.New("a live or draining Operation must be offline before pricing can be unlocked")
		}
		if len(review.Pricing) > 0 {
			review.PricingDraft, _ = cloneCapability(review.Pricing)
			review.PricingDraft["reviewStatus"] = "edited"
		}
		review.Pricing, review.BillingPlan, review.BillingRun, review.PricingBillingReceipt, review.PricingLockedAt = nil, nil, nil, nil, nil
		review.PricingStatus, review.PricingReview = "editable", "empty"
		return nil
	})
}

func hasActiveOperation(draft APIDraft) bool {
	for _, review := range draft.Operations {
		if review.OperationalState == "live" || review.OperationalState == "draining" {
			return true
		}
	}
	return false
}

func hasLockedIntegration(draft APIDraft) bool {
	for _, review := range draft.Operations {
		if review.IntegrationStatus == "locked" {
			return true
		}
	}
	return false
}

func refreshAPIDraftLifecycleStatus(draft *APIDraft) {
	hasLive, hasDraining := false, false
	for _, review := range draft.Operations {
		hasLive = hasLive || review.OperationalState == "live"
		hasDraining = hasDraining || review.OperationalState == "draining"
	}
	if hasLive {
		draft.Status = "live"
	} else if hasDraining {
		draft.Status = "draining"
	} else {
		draft.Status = "review_required"
	}
}

type cloudOperationStatusResponse struct {
	Lifecycle         string `json:"lifecycle"`
	HealthStatus      string `json:"healthStatus"`
	OperationalStatus struct {
		ConcurrencyLimit           int `json:"concurrencyLimit"`
		ContractMaximumConcurrency int `json:"contractMaximumConcurrency"`
		ActiveInvocations          int `json:"activeInvocations"`
		ActiveConsumers            int `json:"activeConsumers"`
	} `json:"operationalStatus"`
}

func applyCloudOperationStatus(review *OperationReview, status cloudOperationStatusResponse) {
	if review.OperationalSettings == nil {
		review.OperationalSettings = map[string]any{}
	}
	if review.OperationalMetrics == nil {
		review.OperationalMetrics = emptyOperationalMetrics()
	}
	review.OperationalSettings["concurrencyLimit"] = status.OperationalStatus.ConcurrencyLimit
	review.OperationalSettings["contractMaximumConcurrency"] = status.OperationalStatus.ContractMaximumConcurrency
	review.OperationalMetrics["inFlight"] = status.OperationalStatus.ActiveInvocations
	review.OperationalMetrics["activeConsumers"] = status.OperationalStatus.ActiveConsumers
	if status.HealthStatus != "" {
		review.OperationalMetrics["healthStatus"] = status.HealthStatus
	}
}

func (s *Service) UpdateOperationSettings(ctx context.Context, id, operationID string, input OperationSettingsInput) (APIDraft, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	value, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	if input.ExpectedVersion != value.Version {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	review, ok := value.Operations[operationID]
	if !ok {
		return APIDraft{}, fmt.Errorf("unknown operationId %q", operationID)
	}
	if strings.TrimSpace(input.OperationHash) == "" || input.OperationHash != review.OperationHash {
		return APIDraft{}, errors.New("operationSha256 does not match the current Operation")
	}
	if review.PricingStatus != "locked" {
		return APIDraft{}, errors.New("confirmed contract is required before operational settings can change")
	}
	operation := operationFromCapability(value.Capability, operationID)
	maximum, _ := pricingInteger(mapValue(operation["limits"])["maximumConcurrency"])
	if maximum < 1 {
		maximum = 1
	}
	if input.ConcurrencyLimit < 1 || input.ConcurrencyLimit > int(maximum) {
		return APIDraft{}, fmt.Errorf("concurrencyLimit must be between 1 and %d", maximum)
	}
	previous, err := cloneAPIDraft(value)
	if err != nil {
		return APIDraft{}, err
	}
	previousLimit, _ := pricingInteger(review.OperationalSettings["concurrencyLimit"])
	if previousLimit < 1 {
		previousLimit = maximum
	}
	if review.OperationalSettings == nil {
		review.OperationalSettings = map[string]any{}
	}
	review.OperationalSettings["concurrencyLimit"] = input.ConcurrencyLimit
	review.OperationalSettings["contractMaximumConcurrency"] = maximum
	cloudUpdated := review.OperationalState == "live" || review.OperationalState == "draining"
	if cloudUpdated {
		path := "/v4/provider/apis/" + url.PathEscape(id) + "/operations/" + url.PathEscape(operationID) + "/operational-settings"
		var response cloudOperationStatusResponse
		if err := s.cloud.JSON(ctx, http.MethodPut, path, map[string]any{"concurrencyLimit": input.ConcurrencyLimit}, &response); err != nil {
			return APIDraft{}, err
		}
		applyCloudOperationStatus(&review, response)
	}
	value.Operations[operationID] = review
	value.Version++
	value.UpdatedAt = time.Now().UTC()
	if err := s.persistCloudSyncedDraft(ctx, value, &previous); err != nil {
		if cloudUpdated {
			path := "/v4/provider/apis/" + url.PathEscape(id) + "/operations/" + url.PathEscape(operationID) + "/operational-settings"
			_ = s.cloud.JSON(context.Background(), http.MethodPut, path, map[string]any{"concurrencyLimit": previousLimit}, nil)
		}
		return APIDraft{}, err
	}
	return value, nil
}

func (s *Service) UpdateOperationLifecycle(id, operationID string, input OperationLifecycleInput) (APIDraft, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	value, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	if input.ExpectedVersion != value.Version {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	review, ok := value.Operations[operationID]
	if !ok {
		return APIDraft{}, fmt.Errorf("unknown operationId %q", operationID)
	}
	if strings.TrimSpace(input.OperationHash) == "" || input.OperationHash != review.OperationHash {
		return APIDraft{}, errors.New("operationSha256 does not match the current Operation")
	}
	previous, err := cloneAPIDraft(value)
	if err != nil {
		return APIDraft{}, err
	}
	if review.OperationalMetrics == nil {
		review.OperationalMetrics = emptyOperationalMetrics()
	}
	action := strings.TrimSpace(input.Action)
	pauseCloud := false
	switch action {
	case "take_offline":
		if review.OperationalState != "live" {
			return APIDraft{}, errors.New("only a live Operation can begin draining")
		}
		pauseCloud = true
		review.OperationalState, review.OperationalStatusReason = "draining", "New invocations are blocked while in-flight fulfillment completes."
	case "complete_draining":
		inFlight, _ := pricingInteger(review.OperationalMetrics["inFlight"])
		if review.OperationalState != "draining" || inFlight != 0 {
			return APIDraft{}, errors.New("draining and zero in-flight fulfillment are required")
		}
		review.OperationalState, review.OperationalStatusReason = "offline", "All in-flight fulfillment completed."
	case "force_stop":
		if review.OperationalState != "live" && review.OperationalState != "draining" {
			return APIDraft{}, errors.New("only a live or draining Operation can be force-stopped")
		}
		pauseCloud = review.OperationalState == "live"
		review.OperationalState = "offline"
		review.OperationalMetrics["inFlight"], review.OperationalMetrics["blocked"], review.OperationalMetrics["sellerLiabilityRecorded"] = 0, true, true
		review.OperationalStatusReason = "Force-stopped by the Provider; unfinished fulfillment must be fully refunded."
	default:
		return APIDraft{}, errors.New("lifecycle action must be take_offline, complete_draining or force_stop")
	}
	if pauseCloud {
		for siblingID, sibling := range value.Operations {
			if siblingID != operationID && sibling.Enabled && (sibling.OperationalState == "live" || sibling.OperationalState == "draining") {
				return APIDraft{}, errors.New("Cloud cannot take one Operation offline while another Operation in the same API remains active")
			}
		}
		path := "/v4/provider/apis/" + url.PathEscape(id) + "/pause"
		if err := s.cloud.JSON(context.Background(), http.MethodPost, path, map[string]any{}, nil); err != nil {
			return APIDraft{}, err
		}
	}
	value.Operations[operationID] = review
	refreshAPIDraftLifecycleStatus(&value)
	value.Version++
	value.UpdatedAt = time.Now().UTC()
	if err := s.persistCloudSyncedDraft(context.Background(), value, &previous); err != nil {
		if pauseCloud {
			path := "/v4/provider/apis/" + url.PathEscape(id) + "/resume"
			_ = s.cloud.JSON(context.Background(), http.MethodPost, path, map[string]any{}, nil)
		}
		return APIDraft{}, err
	}
	return value, nil
}

func (s *Service) OfflineAllForLogout(ctx context.Context) ([]APIDraft, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	var cloudAPIs struct {
		APIs []struct {
			APIID     string `json:"apiId"`
			Lifecycle string `json:"lifecycle"`
		} `json:"apis"`
	}
	if err := s.cloud.JSON(ctx, http.MethodGet, "/v4/provider/apis", nil, &cloudAPIs); err != nil {
		return nil, fmt.Errorf("list Provider APIs before sign out: %w", err)
	}
	for _, api := range cloudAPIs.APIs {
		if api.Lifecycle != "live" {
			continue
		}
		path := "/v4/provider/apis/" + url.PathEscape(api.APIID) + "/pause"
		if err := s.cloud.JSON(ctx, http.MethodPost, path, map[string]any{}, nil); err != nil {
			return nil, fmt.Errorf("take API %s offline before sign out: %w", api.APIID, err)
		}
	}
	updated := []APIDraft{}
	for _, value := range s.store.APIDrafts() {
		if !hasActiveOperation(value) {
			continue
		}
		previous, err := cloneAPIDraft(value)
		if err != nil {
			return updated, err
		}
		for operationID, review := range value.Operations {
			if review.OperationalState != "live" && review.OperationalState != "draining" {
				continue
			}
			if review.OperationalMetrics == nil {
				review.OperationalMetrics = emptyOperationalMetrics()
			}
			inFlight, _ := pricingInteger(review.OperationalMetrics["inFlight"])
			if inFlight > 0 {
				review.OperationalMetrics["sellerLiabilityRecorded"] = true
				review.OperationalStatusReason = "Force-stopped automatically during sign out; unfinished fulfillment must be fully refunded."
			} else {
				review.OperationalStatusReason = "Taken offline automatically during sign out."
			}
			review.OperationalMetrics["inFlight"] = 0
			review.OperationalMetrics["blocked"] = true
			review.OperationalMetrics["healthStatus"] = "offline"
			review.OperationalState = "offline"
			value.Operations[operationID] = review
		}
		refreshAPIDraftLifecycleStatus(&value)
		value.Version++
		value.UpdatedAt = time.Now().UTC()
		if err := s.persistCloudSyncedDraft(ctx, value, &previous); err != nil {
			return updated, fmt.Errorf("save offline state for API %s before sign out: %w", value.APIID, err)
		}
		updated = append(updated, value)
	}
	return updated, nil
}

func (s *Service) PublishAPIDraft(ctx context.Context, id string, expectedVersion int64) (APIDraft, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	value, ok := s.store.APIDraft(id)
	if !ok {
		return APIDraft{}, errors.New("API draft not found")
	}
	if value.Version != expectedVersion {
		return APIDraft{}, errors.New("API draft version conflict")
	}
	previous, err := cloneAPIDraft(value)
	if err != nil {
		return APIDraft{}, err
	}
	validationReceipts, billingReceipts := []map[string]any{}, []map[string]any{}
	enabled := 0
	for operationID, review := range value.Operations {
		if !review.Enabled {
			continue
		}
		enabled++
		if review.IntegrationStatus != "locked" || review.PricingStatus != "locked" || capabilityString(review.ConnectivityReceipt["schemaVersion"]) != validationReceiptVersion || review.ConnectivityReceipt["passed"] != true || capabilityString(review.ConnectivityReceipt["operationSha256"]) != review.OperationHash || capabilityString(review.ConnectivityReceipt["planSha256"]) != capabilityString(review.ValidationPlan["planSha256"]) {
			return APIDraft{}, fmt.Errorf("Operation %s has no current locked V3 integration receipt", operationID)
		}
		pricing, err := cloneCapability(review.Pricing)
		if err != nil {
			return APIDraft{}, err
		}
		compiled, err := normalizeOperationPricingV4(value.APIID, operationID, review.OperationHash, pricing, operationFromCapability(value.Capability, operationID), review.ConnectivityReceipt, "confirmed")
		if err != nil {
			return APIDraft{}, err
		}
		if err := verifyCloudBillingReceipt(review.PricingBillingReceipt, value.APIID, operationID, review.OperationHash, hashJSON(review.ConnectivityReceipt), pricingPlanHash(pricing), compiled.sha256, capabilityString(review.BillingPlan["planSha256"])); err != nil {
			return APIDraft{}, err
		}
		review.Pricing = pricing
		value.Operations[operationID] = review
		validationReceipts = append(validationReceipts, review.ConnectivityReceipt)
		billingReceipts = append(billingReceipts, review.PricingBillingReceipt)
	}
	if enabled == 0 {
		return APIDraft{}, errors.New("at least one enabled Operation is required")
	}
	if value.CloudAPIID == "" || value.CloudAPIID != value.APIID {
		return APIDraft{}, errors.New("Cloud stable API UID is not synchronized")
	}
	createPayload, err := cloneCapability(value.Capability)
	if err != nil {
		return APIDraft{}, err
	}
	createPayload["apiId"], createPayload["draftVersion"] = value.APIID, value.Version
	var promoted struct {
		API struct {
			APIID string `json:"apiId"`
		} `json:"api"`
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, "/v4/provider/apis", createPayload, &promoted); err != nil {
		if !isExistingCloudAPIConflict(err) {
			return APIDraft{}, err
		}
		// A paused/offline API keeps its stable UID in Cloud. Republish updates
		// that existing API revision before reconfirming and publishing it; it
		// must not attempt to create a second API with the same UID.
		path := "/v4/provider/apis/" + url.PathEscape(value.APIID)
		if err := s.cloud.JSON(ctx, http.MethodPut, path, createPayload, &promoted); err != nil {
			return APIDraft{}, err
		}
	}
	if promoted.API.APIID != value.APIID {
		return APIDraft{}, errors.New("Cloud changed the stable API UID")
	}
	for _, review := range value.Operations {
		if !review.Enabled {
			continue
		}
		path := "/v4/provider/apis/" + url.PathEscape(value.APIID) + "/operations/" + url.PathEscape(review.OperationID)
		if err := s.cloud.JSON(ctx, http.MethodPost, path+"/confirm-capability", map[string]any{"operationSha256": review.OperationHash, "rightsConfirmed": true, "validationReceipt": review.ConnectivityReceipt}, nil); err != nil {
			return APIDraft{}, err
		}
		if err := s.cloud.JSON(ctx, http.MethodPost, path+"/confirm-pricing", map[string]any{"pricing": review.Pricing, "billingReceipt": review.PricingBillingReceipt}, nil); err != nil {
			return APIDraft{}, err
		}
		maximum, _ := pricingInteger(mapValue(operationFromCapability(value.Capability, review.OperationID)["limits"])["maximumConcurrency"])
		limit, _ := pricingInteger(review.OperationalSettings["concurrencyLimit"])
		if maximum < 1 {
			maximum = 1
		}
		if limit < 1 || limit > maximum {
			limit = maximum
		}
		if err := s.cloud.JSON(ctx, http.MethodPut, path+"/operational-settings", map[string]any{"concurrencyLimit": limit}, nil); err != nil {
			// Older Cloud deployments derive the default concurrency limit from
			// limits.maximumConcurrency and do not expose this route yet. Only
			// tolerate that exact compatibility case; a custom limit must be
			// acknowledged by Cloud before the API can be published.
			if limit != maximum || !isUnregisteredCloudRoute(err) {
				return APIDraft{}, err
			}
		}
	}
	runtime := cloneNativeMapForDock(mapValue(value.Capability["runtime"]))
	runtime["healthStatus"] = "healthy"
	base := "/v4/provider/apis/" + url.PathEscape(value.APIID)
	if err := s.cloud.JSON(ctx, http.MethodPut, base+"/runtime", runtime, nil); err != nil {
		return APIDraft{}, err
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, base+"/validate", map[string]any{"qualificationReceipts": validationReceipts, "billingReceipts": billingReceipts}, nil); err != nil {
		return APIDraft{}, err
	}
	if value.DeliveryMode == "local_dock" && s.endpointStore != nil {
		if err := s.saveTunnelEndpoint(ctx, value); err != nil {
			return APIDraft{}, err
		}
		s.notifyTunnelEndpoint()
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, base+"/publish", map[string]any{}, nil); err != nil {
		if value.DeliveryMode == "local_dock" && s.endpointStore != nil {
			s.endpointStore.Delete(v4TunnelEndpointID(value.APIID))
			s.notifyTunnelEndpoint()
		}
		return APIDraft{}, err
	}
	value.Status, value.Version, value.UpdatedAt = "live", value.Version+1, time.Now().UTC()
	for operationID, review := range value.Operations {
		if review.Enabled {
			review.OperationalState, review.OperationalStatusReason = "live", "Accepting new invocations."
			if review.OperationalMetrics == nil {
				review.OperationalMetrics = emptyOperationalMetrics()
			}
			value.Operations[operationID] = review
		}
	}
	if err := s.persistCloudSyncedDraft(ctx, value, &previous); err != nil {
		return APIDraft{}, err
	}
	return value, nil
}

func cloneNativeMapForDock(value map[string]any) map[string]any {
	cloned, _ := cloneCapability(value)
	return cloned
}
