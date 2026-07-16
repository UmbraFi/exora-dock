package config

import (
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Config contains only settings used by the formal V3 Dock runtime.
// YAML deliberately ignores retired keys so an existing installation can start
// once and be rewritten by Desktop without re-enabling removed functionality.
type Config struct {
	ListenAddr         string   `yaml:"listen_addr"`
	CacheMaxMB         int      `yaml:"cache_max_mb"`
	DataDir            string   `yaml:"data_dir"`
	Mode               string   `yaml:"mode"`
	CloudURL           string   `yaml:"cloud_url"`
	CloudTokenPath     string   `yaml:"cloud_token_path"`
	DockID             string   `yaml:"dock_id"`
	AuthTokenPath      string   `yaml:"auth_token_path"`
	CORSAllowedOrigins []string `yaml:"cors_allowed_origins"`
}

func Load(path string) (*Config, error) {
	cfg := &Config{ListenAddr: ":8080", CacheMaxMB: 256, DataDir: "./data", Mode: "hybrid"}
	data, err := os.ReadFile(path)
	if err == nil {
		if decodeErr := yaml.Unmarshal(data, cfg); decodeErr != nil {
			return nil, decodeErr
		}
	}
	applyEnv(cfg)
	applyDefaults(cfg)
	return cfg, err
}
func applyEnv(cfg *Config) {
	if value := os.Getenv("EXORA_LISTEN_ADDR"); value != "" {
		cfg.ListenAddr = value
	}
	if value := os.Getenv("EXORA_DATA_DIR"); value != "" {
		cfg.DataDir = value
	}
	if value := os.Getenv("EXORA_MODE"); value != "" {
		cfg.Mode = value
	}
	if value := os.Getenv("EXORA_CLOUD_URL"); value != "" {
		cfg.CloudURL = value
	}
	if value := os.Getenv("EXORA_CLOUD_TOKEN_PATH"); value != "" {
		cfg.CloudTokenPath = value
	}
	if value := os.Getenv("EXORA_DOCK_ID"); value != "" {
		cfg.DockID = value
	}
	if value := os.Getenv("EXORA_AUTH_TOKEN_PATH"); value != "" {
		cfg.AuthTokenPath = value
	}
	if value := os.Getenv("EXORA_CORS_ALLOWED_ORIGINS"); value != "" {
		cfg.CORSAllowedOrigins = splitCSV(value)
	}
}
func applyDefaults(cfg *Config) {
	if strings.TrimSpace(cfg.ListenAddr) == "" {
		cfg.ListenAddr = ":8080"
	}
	if cfg.CacheMaxMB <= 0 {
		cfg.CacheMaxMB = 256
	}
	if strings.TrimSpace(cfg.DataDir) == "" {
		cfg.DataDir = "./data"
	}
	if strings.TrimSpace(cfg.Mode) == "" {
		cfg.Mode = "hybrid"
	}
	if strings.TrimSpace(cfg.AuthTokenPath) == "" {
		cfg.AuthTokenPath = filepath.Join(cfg.DataDir, "auth.json")
	}
	if strings.TrimSpace(cfg.CloudTokenPath) == "" {
		cfg.CloudTokenPath = filepath.Join(cfg.DataDir, "cloud-token.json")
	}
}
func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := []string{}
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
