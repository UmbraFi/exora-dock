//go:build windows

package providerworker

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf16"
)

type recordingRunner struct{ calls []string }
type leaseRunner struct{ calls []string }

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

func TestDecodeWindowsOutputUTF16LEStartingWithCJK(t *testing.T) {
	want := "默认分发: Ubuntu-24.04\r\n默认版本: 2\r\n"
	words := utf16.Encode([]rune(want))
	raw := make([]byte, 0, len(words)*2)
	for _, word := range words {
		raw = append(raw, byte(word), byte(word>>8))
	}
	if got := decodeWindowsOutput(raw); got != want {
		t.Fatalf("decoded WSL status=%q, want %q", got, want)
	}
}

func TestDecodeWindowsOutputPreservesUTF8(t *testing.T) {
	want := "NVIDIA GeForce RTX 3080"
	if got := decodeWindowsOutput([]byte(want)); got != want {
		t.Fatalf("decoded UTF-8 output=%q, want %q", got, want)
	}
}

func TestCleanupDiskBenchmarkFilesRemovesOnlyScanArtifacts(t *testing.T) {
	root := t.TempDir()
	stale := filepath.Join(root, ".disk-benchmark-123.tmp")
	keep := filepath.Join(root, "provider-state.json")
	if err := os.WriteFile(stale, []byte("stale"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keep, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	cleanupDiskBenchmarkFiles(root)
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale benchmark still exists: %v", err)
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatalf("unrelated provider state was removed: %v", err)
	}
}

func (r *recordingRunner) Run(_ context.Context, name string, args ...string) (string, error) {
	r.calls = append(r.calls, name+" "+strings.Join(args, " "))
	if strings.Contains(strings.Join(args, " "), "--list --quiet") {
		return "Ubuntu\nExora-ready", nil
	}
	return "ok", nil
}

func (r *leaseRunner) Run(_ context.Context, name string, args ...string) (string, error) {
	call := name + " " + strings.Join(args, " ")
	r.calls = append(r.calls, call)
	switch {
	case strings.Contains(call, "--list --running --quiet"):
		return "", nil
	case strings.Contains(call, "--list --quiet"):
		return "Exora-Lease-lease-1", nil
	case strings.Contains(call, "cat /etc/wsl.conf"):
		return "[automount]\nenabled=false\nmountFsTab=false\n[interop]\nenabled=false\nappendWindowsPath=false\n", nil
	case strings.Contains(call, "hostname -I"):
		return "172.27.1.2\n", nil
	default:
		return "ok", nil
	}
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

func TestWindowsLeaseUsesSingleManagedDistroAndResetReceipt(t *testing.T) {
	root := t.TempDir()
	runtimeRoot := filepath.Join(t.TempDir(), "runtime")
	artifact := filepath.Join(root, "images", "cpu.wsl")
	if err := os.MkdirAll(filepath.Dir(artifact), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifact, []byte("managed image"), 0600); err != nil {
		t.Fatal(err)
	}
	runner := &leaseRunner{}
	server := Server{DataDir: root, Runner: runner}
	input := map[string]any{
		"leaseId":      "lease-1",
		"leaseEpoch":   float64(1),
		"sshPublicKey": "ssh-ed25519 AAAATEST desktop",
		"product": map[string]any{"manifest": map[string]any{
			"runtimeBackend":     "wsl2",
			"isolationClass":     "managed_wsl2_shared_host",
			"environmentImageId": "cpu",
			"environmentRoot":    runtimeRoot,
			"publicHost":         "203.0.113.8",
		}},
	}
	result, err := server.provisionLease(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if result["backend"] != "wsl2" || result["isolationClass"] != "managed_wsl2_shared_host" || result["guestVerified"] != true {
		t.Fatalf("result=%v", result)
	}
	disclosure := result["resourceDisclosure"].(map[string]any)
	if disclosure["singleLeasePerHost"] != true || disclosure["hardwarePassthroughExclusive"] != false {
		t.Fatalf("disclosure=%v", disclosure)
	}
	if _, err := server.leaseRecheck(context.Background(), map[string]any{"leaseId": "lease-2"}); err == nil {
		t.Fatal("second WSL lease was accepted while the host lock was active")
	}
	reset, err := server.resetLease(context.Background(), map[string]any{"leaseId": "lease-1"})
	if err != nil {
		t.Fatal(err)
	}
	receipt := reset["resetReceipt"].(map[string]any)
	if receipt["distributionUnregistered"] != true || receipt["guestCredentialsDestroyed"] != true || receipt["portProxyRemoved"] != true {
		t.Fatalf("receipt=%v", receipt)
	}
	if _, err := os.Stat(server.wslLeaseLockPath()); !os.IsNotExist(err) {
		t.Fatalf("lease lock still exists: %v", err)
	}
	joined := strings.Join(runner.calls, "\n")
	for _, expected := range []string{"--import Exora-Lease-lease-1", "portproxy add", "--unregister Exora-Lease-lease-1", "Remove-NetFirewallRule"} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("missing %q in calls:\n%s", expected, joined)
		}
	}
}

func TestWindowsLeaseWithoutPublicHostUsesProviderHostDirectAccess(t *testing.T) {
	root := t.TempDir()
	artifact := filepath.Join(root, "images", "cpu.wsl")
	if err := os.MkdirAll(filepath.Dir(artifact), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifact, []byte("managed image"), 0600); err != nil {
		t.Fatal(err)
	}
	runner := &leaseRunner{}
	server := Server{DataDir: root, Runner: runner}
	result, err := server.provisionLease(context.Background(), map[string]any{
		"leaseId":      "lease-local",
		"leaseEpoch":   float64(1),
		"sshPublicKey": "ssh-ed25519 AAAATEST desktop",
		"product": map[string]any{"manifest": map[string]any{
			"runtimeBackend":     "wsl2",
			"isolationClass":     "managed_wsl2_shared_host",
			"environmentImageId": "cpu",
			"environmentRoot":    filepath.Join(t.TempDir(), "runtime"),
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	capability := result["capability"].(map[string]any)
	if capability["host"] != "172.27.1.2" || capability["port"] != 22 || capability["accessMode"] != "provider_host_direct" {
		t.Fatalf("capability=%v", capability)
	}
	joined := strings.Join(runner.calls, "\n")
	if strings.Contains(joined, "portproxy add") || strings.Contains(joined, "New-NetFirewallRule") {
		t.Fatalf("provider-host-only lease requested elevated networking:\n%s", joined)
	}
}
