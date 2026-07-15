package endpoint

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"
)

func signControlForTest(command ControlCommand, key []byte) string {
	command.Signature = ""
	raw, _ := canonicalControlCommandJSON(command)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(raw)
	return hex.EncodeToString(mac.Sum(nil))
}

func TestProviderControlSignatureSurvivesTypedInputJSONRoundTrip(t *testing.T) {
	type product struct {
		ProductID string         `json:"productId"`
		Manifest  map[string]any `json:"manifest"`
		Version   int64          `json:"version"`
	}
	key := []byte("dock-control-token")
	command := ControlCommand{CommandID: "cmd-typed", Command: "ProvisionLease", LeaseID: "lease-typed", LeaseEpoch: 1, Deadline: time.Now().Add(time.Minute).UTC(), Input: map[string]any{
		"durationMinutes": int64(2),
		"product":         product{ProductID: "prd-1", Version: 2, Manifest: map[string]any{"runtimeBackend": "wsl2", "limits": map[string]any{"minMinutes": 1}}},
	}}
	command.Signature = signControlForTest(command, key)
	raw, err := json.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	var decoded ControlCommand
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if err := verifyControlCommandSignature(decoded, key); err != nil {
		t.Fatalf("typed input changed its signature after JSON decoding: %v", err)
	}
}

func TestProviderControlSignatureCoversLeaseEpochDeadlineAndInput(t *testing.T) {
	key := []byte("dock-control-token")
	command := ControlCommand{CommandID: "cmd-1", Command: "ProvisionLease", LeaseID: "lease-1", LeaseEpoch: 3, Deadline: time.Now().Add(time.Minute).UTC(), Input: map[string]any{"backend": "kvm_libvirt"}}
	command.Signature = signControlForTest(command, key)
	if err := verifyControlCommandSignature(command, key); err != nil {
		t.Fatal(err)
	}
	mutations := []ControlCommand{command, command, command}
	mutations[0].LeaseEpoch++
	mutations[1].Deadline = mutations[1].Deadline.Add(time.Second)
	mutations[2].Input = map[string]any{"backend": "wsl2"}
	for index, mutated := range mutations {
		if err := verifyControlCommandSignature(mutated, key); err == nil {
			t.Fatalf("mutation %d retained a valid signature", index)
		}
	}
	if err := verifyControlCommandSignature(command, nil); err == nil {
		t.Fatal("empty control key was accepted")
	}
}
