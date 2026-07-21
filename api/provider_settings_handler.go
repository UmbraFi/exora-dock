package api

import (
	"net/http"

	"github.com/exora-dock/exora-dock/internal/sellerdraft"
)

func (h *Handler) requireSellerDrafts(w http.ResponseWriter) (*sellerdraft.Service, bool) {
	if h.sellerDrafts == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provider API service is unavailable"})
		return nil, false
	}
	if h.enforceAccountScope && (h.activeAccountID == "" || h.sellerDrafts.AccountID() != h.activeAccountID) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "active account required", "errorCode": "active_account_required"})
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
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid provider policy"})
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
