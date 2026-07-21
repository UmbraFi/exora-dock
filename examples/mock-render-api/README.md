# Random Puppy Card API

A zero-external-dependency Exora `local_dock` Provider example. Users fill in no fields; every new invocation generates a random puppy SVG profile card and returns its URL and structured details.

The card includes the puppy's name, age, breed, favorite food, favorite activities, favorite player, and fictional home address.

## Start

```powershell
cd C:\Users\malou\Documents\GitHub\ExoraDock\exora-dock\examples\mock-render-api
npm start
```

By default, the service listens at `http://127.0.0.1:8791`:

- `GET` or `HEAD /health`: health check
- `POST /v1/puppy-card`: generate a random puppy card with zero input
- `GET /renders/{render_id}.svg`: open the generated SVG

## Local invocation

No request body is needed:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8791/v1/puppy-card
```

An empty object `{}` is also accepted. Reusing the same Dock-forwarded `X-Exora-Invocation-Id` returns the same result; a new invocation generates a new random card.

## Generate an uploadable contract

```powershell
npm run prepare
```

The generated `contract.ready.json` contains no UID. Upload it to an existing API Draft; Dock injects that Draft's stable UID. The new name is **Random Puppy Card API**, the Operation name is **Generate Random Puppy Card**, and `operationId` is `generate_puppy_card`.

The current contract retains a price of `0.01 USDC` per successful delivery and a per-invocation cap of `0.01 USDC`.

## Tests

```powershell
npm test
```

The service binds only to the IPv4 loopback address. It caches at most the latest 200 SVGs and clears the cache on restart. All home addresses on the cards are fictional.
