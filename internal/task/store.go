package task

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

const (
	indexKey = "tasks:index"
	ttl      = 365 * 24 * time.Hour
)

type Status string

const (
	StatusPendingQuote   Status = "pending_quote"
	StatusPendingConsent Status = "pending_consent"
	StatusConsented      Status = "consented"
	StatusClaimed        Status = "claimed"
	StatusRunning        Status = "running"
	StatusCompleted      Status = "completed"
	StatusFailed         Status = "failed"
)

type Budget struct {
	MaxAmount float64 `json:"maxAmount,omitempty"`
	Currency  string  `json:"currency,omitempty"`
}

type ConsentPolicy struct {
	RequireHumanApproval bool     `json:"requireHumanApproval"`
	MaxAutoAmount        float64  `json:"maxAutoAmount,omitempty"`
	IdentityScopes       []string `json:"identityScopes,omitempty"`
}

type InputFile struct {
	Name        string `json:"name"`
	SizeBytes   int64  `json:"sizeBytes,omitempty"`
	ContentType string `json:"contentType,omitempty"`
	URI         string `json:"uri,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
}

type Quote struct {
	ID               string  `json:"id"`
	ProviderPubkey   string  `json:"providerPubkey"`
	PriceAmount      float64 `json:"priceAmount"`
	Currency         string  `json:"currency"`
	EstimatedSeconds int     `json:"estimatedSeconds,omitempty"`
	Notes            string  `json:"notes,omitempty"`
	CreatedAt        string  `json:"createdAt"`
	ExpiresAt        string  `json:"expiresAt,omitempty"`
}

type Artifact struct {
	Name        string `json:"name"`
	ContentType string `json:"contentType,omitempty"`
	SizeBytes   int64  `json:"sizeBytes"`
	SHA256      string `json:"sha256,omitempty"`
	URL         string `json:"url"`
	path        string
}

type Task struct {
	ID                string            `json:"id"`
	OrderID           string            `json:"orderId"`
	ProjectPath       string            `json:"projectPath,omitempty"`
	WorkUID           string            `json:"workUid,omitempty"`
	RequesterPubkey   string            `json:"requesterPubkey"`
	AgentID           string            `json:"agentId"`
	Type              string            `json:"type"`
	Goal              string            `json:"goal"`
	Intent            map[string]any    `json:"intent,omitempty"`
	Requirements      map[string]any    `json:"requirements,omitempty"`
	InputManifestHash string            `json:"inputManifestHash,omitempty"`
	InputFiles        []InputFile       `json:"inputFiles,omitempty"`
	PrivacyPolicy     map[string]any    `json:"privacyPolicy,omitempty"`
	RetentionPolicy   map[string]any    `json:"retentionPolicy,omitempty"`
	Budget            Budget            `json:"budget,omitempty"`
	TimeoutSeconds    int               `json:"timeoutSeconds"`
	ExpectedOutputs   []string          `json:"expectedOutputs,omitempty"`
	ConsentPolicy     ConsentPolicy     `json:"consentPolicy"`
	Status            Status            `json:"status"`
	ProviderPubkey    string            `json:"providerPubkey,omitempty"`
	Quote             *Quote            `json:"quote,omitempty"`
	ApprovalRequestID string            `json:"approvalRequestId,omitempty"`
	Artifacts         []Artifact        `json:"artifacts,omitempty"`
	ArtifactHashes    map[string]string `json:"artifactHashes,omitempty"`
	Error             string            `json:"error,omitempty"`
	CreatedAt         string            `json:"createdAt"`
	UpdatedAt         string            `json:"updatedAt"`
	ConsentedAt       string            `json:"consentedAt,omitempty"`
	ClaimedAt         string            `json:"claimedAt,omitempty"`
	CompletedAt       string            `json:"completedAt,omitempty"`
}

type CreateRequest struct {
	OrderID           string         `json:"orderId"`
	ProjectPath       string         `json:"projectPath,omitempty"`
	WorkUID           string         `json:"workUid,omitempty"`
	RequesterPubkey   string         `json:"requesterPubkey"`
	AgentID           string         `json:"agentId"`
	Type              string         `json:"type"`
	Goal              string         `json:"goal"`
	Intent            map[string]any `json:"intent"`
	Requirements      map[string]any `json:"requirements"`
	InputManifestHash string         `json:"inputManifestHash"`
	InputFiles        []InputFile    `json:"inputFiles"`
	PrivacyPolicy     map[string]any `json:"privacyPolicy"`
	RetentionPolicy   map[string]any `json:"retentionPolicy"`
	Budget            Budget         `json:"budget"`
	TimeoutSeconds    int            `json:"timeoutSeconds"`
	ExpectedOutputs   []string       `json:"expectedOutputs"`
	ConsentPolicy     ConsentPolicy  `json:"consentPolicy"`
}

type QuoteRequest struct {
	ProviderPubkey   string  `json:"providerPubkey"`
	PriceAmount      float64 `json:"priceAmount"`
	Currency         string  `json:"currency"`
	EstimatedSeconds int     `json:"estimatedSeconds"`
	Notes            string  `json:"notes"`
	ExpiresAt        string  `json:"expiresAt"`
}

type ConsentRequest struct {
	Approved          bool   `json:"approved"`
	UserNote          string `json:"userNote"`
	ApprovalRequestID string `json:"approvalRequestId"`
}

type ClaimRequest struct {
	ProviderPubkey string `json:"providerPubkey"`
}

type ArtifactInput struct {
	Name        string `json:"name"`
	Content     string `json:"content"`
	Encoding    string `json:"encoding"`
	ContentType string `json:"contentType"`
}

type CompleteRequest struct {
	ProviderPubkey string          `json:"providerPubkey"`
	Artifacts      []ArtifactInput `json:"artifacts"`
	Notes          string          `json:"notes"`
}

type FailRequest struct {
	ProviderPubkey string `json:"providerPubkey"`
	Error          string `json:"error"`
}

type Store struct {
	cache       *cache.Cache
	artifactDir string
}

func NewStore(c *cache.Cache, artifactDir string) *Store {
	if strings.TrimSpace(artifactDir) == "" {
		artifactDir = filepath.Join(".", "data", "artifacts")
	}
	return &Store{cache: c, artifactDir: artifactDir}
}

func (s *Store) Create(req CreateRequest) (Task, error) {
	requester := strings.TrimSpace(req.RequesterPubkey)
	agent := strings.TrimSpace(req.AgentID)
	kind := strings.TrimSpace(req.Type)
	goal := strings.TrimSpace(req.Goal)
	if requester == "" {
		return Task{}, fmt.Errorf("requester_pubkey required")
	}
	if agent == "" {
		return Task{}, fmt.Errorf("agent_id required")
	}
	if kind == "" {
		return Task{}, fmt.Errorf("type required")
	}
	if goal == "" {
		return Task{}, fmt.Errorf("goal required")
	}
	timeout := req.TimeoutSeconds
	if timeout <= 0 {
		timeout = 600
	}
	now := time.Now().UTC()
	id := fmt.Sprintf("task-%d-%s", now.UnixNano(), shortHash(requester+agent+kind+goal))
	orderID := strings.TrimSpace(req.OrderID)
	if orderID == "" {
		orderID = id
	}
	t := Task{
		ID:                id,
		OrderID:           orderID,
		ProjectPath:       strings.TrimSpace(req.ProjectPath),
		WorkUID:           strings.TrimSpace(req.WorkUID),
		RequesterPubkey:   requester,
		AgentID:           agent,
		Type:              kind,
		Goal:              goal,
		Intent:            req.Intent,
		Requirements:      req.Requirements,
		InputManifestHash: strings.TrimSpace(req.InputManifestHash),
		InputFiles:        req.InputFiles,
		PrivacyPolicy:     req.PrivacyPolicy,
		RetentionPolicy:   req.RetentionPolicy,
		Budget:            req.Budget,
		TimeoutSeconds:    timeout,
		ExpectedOutputs:   compactStrings(req.ExpectedOutputs),
		ConsentPolicy:     req.ConsentPolicy,
		Status:            StatusPendingQuote,
		CreatedAt:         now.Format(time.RFC3339),
		UpdatedAt:         now.Format(time.RFC3339),
	}
	return t, s.Save(t)
}

func (s *Store) Quote(id string, req QuoteRequest) (Task, error) {
	t, ok := s.Get(id)
	if !ok {
		return Task{}, fmt.Errorf("task not found")
	}
	provider := strings.TrimSpace(req.ProviderPubkey)
	if provider == "" {
		return Task{}, fmt.Errorf("provider_pubkey required")
	}
	if req.PriceAmount < 0 {
		return Task{}, fmt.Errorf("price_amount cannot be negative")
	}
	currency := strings.TrimSpace(req.Currency)
	if currency == "" {
		currency = "USD"
	}
	now := time.Now().UTC()
	t.ProviderPubkey = provider
	t.Quote = &Quote{
		ID:               fmt.Sprintf("quote-%d-%s", now.UnixNano(), shortHash(id+provider)),
		ProviderPubkey:   provider,
		PriceAmount:      req.PriceAmount,
		Currency:         currency,
		EstimatedSeconds: req.EstimatedSeconds,
		Notes:            strings.TrimSpace(req.Notes),
		CreatedAt:        now.Format(time.RFC3339),
		ExpiresAt:        strings.TrimSpace(req.ExpiresAt),
	}
	t.Status = StatusPendingConsent
	t.UpdatedAt = now.Format(time.RFC3339)
	return t, s.Save(t)
}

func (s *Store) Consent(id string, req ConsentRequest) (Task, error) {
	t, ok := s.Get(id)
	if !ok {
		return Task{}, fmt.Errorf("task not found")
	}
	if !req.Approved {
		t.Status = StatusFailed
		t.Error = "consent rejected"
		if strings.TrimSpace(req.ApprovalRequestID) != "" {
			t.ApprovalRequestID = strings.TrimSpace(req.ApprovalRequestID)
		}
		t.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		return t, s.Save(t)
	}
	if t.Quote == nil {
		return Task{}, fmt.Errorf("quote required before consent")
	}
	now := time.Now().UTC()
	t.Status = StatusConsented
	if strings.TrimSpace(req.ApprovalRequestID) != "" {
		t.ApprovalRequestID = strings.TrimSpace(req.ApprovalRequestID)
	}
	t.ConsentedAt = now.Format(time.RFC3339)
	t.UpdatedAt = now.Format(time.RFC3339)
	return t, s.Save(t)
}

func (s *Store) SetApprovalRequest(id string, approvalID string) (Task, error) {
	t, ok := s.Get(id)
	if !ok {
		return Task{}, fmt.Errorf("task not found")
	}
	approvalID = strings.TrimSpace(approvalID)
	if approvalID == "" {
		return Task{}, fmt.Errorf("approval_request_id required")
	}
	t.ApprovalRequestID = approvalID
	t.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return t, s.Save(t)
}

func (s *Store) Claim(id string, req ClaimRequest) (Task, error) {
	t, ok := s.Get(id)
	if !ok {
		return Task{}, fmt.Errorf("task not found")
	}
	if t.Status != StatusConsented && t.Status != StatusClaimed {
		return Task{}, fmt.Errorf("task is not ready to claim")
	}
	provider := strings.TrimSpace(req.ProviderPubkey)
	if provider == "" {
		provider = t.ProviderPubkey
	}
	if provider == "" {
		return Task{}, fmt.Errorf("provider_pubkey required")
	}
	if t.ProviderPubkey != "" && t.ProviderPubkey != provider {
		return Task{}, fmt.Errorf("task quote belongs to a different provider")
	}
	now := time.Now().UTC()
	t.ProviderPubkey = provider
	t.Status = StatusRunning
	t.ClaimedAt = now.Format(time.RFC3339)
	t.UpdatedAt = now.Format(time.RFC3339)
	return t, s.Save(t)
}

func (s *Store) Complete(id string, req CompleteRequest) (Task, error) {
	t, ok := s.Get(id)
	if !ok {
		return Task{}, fmt.Errorf("task not found")
	}
	if t.Status != StatusRunning && t.Status != StatusClaimed && t.Status != StatusConsented {
		return Task{}, fmt.Errorf("task is not running")
	}
	if provider := strings.TrimSpace(req.ProviderPubkey); provider != "" {
		if t.ProviderPubkey != "" && provider != t.ProviderPubkey {
			return Task{}, fmt.Errorf("task belongs to a different provider")
		}
		t.ProviderPubkey = provider
	}
	artifacts, err := s.writeArtifacts(t.ID, req.Artifacts)
	if err != nil {
		return Task{}, err
	}
	now := time.Now().UTC()
	t.Artifacts = append(t.Artifacts, artifacts...)
	if t.ArtifactHashes == nil {
		t.ArtifactHashes = map[string]string{}
	}
	for _, artifact := range artifacts {
		if artifact.SHA256 != "" {
			t.ArtifactHashes[artifact.Name] = artifact.SHA256
		}
	}
	t.Status = StatusCompleted
	t.CompletedAt = now.Format(time.RFC3339)
	t.UpdatedAt = now.Format(time.RFC3339)
	return t, s.Save(t)
}

func (s *Store) Fail(id string, req FailRequest) (Task, error) {
	t, ok := s.Get(id)
	if !ok {
		return Task{}, fmt.Errorf("task not found")
	}
	if provider := strings.TrimSpace(req.ProviderPubkey); provider != "" {
		if t.ProviderPubkey != "" && provider != t.ProviderPubkey {
			return Task{}, fmt.Errorf("task belongs to a different provider")
		}
		t.ProviderPubkey = provider
	}
	now := time.Now().UTC()
	t.Status = StatusFailed
	t.Error = strings.TrimSpace(req.Error)
	if t.Error == "" {
		t.Error = "provider failed task"
	}
	t.UpdatedAt = now.Format(time.RFC3339)
	return t, s.Save(t)
}

func (s *Store) Save(t Task) error {
	data, err := json.Marshal(t)
	if err != nil {
		return err
	}
	s.cache.Set(FormatTaskKey(t.ID), data, ttl)

	ids := s.loadIndex()
	found := false
	for _, id := range ids {
		if id == t.ID {
			found = true
			break
		}
	}
	if !found {
		ids = append([]string{t.ID}, ids...)
	}
	indexData, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	s.cache.Set(indexKey, indexData, ttl)
	return nil
}

func (s *Store) Get(id string) (Task, bool) {
	data, ok := s.cache.Get(FormatTaskKey(id))
	if !ok {
		return Task{}, false
	}
	var t Task
	if err := json.Unmarshal(data, &t); err != nil {
		return Task{}, false
	}
	return t, true
}

func (s *Store) List(status Status, party string) []Task {
	ids := s.loadIndex()
	out := make([]Task, 0, len(ids))
	party = strings.TrimSpace(party)
	for _, id := range ids {
		t, ok := s.Get(id)
		if !ok {
			continue
		}
		if status != "" && t.Status != status {
			continue
		}
		if party != "" && t.RequesterPubkey != party && t.ProviderPubkey != party && t.AgentID != party {
			continue
		}
		out = append(out, t)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

func (s *Store) Next(status Status, provider string) (Task, bool) {
	if status == "" {
		status = StatusConsented
	}
	tasks := s.List(status, "")
	for i := len(tasks) - 1; i >= 0; i-- {
		t := tasks[i]
		if provider == "" || t.ProviderPubkey == "" || t.ProviderPubkey == provider {
			return t, true
		}
	}
	return Task{}, false
}

func (s *Store) ArtifactPath(taskID, name string) (string, bool) {
	t, ok := s.Get(taskID)
	if !ok {
		return "", false
	}
	for _, artifact := range t.Artifacts {
		if artifact.Name == name {
			if artifact.path != "" {
				return artifact.path, true
			}
			return filepath.Join(s.artifactDir, sanitizeName(taskID), sanitizeName(name)), true
		}
	}
	return "", false
}

func (s *Store) ArtifactManifest(taskID string) ([]Artifact, bool) {
	t, ok := s.Get(taskID)
	if !ok {
		return nil, false
	}
	return t.Artifacts, true
}

func (s *Store) loadIndex() []string {
	data, ok := s.cache.Get(indexKey)
	if !ok {
		return nil
	}
	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		return nil
	}
	return ids
}

func (s *Store) writeArtifacts(taskID string, inputs []ArtifactInput) ([]Artifact, error) {
	if len(inputs) == 0 {
		return nil, nil
	}
	dir := filepath.Join(s.artifactDir, sanitizeName(taskID))
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	out := make([]Artifact, 0, len(inputs))
	for _, input := range inputs {
		name := sanitizeName(input.Name)
		if name == "" {
			return nil, fmt.Errorf("artifact name required")
		}
		content, err := decodeContent(input)
		if err != nil {
			return nil, err
		}
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, content, 0600); err != nil {
			return nil, err
		}
		sum := sha256.Sum256(content)
		out = append(out, Artifact{
			Name:        name,
			ContentType: strings.TrimSpace(input.ContentType),
			SizeBytes:   int64(len(content)),
			SHA256:      fmt.Sprintf("%x", sum[:]),
			URL:         fmt.Sprintf("/v1/tasks/%s/artifacts/%s", taskID, name),
			path:        path,
		})
	}
	return out, nil
}

func decodeContent(input ArtifactInput) ([]byte, error) {
	switch strings.ToLower(strings.TrimSpace(input.Encoding)) {
	case "", "text":
		return []byte(input.Content), nil
	case "base64":
		return base64.StdEncoding.DecodeString(input.Content)
	default:
		return nil, fmt.Errorf("unsupported artifact encoding: %s", input.Encoding)
	}
}

func FormatTaskKey(id string) string {
	return fmt.Sprintf("task:%s", id)
}

func compactStrings(values []string) []string {
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func sanitizeName(value string) string {
	value = filepath.Base(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "\\", "_")
	value = strings.ReplaceAll(value, "/", "_")
	value = strings.Trim(value, ". ")
	return value
}

func shortHash(value string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return fmt.Sprintf("%08x", h.Sum32())
}
