const fs = require('node:fs/promises')
const { SETTINGS_VERSION, pickAppSettingsV3 } = require('./app-settings.cjs')

const LEGACY_FRONTEND_CLEANUP_MARKER = 'legacyFrontendCleanupV2'

const RETIRED_SETTINGS_KEYS = Object.freeze([
  'permissionMode',
  'buyerAgentSettings',
  'activeSettingsView',
  'marketOrderSide',
  'transactionDetailWidth',
  'projectFolderCollapsed',
  'expandedProjectFolderPaths',
  'seenProjectFolderPaths',
  'workTaskState',
])

const RETIRED_DESKTOP_STATE_KEYS = Object.freeze([
  'projectFolderPath',
  'projectFolders',
  'activeProjectFolderPath',
  'workMcpUids',
  'workMcpLeases',
  'accountKey',
])

async function cleanupLegacyFrontendData(options = {}) {
  const paths = options.paths || {}
  const readJson = options.readJson
  const writeJson = options.writeJson
  const remove = options.remove || ((target, settings) => fs.rm(target, settings))
  const now = options.now || (() => new Date())
  if (typeof readJson !== 'function' || typeof writeJson !== 'function') {
    throw new Error('Legacy frontend cleanup requires JSON read/write helpers.')
  }

  const desktopState = objectOr(await readJson(paths.desktopStatePath, {}))
  if (desktopState.migrations?.[LEGACY_FRONTEND_CLEANUP_MARKER]) {
    return { migrated: false, alreadyComplete: true }
  }

  for (const target of [
    paths.legacyConversationsRoot,
    paths.legacyTransactionsRoot,
    paths.localAgentBindingPath,
    paths.localAgentScanPath,
  ].filter(Boolean)) {
    await remove(target, { recursive: true, force: true })
  }

  const settingsDocument = objectOr(await readJson(paths.appSettingsPath, {}))
  const storedSettings = objectOr(settingsDocument.settings || settingsDocument)
  const nextSettings = pickAppSettingsV3(omitKeys(storedSettings, RETIRED_SETTINGS_KEYS))
  await writeJson(paths.appSettingsPath, {
    version: SETTINGS_VERSION,
    savedAt: now().toISOString(),
    settings: nextSettings,
  })

  const nextDesktopState = omitKeys(desktopState, RETIRED_DESKTOP_STATE_KEYS)
  nextDesktopState.migrations = {
    ...objectOr(nextDesktopState.migrations),
    [LEGACY_FRONTEND_CLEANUP_MARKER]: now().toISOString(),
  }
  await writeJson(paths.desktopStatePath, nextDesktopState)
  return { migrated: true, alreadyComplete: false }
}

function omitKeys(value, keys) {
  const next = { ...objectOr(value) }
  for (const key of keys) delete next[key]
  return next
}

function objectOr(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
}

module.exports = {
  LEGACY_FRONTEND_CLEANUP_MARKER,
  RETIRED_DESKTOP_STATE_KEYS,
  RETIRED_SETTINGS_KEYS,
  cleanupLegacyFrontendData,
}
