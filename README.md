# Exora Dock

Exora Dock is the local MCP and provider runtime for the Exora V3.2 AI-first resource market protocol.

Providers use Dock to register hosted files, publish managed compute, expose a private local Endpoint, or publish a public OpenAPI API Bridge. Consumers connect their own local Agent to Dock MCP to discover, purchase, invoke, and settle those resources.

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
- `compute`: Linux KVM uses hardware virtualization; the Windows Technical Preview uses a disclosed `managed_wsl2_shared_host` environment with one active lease per host and Cloud reverse-SSH delivery.
- `availability`: automatic provider_busy delisting and verified relisting without a manual availability switch.
- `pricing`: compute is prepurchased in integer minutes; voluntary early release does not refund unused minutes.
- `storage`: verified Golden Image and fully reserved workspace disk before `availableNow`.
- `reset`: per-Lease encrypted write layer, crypto erase, VM rebuild, verification, and ResetReceipt.
- `api`: each OpenAPI operation becomes a product; external side effects require approval and Exora settles only capability fee.
- `MCP`: Agent-native search, estimate, lease, transfer, execution, invocation, usage, and release.
- `ledger`: budget reservation, usage settlement, refunds, refundable hold, and provider payout.

## Repository implementation status

The Go daemon, Electron application, and Cloud implement the V3 marketplace paths for Resources, Endpoint, API Bridge, and managed compute. Version `0.1.0-preview.2` is a Technical Preview for Windows x64, macOS ARM64, and Linux x64. Windows is not Authenticode-signed, macOS is ad-hoc signed and not notarized, and Linux packages rely on the signed release index; verify the published SHA-256 before installation.

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
