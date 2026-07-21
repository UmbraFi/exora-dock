package sellerdraft

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/exora-dock/exora-dock/internal/endpoint"
)

// v4TunnelEndpointID is shared by convention with Cloud. Hashing keeps the
// private tunnel identifier bounded even if a future API UID format grows.
func v4TunnelEndpointID(apiID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(apiID)))
	return "epd_v4_" + hex.EncodeToString(sum[:])
}

func (s *Service) notifyTunnelEndpoint() {
	if s != nil && s.notifyEndpoint != nil {
		s.notifyEndpoint()
	}
}

func (s *Service) syncTunnelEndpoint(ctx context.Context, draft APIDraft) error {
	if s == nil || s.endpointStore == nil {
		return nil
	}
	endpointID := v4TunnelEndpointID(draft.APIID)
	if draft.DeliveryMode != "local_dock" || draft.Status != "live" || !hasActiveOperation(draft) {
		s.endpointStore.Delete(endpointID)
		s.notifyTunnelEndpoint()
		return nil
	}
	if err := s.saveTunnelEndpoint(ctx, draft); err != nil {
		return err
	}
	s.notifyTunnelEndpoint()
	return nil
}

func (s *Service) saveTunnelEndpoint(ctx context.Context, draft APIDraft) error {
	if s == nil || s.endpointStore == nil {
		return errors.New("local API tunnel endpoint store is unavailable")
	}
	manifest, timeoutSeconds, concurrency, err := tunnelManifestFromDraft(draft)
	if err != nil {
		return err
	}
	runtime := mapValue(draft.Capability["runtime"])
	cfg := endpoint.Config{
		EndpointID:      v4TunnelEndpointID(draft.APIID),
		LocalBaseURL:    capabilityString(runtime["publicBaseUrl"]),
		HealthPath:      capabilityString(runtime["healthPath"]),
		ServiceManifest: manifest,
		AuthType:        "none",
		TimeoutSeconds:  timeoutSeconds,
		Concurrency:     concurrency,
	}
	if previous, found := s.endpointStore.Get(cfg.EndpointID); found {
		cfg.LastProbeHealthy = previous.LastProbeHealthy
		cfg.LastProbeAt = previous.LastProbeAt
		cfg.LastProbeError = previous.LastProbeError
	}
	_, err = s.endpointStore.Save(ctx, cfg)
	return err
}

func tunnelManifestFromDraft(draft APIDraft) (map[string]any, int, int, error) {
	contract, err := cloneCapability(mapValue(draft.Capability["interface"]))
	if err != nil || len(contract) == 0 {
		return nil, 0, 0, errors.New("local API tunnel requires an OpenAPI interface")
	}
	policies := make([]any, 0)
	maximumTimeout, maximumConcurrency := 1, 1
	for _, raw := range sliceValue(draft.Capability["operations"]) {
		operation := mapValue(raw)
		operationID := capabilityString(operation["operationId"])
		if operationID == "" {
			return nil, 0, 0, errors.New("local API tunnel operationId is required")
		}
		limits := mapValue(operation["limits"])
		timeout, _ := pricingInteger(limits["timeoutSeconds"])
		maxRequest, _ := pricingInteger(limits["maximumRequestBytes"])
		maxResponse, _ := pricingInteger(limits["maximumResponseBytes"])
		maxConcurrency, _ := pricingInteger(limits["maximumConcurrency"])
		if timeout > int64(maximumTimeout) {
			maximumTimeout = int(timeout)
		}
		if maxConcurrency > int64(maximumConcurrency) {
			maximumConcurrency = int(maxConcurrency)
		}
		behavior := mapValue(operation["behavior"])
		policy := map[string]any{
			"operationId": operationID,
			"interaction": capabilityString(mapValue(operation["interaction"])["mode"]),
			"sideEffect":  mapValue(behavior["sideEffect"])["present"] == true,
			"idempotent":  mapValue(behavior["idempotency"])["supported"] == true,
			"limits": map[string]any{
				"timeoutSeconds":   timeout,
				"maxRequestBytes":  maxRequest,
				"maxResponseBytes": maxResponse,
			},
		}
		policies = append(policies, policy)
	}
	if len(policies) == 0 {
		return nil, 0, 0, errors.New("local API tunnel requires at least one operation")
	}
	return map[string]any{"interface": contract, "delivery": "dock_tunnel", "operationPolicies": policies}, maximumTimeout, maximumConcurrency, nil
}
