package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/exora-dock/exora-dock/internal/providerworker"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) V3Gateway(w http.ResponseWriter, r *http.Request) {
	token, err := cloudlink.LoadToken(h.cloudTokenPath)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Exora Cloud is not configured"})
		return
	}
	cloudURL := firstNonEmpty(strings.TrimSpace(h.cloudURL), strings.TrimSpace(token.CloudURL))
	path := "/v3/gateway/" + chi.URLParam(r, "listingId") + "/" + strings.TrimPrefix(chi.URLParam(r, "*"), "/")
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	up, err := http.NewRequestWithContext(r.Context(), r.Method, strings.TrimRight(cloudURL, "/")+path, r.Body)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	for k, values := range r.Header {
		if strings.EqualFold(k, "Host") {
			continue
		}
		for _, v := range values {
			up.Header.Add(k, v)
		}
	}
	resp, err := http.DefaultClient.Do(up)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	defer resp.Body.Close()
	for k, values := range resp.Header {
		for _, v := range values {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (h *Handler) V3Catalog(w http.ResponseWriter, r *http.Request) {
	path := "/v3/catalog/products"
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	h.v3CloudProxy(w, r, http.MethodGet, path, nil)
}
func (h *Handler) V3CatalogProduct(w http.ResponseWriter, r *http.Request) {
	h.v3CloudProxy(w, r, http.MethodGet, "/v3/catalog/products/"+r.PathValue("id"), nil)
}

func (h *Handler) V3ActivitySessions(w http.ResponseWriter, r *http.Request) {
	path := "/v3/activity-sessions"
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	h.v3CloudProxy(w, r, http.MethodGet, path, nil)
}

func (h *Handler) V3ActivitySession(w http.ResponseWriter, r *http.Request) {
	h.v3CloudProxy(w, r, http.MethodGet, "/v3/activity-sessions/"+r.PathValue("id"), nil)
}

func (h *Handler) V3EnvironmentImageCatalog(w http.ResponseWriter, r *http.Request) {
	path := "/v3/catalog/environment-images"
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	h.v3CloudProxy(w, r, http.MethodGet, path, nil)
}
func (h *Handler) V3EnvironmentImageCatalogItem(w http.ResponseWriter, r *http.Request) {
	path := "/v3/catalog/environment-images/" + r.PathValue("id")
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	h.v3CloudProxy(w, r, http.MethodGet, path, nil)
}
func (h *Handler) V3ProviderProxy(w http.ResponseWriter, r *http.Request) {
	path := "/v3/provider/" + strings.TrimPrefix(chi.URLParam(r, "*"), "/")
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	var body any
	if r.Method != http.MethodGet {
		raw, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		if len(raw) > 0 && json.Unmarshal(raw, &body) != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid JSON"})
			return
		}
	}
	h.v3CloudProxy(w, r, r.Method, path, body)
}
func (h *Handler) v3CloudProxy(w http.ResponseWriter, r *http.Request, method, path string, body any) {
	status, payload, err := h.cloudV2Request(r, method, path, body)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	writeCloudPayload(w, status, payload)
}

func (h *Handler) V3WorkerCommand(w http.ResponseWriter, r *http.Request) {
	command := r.PathValue("command")
	if !providerworker.AllowedCommands[command] {
		writeJSON(w, 400, map[string]string{"error": "unsupported worker command"})
		return
	}
	var input map[string]any
	if err := decodeJSONBody(r, &input); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid JSON"})
		return
	}
	ctx, cancel := contextWithTimeout(r, 3*time.Minute)
	defer cancel()
	out, err := (providerworker.Client{}).Call(ctx, command, input)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"result": out})
}
