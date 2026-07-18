package sellerdraft

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
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
		if request.Kind == KindResources {
			if _, ok := numberValue(price, "amount"); !ok {
				missing = append(missing, "commercial.price.amount")
			}
			if textValue(price, "currency") == "" {
				missing = append(missing, "commercial.price.currency")
			}
		} else if request.Kind == KindVM {
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
	if request.Kind == KindVM && price != nil {
		canonicalPrice, hasRate, err := normalizeVMPrice(price, commercial)
		if err != nil {
			return nil, nil, err
		}
		if !hasRate {
			missing = append(missing, "commercial.price.amount")
		} else {
			price = canonicalPrice
			commercial["price"] = canonicalPrice
		}
		canonicalLimits, err := normalizeVMLimits(limits)
		if err != nil {
			return nil, nil, err
		}
		limits = canonicalLimits
		commercial["limits"] = canonicalLimits
		sustained := "allowed"
		if allowed, explicit := commercial["allowSustainedCompute"].(bool); explicit && !allowed {
			sustained = "burst_only"
		}
		commercial["workloadPolicy"] = map[string]any{"policyVersion": "compute_load_v1", "sustainedCompute": sustained, "cryptocurrencyMining": "prohibited"}
		commercial["performancePolicy"] = map[string]any{"probeVersion": "dual_probe_v1", "minimumDeliveryBps": 8500}
	}
	normalized := map[string]any{
		"title": title, "description": description, "commercial": commercial,
		"price": price, "limits": limits, "workloadPolicy": commercial["workloadPolicy"], "performancePolicy": commercial["performancePolicy"], "specification": specification, "credentialRef": credentialRef,
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
	case KindResources:
		if textValue(specification, "version") == "" {
			missing = append(missing, "specification.version")
		}
		if textValue(specification, "license") == "" {
			missing = append(missing, "specification.license")
		}
		if delivery := textValue(specification, "delivery"); delivery != "" && delivery != "downloadable" {
			return nil, nil, errors.New("specification.delivery must be downloadable; Resources cannot be mounted into a VM")
		}
		specification["delivery"] = "downloadable"
	case KindEndpoint, KindAPIBridge:
		return nil, nil, errors.New("Endpoint and API Bridge require an Agent-normalized ExoraServiceManifest v1 draft")
	}
	return normalized, uniqueStrings(missing), nil
}

func normalizeVMPrice(price, commercial map[string]any) (map[string]any, bool, error) {
	currency := strings.ToUpper(textValue(price, "currency"))
	if currency == "" {
		currency = "USDC"
	}
	if currency != "USDC" {
		return nil, false, errors.New("commercial.price.currency must be USDC for VM listings")
	}
	rateAtomic, hasAtomic := numberValue(price, "amountAtomicPerMinute")
	if !hasAtomic {
		amount, ok := numberValue(price, "amount")
		if !ok {
			amount, ok = numberValue(price, "amountPerMinute")
		}
		if !ok {
			return nil, false, nil
		}
		rateAtomic = math.Round(amount * 1_000_000)
	}
	if rateAtomic < 1 || rateAtomic > math.MaxInt64 || rateAtomic != math.Trunc(rateAtomic) {
		return nil, false, errors.New("commercial.price.amount must produce a positive atomic USDC minute rate")
	}
	baseAtomic, hasBaseAtomic := numberValue(price, "baseFeeAtomic")
	if !hasBaseAtomic {
		baseAmount, hasBase := numberValue(price, "baseFee")
		if baseObject := mapValue(price, "baseFee"); baseObject != nil {
			enabled, hasEnabled := baseObject["enabled"].(bool)
			if hasEnabled && !enabled {
				baseAmount, hasBase = 0, true
			} else if amount, ok := numberValue(baseObject, "amount"); ok {
				baseAmount, hasBase = amount, true
			}
		}
		if enabled, explicit := commercial["baseFeeEnabled"].(bool); explicit && !enabled {
			baseAmount, hasBase = 0, true
		} else if !hasBase {
			baseAmount, hasBase = numberValue(commercial, "baseFee")
		}
		if hasBase {
			baseAtomic = math.Round(baseAmount * 1_000_000)
		}
	}
	if baseAtomic < 0 || baseAtomic > math.MaxInt64 || baseAtomic != math.Trunc(baseAtomic) {
		return nil, false, errors.New("commercial.price.baseFee must be a valid non-negative USDC amount")
	}
	out := map[string]any{
		"model": "compute_time_v2", "currency": "USDC", "unit": "minute",
		"amountAtomicPerMinute": int64(rateAtomic), "baseFeeAtomic": int64(baseAtomic),
	}
	discount := mapValue(price, "longDurationDiscount")
	if discount == nil {
		discount = mapValue(commercial, "longDurationDiscount")
	}
	discountExplicitlyDisabled := false
	if enabled, explicit := commercial["longDiscountEnabled"].(bool); explicit && !enabled && discount == nil {
		discountExplicitlyDisabled = true
	}
	if discount == nil {
		discount = map[string]any{}
	}
	every, hasEvery := firstNumber(discount, "everyMinutes", "afterMinutes")
	if !hasEvery {
		every, hasEvery = firstNumber(commercial, "longDiscountAfterMinutes")
	}
	additionalBPS, hasAdditionalBPS := numberValue(discount, "additionalBpsOff")
	if !hasAdditionalBPS {
		percent, ok := firstNumber(discount, "additionalPercentOff", "percentEach")
		if !ok {
			percent, ok = firstNumber(commercial, "longDiscountPercent")
		}
		if ok {
			additionalBPS, hasAdditionalBPS = math.Round(percent*100), true
		}
	}
	minimumBPS, hasMinimumBPS := numberValue(discount, "minimumRateBps")
	if !hasMinimumBPS {
		percent, ok := firstNumber(discount, "minimumRatePercent", "minimumPricePercent")
		if !ok {
			percent, ok = firstNumber(commercial, "longDiscountMinimumPricePercent")
		}
		if ok {
			minimumBPS, hasMinimumBPS = math.Round(percent*100), true
		}
	}
	if !discountExplicitlyDisabled && (hasEvery || hasAdditionalBPS || hasMinimumBPS) {
		if !hasEvery {
			every = 60
		}
		if !hasMinimumBPS {
			minimumBPS = 5000
		}
		if every < 1 || every > 10080 || every != math.Trunc(every) || additionalBPS < 1 || additionalBPS > 9000 || additionalBPS != math.Trunc(additionalBPS) || minimumBPS < 100 || minimumBPS > 10000 || minimumBPS != math.Trunc(minimumBPS) {
			return nil, false, errors.New("commercial long-duration discount is invalid")
		}
		out["longDurationDiscount"] = map[string]any{
			"everyMinutes": int64(every), "additionalBpsOff": int64(additionalBPS), "minimumRateBps": int64(minimumBPS),
		}
	}
	return out, true, nil
}

func normalizeVMLimits(limits map[string]any) (map[string]any, error) {
	minimum, ok := firstNumber(limits, "minMinutes", "minimumMinutes")
	if !ok {
		minimum = 10
	}
	maximum, ok := firstNumber(limits, "maxMinutes", "maximumMinutes")
	if !ok {
		maximum = 240
	}
	if minimum < 1 || maximum < minimum || maximum > 10080 || minimum != math.Trunc(minimum) || maximum != math.Trunc(maximum) {
		return nil, errors.New("commercial.limits must use whole minutes with 1 <= minMinutes <= maxMinutes <= 10080")
	}
	return map[string]any{"minMinutes": int64(minimum), "maxMinutes": int64(maximum)}, nil
}

func firstNumber(value map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		if number, ok := numberValue(value, key); ok {
			return number, true
		}
	}
	return 0, false
}

func authorizedService(policy SellerAutomationPolicy, candidate Candidate) (AllowedService, error) {
	for _, service := range policy.AllowedServices {
		if service.ID == candidate.ServiceID && service.Mode == candidate.Kind && serviceFingerprint(service) == candidate.SourceFingerprint {
			return service, nil
		}
	}
	return AllowedService{}, errors.New("candidate service is no longer authorized or changed")
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
