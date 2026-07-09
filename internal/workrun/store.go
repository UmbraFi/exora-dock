package workrun

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

const (
	SchemaVersion = "workrun.v1"

	StatusQueued               = "queued"
	StatusRunning              = "running"
	StatusWaitingOwnerChoice   = "waiting_owner_choice"
	StatusWaitingOwnerApproval = "waiting_owner_approval"
	StatusWaitingWorker        = "waiting_worker"
	StatusStopRequested        = "stop_requested"
	StatusStopped              = "stopped"
	StatusCompleted            = "completed"
	StatusFailed               = "failed"
	StatusNoSuitableWorker     = "no_suitable_worker"

	StepDiscoverAgentCards        = "discover_agent_cards"
	StepClassifyIntent            = "classify_intent"
	StepConfirmExoraPlan          = "confirm_exora_plan"
	StepWritePlanFiles            = "write_plan_files"
	StepReviewRemoteManifest      = "review_remote_manifest"
	StepSubmitManifestForMatching = "submit_manifest_for_matching"
	StepStartTaskFlow             = "start_task_flow"
	StepNegotiateTask             = "negotiate_task"
	StepCompareQuotes             = "compare_quotes"
	StepCreateOrderPlan           = "create_order_plan"
	StepWaitOwnerSellerChoice     = "wait_owner_seller_choice"
	StepRequestApproval           = "request_approval"
	StepWaitOwnerApprovalPayment  = "wait_owner_approval_payment"
	StepCreatePaymentIntent       = "create_payment_intent"
	StepFundChainEscrow           = "fund_chain_escrow"
	StepSyncPaymentEvidence       = "sync_payment_evidence"
	StepVerifyPaymentEvidence     = "verify_payment_evidence"
	StepSubmitWorkerJob           = "submit_worker_job"
	StepPollWorkerJob             = "poll_worker_job"
	StepFetchArtifacts            = "fetch_artifacts"
	StepVerifyArtifacts           = "verify_artifacts"
	StepComplete                  = "complete"

	EventRunStarted        = "run.started"
	EventStepStarted       = "step.started"
	EventToolRequested     = "tool.requested"
	EventToolCompleted     = "tool.completed"
	EventOwnerRequired     = "owner.required"
	EventWorkerStarted     = "worker.started"
	EventWorkerProgress    = "worker.progress"
	EventWorkerStopped     = "worker.stopped"
	EventStepCompleted     = "step.completed"
	EventCheckpointCreated = "checkpoint.created"
	EventRunStopped        = "run.stopped"
	EventRunCompleted      = "run.completed"
	EventRunFailed         = "run.failed"

	ControllerExternalMCP = "external-mcp"
	ControllerInternalAPI = "internal-api"

	indexKey = "work-runs:index"
	ttl      = 365 * 24 * time.Hour
)

type Run struct {
	SchemaVersion    string         `json:"schemaVersion"`
	RunID            string         `json:"runId"`
	WorkUID          string         `json:"workUid,omitempty"`
	ProjectPath      string         `json:"projectPath,omitempty"`
	Controller       string         `json:"controller"`
	Status           string         `json:"status"`
	CurrentStep      string         `json:"currentStep,omitempty"`
	NextAction       string         `json:"nextAction,omitempty"`
	LastCheckpointID string         `json:"lastCheckpointId,omitempty"`
	Intent           string         `json:"intent,omitempty"`
	Summary          string         `json:"summary,omitempty"`
	Error            string         `json:"error,omitempty"`
	Entities         Entities       `json:"entities,omitempty"`
	ActiveWorker     *ActiveWorker  `json:"activeWorker,omitempty"`
	PublicDisclosure map[string]any `json:"publicDisclosure,omitempty"`
	OwnerDisclosure  map[string]any `json:"ownerDisclosure,omitempty"`
	Redactions       []Redaction    `json:"redactions,omitempty"`
	CreatedAt        string         `json:"createdAt"`
	UpdatedAt        string         `json:"updatedAt"`
	CompletedAt      string         `json:"completedAt,omitempty"`
}

type Entities struct {
	OrderPlanID       string   `json:"orderPlanId,omitempty"`
	OrderPlanIDs      []string `json:"orderPlanIds,omitempty"`
	NegotiationIDs    []string `json:"negotiationIds,omitempty"`
	TaskID            string   `json:"taskId,omitempty"`
	ApprovalID        string   `json:"approvalId,omitempty"`
	PaymentID         string   `json:"paymentId,omitempty"`
	PaymentEvidenceID string   `json:"paymentEvidenceId,omitempty"`
	EscrowPDA         string   `json:"escrowPda,omitempty"`
	TxSignature       string   `json:"txSignature,omitempty"`
	ProviderJobID     string   `json:"providerJobId,omitempty"`
	WorkerID          string   `json:"workerId,omitempty"`
}

type ActiveWorker struct {
	WorkerID       string `json:"workerId,omitempty"`
	Type           string `json:"type,omitempty"`
	Status         string `json:"status,omitempty"`
	ProviderPubkey string `json:"providerPubkey,omitempty"`
	JobID          string `json:"jobId,omitempty"`
	UpdatedAt      string `json:"updatedAt,omitempty"`
}

type Redaction struct {
	Field  string `json:"field"`
	Reason string `json:"reason"`
}

type Checkpoint struct {
	SchemaVersion    string         `json:"schemaVersion"`
	CheckpointID     string         `json:"checkpointId"`
	RunID            string         `json:"runId"`
	WorkUID          string         `json:"workUid,omitempty"`
	ProjectPath      string         `json:"projectPath,omitempty"`
	Controller       string         `json:"controller"`
	Status           string         `json:"status"`
	CurrentStep      string         `json:"currentStep,omitempty"`
	NextAction       string         `json:"nextAction,omitempty"`
	KnownEntities    Entities       `json:"knownEntities,omitempty"`
	ActiveWorker     *ActiveWorker  `json:"activeWorker,omitempty"`
	PublicDisclosure map[string]any `json:"publicDisclosure,omitempty"`
	OwnerDisclosure  map[string]any `json:"ownerDisclosure,omitempty"`
	Redactions       []Redaction    `json:"redactions,omitempty"`
	CreatedAt        string         `json:"createdAt"`
}

type ResumePayload struct {
	SchemaVersion  string   `json:"schemaVersion"`
	RunID          string   `json:"runId"`
	WorkUID        string   `json:"workUid,omitempty"`
	CheckpointID   string   `json:"checkpointId"`
	ProjectPath    string   `json:"projectPath,omitempty"`
	CurrentStep    string   `json:"currentStep,omitempty"`
	NextAction     string   `json:"nextAction,omitempty"`
	Status         string   `json:"status,omitempty"`
	KnownEntities  Entities `json:"knownEntities,omitempty"`
	ControllerHint string   `json:"controllerHint,omitempty"`
}

type Event struct {
	EventID      string         `json:"eventId"`
	Type         string         `json:"type"`
	RunID        string         `json:"runId"`
	WorkUID      string         `json:"workUid,omitempty"`
	CheckpointID string         `json:"checkpointId,omitempty"`
	StepID       string         `json:"stepId,omitempty"`
	Step         string         `json:"step,omitempty"`
	Status       string         `json:"status,omitempty"`
	Summary      string         `json:"summary,omitempty"`
	Data         map[string]any `json:"data,omitempty"`
	CreatedAt    string         `json:"createdAt"`
}

type CreateRequest struct {
	RunID       string         `json:"runId,omitempty"`
	WorkUID     string         `json:"workUid,omitempty"`
	ProjectPath string         `json:"projectPath,omitempty"`
	Controller  string         `json:"controller,omitempty"`
	Intent      string         `json:"intent,omitempty"`
	Status      string         `json:"status,omitempty"`
	Step        string         `json:"currentStep,omitempty"`
	NextAction  string         `json:"nextAction,omitempty"`
	Entities    Entities       `json:"knownEntities,omitempty"`
	Disclosure  map[string]any `json:"publicDisclosure,omitempty"`
}

type RecordRequest struct {
	RunID            string         `json:"runId,omitempty"`
	WorkUID          string         `json:"workUid,omitempty"`
	ProjectPath      string         `json:"projectPath,omitempty"`
	Controller       string         `json:"controller,omitempty"`
	Intent           string         `json:"intent,omitempty"`
	Status           string         `json:"status,omitempty"`
	Step             string         `json:"currentStep,omitempty"`
	NextAction       string         `json:"nextAction,omitempty"`
	Summary          string         `json:"summary,omitempty"`
	Error            string         `json:"error,omitempty"`
	Entities         Entities       `json:"knownEntities,omitempty"`
	ActiveWorker     *ActiveWorker  `json:"activeWorker,omitempty"`
	PublicDisclosure map[string]any `json:"publicDisclosure,omitempty"`
	OwnerDisclosure  map[string]any `json:"ownerDisclosure,omitempty"`
	Result           any            `json:"result,omitempty"`
	EventType        string         `json:"eventType,omitempty"`
}

type Store struct {
	cache  *cache.Cache
	mu     sync.RWMutex
	runs   map[string]Run
	events map[string][]Event
	index  []string
}

func NewStore(c *cache.Cache) *Store {
	return &Store{
		cache:  c,
		runs:   map[string]Run{},
		events: map[string][]Event{},
	}
}

func (s *Store) Create(req CreateRequest) (Run, error) {
	return s.Ensure(req)
}

func (s *Store) Ensure(req CreateRequest) (Run, error) {
	if s == nil {
		return Run{}, fmt.Errorf("work run store not configured")
	}
	runID := strings.TrimSpace(req.RunID)
	if runID != "" {
		if run, ok := s.Get(runID); ok {
			return s.updateRun(run, RecordRequest{
				WorkUID:          req.WorkUID,
				ProjectPath:      req.ProjectPath,
				Controller:       req.Controller,
				Intent:           req.Intent,
				Status:           req.Status,
				Step:             req.Step,
				NextAction:       req.NextAction,
				Entities:         req.Entities,
				PublicDisclosure: req.Disclosure,
				EventType:        EventCheckpointCreated,
			})
		}
	}
	if runID == "" && strings.TrimSpace(req.WorkUID) != "" {
		if run, ok := s.LatestByWorkUID(req.WorkUID); ok && !terminalStatus(run.Status) {
			return s.updateRun(run, RecordRequest{
				ProjectPath:      req.ProjectPath,
				Controller:       req.Controller,
				Intent:           req.Intent,
				Status:           req.Status,
				Step:             req.Step,
				NextAction:       req.NextAction,
				Entities:         req.Entities,
				PublicDisclosure: req.Disclosure,
				EventType:        EventCheckpointCreated,
			})
		}
	}
	now := time.Now().UTC().Format(time.RFC3339)
	run := Run{
		SchemaVersion:    SchemaVersion,
		RunID:            firstNonEmpty(runID, newID("wrun")),
		WorkUID:          strings.TrimSpace(req.WorkUID),
		ProjectPath:      cleanPath(req.ProjectPath),
		Controller:       firstNonEmpty(normalizeController(req.Controller), ControllerInternalAPI),
		Status:           firstNonEmpty(strings.TrimSpace(req.Status), StatusQueued),
		CurrentStep:      firstNonEmpty(strings.TrimSpace(req.Step), StepDiscoverAgentCards),
		NextAction:       strings.TrimSpace(req.NextAction),
		Intent:           strings.TrimSpace(req.Intent),
		Entities:         normalizeEntities(req.Entities),
		PublicDisclosure: safeMap(req.Disclosure),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if run.NextAction == "" {
		run.NextAction = defaultNextAction(run.Status, run.CurrentStep)
	}
	checkpoint := s.checkpointFor(run, now)
	run.LastCheckpointID = checkpoint.CheckpointID
	if err := s.saveRun(run); err != nil {
		return Run{}, err
	}
	_ = s.appendEvent(run, Event{
		Type:         EventRunStarted,
		CheckpointID: checkpoint.CheckpointID,
		Step:         run.CurrentStep,
		Status:       run.Status,
		Summary:      firstNonEmpty(run.Summary, "Work run started."),
	})
	_ = s.writeSnapshot(run)
	return run, nil
}

func (s *Store) Record(req RecordRequest) (Run, Checkpoint, error) {
	run, ok := s.Get(req.RunID)
	if !ok && strings.TrimSpace(req.WorkUID) != "" {
		run, ok = s.LatestByWorkUID(req.WorkUID)
	}
	if !ok {
		var err error
		run, err = s.Ensure(CreateRequest{
			RunID:       req.RunID,
			WorkUID:     req.WorkUID,
			ProjectPath: req.ProjectPath,
			Controller:  req.Controller,
			Intent:      req.Intent,
			Status:      firstNonEmpty(req.Status, StatusRunning),
			Step:        req.Step,
			NextAction:  req.NextAction,
			Entities:    req.Entities,
			Disclosure:  req.PublicDisclosure,
		})
		if err != nil {
			return Run{}, Checkpoint{}, err
		}
	}
	run, err := s.updateRun(run, req)
	if err != nil {
		return Run{}, Checkpoint{}, err
	}
	return run, s.Checkpoint(run), nil
}

func (s *Store) Stop(runID, reason string) (Run, Checkpoint, error) {
	run, ok := s.Get(runID)
	if !ok {
		return Run{}, Checkpoint{}, fmt.Errorf("work run not found")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	run.Status = StatusStopped
	run.NextAction = "resume_from_checkpoint"
	run.Summary = firstNonEmpty(strings.TrimSpace(reason), "Work run stopped by owner.")
	run.UpdatedAt = now
	run.CompletedAt = now
	run.LastCheckpointID = ""
	checkpoint := s.checkpointFor(run, now)
	run.LastCheckpointID = checkpoint.CheckpointID
	if err := s.saveRun(run); err != nil {
		return Run{}, Checkpoint{}, err
	}
	_ = s.appendEvent(run, Event{
		Type:         EventRunStopped,
		CheckpointID: checkpoint.CheckpointID,
		Step:         run.CurrentStep,
		Status:       run.Status,
		Summary:      run.Summary,
	})
	_ = s.writeSnapshot(run)
	return run, checkpoint, nil
}

func (s *Store) Get(id string) (Run, bool) {
	if s == nil {
		return Run{}, false
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return Run{}, false
	}
	s.mu.RLock()
	run, ok := s.runs[id]
	s.mu.RUnlock()
	if ok {
		return run, true
	}
	if s.cache == nil {
		return Run{}, false
	}
	data, ok := s.cache.Get(runKey(id))
	if !ok {
		return Run{}, false
	}
	if err := json.Unmarshal(data, &run); err != nil {
		return Run{}, false
	}
	s.mu.Lock()
	s.runs[id] = run
	if !contains(s.index, id) {
		s.index = append(s.index, id)
	}
	s.mu.Unlock()
	return run, true
}

func (s *Store) LatestByWorkUID(workUID string) (Run, bool) {
	workUID = strings.TrimSpace(workUID)
	if s == nil || workUID == "" {
		return Run{}, false
	}
	for _, run := range s.List(ListFilter{WorkUID: workUID}) {
		return run, true
	}
	return Run{}, false
}

type ListFilter struct {
	WorkUID    string
	Status     string
	Controller string
}

func (s *Store) List(filter ListFilter) []Run {
	if s == nil {
		return nil
	}
	ids := s.loadIndex()
	out := make([]Run, 0, len(ids))
	for _, id := range ids {
		run, ok := s.Get(id)
		if !ok {
			continue
		}
		if filter.WorkUID != "" && run.WorkUID != filter.WorkUID {
			continue
		}
		if filter.Status != "" && run.Status != filter.Status {
			continue
		}
		if filter.Controller != "" && run.Controller != filter.Controller {
			continue
		}
		out = append(out, run)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	return out
}

func (s *Store) Events(runID string) []Event {
	if s == nil {
		return nil
	}
	runID = strings.TrimSpace(runID)
	s.mu.RLock()
	events := append([]Event(nil), s.events[runID]...)
	s.mu.RUnlock()
	if len(events) > 0 || s.cache == nil {
		return events
	}
	data, ok := s.cache.Get(eventsKey(runID))
	if !ok {
		return nil
	}
	_ = json.Unmarshal(data, &events)
	if len(events) > 0 {
		s.mu.Lock()
		s.events[runID] = append([]Event(nil), events...)
		s.mu.Unlock()
	}
	return events
}

func (s *Store) Checkpoint(run Run) Checkpoint {
	return s.checkpointFor(run, time.Now().UTC().Format(time.RFC3339))
}

func ResumeJSON(run Run) ResumePayload {
	return ResumePayload{
		SchemaVersion:  SchemaVersion,
		RunID:          run.RunID,
		WorkUID:        run.WorkUID,
		CheckpointID:   run.LastCheckpointID,
		ProjectPath:    run.ProjectPath,
		CurrentStep:    run.CurrentStep,
		NextAction:     run.NextAction,
		Status:         run.Status,
		KnownEntities:  normalizeEntities(run.Entities),
		ControllerHint: run.Controller,
	}
}

func ResponseEnvelope(run Run, checkpoint Checkpoint) map[string]any {
	return map[string]any{
		"workRun":    run,
		"checkpoint": checkpoint,
		"resumeJson": ResumeJSON(run),
	}
}

func ExtractEntities(value any) Entities {
	entities := Entities{}
	var walk func(any)
	walk = func(v any) {
		switch typed := v.(type) {
		case map[string]any:
			for key, raw := range typed {
				lower := strings.ToLower(key)
				switch lower {
				case "orderplanid", "planid":
					entities.OrderPlanID = firstNonEmpty(entities.OrderPlanID, stringValue(raw))
					entities.OrderPlanIDs = appendUnique(entities.OrderPlanIDs, stringValue(raw))
				case "negotiationid":
					entities.NegotiationIDs = appendUnique(entities.NegotiationIDs, stringValue(raw))
				case "negotiationids":
					entities.NegotiationIDs = appendUnique(entities.NegotiationIDs, stringsFromAny(raw)...)
				case "taskid":
					entities.TaskID = firstNonEmpty(entities.TaskID, stringValue(raw))
				case "approvalid", "approvalrequestid":
					entities.ApprovalID = firstNonEmpty(entities.ApprovalID, stringValue(raw))
				case "paymentid":
					entities.PaymentID = firstNonEmpty(entities.PaymentID, stringValue(raw))
				case "paymentevidenceid", "evidenceid":
					entities.PaymentEvidenceID = firstNonEmpty(entities.PaymentEvidenceID, stringValue(raw))
				case "escrowpda":
					entities.EscrowPDA = firstNonEmpty(entities.EscrowPDA, stringValue(raw))
				case "txsignature", "transactionsignature":
					entities.TxSignature = firstNonEmpty(entities.TxSignature, stringValue(raw))
				case "providerjobid", "jobid":
					entities.ProviderJobID = firstNonEmpty(entities.ProviderJobID, stringValue(raw))
				case "workerid":
					entities.WorkerID = firstNonEmpty(entities.WorkerID, stringValue(raw))
				}
				walk(raw)
			}
		case []any:
			for _, item := range typed {
				walk(item)
			}
		}
	}
	walk(value)
	return normalizeEntities(entities)
}

func DeriveStatus(nextAction string, payload any) string {
	lowerNext := strings.ToLower(strings.TrimSpace(nextAction))
	joined := strings.ToLower(summaryText(payload))
	switch {
	case containsAny(lowerNext, "choose", "seller", "selection") && !strings.Contains(lowerNext, "no_"):
		return StatusWaitingOwnerChoice
	case containsAny(lowerNext, "approval", "approve", "payment", "pay", "pin", "escrow", "confirmation", "review_remote_manifest", "start_exora_plan_confirmation"):
		return StatusWaitingOwnerApproval
	case containsAny(lowerNext, "provider_job", "worker", "delivery", "artifact", "task_execution"):
		return StatusWaitingWorker
	case containsAny(lowerNext, "complete", "done", "finish"):
		return StatusCompleted
	case containsAny(lowerNext, "no_realtime_quotes", "no_suitable", "refine_search", "publish_demand") ||
		containsAny(joined, "no matching seller", "no seller candidates", "no suitable", "no quoted negotiations", "no realtime-confirmed"):
		return StatusNoSuitableWorker
	default:
		return StatusRunning
	}
}

func NoSuitableWorkerMessage() string {
	return "Extra Dock cannot help with this task right now."
}

func (s *Store) updateRun(run Run, req RecordRequest) (Run, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	run.SchemaVersion = SchemaVersion
	run.WorkUID = firstNonEmpty(strings.TrimSpace(req.WorkUID), run.WorkUID)
	run.ProjectPath = firstNonEmpty(cleanPath(req.ProjectPath), run.ProjectPath)
	run.Controller = firstNonEmpty(normalizeController(req.Controller), run.Controller)
	run.Intent = firstNonEmpty(strings.TrimSpace(req.Intent), run.Intent)
	run.CurrentStep = firstNonEmpty(strings.TrimSpace(req.Step), run.CurrentStep)
	run.NextAction = firstNonEmpty(strings.TrimSpace(req.NextAction), run.NextAction)
	run.Summary = firstNonEmpty(strings.TrimSpace(req.Summary), run.Summary)
	run.Error = strings.TrimSpace(req.Error)
	run.Entities = mergeEntities(run.Entities, req.Entities, ExtractEntities(req.Result))
	if req.ActiveWorker != nil {
		run.ActiveWorker = req.ActiveWorker
	}
	if len(req.PublicDisclosure) > 0 {
		run.PublicDisclosure = safeMap(req.PublicDisclosure)
	} else if req.Result != nil || req.Summary != "" {
		run.PublicDisclosure = buildDisclosure(run, req.Result)
	}
	if len(req.OwnerDisclosure) > 0 {
		run.OwnerDisclosure = safeMap(req.OwnerDisclosure)
	}
	run.Redactions = appendRedactions(run.Redactions, redactionsFor(req.Result)...)
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = DeriveStatus(run.NextAction, req.Result)
	}
	run.Status = status
	if run.Status == StatusNoSuitableWorker {
		run.Summary = firstNonEmpty(run.Summary, NoSuitableWorkerMessage())
		run.NextAction = "tell_user_exora_cannot_help"
		if run.PublicDisclosure == nil {
			run.PublicDisclosure = map[string]any{}
		}
		run.PublicDisclosure["message"] = NoSuitableWorkerMessage()
		run.PublicDisclosure["nextAction"] = run.NextAction
	}
	run.UpdatedAt = now
	if terminalStatus(run.Status) {
		run.CompletedAt = now
	}
	run.LastCheckpointID = ""
	checkpoint := s.checkpointFor(run, now)
	run.LastCheckpointID = checkpoint.CheckpointID
	if err := s.saveRun(run); err != nil {
		return Run{}, err
	}
	eventType := firstNonEmpty(req.EventType, eventTypeFor(run.Status))
	_ = s.appendEvent(run, Event{
		Type:         eventType,
		CheckpointID: checkpoint.CheckpointID,
		Step:         run.CurrentStep,
		Status:       run.Status,
		Summary:      run.Summary,
		Data:         eventData(req.Result, req.Error),
	})
	_ = s.writeSnapshot(run)
	return run, nil
}

func (s *Store) saveRun(run Run) error {
	if strings.TrimSpace(run.RunID) == "" {
		return fmt.Errorf("runId required")
	}
	s.mu.Lock()
	s.runs[run.RunID] = run
	if !contains(s.index, run.RunID) {
		s.index = append([]string{run.RunID}, s.index...)
	}
	index := append([]string(nil), s.index...)
	s.mu.Unlock()
	if s.cache != nil {
		data, err := json.Marshal(run)
		if err != nil {
			return err
		}
		s.cache.Set(runKey(run.RunID), data, ttl)
		indexData, err := json.Marshal(index)
		if err != nil {
			return err
		}
		s.cache.Set(indexKey, indexData, ttl)
	}
	return nil
}

func (s *Store) appendEvent(run Run, event Event) error {
	now := time.Now().UTC().Format(time.RFC3339)
	event.EventID = firstNonEmpty(event.EventID, newID("wevt"))
	event.RunID = run.RunID
	event.WorkUID = run.WorkUID
	event.CreatedAt = firstNonEmpty(event.CreatedAt, now)
	if event.StepID == "" && event.Step != "" {
		event.StepID = fmt.Sprintf("%s:%s", event.Step, event.CheckpointID)
	}
	event.Data = safeMap(event.Data)
	s.mu.Lock()
	s.events[run.RunID] = append(s.events[run.RunID], event)
	events := append([]Event(nil), s.events[run.RunID]...)
	s.mu.Unlock()
	if s.cache != nil {
		if data, err := json.Marshal(events); err == nil {
			s.cache.Set(eventsKey(run.RunID), data, ttl)
		}
	}
	if run.ProjectPath == "" {
		return nil
	}
	if err := os.MkdirAll(runLogDir(run.ProjectPath), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(runLogPath(run), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	_, err = file.Write(append(data, '\n'))
	return err
}

func (s *Store) writeSnapshot(run Run) error {
	if run.ProjectPath == "" {
		return nil
	}
	if err := os.MkdirAll(runLogDir(run.ProjectPath), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(map[string]any{
		"workRun":    run,
		"checkpoint": s.Checkpoint(run),
		"resumeJson": ResumeJSON(run),
	}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(runSnapshotPath(run), append(data, '\n'), 0o600)
}

func (s *Store) checkpointFor(run Run, createdAt string) Checkpoint {
	checkpointID := run.LastCheckpointID
	if checkpointID == "" {
		checkpointID = newID("wcp")
	}
	return Checkpoint{
		SchemaVersion:    SchemaVersion,
		CheckpointID:     checkpointID,
		RunID:            run.RunID,
		WorkUID:          run.WorkUID,
		ProjectPath:      run.ProjectPath,
		Controller:       firstNonEmpty(normalizeController(run.Controller), ControllerInternalAPI),
		Status:           run.Status,
		CurrentStep:      run.CurrentStep,
		NextAction:       run.NextAction,
		KnownEntities:    normalizeEntities(run.Entities),
		ActiveWorker:     run.ActiveWorker,
		PublicDisclosure: safeMap(run.PublicDisclosure),
		OwnerDisclosure:  safeMap(run.OwnerDisclosure),
		Redactions:       append([]Redaction(nil), run.Redactions...),
		CreatedAt:        firstNonEmpty(createdAt, time.Now().UTC().Format(time.RFC3339)),
	}
}

func (s *Store) loadIndex() []string {
	s.mu.RLock()
	ids := append([]string(nil), s.index...)
	s.mu.RUnlock()
	if len(ids) > 0 || s.cache == nil {
		return ids
	}
	data, ok := s.cache.Get(indexKey)
	if !ok {
		return nil
	}
	if err := json.Unmarshal(data, &ids); err != nil {
		return nil
	}
	s.mu.Lock()
	s.index = append([]string(nil), ids...)
	s.mu.Unlock()
	return ids
}

func runKey(id string) string {
	return "work-run:" + strings.TrimSpace(id)
}

func eventsKey(id string) string {
	return "work-run-events:" + strings.TrimSpace(id)
}

func runLogDir(projectPath string) string {
	return filepath.Join(projectPath, ".exora", "work-runs")
}

func runLogPath(run Run) string {
	return filepath.Join(runLogDir(run.ProjectPath), run.RunID+".jsonl")
}

func runSnapshotPath(run Run) string {
	return filepath.Join(runLogDir(run.ProjectPath), run.RunID+".snapshot.json")
}

func cleanPath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if abs, err := filepath.Abs(value); err == nil {
		value = abs
	}
	return filepath.Clean(value)
}

func normalizeController(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case ControllerExternalMCP:
		return ControllerExternalMCP
	case ControllerInternalAPI:
		return ControllerInternalAPI
	case "":
		return ""
	default:
		return strings.TrimSpace(value)
	}
}

func normalizeEntities(value Entities) Entities {
	value.OrderPlanID = strings.TrimSpace(value.OrderPlanID)
	value.OrderPlanIDs = compactUnique(value.OrderPlanIDs)
	value.NegotiationIDs = compactUnique(value.NegotiationIDs)
	value.TaskID = strings.TrimSpace(value.TaskID)
	value.ApprovalID = strings.TrimSpace(value.ApprovalID)
	value.PaymentID = strings.TrimSpace(value.PaymentID)
	value.PaymentEvidenceID = strings.TrimSpace(value.PaymentEvidenceID)
	value.EscrowPDA = strings.TrimSpace(value.EscrowPDA)
	value.TxSignature = strings.TrimSpace(value.TxSignature)
	value.ProviderJobID = strings.TrimSpace(value.ProviderJobID)
	value.WorkerID = strings.TrimSpace(value.WorkerID)
	if value.OrderPlanID != "" {
		value.OrderPlanIDs = appendUnique(value.OrderPlanIDs, value.OrderPlanID)
	}
	if value.OrderPlanID == "" && len(value.OrderPlanIDs) > 0 {
		value.OrderPlanID = value.OrderPlanIDs[0]
	}
	return value
}

func mergeEntities(values ...Entities) Entities {
	out := Entities{}
	for _, value := range values {
		value = normalizeEntities(value)
		out.OrderPlanID = firstNonEmpty(out.OrderPlanID, value.OrderPlanID)
		out.OrderPlanIDs = appendUnique(out.OrderPlanIDs, value.OrderPlanIDs...)
		out.NegotiationIDs = appendUnique(out.NegotiationIDs, value.NegotiationIDs...)
		out.TaskID = firstNonEmpty(out.TaskID, value.TaskID)
		out.ApprovalID = firstNonEmpty(out.ApprovalID, value.ApprovalID)
		out.PaymentID = firstNonEmpty(out.PaymentID, value.PaymentID)
		out.PaymentEvidenceID = firstNonEmpty(out.PaymentEvidenceID, value.PaymentEvidenceID)
		out.EscrowPDA = firstNonEmpty(out.EscrowPDA, value.EscrowPDA)
		out.TxSignature = firstNonEmpty(out.TxSignature, value.TxSignature)
		out.ProviderJobID = firstNonEmpty(out.ProviderJobID, value.ProviderJobID)
		out.WorkerID = firstNonEmpty(out.WorkerID, value.WorkerID)
	}
	return normalizeEntities(out)
}

func buildDisclosure(run Run, result any) map[string]any {
	out := map[string]any{
		"summary":    run.Summary,
		"nextAction": run.NextAction,
	}
	if run.Intent != "" {
		out["intent"] = run.Intent
	}
	if run.Status == StatusNoSuitableWorker {
		out["message"] = NoSuitableWorkerMessage()
	}
	if payload, ok := result.(map[string]any); ok {
		for _, key := range []string{"mode", "query", "summary", "nextAction", "quoteCount", "rejectionCount"} {
			if value, exists := payload[key]; exists {
				out[key] = value
			}
		}
	}
	return safeMap(out)
}

func safeMap(value map[string]any) map[string]any {
	if len(value) == 0 {
		return nil
	}
	safe, _ := sanitize(value, "")
	if out, ok := safe.(map[string]any); ok {
		return out
	}
	return nil
}

func redactionsFor(value any) []Redaction {
	_, redactions := sanitize(value, "")
	return redactions
}

func sanitize(value any, path string) (any, []Redaction) {
	switch typed := value.(type) {
	case map[string]any:
		out := map[string]any{}
		redactions := []Redaction{}
		for key, raw := range typed {
			field := key
			if path != "" {
				field = path + "." + key
			}
			if secretKey(key) {
				out[key] = "[redacted]"
				redactions = append(redactions, Redaction{Field: field, Reason: "secret"})
				continue
			}
			safe, nested := sanitize(raw, field)
			out[key] = safe
			redactions = append(redactions, nested...)
		}
		return out, redactions
	case []any:
		out := make([]any, 0, len(typed))
		redactions := []Redaction{}
		for i, item := range typed {
			safe, nested := sanitize(item, fmt.Sprintf("%s[%d]", path, i))
			out = append(out, safe)
			redactions = append(redactions, nested...)
		}
		return out, redactions
	default:
		return value, nil
	}
}

func secretKey(key string) bool {
	lower := strings.ToLower(strings.TrimSpace(key))
	for _, marker := range []string{"secret", "token", "paymentpin", "payment_pin", "pin", "apikey", "api_key", "privatekey", "private_key", "credential", "password"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func appendRedactions(base []Redaction, additions ...Redaction) []Redaction {
	out := append([]Redaction(nil), base...)
	seen := map[string]bool{}
	for _, item := range out {
		seen[item.Field+":"+item.Reason] = true
	}
	for _, item := range additions {
		if item.Field == "" {
			continue
		}
		key := item.Field + ":" + item.Reason
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

func eventData(result any, errText string) map[string]any {
	data := map[string]any{}
	if result != nil {
		if payload, ok := result.(map[string]any); ok {
			data["result"] = payload
		} else {
			data["result"] = result
		}
	}
	if strings.TrimSpace(errText) != "" {
		data["error"] = strings.TrimSpace(errText)
	}
	return safeMap(data)
}

func eventTypeFor(status string) string {
	switch status {
	case StatusCompleted:
		return EventRunCompleted
	case StatusFailed:
		return EventRunFailed
	case StatusStopped:
		return EventRunStopped
	case StatusWaitingOwnerChoice, StatusWaitingOwnerApproval:
		return EventOwnerRequired
	case StatusWaitingWorker:
		return EventWorkerProgress
	default:
		return EventCheckpointCreated
	}
}

func defaultNextAction(status, step string) string {
	switch status {
	case StatusQueued:
		return "run_buyer_work"
	case StatusStopped:
		return "resume_from_checkpoint"
	case StatusNoSuitableWorker:
		return "tell_user_exora_cannot_help"
	}
	if step != "" {
		return step
	}
	return "continue_work"
}

func terminalStatus(status string) bool {
	switch status {
	case StatusStopped, StatusCompleted, StatusFailed, StatusNoSuitableWorker:
		return true
	default:
		return false
	}
}

func containsAny(value string, markers ...string) bool {
	for _, marker := range markers {
		if strings.Contains(value, marker) {
			return true
		}
	}
	return false
}

func summaryText(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(data)
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return ""
	}
}

func stringsFromAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return compactUnique(typed)
	case []any:
		out := []string{}
		for _, item := range typed {
			out = appendUnique(out, stringValue(item))
		}
		return out
	case string:
		return compactUnique([]string{typed})
	default:
		return nil
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func compactUnique(values []string) []string {
	out := []string{}
	return appendUnique(out, values...)
}

func appendUnique(base []string, values ...string) []string {
	out := append([]string(nil), base...)
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || contains(out, value) {
			continue
		}
		out = append(out, value)
	}
	return out
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func newID(prefix string) string {
	var buf [6]byte
	if _, err := rand.Read(buf[:]); err == nil {
		return fmt.Sprintf("%s-%d-%s", prefix, time.Now().UTC().UnixNano(), hex.EncodeToString(buf[:]))
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(fmt.Sprintf("%d", time.Now().UTC().UnixNano())))
	return fmt.Sprintf("%s-%d-%08x", prefix, time.Now().UTC().UnixNano(), h.Sum32())
}
