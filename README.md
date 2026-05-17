# Umbra_SVR

Distributed acceleration server for UmbraFi PWA. Miners run this server to cache Solana on-chain data and register themselves on-chain. The PWA fetches data from miners ranked by rating.

## Quick Start

Local MVP mode does not require a Solana keypair, IPFS daemon, or LLM API key:

```bash
go run ./cmd/umbra-svr/
```

This starts a single local miner on `:8080`, stores uploaded media under
`./data/media`, uses deterministic local listing review rules, and persists
products/chat messages in Badger under `./data`.

```bash
cp config.example.yaml config.yaml
# Edit config.yaml with your RPC URL
go build ./cmd/umbra-svr/
./umbra-svr config.yaml
```

Or with Docker:

```bash
docker build -t umbra-svr .
docker run -p 8080:8080 -v ./config.yaml:/etc/umbra-svr/config.yaml umbra-svr
```

## API

| Endpoint | Description |
|---|---|
| `GET /health` | Node status |
| `GET /v1/products` | Product feed |
| `POST /v1/products` | Create and review a local listing |
| `GET /v1/account/:address` | Cached account data |
| `GET /v1/product/:id` | Cached product details |
| `GET /v1/tx/:signature` | Cached transaction data |

## License

MIT
