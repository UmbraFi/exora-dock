package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cloudlink"
)

func TestEnvironmentImageCatalogUsesDockIdentity(t *testing.T) {
	requests := make(chan *http.Request, 2)
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.Clone(r.Context())
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"images":[]}`))
	}))
	defer cloud.Close()

	tokenPath := filepath.Join(t.TempDir(), "cloud-token.json")
	if err := cloudlink.SaveToken(tokenPath, cloudlink.TokenFile{CloudURL: cloud.URL, CloudToken: "dock-token"}); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(Options{CloudURL: cloud.URL, CloudTokenPath: tokenPath})

	tests := []struct {
		name      string
		target    string
		imageID   string
		wantPath  string
		wantQuery string
	}{
		{name: "catalog", target: "/v3/catalog/environment-images?runtime=wsl2&arch=amd64", wantPath: "/v3/catalog/environment-images", wantQuery: "runtime=wsl2&arch=amd64"},
		{name: "item", target: "/v3/catalog/environment-images/ubuntu?version=1.0.0", imageID: "ubuntu", wantPath: "/v3/catalog/environment-images/ubuntu", wantQuery: "version=1.0.0"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, test.target, nil)
			if test.imageID != "" {
				request.SetPathValue("id", test.imageID)
				handler.V3EnvironmentImageCatalogItem(recorder, request)
			} else {
				handler.V3EnvironmentImageCatalog(recorder, request)
			}
			if recorder.Code != http.StatusOK {
				t.Fatalf("returned %d: %s", recorder.Code, recorder.Body.String())
			}
			forwarded := <-requests
			if got := forwarded.Header.Get("Authorization"); got != "Bearer dock-token" {
				t.Fatalf("Authorization=%q, want Dock token", got)
			}
			if forwarded.URL.Path != test.wantPath || forwarded.URL.RawQuery != test.wantQuery {
				t.Fatalf("forwarded URL=%s, want %s?%s", forwarded.URL.String(), test.wantPath, test.wantQuery)
			}
		})
	}
}
