# Desktop UI development

Use the Electron dev runner while iterating on the Desktop frontend. This opens
a live Desktop window and reloads frontend changes without rebuilding or
installing the NSIS package.

```powershell
cd C:\Users\malou\Documents\GitHub\ExoraDock\exora-dock\desktop
npm run preview:desktop
```

The development build resolves Exora Cloud from `EXORA_CLOUD_URL`, then the
persisted Dock `cloud_url`, and finally `http://127.0.0.1:8090`. Packaged builds
require an explicit HTTPS Cloud URL:

```powershell
$env:EXORA_CLOUD_URL = "https://cloud.example.com"
npm run preview:desktop
```

Email/password sessions are encrypted with Electron `safeStorage`. If the host
cannot provide secure storage, the session remains in memory and expires when
the Electron process exits. The six-digit payment PIN is never sent to Cloud.

Edit these files during UI iteration:

- `desktop/src/main.ts`
- `desktop/src/styles.css`

Only build the installer after the UI is approved:

```powershell
npm run build
```

The Windows installer is generated under:

```text
desktop\release
```
