//go:build windows

package agentcard

import "testing"

func TestWindowsDiagnosticsUseNativeSources(t *testing.T) {
	if got := windowsOSVersion(); got == "" {
		t.Fatal("expected Windows OS version from native diagnostics")
	}
	if got := windowsKernelVersion(); got == "" {
		t.Fatal("expected Windows kernel version from native diagnostics")
	}
	if got := windowsCPUModel(); got == "" {
		t.Fatal("expected Windows CPU model from registry or CIM")
	}
	if got := windowsRAMGB(); got <= 0 {
		t.Fatalf("expected Windows RAM size, got %d", got)
	}
}

func TestCollectDiagnosticsIncludesWindowsDetails(t *testing.T) {
	diag := CollectDiagnostics(DiagnosticsConfig{})
	if diag.OSVersion == "" {
		t.Fatalf("expected OSVersion, got %+v", diag)
	}
	if diag.KernelVersion == "" {
		t.Fatalf("expected KernelVersion, got %+v", diag)
	}
	if diag.CPUModel == "" {
		t.Fatalf("expected CPUModel, got %+v", diag)
	}
	if diag.RAMGB <= 0 {
		t.Fatalf("expected RAMGB, got %+v", diag)
	}
}
