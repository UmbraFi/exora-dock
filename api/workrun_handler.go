package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/exora-dock/exora-dock/internal/workrun"
	"github.com/go-chi/chi/v5"
)

type workRunCreateRequest struct {
	RunID       string                `json:"runId,omitempty"`
	WorkUID     string                `json:"workUid,omitempty"`
	ProjectPath string                `json:"projectPath,omitempty"`
	Controller  string                `json:"controller,omitempty"`
	Intent      string                `json:"intent,omitempty"`
	Query       string                `json:"query,omitempty"`
	Status      string                `json:"status,omitempty"`
	CurrentStep string                `json:"currentStep,omitempty"`
	NextAction  string                `json:"nextAction,omitempty"`
	ResumeJSON  workrun.ResumePayload `json:"resumeJson,omitempty"`
}

type workRunResumeRequest struct {
	ResumeJSON       workrun.ResumePayload `json:"resumeJson,omitempty"`
	Controller       string                `json:"controller,omitempty"`
	CurrentStep      string                `json:"currentStep,omitempty"`
	NextAction       string                `json:"nextAction,omitempty"`
	Status           string                `json:"status,omitempty"`
	Summary          string                `json:"summary,omitempty"`
	Intent           string                `json:"intent,omitempty"`
	ProjectPath      string                `json:"projectPath,omitempty"`
	WorkUID          string                `json:"workUid,omitempty"`
	Result           any                   `json:"result,omitempty"`
	PublicDisclosure map[string]any        `json:"publicDisclosure,omitempty"`
	OwnerDisclosure  map[string]any        `json:"ownerDisclosure,omitempty"`
}

type workRunContext struct {
	RunID       string
	WorkUID     string
	ProjectPath string
	Controller  string
	Intent      string
	CurrentStep string
	NextAction  string
	Status      string
	Summary     string
}

func (h *Handler) CreateWorkRun(w http.ResponseWriter, r *http.Request) {
	if h.workRuns == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "work run store not configured"})
		return
	}
	var req workRunCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	ctx := workRunContext{
		RunID:       firstNonEmpty(req.RunID, req.ResumeJSON.RunID),
		WorkUID:     firstNonEmpty(req.WorkUID, req.ResumeJSON.WorkUID),
		ProjectPath: firstNonEmpty(req.ProjectPath, req.ResumeJSON.ProjectPath),
		Controller:  firstNonEmpty(req.Controller, req.ResumeJSON.ControllerHint, workrun.ControllerInternalAPI),
		Intent:      firstNonEmpty(req.Intent, req.Query),
		CurrentStep: firstNonEmpty(req.CurrentStep, req.ResumeJSON.CurrentStep, workrun.StepDiscoverAgentCards),
		NextAction:  firstNonEmpty(req.NextAction, req.ResumeJSON.NextAction),
		Status:      firstNonEmpty(req.Status, req.ResumeJSON.Status, workrun.StatusQueued),
	}
	run, err := h.workRuns.Ensure(workrun.CreateRequest{
		RunID:       ctx.RunID,
		WorkUID:     ctx.WorkUID,
		ProjectPath: ctx.ProjectPath,
		Controller:  ctx.Controller,
		Intent:      ctx.Intent,
		Status:      ctx.Status,
		Step:        ctx.CurrentStep,
		NextAction:  ctx.NextAction,
		Entities:    req.ResumeJSON.KnownEntities,
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	checkpoint := h.workRuns.Checkpoint(run)
	writeJSON(w, http.StatusCreated, map[string]any{
		"workRun":    run,
		"checkpoint": checkpoint,
		"resumeJson": workrun.ResumeJSON(run),
	})
}

func (h *Handler) ListWorkRuns(w http.ResponseWriter, r *http.Request) {
	if h.workRuns == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "work run store not configured"})
		return
	}
	filter := workrun.ListFilter{
		WorkUID:    strings.TrimSpace(r.URL.Query().Get("workUid")),
		Status:     strings.TrimSpace(r.URL.Query().Get("status")),
		Controller: strings.TrimSpace(r.URL.Query().Get("controller")),
	}
	writeJSON(w, http.StatusOK, map[string]any{"workRuns": h.workRuns.List(filter)})
}

func (h *Handler) GetWorkRun(w http.ResponseWriter, r *http.Request) {
	if h.workRuns == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "work run store not configured"})
		return
	}
	run, ok := h.workRuns.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "work run not found"})
		return
	}
	checkpoint := h.workRuns.Checkpoint(run)
	writeJSON(w, http.StatusOK, map[string]any{
		"workRun":    run,
		"checkpoint": checkpoint,
		"resumeJson": workrun.ResumeJSON(run),
	})
}

func (h *Handler) ResumeWorkRun(w http.ResponseWriter, r *http.Request) {
	if h.workRuns == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "work run store not configured"})
		return
	}
	var req workRunResumeRequest
	if r.Body != nil && r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
	}
	runID := firstNonEmpty(chi.URLParam(r, "id"), req.ResumeJSON.RunID)
	status := firstNonEmpty(req.Status, req.ResumeJSON.Status)
	if status == "" && req.Result == nil {
		status = workrun.StatusRunning
	}
	run, checkpoint, err := h.workRuns.Record(workrun.RecordRequest{
		RunID:            runID,
		WorkUID:          firstNonEmpty(req.WorkUID, req.ResumeJSON.WorkUID),
		ProjectPath:      firstNonEmpty(req.ProjectPath, req.ResumeJSON.ProjectPath),
		Controller:       firstNonEmpty(req.Controller, req.ResumeJSON.ControllerHint, workrun.ControllerInternalAPI),
		Intent:           req.Intent,
		Status:           status,
		Step:             firstNonEmpty(req.CurrentStep, req.ResumeJSON.CurrentStep),
		NextAction:       firstNonEmpty(req.NextAction, req.ResumeJSON.NextAction),
		Summary:          req.Summary,
		Entities:         req.ResumeJSON.KnownEntities,
		PublicDisclosure: req.PublicDisclosure,
		OwnerDisclosure:  req.OwnerDisclosure,
		Result:           req.Result,
	})
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"workRun":    run,
		"checkpoint": checkpoint,
		"resumeJson": workrun.ResumeJSON(run),
	})
}

func (h *Handler) StopWorkRun(w http.ResponseWriter, r *http.Request) {
	if h.workRuns == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "work run store not configured"})
		return
	}
	var req struct {
		Reason string `json:"reason,omitempty"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	run, checkpoint, err := h.workRuns.Stop(chi.URLParam(r, "id"), req.Reason)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"workRun":    run,
		"checkpoint": checkpoint,
		"resumeJson": workrun.ResumeJSON(run),
	})
}

func (h *Handler) ListWorkRunEvents(w http.ResponseWriter, r *http.Request) {
	if h.workRuns == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "work run store not configured"})
		return
	}
	run, ok := h.workRuns.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "work run not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workRun": run, "events": h.workRuns.Events(run.RunID)})
}

func (h *Handler) decorateWorkRunPayload(payload map[string]any, ctx workRunContext, result any) map[string]any {
	if h.workRuns == nil {
		return payload
	}
	if payload == nil {
		payload = map[string]any{}
	}
	if ctx.RunID == "" && ctx.WorkUID == "" && ctx.ProjectPath == "" {
		return payload
	}
	ctx.WorkUID = firstNonEmpty(ctx.WorkUID, stringFromAny(payload["workUid"]))
	ctx.ProjectPath = firstNonEmpty(ctx.ProjectPath, stringFromAny(payload["projectPath"]))
	ctx.NextAction = firstNonEmpty(ctx.NextAction, stringFromAny(payload["nextAction"]))
	ctx.Summary = firstNonEmpty(ctx.Summary, stringFromAny(payload["summary"]))
	if ctx.Status == "" {
		ctx.Status = workrun.DeriveStatus(ctx.NextAction, payload)
	}
	if ctx.Status == workrun.StatusNoSuitableWorker {
		payload["summary"] = firstNonEmpty(ctx.Summary, workrun.NoSuitableWorkerMessage())
		payload["nextAction"] = "tell_user_exora_cannot_help"
		payload["dockHelpMessage"] = workrun.NoSuitableWorkerMessage()
		ctx.Summary = stringFromAny(payload["summary"])
		ctx.NextAction = stringFromAny(payload["nextAction"])
	}
	run, checkpoint, err := h.workRuns.Record(workrun.RecordRequest{
		RunID:       ctx.RunID,
		WorkUID:     ctx.WorkUID,
		ProjectPath: ctx.ProjectPath,
		Controller:  firstNonEmpty(ctx.Controller, workrun.ControllerInternalAPI),
		Intent:      ctx.Intent,
		Status:      ctx.Status,
		Step:        ctx.CurrentStep,
		NextAction:  ctx.NextAction,
		Summary:     ctx.Summary,
		Result:      firstNonNil(result, payload),
	})
	if err != nil {
		payload["workRunError"] = err.Error()
		return payload
	}
	for key, value := range workrun.ResponseEnvelope(run, checkpoint) {
		payload[key] = value
	}
	return payload
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func workRunContextFromMap(value map[string]any) workRunContext {
	ctx := workRunContext{
		RunID:       stringFromAny(value["runId"]),
		WorkUID:     firstNonEmpty(stringFromAny(value["workUid"]), stringFromAny(value["workUID"]), stringFromAny(value["uid"])),
		ProjectPath: stringFromAny(value["projectPath"]),
		Controller:  stringFromAny(value["controller"]),
		Intent:      firstNonEmpty(stringFromAny(value["intent"]), stringFromAny(value["query"])),
		CurrentStep: stringFromAny(value["currentStep"]),
		NextAction:  stringFromAny(value["nextAction"]),
		Status:      stringFromAny(value["status"]),
		Summary:     stringFromAny(value["summary"]),
	}
	if resume, ok := value["resumeJson"].(map[string]any); ok {
		ctx.RunID = firstNonEmpty(ctx.RunID, stringFromAny(resume["runId"]))
		ctx.WorkUID = firstNonEmpty(ctx.WorkUID, stringFromAny(resume["workUid"]))
		ctx.ProjectPath = firstNonEmpty(ctx.ProjectPath, stringFromAny(resume["projectPath"]))
		ctx.Controller = firstNonEmpty(ctx.Controller, stringFromAny(resume["controllerHint"]))
		ctx.CurrentStep = firstNonEmpty(ctx.CurrentStep, stringFromAny(resume["currentStep"]))
		ctx.NextAction = firstNonEmpty(ctx.NextAction, stringFromAny(resume["nextAction"]))
		ctx.Status = firstNonEmpty(ctx.Status, stringFromAny(resume["status"]))
	}
	return ctx
}

func (ctx workRunContext) withStep(step string) workRunContext {
	ctx.CurrentStep = firstNonEmpty(ctx.CurrentStep, step)
	return ctx
}

func (ctx workRunContext) withController(controller string) workRunContext {
	ctx.Controller = firstNonEmpty(ctx.Controller, controller)
	return ctx
}

func (ctx workRunContext) withIntent(intent string) workRunContext {
	ctx.Intent = firstNonEmpty(ctx.Intent, intent)
	return ctx
}

func (ctx workRunContext) String() string {
	data, _ := json.Marshal(ctx)
	return fmt.Sprintf("%s", data)
}
