const assert = require('node:assert/strict')
const test = require('node:test')
const { releaseWarningForArtifact, selectReleaseArtifact } = require('./release-manifest.cjs')

const sha256 = 'a'.repeat(64)
const manifest = {
  schema: 'exora.release-manifest.v2',
  version: 'v0.1.0-preview.2',
  artifacts: [
    { platform: 'windows', architecture: 'x64', format: 'nsis', artifact: 'dock.exe', sha256, signing: { scheme: 'authenticode', status: 'unsigned' } },
    { platform: 'macos', architecture: 'arm64', format: 'zip', artifact: 'dock.zip', sha256, signing: { scheme: 'codesign', status: 'adhoc' } },
    { platform: 'macos', architecture: 'arm64', format: 'dmg', artifact: 'dock.dmg', sha256, signing: { scheme: 'codesign', status: 'adhoc' } },
    { platform: 'linux', architecture: 'x64', format: 'deb', artifact: 'dock.deb', sha256, signing: { scheme: 'checksum', status: 'unsigned' } },
    { platform: 'linux', architecture: 'x64', format: 'appimage', artifact: 'dock.AppImage', sha256, signing: { scheme: 'checksum', status: 'unsigned' } },
  ],
}

test('selects the preferred package for each supported platform', () => {
  assert.equal(selectReleaseArtifact(manifest, 'win32', 'x64').artifact, 'dock.exe')
  assert.equal(selectReleaseArtifact(manifest, 'darwin', 'arm64').artifact, 'dock.dmg')
  assert.equal(selectReleaseArtifact(manifest, 'linux', 'x64').artifact, 'dock.AppImage')
})

test('rejects unsupported architecture and invalid hashes', () => {
  assert.throws(() => selectReleaseArtifact(manifest, 'darwin', 'x64'), /does not contain/)
  assert.throws(() => selectReleaseArtifact({ ...manifest, artifacts: [{ ...manifest.artifacts[0], sha256: 'bad' }] }, 'win32', 'x64'), /does not contain/)
})

test('keeps the legacy Windows-only manifest compatible', () => {
  const legacy = { schema: 'exora.release-manifest.v1', platform: 'windows', artifact: 'old.exe', sha256, authentiCodeSigned: false }
  assert.equal(selectReleaseArtifact(legacy, 'win32', 'x64').artifact, 'old.exe')
  assert.throws(() => selectReleaseArtifact(legacy, 'darwin', 'arm64'), /invalid for this platform/)
  assert.match(releaseWarningForArtifact(selectReleaseArtifact(legacy, 'win32', 'x64')), /SmartScreen/)
})
