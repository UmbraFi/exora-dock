<!-- Source: WHITEPAPER.md; normalized-sha256: 0caedf36b2a15b54e0f090846db14d20dd4c84a002b55f53e85187b238342276 -->

# Exora V2 Whitepaper

**Version: V2 Alpha**
**Positioning: a lightweight transaction supervisor for user-owned Agents**

> The Agent thinks and acts. Exora wakes, constrains, authorizes, records, and resumes.

## 1. What Exora is

Exora Dock connects a user's own local Agent to durable transaction state and human authority. When a business event arrives, Exora starts or resumes the Agent, exposes authoritative state and allowed actions, asks the human when authority is required, and keeps a reviewable transaction record.

The product follows six principles: Bring Your Own Agent, Local First, State Machine First, Human Authority, Minimal Cloud, and Vendor Neutrality.

Exora does not provide model inference, resell model APIs or model tokens, store model credentials, run a Cloud review/arbitration model, act as a generic Agent, or provide an arbitrary remote-command channel. Exora has no platform token, mining, staking, buyback, or DAO roadmap.

## 2. Roles and authority

- **Humans** own identity, assets, delegation policies, evidence disclosure, and dispute positions.
- **User Agents** plan, quote, execute, deliver, and verify within explicit authority. They never receive owner credentials, wallet keys, payment PINs, or arbitration rights.
- **Dock Supervisor** owns the local Driver, transaction-scoped capability, workspace/tool boundary, raw session material, and exact resume state.
- **Exora Cloud** is authoritative for shared business state, event ordering, WakeJobs, HumanRequests, the seller-card directory, disclosed evidence, and human arbitration.
- **The chain** is authoritative for funds. Docker is an optional execution adapter, not a requirement.

## 3. Two state machines

Business state uses two dimensions:

```text
phase: intent → plan → offer → authorize → execute → deliver → verify → settle → closed
condition: active | waiting_user | waiting_agent | waiting_counterparty | blocked
           disputed | failed | completed | cancelled
```

Every mutation carries `expectedVersion` and `idempotencyKey`. Cloud atomically appends the event, updates the projection, and creates the corresponding WakeJob or HumanRequest. Clients render Cloud-provided `allowedActions`; they do not infer state from text.

Agent execution has a separate lifecycle:

```text
queued → leased → starting → running
       → waiting_input / waiting_approval / blocked
       → completed / failed / cancelled
```

An AutomationRun references the Driver, party role, vendor thread/turn, trigger event, lease epoch, permission profile, and event cursor. It is not another source of business truth.

## 4. Wake and resume

Cloud creates a typed WakeJob for a target Dock. The Dock claims a renewable lease, resolves the `(transactionId, role)` session, and starts or resumes the exact Codex app-server thread. Codex reads state through transaction-scoped MCP and submits proposals, progress, questions, offers, or deliverables.

When Codex asks a human, the current turn ends. The answer becomes a new event and WakeJob, and the same thread resumes. WakeJobs have leases, attempts, deadlines, idempotency, retry, and dead-letter behavior.

V2 Alpha supports the Windows Codex app-server Driver only. The Driver probes the locally installed version and schema. Missing login, incompatible protocol, or unavailable app-server produces `waiting_agent`; Exora never falls back to hosted inference or GUI keyboard simulation.

## 5. Buyer, seller, and public discovery

A buyer creates a private intent. Their Agent may refine scope, budget, privacy, deliverables, and acceptance criteria. The buyer then selects a seller from the public seller Agent Card directory.

A seller publishes a manually reviewed card bound to a local Agent, workspace policy, pricing policy, payment rails, and optional execution adapters. An incoming offer wakes the seller's Dock and the seller's own Agent evaluates, asks, quotes, rejects, executes, and delivers.

The public market is a seller Agent Card directory, not a product cart. Buyer Agent configuration and local paths stay private. Card review uses schema validation, deterministic rules, and human review—never Cloud inference.

## 6. Delegated automation

AutomationPolicy offers `manual`, `guarded`, and `autonomous` modes. Explicit grants may constrain counterparty, price, tools, workspace, side effects, and expiry. The Agent always proposes; Dock validates local execution authority and Cloud validates business authority.

Final dispute decisions are permanently human-only. In V2 Alpha, escrow funding, release, and refund are also human-only.

## 7. Wallet, escrow, and Docker

Wallet & Escrow remains a separate center. Recovery passwords, PINs, and signing keys stay in the local Electron/Dock process. The PWA can show state and create a human request but never transmits a PIN. Cloud records payment intent and evidence; finalized chain state determines the financial fact. Opening a dispute freezes release.

Docker Execution Center is optional. A seller card may advertise Docker/GPU policy, and a transaction manifest may choose it. Supervisor validates image, network, resource, input, and artifact boundaries. Work that does not require Docker runs in the authorized Agent workspace.

## 8. Evidence and human arbitration

Cloud stores structured plans, offers, questions and answers, proposals, approvals, run summaries, deliverable hashes, payment evidence, and failures. Full prompts, vendor threads, local paths, workspaces, credentials, and raw files stay local by default.

Transaction events carry sequence, previous hash, event hash, actor, role, device, version, idempotency key, and signature. During a dispute, each party explicitly selects and redacts local material before uploading an EvidenceBundle.

Exora human arbitrators use a separate MFA-protected, audited role. A decision cites evidence and includes a reason. Agent-generated analysis is non-binding and can never become the verdict.

## 9. Security and recovery

- PWA reads Cloud state directly and remains useful while a Dock is offline.
- Offline PWA data is read-only and visibly stale; authority writes are never queued offline.
- Web Push carries only an event identifier.
- Run capabilities bind transaction, role, action, workspace, expiry, and run.
- Agents cannot call owner, wallet, arbitration, or arbitrary local-command interfaces.
- While Cloud is unavailable, only reversible local analysis may continue.
- Closing Electron hides it to the tray; explicit Quit checkpoints and pauses automation.

## 10. V2 Alpha commitment

V2 Alpha includes Windows tray Dock, Codex app-server start/resume/interrupt, the transaction ledger, WakeJobs, HumanRequests, scoped MCP, seller Agent Card discovery, Inbox/Transactions/Market/Wallet/Execution/Agent surfaces, manual Solana escrow, optional Docker execution, selective evidence disclosure, human arbitration, and Postgres production persistence.

It excludes Claude/ACP Drivers, GUI automation, delegated fund signing, a Cloud Agent, model credentials, platform tokens, miners, staking, and DAO governance.
