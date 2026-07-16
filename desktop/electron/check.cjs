const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

for (const file of electronScripts(__dirname)) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.ts'), 'utf8')
const electronMain = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const electronIpc = fs.readFileSync(path.join(__dirname, 'ipc.cjs'), 'utf8')
const activityFixtures = fs.readFileSync(path.join(__dirname, '..', 'src', 'activity-fixtures.ts'), 'utf8')
const viteConfig = fs.readFileSync(path.join(__dirname, '..', 'vite.config.ts'), 'utf8')
if (!/base:\s*['"]\.\/['"]/.test(viteConfig)) throw new Error('Packaged renderer assets must use file-relative URLs')
const rendererStyles = [
  'styles.css',
  'styles/v3-shell.css',
  'styles/v3-api.css',
  'styles/v3-environment.css',
  'styles/v3-listings.css',
  'styles/v3-history.css',
  'styles/v3-buyer.css',
  'styles/wallet.css',
  'styles/auth.css',
  'styles/settings.css',
  'styles/modal.css',
  'styles/policy.css',
].map((file) => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8')).join('\n')
const rendererI18n = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.ts'), 'utf8')
const toastStyles = rendererStyles.slice(rendererStyles.indexOf('.toast {'), rendererStyles.indexOf('.toast.show {'))
for (const marker of ['bottom: max(16px', 'left: auto', 'overflow-wrap: anywhere', 'right: max(16px', 'top: auto', 'white-space: normal', 'z-index: var(--layer-toast)']) {
  if (!toastStyles.includes(marker)) throw new Error(`Bottom-right toast styling missing: ${marker}`)
}
if (toastStyles.includes('left: 50%') || /top:\s*16px/.test(toastStyles)) throw new Error('Toast must not return to the top-center position')
if (!/\.toast\.show\s*\{[^}]*transform:\s*translateY\(0\);/s.test(rendererStyles)) throw new Error('Toast entrance must finish at the bottom-right anchor')
if (!/@media \(max-width: 720px\)\s*\{\s*\.toast\s*\{[^}]*bottom:\s*max\(12px[^}]*right:\s*max\(12px/s.test(rendererStyles)) throw new Error('Narrow windows must keep a 12px toast inset')
if (!/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.toast,/s.test(rendererStyles)) throw new Error('Toast motion must respect reduced-motion preferences')
const modalLayer = Number(rendererStyles.match(/--layer-modal:\s*(\d+);/)?.[1] || 0)
const toastLayer = Number(rendererStyles.match(/--layer-toast:\s*(\d+);/)?.[1] || 0)
if (!modalLayer || toastLayer <= modalLayer) throw new Error('Toast layer must stay above modal surfaces')
if (/showToast\(\s*['"`]/.test(renderer)) throw new Error('Toast copy must use localized messages instead of hardcoded strings')
for (const key of new Set(Array.from(renderer.matchAll(/['"`](toast\.[A-Za-z0-9_.]+)['"`]/g), (match) => match[1]))) {
  const definitions = rendererI18n.match(new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*:`, 'g')) || []
  if (definitions.length !== 2) throw new Error(`Toast message must have English and Chinese definitions: ${key}`)
}
for (const retired of [
  "'toast.signedOut':",
  "'toast.language.en':",
  "'toast.language.zh':",
  "'toast.theme.dark':",
  "'toast.theme.light':",
  "'toast.permissionEnabled':",
  "'toast.projectFolder':",
  "'toast.projectRenamed':",
  "'toast.taskUnpinned':",
  "'toast.taskPinned':",
  "'toast.taskRead':",
  "'toast.taskUnread':",
  "'toast.taskRenamed':",
  'Endpoint Agent Prompt refreshed.',
  'Agent Prompt refreshed with the current files and draft version.',
  "showToast('Submitted to Listings",
  "showToast('Verification code sent by email.",
  'showToast(response.nextAction',
]) {
  if (renderer.includes(retired) || rendererI18n.includes(retired)) throw new Error(`Low-value or duplicate toast returned: ${retired}`)
}
const flatButtonPolicy = rendererStyles.slice(rendererStyles.lastIndexOf('/* Product invariant: every Electron button is flat'))
for (const marker of ['button::before', 'button::after', 'button *', 'background-image: none !important', 'box-shadow: none !important', 'text-shadow: none !important']) {
  if (!flatButtonPolicy.includes(marker)) throw new Error(`Flat Electron button policy missing: ${marker}`)
}
for (const marker of ['function renderV3SellerSurface', "['listings', 'Listings',", "['vm', 'VM',", "['resources', 'Resources',", "['endpoint', 'Endpoint',", "['api_bridge', 'API Bridge',", 'function renderV3EndpointAgentPage', 'class="v3-seller-active-bar"', 'class="v3-market-surface v3-seller-surface"']) {
  if (!renderer.includes(marker)) throw new Error(`V3 Electron surface missing: ${marker}`)
}
const tabOrder = ["['listings', 'Listings',", "['vm', 'VM',", "['resources', 'Resources',", "['endpoint', 'Endpoint',", "['api_bridge', 'API Bridge',"].map((marker) => renderer.indexOf(marker))
if (tabOrder.some((index) => index < 0) || tabOrder.some((index, position) => position > 0 && index <= tabOrder[position - 1])) throw new Error('Main workspace tabs must be ordered Listings, VM, Resources, Endpoint, API Bridge')
if (!renderer.includes("v3SellerTab: 'listings'")) throw new Error('Listings must be the default main workspace tab')
for (const marker of ['const vmProviderAvailable = !isMacPlatform', "tab === 'vm' ? 'listings' : tab", "vmProviderAvailable || id !== 'vm'", 'const sources = v3ProviderApplicationSources()', "vmProviderAvailable ? renderV3EnvironmentCloudModal() : ''", "vmProviderAvailable || value !== 'vm'"]) {
  if (!renderer.includes(marker)) throw new Error(`macOS VM provider UI gate missing: ${marker}`)
}
if (!rendererStyles.includes("#app[data-vm-provider='false'] .seller-automation-attestations label:has(> [data-seller-auto-install])")) throw new Error('macOS must hide automatic VM image downloads')
if (!electronMain.includes('authorizeCommand: (command) => assertDesktopCommandSupported(command, process.platform)')) throw new Error('Desktop IPC must apply platform capability authorization')
if (!electronIpc.includes('await authorizeCommand(command, payload, event)')) throw new Error('IPC authorization must run before command handlers')
const sideSwitch = renderer.slice(renderer.indexOf('function selectOrderSide('), renderer.indexOf('function sellerMonitorActive('))
if (!sideSwitch || sideSwitch.includes('v3SellerTab =')) throw new Error('Buyer/Seller history switching must not change the main workspace tab')
for (const marker of ['function renderV3UnifiedListingsPageV2', "v3ListingMode: 'buyer'", 'data-v3-listing-mode="buyer"', 'data-v3-listing-mode="seller"', 'v3-listing-search-switch', 'v3-listing-agent-hint', 'data-v3-listing-agent-copy', 'v3-listing-agent-details', 'listings.agentPrompt', 'data-listing-owner=', 'data-v3-consumer-form="api"', 'data-v3-consumer-form="compute"', 'data-v3-consumer-action="purchase-download"']) {
  if (!renderer.includes(marker)) throw new Error(`Unified marketplace surface missing: ${marker}`)
}
const listingsSurface = renderer.slice(renderer.indexOf('function renderV3UnifiedListingsPageV2'), renderer.indexOf('function renderV3SellerSurface'))
for (const removedListingChrome of ['v3-listing-overview', 'v3-listing-stats', 'data-v3-listing-filter-scope', 'data-v3-listing-filter-kind', 'data-v3-listing-filter-status', 'Refresh both']) {
  if (listingsSurface.includes(removedListingChrome)) throw new Error(`Listings surface still includes removed overview or filters: ${removedListingChrome}`)
}
for (const nestedListingContainer of ['v3-listing-search-switch v3-console-panel', 'v3-listing-workspace v3-console-panel']) {
  if (listingsSurface.includes(nestedListingContainer)) throw new Error(`Listings surface must stay flat: ${nestedListingContainer}`)
}
if (!/\.v3-application-flow,\s*\.v3-vm-onboarding,\s*\.v3-listings-page\s*\{[^}]*width:\s*100%;[^}]*margin:\s*0;/s.test(rendererStyles)) throw new Error('Listings must share the seller stack width and offset')
if (!/\.app-shell\.seller-surface-mode \.action-view\s*\{[^}]*overflow-y:\s*scroll;[^}]*scrollbar-gutter:\s*stable both-edges;/s.test(rendererStyles)) throw new Error('Seller tabs must keep one symmetric scroll lane')
if (!/\.app-shell\.seller-surface-mode \.v3-market-surface\s*\{[^}]*padding-top:\s*50px;/s.test(rendererStyles)) throw new Error('All five workspace pages must keep breathing room below the top tabs')
if (!rendererStyles.includes('.main-workspace:has(.v3-seller-surface)::after')) throw new Error('The five-page workspace must keep its shared top fade')
if (!/\.main-workspace:has\(\.v3-seller-surface\)::after\s*\{[^}]*height:\s*64px;[^}]*top:\s*0;/s.test(rendererStyles)) throw new Error('The shared workspace fade must begin at the very top without a layered seam')
if (!/state\.v3SellerTab = nextTab\s*renderDecisionPanel\(\)\s*fields\.actionView\.scrollTop = 0/.test(renderer)) throw new Error('Seller tab switches must reset the shared scroll position')
const listingStyles = rendererStyles.slice(rendererStyles.indexOf('.v3-listing-overview,'), rendererStyles.indexOf('.v3-endpoint-review-list'))
if (!listingStyles || listingStyles.includes('linear-gradient')) throw new Error('Listings containers must use solid backgrounds')
for (const marker of ['function renderV3HistoryRow', 'function renderV3ActivityDetail', 'data-v3-history-record', 'data-v3-activity-detail']) {
  if (!renderer.includes(marker)) throw new Error(`V3 history surface missing: ${marker}`)
}
for (const marker of ['type V3ActivityBucket', 'V3_ACTIVITY_RETENTION_MS', 'function v3ActivityDisplayRecords', 'function archiveV3ActivityDisplay', 'data-v3-history-toggle', 'data-v3-active-order-list', 'v3-history-pull-drawer', 'v3-history-drawer-label', 'activityArchiveMarkers']) {
  if (!renderer.includes(marker)) throw new Error(`V3 current/history lifecycle missing: ${marker}`)
}
for (const retiredMarker of ['data-v3-history-bucket=', 'data-v3-history-drop-target', 'v3-history-bucket-switch']) {
  if (renderer.includes(retiredMarker) || rendererStyles.includes(retiredMarker)) throw new Error(`Retired V3 history control returned: ${retiredMarker}`)
}
if (!/\.v3-history-drawer-toggle\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s.test(rendererStyles)) {
  throw new Error('History drawer trigger must remain a transparent labeled divider, not a button container')
}
if (!/\.v3-history-drawer-label\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s.test(rendererStyles)) {
  throw new Error('History pull label must remain visually unboxed')
}
if (!/\.sidebar-resize-handle:hover::before,[\s\S]*?background:\s*var\(--color-primary\);[\s\S]*?transform:\s*scaleX\(1\.4\);/.test(rendererStyles)) {
  throw new Error('Sidebar resize hover must keep the emphasized Exora purple rail')
}
if (!/\.v3-history-drawer-toggle::before,[\s\S]*?border-top:\s*1px solid var\(--color-border\);[\s\S]*?\.v3-history-drawer-toggle:hover::before,[\s\S]*?border-color:\s*var\(--color-primary\);\s*transform:\s*scaleY\(2\);/.test(rendererStyles)) {
  throw new Error('History pull divider must keep its emphasized purple hover rail')
}
for (const marker of ['counterpartyId', 'inFlightCount', 'rebaseFixtureTimestamps', 'local-test-buyer-api-recent']) {
  if (!activityFixtures.includes(marker)) throw new Error(`Local activity lifecycle fixture missing: ${marker}`)
}
for (const marker of ['localActivitySessionsForRole', 'localActivityDetailForSession', 'setLocalActivityFixturesEnabled(true)', 'setLocalActivityFixturesEnabled(false)']) {
  if (!renderer.includes(marker)) throw new Error(`Local activity test mode missing: ${marker}`)
}
if ((activityFixtures.match(/role: 'buyer'/g) || []).length < 3 || (activityFixtures.match(/role: 'seller'/g) || []).length < 3) {
  throw new Error('Local activity test mode must include at least three buyer and three seller orders')
}
for (const marker of ["productKind: 'compute'", "productKind: 'download'", "productKind: 'api_operation'", "status: 'active'", "status: 'completed'", "status: 'needs_attention'"]) {
  if (!activityFixtures.includes(marker)) throw new Error(`Local activity fixture coverage missing: ${marker}`)
}
for (const marker of ['function syncV3SellerTabsVisibility()', 'state.settingsOpen || Boolean(state.selectedV3ActivitySessionId)']) {
  if (!renderer.includes(marker)) throw new Error(`V3 activity detail tab visibility missing: ${marker}`)
}
const decisionPanel = renderer.slice(renderer.indexOf('function renderDecisionPanel()'), renderer.indexOf('function renderOrderPlanDecision('))
if (!decisionPanel.includes('syncV3SellerTabsVisibility()') || decisionPanel.includes("fields.sellerSurfaceTabs.classList.remove('hidden')")) {
  throw new Error('Activity detail rendering must hide the main workspace tabs')
}
const settingsSurface = renderer.slice(renderer.indexOf('function renderSettingsSurface()'), renderer.indexOf('function openSettings('))
if (!settingsSurface.includes('syncV3SellerTabsVisibility()')) throw new Error('Returning from settings must preserve activity detail tab visibility')
if (!/auth:\s*Object\.freeze\(\{\s*width:\s*1440,\s*height:\s*900,\s*minWidth:\s*560,\s*minHeight:\s*600\s*\}\)/.test(electronMain)) {
  throw new Error('Authentication must open at the normal 1440x900 desktop size')
}
for (const marker of ['function installNativeTooltipBlocker()', "attributeFilter: ['title']", "element.removeAttribute('title')"]) {
  if (!renderer.includes(marker)) throw new Error(`Native renderer tooltip blocker missing: ${marker}`)
}
if ((renderer.match(/installNativeTooltipBlocker\(\)/g) || []).length < 2) throw new Error('Native renderer tooltip blocker is not installed')
if (/tray\.setToolTip\s*\(/.test(electronMain)) throw new Error('The system tray must not display a native tooltip')
const preload = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')
const cloudAuthMain = fs.readFileSync(path.join(__dirname, 'cloud-auth.cjs'), 'utf8')
const authUI = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth-ui.ts'), 'utf8')
for (const marker of ["element.addEventListener('invalid'", 'form.noValidate = true', "input:invalid", "aria-invalid', 'true"]) {
  if (!authUI.includes(marker)) throw new Error(`Native authentication validation tooltip suppression missing: ${marker}`)
}
const workspaceTemplate = renderer.slice(renderer.indexOf('app.innerHTML ='), renderer.indexOf('const fields ='))
if (!workspaceTemplate.includes('class="top-window-drag-strip"')) throw new Error('The native top titlebar drag region is missing')
if (!authUI.includes('class="top-window-drag-strip auth-top-window-drag-strip"')) throw new Error('The auth gate must reuse the single native top titlebar drag region')
if (!/\.top-window-drag-strip\s*\{[^}]*background:\s*transparent;[^}]*height:\s*48px;[^}]*top:\s*0;[^}]*app-region:\s*drag;/s.test(rendererStyles)) throw new Error('The top titlebar must keep the expanded transparent native drag region')
if (/\.auth-feature-scroll\s*\{[^}]*app-region:\s*no-drag;/s.test(rendererStyles)) throw new Error('The full-height authentication showcase must not cancel the top-left drag strip')
const nativeDragDeclarations = rendererStyles.match(/(?:^|\s)(?:-webkit-)?app-region:\s*drag;/g) || []
if (nativeDragDeclarations.length !== 2) throw new Error('Only the unprefixed and prefixed declarations on the single top titlebar may be draggable')
if (/\.global-modal-layer\s*\{[^}]*app-region:/s.test(rendererStyles)) throw new Error('The always-mounted global modal layer must not cancel the native titlebar drag region')
if (!/\.app-modal\s*\{[^}]*app-region:\s*no-drag;/s.test(rendererStyles)) throw new Error('Visible modal surfaces must remain excluded from native window dragging')
for (const retiredDragImplementation of ['auth-drag-strip', 'sidebar-drag-strip', 'main-window-drag-strip', 'chat-top-drag-layer', 'drag-region', 'window_begin_manual_drag', 'window_manual_drag_move', 'window_end_manual_drag', 'manualWindowDragActive']) {
  if (renderer.includes(retiredDragImplementation) || rendererStyles.includes(retiredDragImplementation)) throw new Error(`retired drag implementation returned: ${retiredDragImplementation}`)
}
const windowModeTransition = electronMain.slice(electronMain.indexOf('async function window_set_mode'), electronMain.indexOf('async function auth_status'))
if (!windowModeTransition.includes('mainWindow.setSize(size.width, size.height, true)')) throw new Error('Window mode changes must resize in place without moving the login window')
if (windowModeTransition.includes('display.workArea.x') || windowModeTransition.includes('display.workArea.y')) throw new Error('Window mode changes must not recenter the window')
for (const retired of ['Transaction Agent', 'Ask Exora Dock', 'Select order activity', 'data-agent-chat-form', 'data-agent-query', 'data-cart-modal', 'data-market-project-picker', 'data-transaction-detail-sidebar']) {
  if (workspaceTemplate.includes(retired)) throw new Error(`retired workspace DOM returned: ${retired}`)
}
for (const marker of ['class="global-modal-layer"', 'class="app-modal wallet-modal', 'class="app-modal order-search-modal', 'class="app-modal pin-settings-modal', 'class="app-modal mcp-info-modal', 'function renderMCPInfoModal', 'listings.guide.agentStep3', 'listings.guide.manualStep3', 'listings.guide.reality4', 'data-action="open-settings"', 'data-view-panel="app-settings"', 'data-settings-action="change-pin"', "'auth_pin_change'"]) {
  if (!renderer.includes(marker)) throw new Error(`global modal or security settings surface missing: ${marker}`)
}
for (const marker of ['class="settings-return-cell"', 'function renderSettingsSidebar()', "view: 'general'", "view: 'account-security'", "view: 'agent-permissions'", "view: 'notifications'", "view: 'data-storage'", "view: 'system-about'", "if (state.settingsOpen) renderSettingsSidebar()"] ) {
  if (!renderer.includes(marker)) throw new Error(`settings sidebar navigation missing: ${marker}`)
}
for (const marker of ['system_settings_status', 'system_notification_test', 'system_clear_storage', 'system_export_diagnostics', 'normalizeAppSettingsV3', 'version: SETTINGS_VERSION']) {
  if (!electronMain.includes(marker)) throw new Error(`AppSettingsV3 main-process support missing: ${marker}`)
}
for (const nestedSettingsContainer of ['class="app-settings-layout"', 'class="app-settings-nav"']) {
  if (workspaceTemplate.includes(nestedSettingsContainer)) throw new Error(`settings surface must stay flat: ${nestedSettingsContainer}`)
}
for (const marker of ['.global-modal-layer', '.app-modal-scrim', 'position: fixed', '.app-settings-view', '.pin-settings-panel']) {
  if (!rendererStyles.includes(marker)) throw new Error(`global modal or settings styling missing: ${marker}`)
}
for (const retired of ['showingChat = false', 'gpu-demo', 'GPU Job Demo']) {
  if (renderer.includes(retired) || rendererStyles.includes(retired)) throw new Error(`retired renderer design returned: ${retired}`)
}
if (!/onAuthenticated:\s*\(state: CloudAuthState\)\s*=>\s*Promise<void>/.test(authUI)) throw new Error('Authentication completion must await the workspace lifecycle')
for (const marker of ['openingWorkspace', 'workspaceUnavailable', 'workspaceTransition', 'workspace-retry']) {
  if (!authUI.includes(marker)) throw new Error(`atomic workspace transition support missing: ${marker}`)
}
if (!authUI.includes('const authUITestControlsEnabled = true') || !renderer.includes('const authUITestControlsEnabled = true')) {
  throw new Error('Authentication test controls must remain available in current builds')
}
const retiredDesktopCapabilities = ['local_agent_', 'bind_local_agent', 'workspace_snapshot', 'buyer_flow_action', 'save_chat_thread', 'archive_chat_threads', 'save_transactions', 'agent_card_', 'market_rail_cards', 'seller_market_status', 'project_folder_status', 'choose_project_folder', 'open_project_folder', 'archive_project_chats', 'stop_work_run', 'release_work_mcp_lease', 'llm_profiles']
const builtRenderer = fs.existsSync(path.join(__dirname, '..', 'dist', 'assets'))
  ? fs.readdirSync(path.join(__dirname, '..', 'dist', 'assets'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(__dirname, '..', 'dist', 'assets', file), 'utf8'))
    .join('\n')
  : ''
for (const retired of retiredDesktopCapabilities) {
  if (renderer.includes(retired) || electronMain.includes(retired) || preload.includes(retired) || builtRenderer.includes(retired)) {
    throw new Error(`retired desktop capability returned: ${retired}`)
  }
}
for (const retiredFile of ['local-agents.cjs', 'local-agents.test.cjs', 'workspace.cjs']) {
  if (fs.existsSync(path.join(__dirname, retiredFile))) throw new Error(`retired Electron module returned: ${retiredFile}`)
}
for (const marker of ['auth_registration_start', 'auth_password_reset_complete', 'auth_pin_reset', 'exora:auth-state-changed', 'ensureDockLink']) {
  if (!electronMain.includes(marker) && !cloudAuthMain.includes(marker)) throw new Error(`Cloud identity flow missing: ${marker}`)
}
for (const marker of ['auth-gate', 'data-auth-form="login"', 'data-auth-form="register"', 'data-auth-form="pin-reset"']) {
  if (!authUI.includes(marker)) throw new Error(`Cloud identity UI missing: ${marker}`)
}
if (!cloudAuthMain.includes("storageMode: encryptionAvailable() ? 'safeStorage' : 'session'")) throw new Error('Cloud sessions must use safeStorage or process-only memory')
if (/pin\s*:\s*pendingRegistration\.pin/.test(cloudAuthMain)) throw new Error('Local PIN must never be included in a Cloud registration request')
if (!cloudAuthMain.includes('validateRegistrationInput(email, password, passwordConfirm)')) throw new Error('Registration must validate only email and the two password entries before email verification')
if (/data-auth-form="register"[\s\S]{0,1400}field\('pin'/.test(authUI)) throw new Error('Registration UI must not request a payment PIN')
if (!authUI.includes("next.phase === 'authenticated' || next.phase === 'needs_pin'")) throw new Error('PIN setup must open after entering the workspace')
for (const marker of ["authState?.phase === 'needs_pin'", 'openPINSetupModal()', "state.pinSettingsMode === 'setup'", "invoke<CloudAuthState>('auth_pin_set'"]) {
  if (!renderer.includes(marker)) throw new Error(`Required post-registration PIN modal flow missing: ${marker}`)
}
for (const marker of ["pinSettingsSetupStep: 'current' | 'entry' | 'confirmation'", "state.pinSettingsSetupStep === 'current'", "state.pinSettingsSetupStep === 'entry'", "advancePINSettingsStep('confirmation')", 'renderPINSettingsCodeInput()', "app.addEventListener('click', reopenPINSetupForPayment, true)", "app.addEventListener('submit', reopenPINSetupForPayment, true)"]) {
  if (!renderer.includes(marker)) throw new Error(`Sequential Cloud PIN setup or payment re-prompt guard missing: ${marker}`)
}
if (!rendererStyles.includes('.pin-settings-code-control .wallet-code-cells')) throw new Error('Cloud PIN setup must reuse the segmented six-cell wallet input style')
for (const marker of ['activity_sessions', 'activity_session', '/v3/activity-sessions']) {
  if (!electronMain.includes(marker)) throw new Error(`V3 history IPC missing: ${marker}`)
}
for (const marker of ['v3-application-flow', 'v3-shared-file-picker', 'v3-shared-file-empty', 'v3AgentMaterialsCurrent', 'Review Agent draft', 'data-v3-review-confirm', 'Public endpoint and seller confirmation', 'Submit to Listings']) {
  if (!renderer.includes(marker)) throw new Error(`API bridge seller surface missing: ${marker}`)
}
if (renderer.includes('original.outerHTML = renderV3AgentMaterialPicker')) throw new Error('Agent file picker must be rendered directly, not patched after mount')
for (const removedWizard of ['renderV3ResourcesPageLegacy', 'renderV3EndpointAgentPageLegacy', 'function renderV3EndpointPage()', 'updateV3WindowsPricingLayout']) {
  if (renderer.includes(removedWizard)) throw new Error(`obsolete creation surface remains: ${removedWizard}`)
}
for (const preserved of ['class="app-shell"', 'class="task-sidebar"', 'data-ledger-list', 'data-order-side-tab="buyer"']) {
  if (!renderer.includes(preserved)) throw new Error(`existing purple Dock shell was replaced: ${preserved}`)
}
for (const removedSettingsPage of ['data-settings-page="api"', 'data-settings-page="local-agents"', 'data-settings-page="seller-card"', 'data-settings-page="buyer-agent"', 'data-settings-page="seller"']) {
  if (renderer.includes(removedSettingsPage)) throw new Error(`removed settings component remains mounted: ${removedSettingsPage}`)
}
for (const marker of ['provider_environment_catalog', 'provider_environment_download', 'managed_wsl2_shared_host', 'v3-environment-cloud-launcher', 'v3-cloud-image-card']) {
  if (!renderer.includes(marker) && !fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8').includes(marker)) throw new Error(`Windows WSL provider surface missing: ${marker}`)
}
for (const marker of ['safeStorage.encryptString', 'safeStorage.decryptString']) {
	if (!electronMain.includes(marker)) throw new Error(`secure Cloud session support missing: ${marker}`)
}
for (const marker of ['account_key_status', 'account_key_save', 'account_key_delete', 'payload?.input?.key']) {
	if (electronMain.includes(marker)) throw new Error(`retired account-wide key support remains: ${marker}`)
}
for (const marker of ['order_access_key_status', 'order_access_key_create', 'order_access_key_rotate', 'order_access_key_revoke', 'consumer_approval_decide', 'wallet_spend_policy_save']) {
	if (!electronMain.includes(marker)) throw new Error(`order-scoped access or spend policy IPC missing: ${marker}`)
}
for (const marker of ['data-wallet-tab="agent-limit"', 'data-wallet-tab="history"', 'data-v3-order-key-action', 'data-v3-approval-form']) {
	if (!renderer.includes(marker)) throw new Error(`wallet or order security surface missing: ${marker}`)
}
for (const marker of ['data-account-key-section', 'data-account-key-save', 'data-account-key-delete']) {
	if (renderer.includes(marker)) throw new Error(`retired account-wide key UI remains: ${marker}`)
}
if (!electronMain.includes('provider_api_probe')) throw new Error('API bridge connection probe is missing')
if (!electronMain.includes('provider_endpoint_test_route')) throw new Error('Local Endpoint route smoke test is missing')
for (const marker of ['provider_asset_clear_selection', 'asset_packaging', 'application/zip', 'MAX_RESOURCE_ARCHIVE_BYTES']) {
  if (!fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8').includes(marker)) throw new Error(`single ZIP resource upload is missing: ${marker}`)
}
const packageConfig = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
if (!packageConfig.includes('resources/wsl')) throw new Error('Windows installer does not embed the locked WSL Runtime resource')
const imageFiles = fs.readdirSync(path.join(__dirname, '..', 'resources', 'wsl'))
if (imageFiles.some((name) => name.endsWith('.wsl'))) throw new Error('Windows installer must not embed a Linux environment image')

function electronScripts(root) {
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...electronScripts(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.cjs')) {
      files.push(fullPath)
    }
  }
  return files.sort()
}
