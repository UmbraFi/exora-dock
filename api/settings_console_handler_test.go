package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestSellerSettingsContainProviderPolicyWithoutModelCredentials(t *testing.T) {
	handler := NewHandler(nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, "dock", RuntimeStores{
		ConfigPath: filepath.Join(t.TempDir(), "config.yaml"),
	})
	req := httptest.NewRequest(http.MethodGet, "/settings/seller-agent", nil)
	rec := httptest.NewRecorder()
	handler.GetSellerAgentSettings(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	body := strings.ToLower(rec.Body.String())
	for _, forbidden := range []string{"apikey", "model", "providerpreset", "baseurl"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("seller settings leaked removed model configuration %q: %s", forbidden, rec.Body.String())
		}
	}
}
