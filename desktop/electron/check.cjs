const { spawnSync } = require('node:child_process')
const path = require('node:path')

for (const file of ['main.cjs', 'preload.cjs']) {
  const result = spawnSync(process.execPath, ['--check', path.join(__dirname, file)], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
