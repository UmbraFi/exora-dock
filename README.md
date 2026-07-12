# Exora Dock

Exora Dock is the local MCP and provider runtime for the Exora V3.2 AI-first resource market protocol.

Providers use Dock to register hosted files, publish one strictly exclusive VM per physical Linux host, or expose OpenAPI services through Exora Gateway. Consumers connect their own local Agent to Dock MCP to discover, lease, invoke, and settle those resources. Exora does not require a provider Agent and does not provide a separate chat interface.

## V3.2 protocol direction

```text
Provider files / physical hosts / APIs
                    ↓
Provider Dock → Exora Cloud market, leases, metering, and ledger
                              ↓
Consumer Agent → Consumer Dock MCP
```

The canonical specification is available in:

- [中文 V3.2 白皮书](./docs/WHITEPAPER.md)
- [English V3.2 whitepaper](./docs/WHITEPAPER.en.md)

V3.2 centers on:

```text
Resource → Listing → Lease → Usage → Settlement
```

- `file`: Exora-hosted multipart assets, downloadable or environment-only.
- `AI-first`: one machine-readable AgentProductManifest for compute, download, and api_operation products.
- `download`: AssetBundle purchase creates a seller-configured, time-limited DownloadGrant with free retry and resume.
- `compute`: one Linux physical host, one InventorySlot, one KVM/libvirt Consumer VM, and no overcommit.
- `availability`: automatic provider_busy delisting and verified relisting without a manual availability switch.
- `pricing`: compute is prepurchased in integer minutes; voluntary early release does not refund unused minutes.
- `storage`: verified Golden Image and fully reserved workspace disk before `availableNow`.
- `reset`: per-Lease encrypted write layer, crypto erase, VM rebuild, verification, and ResetReceipt.
- `api`: each OpenAPI operation becomes a product; external side effects require approval and Exora settles only capability fee.
- `MCP`: Agent-native search, estimate, lease, transfer, execution, invocation, usage, and release.
- `ledger`: budget reservation, usage settlement, refunds, refundable hold, and provider payout.

## Repository implementation status

The current Go daemon, Electron application, and Cloud integration are still primarily the legacy V2 transaction-supervisor implementation. V3.2 is an Alpha protocol specification and is not yet implemented. Legacy V2 integration documents remain for code maintenance and are explicitly marked as legacy.

## Current local development

Daemon:

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
