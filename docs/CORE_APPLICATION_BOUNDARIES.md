# Architecture Boundaries of the Four Core Projects

The Exora market exposes only four top-level business categories. `V3Product.applicationSource` is authoritative; `productKind` describes only billing/execution models and must not replace business classification.

| `applicationSource` | `productKind` | Delivery path | Credential authority | Runtime dependencies |
|---|---|---|---|---|
| `vm` | `compute` | SSH/SFTP/rsync within a Lease | Temporary Worker / Lease identity | Worker, capacity, and SSH ingress must be available |
| `resources` | `download` | S3-compatible object storage and DownloadGrant | No VM credentials | Valid AssetVersion and uploaded objects |
| `endpoint` | `api_operation` | Outbound tunnel from an online Dock | Dock-local secure storage only | Dock must be online and pass health checks |
| `api_bridge` | `api_operation` | Cloud transparent proxy to public HTTPS APIs | Cloud-encrypted credentials | Independent of Dock availability after publication |

## Classification Contract

- A Product's top-level `applicationSource` must be explicitly submitted and be one of the four enum values. The identically named Manifest field is only a compatibility mirror.
- A Listing's `applicationSource` derives only from its Product; clients cannot create or change it to another category.
- `vm` maps exclusively to `compute`; `resources` to `download`; `endpoint` and `api_bridge` to `api_operation`, requiring `dock_tunnel` and `transparent` respectively.
- Missing, unknown, or contradictory fields return `application_contract_mismatch`; never fall back to API Bridge.
- Internal records such as Environment images and InventorySlot are not marketplace products; their classification remains empty and they must not create Listings.

## Delivery Boundaries That Must Not Be Crossed

Resources and VMs remain permanently independent. Resources deliver only through fixed versions, licenses, completed uploads, and DownloadGrant; they are not associated with Leases, mounted into VMs, or automatically populated with VM code/results. The current implementation still packages a version as an immutable ZIP uploaded to S3-compatible object storage; per-file/directory download protocols are deferred to the next round.

VM files exist only in the Lease's controlled workspace and transfer through SSH/SFTP/rsync. The platform may relay small control data but never automatically publishes VM workspaces as Resources.

Endpoint local URLs, plaintext Secrets, and `credentialRef` remain only in Dock, never entering Cloud databases, API responses, or logs. Cloud stores only configuration attestations, routing, and metering contracts. An Endpoint must be unavailable when Dock is offline or fails health checks.

API Bridge targets only validated public HTTPS `baseUrl`, prohibiting `tunnelEndpointId`. Cloud encrypts its Secret, allowing Cloud Gateway to proxy published operations while Dock is offline.

## Legacy Data Migration

Migration backfills only classifications unambiguously established by existing `productKind`, `bridgeMode`, and delivery fields. Ambiguous/contradictory Listings are suspended, removed from the catalog, and marked `reclassification_required`. Legacy Resources using `environment_only` or combined delivery never automatically gain download rights; Endpoints carrying Cloud Secret references are suspended, cleared of those references, and require seller reconfiguration locally in Dock.

Reclassification migration never rewrites orders, ledgers, settled amounts, or historical activity.
