const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

test('signs the installer and bundled component hashes', () => {
  const root = path.resolve(__dirname, '..')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'exora-release-manifest-'))
  try {
    const artifact = path.join(temporary, 'preview.exe')
    const dock = path.join(temporary, 'exora-dockd.exe')
    const broker = path.join(temporary, 'exora-wsl-broker.exe')
    fs.writeFileSync(artifact, 'installer-bytes')
    fs.writeFileSync(dock, 'dock-bytes')
    fs.writeFileSync(broker, 'broker-bytes')
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    const result = spawnSync(process.execPath, [
      path.join(root, 'scripts', 'build-release-manifest.cjs'), artifact, temporary,
      'v0.1.0-preview.1', '0123456789abcdef', dock, broker,
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, EXORA_RELEASE_SIGNING_PRIVATE_KEY_BASE64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') },
    })
    assert.equal(result.status, 0, result.stderr)
    const encoded = fs.readFileSync(path.join(temporary, 'release-manifest.json'))
    const manifest = JSON.parse(encoded)
    assert.deepEqual(manifest.components.map(({ name }) => name), ['exora-dockd.exe', 'exora-wsl-broker.exe'])
    assert.equal(manifest.sha256, crypto.createHash('sha256').update('installer-bytes').digest('hex'))
    assert.equal(manifest.components[0].sha256, crypto.createHash('sha256').update('dock-bytes').digest('hex'))
    assert.equal(manifest.components[1].sha256, crypto.createHash('sha256').update('broker-bytes').digest('hex'))
    const signature = Buffer.from(fs.readFileSync(path.join(temporary, 'release-manifest.sig'), 'utf8').trim(), 'base64')
    assert.equal(crypto.verify(null, encoded, publicKey, signature), true)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
