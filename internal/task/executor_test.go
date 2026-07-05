package task

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestDockerExecutorBuildsConstrainedCommand(t *testing.T) {
	executor := NewExecutor(ExecutorConfig{
		WorkspaceDir:  t.TempDir(),
		MaxJobSeconds: 30,
		Docker: DockerExecutorConfig{
			Enabled:             true,
			DefaultImage:        "python:3.12-alpine",
			AllowedImages:       []string{"python:3.12-alpine"},
			NetworkMode:         "none",
			AllowedNetworkModes: []string{"none"},
			MaxCPUs:             2,
			MaxMemoryMB:         1024,
			PullPolicy:          "missing",
		},
	})
	task := Task{
		ID: "task-1",
		Requirements: map[string]any{
			"docker": map[string]any{
				"image":         "python:3.12-alpine",
				"command":       "python",
				"args":          []any{"-c", "print('ok')"},
				"memoryMb":      float64(512),
				"cpus":          float64(1.5),
				"artifactPaths": []any{"out"},
			},
		},
	}
	spec, err := executor.ValidateDockerTask(task, RunRequest{Runtime: "docker"})
	if err != nil {
		t.Fatalf("ValidateDockerTask() error = %v", err)
	}
	args, err := executor.DockerArgs(task, spec, filepath.Join(t.TempDir(), "job"))
	if err != nil {
		t.Fatalf("DockerArgs() error = %v", err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{"run", "--rm", "--pull missing", "--network none", "--cpus 1.5", "--memory 512m", "python:3.12-alpine", "python"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("docker args missing %q in %s", want, joined)
		}
	}
}

func TestDockerExecutorRejectsUnsafePolicy(t *testing.T) {
	executor := NewExecutor(ExecutorConfig{
		Docker: DockerExecutorConfig{
			Enabled:             true,
			DefaultImage:        "python:3.12-alpine",
			AllowedImages:       []string{"python:3.12-alpine"},
			NetworkMode:         "none",
			AllowedNetworkModes: []string{"none"},
			MaxMemoryMB:         256,
		},
	})
	_, err := executor.ValidateDockerTask(Task{ID: "bad-image", Requirements: map[string]any{"docker": map[string]any{"image": "ubuntu:latest"}}}, RunRequest{Runtime: "docker"})
	if err == nil || !strings.Contains(err.Error(), "image") {
		t.Fatalf("image policy error = %v", err)
	}
	_, err = executor.ValidateDockerTask(Task{ID: "bad-net", Requirements: map[string]any{"docker": map[string]any{"image": "python:3.12-alpine", "networkMode": "bridge"}}}, RunRequest{Runtime: "docker"})
	if err == nil || !strings.Contains(err.Error(), "network") {
		t.Fatalf("network policy error = %v", err)
	}
	_, err = executor.ValidateDockerTask(Task{ID: "bad-mem", Requirements: map[string]any{"docker": map[string]any{"image": "python:3.12-alpine", "memoryMb": float64(512)}}}, RunRequest{Runtime: "docker"})
	if err == nil || !strings.Contains(err.Error(), "memory") {
		t.Fatalf("memory policy error = %v", err)
	}
}
