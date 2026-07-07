package remotecontrol

import (
	"net/http"
	"strings"
)

func Allowed(method string, path string) bool {
	method = strings.ToUpper(strings.TrimSpace(method))
	path = cleanPath(path)
	if path == "/health" || path == "/.well-known/exora-dock.json" {
		return method == http.MethodGet
	}
	if !strings.HasPrefix(path, "/v1/") {
		return false
	}
	if strings.Contains(path, "/credentials") ||
		strings.Contains(path, "/wallet/create") ||
		strings.Contains(path, "/payment-pin/set") ||
		strings.Contains(path, "/ipfs/") {
		return false
	}
	if strings.HasPrefix(path, "/v1/wallet") {
		return method == http.MethodGet
	}
	if path == "/v1/dispute-evidence" {
		return method == http.MethodGet
	}
	if path == "/v1/agent/search-sellers" {
		return method == http.MethodPost
	}
	if negotiationAllowed(method, path) {
		return true
	}
	if agentRunAllowed(method, path) {
		return true
	}
	if taskAllowed(method, path) || approvalAllowed(method, path) {
		return true
	}
	if orderPlanAllowed(method, path) {
		return true
	}
	if paymentAllowed(method, path) {
		return true
	}
	if strings.HasPrefix(path, "/v1/resources") ||
		strings.HasPrefix(path, "/v1/leases") ||
		strings.HasPrefix(path, "/v1/delegations") ||
		strings.HasPrefix(path, "/v1/products") ||
		strings.HasPrefix(path, "/v1/orders") {
		return method == http.MethodGet || method == http.MethodPost || method == http.MethodDelete
	}
	return false
}

func negotiationAllowed(method string, path string) bool {
	if path == "/v1/negotiations" {
		return method == http.MethodGet || method == http.MethodPost
	}
	if path == "/v1/order-plans/from-negotiations" {
		return method == http.MethodPost
	}
	if !strings.HasPrefix(path, "/v1/negotiations/") {
		return false
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 3 {
		return method == http.MethodGet
	}
	return len(parts) == 4 && (parts[3] == "resume" || parts[3] == "cancel") && method == http.MethodPost
}

func agentRunAllowed(method string, path string) bool {
	if path == "/v1/agent/runs" {
		return method == http.MethodGet || method == http.MethodPost
	}
	if !strings.HasPrefix(path, "/v1/agent/runs/") {
		return false
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 4 {
		return method == http.MethodGet
	}
	return len(parts) == 5 && (parts[4] == "resume" || parts[4] == "stop") && method == http.MethodPost
}

func cleanPath(path string) string {
	path = strings.TrimSpace(path)
	if before, _, ok := strings.Cut(path, "?"); ok {
		path = before
	}
	return path
}

func taskAllowed(method string, path string) bool {
	if path == "/v1/tasks" {
		return method == http.MethodGet || method == http.MethodPost
	}
	if path == "/v1/provider/tasks/next" {
		return method == http.MethodGet
	}
	if !strings.HasPrefix(path, "/v1/tasks/") {
		return false
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 3 {
		return method == http.MethodGet
	}
	if len(parts) != 4 {
		return false
	}
	switch parts[3] {
	case "artifacts", "events":
		return method == http.MethodGet
	case "quote", "claim", "complete", "fail":
		return method == http.MethodPost
	default:
		return false
	}
}

func approvalAllowed(method string, path string) bool {
	if path == "/v1/approvals" {
		return method == http.MethodGet || method == http.MethodPost
	}
	if !strings.HasPrefix(path, "/v1/approvals/") {
		return false
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 3 {
		return method == http.MethodGet
	}
	return len(parts) == 4 && parts[3] == "decide" && method == http.MethodPost
}

func orderPlanAllowed(method string, path string) bool {
	if path == "/v1/order-plans" {
		return method == http.MethodGet
	}
	if !strings.HasPrefix(path, "/v1/order-plans/") {
		return false
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 3 {
		return method == http.MethodGet
	}
	return len(parts) == 4 && (parts[3] == "select" || parts[3] == "cancel") && method == http.MethodPost
}

func paymentAllowed(method string, path string) bool {
	if path == "/v1/payment-pin/status" {
		return method == http.MethodGet
	}
	if path == "/v1/payments" {
		return method == http.MethodGet
	}
	if !strings.HasPrefix(path, "/v1/payments/") {
		return false
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 3 {
		return method == http.MethodGet
	}
	if len(parts) == 4 && parts[3] == "evidence" {
		return method == http.MethodGet
	}
	if len(parts) == 4 && parts[3] == "pay-wallet" {
		return method == http.MethodPost
	}
	return len(parts) == 5 && parts[3] == "chain" && (parts[4] == "intent" || parts[4] == "evidence") && method == http.MethodPost
}
