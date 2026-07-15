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
  assert.equal(settings.startDockOnLaunch, true)
  assert.equal(settings.autoUpdate, true)
  assert.deepEqual(settings.notifications, DEFAULT_NOTIFICATIONS)
})

test('normalizes V3 values and drops unapproved or secret-shaped fields', () => {
  const picked = pickAppSettingsV3({
    language: 'en', theme: 'system', closeBehavior: 'quit', token: 'secret', paymentPIN: '123456', arbitrary: true,
  })
  assert.deepEqual(picked, { language: 'en', theme: 'system', closeBehavior: 'quit' })

  const settings = normalizeAppSettingsV3({
    ...picked, sidebarWidth: 9999, startDockOnLaunch: false, autoUpdate: false,
    notifications: { approvals: false, runtime: false, invented: true },
  })
  assert.equal(settings.sidebarWidth, 480)
  assert.equal(settings.startDockOnLaunch, false)
  assert.equal(settings.autoUpdate, false)
  assert.equal(settings.notifications.approvals, false)
  assert.equal(settings.notifications.runtime, false)
  assert.equal(Object.hasOwn(settings.notifications, 'invented'), false)
})
