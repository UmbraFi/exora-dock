const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

test('signs a complete three-platform release index and checksum list', () => {
  const root = path.resolve(__dirname, '..')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'exora-release-manifest-'))
  const input = path.join(temporary, 'input')
  const output = path.join(temporary, 'output')
  fs.mkdirSync(input)
  const files = {
    'Exora-Dock-0.1.0-preview.2-Windows-x64-Unsigned-Technical-Preview.exe': 'windows-installer',
    'Exora-Dock-0.1.0-preview.2-macOS-arm64.dmg': 'mac-dmg',
    'Exora-Dock-0.1.0-preview.2-macOS-arm64.zip': 'mac-zip',
    'Exora-Dock-0.1.0-preview.2-Linux-x64.AppImage': 'linux-appimage',
    'Exora-Dock-0.1.0-preview.2-Linux-x64.deb': 'linux-deb',
  }
  try {
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(input, name), bytes)
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    const result = spawnSync(process.execPath, [
      path.join(root, 'scripts', 'build-release-manifest.cjs'), input, output,
      'v0.1.0-preview.2', '0123456789abcdef',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, EXORA_RELEASE_SIGNING_PRIVATE_KEY_BASE64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') },
    })
    assert.equal(result.status, 0, result.stderr)
    const encoded = fs.readFileSync(path.join(output, 'release-manifest.json'))
    const manifest = JSON.parse(encoded)
    assert.equal(manifest.schema, 'exora.release-manifest.v2')
    assert.deepEqual(new Set(manifest.artifacts.map(({ platform }) => platform)), new Set(['windows', 'macos', 'linux']))
    assert.equal(manifest.artifacts.length, 5)
    for (const artifact of manifest.artifacts) {
      assert.equal(artifact.sha256, crypto.createHash('sha256').update(files[artifact.artifact]).digest('hex'))
    }
    const signature = Buffer.from(fs.readFileSync(path.join(output, 'release-manifest.sig'), 'utf8').trim(), 'base64')
    assert.equal(crypto.verify(null, encoded, publicKey, signature), true)
    const sums = fs.readFileSync(path.join(output, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')
    assert.equal(sums.length, 5)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
