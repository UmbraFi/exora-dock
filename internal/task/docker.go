package task

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

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

func DockerSpecEmpty(spec DockerRunSpec) bool {
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

func WithDockerRequirement(reqs map[string]any, spec DockerRunSpec) map[string]any {
	if reqs == nil {
		reqs = map[string]any{}
	}
	if !DockerSpecEmpty(spec) {
		reqs["docker"] = spec
	}
	return reqs
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
