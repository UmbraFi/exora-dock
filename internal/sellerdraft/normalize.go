package sellerdraft

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path"
	"regexp"
	"runtime"
	"strings"
)

var operationIDPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.-]{0,127}$`)

func normalizeRunInput(policy SellerAutomationPolicy, request CreateRequest, candidates []Candidate) (map[string]any, []string, error) {
	defaults := policy.Defaults[request.Kind]
	commercial := map[string]any{}
	if nested := mapValue(defaults, "commercial"); nested != nil {
		mergeMap(commercial, nested)
	} else {
		for key, value := range defaults {
			if key != "specification" && key != "title" && key != "description" && key != "credentialRef" {
				commercial[key] = value
			}
		}
	}
	mergeMap(commercial, request.Commercial)
	specification := map[string]any{}
	mergeMap(specification, mapValue(defaults, "specification"))
	mergeMap(specification, request.Specification)
	title := firstNonEmpty(request.Title, textValue(defaults, "title"))
	if title == "" && len(candidates) > 0 {
		title = candidates[0].DisplayName
	}
	description := firstNonEmpty(request.Description, textValue(defaults, "description"))
	if description == "" && len(candidates) > 0 {
		description = candidates[0].Summary
	}
	credentialRef := firstNonEmpty(request.CredentialRef, textValue(defaults, "credentialRef"))
	if credentialRef == "" && len(candidates) > 0 {
		credentialRef = textValue(candidates[0].Metadata, "credentialRef")
	}
	missing := []string{}
	if title == "" {
		missing = append(missing, "title")
	}
	price := mapValue(commercial, "price")
	if price == nil {
		missing = append(missing, "commercial.price")
	} else if err := validateNonNegativeNumbers(price, "commercial.price"); err != nil {
		return nil, nil, err
	} else {
		if request.Kind == KindVM || request.Kind == KindResources {
			if _, ok := numberValue(price, "amount"); !ok {
				missing = append(missing, "commercial.price.amount")
			}
			if textValue(price, "currency") == "" {
				missing = append(missing, "commercial.price.currency")
			}
		} else if textValue(price, "currency") == "" {
			missing = append(missing, "commercial.price.currency")
		}
	}
	limits := mapValue(commercial, "limits")
	if limits == nil {
		limits = mapValue(specification, "limits")
	}
	if err := validateNonNegativeNumbers(limits, "commercial.limits"); err != nil {
		return nil, nil, err
	}
	if concurrency, ok := numberValue(limits, "concurrency"); ok && (concurrency < 1 || concurrency > 64) {
		return nil, nil, errors.New("commercial.limits.concurrency must be between 1 and 64")
	}
	normalized := map[string]any{
		"title": title, "description": description, "commercial": commercial,
		"price": price, "limits": limits, "specification": specification, "credentialRef": credentialRef,
	}
	switch request.Kind {
	case KindVM:
		if firstNonEmpty(textValue(specification, "environmentImageId"), textValue(specification, "environmentId"), textValue(specification, "templateId"), textValue(specification, "domain")) == "" {
			missing = append(missing, "specification.environmentImageId")
		}
		if diskBytes, ok := numberValue(specification, "diskBytes"); !ok || diskBytes < 1<<30 {
			missing = append(missing, "specification.diskBytes")
		}
		if runtime.GOOS == "windows" && textValue(specification, "environmentRoot") == "" {
			missing = append(missing, "specification.environmentRoot")
		}
	case KindEndpoint, KindAPIBridge:
		service, err := authorizedService(policy, candidates[0])
		if err != nil {
			return nil, nil, err
		}
		normalized["service"] = map[string]any{"id": service.ID, "baseUrl": service.BaseURL, "mode": service.Mode}
		routes, err := normalizeRoutes(specification["routes"])
		if err != nil {
			return nil, nil, err
		}
		if len(routes) == 0 {
			missing = append(missing, "specification.routes")
		} else {
			specification["routes"] = routes
		}
		healthPath := firstNonEmpty(textValue(specification, "healthPath"), "/health")
		if !safeRoutePath(healthPath) {
			return nil, nil, errors.New("specification.healthPath must be an absolute normalized path")
		}
		specification["healthPath"] = healthPath
		protocol := strings.ToLower(firstNonEmpty(textValue(specification, "protocol"), "generic_http"))
		if !map[string]bool{"openapi": true, "openai": true, "generic_http": true, "sse": true}[protocol] {
			return nil, nil, errors.New("specification.protocol is unsupported")
		}
		specification["protocol"] = protocol
	}
	return normalized, uniqueStrings(missing), nil
}

func authorizedService(policy SellerAutomationPolicy, candidate Candidate) (AllowedService, error) {
	for _, service := range policy.AllowedServices {
		if service.ID == candidate.ServiceID && service.Mode == candidate.Kind && serviceFingerprint(service) == candidate.SourceFingerprint {
			return service, nil
		}
	}
	return AllowedService{}, errors.New("candidate service is no longer authorized or changed")
}

func normalizeRoutes(value any) ([]map[string]any, error) {
	raw, ok := value.([]any)
	if !ok {
		if typed, typedOK := value.([]map[string]any); typedOK {
			raw = make([]any, len(typed))
			for i := range typed {
				raw[i] = typed[i]
			}
		}
	}
	if len(raw) == 0 {
		return nil, nil
	}
	if len(raw) > 200 {
		return nil, errors.New("one draft may expose at most 200 routes")
	}
	seen := map[string]bool{}
	out := make([]map[string]any, 0, len(raw))
	for index, item := range raw {
		route, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("route %d is not an object", index+1)
		}
		operationID := strings.TrimSpace(textValue(route, "operationId"))
		method := strings.ToUpper(strings.TrimSpace(textValue(route, "method")))
		routePath := strings.TrimSpace(textValue(route, "path"))
		if !operationIDPattern.MatchString(operationID) || method == "" || !safeRoutePath(routePath) {
			return nil, fmt.Errorf("route %d requires a valid operationId, method, and absolute path", index+1)
		}
		key := method + " " + routePath
		if seen[key] {
			return nil, errors.New("duplicate route " + key)
		}
		seen[key] = true
		pricing, err := normalizeRoutePricing(route["pricing"])
		if err != nil {
			return nil, fmt.Errorf("route %s: %w", operationID, err)
		}
		if len(pricing) == 0 {
			return nil, fmt.Errorf("route %s requires explicit pricing or a saved route pricing default", operationID)
		}
		normalized := cloneMap(route)
		normalized["operationId"] = operationID
		normalized["method"] = method
		normalized["path"] = routePath
		normalized["displayName"] = firstNonEmpty(textValue(route, "displayName"), textValue(route, "title"), operationID)
		normalized["pricing"] = pricing
		out = append(out, normalized)
	}
	return out, nil
}

func normalizeRoutePricing(value any) ([]map[string]any, error) {
	raw, ok := value.([]any)
	if !ok {
		if typed, typedOK := value.([]map[string]any); typedOK {
			raw = make([]any, len(typed))
			for i := range typed {
				raw[i] = typed[i]
			}
		}
	}
	out := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		component, ok := item.(map[string]any)
		if !ok {
			return nil, errors.New("pricing component must be an object")
		}
		rate, hasRate := numberValue(component, "rateAtomic")
		per, hasPer := numberValue(component, "per")
		if !hasRate || rate < 0 || !hasPer || per <= 0 {
			return nil, errors.New("pricing rateAtomic must be non-negative and per must be positive")
		}
		dimension := firstNonEmpty(textValue(component, "dimension"), "request")
		meterSource := firstNonEmpty(textValue(component, "meterSource"), "gateway")
		chargeOn := firstNonEmpty(textValue(component, "chargeOn"), "started")
		if !map[string]bool{"request": true, "successful_request": true, "input_tokens": true, "output_tokens": true, "input_bytes": true, "output_bytes": true, "execution_second": true, "image": true, "provider_reported": true}[dimension] {
			return nil, errors.New("unsupported pricing dimension")
		}
		if !map[string]bool{"gateway": true, "protocol_adapter": true, "openai_usage": true, "provider_response": true}[meterSource] || !map[string]bool{"started": true, "succeeded": true, "completed": true}[chargeOn] {
			return nil, errors.New("unsupported pricing meterSource or chargeOn")
		}
		normalized := cloneMap(component)
		normalized["dimension"], normalized["meterSource"], normalized["chargeOn"] = dimension, meterSource, chargeOn
		out = append(out, normalized)
	}
	return out, nil
}

func safeRoutePath(value string) bool {
	if !strings.HasPrefix(value, "/") || strings.ContainsAny(value, "?#\\") {
		return false
	}
	decoded, err := url.PathUnescape(value)
	return err == nil && strings.HasPrefix(decoded, "/") && path.Clean(decoded) == decoded && !strings.Contains(decoded, "\\")
}

func validateNonNegativeNumbers(value any, field string) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if err := validateNonNegativeNumbers(child, field+"."+key); err != nil {
				return err
			}
		}
	case []any:
		for index, child := range typed {
			if err := validateNonNegativeNumbers(child, fmt.Sprintf("%s[%d]", field, index)); err != nil {
				return err
			}
		}
	case float64:
		if typed < 0 {
			return fmt.Errorf("%s must not be negative", field)
		}
	case float32:
		if typed < 0 {
			return fmt.Errorf("%s must not be negative", field)
		}
	case int:
		if typed < 0 {
			return fmt.Errorf("%s must not be negative", field)
		}
	case int64:
		if typed < 0 {
			return fmt.Errorf("%s must not be negative", field)
		}
	case json.Number:
		number, err := typed.Float64()
		if err != nil || number < 0 {
			return fmt.Errorf("%s must be a non-negative number", field)
		}
	}
	return nil
}

func mapValue(value map[string]any, key string) map[string]any {
	if value == nil {
		return nil
	}
	typed, _ := value[key].(map[string]any)
	return typed
}

func textValue(value map[string]any, key string) string {
	if value == nil {
		return ""
	}
	text, _ := value[key].(string)
	return strings.TrimSpace(text)
}

func numberValue(value map[string]any, key string) (float64, bool) {
	if value == nil {
		return 0, false
	}
	switch typed := value[key].(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil
	}
	return 0, false
}

func mergeMap(target, source map[string]any) {
	for key, value := range source {
		if child, ok := value.(map[string]any); ok {
			nested, _ := target[key].(map[string]any)
			if nested == nil {
				nested = map[string]any{}
			}
			mergeMap(nested, child)
			target[key] = nested
			continue
		}
		target[key] = value
	}
}

func cloneMap(source map[string]any) map[string]any {
	out := map[string]any{}
	mergeMap(out, source)
	return out
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}
