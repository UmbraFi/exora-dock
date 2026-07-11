package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadLocalCodexAndSecurityDefaults(t *testing.T) {
	cfg, _ := Load(filepath.Join(t.TempDir(), "missing.yaml"))
	if cfg.LocalAgents.Codex.Command != "codex" || !cfg.LocalAgents.Codex.Enabled {
		t.Fatalf("codex defaults = %#v", cfg.LocalAgents.Codex)
	}
	if cfg.LocalAgents.Codex.Automation {
		t.Fatal("automation must require an explicit opt-in")
	}
	if cfg.LegacyMarketEnabled {
		t.Fatal("legacy miner/product market must be disabled by default")
	}
	if cfg.LocalAgents.Codex.AutomationMode != "manual" || len(cfg.LocalAgents.Codex.WorkspaceRoots) != 1 || cfg.LocalAgents.Codex.Workspace != cfg.LocalAgents.Codex.WorkspaceRoots[0] {
		t.Fatalf("codex compatibility projection = %#v", cfg.LocalAgents.Codex)
	}
	if cfg.LocalAgents.Codex.PermissionProfile != "workspace-write" || cfg.LocalAgents.Codex.MaxConcurrency != 1 {
		t.Fatalf("codex policy defaults = %#v", cfg.LocalAgents.Codex)
	}
	if len(cfg.LocalAgents.Codex.Roles) != 3 || cfg.RunCapabilityPath == "" {
		t.Fatalf("roles/path = %#v %q", cfg.LocalAgents.Codex.Roles, cfg.RunCapabilityPath)
	}
	if cfg.PaymentPINPath == "" || filepath.Base(cfg.PaymentPINPath) != "payment-pin.json" {
		t.Fatalf("PaymentPINPath = %q", cfg.PaymentPINPath)
	}
}

func TestLoadCodexConfigAndEnvOverrides(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(`
data_dir: ./dock-data
local_agents:
  codex:
    enabled: false
    automation: true
    roles: [seller, invalid, seller]
    workspace: ./workspace
    permission_profile: read-only
    max_concurrency: 3
`), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EXORA_CODEX_ENABLED", "1")
	t.Setenv("EXORA_CODEX_COMMAND", "codex-custom")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.LocalAgents.Codex.Enabled || !cfg.LocalAgents.Codex.Automation || cfg.LocalAgents.Codex.AutomationMode != "guarded" || cfg.LocalAgents.Codex.Command != "codex-custom" {
		t.Fatalf("codex config = %#v", cfg.LocalAgents.Codex)
	}
	if len(cfg.LocalAgents.Codex.Roles) != 1 || cfg.LocalAgents.Codex.Roles[0] != "seller" {
		t.Fatalf("roles = %#v", cfg.LocalAgents.Codex.Roles)
	}
	if !filepath.IsAbs(cfg.LocalAgents.Codex.Workspace) || len(cfg.LocalAgents.Codex.WorkspaceRoots) != 1 || cfg.LocalAgents.Codex.MaxConcurrency != 3 {
		t.Fatalf("workspace/concurrency = %#v", cfg.LocalAgents.Codex)
	}
}

func TestLoadCodexAutomationModeAndMultipleWorkspaceRoots(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(`
local_agents:
  codex:
    automation_mode: autonomous
    workspace_roots:
      - ./workspace-a
      - ./workspace-b
`), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LocalAgents.Codex.AutomationMode != "autonomous" || !cfg.LocalAgents.Codex.Automation {
		t.Fatalf("automation projection = %#v", cfg.LocalAgents.Codex)
	}
	if len(cfg.LocalAgents.Codex.WorkspaceRoots) != 2 || cfg.LocalAgents.Codex.Workspace != cfg.LocalAgents.Codex.WorkspaceRoots[0] {
		t.Fatalf("workspace roots = %#v", cfg.LocalAgents.Codex.WorkspaceRoots)
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
	if len(cfg.Provider.Docker.AllowedImages) != 2 || cfg.Provider.Docker.MaxMemoryMB != 2048 {
		t.Fatalf("docker limits = %#v", cfg.Provider.Docker)
	}
}

func TestLoadSellerPolicyLegacyAlias(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("seller_agent:\n  auto_complete_text_tasks: true\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.SellerAgent.AutoAcceptLowRisk {
		t.Fatalf("seller policy = %#v", cfg.SellerAgent)
	}
}
