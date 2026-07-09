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
