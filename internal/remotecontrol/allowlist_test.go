package remotecontrol

import "testing"

func TestAllowedBlocksSensitiveRemoteDownloads(t *testing.T) {
	allowed := []struct {
		method string
		path   string
	}{
		{"GET", "/health"},
		{"GET", "/v1/approvals?status=pending"},
		{"POST", "/v1/approvals/appr_1/decide"},
		{"GET", "/v1/tasks/task_1/artifacts"},
		{"GET", "/v1/resources?type=gpu"},
		{"GET", "/v1/wallet"},
		{"GET", "/v1/dispute-evidence?taskId=task_1"},
		{"POST", "/v1/agent/search-sellers"},
		{"POST", "/v1/agent/runs"},
		{"GET", "/v1/agent/runs"},
		{"GET", "/v1/agent/runs/arun_1"},
		{"POST", "/v1/agent/runs/arun_1/resume"},
		{"POST", "/v1/agent/runs/arun_1/stop"},
		{"POST", "/v1/negotiations"},
		{"GET", "/v1/negotiations"},
		{"GET", "/v1/negotiations/nego_1"},
		{"POST", "/v1/negotiations/nego_1/resume"},
		{"POST", "/v1/negotiations/nego_1/cancel"},
		{"POST", "/v1/order-plans/from-negotiations"},
		{"GET", "/v1/payment-pin/status"},
		{"GET", "/v1/payments?approvalId=appr_1"},
		{"GET", "/v1/order-plans?status=pending_selection"},
		{"GET", "/v1/order-plans/opln_1"},
		{"POST", "/v1/order-plans/opln_1/select"},
		{"POST", "/v1/order-plans/opln_1/cancel"},
	}
	for _, tc := range allowed {
		if !Allowed(tc.method, tc.path) {
			t.Fatalf("expected %s %s to be allowed", tc.method, tc.path)
		}
	}

	blocked := []struct {
		method string
		path   string
	}{
		{"GET", "/v1/tasks/task_1/artifacts/output.zip"},
		{"GET", "/v1/leases/lease_1/credentials"},
		{"POST", "/v1/wallet/create"},
		{"POST", "/v1/payment-pin/set"},
		{"POST", "/v1/dispute-evidence"},
		{"POST", "/v1/order-plans"},
		{"DELETE", "/v1/agent/runs/arun_1"},
		{"POST", "/v1/tasks/task_1/consent"},
		{"POST", "/v1/provider/tasks/task_1/run"},
	}
	for _, tc := range blocked {
		if Allowed(tc.method, tc.path) {
			t.Fatalf("expected %s %s to be blocked", tc.method, tc.path)
		}
	}
}
