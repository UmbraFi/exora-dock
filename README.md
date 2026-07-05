# Exora Dock

Exora Dock is the local capability runtime for personal AI agents: a user-owned,
agent-operated gateway that lets agents extend their boundaries across compute,
browsers, data, repositories, projects, storage, and future onchain settlement.

The idea is simple:

```text
Human intent
  -> agent delegation
  -> remote capability job
  -> quote and consent
  -> provider execution
  -> artifact, proof, audit, settlement
  -> user result or receipt
```

Exora Dock is not just a server or client. It is the local place where human
permission, agent requests, temporary credentials, logs, and future settlement
meet. It can start as a local-first agent runtime today and later become the
smallest supply unit of the Exora Dock network.

## Vision

Exora Dock is built around a different marketplace assumption:

- Humans express goals, budgets, and risk boundaries.
- Agents discover, buy, rent, operate, maintain, and audit capabilities.
- Users keep ownership and final control.
- Docks provide capability proxies instead of static APIs.
- Economic state, proofs, reputation, and settlement become chain-readable.

In this model, every user who installs Exora Dock can become part of the network:
their device, browser, storage, GPU, data access, project workspace, or local
operator agent can become a rentable capability under explicit policy.

The long-term shape is:

```text
Exora Dock Console   Human UI for wallets, policies, approvals, and logs
Exora Dock           Local daemon / CLI / MCP / capability runtime
Exora Dock Network   Capability leases, proofs, audits, reputation, settlement
```

## Core Roles

### Connect Mode

The Dock acts as the agent's capability router. A local or remote agent can:

- Search for rentable capabilities.
- Create a delegation envelope.
- Lease short-lived access to resources.
- Receive temporary credentials.
- Revoke access.
- Track cost, usage, and proof receipts.

### Mine Mode

The Dock can turn user-owned resources into network supply. A provider agent can:

- Publish a capability manifest.
- Accept or reject lease requests.
- Provision a sandbox, browser, storage bucket, dataset token, or workspace.
- Meter usage.
- Produce heartbeat and proof hashes.
- Earn from fulfilled work.

### Audit Mode

The Dock can also become part of the verification layer. Auditor agents can:

- Probe resource availability.
- Compare claims against evidence packets.
- Check delegation boundaries.
- Vote on disputes.
- Contribute to reputation, slashing, and reward logic.

## Capability Proxy

Exora Dock should eventually publish more than an API description. It should
publish a machine-readable capability proxy manifest: what can be leased, what
policies constrain it, how it is metered, and which local agent operates it.

Example shape:

```json
{
  "dockId": "exora-dock-local-001",
  "owner": "wallet-address",
  "operatorAgent": "agent://local/operator",
  "capabilities": [
    {
      "type": "browser",
      "mode": "sandboxed",
      "maxSessionMinutes": 30,
      "price": "0.02 USDC/min",
      "policy": {
        "allowedDomains": ["*"],
        "blockedActions": ["payments", "password_export"]
      }
    },
    {
      "type": "storage",
      "capacityGb": 20,
      "retentionHours": 24,
      "price": "0.001 USDC/GB-hour"
    }
  ],
  "proofs": {
    "heartbeat": true,
    "usageMeter": true,
    "logHash": true
  }
}
```

This is the key distinction: a capability is not just a hosted endpoint. It is a
policy-bounded resource operated by an agent on behalf of a user.

## Current MVP

The current Dock MVP runs as a local Go gateway on `:8080`.

It already includes:

- Local wallet onboarding: create a Solana keypair or bind an existing address.
- Remote Job MVP primitives: task envelopes, quotes, consent, provider claim,
  completion, failure, and artifact retrieval.
- Native stdio MCP server for local agents through `exora-dock mcp`.
- Human approval queue for quote consent and resumable task/order state.
- Local dual-token auth: agent tokens can search, draft, request approval, and
  poll status; owner tokens are required for approval decisions and sensitive
  management actions.
- Exora Cloud device linking and remote command relay for PWA control of a
  bound local Dock, without exposing mnemonic, private keys, or provider API
  keys.
- Resource records for VPS, GPU, dataset, repository, project, and storage.
- Delegation envelopes for agent budget, duration, type, and region limits.
- Lease records with active/pending/revoked lifecycle states.
- Temporary credential references for active leases.
- Local agent discovery through a per-user manifest file and a well-known
  localhost manifest endpoint.
- Deterministic local review rules for resource publishing.
- Compatibility product/order endpoints from the earlier marketplace prototype.
- Chat, unread state, export, and DHT-style lookup primitives.
- Badger-backed local persistence under `./data`.

It does not yet include:

- Real sandbox provisioning.
- Production Exora Cloud matching, relay, reputation, and task ledger.
- Onchain escrow, stake, slashing, or reputation writes.
- Evidence packet and auditor-agent workflows.

## Quick Start

Local MVP mode does not require a Solana keypair, IPFS daemon, or LLM API key:

```bash
go run ./cmd/exora-dock/
```

This starts one local Exora Dock on `:8080`, stores uploaded media under
`./data/media`, uses deterministic local review rules, and persists resources,
delegations, leases, compatibility products/orders, and chat messages in Badger.

## Local Agent Demo

Start the node:

```bash
cd exora-dock
go run ./cmd/exora-dock/
```

Start the PWA in a second terminal:

```bash
cd exora-console
copy .env.example .env.local
npm install
npm run dev
```

Open the PWA dev URL, create or unlock a wallet, publish a resource, then add it
to Agent Requests from another wallet. Checkout creates a delegation envelope and
leases the selected resources for the chosen duration. Active leases expose a
credential reference; users can reveal credentials, revoke leases, and chat with
providers from the lease views.

For a configured Dock:

```bash
cp config.example.yaml config.yaml
# Edit config.yaml with your RPC URL
go build -o exora-dock ./cmd/exora-dock/
./exora-dock config.yaml
```

Or with Docker:

```bash
docker build -t exora-dock .
docker run -p 8080:8080 \
  -v ./config.yaml:/etc/exora-dock/config.yaml \
  -v exora-dock-data:/var/lib/exora-dock \
  exora-dock
```

Wallet setup:

```bash
exora-dock wallet create
exora-dock wallet bind 11111111111111111111111111111111
exora-dock wallet show
```

Agent discovery:

```bash
exora-dock discover
exora-dock mcp config.yaml
curl http://127.0.0.1:8080/.well-known/exora-dock.json
curl "http://127.0.0.1:8080/v1/resources?type=gpu&minVramGb=20"
```

When the daemon starts, it writes an `agent-discovery.json` manifest under the
current user's standard app-data paths, for example
`%LOCALAPPDATA%\ExoraDock\agent-discovery.json` on Windows. See
[`docs/agent-discovery.md`](docs/agent-discovery.md).

Agents should use `exora-dock mcp` as the primary local entrypoint. The REST
endpoints remain available for the Console, CLI fallback, tests, and debugging.
The MCP server proxies tool calls to the running daemon discovered through the
manifest; it does not open the Dock database directly.
For concrete work, agents should call `exora.start_task_flow`, then
`exora.resume_task_flow` / `exora.get_order_plan` while the Dock records
provider quote attempts, owner selection, Docker execution, and artifacts.

Approval queue CLI fallback:

```bash
exora-dock auth status
exora-dock approvals list pending
exora-dock approvals get <approval-id>
exora-dock approvals approve <approval-id>
exora-dock approvals reject <approval-id> "reason"
```

Remote PWA control is available by linking the local Dock to Exora Cloud:

```bash
exora-dock cloud link
```

The PWA then sends allowlisted owner actions through the Cloud relay. Cloud only
stores short-lived command/result records; the local Dock still executes the
owner-authorized action and keeps secrets on the user's machine.

Provider mode can be enabled in `config.yaml`. The command executor is disabled
by default; enable it only with an allowlist:

```yaml
mode: "provider"
provider:
  allow_command_executor: true
  allowed_commands: ["python"]
```

For the server-to-Docker flow, keep the command executor separate and enable the
Docker provider explicitly with an image allowlist. Buyer agents should use MCP
`exora.start_task_flow`; the Dock searches the market, contacts provider
endpoints for signed realtime quotes, creates a durable order plan, asks the
owner to approve/select, submits the Docker job, then mirrors artifacts back to
the local ledger.

```yaml
mode: "provider"
provider:
  docker:
    enabled: true
    default_image: "python:3.12-alpine"
    allowed_images: ["python:3.12-alpine"]
    network_mode: "none"
    allowed_network_modes: ["none"]
    pull_policy: "missing"
```

## Real User Flow

The Windows desktop shell is the default consumer entrypoint.

Buyer flow:

1. Open Exora Dock and wait for the status to become healthy.
2. In the Buyer tab, copy the one-line agent prompt or the OpenCode MCP config.
3. Give that text to a local agent. The agent reads
   `%LOCALAPPDATA%\ExoraDock\agent-discovery.json`, starts `mcpCommand`, and uses
   Exora MCP tools. REST is only a fallback/debug path.

Seller flow:

1. Open the Seller tab and enter an OpenAI-compatible LLM base URL, API key,
   wire API, research/utility models, provider id, and default quote settings.
   Custom provider base URLs may omit `/v1`; Exora Dock will try `/v1` first
   and fall back to the raw base URL.
2. Save settings. The desktop shell writes `config.yaml` and restarts the local
   daemon so the updated config is reloaded.
3. With `seller_agent.enabled=true`, Exora Dock can auto-quote new tasks. If
   `auto_complete_text_tasks=true`, it can also complete lightweight `text.*`,
   `agent.*`, and `connectivity.smoke` tasks after buyer consent.

## Distribution

The release pipeline is prepared for four distribution shapes:

| Target | Audience | Output |
|---|---|---|
| Docker | Linux provider/server nodes | `ghcr.io/exora-dock/exora-dock` |
| Debian | Ubuntu/Debian users and light providers | `.deb` with systemd service |
| macOS | Consumer requester/provider users | `.dmg` desktop shell with daemon sidecar |
| Windows | Consumer requester/provider users | NSIS `.exe` desktop shell with bundled local daemon/MCP helper |

Build the local Windows desktop installer from a Windows machine with Go and
Node/npm:

```powershell
.\scripts\build-win-docker.ps1
```

The script runs Go tests, builds `exora-dockd.exe` as the bundled local
daemon/MCP helper, and produces the NSIS installer under
`desktop\release`.
Pass `-BuildDockerImage` only when you also want to produce the legacy local
Docker image tar for testing.

## API

Local HTTP APIs use bearer auth except for `/health` and the discovery
manifest:

```text
Authorization: Bearer <agentToken|ownerToken>
```

Agent-scoped tokens can search resources, create task drafts, create approval
requests, read order/task status, resume work, and fetch artifact manifests.
Owner-scoped tokens are required for approval decisions, wallet actions,
credential reveal, provider/resource management, sensitive artifact downloads,
and remote-control execution. MCP automatically uses the agent token and cannot
approve or reject on the user's behalf.

| Endpoint | Description |
|---|---|
| `GET /health` | Node status |
| `GET /.well-known/exora-dock.json` | Local agent discovery manifest |
| `GET /v1/wallet` | Current local wallet status |
| `POST /v1/wallet/create` | Create a local Solana keypair |
| `POST /v1/wallet/bind` | Bind an existing Solana address |
| `DELETE /v1/wallet` | Clear the local wallet binding |
| `POST /v1/tasks` | Create a remote job task envelope |
| `GET /v1/tasks?status=:status&party=:pubkey` | List remote job tasks |
| `GET /v1/tasks/:id` | Task details |
| `POST /v1/tasks/:id/quote` | Provider returns a quote |
| `POST /v1/tasks/:id/consent` | User approves or rejects a quote |
| `GET /v1/tasks/:id/artifacts` | Task artifact manifest |
| `GET /v1/provider/tasks/next` | Provider gets the next ready task |
| `POST /v1/provider/tasks/:id/claim` | Provider claims a task |
| `POST /v1/provider/tasks/:id/run` | Provider runs an allowlisted local command |
| `POST /v1/provider/tasks/:id/complete` | Provider completes a task with artifacts |
| `POST /v1/provider/tasks/:id/fail` | Provider marks a task failed |
| `POST /v1/provider/quote-requests` | Provider receives signed realtime Docker quote requests |
| `POST /v1/provider/jobs` | Provider receives an approved signed Docker job |
| `GET /v1/provider/jobs/:id` | Provider-side Docker job status |
| `GET /v1/provider/jobs/:id/artifacts` | Provider-side Docker job artifact manifest |
| `GET /v1/tasks/:id/artifacts/:name` | Download a task artifact |
| `GET /v1/resources?type=:type&provider=:pubkey&q=:query&minVramGb=:gb` | List agent-leaseable resources |
| `POST /v1/resources` | Publish a VPS, GPU, dataset, repository, project, or storage resource |
| `GET /v1/resources/:id` | Resource details |
| `POST /v1/delegations` | Grant an agent bounded budget, duration, and resource-scope authority |
| `GET /v1/delegations?userPubkey=:pubkey&agentId=:agent` | List delegation envelopes |
| `POST /v1/leases` | Ask an agent to lease a resource under a delegation |
| `GET /v1/leases?userPubkey=:pubkey&providerPubkey=:pubkey&agentId=:agent` | List leases |
| `GET /v1/leases/:id` | Lease details |
| `POST /v1/leases/:id/revoke` | Revoke a lease and credential reference |
| `GET /v1/leases/:id/credentials?userPubkey=:pubkey&agentId=:agent` | Reveal active lease credentials |
| `POST /v1/approvals` | Create a human approval request for a task action |
| `GET /v1/approvals?status=:status&userPubkey=:pubkey&agentId=:agent&taskId=:id` | List approval requests |
| `GET /v1/approvals/:id` | Approval request details |
| `POST /v1/approvals/:id/decide` | Approve or reject an approval request |
| `GET /v1/account/:address` | Cached account data |
| `GET /v1/tx/:signature` | Cached transaction data |

Cloud remote-control relay endpoints:

| Endpoint | Description |
|---|---|
| `GET /v1/docks` | List Docks bound to the current Cloud account |
| `POST /v1/docks/:dockId/commands` | Enqueue an allowlisted local Dock command |
| `GET /v1/docks/:dockId/commands/:commandId` | Read command status/result |
| `GET /v1/docks/:dockId/commands/next` | Bound Dock polls for the next command |
| `POST /v1/docks/:dockId/commands/:commandId/result` | Bound Dock returns the command result |

Compatibility endpoints remain available for older clients:

| Endpoint | Description |
|---|---|
| `GET /v1/products` | Legacy product feed |
| `POST /v1/products` | Legacy listing creation |
| `GET /v1/product/:id` | Legacy product details |
| `POST /v1/orders` | Legacy order creation |
| `GET /v1/orders?party=:pubkey&role=buyer\|seller` | Legacy order list |
| `GET /v1/orders/:id` | Legacy order details |
| `POST /v1/orders/:id/simulate-payment` | Mark a legacy order as simulated paid |
| `POST /v1/orders/:id/status` | Advance a legacy order status |

## Roadmap

1. Add node registration, heartbeat, resource probes, and signed manifests.
2. Add provider adapters for browser sandbox, storage, dataset/API credential,
   repository workspace, VPS/container, and GPU backends.
3. Add lease fulfillment hooks: accept, provision, meter, revoke, and expire.
4. Add evidence packets: delegation hash, lease hash, credential issuance,
   usage meter hash, probe logs, and result hash.
5. Add auditor-agent workflows for resource checks and dispute verdicts.
6. Add Solana-settled receipts for escrow, payment, proof, reputation, staking,
   and slashing.
7. Add Exora Dock Console as a desktop UI shell over the same daemon.

## Design Principle

Exora Dock should always be:

- User-owned.
- Agent-operated.
- Policy-bounded.
- Capability-oriented.
- Machine-readable.
- Proof-producing.
- Ready for onchain settlement.

## License

MIT
