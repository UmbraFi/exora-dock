# Local Codex Driver Discovery

> **Legacy V2 document.** This describes discovery for the existing V2 Agent driver. V3.2 keeps user-owned Agents as MCP consumers but no longer requires a provider Agent. See [WHITEPAPER.md](./WHITEPAPER.md).

This document defines the Windows V2 Alpha discovery and wake path. It is a
single-driver contract: Exora discovers the user's existing Codex installation
and never asks for a model credential.

## Discovery

Electron and the Dock Supervisor probe, in order:

1. the configured Codex executable;
2. `codex` on `PATH`;
3. the installed version;
4. the user's existing login state;
5. `codex app-server` protocol availability.

The Local Agents settings page reports those results in the original Electron
settings layout. It stores only role assignment, workspace roots, automation
mode, and concurrency. Codex authentication remains owned by Codex.

A failed probe sets the affected AutomationRun to `waiting_agent`. Exora does
not fall back to a hosted inference endpoint and does not create a replacement
thread without context.

## Wake and resume

Cloud emits a WakeJob after committing the transaction event and projection in
the same database transaction. A linked Dock claims a time-bounded lease,
validates the local AutomationPolicy, and asks the Codex Driver to start or
resume the thread for `(transactionId, role)`.

The Driver uses the app-server JSONL lifecycle:

- initialize and capability probing;
- thread start or exact thread resume;
- turn start, steer, or interrupt;
- ordered event consumption;
- checkpoint and completion reporting.

The exact vendor thread ID is persisted locally. A user answer becomes a Cloud
event and a new WakeJob, so the next turn resumes the same thread.

## MCP surface

The transaction MCP server exposes only:

- `claim_run`
- `get_transaction_state`
- `get_allowed_actions`
- `search_agent_cards`
- `report_progress`
- `request_user_input`
- `request_approval`
- `propose_transition`
- `submit_offer`
- `submit_deliverable`
- `report_blocked`

Every mutation includes `runId`, `expectedStateVersion`, and
`idempotencyKey`. Cloud computes `allowedActions`; neither Codex nor the UI
infers them from strings.

## Capability boundary

Each AutomationRun receives a short-lived capability bound to one transaction,
one participant role, an action allow-list, permitted workspace roots, and an
expiry. The Dock validates the capability before local execution and Cloud
validates transaction state and AutomationPolicy before accepting an event.

Owner tokens, wallet private keys, payment PINs, recovery passwords, and
arbitration decisions never enter Codex prompts, app-server messages, or MCP
arguments.

## Electron lifecycle

Closing the window hides the app to the tray so WakeJobs can continue. Windows
login startup is enabled for packaged builds. Explicit Quit checkpoints active
runs, marks the Dock offline, stops the tracked daemon and Codex child process,
then exits.

V2 Alpha intentionally excludes additional Agent Drivers and GUI keyboard
automation. They can be added later behind the same AgentDriver interface
without changing the transaction or authorization contracts.
