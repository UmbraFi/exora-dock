package discovery

import (
	"path/filepath"
	"testing"
)

func TestBaseURLNormalizesLocalListenAddresses(t *testing.T) {
	cases := map[string]string{
		":8080":        "http://127.0.0.1:8080",
		"8081":         "http://127.0.0.1:8081",
		"0.0.0.0:8082": "http://127.0.0.1:8082",
		"localhost:9":  "http://localhost:9",
	}
	for input, want := range cases {
		if got := BaseURL(input); got != want {
			t.Fatalf("BaseURL(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestWriteAndReadFirstUsesExplicitDiscoveryPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dock", FileName)
	t.Setenv("EXORA_DOCK_DISCOVERY_PATH", path)

	written, err := Write(Build(":18080", "dock-test"))
	if err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if len(written) == 0 || written[0] != path {
		t.Fatalf("written = %#v, want first path %q", written, path)
	}

	manifest, readPath, err := ReadFirst()
	if err != nil {
		t.Fatalf("ReadFirst() error = %v", err)
	}
	if readPath != path {
		t.Fatalf("readPath = %q, want %q", readPath, path)
	}
	if manifest.DockID != "dock-test" {
		t.Fatalf("DockID = %q, want dock-test", manifest.DockID)
	}
	if manifest.Endpoints["resources.search"].URL != "http://127.0.0.1:18080/v1/resources" {
		t.Fatalf("resources.search URL = %q", manifest.Endpoints["resources.search"].URL)
	}
	if manifest.AgentPrompt == "" || manifest.OpenCodeConfig == nil || manifest.RESTFallback == nil {
		t.Fatalf("missing agent copy metadata: %#v", manifest)
	}
}
