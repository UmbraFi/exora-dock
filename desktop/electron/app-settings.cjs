const SETTINGS_VERSION = 6

const DEFAULT_NOTIFICATIONS = Object.freeze({
  approvals: true,
  apiActivity: true,
  billing: true,
  providerApis: true,
  security: true,
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
  'downloadDirectory',
  'agentMcpOnboardingVersion',
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
    downloadDirectory: typeof input.downloadDirectory === 'string' ? input.downloadDirectory.trim().slice(0, 4096) : '',
    agentMcpOnboardingVersion: clampInteger(input.agentMcpOnboardingVersion, 0, 0, 1000),
    notifications: normalizeNotifications(notifications),
  }
}

function normalizeNotifications(notifications) {
  const normalized = Object.fromEntries(Object.entries(DEFAULT_NOTIFICATIONS).map(([key, fallback]) => [
    key,
    typeof notifications[key] === 'boolean' ? notifications[key] : fallback,
  ]))
  if (typeof notifications.apiActivity !== 'boolean' && typeof notifications.purchases === 'boolean') {
    normalized.apiActivity = notifications.purchases
  }
  if (typeof notifications.billing !== 'boolean') {
    const legacyBilling = [notifications.purchases, notifications.wallet].filter((item) => typeof item === 'boolean')
    if (legacyBilling.length) normalized.billing = legacyBilling.every(Boolean)
  }
  if (typeof notifications.providerApis !== 'boolean') {
    const legacyProvider = [notifications.sellerOrders, notifications.sellerListings].filter((item) => typeof item === 'boolean')
    if (legacyProvider.length) normalized.providerApis = legacyProvider.every(Boolean)
  }
  return normalized
}

function pickAppSettingsV3(value) {
  const input = objectOr(value)
  return Object.fromEntries(SETTINGS_KEYS.filter((key) => Object.hasOwn(input, key)).map((key) => [key, input[key]]))
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
}
