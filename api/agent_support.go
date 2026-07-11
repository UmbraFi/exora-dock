package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"

	"github.com/exora-dock/exora-dock/internal/agentcard"
)

func (h *Handler) SearchCloudAgentCards(w http.ResponseWriter, r *http.Request) {
	role := strings.TrimSpace(r.URL.Query().Get("role"))
	query := firstNonEmpty(strings.TrimSpace(r.URL.Query().Get("q")), strings.TrimSpace(r.URL.Query().Get("query")))
	writeJSON(w, http.StatusOK, h.searchAgentCards(r.Context(), role, query))
}

func (h *Handler) searchAgentCards(ctx context.Context, role string, query string) map[string]any {
	role = strings.TrimSpace(role)
	query = strings.TrimSpace(query)
	cloudURL := strings.TrimRight(strings.TrimSpace(h.cardPublisher.CloudURL), "/")
	if cloudURL != "" {
		endpoint, err := url.Parse(cloudURL + "/v1/agent-cards")
		if err == nil {
			values := endpoint.Query()
			if role != "" {
				values.Set("role", role)
			}
			if query != "" {
				values.Set("q", query)
			}
			endpoint.RawQuery = values.Encode()
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
			if err == nil {
				client := h.cardPublisher.Client
				if client == nil {
					client = http.DefaultClient
				}
				resp, err := client.Do(req)
				if err == nil {
					defer resp.Body.Close()
					var payload map[string]any
					if resp.StatusCode >= 200 && resp.StatusCode < 300 && json.NewDecoder(resp.Body).Decode(&payload) == nil {
						payload["source"] = "cloud"
						return payload
					}
				}
			}
		}
	}
	return map[string]any{"cards": h.localAgentCards(role, query), "source": "local"}
}

func (h *Handler) localAgentCards(role string, query string) []agentcard.AgentCard {
	if h.agentCards == nil {
		return []agentcard.AgentCard{}
	}
	query = strings.ToLower(strings.TrimSpace(query))
	role = strings.ToLower(strings.TrimSpace(role))
	out := []agentcard.AgentCard{}
	for _, card := range h.agentCards.List() {
		if role != "" && string(card.Role) != role {
			continue
		}
		if query != "" {
			data, _ := json.Marshal(card)
			if !strings.Contains(strings.ToLower(string(data)), query) {
				continue
			}
		}
		out = append(out, card)
	}
	return out
}

func (h *Handler) invokeJSONHandler(ctx context.Context, method string, path string, body map[string]any, handler http.HandlerFunc) (map[string]any, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req := httptest.NewRequest(method, "http://127.0.0.1"+path, bytes.NewReader(data)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler(rec, req)
	resp := rec.Result()
	defer resp.Body.Close()
	out, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{}
	if len(bytes.TrimSpace(out)) > 0 {
		if err := json.Unmarshal(out, &payload); err != nil {
			return nil, err
		}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("handler returned %s: %s", resp.Status, strings.TrimSpace(string(out)))
	}
	return payload, nil
}

func firstAgentArgString(args map[string]any, names ...string) string {
	for _, name := range names {
		if value := agentArgString(args, name); value != "" {
			return value
		}
	}
	return ""
}

func agentArgString(args map[string]any, name string) string {
	value, ok := args[name]
	if !ok || value == nil {
		return ""
	}
	if typed, ok := value.(string); ok {
		return strings.TrimSpace(typed)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func negotiationStats(payload map[string]any) ([]string, int, int) {
	ids := []string{}
	quoted, rejected := 0, 0
	var walk func(any)
	walk = func(value any) {
		switch typed := value.(type) {
		case map[string]any:
			if id, _ := typed["negotiationId"].(string); strings.TrimSpace(id) != "" {
				ids = append(ids, strings.TrimSpace(id))
				switch strings.ToLower(strings.TrimSpace(stringFromAny(typed["status"]))) {
				case "quoted":
					quoted++
				case "rejected":
					rejected++
				}
			}
			for _, child := range typed {
				walk(child)
			}
		case []any:
			for _, child := range typed {
				walk(child)
			}
		}
	}
	walk(payload)
	return uniqueStrings(ids), quoted, rejected
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}
