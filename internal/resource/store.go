package resource

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

const (
	indexKey = "resources:index"
	ttl      = 365 * 24 * time.Hour
)

type Type string

const (
	TypeVPS        Type = "vps"
	TypeGPU        Type = "gpu"
	TypeDataset    Type = "dataset"
	TypeRepository Type = "repository"
	TypeProject    Type = "project"
	TypeStorage    Type = "storage"
)

type BillingUnit string

const (
	BillingMinute   BillingUnit = "minute"
	BillingHour     BillingUnit = "hour"
	BillingDay      BillingUnit = "day"
	BillingDownload BillingUnit = "download"
	BillingRequest  BillingUnit = "request"
)

type Spec struct {
	CPUCores      int     `json:"cpuCores,omitempty"`
	RAMGB         int     `json:"ramGb,omitempty"`
	GPUModel      string  `json:"gpuModel,omitempty"`
	GPUCount      int     `json:"gpuCount,omitempty"`
	VRAMGB        int     `json:"vramGb,omitempty"`
	StorageGB     int     `json:"storageGb,omitempty"`
	Region        string  `json:"region,omitempty"`
	Runtime       string  `json:"runtime,omitempty"`
	DatasetSizeGB float64 `json:"datasetSizeGb,omitempty"`
	License       string  `json:"license,omitempty"`
	RepoURL       string  `json:"repoUrl,omitempty"`
	AccessMode    string  `json:"accessMode,omitempty"`
	Endpoint      string  `json:"endpoint,omitempty"`
}

type ReviewMeta struct {
	Approved    bool   `json:"approved"`
	Reason      string `json:"reason"`
	MinerPubkey string `json:"minerPubkey"`
	Timestamp   int64  `json:"timestamp"`
}

type ReviewInput struct {
	Approved    bool
	Reason      string
	MinerPubkey string
	Timestamp   int64
}

type Resource struct {
	ID                 string      `json:"id"`
	Name               string      `json:"name"`
	Type               Type        `json:"type"`
	Summary            string      `json:"summary"`
	Description        string      `json:"description"`
	Provider           string      `json:"provider"`
	ProviderPubkey     string      `json:"providerPubkey"`
	PricePerUnit       float64     `json:"pricePerUnit"`
	BillingUnit        BillingUnit `json:"billingUnit"`
	MinDurationMinutes int         `json:"minDurationMinutes"`
	MaxDurationMinutes int         `json:"maxDurationMinutes"`
	Availability       string      `json:"availability"`
	Tags               []string    `json:"tags,omitempty"`
	Spec               Spec        `json:"spec"`
	CredentialHint     string      `json:"credentialHint,omitempty"`
	Reputation         int         `json:"reputation"`
	QualityScore       int         `json:"qualityScore"`
	CreatedAt          string      `json:"createdAt"`
	UpdatedAt          string      `json:"updatedAt"`
	Review             ReviewMeta  `json:"review"`
}

type CreateRequest struct {
	Name               string      `json:"name"`
	Type               Type        `json:"type"`
	Summary            string      `json:"summary"`
	Description        string      `json:"description"`
	ProviderPubkey     string      `json:"providerPubkey"`
	PricePerUnit       string      `json:"pricePerUnit"`
	BillingUnit        BillingUnit `json:"billingUnit"`
	MinDurationMinutes int         `json:"minDurationMinutes"`
	MaxDurationMinutes int         `json:"maxDurationMinutes"`
	Availability       string      `json:"availability"`
	Tags               []string    `json:"tags"`
	Spec               Spec        `json:"spec"`
	CredentialHint     string      `json:"credentialHint"`
}

type Store struct {
	cache *cache.Cache
}

func NewStore(c *cache.Cache) *Store {
	return &Store{cache: c}
}

func (s *Store) Save(r Resource) error {
	data, err := json.Marshal(r)
	if err != nil {
		return err
	}
	s.cache.Set(FormatResourceKey(r.ID), data, ttl)

	ids := s.loadIndex()
	found := false
	for _, id := range ids {
		if id == r.ID {
			found = true
			break
		}
	}
	if !found {
		ids = append([]string{r.ID}, ids...)
	}
	indexData, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	s.cache.Set(indexKey, indexData, ttl)
	return nil
}

func (s *Store) Get(id string) (Resource, bool) {
	data, ok := s.cache.Get(FormatResourceKey(id))
	if !ok {
		return Resource{}, false
	}
	var r Resource
	if err := json.Unmarshal(data, &r); err != nil {
		return Resource{}, false
	}
	return r, true
}

func (s *Store) List() []Resource {
	ids := s.loadIndex()
	out := make([]Resource, 0, len(ids))
	for _, id := range ids {
		if r, ok := s.Get(id); ok {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

func (s *Store) Search(kind Type, query string) []Resource {
	query = strings.ToLower(strings.TrimSpace(query))
	out := []Resource{}
	for _, r := range s.List() {
		if kind != "" && r.Type != kind {
			continue
		}
		if query != "" && !strings.Contains(resourceSearchText(r), query) {
			continue
		}
		out = append(out, r)
	}
	return out
}

func resourceSearchText(r Resource) string {
	parts := []string{
		r.ID,
		r.Name,
		string(r.Type),
		r.Summary,
		r.Description,
		r.Provider,
		r.ProviderPubkey,
		string(r.BillingUnit),
		r.Availability,
		strings.Join(r.Tags, " "),
		r.Spec.GPUModel,
		r.Spec.Region,
		r.Spec.Runtime,
		r.Spec.License,
		r.Spec.RepoURL,
		r.Spec.AccessMode,
		r.Spec.Endpoint,
	}
	addInt := func(label string, value int) {
		if value <= 0 {
			return
		}
		parts = append(parts, fmt.Sprintf("%d", value), fmt.Sprintf("%dgb", value), fmt.Sprintf("%s:%d", label, value))
	}
	addInt("cpuCores", r.Spec.CPUCores)
	addInt("ramGb", r.Spec.RAMGB)
	addInt("gpuCount", r.Spec.GPUCount)
	addInt("vramGb", r.Spec.VRAMGB)
	addInt("storageGb", r.Spec.StorageGB)
	if r.Spec.DatasetSizeGB > 0 {
		parts = append(parts, fmt.Sprintf("%.0fgb", r.Spec.DatasetSizeGB), fmt.Sprintf("datasetSizeGb:%.0f", r.Spec.DatasetSizeGB))
	}
	return strings.ToLower(strings.Join(parts, " "))
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

func FormatResourceKey(id string) string {
	return fmt.Sprintf("resource:%s", id)
}

func Build(req CreateRequest, review ReviewInput) (Resource, error) {
	name := strings.TrimSpace(req.Name)
	desc := strings.TrimSpace(req.Description)
	provider := strings.TrimSpace(req.ProviderPubkey)
	if name == "" {
		return Resource{}, fmt.Errorf("name required")
	}
	if desc == "" {
		return Resource{}, fmt.Errorf("description required")
	}
	if provider == "" {
		return Resource{}, fmt.Errorf("provider_pubkey required")
	}
	if !IsKnownType(req.Type) {
		return Resource{}, fmt.Errorf("unknown resource type: %s", req.Type)
	}
	price, err := parsePositiveFloat(req.PricePerUnit)
	if err != nil {
		return Resource{}, fmt.Errorf("valid price_per_unit required")
	}

	unit := req.BillingUnit
	if unit == "" {
		unit = BillingHour
	}
	if !IsKnownBillingUnit(unit) {
		return Resource{}, fmt.Errorf("unknown billing unit: %s", unit)
	}

	minDuration := req.MinDurationMinutes
	if minDuration <= 0 {
		minDuration = defaultMinDuration(unit)
	}
	maxDuration := req.MaxDurationMinutes
	if maxDuration <= 0 {
		maxDuration = defaultMaxDuration(unit)
	}
	if minDuration > maxDuration {
		return Resource{}, fmt.Errorf("min_duration_minutes cannot exceed max_duration_minutes")
	}

	availability := strings.TrimSpace(req.Availability)
	if availability == "" {
		availability = "available"
	}
	now := time.Now().UTC()
	id := fmt.Sprintf("res-%d-%s", now.UnixNano(), shortHash(provider+name+desc))
	scoreSeed := int(hash32(provider + name + string(req.Type)))

	return Resource{
		ID:                 id,
		Name:               name,
		Type:               req.Type,
		Summary:            firstNonEmpty(strings.TrimSpace(req.Summary), deriveSummary(desc)),
		Description:        desc,
		Provider:           provider,
		ProviderPubkey:     provider,
		PricePerUnit:       price,
		BillingUnit:        unit,
		MinDurationMinutes: minDuration,
		MaxDurationMinutes: maxDuration,
		Availability:       availability,
		Tags:               normalizeTags(req.Tags, req.Type),
		Spec:               req.Spec,
		CredentialHint:     strings.TrimSpace(req.CredentialHint),
		Reputation:         78 + scoreSeed%18,
		QualityScore:       80 + (scoreSeed/7)%17,
		CreatedAt:          now.Format(time.RFC3339),
		UpdatedAt:          now.Format(time.RFC3339),
		Review: ReviewMeta{
			Approved:    review.Approved,
			Reason:      review.Reason,
			MinerPubkey: review.MinerPubkey,
			Timestamp:   review.Timestamp,
		},
	}, nil
}

func IsKnownType(value Type) bool {
	switch value {
	case TypeVPS, TypeGPU, TypeDataset, TypeRepository, TypeProject, TypeStorage:
		return true
	default:
		return false
	}
}

func IsKnownBillingUnit(value BillingUnit) bool {
	switch value {
	case BillingMinute, BillingHour, BillingDay, BillingDownload, BillingRequest:
		return true
	default:
		return false
	}
}

func UnitsForDuration(durationMinutes int, unit BillingUnit) float64 {
	if durationMinutes <= 0 {
		return 0
	}
	switch unit {
	case BillingMinute:
		return float64(durationMinutes)
	case BillingDay:
		return math.Ceil(float64(durationMinutes) / (24 * 60))
	case BillingDownload, BillingRequest:
		return 1
	default:
		return math.Ceil(float64(durationMinutes) / 60)
	}
}

func parsePositiveFloat(raw string) (float64, error) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("not positive")
	}
	return value, nil
}

func defaultMinDuration(unit BillingUnit) int {
	switch unit {
	case BillingDownload, BillingRequest:
		return 1
	case BillingMinute:
		return 5
	default:
		return 60
	}
}

func defaultMaxDuration(unit BillingUnit) int {
	switch unit {
	case BillingDownload, BillingRequest:
		return 1
	case BillingMinute:
		return 360
	default:
		return 24 * 60
	}
}

func deriveSummary(desc string) string {
	desc = strings.Join(strings.Fields(desc), " ")
	if len(desc) > 96 {
		return strings.TrimSpace(desc[:96])
	}
	return desc
}

func normalizeTags(tags []string, kind Type) []string {
	out := []string{string(kind), "agent-capability"}
	seen := map[string]bool{string(kind): true, "agent-capability": true}
	for _, tag := range tags {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if tag == "" || seen[tag] {
			continue
		}
		seen[tag] = true
		out = append(out, tag)
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func shortHash(value string) string {
	return fmt.Sprintf("%08x", hash32(value))
}

func hash32(value string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return h.Sum32()
}
