const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const sourceFiles = [
  path.join(__dirname, '..', 'src', 'main.ts'),
  path.join(__dirname, '..', 'src', 'auth-ui.ts'),
  path.join(__dirname, '..', 'index.html'),
]
const sources = sourceFiles.map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }))
const combinedSource = sources.map(({ source }) => source).join('\n')
const combinedStyles = [
  'styles.css',
  'styles/v3-api.css',
  'styles/v3-environment.css',
  'styles/v3-listings.css',
].map((file) => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8')).join('\n')

function buttonTags(file, source) {
  return Array.from(source.matchAll(/<button\b[^>]*>/g), (match) => ({
    file,
    line: source.slice(0, match.index).split('\n').length,
    tag: match[0],
  })).filter(({ tag }) => !tag.startsWith('<button[^') && !tag.startsWith('<button(') && !tag.startsWith('<button$'))
}

function datasetProperty(attribute) {
  return attribute.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

test('every rendered button has an explicit valid type', () => {
  for (const { file, source } of sources) {
    for (const button of buttonTags(file, source)) {
      const type = /\btype\s*=\s*["']([^"']+)["']/.exec(button.tag)?.[1]
      assert.ok(type, `${path.basename(file)}:${button.line} button is missing an explicit type: ${button.tag}`)
      assert.ok(type === 'button' || type === 'submit', `${path.basename(file)}:${button.line} has unsupported button type ${type}`)
    }
  }
})

test('every non-submit button exposes a bound action or is intentionally disabled', () => {
  for (const { file, source } of sources) {
    for (const button of buttonTags(file, source)) {
      if (/\btype\s*=\s*["']submit["']/.test(button.tag) || /\bdisabled\b/.test(button.tag)) continue
      const attributes = Array.from(button.tag.matchAll(/\b(data-[a-z0-9-]+)/g), (match) => match[1])
      const bound = attributes.some((attribute) => {
        const occurrences = combinedSource.match(new RegExp(attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []
        return occurrences.length > 1 || combinedSource.includes(`dataset.${datasetProperty(attribute)}`)
      })
      assert.ok(bound, `${path.basename(file)}:${button.line} has no auditable action binding: ${button.tag}`)
    }
  }
})

test('button interaction styles cover default and destructive states', () => {
  assert.match(combinedStyles, /button:hover\s*\{[^}]*background:/s)
  assert.match(combinedStyles, /button\.danger\.ghost:hover:not\(:disabled\)\s*\{/)
  assert.match(combinedStyles, /button\.ghost:not\(\.danger\)/)
  assert.match(combinedStyles, /\.v3-shared-file-row\s*>\s*button\s*\{[^}]*height:\s*30px;[^}]*font-size:\s*9px;/s)
  assert.match(combinedStyles, /\.v3-api-price-component\s*>\s*button,[\s\S]*?height:\s*30px;/)
})

test('material removal uses local button busy state instead of the global refresh flow', () => {
  assert.match(combinedSource, /function removeV3AgentMaterial\(/)
  assert.match(combinedSource, /await runControlAction\(button,/)
  assert.doesNotMatch(combinedSource, /data-v3-(?:endpoint|api)-material-remove[^\n]*\brun\(/)
})

test('minute pricing uses the same six-decimal minimum and step', () => {
  assert.match(combinedSource, /data-v3-pricing="pricePerMinute"[^>]*min="0\.000001"[^>]*step="0\.000001"/)
  assert.doesNotMatch(combinedSource, /data-v3-pricing="pricePerMinute"[^>]*min="0\.000001"[^>]*step="0\.001"/)
})

test('resource file selection and per-file pricing stay in one step', () => {
  assert.match(combinedSource, /<strong>Add files, prices and tags<\/strong>/)
  assert.match(combinedSource, /<strong>\$\{state\.v3ResourceTargetSheet \? 'Review existing Res sheet and submit' : 'Describe and submit the Res sheet'\}<\/strong>/)
  assert.doesNotMatch(combinedSource, /<strong>Set file prices and tags<\/strong>/)
})

test('resource product rows keep the file summary vertically centered', () => {
  assert.match(combinedSource, /class="v3-resource-file-summary"/)
  assert.match(combinedStyles, /\.v3-resource-file-config\s*\{[^}]*align-items:\s*center;/s)
  assert.match(combinedStyles, /\.v3-resource-file-summary\s*\{[^}]*align-items:\s*center;/s)
})

test('environment library keeps the signed catalog and ready local environments together', () => {
  assert.match(combinedSource, /function v3MergeEnvironmentImages\(catalogImages:/)
  assert.match(combinedSource, /catalogImages\.forEach\(\(image\) => images\.set\(v3EnvironmentImageKey\(image\), image\)\)/)
  assert.match(combinedSource, /state\.v3EnvironmentImages = v3MergeEnvironmentImages\(catalog\.images \|\| \[\], state\.v3InstalledEnvironments\)/)
})

test('seller listings expose one accessible lifecycle switch and destructive delete path', () => {
  assert.match(combinedSource, /class="v3-listing-state-pill v3-listing-lifecycle-switch[^>]*role="switch"[^>]*aria-checked=/)
  assert.match(combinedSource, /data-v3-listing-action="\$\{escapeAttr\(toggleAction\)\}"/)
  assert.match(combinedSource, /data-v3-listing-delete/)
  assert.match(combinedSource, /deleteAllowed \? 'data-v3-listing-delete' : 'data-v3-listing-delete-unavailable'/)
  assert.match(combinedSource, /This Cloud deployment does not support Listing deletion yet\. Deploy migration 033/)
  assert.doesNotMatch(combinedSource, /const fallbackActions =[^\n]*'delete'/)
  assert.match(combinedSource, /await invoke\('provider_listing_delete'/)
  assert.match(combinedSource, /removed from the market and cannot be restored\. Existing transactions and audit history will be kept/)
  assert.match(combinedSource, /button\.innerHTML = `<i><\/i>\$\{escapeHTML\(sx\('Updating…', '处理中…'\)\)\}`/)
  assert.match(combinedSource, /void runControlAction\(button, async \(\) => \{/)
  assert.doesNotMatch(combinedSource, /data-v3-listing-action="retire"/)
  assert.match(combinedStyles, /\.v3-listing-lifecycle-switch:focus-visible\s*\{/)
  assert.match(combinedStyles, /\.v3-listing-lifecycle-switch:disabled\s*\{[^}]*cursor:\s*not-allowed;/s)
})

test('VM creation waits for the Cloud device slot before rendering scan controls', () => {
  assert.match(combinedSource, /function renderV3VMPage\(\) \{\s+if \(!state\.v3ListingsLoaded\)/)
  assert.match(combinedSource, /has no existing VM Listing before scanning or reserving disk space/)
  assert.match(combinedSource, /data-v3-vm-slot-refresh/)
  assert.match(combinedSource, /if \(state\.v3VMListingConstraint\.available\) return/)
})

test('legacy Cloud readiness is displayed as Terminal and WebRTC delivery', () => {
  assert.match(combinedSource, /function v3DisplayReadinessCheck\(check: V3ReadinessCheck\)/)
  assert.match(combinedSource, /id: 'terminal_webrtc_delivery'/)
  assert.match(combinedSource, /Exora Terminal and WebRTC delivery ready/)
  assert.match(combinedSource, /checks = \(readiness\?\.checks \|\| \[\]\)\.map\(v3DisplayReadinessCheck\)/)
  assert.doesNotMatch(combinedSource, /Cloud SSH|SSH ingress/)
})
