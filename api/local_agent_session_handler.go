package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/agentsession"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) StartLocalAgentSession(w http.ResponseWriter, r *http.Request) {
	if h.agentSessions == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "local agent sessions are unavailable"})
		return
	}
	var req agentsession.StartRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	// The executable is supplied by trusted Electron main from the persisted
	// binding, never by an Agent prompt or MCP call. The manager validates the
	// absolute path against its built-in driver registry before execution.
	session, err := h.agentSessions.Start(r.Context(), req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": safeAgentSession(session)})
}

func (h *Handler) GetLocalAgentSession(w http.ResponseWriter, r *http.Request) {
	if h.agentSessions == nil {
		writeAgentSessionUnavailable(w)
		return
	}
	session, ok := h.agentSessions.Get(chi.URLParam(r, "id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": agentsession.ErrNotFound.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": safeAgentSession(session)})
}

func (h *Handler) SendLocalAgentMessage(w http.ResponseWriter, r *http.Request) {
	if h.agentSessions == nil {
		writeAgentSessionUnavailable(w)
		return
	}
	var req agentsession.MessageRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	session, err := h.agentSessions.Send(r.Context(), chi.URLParam(r, "id"), req)
	if err != nil {
		writeAgentSessionError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"session": safeAgentSession(session)})
}

func (h *Handler) InterruptLocalAgentSession(w http.ResponseWriter, r *http.Request) {
	if h.agentSessions == nil {
		writeAgentSessionUnavailable(w)
		return
	}
	session, err := h.agentSessions.Interrupt(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeAgentSessionError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": safeAgentSession(session)})
}

func (h *Handler) StopLocalAgentSession(w http.ResponseWriter, r *http.Request) {
	if h.agentSessions == nil {
		writeAgentSessionUnavailable(w)
		return
	}
	session, err := h.agentSessions.Stop(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeAgentSessionError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": safeAgentSession(session)})
}

func (h *Handler) ResumeLocalAgentSession(w http.ResponseWriter, r *http.Request) {
	if h.agentSessions == nil {
		writeAgentSessionUnavailable(w)
		return
	}
	session, err := h.agentSessions.Resume(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeAgentSessionError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": safeAgentSession(session)})
}

func (h *Handler) RespondLocalAgentHumanRequest(w http.ResponseWriter, r *http.Request) {
	if h.agentSessions == nil {
		writeAgentSessionUnavailable(w)
		return
	}
	var response agentsession.HumanResponse
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&response); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	session, err := h.agentSessions.Respond(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "requestId"), response)
	if err != nil {
		writeAgentSessionError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": safeAgentSession(session)})
}

func (h *Handler) RecordLocalAgentMCPEvent(w http.ResponseWriter, r *http.Request) {
	if h.agentSessions == nil {
		writeAgentSessionUnavailable(w)
		return
	}
	var input struct {
		Tool    string         `json:"tool"`
		Text    string         `json:"text"`
		Payload map[string]any `json:"payload"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	session, err := h.agentSessions.RecordMCPEvent(chi.URLParam(r, "id"), input.Tool, input.Text, input.Payload)
	if err != nil {
		writeAgentSessionError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": safeAgentSession(session)})
}

func (h *Handler) StreamLocalAgentSession(w http.ResponseWriter, r *http.Request) {
	if h.agentSessions == nil {
		writeAgentSessionUnavailable(w)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "streaming unsupported"})
		return
	}
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	writeEvents := func() error {
		events, err := h.agentSessions.Events(chi.URLParam(r, "id"), after)
		if err != nil {
			return err
		}
		for _, event := range events {
			data, _ := json.Marshal(event)
			if _, err := fmt.Fprintf(w, "id: %d\ndata: %s\n\n", event.Seq, data); err != nil {
				return err
			}
			after = event.Seq
		}
		flusher.Flush()
		return nil
	}
	if err := writeEvents(); err != nil {
		return
	}
	ticker := time.NewTicker(500 * time.Millisecond)
	heartbeat := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			if err := writeEvents(); err != nil {
				return
			}
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

func safeAgentSession(session agentsession.Session) agentsession.Session {
	session.Binding.Executable = ""
	session.Events = nil
	session.Queue = nil
	session.Idempotency = nil
	return session
}

func writeAgentSessionUnavailable(w http.ResponseWriter) {
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "local agent sessions are unavailable"})
}
func writeAgentSessionError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, agentsession.ErrNotFound) {
		status = http.StatusNotFound
	}
	writeJSON(w, status, map[string]string{"error": strings.TrimSpace(err.Error())})
}
