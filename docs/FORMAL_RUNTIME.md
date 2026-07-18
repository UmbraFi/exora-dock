# Exora formal runtime

Exora exposes four authoritative marketplace applications. `applicationSource` owns the business category; `productKind` only selects the billing and execution model.

| Application | Delivery | Cloud responsibility | Dock responsibility |
|---|---|---|---|
| `vm` | Lease-authenticated Exora terminal control and Dock-to-Dock WebRTC files under `/workspace` | Purchase, Lease, ledger, command records, and WebRTC signaling | Worker, capacity, guest lifecycle, control channel, and direct file-transfer peer |
| `resources` | Resource sheet of independently purchasable files through per-item DownloadGrant | Object authorization, per-file purchase, grant, quota, ledger | Hash and upload each file; sellers compress folders themselves |
| `endpoint` | Outbound Dock tunnel | Catalog, routing contract, metering | Local URL, credentials, health, tunnel |
| `api_bridge` | Cloud proxy to public HTTPS | Encrypted credential, Gateway, metering | Private draft preparation only; not required at runtime |

```text
Consumer Agent ── MCP ── Dock ── V3 Cloud ── Catalog / Orders / Ledger
                         │             ├── S3-compatible object storage (Resources)
                         │             └── Public HTTPS origin (API Bridge)
                         ├── VM Worker ── Exora control ── isolated Guest (VM)
                         │        └────── Dock-to-Dock WebRTC files (`/workspace`)
                         └── Endpoint tunnel ── private local service (Endpoint)
```

## Formal process surface

- Cloud owns password identity, Payment PIN, accounts, Device Link, Dock registration, all V3 products and Listings, purchases, billing, custody, and API Bridge execution.
- Dock owns the local VM Worker, Endpoint secure store and tunnel, Seller Draft policy, local Agent authorization, discovery, and the formal MCP tool surface.
- Desktop owns the human Listings, four seller workspaces, Activity, Approvals, Wallet, Settings, Agent Connections, and Seller Draft controls.
- Website owns product explanation, downloads, and the synchronized English whitepaper.

The retired Task market, Agent Card, interactive Agent Session, negotiation, OrderPlan, WorkRun, AutomationRun, chat, local wallet, IPFS/DHT/relay, Docker Task artifact protocol, and V1/V2 transaction routes are not part of this runtime and have no compatibility entrypoint.
