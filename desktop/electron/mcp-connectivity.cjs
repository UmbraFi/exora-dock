const { spawn } = require('node:child_process')

const APPLICATION_SOURCES = Object.freeze(['api'])
const REQUIRED_TOOLS = Object.freeze([
  'exora.search_operations', 'exora.get_api', 'exora.estimate_operation', 'exora.invoke_operation',
  'exora.get_invocation', 'exora.get_job', 'exora.cancel_job', 'exora.create_artifact_upload',
  'exora.complete_artifact_upload', 'exora.create_artifact_download_grant',
  'exora.get_ledger', 'exora.get_usage',
  'exora.list_api_orders', 'exora.get_api_order', 'exora.deactivate_api_order',
  'exora.request_api_order_reactivation', 'exora.get_api_preparation_guide',
  'exora.create_api_draft', 'exora.submit_api_contract', 'exora.list_api_drafts', 'exora.get_api_draft',
  'exora.get_api_validation',
])
const SECRET_PATTERN = /(?:sk-exora(?:-session)?|exora_owner_)-?[A-Za-z0-9._-]+/g
const redactMCPDetail = (value) => String(value || '').replace(SECRET_PATTERN, '[REDACTED]')

function evaluateMCPResponses(lines, options = {}) {
  const responses = lines.map((line) => String(line || '').trim()).filter(Boolean).map((line) => JSON.parse(line))
  const byID = new Map(responses.filter((item) => item?.id !== undefined).map((item) => [Number(item.id), item]))
  const initialize = byID.get(1)
  if (!initialize || initialize.error) throw new Error(`MCP initialize failed: ${redactMCPDetail(initialize?.error?.message || '')}`)
  const connection = initialize.result?._meta?.exoraConnection
  if (!connection?.sessionId || !Array.isArray(connection?.scopes)) throw new Error('MCP initialize did not issue a scoped local Agent session.')
  if (connection?.sessionKey || /sk-exora-session/i.test(JSON.stringify(initialize.result))) throw new Error('MCP initialize exposed an Agent session credential.')
  const tools = Array.isArray(byID.get(2)?.result?.tools) ? byID.get(2).result.tools : []
  const names = new Set(tools.map((tool) => String(tool?.name || '')))
  for (const required of REQUIRED_TOOLS) if (!names.has(required)) throw new Error(`MCP tool surface is stale or incomplete: ${required} is missing.`)
  const retired = [...names].filter((name) => name !== 'exora.create_artifact_download_grant' && /compute|lease|download|resource|endpoint_draft|api_bridge_draft/i.test(name))
  if (retired.length) throw new Error(`MCP exposes retired tools: ${retired.join(', ')}`)
  const categories = []
  if (options.includeMarketplace !== false) {
    const response = byID.get(3)
    if (!response || response.error || response.result?.isError) throw new Error('MCP api search failed.')
    categories.push({ applicationSource: 'api', deliveryModes: ['local_dock', 'cloud_direct'], ok: true, itemCount: response.result?.structuredContent?.operations?.length })
  }
  return { ok: true, protocolVersion: String(initialize.result?.protocolVersion || ''), serverName: String(initialize.result?.serverInfo?.name || ''), toolCount: tools.length, categories }
}

function mcpRequests(options = {}) {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'exora-desktop-connectivity-test', version: '1.0.0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ]
  if (options.includeMarketplace !== false) requests.push({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'exora.search_operations', arguments: {} } })
  return requests
}

function probeMCPConnectivity(command, options = {}) {
  if (!Array.isArray(command) || !String(command[0] || '').trim()) return Promise.reject(new Error('MCP command is unavailable.'))
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 30000))
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd: options.cwd, env: options.env || process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', settled = false
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result) }
    const timer = setTimeout(() => { child.kill(); finish(new Error('MCP connectivity test timed out.')) }, timeoutMs)
    timer.unref?.()
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk }); child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => { if (code !== 0) return finish(new Error(redactMCPDetail(stderr))); try { finish(undefined, evaluateMCPResponses(stdout.split(/\r?\n/), options)) } catch (error) { finish(error) } })
    for (const request of mcpRequests(options)) child.stdin.write(`${JSON.stringify(request)}\n`)
    child.stdin.end()
  })
}

module.exports = { APPLICATION_SOURCES, REQUIRED_TOOLS, evaluateMCPResponses, probeMCPConnectivity, redactMCPDetail }
