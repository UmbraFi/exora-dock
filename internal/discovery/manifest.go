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

func Build(listenAddr, dockID string) Manifest { return BuildWithBaseURL(BaseURL(listenAddr), dockID) }

func BuildWithBaseURL(baseURL, dockID string) Manifest {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8080"
	}
	if strings.TrimSpace(dockID) == "" {
		dockID = "local"
	}
	executable, _ := os.Executable()
	mcp := mcpCommand(executable)
	return Manifest{
		Schema: SchemaURL, ProtocolVersion: ProtocolVersion, Name: "Exora Dock", Kind: "local-capability-dock",
		DockID: dockID, BaseURL: baseURL, HealthURL: baseURL + "/health", ManifestURL: baseURL + "/.well-known/exora-dock.json",
		ProcessID: os.Getpid(), ExecutablePath: executable, StartCommand: startCommand(executable), MCPCommand: mcp,
		AgentPrompt: AgentPrompt(), OpenCodeConfig: OpenCodeConfig(mcp), RESTFallback: RESTFallback(baseURL),
		Capabilities: []Capability{
			{Name: "mcp.stdio", Description: "Authoritative MCP entrypoint for the API-only V4 marketplace."},
			{Name: "security.session_key", Description: "Each MCP initialize creates a scoped local-only session key; Cloud accepts the account key injected by Dock."},
			{Name: "marketplace.api", Description: "Discover and invoke OpenAPI 3.1 request/response, SSE, and asynchronous Job operations."},
			{Name: "provider.api-contract", Description: "Guide Seller Agents through stateless MCP preparation and accept one complete exora.api-contract.v1 file containing API capability, safe Seller cases and owner-specified billing rules."},
			{Name: "artifact.verified", Description: "Exchange large inputs and outputs through ownership-, size-, MIME-, and SHA-256-verified Artifacts."},
		},
		Endpoints: map[string]Endpoint{
			"health":     {Method: "GET", Path: "/health", URL: baseURL + "/health", Description: "Check whether this Dock is online."},
			"manifest":   {Method: "GET", Path: "/.well-known/exora-dock.json", URL: baseURL + "/.well-known/exora-dock.json", Description: "Read this discovery manifest."},
			"mcp.stdio":  {Method: "STDIO", Description: "Launch the MCP server with mcpCommand."},
			"catalog":    {Method: "GET", Path: "/v4/catalog/operations", URL: baseURL + "/v4/catalog/operations", Description: "Search flat Operation rows with their parent API summaries."},
			"api":        {Method: "GET", Path: "/v4/catalog/apis/{apiId}", URL: baseURL + "/v4/catalog/apis/{apiId}", Description: "Read one API and all Operations."},
			"invocation": {Method: "POST", Path: "/v4/apis/{apiId}/operations/{operationId}/invocations", URL: baseURL + "/v4/apis/{apiId}/operations/{operationId}/invocations", Description: "Create an Invocation for one declared Operation."},
			"apiDrafts":  {Method: "MCP", Description: "Follow the stateless preparation guide and submit one complete exora.api-contract.v1 file to an existing stable API UID."},
		},
		LastSeen: time.Now().UTC().Format(time.RFC3339),
	}
}

func AgentPrompt() string {
	return "Read the local Exora Dock discovery manifest and start its stdio MCP server. Begin provider preparation with exora.get_api_preparation_guide and follow its stateless steps. When its submission checklist is satisfied, submit one complete exora.api-contract.v1 file to the existing stable API UID. Include the exora.api.v3 capability, safe repeatable Seller cases and exactly one owner-directed billing rule per Operation. An Agent may encode billing values explicitly supplied by the seller, but must never choose rates, submit credentials, run validation, confirm the contract, publish, or change lifecycle on a human's behalf. The bundled prepare-exora-api Skill is only an MCP bootstrap guide."
}

func OpenCodeConfig(command []string) map[string]any {
	return map[string]any{"$schema": "https://opencode.ai/config.json", "mcp": map[string]any{"exora": map[string]any{"type": "local", "command": command, "enabled": true}}}
}
func RESTFallback(baseURL string) map[string]any {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8080"
	}
	return map[string]any{"baseUrl": baseURL, "health": baseURL + "/health", "manifest": baseURL + "/.well-known/exora-dock.json"}
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
	if host, port, err := net.SplitHostPort(listenAddr); err == nil {
		return fmt.Sprintf("http://%s:%s", localHost(host), port)
	}
	if strings.HasPrefix(listenAddr, ":") {
		return "http://127.0.0.1" + listenAddr
	}
	return "http://" + listenAddr
}

func CandidatePaths() []string {
	paths := []string{}
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
	written := []string{}
	failures := []string{}
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
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}
