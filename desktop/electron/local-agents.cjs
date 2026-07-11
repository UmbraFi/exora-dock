const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_PROBE_TIMEOUT_MS = 5000
const MAX_PROBE_OUTPUT_BYTES = 64 * 1024
const LOCAL_AGENT_SNAPSHOT_VERSION = 1
const LOCAL_AGENT_SNAPSHOT_LIMIT = 64
const LOCAL_AGENT_STATUSES = new Set(['ready', 'available', 'login_required', 'not_installed', 'probe_failed', 'detected_only'])
const LOCAL_AGENT_AUTH_STATES = new Set(['authenticated', 'not_authenticated', 'configured', 'unknown'])

const LOCAL_AGENT_DRIVERS = Object.freeze([
  Object.freeze({
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    executableNames: Object.freeze(['codex']),
    versionArgs: Object.freeze(['--version']),
    authProbe: Object.freeze({ kind: 'codex', args: Object.freeze(['login', 'status']) }),
    protocol: 'app-server',
    protocolState: 'supported',
    protocolLabel: 'App Server',
    capabilities: Object.freeze(['thread resume', 'streaming', 'approvals', 'MCP']),
    bindable: true,
  }),
  Object.freeze({
    id: 'claude-code',
    name: 'Claude Code',
    vendor: 'Anthropic',
    executableNames: Object.freeze(['claude']),
    versionArgs: Object.freeze(['--version']),
    authProbe: Object.freeze({ kind: 'claude', args: Object.freeze(['auth', 'status']) }),
    protocol: 'stream-json',
    protocolState: 'supported',
    protocolLabel: 'Stream JSON',
    capabilities: Object.freeze(['session resume', 'streaming', 'MCP approvals']),
    bindable: true,
  }),
  Object.freeze({
    id: 'opencode',
    name: 'OpenCode',
    vendor: 'SST',
    executableNames: Object.freeze(['opencode']),
    versionArgs: Object.freeze(['--version']),
    authProbe: Object.freeze({ kind: 'opencode', args: Object.freeze(['auth', 'list']) }),
    protocol: 'http-sse',
    protocolState: 'supported',
    protocolLabel: 'HTTP + SSE',
    capabilities: Object.freeze(['session resume', 'streaming', 'permissions', 'ACP']),
    bindable: true,
  }),
  Object.freeze({
    id: 'github-copilot',
    name: 'GitHub Copilot CLI',
    vendor: 'GitHub',
    executableNames: Object.freeze(['copilot']),
    versionArgs: Object.freeze(['--version']),
    protocol: 'copilot-sdk',
    protocolState: 'preview',
    protocolLabel: 'SDK / ACP Beta',
    capabilities: Object.freeze(['session resume', 'streaming', 'permissions']),
    bindable: true,
  }),
  Object.freeze({
    id: 'zcode',
    name: 'ZCode',
    vendor: 'Z.ai',
    executableNames: Object.freeze([]),
    windowsDisplayNames: Object.freeze(['ZCode']),
    fixedPathTemplates: Object.freeze([
      '%LOCALAPPDATA%\\Programs\\ZCode\\ZCode.exe',
      '%LOCALAPPDATA%\\ZCode\\ZCode.exe',
      '%PROGRAMFILES%\\ZCode\\ZCode.exe',
      '/Applications/ZCode.app/Contents/MacOS/ZCode',
      '%HOME%/Applications/ZCode.app/Contents/MacOS/ZCode',
      '/opt/ZCode/zcode',
      '/opt/zcode/zcode',
    ]),
    versionArgs: null,
    protocol: 'desktop-mcp-client',
    protocolState: 'unsupported',
    protocolLabel: 'Desktop app · MCP client',
    capabilities: Object.freeze(['MCP client', 'remote control']),
    note: 'No documented headless driver protocol yet',
    bindable: false,
  }),
  Object.freeze({
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    executableNames: Object.freeze(['gemini']),
    versionArgs: Object.freeze(['--version']),
    protocol: 'acp',
    protocolState: 'preview',
    protocolLabel: 'ACP Beta',
    capabilities: Object.freeze(['session resume', 'streaming', 'ACP']),
    note: 'Enterprise or user-managed API access',
    bindable: true,
  }),
  Object.freeze({
    id: 'cursor-agent',
    name: 'Cursor Agent',
    vendor: 'Cursor',
    executableNames: Object.freeze(['cursor-agent']),
    versionArgs: Object.freeze(['--version']),
    authProbe: Object.freeze({ kind: 'cursor', args: Object.freeze(['status']) }),
    protocol: 'stream-json-runner',
    protocolState: 'unsupported',
    protocolLabel: 'Detection only',
    capabilities: Object.freeze(['session resume', 'streaming']),
    note: 'Official Windows support is through WSL',
    bindable: false,
  }),
  Object.freeze({
    id: 'antigravity',
    name: 'Antigravity CLI',
    vendor: 'Google',
    executableNames: Object.freeze(['agy']),
    versionArgs: null,
    protocol: 'unavailable',
    protocolState: 'unsupported',
    protocolLabel: 'Detection only',
    capabilities: Object.freeze([]),
    note: 'No documented headless integration protocol yet',
    bindable: false,
  }),
])

const DRIVER_BY_ID = new Map(LOCAL_AGENT_DRIVERS.map((driver) => [driver.id, driver]))

function localAgentDriver(driverId) {
  return DRIVER_BY_ID.get(String(driverId || '').trim())
}

function publicDriver(driver) {
  return {
    driverId: driver.id,
    name: driver.name,
    vendor: driver.vendor,
    protocol: driver.protocol,
    protocolState: driver.protocolState,
    protocolLabel: driver.protocolLabel,
    capabilities: [...driver.capabilities],
    note: driver.note || '',
    bindable: driver.bindable,
  }
}

function createLocalAgentScanSnapshot(scanResult) {
  const scannedAt = validIso(scanResult?.scannedAt) || new Date().toISOString()
  const inputAgents = Array.isArray(scanResult?.agents) ? scanResult.agents : []
  if (inputAgents.length > LOCAL_AGENT_SNAPSHOT_LIMIT) throw new Error('Local agent scan returned too many entries.')
  const agents = inputAgents.map(normalizeCachedLocalAgent)
  if (agents.some((agent) => !agent) || new Set(agents.map((agent) => agent.driverId)).size !== agents.length) {
    throw new Error('Local agent scan returned an invalid catalog.')
  }
  return Object.freeze({
    version: LOCAL_AGENT_SNAPSHOT_VERSION,
    platform: process.platform,
    arch: process.arch,
    scannedAt,
    agents,
  })
}

function restoreLocalAgentScanSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (Number(value.version) !== LOCAL_AGENT_SNAPSHOT_VERSION) return undefined
  if (value.platform !== process.platform || value.arch !== process.arch) return undefined
  const scannedAt = validIso(value.scannedAt)
  if (!scannedAt || !Array.isArray(value.agents) || value.agents.length > LOCAL_AGENT_SNAPSHOT_LIMIT) return undefined
  const agents = value.agents.map(normalizeCachedLocalAgent)
  if (agents.some((agent) => !agent)) return undefined
  if (new Set(agents.map((agent) => agent.driverId)).size !== agents.length) return undefined
  return {
    version: LOCAL_AGENT_SNAPSHOT_VERSION,
    platform: process.platform,
    arch: process.arch,
    scannedAt,
    agents,
  }
}

function cachedLocalAgentForBinding(snapshot, driverId) {
  const normalized = restoreLocalAgentScanSnapshot(snapshot)
  if (!normalized) return undefined
  return normalized.agents.find((agent) => agent.driverId === String(driverId || '').trim())
}

function normalizeCachedLocalAgent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const driver = localAgentDriver(value.driverId)
  if (!driver) return undefined
  const installed = value.installed === true
  const executablePath = String(value.executablePath || '').trim()
  let status = LOCAL_AGENT_STATUSES.has(value.status) ? value.status : installed ? 'probe_failed' : 'not_installed'
  if (!installed) status = 'not_installed'
  if (installed && status === 'not_installed') return undefined
  if (installed && (!safeAbsoluteExecutablePath(executablePath) || !executablePathMatchesDriver(executablePath, driver))) return undefined
  const authState = LOCAL_AGENT_AUTH_STATES.has(value.authState) ? value.authState : 'unknown'
  return {
    ...publicDriver(driver),
    installed,
    status,
    authState,
    ...(installed ? { executablePath } : {}),
    ...(String(value.version || '').trim() ? { version: cleanProbeText(value.version) } : {}),
    ...(String(value.detail || '').trim() ? { detail: cleanProbeText(value.detail) } : {}),
  }
}

function safeAbsoluteExecutablePath(value) {
  const text = String(value || '')
  return !/[\u0000-\u001f\u007f]/.test(text) && (path.isAbsolute(text) || path.win32.isAbsolute(text))
}

function executablePathMatchesDriver(executablePath, driver) {
  const windowsPath = path.win32.isAbsolute(executablePath)
  const basename = (windowsPath ? path.win32.basename(executablePath) : path.basename(executablePath)).toLowerCase()
  const stem = basename.replace(/\.(?:exe|cmd|bat|appimage)$/i, '')
  const allowedStems = new Set(driver.executableNames.map((value) => String(value).toLowerCase().replace(/\.(?:exe|cmd|bat)$/i, '')))
  for (const template of driver.fixedPathTemplates || []) {
    const templateBase = path.win32.basename(String(template)).toLowerCase()
    allowedStems.add(templateBase.replace(/\.(?:exe|cmd|bat|appimage)$/i, ''))
    allowedStems.add(path.basename(String(template)).toLowerCase().replace(/\.(?:exe|cmd|bat|appimage)$/i, ''))
  }
  return allowedStems.has(stem)
}

function validIso(value) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

async function scanLocalAgents(options = {}) {
  const findExecutables = options.findExecutables || defaultFindExecutables
  const runProbe = options.runProbe || defaultRunProbe
  const onlyDriverId = String(options.onlyDriverId || '').trim()
  const drivers = onlyDriverId
    ? LOCAL_AGENT_DRIVERS.filter((driver) => driver.id === onlyDriverId)
    : LOCAL_AGENT_DRIVERS
  const agents = await Promise.all(drivers.map((driver) => scanDriver(driver, { findExecutables, runProbe })))
  return {
    agents,
    scannedAt: new Date().toISOString(),
  }
}

async function scanDriver(driver, dependencies) {
  const base = publicDriver(driver)
  let candidates
  try {
    candidates = await dependencies.findExecutables(
      driver.executableNames,
      driver.fixedPathTemplates || [],
      driver.windowsDisplayNames || [],
    )
  } catch {
    candidates = []
  }
  const executablePaths = preferExecutableCandidates(candidates)
  if (!executablePaths.length) {
    return {
      ...base,
      installed: false,
      status: 'not_installed',
      authState: 'unknown',
    }
  }

  if (!driver.versionArgs) {
    return {
      ...base,
      installed: true,
      status: 'detected_only',
      authState: 'unknown',
      executablePath: executablePaths[0],
    }
  }

  let executablePath = executablePaths[0]
  let versionResult
  for (const candidate of executablePaths) {
    const result = await dependencies.runProbe(candidate, driver.versionArgs)
    if (result.ok) {
      executablePath = candidate
      versionResult = result
      break
    }
    if (!versionResult) versionResult = result
  }

  if (!versionResult?.ok) {
    return {
      ...base,
      installed: true,
      status: 'probe_failed',
      authState: 'unknown',
      executablePath,
      detail: probeFailureDetail(versionResult),
    }
  }

  const version = cleanProbeText(versionResult.stdout || versionResult.stderr)
  let authState = 'unknown'
  if (driver.authProbe) {
    const authResult = await dependencies.runProbe(executablePath, driver.authProbe.args)
    authState = interpretAuthState(driver.authProbe.kind, authResult)
  }

  const status = !driver.bindable
    ? 'detected_only'
    : authState === 'not_authenticated'
      ? 'login_required'
      : authState === 'authenticated'
        ? 'ready'
        : 'available'

  return {
    ...base,
    installed: true,
    status,
    authState,
    executablePath,
    version,
  }
}

function interpretAuthState(kind, result = {}) {
  const combined = cleanProbeText(`${result.stdout || ''}\n${result.stderr || ''}`, 4096)
  if (kind === 'claude') {
    const json = firstJsonObject(combined)
    if (json && typeof json.loggedIn === 'boolean') {
      return json.loggedIn ? 'authenticated' : 'not_authenticated'
    }
  }
  if (kind === 'opencode') {
    if (/\b0\s+credentials?\b/i.test(combined) || /no\s+(?:stored\s+)?credentials?/i.test(combined)) {
      return 'not_authenticated'
    }
    if (/\b[1-9]\d*\s+credentials?\b/i.test(combined)) return 'configured'
    return result.ok && combined ? 'configured' : 'unknown'
  }
  if (/\bnot\s+(?:logged|signed)\s+in\b/i.test(combined) || /\blogin\s+required\b/i.test(combined)) {
    return 'not_authenticated'
  }
  if (/\b(?:logged|signed)\s+in\b/i.test(combined) || /\bauthenticated\b/i.test(combined)) {
    return 'authenticated'
  }
  if ((kind === 'codex' || kind === 'cursor') && result.ok) return 'authenticated'
  return 'unknown'
}

function firstJsonObject(value) {
  const text = String(value || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function cleanProbeText(value, limit = 160) {
  return String(value || '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function probeFailureDetail(result) {
  if (!result) return 'Executable could not be checked.'
  if (result.timedOut) return 'Version check timed out.'
  return 'Version check failed.'
}

function preferExecutableCandidates(values) {
  const seen = new Set()
  return [...(values || [])]
    .map((value) => path.resolve(String(value || '').trim()))
    .filter((value) => {
      if (!value || value === path.resolve('.')) return false
      const key = process.platform === 'win32' ? value.toLowerCase() : value
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => executableRank(left) - executableRank(right))
}

function executableRank(value) {
  const extension = path.extname(value).toLowerCase()
  if (extension === '.exe') return 0
  if (extension === '.cmd') return 1
  if (extension === '.bat') return 2
  return 3
}

async function defaultFindExecutables(executableNames, fixedPathTemplates = [], windowsDisplayNames = []) {
  const results = []
  for (const executableName of executableNames) {
    const lookup = process.platform === 'win32'
      ? await runNativeExecutable('where.exe', [executableName], { timeout: 2500 })
      : await runNativeExecutable('which', ['-a', executableName], { timeout: 2500 })
    if (!lookup.ok) continue
    for (const line of String(lookup.stdout || '').split(/\r?\n/)) {
      const candidate = line.trim()
      if (!candidate || !path.isAbsolute(candidate)) continue
      if (fs.existsSync(candidate)) results.push(candidate)
    }
  }
  for (const template of fixedPathTemplates) {
    const candidate = expandKnownInstallPath(template)
    if (candidate && path.isAbsolute(candidate) && fs.existsSync(candidate)) results.push(candidate)
  }
  if (process.platform === 'win32' && windowsDisplayNames.length && !results.length) {
    results.push(...await findWindowsInstalledAppExecutables(windowsDisplayNames))
  }
  return preferExecutableCandidates(results)
}

async function findWindowsInstalledAppExecutables(displayNames) {
  const roots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]
  const results = []
  for (const root of roots) {
    for (const displayName of displayNames) {
      const query = await runNativeExecutable(
        'reg.exe',
        ['query', root, '/s', '/f', displayName, '/d'],
        { timeout: 4000, maxBuffer: 512 * 1024 },
      )
      results.push(...windowsInstalledAppExecutablePaths(`${query.stdout}\n${query.stderr}`, displayNames))
    }
  }
  return preferExecutableCandidates(results.filter((candidate) => fs.existsSync(candidate)))
}

function windowsInstalledAppExecutablePaths(output, displayNames) {
  const expectedNames = displayNames.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
  const blocks = String(output || '').split(/(?=^HKEY_(?:CURRENT_USER|LOCAL_MACHINE)\\)/gim)
  const results = []
  for (const block of blocks) {
    const values = registryValueMap(block)
    const displayName = String(values.displayname || '').trim().toLowerCase()
    if (!expectedNames.some((expected) => displayName === expected || displayName.startsWith(`${expected} `))) continue

    const displayIcon = executableFromDisplayIcon(values.displayicon)
    if (displayIcon) results.push(displayIcon)
    const installLocation = expandWindowsEnvironmentVariables(values.installlocation)
    if (installLocation) results.push(path.join(installLocation, 'ZCode.exe'))
    const uninstallExecutable = executableFromCommandLine(values.uninstallstring)
    if (uninstallExecutable) results.push(path.join(path.dirname(uninstallExecutable), 'ZCode.exe'))
  }
  return preferExecutableCandidates(results)
}

function registryValueMap(block) {
  const values = {}
  for (const line of String(block || '').split(/\r?\n/)) {
    const match = line.match(/^\s+([^\s]+)\s+REG_[A-Z0-9_]+\s+(.*)$/i)
    if (!match) continue
    values[match[1].toLowerCase()] = match[2].trim()
  }
  return values
}

function executableFromDisplayIcon(value) {
  const withoutIndex = String(value || '').trim().replace(/,\s*-?\d+\s*$/, '')
  const candidate = expandWindowsEnvironmentVariables(withoutIndex.replace(/^"(.*)"$/, '$1'))
  return /\.exe$/i.test(candidate) ? candidate : ''
}

function executableFromCommandLine(value) {
  const text = expandWindowsEnvironmentVariables(value)
  if (!text) return ''
  const quoted = text.match(/^"([^"]+\.exe)"/i)
  if (quoted) return quoted[1]
  const plain = text.match(/^(.+?\.exe)(?:\s|$)/i)
  return plain ? plain[1].trim() : ''
}

function expandWindowsEnvironmentVariables(value) {
  return String(value || '').replace(/%([^%]+)%/g, (_match, name) => {
    const key = Object.keys(process.env).find((candidate) => candidate.toLowerCase() === String(name).toLowerCase())
    return key ? process.env[key] || '' : ''
  }).trim()
}

function expandKnownInstallPath(template) {
  let missingEnvironmentValue = false
  const expanded = String(template || '').replace(/%([a-zA-Z0-9_]+)%/g, (_match, name) => {
    const key = Object.keys(process.env).find((candidate) => candidate.toLowerCase() === String(name).toLowerCase())
    const value = key ? process.env[key] : ''
    if (!value) missingEnvironmentValue = true
    return value || ''
  })
  if (missingEnvironmentValue || !expanded.trim()) return ''
  return path.resolve(expanded)
}

async function defaultRunProbe(executablePath, args) {
  const executable = path.resolve(String(executablePath || '').trim())
  if (!path.isAbsolute(executable) || !fs.existsSync(executable)) {
    return { ok: false, stdout: '', stderr: '', code: null, timedOut: false }
  }
  const extension = path.extname(executable).toLowerCase()
  if (process.platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    return runWindowsShim(executable, args)
  }
  return runNativeExecutable(executable, args)
}

function runWindowsShim(executable, args) {
  if (!safeWindowsShimPath(executable) || !args.every(safeWindowsShimArg)) {
    return Promise.resolve({ ok: false, stdout: '', stderr: '', code: null, timedOut: false })
  }
  const comspec = process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe'
  const command = `"${executable}"${args.length ? ` ${args.join(' ')}` : ''}`
  return runNativeExecutable(comspec, ['/d', '/s', '/c', command], { windowsVerbatimArguments: true })
}

function safeWindowsShimPath(value) {
  return !/["&|<>^%!\r\n]/.test(String(value || ''))
}

function safeWindowsShimArg(value) {
  return /^[a-zA-Z0-9._:/=+-]+$/.test(String(value || ''))
}

function runNativeExecutable(program, args, options = {}) {
  return new Promise((resolve) => {
    const finish = (error, stdout = '', stderr = '') => {
      resolve({
        ok: !error,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        code: typeof error?.code === 'number' ? error.code : null,
        timedOut: Boolean(error?.killed),
      })
    }
    try {
      execFile(program, args, {
        encoding: 'utf8',
        maxBuffer: options.maxBuffer || MAX_PROBE_OUTPUT_BYTES,
        timeout: options.timeout || DEFAULT_PROBE_TIMEOUT_MS,
        windowsVerbatimArguments: Boolean(options.windowsVerbatimArguments),
        windowsHide: true,
      }, finish)
    } catch (error) {
      finish(error)
    }
  })
}

module.exports = {
  LOCAL_AGENT_DRIVERS,
  cachedLocalAgentForBinding,
  cleanProbeText,
  createLocalAgentScanSnapshot,
  defaultFindExecutables,
  defaultRunProbe,
  expandKnownInstallPath,
  windowsInstalledAppExecutablePaths,
  interpretAuthState,
  localAgentDriver,
  preferExecutableCandidates,
  publicDriver,
  restoreLocalAgentScanSnapshot,
  scanLocalAgents,
}
