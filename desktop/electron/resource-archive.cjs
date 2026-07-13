const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { Transform } = require('node:stream')
const archiver = require('archiver')

const MAX_RESOURCE_ARCHIVE_BYTES = 1024 ** 3
const RESOURCE_ARCHIVE_PREFIX = 'resource-package-'
const STALE_RESOURCE_ARCHIVE_AGE_MS = 24 * 60 * 60 * 1000

class ResourceArchiveTooLargeError extends Error {
  constructor(maxBytes = MAX_RESOURCE_ARCHIVE_BYTES) {
    super(`Compressed ZIP exceeds the ${formatGiB(maxBytes)} limit.`)
    this.name = 'ResourceArchiveTooLargeError'
    this.code = 'RESOURCE_ARCHIVE_TOO_LARGE'
    this.maxBytes = maxBytes
  }
}

async function createResourceArchive(options = {}) {
  const filePaths = Array.isArray(options.filePaths) ? options.filePaths : []
  if (!filePaths.length) throw new Error('Choose at least one file.')

  const tempRootValue = String(options.tempRoot || '').trim()
  if (!tempRootValue) throw new Error('A resource archive temporary directory is required.')
  const tempRoot = path.resolve(tempRootValue)
  const maxBytes = positiveInteger(options.maxBytes, MAX_RESOURCE_ARCHIVE_BYTES)
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => undefined
  const sources = await inspectSourceFiles(filePaths)
  const sourceBytes = sources.reduce((sum, source) => sum + source.sizeBytes, 0)
  const tempDir = await fsp.mkdtemp(path.join(await ensureTempRoot(tempRoot), RESOURCE_ARCHIVE_PREFIX))
  const archiveName = resourceArchiveName(options.now instanceof Date ? options.now : new Date())
  const archivePath = path.join(tempDir, archiveName)

  try {
    const sizeBytes = await writeZipArchive({ archivePath, maxBytes, onProgress, sourceBytes, sources })
    return {
      archivePath,
      archiveName,
      format: 'zip',
      sizeBytes,
      sourceBytes,
      sourceCount: sources.length,
      sources: sources.map(({ name, sizeBytes }) => ({ name, sizeBytes })),
      tempDir,
    }
  } catch (error) {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function inspectSourceFiles(filePaths) {
  const sources = []
  const names = new Set()
  for (const selectedPath of filePaths) {
    const filePath = path.resolve(String(selectedPath || ''))
    const stat = await fsp.lstat(filePath)
    if (!stat.isFile()) throw new Error(`${path.basename(filePath) || filePath} is not a regular file.`)
    await fsp.access(filePath, fs.constants.R_OK)
    const name = path.basename(filePath)
    const normalizedName = name.normalize('NFC').toLocaleLowerCase('en-US')
    if (names.has(normalizedName)) throw new Error(`Two selected files are named ${name}. Rename one of them before creating the ZIP.`)
    names.add(normalizedName)
    sources.push({ filePath, name, sizeBytes: stat.size })
  }
  return sources
}

async function writeZipArchive({ archivePath, maxBytes, onProgress, sourceBytes, sources }) {
  const output = fs.createWriteStream(archivePath, { flags: 'wx' })
  const archive = archiver('zip', { zlib: { level: 6 } })
  let outputBytes = 0
  let settled = false
  let lastProgressAt = 0
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      outputBytes += chunk.length
      if (outputBytes > maxBytes) {
        callback(new ResourceArchiveTooLargeError(maxBytes))
        return
      }
      callback(null, chunk)
    },
  })

  const completed = new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return
      settled = true
      archive.abort()
      limiter.destroy()
      output.destroy()
      reject(error)
    }
    archive.on('error', fail)
    archive.on('warning', fail)
    limiter.on('error', fail)
    output.on('error', fail)
    output.on('close', () => {
      if (settled) return
      settled = true
      resolve(outputBytes)
    })
    archive.on('progress', (progress) => {
      const now = Date.now()
      if (now - lastProgressAt < 100 && progress.entries.processed < sources.length) return
      lastProgressAt = now
      const inputBytes = Math.min(sourceBytes, Number(progress.fs?.processedBytes || 0))
      onProgress({
        phase: 'packaging',
        completedFiles: Number(progress.entries.processed || 0),
        totalFiles: sources.length,
        inputBytes,
        sourceBytes,
        outputBytes,
        percent: sourceBytes > 0 ? Math.min(99, Math.round(inputBytes / sourceBytes * 100)) : 99,
      })
    })
  })

  archive.pipe(limiter).pipe(output)
  for (const source of sources) archive.file(source.filePath, { name: source.name })
  onProgress({ phase: 'packaging', completedFiles: 0, totalFiles: sources.length, inputBytes: 0, sourceBytes, outputBytes: 0, percent: 0 })
  archive.finalize().catch((error) => archive.emit('error', error))
  const sizeBytes = await completed
  onProgress({ phase: 'complete', completedFiles: sources.length, totalFiles: sources.length, inputBytes: sourceBytes, sourceBytes, outputBytes: sizeBytes, percent: 100 })
  return sizeBytes
}

async function cleanupResourceArchive(record) {
  const tempDir = typeof record === 'string' ? record : record?.tempDir
  if (!tempDir) return
  await fsp.rm(tempDir, { recursive: true, force: true })
}

function cleanupResourceArchiveSync(record) {
  const tempDir = typeof record === 'string' ? record : record?.tempDir
  if (!tempDir) return
  fs.rmSync(tempDir, { recursive: true, force: true })
}

async function cleanupStaleResourceArchives(tempRoot, options = {}) {
  const root = path.resolve(String(tempRoot || ''))
  const maxAgeMs = positiveInteger(options.maxAgeMs, STALE_RESOURCE_ARCHIVE_AGE_MS)
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  let entries
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
  let removed = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(RESOURCE_ARCHIVE_PREFIX)) continue
    const target = path.join(root, entry.name)
    const stat = await fsp.stat(target).catch(() => undefined)
    if (!stat || nowMs - stat.mtimeMs < maxAgeMs) continue
    await fsp.rm(target, { recursive: true, force: true })
    removed += 1
  }
  return removed
}

function validateResourceArchiveForUpload(record, actualSizeBytes, maxBytes = MAX_RESOURCE_ARCHIVE_BYTES) {
  if (!record || record.kind !== 'generated_zip') throw new Error('Only ZIP archives generated by Exora Dock can be uploaded.')
  if (record.format !== 'zip' || path.extname(String(record.archiveName || '')).toLowerCase() !== '.zip' || path.extname(String(record.archivePath || '')).toLowerCase() !== '.zip') {
    throw new Error('Only ZIP archives generated by Exora Dock can be uploaded.')
  }
  const sizeBytes = Number(actualSizeBytes)
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes !== Number(record.sizeBytes)) throw new Error('The generated ZIP changed after packaging. Choose the source files again.')
  if (sizeBytes > maxBytes) throw new ResourceArchiveTooLargeError(maxBytes)
  return record
}

async function ensureTempRoot(tempRoot) {
  await fsp.mkdir(tempRoot, { recursive: true })
  return tempRoot.endsWith(path.sep) ? tempRoot : `${tempRoot}${path.sep}`
}

function resourceArchiveName(now) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-')
  const suffix = crypto.randomBytes(3).toString('hex')
  return `resource-bundle-${stamp}-${suffix}.zip`
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

function formatGiB(bytes) {
  return `${bytes / 1024 ** 3} GiB`
}

module.exports = {
  MAX_RESOURCE_ARCHIVE_BYTES,
  RESOURCE_ARCHIVE_PREFIX,
  ResourceArchiveTooLargeError,
  cleanupResourceArchive,
  cleanupResourceArchiveSync,
  cleanupStaleResourceArchives,
  createResourceArchive,
  inspectSourceFiles,
  resourceArchiveName,
  validateResourceArchiveForUpload,
}
