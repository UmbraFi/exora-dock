const assert = require('node:assert/strict')
const test = require('node:test')
const { APPLICATION_SOURCES, evaluateMCPResponses, redactMCPDetail } = require('./mcp-connectivity.cjs')

function successfulResponses() {
  return [
    JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'exora-dock' }, _meta: { exoraConnection: { sessionId: 'ases_test', sessionKey: 'sk-exora-session-secret' } } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [
      'exora.search_products', 'exora.purchase_compute_minutes', 'exora.run_compute_command',
      'exora.purchase_download', 'exora.create_download_transfer', 'exora.invoke_operation',
      'exora.save_endpoint_draft', 'exora.save_api_bridge_draft',
    ].map((name) => ({ name })) } }),
    ...APPLICATION_SOURCES.map((_source, index) => JSON.stringify({ jsonrpc: '2.0', id: 3 + index, result: { structuredContent: { listings: [] }, content: [{ type: 'text', text: '{}' }] } })),
  ]
}

test('accepts an initialized MCP session and all four category searches', () => {
  const result = evaluateMCPResponses(successfulResponses())
  assert.equal(result.ok, true)
  assert.equal(result.protocolVersion, '2025-06-18')
  assert.deepEqual(result.categories.map((category) => category.applicationSource), APPLICATION_SOURCES)
  assert.ok(result.categories.every((category) => category.ok))
})

test('rejects a health-only or stale MCP tool surface', () => {
  const lines = successfulResponses()
  const tools = JSON.parse(lines[1])
  tools.result.tools = tools.result.tools.filter((tool) => tool.name !== 'exora.run_compute_command')
  lines[1] = JSON.stringify(tools)
  assert.throws(() => evaluateMCPResponses(lines), /tool surface is stale or incomplete/)
})

test('redacts local and account credentials from failures', () => {
  assert.equal(redactMCPDetail('Bearer sk-exora-session-secret and exora_owner_secret'), 'Bearer [REDACTED] and [REDACTED]')
})
