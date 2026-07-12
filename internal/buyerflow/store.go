package buyerflow

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

const (
	SchemaVersion         = "buyer-flow.v1"
	PhasePlanning         = "planning"
	PhasePreparing        = "preparing"
	PhaseMatching         = "matching"
	PhaseSelectionPayment = "selection_payment"
	PhaseExecuting        = "executing"
	PhaseAcceptance       = "acceptance"
	indexKey              = "buyer-flows:index"
	ttl                   = 365 * 24 * time.Hour
)

type LocalPreparationPlan struct {
	Summary        string             `json:"summary"`
	Steps          []string           `json:"steps"`
	FilesToPrepare []PreparedFileSpec `json:"filesToPrepare"`
	SafetyNotes    []string           `json:"safetyNotes,omitempty"`
}
type PreparedFileSpec struct {
	LogicalName string `json:"logicalName"`
	Purpose     string `json:"purpose"`
	SourceHint  string `json:"sourceHint,omitempty"`
	Required    bool   `json:"required"`
}
type RemoteExecutionPlan struct {
	Title              string               `json:"title"`
	Objective          string               `json:"objective"`
	Instructions       []string             `json:"instructions"`
	RequiredFiles      []RemoteRequiredFile `json:"requiredFiles"`
	Deliverables       []string             `json:"deliverables"`
	AcceptanceCriteria []string             `json:"acceptanceCriteria"`
	Constraints        []string             `json:"constraints,omitempty"`
	Assumptions        []string             `json:"assumptions,omitempty"`
}
type RemoteRequiredFile struct {
	LogicalName string `json:"logicalName"`
	Purpose     string `json:"purpose"`
	Required    bool   `json:"required"`
}
type PlanBundle struct {
	LocalPreparationPlan LocalPreparationPlan `json:"localPreparationPlan"`
	RemoteExecutionPlan  RemoteExecutionPlan  `json:"remoteExecutionPlan"`
	PlanVersion          int                  `json:"planVersion"`
	PlanHash             string               `json:"planHash"`
}
type PreparedFile struct {
	LogicalName  string `json:"logicalName"`
	RelativePath string `json:"relativePath"`
	SHA256       string `json:"sha256"`
	SizeBytes    int64  `json:"sizeBytes"`
	Purpose      string `json:"purpose,omitempty"`
	Approved     bool   `json:"approved"`
}
type PreparedBundleManifest struct {
	BundleID   string         `json:"bundleId"`
	PlanHash   string         `json:"planHash"`
	Files      []PreparedFile `json:"files"`
	Redactions []string       `json:"redactions,omitempty"`
	ApprovedAt string         `json:"approvedAt,omitempty"`
	BundleHash string         `json:"bundleHash"`
}
type QuoteVersion struct {
	Version       int      `json:"version"`
	Amount        float64  `json:"amount"`
	Currency      string   `json:"currency"`
	ETAHours      int      `json:"etaHours"`
	RevisionCount int      `json:"revisionCount"`
	Deliverables  []string `json:"deliverables"`
	Terms         []string `json:"terms,omitempty"`
	ChangedAt     string   `json:"changedAt"`
}
type Quote struct {
	QuoteID       string         `json:"quoteId"`
	SellerID      string         `json:"sellerId"`
	SellerName    string         `json:"sellerName"`
	Amount        float64        `json:"amount"`
	Currency      string         `json:"currency"`
	ETAHours      int            `json:"etaHours"`
	RevisionCount int            `json:"revisionCount"`
	Deliverables  []string       `json:"deliverables"`
	Terms         []string       `json:"terms,omitempty"`
	PlanHash      string         `json:"planHash"`
	BundleHash    string         `json:"bundleHash"`
	Status        string         `json:"status"`
	PublishMode   string         `json:"publishMode"`
	Version       int            `json:"version"`
	Versions      []QuoteVersion `json:"versions"`
	CreatedAt     string         `json:"createdAt"`
	UpdatedAt     string         `json:"updatedAt"`
	PublishedAt   string         `json:"publishedAt,omitempty"`
	LockedAt      string         `json:"lockedAt,omitempty"`
	WithdrawnAt   string         `json:"withdrawnAt,omitempty"`
	ExpiresAt     string         `json:"expiresAt"`
}
type SellerParticipant struct {
	SellerID      string `json:"sellerId"`
	SellerName    string `json:"sellerName"`
	QuoteID       string `json:"quoteId,omitempty"`
	Stage         string `json:"stage"`
	State         string `json:"state"`
	Selected      bool   `json:"selected"`
	RevisionLimit int    `json:"revisionLimit"`
	RevisionsUsed int    `json:"revisionsUsed"`
	UpdatedAt     string `json:"updatedAt"`
}
type QuestionOption struct {
	Label       string `json:"label"`
	Value       string `json:"value"`
	Description string `json:"description,omitempty"`
}
type ExecutionQuestion struct {
	QuestionID  string           `json:"questionId"`
	SellerID    string           `json:"sellerId,omitempty"`
	Scope       string           `json:"scope"`
	Prompt      string           `json:"prompt"`
	Options     []QuestionOption `json:"options"`
	AllowCustom bool             `json:"allowCustom"`
	Status      string           `json:"status"`
	Answer      string           `json:"answer,omitempty"`
	AskedAt     string           `json:"askedAt"`
	AnsweredAt  string           `json:"answeredAt,omitempty"`
	ExpiresAt   string           `json:"expiresAt"`
}
type AcceptanceReport struct {
	ReportID     string            `json:"reportId"`
	Summary      string            `json:"summary"`
	Criteria     []CriterionResult `json:"criteria"`
	ArtifactRefs []string          `json:"artifactRefs,omitempty"`
	Verdict      string            `json:"verdict"`
	CreatedAt    string            `json:"createdAt"`
}
type DeliveredArtifact struct {
	Name          string `json:"name"`
	SHA256        string `json:"sha256"`
	SizeBytes     int64  `json:"sizeBytes"`
	MediaType     string `json:"mediaType,omitempty"`
	ContentBase64 string `json:"contentBase64,omitempty"`
}
type CriterionResult struct {
	Criterion string `json:"criterion"`
	Passed    bool   `json:"passed"`
	Evidence  string `json:"evidence,omitempty"`
}
type BuyerRating struct {
	Stars     int    `json:"stars"`
	Comment   string `json:"comment,omitempty"`
	CreatedAt string `json:"createdAt"`
}
type SellerReputation struct {
	SellerID    string  `json:"sellerId"`
	RatingCount int     `json:"ratingCount"`
	RatingTotal int     `json:"ratingTotal"`
	Average     float64 `json:"average"`
	UpdatedAt   string  `json:"updatedAt"`
}
type Escrow struct {
	Status     string  `json:"status"`
	Amount     float64 `json:"amount"`
	Currency   string  `json:"currency"`
	FundedAt   string  `json:"fundedAt,omitempty"`
	ReleasedAt string  `json:"releasedAt,omitempty"`
	RefundedAt string  `json:"refundedAt,omitempty"`
}
type Event struct {
	Sequence       int    `json:"sequence"`
	Type           string `json:"type"`
	Message        string `json:"message,omitempty"`
	At             string `json:"at"`
	IdempotencyKey string `json:"idempotencyKey,omitempty"`
}

type Flow struct {
	SchemaVersion      string                  `json:"schemaVersion"`
	FlowID             string                  `json:"flowId"`
	ConversationID     string                  `json:"conversationId,omitempty"`
	WorkspacePath      string                  `json:"workspacePath,omitempty"`
	Phase              string                  `json:"phase"`
	State              string                  `json:"state"`
	NextAction         string                  `json:"nextAction"`
	Version            int                     `json:"version"`
	Plans              PlanBundle              `json:"plans"`
	Bundle             *PreparedBundleManifest `json:"bundle,omitempty"`
	Quotes             []Quote                 `json:"quotes,omitempty"`
	Sellers            []SellerParticipant     `json:"sellers,omitempty"`
	SelectedQuoteID    string                  `json:"selectedQuoteId,omitempty"`
	Escrow             Escrow                  `json:"escrow"`
	TaskID             string                  `json:"taskId,omitempty"`
	Questions          []ExecutionQuestion     `json:"questions,omitempty"`
	DeliveryArtifacts  []string                `json:"deliveryArtifacts,omitempty"`
	DeliveryFiles      []DeliveredArtifact     `json:"deliveryFiles,omitempty"`
	Acceptance         *AcceptanceReport       `json:"acceptance,omitempty"`
	RevisionsUsed      int                     `json:"revisionsUsed"`
	DisputeResolution  string                  `json:"disputeResolution,omitempty"`
	Rating             *BuyerRating            `json:"rating,omitempty"`
	QuoteDeadline      string                  `json:"quoteDeadline,omitempty"`
	AcceptanceDeadline string                  `json:"acceptanceDeadline,omitempty"`
	Events             []Event                 `json:"events"`
	CreatedAt          string                  `json:"createdAt"`
	UpdatedAt          string                  `json:"updatedAt"`
}
type CreateRequest struct {
	ConversationID       string               `json:"conversationId"`
	WorkspacePath        string               `json:"workspacePath"`
	LocalPreparationPlan LocalPreparationPlan `json:"localPreparationPlan"`
	RemoteExecutionPlan  RemoteExecutionPlan  `json:"remoteExecutionPlan"`
}

type Store struct {
	cache *cache.Cache
	mu    sync.Mutex
}

func NewStore(c *cache.Cache) *Store { return &Store{cache: c} }

func (s *Store) Create(req CreateRequest) (Flow, error) {
	if strings.TrimSpace(req.RemoteExecutionPlan.Objective) == "" || len(req.RemoteExecutionPlan.Deliverables) == 0 || len(req.RemoteExecutionPlan.AcceptanceCriteria) == 0 {
		return Flow{}, fmt.Errorf("remote execution plan requires objective, deliverables, and acceptance criteria")
	}
	if strings.TrimSpace(req.LocalPreparationPlan.Summary) == "" || len(req.LocalPreparationPlan.Steps) == 0 {
		return Flow{}, fmt.Errorf("local preparation plan requires summary and steps")
	}
	now := time.Now().UTC()
	plans := PlanBundle{LocalPreparationPlan: req.LocalPreparationPlan, RemoteExecutionPlan: req.RemoteExecutionPlan, PlanVersion: 1}
	plans.PlanHash = hash(plans.LocalPreparationPlan, plans.RemoteExecutionPlan, plans.PlanVersion)
	f := Flow{SchemaVersion: SchemaVersion, FlowID: fmt.Sprintf("bf-%d-%s", now.UnixNano(), plans.PlanHash[:8]), ConversationID: strings.TrimSpace(req.ConversationID), WorkspacePath: strings.TrimSpace(req.WorkspacePath), Phase: PhasePlanning, State: "plan_review", NextAction: "approve_plans", Version: 1, Plans: plans, Escrow: Escrow{Status: "unfunded"}, CreatedAt: now.Format(time.RFC3339), UpdatedAt: now.Format(time.RFC3339)}
	f.addEvent("plans.created", "Two linked plans are ready for buyer review", "")
	return f, s.save(f)
}
func (s *Store) Get(id string) (Flow, bool) {
	data, ok := s.cache.Get("buyer-flow:" + strings.TrimSpace(id))
	if !ok {
		return Flow{}, false
	}
	var f Flow
	if json.Unmarshal(data, &f) != nil {
		return Flow{}, false
	}
	return f, true
}
func (s *Store) List() []Flow {
	var ids []string
	if b, ok := s.cache.Get(indexKey); ok {
		_ = json.Unmarshal(b, &ids)
	}
	out := make([]Flow, 0, len(ids))
	for _, id := range ids {
		if f, ok := s.Get(id); ok {
			out = append(out, f)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out
}
func (s *Store) Update(id, idempotency string, mutate func(*Flow) error) (Flow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, ok := s.Get(id)
	if !ok {
		return Flow{}, fmt.Errorf("buyer flow not found")
	}
	if idempotency != "" {
		for _, e := range f.Events {
			if e.IdempotencyKey == idempotency {
				return f, nil
			}
		}
	}
	if err := mutate(&f); err != nil {
		return Flow{}, err
	}
	f.Version++
	f.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if len(f.Events) > 0 && f.Events[len(f.Events)-1].IdempotencyKey == "" {
		f.Events[len(f.Events)-1].IdempotencyKey = idempotency
	}
	return f, s.save(f)
}
func (s *Store) save(f Flow) error {
	b, e := json.Marshal(f)
	if e != nil {
		return e
	}
	s.cache.Set("buyer-flow:"+f.FlowID, b, ttl)
	var ids []string
	if raw, ok := s.cache.Get(indexKey); ok {
		_ = json.Unmarshal(raw, &ids)
	}
	found := false
	for _, id := range ids {
		found = found || id == f.FlowID
	}
	if !found {
		ids = append([]string{f.FlowID}, ids...)
	}
	raw, e := json.Marshal(ids)
	if e == nil {
		s.cache.Set(indexKey, raw, ttl)
	}
	return e
}
func (f *Flow) AddEvent(typ, msg string) { f.addEvent(typ, msg, "") }
func (f *Flow) addEvent(typ, msg, key string) {
	f.Events = append(f.Events, Event{Sequence: len(f.Events) + 1, Type: typ, Message: msg, At: time.Now().UTC().Format(time.RFC3339), IdempotencyKey: key})
}
func (f *Flow) SelectedQuote() (*Quote, bool) {
	for i := range f.Quotes {
		if f.Quotes[i].QuoteID == f.SelectedQuoteID {
			return &f.Quotes[i], true
		}
	}
	return nil, false
}
func (f *Flow) Quote(id string) (*Quote, bool) {
	for i := range f.Quotes {
		if f.Quotes[i].QuoteID == id {
			return &f.Quotes[i], true
		}
	}
	return nil, false
}
func (f *Flow) Seller(id string) (*SellerParticipant, bool) {
	for i := range f.Sellers {
		if f.Sellers[i].SellerID == id {
			return &f.Sellers[i], true
		}
	}
	return nil, false
}
func (s *Store) UpdateReputation(sellerID string, stars int) (SellerReputation, error) {
	key := "seller-reputation:" + strings.TrimSpace(sellerID)
	var rep SellerReputation
	if raw, ok := s.cache.Get(key); ok {
		_ = json.Unmarshal(raw, &rep)
	}
	rep.SellerID = sellerID
	rep.RatingCount++
	rep.RatingTotal += stars
	rep.Average = float64(rep.RatingTotal) / float64(rep.RatingCount)
	rep.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	raw, err := json.Marshal(rep)
	if err == nil {
		s.cache.Set(key, raw, ttl)
	}
	return rep, err
}
func (s *Store) GetReputation(sellerID string) (SellerReputation, bool) {
	raw, ok := s.cache.Get("seller-reputation:" + strings.TrimSpace(sellerID))
	if !ok {
		return SellerReputation{}, false
	}
	var rep SellerReputation
	if json.Unmarshal(raw, &rep) != nil {
		return SellerReputation{}, false
	}
	return rep, true
}
func hash(v ...any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func Hash(v ...any) string { return hash(v...) }
