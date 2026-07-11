package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/localauth"
	"github.com/exora-dock/exora-dock/internal/runcapability"
	"github.com/exora-dock/exora-dock/internal/supervisor"
)

func TestRunCapabilityIsNarrowAndOwnerCloudRoutesStayOwnerOnly(t *testing.T) {
	dir := t.TempDir()
	c, err := cache.New(128, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	auth, err := localauth.LoadOrCreate(filepath.Join(dir, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	caps := runcapability.NewEphemeral([]byte("v2-auth-test-secret-with-thirty-two-bytes"))
	runs := supervisor.NewStore(c)
	run, _, err := runs.Create(supervisor.CreateRequest{TransactionID: "tx-1", Role: "seller", ExpectedStateVersion: 3, IdempotencyKey: "wake-1"})
	if err != nil {
		t.Fatal(err)
	}
	run, err = runs.Claim(supervisor.ClaimRequest{RunID: run.RunID, WorkerID: "dock", LeaseTTL: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	other, _, err := runs.Create(supervisor.CreateRequest{TransactionID: "tx-2", Role: "seller", ExpectedStateVersion: 3, IdempotencyKey: "wake-2"})
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := caps.Issue(runcapability.Claims{
		RunID: run.RunID, TransactionID: run.TransactionID, Role: run.Role,
		Actions: []string{"claim_run", "report_progress"}, LeaseEpoch: run.Lease.Epoch,
	}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	cloudCalls := 0
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cloudCalls++
		if r.Header.Get("Authorization") != "Bearer dock-cloud-token" {
			t.Fatalf("cloud authorization = %q", r.Header.Get("Authorization"))
		}
		if r.Method == http.MethodPost && r.URL.Path == "/v2/transactions/tx-1/agent-events" {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["type"] != "report_progress" {
				t.Fatalf("agent event = %#v", body)
			}
			expectedStateVersion, ok := body["expectedStateVersion"].(float64)
			if !ok || (expectedStateVersion != 3 && expectedStateVersion != 4) {
				t.Fatalf("expectedStateVersion = %#v in %#v", body["expectedStateVersion"], body)
			}
			if _, exists := body["expectedVersion"]; exists {
				t.Fatalf("agent event advertised WakeJob-only expectedVersion: %#v", body)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"transaction": map[string]any{"version": int64(expectedStateVersion) + 1}})
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/v2/transactions" {
			_ = json.NewEncoder(w).Encode(map[string]any{"transactions": []any{}})
			return
		}
		http.NotFound(w, r)
	}))
	defer cloud.Close()
	tokenPath := filepath.Join(dir, "cloud-token.json")
	if err := cloudlink.SaveToken(tokenPath, cloudlink.TokenFile{DockID: "dock", CloudURL: cloud.URL, CloudToken: "dock-cloud-token"}); err != nil {
		t.Fatal(err)
	}

	router := New(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "dock", RuntimeStores{
		Auth: auth, AutomationRuns: runs, RunCapabilities: caps, CloudURL: cloud.URL, CloudTokenPath: tokenPath,
	})

	valid := authReq(http.MethodPost, "/v1/automation-runs/"+run.RunID+"/actions", `{"type":"report_progress","expectedStateVersion":3,"idempotencyKey":"progress-1","payload":{"message":"working"}}`, token)
	validRec := httptest.NewRecorder()
	router.ServeHTTP(validRec, valid)
	if validRec.Code != http.StatusOK {
		t.Fatalf("valid capability status=%d body=%s", validRec.Code, validRec.Body.String())
	}
	var validBody struct {
		AutomationRun supervisor.AutomationRun `json:"automationRun"`
		Duplicate     bool                     `json:"duplicate"`
	}
	if err := json.Unmarshal(validRec.Body.Bytes(), &validBody); err != nil || validBody.AutomationRun.ExpectedStateVersion != 4 || validBody.Duplicate {
		t.Fatalf("valid capability response=%s err=%v", validRec.Body.String(), err)
	}

	replay := authReq(http.MethodPost, "/v1/automation-runs/"+run.RunID+"/actions", `{"type":"report_progress","expectedStateVersion":3,"idempotencyKey":"progress-1","payload":{"message":"working"}}`, token)
	replayRec := httptest.NewRecorder()
	router.ServeHTTP(replayRec, replay)
	if replayRec.Code != http.StatusOK {
		t.Fatalf("replayed capability status=%d body=%s", replayRec.Code, replayRec.Body.String())
	}
	var replayBody struct {
		AutomationRun supervisor.AutomationRun `json:"automationRun"`
		Duplicate     bool                     `json:"duplicate"`
	}
	if err := json.Unmarshal(replayRec.Body.Bytes(), &replayBody); err != nil || replayBody.AutomationRun.ExpectedStateVersion != 4 || !replayBody.Duplicate {
		t.Fatalf("replayed capability response=%s err=%v", replayRec.Body.String(), err)
	}

	followup := authReq(http.MethodPost, "/v1/automation-runs/"+run.RunID+"/actions", `{"type":"report_progress","expectedStateVersion":4,"idempotencyKey":"progress-2","payload":{"message":"still working"}}`, token)
	followupRec := httptest.NewRecorder()
	router.ServeHTTP(followupRec, followup)
	if followupRec.Code != http.StatusOK {
		t.Fatalf("follow-up capability status=%d body=%s", followupRec.Code, followupRec.Body.String())
	}
	var followupBody struct {
		AutomationRun supervisor.AutomationRun `json:"automationRun"`
	}
	if err := json.Unmarshal(followupRec.Body.Bytes(), &followupBody); err != nil || followupBody.AutomationRun.ExpectedStateVersion != 5 {
		t.Fatalf("follow-up capability response=%s err=%v", followupRec.Body.String(), err)
	}

	missing := authReq(http.MethodPost, "/v1/automation-runs/"+run.RunID+"/actions", `{"type":"report_progress","expectedStateVersion":3}`, token)
	missingRec := httptest.NewRecorder()
	router.ServeHTTP(missingRec, missing)
	if missingRec.Code != http.StatusBadRequest {
		t.Fatalf("missing mutation fields status=%d body=%s", missingRec.Code, missingRec.Body.String())
	}

	wrongRun := authReq(http.MethodPost, "/v1/automation-runs/"+other.RunID+"/actions", `{"type":"report_progress","expectedStateVersion":3,"idempotencyKey":"wrong"}`, token)
	wrongRunRec := httptest.NewRecorder()
	router.ServeHTTP(wrongRunRec, wrongRun)
	if wrongRunRec.Code != http.StatusForbidden {
		t.Fatalf("cross-run capability status=%d body=%s", wrongRunRec.Code, wrongRunRec.Body.String())
	}

	cancel := authReq(http.MethodPost, "/v1/automation-runs/"+run.RunID+"/cancel", `{}`, token)
	cancelRec := httptest.NewRecorder()
	router.ServeHTTP(cancelRec, cancel)
	if cancelRec.Code != http.StatusForbidden {
		t.Fatalf("capability cancel status=%d body=%s", cancelRec.Code, cancelRec.Body.String())
	}

	cloudWithRunToken := authReq(http.MethodGet, "/v1/cloud/transactions", "", token)
	cloudWithRunTokenRec := httptest.NewRecorder()
	router.ServeHTTP(cloudWithRunTokenRec, cloudWithRunToken)
	if cloudWithRunTokenRec.Code != http.StatusUnauthorized {
		t.Fatalf("run token reached owner Cloud proxy: %d %s", cloudWithRunTokenRec.Code, cloudWithRunTokenRec.Body.String())
	}

	cloudWithOwner := authReq(http.MethodGet, "/v1/cloud/transactions", "", auth.OwnerToken())
	cloudWithOwnerRec := httptest.NewRecorder()
	router.ServeHTTP(cloudWithOwnerRec, cloudWithOwner)
	if cloudWithOwnerRec.Code != http.StatusOK || !strings.Contains(cloudWithOwnerRec.Body.String(), "transactions") {
		t.Fatalf("owner Cloud proxy status=%d body=%s", cloudWithOwnerRec.Code, cloudWithOwnerRec.Body.String())
	}
	if cloudCalls != 4 {
		t.Fatalf("cloud calls=%d, want three agent events plus owner read", cloudCalls)
	}

	legacyProduct := authReq(http.MethodGet, "/v1/products", "", auth.OwnerToken())
	legacyProductRec := httptest.NewRecorder()
	router.ServeHTTP(legacyProductRec, legacyProduct)
	if legacyProductRec.Code != http.StatusNotFound {
		t.Fatalf("legacy product market exposed by V2 default: %d %s", legacyProductRec.Code, legacyProductRec.Body.String())
	}
}
