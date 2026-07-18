package endpoint

import "testing"

func TestComputeTransferPacketAuthenticatesEachChunk(t *testing.T) {
	packet := computeTransferPacket(64, []byte("chunk payload"))
	offset, data, err := parseComputeTransferPacket(packet)
	if err != nil || offset != 64 || string(data) != "chunk payload" {
		t.Fatalf("parsed packet = %d %q %v", offset, data, err)
	}
	packet[len(packet)-1] ^= 1
	if _, _, err := parseComputeTransferPacket(packet); err == nil {
		t.Fatal("tampered chunk was accepted")
	}
}
