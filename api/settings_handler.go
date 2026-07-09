package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/config"
	"gopkg.in/yaml.v3"
)

const (
	buyerAgentSettingsKey = "settings:buyer-agent:v1"
	settingsTTL           = 365 * 24 * time.Hour
)

type BuyerAgentSettings struct {
	Enabled bool   `json:"enabled"`
	AgentID string `json:"agentId"`
}

type SellerAgentSettings struct {
	Enabled               bool     `json:"enabled"`
	AutoQuote             bool     `json:"autoQuote"`
	AutoAcceptLowRisk     bool     `json:"autoAcceptLowRisk"`
	AutoCompleteTextTasks bool     `json:"autoCompleteTextTasks"`
	ProviderID            string   `json:"providerId"`
	QuotePrice            float64  `json:"quotePrice"`
	Currency              string   `json:"currency"`
	EstimatedSeconds      int      `json:"estimatedSeconds"`
	DockerEnabled         bool     `json:"dockerEnabled"`
	DockerDefaultImage    string   `json:"dockerDefaultImage,omitempty"`
	DockerAllowedImages   []string `json:"dockerAllowedImages,omitempty"`
	DockerNetworkMode     string   `json:"dockerNetworkMode,omitempty"`
	DockerAllowedNetworks []string `json:"dockerAllowedNetworkModes,omitempty"`
	DockerAllowGPU        bool     `json:"dockerAllowGpu"`
	DockerMaxCPUs         float64  `json:"dockerMaxCpus,omitempty"`
	DockerMaxMemoryMB     int      `json:"dockerMaxMemoryMb,omitempty"`
	DockerPullPolicy      string   `json:"dockerPullPolicy,omitempty"`
	HasAPIKey             bool     `json:"hasApiKey"`
	KeyFormat             string   `json:"keyFormat"`
}

type RemoteLLMProfile struct {
	ID                      string                 `json:"id"`
	Name                    string                 `json:"name"`
	ProviderPreset          string                 `json:"providerPreset"`
	LLMBaseURL              string                 `json:"llmBaseUrl"`
	WireAPI                 string                 `json:"wireApi"`
	Capabilities            config.LLMCapabilities `json:"capabilities"`
	ResearchModel           string                 `json:"researchModel"`
	ResearchReasoningEffort string                 `json:"researchReasoningEffort"`
	UtilityModel            string                 `json:"utilityModel"`
	UtilityReasoningEffort  string                 `json:"utilityReasoningEffort"`
	DisableResponseStorage  bool                   `json:"disableResponseStorage"`
	HasAPIKey               bool                   `json:"hasApiKey"`
	KeyFormat               string                 `json:"keyFormat"`
	UseForBuyer             bool                   `json:"useForBuyer,omitempty"`
	UseForSeller            bool                   `json:"useForSeller,omitempty"`
}

type LLMProfileStatus struct {
	Profiles        []RemoteLLMProfile `json:"profiles"`
	ActiveProfileID string             `json:"activeProfileId,omitempty"`
	BuyerProfileID  string             `json:"buyerProfileId,omitempty"`
	SellerProfileID string             `json:"sellerProfileId,omitempty"`
}

func defaultBuyerAgentSettings() BuyerAgentSettings {
	return BuyerAgentSettings{Enabled: true, AgentID: "exora-pwa-agent"}
}

func (h *Handler) GetBuyerAgentSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"buyerAgent": h.buyerAgentSettings()})
}

func (h *Handler) SaveBuyerAgentSettings(w http.ResponseWriter, r *http.Request) {
	var req BuyerAgentSettings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	settings := BuyerAgentSettings{
		Enabled: req.Enabled,
		AgentID: firstNonEmpty(strings.TrimSpace(req.AgentID), "exora-pwa-agent"),
	}
	if h.cache != nil {
		if data, err := json.Marshal(settings); err == nil {
			h.cache.Set(buyerAgentSettingsKey, data, settingsTTL)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"buyerAgent": settings})
}

func (h *Handler) GetSellerAgentSettings(w http.ResponseWriter, r *http.Request) {
	cfg, _ := h.loadConfig()
	writeJSON(w, http.StatusOK, map[string]any{"sellerAgent": sellerSettingsFromConfig(cfg)})
}

func (h *Handler) SaveSellerAgentSettings(w http.ResponseWriter, r *http.Request) {
	var req SellerAgentSettings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	raw, err := h.loadConfigMap()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	seller := mapAt(raw, "seller_agent")
	seller["enabled"] = req.Enabled
	seller["auto_quote"] = req.AutoQuote
	seller["auto_accept_low_risk"] = req.AutoAcceptLowRisk
	seller["provider_pubkey"] = strings.TrimSpace(req.ProviderID)
	seller["poll_interval_sec"] = 2
	seller["default_quote_price"] = req.QuotePrice
	seller["default_quote_currency"] = firstNonEmpty(strings.TrimSpace(req.Currency), "USDC")
	if req.EstimatedSeconds <= 0 {
		req.EstimatedSeconds = 60
	}
	seller["default_estimated_seconds"] = req.EstimatedSeconds
	raw["seller_agent"] = seller

	provider := mapAt(raw, "provider")
	docker := mapAt(provider, "docker")
	docker["enabled"] = req.DockerEnabled
	docker["default_image"] = strings.TrimSpace(req.DockerDefaultImage)
	docker["allowed_images"] = compactSettingsStringList(req.DockerAllowedImages)
	docker["network_mode"] = firstNonEmpty(strings.TrimSpace(req.DockerNetworkMode), "none")
	docker["allowed_network_modes"] = compactSettingsStringList(defaultSettingsStringList(req.DockerAllowedNetworks, []string{"none"}))
	docker["allow_gpu"] = req.DockerAllowGPU
	docker["max_cpus"] = req.DockerMaxCPUs
	docker["max_memory_mb"] = req.DockerMaxMemoryMB
	docker["pull_policy"] = firstNonEmpty(strings.TrimSpace(req.DockerPullPolicy), "missing")
	provider["docker"] = docker
	raw["provider"] = provider

	if err := h.saveConfigMap(raw); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	cfg, _ := h.loadConfig()
	writeJSON(w, http.StatusOK, map[string]any{"sellerAgent": sellerSettingsFromConfig(cfg)})
}

func (h *Handler) ListLLMProfiles(w http.ResponseWriter, r *http.Request) {
	status := h.llmProfileStatus()
	writeJSON(w, http.StatusOK, status)
}

func (h *Handler) SaveLLMProfile(w http.ResponseWriter, r *http.Request) {
	var req RemoteLLMProfile
	var rawBody map[string]any
	if err := json.NewDecoder(r.Body).Decode(&rawBody); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	data, _ := json.Marshal(rawBody)
	_ = json.Unmarshal(data, &req)
	id := strings.TrimSpace(req.ID)
	if id == "" {
		if req.UseForSeller && !req.UseForBuyer {
			id = "seller-llm"
		} else {
			id = "buyer-llm"
		}
	}
	apiKey, hasAPIKeyInput := stringField(rawBody, "apiKey")
	clearAPIKey := boolField(rawBody, "clearApiKey")
	raw, err := h.loadConfigMap()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if req.UseForBuyer || (!req.UseForBuyer && !req.UseForSeller && id != "seller-llm") {
		writeLLMRole(raw, "buyer_llm", req, apiKey, hasAPIKeyInput, clearAPIKey)
	}
	if req.UseForSeller || id == "seller-llm" {
		writeLLMRole(raw, "seller_llm", req, apiKey, hasAPIKeyInput, clearAPIKey)
	}
	if err := h.saveConfigMap(raw); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	status := h.llmProfileStatus()
	writeJSON(w, http.StatusOK, status)
}

func (h *Handler) DeleteLLMProfile(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		var req struct {
			ID string `json:"id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		id = strings.TrimSpace(req.ID)
	}
	raw, err := h.loadConfigMap()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	switch id {
	case "buyer-llm":
		delete(raw, "buyer_llm")
	case "seller-llm":
		delete(raw, "seller_llm")
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "profile id must be buyer-llm or seller-llm"})
		return
	}
	if err := h.saveConfigMap(raw); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, h.llmProfileStatus())
}

func (h *Handler) TestLLMProfile(w http.ResponseWriter, r *http.Request) {
	var req RemoteLLMProfile
	_ = json.NewDecoder(r.Body).Decode(&req)
	profile := req
	if strings.TrimSpace(profile.LLMBaseURL) == "" {
		status := h.llmProfileStatus()
		if len(status.Profiles) > 0 {
			profile = status.Profiles[0]
		}
	}
	if strings.TrimSpace(profile.LLMBaseURL) == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "status": "missing_base_url", "message": "LLM base URL is required."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":              true,
		"status":          "ready",
		"message":         "LLM profile is syntactically configured. Remote tests never return the API key.",
		"llmBaseUrl":      strings.TrimRight(strings.TrimSpace(profile.LLMBaseURL), "/"),
		"providerPreset":  firstNonEmpty(strings.TrimSpace(profile.ProviderPreset), "openai_responses"),
		"wireApi":         firstNonEmpty(strings.TrimSpace(profile.WireAPI), "responses"),
		"redactedSecrets": []string{"apiKey"},
	})
}

func (h *Handler) ListLLMProfileModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "models": []string{}, "message": "Model discovery is not available through the remote relay yet."})
}

func (h *Handler) buyerAgentSettings() BuyerAgentSettings {
	settings := defaultBuyerAgentSettings()
	if h.cache == nil {
		return settings
	}
	data, ok := h.cache.Get(buyerAgentSettingsKey)
	if !ok {
		return settings
	}
	_ = json.Unmarshal(data, &settings)
	if strings.TrimSpace(settings.AgentID) == "" {
		settings.AgentID = "exora-pwa-agent"
	}
	return settings
}

func (h *Handler) llmProfileStatus() LLMProfileStatus {
	cfg, _ := h.loadConfig()
	buyer := llmProfileFromRole("buyer-llm", "Buyer API", cfg.BuyerLLM, true, false)
	seller := llmProfileFromRole("seller-llm", "Seller API", cfg.SellerLLM, false, true)
	return LLMProfileStatus{
		Profiles:        []RemoteLLMProfile{buyer, seller},
		ActiveProfileID: "buyer-llm",
		BuyerProfileID:  "buyer-llm",
		SellerProfileID: "seller-llm",
	}
}

func (h *Handler) loadConfig() (*config.Config, error) {
	path := h.runtimeConfigPath()
	cfg, err := config.Load(path)
	return cfg, err
}

func (h *Handler) runtimeConfigPath() string {
	if strings.TrimSpace(h.configPath) != "" {
		return strings.TrimSpace(h.configPath)
	}
	return "config.yaml"
}

func (h *Handler) loadConfigMap() (map[string]any, error) {
	path := h.runtimeConfigPath()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	var raw map[string]any
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	if raw == nil {
		raw = map[string]any{}
	}
	return raw, nil
}

func (h *Handler) saveConfigMap(raw map[string]any) error {
	path := h.runtimeConfigPath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil && filepath.Dir(path) != "." {
		return err
	}
	data, err := yaml.Marshal(raw)
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0600)
}

func sellerSettingsFromConfig(cfg *config.Config) SellerAgentSettings {
	if cfg == nil {
		cfg = &config.Config{}
	}
	seller := cfg.SellerAgent
	docker := cfg.Provider.Docker
	role := cfg.SellerLLM
	return SellerAgentSettings{
		Enabled:               seller.Enabled,
		AutoQuote:             seller.AutoQuote,
		AutoAcceptLowRisk:     seller.AutoAcceptLowRisk || seller.AutoCompleteTextTasks,
		AutoCompleteTextTasks: seller.AutoCompleteTextTasks,
		ProviderID:            firstNonEmpty(strings.TrimSpace(seller.ProviderPubkey), "local-dev-miner"),
		QuotePrice:            seller.DefaultQuotePrice,
		Currency:              firstNonEmpty(strings.TrimSpace(seller.DefaultQuoteCurrency), "USDC"),
		EstimatedSeconds:      seller.DefaultEstimatedSec,
		DockerEnabled:         docker.Enabled,
		DockerDefaultImage:    docker.DefaultImage,
		DockerAllowedImages:   docker.AllowedImages,
		DockerNetworkMode:     docker.NetworkMode,
		DockerAllowedNetworks: docker.AllowedNetworkModes,
		DockerAllowGPU:        docker.AllowGPU,
		DockerMaxCPUs:         docker.MaxCPUs,
		DockerMaxMemoryMB:     docker.MaxMemoryMB,
		DockerPullPolicy:      docker.PullPolicy,
		HasAPIKey:             strings.TrimSpace(role.APIKey) != "" || !llmProviderRequiresAPIKey(role.ProviderPreset, role.BaseURL),
		KeyFormat:             keyFormat(role.APIKey, role.ProviderPreset, role.BaseURL),
	}
}

func llmProfileFromRole(id, name string, role config.RoleLLMConfig, buyer, seller bool) RemoteLLMProfile {
	return RemoteLLMProfile{
		ID:                      id,
		Name:                    name,
		ProviderPreset:          firstNonEmpty(strings.TrimSpace(role.ProviderPreset), "openai_responses"),
		LLMBaseURL:              strings.TrimRight(firstNonEmpty(strings.TrimSpace(role.BaseURL), "https://api.openai.com/v1"), "/"),
		WireAPI:                 firstNonEmpty(strings.TrimSpace(role.WireAPI), "responses"),
		Capabilities:            role.Capabilities,
		ResearchModel:           firstNonEmpty(strings.TrimSpace(role.ResearchModel), strings.TrimSpace(role.Model), "gpt-5.5"),
		ResearchReasoningEffort: firstNonEmpty(strings.TrimSpace(role.ResearchReasoningEffort), "high"),
		UtilityModel:            firstNonEmpty(strings.TrimSpace(role.UtilityModel), strings.TrimSpace(role.ResearchModel), strings.TrimSpace(role.Model), "gpt-5.5"),
		UtilityReasoningEffort:  firstNonEmpty(strings.TrimSpace(role.UtilityReasoningEffort), "low"),
		DisableResponseStorage:  role.DisableResponseStorage,
		HasAPIKey:               strings.TrimSpace(role.APIKey) != "" || !llmProviderRequiresAPIKey(role.ProviderPreset, role.BaseURL),
		KeyFormat:               keyFormat(role.APIKey, role.ProviderPreset, role.BaseURL),
		UseForBuyer:             buyer,
		UseForSeller:            seller,
	}
}

func writeLLMRole(raw map[string]any, key string, profile RemoteLLMProfile, apiKey string, hasAPIKeyInput bool, clearAPIKey bool) {
	role := mapAt(raw, key)
	role["base_url"] = strings.TrimRight(firstNonEmpty(strings.TrimSpace(profile.LLMBaseURL), "https://api.openai.com/v1"), "/")
	role["provider_preset"] = firstNonEmpty(strings.TrimSpace(profile.ProviderPreset), "openai_responses")
	role["wire_api"] = firstNonEmpty(strings.TrimSpace(profile.WireAPI), "responses")
	role["model"] = firstNonEmpty(strings.TrimSpace(profile.ResearchModel), "gpt-5.5")
	role["research_model"] = firstNonEmpty(strings.TrimSpace(profile.ResearchModel), "gpt-5.5")
	role["research_reasoning_effort"] = firstNonEmpty(strings.TrimSpace(profile.ResearchReasoningEffort), "high")
	role["utility_model"] = firstNonEmpty(strings.TrimSpace(profile.UtilityModel), strings.TrimSpace(profile.ResearchModel), "gpt-5.5")
	role["utility_reasoning_effort"] = firstNonEmpty(strings.TrimSpace(profile.UtilityReasoningEffort), "low")
	role["disable_response_storage"] = profile.DisableResponseStorage
	if clearAPIKey {
		role["api_key"] = ""
	} else if hasAPIKeyInput {
		role["api_key"] = strings.TrimSpace(apiKey)
	}
	raw[key] = role
}

func mapAt(parent map[string]any, key string) map[string]any {
	if parent == nil {
		return map[string]any{}
	}
	if existing, ok := parent[key].(map[string]any); ok {
		return existing
	}
	out := map[string]any{}
	if existing, ok := parent[key].(map[any]any); ok {
		for k, v := range existing {
			out[strings.TrimSpace(toString(k))] = v
		}
	}
	return out
}

func compactSettingsStringList(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
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

func defaultSettingsStringList(values []string, fallback []string) []string {
	if len(compactSettingsStringList(values)) == 0 {
		return fallback
	}
	return values
}

func stringField(raw map[string]any, key string) (string, bool) {
	value, ok := raw[key]
	if !ok {
		return "", false
	}
	return strings.TrimSpace(toString(value)), true
}

func boolField(raw map[string]any, key string) bool {
	value, ok := raw[key]
	if !ok {
		return false
	}
	v, ok := value.(bool)
	return ok && v
}

func toString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	default:
		data, _ := json.Marshal(v)
		return strings.Trim(string(data), `"`)
	}
}

func llmProviderRequiresAPIKey(preset string, baseURL string) bool {
	preset = strings.ToLower(strings.TrimSpace(preset))
	baseURL = strings.ToLower(strings.TrimSpace(baseURL))
	switch preset {
	case "ollama", "lm_studio", "vllm", "localai", "llama_cpp", "textgen", "koboldcpp", "custom_openai_compatible":
		return false
	}
	return !(strings.Contains(baseURL, "localhost") || strings.Contains(baseURL, "127.0.0.1"))
}

func keyFormat(apiKey string, preset string, baseURL string) string {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		if llmProviderRequiresAPIKey(preset, baseURL) {
			return "missing"
		}
		return "not_required"
	}
	if len(apiKey) < 8 {
		return "short"
	}
	return "saved"
}
