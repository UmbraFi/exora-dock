package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (h *Handler) V3Catalog(w http.ResponseWriter, r *http.Request) {
	path := "/v4/catalog/products"
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	h.v3BuyerCloudProxy(w, r, http.MethodGet, path, nil)
}
func (h *Handler) V3CatalogProduct(w http.ResponseWriter, r *http.Request) {
	h.v3BuyerCloudProxy(w, r, http.MethodGet, "/v4/catalog/products/"+r.PathValue("id"), nil)
}

func (h *Handler) V3ConsumerProxy(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	var body any
	if r.Method != http.MethodGet && r.Method != http.MethodDelete {
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
	h.v3BuyerCloudProxy(w, r, r.Method, path, body)
}

func (h *Handler) V3ActivitySessions(w http.ResponseWriter, r *http.Request) {
	path := "/v4/activity-sessions"
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	h.v3BuyerCloudProxy(w, r, http.MethodGet, path, nil)
}

func (h *Handler) V3ActivitySession(w http.ResponseWriter, r *http.Request) {
	path := "/v4/activity-sessions/" + r.PathValue("id")
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	h.v3BuyerCloudProxy(w, r, http.MethodGet, path, nil)
}
func (h *Handler) V3ProviderProxy(w http.ResponseWriter, r *http.Request) {
	path := "/v4/provider/" + strings.TrimPrefix(chi.URLParam(r, "*"), "/")
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
	status, payload, err := h.cloudV2Request(r, r.Method, path, body)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	writeCloudPayload(w, status, payload)
}
func (h *Handler) v3CloudProxy(w http.ResponseWriter, r *http.Request, method, path string, body any) {
	status, payload, err := h.cloudV2Request(r, method, path, body)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	writeCloudPayload(w, status, payload)
}

func (h *Handler) v3BuyerCloudProxy(w http.ResponseWriter, r *http.Request, method, path string, body any) {
	status, payload, err := h.accountCloudRequest(r, method, path, body)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	writeCloudPayload(w, status, payload)
}
