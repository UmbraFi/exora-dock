function selectReleaseArtifact(manifest, platformName = process.platform, architecture = process.arch) {
  if (manifest?.schema === 'exora.release-manifest.v1') {
    if (platformName !== 'win32' || manifest.platform !== 'windows' || !validSHA256(manifest.sha256)) {
      throw new Error('Release manifest contract is invalid for this platform.')
    }
    return {
      artifact: manifest.artifact,
      sha256: manifest.sha256,
      platform: 'windows',
      architecture: 'x64',
      format: 'nsis',
      signing: { scheme: 'authenticode', status: manifest.authentiCodeSigned ? 'signed' : 'unsigned' },
    }
  }
  if (manifest?.schema !== 'exora.release-manifest.v2') throw new Error('Release manifest contract is invalid.')
  const platform = platformName === 'win32' ? 'windows' : platformName === 'darwin' ? 'macos' : platformName
  const formatPreference = platform === 'windows' ? ['nsis'] : platform === 'macos' ? ['dmg', 'zip'] : ['appimage', 'deb']
  const artifact = (Array.isArray(manifest.artifacts) ? manifest.artifacts : [])
    .filter((candidate) => candidate?.platform === platform && candidate?.architecture === architecture && validSHA256(candidate?.sha256))
    .sort((left, right) => formatPreference.indexOf(String(left.format)) - formatPreference.indexOf(String(right.format)))[0]
  if (!artifact) throw new Error(`This release does not contain a ${platform}/${architecture} desktop artifact.`)
  return artifact
}

function releaseWarningForArtifact(artifact) {
  if (artifact.platform === 'windows') return 'Unsigned Technical Preview: Windows may show Unknown publisher or SmartScreen warnings.'
  if (artifact.platform === 'macos') return 'Ad-hoc signed Technical Preview: macOS may require the user to choose Open explicitly.'
  return 'Technical Preview: verify the signed release index and SHA-256 checksum before installation.'
}

function validSHA256(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''))
}

module.exports = { releaseWarningForArtifact, selectReleaseArtifact }
