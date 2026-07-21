const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFile: execFileCallback } = require('node:child_process')
const { applyEdits, modify, parse } = require('jsonc-parser')

const CLIENT_IDS = Object.freeze(['codex', 'claude-code', 'cursor', 'opencode', 'openclaw'])
const ONBOARDING_VERSION = 2

const CLIENT_NAMES = Object.freeze({
  codex: 'Codex',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
})

function createAgentMCPRegistry(options = {}) {
  const platform = options.platform || process.platform
  const homeDir = options.homeDir || os.homedir()
  const appData = options.appData || process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')
  const localAppData = options.localAppData || process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')
  const helperPath = path.resolve(String(options.helperPath || 'exora-dockd'))
  const dockConfigPath = path.resolve(String(options.configPath || path.join(homeDir, '.exora-dock', 'config.yaml')))
  const registryPath = options.registryPath || path.join(homeDir, '.exora-dock', 'agent-mcp-registry.json')
  const execFile = options.execFile || execFilePromise
  const executableCandidates = options.executableCandidates || {}
  const installationCandidates = options.installationCandidates || {}
  const pathValue = options.pathValue ?? process.env.PATH ?? ''
  const discoveryCache = new Map()

  function spec(clientId) {
    assertClientId(clientId)
    const clientName = CLIENT_NAMES[clientId]
    return {
      clientId,
      clientName,
      helperPath,
      dockConfigPath,
      command: helperPath,
      args: ['mcp', dockConfigPath],
      env: { EXORA_MCP_CLIENT_NAME: clientName },
    }
  }

  function configPathFor(clientId) {
    if (clientId === 'codex') return path.join(homeDir, '.codex', 'config.toml')
    if (clientId === 'claude-code') return path.join(homeDir, '.claude.json')
    if (clientId === 'cursor') return path.join(homeDir, '.cursor', 'mcp.json')
    if (clientId === 'opencode') return path.join(homeDir, '.config', 'opencode', 'opencode.json')
    return path.join(homeDir, '.openclaw', 'openclaw.json')
  }

  function cliNames(clientId) {
    if (clientId === 'claude-code') return ['claude']
    if (clientId === 'cursor') return ['cursor-agent', 'cursor']
    return [clientId]
  }

  function candidateDescriptors(clientId) {
    const descriptors = []
    const suppliedInstallations = installationCandidates[clientId]
    for (const item of Array.isArray(suppliedInstallations) ? suppliedInstallations : suppliedInstallations ? [suppliedInstallations] : []) {
      descriptors.push(typeof item === 'string' ? { path: item, kind: 'cli' } : item)
    }
    const supplied = executableCandidates[clientId]
    for (const file of Array.isArray(supplied) ? supplied : supplied ? [supplied] : []) descriptors.push({ path: file, kind: 'cli' })
    const pathDirs = String(pathValue).split(path.delimiter).map((value) => value.trim().replace(/^"|"$/g, '')).filter(Boolean)
    for (const name of cliNames(clientId)) {
      if (platform === 'win32') {
        for (const dir of [path.join(homeDir, '.local', 'bin'), path.join(appData, 'npm'), ...pathDirs]) {
          descriptors.push({ path: path.join(dir, `${name}.exe`), kind: 'cli' }, { path: path.join(dir, `${name}.cmd`), kind: 'cli' })
        }
      } else {
        for (const dir of [path.join(homeDir, '.local', 'bin'), path.join(homeDir, 'Library', 'pnpm'), path.join(homeDir, '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', ...pathDirs]) {
          descriptors.push({ path: path.join(dir, name), kind: 'cli' })
        }
      }
    }
    if (clientId === 'codex') {
      if (platform === 'darwin') descriptors.push({ path: '/Applications/Codex.app', kind: 'desktop' }, { path: path.join(homeDir, 'Applications', 'Codex.app'), kind: 'desktop' })
      else descriptors.push({ path: path.join(localAppData, 'Programs', 'Codex', 'Codex.exe'), kind: 'desktop' }, { path: path.join(localAppData, 'Codex', 'Codex.exe'), kind: 'desktop' })
    }
    if (clientId === 'cursor') {
      if (platform === 'darwin') descriptors.push({ path: '/Applications/Cursor.app', kind: 'desktop' }, { path: path.join(homeDir, 'Applications', 'Cursor.app'), kind: 'desktop' })
      else descriptors.push({ path: path.join(localAppData, 'Programs', 'cursor', 'Cursor.exe'), kind: 'desktop' })
    }
    return descriptors
  }

  function installationIdentity(clientId, descriptor) {
    const resolved = path.resolve(String(descriptor.path || ''))
    const windowsStoreDesktop = clientId === 'codex' && /[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/].*[\\/]resources[\\/]codex(?:\.exe)?$/i.test(resolved)
    const kind = windowsStoreDesktop ? 'desktop' : descriptor.kind || 'cli'
    if (kind === 'cli') return `${kind}:${path.dirname(resolved)}:${path.basename(resolved).replace(/\.(?:exe|cmd)$/i, '').toLowerCase()}`
    return `${kind}:${resolved.toLowerCase()}`
  }

  async function discoverInstallations(clientId, options = {}) {
    assertClientId(clientId)
    const cacheKey = `${clientId}:${options.passive === true ? 'passive' : 'active'}`
    if (discoveryCache.has(cacheKey)) return discoveryCache.get(cacheKey)
    const promise = (async () => {
      const found = []
      const seen = new Set()
      for (const descriptor of candidateDescriptors(clientId)) {
        if (!descriptor?.path || !await fileExists(descriptor.path)) continue
        const identity = installationIdentity(clientId, descriptor)
        if (seen.has(identity)) continue
        seen.add(identity)
        const resolved = path.resolve(descriptor.path)
        const windowsStoreDesktop = clientId === 'codex' && /[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/].*[\\/]resources[\\/]codex(?:\.exe)?$/i.test(resolved)
        const kind = windowsStoreDesktop ? 'desktop' : descriptor.kind || 'cli'
        const version = descriptor.version || await detectInstallationVersion(resolved, kind, options)
        found.push({
          clientId,
          instanceId: `agent_${crypto.createHash('sha256').update(`${clientId}|${kind}|${resolved}`).digest('hex').slice(0, 16)}`,
          instanceLabel: `${CLIENT_NAMES[clientId]} ${kind === 'desktop' ? 'Desktop' : 'CLI'}`,
          installKind: kind,
          installPath: resolved,
          executable: kind === 'cli' ? resolved : '',
          version,
          configPath: configPathFor(clientId),
          registrationTarget: `${clientId}|${configPathFor(clientId)}`,
        })
      }
      if (!found.length && await fileExists(configPathFor(clientId))) {
        const configPath = configPathFor(clientId)
        found.push({ clientId, instanceId: `agent_${crypto.createHash('sha256').update(`${clientId}|config|${configPath}`).digest('hex').slice(0, 16)}`, instanceLabel: `${CLIENT_NAMES[clientId]} configuration`, installKind: 'config', installPath: configPath, executable: '', version: '', configPath, registrationTarget: `${clientId}|${configPath}` })
      }
      return found
    })()
    discoveryCache.set(cacheKey, promise)
    return promise
  }

  async function detectInstallationVersion(file, kind, options = {}) {
    const store = String(file).match(/[\\/]OpenAI\.Codex_([^_\\/]+)_/i)
    if (store) return store[1]
    if (options.passive === true) return ''
    if (platform === 'darwin' && kind === 'desktop' && file.endsWith('.app')) {
      try {
        const { stdout } = await execFile('/usr/bin/defaults', ['read', path.join(file, 'Contents', 'Info'), 'CFBundleShortVersionString'], { timeout: 3000 })
        return cleanVersion(stdout)
      } catch { return '' }
    }
    if (kind !== 'cli') return ''
    try {
      const { stdout, stderr } = await runCLI(file, ['--version'], { timeout: 5000 })
      return cleanVersion(stdout || stderr)
    } catch { return '' }
  }

  async function resolveClientExecutable(clientId) {
    return (await discoverInstallations(clientId)).find((item) => item.executable)?.executable || ''
  }

  async function resolveInstallation(clientId, instanceId, options = {}) {
    const installations = await discoverInstallations(clientId, options)
    return installations.find((item) => item.instanceId === instanceId) || installations[0] || { clientId, instanceId: '', instanceLabel: CLIENT_NAMES[clientId], installKind: 'missing', installPath: '', executable: '', version: '', configPath: configPathFor(clientId), registrationTarget: `${clientId}|${configPathFor(clientId)}` }
  }

  async function status(clientId, instanceId, options = {}) {
    const installation = await resolveInstallation(clientId, instanceId, options)
    const detected = installation.installKind !== 'missing'
    const base = {
      clientId,
      displayName: CLIENT_NAMES[clientId],
      ...installation,
      detected,
      state: detected ? 'available' : 'not-detected',
      managed: await isManaged(clientId),
      restartRequired: false,
      canRegister: detected && (!['claude-code', 'openclaw'].includes(clientId) || Boolean(installation.executable)),
      canRepair: false,
      canRemove: false,
      message: detected ? 'Ready to connect.' : 'Client was not detected on this device.',
    }
    if (!detected) return base
    if (options.passive === true && (clientId === 'claude-code' || clientId === 'openclaw')) {
      return base.managed ? { ...base, ...registeredStatus() } : base
    }
    try {
      const inspected = clientId === 'codex'
        ? await inspectCodex(installation.configPath, spec(clientId))
        : clientId === 'cursor' || clientId === 'opencode'
          ? await inspectJSONClient(clientId, installation.configPath, spec(clientId))
          : await inspectCLIClient(clientId, installation.executable, spec(clientId))
      return { ...base, ...inspected }
    } catch (error) {
      return { ...base, state: 'error', canRegister: false, message: error.message }
    }
  }

  async function list(options = {}) {
    const groups = await Promise.all(CLIENT_IDS.map(async (clientId) => {
      const installations = await discoverInstallations(clientId, options)
      return installations.length ? Promise.all(installations.map((item) => status(clientId, item.instanceId, options))) : [await status(clientId, undefined, options)]
    }))
    const clients = groups.flat()
    const targets = new Map()
    for (const client of clients) {
      const target = client.registrationTarget
      if (!targets.has(target)) targets.set(target, [])
      targets.get(target).push(client)
    }
    return [...targets.values()].map((installations) => {
      const primary = installations[0]
      const versions = [...new Set(installations.map((item) => item.version).filter(Boolean))]
      return {
        ...primary,
        instanceLabel: primary.displayName,
        installationCount: installations.length,
        sharedTargetCount: installations.length,
        versions,
      }
    })
  }

  async function register(values) {
    const selections = await resolveSelections(values)
    const results = []
    const targets = new Set()
    for (const selection of selections) {
      if (targets.has(selection.registrationTarget)) continue
      targets.add(selection.registrationTarget)
      results.push(await mutateOne(selection.clientId, 'register', selection.instanceId))
    }
    return { onboardingVersion: ONBOARDING_VERSION, clients: results }
  }

  async function resolveSelections(values) {
    const requested = [...new Set((Array.isArray(values) ? values : []).map(String))]
    const installations = (await Promise.all(CLIENT_IDS.map(discoverInstallations))).flat()
    return requested.map((value) => {
      const instance = installations.find((item) => item.instanceId === value)
      if (instance) return instance
      assertClientId(value)
      return installations.find((item) => item.clientId === value) || { clientId: value, instanceId: '', registrationTarget: `${value}|${configPathFor(value)}` }
    })
  }

  async function remove(clientId, instanceId) {
    return mutateOne(clientId, 'remove', instanceId)
  }

  async function repair(clientId, instanceId) {
    return mutateOne(clientId, 'repair', instanceId)
  }

  async function mutateOne(clientId, action, instanceId) {
    assertClientId(clientId)
    const before = await status(clientId, instanceId)
    if (!before.detected && action !== 'remove') return resultError(clientId, action, 'Client was not detected.')
    try {
      if (clientId === 'codex') {
        await mutateCodex(configPathFor(clientId), spec(clientId), action)
      } else if (clientId === 'cursor' || clientId === 'opencode') {
        await mutateJSONClient(clientId, configPathFor(clientId), spec(clientId), action)
      } else {
        const executable = before.executable || await resolveClientExecutable(clientId)
        if (!executable) throw new Error(`${CLIENT_NAMES[clientId]} CLI is unavailable.`)
        await mutateCLIClient(clientId, executable, spec(clientId), action)
      }
      if (action === 'remove') await forgetManaged(clientId)
      else await rememberManaged(clientId)
      const after = await status(clientId, before.instanceId)
      return { ok: true, action, ...after, restartRequired: true }
    } catch (error) {
      return resultError(clientId, action, error.message, await status(clientId, before.instanceId))
    }
  }

  async function rememberManaged(clientId) {
    const ledger = await readLedger(registryPath)
    ledger.version = 1
    ledger.clients = ledger.clients || {}
    ledger.clients[clientId] = {
      configPath: configPathFor(clientId),
      fingerprint: canonicalFingerprint(spec(clientId)),
      platform,
      managedAt: new Date().toISOString(),
    }
    await writeJSONAtomic(registryPath, ledger)
  }

  async function forgetManaged(clientId) {
    const ledger = await readLedger(registryPath)
    if (ledger.clients) delete ledger.clients[clientId]
    await writeJSONAtomic(registryPath, ledger)
  }

  async function isManaged(clientId) {
    const ledger = await readLedger(registryPath)
    return Boolean(ledger.clients?.[clientId])
  }

  return { list, status, register, remove, repair, spec, configPathFor, discoverInstallations, resolveClientExecutable }

  async function runCLI(executable, argv, options) {
    if (platform !== 'win32' || path.extname(executable).toLowerCase() !== '.cmd') return execFile(executable, argv, options)
    const target = await resolveNpmCommandShim(executable)
    if (!target) throw new Error(`The npm launcher for ${path.basename(executable)} is not a supported local JavaScript shim.`)
    return execFile(process.execPath, [target, ...argv], {
      ...options,
      env: { ...process.env, ...options?.env, ELECTRON_RUN_AS_NODE: '1' },
    })
  }

  async function inspectCLIClient(clientId, executable, canonical) {
    if (!executable) return { state: 'available', canRegister: false, message: `${CLIENT_NAMES[clientId]} CLI is unavailable.` }
    const argv = clientId === 'claude-code'
      ? ['mcp', 'get', 'exora-dock']
      : ['mcp', 'show', 'exora-dock', '--json']
    try {
      const { stdout } = await runCLI(executable, argv, { timeout: 10000 })
      const text = String(stdout || '')
      if (sameCLIConfig(text, canonical)) return registeredStatus()
      if (/exora-dockd(?:\.exe)?/i.test(text)) return staleStatus()
      return conflictStatus()
    } catch (error) {
      if (Number(error.code) === 1 || /not found|does not exist|no mcp/i.test(String(error.stderr || error.message))) {
        return { state: 'available', canRegister: true, canRemove: false, canRepair: false, message: 'Ready to connect.' }
      }
      throw error
    }
  }

  async function mutateCLIClient(clientId, executable, canonical, action) {
    if (action === 'remove' || action === 'repair') {
      const argv = clientId === 'claude-code'
        ? ['mcp', 'remove', '--scope', 'user', 'exora-dock']
        : ['mcp', 'unset', 'exora-dock']
      try { await runCLI(executable, argv, { timeout: 15000 }) } catch (error) {
        if (action === 'remove' && /not found|does not exist|no mcp/i.test(String(error.stderr || error.message))) return
        if (action !== 'repair') throw error
      }
      if (action === 'remove') return
    }
    const argv = clientId === 'claude-code'
      ? ['mcp', 'add', '--scope', 'user', '--env', `EXORA_MCP_CLIENT_NAME=${canonical.clientName}`, '--transport', 'stdio', 'exora-dock', '--', canonical.command, ...canonical.args]
      : ['mcp', 'add', 'exora-dock', '--command', canonical.command, '--arg', 'mcp', '--arg', canonical.dockConfigPath, '--env', `EXORA_MCP_CLIENT_NAME=${canonical.clientName}`, '--no-probe']
    await runCLI(executable, argv, { timeout: 20000 })
  }
}

async function resolveNpmCommandShim(file) {
  let text
  try { text = await fsp.readFile(file, 'utf8') } catch { return '' }
  const match = text.match(/%dp0%\\([^"\r\n]+\.(?:c?js|mjs))/i)
  if (!match) return ''
  const npmRoot = path.resolve(path.dirname(file))
  const target = path.resolve(npmRoot, match[1].replace(/\\/g, path.sep))
  const modulesRoot = path.join(npmRoot, 'node_modules')
  const relative = path.relative(modulesRoot, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !await fileExists(target)) return ''
  return target
}

async function inspectCodex(file, canonical) {
  if (!await fileExists(file)) return { state: 'available', canRegister: true, message: 'Ready to connect.' }
  const text = await fsp.readFile(file, 'utf8')
  const base = tomlSection(text, 'mcp_servers.exora-dock')
  if (!base) return { state: 'available', canRegister: true, message: 'Ready to connect.' }
  const env = tomlSection(text, 'mcp_servers.exora-dock.env') || ''
  const command = tomlString(base, 'command')
  const args = tomlStringArray(base, 'args')
  const clientName = tomlString(env, 'EXORA_MCP_CLIENT_NAME')
  if (samePath(command, canonical.command) && sameArray(args, canonical.args) && clientName === canonical.clientName) return registeredStatus()
  if (/exora-dockd(?:\.exe)?$/i.test(path.basename(command || ''))) return staleStatus()
  return conflictStatus()
}

async function mutateCodex(file, canonical, action) {
  const original = await readTextOr(file, '')
  const hasEntry = Boolean(tomlSection(original, 'mcp_servers.exora-dock'))
  if (action === 'register' && hasEntry) {
    const inspected = await inspectCodex(file, canonical)
    if (inspected.state === 'registered') return
    throw new Error('An existing exora-dock Codex configuration conflicts with the managed configuration.')
  }
  if (action === 'repair' && hasEntry) await backupConflictFile(file)
  let next = stripTomlSections(original, ['mcp_servers.exora-dock', 'mcp_servers.exora-dock.env']).trimEnd()
  if (action !== 'remove') next += `${next ? '\n\n' : ''}${codexBlock(canonical)}\n`
  else if (next) next += '\n'
  if (next === original) return
  await writeTextAtomicChecked(file, original, next)
}

function codexBlock(canonical) {
  return `[mcp_servers.exora-dock]\ncommand = ${JSON.stringify(canonical.command)}\nargs = ${JSON.stringify(canonical.args)}\n\n[mcp_servers.exora-dock.env]\nEXORA_MCP_CLIENT_NAME = ${JSON.stringify(canonical.clientName)}`
}

async function inspectJSONClient(clientId, file, canonical) {
  if (!await fileExists(file)) return { state: 'available', canRegister: true, message: 'Ready to connect.' }
  const text = await fsp.readFile(file, 'utf8')
  const errors = []
  const document = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length || !document || typeof document !== 'object') throw new Error(`${CLIENT_NAMES[clientId]} configuration is not valid JSON/JSONC.`)
  const entry = clientId === 'cursor' ? document.mcpServers?.['exora-dock'] : document.mcp?.['exora-dock']
  const legacy = clientId === 'opencode' ? document.mcp?.exora : undefined
  if (!entry && legacy) {
    if (sameJSONEntry(clientId, legacy, canonical)) return { ...staleStatus(), message: 'Legacy OpenCode entry “exora” can be migrated.' }
    return conflictStatus('Legacy OpenCode entry “exora” conflicts with the managed configuration.')
  }
  if (!entry) return { state: 'available', canRegister: true, message: 'Ready to connect.' }
  if (sameJSONEntry(clientId, entry, canonical)) return registeredStatus()
  const command = clientId === 'cursor' ? entry.command : Array.isArray(entry.command) ? entry.command[0] : entry.command
  if (/exora-dockd(?:\.exe)?$/i.test(path.basename(String(command || '')))) return staleStatus()
  return conflictStatus()
}

async function mutateJSONClient(clientId, file, canonical, action) {
  const original = await readTextOr(file, '{}\n')
  const errors = []
  const document = parse(original, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length || !document || typeof document !== 'object') throw new Error(`${CLIENT_NAMES[clientId]} configuration is not valid JSON/JSONC.`)
  const inspected = await inspectJSONClient(clientId, file, canonical)
  if (action === 'register' && ['conflict', 'stale'].includes(inspected.state)) throw new Error(inspected.message)
  if (action === 'repair' && ['conflict', 'stale'].includes(inspected.state)) await backupConflictFile(file)
  const jsonPath = clientId === 'cursor' ? ['mcpServers', 'exora-dock'] : ['mcp', 'exora-dock']
  const value = action === 'remove' ? undefined : jsonEntry(clientId, canonical)
  let next = applyJSONCModification(original, jsonPath, value)
  if (clientId === 'opencode' && document.mcp?.exora && (action === 'repair' || action === 'remove')) {
    next = applyJSONCModification(next, ['mcp', 'exora'], undefined)
  }
  if (next === original) return
  await writeTextAtomicChecked(file, original, ensureTrailingNewline(next))
}

function jsonEntry(clientId, canonical) {
  if (clientId === 'cursor') return { command: canonical.command, args: canonical.args, env: canonical.env }
  return { type: 'local', command: [canonical.command, ...canonical.args], enabled: true, environment: canonical.env }
}

function sameJSONEntry(clientId, entry, canonical) {
  if (!entry || typeof entry !== 'object') return false
  if (clientId === 'cursor') {
    return samePath(entry.command, canonical.command) && sameArray(entry.args, canonical.args) && entry.env?.EXORA_MCP_CLIENT_NAME === canonical.clientName
  }
  return entry.type === 'local' && entry.enabled !== false && sameArray(entry.command, [canonical.command, ...canonical.args]) && entry.environment?.EXORA_MCP_CLIENT_NAME === canonical.clientName
}

function applyJSONCModification(text, targetPath, value) {
  const edits = modify(text, targetPath, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' },
  })
  return applyEdits(text, edits)
}

function registeredStatus() {
  return { state: 'registered', canRegister: false, canRepair: false, canRemove: true, message: 'Exora Dock is registered.' }
}

function staleStatus() {
  return { state: 'stale', canRegister: false, canRepair: true, canRemove: true, message: 'The Exora Dock executable or config path is outdated.' }
}

function conflictStatus(message = 'An existing exora-dock entry has different settings.') {
  return { state: 'conflict', canRegister: false, canRepair: true, canRemove: true, message }
}

function resultError(clientId, action, message, status = {}) {
  return { ok: false, action, clientId, displayName: CLIENT_NAMES[clientId], ...status, message }
}

function sameCLIConfig(text, canonical) {
  const normalized = String(text || '').replace(/\\\\/g, '\\').replace(/\\\//g, '/')
  return normalized.includes(canonical.command) && normalized.includes(canonical.dockConfigPath)
}

function samePath(a, b) {
  if (!a || !b) return false
  const left = path.resolve(String(a))
  const right = path.resolve(String(b))
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function sameArray(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => index === 1 && /config\.yaml$/i.test(String(value)) ? samePath(value, b[index]) : index === 0 && /[\\/]exora-dockd(?:\.exe)?$/i.test(String(value)) ? samePath(value, b[index]) : value === b[index])
}

function tomlSection(text, sectionName) {
  const header = `[${sectionName}]`
  const lines = String(text || '').split(/(?<=\n)/)
  let active = false
  let result = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      if (active) break
      active = trimmed === header
    }
    if (active) result += line
  }
  return result
}

function stripTomlSections(text, names) {
  const wanted = new Set(names.map((name) => `[${name}]`))
  const lines = String(text || '').split(/(?<=\n)/)
  let skipping = false
  return lines.filter((line) => {
    const trimmed = line.trim()
    if (/^\[[^\]]+\]$/.test(trimmed)) skipping = wanted.has(trimmed)
    return !skipping
  }).join('').replace(/\n{3,}/g, '\n\n')
}

function tomlString(section, key) {
  const match = String(section || '').match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*("(?:\\\\.|[^"])*"|'[^']*')\\s*$`, 'm'))
  if (!match) return ''
  if (match[1].startsWith("'")) return match[1].slice(1, -1)
  try { return JSON.parse(match[1]) } catch { return '' }
}

function tomlStringArray(section, key) {
  const match = String(section || '').match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(\\[[^\\n]*\\])\\s*$`, 'm'))
  if (!match) return []
  try { return JSON.parse(match[1].replace(/'([^']*)'/g, (_, value) => JSON.stringify(value))) } catch { return [] }
}

async function writeTextAtomicChecked(file, expected, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const current = await readTextOr(file, expected === '{}\n' ? '{}\n' : '')
  if (current !== expected) throw new Error('Configuration changed while Exora Dock was preparing the update. Retry after the other application finishes writing it.')
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  const mode = await fsp.stat(file).then((item) => item.mode).catch(() => 0o600)
  try {
    await fsp.writeFile(tmp, value, { encoding: 'utf8', mode })
    await fsp.chmod(tmp, mode).catch(() => undefined)
    await fsp.rename(tmp, file)
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined)
  }
}

async function backupConflictFile(file) {
  if (!await fileExists(file)) return ''
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${file}.exora-dock.${stamp}.bak`
  await fsp.copyFile(file, backup, fs.constants.COPYFILE_EXCL)
  const mode = await fsp.stat(file).then((item) => item.mode).catch(() => undefined)
  if (mode !== undefined) await fsp.chmod(backup, mode).catch(() => undefined)
  return backup
}

async function readLedger(file) {
  try {
    const value = JSON.parse(await fsp.readFile(file, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { version: 1, clients: {} }
  } catch {
    return { version: 1, clients: {} }
  }
}

async function writeJSONAtomic(file, value) {
  const original = await readTextOr(file, '')
  await writeTextAtomicChecked(file, original, `${JSON.stringify(value, null, 2)}\n`)
}

async function readTextOr(file, fallback) {
  try { return await fsp.readFile(file, 'utf8') } catch { return fallback }
}

async function fileExists(file) {
  if (!file) return false
  try { await fsp.access(file); return true } catch { return false }
}

function uniqueClientIds(values) {
  const ids = Array.isArray(values) ? values : []
  return [...new Set(ids.map(String))].map((id) => { assertClientId(id); return id })
}

function assertClientId(clientId) {
  if (!CLIENT_IDS.includes(clientId)) throw new Error(`Unsupported Agent client: ${String(clientId)}`)
}

function canonicalFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify({ command: value.command, args: value.args, env: value.env })).digest('hex')
}

function cleanVersion(value) {
  const text = String(value || '').trim().split(/\r?\n/, 1)[0]
  const match = text.match(/\b\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?\b/)
  return match?.[0] || text.slice(0, 64)
}

function ensureTrailingNewline(value) {
  return String(value || '').replace(/\s*$/, '') + '\n'
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function execFilePromise(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFileCallback(file, args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, ...options, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
      } else resolve({ stdout, stderr })
    })
  })
}

module.exports = {
  CLIENT_IDS,
  CLIENT_NAMES,
  ONBOARDING_VERSION,
  codexBlock,
  createAgentMCPRegistry,
  resolveNpmCommandShim,
  stripTomlSections,
}
