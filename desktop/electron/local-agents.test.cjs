const assert = require('node:assert/strict')
const test = require('node:test')

const {
  LOCAL_AGENT_DRIVERS,
  cachedLocalAgentForBinding,
  createLocalAgentScanSnapshot,
  interpretAuthState,
  preferExecutableCandidates,
  restoreLocalAgentScanSnapshot,
  scanLocalAgents,
  windowsInstalledAppExecutablePaths,
} = require('./local-agents.cjs')

test('driver catalog has unique fixed identifiers and never accepts renderer commands', () => {
  const ids = LOCAL_AGENT_DRIVERS.map((driver) => driver.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const driver of LOCAL_AGENT_DRIVERS) {
    assert.match(driver.id, /^[a-z0-9-]+$/)
    assert.ok(driver.executableNames.length > 0 || driver.fixedPathTemplates?.length > 0 || driver.windowsDisplayNames?.length > 0)
    assert.equal(Object.hasOwn(driver, 'command'), false)
    assert.equal(Object.hasOwn(driver, 'env'), false)
  }
  const zcode = LOCAL_AGENT_DRIVERS.find((driver) => driver.id === 'zcode')
  assert.equal(zcode?.bindable, false)
  assert.equal(zcode?.versionArgs, null)
  assert.ok(zcode?.fixedPathTemplates.some((value) => /ZCode\.exe$/i.test(value)))
})

test('candidate ordering prefers a native executable over npm shims', () => {
  const candidates = preferExecutableCandidates([
    'C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd',
    'C:\\Program Files\\Codex\\codex.exe',
    'C:\\Users\\test\\AppData\\Roaming\\npm\\codex',
  ])
  assert.match(candidates[0], /codex\.exe$/i)
  assert.match(candidates[1], /codex\.cmd$/i)
})

test('auth parsing distinguishes authenticated, missing, configured, and unknown', () => {
  assert.equal(interpretAuthState('codex', { ok: true, stderr: 'Logged in using ChatGPT' }), 'authenticated')
  assert.equal(interpretAuthState('codex', { ok: false, stderr: 'Not logged in' }), 'not_authenticated')
  assert.equal(interpretAuthState('claude', { ok: true, stdout: '{"loggedIn":true}' }), 'authenticated')
  assert.equal(interpretAuthState('claude', { ok: false, stdout: '{"loggedIn":false}' }), 'not_authenticated')
  assert.equal(interpretAuthState('opencode', { ok: true, stdout: '2 credentials' }), 'configured')
  assert.equal(interpretAuthState('opencode', { ok: true, stdout: '0 credentials' }), 'not_authenticated')
  assert.equal(interpretAuthState('gemini', { ok: true, stdout: '' }), 'unknown')
})

test('Windows installed-app metadata resolves ZCode without launching it', () => {
  const paths = windowsInstalledAppExecutablePaths(`
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\zcode-id
    DisplayName    REG_SZ    ZCode 3.3.4
    UninstallString    REG_SZ    "C:\\Users\\test\\AppData\\Local\\Programs\\ZCode\\Uninstall ZCode.exe" /currentuser
    DisplayIcon    REG_SZ    C:\\Users\\test\\AppData\\Local\\Programs\\ZCode\\uninstallerIcon.ico
`, ['ZCode'])
  assert.deepEqual(paths, ['C:\\Users\\test\\AppData\\Local\\Programs\\ZCode\\ZCode.exe'])
})

test('scan returns catalog entries without starting unsupported agents', async () => {
  const probeCalls = []
  let zcodeFixedPaths = []
  const result = await scanLocalAgents({
    findExecutables: async (names, fixedPaths = []) => {
      if (names[0] === 'codex') return ['C:\\Tools\\codex.exe']
      if (fixedPaths.some((value) => /ZCode/i.test(value))) {
        zcodeFixedPaths = fixedPaths
        return ['C:\\Users\\test\\AppData\\Local\\Programs\\ZCode\\ZCode.exe']
      }
      return []
    },
    runProbe: async (executable, args) => {
      probeCalls.push({ executable, args: [...args] })
      if (args[0] === '--version') return { ok: true, stdout: 'codex-cli 1.2.3', stderr: '' }
      return { ok: true, stdout: '', stderr: 'Logged in using ChatGPT' }
    },
  })

  const codex = result.agents.find((agent) => agent.driverId === 'codex')
  const zcode = result.agents.find((agent) => agent.driverId === 'zcode')
  const antigravity = result.agents.find((agent) => agent.driverId === 'antigravity')
  assert.equal(codex?.status, 'ready')
  assert.equal(codex?.authState, 'authenticated')
  assert.equal(zcode?.status, 'detected_only')
  assert.equal(zcode?.bindable, false)
  assert.ok(zcodeFixedPaths.some((value) => /ZCode\.exe$/i.test(value)))
  assert.equal(antigravity?.status, 'not_installed')
  assert.deepEqual(probeCalls.map((call) => call.args), [['--version'], ['login', 'status']])

  const snapshot = createLocalAgentScanSnapshot(result)
  const restored = restoreLocalAgentScanSnapshot(JSON.parse(JSON.stringify(snapshot)))
  const probeCountBeforeSelection = probeCalls.length
  assert.equal(restored?.scannedAt, result.scannedAt)
  assert.equal(cachedLocalAgentForBinding(restored, 'codex')?.executablePath, 'C:\\Tools\\codex.exe')
  assert.equal(probeCalls.length, probeCountBeforeSelection)
})

test('saved scan rejects machine mismatch, duplicate drivers, and unsafe executable paths', async () => {
  const result = await scanLocalAgents({
    findExecutables: async (names) => names[0] === 'codex' ? ['C:\\Tools\\codex.exe'] : [],
    runProbe: async (_executable, args) => args[0] === '--version'
      ? { ok: true, stdout: 'codex-cli 1.2.3', stderr: '' }
      : { ok: true, stdout: '', stderr: 'Logged in using ChatGPT' },
  })
  const snapshot = createLocalAgentScanSnapshot(result)

  assert.equal(restoreLocalAgentScanSnapshot({ ...snapshot, platform: 'different-platform' }), undefined)
  assert.equal(restoreLocalAgentScanSnapshot({ ...snapshot, agents: [...snapshot.agents, snapshot.agents[0]] }), undefined)
  assert.equal(restoreLocalAgentScanSnapshot({
    ...snapshot,
    agents: snapshot.agents.map((agent) => agent.driverId === 'codex'
      ? { ...agent, executablePath: '..\\codex.exe', command: 'malicious', args: ['--dangerous'] }
      : agent),
  }), undefined)

  const withUnknownFields = restoreLocalAgentScanSnapshot({
    ...snapshot,
    command: 'malicious',
    agents: snapshot.agents.map((agent) => ({ ...agent, env: { TOKEN: 'secret' } })),
  })
  assert.ok(withUnknownFields)
  assert.equal(Object.hasOwn(withUnknownFields, 'command'), false)
  assert.equal(Object.hasOwn(withUnknownFields.agents[0], 'env'), false)
})
