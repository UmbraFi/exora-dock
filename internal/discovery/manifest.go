package discovery

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	SchemaURL       = "https://exora.dev/schemas/dock-agent-manifest.v1.json"
	ProtocolVersion = "exora-dock-discovery/v1"
	FileName        = "agent-discovery.json"
)

type Manifest struct {
	Schema          string              `json:"schema"`
	ProtocolVersion string              `json:"protocolVersion"`
	Name            string              `json:"name"`
	Kind            string              `json:"kind"`
	DockID          string              `json:"dockId"`
	BaseURL         string              `json:"baseUrl"`
	HealthURL       string              `json:"healthUrl"`
	ManifestURL     string              `json:"manifestUrl"`
	ProcessID       int                 `json:"processId,omitempty"`
	ExecutablePath  string              `json:"executablePath,omitempty"`
	ConfigPath      string              `json:"configPath,omitempty"`
	StartCommand    []string            `json:"startCommand,omitempty"`
	MCPCommand      []string            `json:"mcpCommand,omitempty"`
	AgentPrompt     string              `json:"agentPrompt,omitempty"`
	OpenCodeConfig  map[string]any      `json:"opencodeConfig,omitempty"`
	RESTFallback    map[string]any      `json:"restFallback,omitempty"`
	DiscoveryFiles  []string            `json:"discoveryFiles,omitempty"`
	Capabilities    []Capability        `json:"capabilities"`
	Endpoints       map[string]Endpoint `json:"endpoints"`
	LastSeen        string              `json:"lastSeen"`
}

type Capability struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type Endpoint struct {
	Method      string            `json:"method"`
	Path        string            `json:"path"`
	URL         string            `json:"url"`
	Description string            `json:"description"`
	Query       map[string]string `json:"query,omitempty"`
}

func Build(listenAddr string, dockID string) Manifest {
	return BuildWithBaseURL(BaseURL(listenAddr), dockID)
}

func BuildWithBaseURL(baseURL string, dockID string) Manifest {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8080"
	}
	executable, _ := os.Executable()
	if strings.TrimSpace(dockID) == "" {
		dockID = "local"
	}
	mcp := mcpCommand(executable)

	return Manifest{
		Schema:          SchemaURL,
		ProtocolVersion: ProtocolVersion,
		Name:            "Exora Dock",
		Kind:            "local-capability-dock",
		DockID:          dockID,
		BaseURL:         baseURL,
		HealthURL:       baseURL + "/health",
		ManifestURL:     baseURL + "/.well-known/exora-dock.json",
		ProcessID:       os.Getpid(),
		ExecutablePath:  executable,
		StartCommand:    startCommand(executable),
		MCPCommand:      mcp,
		AgentPrompt:     AgentPrompt(),
		OpenCodeConfig:  OpenCodeConfig(mcp),
		RESTFallback:    RESTFallback(baseURL),
		Capabilities: []Capability{
			{
				Name:        "mcp.stdio",
				Description: "Default local agent entrypoint. Launch this Dock as a stdio MCP server with exora-dock mcp.",
			},
			{
				Name:        "resources.search",
				Description: "Search local Exora Dock resource listings for rentable compute, GPU, VPS, datasets, repositories, projects, and storage.",
			},
			{
				Name:        "task_flow.server_to_docker",
				Description: "Start and resume end-to-end server-to-Docker flows with realtime provider quote requests, user approval, Docker execution, and artifacts.",
			},
			{
				Name:        "agent.runtime",
				Description: "Run resumable Exora buyer/seller/verifier agents for Agent Card search, task flow coordination, approvals, order plans, and artifacts.",
			},
			{
				Name:        "agent_cards.search",
				Description: "Read local Agent Cards and search published Exora Agent Cards before falling back to resource offers.",
			},
			{
				Name:        "provider.docker",
				Description: "Provider-side Docker quote and job protocol. Docker execution is disabled until the provider explicitly enables a white-listed image policy.",
			},
			{
				Name:        "tasks.create",
				Description: "Create capability task drafts that can move through quote, approval, execution, artifact, and resume states.",
			},
			{
				Name:        "approvals.queue",
				Description: "Create and inspect human approval requests for sensitive agent actions.",
			},
			{
				Name:        "delegations.create",
				Description: "Create bounded authority for an agent to lease resources under user limits.",
			},
			{
				Name:        "leases.create",
				Description: "Create and inspect leases for approved resources.",
			},
		},
		Endpoints: map[string]Endpoint{
			"health": {
				Method:      "GET",
				Path:        "/health",
				URL:         baseURL + "/health",
				Description: "Check whether this local Exora Dock is online.",
			},
			"manifest": {
				Method:      "GET",
				Path:        "/.well-known/exora-dock.json",
				URL:         baseURL + "/.well-known/exora-dock.json",
				Description: "Fetch this machine-readable discovery manifest.",
			},
			"mcp.stdio": {
				Method:      "STDIO",
				Path:        "",
				URL:         "",
				Description: "Launch the MCP server with the manifest mcpCommand. REST endpoints are fallback/debug surfaces.",
			},
			"resources.search": {
				Method:      "GET",
				Path:        "/v1/resources",
				URL:         baseURL + "/v1/resources",
				Description: "Search agent-leaseable resources. For GPU VRAM searches, use type=gpu&minVramGb=<GB>.",
				Query: map[string]string{
					"type":        "Optional resource type: vps, gpu, dataset, repository, project, or storage.",
					"q":           "Optional free-text query across name, summary, description, tags, provider, and specs.",
					"provider":    "Optional provider public key or provider id.",
					"region":      "Optional region filter matching spec.region.",
					"minVramGb":   "Optional integer minimum GPU VRAM in GB.",
					"minGpuCount": "Optional integer minimum GPU count.",
				},
			},
			"resource.detail": {
				Method:      "GET",
				Path:        "/v1/resources/{id}",
				URL:         baseURL + "/v1/resources/{id}",
				Description: "Fetch a single resource listing by id.",
			},
			"tasks.create": {
				Method:      "POST",
				Path:        "/v1/tasks",
				URL:         baseURL + "/v1/tasks",
				Description: "Create a task draft for a remote capability job.",
			},
			"task_flow.start": {
				Method:      "POST",
				Path:        "/v1/agent/search-sellers",
				URL:         baseURL + "/v1/agent/search-sellers",
				Description: "Start a task flow by posting requireRealtimeQuotes=true, createSelectionRequest=true, and a taskTemplate with Docker settings under requirements.docker.",
			},
			"agent_runs.create": {
				Method:      "POST",
				Path:        "/v1/agent/runs",
				URL:         baseURL + "/v1/agent/runs",
				Description: "Start a resumable owner-scoped Exora Agent run from a natural-language intent.",
			},
			"agent_runs.list": {
				Method:      "GET",
				Path:        "/v1/agent/runs",
				URL:         baseURL + "/v1/agent/runs",
				Description: "List resumable Exora Agent runs.",
			},
			"negotiations.create": {
				Method:      "POST",
				Path:        "/v1/negotiations",
				URL:         baseURL + "/v1/negotiations",
				Description: "Start signed buyer-to-seller discussion requests so seller agents can quote or reject before an order is created.",
			},
			"negotiations.list": {
				Method:      "GET",
				Path:        "/v1/negotiations",
				URL:         baseURL + "/v1/negotiations",
				Description: "List pre-order seller negotiations and their quote/rejection status.",
			},
			"order_plans.from_negotiations": {
				Method:      "POST",
				Path:        "/v1/order-plans/from-negotiations",
				URL:         baseURL + "/v1/order-plans/from-negotiations",
				Description: "Create a pending seller-selection order plan from quoted negotiations. This does not select, approve, or pay.",
			},
			"agent_cards.mine": {
				Method:      "GET",
				Path:        "/v1/agent-cards/mine",
				URL:         baseURL + "/v1/agent-cards/mine",
				Description: "Read local buyer/seller Agent Cards and safe diagnostics summary.",
			},
			"agent_cards.search": {
				Method:      "GET",
				Path:        "/v1/agent-cards/search",
				URL:         baseURL + "/v1/agent-cards/search",
				Description: "Search published Agent Cards through Cloud when configured, with local fallback.",
			},
			"order_plans.list": {
				Method:      "GET",
				Path:        "/v1/order-plans",
				URL:         baseURL + "/v1/order-plans",
				Description: "List durable task-flow/order-plan records, including realtime candidate states and progress events.",
			},
			"order_plans.detail": {
				Method:      "GET",
				Path:        "/v1/order-plans/{id}",
				URL:         baseURL + "/v1/order-plans/{id}",
				Description: "Fetch one task-flow/order-plan record.",
			},
			"provider.quote_requests": {
				Method:      "POST",
				Path:        "/v1/provider/quote-requests",
				URL:         baseURL + "/v1/provider/quote-requests",
				Description: "Provider endpoint for signed realtime Docker quote requests from buyer Docks.",
			},
			"provider.negotiations": {
				Method:      "POST",
				Path:        "/v1/provider/negotiations",
				URL:         baseURL + "/v1/provider/negotiations",
				Description: "Provider endpoint for signed buyer discussion requests that seller agents can quote or reject.",
			},
			"provider.jobs": {
				Method:      "POST",
				Path:        "/v1/provider/jobs",
				URL:         baseURL + "/v1/provider/jobs",
				Description: "Provider endpoint for signed approved Docker job submissions.",
			},
			"provider.job_status": {
				Method:      "GET",
				Path:        "/v1/provider/jobs/{id}",
				URL:         baseURL + "/v1/provider/jobs/{id}",
				Description: "Read provider-side Docker job status.",
			},
			"tasks.status": {
				Method:      "GET",
				Path:        "/v1/tasks/{id}",
				URL:         baseURL + "/v1/tasks/{id}",
				Description: "Read a task/order ledger entry for status and resume context.",
			},
			"tasks.artifact_manifest": {
				Method:      "GET",
				Path:        "/v1/tasks/{id}/artifacts",
				URL:         baseURL + "/v1/tasks/{id}/artifacts",
				Description: "Fetch artifact metadata for a completed task.",
			},
			"approvals.create": {
				Method:      "POST",
				Path:        "/v1/approvals",
				URL:         baseURL + "/v1/approvals",
				Description: "Create a human approval request for a task action.",
			},
			"approvals.list": {
				Method:      "GET",
				Path:        "/v1/approvals",
				URL:         baseURL + "/v1/approvals",
				Description: "List approval requests, optionally filtered by status, user, agent, or task.",
			},
			"delegations.create": {
				Method:      "POST",
				Path:        "/v1/delegations",
				URL:         baseURL + "/v1/delegations",
				Description: "Create a user-approved delegation envelope for an agent.",
			},
			"leases.create": {
				Method:      "POST",
				Path:        "/v1/leases",
				URL:         baseURL + "/v1/leases",
				Description: "Lease a resource under an existing delegation envelope.",
			},
		},
		LastSeen: time.Now().UTC().Format(time.RFC3339),
	}
}

func AgentPrompt() string {
	return "Find my local Exora Dock by reading %LOCALAPPDATA%\\ExoraDock\\agent-discovery.json, start the stdio MCP server from mcpCommand, then use its Exora tools instead of guessing HTTP endpoints. For concrete buyer work, use exora.run_buyer_work first: it searches suitable seller agents, negotiates with the best candidates, creates an owner-selectable plan from quoted sellers, and then stops for owner choice. If a prompt includes workUid, include that workUid on every related Exora MCP call. Continue with resume_negotiation / create_order_plan_from_quote / resume_task_flow as nextAction requires; do not make the user prompt each step. Never approve, select, pay, reveal credentials, or call Docker directly. Use baseUrl REST only as fallback."
}

func OpenCodeConfig(command []string) map[string]any {
	return map[string]any{
		"$schema": "https://opencode.ai/config.json",
		"mcp": map[string]any{
			"exora": map[string]any{
				"type":    "local",
				"command": command,
				"enabled": true,
			},
		},
	}
}

func RESTFallback(baseURL string) map[string]any {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8080"
	}
	return map[string]any{
		"baseUrl":  baseURL,
		"health":   baseURL + "/health",
		"manifest": baseURL + "/.well-known/exora-dock.json",
	}
}

func BaseURL(listenAddr string) string {
	listenAddr = strings.TrimSpace(listenAddr)
	if listenAddr == "" {
		return "http://127.0.0.1:8080"
	}
	if strings.HasPrefix(listenAddr, "http://") || strings.HasPrefix(listenAddr, "https://") {
		return strings.TrimRight(listenAddr, "/")
	}
	if !strings.Contains(listenAddr, ":") {
		return "http://127.0.0.1:" + listenAddr
	}
	host, port, err := net.SplitHostPort(listenAddr)
	if err == nil {
		return fmt.Sprintf("http://%s:%s", localHost(host), port)
	}
	if strings.HasPrefix(listenAddr, ":") {
		return "http://127.0.0.1" + listenAddr
	}
	return "http://" + listenAddr
}

func CandidatePaths() []string {
	var paths []string
	if explicit := strings.TrimSpace(os.Getenv("EXORA_DOCK_DISCOVERY_PATH")); explicit != "" {
		paths = append(paths, explicit)
	}

	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		if dir := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); dir != "" {
			paths = append(paths, filepath.Join(dir, "ExoraDock", FileName))
		}
		if dir := strings.TrimSpace(os.Getenv("APPDATA")); dir != "" {
			paths = append(paths, filepath.Join(dir, "ExoraDock", FileName))
		}
		if home != "" {
			paths = append(paths, filepath.Join(home, "AppData", "Local", "ExoraDock", FileName))
		}
	case "darwin":
		if home != "" {
			paths = append(paths, filepath.Join(home, "Library", "Application Support", "ExoraDock", FileName))
		}
	default:
		if dir := strings.TrimSpace(os.Getenv("XDG_STATE_HOME")); dir != "" {
			paths = append(paths, filepath.Join(dir, "exora-dock", FileName))
		} else if home != "" {
			paths = append(paths, filepath.Join(home, ".local", "state", "exora-dock", FileName))
		}
		if dir := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); dir != "" {
			paths = append(paths, filepath.Join(dir, "exora-dock", FileName))
		} else if home != "" {
			paths = append(paths, filepath.Join(home, ".config", "exora-dock", FileName))
		}
	}
	if home != "" {
		paths = append(paths, filepath.Join(home, ".exora-dock", FileName))
	}

	return unique(paths)
}

func Write(manifest Manifest) ([]string, error) {
	paths := CandidatePaths()
	if len(paths) == 0 {
		return nil, fmt.Errorf("no discovery paths available")
	}
	manifest.DiscoveryFiles = paths
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}

	var written []string
	var failures []string
	for _, path := range paths {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", path, err))
			continue
		}
		if err := os.WriteFile(path, append(data, '\n'), 0600); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", path, err))
			continue
		}
		written = append(written, path)
	}
	if len(written) == 0 {
		return nil, fmt.Errorf("write discovery manifest: %s", strings.Join(failures, "; "))
	}
	return written, nil
}

func ReadFirst() (Manifest, string, error) {
	for _, path := range CandidatePaths() {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var manifest Manifest
		if err := json.Unmarshal(data, &manifest); err != nil {
			return Manifest{}, path, err
		}
		return manifest, path, nil
	}
	return Manifest{}, "", fmt.Errorf("no Exora Dock discovery manifest found")
}

func localHost(host string) string {
	host = strings.Trim(strings.TrimSpace(host), "[]")
	switch host {
	case "", "0.0.0.0", "::", "::0":
		return "127.0.0.1"
	case "::1":
		return "[::1]"
	default:
		return host
	}
}

func startCommand(executable string) []string {
	if strings.TrimSpace(executable) == "" {
		return nil
	}
	return []string{executable}
}

func mcpCommand(executable string) []string {
	if strings.TrimSpace(executable) == "" {
		return nil
	}
	return []string{executable, "mcp"}
}

func unique(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}
