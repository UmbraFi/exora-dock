# Exora Dock

Exora Dock is the local MCP, VM Worker, and Endpoint tunnel for the Exora V3.2 marketplace.

The market has exactly four authoritative applications:

| `applicationSource` | Runtime model | Delivery |
|---|---|---|
| `vm` | `compute` | Isolated Guest, Exora terminal control, and Dock-to-Dock WebRTC files |
| `resources` | `download` | Resource sheet containing independently described, priced, licensed files; each purchase grants one file |
| `endpoint` | `api_operation` | Private service through an online Dock tunnel; URL and credentials stay local |
| `api_bridge` | `api_operation` | Cloud proxy to a public HTTPS API; Cloud stores the credential encrypted |

Resources never mount into a VM, and VM files never become Resources automatically. `applicationSource` is the business category; `productKind` only selects billing and execution behavior.

## Responsibilities

- Exora Cloud owns identity, devices, products, Listings, purchases, Leases, DownloadGrants, metering, the balanced ledger, custody, and API Bridge execution.
- Exora Dock owns VM capacity and lifecycle, host-enforced Guest network isolation, terminal execution, WebRTC file transfer, Endpoint credentials and tunnels, Seller Draft policy, MCP, and local Agent authorization.
- Exora Desktop provides Listings, VM, Resources, Endpoint, API Bridge, Activity, Approvals, Wallet, Settings, Agent Connections, and Seller Draft controls.

The V1/V2 Task market, negotiation, Agent Card, interactive Agent Session, AutomationRun, chat, local wallet, and old artifact delivery protocols have been removed and have no compatibility routes.

## Documentation

- [Formal runtime and architecture](./docs/FORMAL_RUNTIME.md)
- [Four application boundaries](./docs/CORE_APPLICATION_BOUNDARIES.md)
- [Unified API access, Endpoint, and API Bridge](./docs/UNIFIED_API_ACCESS.md)
- [中文 V3.2 白皮书](./docs/WHITEPAPER.md)
- [English V3.2 whitepaper](./docs/WHITEPAPER.en.md)

## Local development

Dock daemon:

```powershell
go run ./cmd/exora-dock .\config.example.yaml
```

MCP server:

```powershell
go run ./cmd/exora-dock mcp .\config.example.yaml
```

Desktop:

```powershell
cd desktop
npm install
npm run dev
```

Checks:

```powershell
go test ./...
cd desktop
npm run build:frontend
npm run build:electron
```
