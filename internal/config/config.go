package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	RPC         string `yaml:"rpc_url"`
	ListenAddr  string `yaml:"listen_addr"`
	KeyPath     string `yaml:"key_path"`
	CacheMaxMB  int    `yaml:"cache_max_mb"`
	DataDir     string `yaml:"data_dir"`
	FetchInterv int    `yaml:"fetch_interval_sec"`
	ProgramID   string `yaml:"program_id"`
	IPFSApiURL  string `yaml:"ipfs_api_url"`
	LLMBaseURL  string `yaml:"llm_base_url"`
	LLMAPIKey   string `yaml:"llm_api_key"`
	LLMModel    string `yaml:"llm_model"`
}

func Load(path string) (*Config, error) {
	cfg := &Config{
		ListenAddr:  ":8080",
		CacheMaxMB:  256,
		DataDir:     "./data",
		FetchInterv: 10,
		IPFSApiURL:  "http://127.0.0.1:5001",
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}

	// ENV overrides
	if v := os.Getenv("UMBRA_RPC_URL"); v != "" {
		cfg.RPC = v
	}
	if v := os.Getenv("UMBRA_LISTEN_ADDR"); v != "" {
		cfg.ListenAddr = v
	}
	if v := os.Getenv("UMBRA_KEY_PATH"); v != "" {
		cfg.KeyPath = v
	}
	if v := os.Getenv("UMBRA_IPFS_API_URL"); v != "" {
		cfg.IPFSApiURL = v
	}
	if v := os.Getenv("UMBRA_LLM_BASE_URL"); v != "" {
		cfg.LLMBaseURL = v
	}
	if v := os.Getenv("UMBRA_LLM_API_KEY"); v != "" {
		cfg.LLMAPIKey = v
	}
	if v := os.Getenv("UMBRA_LLM_MODEL"); v != "" {
		cfg.LLMModel = v
	}

	return cfg, nil
}
