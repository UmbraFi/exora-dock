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
const rendererStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
for (const marker of ['function renderV3SellerSurface', "['listings', 'Listings',", "['vm', 'VM',", "['resources', 'Resources',", "['endpoint', 'Endpoint',", "['api_bridge', 'API Bridge',", 'function renderV3EndpointAgentPage', 'class="v3-seller-active-bar"', 'class="v3-market-surface v3-seller-surface"']) {
  if (!renderer.includes(marker)) throw new Error(`V3 Electron surface missing: ${marker}`)
}
const tabOrder = ["['listings', 'Listings',", "['vm', 'VM',", "['resources', 'Resources',", "['endpoint', 'Endpoint',", "['api_bridge', 'API Bridge',"].map((marker) => renderer.indexOf(marker))
if (tabOrder.some((index) => index < 0) || tabOrder.some((index, position) => position > 0 && index <= tabOrder[position - 1])) throw new Error('Main workspace tabs must be ordered Listings, VM, Resources, Endpoint, API Bridge')
if (!renderer.includes("v3SellerTab: 'listings'")) throw new Error('Listings must be the default main workspace tab')
const sideSwitch = renderer.slice(renderer.indexOf('function selectOrderSide('), renderer.indexOf('function sellerMonitorActive('))
if (!sideSwitch || sideSwitch.includes('v3SellerTab =')) throw new Error('Buyer/Seller history switching must not change the main workspace tab')
for (const marker of ['function renderV3UnifiedListingsPageV2', "v3ListingMode: 'buyer'", 'data-v3-listing-mode="buyer"', 'data-v3-listing-mode="seller"', 'v3-listing-search-switch', 'data-listing-owner=', 'data-v3-consumer-form="api"', 'data-v3-consumer-form="compute"', 'data-v3-consumer-action="purchase-download"']) {
  if (!renderer.includes(marker)) throw new Error(`Unified marketplace surface missing: ${marker}`)
}
const listingsSurface = renderer.slice(renderer.indexOf('function renderV3UnifiedListingsPageV2'), renderer.indexOf('function renderV3SellerSurface'))
for (const removedListingChrome of ['v3-listing-overview', 'v3-listing-stats', 'data-v3-listing-filter-scope', 'data-v3-listing-filter-kind', 'data-v3-listing-filter-status', 'Refresh both']) {
  if (listingsSurface.includes(removedListingChrome)) throw new Error(`Listings surface still includes removed overview or filters: ${removedListingChrome}`)
}
for (const nestedListingContainer of ['v3-listing-search-switch v3-console-panel', 'v3-listing-workspace v3-console-panel']) {
  if (listingsSurface.includes(nestedListingContainer)) throw new Error(`Listings surface must stay flat: ${nestedListingContainer}`)
}
if (!/\.v3-application-flow,\s*\.v3-vm-onboarding,\s*\.v3-listings-page\s*\{[^}]*width:\s*100%;[^}]*margin:\s*0;/s.test(rendererStyles)) throw new Error('Listings must share the seller stack width and offset')
if (!/\.app-shell\.seller-surface-mode \.action-view\s*\{[^}]*overflow-y:\s*scroll;[^}]*scrollbar-gutter:\s*stable both-edges;/s.test(rendererStyles)) throw new Error('Seller tabs must keep one symmetric scroll lane')
if (!/state\.v3SellerTab = nextTab\s*renderDecisionPanel\(\)\s*fields\.actionView\.scrollTop = 0/.test(renderer)) throw new Error('Seller tab switches must reset the shared scroll position')
const listingStyles = rendererStyles.slice(rendererStyles.indexOf('.v3-listing-overview,'), rendererStyles.indexOf('.v3-endpoint-review-list'))
if (!listingStyles || listingStyles.includes('linear-gradient')) throw new Error('Listings containers must use solid backgrounds')
for (const marker of ['function renderV3HistoryRow', 'function renderV3ActivityDetail', 'data-v3-history-session', 'data-v3-activity-detail']) {
  if (!renderer.includes(marker)) throw new Error(`V3 history surface missing: ${marker}`)
}
const electronMain = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const cloudAuthMain = fs.readFileSync(path.join(__dirname, 'cloud-auth.cjs'), 'utf8')
const authUI = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth-ui.ts'), 'utf8')
for (const marker of ['auth_registration_start', 'auth_password_reset_complete', 'auth_pin_reset', 'exora:auth-state-changed', 'ensureDockLink']) {
  if (!electronMain.includes(marker) && !cloudAuthMain.includes(marker)) throw new Error(`Cloud identity flow missing: ${marker}`)
}
for (const marker of ['auth-gate', 'data-auth-form="login"', 'data-auth-form="register"', 'data-auth-form="pin-reset"']) {
  if (!authUI.includes(marker)) throw new Error(`Cloud identity UI missing: ${marker}`)
}
if (!cloudAuthMain.includes("storageMode: encryptionAvailable() ? 'safeStorage' : 'session'")) throw new Error('Cloud sessions must use safeStorage or process-only memory')
if (/pin\s*:\s*pendingRegistration\.pin/.test(cloudAuthMain)) throw new Error('Local PIN must never be included in a Cloud registration request')
for (const marker of ['activity_sessions', 'activity_session', '/v3/activity-sessions']) {
  if (!electronMain.includes(marker)) throw new Error(`V3 history IPC missing: ${marker}`)
}
for (const marker of ['v3-application-flow', 'v3-shared-file-picker', 'v3-shared-file-empty', 'v3AgentMaterialsCurrent', 'Review Agent draft', 'data-v3-review-confirm', 'Public endpoint and seller confirmation', 'Submit to Listings']) {
  if (!renderer.includes(marker)) throw new Error(`API bridge seller surface missing: ${marker}`)
}
if (renderer.includes('original.outerHTML = renderV3AgentMaterialPicker')) throw new Error('Agent file picker must be rendered directly, not patched after mount')
for (const removedWizard of ['renderV3ResourcesPageLegacy', 'renderV3EndpointAgentPageLegacy', 'function renderV3EndpointPage()', 'updateV3WindowsPricingLayout']) {
  if (renderer.includes(removedWizard)) throw new Error(`obsolete creation surface remains: ${removedWizard}`)
}
for (const preserved of ['class="app-shell"', 'class="task-sidebar"', 'data-ledger-list', 'data-order-side-tab="buyer"']) {
  if (!renderer.includes(preserved)) throw new Error(`existing purple Dock shell was replaced: ${preserved}`)
}
for (const removedSettingsPage of ['data-settings-page="api"', 'data-settings-page="local-agents"', 'data-settings-page="seller-card"', 'data-settings-page="buyer-agent"', 'data-settings-page="seller"']) {
  if (renderer.includes(removedSettingsPage)) throw new Error(`removed settings component remains mounted: ${removedSettingsPage}`)
}
for (const marker of ['provider_environment_catalog', 'provider_environment_download', 'managed_wsl2_shared_host', 'v3-environment-cloud-launcher', 'v3-cloud-image-card']) {
  if (!renderer.includes(marker) && !fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8').includes(marker)) throw new Error(`Windows WSL provider surface missing: ${marker}`)
}
for (const marker of ['safeStorage.encryptString', 'safeStorage.decryptString', 'clipboard.clear()', 'account_key_status', 'account_key_save', 'account_key_delete']) {
  if (!electronMain.includes(marker)) throw new Error(`secure account key support missing: ${marker}`)
}
if (electronMain.includes('payload?.input?.key')) throw new Error('Account keys must never be accepted from the renderer process')
if (!electronMain.includes("const key = String(clipboardValue || '').trim()")) throw new Error('Account keys must be read directly by the Electron main process')
if (!electronMain.includes('provider_api_probe')) throw new Error('API bridge connection probe is missing')
if (!electronMain.includes('provider_endpoint_test_route')) throw new Error('Local Endpoint route smoke test is missing')
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
