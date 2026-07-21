const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

for (const file of fs.readdirSync(__dirname).filter((name) => name.endsWith('.cjs') && !name.endsWith('.test.cjs'))) {
  const result = spawnSync(process.execPath, ['--check', path.join(__dirname, file)], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.ts'), 'utf8')
const bridge = fs.readFileSync(path.join(__dirname, '..', 'src', 'bridge.ts'), 'utf8')
const mcp = ['server.go', 'integration_tools.go'].map((name) => fs.readFileSync(path.join(__dirname, '..', '..', 'internal', 'mcp', name), 'utf8')).join('\n')
const routes = fs.readFileSync(path.join(__dirname, '..', '..', 'internal', 'server', 'server.go'), 'utf8')
const electronMain = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const agentRegistry = fs.readFileSync(path.join(__dirname, 'agent-mcp-registry.cjs'), 'utf8')
const mcpConnectivity = fs.readFileSync(path.join(__dirname, 'mcp-connectivity.cjs'), 'utf8')
const desktopDaemonBuild = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'build-desktop-daemon.cjs'), 'utf8')
const windowsDesktopBuild = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'build-win-docker.ps1'), 'utf8')
const packageJSON = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))

for (const marker of ["['buyer', 'Market'", "['local_api', 'Local API'", "['cloud_api', 'Cloud API'"]) {
  if (!renderer.includes(marker)) throw new Error(`API-only Desktop surface missing: ${marker}`)
}
const topTabs = renderer.slice(renderer.indexOf('function renderV3SellerTabs()'), renderer.indexOf('function syncV3SellerTabs()'))
for (const forbidden of ["['vm', 'VM'", "['resources', 'Resources'"]) {
  if (topTabs.includes(forbidden)) throw new Error(`Retired top-level workspace returned: ${forbidden}`)
}
if (topTabs.includes("'Seller'")) throw new Error('Seller top-level workspace returned')
if (!bridge.includes("applicationSource: 'api'")) throw new Error('Desktop MCP preview must expose only applicationSource api')
if (!routes.includes('r.Route("/v4"') || routes.includes('r.Route("/v3"')) throw new Error('Dock marketplace must expose only /v4')
for (const retiredTool of ['purchase_compute_minutes', 'purchase_download', 'transfer_compute_file', 'save_endpoint_draft', 'save_api_bridge_draft', 'save_api_draft']) {
  if (mcp.includes(`\"exora.${retiredTool}\"`)) throw new Error(`Retired MCP tool returned: ${retiredTool}`)
}
for (const requiredTool of ['get_api_preparation_guide', 'create_api_draft', 'submit_api_contract', 'list_api_drafts', 'get_api_draft', 'get_api_validation']) {
  if (!mcp.includes(`\"exora.${requiredTool}\"`)) throw new Error(`Final-form API MCP tool missing: ${requiredTool}`)
}
if (mcp.includes('submit_pricing_suggestions')) throw new Error('Agent pricing mutation tool returned')
const ipcSurface = electronMain.slice(electronMain.indexOf('function createIpcHandlerGroups()'), electronMain.indexOf('async function window_minimize'))
for (const retiredCommand of ['consumer_purchase_download', 'consumer_purchase_compute', 'consumer_get_lease', 'provider_vm_probe', 'provider_environment_catalog', 'provider_resource_item_update']) {
  if (ipcSurface.includes(retiredCommand) || electronMain.includes(retiredCommand)) throw new Error(`Retired Desktop implementation returned: ${retiredCommand}`)
}
for (const forbidden of ['/v3/', 'exora-wsl-broker', 'image-signing-public-key', 'resourceArchiveTempRoot']) {
  if (electronMain.includes(forbidden)) throw new Error(`Retired Desktop implementation returned: ${forbidden}`)
}
for (const forbidden of ['seller.draft', 'seller.build', '/v4/gateway/', '/v4/local/endpoints']) {
  if (routes.includes(forbidden) || mcp.includes(forbidden)) throw new Error(`Retired integration surface returned: ${forbidden}`)
}
const resources = JSON.stringify(packageJSON.build?.extraResources || [])
for (const forbidden of ['resources/wsl', 'image-signing-public-key', 'exora-wsl-broker', 'exora-worker']) {
  if (resources.includes(forbidden)) throw new Error(`Retired runtime asset is packaged: ${forbidden}`)
}
for (const [name, source] of [['Electron daemon runtime', electronMain], ['Agent CLI registry', agentRegistry], ['MCP connectivity probe', mcpConnectivity]]) {
  if (!source.includes('windowsHide: true')) throw new Error(`${name} must suppress Windows child-process consoles`)
}
if (!electronMain.includes('registry.list({ passive: true })')) throw new Error('Opening settings must not launch Agent CLI probes')
for (const [name, source] of [['Desktop helper build', desktopDaemonBuild], ['Windows release build', windowsDesktopBuild]]) {
  if (!source.includes('-H=windowsgui')) throw new Error(`${name} must produce a console-free Windows helper`)
}
console.log('Exora V4 API-only Electron checks passed')
