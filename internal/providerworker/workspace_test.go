package providerworker

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestWorkspaceChunksFinalizeAtomicallyAndRejectTraversal(t *testing.T) {
	root := t.TempDir()
	data := []byte("direct file payload")
	sum := sha256.Sum256(data)
	digest := hex.EncodeToString(sum[:])
	if _, err := workspaceWriteResult(root, "models/a.bin", base64.StdEncoding.EncodeToString(data[:7]), 0, false, 0, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := workspaceWriteResult(root, "models/a.bin", base64.StdEncoding.EncodeToString(data[7:]), 7, false, 0, ""); err != nil {
		t.Fatal(err)
	}
	result, err := workspaceWriteResult(root, "models/a.bin", "", 0, true, int64(len(data)), digest)
	if err != nil {
		t.Fatal(err)
	}
	if result["sha256"] != digest {
		t.Fatalf("result=%v", result)
	}
	if _, err := os.Stat(filepath.Join(root, "models", "a.bin.part")); !os.IsNotExist(err) {
		t.Fatal("partial file survived finalization")
	}
	read, err := workspaceReadResult(root, "models/a.bin", 0, 1024)
	if err != nil {
		t.Fatal(err)
	}
	decoded, _ := base64.StdEncoding.DecodeString(read["dataBase64"].(string))
	if string(decoded) != string(data) {
		t.Fatalf("read=%q", decoded)
	}
	if _, err := workspaceReadResult(root, "../escape", 0, 10); err == nil {
		t.Fatal("workspace traversal was accepted")
	}
}

func TestWorkspaceHashMismatchKeepsPartialFile(t *testing.T) {
	root := t.TempDir()
	data := []byte("retry me")
	_, _ = workspaceWriteResult(root, "retry.bin", base64.StdEncoding.EncodeToString(data), 0, false, 0, "")
	if _, err := workspaceWriteResult(root, "retry.bin", "", 0, true, int64(len(data)), hex.EncodeToString(make([]byte, 32))); err == nil {
		t.Fatal("hash mismatch was accepted")
	}
	if _, err := os.Stat(filepath.Join(root, "retry.bin.part")); err != nil {
		t.Fatal("partial file required for resume was removed")
	}
	partial, err := workspacePartialStatResult(root, "retry.bin")
	if err != nil || partial["sizeBytes"] != int64(len(data)) {
		t.Fatalf("partial resume state = %#v, %v", partial, err)
	}
}
