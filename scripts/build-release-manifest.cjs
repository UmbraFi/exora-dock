const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const [artifactPath, outputDirectory, version, commit] = process.argv.slice(2)
if (!artifactPath || !outputDirectory || !version || !commit) {
  throw new Error('usage: node build-release-manifest.cjs <artifact> <output-dir> <version> <commit>')
}
const privateKeyBase64 = String(process.env.EXORA_RELEASE_SIGNING_PRIVATE_KEY_BASE64 || '').trim()
if (!privateKeyBase64) throw new Error('EXORA_RELEASE_SIGNING_PRIVATE_KEY_BASE64 is required')

const artifact = fs.readFileSync(artifactPath)
const manifest = {
  schema: 'exora.release-manifest.v1',
  version,
  channel: 'technical-preview',
  platform: 'windows',
  architecture: 'x64',
  authentiCodeSigned: false,
  artifact: path.basename(artifactPath),
  sizeBytes: artifact.length,
  sha256: crypto.createHash('sha256').update(artifact).digest('hex'),
  commit,
  publishedAt: new Date().toISOString(),
}
const encoded = Buffer.from(`${JSON.stringify(manifest)}\n`)
const key = crypto.createPrivateKey({ key: Buffer.from(privateKeyBase64, 'base64'), format: 'der', type: 'pkcs8' })
const signature = crypto.sign(null, encoded, key).toString('base64')
fs.mkdirSync(outputDirectory, { recursive: true })
fs.writeFileSync(path.join(outputDirectory, 'release-manifest.json'), encoded)
fs.writeFileSync(path.join(outputDirectory, 'release-manifest.sig'), `${signature}\n`)
fs.writeFileSync(path.join(outputDirectory, 'SHA256SUMS.txt'), `${manifest.sha256}  ${manifest.artifact}\n`)
