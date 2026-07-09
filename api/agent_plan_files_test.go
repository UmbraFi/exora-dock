package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteAgentPlanFilesCreatesRequiredPlanArtifacts(t *testing.T) {
	dir := t.TempDir()
	paths, err := writeAgentPlanFiles(dir, "opln-test", "render scene with docker", map[string]any{
		"maxCandidates": float64(3),
		"taskTemplate": map[string]any{
			"type": "rendering",
			"goal": "Render frame range 1-10",
			"requirements": map[string]any{
				"docker": map[string]any{"image": "renderer:stable"},
			},
			"inputFiles": []any{map[string]any{"path": "scene.blend", "sha256": "abc"}},
		},
	}, map[string]any{
		"normalizedQuery": map[string]any{"type": "gpu"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 4 {
		t.Fatalf("paths = %#v", paths)
	}
	for _, name := range []string{"task_requirements", "agent_requirements", "remote_task_manifest"} {
		path := filepath.Join(dir, ".exora", "agent-plans", "opln-test", name+".json")
		if paths[name] != path {
			t.Fatalf("%s path = %q want %q", name, paths[name], path)
		}
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("%s missing: %v", name, err)
		}
	}
	if _, err := os.Stat(paths["user_review"]); err != nil {
		t.Fatalf("user_review missing: %v", err)
	}
	data, err := os.ReadFile(paths["remote_task_manifest"])
	if err != nil {
		t.Fatal(err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest["plan_id"] != "opln-test" || manifest["external_only"] != true || !strings.HasPrefix(manifest["manifest_hash"].(string), "sha256:") {
		t.Fatalf("manifest = %#v", manifest)
	}
	if manifest["schema_version"] != "exora.remote_task_manifest.v0.1" || manifest["created_at"] == "" {
		t.Fatalf("manifest schema fields = %#v", manifest)
	}
}
