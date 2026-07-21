package sellerdraft

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNormalizePolicyEnablesAuthorizedServiceWithoutCommercialSettings(t *testing.T) {
	policy, err := NormalizePolicy(SellerAutomationPolicy{
		Enabled: true,
		AllowedServices: []AllowedService{{
			ID:      "documents",
			Mode:    "cloud_direct",
			BaseURL: "https://api.example.com/",
		}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !policy.Enabled || len(policy.EnabledKinds) != 1 || policy.EnabledKinds[0] != KindAPI {
		t.Fatalf("unexpected normalized policy: %#v", policy)
	}
	if policy.AllowedServices[0].BaseURL != "https://api.example.com" {
		t.Fatalf("service URL was not normalized: %q", policy.AllowedServices[0].BaseURL)
	}
}

func TestSellerAutomationPolicyIgnoresRemovedSettings(t *testing.T) {
	var policy SellerAutomationPolicy
	legacy := `{"enabled":false,"defaults":{"api":{}},"attestations":{"pricing":true},"limits":{"maxFiles":10}}`
	if err := json.Unmarshal([]byte(legacy), &policy); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	serialized := string(raw)
	for _, removed := range []string{"defaults", "attestations", "limits"} {
		if strings.Contains(serialized, `"`+removed+`"`) {
			t.Fatalf("removed setting %q was serialized: %s", removed, serialized)
		}
	}
}
