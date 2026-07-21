package sellerdraft

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/endpoint"
)

type ServiceOptions struct {
	Store          *Store
	Vault          *CredentialVault
	DataDir        string
	CloudURL       string
	CloudTokenPath string
	HTTPClient     *http.Client
	EndpointStore  *endpoint.Store
	NotifyEndpoint func()
}
type Service struct {
	store             *Store
	vault             *CredentialVault
	cloud             cloudClient
	endpointStore     *endpoint.Store
	notifyEndpoint    func()
	draftMu           sync.RWMutex
	runMu             sync.Mutex
	validationCancels map[string]context.CancelFunc
}

func NewService(options ServiceOptions) *Service {
	service := &Service{store: options.Store, vault: options.Vault, cloud: newCloudClient(options.CloudURL, options.CloudTokenPath, options.HTTPClient), endpointStore: options.EndpointStore, notifyEndpoint: options.NotifyEndpoint, validationCancels: map[string]context.CancelFunc{}}
	if service.store != nil {
		_ = service.store.PurgeLegacyAPIDrafts()
		for _, draft := range service.store.APIDrafts() {
			changed := false
			for operationID, review := range draft.Operations {
				if capabilityString(review.ValidationRun["status"]) == "running" {
					review.ValidationRun["status"], review.ValidationRun["completedAt"], review.ValidationRun["failure"] = "failed", time.Now().UTC().Format(time.RFC3339Nano), "Dock restarted before the persisted validation run completed. Start a new run with a new idempotency key."
					review.IntegrationStatus = "failed"
					draft.Operations[operationID], changed = review, true
				}
			}
			if changed {
				draft.Version++
				draft.UpdatedAt = time.Now().UTC()
				_ = service.store.SaveAPIDraft(draft)
			}
			_ = service.syncTunnelEndpoint(context.Background(), draft)
		}
		service.notifyTunnelEndpoint()
	}
	return service
}
func (s *Service) AccountID() string {
	if s == nil || s.store == nil {
		return ""
	}
	return s.store.AccountID()
}
func (s *Service) Store() *Store                          { return s.store }
func (s *Service) Policy() (SellerAutomationPolicy, bool) { return s.store.Policy() }
func (s *Service) SavePolicy(input SellerAutomationPolicy) (SellerAutomationPolicy, error) {
	var previous *SellerAutomationPolicy
	if value, ok := s.store.Policy(); ok {
		previous = &value
	}
	policy, err := NormalizePolicy(input, previous)
	if err != nil {
		return SellerAutomationPolicy{}, err
	}
	return policy, s.store.SavePolicy(policy)
}
func (s *Service) enabledPolicy() (SellerAutomationPolicy, error) {
	policy, ok := s.store.Policy()
	if !ok || !policy.Enabled {
		return SellerAutomationPolicy{}, errors.New("provider integration policy is not enabled")
	}
	return policy, nil
}
func (s *Service) Capabilities() (map[string]any, error) {
	return map[string]any{
		"enabled": true, "applicationSource": KindAPI,
		"schemaVersions":   map[string]string{"contract": APIContractSchemaVersion, "api": APISchemaVersion, "operation": OperationSchemaVersion, "pricing": "exora.operation-pricing.v4", "settlement": settlementPolicyV4, "validationPlan": validationPlanVersion, "validationReceipt": validationReceiptVersion, "billingPlan": billingPlanVersion, "billingReceipt": billingReceiptVersion},
		"pricingFormula":   map[string]any{"language": priceFormulaLanguage, "settlementPolicy": settlementPolicyV4, "manualOwnerEntryOnly": true, "maximumChargeRequired": true, "reservedVariables": map[string]any{"delivered": map[string]any{"source": "cloud", "minimum": 0, "maximum": 1}}},
		"deliveryModes":    []string{"local_dock", "cloud_direct"},
		"skill":            "skills/prepare-exora-api/SKILL.md",
		"preparationGuide": map[string]any{"tool": "exora.get_api_preparation_guide", "version": "exora.api-preparation-guide.v3", "stateful": false},
		"permissions":      map[string]any{"submitContract": true, "submitCapability": true, "runContractValidation": false, "confirmContract": false, "publish": false, "readCredentialValues": false},
	}, nil
}
func (s *Service) PutCredential(meta CredentialMetadata, secret string) (CredentialMetadata, error) {
	return s.vault.Put(meta, secret)
}
func (s *Service) ListCredentials() ([]CredentialMetadata, error) { return s.vault.List() }
func (s *Service) DeleteCredential(id string) error               { return s.vault.Delete(id) }
func compactKinds(values []string) []string {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), KindAPI) {
			return []string{KindAPI}
		}
	}
	return nil
}
func containsKind(values []string, kind string) bool {
	for _, value := range values {
		if value == kind {
			return true
		}
	}
	return false
}
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
func sortedKeys(values map[string]string) []string {
	out := make([]string, 0, len(values))
	for key := range values {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}
