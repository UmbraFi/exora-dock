package docs

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var sourceHashPattern = regexp.MustCompile(`normalized-sha256:\s*([a-f0-9]{64})`)

func normalizedSHA256(data []byte) string {
	normalized := strings.ReplaceAll(string(data), "\r\n", "\n")
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

func TestEnglishWhitepaperTracksChineseSource(t *testing.T) {
	zh, err := os.ReadFile("WHITEPAPER.md")
	if err != nil {
		t.Fatal(err)
	}
	en, err := os.ReadFile("WHITEPAPER.en.md")
	if err != nil {
		t.Fatal(err)
	}

	match := sourceHashPattern.FindSubmatch(en)
	if match == nil {
		t.Fatal("WHITEPAPER.en.md is missing its normalized source hash")
	}
	if got, want := string(match[1]), normalizedSHA256(zh); got != want {
		t.Fatalf("English whitepaper is stale: source hash %s, want %s", got, want)
	}
}

func TestWebsiteWhitepaperMatchesCanonicalEnglishWhenPresent(t *testing.T) {
	websitePath := filepath.Join("..", "..", "exora-web", "public", "WHITEPAPER.en.md")
	website, err := os.ReadFile(websitePath)
	if os.IsNotExist(err) {
		t.Skip("website repository is not checked out beside exora-dock")
	}
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := os.ReadFile("WHITEPAPER.en.md")
	if err != nil {
		t.Fatal(err)
	}

	stripMarker := func(data []byte) string {
		lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
		if len(lines) > 0 && strings.HasPrefix(lines[0], "<!-- Source:") {
			lines = lines[1:]
		}
		return strings.Join(lines, "\n")
	}
	if got, want := stripMarker(website), stripMarker(canonical); got != want {
		t.Fatal("website whitepaper has drifted from docs/WHITEPAPER.en.md")
	}
}
