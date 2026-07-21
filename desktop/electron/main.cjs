const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, screen, session, shell, Tray } = require('electron')
const { spawn, execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')
const { registerIpcHandlers } = require('./ipc.cjs')
const { probeMCPConnectivity } = require('./mcp-connectivity.cjs')
const { createAgentMCPRegistry } = require('./agent-mcp-registry.cjs')
const { releaseWarningForArtifact, selectReleaseArtifact } = require('./release-manifest.cjs')
const { createCloudAuth } = require('./cloud-auth.cjs')
const {
  createAppURLPolicy,
  installNavigationGuards,
  isTrustedIpcSender,
} = require('./security.cjs')
const { cleanupLegacyFrontendData } = require('./legacy-frontend-cleanup.cjs')
const { RequestTimeoutError, fetchAndReadWithTimeout } = require('./network-timeout.cjs')
const { SETTINGS_VERSION, normalizeAppSettingsV3 } = require('./app-settings.cjs')
const APP_ID = 'io.exora.dock'
const BASE_URL = 'http://127.0.0.1:8080'
const DAEMON_NAME = 'exora-dockd'
const DAEMON_LOG_NAME = 'daemon.log'
const DESKTOP_STATE_NAME = 'desktop-state.json'
const PERSISTENCE_DIR_NAME = 'exora-data'
const DEV_URL = process.env.EXORA_DOCK_DESKTOP_DEV_URL || 'http://127.0.0.1:1420'
const DEV_KEEP_VISIBLE = !app.isPackaged && process.argv.includes('--dev-keep-visible')
const DOCK_SUPERVISOR_INTERVAL_MS = 5000
const WINDOW_ICON = process.platform === 'win32'
  ? path.join(__dirname, 'assets', 'icon.ico')
  : path.join(__dirname, 'assets', 'icon.png')
const APP_URL_POLICY = createAppURLPolicy({
  isPackaged: app.isPackaged,
  devUrl: DEV_URL,
  distDir: path.join(__dirname, '..', 'dist'),
})
const STARTUP_SETTINGS = readStartupAppSettingsSync()
const STARTUP_LANGUAGE = STARTUP_SETTINGS.language
const MASKED_API_KEY_VALUE = '************'
const WINDOW_PROFILES = Object.freeze({
  auth: Object.freeze({ width: 1440, height: 900, minWidth: 560, minHeight: 600 }),
  workspace: Object.freeze({ width: 1440, height: 900, minWidth: 1080, minHeight: 720 }),
})
app.commandLine.appendSwitch('lang', chromiumLocaleForLanguage(STARTUP_LANGUAGE))

let mainWindow
let activeWindowMode = 'auth'
let tray
let appIsQuitting = false
let dockShutdownComplete = false
let dockShutdownPromise
let dockSupervisorTask
let dockSupervisorTimer
let currentAppSettings = STARTUP_SETTINGS
let updaterConfigured = false
const updaterState = { state: 'unavailable', version: '', progress: 0, checkedAt: '', message: '', downloadURL: '', sha256: '', warning: '' }
const cloudAuth = createCloudAuth({
  safeStorage,
  isPackaged: app.isPackaged,
  envCloudURL: () => process.env.EXORA_CLOUD_URL || '',
  getPaths: dockPaths,
  readState: readDesktopState,
  writeState: writeDesktopState,
  configuredCloudURL,
  deviceName: () => `${app.getName()} on ${process.platform}`,
	clearLocalPIN: async (paths) => fsp.rm(path.join(paths.dataDir, 'payment-pin.json'), { force: true }),
  ensureDockLink,
  clearDockLink,
  broadcast: (payload) => mainWindow?.webContents.send('exora:auth-state-changed', payload),
})

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
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID)
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  const profile = WINDOW_PROFILES.auth
  const startupSize = windowSizeForWorkArea(profile, screen.getPrimaryDisplay().workArea)
  activeWindowMode = 'auth'
  mainWindow = new BrowserWindow({
    width: startupSize.width,
    height: startupSize.height,
    minWidth: profile.minWidth,
    minHeight: profile.minHeight,
    center: true,
    show: false,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    backgroundColor: resolvedStartupTheme() === 'dark' ? '#0d0e0c' : '#f7f7fc',
    icon: WINDOW_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [
        `--exora-language=${STARTUP_LANGUAGE}`,
        `--exora-chromium-locale=${chromiumLocaleForLanguage(STARTUP_LANGUAGE)}`,
        `--exora-theme=${STARTUP_SETTINGS.theme}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  installNavigationGuards(mainWindow, { policy: APP_URL_POLICY, shell })
  mainWindow.on('close', (event) => {
    if (appIsQuitting) return
    if (currentAppSettings.closeBehavior === 'quit') {
      appIsQuitting = true
      return
    }
    event.preventDefault()
    mainWindow.hide()
  })
  if (DEV_KEEP_VISIBLE) {
    mainWindow.webContents.on('did-finish-load', () => {
      if (!mainWindow || mainWindow.isDestroyed() || appIsQuitting) return
      if (!mainWindow.isVisible()) mainWindow.show()
    })
  }
  mainWindow.once('ready-to-show', () => {
    if ((DEV_KEEP_VISIBLE || !currentAppSettings.startMinimized) && !process.argv.includes('--hidden')) mainWindow.show()
  })
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL(DEV_URL)
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  registerIpc()
  applyDesktopSettings(currentAppSettings)
  initializeUpdater()
  await migrateLegacyFrontendData().catch((error) => {
    console.error('Failed to remove retired frontend data; cleanup will retry next launch:', error)
  })
  startDockSupervisor()
  createWindow()
  createTray()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Exora continues supervising Dock runtime services from the tray.
})

app.on('before-quit', (event) => {
  appIsQuitting = true
  stopDockSupervisor()
  if (dockShutdownComplete) return
  event.preventDefault()
  if (!dockShutdownPromise) {
    dockShutdownPromise = Promise.resolve(dockSupervisorTask)
      .catch(() => undefined)
      .then(() => dockPaths())
      .then((paths) => stopTrackedDaemon(paths))
      .catch((error) => console.error('Failed to stop the Electron-owned Dock runtime:', error))
      .finally(() => {
        dockShutdownComplete = true
        app.quit()
      })
  }
})

function createTray() {
  if (!tray) tray = new Tray(WINDOW_ICON)
  updateTrayMenu()
  tray.removeAllListeners('double-click')
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus() })
}

function updateTrayMenu() {
  if (!tray) return
  const chinese = currentAppSettings.language === 'zh'
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: chinese ? '鎵撳紑 Exora Dock' : 'Open Exora Dock', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: chinese ? '退出' : 'Quit', click: () => { appIsQuitting = true; app.quit() } },
  ]))
}

function registerIpc() {
  registerIpcHandlers(ipcMain, createIpcHandlerGroups(), {
    validateSender: (event) => isTrustedIpcSender(event, APP_URL_POLICY),
    timeoutForCommand: desktopCommandTimeoutMs,
  })
}

const INTERACTIVE_OR_STREAMING_COMMANDS = new Set([
  'system_choose_download_directory',
  'system_update_install',
])

function desktopCommandTimeoutMs(command) {
  if (INTERACTIVE_OR_STREAMING_COMMANDS.has(command)) return 0
  if (command === 'provider_host_scan') return 75000
  if (command === 'consumer_invoke_operation') return 190000
  return 45000
}

function createIpcHandlerGroups() {
  return {
    window: {
      window_minimize,
      window_toggle_maximize,
      window_close,
      window_set_mode,
    },
    cloudIdentity: {
      auth_status,
      auth_registration_start,
      auth_registration_complete,
      auth_login,
      auth_password_reset_start,
      auth_password_reset_complete,
      auth_pin_set,
      auth_pin_change,
      auth_pin_reset,
      auth_logout,
    },
    dockRuntime: {
      app_status,
      release_status,
      restart_dock,
      mcp_connectivity_test,
      daemon_status,
      open_console,
      open_health,
      open_manifest,
      open_logs,
      copy_mcp_command,
      copy_agent_prompt,
      copy_opencode_config,
      copy_rest_base_url,
      agent_mcp_status,
      agent_mcp_register,
      agent_mcp_remove,
      agent_mcp_repair,
      agent_mcp_probe,
    },
    persistence: {
      app_settings_load,
      save_app_settings,
      locale_status,
      set_locale,
      system_settings_status,
      system_notification_test,
      system_choose_download_directory,
      system_open_path,
      system_clear_storage,
      system_update_check,
      system_update_install,
    },
    apiMarket: {
      catalog_products,
      catalog_product,
      catalog_listings,
      api_order_status,
      api_order_deactivate,
      api_order_reactivation_request,
      consumer_approval_decide,
      consumer_account_balance,
      consumer_purchase_estimate,
      consumer_invoke_operation,
      activity_sessions,
      activity_session,
      provider_listings,
      provider_listing_save,
      provider_listing_action,
      provider_listing_delete,
      provider_api_drafts,
      provider_api_create,
      provider_api_delete,
		provider_api_update_identity,
      provider_api_submit,
			provider_api_update,
      provider_api_update_operation,
      provider_api_contract_submit,
		provider_api_contract_clear,
      provider_api_contract_validate,
      provider_api_contract_confirm,
      provider_api_connectivity_test,
      provider_api_lock_integration,
      provider_api_unlock_integration,
      provider_api_billing_test,
      provider_api_lock_pricing,
      provider_api_unlock_pricing,
      provider_api_lifecycle,
      provider_api_operational_settings,
      provider_api_publish,
    },
    walletAndSecurity: {
      wallet_status,
      wallet_spend_policy_save,
      wallet_withdraw,
      security_status,
      account_api_key_status,
      account_api_key_ensure,
      account_api_key_import,
      account_api_key_rotate,
      account_api_key_revoke,
      agent_session_policy_get,
      agent_session_policy_save,
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
  if (currentAppSettings.closeBehavior === 'quit') {
    appIsQuitting = true
    app.quit()
  } else {
    mainWindow?.hide()
  }
}

async function window_set_mode(payload = {}) {
  const mode = payload?.mode
  if (!Object.prototype.hasOwnProperty.call(WINDOW_PROFILES, mode)) {
    throw new Error(`unsupported window mode: ${String(mode)}`)
  }
  if (!mainWindow || mainWindow.isDestroyed()) return { mode }

  const profile = WINDOW_PROFILES[mode]
  mainWindow.setMinimumSize(profile.minWidth, profile.minHeight)

  if (mode !== activeWindowMode && !mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
    const display = screen.getDisplayMatching(mainWindow.getBounds())
    const size = windowSizeForWorkArea(profile, display.workArea)
    mainWindow.setSize(size.width, size.height, true)
  }

  activeWindowMode = mode
  const [minWidth, minHeight] = mainWindow.getMinimumSize()
  return { mode, bounds: mainWindow.getBounds(), minWidth, minHeight }
}

function windowSizeForWorkArea(profile, workArea) {
  return {
    width: Math.max(profile.minWidth, Math.min(profile.width, workArea.width)),
    height: Math.max(profile.minHeight, Math.min(profile.height, workArea.height)),
  }
}

async function auth_status() { return cloudAuth.status() }
async function auth_registration_start(payload) { return cloudAuth.registrationStart(payload) }
async function auth_registration_complete(payload) { return cloudAuth.registrationComplete(payload) }
async function auth_login(payload) {
  const result = await cloudAuth.login(payload)
  await syncStoredAccountKeyToDock().catch(() => undefined)
  return result
}
async function auth_password_reset_start(payload) { return cloudAuth.passwordResetStart(payload) }
async function auth_password_reset_complete(payload) { return cloudAuth.passwordResetComplete(payload) }
async function auth_pin_set(payload) {
  const result = await cloudAuth.setPIN(payload)
  const accountKey = await account_api_key_ensure().catch((error) => ({ error: errorMessage(error) }))
  return { ...result, accountKey }
}
async function auth_pin_change(payload) { return cloudAuth.changePIN(payload) }
async function auth_pin_reset(payload) { return cloudAuth.resetPIN(payload) }
async function auth_logout() {
	const paths = await dockPaths()
	await httpJson('POST', '/v4/local/provider/offline-for-logout', {}, await localOwnerToken(paths), { timeoutMs: 120000 })
  await lockLocalAccountKey().catch(() => undefined)
  return cloudAuth.logout()
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
    logsDir: paths.logsDir,
    version: String(app.getVersion() || ''),
    releaseChannel: 'technical-preview',
    authentiCodeSigned: false,
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
  if (await healthOk()) {
    await syncStoredAccountKeyToDock({ retryOnOffline: false }).catch(() => undefined)
  }
  return app_status()
}

async function restart_dock() {
  const paths = await dockPaths()
  await stopTrackedDaemon(paths)
  return start_dock()
}

function ensureElectronDockRuntime() {
  if (appIsQuitting) return Promise.resolve()
  if (dockSupervisorTask) return dockSupervisorTask
  dockSupervisorTask = (async () => {
    try {
      if (!(await healthOk())) await start_dock()
    } catch (error) {
      console.error('Failed to start or recover the Electron-owned Dock runtime:', error)
    }
  })().finally(() => { dockSupervisorTask = undefined })
  return dockSupervisorTask
}

function startDockSupervisor() {
  if (dockSupervisorTimer) return
  void ensureElectronDockRuntime()
  dockSupervisorTimer = setInterval(() => { void ensureElectronDockRuntime() }, DOCK_SUPERVISOR_INTERVAL_MS)
  dockSupervisorTimer.unref?.()
}

function stopDockSupervisor() {
  if (!dockSupervisorTimer) return
  clearInterval(dockSupervisorTimer)
  dockSupervisorTimer = undefined
}

async function mcp_connectivity_test() {
  const paths = await dockPaths()
  const runtime = await start_dock()
  if (runtime.daemon !== 'healthy') throw new Error(statusMessage(runtime))
  return probeMCPConnectivity([paths.helperPath, 'mcp', paths.configPath], {
    cwd: paths.rootDir,
    timeoutMs: 30000,
  })
}

async function agentMCPRegistry() {
  const paths = await dockPaths()
  await ensureLocalLayout(paths)
  await writeDiscoveryManifest(paths)
  return createAgentMCPRegistry({
    platform: process.platform,
    homeDir: app.getPath('home'),
    appData: process.env.APPDATA,
    helperPath: paths.helperPath,
    configPath: paths.configPath,
    registryPath: path.join(paths.persistenceDir, 'settings', 'agent-mcp-registry.json'),
  })
}

async function agent_mcp_status() {
  const registry = await agentMCPRegistry()
  return { clients: await registry.list({ passive: true }) }
}

async function agent_mcp_register(payload = {}) {
  const clientIds = Array.isArray(payload?.input?.instanceIds) ? payload.input.instanceIds : Array.isArray(payload?.input?.clientIds) ? payload.input.clientIds : []
  const registry = await agentMCPRegistry()
  return registry.register(clientIds)
}

async function agent_mcp_remove(payload = {}) {
  const registry = await agentMCPRegistry()
  return registry.remove(String(payload?.input?.clientId || ''), String(payload?.input?.instanceId || ''))
}

async function agent_mcp_repair(payload = {}) {
  const registry = await agentMCPRegistry()
  return registry.repair(String(payload?.input?.clientId || ''), String(payload?.input?.instanceId || ''))
}

async function agent_mcp_probe() {
  const paths = await dockPaths()
  const runtime = await start_dock()
  if (runtime.daemon !== 'healthy') throw new Error(statusMessage(runtime))
  return probeMCPConnectivity([paths.helperPath, 'mcp', paths.configPath], {
    cwd: paths.rootDir,
    timeoutMs: 20000,
    includeMarketplace: false,
  })
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

async function copy_agent_prompt(payload = {}) {
  const requested = payload?.input?.text
  if (requested !== undefined && typeof requested !== 'string') throw new Error('Clipboard text must be a string.')
  const text = requested === undefined ? agentPrompt() : requested
  if (!text.trim()) throw new Error('Clipboard text is empty.')
  if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw new Error('Clipboard text exceeds the 1 MiB limit.')
  clipboard.writeText(text)
  return text
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

async function app_settings_load() {
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const settingsDoc = await readJsonOr(paths.appSettingsPath, {})
  currentAppSettings = normalizeAppSettingsV3(settingsDoc.settings || settingsDoc)
  return {
    version: SETTINGS_VERSION,
    settings: currentAppSettings,
  }
}

function releaseVerificationKey() {
  const candidate = app.isPackaged ? path.join(process.resourcesPath, 'release-signing-public-key.txt') : path.join(__dirname, '..', 'resources', 'release-signing-public-key.txt')
  return fs.existsSync(candidate) ? fs.readFileSync(candidate, 'utf8').trim() : ''
}

async function release_status() {
  const manifestURL = String(process.env.EXORA_RELEASE_MANIFEST_URL || 'https://github.com/UmbraFi/exora-dock/releases/download/v0.1.0-preview.3/release-manifest.json').trim()
  const signatureURL = manifestURL.replace(/release-manifest\.json(?:\?.*)?$/, 'release-manifest.sig')
  const [manifestResult, signatureResult] = await Promise.all([
    fetchArrayBufferWithTimeout(manifestURL, {}, 15000),
    fetchTextWithTimeout(signatureURL, {}, 15000),
  ])
  const manifestResponse = manifestResult.response
  const signatureResponse = signatureResult.response
  if (!manifestResponse.ok || !signatureResponse.ok) throw new Error('The signed Technical Preview release manifest is unavailable.')
  const encoded = Buffer.from(manifestResult.arrayBuffer)
  const signature = Buffer.from(signatureResult.text.trim(), 'base64')
  const raw = Buffer.from(releaseVerificationKey(), 'base64')
  if (raw.length !== 32) throw new Error('Release verification key is not configured.')
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw])
  const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' })
  if (!crypto.verify(null, encoded, key, signature)) throw new Error('Release manifest signature verification failed.')
  const manifest = JSON.parse(encoded.toString('utf8'))
  const artifact = selectReleaseArtifact(manifest, process.platform, process.arch)
  return {
    currentVersion: String(app.getVersion() || ''),
    latestVersion: String(manifest.version || ''),
    updateAvailable: String(manifest.version || '').replace(/^v/, '') !== String(app.getVersion() || ''),
    artifact: artifact.artifact,
    sha256: artifact.sha256,
    authentiCodeSigned: artifact.signing?.scheme === 'authenticode' && artifact.signing?.status === 'signed',
    warning: releaseWarningForArtifact(artifact),
    downloadURL: new URL(String(artifact.artifact), manifestURL).toString(),
  }
}

async function save_app_settings(payload = {}) {
  const paths = await dockPaths()
  await ensurePersistenceLayout(paths)
  const input = objectOr(payload.input || payload)
  const settings = normalizeAppSettingsV3(input.settings || input)
  await writeJsonAtomic(paths.appSettingsPath, {
    version: SETTINGS_VERSION,
    savedAt: new Date().toISOString(),
    settings,
  })
  currentAppSettings = settings
  applyDesktopSettings(settings)
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
  const settings = normalizeAppSettingsV3({ ...objectOr(current.settings || current), language })
  await writeJsonAtomic(paths.appSettingsPath, {
    ...current,
    version: SETTINGS_VERSION,
    savedAt: new Date().toISOString(),
    settings,
  })
  currentAppSettings = settings
  applyDesktopSettings(settings)
  return {
    saved: true,
    language,
    chromiumLocale: chromiumLocaleForLanguage(language),
    htmlLang: htmlLangForLanguage(language),
    path: paths.appSettingsPath,
  }
}

async function wallet_status() {
  const addressRequest = cloudAuth.apiRequest('GET', '/v4/billing/deposit-address').catch((error) => {
    if (Number(error?.status || 0) === 423 || Number(error?.status || 0) === 503) return {}
    throw error
  })
	const [balanceResult, custodyResult, depositsResult, withdrawalsResult, spendPolicyResult, addressResult] = await Promise.all([
    cloudAuth.apiRequest('GET', '/v4/billing/balance'),
    cloudAuth.apiRequest('GET', '/v4/billing/custody-status'),
    cloudAuth.apiRequest('GET', '/v4/billing/deposits'),
    cloudAuth.apiRequest('GET', '/v4/billing/withdrawals'),
		cloudAuth.apiRequest('GET', '/v4/account/spend-policy'),
    addressRequest,
  ])
  const balance = objectOr(balanceResult.balance || balanceResult)
  const address = String(addressResult.address || '').trim()
  return {
    wallet: {
      configured: Boolean(address),
      accountBound: true,
      platformCustody: true,
      address,
      network: String(addressResult.network || custodyResult.network || ''),
      usdcMint: String(addressResult.mint || custodyResult.mint || ''),
      balances: {
        usdc: {
          amountAtomic: Number(balance.availableAtomic || 0),
          reservedAtomic: Number(balance.withdrawalReservedAtomic || balance.reservedAtomic || 0),
          decimals: 6,
          currency: 'USDC',
          mint: String(addressResult.mint || custodyResult.mint || ''),
          status: custodyResult.mode === 'open' && !custodyResult.accountFrozen ? 'ready' : String(custodyResult.accountFrozen ? 'account_frozen' : custodyResult.mode || 'disabled'),
          updatedAt: new Date().toISOString(),
        },
      },
      feePolicy: { currency: 'USDC', relayFeeAtomic: 0, relayFeeDescription: 'The final network and service fees are shown in the withdrawal quote.', gasPaidBy: 'platform' },
      custody: custodyResult,
      deposits: Array.isArray(depositsResult.deposits) ? depositsResult.deposits : [],
      withdrawals: Array.isArray(withdrawalsResult.withdrawals) ? withdrawalsResult.withdrawals : [],
			agentSpendPolicy: objectOr(spendPolicyResult.spendPolicy || spendPolicyResult),
    },
  }
}

function applyDesktopSettings(settings) {
  currentAppSettings = normalizeAppSettingsV3(settings)
  nativeTheme.themeSource = currentAppSettings.theme
  if (app.isReady()) {
    app.setLoginItemSettings({
      openAtLogin: currentAppSettings.launchAtLogin,
      openAsHidden: currentAppSettings.startMinimized,
      args: currentAppSettings.startMinimized ? ['--hidden'] : [],
    })
  }
  updateTrayMenu()
}

function initializeUpdater() {
  updaterConfigured = Boolean(releaseVerificationKey())
  updaterState.state = updaterConfigured ? 'idle' : app.isPackaged ? 'unavailable' : 'development'
  updaterState.message = updaterConfigured
    ? 'Signed Technical Preview release checks are ready.'
    : app.isPackaged ? 'The release verification key is not configured.' : 'Signed release checks are available after packaging.'
}

function updateUpdaterState(state, message) {
  updaterState.state = state
  updaterState.message = message
  updaterState.checkedAt = new Date().toISOString()
}

async function system_settings_status() {
  const paths = await dockPaths()
  const [runtime, storage, desktopState] = await Promise.all([
    app_status().catch((error) => ({ container: 'unknown', daemon: 'offline', message: errorMessage(error) })),
    storageSnapshot(paths),
    readDesktopState(paths),
  ])
  const cloudURL = await configuredCloudURL(paths, desktopState)
  const login = app.getLoginItemSettings()
  const downloadDirectory = currentAppSettings.downloadDirectory || app.getPath('downloads')
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    capabilities: Object.freeze({ apiMarketplace: true, sellerLocal: true }),
    packaged: app.isPackaged,
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    notificationsSupported: Notification.isSupported(),
    notificationPermission: Notification.isSupported() ? 'available' : 'unsupported',
    loginItem: { openAtLogin: login.openAtLogin, openAsHidden: login.openAsHidden },
    paths: {
      data: paths.dataDir,
      logs: paths.logsDir,
      settings: paths.appSettingsPath,
      manifest: paths.discoveryPath,
      downloads: downloadDirectory,
    },
    storage,
    runtime,
    cloudURL: cloudURL || process.env.EXORA_CLOUD_URL || '',
    update: updateStatus(),
  }
}

async function system_notification_test(payload = {}) {
  if (!Notification.isSupported()) throw new Error('System notifications are not supported on this device.')
  const input = objectOr(payload.input || payload)
  const chinese = normalizeAppLanguage(input.language || currentAppSettings.language) === 'zh'
  const notification = new Notification({
    title: chinese ? 'Exora Dock 通知已就绪' : 'Exora Dock notifications are ready',
    body: chinese ? '审批、API、资金与账户事件可在此设备上提醒你。' : 'Approvals, API, billing, and account events can alert you on this device.',
    icon: WINDOW_ICON,
  })
  notification.show()
  return { delivered: true }
}

async function system_choose_download_directory() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: currentAppSettings.language === 'zh' ? '閫夋嫨榛樿涓嬭浇鐩綍' : 'Choose default download directory',
    defaultPath: currentAppSettings.downloadDirectory || app.getPath('downloads'),
    properties: ['openDirectory', 'createDirectory'],
  })
  return { canceled: result.canceled, path: result.filePaths[0] || '' }
}

async function system_open_path(payload = {}) {
  const paths = await dockPaths()
  const input = objectOr(payload.input || payload)
  const allowed = {
    data: paths.dataDir,
    logs: paths.logsDir,
    settings: paths.appSettingsPath,
    manifest: paths.discoveryPath,
    downloads: currentAppSettings.downloadDirectory || app.getPath('downloads'),
  }
  const target = allowed[String(input.kind || '')]
  if (!target) throw new Error('Unsupported app path.')
  await fsp.mkdir(path.extname(target) ? path.dirname(target) : target, { recursive: true })
  await openPath(target)
  return { opened: true }
}

async function system_clear_storage(payload = {}) {
  const paths = await dockPaths()
  const input = objectOr(payload.input || payload)
  const kind = String(input.kind || '')
  if (kind === 'cache') {
    await session.defaultSession.clearCache()
  } else if (kind === 'logs') {
    await emptyDirectory(paths.logsDir)
  } else if (kind === 'temporary') {
    await emptyDirectory(dockTemporaryRoot())
  } else {
    throw new Error('Unsupported storage category.')
  }
  return { cleared: true, storage: await storageSnapshot(paths) }
}

async function system_update_check() {
  if (!updaterConfigured) return updateStatus(true)
  updateUpdaterState('checking', 'Verifying the signed Technical Preview release manifest…')
  const release = await release_status()
  updaterState.version = release.latestVersion
  updaterState.downloadURL = release.downloadURL
  updaterState.sha256 = release.sha256
  updaterState.warning = release.warning
  updateUpdaterState(release.updateAvailable ? 'available' : 'current', release.updateAvailable ? 'A verified Technical Preview update is available. Download it in your browser and verify the displayed SHA-256.' : 'Exora Dock is up to date.')
  return updateStatus(true)
}

async function system_update_install(payload = {}) {
  const input = objectOr(payload.input || payload)
  let activeRuntimeWork = false
  try {
    const response = await activity_sessions({ input: { status: 'active', limit: 1 } })
    activeRuntimeWork = Array.isArray(response?.sessions) && response.sessions.length > 0
  } catch { /* Dock may be offline, in which case it has no active local work to interrupt. */ }
  if (input.activeWork === true || activeRuntimeWork) throw new Error('Finish active API invocations and seller tasks before installing the update.')
  if (!updaterConfigured || updaterState.state !== 'available' || !updaterState.downloadURL) throw new Error('No verified Technical Preview download is available.')
  await shell.openExternal(updaterState.downloadURL)
  return { opened: true, sha256: updaterState.sha256, warning: updaterState.warning }
}

function updateStatus(checked = false) {
  return {
    supported: updaterConfigured,
    channel: 'technical-preview',
    automatic: false,
    state: updaterState.state,
    version: updaterState.version,
    progress: updaterState.progress,
    checkedAt: checked ? updaterState.checkedAt || new Date().toISOString() : updaterState.checkedAt,
    message: updaterState.message,
    downloadURL: updaterState.downloadURL,
    sha256: updaterState.sha256,
    warning: updaterState.warning,
  }
}

function dockTemporaryRoot() {
  return path.join(app.getPath('temp'), 'exora-dock', 'desktop-temporary')
}

async function storageSnapshot(paths) {
  const [dataBytes, logsBytes, cacheBytes, tempBytes] = await Promise.all([
    directorySize(paths.dataDir),
    directorySize(paths.logsDir),
    app.isReady() ? session.defaultSession.getCacheSize().catch(() => 0) : Promise.resolve(0),
    directorySize(dockTemporaryRoot()),
  ])
  return { dataBytes, logsBytes, cacheBytes, tempBytes }
}

async function directorySize(root) {
  let total = 0
  const queue = [root]
  while (queue.length) {
    const current = queue.pop()
    let entries
    try { entries = await fsp.readdir(current, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) queue.push(target)
      else if (entry.isFile()) {
        try { total += (await fsp.stat(target)).size } catch { /* file changed while measuring */ }
      }
    }
  }
  return total
}

async function emptyDirectory(root) {
  await fsp.mkdir(root, { recursive: true })
  const entries = await fsp.readdir(root)
  await Promise.all(entries.map((entry) => fsp.rm(path.join(root, entry), { recursive: true, force: true })))
}

async function wallet_spend_policy_save(payload = {}) {
	const input = payload.input || {}
	const pin = String(input.pin || '').trim()
	if (!/^\d{6}$/.test(pin)) throw new Error('Payment PIN must be exactly 6 digits.')
	const enabled = input.enabled === true
	const singleLimitAtomic = Math.max(0, Math.trunc(Number(input.singleLimitAtomic || 0)))
	const periodLimitAtomic = Math.max(0, Math.trunc(Number(input.periodLimitAtomic || 0)))
	if (enabled && (!singleLimitAtomic || !periodLimitAtomic || periodLimitAtomic < singleLimitAtomic)) throw new Error('Enter positive limits and keep the 24-hour limit at least as large as the single-payment limit.')
	return cloudAuth.apiRequest('PUT', '/v4/account/spend-policy', { enabled, singleLimitAtomic, periodLimitAtomic, periodSeconds: 86400, pin })
}

async function wallet_withdraw(payload) {
  const input = payload?.input ?? {}
  const challengeId = String(input.challengeId || '').trim()
  const quoteId = String(input.quoteId || '').trim()
  const code = String(input.code || '').trim()
	if (input.resend === true) {
		const quote = objectOr(input.quote)
		const pin = String(input.pin || '').trim()
		if (!quoteId || !String(quote.requestFingerprint || '') || !/^\d{6}$/.test(pin)) throw new Error('A valid quote and six-digit payment PIN are required to resend the code.')
		const authorization = await cloudAuth.apiRequest('POST', '/v1/auth/payment-pin/authorizations', {
			pin, purpose: 'withdrawal', requestFingerprint: String(quote.requestFingerprint),
		})
		const challenge = await cloudAuth.apiRequest('POST', '/v4/billing/withdrawal-challenges', {
			quoteId, pinAuthorizationToken: authorization.authorizationToken,
		})
		return { quote, challenge, nextAction: 'enter_email_code' }
	}
  if (!challengeId || !quoteId || !code) {
	const pin = String(input.pin || '').trim()
	if (!/^\d{6}$/.test(pin)) throw new Error('Payment PIN must be exactly 6 digits.')
    const quote = await cloudAuth.apiRequest('POST', '/v4/billing/withdrawal-quotes', {
      destination: String(input.toAddress || '').trim(),
      amountAtomic: Number(input.amountAtomic || 0),
    })
	const authorization = await cloudAuth.apiRequest('POST', '/v1/auth/payment-pin/authorizations', {
		pin, purpose: 'withdrawal', requestFingerprint: String(quote.requestFingerprint || ''),
	})
	const challenge = await cloudAuth.apiRequest('POST', '/v4/billing/withdrawal-challenges', {
		quoteId: quote.quoteId, pinAuthorizationToken: authorization.authorizationToken,
	})
    return { quote, challenge, nextAction: 'enter_email_code' }
  }
  const withdrawal = await cloudAuth.apiRequest('POST', '/v4/billing/withdrawals', {
    quoteId,
    challengeId,
    code,
    idempotencyKey: String(input.idempotencyKey || `electron-${crypto.randomUUID()}`),
  })
  return { withdrawal, nextAction: withdrawal.status === 'manual_review' ? 'manual_review' : 'processing' }
}

async function security_status() {
  let pin
  try {
	  pin = await cloudAuth.apiRequest('GET', '/v1/auth/payment-pin')
  } catch (error) {
	  pin = { configured: false, error: errorMessage(error) }
  }
  return {
	  paymentPinConfigured: pin?.configured === true,
	  paymentPinLockedUntil: String(pin?.lockedUntil || ''),
	  cloudManaged: true,
  }
}

function decryptStoredAccountKey(state, accountID) {
  const record = objectOr(state.accountAPIKey)
  if (String(record.accountId || '') !== String(accountID || '') || record.storageMode !== 'safeStorage' || !record.encryptedKey || !safeStorage.isEncryptionAvailable()) return ''
  try { return safeStorage.decryptString(Buffer.from(String(record.encryptedKey), 'base64')) } catch { return '' }
}

async function storeAccountKey(accountID, key, accessKey = {}) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Operating system secure storage is required for an account API key.')
  const paths = await dockPaths()
  const state = await readDesktopState(paths)
  state.accountAPIKey = {
    accountId: String(accountID),
    storageMode: 'safeStorage',
    encryptedKey: safeStorage.encryptString(String(key)).toString('base64'),
    maskedKey: String(accessKey.maskedKey || `sk-exora-...${String(key).slice(-6)}`),
    tokenId: String(accessKey.tokenId || ''),
    createdAt: String(accessKey.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString(),
  }
  await writeDesktopState(paths, state)
}

async function syncAccountKeyToDock(accountID, key, options = {}) {
  const paths = await dockPaths()
  await httpJson('PUT', '/v4/local/account-key', { accountId: accountID, key }, await localOwnerToken(paths), options)
}

async function trySyncAccountKeyToDock(accountID, key, options = {}) {
  try {
    await syncAccountKeyToDock(accountID, key, options)
    return { dockConfigured: true, dockSyncPending: false }
  } catch {
    return { dockConfigured: false, dockSyncPending: true }
  }
}

async function syncStoredAccountKeyToDock(options = {}) {
  const connection = await cloudAuth.connection()
  const paths = await dockPaths()
  const state = await readDesktopState(paths)
  const key = decryptStoredAccountKey(state, connection.account?.accountId)
  if (!key) return { configured: false, requiresImport: true }
  await syncAccountKeyToDock(connection.account.accountId, key, options)
  return { configured: true }
}

async function lockLocalAccountKey() {
  const paths = await dockPaths()
  return httpJson('DELETE', '/v4/local/account-key', undefined, await localOwnerToken(paths))
}

async function account_api_key_status() {
  const connection = await cloudAuth.connection()
  const paths = await dockPaths()
  const state = await readDesktopState(paths)
  const stored = Boolean(decryptStoredAccountKey(state, connection.account?.accountId))
  const cloud = await cloudAuth.apiRequest('GET', '/v4/account/api-key')
  const local = await httpJson('GET', '/v4/local/account-key', undefined, await localOwnerToken(paths)).catch(() => ({ configured: false }))
  return {
    accessKey: cloud.accessKey || null,
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    stored,
    dockConfigured: local.configured === true,
    requiresImport: Boolean(cloud.accessKey) && !stored,
  }
}

async function account_api_key_ensure() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable; Exora did not create a long-term account key.')
  const connection = await cloudAuth.connection()
  const paths = await dockPaths()
  const state = await readDesktopState(paths)
  const existing = decryptStoredAccountKey(state, connection.account?.accountId)
  const response = await cloudAuth.apiRequest('POST', '/v4/account/api-key/ensure', {})
  const key = String(response.token || '')
  if (!key && existing) {
    const dock = await trySyncAccountKeyToDock(connection.account.accountId, existing)
    return { created: false, configured: true, accessKey: response.accessKey, ...dock }
  }
  if (!key) return { created: false, configured: false, requiresImport: Boolean(response.accessKey), accessKey: response.accessKey }
  await storeAccountKey(connection.account.accountId, key, response.accessKey)
  const dock = await trySyncAccountKeyToDock(connection.account.accountId, key)
  return { created: true, configured: true, token: key, accessKey: response.accessKey, ...dock }
}

async function account_api_key_import(payload = {}) {
  const key = String(payload?.input?.key || '').trim()
  if (!/^sk-exora-[a-f0-9]{64}$/.test(key)) throw new Error('Enter a valid sk-exora account key.')
  const connection = await cloudAuth.connection()
  const verified = await cloudAbsoluteJSON(connection.cloudURL, 'GET', '/v4/account/balance', undefined, key)
  if (String(verified?.balance?.accountId || '') !== connection.account.accountId) throw new Error('This account key belongs to a different Exora account.')
  const status = await cloudAuth.apiRequest('GET', '/v4/account/api-key')
  await storeAccountKey(connection.account.accountId, key, status.accessKey || {})
  await syncAccountKeyToDock(connection.account.accountId, key)
  return { configured: true, accessKey: status.accessKey }
}

async function account_api_key_rotate(payload = {}) {
  const pin = String(payload?.input?.pin || '').trim()
  if (!/^\d{6}$/.test(pin)) throw new Error('Payment PIN must be exactly 6 digits.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is required before rotating the account key.')
  const connection = await cloudAuth.connection()
  const response = await cloudAuth.apiRequest('POST', '/v4/account/api-key/rotate', { pin })
  const key = String(response.token || '')
  if (!key) throw new Error('Cloud did not return the new account key.')
  await storeAccountKey(connection.account.accountId, key, response.accessKey)
  await syncAccountKeyToDock(connection.account.accountId, key)
  return { configured: true, token: key, accessKey: response.accessKey }
}

async function account_api_key_revoke(payload = {}) {
  const pin = String(payload?.input?.pin || '').trim()
  if (!/^\d{6}$/.test(pin)) throw new Error('Payment PIN must be exactly 6 digits.')
  const result = await cloudAuth.apiRequest('DELETE', '/v4/account/api-key', { pin })
  const paths = await dockPaths()
  const state = await readDesktopState(paths)
  delete state.accountAPIKey
  await writeDesktopState(paths, state)
  await lockLocalAccountKey().catch(() => undefined)
  return result
}

async function agent_session_policy_get() {
  const paths = await dockPaths()
  return httpJson('GET', '/v4/local/agent-session-policy', undefined, await localOwnerToken(paths))
}

async function agent_session_policy_save(payload = {}) {
  const scopes = Array.isArray(payload?.input?.scopes) ? payload.input.scopes.map((value) => String(value || '').trim()).filter(Boolean) : []
  const paths = await dockPaths()
  return httpJson('PUT', '/v4/local/agent-session-policy', { scopes }, await localOwnerToken(paths), { timeoutMs: 15000 })
}

async function daemon_status() {
  const status = await app_status()
  return `${status.docker} / ${status.container} / ${status.daemon}`
}

async function open_console() {
  await open_health()
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
    providerHostSnapshotPath: path.join(persistenceDir, 'settings', 'provider-host-snapshot.json'),
    providerEnvironmentSettingsPath: path.join(persistenceDir, 'settings', 'provider-environment.json'),
    helperPath,
    pidPath: path.join(rootDir, 'exora-dockd.pid'),
  }
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
  await writeJsonAtomic(paths.desktopStatePath, value)
}

async function ensurePersistenceLayout(paths) {
  await fsp.mkdir(path.dirname(paths.appSettingsPath), { recursive: true })
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

async function migrateLegacyFrontendData() {
  const paths = await dockPaths()
  return cleanupLegacyFrontendData({ paths, readJson: readJsonOr, writeJson: writeJsonAtomic, removeFile: (target) => fsp.rm(target, { force: true }) })
}

function resolveBundledBinary(baseName) {
  const name = process.platform === 'win32' ? `${baseName}.exe` : baseName
  const candidates = []
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, 'binaries', name))
  candidates.push(path.join(app.getAppPath(), 'binaries', name))
  candidates.push(path.join(__dirname, '..', 'binaries', name))
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
}

async function ensureLocalLayout(paths) {
	await fsp.mkdir(paths.dataDir, { recursive: true })
	await fsp.mkdir(paths.logsDir, { recursive: true })
  if (!fs.existsSync(paths.configPath)) {
    await fsp.writeFile(paths.configPath, defaultLocalConfig(paths))
	} else {
		await migrateLocalConfig(paths)
	}
	await migrateSellerAutomationData(paths)
}

async function migrateSellerAutomationData(paths) {
  const root = path.join(paths.dataDir, 'seller-automation', 'imported-v1')
  const marker = path.join(root, 'migration.json')
  if (fs.existsSync(marker)) return
  const retiredMaterials = path.join(app.getPath('userData'), 'api-bridge-materials')
  await fsp.rm(retiredMaterials, { recursive: true, force: true })
  await fsp.mkdir(root, { recursive: true })
  await writeJsonAtomic(marker, { schemaVersion: 3, retiredMaterialsRemoved: true, completedAt: new Date().toISOString() })
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

function readStartupAppSettingsSync() {
  const envLanguage = process.env.EXORA_DOCK_LANGUAGE || process.env.EXORA_LANGUAGE
  try {
    const settingsPath = path.join(app.getPath('userData'), PERSISTENCE_DIR_NAME, 'settings', 'settings.json')
    const raw = fs.readFileSync(settingsPath, 'utf8')
    const value = JSON.parse(raw)
    return normalizeAppSettingsV3({
      ...objectOr(value?.settings || value),
      ...(envLanguage ? { language: normalizeAppLanguage(envLanguage) } : {}),
    })
  } catch {
    return normalizeAppSettingsV3(envLanguage ? { language: normalizeAppLanguage(envLanguage) } : {})
  }
}

function resolvedStartupTheme() {
  if (STARTUP_SETTINGS.theme === 'light' || STARTUP_SETTINGS.theme === 'dark') return STARTUP_SETTINGS.theme
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
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
    execFile(program, args, { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
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
  return 'Read the local ExoraDock agent-discovery.json, start the stdio MCP server from mcpCommand, and follow the server-enforced Integration Session nextActions. Adapt only human-authorized code, functions, CLI programs, or HTTP APIs into an Exora Adapter. Never approve execution, submit credentials, confirm commercial rights, set the final price, create a private draft, or publish on the owner’s behalf.'
}

function opencodeConfigString(helperPath, configPath) {
  return JSON.stringify(opencodeConfigValue(helperPath, configPath), null, 2)
}

function opencodeConfigValue(helperPath, configPath) {
  return {
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      'exora-dock': {
        type: 'local',
        command: [helperPath, 'mcp', configPath],
        enabled: true,
        environment: { EXORA_MCP_CLIENT_NAME: 'OpenCode' },
      },
    },
  }
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
      { name: 'security.session_key', description: 'Each MCP initialize creates a local-only scoped session key; Cloud accepts account keys only.' },
      { name: 'provider.integration.local', description: 'The user’s Agent can adapt authorized code, functions, CLIs, or local HTTP APIs into a local_dock Exora Adapter.' },
      { name: 'provider.integration.cloud', description: 'The user’s Agent can adapt an authorized public HTTPS API into a cloud_direct Exora Adapter.' },
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
listen_addr: "127.0.0.1:8080"
cache_max_mb: 256
data_dir: ${yamlQuote(paths.dataDir)}
mode: "hybrid"
cloud_url: ""
dock_id: ""
auth_token_path: ${yamlQuote(path.join(paths.dataDir, 'auth.json'))}
cloud_token_path: ${yamlQuote(path.join(paths.dataDir, 'cloud-token.json'))}
cors_allowed_origins:
  - "http://localhost:*"
  - "http://127.0.0.1:*"
  - "https://exoradock.com"
  - "https://www.exoradock.com"
`
}

async function localOwnerToken(paths) {
  const tokens = await localAuthTokens(paths)
  if (!String(tokens.ownerToken || '').trim()) throw new Error('owner token missing')
  return tokens.ownerToken
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
  return httpJson('GET', `/v4/catalog/products${q ? `?q=${encodeURIComponent(q)}` : ''}`, undefined, await localOwnerToken(await dockPaths()))
}

async function catalog_product(payload = {}) {
  return httpJson('GET', `/v4/catalog/products/${encodeURIComponent(String(payload?.input?.id || ''))}`, undefined, await localOwnerToken(await dockPaths()))
}

async function catalog_listings(payload = {}) {
  const input = payload?.input || {}
  const query = new URLSearchParams()
  for (const key of ['q', 'applicationSource']) {
    const value = String(input[key] || '').trim()
    if (value) query.set(key, value)
  }
  const result = await httpJson('GET', `/v4/catalog/operations${query.size ? `?${query}` : ''}`, undefined, await localOwnerToken(await dockPaths()))
  const operations = Array.isArray(result?.operations) ? result.operations : []
  return { operations }
}


async function configuredCloudURL(paths, state = {}) {
  let config = {}
  try {
    const raw = fs.existsSync(paths.configPath) ? await fsp.readFile(paths.configPath, 'utf8') : ''
    config = raw ? YAML.parse(raw) || {} : {}
  } catch {}
  return String(config.cloud_url || state.cloudAuth?.cloudURL || '').trim()
}

async function ensureDockLink({ paths, state, cloudURL, token, account, installationID }) {
  await ensureLocalLayout(paths)
  let config = {}
  try { config = YAML.parse(await fsp.readFile(paths.configPath, 'utf8')) || {} } catch {}
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {}
  const tokenPath = String(config.cloud_token_path || path.join(paths.dataDir, 'cloud-token.json')).trim()
  let dockID = String(state.dockId || '').trim()
  if (!dockID) {
    dockID = `dock_${String(installationID || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96)}`
    state.dockId = dockID
    await writeDesktopState(paths, state)
  }
  const existing = objectOr(await readJsonOr(tokenPath, {}))
  if (
    String(existing.accountId || '') === account.accountId &&
    String(existing.dockId || '') === dockID &&
    String(existing.cloudUrl || '').replace(/\/$/, '') === cloudURL &&
    String(existing.cloudToken || '').trim()
  ) {
    try {
      await cloudAbsoluteJSON(cloudURL, 'POST', `/v1/docks/${encodeURIComponent(dockID)}/heartbeat`, {}, existing.cloudToken)
      return { linked: true, dockId: dockID, accountId: account.accountId }
    } catch (error) {
      if (Number(error?.status || 0) !== 401) throw error
    }
  }

  const link = await cloudAbsoluteJSON(cloudURL, 'POST', '/v1/device-links', {
    dockId: dockID,
    clientKind: 'electron',
    displayName: String(app.getName() || 'Exora Dock'),
    mode: 'hybrid',
    version: String(app.getVersion() || ''),
    capabilities: ['electron.shell', 'typed.wake-jobs', 'local.payment-pin'],
  })
  await cloudAbsoluteJSON(cloudURL, 'POST', '/v1/device-links/confirm', { userCode: link.userCode }, token)
  const exchanged = await cloudAbsoluteJSON(cloudURL, 'POST', '/v1/device-links/token', { deviceCode: link.deviceCode })
  if (!String(exchanged.cloudToken || '').trim()) throw new Error('Cloud device link did not return a Dock token.')
  await writeJsonAtomic(tokenPath, {
    dockId: dockID,
    accountId: account.accountId,
    cloudUrl: cloudURL,
    cloudToken: exchanged.cloudToken,
    linkedAt: new Date().toISOString(),
  })
  await fsp.chmod(tokenPath, 0o600).catch(() => undefined)
  const configChanged = String(config.cloud_url || '').trim() !== cloudURL || String(config.dock_id || '').trim() !== dockID || String(config.cloud_token_path || '').trim() !== tokenPath
  config.cloud_url = cloudURL
  config.dock_id = dockID
  config.cloud_token_path = tokenPath
  if (configChanged) await fsp.writeFile(paths.configPath, ensureTrailingNewline(YAML.stringify(config)))
  await restart_dock()
  return { linked: true, dockId: dockID, accountId: account.accountId }
}

async function clearDockLink(paths) {
  let config = {}
  try { config = YAML.parse(await fsp.readFile(paths.configPath, 'utf8')) || {} } catch {}
  const tokenPath = String(config.cloud_token_path || path.join(paths.dataDir, 'cloud-token.json')).trim()
  await fsp.rm(tokenPath, { force: true }).catch(() => undefined)
  await stopTrackedDaemon(paths).catch(() => undefined)
  if (!appIsQuitting) void ensureElectronDockRuntime()
}

async function cloudAbsoluteJSON(cloudURL, method, route, body, token = '', timeoutMs = 15000) {
  const result = await fetchTextWithTimeout(`${String(cloudURL).replace(/\/$/, '')}${route}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    cache: 'no-store',
  }, timeoutMs)
  const { response, text } = result
  let decoded = {}
  try { decoded = text.trim() ? JSON.parse(text) : {} } catch { decoded = { error: text } }
  if (!response.ok) {
    const error = new Error(String(decoded?.error || `Exora Cloud returned ${response.status}`))
    error.status = response.status
    error.code = decoded?.code || `cloud_http_${response.status}`
    throw error
  }
  return decoded
}

async function cloudConsumerJson(method, route, body, explicitKey = '') {
  const connection = await cloudAuth.connection()
  const paths = await dockPaths()
  const state = await readDesktopState(paths)
  const key = String(explicitKey || decryptStoredAccountKey(state, connection.account?.accountId)).trim()
  if (!key) throw new Error('Import or regenerate your Exora account API key before purchasing or invoking a product.')
  const { cloudURL } = connection
  const result = await fetchTextWithTimeout(`${cloudURL}${route}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    cache: 'no-store',
  }, 180000)
  const { response, text } = result
  let decoded = {}
  try { decoded = text.trim() ? JSON.parse(text) : {} } catch { decoded = { error: text } }
  if (!response.ok) {
    throw new Error(`Exora Cloud returned ${response.status}: ${String(decoded?.error || text || response.statusText)}`)
  }
  return decoded
}

async function api_order_status(payload = {}) {
  const listingId = String(payload?.input?.listingId || '').trim()
  if (!listingId) throw new Error('listingId is required')
  const response = await cloudAuth.apiRequest('GET', `/v4/api-orders/${encodeURIComponent(listingId)}?role=buyer`)
  return { order: desktopAPIOrder(response?.order) }
}

async function api_order_deactivate(payload = {}) {
  const listingId = String(payload?.input?.listingId || '').trim()
  if (!listingId) throw new Error('listingId is required')
  return cloudConsumerJson('POST', `/v4/api-orders/${encodeURIComponent(listingId)}/deactivate`, {})
}

async function api_order_reactivation_request(payload = {}) {
  const listingId = String(payload?.input?.listingId || '').trim()
  if (!listingId) throw new Error('listingId is required')
  return cloudConsumerJson('POST', `/v4/api-orders/${encodeURIComponent(listingId)}/reactivation-requests`, {})
}

async function consumer_approval_decide(payload = {}) {
	const input = payload.input || {}
	const approvalId = String(input.approvalId || '').trim()
	const decision = input.decision === 'reject' ? 'reject' : 'approve'
	const pin = String(input.pin || '').trim()
	if (!approvalId || !/^\d{6}$/.test(pin)) throw new Error('Approval and a six-digit payment PIN are required.')
	return cloudAuth.apiRequest('POST', `/v4/approvals/${encodeURIComponent(approvalId)}/${decision}`, { pin })
}

async function consumer_account_balance() { return cloudConsumerJson('GET', '/v4/account/balance') }
async function consumer_purchase_estimate(payload = {}) { return cloudConsumerJson('POST', '/v4/operation-estimates', payload.input || {}) }
async function consumer_invoke_operation(payload = {}) {
  const input = { ...(payload.input || {}) }
  const apiId = String(input.apiId || '').trim()
  const operationId = String(input.operationId || '').trim()
  if (!apiId || !operationId) throw new Error('apiId and operationId are required')
  delete input.apiId
  return cloudConsumerJson('POST', `/v4/apis/${encodeURIComponent(apiId)}/operations/${encodeURIComponent(operationId)}/invocations`, input)
}
async function activity_sessions(payload = {}) {
  const input = payload?.input || {}
  const role = String(input.role || 'buyer').trim()
  if (role !== 'buyer' && role !== 'seller') throw new Error('role must be buyer or seller')
  const requestedLimit = Math.max(1, Math.min(200, Number(input.limit || 100)))
  const sessions = []
  let cursor = ''
  while (sessions.length < requestedLimit) {
    const query = new URLSearchParams({ role, status: 'all', limit: String(Math.min(100, requestedLimit - sessions.length)) })
    if (cursor) query.set('cursor', cursor)
    const response = await cloudAuth.apiRequest('GET', `/v4/api-orders?${query}`)
    const orders = Array.isArray(response?.orders) ? response.orders : []
    sessions.push(...orders.map(desktopOrderSession))
    cursor = String(response?.nextCursor || '')
    if (!cursor || orders.length === 0) break
  }
  const kind = String(input.kind || '').trim()
  const status = String(input.status || '').trim()
  const q = String(input.q || '').trim().toLowerCase()
  return { sessions: sessions.filter((session) => {
    if (kind && session.productKind !== kind) return false
    if (status && session.status !== status) return false
    if (q && ![session.orderUid, session.productTitle, session.productId, session.operationId].join(' ').toLowerCase().includes(q)) return false
    return true
  }) }
}

async function activity_session(payload = {}) {
  const id = String(payload?.input?.id || '').trim()
  if (!id) throw new Error('activity session id is required')
  const role = String(payload?.input?.role || 'buyer').trim()
  if (role !== 'buyer' && role !== 'seller') throw new Error('role must be buyer or seller')
  const orderResponse = await cloudAuth.apiRequest('GET', `/v4/api-orders/${encodeURIComponent(id)}?role=${encodeURIComponent(role)}`)
  const order = orderResponse?.order
  if (!order) throw new Error('Order detail was not found.')
  const invocations = []
  let cursor = ''
  while (invocations.length < 200) {
    const query = new URLSearchParams({ role, limit: String(Math.min(100, 200 - invocations.length)) })
    if (cursor) query.set('cursor', cursor)
    const response = await cloudAuth.apiRequest('GET', `/v4/api-orders/${encodeURIComponent(id)}/invocations?${query}`)
    const page = Array.isArray(response?.invocations) ? response.invocations : []
    invocations.push(...page)
    cursor = String(response?.nextCursor || '')
    if (!cursor || page.length === 0) break
  }
  const summary = desktopOrderSession(order)
  return { session: {
    ...summary,
    itemCount: invocations.length,
    product: { productId: summary.productId, apiId: order.apiId, operationId: order.operationId, productKind: 'api_operation', title: summary.productTitle, description: '' },
    operations: [String(order.operationId || '')].filter(Boolean),
    usage: {},
    invocations: invocations.map((value) => ({
      invocationId: String(value.invocationId || ''), operationId: String(value.operationId || order.operationId || ''), status: String(value.status || ''),
      chargedAtomic: Number(value.chargedAtomic || 0), platformFeeAtomic: Number(value.platformFeeAtomic || 0), usage: value.settlement?.actualUsage || {}, startedAt: String(value.createdAt || ''), completedAt: String(value.completedAt || ''),
    })),
    events: [],
    identifiers: { orderUid: summary.orderUid, apiOrderId: summary.orderUid, apiId: String(order.apiId || ''), operationId: String(order.operationId || '') },
  } }
}

function desktopOrderSession(order = {}) {
  const id = String(order.apiOrderId || '')
  const active = String(order.status || '') === 'active'
  return {
    sessionId: id,
    orderUid: id,
    role: String(order.role || 'buyer'),
    productKind: 'api_operation',
    productId: String(order.apiId || ''),
    listingId: id,
    operationId: String(order.operationId || ''),
    productTitle: String(order.operationTitle || order.apiTitle || order.operationId || 'Operation'),
    counterpartyId: id,
    counterpartyLabel: String(order.counterpartyLabel || (order.role === 'seller' ? 'Buyer' : 'Provider')),
    status: active ? 'active' : 'completed',
    outcome: active ? 'API Order active' : 'API Order inactive',
    attentionRequired: false,
    inFlightCount: 0,
    itemCount: Number(order.invocationCount || 0),
    amountAtomic: Number(order.chargedAtomic || 0),
    grossAmountAtomic: Number(order.chargedAtomic || 0),
    platformFeeAtomic: Number(order.platformFeeAtomic || 0),
    asset: 'USDC',
    startedAt: String(order.activatedAt || order.createdAt || ''),
    updatedAt: String(order.updatedAt || order.lastUsedAt || order.createdAt || ''),
    endedAt: active ? '' : String(order.deactivatedAt || order.updatedAt || ''),
  }
}

function desktopAPIOrder(order = {}) {
  if (!order || !order.apiOrderId) return undefined
  return {
    orderId: String(order.apiOrderId), listingId: String(order.apiOrderId), status: String(order.status || 'inactive'),
    activatedAt: String(order.activatedAt || ''), deactivatedAt: String(order.deactivatedAt || ''), lastUsedAt: String(order.lastUsedAt || ''),
    createdAt: String(order.createdAt || ''), updatedAt: String(order.updatedAt || ''),
  }
}

async function provider_listings() {
  try { return await httpJson('GET', '/v4/provider/listings', undefined, await localOwnerToken(await dockPaths())) }
  catch (error) { return { listings: [], offline: true, error: errorMessage(error) } }
}
async function provider_listing_save(payload = {}) {
  const input = payload.input || {}
  const route = input.listingId ? `/v4/provider/listings/${encodeURIComponent(input.listingId)}` : '/v4/provider/listings'
  return httpJson(input.listingId ? 'PUT' : 'POST', route, input, await localOwnerToken(await dockPaths()))
}
async function provider_listing_action(payload = {}) {
  const input = payload.input || {}
  return httpJson('POST', `/v4/provider/listings/${encodeURIComponent(String(input.listingId || ''))}/${encodeURIComponent(String(input.action || ''))}`, {}, await localOwnerToken(await dockPaths()))
}
async function provider_listing_delete(payload = {}) {
  const input = payload.input || {}
  return httpJson('DELETE', `/v4/provider/listings/${encodeURIComponent(String(input.listingId || ''))}`, undefined, await localOwnerToken(await dockPaths()))
}

async function provider_api_drafts() {
  return httpJson('GET', '/v4/api-drafts', undefined, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
}

async function provider_api_create(payload = {}) {
	return httpJson('POST', '/v4/local/api-drafts', payload.input || {}, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
}

async function provider_api_delete(payload = {}) {
	const input = { ...(payload.input || {}) }
	const apiID = String(input.apiId || '').trim()
	delete input.apiId
	if (!apiID) throw new Error('apiId is required')
	return httpJson('DELETE', `/v4/local/api-drafts/${encodeURIComponent(apiID)}`, input, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
}

async function provider_api_update_identity(payload = {}) {
	const input = { ...(payload.input || {}) }
	const apiID = String(input.apiId || '').trim()
	delete input.apiId
	if (!apiID) throw new Error('apiId is required')
	return httpJson('PUT', `/v4/local/api-drafts/${encodeURIComponent(apiID)}/identity`, input, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
}

async function provider_api_submit(payload = {}) {
	return httpJson('POST', '/v4/api-drafts', payload.input || {}, await localOwnerToken(await dockPaths()), { timeoutMs: 30000 })
}

async function provider_api_update(payload = {}) {
	const input = { ...(payload.input || {}) }
	const apiID = String(input.apiId || '').trim()
	delete input.apiId
	if (!apiID) throw new Error('apiId is required')
	return httpJson('PUT', `/v4/local/api-drafts/${encodeURIComponent(apiID)}`, input, await localOwnerToken(await dockPaths()), { timeoutMs: 30000 })
}

async function provider_api_update_operation(payload = {}) {
	const input = { ...(payload.input || {}) }
	const apiID = String(input.apiId || '').trim()
	const operationID = String(input.operationId || '').trim()
	delete input.apiId
	delete input.operationId
	if (!apiID || !operationID) throw new Error('apiId and operationId are required')
	return httpJson('PUT', `/v4/local/api-drafts/${encodeURIComponent(apiID)}/operations/${encodeURIComponent(operationID)}`, input, await localOwnerToken(await dockPaths()), { timeoutMs: 30000 })
}

async function provider_api_contract_submit(payload = {}) {
	const input = { ...(payload.input || {}) }
	const apiID = String(input.apiId || '').trim()
	delete input.apiId
	if (!apiID) throw new Error('apiId is required')
	return httpJson('PUT', `/v4/local/api-drafts/${encodeURIComponent(apiID)}/contract`, input, await localOwnerToken(await dockPaths()), { timeoutMs: 30000 })
}

async function provider_api_contract_clear(payload = {}) {
	const input = { ...(payload.input || {}) }
	const apiID = String(input.apiId || '').trim()
	delete input.apiId
	if (!apiID) throw new Error('apiId is required')
	return httpJson('DELETE', `/v4/local/api-drafts/${encodeURIComponent(apiID)}/contract`, input, await localOwnerToken(await dockPaths()), { timeoutMs: 30000 })
}

async function providerOperationMutation(payload, suffix, method = 'POST', timeoutMs = 15000) {
  const input = { ...(payload.input || {}) }
  const apiID = String(input.apiId || '').trim()
  const operationID = String(input.operationId || '').trim()
  delete input.apiId
  delete input.operationId
  if (!apiID || !operationID) throw new Error('apiId and operationId are required')
  return httpJson(method, `/v4/local/api-drafts/${encodeURIComponent(apiID)}/operations/${encodeURIComponent(operationID)}/${suffix}`, input, await localOwnerToken(await dockPaths()), { timeoutMs })
}

async function provider_api_connectivity_test(payload = {}) {
  const next = { input: { ...(payload.input || {}), idempotencyKey: String(payload.input?.idempotencyKey || `validation-${crypto.randomUUID()}`) } }
  return providerOperationMutation(next, 'validation-runs', 'POST', 30000)
}
async function provider_api_lock_integration(payload = {}) { return providerOperationMutation(payload, 'lock-integration') }
async function provider_api_unlock_integration(payload = {}) { return providerOperationMutation(payload, 'unlock-integration') }
async function provider_api_billing_test(payload = {}) { return providerOperationMutation(payload, 'billing-runs', 'POST', 120000) }
async function provider_api_contract_validate(payload = {}) { return providerOperationMutation(payload, 'contract-validation', 'POST', 180000) }
async function provider_api_contract_confirm(payload = {}) { return providerOperationMutation(payload, 'confirm-contract') }
async function provider_api_lock_pricing(payload = {}) { return providerOperationMutation(payload, 'lock-pricing') }
async function provider_api_unlock_pricing(payload = {}) { return providerOperationMutation(payload, 'unlock-pricing') }
async function provider_api_lifecycle(payload = {}) { return providerOperationMutation(payload, 'lifecycle', 'POST', 30000) }
async function provider_api_operational_settings(payload = {}) { return providerOperationMutation(payload, 'operational-settings', 'PUT', 30000) }

async function provider_api_publish(payload = {}) {
  const input = { ...(payload.input || {}) }
  const apiID = String(input.apiId || '').trim()
  delete input.apiId
  if (!apiID) throw new Error('apiId is required')
  return httpJson('POST', `/v4/local/api-drafts/${encodeURIComponent(apiID)}/publish`, input, await localOwnerToken(await dockPaths()), { timeoutMs: 120000 })
}

async function httpJson(method, route, body, token, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 3500
  const retryOnOffline = options.retryOnOffline !== false
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const request = () => fetchTextWithTimeout(`${BASE_URL}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }, timeoutMs)
  let result
  try {
    result = await request()
  } catch (error) {
    if (!retryOnOffline || !isLocalConnectionFailure(error)) {
      throw localRequestError(error, route, timeoutMs)
    }
    try {
      await start_dock()
      result = await request()
    } catch (retryError) {
      throw localRequestError(retryError, route, timeoutMs)
    }
  }
  const { response, text } = result
  if (!response.ok) {
    let decoded
    try { decoded = text.trim() ? JSON.parse(text) : undefined } catch {}
    const errorPayload = decoded && typeof decoded === 'object'
      ? decoded
      : { error: `Local Exora Dock returned HTTP ${response.status}` }
    const error = new Error(JSON.stringify(errorPayload))
    error.status = response.status
    error.code = decoded?.code || `local_http_${response.status}`
    error.upstreamStatus = decoded?.upstreamStatus
    throw error
  }
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`local response json: ${error.message}`)
  }
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











async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const upstreamSignal = options?.signal
  const fetchOptions = { ...(options || {}) }
  delete fetchOptions.signal
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason)
  if (upstreamSignal?.aborted) abortFromUpstream()
  else upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
    upstreamSignal?.removeEventListener('abort', abortFromUpstream)
  }
}

async function readStreamChunk(reader, timeoutMs, signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('download canceled')
  let timer
  let removeAbort = () => undefined
  const timeoutError = new RequestTimeoutError(`download stopped receiving data for ${Math.round(timeoutMs / 1000)} seconds`)
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel(timeoutError).catch(() => undefined)
      reject(timeoutError)
    }, timeoutMs)
  })
  const canceled = new Promise((_, reject) => {
    if (!signal) return
    const abort = () => {
      const error = signal.reason instanceof Error ? signal.reason : new Error('download canceled')
      void reader.cancel(error).catch(() => undefined)
      reject(error)
    }
    signal.addEventListener('abort', abort, { once: true })
    removeAbort = () => signal.removeEventListener('abort', abort)
  })
  try { return await Promise.race([reader.read(), deadline, canceled]) }
  finally { clearTimeout(timer); removeAbort() }
}

async function fetchTextWithTimeout(url, options, timeoutMs) {
  const result = await fetchAndReadWithTimeout(url, options, timeoutMs, (response) => response.text())
  return { response: result.response, text: result.body }
}

async function fetchArrayBufferWithTimeout(url, options, timeoutMs) {
  const result = await fetchAndReadWithTimeout(url, options, timeoutMs, (response) => response.arrayBuffer())
  return { response: result.response, arrayBuffer: result.body }
}

async function openPath(target) {
  const error = await shell.openPath(target)
  if (error) throw new Error(error)
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
