const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, screen, session, shell, Tray } = require('electron')
const { spawn, execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const net = require('node:net')
const path = require('node:path')
const YAML = require('yaml')
const { registerIpcHandlers } = require('./ipc.cjs')
const { createCloudAuth } = require('./cloud-auth.cjs')
const {
  createAppURLPolicy,
  installNavigationGuards,
  isTrustedIpcSender,
} = require('./security.cjs')
const { cleanupLegacyFrontendData } = require('./legacy-frontend-cleanup.cjs')
const { SETTINGS_VERSION, normalizeAppSettingsV3 } = require('./app-settings.cjs')
const {
  MAX_RESOURCE_ARCHIVE_BYTES,
  cleanupResourceArchive,
  cleanupResourceArchiveSync,
  cleanupStaleResourceArchives,
  createResourceArchive,
  validateResourceArchiveForUpload,
} = require('./resource-archive.cjs')

const APP_ID = 'io.exora.dock'
const BASE_URL = 'http://127.0.0.1:8080'
const DAEMON_NAME = 'exora-dockd'
const DAEMON_LOG_NAME = 'daemon.log'
const DESKTOP_STATE_NAME = 'desktop-state.json'
const PERSISTENCE_DIR_NAME = 'exora-data'
const v3SelectedArchives = new Map()
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
  await migrateLegacyFrontendData().catch((error) => {
    console.error('Failed to remove retired frontend data; cleanup will retry next launch:', error)
  })
  await cleanupStaleResourceArchives(resourceArchiveTempRoot(), { maxAgeMs: 1 }).catch((error) => {
    console.error('Failed to clean stale resource archives:', error)
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
  for (const archive of v3SelectedArchives.values()) {
    try { cleanupResourceArchiveSync(archive) } catch (error) { console.error('Failed to remove a temporary resource archive:', error) }
  }
  v3SelectedArchives.clear()
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
    { label: chinese ? '打开 Exora Dock' : 'Open Exora Dock', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: chinese ? '退出' : 'Quit', click: () => { appIsQuitting = true; app.quit() } },
  ]))
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
      auth_social_start,
      auth_social_complete,
    },
    dockRuntime: {
      app_status,
      release_status,
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
      order_access_key_status,
      order_access_key_create,
      order_access_key_rotate,
      order_access_key_revoke,
      consumer_approval_decide,
      consumer_account_balance,
      consumer_purchase_estimate,
      consumer_invoke_operation,
      consumer_purchase_download,
      consumer_create_transfer,
      consumer_purchase_compute,
      consumer_compute_purchase,
      consumer_extend_compute,
      consumer_get_lease,
      consumer_release_lease,
      activity_sessions,
      activity_session,
      provider_vm_probe,
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
      provider_api_bridge_material_remove,
      provider_api_bridge_materials_get,
      provider_api_bridge_draft_get,
      provider_api_bridge_draft_save,
      provider_api_bridge_finalize,
      provider_openapi_choose,
      provider_api_probe,
      provider_openapi_import,
      provider_api_bridge_import,
      provider_endpoint_local_save,
      provider_endpoint_local_list,
      provider_endpoint_probe,
      provider_endpoint_test_route,
      provider_endpoint_import,
      provider_listings,
      provider_listing_save,
      provider_listing_action,
    },
    walletAndSecurity: {
      wallet_status,
      wallet_spend_policy_save,
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
async function auth_login(payload) { return cloudAuth.login(payload) }
async function auth_password_reset_start(payload) { return cloudAuth.passwordResetStart(payload) }
async function auth_password_reset_complete(payload) { return cloudAuth.passwordResetComplete(payload) }
async function auth_pin_set(payload) { return cloudAuth.setPIN(payload) }
async function auth_pin_change(payload) { return cloudAuth.changePIN(payload) }
async function auth_pin_reset(payload) { return cloudAuth.resetPIN(payload) }
async function auth_logout() { return cloudAuth.logout() }
async function auth_social_start(payload) { return cloudAuth.socialStart(payload) }
async function auth_social_complete(payload) { return cloudAuth.socialComplete(payload) }

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
  const manifestURL = String(process.env.EXORA_RELEASE_MANIFEST_URL || 'https://github.com/UmbraFi/exora-dock/releases/download/v0.1.0-preview.1/release-manifest.json').trim()
  const signatureURL = manifestURL.replace(/release-manifest\.json(?:\?.*)?$/, 'release-manifest.sig')
  const [manifestResponse, signatureResponse] = await Promise.all([fetch(manifestURL), fetch(signatureURL)])
  if (!manifestResponse.ok || !signatureResponse.ok) throw new Error('The signed Technical Preview release manifest is unavailable.')
  const encoded = Buffer.from(await manifestResponse.arrayBuffer())
  const signature = Buffer.from((await signatureResponse.text()).trim(), 'base64')
  const raw = Buffer.from(releaseVerificationKey(), 'base64')
  if (raw.length !== 32) throw new Error('Release verification key is not configured.')
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw])
  const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' })
  if (!crypto.verify(null, encoded, key, signature)) throw new Error('Release manifest signature verification failed.')
  const manifest = JSON.parse(encoded.toString('utf8'))
  if (manifest.schema !== 'exora.release-manifest.v1' || manifest.platform !== 'windows' || !/^[a-f0-9]{64}$/.test(String(manifest.sha256 || ''))) throw new Error('Release manifest contract is invalid.')
  return {
    currentVersion: String(app.getVersion() || ''),
    latestVersion: String(manifest.version || ''),
    updateAvailable: String(manifest.version || '').replace(/^v/, '') !== String(app.getVersion() || ''),
    artifact: manifest.artifact,
    sha256: manifest.sha256,
    authentiCodeSigned: false,
    warning: 'Unsigned Technical Preview: Windows may show Unknown publisher or SmartScreen warnings.',
    downloadURL: new URL(String(manifest.artifact), manifestURL).toString(),
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
	const [balanceResult, custodyResult, depositsResult, withdrawalsResult, spendPolicyResult] = await Promise.all([
    cloudAuth.apiRequest('GET', '/v3/billing/balance'),
    cloudAuth.apiRequest('GET', '/v3/billing/custody-status'),
    cloudAuth.apiRequest('GET', '/v3/billing/deposits'),
    cloudAuth.apiRequest('GET', '/v3/billing/withdrawals'),
		cloudAuth.apiRequest('GET', '/v3/account/spend-policy'),
  ])
	let addressResult = {}
	try {
		addressResult = await cloudAuth.apiRequest('GET', '/v3/billing/deposit-address')
	} catch (error) {
		if (Number(error?.status || 0) !== 423 && Number(error?.status || 0) !== 503) throw error
	}
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

async function system_settings_status() {
  const paths = await dockPaths()
  const [runtime, storage] = await Promise.all([
    app_status().catch((error) => ({ container: 'unknown', daemon: 'offline', message: errorMessage(error) })),
    storageSnapshot(paths),
  ])
  const login = app.getLoginItemSettings()
  const downloadDirectory = currentAppSettings.downloadDirectory || app.getPath('downloads')
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
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
    cloudURL: configuredCloudURL() || process.env.EXORA_CLOUD_URL || '',
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
    title: currentAppSettings.language === 'zh' ? '选择默认下载目录' : 'Choose default download directory',
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
    runtime: redactDiagnostics(runtime),
    storage,
    preferences: redactDiagnostics(normalizeAppSettingsV3(currentAppSettings)),
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: currentAppSettings.language === 'zh' ? '导出脱敏诊断包' : 'Export redacted diagnostics',
    defaultPath: path.join(app.getPath('downloads'), `exora-diagnostics-${new Date().toISOString().slice(0, 10)}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await writeJsonAtomic(result.filePath, report)
  return { canceled: false, path: result.filePath }
}

async function system_update_check() {
  return updateStatus(true)
}

async function system_update_install() {
  throw new Error('No downloaded update is ready to install.')
}

async function system_open_legal(payload = {}) {
  const input = objectOr(payload.input || payload)
  const root = path.join(__dirname, '..', '..')
  const target = input.kind === 'privacy'
    ? path.join(root, 'docs', currentAppSettings.language === 'zh' ? 'WHITEPAPER.zh-CN.md' : 'WHITEPAPER.en.md')
    : path.join(root, 'LICENSE')
  await openPath(target)
  return { opened: true }
}

function updateStatus(checked = false) {
  return {
    supported: app.isPackaged,
    channel: 'stable',
    automatic: currentAppSettings.autoUpdate,
    state: app.isPackaged ? 'manual' : 'development',
    checkedAt: checked ? new Date().toISOString() : '',
    message: app.isPackaged
      ? 'Update metadata is not configured for this distribution.'
      : 'Updates are disabled in development builds.',
  }
}

async function storageSnapshot(paths) {
  const [dataBytes, logsBytes, cacheBytes, tempBytes] = await Promise.all([
    directorySize(paths.dataDir), directorySize(paths.logsDir), directorySize(app.getPath('cache')), directorySize(resourceArchiveTempRoot()),
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

function redactDiagnostics(value) {
  if (Array.isArray(value)) return value.map(redactDiagnostics)
  if (!value || typeof value !== 'object') return value
  const secret = /(pin|token|secret|password|authorization|api.?key|access.?key|credential)/i
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => secret.test(key) ? [] : [[key, redactDiagnostics(item)]]))
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

async function wallet_create() { throw new Error('Local Solana wallets are retired; Exora now uses platform custody.') }
async function wallet_unlock() { throw new Error('Local Solana wallets are retired; Exora now uses platform custody.') }
async function wallet_restore() { throw new Error('Local Solana wallets are retired; Exora now uses platform custody.') }

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
    localAgentBindingPath: path.join(persistenceDir, 'settings', 'local-agent-binding.json'),
    localAgentScanPath: path.join(persistenceDir, 'settings', 'local-agent-scan.json'),
    providerHostSnapshotPath: path.join(persistenceDir, 'settings', 'provider-host-snapshot.json'),
    providerEnvironmentSettingsPath: path.join(persistenceDir, 'settings', 'provider-environment.json'),
    legacyConversationsRoot: path.join(persistenceDir, 'conversations'),
    legacyTransactionsRoot: path.join(persistenceDir, 'transactions'),
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
  workspace_dir: ${yamlQuote(path.join(paths.dataDir, 'provider-workspace'))}
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

async function catalog_listings(payload = {}) {
  const input = payload?.input || {}
  const query = new URLSearchParams()
  for (const key of ['q', 'kind']) {
    const value = String(input[key] || '').trim()
    if (value) query.set(key, value)
  }
  return httpJson('GET', `/v3/catalog/listings${query.size ? `?${query}` : ''}`, undefined, await localOwnerToken(await dockPaths()))
}

async function cloudConsumerConnection(paths) {
  const raw = fs.existsSync(paths.configPath) ? await fsp.readFile(paths.configPath, 'utf8') : defaultLocalConfig(paths)
  let config = {}
  try { config = YAML.parse(raw) || {} } catch {}
  const tokenPath = String(config.cloud_token_path || path.join(paths.dataDir, 'cloud-token.json')).trim()
  let token = {}
  try { token = JSON.parse(await fsp.readFile(tokenPath, 'utf8')) || {} } catch {}
  const cloudURL = String(config.cloud_url || token.cloudUrl || '').trim().replace(/\/$/, '')
  if (!cloudURL) throw new Error('Exora Cloud is not configured')
  return { cloudURL }
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
  const response = await fetchWithTimeout(`${String(cloudURL).replace(/\/$/, '')}${route}`, {
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
  const text = await response.text()
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
  const key = String(explicitKey || connection.token).trim()
  if (!key) throw new Error('Sign in to Exora Cloud before purchasing or invoking a product.')
  const { cloudURL } = connection
  const response = await fetchWithTimeout(`${cloudURL}${route}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    cache: 'no-store',
  }, 180000)
  const text = await response.text()
  let decoded = {}
  try { decoded = text.trim() ? JSON.parse(text) : {} } catch { decoded = { error: text } }
  if (!response.ok) {
    if (response.status === 401 && !explicitKey) await cloudAuth.unauthorized()
    throw new Error(`Exora Cloud returned ${response.status}: ${String(decoded?.error || text || response.statusText)}`)
  }
  return decoded
}

async function order_access_key_status(payload = {}) {
	const id = String(payload?.input?.activitySessionId || '').trim()
	if (!id) throw new Error('activitySessionId is required')
	return cloudAuth.apiRequest('GET', `/v3/activity-sessions/${encodeURIComponent(id)}/access-key`)
}

async function issueOrderAccessKey(payload = {}, rotate = false) {
	const input = payload.input || {}
	const id = String(input.activitySessionId || '').trim()
	const listingId = String(input.listingId || '').trim()
	if (!id || !listingId) throw new Error('activitySessionId and listingId are required')
	const suffix = rotate ? '/rotate' : ''
	const response = await cloudAuth.apiRequest('POST', `/v3/activity-sessions/${encodeURIComponent(id)}/access-key${suffix}`, { listingId, allowedActions: Array.isArray(input.allowedActions) ? input.allowedActions : [] })
	const token = String(response.token || '')
	if (token) {
		clipboard.writeText(token)
		setTimeout(() => { if (clipboard.readText() === token) clipboard.clear() }, 60_000)
	}
	delete response.token
	return { ...response, copied: Boolean(token) }
}

async function order_access_key_create(payload = {}) { return issueOrderAccessKey(payload, false) }
async function order_access_key_rotate(payload = {}) { return issueOrderAccessKey(payload, true) }
async function order_access_key_revoke(payload = {}) {
	const id = String(payload?.input?.activitySessionId || '').trim()
	if (!id) throw new Error('activitySessionId is required')
	return cloudAuth.apiRequest('DELETE', `/v3/activity-sessions/${encodeURIComponent(id)}/access-key`)
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
  const transferResponse = await fetchWithTimeout(String(response.transfer.url), { method: 'GET', headers, redirect: 'error', cache: 'no-store' }, 30 * 60 * 1000)
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
      const { done, value } = await reader.read()
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
function uint32Buffer(value) {
  const out = Buffer.alloc(4)
  out.writeUInt32BE(value, 0)
  return out
}

function ed25519OpenSSHPublicKey(publicKey) {
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  const type = Buffer.from('ssh-ed25519')
  const blob = Buffer.concat([uint32Buffer(type.length), type, uint32Buffer(raw.length), raw])
  return `ssh-ed25519 ${blob.toString('base64')} exora-dock`
}

async function consumer_purchase_compute(payload = {}) {
  const input = { ...(payload.input || {}) }
  let temporaryKeyPath = ''
  if (!String(input.sshPublicKey || '').trim()) {
    const paths = await dockPaths()
    const keyDirectory = path.join(paths.persistenceDir, 'lease-keys')
    await fsp.mkdir(keyDirectory, { recursive: true, mode: 0o700 })
    const keyID = crypto.randomUUID()
    temporaryKeyPath = path.join(keyDirectory, `${keyID}.key`)
    const pair = crypto.generateKeyPairSync('ed25519')
    input.sshPublicKey = ed25519OpenSSHPublicKey(pair.publicKey)
    await fsp.writeFile(temporaryKeyPath, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' })
  }
  try {
    const response = await cloudConsumerJson('POST', '/v3/compute-purchases', input)
    const leaseID = String(response?.lease?.leaseId || '').trim()
    if (temporaryKeyPath && leaseID) {
      const finalPath = path.join(path.dirname(temporaryKeyPath), `${leaseID}.key`)
      await fsp.rename(temporaryKeyPath, finalPath)
      response.lease = { ...response.lease, localSSHPrivateKeyPath: finalPath }
    }
    return response
  } catch (error) {
    if (temporaryKeyPath) await fsp.rm(temporaryKeyPath, { force: true })
    throw error
  }
}
async function consumer_compute_purchase(payload = {}) { return cloudConsumerJson('GET', `/v3/compute-purchases/${encodeURIComponent(String(payload?.input?.purchaseId || ''))}`) }
async function consumer_extend_compute(payload = {}) { const input = { ...(payload.input || {}) }; const purchaseId = String(input.purchaseId || ''); delete input.purchaseId; return cloudConsumerJson('POST', `/v3/compute-purchases/${encodeURIComponent(purchaseId)}/extend`, input) }
async function consumer_get_lease(payload = {}) { return cloudConsumerJson('GET', `/v3/leases/${encodeURIComponent(String(payload?.input?.leaseId || ''))}`) }
async function consumer_release_lease(payload = {}) {
  const leaseID = String(payload?.input?.leaseId || '')
  const response = await cloudConsumerJson('POST', `/v3/leases/${encodeURIComponent(leaseID)}/release`, {})
  const paths = await dockPaths()
  await fsp.rm(path.join(paths.persistenceDir, 'lease-keys', `${leaseID}.key`), { force: true })
  return response
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

async function timedBandwidthProbe(url, direction, durationMs, maxBytes, onProgress = () => undefined) {
  const samples = []
  let transferred = 0
  const startedAt = performance.now()
  const sizes = direction === 'download' ? [1 << 20, 8 << 20, 25 << 20, 50 << 20] : [512 << 10, 2 << 20, 4 << 20, 8 << 20]
  let index = 0
  while (performance.now() - startedAt < durationMs && transferred < maxBytes) {
    const bytes = Math.min(sizes[Math.min(index, sizes.length - 1)], maxBytes - transferred)
    if (bytes <= 0) break
    const sampleStartedAt = performance.now()
    const response = direction === 'download'
      ? await fetchWithTimeout(`${url}?bytes=${bytes}&cache=${Date.now()}-${index}`, { cache: 'no-store' }, 15000)
      : await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(bytes) }, 15000)
    if (!response.ok) throw new Error(`network ${direction} probe returned ${response.status}`)
    let actualBytes = bytes
    if (direction === 'download') actualBytes = (await response.arrayBuffer()).byteLength
    else await response.arrayBuffer()
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

async function measurePublicNetwork(onProgress = () => undefined) {
  const base = 'https://speed.cloudflare.com'
  const latencySamples = []
  let meta = {}
  onProgress('geolocation', 0)
  try {
    const metaResponse = await fetchWithTimeout(`${base}/meta`, { cache: 'no-store' }, 8000)
    if (metaResponse.ok) meta = objectOr(await metaResponse.json())
  } catch {}
  if (!(meta.clientIp || meta.clientIP) || !(meta.country || meta.city || meta.region)) {
    try {
      const geoResponse = await fetchWithTimeout('https://api.ip.sb/geoip', { cache: 'no-store', headers: { 'User-Agent': 'ExoraDock/0.1' } }, 8000)
      if (geoResponse.ok) meta = { ...meta, ...objectOr(await geoResponse.json()) }
    } catch {}
  }
  onProgress('latency', 0)
  for (let i = 0; i < 5; i += 1) {
    const startedAt = performance.now()
    const response = await fetchWithTimeout(`${base}/__down?bytes=0&cache=${Date.now()}-${i}`, { cache: 'no-store' }, 8000)
    if (!response.ok) throw new Error(`network latency probe returned ${response.status}`)
    await response.arrayBuffer()
    latencySamples.push(performance.now() - startedAt)
    onProgress('latency', (i + 1) / 5)
  }
  onProgress('download', 0)
  const download = await timedBandwidthProbe(`${base}/__down`, 'download', 4000, 400 << 20, (progress, detail) => onProgress('download', progress, detail))
  onProgress('upload', 0)
  const upload = await timedBandwidthProbe(`${base}/__up`, 'upload', 3000, 200 << 20, (progress, detail) => onProgress('upload', progress, detail))
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
  const emitProgress = (phase, percent, detail = {}) => mainWindow?.webContents.send('exora:v3-progress', { kind: 'host_scan', phase, percent: Math.max(0, Math.min(100, Math.round(percent))), ...detail })
  emitProgress('hardware', 4)
  const runtime = await v3Worker('probe_runtime')
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
  })
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
}

function bundledEnvironmentCatalog() {
  return [
    {
      imageId: 'ubuntu-24.04-cpu-v1', version: '1.0.0', status: 'catalog_preview', cloudAvailable: false,
      manifest: {
        schema: 'exora.environment_image.v3alpha1', name: 'Ubuntu 24.04', description: 'Official minimal Ubuntu environment for CPU workloads and custom software stacks.',
        architecture: 'amd64', runtimeBackends: ['wsl2'], os: { distribution: 'Ubuntu', version: '24.04 LTS' },
        components: ['Ubuntu 24.04 LTS', 'OpenSSH', 'Exora Guest Contract'], gpu: { required: false, vendor: 'none' },
        artifact: { format: 'wsl', sizeBytes: 850 * 1024 * 1024 },
      },
    },
    {
      imageId: 'ubuntu-24.04-cuda-12.8-toolkit-v1', version: '1.0.0', status: 'catalog_preview', cloudAvailable: false,
      manifest: {
        schema: 'exora.environment_image.v3alpha1', name: 'Ubuntu 24.04 + CUDA 12.8', description: 'Official GPU environment with the CUDA 12.8 userspace toolkit, ready for NVIDIA WSL GPU validation.',
        architecture: 'amd64', runtimeBackends: ['wsl2'], os: { distribution: 'Ubuntu', version: '24.04 LTS' },
        components: ['Ubuntu 24.04 LTS', 'CUDA Toolkit 12.8', 'OpenSSH', 'Exora Guest Contract'],
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
  return {
    rootPath,
    workspaceGiB: Math.max(20, Number(settings.workspaceGiB || 100)),
    freeBytes,
    imageCachePath: path.join(paths.rootDir, 'provider', 'images'),
    pricing: {
      baseFee: Math.max(0, Number(settings.pricing?.baseFee || 0)),
      baseFeeEnabled: settings.pricing?.baseFeeEnabled ?? Number(settings.pricing?.baseFee || 0) > 0,
      pricePerMinute: Math.max(0, Number(settings.pricing?.pricePerMinute || 0)),
      minimumMinutes: Math.max(1, Math.round(Number(settings.pricing?.minimumMinutes || 10))),
      longDiscountAfterMinutes: Math.max(1, Math.round(Number(settings.pricing?.longDiscountAfterMinutes || 60))),
      longDiscountPercent: Math.max(0, Math.min(90, Number(settings.pricing?.longDiscountPercent || 0))),
      longDiscountMinimumPricePercent: Math.max(1, Math.min(100, Number(settings.pricing?.longDiscountMinimumPricePercent || 50))),
      longDiscountEnabled: settings.pricing?.longDiscountEnabled ?? Number(settings.pricing?.longDiscountPercent || 0) > 0,
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
  const next = {
    version: 1,
    rootPath: String(input.rootPath ?? current.rootPath ?? '').trim(),
    workspaceGiB: Math.max(20, Math.round(Number(input.workspaceGiB ?? current.workspaceGiB ?? 100))),
    pricing: {
      baseFee: Math.max(0, Number(input.pricing?.baseFee ?? current.pricing?.baseFee ?? 0)),
      baseFeeEnabled: input.pricing?.baseFeeEnabled ?? current.pricing?.baseFeeEnabled ?? Number(input.pricing?.baseFee ?? current.pricing?.baseFee ?? 0) > 0,
      pricePerMinute: Math.max(0, Number(input.pricing?.pricePerMinute ?? current.pricing?.pricePerMinute ?? 0)),
      minimumMinutes: Math.max(1, Math.round(Number(input.pricing?.minimumMinutes ?? current.pricing?.minimumMinutes ?? 10))),
      longDiscountAfterMinutes: Math.max(1, Math.round(Number(input.pricing?.longDiscountAfterMinutes ?? current.pricing?.longDiscountAfterMinutes ?? 60))),
      longDiscountPercent: Math.max(0, Math.min(90, Number(input.pricing?.longDiscountPercent ?? current.pricing?.longDiscountPercent ?? 0))),
      longDiscountMinimumPricePercent: Math.max(1, Math.min(100, Number(input.pricing?.longDiscountMinimumPricePercent ?? current.pricing?.longDiscountMinimumPricePercent ?? 50))),
      longDiscountEnabled: input.pricing?.longDiscountEnabled ?? current.pricing?.longDiscountEnabled ?? Number(input.pricing?.longDiscountPercent ?? current.pricing?.longDiscountPercent ?? 0) > 0,
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
        const response = await fetch(url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal: controller.signal })
        if (!response.ok && response.status !== 206) throw new Error(`Environment image download failed with HTTP ${response.status}`)
        if (offset && response.status !== 206) {
          offset = 0
          await fsp.rm(partialPath, { force: true })
        }
        const handle = await fsp.open(partialPath, offset ? 'a' : 'w')
        try {
          for await (const chunk of response.body) {
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

async function provider_asset_choose_files() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] })
  if (result.canceled || !result.filePaths.length) return { canceled: true }
  const packaged = await createResourceArchive({
    filePaths: result.filePaths,
    tempRoot: resourceArchiveTempRoot(),
    maxBytes: MAX_RESOURCE_ARCHIVE_BYTES,
    onProgress: (progress) => mainWindow?.webContents.send('exora:v3-progress', { kind: 'asset_packaging', ...progress }),
  })
  const token = crypto.randomUUID()
  const archive = { ...packaged, token, kind: 'generated_zip' }
  await clearSelectedResourceArchives()
  v3SelectedArchives.set(token, archive)
  return {
    archive: {
      token,
      name: archive.archiveName,
      sizeBytes: archive.sizeBytes,
      sourceBytes: archive.sourceBytes,
      sourceCount: archive.sourceCount,
      format: archive.format,
      status: 'ready',
    },
    sources: archive.sources,
  }
}

async function provider_asset_clear_selection() {
  await clearSelectedResourceArchives()
  return { cleared: true }
}

async function provider_asset_create(payload = {}) {
  return httpJson('POST', '/v3/provider/asset-bundles', payload.input || {}, await localOwnerToken(await dockPaths()))
}

async function provider_asset_upload(payload = {}) {
  const input = payload.input || {}
  const fileToken = String(input.fileToken || '')
  const selectedArchive = v3SelectedArchives.get(fileToken)
  if (!selectedArchive) throw new Error('Generated ZIP token is unavailable. Choose the source files again.')
  const filePath = selectedArchive.archivePath
  const stat = await fsp.stat(filePath)
  validateResourceArchiveForUpload(selectedArchive, stat.size)
  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => { const stream = fs.createReadStream(filePath); stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject); stream.on('end', resolve) })
  const sha256 = hash.digest('hex')
  const started = await httpJson('POST', `/v3/provider/asset-bundles/${encodeURIComponent(String(input.bundleId))}/multipart`, { fileName: selectedArchive.archiveName, sizeBytes: stat.size, sha256, contentType: 'application/zip', archiveFormat: 'zip', sourceCount: selectedArchive.sourceCount }, await localOwnerToken(await dockPaths()))
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
  v3SelectedArchives.delete(fileToken)
  await cleanupResourceArchive(selectedArchive)
  return complete
}
async function provider_asset_cancel(payload = {}) {
  const id = String(payload?.input?.uploadSessionId || '')
  return httpJson('POST', `/v3/provider/uploads/${encodeURIComponent(id)}/abort`, {}, await localOwnerToken(await dockPaths()))
}

async function clearSelectedResourceArchives() {
  const archives = Array.from(v3SelectedArchives.values())
  v3SelectedArchives.clear()
  await Promise.all(archives.map((archive) => cleanupResourceArchive(archive).catch(() => undefined)))
}

const API_BRIDGE_MATERIAL_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'md', 'markdown', 'txt', 'csv'])
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
  try { return JSON.parse(await fsp.readFile(path.join(root, 'manifest.json'), 'utf8')) }
  catch { return { draftId, files: [] } }
}
async function writeAPIBridgeMaterialManifest(draftId, manifest) {
  const root = apiBridgeMaterialRoot(draftId)
  await fsp.mkdir(root, { recursive: true })
  await fsp.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
}
async function provider_api_bridge_materials_get(payload = {}) {
  return readAPIBridgeMaterialManifest(payload?.input?.draftId)
}
async function provider_api_bridge_materials_choose(payload = {}) {
  const draftId = String(payload?.input?.draftId || '')
  const current = await readAPIBridgeMaterialManifest(draftId)
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'API materials', extensions: Array.from(API_BRIDGE_MATERIAL_EXTENSIONS) }] })
  if (result.canceled) return { ...current, canceled: true }
  const candidates = []
  for (const sourcePath of result.filePaths) {
    const extension = path.extname(sourcePath).slice(1).toLowerCase()
    if (!API_BRIDGE_MATERIAL_EXTENSIONS.has(extension)) throw new Error(`Unsupported API material: ${path.basename(sourcePath)}`)
    const stat = await fsp.stat(sourcePath)
    if (!stat.isFile() || stat.size > API_BRIDGE_FILE_LIMIT) throw new Error(`${path.basename(sourcePath)} exceeds the 5 MiB file limit`)
    candidates.push({ sourcePath, name: path.basename(sourcePath), extension, sizeBytes: stat.size })
  }
  const byName = new Map((current.files || []).map(file => [String(file.name).toLowerCase(), file]))
  for (const candidate of candidates) byName.set(candidate.name.toLowerCase(), candidate)
  const combined = Array.from(byName.values())
  if (combined.length > API_BRIDGE_FILE_COUNT_LIMIT) throw new Error('An API material package can contain at most 20 files')
  if (combined.reduce((sum, file) => sum + Number(file.sizeBytes || 0), 0) > API_BRIDGE_PACKAGE_LIMIT) throw new Error('The API material package exceeds 20 MiB')
  const root = apiBridgeMaterialRoot(draftId); await fsp.mkdir(root, { recursive: true })
  const files = []
  for (const file of combined) {
    if (file.sourcePath) {
      const storedName = `${crypto.createHash('sha256').update(file.name.toLowerCase()).digest('hex').slice(0, 12)}-${file.name}`
      const storedPath = path.join(root, storedName); await fsp.copyFile(file.sourcePath, storedPath)
      files.push({ id: storedName, name: file.name, extension: file.extension, sizeBytes: file.sizeBytes, sha256: await sha256File(storedPath), localPath: storedPath })
    } else files.push(file)
  }
  let discovery = current.discovery
  for (const candidate of candidates) {
    if (!['json', 'yaml', 'yml'].includes(candidate.extension)) continue
    try {
      const document = await fsp.readFile(candidate.sourcePath, 'utf8'); let parsed
      try { parsed = JSON.parse(document) } catch { parsed = YAML.parse(document) }
      if (!parsed?.openapi || !parsed?.paths) continue
      const operations = []; const methods = new Set(['get','post','put','patch','delete','head','options'])
      for (const [routePath, pathItem] of Object.entries(parsed.paths)) for (const [method, operation] of Object.entries(pathItem || {})) {
        if (!methods.has(method.toLowerCase()) || !operation || typeof operation !== 'object') continue
        const operationId = String(operation.operationId || `${method}${String(routePath).replace(/[^a-zA-Z0-9]+(.)/g, (_, value) => String(value || '').toUpperCase())}`)
        operations.push({ operationId, method: method.toUpperCase(), path: routePath, displayName: String(operation.summary || operationId) })
        if (operations.length >= 200) break
      }
      discovery = { sourceFile: candidate.name, title: String(parsed.info?.title || ''), description: String(parsed.info?.description || ''), baseUrl: Array.isArray(parsed.servers) && typeof parsed.servers[0]?.url === 'string' && !parsed.servers[0].url.includes('{') ? parsed.servers[0].url : '', operations }
      break
    } catch { /* best-effort discovery; the material remains available to the Agent */ }
  }
  const manifest = { draftId, files, discovery, updatedAt: new Date().toISOString() }; await writeAPIBridgeMaterialManifest(draftId, manifest); return manifest
}
async function provider_api_bridge_material_remove(payload = {}) {
  const draftId = String(payload?.input?.draftId || ''); const id = String(payload?.input?.id || '')
  const manifest = await readAPIBridgeMaterialManifest(draftId); const target = (manifest.files || []).find(file => file.id === id)
  if (target?.localPath && path.dirname(path.resolve(target.localPath)) === path.resolve(apiBridgeMaterialRoot(draftId))) await fsp.rm(target.localPath, { force: true })
  manifest.files = (manifest.files || []).filter(file => file.id !== id); manifest.updatedAt = new Date().toISOString(); await writeAPIBridgeMaterialManifest(draftId, manifest); return manifest
}

async function provider_api_bridge_draft_get(payload = {}) {
  return httpJson('GET', `/v3/provider/api-bridge-drafts/${encodeURIComponent(String(payload?.input?.draftId || ''))}`, undefined, await localOwnerToken(await dockPaths()))
}
async function provider_api_bridge_draft_save(payload = {}) {
  return httpJson('POST', '/v3/provider/api-bridge-drafts', payload.input || {}, await localOwnerToken(await dockPaths()), { timeoutMs: 30000 })
}

async function provider_api_bridge_finalize(payload = {}) {
  const input = payload.input || {}
  if (!String(input.idempotencyKey || '').trim()) throw new Error('API Bridge finalize idempotencyKey is required')
  return httpJson('POST', '/v3/provider/api-bridge-imports', input, await localOwnerToken(await dockPaths()), { timeoutMs: 30000 })
}

function resourceArchiveTempRoot() {
  return path.join(app.getPath('temp'), 'exora-dock', 'resource-bundles')
}

async function provider_openapi_choose() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'OpenAPI', extensions: ['json', 'yaml', 'yml'] }] })
  if (result.canceled || !result.filePaths[0]) return { document: '' }
  const document = await fsp.readFile(result.filePaths[0], 'utf8')
  if (Buffer.byteLength(document) > 5 * 1024 * 1024) throw new Error('OpenAPI document exceeds 5 MiB')
  let parsed
  try { parsed = JSON.parse(document) } catch { parsed = YAML.parse(document) }
  if (!parsed || typeof parsed !== 'object' || !parsed.openapi) throw new Error('The selected file is not an OpenAPI 3.x document')
  const operations = []
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
  for (const [routePath, pathItem] of Object.entries(parsed.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method.toLowerCase()) || !operation || typeof operation !== 'object') continue
      const operationId = String(operation.operationId || `${method}${String(routePath).replace(/[^a-zA-Z0-9]+(.)/g, (_, character) => String(character || '').toUpperCase())}`)
      operations.push({ id: `${method.toLowerCase()}:${routePath}`, operationId, method: method.toUpperCase(), path: routePath, title: String(operation.summary || operationId), selected: true, price: 0 })
      if (operations.length > 200) throw new Error('OpenAPI operation limit exceeded')
    }
  }
  const serverURL = Array.isArray(parsed.servers) && typeof parsed.servers[0]?.url === 'string' && !parsed.servers[0].url.includes('{') ? parsed.servers[0].url : ''
  return { document, name: path.basename(result.filePaths[0]), title: String(parsed.info?.title || ''), description: String(parsed.info?.description || ''), baseUrl: serverURL, operations }
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
  if (input.authType === 'bearer' && secret) headers.Authorization = `Bearer ${secret}`
  if (input.authType === 'basic' && secret) headers.Authorization = `Basic ${Buffer.from(secret).toString('base64')}`
  if (input.authType === 'api_key' && secret) {
    const header = String(input.apiKeyHeader || 'X-API-Key').trim()
    if (!/^[A-Za-z0-9-]{1,64}$/.test(header)) throw new Error('API key header name is invalid')
    headers[header] = secret
  }
  const started = Date.now()
  let response = await fetchWithTimeout(target, { method: 'HEAD', headers, redirect: 'error', cache: 'no-store' }, 12000)
  if (response.status === 405 || response.status === 501) response = await fetchWithTimeout(target, { method: 'GET', headers, redirect: 'error', cache: 'no-store' }, 12000)
  const out = { ok: response.status >= 200 && response.status < 400, status: response.status, latencyMs: Date.now() - started, contentType: response.headers.get('content-type') || '', checkedURL: target.origin + target.pathname }
  if (!out.ok) out.error = `Provider returned HTTP ${response.status}`
  try { await response.body?.cancel() } catch {}
  return out
}
async function provider_openapi_import(payload = {}) {
  return httpJson('POST', '/v3/provider/api-imports', { ...(payload.input || {}) }, await localOwnerToken(await dockPaths()), { timeoutMs: 30000 })
}
async function provider_api_bridge_import(payload = {}) { return provider_openapi_import(payload) }
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
async function provider_endpoint_import(payload = {}) {
  return httpJson('POST', '/v3/provider/endpoint-imports', payload.input || {}, await localOwnerToken(await dockPaths()), { timeoutMs: 30000 })
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
