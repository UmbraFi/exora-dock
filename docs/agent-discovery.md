# Agent Discovery

Exora Dock exposes a tiny local discovery contract so desktop agents can find a
user's Dock without a cloud API, plugin registry, or browser automation.

The contract uses three surfaces that most coding agents can access:

1. A local discovery file written when the daemon starts.
2. A localhost well-known manifest served by the daemon.
3. A stdio MCP server launched with `exora-dock mcp`.

## Discovery Files

On startup the daemon writes `agent-discovery.json` to standard per-user paths.
The first path can be overridden with `EXORA_DOCK_DISCOVERY_PATH`.

Common defaults:

| OS | Primary path |
|---|---|
| Windows | `%LOCALAPPDATA%\ExoraDock\agent-discovery.json` |
| macOS | `~/Library/Application Support/ExoraDock/agent-discovery.json` |
| Linux | `$XDG_STATE_HOME/exora-dock/agent-discovery.json` or `~/.local/state/exora-dock/agent-discovery.json` |

The manifest includes the Dock base URL, health URL, process id, executable path,
`mcpCommand`, `agentPrompt`, `opencodeConfig`, REST fallback metadata, and
agent-friendly endpoint metadata.

Agents should:

1. Check `EXORA_DOCK_DISCOVERY_PATH`.
2. Check the OS default discovery file paths.
3. Read `baseUrl` and call `healthUrl`.
4. If health fails but `startCommand` exists, start the Dock and retry health.
5. Fetch `manifestUrl` for the freshest endpoint metadata.
6. Launch `mcpCommand` and use MCP tools for normal agent workflows.

REST endpoint metadata is a fallback/debug surface for Console, CLI, SDK, and
tests. Agents should not prefer REST over MCP unless MCP is unavailable.

If the file is stale and cannot start the Dock, the agent can ignore it.

Discovery manifests never include owner secrets. The local daemon creates a
dual-token auth store under the Dock data directory on first start:

- `agentToken` is for MCP and agent-safe REST fallback. It can search resources,
  create drafts, request approvals, read status, resume orders, and read
  artifact manifests.
- `ownerToken` is for the human-controlled Dock surfaces. It is required for
  approval decisions, wallet actions, credential reveal, provider settings,
  resource management, sensitive artifact downloads, and remote-control
  execution.

MCP automatically loads the agent token and attaches it to local daemon calls.
MCP tools must not expose approve/reject actions; agents create approval
requests, then the user decides in Exora-controlled UI or CLI.

The Windows desktop shell exposes the same values as copy buttons:

- `Copy One-Line Agent Prompt`
- `Copy OpenCode MCP Config`
- `Copy MCP Command`
- `Copy REST Base URL`

These settings-page copy actions are generic and do not bind a task. For a
specific Work task, use the `Local agent via MCP` copy action in Work. It
generates a `workUid` and project folder path; external agents must include that
`workUid` on every related Exora MCP request. If a request arrives with a
previously unknown `workUid` and a `projectPath`, Dock creates/registers that
Work project folder before continuing. If the `workUid` is unknown and no
`projectPath` is supplied, MCP returns a tool error instead of guessing from the
agent process cwd.

## MCP Entrypoint

The default local agent entrypoint is:

```bash
exora-dock mcp config.yaml
```

The MCP server speaks newline-delimited JSON-RPC over stdin/stdout and proxies
tool calls to the running daemon discovered through the manifest. It does not
open the Dock database directly. If the daemon is unreachable, tool calls return
a structured tool error that includes the daemon start command when available.

Initial tools:

```text
exora.get_my_agent_card
exora.search_agent_cards
exora.search_offers
exora.find_sellers
exora.start_task_flow
exora.create_order_draft
exora.prepare_task_bundle
exora.request_approval
exora.get_order_status
exora.resume_order
exora.list_pending_orders
exora.list_order_plans
exora.get_order_plan
exora.resume_task_flow
exora.get_artifact_manifest
```

For a concrete task, agents should prefer `exora.start_task_flow`. It asks the
Dock to search Agent Cards and the market, contact up to six provider endpoints for signed
realtime Docker quotes, and create a durable order plan. The agent should then
use `exora.resume_task_flow` / `exora.get_order_plan` until the next action is
human approval, provider execution, or artifact retrieval. MCP tools still never
approve, select, or pay on the user's behalf.

## Well-Known Manifest

When the daemon is online, this endpoint returns the same manifest shape:

```text
GET http://127.0.0.1:8080/.well-known/exora-dock.json
```

For a user request like "find servers with more than 20GB VRAM", MCP clients
should call `exora.search_offers`. As a REST fallback, clients can do:

```text
GET http://127.0.0.1:8080/v1/resources?type=gpu&minVramGb=20
```

It can also fetch all GPU listings and apply its own reasoning:

```text
GET http://127.0.0.1:8080/v1/resources?type=gpu
```

The returned resources include `spec.vramGb`, `spec.gpuModel`,
`pricePerUnit`, `billingUnit`, `providerPubkey`, and lease metadata.

## CLI Fallback

If `exora-dock` is on `PATH`, users and debuggers can print the active discovery
file:

```bash
exora-dock discover
```

This command reads the first available discovery manifest and prints it as JSON.

Approval queue fallback:

```bash
exora-dock auth status
exora-dock agent run "find a seller and prepare a Docker task"
exora-dock agent list
exora-dock agent status <run-id>
exora-dock agent resume <run-id>
exora-dock approvals list pending
exora-dock approvals approve <approval-id>
exora-dock approvals reject <approval-id> "reason"
```

## Remote Console

The PWA is a remote control surface for a bound local Dock, not a standalone
cloud Dock. A user links the Dock with:

```bash
exora-dock cloud link
```

After the user confirms the code in the PWA, the Dock stores a Cloud token and
polls the relay for short-lived commands. The relay can enqueue only allowlisted
console operations such as daemon status, resources, tasks/orders, approvals,
leases, redacted seller settings, and wallet status. The relay must not return
mnemonics, private keys, raw provider API keys, or arbitrary local file content.
