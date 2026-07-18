package providerworker

import (
	"errors"
	"os"
	"strings"
	"time"
)

func (s Server) leaseTransferReview(input map[string]any) (map[string]any, error) {
	direction := strings.ToLower(strings.TrimSpace(stringValue(input["direction"])))
	sizeBytes := workerInt64(input["sizeBytes"])
	if direction != "upload" && direction != "download" {
		return nil, errors.New("provider_local_policy_rejected: invalid transfer direction")
	}
	if sizeBytes < 0 || sizeBytes > 1<<50 {
		return nil, errors.New("provider_local_policy_rejected: invalid transfer size")
	}
	if strings.TrimSpace(stringValue(input["policyVersion"])) != "isolated_control_p2p_v1" {
		return nil, errors.New("provider_local_policy_rejected: unsupported transfer policy")
	}
	if raw := strings.TrimSpace(stringValue(input["expiresAt"])); raw != "" {
		expiresAt, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil || !expiresAt.After(time.Now()) {
			return nil, errors.New("transfer_expired")
		}
	}
	root, err := s.leaseWorkspaceRoot(input)
	if err != nil {
		return nil, err
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return nil, errors.New("provider_local_policy_rejected: workspace is unavailable")
	}
	return map[string]any{"approved": true, "policyVersion": "isolated_control_p2p_v1", "reviewedAt": time.Now().UTC()}, nil
}

func stringValue(value any) string {
	valueString, _ := value.(string)
	return valueString
}
