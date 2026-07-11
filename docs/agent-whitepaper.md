# Exora Supervisor / Agent Integration Specification

**Protocol:** V2 Alpha
**Initial Driver:** Codex app-server on Windows

## 1. Purpose

This specification defines how Exora Dock discovers, starts, constrains, pauses,
and resumes a user-owned Agent. Exora is the transaction reference monitor; it is
not the reasoning model.

## 2. Process ownership

```text
Electron tray
  └─ Go Dock daemon
      ├─ Cloud WakeJob client
      ├─ Supervisor / AutomationRun store
      ├─ Codex app-server Driver
      ├─ transaction-scoped MCP server
      └─ local evidence/outbox store
```

Electron owns user interaction and tray lifecycle. The Go daemon owns all runtime,
lease, Driver, session, and authorization decisions. Renderer code must not spawn
or control Agent processes directly.

## 3. Agent Registry

An Agent registration contains:

```json
{
  "id": "codex",
  "driverKind": "codex_app_server",
  "roles": ["buyer", "seller"],
  "automationMode": "guarded",
  "workspaceRoots": ["C:\\Work"],
  "maxConcurrency": 1
}
```

Registry probing reports executable path, version, login status, app-server
availability, supported methods, and protocol/schema fingerprint. It never asks for
or stores a model credential.

## 4. Driver interface

```go
type Driver interface {
    Kind() DriverKind
    Probe(context.Context, AgentConfig) (CapabilityReport, error)
    StartSession(context.Context, SessionRequest) (ExternalSession, error)
    ResumeSession(context.Context, ResumeRequest) (ExternalSession, error)
    StartTurn(context.Context, TurnRequest, EventSink) (TurnRef, error)
    Steer(context.Context, SteerRequest) error
    Interrupt(context.Context, InterruptRequest) error
    Close(context.Context) error
}
```

Codex uses JSONL over stdio. The implementation initializes once, starts or resumes
an exact thread, starts a turn, consumes item/turn events, and interrupts on lease
loss or explicit cancellation. The Driver probes the installed Codex schema instead
of hard-coding enum values.

There is no automatic fallback to GUI input, a new unbound thread, or an Exora model
service.

## 5. Session binding

One vendor thread is bound to one `(transactionId, partyRole)` pair. The mapping is
local-only and persists across daemon/Electron restarts.

```text
transactionId
role
driverKind
vendorSessionId
lastVendorTurnId
lastEventCursor
workspaceRoot
protocolFingerprint
```

A missing or incompatible stored session moves the transaction to `waiting_agent`.
Supervisor must not silently replace it with an unrelated thread.

## 6. WakeJob and run lease

A WakeJob contains job ID, transaction ID, target Dock, role, reason, trigger event,
expected state version, availability/deadline, attempt, lease epoch, and idempotency
key.

Claiming creates or resumes one AutomationRun. The Dock renews the lease while a
turn is active. Completion references the resulting transaction event. An expired
epoch cannot complete after another worker has reclaimed the job.

## 7. Run capability

Each Agent process receives a short-lived capability through its environment. It is
bound to:

- transaction and run IDs;
- buyer or seller role;
- allowed MCP actions;
- allowed workspace roots;
- expiry and revocation state;
- current lease epoch.

It is never included in prompts, command-line arguments, Cloud events, or logs.
Owner tokens and wallet credentials are never available to the Agent.

## 8. MCP surface

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

Every mutating call includes `runId`, `expectedStateVersion`, and `idempotencyKey`.
The MCP server validates capability scope before forwarding a typed proposal. It
does not expose a generic HTTP, filesystem, wallet, shell, or arbitration proxy.

## 9. Human input

An Agent never waits indefinitely inside a turn for a human. `request_user_input`
creates a Cloud HumanRequest, records a local checkpoint, and ends the current turn.
The user's response becomes a new transaction event and WakeJob; Supervisor resumes
the same vendor thread.

## 10. Local and Cloud evidence

Supervisor stores the full local Driver event stream only for bounded debugging and
evidence preparation. Cloud receives structured progress, proposals, authority
decisions, deliverable hashes, and redacted summaries. Raw transcript or workspace
content is uploaded only through an explicit evidence-disclosure action.

## 11. Failure semantics

- Codex missing or logged out: `waiting_agent` plus a human setup request.
- app-server crash: checkpoint, retry within WakeJob policy, then `blocked`.
- Cloud unavailable: continue reversible analysis only; queue a signed local outbox.
- version conflict: stop the turn, refresh state, and create a new WakeJob.
- lease lost: interrupt immediately; stale completion is rejected.
- capability violation: reject, audit, and block repeated attempts.

## 12. Required tests

- fake app-server start/resume/interrupt and malformed/unknown events;
- exact thread recovery after daemon restart;
- duplicate WakeJob starts one turn;
- expired lease epoch cannot complete;
- cross-run, cross-role, expired, and revoked capabilities fail closed;
- human question ends and later resumes the same thread;
- prompt injection cannot obtain owner, wallet, or arbitration authority;
- no code path sends a request to a model API.
