# Random Three-Card Tarot API

A zero-input local Node.js API that draws three unique cards from a full 78-card tarot deck. Each draw assigns Past, Present, and Future positions, randomly chooses upright or reversed orientation, and generates a single SVG reading.

## Start

```powershell
cd C:\Users\malou\Documents\GitHub\ExoraDock\exora-dock\examples\random-tarot-api
npm start
```

The default server address is `http://127.0.0.1:8792`.

- `GET` or `HEAD /health`: health check
- `POST /v1/draw-three`: create a zero-input three-card reading
- `GET /draws/{draw_id}.svg`: open the generated SVG

No request body is needed. Sending an empty JSON object is also accepted. The same `X-Exora-Invocation-Id` produces the same result for safe retries; a new invocation produces a new random draw.

## Test

```powershell
npm test
```

## Exora contract

[`contract.json`](./contract.json) is the UID-free `exora.api-contract.v1` source for the zero-input `POST /v1/draw-three` Operation. Exora Dock creates and owns the stable API UID when the Draft is created, then injects that UID during contract submission.

Tarot readings are for entertainment and personal reflection only.
