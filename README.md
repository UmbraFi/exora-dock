# Exora Dock

Exora Dock is a lightweight transaction supervisor for user-owned Agents.

It receives durable transaction events, starts or resumes the user's local Agent,
exposes authoritative state through MCP, enforces delegated authority, asks the
human when required, and records structured evidence in Exora Cloud.

> Bring your own Agent. Exora wakes it, constrains it, asks you when authority is
> required, and keeps a verifiable transaction record.

## Product boundary

- Exora does not provide model inference or resell model APIs/tokens.
- Exora does not store model API keys.
- V2 Alpha supports the locally authenticated Codex app-server Driver on Windows.
- Seller discovery is a public seller Agent Card directory, not a product cart.
- Wallet/Solana escrow and Docker remain separate, optional centers.
- Payments are human-only in V2 Alpha.
- Dispute decisions are always made by an authorized human arbitrator.

## Architecture

```text
PWA / Electron human control surfaces
                 │
                 ▼
Exora Cloud: transaction ledger, WakeJob, authority inbox, seller cards, evidence
                 │
                 ▼
Local Dock Supervisor: Driver, run capability, workspace/tool policy, local evidence
                 │
                 ▼
User Codex app-server ── transaction-scoped MCP ──> Dock
```

Cloud is authoritative for shared business state. The chain is authoritative for
funds. Dock is authoritative for local Agent sessions, execution, raw workspaces,
and undisclosed evidence.

## V2 transaction model

```text
phase: intent → plan → offer → authorize → execute → deliver → verify → settle → closed
condition: active | waiting_user | waiting_agent | waiting_counterparty | blocked
           disputed | failed | completed | cancelled
```

Mutations require an expected state version and idempotency key. An Agent proposes
actions; Supervisor and Cloud validate them before committing state.

## Local Agent setup

1. Install Codex and sign in using your own account.
2. Start Exora Dock Desktop.
3. Open **Settings → Local Agents**.
4. Scan Codex, assign buyer/seller roles, choose an automation level, and declare
   allowed workspace roots.
5. Keep Electron in the tray to receive and resume WakeJobs.

No model credential is entered into Exora.

## MCP

The bundled daemon provides a stdio MCP server. Electron shows the exact local
command. V2 transaction tools include:

```text
claim_run
get_transaction_state
get_allowed_actions
search_agent_cards
report_progress
request_user_input
request_approval
propose_transition
submit_offer
submit_deliverable
report_blocked
```

Mutating calls use a short-lived run capability bound to transaction, role, action,
workspace, and expiry. Owner and wallet credentials never enter the Agent process.

## Privacy and evidence

Cloud receives structured events, redacted summaries, hashes, authority decisions,
and explicitly disclosed evidence. Full prompts, Codex thread content, local paths,
workspaces, private keys, PINs, and raw files remain local by default.

## Run locally

Daemon:

```powershell
go run ./cmd/exora-dock .\config.example.yaml
```

MCP server:

```powershell
go run ./cmd/exora-dock mcp .\config.example.yaml
```

Desktop:

```powershell
cd desktop
npm install
npm run dev
```

Checks:

```powershell
go test ./...
cd desktop
npm run build:frontend
npm run build:electron
```

## Documentation

- [V2 白皮书](./docs/WHITEPAPER.md)
- [V2 whitepaper](./docs/WHITEPAPER.en.md)
- [Agent integration specification](./docs/agent-whitepaper.md)
- [Agent discovery](./docs/agent-discovery.md)

## Current limits

- Windows + Codex only for automatic Driver work.
- Electron must remain running in the tray.
- Funds cannot be delegated to an Agent.
- PWA offline state is read-only.
- Claude, ACP, and other Drivers are future adapters, not current promises.
