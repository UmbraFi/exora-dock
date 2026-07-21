const assert = require('node:assert/strict')
const test = require('node:test')
const { DEFAULT_NOTIFICATIONS, normalizeAppSettingsV3, pickAppSettingsV3 } = require('./app-settings.cjs')

test('migrates V2 preferences into safe V3 defaults without losing established choices', () => {
  const settings = normalizeAppSettingsV3({
    language: 'zh', theme: 'dark', workOrderSide: 'seller', sidebarCollapsed: true, sidebarWidth: 312,
    activityArchiveMarkers: [{ id: 'archive-1' }],
  })
  assert.equal(settings.language, 'zh')
  assert.equal(settings.theme, 'dark')
  assert.equal(settings.workOrderSide, 'seller')
  assert.equal(settings.sidebarCollapsed, true)
  assert.equal(settings.sidebarWidth, 312)
  assert.deepEqual(settings.activityArchiveMarkers, [{ id: 'archive-1' }])
  assert.equal(settings.closeBehavior, 'tray')
  assert.equal(Object.hasOwn(settings, 'startDockOnLaunch'), false)
  assert.equal(Object.hasOwn(settings, 'autoUpdate'), false)
  assert.equal(settings.agentMcpOnboardingVersion, 0)
  assert.deepEqual(settings.notifications, DEFAULT_NOTIFICATIONS)
})

test('normalizes V3 values and drops unapproved or secret-shaped fields', () => {
  const picked = pickAppSettingsV3({
    language: 'en', theme: 'system', closeBehavior: 'quit', startDockOnLaunch: false, token: 'secret', paymentPIN: '123456', arbitrary: true,
  })
  assert.deepEqual(picked, { language: 'en', theme: 'system', closeBehavior: 'quit' })

  const settings = normalizeAppSettingsV3({
    ...picked, sidebarWidth: 9999, autoUpdate: false,
    notifications: { approvals: false, apiActivity: false, invented: true },
  })
  assert.equal(settings.sidebarWidth, 480)
  assert.equal(Object.hasOwn(settings, 'startDockOnLaunch'), false)
  assert.equal(Object.hasOwn(settings, 'autoUpdate'), false)
  assert.equal(settings.notifications.approvals, false)
  assert.equal(settings.notifications.apiActivity, false)
  assert.equal(Object.hasOwn(settings.notifications, 'invented'), false)
})

test('migrates retired commerce and seller notification categories into the API-only model', () => {
  const settings = normalizeAppSettingsV3({
    notifications: { approvals: false, purchases: true, wallet: false, sellerOrders: true, sellerListings: false, runtime: false },
  })
  assert.deepEqual(settings.notifications, {
    approvals: false,
    apiActivity: true,
    billing: false,
    providerApis: false,
    security: true,
  })
})
