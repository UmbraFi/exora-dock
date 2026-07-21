package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/exora-dock/exora-dock/internal/sellerdraft"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) V4SubmitAPICapability(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.SubmitCapabilityInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid Capability Form", "errorCode": "invalid_json"})
		return
	}
	value, err := service.SubmitAPICapabilityContext(r.Context(), input)
	if err != nil {
		var validationErr *sellerdraft.CapabilityValidationError
		if errors.As(err, &validationErr) {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": validationErr.Error(), "errorCode": "capability_validation_failed", "issues": validationErr.Issues})
			return
		}
		status := http.StatusConflict
		if input.APIID == "" {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, map[string]any{"error": err.Error(), "errorCode": apiDraftMutationErrorCode(err)})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"apiDraft": value})
}

func (h *Handler) V4CreateLocalAPIDraft(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.CreateAPIDraftInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid API draft request", "errorCode": "invalid_json"})
		return
	}
	value, err := service.CreateAPIDraftContext(r.Context(), input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error(), "errorCode": "api_draft_create_rejected"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"apiDraft": value})
}

func (h *Handler) V4DeleteAPIDraft(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.DeleteAPIDraftInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid API draft deletion", "errorCode": "invalid_json"})
		return
	}
	if err := service.DeleteAPIDraftContext(r.Context(), chi.URLParam(r, "apiId"), input); err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "errorCode": apiDraftMutationErrorCode(err)})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (h *Handler) V4UpdateAPIDraftIdentity(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.UpdateDraftIdentityInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid API identity update", "errorCode": "invalid_json"})
		return
	}
	value, err := service.UpdateDraftIdentityContext(r.Context(), chi.URLParam(r, "apiId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "errorCode": apiDraftMutationErrorCode(err)})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func apiDraftMutationErrorCode(err error) string {
	message := err.Error()
	switch {
	case message == "API draft not found":
		return "api_draft_not_found"
	case message == "API draft version conflict":
		return "api_draft_version_conflict"
	case message == "a live API cannot be overwritten", message == "a live API cannot be deleted as a draft":
		return "live_api_immutable"
	default:
		return "capability_submission_failed"
	}
}

func (h *Handler) V4ListAPIDrafts(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDrafts": service.ListAPIDraftsContext(r.Context())})
}

func (h *Handler) V4OfflineProviderAPIsForLogout(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	values, err := service.OfflineAllForLogout(r.Context())
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "errorCode": "provider_logout_offline_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDrafts": values, "offlineCount": len(values)})
}

func (h *Handler) V4GetAPIDraft(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	value, found := service.GetAPIDraft(chi.URLParam(r, "apiId"))
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "API Draft not found", "errorCode": "api_draft_not_found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4GetAPIValidation(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	value, found := service.GetAPIDraft(chi.URLParam(r, "apiId"))
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "API Draft not found", "errorCode": "api_draft_not_found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiId": value.APIID, "version": value.Version, "validation": value.Validation, "operationReviews": value.Operations})
}

func (h *Handler) V4UpdateAPICapability(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.UpdateCapabilityInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid Capability Form update", "errorCode": "invalid_json"})
		return
	}
	value, err := service.UpdateCapabilityContext(r.Context(), chi.URLParam(r, "apiId"), input)
	if err != nil {
		var validationErr *sellerdraft.CapabilityValidationError
		if errors.As(err, &validationErr) {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": validationErr.Error(), "errorCode": "capability_validation_failed", "issues": validationErr.Issues})
			return
		}
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "errorCode": "capability_update_rejected"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4SubmitAPIContract(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.SubmitAPIContractInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid API contract", "errorCode": "invalid_json"})
		return
	}
	value, err := service.SubmitAPIContractContext(r.Context(), chi.URLParam(r, "apiId"), input)
	if err != nil {
		var validationErr *sellerdraft.CapabilityValidationError
		if errors.As(err, &validationErr) {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": validationErr.Error(), "errorCode": "contract_validation_failed", "issues": validationErr.Issues})
			return
		}
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "errorCode": "contract_submission_rejected"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4ClearAPIContract(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.ClearAPIContractInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid API contract removal", "errorCode": "invalid_json"})
		return
	}
	value, err := service.ClearAPIContractContext(r.Context(), chi.URLParam(r, "apiId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "errorCode": apiDraftMutationErrorCode(err)})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4RunOperationContractValidation(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.ContractValidationInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid contract validation request", "errorCode": "invalid_json"})
		return
	}
	value, err := service.RunContractValidation(r.Context(), chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "errorCode": "contract_validation_rejected"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4ConfirmOperationContract(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.OwnerOperationReviewInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid contract confirmation", "errorCode": "invalid_json"})
		return
	}
	value, err := service.ConfirmContract(chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "errorCode": "contract_confirmation_rejected"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4UpdateAPIOperation(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.UpdateOperationInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid Operation update", "errorCode": "invalid_json"})
		return
	}
	value, err := service.UpdateOperationContext(r.Context(), chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), input)
	if err != nil {
		var validationErr *sellerdraft.CapabilityValidationError
		if errors.As(err, &validationErr) {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": validationErr.Error(), "errorCode": "capability_validation_failed", "issues": validationErr.Issues})
			return
		}
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error(), "errorCode": "operation_update_rejected"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4LockOperationIntegration(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.OwnerOperationReviewInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid capability confirmation"})
		return
	}
	value, err := service.LockIntegration(chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4UnlockOperationIntegration(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.OwnerOperationReviewInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid integration unlock"})
		return
	}
	value, err := service.UnlockIntegration(chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4RunOperationBillingTest(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.PricingDraftInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid billing test"})
		return
	}
	value, err := service.RunBillingTest(chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4GetOperationBillingRun(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	draft, found := service.GetAPIDraft(chi.URLParam(r, "apiId"))
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "API draft not found"})
		return
	}
	review, found := draft.Operations[chi.URLParam(r, "operationId")]
	if !found || capabilityRunID(review.BillingRun) != chi.URLParam(r, "runId") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "billing run not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiId": draft.APIID, "version": draft.Version, "billingRun": review.BillingRun, "billingReceipt": review.PricingBillingReceipt})
}

func (h *Handler) V4LockOperationPricing(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.OwnerOperationReviewInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid pricing lock"})
		return
	}
	value, err := service.LockPricing(chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4UnlockOperationPricing(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.OwnerOperationReviewInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid pricing unlock"})
		return
	}
	value, err := service.UnlockPricing(chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4PublishAPIDraft(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input struct {
		ExpectedVersion int64 `json:"expectedVersion"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid publish request"})
		return
	}
	value, err := service.PublishAPIDraft(r.Context(), chi.URLParam(r, "apiId"), input.ExpectedVersion)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4RunOperationConnectivityTest(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.OwnerOperationReviewInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid connectivity test request"})
		return
	}
	value, err := service.RunConnectivityTest(r.Context(), chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), input.ExpectedVersion, input.OperationHash)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4GetOperationValidationPlan(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	draft, found := service.GetAPIDraft(chi.URLParam(r, "apiId"))
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "API draft not found"})
		return
	}
	review, found := draft.Operations[chi.URLParam(r, "operationId")]
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Operation not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiId": draft.APIID, "version": draft.Version, "validationPlan": review.ValidationPlan})
}

func (h *Handler) V4StartOperationValidationRun(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.ValidationRunInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid validation run request"})
		return
	}
	draft, err := service.StartValidationRun(chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	review := draft.Operations[chi.URLParam(r, "operationId")]
	writeJSON(w, http.StatusAccepted, map[string]any{"apiDraft": draft, "validationRun": review.ValidationRun})
}

func (h *Handler) V4GetOperationValidationRun(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	draft, found := service.GetAPIDraft(chi.URLParam(r, "apiId"))
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "API draft not found"})
		return
	}
	review, found := draft.Operations[chi.URLParam(r, "operationId")]
	if !found || capabilityRunID(review.ValidationRun) != chi.URLParam(r, "runId") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "validation run not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiId": draft.APIID, "version": draft.Version, "validationRun": review.ValidationRun, "validationReceipt": review.ConnectivityReceipt})
}

func capabilityRunID(run map[string]any) string { value, _ := run["runId"].(string); return value }

func (h *Handler) V4CancelOperationValidationRun(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.CancelValidationRunInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid validation cancellation"})
		return
	}
	draft, err := service.CancelValidationRun(chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), chi.URLParam(r, "runId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": draft})
}

func (h *Handler) V4OperationValidationRunEvents(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming unavailable"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	apiID, operationID, runID := chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), chi.URLParam(r, "runId")
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	lastVersion := int64(-1)
	for {
		draft, found := service.GetAPIDraft(apiID)
		if !found {
			return
		}
		review, found := draft.Operations[operationID]
		if !found || capabilityRunID(review.ValidationRun) != runID {
			return
		}
		if draft.Version != lastVersion {
			payload, _ := json.Marshal(map[string]any{"apiId": apiID, "version": draft.Version, "validationRun": review.ValidationRun, "validationReceipt": review.ConnectivityReceipt})
			_, _ = fmt.Fprintf(w, "event: validation\ndata: %s\n\n", payload)
			flusher.Flush()
			lastVersion = draft.Version
		}
		status, _ := review.ValidationRun["status"].(string)
		if status != "running" {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}

func (h *Handler) V4UpdateOperationLifecycle(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.OperationLifecycleInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid lifecycle request"})
		return
	}
	value, err := service.UpdateOperationLifecycle(chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4UpdateOperationSettings(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.OperationSettingsInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid operational settings request"})
		return
	}
	value, err := service.UpdateOperationSettings(r.Context(), chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId"), input)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiDraft": value})
}

func (h *Handler) V4OperationConsoleEvents(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming unavailable"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	apiID, operationID := chi.URLParam(r, "apiId"), chi.URLParam(r, "operationId")
	lastVersion := int64(-1)
	poll := time.NewTicker(2 * time.Second)
	heartbeat := time.NewTicker(15 * time.Second)
	defer poll.Stop()
	defer heartbeat.Stop()
	writeSnapshot := func() bool {
		draft, found := service.GetAPIDraft(apiID)
		if !found {
			return false
		}
		review, found := draft.Operations[operationID]
		if !found {
			return false
		}
		if draft.Version == lastVersion {
			return true
		}
		payload, _ := json.Marshal(map[string]any{"apiId": apiID, "version": draft.Version, "operation": review})
		_, _ = fmt.Fprintf(w, "event: operation\ndata: %s\n\n", payload)
		flusher.Flush()
		lastVersion = draft.Version
		return true
	}
	if !writeSnapshot() {
		_, _ = fmt.Fprint(w, "event: error\ndata: {\"error\":\"operation_not_found\"}\n\n")
		flusher.Flush()
		return
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case <-poll.C:
			if !writeSnapshot() {
				return
			}
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}
