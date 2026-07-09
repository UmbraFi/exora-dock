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
		{"GET", "/v1/console/snapshot?side=all"},
		{"POST", "/v1/agent/search-sellers"},
		{"GET", "/v1/market/rail-cards"},
		{"GET", "/v1/agent-cards/mine"},
		{"GET", "/v1/agent-cards/search?q=render"},
		{"POST", "/v1/agent-cards/diagnostics"},
		{"POST", "/v1/agent-cards/draft"},
		{"PUT", "/v1/agent-cards/seller"},
		{"POST", "/v1/agent-cards/seller/publish"},
		{"POST", "/v1/agent/runs"},
		{"GET", "/v1/agent/runs"},
		{"GET", "/v1/agent/runs/arun_1"},
		{"POST", "/v1/agent/runs/arun_1/resume"},
		{"POST", "/v1/agent/runs/arun_1/stop"},
		{"POST", "/v1/work-runs"},
		{"GET", "/v1/work-runs"},
		{"GET", "/v1/work-runs/wrun_1"},
		{"GET", "/v1/work-runs/wrun_1/events"},
		{"POST", "/v1/work-runs/wrun_1/resume"},
		{"POST", "/v1/work-runs/wrun_1/stop"},
		{"POST", "/v1/negotiations"},
		{"GET", "/v1/negotiations"},
		{"GET", "/v1/negotiations/nego_1"},
		{"POST", "/v1/negotiations/nego_1/resume"},
		{"POST", "/v1/negotiations/nego_1/cancel"},
		{"POST", "/v1/order-plans/from-negotiations"},
		{"GET", "/v1/payment-pin/status"},
		{"GET", "/v1/payments?approvalId=appr_1"},
		{"POST", "/v1/payments/pay_1/pay-wallet"},
		{"GET", "/v1/order-plans?status=pending_selection"},
		{"GET", "/v1/order-plans/opln_1"},
		{"POST", "/v1/order-plans/opln_1/select"},
		{"POST", "/v1/order-plans/opln_1/submit-provider-job"},
		{"POST", "/v1/order-plans/opln_1/cancel"},
		{"GET", "/v1/settings/buyer-agent"},
		{"PUT", "/v1/settings/buyer-agent"},
		{"GET", "/v1/settings/seller-agent"},
		{"PUT", "/v1/settings/seller-agent"},
		{"GET", "/v1/settings/llm-profiles"},
		{"POST", "/v1/settings/llm-profiles"},
		{"PUT", "/v1/settings/llm-profiles"},
		{"DELETE", "/v1/settings/llm-profiles"},
		{"POST", "/v1/settings/llm-profiles/test"},
		{"GET", "/v1/settings/llm-profiles/models"},
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
		{"POST", "/v1/wallet/bind"},
		{"POST", "/v1/payments/pay_1/direct-intent"},
		{"POST", "/v1/payment-pin/set"},
		{"POST", "/v1/dispute-evidence"},
		{"POST", "/v1/order-plans"},
		{"DELETE", "/v1/agent/runs/arun_1"},
		{"POST", "/v1/tasks/task_1/consent"},
		{"POST", "/v1/provider/tasks/task_1/run"},
		{"GET", "/v1/tasks/task_1/artifacts/output.zip"},
		{"POST", "/v1/agent-cards/seller/credentials"},
		{"POST", "/v1/settings/payment-pin/set"},
	}
	for _, tc := range blocked {
		if Allowed(tc.method, tc.path) {
			t.Fatalf("expected %s %s to be blocked", tc.method, tc.path)
		}
	}
}
