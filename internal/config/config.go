package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	RPC                        string            `yaml:"rpc_url"`
	ListenAddr                 string            `yaml:"listen_addr"`
	KeyPath                    string            `yaml:"key_path"`
	CacheMaxMB                 int               `yaml:"cache_max_mb"`
	DataDir                    string            `yaml:"data_dir"`
	FetchInterv                int               `yaml:"fetch_interval_sec"`
	ProgramID                  string            `yaml:"program_id"`
	EscrowProgramID            string            `yaml:"escrow_program_id"`
	SolanaNetwork              string            `yaml:"solana_network"`
	USDCMint                   string            `yaml:"usdc_mint"`
	USDCDecimals               uint8             `yaml:"usdc_decimals"`
	IPFSApiURL                 string            `yaml:"ipfs_api_url"`
	LLMBaseURL                 string            `yaml:"llm_base_url"`
	LLMAPIKey                  string            `yaml:"llm_api_key"`
	LLMProviderPreset          string            `yaml:"llm_provider_preset"`
	LLMModel                   string            `yaml:"llm_model"`
	LLMWireAPI                 string            `yaml:"llm_wire_api"`
	LLMCapabilities            LLMCapabilities   `yaml:"llm_capabilities"`
	LLMExtraHeaders            map[string]string `yaml:"llm_extra_headers"`
	LLMResearchModel           string            `yaml:"llm_research_model"`
	LLMResearchReasoningEffort string            `yaml:"llm_research_reasoning_effort"`
	LLMUtilityModel            string            `yaml:"llm_utility_model"`
	LLMUtilityReasoningEffort  string            `yaml:"llm_utility_reasoning_effort"`
	LLMDisableResponseStorage  bool              `yaml:"llm_disable_response_storage"`
	BuyerLLM                   RoleLLMConfig     `yaml:"buyer_llm"`
	SellerLLM                  RoleLLMConfig     `yaml:"seller_llm"`
	Mode                       string            `yaml:"mode"`
	CloudURL                   string            `yaml:"cloud_url"`
	CloudTokenPath             string            `yaml:"cloud_token_path"`
	CloudPollIntervalSec       int               `yaml:"cloud_poll_interval_sec"`
	DockID                     string            `yaml:"dock_id"`
	WalletPath                 string            `yaml:"wallet_path"`
	AuthTokenPath              string            `yaml:"auth_token_path"`
	PaymentPINPath             string            `yaml:"payment_pin_path"`
	CORSAllowedOrigins         []string          `yaml:"cors_allowed_origins"`
	Provider                   ProviderConfig    `yaml:"provider"`
	SellerAgent                SellerAgentConfig `yaml:"seller_agent"`
}

type LLMCapabilities struct {
	SupportsResponses          bool `yaml:"supports_responses"`
	SupportsChatCompletions    bool `yaml:"supports_chat_completions"`
	SupportsSystemMessage      bool `yaml:"supports_system_message"`
	SupportsJSONResponseFormat bool `yaml:"supports_json_response_format"`
	SupportsStreaming          bool `yaml:"supports_streaming"`
	SupportsTools              bool `yaml:"supports_tools"`
	SupportsReasoningEffort    bool `yaml:"supports_reasoning_effort"`
}

type RoleLLMConfig struct {
	BaseURL                 string            `yaml:"base_url"`
	APIKey                  string            `yaml:"api_key"`
	ProviderPreset          string            `yaml:"provider_preset"`
	Model                   string            `yaml:"model"`
	WireAPI                 string            `yaml:"wire_api"`
	Capabilities            LLMCapabilities   `yaml:"capabilities"`
	ExtraHeaders            map[string]string `yaml:"extra_headers"`
	ResearchModel           string            `yaml:"research_model"`
	ResearchReasoningEffort string            `yaml:"research_reasoning_effort"`
	UtilityModel            string            `yaml:"utility_model"`
	UtilityReasoningEffort  string            `yaml:"utility_reasoning_effort"`
	DisableResponseStorage  bool              `yaml:"disable_response_storage"`
}

type ProviderConfig struct {
	WorkspaceDir         string       `yaml:"workspace_dir"`
	AllowCommandExecutor bool         `yaml:"allow_command_executor"`
	AllowedCommands      []string     `yaml:"allowed_commands"`
	MaxJobSeconds        int          `yaml:"max_job_seconds"`
	MaxInputMB           int          `yaml:"max_input_mb"`
	Docker               DockerConfig `yaml:"docker"`
}

type DockerConfig struct {
	Enabled             bool     `yaml:"enabled"`
	DefaultImage        string   `yaml:"default_image"`
	AllowedImages       []string `yaml:"allowed_images"`
	NetworkMode         string   `yaml:"network_mode"`
	AllowedNetworkModes []string `yaml:"allowed_network_modes"`
	AllowGPU            bool     `yaml:"allow_gpu"`
	MaxCPUs             float64  `yaml:"max_cpus"`
	MaxMemoryMB         int      `yaml:"max_memory_mb"`
	PullPolicy          string   `yaml:"pull_policy"`
}

type SellerAgentConfig struct {
	Enabled               bool    `yaml:"enabled"`
	AutoQuote             bool    `yaml:"auto_quote"`
	AutoAcceptLowRisk     bool    `yaml:"auto_accept_low_risk"`
	AutoCompleteTextTasks bool    `yaml:"auto_complete_text_tasks"`
	ProviderPubkey        string  `yaml:"provider_pubkey"`
	PollIntervalSec       int     `yaml:"poll_interval_sec"`
	DefaultQuotePrice     float64 `yaml:"default_quote_price"`
	DefaultQuoteCurrency  string  `yaml:"default_quote_currency"`
	DefaultEstimatedSec   int     `yaml:"default_estimated_seconds"`
}

func Load(path string) (*Config, error) {
	cfg := &Config{
		ListenAddr:                 ":8080",
		CacheMaxMB:                 256,
		DataDir:                    "./data",
		FetchInterv:                10,
		IPFSApiURL:                 "http://127.0.0.1:5001",
		LLMBaseURL:                 "https://api.openai.com/v1",
		LLMProviderPreset:          "openai_responses",
		LLMWireAPI:                 "responses",
		LLMResearchReasoningEffort: "high",
		LLMUtilityReasoningEffort:  "low",
		LLMDisableResponseStorage:  true,
		Mode:                       "hybrid",
		Provider: ProviderConfig{
			MaxJobSeconds: 300,
			MaxInputMB:    128,
			Docker: DockerConfig{
				NetworkMode:         "none",
				AllowedNetworkModes: []string{"none"},
				PullPolicy:          "missing",
			},
		},
		SellerAgent: SellerAgentConfig{
			AutoQuote:            true,
			PollIntervalSec:      2,
			DefaultQuoteCurrency: "USDC",
			DefaultEstimatedSec:  60,
		},
	}

	data, err := os.ReadFile(path)
	if err != nil {
		applyEnv(cfg)
		applyDerivedDefaults(cfg)
		return cfg, err
	}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}

	applyEnv(cfg)
	applyDerivedDefaults(cfg)
	return cfg, nil
}

func applyEnv(cfg *Config) {
	if v := os.Getenv("EXORA_RPC_URL"); v != "" {
		cfg.RPC = v
	}
	if v := os.Getenv("EXORA_LISTEN_ADDR"); v != "" {
		cfg.ListenAddr = v
	}
	if v := os.Getenv("EXORA_KEY_PATH"); v != "" {
		cfg.KeyPath = v
	}
	if v := os.Getenv("EXORA_DATA_DIR"); v != "" {
		cfg.DataDir = v
	}
	if v := os.Getenv("EXORA_IPFS_API_URL"); v != "" {
		cfg.IPFSApiURL = v
	}
	if v := os.Getenv("EXORA_LLM_BASE_URL"); v != "" {
		cfg.LLMBaseURL = v
	}
	if v := os.Getenv("EXORA_LLM_API_KEY"); v != "" {
		cfg.LLMAPIKey = v
	}
	if v := os.Getenv("EXORA_LLM_PROVIDER_PRESET"); v != "" {
		cfg.LLMProviderPreset = v
	}
	if v := os.Getenv("EXORA_LLM_MODEL"); v != "" {
		cfg.LLMModel = v
	}
	if v := os.Getenv("EXORA_LLM_WIRE_API"); v != "" {
		cfg.LLMWireAPI = v
	}
	if v := os.Getenv("EXORA_LLM_RESEARCH_MODEL"); v != "" {
		cfg.LLMResearchModel = v
	}
	if v := os.Getenv("EXORA_LLM_RESEARCH_REASONING_EFFORT"); v != "" {
		cfg.LLMResearchReasoningEffort = v
	}
	if v := os.Getenv("EXORA_LLM_UTILITY_MODEL"); v != "" {
		cfg.LLMUtilityModel = v
	}
	if v := os.Getenv("EXORA_LLM_UTILITY_REASONING_EFFORT"); v != "" {
		cfg.LLMUtilityReasoningEffort = v
	}
	if v := os.Getenv("EXORA_LLM_DISABLE_RESPONSE_STORAGE"); v != "" {
		cfg.LLMDisableResponseStorage = parseBool(v)
	}
	if v := os.Getenv("EXORA_MODE"); v != "" {
		cfg.Mode = v
	}
	if v := os.Getenv("EXORA_CLOUD_URL"); v != "" {
		cfg.CloudURL = v
	}
	if v := os.Getenv("EXORA_CLOUD_TOKEN_PATH"); v != "" {
		cfg.CloudTokenPath = v
	}
	if v := os.Getenv("EXORA_CLOUD_POLL_INTERVAL_SEC"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			cfg.CloudPollIntervalSec = parsed
		}
	}
	if v := os.Getenv("EXORA_DOCK_ID"); v != "" {
		cfg.DockID = v
	}
	if v := os.Getenv("EXORA_ESCROW_PROGRAM_ID"); v != "" {
		cfg.EscrowProgramID = v
	}
	if v := os.Getenv("EXORA_SOLANA_NETWORK"); v != "" {
		cfg.SolanaNetwork = v
	}
	if v := os.Getenv("EXORA_USDC_MINT"); v != "" {
		cfg.USDCMint = v
	}
	if v := os.Getenv("EXORA_USDC_DECIMALS"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed >= 0 && parsed <= 255 {
			cfg.USDCDecimals = uint8(parsed)
		}
	}
	if v := os.Getenv("EXORA_WALLET_PATH"); v != "" {
		cfg.WalletPath = v
	}
	if v := os.Getenv("EXORA_AUTH_TOKEN_PATH"); v != "" {
		cfg.AuthTokenPath = v
	}
	if v := os.Getenv("EXORA_PAYMENT_PIN_PATH"); v != "" {
		cfg.PaymentPINPath = v
	}
	if v := os.Getenv("EXORA_CORS_ALLOWED_ORIGINS"); v != "" {
		cfg.CORSAllowedOrigins = splitCSV(v)
	}
	if v := os.Getenv("EXORA_PROVIDER_WORKSPACE_DIR"); v != "" {
		cfg.Provider.WorkspaceDir = v
	}
	if v := os.Getenv("EXORA_PROVIDER_ALLOW_COMMAND_EXECUTOR"); v != "" {
		cfg.Provider.AllowCommandExecutor = parseBool(v)
	}
	if v := os.Getenv("EXORA_PROVIDER_ALLOWED_COMMANDS"); v != "" {
		cfg.Provider.AllowedCommands = splitCSV(v)
	}
	if v := os.Getenv("EXORA_PROVIDER_MAX_JOB_SECONDS"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			cfg.Provider.MaxJobSeconds = parsed
		}
	}
	if v := os.Getenv("EXORA_PROVIDER_MAX_INPUT_MB"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			cfg.Provider.MaxInputMB = parsed
		}
	}
	if v := os.Getenv("EXORA_PROVIDER_DOCKER_ENABLED"); v != "" {
		cfg.Provider.Docker.Enabled = parseBool(v)
	}
	if v := os.Getenv("EXORA_PROVIDER_DOCKER_DEFAULT_IMAGE"); v != "" {
		cfg.Provider.Docker.DefaultImage = v
	}
	if v := os.Getenv("EXORA_PROVIDER_DOCKER_ALLOWED_IMAGES"); v != "" {
		cfg.Provider.Docker.AllowedImages = splitCSV(v)
	}
	if v := os.Getenv("EXORA_PROVIDER_DOCKER_NETWORK_MODE"); v != "" {
		cfg.Provider.Docker.NetworkMode = v
	}
	if v := os.Getenv("EXORA_PROVIDER_DOCKER_ALLOWED_NETWORK_MODES"); v != "" {
		cfg.Provider.Docker.AllowedNetworkModes = splitCSV(v)
	}
	if v := os.Getenv("EXORA_PROVIDER_DOCKER_ALLOW_GPU"); v != "" {
		cfg.Provider.Docker.AllowGPU = parseBool(v)
	}
	if v := os.Getenv("EXORA_PROVIDER_DOCKER_MAX_CPUS"); v != "" {
		if parsed, err := strconv.ParseFloat(v, 64); err == nil {
			cfg.Provider.Docker.MaxCPUs = parsed
		}
	}
	if v := os.Getenv("EXORA_PROVIDER_DOCKER_MAX_MEMORY_MB"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			cfg.Provider.Docker.MaxMemoryMB = parsed
		}
	}
	if v := os.Getenv("EXORA_PROVIDER_DOCKER_PULL_POLICY"); v != "" {
		cfg.Provider.Docker.PullPolicy = v
	}
	if v := os.Getenv("EXORA_SELLER_AGENT_ENABLED"); v != "" {
		cfg.SellerAgent.Enabled = parseBool(v)
	}
	if v := os.Getenv("EXORA_SELLER_AGENT_AUTO_QUOTE"); v != "" {
		cfg.SellerAgent.AutoQuote = parseBool(v)
	}
	if v := os.Getenv("EXORA_SELLER_AGENT_AUTO_ACCEPT_LOW_RISK"); v != "" {
		cfg.SellerAgent.AutoAcceptLowRisk = parseBool(v)
	}
	if v := os.Getenv("EXORA_SELLER_AGENT_AUTO_COMPLETE_TEXT_TASKS"); v != "" {
		cfg.SellerAgent.AutoCompleteTextTasks = parseBool(v)
		if cfg.SellerAgent.AutoCompleteTextTasks {
			cfg.SellerAgent.AutoAcceptLowRisk = true
		}
	}
	if v := os.Getenv("EXORA_SELLER_AGENT_PROVIDER_PUBKEY"); v != "" {
		cfg.SellerAgent.ProviderPubkey = v
	}
	if v := os.Getenv("EXORA_SELLER_AGENT_POLL_INTERVAL_SEC"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			cfg.SellerAgent.PollIntervalSec = parsed
		}
	}
	if v := os.Getenv("EXORA_SELLER_AGENT_DEFAULT_QUOTE_PRICE"); v != "" {
		if parsed, err := strconv.ParseFloat(v, 64); err == nil {
			cfg.SellerAgent.DefaultQuotePrice = parsed
		}
	}
	if v := os.Getenv("EXORA_SELLER_AGENT_DEFAULT_QUOTE_CURRENCY"); v != "" {
		cfg.SellerAgent.DefaultQuoteCurrency = v
	}
	if v := os.Getenv("EXORA_SELLER_AGENT_DEFAULT_ESTIMATED_SECONDS"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			cfg.SellerAgent.DefaultEstimatedSec = parsed
		}
	}
}

func applyDerivedDefaults(cfg *Config) {
	cfg.LLMBaseURL = strings.TrimRight(strings.TrimSpace(cfg.LLMBaseURL), "/")
	if cfg.LLMBaseURL == "" {
		cfg.LLMBaseURL = "https://api.openai.com/v1"
	}
	cfg.LLMProviderPreset = normalizeProviderPreset(cfg.LLMProviderPreset)
	cfg.LLMWireAPI = normalizeWireAPI(cfg.LLMWireAPI)
	cfg.LLMCapabilities = normalizeLLMCapabilities(cfg.LLMProviderPreset, cfg.LLMBaseURL, cfg.LLMWireAPI, cfg.LLMCapabilities)
	legacyModel := strings.TrimSpace(cfg.LLMModel)
	if strings.TrimSpace(cfg.LLMResearchModel) == "" {
		if legacyModel != "" {
			cfg.LLMResearchModel = legacyModel
		} else {
			cfg.LLMResearchModel = "gpt-5.5"
		}
	}
	if strings.TrimSpace(cfg.LLMUtilityModel) == "" {
		if legacyModel != "" {
			cfg.LLMUtilityModel = legacyModel
		} else {
			cfg.LLMUtilityModel = "gpt-5.5"
		}
	}
	if strings.TrimSpace(cfg.LLMModel) == "" {
		cfg.LLMModel = cfg.LLMResearchModel
	}
	if strings.TrimSpace(cfg.LLMResearchReasoningEffort) == "" {
		cfg.LLMResearchReasoningEffort = "high"
	}
	if strings.TrimSpace(cfg.LLMUtilityReasoningEffort) == "" {
		cfg.LLMUtilityReasoningEffort = "low"
	}
	cfg.BuyerLLM = normalizeRoleLLMConfig(cfg.BuyerLLM, cfg)
	cfg.SellerLLM = normalizeRoleLLMConfig(cfg.SellerLLM, cfg)
	if strings.TrimSpace(cfg.Mode) == "" {
		cfg.Mode = "hybrid"
	}
	if strings.TrimSpace(cfg.SolanaNetwork) == "" {
		cfg.SolanaNetwork = "devnet"
	}
	if cfg.USDCDecimals == 0 {
		cfg.USDCDecimals = 6
	}
	if strings.TrimSpace(cfg.WalletPath) == "" {
		cfg.WalletPath = filepath.Join(cfg.DataDir, "wallet")
	}
	if strings.TrimSpace(cfg.AuthTokenPath) == "" {
		cfg.AuthTokenPath = filepath.Join(cfg.DataDir, "auth.json")
	}
	if strings.TrimSpace(cfg.PaymentPINPath) == "" {
		cfg.PaymentPINPath = filepath.Join(cfg.DataDir, "payment-pin.json")
	}
	if strings.TrimSpace(cfg.CloudTokenPath) == "" {
		cfg.CloudTokenPath = filepath.Join(cfg.DataDir, "cloud-token.json")
	}
	if cfg.CloudPollIntervalSec <= 0 {
		cfg.CloudPollIntervalSec = 3
	}
	if strings.TrimSpace(cfg.Provider.WorkspaceDir) == "" {
		cfg.Provider.WorkspaceDir = filepath.Join(cfg.DataDir, "jobs")
	}
	if cfg.Provider.MaxJobSeconds <= 0 {
		cfg.Provider.MaxJobSeconds = 300
	}
	if cfg.Provider.MaxInputMB <= 0 {
		cfg.Provider.MaxInputMB = 128
	}
	cfg.Provider.Docker.NetworkMode = strings.ToLower(strings.TrimSpace(cfg.Provider.Docker.NetworkMode))
	if cfg.Provider.Docker.NetworkMode == "" {
		cfg.Provider.Docker.NetworkMode = "none"
	}
	if len(cfg.Provider.Docker.AllowedNetworkModes) == 0 {
		cfg.Provider.Docker.AllowedNetworkModes = []string{cfg.Provider.Docker.NetworkMode}
	}
	for i, mode := range cfg.Provider.Docker.AllowedNetworkModes {
		cfg.Provider.Docker.AllowedNetworkModes[i] = strings.ToLower(strings.TrimSpace(mode))
	}
	cfg.Provider.Docker.PullPolicy = strings.ToLower(strings.TrimSpace(cfg.Provider.Docker.PullPolicy))
	if cfg.Provider.Docker.PullPolicy == "" {
		cfg.Provider.Docker.PullPolicy = "missing"
	}
	if cfg.SellerAgent.PollIntervalSec <= 0 {
		cfg.SellerAgent.PollIntervalSec = 2
	}
	if strings.TrimSpace(cfg.SellerAgent.DefaultQuoteCurrency) == "" {
		cfg.SellerAgent.DefaultQuoteCurrency = "USDC"
	}
	if cfg.SellerAgent.DefaultEstimatedSec <= 0 {
		cfg.SellerAgent.DefaultEstimatedSec = 60
	}
	if cfg.SellerAgent.AutoCompleteTextTasks {
		cfg.SellerAgent.AutoAcceptLowRisk = true
	}
}

func normalizeRoleLLMConfig(role RoleLLMConfig, cfg *Config) RoleLLMConfig {
	fallback := topLevelRoleLLMConfig(cfg)
	if !roleLLMConfigured(role) {
		return fallback
	}
	role.BaseURL = strings.TrimRight(strings.TrimSpace(role.BaseURL), "/")
	if role.BaseURL == "" {
		role.BaseURL = fallback.BaseURL
	}
	role.APIKey = strings.TrimSpace(role.APIKey)
	role.ProviderPreset = normalizeProviderPreset(firstText(role.ProviderPreset, fallback.ProviderPreset))
	role.WireAPI = normalizeWireAPI(firstText(role.WireAPI, fallback.WireAPI))
	role.Capabilities = normalizeLLMCapabilities(role.ProviderPreset, role.BaseURL, role.WireAPI, role.Capabilities)
	role.ResearchModel = strings.TrimSpace(role.ResearchModel)
	role.UtilityModel = strings.TrimSpace(role.UtilityModel)
	role.Model = strings.TrimSpace(role.Model)
	legacyModel := role.Model
	if role.ResearchModel == "" {
		role.ResearchModel = firstText(legacyModel, fallback.ResearchModel)
	}
	if role.UtilityModel == "" {
		role.UtilityModel = firstText(legacyModel, role.ResearchModel, fallback.UtilityModel)
	}
	if role.Model == "" {
		role.Model = role.ResearchModel
	}
	role.ResearchReasoningEffort = firstText(role.ResearchReasoningEffort, fallback.ResearchReasoningEffort, "high")
	role.UtilityReasoningEffort = firstText(role.UtilityReasoningEffort, fallback.UtilityReasoningEffort, "low")
	return role
}

func topLevelRoleLLMConfig(cfg *Config) RoleLLMConfig {
	return RoleLLMConfig{
		BaseURL:                 cfg.LLMBaseURL,
		APIKey:                  cfg.LLMAPIKey,
		ProviderPreset:          cfg.LLMProviderPreset,
		Model:                   cfg.LLMModel,
		WireAPI:                 cfg.LLMWireAPI,
		Capabilities:            cfg.LLMCapabilities,
		ExtraHeaders:            cfg.LLMExtraHeaders,
		ResearchModel:           cfg.LLMResearchModel,
		ResearchReasoningEffort: cfg.LLMResearchReasoningEffort,
		UtilityModel:            cfg.LLMUtilityModel,
		UtilityReasoningEffort:  cfg.LLMUtilityReasoningEffort,
		DisableResponseStorage:  cfg.LLMDisableResponseStorage,
	}
}

func roleLLMConfigured(role RoleLLMConfig) bool {
	return strings.TrimSpace(role.BaseURL) != "" ||
		strings.TrimSpace(role.APIKey) != "" ||
		strings.TrimSpace(role.ProviderPreset) != "" ||
		strings.TrimSpace(role.Model) != "" ||
		strings.TrimSpace(role.WireAPI) != "" ||
		role.Capabilities != (LLMCapabilities{}) ||
		len(role.ExtraHeaders) > 0 ||
		strings.TrimSpace(role.ResearchModel) != "" ||
		strings.TrimSpace(role.ResearchReasoningEffort) != "" ||
		strings.TrimSpace(role.UtilityModel) != "" ||
		strings.TrimSpace(role.UtilityReasoningEffort) != "" ||
		role.DisableResponseStorage
}

func firstText(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
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
	case "":
		return "openai_responses"
	default:
		return normalized
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
		if wire == "responses" || strings.HasPrefix(baseURL, "https://api.openai.com") {
			return LLMCapabilities{SupportsResponses: true, SupportsChatCompletions: true, SupportsSystemMessage: true, SupportsJSONResponseFormat: true, SupportsStreaming: true, SupportsTools: true, SupportsReasoningEffort: true}
		}
		return LLMCapabilities{SupportsChatCompletions: true, SupportsSystemMessage: true, SupportsJSONResponseFormat: true, SupportsStreaming: true}
	}
}

func normalizeWireAPI(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	if normalized == "chat" {
		normalized = "chat_completions"
	}
	switch normalized {
	case "responses", "chat_completions":
		return normalized
	default:
		return "responses"
	}
}

func parseBool(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
