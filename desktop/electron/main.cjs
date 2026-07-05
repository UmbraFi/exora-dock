const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron')
const { spawn, execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')

const APP_ID = 'io.exora.dock'
const BASE_URL = 'http://127.0.0.1:8080'
const DAEMON_NAME = 'exora-dockd'
const DAEMON_LOG_NAME = 'daemon.log'
const DEFAULT_PROJECT_NAME = 'AgenStaff_Project'
const DESKTOP_STATE_NAME = 'desktop-state.json'
const PERSISTENCE_DIR_NAME = 'exora-data'
const DEV_URL = process.env.EXORA_DOCK_DESKTOP_DEV_URL || 'http://127.0.0.1:1420'
const WINDOW_ICON = process.platform === 'win32'
  ? path.join(__dirname, 'assets', 'icon.ico')
  : path.join(__dirname, 'assets', 'icon.png')

let mainWindow

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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc() {
  const handlers = {
    window_minimize,
    window_toggle_maximize,
    window_close,
    app_status,
    start_dock,
    stop_dock,
    restart_dock,
    open_health,
    open_manifest,
    open_logs,
    copy_mcp_command,
    copy_agent_prompt,
    copy_opencode_config,
    copy_rest_base_url,
    create_work_mcp_uid,
    llm_profiles,
    save_llm_profile,
    delete_llm_profile,
    apply_llm_profile,
    desktop_persistence_load,
    save_app_settings,
    save_chat_thread,
    archive_chat_threads,
    save_transactions,
    pwa_link_start,
    pwa_link_status,
    seller_settings,
    save_seller_settings,
    test_llm_connection,
    list_llm_models,
    agent_cards_mine,
    agent_card_diagnostics,
    agent_card_draft,
    save_agent_card,
    publish_agent_card,
    seller_market_status,
    agent_search_sellers,
    list_approvals,
    decide_approval,
    list_order_plans,
    workspace_snapshot,
    list_tasks,
    get_task,
    list_payments,
    get_payment,
    select_order_plan,
    cancel_order_plan,
    payment_pin_status,
    set_payment_pin,
    project_folder_status,
    choose_project_folder,
    open_project_folder,
    rename_project_folder,
    archive_project_chats,
    remove_project_folder,
    wallet_status,
    wallet_create,
    wallet_bind,
    security_status,
    daemon_status,
    start_daemon,
    stop_daemon,
    open_console,
  }

  ipcMain.handle('exora:invoke', async (_event, command, payload = {}) => {
    if (typeof command !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, command)) {
      throw new Error(`unknown desktop command: ${String(command)}`)
    }
    return handlers[command](payload)
  })
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
  mainWindow?.close()
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
  const result = await cloudPostJSON(`${cfg.cloudUrl}/v1/device-links`, {
    dockId: cfg.dockId,
    displayName: 'Exora Dock',
    mode: cfg.mode,
    publicBaseUrl: BASE_URL,
    version: '0.1.0',
    capabilities: ['remote.console', 'approvals.queue', 'mcp.stdio'],
  }, 10000)
  if (!result.ok) {
    throw new Error(`cloud device link returned ${result.status}: ${result.error}`)
  }
  return sanitizePwaLink({
    status: result.body.status || 'pending',
    ...result.body,
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
  await saveCloudTokenFile(cfg.tokenPath, {
    dockId,
    cloudUrl: cfg.cloudUrl,
    cloudToken,
    linkedAt: new Date().toISOString(),
  })
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
  const profile = normalizeStoredLLMProfile({
    ...existing,
    ...input,
    id,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  })
  const apiKey = String(input.apiKey || '').trim()
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
  const profiles = (Array.isArray(state.llmProfiles) ? state.llmProfiles : []).filter((profile) => profile.id !== id)
  state.llmProfiles = profiles
  if (state.activeLLMProfileId === id) state.activeLLMProfileId = profiles[0]?.id || ''
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
  const raw = await readTextOr(paths.configPath, defaultLocalConfig(paths))
  const current = sellerSettingsFromYaml(raw)
  const apiKey = decryptLLMProfileKey(profile)
  const updated = updateSellerSettingsYaml(raw, llmProfileToSellerInput(profile, current, apiKey))
  await fsp.writeFile(paths.configPath, updated)
  state.activeLLMProfileId = profile.id
  await writeDesktopState(paths, state)
  await writeDiscoveryManifest(paths)
  if (await trackedDaemonRunning(paths)) {
    await stopTrackedDaemon(paths)
    await start_dock()
  }
  return llmProfileStatus(paths)
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
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const raw = await readTextOr(paths.configPath, defaultLocalConfig(paths))
  const updated = updateSellerSettingsYaml(raw, input)
  await fsp.writeFile(paths.configPath, updated)
  await writeDiscoveryManifest(paths)
  if (await trackedDaemonRunning(paths)) {
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
  const wire = normalizeWireApi(input.wireApi)
  if (wire === 'responses' && !capValue(input.capabilities, 'supportsResponses')) {
    return {
      ok: false,
      status: 'provider_does_not_support_responses',
      message: 'This provider preset is Chat Completions compatible but does not advertise Responses support.',
      route: '/responses',
    }
  }
  const route = wire === 'responses' ? '/responses' : '/chat/completions'
  const body = wire === 'responses'
    ? { model, instructions: 'Reply with exactly: ok', input: 'connection test', store: false }
    : { model, messages: [{ role: 'user', content: 'Reply with exactly: ok' }], max_tokens: 8 }
  try {
    await llmPostJson(input.llmBaseUrl, route, apiKey, body)
    return { ok: true, status: 'ready', message: 'LLM provider responded successfully.', route }
  } catch (error) {
    const message = errorMessage(error)
    return { ok: false, status: classifyLlmError(message), message, route }
  }
}

async function list_llm_models(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const raw = await readTextOr(paths.configPath, defaultLocalConfig(paths))
  const apiKey = await effectiveLlmApiKeyForInput(paths, raw, input)
  try {
    const models = await llmGetModels(input.llmBaseUrl, apiKey)
    return { ok: true, models, message: 'Model list loaded.' }
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
  return httpJson('POST', '/v1/agent-cards/diagnostics', {}, await localOwnerToken(paths), { timeoutMs: 20000 })
}

async function agent_card_draft(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await ensureLLMProfiles(paths)
  await ensureDockReady()
  return httpJson('POST', '/v1/agent-cards/draft', input, await localOwnerToken(paths), { timeoutMs: 20000 })
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
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  const folderStatus = await projectFoldersStatus(paths)
  if (!(await healthOk())) {
    return { online: false, orderPlans: [], approvals: [], tasks: [], payments: [], mcpConnections: [], ...folderStatus, errors: ['local daemon is offline'] }
  }
  const token = await localOwnerToken(paths)
  const errors = []
  const orderPlans = await snapshotArray(httpJson('GET', '/v1/order-plans?status=pending_selection', undefined, token), 'orderPlans', errors)
  const approvals = await snapshotArray(httpJson('GET', '/v1/approvals?status=pending', undefined, token), 'approvals', errors)
  const tasks = await snapshotArray(httpJson('GET', '/v1/tasks', undefined, token), 'tasks', errors)
  const payments = await snapshotArray(httpJson('GET', '/v1/payments', undefined, token), 'payments', errors)
  const mcpConnections = await snapshotArray(httpJson('GET', '/v1/mcp/connections', undefined, token), 'mcpConnections', errors)
  await addConnectionProjectFolders(paths, mcpConnections)
  await addActivityProjectFolders(paths, orderPlans, tasks)
  const updatedFolderStatus = await projectFoldersStatus(paths)
  return { online: true, orderPlans, approvals, tasks, payments, mcpConnections, ...updatedFolderStatus, errors }
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
  return httpJson('GET', '/v1/wallet', undefined, await localOwnerToken(paths))
}

async function wallet_create() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('POST', '/v1/wallet/create', {}, await localOwnerToken(paths))
}

async function wallet_bind(payload) {
  const input = payload?.input ?? {}
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  return httpJson('POST', '/v1/wallet/bind', { address: input.address || '' }, await localOwnerToken(paths))
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
  return activeProjectFolder(paths)
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
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fsp.rename(tmp, file)
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
    orderId: String(value.orderId || '').trim() || undefined,
    taskIds,
    status: String(value.status || '').trim() || undefined,
    participants: participants.length ? participants : undefined,
    providerPubkey: String(value.providerPubkey || '').trim() || undefined,
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
  return 'Find my local Exora Dock by reading the local ExoraDock agent-discovery.json, start the stdio MCP server from mcpCommand, then use its Exora tools instead of guessing HTTP endpoints. MCP is the external local-agent channel; use baseUrl REST only as fallback. For a specific Work task, use the prompt copied from Work so you also receive a workUid.'
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
  const apiKey = stringAt(value, 'llm_api_key', '')
  const legacyModel = stringAt(value, 'llm_model', 'gpt-5.5')
  const llmBaseUrl = stringAt(value, 'llm_base_url', 'https://api.openai.com/v1')
  const providerPreset = normalizeProviderPreset(stringAt(value, 'llm_provider_preset', 'openai_responses'))
  const requiresApiKey = providerRequiresApiKey(providerPreset, llmBaseUrl)
  return {
    enabled: boolAt(seller, 'enabled', false),
    autoQuote: boolAt(seller, 'auto_quote', true),
    autoCompleteTextTasks: boolAt(seller, 'auto_complete_text_tasks', false),
    llmBaseUrl,
    hasApiKey: apiKey !== '' || !requiresApiKey,
    keyFormat: apiKey === '' && !requiresApiKey ? 'not_required' : apiKeyFormat(apiKey),
    providerPreset,
    wireApi: normalizeWireApi(stringAt(value, 'llm_wire_api', 'responses')),
    capabilities: llmCapabilitiesFromYaml(value),
    researchModel: stringAt(value, 'llm_research_model', legacyModel),
    researchReasoningEffort: stringAt(value, 'llm_research_reasoning_effort', 'high'),
    utilityModel: stringAt(value, 'llm_utility_model', legacyModel),
    utilityReasoningEffort: stringAt(value, 'llm_utility_reasoning_effort', 'low'),
    disableResponseStorage: boolAt(value, 'llm_disable_response_storage', true),
    providerId: stringAt(seller, 'provider_pubkey', 'local-dev-miner'),
    quotePrice: numberAt(seller, 'default_quote_price', 0),
    currency: stringAt(seller, 'default_quote_currency', 'USD'),
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
    profiles.push(llmProfileFromYaml(raw))
  }
  state.llmProfiles = profiles
  if (!profiles.some((profile) => profile.id === state.activeLLMProfileId)) state.activeLLMProfileId = profiles[0]?.id || ''
  await writeDesktopState(paths, state)
}

async function llmProfileStatus(paths) {
  const state = await readDesktopState(paths)
  const profiles = Array.isArray(state.llmProfiles) ? state.llmProfiles.map(normalizeStoredLLMProfile).filter(Boolean) : []
  return {
    profiles: profiles.map(profileForRenderer),
    activeProfileId: state.activeLLMProfileId || profiles[0]?.id || '',
    keyStorageAvailable: safeStorage.isEncryptionAvailable(),
  }
}

function llmProfileFromYaml(raw) {
  const value = YAML.parse(raw) || {}
  const preset = normalizeProviderPreset(stringAt(value, 'llm_provider_preset', 'openai_responses'))
  const legacyModel = stringAt(value, 'llm_model', 'gpt-5.5')
  const apiKey = stringAt(value, 'llm_api_key', '')
  const now = new Date().toISOString()
  const profile = normalizeStoredLLMProfile({
    id: 'default-api',
    name: 'Default API',
    providerPreset: preset,
    llmBaseUrl: stringAt(value, 'llm_base_url', 'https://api.openai.com/v1'),
    wireApi: normalizeWireApi(stringAt(value, 'llm_wire_api', 'responses')),
    capabilities: llmCapabilitiesFromYaml(value),
    researchModel: stringAt(value, 'llm_research_model', legacyModel),
    researchReasoningEffort: stringAt(value, 'llm_research_reasoning_effort', 'high'),
    utilityModel: stringAt(value, 'llm_utility_model', legacyModel),
    utilityReasoningEffort: stringAt(value, 'llm_utility_reasoning_effort', 'low'),
    disableResponseStorage: boolAt(value, 'llm_disable_response_storage', true),
    createdAt: now,
    updatedAt: now,
  })
  if (apiKey && safeStorage.isEncryptionAvailable()) {
    profile.encryptedApiKey = safeStorage.encryptString(apiKey).toString('base64')
    profile.keyStorage = 'safeStorage'
  }
  return profile
}

function normalizeStoredLLMProfile(input) {
  const profile = objectOr(input)
  const now = new Date().toISOString()
  const id = String(profile.id || '').trim()
  if (!id) return undefined
  const providerPreset = normalizeProviderPreset(profile.providerPreset || 'openai_responses')
  const researchModel = defaultIfBlank(profile.researchModel, 'gpt-5.5')
  return {
    id,
    name: defaultIfBlank(profile.name, 'API Profile'),
    providerPreset,
    llmBaseUrl: String(profile.llmBaseUrl || '').trim() || 'https://api.openai.com/v1',
    wireApi: normalizeWireApi(profile.wireApi),
    capabilities: objectOr(profile.capabilities),
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

function profileForRenderer(profile) {
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

function updateSellerSettingsYaml(raw, input) {
  const value = objectOr(YAML.parse(raw) || {})
  const researchModel = defaultIfBlank(input.researchModel, 'gpt-5.5')
  const utilityModel = defaultIfBlank(input.utilityModel, researchModel)
  value.llm_base_url = String(input.llmBaseUrl || '').trim()
  value.llm_provider_preset = normalizeProviderPreset(input.providerPreset)
  value.llm_wire_api = normalizeWireApi(input.wireApi)
  value.llm_capabilities = capabilitiesToYaml(input.capabilities || {})
  value.llm_research_model = researchModel
  value.llm_research_reasoning_effort = defaultIfBlank(input.researchReasoningEffort, 'high')
  value.llm_utility_model = utilityModel
  value.llm_utility_reasoning_effort = defaultIfBlank(input.utilityReasoningEffort, 'low')
  value.llm_disable_response_storage = Boolean(input.disableResponseStorage)
  value.llm_model = researchModel
  if (input.clearApiKey) value.llm_api_key = ''
  else if (String(input.apiKey || '').trim()) value.llm_api_key = String(input.apiKey).trim()

  value.seller_agent = objectOr(value.seller_agent)
  value.seller_agent.enabled = Boolean(input.enabled)
  value.seller_agent.auto_quote = Boolean(input.autoQuote)
  value.seller_agent.auto_complete_text_tasks = Boolean(input.autoCompleteTextTasks)
  value.seller_agent.provider_pubkey = String(input.providerId || '').trim()
  value.seller_agent.poll_interval_sec = 2
  value.seller_agent.default_quote_price = Math.max(0, Number(input.quotePrice || 0))
  value.seller_agent.default_quote_currency = defaultIfBlank(input.currency, 'USD')
  value.seller_agent.default_estimated_seconds = Math.max(1, Math.trunc(Number(input.estimatedSeconds || 60)))
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
  return ensureTrailingNewline(YAML.stringify(value))
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
  auto_complete_text_tasks: false
  provider_pubkey: ""
  poll_interval_sec: 2
  default_quote_price: 0
  default_quote_currency: "USD"
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
    return new Error(`Local Exora Dock is not reachable at ${BASE_URL}. I tried to start it automatically, but ${route} is still unavailable. Wait a few seconds and try again, or start Dock from Runtime.`)
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

async function cloudPostJSON(url, body, timeoutMs) {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
      url.searchParams.set('dockId', cfg.dockId)
      url.searchParams.set('cloudUrl', cfg.cloudUrl)
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
    expiresAt: link?.expiresAt || '',
  })
}

function sanitizePwaLink(value) {
  const next = { ...objectOr(value) }
  delete next.cloudToken
  return next
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
  const provided = String(input.apiKey || '').trim()
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
  const provided = String(input.apiKey || '').trim()
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

function llmBaseCandidates(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return ['']
  return base.endsWith('/v1') ? [base] : [`${base}/v1`, base]
}

async function llmPostJson(baseUrl, route, apiKey, body) {
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
        return JSON.parse(text)
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
      return parseLlmModels(value)
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

async function snapshotArray(promise, key, errors) {
  try {
    const value = await promise
    return Array.isArray(value?.[key]) ? value[key] : []
  } catch (error) {
    errors.push(`${key}: ${errorMessage(error)}`)
    return []
  }
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
