const { execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const DEFAULT_PROBE_TIMEOUT_MS = 5000
const MAX_PROBE_OUTPUT_BYTES = 64 * 1024
const LOCAL_AGENT_SNAPSHOT_VERSION = 2
const LOCAL_AGENT_SNAPSHOT_LIMIT = 512
const LOCAL_AGENT_STATUSES = new Set(['discovered', 'ready', 'available', 'login_required', 'probe_failed', 'detected_only'])
const LOCAL_AGENT_AUTH_STATES = new Set(['authenticated', 'not_authenticated', 'configured', 'unknown'])

const LOCAL_AGENT_DRIVERS = Object.freeze([
  Object.freeze({
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    executableNames: Object.freeze(['codex']),
    npmPackages: Object.freeze(['@openai/codex']),
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
    executableNames: Object.freeze(['claude', 'claude-code', 'claudecode']),
    npmPackages: Object.freeze(['@anthropic-ai/claude-code']),
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
    npmPackages: Object.freeze(['opencode-ai', 'opencode']),
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
    npmPackages: Object.freeze(['@github/copilot']),
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
    npmPackages: Object.freeze(['@google/gemini-cli']),
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
  if (agents.some((agent) => !agent) || new Set(agents.map((agent) => agent.installationId)).size !== agents.length) {
    throw new Error('Local agent scan returned an invalid catalog.')
  }
  return Object.freeze({
    version: LOCAL_AGENT_SNAPSHOT_VERSION,
    platform: process.platform,
    arch: process.arch,
    scannedAt,
    agents,
    index: normalizeIndexMetadata(scanResult?.index),
  })
}

function restoreLocalAgentScanSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (Number(value.version) !== LOCAL_AGENT_SNAPSHOT_VERSION) return undefined
  if (value.platform !== process.platform || value.arch !== process.arch) return undefined
  const scannedAt = validIso(value.scannedAt)
  if (!scannedAt || !Array.isArray(value.agents) || value.agents.length > LOCAL_AGENT_SNAPSHOT_LIMIT) return undefined
  const normalizedAgents = value.agents.filter((agent) => !isKnownDiscoveryNoise(String(agent?.executablePath || ''))).map(normalizeCachedLocalAgent)
  if (normalizedAgents.some((agent) => !agent)) return undefined
  if (new Set(normalizedAgents.map((agent) => agent.installationId)).size !== normalizedAgents.length) return undefined
  const agents = collapseRuntimeDuplicates(normalizedAgents)
  if (new Set(agents.map((agent) => agent.installationId)).size !== agents.length) return undefined
  return {
    version: LOCAL_AGENT_SNAPSHOT_VERSION,
    platform: process.platform,
    arch: process.arch,
    scannedAt,
    agents,
    index: normalizeIndexMetadata(value.index),
  }
}

function normalizeIndexMetadata(value) {
  const cursors = {}
  for (const [volume, cursor] of Object.entries(value?.journalCursors || {})) {
    if (!/^[A-Za-z]:\\$/.test(volume) || !cursor || typeof cursor !== 'object') continue
    const journalId = String(cursor.journalId || '').trim()
    const nextUsn = String(cursor.nextUsn || '').trim()
    if (/^0x[0-9a-f]+$/i.test(journalId) && /^0x[0-9a-f]+$/i.test(nextUsn)) cursors[volume.toUpperCase()] = { journalId, nextUsn }
  }
  return { backend: Object.keys(cursors).length ? 'ntfs-usn' : 'full-scan-fallback', journalCursors: cursors }
}

function cachedLocalAgentForBinding(snapshot, installationId) {
  const normalized = restoreLocalAgentScanSnapshot(snapshot)
  if (!normalized) return undefined
  return normalized.agents.find((agent) => agent.installationId === String(installationId || '').trim())
}

function normalizeCachedLocalAgent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const driver = localAgentDriver(value.driverId)
  if (!driver) return undefined
  const executablePath = String(value.executablePath || '').trim()
  if (!safeAbsoluteExecutablePath(executablePath) || !executablePathMatchesDriver(executablePath, driver)) return undefined
  const installationId = String(value.installationId || '').trim()
  if (!/^agent-installation-[a-f0-9]{32}$/.test(installationId)) return undefined
  const status = LOCAL_AGENT_STATUSES.has(value.status) ? value.status : 'discovered'
  const authState = LOCAL_AGENT_AUTH_STATES.has(value.authState) ? value.authState : 'unknown'
  return {
    ...publicDriver(driver),
    installationId,
    installed: true,
    status,
    authState,
    executablePath,
    resolvedTargetPath: safeAbsoluteExecutablePath(value.resolvedTargetPath) ? String(value.resolvedTargetPath) : '',
    resolvedTargetFingerprint: String(value.resolvedTargetFingerprint || '').trim().slice(0, 128),
    source: cleanProbeText(!value.source || value.source === 'custom-path' ? classifyExecutableSource(executablePath) : value.source, 80),
    publisher: cleanProbeText(value.publisher || '', 160),
    signatureState: ['trusted', 'signed', 'unsigned', 'unknown'].includes(value.signatureState) ? value.signatureState : 'unknown',
    verificationState: ['unverified', 'verified', 'failed', 'changed'].includes(value.verificationState) ? value.verificationState : 'unverified',
    fingerprint: String(value.fingerprint || '').trim().slice(0, 128),
    discoveredAt: validIso(value.discoveredAt) || validIso(value.lastSeenAt) || new Date(0).toISOString(),
    lastSeenAt: validIso(value.lastSeenAt) || validIso(value.discoveredAt) || new Date(0).toISOString(),
    modifiedAt: validIso(value.modifiedAt) || fileModifiedAt(safeAbsoluteExecutablePath(value.resolvedTargetPath) ? String(value.resolvedTargetPath) : executablePath),
    ...(String(value.version || '').trim() ? { version: cleanProbeText(value.version) } : {}),
    ...(String(value.detail || '').trim() ? { detail: cleanProbeText(value.detail) } : {}),
  }
}

function safeAbsoluteExecutablePath(value) {
  const text = String(value || '')
  return !/[\u0000-\u001f\u007f]/.test(text) && (path.isAbsolute(text) || path.win32.isAbsolute(text))
}

function isKnownDiscoveryNoise(executablePath) {
  const value = String(executablePath || '').toLowerCase().replace(/\//g, '\\')
  if (!value) return true
  if (/\\appdata\\local\\openai\\codex\\bin(?:\\|$)/i.test(value)) return true
  if (/\\appdata\\local\\packages\\/i.test(value)) return true
  if (/\\localcache\\/i.test(value)) return true
  if (/\\resources\\app\\/i.test(value)) return true
  if (value.includes('\\node_modules\\')) return true
  if (/\\(?:documents|desktop|downloads|onedrive)(?:\\|$)/i.test(value)) return true
  if (/\\(?:work|fixtures|testdata|__tests__|target\\(?:debug|release)|appdata\\local\\temp)(?:\\|$)/i.test(value)) return true
  return false
}

function plausibleGlobalInstallationPath(executablePath, driver) {
  if (isKnownDiscoveryNoise(executablePath)) return false
  const candidate = path.win32.resolve(executablePath).toLowerCase()
  const user = String(process.env.USERPROFILE || 'C:\\Users\\malou').toLowerCase().replace(/\//g, '\\')
  const local = String(process.env.LOCALAPPDATA || `${user}\\appdata\\local`).toLowerCase().replace(/\//g, '\\')
  const roaming = String(process.env.APPDATA || `${user}\\appdata\\roaming`).toLowerCase().replace(/\//g, '\\')
  const programFiles = [process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'].map((root) => path.win32.resolve(root).toLowerCase())
  if (candidate.startsWith(`${roaming}\\npm\\`) && !candidate.slice(`${roaming}\\npm\\`.length).includes('\\')) return true
  if (candidate.startsWith(`${user}\\.local\\bin\\`) && !candidate.slice(`${user}\\.local\\bin\\`.length).includes('\\')) return true
  if (candidate.startsWith(`${user}\\.cargo\\bin\\`) && !candidate.slice(`${user}\\.cargo\\bin\\`.length).includes('\\')) return true
  if (candidate.startsWith(`${user}\\scoop\\shims\\`) && !candidate.slice(`${user}\\scoop\\shims\\`.length).includes('\\')) return true
  if (candidate.startsWith(`${local}\\programs\\`)) return true
  if (programFiles.some((root) => candidate.startsWith(`${root}\\`))) return true
  if (driver?.id === 'opencode' && candidate === `${local}\\opencode\\opencode.exe`) return true
  return /^[a-z]:\\(?:tools|apps|bin)\\[^\\]+$/i.test(candidate)
}

function collapseRuntimeDuplicates(agents) {
  const launcherGroups = new Map()
  for (const agent of agents.filter(Boolean)) {
    const key = `${agent.driverId}\0${path.win32.dirname(agent.executablePath).toLowerCase()}`
    const existing = launcherGroups.get(key)
    if (!existing || executableRank(agent.executablePath) < executableRank(existing.executablePath)) launcherGroups.set(key, agent)
  }
  agents = [...launcherGroups.values()]
  const resolvedTargets = new Map()
  for (const agent of agents) {
    if (agent.resolvedTargetPath) resolvedTargets.set(path.win32.resolve(agent.resolvedTargetPath).toLowerCase(), agent)
  }
  return agents.filter((agent) => {
    const owner = resolvedTargets.get(path.win32.resolve(agent.executablePath).toLowerCase())
    return !owner || owner.installationId === agent.installationId
  })
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
  const onlyDriverId = String(options.onlyDriverId || '').trim()
  const drivers = onlyDriverId
    ? LOCAL_AGENT_DRIVERS.filter((driver) => driver.id === onlyDriverId)
    : LOCAL_AGENT_DRIVERS
  const groups = await Promise.all(drivers.map((driver) => discoverDriverInstances(driver, { findExecutables, filterInstallPaths: findExecutables === defaultFindExecutables })))
  const agents = await enrichDiscoveredVersions(groups.flat().sort(compareInstallations), drivers)
  return {
    agents,
    scannedAt: new Date().toISOString(),
  }
}

async function enrichDiscoveredVersions(agents, drivers = LOCAL_AGENT_DRIVERS) {
  const driverMap = new Map(drivers.map((driver) => [driver.id, driver]))
  return Promise.all(agents.map(async (agent) => {
    const version = await readDiscoveredVersion(agent.resolvedTargetPath || agent.executablePath, driverMap.get(agent.driverId))
    return version ? { ...agent, version } : agent
  }))
}

async function readDiscoveredVersion(executablePath, driver) {
  if (!driver || !safeAbsoluteExecutablePath(executablePath)) return ''
  if (/\.(?:cmd|bat)$/i.test(executablePath)) {
    for (const packageName of driver.npmPackages || []) {
      const packagePath = path.join(path.dirname(executablePath), 'node_modules', ...packageName.split('/'), 'package.json')
      try {
        const value = JSON.parse(await fsp.readFile(packagePath, 'utf8'))
        if (/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(String(value.version || ''))) return String(value.version)
      } catch {}
    }
    return ''
  }
  if (process.platform !== 'win32' || !/\.exe$/i.test(executablePath)) return ''
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const literalPath = executablePath.replace(/'/g, "''")
  const script = `$item = Get-Item -LiteralPath '${literalPath}' -ErrorAction Stop; if ($item.VersionInfo.ProductVersion) { $item.VersionInfo.ProductVersion } else { $item.VersionInfo.FileVersion }`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const result = await runNativeExecutable(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeout: 3000 })
  const version = cleanProbeText(result.stdout || '', 80).split(/\r?\n/)[0].trim()
  if (result.ok && version) return version
  const windowsAppVersion = executablePath.match(/\\WindowsApps\\[^\\]+_([0-9]+(?:\.[0-9]+){1,3})_(?:x64|x86|arm64|neutral)_/i)
  return windowsAppVersion?.[1] || ''
}

async function discoverDriverInstances(driver, dependencies) {
  let candidates = []
  try {
    candidates = await dependencies.findExecutables(driver.executableNames, driver.fixedPathTemplates || [], driver.windowsDisplayNames || [])
  } catch {}
  const now = new Date().toISOString()
  const filtered = process.platform === 'win32' && dependencies.filterInstallPaths ? candidates.filter((candidate) => plausibleGlobalInstallationPath(candidate, driver)) : candidates
  return collapseLauncherCandidates(driver, preferExecutableCandidates(filtered)).map((executablePath) => discoveredInstallation(driver, executablePath, now))
}

function collapseLauncherCandidates(driver, candidates) {
  const groups = new Map()
  for (const candidate of candidates) {
    const directory = path.dirname(candidate).toLowerCase()
    const key = `${driver.id}\0${directory}`
    const existing = groups.get(key)
    if (!existing || executableRank(candidate) < executableRank(existing)) groups.set(key, candidate)
  }
  return [...groups.values()].sort((left, right) => executableRank(left) - executableRank(right) || left.localeCompare(right))
}

function discoveredInstallation(driver, executablePath, now = new Date().toISOString()) {
  const normalizedPath = path.resolve(executablePath)
  const source = classifyExecutableSource(normalizedPath)
  const resolvedTargetPath = resolveLocalAgentTarget(normalizedPath, driver, source)
  return {
    ...publicDriver(driver),
    installationId: installationIdFor(driver.id, normalizedPath),
    installed: true,
    status: driver.bindable ? 'discovered' : 'detected_only',
    authState: 'unknown',
    executablePath: normalizedPath,
    resolvedTargetPath,
    resolvedTargetFingerprint: resolvedTargetPath ? fileFingerprint(resolvedTargetPath) : '',
    source,
    publisher: '',
    signatureState: source === 'desktop-bundled' ? 'trusted' : 'unknown',
    verificationState: 'unverified',
    fingerprint: fileFingerprint(normalizedPath),
    modifiedAt: fileModifiedAt(resolvedTargetPath || normalizedPath),
    discoveredAt: now,
    lastSeenAt: now,
  }
}

function resolveLocalAgentTarget(executablePath, driver, source) {
  const shimTarget = resolveWindowsShimTarget(executablePath, driver)
  if (shimTarget) return shimTarget
  if (process.platform !== 'win32' || driver.id !== 'codex' || source !== 'desktop-bundled') return ''
  const root = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin')
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, 'codex.exe'))
      .filter((candidate) => fs.existsSync(candidate))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || ''
  } catch {
    return ''
  }
}

function installationIdFor(driverId, executablePath) {
  const normalized = process.platform === 'win32' ? path.resolve(executablePath).toLowerCase() : path.resolve(executablePath)
  return `agent-installation-${crypto.createHash('sha256').update(`${driverId}\0${normalized}`).digest('hex').slice(0, 32)}`
}

function fileFingerprint(executablePath) {
  try {
    const stat = fs.statSync(executablePath)
    return `${stat.size}:${Math.trunc(stat.mtimeMs)}`
  } catch {
    return ''
  }
}

function fileModifiedAt(executablePath) {
  try {
    return fs.statSync(executablePath).mtime.toISOString()
  } catch {
    return ''
  }
}

function classifyExecutableSource(executablePath) {
  const value = String(executablePath).toLowerCase()
  if (value.includes('\\windowsapps\\openai.codex_') && value.includes('\\resources\\codex')) return 'desktop-bundled'
  if (value.includes('\\appdata\\roaming\\npm\\') || value.includes('/node_modules/')) return 'npm'
  if (value.includes('\\.local\\bin\\')) return 'user-cli'
  if (value.includes('\\scoop\\shims\\') || value.includes('\\.cargo\\bin\\') || value.includes('\\chocolatey\\bin\\')) return 'package-manager'
  if (value.includes('\\program files\\') || value.includes('\\program files (x86)\\')) return 'system-install'
  if (value.includes('\\appdata\\local\\programs\\')) return 'user-install'
  if (value.includes('\\.cargo\\bin\\')) return 'cargo'
  return 'custom-path'
}

function resolveWindowsShimTarget(executablePath, driver) {
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executablePath)) return ''
  try {
    const data = fs.readFileSync(executablePath, 'utf8').slice(0, 32 * 1024)
    const matches = [...data.matchAll(/(?:"([^"]+\.exe)"|([^\s"&|<>^]+\.exe))/ig)]
    for (const match of matches) {
      const candidate = String(match[1] || match[2] || '').replace(/%~dp0/ig, `${path.dirname(executablePath)}\\`)
      const resolved = path.resolve(candidate)
      if (fs.existsSync(resolved) && executablePathMatchesDriver(resolved, driver)) return resolved
    }
  } catch {}
  return ''
}

function compareInstallations(left, right) {
  return left.driverId.localeCompare(right.driverId) || left.source.localeCompare(right.source) || left.executablePath.localeCompare(right.executablePath)
}

async function verifyLocalAgentInstallation(agent, options = {}) {
  const driver = localAgentDriver(agent?.driverId)
  const fileExists = options.fileExists || fs.existsSync
  const fingerprint = options.fileFingerprint || fileFingerprint
  if (!driver || !driver.bindable || !safeAbsoluteExecutablePath(agent?.executablePath) || !fileExists(agent.executablePath)) {
    throw new Error('The selected local Agent installation is unavailable.')
  }
  if (fingerprint(agent.executablePath) !== agent.fingerprint) throw new Error('The selected local Agent executable changed after scanning. Scan again before binding.')
  const launchPath = safeAbsoluteExecutablePath(agent.resolvedTargetPath) && executablePathMatchesDriver(agent.resolvedTargetPath, driver) && fileExists(agent.resolvedTargetPath)
    ? agent.resolvedTargetPath
    : agent.executablePath
  if (launchPath !== agent.executablePath && agent.resolvedTargetFingerprint && fingerprint(launchPath) !== agent.resolvedTargetFingerprint) {
    throw new Error('The selected local Agent runtime changed after scanning. Scan again before binding.')
  }
  const runProbe = options.runProbe || defaultRunProbe
  const versionResult = await runProbe(launchPath, driver.versionArgs || ['--version'])
  if (!versionResult?.ok) return { ...agent, status: 'probe_failed', verificationState: 'failed', detail: probeFailureDetail(versionResult) }
  let authState = 'unknown'
  if (driver.authProbe) authState = interpretAuthState(driver.authProbe.kind, await runProbe(launchPath, driver.authProbe.args))
  const status = authState === 'not_authenticated' ? 'login_required' : authState === 'authenticated' ? 'ready' : 'available'
  return { ...agent, status, authState, version: cleanProbeText(versionResult.stdout || versionResult.stderr), verificationState: 'verified', lastSeenAt: new Date().toISOString() }
}

async function scanLocalAgentsGlobal(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'win32') return { agents: [], scannedAt: new Date().toISOString(), volumes: [] }
  const definitionsByName = new Map()
  for (const driver of LOCAL_AGENT_DRIVERS) {
    for (const name of driver.executableNames) {
      for (const candidate of windowsExecutableAliases(name)) {
        const list = definitionsByName.get(candidate) || []
        list.push(driver)
        definitionsByName.set(candidate, list)
      }
    }
    for (const template of driver.fixedPathTemplates || []) {
      const basename = path.win32.basename(template).toLowerCase()
      const list = definitionsByName.get(basename) || []
      list.push(driver)
      definitionsByName.set(basename, list)
    }
  }
  const volumes = options.volumes || await windowsFixedVolumes(options.runNativeExecutable || runNativeExecutable)
  const readDirectory = options.readDirectory || fspDirectoryEntries
  const found = new Map()
  let visitedDirectories = 0
  let reportedProgress = 0
  for (let volumeIndex = 0; volumeIndex < volumes.length; volumeIndex++) {
    const volume = volumes[volumeIndex]
    const volumeVisitedStart = visitedDirectories
    const queue = [volume]
    while (queue.length) {
      if (options.signal?.aborted) return { agents: [...found.values()].sort(compareInstallations), scannedAt: new Date().toISOString(), volumes, cancelled: true }
      if (options.waitWhilePaused) await options.waitWhilePaused()
      if (options.signal?.aborted) return { agents: [...found.values()].sort(compareInstallations), scannedAt: new Date().toISOString(), volumes, cancelled: true }
      const directory = queue.shift()
      if (excludedGlobalDirectory(directory)) continue
      let entries
      try { entries = await readDirectory(directory) } catch { continue }
      visitedDirectories++
      for (const entry of entries) {
        const candidate = path.join(directory, entry.name)
        if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push(candidate)
        if (!entry.isFile()) continue
        const drivers = definitionsByName.get(entry.name.toLowerCase()) || []
        for (const driver of drivers) {
          if (!plausibleGlobalInstallationPath(candidate, driver)) continue
          const installation = discoveredInstallation(driver, candidate)
          found.set(installation.installationId, installation)
        }
      }
      if (visitedDirectories % 250 === 0) {
        const agents = collapseRuntimeDuplicates([...found.values()].sort(compareInstallations)).slice(0, LOCAL_AGENT_SNAPSHOT_LIMIT)
        const visitedOnVolume = visitedDirectories - volumeVisitedStart
        const volumeProgress = visitedOnVolume / Math.max(1, visitedOnVolume + queue.length)
        const estimated = Math.min(99, Math.floor(((volumeIndex + volumeProgress) / Math.max(1, volumes.length)) * 100))
        reportedProgress = Math.max(reportedProgress, estimated)
        await options.onProgress?.({ visitedDirectories, found: agents.length, volume, agents, progress: reportedProgress })
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
  }
  const journalCursors = await queryWindowsJournalCursors(volumes, options.runNativeExecutable || runNativeExecutable)
  const agents = await enrichDiscoveredVersions(collapseRuntimeDuplicates([...found.values()].sort(compareInstallations)))
  return { agents, scannedAt: new Date().toISOString(), volumes, visitedDirectories, index: { backend: Object.keys(journalCursors).length ? 'ntfs-usn' : 'full-scan-fallback', journalCursors } }
}

async function queryWindowsJournalCursors(volumes, runNative = runNativeExecutable) {
  if (!volumes) volumes = await windowsFixedVolumes(runNative)
  const cursors = {}
  const fsutil = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'fsutil.exe') : 'fsutil'
  for (const volume of volumes || []) {
    const result = await runNative(fsutil, ['usn', 'queryjournal', volume.slice(0, 2)], { timeout: 5000 })
    if (!result.ok) continue
    const values = [...String(result.stdout || '').matchAll(/:\s*(0x[0-9a-f]+)/ig)].map((match) => match[1])
    const journalId = values[0]
    const nextUsn = values[2]
    if (journalId && nextUsn) cursors[volume.toUpperCase()] = { journalId, nextUsn }
  }
  return cursors
}

function journalCursorsEqual(left, right) {
  const leftEntries = Object.entries(left || {}).sort(([a], [b]) => a.localeCompare(b))
  const rightEntries = Object.entries(right || {}).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries) && leftEntries.length > 0
}

function windowsExecutableAliases(name) {
  const value = String(name || '').toLowerCase()
  if (!value) return []
  if (/\.[a-z0-9]+$/.test(value)) return [value]
  return [value, `${value}.exe`, `${value}.cmd`, `${value}.bat`]
}

async function windowsFixedVolumes(runNative) {
  const result = await runNative('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { $_.DeviceID }"], { timeout: 5000 })
  const volumes = String(result.stdout || '').split(/\r?\n/).map((value) => value.trim()).filter((value) => /^[A-Za-z]:$/.test(value)).map((value) => `${value}\\`)
  return volumes.length ? volumes : [`${process.env.SystemDrive || 'C:'}\\`]
}

async function fspDirectoryEntries(directory) {
  return fsp.readdir(directory, { withFileTypes: true })
}

function excludedGlobalDirectory(directory) {
  const value = String(directory || '').toLowerCase().replace(/\//g, '\\')
  return /\\(?:system volume information|\$recycle\.bin|recovery|windows\\winsxs|windows\\servicing)(?:\\|$)/i.test(value)
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
  scanLocalAgentsGlobal,
  verifyLocalAgentInstallation,
  installationIdFor,
  journalCursorsEqual,
  queryWindowsJournalCursors,
  runNativeExecutable,
}
