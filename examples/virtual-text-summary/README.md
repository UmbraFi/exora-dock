# Virtual Text Summary API

This local fixture exercises the Exora Provider workflow without an external dependency.

## Runtime

Start the existing test service from the `exora-dock` directory:

```powershell
node .\scripts\dev-summary-test-api.cjs
```

It exposes:

- `GET http://127.0.0.1:3000/health`
- `POST http://127.0.0.1:3000/summarize`

## API contract

Use [`contract.json`](./contract.json) as the single source file, then upload
the JSON in **Contract validation**. The JSON does not contain an API UID;
Dock injects the stable UID of the currently open Draft. The same file contains API capability,
Seller cases and the automated billing rule; there is no separate form.

The two Seller fixtures verify a successful response and the declared `invalid_text` business-error envelope. They intentionally verify status, media type, and OpenAPI response schema rather than exact summary text.

## Combined validation

Select **Test contract**. Dock validates connectivity and response formats first,
then tests `delivered * 0.03` with a `0.05` USDC invocation maximum in the Cloud
Sandbox Ledger. The sandbox moves no real USDC. After both receipts pass, the
owner selects **Confirm contract** once; Operations then unlocks.
