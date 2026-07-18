package api

import (
	"encoding/json"
	"net/http"
	"strings"
)

func writeCloudPayload(w http.ResponseWriter, status int, payload []byte) {
	var decoded any
	if len(payload) == 0 {
		w.WriteHeader(status)
		return
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		code := "cloud_invalid_response"
		message := "Exora Cloud returned an invalid response"
		if status == http.StatusMethodNotAllowed {
			code = "cloud_operation_not_supported"
			message = "This Exora Cloud deployment does not support this operation yet. Deploy the matching Cloud API and database migration, then retry."
		}
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": message, "code": code, "upstreamStatus": status})
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
			} else {
				out[key] = redactCloudValue(item)
			}
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
	for _, fragment := range []string{"token", "secret", "credential", "password", "mnemonic", "privatekey", "private_key", "paymentpin", "payment_pin", "ownerkey", "owner_key", "apikey", "api_key"} {
		if strings.Contains(normalized, fragment) {
			return true
		}
	}
	return normalized == "pin"
}
