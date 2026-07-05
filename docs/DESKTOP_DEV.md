# Desktop UI development

Use the Electron dev runner while iterating on the Desktop frontend. This opens
a live Desktop window and reloads frontend changes without rebuilding or
installing the NSIS package.

```powershell
cd C:\Users\malou\Documents\GitHub\ExoraDock\exora-dock\desktop
npm run preview:desktop
```

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
