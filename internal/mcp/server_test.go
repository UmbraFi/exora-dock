package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/discovery"
)

func TestMCPInitializeAndToolsList(t *testing.T) {
	server := NewServer(Options{})

	initResp := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`)))
	result := initResp["result"].(map[string]any)
	if result["protocolVersion"] != protocolVersion {
		t.Fatalf("protocol version = %#v", result["protocolVersion"])
	}
	caps := result["capabilities"].(map[string]any)
	if _, ok := caps["tools"]; !ok {
		t.Fatalf("capabilities missing tools: %#v", caps)
	}
	if instructions, _ := result["instructions"].(string); !strings.Contains(instructions, "run capability") || strings.Contains(instructions, "run_buyer_work") {
		t.Fatalf("default V2 instructions = %q", instructions)
	}

	listResp := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)))
	listResult := listResp["result"].(map[string]any)
	tools := listResult["tools"].([]any)
	if len(tools) != len(V2ToolNames()) {
		t.Fatalf("tools len = %d, want %d", len(tools), len(V2ToolNames()))
	}
	for index, raw := range tools {
		tool := raw.(map[string]any)
		if tool["name"] != V2ToolNames()[index] {
			t.Fatalf("tool %d = %#v, want %s", index, tool, V2ToolNames()[index])
		}
	}
	claim := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"exora.claim_run","arguments":{"runId":"run-1"}}}`)))
	if !strings.Contains(mustJSON(t, claim["result"]), "run capability required") {
		t.Fatalf("unbound V2 call = %#v", claim)
	}
}

func TestMCPLegacyMarketToolsRequireExplicitOptIn(t *testing.T) {
	server := NewServer(Options{LegacyMarket: true})
	listed := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)))
	tools := listed["result"].(map[string]any)["tools"].([]any)
	toolsJSON := mustJSON(t, tools)
	if len(tools) != 28 || !strings.Contains(toolsJSON, "exora.search_offers") || !strings.Contains(toolsJSON, "exora.run_buyer_work") || !strings.Contains(toolsJSON, "exora.save_api_bridge_draft") || !strings.Contains(toolsJSON, "exora.invoke_api_bridge") {
		t.Fatalf("legacy tools = %#v", tools)
	}
}

func TestMCPAgentCardToolsProxyToDaemon(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/v1/agent-cards/mine", func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer agent-secret" {
			t.Fatalf("authorization = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"cards":[{"id":"local-seller","role":"seller"}]}`))
	})
	mux.HandleFunc("/v1/agent-cards/search", func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("role"); got != "seller" {
			t.Fatalf("role query = %q", got)
		}
		if got := r.URL.Query().Get("q"); got != "gpu" {
			t.Fatalf("q query = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"cards":[{"id":"cloud-seller","role":"seller"}]}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()
	writeDiscoveryForTest(t, ts.URL, []string{"exora-dock", "config.yaml"})

	server := NewServer(Options{BaseURL: ts.URL, AgentToken: "agent-secret", LegacyMarket: true})
	mine := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"exora.get_my_agent_card","arguments":{}}}`)))
	if !strings.Contains(mustJSON(t, mine["result"]), "local-seller") {
		t.Fatalf("mine result = %#v", mine)
	}
	search := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"exora.search_agent_cards","arguments":{"role":"seller","q":"gpu"}}}`)))
	if !strings.Contains(mustJSON(t, search["result"]), "cloud-seller") {
		t.Fatalf("search result = %#v", search)
	}
}

func TestMCPFindSellersProxiesNaturalLanguageSearch(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/v1/agent/search-sellers", func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer agent-secret" {
			t.Fatalf("authorization = %q", got)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("body decode: %v", err)
		}
		if body["query"] != "帮我找 20G 显存以上服务器" {
			t.Fatalf("query = %#v", body["query"])
		}
		if body["prepareOrderOptions"] != true || body["createSelectionRequest"] != true {
			t.Fatalf("order plan defaults missing: %#v", body)
		}
		if body["maxOptions"] != float64(5) || body["maxResults"] != float64(5) {
			t.Fatalf("option defaults missing: %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"normalizedQuery":{"type":"gpu","minVramGb":20},"candidates":[{"providerPubkey":"provider-1"}]}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()
	writeDiscoveryForTest(t, ts.URL, []string{"exora-dock", "config.yaml"})

	server := NewServer(Options{BaseURL: ts.URL, AgentToken: "agent-secret", LegacyMarket: true})
	body := `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"exora.find_sellers","arguments":{"query":"帮我找 20G 显存以上服务器"}}}`
	resp := responseMap(t, server.HandleJSON(context.Background(), []byte(body)))
	result := resp["result"].(map[string]any)
	if isError, _ := result["isError"].(bool); isError {
		t.Fatalf("tool returned error: %#v", result)
	}
	if !strings.Contains(mustJSON(t, result["structuredContent"]), "provider-1") {
		t.Fatalf("structured content = %#v", result["structuredContent"])
	}
}

func TestMCPStartTaskFlowDefaultsRealtimeDockerSearch(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/v1/agent/search-sellers", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("body decode: %v", err)
		}
		if body["requireRealtimeQuotes"] != true || body["createSelectionRequest"] != true {
			t.Fatalf("task flow defaults missing: %#v", body)
		}
		if body["maxOptions"] != float64(6) || body["maxResults"] != float64(6) {
			t.Fatalf("task flow option defaults missing: %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"selectionRequest":{"planId":"opln-1","status":"pending_selection"},"orderDraftOptions":[{"optionId":"opt_1","realtimeStatus":"quoted"}]}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()
	writeDiscoveryForTest(t, ts.URL, []string{"exora-dock", "config.yaml"})

	server := NewServer(Options{BaseURL: ts.URL, LegacyMarket: true})
	body := `{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"exora.start_task_flow","arguments":{"query":"rent server and run docker"}}}`
	resp := responseMap(t, server.HandleJSON(context.Background(), []byte(body)))
	result := resp["result"].(map[string]any)
	if isError, _ := result["isError"].(bool); isError {
		t.Fatalf("tool returned error: %#v", result)
	}
	if !strings.Contains(mustJSON(t, result["structuredContent"]), "opln-1") {
		t.Fatalf("structured content = %#v", result["structuredContent"])
	}
}

func TestMCPRunBuyerWorkResolvesWorkUIDProjectFolder(t *testing.T) {
	dir := t.TempDir()
	projectPath := filepath.Join(dir, "uid-project")
	state := `{"workMcpUids":[{"workUid":"work-abc","projectPath":` + strconv.Quote(projectPath) + `}]}`
	if err := os.WriteFile(filepath.Join(dir, "desktop-state.json"), []byte(state), 0o600); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte("listen_addr: 127.0.0.1:8080\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/v1/agent/buyer-work", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("body decode: %v", err)
		}
		if body["workUid"] != "work-abc" || body["projectPath"] != projectPath {
			t.Fatalf("work context = %#v", body)
		}
		template, _ := body["taskTemplate"].(map[string]any)
		if template["workUid"] != "work-abc" || template["projectPath"] != projectPath {
			t.Fatalf("template work context = %#v", template)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"selectionRequest":{"planId":"opln-uid","status":"pending_selection"},"summary":"Created owner seller choice."}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	server := NewServer(Options{BaseURL: ts.URL, ConfigPath: configPath, LegacyMarket: true})
	body := `{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"exora.run_buyer_work","arguments":{"query":"run gpu docker","workUid":"work-abc","taskTemplate":{}}}}`
	resp := responseMap(t, server.HandleJSON(context.Background(), []byte(body)))
	result := resp["result"].(map[string]any)
	if isError, _ := result["isError"].(bool); isError {
		t.Fatalf("tool returned error: %#v", result)
	}
	if !strings.Contains(mustJSON(t, result["structuredContent"]), "opln-uid") {
		t.Fatalf("structured content = %#v", result["structuredContent"])
	}
	if info, err := os.Stat(projectPath); err != nil || !info.IsDir() {
		t.Fatalf("work project folder was not created: info=%#v err=%v", info, err)
	}
	stateMap := readDesktopStateForTest(t, filepath.Join(dir, "desktop-state.json"))
	assertActiveWorkLease(t, stateMap, "work-abc", projectPath)
}

func TestMCPWorkUIDExplicitProjectPathRegistersProjectFolder(t *testing.T) {
	dir := t.TempDir()
	projectPath := filepath.Join(dir, "explicit-project")
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte("listen_addr: 127.0.0.1:8080\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/v1/agent/buyer-work", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("body decode: %v", err)
		}
		if body["workUid"] != "work-explicit" || body["projectPath"] != projectPath {
			t.Fatalf("work context = %#v", body)
		}
		template, _ := body["taskTemplate"].(map[string]any)
		if template["workUid"] != "work-explicit" || template["projectPath"] != projectPath {
			t.Fatalf("template work context = %#v", template)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"selectionRequest":{"planId":"opln-explicit","status":"pending_selection"}}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	server := NewServer(Options{BaseURL: ts.URL, ConfigPath: configPath, LegacyMarket: true})
	body := `{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"exora.run_buyer_work","arguments":{"query":"run gpu docker","uid":"work-explicit","projectPath":` + strconv.Quote(projectPath) + `,"taskTemplate":{}}}}`
	resp := responseMap(t, server.HandleJSON(context.Background(), []byte(body)))
	result := resp["result"].(map[string]any)
	if isError, _ := result["isError"].(bool); isError {
		t.Fatalf("tool returned error: %#v", result)
	}
	if info, err := os.Stat(projectPath); err != nil || !info.IsDir() {
		t.Fatalf("work project folder was not created: info=%#v err=%v", info, err)
	}
	stateData, err := os.ReadFile(filepath.Join(dir, "desktop-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	stateJSON := string(stateData)
	if !strings.Contains(stateJSON, `"workUid": "work-explicit"`) || !strings.Contains(stateJSON, `"projectFolders"`) || !strings.Contains(stateJSON, filepath.Base(projectPath)) {
		t.Fatalf("desktop state missing work UID/project folder: %s", stateJSON)
	}
	stateMap := readDesktopStateForTest(t, filepath.Join(dir, "desktop-state.json"))
	assertActiveWorkLease(t, stateMap, "work-explicit", projectPath)
}

func TestMCPUnknownWorkUIDWithoutProjectPathReturnsToolError(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte("listen_addr: 127.0.0.1:8080\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	server := NewServer(Options{ConfigPath: configPath, LegacyMarket: true})
	body := `{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"exora.run_buyer_work","arguments":{"query":"run gpu docker","workUid":"work-missing","taskTemplate":{}}}}`
	resp := responseMap(t, server.HandleJSON(context.Background(), []byte(body)))
	result := resp["result"].(map[string]any)
	if isError, _ := result["isError"].(bool); !isError {
		t.Fatalf("isError = %#v, want true in %#v", result["isError"], result)
	}
	if !strings.Contains(mustJSON(t, result["structuredContent"]), "work_context_error") || !strings.Contains(mustJSON(t, result["structuredContent"]), "projectPath") {
		t.Fatalf("missing work context error details: %#v", result)
	}
	if _, err := os.Stat(filepath.Join(dir, "desktop-state.json")); !os.IsNotExist(err) {
		t.Fatalf("desktop state should not be created for unknown UID without projectPath: %v", err)
	}
}

func TestMCPWorkContextPropagatesAcrossBuyerTools(t *testing.T) {
	dir := t.TempDir()
	projectPath := filepath.Join(dir, "table-project")
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte("listen_addr: 127.0.0.1:8080\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	seen := map[string]int{}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	checkWorkContext := func(w http.ResponseWriter, r *http.Request) {
		seen[r.URL.Path]++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("body decode for %s: %v", r.URL.Path, err)
		}
		if body["workUid"] != "work-table" || body["projectPath"] != projectPath {
			t.Fatalf("work context for %s = %#v", r.URL.Path, body)
		}
		for _, key := range []string{"taskTemplate", "draft"} {
			nested, ok := body[key].(map[string]any)
			if !ok {
				continue
			}
			if nested["workUid"] != "work-table" || nested["projectPath"] != projectPath {
				t.Fatalf("%s context for %s = %#v", key, r.URL.Path, nested)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}
	mux.HandleFunc("/v1/agent/search-sellers", checkWorkContext)
	mux.HandleFunc("/v1/agent/buyer-work", checkWorkContext)
	mux.HandleFunc("/v1/negotiations", checkWorkContext)
	mux.HandleFunc("/v1/order-plans/from-negotiations", checkWorkContext)
	mux.HandleFunc("/v1/tasks", checkWorkContext)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	server := NewServer(Options{BaseURL: ts.URL, ConfigPath: configPath, LegacyMarket: true})
	calls := []struct {
		name string
		args string
	}{
		{"exora.find_sellers", `{"query":"find sellers","workUID":"work-table","projectPath":` + strconv.Quote(projectPath) + `,"taskTemplate":{}}`},
		{"exora.start_task_flow", `{"query":"start flow","uid":"work-table","projectPath":` + strconv.Quote(projectPath) + `,"taskTemplate":{}}`},
		{"exora.run_buyer_work", `{"query":"buyer work","workUid":"work-table","projectPath":` + strconv.Quote(projectPath) + `,"taskTemplate":{}}`},
		{"exora.negotiate_task", `{"intent":"negotiate","uid":"work-table","projectPath":` + strconv.Quote(projectPath) + `,"taskTemplate":{}}`},
		{"exora.create_order_plan_from_quote", `{"negotiationIds":["neg-1"],"uid":"work-table","projectPath":` + strconv.Quote(projectPath) + `,"draft":{}}`},
		{"exora.create_order_draft", `{"requesterPubkey":"user","agentId":"codex","type":"compute","goal":"draft","uid":"work-table","projectPath":` + strconv.Quote(projectPath) + `,"draft":{}}`},
	}
	for i, call := range calls {
		body := `{"jsonrpc":"2.0","id":` + strconv.Itoa(20+i) + `,"method":"tools/call","params":{"name":"` + call.name + `","arguments":` + call.args + `}}`
		resp := responseMap(t, server.HandleJSON(context.Background(), []byte(body)))
		result := resp["result"].(map[string]any)
		if isError, _ := result["isError"].(bool); isError {
			t.Fatalf("%s returned error: %#v", call.name, result)
		}
	}
	if seen["/v1/agent/search-sellers"] != 2 || seen["/v1/agent/buyer-work"] != 1 || seen["/v1/negotiations"] != 1 || seen["/v1/order-plans/from-negotiations"] != 1 || seen["/v1/tasks"] != 1 {
		t.Fatalf("unexpected routed calls: %#v", seen)
	}
	stateMap := readDesktopStateForTest(t, filepath.Join(dir, "desktop-state.json"))
	assertActiveWorkLease(t, stateMap, "work-table", projectPath)
}

func TestMCPSearchOffersProxiesToDaemon(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/v1/resources", func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer agent-secret" {
			t.Fatalf("authorization = %q", got)
		}
		if got := r.URL.Query().Get("type"); got != "gpu" {
			t.Fatalf("type query = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resources":[{"id":"res-1","type":"gpu","spec":{"vramGb":48}}]}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()
	writeDiscoveryForTest(t, ts.URL, []string{"exora-dock", "config.yaml"})

	server := NewServer(Options{BaseURL: ts.URL, AgentToken: "agent-secret", LegacyMarket: true})
	body := `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"exora.search_offers","arguments":{"type":"gpu","minVramGb":40}}}`
	resp := responseMap(t, server.HandleJSON(context.Background(), []byte(body)))
	result := resp["result"].(map[string]any)
	if isError, _ := result["isError"].(bool); isError {
		t.Fatalf("tool returned error: %#v", result)
	}
	if !strings.Contains(mustJSON(t, result["structuredContent"]), `"res-1"`) {
		t.Fatalf("structured content = %#v", result["structuredContent"])
	}
}

func TestMCPDaemonUnavailableReturnsToolError(t *testing.T) {
	writeDiscoveryForTest(t, "http://127.0.0.1:1", []string{"exora-dock", "config.yaml"})
	server := NewServer(Options{
		BaseURL:      "http://127.0.0.1:1",
		StartCommand: []string{"exora-dock", "config.yaml"},
		HTTPClient:   &http.Client{Timeout: 100 * time.Millisecond},
		LegacyMarket: true,
	})
	body := `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"exora.search_offers","arguments":{"type":"gpu"}}}`
	resp := responseMap(t, server.HandleJSON(context.Background(), []byte(body)))
	result := resp["result"].(map[string]any)
	if isError, _ := result["isError"].(bool); !isError {
		t.Fatalf("isError = %#v, want true in %#v", result["isError"], result)
	}
	if !strings.Contains(mustJSON(t, result), "Start it with") {
		t.Fatalf("result missing start command: %#v", result)
	}
}

func TestMCPUnknownMethodAndToolReturnProtocolErrors(t *testing.T) {
	server := NewServer(Options{})
	methodResp := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":5,"method":"missing"}`)))
	if code := methodResp["error"].(map[string]any)["code"]; code != float64(-32601) {
		t.Fatalf("unknown method code = %#v", code)
	}

	toolResp := responseMap(t, server.HandleJSON(context.Background(), []byte(`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"exora.nope","arguments":{}}}`)))
	if code := toolResp["error"].(map[string]any)["code"]; code != float64(-32602) {
		t.Fatalf("unknown tool code = %#v", code)
	}
}

func writeDiscoveryForTest(t *testing.T, baseURL string, startCommand []string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "agent-discovery.json")
	t.Setenv("EXORA_DOCK_DISCOVERY_PATH", path)
	data, err := json.Marshal(discovery.Manifest{
		Schema:       discovery.SchemaURL,
		BaseURL:      baseURL,
		HealthURL:    strings.TrimRight(baseURL, "/") + "/health",
		StartCommand: startCommand,
	})
	if err != nil {
		t.Fatalf("marshal discovery: %v", err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatalf("write discovery: %v", err)
	}
}

func responseMap(t *testing.T, value any) map[string]any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal response: %v; data=%s", err, data)
	}
	return out
}

func readDesktopStateForTest(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read desktop state: %v", err)
	}
	var state map[string]any
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatalf("desktop state json: %v; data=%s", err, data)
	}
	return state
}

func assertActiveWorkLease(t *testing.T, state map[string]any, workUID, projectPath string) {
	t.Helper()
	leases, ok := state["workMcpLeases"].([]any)
	if !ok || len(leases) == 0 {
		t.Fatalf("desktop state missing workMcpLeases: %#v", state)
	}
	for _, item := range leases {
		lease, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if lease["workUid"] != workUID {
			continue
		}
		if lease["projectPath"] != projectPath || lease["controller"] != "external-mcp" || lease["status"] != "active" {
			t.Fatalf("lease fields = %#v", lease)
		}
		sessionID, _ := lease["sessionId"].(string)
		expiresAt, _ := lease["expiresAt"].(string)
		if strings.TrimSpace(sessionID) == "" || strings.TrimSpace(expiresAt) == "" {
			t.Fatalf("lease missing session/expiry: %#v", lease)
		}
		return
	}
	t.Fatalf("active lease for %s not found in %#v", workUID, leases)
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal json: %v", err)
	}
	return string(data)
}
