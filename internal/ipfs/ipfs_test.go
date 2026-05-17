package ipfs

import (
	"io"
	"strings"
	"testing"
)

func TestClientFallsBackToLocalStore(t *testing.T) {
	client := NewClient("http://127.0.0.1:1", t.TempDir())

	cid, err := client.Add("photo.jpg", strings.NewReader("image-bytes"))
	if err != nil {
		t.Fatalf("Add() error = %v", err)
	}
	if !strings.HasPrefix(cid, "local-") {
		t.Fatalf("cid = %q, want local fallback cid", cid)
	}

	rc, err := client.Cat(cid)
	if err != nil {
		t.Fatalf("Cat() error = %v", err)
	}
	defer rc.Close()

	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("ReadAll() error = %v", err)
	}
	if string(got) != "image-bytes" {
		t.Fatalf("Cat() = %q, want image-bytes", got)
	}
}
