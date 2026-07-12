const assert = require('node:assert/strict')
const test = require('node:test')

const {
  LOCAL_AGENT_DRIVERS,
  cachedLocalAgentForBinding,
  createLocalAgentScanSnapshot,
  interpretAuthState,
  installationIdFor,
  journalCursorsEqual,
  queryWindowsJournalCursors,
  preferExecutableCandidates,
  restoreLocalAgentScanSnapshot,
  scanLocalAgents,
  scanLocalAgentsGlobal,
  verifyLocalAgentInstallation,
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

test('scan returns every discovered installation without executing candidates', async () => {
  const probeCalls = []
  let zcodeFixedPaths = []
  const result = await scanLocalAgents({
    findExecutables: async (names, fixedPaths = []) => {
      if (names[0] === 'codex') return ['C:\\Tools\\codex.exe', 'C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd']
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

  const codexInstallations = result.agents.filter((agent) => agent.driverId === 'codex')
  const codex = codexInstallations[0]
  const zcode = result.agents.find((agent) => agent.driverId === 'zcode')
  assert.equal(codexInstallations.length, 2)
  assert.equal(codex?.status, 'discovered')
  assert.equal(codex?.authState, 'unknown')
  assert.equal(zcode?.status, 'detected_only')
  assert.equal(zcode?.bindable, false)
  assert.ok(zcodeFixedPaths.some((value) => /ZCode\.exe$/i.test(value)))
  assert.deepEqual(probeCalls, [])

  const snapshot = createLocalAgentScanSnapshot(result)
  const restored = restoreLocalAgentScanSnapshot(JSON.parse(JSON.stringify(snapshot)))
  const probeCountBeforeSelection = probeCalls.length
  assert.equal(restored?.scannedAt, result.scannedAt)
  assert.equal(cachedLocalAgentForBinding(restored, codex.installationId)?.executablePath, codex.executablePath)
  assert.equal(probeCalls.length, probeCountBeforeSelection)

  const verified = await verifyLocalAgentInstallation(codex, {
    fileExists: () => true,
    fileFingerprint: () => codex.fingerprint,
    runProbe: async (_executable, args) => args[0] === '--version'
      ? { ok: true, stdout: 'codex-cli 1.2.3' }
      : { ok: true, stderr: 'Logged in using ChatGPT' },
  })
  assert.equal(verified.status, 'ready')
  assert.equal(verified.verificationState, 'verified')
})

test('saved scan rejects machine mismatch, duplicate installations, and unsafe executable paths', async () => {
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

test('installation identity distinguishes two runtimes of the same driver', () => {
  const desktop = installationIdFor('codex', 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_x\\resources\\codex.exe')
  const npm = installationIdFor('codex', 'C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd')
  assert.notEqual(desktop, npm)
})

test('background index discovers matching executables without probing them', async () => {
  const directory = (name) => ({ name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false })
  const file = (name) => ({ name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false })
  const tree = new Map([
    ['C:\\', [directory('Tools'), directory('Windows')]],
    ['C:\\Tools', [file('codex.exe'), file('claudecode.exe')]],
    ['C:\\Windows', [directory('WinSxS')]],
  ])
  const result = await scanLocalAgentsGlobal({
    platform: 'win32',
    volumes: ['C:\\'],
    readDirectory: async (value) => tree.get(value) || [],
  })
  assert.deepEqual(result.agents.map((agent) => agent.driverId).sort(), ['claude-code', 'codex'])
})

test('background index ignores project copies and nested npm package binaries', async () => {
  const directory = (name) => ({ name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false })
  const file = (name) => ({ name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false })
  const tree = new Map([
    ['C:\\', [directory('Users')]],
    ['C:\\Users', [directory('malou')]],
    ['C:\\Users\\malou', [directory('Documents'), directory('AppData')]],
    ['C:\\Users\\malou\\Documents', [directory('project')]],
    ['C:\\Users\\malou\\Documents\\project', [directory('work'), file('codex.exe')]],
    ['C:\\Users\\malou\\Documents\\project\\work', [file('codex.exe')]],
    ['C:\\Users\\malou\\AppData', [directory('Roaming')]],
    ['C:\\Users\\malou\\AppData\\Roaming', [directory('npm')]],
    ['C:\\Users\\malou\\AppData\\Roaming\\npm', [file('codex.cmd'), directory('node_modules')]],
    ['C:\\Users\\malou\\AppData\\Roaming\\npm\\node_modules', [directory('@openai')]],
    ['C:\\Users\\malou\\AppData\\Roaming\\npm\\node_modules\\@openai', [directory('codex')]],
    ['C:\\Users\\malou\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex', [file('codex.exe')]],
  ])
  const result = await scanLocalAgentsGlobal({ platform: 'win32', volumes: ['C:\\'], readDirectory: async (value) => tree.get(value) || [] })
  assert.deepEqual(result.agents.map((agent) => agent.executablePath), ['C:\\Users\\malou\\AppData\\Roaming\\npm\\codex.cmd'])
})

test('background index hides Codex Desktop managed runtimes', async () => {
  const directory = (name) => ({ name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false })
  const file = (name) => ({ name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false })
  const tree = new Map([
    ['C:\\', [directory('Users')]],
    ['C:\\Users', [directory('malou')]],
    ['C:\\Users\\malou', [directory('AppData')]],
    ['C:\\Users\\malou\\AppData', [directory('Local')]],
    ['C:\\Users\\malou\\AppData\\Local', [directory('OpenAI')]],
    ['C:\\Users\\malou\\AppData\\Local\\OpenAI', [directory('Codex')]],
    ['C:\\Users\\malou\\AppData\\Local\\OpenAI\\Codex', [directory('bin')]],
    ['C:\\Users\\malou\\AppData\\Local\\OpenAI\\Codex\\bin', [file('codex.exe'), directory('runtime-id')]],
    ['C:\\Users\\malou\\AppData\\Local\\OpenAI\\Codex\\bin\\runtime-id', [file('codex.exe')]],
  ])
  const result = await scanLocalAgentsGlobal({ platform: 'win32', volumes: ['C:\\'], readDirectory: async (value) => tree.get(value) || [] })
  assert.deepEqual(result.agents, [])
})

test('USN cursor comparison enables unchanged-index fast path', () => {
  const cursor = { 'C:\\': { journalId: '0x01ab', nextUsn: '0x0200' } }
  assert.equal(journalCursorsEqual(cursor, { ...cursor }), true)
  assert.equal(journalCursorsEqual(cursor, { 'C:\\': { journalId: '0x01ab', nextUsn: '0x0201' } }), false)
  assert.equal(journalCursorsEqual({}, {}), false)
})

test('USN journal parsing is independent of Windows display language', async () => {
  const cursors = await queryWindowsJournalCursors(['C:\\'], async () => ({
    ok: true,
    stdout: '鏃ュ織: 0x01ab\r\n棣栦釜: 0x0100\r\n涓嬩竴涓�: 0x0200\r\n',
  }))
  assert.deepEqual(cursors, { 'C:\\': { journalId: '0x01ab', nextUsn: '0x0200' } })
})
