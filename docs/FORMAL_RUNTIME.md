# Exora formal runtime

Exora exposes four authoritative marketplace applications. `applicationSource` owns the business category; `productKind` only selects the billing and execution model.

| Application | Delivery | Cloud responsibility | Dock responsibility |
|---|---|---|---|
| `vm` | Lease-scoped SSH, SFTP, or rsync | Purchase, Lease, ledger, SSH ingress metadata | Worker, capacity, guest lifecycle, SSH ingress |
| `resources` | Immutable ZIP through an S3-compatible DownloadGrant | Object authorization, purchase, grant, ledger | Package, hash, and upload the fixed version |
| `endpoint` | Outbound Dock tunnel | Catalog, routing contract, metering | Local URL, credentials, health, tunnel |
| `api_bridge` | Cloud proxy to public HTTPS | Encrypted credential, Gateway, metering | Private draft preparation only; not required at runtime |

```text
Consumer Agent ── MCP ── Dock ── V3 Cloud ── Catalog / Orders / Ledger
                         │             ├── S3-compatible object storage (Resources)
                         │             └── Public HTTPS origin (API Bridge)
                         ├── VM Worker ── SSH / SFTP / rsync (VM)
                         └── Endpoint tunnel ── private local service (Endpoint)
```

## Formal process surface

- Cloud owns password identity, Payment PIN, accounts, Device Link, Dock registration, all V3 products and Listings, purchases, billing, custody, and API Bridge execution.
- Dock owns the local VM Worker, Endpoint secure store and tunnel, Seller Draft policy, local Agent authorization, discovery, and the formal MCP tool surface.
- Desktop owns the human Listings, four seller workspaces, Activity, Approvals, Wallet, Settings, Agent Connections, and Seller Draft controls.
- Website owns product explanation, downloads, and the synchronized English whitepaper.

The retired Task market, Agent Card, interactive Agent Session, negotiation, OrderPlan, WorkRun, AutomationRun, chat, local wallet, IPFS/DHT/relay, Docker Task artifact protocol, and V1/V2 transaction routes are not part of this runtime and have no compatibility entrypoint.
