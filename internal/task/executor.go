package task

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
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
	if !dockerSpecEmpty(req.Docker) {
		return true
	}
	if _, ok := dockerRequirements(t.Requirements); ok {
		return true
	}
	return false
}

func (e *Executor) runDocker(ctx context.Context, t Task, req RunRequest) ([]ArtifactInput, error) {
	spec, err := e.normalizeDockerSpec(t, req)
	if err != nil {
		return nil, err
	}
	jobDir := filepath.Join(e.cfg.WorkspaceDir, sanitizeName(t.ID))
	if err := os.MkdirAll(jobDir, 0700); err != nil {
		return nil, err
	}
	outDir := filepath.Join(jobDir, "out")
	if err := os.MkdirAll(outDir, 0700); err != nil {
		return nil, err
	}
	if err := writeTaskJSON(jobDir, t, spec); err != nil {
		return nil, err
	}

	args, err := e.DockerArgs(t, spec, jobDir)
	if err != nil {
		return nil, err
	}
	timeout := time.Duration(e.cfg.MaxJobSeconds) * time.Second
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, "docker", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	metadata := map[string]any{
		"runtime":     "docker",
		"image":       spec.Image,
		"networkMode": spec.NetworkMode,
		"gpuCount":    spec.GPUCount,
		"cpus":        spec.CPUs,
		"memoryMb":    spec.MemoryMB,
		"startedAt":   time.Now().UTC().Format(time.RFC3339),
		"args":        args,
	}
	if runCtx.Err() == context.DeadlineExceeded {
		metadata["status"] = "timeout"
		return dockerArtifacts(jobDir, spec, stdout.Bytes(), stderr.Bytes(), metadata), fmt.Errorf("docker job timed out")
	}
	if err != nil {
		metadata["status"] = "failed"
		metadata["error"] = err.Error()
		return dockerArtifacts(jobDir, spec, stdout.Bytes(), stderr.Bytes(), metadata), fmt.Errorf("docker job failed: %w", err)
	}
	metadata["status"] = "completed"
	return dockerArtifacts(jobDir, spec, stdout.Bytes(), stderr.Bytes(), metadata), nil
}

func (e *Executor) normalizeDockerSpec(t Task, req RunRequest) (DockerRunSpec, error) {
	if !e.cfg.Docker.Enabled {
		return DockerRunSpec{}, fmt.Errorf("docker executor is disabled")
	}
	spec, _ := dockerRequirements(t.Requirements)
	spec = mergeDockerSpec(spec, req.Docker)
	if strings.TrimSpace(spec.Image) == "" {
		spec.Image = strings.TrimSpace(e.cfg.Docker.DefaultImage)
	}
	if strings.TrimSpace(spec.Image) == "" {
		return DockerRunSpec{}, fmt.Errorf("docker image required")
	}
	if !e.imageAllowed(spec.Image) {
		return DockerRunSpec{}, fmt.Errorf("docker image is not allowed")
	}
	spec.NetworkMode = strings.ToLower(strings.TrimSpace(spec.NetworkMode))
	if spec.NetworkMode == "" {
		spec.NetworkMode = e.cfg.Docker.NetworkMode
	}
	if !e.networkAllowed(spec.NetworkMode) {
		return DockerRunSpec{}, fmt.Errorf("docker network mode is not allowed")
	}
	if spec.GPUCount > 0 && !e.cfg.Docker.AllowGPU {
		return DockerRunSpec{}, fmt.Errorf("docker GPU access is not allowed")
	}
	if e.cfg.Docker.MaxCPUs > 0 {
		if spec.CPUs <= 0 {
			spec.CPUs = e.cfg.Docker.MaxCPUs
		}
		if spec.CPUs > e.cfg.Docker.MaxCPUs {
			return DockerRunSpec{}, fmt.Errorf("docker cpus exceed provider limit")
		}
	}
	if e.cfg.Docker.MaxMemoryMB > 0 {
		if spec.MemoryMB <= 0 {
			spec.MemoryMB = e.cfg.Docker.MaxMemoryMB
		}
		if spec.MemoryMB > e.cfg.Docker.MaxMemoryMB {
			return DockerRunSpec{}, fmt.Errorf("docker memory exceeds provider limit")
		}
	}
	if strings.TrimSpace(spec.Workdir) != "" {
		clean := filepath.ToSlash(filepath.Clean(spec.Workdir))
		if strings.HasPrefix(clean, "../") || clean == ".." || filepath.IsAbs(clean) {
			return DockerRunSpec{}, fmt.Errorf("docker workdir must stay inside workspace")
		}
		spec.Workdir = clean
	}
	if len(spec.ArtifactPaths) == 0 {
		spec.ArtifactPaths = []string{"out"}
	}
	return spec, nil
}

func (e *Executor) DockerArgs(t Task, spec DockerRunSpec, jobDir string) ([]string, error) {
	if strings.TrimSpace(jobDir) == "" {
		return nil, fmt.Errorf("job dir required")
	}
	args := []string{"run", "--rm", "--name", "exora-" + sanitizeName(t.ID)}
	if pull := strings.TrimSpace(e.cfg.Docker.PullPolicy); pull != "" {
		switch pull {
		case "always", "missing", "never":
			args = append(args, "--pull", pull)
		default:
			return nil, fmt.Errorf("unsupported docker pull policy: %s", pull)
		}
	}
	args = append(args, "--network", spec.NetworkMode)
	if spec.CPUs > 0 {
		args = append(args, "--cpus", fmt.Sprintf("%.3g", spec.CPUs))
	}
	if spec.MemoryMB > 0 {
		args = append(args, "--memory", fmt.Sprintf("%dm", spec.MemoryMB))
	}
	if spec.GPUCount > 0 {
		args = append(args, "--gpus", fmt.Sprintf("%d", spec.GPUCount))
	}
	args = append(args, "-v", filepath.Clean(jobDir)+":/workspace")
	workdir := "/workspace"
	if strings.TrimSpace(spec.Workdir) != "" {
		workdir = "/workspace/" + strings.Trim(strings.ReplaceAll(spec.Workdir, "\\", "/"), "/")
	}
	args = append(args, "-w", workdir)
	for _, key := range sortedEnvKeys(spec.Env) {
		if !validEnvName(key) {
			return nil, fmt.Errorf("invalid docker env name: %s", key)
		}
		args = append(args, "-e", key+"="+spec.Env[key])
	}
	args = append(args, spec.Image)
	if strings.TrimSpace(spec.Command) != "" {
		args = append(args, strings.TrimSpace(spec.Command))
	}
	args = append(args, spec.Args...)
	return args, nil
}

func (e *Executor) imageAllowed(image string) bool {
	image = strings.TrimSpace(image)
	if image == "" {
		return false
	}
	allowed := append([]string{}, e.cfg.Docker.AllowedImages...)
	if strings.TrimSpace(e.cfg.Docker.DefaultImage) != "" {
		allowed = append(allowed, e.cfg.Docker.DefaultImage)
	}
	for _, item := range allowed {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if item == "*" || item == image {
			return true
		}
		if strings.HasSuffix(item, ":*") && strings.HasPrefix(image, strings.TrimSuffix(item, "*")) {
			return true
		}
	}
	return false
}

func (e *Executor) networkAllowed(mode string) bool {
	mode = strings.ToLower(strings.TrimSpace(mode))
	for _, allowed := range e.cfg.Docker.AllowedNetworkModes {
		if mode == strings.ToLower(strings.TrimSpace(allowed)) {
			return true
		}
	}
	return false
}

func dockerRequirements(reqs map[string]any) (DockerRunSpec, bool) {
	value, ok := reqs["docker"]
	if !ok || value == nil {
		return DockerRunSpec{}, false
	}
	data, err := json.Marshal(value)
	if err != nil {
		return DockerRunSpec{}, false
	}
	var spec DockerRunSpec
	if err := json.Unmarshal(data, &spec); err != nil {
		return DockerRunSpec{}, false
	}
	return spec, true
}

func mergeDockerSpec(base, override DockerRunSpec) DockerRunSpec {
	if strings.TrimSpace(override.Image) != "" {
		base.Image = override.Image
	}
	if strings.TrimSpace(override.Command) != "" {
		base.Command = override.Command
	}
	if len(override.Args) > 0 {
		base.Args = override.Args
	}
	if len(override.Env) > 0 {
		base.Env = override.Env
	}
	if strings.TrimSpace(override.Workdir) != "" {
		base.Workdir = override.Workdir
	}
	if len(override.ArtifactPaths) > 0 {
		base.ArtifactPaths = override.ArtifactPaths
	}
	if override.CPUs > 0 {
		base.CPUs = override.CPUs
	}
	if override.MemoryMB > 0 {
		base.MemoryMB = override.MemoryMB
	}
	if override.GPUCount > 0 {
		base.GPUCount = override.GPUCount
	}
	if strings.TrimSpace(override.NetworkMode) != "" {
		base.NetworkMode = override.NetworkMode
	}
	return base
}

func dockerSpecEmpty(spec DockerRunSpec) bool {
	return strings.TrimSpace(spec.Image) == "" &&
		strings.TrimSpace(spec.Command) == "" &&
		len(spec.Args) == 0 &&
		len(spec.Env) == 0 &&
		strings.TrimSpace(spec.Workdir) == "" &&
		len(spec.ArtifactPaths) == 0 &&
		spec.CPUs == 0 &&
		spec.MemoryMB == 0 &&
		spec.GPUCount == 0 &&
		strings.TrimSpace(spec.NetworkMode) == ""
}

func writeTaskJSON(jobDir string, t Task, spec DockerRunSpec) error {
	data, err := json.MarshalIndent(map[string]any{"task": t, "docker": spec}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(jobDir, "task.json"), append(data, '\n'), 0600)
}

func dockerArtifacts(jobDir string, spec DockerRunSpec, stdout, stderr []byte, metadata map[string]any) []ArtifactInput {
	metadata["finishedAt"] = time.Now().UTC().Format(time.RFC3339)
	metaData, _ := json.MarshalIndent(metadata, "", "  ")
	out := []ArtifactInput{
		{Name: "stdout.txt", Content: string(stdout), Encoding: "text", ContentType: "text/plain"},
		{Name: "stderr.txt", Content: string(stderr), Encoding: "text", ContentType: "text/plain"},
		{Name: "run.json", Content: string(metaData), Encoding: "text", ContentType: "application/json"},
	}
	for _, rel := range spec.ArtifactPaths {
		out = append(out, readArtifactPath(jobDir, rel)...)
	}
	return out
}

func readArtifactPath(jobDir, rel string) []ArtifactInput {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return nil
	}
	clean := filepath.Clean(rel)
	if filepath.IsAbs(clean) || strings.HasPrefix(filepath.ToSlash(clean), "../") || clean == ".." {
		return []ArtifactInput{{Name: "artifact-error-" + sanitizeName(rel) + ".txt", Content: "artifact path escapes workspace: " + rel, Encoding: "text", ContentType: "text/plain"}}
	}
	root := filepath.Clean(jobDir)
	target := filepath.Join(root, clean)
	if !strings.HasPrefix(filepath.Clean(target), root) {
		return []ArtifactInput{{Name: "artifact-error-" + sanitizeName(rel) + ".txt", Content: "artifact path escapes workspace: " + rel, Encoding: "text", ContentType: "text/plain"}}
	}
	info, err := os.Stat(target)
	if err != nil {
		return nil
	}
	if info.IsDir() {
		var out []ArtifactInput
		_ = filepath.WalkDir(target, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			if item, ok := readArtifactFile(root, path); ok {
				out = append(out, item)
			}
			return nil
		})
		return out
	}
	if item, ok := readArtifactFile(root, target); ok {
		return []ArtifactInput{item}
	}
	return nil
}

func readArtifactFile(root, path string) (ArtifactInput, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ArtifactInput{}, false
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		rel = filepath.Base(path)
	}
	name := sanitizeName(strings.ReplaceAll(filepath.ToSlash(rel), "/", "_"))
	if name == "" || name == "stdout.txt" || name == "stderr.txt" || name == "run.json" || name == "task.json" {
		name = "artifact-" + name
	}
	return ArtifactInput{
		Name:        name,
		Content:     base64.StdEncoding.EncodeToString(data),
		Encoding:    "base64",
		ContentType: contentTypeByName(name),
	}, true
}

func sortedEnvKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func validEnvName(name string) bool {
	if name == "" {
		return false
	}
	for i, r := range name {
		if i == 0 {
			if (r < 'A' || r > 'Z') && (r < 'a' || r > 'z') && r != '_' {
				return false
			}
			continue
		}
		if (r < 'A' || r > 'Z') && (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' {
			return false
		}
	}
	return true
}

func contentTypeByName(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".json":
		return "application/json"
	case ".txt", ".log":
		return "text/plain"
	case ".csv":
		return "text/csv"
	default:
		return "application/octet-stream"
	}
}
