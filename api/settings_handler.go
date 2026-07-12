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
	QuotePublishMode      string   `json:"quotePublishMode"`
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
	mode := strings.TrimSpace(req.QuotePublishMode)
	if mode == "" {
		if req.AutoQuote {
			mode = "auto"
		} else {
			mode = "manual_review"
		}
	}
	if mode != "auto" && mode != "manual_review" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "quotePublishMode must be auto or manual_review"})
		return
	}
	seller["quote_publish_mode"] = mode
	seller["auto_quote"] = mode == "auto"
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
	publishMode := quotePublishMode(seller.QuotePublishMode, seller.AutoQuote)
	return SellerAgentSettings{
		Enabled:               seller.Enabled,
		AutoQuote:             publishMode == "auto",
		QuotePublishMode:      publishMode,
		AutoAcceptLowRisk:     seller.AutoAcceptLowRisk || seller.AutoCompleteTextTasks,
		AutoCompleteTextTasks: seller.AutoCompleteTextTasks,
		ProviderID:            firstNonEmpty(strings.TrimSpace(seller.ProviderPubkey), "local-dock"),
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
	}
}

func quotePublishMode(mode string, auto bool) string {
	mode = strings.TrimSpace(mode)
	if mode == "auto" || mode == "manual_review" {
		return mode
	}
	if auto {
		return "auto"
	}
	return "manual_review"
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
