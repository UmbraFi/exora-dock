const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { inspectResourceFiles, validateResourceFile } = require('./resource-files.cjs')

async function withTempDir(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'exora-resource-files-test-'))
  try { return await run(root) } finally { await fsp.rm(root, { recursive: true, force: true }) }
}

test('keeps selected files as separate independently hashed resource items', async () => withTempDir(async (root) => {
  const first = path.join(root, 'alpha.txt')
  const nested = path.join(root, 'nested')
  const second = path.join(nested, 'beta.bin')
  await fsp.mkdir(nested)
  await fsp.writeFile(first, 'alpha')
  await fsp.writeFile(second, Buffer.from([0, 1, 2]))
  const files = await inspectResourceFiles([first, second])
  assert.equal(files.length, 2)
  assert.deepEqual(files.map((file) => file.name), ['alpha.txt', 'beta.bin'])
  assert.ok(files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)))
  assert.notEqual(files[0].token, files[1].token)
}))

test('accepts arbitrary regular file formats and zero-byte files', async () => withTempDir(async (root) => {
  const source = path.join(root, 'model.custom-format')
  await fsp.writeFile(source, '')
  const [record] = await inspectResourceFiles([source])
  assert.equal(record.sizeBytes, 0)
  await validateResourceFile(record)
}))

test('rejects folders and files over the configured per-file limit', async () => withTempDir(async (root) => {
  await assert.rejects(inspectResourceFiles([root]), /regular file/)
  const source = path.join(root, 'large.bin')
  await fsp.writeFile(source, '12345')
  await assert.rejects(inspectResourceFiles([source], { maxBytes: 4 }), /1 GiB per-file limit/)
}))

test('detects a file changed after selection', async () => withTempDir(async (root) => {
  const source = path.join(root, 'mutable.txt')
  await fsp.writeFile(source, 'before')
  const [record] = await inspectResourceFiles([source])
  await fsp.writeFile(source, 'after-change')
  await assert.rejects(validateResourceFile(record), /changed after selection/)
}))
