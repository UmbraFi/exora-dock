const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createAgentMCPRegistry, resolveNpmCommandShim, stripTomlSections } = require('./agent-mcp-registry.cjs')

async function withRegistry(run, options = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'exora-agent-mcp-'))
  const helperPath = options.platform === 'darwin'
    ? path.join(root, 'Exora Dock.app', 'Contents', 'Resources', 'binaries', 'exora-dockd')
    : path.join(root, 'Exora Dock', 'exora-dockd.exe')
  const configPath = path.join(root, '.exora-dock', 'config.yaml')
  const cliName = options.cliClient === 'claude-code' ? 'claude' : options.cliClient
  const cliPath = options.cliClient ? path.join(root, 'bin', `${cliName}${options.platform === 'darwin' ? '' : '.exe'}`) : ''
  await fsp.mkdir(path.dirname(helperPath), { recursive: true })
  await fsp.mkdir(path.dirname(configPath), { recursive: true })
  await fsp.writeFile(helperPath, '')
  await fsp.writeFile(configPath, 'listen_addr: 127.0.0.1:8080\n')
  if (cliPath) {
    await fsp.mkdir(path.dirname(cliPath), { recursive: true })
    await fsp.writeFile(cliPath, '')
  }
  const customInstallations = options.createInstallations ? await options.createInstallations(root) : options.installationCandidates
  const registry = createAgentMCPRegistry({
    platform: options.platform || 'win32',
    homeDir: root,
    appData: path.join(root, 'AppData', 'Roaming'),
    helperPath,
    configPath,
    registryPath: path.join(root, '.exora-dock', 'agent-mcp-registry.json'),
    pathValue: options.pathValue ?? '',
    installationCandidates: customInstallations,
    executableCandidates: cliPath ? { [options.cliClient]: [cliPath], ...(options.executableCandidates || {}) } : options.executableCandidates,
    execFile: options.execFile,
  })
  try { await run({ root, registry, helperPath, configPath }) }
  finally { await fsp.rm(root, { recursive: true, force: true }) }
}

test('Codex registration is idempotent and preserves unrelated TOML', async () => withRegistry(async ({ root, registry }) => {
  const file = path.join(root, '.codex', 'config.toml')
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, 'model = "gpt-test"\n\n[mcp_servers.other]\ncommand = "other"\n')
  const first = await registry.register(['codex'])
  assert.equal(first.clients[0].ok, true)
  assert.equal((await registry.status('codex')).state, 'registered')
  const once = await fsp.readFile(file, 'utf8')
  await registry.register(['codex'])
  assert.equal(await fsp.readFile(file, 'utf8'), once)
  assert.match(once, /\[mcp_servers\.other\]/)
  assert.match(once, /\[mcp_servers\.exora-dock\]/)
  await registry.remove('codex')
  const removed = await fsp.readFile(file, 'utf8')
  assert.match(removed, /\[mcp_servers\.other\]/)
  assert.doesNotMatch(removed, /mcp_servers\.exora-dock/)
}))

test('Codex conflict is preserved until explicit repair', async () => withRegistry(async ({ root, registry }) => {
  const file = path.join(root, '.codex', 'config.toml')
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, '[mcp_servers.exora-dock]\ncommand = "unrelated"\nargs = []\n')
  assert.equal((await registry.status('codex')).state, 'conflict')
  const attempted = await registry.register(['codex'])
  assert.equal(attempted.clients[0].ok, false)
  assert.match(await fsp.readFile(file, 'utf8'), /command = "unrelated"/)
  const repaired = await registry.repair('codex')
  assert.equal(repaired.ok, true)
  assert.equal((await registry.status('codex')).state, 'registered')
  const backups = (await fsp.readdir(path.dirname(file))).filter((name) => name.includes('.exora-dock.') && name.endsWith('.bak'))
  assert.equal(backups.length, 1)
}))

test('Cursor JSONC registration preserves comments and other servers', async () => withRegistry(async ({ root, registry }) => {
  const file = path.join(root, '.cursor', 'mcp.json')
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, '{\n  // keep this comment\n  "mcpServers": { "other": { "command": "other" } }\n}\n')
  assert.equal((await registry.register(['cursor'])).clients[0].ok, true)
  const installed = await fsp.readFile(file, 'utf8')
  assert.match(installed, /keep this comment/)
  assert.match(installed, /"other"/)
  assert.match(installed, /"exora-dock"/)
  assert.equal((await registry.status('cursor')).state, 'registered')
  await registry.remove('cursor')
  const removed = await fsp.readFile(file, 'utf8')
  assert.match(removed, /keep this comment/)
  assert.doesNotMatch(removed, /"exora-dock"/)
}))

test('OpenCode migrates a matching legacy exora entry on repair', async () => withRegistry(async ({ root, registry, helperPath, configPath }) => {
  const file = path.join(root, '.config', 'opencode', 'opencode.json')
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, JSON.stringify({ mcp: { exora: { type: 'local', command: [helperPath, 'mcp', configPath], enabled: true, environment: { EXORA_MCP_CLIENT_NAME: 'OpenCode' } } } }, null, 2))
  assert.equal((await registry.status('opencode')).state, 'stale')
  assert.equal((await registry.repair('opencode')).ok, true)
  const value = JSON.parse(await fsp.readFile(file, 'utf8'))
  assert.ok(value.mcp['exora-dock'])
  assert.equal(value.mcp.exora, undefined)
}))

test('Claude adapter uses official user-scope CLI arguments without a shell', async () => {
  const calls = []
  let configured = false
  await withRegistry(async ({ registry }) => {
    let current = await registry.status('claude-code')
    assert.equal(current.state, 'available')
    const result = await registry.register(['claude-code'])
    assert.equal(result.clients[0].ok, true)
    const add = calls.find((call) => call.args.includes('add'))
    assert.deepEqual(add.args.slice(0, 5), ['mcp', 'add', '--scope', 'user', '--env'])
    assert.deepEqual(add.args.slice(6, 9), ['--transport', 'stdio', 'exora-dock'])
    assert.equal(add.options.shell, undefined)
    await registry.remove('claude-code')
    assert.ok(calls.some((call) => call.args.join(' ') === 'mcp remove --scope user exora-dock'))
  }, {
    cliClient: 'claude-code',
    execFile: async (file, args, options) => {
      calls.push({ file, args, options })
      if (args.includes('get')) {
        if (!configured) { const error = new Error('not found'); error.code = 1; error.stderr = 'No MCP server'; throw error }
        return { stdout: calls.find((call) => call.args.includes('add')).args.join(' '), stderr: '' }
      }
      if (args.includes('add')) configured = true
      if (args.includes('remove')) configured = false
      return { stdout: '', stderr: '' }
    },
  })
})

test('OpenClaw registration uses its non-interactive registry without probing during the write', async () => {
  const calls = []
  let configured = false
  await withRegistry(async ({ registry }) => {
    const result = await registry.register(['openclaw'])
    assert.equal(result.clients[0].ok, true)
    const add = calls.find((call) => call.args.includes('add'))
    assert.ok(add.args.includes('--no-probe'))
    assert.ok(add.args.includes('--command'))
    await registry.remove('openclaw')
    assert.ok(calls.some((call) => call.args.join(' ') === 'mcp unset exora-dock'))
  }, {
    cliClient: 'openclaw',
    execFile: async (file, args, options) => {
      calls.push({ file, args, options })
      if (args.includes('show')) {
        if (!configured) { const error = new Error('not found'); error.code = 1; error.stderr = 'not found'; throw error }
        const add = calls.find((call) => call.args.includes('add'))
        return { stdout: add.args.join(' '), stderr: '' }
      }
      if (args.includes('add')) configured = true
      if (args.includes('unset')) configured = false
      return { stdout: '', stderr: '' }
    },
  })
})

test('passive settings status never launches Agent CLIs', async () => {
  const calls = []
  await withRegistry(async ({ registry }) => {
    const clients = await registry.list({ passive: true })
    const claude = clients.find((item) => item.clientId === 'claude-code')
    assert.ok(claude)
    assert.equal(claude.state, 'available')
    assert.equal(claude.version, '')
    assert.equal(calls.length, 0)
  }, {
    cliClient: 'claude-code',
    execFile: async (...args) => {
      calls.push(args)
      throw new Error('Passive settings status must not execute a CLI.')
    },
  })
})

test('macOS registration writes the app-bundled ARM64 helper path without Windows suffixes', async () => withRegistry(async ({ root, registry, helperPath }) => {
  const file = path.join(root, '.codex', 'config.toml')
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, 'model = "gpt-test"\n')
  assert.equal((await registry.register(['codex'])).clients[0].ok, true)
  const installed = await fsp.readFile(file, 'utf8')
  assert.ok(installed.includes(JSON.stringify(helperPath)))
  assert.doesNotMatch(installed, /exora-dockd\.exe/)
}, { platform: 'darwin' }))

test('groups Codex installations by their shared configuration target', async () => withRegistry(async ({ root, registry }) => {
  const file = path.join(root, '.codex', 'config.toml')
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, 'model = "gpt-test"\n')
  const codex = (await registry.list()).filter((item) => item.clientId === 'codex')
  assert.equal(codex.length, 1)
  assert.equal(codex[0].instanceLabel, 'Codex')
  assert.deepEqual(codex[0].versions, ['0.143.0', '26.715.3651.0'])
  assert.equal(codex[0].sharedTargetCount, 2)
  const registered = await registry.register(codex.map((item) => item.instanceId))
  assert.equal(registered.clients.length, 1)
  const installed = await fsp.readFile(file, 'utf8')
  assert.equal((installed.match(/\[mcp_servers\.exora-dock\]/g) || []).length, 1)
  const after = (await registry.list()).filter((item) => item.clientId === 'codex')
  assert.equal(after.length, 1)
  assert.equal(after[0].state, 'registered')
}, {
  createInstallations: async (root) => {
    const cli = path.join(root, 'npm', 'codex.cmd')
    const desktop = path.join(root, 'WindowsApps', 'OpenAI.Codex_26.715.3651.0_x64__test', 'app', 'resources', 'codex.exe')
    await fsp.mkdir(path.dirname(cli), { recursive: true })
    await fsp.mkdir(path.dirname(desktop), { recursive: true })
    await fsp.writeFile(cli, '')
    await fsp.writeFile(desktop, '')
    return { codex: [{ path: cli, kind: 'cli', version: '0.143.0' }, { path: desktop, kind: 'desktop', version: '26.715.3651.0' }] }
  },
}))

test('Windows npm command shims resolve only to a local node_modules JavaScript entry', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'exora-npm-shim-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const target = path.join(root, 'node_modules', 'openclaw', 'dist', 'cli.js')
  const shim = path.join(root, 'openclaw.cmd')
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.writeFile(target, '')
  await fsp.writeFile(shim, '@ECHO off\r\n"%dp0%\\node_modules\\openclaw\\dist\\cli.js" %*\r\n')
  assert.equal(await resolveNpmCommandShim(shim), target)
  await fsp.writeFile(shim, '@ECHO off\r\n"%dp0%\\..\\outside.js" %*\r\n')
  assert.equal(await resolveNpmCommandShim(shim), '')
})

test('TOML section removal leaves neighboring sections intact', () => {
  const value = '[a]\nx=1\n\n[mcp_servers.exora-dock]\ncommand="x"\n\n[mcp_servers.exora-dock.env]\nX="y"\n\n[b]\ny=2\n'
  assert.equal(stripTomlSections(value, ['mcp_servers.exora-dock', 'mcp_servers.exora-dock.env']), '[a]\nx=1\n\n[b]\ny=2\n')
})
