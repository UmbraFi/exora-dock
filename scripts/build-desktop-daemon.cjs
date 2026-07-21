const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'desktop', 'binaries')
const output = path.join(outputDir, process.platform === 'win32' ? 'exora-dockd.exe' : 'exora-dockd')
fs.mkdirSync(outputDir, { recursive: true })

const buildArgs = ['build']
if (process.platform === 'win32') buildArgs.push('-ldflags', '-H=windowsgui')
buildArgs.push('-o', output, './cmd/exora-dock/')

const result = spawnSync('go', buildArgs, {
  cwd: root,
  env: { ...process.env, CGO_ENABLED: '0' },
  stdio: 'inherit',
  windowsHide: true,
})
if (result.error) {
  console.error(`Unable to build the Desktop Dock helper: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`Built current Desktop Dock helper: ${output}`)
