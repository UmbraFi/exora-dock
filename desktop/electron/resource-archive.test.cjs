const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const unzipper = require('unzipper')

const {
  ResourceArchiveTooLargeError,
  cleanupResourceArchive,
  cleanupStaleResourceArchives,
  createResourceArchive,
  inspectSourceFiles,
  validateResourceArchiveForUpload,
} = require('./resource-archive.cjs')

async function withTempDir(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'exora-resource-archive-test-'))
  try {
    return await run(root)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
}

test('packages one or many files into one flat ZIP with matching contents', async () => withTempDir(async (root) => {
  const first = path.join(root, 'alpha.txt')
  const secondDir = path.join(root, 'nested')
  const second = path.join(secondDir, 'beta.json')
  await fsp.mkdir(secondDir)
  await fsp.writeFile(first, 'alpha contents')
  await fsp.writeFile(second, '{"beta":true}')

  const result = await createResourceArchive({ filePaths: [first, second], tempRoot: path.join(root, 'packages'), now: new Date('2026-07-13T12:34:56Z') })
  assert.equal(result.format, 'zip')
  assert.equal(result.sourceCount, 2)
  assert.match(result.archiveName, /^resource-bundle-20260713-123456Z-[a-f0-9]{6}\.zip$/)
  const zip = await unzipper.Open.file(result.archivePath)
  assert.deepEqual(zip.files.map((file) => file.path).sort(), ['alpha.txt', 'beta.json'])
  assert.equal((await zip.files.find((file) => file.path === 'alpha.txt').buffer()).toString(), 'alpha contents')
  assert.equal((await zip.files.find((file) => file.path === 'beta.json').buffer()).toString(), '{"beta":true}')
  await cleanupResourceArchive(result)
  assert.equal(fs.existsSync(result.tempDir), false)
}))

test('accepts an archive at the configured byte limit', async () => withTempDir(async (root) => {
  const source = path.join(root, 'small.txt')
  await fsp.writeFile(source, 'small')
  const baseline = await createResourceArchive({ filePaths: [source], tempRoot: path.join(root, 'baseline') })
  const exact = await createResourceArchive({ filePaths: [source], tempRoot: path.join(root, 'exact'), maxBytes: baseline.sizeBytes })
  assert.equal(exact.sizeBytes, baseline.sizeBytes)
}))

test('aborts and removes a partial archive when compressed output exceeds the limit', async () => withTempDir(async (root) => {
  const source = path.join(root, 'random.bin')
  await fsp.writeFile(source, Buffer.from(Array.from({ length: 8192 }, (_, index) => index % 251)))
  const packages = path.join(root, 'packages')
  await assert.rejects(
    createResourceArchive({ filePaths: [source], tempRoot: packages, maxBytes: 32 }),
    (error) => error instanceof ResourceArchiveTooLargeError && error.code === 'RESOURCE_ARCHIVE_TOO_LARGE',
  )
  const entries = await fsp.readdir(packages)
  assert.deepEqual(entries, [])
}))

test('rejects directories and case-insensitive duplicate basenames', async () => withTempDir(async (root) => {
  const firstDir = path.join(root, 'one')
  const secondDir = path.join(root, 'two')
  await fsp.mkdir(firstDir)
  await fsp.mkdir(secondDir)
  const first = path.join(firstDir, 'Data.csv')
  const second = path.join(secondDir, 'data.CSV')
  await fsp.writeFile(first, 'one')
  await fsp.writeFile(second, 'two')
  await assert.rejects(inspectSourceFiles([root]), /not a regular file/)
  await assert.rejects(inspectSourceFiles([first, second]), /Two selected files are named/)
}))

test('removes only stale resource package directories', async () => withTempDir(async (root) => {
  const stale = path.join(root, 'resource-package-stale')
  const fresh = path.join(root, 'resource-package-fresh')
  const unrelated = path.join(root, 'other-stale')
  await Promise.all([fsp.mkdir(stale), fsp.mkdir(fresh), fsp.mkdir(unrelated)])
  const old = new Date('2026-07-10T00:00:00Z')
  await Promise.all([fsp.utimes(stale, old, old), fsp.utimes(unrelated, old, old)])
  const removed = await cleanupStaleResourceArchives(root, { nowMs: new Date('2026-07-13T00:00:00Z').getTime(), maxAgeMs: 24 * 60 * 60 * 1000 })
  assert.equal(removed, 1)
  assert.equal(fs.existsSync(stale), false)
  assert.equal(fs.existsSync(fresh), true)
  assert.equal(fs.existsSync(unrelated), true)
}))

test('upload validation accepts only an unchanged Dock-generated ZIP within the limit', () => {
  const valid = { kind: 'generated_zip', format: 'zip', archiveName: 'resource-bundle.zip', archivePath: 'C:\\temp\\resource-bundle.zip', sizeBytes: 100 }
  assert.equal(validateResourceArchiveForUpload(valid, 100, 100), valid)
  assert.throws(() => validateResourceArchiveForUpload({ ...valid, kind: 'selected_file' }, 100, 100), /Only ZIP archives generated/)
  assert.throws(() => validateResourceArchiveForUpload({ ...valid, archiveName: 'resource-bundle.tar' }, 100, 100), /Only ZIP archives generated/)
  assert.throws(() => validateResourceArchiveForUpload(valid, 99, 100), /changed after packaging/)
  assert.throws(() => validateResourceArchiveForUpload({ ...valid, sizeBytes: 101 }, 101, 100), ResourceArchiveTooLargeError)
})
