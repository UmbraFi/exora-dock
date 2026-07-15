const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  LEGACY_FRONTEND_CLEANUP_MARKER,
  cleanupLegacyFrontendData,
} = require('./legacy-frontend-cleanup.cjs')

test('permanently removes only retired frontend data and preserves account and V3 state', async (t) => {
  const fixture = await createFixture(t)
  await cleanupLegacyFrontendData(fixture.options)

  await assert.rejects(fs.access(fixture.paths.legacyConversationsRoot))
  await assert.rejects(fs.access(fixture.paths.legacyTransactionsRoot))
  await assert.rejects(fs.access(fixture.paths.localAgentBindingPath))
  await assert.rejects(fs.access(fixture.paths.localAgentScanPath))
  await fs.access(fixture.userProjectFile)
  await fs.access(fixture.paths.providerEnvironmentSettingsPath)

  const settings = await readJson(fixture.paths.appSettingsPath, {})
  assert.equal(settings.version, 2)
  assert.deepEqual(settings.settings, {
    language: 'zh', theme: 'dark', workOrderSide: 'seller', sidebarCollapsed: true, sidebarWidth: 312,
  })
  const desktop = await readJson(fixture.paths.desktopStatePath, {})
  assert.equal(desktop.cloudAuth.account.email, 'user@example.com')
  assert.equal(desktop.accountKey.storageMode, 'safeStorage')
  assert.equal(desktop.providerEnvironmentRoot, 'D:/ExoraVMs')
  assert.ok(desktop.migrations[LEGACY_FRONTEND_CLEANUP_MARKER])
  for (const key of ['projectFolders', 'activeProjectFolderPath', 'workMcpUids', 'workMcpLeases']) {
    assert.equal(Object.hasOwn(desktop, key), false)
  }
})

test('is idempotent after the completion marker is written', async (t) => {
  const fixture = await createFixture(t)
  const first = await cleanupLegacyFrontendData(fixture.options)
  const second = await cleanupLegacyFrontendData(fixture.options)
  assert.equal(first.migrated, true)
  assert.deepEqual(second, { migrated: false, alreadyComplete: true })
})

test('does not write the completion marker when a removal fails', async (t) => {
  const fixture = await createFixture(t)
  let calls = 0
  await assert.rejects(cleanupLegacyFrontendData({
    ...fixture.options,
    remove: async (target, options) => {
      calls += 1
      if (calls === 2) throw new Error('locked legacy directory')
      await fs.rm(target, options)
    },
  }), /locked legacy directory/)
  const desktop = await readJson(fixture.paths.desktopStatePath, {})
  assert.equal(desktop.migrations?.[LEGACY_FRONTEND_CLEANUP_MARKER], undefined)

  const retry = await cleanupLegacyFrontendData(fixture.options)
  assert.equal(retry.migrated, true)
})

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'exora-legacy-cleanup-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const paths = {
    desktopStatePath: path.join(root, 'desktop-state.json'),
    appSettingsPath: path.join(root, 'exora-data', 'settings', 'settings.json'),
    localAgentBindingPath: path.join(root, 'exora-data', 'settings', 'local-agent-binding.json'),
    localAgentScanPath: path.join(root, 'exora-data', 'settings', 'local-agent-scan.json'),
    providerEnvironmentSettingsPath: path.join(root, 'exora-data', 'settings', 'provider-environment.json'),
    legacyConversationsRoot: path.join(root, 'exora-data', 'conversations'),
    legacyTransactionsRoot: path.join(root, 'exora-data', 'transactions'),
  }
  const userProjectFile = path.join(root, 'user-project', 'keep.txt')
  await Promise.all([
    writeText(path.join(paths.legacyConversationsRoot, 'tasks', 'chat.json'), 'legacy chat'),
    writeText(path.join(paths.legacyTransactionsRoot, 'transactions.json'), 'legacy transactions'),
    writeText(paths.localAgentBindingPath, '{}'),
    writeText(paths.localAgentScanPath, '{}'),
    writeText(paths.providerEnvironmentSettingsPath, '{"rootPath":"D:/ExoraVMs"}'),
    writeText(userProjectFile, 'user work'),
  ])
  await writeJson(paths.appSettingsPath, {
    version: 1,
    settings: {
      language: 'zh', theme: 'dark', workOrderSide: 'seller', sidebarCollapsed: true, sidebarWidth: 312,
      permissionMode: 'full', buyerAgentSettings: { enabled: true }, activeSettingsView: 'archives',
      marketOrderSide: 'buyer', transactionDetailWidth: 400, projectFolderCollapsed: true,
      expandedProjectFolderPaths: ['old'], seenProjectFolderPaths: ['old'], workTaskState: { pinnedIds: ['chat'] },
      gpuDemo: { active: true }, abandonedExperiment: true,
    },
  })
  await writeJson(paths.desktopStatePath, {
    cloudAuth: { account: { email: 'user@example.com' }, encryptedSession: 'keep' },
    accountKey: { storageMode: 'safeStorage' }, providerEnvironmentRoot: 'D:/ExoraVMs',
    projectFolders: ['old'], activeProjectFolderPath: 'old', workMcpUids: ['old'], workMcpLeases: ['old'],
  })
  return {
    paths,
    userProjectFile,
    options: { paths, readJson, writeJson, now: () => new Date('2026-07-15T00:00:00.000Z') },
  }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}

async function writeJson(file, value) {
  await writeText(file, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, value, 'utf8')
}
