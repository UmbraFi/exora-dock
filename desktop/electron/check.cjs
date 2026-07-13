const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

for (const file of electronScripts(__dirname)) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.ts'), 'utf8')
for (const marker of ['function renderV3BuyerSurface', 'function renderV3SellerSurface', "['vm', 'VM',", "['resources', 'Resources',", "['endpoint', 'Endpoint',", "['openapi', 'OpenAPI',", "['listings', 'Listings',", 'function renderV3EndpointPage', 'class="v3-seller-active-bar"']) {
  if (!renderer.includes(marker)) throw new Error(`V3 Electron surface missing: ${marker}`)
}
for (const marker of ['v3-api-onboarding', 'data-v3-api-protocol', 'data-v3-api-route-toggle', 'Save bridge draft']) {
  if (!renderer.includes(marker)) throw new Error(`API bridge seller surface missing: ${marker}`)
}
for (const preserved of ['class="app-shell"', 'class="task-sidebar"', 'data-ledger-list', 'data-order-side-tab="buyer"']) {
  if (!renderer.includes(preserved)) throw new Error(`existing purple Dock shell was replaced: ${preserved}`)
}
for (const removedSettingsPage of ['data-settings-page="api"', 'data-settings-page="local-agents"', 'data-settings-page="seller-card"', 'data-settings-page="buyer-agent"', 'data-settings-page="seller"']) {
  if (renderer.includes(removedSettingsPage)) throw new Error(`removed settings component remains mounted: ${removedSettingsPage}`)
}
for (const marker of ['provider_environment_catalog', 'provider_environment_download', 'experimental_shared_host', 'v3-environment-cloud-launcher', 'v3-cloud-image-card']) {
  if (!renderer.includes(marker) && !fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8').includes(marker)) throw new Error(`Windows WSL provider surface missing: ${marker}`)
}
if (!fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8').includes('provider_api_probe')) throw new Error('API bridge connection probe is missing')
for (const marker of ['provider_asset_clear_selection', 'asset_packaging', 'application/zip', 'MAX_RESOURCE_ARCHIVE_BYTES']) {
  if (!fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8').includes(marker)) throw new Error(`single ZIP resource upload is missing: ${marker}`)
}
const packageConfig = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
if (!packageConfig.includes('resources/wsl')) throw new Error('Windows installer does not embed the locked WSL Runtime resource')
const imageFiles = fs.readdirSync(path.join(__dirname, '..', 'resources', 'wsl'))
if (imageFiles.some((name) => name.endsWith('.wsl'))) throw new Error('Windows installer must not embed a Linux environment image')

function electronScripts(root) {
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...electronScripts(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.cjs')) {
      files.push(fullPath)
    }
  }
  return files.sort()
}
