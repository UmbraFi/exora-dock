package api

import (
	"net/http"
	"time"

	"github.com/exora-dock/exora-dock/internal/endpoint"
)

func (h *Handler) V3LocalEndpoints(w http.ResponseWriter, _ *http.Request) {
	if h.endpoints == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "local endpoint store is unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"endpoints": h.endpoints.List()})
}

func (h *Handler) V3SaveLocalEndpoint(w http.ResponseWriter, r *http.Request) {
	if h.endpoints == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "local endpoint store is unavailable"})
		return
	}
	var input endpoint.Config
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid endpoint configuration"})
		return
	}
	if id := r.PathValue("id"); id != "" {
		input.EndpointID = id
	}
	saved, err := h.endpoints.Save(r.Context(), input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if h.endpointTunnel != nil {
		h.endpointTunnel.Notify()
	}
	writeJSON(w, http.StatusOK, map[string]any{"endpoint": saved})
}

func (h *Handler) V3ProbeLocalEndpoint(w http.ResponseWriter, r *http.Request) {
	var input endpoint.ProbeInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid endpoint probe"})
		return
	}
	ctx, cancel := contextWithTimeout(r, 15*time.Second)
	defer cancel()
	status := endpoint.Probe(ctx, input)
	writeJSON(w, http.StatusOK, map[string]any{"status": status})
}

func (h *Handler) V3TestLocalEndpointRoute(w http.ResponseWriter, r *http.Request) {
	var input endpoint.RouteTestInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid endpoint route test"})
		return
	}
	ctx, cancel := contextWithTimeout(r, 32*time.Second)
	defer cancel()
	result := endpoint.TestRoute(ctx, input)
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}
