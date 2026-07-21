# Exora V4 API-only whitepaper

## One contract, two validations, two product steps

Sellers or their authorized Agents submit one `exora.api-contract.v1` JSON
document. The document combines the callable API contract, safe Seller-prepared
cases and explicit automated billing rules. Exora owns the generated test plans,
hashes, signed receipts and owner confirmation state; those fields are never
accepted from the source file.

During validation, each source billing rule becomes a platform-owned
`exora.operation-pricing.v4` projection governed by
`exora.operation-settlement.v4`.

The Provider workflow has two visible steps. **Contract validation** separately
verifies connectivity/response formats and billing/settlement, then asks the
owner for one confirmation covering the exact tested projections. **Operations**
then controls publication, lifecycle, fulfillment, usage, revenue and automatic
protection. A source change invalidates both validations.

Exora is one commercial API market for Agents. `applicationSource` is fixed to `api`; `deliveryMode` is `local_dock` or `cloud_direct`. The buyer catalog does not split delivery modes into product categories.

## Local API integrations

A useful local implementation can become paid supply by keeping Exora Dock online. The seller does not first need a public website, UI, domain, hosting, auth, metering and billing stack.

Exora does not provide a dedicated Agent. A seller's existing Codex, Claude Code, Cursor, or other MCP client follows a Dock-enforced Integration Session through discovery, capability design, Adapter generation, static validation, human execution approval, runtime validation, and commercial review. It can read only human-authorized sources and can write only `<authorized-root>/.exora/generated/<integrationId>`. Each file is limited to 256 KiB, with at most 100 files and 5 MiB per Integration. Absolute paths, traversal and symlinks are rejected.

The result is one Exora Adapter: an executable Adapter for local code, functions, CLI programs, or protocol-converting HTTP services; or a declarative Adapter for a public HTTPS API that Cloud can proxy from its OpenAPI 3.1 contract. Only the human owner can approve `executable + args[]`, select Vault credentials, accept side effects and commercial rights, set final pricing, create a private draft, or publish. Dock never executes shell strings or installs dependencies.

## Provider Operation contract and operations

Every Operation completes two visible steps: (1) Contract validation derives separate integration and billing projections from one `exora.api-contract.v1` source, validates connectivity and machine-checkable request/response formats, then validates the explicit billing rule with Dock formula preflight and the no-real-USDC Cloud Sandbox Ledger; the owner confirms the exact tested pair once; (2) Operations manages `offline / live / draining`, fulfillment, usage, revenue and protection state. A source change clears both receipts and the contract lock.

Exora does not compare dynamic business output values or judge whether a generated summary, prediction, or other semantic result is correct. Each Operation instead supplies at least one safe repeatable Seller fixture containing a real request and an `expectedProtocol` response selector. Exora checks HTTP status, media type, JSON Schema 2020-12, declared constants, public error envelopes, protocol rules, limits, and metering evidence. The owner alone confirms that the observed output represents the advertised capability.

Exora neither chooses nor generates prices. Fixed execution, successful delivery, tokens, time blocks, streaming, async jobs, document/media/batch and tiered rules live in an independent read-only Pricing Book. Provider-side Agents may encode only seller-directed values in the source contract and explain consequences; they cannot run tests or confirm the contract.

Formulas may reference only dimensions verified by the integration receipt plus the Cloud-owned `delivered` variable, use only positive constant divisors, and must remain defined and non-negative throughout declared bounds. Constant formulas are valid. `delivered` is `1` for success and `0` after execution cancellation; before-execution cancellation, business errors and system faults bypass the formula and charge zero. Provider-attested metering appears in buyer-visible receipts; missing, conflicting, illegal or out-of-range values trigger a full refund and block new calls. Sandbox tests prove `chargedAtomic + refundedAtomic = reservedAtomic`.

Cloud signs each V4 billing receipt with Ed25519. Dock verifies the signature and the API UID, version, integration-receipt, pricing, formula-AST and plan hashes before owner price confirmation; Cloud verifies the same bindings again before publication.

The exact wire contracts are `exora.price-formula.v4`, `exora.operation-billing-plan.v4`, and `exora.operation-billing-receipt.v4`; Pricing V3 receipts are never accepted.

## Manifest and invocation

ExoraServiceManifest v2 (`exora.service_manifest.v2`) uses OpenAPI 3.1, Operation Policy, metering and Artifact declarations. Billing is authored inside `exora.api-contract.v1` and projected into the platform-owned Pricing V4 contract only during validation. Interaction is `request_response`, `server_stream`, or `async_job`. Jobs move from `queued` to `running`, then `succeeded`, `failed`, `cancelled`, or `expired`; progress uses SSE and cancellation propagates to the local Supervisor.

Artifacts contain id, name, MIME, exact size, SHA-256, purpose and expiry. Defaults are 1 GiB per Artifact, 5 GiB staged per account, 24 hours for unbound uploads and 72 hours for successful outputs. Large files never appear in JSON or SSE.

## Reputation and arbitration

One review is allowed per API Order after a successful paid Invocation and is editable for seven days. Quality, contract adherence and value are separate 1–5 scores. Buyers appear as Verified Purchase; sellers may reply once. Exora computes no total reputation score and does not use reputation for ranking or admission.

Connection, start, timeout, schema/SSE and Artifact integrity failures auto-refund in full. Subjective disputes bind to one paid Invocation and open within 72 hours. Sellers respond within 48 hours; platform decision targets 72 hours; each party has one 72-hour appeal. Refunds may be partial and commission reverses proportionally. Arbitrators may pause a Listing.

Invocation bodies are not retained by default. Parties submit redacted evidence or hashes and separately consent to arbitrator access. Evidence access is audited and bodies are deleted 30 days after final closure.

## Reset

V4 is a destructive test reset. Accounts, Sessions, API Keys, Listings, balances and history are recreated. Reset refuses non-test environments, mainnet custody records and non-zero account balances. Identity stays on `/v1`; the market is `/v4` with no compatibility fallback.
