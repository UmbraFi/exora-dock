package providerworker

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var DefaultSocket = defaultWorkerEndpoint

type Request struct {
	ID      string         `json:"id"`
	Command string         `json:"command"`
	Input   map[string]any `json:"input,omitempty"`
}
type Response struct {
	ID     string         `json:"id"`
	OK     bool           `json:"ok"`
	Result map[string]any `json:"result,omitempty"`
	Error  string         `json:"error,omitempty"`
}

type Client struct{ Socket string }

func (c Client) Call(ctx context.Context, command string, input map[string]any) (map[string]any, error) {
	socket := c.Socket
	if socket == "" {
		socket = DefaultSocket
	}
	conn, err := dialWorker(ctx, socket)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Minute))
	id := fmt.Sprintf("cmd-%d", time.Now().UnixNano())
	if err := json.NewEncoder(conn).Encode(Request{ID: id, Command: command, Input: input}); err != nil {
		return nil, err
	}
	var out Response
	if err := json.NewDecoder(bufio.NewReader(conn)).Decode(&out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, fmt.Errorf("%s", out.Error)
	}
	return out.Result, nil
}

type Runner interface {
	Run(context.Context, string, ...string) (string, error)
}

var AllowedCommands = map[string]bool{
	"probe_host": true, "list_domains": true, "import_template": true, "validate_template": true,
	"reserve_disk": true, "capacity_check": true, "create_test_clone": true, "reset_test_clone": true, "delete_template": true,
	"release_disk":  true,
	"probe_runtime": true, "list_environment_images": true, "import_environment_image": true,
	"validate_environment_image": true, "delete_environment_image": true,
	"lease_recheck": true, "provision_lease": true, "renew_lease_epoch": true, "reset_lease": true,
	"lease_ssh_target": true,
}

type cachedWorkerCommand struct {
	Command     string         `json:"command"`
	Fingerprint string         `json:"fingerprint"`
	Result      map[string]any `json:"result,omitempty"`
	Error       string         `json:"error,omitempty"`
}

var workerCommandMu sync.Mutex

func persistentWorkerCommand(dataDir, command string, input map[string]any, execute func() (map[string]any, error)) (map[string]any, error) {
	id, _ := input["commandId"].(string)
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("commandId is required")
	}
	for _, r := range id {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("._-", r)) {
			return nil, fmt.Errorf("invalid commandId")
		}
	}
	if raw, _ := input["deadline"].(string); raw != "" {
		deadline, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil || time.Now().After(deadline) {
			return nil, fmt.Errorf("control command deadline has expired")
		}
	}
	workerCommandMu.Lock()
	defer workerCommandMu.Unlock()
	fingerprintRaw, _ := json.Marshal(input)
	fingerprintSum := sha256.Sum256(fingerprintRaw)
	fingerprint := hex.EncodeToString(fingerprintSum[:])
	directory := filepath.Join(dataDir, "commands")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(directory, id+".json")
	if raw, err := os.ReadFile(path); err == nil {
		var cached cachedWorkerCommand
		if json.Unmarshal(raw, &cached) != nil || cached.Command != command || cached.Fingerprint != fingerprint {
			return nil, fmt.Errorf("commandId reused with different command input")
		}
		if cached.Error != "" {
			return nil, fmt.Errorf("%s", cached.Error)
		}
		return cached.Result, nil
	}
	if err := validateWorkerLeaseEpoch(dataDir, command, input); err != nil {
		return nil, err
	}
	result, err := execute()
	if err == nil {
		if epochErr := commitWorkerLeaseEpoch(dataDir, command, input); epochErr != nil {
			err = epochErr
		}
	}
	record := cachedWorkerCommand{Command: command, Fingerprint: fingerprint, Result: result}
	if err != nil {
		record.Error = err.Error()
	}
	raw, _ := json.Marshal(record)
	temporary := path + ".tmp"
	if writeErr := os.WriteFile(temporary, raw, 0600); writeErr == nil {
		_ = os.Rename(temporary, path)
	}
	return result, err
}

func workerLeaseEpochPath(dataDir, leaseID string) (string, error) {
	leaseID = strings.TrimSpace(leaseID)
	if leaseID == "" {
		return "", fmt.Errorf("leaseId is required")
	}
	for _, r := range leaseID {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("._-", r)) {
			return "", fmt.Errorf("invalid leaseId")
		}
	}
	return filepath.Join(dataDir, "lease-epochs", leaseID+".epoch"), nil
}

func workerLeaseEpoch(input map[string]any) int64 {
	switch value := input["leaseEpoch"].(type) {
	case int64:
		return value
	case int:
		return int64(value)
	case float64:
		return int64(value)
	case json.Number:
		epoch, _ := value.Int64()
		return epoch
	}
	return 0
}

func currentWorkerLeaseEpoch(path string) int64 {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	var epoch int64
	_, _ = fmt.Sscan(strings.TrimSpace(string(raw)), &epoch)
	return epoch
}

func validateWorkerLeaseEpoch(dataDir, command string, input map[string]any) error {
	if command != "provision_lease" && command != "renew_lease_epoch" && command != "reset_lease" {
		return nil
	}
	path, err := workerLeaseEpochPath(dataDir, fmt.Sprint(input["leaseId"]))
	if err != nil {
		return err
	}
	epoch := workerLeaseEpoch(input)
	if epoch <= 0 {
		return fmt.Errorf("positive leaseEpoch is required")
	}
	current := currentWorkerLeaseEpoch(path)
	switch command {
	case "provision_lease":
		if current > 0 && epoch <= current {
			return fmt.Errorf("stale leaseEpoch")
		}
	case "renew_lease_epoch":
		if current <= 0 || epoch != current+1 {
			return fmt.Errorf("leaseEpoch must advance by one")
		}
	case "reset_lease":
		if current > 0 && epoch < current {
			return fmt.Errorf("stale leaseEpoch")
		}
	}
	return nil
}

func commitWorkerLeaseEpoch(dataDir, command string, input map[string]any) error {
	if command != "provision_lease" && command != "renew_lease_epoch" && command != "reset_lease" {
		return nil
	}
	path, err := workerLeaseEpochPath(dataDir, fmt.Sprint(input["leaseId"]))
	if err != nil {
		return err
	}
	if command == "reset_lease" {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, []byte(fmt.Sprint(workerLeaseEpoch(input))), 0600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

func handleConnection(ctx context.Context, c io.ReadWriteCloser, dispatch func(context.Context, string, map[string]any) (map[string]any, error), audit func(string, bool, string)) {
	defer c.Close()
	var req Request
	if json.NewDecoder(bufio.NewReader(io.LimitReader(c, 1<<20))).Decode(&req) != nil {
		return
	}
	out := Response{ID: req.ID}
	if !AllowedCommands[req.Command] {
		out.Error = "unsupported command"
	} else if result, err := dispatch(ctx, req.Command, req.Input); err != nil {
		out.Error = err.Error()
	} else {
		out.OK = true
		out.Result = result
	}
	if audit != nil {
		audit(req.Command, out.OK, out.Error)
	}
	_ = json.NewEncoder(c).Encode(out)
}
