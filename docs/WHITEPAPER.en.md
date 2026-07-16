<!-- Source: WHITEPAPER.md; normalized-sha256: 9782052c58c84d695197e104a556a84f3e4f477e6659588faa9ac61f9259b676 -->

# Exora V3.2 AI-First Resource Market Protocol Whitepaper

**Version: V3.2 Alpha**<br>
**Status: Implemented Alpha protocol with Technical Preview constraints**<br>
**Positioning: a fast, convenient, Agent-first resource exchange market connected through MCP**

> Connect an existing Agent to Exora through MCP to buy or sell compute, packaged resources, local Endpoints, and public API Bridges. Dock keeps credentials and execution local; humans retain control of funds, public publishing, approvals, and payout.

## 1. Abstract

Exora V3.2 turns prepared digital resources into standardized products that an Agent can search, purchase, invoke, or prepare for sale. A provider may use Exora Dock to sell a verified KVM or managed WSL2 environment, package local files as a paid download, expose a private local service as an Endpoint, or connect a public HTTPS service as an API Bridge. Exora Cloud manages the catalog, purchases, leases, usage, balanced ledger, and provider revenue. Dock manages local authority, credentials, runtime validation, file transfer, tunnels, and execution.

The protocol flow is:

```text
Resource → Listing → Lease → Usage → Settlement
```

The market exposes four first-class application categories: `vm`, `resources`, `endpoint`, and `api_bridge`. Top-level `applicationSource` defines responsibility; `productKind` describes only the billing/execution model: `compute` prepurchases VM minutes, `download` buys a time-limited DownloadGrant for one AssetVersion, and `api_operation` buys one declared operation. One `AgentProductManifest` describes them all.

Compute retains a strict 1:1 model: one physical computer, one `InventorySlot`, and one Consumer VM. Worker detects provider activity and pauses automatically without manual delisting. After the host becomes idle, three full checks restore the Listing. Consumer Agent receives Guest Root; Worker restores a clean VM from signed Golden Image after use.

Exora does not require a provider Agent and does not provide another chat interface. A seller may optionally ask their existing Agent to discover only pre-authorized local resources and create private Listing drafts. Seller-Agent tools cannot read arbitrary paths, return secrets, infer commercial terms, or publish. MCP/API is the authoritative market surface. Graphics are optional human aids and cannot be required to understand a product. The Electron companion provides Listings, VM, Resources, Endpoint, API Bridge, approval, billing, and payout workspaces.

### 1.1 Current implementation profile

The Dock daemon, Electron application, and Cloud repository implement the V3 marketplace paths. The public protocol remains Alpha, so this document distinguishes implemented behavior from stricter target guarantees:

| Area | Current implementation | Alpha boundary |
|---|---|---|
| Consumer MCP | Search, manifest, estimate, compute purchase/extension, download grant/transfer, operation invocation, lease, usage, and release | The user brings their own MCP Agent; Dock is not a chat Agent |
| Seller MCP | Authorized discovery and durable private drafts for VM, Resources, Endpoint, and API Bridge | Draft-only; public publishing, seller attestations, credentials, and unsaved commercial decisions remain human-controlled |
| Compute | Linux KVM and Windows `managed_wsl2_shared_host`; one active Lease per host | KVM is the hardware-isolated path; WSL2 is explicitly disclosed as shared-host isolation and does not claim exclusive GPU passthrough |
| Resources | Immutable ZIP upload, SHA-256 verification, paid time-limited DownloadGrant, retry and resume | The current Desktop packages one bundle up to its configured upload limit |
| Endpoint / API Bridge | Dock tunnel for authorized private or loopback services; transparent Gateway for authorized public HTTPS services | Every route is reviewed and metered; arbitrary URLs and undeclared routes are rejected |
| Billing | Unified reserve, capture, release, refund, balanced journals, 24-hour seller revenue hold, and configured native-USDC deposit/withdrawal rails | Custody and withdrawal readiness depend on production Postgres, SMTP, Solana, and KMS configuration |

The current desktop release is `0.1.0-preview.2`, a Technical Preview for Windows x64, macOS ARM64, and Linux x64 rather than a production release. Windows is not Authenticode-signed, macOS is ad-hoc signed and not notarized, and Linux packages rely on the signed release index. Users must verify the published SHA-256 and should expect platform security prompts appropriate to those signing states.

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
- support Hyper-V or VMware, or represent managed WSL2 as equivalent to KVM hardware isolation;
- carry large file bodies in MCP messages;
- infer the semantics of an API without OpenAPI;
- make meal ordering a new first-class application category or settle external meal, shipping, or merchandise charges;
- expose Host Root, libvirt socket, Provider SSH, payment credentials, or owner tokens to a Consumer or Agent;
- treat a cleanup script as equivalent to Golden Image Reset;
- claim that an Alpha or locally configured deployment has production availability, custody, or security certification.

## 3. Actors and authority

### 3.1 Consumer and Consumer Agent

The Consumer is the human account purchasing resources and owns budgets, payment methods, Leases, artifacts, and authorization policy. The Consumer Agent is a user-owned MCP client. It may search, estimate, request a Lease, and act inside a valid Capability, but cannot widen its authority, rewrite usage history, or decide a dispute for the human.

### 3.2 Provider

The Provider uploads data, connects a physical computer, or publishes an Endpoint or API Bridge and is responsible for availability, description, price, license, routes, credentials, and legality. A Provider may work entirely through the Electron companion or optionally authorize an existing Agent to prepare private drafts. Providers publish from the Listings workspace; a draft or a resource that fails automated validation is never public. Identity and payout-account verification are required before first payout where the payment rail requires them.

### 3.3 Exora Dock

One Dock program supports three capabilities that may run together:

- **Consumer MCP:** exposes Exora tools to the local Agent and enforces local budget and approval policy.
- **Seller Draft MCP:** exposes policy-gated, draft-only tools for authorized roots, registered services, and verified VM runtimes.
- **Provider Worker:** runs outside the Consumer environment, validates Linux KVM or managed Windows WSL2 capacity, maintains the single InventorySlot, fulfills Leases, meters usage, and resets the environment.

Dock device keys use operating-system secure storage. Worker always runs outside the Consumer VM that it creates and destroys.

### 3.4 Exora Cloud

Cloud is authoritative for accounts, Resources, Listings, InventorySlot projections, Leases, UsageRecords, the balanced platform ledger, and Settlement. It provides catalog search, CapacityHold, exclusive leasing, short-lived capabilities, object-store authorization, API Gateway, refunds, a 24-hour provider revenue hold, and configured native-USDC deposits and Solana withdrawals.

### 3.5 Sources of truth

```text
Cloud           directory, leases, budgets, usage aggregation, ledger, settlement
Provider Worker physical hardware, live capacity, VM lifecycle, execution, reset
Runtime         KVM device isolation or the disclosed managed WSL2 shared-host boundary
Object Store    hosted file bytes and object versions
API Gateway     API requests, response status, byte counts, invocation meter
Payment Rail    deposits, withdrawals, chargebacks, external money movement
Human           publishing, budgets, sensitive grants, disclosure, disputes
```

## 4. Public protocol objects

All public objects use immutable IDs, RFC 3339 UTC timestamps, and explicit `schemaVersion`. Business writes carry an 8–128 character `idempotencyKey`; projection updates also carry `expectedVersion`. Money uses ISO 4217 currency and integer minor units. Floating-point money is forbidden.

HTTP retains the `/v3` major version. Schemas use `exora.<object>.v3alpha1`. V3 is not stable, so the V3.2 document revision does not change the Alpha Schema major version.

### 4.1 AgentProductManifest

`AgentProductManifest` is the authoritative AI-market description; `V3Product.applicationSource` is the authoritative business category and is one of `vm`, `resources`, `endpoint`, or `api_bridge`. The same Manifest field remains a compatibility mirror, while a Listing derives its immutable category from Product. `productKind` is only `compute`, `download`, or `api_operation`. Missing, unknown, or contradictory mappings fail with `application_contract_mismatch`; they are never guessed or defaulted to API Bridge. Natural language supports search and explanation; JSON Schema, price, limits, and errors drive deterministic use.

```json
{
  "schemaVersion": "exora.agent_product_manifest.v3alpha1",
  "productId": "prd_01",
  "applicationSource": "api_bridge",
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
  "vmRecreated": true,
  "verification": {"imageHashMatch": true, "oldUsersAbsent": true, "oldSshKeysAbsent": true, "gpuReady": true, "memoryReady": true, "diskReady": true, "networkReady": true},
  "state": "verified",
  "completedAt": "2026-07-12T10:40:00Z",
  "signature": "..."
}
```

A missing receipt or any failed critical check moves the Slot to `quarantined`.

## 5. Strict 1:1 compute protocol

### 5.1 Runtime and Host Control Domain

The hardware-isolated profile uses Linux KVM/libvirt. Host runs Worker, Hypervisor, network controls, metering, and image reset and retains minimal CPU, memory, and disk. The Consumer VM receives the entire listed GPU through PCIe Passthrough and the remaining guaranteed CPU, memory, and workspace disk.

The Windows Technical Preview uses `managed_wsl2_shared_host`. Dock validates a signed managed Linux environment, enforces one active Lease per host, installs the buyer's SSH public key, and exposes the Lease through Cloud reverse SSH when configured. The Manifest and Lease must disclose that CPU and memory are configured caps, the GPU uses the Windows host driver, and hardware-passthrough exclusivity is false. A buyer may reject this isolation class.

The Agent has Guest Root in the leased Linux environment. It may install software, modify the Guest, run authorized workloads, and reboot the Guest. It cannot access Host Root, management networking, libvirt controls, Worker data, Golden Image, other credentials, or Host meters. Any configuration exposing those boundaries is non-compliant.

“Exclusive host” means one active Exora Lease and exclusive use of all resources promised by the Listing, not ownership of the Host Control Domain. Host cannot run undeclared Provider compute during an active Lease.

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
- temporary Guest identity, SSH credential, and Lease Capability.

Release state is:

```text
active → draining → stopping → sanitizing → resetting → verifying → ready
                                      ↘ failure → quarantined
```

Worker stops new work, provides a bounded artifact-export window, powers off the VM, revokes identities, destroys the disk key, deletes the write layer, rebuilds from Golden Image, and boots. It then checks image hash, GPU, RAM, disk, CUDA, network, and the absence of old users, SSH keys, processes, and files.

A cleanup script cannot substitute for Reset. Any failure moves the Slot to `quarantined`, blocks new Leases, pauses relevant Settlement, and preserves evidence. Compute billing stops after `draining`; `stopping`, `sanitizing`, `resetting`, `verifying`, and `cleaning` are not billed.

## 6. File and data product protocol

A Provider uses the Resources workspace or authorized seller-draft MCP to select local files. Dock revalidates the authorized candidates, packages them into one immutable ZIP AssetBundle, computes SHA-256, and uploads it with a text description, fixed AssetVersion, license, per-download price, and a DownloadGrant duration from one hour to 30 days. The current Desktop enforces its configured bundle-size limit. Files default to Exora-managed S3-compatible storage. Provider uploads directly with multipart and signed URLs; MCP and Cloud application server do not carry bodies. Completion supplies part manifest, total size, and SHA-256 and passes MIME, malware, duplicate-content, and license validation. Replacement creates a new immutable AssetVersion.

A Resources Listing has fixed `downloadable` delivery: a valid purchase receives an object-, account-, count-, and time-bound DownloadGrant. Resources never attach to a VM or Lease, never mount into compute, and never automatically receive VM code or results. Legacy `environment_only` and `downloadable_and_environment` Listings are paused for seller confirmation; the system does not automatically broaden download rights.

Assets declare license, commercial and derivative rights, attribution, territory, and refund terms. A report can pause new Leases but never erase historical ledger or evidence.

A `download` purchase charges before DownloadGrant issuance. During validity, the same AssetVersion can receive replacement short-lived URLs, HTTP Range resume, and redownload without another charge. Consumer non-use, abandonment, or Grant expiry is not refundable. Corrupt objects, sustained platform failure, or final SHA-256 mismatch are delivery failures and are refunded.

## 7. Endpoint and API Bridge operation protocol

The Electron application exposes two seller paths that both normalize approved routes as `api_operation` products:

- **Endpoint:** an authorized private or loopback service stays behind Dock. Its local URL, plaintext Secret, and `credentialRef` remain only in Dock secure storage and never enter the Cloud database, responses, or logs; Cloud stores only configured proof, routes, and metering contract. Dock performs side-effect-free health checks and serves requests through its outbound tunnel. An offline or unhealthy Dock makes the Endpoint unavailable.
- **API Bridge:** an authorized public HTTPS service is reached through Exora Cloud's transparent Gateway. It requires a validated public HTTPS `baseUrl`, forbids `tunnelEndpointId`, and keeps credentials encrypted in Cloud. Once published it does not require Dock to remain online. Import accepts OpenAPI 3.x or a seller-reviewed structured route draft.

Every approved operation generates an independent ApiOperationProduct and stable Capability. Manifest contains natural-language description, input/output JSON Schema, fixed or metered price, rate, timeout, idempotency, privacy, and side-effect class. One data row, report, query result, file conversion, and meal order are different operation results or effects, not new first-class application categories.

Consumer Agent calls only the Exora Gateway or Dock's listing-scoped Gateway. The Gateway verifies Lease, Schema, rate, budget, and operation before injecting Provider credentials. The Agent never receives origin secrets. Arbitrary URLs, headers, private-network redirects, and undeclared paths are denied by default.

API pricing may use request, successful request, input/output byte, or a provable business unit. Gateway emits signed UsageRecord. Oversized output becomes a controlled Artifact.

`sideEffect: external_action` returns ApprovalRequest by default and requires human confirmation before execution. It may run automatically only under explicit pre-authorization for operation, merchant scope, and capability-fee budget. Exora displays and settles only `capabilityFee`; it does not display, custody, or settle meal, shipping, or other external merchandise amounts.

## 8. Listing, Lease, and state machines

Listing state:

```text
draft → validating → published → paused → removed
              ↘ rejected      ↘ suspended
```

Electron and Seller Draft MCP first create a private `draft`. Public catalog visibility starts only after the human seller reviews technical details, explicit commercial values, credentials/attestations, and uses a Listings action to publish. No seller Agent tool can execute `publish`, `pause`, or `retire`.

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
draft/imported → validating → normalized → seller_review → published
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

In the implemented Alpha billing engine, VM, Resources, Endpoint, and API Bridge share reserve, capture, release, and refund journals; every journal must balance to zero. Seller revenue remains pending for 24 hours after product completion. Marketplace commission is deducted from the seller rather than added to the buyer's displayed price. Refunds, chargebacks, and corrections are new reversing entries and never history edits.

Native-USDC deposit addresses and Solana withdrawals are available only when the Cloud custody, RPC, price feed, SMTP challenge, and KMS-backed key configuration are enabled. Local-development key fallback and in-memory persistence are not production custody.

## 10. MCP and interfaces

The implemented marketplace surface exposes these Consumer Agent tools:

| Tool | Purpose |
|---|---|
| `search_products` | Search published `vm`, `resources`, `endpoint`, and `api_bridge` products |
| `get_product_manifest` | Read authoritative text, Schema, price, delivery, and availability |
| `estimate_purchase` | Produce an expiring structured purchase estimate |
| `purchase_compute_minutes` | Create Hold and prepay integer minutes |
| `extend_compute_minutes` | Purchase another minute block before expiry |
| `purchase_download` | Charge and create DownloadGrant |
| `create_download_transfer` | Issue a short URL or resume session under a Grant |
| `invoke_operation` | Invoke a normalized OpenAPI operation |
| `get_lease` | Read state, usage, expiry, and allowed actions |
| `release_lease` | Stop new actions and begin export, Reset, and Settlement |
| `get_usage` | Read usage, charge, and remaining budget |

Compute work uses the Lease's disclosed, lease-scoped SSH Capability; the current marketplace MCP surface does not pretend that `run_command`, log streaming, or artifact download are separate registered marketplace tools. Approval decisions are made by the owning human session and then referenced by the Agent when it retries a purchase or invocation.

When the owner enables seller automation and Dock issues a separate Provider Agent token, the same MCP connection may also expose draft-only tools:

| Tool | Purpose and authority limit |
|---|---|
| `get_seller_draft_capabilities` | Read enabled kinds, authorized roots/services, safe defaults, host support, and credential metadata; never secrets |
| `discover_sellable_resources` | Return short-lived candidate IDs only for authorized files, registered services, and verified runtimes |
| `read_seller_material` | Read a bounded chunk, up to 256 KiB, from an authorized text candidate |
| `create_vm_listing_draft` | Validate WSL2/KVM, reserve capacity for 24 hours, and create a private compute draft |
| `create_resource_listing_draft` | Revalidate files, package ZIP, upload, verify SHA-256, and create a private download draft |
| `create_endpoint_listing_draft` | Probe an authorized private/loopback service and create a private tunnel-backed draft |
| `create_api_bridge_listing_draft` | Probe protected public HTTPS and create a private transparent-Gateway draft |
| `get_seller_draft_run` / `list_my_listing_drafts` | Read durable progress and ready-to-publish private results |
| `resume_seller_draft_run` / `cancel_seller_draft_run` | Continue with seller-supplied values or cooperatively clean up an unfinished run |

Seller discovery never accepts arbitrary filesystem paths from an Agent. Candidate IDs expire, material reads are bounded, `mcpConnectionId` provenance is assigned by Dock, plaintext credentials are never returned, and commercial values are explicit rather than inferred. Public Listing actions remain unavailable.

Tool output grants no extra human authority. Expensive Lease, price-increasing extension, sensitive download, and high-risk action intersect Consumer AutomationPolicy. Required consent returns structured `approval_required`.

Implemented Cloud APIs include public `/v3/catalog/products` and `/v3/catalog/listings`; buyer `/v3/purchase-estimates`, `/v3/compute-purchases`, `/v3/download-grants`, `/v3/invocations`, `/v3/leases`, `/v3/approvals`, and `/v3/ledger`; provider `/v3/provider/products`, `/v3/provider/listings`, `/v3/provider/asset-bundles`, `/v3/provider/api-imports`, `/v3/provider/endpoint-imports`, and `/v3/provider/tunnels/connect`; and billing `/v3/billing/balance`, `/v3/billing/ledger`, deposit-address, deposit, withdrawal-quote, withdrawal-challenge, and withdrawal paths.

Worker uses an outbound persistent connection or long polling; Provider need not expose a management port. Typed messages include `ResourceHeartbeat`, `CapacitySnapshot`, `CreateCapacityHold`, `ProvisionLease`, `RenewLeaseEpoch`, `CancelExecution`, `UsageBatch`, `ResetVM`, and `ResetReceipt`. Each has command ID, epoch, deadline, signature, and persisted deduplication result.

## 11. Data plane

```text
small control data  MCP / HTTPS JSON
large files         S3 multipart + short-lived signed URL
workspace deltas    temporary Lease SSH/SFTP/rsync
live logs           bounded WebSocket/SSE stream
Resources data      independent S3 object version + DownloadGrant
```

The Cloud application server does not proxy large bodies. A signed URL allows one action on one object version and is constrained by account, Lease, size, count, and expiry.

## 12. Security, privacy, and disputes

- Dock private keys use OS secure storage; Cloud stores public keys and revocation state.
- Provider Host SSH, libvirt, and Golden Image never enter Consumer Agent.
- Guest does not mount Host Docker socket, management directories, or privileged devices. GPU is delivered only through declared PCIe Passthrough.
- Endpoint secrets are injected only by Provider Dock; API Bridge secrets are encrypted and injected by Cloud Gateway.
- Seller MCP can reference only locally stored credential aliases; it cannot retrieve plaintext credentials or place them in a draft.
- Hosted files are encrypted at rest and in transit. Each VM Lease has an independent disk key.
- Full prompts, Agent conversations, file bodies, and sensitive API fields are not Cloud events by default.
- Gateway prevents SSRF, header injection, undeclared redirects, oversized responses, and credential reflection.
- `managed_wsl2_shared_host` is disclosed as a weaker Preview isolation class; it must never be described as KVM-equivalent GPU passthrough.

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
- **Seller draft interruption:** durable progress moves to `needs_input`, `failed`, or `cancelled`; retry uses optimistic concurrency and the same idempotency key, and no public Listing is created.

## 14. End-to-end examples

### 14.1 Seller Agent creates a private Listing draft

```text
1. Seller enables seller automation, chooses allowed resource roots/services, saves commercial defaults, and connects an existing Agent through the Provider Agent token.
2. Agent reads capabilities and discovers only short-lived candidate IDs inside that policy.
3. Agent may read bounded authorized text material, but never an arbitrary path or plaintext credential.
4. Agent starts a VM, Resources, Endpoint, or API Bridge draft run with explicit commercial values.
5. Dock revalidates the candidate, performs the kind-specific upload/probe/reservation, and saves a durable private Listing draft.
6. If input is missing, the run stops at needs_input and resumes with version-checked seller values.
7. Seller reviews the result in Electron Listings and explicitly publishes it. The Agent cannot perform that last action.
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

On a Windows Preview provider, the same purchase path uses one managed WSL2 environment and one active Lease per host. The buyer receives root SSH access, while the Manifest discloses configured CPU/memory caps, shared Windows GPU-driver access, and no hardware-passthrough exclusivity. Release deletes the lease identity and managed environment state, rebuilds it from the selected signed environment, and emits ResetReceipt.

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

V3.2 Alpha implements an AI-first AgentProductManifest, BYO-Agent Consumer MCP, optional draft-only Seller MCP, Electron Listings/VM/Resources/Endpoint/API Bridge workspaces, automatic `provider_busy` delisting, approximately 15-minute recovery, integer-minute prepurchase, AssetBundle, time-limited DownloadGrant, normalized ApiOperationProduct, side-effect ApprovalRequest, strict one-Host-one-Slot-one-active-Lease, KVM and disclosed managed WSL2 runtimes, reset receipts, transparent Gateway, balanced journals, revenue hold, and configured Provider Payout.

V3.2 Alpha does not promise multi-tenant VMs, MIG resale, bare Host Root, Hyper-V/VMware, KVM-equivalent isolation on WSL2, prose-to-API inference without seller review, settlement of external merchandise value, decentralized storage, platform inference, a general chat interface, autonomous public publishing, or autonomous dispute verdicts. The three-platform Technical Preview and locally configured Cloud are not production availability or custody certifications.

> Exora is an MCP-connected, Agent-first exchange: people keep their own Agent, buy or sell verified resources through one structured protocol, and retain control of publishing, money, and sensitive authority.
