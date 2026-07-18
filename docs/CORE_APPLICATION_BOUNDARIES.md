# Architecture Boundaries of the Four Core Projects

The Exora market exposes only four top-level business categories. `V3Product.applicationSource` is authoritative; `productKind` describes only billing/execution models and must not replace business classification.

| `applicationSource` | `productKind` | Delivery path | Credential authority | Runtime dependencies |
|---|---|---|---|---|
| `vm` | `compute` | Lease-authenticated Exora terminal control and direct Dock-to-Dock WebRTC file transfer | Temporary Worker / Lease identity | Worker, capacity, Guest control channel, and both Docks must be available |
| `resources` | `download` | S3-compatible object storage and per-ResourceItem DownloadGrant | No VM credentials | Verified ResourceItem object versions that cannot be replaced in place |
| `endpoint` | `api_operation` | Outbound tunnel from an online Dock | Dock-local secure storage only | Dock must be online and pass health checks |
| `api_bridge` | `api_operation` | Cloud transparent proxy to public HTTPS APIs | Cloud-encrypted credentials | Independent of Dock availability after publication |

## Classification Contract

- A Product's top-level `applicationSource` must be explicitly submitted and be one of the four enum values. The identically named Manifest field is only a compatibility mirror.
- A Listing's `applicationSource` derives only from its Product; clients cannot create or change it to another category.
- `vm` maps exclusively to `compute`; `resources` to `download`; `endpoint` and `api_bridge` to `api_operation`, requiring `dock_tunnel` and `cloud_direct` respectively.
- Missing, unknown, or contradictory fields return `application_contract_mismatch`; never fall back to API Bridge.
- Internal records such as Environment images and InventorySlot are not marketplace products; their classification remains empty and they must not create Listings.

## Delivery Boundaries That Must Not Be Crossed

Resources and VMs remain permanently independent. A Resource sheet is a thematic container with one or more ResourceItems; each file has its own title, description, price, license, and DownloadGrant duration and requires a separate purchase. The platform accepts any regular file format but not directories; sellers bundling a program directory or file set as one product must compress it themselves and upload the archive as an ordinary ResourceItem. Resources are not associated with Leases, mounted into VMs, or automatically populated with VM code/results.

VM files exist only in the Lease's controlled `/workspace`. Commands run through a Lease-authenticated Exora control channel; official files transfer directly over WebRTC DTLS DataChannel between Consumer Dock and Provider Dock. Cloud relays only short-lived signaling and provides neither TURN nor file relay. Public SSH, SFTP, SCP, rsync, port forwarding, and Provider Host ports are not Lease capabilities. The platform never automatically publishes VM workspaces as Resources.

Endpoint local URLs, plaintext Secrets, and `credentialRef` remain only in Dock, never entering Cloud databases, API responses, or logs. Cloud stores only configuration attestations, routing, and metering contracts. An Endpoint must be unavailable when Dock is offline or fails health checks.

API Bridge targets only validated public HTTPS `baseUrl`, prohibiting `tunnelEndpointId`. Cloud encrypts its Secret, allowing Cloud Gateway to proxy published operations while Dock is offline.

## Legacy Data Migration

Migration backfills only classifications unambiguously established by existing `productKind`, `bridgeMode`, and delivery fields. Ambiguous/contradictory Listings are suspended, removed from the catalog, and marked `reclassification_required`. Legacy Resources using `environment_only` or combined delivery never automatically gain download rights; Endpoints carrying Cloud Secret references are suspended, cleared of those references, and require seller reconfiguration locally in Dock.

Reclassification migration never rewrites orders, ledgers, settled amounts, or historical activity.
