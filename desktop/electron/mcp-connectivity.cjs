const { spawn } = require('node:child_process')

const APPLICATION_SOURCES = Object.freeze(['vm', 'resources', 'endpoint', 'api_bridge'])
const SECRET_PATTERN = /(?:sk-exora(?:-session)?|exora_owner_)-[A-Za-z0-9._-]+|exora_owner_[A-Za-z0-9._-]+/g

function redactMCPDetail(value) {
  return String(value || '').replace(SECRET_PATTERN, '[REDACTED]')
}

function evaluateMCPResponses(lines) {
  const responses = lines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) }
      catch (error) { throw new Error(`MCP returned invalid JSON: ${error.message}`) }
    })

  const byID = new Map(responses.filter((response) => response?.id !== undefined).map((response) => [Number(response.id), response]))
  const initialize = byID.get(1)
  if (!initialize) throw new Error('MCP initialize returned no response.')
  if (initialize.error) {
    throw new Error(`MCP initialize failed: ${redactMCPDetail(initialize.error.message || initialize.error.data)}`)
  }
  const connection = initialize.result?._meta?.exoraConnection
  if (!connection?.sessionId || !connection?.sessionKey) {
    throw new Error('MCP initialize did not issue a local Agent session.')
  }

  const toolResponse = byID.get(2)
  if (toolResponse?.error) throw new Error(`MCP tools/list failed: ${redactMCPDetail(toolResponse.error.message)}`)
  const tools = Array.isArray(toolResponse?.result?.tools) ? toolResponse.result.tools : []
  const names = new Set(tools.map((tool) => String(tool?.name || '')))
  for (const required of [
    'exora.search_products',
    'exora.purchase_compute_minutes',
    'exora.run_compute_command',
    'exora.purchase_download',
    'exora.create_download_transfer',
    'exora.invoke_operation',
    'exora.save_endpoint_draft',
    'exora.save_api_bridge_draft',
  ]) {
    if (!names.has(required)) throw new Error(`MCP tool surface is stale or incomplete: ${required} is missing.`)
  }

  const categories = APPLICATION_SOURCES.map((applicationSource, index) => {
    const response = byID.get(3 + index)
    if (!response) throw new Error(`MCP ${applicationSource} search returned no response.`)
    const detail = response.error?.message || response.error?.data || response.result?.content?.[0]?.text || ''
    if (response.error || response.result?.isError) {
      throw new Error(`MCP ${applicationSource} search failed: ${redactMCPDetail(detail)}`)
    }
    const payload = response.result?.structuredContent
    const collection = ['listings', 'items', 'products', 'data']
      .map((key) => payload?.[key])
      .find(Array.isArray)
    return { applicationSource, ok: true, itemCount: Array.isArray(collection) ? collection.length : undefined }
  })

  return {
    ok: true,
    protocolVersion: String(initialize.result?.protocolVersion || ''),
    serverName: String(initialize.result?.serverInfo?.name || ''),
    toolCount: tools.length,
    categories,
  }
}

function mcpRequests() {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'exora-desktop-connectivity-test', version: '1.0.0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ]
  for (const [index, applicationSource] of APPLICATION_SOURCES.entries()) {
    requests.push({ jsonrpc: '2.0', id: 3 + index, method: 'tools/call', params: { name: 'exora.search_products', arguments: { applicationSource } } })
  }
  return requests
}

function probeMCPConnectivity(command, options = {}) {
  if (!Array.isArray(command) || !String(command[0] || '').trim()) {
    return Promise.reject(new Error('MCP command is unavailable.'))
  }
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 30000))
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error(`MCP connectivity test timed out after ${Math.round(timeoutMs / 1000)} seconds.`))
    }, timeoutMs)
    timer.unref?.()
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => finish(new Error(`MCP process failed to start: ${error.message}`)))
    child.once('close', (code) => {
      if (code !== 0) {
        finish(new Error(`MCP process exited with ${code}: ${redactMCPDetail(stderr).trim()}`))
        return
      }
      try { finish(undefined, evaluateMCPResponses(stdout.split(/\r?\n/))) }
      catch (error) { finish(error) }
    })
    for (const request of mcpRequests()) child.stdin.write(`${JSON.stringify(request)}\n`)
    child.stdin.end()
  })
}

module.exports = {
  APPLICATION_SOURCES,
  evaluateMCPResponses,
  probeMCPConnectivity,
  redactMCPDetail,
}
