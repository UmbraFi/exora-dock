const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const [artifactDirectory, outputDirectory, version, commit] = process.argv.slice(2)
if (!artifactDirectory || !outputDirectory || !version || !commit) {
  throw new Error('usage: node build-release-manifest.cjs <artifact-dir> <output-dir> <version> <commit>')
}
const privateKeyBase64 = String(process.env.EXORA_RELEASE_SIGNING_PRIVATE_KEY_BASE64 || '').trim()
if (!privateKeyBase64) throw new Error('EXORA_RELEASE_SIGNING_PRIVATE_KEY_BASE64 is required')

const definitions = [
  { pattern: /Windows-x64-Unsigned-Technical-Preview\.exe$/i, platform: 'windows', architecture: 'x64', format: 'nsis', signing: { scheme: 'authenticode', status: 'unsigned' } },
  { pattern: /macOS-arm64\.dmg$/i, platform: 'macos', architecture: 'arm64', format: 'dmg', signing: { scheme: 'codesign', status: 'adhoc', notarized: false } },
  { pattern: /macOS-arm64\.zip$/i, platform: 'macos', architecture: 'arm64', format: 'zip', signing: { scheme: 'codesign', status: 'adhoc', notarized: false } },
]

const artifacts = fs.readdirSync(artifactDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .flatMap((entry) => {
    const definition = definitions.find(({ pattern }) => pattern.test(entry.name))
    if (!definition) return []
    const bytes = fs.readFileSync(path.join(artifactDirectory, entry.name))
    return [{
      platform: definition.platform,
      architecture: definition.architecture,
      format: definition.format,
      artifact: entry.name,
      sizeBytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      signing: definition.signing,
    }]
  })
  .sort((left, right) => `${left.platform}:${left.format}`.localeCompare(`${right.platform}:${right.format}`))

for (const platform of ['windows', 'macos']) {
  if (!artifacts.some((artifact) => artifact.platform === platform)) throw new Error(`release artifact is missing for ${platform}`)
}

const manifest = {
  schema: 'exora.release-manifest.v2',
  version,
  channel: 'technical-preview',
  artifacts,
  commit,
  publishedAt: new Date().toISOString(),
}
const encoded = Buffer.from(`${JSON.stringify(manifest)}\n`)
const key = crypto.createPrivateKey({ key: Buffer.from(privateKeyBase64, 'base64'), format: 'der', type: 'pkcs8' })
const signature = crypto.sign(null, encoded, key).toString('base64')
fs.mkdirSync(outputDirectory, { recursive: true })
fs.writeFileSync(path.join(outputDirectory, 'release-manifest.json'), encoded)
fs.writeFileSync(path.join(outputDirectory, 'release-manifest.sig'), `${signature}\n`)
fs.writeFileSync(path.join(outputDirectory, 'SHA256SUMS.txt'), artifacts.map((artifact) => `${artifact.sha256}  ${artifact.artifact}`).join('\n') + '\n')
