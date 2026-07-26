# Exora Dock

Exora Dock is the desktop workbench, local runtime, and MCP security boundary for the Exora commercial API-only capability market. It lets Buyer Agents invoke validated and billed API Operations and lets Sellers connect local programs or public HTTPS APIs to the same market, while keeping credentials, price confirmation, publication, and lifecycle actions under human control.

> Current version: `0.1.0-preview.5` Technical Preview. This document reflects the workspace as of 2026-07-27. “Implemented” means code and automated checks exist; it does not mean real Cloud, funds, or production acceptance has been completed.

## Single product model

Exora currently has one public market and one public capability source. Buyers see a unified API Operation Catalog; execution location does not create separate product categories.

| Dimension | Current value | Meaning |
| --- | --- | --- |
| `applicationSource` | `api` | The only public capability source |
| `deliveryMode` | `local_dock` | The Seller keeps Dock online and supplies an approved local Adapter through an outbound Tunnel; service addresses and credentials remain on the Seller device |
| `deliveryMode` | `cloud_direct` | Exora Cloud calls the Seller-authorized public HTTPS API; Cloud stores runtime credentials encrypted |
| `interaction` | `request_response` | Synchronous request and response |
| `interaction` | `server_stream` | Streaming progress or results over SSE |
| `interaction` | `async_job` | An asynchronous Job that can be queried, observed, and cancelled as declared |

The public invocation graph is fixed:

`API → Operation → Invocation → optional Job / Artifact`

The four former `applicationSource` values `vm`, `resources`, `endpoint`, and `api_bridge` have all been removed. V4 provides no such categories, purchase flows, or compatibility fallback. Artifacts are validated large-file inputs and outputs of API Invocations, rather than independently downloadable resource products; short-lived download grants serve only to transport Artifacts securely.

### Version names

- Identity, registration, and device linking continue to use `/v1`.
- Market, API, Operation, Invocation, Job, Artifact, Order, and Ledger use `/v4`; there are no `/v3` market routes.
- `exora.api.v3` names the current Provider capability Schema version and does not indicate the retired market model.
- The single Seller source file is `exora.api-contract.v1`; automated billing uses Pricing and Settlement V4 contracts.
- The public protocol does not branch on `productKind`. Operation is the smallest independently validated, billed, published, and protected unit.

## What Exora Dock does

### Buyer

- Search callable Operations and read their API, delivery mode, availability, and prices.
- Obtain an estimate before invoking, create an Invocation, and recover its result after disconnection or restart.
- Query or cancel Jobs that declare cancellation support, and observe SSE progress.
- Create Artifact Uploads for large inputs, complete upload validation, and obtain short-lived download grants for output Artifacts.
- Inspect API Orders, their invocations, the account Ledger, and settlements.
- Disable an API Order; re-enabling must return to human PIN approval.

### Seller

- Create a `Local API` or `Cloud API` Draft in Desktop. Both belong to the same API market and differ only in `deliveryMode`.
- Have Dock create a stable `apiId`, and safely create, update, and retry Drafts using idempotency keys and versions.
- Use an existing Codex, Cursor, OpenCode, Claude, or OpenClaw Agent to prepare a complete API contract through restricted MCP tools.
- Derive deterministic validation plans from OpenAPI 3.1, Operation Policy, safe test cases, metering declarations, and owner-specified billing rules.
- After owner confirmation, publish, republish, take offline, drain, or force-stop an Operation, and inspect fulfillment, usage, revenue, refunds, faults, and protection.

### Dock security boundary

- MCP initialization creates scoped, expiring, revocable local Agent Sessions; persistence stores only token hashes.
- Agents may prepare and update non-Live Drafts, but cannot run external validation, confirm contracts, select prices, publish, take offline, or force-stop on a human's behalf.
- Generated files can be written only to `<authorized-root>/.exora/generated/<integrationId>`; absolute paths, traversal, and symlinks are rejected.
- Each generated file is limited to 256 KiB, each Integration to 100 files and 5 MiB. Dock neither executes shell strings nor installs dependencies automatically.
- Local API credentials stay in an account-isolated local Vault and are resolved only during invocation. Contracts and logs must contain no secrets.
- Desktop protects Cloud Sessions with Electron `safeStorage`; when secure system storage is unavailable, Sessions remain only in process memory. Payment PINs are never written to disk.
- Desktop IPC, navigation, external links, network timeouts, response reading, and credential redaction have dedicated constraints and tests.

## Two-step Provider workflow

Each API Draft can contain one or more Operations. The Seller or authorized Agent submits only one `exora.api-contract.v1`, containing the complete `exora.api.v3` capability, safe repeatable Seller cases, and explicit billing rules for every Operation. The source file carries no formal test results, signed receipts, owner confirmation state, or runtime credentials.

### 1. Contract validation

Dock derives and locks two mutually bound evidence domains from the same source contract:

1. Integration validation checks connectivity, HTTP status, Content-Type, OpenAPI 3.1 / JSON Schema, error protocols, SSE, Async, Artifacts, limits, and metering evidence.
2. Billing validation checks the `exora.price-formula.v4` formula, per-invocation maximum, and Settlement V4 conservation, obtaining a signed receipt through the Cloud Sandbox Ledger without moving real USDC.

After both validations pass, the owner confirms the exact tested contract once. Exora validates objectively machine-checkable protocols and formats; the owner still judges business semantics such as summary quality or generated-content accuracy from actual output.

### 2. Operations

Confirmation unlocks operations: `offline / live / draining`, publication, in-flight fulfillment, usage, revenue, refunds, faults, and automatic protection. Changing the source contract invalidates both validation domains and downstream locks. Live or Draining Operations cannot be directly edited or deleted.

Ordinary removal immediately rejects new calls and waits for in-flight calls to finish. Force-stop cancels unfinished fulfillment, refunds it, and records Seller responsibility. Metering anomalies, consecutive health failures, or the Provider fault-rate threshold block new calls.

## Current implementation

### Dock and MCP

- The Go daemon provides health checks, public discovery manifests, Cloud Link, local authorization, V4 HTTP routes, and a stdio MCP Server.
- Buyer MCP covers Catalog, Estimate, Invocation, Job, Artifact, API Order, and Ledger.
- Provider MCP covers the preparation guide, idempotent Draft creation, complete contract submission, Draft queries, and validation-status queries.
- Automated tests cover local service health probes, request forwarding, SSE chunking, Tunnel Ping keepalive, account isolation, and credential resolution.
- Retired market routes and MCP tools are absent from the current V4 public surface, with static checks preventing their reintroduction.

### Desktop

- The main interface contains only `Market`, `Local API`, and `Cloud API` workspaces.
- Registration, login, email verification, PIN approval boundaries, Account Key synchronization, Session expiry, and compensation for offline logout are implemented.
- The unified Operation market, remote refresh, buyer/seller order history, order invocations, settlement summaries, Wallet, and settings are implemented.
- API Draft creation, stable UIDs, name/icon editing, contract validation, the operations console, publication, and lifecycle actions are implemented.
- Agent MCP configuration detection, registration, conflict protection, and explicit repair are implemented.
- Electron builds, launches, health-checks, and shuts down the bundled Dock daemon, hiding child-process consoles on Windows.

### Schemas, billing, and examples

- The repository includes `exora.api-contract.v1`, `exora.api.v3`, Operation, Validation, Pricing, Billing Receipt, Estimate, and Settlement contracts.
- Pricing V4 implements formula parsing, complexity limits, exact monetary calculations, metering-range validation, per-invocation caps, and settlement conservation.
- [`virtual-text-summary`](./examples/virtual-text-summary/README.md) demonstrates synchronous text summaries and successful-delivery billing.
- [`mock-render-api`](./examples/mock-render-api/README.md) demonstrates zero-input local SVG output and idempotent Invocation retries.
- [`random-tarot-api`](./examples/random-tarot-api/README.md) demonstrates zero-input structured random results, SVG output, and error contracts.

## Current automated validation

The following results were revalidated in the Windows development environment on 2026-07-22:

| Check | Result |
| --- | --- |
| `go test -count=1 ./...` | Passed |
| `go build ./cmd/exora-dock` | Passed |
| `npm run build:frontend` | TypeScript and Vite build passed |
| `npm run build:electron` | 79 tests and API-only Electron static checks passed |
| `npm test` in `examples/mock-render-api` | 5 tests passed |
| `npm test` in `examples/random-tarot-api` | 4 tests passed |

These results verify local code, protocol constraints, state transitions, and UI structure. They do not establish acceptance against real Cloud, real funds, sustained load, or cross-platform installation.

## Not yet fully validated

| Area | Current evidence | Remaining work |
| --- | --- | --- |
| Real Cloud | Client, authentication, proxying, signed receipts, and error handling implemented and unit-tested | Complete the registration, PIN, Account Key, publication, purchase, invocation, settlement, reconnection, and revocation golden path in a shared environment |
| Both delivery modes | Drafts, contracts, credential boundaries, and local Tunnel implemented | Validate initial publication, updates, fault recovery, and republication for local outbound Tunnels and public HTTPS services separately |
| Three interaction modes | Synchronous, SSE, Async, and Artifact protocol boundaries implemented | Examples mainly cover synchronous calls; add SSE, long Jobs, cancellation, disconnect recovery, and large-file end-to-end cases |
| Lifecycle | Offline, Live, Draining, force-stop, refund, and protection state machines tested | Validate draining, force-stop, health faults, metering anomalies, and refund consistency under real concurrency and in-flight calls |
| Multiple accounts | Store, Vault, cross-account request prevention, logout cleanup, and migrations tested | Manually accept repeated real A/B account switching, crash recovery, offline logout, and old data |
| Desktop security | IPC, navigation, network timeouts, credential redaction, and secure-storage fallback tested | Exercise system keychains, certificates, proxies, and permissions on Windows and macOS |
| Releases | Preview 5 workflow targets Windows x64 Portable ZIP and macOS ARM64 DMG, generating a signed release manifest and SHA-256 | Complete clean builds, first-launch, upgrade, and data-retention smoke tests on both platforms |
| UI | Main buttons, workspaces, text sizes, and action boundaries statically checked | Complete visual regression, keyboard, screen-reader, high-DPI, small-window, and English/Chinese completeness checks |

### Known engineering gaps

- Some Desktop market guides still display retired-product copy. `docs/DESKTOP_DEV.md` and `deploy/exoradock/README.md` also describe obsolete models and cannot serve as sources of current V4 product facts.
- Some CSS, Go files, and internal functions retain historical V3 names. The public protocol is V4, but internal naming cleanup remains incomplete.
- The Electron test command in `desktop/package.json` still references the missing `electron/ui-system.test.cjs`; Node currently does not fail for this, so that coverage must be restored or explicitly removed.
- Preview 5 does not release Linux packages. Executables in the Windows portable ZIP are not yet Authenticode-signed; the macOS DMG application uses ad-hoc signing and is not yet notarized.
- Existing automation mainly validates structure and state machines; it cannot replace API business-result, real-funds, and production acceptance.

## Next goals

### P0: Complete the API-only transition

- Remove obsolete product copy and invalid entry points from Desktop, development docs, deployment references, build scripts, and styles.
- Add a unified public-surface regression gate permitting only `applicationSource=api` and `local_dock / cloud_direct` delivery modes.
- Align README, whitepaper, Schema, Desktop, and Cloud descriptions of the two-step Provider workflow.

### P1: Establish the real Cloud golden path

- Use existing examples to complete Provider Draft creation, validation, owner confirmation, publication, updates, removal, and republication.
- Complete Buyer search, estimates, invocation, settlement, result recovery, Order disabling, and PIN-based re-enablement requests.
- Fix the V4 request, error, signed-receipt, and version-compatibility contracts between Dock/Desktop and Cloud.

### P2: Complete interaction and reliability validation

- Add SSE, Async Job, cancellation, and large-file Artifact examples.
- Test the local Tunnel for concurrency, backpressure, slow responses, timeouts, reconnection, and sustained operation.
- Validate Draining, force-stop, automatic protection, and refund conservation with real in-flight calls.

### P3: Establish reproducible releases

- Fix missing test files and obsolete build remnants so CI fails directly on missing inputs.
- Complete clean-build, installation, upgrade, uninstall, and rollback tests on Windows x64 and macOS ARM64.
- Complete Windows signing and macOS signing/notarization, then evaluate restoring Linux releases after validation passes.

## Local development

### Requirements

- Go `1.25.x`
- Node.js `22.x` and npm; current CI uses Node `22.23.1`
- Windows or macOS; core Go code can also be developed on Linux, but Preview 5 does not release Linux desktop packages

### Run the Dock daemon

```powershell
go run ./cmd/exora-dock .\config.example.yaml
```

See [`config.example.yaml`](./config.example.yaml) for defaults. Development can point to local Exora Cloud through `cloud_url` or `EXORA_CLOUD_URL`.

### Run the MCP Server

Start the Dock daemon first, then open another terminal:

```powershell
go run ./cmd/exora-dock mcp .\config.example.yaml
```

Desktop can also detect, generate, or repair MCP configurations for supported Agents.

### Run Desktop

```powershell
cd desktop
npm ci
$env:EXORA_CLOUD_URL = "http://127.0.0.1:8090"
npm run preview:desktop
```

`preview:desktop` rebuilds the bundled daemon from current Go source, then starts Vite and Electron. Packaged builds require an explicit HTTPS Cloud URL.

### Run tests

```powershell
go test -count=1 ./...

cd desktop
npm run build:frontend
npm run build:electron

cd ..\examples\mock-render-api
npm test

cd ..\random-tarot-api
npm test
```

## Directory layout

| Path | Contents |
| --- | --- |
| [`cmd/exora-dock`](./cmd/exora-dock) | Dock daemon, MCP, authentication, and Cloud Link CLI |
| [`api`](./api) | Local V4 HTTP handlers and Cloud proxy |
| [`internal`](./internal) | MCP, account isolation, local delivery, Tunnel, Provider Drafts, validation, billing, and lifecycle |
| [`desktop`](./desktop) | Electron + TypeScript/Vite desktop client |
| [`contracts`](./contracts) | API, Operation, Validation, Pricing, and Settlement Schemas/fixtures |
| [`examples`](./examples) | API-only Provider examples and test contracts |
| [`skills/prepare-exora-api`](./skills/prepare-exora-api/SKILL.md) | API preparation workflow for Seller Agents |

## Further reading

- [V4 English whitepaper](./docs/WHITEPAPER.en.md)
- [V4 Chinese whitepaper](./docs/WHITEPAPER.md)
- [API Operation technical model](./docs/API_OPERATION_MODEL.md)
- [MIT License](./LICENSE)
