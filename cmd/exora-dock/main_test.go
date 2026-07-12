package main

import (
	"reflect"
	"testing"

	"github.com/exora-dock/exora-dock/internal/dht"
)

func TestCodexMCPConfigPreApprovesOnlyEnabledTools(t *testing.T) {
	tools := []string{"exora.session_request_user_input", "exora.session_submit_plan"}
	config := codexMCPConfig("exora-dockd.exe", []string{"mcp", "config.yaml"}, `C:\workspace`, map[string]string{"EXORA_MCP_ROLE": "buyer"}, tools)
	if config["mcp_servers.exora.default_tools_approval_mode"] != "approve" {
		t.Fatalf("buyer interview tools were not pre-approved: %#v", config)
	}
	if !reflect.DeepEqual(config["mcp_servers.exora.enabled_tools"], tools) {
		t.Fatalf("enabled tools=%#v want %#v", config["mcp_servers.exora.enabled_tools"], tools)
	}
}

func TestEnsureLocalMinerRegistersSingleDevMiner(t *testing.T) {
	ring := dht.NewRing()
	self := ensureLocalMiner(ring, "local", ":8080")

	if self != "local-dev-miner" {
		t.Fatalf("self = %q, want local-dev-miner", self)
	}
	miners := ring.Miners()
	if len(miners) != 1 {
		t.Fatalf("miners = %d, want 1", len(miners))
	}
	if miners[0].Endpoint != "http://localhost:8080" {
		t.Fatalf("endpoint = %q", miners[0].Endpoint)
	}
}
