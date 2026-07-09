package task

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type ExecutorConfig struct {
	Enabled         bool
	WorkspaceDir    string
	AllowedCommands []string
	MaxJobSeconds   int
	Docker          DockerExecutorConfig
}

type DockerExecutorConfig struct {
	Enabled             bool
	DefaultImage        string
	AllowedImages       []string
	NetworkMode         string
	AllowedNetworkModes []string
	AllowGPU            bool
	MaxCPUs             float64
	MaxMemoryMB         int
	PullPolicy          string
}

type RunRequest struct {
	ProviderPubkey string        `json:"providerPubkey"`
	Runtime        string        `json:"runtime,omitempty"`
	Command        string        `json:"command,omitempty"`
	Args           []string      `json:"args,omitempty"`
	Docker         DockerRunSpec `json:"docker,omitempty"`
}

type DockerRunSpec struct {
	Image         string            `json:"image,omitempty"`
	Command       string            `json:"command,omitempty"`
	Args          []string          `json:"args,omitempty"`
	Env           map[string]string `json:"env,omitempty"`
	Workdir       string            `json:"workdir,omitempty"`
	ArtifactPaths []string          `json:"artifactPaths,omitempty"`
	CPUs          float64           `json:"cpus,omitempty"`
	MemoryMB      int               `json:"memoryMb,omitempty"`
	GPUCount      int               `json:"gpuCount,omitempty"`
	NetworkMode   string            `json:"networkMode,omitempty"`
}

type Executor struct {
	cfg ExecutorConfig
}

func NewExecutor(cfg ExecutorConfig) *Executor {
	if cfg.MaxJobSeconds <= 0 {
		cfg.MaxJobSeconds = 300
	}
	if strings.TrimSpace(cfg.WorkspaceDir) == "" {
		cfg.WorkspaceDir = filepath.Join(".", "data", "jobs")
	}
	cfg.Docker.NetworkMode = strings.ToLower(strings.TrimSpace(cfg.Docker.NetworkMode))
	if cfg.Docker.NetworkMode == "" {
		cfg.Docker.NetworkMode = "none"
	}
	if len(cfg.Docker.AllowedNetworkModes) == 0 {
		cfg.Docker.AllowedNetworkModes = []string{cfg.Docker.NetworkMode}
	}
	for i, mode := range cfg.Docker.AllowedNetworkModes {
		cfg.Docker.AllowedNetworkModes[i] = strings.ToLower(strings.TrimSpace(mode))
	}
	cfg.Docker.PullPolicy = strings.ToLower(strings.TrimSpace(cfg.Docker.PullPolicy))
	if cfg.Docker.PullPolicy == "" {
		cfg.Docker.PullPolicy = "missing"
	}
	return &Executor{cfg: cfg}
}

func (e *Executor) Enabled() bool {
	return e != nil && (e.cfg.Enabled || e.cfg.Docker.Enabled)
}

func (e *Executor) Run(ctx context.Context, t Task, req RunRequest) ([]ArtifactInput, error) {
	if e == nil {
		return nil, fmt.Errorf("task executor is not configured")
	}
	if e.isDockerRun(t, req) {
		return e.runDocker(ctx, t, req)
	}
	if !e.Enabled() {
		return nil, fmt.Errorf("command executor is disabled")
	}
	if !e.cfg.Enabled {
		return nil, fmt.Errorf("command executor is disabled")
	}
	command := strings.TrimSpace(req.Command)
	if command == "" {
		return nil, fmt.Errorf("command required")
	}
	if !e.allowed(command) {
		return nil, fmt.Errorf("command is not allowed")
	}
	jobDir := filepath.Join(e.cfg.WorkspaceDir, sanitizeName(t.ID))
	if err := os.MkdirAll(jobDir, 0700); err != nil {
		return nil, err
	}
	timeout := time.Duration(e.cfg.MaxJobSeconds) * time.Second
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, command, req.Args...)
	cmd.Dir = jobDir
	output, err := cmd.CombinedOutput()
	if runCtx.Err() == context.DeadlineExceeded {
		return []ArtifactInput{{
			Name:        "output.txt",
			Content:     string(output),
			Encoding:    "text",
			ContentType: "text/plain",
		}}, fmt.Errorf("command timed out")
	}
	if err != nil {
		return []ArtifactInput{{
			Name:        "output.txt",
			Content:     string(output),
			Encoding:    "text",
			ContentType: "text/plain",
		}}, fmt.Errorf("command failed: %w", err)
	}
	return []ArtifactInput{{
		Name:        "output.txt",
		Content:     string(output),
		Encoding:    "text",
		ContentType: "text/plain",
	}}, nil
}

func (e *Executor) DockerEnabled() bool {
	return e != nil && e.cfg.Docker.Enabled
}

func (e *Executor) ValidateDockerTask(t Task, req RunRequest) (DockerRunSpec, error) {
	if e == nil {
		return DockerRunSpec{}, fmt.Errorf("task executor is not configured")
	}
	return e.normalizeDockerSpec(t, req)
}

func (e *Executor) allowed(command string) bool {
	base := filepath.Base(command)
	for _, allowed := range e.cfg.AllowedCommands {
		allowed = strings.TrimSpace(allowed)
		if allowed == "" {
			continue
		}
		if command == allowed || base == allowed || filepath.Base(allowed) == base {
			return true
		}
	}
	return false
}

func (e *Executor) isDockerRun(t Task, req RunRequest) bool {
	if strings.EqualFold(strings.TrimSpace(req.Runtime), "docker") {
		return true
	}
	if !DockerSpecEmpty(req.Docker) {
		return true
	}
	if _, ok := dockerRequirements(t.Requirements); ok {
		return true
	}
	return false
}
