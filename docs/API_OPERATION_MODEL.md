# Exora Provider Operation Model V3

## Seller source contract and two-step workflow

Provider onboarding has one seller-authored source document: `exora.api-contract.v1`.
It contains one complete `exora.api.v3` capability (including
OpenAPI input/output schemas, parameter semantics, trusted metering and safe
Seller fixtures), plus one automated billing rule for every Operation. It does
not contain test results, owner approval, runtime credentials or publication
state.

Dock projects that source into two independently hashed validation domains:

1. **Contract validation** runs integration validation first (reachability,
   protocol and response format), then billing validation (formula safety and
   Sandbox Ledger settlement). Seller fixtures select status/media type/schema;
   dynamic business values are never used as an oracle. Both receipts must pass
   before the owner can confirm the exact contract once.
2. **Operations** unlocks only after that confirmation and owns publish,
   offline/live/draining lifecycle, fulfillment, usage, revenue and protection.

Replacing the source contract while offline invalidates both projections and
both receipts. Live or draining Operations are immutable.

Exora uses the canonical graph `API -> Operation -> Invocation -> optional Job / Artifact`. OpenAPI 3.1 is the only authority for request and response formats. An Operation is the smallest independently validated, billed, published, and protected unit.

## What Exora validates

The Seller declares capability, protocol, and at least one safe repeatable success fixture. Usage metering is optional and is declared only when the pricing formula needs a real usage dimension; a fixed invocation charge does not require a synthetic `request` meter. A fixture contains a real request and selects an OpenAPI response branch through `expectedProtocol`; it does not contain `expectedResponse`.

Exora validates HTTP status, media type, JSON Schema 2020-12, declared constants, limits, error envelopes, SSE/Async/Artifact protocols, and metering evidence. Dynamic business values may differ between runs and are never judged semantically. The owner reviews the observed behavior and alone confirms that it represents the advertised capability.

## Authoritative contracts

- `exora.api.v3.schema.json`
- `exora.operation.v3.schema.json`
- `exora.operation-validation-plan.v3.schema.json`
- `exora.operation-validation-receipt.v3.schema.json`
- `exora.operation-pricing.v4.schema.json`
- `exora.price-formula.v4.conformance.json`
- `exora.operation-billing-plan.v4.schema.json`
- `exora.operation-billing-receipt.v4.schema.json`
- `exora.operation-estimate.v3.schema.json`
- `exora.operation-settlement.v4.schema.json`

V1 and V2 Provider Operation contracts are not accepted or migrated.

## Two-step owner workflow

1. **Contract validation** — upload or Agent-submit one source contract; run the derived integration plan and then the derived billing plan; review both receipts; confirm and lock the exact tested pair once.
2. **Operations** — publish, take offline, drain, or force-stop an Operation and inspect in-flight work, usage, revenue, refunds, faults, and protection events.

Replacing the source contract clears both validation domains, all receipts and downstream locks. Live or draining Operations are immutable and cannot be deleted.

## Deterministic integration validation

The validation plan is derived only from normalized OpenAPI, Seller fixtures, interaction, public errors, artifacts, limits, and metering declarations. Identical input yields the same `planHash`; the plan is read-only and cannot become a second test-definition editor.

Runs use controlled HTTP execution and persist a run ID. Receipts bind API UID, Operation ID and version, integration/OpenAPI/plan hashes, each machine check, timing, status, media type, response size, schema results, metering summary, and evidence hashes. Only a redacted summary of at most 4 KiB is retained; secrets, auth headers, and full request/response bodies are not stored.

## Automated billing rule V4

Every seller source contract explicitly supplies `chargeFormula`, a positive `maximumChargePerInvocationAtomic`, `currency: USDC`, and `settlementPolicy: exora.operation-settlement.v4` for each Operation. There are no template IDs, automatic formula generation, or silent defaults. An Agent may encode seller-supplied intent but cannot choose rates, run validation or confirm the contract. The independent Exora Pricing Book is read-only.

A formula may reference only metering dimensions verified by the locked integration receipt and the Cloud-owned `delivered` variable. `delivered` is `1` for successful delivery and `0` for execution cancellation. Every metering dimension declares its unit, source, per-invocation maximum, and Provider evidence location when applicable. Unknown variables, dynamic or non-positive divisors, hidden negative values, overflow, and undefined ranges are rejected. Constant formulas are valid and total charge is always capped.

Desktop estimates are previews, not evidence. Cloud Sandbox Ledger is authoritative and signs a receipt with Ed25519, bound to API UID, Operation/version, integration receipt, pricing hash, formula AST, and billing-plan hash. Production Cloud deployments persist `EXORA_BILLING_SIGNING_SECRET` so the signing identity survives restarts. The sandbox moves no real USDC and proves `chargedAtomic + refundedAtomic = reservedAtomic` across success, errors, cancellation, faults, force-stop, zero/unit/sample/maximum use, and formula boundaries.

## Lifecycle, metering, and protection

Lifecycle is `offline | live | draining`. Ordinary removal rejects new calls and drains in-flight work. Force-stop cancels unfinished work, refunds it, and records Seller responsibility. Console state uses SSE with 15-second polling fallback.

Cloud measurements are authoritative. Provider-attested evidence appears in buyer-visible settlement receipts. Missing, conflicting, invalid, or out-of-range metering refunds the current call and blocks new calls. New calls are also blocked after two consecutive health failures, or when a 15-minute window contains at least ten calls and Provider fault rate reaches ten percent.

## Agent boundary and stable UID

Agents may create or update non-live integration drafts, draft fixtures, explain missing declarations, and read plans/runs/failures. Agents cannot run external validation, confirm capability, write or lock formal pricing, publish, take offline, or force-stop.

Dock creates the canonical persistent `apiId` at draft creation and synchronizes that same UID to Cloud. Seller-authored contract JSON omits the UID; Dock injects the current Draft UID during submission. All updates still use `apiId + expectedVersion` outside the contract body. Cloud publication must return the exact UID; mismatches are rejected.
