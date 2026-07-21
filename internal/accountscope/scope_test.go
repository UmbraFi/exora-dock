package accountscope

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

func TestMigrateLegacyRemovesOnlyAccountlessSellerData(t *testing.T) {
	dataDir := t.TempDir()
	c, err := cache.New(100, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	for _, key := range []string{"seller-api:policy", "seller-api:candidate:one", "provider-api:draft:one", "v3:endpoints:one"} {
		c.Set(key, []byte("legacy"), time.Hour)
	}
	c.Set("unrelated:key", []byte("keep"), time.Hour)
	vaultDir := filepath.Join(dataDir, "seller-automation")
	if err := os.MkdirAll(vaultDir, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"credentials.json", "credentials.key"} {
		if err := os.WriteFile(filepath.Join(vaultDir, name), []byte("legacy"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := MigrateLegacy(c, dataDir); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"seller-api:policy", "seller-api:candidate:one", "provider-api:draft:one", "v3:endpoints:one"} {
		if _, found := c.Get(key); found {
			t.Fatalf("legacy key survived: %s", key)
		}
	}
	if value, found := c.Get("unrelated:key"); !found || string(value) != "keep" {
		t.Fatal("unrelated cache data was removed")
	}
	if err := MigrateLegacy(c, dataDir); err != nil {
		t.Fatalf("migration is not idempotent: %v", err)
	}
}
