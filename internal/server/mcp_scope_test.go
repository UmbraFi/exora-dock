package server

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/exora-dock/exora-dock/internal/localauth"
)

func TestAPIOrderReadAndWriteUseDifferentAgentPermissions(t *testing.T) {
	read := &http.Request{Method: http.MethodGet, URL: &url.URL{Path: "/v4/api-orders"}}
	write := &http.Request{Method: http.MethodPost, URL: &url.URL{Path: "/v4/api-orders/aord_test/deactivate"}}
	if permission := requiredAgentPermission(read); permission != "account.read" {
		t.Fatalf("GET API Orders permission=%q", permission)
	}
	if permission := requiredAgentPermission(write); permission != "api.invoke" {
		t.Fatalf("POST API Orders permission=%q", permission)
	}
}

func TestInvocationArtifactAndLedgerRoutesUseExpectedAgentPermissions(t *testing.T) {
	cases := []struct {
		method string
		path   string
		want   string
	}{
		{method: http.MethodGet, path: "/v4/invocations/inv_test", want: "api.invoke"},
		{method: http.MethodPost, path: "/v4/operation-estimates", want: "market.read"},
		{method: http.MethodPost, path: "/v4/artifacts/art_test/download-grants", want: "api.invoke"},
		{method: http.MethodGet, path: "/v4/ledger", want: "account.read"},
	}
	for _, testCase := range cases {
		request := &http.Request{Method: testCase.method, URL: &url.URL{Path: testCase.path}}
		if permission := requiredAgentPermission(request); permission != testCase.want {
			t.Fatalf("%s %s permission=%q want %q", testCase.method, testCase.path, permission, testCase.want)
		}
	}
}

func TestOperationEditingRemainsOwnerOnly(t *testing.T) {
	request := &http.Request{
		Method: http.MethodPut,
		URL:    &url.URL{Path: "/v4/local/api-drafts/api_test/operations/op_test"},
	}
	if permission := requiredAgentPermission(request); permission != "owner" {
		t.Fatalf("PUT Operation permission=%q want owner", permission)
	}
}

func TestProviderAgentCanCreateDraftAndSubmitContractOnly(t *testing.T) {
	for _, request := range []*http.Request{
		{Method: http.MethodPost, URL: &url.URL{Path: "/v4/local/api-drafts"}},
		{Method: http.MethodPut, URL: &url.URL{Path: "/v4/local/api-drafts/api_test/contract"}},
	} {
		if permission := requiredAgentPermission(request); permission != "provider.integrate" {
			t.Fatalf("%s %s permission=%q want provider.integrate", request.Method, request.URL.Path, permission)
		}
		if scope := requiredScope(request); scope != localauth.ScopeIntegrationAgent {
			t.Fatalf("%s %s scope=%v want integration agent", request.Method, request.URL.Path, scope)
		}
	}
}

func TestOtherPersistentDraftMutationsRemainOwnerOnly(t *testing.T) {
	for _, request := range []*http.Request{
		{Method: http.MethodDelete, URL: &url.URL{Path: "/v4/local/api-drafts/api_test"}},
		{Method: http.MethodPut, URL: &url.URL{Path: "/v4/local/api-drafts/api_test/identity"}},
		{Method: http.MethodPost, URL: &url.URL{Path: "/v4/local/api-drafts/api_test/publish"}},
	} {
		if permission := requiredAgentPermission(request); permission != "owner" {
			t.Fatalf("%s %s permission=%q want owner", request.Method, request.URL.Path, permission)
		}
	}
}
