# Electron Runtime

This folder owns the desktop shell around the local Exora Dock daemon.

## Files

- `main.cjs` boots Electron, creates the main window, manages the bundled daemon,
  persists desktop-only state, and proxies owner-approved actions to the local
  Dock HTTP API.
- `preload.cjs` exposes the narrow `window.exora.invoke(command, payload)` bridge
  plus startup locale metadata. It does not expose Node.js APIs.
- `ipc.cjs` contains the generic IPC registration helper and duplicate-command
  checks. Command ownership remains grouped in `main.cjs`.
- `security.cjs` contains the renderer trust policy, navigation guards, external
  link handling, and IPC sender validation.
- `workspace.cjs` builds the workspace snapshot, keeps local HTTP fetches
  concurrent, and caches per-run event reads so polling does less duplicate work.
- `check.cjs` syntax-checks every CommonJS script in this folder during
  `npm run build:electron`.

## IPC Shape

The renderer calls one channel, `exora:invoke`, and passes a command string.
`main.cjs` groups commands by domain:

- `window`: minimize, close, maximize, and manual drag.
- `dockRuntime`: daemon lifecycle, health, logs, MCP prompt/config strings.
- `localWork`: workspace snapshots, work MCP leases, project folder operations.
- `persistence`: desktop settings, locale, chat, archives, transactions.
- `pwaLink`: remote PWA link QR and token exchange.
- `llmAndSeller`: API profiles, seller agent settings, provider probes.
- `agentCardsAndMarket`: card diagnostics, publishing, market search.
- `ownerLedger`: approvals, order plans, tasks, payments, payment PIN.
- `walletAndSecurity`: wallet create/unlock/restore/withdraw and security status.

When adding a command, place the handler near its domain logic in `main.cjs`, add
it to the relevant group in `createIpcHandlerGroups()`, and keep renderer payloads
plain JSON-serializable.

## Security Model

Only trusted app URLs may use IPC:

- Development trusts the configured Vite origin from
  `EXORA_DOCK_DESKTOP_DEV_URL` or `http://127.0.0.1:1420`.
- Packaged builds trust only files under `dist/`.

Top-level navigations away from the app are blocked. HTTP, HTTPS, and mail links
opened by the renderer are delegated to the OS browser instead of keeping the
desktop bridge attached to an external page.
