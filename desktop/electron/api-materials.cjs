const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')

const materialMutationQueues = new Map()

function operationWithTimeout(label, operation, timeoutMs) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} did not respond within ${Math.max(1, Math.round(timeoutMs / 1000))} seconds`)
      error.code = 'API_MATERIAL_OPERATION_TIMEOUT'
      reject(error)
    }, timeoutMs)
    timer.unref?.()
  })
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timer))
}

function withAPIBridgeMaterialMutation(root, operation) {
  const key = path.resolve(root)
  const previous = materialMutationQueues.get(key) || Promise.resolve()
  const run = previous.catch(() => undefined).then(operation)
  let tracked
  tracked = run.finally(() => {
    if (materialMutationQueues.get(key) === tracked) materialMutationQueues.delete(key)
  })
  materialMutationQueues.set(key, tracked)
  return tracked
}

async function readAPIBridgeMaterialManifest(root, draftId) {
  const manifestPath = path.join(root, 'manifest.json')
  let document
  try {
    document = await fsp.readFile(manifestPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { draftId, files: [] }
    throw error
  }
  let manifest
  try {
    manifest = JSON.parse(document)
  } catch {
    throw new Error('The API material manifest is invalid and was not changed.')
  }
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.files)) {
    throw new Error('The API material manifest has an invalid shape and was not changed.')
  }
  return { ...manifest, draftId: String(manifest.draftId || draftId), files: manifest.files }
}

async function writeJSONAtomically(filePath, value) {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  await fsp.mkdir(directory, { recursive: true })
  try {
    await fsp.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8')
    await fsp.rename(temporaryPath, filePath)
  } finally {
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function storedMaterialPath(root, localPath) {
  if (!localPath) return ''
  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(String(localPath))
  return path.dirname(resolvedPath) === resolvedRoot ? resolvedPath : ''
}

async function removeAPIBridgeMaterial({ root, draftId, id, manifestTimeoutMs = 3000, cleanupWaitMs = 250 }) {
  const materialId = String(id || '').trim()
  if (!materialId) throw new Error('API material id is required')
  return withAPIBridgeMaterialMutation(root, async () => {
    const manifest = await operationWithTimeout(
      'Reading the API material manifest',
      readAPIBridgeMaterialManifest(root, draftId),
      manifestTimeoutMs,
    )
    const target = manifest.files.find((file) => file && String(file.id || '') === materialId)
    if (!target) return { ...manifest, removed: false, cleanupPending: false }

    const next = {
      ...manifest,
      files: manifest.files.filter((file) => String(file?.id || '') !== materialId),
      updatedAt: new Date().toISOString(),
    }
    await operationWithTimeout(
      'Saving the API material manifest',
      writeJSONAtomically(path.join(root, 'manifest.json'), next),
      manifestTimeoutMs,
    )

    const targetPath = storedMaterialPath(root, target.localPath)
    if (!targetPath) return { ...next, removed: true, cleanupPending: false }
    const cleanup = fsp.rm(targetPath, { force: true })
    try {
      await operationWithTimeout('Cleaning up the removed API material', cleanup, cleanupWaitMs)
      return { ...next, removed: true, cleanupPending: false }
    } catch {
      cleanup.catch(() => undefined)
      return { ...next, removed: true, cleanupPending: true }
    }
  })
}

module.exports = {
  operationWithTimeout,
  readAPIBridgeMaterialManifest,
  removeAPIBridgeMaterial,
  storedMaterialPath,
  withAPIBridgeMaterialMutation,
  writeJSONAtomically,
}
