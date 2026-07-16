package sellerdraft

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/endpoint"
	"github.com/exora-dock/exora-dock/internal/providerworker"
)

type ServiceOptions struct {
	Store          *Store
	Vault          *CredentialVault
	DataDir        string
	CloudURL       string
	CloudTokenPath string
	HTTPClient     *http.Client
	Endpoints      *endpoint.Store
	Worker         providerworker.Client
	NotifyEndpoint func()
}

type Service struct {
	store          *Store
	vault          *CredentialVault
	dataDir        string
	cloud          cloudClient
	endpoints      *endpoint.Store
	worker         providerworker.Client
	notifyEndpoint func()
	createMu       sync.Mutex
	mu             sync.Mutex
	cancels        map[string]context.CancelFunc
}

func NewService(options ServiceOptions) *Service {
	return &Service{
		store: options.Store, vault: options.Vault, dataDir: options.DataDir,
		cloud:     newCloudClient(options.CloudURL, options.CloudTokenPath, options.HTTPClient),
		endpoints: options.Endpoints, worker: options.Worker, notifyEndpoint: options.NotifyEndpoint,
		cancels: map[string]context.CancelFunc{},
	}
}

func (s *Service) Store() *Store { return s.store }

func (s *Service) SavePolicy(input SellerAutomationPolicy) (SellerAutomationPolicy, error) {
	var previous *SellerAutomationPolicy
	if current, ok := s.store.Policy(); ok {
		previous = &current
	}
	policy, err := NormalizePolicy(input, previous)
	if err != nil {
		return SellerAutomationPolicy{}, err
	}
	if err := s.store.SavePolicy(policy); err != nil {
		return SellerAutomationPolicy{}, err
	}
	// Cloud policy synchronization is intentionally best effort while the Dock is
	// offline. Agent draft creation still requires Cloud to accept this receipt.
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = s.cloud.JSON(ctx, http.MethodPut, "/v3/provider/seller-automation-policy", map[string]any{
		"policyId": policy.PolicyID, "version": policy.Version, "hash": policy.Hash, "enabled": policy.Enabled,
		"enabledKinds": policy.EnabledKinds, "approvedAt": policy.ApprovedAt, "attestations": policy.Attestations,
	}, nil)
	return policy, nil
}

func (s *Service) Policy() (SellerAutomationPolicy, bool) { return s.store.Policy() }

func (s *Service) Capabilities() (map[string]any, error) {
	policy, ok := s.store.Policy()
	if !ok {
		return map[string]any{"enabled": false, "schemaVersion": "provider.listing_drafts.mcp.v1", "setupRequired": true}, nil
	}
	credentials, err := s.vault.List()
	if err != nil {
		return nil, err
	}
	roots := make([]map[string]any, 0, len(policy.AllowedRoots))
	for _, root := range policy.AllowedRoots {
		roots = append(roots, map[string]any{"id": root.ID, "displayName": firstNonEmpty(root.DisplayName, root.ID), "kinds": root.Kinds})
	}
	host := map[string]any{"platform": runtime.GOOS, "vmSupported": runtime.GOOS == "windows" || runtime.GOOS == "linux"}
	return map[string]any{
		"schemaVersion": "provider.listing_drafts.mcp.v1", "enabled": policy.Enabled,
		"enabledKinds": policy.EnabledKinds, "allowedRoots": roots, "allowedServices": policy.AllowedServices,
		"defaults": policy.Defaults, "limits": policy.Limits, "policyReceipt": Receipt(policy),
		"credentials": credentials, "host": host,
		"permissions": map[string]any{"createPrivateDraft": true, "publish": false, "pause": false, "resumeListing": false, "retire": false, "readPlaintextCredentials": false},
	}, nil
}

func (s *Service) PutCredential(meta CredentialMetadata, secret string) (CredentialMetadata, error) {
	return s.vault.Put(meta, secret)
}
func (s *Service) ListCredentials() ([]CredentialMetadata, error) { return s.vault.List() }
func (s *Service) DeleteCredential(ref string) error              { return s.vault.Delete(ref) }

func (s *Service) Create(request CreateRequest) (Run, error) {
	request.Kind = strings.ToLower(strings.TrimSpace(request.Kind))
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	if !supportedKinds[request.Kind] {
		return Run{}, errors.New("unsupported seller draft kind")
	}
	if len(request.IdempotencyKey) < 8 || len(request.IdempotencyKey) > 128 {
		return Run{}, errors.New("idempotencyKey must contain 8 to 128 characters")
	}
	policy, err := s.enabledPolicy()
	if err != nil {
		return Run{}, err
	}
	if !KindEnabled(policy, request.Kind) {
		return Run{}, fmt.Errorf("seller automation for %s is not enabled", request.Kind)
	}
	fingerprint := requestFingerprint(request)
	if previous, found := s.store.FindRunByIdempotency(request.Kind, request.IdempotencyKey); found {
		if requestFingerprint(previous.Request) != fingerprint {
			return Run{}, errors.New("idempotencyKey reused with different input")
		}
		return previous, nil
	}
	if len(request.CandidateIDs) == 0 {
		return Run{}, errors.New("at least one discovered candidateId is required")
	}
	if request.Kind == KindResources {
		if len(request.CandidateIDs) > policy.Limits.MaxFiles {
			return Run{}, fmt.Errorf("resource file count exceeds policy limit of %d", policy.Limits.MaxFiles)
		}
	} else if len(request.CandidateIDs) != 1 {
		return Run{}, errors.New("VM, Endpoint, and API Bridge runs require exactly one target candidate")
	}
	s.createMu.Lock()
	defer s.createMu.Unlock()
	// Recheck while holding the create lock so concurrent retries cannot create
	// duplicate Products or Listings.
	if previous, found := s.store.FindRunByIdempotency(request.Kind, request.IdempotencyKey); found {
		if requestFingerprint(previous.Request) != fingerprint {
			return Run{}, errors.New("idempotencyKey reused with different input")
		}
		return previous, nil
	}
	active := 0
	for _, existing := range s.store.ListRuns(0) {
		switch existing.Status {
		case StatusCompleted, StatusNeedsInput, StatusFailed, StatusCancelled:
		default:
			active++
		}
	}
	if active >= policy.Limits.MaxConcurrentRuns {
		return Run{}, fmt.Errorf("seller draft concurrency limit of %d reached", policy.Limits.MaxConcurrentRuns)
	}
	run, err := s.store.CreateRun(request, Receipt(policy))
	if err != nil {
		return Run{}, err
	}
	s.start(run.RunID)
	return run, nil
}

func (s *Service) Get(runID string) (Run, bool) { return s.store.GetRun(runID) }

func (s *Service) List(limit int) []Run {
	if limit <= 0 {
		limit = 50
	} else if limit > 100 {
		limit = 100
	}
	return s.store.ListRuns(limit)
}

// RecoverInterrupted restarts durable non-terminal runs after a daemon restart.
// Resource runs retain their multipart upload id and completed part ETags, so
// deterministic re-packaging can continue with only the missing parts.
func (s *Service) RecoverInterrupted() {
	for _, run := range s.store.ListRuns(500) {
		switch run.Status {
		case StatusQueued, StatusDiscovering, StatusValidating, StatusPackaging, StatusUploading, StatusProbing, StatusReserving, StatusCreatingDraft:
			_ = os.RemoveAll(filepath.Join(s.dataDir, "seller-automation", "runs", run.RunID))
			_, err := s.store.UpdateRun(run.RunID, 0, func(current *Run) error {
				current.Status = StatusQueued
				current.CurrentStep = StatusQueued
				current.NextAction = "Dock recovered this durable draft run after restart."
				current.Error = ""
				return nil
			})
			if err == nil {
				s.start(run.RunID)
			}
		}
	}
}

func (s *Service) Resume(request ResumeRequest) (Run, error) {
	if strings.TrimSpace(request.IdempotencyKey) == "" {
		return Run{}, errors.New("idempotencyKey is required")
	}
	fingerprint := mutationFingerprint(request.RunID, request.ExpectedStateVersion, request.Values)
	if run, replay, err := s.store.ReplayMutation("resume:"+request.RunID, request.IdempotencyKey, fingerprint); err != nil || replay {
		return run, err
	}
	s.createMu.Lock()
	defer s.createMu.Unlock()
	policy, err := s.enabledPolicy()
	if err != nil {
		return Run{}, err
	}
	active := 0
	for _, existing := range s.store.ListRuns(500) {
		if existing.RunID != request.RunID && activeSellerDraftStatus(existing.Status) {
			active++
		}
	}
	if active >= policy.Limits.MaxConcurrentRuns {
		return Run{}, fmt.Errorf("seller draft concurrency limit of %d reached", policy.Limits.MaxConcurrentRuns)
	}
	run, err := s.store.UpdateRun(request.RunID, request.ExpectedStateVersion, func(run *Run) error {
		if run.Status != StatusNeedsInput && run.Status != StatusFailed {
			return fmt.Errorf("run cannot be resumed from %s", run.Status)
		}
		mergeResumeValues(&run.Request, request.Values)
		run.Status = StatusQueued
		run.Progress = 0
		run.CurrentStep = StatusQueued
		run.NextAction = "Dock will resume validation with the supplied values."
		run.MissingFields = nil
		run.Error = ""
		return nil
	})
	if err != nil {
		return Run{}, err
	}
	_ = s.store.SaveMutation("resume:"+request.RunID, request.IdempotencyKey, fingerprint, run)
	s.start(run.RunID)
	return run, nil
}

func activeSellerDraftStatus(status string) bool {
	switch status {
	case StatusCompleted, StatusNeedsInput, StatusFailed, StatusCancelled:
		return false
	default:
		return true
	}
}

func (s *Service) Cancel(request CancelRequest) (Run, error) {
	if strings.TrimSpace(request.IdempotencyKey) == "" {
		return Run{}, errors.New("idempotencyKey is required")
	}
	fingerprint := mutationFingerprint(request.RunID, request.ExpectedStateVersion, nil)
	if run, replay, err := s.store.ReplayMutation("cancel:"+request.RunID, request.IdempotencyKey, fingerprint); err != nil || replay {
		return run, err
	}
	s.mu.Lock()
	if cancel := s.cancels[request.RunID]; cancel != nil {
		cancel()
	}
	s.mu.Unlock()
	run, err := s.store.UpdateRun(request.RunID, request.ExpectedStateVersion, func(run *Run) error {
		if run.Status == StatusCompleted || run.Status == StatusCancelled {
			return fmt.Errorf("run cannot be cancelled from %s", run.Status)
		}
		run.Status = StatusCancelled
		run.CurrentStep = StatusCancelled
		run.NextAction = ""
		run.Error = ""
		return nil
	})
	if err != nil {
		return Run{}, err
	}
	_ = s.store.SaveMutation("cancel:"+request.RunID, request.IdempotencyKey, fingerprint, run)
	if run.Result.UploadSessionID != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/uploads/"+run.Result.UploadSessionID+"/abort", map[string]any{}, nil)
	}
	_ = os.RemoveAll(filepath.Join(s.dataDir, "seller-automation", "runs", run.RunID))
	if run.Result.EndpointID != "" && s.endpoints != nil {
		s.endpoints.Delete(run.Result.EndpointID)
		if s.notifyEndpoint != nil {
			s.notifyEndpoint()
		}
	}
	return run, nil
}

func (s *Service) enabledPolicy() (SellerAutomationPolicy, error) {
	policy, ok := s.store.Policy()
	if !ok || !policy.Enabled {
		return SellerAutomationPolicy{}, errors.New("seller automation setup is not enabled")
	}
	if policy.Hash == "" || policy.Hash != policyHash(policy) {
		return SellerAutomationPolicy{}, errors.New("seller automation policy integrity check failed")
	}
	return policy, nil
}

func (s *Service) start(runID string) {
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	if old := s.cancels[runID]; old != nil {
		old()
	}
	s.cancels[runID] = cancel
	s.mu.Unlock()
	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.cancels, runID)
			s.mu.Unlock()
		}()
		s.execute(ctx, runID)
	}()
}

func (s *Service) execute(ctx context.Context, runID string) {
	run, ok := s.store.GetRun(runID)
	if !ok {
		return
	}
	policy, err := s.enabledPolicy()
	if err != nil {
		s.fail(runID, err)
		return
	}
	if Receipt(policy) != run.PolicyReceipt {
		s.fail(runID, errors.New("seller automation policy changed; create a new draft run"))
		return
	}
	if err := s.step(runID, StatusDiscovering, 5, "Revalidating authorized candidates"); err != nil {
		return
	}
	candidates, err := s.loadCandidates(policy, run.Request)
	if err != nil {
		s.fail(runID, err)
		return
	}
	if err := s.step(runID, StatusValidating, 15, "Applying saved defaults and protocol validation"); err != nil {
		return
	}
	normalized, missing, err := normalizeRunInput(policy, run.Request, candidates)
	if err != nil {
		s.fail(runID, err)
		return
	}
	if len(missing) > 0 {
		_, _ = s.store.UpdateRun(runID, 0, func(run *Run) error {
			run.Status = StatusNeedsInput
			run.Progress = 20
			run.CurrentStep = StatusNeedsInput
			run.MissingFields = missing
			run.NextAction = "Ask the seller only for the listed missing fields, then resume this run."
			return nil
		})
		return
	}
	_, _ = s.store.UpdateRun(runID, 0, func(run *Run) error {
		run.NormalizedSpec = normalized
		run.SourceFingerprint = combinedFingerprint(candidates)
		return nil
	})
	switch run.Kind {
	case KindResources:
		err = s.runResources(ctx, runID, policy, candidates, normalized)
	case KindVM:
		err = s.runVM(ctx, runID, policy, candidates[0], normalized)
	case KindEndpoint:
		err = s.runEndpoint(ctx, runID, policy, candidates[0], normalized)
	case KindAPIBridge:
		err = s.runAPIBridge(ctx, runID, policy, candidates[0], normalized)
	}
	if err != nil && !errors.Is(err, context.Canceled) {
		s.fail(runID, err)
	}
}

func (s *Service) loadCandidates(policy SellerAutomationPolicy, request CreateRequest) ([]Candidate, error) {
	out := make([]Candidate, 0, len(request.CandidateIDs))
	for _, id := range request.CandidateIDs {
		candidate, ok := s.store.Candidate(id)
		if !ok {
			return nil, errors.New("candidate is missing or expired; discover it again")
		}
		if request.Kind == KindResources {
			if candidate.Kind != KindResources {
				return nil, errors.New("resource runs only accept resource candidates")
			}
			path, _, _, err := revalidateCandidatePath(policy, candidate)
			if err != nil {
				return nil, err
			}
			fingerprint, err := fileFingerprint(path, policy.Limits.MaxBundleBytes)
			if err != nil || fingerprint != candidate.SourceFingerprint {
				return nil, errors.New("candidate changed after discovery; discover it again")
			}
		} else if candidate.Kind != request.Kind {
			return nil, fmt.Errorf("candidate kind %s does not match requested kind %s", candidate.Kind, request.Kind)
		}
		out = append(out, candidate)
	}
	return out, nil
}

func (s *Service) step(runID, status string, progress int, next string) error {
	_, err := s.store.UpdateRun(runID, 0, func(run *Run) error {
		if run.Status == StatusCancelled {
			return context.Canceled
		}
		run.Status = status
		run.CurrentStep = status
		run.Progress = progress
		run.NextAction = next
		return nil
	})
	return err
}

func (s *Service) complete(runID string, result RunResult) error {
	_, err := s.store.UpdateRun(runID, 0, func(run *Run) error {
		run.Status = StatusCompleted
		run.CurrentStep = StatusCompleted
		run.Progress = 100
		run.NextAction = "Open Listings and confirm Publish when ready."
		run.Result = result
		run.Result.ReadyToPublish = true
		return nil
	})
	return err
}

func (s *Service) fail(runID string, err error) {
	redactions := []string{}
	if current, ok := s.store.GetRun(runID); ok && strings.TrimSpace(current.Request.CredentialRef) != "" {
		if _, secret, resolveErr := s.vault.Resolve(current.Request.CredentialRef, ""); resolveErr == nil {
			redactions = append(redactions, secret)
		}
	}
	_, _ = s.store.UpdateRun(runID, 0, func(run *Run) error {
		if run.Status == StatusCancelled {
			return nil
		}
		run.Status = StatusFailed
		run.CurrentStep = StatusFailed
		run.NextAction = "Inspect the safe failure reason, correct the input or environment, then resume the run."
		run.Error = safeRunError(err, redactions...)
		return nil
	})
}

func safeRunError(err error, redactions ...string) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	for _, secret := range redactions {
		if secret = strings.TrimSpace(secret); secret != "" {
			message = strings.ReplaceAll(message, secret, "[REDACTED]")
		}
	}
	if len(message) > 1000 {
		message = message[:1000]
	}
	return message
}

func requestFingerprint(request CreateRequest) string {
	copy := request
	copy.IdempotencyKey = ""
	raw, _ := json.Marshal(copy)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func mutationFingerprint(runID string, version int64, values any) string {
	raw, _ := json.Marshal(map[string]any{"runId": runID, "expectedStateVersion": version, "values": values})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func mergeResumeValues(request *CreateRequest, values map[string]any) {
	if title, ok := values["title"].(string); ok {
		request.Title = title
	}
	if description, ok := values["description"].(string); ok {
		request.Description = description
	}
	if credentialRef, ok := values["credentialRef"].(string); ok {
		request.CredentialRef = credentialRef
	}
	if commercial, ok := values["commercial"].(map[string]any); ok {
		if request.Commercial == nil {
			request.Commercial = map[string]any{}
		}
		for key, value := range commercial {
			request.Commercial[key] = value
		}
	}
	if specification, ok := values["specification"].(map[string]any); ok {
		if request.Specification == nil {
			request.Specification = map[string]any{}
		}
		for key, value := range specification {
			request.Specification[key] = value
		}
	}
}

func combinedFingerprint(candidates []Candidate) string {
	values := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		values = append(values, candidate.SourceFingerprint)
	}
	raw, _ := json.Marshal(values)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
