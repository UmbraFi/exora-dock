# Exora HTTP/SSE service contract

This document is normative for Endpoint and API Bridge in Cloud, Dock, Desktop, and MCP.

## Authoritative contract

Endpoint and API Bridge products expose exactly one public service contract:

```text
AgentProductManifest
└── serviceManifest: ExoraServiceManifest v1
    ├── interface: OpenAPI 3.1
    ├── delivery: dock_tunnel | cloud_direct
    ├── operationPolicies
    │   ├── operationId
    │   ├── interaction: request_response | server_stream
    │   ├── sideEffect / idempotent
    │   ├── limits
    │   └── meteringCapabilities
    └── pricingTemplate
```

`interface` is the complete canonical OpenAPI 3.1 JSON document. `operationPolicies` has exactly one item for every OpenAPI Operation and no extra item. Endpoint fixes `delivery` to `dock_tunnel`; API Bridge fixes it to `cloud_direct`.

There is no public protocol enum, transport enum, route mirror, adapter contract, runtime URL, endpoint ID, credential reference, or secret in the Product Manifest.

## Supported interface

The public product surface supports only:

- HTTP with JSON, `+json`, or no request body.
- HTTP with JSON, `+json`, no response body, or SSE (`text/event-stream`).
- OpenAI-compatible APIs when represented as ordinary OpenAPI HTTP/JSON or SSE Operations.

SSE is server streaming only. Each `data:` payload must be JSON; the OpenAI-style `[DONE]` sentinel is allowed.

The product surface does not support gRPC, Webhook/Callback, general WebSocket, GraphQL, SOAP/WSDL, JSON-RPC, OData, MQTT, AMQP, Kafka, NATS, WebRTC, raw TCP/UDP, or FTP. Cloud and Dock may use a private WebSocket/binary tunnel internally, but it only transports declared HTTP/JSON and SSE Operations and is not a seller-facing interface.

## OpenAPI normalization

Sellers may provide OpenAPI 3.0/3.1, code, Markdown, JSON/YAML, examples, or a written description. An Agent normally reviews and normalizes these materials to OpenAPI 3.1. A deterministic validator then canonicalizes JSON and computes SHA-256; the Agent is not the final validator.

Publication requires unique `operationId` values, only local `#/components/...` references, declared responses, supported media types, and an exact Policy-to-Operation match. External `$ref`, servers containing real targets, sensitive examples, multipart, arbitrary binary bodies, callbacks, and webhooks are rejected with `service_contract_mismatch`.

A valid 3.1 interface is reviewed without changing its method, path, or schema semantics. When the Agent is unavailable or normalization fails, manual fallback is allowed only with the failed run, operator, reason, source hash, and final document hash recorded. Both paths pass the same deterministic checks.

## Runtime boundary

| Boundary | Endpoint | API Bridge |
|---|---|---|
| Delivery | `dock_tunnel` | `cloud_direct` |
| Target | Local/private URL stored only by Dock | Public HTTPS URL stored privately by Cloud |
| Credential | Stored only by Dock | Encrypted and stored privately by Cloud |
| Availability | Dock must be online and healthy | Does not depend on Dock after publishing |
| Public Manifest | OpenAPI, Policies, and pricing only | OpenAPI, Policies, and pricing only |

Runtime targets, credentials, health settings, and connection state live in private `ServiceRuntime` records. They are never returned by Catalog or Product APIs and are always redacted from logs and diagnostics.

## Pricing and review

Pricing is displayed in USDC and stored as integer Atomic units. A template defines defaults plus complete per-Operation overrides. Publication expands it into an immutable `operationPricingSnapshot`; invocation billing reads only that snapshot.

Supported meters are request, successful request, input/output tokens, input/output bytes, execution time, images, and provider-reported usage. Each component charges on `started`, `succeeded`, or `completed`. Variable pricing requires a maximum charge per invocation.

The seller reviews the canonical interface, every Operation Policy, every price, the private runtime, and the required seller declarations. An Agent cannot submit credentials or PINs, make seller declarations, or publish.

## Draft APIs and MCP

The only provider service-draft routes are:

- `POST /v3/provider/service-drafts`
- `GET /v3/provider/service-drafts/{id}`
- `PUT /v3/provider/service-drafts/{id}`
- `POST /v3/provider/service-drafts/{id}/submit`

MCP keeps `save_endpoint_draft` and `save_api_bridge_draft`. Both use the same schema and only create private drafts. Old API import, Endpoint import, route editing aliases, adapter tools, and direct Agent publishing are not supported.

Account and session keys remain separate from the service contract: `sk-exora-...` is the one active Cloud buyer key, while `sk-exora-session-...` is scoped to one local Dock/MCP session. Dock strips Agent authorization before injecting its in-memory account key toward Cloud.
