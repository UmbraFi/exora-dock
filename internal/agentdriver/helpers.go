package agentdriver

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

func randomIdentifier() string {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		return fmt.Sprintf("session-%p", &data)
	}
	return hex.EncodeToString(data)
}

func emit(sink EventSink, method, threadID, turnID string, value any) {
	if sink == nil {
		return
	}
	data, _ := json.Marshal(value)
	sink.OnEvent(Event{Method: method, ThreadID: threadID, TurnID: turnID, Params: data, Received: receivedNow()})
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return ""
	}
}

func nestedText(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case map[string]any:
		for _, key := range []string{"text", "delta", "result", "message", "content"} {
			if text := strings.TrimSpace(nestedText(typed[key])); text != "" {
				return text
			}
		}
	case []any:
		var parts []string
		for _, child := range typed {
			if text := nestedText(child); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "")
	}
	return ""
}
