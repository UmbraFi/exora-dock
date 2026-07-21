package sellerdraft

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"time"
)

func NormalizePolicy(input SellerAutomationPolicy, previous *SellerAutomationPolicy) (SellerAutomationPolicy, error) {
	now := time.Now().UTC()
	input.SchemaVersion = "seller-api-build-policy.v1"
	if previous == nil {
		input.PolicyID, input.Version = newID("sap"), 1
	} else {
		input.PolicyID, input.Version = previous.PolicyID, previous.Version+1
	}
	if input.Enabled {
		input.EnabledKinds = []string{KindAPI}
	} else {
		input.EnabledKinds = nil
	}
	seen := map[string]bool{}
	for index := range input.AllowedRoots {
		root := &input.AllowedRoots[index]
		root.ID = strings.TrimSpace(root.ID)
		if root.ID == "" {
			root.ID = fmt.Sprintf("root_%d", index+1)
		}
		if seen[root.ID] {
			return SellerAutomationPolicy{}, fmt.Errorf("duplicate allowed root id %q", root.ID)
		}
		seen[root.ID] = true
		absolute, err := filepath.Abs(strings.TrimSpace(root.Path))
		if err != nil {
			return SellerAutomationPolicy{}, errors.New("allowed root is invalid")
		}
		resolved, err := filepath.EvalSymlinks(absolute)
		if err != nil {
			return SellerAutomationPolicy{}, fmt.Errorf("allowed root %q is unavailable", root.ID)
		}
		root.Path, root.Kinds = filepath.Clean(resolved), []string{KindAPI}
	}
	for index := range input.AllowedServices {
		service := &input.AllowedServices[index]
		service.ID, service.Mode = strings.TrimSpace(service.ID), strings.ToLower(strings.TrimSpace(service.Mode))
		if service.ID == "" {
			service.ID = fmt.Sprintf("service_%d", index+1)
		}
		if service.Mode != "local_dock" && service.Mode != "cloud_direct" {
			return SellerAutomationPolicy{}, errors.New("service deliveryMode must be local_dock or cloud_direct")
		}
		parsed, err := url.Parse(strings.TrimSpace(service.BaseURL))
		if err != nil || parsed.User != nil || parsed.Hostname() == "" || parsed.Scheme != "http" && parsed.Scheme != "https" {
			return SellerAutomationPolicy{}, errors.New("allowed service baseUrl is invalid")
		}
		if service.Mode == "cloud_direct" && parsed.Scheme != "https" {
			return SellerAutomationPolicy{}, errors.New("cloud_direct service must use HTTPS")
		}
		service.BaseURL = strings.TrimRight(parsed.String(), "/")
	}
	if input.Enabled && len(input.AllowedRoots) == 0 && len(input.AllowedServices) == 0 {
		return SellerAutomationPolicy{}, errors.New("at least one authorized project root or service is required")
	}
	if input.Enabled {
		input.ApprovedAt = now.Format(time.RFC3339Nano)
	}
	input.UpdatedAt = now.Format(time.RFC3339Nano)
	copy := input
	copy.Hash = ""
	raw, _ := json.Marshal(copy)
	sum := sha256.Sum256(raw)
	input.Hash = hex.EncodeToString(sum[:])
	return input, nil
}
