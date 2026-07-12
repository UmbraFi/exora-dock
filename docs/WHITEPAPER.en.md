<!-- Source: WHITEPAPER.md; normalized-sha256: 9a83030e8c297069ff60c4a8d33d3f5774bc455be03287f1dfaee0fd346c5578 -->

# Exora V3.2 AI-First Resource Market Protocol Whitepaper

**Version: V3.2 Alpha**  
**Status: Draft protocol specification**  
**Positioning: an instant resource market primarily searched, purchased, and invoked by AI Agents**

> A provider installs Dock, uploads data, or submits OpenAPI to turn idle capability into revenue. A buyer's AI Agent searches, purchases, and invokes through MCP/API. Human interfaces provide management, approval, and review.

## 1. Abstract

Exora V3.2 turns prepared digital resources into standardized products that an Agent can search, purchase, and invoke. A provider may install Exora Dock to sell an idle Linux host automatically, upload a bundle sold per download, or submit OpenAPI so each operation is normalized and listed. Exora Cloud manages market, purchases, leases, usage, platform ledger, and provider payout. Dock manages local authority, real environments, file transfer, and execution.

The protocol flow is:

```text
Resource → Listing → Lease → Usage → Settlement
```

The market has three Agent products: `compute` prepurchases an exclusive server VM in integer minutes; `download` purchases a time-limited DownloadGrant for one AssetVersion; `api_operation` purchases one data row, report, query, conversion, or side-effecting OpenAPI operation. One `AgentProductManifest` describes them all.

Compute retains a strict 1:1 model: one physical computer, one `InventorySlot`, and one Consumer VM. Worker detects provider activity and pauses automatically without manual delisting. After the host becomes idle, three full checks restore the Listing. Consumer Agent receives Guest Root; Worker restores a clean VM from signed Golden Image after use.

Exora does not require a provider Agent and does not provide another chat interface. MCP/API is the authoritative market surface. Graphics are optional human aids and cannot be required to understand a product. Companion interfaces provide provider upload, OpenAPI import, pricing, revenue, resource state, approvals, billing, payout, and optional browsing.

This whitepaper specifies the V3.2 target protocol. It does not claim that the repository's current V2 implementation already provides these capabilities.

## 2. Principles and non-goals

### 2.1 Principles

1. **AI-First Market:** MCP/API is authoritative and an Agent never depends on visual pages.
2. **Bring Your Own Agent:** users keep using Codex, Claude Code, Cursor, or another MCP client.
3. **Ready Means Reserved:** an `availableNow` resource has a prepared environment and real capacity guarantees.
4. **One Host, One Slot, One VM:** one physical computer can be sold as only one exclusive compute inventory unit.
5. **Automatic Availability:** provider use pauses a host automatically; verified idle state relists it automatically.
6. **Guest Root, Host Control:** an Agent controls the leased VM but never Worker, Hypervisor, Golden Image, or the meter.
7. **Protocol over Chat:** text, Schema, price, authority, usage, and results are structured protocol data.
8. **Control/Data Separation:** MCP and HTTPS coordinate; large files and logs use dedicated data channels.
9. **Lease-scoped Cleanliness:** each Lease has an encrypted write layer that is destroyed before a verified clean reset.
10. **Meter before Settlement:** only verifiable, deduplicated UsageRecords enter the ledger.
11. **Human Ownership:** identity, funds, publishing, budgets, sensitive assets, and dispute decisions belong to humans.

### 2.2 Non-goals

V3.2 Alpha does not:

- provide or resell model inference or model tokens;
- require a Provider to supply an Agent, prompt, or model credential;
- provide a general chat interface;
- require images, video, or a graphical interface for an Agent to understand a product;
- support multiple saleable VMs on one Host, shared GPUs, MIG resale, or resource overcommit;
- initially support Hyper-V, VMware, or Windows Provider Hosts;
- carry large file bodies in MCP messages;
- infer the semantics of an API without OpenAPI;
- make meal ordering a fourth product kind or settle external meal, shipping, or merchandise charges;
- expose Host Root, libvirt socket, Provider SSH, payment credentials, or owner tokens to a Consumer or Agent;
- treat a cleanup script as equivalent to Golden Image Reset;
- claim that current code implements this protocol.

## 3. Actors and authority

### 3.1 Consumer and Consumer Agent

The Consumer is the human account purchasing resources and owns budgets, payment methods, Leases, artifacts, and authorization policy. The Consumer Agent is a user-owned MCP client. It may search, estimate, request a Lease, and act inside a valid Capability, but cannot widen its authority, rewrite usage history, or decide a dispute for the human.

### 3.2 Provider

The Provider uploads data, connects a physical computer, or publishes an API and is responsible for availability, description, price, license, and legality. Providers may self-publish, but a resource that fails automated validation cannot be listed. Identity and payout-account verification are required before first payout where the payment rail requires them.

### 3.3 Exora Dock

One Dock program supports two modes that may run together:

- **Consumer MCP:** exposes Exora tools to the local Agent and enforces local budget and approval policy.
- **Provider Worker:** runs in the Linux Host control domain, detects hardware, controls KVM/libvirt, maintains the single InventorySlot, fulfills Leases, meters usage, and resets the VM.

Dock device keys use operating-system secure storage. Worker always runs outside the Consumer VM that it creates and destroys.

### 3.4 Exora Cloud

Cloud is authoritative for accounts, Resources, Listings, InventorySlot projections, Leases, UsageRecords, the platform ledger, and Settlement. It provides market search, CapacityHold, exclusive leasing, short-lived capabilities, object-store authorization, API Gateway, refunds, and Payout.

### 3.5 Sources of truth

```text
Cloud           directory, leases, budgets, usage aggregation, ledger, settlement
Provider Worker physical hardware, live capacity, VM lifecycle, execution, reset
Hypervisor      CPU/memory/device assignment and VM isolation
Object Store    hosted file bytes and object versions
API Gateway     API requests, response status, byte counts, invocation meter
Payment Rail    deposits, withdrawals, chargebacks, external money movement
Human           publishing, budgets, sensitive grants, disclosure, disputes
```

## 4. Public protocol objects

All public objects use immutable IDs, RFC 3339 UTC timestamps, and explicit `schemaVersion`. Business writes carry an 8–128 character `idempotencyKey`; projection updates also carry `expectedVersion`. Money uses ISO 4217 currency and integer minor units. Floating-point money is forbidden.

HTTP retains the `/v3` major version. Schemas use `exora.<object>.v3alpha1`. V3 is not stable, so the V3.2 document revision does not change the Alpha Schema major version.

### 4.1 AgentProductManifest

`AgentProductManifest` is the authoritative AI-market description. `productKind` is `compute`, `download`, or `api_operation`. Natural language supports search and explanation; JSON Schema, price, limits, and errors drive deterministic use. Images or human pages cannot add a capability absent from the Manifest.

```json
{
  "schemaVersion": "exora.agent_product_manifest.v3alpha1",
  "productId": "prd_01",
  "productKind": "api_operation",
  "title": "Generate one sales report",
  "description": "Returns a structured monthly sales report.",
  "inputSchema": {"type": "object", "required": ["month"]},
  "outputSchema": {"type": "object", "required": ["report"]},
  "price": {"currency": "USD", "amount": 500, "unit": "invocation"},
  "delivery": {"protocol": "exora_gateway", "operationId": "generateSalesReport"},
  "availability": {"availableNow": true, "lastCheckedAt": "2026-07-13T08:00:00Z"},
  "sideEffect": "none",
  "version": 3
}
```

A Manifest provides stable ID, text, input/output, price, delivery, availability, privacy, idempotency, and side-effect semantics. Agent search, comparison, and purchase use the Manifest. Human interfaces render the same facts.

### 4.2 PhysicalResource

A PhysicalResource describes one indivisible Linux Host. Serial numbers, management addresses, and Host credentials are private.

```json
{
  "schemaVersion": "exora.physical_resource.v3alpha1",
  "resourceId": "res_host_01",
  "providerDockId": "dock_provider_01",
  "kind": "compute_host",
  "host": {"os": "linux", "hypervisor": "kvm_libvirt"},
  "gpu": {"model": "NVIDIA H100", "uuid": "GPU-...", "memoryBytes": 85899345920},
  "physicalCapacity": {"cpuCores": 32, "memoryBytes": 137438953472, "diskBytes": 4000000000000},
  "controlReserve": {"cpuCores": 1, "memoryBytes": 4294967296, "diskBytes": 100000000000},
  "status": "verified",
  "version": 4
}
```

A PhysicalResource can be associated with at most one saleable InventorySlot.

### 4.3 EnvironmentImage

EnvironmentImage is a signed, immutable Golden Image.

```json
{
  "schemaVersion": "exora.environment_image.v3alpha1",
  "imageId": "img_h100_cuda_01",
  "version": 4,
  "sha256": "...",
  "format": "qcow2",
  "os": "ubuntu-24.04",
  "cuda": "12.4",
  "frameworks": ["pytorch-2.5"],
  "allocatedBytes": 487214563328,
  "state": "verified",
  "lastBootVerifiedAt": "2026-07-12T10:00:00Z",
  "signature": "..."
}
```

An environment update creates a new version, verifies its hash, and boots a test VM. An active Lease remains pinned to its creation-time image version.

### 4.4 InventorySlot

InventorySlot is the only rentable compute inventory unit.

```json
{
  "schemaVersion": "exora.inventory_slot.v3alpha1",
  "slotId": "slot_h100_01",
  "resourceId": "res_host_01",
  "environmentImageId": "img_h100_cuda_01:v4",
  "vm": {"mode": "one_to_one", "consumerPrivilege": "guest_root", "gpuAssignment": "pci_passthrough"},
  "guaranteedCapacity": {"cpuCores": 31, "memoryBytes": 133143986176, "gpuMemoryBytes": 85000000000},
  "diskReservation": {"poolId": "pool_nvme_01", "workspaceBytes": 1000000000000, "allocationPolicy": "thick_accounted"},
  "availability": {"state": "ready", "availableNow": true, "lastCheckedAt": "2026-07-12T10:05:00Z"},
  "version": 9
}
```

No second saleable Slot may reference the same PhysicalResource. A Slot cannot have overlapping CapacityHolds or Leases.

### 4.5 CapacitySnapshot

Worker signs every capacity result.

```json
{
  "schemaVersion": "exora.capacity_snapshot.v3alpha1",
  "snapshotId": "snap_01",
  "slotId": "slot_h100_01",
  "checkLevel": "full",
  "checkedAt": "2026-07-12T10:05:00Z",
  "available": {"memoryBytes": 134000000000, "gpuMemoryBytes": 85200000000, "diskReservationValid": true},
  "checks": {"gpuUuidMatch": true, "unknownGpuProcesses": 0, "cudaReady": true, "imageBootable": true},
  "eligible": true,
  "failureReasons": [],
  "sequence": 81,
  "signature": "..."
}
```

`checkLevel` is `light`, `full`, or `lease_recheck`. A Snapshot proves only one instant. Lease creation requires a new `lease_recheck`.

### 4.6 CapacityHold

CapacityHold exclusively locks the Slot while funds and live capacity are verified.

```json
{
  "schemaVersion": "exora.capacity_hold.v3alpha1",
  "holdId": "hold_01",
  "slotId": "slot_h100_01",
  "consumerAccountId": "acct_buyer",
  "state": "verified",
  "nonce": "random-cloud-challenge",
  "recheckSnapshotId": "snap_lease_01",
  "expiresAt": "2026-07-12T10:07:00Z",
  "version": 2
}
```

A Hold has a short TTL. Recheck failure, reservation failure, or expiry releases it without billing.

### 4.7 Listing, Lease, and Capability

A Listing packages a Resource or InventorySlot with price, limits, delivery policy, and license. Price changes affect only new Leases. Existing Leases use an immutable PriceSnapshot.

A Lease binds Consumer, Listing, Slot, image version, maximum budget, capabilities, epoch, and billing boundary.

```json
{
  "schemaVersion": "exora.lease.v3alpha1",
  "leaseId": "lea_01",
  "listingId": "lst_h100_01",
  "slotId": "slot_h100_01",
  "environmentImageId": "img_h100_cuda_01:v4",
  "state": "active",
  "leaseEpoch": 1,
  "startsAt": "2026-07-12T10:08:00Z",
  "expiresAt": "2026-07-12T10:38:00Z",
  "billingStartedAt": "2026-07-12T10:08:12Z",
  "maxBudget": {"currency": "USD", "amount": 5000},
  "capabilities": ["guest_ssh", "run_command", "transfer", "artifacts"],
  "version": 5
}
```

A Lease Capability Token binds Lease, Consumer, Resource/Slot, actions, budget, Guest workspace, epoch, and expiry. It is shorter-lived than the Lease and cannot invoke Host, libvirt, Golden Image, ledger, or Payout interfaces.

### 4.8 ComputePurchase

Compute is prepurchased in whole minutes.

```json
{
  "schemaVersion": "exora.compute_purchase.v3alpha1",
  "purchaseId": "cp_01",
  "leaseId": "lea_01",
  "durationMinutes": 30,
  "pricePerMinute": {"currency": "USD", "amount": 20},
  "prepaidAmount": {"currency": "USD", "amount": 600},
  "state": "active",
  "activatedAt": "2026-07-13T08:00:00Z",
  "expiresAt": "2026-07-13T08:30:00Z",
  "voluntaryReleaseRefundable": false,
  "providerFaultRefundMinutes": 0
}
```

`durationMinutes` is a positive integer. CapacityHold reserves the full amount; VM and Guest verification settle it in one charge. Voluntary early release does not refund unused minutes. Failed provisioning is not charged. Provider or platform fault refunds unused whole minutes under SLA. Extension is another integer-minute purchase.

### 4.9 ProviderActivitySnapshot

```json
{
  "schemaVersion": "exora.provider_activity_snapshot.v3alpha1",
  "snapshotId": "act_01",
  "slotId": "slot_h100_01",
  "checkLevel": "light",
  "checkedAt": "2026-07-13T08:00:30Z",
  "providerGpuProcesses": 1,
  "availableGpuMemoryBytes": 12000000000,
  "availableMemoryBytes": 64000000000,
  "diskReservationValid": true,
  "availabilityState": "provider_busy",
  "pauseReasons": ["provider_gpu_process_detected"],
  "signature": "..."
}
```

The Snapshot distinguishes provider-local work from Exora Lease processes. If local work reduces guaranteed capacity, Listing pauses immediately without manual action.

### 4.10 AssetBundle, DownloadGrant, and TransferSession

AssetBundle packages one or more files, text, license, and a fixed AssetVersion as a per-purchase `download` product. Payment creates a non-transferable DownloadGrant.

```json
{
  "schemaVersion": "exora.download_grant.v3alpha1",
  "downloadGrantId": "dg_01",
  "productId": "prd_dataset_01",
  "assetVersionId": "asset_sales_2026:v3",
  "consumerAccountId": "acct_buyer",
  "pricePaid": {"currency": "USD", "amount": 900},
  "issuedAt": "2026-07-13T08:00:00Z",
  "expiresAt": "2026-07-14T08:00:00Z",
  "state": "active",
  "urlReissueCount": 2,
  "rangeRequestsAllowed": true
}
```

Provider configures a Grant duration from one hour to 30 days. During validity the Agent may reissue short-lived URLs, resume with Range, and redownload the same AssetVersion without another charge. TransferSession contains only temporary URL, Range, size, SHA-256, and transfer state.

### 4.11 ApiOperationProduct and ApprovalRequest

Every approved OpenAPI operation becomes an independent product. External effects use structured approval.

```json
{
  "schemaVersion": "exora.approval_request.v3alpha1",
  "approvalId": "apr_01",
  "productId": "prd_order_meal_01",
  "operationId": "placeMealOrder",
  "sideEffect": "external_action",
  "targetSummary": "Place one meal order with merchant M123",
  "parameterSummary": {"items": 2, "deliveryArea": "Pudong"},
  "capabilityFee": {"currency": "USD", "amount": 25},
  "externalPurchaseAmountManagedByExora": false,
  "cancellationPolicy": "Defined by target API",
  "state": "approval_required"
}
```

Exora displays and settles only `capabilityFee`. Meal, shipping, merchandise, and external payment remain the target API's responsibility. `external_action` may skip human confirmation only when the Consumer pre-authorized the exact operation, merchant scope, and service-fee budget.

### 4.12 UsageRecord and ResetReceipt

UsageRecord is an immutable metering fact signed by Provider Worker or Gateway. Cloud deduplicates on `(source, leaseId, idempotencyKey)`. Corrections are new positive or reversing entries.

ResetReceipt proves the post-Lease reset.

```json
{
  "schemaVersion": "exora.reset_receipt.v3alpha1",
  "resetReceiptId": "reset_01",
  "leaseId": "lea_01",
  "slotId": "slot_h100_01",
  "encryptionKeyDestroyed": true,
  "writeLayerDeleted": true,
  "restrictedAssetsUnmounted": true,
  "vmRecreated": true,
  "verification": {"imageHashMatch": true, "oldUsersAbsent": true, "oldSshKeysAbsent": true, "gpuReady": true, "memoryReady": true, "diskReady": true, "networkReady": true},
  "state": "verified",
  "completedAt": "2026-07-12T10:40:00Z",
  "signature": "..."
}
```

A missing receipt or any failed critical check moves the Slot to `quarantined`.

## 5. Strict 1:1 compute protocol

### 5.1 Host Control Domain

V3.2 Alpha specifies Linux KVM/libvirt only. Host runs Worker, Hypervisor, network controls, metering, and image reset and retains minimal CPU, memory, and disk. The Consumer VM receives the entire listed GPU through PCIe Passthrough and the remaining guaranteed CPU, memory, and workspace disk.

The Agent has Guest Root. It may install software, modify the Guest, run authorized workloads, and reboot the Guest. It cannot access Host Root, management networking, libvirt socket, Worker data, Golden Image, other credentials, or Host meters. Any configuration exposing those boundaries is non-compliant.

“Exclusive host” means exclusive use of all resources promised by the Listing, not the Host Control Domain. Host cannot run undeclared Provider compute during an active Lease.

### 5.2 Capacity checks and automatic delisting

Worker performs a light check every 30 seconds:

- heartbeat, Worker identity, and unique Slot relationship;
- GPU UUID, health, unknown GPU processes, and free VRAM;
- available RAM, CPU load, disk reservation, and Lease conflict;
- VM, Hypervisor, and management-network state.

Worker performs a full check every five minutes:

- hardware, driver, CUDA, IOMMU, and PCIe Passthrough;
- Golden Image hash, environment assets, and test-boot ability;
- disk capacity, IOPS, throughput, and reservation ledger;
- networking and short health tests.

Any critical failure immediately marks the Slot `provider_busy`, `capacity_insufficient`, `unhealthy`, or `offline` and pauses its Listing. Provider-local GPU work or reduced guaranteed RAM/VRAM uses `provider_busy`; no manual delisting is needed. After work ends, three consecutive five-minute full checks are still required, so normal recovery takes about 15 minutes. Worker also reacts immediately to GPU process creation, memory pressure, disk-reservation loss, GPU reset, driver failure, and shutdown events.

### 5.3 Hard disk guarantee

An `availableNow` compute Listing requires:

1. complete Golden Image bytes with signature and verified boot;
2. full reservation of the consumer workspace disk;
3. separate Host system, control, and cleanup reserves;
4. full Exora-ledger deduction of advertised workspace capacity even if snapshots or Thin Provisioning are used underneath.

Mandatory invariant:

```text
system reserve
+ control reserve
+ image allocated bytes
+ published-slot disk reservations
+ active-lease disk allocations
+ cleanup-pending bytes
≤ physical allocatable bytes
```

Base images may use content-addressed deduplication, but workspace guarantees cannot be sold twice. Disk specification includes capacity, medium, minimum IOPS, minimum read/write throughput, persistence, and reset policy.

### 5.4 RAM and VRAM guarantee

RAM and VRAM are not consumed by permanent placeholder processes. They are guaranteed by the one-Host-one-Slot ledger, periodic checks, and a full pre-Lease recheck. Recheck verifies allocatable guaranteed RAM, GPU UUID, zero unknown GPU processes, declared free VRAM, and short CUDA and memory tests.

Insufficient capacity prevents Lease creation. Provider consumption of guaranteed resources during an active Lease is an SLA violation that triggers `degraded`, stops extension, captures evidence, and evaluates a refund.

### 5.5 CapacityHold and activation

Atomic compute Lease creation is:

```text
ready
  → CapacityHold
  → funds reserved
  → lease_recheck
  → VM provisioned
  → Guest verification
  → active + billing starts
```

Cloud locks the Slot before Worker performs a live nonce-bound recheck. Recheck, funds, VM boot, or Guest verification failure releases Hold and funds without billing. A Slot cannot accept a second Hold.

### 5.6 Disposable VM Reset

Every Lease uses:

- a pinned read-only Golden Image;
- an independently encrypted write layer and random Lease Disk Key;
- temporary Guest identity, SSH credential, and Lease Capability;
- optional read-only `environment_only` assets.

Release state is:

```text
active → draining → stopping → sanitizing → resetting → verifying → ready
                                      ↘ failure → quarantined
```

Worker stops new work, provides a bounded artifact-export window, powers off the VM, revokes identities, unmounts restricted assets, destroys the disk key, deletes the write layer, rebuilds from Golden Image, and boots. It then checks image hash, GPU, RAM, disk, CUDA, network, and the absence of old users, SSH keys, processes, and files.

A cleanup script cannot substitute for Reset. Any failure moves the Slot to `quarantined`, blocks new Leases, pauses relevant Settlement, and preserves evidence. Compute billing stops after `draining`; `stopping`, `sanitizing`, `resetting`, `verifying`, and `cleaning` are not billed.

## 6. File and data product protocol

A Provider uses the human console or Dock/API to upload an AssetBundle containing one or more files, text description, fixed AssetVersion, license, SHA-256, per-download price, and a DownloadGrant duration from one hour to 30 days. Files default to Exora-managed S3-compatible storage. Provider uploads directly with multipart and signed URLs; MCP and Cloud application server do not carry bodies. Completion supplies part manifest, total size, and SHA-256 and passes MIME, malware, duplicate-content, and license validation. Replacement creates a new immutable AssetVersion.

A Listing selects:

- `downloadable`: a valid purchase or Lease receives an account-, object-, count-, and time-bound URL;
- `environment_only`: the asset is mounted read-only into a related VM and no raw download URL is issued;
- `downloadable_and_environment`: both modes are allowed.

Assets declare license, commercial and derivative rights, attribution, territory, and refund terms. A report can pause new Leases but never erase historical ledger or evidence.

A `download` purchase charges before DownloadGrant issuance. During validity, the same AssetVersion can receive replacement short-lived URLs, HTTP Range resume, and redownload without another charge. Consumer non-use, abandonment, or Grant expiry is not refundable. Corrupt objects, sustained platform failure, or final SHA-256 mismatch are delivery failures and are refunded.

## 7. OpenAPI operation product protocol

An API Provider runs Dock Provider Mode and supplies verifiable OpenAPI 3.x. Dock and Cloud validate operationId, Schema, TLS, health, request/response bounds, and deterministic meter. An API without OpenAPI cannot be published.

Every approved operation generates an independent ApiOperationProduct and stable Capability. Manifest contains natural-language description, input/output JSON Schema, fixed or metered price, rate, timeout, idempotency, privacy, and side-effect class. One data row, report, query result, file conversion, and meal order are different operation results or effects, not new product kinds.

Consumer Agent calls only Exora API Gateway. Gateway verifies Lease, Schema, rate, budget, and operation before injecting Provider credentials. The Agent never receives origin secrets. Arbitrary URLs, headers, private-network redirects, and undeclared paths are denied by default.

API pricing may use request, successful request, input/output byte, or a provable business unit. Gateway emits signed UsageRecord. Oversized output becomes a controlled Artifact.

`sideEffect: external_action` returns ApprovalRequest by default and requires human confirmation before execution. It may run automatically only under explicit pre-authorization for operation, merchant scope, and capability-fee budget. Exora does not display, custody, or settle meal, shipping, or other external merchandise amounts.

## 8. Listing, Lease, and state machines

Listing state:

```text
draft → validating → published → paused → removed
              ↘ rejected      ↘ suspended
```

Compute Slot availability:

```text
ready → provider_busy / capacity_insufficient / held / leased
provider_busy → three full checks passed → ready
leased → resetting → verifying → ready
                    ↘ quarantined
```

Lease state:

```text
requested → held → funded → provisioning → active → draining → releasing → closed
      ↘ rejected       ↘ failed        ↘ cancelled / disputed
```

Search results show `availableNow`, `lastCheckedAt`, recent failure, guaranteed capacity, Golden Image version, and estimated provisioning time. Pause and removal prevent new Leases but do not delete Lease, ledger, or evidence history.

Download state:

```text
draft → validating → published
purchase_paid → grant_active → expired / revoked
grant_active → transfer_active → verified
```

API state:

```text
imported → validating → normalized → published
invocation_requested → approval_required → authorized → executed
```

## 9. Metering, ledger, refunds, and payout

Files are priced per DownloadGrant. Compute is prepurchased in whole integer minutes. APIs use deterministic operation units. PriceSnapshot is immutable after purchase or Lease creation.

The platform uses an append-only double-entry ledger:

```text
deposit       external funds → Consumer available
authorization Consumer available → Consumer reserved
usage settle  Consumer reserved → Provider pending + platform fee
release       Consumer reserved → Consumer available
refund        Provider pending/refund reserve → Consumer available
payout        Provider payable → external payment rail
```

Compute amount is `durationMinutes × pricePerMinute`. CapacityHold reserves the whole amount. VM and Guest verification enter `active`, settle the full purchase, and set expiry from the activation time. Voluntary early release is not refundable. Reset, verification, and cleanup consume no purchased minute. Failed provisioning is not charged. Provider or platform fault refunds unused complete minutes under SLA. Extension purchases a new integer-minute block before expiry.

DownloadGrant is issued after charge; URL reissue and Range resume during validity are free. ApiOperationProduct writes only capability fee to the Exora ledger. External purchase value enters no Exora account.

Revenue enters a refundable hold before becoming payable. Refunds, chargebacks, and corrections are new reversing entries and never history edits.

## 10. MCP and interfaces

Consumer Agent uses unified `exora.` MCP tools:

| Tool | Purpose |
|---|---|
| `search_products` | Search compute, download, and api_operation |
| `get_product_manifest` | Read authoritative text, Schema, price, delivery, and availability |
| `estimate_purchase` | Produce an expiring structured purchase estimate |
| `purchase_compute_minutes` | Create Hold and prepay integer minutes |
| `extend_compute_minutes` | Purchase another minute block before expiry |
| `purchase_download` | Charge and create DownloadGrant |
| `create_download_transfer` | Issue a short URL or resume session under a Grant |
| `invoke_operation` | Invoke a normalized OpenAPI operation |
| `approve_operation` | Approve an operation with external side effects |
| `get_lease` | Read state, usage, expiry, and allowed actions |
| `release_lease` | Stop new actions and begin export, Reset, and Settlement |
| `run_command` / `get_execution` | Execute and inspect work inside Guest |
| `stream_logs` / `get_artifacts` | Read logs and artifacts |
| `get_usage` | Read usage, charge, and remaining budget |

Tool output grants no extra human authority. Expensive Lease, price-increasing extension, sensitive download, and high-risk action intersect Consumer AutomationPolicy. Required consent returns structured `approval_required`.

Cloud APIs include `/v3/products`, `/v3/resources`, `/v3/inventory-slots`, `/v3/capacity-holds`, `/v3/compute-purchases`, `/v3/leases`, `/v3/asset-bundles`, `/v3/download-grants`, `/v3/transfers`, `/v3/api-operations`, `/v3/approvals`, `/v3/invocations`, `/v3/usage-records`, `/v3/reset-receipts`, `/v3/ledger`, `/v3/settlements`, and `/v3/payouts`.

Worker uses an outbound persistent connection or long polling; Provider need not expose a management port. Typed messages include `ResourceHeartbeat`, `CapacitySnapshot`, `CreateCapacityHold`, `ProvisionLease`, `RenewLeaseEpoch`, `CancelExecution`, `UsageBatch`, `ResetVM`, and `ResetReceipt`. Each has command ID, epoch, deadline, signature, and persisted deduplication result.

## 11. Data plane

```text
small control data  MCP / HTTPS JSON
large files         S3 multipart + short-lived signed URL
workspace deltas    temporary Lease SSH/SFTP/rsync
live logs           bounded WebSocket/SSE stream
very large data     pre-mounted environment_only; originals do not move
```

The Cloud application server does not proxy large bodies. A signed URL allows one action on one object version and is constrained by account, Lease, size, count, and expiry.

## 12. Security, privacy, and disputes

- Dock private keys use OS secure storage; Cloud stores public keys and revocation state.
- Provider Host SSH, libvirt, and Golden Image never enter Consumer Agent.
- Guest does not mount Host Docker socket, management directories, or privileged devices. GPU is delivered only through declared PCIe Passthrough.
- Provider API secrets are injected by Gateway key management or Provider Dock.
- Hosted files are encrypted at rest and in transit. Each VM Lease has an independent disk key.
- Full prompts, Agent conversations, file bodies, and sensitive API fields are not Cloud events by default.
- Gateway prevents SSRF, header injection, undeclared redirects, oversized responses, and credential reflection.

Evidence may include Resource checks, CapacitySnapshots, Hold, Lease, heartbeats, UsageRecords, Gateway status, Execution summary, Artifact hashes, Transfer integrity, and ResetReceipt. Parties explicitly select and redact supplemental evidence. Settlement pauses during dispute; decisions create new ledger adjustments.

## 13. Failure semantics

- **Cloud unavailable:** no new Lease; existing work runs only inside issued allowance and expiry.
- **Worker lost:** immediately stop new Listing leases; active Lease becomes `degraded` and capabilities stop renewing.
- **Insufficient capacity or unknown GPU process:** immediately pause Listing; require three full successful checks to recover.
- **Provider local use:** set `provider_busy` and pause automatically without manual delisting; recover automatically in about 15 minutes after work ends.
- **Pre-Lease recheck failure:** release Hold and budget without billing.
- **VM boot or Guest verification failure:** Lease becomes `failed`; Slot enters inspection or quarantine.
- **Reset failure:** Slot becomes `quarantined`, blocks new Lease, and pauses settlement review.
- **Duplicate message:** Cloud and Worker return the original result without duplicate execution or charge.
- **Object-store failure:** Transfer resumes with the same idempotency key and is incomplete until verified.

## 14. End-to-end examples

### 14.1 Provider local use and automatic recovery

```text
1. Provider installs Dock and enables Provider Mode; Worker detects Host, image, disk, and the only Slot.
2. Successful checks publish the ready Slot without a manual availability switch.
3. Provider starts a local GPU job; the next light check sees an unknown GPU process or insufficient guaranteed VRAM.
4. Worker immediately sets provider_busy and pauses Listing without disturbing the local job.
5. Provider work ends; Worker continues checking but does not relist immediately.
6. Three consecutive five-minute full checks return Slot to ready and make Listing purchasable.
```

### 14.2 H100 minute purchase and 1:1 VM

```text
1. Provider Dock detects Linux Host, H100 UUID, KVM/libvirt, CUDA, and storage pool.
2. Provider creates a signed Golden Image; Worker test-boots and verifies it.
3. Worker hard-reserves workspace disk for the only InventorySlot; 30-second light and five-minute full checks maintain availableNow.
4. Consumer Agent searches H100 and prepurchases 30 integer minutes at the per-minute price.
5. Cloud creates an exclusive CapacityHold; Worker uses a nonce to recheck VRAM, RAM, disk, and GPU processes.
6. Cloud reserves all 30-minute funds; Worker creates an encrypted write layer, passes through GPU, and starts the only VM.
7. Guest verification moves Lease to active, settles the full amount, and starts the 30-minute countdown; Agent receives Guest Root.
8. Agent uploads code, executes work, reads logs, and downloads Artifact.
9. Agent may release early, but voluntary release does not refund remaining minutes; Worker resets the VM.
10. Verified ResetReceipt returns Slot to ready; failure moves it to quarantined.
```

### 14.3 Time-limited file download

```text
1. Provider packages multiple files as AssetBundle with text, license, fixed version, and per-download price.
2. Provider configures a 24-hour DownloadGrant and publishes.
3. Consumer Agent reads Manifest, pays, and receives a non-transferable DownloadGrant.
4. Agent creates a short TransferSession, downloads with Range, and verifies SHA-256.
5. After interruption, Agent reissues a URL and resumes within 24 hours without another fee.
6. Non-use is not refunded; corrupt data or checksum failure is refunded as delivery failure.
```

### 14.4 Data-row and report API

```text
1. Provider Dock validates OpenAPI, TLS, health, and operationId.
2. Exora normalizes one-row query and report generation as separate ApiOperationProducts.
3. Consumer Agent reads Schema and capability fee, then calls invoke_operation.
4. Gateway validates Schema, rate, and budget, injects Provider credentials, and forwards.
5. Success creates UsageRecord; large output becomes a short-lived Artifact.
6. Release returns unused budget and revenue enters Provider refundable hold.
```

### 14.5 Meal-order API with human approval

```text
1. Provider OpenAPI contains placeMealOrder with sideEffect: external_action.
2. Consumer Agent builds an order and calls invoke_operation.
3. Exora returns ApprovalRequest with merchant, parameters, cancellation policy, and capability fee.
4. Human approval authorizes Gateway; explicit prior merchant/operation/fee authority may automate it.
5. Exora settles only API capability fee; meal, shipping, and external payment remain the target API's responsibility.
```

## 15. V3.2 Alpha commitment

V3.2 Alpha specifies AI-first AgentProductManifest, necessary human companion interfaces, automatic `provider_busy` delisting, approximately 15-minute recovery, integer-minute prepurchase, AssetBundle, time-limited DownloadGrant, normalized ApiOperationProduct, side-effect ApprovalRequest, strict one-Host-one-Slot-one-VM, Golden Image Reset, OpenAPI Gateway, platform ledger, and Provider Payout.

V3.2 Alpha does not promise multi-tenant VMs, MIG resale, bare Host Root, Hyper-V/VMware, prose-to-API inference, settlement of external merchandise value, decentralized storage, platform inference, a general chat interface, or autonomous dispute verdicts.

> Exora is not a traditional store built around humans clicking product cards. It is a structured purchasing layer for AI Agents, allowing anyone with a machine, an asset, or an OpenAPI to be discovered, purchased, invoked, and paid.
