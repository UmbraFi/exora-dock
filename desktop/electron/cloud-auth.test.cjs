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
  const broadcasts = []
	let localPINClears = 0
  const safeStorage = settings.safeStorage || {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
  }
  const auth = createCloudAuth({
    safeStorage,
    isPackaged: settings.isPackaged === true,
    envCloudURL: settings.envCloudURL === undefined ? 'https://cloud.test' : settings.envCloudURL,
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
	  if (!handler && key === 'GET /v1/auth/payment-pin') return jsonResponse(200, { configured: true })
      if (!handler) throw new Error(`unexpected request ${key}`)
      return typeof handler === 'function' ? handler(request) : handler
    },
	clearLocalPIN: async () => { localPINClears += 1 },
    ensureDockLink: async ({ token, account }) => ({ linked: true, tokenSeen: Boolean(token), accountId: account.accountId }),
    clearDockLink: async () => undefined,
    broadcast: (value) => broadcasts.push(value),
  })
	return { auth, get state() { return state }, requests, get localPINClears() { return localPINClears }, broadcasts }
}

test('registration does not retain a PIN while email verification is pending', async () => {
	let pinConfigured = false
  const routes = {
    'POST /v1/auth/registrations': jsonResponse(202, {
      challengeId: 'emc_1', email: 'user@example.com', expiresAt: '2026-07-14T12:10:00Z', resendAfter: '2026-07-14T12:01:00Z', devCode: '123456',
    }),
    'POST /v1/auth/registrations/emc_1/complete': jsonResponse(201, {
      account: { accountId: 'acct_1', email: 'user@example.com', emailVerifiedAt: '2026-07-14T12:00:00Z' },
      session: { sessionId: 'sess_1', expiresAt: '2026-08-13T12:00:00Z' },
      sessionToken: 'exora_sess_secret',
    }),
	'GET /v1/auth/providers': () => jsonResponse(200, { password: true, social: [] }),
	'GET /v1/me': () => jsonResponse(200, {
      account: { accountId: 'acct_1', email: 'user@example.com', emailVerifiedAt: '2026-07-14T12:00:00Z' },
      session: { sessionId: 'sess_1', expiresAt: '2026-08-13T12:00:00Z' },
    }),
	'GET /v1/auth/payment-pin': () => jsonResponse(200, { configured: pinConfigured }),
	'PUT /v1/auth/payment-pin': () => {
	  pinConfigured = true
	  return jsonResponse(200, { configured: true })
	},
  }
  const h = harness(routes)
  const challenge = await h.auth.registrationStart({ input: {
    email: 'user@example.com', password: 'long secure password', passwordConfirm: 'long secure password',
	locale: 'en',
  } })
  const result = await h.auth.registrationComplete({ input: { challengeId: challenge.challengeId, code: challenge.devCode } })
	assert.equal(result.phase, 'needs_pin')
  assert.equal(result.sessionToken, undefined)
  const completeRequest = h.requests.find((request) => request.url.includes('/complete'))
  assert.equal(completeRequest.body.pin, undefined)
  assert.equal(completeRequest.body.password, 'long secure password')
	assert.equal(JSON.stringify(h.requests).includes('123456'), true, 'the email dev code is expected in the completion request')
	const afterPIN = await h.auth.setPIN({ input: { pin: '654321', pinConfirm: '654321' } })
	assert.equal(afterPIN.phase, 'authenticated')
	assert.equal(h.localPINClears, 1)
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

test('a Cloud PIN write failure preserves the verified Cloud account', async () => {
  let registrationCompletions = 0
  const routes = {
    'POST /v1/auth/registrations': jsonResponse(202, { challengeId: 'emc_2', email: 'pin@example.com', devCode: '123456' }),
    'POST /v1/auth/registrations/emc_2/complete': () => {
      registrationCompletions += 1
      return jsonResponse(201, {
        account: { accountId: 'acct_1', email: 'pin@example.com' }, session: { sessionId: 'sess_pin' }, sessionToken: 'pin_session_token',
      })
	},
	'GET /v1/auth/providers': jsonResponse(200, { password: true, social: [] }),
	'GET /v1/me': jsonResponse(200, { account: { accountId: 'acct_1', email: 'pin@example.com' }, session: { sessionId: 'sess_pin' } }),
	'GET /v1/auth/payment-pin': jsonResponse(200, { configured: false }),
	'PUT /v1/auth/payment-pin': jsonResponse(500, { code: 'pin_write_failed', error: 'Cloud PIN unavailable' }),
  }
	const h = harness(routes)
  const challenge = await h.auth.registrationStart({ input: {
	  email: 'pin@example.com', password: 'long secure password', passwordConfirm: 'long secure password',
  } })
  const result = await h.auth.registrationComplete({ input: { challengeId: challenge.challengeId, code: challenge.devCode } })
  assert.equal(result.phase, 'needs_pin')
  assert.equal(result.authenticated, true)
  assert.equal(h.state.cloudAuth.account.accountId, 'acct_1')
  assert.equal(registrationCompletions, 1)
	await assert.rejects(() => h.auth.setPIN({ input: { pin: '123456', pinConfirm: '123456' } }), /Cloud PIN unavailable/)
	assert.equal(h.state.cloudAuth.account.accountId, 'acct_1')
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

test('packaged builds default to the official API and never expose devCode', async () => {
  const routes = {
    'POST /v1/auth/registrations': jsonResponse(202, { challengeId: 'emc_prod', email: 'prod@example.com', devCode: '654321' }),
  }
  const h = harness(routes, { isPackaged: true, envCloudURL: '' })
  const challenge = await h.auth.registrationStart({ input: {
	  email: 'prod@example.com', password: 'long secure password', passwordConfirm: 'long secure password',
  } })
  assert.equal(new URL(h.requests[0].url).origin, 'https://api.exoradock.com')
  assert.equal(challenge.devCode, undefined)
})

test('offline logout stores an encrypted pending revocation and retries it', async () => {
  let revokeAttempts = 0
  const routes = {
    'POST /v1/auth/sessions/password': jsonResponse(200, {
      account: { accountId: 'acct_1', email: 'user@example.com' }, session: { sessionId: 'sess_1' }, sessionToken: 'token-to-revoke',
    }),
    'GET /v1/auth/providers': jsonResponse(200, { password: true, social: [] }),
    'GET /v1/me': jsonResponse(200, { account: { accountId: 'acct_1', email: 'user@example.com' }, session: { sessionId: 'sess_1' } }),
    'DELETE /v1/auth/sessions/current': () => {
      revokeAttempts += 1
      if (revokeAttempts === 1) throw new Error('offline')
      return jsonResponse(204)
    },
  }
  const h = harness(routes)
  await h.auth.login({ input: { email: 'user@example.com', password: 'long secure password' } })
  const result = await h.auth.logout()
  assert.equal(result.pendingRevocation, true)
  assert.equal(h.state.cloudAuth, undefined)
  assert.equal(h.state.pendingSessionRevocations.length, 1)
  assert.equal(JSON.stringify(h.state).includes('token-to-revoke'), false)
  const afterRetry = await h.auth.status({ validate: false })
  assert.equal(afterRetry.pendingRevocation, false)
  assert.equal(h.state.pendingSessionRevocations, undefined)
  assert.equal(revokeAttempts, 2)
})
