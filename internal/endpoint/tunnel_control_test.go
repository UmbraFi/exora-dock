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
	raw, _ := json.Marshal(command)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(raw)
	return hex.EncodeToString(mac.Sum(nil))
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
