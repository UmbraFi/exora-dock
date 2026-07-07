package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadLLMDefaultsAndLegacyFallback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(`llm_model: "legacy-model"`), 0600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.LLMBaseURL != "https://api.openai.com/v1" {
		t.Fatalf("LLMBaseURL = %q", cfg.LLMBaseURL)
	}
	if cfg.LLMWireAPI != "responses" {
		t.Fatalf("LLMWireAPI = %q", cfg.LLMWireAPI)
	}
	if cfg.LLMProviderPreset != "openai_responses" {
		t.Fatalf("LLMProviderPreset = %q", cfg.LLMProviderPreset)
	}
	if !cfg.LLMCapabilities.SupportsResponses || !cfg.LLMCapabilities.SupportsReasoningEffort {
		t.Fatalf("LLMCapabilities = %#v", cfg.LLMCapabilities)
	}
	if cfg.LLMResearchModel != "legacy-model" || cfg.LLMUtilityModel != "legacy-model" {
		t.Fatalf("models = research:%q utility:%q", cfg.LLMResearchModel, cfg.LLMUtilityModel)
	}
	if cfg.LLMResearchReasoningEffort != "high" || cfg.LLMUtilityReasoningEffort != "low" {
		t.Fatalf("reasoning = research:%q utility:%q", cfg.LLMResearchReasoningEffort, cfg.LLMUtilityReasoningEffort)
	}
	if !cfg.LLMDisableResponseStorage {
		t.Fatalf("LLMDisableResponseStorage = false, want true")
	}
	if cfg.PaymentPINPath == "" || filepath.Base(cfg.PaymentPINPath) != "payment-pin.json" {
		t.Fatalf("PaymentPINPath = %q", cfg.PaymentPINPath)
	}
}

func TestLoadLLMPresetCapabilities(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(`
llm_provider_preset: "openrouter"
llm_wire_api: "chat_completions"
llm_base_url: "https://openrouter.ai/api/v1"
`), 0600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.LLMProviderPreset != "openrouter" {
		t.Fatalf("LLMProviderPreset = %q", cfg.LLMProviderPreset)
	}
	if cfg.LLMCapabilities.SupportsResponses || !cfg.LLMCapabilities.SupportsChatCompletions || !cfg.LLMCapabilities.SupportsTools {
		t.Fatalf("LLMCapabilities = %#v", cfg.LLMCapabilities)
	}
}

func TestLoadLLMEnvOverrides(t *testing.T) {
	t.Setenv("EXORA_LLM_WIRE_API", "chat")
	t.Setenv("EXORA_LLM_RESEARCH_MODEL", "research-env")
	t.Setenv("EXORA_LLM_RESEARCH_REASONING_EFFORT", "xhigh")
	t.Setenv("EXORA_LLM_UTILITY_MODEL", "utility-env")
	t.Setenv("EXORA_LLM_UTILITY_REASONING_EFFORT", "low")
	t.Setenv("EXORA_LLM_DISABLE_RESPONSE_STORAGE", "0")

	cfg, _ := Load(filepath.Join(t.TempDir(), "missing.yaml"))

	if cfg.LLMWireAPI != "chat_completions" {
		t.Fatalf("LLMWireAPI = %q", cfg.LLMWireAPI)
	}
	if cfg.LLMResearchModel != "research-env" || cfg.LLMUtilityModel != "utility-env" {
		t.Fatalf("models = research:%q utility:%q", cfg.LLMResearchModel, cfg.LLMUtilityModel)
	}
	if cfg.LLMResearchReasoningEffort != "xhigh" || cfg.LLMUtilityReasoningEffort != "low" {
		t.Fatalf("reasoning = research:%q utility:%q", cfg.LLMResearchReasoningEffort, cfg.LLMUtilityReasoningEffort)
	}
	if cfg.LLMDisableResponseStorage {
		t.Fatalf("LLMDisableResponseStorage = true, want false")
	}
}

func TestLoadRoleLLMConfigOverridesTopLevel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(`
llm_api_key: "top-key"
llm_research_model: "top-model"
buyer_llm:
  base_url: "https://buyer.example/v1"
  api_key: "buyer-key"
  provider_preset: "openrouter"
  wire_api: "chat"
  research_model: "buyer-research"
seller_llm:
  base_url: "http://127.0.0.1:1234/v1"
  provider_preset: "lm_studio"
  research_model: "seller-research"
  utility_model: "seller-utility"
`), 0600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.BuyerLLM.APIKey != "buyer-key" || cfg.BuyerLLM.ResearchModel != "buyer-research" {
		t.Fatalf("buyer llm = %#v", cfg.BuyerLLM)
	}
	if cfg.BuyerLLM.WireAPI != "chat_completions" || cfg.BuyerLLM.Capabilities.SupportsResponses {
		t.Fatalf("buyer wire/caps = %q %#v", cfg.BuyerLLM.WireAPI, cfg.BuyerLLM.Capabilities)
	}
	if cfg.SellerLLM.APIKey != "" || cfg.SellerLLM.ResearchModel != "seller-research" || cfg.SellerLLM.UtilityModel != "seller-utility" {
		t.Fatalf("seller llm = %#v", cfg.SellerLLM)
	}
	if cfg.SellerLLM.Capabilities.SupportsResponses || !cfg.SellerLLM.Capabilities.SupportsChatCompletions {
		t.Fatalf("seller caps = %#v", cfg.SellerLLM.Capabilities)
	}
}

func TestLoadDockerProviderDefaultsAndEnv(t *testing.T) {
	t.Setenv("EXORA_PROVIDER_DOCKER_ENABLED", "1")
	t.Setenv("EXORA_PROVIDER_DOCKER_DEFAULT_IMAGE", "python:3.12-alpine")
	t.Setenv("EXORA_PROVIDER_DOCKER_ALLOWED_IMAGES", "python:3.12-alpine,node:22-alpine")
	t.Setenv("EXORA_PROVIDER_DOCKER_ALLOWED_NETWORK_MODES", "none,bridge")
	t.Setenv("EXORA_PROVIDER_DOCKER_MAX_MEMORY_MB", "2048")

	cfg, _ := Load(filepath.Join(t.TempDir(), "missing.yaml"))

	if !cfg.Provider.Docker.Enabled || cfg.Provider.Docker.DefaultImage != "python:3.12-alpine" {
		t.Fatalf("docker config = %#v", cfg.Provider.Docker)
	}
	if len(cfg.Provider.Docker.AllowedImages) != 2 || cfg.Provider.Docker.AllowedNetworkModes[0] != "none" {
		t.Fatalf("docker lists = %#v", cfg.Provider.Docker)
	}
	if cfg.Provider.Docker.MaxMemoryMB != 2048 || cfg.Provider.Docker.PullPolicy != "missing" {
		t.Fatalf("docker limits = %#v", cfg.Provider.Docker)
	}
}

func TestLoadSellerAutoAcceptLowRiskAndLegacyAlias(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(`
seller_agent:
  auto_complete_text_tasks: true
`), 0600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.SellerAgent.AutoAcceptLowRisk {
		t.Fatalf("legacy auto_complete_text_tasks should enable AutoAcceptLowRisk: %#v", cfg.SellerAgent)
	}

	path = filepath.Join(t.TempDir(), "config-new.yaml")
	if err := os.WriteFile(path, []byte(`
seller_agent:
  auto_accept_low_risk: true
`), 0600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	cfg, err = Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.SellerAgent.AutoAcceptLowRisk {
		t.Fatalf("auto_accept_low_risk not loaded: %#v", cfg.SellerAgent)
	}
}
