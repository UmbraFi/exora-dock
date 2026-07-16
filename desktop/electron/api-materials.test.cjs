const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  readAPIBridgeMaterialManifest,
  removeAPIBridgeMaterial,
  storedMaterialPath,
  writeJSONAtomically,
} = require('./api-materials.cjs')

async function withTempDir(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'exora-api-material-test-'))
  try {
    return await run(root)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
}

test('removes one material from the manifest and local storage', async () => withTempDir(async (root) => {
  const draftId = 'apid_12345678'
  const firstPath = path.join(root, '111111111111-first.json')
  const secondPath = path.join(root, '222222222222-second.md')
  await Promise.all([fsp.writeFile(firstPath, '{}'), fsp.writeFile(secondPath, '# second')])
  await writeJSONAtomically(path.join(root, 'manifest.json'), {
    draftId,
    files: [
      { id: path.basename(firstPath), localPath: firstPath },
      { id: path.basename(secondPath), localPath: secondPath },
    ],
  })

  const result = await removeAPIBridgeMaterial({ root, draftId, id: path.basename(firstPath) })
  assert.equal(result.removed, true)
  assert.deepEqual(result.files.map((file) => file.id), [path.basename(secondPath)])
  assert.equal(fs.existsSync(firstPath), false)
  assert.equal(fs.existsSync(secondPath), true)
  const saved = await readAPIBridgeMaterialManifest(root, draftId)
  assert.deepEqual(saved.files.map((file) => file.id), [path.basename(secondPath)])
}))

test('serializes rapid removals without restoring stale manifest entries', async () => withTempDir(async (root) => {
  const draftId = 'apid_abcdefgh'
  const files = await Promise.all(['a.json', 'b.json', 'c.json'].map(async (name, index) => {
    const id = `${index}${index}${index}${index}${index}${index}${index}${index}${index}${index}${index}${index}-${name}`
    const localPath = path.join(root, id)
    await fsp.writeFile(localPath, name)
    return { id, localPath }
  }))
  await writeJSONAtomically(path.join(root, 'manifest.json'), { draftId, files })

  await Promise.all([
    removeAPIBridgeMaterial({ root, draftId, id: files[0].id }),
    removeAPIBridgeMaterial({ root, draftId, id: files[1].id }),
  ])
  const saved = await readAPIBridgeMaterialManifest(root, draftId)
  assert.deepEqual(saved.files.map((file) => file.id), [files[2].id])
}))

test('returns the current manifest for an already removed id', async () => withTempDir(async (root) => {
  const draftId = 'apid_87654321'
  await writeJSONAtomically(path.join(root, 'manifest.json'), { draftId, files: [] })
  const result = await removeAPIBridgeMaterial({ root, draftId, id: 'missing.json' })
  assert.equal(result.removed, false)
  assert.deepEqual(result.files, [])
}))

test('never cleans a path outside the material root', async () => withTempDir(async (root) => {
  const outside = path.join(path.dirname(root), 'outside-api-material.txt')
  await fsp.writeFile(outside, 'keep')
  try {
    assert.equal(storedMaterialPath(root, outside), '')
    const draftId = 'apid_pathsafe'
    await writeJSONAtomically(path.join(root, 'manifest.json'), { draftId, files: [{ id: 'outside', localPath: outside }] })
    const result = await removeAPIBridgeMaterial({ root, draftId, id: 'outside' })
    assert.equal(result.removed, true)
    assert.equal(fs.existsSync(outside), true)
  } finally {
    await fsp.rm(outside, { force: true })
  }
}))

test('does not overwrite a malformed manifest during removal', async () => withTempDir(async (root) => {
  const manifestPath = path.join(root, 'manifest.json')
  await fsp.writeFile(manifestPath, '{not-json')
  await assert.rejects(removeAPIBridgeMaterial({ root, draftId: 'apid_invalid0', id: 'anything' }), /manifest is invalid/)
  assert.equal(await fsp.readFile(manifestPath, 'utf8'), '{not-json')
}))
