# Legacy standalone Dock deployment

> This directory is retained as an operator reference for running a Dock daemon
> in a container. It is not the Exora V3.2 production topology and must not be
> exposed as the public Exora Cloud API.

The current formal runtime separates responsibilities:

- Exora Cloud owns identity, devices, the V3 catalog, purchases, Leases,
  DownloadGrants, API Orders, billing, custody, settlement, and API Bridge
  execution.
- Exora Dock is account-linked software that owns local Agent authorization, VM
  Worker control, Endpoint credentials and outbound tunnels, WebRTC VM file
  transfer, and private Seller Draft preparation.
- A provider Dock initiates outbound connections to Cloud. Cloud does not need
  an inbound management port on the provider machine.

The Compose and Nginx files in this directory predate that separation. In
particular, the old `/v1/buyer-flows`, seller-quote, simulated-payment, chat,
planning, revision, artifact-delivery, and rating workflows are retired and have
no compatibility routes.

For current local development, run the daemon from the repository root:

```powershell
go run ./cmd/exora-dock .\config.example.yaml
```

Run the MCP server separately when connecting a local Agent:

```powershell
go run ./cmd/exora-dock mcp .\config.example.yaml
```

Production operators should deploy Exora Cloud using the service, Nginx,
backup, Vault/KMS, custody, and migration material under
`../../../exora-cloud/deploy/production`, then link provider Docks through the current
device-registration flow. Never publish a Dock owner token, local Agent session
key, account API key, Endpoint credential, or `data/auth.json` through Nginx.
