package api

import (
	"net/http"
	"strings"
)

func (h *Handler) V3CreateAgentSession(w http.ResponseWriter, r *http.Request) {
	if h.localAuth == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "local authorization unavailable"})
		return
	}
	var input struct {
		ClientName string   `json:"clientName"`
		Scopes     []string `json:"scopes"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	session, token, err := h.localAuth.CreateSession(input.ClientName, input.Scopes)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	baseURL := ""
	if h.discovery != nil {
		baseURL = strings.TrimRight(h.discovery.BaseURL, "/") + "/v4"
	}
	writeJSON(w, http.StatusCreated, map[string]any{"session": session, "sessionKey": token, "baseUrl": baseURL})
}

func (h *Handler) V3AgentSessions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"sessions": h.localAuth.ListSessions()})
}

func (h *Handler) V3AgentSessionPolicy(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{"scopes": h.localAuth.SessionPolicy(), "idleSeconds": 1800, "maxLifetimeSeconds": 86400})
		return
	}
	var input struct {
		Scopes []string `json:"scopes"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if err := h.localAuth.SetSessionPolicy(input.Scopes); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"scopes": h.localAuth.SessionPolicy(), "idleSeconds": 1800, "maxLifetimeSeconds": 86400})
}

func (h *Handler) V3RevokeAgentSession(w http.ResponseWriter, r *http.Request) {
	if !h.localAuth.RevokeSession(r.PathValue("id")) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Agent session not found"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) V3AgentSessionHeartbeat(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	session, ok := h.localAuth.SessionForToken(token)
	if !ok || session.SessionID != strings.TrimSpace(r.PathValue("id")) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "valid Agent session required"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": session})
}

func (h *Handler) V3SetAccountKey(w http.ResponseWriter, r *http.Request) {
	var input struct {
		AccountID string `json:"accountId"`
		Key       string `json:"key"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	input.AccountID = strings.TrimSpace(input.AccountID)
	if h.enforceAccountScope && (h.activeAccountID == "" || input.AccountID != h.activeAccountID) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "account key does not match the active account", "errorCode": "account_scope_mismatch"})
		return
	}
	if err := h.localAuth.SetAccountKey(input.AccountID, input.Key); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"configured": true, "accountId": strings.TrimSpace(input.AccountID)})
}

func (h *Handler) V3AccountKeyStatus(w http.ResponseWriter, _ *http.Request) {
	accountID, _, ok := h.localAuth.AccountKey()
	if h.enforceAccountScope && accountID != h.activeAccountID {
		accountID, ok = "", false
	}
	writeJSON(w, http.StatusOK, map[string]any{"configured": ok, "accountId": accountID})
}

func (h *Handler) V3LockLocalAccount(w http.ResponseWriter, _ *http.Request) {
	h.localAuth.LockAccount()
	w.WriteHeader(http.StatusNoContent)
}
