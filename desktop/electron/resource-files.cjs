const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const MAX_RESOURCE_FILE_BYTES = 1024 ** 3

async function inspectResourceFiles(filePaths, options = {}) {
  const maxBytes = Number(options.maxBytes || MAX_RESOURCE_FILE_BYTES)
  const unique = [...new Set((Array.isArray(filePaths) ? filePaths : []).map((value) => path.resolve(String(value || ''))).filter(Boolean))]
  if (!unique.length) throw new Error('Choose at least one resource file.')
  if (unique.length > 1000) throw new Error('A Resource sheet supports at most 1000 files.')
  const files = []
  for (let index = 0; index < unique.length; index += 1) {
    const localPath = unique[index]
    const stat = await fsp.lstat(localPath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${path.basename(localPath) || localPath} must be a regular file. Compress folders before upload.`)
    if (stat.size > maxBytes) throw new Error(`${path.basename(localPath)} exceeds the 1 GiB per-file limit.`)
    await fsp.access(localPath, fs.constants.R_OK)
    const sha256 = await fileSHA256(localPath)
    const current = await fsp.stat(localPath)
    if (current.size !== stat.size || current.mtimeMs !== stat.mtimeMs) throw new Error(`${path.basename(localPath)} changed while it was being inspected.`)
    files.push({
      token: crypto.randomUUID(),
      localPath,
      name: path.basename(localPath),
      sizeBytes: stat.size,
      sha256,
      mtimeMs: stat.mtimeMs,
    })
    options.onProgress?.({ phase: 'hashing', completedFiles: index + 1, totalFiles: unique.length, percent: Math.round((index + 1) / unique.length * 100) })
  }
  return files
}

async function validateResourceFile(record) {
  if (!record?.localPath || !record?.sha256) throw new Error('The selected resource file is unavailable. Choose it again.')
  const stat = await fsp.stat(record.localPath)
  if (!stat.isFile() || stat.size !== record.sizeBytes || stat.mtimeMs !== record.mtimeMs) throw new Error(`${record.name} changed after selection. Choose it again.`)
  return stat
}

async function fileSHA256(filePath) {
  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

module.exports = { MAX_RESOURCE_FILE_BYTES, fileSHA256, inspectResourceFiles, validateResourceFile }
