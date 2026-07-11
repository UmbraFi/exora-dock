package cloudlink

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestWakePollerUsesTypedEndpointsWithoutOwnerProxy(t *testing.T) {
	var mu sync.Mutex
	paths := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer dock-cloud-token" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		mu.Lock()
		paths = append(paths, r.URL.Path)
		mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "/claim") {
			_ = json.NewEncoder(w).Encode(map[string]any{"wakeJob": WakeJob{JobID: "job-1", RunID: "run-1", TargetDockID: "dock", TransactionID: "tx", Role: "seller", LeaseEpoch: 2}})
			return
		}
		if strings.HasSuffix(r.URL.Path, "/complete") {
			var body struct {
				Result WakeResult `json:"result"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.Result.RunID != "run-1" {
				t.Fatalf("complete changed Cloud runId: %#v", body.Result)
			}
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	tokenPath := t.TempDir() + "/cloud-token.json"
	if err := SaveToken(tokenPath, TokenFile{DockID: "dock", CloudURL: server.URL, CloudToken: "dock-cloud-token"}); err != nil {
		t.Fatal(err)
	}
	called := 0
	poller := WakePoller{CloudURL: server.URL, DockID: "dock", WorkerID: "worker", TokenPath: tokenPath, LeaseTTL: time.Minute, Handler: WakeHandlerFunc(func(_ context.Context, job WakeJob) (WakeResult, error) {
		called++
		if job.TransactionID != "tx" || job.RunID != "run-1" {
			t.Fatalf("job = %#v", job)
		}
		return WakeResult{RunID: job.RunID, Status: "running"}, nil
	})}
	found, err := poller.RunOnce(context.Background(), server.Client())
	if err != nil || !found || called != 1 {
		t.Fatalf("found=%v called=%d err=%v", found, called, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(paths) != 2 || paths[0] != "/v2/docks/dock/wake-jobs/claim" || paths[1] != "/v2/docks/dock/wake-jobs/job-1/complete" {
		t.Fatalf("paths = %v", paths)
	}
	for _, path := range paths {
		if strings.Contains(path, "command") || strings.Contains(path, "console") {
			t.Fatalf("generic command route used: %s", path)
		}
	}
}

func TestWakePollerRejectsUntypedPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"method": "POST", "path": "/v1/wallet/unlock"})
	}))
	defer server.Close()
	tokenPath := t.TempDir() + "/cloud-token.json"
	if err := SaveToken(tokenPath, TokenFile{DockID: "dock", CloudURL: server.URL, CloudToken: "dock-cloud-token"}); err != nil {
		t.Fatal(err)
	}
	poller := WakePoller{CloudURL: server.URL, DockID: "dock", TokenPath: tokenPath, Handler: WakeHandlerFunc(func(context.Context, WakeJob) (WakeResult, error) { return WakeResult{}, nil })}
	if _, err := poller.RunOnce(context.Background(), server.Client()); err == nil {
		t.Fatal("expected invalid typed wake job")
	}
}

func TestWakeExpectedVersionIsCanonicalAndCompatIsInboundOnly(t *testing.T) {
	var job WakeJob
	if err := json.Unmarshal([]byte(`{"jobId":"job","transactionId":"tx","role":"seller","expectedVersion":0,"expectedStateVersion":9}`), &job); err != nil {
		t.Fatal(err)
	}
	if job.ExpectedStateVersion != 0 {
		t.Fatalf("canonical expectedVersion did not win: %#v", job)
	}
	if err := json.Unmarshal([]byte(`{"jobId":"job","transactionId":"tx","role":"seller","expectedStateVersion":7}`), &job); err != nil {
		t.Fatal(err)
	}
	if job.ExpectedStateVersion != 7 {
		t.Fatalf("compat expectedStateVersion not accepted: %#v", job)
	}
	encoded, err := json.Marshal(job)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"expectedVersion":7`) || strings.Contains(string(encoded), "expectedStateVersion") {
		t.Fatalf("wake wire fields = %s", encoded)
	}
	job.Payload = map[string]any{"allowedActions": []any{"report_progress", "submit_offer", "report_progress", 7}}
	allowed, present := job.AllowedActions()
	if !present || len(allowed) != 2 || allowed[0] != "report_progress" || allowed[1] != "submit_offer" {
		t.Fatalf("allowed actions = %#v", allowed)
	}
	job.Payload = map[string]any{"allowedActions": []any{}}
	allowed, present = job.AllowedActions()
	if !present || len(allowed) != 0 {
		t.Fatalf("empty authorization snapshot lost: present=%v values=%#v", present, allowed)
	}
}

func TestWakePollerFailsClaimedInvalidTypedJob(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if strings.HasSuffix(r.URL.Path, "/claim") {
			_ = json.NewEncoder(w).Encode(map[string]any{"wakeJob": WakeJob{JobID: "invalid-1", RunID: "run-invalid", TransactionID: "tx", Role: "owner", LeaseEpoch: 4}})
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	tokenPath := t.TempDir() + "/cloud-token.json"
	if err := SaveToken(tokenPath, TokenFile{DockID: "dock", CloudURL: server.URL, CloudToken: "dock-cloud-token"}); err != nil {
		t.Fatal(err)
	}
	poller := WakePoller{CloudURL: server.URL, DockID: "dock", TokenPath: tokenPath, Handler: WakeHandlerFunc(func(context.Context, WakeJob) (WakeResult, error) {
		t.Fatal("invalid job reached handler")
		return WakeResult{}, nil
	})}
	found, err := poller.RunOnce(context.Background(), server.Client())
	if !found || err == nil {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if len(paths) != 2 || paths[1] != "/v2/docks/dock/wake-jobs/invalid-1/fail" {
		t.Fatalf("paths = %v", paths)
	}
}

func TestWakePollerInterruptsHandlerAndFailsJobWhenLeaseRenewalIsLost(t *testing.T) {
	paths := make(chan string, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths <- r.URL.Path
		switch {
		case strings.HasSuffix(r.URL.Path, "/claim"):
			_ = json.NewEncoder(w).Encode(map[string]any{"wakeJob": WakeJob{JobID: "lease-1", RunID: "run-lease", TargetDockID: "dock", TransactionID: "tx", Role: "seller", LeaseEpoch: 5}})
		case strings.HasSuffix(r.URL.Path, "/renew"):
			http.Error(w, "stale epoch", http.StatusConflict)
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer server.Close()
	tokenPath := t.TempDir() + "/cloud-token.json"
	if err := SaveToken(tokenPath, TokenFile{DockID: "dock", CloudURL: server.URL, CloudToken: "dock-cloud-token"}); err != nil {
		t.Fatal(err)
	}
	poller := WakePoller{CloudURL: server.URL, DockID: "dock", TokenPath: tokenPath, LeaseTTL: 30 * time.Millisecond, Handler: WakeHandlerFunc(func(ctx context.Context, _ WakeJob) (WakeResult, error) {
		<-ctx.Done()
		return WakeResult{}, ctx.Err()
	})}
	found, err := poller.RunOnce(context.Background(), server.Client())
	if !found || err == nil || !strings.Contains(err.Error(), "renew returned 409") {
		t.Fatalf("found=%v err=%v", found, err)
	}
	seen := []string{}
	for len(paths) > 0 {
		seen = append(seen, <-paths)
	}
	if len(seen) != 3 || !strings.HasSuffix(seen[1], "/renew") || !strings.HasSuffix(seen[2], "/fail") {
		t.Fatalf("paths = %v", seen)
	}
}
