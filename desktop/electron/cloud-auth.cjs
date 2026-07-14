const DEFAULT_CLOUD_URL = 'http://127.0.0.1:8090'

class CloudAuthError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'CloudAuthError'
    this.code = options.code || 'cloud_auth_error'
    this.status = Number(options.status || 0)
    this.network = options.network === true
  }
}

function createCloudAuth(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('Cloud auth requires fetch')
  const now = options.now || (() => new Date())
  const randomUUID = options.randomUUID || (() => require('node:crypto').randomUUID())
  let memorySession = ''
  let pendingRegistration

  async function pathsAndState() {
    const paths = await options.getPaths()
    const state = await options.readState(paths)
    return { paths, state }
  }

  async function installationID(paths, state) {
    let id = String(state.installationId || '').trim()
    if (id) return id
    id = `install_${randomUUID()}`
    state.installationId = id
    await options.writeState(paths, state)
    return id
  }

  async function resolveCloudURL(paths, state) {
    const environmentURL = String(typeof options.envCloudURL === 'function' ? options.envCloudURL() : options.envCloudURL || '').trim()
    const configuredURL = String(await options.configuredCloudURL?.(paths, state) || '').trim()
    const candidate = environmentURL || configuredURL || (options.isPackaged ? '' : DEFAULT_CLOUD_URL)
    if (!candidate) throw new CloudAuthError('Exora Cloud HTTPS URL is not configured.', { code: 'cloud_not_configured' })
    let parsed
    try { parsed = new URL(candidate) } catch { throw new CloudAuthError('Exora Cloud URL is invalid.', { code: 'cloud_url_invalid' }) }
    if (options.isPackaged && parsed.protocol !== 'https:') {
      throw new CloudAuthError('Packaged Exora Dock requires an HTTPS Cloud URL.', { code: 'cloud_https_required' })
    }
    return parsed.toString().replace(/\/$/, '')
  }

  async function request(cloudURL, method, route, body, token, timeoutMs = 15000) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetchImpl(`${cloudURL}${route}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      })
    } catch (error) {
      const timedOut = error?.name === 'AbortError'
      throw new CloudAuthError(timedOut ? 'Exora Cloud request timed out.' : 'Exora Cloud is unavailable.', {
        code: timedOut ? 'cloud_timeout' : 'cloud_unavailable', network: true,
      })
    } finally {
      clearTimeout(timeout)
    }
    const text = await response.text()
    let decoded = {}
    try { decoded = text.trim() ? JSON.parse(text) : {} } catch { decoded = { error: text.trim() } }
    if (!response.ok) {
      throw new CloudAuthError(String(decoded?.error || response.statusText || 'Cloud authentication failed.'), {
        code: String(decoded?.code || `cloud_http_${response.status}`), status: response.status,
      })
    }
    return decoded
  }

  function encryptionAvailable() {
    try { return options.safeStorage?.isEncryptionAvailable?.() === true } catch { return false }
  }

  async function loadSession(state) {
    if (memorySession) return memorySession
    const record = state.cloudAuth || {}
    if (record.storageMode !== 'safeStorage' || !record.encryptedSession || !encryptionAvailable()) return ''
    try {
      return options.safeStorage.decryptString(Buffer.from(String(record.encryptedSession), 'base64'))
    } catch {
      return ''
    }
  }

  async function persistSession(paths, state, cloudURL, result) {
    const token = String(result?.sessionToken || '').trim()
    const account = sanitizeAccount(result?.account)
    if (!token || !account) throw new CloudAuthError('Cloud did not return a valid native session.', { code: 'invalid_session_response' })
    const record = {
      account,
      cloudURL,
      expiresAt: String(result?.session?.expiresAt || result?.expiresAt || ''),
      sessionId: String(result?.session?.sessionId || ''),
      storageMode: encryptionAvailable() ? 'safeStorage' : 'session',
      updatedAt: now().toISOString(),
    }
    if (record.storageMode === 'safeStorage') {
      record.encryptedSession = options.safeStorage.encryptString(token).toString('base64')
      memorySession = ''
    } else {
      memorySession = token
    }
    state.cloudAuth = record
    await options.writeState(paths, state)
    return { token, account, record }
  }

  async function clearLocalSession(paths, state) {
    memorySession = ''
    delete state.cloudAuth
    await options.writeState(paths, state)
  }

  async function providers(cloudURL) {
    try {
      const result = await request(cloudURL, 'GET', '/v1/auth/providers')
      return { password: result.password !== false, social: Array.isArray(result.social) ? result.social : [] }
    } catch {
      return { password: true, social: [] }
    }
  }

  async function snapshot(settings = {}) {
    const { paths, state } = await pathsAndState()
    let cloudURL
    try {
      cloudURL = await resolveCloudURL(paths, state)
    } catch (error) {
      return publicState({ phase: 'configuration_error', error, storageAvailable: encryptionAvailable() })
    }
    const providerResult = await providers(cloudURL)
    const token = await loadSession(state)
    const cachedAccount = sanitizeAccount(state.cloudAuth?.account)
    if (!token) {
      return publicState({ phase: 'signed_out', cloudURL, providers: providerResult, storageAvailable: encryptionAvailable() })
    }
    let account = cachedAccount
    try {
      if (settings.validate !== false) {
        const me = await request(cloudURL, 'GET', '/v1/me', undefined, token)
        account = sanitizeAccount(me.account)
        if (!account) throw new CloudAuthError('Cloud account response is invalid.', { code: 'invalid_account_response' })
        state.cloudAuth.account = account
        state.cloudAuth.expiresAt = String(me.session?.expiresAt || state.cloudAuth.expiresAt || '')
        await options.writeState(paths, state)
      }
    } catch (error) {
      if (error.status === 401) {
        await clearLocalSession(paths, state)
        await options.clearDockLink?.(paths)
        options.broadcast?.({ phase: 'signed_out', reason: 'session_expired' })
        return publicState({ phase: 'signed_out', cloudURL, providers: providerResult, error, storageAvailable: encryptionAvailable() })
      }
      if (error.network && account) {
        return publicState({ phase: 'offline', authenticated: true, offline: true, account, cloudURL, providers: providerResult, storageAvailable: encryptionAvailable() })
      }
      throw error
    }
    if (!account) {
      await clearLocalSession(paths, state)
      return publicState({ phase: 'signed_out', cloudURL, providers: providerResult, storageAvailable: encryptionAvailable() })
    }

    let pinStatus = { configured: false }
    try { pinStatus = normalizePINStatus(await options.getPINStatus?.()) } catch {}
    if (!pinStatus.configured || !pinStatus.boundAccountId || pinStatus.boundAccountId !== account.accountId) {
      return publicState({
        phase: 'needs_pin', authenticated: true, account, cloudURL, providers: providerResult,
        pinStatus, storageAvailable: encryptionAvailable(),
      })
    }

    let dock = { linked: false }
    if (settings.linkDock !== false) {
      try {
        const installID = await installationID(paths, state)
        dock = await options.ensureDockLink?.({ paths, state, cloudURL, token, account, installationID: installID }) || { linked: true }
      } catch (error) {
        return publicState({
          phase: 'dock_link_retry', authenticated: true, account, cloudURL, providers: providerResult,
          pinStatus, dock: { linked: false, error: safeError(error) }, storageAvailable: encryptionAvailable(),
        })
      }
    }
    return publicState({
      phase: 'authenticated', authenticated: true, account, cloudURL, providers: providerResult,
      pinStatus, dock, storageAvailable: encryptionAvailable(),
    })
  }

  async function registrationStart(payload = {}) {
    const input = payload.input || payload
    if (input.resend === true) {
      if (!pendingRegistration || now().getTime() - pendingRegistration.createdAt > 15 * 60 * 1000) {
        pendingRegistration = undefined
        throw new CloudAuthError('Registration expired. Start registration again.', { code: 'registration_context_expired' })
      }
      const result = await request(pendingRegistration.cloudURL, 'POST', '/v1/auth/registrations', {
        email: pendingRegistration.email, locale: normalizeLocale(input.locale),
      })
      pendingRegistration.challengeId = String(result.challengeId || '')
      pendingRegistration.createdAt = now().getTime()
      return sanitizeChallenge(result)
    }
    const email = String(input.email || '').trim().toLowerCase()
    const password = String(input.password || '')
    const passwordConfirm = String(input.passwordConfirm || '')
    const pin = String(input.pin || '').trim()
    const pinConfirm = String(input.pinConfirm || '').trim()
    validateRegistrationInput(email, password, passwordConfirm, pin, pinConfirm)
    const { paths, state } = await pathsAndState()
    const cloudURL = await resolveCloudURL(paths, state)
    const result = await request(cloudURL, 'POST', '/v1/auth/registrations', { email, locale: normalizeLocale(input.locale) })
    pendingRegistration = {
      challengeId: String(result.challengeId || ''), email, password, pin, cloudURL,
      createdAt: now().getTime(),
    }
    return sanitizeChallenge(result)
  }

  async function registrationComplete(payload = {}) {
    const input = payload.input || payload
    const challengeID = String(input.challengeId || '').trim()
    if (!pendingRegistration || pendingRegistration.challengeId !== challengeID || now().getTime() - pendingRegistration.createdAt > 15 * 60 * 1000) {
      pendingRegistration = undefined
      throw new CloudAuthError('Registration expired. Start registration again.', { code: 'registration_context_expired' })
    }
    const { paths, state } = await pathsAndState()
    const installID = await installationID(paths, state)
    const result = await request(pendingRegistration.cloudURL, 'POST', `/v1/auth/registrations/${encodeURIComponent(challengeID)}/complete`, {
      email: pendingRegistration.email,
      code: String(input.code || '').trim(),
      password: pendingRegistration.password,
      clientKind: 'electron', deviceId: installID, deviceName: String(options.deviceName?.() || 'Exora Dock'),
    })
    const session = await persistSession(paths, state, pendingRegistration.cloudURL, result)
    const pin = pendingRegistration.pin
    pendingRegistration = undefined
    try {
      await options.setPIN?.(pin, session.account.accountId)
    } catch (error) {
      const resultState = publicState({ phase: 'needs_pin', authenticated: true, account: session.account, cloudURL: session.record.cloudURL, error })
      options.broadcast?.(resultState)
      return resultState
    }
    const resultState = await snapshot()
    options.broadcast?.(resultState)
    return resultState
  }

  async function login(payload = {}) {
    const input = payload.input || payload
    const email = String(input.email || '').trim().toLowerCase()
    const password = String(input.password || '')
    if (!email || !password) throw new CloudAuthError('Email and password are required.', { code: 'credentials_required' })
    const { paths, state } = await pathsAndState()
    const cloudURL = await resolveCloudURL(paths, state)
    const installID = await installationID(paths, state)
    const result = await request(cloudURL, 'POST', '/v1/auth/sessions/password', {
      email, password, clientKind: 'electron', deviceId: installID, deviceName: String(options.deviceName?.() || 'Exora Dock'),
    })
    await persistSession(paths, state, cloudURL, result)
    const resultState = await snapshot()
    options.broadcast?.(resultState)
    return resultState
  }

  async function passwordResetStart(payload = {}) {
    const input = payload.input || payload
    const email = String(input.email || '').trim().toLowerCase()
    if (!email) throw new CloudAuthError('Email is required.', { code: 'email_required' })
    const { paths, state } = await pathsAndState()
    const cloudURL = await resolveCloudURL(paths, state)
    return sanitizeChallenge(await request(cloudURL, 'POST', '/v1/auth/password-resets', { email, locale: normalizeLocale(input.locale) }))
  }

  async function passwordResetComplete(payload = {}) {
    const input = payload.input || payload
    const email = String(input.email || '').trim().toLowerCase()
    const challengeID = String(input.challengeId || '').trim()
    const newPassword = String(input.newPassword || '')
    const confirm = String(input.passwordConfirm || '')
    if (newPassword !== confirm) throw new CloudAuthError('Passwords do not match.', { code: 'password_mismatch' })
    validatePassword(newPassword)
    const { paths, state } = await pathsAndState()
    const cloudURL = await resolveCloudURL(paths, state)
    const installID = await installationID(paths, state)
    const result = await request(cloudURL, 'POST', `/v1/auth/password-resets/${encodeURIComponent(challengeID)}/complete`, {
      email, code: String(input.code || '').trim(), newPassword,
      clientKind: 'electron', deviceId: installID, deviceName: String(options.deviceName?.() || 'Exora Dock'),
    })
    await persistSession(paths, state, cloudURL, result)
    const resultState = await snapshot()
    options.broadcast?.(resultState)
    return resultState
  }

  async function setPIN(payload = {}) {
    const input = payload.input || payload
    const pin = String(input.pin || '').trim()
    const confirmation = String(input.pinConfirm || '').trim()
    if (!/^\d{6}$/.test(pin)) throw new CloudAuthError('PIN must be exactly 6 digits.', { code: 'invalid_pin' })
    if (pin !== confirmation) throw new CloudAuthError('PINs do not match.', { code: 'pin_mismatch' })
    const { state } = await pathsAndState()
    const account = sanitizeAccount(state.cloudAuth?.account)
    if (!account || !await loadSession(state)) throw new CloudAuthError('Sign in before setting a PIN.', { code: 'session_required' })
    await options.setPIN?.(pin, account.accountId)
    const resultState = await snapshot()
    options.broadcast?.(resultState)
    return resultState
  }

  async function changePIN(payload = {}) {
    const input = payload.input || payload
    const { state } = await pathsAndState()
    const account = sanitizeAccount(state.cloudAuth?.account)
    if (!account) throw new CloudAuthError('Sign in before changing a PIN.', { code: 'session_required' })
    await options.verifyPIN?.(String(input.currentPIN || '').trim(), account.accountId)
    return setPIN({ input: { pin: input.newPIN, pinConfirm: input.pinConfirm } })
  }

  async function resetPIN(payload = {}) {
    const input = payload.input || payload
    const { paths, state } = await pathsAndState()
    const token = await loadSession(state)
    const account = sanitizeAccount(state.cloudAuth?.account)
    if (!token || !account) throw new CloudAuthError('Sign in before resetting a PIN.', { code: 'session_required' })
    const cloudURL = await resolveCloudURL(paths, state)
    await request(cloudURL, 'POST', '/v1/auth/reauth/password', { password: String(input.password || '') }, token)
    return setPIN({ input: { pin: input.newPIN, pinConfirm: input.pinConfirm } })
  }

  async function logout() {
    const { paths, state } = await pathsAndState()
    const token = await loadSession(state)
    let cloudURL = ''
    try { cloudURL = await resolveCloudURL(paths, state) } catch {}
    if (token && cloudURL) {
      try { await request(cloudURL, 'DELETE', '/v1/auth/sessions/current', undefined, token) } catch {}
    }
    await clearLocalSession(paths, state)
    await options.clearDockLink?.(paths)
    pendingRegistration = undefined
    const result = publicState({ phase: 'signed_out', cloudURL, storageAvailable: encryptionAvailable() })
    options.broadcast?.(result)
    return result
  }

  async function socialStart(payload = {}) {
    const input = payload.input || payload
    const { paths, state } = await pathsAndState()
    const cloudURL = await resolveCloudURL(paths, state)
    return request(cloudURL, 'POST', `/v1/auth/social/${encodeURIComponent(String(input.provider || ''))}/start`, input)
  }

  async function socialComplete(payload = {}) {
    const input = payload.input || payload
    const { paths, state } = await pathsAndState()
    const cloudURL = await resolveCloudURL(paths, state)
    const installID = await installationID(paths, state)
    const result = await request(cloudURL, 'POST', `/v1/auth/social/${encodeURIComponent(String(input.provider || ''))}/complete`, {
      ...input, clientKind: 'electron', deviceId: installID, deviceName: String(options.deviceName?.() || 'Exora Dock'),
    })
    await persistSession(paths, state, cloudURL, result)
    return snapshot()
  }

  async function connection() {
    const { paths, state } = await pathsAndState()
    const cloudURL = await resolveCloudURL(paths, state)
    const token = await loadSession(state)
    if (!token) throw new CloudAuthError('Sign in to Exora Cloud first.', { code: 'session_required' })
    return { cloudURL, token, account: sanitizeAccount(state.cloudAuth?.account) }
  }

  async function unauthorized() {
    const { paths, state } = await pathsAndState()
    await clearLocalSession(paths, state)
    await options.clearDockLink?.(paths)
    options.broadcast?.({ phase: 'signed_out', reason: 'session_expired' })
  }

  return Object.freeze({
    status: snapshot,
    registrationStart,
    registrationComplete,
    login,
    passwordResetStart,
    passwordResetComplete,
    setPIN,
    changePIN,
    resetPIN,
    logout,
    socialStart,
    socialComplete,
    connection,
    unauthorized,
  })
}

function sanitizeAccount(value) {
  if (!value || typeof value !== 'object') return undefined
  const accountId = String(value.accountId || '').trim()
  const email = String(value.email || '').trim().toLowerCase()
  if (!accountId || !email) return undefined
  return { accountId, email, emailVerifiedAt: String(value.emailVerifiedAt || '') }
}

function normalizePINStatus(value) {
  const status = value?.paymentPin || value || {}
  return {
    configured: status.configured === true,
    boundAccountId: String(status.boundAccountId || ''),
    updatedAt: String(status.updatedAt || ''),
  }
}

function publicState(value = {}) {
  const error = value.error ? safeError(value.error) : undefined
  return {
    phase: value.phase || 'signed_out',
    authenticated: value.authenticated === true,
    offline: value.offline === true,
    account: sanitizeAccount(value.account),
    cloudURL: String(value.cloudURL || ''),
    providers: value.providers || { password: true, social: [] },
    pinStatus: value.pinStatus,
    dock: value.dock,
    storageAvailable: value.storageAvailable !== false,
    error,
  }
}

function safeError(error) {
  return {
    code: String(error?.code || 'cloud_auth_error'),
    message: String(error?.message || error || 'Authentication failed.'),
    status: Number(error?.status || 0),
  }
}

function sanitizeChallenge(value) {
  return {
    challengeId: String(value?.challengeId || ''),
    email: String(value?.email || ''),
    expiresAt: String(value?.expiresAt || ''),
    resendAfter: String(value?.resendAfter || ''),
    delivery: String(value?.delivery || 'email'),
    ...(value?.devCode ? { devCode: String(value.devCode) } : {}),
  }
}

function validateRegistrationInput(email, password, confirmation, pin, pinConfirmation) {
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new CloudAuthError('Enter a valid email address.', { code: 'invalid_email' })
  validatePassword(password)
  if (password !== confirmation) throw new CloudAuthError('Passwords do not match.', { code: 'password_mismatch' })
  if (!/^\d{6}$/.test(pin)) throw new CloudAuthError('PIN must be exactly 6 digits.', { code: 'invalid_pin' })
  if (pin !== pinConfirmation) throw new CloudAuthError('PINs do not match.', { code: 'pin_mismatch' })
}

function validatePassword(password) {
  const length = Array.from(password).length
  if (length < 10 || length > 128 || Buffer.byteLength(password, 'utf8') > 1024) {
    throw new CloudAuthError('Password must be between 10 and 128 characters.', { code: 'password_policy' })
  }
}

function normalizeLocale(locale) {
  return String(locale || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

module.exports = {
  CloudAuthError,
  DEFAULT_CLOUD_URL,
  createCloudAuth,
  sanitizeAccount,
}
