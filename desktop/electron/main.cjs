const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, screen, session, shell, Tray } = require('electron')
const { spawn, execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const net = require('node:net')
const https = require('node:https')
const path = require('node:path')
const YAML = require('yaml')
const { autoUpdater } = require('electron-updater')
const { registerIpcHandlers } = require('./ipc.cjs')
const { probeMCPConnectivity } = require('./mcp-connectivity.cjs')
const { assertDesktopCommandSupported, desktopCapabilities } = require('./platform-capabilities.cjs')
const { releaseWarningForArtifact, selectReleaseArtifact } = require('./release-manifest.cjs')
const { createCloudAuth } = require('./cloud-auth.cjs')
const {
  createAppURLPolicy,
  installNavigationGuards,
  isTrustedIpcSender,
} = require('./security.cjs')
const { cleanupLegacyFrontendData } = require('./legacy-frontend-cleanup.cjs')
const { RequestTimeoutError, fetchAndReadWithTimeout } = require('./network-timeout.cjs')
const { SETTINGS_VERSION, normalizeAppSettingsV3, redactDiagnostics } = require('./app-settings.cjs')
const {
  readAPIBridgeMaterialManifest: readStoredAPIBridgeMaterialManifest,
  removeAPIBridgeMaterial,
  validateTextMaterial,
  withAPIBridgeMaterialMutation,
  writeJSONAtomically,
} = require('./api-materials.cjs')
const { inspectResourceFiles, validateResourceFile } = require('./resource-files.cjs')

const APP_ID = 'io.exora.dock'
const BASE_URL = 'http://127.0.0.1:8080'
const DAEMON_NAME = 'exora-dockd'
const DAEMON_LOG_NAME = 'daemon.log'
const DESKTOP_STATE_NAME = 'desktop-state.json'
const PERSISTENCE_DIR_NAME = 'exora-data'
const v3SelectedResourceFiles = new Map()
const v3EnvironmentDownloads = new Map()
const DEV_URL = process.env.EXORA_DOCK_DESKTOP_DEV_URL || 'http://127.0.0.1:1420'
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
let wslBrokerChild
const WINDOW_PROFILES = Object.freeze({
  auth: Object.freeze({ width: 1440, height: 900, minWidth: 560, minHeight: 600 }),
  workspace: Object.freeze({ width: 1440, height: 900, minWidth: 1080, minHeight: 720 }),
})
app.commandLine.appendSwitch('lang', chromiumLocaleForLanguage(STARTUP_LANGUAGE))

let mainWindow
let activeWindowMode = 'auth'
let tray
let appIsQuitting = false
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
  mainWindow.once('ready-to-show', () => {
    if (!currentAppSettings.startMinimized && !process.argv.includes('--hidden')) mainWindow.show()
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
  await ensureWindowsWSLBroker().catch((error) => {
    console.error('Failed to start the Windows WSL broker:', error)
  })
  createWindow()
  createTray()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Exora continues supervising Dock runtime services from the tray.
})

app.on('before-quit', () => {
  appIsQuitting = true
  v3SelectedResourceFiles.clear()
  if (wslBrokerChild && !wslBrokerChild.killed) wslBrokerChild.kill()
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
    authorizeCommand: (command) => assertDesktopCommandSupported(command, process.platform),
    timeoutForCommand: desktopCommandTimeoutMs,
  })
}

const INTERACTIVE_OR_STREAMING_COMMANDS = new Set([
  'system_choose_download_directory',
  'system_update_install',
  'consumer_create_transfer',
  'provider_environment_choose_root',
  'provider_environment_download',
  'provider_asset_choose_files',
  'provider_asset_upload',
  'provider_api_bridge_materials_choose',
  'seller_automation_choose_root',
])

function desktopCommandTimeoutMs(command) {
  if (INTERACTIVE_OR_STREAMING_COMMANDS.has(command)) return 0
  if (command === 'provider_host_scan') return 75000
  if (command === 'consumer_invoke_operation' || command.startsWith('provider_vm_')) return 190000
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
      start_dock,
      stop_dock,
      restart_dock,
      mcp_connectivity_test,
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
      system_export_diagnostics,
      system_update_check,
      system_update_install,
      system_open_legal,
    },
    v3Market: {
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
      consumer_purchase_download,
      consumer_create_transfer,
      consumer_purchase_compute,
      consumer_compute_purchase,
      consumer_estimate_compute_extension,
      consumer_extend_compute,
      consumer_get_lease,
      consumer_release_lease,
      consumer_run_compute_command,
      consumer_start_compute_transfer,
      consumer_compute_transfer_status,
      consumer_choose_compute_upload,
      consumer_choose_compute_download,
      activity_sessions,
      activity_session,
      provider_vm_probe,
      provider_vm_capacity,
      provider_vm_domains,
      provider_vm_import,
      provider_vm_validate,
      provider_runtime_status,
      provider_host_snapshot,
      provider_host_scan,
      provider_environment_catalog,
      provider_environment_storage,
      provider_environment_choose_root,
      provider_environment_update_storage,
      provider_environment_download,
      provider_environment_cancel,
      provider_environment_installed,
      provider_environment_delete,
      provider_environment_reserve,
      provider_environment_release,
      provider_product_create,
      provider_asset_choose_files,
      provider_asset_clear_selection,
      provider_asset_create,
      provider_asset_upload,
      provider_asset_cancel,
      provider_api_bridge_materials_choose,
      provider_api_bridge_materials_add,
      provider_api_bridge_material_remove,
      provider_api_bridge_materials_get,
      provider_service_material_note_save,
      provider_service_draft_get,
      provider_service_draft_save,
      provider_service_draft_submit,
      provider_api_probe,
      provider_endpoint_local_save,
      provider_endpoint_local_list,
      provider_endpoint_probe,
      provider_endpoint_test_route,
      provider_listings,
      provider_listing_save,
      provider_listing_action,
      provider_listing_delete,
      provider_resource_item_update,
      provider_resource_item_action,
      seller_automation_policy_get,
      seller_automation_policy_save,
      seller_automation_credentials,
      seller_automation_credential_save,
      seller_automation_credential_delete,
      seller_automation_choose_root,
      seller_automation_draft_runs,
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
      agent_session_status,
      agent_session_policy_get,
      agent_session_policy_save,
      agent_session_revoke,
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

async function mcp_connectivity_test() {
  const paths = await dockPaths()
  const runtime = await start_dock()
  if (runtime.daemon !== 'healthy') throw new Error(statusMessage(runtime))
  return probeMCPConnectivity([paths.helperPath, 'mcp', paths.configPath], {
    cwd: paths.rootDir,
    timeoutMs: 30000,
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
  const manifestURL = String(process.env.EXORA_RELEASE_MANIFEST_URL || 'https://github.com/UmbraFi/exora-dock/releases/download/v0.1.0-preview.2/release-manifest.json').trim()
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
  const addressRequest = cloudAuth.apiRequest('GET', '/v3/billing/deposit-address').catch((error) => {
    if (Number(error?.status || 0) === 423 || Number(error?.status || 0) === 503) return {}
    throw error
  })
	const [balanceResult, custodyResult, depositsResult, withdrawalsResult, spendPolicyResult, addressResult] = await Promise.all([
    cloudAuth.apiRequest('GET', '/v3/billing/balance'),
    cloudAuth.apiRequest('GET', '/v3/billing/custody-status'),
    cloudAuth.apiRequest('GET', '/v3/billing/deposits'),
    cloudAuth.apiRequest('GET', '/v3/billing/withdrawals'),
		cloudAuth.apiRequest('GET', '/v3/account/spend-policy'),
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
  if (!updaterConfigured) return
  if (currentAppSettings.autoUpdate) setTimeout(() => system_update_check().catch((error) => updateUpdaterState('error', errorMessage(error))), 12_000)
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
    capabilities: desktopCapabilities(process.platform),
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
    body: chinese ? '审批、安全和运行时事件可在此设备上提醒你。' : 'Approvals, security events, and runtime issues can alert you on this device.',
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
    await emptyDirectory(resourceArchiveTempRoot())
  } else {
    throw new Error('Unsupported storage category.')
  }
  return { cleared: true, storage: await storageSnapshot(paths) }
}

async function system_export_diagnostics() {
  const paths = await dockPaths()
  const [runtime, storage] = await Promise.all([app_status().catch((error) => ({ error: errorMessage(error) })), storageSnapshot(paths)])
  const report = {
    schema: 'exora-diagnostics-v1',
    createdAt: new Date().toISOString(),
    application: { version: app.getVersion(), electron: process.versions.electron, platform: process.platform, arch: process.arch, packaged: app.isPackaged },
    runtime: redactDiagnostics({
      docker: runtime.docker, container: runtime.container, daemon: runtime.daemon, image: runtime.image,
      containerName: runtime.containerName,
    }),
    storage,
    preferences: redactDiagnostics({
      language: currentAppSettings.language,
      theme: currentAppSettings.theme,
      launchAtLogin: currentAppSettings.launchAtLogin,
      startMinimized: currentAppSettings.startMinimized,
      closeBehavior: currentAppSettings.closeBehavior,
      startDockOnLaunch: currentAppSettings.startDockOnLaunch,
      autoUpdate: currentAppSettings.autoUpdate,
      notifications: currentAppSettings.notifications,
    }),
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: currentAppSettings.language === 'zh' ? '导出已脱敏的诊断信息' : 'Export redacted diagnostics',
    defaultPath: path.join(app.getPath('downloads'), `exora-diagnostics-${new Date().toISOString().slice(0, 10)}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await writeJsonAtomic(result.filePath, report)
  return { canceled: false, path: result.filePath }
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
  if (input.activeWork === true || activeRuntimeWork) throw new Error('Finish active purchases, downloads, leases, and provider tasks before installing the update.')
  if (!updaterConfigured || updaterState.state !== 'available' || !updaterState.downloadURL) throw new Error('No verified Technical Preview download is available.')
  await shell.openExternal(updaterState.downloadURL)
  return { opened: true, sha256: updaterState.sha256, warning: updaterState.warning }
}

async function system_open_legal(payload = {}) {
  const input = objectOr(payload.input || payload)
  const root = app.isPackaged ? path.join(process.resourcesPath, 'legal') : path.join(__dirname, '..', '..')
  const target = input.kind === 'privacy'
    ? path.join(root, app.isPackaged ? (currentAppSettings.language === 'zh' ? 'WHITEPAPER.md' : 'WHITEPAPER.en.md') : path.join('docs', currentAppSettings.language === 'zh' ? 'WHITEPAPER.md' : 'WHITEPAPER.en.md'))
    : path.join(root, 'LICENSE')
  await openPath(target)
  return { opened: true }
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

async function storageSnapshot(paths) {
  const [dataBytes, logsBytes, cacheBytes, tempBytes] = await Promise.all([
    directorySize(paths.dataDir),
    directorySize(paths.logsDir),
    app.isReady() ? session.defaultSession.getCacheSize().catch(() => 0) : Promise.resolve(0),
    directorySize(resourceArchiveTempRoot()),
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
	return cloudAuth.apiRequest('PUT', '/v3/account/spend-policy', { enabled, singleLimitAtomic, periodLimitAtomic, periodSeconds: 86400, pin })
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
		const challenge = await cloudAuth.apiRequest('POST', '/v3/billing/withdrawal-challenges', {
			quoteId, pinAuthorizationToken: authorization.authorizationToken,
		})
		return { quote, challenge, nextAction: 'enter_email_code' }
	}
  if (!challengeId || !quoteId || !code) {
	const pin = String(input.pin || '').trim()
	if (!/^\d{6}$/.test(pin)) throw new Error('Payment PIN must be exactly 6 digits.')
    const quote = await cloudAuth.apiRequest('POST', '/v3/billing/withdrawal-quotes', {
      destination: String(input.toAddress || '').trim(),
      amountAtomic: Number(input.amountAtomic || 0),
    })
	const authorization = await cloudAuth.apiRequest('POST', '/v1/auth/payment-pin/authorizations', {
		pin, purpose: 'withdrawal', requestFingerprint: String(quote.requestFingerprint || ''),
	})
	const challenge = await cloudAuth.apiRequest('POST', '/v3/billing/withdrawal-challenges', {
		quoteId: quote.quoteId, pinAuthorizationToken: authorization.authorizationToken,
	})
    return { quote, challenge, nextAction: 'enter_email_code' }
  }
  const withdrawal = await cloudAuth.apiRequest('POST', '/v3/billing/withdrawals', {
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
  await httpJson('PUT', '/v3/local/account-key', { accountId: accountID, key }, await localOwnerToken(paths), options)
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
  return httpJson('DELETE', '/v3/local/account-key', undefined, await localOwnerToken(paths))
}

async function account_api_key_status() {
  const connection = await cloudAuth.connection()
  const paths = await dockPaths()
  const state = await readDesktopState(paths)
  const stored = Boolean(decryptStoredAccountKey(state, connection.account?.accountId))
  const cloud = await cloudAuth.apiRequest('GET', '/v3/account/api-key')
  const local = await httpJson('GET', '/v3/local/account-key', undefined, await localOwnerToken(paths)).catch(() => ({ configured: false }))
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
  if (existing) {
    await syncAccountKeyToDock(connection.account.accountId, existing)
    return { created: false, configured: true }
  }
  const response = await cloudAuth.apiRequest('POST', '/v3/account/api-key/ensure', {})
  const key = String(response.token || '')
  if (!key) return { created: false, configured: false, requiresImport: Boolean(response.accessKey), accessKey: response.accessKey }
  await storeAccountKey(connection.account.accountId, key, response.accessKey)
  await syncAccountKeyToDock(connection.account.accountId, key)
  return { created: true, configured: true, token: key, accessKey: response.accessKey }
}

async function account_api_key_import(payload = {}) {
  const key = String(payload?.input?.key || '').trim()
  if (!/^sk-exora-[a-f0-9]{64}$/.test(key)) throw new Error('Enter a valid sk-exora account key.')
  const connection = await cloudAuth.connection()
  const verified = await cloudAbsoluteJSON(connection.cloudURL, 'GET', '/v3/account/balance', undefined, key)
  if (String(verified?.balance?.accountId || '') !== connection.account.accountId) throw new Error('This account key belongs to a different Exora account.')
  const status = await cloudAuth.apiRequest('GET', '/v3/account/api-key')
  await storeAccountKey(connection.account.accountId, key, status.accessKey || {})
  await syncAccountKeyToDock(connection.account.accountId, key)
  return { configured: true, accessKey: status.accessKey }
}

async function account_api_key_rotate(payload = {}) {
  const pin = String(payload?.input?.pin || '').trim()
  if (!/^\d{6}$/.test(pin)) throw new Error('Payment PIN must be exactly 6 digits.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is required before rotating the account key.')
  const connection = await cloudAuth.connection()
  const response = await cloudAuth.apiRequest('POST', '/v3/account/api-key/rotate', { pin })
  const key = String(response.token || '')
  if (!key) throw new Error('Cloud did not return the new account key.')
  await storeAccountKey(connection.account.accountId, key, response.accessKey)
  await syncAccountKeyToDock(connection.account.accountId, key)
  return { configured: true, token: key, accessKey: response.accessKey }
}

async function account_api_key_revoke(payload = {}) {
  const pin = String(payload?.input?.pin || '').trim()
  if (!/^\d{6}$/.test(pin)) throw new Error('Payment PIN must be exactly 6 digits.')
  const result = await cloudAuth.apiRequest('DELETE', '/v3/account/api-key', { pin })
  const paths = await dockPaths()
  const state = await readDesktopState(paths)
  delete state.accountAPIKey
  await writeDesktopState(paths, state)
  await lockLocalAccountKey().catch(() => undefined)
  return result
}

async function agent_session_status() {
  const paths = await dockPaths()
  return httpJson('GET', '/v3/local/agent-sessions', undefined, await localOwnerToken(paths))
}

async function agent_session_policy_get() {
  const paths = await dockPaths()
  const policy = await httpJson('GET', '/v3/local/agent-session-policy', undefined, await localOwnerToken(paths))
  return { ...policy, restBaseUrl: BASE_URL }
}

async function agent_session_policy_save(payload = {}) {
  const scopes = Array.isArray(payload?.input?.scopes) ? payload.input.scopes.map((value) => String(value || '').trim()).filter(Boolean) : []
  const paths = await dockPaths()
  const policy = await httpJson('PUT', '/v3/local/agent-session-policy', { scopes }, await localOwnerToken(paths), { timeoutMs: 15000 })
  return { ...policy, restBaseUrl: BASE_URL }
}

async function agent_session_revoke(payload = {}) {
  const id = String(payload?.input?.sessionId || '').trim()
  if (!id) throw new Error('Session ID is required.')
  const paths = await dockPaths()
  return httpJson('DELETE', `/v3/local/agent-sessions/${encodeURIComponent(id)}`, undefined, await localOwnerToken(paths))
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
    wslBrokerPath: resolveBundledBinary('exora-wsl-broker'),
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
  return cleanupLegacyFrontendData({ paths, readJson: readJsonOr, writeJson: writeJsonAtomic })
}

function resolveBundledBinary(baseName) {
  const name = process.platform === 'win32' ? `${baseName}.exe` : baseName
  const candidates = []
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, 'binaries', name))
  candidates.push(path.join(app.getAppPath(), 'binaries', name))
  candidates.push(path.join(__dirname, '..', 'binaries', name))
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
}

async function ensureWindowsWSLBroker() {
  if (process.platform !== 'win32') return
  if (await windowsPipeAvailable('\\\\.\\pipe\\exora-wsl-broker')) return
  const paths = await dockPaths()
  if (!fs.existsSync(paths.wslBrokerPath)) throw new Error(`Bundled WSL broker not found: ${paths.wslBrokerPath}`)
  const providerDir = path.join(paths.rootDir, 'provider')
  const logsDir = path.join(paths.logsDir, 'provider')
  await Promise.all([fsp.mkdir(providerDir, { recursive: true }), fsp.mkdir(logsDir, { recursive: true })])
  const logPath = path.join(logsDir, 'wsl-broker.log')
  const out = fs.openSync(logPath, 'a')
  try {
    const child = spawn(paths.wslBrokerPath, ['--data-dir', providerDir], {
      cwd: paths.rootDir,
      detached: false,
      windowsHide: true,
      stdio: ['ignore', out, out],
    })
    wslBrokerChild = child
    child.once('exit', () => {
      if (wslBrokerChild === child) wslBrokerChild = undefined
      if (!appIsQuitting) setTimeout(() => ensureWindowsWSLBroker().catch((error) => console.error('Failed to restart Windows WSL broker:', error)), 1500)
    })
  } finally {
    fs.closeSync(out)
  }
}

function windowsPipeAvailable(pipePath) {
  return new Promise((resolve) => {
    const socket = net.createConnection(pipePath)
    let settled = false
    const finish = (available) => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve(available)
    }
    socket.setTimeout(500, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
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
	await fsp.mkdir(root, { recursive: true })
	const migrated = []
	for (const [source, name] of [[paths.providerEnvironmentSettingsPath, 'environment-settings.json'], [paths.providerHostSnapshotPath, 'host-snapshot.json']]) {
		if (!fs.existsSync(source)) continue
		await fsp.copyFile(source, path.join(root, name))
		migrated.push(name)
	}
	const materialSource = path.join(app.getPath('userData'), 'api-bridge-materials')
	if (fs.existsSync(materialSource)) {
		await fsp.cp(materialSource, path.join(root, 'api-materials'), { recursive: true, force: false, errorOnExist: false })
		migrated.push('api-materials')
	}
	// Generated Resource ZIPs are intentionally temporary and are never migrated.
	await writeJsonAtomic(marker, { schemaVersion: 1, migrated, resourceArchivesMigrated: false, completedAt: new Date().toISOString() })
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
  return 'Read the local ExoraDock agent-discovery.json, start the stdio MCP server from mcpCommand, and use Exora MCP for VM, Resources, Endpoint, and API Bridge workflows. Seller draft tools may prepare drafts only; never publish, submit credentials, or confirm seller rights automatically.'
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
      { name: 'marketplace.endpoint.http_sse', description: 'Endpoint tunnels OpenAPI 3.1 HTTP/JSON and SSE operations while its Dock is online.' },
      { name: 'marketplace.api_bridge.http_sse', description: 'API Bridge reaches OpenAPI 3.1 HTTP/JSON and SSE operations directly from Cloud.' },
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
  return httpJson('GET', `/v3/catalog/products${q ? `?q=${encodeURIComponent(q)}` : ''}`, undefined, await localOwnerToken(await dockPaths()))
}

async function catalog_product(payload = {}) {
  return httpJson('GET', `/v3/catalog/products/${encodeURIComponent(String(payload?.input?.id || ''))}`, undefined, await localOwnerToken(await dockPaths()))
}

async function catalog_listings(payload = {}) {
  const input = payload?.input || {}
  const query = new URLSearchParams()
  for (const key of ['q', 'applicationSource']) {
    const value = String(input[key] || '').trim()
    if (value) query.set(key, value)
  }
  return httpJson('GET', `/v3/catalog/listings${query.size ? `?${query}` : ''}`, undefined, await localOwnerToken(await dockPaths()))
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
  return cloudConsumerJson('GET', `/v3/api-orders/${encodeURIComponent(listingId)}`)
}

async function api_order_deactivate(payload = {}) {
  const listingId = String(payload?.input?.listingId || '').trim()
  if (!listingId) throw new Error('listingId is required')
  return cloudConsumerJson('POST', `/v3/api-orders/${encodeURIComponent(listingId)}/deactivate`, {})
}

async function api_order_reactivation_request(payload = {}) {
  const listingId = String(payload?.input?.listingId || '').trim()
  if (!listingId) throw new Error('listingId is required')
  return cloudConsumerJson('POST', `/v3/api-orders/${encodeURIComponent(listingId)}/reactivation-requests`, {})
}

async function consumer_approval_decide(payload = {}) {
	const input = payload.input || {}
	const approvalId = String(input.approvalId || '').trim()
	const decision = input.decision === 'reject' ? 'reject' : 'approve'
	const pin = String(input.pin || '').trim()
	if (!approvalId || !/^\d{6}$/.test(pin)) throw new Error('Approval and a six-digit payment PIN are required.')
	return cloudAuth.apiRequest('POST', `/v3/approvals/${encodeURIComponent(approvalId)}/${decision}`, { pin })
}

async function consumer_account_balance() { return cloudConsumerJson('GET', '/v3/account/balance') }
async function consumer_purchase_estimate(payload = {}) { return cloudConsumerJson('POST', '/v3/purchase-estimates', payload.input || {}) }
async function consumer_invoke_operation(payload = {}) { return cloudConsumerJson('POST', '/v3/invocations', payload.input || {}) }
async function consumer_purchase_download(payload = {}) { return cloudConsumerJson('POST', '/v3/download-grants', payload.input || {}) }
async function consumer_create_transfer(payload = {}) {
  const input = payload.input || {}
  const grantId = String(input.grantId || '').trim()
  if (!grantId) throw new Error('grantId is required')
  const response = await cloudConsumerJson('POST', `/v3/download-grants/${encodeURIComponent(grantId)}/transfers`, {})
  if (input.download !== false && response?.transfer?.url) {
    response.download = await downloadConsumerTransfer(response)
  }
  if (response?.transfer) delete response.transfer.url
  return response
}

async function downloadConsumerTransfer(response) {
  const file = response.file || {}
  const suggestedName = path.basename(String(file.fileName || 'exora-download.bin'))
  const selected = await dialog.showSaveDialog(mainWindow, { title: 'Save Exora download', defaultPath: suggestedName })
  if (selected.canceled || !selected.filePath) return { status: 'canceled' }
  const destination = path.resolve(selected.filePath)
  const partial = `${destination}.exora.part`
  const expectedSize = Math.max(0, Number(file.sizeBytes || 0))
  let offset = 0
  try { offset = Math.max(0, Number((await fsp.stat(partial)).size || 0)) } catch {}
  if (expectedSize > 0 && offset > expectedSize) {
    await fsp.truncate(partial, 0)
    offset = 0
  }
  const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {}
  const transferResponse = await fetchWithTimeout(String(response.transfer.url), { method: 'GET', headers, redirect: 'error', cache: 'no-store' }, 30000)
  if (!transferResponse.ok && transferResponse.status !== 206) throw new Error(`Download transfer returned ${transferResponse.status}`)
  if (offset > 0 && transferResponse.status !== 206) {
    await fsp.truncate(partial, 0)
    offset = 0
  }
  const handle = await fsp.open(partial, offset > 0 ? 'a' : 'w')
  let downloaded = offset
  try {
    const reader = transferResponse.body?.getReader()
    if (!reader) throw new Error('Download response has no body')
    while (true) {
      const { done, value } = await readStreamChunk(reader, 30000)
      if (done) break
      await handle.write(Buffer.from(value))
      downloaded += value.byteLength
      mainWindow?.webContents.send('exora:v3-progress', { kind: 'marketplace_download', phase: 'downloading', bytesDownloaded: downloaded, sizeBytes: expectedSize })
    }
  } finally {
    await handle.close()
  }
  mainWindow?.webContents.send('exora:v3-progress', { kind: 'marketplace_download', phase: 'verifying', bytesDownloaded: downloaded, sizeBytes: expectedSize })
  if (expectedSize > 0 && downloaded !== expectedSize) throw new Error(`Downloaded size ${downloaded} does not match expected size ${expectedSize}`)
  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(partial)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  const actualSHA256 = hash.digest('hex')
  const expectedSHA256 = String(file.sha256 || '').trim().toLowerCase()
  if (expectedSHA256 && actualSHA256 !== expectedSHA256) throw new Error('Downloaded file failed SHA-256 verification; the resumable partial file was retained.')
  await fsp.rm(destination, { force: true })
  await fsp.rename(partial, destination)
  mainWindow?.webContents.send('exora:v3-progress', { kind: 'marketplace_download', phase: 'complete', bytesDownloaded: downloaded, sizeBytes: expectedSize })
  return { status: 'complete', fileName: path.basename(destination), sizeBytes: downloaded, sha256: actualSHA256, resumedFromBytes: offset }
}
async function consumer_purchase_compute(payload = {}) {
  const input = { ...(payload.input || {}) }
  const identity = await httpJson('GET', '/v3/local/device-identity', undefined, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
  input.buyerDevicePublicKey = String(identity?.devicePublicKey || '')
  delete input.sshPublicKey
  return cloudConsumerJson('POST', '/v3/compute-purchases', input)
}
async function consumer_compute_purchase(payload = {}) { return cloudConsumerJson('GET', `/v3/compute-purchases/${encodeURIComponent(String(payload?.input?.purchaseId || ''))}`) }
async function consumer_estimate_compute_extension(payload = {}) { const input = { ...(payload.input || {}) }; const purchaseId = String(input.purchaseId || ''); delete input.purchaseId; return cloudConsumerJson('POST', `/v3/compute-purchases/${encodeURIComponent(purchaseId)}/extension-estimates`, input) }
async function consumer_extend_compute(payload = {}) { const input = { ...(payload.input || {}) }; const purchaseId = String(input.purchaseId || ''); delete input.purchaseId; return cloudConsumerJson('POST', `/v3/compute-purchases/${encodeURIComponent(purchaseId)}/extend`, input) }
async function consumer_get_lease(payload = {}) { return cloudConsumerJson('GET', `/v3/leases/${encodeURIComponent(String(payload?.input?.leaseId || ''))}`) }
async function consumer_release_lease(payload = {}) {
  const leaseID = String(payload?.input?.leaseId || '')
  return cloudConsumerJson('POST', `/v3/leases/${encodeURIComponent(leaseID)}/release`, {})
}

async function consumer_run_compute_command(payload = {}) {
  const leaseID = String(payload?.input?.leaseId || '').trim()
  const command = String(payload?.input?.command || '')
  if (!leaseID || !command.trim()) throw new Error('leaseId and command are required')
  return cloudConsumerJson('POST', `/v3/leases/${encodeURIComponent(leaseID)}/commands`, { command })
}

async function consumer_choose_compute_upload() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title: 'Choose a file to send directly to the VM' })
  return { canceled: result.canceled, path: result.filePaths[0] || '' }
}

async function consumer_choose_compute_download(payload = {}) {
  const suggested = String(payload?.input?.suggestedName || 'vm-file.bin').replace(/[\\/:*?"<>|]/g, '_')
  const result = await dialog.showSaveDialog(mainWindow, { title: 'Choose where to save the VM file', defaultPath: suggested })
  return { canceled: result.canceled, path: result.filePath || '' }
}

async function consumer_start_compute_transfer(payload = {}) {
  const input = { ...(payload.input || {}) }
  const localPath = path.resolve(String(input.localPath || ''))
  input.localPath = localPath
  input.authorizedLocalRoot = path.dirname(localPath)
  return httpJson('POST', '/v3/local/compute-transfers', input, await localOwnerToken(await dockPaths()), { timeoutMs: 180000 })
}

async function consumer_compute_transfer_status(payload = {}) {
  const transferID = String(payload?.input?.transferId || '').trim()
  return httpJson('GET', `/v3/local/compute-transfers/${encodeURIComponent(transferID)}`, undefined, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
}

async function activity_sessions(payload = {}) {
  const input = payload?.input || {}
  const query = new URLSearchParams()
  for (const key of ['role', 'kind', 'status', 'q', 'limit']) {
    const value = String(input[key] ?? '').trim()
    if (value) query.set(key, value)
  }
  return httpJson('GET', `/v3/activity-sessions${query.size ? `?${query}` : ''}`, undefined, await localOwnerToken(await dockPaths()))
}

async function activity_session(payload = {}) {
  const id = String(payload?.input?.id || '').trim()
  if (!id) throw new Error('activity session id is required')
  return httpJson('GET', `/v3/activity-sessions/${encodeURIComponent(id)}`, undefined, await localOwnerToken(await dockPaths()))
}

async function v3Worker(command, input = {}, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 180000
  return httpJson('POST', `/v3/provider/worker/${encodeURIComponent(command)}`, input, await localOwnerToken(await dockPaths()), { timeoutMs })
}
async function provider_vm_probe() { return v3Worker('probe_host') }
async function provider_vm_capacity() { return v3Worker('capacity_check') }
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

async function provider_runtime_status() { return v3Worker('probe_runtime') }
async function provider_host_snapshot() {
  const paths = await dockPaths()
  const saved = objectOr(await readJsonOr(paths.providerHostSnapshotPath, {}))
  return { result: objectOr(saved.result), measuredAt: saved.measuredAt || '' }
}

function percentile(values, fraction) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!ordered.length) return 0
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.round((ordered.length - 1) * fraction)))]
}

async function timedBandwidthProbe(url, direction, durationMs, maxBytes, onProgress = () => undefined, options = {}) {
  const samples = []
  let transferred = 0
  const startedAt = performance.now()
  const sizes = direction === 'download' ? [1 << 20, 8 << 20, 25 << 20, 50 << 20] : [512 << 10, 2 << 20, 4 << 20, 8 << 20]
  let index = 0
  while (performance.now() - startedAt < durationMs && transferred < maxBytes) {
    const bytes = Math.min(sizes[Math.min(index, sizes.length - 1)], maxBytes - transferred)
    if (bytes <= 0) break
    const sampleStartedAt = performance.now()
    const target = direction === 'download' ? `${url}?bytes=${bytes}&cache=${Date.now()}-${index}` : url
    const requestOptions = direction === 'download'
      ? { cache: 'no-store', signal: options.signal }
      : { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(bytes), signal: options.signal }
    const { body } = await fetchAndReadWithTimeout(target, requestOptions, 15000, async (response) => {
      if (!response.ok) throw new Error(`network ${direction} probe returned ${response.status}`)
      return response.arrayBuffer()
    })
    const actualBytes = direction === 'download' ? body.byteLength : bytes
    const elapsedMs = Math.max(1, performance.now() - sampleStartedAt)
    transferred += actualBytes
    samples.push((actualBytes * 8 * 1000) / elapsedMs)
    index += 1
    onProgress(Math.min(1, (performance.now() - startedAt) / durationMs), { bytes: transferred, samples: samples.length })
  }
  return {
    bps: percentile(samples.length > 1 ? samples.slice(1) : samples, 0.5),
    bytes: transferred,
    durationMs: Math.round(performance.now() - startedAt),
    samples: samples.length,
  }
}

async function measurePublicNetwork(onProgress = () => undefined, options = {}) {
  const base = 'https://speed.cloudflare.com'
  const latencySamples = []
  let meta = {}
  onProgress('geolocation', 0)
  try {
    const { response, body } = await fetchAndReadWithTimeout(`${base}/meta`, { cache: 'no-store', signal: options.signal }, 8000, (value) => value.json())
    if (response.ok) meta = objectOr(body)
  } catch {}
  if (!(meta.clientIp || meta.clientIP) || !(meta.country || meta.city || meta.region)) {
    try {
      const { response, body } = await fetchAndReadWithTimeout('https://api.ip.sb/geoip', { cache: 'no-store', headers: { 'User-Agent': 'ExoraDock/0.1' }, signal: options.signal }, 8000, (value) => value.json())
      if (response.ok) meta = { ...meta, ...objectOr(body) }
    } catch {}
  }
  onProgress('latency', 0)
  for (let i = 0; i < 5; i += 1) {
    const startedAt = performance.now()
    await fetchAndReadWithTimeout(`${base}/__down?bytes=0&cache=${Date.now()}-${i}`, { cache: 'no-store', signal: options.signal }, 8000, async (response) => {
      if (!response.ok) throw new Error(`network latency probe returned ${response.status}`)
      return response.arrayBuffer()
    })
    latencySamples.push(performance.now() - startedAt)
    onProgress('latency', (i + 1) / 5)
  }
  onProgress('download', 0)
  const download = await timedBandwidthProbe(`${base}/__down`, 'download', 4000, 400 << 20, (progress, detail) => onProgress('download', progress, detail), options)
  onProgress('upload', 0)
  const upload = await timedBandwidthProbe(`${base}/__up`, 'upload', 3000, 200 << 20, (progress, detail) => onProgress('upload', progress, detail), options)
  const result = {
    publicIp: meta.clientIp || meta.clientIP || meta.ip || '',
    city: meta.city || '',
    region: meta.region || '',
    country: meta.country || '',
    colo: meta.colo || '',
    asn: meta.asn || '',
    asOrganization: meta.asOrganization || meta.asn_organization || meta.organization || '',
    downloadMbps: Number((download.bps / 1e6).toFixed(1)),
    uploadMbps: Number((upload.bps / 1e6).toFixed(1)),
    latencyMs: Math.round(percentile(latencySamples, 0.5)),
    download,
    upload,
    provider: 'cloudflare',
    observedAt: new Date().toISOString(),
  }
  if (!result.publicIp || !result.country) throw new Error('public IP geolocation could not be verified')
  if (!(result.downloadMbps > 0) || !(result.uploadMbps > 0)) throw new Error('sustained bandwidth measurement did not complete')
  return result
}

async function provider_host_scan(payload = {}) {
  const timeoutMs = 60000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new RequestTimeoutError('Hardware scan timed out after 60 seconds. Check the network connection and try again.')), timeoutMs)
  const emitProgress = (phase, percent, detail = {}) => mainWindow?.webContents.send('exora:v3-progress', { kind: 'host_scan', phase, percent: Math.max(0, Math.min(100, Math.round(percent))), ...detail })
  try {
    emitProgress('hardware', 4)
    const runtime = await v3Worker('probe_runtime', {}, { timeoutMs: 30000 })
    emitProgress('hardware', 18)
    const phaseRanges = {
      geolocation: [18, 28],
      latency: [28, 40],
      download: [40, 70],
      upload: [70, 94],
    }
    const network = await measurePublicNetwork((phase, progress, detail = {}) => {
      const range = phaseRanges[phase] || [18, 94]
      emitProgress(phase, range[0] + (range[1] - range[0]) * progress, detail)
    }, { signal: controller.signal })
    if (controller.signal.aborted) throw controller.signal.reason
    let hardware = {}
    try { hardware = JSON.parse(String(runtime.result?.hardware || '{}')) } catch {}
    const gpuLine = String(runtime.result?.gpu || '').split(/\r?\n/).find(Boolean) || ''
    const [gpuName, gpuUUID, gpuMemoryMiB, gpuFreeMiB, driverVersion] = gpuLine.split(',').map((item) => item.trim())
    const measuredAt = new Date().toISOString()
    const result = { ...runtime.result, hardware, gpu: gpuName ? { name: gpuName, uuid: gpuUUID, memoryMiB: Number(gpuMemoryMiB), freeMemoryMiB: Number(gpuFreeMiB), driverVersion } : undefined, network, measuredAt, scanReason: String(payload?.input?.reason || 'manual') }
    const paths = await dockPaths()
    emitProgress('saving', 96)
    await ensurePersistenceLayout(paths)
    await writeJsonAtomic(paths.providerHostSnapshotPath, { version: 1, measuredAt, result })
    emitProgress('complete', 100)
    return { result, measuredAt }
  } finally {
    clearTimeout(timeout)
  }
}

function bundledEnvironmentCatalog() {
  return [
    {
      imageId: 'ubuntu-24.04-cpu-v1', version: '1.0.0', status: 'catalog_preview', cloudAvailable: false,
      manifest: {
        schema: 'exora.environment_image.v3alpha1', name: 'Ubuntu 24.04', description: 'Official minimal Ubuntu environment for CPU workloads and custom software stacks.',
        architecture: 'amd64', runtimeBackends: ['wsl2'], os: { distribution: 'Ubuntu', version: '24.04 LTS' },
        components: ['Ubuntu 24.04 LTS', 'Exora Guest Contract'], gpu: { required: false, vendor: 'none' },
        artifact: { format: 'wsl', sizeBytes: 850 * 1024 * 1024 },
      },
    },
    {
      imageId: 'ubuntu-24.04-cuda-12.8-toolkit-v1', version: '1.0.0', status: 'catalog_preview', cloudAvailable: false,
      manifest: {
        schema: 'exora.environment_image.v3alpha1', name: 'Ubuntu 24.04 + CUDA 12.8', description: 'Official GPU environment with the CUDA 12.8 userspace toolkit, ready for NVIDIA WSL GPU validation.',
        architecture: 'amd64', runtimeBackends: ['wsl2'], os: { distribution: 'Ubuntu', version: '24.04 LTS' },
        components: ['Ubuntu 24.04 LTS', 'CUDA Toolkit 12.8', 'Exora Guest Contract'],
        gpu: { required: true, vendor: 'nvidia', cudaVersion: '12.8' }, artifact: { format: 'wsl', sizeBytes: 5.2 * 1024 * 1024 * 1024 },
      },
    },
  ]
}

function pathsOverlap(first, second) {
  const relative = path.relative(path.resolve(first), path.resolve(second))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function providerEnvironmentStorageDetails(settings = {}) {
  const paths = await dockPaths()
  const rootPath = String(settings.rootPath || '').trim()
  let freeBytes = 0
  if (rootPath) {
    try {
      const stats = await fsp.statfs(rootPath)
      freeBytes = Number(stats.bavail) * Number(stats.bsize)
    } catch {}
  }
  const minimumMinutes = Math.max(1, Math.round(Number(settings.pricing?.minimumMinutes || 10)))
  const maximumMinutes = Math.max(minimumMinutes, Math.min(10080, Math.round(Number(settings.pricing?.maximumMinutes || 240))))
  return {
    rootPath,
    workspaceGiB: Math.max(20, Number(settings.workspaceGiB || 100)),
    freeBytes,
    imageCachePath: path.join(paths.rootDir, 'provider', 'images'),
    pricing: {
      baseFee: Math.max(0, Number(settings.pricing?.baseFee || 0)),
      baseFeeEnabled: settings.pricing?.baseFeeEnabled ?? Number(settings.pricing?.baseFee || 0) > 0,
      pricePerMinute: Math.max(0, Number(settings.pricing?.pricePerMinute || 0)),
      minimumMinutes,
      maximumMinutes,
      longDiscountAfterMinutes: Math.max(1, Math.round(Number(settings.pricing?.longDiscountAfterMinutes || 60))),
      longDiscountPercent: Math.max(0, Math.min(90, Number(settings.pricing?.longDiscountPercent || 0))),
      longDiscountMinimumPricePercent: Math.max(1, Math.min(100, Number(settings.pricing?.longDiscountMinimumPricePercent || 50))),
      longDiscountEnabled: settings.pricing?.longDiscountEnabled ?? Number(settings.pricing?.longDiscountPercent || 0) > 0,
      allowSustainedCompute: settings.pricing?.allowSustainedCompute ?? true,
    },
  }
}

async function provider_environment_storage() {
  const paths = await dockPaths()
  const settings = objectOr(await readJsonOr(paths.providerEnvironmentSettingsPath, {}))
  return providerEnvironmentStorageDetails(settings)
}

async function saveProviderEnvironmentStorage(input = {}) {
  const paths = await dockPaths()
  const current = objectOr(await readJsonOr(paths.providerEnvironmentSettingsPath, {}))
  const minimumMinutes = Math.max(1, Math.round(Number(input.pricing?.minimumMinutes ?? current.pricing?.minimumMinutes ?? 10)))
  const maximumMinutes = Math.max(minimumMinutes, Math.min(10080, Math.round(Number(input.pricing?.maximumMinutes ?? current.pricing?.maximumMinutes ?? 240))))
  const next = {
    version: 1,
    rootPath: String(input.rootPath ?? current.rootPath ?? '').trim(),
    workspaceGiB: Math.max(20, Math.round(Number(input.workspaceGiB ?? current.workspaceGiB ?? 100))),
    pricing: {
      baseFee: Math.max(0, Number(input.pricing?.baseFee ?? current.pricing?.baseFee ?? 0)),
      baseFeeEnabled: input.pricing?.baseFeeEnabled ?? current.pricing?.baseFeeEnabled ?? Number(input.pricing?.baseFee ?? current.pricing?.baseFee ?? 0) > 0,
      pricePerMinute: Math.max(0, Number(input.pricing?.pricePerMinute ?? current.pricing?.pricePerMinute ?? 0)),
      minimumMinutes,
      maximumMinutes,
      longDiscountAfterMinutes: Math.max(1, Math.round(Number(input.pricing?.longDiscountAfterMinutes ?? current.pricing?.longDiscountAfterMinutes ?? 60))),
      longDiscountPercent: Math.max(0, Math.min(90, Number(input.pricing?.longDiscountPercent ?? current.pricing?.longDiscountPercent ?? 0))),
      longDiscountMinimumPricePercent: Math.max(1, Math.min(100, Number(input.pricing?.longDiscountMinimumPricePercent ?? current.pricing?.longDiscountMinimumPricePercent ?? 50))),
      longDiscountEnabled: input.pricing?.longDiscountEnabled ?? current.pricing?.longDiscountEnabled ?? Number(input.pricing?.longDiscountPercent ?? current.pricing?.longDiscountPercent ?? 0) > 0,
      allowSustainedCompute: input.pricing?.allowSustainedCompute ?? current.pricing?.allowSustainedCompute ?? true,
    },
    updatedAt: new Date().toISOString(),
  }
  await ensurePersistenceLayout(paths)
  await writeJsonAtomic(paths.providerEnvironmentSettingsPath, next)
  return providerEnvironmentStorageDetails(next)
}

async function provider_environment_choose_root(payload = {}) {
  const current = await provider_environment_storage()
  const paths = await dockPaths()
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose virtual environment root',
    defaultPath: current.rootPath || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths?.[0]) return current
  const rootPath = path.resolve(result.filePaths[0])
  const imageCachePath = path.resolve(path.join(paths.rootDir, 'provider', 'images'))
  if (pathsOverlap(rootPath, imageCachePath) || pathsOverlap(imageCachePath, rootPath)) throw new Error('Virtual environments must use a directory separate from the Exora image cache.')
  await fsp.mkdir(rootPath, { recursive: true })
  return saveProviderEnvironmentStorage({ rootPath, workspaceGiB: payload?.input?.workspaceGiB || current.workspaceGiB })
}

async function provider_environment_update_storage(payload = {}) {
  return saveProviderEnvironmentStorage(payload.input || payload)
}

async function provider_environment_catalog() {
  try {
    const response = await httpJson('GET', '/v3/catalog/environment-images?runtime=wsl2&arch=amd64', undefined, await localOwnerToken(await dockPaths()))
    return { ...response, images: response.images?.length ? response.images.map((image) => ({ ...image, cloudAvailable: true })) : bundledEnvironmentCatalog(), offline: !response.images?.length }
  } catch (error) {
    return { images: bundledEnvironmentCatalog(), offline: true, error: errorMessage(error) }
  }
}
async function provider_environment_installed() {
  const [local, cloud, storage] = await Promise.all([
    v3Worker('list_environment_images'),
    httpJson('GET', '/v3/provider/environment-images', undefined, await localOwnerToken(await dockPaths())).catch(() => ({ images: [] })),
    provider_environment_storage(),
  ])
  return { local: local.result || {}, attestations: cloud.images || [], storage }
}
async function provider_environment_cancel(payload = {}) {
  const key = String(payload?.input?.imageId || '')
  v3EnvironmentDownloads.get(key)?.abort()
  return { cancelled: true }
}
async function provider_environment_delete(payload = {}) {
  const storage = await provider_environment_storage()
  return v3Worker('delete_environment_image', { environmentId: String(payload?.input?.environmentId || ''), environmentRoot: storage.rootPath })
}
async function provider_environment_reserve(payload = {}) {
  const workspaceGiB = Math.max(1, Number(payload?.input?.workspaceGiB || 1))
  const environmentId = String(payload?.input?.environmentId || '')
  const imageId = String(payload?.input?.imageId || '')
  const imageVersion = String(payload?.input?.imageVersion || '')
  const storage = await provider_environment_storage()
  if (!storage.rootPath) throw new Error('Choose a virtual environment root before reserving capacity.')
  const catalog = await provider_environment_catalog()
  const selectedImage = (catalog.images || []).find((image) => {
    const catalogImageId = String(image.imageId || '')
    const catalogVersion = String(image.version || '')
    const catalogEnvironmentId = `${catalogImageId}-${catalogVersion}`.replace(/[^a-zA-Z0-9._-]/g, '-')
    return (catalogImageId === imageId && (!imageVersion || catalogVersion === imageVersion)) || (!imageId && catalogEnvironmentId === environmentId)
  })
  if (!selectedImage) throw new Error('The selected environment image is not available in the signed catalog.')
  const imageSizeBytes = Math.max(0, Number(selectedImage.manifest?.artifact?.sizeBytes || 0))
  const systemReserveBytes = 10 * 1024 * 1024 * 1024
  const capacity = await v3Worker('capacity_check', { checkLevel: 'full' })
  if (capacity.result?.healthy !== true) throw new Error('Windows provider capacity check failed')
  const reservation = await v3Worker('reserve_disk', {
    slotId: `wsl-${environmentId}`,
    sizeBytes: workspaceGiB * 1024 * 1024 * 1024,
    requiredFreeBytes: systemReserveBytes + imageSizeBytes,
    systemReserveBytes,
    environmentImageBytes: imageSizeBytes,
    environmentRoot: storage.rootPath,
  })
  return { capacity: capacity.result, reservation: reservation.result, environmentRoot: storage.rootPath }
}
async function provider_environment_release(payload = {}) {
  const environmentId = String(payload?.input?.environmentId || '')
  const storage = await provider_environment_storage()
  if (!storage.rootPath) return { released: false }
  return v3Worker('release_disk', { slotId: `wsl-${environmentId}`, environmentRoot: storage.rootPath })
}

function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).filter((key) => key !== 'signature' && key !== 'objectKey').sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function imageVerificationKey() {
  const configured = String(process.env.EXORA_IMAGE_VERIFY_PUBLIC_KEY || '').trim()
  if (configured) return configured
  const candidate = app.isPackaged ? path.join(process.resourcesPath, 'image-signing-public-key.txt') : path.join(__dirname, '..', 'resources', 'image-signing-public-key.txt')
  return fs.existsSync(candidate) ? fs.readFileSync(candidate, 'utf8').trim() : ''
}

function verifyEnvironmentManifest(manifest, signature) {
  const raw = Buffer.from(imageVerificationKey(), 'base64')
  if (raw.length !== 32) throw new Error('Exora environment image verification key is not configured.')
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw])
  const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' })
  if (!crypto.verify(null, Buffer.from(canonicalJSON(manifest)), key, Buffer.from(String(signature || ''), 'base64'))) throw new Error('Environment image manifest signature verification failed.')
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function provider_environment_download(payload = {}) {
  const input = payload.input || {}
  const imageId = String(input.imageId || '')
  const version = String(input.version || '')
  if (!imageId || !version) throw new Error('imageId and version are required')
  const catalog = await provider_environment_catalog()
  const downloadable = (catalog.images || []).some((image) => image.imageId === imageId && image.version === version && image.cloudAvailable !== false)
  if (!downloadable) throw new Error('The selected environment is not currently available to download from Exora Cloud.')
  const paths = await dockPaths()
  const imageDir = path.join(paths.rootDir, 'provider', 'images')
  await fsp.mkdir(imageDir, { recursive: true })
  const controller = new AbortController()
  v3EnvironmentDownloads.set(imageId, controller)
  try {
    const token = await localOwnerToken(paths)
    const started = await httpJson('POST', '/v3/provider/environment-image-downloads', { imageId, version }, token)
    const manifest = started.image?.manifest || {}
    verifyEnvironmentManifest(manifest, started.image?.signature)
    const artifact = manifest.artifact || {}
    const finalPath = path.join(imageDir, `${imageId}-${version}.wsl`)
    const partialPath = `${finalPath}.partial`
    let offset = fs.existsSync(partialPath) ? (await fsp.stat(partialPath)).size : 0
    let url = started.url
    let interruptedAttempts = 0
    while (offset < Number(artifact.sizeBytes || 0)) {
      try {
        const response = await fetchWithTimeout(url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal: controller.signal }, 30000)
        if (!response.ok && response.status !== 206) throw new Error(`Environment image download failed with HTTP ${response.status}`)
        if (offset && response.status !== 206) {
          offset = 0
          await fsp.rm(partialPath, { force: true })
        }
        const handle = await fsp.open(partialPath, offset ? 'a' : 'w')
        try {
          const reader = response.body?.getReader()
          if (!reader) throw new Error('Environment image response has no body')
          while (true) {
            const { done, value } = await readStreamChunk(reader, 30000, controller.signal)
            if (done) break
            const chunk = Buffer.from(value)
            await handle.write(chunk)
            offset += chunk.length
            mainWindow?.webContents.send('exora:v3-progress', { kind: 'environment_image', imageId, phase: 'downloading', bytesDownloaded: offset, sizeBytes: Number(artifact.sizeBytes || 0) })
          }
        } finally { await handle.close() }
        interruptedAttempts = 0
      } catch (error) {
        if (controller.signal.aborted) throw error
        interruptedAttempts += 1
        if (interruptedAttempts > 8) throw new Error(`Environment image download could not resume: ${errorMessage(error)}`)
        const refreshed = await httpJson('POST', `/v3/provider/environment-image-downloads/${encodeURIComponent(started.download.downloadId)}/refresh`, { bytesDownloaded: offset }, token)
        url = refreshed.url
        if (interruptedAttempts > 1) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(5000, interruptedAttempts * 500)))
        }
        continue
      }
    }
    mainWindow?.webContents.send('exora:v3-progress', { kind: 'environment_image', imageId, phase: 'verifying' })
    const digest = await sha256File(partialPath)
    if (offset !== Number(artifact.sizeBytes) || digest.toLowerCase() !== String(artifact.sha256 || '').toLowerCase()) throw new Error('Downloaded environment image size or SHA-256 mismatch.')
    await httpJson('POST', `/v3/provider/environment-image-downloads/${encodeURIComponent(started.download.downloadId)}/complete`, { sizeBytes: offset, sha256: digest }, token)
    await fsp.rename(partialPath, finalPath)
    const environmentId = `${imageId}-${version}`.replace(/[^a-zA-Z0-9._-]/g, '-')
    const storage = await provider_environment_storage()
    if (!storage.rootPath) throw new Error('Choose a virtual environment root before installing an environment.')
    mainWindow?.webContents.send('exora:v3-progress', { kind: 'environment_image', imageId, phase: 'importing' })
    await v3Worker('import_environment_image', { environmentId, artifactPath: finalPath, environmentRoot: storage.rootPath })
    mainWindow?.webContents.send('exora:v3-progress', { kind: 'environment_image', imageId, phase: 'validating' })
    const checked = await v3Worker('validate_environment_image', { environmentId, cudaRequired: Boolean(manifest.gpu?.required) })
    await httpJson('POST', `/v3/provider/environment-images/${encodeURIComponent(imageId)}/attestations`, { version, status: 'ready', report: checked.result }, token)
    return { imageId, version, environmentId, status: 'ready', report: checked.result }
  } finally {
    v3EnvironmentDownloads.delete(imageId)
  }
}

async function showResourceFileDialog() {
  const options = {
    title: currentAppSettings.language === 'zh' ? '选择要单独出售的资源文件' : 'Choose independently sold resource files',
    defaultPath: app.getPath('documents'),
    properties: ['openFile', 'multiSelections'],
  }
  if (!mainWindow || mainWindow.isDestroyed()) return dialog.showOpenDialog(options)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.moveTop()
  mainWindow.focus()
  await new Promise((resolve) => setImmediate(resolve))
  return dialog.showOpenDialog(mainWindow, options)
}

async function provider_asset_choose_files(payload = {}) {
  const input = payload?.input || {}
  let filePaths
  if (Array.isArray(input.filePaths)) {
    filePaths = [...new Set(input.filePaths.map((value) => String(value || '').trim()).filter(Boolean))]
    if (!filePaths.length) throw new Error('Drop at least one local file.')
  } else {
    const result = await showResourceFileDialog()
    if (result.canceled || !result.filePaths.length) return { canceled: true }
    filePaths = result.filePaths
  }
  const selected = await inspectResourceFiles(filePaths, {
    onProgress: (progress) => mainWindow?.webContents.send('exora:v3-progress', { kind: 'asset_hashing', ...progress }),
  })
  for (const file of selected) v3SelectedResourceFiles.set(file.token, file)
  return { files: selected.map(({ localPath: _localPath, mtimeMs: _mtimeMs, ...file }) => file) }
}

async function provider_asset_clear_selection() {
  await clearSelectedResourceArchives()
  return { cleared: true }
}

async function provider_asset_create(payload = {}) {
  return httpJson('POST', '/v3/provider/resource-sheets', payload.input || {}, await localOwnerToken(await dockPaths()))
}

async function provider_asset_upload(payload = {}) {
  const input = payload.input || {}
  const requested = Array.isArray(input.items) ? input.items : []
  if (!input.sheetId || !requested.length) throw new Error('A Resource sheet and at least one priced file are required.')
  const owner = await localOwnerToken(await dockPaths())
  const localRecords = requested.map((item) => {
    const record = v3SelectedResourceFiles.get(String(item.fileToken || ''))
    if (!record) throw new Error('A selected resource file is unavailable. Choose it again.')
    return { item, record }
  })
  await Promise.all(localRecords.map(({ record }) => validateResourceFile(record)))
  const created = await httpJson('POST', `/v3/provider/resource-sheets/${encodeURIComponent(String(input.sheetId))}/items`, {
    idempotencyKey: String(input.idempotencyKey || crypto.randomUUID()),
    items: localRecords.map(({ item, record }) => ({
      clientId: record.token, title: item.title, description: item.description, fileName: record.name,
      contentType: 'application/octet-stream', license: item.license, tags: item.tags, price: item.price,
      grantHours: item.grantHours, sizeBytes: record.sizeBytes, sha256: record.sha256,
    })),
  }, owner)
  const cloudItems = created.items || []
  for (let index = 0; index < localRecords.length; index += 1) {
    const { record } = localRecords[index]
    const cloudItem = cloudItems[index]
    if (!cloudItem?.resourceItemId) throw new Error('Cloud did not create the resource item.')
    const started = await httpJson('POST', `/v3/provider/resource-items/${encodeURIComponent(cloudItem.resourceItemId)}/multipart`, {}, owner)
    if (!started.zeroByte) await uploadResourceItemParts(record, started.upload, owner)
    mainWindow?.webContents.send('exora:v3-progress', { kind: 'asset_upload', phase: 'uploading', completed: index + 1, total: localRecords.length, completedFiles: index + 1, totalFiles: localRecords.length, percent: Math.round((index + 1) / localRecords.length * 100), resourceItemId: cloudItem.resourceItemId })
    v3SelectedResourceFiles.delete(record.token)
  }
  return { ...created, status: 'complete' }
}

async function uploadResourceItemParts(record, upload, owner) {
  const partSize = 16 * 1024 * 1024
  const partCount = Math.max(1, Math.ceil(record.sizeBytes / partSize))
  const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1)
  const presigned = await httpJson('POST', `/v3/provider/uploads/${encodeURIComponent(upload.uploadSessionId)}/parts/presign`, { partNumbers }, owner)
  const handle = await fsp.open(record.localPath, 'r')
  const parts = []
  try {
    for (const partNumber of partNumbers) {
      const offset = (partNumber - 1) * partSize
      const length = Math.min(partSize, record.sizeBytes - offset)
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, offset)
      const result = await fetchTextWithTimeout(presigned.urls[String(partNumber)], { method: 'PUT', body: buffer }, 120000)
      if (!result.response.ok) throw new Error(`S3 part ${partNumber} failed with ${result.response.status}: ${result.text.slice(0, 300)}`)
      parts.push({ partNumber, etag: result.response.headers.get('etag') || '' })
    }
  } finally { await handle.close() }
  return httpJson('POST', `/v3/provider/uploads/${encodeURIComponent(upload.uploadSessionId)}/complete`, { parts }, owner, { timeoutMs: 180000 })
}
async function provider_asset_cancel(payload = {}) {
  const id = String(payload?.input?.uploadSessionId || '')
  return httpJson('POST', `/v3/provider/uploads/${encodeURIComponent(id)}/abort`, {}, await localOwnerToken(await dockPaths()))
}

async function clearSelectedResourceArchives() {
  v3SelectedResourceFiles.clear()
}

const API_BRIDGE_MATERIAL_EXTENSIONS = new Set([
  'json', 'yaml', 'yml', 'md', 'markdown', 'txt', 'csv', 'http', 'rest', 'curl',
  'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'java', 'kt', 'kts', 'cs', 'rb', 'php',
  'rs', 'swift', 'sh', 'ps1',
])
const API_BRIDGE_FILE_LIMIT = 5 * 1024 * 1024
const API_BRIDGE_PACKAGE_LIMIT = 20 * 1024 * 1024
const API_BRIDGE_FILE_COUNT_LIMIT = 20

function apiBridgeMaterialRoot(draftId) {
  const safe = String(draftId || '').trim()
  if (!/^apid_[A-Za-z0-9_-]{8,128}$/.test(safe)) throw new Error('API Bridge draft id is invalid')
  return path.join(app.getPath('userData'), 'api-bridge-materials', safe)
}
async function readAPIBridgeMaterialManifest(draftId) {
  const root = apiBridgeMaterialRoot(draftId)
  return readStoredAPIBridgeMaterialManifest(root, draftId)
}
async function writeAPIBridgeMaterialManifest(draftId, manifest) {
  const root = apiBridgeMaterialRoot(draftId)
  await writeJSONAtomically(path.join(root, 'manifest.json'), manifest)
}
async function provider_api_bridge_materials_get(payload = {}) {
  return readAPIBridgeMaterialManifest(payload?.input?.draftId)
}
async function apiBridgeFileOperation(label, operation, timeoutMs = 15000) {
  let timeout
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} did not respond within ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs)
  })
  try { return await Promise.race([operation, deadline]) }
  finally { clearTimeout(timeout) }
}
async function storeAPIBridgeMaterials(draftId, sourcePaths) {
  const root = apiBridgeMaterialRoot(draftId)
  return withAPIBridgeMaterialMutation(root, async () => {
  const current = await readAPIBridgeMaterialManifest(draftId)
  const uniquePaths = [...new Set((sourcePaths || []).map((value) => String(value || '').trim()).filter(Boolean))]
  if (!uniquePaths.length) throw new Error('Choose or drop at least one API material')
  if (uniquePaths.length > API_BRIDGE_FILE_COUNT_LIMIT) throw new Error('An API material package can contain at most 20 files')
  const candidates = await Promise.all(uniquePaths.map(async (sourcePath) => {
    const extension = path.extname(sourcePath).slice(1).toLowerCase()
    if (!API_BRIDGE_MATERIAL_EXTENSIONS.has(extension)) throw new Error(`Unsupported API material: ${path.basename(sourcePath)}`)
    const stat = await apiBridgeFileOperation(`Reading ${path.basename(sourcePath)}`, fsp.stat(sourcePath))
    if (!stat.isFile()) throw new Error(`${path.basename(sourcePath)} is not a regular file`)
    if (stat.size > API_BRIDGE_FILE_LIMIT) throw new Error(`${path.basename(sourcePath)} exceeds the 5 MiB file limit`)
    return { sourcePath, name: path.basename(sourcePath), extension, sizeBytes: stat.size }
  }))
  const byName = new Map((current.files || []).map(file => [String(file.name).toLowerCase(), file]))
  for (const candidate of candidates) byName.set(candidate.name.toLowerCase(), candidate)
  const combined = Array.from(byName.values())
  if (combined.length > API_BRIDGE_FILE_COUNT_LIMIT) throw new Error('An API material package can contain at most 20 files')
  if (combined.reduce((sum, file) => sum + Number(file.sizeBytes || 0), 0) > API_BRIDGE_PACKAGE_LIMIT) throw new Error('The API material package exceeds 20 MiB')
  await Promise.all(candidates.map(async (candidate) => {
    candidate.contents = await apiBridgeFileOperation(`Reading ${candidate.name}`, fsp.readFile(candidate.sourcePath))
    if (candidate.contents.length !== candidate.sizeBytes) throw new Error(`${candidate.name} changed while it was being imported`)
    validateTextMaterial(candidate.contents, candidate.name)
  }))
  await fsp.mkdir(root, { recursive: true })
  const files = []
  for (const file of combined) {
    if (file.sourcePath) {
      const storedName = `${crypto.createHash('sha256').update(file.name.toLowerCase()).digest('hex').slice(0, 12)}-${file.name}`
      const storedPath = path.join(root, storedName)
      await fsp.writeFile(storedPath, file.contents)
      files.push({ id: storedName, name: file.name, extension: file.extension, sizeBytes: file.sizeBytes, sha256: crypto.createHash('sha256').update(file.contents).digest('hex'), localPath: storedPath })
    } else files.push(file)
  }
  const manifest = { draftId, files, updatedAt: new Date().toISOString() }; await writeAPIBridgeMaterialManifest(draftId, manifest); return manifest
  })
}
async function provider_api_bridge_materials_choose(payload = {}) {
  const draftId = String(payload?.input?.draftId || '')
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'API materials', extensions: Array.from(API_BRIDGE_MATERIAL_EXTENSIONS) }] })
  if (result.canceled) return { ...(await readAPIBridgeMaterialManifest(draftId)), canceled: true }
  return storeAPIBridgeMaterials(draftId, result.filePaths)
}
async function provider_api_bridge_materials_add(payload = {}) {
  const draftId = String(payload?.input?.draftId || '')
  const filePaths = payload?.input?.filePaths
  if (!Array.isArray(filePaths)) throw new Error('Dropped API material paths are required')
  return storeAPIBridgeMaterials(draftId, filePaths)
}
async function provider_api_bridge_material_remove(payload = {}) {
  const draftId = String(payload?.input?.draftId || ''); const id = String(payload?.input?.id || '')
  return removeAPIBridgeMaterial({ root: apiBridgeMaterialRoot(draftId), draftId, id })
}

async function provider_service_material_note_save(payload = {}) {
  const draftId = String(payload?.input?.draftId || '')
  const text = String(payload?.input?.text || '').trim()
  if (!text) throw new Error('Service description or examples are required')
  const contents = Buffer.from(text, 'utf8')
  if (contents.length > API_BRIDGE_FILE_LIMIT) throw new Error('Service description exceeds the 5 MiB material limit')
  const root = apiBridgeMaterialRoot(draftId)
  return withAPIBridgeMaterialMutation(root, async () => {
    const current = await readAPIBridgeMaterialManifest(draftId)
    const id = 'seller-service-description.md'
    const otherFiles = (current.files || []).filter((file) => file.id !== id)
    if (otherFiles.length + 1 > API_BRIDGE_FILE_COUNT_LIMIT) throw new Error('An API material package can contain at most 20 files')
    const totalBytes = otherFiles.reduce((sum, file) => sum + Number(file.sizeBytes || 0), 0) + contents.length
    if (totalBytes > API_BRIDGE_PACKAGE_LIMIT) throw new Error('The API material package exceeds 20 MiB')
    await fsp.mkdir(root, { recursive: true })
    const storedPath = path.join(root, id)
    await fsp.writeFile(storedPath, contents)
    const note = { id, name: 'service-description.md', extension: 'md', sizeBytes: contents.length, sha256: crypto.createHash('sha256').update(contents).digest('hex'), localPath: storedPath }
    const manifest = { draftId, files: [...otherFiles, note], updatedAt: new Date().toISOString() }
    await writeAPIBridgeMaterialManifest(draftId, manifest)
    return manifest
  })
}

async function provider_service_draft_get(payload = {}) {
  return httpJson('GET', `/v3/provider/service-drafts/${encodeURIComponent(String(payload?.input?.draftId || ''))}`, undefined, await localOwnerToken(await dockPaths()))
}
async function provider_service_draft_save(payload = {}) {
  const input = payload.input || {}
  const draftId = String(input.draftId || '').trim()
  const route = draftId ? `/v3/provider/service-drafts/${encodeURIComponent(draftId)}` : '/v3/provider/service-drafts'
  return httpJson(draftId ? 'PUT' : 'POST', route, input, await localOwnerToken(await dockPaths()), { timeoutMs: 30000 })
}

async function provider_service_draft_submit(payload = {}) {
  const input = payload.input || {}
  const draftId = String(input.draftId || '').trim()
  if (!draftId || !String(input.idempotencyKey || '').trim()) throw new Error('Service draft and idempotencyKey are required')
  return httpJson('POST', `/v3/provider/service-drafts/${encodeURIComponent(draftId)}/submit`, input, await localOwnerToken(await dockPaths()), { timeoutMs: 30000 })
}

function resourceArchiveTempRoot() {
  return path.join(app.getPath('temp'), 'exora-dock', 'resource-bundles')
}

function publicHTTPSBridgeURL(baseUrl, routePath) {
  let base
  try { base = new URL(String(baseUrl || '')) } catch { throw new Error('Base URL is invalid') }
  const hostname = base.hostname.toLowerCase()
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Base URL must be a public HTTPS URL without embedded credentials')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === '::1' || hostname.startsWith('127.') || hostname.startsWith('10.') || hostname.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || hostname === '0.0.0.0') throw new Error('Base URL must not resolve to a local or private host')
  return new URL(String(routePath || '/health'), base.href.endsWith('/') ? base.href : `${base.href}/`)
}

async function provider_api_probe(payload = {}) {
  const input = payload.input || {}
  const target = publicHTTPSBridgeURL(input.baseUrl, input.healthPath)
  const headers = { Accept: 'application/json, text/event-stream;q=0.9, */*;q=0.5' }
  const secret = String(input.secret || '')
  const authType = String(input.authType || 'none').trim().toLowerCase()
  const authName = String(input.apiKeyHeader || '').trim()
  let tlsOptions
  if (authType === 'bearer' && secret) headers.Authorization = `Bearer ${secret}`
  else if (authType === 'basic' && secret) headers.Authorization = `Basic ${Buffer.from(secret).toString('base64')}`
  else if (authType === 'api_key' || authType === 'header_api_key') {
    const header = authName || 'X-API-Key'
    if (!/^[A-Za-z0-9-]{1,64}$/.test(header)) throw new Error('API key header name is invalid')
    headers[header] = secret
  } else if (authType === 'query_api_key') target.searchParams.set(authName || 'api_key', secret)
  else if (authType === 'cookie_api_key') headers.Cookie = `${encodeURIComponent(authName || 'api_key')}=${encodeURIComponent(secret)}`
  else if (authType === 'oauth2_client_credentials') headers.Authorization = `Bearer ${await desktopOAuthClientToken(secret)}`
  else if (authType === 'mtls') tlsOptions = desktopMTLSOptions(secret)
  else if (authType !== 'none') throw new Error('Unsupported Provider authentication type')
  const started = Date.now()
  let response = tlsOptions ? await desktopHTTPSProbe(target, 'HEAD', headers, tlsOptions) : await fetchWithTimeout(target, { method: 'HEAD', headers, redirect: 'error', cache: 'no-store' }, 12000)
  if (response.status === 405 || response.status === 501) response = tlsOptions ? await desktopHTTPSProbe(target, 'GET', headers, tlsOptions) : await fetchWithTimeout(target, { method: 'GET', headers, redirect: 'error', cache: 'no-store' }, 12000)
  const contentType = typeof response.headers?.get === 'function' ? response.headers.get('content-type') || '' : String(response.headers?.['content-type'] || '')
  const out = { ok: response.status >= 200 && response.status < 400, status: response.status, latencyMs: Date.now() - started, contentType, checkedURL: target.origin + target.pathname }
  if (!out.ok) out.error = `Provider returned HTTP ${response.status}`
  try { await response.body?.cancel() } catch {}
  return out
}

async function desktopOAuthClientToken(raw) {
  let config
  try { config = JSON.parse(raw) } catch { throw new Error('OAuth2 credential is invalid') }
  let parsedTokenURL
  try { parsedTokenURL = new URL(String(config.tokenUrl || '')) } catch { throw new Error('OAuth2 Token URL is invalid') }
  const tokenURL = publicHTTPSBridgeURL(parsedTokenURL.origin, parsedTokenURL.pathname + parsedTokenURL.search)
  if (!config.clientId || !config.clientSecret) throw new Error('OAuth2 Client ID and Client Secret are required')
  const form = new URLSearchParams({ grant_type: 'client_credentials' })
  if (config.scope) form.set('scope', String(config.scope))
  if (config.audience) form.set('audience', String(config.audience))
  const response = await fetchWithTimeout(tokenURL, { method: 'POST', redirect: 'error', headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString() }, 12000)
  if (!response.ok) throw new Error(`OAuth2 token endpoint returned HTTP ${response.status}`)
  const body = await response.json()
  if (!body?.access_token) throw new Error('OAuth2 token endpoint returned no access token')
  return String(body.access_token)
}

function desktopMTLSOptions(raw) {
  let config
  try { config = JSON.parse(raw) } catch { throw new Error('mTLS credential is invalid') }
  if (!config.certificatePem || !config.privateKeyPem) throw new Error('mTLS client certificate and private key are required')
  return { cert: config.certificatePem, key: config.privateKeyPem, ca: config.caPem || undefined, servername: config.serverName || undefined, minVersion: 'TLSv1.2', rejectUnauthorized: true }
}

function desktopHTTPSProbe(target, method, headers, tlsOptions) {
  return new Promise((resolve, reject) => {
    const request = https.request(target, { method, headers, ...tlsOptions, timeout: 12000 }, (response) => {
      response.resume()
      resolve({ status: response.statusCode || 0, headers: response.headers, body: undefined })
    })
    request.on('timeout', () => request.destroy(new Error('Provider connection timed out')))
    request.on('error', () => reject(new Error('Provider TLS connection failed')))
    request.end()
  })
}
async function provider_endpoint_local_save(payload = {}) {
  const input = payload.input || {}
  const endpointId = String(input.endpointId || '')
  return httpJson('PUT', `/v3/local/endpoints/${encodeURIComponent(endpointId)}`, input, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
}
async function provider_endpoint_local_list() {
  return httpJson('GET', '/v3/local/endpoints', undefined, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
}
async function provider_endpoint_probe(payload = {}) {
  return httpJson('POST', '/v3/local/endpoints/probe', payload.input || {}, await localOwnerToken(await dockPaths()), { timeoutMs: 20000 })
}
async function provider_endpoint_test_route(payload = {}) {
  return httpJson('POST', '/v3/local/endpoints/test-route', payload.input || {}, await localOwnerToken(await dockPaths()), { timeoutMs: 35000 })
}
async function provider_listings() {
  try { return await httpJson('GET', '/v3/provider/listings', undefined, await localOwnerToken(await dockPaths())) }
  catch (error) { return { listings: [], offline: true, error: errorMessage(error) } }
}
async function provider_listing_save(payload = {}) {
  const input = payload.input || {}
  const route = input.listingId ? `/v3/provider/listings/${encodeURIComponent(input.listingId)}` : '/v3/provider/listings'
  return httpJson(input.listingId ? 'PUT' : 'POST', route, input, await localOwnerToken(await dockPaths()))
}
async function provider_listing_action(payload = {}) {
  const input = payload.input || {}
  return httpJson('POST', `/v3/provider/listings/${encodeURIComponent(String(input.listingId || ''))}/${encodeURIComponent(String(input.action || ''))}`, {}, await localOwnerToken(await dockPaths()))
}
async function provider_listing_delete(payload = {}) {
  const input = payload.input || {}
  return httpJson('DELETE', `/v3/provider/listings/${encodeURIComponent(String(input.listingId || ''))}`, undefined, await localOwnerToken(await dockPaths()))
}

async function provider_resource_item_update(payload = {}) {
  const input = payload.input || {}
  return httpJson('PATCH', `/v3/provider/resource-items/${encodeURIComponent(String(input.resourceItemId || ''))}`, input, await localOwnerToken(await dockPaths()))
}

async function provider_resource_item_action(payload = {}) {
  const input = payload.input || {}
  return httpJson('POST', `/v3/provider/resource-items/${encodeURIComponent(String(input.resourceItemId || ''))}/${encodeURIComponent(String(input.action || ''))}`, {}, await localOwnerToken(await dockPaths()))
}

async function seller_automation_policy_get() {
  return httpJson('GET', '/v3/local/seller-automation/policy', undefined, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
}

async function seller_automation_policy_save(payload = {}) {
  const paths = await dockPaths()
  const owner = await localOwnerToken(paths)
  const result = await httpJson('PUT', '/v3/local/seller-automation/policy', payload.input || {}, owner, { timeoutMs: 20000 })
  const currentSessionPolicy = await httpJson('GET', '/v3/local/agent-session-policy', undefined, owner, { timeoutMs: 15000 }).catch(() => ({ scopes: ['market.read', 'compute.use', 'resources.use', 'api.invoke', 'account.read'] }))
  const scopes = Array.isArray(currentSessionPolicy.scopes) ? currentSessionPolicy.scopes.filter((scope) => scope !== 'seller.draft') : []
  if (payload?.input?.enabled === true) scopes.push('seller.draft')
  await httpJson('PUT', '/v3/local/agent-session-policy', { scopes }, owner, { timeoutMs: 15000 })
  return result
}

async function seller_automation_credentials() {
  return httpJson('GET', '/v3/local/seller-automation/credentials', undefined, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
}

async function seller_automation_credential_save(payload = {}) {
  return httpJson('POST', '/v3/local/seller-automation/credentials', payload.input || {}, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
}

async function seller_automation_credential_delete(payload = {}) {
  const ref = String(payload?.input?.credentialRef || '')
  if (!ref) throw new Error('credentialRef is required')
  return httpJson('DELETE', `/v3/local/seller-automation/credentials/${encodeURIComponent(ref)}`, undefined, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
}

async function seller_automation_choose_root() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], title: 'Authorize a seller resource folder' })
  return { canceled: result.canceled, path: result.filePaths[0] || '' }
}

async function seller_automation_draft_runs(payload = {}) {
  const limit = Math.max(1, Math.min(100, Number(payload?.input?.limit || 20)))
  return httpJson('GET', `/v3/provider-agent/draft-runs?limit=${limit}`, undefined, await localOwnerToken(await dockPaths()), { timeoutMs: 15000 })
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
    const error = new Error(String(decoded?.error || `Local Exora Dock returned HTTP ${response.status}`))
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
