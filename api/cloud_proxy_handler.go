package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
)

// These handlers intentionally expose a fixed route table. They are not a
// generic HTTP relay and never accept a caller-supplied upstream method/path.
func (h *Handler) ListCloudTransactions(w http.ResponseWriter, r *http.Request) {
	h.proxyCloudOwnerRead(w, r, "/v2/transactions", r.URL.Query())
}

func (h *Handler) CreateCloudTransaction(w http.ResponseWriter, r *http.Request) {
	h.proxyCloudOwnerWrite(w, r, "/v2/transactions")
}

func (h *Handler) GetCloudInbox(w http.ResponseWriter, r *http.Request) {
	h.proxyCloudOwnerRead(w, r, "/v2/inbox", r.URL.Query())
}

func (h *Handler) ListCloudAgentCards(w http.ResponseWriter, r *http.Request) {
	query := url.Values{}
	if value := strings.TrimSpace(r.URL.Query().Get("query")); value != "" {
		query.Set("query", value)
	}
	h.proxyCloudOwnerRead(w, r, "/v2/agent-cards", query)
}

func (h *Handler) RespondCloudHumanRequest(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "human request id required"})
		return
	}
	h.proxyCloudOwnerWrite(w, r, "/v2/human-requests/"+url.PathEscape(id)+"/respond")
}

func (h *Handler) proxyCloudOwnerRead(w http.ResponseWriter, r *http.Request, path string, query url.Values) {
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	status, payload, err := h.cloudV2Request(r, http.MethodGet, path, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeCloudPayload(w, status, payload)
}

func (h *Handler) proxyCloudOwnerWrite(w http.ResponseWriter, r *http.Request, path string) {
	data, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "read request body"})
		return
	}
	var body any
	if len(strings.TrimSpace(string(data))) == 0 || json.Unmarshal(data, &body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "valid JSON body required"})
		return
	}
	body = redactCloudValue(body)
	status, payload, err := h.cloudV2Request(r, http.MethodPost, path, body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeCloudPayload(w, status, payload)
}

func writeCloudPayload(w http.ResponseWriter, status int, payload []byte) {
	var decoded any
	if len(payload) == 0 {
		w.WriteHeader(status)
		return
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Cloud returned invalid JSON"})
		return
	}
	writeJSON(w, status, redactCloudValue(decoded))
}

func redactCloudValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			if sensitiveCloudKey(key) {
				out[key] = "[redacted]"
				continue
			}
			out[key] = redactCloudValue(item)
		}
		return out
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, redactCloudValue(item))
		}
		return out
	default:
		return value
	}
}

func sensitiveCloudKey(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	for _, fragment := range []string{
		"token", "secret", "credential", "password", "mnemonic", "privatekey", "private_key",
		"paymentpin", "payment_pin", "ownerkey", "owner_key", "apikey", "api_key",
	} {
		if strings.Contains(normalized, fragment) {
			return true
		}
	}
	return normalized == "pin"
}
