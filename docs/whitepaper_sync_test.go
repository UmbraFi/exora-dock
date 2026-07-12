package docs

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var sourceHashPattern = regexp.MustCompile(`normalized-sha256:\s*([a-f0-9]{64})`)
var jsonBlockPattern = regexp.MustCompile("(?s)```json\\s*\\n(.*?)```")

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

func TestWhitepaperJSONExamplesAreValid(t *testing.T) {
	for _, name := range []string{"WHITEPAPER.md", "WHITEPAPER.en.md"} {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		blocks := jsonBlockPattern.FindAllSubmatch(data, -1)
		if len(blocks) < 12 {
			t.Fatalf("%s has only %d JSON examples; want at least 12", name, len(blocks))
		}
		for i, block := range blocks {
			var value any
			if err := json.Unmarshal(block[1], &value); err != nil {
				t.Fatalf("%s JSON example %d is invalid: %v", name, i+1, err)
			}
		}
	}
}

func TestV32ComputeInvariantsAreDocumented(t *testing.T) {
	checks := map[string][]string{
		"WHITEPAPER.md": {
			"一台物理机只能出售为一个独占计算库存",
			"每 30 秒执行轻量检查",
			"每 5 分钟执行完整检查",
			"连续三次完整检查通过",
			"用户工作盘已经全额预留",
			"Agent 拥有 Guest Root",
			"failure → quarantined",
		},
		"WHITEPAPER.en.md": {
			"one physical computer can be sold as only one exclusive compute inventory unit",
			"light check every 30 seconds",
			"full check every five minutes",
			"three consecutive five-minute full checks",
			"full reservation of the consumer workspace disk",
			"The Agent has Guest Root",
			"failure → quarantined",
		},
	}
	for name, required := range checks {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		text := string(data)
		for _, phrase := range required {
			if !strings.Contains(text, phrase) {
				t.Errorf("%s is missing V3.2 compute invariant %q", name, phrase)
			}
		}
	}
}

func TestV32AIProductInvariantsAreDocumented(t *testing.T) {
	checks := map[string][]string{
		"WHITEPAPER.md": {
			"AgentProductManifest",
			"无需卖家手动下架",
			"正常恢复时间约 15 分钟",
			"Consumer 主动提前释放不退未使用分钟",
			"1 小时至 30 天",
			"有效期内可重复签发短期 URL",
			"Exora 只展示和结算 `capabilityFee`",
			"图形化内容只是可选的人类辅助",
		},
		"WHITEPAPER.en.md": {
			"AgentProductManifest",
			"no manual delisting is needed",
			"normal recovery takes about 15 minutes",
			"Voluntary early release does not refund unused minutes",
			"one hour to 30 days",
			"reissue short-lived URLs",
			"Exora displays and settles only `capabilityFee`",
			"Graphics are optional human aids",
		},
	}
	for name, required := range checks {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		text := string(data)
		for _, phrase := range required {
			if !strings.Contains(text, phrase) {
				t.Errorf("%s is missing V3.2 AI product invariant %q", name, phrase)
			}
		}
	}
}
