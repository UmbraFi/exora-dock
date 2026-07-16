package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/exora-dock/exora-dock/internal/sellerdraft"
)

func (h *Handler) requireSellerDrafts(w http.ResponseWriter) (*sellerdraft.Service, bool) {
	if h.sellerDrafts == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "seller automation service is unavailable"})
		return nil, false
	}
	return h.sellerDrafts, true
}

func (h *Handler) V3SellerAutomationPolicy(w http.ResponseWriter, _ *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	policy, found := service.Policy()
	writeJSON(w, http.StatusOK, map[string]any{"configured": found, "policy": policy})
}

func (h *Handler) V3SaveSellerAutomationPolicy(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.SellerAutomationPolicy
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid seller automation policy"})
		return
	}
	policy, err := service.SavePolicy(input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"policy": policy})
}

func (h *Handler) V3SellerCredentials(w http.ResponseWriter, _ *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	credentials, err := service.ListCredentials()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"credentials": credentials})
}

func (h *Handler) V3SaveSellerCredential(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input struct {
		sellerdraft.CredentialMetadata
		Secret string `json:"secret"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid credential input"})
		return
	}
	metadata, err := service.PutCredential(input.CredentialMetadata, input.Secret)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	// Only metadata leaves the credential boundary.
	writeJSON(w, http.StatusOK, map[string]any{"credential": metadata})
}

func (h *Handler) V3DeleteSellerCredential(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	if err := service.DeleteCredential(r.PathValue("id")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) V3SellerDraftCapabilities(w http.ResponseWriter, _ *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	payload, err := service.Capabilities()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (h *Handler) V3DiscoverSellerCandidates(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.DiscoverRequest
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid discovery input"})
		return
	}
	candidates, err := service.Discover(r.Context(), input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"candidates": candidates})
}

func (h *Handler) V3ReadSellerMaterial(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.ReadRequest
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid material read input"})
		return
	}
	chunk, err := service.ReadMaterial(input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"material": chunk})
}

func (h *Handler) V3CreateSellerDraftRun(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.CreateRequest
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid seller draft request"})
		return
	}
	run, err := service.Create(input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"run": run})
}

func (h *Handler) V3GetSellerDraftRun(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	run, found := service.Get(r.PathValue("id"))
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "seller draft run not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"run": run})
}

func (h *Handler) V3ListSellerDraftRuns(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	writeJSON(w, http.StatusOK, map[string]any{"runs": service.List(limit)})
}

func (h *Handler) V3ResumeSellerDraftRun(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.ResumeRequest
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid resume input"})
		return
	}
	input.RunID = r.PathValue("id")
	run, err := service.Resume(input)
	if err != nil {
		writeJSON(w, conflictStatus(err), map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"run": run})
}

func (h *Handler) V3CancelSellerDraftRun(w http.ResponseWriter, r *http.Request) {
	service, ok := h.requireSellerDrafts(w)
	if !ok {
		return
	}
	var input sellerdraft.CancelRequest
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid cancel input"})
		return
	}
	input.RunID = r.PathValue("id")
	run, err := service.Cancel(input)
	if err != nil {
		writeJSON(w, conflictStatus(err), map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"run": run})
}

func conflictStatus(err error) int {
	if err != nil && (strings.Contains(err.Error(), "version conflict") || strings.Contains(err.Error(), "idempotencyKey reused")) {
		return http.StatusConflict
	}
	return http.StatusBadRequest
}
