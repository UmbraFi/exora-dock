const assert = require('node:assert/strict')
const test = require('node:test')

const { RequestTimeoutError, fetchAndReadWithTimeout } = require('./network-timeout.cjs')

test('times out while a response body is still being received', async () => {
  let requestSignal
  const fetchImplementation = async (_url, options) => {
    requestSignal = options.signal
    return { arrayBuffer: () => new Promise(() => undefined) }
  }

  await assert.rejects(
    fetchAndReadWithTimeout('https://example.test/slow', {}, 15, (response) => response.arrayBuffer(), fetchImplementation),
    (error) => error instanceof RequestTimeoutError && error.code === 'REQUEST_TIMEOUT',
  )
  assert.equal(requestSignal.aborted, true)
})

test('returns both the response and its fully read body', async () => {
  const response = { ok: true, text: async () => 'ready' }
  const result = await fetchAndReadWithTimeout('https://example.test/ready', {}, 100, (value) => value.text(), async () => response)
  assert.equal(result.response, response)
  assert.equal(result.body, 'ready')
})

test('propagates an outer scan cancellation to the request body', async () => {
  const controller = new AbortController()
  let requestSignal
  const fetchImplementation = async (_url, options) => {
    requestSignal = options.signal
    return { arrayBuffer: () => new Promise(() => undefined) }
  }
  const reason = new Error('scan deadline reached')
  const pending = fetchAndReadWithTimeout('https://example.test/cancel', { signal: controller.signal }, 1000, (response) => response.arrayBuffer(), fetchImplementation)
  controller.abort(reason)

  await assert.rejects(pending, reason)
  assert.equal(requestSignal.aborted, true)
})
