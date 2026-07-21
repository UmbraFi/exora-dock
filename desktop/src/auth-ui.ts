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
  providers?: { password?: boolean }
  storageAvailable?: boolean
  dock?: { linked?: boolean; error?: { code?: string; message?: string } }
  error?: { code?: string; message?: string; status?: number }
}

type Invoke = <T = unknown>(command: string, payload?: Record<string, unknown>) => Promise<T>
type AuthView = 'login' | 'register' | 'registration-code' | 'forgot' | 'reset-code' | 'pin-change' | 'pin-reset' | 'pin-reset-code'

type AuthGateOptions = {
  invoke: Invoke
  language: () => 'en' | 'zh'
  setLanguage?: (language: 'en' | 'zh') => void
  onVisibilityChange?: (visible: boolean) => void
  onAuthenticated: (state: CloudAuthState) => Promise<void>
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

const authFeatureImages = [
  './auth-lowpoly-hero-v2.png',
  './auth-feature-02-device-market.png',
  './auth-feature-03-download-market.png',
  './auth-feature-04-local-openapi.png',
  './auth-feature-05-api-rules.png',
] as const

const authFeaturePlacements = ['bottom-right', 'top-right', 'bottom-right', 'bottom-right', 'top-left'] as const
const authFeatureAutoAdvanceMs = 6_000
export function createAuthGate(root: HTMLElement, options: AuthGateOptions) {
  const element = document.createElement('section')
  element.className = 'auth-gate'
  element.setAttribute('aria-live', 'polite')
  let authGateVisible: boolean | undefined

  function setAuthGateVisible(visible: boolean) {
    if (authGateVisible === visible) return
    options.onVisibilityChange?.(visible)
    element.classList.toggle('hidden', !visible)
    authGateVisible = visible
  }

  setAuthGateVisible(true)
  root.append(element)

  let view: AuthView = 'login'
  let status: CloudAuthState = { phase: 'loading' }
  let challenge: Challenge | undefined
  let resetEmail = ''
	let pinResetPassword = ''
  let busy = false
  let message = ''
  let messageTone: 'error' | 'info' = 'info'
  let forceOpen = false
  let languageMenuOpen = false
  let activeFeatureIndex = 0
  let featureObserver: IntersectionObserver | undefined
  let featureAutoScrollTimer: number | undefined
  let resendRemaining = 0
  let resendInterval: number | undefined
  let workspaceOpening = false
  let workspaceError = ''
  let workspaceTransition: Promise<void> | undefined
  let workspaceTransitionGeneration = 0

  const copy = () => options.language() === 'zh' ? zhCopy : enCopy

  element.addEventListener('invalid', (event) => event.preventDefault(), true)

  element.addEventListener('pointerdown', (event) => {
    if (!languageMenuOpen) return
    const target = event.target
    if (target instanceof Element && target.closest('.auth-language-control')) return
    closeLanguageMenu()
  })

  function render() {
    const c = copy()
    featureObserver?.disconnect()
    featureObserver = undefined
    clearFeatureAutoScroll()
    const workspaceSession = status.phase === 'authenticated' || status.phase === 'needs_pin'
    setAuthGateVisible(!(workspaceSession && !forceOpen && !workspaceOpening && !workspaceError))
    if (workspaceOpening) {
      element.innerHTML = authFrame(`<div class="auth-loading"><span class="auth-spinner"></span><p>${c.openingWorkspace}</p></div>`, c)
      bind()
      return
    }
    if (workspaceError) {
      element.innerHTML = authFrame(renderStateNotice(c.workspaceUnavailable, workspaceError, 'workspace-retry', c.retry, c), c)
      bind()
      return
    }
    if (status.phase === 'loading') {
      element.innerHTML = authFrame(`<div class="auth-loading"><span class="auth-spinner"></span><p>${c.connecting}</p></div>`, c)
      bind()
      return
    }
    if (status.phase === 'configuration_error') {
      element.innerHTML = authFrame(renderStateNotice(c.cloudConfiguration, status.error?.message || c.cloudConfigurationDetail, 'auth_retry', c.retry, c), c)
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

  function renderShowcase(c: typeof enCopy) {
    const slides = c.features.map((feature, index) => {
      const number = String(index + 1).padStart(2, '0')
      const tags = feature.tags.map((tag) => `<li>${escapeHTML(tag)}</li>`).join('')
      const route = feature.route.map((step, routeIndex) => `${routeIndex ? '<i aria-hidden="true">→</i>' : ''}<span>${escapeHTML(step)}</span>`).join('')
      return `
        <section class="auth-feature-slide auth-feature-${authFeaturePlacements[index]}" data-auth-feature-index="${index}" aria-labelledby="auth-feature-title-${index}">
          <img class="auth-feature-image" src="${authFeatureImages[index]}" alt="${escapeAttr(feature.imageAlt)}" />
          <div class="auth-feature-shade" aria-hidden="true"></div>
          <div class="auth-feature-copy">
            <div class="auth-feature-kicker"><strong>${number}</strong><span>${escapeHTML(feature.eyebrow)}</span></div>
            <h2 id="auth-feature-title-${index}">${escapeHTML(feature.title)}</h2>
            <p>${escapeHTML(feature.detail)}</p>
            <ul class="auth-feature-tags" aria-label="${escapeAttr(c.featureCapabilitiesLabel)}">${tags}</ul>
            <div class="auth-feature-route" aria-label="${escapeAttr(feature.routeLabel)}">${route}</div>
          </div>
        </section>
      `
    }).join('')
    const navigation = c.features.map((feature, index) => {
      const number = String(index + 1).padStart(2, '0')
      return `<button type="button" data-auth-feature-target="${index}" aria-label="${escapeAttr(`${c.featureGoTo} ${number}: ${feature.title}`)}" aria-current="${index === activeFeatureIndex ? 'step' : 'false'}"><span></span></button>`
    }).join('')
    return `
      <aside class="auth-showcase" aria-label="${escapeAttr(c.featureShowcaseLabel)}">
        <div class="auth-feature-scroll" tabindex="0">${slides}</div>
        <header class="auth-brand auth-showcase-brand">
          <img class="auth-brand-mark" src="./favicon.svg" alt="" />
          <div><strong>Exora Dock</strong><span>${escapeHTML(c.brandLine)}</span></div>
        </header>
        <nav class="auth-feature-navigation" aria-label="${escapeAttr(c.featureNavigationLabel)}">
          <div class="auth-feature-count" aria-live="polite"><strong data-auth-feature-current>${String(activeFeatureIndex + 1).padStart(2, '0')}</strong><i>/</i><span>05</span></div>
          <div class="auth-feature-dots">${navigation}</div>
        </nav>
      </aside>
    `
  }

  function authFrame(content: string, c: typeof enCopy) {
    const warning = status.storageAvailable === false
      ? `<div class="auth-storage-warning">${c.memorySessionWarning}</div>`
      : ''
    const currentLanguage = options.language()
    return `
      <div class="top-window-drag-strip auth-top-window-drag-strip" aria-hidden="true"></div>
      <div class="auth-window-controls">
        <button type="button" data-auth-window="minimize" aria-label="${c.minimize}">−</button>
        <button type="button" data-auth-window="close" aria-label="${c.close}">×</button>
      </div>
      <div class="auth-shell">
        ${renderShowcase(c)}
        <main class="auth-workspace">
          <div class="auth-workspace-toolbar">
            <div class="auth-language-control ${languageMenuOpen ? 'open' : ''}">
              <button class="auth-language-trigger" type="button" data-auth-action="language-menu" aria-label="${c.switchLanguage}" aria-haspopup="listbox" aria-expanded="${languageMenuOpen}">
                ${languageIcon()}
              </button>
              <div class="auth-language-drawer" role="listbox" aria-label="${c.switchLanguage}">
                <button class="${currentLanguage === 'en' ? 'selected' : ''}" type="button" data-auth-language="en" role="option" aria-selected="${currentLanguage === 'en'}">
                  <span>English</span><small>EN</small><i aria-hidden="true">✓</i>
                </button>
                <button class="${currentLanguage === 'zh' ? 'selected' : ''}" type="button" data-auth-language="zh" role="option" aria-selected="${currentLanguage === 'zh'}">
                  <span>简体中文</span><small>中</small><i aria-hidden="true">✓</i>
                </button>
              </div>
            </div>
          </div>
          <div class="auth-panel">
            <header class="auth-brand auth-mobile-brand">
              <img class="auth-brand-mark" src="./favicon.svg" alt="" />
              <div><strong>Exora Dock</strong><span>${c.brandLine}</span></div>
            </header>
            ${warning}
            ${content}
            <footer class="auth-footer"><span>${c.securityFooter}</span><span>${status.cloudURL || ''}</span></footer>
          </div>
        </main>
      </div>
    `
  }

  function renderCurrentView(c: typeof enCopy) {
    if (view === 'pin-change') return renderPINChange(c)
    if (view === 'pin-reset') return renderPINReset(c)
	if (view === 'pin-reset-code') return renderPINResetCode(c)
    if (view === 'register') return renderRegister(c)
    if (view === 'registration-code') return renderRegistrationCode(c)
    if (view === 'forgot') return renderForgot(c)
    if (view === 'reset-code') return renderResetCode(c)
    return renderLogin(c)
  }

  function renderLogin(c: typeof enCopy) {
    return `
      <div class="auth-heading"><span>${c.welcomeEyebrow}</span><h1>${c.signInTitle}</h1><p>${c.signInDetail}</p></div>
      ${renderMessage()}
      <form class="auth-form" data-auth-form="login">
        ${field('email', c.email, 'email', 'email', c.emailPlaceholder)}
        ${field('password', c.password, 'password', 'current-password', c.passwordPlaceholder)}
        <div class="auth-form-row"><span class="auth-session-note">${shieldIcon()} ${c.keepSignedIn}</span><button class="auth-link" type="button" data-auth-action="forgot">${c.forgotPassword}</button></div>
        <button class="auth-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? c.working : c.signIn}</button>
        <button class="auth-secondary auth-register-button" type="button" data-auth-action="register">${c.createAccount}</button>
      </form>
      <div class="auth-security-note">${shieldIcon()}<span><strong>${c.securityNoticeTitle}</strong><small>${c.securityNoticeDetail}</small></span></div>
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

  function renderPINChange(c: typeof enCopy) {
    return `
      <button class="auth-back" type="button" data-auth-action="close-pin">← ${c.backToWorkspace}</button>
      <div class="auth-heading"><span>${c.accountSecurity}</span><h1>${c.changePinTitle}</h1><p>${c.changePinDetail}</p></div>
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
		<button class="auth-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? c.sendingCode : c.sendResetCode}</button>
      </form>
    `
  }

	function renderPINResetCode(c: typeof enCopy) {
	  return `
		<button class="auth-back" type="button" data-auth-action="pin-reset">鈫?${c.backToPinChange}</button>
		<div class="auth-heading"><span>${c.emailVerification}</span><h1>${c.resetPinTitle}</h1><p>${c.verifyDetail.replace('{email}', challenge?.email || status.account?.email || '')}</p></div>
		${renderMessage()}
		<form class="auth-form" data-auth-form="pin-reset-code">
		  ${codeField(c)}
		  <div class="auth-field-grid">
			${field('newPIN', c.newPin, 'password', 'off', c.pinPlaceholder, 'numeric', 6)}
			${field('pinConfirm', c.confirmPin, 'password', 'off', c.pinPlaceholder, 'numeric', 6)}
		  </div>
		  <button class="auth-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? c.working : c.resetPin}</button>
		</form>
		${renderResend(c)}
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
    const c = copy()
    const isPassword = type === 'password'
    const icon = type === 'email' ? mailIcon() : lockIcon()
    return `<label class="auth-field"><span>${escapeHTML(label)}</span><div class="auth-input-wrap"><span class="auth-input-icon" aria-hidden="true">${icon}</span><input name="${name}" type="${type}" autocomplete="${autocomplete}" placeholder="${escapeAttr(placeholder)}" ${inputmode ? `inputmode="${inputmode}"` : ''} ${maxlength ? `maxlength="${maxlength}"` : ''} required>${isPassword ? `<button class="auth-password-toggle" type="button" data-auth-toggle-password aria-label="${c.showPassword}">${eyeIcon(false)}</button>` : ''}</div></label>`
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
    element.querySelectorAll<HTMLButtonElement>('[data-auth-language]').forEach((button) => button.addEventListener('click', () => {
      const nextLanguage = button.dataset.authLanguage
      if (nextLanguage !== 'en' && nextLanguage !== 'zh') return
      languageMenuOpen = false
      if (nextLanguage === options.language()) {
        render()
        return
      }
      if (options.setLanguage) options.setLanguage(nextLanguage)
      else render()
    }))
    element.querySelector<HTMLElement>('.auth-language-control')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !languageMenuOpen) return
      event.preventDefault()
      closeLanguageMenu()
      element.querySelector<HTMLButtonElement>('.auth-language-trigger')?.focus()
    })
    element.querySelectorAll<HTMLButtonElement>('[data-auth-toggle-password]').forEach((button) => button.addEventListener('click', () => {
      const input = button.closest('.auth-input-wrap')?.querySelector<HTMLInputElement>('input')
      if (!input) return
      const reveal = input.type === 'password'
      input.type = reveal ? 'text' : 'password'
      button.innerHTML = eyeIcon(reveal)
      button.setAttribute('aria-label', reveal ? copy().hidePassword : copy().showPassword)
    }))
    element.querySelectorAll<HTMLFormElement>('[data-auth-form]').forEach((form) => {
      form.noValidate = true
      form.addEventListener('input', (event) => {
        const input = event.target
        if (!(input instanceof HTMLInputElement) || !input.validity.valid) return
        input.removeAttribute('aria-invalid')
      })
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        const invalidControl = form.querySelector<HTMLInputElement>('input:invalid')
        if (invalidControl) {
          invalidControl.setAttribute('aria-invalid', 'true')
          invalidControl.focus({ preventScroll: true })
          return
        }
        void handleSubmit(form)
      })
    })
    setupFeatureShowcase()
    updateResendButton()
  }

  function setupFeatureShowcase() {
    const scroller = element.querySelector<HTMLElement>('.auth-feature-scroll')
    if (!scroller) return
    const showcase = scroller.closest<HTMLElement>('.auth-showcase')
    const slides = Array.from(scroller.querySelectorAll<HTMLElement>('[data-auth-feature-index]'))
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('[data-auth-feature-target]'))
    const current = element.querySelector<HTMLElement>('[data-auth-feature-current]')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const setActiveFeature = (index: number) => {
      const nextIndex = Math.max(0, Math.min(slides.length - 1, index))
      if (!Number.isFinite(nextIndex)) return
      activeFeatureIndex = nextIndex
      if (current) current.textContent = String(nextIndex + 1).padStart(2, '0')
      buttons.forEach((button, buttonIndex) => button.setAttribute('aria-current', buttonIndex === nextIndex ? 'step' : 'false'))
      slides.forEach((slide, slideIndex) => slide.classList.toggle('active', slideIndex === nextIndex))
    }

    const scrollToFeature = (index: number, smooth = true) => {
      const slide = slides[index]
      if (!slide) return
      setActiveFeature(index)
      scroller.scrollTo({ top: slide.offsetTop, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' })
    }

    const scheduleAutoScroll = () => {
      clearFeatureAutoScroll()
      if (reduceMotion || slides.length < 2 || element.classList.contains('hidden')) return
      if (showcase?.matches(':hover') || showcase?.contains(document.activeElement)) return
      featureAutoScrollTimer = window.setTimeout(() => {
        featureAutoScrollTimer = undefined
        if (!document.hidden) scrollToFeature((activeFeatureIndex + 1) % slides.length)
        scheduleAutoScroll()
      }, authFeatureAutoAdvanceMs)
    }

    buttons.forEach((button) => button.addEventListener('click', () => {
      scrollToFeature(Number(button.dataset.authFeatureTarget))
      scheduleAutoScroll()
    }))
    scroller.addEventListener('keydown', (event) => {
      let nextIndex = activeFeatureIndex
      if (event.key === 'ArrowDown' || event.key === 'PageDown') nextIndex += 1
      else if (event.key === 'ArrowUp' || event.key === 'PageUp') nextIndex -= 1
      else if (event.key === 'Home') nextIndex = 0
      else if (event.key === 'End') nextIndex = slides.length - 1
      else return
      event.preventDefault()
      scrollToFeature(Math.max(0, Math.min(slides.length - 1, nextIndex)))
      scheduleAutoScroll()
    })
    showcase?.addEventListener('pointerenter', clearFeatureAutoScroll)
    showcase?.addEventListener('pointerleave', scheduleAutoScroll)
    showcase?.addEventListener('focusin', clearFeatureAutoScroll)
    showcase?.addEventListener('focusout', () => window.requestAnimationFrame(scheduleAutoScroll))

    if ('IntersectionObserver' in window) {
      featureObserver = new IntersectionObserver((entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.6)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        const index = Number((visible?.target as HTMLElement | undefined)?.dataset.authFeatureIndex)
        if (Number.isFinite(index)) setActiveFeature(index)
      }, { root: scroller, threshold: [0.6] })
      slides.forEach((slide) => featureObserver?.observe(slide))
    } else {
      let frame = 0
      scroller.addEventListener('scroll', () => {
        window.cancelAnimationFrame(frame)
        frame = window.requestAnimationFrame(() => setActiveFeature(Math.round(scroller.scrollTop / Math.max(1, scroller.clientHeight))))
      }, { passive: true })
    }

    window.requestAnimationFrame(() => {
      const savedSlide = slides[Math.max(0, Math.min(slides.length - 1, activeFeatureIndex))]
      if (savedSlide) scroller.scrollTop = savedSlide.offsetTop
      setActiveFeature(activeFeatureIndex)
      scheduleAutoScroll()
    })
  }

  function clearFeatureAutoScroll() {
    if (featureAutoScrollTimer === undefined) return
    window.clearTimeout(featureAutoScrollTimer)
    featureAutoScrollTimer = undefined
  }

  async function handleAction(action: string) {
    if (action === 'language-menu') {
      languageMenuOpen = !languageMenuOpen
      render()
      if (languageMenuOpen) {
        window.requestAnimationFrame(() => element.querySelector<HTMLButtonElement>('.auth-language-drawer > button.selected')?.focus())
      }
      return
    }
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
      await enterWorkspace(status)
      return
    }
    if (action === 'workspace-retry') {
      if (status.phase === 'authenticated' || (status.phase === 'offline' && status.authenticated)) await enterWorkspace(status, true)
      else { workspaceError = ''; await initialize() }
      return
    }
	if (action === 'resend') {
      await run(async () => {
        if (view === 'registration-code') {
          challenge = await options.invoke<Challenge>('auth_registration_start', { input: { resend: true, locale: options.language() } })
		} else if (view === 'pin-reset-code') {
		  challenge = await options.invoke<Challenge>('auth_pin_reset', { input: { password: pinResetPassword, locale: options.language() } })
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
    if (formName === 'pin-change') {
      await run(async () => applyState(await options.invoke<CloudAuthState>('auth_pin_change', { input: data })))
      return
    }
	if (formName === 'pin-reset') {
	  await run(async () => {
		pinResetPassword = data.password
		challenge = await options.invoke<Challenge>('auth_pin_reset', { input: { password: data.password, locale: options.language() } })
		scheduleResend(challenge)
		form.reset()
		view = 'pin-reset-code'
	  })
	  return
	}
	if (formName === 'pin-reset-code') {
	  await run(async () => {
		const next = await options.invoke<CloudAuthState>('auth_pin_reset', { input: { ...data, challengeId: challenge?.challengeId } })
		pinResetPassword = ''
		await applyState(next)
	  })
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

  async function applyState(next: CloudAuthState) {
    status = next
    if (next.phase === 'authenticated' || next.phase === 'needs_pin') {
      await enterWorkspace(next)
      return
    }
    if (next.phase === 'signed_out') {
      cancelWorkspaceTransition()
      view = 'login'
      options.onSignedOut?.(next)
    }
    render()
  }

  async function initialize() {
    render()
    try {
      await applyState(await options.invoke<CloudAuthState>('auth_status'))
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

  function closeLanguageMenu() {
    languageMenuOpen = false
    const control = element.querySelector<HTMLElement>('.auth-language-control')
    control?.classList.remove('open')
    control?.querySelector<HTMLButtonElement>('.auth-language-trigger')?.setAttribute('aria-expanded', 'false')
  }

  function openPINSettings() {
    if (!status.authenticated) return
    forceOpen = true
    view = 'pin-change'
    message = ''
    render()
  }

  function openPINReset() {
    if (!status.authenticated) return
    forceOpen = true
    view = 'pin-reset'
    message = ''
    render()
  }

  function openPasswordReset() {
    if (!status.authenticated) return
    forceOpen = true
    resetEmail = status.account?.email || ''
    view = 'forgot'
    message = ''
    render()
  }

  async function enterWorkspace(next: CloudAuthState, retry = false) {
    if (workspaceTransition && !retry) return workspaceTransition
    status = next
    return startWorkspaceTransition(() => options.onAuthenticated(next))
  }

  function startWorkspaceTransition(task: () => Promise<void>) {
    const generation = ++workspaceTransitionGeneration
    workspaceOpening = true
    workspaceError = ''
    message = ''
    forceOpen = false
    languageMenuOpen = false
    render()
    const transition = task().then(() => {
      if (generation !== workspaceTransitionGeneration) return
      workspaceOpening = false
      workspaceError = ''
      setAuthGateVisible(false)
      clearFeatureAutoScroll()
    }).catch((error) => {
      if (generation !== workspaceTransitionGeneration) return
      workspaceOpening = false
      workspaceError = humanError(error)
      render()
      throw error
    }).finally(() => {
      if (workspaceTransition === transition) workspaceTransition = undefined
    })
    workspaceTransition = transition
    return transition
  }

  function cancelWorkspaceTransition() {
    workspaceTransitionGeneration += 1
    workspaceTransition = undefined
    workspaceOpening = false
    workspaceError = ''
  }

  return Object.freeze({ initialize, applyState, refreshLanguage, openPINSettings, openPINReset, openPasswordReset, get state() { return status } })
}

function mailIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>'
}

function languageIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>'
}

function lockIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
}

function eyeIcon(revealed: boolean) {
  return revealed
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 18 18"/><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7"/><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5.2 9 8a8.7 8.7 0 0 1-2 3.7M6.6 6.6C4.3 8.1 3 10.4 3 12c0 2.8 3.5 8 9 8 1.5 0 2.9-.4 4.1-1"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.8 12S6.3 6 12 6s9.2 6 9.2 6-3.5 6-9.2 6-9.2-6-9.2-6Z"/><circle cx="12" cy="12" r="2.4"/></svg>'
}

function shieldIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.7 2.8 8.2 7 10 4.2-1.8 7-5.3 7-10V6l-7-3Z"/><path d="m9.2 12 1.8 1.8 3.9-4"/></svg>'
}

function humanError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Authentication failed.')
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^CloudAuthError:\s*/i, '')
    .replace(/^Error:\s*/i, '')
}

function escapeHTML(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character)
}

function escapeAttr(value: unknown) {
  return escapeHTML(value).replace(/`/g, '&#96;')
}

const enCopy = {
  brandLine: 'Your private agent workspace', connecting: 'Connecting securely…', openingWorkspace: 'Opening your workspace…', workspaceUnavailable: 'Workspace could not open', minimize: 'Minimize', close: 'Close',
  switchLanguage: 'Switch language', featureShowcaseLabel: 'Five ways to use Exora Dock', featureNavigationLabel: 'Feature navigation',
  featureCapabilitiesLabel: 'Core capabilities', featureGoTo: 'Go to feature',
  features: [
    {
      eyebrow: 'AGENT API MARKET', title: 'Connect your Agent to commercial APIs.',
      detail: 'Search, compare, and invoke paid APIs through Exora MCP—without building a new integration for every provider.',
      tags: ['Agent-ready catalog', 'Clear pricing', 'One invocation flow'], route: ['Your Agent', 'Exora MCP', 'Commercial APIs'],
      routeLabel: 'Your Agent through Exora MCP to commercial APIs', imageAlt: 'Low-poly Agent connected through Exora Dock to a network of commercial API providers.',
    },
    {
      eyebrow: 'LOCAL DOCK DELIVERY', title: 'Serve paid APIs from your own machine.',
      detail: 'Keep your implementation and data on hardware you control. Exora Dock exposes only the operations you approve—without public hosting.',
      tags: ['Runs locally', 'Human approval', 'No public hosting'], route: ['Local project', 'Secure Dock', 'Agent callers'],
      routeLabel: 'Local project through a secure Exora Dock to Agent callers', imageAlt: 'Several low-poly computers securely delivering local APIs to an Agent network.',
    },
    {
      eyebrow: 'SECURE ARTIFACTS', title: 'Move API inputs and outputs safely.',
      detail: 'Transfer large files as expiring Artifacts with exact sizes and SHA-256 integrity—outside JSON bodies and event streams.',
      tags: ['SHA-256 verified', 'Expiring access', 'Large-file delivery'], route: ['Input Artifact', 'Paid invocation', 'Output Artifact'],
      routeLabel: 'Input Artifact through a paid API invocation to an output Artifact', imageAlt: 'A secure low-poly Artifact vault exchanging verified API inputs and outputs with Agents.',
    },
    {
      eyebrow: 'AGENT-ASSISTED BUILD', title: 'Turn a local project into OpenAPI.',
      detail: 'Let your existing Agent follow Exora’s staged MCP to inspect authorized sources and generate an isolated Exora Adapter, OpenAPI 3.1 contract, health checks, and tests for your approval.',
      tags: ['Read-only Agent', 'Isolated output', 'Human-approved launch'], route: ['Local project', 'Agent-assisted build', 'OpenAPI listing'],
      routeLabel: 'Local project through an Agent-assisted build to an OpenAPI listing', imageAlt: 'Local project tools passing through Exora Dock and becoming standardized OpenAPI operations.',
    },
    {
      eyebrow: 'API COMMERCE CONTROLS', title: 'Sell any API with built-in controls.',
      detail: 'Bring an API you already operate. Exora adds operation policies, metering, pricing, access control, and automatic refunds for delivery failures.',
      tags: ['Operation policies', 'Metering & pricing', 'Automatic refunds'], route: ['Existing API', 'Exora controls', 'Agent market'],
      routeLabel: 'Existing API through Exora commerce controls to the Agent market', imageAlt: 'Different low-poly API connectors passing through commerce controls and emerging as uniform Agent market endpoints.',
    },
  ],
  welcomeEyebrow: 'WELCOME BACK', signInTitle: 'Sign in to Exora', signInDetail: 'Continue to your agents, marketplace, and local workspace.',
  email: 'Email address', emailPlaceholder: 'you@example.com', password: 'Password', passwordPlaceholder: 'Enter your password',
  keepSignedIn: 'Secure session on this device', forgotPassword: 'Forgot password?', signIn: 'Sign in', working: 'Please wait…',
  showPassword: 'Show password', hidePassword: 'Hide password', securityNoticeTitle: 'Account and payment security', securityNoticeDetail: 'Sign-in credentials and payment PIN are managed by Exora Cloud. Sensitive actions still require verification.',
  noAccount: 'New to Exora?', createAccount: 'Create an account', orContinue: 'or continue with',
  backToSignIn: 'Back to sign in', registrationEyebrow: 'CREATE YOUR ACCOUNT', createTitle: 'Set up Exora Dock',
  createDetail: 'Verify your email and choose a strong password. You will set a six-digit payment PIN after verification.',
  confirmPassword: 'Confirm password', passwordRules: '10–128 characters', paymentPin: 'Six-digit payment PIN', confirmPin: 'Confirm PIN',
  pinPlaceholder: '6 digits',
  sendingCode: 'Sending code…', verifyEmail: 'Verify email', haveAccount: 'Already have an account?',
  verifyTitle: 'Check your inbox', verifyDetail: 'Enter the six-digit code sent to {email}.', emailVerification: 'EMAIL VERIFICATION',
  changeDetails: 'Change details', sixDigitCode: 'Verification code', continue: 'Continue', didNotReceive: 'Did not receive the code?', resend: 'Resend', codeResent: 'A new code was sent.', devCode: 'Development code',
  resetEyebrow: 'ACCOUNT RECOVERY', forgotTitle: 'Reset your password', forgotDetail: 'We will send a one-time code to your verified email address.',
  sendResetCode: 'Send reset code', changeEmail: 'Change email', resetTitle: 'Choose a new password', newPassword: 'New password', resetPassword: 'Reset password',
  securityStep: 'ACCOUNT SECURITY', pinTitle: 'Protect payments', pinSetupDetail: 'This account needs a six-digit PIN before the workspace can open.', finishSetup: 'Finish setup', useAnotherAccount: 'Use another account',
  cloudConfiguration: 'Cloud configuration required', cloudConfigurationDetail: 'Set EXORA_CLOUD_URL to your production HTTPS endpoint.', retry: 'Retry',
  dockRetry: 'Signed in — Dock link needs attention', dockRetryDetail: 'Exora could not finish linking the local Dock. Retry now or continue in limited mode.',
  offlineTitle: 'Exora Cloud is offline', offlineDetail: 'Your encrypted session is intact. Continue with local features or retry the connection.', continueLimited: 'Continue in limited mode',
  signOut: 'Sign out', memorySessionWarning: 'Secure system storage is unavailable. This login lasts only until Exora Dock closes.',
  securityFooter: 'Secure account connection',
  backToWorkspace: 'Back to workspace', accountSecurity: 'ACCOUNT SECURITY', changePinTitle: 'Change payment PIN', changePinDetail: 'Confirm the current payment PIN before choosing a replacement.',
  currentPin: 'Current PIN', newPin: 'New PIN', changePin: 'Change PIN', forgotPin: 'Forgot your PIN?', backToPinChange: 'Back to PIN change',
  passwordReauth: 'PASSWORD CONFIRMATION', resetPinTitle: 'Reset payment PIN', resetPinDetail: 'Confirm your Cloud password, then choose a new six-digit PIN.', resetPin: 'Reset PIN',
}

const zhCopy: typeof enCopy = {
  brandLine: '你的私有智能体工作空间', connecting: '正在安全连接…', openingWorkspace: '正在进入工作区…', workspaceUnavailable: '工作区暂时无法打开', minimize: '最小化', close: '关闭',
  switchLanguage: '切换语言', featureShowcaseLabel: 'Exora Dock 五项核心能力', featureNavigationLabel: '功能导航',
  featureCapabilitiesLabel: '核心能力', featureGoTo: '前往功能',
  features: [
    {
      eyebrow: 'AGENT API 市场', title: '让你的 Agent 连接全球商业 API。',
      detail: '通过 Exora MCP 搜索、比较并调用统一目录中的付费 API，无需为每个提供方重写接入流程。',
      tags: ['Agent 可直接发现', '价格透明', '统一调用流程'], route: ['你的 Agent', 'Exora MCP', '商业 API'],
      routeLabel: '你的 Agent 通过 Exora MCP 连接商业 API', imageAlt: 'Low-poly Agent 通过 Exora Dock 连接商业 API 提供方网络。',
    },
    {
      eyebrow: '本地 DOCK 交付', title: '用自己的设备提供付费 API。',
      detail: '实现与数据留在你掌控的硬件上。Exora Dock 仅开放经你批准的操作，无需搭建公网托管。',
      tags: ['本地运行', '人工确认', '无需公网托管'], route: ['本地项目', '安全 Dock', 'Agent 调用方'],
      routeLabel: '本地项目通过安全的 Exora Dock 提供给 Agent 调用方', imageAlt: '多台 Low-poly 计算机向 Agent 网络安全交付本地 API。',
    },
    {
      eyebrow: '安全 ARTIFACT', title: '安全传递 API 的大型输入与输出。',
      detail: '通过限时 Artifact 传输大文件，记录精确大小与 SHA-256 完整性；文件正文不会进入 JSON 或事件流。',
      tags: ['SHA-256 校验', '限时访问', '大文件交付'], route: ['输入 Artifact', '付费调用', '输出 Artifact'],
      routeLabel: '输入 Artifact 经过付费 API 调用生成输出 Artifact', imageAlt: '安全的 Low-poly Artifact 库与 Agent 交换经过校验的 API 输入和输出。',
    },
    {
      eyebrow: 'AGENT 辅助构建', title: '把本地项目变成标准 OpenAPI。',
      detail: '让你现有的 Agent 按 Exora 的分阶段 MCP 流程只读检查授权源码，在隔离目录生成 Exora Adapter、OpenAPI 3.1、健康检查与测试，再由你确认发布。',
      tags: ['Agent 只读', '隔离生成', '人工确认发布'], route: ['本地项目', 'Agent 辅助构建', 'OpenAPI 商品'],
      routeLabel: '本地项目经过 Agent 辅助构建成为 OpenAPI 商品', imageAlt: '本地项目工具经过 Exora Dock 后转化为标准 OpenAPI 操作。',
    },
    {
      eyebrow: 'API 商业化控制', title: '为任何 API 加上销售所需的控制。',
      detail: '接入你正在运营的 API，由 Exora 添加操作策略、计量、定价、访问控制，以及交付故障自动退款。',
      tags: ['操作策略', '计量与定价', '自动退款'], route: ['已有 API', 'Exora 控制', 'Agent 市场'],
      routeLabel: '已有 API 通过 Exora 商业化控制进入 Agent 市场', imageAlt: '不同形态的 Low-poly API 接口经过商业化控制后成为统一的 Agent 市场端点。',
    },
  ],
  welcomeEyebrow: '欢迎回来', signInTitle: '登录 Exora', signInDetail: '继续使用智能体、市场和本地工作空间。',
  email: '邮箱地址', emailPlaceholder: 'you@example.com', password: '密码', passwordPlaceholder: '输入密码',
  keepSignedIn: '在此设备上保持安全会话', forgotPassword: '忘记密码？', signIn: '登录', working: '请稍候…',
  showPassword: '显示密码', hidePassword: '隐藏密码', securityNoticeTitle: '账号与支付安全', securityNoticeDetail: '登录凭据与支付 PIN 由 Exora Cloud 统一管理，执行敏感操作前仍需完成身份验证。',
  noAccount: '第一次使用 Exora？', createAccount: '创建账号', orContinue: '或使用以下方式继续',
  backToSignIn: '返回登录', registrationEyebrow: '创建你的账号', createTitle: '设置 Exora Dock',
  createDetail: '先验证邮箱并设置安全密码，验证完成后再设置六位支付 PIN。',
  confirmPassword: '确认密码', passwordRules: '10–128 个字符', paymentPin: '六位支付 PIN', confirmPin: '确认 PIN',
  pinPlaceholder: '6 位数字',
  sendingCode: '正在发送验证码…', verifyEmail: '验证邮箱', haveAccount: '已经有账号？',
  verifyTitle: '检查你的邮箱', verifyDetail: '请输入发送至 {email} 的六位验证码。', emailVerification: '邮箱认证',
  changeDetails: '修改注册信息', sixDigitCode: '验证码', continue: '继续', didNotReceive: '没有收到验证码？', resend: '重新发送', codeResent: '新的验证码已经发送。', devCode: '开发验证码',
  resetEyebrow: '账号恢复', forgotTitle: '重置密码', forgotDetail: '我们会向已验证邮箱发送一次性验证码。',
  sendResetCode: '发送重置验证码', changeEmail: '修改邮箱', resetTitle: '设置新密码', newPassword: '新密码', resetPassword: '重置密码',
  securityStep: '账号安全', pinTitle: '保护支付', pinSetupDetail: '进入工作空间前，需要为当前账号设置六位 PIN。', finishSetup: '完成设置', useAnotherAccount: '使用其他账号',
  cloudConfiguration: '需要配置 Cloud', cloudConfigurationDetail: '请将 EXORA_CLOUD_URL 设置为生产环境 HTTPS 地址。', retry: '重试',
  dockRetry: '已登录，但 Dock 绑定需要处理', dockRetryDetail: '暂时无法完成本地 Dock 绑定。你可以重试，或进入受限模式。',
  offlineTitle: 'Exora Cloud 暂时离线', offlineDetail: '加密会话仍然保留。你可以使用本地功能，或重试连接。', continueLimited: '进入受限模式',
  signOut: '退出登录', memorySessionWarning: '系统安全存储不可用，本次登录将在关闭 Exora Dock 后失效。',
  securityFooter: '账号安全连接',
  backToWorkspace: '返回工作空间', accountSecurity: '账号安全', changePinTitle: '修改支付 PIN', changePinDetail: '请先验证当前支付 PIN，再设置新的六位 PIN。',
  currentPin: '当前 PIN', newPin: '新 PIN', changePin: '修改 PIN', forgotPin: '忘记 PIN？', backToPinChange: '返回修改 PIN',
  passwordReauth: '密码确认', resetPinTitle: '重置支付 PIN', resetPinDetail: '验证 Cloud 密码后，设置新的六位 PIN。', resetPin: '重置 PIN',
}
