package endpoint

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

var openAPIMethods = map[string]string{
	"get": http.MethodGet, "post": http.MethodPost, "put": http.MethodPut,
	"patch": http.MethodPatch, "delete": http.MethodDelete, "head": http.MethodHead,
	"options": http.MethodOptions,
}

// ValidateServiceManifest validates the local copy of the public contract and
// derives the private HTTP allowlist used by the tunnel. Cloud performs the
// same validation independently before publication.
func ValidateServiceManifest(value map[string]any) (map[string]any, []Route, string, error) {
	if len(value) != 3 {
		return nil, nil, "", errors.New("serviceManifest must contain only interface, delivery, and operationPolicies")
	}
	for _, key := range []string{"interface", "delivery", "operationPolicies"} {
		if _, found := value[key]; !found {
			return nil, nil, "", fmt.Errorf("serviceManifest.%s is required", key)
		}
	}
	if delivery, _ := value["delivery"].(string); delivery != "dock_tunnel" {
		return nil, nil, "", errors.New("Endpoint serviceManifest.delivery must be dock_tunnel")
	}
	document, ok := value["interface"].(map[string]any)
	if !ok || !strings.HasPrefix(strings.TrimSpace(stringValue(document["openapi"])), "3.1.") {
		return nil, nil, "", errors.New("serviceManifest.interface must be normalized OpenAPI 3.1")
	}
	if servers, found := document["servers"]; found && servers != nil {
		return nil, nil, "", errors.New("public OpenAPI must not contain runtime servers")
	}
	if webhooks, found := document["webhooks"]; found && nonEmptyJSONValue(webhooks) {
		return nil, nil, "", errors.New("OpenAPI webhooks are not supported")
	}
	if err := inspectServiceValue(document); err != nil {
		return nil, nil, "", err
	}
	paths, ok := document["paths"].(map[string]any)
	if !ok || len(paths) == 0 {
		return nil, nil, "", errors.New("OpenAPI paths are required")
	}
	operationsByID := map[string]Route{}
	serverStreams := map[string]bool{}
	for operationPath, rawItem := range paths {
		item, _ := rawItem.(map[string]any)
		for key, method := range openAPIMethods {
			operation, _ := item[key].(map[string]any)
			if operation == nil {
				continue
			}
			operationID := strings.TrimSpace(stringValue(operation["operationId"]))
			if operationID == "" || operationsByID[operationID].OperationID != "" {
				return nil, nil, "", errors.New("every OpenAPI operation requires a unique operationId")
			}
			if !safeEndpointPath(operationPath) || !validPathTemplate(operationPath) {
				return nil, nil, "", fmt.Errorf("operation %s has an invalid path template", operationID)
			}
			serverStream, err := validateOperationMedia(operation)
			if err != nil {
				return nil, nil, "", fmt.Errorf("operation %s: %w", operationID, err)
			}
			operationsByID[operationID] = Route{OperationID: operationID, Method: method, Path: operationPath}
			serverStreams[operationID] = serverStream
		}
	}
	policies, ok := value["operationPolicies"].([]any)
	if !ok || len(policies) != len(operationsByID) {
		return nil, nil, "", errors.New("operationPolicies must match every OpenAPI operation exactly")
	}
	seen := map[string]bool{}
	for _, rawPolicy := range policies {
		policy, _ := rawPolicy.(map[string]any)
		operationID := strings.TrimSpace(stringValue(policy["operationId"]))
		operation, found := operationsByID[operationID]
		if !found || seen[operationID] {
			return nil, nil, "", errors.New("operationPolicies contains a missing, duplicate, or unknown operationId")
		}
		seen[operationID] = true
		interaction := strings.TrimSpace(stringValue(policy["interaction"]))
		if interaction != "request_response" && interaction != "server_stream" && interaction != "async_job" {
			return nil, nil, "", fmt.Errorf("operation %s has an invalid interaction", operationID)
		}
		if serverStreams[operationID] != (interaction == "server_stream") {
			return nil, nil, "", fmt.Errorf("operation %s interaction does not match its OpenAPI response", operationID)
		}
		operation.Streaming = interaction
		operation.SideEffect, _ = policy["sideEffect"].(bool)
		operation.Idempotent, _ = policy["idempotent"].(bool)
		limits, _ := policy["limits"].(map[string]any)
		operation.TimeoutSeconds = integerValue(limits["timeoutSeconds"])
		operation.MaxRequestBytes = int64(integerValue(limits["maxRequestBytes"]))
		operation.MaxResponseBytes = int64(integerValue(limits["maxResponseBytes"]))
		if operation.TimeoutSeconds < 1 || operation.MaxRequestBytes < 1 || operation.MaxResponseBytes < 1 {
			return nil, nil, "", fmt.Errorf("operation %s limits are incomplete", operationID)
		}
		operationsByID[operationID] = operation
	}
	operations := make([]Route, 0, len(operationsByID))
	for _, operation := range operationsByID {
		operations = append(operations, operation)
	}
	if err := validateRouteConflicts(operations); err != nil {
		return nil, nil, "", err
	}
	raw, _ := json.Marshal(value)
	var canonical map[string]any
	_ = json.Unmarshal(raw, &canonical)
	sum := sha256.Sum256(raw)
	return canonical, operations, hex.EncodeToString(sum[:]), nil
}

func inspectServiceValue(value any) error {
	switch item := value.(type) {
	case map[string]any:
		if callbacks, found := item["callbacks"]; found && nonEmptyJSONValue(callbacks) {
			return errors.New("OpenAPI callbacks are not supported")
		}
		for key, child := range item {
			if key == "$ref" && !strings.HasPrefix(stringValue(child), "#/components/") {
				return errors.New("only local #/components OpenAPI references are allowed")
			}
			if err := inspectServiceValue(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range item {
			if err := inspectServiceValue(child); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateOperationMedia(operation map[string]any) (bool, error) {
	if body, _ := operation["requestBody"].(map[string]any); body != nil {
		content, _ := body["content"].(map[string]any)
		for mediaType := range content {
			if !jsonMediaType(mediaType) {
				return false, errors.New("request bodies must use JSON")
			}
		}
	}
	responses, _ := operation["responses"].(map[string]any)
	if len(responses) == 0 {
		return false, errors.New("at least one response is required")
	}
	serverStream := false
	for _, rawResponse := range responses {
		response, _ := rawResponse.(map[string]any)
		content, _ := response["content"].(map[string]any)
		for mediaType := range content {
			if strings.ToLower(strings.TrimSpace(mediaType)) == "text/event-stream" {
				serverStream = true
			} else if !jsonMediaType(mediaType) {
				return false, errors.New("responses must use JSON, SSE, or no body")
			}
		}
	}
	return serverStream, nil
}

func jsonMediaType(value string) bool {
	value = strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
	return value == "application/json" || strings.HasSuffix(value, "+json")
}

func nonEmptyJSONValue(value any) bool {
	switch item := value.(type) {
	case map[string]any:
		return len(item) > 0
	case []any:
		return len(item) > 0
	default:
		return value != nil
	}
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func integerValue(value any) int {
	switch number := value.(type) {
	case int:
		return number
	case int64:
		return int(number)
	case float64:
		return int(number)
	case json.Number:
		parsed, _ := number.Int64()
		return int(parsed)
	}
	return 0
}
