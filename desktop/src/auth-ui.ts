export type CloudAuthAccount = {
  accountId: string
  email: string
  emailVerifiedAt?: string
}

export type CloudAuthState = {
  phase: 'loading' | 'signed_out' | 'authenticated' | 'needs_pin' | 'dock_link_retry' | 'offline' | 'configuration_error'
  authenticated?: boolean
  offline?: boolean
  account?: CloudAuthAccount
  cloudURL?: string
  providers?: { password?: boolean; social?: Array<{ id: string; name: string; enabled?: boolean }> }
  storageAvailable?: boolean
  dock?: { linked?: boolean; error?: { code?: string; message?: string } }
  error?: { code?: string; message?: string; status?: number }
}

type Invoke = <T = unknown>(command: string, payload?: Record<string, unknown>) => Promise<T>
type AuthView = 'login' | 'register' | 'registration-code' | 'forgot' | 'reset-code' | 'pin' | 'pin-change' | 'pin-reset'

type AuthGateOptions = {
  invoke: Invoke
  language: () => 'en' | 'zh'
  onAuthenticated: (state: CloudAuthState) => void
  onSignedOut?: (state: CloudAuthState) => void
}

type Challenge = {
  challengeId: string
  email: string
  expiresAt?: string
  resendAfter?: string
  delivery?: string
  devCode?: string
}

export function createAuthGate(root: HTMLElement, options: AuthGateOptions) {
  const element = document.createElement('section')
  element.className = 'auth-gate'
  element.setAttribute('aria-live', 'polite')
  root.append(element)

  let view: AuthView = 'login'
  let status: CloudAuthState = { phase: 'loading' }
  let challenge: Challenge | undefined
  let resetEmail = ''
  let busy = false
  let message = ''
  let messageTone: 'error' | 'info' = 'info'
  let forceOpen = false
  let resendRemaining = 0
  let resendInterval: number | undefined

  const copy = () => options.language() === 'zh' ? zhCopy : enCopy

  function render() {
    const c = copy()
    element.classList.toggle('hidden', status.phase === 'authenticated' && !forceOpen)
    if (status.phase === 'loading') {
      element.innerHTML = authFrame(`<div class="auth-loading"><span class="auth-spinner"></span><p>${c.connecting}</p></div>`, c)
      return
    }
    if (status.phase === 'configuration_error') {
      element.innerHTML = authFrame(renderStateNotice(c.cloudConfiguration, status.error?.message || c.cloudConfigurationDetail, 'auth_retry', c.retry, c), c)
      bind()
      return
    }
    if (status.phase === 'needs_pin' || view === 'pin') {
      element.innerHTML = authFrame(renderPIN(c), c)
      bind()
      return
    }
    if (status.phase === 'dock_link_retry') {
      const detail = status.dock?.error?.message || status.error?.message || c.dockRetryDetail
      element.innerHTML = authFrame(renderStateNotice(c.dockRetry, detail, 'auth_retry', c.retry, c, true), c)
      bind()
      return
    }
    if (status.phase === 'offline' && status.authenticated) {
      element.innerHTML = authFrame(renderStateNotice(c.offlineTitle, c.offlineDetail, 'auth_retry', c.retry, c, true), c)
      bind()
      return
    }
    element.innerHTML = authFrame(renderCurrentView(c), c)
    bind()
  }

  function authFrame(content: string, c: typeof enCopy) {
    const warning = status.storageAvailable === false
      ? `<div class="auth-storage-warning">${c.memorySessionWarning}</div>`
      : ''
    return `
      <div class="auth-window-controls">
        <button type="button" data-auth-window="minimize" aria-label="${c.minimize}">−</button>
        <button type="button" data-auth-window="close" aria-label="${c.close}">×</button>
      </div>
      <div class="auth-backdrop-orb auth-orb-one"></div>
      <div class="auth-backdrop-orb auth-orb-two"></div>
      <div class="auth-panel">
        <header class="auth-brand">
          <div class="auth-brand-mark">E</div>
          <div><strong>Exora Dock</strong><span>${c.brandLine}</span></div>
        </header>
        ${warning}
        ${content}
        <footer class="auth-footer"><span>${c.localPinNote}</span><span>${status.cloudURL || ''}</span></footer>
      </div>
    `
  }

  function renderCurrentView(c: typeof enCopy) {
    if (view === 'pin-change') return renderPINChange(c)
    if (view === 'pin-reset') return renderPINReset(c)
    if (view === 'register') return renderRegister(c)
    if (view === 'registration-code') return renderRegistrationCode(c)
    if (view === 'forgot') return renderForgot(c)
    if (view === 'reset-code') return renderResetCode(c)
    return renderLogin(c)
  }

  function renderLogin(c: typeof enCopy) {
    const social = (status.providers?.social || []).filter((provider) => provider.enabled !== false)
    return `
      <div class="auth-heading"><span>${c.welcomeEyebrow}</span><h1>${c.signInTitle}</h1><p>${c.signInDetail}</p></div>
      ${renderMessage()}
      <form class="auth-form" data-auth-form="login">
        ${field('email', c.email, 'email', 'email', c.emailPlaceholder)}
        ${field('password', c.password, 'password', 'current-password', c.passwordPlaceholder)}
        <div class="auth-form-row"><label class="auth-check"><input type="checkbox" checked disabled> ${c.keepSignedIn}</label><button class="auth-link" type="button" data-auth-action="forgot">${c.forgotPassword}</button></div>
        <button class="auth-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? c.working : c.signIn}</button>
      </form>
      ${social.length ? `<div class="auth-divider"><span>${c.orContinue}</span></div><div class="auth-social">${social.map((provider) => `<button type="button" data-auth-social="${escapeAttr(provider.id)}">${escapeHTML(provider.name || provider.id)}</button>`).join('')}</div>` : ''}
      <p class="auth-switch">${c.noAccount} <button type="button" data-auth-action="register">${c.createAccount}</button></p>
    `
  }

  function renderRegister(c: typeof enCopy) {
    return `
      <button class="auth-back" type="button" data-auth-action="login">← ${c.backToSignIn}</button>
      <div class="auth-heading"><span>${c.registrationEyebrow}</span><h1>${c.createTitle}</h1><p>${c.createDetail}</p></div>
      ${renderMessage()}
      <form class="auth-form auth-form-register" data-auth-form="register">
        ${field('email', c.email, 'email', 'email', c.emailPlaceholder)}
        <div class="auth-field-grid">
          ${field('password', c.password, 'password', 'new-password', c.passwordRules)}
          ${field('passwordConfirm', c.confirmPassword, 'password', 'new-password', c.confirmPassword)}
        </div>
        <div class="auth-field-grid">
          ${field('pin', c.paymentPin, 'password', 'off', c.pinPlaceholder, 'numeric', 6)}
          ${field('pinConfirm', c.confirmPin, 'password', 'off', c.pinPlaceholder, 'numeric', 6)}
        </div>
        <div class="auth-pin-note"><strong>${c.pinStaysLocal}</strong><span>${c.pinDetail}</span></div>
        <button class="auth-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? c.sendingCode : c.verifyEmail}</button>
      </form>
      <p class="auth-switch">${c.haveAccount} <button type="button" data-auth-action="login">${c.signIn}</button></p>
    `
  }

  function renderRegistrationCode(c: typeof enCopy) {
    return renderCodeForm(c.verifyTitle, c.verifyDetail.replace('{email}', challenge?.email || ''), 'registration-code', c)
  }

  function renderForgot(c: typeof enCopy) {
    return `
      <button class="auth-back" type="button" data-auth-action="login">← ${c.backToSignIn}</button>
      <div class="auth-heading"><span>${c.resetEyebrow}</span><h1>${c.forgotTitle}</h1><p>${c.forgotDetail}</p></div>
      ${renderMessage()}
      <form class="auth-form" data-auth-form="forgot">
        ${field('email', c.email, 'email', 'email', c.emailPlaceholder)}
        <button class="auth-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? c.sendingCode : c.sendResetCode}</button>
      </form>
    `
  }

  function renderResetCode(c: typeof enCopy) {
    return `
      <button class="auth-back" type="button" data-auth-action="forgot">← ${c.changeEmail}</button>
      <div class="auth-heading"><span>${c.resetEyebrow}</span><h1>${c.resetTitle}</h1><p>${c.verifyDetail.replace('{email}', resetEmail)}</p></div>
      ${renderMessage()}
      <form class="auth-form" data-auth-form="reset-code">
        ${codeField(c)}
        ${field('newPassword', c.newPassword, 'password', 'new-password', c.passwordRules)}
        ${field('passwordConfirm', c.confirmPassword, 'password', 'new-password', c.confirmPassword)}
        <button class="auth-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? c.working : c.resetPassword}</button>
      </form>
      ${renderResend(c)}
    `
  }

  function renderCodeForm(title: string, detail: string, form: string, c: typeof enCopy) {
    return `
      <button class="auth-back" type="button" data-auth-action="register">← ${c.changeDetails}</button>
      <div class="auth-heading"><span>${c.emailVerification}</span><h1>${title}</h1><p>${detail}</p></div>
      ${renderMessage()}
      ${challenge?.devCode ? `<div class="auth-dev-code">${c.devCode}: <strong>${escapeHTML(challenge.devCode)}</strong></div>` : ''}
      <form class="auth-form" data-auth-form="${form}">
        ${codeField(c)}
        <button class="auth-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? c.working : c.continue}</button>
      </form>
      ${renderResend(c)}
    `
  }

  function renderPIN(c: typeof enCopy) {
    return `
      <div class="auth-heading"><span>${c.securityStep}</span><h1>${c.pinTitle}</h1><p>${c.pinSetupDetail}</p></div>
      ${renderMessage()}
      <form class="auth-form" data-auth-form="pin">
        ${field('pin', c.paymentPin, 'password', 'off', c.pinPlaceholder, 'numeric', 6)}
        ${field('pinConfirm', c.confirmPin, 'password', 'off', c.pinPlaceholder, 'numeric', 6)}
        <button class="auth-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? c.working : c.finishSetup}</button>
      </form>
      <button class="auth-secondary" type="button" data-auth-action="logout">${c.useAnotherAccount}</button>
    `
  }

  function renderPINChange(c: typeof enCopy) {
    return `
      <button class="auth-back" type="button" data-auth-action="close-pin">← ${c.backToWorkspace}</button>
      <div class="auth-heading"><span>${c.localSecurity}</span><h1>${c.changePinTitle}</h1><p>${c.changePinDetail}</p></div>
      ${renderMessage()}
      <form class="auth-form" data-auth-form="pin-change">
        ${field('currentPIN', c.currentPin, 'password', 'off', c.pinPlaceholder, 'numeric', 6)}
        <div class="auth-field-grid">
          ${field('newPIN', c.newPin, 'password', 'off', c.pinPlaceholder, 'numeric', 6)}
          ${field('pinConfirm', c.confirmPin, 'password', 'off', c.pinPlaceholder, 'numeric', 6)}
        </div>
        <button class="auth-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? c.working : c.changePin}</button>
      </form>
      <p class="auth-resend"><button type="button" data-auth-action="pin-reset">${c.forgotPin}</button></p>
    `
  }

  function renderPINReset(c: typeof enCopy) {
    return `
      <button class="auth-back" type="button" data-auth-action="pin-management">← ${c.backToPinChange}</button>
      <div class="auth-heading"><span>${c.passwordReauth}</span><h1>${c.resetPinTitle}</h1><p>${c.resetPinDetail}</p></div>
      ${renderMessage()}
      <form class="auth-form" data-auth-form="pin-reset">
        ${field('password', c.password, 'password', 'current-password', c.passwordPlaceholder)}
        <div class="auth-field-grid">
          ${field('newPIN', c.newPin, 'password', 'off', c.pinPlaceholder, 'numeric', 6)}
          ${field('pinConfirm', c.confirmPin, 'password', 'off', c.pinPlaceholder, 'numeric', 6)}
        </div>
        <button class="auth-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? c.working : c.resetPin}</button>
      </form>
    `
  }

  function renderStateNotice(title: string, detail: string, action: string, label: string, c: typeof enCopy, allowContinue = false) {
    return `
      <div class="auth-state-notice"><div class="auth-state-icon">!</div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(detail)}</p></div>
      ${renderMessage()}
      <button class="auth-primary" type="button" data-auth-action="${action}" ${busy ? 'disabled' : ''}>${busy ? c.working : label}</button>
      ${allowContinue ? `<button class="auth-secondary" type="button" data-auth-action="continue-limited">${c.continueLimited}</button>` : ''}
      ${status.authenticated ? `<button class="auth-link auth-centered" type="button" data-auth-action="logout">${c.signOut}</button>` : ''}
    `
  }

  function codeField(c: typeof enCopy) {
    return `<label class="auth-field"><span>${c.sixDigitCode}</span><input class="auth-code-input" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="••••••" required autofocus></label>`
  }

  function field(name: string, label: string, type: string, autocomplete: string, placeholder: string, inputmode = '', maxlength = 0) {
    return `<label class="auth-field"><span>${escapeHTML(label)}</span><input name="${name}" type="${type}" autocomplete="${autocomplete}" placeholder="${escapeAttr(placeholder)}" ${inputmode ? `inputmode="${inputmode}"` : ''} ${maxlength ? `maxlength="${maxlength}"` : ''} required></label>`
  }

  function renderResend(c: typeof enCopy) {
    const label = resendRemaining > 0 ? `${c.resend} (${resendRemaining}s)` : c.resend
    return `<p class="auth-resend">${c.didNotReceive} <button type="button" data-auth-action="resend" ${resendRemaining > 0 ? 'disabled' : ''}>${label}</button></p>`
  }

  function renderMessage() {
    if (!message) return ''
    return `<div class="auth-message ${messageTone}">${escapeHTML(message)}</div>`
  }

  function bind() {
    element.querySelectorAll<HTMLElement>('[data-auth-window]').forEach((button) => button.addEventListener('click', () => {
      void options.invoke(button.dataset.authWindow === 'minimize' ? 'window_minimize' : 'window_close')
    }))
    element.querySelectorAll<HTMLButtonElement>('[data-auth-action]').forEach((button) => button.addEventListener('click', () => void handleAction(button.dataset.authAction || '')))
    element.querySelectorAll<HTMLButtonElement>('[data-auth-social]').forEach((button) => button.addEventListener('click', () => void run(async () => {
      await options.invoke('auth_social_start', { input: { provider: button.dataset.authSocial, redirectUri: 'exora://auth/callback' } })
    })))
    element.querySelectorAll<HTMLFormElement>('[data-auth-form]').forEach((form) => form.addEventListener('submit', (event) => {
      event.preventDefault()
      void handleSubmit(form)
    }))
    updateResendButton()
  }

  async function handleAction(action: string) {
    if (action === 'login' || action === 'register' || action === 'forgot') {
      view = action
      message = ''
      render()
      return
    }
    if (action === 'pin-management' || action === 'pin-reset') {
      view = action === 'pin-reset' ? 'pin-reset' : 'pin-change'
      message = ''
      render()
      return
    }
    if (action === 'close-pin') {
      forceOpen = false
      message = ''
      render()
      return
    }
    if (action === 'logout') {
      await run(async () => applyState(await options.invoke<CloudAuthState>('auth_logout')))
      return
    }
    if (action === 'auth_retry') {
      await run(async () => applyState(await options.invoke<CloudAuthState>('auth_status')))
      return
    }
    if (action === 'continue-limited') {
      element.classList.add('hidden')
      options.onAuthenticated(status)
      return
    }
    if (action === 'resend') {
      await run(async () => {
        if (view === 'registration-code') {
          challenge = await options.invoke<Challenge>('auth_registration_start', { input: { resend: true, locale: options.language() } })
        } else {
          challenge = await options.invoke<Challenge>('auth_password_reset_start', { input: { email: resetEmail, locale: options.language() } })
        }
        scheduleResend(challenge)
        messageTone = 'info'
        message = copy().codeResent
      })
    }
  }

  async function handleSubmit(form: HTMLFormElement) {
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>
    const formName = form.dataset.authForm
    if (formName === 'login') {
      await run(async () => applyState(await options.invoke<CloudAuthState>('auth_login', { input: data })))
      return
    }
    if (formName === 'register') {
      await run(async () => {
        challenge = await options.invoke<Challenge>('auth_registration_start', { input: { ...data, locale: options.language() } })
        scheduleResend(challenge)
        form.reset()
        view = 'registration-code'
      })
      return
    }
    if (formName === 'registration-code') {
      await run(async () => applyState(await options.invoke<CloudAuthState>('auth_registration_complete', { input: { challengeId: challenge?.challengeId, code: data.code } })))
      return
    }
    if (formName === 'forgot') {
      await run(async () => {
        resetEmail = data.email.trim().toLowerCase()
        challenge = await options.invoke<Challenge>('auth_password_reset_start', { input: { email: resetEmail, locale: options.language() } })
        scheduleResend(challenge)
        form.reset()
        view = 'reset-code'
      })
      return
    }
    if (formName === 'reset-code') {
      await run(async () => applyState(await options.invoke<CloudAuthState>('auth_password_reset_complete', { input: {
        ...data, email: resetEmail, challengeId: challenge?.challengeId,
      } })))
      return
    }
    if (formName === 'pin') {
      await run(async () => applyState(await options.invoke<CloudAuthState>('auth_pin_set', { input: data })))
      return
    }
    if (formName === 'pin-change') {
      await run(async () => applyState(await options.invoke<CloudAuthState>('auth_pin_change', { input: data })))
      return
    }
    if (formName === 'pin-reset') {
      await run(async () => applyState(await options.invoke<CloudAuthState>('auth_pin_reset', { input: data })))
    }
  }

  async function run(task: () => Promise<void>) {
    if (busy) return
    busy = true
    message = ''
    render()
    try {
      await task()
    } catch (error) {
      messageTone = 'error'
      message = humanError(error)
    } finally {
      busy = false
      render()
    }
  }

  function applyState(next: CloudAuthState) {
    status = next
    if (next.phase === 'authenticated') {
      message = ''
      forceOpen = false
      element.classList.add('hidden')
      options.onAuthenticated(next)
      return
    }
    if (next.phase === 'signed_out') {
      view = 'login'
      options.onSignedOut?.(next)
    }
    if (next.phase === 'needs_pin') view = 'pin'
    render()
  }

  async function initialize() {
    render()
    try {
      applyState(await options.invoke<CloudAuthState>('auth_status'))
    } catch (error) {
      status = { phase: 'signed_out', error: { message: humanError(error) } }
      messageTone = 'error'
      message = humanError(error)
      render()
    }
    return status
  }

  function refreshLanguage() {
    render()
  }

  function scheduleResend(next?: Challenge) {
    if (resendInterval) window.clearInterval(resendInterval)
    const resendAt = new Date(String(next?.resendAfter || '')).getTime()
    resendRemaining = Number.isFinite(resendAt) ? Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)) : 0
    if (resendRemaining <= 0) return
    resendInterval = window.setInterval(() => {
      resendRemaining = Math.max(0, resendRemaining - 1)
      updateResendButton()
      if (resendRemaining === 0 && resendInterval) {
        window.clearInterval(resendInterval)
        resendInterval = undefined
      }
    }, 1000)
  }

  function updateResendButton() {
    const button = element.querySelector<HTMLButtonElement>('[data-auth-action="resend"]')
    if (!button) return
    button.disabled = resendRemaining > 0
    button.textContent = resendRemaining > 0 ? `${copy().resend} (${resendRemaining}s)` : copy().resend
  }

  function openPINSettings() {
    if (!status.authenticated) return
    forceOpen = true
    view = 'pin-change'
    message = ''
    render()
  }

  return Object.freeze({ initialize, applyState, refreshLanguage, openPINSettings, get state() { return status } })
}

function humanError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Authentication failed.')
  return message.replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/i, '')
}

function escapeHTML(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character)
}

function escapeAttr(value: unknown) {
  return escapeHTML(value).replace(/`/g, '&#96;')
}

const enCopy = {
  brandLine: 'Your private agent workspace', connecting: 'Connecting securely…', minimize: 'Minimize', close: 'Close',
  welcomeEyebrow: 'WELCOME BACK', signInTitle: 'Sign in to Exora', signInDetail: 'Continue to your agents, marketplace, and local workspace.',
  email: 'Email address', emailPlaceholder: 'you@example.com', password: 'Password', passwordPlaceholder: 'Enter your password',
  keepSignedIn: 'Securely keep me signed in', forgotPassword: 'Forgot password?', signIn: 'Sign in', working: 'Please wait…',
  noAccount: 'New to Exora?', createAccount: 'Create an account', orContinue: 'or continue with',
  backToSignIn: 'Back to sign in', registrationEyebrow: 'CREATE YOUR ACCOUNT', createTitle: 'Set up Exora Dock',
  createDetail: 'Verify your email, choose a strong password, and protect local payments with a six-digit PIN.',
  confirmPassword: 'Confirm password', passwordRules: '10–128 characters', paymentPin: 'Six-digit payment PIN', confirmPin: 'Confirm PIN',
  pinPlaceholder: '6 digits', pinStaysLocal: 'Your PIN stays on this device.', pinDetail: 'It is Argon2id-hashed locally and is never sent to Exora Cloud.',
  sendingCode: 'Sending code…', verifyEmail: 'Verify email', haveAccount: 'Already have an account?',
  verifyTitle: 'Check your inbox', verifyDetail: 'Enter the six-digit code sent to {email}.', emailVerification: 'EMAIL VERIFICATION',
  changeDetails: 'Change details', sixDigitCode: 'Verification code', continue: 'Continue', didNotReceive: 'Did not receive the code?', resend: 'Resend', codeResent: 'A new code was sent.', devCode: 'Development code',
  resetEyebrow: 'ACCOUNT RECOVERY', forgotTitle: 'Reset your password', forgotDetail: 'We will send a one-time code to your verified email address.',
  sendResetCode: 'Send reset code', changeEmail: 'Change email', resetTitle: 'Choose a new password', newPassword: 'New password', resetPassword: 'Reset password',
  securityStep: 'LOCAL SECURITY', pinTitle: 'Protect local payments', pinSetupDetail: 'This account needs a six-digit PIN before the workspace can open.', finishSetup: 'Finish setup', useAnotherAccount: 'Use another account',
  cloudConfiguration: 'Cloud configuration required', cloudConfigurationDetail: 'Set EXORA_CLOUD_URL to your production HTTPS endpoint.', retry: 'Retry',
  dockRetry: 'Signed in — Dock link needs attention', dockRetryDetail: 'Exora could not finish linking the local Dock. Retry now or continue in limited mode.',
  offlineTitle: 'Exora Cloud is offline', offlineDetail: 'Your encrypted session is intact. Continue with local features or retry the connection.', continueLimited: 'Continue in limited mode',
  signOut: 'Sign out', memorySessionWarning: 'Secure system storage is unavailable. This login lasts only until Exora Dock closes.',
  localPinNote: 'Passwords stay in Cloud. Payment PIN stays local.',
  backToWorkspace: 'Back to workspace', localSecurity: 'LOCAL SECURITY', changePinTitle: 'Change payment PIN', changePinDetail: 'Confirm the current local PIN before choosing a replacement.',
  currentPin: 'Current PIN', newPin: 'New PIN', changePin: 'Change PIN', forgotPin: 'Forgot your PIN?', backToPinChange: 'Back to PIN change',
  passwordReauth: 'PASSWORD CONFIRMATION', resetPinTitle: 'Reset local PIN', resetPinDetail: 'Confirm your Cloud password, then choose a new six-digit PIN.', resetPin: 'Reset PIN',
}

const zhCopy: typeof enCopy = {
  brandLine: '你的私有智能体工作空间', connecting: '正在安全连接…', minimize: '最小化', close: '关闭',
  welcomeEyebrow: '欢迎回来', signInTitle: '登录 Exora', signInDetail: '继续使用智能体、市场和本地工作空间。',
  email: '邮箱地址', emailPlaceholder: 'you@example.com', password: '密码', passwordPlaceholder: '输入密码',
  keepSignedIn: '安全地保持登录', forgotPassword: '忘记密码？', signIn: '登录', working: '请稍候…',
  noAccount: '第一次使用 Exora？', createAccount: '创建账号', orContinue: '或使用以下方式继续',
  backToSignIn: '返回登录', registrationEyebrow: '创建你的账号', createTitle: '设置 Exora Dock',
  createDetail: '验证邮箱、设置安全密码，并使用六位 PIN 保护本地支付。',
  confirmPassword: '确认密码', passwordRules: '10–128 个字符', paymentPin: '六位支付 PIN', confirmPin: '确认 PIN',
  pinPlaceholder: '6 位数字', pinStaysLocal: 'PIN 只保存在这台设备。', pinDetail: 'PIN 使用 Argon2id 在本地加密哈希，永远不会发送到 Exora Cloud。',
  sendingCode: '正在发送验证码…', verifyEmail: '验证邮箱', haveAccount: '已经有账号？',
  verifyTitle: '检查你的邮箱', verifyDetail: '请输入发送至 {email} 的六位验证码。', emailVerification: '邮箱认证',
  changeDetails: '修改注册信息', sixDigitCode: '验证码', continue: '继续', didNotReceive: '没有收到验证码？', resend: '重新发送', codeResent: '新的验证码已经发送。', devCode: '开发验证码',
  resetEyebrow: '账号恢复', forgotTitle: '重置密码', forgotDetail: '我们会向已验证邮箱发送一次性验证码。',
  sendResetCode: '发送重置验证码', changeEmail: '修改邮箱', resetTitle: '设置新密码', newPassword: '新密码', resetPassword: '重置密码',
  securityStep: '本地安全', pinTitle: '保护本地支付', pinSetupDetail: '进入工作空间前，需要为当前账号设置六位 PIN。', finishSetup: '完成设置', useAnotherAccount: '使用其他账号',
  cloudConfiguration: '需要配置 Cloud', cloudConfigurationDetail: '请将 EXORA_CLOUD_URL 设置为生产环境 HTTPS 地址。', retry: '重试',
  dockRetry: '已登录，但 Dock 绑定需要处理', dockRetryDetail: '暂时无法完成本地 Dock 绑定。你可以重试，或进入受限模式。',
  offlineTitle: 'Exora Cloud 暂时离线', offlineDetail: '加密会话仍然保留。你可以使用本地功能，或重试连接。', continueLimited: '进入受限模式',
  signOut: '退出登录', memorySessionWarning: '系统安全存储不可用，本次登录将在关闭 Exora Dock 后失效。',
  localPinNote: '密码保存在 Cloud，支付 PIN 只保存在本机。',
  backToWorkspace: '返回工作空间', localSecurity: '本地安全', changePinTitle: '修改支付 PIN', changePinDetail: '请先验证当前本地 PIN，再设置新的六位 PIN。',
  currentPin: '当前 PIN', newPin: '新 PIN', changePin: '修改 PIN', forgotPin: '忘记 PIN？', backToPinChange: '返回修改 PIN',
  passwordReauth: '密码确认', resetPinTitle: '重置本地 PIN', resetPinDetail: '验证 Cloud 密码后，设置新的六位 PIN。', resetPin: '重置 PIN',
}
