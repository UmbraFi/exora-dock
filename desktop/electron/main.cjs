const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, Tray } = require('electron')
const { spawn, execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')
const { registerIpcHandlers } = require('./ipc.cjs')
const {
  createAppURLPolicy,
  installNavigationGuards,
  isTrustedIpcSender,
} = require('./security.cjs')
const { createWorkspaceSnapshot } = require('./workspace.cjs')
const {
  cachedLocalAgentForBinding,
  createLocalAgentScanSnapshot,
  localAgentDriver,
  restoreLocalAgentScanSnapshot,
  scanLocalAgents,
  scanLocalAgentsGlobal,
  verifyLocalAgentInstallation,
} = require('./local-agents.cjs')

const APP_ID = 'io.exora.dock'
const BASE_URL = 'http://127.0.0.1:8080'
const DAEMON_NAME = 'exora-dockd'
const DAEMON_LOG_NAME = 'daemon.log'
const DEFAULT_PROJECT_NAME = 'AgenStaff'
const DESKTOP_STATE_NAME = 'desktop-state.json'
const PERSISTENCE_DIR_NAME = 'exora-data'
const WORK_MCP_LEASE_LIMIT = 100
const v3SelectedFiles = new Map()
const DEV_URL = process.env.EXORA_DOCK_DESKTOP_DEV_URL || 'http://127.0.0.1:1420'
const WINDOW_ICON = process.platform === 'win32'
  ? path.join(__dirname, 'assets', 'icon.ico')
  : path.join(__dirname, 'assets', 'icon.png')
const APP_URL_POLICY = createAppURLPolicy({
  isPackaged: app.isPackaged,
  devUrl: DEV_URL,
  distDir: path.join(__dirname, '..', 'dist'),
})
const STARTUP_LANGUAGE = readStartupLanguageSync()
const MASKED_API_KEY_VALUE = '************'
const ELECTRON_CLIENT_KIND = 'electron'
const ELECTRON_REMOTE_CAPABILITIES = ['remote.console', 'approvals.queue', 'mcp.stdio', 'electron.shell']

app.commandLine.appendSwitch('lang', chromiumLocaleForLanguage(STARTUP_LANGUAGE))

let mainWindow
let tray
let appIsQuitting = false
let localAgentScanInFlight
let localAgentGlobalScanController
let localAgentGlobalScanPromise
let localAgentGlobalScanPaused = false
let localAgentScanPauseRequested = false
const localAgentGlobalScanPauseWaiters = []
const localAgentSessionStreams = new Map()
const localAgentSessionEventBacklogs = new Map()

if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}
const workspaceSnapshotService = createWorkspaceSnapshot({
  dockPaths,
  ensureLocalLayout,
  projectFoldersStatus,
  activeWorkMCPLeases,
  healthOk,
  localOwnerToken,
  httpJson,
  addConnectionProjectFolders,
  addActivityProjectFolders,
  errorMessage,
})

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID)
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    center: true,
    show: false,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    backgroundColor: '#f5f7f5',
    icon: WINDOW_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [
        `--exora-language=${STARTUP_LANGUAGE}`,
        `--exora-chromium-locale=${chromiumLocaleForLanguage(STARTUP_LANGUAGE)}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  })

  installNavigationGuards(mainWindow, { policy: APP_URL_POLICY, shell })
  mainWindow.on('close', (event) => {
    if (appIsQuitting) return
    event.preventDefault()
    mainWindow.hide()
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL(DEV_URL)
  }
}

app.whenReady().then(async () => {
  registerIpc()
  await initializeLocalProjectFolder().catch((error) => {
    console.error('Failed to initialize the default project folder:', error)
  })
  createWindow()
  createTray()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Exora continues supervising local Agent sessions from the tray.
})

app.on('before-quit', () => {
  appIsQuitting = true
  for (const controller of localAgentSessionStreams.values()) controller.abort()
  localAgentSessionStreams.clear()
})

function createTray() {
  if (tray) return
  tray = new Tray(WINDOW_ICON)
  tray.setToolTip('Exora Dock')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Exora Dock', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { appIsQuitting = true; app.quit() } },
  ]))
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus() })
}

function registerIpc() {
  registerIpcHandlers(ipcMain, createIpcHandlerGroups(), {
    validateSender: (event) => isTrustedIpcSender(event, APP_URL_POLICY),
  })
}

function createIpcHandlerGroups() {
  return {
    window: {
      window_minimize,
      window_toggle_maximize,
      window_close,
    },
    dockRuntime: {
      app_status,
      start_dock,
      stop_dock,
      restart_dock,
      daemon_status,
      start_daemon,
      stop_daemon,
      open_console,
      open_health,
      open_manifest,
      open_logs,
      copy_mcp_command,
      copy_agent_prompt,
      copy_opencode_config,
      copy_rest_base_url,
    },
    localWork: {
      workspace_snapshot,
      buyer_flow_action,
      create_work_mcp_uid,
      release_work_mcp_lease,
      stop_work_run,
      project_folder_status,
      choose_project_folder,
      open_project_folder,
      rename_project_folder,
      archive_project_chats,
      remove_project_folder,
    },
    localAgents: {
      local_agent_snapshot,
      local_agent_scan,
      local_agent_binding,
      bind_local_agent,
      unbind_local_agent,
      local_agent_session_start,
      local_agent_session_get,
      local_agent_session_send,
      local_agent_session_interrupt,
      local_agent_session_stop,
      local_agent_session_resume,
      local_agent_session_subscribe,
      local_agent_session_unsubscribe,
    },
    persistence: {
      desktop_persistence_load,
      save_app_settings,
      locale_status,
      set_locale,
      save_chat_thread,
      archive_chat_threads,
      save_transactions,
    },
    pwaLink: {
      pwa_link_start,
      pwa_link_status,
    },
    v3Market: {
      catalog_products,
      catalog_product,
      provider_vm_probe,
      provider_vm_domains,
      provider_vm_import,
      provider_vm_validate,
      provider_product_create,
      provider_asset_choose_files,
      provider_asset_create,
      provider_asset_upload,
      provider_asset_cancel,
      provider_openapi_choose,
      provider_openapi_import,
      provider_listings,
      provider_listing_save,
      provider_listing_action,
    },
    llmAndSeller: {
      seller_settings,
      save_seller_settings,
      llm_profiles,
      save_llm_profile,
      delete_llm_profile,
      apply_llm_profile,
      test_llm_connection,
      list_llm_models,
    },
    agentCardsAndMarket: {
      agent_cards_mine,
      agent_card_diagnostics,
      agent_card_draft,
      save_agent_card,
      publish_agent_card,
      seller_market_status,
      market_rail_cards,
      agent_card_search,
      agent_search_sellers,
    },
    ownerLedger: {
      cloud_transactions,
      list_approvals,
      decide_approval,
      list_order_plans,
      list_tasks,
      get_task,
      list_payments,
      get_payment,
      select_order_plan,
      cancel_order_plan,
      payment_pin_status,
      set_payment_pin,
    },
    walletAndSecurity: {
      wallet_status,
      wallet_create,
      wallet_unlock,
      wallet_restore,
      wallet_withdraw,
      security_status,
    },
  }
}

async function window_minimize() {
  mainWindow?.minimize()
}

async function window_toggle_maximize() {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
}

async function window_close() {
  mainWindow?.hide()
}

async function app_status() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await writeDiscoveryManifest(paths)
  const helperAvailable = fs.existsSync(paths.helperPath)
  const status = {
    docker: 'native',
    container: 'unknown',
    daemon: 'offline',
    image: helperAvailable ? 'available' : 'missing',
    containerName: DAEMON_NAME,
    imageTag: paths.helperPath,
    baseUrl: BASE_URL,
    dataDir: paths.dataDir,
    configPath: paths.configPath,
    discoveryPath: paths.discoveryPath,
    mcpCommand: mcpCommandString(paths.helperPath, paths.configPath),
    agentPrompt: agentPrompt(),
    opencodeConfig: opencodeConfigString(paths.helperPath, paths.configPath),
    message: '',
  }

  if (!helperAvailable) {
    status.container = 'missing'
    status.message = `Bundled Exora Dock daemon was not found: ${paths.helperPath}`
    return status
  }

  const trackedRunning = await trackedDaemonRunning(paths)
  if (await healthOk()) {
    status.container = trackedRunning ? 'running' : 'external'
    status.daemon = 'healthy'
  } else if (trackedRunning) {
    status.container = 'running'
    status.daemon = 'starting'
  } else {
    status.container = 'stopped'
    status.daemon = 'offline'
  }
  status.message = statusMessage(status)
  return status
}

async function start_dock() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await writeDiscoveryManifest(paths)
  if (!fs.existsSync(paths.helperPath)) {
    throw new Error(`Bundled Exora Dock daemon was not found: ${paths.helperPath}`)
  }
  if (!(await healthOk()) && !(await trackedDaemonRunning(paths))) {
    await startNativeDaemon(paths)
  }
  for (let i = 0; i < 24; i += 1) {
    if (await healthOk()) break
    await sleep(500)
  }
  return app_status()
}

async function stop_dock() {
  const paths = await dockPaths()
  await stopTrackedDaemon(paths)
  return app_status()
}

async function restart_dock() {
  const paths = await dockPaths()
  await stopTrackedDaemon(paths)
  return start_dock()
}

async function open_health() {
  await shell.openExternal(`${BASE_URL}/health`)
}

async function open_manifest() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await writeDiscoveryManifest(paths)
  await openPath(paths.discoveryPath)
}

async function open_logs() {
  const paths = await dockPaths()
  await fsp.mkdir(paths.logsDir, { recursive: true })
  await openPath(paths.logsDir)
}

async function copy_mcp_command() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await writeDiscoveryManifest(paths)
  return mcpCommandString(paths.helperPath, paths.configPath)
}

async function copy_agent_prompt() {
  return agentPrompt()
}

async function copy_opencode_config() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await writeDiscoveryManifest(paths)
  return opencodeConfigString(paths.helperPath, paths.configPath)
}

async function copy_rest_base_url() {
  return BASE_URL
}

async function pwa_link_start(payload) {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const cfg = await cloudLinkConfig(paths, payload?.input ?? {})
  const commandKey = createCommandKeyPair()
  await savePendingCommandKey(cfg.tokenPath, commandKey)
  const result = await cloudPostJSON(`${cfg.cloudUrl}/v1/device-links`, {
    dockId: cfg.dockId,
    clientKind: ELECTRON_CLIENT_KIND,
    displayName: 'Exora Dock',
    mode: cfg.mode,
    publicBaseUrl: BASE_URL,
    version: '0.1.0',
    capabilities: ELECTRON_REMOTE_CAPABILITIES,
    commandPublicKey: commandKey.publicKey,
  }, 10000)
  if (!result.ok) {
    throw new Error(`cloud device link returned ${result.status}: ${result.error}`)
  }
  return sanitizePwaLink({
    status: result.body.status || 'pending',
    ...result.body,
    clientKind: ELECTRON_CLIENT_KIND,
    cloudUrl: cfg.cloudUrl,
    dockId: result.body.dockId || cfg.dockId,
    tokenPath: cfg.tokenPath,
    qrPayload: pwaLinkQRPayload(result.body, cfg),
    message: 'Scan this QR from the Exora PWA Remote Console.',
  })
}

async function pwa_link_status(payload) {
  const input = payload?.input ?? payload ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const cfg = await cloudLinkConfig(paths, input)
  const deviceCode = String(input.deviceCode || '').trim()
  if (!deviceCode) throw new Error('device code missing')

  const result = await cloudPostJSON(`${cfg.cloudUrl}/v1/device-links/token`, { deviceCode }, 10000)
  const body = result.body
  if (result.status === 202) {
    return sanitizePwaLink({
      status: body.status || 'pending',
      deviceCode,
      userCode: input.userCode,
      verificationUrl: input.verificationUrl,
      expiresAt: body.expiresAt || input.expiresAt,
      clientKind: ELECTRON_CLIENT_KIND,
      cloudUrl: cfg.cloudUrl,
      dockId: body.dockId || input.dockId || cfg.dockId,
      tokenPath: cfg.tokenPath,
      message: 'Waiting for the PWA to confirm this code.',
    })
  }
  if (result.status === 410) {
    return sanitizePwaLink({
      status: 'expired',
      deviceCode,
      userCode: input.userCode,
      verificationUrl: input.verificationUrl,
      expiresAt: body.expiresAt || input.expiresAt,
      clientKind: ELECTRON_CLIENT_KIND,
      cloudUrl: cfg.cloudUrl,
      dockId: input.dockId || cfg.dockId,
      tokenPath: cfg.tokenPath,
      message: body.error || 'This PWA link QR has expired. Create a new QR.',
    })
  }
  if (!result.ok) {
    throw new Error(`cloud token exchange returned ${result.status}: ${result.error}`)
  }
  const cloudToken = String(body.cloudToken || '').trim()
  if (!cloudToken) throw new Error('cloud token missing from approved device link')

  const dockId = String(body.dockId || input.dockId || cfg.dockId).trim()
  const commandKey = await loadPendingCommandKey(cfg.tokenPath).catch(() => createCommandKeyPair())
  await saveCloudTokenFile(cfg.tokenPath, {
    dockId,
    cloudUrl: cfg.cloudUrl,
    cloudToken,
    clientKind: ELECTRON_CLIENT_KIND,
    commandPrivateKey: commandKey.privateKey,
    commandPublicKey: commandKey.publicKey,
    linkedAt: new Date().toISOString(),
  })
  await cloudPostJSON(`${cfg.cloudUrl}/v1/docks/${encodeURIComponent(dockId)}/heartbeat`, {
    dockId,
    clientKind: ELECTRON_CLIENT_KIND,
    displayName: 'Exora Dock',
    mode: cfg.mode,
    publicBaseUrl: BASE_URL,
    version: '0.1.0',
    capabilities: ELECTRON_REMOTE_CAPABILITIES,
    commandPublicKey: commandKey.publicKey,
  }, 10000, cloudToken)
  await deletePendingCommandKey(cfg.tokenPath)
  await ensureCloudLinkConfig(paths, cfg.cloudUrl, cfg.tokenPath, dockId)

  let restart = { daemonRestarted: false, message: 'PWA linked. Remote Console can now control this Dock.' }
  try {
    restart = await refreshDaemonForCloudLink(paths)
  } catch (error) {
    restart = {
      daemonRestarted: false,
      message: `PWA linked, but Dock restart failed: ${errorMessage(error)}`,
    }
  }

  return sanitizePwaLink({
    status: body.status || 'approved',
    linked: true,
    deviceCode,
    userCode: input.userCode,
    verificationUrl: input.verificationUrl,
    expiresAt: body.expiresAt || input.expiresAt,
    clientKind: ELECTRON_CLIENT_KIND,
    cloudUrl: cfg.cloudUrl,
    dockId,
    accountId: body.accountId,
    tokenPath: cfg.tokenPath,
    daemonRestarted: restart.daemonRestarted,
    message: restart.message,
  })
}

async function seller_settings() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return sellerSettingsFromConfig(paths)
}

async function llm_profiles() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await ensureLLMProfiles(paths)
  return llmProfileStatus(paths)
}

async function save_llm_profile(payload = {}) {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const input = objectOr(payload.input || payload)
  await ensureLLMProfiles(paths)
  const state = await readDesktopState(paths)
  const profiles = Array.isArray(state.llmProfiles) ? state.llmProfiles : []
  const now = new Date().toISOString()
  const id = String(input.id || '').trim() || `llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const existing = profiles.find((profile) => profile.id === id) || {}
  const requestedName = String(input.name || existing.name || '').trim() || defaultLLMProfileName(input)
  const name = uniqueLLMProfileName(requestedName, profiles, id)
  const profile = normalizeStoredLLMProfile({
    ...existing,
    ...input,
    id,
    name,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  })
  const apiKey = explicitApiKeyInput(input)
  if (input.clearApiKey) {
    delete profile.encryptedApiKey
    delete profile.keyStorage
  } else if (apiKey) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure API key storage is not available on this system.')
    }
    profile.encryptedApiKey = safeStorage.encryptString(apiKey).toString('base64')
    profile.keyStorage = 'safeStorage'
  } else {
    const cloneKeyFromId = String(input.cloneKeyFromId || '').trim()
    const source = cloneKeyFromId ? profiles.find((item) => item.id === cloneKeyFromId) : undefined
    if (source?.encryptedApiKey) {
      profile.encryptedApiKey = source.encryptedApiKey
      profile.keyStorage = source.keyStorage
    }
  }
  state.llmProfiles = [profile, ...profiles.filter((item) => item.id !== id)]
  state.activeLLMProfileId = state.activeLLMProfileId || id
  const hasBuyerRole = Object.prototype.hasOwnProperty.call(input, 'useForBuyer')
  const hasSellerRole = Object.prototype.hasOwnProperty.call(input, 'useForSeller')
  if (hasBuyerRole) {
    if (input.useForBuyer) state.buyerLLMProfileId = id
    else if (state.buyerLLMProfileId === id) state.buyerLLMProfileId = ''
  }
  if (hasSellerRole) {
    if (input.useForSeller) state.sellerLLMProfileId = id
    else if (state.sellerLLMProfileId === id) state.sellerLLMProfileId = ''
  }
  state.llmProfileRoleDefaultsInitialized = true
  await writeDesktopState(paths, state)
  return llmProfileStatus(paths)
}

async function delete_llm_profile(payload = {}) {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await ensureLLMProfiles(paths)
  const input = objectOr(payload.input || payload)
  const id = String(input.id || '').trim()
  const state = await readDesktopState(paths)
  const wasForBuyer = state.buyerLLMProfileId === id
  const wasForSeller = state.sellerLLMProfileId === id
  const profiles = (Array.isArray(state.llmProfiles) ? state.llmProfiles : []).filter((profile) => profile.id !== id)
  state.llmProfiles = profiles
  if (wasForBuyer) state.buyerLLMProfileId = ''
  if (wasForSeller) state.sellerLLMProfileId = ''
  if (state.activeLLMProfileId === id) state.activeLLMProfileId = profiles[0]?.id || ''
  state.llmProfileRoleDefaultsInitialized = true
  if (wasForBuyer || wasForSeller) {
    const raw = await readTextOr(paths.configPath, defaultLocalConfig(paths))
    const value = objectOr(YAML.parse(raw) || {})
    if (wasForBuyer) delete value.buyer_llm
    if (wasForSeller) delete value.seller_llm
    await fsp.writeFile(paths.configPath, ensureTrailingNewline(YAML.stringify(value)))
    await writeDiscoveryManifest(paths)
    if (await trackedDaemonRunning(paths)) {
      await stopTrackedDaemon(paths)
      await start_dock()
    }
  }
  await writeDesktopState(paths, state)
  await ensureLLMProfiles(paths)
  return llmProfileStatus(paths)
}

async function apply_llm_profile(payload = {}) {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await ensureLLMProfiles(paths)
  const input = objectOr(payload.input || payload)
  const id = String(input.id || '').trim()
  const state = await readDesktopState(paths)
  const profile = (Array.isArray(state.llmProfiles) ? state.llmProfiles : []).find((item) => item.id === id)
  if (!profile) throw new Error('API profile not found.')
  const apiKey = decryptLLMProfileKey(profile)
  const roles = llmProfileRolesFromInput(input)
  const previousRoles = {
    buyer: Boolean(input.wasForBuyer) || state.buyerLLMProfileId === profile.id,
    seller: Boolean(input.wasForSeller) || state.sellerLLMProfileId === profile.id,
  }
  const shouldTouchConfig = roles.buyer || roles.seller || previousRoles.buyer || previousRoles.seller
  if (shouldTouchConfig) {
    const raw = await readTextOr(paths.configPath, defaultLocalConfig(paths))
    const updated = updateRoleLLMSettingsYaml(raw, profile, apiKey, roles, previousRoles)
    await fsp.writeFile(paths.configPath, updated)
  }
  if (roles.buyer) state.buyerLLMProfileId = profile.id
  else if (previousRoles.buyer) state.buyerLLMProfileId = ''
  if (roles.seller) state.sellerLLMProfileId = profile.id
  else if (previousRoles.seller) state.sellerLLMProfileId = ''
  if (roles.buyer || roles.seller) state.activeLLMProfileId = profile.id
  state.llmProfileRoleDefaultsInitialized = true
  await writeDesktopState(paths, state)
  if (shouldTouchConfig) await writeDiscoveryManifest(paths)
  if (shouldTouchConfig && await trackedDaemonRunning(paths)) {
    await stopTrackedDaemon(paths)
    await start_dock()
  }
  return llmProfileStatus(paths)
}

async function local_agent_snapshot() {
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  return localAgentSnapshotResponse(paths)
}

async function local_agent_scan(_payload = {}, event) {
  if (localAgentScanInFlight) return localAgentScanInFlight
  localAgentScanPauseRequested = false
  const scanPromise = performLocalAgentScan(event?.sender)
  localAgentScanInFlight = scanPromise
  try {
    return await scanPromise
  } finally {
    if (localAgentScanInFlight === scanPromise) localAgentScanInFlight = undefined
  }
}

async function local_agent_scan_restart(_payload = {}, event) {
  localAgentScanPauseRequested = false
  localAgentGlobalScanPaused = false
  for (const resolve of localAgentGlobalScanPauseWaiters.splice(0)) resolve()
  localAgentGlobalScanController?.abort()
  if (localAgentGlobalScanPromise) await localAgentGlobalScanPromise.catch(() => undefined)
  if (localAgentScanInFlight) await localAgentScanInFlight.catch(() => undefined)
  localAgentGlobalScanController?.abort()
  if (localAgentGlobalScanPromise) await localAgentGlobalScanPromise.catch(() => undefined)
  return local_agent_scan({}, event)
}

function local_agent_scan_pause() {
  if (!localAgentGlobalScanController || localAgentGlobalScanController.signal.aborted) {
    if (localAgentScanInFlight) {
      localAgentScanPauseRequested = true
      return { paused: true, indexing: true }
    }
    return { paused: false, indexing: false }
  }
  localAgentScanPauseRequested = true
  localAgentGlobalScanPaused = true
  return { paused: true, indexing: true }
}

async function local_agent_scan_resume(_payload = {}, event) {
  if (localAgentGlobalScanController && !localAgentGlobalScanController.signal.aborted) {
    localAgentScanPauseRequested = false
    localAgentGlobalScanPaused = false
    const waiters = localAgentGlobalScanPauseWaiters.splice(0)
    for (const resolve of waiters) resolve()
    return { paused: false, indexing: true }
  }
  if (localAgentScanInFlight) {
    localAgentScanPauseRequested = false
    return { paused: false, indexing: true }
  }
  const result = await local_agent_scan({}, event)
  return { ...result, paused: false }
}

function waitWhileLocalAgentScanPaused(signal) {
  if (!localAgentGlobalScanPaused || signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => resolve()
    localAgentGlobalScanPauseWaiters.push(done)
    signal?.addEventListener('abort', done, { once: true })
  })
}

async function performLocalAgentScan(sender) {
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const emptySnapshot = createLocalAgentScanSnapshot({ agents: [], scannedAt: new Date().toISOString(), index: { backend: 'full-scan-fallback', journalCursors: {} } })
  await writeJsonAtomic(paths.localAgentScanPath, emptySnapshot)
  const result = await scanLocalAgents()
  const snapshot = createLocalAgentScanSnapshot({ ...result, index: { backend: 'full-scan-fallback', journalCursors: {} } })
  await writeJsonAtomic(paths.localAgentScanPath, snapshot)
  localAgentGlobalScanController?.abort()
  localAgentGlobalScanPaused = localAgentScanPauseRequested
  for (const resolve of localAgentGlobalScanPauseWaiters.splice(0)) resolve()
  const controller = new AbortController()
  localAgentGlobalScanController = controller
  const continuation = continueLocalAgentGlobalScan(paths, snapshot, sender, controller)
  localAgentGlobalScanPromise = continuation
  void continuation
  return { ...(await localAgentSnapshotResponse(paths, snapshot)), indexing: process.platform === 'win32', indexMode: process.platform === 'win32' ? 'background-full-scan' : 'quick-scan' }
}

async function continueLocalAgentGlobalScan(paths, quickSnapshot, sender, controller) {
  try {
    const global = await scanLocalAgentsGlobal({
      signal: controller.signal,
      waitWhilePaused: () => waitWhileLocalAgentScanPaused(controller.signal),
      onProgress: async (progress) => {
        if (controller.signal.aborted || localAgentGlobalScanController !== controller) return
        const checkpoint = await persistLocalAgentScanCheckpoint(paths, quickSnapshot, progress.agents || [])
        if (controller.signal.aborted || localAgentGlobalScanController !== controller) return
        sendLocalAgentScanEvent(sender, { type: 'scan_progress', found: checkpoint.agents.length, visitedDirectories: progress.visitedDirectories, volume: progress.volume, progress: progress.progress, snapshot: await localAgentSnapshotResponse(paths, checkpoint) })
      },
    })
    if (controller.signal.aborted) return
    const current = await readLocalAgentScanSnapshot(paths) || quickSnapshot
    const merged = new Map(current.agents.map((agent) => [agent.installationId, agent]))
    for (const agent of global.agents) {
      const previous = merged.get(agent.installationId)
      merged.set(agent.installationId, previous ? { ...agent, discoveredAt: previous.discoveredAt, ...(previous.verificationState === 'verified' && previous.fingerprint === agent.fingerprint ? {
        status: previous.status, authState: previous.authState, version: previous.version, verificationState: previous.verificationState, lastVerifiedAt: previous.lastVerifiedAt,
      } : {}) } : agent)
    }
    const snapshot = createLocalAgentScanSnapshot({ agents: [...merged.values()], scannedAt: global.scannedAt, index: global.index })
    await writeJsonAtomic(paths.localAgentScanPath, snapshot)
    sendLocalAgentScanEvent(sender, { type: 'scan_complete', snapshot: await localAgentSnapshotResponse(paths, snapshot), visitedDirectories: global.visitedDirectories || 0 })
  } catch (error) {
    if (!controller.signal.aborted) sendLocalAgentScanEvent(sender, { type: 'scan_failed', error: errorMessage(error) })
  } finally {
    if (localAgentGlobalScanController === controller) {
      localAgentGlobalScanController = undefined
      localAgentGlobalScanPromise = undefined
      localAgentGlobalScanPaused = false
      localAgentScanPauseRequested = false
      for (const resolve of localAgentGlobalScanPauseWaiters.splice(0)) resolve()
    }
  }
}

async function persistLocalAgentScanCheckpoint(paths, fallbackSnapshot, discoveredAgents) {
  const current = await readLocalAgentScanSnapshot(paths) || fallbackSnapshot
  const merged = new Map(current.agents.map((agent) => [agent.installationId, agent]))
  for (const agent of discoveredAgents) {
    const previous = merged.get(agent.installationId)
    merged.set(agent.installationId, previous ? { ...agent, discoveredAt: previous.discoveredAt, ...(previous.verificationState === 'verified' && previous.fingerprint === agent.fingerprint ? {
      status: previous.status, authState: previous.authState, version: previous.version, verificationState: previous.verificationState, lastVerifiedAt: previous.lastVerifiedAt,
    } : {}) } : agent)
  }
  const snapshot = createLocalAgentScanSnapshot({ agents: [...merged.values()].slice(0, 512), scannedAt: new Date().toISOString(), index: current.index })
  await writeJsonAtomic(paths.localAgentScanPath, snapshot)
  return snapshot
}

function sendLocalAgentScanEvent(sender, event) {
  if (sender && !sender.isDestroyed()) sender.send('exora:local-agent-event', Object.freeze({ scope: 'local-agent-scan', ...event }))
}

async function localAgentSnapshotResponse(paths, providedSnapshot) {
  const snapshot = providedSnapshot || await readLocalAgentScanSnapshot(paths)
  const bindings = await readLocalAgentBindings(paths)
  const agents = (snapshot?.agents || []).map((agent) => ({
    ...agent,
    bound: Object.values(bindings).some((binding) => binding?.installationId === agent.installationId),
    boundRoles: ['buyer', 'seller'].filter((role) => bindings[role]?.installationId === agent.installationId),
  }))
  return {
    agents,
    binding: presentLocalAgentBinding(bindings.buyer, agents.find((agent) => agent.installationId === bindings.buyer?.installationId)),
    bindings: Object.fromEntries(['buyer', 'seller'].map((role) => [role, presentLocalAgentBinding(bindings[role], agents.find((agent) => agent.installationId === bindings[role]?.installationId))])),
    scannedAt: snapshot?.scannedAt || null,
    hasSnapshot: Boolean(snapshot),
    indexing: Boolean(localAgentGlobalScanController && !localAgentGlobalScanController.signal.aborted),
    paused: Boolean(localAgentGlobalScanController && localAgentGlobalScanPaused),
  }
}

async function local_agent_binding(payload = {}) {
  const role = normalizeLocalAgentRole(objectOr(payload.input || payload).role || 'buyer')
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const snapshot = await readLocalAgentScanSnapshot(paths)
  const bindings = await readLocalAgentBindings(paths)
  const storedBinding = bindings[role]
  if (!storedBinding) {
    return { binding: null, bindings: presentLocalAgentBindings(bindings, snapshot), agent: null, checkedAt: snapshot?.scannedAt || null }
  }
  const agent = snapshot?.agents.find((candidate) => candidate.installationId === storedBinding.installationId)
  return {
    binding: presentLocalAgentBinding(storedBinding, agent),
    bindings: presentLocalAgentBindings(bindings, snapshot),
    agent: agent ? { ...agent, bound: true } : null,
    checkedAt: snapshot?.scannedAt || null,
  }
}

async function bind_local_agent(payload = {}) {
  const input = objectOr(payload.input || payload)
  const inputKeys = Object.keys(input)
  if (inputKeys.some((key) => key !== 'installationId' && key !== 'role')) {
    throw new Error('Local agent binding only accepts a role and discovered installation ID.')
  }
  const installationId = String(input.installationId || '').trim()
  const role = normalizeLocalAgentRole(input.role)

  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const snapshot = await readLocalAgentScanSnapshot(paths)
  if (!snapshot) throw new Error('Scan local agents before choosing a binding.')
  const discoveredAgent = cachedLocalAgentForBinding(snapshot, installationId)
  if (!discoveredAgent) throw new Error('The selected local Agent installation was not found in the saved scan.')
  const driver = localAgentDriver(discoveredAgent.driverId)
  if (!driver?.bindable) throw new Error(`${driver?.name || discoveredAgent.driverId} can currently be detected but not bound.`)
  const agent = await verifyLocalAgentInstallation(discoveredAgent)
  const updatedSnapshot = createLocalAgentScanSnapshot({ ...snapshot, agents: snapshot.agents.map((candidate) => candidate.installationId === installationId ? agent : candidate), scannedAt: snapshot.scannedAt, index: snapshot.index })
  await writeJsonAtomic(paths.localAgentScanPath, updatedSnapshot)
  if (agent.status === 'login_required') throw new Error(`Sign in to ${driver.name}, then bind this installation again.`)
  if (!localAgentCanBind(agent)) throw new Error(`${driver.name} could not be verified and was not bound.`)

  const current = await readLocalAgentBinding(paths, role)
  const selectedAt = new Date().toISOString()
  const binding = {
    bindingId: current?.installationId === installationId ? current.bindingId : `local-agent-${crypto.randomUUID()}`,
    installationId,
    driverId: agent.driverId,
    executablePath: agent.resolvedTargetPath || agent.executablePath,
    resolvedTargetPath: agent.resolvedTargetPath || '',
    fingerprint: agent.resolvedTargetFingerprint || agent.fingerprint,
    source: agent.source,
    version: agent.version || '',
    boundAt: current?.installationId === installationId ? current.boundAt : selectedAt,
    lastVerifiedAt: selectedAt,
  }
  await writeLocalAgentBinding(paths, role, binding)
  const bindings = await readLocalAgentBindings(paths)
  return {
    binding: presentLocalAgentBinding(binding, agent),
    bindings: presentLocalAgentBindings(bindings, updatedSnapshot),
    agent: { ...agent, bound: true },
  }
}

async function readLocalAgentScanSnapshot(paths) {
  return restoreLocalAgentScanSnapshot(await readJsonOr(paths.localAgentScanPath, null))
}

async function unbind_local_agent(payload = {}) {
  const role = normalizeLocalAgentRole(objectOr(payload.input || payload).role)
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const bindings = await readLocalAgentBindings(paths)
  delete bindings[role]
  await writeLocalAgentBindings(paths, bindings)
  return { unbound: true, role }
}

const localAgentModelCache = new Map()

async function local_agent_models(payload = {}) {
  const role = normalizeLocalAgentRole(objectOr(payload.input || payload).role || 'buyer')
  const paths = await dockPaths()
  const binding = await readLocalAgentBinding(paths, role)
  if (!binding) throw new Error('Bind a local Agent before loading models.')
  if (binding.driverId !== 'codex') return { driverId: binding.driverId, models: [], selectedModel: '' }
  const key = `${binding.bindingId}:${binding.fingerprint}`
  if (localAgentModelCache.has(key)) return localAgentModelCache.get(key)
  const models = await codexAppServerModels(binding.executablePath)
  const result = { driverId: binding.driverId, models, selectedModel: models.find((model) => model.isDefault)?.id || models[0]?.id || '' }
  localAgentModelCache.set(key, result)
  return result
}

function codexAppServerModels(executablePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: false })
    let buffer = ''
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      error ? reject(error) : resolve(value)
    }
    const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`)
    child.on('error', (error) => finish(error))
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        let message
        try { message = JSON.parse(line) } catch { continue }
        if (message.id === 1) {
          if (message.error) return finish(new Error(message.error.message || 'Codex initialize failed.'))
          send({ method: 'initialized', params: {} })
          send({ id: 2, method: 'model/list', params: { includeHidden: false, limit: 100 } })
        } else if (message.id === 2) {
          if (message.error) return finish(new Error(message.error.message || 'Codex model/list failed.'))
          const models = Array.isArray(message.result?.data) ? message.result.data.map((model) => ({
            id: String(model.id || model.model || ''), displayName: String(model.displayName || model.id || ''),
            description: String(model.description || ''), isDefault: Boolean(model.isDefault),
            supportedReasoningEfforts: Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts.map((item) => String(item?.reasoningEffort || '')).filter((value) => /^[a-z]{1,16}$/.test(value)) : [],
            defaultReasoningEffort: String(model.defaultReasoningEffort || ''),
          })).filter((model) => /^[A-Za-z0-9._-]{1,100}$/.test(model.id)) : []
          finish(null, models)
        }
      }
    })
    const timer = setTimeout(() => finish(new Error('Codex model list timed out.')), 15000)
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'exora-dock', title: 'Exora Dock', version: '2.0.0' } } })
  })
}

async function local_agent_session_start(payload = {}) {
  const input = objectOr(payload.input || payload)
  assertLocalAgentSessionInput(input, ['conversationId', 'role', 'purpose', 'workspace', 'permissionMode', 'model', 'reasoningEffort', 'transactionId', 'runId', 'workUid', 'idempotencyKey'])
  const conversationId = cleanLocalAgentIdentifier(input.conversationId, 'conversationId')
  const role = String(input.role || '').trim().toLowerCase()
  if (role !== 'buyer' && role !== 'seller') throw new Error('Local agent session role must be buyer or seller.')
  const purpose = String(input.purpose || '').trim().toLowerCase()
  if (purpose && purpose !== 'seller_card') throw new Error('Local agent session purpose is unsupported.')
  const transactionId = String(input.transactionId || '').trim()
  if (role === 'seller' && !transactionId && purpose !== 'seller_card') throw new Error('Select a seller transaction before connecting a local Agent.')

  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  await ensureDockReady()
  const binding = await readLocalAgentBinding(paths, role)
  if (!binding) throw new Error('Bind a local Agent in Settings before connecting this chat.')
  const driver = localAgentDriver(binding.driverId)
  if (!driver?.bindable || driver.protocolState === 'unsupported' || driver.protocolState === 'limited') {
    throw new Error(`${driver?.name || binding.driverId} is detection-only and cannot run an Exora chat session.`)
  }
  if (!binding.executablePath || !path.isAbsolute(binding.executablePath) || !fs.existsSync(binding.executablePath)) {
    throw new Error('The saved local Agent executable is unavailable. Scan and bind it again.')
  }
  const currentStat = fs.statSync(binding.executablePath)
  if (binding.fingerprint && binding.fingerprint !== `${currentStat.size}:${Math.trunc(currentStat.mtimeMs)}`) {
    throw new Error('The bound local Agent executable changed. Scan and bind this installation again.')
  }
  const requestedModel = String(input.model || '').trim()
  const requestedReasoningEffort = String(input.reasoningEffort || '').trim().toLowerCase()
  if (requestedModel) {
    const catalog = await local_agent_models()
    const selectedModel = catalog.models.find((model) => model.id === requestedModel)
    if (!selectedModel) throw new Error('The selected model is not available for this bound Agent.')
    if (requestedReasoningEffort && !selectedModel.supportedReasoningEfforts.includes(requestedReasoningEffort)) throw new Error('The selected reasoning effort is not supported by this model.')
  }
  const workspace = normalizeProjectPath(paths, input.workspace || '') || (await activeProjectFolder(paths)).path
  const allowedFolders = await readProjectFolders(paths)
  if (!allowedFolders.some((folder) => sameResolvedPath(folder.path, workspace))) {
    throw new Error('The chat workspace is not one of the user-selected Exora project folders.')
  }
  const idempotencyKey = String(input.idempotencyKey || `connect:${conversationId}:${role}`).trim()
  const response = await httpJson('POST', '/v1/local-agent-sessions', {
    conversationId,
    role,
    purpose,
    binding: {
      bindingId: binding.bindingId,
      driver: binding.driverId,
      version: binding.version || '',
      lastVerifiedAt: binding.lastVerifiedAt,
    },
    executablePath: binding.executablePath,
    workspace,
    permissionMode: normalizeLocalAgentPermissionMode(input.permissionMode),
    permissionProfile: localAgentPermissionProfile(input.permissionMode),
    model: requestedModel,
    reasoningEffort: requestedReasoningEffort,
    transactionId,
    runId: String(input.runId || '').trim(),
    workUid: String(input.workUid || '').trim(),
    idempotencyKey,
  }, await localOwnerToken(paths), { timeoutMs: 45000 })
  return response
}

async function local_agent_session_get(payload = {}) {
  const input = objectOr(payload.input || payload)
  assertLocalAgentSessionInput(input, ['sessionId'])
  const sessionId = cleanLocalAgentIdentifier(input.sessionId, 'sessionId')
  const paths = await dockPaths()
  return httpJson('GET', `/v1/local-agent-sessions/${encodeURIComponent(sessionId)}`, undefined, await localOwnerToken(paths), { timeoutMs: 5000 })
}

async function local_agent_session_send(payload = {}) {
  const input = objectOr(payload.input || payload)
  assertLocalAgentSessionInput(input, ['sessionId', 'clientMessageId', 'text', 'idempotencyKey'])
  const sessionId = cleanLocalAgentIdentifier(input.sessionId, 'sessionId')
  const clientMessageId = cleanLocalAgentIdentifier(input.clientMessageId, 'clientMessageId')
  const text = String(input.text || '').trim()
  if (!text || text.length > 200000) throw new Error('Local Agent message must contain 1-200000 characters.')
  const paths = await dockPaths()
  return httpJson('POST', `/v1/local-agent-sessions/${encodeURIComponent(sessionId)}/messages`, {
    clientMessageId,
    text,
    idempotencyKey: String(input.idempotencyKey || `message:${clientMessageId}`).trim(),
  }, await localOwnerToken(paths), { timeoutMs: 45000 })
}

async function local_agent_session_interrupt(payload = {}) {
  return localAgentSessionAction(payload, 'interrupt')
}

async function local_agent_session_stop(payload = {}) {
  const result = await localAgentSessionAction(payload, 'stop')
  const sessionId = String(objectOr(payload.input || payload).sessionId || '').trim()
  stopLocalAgentSessionStream(sessionId)
  return result
}

async function local_agent_session_resume(payload = {}) {
  return localAgentSessionAction(payload, 'resume', 45000)
}

async function localAgentSessionAction(payload, action, timeoutMs = 10000) {
  const input = objectOr(payload.input || payload)
  assertLocalAgentSessionInput(input, ['sessionId'])
  const sessionId = cleanLocalAgentIdentifier(input.sessionId, 'sessionId')
  const paths = await dockPaths()
  return httpJson('POST', `/v1/local-agent-sessions/${encodeURIComponent(sessionId)}/${action}`, {}, await localOwnerToken(paths), { timeoutMs })
}

async function local_agent_session_subscribe(payload = {}, event) {
  const input = objectOr(payload.input || payload)
  assertLocalAgentSessionInput(input, ['sessionId', 'after'])
  const sessionId = cleanLocalAgentIdentifier(input.sessionId, 'sessionId')
  const after = Math.max(0, Number.parseInt(String(input.after || '0'), 10) || 0)
  stopLocalAgentSessionStream(sessionId)
  const controller = new AbortController()
  localAgentSessionStreams.set(sessionId, controller)
  void forwardLocalAgentSessionStream(sessionId, after, controller, event?.sender)
  return { subscribed: true, sessionId }
}

async function local_agent_session_events(payload = {}) {
  const input = objectOr(payload.input || payload)
  assertLocalAgentSessionInput(input, ['sessionId', 'after'])
  const sessionId = cleanLocalAgentIdentifier(input.sessionId, 'sessionId')
  const after = Math.max(0, Number.parseInt(String(input.after || '0'), 10) || 0)
  const events = (localAgentSessionEventBacklogs.get(sessionId) || []).filter((item) => Number(item?.seq || 0) > after)
  return { sessionId, events }
}

async function local_agent_session_unsubscribe(payload = {}) {
  const input = objectOr(payload.input || payload)
  assertLocalAgentSessionInput(input, ['sessionId'])
  const sessionId = cleanLocalAgentIdentifier(input.sessionId, 'sessionId')
  stopLocalAgentSessionStream(sessionId)
  return { subscribed: false, sessionId }
}

async function forwardLocalAgentSessionStream(sessionId, after, controller, sender) {
  try {
    const paths = await dockPaths()
    const token = await localOwnerToken(paths)
    const response = await fetch(`${BASE_URL}/v1/local-agent-sessions/${encodeURIComponent(sessionId)}/stream?after=${after}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error(`local Agent event stream returned ${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary).replace(/\r/g, '')
        buffer = buffer.slice(boundary + 2)
        const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
        if (!data) continue
        let parsed
        try { parsed = JSON.parse(data) } catch { continue }
        const backlog = localAgentSessionEventBacklogs.get(sessionId) || []
        backlog.push(parsed)
        if (backlog.length > 2000) backlog.splice(0, backlog.length - 2000)
        localAgentSessionEventBacklogs.set(sessionId, backlog)
        if (sender && !sender.isDestroyed()) sender.send('exora:local-agent-event', Object.freeze({ sessionId, event: parsed }))
      }
    }
  } catch (error) {
    if (!controller.signal.aborted && sender && !sender.isDestroyed()) {
      sender.send('exora:local-agent-event', Object.freeze({ sessionId, error: errorMessage(error) }))
    }
  } finally {
    if (localAgentSessionStreams.get(sessionId) === controller) localAgentSessionStreams.delete(sessionId)
  }
}

function stopLocalAgentSessionStream(sessionId) {
  const controller = localAgentSessionStreams.get(String(sessionId || '').trim())
  if (controller) controller.abort()
  localAgentSessionStreams.delete(String(sessionId || '').trim())
}

function assertLocalAgentSessionInput(input, allowedKeys) {
  const allowed = new Set(allowedKeys)
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error('Local Agent session request contains unsupported fields.')
}

function cleanLocalAgentIdentifier(value, label) {
  const text = String(value || '').trim()
  if (!text || text.length > 240 || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${label} is invalid.`)
  return text
}

function normalizeLocalAgentPermissionMode(value) {
  const mode = String(value || 'ask').trim().toLowerCase()
  return ['ask', 'approve', 'full', 'custom'].includes(mode) ? mode : 'ask'
}

function localAgentPermissionProfile(value) {
  switch (normalizeLocalAgentPermissionMode(value)) {
    case 'approve': return 'workspace-write'
    case 'full': return 'danger-full-access'
    case 'custom': return ''
    default: return 'read-only'
  }
}

function localAgentCanBind(agent) {
  return Boolean(
    agent?.installed &&
    agent.bindable &&
    (agent.status === 'ready' || agent.status === 'available') &&
    agent.executablePath,
  )
}

function normalizeLocalAgentRole(value) {
  const role = String(value || '').trim().toLowerCase()
  if (role !== 'buyer' && role !== 'seller') throw new Error('Local Agent role must be buyer or seller.')
  return role
}

async function readLocalAgentBindings(paths) {
  const document = objectOr(await readJsonOr(paths.localAgentBindingPath, {}))
  const legacy = objectOr(document.binding || (document.driverId ? document : {}))
  const inputs = document.bindings && typeof document.bindings === 'object'
    ? objectOr(document.bindings)
    : Object.keys(legacy).length ? { buyer: legacy, seller: legacy } : {}
  const bindings = {}
  for (const role of ['buyer', 'seller']) {
    const binding = await normalizeStoredLocalAgentBinding(paths, objectOr(inputs[role]))
    if (binding) bindings[role] = binding
  }
  return bindings
}

async function readLocalAgentBinding(paths, role = 'buyer') {
  return (await readLocalAgentBindings(paths))[normalizeLocalAgentRole(role)]
}

async function normalizeStoredLocalAgentBinding(paths, input) {
  const driver = localAgentDriver(input.driverId)
  if (!driver) return undefined
  const executablePath = String(input.executablePath || '').trim()
  let installationId = String(input.installationId || '').trim()
  if (!/^agent-installation-[a-f0-9]{32}$/.test(installationId)) {
    const snapshot = await readLocalAgentScanSnapshot(paths)
    installationId = snapshot?.agents.find((agent) => sameResolvedPath(agent.executablePath, executablePath))?.installationId || ''
  }
  return {
    bindingId: /^local-agent-[0-9a-f-]{36}$/i.test(String(input.bindingId || ''))
      ? String(input.bindingId)
      : `local-agent-${crypto.randomUUID()}`,
    driverId: driver.id,
    installationId,
    executablePath: path.isAbsolute(executablePath) ? executablePath : '',
    resolvedTargetPath: path.isAbsolute(String(input.resolvedTargetPath || '')) ? String(input.resolvedTargetPath) : '',
    fingerprint: String(input.fingerprint || '').trim().slice(0, 128),
    source: String(input.source || '').trim().slice(0, 80),
    version: String(input.version || '').trim().slice(0, 160),
    boundAt: validIsoOrNow(input.boundAt),
    lastVerifiedAt: validIsoOrNow(input.lastVerifiedAt || input.boundAt),
  }
}

async function writeLocalAgentBinding(paths, role, binding) {
  const bindings = await readLocalAgentBindings(paths)
  bindings[normalizeLocalAgentRole(role)] = binding
  await writeLocalAgentBindings(paths, bindings)
}

async function writeLocalAgentBindings(paths, bindings) {
  const persisted = {}
  for (const role of ['buyer', 'seller']) {
    const binding = bindings[role]
    if (!binding) continue
    persisted[role] = {
      bindingId: binding.bindingId,
      installationId: binding.installationId,
      driverId: binding.driverId,
      executablePath: binding.executablePath,
      resolvedTargetPath: binding.resolvedTargetPath || '',
      fingerprint: binding.fingerprint || '',
      source: binding.source || '',
      version: binding.version || '',
      boundAt: binding.boundAt,
      lastVerifiedAt: binding.lastVerifiedAt,
    }
  }
  await writeJsonAtomic(paths.localAgentBindingPath, {
    version: 3,
    bindings: persisted,
  })
}

function presentLocalAgentBindings(bindings, snapshot) {
  return Object.fromEntries(['buyer', 'seller'].map((role) => {
    const binding = bindings[role]
    const agent = snapshot?.agents?.find((candidate) => candidate.installationId === binding?.installationId)
    return [role, presentLocalAgentBinding(binding, agent)]
  }))
}

function presentLocalAgentBinding(binding, agent) {
  if (!binding) return null
  const driver = localAgentDriver(binding.driverId)
  if (!driver) return null
  return {
    bindingId: binding.bindingId,
    driverId: driver.id,
    installationId: binding.installationId,
    name: driver.name,
    vendor: driver.vendor,
    executablePath: agent?.executablePath || binding.executablePath,
    source: agent?.source || binding.source || '',
    version: agent?.version || binding.version || '',
    protocol: driver.protocol,
    protocolState: driver.protocolState,
    protocolLabel: driver.protocolLabel,
    capabilities: [...driver.capabilities],
    boundAt: binding.boundAt,
    lastVerifiedAt: binding.lastVerifiedAt,
    status: agent?.status || 'not_installed',
    authState: agent?.authState || 'unknown',
    valid: localAgentCanBind(agent),
  }
}

async function desktop_persistence_load() {
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const settingsDoc = await readJsonOr(paths.appSettingsPath, {})
  return {
    version: 1,
    settings: objectOr(settingsDoc.settings || settingsDoc),
    conversations: await readConversationRecords(paths),
  }
}

async function save_app_settings(payload = {}) {
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const input = objectOr(payload.input || payload)
  const settings = objectOr(input.settings || input)
  await writeJsonAtomic(paths.appSettingsPath, {
    version: 1,
    savedAt: new Date().toISOString(),
    settings,
  })
  return { saved: true, path: paths.appSettingsPath }
}

async function locale_status() {
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const language = await readPersistedLanguage(paths)
  return {
    language,
    chromiumLocale: chromiumLocaleForLanguage(language),
    htmlLang: htmlLangForLanguage(language),
    appLocale: app.getLocale(),
    systemLocale: app.getSystemLocale(),
    preferredSystemLanguages: app.getPreferredSystemLanguages(),
  }
}

async function set_locale(payload = {}) {
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const input = objectOr(payload.input || payload)
  const language = normalizeAppLanguage(input.language || input.locale || input.lang)
  const current = objectOr(await readJsonOr(paths.appSettingsPath, {}))
  const settings = objectOr(current.settings || current)
  settings.language = language
  await writeJsonAtomic(paths.appSettingsPath, {
    ...current,
    version: current.version || 1,
    savedAt: new Date().toISOString(),
    settings,
  })
  return {
    saved: true,
    language,
    chromiumLocale: chromiumLocaleForLanguage(language),
    htmlLang: htmlLangForLanguage(language),
    path: paths.appSettingsPath,
  }
}

async function save_chat_thread(payload = {}) {
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const input = objectOr(payload.input || payload)
  const thread = objectOr(input.thread)
  const record = conversationRecordFromThread(thread)
  if (!record) return { saved: false }
  const previousStorageKeys = Array.isArray(input.previousStorageKeys)
    ? input.previousStorageKeys.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  const filePath = conversationPathForStorageKey(paths, record.storageKey)
  await writeJsonAtomic(filePath, record)
  await removePreviousConversationFiles(paths, record.storageKey, previousStorageKeys)
  return { saved: true, storageKey: record.storageKey, path: filePath }
}

async function archive_chat_threads(payload = {}) {
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const input = objectOr(payload.input || payload)
  const archivedAt = validIsoOrNow(input.archivedAt)
  const threads = Array.isArray(input.threads) ? input.threads : []
  const extraStorageKeys = Array.isArray(input.storageKeys) ? input.storageKeys.map((item) => String(item || '').trim()).filter(Boolean) : []
  const archiveDir = await archiveConversationFiles(paths, threads, archivedAt, extraStorageKeys)
  return { archivedCount: threads.length, archivePath: archiveDir }
}

async function save_transactions(payload = {}) {
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const input = objectOr(payload.input || payload)
  const records = Array.isArray(input.records) ? input.records : []
  const savedAt = validIsoOrNow(input.savedAt)
  const filePath = paths.transactionsPath
  await writeJsonAtomic(filePath, {
    version: 1,
    savedAt,
    records,
  })
  return { saved: true, count: records.length, path: filePath }
}

async function save_seller_settings(payload) {
  const input = payload?.input ?? {}
  const restart = payload?.restart !== false && input.restart !== false
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const raw = await readTextOr(paths.configPath, defaultLocalConfig(paths))
  const updated = updateSellerSettingsYaml(raw, input)
  await fsp.writeFile(paths.configPath, updated)
  await writeDiscoveryManifest(paths)
  if (restart && await trackedDaemonRunning(paths)) {
    await stopTrackedDaemon(paths)
    return start_dock()
  }
  return app_status()
}

async function test_llm_connection(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const raw = await readTextOr(paths.configPath, defaultLocalConfig(paths))
  const apiKey = await effectiveLlmApiKeyForInput(paths, raw, input)
  const model = defaultIfBlank(input.researchModel, 'gpt-5.5')
  const baseUrl = String(input.llmBaseUrl || '').trim()
  const providerPreset = normalizeProviderPreset(input.providerPreset || inferProviderPreset(baseUrl))
  const preferredWire = normalizeWireApi(input.wireApi || defaultWireForPreset(providerPreset))
  let last = { message: 'LLM request failed', route: preferredWire === 'responses' ? '/responses' : '/chat/completions' }
  for (const wire of uniqueList([preferredWire, preferredWire === 'responses' ? 'chat_completions' : 'responses'])) {
    const route = wire === 'responses' ? '/responses' : '/chat/completions'
    const body = wire === 'responses'
      ? { model, instructions: 'Reply with exactly: ok', input: 'connection test', store: false }
      : { model, messages: [{ role: 'user', content: 'Reply with exactly: ok' }], max_tokens: 8 }
    try {
      const posted = await llmPostJsonWithBase(baseUrl, route, apiKey, body)
      let models = []
      try {
        models = await llmGetModels(posted.baseUrl, apiKey)
      } catch {
        models = []
      }
      return {
        ok: true,
        status: 'ready',
        message: `LLM provider responded successfully using ${wire === 'responses' ? 'Responses' : 'Chat Completions'}.`,
        route,
        llmBaseUrl: posted.baseUrl,
        wireApi: wire,
        providerPreset,
        capabilities: capabilitiesForWire(providerPreset, wire),
        models,
      }
    } catch (error) {
      const message = errorMessage(error)
      const status = classifyLlmError(message)
      last = { message, route, status }
      if (status === 'auth_failed') break
    }
  }
  return { ok: false, status: last.status || classifyLlmError(last.message), message: last.message, route: last.route }
}

async function list_llm_models(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const raw = await readTextOr(paths.configPath, defaultLocalConfig(paths))
  const apiKey = await effectiveLlmApiKeyForInput(paths, raw, input)
  try {
    const result = await llmGetModelsWithBase(input.llmBaseUrl, apiKey)
    return { ok: true, models: result.models, llmBaseUrl: result.baseUrl, message: 'Model list loaded.' }
  } catch (error) {
    return { ok: false, models: [], message: errorMessage(error) }
  }
}

async function agent_cards_mine() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('GET', '/v1/agent-cards/mine', undefined, await localOwnerToken(paths))
}

async function agent_card_diagnostics() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await ensureLLMProfiles(paths)
  await ensureDockReady()
  return agentCardDiagnosticsWithDesktop(paths)
}

async function agent_card_draft(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await ensureLLMProfiles(paths)
  await ensureDockReady()
  const requestInput = { ...input }
  if (!requestInput.diagnostics?.collectedAt) {
    const body = await agentCardDiagnosticsWithDesktop(paths)
    requestInput.diagnostics = body.diagnostics
  }
  return httpJson('POST', '/v1/agent-cards/draft', requestInput, await localOwnerToken(paths), { timeoutMs: 20000 })
}

async function agentCardDiagnosticsWithDesktop(paths) {
  const body = await httpJson('POST', '/v1/agent-cards/diagnostics', {}, await localOwnerToken(paths), { timeoutMs: 20000 })
  return {
    ...body,
    diagnostics: mergeAgentCardDiagnostics(body?.diagnostics, await desktopAgentCardDiagnostics()),
  }
}

async function desktopAgentCardDiagnostics() {
  const packagePath = path.join(__dirname, '..', 'package.json')
  const lockPath = path.join(__dirname, '..', 'package-lock.json')
  const packageJson = objectOr(await readJsonOr(packagePath, {}))
  const packageLock = objectOr(await readJsonOr(lockPath, {}))
  const codeEnvironment = [
    dependencyInfo('Exora Dock Desktop', String(packageJson.version || app.getVersion() || ''), 'desktop package'),
    dependencyInfo('Electron', process.versions.electron ? `Electron ${process.versions.electron}` : '', 'desktop runtime'),
    dependencyInfo('Chromium', process.versions.chrome ? `Chromium ${process.versions.chrome}` : '', 'desktop runtime'),
    dependencyInfo('Electron Node.js', process.versions.node ? `Node ${process.versions.node}` : '', 'desktop runtime'),
    dependencyInfo('V8', process.versions.v8 ? `V8 ${process.versions.v8}` : '', 'desktop runtime'),
  ].filter(Boolean)
  return {
    codeEnvironment,
    dependencies: desktopPackageDependencies(packageJson, packageLock),
  }
}

function desktopPackageDependencies(packageJson, packageLock) {
  const packages = objectOr(packageLock.packages)
  const out = []
  for (const [section, source] of [
    ['dependencies', 'desktop dependency'],
    ['devDependencies', 'desktop devDependency'],
  ]) {
    const deps = objectOr(packageJson[section])
    for (const name of Object.keys(deps).sort()) {
      const locked = objectOr(packages[`node_modules/${name}`])
      const version = String(locked.version || deps[name] || '').trim()
      const item = dependencyInfo(name, version, source)
      if (item) out.push(item)
    }
  }
  return out
}

function mergeAgentCardDiagnostics(diagnostics, desktop) {
  if (!diagnostics || typeof diagnostics !== 'object') return diagnostics
  return {
    ...diagnostics,
    codeEnvironment: mergeDependencyInfo(diagnostics.codeEnvironment, desktop.codeEnvironment),
    dependencies: mergeDependencyInfo(desktop.dependencies, diagnostics.dependencies),
  }
}

function mergeDependencyInfo(primary, secondary) {
  const out = []
  const seen = new Set()
  for (const item of [...asArray(primary), ...asArray(secondary)]) {
    if (!item || typeof item !== 'object') continue
    const normalized = dependencyInfo(item.name, item.version, item.source, item.location)
    if (!normalized) continue
    const key = `${normalized.source || ''}:${normalized.name}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

function dependencyInfo(name, version, source, location) {
  name = String(name || '').trim()
  version = String(version || '').trim()
  source = String(source || '').trim()
  location = String(location || '').trim()
  if (!name || !version) return undefined
  const item = { name, version, source }
  if (location) item.location = location
  return item
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

async function save_agent_card(payload) {
  const input = payload?.input ?? {}
  const role = String(input.role || input.card?.role || '').trim()
  if (!['buyer', 'seller'].includes(role)) throw new Error('role must be buyer or seller')
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('PUT', `/v1/agent-cards/${encodeURIComponent(role)}`, { card: input.card }, await localOwnerToken(paths), { timeoutMs: 10000 })
}

async function publish_agent_card(payload) {
  const input = payload?.input ?? {}
  const role = String(input.role || '').trim()
  if (!['buyer', 'seller'].includes(role)) throw new Error('role must be buyer or seller')
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('POST', `/v1/agent-cards/${encodeURIComponent(role)}/publish`, {}, await localOwnerToken(paths), { timeoutMs: 15000 })
}

async function seller_market_status() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const settings = await sellerSettingsFromConfig(paths)
  const token = await localOwnerToken(paths)
  const provider = String(settings.providerId || '').trim()
  const route = provider ? `/v1/resources?provider=${encodeURIComponent(provider)}` : '/v1/resources'
  const resources = await httpJson('GET', route, undefined, token)
  const count = Array.isArray(resources.resources) ? resources.resources.length : 0
  return {
    discoverable: settings.enabled && settings.hasApiKey && count > 0,
    resourceListingCount: count,
    providerId: settings.providerId,
  }
}

async function market_rail_cards() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('GET', '/v1/market/rail-cards', undefined, await localOwnerToken(paths), { timeoutMs: 10000 })
}

async function agent_card_search(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const params = new URLSearchParams()
  const role = String(input.role || 'seller').trim()
  const query = String(input.q || input.query || '').trim()
  if (role) params.set('role', role)
  if (query) params.set('q', query)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return httpJson('GET', `/v1/agent-cards/search${suffix}`, undefined, await localAgentToken(paths), { timeoutMs: 10000 })
}

async function agent_search_sellers(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const token = await localAgentToken(paths)
  const negotiationFirst = input.negotiationFirst !== false
  const body = {
    query: input.query,
    projectPath: input.projectPath,
    workUid: input.workUid,
    agentId: String(input.agentId || '').trim() || 'exora-desktop-agent',
    buyerAgentCardId: String(input.buyerAgentCardId || '').trim() || undefined,
    prePlanConfirmed: Boolean(input.prePlanConfirmed),
    approvalId: String(input.approvalId || '').trim() || undefined,
    planId: String(input.planId || '').trim() || undefined,
    manifestHash: String(input.manifestHash || '').trim() || undefined,
    maxResults: input.maxResults ?? 8,
    maxCandidates: input.maxCandidates ?? 3,
    maxOptions: input.maxOptions ?? 6,
    taskTemplate: input.taskTemplate || undefined,
  }
  if (negotiationFirst) {
    return httpJson('POST', '/v1/agent/buyer-work', body, token)
  }
  return httpJson('POST', '/v1/agent/search-sellers', {
    ...body,
    prepareOrderOptions: true,
    createSelectionRequest: true,
  }, token)
}

async function list_approvals() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('GET', '/v1/approvals?status=pending', undefined, await localOwnerToken(paths))
}

async function decide_approval(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const body = {
    approved: Boolean(input.approved),
    decidedBy: 'exora-desktop',
    userNote: input.userNote || '',
  }
  if (input.paymentPin) body.paymentPin = input.paymentPin
  return httpJson('POST', `/v1/approvals/${encodeURIComponent(input.approvalId)}/decide`, body, await localOwnerToken(paths))
}

async function list_order_plans() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('GET', '/v1/order-plans?status=pending_selection', undefined, await localOwnerToken(paths))
}

async function workspace_snapshot() {
  return workspaceSnapshotService.snapshot()
}

async function buyer_flow_action(payload = {}) {
  const input = objectOr(payload.input || payload)
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await ensureDockReady()
  const token = await localOwnerToken(paths)
  const flowId = encodeURIComponent(String(input.flowId || '').trim())
  const quoteId = encodeURIComponent(String(input.quoteId || '').trim())
  const questionId = encodeURIComponent(String(input.questionId || '').trim())
  const routes = {
    create: ['/v1/buyer-flows', input.body],
    approve_plans: [`/v1/buyer-flows/${flowId}/plans/approve`, {}],
    prepare: [`/v1/buyer-flows/${flowId}/preparation/start`, {}],
    approve_bundle: [`/v1/buyer-flows/${flowId}/bundle/approve`, {}],
    start_matching: [`/v1/buyer-flows/${flowId}/matching/start`, {}],
    select_quote: [`/v1/buyer-flows/${flowId}/quotes/${quoteId}/select`, {}],
    publish_quote: [`/v1/buyer-flows/${flowId}/quotes/${quoteId}/publish`, {}],
    update_quote: [`/v1/buyer-flows/${flowId}/quotes/${quoteId}/update`, input.quote],
    withdraw_quote: [`/v1/buyer-flows/${flowId}/quotes/${quoteId}/withdraw`, {}],
    review_question: [`/v1/buyer-flows/${flowId}/review/questions`, { sellerId: input.sellerId, prompt: input.prompt, options: input.options }],
    fund: [`/v1/buyer-flows/${flowId}/payment/fund`, { paymentPin: input.paymentPin || '' }],
    answer_question: [`/v1/buyer-flows/${flowId}/execution/questions/${questionId}/answer`, { answer: input.answer || '' }],
    simulate_question: [`/v1/buyer-flows/${flowId}/execution/questions`, { prompt: input.prompt || '请选择交付格式', options: input.options || [{ label: 'Markdown', value: 'markdown' }, { label: 'PDF', value: 'pdf' }] }],
    simulate_delivery: [`/v1/buyer-flows/${flowId}/execution/deliver`, { artifacts: input.artifacts || ['delivery/report.md'], summary: input.summary || 'Local protocol seller completed the approved task.' }],
    decide_acceptance: [`/v1/buyer-flows/${flowId}/acceptance/decide`, { decision: input.decision, note: input.note || '' }],
    resolve_dispute: [`/v1/buyer-flows/${flowId}/dispute/resolve`, { resolution: input.resolution }],
    rate: [`/v1/buyer-flows/${flowId}/rating`, { stars: input.stars, comment: input.comment || '' }],
  }
  const selected = routes[String(input.action || '')]
  if (!selected) throw new Error('Unsupported buyer flow action')
  return httpJson('POST', selected[0], selected[1], token)
}

async function create_work_mcp_uid(payload = {}) {
  const input = objectOr(payload.input || payload)
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const active = await activeProjectFolder(paths)
  const folder = projectFolderFromPath(input.projectPath || active.path)
  await saveProjectFolder(paths, folder, { select: false })
  const state = await readDesktopState(paths)
  const now = new Date().toISOString()
  const workUid = `work-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`}`
  const entry = {
    workUid,
    projectPath: folder.path,
    projectName: folder.name,
    task: String(input.task || '').trim(),
    createdAt: now,
    updatedAt: now,
  }
  const previous = Array.isArray(state.workMcpUids) ? state.workMcpUids : []
  state.workMcpUids = [entry, ...previous.filter((item) => item?.workUid !== workUid)].slice(0, 100)
  await writeDesktopState(paths, state)
  return entry
}

async function release_work_mcp_lease(payload = {}) {
  const input = objectOr(payload.input || payload)
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const state = await readDesktopState(paths)
  const workUid = String(input.workUid || input.uid || '').trim()
  const projectPath = normalizeProjectPath(paths, input.projectPath || '')
  const now = new Date().toISOString()
  let released = 0
  const leases = Array.isArray(state.workMcpLeases) ? state.workMcpLeases : []
  state.workMcpLeases = leases.map((item) => {
    const lease = objectOr(item)
    const sameUid = workUid && String(lease.workUid || '').trim() === workUid
    const samePath = projectPath && lease.projectPath && sameResolvedPath(lease.projectPath, projectPath)
    if (!sameUid && !samePath) return item
    released += 1
    return {
      ...lease,
      status: 'released',
      releasedAt: now,
      expiresAt: now,
      updatedAt: now,
    }
  }).slice(0, WORK_MCP_LEASE_LIMIT)
  await writeDesktopState(paths, state)
  return {
    released,
    workMcpLeases: await activeWorkMCPLeases(paths),
  }
}

async function stop_work_run(payload = {}) {
  const input = objectOr(payload.input || payload)
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const token = await localOwnerToken(paths)
  let runId = String(input.runId || '').trim()
  const workUid = String(input.workUid || input.uid || '').trim()
  if (!runId && workUid) {
    const listed = await httpJson('GET', `/v1/work-runs?workUid=${encodeURIComponent(workUid)}`, undefined, token)
    const runs = Array.isArray(listed.workRuns) ? listed.workRuns : []
    runId = String(runs[0]?.runId || '').trim()
  }
  if (!runId) throw new Error('work run id required')
  const stopped = await httpJson('POST', `/v1/work-runs/${encodeURIComponent(runId)}/stop`, {
    reason: String(input.reason || 'Stopped from Exora Dock owner control.'),
  }, token)
  if (workUid || input.projectPath) {
    await release_work_mcp_lease({ input: { workUid, projectPath: input.projectPath } })
  }
  return stopped
}

async function list_tasks() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('GET', '/v1/tasks', undefined, await localOwnerToken(paths))
}

async function get_task(payload) {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('GET', `/v1/tasks/${encodeURIComponent(payload?.id || '')}`, undefined, await localOwnerToken(paths))
}

async function list_payments() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('GET', '/v1/payments', undefined, await localOwnerToken(paths))
}

async function get_payment(payload) {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('GET', `/v1/payments/${encodeURIComponent(payload?.id || '')}`, undefined, await localOwnerToken(paths))
}

async function select_order_plan(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const body = { optionId: input.optionId, userNote: input.userNote || '' }
  if (input.paymentPin) body.paymentPin = input.paymentPin
  return httpJson('POST', `/v1/order-plans/${encodeURIComponent(input.planId)}/select`, body, await localOwnerToken(paths))
}

async function cancel_order_plan(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('POST', `/v1/order-plans/${encodeURIComponent(input.planId)}/cancel`, { userNote: input.userNote || '' }, await localOwnerToken(paths))
}

async function payment_pin_status() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('GET', '/v1/payment-pin/status', undefined, await localOwnerToken(paths))
}

async function set_payment_pin(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('POST', '/v1/payment-pin/set', { pin: input.pin }, await localOwnerToken(paths))
}

async function wallet_status() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return ensureDefaultWallet(paths)
}

async function wallet_create(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const recoveryPassword = input.recoveryPassword || await desktopWalletRecoveryPassword(paths)
  return httpJson('POST', '/v1/wallet/create', {
    recoveryPassword,
    overwrite: input.overwrite === true,
  }, await localOwnerToken(paths))
}

async function wallet_unlock(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const recoveryPassword = input.recoveryPassword || await desktopWalletRecoveryPassword(paths)
  return httpJson('POST', '/v1/wallet/unlock', { recoveryPassword }, await localOwnerToken(paths))
}

async function wallet_restore(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('POST', '/v1/wallet/restore', { recoveryPassword: input.recoveryPassword || '', backup: input.backup }, await localOwnerToken(paths))
}

async function wallet_withdraw(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('POST', '/v1/wallet/withdraw', {
    toAddress: input.toAddress || '',
    amountAtomic: Number(input.amountAtomic || 0),
    paymentPin: input.paymentPin || '',
  }, await localOwnerToken(paths))
}

async function ensureDefaultWallet(paths) {
  const token = await localOwnerToken(paths)
  let response = await httpJson('GET', '/v1/wallet', undefined, token)
  const status = objectOr(response.wallet)
  if (status.configured !== true || status.boundOnly === true) {
    const recoveryPassword = await desktopWalletRecoveryPassword(paths)
    return httpJson('POST', '/v1/wallet/create', {
      recoveryPassword,
      overwrite: status.configured === true || status.boundOnly === true,
    }, token)
  }
  if (status.accountBound !== false && status.unlocked !== true && String(status.encryptedKeypairPath || '').trim()) {
    const recoveryPassword = await desktopWalletRecoveryPassword(paths)
    try {
      response = await httpJson('POST', '/v1/wallet/unlock', { recoveryPassword }, token)
    } catch {
      // Existing wallets created with a user-set password still show their receive address.
    }
  }
  return response
}

async function desktopWalletRecoveryPassword(paths) {
  const state = await readDesktopState(paths)
  const existing = objectOr(state.walletAutoRecovery)
  if (existing.keyStorage === 'safeStorage' && existing.encryptedSecret && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(String(existing.encryptedSecret), 'base64'))
    } catch {
      // Fall through and rotate the local auto recovery secret.
    }
  }
  if (existing.secret) return String(existing.secret)

  const secret = `exora-wallet-${crypto.randomBytes(32).toString('base64url')}`
  const record = {
    createdAt: new Date().toISOString(),
    keyStorage: 'plain',
    secret,
  }
  if (safeStorage.isEncryptionAvailable()) {
    record.keyStorage = 'safeStorage'
    record.encryptedSecret = safeStorage.encryptString(secret).toString('base64')
    delete record.secret
  }
  state.walletAutoRecovery = record
  await writeDesktopState(paths, state)
  return secret
}

async function security_status() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  let auth
  try {
    auth = await localAuthTokens(paths)
  } catch {
    auth = undefined
  }
  const token = await localOwnerToken(paths)
  let pin
  try {
    pin = await httpJson('GET', '/v1/payment-pin/status', undefined, token)
  } catch (error) {
    pin = { paymentPin: { configured: false, error: errorMessage(error) } }
  }
  return {
    paymentPinConfigured: pin?.paymentPin?.configured === true,
    ownerTokenPresent: Boolean(auth?.ownerToken),
    agentTokenPresent: Boolean(auth?.agentToken),
    authPath: authPathForConfig(paths),
  }
}

async function daemon_status() {
  const status = await app_status()
  return `${status.docker} / ${status.container} / ${status.daemon}`
}

async function start_daemon() {
  await start_dock()
}

async function stop_daemon() {
  await stop_dock()
}

async function open_console() {
  await open_health()
}

async function project_folder_status() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const folder = defaultProjectFolder(paths)
  await saveProjectFolder(paths, folder, { select: false })
  return folder
}

async function choose_project_folder(payload = {}) {
  const input = objectOr(payload.input || payload)
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const current = await activeProjectFolder(paths)
  const properties = ['openDirectory']
  if (input.allowCreate !== false) properties.push('createDirectory')
  const result = await dialog.showOpenDialog(mainWindow, {
    title: String(input.title || 'Choose project folder'),
    defaultPath: current.path,
    properties,
  })
  if (result.canceled || !result.filePaths?.[0]) return input.cancelReturnsUndefined ? undefined : current
  const selectedPath = result.filePaths[0]
  await fsp.mkdir(selectedPath, { recursive: true })
  const folder = projectFolderFromPath(selectedPath)
  return saveProjectFolder(paths, folder, { select: input.select !== false })
}

async function open_project_folder(payload = {}) {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const input = objectOr(payload.input || payload)
  const requestedPath = normalizeProjectPath(paths, input.path || input.projectPath || '')
  const folder = requestedPath ? projectFolderFromPath(requestedPath) : await activeProjectFolder(paths)
  await openFolderPath(folder.path)
  return folder
}

async function rename_project_folder(payload = {}) {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const input = objectOr(payload.input || payload)
  const nextName = validateProjectFolderName(input.name)
  const current = await activeProjectFolder(paths)
  const nextPath = path.join(path.dirname(current.path), nextName)
  if (sameResolvedPath(current.path, nextPath)) return current

  try {
    await fsp.access(nextPath)
    throw new Error(`A project folder named "${nextName}" already exists.`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  await fsp.mkdir(path.dirname(nextPath), { recursive: true })
  await fsp.rename(current.path, nextPath)
  return replaceProjectFolder(paths, current.path, projectFolderFromPath(nextPath))
}

async function archive_project_chats(payload = {}) {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await ensurePersistenceLayout(paths)
  const folder = await activeProjectFolder(paths)
  const input = objectOr(payload.input || payload)
  const threads = Array.isArray(input.threads) ? input.threads : []
  const archivedAt = validIsoOrNow(input.archivedAt)
  if (!threads.length) return { folder, archivedCount: 0 }

  const archiveDir = await archiveConversationFiles(paths, threads, archivedAt)
  await fsp.mkdir(archiveDir, { recursive: true })
  const archivePath = path.join(archiveDir, 'archive.json')
  const archive = {
    version: 1,
    project: folder,
    archivedAt,
    threadCount: threads.length,
    threads,
  }
  await writeJsonAtomic(archivePath, archive)
  return { folder, archivedCount: threads.length, archivePath }
}

async function remove_project_folder() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const current = await activeProjectFolder(paths)
  return removeProjectFolderFromState(paths, current.path)
}

function validateProjectFolderName(value) {
  const name = String(value || '').trim()
  if (!name) throw new Error('Project name is required.')
  if (/[<>:"/\\|?*\x00-\x1F]/.test(name) || /[. ]$/.test(name)) {
    throw new Error('Project name contains characters that cannot be used in a folder name.')
  }
  const reserved = new Set(['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'])
  if (reserved.has(name.toLowerCase())) throw new Error('Project name is reserved by the operating system.')
  return name
}

function sameResolvedPath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function validIsoOrNow(value) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function archiveFileStamp(isoValue) {
  return String(isoValue).replace(/[:.]/g, '-')
}

async function initializeLocalProjectFolder() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return activeProjectFolder(paths)
}

async function dockPaths() {
  const rootDir = appDataRoot()
  const persistenceDir = path.join(app.getPath('userData'), PERSISTENCE_DIR_NAME)
  const helperPath = resolveHelperPath()
  return {
    rootDir,
    dataDir: path.join(rootDir, 'data'),
    logsDir: path.join(rootDir, 'logs'),
    configPath: path.join(rootDir, 'config.yaml'),
    discoveryPath: path.join(rootDir, 'agent-discovery.json'),
    desktopStatePath: path.join(rootDir, DESKTOP_STATE_NAME),
    persistenceDir,
    appSettingsPath: path.join(persistenceDir, 'settings', 'settings.json'),
    localAgentBindingPath: path.join(persistenceDir, 'settings', 'local-agent-binding.json'),
    localAgentScanPath: path.join(persistenceDir, 'settings', 'local-agent-scan.json'),
    conversationsDir: path.join(persistenceDir, 'conversations', 'tasks'),
    conversationArchivesDir: path.join(persistenceDir, 'conversations', 'archives'),
    transactionsPath: path.join(persistenceDir, 'transactions', 'transactions.json'),
    helperPath,
    pidPath: path.join(rootDir, 'exora-dockd.pid'),
  }
}

function defaultProjectFolder(paths) {
  return projectFolderFromPath(path.join(paths.dataDir, 'jobs', DEFAULT_PROJECT_NAME))
}

function defaultJobsRoot(paths) {
  return path.join(paths.dataDir, 'jobs')
}

function projectFolderFromPath(folderPath) {
  const normalized = path.resolve(String(folderPath || '').trim())
  return {
    name: path.basename(normalized) || DEFAULT_PROJECT_NAME,
    path: normalized,
  }
}

async function projectFoldersStatus(paths) {
  const folders = await readProjectFolders(paths)
  const active = await activeProjectFolder(paths, folders)
  return {
    projectFolder: active,
    projectFolders: folders,
    activeProjectFolderPath: active.path,
  }
}

async function activeProjectFolder(paths, knownFolders) {
  const state = await readDesktopState(paths)
  const folders = knownFolders || await readProjectFolders(paths)
  const defaultFolder = defaultProjectFolder(paths)
  const requested = normalizeProjectPath(paths, state.activeProjectFolderPath || state.projectFolderPath || '')
  const active = (requested ? folders.find((folder) => sameResolvedPath(folder.path, requested)) : undefined) || defaultFolder
  await fsp.mkdir(active.path, { recursive: true })
  if (!sameResolvedPath(state.activeProjectFolderPath || '', active.path)) {
    state.activeProjectFolderPath = active.path
    state.projectFolders = folders
    delete state.projectFolderPath
    await writeDesktopState(paths, state)
  }
  return active
}

async function readProjectFolders(paths) {
  const state = await readDesktopState(paths)
  const folders = []
  const pushFolder = (value) => {
    const normalized = normalizeProjectPath(paths, typeof value === 'string' ? value : value?.path)
    if (!normalized) return
    if (folders.some((folder) => sameResolvedPath(folder.path, normalized))) return
    folders.push(projectFolderFromPath(normalized))
  }
  pushFolder(defaultProjectFolder(paths).path)
  for (const item of Array.isArray(state.projectFolders) ? state.projectFolders : []) {
    pushFolder(item)
  }
  if (state.projectFolderPath) pushFolder(state.projectFolderPath)
  if (state.activeProjectFolderPath) pushFolder(state.activeProjectFolderPath)
  for (const folder of folders) {
    await fsp.mkdir(folder.path, { recursive: true })
  }
  const requested = normalizeProjectPath(paths, state.activeProjectFolderPath || state.projectFolderPath || '')
  const active = (requested ? folders.find((folder) => sameResolvedPath(folder.path, requested)) : undefined) || folders[0]
  const normalizedState = {
    ...state,
    projectFolders: folders,
    activeProjectFolderPath: active.path,
  }
  delete normalizedState.projectFolderPath
  await writeDesktopState(paths, normalizedState)
  return folders
}

async function saveProjectFolder(paths, folder, options = {}) {
  await fsp.mkdir(folder.path, { recursive: true })
  const state = await readDesktopState(paths)
  const folders = await readProjectFolders(paths)
  if (!folders.some((item) => sameResolvedPath(item.path, folder.path))) {
    folders.push(projectFolderFromPath(folder.path))
  }
  state.projectFolders = folders
  if (options.select) state.activeProjectFolderPath = projectFolderFromPath(folder.path).path
  else state.activeProjectFolderPath = normalizeProjectPath(paths, state.activeProjectFolderPath || '') || defaultProjectFolder(paths).path
  delete state.projectFolderPath
  await writeDesktopState(paths, state)
  return projectFolderFromPath(options.select ? state.activeProjectFolderPath : folder.path)
}

async function replaceProjectFolder(paths, previousPath, folder) {
  await fsp.mkdir(folder.path, { recursive: true })
  await fsp.mkdir(defaultProjectFolder(paths).path, { recursive: true })
  const state = await readDesktopState(paths)
  const folders = (await readProjectFolders(paths)).map((item) => sameResolvedPath(item.path, previousPath) ? projectFolderFromPath(folder.path) : item)
  if (!folders.some((item) => sameResolvedPath(item.path, folder.path))) {
    folders.push(projectFolderFromPath(folder.path))
  }
  state.projectFolders = dedupeProjectFolders(paths, folders)
  state.activeProjectFolderPath = projectFolderFromPath(folder.path).path
  delete state.projectFolderPath
  await writeDesktopState(paths, state)
  return projectFolderFromPath(folder.path)
}

async function removeProjectFolderFromState(paths, folderPath) {
  const state = await readDesktopState(paths)
  const defaultFolder = defaultProjectFolder(paths)
  const folders = (await readProjectFolders(paths)).filter((folder) => sameResolvedPath(folder.path, defaultFolder.path) || !sameResolvedPath(folder.path, folderPath))
  state.projectFolders = dedupeProjectFolders(paths, folders)
  state.activeProjectFolderPath = defaultFolder.path
  delete state.projectFolderPath
  await writeDesktopState(paths, state)
  return defaultFolder
}

async function addConnectionProjectFolders(paths, connections) {
  const buyerPaths = []
  for (const connection of Array.isArray(connections) ? connections : []) {
    const role = String(connection?.role || 'buyer').trim().toLowerCase()
    const projectPath = normalizeProjectPath(paths, connection?.projectPath || '')
    if (role !== 'buyer' || !projectPath) continue
    buyerPaths.push(projectPath)
  }
  if (!buyerPaths.length) return
  const state = await readDesktopState(paths)
  const folders = await readProjectFolders(paths)
  for (const projectPath of buyerPaths) {
    if (!folders.some((folder) => sameResolvedPath(folder.path, projectPath))) {
      await fsp.mkdir(projectPath, { recursive: true })
      folders.push(projectFolderFromPath(projectPath))
    }
  }
  state.projectFolders = dedupeProjectFolders(paths, folders)
  state.activeProjectFolderPath = normalizeProjectPath(paths, state.activeProjectFolderPath || '') || defaultProjectFolder(paths).path
  delete state.projectFolderPath
  await writeDesktopState(paths, state)
}

async function addActivityProjectFolders(paths, ...groups) {
  const activityPaths = []
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const projectPath = normalizeProjectPath(paths, item?.projectPath || item?.task?.projectPath || '')
      if (projectPath) activityPaths.push(projectPath)
    }
  }
  if (!activityPaths.length) return
  const state = await readDesktopState(paths)
  const folders = await readProjectFolders(paths)
  for (const projectPath of activityPaths) {
    if (!folders.some((folder) => sameResolvedPath(folder.path, projectPath))) {
      await fsp.mkdir(projectPath, { recursive: true })
      folders.push(projectFolderFromPath(projectPath))
    }
  }
  state.projectFolders = dedupeProjectFolders(paths, folders)
  state.activeProjectFolderPath = normalizeProjectPath(paths, state.activeProjectFolderPath || '') || defaultProjectFolder(paths).path
  delete state.projectFolderPath
  await writeDesktopState(paths, state)
}

async function activeWorkMCPLeases(paths) {
  const state = await readDesktopState(paths)
  const leases = Array.isArray(state.workMcpLeases) ? state.workMcpLeases : []
  const nowMs = Date.now()
  let changed = false
  const stored = []
  const active = []
  for (const item of leases) {
    const lease = normalizeWorkMCPLease(paths, item)
    if (!lease) {
      stored.push(item)
      continue
    }
    if (lease.status === 'active' && lease.expiresAt && Date.parse(lease.expiresAt) <= nowMs) {
      lease.status = 'expired'
      lease.updatedAt = new Date(nowMs).toISOString()
      changed = true
    }
    stored.push(lease)
    if (workMCPLeaseIsActive(lease, nowMs)) active.push(lease)
  }
  if (changed || stored.length > WORK_MCP_LEASE_LIMIT) {
    state.workMcpLeases = stored.slice(0, WORK_MCP_LEASE_LIMIT)
    await writeDesktopState(paths, state)
  }
  return active.sort((a, b) => leaseTimeValue(b) - leaseTimeValue(a))
}

function normalizeWorkMCPLease(paths, item) {
  const lease = objectOr(item)
  const workUid = String(lease.workUid || lease.uid || '').trim()
  const projectPath = normalizeProjectPath(paths, lease.projectPath || '')
  if (!workUid || !projectPath) return undefined
  return {
    ...lease,
    workUid,
    projectPath,
    projectName: String(lease.projectName || '').trim() || path.basename(projectPath),
    controller: String(lease.controller || 'external-mcp').trim(),
    status: String(lease.status || 'active').trim(),
  }
}

function workMCPLeaseIsActive(lease, nowMs = Date.now()) {
  if (!lease || lease.status !== 'active') return false
  const expiresAt = Date.parse(lease.expiresAt || '')
  return Number.isFinite(expiresAt) && expiresAt > nowMs
}

function leaseTimeValue(lease) {
  const parsed = Date.parse(lease?.lastSeenAt || lease?.updatedAt || lease?.startedAt || '')
  return Number.isFinite(parsed) ? parsed : 0
}

function dedupeProjectFolders(paths, folders) {
  const out = []
  const push = (folder) => {
    const normalized = normalizeProjectPath(paths, folder?.path || '')
    if (!normalized || out.some((item) => sameResolvedPath(item.path, normalized))) return
    out.push(projectFolderFromPath(normalized))
  }
  push(defaultProjectFolder(paths))
  for (const folder of folders) push(folder)
  return out
}

function normalizeProjectPath(paths, value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = isDefaultJobsRoot(paths, raw) ? defaultProjectFolder(paths).path : raw
  return path.resolve(normalized)
}

async function providerWorkspaceDirFromConfig(paths) {
  try {
    const raw = await fsp.readFile(paths.configPath, 'utf8')
    const value = YAML.parse(raw) || {}
    return String(value?.provider?.workspace_dir || '').trim()
  } catch {
    return ''
  }
}

async function writeProviderWorkspaceDir(paths, workspaceDir) {
  const raw = fs.existsSync(paths.configPath) ? await fsp.readFile(paths.configPath, 'utf8') : defaultLocalConfig(paths)
  let value
  try {
    value = YAML.parse(raw) || {}
  } catch {
    value = {}
  }
  if (typeof value !== 'object' || Array.isArray(value)) value = {}
  value.provider = objectOr(value.provider)
  value.provider.workspace_dir = workspaceDir
  await fsp.mkdir(paths.rootDir, { recursive: true })
  await fsp.writeFile(paths.configPath, ensureTrailingNewline(YAML.stringify(value)))
}

function isDefaultJobsRoot(paths, value) {
  if (!String(value || '').trim()) return true
  return path.resolve(String(value)) === path.resolve(defaultJobsRoot(paths))
}

async function readDesktopState(paths) {
  try {
    const raw = await fsp.readFile(paths.desktopStatePath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function writeDesktopState(paths, value) {
  await fsp.mkdir(paths.rootDir, { recursive: true })
  await fsp.writeFile(paths.desktopStatePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function ensurePersistenceLayout(paths) {
  await Promise.all([
    fsp.mkdir(path.dirname(paths.appSettingsPath), { recursive: true }),
    fsp.mkdir(paths.conversationsDir, { recursive: true }),
    fsp.mkdir(paths.conversationArchivesDir, { recursive: true }),
    fsp.mkdir(path.dirname(paths.transactionsPath), { recursive: true }),
  ])
}

async function readJsonOr(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await fsp.rename(tmp, file)
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined)
  }
}

async function cloud_transactions() {
  const paths = await dockPaths()
  return httpJson('GET', '/v1/cloud/transactions', undefined, await localOwnerToken(paths), { timeoutMs: 5000 })
}

async function readConversationRecords(paths) {
  await fsp.mkdir(paths.conversationsDir, { recursive: true })
  const entries = await fsp.readdir(paths.conversationsDir, { withFileTypes: true }).catch(() => [])
  const records = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const filePath = path.join(paths.conversationsDir, entry.name)
    const record = await readJsonOr(filePath, undefined)
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue
    if (!record.thread || typeof record.thread !== 'object') continue
    records.push({ ...record, path: filePath })
  }
  return records.sort((left, right) => {
    const a = Number(left?.thread?.updatedAt || left?.thread?.createdAt || 0)
    const b = Number(right?.thread?.updatedAt || right?.thread?.createdAt || 0)
    return b - a
  })
}

function conversationRecordFromThread(thread) {
  const normalized = normalizeConversationThread(thread)
  if (!normalized || !normalized.messages.length) return undefined
  const storageKey = conversationStorageKey(normalized)
  return {
    version: 1,
    storageKey,
    savedAt: new Date().toISOString(),
    thread: normalized,
    messageCount: normalized.messages.length,
    taskIds: normalized.taskIds,
    orderId: normalized.orderId || '',
    projectPath: normalized.projectPath || '',
  }
}

function normalizeConversationThread(thread) {
  const value = objectOr(thread)
  const id = String(value.id || '').trim()
  if (!id) return undefined
  const messages = Array.isArray(value.messages)
    ? value.messages.map(normalizeConversationMessage).filter(Boolean)
    : []
  const taskIds = Array.isArray(value.taskIds) ? value.taskIds.map((item) => String(item || '').trim()).filter(Boolean) : []
  const participants = Array.isArray(value.participants)
    ? value.participants.map((item) => String(item || '').trim()).filter((item) => ['buyer_agent', 'seller_agent', 'buyer_human', 'seller_human'].includes(item))
    : []
  const now = Date.now()
  return {
    id,
    title: String(value.title || 'New chat').trim() || 'New chat',
    messages,
    createdAt: finiteTimestamp(value.createdAt, now),
    updatedAt: finiteTimestamp(value.updatedAt, finiteTimestamp(value.createdAt, now)),
    projectPath: String(value.projectPath || '').trim() || undefined,
    origin: value.origin === 'market-card' ? 'market-card' : undefined,
    side: value.side === 'seller' ? 'seller' : value.side === 'buyer' ? 'buyer' : undefined,
    orderId: String(value.orderId || '').trim() || undefined,
    taskIds,
    status: String(value.status || '').trim() || undefined,
    participants: participants.length ? participants : undefined,
    providerPubkey: String(value.providerPubkey || '').trim() || undefined,
    agentSessionId: String(value.agentSessionId || '').trim() || undefined,
    agentDriverId: String(value.agentDriverId || '').trim() || undefined,
    agentEventCursor: Math.max(0, Number(value.agentEventCursor || 0) || 0),
    pendingBuyerQuestion: value.pendingBuyerQuestion && typeof value.pendingBuyerQuestion === 'object' && !Array.isArray(value.pendingBuyerQuestion)
      ? value.pendingBuyerQuestion
      : undefined,
    buyerPlanReview: value.buyerPlanReview && typeof value.buyerPlanReview === 'object' && !Array.isArray(value.buyerPlanReview)
      ? value.buyerPlanReview
      : undefined,
    buyerPlanReviewStatus: value.buyerPlanReviewStatus === 'confirmed'
      ? 'confirmed'
      : value.buyerPlanReview ? 'pending' : undefined,
  }
}

function normalizeConversationMessage(message) {
  const value = objectOr(message)
  const id = String(value.id || '').trim()
  const role = ['assistant', 'user', 'system'].includes(value.role) ? value.role : ''
  if (!id || !role) return undefined
  const actor = ['buyer_agent', 'seller_agent', 'buyer_human', 'seller_human'].includes(value.actor) ? value.actor : undefined
  return {
    id,
    kind: value.kind === 'order_event' ? 'order_event' : value.kind === 'message' ? 'message' : undefined,
    role,
    actor,
    text: String(value.text || ''),
    meta: String(value.meta || '').trim() || undefined,
    providerPubkey: String(value.providerPubkey || '').trim() || undefined,
    eventRef: value.eventRef && typeof value.eventRef === 'object' && !Array.isArray(value.eventRef) ? objectOr(value.eventRef) : undefined,
    result: value.result && typeof value.result === 'object' && !Array.isArray(value.result) ? value.result : undefined,
    pending: value.pending === true,
  }
}

function finiteTimestamp(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function conversationStorageKey(thread) {
  const taskId = Array.isArray(thread.taskIds) ? thread.taskIds.map((item) => String(item || '').trim()).find(Boolean) : ''
  if (taskId) return `task:${taskId}`
  const orderId = String(thread.orderId || '').trim()
  if (orderId) return `order:${orderId}`
  return `chat:${String(thread.id || '').trim()}`
}

function conversationPathForStorageKey(paths, storageKey) {
  return path.join(paths.conversationsDir, conversationFileName(storageKey))
}

function conversationFileName(storageKey) {
  const hash = crypto.createHash('sha1').update(String(storageKey)).digest('hex').slice(0, 10)
  const slug = safeFileSlug(storageKey, 72)
  return `${slug}-${hash}.json`
}

function safeFileSlug(value, limit = 72) {
  const slug = String(value || 'conversation')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, limit)
  return slug || 'conversation'
}

async function removePreviousConversationFiles(paths, currentStorageKey, previousStorageKeys) {
  const previous = new Set(previousStorageKeys.filter((item) => item && item !== currentStorageKey))
  for (const storageKey of previous) {
    await fsp.rm(conversationPathForStorageKey(paths, storageKey), { force: true }).catch(() => {})
  }
}

async function archiveConversationFiles(paths, threads, archivedAt, extraStorageKeys = []) {
  const stamp = archiveFileStamp(archivedAt)
  const archiveDir = path.join(paths.conversationArchivesDir, stamp)
  await fsp.mkdir(archiveDir, { recursive: true })
  const storageKeys = new Set(extraStorageKeys)
  for (const thread of threads) {
    const normalized = normalizeConversationThread(thread)
    if (normalized) storageKeys.add(conversationStorageKey(normalized))
  }
  for (const storageKey of storageKeys) {
    const source = conversationPathForStorageKey(paths, storageKey)
    const target = path.join(archiveDir, conversationFileName(storageKey))
    await fsp.rm(target, { force: true }).catch(() => {})
    await fsp.rename(source, target).catch(() => {})
  }
  return archiveDir
}

async function ensureLocalLayout(paths) {
  await fsp.mkdir(paths.dataDir, { recursive: true })
  await fsp.mkdir(paths.logsDir, { recursive: true })
  await fsp.mkdir(defaultProjectFolder(paths).path, { recursive: true })
  if (!fs.existsSync(paths.configPath)) {
    await fsp.writeFile(paths.configPath, defaultLocalConfig(paths))
  } else {
    await migrateLocalConfig(paths)
  }
}

async function migrateLocalConfig(paths) {
  const raw = await fsp.readFile(paths.configPath, 'utf8')
  let value
  try {
    value = YAML.parse(raw) || {}
  } catch {
    return
  }
  if (typeof value !== 'object' || Array.isArray(value)) return

  let changed = false
  if (isLegacyContainerPath(value.data_dir, '/var/lib/exora-dock')) {
    value.data_dir = paths.dataDir
    changed = true
  }
  if (isLegacyContainerPath(value.wallet_path, '/var/lib/exora-dock/wallet')) {
    value.wallet_path = path.join(paths.dataDir, 'wallet')
    changed = true
  }
  if (!String(value.listen_addr || '').trim() || String(value.listen_addr).trim() === ':8080') {
    value.listen_addr = '127.0.0.1:8080'
    changed = true
  }
  value.provider = objectOr(value.provider)
  if (!sameResolvedPath(String(value.provider.workspace_dir || '').trim() || defaultJobsRoot(paths), defaultProjectFolder(paths).path)) {
    value.provider.workspace_dir = defaultProjectFolder(paths).path
    changed = true
  }
  if (changed) await fsp.writeFile(paths.configPath, ensureTrailingNewline(YAML.stringify(value)))
}

function isLegacyContainerPath(value, legacy) {
  const normalized = String(value || '').trim().replace(/\\/g, '/')
  return normalized === '' || normalized === legacy
}

async function writeDiscoveryManifest(paths) {
  const startCommand = [paths.helperPath, paths.configPath]
  const manifest = discoveryManifestJson(BASE_URL, paths.helperPath, paths.configPath, startCommand)
  await fsp.mkdir(paths.rootDir, { recursive: true })
  await fsp.writeFile(paths.discoveryPath, manifest)
}

function resolveHelperPath() {
  if (process.env.EXORA_DOCKD_PATH) return process.env.EXORA_DOCKD_PATH
  const name = process.platform === 'win32' ? 'exora-dockd.exe' : 'exora-dockd'
  const candidates = []
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, 'binaries', name))
  candidates.push(path.join(app.getAppPath(), 'binaries', name))
  candidates.push(path.join(__dirname, '..', 'binaries', name))
  if (process.platform === 'win32') candidates.push(path.join(__dirname, '..', '..', 'exora-dock.exe'))
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  return found || candidates[0] || name
}

function appDataRoot() {
  if (process.env.EXORA_DOCK_HOME) return process.env.EXORA_DOCK_HOME
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'ExoraDock')
  }
  if (process.env.HOME) return path.join(process.env.HOME, '.exora-dock')
  throw new Error('Cannot resolve local app data directory')
}

function readStartupLanguageSync() {
  const envLanguage = process.env.EXORA_DOCK_LANGUAGE || process.env.EXORA_LANGUAGE
  if (envLanguage) return normalizeAppLanguage(envLanguage)
  try {
    const settingsPath = path.join(app.getPath('userData'), PERSISTENCE_DIR_NAME, 'settings', 'settings.json')
    const raw = fs.readFileSync(settingsPath, 'utf8')
    const value = JSON.parse(raw)
    return normalizeAppLanguage(value?.settings?.language || value?.language)
  } catch {
    return 'en'
  }
}

async function readPersistedLanguage(paths) {
  const value = objectOr(await readJsonOr(paths.appSettingsPath, {}))
  return normalizeAppLanguage(value?.settings?.language || value?.language || STARTUP_LANGUAGE)
}

function normalizeAppLanguage(value) {
  const text = String(value || '').trim().toLowerCase()
  return text === 'zh' || text.startsWith('zh-') || text.startsWith('zh_') ? 'zh' : 'en'
}

function chromiumLocaleForLanguage(language) {
  return normalizeAppLanguage(language) === 'zh' ? 'zh-CN' : 'en-US'
}

function htmlLangForLanguage(language) {
  return normalizeAppLanguage(language) === 'zh' ? 'zh-CN' : 'en'
}

async function startNativeDaemon(paths) {
  await fsp.mkdir(paths.logsDir, { recursive: true })
  const logPath = path.join(paths.logsDir, DAEMON_LOG_NAME)
  let out
  try {
    out = fs.openSync(logPath, 'a')
    const child = spawn(paths.helperPath, [paths.configPath], {
      cwd: paths.rootDir,
      env: { ...process.env, EXORA_DOCK_DISCOVERY_PATH: paths.discoveryPath },
      detached: false,
      stdio: ['ignore', out, out],
      windowsHide: true,
    })
    child.unref()
    await fsp.writeFile(paths.pidPath, `${child.pid}\n`)
  } finally {
    if (out !== undefined) fs.closeSync(out)
  }
}

async function stopTrackedDaemon(paths) {
  const pid = await readDaemonPid(paths)
  if (!pid) return
  if (await daemonProcessRunning(pid)) {
    await terminateProcess(pid)
    for (let i = 0; i < 20; i += 1) {
      if (!(await daemonProcessRunning(pid))) break
      await sleep(100)
    }
  }
  await fsp.rm(paths.pidPath, { force: true })
}

async function trackedDaemonRunning(paths) {
  const pid = await readDaemonPid(paths)
  if (!pid) return false
  if (await daemonProcessRunning(pid)) return true
  await fsp.rm(paths.pidPath, { force: true })
  return false
}

async function readDaemonPid(paths) {
  try {
    const raw = await fsp.readFile(paths.pidPath, 'utf8')
    const pid = Number.parseInt(raw.trim(), 10)
    return Number.isFinite(pid) ? pid : undefined
  } catch {
    return undefined
  }
}

async function daemonProcessRunning(pid) {
  if (process.platform === 'win32') {
    try {
      const output = await runCommand('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
      const lower = output.toLowerCase()
      return lower.includes(String(pid)) && lower.includes('exora-dock')
    } catch {
      return false
    }
  }
  try {
    await runCommand('kill', ['-0', String(pid)])
    return true
  } catch {
    return false
  }
}

async function terminateProcess(pid) {
  if (process.platform === 'win32') {
    await runCommand('taskkill', ['/PID', String(pid), '/T', '/F'])
  } else {
    await runCommand('kill', [String(pid)])
  }
}

function runCommand(program, args) {
  return new Promise((resolve, reject) => {
    execFile(program, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (!error) {
        resolve(String(stdout || '').trim())
        return
      }
      const detail = String(stderr || stdout || error.message || '').trim()
      reject(new Error(detail || `${program} exited with ${error.code ?? 'an error'}`))
    })
  })
}

async function healthOk() {
  try {
    const response = await fetchWithTimeout(`${BASE_URL}/health`, { method: 'GET' }, 700)
    return response.ok
  } catch {
    return false
  }
}

function mcpCommandString(helperPath, configPath) {
  return [quoteCommandArg(helperPath), 'mcp', quoteCommandArg(configPath)].join(' ')
}

function agentPrompt() {
  return 'Find my local Exora Dock by reading the local ExoraDock agent-discovery.json, start the stdio MCP server from mcpCommand, then use its Exora tools instead of guessing HTTP endpoints. MCP is the external local-agent channel; use baseUrl REST only as fallback. For a specific transaction, use the prompt copied from Buyer/Seller so you also receive a workUid.'
}

function opencodeConfigString(helperPath, configPath) {
  return JSON.stringify(opencodeConfigValue(helperPath, configPath), null, 2)
}

function opencodeConfigValue(helperPath, configPath) {
  return {
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      exora: {
        type: 'local',
        command: [helperPath, 'mcp', configPath],
        enabled: true,
      },
    },
  }
}

async function sellerSettingsFromConfig(paths) {
  const raw = await readTextOr(paths.configPath, defaultLocalConfig(paths))
  return sellerSettingsFromYaml(raw)
}

function sellerSettingsFromYaml(raw) {
  const value = YAML.parse(raw) || {}
  const seller = objectOr(value.seller_agent)
  const provider = objectOr(value.provider)
  const docker = objectOr(provider.docker)
  const sellerLLM = roleLLMSettingsFromYaml(value, 'seller_llm')
  const apiKey = sellerLLM.apiKey
  const llmBaseUrl = sellerLLM.llmBaseUrl
  const providerPreset = sellerLLM.providerPreset
  const requiresApiKey = providerRequiresApiKey(providerPreset, llmBaseUrl)
  return {
    enabled: boolAt(seller, 'enabled', false),
    autoQuote: boolAt(seller, 'auto_quote', true),
    quotePublishMode: stringAt(seller,'quote_publish_mode',boolAt(seller,'auto_quote',true)?'auto':'manual_review'),
    autoAcceptLowRisk: boolAt(seller, 'auto_accept_low_risk', boolAt(seller, 'auto_complete_text_tasks', false)),
    autoCompleteTextTasks: boolAt(seller, 'auto_complete_text_tasks', false),
    llmBaseUrl,
    hasApiKey: apiKey !== '' || !requiresApiKey,
    keyFormat: apiKey === '' && !requiresApiKey ? 'not_required' : apiKeyFormat(apiKey),
    providerPreset,
    wireApi: sellerLLM.wireApi,
    capabilities: sellerLLM.capabilities,
    researchModel: sellerLLM.researchModel,
    researchReasoningEffort: sellerLLM.researchReasoningEffort,
    utilityModel: sellerLLM.utilityModel,
    utilityReasoningEffort: sellerLLM.utilityReasoningEffort,
    disableResponseStorage: sellerLLM.disableResponseStorage,
    providerId: stringAt(seller, 'provider_pubkey', 'local-dev-miner'),
    quotePrice: numberAt(seller, 'default_quote_price', 0),
    currency: stringAt(seller, 'default_quote_currency', 'USDC'),
    estimatedSeconds: integerAt(seller, 'default_estimated_seconds', 60),
    dockerEnabled: boolAt(docker, 'enabled', false),
    dockerDefaultImage: stringAt(docker, 'default_image', ''),
    dockerAllowedImages: arrayAt(docker, 'allowed_images'),
    dockerNetworkMode: stringAt(docker, 'network_mode', 'none'),
    dockerAllowedNetworkModes: arrayAt(docker, 'allowed_network_modes', ['none']),
    dockerAllowGpu: boolAt(docker, 'allow_gpu', false),
    dockerMaxCpus: numberAt(docker, 'max_cpus', 0),
    dockerMaxMemoryMb: integerAt(docker, 'max_memory_mb', 0),
    dockerPullPolicy: stringAt(docker, 'pull_policy', 'missing'),
  }
}

async function ensureLLMProfiles(paths) {
  const state = await readDesktopState(paths)
  const profiles = Array.isArray(state.llmProfiles) ? state.llmProfiles.map(normalizeStoredLLMProfile).filter(Boolean) : []
  if (!profiles.length) {
    const raw = await readTextOr(paths.configPath, defaultLocalConfig(paths))
    profiles.push(...llmProfilesFromYaml(raw))
  }
  state.llmProfiles = profiles
  const profileIds = new Set(profiles.map((profile) => profile.id))
  if (!state.llmProfileRoleDefaultsInitialized) {
    const fallbackBuyer = profileIds.has('default-buyer-api')
      ? 'default-buyer-api'
      : profileIds.has('default-api')
        ? 'default-api'
        : profiles[0]?.id || ''
    const fallbackSeller = profileIds.has('default-seller-api')
      ? 'default-seller-api'
      : profileIds.has('default-api')
        ? 'default-api'
        : fallbackBuyer
    state.buyerLLMProfileId = state.buyerLLMProfileId || fallbackBuyer
    state.sellerLLMProfileId = state.sellerLLMProfileId || fallbackSeller
    state.llmProfileRoleDefaultsInitialized = true
  }
  if (state.buyerLLMProfileId && !profileIds.has(state.buyerLLMProfileId)) state.buyerLLMProfileId = ''
  if (state.sellerLLMProfileId && !profileIds.has(state.sellerLLMProfileId)) state.sellerLLMProfileId = ''
  if (!profileIds.has(state.activeLLMProfileId)) state.activeLLMProfileId = state.sellerLLMProfileId || state.buyerLLMProfileId || profiles[0]?.id || ''
  await writeDesktopState(paths, state)
}

async function llmProfileStatus(paths) {
  await ensureLLMProfiles(paths)
  const state = await readDesktopState(paths)
  const profiles = Array.isArray(state.llmProfiles) ? state.llmProfiles.map(normalizeStoredLLMProfile).filter(Boolean) : []
  return {
    profiles: profiles.map((profile) => profileForRenderer(profile, state)),
    activeProfileId: state.activeLLMProfileId || profiles[0]?.id || '',
    buyerProfileId: state.buyerLLMProfileId || '',
    sellerProfileId: state.sellerLLMProfileId || '',
    keyStorageAvailable: safeStorage.isEncryptionAvailable(),
  }
}

function topLevelLLMSettingsFromYaml(value) {
  const legacyModel = stringAt(value, 'llm_model', 'gpt-5.5')
  const llmBaseUrl = stringAt(value, 'llm_base_url', 'https://api.openai.com/v1')
  const providerPreset = normalizeProviderPreset(stringAt(value, 'llm_provider_preset', inferProviderPreset(llmBaseUrl)))
  const wireApi = normalizeWireApi(stringAt(value, 'llm_wire_api', defaultWireForPreset(providerPreset)))
  return {
    llmBaseUrl,
    apiKey: stringAt(value, 'llm_api_key', ''),
    providerPreset,
    wireApi,
    capabilities: llmCapabilitiesFromYaml(value),
    researchModel: stringAt(value, 'llm_research_model', legacyModel),
    researchReasoningEffort: stringAt(value, 'llm_research_reasoning_effort', 'high'),
    utilityModel: stringAt(value, 'llm_utility_model', legacyModel),
    utilityReasoningEffort: stringAt(value, 'llm_utility_reasoning_effort', 'low'),
    disableResponseStorage: boolAt(value, 'llm_disable_response_storage', true),
  }
}

function roleLLMSettingsFromYaml(value, key) {
  const fallback = topLevelLLMSettingsFromYaml(value)
  const role = objectOr(value[key])
  if (!roleLLMBlockConfigured(role)) return fallback
  const llmBaseUrl = stringAt(role, 'base_url', fallback.llmBaseUrl)
  const providerPreset = normalizeProviderPreset(stringAt(role, 'provider_preset', inferProviderPreset(llmBaseUrl)))
  const wireApi = normalizeWireApi(stringAt(role, 'wire_api', defaultWireForPreset(providerPreset)))
  const legacyModel = stringAt(role, 'model', fallback.researchModel)
  const researchModel = stringAt(role, 'research_model', legacyModel)
  return {
    llmBaseUrl,
    apiKey: stringAt(role, 'api_key', ''),
    providerPreset,
    wireApi,
    capabilities: roleLLMCapabilitiesFromYaml(role, providerPreset, wireApi),
    researchModel,
    researchReasoningEffort: stringAt(role, 'research_reasoning_effort', fallback.researchReasoningEffort),
    utilityModel: stringAt(role, 'utility_model', researchModel),
    utilityReasoningEffort: stringAt(role, 'utility_reasoning_effort', fallback.utilityReasoningEffort),
    disableResponseStorage: boolAt(role, 'disable_response_storage', fallback.disableResponseStorage),
  }
}

function roleLLMBlockConfigured(role) {
  return Boolean(
    stringAt(role, 'base_url', '') ||
    stringAt(role, 'api_key', '') ||
    stringAt(role, 'provider_preset', '') ||
    stringAt(role, 'model', '') ||
    stringAt(role, 'wire_api', '') ||
    Object.keys(objectOr(role.capabilities)).length ||
    Object.keys(objectOr(role.extra_headers)).length ||
    stringAt(role, 'research_model', '') ||
    stringAt(role, 'research_reasoning_effort', '') ||
    stringAt(role, 'utility_model', '') ||
    stringAt(role, 'utility_reasoning_effort', '') ||
    role.disable_response_storage === true
  )
}

function llmProfilesFromYaml(raw) {
  const value = YAML.parse(raw) || {}
  const buyerLLM = roleLLMSettingsFromYaml(value, 'buyer_llm')
  const sellerLLM = roleLLMSettingsFromYaml(value, 'seller_llm')
  if (roleLLMBlockConfigured(objectOr(value.buyer_llm)) || roleLLMBlockConfigured(objectOr(value.seller_llm))) {
    const profiles = [
      llmProfileFromSettings('default-buyer-api', 'Buyer API', buyerLLM),
      llmProfileFromSettings('default-seller-api', 'Seller API', sellerLLM),
    ]
    return profiles.filter((profile, index) => profiles.findIndex((item) => item.llmBaseUrl === profile.llmBaseUrl && item.researchModel === profile.researchModel) === index)
  }
  return [llmProfileFromSettings('default-api', 'Default API', topLevelLLMSettingsFromYaml(value))]
}

function llmProfileFromSettings(id, name, settings) {
  const now = new Date().toISOString()
  const profile = normalizeStoredLLMProfile({
    id,
    name,
    providerPreset: settings.providerPreset,
    llmBaseUrl: settings.llmBaseUrl,
    wireApi: settings.wireApi,
    capabilities: settings.capabilities,
    researchModel: settings.researchModel,
    researchReasoningEffort: settings.researchReasoningEffort,
    utilityModel: settings.utilityModel,
    utilityReasoningEffort: settings.utilityReasoningEffort,
    disableResponseStorage: settings.disableResponseStorage,
    createdAt: now,
    updatedAt: now,
  })
  if (settings.apiKey && safeStorage.isEncryptionAvailable()) {
    profile.encryptedApiKey = safeStorage.encryptString(settings.apiKey).toString('base64')
    profile.keyStorage = 'safeStorage'
  }
  return profile
}

function normalizeStoredLLMProfile(input) {
  const profile = objectOr(input)
  const now = new Date().toISOString()
  const id = String(profile.id || '').trim()
  if (!id) return undefined
  const llmBaseUrl = String(profile.llmBaseUrl || '').trim() || 'https://api.openai.com/v1'
  const providerPreset = normalizeProviderPreset(profile.providerPreset || inferProviderPreset(llmBaseUrl))
  const researchModel = defaultIfBlank(profile.researchModel, 'gpt-5.5')
  const wireApi = normalizeWireApi(profile.wireApi || defaultWireForPreset(providerPreset))
  return {
    id,
    name: defaultIfBlank(profile.name, 'API Profile'),
    providerPreset,
    llmBaseUrl,
    wireApi,
    capabilities: Object.keys(objectOr(profile.capabilities)).length ? objectOr(profile.capabilities) : capabilitiesForWire(providerPreset, wireApi),
    researchModel,
    researchReasoningEffort: defaultIfBlank(profile.researchReasoningEffort, 'high'),
    utilityModel: defaultIfBlank(profile.utilityModel, researchModel),
    utilityReasoningEffort: defaultIfBlank(profile.utilityReasoningEffort, 'low'),
    disableResponseStorage: profile.disableResponseStorage !== false,
    encryptedApiKey: String(profile.encryptedApiKey || '').trim() || undefined,
    keyStorage: profile.keyStorage === 'safeStorage' ? 'safeStorage' : undefined,
    createdAt: String(profile.createdAt || now),
    updatedAt: String(profile.updatedAt || now),
  }
}

function profileForRenderer(profile, state = {}) {
  const hasApiKey = Boolean(profile.encryptedApiKey)
  return {
    id: profile.id,
    name: profile.name,
    providerPreset: profile.providerPreset,
    llmBaseUrl: profile.llmBaseUrl,
    wireApi: profile.wireApi,
    capabilities: profile.capabilities,
    researchModel: profile.researchModel,
    researchReasoningEffort: profile.researchReasoningEffort,
    utilityModel: profile.utilityModel,
    utilityReasoningEffort: profile.utilityReasoningEffort,
    disableResponseStorage: profile.disableResponseStorage,
    hasApiKey,
    keyFormat: hasApiKey ? apiKeyFormat(decryptLLMProfileKey(profile)) : providerRequiresApiKey(profile.providerPreset, profile.llmBaseUrl) ? 'missing' : 'not_required',
    useForBuyer: profile.id === state.buyerLLMProfileId,
    useForSeller: profile.id === state.sellerLLMProfileId,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

function decryptLLMProfileKey(profile) {
  if (!profile?.encryptedApiKey) return ''
  if (profile.keyStorage !== 'safeStorage' || !safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(profile.encryptedApiKey, 'base64'))
  } catch {
    return ''
  }
}

function llmProfileToSellerInput(profile, current, apiKey) {
  return {
    ...current,
    llmBaseUrl: profile.llmBaseUrl,
    apiKey,
    clearApiKey: !apiKey,
    providerPreset: profile.providerPreset,
    wireApi: profile.wireApi,
    capabilities: profile.capabilities,
    researchModel: profile.researchModel,
    researchReasoningEffort: profile.researchReasoningEffort,
    utilityModel: profile.utilityModel,
    utilityReasoningEffort: profile.utilityReasoningEffort,
    disableResponseStorage: profile.disableResponseStorage,
  }
}

function updateRoleLLMSettingsYaml(raw, profile, apiKey, roles, previousRoles = {}) {
  const value = objectOr(YAML.parse(raw) || {})
  if (roles.buyer) value.buyer_llm = llmProfileYamlBlock(profile, apiKey)
  else if (previousRoles.buyer) delete value.buyer_llm
  if (roles.seller) value.seller_llm = llmProfileYamlBlock(profile, apiKey)
  else if (previousRoles.seller) delete value.seller_llm
  if (roles.buyer || roles.seller) writeTopLevelLLMFields(value, profile, apiKey)
  return ensureTrailingNewline(YAML.stringify(value))
}

function llmProfileYamlBlock(profile, apiKey) {
  return {
    base_url: String(profile.llmBaseUrl || '').trim(),
    api_key: String(apiKey || '').trim(),
    provider_preset: normalizeProviderPreset(profile.providerPreset || inferProviderPreset(profile.llmBaseUrl)),
    model: defaultIfBlank(profile.researchModel, 'gpt-5.5'),
    wire_api: normalizeWireApi(profile.wireApi || defaultWireForPreset(profile.providerPreset)),
    capabilities: capabilitiesToYaml(profile.capabilities || capabilitiesForWire(profile.providerPreset, profile.wireApi)),
    research_model: defaultIfBlank(profile.researchModel, 'gpt-5.5'),
    research_reasoning_effort: defaultIfBlank(profile.researchReasoningEffort, 'high'),
    utility_model: defaultIfBlank(profile.utilityModel, profile.researchModel || 'gpt-5.5'),
    utility_reasoning_effort: defaultIfBlank(profile.utilityReasoningEffort, 'low'),
    disable_response_storage: profile.disableResponseStorage !== false,
  }
}

function writeTopLevelLLMFields(value, profile, apiKey) {
  const block = llmProfileYamlBlock(profile, apiKey)
  value.llm_base_url = block.base_url
  value.llm_api_key = block.api_key
  value.llm_provider_preset = block.provider_preset
  value.llm_wire_api = block.wire_api
  value.llm_capabilities = block.capabilities
  value.llm_research_model = block.research_model
  value.llm_research_reasoning_effort = block.research_reasoning_effort
  value.llm_utility_model = block.utility_model
  value.llm_utility_reasoning_effort = block.utility_reasoning_effort
  value.llm_disable_response_storage = block.disable_response_storage
  value.llm_model = block.research_model
}

function llmProfileRolesFromInput(input) {
  const hasBuyer = Object.prototype.hasOwnProperty.call(input, 'useForBuyer')
  const hasSeller = Object.prototype.hasOwnProperty.call(input, 'useForSeller')
  let buyer = hasBuyer ? Boolean(input.useForBuyer) : false
  let seller = hasSeller ? Boolean(input.useForSeller) : false
  if (!hasBuyer && !hasSeller) {
    buyer = true
    seller = true
  }
  return { buyer, seller }
}

function updateSellerSettingsYaml(raw, input) {
  const value = objectOr(YAML.parse(raw) || {})
  value.seller_agent = objectOr(value.seller_agent)
  value.seller_agent.enabled = Boolean(input.enabled)
  const quotePublishMode = input.quotePublishMode === 'manual_review' ? 'manual_review' : 'auto'
  value.seller_agent.quote_publish_mode = quotePublishMode
  value.seller_agent.auto_quote = quotePublishMode === 'auto'
  value.seller_agent.auto_accept_low_risk = Boolean(input.autoAcceptLowRisk ?? input.autoCompleteTextTasks)
  delete value.seller_agent.auto_complete_text_tasks
  value.seller_agent.provider_pubkey = String(input.providerId || '').trim()
  value.seller_agent.poll_interval_sec = 2
  value.seller_agent.default_quote_price = Math.max(0, Number(input.quotePrice || 0))
  value.seller_agent.default_quote_currency = defaultIfBlank(input.currency, 'USDC')
  value.seller_agent.default_estimated_seconds = Math.max(1, Math.trunc(Number(input.estimatedSeconds || 60)))
  if (sellerInputHasDockerSettings(input)) {
    value.provider = objectOr(value.provider)
    value.provider.docker = objectOr(value.provider.docker)
    value.provider.docker.enabled = Boolean(input.dockerEnabled)
    value.provider.docker.default_image = String(input.dockerDefaultImage || '').trim()
    value.provider.docker.allowed_images = csvList(input.dockerAllowedImages)
    value.provider.docker.network_mode = defaultIfBlank(input.dockerNetworkMode, 'none')
    value.provider.docker.allowed_network_modes = csvList(input.dockerAllowedNetworkModes, ['none'])
    value.provider.docker.allow_gpu = Boolean(input.dockerAllowGpu)
    value.provider.docker.max_cpus = Math.max(0, Number(input.dockerMaxCpus || 0))
    value.provider.docker.max_memory_mb = Math.max(0, Math.trunc(Number(input.dockerMaxMemoryMb || 0)))
    value.provider.docker.pull_policy = defaultIfBlank(input.dockerPullPolicy, 'missing')
  }
  return ensureTrailingNewline(YAML.stringify(value))
}

function sellerInputHasDockerSettings(input) {
  return [
    'dockerEnabled',
    'dockerDefaultImage',
    'dockerAllowedImages',
    'dockerNetworkMode',
    'dockerAllowedNetworkModes',
    'dockerAllowGpu',
    'dockerMaxCpus',
    'dockerMaxMemoryMb',
    'dockerPullPolicy',
  ].some((key) => Object.prototype.hasOwnProperty.call(input, key))
}

function apiKeyFormat(apiKey) {
  const trimmed = String(apiKey || '').trim()
  if (!trimmed) return 'missing'
  if (trimmed.startsWith('sk-')) return 'sk'
  return 'other'
}

function normalizeWireApi(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/-/g, '_')
  if (normalized === 'chat' || normalized === 'chat_completions') return 'chat_completions'
  if (normalized === 'responses') return 'responses'
  return 'responses'
}

function normalizeProviderPreset(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_')
  const aliases = {
    openai_chat_completions: 'openai_chat',
    lite_llm: 'litellm',
    litellm_proxy: 'litellm',
    lmstudio: 'lm_studio',
    'llama.cpp': 'llama_cpp',
    text_generation_webui: 'textgen',
    text_generation_web_ui: 'textgen',
    oobabooga: 'textgen',
    kobold: 'koboldcpp',
  }
  if (!normalized) return 'openai_responses'
  return aliases[normalized] || normalized
}

function inferProviderPreset(baseUrl) {
  const base = String(baseUrl || '').trim().toLowerCase()
  if (base.includes('openrouter.ai')) return 'openrouter'
  if (base.includes('api.openai.com')) return 'openai_responses'
  if (base.includes('127.0.0.1:11434') || base.includes('localhost:11434')) return 'ollama'
  if (base.includes('127.0.0.1:1234') || base.includes('localhost:1234')) return 'lm_studio'
  if (base.includes('127.0.0.1') || base.includes('localhost') || base.includes('[::1]')) return 'custom_openai_compatible'
  return 'custom_openai_compatible'
}

function defaultWireForPreset(preset) {
  return normalizeProviderPreset(preset) === 'openai_responses' ? 'responses' : 'chat_completions'
}

function providerRequiresApiKey(preset, baseUrl) {
  const normalized = normalizeProviderPreset(preset)
  const base = String(baseUrl || '').trim().toLowerCase()
  if (['openai_responses', 'openai_chat', 'openrouter'].includes(normalized)) return true
  if (['litellm', 'ollama', 'lm_studio', 'vllm', 'localai', 'llama_cpp', 'textgen', 'koboldcpp', 'custom_openai_compatible'].includes(normalized)) return false
  return !(base.includes('127.0.0.1') || base.includes('localhost') || base.includes('[::1]'))
}

function llmCapabilitiesFromYaml(value) {
  const caps = objectOr(value.llm_capabilities)
  const parsed = {
    supportsResponses: boolAt(caps, 'supports_responses', false),
    supportsChatCompletions: boolAt(caps, 'supports_chat_completions', false),
    supportsSystemMessage: boolAt(caps, 'supports_system_message', false),
    supportsJsonResponseFormat: boolAt(caps, 'supports_json_response_format', false),
    supportsStreaming: boolAt(caps, 'supports_streaming', false),
    supportsTools: boolAt(caps, 'supports_tools', false),
    supportsReasoningEffort: boolAt(caps, 'supports_reasoning_effort', false),
  }
  if (Object.values(parsed).some(Boolean)) return parsed
  return presetCapabilities(stringAt(value, 'llm_provider_preset', 'openai_responses'))
}

function roleLLMCapabilitiesFromYaml(role, preset, wire) {
  const caps = objectOr(role.capabilities)
  const parsed = {
    supportsResponses: boolAt(caps, 'supports_responses', false),
    supportsChatCompletions: boolAt(caps, 'supports_chat_completions', false),
    supportsSystemMessage: boolAt(caps, 'supports_system_message', false),
    supportsJsonResponseFormat: boolAt(caps, 'supports_json_response_format', false),
    supportsStreaming: boolAt(caps, 'supports_streaming', false),
    supportsTools: boolAt(caps, 'supports_tools', false),
    supportsReasoningEffort: boolAt(caps, 'supports_reasoning_effort', false),
  }
  if (Object.values(parsed).some(Boolean)) return parsed
  return capabilitiesForWire(preset, wire)
}

function presetCapabilities(preset) {
  const normalized = normalizeProviderPreset(preset)
  if (normalized === 'openai_responses') {
    return {
      supportsResponses: true,
      supportsChatCompletions: true,
      supportsSystemMessage: true,
      supportsJsonResponseFormat: true,
      supportsStreaming: true,
      supportsTools: true,
      supportsReasoningEffort: true,
    }
  }
  if (['openai_chat', 'openrouter', 'litellm'].includes(normalized)) {
    return {
      supportsResponses: false,
      supportsChatCompletions: true,
      supportsSystemMessage: true,
      supportsJsonResponseFormat: true,
      supportsStreaming: true,
      supportsTools: true,
      supportsReasoningEffort: false,
    }
  }
  return {
    supportsResponses: false,
    supportsChatCompletions: true,
    supportsSystemMessage: true,
    supportsJsonResponseFormat: true,
    supportsStreaming: true,
    supportsTools: false,
    supportsReasoningEffort: false,
  }
}

function capabilitiesForWire(preset, wire) {
  const caps = { ...presetCapabilities(preset) }
  if (normalizeWireApi(wire) === 'responses') {
    caps.supportsResponses = true
    caps.supportsChatCompletions = true
    caps.supportsSystemMessage = true
    caps.supportsJsonResponseFormat = true
    caps.supportsStreaming = true
    caps.supportsTools = true
    caps.supportsReasoningEffort = true
    return caps
  }
  caps.supportsResponses = false
  caps.supportsChatCompletions = true
  caps.supportsReasoningEffort = false
  return caps
}

function capabilitiesToYaml(caps) {
  return {
    supports_responses: capValue(caps, 'supportsResponses'),
    supports_chat_completions: capValue(caps, 'supportsChatCompletions'),
    supports_system_message: capValue(caps, 'supportsSystemMessage'),
    supports_json_response_format: capValue(caps, 'supportsJsonResponseFormat'),
    supports_streaming: capValue(caps, 'supportsStreaming'),
    supports_tools: capValue(caps, 'supportsTools'),
    supports_reasoning_effort: capValue(caps, 'supportsReasoningEffort'),
  }
}

function capValue(caps, key) {
  return Boolean(caps && caps[key])
}

function defaultIfBlank(value, fallback) {
  const trimmed = String(value || '').trim()
  return trimmed || fallback
}

function defaultLLMProfileName(input) {
  const baseUrl = String(input.llmBaseUrl || '').trim()
  const model = String(input.researchModel || input.utilityModel || '').trim()
  let host = 'API'
  try {
    host = new URL(baseUrl).host || host
  } catch {
    host = baseUrl.replace(/^https?:\/\//, '').split('/')[0] || host
  }
  return [host, model].filter(Boolean).join(' / ') || 'API Profile'
}

function uniqueLLMProfileName(name, profiles, currentId) {
  const requested = defaultIfBlank(name, 'API Profile')
  const current = String(currentId || '').trim()
  const existingNames = new Set(
    asArray(profiles)
      .filter((profile) => String(profile?.id || '').trim() !== current)
      .map((profile) => String(profile?.name || '').trim().toLowerCase())
      .filter(Boolean),
  )
  if (!existingNames.has(requested.toLowerCase())) return requested

  const numbered = requested.match(/^(.*?)\s+(\d+)$/)
  const numberedBase = numbered?.[1]?.trim()
  const base = numberedBase && existingNames.has(numberedBase.toLowerCase()) ? numberedBase : requested
  let index = numberedBase && base === numberedBase ? Math.max(2, Number(numbered[2]) + 1) : 2
  let candidate = `${base} ${index}`
  while (existingNames.has(candidate.toLowerCase())) {
    index += 1
    candidate = `${base} ${index}`
  }
  return candidate
}

function uniqueList(values) {
  return [...new Set(values.filter(Boolean))]
}

function quoteCommandArg(value) {
  const text = String(value)
  return /[\s\t"]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text
}

function discoveryManifestJson(baseUrl, helperPath, configPath, startCommand) {
  return JSON.stringify({
    schema: 'https://exora.dev/schemas/dock-agent-manifest.v1.json',
    protocolVersion: 'exora-dock-discovery/v1',
    name: 'Exora Dock',
    kind: process.platform === 'win32' ? 'windows-local-capability-dock' : 'native-local-capability-dock',
    dockId: 'exora-dock-local',
    baseUrl,
    healthUrl: `${baseUrl}/health`,
    manifestUrl: `${baseUrl}/.well-known/exora-dock.json`,
    processId: process.pid,
    executablePath: helperPath,
    configPath,
    startCommand,
    mcpCommand: [helperPath, 'mcp', configPath],
    agentPrompt: agentPrompt(),
    opencodeConfig: opencodeConfigValue(helperPath, configPath),
    restFallback: {
      baseUrl,
      health: `${baseUrl}/health`,
      manifest: `${baseUrl}/.well-known/exora-dock.json`,
    },
    capabilities: [
      { name: 'mcp.stdio', description: 'Default local agent entrypoint. Launch exora-dockd mcp with the host config path.' },
      { name: 'native.daemon', description: 'Desktop shell manages the bundled local Exora Dock daemon.' },
    ],
    endpoints: {
      health: { method: 'GET', path: '/health', url: `${baseUrl}/health`, description: 'Check whether this local Exora Dock is online.' },
      manifest: { method: 'GET', path: '/.well-known/exora-dock.json', url: `${baseUrl}/.well-known/exora-dock.json`, description: 'Fetch the daemon manifest.' },
      'mcp.stdio': { method: 'STDIO', path: '', url: '', description: 'Launch using mcpCommand.' },
    },
    lastSeen: new Date().toISOString(),
  }, null, 2)
}

function defaultLocalConfig(paths) {
  return `# Exora Dock local desktop config
rpc_url: "https://api.mainnet-beta.solana.com"
listen_addr: "127.0.0.1:8080"
key_path: ""
cache_max_mb: 256
data_dir: ${yamlQuote(paths.dataDir)}
fetch_interval_sec: 10
program_id: ""
mode: "hybrid"
cloud_url: ""
dock_id: ""
wallet_path: ${yamlQuote(path.join(paths.dataDir, 'wallet'))}
auth_token_path: ${yamlQuote(path.join(paths.dataDir, 'auth.json'))}
payment_pin_path: ${yamlQuote(path.join(paths.dataDir, 'payment-pin.json'))}
cloud_token_path: ${yamlQuote(path.join(paths.dataDir, 'cloud-token.json'))}
cloud_poll_interval_sec: 3

provider:
  workspace_dir: ${yamlQuote(defaultProjectFolder(paths).path)}
  allow_command_executor: false
  allowed_commands: []
  max_job_seconds: 300
  max_input_mb: 128
  docker:
    enabled: false
    default_image: ""
    allowed_images: []
    network_mode: "none"
    allowed_network_modes: ["none"]
    allow_gpu: false
    max_cpus: 0
    max_memory_mb: 0
    pull_policy: "missing"

llm_base_url: "https://api.openai.com/v1"
llm_api_key: ""
llm_provider_preset: "openai_responses"
llm_wire_api: "responses"
llm_capabilities:
  supports_responses: true
  supports_chat_completions: true
  supports_system_message: true
  supports_json_response_format: true
  supports_streaming: true
  supports_tools: true
  supports_reasoning_effort: true
llm_research_model: "gpt-5.5"
llm_research_reasoning_effort: "high"
llm_utility_model: "gpt-5.5"
llm_utility_reasoning_effort: "low"
llm_disable_response_storage: true
llm_model: "gpt-5.5"

seller_agent:
  enabled: false
  auto_quote: true
  quote_publish_mode: auto
  auto_accept_low_risk: false
  provider_pubkey: ""
  poll_interval_sec: 2
  default_quote_price: 0
  default_quote_currency: "USDC"
  default_estimated_seconds: 60
`
}

async function localOwnerToken(paths) {
  const tokens = await localAuthTokens(paths)
  if (!String(tokens.ownerToken || '').trim()) throw new Error('owner token missing')
  return tokens.ownerToken
}

async function localAgentToken(paths) {
  const tokens = await localAuthTokens(paths)
  const token = tokens.agentToken || tokens.ownerToken
  if (!String(token || '').trim()) throw new Error('agent token missing')
  return token
}

async function localAuthTokens(paths) {
  const authPath = authPathForConfig(paths)
  const data = await fsp.readFile(authPath, 'utf8').catch((error) => {
    throw new Error(`read auth token ${authPath}: ${error.message}`)
  })
  try {
    return JSON.parse(data)
  } catch (error) {
    throw new Error(`auth token json: ${error.message}`)
  }
}

function authPathForConfig(paths) {
  const raw = fs.existsSync(paths.configPath) ? fs.readFileSync(paths.configPath, 'utf8') : defaultLocalConfig(paths)
  let value = {}
  try {
    value = YAML.parse(raw) || {}
  } catch {
    value = {}
  }
  const authPath = stringAt(value, 'auth_token_path', '')
  return authPath.trim() ? authPath : path.join(paths.dataDir, 'auth.json')
}

async function catalog_products(payload = {}) {
  const q = String(payload?.input?.query || '').trim()
  return httpJson('GET', `/v3/catalog/products${q ? `?q=${encodeURIComponent(q)}` : ''}`, undefined, await localOwnerToken(await dockPaths()))
}

async function catalog_product(payload = {}) {
  return httpJson('GET', `/v3/catalog/products/${encodeURIComponent(String(payload?.input?.id || ''))}`, undefined, await localOwnerToken(await dockPaths()))
}

async function v3Worker(command, input = {}) {
  return httpJson('POST', `/v3/provider/worker/${encodeURIComponent(command)}`, input, await localOwnerToken(await dockPaths()), { timeoutMs: 180000 })
}
async function provider_vm_probe() { return v3Worker('probe_host') }
async function provider_vm_domains() { return v3Worker('list_domains') }
async function provider_vm_import(payload = {}) { return v3Worker('import_template', payload.input || {}) }
async function provider_vm_validate(payload = {}) {
  const input = payload.input || {}
  const templateId = String(input.templateId || '')
  const workspaceBytes = Math.max(1, Number(input.workspaceGiB || 100)) * 1024 * 1024 * 1024
  mainWindow?.webContents.send('exora:v3-progress', { kind: 'vm_validation', phase: 'template' })
  const checked = await v3Worker('validate_template', { templateId })
  if (!checked?.result?.valid) throw new Error('Template validation failed')
  mainWindow?.webContents.send('exora:v3-progress', { kind: 'vm_validation', phase: 'reserve_disk' })
  const reservation = await v3Worker('reserve_disk', { slotId: `slot-${templateId}`, sizeBytes: workspaceBytes })
  const cloneId = `validation-${Date.now()}`
  mainWindow?.webContents.send('exora:v3-progress', { kind: 'vm_validation', phase: 'encrypted_clone' })
  const clone = await v3Worker('create_test_clone', { templateId, cloneId })
  const reset = await v3Worker('reset_test_clone', { cloneId })
  return { result: { ...checked.result, reservation: reservation.result, testClone: clone.result, resetReceipt: reset.result, valid: true } }
}
async function provider_product_create(payload = {}) { return httpJson('POST', '/v3/provider/products', payload.input || {}, await localOwnerToken(await dockPaths())) }

async function provider_asset_choose_files() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] })
  if (result.canceled) return { files: [] }
  const files = []
  for (const filePath of result.filePaths) {
    const stat = await fsp.stat(filePath)
    const token = crypto.randomUUID()
    v3SelectedFiles.set(token, filePath)
    files.push({ token, name: path.basename(filePath), sizeBytes: stat.size })
  }
  return { files }
}

async function provider_asset_create(payload = {}) {
  return httpJson('POST', '/v3/provider/asset-bundles', payload.input || {}, await localOwnerToken(await dockPaths()))
}

async function provider_asset_upload(payload = {}) {
  const input = payload.input || {}
  const filePath = v3SelectedFiles.get(String(input.fileToken || ''))
  if (!filePath) throw new Error('Selected file token is unavailable')
  const stat = await fsp.stat(filePath)
  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => { const stream = fs.createReadStream(filePath); stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject); stream.on('end', resolve) })
  const sha256 = hash.digest('hex')
  const started = await httpJson('POST', `/v3/provider/asset-bundles/${encodeURIComponent(String(input.bundleId))}/multipart`, { fileName: path.basename(filePath), sizeBytes: stat.size, sha256 }, await localOwnerToken(await dockPaths()))
  const upload = started.upload
  const partSize = 16 * 1024 * 1024
  const partCount = Math.max(1, Math.ceil(stat.size / partSize))
  const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1)
  const presigned = await httpJson('POST', `/v3/provider/uploads/${encodeURIComponent(upload.uploadSessionId)}/parts/presign`, { partNumbers }, await localOwnerToken(await dockPaths()))
  const handle = await fsp.open(filePath, 'r')
  const parts = []
  try {
    for (const partNumber of partNumbers) {
      const offset = (partNumber - 1) * partSize
      const length = Math.min(partSize, stat.size - offset)
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, offset)
      const response = await fetch(presigned.urls[String(partNumber)], { method: 'PUT', body: buffer })
      if (!response.ok) throw new Error(`S3 part ${partNumber} failed with ${response.status}`)
      parts.push({ partNumber, etag: response.headers.get('etag') || '' })
      mainWindow?.webContents.send('exora:v3-progress', { kind: 'asset_upload', uploadSessionId: upload.uploadSessionId, completed: partNumber, total: partCount })
    }
  } finally { await handle.close() }
  const complete = await httpJson('POST', `/v3/provider/uploads/${encodeURIComponent(upload.uploadSessionId)}/complete`, { parts }, await localOwnerToken(await dockPaths()), { timeoutMs: 60000 })
  v3SelectedFiles.delete(String(input.fileToken || ''))
  return complete
}
async function provider_asset_cancel(payload = {}) {
  const id = String(payload?.input?.uploadSessionId || '')
  return httpJson('POST', `/v3/provider/uploads/${encodeURIComponent(id)}/abort`, {}, await localOwnerToken(await dockPaths()))
}

async function provider_openapi_choose() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'OpenAPI', extensions: ['json', 'yaml', 'yml'] }] })
  if (result.canceled || !result.filePaths[0]) return { document: '' }
  const document = await fsp.readFile(result.filePaths[0], 'utf8')
  if (Buffer.byteLength(document) > 5 * 1024 * 1024) throw new Error('OpenAPI document exceeds 5 MiB')
  return { document, name: path.basename(result.filePaths[0]) }
}
async function provider_openapi_import(payload = {}) {
  const input = { ...(payload.input || {}) }
  if (typeof input.document === 'string') {
    try { input.document = JSON.parse(input.document) } catch { input.document = YAML.parse(input.document) }
  }
  return httpJson('POST', '/v3/provider/api-imports', input, await localOwnerToken(await dockPaths()), { timeoutMs: 30000 })
}
async function provider_listings() { return httpJson('GET', '/v3/provider/listings', undefined, await localOwnerToken(await dockPaths())) }
async function provider_listing_save(payload = {}) {
  const input = payload.input || {}
  const route = input.listingId ? `/v3/provider/listings/${encodeURIComponent(input.listingId)}` : '/v3/provider/listings'
  return httpJson(input.listingId ? 'PUT' : 'POST', route, input, await localOwnerToken(await dockPaths()))
}
async function provider_listing_action(payload = {}) {
  const input = payload.input || {}
  return httpJson('POST', `/v3/provider/listings/${encodeURIComponent(String(input.listingId || ''))}/${encodeURIComponent(String(input.action || ''))}`, {}, await localOwnerToken(await dockPaths()))
}

async function httpJson(method, route, body, token, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 3500
  const retryOnOffline = options.retryOnOffline !== false
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const request = () => fetchWithTimeout(`${BASE_URL}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }, timeoutMs)
  let response
  try {
    response = await request()
  } catch (error) {
    if (!retryOnOffline || !isLocalConnectionFailure(error)) {
      throw localRequestError(error, route, timeoutMs)
    }
    try {
      await start_dock()
      response = await request()
    } catch (retryError) {
      throw localRequestError(retryError, route, timeoutMs)
    }
  }
  const text = await response.text()
  if (!response.ok) throw new Error(`local dock returned ${response.status}: ${text}`)
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`local response json: ${error.message}`)
  }
}

async function ensureDockReady() {
  if (await healthOk()) return
  await start_dock()
}

function isLocalConnectionFailure(error) {
  const message = errorMessage(error).toLowerCase()
  return (
    message.includes('fetch failed') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('connect ECONNREFUSED'.toLowerCase())
  )
}

function localRequestError(error, route, timeoutMs) {
  const message = errorMessage(error)
  if (message.toLowerCase().includes('timed out')) {
    return new Error(`Local Exora Dock did not answer ${route} within ${timeoutMs}ms. The background task is still safe to retry.`)
  }
  if (isLocalConnectionFailure(error)) {
    return new Error(`Local Exora Dock is not reachable at ${BASE_URL}. I tried to start it automatically, but ${route} is still unavailable. Wait a few seconds and try again.`)
  }
  return error instanceof Error ? error : new Error(message)
}

async function cloudLinkConfig(paths, input = {}) {
  const raw = await readTextOr(paths.configPath, defaultLocalConfig(paths))
  let value
  try {
    value = objectOr(YAML.parse(raw) || {})
  } catch {
    value = {}
  }
  const seller = objectOr(value.seller_agent)
  const cloudUrl = normalizeCloudURL(
    input.cloudUrl ||
    input.cloudURL ||
    value.cloud_url ||
    process.env.EXORA_CLOUD_URL ||
    'http://127.0.0.1:8090',
  )
  const tokenPath = path.resolve(String(
    input.tokenPath ||
    value.cloud_token_path ||
    process.env.EXORA_CLOUD_TOKEN_PATH ||
    path.join(paths.dataDir, 'cloud-token.json'),
  ).trim())
  const dockId = defaultIfBlank(
    input.dockId || input.dockID || value.dock_id || seller.provider_pubkey,
    'local-dev-miner',
  )
  return {
    cloudUrl,
    tokenPath,
    dockId,
    mode: defaultIfBlank(input.mode || value.mode, 'hybrid'),
  }
}

function normalizeCloudURL(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '')
  return trimmed || 'http://127.0.0.1:8090'
}

async function cloudPostJSON(url, body, timeoutMs, token = '') {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }, timeoutMs)
  const text = await response.text()
  let parsed = {}
  if (text.trim()) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { raw: text }
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    body: objectOr(parsed),
    error: String(parsed?.error || parsed?.message || text || response.statusText || 'cloud request failed'),
  }
}

function pwaLinkQRPayload(link, cfg) {
  const userCode = String(link?.userCode || '').trim()
  const verificationUrl = String(link?.verificationUrl || '').trim()
  if (verificationUrl && userCode) {
    try {
      const url = new URL(verificationUrl, cfg.cloudUrl)
      url.searchParams.set('userCode', userCode)
      url.searchParams.set('code', userCode)
      url.searchParams.set('dockCode', userCode)
      url.searchParams.set('dockId', cfg.dockId)
      url.searchParams.set('cloudUrl', cfg.cloudUrl)
      url.searchParams.set('clientKind', ELECTRON_CLIENT_KIND)
      return url.toString()
    } catch {
      // Fall through to structured payload.
    }
  }
  return JSON.stringify({
    type: 'exora.dock.link',
    userCode,
    verificationUrl,
    cloudUrl: cfg.cloudUrl,
    dockId: cfg.dockId,
    clientKind: ELECTRON_CLIENT_KIND,
    expiresAt: link?.expiresAt || '',
  })
}

function sanitizePwaLink(value) {
  const next = { ...objectOr(value) }
  delete next.cloudToken
  delete next.commandPrivateKey
  return next
}

function createCommandKeyPair() {
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    privateKey: base64URL(ecdh.getPrivateKey()),
    publicKey: base64URL(ecdh.getPublicKey()),
  }
}

function base64URL(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function pendingCommandKeyPath(tokenPath) {
  return `${tokenPath}.command-key.json`
}

async function savePendingCommandKey(tokenPath, commandKey) {
  const keyPath = pendingCommandKeyPath(tokenPath)
  await fsp.mkdir(path.dirname(keyPath), { recursive: true })
  await fsp.writeFile(keyPath, `${JSON.stringify(commandKey, null, 2)}\n`, { mode: 0o600 })
}

async function loadPendingCommandKey(tokenPath) {
  const raw = await fsp.readFile(pendingCommandKeyPath(tokenPath), 'utf8')
  const parsed = objectOr(JSON.parse(raw))
  const privateKey = String(parsed.privateKey || '').trim()
  const publicKey = String(parsed.publicKey || '').trim()
  if (!privateKey || !publicKey) throw new Error('pending command key missing')
  return { privateKey, publicKey }
}

async function deletePendingCommandKey(tokenPath) {
  await fsp.rm(pendingCommandKeyPath(tokenPath), { force: true })
}

async function saveCloudTokenFile(tokenPath, value) {
  await fsp.mkdir(path.dirname(tokenPath), { recursive: true })
  await fsp.writeFile(tokenPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

async function ensureCloudLinkConfig(paths, cloudUrl, tokenPath, dockId) {
  const raw = await readTextOr(paths.configPath, defaultLocalConfig(paths))
  let value
  try {
    value = objectOr(YAML.parse(raw) || {})
  } catch {
    value = {}
  }
  value.cloud_url = normalizeCloudURL(cloudUrl)
  value.cloud_token_path = tokenPath
  value.dock_id = defaultIfBlank(dockId, 'local-dev-miner')
  await fsp.writeFile(paths.configPath, ensureTrailingNewline(YAML.stringify(value)))
  await writeDiscoveryManifest(paths)
}

async function refreshDaemonForCloudLink(paths) {
  if (await trackedDaemonRunning(paths)) {
    await stopTrackedDaemon(paths)
    await start_dock()
    return {
      daemonRestarted: true,
      message: 'PWA linked. Dock was restarted so remote commands can connect.',
    }
  }
  if (!(await healthOk())) {
    await start_dock()
    return {
      daemonRestarted: true,
      message: 'PWA linked. Dock was started so remote commands can connect.',
    }
  }
  return {
    daemonRestarted: false,
    message: 'PWA linked. Remote Console can now control this Dock; restart any external daemon if it does not appear online.',
  }
}

function effectiveLlmApiKey(rawConfig, input) {
  const provided = explicitApiKeyInput(input)
  if (provided) return provided
  let value = {}
  try {
    value = YAML.parse(rawConfig) || {}
  } catch {
    value = {}
  }
  return stringAt(value, 'llm_api_key', '')
}

async function effectiveLlmApiKeyForInput(paths, rawConfig, input) {
  const provided = explicitApiKeyInput(input)
  if (provided) return provided
  if (input.clearApiKey) return ''
  const profileId = String(input.profileId || '').trim()
  if (profileId) {
    await ensureLLMProfiles(paths)
    const state = await readDesktopState(paths)
    const profile = (Array.isArray(state.llmProfiles) ? state.llmProfiles : []).find((item) => item.id === profileId)
    if (profile) return decryptLLMProfileKey(profile)
  }
  return effectiveLlmApiKey(rawConfig, input)
}

function explicitApiKeyInput(input = {}) {
  const provided = String(input.apiKey || '').trim()
  return provided === MASKED_API_KEY_VALUE ? '' : provided
}

function llmBaseCandidates(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return ['']
  const candidates = base.endsWith('/v1') ? [base] : [`${base}/v1`, base]
  try {
    const url = new URL(base)
    const pathName = url.pathname.replace(/\/+$/, '')
    if (pathName && pathName !== '/v1') candidates.push(`${url.origin}/v1`)
  } catch {
    // Keep the literal user-entered candidates for non-URL local gateways.
  }
  return uniqueList(candidates)
}

async function llmPostJson(baseUrl, route, apiKey, body) {
  const result = await llmPostJsonWithBase(baseUrl, route, apiKey, body)
  return result.body
}

async function llmPostJsonWithBase(baseUrl, route, apiKey, body) {
  let lastError
  for (const base of llmBaseCandidates(baseUrl)) {
    const url = `${base}${route}`
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (String(apiKey || '').trim()) headers.Authorization = `Bearer ${String(apiKey).trim()}`
      const response = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, 20000)
      const text = await response.text()
      if (!response.ok) {
        lastError = new Error(`LLM API ${route} returned ${response.status}: ${text}`)
        if (response.status === 404 || response.status === 405) continue
        break
      }
      try {
        return { body: JSON.parse(text), baseUrl: base }
      } catch (error) {
        throw new Error(`LLM API returned non-JSON: ${error.message}`)
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('LLM request failed')
}

async function llmGetModels(baseUrl, apiKey) {
  const result = await llmGetModelsWithBase(baseUrl, apiKey)
  return result.models
}

async function llmGetModelsWithBase(baseUrl, apiKey) {
  let lastError
  for (const base of llmBaseCandidates(baseUrl)) {
    const url = `${base}/models`
    try {
      const headers = {}
      if (String(apiKey || '').trim()) headers.Authorization = `Bearer ${String(apiKey).trim()}`
      const response = await fetchWithTimeout(url, { method: 'GET', headers }, 12000)
      const text = await response.text()
      if (!response.ok) {
        lastError = new Error(`LLM models endpoint returned ${response.status}: ${text}`)
        if (response.status === 404 || response.status === 405) continue
        break
      }
      let value
      try {
        value = JSON.parse(text)
      } catch (error) {
        throw new Error(`LLM models returned non-JSON: ${error.message}`)
      }
      return { models: parseLlmModels(value), baseUrl: base }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('LLM models request failed')
}

function parseLlmModels(value) {
  const array = Array.isArray(value?.data) ? value.data : Array.isArray(value?.models) ? value.models : []
  const models = []
  for (const item of array) {
    if (typeof item === 'string') models.push(item)
    else if (item?.id) models.push(String(item.id))
    else if (item?.name) models.push(String(item.name))
  }
  return [...new Set(models)].sort()
}

function classifyLlmError(error) {
  const lower = String(error || '').toLowerCase()
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized')) return 'auth_failed'
  if (lower.includes('404')) return 'wrong_endpoint_or_model'
  if (lower.includes('/responses')) return 'provider_does_not_support_responses'
  return 'failed'
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function openPath(target) {
  const error = await shell.openPath(target)
  if (error) throw new Error(error)
}

async function openFolderPath(target) {
  await fsp.mkdir(target, { recursive: true })
  const error = await shell.openPath(target)
  if (!error) return
  if (process.platform !== 'win32') {
    throw new Error(error)
  }
  try {
    const child = spawn('explorer.exe', [target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.unref()
    return
  } catch {
    throw new Error(error)
  }
}

async function readTextOr(file, fallback) {
  try {
    return await fsp.readFile(file, 'utf8')
  } catch {
    return fallback
  }
}

function objectOr(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function stringAt(value, key, fallback) {
  const raw = value && value[key]
  if (typeof raw === 'string' && raw.trim() !== '') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  return fallback
}

function arrayAt(value, key, fallback = []) {
  const raw = value && value[key]
  if (Array.isArray(raw)) return raw.map((item) => String(item || '').trim()).filter(Boolean)
  if (typeof raw === 'string') return raw.split(',').map((item) => item.trim()).filter(Boolean)
  return fallback
}

function csvList(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  const items = String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
  return items.length ? items : fallback
}

function boolAt(value, key, fallback) {
  return typeof value?.[key] === 'boolean' ? value[key] : fallback
}

function integerAt(value, key, fallback) {
  const next = Number(value?.[key])
  return Number.isFinite(next) ? Math.trunc(next) : fallback
}

function numberAt(value, key, fallback) {
  const next = Number(value?.[key])
  return Number.isFinite(next) ? next : fallback
}

function yamlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function ensureTrailingNewline(value) {
  return value.endsWith('\n') ? value : `${value}\n`
}

function statusMessage(status) {
  if (status.docker === 'native' && status.container === 'missing') return 'Bundled daemon is missing.'
  if (status.docker === 'native' && status.container === 'stopped') return 'Local daemon is stopped.'
  if (status.docker === 'native' && status.container === 'external' && status.daemon === 'healthy') return 'Exora Dock is already reachable.'
  if (status.docker === 'native' && status.container === 'running' && status.daemon === 'healthy') return 'Exora Dock is reachable.'
  if (status.docker === 'native' && status.container === 'running' && status.daemon === 'starting') return 'Local daemon is starting.'
  return 'Status checked.'
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
