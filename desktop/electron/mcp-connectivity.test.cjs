const assert = require('node:assert/strict')
const test = require('node:test')
const { APPLICATION_SOURCES, REQUIRED_TOOLS, evaluateMCPResponses, redactMCPDetail } = require('./mcp-connectivity.cjs')

function responses(tools = REQUIRED_TOOLS) {
  return [
    JSON.stringify({ id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'exora-dock' }, _meta: { exoraConnection: { sessionId: 'session', scopes: ['market.read', 'api.invoke', 'account.read', 'provider.integrate'] } } } }),
    JSON.stringify({ id: 2, result: { tools: tools.map((name) => ({ name })) } }),
    JSON.stringify({ id: 3, result: { structuredContent: { operations: [] } } }),
  ]
}

test('accepts one API catalog and the V4 tool surface', () => {
  const result = evaluateMCPResponses(responses())
  assert.deepEqual(result.categories.map((item) => item.applicationSource), APPLICATION_SOURCES)
  assert.deepEqual(result.categories[0].deliveryModes, ['local_dock', 'cloud_direct'])
})

test('rejects missing or retired tools', () => {
  assert.throws(() => evaluateMCPResponses(responses(REQUIRED_TOOLS.slice(1))), /stale or incomplete/)
  assert.throws(() => evaluateMCPResponses(responses([...REQUIRED_TOOLS, 'exora.purchase_compute_minutes'])), /retired tools/)
})

test('redacts credentials', () => assert.equal(redactMCPDetail('sk-exora-session-secret'), '[REDACTED]'))

test('rejects initialize responses that expose session credentials', () => {
  const unsafe = responses()
  unsafe[0] = JSON.stringify({ id: 1, result: { protocolVersion: '2025-06-18', _meta: { exoraConnection: { sessionId: 'session', sessionKey: 'sk-exora-session-secret', scopes: [] } } } })
  assert.throws(() => evaluateMCPResponses(unsafe), /exposed an Agent session credential/)
})
