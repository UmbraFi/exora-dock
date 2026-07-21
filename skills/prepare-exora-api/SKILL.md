---
name: prepare-exora-api
description: Prepare one complete exora.api-contract.v1 source file from authorized seller material. The file contains API capability, safe Seller cases and explicit seller-directed billing rules; Dock runs and confirms validation separately.
---

# Prepare Exora API

The authoritative output is one UID-free `exora.api-contract.v1` JSON file.
Dock binds it to the selected stable API UID during submission. It contains a complete `exora.api.v3` capability, OpenAPI input
and output schemas with parameter semantics, safe Seller cases, trusted meters,
and exactly one explicit automated billing rule for every Operation. An Agent
may encode pricing intent explicitly supplied by the seller, but must never
choose or recommend rates.

Submit the complete file with `exora.submit_api_contract`, then stop. Only the
owner can run the separate integration and billing validations, confirm the
exact tested contract once, publish it, or change lifecycle.

Use Exora MCP as the preparation manual and source of step-by-step instructions.

1. Connect to the seller's Exora Dock MCP server. If `exora.get_api_preparation_guide` is unavailable, stop and ask the seller to connect or restart Dock.
2. Identify the closest `startingPoint` and intended `deliveryMode`.
3. Begin at `assess`, follow each returned evidence requirement and stop on blockers.
4. At `assemble_form`, build one UID-free `exora.api-contract.v1`; do not put `apiId` in the root or capability. Include the complete `exora.api.v3` capability, authoritative OpenAPI 3.1 response contracts, safe capability-specific fixtures, trusted metering declarations, and exactly one explicit billing rule per Operation. Do not invent a `request` meter for fixed pricing. Fixtures select expected protocol formats and must never contain an expected dynamic business result.
5. At `submit`, select the intended existing non-Live Draft. If none exists, call `exora.create_api_draft` once with the seller-supplied title, delivery mode and a retry-safe idempotency key. Then call `exora.submit_api_contract` with that returned `apiId`, current `expectedVersion`, complete contract and a separate retry-safe idempotency key.
6. Resolve static contract issues, read the current draft, then stop for the owner to run Contract validation and confirm the two receipts once.

Never submit credentials, owner confirmation, execution approval, commercial-rights declarations or lifecycle changes. Never choose price values on the seller's behalf. Dock validation and checked-in contracts are authoritative.
