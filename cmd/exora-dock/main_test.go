package main

import (
	"testing"

	"github.com/exora-dock/exora-dock/internal/dht"
)

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
