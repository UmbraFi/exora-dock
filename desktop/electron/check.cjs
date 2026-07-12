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
for (const marker of ['function renderV3BuyerSurface', 'function renderV3SellerSurface', "['vm', 'VM']", "['resources', 'Resources']", "['openapi', 'OpenAPI']", "['listings', 'Listings']"]) {
  if (!renderer.includes(marker)) throw new Error(`V3 Electron surface missing: ${marker}`)
}
for (const preserved of ['class="app-shell"', 'class="task-sidebar"', 'data-ledger-list', 'data-order-side-tab="buyer"']) {
  if (!renderer.includes(preserved)) throw new Error(`existing purple Dock shell was replaced: ${preserved}`)
}

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
