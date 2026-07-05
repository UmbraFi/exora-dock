package agentcard

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestCollectDiagnosticsIncludesSystemAttributes(t *testing.T) {
	diag := CollectDiagnostics(DiagnosticsConfig{LLMProvider: "https://api.openai.com/v1", LLMConfigured: true, MCPAvailable: true})
	if diag.OS == "" || diag.Arch == "" || diag.CPUCores <= 0 {
		t.Fatalf("expected OS, arch, and CPU cores, got %+v", diag)
	}
	if diag.DiagnosticsVersion != diagnosticsVersion {
		t.Fatalf("version = %q, want %q", diag.DiagnosticsVersion, diagnosticsVersion)
	}
	if len(diag.Storage) == 0 {
		t.Fatalf("expected system storage summary")
	}
	storage := diag.Storage[0]
	if storage.Label != "system" || storage.TotalGB <= 0 || storage.FreeGB < 0 || storage.UsedPercent < 0 || storage.UsedPercent > 100 {
		t.Fatalf("unexpected storage summary: %+v", storage)
	}
}

func TestDiagnosticsAvoidLocalStorageDetails(t *testing.T) {
	diag := CollectDiagnostics(DiagnosticsConfig{})
	data, err := json.Marshal(diag)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, storage := range diag.Storage {
		if strings.Contains(storage.Label, ":") || strings.Contains(storage.Label, "/") || strings.Contains(storage.Label, `\`) {
			t.Fatalf("storage label should not expose a local path or drive: %q", storage.Label)
		}
	}
	if wd, err := os.Getwd(); err == nil && len(wd) > 3 && strings.Contains(text, wd) {
		t.Fatalf("diagnostics should not contain working directory %q: %s", wd, text)
	}
	if home, err := os.UserHomeDir(); err == nil && len(home) > 3 && strings.Contains(text, home) {
		t.Fatalf("diagnostics should not contain home directory %q: %s", home, text)
	}
}

func TestStorageCalculations(t *testing.T) {
	if got := bytesToGB(1); got != 1 {
		t.Fatalf("bytesToGB(1) = %d, want 1", got)
	}
	if got := bytesToGB(1 << 30); got != 1 {
		t.Fatalf("bytesToGB(1GiB) = %d, want 1", got)
	}
	if got := bytesToGB((1 << 30) + 1); got != 2 {
		t.Fatalf("bytesToGB(1GiB+1) = %d, want 2", got)
	}
	if got := usedPercent(100, 25); got != 75 {
		t.Fatalf("usedPercent(100, 25) = %d, want 75", got)
	}
	if got := usedPercent(100, 150); got != 0 {
		t.Fatalf("usedPercent should clamp over-reported free space, got %d", got)
	}
	storage := storageFromBytes(100<<30, 25<<30)
	if len(storage) != 1 || storage[0].TotalGB != 100 || storage[0].FreeGB != 25 || storage[0].UsedPercent != 75 {
		t.Fatalf("storageFromBytes returned %+v", storage)
	}
}
