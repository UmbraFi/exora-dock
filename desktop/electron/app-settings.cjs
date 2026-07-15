const SETTINGS_VERSION = 3

const DEFAULT_NOTIFICATIONS = Object.freeze({
  approvals: true,
  purchases: true,
  downloads: true,
  leases: true,
  wallet: true,
  security: true,
  sellerOrders: true,
  sellerListings: true,
  runtime: true,
})

const SETTINGS_KEYS = Object.freeze([
  'language',
  'theme',
  'workOrderSide',
  'sidebarCollapsed',
  'sidebarWidth',
  'activityArchiveMarkers',
  'launchAtLogin',
  'startMinimized',
  'closeBehavior',
  'startDockOnLaunch',
  'autoUpdate',
  'downloadDirectory',
  'notifications',
])

function normalizeAppSettingsV3(value) {
  const input = objectOr(value)
  const notifications = objectOr(input.notifications)
  return {
    language: input.language === 'zh' ? 'zh' : 'en',
    theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system',
    workOrderSide: input.workOrderSide === 'seller' ? 'seller' : 'buyer',
    sidebarCollapsed: Boolean(input.sidebarCollapsed),
    sidebarWidth: clampInteger(input.sidebarWidth, 280, 236, 480),
    activityArchiveMarkers: Array.isArray(input.activityArchiveMarkers) ? input.activityArchiveMarkers.slice(-200) : [],
    launchAtLogin: input.launchAtLogin === true,
    startMinimized: input.startMinimized === true,
    closeBehavior: input.closeBehavior === 'quit' ? 'quit' : 'tray',
    startDockOnLaunch: input.startDockOnLaunch !== false,
    autoUpdate: input.autoUpdate !== false,
    downloadDirectory: typeof input.downloadDirectory === 'string' ? input.downloadDirectory.trim().slice(0, 4096) : '',
    notifications: Object.fromEntries(Object.entries(DEFAULT_NOTIFICATIONS).map(([key, fallback]) => [
      key,
      typeof notifications[key] === 'boolean' ? notifications[key] : fallback,
    ])),
  }
}

function pickAppSettingsV3(value) {
  const input = objectOr(value)
  return Object.fromEntries(SETTINGS_KEYS.filter((key) => Object.hasOwn(input, key)).map((key) => [key, input[key]]))
}

function redactDiagnostics(value) {
  if (Array.isArray(value)) return value.map(redactDiagnostics)
  if (!value || typeof value !== 'object') return value
  const secret = /(pin|token|secret|password|authorization|api.?key|access.?key|credential)/i
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => secret.test(key) ? [] : [[key, redactDiagnostics(item)]]))
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function objectOr(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

module.exports = {
  DEFAULT_NOTIFICATIONS,
  SETTINGS_KEYS,
  SETTINGS_VERSION,
  normalizeAppSettingsV3,
  pickAppSettingsV3,
  redactDiagnostics,
}
