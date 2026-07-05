package agent

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLLMClientAddsV1ThenFallsBackToRawBaseURL(t *testing.T) {
	var paths []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.URL.Path == "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer ts.Close()

	client := NewOpenAICompatibleClient(LLMClientConfig{
		BaseURL:       ts.URL,
		APIKey:        "key",
		WireAPI:       LLMWireChatCompletions,
		ResearchModel: "research",
		UtilityModel:  "utility",
	})

	got, err := client.Generate(context.Background(), "system", "user", LLMRequestOptions{})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if got != "ok" {
		t.Fatalf("Generate() = %q", got)
	}
	if len(paths) != 2 || paths[0] != "/v1/chat/completions" || paths[1] != "/chat/completions" {
		t.Fatalf("paths = %#v", paths)
	}
}

func TestLLMClientResponsesUsesProfileAndReasoning(t *testing.T) {
	var payload map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		data, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(data, &payload); err != nil {
			t.Fatalf("payload json: %v", err)
		}
		_, _ = w.Write([]byte(`{"output_text":"utility answer"}`))
	}))
	defer ts.Close()

	client := NewOpenAICompatibleClient(LLMClientConfig{
		BaseURL:                 ts.URL + "/v1",
		APIKey:                  "key",
		WireAPI:                 LLMWireResponses,
		DisableResponseStorage:  true,
		ResearchModel:           "research-model",
		ResearchReasoningEffort: "high",
		UtilityModel:            "utility-model",
		UtilityReasoningEffort:  "low",
	})

	got, err := client.Generate(context.Background(), "system", "user", LLMRequestOptions{
		Profile:        LLMProfileUtility,
		ResponseFormat: JSONResponseFormat(),
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if got != "utility answer" {
		t.Fatalf("Generate() = %q", got)
	}
	if payload["model"] != "utility-model" {
		t.Fatalf("model = %#v", payload["model"])
	}
	reasoning, _ := payload["reasoning"].(map[string]any)
	if reasoning["effort"] != "low" {
		t.Fatalf("reasoning = %#v", reasoning)
	}
	if payload["store"] != false {
		t.Fatalf("store = %#v", payload["store"])
	}
}

func TestLLMClientChatRespectsCapabilityFlags(t *testing.T) {
	var payload map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		data, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(data, &payload); err != nil {
			t.Fatalf("payload json: %v", err)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer ts.Close()

	client := NewOpenAICompatibleClient(LLMClientConfig{
		BaseURL:        ts.URL + "/v1",
		APIKey:         "key",
		WireAPI:        LLMWireChatCompletions,
		ProviderPreset: "custom_openai_compatible",
		Capabilities: LLMCapabilities{
			SupportsChatCompletions: true,
			SupportsSystemMessage:   false,
		},
		ResearchModel: "model",
	})

	if _, err := client.Generate(context.Background(), "system prompt", "user prompt", LLMRequestOptions{
		ResponseFormat: JSONResponseFormat(),
	}); err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if _, ok := payload["response_format"]; ok {
		t.Fatalf("response_format should not be sent: %#v", payload)
	}
	messages, _ := payload["messages"].([]any)
	if len(messages) != 1 {
		t.Fatalf("messages = %#v", messages)
	}
	message, _ := messages[0].(map[string]any)
	if message["role"] != "user" {
		t.Fatalf("message role = %#v", message["role"])
	}
	content, _ := message["content"].(string)
	if !strings.Contains(content, "system prompt") || !strings.Contains(content, "user prompt") {
		t.Fatalf("merged content = %q", content)
	}
}

func TestLLMClientRejectsResponsesWhenPresetDoesNotSupportIt(t *testing.T) {
	client := NewOpenAICompatibleClient(LLMClientConfig{
		BaseURL:        "http://127.0.0.1:1/v1",
		APIKey:         "key",
		ProviderPreset: "openrouter",
		WireAPI:        LLMWireResponses,
		ResearchModel:  "model",
	})

	_, err := client.Generate(context.Background(), "system", "user", LLMRequestOptions{})
	if err == nil || !strings.Contains(err.Error(), "does not support Responses") {
		t.Fatalf("Generate() error = %v", err)
	}
}

func TestLLMClientAllowsKeylessLocalProvider(t *testing.T) {
	var auth string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"local ok"}}]}`))
	}))
	defer ts.Close()

	client := NewOpenAICompatibleClient(LLMClientConfig{
		BaseURL:        ts.URL + "/v1",
		ProviderPreset: "ollama",
		WireAPI:        LLMWireChatCompletions,
		ResearchModel:  "llama3",
	})
	if !client.Enabled() {
		t.Fatalf("local provider should be enabled without API key")
	}
	got, err := client.Generate(context.Background(), "system", "user", LLMRequestOptions{})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if got != "local ok" {
		t.Fatalf("Generate() = %q", got)
	}
	if auth != "" {
		t.Fatalf("Authorization header = %q", auth)
	}
}
