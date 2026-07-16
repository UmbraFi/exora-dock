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
