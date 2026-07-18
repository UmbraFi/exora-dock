# Desktop UI development

Use the Electron dev runner while iterating on the Desktop frontend. This opens
a live Desktop window and reloads frontend changes without rebuilding or
installing the NSIS package.

```powershell
cd C:\Users\malou\Documents\GitHub\ExoraDock\exora-dock\desktop
npm run preview:desktop
```

The preview command rebuilds `exora-dockd` from the current Go source before
starting Electron. Stop an already-running development Desktop first so Windows
can replace the helper executable. This prevents the UI and MCP server from
silently running different protocol revisions.

The development build resolves Exora Cloud from `EXORA_CLOUD_URL`, then the
persisted Dock `cloud_url`, and finally `http://127.0.0.1:8090`. Packaged builds
require an explicit HTTPS Cloud URL:

```powershell
$env:EXORA_CLOUD_URL = "https://cloud.example.com"
npm run preview:desktop
```

Email/password sessions are encrypted with Electron `safeStorage`. If the host
cannot provide secure storage, the session remains in memory and expires when
the Electron process exits. The six-digit Payment PIN is sent only to the
authenticated Cloud verification endpoints over HTTPS when an approval,
withdrawal, spend-policy change, or account-key action requires it. Desktop and
Dock do not persist the PIN.

Edit these files during UI iteration:

- `desktop/src/main.ts`
- `desktop/src/styles.css`

In **Settings → Agent Connections**, **Test** performs a real stdio MCP
initialize, validates the required tool surface, and runs read-only catalog
searches for `vm`, `resources`, `endpoint`, and `api_bridge`. It does not buy,
publish, invoke an operation, or create a draft.

Only build the installer after the UI is approved:

```powershell
npm run build
```

The Windows installer is generated under:

```text
desktop\release
```
