package accountscope

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

const migrationVersion = 1

func Namespace(accountID string) string {
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(accountID))
	return hex.EncodeToString(sum[:16])
}

func MigrateLegacy(c *cache.Cache, dataDir string) error {
	marker := filepath.Join(dataDir, "account-scope-v1.json")
	if _, err := os.Stat(marker); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for _, prefix := range []string{"seller-api:", "provider-api:", "v3:endpoints:"} {
		if err := c.DeletePrefix(prefix); err != nil {
			return err
		}
	}
	legacyVault := filepath.Join(dataDir, "seller-automation")
	for _, name := range []string{"credentials.json", "credentials.key"} {
		if err := os.Remove(filepath.Join(legacyVault, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	payload, err := json.MarshalIndent(map[string]any{"schemaVersion": migrationVersion, "legacyAccountlessSellerDataRemoved": true, "completedAt": time.Now().UTC()}, "", "  ")
	if err != nil {
		return err
	}
	temporary := marker + ".tmp"
	if err := os.WriteFile(temporary, append(payload, '\n'), 0600); err != nil {
		return err
	}
	return os.Rename(temporary, marker)
}
