//go:build windows

package providerworker

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type recordingRunner struct{ calls []string }

func TestHiddenCommandContextSuppressesConsoleWindows(t *testing.T) {
	cmd := hiddenCommandContext(context.Background(), "cmd.exe", "/c", "exit", "0")
	if cmd.SysProcAttr == nil {
		t.Fatal("expected Windows process attributes")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("provider probes must hide child process windows")
	}
	if cmd.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Fatal("provider probes must use CREATE_NO_WINDOW")
	}
}

func (r *recordingRunner) Run(_ context.Context, name string, args ...string) (string, error) {
	r.calls = append(r.calls, name+" "+strings.Join(args, " "))
	if strings.Contains(strings.Join(args, " "), "--list --quiet") {
		return "Ubuntu\nExora-ready", nil
	}
	return "ok", nil
}

func TestWindowsWorkerNeverManagesNonExoraDistribution(t *testing.T) {
	r := &recordingRunner{}
	s := Server{DataDir: t.TempDir(), Runner: r}
	out, err := s.listImages(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	items := out["environments"].([]map[string]any)
	if len(items) != 1 || items[0]["environmentId"] != "ready" {
		t.Fatalf("managed environments=%v", items)
	}
	if _, err := s.deleteImage(context.Background(), map[string]any{"environmentId": "../Ubuntu"}); err == nil {
		t.Fatal("unsafe distribution id accepted")
	}
	for _, call := range r.calls {
		if strings.Contains(call, "--unregister Ubuntu") {
			t.Fatal("non-Exora distribution was touched")
		}
	}
}

func TestWindowsImportRequiresManagedWSLArtifact(t *testing.T) {
	r := &recordingRunner{}
	root := t.TempDir()
	s := Server{DataDir: root, Runner: r}
	outside := filepath.Join(t.TempDir(), "image.wsl")
	_ = os.WriteFile(outside, []byte("x"), 0600)
	if _, err := s.importImage(context.Background(), map[string]any{"environmentId": "cpu", "artifactPath": outside}); err == nil {
		t.Fatal("outside artifact accepted")
	}
	inside := filepath.Join(root, "images", "cpu.wsl")
	_ = os.MkdirAll(filepath.Dir(inside), 0700)
	_ = os.WriteFile(inside, []byte("x"), 0600)
	environmentRoot := t.TempDir()
	if _, err := s.importImage(context.Background(), map[string]any{"environmentId": "cpu", "artifactPath": inside, "environmentRoot": environmentRoot}); err != nil {
		t.Fatal(err)
	}
	if len(r.calls) == 0 || !strings.Contains(r.calls[len(r.calls)-1], "--import Exora-cpu") {
		t.Fatalf("calls=%v", r.calls)
	}
}

func TestWindowsEnvironmentRootCannotOverlapImageCache(t *testing.T) {
	root := t.TempDir()
	s := Server{DataDir: root, Runner: &recordingRunner{}}
	if _, err := s.environmentRoot(map[string]any{"environmentRoot": filepath.Join(root, "images", "instances")}); err == nil {
		t.Fatal("environment root inside image cache accepted")
	}
}
