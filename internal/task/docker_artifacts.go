package task

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

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
