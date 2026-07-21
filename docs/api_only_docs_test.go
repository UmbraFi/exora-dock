package docs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestV4WhitepapersDescribeTheLockedAPIOnlyContract(t *testing.T) {
	for _, name := range []string{"WHITEPAPER.md", "WHITEPAPER.en.md"} {
		raw, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		text := string(raw)
		for _, required := range []string{
			"API-only", "applicationSource", "local_dock", "cloud_direct",
			"request_response", "server_stream", "async_job", "Artifact",
			"Verified Purchase", "72", "/v4", "exora.service_manifest.v2",
			"Integration Session", "Exora Adapter", "exora.api-contract.v1",
			"exora.operation-pricing.v4", "exora.price-formula.v4", "exora.operation-billing-plan.v4", "exora.operation-billing-receipt.v4", "exora.operation-settlement.v4", "delivered", "offline / live / draining",
		} {
			if !strings.Contains(text, required) {
				t.Errorf("%s is missing V4 contract term %q", name, required)
			}
		}
		for _, forbidden := range []string{"Seller Agent", "Seller Local", "Wrapper Build"} {
			if strings.Contains(text, forbidden) {
				t.Errorf("%s contains retired concept %q", name, forbidden)
			}
		}
		for _, forbidden := range []string{"templateId", "exora.operation-pricing.v1", "exora.operation-pricing.v2", "exora.operation-pricing.v3", "exora.price-formula.v3", "exora.operation-billing-plan.v3", "exora.operation-billing-receipt.v3", "exora.operation-settlement.v1", "exora.operation-settlement.v2", "exora.operation-settlement.v3"} {
			if strings.Contains(text, forbidden) {
				t.Errorf("%s contains retired pricing contract %q", name, forbidden)
			}
		}
	}
}

func TestWebsiteWhitepaperIsAlsoAPIOnlyV4(t *testing.T) {
	path := filepath.Join("..", "..", "exora-web", "public", "WHITEPAPER.en.md")
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		t.Skip("website repository is not checked out beside Dock")
	}
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, required := range []string{"API-only", "exora.service_manifest.v2", "local_dock", "cloud_direct", "async_job", "Artifact", "Verified Purchase", "/v4", "Integration Session", "Exora Adapter", "exora.operation-pricing.v4", "exora.price-formula.v4", "exora.operation-settlement.v4", "delivered"} {
		if !strings.Contains(text, required) {
			t.Errorf("website whitepaper is missing %q", required)
		}
	}
	for _, forbidden := range []string{"Seller Agent", "Seller Local", "Wrapper Build"} {
		if strings.Contains(text, forbidden) {
			t.Errorf("website whitepaper contains retired concept %q", forbidden)
		}
	}
}
