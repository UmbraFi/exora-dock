package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	LLMWireResponses       = "responses"
	LLMWireChatCompletions = "chat_completions"

	LLMProfileResearch = "research"
	LLMProfileUtility  = "utility"
)

type LLMClientConfig struct {
	BaseURL                 string
	APIKey                  string
	ProviderPreset          string
	WireAPI                 string
	Capabilities            LLMCapabilities
	ExtraHeaders            map[string]string
	DisableResponseStorage  bool
	ResearchModel           string
	ResearchReasoningEffort string
	UtilityModel            string
	UtilityReasoningEffort  string
}

type LLMCapabilities struct {
	SupportsResponses          bool
	SupportsChatCompletions    bool
	SupportsSystemMessage      bool
	SupportsJSONResponseFormat bool
	SupportsStreaming          bool
	SupportsTools              bool
	SupportsReasoningEffort    bool
}

type LLMRequestOptions struct {
	Profile        string
	MaxTokens      int
	ResponseFormat map[string]any
}

type OpenAICompatibleClient struct {
	cfg        LLMClientConfig
	httpClient *http.Client
}

func NewOpenAICompatibleClient(cfg LLMClientConfig) *OpenAICompatibleClient {
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	cfg.APIKey = strings.TrimSpace(cfg.APIKey)
	cfg.ProviderPreset = normalizeProviderPreset(cfg.ProviderPreset)
	cfg.WireAPI = normalizeLLMWireAPI(cfg.WireAPI)
	cfg.Capabilities = normalizeLLMCapabilities(cfg.ProviderPreset, cfg.BaseURL, cfg.WireAPI, cfg.Capabilities)
	cfg.ResearchModel = strings.TrimSpace(cfg.ResearchModel)
	cfg.UtilityModel = strings.TrimSpace(cfg.UtilityModel)
	cfg.ResearchReasoningEffort = strings.TrimSpace(cfg.ResearchReasoningEffort)
	cfg.UtilityReasoningEffort = strings.TrimSpace(cfg.UtilityReasoningEffort)
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.openai.com/v1"
	}
	if cfg.ResearchModel == "" {
		cfg.ResearchModel = "gpt-5.5"
	}
	if cfg.UtilityModel == "" {
		cfg.UtilityModel = cfg.ResearchModel
	}
	if cfg.ResearchReasoningEffort == "" {
		cfg.ResearchReasoningEffort = "high"
	}
	if cfg.UtilityReasoningEffort == "" {
		cfg.UtilityReasoningEffort = "low"
	}
	return &OpenAICompatibleClient{
		cfg:        cfg,
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
}

func (c *OpenAICompatibleClient) Enabled() bool {
	return c != nil && c.cfg.BaseURL != "" && (c.cfg.APIKey != "" || !llmPresetRequiresAPIKey(c.cfg.ProviderPreset, c.cfg.BaseURL))
}

func (c *OpenAICompatibleClient) Config() LLMClientConfig {
	if c == nil {
		return LLMClientConfig{}
	}
	return c.cfg
}

func (c *OpenAICompatibleClient) Generate(ctx context.Context, system string, user any, opts LLMRequestOptions) (string, error) {
	if !c.Enabled() {
		return "", fmt.Errorf("LLM API is not configured")
	}
	if opts.Profile == "" {
		opts.Profile = LLMProfileResearch
	}
	switch c.cfg.WireAPI {
	case LLMWireResponses:
		return c.responses(ctx, system, user, opts)
	case LLMWireChatCompletions:
		return c.chatCompletions(ctx, system, user, opts)
	default:
		return "", fmt.Errorf("unsupported LLM wire API %q", c.cfg.WireAPI)
	}
}

func (c *OpenAICompatibleClient) chatCompletions(ctx context.Context, system string, user any, opts LLMRequestOptions) (string, error) {
	messages := []map[string]any{}
	if c.cfg.Capabilities.SupportsSystemMessage {
		messages = append(messages, map[string]any{"role": "system", "content": system})
		messages = append(messages, map[string]any{"role": "user", "content": user})
	} else {
		messages = append(messages, map[string]any{
			"role":    "user",
			"content": systemUserContent(system, user),
		})
	}
	body := map[string]any{
		"model":    c.modelForProfile(opts.Profile),
		"messages": messages,
	}
	if opts.MaxTokens > 0 {
		body["max_tokens"] = opts.MaxTokens
	}
	if opts.ResponseFormat != nil && c.cfg.Capabilities.SupportsJSONResponseFormat {
		body["response_format"] = opts.ResponseFormat
	}
	decoded, err := c.postJSON(ctx, "/chat/completions", body)
	if err != nil {
		return "", err
	}
	var response struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := remarshal(decoded, &response); err != nil {
		return "", fmt.Errorf("decode chat completions response: %w", err)
	}
	if len(response.Choices) == 0 {
		return "", fmt.Errorf("chat completions response did not include choices")
	}
	return strings.TrimSpace(response.Choices[0].Message.Content), nil
}

func (c *OpenAICompatibleClient) responses(ctx context.Context, system string, user any, opts LLMRequestOptions) (string, error) {
	if !c.cfg.Capabilities.SupportsResponses {
		return "", fmt.Errorf("LLM provider preset %q does not support Responses; switch Wire API to Chat completions", c.cfg.ProviderPreset)
	}
	instructions := system
	body := map[string]any{
		"model":        c.modelForProfile(opts.Profile),
		"instructions": instructions,
		"input":        user,
	}
	if c.cfg.Capabilities.SupportsReasoningEffort {
		body["reasoning"] = map[string]any{"effort": c.reasoningForProfile(opts.Profile)}
	}
	if opts.MaxTokens > 0 {
		body["max_output_tokens"] = opts.MaxTokens
	}
	if c.cfg.DisableResponseStorage {
		body["store"] = false
	}
	if opts.ResponseFormat != nil {
		if c.cfg.Capabilities.SupportsJSONResponseFormat {
			body["text"] = map[string]any{"format": opts.ResponseFormat}
		} else {
			body["instructions"] = system + "\n\nReturn a single valid JSON object only."
		}
	}
	decoded, err := c.postJSON(ctx, "/responses", body)
	if err != nil {
		return "", err
	}
	text, err := responseText(decoded)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(text), nil
}

func (c *OpenAICompatibleClient) postJSON(ctx context.Context, route string, body map[string]any) (map[string]any, error) {
	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	candidates := c.baseURLCandidates()
	var lastErr error
	for index, baseURL := range candidates {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+route, bytes.NewReader(bodyJSON))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		if c.cfg.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
		}
		for key, value := range c.cfg.ExtraHeaders {
			key = strings.TrimSpace(key)
			value = strings.TrimSpace(value)
			if key == "" || value == "" {
				continue
			}
			req.Header.Set(key, value)
		}
		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("LLM request %s: %w", route, err)
			if index < len(candidates)-1 {
				continue
			}
			return nil, lastErr
		}
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read LLM response: %w", readErr)
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			lastErr = routeStatusError(route, resp.StatusCode, data)
			if index < len(candidates)-1 && shouldTryNextBaseURL(resp.StatusCode) {
				continue
			}
			return nil, lastErr
		}
		var decoded map[string]any
		if err := json.Unmarshal(data, &decoded); err != nil {
			lastErr = fmt.Errorf("LLM API returned non-JSON for %s: %w", route, err)
			if index < len(candidates)-1 {
				continue
			}
			return nil, lastErr
		}
		return decoded, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("no LLM base URL candidates available")
}

func (c *OpenAICompatibleClient) baseURLCandidates() []string {
	baseURL := strings.TrimRight(strings.TrimSpace(c.cfg.BaseURL), "/")
	if strings.HasSuffix(baseURL, "/v1") {
		return []string{baseURL}
	}
	return []string{baseURL + "/v1", baseURL}
}

func (c *OpenAICompatibleClient) modelForProfile(profile string) string {
	if profile == LLMProfileUtility {
		return c.cfg.UtilityModel
	}
	return c.cfg.ResearchModel
}

func (c *OpenAICompatibleClient) reasoningForProfile(profile string) string {
	if profile == LLMProfileUtility {
		return c.cfg.UtilityReasoningEffort
	}
	return c.cfg.ResearchReasoningEffort
}

func JSONResponseFormat() map[string]any {
	return map[string]any{"type": "json_object"}
}

func normalizeLLMWireAPI(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	if normalized == "chat" {
		normalized = LLMWireChatCompletions
	}
	switch normalized {
	case LLMWireResponses, LLMWireChatCompletions:
		return normalized
	default:
		return LLMWireResponses
	}
}

func normalizeProviderPreset(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	normalized = strings.ReplaceAll(normalized, " ", "_")
	switch normalized {
	case "openai_responses", "openai_chat", "openrouter", "litellm", "ollama", "lm_studio", "vllm", "localai", "llama_cpp", "textgen", "koboldcpp", "custom_openai_compatible":
		return normalized
	case "openai_chat_completions":
		return "openai_chat"
	case "lite_llm", "litellm_proxy":
		return "litellm"
	case "lmstudio":
		return "lm_studio"
	case "llama.cpp":
		return "llama_cpp"
	case "text_generation_webui", "text_generation_web_ui", "oobabooga":
		return "textgen"
	case "kobold":
		return "koboldcpp"
	default:
		if normalized == "" {
			return "openai_responses"
		}
		return normalized
	}
}

func llmPresetRequiresAPIKey(preset, baseURL string) bool {
	preset = normalizeProviderPreset(preset)
	baseURL = strings.ToLower(strings.TrimSpace(baseURL))
	switch preset {
	case "openai_responses", "openai_chat", "openrouter":
		return true
	case "litellm", "ollama", "lm_studio", "vllm", "localai", "llama_cpp", "textgen", "koboldcpp", "custom_openai_compatible":
		return false
	default:
		return !(strings.Contains(baseURL, "127.0.0.1") || strings.Contains(baseURL, "localhost") || strings.Contains(baseURL, "[::1]"))
	}
}

func normalizeLLMCapabilities(preset, baseURL, wire string, caps LLMCapabilities) LLMCapabilities {
	if caps != (LLMCapabilities{}) {
		return caps
	}
	preset = normalizeProviderPreset(preset)
	baseURL = strings.ToLower(strings.TrimRight(strings.TrimSpace(baseURL), "/"))
	switch preset {
	case "openai_responses":
		return LLMCapabilities{SupportsResponses: true, SupportsChatCompletions: true, SupportsSystemMessage: true, SupportsJSONResponseFormat: true, SupportsStreaming: true, SupportsTools: true, SupportsReasoningEffort: true}
	case "openai_chat":
		return LLMCapabilities{SupportsChatCompletions: true, SupportsSystemMessage: true, SupportsJSONResponseFormat: true, SupportsStreaming: true, SupportsTools: true}
	case "openrouter", "litellm":
		return LLMCapabilities{SupportsChatCompletions: true, SupportsSystemMessage: true, SupportsJSONResponseFormat: true, SupportsStreaming: true, SupportsTools: true}
	case "ollama", "lm_studio", "vllm", "localai", "llama_cpp", "textgen", "koboldcpp", "custom_openai_compatible":
		return LLMCapabilities{SupportsChatCompletions: true, SupportsSystemMessage: true, SupportsJSONResponseFormat: true, SupportsStreaming: true}
	default:
		if wire == LLMWireResponses || strings.HasPrefix(baseURL, "https://api.openai.com") {
			return LLMCapabilities{SupportsResponses: true, SupportsChatCompletions: true, SupportsSystemMessage: true, SupportsJSONResponseFormat: true, SupportsStreaming: true, SupportsTools: true, SupportsReasoningEffort: true}
		}
		return LLMCapabilities{SupportsChatCompletions: true, SupportsSystemMessage: true, SupportsJSONResponseFormat: true, SupportsStreaming: true}
	}
}

func systemUserContent(system string, user any) string {
	userText, ok := user.(string)
	if !ok {
		data, err := json.Marshal(user)
		if err == nil {
			userText = string(data)
		} else {
			userText = fmt.Sprint(user)
		}
	}
	system = strings.TrimSpace(system)
	if system == "" {
		return userText
	}
	return system + "\n\n" + userText
}

func shouldTryNextBaseURL(status int) bool {
	switch status {
	case http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusBadGateway, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func routeStatusError(route string, status int, data []byte) error {
	detail := strings.TrimSpace(string(data))
	if len(detail) > 500 {
		detail = detail[:500]
	}
	if route == "/responses" {
		return fmt.Errorf("LLM API route /responses returned status %d: %s; switch Wire API to Chat completions if this provider does not support Responses", status, detail)
	}
	return fmt.Errorf("LLM API route %s returned status %d: %s", route, status, detail)
}

func responseText(payload map[string]any) (string, error) {
	if text, ok := payload["output_text"].(string); ok && strings.TrimSpace(text) != "" {
		return text, nil
	}
	output, _ := payload["output"].([]any)
	var chunks []string
	for _, item := range output {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		content, _ := itemMap["content"].([]any)
		for _, part := range content {
			partMap, ok := part.(map[string]any)
			if !ok {
				continue
			}
			if text, ok := partMap["text"].(string); ok {
				chunks = append(chunks, text)
			}
		}
	}
	if len(chunks) > 0 {
		return strings.Join(chunks, ""), nil
	}
	return "", fmt.Errorf("responses payload did not include output text")
}

func remarshal(value any, out any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}
