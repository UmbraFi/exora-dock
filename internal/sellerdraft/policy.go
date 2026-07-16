package sellerdraft

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var supportedKinds = map[string]bool{
	KindVM: true, KindResources: true, KindEndpoint: true, KindAPIBridge: true,
}

func NormalizePolicy(input SellerAutomationPolicy, previous *SellerAutomationPolicy) (SellerAutomationPolicy, error) {
	now := time.Now().UTC()
	input.SchemaVersion = "seller-automation-policy.v1"
	if previous != nil {
		input.PolicyID = previous.PolicyID
		input.Version = previous.Version + 1
	} else {
		input.PolicyID = newID("sap")
		input.Version = 1
	}
	input.EnabledKinds = compactKinds(input.EnabledKinds)
	if input.Enabled && len(input.EnabledKinds) == 0 {
		return SellerAutomationPolicy{}, fmt.Errorf("at least one seller resource kind must be enabled")
	}
	seenRoots := map[string]bool{}
	for i := range input.AllowedRoots {
		root := &input.AllowedRoots[i]
		root.ID = strings.TrimSpace(root.ID)
		if root.ID == "" {
			root.ID = fmt.Sprintf("root_%d", i+1)
		}
		if seenRoots[root.ID] {
			return SellerAutomationPolicy{}, fmt.Errorf("duplicate allowed root id %q", root.ID)
		}
		seenRoots[root.ID] = true
		absolute, err := filepath.Abs(strings.TrimSpace(root.Path))
		if err != nil || absolute == "" {
			return SellerAutomationPolicy{}, fmt.Errorf("allowed root %q is invalid", root.ID)
		}
		resolved, err := filepath.EvalSymlinks(absolute)
		if err != nil {
			return SellerAutomationPolicy{}, fmt.Errorf("allowed root %q is unavailable: %w", root.ID, err)
		}
		root.Path = filepath.Clean(resolved)
		root.Kinds = compactKinds(root.Kinds)
		if len(root.Kinds) == 0 {
			root.Kinds = []string{KindResources, KindEndpoint, KindAPIBridge}
		}
	}
	seenServices := map[string]bool{}
	for i := range input.AllowedServices {
		service := &input.AllowedServices[i]
		service.ID = strings.TrimSpace(service.ID)
		if service.ID == "" {
			service.ID = fmt.Sprintf("service_%d", i+1)
		}
		if seenServices[service.ID] {
			return SellerAutomationPolicy{}, fmt.Errorf("duplicate allowed service id %q", service.ID)
		}
		seenServices[service.ID] = true
		service.Mode = strings.ToLower(strings.TrimSpace(service.Mode))
		if service.Mode != KindEndpoint && service.Mode != KindAPIBridge {
			return SellerAutomationPolicy{}, fmt.Errorf("allowed service %q mode must be endpoint or api_bridge", service.ID)
		}
		parsed, err := url.Parse(strings.TrimSpace(service.BaseURL))
		if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
			return SellerAutomationPolicy{}, fmt.Errorf("allowed service %q baseUrl is invalid", service.ID)
		}
		if service.Mode == KindAPIBridge && parsed.Scheme != "https" {
			return SellerAutomationPolicy{}, fmt.Errorf("API Bridge service %q must use HTTPS", service.ID)
		}
		service.BaseURL = strings.TrimRight(parsed.String(), "/")
	}
	if input.Defaults == nil {
		input.Defaults = map[string]map[string]any{}
	}
	input.Limits = normalizeLimits(input.Limits)
	if input.Enabled {
		if !input.Attestations.Pricing || !input.Attestations.Rights {
			return SellerAutomationPolicy{}, fmt.Errorf("pricing and rights attestations are required before seller automation can be enabled")
		}
		if containsKind(input.EnabledKinds, KindVM) && !input.Attestations.Runtime {
			return SellerAutomationPolicy{}, fmt.Errorf("runtime attestation is required for VM seller automation")
		}
		if (containsKind(input.EnabledKinds, KindEndpoint) || containsKind(input.EnabledKinds, KindAPIBridge)) && (!input.Attestations.Runtime || !input.Attestations.APIUsage) {
			return SellerAutomationPolicy{}, fmt.Errorf("runtime and API usage attestations are required for service seller automation")
		}
		input.ApprovedAt = now.Format(time.RFC3339Nano)
	}
	input.UpdatedAt = now.Format(time.RFC3339Nano)
	input.Hash = policyHash(input)
	return input, nil
}

func Receipt(policy SellerAutomationPolicy) PolicyReceipt {
	return PolicyReceipt{PolicyID: policy.PolicyID, Version: policy.Version, Hash: policy.Hash, ApprovedAt: policy.ApprovedAt, Attestations: policy.Attestations}
}

func KindEnabled(policy SellerAutomationPolicy, kind string) bool {
	return policy.Enabled && containsKind(policy.EnabledKinds, kind)
}

func ApplyDefaults(policy SellerAutomationPolicy, kind string, explicit map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range policy.Defaults[kind] {
		out[key] = value
	}
	for key, value := range explicit {
		out[key] = value
	}
	return out
}

func compactKinds(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if supportedKinds[value] && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}

func containsKind(values []string, kind string) bool {
	for _, value := range values {
		if value == kind {
			return true
		}
	}
	return false
}

func normalizeLimits(value PolicyLimits) PolicyLimits {
	if value.MaxBatch <= 0 || value.MaxBatch > 10 {
		value.MaxBatch = 10
	}
	if value.MaxFiles <= 0 || value.MaxFiles > 1000 {
		value.MaxFiles = 200
	}
	if value.MaxBundleBytes <= 0 || value.MaxBundleBytes > 1<<30 {
		value.MaxBundleBytes = 1 << 30
	}
	if value.MaxConcurrentRuns <= 0 || value.MaxConcurrentRuns > 4 {
		value.MaxConcurrentRuns = 1
	}
	return value
}

func policyHash(policy SellerAutomationPolicy) string {
	copy := policy
	copy.Hash = ""
	raw, _ := json.Marshal(copy)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
