package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	RPC                  string            `yaml:"rpc_url"`
	ListenAddr           string            `yaml:"listen_addr"`
	KeyPath              string            `yaml:"key_path"`
	CacheMaxMB           int               `yaml:"cache_max_mb"`
	DataDir              string            `yaml:"data_dir"`
	FetchInterv          int               `yaml:"fetch_interval_sec"`
	ProgramID            string            `yaml:"program_id"`
	EscrowProgramID      string            `yaml:"escrow_program_id"`
	SolanaNetwork        string            `yaml:"solana_network"`
	USDCMint             string            `yaml:"usdc_mint"`
	USDCDecimals         uint8             `yaml:"usdc_decimals"`
	IPFSApiURL           string            `yaml:"ipfs_api_url"`
	Mode                 string            `yaml:"mode"`
	LegacyMarketEnabled  bool              `yaml:"legacy_market_enabled"`
	CloudURL             string            `yaml:"cloud_url"`
	CloudTokenPath       string            `yaml:"cloud_token_path"`
	CloudPollIntervalSec int               `yaml:"cloud_poll_interval_sec"`
	DockID               string            `yaml:"dock_id"`
	WalletPath           string            `yaml:"wallet_path"`
	AuthTokenPath        string            `yaml:"auth_token_path"`
	PaymentPINPath       string            `yaml:"payment_pin_path"`
	RunCapabilityPath    string            `yaml:"run_capability_path"`
	CORSAllowedOrigins   []string          `yaml:"cors_allowed_origins"`
	Provider             ProviderConfig    `yaml:"provider"`
	SellerAgent          SellerAgentConfig `yaml:"seller_agent"`
	LocalAgents          LocalAgentsConfig `yaml:"local_agents"`
}

type LocalAgentsConfig struct {
	Codex CodexAgentConfig `yaml:"codex"`
}

type CodexAgentConfig struct {
	Enabled           bool     `yaml:"enabled"`
	Command           string   `yaml:"command"`
	Model             string   `yaml:"model"`
	Roles             []string `yaml:"roles"`
	Automation        bool     `yaml:"automation"`
	AutomationMode    string   `yaml:"automation_mode"`
	Workspace         string   `yaml:"workspace"`
	WorkspaceRoots    []string `yaml:"workspace_roots"`
	PermissionProfile string   `yaml:"permission_profile"`
	MaxConcurrency    int      `yaml:"max_concurrency"`
	RequestTimeoutSec int      `yaml:"request_timeout_sec"`
	ProbeTimeoutSec   int      `yaml:"probe_timeout_sec"`
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
		ListenAddr:  ":8080",
		CacheMaxMB:  256,
		DataDir:     "./data",
		FetchInterv: 10,
		IPFSApiURL:  "http://127.0.0.1:5001",
		Mode:        "hybrid",
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
		LocalAgents: LocalAgentsConfig{Codex: CodexAgentConfig{
			Enabled: true, Command: "codex", Roles: []string{"buyer", "seller", "verifier"},
			Workspace: "", PermissionProfile: "workspace-write", MaxConcurrency: 1,
			RequestTimeoutSec: 30, ProbeTimeoutSec: 8,
		}},
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
	if v := os.Getenv("EXORA_CODEX_COMMAND"); v != "" {
		cfg.LocalAgents.Codex.Command = v
	}
	if v := os.Getenv("EXORA_CODEX_ENABLED"); v != "" {
		cfg.LocalAgents.Codex.Enabled = parseBool(v)
	}
	if v := os.Getenv("EXORA_CODEX_AUTOMATION"); v != "" {
		cfg.LocalAgents.Codex.Automation = parseBool(v)
		cfg.LocalAgents.Codex.AutomationMode = ""
	}
	if v := os.Getenv("EXORA_CODEX_AUTOMATION_MODE"); v != "" {
		cfg.LocalAgents.Codex.AutomationMode = v
	}
	if v := os.Getenv("EXORA_CODEX_ROLES"); v != "" {
		cfg.LocalAgents.Codex.Roles = splitCSV(v)
	}
	if v := os.Getenv("EXORA_CODEX_WORKSPACE"); v != "" {
		cfg.LocalAgents.Codex.Workspace = v
		cfg.LocalAgents.Codex.WorkspaceRoots = nil
	}
	if v := os.Getenv("EXORA_CODEX_WORKSPACE_ROOTS"); v != "" {
		cfg.LocalAgents.Codex.WorkspaceRoots = splitCSV(v)
	}
	if v := os.Getenv("EXORA_CODEX_PERMISSION_PROFILE"); v != "" {
		cfg.LocalAgents.Codex.PermissionProfile = v
	}
	if v := os.Getenv("EXORA_CODEX_MAX_CONCURRENCY"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			cfg.LocalAgents.Codex.MaxConcurrency = parsed
		}
	}
	if v := os.Getenv("EXORA_MODE"); v != "" {
		cfg.Mode = v
	}
	if v := os.Getenv("EXORA_LEGACY_MARKET_ENABLED"); v != "" {
		cfg.LegacyMarketEnabled = parseBool(v)
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
	if strings.TrimSpace(cfg.RunCapabilityPath) == "" {
		cfg.RunCapabilityPath = filepath.Join(cfg.DataDir, "run-capabilities.json")
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
	cfg.LocalAgents.Codex.Command = strings.TrimSpace(cfg.LocalAgents.Codex.Command)
	if cfg.LocalAgents.Codex.Command == "" {
		cfg.LocalAgents.Codex.Command = "codex"
	}
	cfg.LocalAgents.Codex.Roles = normalizeRoles(cfg.LocalAgents.Codex.Roles)
	if len(cfg.LocalAgents.Codex.Roles) == 0 {
		cfg.LocalAgents.Codex.Roles = []string{"buyer", "seller", "verifier"}
	}
	workspaceCandidates := make([]string, 0, len(cfg.LocalAgents.Codex.WorkspaceRoots)+1)
	if legacy := strings.TrimSpace(cfg.LocalAgents.Codex.Workspace); legacy != "" {
		workspaceCandidates = append(workspaceCandidates, legacy)
	}
	workspaceCandidates = append(workspaceCandidates, cfg.LocalAgents.Codex.WorkspaceRoots...)
	if len(workspaceCandidates) == 0 {
		workspaceCandidates = append(workspaceCandidates, filepath.Join(cfg.DataDir, "automation"))
	}
	cfg.LocalAgents.Codex.WorkspaceRoots = normalizeWorkspaceRoots(workspaceCandidates)
	if len(cfg.LocalAgents.Codex.WorkspaceRoots) == 0 {
		fallback, _ := filepath.Abs(filepath.Clean(filepath.Join(cfg.DataDir, "automation")))
		cfg.LocalAgents.Codex.WorkspaceRoots = []string{fallback}
	}
	cfg.LocalAgents.Codex.Workspace = cfg.LocalAgents.Codex.WorkspaceRoots[0]
	cfg.LocalAgents.Codex.AutomationMode = strings.ToLower(strings.TrimSpace(cfg.LocalAgents.Codex.AutomationMode))
	switch cfg.LocalAgents.Codex.AutomationMode {
	case "guarded", "autonomous":
		cfg.LocalAgents.Codex.Automation = true
	case "manual":
		cfg.LocalAgents.Codex.Automation = false
	default:
		if cfg.LocalAgents.Codex.Automation {
			cfg.LocalAgents.Codex.AutomationMode = "guarded"
		} else {
			cfg.LocalAgents.Codex.AutomationMode = "manual"
		}
	}
	if strings.TrimSpace(cfg.LocalAgents.Codex.PermissionProfile) == "" {
		cfg.LocalAgents.Codex.PermissionProfile = "workspace-write"
	}
	if cfg.LocalAgents.Codex.MaxConcurrency <= 0 {
		cfg.LocalAgents.Codex.MaxConcurrency = 1
	}
	if cfg.LocalAgents.Codex.RequestTimeoutSec <= 0 {
		cfg.LocalAgents.Codex.RequestTimeoutSec = 30
	}
	if cfg.LocalAgents.Codex.ProbeTimeoutSec <= 0 {
		cfg.LocalAgents.Codex.ProbeTimeoutSec = 8
	}
}

func normalizeWorkspaceRoots(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		absolute, err := filepath.Abs(filepath.Clean(value))
		if err != nil || strings.TrimSpace(absolute) == "" {
			continue
		}
		key := absolute
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, absolute)
	}
	return out
}

func normalizeRoles(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if (value != "buyer" && value != "seller" && value != "verifier") || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
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
