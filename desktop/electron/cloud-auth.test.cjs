const assert = require('node:assert/strict')
const test = require('node:test')
const { createCloudAuth } = require('./cloud-auth.cjs')

function jsonResponse(status, value) {
  return new Response(value === undefined ? undefined : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function harness(routes, settings = {}) {
  let state = {}
  const requests = []
  const pinSets = []
  const broadcasts = []
  const safeStorage = settings.safeStorage || {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
  }
  const auth = createCloudAuth({
    safeStorage,
    isPackaged: false,
    envCloudURL: 'https://cloud.test',
    getPaths: async () => ({ rootDir: '/tmp/exora' }),
    readState: async () => state,
    writeState: async (_paths, value) => { state = value },
    configuredCloudURL: async () => '',
    randomUUID: () => 'fixed-install-id',
    deviceName: () => 'Test Dock',
    fetchImpl: async (url, options = {}) => {
      const request = { url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined, headers: options.headers || {} }
      requests.push(request)
      const key = `${request.method} ${new URL(url).pathname}`
      const handler = routes[key]
      if (!handler) throw new Error(`unexpected request ${key}`)
      return typeof handler === 'function' ? handler(request) : handler
    },
    getPINStatus: settings.getPINStatus || (async () => ({ paymentPin: { configured: true, boundAccountId: 'acct_1' } })),
    setPIN: settings.setPIN || (async (pin, accountId) => { pinSets.push({ pin, accountId }) }),
    verifyPIN: async () => ({ verified: true }),
    ensureDockLink: async ({ token, account }) => ({ linked: true, tokenSeen: Boolean(token), accountId: account.accountId }),
    clearDockLink: async () => undefined,
    broadcast: (value) => broadcasts.push(value),
  })
  return { auth, get state() { return state }, requests, pinSets, broadcasts }
}

test('registration keeps PIN out of Cloud and persists only an encrypted session', async () => {
  const routes = {
    'POST /v1/auth/registrations': jsonResponse(202, {
      challengeId: 'emc_1', email: 'user@example.com', expiresAt: '2026-07-14T12:10:00Z', resendAfter: '2026-07-14T12:01:00Z', devCode: '123456',
    }),
    'POST /v1/auth/registrations/emc_1/complete': jsonResponse(201, {
      account: { accountId: 'acct_1', email: 'user@example.com', emailVerifiedAt: '2026-07-14T12:00:00Z' },
      session: { sessionId: 'sess_1', expiresAt: '2026-08-13T12:00:00Z' },
      sessionToken: 'exora_sess_secret',
    }),
    'GET /v1/auth/providers': jsonResponse(200, { password: true, social: [] }),
    'GET /v1/me': jsonResponse(200, {
      account: { accountId: 'acct_1', email: 'user@example.com', emailVerifiedAt: '2026-07-14T12:00:00Z' },
      session: { sessionId: 'sess_1', expiresAt: '2026-08-13T12:00:00Z' },
    }),
  }
  const h = harness(routes)
  const challenge = await h.auth.registrationStart({ input: {
    email: 'user@example.com', password: 'long secure password', passwordConfirm: 'long secure password',
    pin: '123456', pinConfirm: '123456', locale: 'en',
  } })
  const result = await h.auth.registrationComplete({ input: { challengeId: challenge.challengeId, code: challenge.devCode } })
  assert.equal(result.phase, 'authenticated')
  assert.equal(result.sessionToken, undefined)
  assert.deepEqual(h.pinSets, [{ pin: '123456', accountId: 'acct_1' }])
  const completeRequest = h.requests.find((request) => request.url.includes('/complete'))
  assert.equal(completeRequest.body.pin, undefined)
  assert.equal(completeRequest.body.password, 'long secure password')
  assert.equal(h.state.cloudAuth.storageMode, 'safeStorage')
  assert.ok(h.state.cloudAuth.encryptedSession)
  assert.equal(JSON.stringify(h.state).includes('exora_sess_secret'), false)
})

test('safeStorage unavailability uses a process-only session', async () => {
  const routes = {
    'POST /v1/auth/sessions/password': jsonResponse(200, {
      account: { accountId: 'acct_1', email: 'user@example.com' },
      session: { sessionId: 'sess_1', expiresAt: '2026-08-13T12:00:00Z' },
      sessionToken: 'memory_only_token',
    }),
    'GET /v1/auth/providers': jsonResponse(200, { password: true, social: [] }),
    'GET /v1/me': jsonResponse(200, { account: { accountId: 'acct_1', email: 'user@example.com' }, session: { sessionId: 'sess_1' } }),
  }
  const h = harness(routes, { safeStorage: { isEncryptionAvailable: () => false } })
  const result = await h.auth.login({ input: { email: 'user@example.com', password: 'long secure password' } })
  assert.equal(result.authenticated, true)
  assert.equal(result.storageAvailable, false)
  assert.equal(h.state.cloudAuth.storageMode, 'session')
  assert.equal(h.state.cloudAuth.encryptedSession, undefined)
  assert.equal(JSON.stringify(h.state).includes('memory_only_token'), false)
})

test('a local PIN write failure preserves the Cloud account and enters needs_pin', async () => {
  let registrationCompletions = 0
  const routes = {
    'POST /v1/auth/registrations': jsonResponse(202, { challengeId: 'emc_2', email: 'pin@example.com', devCode: '123456' }),
    'POST /v1/auth/registrations/emc_2/complete': () => {
      registrationCompletions += 1
      return jsonResponse(201, {
        account: { accountId: 'acct_1', email: 'pin@example.com' }, session: { sessionId: 'sess_pin' }, sessionToken: 'pin_session_token',
      })
    },
  }
  const h = harness(routes, { setPIN: async () => { throw new Error('disk unavailable') } })
  const challenge = await h.auth.registrationStart({ input: {
    email: 'pin@example.com', password: 'long secure password', passwordConfirm: 'long secure password', pin: '123456', pinConfirm: '123456',
  } })
  const result = await h.auth.registrationComplete({ input: { challengeId: challenge.challengeId, code: challenge.devCode } })
  assert.equal(result.phase, 'needs_pin')
  assert.equal(result.authenticated, true)
  assert.equal(h.state.cloudAuth.account.accountId, 'acct_1')
  assert.equal(registrationCompletions, 1)
})

test('a 401 clears the encrypted session and broadcasts expiry', async () => {
  let meCalls = 0
  const routes = {
    'POST /v1/auth/sessions/password': jsonResponse(200, {
      account: { accountId: 'acct_1', email: 'user@example.com' }, session: { sessionId: 'sess_1' }, sessionToken: 'token',
    }),
    'GET /v1/auth/providers': jsonResponse(200, { password: true, social: [] }),
    'GET /v1/me': () => {
      meCalls += 1
      return meCalls === 1
        ? jsonResponse(200, { account: { accountId: 'acct_1', email: 'user@example.com' }, session: { sessionId: 'sess_1' } })
        : jsonResponse(401, { code: 'invalid_session', error: 'expired' })
    },
  }
  const h = harness(routes)
  await h.auth.login({ input: { email: 'user@example.com', password: 'long secure password' } })
  const result = await h.auth.status()
  assert.equal(result.phase, 'signed_out')
  assert.equal(h.state.cloudAuth, undefined)
  assert.ok(h.broadcasts.some((value) => value.reason === 'session_expired'))
})
