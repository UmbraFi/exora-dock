import { invoke } from './bridge'
import { createAuthGate, type CloudAuthAccount, type CloudAuthState } from './auth-ui'
import {
  htmlLangForLanguage,
  initialI18nLanguage,
  normalizeAppLanguage,
  setI18nLanguage,
  t,
  translateDom,
  translatePhrase,
  type AppLanguage,
} from './i18n'
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BadgeDollarSign,
  Bell,
  Bot,
  BrainCircuit,
  BookOpen,
  Blocks,
  Check,
  ChevronRight,
  Cloud,
  Code2,
  Copy,
  Database,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe2,
  Hand,
  Inbox,
  Info,
  KeyRound,
  Languages,
  LogOut,
  Maximize2,
  MessagesSquare,
  Minus,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  SendHorizontal,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SquareKanban,
  Sparkles,
  Terminal,
  Trash2,
  Wallet,
  WalletCards,
  X,
  type IconNode,
} from 'lucide'
import { toString as qrToString } from 'qrcode'
import { compilePriceFormula } from './pricing-formula.js'
import { renderProviderContractGuideBody } from './provider-contract-guide'
import {
  escapeHTML,
  humanizeError,
  type AppStatus,
} from './domain'
import './styles.css'
import './styles/v3-shell.css'
import './styles/v3-api.css'
import './styles/v4-api-operation.css'
import './styles/v3-environment.css'
import './styles/v3-listings.css'
import './styles/v3-history.css'
import './styles/v3-activity-detail.css'
import './styles/v3-buyer.css'
import './styles/wallet.css'
import './styles/auth.css'
import './styles/settings.css'
import './styles/modal.css'
import './styles/policy.css'

type OrderSide = 'buyer' | 'seller'
type V3SellerTab = 'buyer' | 'local_api' | 'cloud_api'
type V3ApplicationSource = 'api'

type V3Product = {
  productId: string
  productKind: 'api_operation' | string
  applicationSource?: V3ApplicationSource
  title: string
  description?: string
  status: string
  providerDockId?: string
  manifest?: Record<string, unknown>
  version?: number
  updatedAt?: string
}

type V3Listing = {
  listingId: string
  productId: string
  status: string
  price?: Record<string, unknown>
  limits?: Record<string, unknown>
  workloadPolicy?: Record<string, unknown>
  performancePolicy?: Record<string, unknown>
  availability?: Record<string, unknown>
  validation?: Record<string, unknown>
  version?: number
  updatedAt?: string
  deletedAt?: string
  applicationSource?: V3ApplicationSource
  creationActor?: 'integration' | 'human' | string
  draftRunId?: string
  sourceFingerprint?: string
  mcpConnection?: string
  sellerPolicyReceipt?: { policyId: string; version: number; hash: string; approvedAt?: string }
}

type APIOperationReview = {
  operationId: string
  operationSha256: string
  enabled: boolean
  integrationStatus: 'editable' | 'failed' | 'awaiting_confirmation' | 'locked'
  pricingStatus: 'blocked' | 'editable' | 'failed' | 'awaiting_confirmation' | 'locked'
  validationPlan?: { schemaVersion?: string; planSha256?: string; checks?: Array<{ id?: string; category?: string; type?: string }> }
  validationRun?: { runId?: string; status?: string; failure?: string; startedAt?: string; completedAt?: string }
  validationReceipt?: { schemaVersion?: string; passed?: boolean; receiptId?: string; checks?: Array<Record<string, unknown>>; evidence?: Record<string, unknown>; verifiedMetering?: Array<{ dimension?: string; unit?: string; source?: string; maximumPerInvocation?: number; evidencePointer?: string }>; sampleUsage?: Record<string, number> }
  pricingDraft?: Record<string, unknown>
  pricing?: Record<string, unknown>
  billingPlan?: { schemaVersion?: string; planSha256?: string; scenarios?: Array<Record<string, unknown>> }
  pricingBillingReceipt?: { schemaVersion?: string; passed?: boolean; sandbox?: boolean; receiptId?: string; formulaAstSha256?: string; planSha256?: string; signature?: Record<string, unknown>; scenarios?: Array<Record<string, unknown>> }
  operationalState: 'offline' | 'live' | 'draining'
  operationalStatusReason?: string
  operationalMetrics?: { inFlight?: number; activeConsumers?: number; invocations?: number; usage?: Record<string, number>; grossRevenueAtomic?: number; refundedAtomic?: number; providerFaultRate?: number; healthFailureStreak?: number; healthStatus?: string; blocked?: boolean; sellerLiabilityRecorded?: boolean }
  operationalSettings?: { concurrencyLimit?: number; contractMaximumConcurrency?: number }
}
type ProviderIntegration = {
  apiId: string
	cloudApiId?: string
  version: number
  source: 'agent' | 'manual' | string
  status: string
  deliveryMode: 'local_dock' | 'cloud_direct'
  displayName?: string
  icon?: string
  title: string
  description?: string
  capability: Record<string, any>
	contractPackage?: Record<string, any>
	contractPackageSha256?: string
  validation: { status: string; capabilitySha256?: string; operationSha256?: Record<string, string>; issues?: Array<{ operationId?: string; fieldPath: string; errorCode: string; message: string }> }
  operationReviews: Record<string, APIOperationReview>
  createdAt?: string
  updatedAt?: string
  integrationId: string
  stage: string
  sourceKind: 'code_project' | 'function' | 'cli' | 'existing_http_api'
  sourceRef: string
  sourceRelativePath?: string
  adapterKind: 'executable_adapter' | 'declarative_adapter'
  generatedRoot?: string
  artifacts?: Array<{ path: string; sizeBytes: number; sha256: string }>
  completedEvidence?: Array<{ kind: string; summary: string; sha256?: string; createdAt?: string }>
  blockers?: string[]
  nextActions?: Array<{ tool: string; purpose: string; requiredInputs?: string[]; requiresHumanApproval?: boolean }>
  draftPreparation?: Record<string, unknown>
}

let providerIntegrations: ProviderIntegration[] = []
let providerIntegrationsLoaded = false
let providerIntegrationsLoading = false
let providerIntegrationsError = ''
type ProviderOperationView = 'contract' | 'operations' | 'integration' | 'billing' | 'console'
type ProviderPricingDraft = { operationSha256: string; expression: string; maximumCharge: string; sampleUsage: Record<string, number> }
const providerOperationViews: Record<string, ProviderOperationView> = {}
const providerPricingDrafts: Record<string, ProviderPricingDraft> = {}
let providerPricingBookOpenKey = ''
let providerContractGuideOpenAPIId = ''
let providerContractEditorOpenKey = ''
let providerIdentityEditorOpenAPIId = ''
let providerIntegrationsRevision = 0
const providerIntegrationEditKeys = new Set<string>()
const providerPricingEditKeys = new Set<string>()
const providerPreparationDraftStoragePrefix = 'exora.account.providerPreparationDraft.'
const providerPricingDraftStoragePrefix = 'exora.account.providerPricingDraft.'
let providerConsolePollTimer = 0
let providerContractDragHandlers: AbortController | undefined

type ProviderRowState = {
  uid: string
  progress: 0 | 1 | 2
  statusLabel: string
  statusTone: 'pending' | 'ready' | 'danger'
}

type V3ReadinessCheck = { id: string; label: string; ready: boolean; detail?: string }
type V3ListingApplication = {
  listing: V3Listing
  product: V3Product
  source: V3ApplicationSource
  readiness: { ready: boolean; checks: V3ReadinessCheck[] }
  runtime?: { tunnelOnline: boolean; endpointHealthy: boolean; lastSeenAt?: string; contractSha256?: string; error?: string }
  lifecycle: { listed: boolean; allowedActions: string[]; statusReason?: string }
}
type V3CatalogListing = {
  listing: V3Listing
  productManifest: V3Product
  availability?: Record<string, unknown>
  ownerMetadata?: { providerDockId?: string; isOwner?: boolean }
}
type CatalogOperation = { apiId: string; operationId: string; title?: string; description?: string; interaction?: string; pricing?: Record<string, unknown>; availability?: string; api?: { apiId: string; title?: string; deliveryMode?: string; lifecycle?: string; runtimeHealth?: string } }
type V3APIOrder = { orderId: string; listingId: string; status: 'active' | 'inactive'; activatedAt?: string; deactivatedAt?: string; lastUsedAt?: string; createdAt?: string; updatedAt?: string }
type V3ActivitySession = {
  sessionId: string
  orderUid: string
  activitySessionId?: string
  role: OrderSide
  productKind: 'api_operation' | string
  productId: string
  listingId: string
  productTitle: string
  counterpartyId?: string
  counterpartyLabel: string
  status: string
  outcome: string
  attentionRequired: boolean
  inFlightCount?: number
  itemCount: number
  amountAtomic: number
  grossAmountAtomic: number
  platformFeeAtomic: number
  asset: string
  startedAt: string
  updatedAt: string
  endedAt?: string
  retainUntil?: string
}

type V3ActivityBucket = 'current' | 'history'

type V3ActivityArchiveMarker = {
  id: string
  accountId?: string
  archiveKey: string
  role: OrderSide
  productKind: string
  archivedAt: string
  archivedThrough: string
  records: V3ActivitySession[]
  baselines: V3ActivitySession[]
  detailAfterBySession?: Record<string, string>
  deleted?: boolean
}

type V3ActivityDisplayRecord = V3ActivitySession & {
  displayId: string
  archiveKey: string
  bucket: V3ActivityBucket
  sessionIds: string[]
  sourceRecords: V3ActivitySession[]
  baselineRecords: V3ActivitySession[]
  canArchive: boolean
  manuallyArchived: boolean
  archiveMarkerId?: string
  detailAfterBySession?: Record<string, string>
  detailThroughBySession?: Record<string, string>
}

type V3ActivityInvocation = {
  invocationId: string
  operationId: string
  status: string
  chargedAtomic: number
  platformFeeAtomic: number
  usage?: Record<string, number>
  startedAt: string
  completedAt?: string
}

type V3ActivityDetail = V3ActivitySession & {
  product?: Record<string, any>
  operations?: string[]
  usage?: Record<string, number>
  invocations?: V3ActivityInvocation[]
  events?: Array<{ eventId: string; approvalId?: string; type: string; status: string; title: string; detail: string; occurredAt: string }>
  identifiers?: Record<string, string>
}

type V3ServiceManifest = { interface: Record<string, any>; deliveryMode?: 'local_dock' | 'cloud_direct'; delivery?: 'local_dock' | 'cloud_direct'; operationPolicies: Array<{ operationId: string; interaction: 'request_response' | 'server_stream' | 'async_job'; sideEffect: boolean; idempotent: boolean; limits: { timeoutSeconds: number; maxRequestBytes: number; maxResponseBytes: number; maxConcurrency: number }; meteringCapabilities: string[] }> }
type SettingsView = 'general' | 'account-security' | 'agent-permissions' | 'notifications' | 'data-storage' | 'system-about'
type WalletPanel = 'receive' | 'withdraw' | 'agent-limit' | 'history'
type WalletHistoryFilter = 'all' | 'deposit' | 'withdrawal'
type AppTheme = 'system' | 'light' | 'dark'
type CloseBehavior = 'tray' | 'quit'
type NotificationPreferenceKey = 'approvals' | 'apiActivity' | 'billing' | 'providerApis' | 'security'
type NotificationPreferences = Record<NotificationPreferenceKey, boolean>
type DesktopSystemStatus = {
  appVersion?: string
  electronVersion?: string
  chromiumVersion?: string
  platform?: string
  arch?: string
  capabilities?: { vmProvider?: boolean }
  packaged?: boolean
  secureStorageAvailable?: boolean
  notificationsSupported?: boolean
  notificationPermission?: string
  loginItem?: { openAtLogin?: boolean; openAsHidden?: boolean }
  paths?: { data?: string; logs?: string; settings?: string; manifest?: string; downloads?: string }
  storage?: { dataBytes?: number; logsBytes?: number; cacheBytes?: number; tempBytes?: number }
  runtime?: AppStatus
  cloudURL?: string
  update?: { supported?: boolean; channel?: string; state?: string; version?: string; progress?: number; checkedAt?: string; message?: string }
}
type AccountAPIKeyStatus = { accessKey?: { tokenId?: string; maskedKey?: string; status?: string; createdAt?: string; lastUsedAt?: string } | null; secureStorageAvailable?: boolean; stored?: boolean; dockConfigured?: boolean; requiresImport?: boolean }
type AgentSessionPolicy = { scopes: string[]; idleSeconds: number; maxLifetimeSeconds: number }
type AgentMcpClientId = 'codex' | 'claude-code' | 'cursor' | 'opencode' | 'openclaw'
type AgentMcpClientStatus = {
  clientId: AgentMcpClientId
  instanceId: string
  displayName: string
  instanceLabel?: string
  installKind?: 'cli' | 'desktop' | 'config' | 'missing'
  installPath?: string
  version?: string
  registrationTarget?: string
  sharedTargetCount?: number
  installationCount?: number
  versions?: string[]
  detected: boolean
  state: 'registered' | 'stale' | 'conflict' | 'available' | 'not-detected' | 'error'
  managed?: boolean
  restartRequired?: boolean
  detail?: string
  message?: string
  configPath?: string
  canRegister?: boolean
  canRepair?: boolean
  canRemove?: boolean
}
const AGENT_MCP_ONBOARDING_VERSION = 3
type ProfileSubmenu = 'language' | 'theme'
type PermissionMode = 'ask' | 'approve' | 'full' | 'custom'













type PersistedAppSettings = {
  language?: AppLanguage
  theme?: AppTheme
  workOrderSide?: OrderSide
  sidebarCollapsed?: boolean
  sidebarWidth?: number
  activityArchiveMarkers?: V3ActivityArchiveMarker[]
  launchAtLogin?: boolean
  startMinimized?: boolean
  closeBehavior?: CloseBehavior
  downloadDirectory?: string
  notifications?: Partial<NotificationPreferences>
  agentMcpOnboardingVersion?: number
}


type DesktopPersistenceLoad = {
  version?: number
  settings?: PersistedAppSettings
}
























type WalletStatus = {
  configured?: boolean
  address?: string
  localKeypair?: boolean
  keypairPath?: string
  encryptedKeypairPath?: string
  boundOnly?: boolean
  accountBound?: boolean
  unlocked?: boolean
  backupStatus?: string
  usdcMint?: string
  balances?: Record<string, { amountAtomic?: number; decimals?: number; currency?: string; mint?: string; status?: string; updatedAt?: string }>
  feePolicy?: { currency?: string; relayFeeAtomic?: number; relayFeeDescription?: string; gasPaidBy?: string }
	custody?: { mode?: string; depositsPaused?: boolean; withdrawalsPaused?: boolean; signerPaused?: boolean; accountFrozen?: boolean }
	deposits?: WalletDeposit[]
	withdrawals?: WalletWithdrawal[]
	agentSpendPolicy?: AgentSpendPolicy
}

type AgentSpendPolicy = {
	accountId?: string
	enabled: boolean
	singleLimitAtomic: number
	periodLimitAtomic: number
	periodSeconds: number
	periodStartedAt?: string
	spentAtomic: number
	updatedAt?: string
}

type WalletDeposit = {
	depositId?: string
	amountAtomic?: number
	signature?: string
	status?: string
	network?: string
	mint?: string
	detectedAt?: string
	finalizedAt?: string
	creditedAt?: string
}

type WalletWithdrawal = {
	withdrawalId?: string
  fromAddress?: string
  toAddress?: string
	destination?: string
  amountAtomic?: number
  currency?: string
  decimals?: number
  signature?: string
	status?: string
	createdAt?: string
	updatedAt?: string
	finalizedAt?: string
	networkFeeAtomic?: number
	serviceFeeAtomic?: number
	totalFeeAtomic?: number
}

type WalletWithdrawalResponse = {
  withdrawal?: WalletWithdrawal
	quote?: { quoteId: string; requestFingerprint?: string; amountAtomic?: number; networkFeeAtomic?: number; serviceFeeAtomic?: number; totalFeeAtomic?: number; netAmountAtomic?: number; expiresAt?: string }
	challenge?: { challengeId: string; expiresAt?: string; resendAfter?: string; email?: string }
  nextAction?: string
  feePolicy?: WalletStatus['feePolicy']
}

type WalletWithdrawalChallenge = {
  quote: NonNullable<WalletWithdrawalResponse['quote']>
  challenge: NonNullable<WalletWithdrawalResponse['challenge']>
  toAddress: string
  amountAtomic: number
  idempotencyKey: string
}

const app = document.querySelector<HTMLDivElement>('#app')!
let authPresentationActive = true
const isMacPlatform = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
const normalizeV3SellerTab = (tab: V3SellerTab): V3SellerTab => {
  if (tab === 'local_api' || tab === 'cloud_api') return tab
  return 'buyer'
}
const WORK_TASK_STATE_KEY = 'exora.workTaskState.v1'
const APP_SETTINGS_SAVE_DELAY = 250
const DEFAULT_SIDEBAR_WIDTH = 277
const SIDEBAR_MIN_WIDTH = 236
const SIDEBAR_MAX_WIDTH = 480
const TOAST_DURATION_MS = 3200
const SETTINGS_QR_WIDTH = 236
const SETTINGS_QR_MARGIN = 1
const SETTINGS_QR_COLOR = { dark: '#17182b', light: '#ffffff' } as const
app.dataset.platform = isMacPlatform ? 'mac' : 'windows'

const nativeTooltipAriaLabels = new WeakSet<Element>()
const nativeTooltipAccessibleControlSelector = [
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="separator"]',
  '[tabindex]',
].join(',')

function hasAccessibleNameWithoutTooltip(element: Element) {
  if (element.hasAttribute('aria-labelledby')) return true
  if (element.hasAttribute('aria-label') && !nativeTooltipAriaLabels.has(element)) return true
  if (
    element instanceof HTMLButtonElement
    || element instanceof HTMLInputElement
    || element instanceof HTMLSelectElement
    || element instanceof HTMLTextAreaElement
  ) {
    if (element.labels?.length) return true
  }
  return Boolean(element.textContent?.trim())
}

function removeNativeTooltip(element: Element) {
  const tooltip = element.getAttribute('title')
  if (tooltip === null) return
  const label = tooltip.trim()
  if (
    label
    && element.matches(nativeTooltipAccessibleControlSelector)
    && (!hasAccessibleNameWithoutTooltip(element) || nativeTooltipAriaLabels.has(element))
  ) {
    element.setAttribute('aria-label', label)
    nativeTooltipAriaLabels.add(element)
  }
  element.removeAttribute('title')
}

function removeNativeTooltipsFrom(root: Node) {
  if (!(root instanceof Element)) return
  removeNativeTooltip(root)
  root.querySelectorAll('[title]').forEach(removeNativeTooltip)
}

function installNativeTooltipBlocker() {
  removeNativeTooltipsFrom(document.documentElement)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        removeNativeTooltip(mutation.target as Element)
        continue
      }
      mutation.addedNodes.forEach(removeNativeTooltipsFrom)
    }
  })
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title'],
  })
}

function installFileDropNavigationGuard() {
  const preventNavigation = (event: DragEvent) => {
    if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault()
  }
  window.addEventListener('dragover', preventNavigation)
  window.addEventListener('drop', preventNavigation)
}





type LucideElementNode = [tag: string, attrs: Record<string, string | number | undefined>, children?: LucideElementNode[]]

const escapeSVGAttr = (value: string | number | undefined) => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
const renderLucideElement = ([tag, attrs, children]: LucideElementNode): string => {
  const attrString = Object.entries(attrs)
    .filter(([name, value]) => name !== 'key' && value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeSVGAttr(value)}"`)
    .join('')
  const content = children?.map(renderLucideElement).join('') ?? ''
  return `<${tag}${attrString}>${content}</${tag}>`
}

const icon = (node: IconNode) => `<svg class="app-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">${(node as LucideElementNode[]).map(renderLucideElement).join('')}</svg>`


const windowIcons = {
  minimize: icon(Minus),
  maximize: icon(Maximize2),
  close: icon(X),
}

const toolbarIcons = {
  search: icon(Search),
  copy: icon(Copy),
  send: icon(SendHorizontal),
  sidebarExpanded: icon(PanelLeftClose),
  sidebarCollapsed: icon(PanelLeftOpen),
  detailCollapse: icon(PanelRightClose),
  detailExpand: icon(PanelRightOpen),
  forward: icon(ArrowRight),
  back: icon(ArrowLeft),
  disclosure: icon(ChevronRight),
  folder: icon(Folder),
  folderPlus: icon(FolderPlus),
  projectMenu: icon(Ellipsis),
  plus: icon(Plus),
  hand: icon(Hand),
  refresh: icon(RefreshCw),
  monitor: icon(Activity),
  archive: icon(Archive),
  emptyContent: icon(Inbox),
}

const roleTabIcons: Record<OrderSide, string> = {
  buyer: icon(ShoppingCart),
  seller: icon(ShoppingBag),
}

const profileIcons = {
  wallet: icon(Wallet),
  settings: icon(Settings2),
}

const walletSurfaceIcon = icon(WalletCards)

const settingsNavIcons: Record<SettingsView, string> = {
  general: icon(Settings2),
  'account-security': icon(KeyRound),
  'agent-permissions': icon(Network),
  notifications: icon(Bell),
  'data-storage': icon(Archive),
  'system-about': icon(Info),
}

const profileMenuIcons = {
  language: icon(Languages),
  theme: icon(Moon),
  pin: icon(KeyRound),
  logout: icon(LogOut),
}

const permissionIcons: Record<PermissionMode, string> = {
  ask: icon(Hand),
  approve: icon(ShieldCheck),
  full: icon(ShieldAlert),
  custom: icon(Settings2),
}

const permissionCheckIcon = icon(Check)

const permissionOptionDefs: Array<{ mode: PermissionMode; labelKey: string; descriptionKey: string }> = [
  { mode: 'ask', labelKey: 'permission.ask.label', descriptionKey: 'permission.ask.description' },
  { mode: 'approve', labelKey: 'permission.approve.label', descriptionKey: 'permission.approve.description' },
  { mode: 'full', labelKey: 'permission.full.label', descriptionKey: 'permission.full.description' },
  { mode: 'custom', labelKey: 'permission.custom.label', descriptionKey: 'permission.custom.description' },
]

function permissionOptions(): Array<{ mode: PermissionMode; label: string; description: string }> {
  return permissionOptionDefs.map((option) => ({
    mode: option.mode,
    label: t(option.labelKey),
    description: t(option.descriptionKey),
  }))
}







const windowControlButtons = isMacPlatform
  ? `
    <button type="button" data-window-action="close" aria-label="Close">${windowIcons.close}</button>
    <button type="button" data-window-action="minimize" aria-label="Minimize">${windowIcons.minimize}</button>
    <button type="button" data-window-action="maximize" aria-label="Maximize or restore">${windowIcons.maximize}</button>
  `
  : `
    <button type="button" data-window-action="minimize" aria-label="Minimize">${windowIcons.minimize}</button>
    <button type="button" data-window-action="maximize" aria-label="Maximize or restore">${windowIcons.maximize}</button>
    <button type="button" data-window-action="close" aria-label="Close">${windowIcons.close}</button>
  `

app.innerHTML = `
  <main class="app-shell">
    <div class="top-window-drag-strip" aria-hidden="true"></div>
    <div class="window-control-rail global-window-controls" data-global-window-controls aria-label="Window controls">
      <div class="window-controls ${isMacPlatform ? 'traffic-lights' : ''}" aria-label="Window controls">
        ${windowControlButtons}
      </div>
    </div>
    <div class="seller-surface-tabs hidden" data-seller-surface-tabs></div>
    <div class="sidebar-chrome">
      <div class="workspace-toolbar" aria-label="Workspace tools">
        <button type="button" data-toolbar-action="toggle-sidebar" aria-label="Toggle sidebar" title="Toggle sidebar">${toolbarIcons.sidebarExpanded}</button>
      </div>
    </div>
    <aside class="task-sidebar">
      <div class="sidebar-resize-handle no-drag" data-sidebar-resize-handle role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin="${SIDEBAR_MIN_WIDTH}" aria-valuemax="${SIDEBAR_MAX_WIDTH}" tabindex="0" title="Resize sidebar"></div>
      <div class="sidebar-brand-row">
        <div class="sidebar-brand-identity" aria-label="Exora">
          <span class="sidebar-brand-name"><span class="sidebar-brand-exora">Exora</span> <span class="sidebar-brand-dock">Dock</span></span>
        </div>
        <button class="sidebar-brand-search no-drag" type="button" data-sidebar-action="search" aria-label="Search orders" title="Search orders">${toolbarIcons.search}</button>
      </div>
      <nav class="view-switch" aria-label="Workspace views">
        <div class="view-tab-cell"><button type="button" data-order-side-tab="buyer"><span class="tab-icon">${roleTabIcons.buyer}</span><span>Buyer</span></button></div>
        <div class="view-tab-cell"><button type="button" data-order-side-tab="seller"><span class="tab-icon">${roleTabIcons.seller}</span><span>Seller</span></button></div>
        <div class="settings-return-cell"><button type="button" data-action="return-from-settings"><span class="tab-icon">${toolbarIcons.back}</span><span>Settings</span></button></div>
      </nav>
      <div class="ledger-list" data-ledger-list>
        <div class="v3-history-state is-loading"><span class="v3-history-state-spinner" aria-hidden="true"></span><strong>Loading history&hellip;</strong></div>
      </div>
      <div class="profile-panel" aria-label="Personal profile">
        <button class="profile-identity" type="button" data-action="open-profile-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Open account menu" title="Account menu">
          <span class="profile-avatar profile-avatar-large" data-profile-avatar>E</span>
          <span class="profile-name" data-profile-name>Exora User</span>
        </button>
        <div class="profile-actions">
          <button class="profile-icon-button" type="button" data-action="open-wallet" aria-label="Open wallet" title="Wallet">${profileIcons.wallet}</button>
          <button class="profile-icon-button" type="button" data-action="open-settings" aria-label="Open settings" title="Settings">${profileIcons.settings}</button>
        </div>
        <div class="profile-menu hidden" data-profile-menu role="menu" aria-label="Account menu"></div>
      </div>
    </aside>

    <section class="main-workspace">
      <section class="workspace-view action-view" data-view-panel="action">
        <div class="decision-content" data-decision-content>
          <section class="v3-market-surface v3-seller-surface workspace-bootstrap-skeleton" aria-label="Opening Listings">
            <div class="v3-listing-loading"><span><i></i><b></b><em></em></span><span><i></i><b></b><em></em></span></div>
          </section>
        </div>
        <div class="v4-contract-drop-backdrop" aria-hidden="true"></div>
      </section>

      <section class="workspace-view app-settings-view hidden" data-view-panel="app-settings" aria-labelledby="app-settings-title">
        <div class="app-settings-loading" role="status">Opening settings…</div>
      </section>

    </section>
  </main>

  <div class="global-modal-layer" data-global-modal-layer>
    <div class="app-modal app-confirm-modal hidden" data-app-confirm-modal aria-hidden="true">
      <button class="app-modal-scrim" type="button" data-app-confirm-action="cancel" aria-label="Cancel confirmation"></button>
      <section class="app-modal-panel app-confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="app-confirm-title" aria-describedby="app-confirm-message">
        <header class="app-modal-head">
          <div class="app-modal-head-copy">
            <span class="app-modal-head-mark app-confirm-mark" aria-hidden="true">${icon(ShieldAlert)}</span>
            <div>
              <p class="eyebrow" data-app-confirm-eyebrow>Confirmation</p>
              <h2 id="app-confirm-title" data-app-confirm-title>Confirm action</h2>
              <span data-app-confirm-detail></span>
            </div>
          </div>
          <button class="app-modal-close" type="button" data-app-confirm-action="cancel" aria-label="Close confirmation" title="Close">${windowIcons.close}</button>
        </header>
        <div class="app-confirm-body">
          <p id="app-confirm-message" data-app-confirm-message></p>
          <div class="app-confirm-impact" data-app-confirm-impact>${icon(ShieldAlert)}<span></span></div>
        </div>
        <footer class="app-confirm-actions">
          <button class="app-setting-button outline" type="button" data-app-confirm-action="cancel">Cancel</button>
          <button class="app-setting-button danger" type="button" data-app-confirm-action="confirm" data-app-confirm-submit>Confirm</button>
        </footer>
      </section>
    </div>

    <div class="app-modal app-input-modal hidden" data-app-input-modal aria-hidden="true">
      <button class="app-modal-scrim" type="button" data-app-input-action="cancel" aria-label="Cancel input"></button>
      <section class="app-modal-panel app-input-panel" role="dialog" aria-modal="true" aria-labelledby="app-input-title" aria-describedby="app-input-message">
        <header class="app-modal-head">
          <div class="app-modal-head-copy">
            <span class="app-modal-head-mark" aria-hidden="true">${icon(KeyRound)}</span>
            <div>
              <p class="eyebrow" data-app-input-eyebrow>Secure input</p>
              <h2 id="app-input-title" data-app-input-title>Enter a value</h2>
              <span data-app-input-detail></span>
            </div>
          </div>
          <button class="app-modal-close" type="button" data-app-input-action="cancel" aria-label="Close input" title="Close">${windowIcons.close}</button>
        </header>
        <div class="app-input-body">
          <p id="app-input-message" data-app-input-message></p>
          <label><span data-app-input-label>Value</span><input data-app-input-field autocomplete="off" /></label>
        </div>
        <footer class="app-confirm-actions">
          <button class="app-setting-button outline" type="button" data-app-input-action="cancel">Cancel</button>
          <button class="app-setting-button" type="button" data-app-input-action="confirm" data-app-input-submit>Continue</button>
        </footer>
      </section>
    </div>

      <div class="app-modal wallet-modal hidden" data-wallet-modal aria-hidden="true">
            <button class="app-modal-scrim wallet-modal-scrim" type="button" data-action="close-wallet" aria-label="Close wallet"></button>
            <section class="app-modal-panel wallet-modal-panel" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title">
              <header class="app-modal-head wallet-modal-head">
                <div class="app-modal-head-copy wallet-modal-head-copy">
                  <span class="app-modal-head-mark wallet-modal-head-mark" aria-hidden="true">${profileIcons.wallet}</span>
                  <div>
                    <p class="eyebrow">Exora Wallet</p>
                    <h2 id="wallet-modal-title">Wallet</h2>
                    <span>Balance, transfers, receive address, and secure account access.</span>
                  </div>
                </div>
                <button class="app-modal-close wallet-modal-close" type="button" data-action="close-wallet" aria-label="Close wallet" title="Close">${windowIcons.close}</button>
              </header>
              <div class="wallet-modal-content">
          <section class="wallet-page">
            <div class="wallet-shell">
              <section class="wallet-balance-card" aria-label="Wallet balance">
                <div class="wallet-balance-topline">
                  <span class="wallet-balance-caption"><i aria-hidden="true"></i>Account balance</span>
                  <button class="wallet-refresh-button" type="button" data-action="wallet-refresh" aria-label="Refresh wallet" title="Refresh wallet">${toolbarIcons.refresh}</button>
                </div>
                <div class="wallet-balance-main">
                  <span>Available USDC</span>
                  <div><strong data-wallet-balance>0.00</strong><em>USDC</em></div>
                  <small data-wallet-balance-status>Syncing wallet</small>
                </div>
                <div class="wallet-balance-footer">
                  <div>
                    <span>Platform custody</span>
                    <code data-wallet-address-short>Not configured</code>
                  </div>
                  <span class="wallet-network-badge"><i aria-hidden="true"></i>Solana</span>
                </div>
                <nav class="wallet-panel-tabs" role="tablist" aria-label="Wallet tools">
                  <button class="wallet-panel-tab active" id="wallet-tab-receive" type="button" role="tab" aria-selected="true" aria-controls="wallet-panel-receive" data-wallet-tab="receive">
                    <span class="wallet-panel-icon">${walletSurfaceIcon}</span>
                    <span><strong>Receive</strong><small>QR and address</small></span>
                    <em class="wallet-status-pill" data-wallet-state>checking</em>
                  </button>
                  <button class="wallet-panel-tab" id="wallet-tab-withdraw" type="button" role="tab" aria-selected="false" aria-controls="wallet-panel-withdraw" data-wallet-tab="withdraw">
                    <span class="wallet-panel-icon wallet-panel-icon-send">${toolbarIcons.forward}</span>
                    <span><strong>Withdraw</strong><small>Send to a wallet</small></span>
                  </button>
                  <button class="wallet-panel-tab" id="wallet-tab-agent-limit" type="button" role="tab" aria-selected="false" aria-controls="wallet-panel-agent-limit" data-wallet-tab="agent-limit">
                    <span class="wallet-panel-icon wallet-panel-icon-limit">${icon(ShieldCheck)}</span>
                    <span><strong>Agent limit</strong><small>Automatic payments</small></span>
                    <em class="wallet-status-pill" data-wallet-limit-state>off</em>
                  </button>
                  <button class="wallet-panel-tab" id="wallet-tab-history" type="button" role="tab" aria-selected="false" aria-controls="wallet-panel-history" data-wallet-tab="history">
                    <span class="wallet-panel-icon wallet-panel-icon-history">${icon(Activity)}</span>
                    <span><strong>History</strong><small>Deposits and withdrawals</small></span>
                  </button>
                </nav>
              </section>

              <div class="wallet-panel-stage">
                <section class="wallet-panel wallet-receive-panel" id="wallet-panel-receive" role="tabpanel" aria-labelledby="wallet-tab-receive" data-wallet-panel="receive" data-wallet-receive>
                  <header class="wallet-panel-heading wallet-receive-heading">
                    <div><span>RECEIVE USDC</span><h3>Fund your Exora wallet</h3><p>Scan the QR code or copy your personal deposit address.</p></div>
                    <span class="wallet-panel-badge"><i aria-hidden="true"></i>Solana network</span>
                  </header>
                  <div class="wallet-receive-layout">
                    <div class="wallet-receive-body">
                      <div class="wallet-qr" data-wallet-qr><span>QR</span></div>
                    </div>
                    <div class="wallet-receive-details">
                      <div class="wallet-receive-meta">
                        <span>USDC on Solana</span>
                        <p>Only send native USDC on Solana. Other assets or networks cannot be recovered.</p>
                      </div>
                      <div class="wallet-address-row">
                        <div><span>Your deposit address</span><code data-wallet-address>not configured</code></div>
                        <button type="button" data-action="wallet-copy-address" aria-label="Copy wallet address" title="Copy address">${toolbarIcons.copy}</button>
                      </div>
                    </div>
                  </div>
                </section>

                <section class="wallet-panel wallet-withdraw-panel hidden" id="wallet-panel-withdraw" role="tabpanel" aria-labelledby="wallet-tab-withdraw" data-wallet-panel="withdraw">
                    <header class="wallet-panel-heading wallet-withdraw-heading">
                      <div><span>SECURE TRANSFER</span><h3>Withdraw USDC</h3><p>Confirm the transfer with your Cloud PIN, then enter the code sent to your email.</p></div>
                      <span class="wallet-panel-badge">PIN + Email</span>
                    </header>
                    <form class="wallet-withdraw-form" data-wallet-withdraw-form>
                      <label class="wallet-field wallet-destination-field">
                        <span>Destination address</span>
                        <input name="toAddress" type="text" spellcheck="false" autocomplete="off" placeholder="Solana address" required />
                      </label>
					  <div class="wallet-withdraw-fields">
                        <label class="wallet-field wallet-amount-field">
                          <span>Amount</span>
                          <div><input name="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" required /><button type="button" data-action="wallet-withdraw-max">Max</button></div>
                        </label>
						<label class="wallet-field wallet-code-field">
						  <span>Cloud payment PIN</span>
                          <span class="wallet-code-control masked" data-wallet-code-control>
                            <input name="paymentPin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6" aria-label="Six digit Cloud payment PIN" required />
                            <span class="wallet-code-cells" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
                          </span>
                          <small>Required to request the email code</small>
						</label>
						<label class="wallet-field wallet-code-field">
                          <span>Email verification code</span>
                          <span class="wallet-code-control plain" data-wallet-code-control>
                            <input name="emailCode" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" aria-label="Six digit email verification code" />
                            <span class="wallet-code-cells" aria-hidden="true">
                              <i></i><i></i><i></i><i></i><i></i><i></i>
                            </span>
                          </span>
                          <small>Available after PIN authorization</small>
                        </label>
                      </div>
                      <div class="wallet-withdraw-footer">
                        <small data-wallet-fee-note>Network fees are covered by Exora.</small>
                        <button type="submit" data-wallet-withdraw-submit>Authorize withdrawal</button>
                      </div>
                    </form>
					<div class="wallet-withdraw-status hidden" data-wallet-withdraw-status aria-live="polite"></div>
				</section>

                <section class="wallet-panel wallet-agent-limit-panel hidden" id="wallet-panel-agent-limit" role="tabpanel" aria-labelledby="wallet-tab-agent-limit" data-wallet-panel="agent-limit">
                  <header class="wallet-panel-heading">
                    <div><span>AGENT PAYMENT POLICY</span><h3>Automatic payment limits</h3><p>Agent purchases proceed automatically only while both limits remain available. Manual purchases are not counted.</p></div>
                    <label class="wallet-limit-toggle"><input type="checkbox" data-wallet-limit-enabled /><span></span><strong>Enable</strong></label>
                  </header>
                  <div class="wallet-limit-usage" data-wallet-limit-usage></div>
                  <section class="wallet-limit-config" aria-labelledby="wallet-limit-config-title">
                    <div class="wallet-limit-config-heading">
                      <div><strong id="wallet-limit-config-title">Policy thresholds</strong><span>Set the maximum amount an agent can spend automatically.</span></div>
                      <span>USDC</span>
                    </div>
                    <form class="wallet-limit-form" data-wallet-limit-form>
                      <div class="wallet-limit-thresholds">
                        <label class="wallet-field"><span>Per payment limit</span><div class="wallet-money-input"><input name="singleLimit" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" /><em>USDC</em></div></label>
                        <label class="wallet-field"><span>24-hour limit</span><div class="wallet-money-input"><input name="periodLimit" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" /><em>USDC</em></div></label>
                      </div>
                      <div class="wallet-limit-authorization">
                        <label class="wallet-field wallet-code-field"><span>Cloud payment PIN</span><span class="wallet-code-control masked" data-wallet-code-control><input name="paymentPin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6" aria-label="Six digit Cloud payment PIN" /><span class="wallet-code-cells" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></span><small>Required to save this policy</small></label>
                        <div class="wallet-limit-actions"><span data-wallet-limit-error aria-live="polite"></span><button type="submit" data-wallet-limit-save>Save limits</button></div>
                      </div>
                    </form>
                  </section>
                </section>

                <section class="wallet-panel wallet-history-panel hidden" id="wallet-panel-history" role="tabpanel" aria-labelledby="wallet-tab-history" data-wallet-panel="history">
                  <header class="wallet-panel-heading wallet-history-heading">
                    <div><span>FUNDS ACTIVITY</span><h3>Deposits and withdrawals</h3><p>Wallet funding activity only. Marketplace purchases remain in order history.</p></div>
                    <div class="wallet-history-filters" role="group" aria-label="History filter">
                      <button class="active" type="button" data-wallet-history-filter="all">All</button>
                      <button type="button" data-wallet-history-filter="deposit">Deposits</button>
                      <button type="button" data-wallet-history-filter="withdrawal">Withdrawals</button>
                    </div>
                  </header>
                  <section class="wallet-history" data-wallet-history aria-live="polite"></section>
                </section>
              </div>
            </div>
          </section>
              </div>
              <footer class="app-modal-footer wallet-modal-footer">
                <span>USDC on Solana · Platform custody</span>
                <span><kbd>Esc</kbd> to close</span>
              </footer>
            </section>
          </div>

    <div class="app-modal order-search-modal hidden" data-order-search-modal aria-hidden="true">
      <button class="app-modal-scrim order-search-scrim" type="button" data-action="close-order-search" aria-label="Close order search"></button>
      <section class="app-modal-panel order-search-panel" role="dialog" aria-modal="true" aria-labelledby="order-search-title">
        <header class="app-modal-head order-search-head">
          <div class="app-modal-head-copy order-search-head-copy">
            <span class="app-modal-head-mark order-search-head-mark" aria-hidden="true">${toolbarIcons.search}</span>
            <div>
              <p class="eyebrow">Exora Search</p>
              <h2 id="order-search-title" data-order-search-title>Search orders</h2>
              <span>Find activity across your current workspace.</span>
            </div>
          </div>
          <button class="app-modal-close order-search-close" type="button" data-action="close-order-search" aria-label="Close order search" title="Close">${windowIcons.close}</button>
        </header>
        <label class="order-search-field">
          <span aria-hidden="true">${toolbarIcons.search}</span>
          <input type="search" data-order-search-input placeholder="Search Order UID, title, status, counterparty, amount, or ID" aria-label="Search orders" autocomplete="off" />
        </label>
        <section class="order-search-result-drawer" aria-label="Search result drawer">
          <header>
            <span>Matching activity</span>
            <strong data-order-search-count>0 orders</strong>
          </header>
          <div class="order-search-results" data-order-search-results role="listbox" aria-label="Order search results"></div>
        </section>
        <footer class="app-modal-footer order-search-footer">
          <span>Searches the current Buyer or Seller workspace</span>
          <span><kbd>Esc</kbd> to close</span>
        </footer>
      </section>
    </div>

    <div class="app-modal pin-settings-modal hidden" data-pin-settings-modal aria-hidden="true">
      <button class="app-modal-scrim" type="button" data-pin-settings-action="close" aria-label="Close PIN settings"></button>
      <section class="app-modal-panel pin-settings-panel" role="dialog" aria-modal="true" aria-labelledby="pin-settings-title">
        <header class="app-modal-head">
          <div class="app-modal-head-copy">
            <span class="app-modal-head-mark" aria-hidden="true">${icon(KeyRound)}</span>
            <div>
              <p class="eyebrow" data-pin-settings-eyebrow>Account security</p>
              <h2 id="pin-settings-title" data-pin-settings-title>Change payment PIN</h2>
              <span data-pin-settings-detail>Enter your current PIN, then choose a new six-digit PIN.</span>
            </div>
          </div>
          <button class="app-modal-close" type="button" data-pin-settings-action="close" aria-label="Close PIN settings" title="Close">${windowIcons.close}</button>
        </header>
        <form class="pin-settings-form" data-pin-settings-form>
          <div class="pin-settings-progress" data-pin-settings-progress>
            <span data-pin-settings-progress-label>Step 1 of 4</span>
            <div aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          </div>
          <div class="pin-settings-stage">
            <label class="pin-settings-code-field" data-pin-settings-code-stage>
              <span data-pin-settings-code-label>Current PIN</span>
              <span class="wallet-code-control masked pin-settings-code-control" data-pin-settings-code-control>
                <input name="pinEntry" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6" aria-label="Current six digit payment PIN" required />
                <span class="wallet-code-cells" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
              </span>
              <small data-pin-settings-step-hint>Enter the PIN you currently use to approve payments.</small>
            </label>
            <section class="pin-settings-key-stage" data-pin-settings-key-stage hidden>
              <div class="pin-settings-key-notice"><strong>Save this account key now</strong><span>It is shown once and cannot be displayed again.</span></div>
              <label><span>Account key</span><code data-pin-settings-account-key></code></label>
              <button class="pin-settings-inline-button" type="button" data-pin-settings-action="copy-key">Copy account key</button>
            </section>
            <section class="pin-settings-agent-stage" data-pin-settings-agent-stage hidden>
              <div class="pin-settings-agent-list" data-pin-settings-agent-list></div>
              <button class="pin-settings-skip-agent" type="button" data-pin-settings-action="skip-agent">Skip for now</button>
            </section>
            <p class="pin-settings-message" data-pin-settings-message aria-live="polite"></p>
          </div>
          <div class="pin-settings-actions">
            <button class="secondary" type="button" data-pin-settings-action="back" data-pin-settings-cancel>Cancel</button>
            <button type="submit" data-pin-settings-submit>Continue</button>
          </div>
        </form>
        <footer class="app-modal-footer pin-settings-footer"><span data-pin-settings-footer>Your PIN protects sensitive account actions.</span><span data-pin-settings-escape><kbd>Esc</kbd> to close</span></footer>
      </section>
    </div>

    <div class="app-modal mcp-info-modal hidden" data-mcp-info-modal aria-hidden="true">
      <button class="app-modal-scrim" type="button" data-mcp-info-action="close" aria-label="Close Exora MCP guide"></button>
      <section class="app-modal-panel mcp-info-panel" role="dialog" aria-modal="true" aria-labelledby="mcp-info-title">
        <header class="app-modal-head">
          <div class="app-modal-head-copy">
            <span class="app-modal-head-mark" aria-hidden="true">${icon(Info)}</span>
            <div>
              <p class="eyebrow">Exora MCP</p>
              <h2 id="mcp-info-title" data-mcp-info-title></h2>
              <span data-mcp-info-subtitle></span>
            </div>
          </div>
          <button class="app-modal-close" type="button" data-mcp-info-action="close" aria-label="Close Exora MCP guide" title="Close">${windowIcons.close}</button>
        </header>
        <div class="mcp-info-body" data-mcp-info-body></div>
        <footer class="app-modal-footer"><span data-mcp-info-footer></span><span><kbd>Esc</kbd> to close</span></footer>
      </section>
    </div>

    <div class="app-modal agent-mcp-onboarding-modal hidden" data-agent-mcp-onboarding aria-hidden="true">
      <button class="app-modal-scrim" type="button" data-agent-mcp-action="later" aria-label="Set up Agent clients later"></button>
      <section class="app-modal-panel agent-mcp-onboarding-panel" role="dialog" aria-modal="true" aria-labelledby="agent-mcp-onboarding-title">
        <header class="app-modal-head">
          <div class="app-modal-head-copy">
            <span class="app-modal-head-mark" aria-hidden="true">${icon(Network)}</span>
            <div>
              <p class="eyebrow">Exora MCP</p>
              <h2 id="agent-mcp-onboarding-title" data-agent-mcp-onboarding-title>Connect your Agent clients</h2>
              <span data-agent-mcp-onboarding-subtitle>Choose the detected clients that should use Exora Dock.</span>
            </div>
          </div>
        </header>
        <div class="agent-mcp-onboarding-body" data-agent-mcp-onboarding-body></div>
        <footer class="agent-mcp-onboarding-actions">
          <button class="app-setting-button outline" type="button" data-agent-mcp-action="later">Not now</button>
          <button class="app-setting-button primary" type="button" data-agent-mcp-action="connect">Connect selected</button>
        </footer>
      </section>
    </div>
  </div>

  <div class="toast" data-message role="status" aria-live="polite" aria-atomic="true"></div>
`

installNativeTooltipBlocker()
installFileDropNavigationGuard()

const fields = {
  appShell: app.querySelector<HTMLElement>('.app-shell')!,
  taskSidebar: app.querySelector<HTMLElement>('.task-sidebar')!,
  daemon: app.querySelector<HTMLElement>('[data-daemon]')!,
  message: app.querySelector<HTMLElement>('[data-message]')!,
  profileIdentity: app.querySelector<HTMLButtonElement>('[data-action="open-profile-menu"]')!,
  profileAvatar: app.querySelector<HTMLElement>('[data-profile-avatar]')!,
  profileName: app.querySelector<HTMLElement>('[data-profile-name]')!,
  profileMenu: app.querySelector<HTMLElement>('[data-profile-menu]')!,
  walletButton: app.querySelector<HTMLButtonElement>('[data-action="open-wallet"]')!,
  walletModal: app.querySelector<HTMLElement>('[data-wallet-modal]')!,
  walletPanelTabs: Array.from(app.querySelectorAll<HTMLButtonElement>('[data-wallet-tab]')),
  walletPanels: Array.from(app.querySelectorAll<HTMLElement>('[data-wallet-panel]')),
  settingsButton: app.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!,
  ledgerList: app.querySelector<HTMLElement>('[data-ledger-list]')!,
  settingsReturnButton: app.querySelector<HTMLButtonElement>('[data-action="return-from-settings"]')!,
  permissionButton: app.querySelector<HTMLButtonElement>('[data-action="toggle-permission-menu"]'),
  permissionMenu: app.querySelector<HTMLElement>('[data-permission-menu]'),
  sellerSurfaceTabs: app.querySelector<HTMLElement>('[data-seller-surface-tabs]')!,
  mainKicker: app.querySelector<HTMLElement>('[data-main-kicker]')!,
  decisionTitle: app.querySelector<HTMLElement>('[data-decision-title]')!,
  decisionStep: app.querySelector<HTMLElement>('[data-decision-step]')!,
  decisionContent: app.querySelector<HTMLElement>('[data-decision-content]')!,
  actionView: app.querySelector<HTMLElement>('[data-view-panel="action"]')!,
  settingsView: app.querySelector<HTMLElement>('[data-view-panel="app-settings"]')!,
  appConfirmModal: app.querySelector<HTMLElement>('[data-app-confirm-modal]')!,
  appConfirmEyebrow: app.querySelector<HTMLElement>('[data-app-confirm-eyebrow]')!,
  appConfirmTitle: app.querySelector<HTMLElement>('[data-app-confirm-title]')!,
  appConfirmDetail: app.querySelector<HTMLElement>('[data-app-confirm-detail]')!,
  appConfirmMessage: app.querySelector<HTMLElement>('[data-app-confirm-message]')!,
  appConfirmImpact: app.querySelector<HTMLElement>('[data-app-confirm-impact]')!,
  appConfirmSubmit: app.querySelector<HTMLButtonElement>('[data-app-confirm-submit]')!,
  appInputModal: app.querySelector<HTMLElement>('[data-app-input-modal]')!,
  appInputEyebrow: app.querySelector<HTMLElement>('[data-app-input-eyebrow]')!,
  appInputTitle: app.querySelector<HTMLElement>('[data-app-input-title]')!,
  appInputDetail: app.querySelector<HTMLElement>('[data-app-input-detail]')!,
  appInputMessage: app.querySelector<HTMLElement>('[data-app-input-message]')!,
  appInputLabel: app.querySelector<HTMLElement>('[data-app-input-label]')!,
  appInputField: app.querySelector<HTMLInputElement>('[data-app-input-field]')!,
  appInputSubmit: app.querySelector<HTMLButtonElement>('[data-app-input-submit]')!,
  orderSearchModal: app.querySelector<HTMLElement>('[data-order-search-modal]')!,
  orderSearchTitle: app.querySelector<HTMLElement>('[data-order-search-title]')!,
  orderSearchInput: app.querySelector<HTMLInputElement>('[data-order-search-input]')!,
  orderSearchResults: app.querySelector<HTMLElement>('[data-order-search-results]')!,
  orderSearchCount: app.querySelector<HTMLElement>('[data-order-search-count]')!,
  pinSettingsModal: app.querySelector<HTMLElement>('[data-pin-settings-modal]')!,
  pinSettingsForm: app.querySelector<HTMLFormElement>('[data-pin-settings-form]')!,
  pinSettingsEyebrow: app.querySelector<HTMLElement>('[data-pin-settings-eyebrow]')!,
  pinSettingsTitle: app.querySelector<HTMLElement>('[data-pin-settings-title]')!,
  pinSettingsDetail: app.querySelector<HTMLElement>('[data-pin-settings-detail]')!,
  pinSettingsProgress: app.querySelector<HTMLElement>('[data-pin-settings-progress]')!,
  pinSettingsProgressLabel: app.querySelector<HTMLElement>('[data-pin-settings-progress-label]')!,
  pinSettingsCodeStage: app.querySelector<HTMLElement>('[data-pin-settings-code-stage]')!,
  pinSettingsCodeControl: app.querySelector<HTMLElement>('[data-pin-settings-code-control]')!,
  pinSettingsCodeInput: app.querySelector<HTMLInputElement>('[data-pin-settings-code-control] input')!,
  pinSettingsCodeLabel: app.querySelector<HTMLElement>('[data-pin-settings-code-label]')!,
  pinSettingsStepHint: app.querySelector<HTMLElement>('[data-pin-settings-step-hint]')!,
  pinSettingsKeyStage: app.querySelector<HTMLElement>('[data-pin-settings-key-stage]')!,
  pinSettingsAccountKey: app.querySelector<HTMLElement>('[data-pin-settings-account-key]')!,
  pinSettingsAgentStage: app.querySelector<HTMLElement>('[data-pin-settings-agent-stage]')!,
  pinSettingsAgentList: app.querySelector<HTMLElement>('[data-pin-settings-agent-list]')!,
  pinSettingsMessage: app.querySelector<HTMLElement>('[data-pin-settings-message]')!,
  pinSettingsSubmit: app.querySelector<HTMLButtonElement>('[data-pin-settings-submit]')!,
  pinSettingsCancel: app.querySelector<HTMLButtonElement>('[data-pin-settings-cancel]')!,
  pinSettingsFooter: app.querySelector<HTMLElement>('[data-pin-settings-footer]')!,
  mcpInfoModal: app.querySelector<HTMLElement>('[data-mcp-info-modal]')!,
  mcpInfoTitle: app.querySelector<HTMLElement>('[data-mcp-info-title]')!,
  mcpInfoSubtitle: app.querySelector<HTMLElement>('[data-mcp-info-subtitle]')!,
  mcpInfoBody: app.querySelector<HTMLElement>('[data-mcp-info-body]')!,
  mcpInfoFooter: app.querySelector<HTMLElement>('[data-mcp-info-footer]')!,
  agentMcpOnboarding: app.querySelector<HTMLElement>('[data-agent-mcp-onboarding]')!,
  agentMcpOnboardingTitle: app.querySelector<HTMLElement>('[data-agent-mcp-onboarding-title]')!,
  agentMcpOnboardingSubtitle: app.querySelector<HTMLElement>('[data-agent-mcp-onboarding-subtitle]')!,
  agentMcpOnboardingBody: app.querySelector<HTMLElement>('[data-agent-mcp-onboarding-body]')!,
  sidebarButton: app.querySelector<HTMLButtonElement>('[data-toolbar-action="toggle-sidebar"]')!,
  sidebarResizeHandle: app.querySelector<HTMLElement>('[data-sidebar-resize-handle]')!,
  walletState: app.querySelector<HTMLElement>('[data-wallet-state]')!,
  walletQR: app.querySelector<HTMLElement>('[data-wallet-qr]')!,
  walletAddress: app.querySelector<HTMLElement>('[data-wallet-address]')!,
  walletAddressShort: app.querySelector<HTMLElement>('[data-wallet-address-short]')!,
  walletBalance: app.querySelector<HTMLElement>('[data-wallet-balance]')!,
  walletBalanceStatus: app.querySelector<HTMLElement>('[data-wallet-balance-status]')!,
  walletFeeNote: app.querySelector<HTMLElement>('[data-wallet-fee-note]')!,
  walletCopyButton: app.querySelector<HTMLButtonElement>('[data-action="wallet-copy-address"]')!,
  walletWithdrawForm: app.querySelector<HTMLFormElement>('[data-wallet-withdraw-form]')!,
  walletCodeControls: Array.from(app.querySelectorAll<HTMLElement>('[data-wallet-code-control]')),
  walletEmailCodeInput: app.querySelector<HTMLInputElement>('input[name="emailCode"]')!,
  walletWithdrawButton: app.querySelector<HTMLButtonElement>('[data-wallet-withdraw-submit]')!,
  walletWithdrawStatus: app.querySelector<HTMLElement>('[data-wallet-withdraw-status]')!,
  walletLimitState: app.querySelector<HTMLElement>('[data-wallet-limit-state]')!,
  walletLimitEnabled: app.querySelector<HTMLInputElement>('[data-wallet-limit-enabled]')!,
  walletLimitUsage: app.querySelector<HTMLElement>('[data-wallet-limit-usage]')!,
  walletLimitForm: app.querySelector<HTMLFormElement>('[data-wallet-limit-form]')!,
  walletLimitSave: app.querySelector<HTMLButtonElement>('[data-wallet-limit-save]')!,
  walletLimitError: app.querySelector<HTMLElement>('[data-wallet-limit-error]')!,
  walletHistory: app.querySelector<HTMLElement>('[data-wallet-history]')!,
  walletHistoryFilters: Array.from(app.querySelectorAll<HTMLButtonElement>('[data-wallet-history-filter]')),
}

type AppConfirmationOptions = {
  eyebrow: string
  title: string
  detail: string
  message: string
  impact: string
  confirmLabel: string
  tone?: 'primary' | 'danger'
}

type AppInputOptions = {
  eyebrow: string
  title: string
  detail: string
  message: string
  label: string
  confirmLabel: string
  value?: string
  placeholder?: string
  type?: 'text' | 'password'
  readOnly?: boolean
  inputMode?: 'text' | 'numeric'
}

let appConfirmationResolve: ((confirmed: boolean) => void) | undefined
let appConfirmationReturnFocus: HTMLElement | null = null

function closeAppConfirmation(confirmed = false) {
  if (fields.appConfirmModal.classList.contains('hidden')) return
  fields.appConfirmModal.classList.add('hidden')
  fields.appConfirmModal.setAttribute('aria-hidden', 'true')
  const resolve = appConfirmationResolve
  const returnFocus = appConfirmationReturnFocus
  appConfirmationResolve = undefined
  appConfirmationReturnFocus = null
  resolve?.(confirmed)
  window.setTimeout(() => returnFocus?.focus(), 0)
}

function requestAppConfirmation(options: AppConfirmationOptions): Promise<boolean> {
  if (appConfirmationResolve) closeAppConfirmation(false)
  closeAppInput()
  closeProfileMenu()
  closeWalletModal()
  closeOrderSearch()
  closePINSettingsModal()
  closeMCPInfoModal()
  appConfirmationReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  fields.appConfirmEyebrow.textContent = options.eyebrow
  fields.appConfirmTitle.textContent = options.title
  fields.appConfirmDetail.textContent = options.detail
  fields.appConfirmMessage.textContent = options.message
  fields.appConfirmImpact.querySelector<HTMLElement>('span')!.textContent = options.impact
  fields.appConfirmSubmit.textContent = options.confirmLabel
  fields.appConfirmSubmit.classList.toggle('danger', options.tone !== 'primary')
  fields.appConfirmModal.classList.remove('hidden')
  fields.appConfirmModal.setAttribute('aria-hidden', 'false')
  window.setTimeout(() => fields.appConfirmSubmit.focus(), 0)
  return new Promise<boolean>((resolve) => { appConfirmationResolve = resolve })
}

function requestSimpleAppConfirmation(message: string, options: Partial<AppConfirmationOptions> = {}) {
  return requestAppConfirmation({
    eyebrow: options.eyebrow || 'Confirmation',
    title: options.title || 'Confirm action',
    detail: options.detail || '',
    message,
    impact: options.impact || 'Review the action before continuing.',
    confirmLabel: options.confirmLabel || 'Continue',
    tone: options.tone || 'primary',
  })
}

let appInputResolve: ((value: string | undefined) => void) | undefined
let appInputReturnFocus: HTMLElement | null = null

function closeAppInput(confirmed = false) {
  if (!fields?.appInputModal || fields.appInputModal.classList.contains('hidden')) return
  fields.appInputModal.classList.add('hidden')
  fields.appInputModal.setAttribute('aria-hidden', 'true')
  const resolve = appInputResolve
  const returnFocus = appInputReturnFocus
  const value = confirmed ? fields.appInputField.value : undefined
  appInputResolve = undefined
  appInputReturnFocus = null
  fields.appInputField.value = ''
  resolve?.(value)
  window.setTimeout(() => returnFocus?.focus(), 0)
}

function requestAppInput(options: AppInputOptions): Promise<string | undefined> {
  if (appInputResolve) closeAppInput(false)
  closeAppConfirmation(false)
  closeProfileMenu()
  closeWalletModal()
  closeOrderSearch()
  closePINSettingsModal()
  closeMCPInfoModal()
  appInputReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  fields.appInputEyebrow.textContent = options.eyebrow
  fields.appInputTitle.textContent = options.title
  fields.appInputDetail.textContent = options.detail
  fields.appInputMessage.textContent = options.message
  fields.appInputLabel.textContent = options.label
  fields.appInputSubmit.textContent = options.confirmLabel
  fields.appInputField.type = options.type || 'text'
  fields.appInputField.inputMode = options.inputMode || 'text'
  fields.appInputField.readOnly = Boolean(options.readOnly)
  fields.appInputField.value = options.value || ''
  fields.appInputField.placeholder = options.placeholder || ''
  fields.appInputModal.classList.remove('hidden')
  fields.appInputModal.setAttribute('aria-hidden', 'false')
  window.setTimeout(() => {
    fields.appInputField.focus()
    fields.appInputField.select()
  }, 0)
  return new Promise<string | undefined>((resolve) => { appInputResolve = resolve })
}

async function revealAccountKey(token: string, title = 'Account key created') {
  const value = await requestAppInput({
    eyebrow: 'Account security',
    title,
    detail: 'Shown once',
    message: 'Copy this key now. It will not be shown again.',
    label: 'Account key',
    confirmLabel: 'Copy key',
    value: token,
    readOnly: true,
  })
  if (value !== undefined) {
    await writeClipboardText(token)
    showToast('Account key copied.')
  }
}

fields.sellerSurfaceTabs.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-v3-seller-tab]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  const requestedTab = button.dataset.v3SellerTab as V3SellerTab
  if (requestedTab === 'buyer') state.v3ListingMode = 'buyer'
  const nextTab = normalizeV3SellerTab(requestedTab)
  if (!nextTab) return
  state.selectedV3ActivitySessionId = undefined
  state.v3ActivityDetail = undefined
  state.v3ActivityDetailError = undefined
  state.v3ActivityDetailLoading = false
  if (nextTab === state.v3SellerTab) { renderDecisionPanel(); return }
  state.v3SellerTab = nextTab
  renderDecisionPanel()
  fields.actionView.scrollTop = 0
})

fields.sellerSurfaceTabs.addEventListener('pointerdown', (event) => {
  if (!(event.target as HTMLElement).closest('[data-v3-seller-tab]')) return
  event.preventDefault()
  event.stopPropagation()
})

function hasDesktopBridge() {
  return Boolean(window.exora?.invoke)
}

function legacyStoredLanguage(): AppLanguage {
  return localStorage.getItem('exora.language') === 'zh' ? 'zh' : 'en'
}

function storedLanguage(): AppLanguage {
  return hasDesktopBridge() ? initialI18nLanguage() : legacyStoredLanguage()
}

function legacyStoredTheme(): AppTheme {
  const value = localStorage.getItem('exora.theme')
  return value === 'dark' || value === 'light' ? value : 'system'
}

function storedTheme(): AppTheme {
  return hasDesktopBridge() ? 'system' : legacyStoredTheme()
}

function legacyStoredPermissionMode(): PermissionMode {
  const value = localStorage.getItem('exora.permissionMode')
  return value === 'approve' || value === 'full' || value === 'custom' ? value : 'ask'
}

function storedPermissionMode(): PermissionMode {
  return hasDesktopBridge() ? 'ask' : legacyStoredPermissionMode()
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function normalizeSidebarWidth(value: unknown, fallback = DEFAULT_SIDEBAR_WIDTH) {
  return clampInteger(value, fallback, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
}

function legacyStoredSidebarWidth() {
  return normalizeSidebarWidth(localStorage.getItem('exora.sidebarWidth'))
}

function storedSidebarWidth() {
  return hasDesktopBridge() ? DEFAULT_SIDEBAR_WIDTH : legacyStoredSidebarWidth()
}














const state: {
  busy: boolean
  profileMenuOpen: boolean
  profileSubmenu?: ProfileSubmenu
  permissionMenuOpen: boolean
  permissionMode: PermissionMode
  signedOut: boolean
  authAccount?: CloudAuthAccount
  cloudAuthState?: CloudAuthState
  language: AppLanguage
  theme: AppTheme
  launchAtLogin: boolean
  startMinimized: boolean
  closeBehavior: CloseBehavior
  downloadDirectory: string
  notifications: NotificationPreferences
  settingsSystemStatus?: DesktopSystemStatus
  settingsStatusLoading: boolean
  settingsStatusError?: string
  activeSettingsView: SettingsView
  settingsOpen: boolean
  pinSettingsModalOpen: boolean
  pinSettingsBusy: boolean
  pinSettingsMode: 'setup' | 'change'
  pinSettingsSetupStep: 'current' | 'entry' | 'confirmation' | 'account_key' | 'agent'
  pinSettingsCurrentValue: string
  pinSettingsSetupValue: string
  pinSettingsAccountKeyValue: string
  cloudPaymentPINConfigured?: boolean
  accountAPIKeyStatus?: AccountAPIKeyStatus
  agentSessionPolicy?: AgentSessionPolicy
  agentMcpClients: AgentMcpClientStatus[]
  agentMcpBusy: boolean
  agentMcpOnboardingVersion: number
  agentMcpOnboardingOpen: boolean
  agentMcpSelected: string[]
  mcpInfoModalOpen: boolean
  walletModalOpen: boolean
  walletPanel: WalletPanel
  walletStatus?: WalletStatus
  walletWithdrawal?: WalletWithdrawal
  walletWithdrawalChallenge?: WalletWithdrawalChallenge
  walletWithdrawalBusy: boolean
  walletWithdrawalError?: string
  walletSpendBusy: boolean
  walletSpendError?: string
  walletHistoryFilter: WalletHistoryFilter
  appStatus?: AppStatus
  workOrderSide: OrderSide
  sidebarCollapsed: boolean
  sidebarWidth: number
  statusLoading: boolean
  v3Products: V3Product[]
  v3CatalogListings: V3CatalogListing[]
  v3CatalogQuery: string
  v3CatalogLoading: boolean
  v3CatalogLoaded: boolean
  v3CatalogError?: string
  v3SelectedProduct?: V3Product
  v3SelectedCatalogListingId?: string
  v3ListingScopeFilter: 'all' | 'market' | 'mine'
  v3ListingQuery: string
  v3ListingMode: 'buyer' | 'seller'
  v3APIOrder?: V3APIOrder
  v3APIOrderBusy: boolean
  v3ApprovalBusyId?: string
  v3ActivitySessions: Record<OrderSide, V3ActivitySession[]>
  v3ActivityLoaded: Record<OrderSide, boolean>
  v3ActivityLoading: Record<OrderSide, boolean>
  v3ActivityErrors: Partial<Record<OrderSide, string>>
  v3ActivityBucket: Record<OrderSide, V3ActivityBucket>
  v3ActivityArchiveMarkers: V3ActivityArchiveMarker[]
  v3ActivityArchiveUndo?: { marker: V3ActivityArchiveMarker; side: OrderSide }
  selectedV3ActivitySessionId?: string
  v3ActivityDetail?: V3ActivityDetail
  v3ActivityDetailLoading: boolean
  v3ActivityDetailError?: string
  v3SellerTab: V3SellerTab
  v3Listings: V3Listing[]
  v3ListingApplications: V3ListingApplication[]
  v3ListingsLoading: boolean
  v3ListingsLoaded: boolean
  v3HighlightedListingId?: string
  v3ExpandedListingId?: string
  v3SellerError?: string
} = {
  busy: false,
  profileMenuOpen: false,
  profileSubmenu: undefined,
  permissionMenuOpen: false,
  permissionMode: storedPermissionMode(),
  signedOut: false,
  authAccount: undefined,
  cloudAuthState: undefined,
  language: storedLanguage(),
  theme: storedTheme(),
  launchAtLogin: false,
  startMinimized: false,
  closeBehavior: 'tray',
  downloadDirectory: '',
  notifications: {
    approvals: true, apiActivity: true, billing: true,
    providerApis: true, security: true,
  },
  settingsSystemStatus: undefined,
  settingsStatusLoading: false,
  settingsStatusError: undefined,
  activeSettingsView: 'general',
  settingsOpen: false,
  pinSettingsModalOpen: false,
  pinSettingsBusy: false,
  pinSettingsMode: 'change',
  pinSettingsSetupStep: 'current',
  pinSettingsCurrentValue: '',
  pinSettingsSetupValue: '',
  pinSettingsAccountKeyValue: '',
  cloudPaymentPINConfigured: undefined,
  accountAPIKeyStatus: undefined,
  agentSessionPolicy: undefined,
  agentMcpClients: [],
  agentMcpBusy: false,
  agentMcpOnboardingVersion: 0,
  agentMcpOnboardingOpen: false,
  agentMcpSelected: [],
  mcpInfoModalOpen: false,
  walletModalOpen: false,
  walletPanel: 'receive',
  walletWithdrawal: undefined,
  walletWithdrawalChallenge: undefined,
  walletWithdrawalBusy: false,
  walletWithdrawalError: undefined,
  walletSpendBusy: false,
  walletSpendError: undefined,
  walletHistoryFilter: 'all',
  workOrderSide: 'buyer',
  sidebarCollapsed: false,
  sidebarWidth: storedSidebarWidth(),
  statusLoading: false,
  v3Products: [],
  v3CatalogListings: [],
  v3CatalogQuery: '',
  v3CatalogLoading: false,
  v3CatalogLoaded: false,
  v3SelectedCatalogListingId: undefined,
  v3ListingScopeFilter: 'all',
  v3ListingQuery: '',
  v3ListingMode: 'buyer',
  v3APIOrder: undefined,
  v3APIOrderBusy: false,
  v3ApprovalBusyId: undefined,
  v3ActivitySessions: { buyer: [], seller: [] },
  v3ActivityLoaded: { buyer: false, seller: false },
  v3ActivityLoading: { buyer: false, seller: false },
  v3ActivityErrors: {},
  v3ActivityBucket: { buyer: 'current', seller: 'current' },
  v3ActivityArchiveMarkers: [],
  v3ActivityArchiveUndo: undefined,
  selectedV3ActivitySessionId: undefined,
  v3ActivityDetail: undefined,
  v3ActivityDetailLoading: false,
  v3ActivityDetailError: undefined,
  v3SellerTab: 'buyer',
  v3Listings: [],
  v3ListingApplications: [],
  v3ListingsLoading: false,
  v3ListingsLoaded: false,
  v3HighlightedListingId: undefined,
  v3ExpandedListingId: undefined,
}

let settingsPersistenceReady = false
let appSettingsSaveTimer: number | undefined
let agentPermissionSaveTimer: number | undefined
let sidebarResizePointerId: number | undefined
let toastTimer: number | undefined
let activityAccountRevision = 0
let accountContextRevision = 0

function localize(root: ParentNode = app) {
  setI18nLanguage(state.language)
  translateDom(root, state.language)
}

function uiText(value: string) {
  return translatePhrase(value, state.language)
}

function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'en' || value === 'zh'
}

function isAppTheme(value: unknown): value is AppTheme {
  return value === 'system' || value === 'light' || value === 'dark'
}


function isOrderSide(value: unknown): value is OrderSide {
  return value === 'buyer' || value === 'seller'
}



function legacyAppSettingsSnapshot(): PersistedAppSettings {
  return {
    language: legacyStoredLanguage(),
    theme: legacyStoredTheme(),
    sidebarWidth: legacyStoredSidebarWidth(),
  }
}

function normalizeActivitySessionSnapshot(value: unknown): V3ActivitySession | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Partial<V3ActivitySession>
  if (!input.sessionId || !isOrderSide(input.role) || !input.productKind || !input.updatedAt) return undefined
  return {
    sessionId: String(input.sessionId),
    orderUid: String(input.orderUid || ''),
    activitySessionId: input.activitySessionId ? String(input.activitySessionId) : undefined,
    role: input.role,
    productKind: String(input.productKind),
    productId: String(input.productId || ''),
    listingId: String(input.listingId || ''),
    productTitle: String(input.productTitle || ''),
    counterpartyId: input.counterpartyId ? String(input.counterpartyId) : undefined,
    counterpartyLabel: String(input.counterpartyLabel || ''),
    status: String(input.status || 'completed'),
    outcome: String(input.outcome || ''),
    attentionRequired: Boolean(input.attentionRequired),
    inFlightCount: Math.max(0, Number(input.inFlightCount || 0)),
    itemCount: Math.max(0, Number(input.itemCount || 0)),
    amountAtomic: Number(input.amountAtomic || 0),
    grossAmountAtomic: Number(input.grossAmountAtomic || 0),
    platformFeeAtomic: Number(input.platformFeeAtomic || 0),
    asset: String(input.asset || 'USDC'),
    startedAt: String(input.startedAt || input.updatedAt),
    updatedAt: String(input.updatedAt),
    endedAt: input.endedAt ? String(input.endedAt) : undefined,
    retainUntil: input.retainUntil ? String(input.retainUntil) : undefined,
  }
}

function normalizeActivityArchiveMarkers(value: unknown): V3ActivityArchiveMarker[] {
  if (!Array.isArray(value)) return []
  return value.slice(-200).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const input = entry as Partial<V3ActivityArchiveMarker>
    if (!input.id || !input.archiveKey || !isOrderSide(input.role) || !input.productKind || !input.archivedAt || !input.archivedThrough) return []
    const records = Array.isArray(input.records) ? input.records.map(normalizeActivitySessionSnapshot).filter((item): item is V3ActivitySession => Boolean(item)) : []
    const baselines = Array.isArray(input.baselines) ? input.baselines.map(normalizeActivitySessionSnapshot).filter((item): item is V3ActivitySession => Boolean(item)) : []
    if (!records.length || !baselines.length) return []
    const detailAfterBySession = input.detailAfterBySession && typeof input.detailAfterBySession === 'object' && !Array.isArray(input.detailAfterBySession)
      ? Object.fromEntries(Object.entries(input.detailAfterBySession).filter(([, timestamp]) => typeof timestamp === 'string'))
      : undefined
    return [{ id: String(input.id), accountId: input.accountId ? String(input.accountId) : undefined, archiveKey: String(input.archiveKey), role: input.role, productKind: String(input.productKind), archivedAt: String(input.archivedAt), archivedThrough: String(input.archivedThrough), records, baselines, detailAfterBySession, deleted: input.deleted === true }]
  })
}

function normalizePersistedSettings(value: unknown): PersistedAppSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as PersistedAppSettings : {}
  return {
    language: isAppLanguage(input.language) ? input.language : undefined,
    theme: isAppTheme(input.theme) ? input.theme : undefined,
    workOrderSide: isOrderSide(input.workOrderSide) ? input.workOrderSide : undefined,
    sidebarCollapsed: typeof input.sidebarCollapsed === 'boolean' ? input.sidebarCollapsed : undefined,
    sidebarWidth: input.sidebarWidth === undefined ? undefined : normalizeSidebarWidth(input.sidebarWidth),
    activityArchiveMarkers: normalizeActivityArchiveMarkers(input.activityArchiveMarkers),
    launchAtLogin: typeof input.launchAtLogin === 'boolean' ? input.launchAtLogin : undefined,
    startMinimized: typeof input.startMinimized === 'boolean' ? input.startMinimized : undefined,
    closeBehavior: input.closeBehavior === 'tray' || input.closeBehavior === 'quit' ? input.closeBehavior : undefined,
    downloadDirectory: typeof input.downloadDirectory === 'string' ? input.downloadDirectory : undefined,
    notifications: normalizeNotificationPreferences(input.notifications),
    agentMcpOnboardingVersion: Number.isFinite(input.agentMcpOnboardingVersion) ? Math.max(0, Math.floor(Number(input.agentMcpOnboardingVersion))) : undefined,
  }
}

function normalizeNotificationPreferences(value: unknown): Partial<NotificationPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Partial<NotificationPreferences> & Record<string, unknown>
  const normalized = Object.fromEntries((['approvals', 'apiActivity', 'billing', 'providerApis', 'security'] as NotificationPreferenceKey[])
    .flatMap((key) => typeof input[key] === 'boolean' ? [[key, input[key]]] : [])) as Partial<NotificationPreferences>
  // Migrate the pre API-only categories without keeping retired keys alive.
  if (normalized.apiActivity === undefined && typeof input.purchases === 'boolean') normalized.apiActivity = input.purchases
  if (normalized.billing === undefined) {
    const legacyBilling = [input.purchases, input.wallet].filter((item): item is boolean => typeof item === 'boolean')
    if (legacyBilling.length) normalized.billing = legacyBilling.every(Boolean)
  }
  if (normalized.providerApis === undefined) {
    const legacyProvider = [input.sellerOrders, input.sellerListings].filter((item): item is boolean => typeof item === 'boolean')
    if (legacyProvider.length) normalized.providerApis = legacyProvider.every(Boolean)
  }
  return normalized
}

function mergePersistedSettings(fallback: PersistedAppSettings, value: PersistedAppSettings): PersistedAppSettings {
  return {
    language: value.language ?? fallback.language,
    theme: value.theme ?? fallback.theme,
    workOrderSide: value.workOrderSide ?? fallback.workOrderSide,
    sidebarCollapsed: value.sidebarCollapsed ?? fallback.sidebarCollapsed,
    sidebarWidth: value.sidebarWidth ?? fallback.sidebarWidth,
    activityArchiveMarkers: value.activityArchiveMarkers ?? fallback.activityArchiveMarkers,
    launchAtLogin: value.launchAtLogin ?? fallback.launchAtLogin,
    startMinimized: value.startMinimized ?? fallback.startMinimized,
    closeBehavior: value.closeBehavior ?? fallback.closeBehavior,
    downloadDirectory: value.downloadDirectory ?? fallback.downloadDirectory,
    notifications: { ...fallback.notifications, ...value.notifications },
    agentMcpOnboardingVersion: value.agentMcpOnboardingVersion ?? fallback.agentMcpOnboardingVersion,
  }
}


function applyPersistedSettings(settings: PersistedAppSettings) {
  if (settings.language) state.language = settings.language
  if (settings.theme) state.theme = settings.theme
  if (settings.workOrderSide) {
    state.workOrderSide = settings.workOrderSide
  }
  if (typeof settings.sidebarCollapsed === 'boolean') state.sidebarCollapsed = settings.sidebarCollapsed
  if (typeof settings.sidebarWidth === 'number') state.sidebarWidth = normalizeSidebarWidth(settings.sidebarWidth)
  if (settings.activityArchiveMarkers) state.v3ActivityArchiveMarkers = settings.activityArchiveMarkers
  if (typeof settings.launchAtLogin === 'boolean') state.launchAtLogin = settings.launchAtLogin
  if (typeof settings.startMinimized === 'boolean') state.startMinimized = settings.startMinimized
  if (settings.closeBehavior) state.closeBehavior = settings.closeBehavior
  if (typeof settings.downloadDirectory === 'string') state.downloadDirectory = settings.downloadDirectory
  if (typeof settings.agentMcpOnboardingVersion === 'number') state.agentMcpOnboardingVersion = settings.agentMcpOnboardingVersion
  state.notifications = { ...state.notifications, ...settings.notifications }
}

function appSettingsSnapshot(): PersistedAppSettings {
  return {
    language: state.language,
    theme: state.theme,
    workOrderSide: state.workOrderSide,
    sidebarCollapsed: state.sidebarCollapsed,
    sidebarWidth: state.sidebarWidth,
    activityArchiveMarkers: state.v3ActivityArchiveMarkers,
    launchAtLogin: state.launchAtLogin,
    startMinimized: state.startMinimized,
    closeBehavior: state.closeBehavior,
    downloadDirectory: state.downloadDirectory,
    notifications: state.notifications,
    agentMcpOnboardingVersion: state.agentMcpOnboardingVersion,
  }
}

function scheduleSaveAppSettings(delay = APP_SETTINGS_SAVE_DELAY) {
  if (!settingsPersistenceReady) return
  if (appSettingsSaveTimer !== undefined) window.clearTimeout(appSettingsSaveTimer)
  appSettingsSaveTimer = window.setTimeout(() => {
    appSettingsSaveTimer = undefined
    void saveAppSettingsNow()
  }, delay)
}

async function saveAppSettingsNow() {
  const settings = appSettingsSnapshot()
  if (!hasDesktopBridge()) {
    localStorage.setItem('exora.language', settings.language || 'en')
    localStorage.setItem('exora.theme', settings.theme || 'light')
    localStorage.setItem('exora.sidebarWidth', String(settings.sidebarWidth || DEFAULT_SIDEBAR_WIDTH))
    localStorage.setItem('exora.activityArchiveMarkers', JSON.stringify(settings.activityArchiveMarkers || []))
    return
  }
  try {
    await invoke('save_app_settings', { input: { settings } })
  } catch (error) {
    console.warn('Failed to save app settings:', error)
  }
}

async function hydrateDesktopPersistence() {
  if (!hasDesktopBridge()) {
    try {
      state.v3ActivityArchiveMarkers = normalizeActivityArchiveMarkers(JSON.parse(localStorage.getItem('exora.activityArchiveMarkers') || '[]'))
    } catch {
      state.v3ActivityArchiveMarkers = []
    }
    settingsPersistenceReady = true
    return
  }
  try {
    const payload = await invoke<DesktopPersistenceLoad>('app_settings_load')
    applyPersistedSettings(mergePersistedSettings(legacyAppSettingsSnapshot(), normalizePersistedSettings(payload.settings)))
  } catch (error) {
    console.warn('Failed to load desktop persistence:', error)
  } finally {
    settingsPersistenceReady = true
    scheduleSaveAppSettings(0)
  }
}

function applySidebarWidth() {
  const width = normalizeSidebarWidth(state.sidebarWidth)
  state.sidebarWidth = width
  fields.appShell.style.setProperty('--sidebar-width', `${width}px`)
  fields.sidebarResizeHandle.setAttribute('aria-valuenow', String(width))
  fields.sidebarResizeHandle.setAttribute('aria-valuetext', `${width}px`)
}

function sidebarWidthFromPointer(event: PointerEvent) {
  const shellRect = fields.appShell.getBoundingClientRect()
  const shellStyle = window.getComputedStyle(fields.appShell)
  const shellPaddingLeft = Number.parseFloat(shellStyle.paddingLeft) || 0
  return normalizeSidebarWidth(event.clientX - shellRect.left - shellPaddingLeft, state.sidebarWidth)
}

function updateSidebarWidthFromPointer(event: PointerEvent) {
  const width = sidebarWidthFromPointer(event)
  if (width === state.sidebarWidth) return
  state.sidebarWidth = width
  applySidebarWidth()
}

function stopSidebarResize(event?: PointerEvent) {
  if (sidebarResizePointerId === undefined) return
  const pointerId = sidebarResizePointerId
  sidebarResizePointerId = undefined
  if (event && event.pointerId === pointerId) updateSidebarWidthFromPointer(event)
  if (fields.sidebarResizeHandle.hasPointerCapture(pointerId)) {
    fields.sidebarResizeHandle.releasePointerCapture(pointerId)
  }
  fields.appShell.classList.remove('sidebar-resizing')
  scheduleSaveAppSettings()
}

function renderChromeControls() {
  applySidebarWidth()
  const sidebarCollapsed = state.sidebarCollapsed
  const sidebarCollapsedValue = String(sidebarCollapsed)
  fields.appShell.classList.toggle('sidebar-collapsed', sidebarCollapsed)
  if (fields.sidebarButton.dataset.sidebarCollapsed !== sidebarCollapsedValue) {
    fields.sidebarButton.innerHTML = sidebarCollapsed ? toolbarIcons.sidebarCollapsed : toolbarIcons.sidebarExpanded
    fields.sidebarButton.dataset.sidebarCollapsed = sidebarCollapsedValue
  }
  fields.sidebarButton.setAttribute('aria-pressed', sidebarCollapsedValue)
  fields.sidebarButton.setAttribute('aria-label', sidebarCollapsed ? t('chrome.showSidebar') : t('chrome.hideSidebar'))
  fields.sidebarButton.setAttribute('title', sidebarCollapsed ? t('chrome.showSidebar') : t('chrome.hideSidebar'))
  fields.sidebarButton.disabled = false
}

function setSidebarCollapsed(collapsed: boolean) {
  if (state.sidebarCollapsed === collapsed) return
  state.sidebarCollapsed = collapsed
  renderChromeControls()
  scheduleSaveAppSettings()
}

function renderProfileSummary() {
  const name = state.signedOut ? t('app.signedOut') : profileDisplayName()
  fields.profileName.textContent = name
  fields.profileAvatar.textContent = profileInitial(name)
  fields.profileIdentity.classList.toggle('active', state.profileMenuOpen)
  fields.profileIdentity.setAttribute('aria-expanded', String(state.profileMenuOpen))
  fields.walletButton.classList.toggle('active', state.walletModalOpen)
  fields.walletButton.setAttribute('aria-pressed', String(state.walletModalOpen))
  fields.settingsButton.classList.toggle('active', state.settingsOpen)
  fields.settingsButton.setAttribute('aria-pressed', String(state.settingsOpen))
  renderProfileMenu()
}

function profileDisplayName() {
  const accountEmail = state.authAccount?.email?.trim()
  return accountEmail || t('app.userFallback')
}

function profileInitial(name: string) {
  const first = Array.from(name.trim()).find((char) => /\p{L}|\p{N}/u.test(char))
  return first ? first.toUpperCase() : 'E'
}

function applyUserPreferences() {
  setI18nLanguage(state.language)
  document.documentElement.dataset.theme = authPresentationActive ? 'light' : effectiveTheme()
  document.documentElement.dataset.themePreference = state.theme
  document.documentElement.dataset.language = state.language
  document.documentElement.lang = htmlLangForLanguage(state.language)
}

function activePermissionOption() {
  const options = permissionOptions()
  return options.find((option) => option.mode === state.permissionMode) || options[0]
}

function renderPermissionControl() {
  if (!fields.permissionButton || !fields.permissionMenu) return
  const active = activePermissionOption()
  fields.permissionButton.innerHTML = `
    <span class="permission-button-icon permission-icon-${active.mode}">${permissionIcons[active.mode]}</span>
    <span class="permission-button-label">${escapeHTML(active.label)}</span>
  `
  fields.permissionButton.setAttribute('aria-expanded', String(state.permissionMenuOpen))
  fields.permissionButton.setAttribute('title', `${active.label}: ${active.description}`)
  fields.permissionMenu.classList.toggle('hidden', !state.permissionMenuOpen)
  if (!state.permissionMenuOpen) {
    fields.permissionMenu.innerHTML = ''
    return
  }
  fields.permissionMenu.innerHTML = permissionOptions().map((option) => `
    <button class="permission-menu-item ${option.mode === state.permissionMode ? 'active' : ''}" type="button" data-permission-mode="${option.mode}" role="menuitem">
      <span class="permission-menu-icon permission-icon-${option.mode}">${permissionIcons[option.mode]}</span>
      <span class="permission-menu-text">
        <strong>${escapeHTML(option.label)}</strong>
        <small>${escapeHTML(option.description)}</small>
      </span>
      <span class="permission-menu-check">${option.mode === state.permissionMode ? permissionCheckIcon : ''}</span>
    </button>
  `).join('')
  localize(fields.permissionMenu)
}


function closePermissionMenu(render = true) {
  if (!state.permissionMenuOpen) return
  state.permissionMenuOpen = false
  if (render) renderPermissionControl()
}

function setPermissionMode(mode: PermissionMode) {
  state.permissionMode = mode
  if (!hasDesktopBridge()) localStorage.setItem('exora.permissionMode', mode)
  scheduleSaveAppSettings()
  closePermissionMenu(false)
  renderPermissionControl()
}

fields.permissionMenu?.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLButtonElement>('[data-permission-mode]')
  if (!button || !fields.permissionMenu?.contains(button)) return
  const mode = button.dataset.permissionMode as PermissionMode
  if (!permissionOptions().some((option) => option.mode === mode)) return
  setPermissionMode(mode)
})

function effectiveTheme(): 'light' | 'dark' {
  if (state.theme !== 'system') return state.theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}



function profileMenuCopy() {
  return {
    signOut: state.signedOut ? t('profile.signedOut') : t('profile.signOut'),
    changePin: state.language === 'zh' ? '修改支付 PIN' : 'Change payment PIN',
    language: t('profile.language'),
    theme: t('profile.theme'),
    system: state.language === 'zh' ? '跟随系统' : 'System',
    english: t('profile.english'),
    chinese: t('profile.chinese'),
    light: t('profile.light'),
    dark: t('profile.dark'),
  }
}

function renderProfileMenu() {
  fields.profileMenu.classList.toggle('hidden', !state.profileMenuOpen)
  if (!state.profileMenuOpen) return
  const copy = profileMenuCopy()
  fields.profileMenu.innerHTML = `
    <button class="profile-menu-item ${state.profileSubmenu === 'language' ? 'active' : ''}" type="button" data-profile-submenu="language" role="menuitem" aria-haspopup="menu" aria-expanded="${state.profileSubmenu === 'language'}">
      <span class="profile-menu-icon">${profileMenuIcons.language}</span>
      <span class="profile-menu-label">${escapeHTML(copy.language)}</span>
      <span class="profile-menu-chevron">${toolbarIcons.disclosure}</span>
    </button>
    <button class="profile-menu-item ${state.profileSubmenu === 'theme' ? 'active' : ''}" type="button" data-profile-submenu="theme" role="menuitem" aria-haspopup="menu" aria-expanded="${state.profileSubmenu === 'theme'}">
      <span class="profile-menu-icon">${profileMenuIcons.theme}</span>
      <span class="profile-menu-label">${escapeHTML(copy.theme)}</span>
      <span class="profile-menu-chevron">${toolbarIcons.disclosure}</span>
    </button>
    <button class="profile-menu-item" type="button" data-profile-action="change-pin" role="menuitem">
      <span class="profile-menu-icon">${profileMenuIcons.pin}</span>
      <span class="profile-menu-label">${escapeHTML(copy.changePin)}</span>
    </button>
    <button class="profile-menu-item" type="button" data-profile-action="sign-out" role="menuitem" ${state.signedOut ? 'disabled' : ''}>
      <span class="profile-menu-icon">${profileMenuIcons.logout}</span>
      <span class="profile-menu-label">${escapeHTML(copy.signOut)}</span>
    </button>
    ${renderProfileSubmenu(copy)}
  `
  localize(fields.profileMenu)
}

function renderProfileSubmenu(copy: ReturnType<typeof profileMenuCopy>) {
  if (state.profileSubmenu === 'language') {
    return `
      <div class="profile-submenu language" role="menu" aria-label="${escapeAttr(copy.language)}">
        ${renderProfileChoice('language', 'en', copy.english, state.language === 'en')}
        ${renderProfileChoice('language', 'zh', copy.chinese, state.language === 'zh')}
      </div>
    `
  }
  if (state.profileSubmenu === 'theme') {
    return `
      <div class="profile-submenu theme" role="menu" aria-label="${escapeAttr(copy.theme)}">
        ${renderProfileChoice('theme', 'system', copy.system, state.theme === 'system')}
        ${renderProfileChoice('theme', 'light', copy.light, state.theme === 'light')}
        ${renderProfileChoice('theme', 'dark', copy.dark, state.theme === 'dark')}
      </div>
    `
  }
  return ''
}

function renderProfileChoice(kind: ProfileSubmenu, value: string, label: string, active: boolean) {
  return `
    <button class="profile-submenu-item ${active ? 'active' : ''}" type="button" data-profile-choice="${kind}" data-profile-value="${escapeAttr(value)}" role="menuitemradio" aria-checked="${active}">
      <span>${escapeHTML(label)}</span>
      <span class="profile-choice-check">${active ? '✓' : ''}</span>
    </button>
  `
}

function closeProfileMenu() {
  if (!state.profileMenuOpen) return
  state.profileMenuOpen = false
  state.profileSubmenu = undefined
  renderProfileSummary()
}

function toggleProfileMenu() {
  state.profileMenuOpen = !state.profileMenuOpen
  if (!state.profileMenuOpen) state.profileSubmenu = undefined
  renderProfileSummary()
}

async function signOutProfile() {
  state.profileMenuOpen = false
  state.profileSubmenu = undefined
  if (!await requestSimpleAppConfirmation('Every live API owned by this account will be taken offline before the Cloud session and Provider Dock link are removed.', {
    eyebrow: 'Sign out protection',
    title: 'Take your APIs offline and sign out?',
    detail: 'New invocations will be blocked first. Any unfinished fulfillment will be force-stopped and must be refunded.',
    impact: 'Your API drafts remain available after the next sign-in, but they will no longer be listed.',
    confirmLabel: 'Take offline & sign out',
    tone: 'danger',
  })) return
  try {
    const next = await invoke<CloudAuthState>('auth_logout')
    authGate.applyState(next)
  } catch (error) {
    showToast(humanizeError(error))
  }
}

function openProfileSubmenu(submenu: ProfileSubmenu) {
  if (state.profileSubmenu === submenu) return
  state.profileSubmenu = submenu
  renderProfileSummary()
}

function clearProfileSubmenu() {
  if (!state.profileSubmenu) return
  state.profileSubmenu = undefined
  renderProfileSummary()
}

function setLanguage(language: AppLanguage) {
  state.language = normalizeAppLanguage(language)
  if (!hasDesktopBridge()) localStorage.setItem('exora.language', state.language)
  if (hasDesktopBridge()) {
    invoke('set_locale', { input: { language: state.language } }).catch((error) => {
      console.warn('Failed to save locale:', error)
    })
  }
  scheduleSaveAppSettings()
  state.profileMenuOpen = false
  state.profileSubmenu = undefined
  applyUserPreferences()
  renderAll()
  authGate.refreshLanguage()
}

function setTheme(theme: AppTheme) {
  state.theme = theme
  if (!hasDesktopBridge()) localStorage.setItem('exora.theme', state.theme)
  scheduleSaveAppSettings()
  state.profileMenuOpen = false
  state.profileSubmenu = undefined
  applyUserPreferences()
  renderAll()
}

const V3_ACTIVITY_RETENTION_MS = 24 * 60 * 60 * 1000

function v3ActivityAccountScope() {
  return String(state.authAccount?.accountId || '')
}

function v3HistoryCopy(english: string, chinese: string) {
  return state.language === 'zh' ? chinese : english
}

function v3ActivityCounterpartyKey(record: V3ActivitySession) {
  const stable = String(record.counterpartyId || record.counterpartyLabel || 'counterparty').trim().toLowerCase()
  return stable.replace(/[^a-z0-9._:@-]+/g, '-') || 'counterparty'
}

function v3ActivityArchiveKey(record: V3ActivitySession) {
  if (record.productKind === 'api_operation') return `${record.role}:api:${v3ActivityCounterpartyKey(record)}`
  return `${record.role}:${record.productKind}:${record.sessionId}`
}

function v3ActivityIsBusy(record: V3ActivitySession) {
  return record.status === 'active' || Number(record.inFlightCount || 0) > 0
}

function v3ActivityRetainUntil(record: V3ActivitySession) {
  if (record.productKind !== 'api_operation') return undefined
  if (record.retainUntil) return record.retainUntil
  const timestamp = sortTime(record.updatedAt)
  return timestamp ? new Date(timestamp + V3_ACTIVITY_RETENTION_MS).toISOString() : undefined
}

function v3ActivityNaturallyCurrent(record: V3ActivitySession) {
  if (v3ActivityIsBusy(record)) return true
  const retainUntil = v3ActivityRetainUntil(record)
  return Boolean(retainUntil && sortTime(retainUntil) > Date.now())
}

function v3ActivityDelta(record: V3ActivitySession, baseline: V3ActivitySession) {
  if (sortTime(record.updatedAt) <= sortTime(baseline.updatedAt)) return undefined
  return {
    ...record,
    startedAt: baseline.updatedAt,
    itemCount: Math.max(0, Number(record.itemCount || 0) - Number(baseline.itemCount || 0)),
    amountAtomic: Number(record.amountAtomic || 0) - Number(baseline.amountAtomic || 0),
    grossAmountAtomic: Number(record.grossAmountAtomic || 0) - Number(baseline.grossAmountAtomic || 0),
    platformFeeAtomic: Number(record.platformFeeAtomic || 0) - Number(baseline.platformFeeAtomic || 0),
    outcome: v3HistoryCopy('New activity since the previous archived batch.', '自上次收纳后产生的新活动。'),
  }
}

function v3LatestActivityBaselines(side: OrderSide) {
  const latest = new Map<string, { record: V3ActivitySession; archivedAt: string }>()
  for (const marker of state.v3ActivityArchiveMarkers) {
    if (marker.role !== side || marker.accountId !== v3ActivityAccountScope()) continue
    for (const baseline of marker.baselines) {
      const previous = latest.get(baseline.sessionId)
      if (!previous || sortTime(marker.archivedAt) > sortTime(previous.archivedAt)) latest.set(baseline.sessionId, { record: baseline, archivedAt: marker.archivedAt })
    }
  }
  return latest
}

type V3ActivityDisplaySource = {
  summary: V3ActivitySession
  baseline: V3ActivitySession
  detailAfter?: string
}

function v3AggregateActivityDisplay(
  sources: V3ActivityDisplaySource[],
  bucket: V3ActivityBucket,
  archiveKey: string,
  displayId: string,
  options: { manuallyArchived?: boolean; archiveMarkerId?: string; detailThroughBySession?: Record<string, string> } = {},
): V3ActivityDisplayRecord {
  const summaries = sources.map((source) => source.summary)
  const baselines = sources.map((source) => source.baseline)
  const first = summaries[0]
  const productTitles = [...new Set(summaries.map((item) => item.productTitle).filter(Boolean))]
  const productIds = [...new Set(summaries.map((item) => item.productId).filter(Boolean))]
  const sessionIds = [...new Set(summaries.map((item) => item.sessionId))]
  const itemCount = summaries.reduce((total, item) => total + Number(item.itemCount || 0), 0)
  const active = summaries.some(v3ActivityIsBusy)
  const attentionRequired = summaries.some((item) => item.attentionRequired || item.status === 'needs_attention')
  const startedAt = summaries.reduce((value, item) => !value || sortTime(item.startedAt) < sortTime(value) ? item.startedAt : value, '')
  const updatedAt = summaries.reduce((value, item) => sortTime(item.updatedAt) > sortTime(value) ? item.updatedAt : value, '')
  const endedAt = summaries.reduce<string | undefined>((value, item) => sortTime(item.endedAt) > sortTime(value) ? item.endedAt : value, undefined)
  const retainUntil = summaries.reduce<string | undefined>((value, item) => {
    const candidate = v3ActivityRetainUntil(item)
    return sortTime(candidate) > sortTime(value) ? candidate : value
  }, undefined as string | undefined)
  const detailAfterBySession = Object.fromEntries(sources.filter((source) => source.detailAfter).map((source) => [source.summary.sessionId, source.detailAfter as string]))
  const groupedAPI = first.productKind === 'api_operation' && (sessionIds.length > 1 || productIds.length > 1 || options.manuallyArchived)
  const productTitle = groupedAPI && productTitles.length > 1
    ? v3HistoryCopy(`${first.counterpartyLabel || 'Counterparty'} · ${productTitles.length} API products`, `${first.counterpartyLabel || '交易方'} · ${productTitles.length} 个 API 产品`)
    : first.productTitle
  const outcome = groupedAPI
    ? v3HistoryCopy(`${itemCount} API calls grouped by counterparty; every invocation remains immutable.`, `按交易方收纳了 ${itemCount} 次 API 调用；每条调用记录仍保持不可变。`)
    : first.outcome
  return {
    ...first,
    displayId,
    archiveKey,
    bucket,
    sessionId: first.sessionId,
    sessionIds,
    sourceRecords: summaries,
    baselineRecords: baselines,
    // An active API Order is a reusable authorization, not necessarily work in
    // progress. It can be filed away whenever it has no invocation in flight.
    canArchive: bucket === 'current' && baselines.every((item) => Number(item.inFlightCount || 0) === 0),
    manuallyArchived: Boolean(options.manuallyArchived),
    archiveMarkerId: options.archiveMarkerId,
    detailAfterBySession: Object.keys(detailAfterBySession).length ? detailAfterBySession : undefined,
    detailThroughBySession: options.detailThroughBySession,
    orderUid: sessionIds.length === 1 ? first.orderUid : '',
    activitySessionId: sessionIds.length === 1 ? first.activitySessionId : undefined,
    productId: productIds.length === 1 ? first.productId : '',
    listingId: [...new Set(summaries.map((item) => item.listingId))].length === 1 ? first.listingId : '',
    productTitle,
    status: active ? 'active' : attentionRequired ? 'needs_attention' : 'completed',
    outcome,
    attentionRequired,
    inFlightCount: summaries.reduce((total, item) => total + Number(item.inFlightCount || 0), 0),
    itemCount,
    amountAtomic: summaries.reduce((total, item) => total + Number(item.amountAtomic || 0), 0),
    grossAmountAtomic: summaries.reduce((total, item) => total + Number(item.grossAmountAtomic || 0), 0),
    platformFeeAtomic: summaries.reduce((total, item) => total + Number(item.platformFeeAtomic || 0), 0),
    startedAt,
    updatedAt,
    endedAt,
    retainUntil,
  }
}

function v3ActivityDisplayRecords(side: OrderSide, bucket: V3ActivityBucket): V3ActivityDisplayRecord[] {
  const latestBaselines = v3LatestActivityBaselines(side)
  const candidates: Array<V3ActivityDisplaySource & { bucket: V3ActivityBucket; archiveKey: string }> = []
  for (const record of state.v3ActivitySessions[side]) {
    const latest = latestBaselines.get(record.sessionId)?.record
    const summary = latest ? v3ActivityDelta(record, latest) : record
    if (!summary) continue
    const naturalBucket: V3ActivityBucket = v3ActivityNaturallyCurrent(record) ? 'current' : 'history'
    candidates.push({ summary, baseline: record, detailAfter: latest?.updatedAt, bucket: naturalBucket, archiveKey: v3ActivityArchiveKey(record) })
  }

  const output: V3ActivityDisplayRecord[] = []
  for (const candidate of candidates.filter((item) => item.bucket === bucket)) {
    // Every order remains an individually addressable row. Older UI versions
    // grouped API sessions by counterparty, which hid the shared Order UID.
    output.push(v3AggregateActivityDisplay([candidate], bucket, candidate.archiveKey, `${bucket}:${candidate.summary.sessionId}`))
  }

  if (bucket === 'history') {
    for (const marker of state.v3ActivityArchiveMarkers.filter((item) => item.role === side && item.accountId === v3ActivityAccountScope() && !item.deleted)) {
      const baselines = new Map(marker.baselines.map((item) => [item.sessionId, item]))
      const detailThroughBySession = Object.fromEntries(marker.baselines.map((item) => [item.sessionId, item.updatedAt]))
      const sources = marker.records.map((summary) => ({ summary, baseline: baselines.get(summary.sessionId) || summary, detailAfter: marker.detailAfterBySession?.[summary.sessionId] }))
      output.push(v3AggregateActivityDisplay(sources, 'history', marker.archiveKey, `history:archive:${marker.id}`, { manuallyArchived: true, archiveMarkerId: marker.id, detailThroughBySession }))
    }
  }
  return output.sort((a, b) => sortTime(b.updatedAt) - sortTime(a.updatedAt))
}

function findV3ActivityDisplayRecord(displayId: string, side: OrderSide = state.workOrderSide) {
  return [...v3ActivityDisplayRecords(side, 'current'), ...v3ActivityDisplayRecords(side, 'history')].find((item) => item.displayId === displayId)
}

function v3ActivityMarker(record: V3ActivityDisplayRecord, deleted = false, baselineRecords = record.baselineRecords): V3ActivityArchiveMarker {
  const archivedAt = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    accountId: v3ActivityAccountScope(),
    archiveKey: record.archiveKey,
    role: record.role,
    productKind: record.productKind,
    archivedAt,
    archivedThrough: baselineRecords.reduce((latest, item) => sortTime(item.updatedAt) > sortTime(latest) ? item.updatedAt : latest, record.updatedAt),
    records: record.sourceRecords,
    baselines: baselineRecords,
    detailAfterBySession: record.detailAfterBySession,
    deleted,
  }
}

function clearSelectedV3Activity(displayId: string) {
  if (state.selectedV3ActivitySessionId !== displayId) return
  state.selectedV3ActivitySessionId = undefined
  state.v3ActivityDetail = undefined
  state.v3ActivityDetailError = undefined
  state.v3ActivityDetailLoading = false
  state.v3APIOrder = undefined
  state.v3APIOrderBusy = false
}

function persistV3ActivityMarker(record: V3ActivityDisplayRecord, marker: V3ActivityArchiveMarker) {
  if (record.archiveMarkerId) {
    state.v3ActivityArchiveMarkers = state.v3ActivityArchiveMarkers.filter((item) => item.id !== record.archiveMarkerId)
  }
  state.v3ActivityArchiveMarkers = [...state.v3ActivityArchiveMarkers, marker].slice(-200)
  state.v3ActivityArchiveUndo = { marker, side: record.role }
  clearSelectedV3Activity(record.displayId)
  scheduleSaveAppSettings(0)
  renderLedger()
  renderDecisionPanel()
}

function archiveV3BuyerActivity(displayId: string) {
  const record = findV3ActivityDisplayRecord(displayId, 'buyer')
  if (!record || record.role !== 'buyer' || record.bucket !== 'current') return
  if (!record.canArchive) {
    showToast(v3HistoryCopy('Wait for the current API call to finish before moving this order to History.', '请等待当前 API 调用结束后再将订单转为历史。'))
    return
  }
  persistV3ActivityMarker(record, v3ActivityMarker(record))
  showToast(v3HistoryCopy('Order moved to History.', '订单已转为历史。'))
}

async function deleteV3BuyerActivity(displayId: string) {
  const record = findV3ActivityDisplayRecord(displayId, 'buyer')
  if (!record || record.role !== 'buyer') return
  if (Number(record.inFlightCount || 0) > 0) {
    showToast(v3HistoryCopy('Wait for the current API call to finish before deleting this order.', '请等待当前 API 调用结束后再删除订单。'))
    return
  }
  const activeOrder = record.status === 'active'
  const confirmed = await requestSimpleAppConfirmation(
    activeOrder
      ? v3HistoryCopy('The API Order will be deactivated and removed from this device\'s Buyer list.', '该 API 订单将被停用，并从此设备的 Buyer 列表中移除。')
      : v3HistoryCopy('The order will be removed from this device\'s Buyer list.', '该订单将从此设备的 Buyer 列表中移除。'),
    {
      eyebrow: 'Buyer order',
      title: v3HistoryCopy('Delete this order?', '删除此订单？'),
      detail: record.productTitle || record.orderUid,
      impact: activeOrder
        ? v3HistoryCopy('Connected Agents will be blocked. Cloud receipts and audit history remain available.', '已连接的 Agent 将被阻止；云端凭证与审计历史仍会保留。')
        : v3HistoryCopy('Cloud receipts and audit history are not deleted.', '云端凭证与审计历史不会被删除。'),
      confirmLabel: v3HistoryCopy('Delete order', '删除订单'),
      tone: 'danger',
    },
  )
  if (!confirmed) return

  try {
    let baselines = record.baselineRecords
    if (activeOrder) {
      const response = await invoke<{ order?: { status?: string; updatedAt?: string; deactivatedAt?: string } }>('api_order_deactivate', { input: { listingId: record.listingId } })
      const updatedAt = String(response.order?.updatedAt || new Date().toISOString())
      baselines = baselines.map((item) => ({
        ...item,
        status: response.order?.status === 'inactive' ? 'completed' : item.status,
        updatedAt: item.sessionId === record.sessionId ? updatedAt : item.updatedAt,
        endedAt: item.sessionId === record.sessionId ? String(response.order?.deactivatedAt || updatedAt) : item.endedAt,
      }))
    }
    persistV3ActivityMarker(record, v3ActivityMarker(record, true, baselines))
    showToast(v3HistoryCopy('Order deleted from the Buyer list.', '订单已从 Buyer 列表删除。'))
  } catch (error) {
    showToast(humanizeError(error))
  }
}


function orderSearchMatches(record: V3ActivitySession, query: string) {
  if (!query) return true
  const searchable = [
    record.orderUid,
    record.productTitle,
    record.counterpartyLabel,
    record.status,
    record.outcome,
    record.productKind,
    record.productId,
    record.listingId,
    record.sessionId,
    record.activitySessionId,
    record.asset,
    v3AtomicMoney(record.amountAtomic, record.asset),
  ].filter(Boolean).join(' ').toLowerCase()
  return searchable.includes(query)
}

function renderOrderSearchResults() {
  const side = state.workOrderSide
  const records = [...v3ActivityDisplayRecords(side, 'current'), ...v3ActivityDisplayRecords(side, 'history')].sort((a, b) => sortTime(b.updatedAt) - sortTime(a.updatedAt))
  const query = fields.orderSearchInput.value.trim().toLowerCase()
  const matches = records.filter((record) => orderSearchMatches(record, query))
  const loading = state.v3ActivityLoading[side]
  const error = state.v3ActivityErrors[side]
  fields.orderSearchTitle.textContent = `Search ${side === 'buyer' ? 'Buyer' : 'Seller'} orders`
  fields.orderSearchCount.textContent = `${matches.length} ${matches.length === 1 ? 'order' : 'orders'}`
  if (loading && !records.length) {
    fields.orderSearchResults.innerHTML = '<div class="order-search-state"><strong>Loading orders…</strong><span>Fetching the latest order history.</span></div>'
    return
  }
  if (error && !records.length) {
    fields.orderSearchResults.innerHTML = `<div class="order-search-state error"><strong>Orders unavailable</strong><span>${escapeHTML(error)}</span></div>`
    return
  }
  if (!matches.length) {
    fields.orderSearchResults.innerHTML = `<div class="order-search-state"><strong>${query ? 'No matching orders' : 'No orders yet'}</strong><span>${query ? 'Try an Order UID, title, status, counterparty, amount, or order ID.' : 'Orders will appear here when activity is available.'}</span></div>`
    return
  }
  fields.orderSearchResults.innerHTML = matches.slice(0, 50).map((record) => `
    <button class="order-search-result" type="button" role="option" data-order-search-session="${escapeAttr(record.displayId)}" title="${escapeAttr([record.productTitle, record.counterpartyLabel, record.status, record.displayId].filter(Boolean).join(' / '))}">
      <span class="order-search-kind kind-${escapeAttr(record.productKind)}" aria-hidden="true">${v3ActivityKindLabel(record.productKind)}</span>
      <span class="order-search-result-copy">
        <strong>${escapeHTML(record.productTitle || 'API session')}</strong>
        <small><code>${escapeHTML(record.orderUid)}</code><span>${escapeHTML([record.bucket === 'current' ? v3HistoryCopy('Current', '当前') : v3HistoryCopy('History', '历史'), record.counterpartyLabel, v3ActivityStatusLabel(record.status), compactTimestamp(record.updatedAt)].filter(Boolean).join(' · '))}</span></small>
      </span>
      <span class="order-search-result-amount">${escapeHTML(v3AtomicMoney(record.amountAtomic, record.asset))}</span>
      <span class="order-search-result-arrow" aria-hidden="true">${toolbarIcons.disclosure}</span>
    </button>
  `).join('')
}

function openOrderSearch() {
  closeProfileMenu()
  closeMCPInfoModal()
  closeWalletModal()
  closePINSettingsModal()
  closePermissionMenu(false)
  fields.orderSearchModal.classList.remove('hidden')
  fields.orderSearchModal.setAttribute('aria-hidden', 'false')
  fields.orderSearchInput.value = ''
  renderOrderSearchResults()
  if (!state.v3ActivityLoaded[state.workOrderSide]) void loadV3ActivitySessions(state.workOrderSide)
  window.setTimeout(() => fields.orderSearchInput.focus(), 0)
}

function closeOrderSearch() {
  if (fields.orderSearchModal.classList.contains('hidden')) return
  fields.orderSearchModal.classList.add('hidden')
  fields.orderSearchModal.setAttribute('aria-hidden', 'true')
  fields.orderSearchInput.value = ''
  fields.orderSearchResults.innerHTML = ''
}

function openOrderSearchResult(displayId: string) {
  if (!displayId) return
  closeOrderSearch()
  selectV3ActivityDisplayRecord(displayId)
}

async function refreshStatus() {
  if (state.statusLoading) return
  state.statusLoading = true
  try {
    const status = await invoke<AppStatus>('app_status').catch((error) => ({
      docker: 'error',
      container: 'unknown',
      daemon: 'offline',
      image: 'unknown',
      containerName: 'exora-dockd',
      imageTag: '',
      baseUrl: 'http://127.0.0.1:8080',
      dataDir: '',
      configPath: '',
      discoveryPath: '',
      mcpCommand: '',
      agentPrompt: '',
      opencodeConfig: '',
      message: humanizeError(error),
    }))
    renderStatus(status)
  } finally {
    state.statusLoading = false
  }
}

function renderStatus(status: AppStatus) {
  state.appStatus = status
  fields.daemon.textContent = status.daemon
  fields.daemon.dataset.state = status.daemon
}

const settingsNavGroups: Array<{ label: Record<AppLanguage, string>; items: Array<{ view: SettingsView; label: Record<AppLanguage, string> }> }> = [
  { label: { en: 'Preferences', zh: '偏好' }, items: [
    { view: 'general', label: { en: 'General', zh: '通用' } },
    { view: 'notifications', label: { en: 'Notifications', zh: '通知' } },
  ] },
  { label: { en: 'Account', zh: '账户' }, items: [
    { view: 'account-security', label: { en: 'Account & Security', zh: '账户与安全' } },
    { view: 'agent-permissions', label: { en: 'Agent Connections', zh: 'Agent 连接与权限' } },
  ] },
  { label: { en: 'System', zh: '系统' }, items: [
    { view: 'data-storage', label: { en: 'Data & Storage', zh: '数据与存储' } },
    { view: 'system-about', label: { en: 'System & About', zh: '系统与关于' } },
  ] },
]


function renderLedger() {
  renderViewTabs()
  if (state.settingsOpen) renderSettingsSidebar()
  else renderOrderActivitySidebar()
  localize(fields.taskSidebar)
}

function renderSettingsSidebar() {
  setLedgerEmpty(false)
  fields.ledgerList.classList.add('settings-list')
  const settingItems = settingsNavGroups.map((group) => `<div class="settings-sidebar-group"><span>${escapeHTML(group.label[state.language])}</span>${group.items.map((item) => {
    const title = item.label[state.language]
    return `<button type="button" class="ledger-item history-record settings-record ${item.view === state.activeSettingsView ? 'active' : ''}" data-settings-tab="${escapeHTML(item.view)}" aria-pressed="${item.view === state.activeSettingsView}"><span class="settings-record-icon">${settingsNavIcons[item.view]}</span><strong>${escapeHTML(title)}</strong></button>`
  }).join('')}</div>`).join('')
  fields.ledgerList.innerHTML = `<div class="settings-sidebar-heading">${state.language === 'zh' ? '设置' : 'Settings'}</div>${settingItems}`
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextView = button.dataset.settingsTab as SettingsView | undefined
      if (!nextView || nextView === state.activeSettingsView) return
      state.activeSettingsView = nextView
      scheduleSaveAppSettings()
      updateSettingsSidebarSelection()
      renderSettingsPanel()
      fields.settingsView.scrollTop = 0
    })
  })
}

function updateSettingsSidebarSelection() {
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
    const active = button.dataset.settingsTab === state.activeSettingsView
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
}


function setLedgerEmpty(empty: boolean) {
  fields.ledgerList.classList.toggle('empty', empty)
}

function v3FormatBytes(value: unknown) {
  const bytes = Number(value || 0)
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${bytes} B`
}




async function loadV3Catalog() {
  if (state.v3CatalogLoading) return
  state.v3CatalogLoading = true
  state.v3CatalogError = undefined
  renderDecisionPanel()
  try {
    const response = await invoke<{ operations?: CatalogOperation[] }>('catalog_listings', { input: { q: state.v3ListingQuery } })
    state.v3CatalogListings = (response.operations || []).map((operation) => ({
      listing: { listingId: `${operation.apiId}:${operation.operationId}`, productId: operation.apiId, status: 'live', price: operation.pricing, availability: { availableNow: operation.availability !== 'unavailable' }, applicationSource: 'api' },
      productManifest: { productId: operation.apiId, productKind: 'api_operation', applicationSource: 'api', title: operation.title || operation.operationId, description: operation.description, status: 'live', providerDockId: operation.api?.title || operation.apiId, manifest: { apiId: operation.apiId, apiTitle: operation.api?.title || operation.apiId, deliveryMode: operation.api?.deliveryMode, runtimeHealth: operation.api?.runtimeHealth, operationId: operation.operationId, operations: [{ operationId: operation.operationId, title: operation.title || operation.operationId, description: operation.description, interaction: { mode: operation.interaction || 'request_response' }, pricing: operation.pricing }] } },
      availability: { availableNow: operation.availability !== 'unavailable' },
    }))
    state.v3Products = state.v3CatalogListings.map((item) => item.productManifest)
    state.v3CatalogLoaded = true
  } catch (error) {
    state.v3CatalogError = humanizeError(error)
  } finally {
    state.v3CatalogLoading = false
    renderDecisionPanel()
  }
}

function v3ServiceManifestOperations(productManifest: Record<string, any>) {
  const serviceManifest = productManifest?.serviceManifest as V3ServiceManifest | undefined
  if (!serviceManifest?.interface || !Array.isArray(serviceManifest.operationPolicies)) {
    return Array.isArray(productManifest?.operations)
      ? productManifest.operations.filter((operation: unknown): operation is Record<string, any> => Boolean(operation && typeof operation === 'object'))
      : []
  }
  const policies = new Map(serviceManifest.operationPolicies.map((policy) => [policy.operationId, policy]))
  const operations: Array<Record<string, any>> = []
  for (const [operationPath, rawPathItem] of Object.entries(serviceManifest.interface.paths || {})) {
    const pathItem = rawPathItem as Record<string, any>
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const operation = pathItem[method] as Record<string, any> | undefined
      if (!operation?.operationId) continue
      const operationId = String(operation.operationId)
      operations.push({
        operationId,
        method: method.toUpperCase(),
        path: operationPath,
        title: String(operation.summary || operationId),
        policy: policies.get(operationId),
      })
    }
  }
  return operations
}

async function loadV3ActivitySessions(side: OrderSide = state.workOrderSide, force = false) {
  if (state.v3ActivityLoading[side] || (!force && (state.v3ActivityLoaded[side] || state.v3ActivityErrors[side]))) return
  const accountRevision = activityAccountRevision
  state.v3ActivityLoading[side] = true
  delete state.v3ActivityErrors[side]
  if (side === state.workOrderSide) renderLedger()
  try {
    const response = await invoke<{ sessions?: V3ActivitySession[] }>('activity_sessions', { input: { role: side, limit: 200 } })
    if (accountRevision !== activityAccountRevision) return
    state.v3ActivitySessions[side] = response.sessions || []
    state.v3ActivityLoaded[side] = true
  } catch (error) {
    if (accountRevision !== activityAccountRevision) return
    state.v3ActivityErrors[side] = humanizeError(error)
  } finally {
    if (accountRevision === activityAccountRevision) {
      state.v3ActivityLoading[side] = false
      if (side === state.workOrderSide) renderLedger()
      if (!fields.orderSearchModal.classList.contains('hidden') && side === state.workOrderSide) renderOrderSearchResults()
    }
  }
}

async function fetchV3ActivitySessionDetail(sessionId: string, role: OrderSide) {
  const response = await invoke<{ session?: V3ActivityDetail }>('activity_session', { input: { id: sessionId, role } })
  if (!response.session) throw new Error('Order detail was not found.')
  return response.session
}

function v3ActivityTimestampInBatch(value: string | undefined, after?: string, through?: string) {
  const timestamp = sortTime(value)
  if (!timestamp) return !after && !through
  if (after && timestamp <= sortTime(after)) return false
  if (through && timestamp > sortTime(through)) return false
  return true
}

function mergeV3ActivityDetails(display: V3ActivityDisplayRecord, details: V3ActivityDetail[]): V3ActivityDetail {
  const invocations: V3ActivityInvocation[] = []
  const events: NonNullable<V3ActivityDetail['events']> = []
  const operations = new Set<string>()
  const usage: Record<string, number> = {}
  details.forEach((detail) => {
    const after = display.detailAfterBySession?.[detail.sessionId]
    const through = display.detailThroughBySession?.[detail.sessionId]
    const filteredInvocations = (detail.invocations || []).filter((item) => v3ActivityTimestampInBatch(item.startedAt, after, through))
    const filteredEvents = (detail.events || []).filter((item) => v3ActivityTimestampInBatch(item.occurredAt, after, through))
    invocations.push(...filteredInvocations)
    events.push(...filteredEvents)
    ;(detail.operations || []).forEach((operation) => operations.add(operation))
    const usageSources = detail.productKind === 'api_operation' && (after || through)
      ? filteredInvocations.map((item) => item.usage || {})
      : [detail.usage || {}]
    usageSources.forEach((source) => Object.entries(source).forEach(([key, value]) => { usage[key] = (usage[key] || 0) + Number(value || 0) }))
  })
  invocations.sort((a, b) => sortTime(b.completedAt || b.startedAt) - sortTime(a.completedAt || a.startedAt))
  events.sort((a, b) => sortTime(b.occurredAt) - sortTime(a.occurredAt))
  const first = details[0]
  const grouped = display.sessionIds.length > 1 || Boolean(display.detailAfterBySession) || Boolean(display.detailThroughBySession)
  const identifiers = grouped
    ? { activityBatchId: display.displayId, sessionCount: String(display.sessionIds.length), counterpartyId: display.counterpartyId || display.counterpartyLabel }
    : first.identifiers
  return {
    ...first,
    ...display,
    product: display.productId && details.every((item) => item.productId === display.productId)
      ? first.product
      : { description: v3HistoryCopy('Aggregated API activity grouped by counterparty.', '按交易方聚合的 API 活动。') },
    operations: [...operations],
    usage,
    invocations,
    events,
    identifiers,
  }
}

async function loadV3ActivityDetail(displayId: string) {
  if (!displayId) return
  const accountRevision = activityAccountRevision
  const display = findV3ActivityDisplayRecord(displayId)
  if (!display) {
    state.v3ActivityDetailError = 'This activity batch is no longer available.'
    renderDecisionPanel()
    return
  }
  state.v3ActivityDetailLoading = true
  state.v3ActivityDetailError = undefined
  state.v3ActivityDetail = display
  renderDecisionPanel()
  try {
    const details = await Promise.all(display.sessionIds.map((sessionId) => fetchV3ActivitySessionDetail(sessionId, display.role)))
    if (accountRevision !== activityAccountRevision || state.selectedV3ActivitySessionId !== displayId) return
    state.v3ActivityDetail = mergeV3ActivityDetails(display, details)
    if (display.role === 'buyer' && state.v3ActivityDetail.productKind === 'api_operation') void loadAPIOrderStatus(state.v3ActivityDetail.listingId)
  } catch (error) {
    if (accountRevision === activityAccountRevision && state.selectedV3ActivitySessionId === displayId) state.v3ActivityDetailError = humanizeError(error)
  } finally {
    if (accountRevision === activityAccountRevision && state.selectedV3ActivitySessionId === displayId) {
      state.v3ActivityDetailLoading = false
      renderDecisionPanel()
      renderLedger()
    }
  }
}

function selectV3ActivityDisplayRecord(displayId: string) {
  const display = findV3ActivityDisplayRecord(displayId)
  if (!display) return
  state.selectedV3ActivitySessionId = displayId
  state.v3SelectedProduct = undefined
  state.v3ActivityDetail = display
  state.v3ActivityDetailError = undefined
  state.v3APIOrder = undefined
  state.v3APIOrderBusy = false
  renderLedger()
  void loadV3ActivityDetail(displayId)
}


function closeV3ActivityDetail() {
  state.selectedV3ActivitySessionId = undefined
  state.v3ActivityDetail = undefined
  state.v3ActivityDetailError = undefined
  state.v3ActivityDetailLoading = false
  state.v3APIOrder = undefined
  state.v3APIOrderBusy = false
  renderAll()
}

async function loadAPIOrderStatus(listingId: string) {
  if (!listingId) return
  const accountRevision = activityAccountRevision
  state.v3APIOrderBusy = true
  renderDecisionPanel()
  try {
    const response = await invoke<{ order?: V3APIOrder }>('api_order_status', { input: { listingId } })
    if (accountRevision !== activityAccountRevision || state.v3ActivityDetail?.listingId !== listingId) return
    state.v3APIOrder = response.order
  } catch (error) {
    if (accountRevision === activityAccountRevision && state.v3ActivityDetail?.listingId === listingId) showToast(humanizeError(error))
  } finally {
    if (accountRevision === activityAccountRevision && state.v3ActivityDetail?.listingId === listingId) {
      state.v3APIOrderBusy = false
      renderDecisionPanel()
    }
  }
}

type V3ProviderListingsResponse = { listings?: V3Listing[]; applications?: V3ListingApplication[]; offline?: boolean }

function applyV3ProviderListings(response: V3ProviderListingsResponse) {
  state.v3Listings = response.listings || []
  state.v3ListingApplications = response.applications || []
  state.v3ListingsLoaded = true
  state.v3SellerError = undefined
}

let v3LifecycleRefreshPromise: Promise<V3ProviderListingsResponse> | undefined
let lastV3LifecycleRefreshAt = 0

async function refreshV3ListingLifecycleState() {
  if (v3LifecycleRefreshPromise) return v3LifecycleRefreshPromise
  const accountRevision = accountContextRevision
  const request = invoke<V3ProviderListingsResponse>('provider_listings').then((response) => {
    if (accountRevision !== accountContextRevision) return response
    applyV3ProviderListings(response)
    lastV3LifecycleRefreshAt = Date.now()
    return response
  }).finally(() => {
    if (v3LifecycleRefreshPromise === request) v3LifecycleRefreshPromise = undefined
  })
  v3LifecycleRefreshPromise = request
  return request
}

function canAutoRefreshV3Listings() {
  if (document.visibilityState !== 'visible' || state.v3SellerTab !== 'buyer' || state.v3ListingMode !== 'seller' || state.settingsOpen || state.selectedV3ActivitySessionId) return false
  if (fields.actionView.querySelector('.is-action-busy')) return false
  const active = document.activeElement
  return !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)
}

async function autoRefreshV3Listings(force = false) {
  if (!canAutoRefreshV3Listings() || (!force && Date.now() - lastV3LifecycleRefreshAt < 15_000)) return
  try {
    await refreshV3ListingLifecycleState()
    renderDecisionPanel()
  } catch (error) {
    state.v3SellerError = humanizeError(error)
    renderDecisionPanel()
  }
}

async function loadV3Listings() {
  if (state.v3ListingsLoading) return
  const accountRevision = accountContextRevision
  state.v3ListingsLoading = true
  state.v3SellerError = undefined
  renderDecisionPanel()
  try {
    const [response] = await Promise.all([invoke<V3ProviderListingsResponse>('provider_listings')])
    if (accountRevision !== accountContextRevision) return
    applyV3ProviderListings(response)
  } catch (error) {
    if (accountRevision !== accountContextRevision) return
    state.v3SellerError = humanizeError(error)
  } finally {
    if (accountRevision !== accountContextRevision) return
    state.v3ListingsLoading = false
    renderDecisionPanel()
  }
}

async function deleteV3ProviderListing(listingId: string) {
  if (!listingId) throw new Error('Listing ID is required.')

  // A page may have been rendered before a Cloud deployment completed. Always
  // refresh the Cloud-authoritative lifecycle before deciding whether delete
  // is available instead of trusting the button's stale data attribute.
  state.v3ListingsLoaded = false
  await loadV3Listings()
  const application = state.v3ListingApplications.find((item) => item.listing.listingId === listingId)
  if (!application) {
    state.v3CatalogLoaded = false
    await loadV3Catalog()
    showToast(sx('Listing is already deleted.', '挂单已删除。'))
    return
  }
  if (!Array.isArray(application.lifecycle?.allowedActions) || !application.lifecycle.allowedActions.includes('delete')) {
    throw new Error(application.lifecycle?.statusReason || 'Cloud does not currently allow this Listing to be deleted.')
  }
  if (!await requestSimpleAppConfirmation(sx('It will be removed from the market and cannot be restored. Existing transactions and audit history will be kept.', '它会立即下架且无法恢复；现有交易和审计历史将被保留。'), { eyebrow: 'Listing', title: 'Delete this Listing?', impact: 'The Listing cannot be restored after deletion.', confirmLabel: 'Delete Listing', tone: 'danger' })) return

  const deleted = await invoke<{ localCleanup?: { released?: boolean; deferred?: boolean; cleanupPending?: boolean; reason?: string; error?: string } }>('provider_listing_delete', { input: { listingId } })
  if (state.v3ExpandedListingId === listingId || state.v3ExpandedListingId === `seller:${listingId}`) state.v3ExpandedListingId = undefined
  if (state.v3HighlightedListingId === listingId) state.v3HighlightedListingId = undefined
  state.v3ListingsLoaded = false
  state.v3CatalogLoaded = false
  await Promise.all([loadV3Listings(), loadV3Catalog()])
  if (deleted.localCleanup?.cleanupPending) {
    showToast(sx(`Listing deleted; local capacity cleanup is pending: ${deleted.localCleanup.error || deleted.localCleanup.reason || 'retry after restart'}`, `挂单已删除；本地容量仍待清理：${deleted.localCleanup.error || deleted.localCleanup.reason || '请重启后重试'}`))
  } else if (deleted.localCleanup?.deferred) {
    showToast(sx('Listing deleted.', '挂单已删除。'))
  } else {
    showToast(sx('Listing and its local capacity reservation were deleted.', '挂单及其本地容量预留已删除。'))
  }
}

type V3ListingActionResponse = { listing?: V3Listing; readiness?: V3ListingApplication['readiness']; lifecycle?: V3ListingApplication['lifecycle'] }
const v3ListingActionRevisions = new Map<string, number>()

async function transitionV3ProviderListing(listingId: string, desiredListed: boolean) {
  const revision = (v3ListingActionRevisions.get(listingId) || 0) + 1
  v3ListingActionRevisions.set(listingId, revision)
  let actionError: unknown
  let successMessage = ''
  try {
    await refreshV3ListingLifecycleState()
    if (v3ListingActionRevisions.get(listingId) !== revision) return
    const application = state.v3ListingApplications.find((item) => item.listing.listingId === listingId)
    if (!application) throw new Error(sx('Listing no longer exists.', '挂单已不存在。'))
    const allowed = Array.isArray(application.lifecycle?.allowedActions) ? application.lifecycle.allowedActions : []
    let action = ''
    if (!desiredListed) {
      if (!application.lifecycle?.listed) {
        showToast(sx('This Listing is already offline.', '该挂单已经处于下架状态。'))
        return
      }
      if (allowed.includes('pause')) action = 'pause'
    } else {
      if (application.lifecycle?.listed) {
        showToast(sx('This Listing is already Live.', '该挂单已经处于上架状态。'))
        return
      }
      if (allowed.includes('publish')) action = 'publish'
      else if (allowed.includes('resume')) action = 'resume'
    }
    if (!action) throw new Error(application.lifecycle?.statusReason || sx('Cloud does not allow this Listing state change yet.', 'Cloud 当前不允许执行此挂单状态切换。'))
    const result = await invoke<V3ListingActionResponse>('provider_listing_action', { input: { listingId, action } })
    if (desiredListed && (result.listing?.status !== 'published' || result.lifecycle?.listed !== true)) {
      throw new Error(result.lifecycle?.statusReason || sx('Cloud did not confirm that this Listing is Live.', 'Cloud 未确认该挂单已经上架。'))
    }
    if (!desiredListed && result.lifecycle?.listed !== false) {
      throw new Error(result.lifecycle?.statusReason || sx('Cloud did not confirm that this Listing is offline.', 'Cloud 未确认该挂单已经下架。'))
    }
    successMessage = desiredListed ? sx('Listing is now Live.', '挂单已上架。') : sx('Listing is now offline.', '挂单已下架。')
  } catch (error) {
    actionError = error
  } finally {
    if (v3ListingActionRevisions.get(listingId) === revision) {
      state.v3CatalogLoaded = false
      try {
        await Promise.all([refreshV3ListingLifecycleState(), loadV3Catalog()])
      } catch (refreshError) {
        if (!actionError) actionError = refreshError
      }
      renderDecisionPanel()
    }
  }
  if (actionError) throw actionError
  if (successMessage) showToast(successMessage)
}

function ensureV3SurfaceData() {
  void loadV3ActivitySessions(state.workOrderSide)
  if (!state.v3CatalogLoading && !state.v3CatalogLoaded && !state.v3CatalogError) void loadV3Catalog()
  if (!state.v3ListingsLoading && !state.v3ListingsLoaded && !state.v3SellerError) void loadV3Listings()
}

function v3ActivityUsageLabel(key: string) {
  const labels: Record<string, [string, string]> = {
    request: ['Requests', '请求'], successful_request: ['Successful', '成功'], input_bytes: ['Input', '输入'], output_bytes: ['Output', '输出'],
    execution_second: ['Execution', '执行时长'], input_tokens: ['Input tokens', '输入 Token'], output_tokens: ['Output tokens', '输出 Token'],
  }
  const label = labels[key]
  return label ? v3HistoryCopy(label[0], label[1]) : key.replaceAll('_', ' ')
}

function v3ActivityUsageValue(key: string, value: number) {
  if (key.endsWith('_bytes')) return v3FormatBytes(value)
  if (key === 'execution_second') return value >= 60 ? `${(value / 60).toFixed(1)} min` : `${value} sec`
  return new Intl.NumberFormat().format(value)
}

function v3ActivityKindName(kind: string) {
  if (kind === 'api_operation') return v3HistoryCopy('API operation', 'API 调用')
  return kind.replaceAll('_', ' ')
}

function v3ActivitySource(_detail: V3ActivityDetail): V3ApplicationSource {
  return 'api'
}

function v3ActivityRoleName(role: OrderSide) {
  return role === 'seller' ? v3HistoryCopy('Seller', '卖家') : v3HistoryCopy('Buyer', '买家')
}

function renderV3ActivityContextFacts(facts: Array<{ label: string; value: string; mono?: boolean }>) {
  return `<dl class="v3-activity-context-facts">${facts.filter((fact) => fact.value).map((fact) => `<div><dt>${escapeHTML(fact.label)}</dt><dd class="${fact.mono ? 'mono' : ''}">${escapeHTML(fact.value)}</dd></div>`).join('')}</dl>`
}

function renderV3OrderActivity(detail: V3ActivityDetail) {
  const operations = detail.operations || []
  const requestCount = Number(detail.usage?.request || detail.invocations?.length || 0)
  const successfulCount = Number(detail.usage?.successful_request || detail.invocations?.filter((item) => item.status === 'completed' || item.status === 'success').length || 0)
  const meteredUsage = Object.entries(detail.usage || {})
    .filter(([key, value]) => key !== 'request' && key !== 'successful_request' && Number.isFinite(Number(value)) && Number(value) !== 0)
  const operationSummary = operations.length === 1
    ? `<div class="v3-activity-operation-single"><span>${escapeHTML(v3HistoryCopy('Operation', '操作'))}</span><code>${escapeHTML(operations[0])}</code></div>`
    : operations.length > 1
      ? `<div class="v3-activity-operation-block"><div class="v3-activity-subsection-title"><span>${escapeHTML(v3HistoryCopy('Operations used', '已调用操作'))}</span><em>${operations.length}</em></div><div class="v3-activity-operation-list">${operations.map((item) => `<span>${escapeHTML(item)}</span>`).join('')}</div></div>`
      : ''
  return `<section class="v3-activity-panel v3-activity-delivery v3-order-overview kind-api_operation">
    <header><span>${escapeHTML(v3HistoryCopy('ORDER ACTIVITY', '订单活动'))}</span><h3>${escapeHTML(v3HistoryCopy('Usage and fulfillment', '用量与履约'))}</h3></header>
    <button class="v3-order-uid" type="button" data-copy-v3-identifier="${escapeAttr(detail.orderUid)}" title="${escapeAttr(v3HistoryCopy('Copy Order UID', '复制订单 UID'))}"><span><b>${escapeHTML(v3HistoryCopy('ORDER UID', '订单 UID'))}</b><code>${escapeHTML(detail.orderUid)}</code></span>${toolbarIcons.copy}</button>
    ${renderV3ActivityContextFacts([
      { label: v3HistoryCopy('Calls', '调用'), value: new Intl.NumberFormat().format(requestCount) },
      { label: v3HistoryCopy('Successful', '成功'), value: new Intl.NumberFormat().format(successfulCount) },
      { label: v3HistoryCopy('In flight', '进行中'), value: new Intl.NumberFormat().format(Number(detail.inFlightCount || 0)) },
    ])}
    ${meteredUsage.length ? `<div class="v3-activity-metering"><div class="v3-activity-subsection-title"><span>${escapeHTML(v3HistoryCopy('Metered usage', '计量用量'))}</span></div><div class="v3-activity-usage">${meteredUsage.map(([key, value]) => `<div><span>${escapeHTML(v3ActivityUsageLabel(key))}</span><strong>${escapeHTML(v3ActivityUsageValue(key, Number(value)))}</strong></div>`).join('')}</div></div>` : ''}
    ${operationSummary}
  </section>`
}

function renderV3OrderAccess(detail: V3ActivityDetail) {
  if (detail.role !== 'buyer' || detail.productKind !== 'api_operation') return ''
  const order = state.v3APIOrder
  const active = order?.status === 'active'
  const title = active ? v3HistoryCopy('Access active', '访问已启用') : order ? v3HistoryCopy('Access inactive', '访问已停用') : v3HistoryCopy('Checking access', '正在检查访问状态')
  const lastUsed = order?.lastUsedAt ? compactTimestamp(order.lastUsedAt) : v3HistoryCopy('Never used', '从未使用')
  return `<section class="v3-activity-panel v3-order-access-key ${active ? 'is-active' : ''}">
    <header><span>${escapeHTML(v3HistoryCopy('ACCESS', '访问'))}</span><h3>${escapeHTML(v3HistoryCopy('API Order', 'API 订单'))}</h3></header>
    <div class="v3-order-key-status"><span>${icon(KeyRound)}</span><div><strong>${escapeHTML(title)}</strong><small>${escapeHTML(order ? `${v3HistoryCopy('Last used', '最近使用')} ${lastUsed}` : v3HistoryCopy('Reading the current order state.', '正在读取当前订单状态。'))}</small></div><em>${escapeHTML(order?.status || '—')}</em></div>
    ${active ? `<button class="ghost danger" type="button" data-v3-api-order-action="deactivate" ${state.v3APIOrderBusy ? 'disabled' : ''}>${escapeHTML(v3HistoryCopy('Deactivate API Order', '停用 API 订单'))}</button>` : order ? `<button type="button" data-v3-api-order-action="request-reactivation" ${state.v3APIOrderBusy ? 'disabled' : ''}>${escapeHTML(v3HistoryCopy('Request PIN reactivation', '申请 PIN 恢复'))}</button>` : ''}
  </section>`
}

function renderV3ActivityEvents(events: NonNullable<V3ActivityDetail['events']>) {
  const decidedApprovals = new Set(events.filter((event) => event.approvalId && event.type !== 'approval_required' && event.status !== 'pending').map((event) => event.approvalId))
  return events.map((event) => {
    const awaitingDecision = event.type === 'approval_required' && Boolean(event.approvalId) && !decidedApprovals.has(event.approvalId)
    const busy = state.v3ApprovalBusyId === event.approvalId
    return `<article class="${awaitingDecision ? 'requires-approval' : ''}"><span class="v3-activity-event-dot ${escapeAttr(event.status)}"></span><div><strong>${escapeHTML(event.title)}</strong><small>${escapeHTML(event.detail)}</small>${awaitingDecision ? `<form class="v3-approval-decision" data-v3-approval-form="${escapeAttr(event.approvalId || '')}"><label><span>${escapeHTML(v3HistoryCopy('Payment PIN', '支付 PIN'))}</span><input name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]{6}" placeholder="${escapeAttr(v3HistoryCopy('Six digits', '六位数字'))}" required /></label><div><button type="submit" name="decision" value="approve" ${busy ? 'disabled' : ''}>${escapeHTML(busy ? v3HistoryCopy('Working…', '处理中…') : v3HistoryCopy('Approve', '批准'))}</button><button class="ghost danger" type="submit" name="decision" value="reject" ${busy ? 'disabled' : ''}>${escapeHTML(v3HistoryCopy('Reject', '拒绝'))}</button></div></form>` : ''}</div><time>${escapeHTML(compactTimestamp(event.occurredAt))}</time></article>`
  }).join('')
}

async function updateAPIOrder(action: 'deactivate' | 'request-reactivation') {
  const detail = state.v3ActivityDetail
  if (!detail || detail.role !== 'buyer' || !detail.listingId || state.v3APIOrderBusy) return
  state.v3APIOrderBusy = true
  renderDecisionPanel()
  try {
    if (action === 'deactivate' && !await requestSimpleAppConfirmation(v3HistoryCopy('Connected Agents will be blocked immediately.', '已连接的 Agent 会立即被阻止。'), { eyebrow: 'API Order', title: 'Deactivate this API Order?', impact: 'Existing Agent connections will stop immediately.', confirmLabel: 'Deactivate', tone: 'danger' })) return
    const command = action === 'deactivate' ? 'api_order_deactivate' : 'api_order_reactivation_request'
    await invoke(command, { input: { listingId: detail.listingId } })
    showToast(action === 'deactivate' ? v3HistoryCopy('API Order deactivated.', 'API 订单已停用。') : v3HistoryCopy('Reactivation approval created. Enter your PIN in Approvals.', '已创建恢复审批，请在 Approvals 中输入 PIN。'))
    await loadAPIOrderStatus(detail.listingId)
  } catch (error) {
    showToast(humanizeError(error))
  } finally {
    state.v3APIOrderBusy = false
    renderDecisionPanel()
  }
}

async function decideV3Approval(approvalId: string, decision: 'approve' | 'reject', pin: string) {
  if (!approvalId || state.v3ApprovalBusyId) return
  if (!/^\d{6}$/.test(pin)) throw new Error('Cloud payment PIN must be exactly 6 digits.')
  state.v3ApprovalBusyId = approvalId
  renderDecisionPanel()
  try {
    await invoke('consumer_approval_decide', { input: { approvalId, decision, pin } })
    showToast(t(decision === 'approve' ? 'toast.approvalApproved' : 'toast.approvalRejected'))
    const sessionId = state.selectedV3ActivitySessionId
    if (sessionId) await loadV3ActivityDetail(sessionId)
    await loadV3ActivitySessions('buyer', true)
  } finally {
    state.v3ApprovalBusyId = undefined
    renderDecisionPanel()
  }
}

function renderV3ActivityDetail() {
  if (state.v3ActivityDetailError) {
    return `<section class="v3-activity-loading error"><span>${escapeHTML(v3HistoryCopy('Order detail unavailable', '订单详情不可用'))}</span><p>${escapeHTML(state.v3ActivityDetailError)}</p><div><button class="ghost" type="button" data-v3-action="activity-back">${escapeHTML(v3HistoryCopy('Back', '返回'))}</button><button type="button" data-v3-action="activity-refresh">${escapeHTML(v3HistoryCopy('Try again', '重试'))}</button></div></section>`
  }
  const detail = state.v3ActivityDetail
  if (!detail || state.v3ActivityDetailLoading) {
    return `<section class="v3-activity-loading"><span class="v3-history-spinner"></span><strong>${escapeHTML(v3HistoryCopy('Loading order detail', '正在加载订单详情'))}</strong><p>${escapeHTML(v3HistoryCopy('Reading the latest order state and fulfillment records.', '正在读取最新订单状态和履约记录。'))}</p></section>`
  }
  const invocations = detail.invocations || []
  const events = detail.events || []
  const supplementalEvents = invocations.length ? events.filter((event) => event.type !== 'api_invocation') : events
  const requestCount = Number(detail.usage?.request || invocations.length || 0)
  const successfulCount = Number(detail.usage?.successful_request || invocations.filter((item) => item.status === 'completed' || item.status === 'success').length || 0)
  const successRate = requestCount > 0 ? `${Math.round((successfulCount / requestCount) * 100)}%` : '—'
  const roleAmountLabel = detail.role === 'seller' ? v3HistoryCopy('Net revenue', '净收入') : v3HistoryCopy('Total paid', '实付金额')
  const counterpartyRole = detail.role === 'seller' ? v3HistoryCopy('Buyer', '买家') : v3HistoryCopy('Provider', '服务方')
  const started = detail.startedAt ? compactTimestamp(detail.startedAt) : '—'
  const updated = detail.updatedAt ? compactTimestamp(detail.updatedAt) : '—'
  const productDescription = String(detail.product?.description || detail.outcome || '')
  const serviceAmount = Math.max(0, Number(detail.grossAmountAtomic || 0) - Number(detail.platformFeeAtomic || 0))
  const ledgerRows = detail.role === 'buyer'
    ? [
        [v3HistoryCopy('API usage', 'API 用量'), v3AtomicMoney(serviceAmount, detail.asset), ''],
        [v3HistoryCopy('Platform fee', '平台费'), v3AtomicMoney(detail.platformFeeAtomic, detail.asset), ''],
        [roleAmountLabel, v3AtomicMoney(detail.amountAtomic, detail.asset), 'total'],
      ]
    : [
        [v3HistoryCopy('Buyer paid', '买家支付'), v3AtomicMoney(detail.grossAmountAtomic, detail.asset), ''],
        [v3HistoryCopy('Platform fee', '平台费'), `−${v3AtomicMoney(detail.platformFeeAtomic, detail.asset)}`, ''],
        [roleAmountLabel, v3AtomicMoney(detail.amountAtomic, detail.asset), 'total'],
      ]
  return `<section class="v3-activity-detail v3-order-detail-compact" data-v3-activity-detail data-kind="${escapeAttr(detail.productKind)}" data-source="${escapeAttr(v3ActivitySource(detail))}" data-status="${escapeAttr(detail.status)}" data-role="${escapeAttr(detail.role)}">
    <nav class="v3-activity-nav">
      <button type="button" data-v3-action="activity-back">${toolbarIcons.back}<span>${escapeHTML(v3HistoryCopy('Back to orders', '返回订单'))}</span></button>
      <button type="button" data-v3-action="activity-refresh">${toolbarIcons.refresh}<span>${escapeHTML(v3HistoryCopy('Refresh', '刷新'))}</span></button>
    </nav>
    <header class="v3-activity-hero">
      <div class="v3-activity-hero-mark kind-${escapeAttr(detail.productKind)}">${v3ActivityKindLabel(detail.productKind)}</div>
      <div class="v3-activity-hero-copy">
        <span>${escapeHTML(v3ActivityKindName(detail.productKind))} · ${escapeHTML(v3ActivityRoleName(detail.role))}</span>
        <h2>${escapeHTML(detail.productTitle || 'API Order')}</h2>
        ${productDescription ? `<p>${escapeHTML(productDescription)}</p>` : ''}
        <div class="v3-activity-hero-meta"><span><b>${escapeHTML(counterpartyRole)}</b>${escapeHTML(detail.counterpartyLabel || v3HistoryCopy('Counterparty', '交易方'))}</span><span><b>${escapeHTML(v3HistoryCopy('Started', '开始时间'))}</b>${escapeHTML(started)}</span></div>
      </div>
      <em class="v3-activity-state ${escapeAttr(detail.status)}"><i></i>${escapeHTML(v3ActivityStatusLabel(detail.status))}</em>
    </header>
    ${detail.attentionRequired ? `<div class="v3-activity-attention">${icon(ShieldAlert)}<div><strong>${escapeHTML(v3HistoryCopy('Action may be required', '可能需要处理'))}</strong><span>${escapeHTML(v3HistoryCopy('A call failed or could not be metered. Review the activity record below.', '存在调用失败或无法计量，请检查下方活动记录。'))}</span></div></div>` : ''}
    <section class="v3-activity-summary v3-activity-summary-compact">
      <div class="v3-activity-total"><span>${escapeHTML(roleAmountLabel)}</span><strong>${escapeHTML(v3AtomicMoney(detail.amountAtomic, detail.asset))}</strong><small>${escapeHTML(detail.role === 'seller' ? v3HistoryCopy('After platform fee', '已扣除平台费') : v3HistoryCopy('For this order', '本订单累计'))}</small></div>
      <dl>
        <div><dt>${escapeHTML(v3HistoryCopy('Calls', '调用'))}</dt><dd>${escapeHTML(new Intl.NumberFormat().format(requestCount))}</dd></div>
        <div><dt>${escapeHTML(v3HistoryCopy('Success', '成功率'))}</dt><dd>${escapeHTML(`${successfulCount}/${requestCount || 0} · ${successRate}`)}</dd></div>
        <div><dt>${escapeHTML(v3HistoryCopy('Last update', '最近更新'))}</dt><dd>${escapeHTML(updated)}</dd></div>
      </dl>
    </section>
    <div class="v3-activity-grid">
      <div class="v3-activity-main-column">
        ${renderV3OrderActivity(detail)}
        <section class="v3-activity-panel">
          <header class="v3-activity-section-heading"><div><span>${escapeHTML(v3HistoryCopy('FULFILLMENT', '履约记录'))}</span><h3>${escapeHTML(detail.productKind === 'api_operation' ? v3HistoryCopy('Calls', '调用记录') : v3HistoryCopy('Timeline', '时间线'))}</h3></div><em>${detail.productKind === 'api_operation' ? invocations.length : supplementalEvents.length}</em></header>
          ${invocations.length ? `<div class="v3-activity-invocations">${invocations.map((item) => `<article><span class="v3-activity-event-dot ${escapeAttr(item.status)}"></span><div><strong>${escapeHTML(item.operationId || v3HistoryCopy('API call', 'API 调用'))}</strong><small>${escapeHTML(compactTimestamp(item.completedAt || item.startedAt))} · ${escapeHTML(item.invocationId)}</small></div><em>${escapeHTML(v3AtomicMoney(item.chargedAtomic, detail.asset))}</em><b class="status-${escapeAttr(item.status)}">${escapeHTML(v3ActivityStatusLabel(item.status))}</b></article>`).join('')}</div>` : ''}
          ${supplementalEvents.length ? `<div class="v3-activity-events">${renderV3ActivityEvents(supplementalEvents)}</div>` : ''}
          ${!invocations.length && !supplementalEvents.length ? `<p class="v3-activity-empty">${escapeHTML(v3HistoryCopy('No fulfillment activity has been recorded yet.', '尚未记录履约活动。'))}</p>` : ''}
        </section>
      </div>
      <aside class="v3-activity-side-column">
        ${renderV3OrderAccess(detail)}
        <section class="v3-activity-panel v3-activity-money">
          <header><span>${escapeHTML(v3HistoryCopy('PAYMENT', '支付'))}</span><h3>${escapeHTML(v3HistoryCopy('Amount breakdown', '金额明细'))}</h3></header>
          <dl>${ledgerRows.map(([label, value, className]) => `<div class="${className}"><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>
        </section>
      </aside>
    </div>
  </section>`
}

function renderV3SellerTabs() {
  state.v3SellerTab = normalizeV3SellerTab(state.v3SellerTab)
  const tabs: Array<[V3SellerTab, string, IconNode]> = [
    ['buyer', 'Market', ShoppingCart],
    ['local_api', 'Local API', BrainCircuit],
    ['cloud_api', 'Cloud API', Network],
  ]
  const activeIndex = Math.max(0, tabs.findIndex(([id]) => state.v3SellerTab === id))
  return `<nav class="v3-seller-tabs" role="tablist" aria-label="Main workspace" style="--v3-seller-active-offset: ${activeIndex * 124}px">
    <span class="v3-seller-active-bar" aria-hidden="true"></span>
    ${tabs.map(([id, label, tabIcon]) => `<button type="button" role="tab" aria-selected="${state.v3SellerTab === id}" data-v3-seller-tab="${id}" class="${state.v3SellerTab === id ? 'active' : ''}">${icon(tabIcon)}<span>${label}</span></button>`).join('')}
  </nav>`
}

function syncV3SellerTabs() {
  state.v3SellerTab = normalizeV3SellerTab(state.v3SellerTab)
  if (!fields.sellerSurfaceTabs.querySelector('.v3-seller-tabs')) {
    fields.sellerSurfaceTabs.innerHTML = renderV3SellerTabs()
  }
  const tabs = Array.from(fields.sellerSurfaceTabs.querySelectorAll<HTMLButtonElement>('[data-v3-seller-tab]'))
  const activeIndex = Math.max(0, tabs.findIndex((button) => button.dataset.v3SellerTab === state.v3SellerTab))
  fields.sellerSurfaceTabs.querySelector<HTMLElement>('.v3-seller-tabs')?.style.setProperty('--v3-seller-active-offset', `${activeIndex * 124}px`)
  tabs.forEach((button) => {
    const active = button.dataset.v3SellerTab === state.v3SellerTab
    button.classList.toggle('active', active)
    button.setAttribute('aria-selected', String(active))
  })
}

function syncV3SellerTabsVisibility() {
  const hidden = state.settingsOpen || Boolean(state.selectedV3ActivitySessionId)
  fields.sellerSurfaceTabs.classList.toggle('hidden', hidden)
}

function v3ListingPriceLabel(price: Record<string, any> = {}) {
  const currency = String(price.currency || 'USDC')
  if (Number.isFinite(Number(price.amount))) return `${Number(price.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${currency}${price.unit ? ` / ${price.unit}` : ''}`
  if (Number.isFinite(Number(price.fixedAtomic))) return v3AtomicMoney(Number(price.fixedAtomic), currency)
  if (price.model === 'fixed' && Array.isArray(price.components) && Number.isFinite(Number(price.components[0]?.rateAtomic))) return `${v3AtomicMoney(Number(price.components[0].rateAtomic), currency)} / invocation`
  const expression = String(price.chargeFormula?.expression || '').trim()
  const maximumAtomic = Number(price.maximumChargePerInvocationAtomic || 0)
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(expression)) return `${expression} ${currency} / invocation`
  if (expression && maximumAtomic > 0) return `Usage based · max ${v3AtomicMoney(maximumAtomic, currency)}`
  if (expression) return `Usage based · ${currency}`
  if (maximumAtomic > 0) return `${v3AtomicMoney(maximumAtomic, currency)} max / invocation`
  if (price.model === 'metered' || price.pricingVersion || Array.isArray(price.components)) return `Metered · ${currency}`
  return 'Not set'
}

function v3ManifestText(value: unknown, fallback = 'Not declared') {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  if (value === undefined || value === null || value === '') return fallback
  return String(value)
}

function v3ManifestDetail(label: string, value: unknown, fallback?: string) {
  return `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(v3ManifestText(value, fallback))}</dd></div>`
}

function v3OperationPricingLabel(route: Record<string, any>) {
  const pricing = route.pricing && typeof route.pricing === 'object' ? route.pricing as Record<string, any> : {}
  const expression = String(pricing.chargeFormula?.expression || '').trim()
  const maximumAtomic = Number(pricing.maximumChargePerInvocationAtomic || 0)
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(expression)) return `${expression} USDC / invocation`
  if (expression && maximumAtomic > 0) return `Usage based · ${v3AtomicMoney(maximumAtomic, 'USDC')} maximum`
  if (expression) return 'Usage based pricing'
  if (maximumAtomic > 0) return `${v3AtomicMoney(maximumAtomic, 'USDC')} maximum / invocation`
  const components = Array.isArray(route.pricing) ? route.pricing : []
  if (!components.length) return 'Pricing not declared'
  return components.map((component: Record<string, any>) => {
    const rate = Number(component.rateAtomic || 0) / 1_000_000
    return `${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC / ${component.per || 1} ${String(component.dimension || 'request').replaceAll('_', ' ')}`
  }).join(' · ')
}

function renderV3ApplicationManifest(_source: string, manifest: Record<string, any>) {
  const operations = v3ServiceManifestOperations(manifest)
  const service = (manifest.serviceManifest || manifest) as Record<string, any>
  const interactions = [...new Set(operations.map((operation) => {
    const interaction = operation.policy?.interaction || operation.interaction || 'request_response'
    return String(typeof interaction === 'object' ? interaction.mode || 'request_response' : interaction)
  }))]
  const details = [
    v3ManifestDetail('Application source', 'API'),
    v3ManifestDetail('Interface', manifest.serviceManifest ? 'OpenAPI 3.1' : 'Exora V4 Operation'),
    v3ManifestDetail('Delivery', service.deliveryMode || service.delivery || manifest.deliveryMode),
    v3ManifestDetail('Provider protocol', service.providerProtocol || manifest.providerProtocol || 'exora_provider_v1'),
    v3ManifestDetail('Interactions', interactions.join(', ')),
    v3ManifestDetail('Operations', operations.length),
  ].join('')
  const operationList = operations.length ? `<div class="v3-listing-route-list">${operations.map((operation: Record<string, any>) => `<div><span>${escapeHTML(String(operation.method || 'OPERATION'))}</span><strong>${escapeHTML(String(operation.path || operation.operationId || '/'))}</strong><small>${escapeHTML(String(operation.title || operation.operationId || 'Operation'))} · ${escapeHTML(v3OperationPricingLabel(operation))}</small></div>`).join('')}</div>` : ''
  return `<section class="v3-listing-manifest"><dl class="detail-grid v3-listing-source-details">${details}</dl>${operationList}<details><summary>Technical manifest</summary><pre>${escapeHTML(JSON.stringify(manifest, null, 2))}</pre></details></section>`
}

function v3ListingSourceMeta(_source: string) {
  return { label: 'API capability', shortLabel: 'API', description: 'An Exora API capability delivered locally or from an authorized cloud service', icon: Blocks }
}

function renderV3ListingSourceIcon(sourceIcon: IconNode): string
function renderV3ListingSourceIcon(sourceIcon: IconNode, attributes: string): string
function renderV3ListingSourceIcon(sourceIcon: IconNode, attributes = '') {
  return `<span class="v3-listing-source-icon source-api" aria-hidden="true" ${attributes}>${icon(sourceIcon)}</span>`
}

function v3ListingStatusMeta(status: string) {
  const statuses: Record<string, { label: string; tone: string }> = {
    draft: { label: sx('Private draft', '草稿'), tone: 'draft' },
    validating: { label: sx('Validating', '验证中'), tone: 'validating' },
    published: { label: sx('Live', '已上架'), tone: 'published' },
    live: { label: sx('Live', '可用'), tone: 'published' },
    paused: { label: sx('Paused', '已暂停'), tone: 'paused' },
    provider_busy: { label: sx('Provider busy', '服务繁忙'), tone: 'attention' },
    unhealthy: { label: sx('Unhealthy', '运行异常'), tone: 'attention' },
    expired: { label: sx('Expired', '已过期'), tone: 'retired' },
    retired: { label: sx('Retired', '已退役'), tone: 'retired' },
  }
  return statuses[status] || { label: status.replaceAll('_', ' '), tone: 'neutral' }
}

function renderV3ListingEmptyState() {
  return `<section class="v3-listing-empty v3-console-panel">
    <div class="v3-listing-empty-mark">${icon(SquareKanban)}</div>
    <span>LISTING PIPELINE</span>
    <h3>No API listings yet</h3>
    <p>Start a staged Integration Session from a local capability or an authorized hosted API. Nothing reaches the market until you review and publish it.</p>
    <div class="v3-listing-source-grid">
      <button type="button" class="source-api" data-v3-seller-tab-target="local_api"><span>${icon(Code2)}</span><div><strong>Local API</strong><small>Code, functions, CLI tools, and local HTTP APIs</small></div>${toolbarIcons.disclosure}</button>
      <button type="button" class="source-api" data-v3-seller-tab-target="cloud_api"><span>${icon(Cloud)}</span><div><strong>Cloud API</strong><small>Authorized public HTTPS APIs with OpenAPI 3.1</small></div>${toolbarIcons.disclosure}</button>
    </div>
    <footer><span>${icon(ShieldCheck)}</span><strong>Private by default</strong><small>Pricing and publishing always require an explicit human action.</small></footer>
  </section>`
}

type V3UnifiedListingItem = { listing: V3Listing; product: V3Product; application?: V3ListingApplication; rowId?: string; isOwner: boolean }

function v3UnifiedListingItems() {
  const items = new Map<string, V3UnifiedListingItem>()
  state.v3CatalogListings.forEach((catalog) => items.set(`buyer:${catalog.listing.listingId}`, { listing: catalog.listing, product: catalog.productManifest, rowId: `buyer:${catalog.listing.listingId}`, isOwner: false }))
  state.v3ListingApplications.forEach((application) => {
    items.set(`seller:${application.listing.listingId}`, { listing: application.listing, product: application.product, application, rowId: `seller:${application.listing.listingId}`, isOwner: true })
  })
  return [...items.values()].sort((left, right) => {
    const time = new Date(right.listing.updatedAt || right.product.updatedAt || 0).getTime() - new Date(left.listing.updatedAt || left.product.updatedAt || 0).getTime()
    return time || left.listing.listingId.localeCompare(right.listing.listingId)
  })
}

function renderV3UnifiedListingRow(item: V3UnifiedListingItem) {
  const { listing, product, application, isOwner } = item
  const source = 'api'
  const sourceMeta = v3ListingSourceMeta(source)
  const baseStatusMeta = v3ListingStatusMeta(listing.status)
  const rowId = item.rowId || listing.listingId
  const expanded = state.v3ExpandedListingId === rowId
  const readiness = application?.readiness
  const checks = readiness?.checks || []
  const passedChecks = checks.filter((check) => check.ready).length
  const offline = isOwner && !['paused', 'retired', 'deleted'].includes(listing.status) && checks.some((check) => !check.ready && /deployment|runtime|tunnel|health/i.test(`${check.id} ${check.detail || ''}`))
  const statusMeta = offline ? { label: sx('Deployment offline', '部署离线'), tone: 'attention' } : baseStatusMeta
  const fallbackActions = listing.status === 'published' ? ['pause'] : listing.status === 'draft' && readiness?.ready ? ['publish'] : ['paused', 'unhealthy', 'provider_busy'].includes(listing.status) && readiness?.ready ? ['resume'] : []
  const lifecycle = application?.lifecycle || { listed: listing.status === 'published' && listing.availability?.availableNow !== false, allowedActions: fallbackActions, statusReason: String(listing.availability?.reason || '') }
  const deleteAllowed = lifecycle.allowedActions.includes('delete')
  const ownerStatusReason = lifecycle.statusReason || (deleteAllowed ? 'This Listing is offline and can be deleted.' : 'This Listing cannot be deleted in its current state.')
  const toggleAction = lifecycle.listed ? (lifecycle.allowedActions.includes('pause') ? 'pause' : '') : lifecycle.allowedActions.includes('publish') ? 'publish' : lifecycle.allowedActions.includes('resume') ? 'resume' : ''
  const attention = ['unhealthy', 'provider_busy'].includes(listing.status)
  const displayTitle = product.title || listing.productId
  const displayDescription = product.description || ''
  const displayPrice = v3ListingPriceLabel(listing.price || {})
  const manifest = product.manifest || {}
  const catalogOperation = !isOwner ? v3ServiceManifestOperations(manifest)[0] : undefined
  const apiTitle = String(manifest.apiTitle || product.providerDockId || listing.productId)
  const interaction = String(catalogOperation?.interaction?.mode || catalogOperation?.interaction || 'request_response').replaceAll('_', ' ')
  const deliveryMode = String(manifest.deliveryMode || '')
  const summaryIcon = !isOwner ? (deliveryMode === 'local_dock' ? Code2 : Cloud) : sourceMeta.icon
  const rowStatusMeta = !isOwner && listing.availability?.availableNow === false ? { label: 'Unavailable', tone: 'attention' } : statusMeta
  const searchable = [listing.listingId, product.productId, displayTitle, displayDescription, apiTitle, interaction, sourceMeta.label, statusMeta.label, isOwner ? 'owner mine' : 'marketplace'].filter(Boolean).join(' ').toLowerCase()
  const ownerActions = `<button class="danger ghost" type="button" ${deleteAllowed ? 'data-v3-listing-delete' : 'data-v3-listing-delete-unavailable'} data-listing-id="${escapeAttr(listing.listingId)}" title="${escapeAttr(deleteAllowed ? 'Delete this Listing' : ownerStatusReason)}">Delete listing</button>`
  const integrationProvenance = listing.draftRunId || listing.sourceFingerprint ? `<section class="v3-listing-detail-section v3-agent-provenance"><header><span>INTEGRATION SOURCE</span><strong>Prepared through the staged Exora MCP</strong></header><dl class="detail-grid"><div><dt>Integration</dt><dd>${escapeHTML(listing.draftRunId || 'Not recorded')}</dd></div><div><dt>Source fingerprint</dt><dd>${escapeHTML((listing.sourceFingerprint || '').slice(0, 32) || 'Not recorded')}</dd></div><div><dt>MCP connection</dt><dd>${escapeHTML(listing.mcpConnection || 'External Agent')}</dd></div></dl></section>` : ''
  const readinessPanel = `<section class="v3-listing-detail-section"><header><span>PUBLISH READINESS</span><strong>${checks.length ? `${passedChecks} of ${checks.length} checks passed` : 'Waiting for Cloud checks'}</strong></header><div class="v3-listing-checks">${checks.map((check) => `<div class="${check.ready ? 'passed' : 'failed'}"><span>${check.ready ? '&#10003;' : '!'}</span><div><strong>${escapeHTML(check.label)}</strong><small>${escapeHTML(check.detail || '')}</small></div></div>`).join('') || '<div class="failed"><span>!</span><div><strong>No readiness report</strong><small>Refresh to request current checks.</small></div></div>'}</div></section>`
  return `<article class="v3-listing-application ${isOwner ? 'v3-owner-listing-row' : 'v4-marketplace-operation-row'} ${expanded ? 'expanded' : ''}" data-listing-row="${escapeAttr(rowId)}" data-listing-source="api" data-listing-kind="api_operation" data-listing-status="${escapeAttr(listing.status)}" data-listing-ready="${String(Boolean(readiness?.ready))}" data-listing-attention="${String(attention)}" data-listing-owner="${String(isOwner)}" data-listing-search="${escapeAttr(searchable)}">
    <button type="button" class="v3-listing-summary" data-v3-listing-expand="${escapeAttr(rowId)}" aria-expanded="${String(expanded)}">
      ${renderV3ListingSourceIcon(summaryIcon)}
      <span class="v3-listing-primary"><strong>${escapeHTML(displayTitle)}</strong><small>${isOwner ? `<em class="v3-source-badge source-api">API</em><em class="v3-owner-badge owner">Owner</em><span>${escapeHTML(product.providerDockId || listing.listingId)}</span>` : `<em class="v3-source-badge source-api">Operation</em><span>${escapeHTML(apiTitle)}</span><span>${escapeHTML(interaction)}</span>`}</small></span>
      <span class="v3-listing-summary-metrics"><span><small>Price</small><strong>${escapeHTML(displayPrice)}</strong></span><span><small>${isOwner ? 'Readiness' : 'Availability'}</small><strong>${isOwner ? checks.length ? `${passedChecks}/${checks.length} checks` : readiness?.ready ? 'Ready' : 'Pending' : listing.availability?.availableNow === false ? 'Unavailable' : 'Available now'}</strong></span></span>
      ${isOwner ? '<span class="v3-listing-state-slot" aria-hidden="true"></span>' : `<span class="v3-listing-state-pill tone-${escapeAttr(rowStatusMeta.tone)}"><i></i>${escapeHTML(rowStatusMeta.label)}</span>`}<span class="v3-listing-chevron">${toolbarIcons.disclosure}</span>
    </button>
    ${isOwner ? `<button type="button" class="v3-listing-state-pill v3-listing-lifecycle-switch tone-${escapeAttr(statusMeta.tone)} ${lifecycle.listed ? 'is-listed' : ''}" role="switch" aria-checked="${String(lifecycle.listed)}" aria-label="${escapeAttr(lifecycle.listed ? 'Take Listing offline' : 'List this offer')}" title="${escapeAttr(ownerStatusReason)}" data-v3-listing-action="${escapeAttr(toggleAction)}" data-listing-id="${escapeAttr(listing.listingId)}" ${toggleAction ? '' : 'disabled'}><i></i><span>${escapeHTML(statusMeta.label)}</span></button>` : ''}
    ${expanded ? `<div class="v3-listing-application-body"><div class="v3-listing-detail-head"><div><small>${isOwner ? 'YOUR LISTING' : 'MARKETPLACE OPERATION'}</small><strong>${isOwner ? 'Manage this API offer without leaving the market' : 'Review the published Operation contract'}</strong></div><span class="${isOwner ? 'ready' : 'market'}">${isOwner ? `${icon(ShieldCheck)} Owner controls` : `${icon(BadgeCheck)} Public listing`}</span></div>${integrationProvenance}<section class="v3-listing-detail-section"><header><span>API MANIFEST</span><strong>${escapeHTML(displayDescription || 'Machine-readable Exora API capability')}</strong></header>${renderV3ApplicationManifest(source, product.manifest || {})}</section>${isOwner ? `${readinessPanel}<div class="v3-listing-actions"><span><strong>Owner controls</strong><small>${escapeHTML(ownerStatusReason)}</small></span>${ownerActions}</div>` : ''}</div>` : ''}
  </article>`
}

function renderV3UnifiedListingsPageV2() {
  const items = v3UnifiedListingItems()
  const isBuyer = state.v3ListingMode === 'buyer'
  const visibleItems = items.filter((item) => {
    if (isBuyer ? item.isOwner : !item.isOwner) return false
    return true
  })
  const rows = visibleItems.map(renderV3UnifiedListingRow).join('')
  const sourceLoading = isBuyer ? state.v3CatalogLoading : state.v3ListingsLoading
  const sourceError = isBuyer ? state.v3CatalogError : state.v3SellerError
  const initialLoading = !rows && sourceLoading ? '<div class="v3-listing-loading"><span><i></i><b></b><em></em></span><span><i></i><b></b><em></em></span></div>' : ''
  const buyerEmpty = '<div class="v3-marketplace-empty"><span>' + icon(Search) + '</span><strong>No marketplace listings found</strong><small>Published and available Operations will appear here, including APIs from this account.</small></div>'
  const empty = !rows && !sourceLoading && (!isBuyer || !sourceError) ? (isBuyer ? buyerEmpty : renderV3ListingEmptyState()) : ''
  const placeholder = isBuyer ? 'Search the marketplace' : 'Search your listings and applications'
  return `<section class="v3-listings-page">
    <header class="v3-listing-fixed-header">
      <section class="v3-listing-search-switch">
        <label class="v3-listing-search">${toolbarIcons.search}<input type="search" data-v3-listing-search value="${escapeAttr(state.v3ListingQuery)}" placeholder="${placeholder}" aria-label="${placeholder}"/></label>
        ${isBuyer ? `<button type="button" class="v4-api-refresh v3-marketplace-refresh" data-v3-marketplace-refresh aria-label="Refresh marketplace orders" title="Refresh marketplace orders" aria-busy="${String(state.v3CatalogLoading)}" ${state.v3CatalogLoading ? 'disabled' : ''}>${icon(RefreshCw)}</button>` : ''}
      </section>
      ${isBuyer ? `<div class="v3-listing-agent-hint">${icon(MessagesSquare)}<span>${escapeHTML(t('listings.agentHint'))}</span><span class="v3-listing-agent-actions"><button type="button" data-v3-listing-agent-copy aria-label="${escapeAttr(t('listings.agentCopy'))}" title="${escapeAttr(t('listings.agentCopy'))}">${icon(Copy)}</button><button type="button" data-v3-listing-agent-details aria-label="${escapeAttr(t('listings.agentDetails'))}" title="${escapeAttr(t('listings.agentDetails'))}">${icon(Info)}</button></span></div>` : ''}
    </header>
    <section class="v3-listing-workspace v3-listing-${state.v3ListingMode}-view scroll-area">${sourceError ? `<div class="v3-market-view-error">${escapeHTML(sourceError)}</div>` : ''}${rows ? `<div class="v3-listing-list">${rows}</div>` : ''}${initialLoading}${empty}<div class="v3-listing-no-results hidden"><strong>No matching listings</strong><small>Try a different search.</small></div></section>
  </section>`
}

function providerOperationKey(apiId: string, operationId: string) {
  return `${apiId}:${operationId}`
}

function providerPreparationKey(apiId: string) {
  return `provider-api:${apiId}`
}

const providerIconOptions = [
  { key: 'code', label: 'Code', node: Code2 },
  { key: 'terminal', label: 'Terminal', node: Terminal },
  { key: 'bot', label: 'Agent', node: Bot },
  { key: 'database', label: 'Data', node: Database },
  { key: 'globe', label: 'Web', node: Globe2 },
  { key: 'cloud', label: 'Cloud', node: Cloud },
  { key: 'sparkles', label: 'AI', node: Sparkles },
] as const

function providerDisplayName(api: ProviderIntegration) {
  return String(api.displayName || api.title || 'Untitled API')
}

function providerIconOption(api: ProviderIntegration) {
  const fallback = api.deliveryMode === 'local_dock' ? 'code' : 'cloud'
  return providerIconOptions.find((option) => option.key === (api.icon || fallback)) || providerIconOptions.find((option) => option.key === fallback)!
}

function renderProviderIdentityModal() {
  const api = providerIntegrations.find((candidate) => candidate.apiId === providerIdentityEditorOpenAPIId)
  if (!api) return ''
  const selectedIcon = providerIconOption(api)
  const disabled = api.status === 'live' || api.status === 'draining' || Object.values(api.operationReviews || {}).some((review) => review.operationalState === 'live' || review.operationalState === 'draining')
  const iconChoices = providerIconOptions.map((option) => `<button type="button" class="v4-api-icon-choice ${option.key === selectedIcon.key ? 'selected' : ''}" data-api-icon-option="${option.key}" aria-pressed="${String(option.key === selectedIcon.key)}" title="${escapeAttr(option.label)}" aria-label="Use ${escapeAttr(option.label)} icon">${icon(option.node)}<span>${escapeHTML(option.label)}</span></button>`).join('')
  return `<div class="app-modal v4-api-identity-modal" data-api-identity-modal aria-hidden="false">
    <button class="app-modal-scrim" type="button" data-close-api-identity aria-label="Close API identity editor"></button>
    <section class="app-modal-panel v4-api-identity-panel" role="dialog" aria-modal="true" aria-labelledby="v4-api-identity-title" aria-describedby="v4-api-identity-description">
      <header class="app-modal-head"><div class="app-modal-head-copy"><span class="app-modal-head-mark" aria-hidden="true">${icon(selectedIcon.node)}</span><div><p class="eyebrow">API DRAFT IDENTITY</p><h2 id="v4-api-identity-title">Edit API name and icon</h2><span id="v4-api-identity-description">Customize how this Draft appears throughout your Provider workspace.</span></div></div><button type="button" class="app-modal-close" data-close-api-identity aria-label="Close API identity editor">${icon(X)}</button></header>
      <form class="v4-api-identity-editor" data-api-identity-form data-api-id="${escapeAttr(api.apiId)}" data-api-current-name="${escapeAttr(providerDisplayName(api))}" data-api-current-icon="${selectedIcon.key}">
        <div class="v4-api-identity-preview" aria-hidden="true">${icon(selectedIcon.node)}</div>
        <label class="v4-api-identity-name"><span>API name</span><input type="text" name="displayName" value="${escapeAttr(providerDisplayName(api))}" maxlength="160" autocomplete="off" required ${disabled ? 'disabled' : ''}/><small>Shown on this Draft and its Operation rows.</small></label>
        <fieldset class="v4-api-icon-picker" ${disabled ? 'disabled' : ''}><legend>Choose an icon</legend><input type="hidden" name="icon" value="${selectedIcon.key}"/>${iconChoices}</fieldset>
        <footer class="v4-api-identity-actions"><button type="button" class="app-setting-button outline" data-close-api-identity>Cancel</button><button type="submit" class="app-setting-button primary v4-api-identity-save" disabled>${disabled ? 'Offline to edit' : 'Save changes'}</button></footer>
      </form>
    </section>
  </div>`
}

function operationContext(key: string) {
  const separator = key.indexOf(':')
  const apiId = separator >= 0 ? key.slice(0, separator) : ''
  const operationId = separator >= 0 ? key.slice(separator + 1) : ''
  const api = providerIntegrations.find((item) => item.apiId === apiId)
  const review = api?.operationReviews?.[operationId]
  return { apiId, operationId, api, review }
}

function normalizeProviderIntegration(value: ProviderIntegration): ProviderIntegration {
  return { ...value, integrationId: value.apiId, stage: value.status, sourceKind: 'existing_http_api', sourceRef: value.apiId, adapterKind: value.deliveryMode === 'local_dock' ? 'executable_adapter' : 'declarative_adapter' }
}

function applyProviderIntegration(value?: ProviderIntegration) {
  if (!value?.apiId) return
  const normalized = normalizeProviderIntegration(value)
  const index = providerIntegrations.findIndex((candidate) => candidate.apiId === normalized.apiId)
  providerIntegrations = index < 0
    ? [...providerIntegrations, normalized]
    : providerIntegrations.map((candidate, candidateIndex) => candidateIndex === index ? normalized : candidate)
  providerIntegrationsRevision++
  providerIntegrationsLoaded = true
}

async function fetchLatestProviderIntegration(apiId: string) {
  const result = await invoke<{ apiDrafts?: ProviderIntegration[] }>('provider_api_drafts')
  providerIntegrations = (result.apiDrafts || []).map(normalizeProviderIntegration)
  providerIntegrationsRevision++
  providerIntegrationsLoaded = true
  return providerIntegrations.find((candidate) => candidate.apiId === apiId)
}

function isAPIDraftVersionConflict(error: unknown) {
  return humanizeError(error).toLowerCase().includes('api draft version conflict')
}

function providerRowState(api: ProviderIntegration, review?: APIOperationReview): ProviderRowState {
  const contractComplete = review?.integrationStatus === 'locked' && review?.pricingStatus === 'locked'
  const consoleActive = review?.operationalState === 'live' || review?.operationalState === 'draining'
  const progress: ProviderRowState['progress'] = consoleActive ? 2 : contractComplete ? 1 : 0
  if (review?.operationalState === 'live') return { uid: api.apiId, progress, statusLabel: 'Live', statusTone: 'ready' }
  if (review?.operationalState === 'draining') return { uid: api.apiId, progress: 2, statusLabel: 'Draining', statusTone: 'pending' }
  if (!review) return { uid: api.apiId, progress: 0, statusLabel: 'Contract required', statusTone: 'pending' }
  if (review.integrationStatus === 'failed') return { uid: api.apiId, progress, statusLabel: 'Contract test failed', statusTone: 'danger' }
  if (review.pricingStatus === 'failed') return { uid: api.apiId, progress, statusLabel: 'Billing test failed', statusTone: 'danger' }
  if (!contractComplete) return { uid: api.apiId, progress, statusLabel: review.pricingStatus === 'awaiting_confirmation' ? 'Contract review required' : 'Contract validation required', statusTone: 'pending' }
  return { uid: api.apiId, progress, statusLabel: 'Ready to publish', statusTone: 'ready' }
}

function providerUIDLabel(uid: string) {
  return uid.length > 30 ? `${uid.slice(0, 18)}…${uid.slice(-8)}` : uid
}

function renderProviderRowSummary(state: ProviderRowState) {
  return `<span class="v3-listing-summary-metrics v4-provider-summary-metrics"><span><small>UID</small><strong><code title="${escapeAttr(state.uid)}">${escapeHTML(providerUIDLabel(state.uid))}</code></strong></span><span><small>Progress</small><strong>${state.progress}/2 complete</strong></span></span>`
}

function renderProviderUIDCopy(uid: string) {
  return `<button type="button" class="v4-provider-uid-copy" data-copy-v3-identifier="${escapeAttr(uid)}" title="Copy stable API UID" aria-label="Copy stable API UID"><span class="v4-provider-uid-copy-text"><small>API UID</small><code>${escapeHTML(providerUIDLabel(uid))}</code></span>${toolbarIcons.copy}</button>`
}

function renderProviderContractGuideTrigger(api: ProviderIntegration) {
  return `<div class="v4-contract-guide-entry"><button type="button" class="v4-contract-guide-trigger" data-open-contract-guide="${escapeAttr(api.apiId)}" aria-haspopup="dialog"><span class="v4-contract-guide-trigger-icon">${icon(BookOpen)}</span><span><small>SELLER &amp; SELLER AGENT DOCUMENTATION</small><strong>API Contract Guide</strong><em>Schema, naming, OpenAPI, Operations, test fixtures, metering, billing and validation.</em></span><span class="v4-contract-guide-trigger-action">Open guide ${icon(ChevronRight)}</span></button><div class="v4-provider-detail-actions">${renderProviderUIDCopy(api.apiId)}</div></div>`
}

function providerDraftIsPristine(api: ProviderIntegration) {
  if (api.status !== 'local_draft') return false
  const capability = api.capability || {}
  const interfaceValue = capability.interface
  const runtimeValue = capability.runtime
  const operationsValue = capability.operations
  const hasInterface = Boolean(interfaceValue && typeof interfaceValue === 'object' && !Array.isArray(interfaceValue) && Object.keys(interfaceValue).length)
  const hasRuntime = Boolean(runtimeValue && typeof runtimeValue === 'object' && !Array.isArray(runtimeValue) && Object.keys(runtimeValue).length)
  const hasOperations = Array.isArray(operationsValue) && operationsValue.length > 0
  return !String(capability.title || api.title || '').trim()
    && !String(capability.description || api.description || '').trim()
    && !hasInterface
    && !hasRuntime
    && !hasOperations
}

function renderProviderValidationIssues(api: ProviderIntegration) {
  // A newly created local draft is intentionally empty. Its validation result
  // gates later workflow steps, but is not an error state the owner caused.
  if (providerDraftIsPristine(api)) return ''
  const issues = Array.isArray(api.validation?.issues) ? api.validation.issues : []
  if (!issues.length || api.validation?.status === 'passed') return ''
  return `<section class="v4-api-validation-issues"><header>${icon(AlertTriangle)}<div><strong>Capability Form needs attention</strong><small>Complete the preparation draft before Test and Pricing unlock.</small></div></header><ul>${issues.map((issue) => `<li><code>${escapeHTML(issue.operationId || 'api')}</code><span><strong>${escapeHTML(issue.fieldPath)}</strong><small>${escapeHTML(issue.message)}</small></span><em>${escapeHTML(issue.errorCode)}</em></li>`).join('')}</ul></section>`
}

function providerOperationMeteringDimensions(operation: Record<string, any>): string[] {
  const capabilities = Array.isArray(operation.metering?.capabilities) ? operation.metering.capabilities : []
  const dimensions: string[] = capabilities.map((value: unknown) => typeof value === 'string' ? value : String((value as Record<string, unknown>)?.dimension || '')).map((value: string) => value.trim()).filter(Boolean)
  return [...new Set<string>(dimensions)]
}

function providerVerifiedMeteringDimensions(operation: Record<string, any>, review?: APIOperationReview) {
  const declared = new Set(providerOperationMeteringDimensions(operation))
  const verified = Array.isArray(review?.validationReceipt?.verifiedMetering) ? review.validationReceipt.verifiedMetering : []
  return verified.map((meter) => String(meter.dimension || '')).filter((dimension) => declared.has(dimension))
}

function atomicToUSDCInput(value: unknown) {
  const text = String(value ?? '0').trim()
  if (!/^\d+$/.test(text)) return '0'
  const atoms = BigInt(text)
  const whole = atoms / 1_000_000n
  const fraction = String(atoms % 1_000_000n).padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

function usdcInputToAtomic(value: string) {
  const text = value.trim()
  if (!/^\d+(?:\.\d{0,6})?$/.test(text)) return undefined
  const [whole, fraction = ''] = text.split('.')
  const atoms = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0')
  if (atoms > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
  return Number(atoms)
}

function pricingSimulationCases(expression: string, variables: string[], sampleUsage: Record<string, number>) {
  const normalized = (usage: Record<string, number>) => Object.fromEntries(variables.map((variable) => [variable, Math.max(0, Math.trunc(Number(usage[variable] || 0)))]))
  const candidates: Array<{ label: string; usage: Record<string, number> }> = [
    { label: 'Qualification sample', usage: normalized(sampleUsage) },
    { label: 'Zero usage', usage: normalized({}) },
    { label: 'One unit', usage: normalized(Object.fromEntries(variables.map((variable) => [variable, 1]))) },
  ]
  const comparison = /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:<=|<|>=|>|==|!=)\s*(\d+(?:\.\d+)?)/g
  for (const match of expression.matchAll(comparison)) {
    const variable = match[1]
    if (!variables.includes(variable)) continue
    const threshold = Math.max(0, Math.floor(Number(match[2])))
    for (const [label, value] of [['Below threshold', Math.max(0, threshold - 1)], ['At threshold', threshold], ['Above threshold', threshold + 1]] as const) {
      candidates.push({ label: `${label} · ${variable}`, usage: normalized({ ...sampleUsage, [variable]: value }) })
    }
  }
  const seen = new Set<string>()
  return candidates.filter(({ usage }) => {
    const key = JSON.stringify(usage)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 9)
}

function providerPricingDraftFor(key: string, operation: Record<string, any>, review?: APIOperationReview) {
  if (providerPricingDrafts[key]?.operationSha256 === String(review?.operationSha256 || '')) return providerPricingDrafts[key]
  try {
    const cached = JSON.parse(localStorage.getItem(providerAccountStorageKey(providerPricingDraftStoragePrefix, key)) || 'null') as ProviderPricingDraft | null
    if (cached?.operationSha256 === String(review?.operationSha256 || '') && review?.pricingStatus === 'editable') {
      providerPricingDrafts[key] = cached
      return cached
    }
  } catch { /* ignore invalid local pricing cache */ }
  const pricing = (review?.pricingDraft || review?.pricing || {}) as Record<string, any>
  const dimensions = providerVerifiedMeteringDimensions(operation, review).filter((dimension) => dimension !== 'request')
  const expression = String(pricing.chargeFormula?.expression || '')
  const maximumCharge = pricing.maximumChargePerInvocationAtomic !== undefined ? atomicToUSDCInput(pricing.maximumChargePerInvocationAtomic) : ''
  const sampleUsage = Object.fromEntries(dimensions.map((dimension) => [dimension, Math.max(0, Number(review?.validationReceipt?.sampleUsage?.[dimension] || 0))]))
  providerPricingDrafts[key] = { operationSha256: String(review?.operationSha256 || ''), expression, maximumCharge, sampleUsage }
  return providerPricingDrafts[key]
}

function providerPricingDraftMatchesLocked(draft: ProviderPricingDraft, review?: APIOperationReview) {
  const locked = (review?.pricing || {}) as Record<string, any>
  return draft.expression.trim() === String(locked.chargeFormula?.expression || '').trim()
    && usdcInputToAtomic(draft.maximumCharge) === Number(locked.maximumChargePerInvocationAtomic)
}

function clearCachedProviderPricingDraft(key: string) {
  localStorage.removeItem(providerAccountStorageKey(providerPricingDraftStoragePrefix, key))
}

function renderProviderOperationProgress(key: string, active: ProviderOperationView, integrationComplete: boolean, pricingComplete: boolean, consoleComplete: boolean, interactive = true) {
  const steps: Array<{ id: ProviderOperationView; label: string; detail: string; complete: boolean; available: boolean }> = [
    { id: 'contract', label: 'Contract validation', detail: 'Upload one contract, run both tests and confirm', complete: integrationComplete && pricingComplete, available: true },
    { id: 'operations', label: 'Operations', detail: 'Publish, monitor and control fulfillment', complete: consoleComplete, available: integrationComplete && pricingComplete },
  ]
  const buttons = steps.map((step, index) => {
    const isActive = step.id === active
    const completionState = step.complete ? 'completed' : 'incomplete'
    const className = [isActive ? 'active' : '', completionState, !step.available ? 'locked' : ''].filter(Boolean).join(' ')
    const disabled = !interactive || !step.available
    return `<button type="button" role="tab" aria-selected="${isActive}" ${isActive ? 'aria-current="step"' : ''} class="${className}" data-progress-state="${completionState}" data-api-operation-view="${step.id}" data-operation-key="${escapeAttr(key)}" ${disabled ? 'disabled' : ''}><span>${step.complete ? icon(Check) : index + 1}</span><div><strong>${step.label}</strong><small>${step.detail}</small></div></button>`
  }).join('')
  return `<nav class="v4-operation-progress" role="tablist" aria-label="Operation progress" data-active-step="${active}">${buttons}</nav>`
}

function providerContractDocument(api: ProviderIntegration) {
  return api.contractPackage && api.contractPackage.schemaVersion === 'exora.api-contract.v1' ? api.contractPackage : undefined
}

function providerContractFacts(contract: Record<string, any>) {
  const operations = Array.isArray(contract.capability?.operations) ? contract.capability.operations : []
  const sellerCases = operations.reduce((total: number, operation: Record<string, any>) => total + (Array.isArray(operation?.qualification?.fixtures) ? operation.qualification.fixtures.length : 0), 0)
  const billingRules = Array.isArray(contract.billing) ? contract.billing.length : 0
  return { operations: operations.length, sellerCases, billingRules }
}

function renderProviderContractPanel(api: ProviderIntegration, operation?: Record<string, any>, review?: APIOperationReview, active = true) {
  const operationId = String(operation?.operationId || '')
  const key = operationId ? providerOperationKey(api.apiId, operationId) : providerPreparationKey(api.apiId)
  const contract = providerContractDocument(api)
  const immutable = review?.operationalState === 'live' || review?.operationalState === 'draining' || api.status === 'live' || api.status === 'draining'
  const validated = review?.integrationStatus === 'locked' && review?.pricingStatus === 'awaiting_confirmation' && Boolean(review?.pricingBillingReceipt?.passed)
  const confirmed = review?.integrationStatus === 'locked' && review?.pricingStatus === 'locked'
  const failed = review?.integrationStatus === 'failed' || review?.pricingStatus === 'failed'
  let title = contract ? 'Contract ready to test' : 'Import a contract to continue'
  let detail = contract ? 'One test runs integration validation first, then billing validation against the exact same contract.' : 'Drop or choose one JSON file above. Exora parses and saves the normalized contract automatically.'
  let primary = `<button type="button" disabled>Test contract</button>`
  if (contract && operationId) {
    primary = `<button type="button" data-api-contract-validate="${escapeAttr(key)}">${failed ? 'Run contract test again' : 'Test contract'}</button>`
    if (validated) {
      title = 'Contract tests passed'
      detail = 'Review both receipts, then confirm once to lock the integration and billing projections together.'
      primary = `<button type="button" data-api-contract-confirm="${escapeAttr(key)}">Confirm contract</button>`
    } else if (confirmed) {
      title = 'Contract confirmed'
      detail = immutable ? 'Live and draining Operations are immutable.' : 'The source contract is read-only. Replacing it invalidates both receipts and requires validation again.'
      primary = immutable ? `<button type="button" disabled>Contract locked</button>` : `<button type="button" class="ghost" data-api-contract-browse="${escapeAttr(key)}">Change contract</button>`
    } else if (failed) {
      title = 'Contract validation failed'
      detail = 'Replace or correct the contract, then run both automatic validations again.'
    }
  }
  const hash = String(api.contractPackageSha256 || '')
  const facts = contract ? providerContractFacts(contract) : undefined
  return `<div class="v4-operation-panel" role="tabpanel" data-api-operation-panel="contract" ${active ? '' : 'hidden'}>
    <section class="v4-contract-workspace" data-api-contract-workspace="${escapeAttr(key)}">
      ${renderProviderContractGuideTrigger(api)}
      <input type="file" accept="application/json,.json" data-api-contract-file="${escapeAttr(key)}" data-api-id="${escapeAttr(api.apiId)}" data-operation-id="${escapeAttr(operationId)}" hidden />
      ${contract ? `<section class="v4-contract-dropzone is-uploaded" data-api-contract-drop="${escapeAttr(key)}" data-api-contract-edit="${escapeAttr(key)}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="Edit uploaded API contract JSON"><span class="v4-contract-dropzone-icon">${icon(Check)}</span><span><strong>API Contract JSON uploaded</strong><small><code>${escapeHTML(String(contract.capability?.title || 'exora.api-contract.v1'))}</code> · Click to inspect or edit JSON</small><i>${facts?.operations || 0} Operation${facts?.operations === 1 ? '' : 's'} · ${facts?.sellerCases || 0} Seller case${facts?.sellerCases === 1 ? '' : 's'} · ${facts?.billingRules || 0} Billing rule${facts?.billingRules === 1 ? '' : 's'} · ${escapeHTML(hash.slice(0, 12))}…</i></span><button type="button" class="v4-contract-dropzone-remove" data-api-contract-clear="${escapeAttr(key)}" aria-label="Remove uploaded API contract" title="Remove uploaded API contract" ${immutable ? 'disabled' : ''}>${icon(X)}</button></section>` : `<button type="button" class="v4-contract-dropzone" data-api-contract-browse="${escapeAttr(key)}" data-api-contract-drop="${escapeAttr(key)}"><span class="v4-contract-dropzone-icon">${icon(FolderOpen)}</span><span><strong>Drop one API Contract JSON here</strong><small>or choose a local <code>exora.api-contract.v1</code> file · JSON only</small><i>Parsing, normalization and schema checks start immediately.</i></span><em aria-hidden="true">${icon(Plus)}</em></button>`}
      ${renderProviderValidationIssues(api)}
      ${renderProviderStepActionBar(api, title, detail, primary, !immutable)}
    </section>
  </div>`
}

function renderProviderPreparationFields(title: string, description: string, runtime: unknown, interfaceValue: unknown, operations: unknown) {
  const runtimeJSON = typeof runtime === 'string' ? runtime : JSON.stringify(runtime || {}, null, 2)
  const interfaceJSON = typeof interfaceValue === 'string' ? interfaceValue : JSON.stringify(interfaceValue || {}, null, 2)
  const operationsJSON = typeof operations === 'string' ? operations : JSON.stringify(Array.isArray(operations) ? operations : [], null, 2)
  return `<div class="v4-api-editor-grid">
    <section class="v4-api-editor-section v4-api-editor-identity"><header><span>01</span><div><strong>API identity</strong><small>Buyer-facing name and purpose.</small></div></header><div><label>API title<textarea class="v4-api-title-field" name="title" rows="1" placeholder="Document intelligence" required>${escapeHTML(title)}</textarea></label><label>Description<textarea name="description" placeholder="What can buyers accomplish with this API?" required>${escapeHTML(description)}</textarea></label></div></section>
    <section class="v4-api-editor-section"><header><span>02</span><div><strong>Shared runtime</strong><small>Credential-free base URL and health settings shared by every Operation.</small></div></header><label>Runtime JSON<textarea class="v4-api-code-field" name="runtime" required placeholder='{"publicBaseUrl":"http://127.0.0.1:8787","healthPath":"/health"}'>${escapeHTML(runtimeJSON)}</textarea></label></section>
    <section class="v4-api-editor-section"><header><span>03</span><div><strong>OpenAPI contract</strong><small>The authoritative OpenAPI 3.1 interface.</small></div></header><label>OpenAPI 3.1 JSON<textarea class="v4-api-code-field" name="interface" required placeholder='{"openapi":"3.1.0","info":{},"paths":{}}'>${escapeHTML(interfaceJSON)}</textarea></label></section>
    <section class="v4-api-editor-section v4-api-editor-operations"><header><span>04</span><div><strong>Operations and Seller fixtures</strong><small>Declare trusted metering and at least one safe call fixture. Fixtures select an OpenAPI response format; they never assert dynamic business results.</small></div></header><label>Operations JSON array<textarea class="v4-api-code-field" name="operations" required placeholder='[{"schemaVersion":"exora.operation.v3","qualification":{"fixtures":[...]}}]'>${escapeHTML(operationsJSON)}</textarea></label></section>
  </div>`
}

type ProviderPreparationFields = {
  title: string
  description: string
  runtime: string
  interface: string
  operations: string
}

function providerPreparationStorageKey(apiId: string) {
  return providerAccountStorageKey(providerPreparationDraftStoragePrefix, apiId)
}

function providerAccountStorageKey(prefix: string, key: string) {
  const accountID = String(state.authAccount?.accountId || '').trim()
  return `${prefix}${encodeURIComponent(accountID || 'inactive')}.${key}`
}

function providerPreparationFieldsFromCapability(api: ProviderIntegration): ProviderPreparationFields {
  const capability = api.capability || {}
  return {
    title: String(capability.title || api.title || ''),
    description: String(capability.description || api.description || ''),
    runtime: JSON.stringify(capability.runtime || {}, null, 2),
    interface: JSON.stringify(capability.interface || {}, null, 2),
    operations: JSON.stringify(Array.isArray(capability.operations) ? capability.operations : [], null, 2),
  }
}

function readCachedProviderPreparationFields(api: ProviderIntegration) {
  try {
    const cached = JSON.parse(localStorage.getItem(providerPreparationStorageKey(api.apiId)) || 'null')
    if (!cached || cached.baseVersion !== api.version || !cached.fields) return undefined
    return cached.fields as ProviderPreparationFields
  } catch {
    return undefined
  }
}

function cacheProviderPreparationFields(api: ProviderIntegration, fields: ProviderPreparationFields) {
  localStorage.setItem(providerPreparationStorageKey(api.apiId), JSON.stringify({ baseVersion: api.version, fields }))
}

function clearCachedProviderPreparationFields(apiId: string) {
  localStorage.removeItem(providerPreparationStorageKey(apiId))
}

function providerPreparationFieldsFromForm(form: HTMLFormElement): ProviderPreparationFields {
  const data = new FormData(form)
  return {
    title: String(data.get('title') || '').replace(/\s*[\r\n]+\s*/g, ' '),
    description: String(data.get('description') || ''),
    runtime: String(data.get('runtime') || '{}'),
    interface: String(data.get('interface') || '{}'),
    operations: String(data.get('operations') || '[]'),
  }
}

function providerCapabilityFromFields(fields: ProviderPreparationFields, deliveryMode: string) {
  let interfaceValue: Record<string, unknown>
  let runtime: Record<string, unknown>
  let operations: unknown[]
  try { interfaceValue = JSON.parse(fields.interface) } catch { throw new Error('OpenAPI 3.1 definition must be valid JSON.') }
  try { runtime = JSON.parse(fields.runtime) } catch { throw new Error('Runtime definition must be valid JSON.') }
  try { operations = JSON.parse(fields.operations) } catch { throw new Error('Operations must be a valid JSON array.') }
  if (!Array.isArray(operations)) throw new Error('Operations must be a JSON array.')
  if (!fields.title.trim() || !fields.description.trim()) throw new Error('API title and description are required.')
  return { schemaVersion: 'exora.api.v3', title: fields.title, description: fields.description, deliveryMode, interface: interfaceValue, runtime, operations }
}

function providerCapabilitiesMatch(left: Record<string, any>, right: Record<string, any>) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function providerPreparationFieldsAreTestable(fields: ProviderPreparationFields, deliveryMode: string) {
  try {
    const capability = providerCapabilityFromFields(fields, deliveryMode)
    return Array.isArray(capability.operations) && capability.operations.length > 0
  } catch {
    return false
  }
}

function renderProviderRemoveDraftAction(api: ProviderIntegration, forceDisabled = false) {
  const hasActiveOperation = Object.values(api.operationReviews || {}).some((review) => review.operationalState === 'live' || review.operationalState === 'draining')
  const disabled = forceDisabled || api.status === 'live' || api.status === 'draining' || hasActiveOperation
  const disabledReason = forceDisabled ? 'Wait for the current validation to finish' : 'Live or draining Operations cannot be deleted'
  return `<button type="button" class="danger ghost" data-api-draft-remove="${escapeAttr(api.apiId)}" data-api-version="${api.version}" ${disabled ? `disabled title="${disabledReason}"` : ''}>${icon(X)} Remove draft</button>`
}

function renderProviderStepActionBar(api: ProviderIntegration, title: string, detail: string, primaryAction: string, showRemove = true, disableRemove = false) {
  return `<footer class="v4-operation-action-bar"><span class="v4-operation-action-copy"><strong>${escapeHTML(title)}</strong><small>${escapeHTML(detail)}</small></span><div class="v4-operation-action-buttons">${showRemove ? renderProviderRemoveDraftAction(api, disableRemove) : ''}${primaryAction}</div></footer>`
}

type ProviderValidationGroup = 'connectivity' | 'response_format' | 'protocol' | 'metering'

const providerValidationGroupCopy: Record<ProviderValidationGroup, { title: string; detail: string }> = {
  connectivity: { title: 'Connectivity', detail: 'Runtime reachability and transport failure detection' },
  response_format: { title: 'Request and response formats', detail: 'OpenAPI schemas and Seller-provided call cases' },
  protocol: { title: 'Protocol capability', detail: 'Interaction mode and applicable delivery behavior' },
  metering: { title: 'Metering trust', detail: 'Declared dimensions, units, sources and invocation limits' },
}

function providerValidationCheckGroup(check: { id?: string; category?: string }): ProviderValidationGroup {
  const id = String(check.id || '')
  if (id === 'runtime_health' || id === 'platform_fault:connection_failure' || id === 'platform_fault:timeout') return 'connectivity'
  if (check.category === 'metering') return 'metering'
  if (check.category === 'protocol' || id === 'platform_fault:stream_interruption') return 'protocol'
  return 'response_format'
}

function providerValidationCheckCopy(check: { id?: string; category?: string; type?: string }) {
  const id = String(check.id || check.type || 'check')
  const type = String(check.type || '')
  if (id === 'runtime_health') return ['Runtime health endpoint', 'Confirms that the declared health endpoint is reachable.']
  if (id === 'request_schema') return ['Request schema', 'Confirms that Seller case requests conform to the declared OpenAPI request schema.']
  if (id === 'platform_fault:connection_failure') return ['Connection failure detection', 'Confirms that a controlled connection failure is classified safely.']
  if (id === 'platform_fault:timeout') return ['Timeout detection', 'Confirms that a controlled timeout or cancellation is classified safely.']
  if (id === 'platform_fault:invalid_schema') return ['Invalid response rejection', 'Confirms that malformed or schema-invalid responses are rejected.']
  if (id === 'platform_fault:stream_interruption') return ['Interrupted stream rejection', 'Generated only for Streaming Operations; confirms incomplete streams are rejected.']
  if (id === 'platform_fault:artifact_corruption') return ['Corrupted Artifact rejection', 'Generated only for Artifact outputs; confirms invalid metadata is rejected.']
  if (check.category === 'seller_case') {
    const fixture = id.replace(/^seller_case:/, '').replace(/[_-]+/g, ' ')
    const outcome = type === 'business_error' ? 'Business-error' : type === 'success' ? 'Successful' : type.replace(/[_-]+/g, ' ')
    return [`${outcome} Seller case`, `Runs “${fixture}” and validates status, media type and response schema—not dynamic business values.`]
  }
  if (check.category === 'protocol') {
    const mode = type === 'request_response' ? 'Request-response' : type === 'server_stream' ? 'Streaming' : type === 'async_job' ? 'Async job' : type
    return [`${mode} protocol`, 'Confirms that the declared interaction mode has the required protocol fields and fixtures.']
  }
  if (check.category === 'metering') {
    const dimension = id.replace(/^metering:/, '')
    return [`${dimension} metering`, 'Confirms the declared unit, trusted source and per-invocation maximum are available for later billing validation.']
  }
  return [id.replace(/[:_-]+/g, ' '), 'Checks the current integration contract.']
}

function renderProviderValidationPlan(review: APIOperationReview, operation: Record<string, any>) {
  const plan = review.validationPlan
  if (!plan) return ''
  const interactionMode = String(operation?.interaction?.mode || '')
  const hasArtifacts = Array.isArray(operation?.artifacts?.outputs) && operation.artifacts.outputs.length > 0
  const checks = (Array.isArray(plan.checks) ? plan.checks : []).filter((check) => {
    const id = String(check.id || '')
    if (id === 'platform_fault:stream_interruption') return interactionMode === 'server_stream'
    if (id === 'platform_fault:artifact_corruption') return hasArtifacts
    return true
  })
  const grouped = Object.fromEntries((Object.keys(providerValidationGroupCopy) as ProviderValidationGroup[]).map((group) => [group, checks.filter((check) => providerValidationCheckGroup(check) === group)])) as Record<ProviderValidationGroup, typeof checks>
  const groups = (Object.keys(providerValidationGroupCopy) as ProviderValidationGroup[]).filter((group) => grouped[group].length > 0)
  const sellerCases = checks.filter((check) => check.category === 'seller_case').length
  const running = review.validationRun?.status === 'running'
  const passed = Boolean(review.validationReceipt?.passed) && (review.integrationStatus === 'awaiting_confirmation' || review.integrationStatus === 'locked')
  const failed = review.integrationStatus === 'failed' || review.validationRun?.status === 'failed'
  const stateClass = running ? 'is-running' : passed ? 'is-passed' : failed ? 'is-failed' : 'is-ready'
  const stateLabel = running ? 'Testing' : passed ? 'Passed' : failed ? 'Needs attention' : 'Prepared'
  const groupRows = groups.map((group) => {
    const copy = providerValidationGroupCopy[group]
    const items = grouped[group].map((check) => {
      const [title, detail] = providerValidationCheckCopy(check)
      return `<article><span>${icon(Check)}</span><div><strong>${escapeHTML(title)}</strong><small>${escapeHTML(detail)}</small></div></article>`
    }).join('')
    return `<details class="v4-validation-group ${stateClass}"><summary><span><strong>${escapeHTML(copy.title)}</strong><small>${escapeHTML(copy.detail)}</small></span><em>${grouped[group].length} ${grouped[group].length === 1 ? 'check' : 'checks'} · ${stateLabel}</em></summary><div>${items}</div></details>`
  }).join('')
  const technicalChecks = checks.map((check) => `<code>${escapeHTML(String(check.id || check.type || 'check'))}</code>`).join('')
  const statusDetail = running
    ? 'The saved integration snapshot is being tested.'
    : failed
      ? String(review.validationRun?.failure || 'Correct the integration contract, then run the test again.')
      : passed
        ? 'Connectivity, protocol and machine-checkable response formats passed. Dynamic business values were not compared.'
        : 'Review the generated scope, then run the integration test.'
  const runId = String(review.validationRun?.runId || '')
  return `<section class="v4-validation-plan ${stateClass}"><header><div><strong>Integration test</strong><small>${groups.length} capability areas · ${checks.length} checks · ${sellerCases} Seller cases · ${Math.max(0, checks.length - sellerCases)} system checks</small></div><em>${stateLabel}</em></header><p class="v4-validation-status-copy">${escapeHTML(statusDetail)}</p><div class="v4-validation-groups">${groupRows}</div><details class="v4-validation-technical"><summary>Technical details</summary><div><span>Plan hash <code>${escapeHTML(String(plan.planSha256 || ''))}</code></span>${runId ? `<span>Run ID <code>${escapeHTML(runId)}</code></span>` : ''}<div>${technicalChecks}</div></div></details></section>`
}

function renderProviderPreparationForm(api: ProviderIntegration, operationId = '', review?: APIOperationReview) {
  const key = operationId ? providerOperationKey(api.apiId, operationId) : ''
  const editingLockedIntegration = Boolean(key && providerIntegrationEditKeys.has(key))
  const immutable = !editingLockedIntegration && (review?.integrationStatus === 'awaiting_confirmation' || review?.integrationStatus === 'locked' || review?.validationRun?.status === 'running' || review?.operationalState === 'live' || review?.operationalState === 'draining')
  const canonicalFields = providerPreparationFieldsFromCapability(api)
  const operation = (Array.isArray(api.capability?.operations) ? api.capability.operations : []).find((candidate: Record<string, any>) => String(candidate?.operationId || '') === operationId) || {}
  const fields = !immutable && !editingLockedIntegration ? readCachedProviderPreparationFields(api) || canonicalFields : canonicalFields
  let primaryAction = `<button type="button" data-api-connectivity-test-form="${escapeAttr(api.apiId)}" ${providerPreparationFieldsAreTestable(fields, api.deliveryMode) ? '' : 'disabled'}>Run integration test</button>`
  let title = 'Integration draft'
  let detail = 'Changes are stored locally. Testing commits and validates one exact capability snapshot.'
  if (review?.validationRun?.status === 'running') {
    title = 'Integration test running'
    detail = 'This persistent run is bound to the current version and plan hash. Progress refreshes automatically.'
    primaryAction = `<button type="button" disabled>Validation running…</button>`
  } else if (review?.integrationStatus === 'failed') {
    title = 'Integration test failed'
    detail = 'Correct the highlighted contract or protocol issue, then validate the updated snapshot.'
    primaryAction = `<button type="button" data-api-connectivity-test-form="${escapeAttr(api.apiId)}">Run integration test again</button>`
  }
  if (review?.integrationStatus === 'awaiting_confirmation') {
    title = 'Integration test passed'
    detail = 'Review the tested snapshot, then submit and lock this exact capability and metering contract.'
    primaryAction = `<button type="button" data-api-lock-integration="${escapeAttr(key)}">Submit integration</button>`
  }
  if (review?.integrationStatus === 'locked') {
    title = editingLockedIntegration ? 'Change integration' : 'Integration submitted'
    detail = editingLockedIntegration ? 'Edit a local working copy. The submitted version remains unchanged until you save.' : 'The submitted integration is read-only. It can only be changed while this Operation is offline.'
    primaryAction = editingLockedIntegration
      ? `<button type="button" class="ghost" data-api-cancel-integration-edit="${escapeAttr(key)}">Cancel changes</button><button type="button" data-api-save-integration-edit="${escapeAttr(key)}" disabled>Save changes</button>`
      : `<button type="button" class="ghost" data-api-begin-integration-edit="${escapeAttr(key)}">Change integration</button>`
  }
  return `<form class="v4-integration-create v4-api-manual-editor ${review?.integrationStatus === 'locked' && !editingLockedIntegration ? 'is-submitted' : ''}" data-api-preparation-form data-api-id="${escapeAttr(api.apiId)}" data-operation-id="${escapeAttr(operationId)}" data-delivery-mode="${escapeAttr(api.deliveryMode)}">
      <fieldset class="v4-provider-stage-fields" ${immutable ? 'disabled' : ''}>${renderProviderPreparationFields(fields.title, fields.description, fields.runtime, fields.interface, fields.operations)}</fieldset>
      ${renderProviderValidationIssues(api)}
      ${review ? renderProviderValidationPlan(review, operation) : ''}
      ${renderProviderStepActionBar(api, title, detail, primaryAction, !editingLockedIntegration, review?.validationRun?.status === 'running')}
    </form>`
}

function renderProviderIntegrationPanel(api: ProviderIntegration, operation: Record<string, any>, review: APIOperationReview | undefined, active: boolean) {
  const operationId = String(operation.operationId || '')
  return `<div class="v4-operation-panel" role="tabpanel" data-api-operation-panel="integration" ${active ? '' : 'hidden'}>${renderProviderPreparationForm(api, operationId, review)}</div>`
}

const providerPricingBookRules = [
  ['Fixed execution charge', 'Deterministic calls', '0.01', 'A constant is charged only after execution starts.'],
  ['Successful delivery charge', 'Charge only after successful delivery', 'delivered * 0.02', 'Cloud supplies delivered as 1 for success and 0 for execution cancellation.'],
  ['Token usage', 'Language and embedding models', 'input_tokens * 1.5 / 1000000 + output_tokens * 3 / 1000000', 'Only Integration-verified token dimensions may be referenced.'],
  ['Time blocks', 'Compute sessions and media processing', 'ceil(execution_second / 60) * 0.02', 'A positive constant divisor keeps every legal input defined.'],
  ['Streaming', 'SSE and incremental delivery', 'output_bytes * 0.1 / 1000000', 'Charge only trusted output already emitted.'],
  ['Documents and batches', 'Page, image, audio or record processing', 'page * 0.02', 'Missing or conflicting measurements refund the invocation.'],
  ['Tiered pricing', 'Bounded volume tiers', 'if(record <= 100, record * 0.001, 0.1 + (record - 100) * 0.0005)', 'Both branches must be bounded and non-negative.'],
] as const

function renderProviderPricingBook() {
  const examples = providerPricingBookRules.map(([title, scene, expression, note]) => `<article><header><strong>${escapeHTML(title)}</strong><small>${escapeHTML(scene)}</small></header><code>${escapeHTML(expression)}</code><p>${escapeHTML(note)}</p></article>`).join('')
  return `<div class="app-modal v4-pricing-book-modal" data-pricing-book-modal aria-hidden="false">
    <button class="app-modal-scrim" type="button" data-close-pricing-book aria-label="Close Exora Pricing Book"></button>
    <section class="app-modal-panel v4-pricing-book-panel" role="dialog" aria-modal="true" aria-labelledby="v4-pricing-book-title" aria-describedby="v4-pricing-book-description">
      <header class="app-modal-head"><div class="app-modal-head-copy"><span class="app-modal-head-mark" aria-hidden="true">${icon(BadgeDollarSign)}</span><div><p class="eyebrow">EXORA PRICING BOOK · V4</p><h2 id="v4-pricing-book-title">Design a safe pricing formula</h2><span id="v4-pricing-book-description">Read-only guidance. Nothing here changes the formal pricing rule.</span></div></div><button type="button" class="app-modal-close" data-close-pricing-book aria-label="Close Exora Pricing Book">${icon(X)}</button></header>
      <div class="v4-pricing-book-body">
        <section class="v4-pricing-book-principles"><article><strong>Formula result</strong><small>The expression returns USDC and rounds up to the nearest atomic unit.</small></article><article><strong>Invocation maximum</strong><small>Every charge is capped by the owner-entered maximum.</small></article><article><strong>Trusted inputs</strong><small>Use only Integration-verified meters and the Cloud variable delivered.</small></article></section>
        <section class="v4-pricing-book-syntax"><header><strong>Formula language</strong><small>Numbers support six decimal places. Divisors must be positive constants.</small></header><code>+  -  *  /  min  max  ceil  floor  if  and  or  not  &lt;  &lt;=  &gt;  &gt;=  ==  !=</code></section>
        <section class="v4-pricing-book-examples"><header><strong>Reference strategies</strong><small>These examples explain common structures. Write and test your own rule in Billing validation.</small></header><div>${examples}</div></section>
        <section class="v4-pricing-book-settlement"><header><strong>Settlement matrix</strong><small>The platform decides whether the formula is allowed to run.</small></header><div><article><strong>Success</strong><small>Formula runs with delivered = 1 and actual trusted usage.</small></article><article><strong>Cancel after execution</strong><small>Formula runs with delivered = 0 and usage already incurred.</small></article><article><strong>Before execution, business error or system fault</strong><small>Formula does not run. The full reservation is released.</small></article></div></section>
      </div>
    </section>
  </div>`
}

function renderProviderContractGuide() {
  const api = providerIntegrations.find((candidate) => candidate.apiId === providerContractGuideOpenAPIId)
  const apiId = api?.apiId || providerContractGuideOpenAPIId || 'api_REPLACE_WITH_STABLE_UID'
  const deliveryMode = api?.deliveryMode || (state.v3SellerTab === 'cloud_api' ? 'cloud_direct' : 'local_dock')
  return `<div class="app-modal v4-contract-guide-modal" data-contract-guide-modal aria-hidden="false">
    <button class="app-modal-scrim" type="button" data-close-contract-guide aria-label="Close API Contract Guide"></button>
    <section class="app-modal-panel v4-contract-guide-panel" role="dialog" aria-modal="true" aria-labelledby="v4-contract-guide-title" aria-describedby="v4-contract-guide-description">
      <header class="app-modal-head"><div class="app-modal-head-copy"><span class="app-modal-head-mark" aria-hidden="true">${icon(BookOpen)}</span><div><p class="eyebrow">EXORA API CONTRACT · COMPLETE REFERENCE</p><h2 id="v4-contract-guide-title">Write, test and submit an API contract</h2><span id="v4-contract-guide-description">For sellers and authorized Seller Agents. The checked-in schemas and Dock validation remain authoritative.</span></div></div><button type="button" class="app-modal-close" data-close-contract-guide aria-label="Close API Contract Guide">${icon(X)}</button></header>
      ${renderProviderContractGuideBody(apiId, deliveryMode)}
    </section>
  </div>`
}

function renderProviderContractEditor() {
  const { apiId, api } = operationContext(providerContractEditorOpenKey)
  const contract = api ? providerContractDocument(api) : undefined
  if (!api || !contract) return ''
  return `<div class="app-modal v4-contract-editor-modal" data-contract-editor-modal aria-hidden="false">
    <button class="app-modal-scrim" type="button" data-close-contract-editor aria-label="Close JSON editor"></button>
    <section class="app-modal-panel v4-contract-editor-panel" role="dialog" aria-modal="true" aria-labelledby="v4-contract-editor-title" aria-describedby="v4-contract-editor-description">
      <header class="app-modal-head"><div class="app-modal-head-copy"><span class="app-modal-head-mark" aria-hidden="true">${icon(Code2)}</span><div><p class="eyebrow">API CONTRACT JSON</p><h2 id="v4-contract-editor-title">Inspect or edit uploaded contract</h2><span id="v4-contract-editor-description">Saving replaces the current contract for <code>${escapeHTML(apiId)}</code> and reruns schema normalization.</span></div></div><button type="button" class="app-modal-close" data-close-contract-editor aria-label="Close JSON editor">${icon(X)}</button></header>
      <div class="v4-contract-editor-body"><label for="v4-contract-json-editor">Contract JSON</label><textarea id="v4-contract-json-editor" data-contract-json-editor spellcheck="false" aria-describedby="v4-contract-editor-status">${escapeHTML(JSON.stringify(contract, null, 2))}</textarea><div class="v4-contract-editor-status" id="v4-contract-editor-status" data-contract-editor-status role="status">Edit the complete source contract. JSON syntax and the contract schema are checked when you save.</div></div>
      <footer class="v4-contract-editor-actions"><button type="button" class="app-setting-button soft" data-format-contract-json>Format JSON</button><span></span><button type="button" class="app-setting-button outline" data-close-contract-editor>Cancel</button><button type="button" class="app-setting-button primary" data-save-contract-json>Save changes</button></footer>
    </section>
  </div>`
}

function renderProviderPricingPanel(api: ProviderIntegration, operation: Record<string, any>, review: APIOperationReview | undefined, active: boolean) {
  const operationId = String(operation.operationId || '')
  const key = providerOperationKey(api.apiId, operationId)
  if (review?.integrationStatus !== 'locked') {
    return `<div class="v4-operation-panel" role="tabpanel" data-api-operation-panel="billing" ${active ? '' : 'hidden'}><section class="v4-operation-pricing-locked">${icon(ShieldAlert)}<div><strong>Billing validation is locked</strong><small>Pass and lock Integration validation first.</small></div></section></div>`
  }
  const dimensions = providerVerifiedMeteringDimensions(operation, review).filter((dimension) => dimension !== 'request')
  const formulaDimensions = [...dimensions, 'delivered']
  const verifiedMeters = review.validationReceipt?.verifiedMetering || []
  const unitByDimension = Object.fromEntries(verifiedMeters.map((meter) => [String(meter.dimension || ''), String(meter.unit || 'unit')]))
  const draft = providerPricingDraftFor(key, operation, review)
  const editingLockedPricing = providerPricingEditKeys.has(key)
  const disabled = review.pricingStatus === 'awaiting_confirmation' || (review.pricingStatus === 'locked' && !editingLockedPricing) || review.operationalState === 'live' || review.operationalState === 'draining'
  const pricingChanged = !providerPricingDraftMatchesLocked(draft, review)
  const maximumAtomic = usdcInputToAtomic(draft.maximumCharge)
  let previewError = ''
  let previewSuccessAtomic = 0
  let previewCancelAtomic = 0
  let formulaVariables: string[] = []
  try {
    if (maximumAtomic === undefined || maximumAtomic < 1) throw new Error('Enter a positive maximum charge.')
    const compiled = compilePriceFormula(draft.expression, formulaDimensions)
    formulaVariables = compiled.variables
    const sample = Object.fromEntries(formulaVariables.filter((dimension) => dimension !== 'delivered').map((dimension) => [dimension, Math.max(0, Number(draft.sampleUsage[dimension] || 0))]))
    previewSuccessAtomic = compiled.evaluate({ ...sample, delivered: 1 }, maximumAtomic).billedAtomic
    previewCancelAtomic = compiled.evaluate({ ...sample, delivered: 0 }, maximumAtomic).billedAtomic
  } catch (error) {
    previewError = humanizeError(error)
  }
  const money = (value: number | undefined) => value === undefined ? '—' : `${atomicToUSDCInput(value)} USDC`
  const metering = verifiedMeters.filter((meter) => dimensions.includes(String(meter.dimension || ''))).map((meter) => `<span><strong>${escapeHTML(String(meter.dimension || ''))}</strong><small>${escapeHTML(String(meter.unit || 'unit'))} · ${escapeHTML(String(meter.source || ''))} · max ${escapeHTML(String(meter.maximumPerInvocation ?? '—'))}</small></span>`).join('')
  const variableShortcuts = dimensions.length ? `<div class="v4-price-variable-chips">${dimensions.map((dimension) => `<button type="button" data-price-insert-variable="${escapeAttr(dimension)}">${escapeHTML(dimension)}</button>`).join('')}</div>` : ''
  const usageInputs = formulaVariables.filter((dimension) => dimension !== 'delivered').map((dimension) => `<label>${escapeHTML(dimension)} <small>${escapeHTML(unitByDimension[dimension] || 'unit')}</small><input data-price-sample="${escapeAttr(dimension)}" type="number" min="0" step="1" value="${Math.max(0, Number(draft.sampleUsage[dimension] || 0))}"/></label>`).join('')
  const receipt = review.pricingBillingReceipt
  const receiptPanel = receipt ? `<section class="v4-stage-receipt"><span>${icon(ShieldCheck)}</span><div><strong>Sandbox billing receipt ${escapeHTML(String(receipt.receiptId || ''))}</strong><small>${escapeHTML(String(receipt.scenarios?.length || 0))} settlement cases passed · formula AST ${escapeHTML(String(receipt.formulaAstSha256 || '').slice(0, 16))}</small></div></section>` : ''
  let actions = `<button type="submit" data-pricing-action="test" ${previewError ? 'disabled' : ''}>Run billing test</button>`
  let actionTitle = 'Pricing rule'
  let actionDetail = 'Testing submits this exact local formula and maximum to the no-real-USDC Sandbox Ledger.'
  if (review.pricingStatus === 'awaiting_confirmation') {
    actionTitle = 'Billing test passed'
    actionDetail = 'Confirm and lock the exact tested formula and invocation maximum.'
    actions = `<button type="button" data-api-lock-pricing="${escapeAttr(key)}">Confirm pricing</button>`
  } else if (review.pricingStatus === 'locked') {
    actionTitle = editingLockedPricing ? 'Change pricing' : 'Pricing confirmed'
    actionDetail = editingLockedPricing ? 'Edit a local working copy. The confirmed price remains unchanged until this rule passes billing validation.' : 'Pricing can only be changed while this Operation is offline.'
    actions = editingLockedPricing
      ? `<button type="button" class="ghost" data-api-cancel-pricing-edit="${escapeAttr(key)}">Cancel changes</button><button type="submit" data-pricing-action="test" ${previewError || !pricingChanged ? 'disabled' : ''}>Run billing test</button>`
      : `<button type="button" class="ghost" data-api-begin-pricing-edit="${escapeAttr(key)}">Change pricing</button>`
  }
  return `<div class="v4-operation-panel" role="tabpanel" data-api-operation-panel="billing" ${active ? '' : 'hidden'}>
    <form class="v4-operation-pricing-form v4-manual-pricing" data-api-pricing-form data-api-id="${escapeAttr(api.apiId)}" data-operation-id="${escapeAttr(operationId)}" data-operation-key="${escapeAttr(key)}">
      <header><div><span>BILLING VALIDATION</span><strong>Design and test one pricing rule</strong><small>Exora validates the formula and settlement; it never chooses your price.</small></div><em>${escapeHTML(review.pricingStatus.replaceAll('_', ' '))}</em></header>
      <fieldset ${disabled ? 'disabled' : ''}>
        <section class="v4-price-rule ${previewError ? 'has-error' : 'is-valid'}"><header><div><strong>Pricing formula</strong><small>USDC · verified inputs only · positive constant divisors · capped per invocation</small></div><button type="button" class="ghost" data-open-pricing-book="${escapeAttr(key)}">${icon(BadgeDollarSign)} Open Exora Pricing Book</button></header><div class="v4-price-rule-grid"><label>Maximum per invocation (USDC)<input required data-api-price-maximum type="text" inputmode="decimal" value="${escapeAttr(draft.maximumCharge)}" placeholder="1.00"/></label><div class="v4-price-formula-tools"><button type="button" data-price-format ${previewError ? 'disabled' : ''}>Format formula</button><span>${previewError ? 'Needs attention' : 'Preview valid'}</span></div></div>${variableShortcuts}<textarea required data-api-price-formula spellcheck="false" placeholder="delivered * 0.02">${escapeHTML(draft.expression)}</textarea>${metering ? `<div class="v4-price-trusted-inline">${metering}</div>` : ''}<p class="v4-price-system-variable"><code>delivered</code><span>Exora Cloud sets this to 1 after successful delivery and 0 after execution cancellation. It is not seller-reported.</span></p><p class="v4-price-formula-help">The formula returns USDC. Use a constant for a fixed invocation charge; use only verified dimensions for usage charges.</p>${previewError ? `<div class="v4-price-formula-error">${icon(AlertTriangle)}<span>${escapeHTML(previewError)}</span></div>` : ''}</section>
        <section class="v4-price-preview"><header><div><strong>Preview</strong><small>Local estimate only; the Sandbox Ledger creates evidence.</small></div><em>PREVIEW</em></header>${usageInputs ? `<div class="v4-price-sample-grid">${usageInputs}</div>` : ''}<div class="v4-price-preview-results"><span><small>Successful delivery</small><strong>${previewError ? '—' : money(previewSuccessAtomic)}</strong></span><span><small>Cancel after execution</small><strong>${previewError ? '—' : money(previewCancelAtomic)}</strong></span><span><small>Invocation maximum</small><strong>${money(maximumAtomic)}</strong></span></div></section>
      </fieldset>
      ${receiptPanel}
      ${renderProviderStepActionBar(api, actionTitle, actionDetail, actions, !editingLockedPricing)}
    </form>
  </div>`
}

// Kept during the persisted V3-draft compatibility window. The two-step V1
// contract renderer never mounts these legacy editors.
void renderProviderIntegrationPanel
void renderProviderPricingPanel

function renderLegacyProviderConsolePanel(api: ProviderIntegration, operation: Record<string, any>, review: APIOperationReview | undefined, active: boolean) {
  const operationId = String(operation.operationId || '')
  const key = providerOperationKey(api.apiId, operationId)
  if (review?.pricingStatus !== 'locked') {
    return `<div class="v4-operation-panel" role="tabpanel" data-api-operation-panel="operations" ${active ? '' : 'hidden'}><section class="v4-operation-pricing-locked">${icon(ShieldAlert)}<div><strong>Operations are locked</strong><small>Pass both contract validations and confirm the contract first.</small></div></section></div>`
  }
  const metrics = review.operationalMetrics || {}
  const stateLabel = review.operationalState || 'offline'
  const metricCards = [
    ['Lifecycle', stateLabel],
    ['In flight', String(metrics.inFlight || 0)],
    ['Invocations', String(metrics.invocations || 0)],
    ['Gross revenue', `${atomicToUSDCInput(metrics.grossRevenueAtomic || 0)} USDC`],
    ['Refunded', `${atomicToUSDCInput(metrics.refundedAtomic || 0)} USDC`],
    ['Provider fault rate', `${Number(metrics.providerFaultRate || 0).toFixed(2)}%`],
  ].map(([label, value]) => `<article><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></article>`).join('')
  const protectionRows = [
    ['Metering integrity', 'Missing, conflicting, illegal or out-of-range metering blocks new calls and refunds the invocation.', Boolean(metrics.blocked)],
    ['Health protection', 'Two consecutive health failures block new calls.', Number(metrics.healthFailureStreak || 0) >= 2],
    ['Fault-rate protection', 'At least 10 calls in 15 minutes and Provider fault rate ≥ 10% blocks new calls.', Number(metrics.providerFaultRate || 0) >= 10],
  ].map(([label, detail, triggered]) => `<article class="${triggered ? 'triggered' : ''}"><span>${triggered ? icon(AlertTriangle) : icon(ShieldCheck)}</span><div><strong>${escapeHTML(String(label))}</strong><small>${escapeHTML(String(detail))}</small></div></article>`).join('')
  let actions = `<button type="button" data-api-publish="${escapeAttr(key)}">Publish Operation</button>`
  let actionTitle = 'Offline'
  let actionDetail = 'Publishing enables new invocations after Cloud validates the locked integration and billing receipts.'
  if (stateLabel === 'live') {
    actionTitle = 'Live'
    actionDetail = 'Normal removal rejects new calls and drains in-flight work. Force stop cancels unfinished work, refunds it and records seller responsibility.'
    actions = `<button type="button" class="ghost" data-api-lifecycle="${escapeAttr(key)}" data-lifecycle-action="take_offline">Take offline</button><button type="button" class="danger ghost" data-api-lifecycle="${escapeAttr(key)}" data-lifecycle-action="force_stop">Force stop</button>`
  } else if (stateLabel === 'draining') {
    actionTitle = 'Draining'
    actionDetail = review.operationalStatusReason || 'New calls are blocked while in-flight fulfillment completes.'
    actions = `<button type="button" class="ghost" data-api-lifecycle="${escapeAttr(key)}" data-lifecycle-action="complete_draining" ${Number(metrics.inFlight || 0) > 0 ? 'disabled' : ''}>Complete offline</button><button type="button" class="danger ghost" data-api-lifecycle="${escapeAttr(key)}" data-lifecycle-action="force_stop">Force stop</button>`
  }
  return `<div class="v4-operation-panel" role="tabpanel" data-api-operation-panel="operations" ${active ? '' : 'hidden'}><section class="v4-operation-console"><header><div><span>OPERATIONS</span><strong>Lifecycle, fulfillment, usage, revenue and protection</strong><small>Live updates use SSE; Dock refreshes the snapshot every 15 seconds if the stream disconnects.</small></div><em class="state-${escapeAttr(stateLabel)}">${escapeHTML(stateLabel)}</em></header><div class="v4-console-metrics">${metricCards}</div><section class="v4-console-protection"><header><strong>Strict protection rules</strong><small>${escapeHTML(review.operationalStatusReason || 'No active protection block.')}</small></header><div>${protectionRows}</div></section></section>${renderProviderStepActionBar(api, actionTitle, actionDetail, actions)}</div>`
}

void renderLegacyProviderConsolePanel

function renderProviderConsolePanel(api: ProviderIntegration, operation: Record<string, any>, review: APIOperationReview | undefined, active: boolean) {
  const operationId = String(operation.operationId || '')
  const key = providerOperationKey(api.apiId, operationId)
  if (review?.pricingStatus !== 'locked') {
    return `<div class="v4-operation-panel" role="tabpanel" data-api-operation-panel="operations" ${active ? '' : 'hidden'}><section class="v4-operation-pricing-locked">${icon(ShieldAlert)}<div><strong>Operations are locked</strong><small>Pass both contract validations and confirm the contract first.</small></div></section></div>`
  }
  const metrics = review.operationalMetrics || {}
  const stateLabel = review.operationalState || 'offline'
  const limits = operation.limits || {}
  const maximumConcurrency = Math.max(1, Number(limits.maximumConcurrency || 1))
  const configuredConcurrency = Math.min(maximumConcurrency, Math.max(1, Number(review.operationalSettings?.concurrencyLimit || maximumConcurrency)))
  const inFlight = Math.max(0, Number(metrics.inFlight || 0))
  const activeConsumers = Math.max(0, Number(metrics.activeConsumers || 0))
  const healthFailureStreak = Math.max(0, Number(metrics.healthFailureStreak || 0))
  const providerFaultRate = Math.max(0, Number(metrics.providerFaultRate || 0))
  const protectionTriggered = Boolean(metrics.blocked) || healthFailureStreak >= 2 || providerFaultRate >= 10
  const runtimeHealthy = metrics.healthStatus === 'healthy' || review.validationReceipt?.passed
  const healthLabel = protectionTriggered ? 'Action required' : runtimeHealthy ? 'Healthy' : 'Not checked'
  const healthDetail = protectionTriggered
    ? (review.operationalStatusReason || 'New calls are protected until the health issue is resolved.')
    : runtimeHealthy ? 'Runtime and latest validation are healthy' : 'Run contract validation to verify health'
  const pricing = (review.pricing || review.pricingDraft || {}) as Record<string, any>
  const priceExpression = String(pricing.chargeFormula?.expression || '').trim()
  const fixedPrice = /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(priceExpression)
  const maximumPrice = Number(pricing.maximumChargePerInvocationAtomic || 0)
  const priceLabel = fixedPrice ? `${priceExpression} USDC` : priceExpression ? 'Usage based' : 'Not set'
  const priceDetail = fixedPrice ? 'per successful invocation' : maximumPrice > 0 ? `maximum ${atomicToUSDCInput(maximumPrice)} USDC / invocation` : 'No invocation maximum available'
  const concurrencySetting = `<form class="v4-console-concurrency" data-api-concurrency-form="${escapeAttr(key)}"><span>Concurrent requests</span><div class="v4-console-concurrency-input"><input type="number" name="concurrencyLimit" min="1" max="${maximumConcurrency}" step="1" value="${configuredConcurrency}" aria-label="Concurrent request limit"><button type="submit" class="v4-console-concurrency-apply" disabled>Save</button></div></form>`
  const summaryMetrics = [
    ['Users now', String(activeConsumers), `${inFlight} active request${inFlight === 1 ? '' : 's'}`, ''],
    ['Price', priceLabel, priceDetail, ''],
    ['Health', healthLabel, healthDetail, `health-${protectionTriggered ? 'danger' : runtimeHealthy ? 'success' : 'neutral'}`],
    ['Invocations', Number(metrics.invocations || 0).toLocaleString(), '', ''],
    ['Gross revenue', `${atomicToUSDCInput(metrics.grossRevenueAtomic || 0)} USDC`, '', ''],
    ['Refunded', `${atomicToUSDCInput(metrics.refundedAtomic || 0)} USDC`, '', ''],
    ['Fault rate', `${providerFaultRate.toFixed(2)}%`, '', ''],
    ['Timeout', `${Math.max(1, Number(limits.timeoutSeconds || 1))}s`, '', ''],
    ['Max request', formatByteSize(limits.maximumRequestBytes), '', ''],
    ['Max response', formatByteSize(limits.maximumResponseBytes), '', ''],
  ].map(([label, value, detail, tone]) => `<article class="v4-operation-summary-metric ${escapeAttr(tone)}"><small>${escapeHTML(label)}</small><strong>${tone ? '<i></i>' : ''}${escapeHTML(value)}</strong>${detail ? `<p>${escapeHTML(detail)}</p>` : ''}</article>`).join('')
  let actions = `<button type="button" class="v4-console-primary-action" data-api-publish="${escapeAttr(key)}">Publish Operation</button>`
  let actionDetail = 'Offline. Publish to accept invocations.'
  if (stateLabel === 'live') {
    actionDetail = 'Taking offline drains active requests. Force stop cancels unfinished work.'
    actions = `<button type="button" class="ghost" data-api-lifecycle="${escapeAttr(key)}" data-lifecycle-action="take_offline">Take offline</button><button type="button" class="danger ghost" data-api-lifecycle="${escapeAttr(key)}" data-lifecycle-action="force_stop">Force stop</button>`
  } else if (stateLabel === 'draining') {
    actionDetail = review.operationalStatusReason || 'New calls are blocked while in-flight fulfillment completes.'
    actions = `<button type="button" class="ghost" data-api-lifecycle="${escapeAttr(key)}" data-lifecycle-action="complete_draining" ${inFlight > 0 ? 'disabled' : ''}>Complete offline</button><button type="button" class="danger ghost" data-api-lifecycle="${escapeAttr(key)}" data-lifecycle-action="force_stop">Force stop</button>`
  }
  const protectionNotice = protectionTriggered ? `<aside class="v4-console-protection-alert">${icon(AlertTriangle)}<div><strong>Protection is active</strong><small>${escapeHTML(review.operationalStatusReason || 'Health, fault-rate or metering protection is blocking new calls.')}</small></div></aside>` : ''
  return `<div class="v4-operation-panel v4-operation-console-layout" role="tabpanel" data-api-operation-panel="operations" ${active ? '' : 'hidden'}><section class="v4-operation-category v4-operation-summary"><header class="v4-console-section-title"><strong>Overview</strong></header><div class="v4-operation-summary-grid">${summaryMetrics}</div>${protectionNotice}</section><section class="v4-operation-console v4-operation-control-bar"><header class="v4-console-command"><div><strong>Controls</strong><small>${escapeHTML(actionDetail)}</small></div><div class="v4-console-command-actions">${concurrencySetting}${actions}</div></header></section></div>`
}

function renderProviderAPIOperationRow(api: ProviderIntegration, operation: Record<string, any>) {
  const operationId = String(operation.operationId || '')
  const review = api.operationReviews?.[operationId]
  const rowId = providerOperationKey(api.apiId, operationId)
  const expanded = state.v3ExpandedListingId === rowId
  const integrationComplete = review?.integrationStatus === 'locked'
  const pricingComplete = review?.pricingStatus === 'locked'
  const consoleComplete = review?.operationalState === 'live' || review?.operationalState === 'draining'
  const rowState = providerRowState(api, review)
  const interaction = String(operation.interaction?.mode || 'request_response').replaceAll('_', ' ')
  const requestedView = providerOperationViews[rowId]
  const defaultView: ProviderOperationView = pricingComplete ? 'operations' : 'contract'
  const requestedViewAvailable = requestedView === 'contract' || (requestedView === 'operations' && pricingComplete)
  const activeView: ProviderOperationView = requestedView && requestedViewAvailable ? requestedView : defaultView
  return `<article class="v3-listing-application ${expanded ? 'expanded' : ''}" data-api-operation-row="${escapeAttr(rowId)}" data-listing-search="${escapeAttr(`${api.title} ${operation.title || ''} ${operation.description || ''}`.toLowerCase())}">
    <button type="button" class="v3-listing-summary" data-v3-listing-expand="${escapeAttr(rowId)}" aria-expanded="${String(expanded)}">
      ${renderV3ListingSourceIcon(providerIconOption(api).node)}
      <span class="v3-listing-primary"><strong>${escapeHTML(String(operation.title || operationId))}</strong><small><em class="v3-source-badge source-api">Operation</em><span>${escapeHTML(providerDisplayName(api))}</span><span>${escapeHTML(interaction)}</span></small></span>
      ${renderProviderRowSummary(rowState)}
      <span class="v3-listing-state-pill tone-${rowState.statusTone}"><i></i>${escapeHTML(rowState.statusLabel)}</span><span class="v3-listing-chevron">${toolbarIcons.disclosure}</span>
    </button>
    ${expanded ? `<div class="v3-listing-application-body v4-operation-workflow">${renderProviderOperationProgress(rowId, activeView, integrationComplete, pricingComplete, consoleComplete)}${renderProviderContractPanel(api, operation, review, activeView === 'contract')}${renderProviderConsolePanel(api, operation, review, activeView === 'operations')}</div>` : ''}
  </article>`
}

function syncProviderPricingDraft(form: HTMLFormElement) {
  const apiId = String(form.dataset.apiId || '')
  const operationId = String(form.dataset.operationId || '')
  const key = providerOperationKey(apiId, operationId)
  const draft = providerPricingDrafts[key]
  if (!draft) throw new Error('Pricing draft is unavailable.')
  form.querySelectorAll<HTMLInputElement>('[data-price-sample]').forEach((field) => { draft.sampleUsage[String(field.dataset.priceSample || '')] = Math.max(0, Number.parseInt(field.value || '0', 10) || 0) })
  draft.maximumCharge = String(form.querySelector<HTMLInputElement>('[data-api-price-maximum]')?.value || '')
  draft.expression = String(form.querySelector<HTMLTextAreaElement>('[data-api-price-formula]')?.value || '')
  localStorage.setItem(providerAccountStorageKey(providerPricingDraftStoragePrefix, key), JSON.stringify(draft))
  return draft
}

function canonicalProviderPricing(api: ProviderIntegration, operationId: string, review: APIOperationReview, draft: ProviderPricingDraft) {
  if (review.integrationStatus !== 'locked') throw new Error('Integration validation must be locked before pricing can begin.')
  if (draft.operationSha256 !== review.operationSha256) throw new Error('The Operation changed. Reopen pricing for the current tested version.')
  const operation = (Array.isArray(api.capability?.operations) ? api.capability.operations : []).find((candidate: Record<string, any>) => String(candidate.operationId || '') === operationId) || {}
  const allowedDimensions = [...providerVerifiedMeteringDimensions(operation, review), 'delivered']
  const maximumChargePerInvocationAtomic = usdcInputToAtomic(draft.maximumCharge)
  if (maximumChargePerInvocationAtomic === undefined || maximumChargePerInvocationAtomic < 1) throw new Error('Maximum charge must be a positive USDC value with at most six decimal places.')
  const compiled = compilePriceFormula(draft.expression, allowedDimensions)
  const meteredVariables = compiled.variables.filter((variable) => variable !== 'delivered')
  for (const scenario of pricingSimulationCases(draft.expression, meteredVariables, draft.sampleUsage)) {
    for (const delivered of [0, 1]) {
      try { compiled.evaluate({ ...scenario.usage, delivered }, maximumChargePerInvocationAtomic) }
      catch (error) { throw new Error(`${scenario.label} (delivered=${delivered}): ${humanizeError(error)}`) }
    }
  }
  return {
    schemaVersion: 'exora.operation-pricing.v4',
    apiId: api.apiId,
    operationId,
    operationSha256: review.operationSha256,
    currency: 'USDC',
    chargeFormula: { language: 'exora.price-formula.v4', expression: draft.expression },
    maximumChargePerInvocationAtomic,
    settlementPolicy: 'exora.operation-settlement.v4',
    reviewStatus: 'edited',
  }
}

function renderProviderAPIPreparationRow(api: ProviderIntegration) {
  const rowId = providerPreparationKey(api.apiId)
  const expanded = state.v3ExpandedListingId === rowId
  const rowState = providerRowState(api)
  return `<article class="v3-listing-application v4-provider-api-row ${expanded ? 'expanded' : ''}" data-provider-api-row="${escapeAttr(api.apiId)}" data-listing-search="${escapeAttr(`${providerDisplayName(api)} ${api.apiId}`.toLowerCase())}">
    <button type="button" class="v3-listing-summary" data-v3-listing-expand="${escapeAttr(rowId)}" aria-expanded="${String(expanded)}">
      ${renderV3ListingSourceIcon(providerIconOption(api).node, `data-open-api-identity="${escapeAttr(api.apiId)}" title="Edit API name and icon"`)}
      <span class="v3-listing-primary"><strong data-open-api-identity="${escapeAttr(api.apiId)}" title="Edit API name and icon">${escapeHTML(providerDisplayName(api))}</strong><small><em class="v3-source-badge source-api">API Draft</em><span>${escapeHTML(api.deliveryMode === 'local_dock' ? 'Local API' : 'Cloud API')}</span></small></span>
      ${renderProviderRowSummary(rowState)}
      <span class="v3-listing-state-pill tone-${rowState.statusTone}"><i></i>${escapeHTML(rowState.statusLabel)}</span><span class="v3-listing-chevron">${toolbarIcons.disclosure}</span>
    </button>
    ${expanded ? `<div class="v3-listing-application-body v4-api-editor-body">${renderProviderOperationProgress(rowId, 'contract', false, false, false, false)}${renderProviderContractPanel(api)}</div>` : ''}
  </article>`
}

function renderProviderAPIPage(mode: 'local_dock' | 'cloud_direct') {
  const apis = providerIntegrations.filter((item) => item.deliveryMode === mode)
  const rows = apis.flatMap((api) => {
    const operations = Array.isArray(api.capability?.operations) ? api.capability.operations : []
    return operations.length ? operations.map((operation: Record<string, any>) => renderProviderAPIOperationRow(api, operation)) : [renderProviderAPIPreparationRow(api)]
  }).join('')
  const providerContext = mode === 'local_dock'
    ? { label: 'Local API', purpose: 'Prepare and review APIs adapted from code, functions, CLIs, or local HTTP services.', contextIcon: Code2 }
    : { label: 'Cloud API', purpose: 'Prepare and review authorized public HTTPS APIs from OpenAPI 3.1.', contextIcon: Cloud }
  return `<section class="v3-listings-page v4-integration-page">
    <header class="v3-listing-fixed-header v4-api-fixed-header">
      <section class="v3-listing-search-switch v4-api-add-row"><button type="button" class="v4-api-add-trigger" data-api-add-toggle aria-expanded="false" aria-label="Add ${escapeAttr(providerContext.label)}" title="Add ${escapeAttr(providerContext.label)}"><span class="v4-api-add-context">${icon(providerContext.contextIcon)}<strong>${escapeHTML(providerContext.label)}</strong><i aria-hidden="true"></i><small>${escapeHTML(providerContext.purpose)}</small></span><span class="v4-api-add-plus">${icon(Plus)}</span></button><button type="button" class="v4-api-refresh" data-provider-integrations-refresh aria-label="Refresh API Drafts" title="Refresh API Drafts">${icon(RefreshCw)}</button></section>
      <div class="v3-listing-agent-hint">${icon(MessagesSquare)}<span>Ask your Seller Agent to use Exora MCP to prepare and submit this API for per-Operation review.</span><span class="v3-listing-agent-actions"><button type="button" data-v3-listing-agent-copy aria-label="Copy Agent instructions" title="Copy Agent instructions">${icon(Copy)}</button><button type="button" data-v3-listing-agent-details aria-label="View MCP details" title="View MCP details">${icon(Info)}</button></span></div>
    </header>
    <section class="v3-listing-workspace v4-api-workspace scroll-area">${providerIntegrationsError ? `<div class="v3-market-view-error">${escapeHTML(providerIntegrationsError)}</div>` : ''}${providerIntegrationsLoading && !apis.length ? '<div class="v3-listing-loading"><span><i></i><b></b><em></em></span></div>' : ''}
      <div class="v3-listing-list v4-api-draft-list">${rows || (!providerIntegrationsLoading ? `<div class="v3-marketplace-empty"><span>${icon(Blocks)}</span><strong>No API Drafts yet</strong><small>Press + to add an empty Draft row, or ask your Seller Agent to follow the Exora MCP guide.</small></div>` : '')}</div>
    </section>
  </section>`
}

async function refreshProviderIntegrations() {
  if (providerIntegrationsLoading) return
  const accountRevision = accountContextRevision
  providerIntegrationsLoading = true
  providerIntegrationsError = ''
  const revision = providerIntegrationsRevision
  try {
    const result = await invoke<{ apiDrafts?: ProviderIntegration[] }>('provider_api_drafts')
    if (accountRevision !== accountContextRevision) return
    if (revision === providerIntegrationsRevision) providerIntegrations = (result.apiDrafts || []).map(normalizeProviderIntegration)
    providerIntegrationsLoaded = true
  } catch (error) {
    if (accountRevision !== accountContextRevision) return
    const message = humanizeError(error)
    providerIntegrationsError = message.includes('unknown desktop command: provider_api_drafts') ? 'Restart Exora Dock once to load the updated API workspace.' : message
  } finally {
    if (accountRevision !== accountContextRevision) return
    providerIntegrationsLoading = false
    renderDecisionPanel()
    window.clearTimeout(providerConsolePollTimer)
    const expanded = state.v3ExpandedListingId || ''
    const expandedSeparator = expanded.indexOf(':')
    const expandedAPI = expandedSeparator >= 0 ? providerIntegrations.find((item) => item.apiId === expanded.slice(0, expandedSeparator)) : undefined
    const expandedValidation = expandedAPI?.operationReviews?.[expanded.slice(expandedSeparator + 1)]?.validationRun?.status || ''
    if ((state.v3SellerTab === 'local_api' || state.v3SellerTab === 'cloud_api') && expandedValidation === 'running') {
      providerConsolePollTimer = window.setTimeout(() => { providerIntegrationsLoaded = false; void refreshProviderIntegrations() }, 1_000)
    } else if ((state.v3SellerTab === 'local_api' || state.v3SellerTab === 'cloud_api') && providerOperationViews[expanded] === 'operations') {
      providerConsolePollTimer = window.setTimeout(() => { providerIntegrationsLoaded = false; void refreshProviderIntegrations() }, 15_000)
    }
  }
}

function renderV3SellerSurface() {
  state.v3SellerTab = normalizeV3SellerTab(state.v3SellerTab)
  const buyerTab = state.v3SellerTab === 'buyer'
  const page = state.v3SellerTab === 'local_api' ? renderProviderAPIPage('local_dock') : state.v3SellerTab === 'cloud_api' ? renderProviderAPIPage('cloud_direct') : renderV3UnifiedListingsPageV2()
  return `<section class="v3-market-surface v3-seller-surface">${!buyerTab && state.v3SellerError ? `<div class="v3-error">${escapeHTML(state.v3SellerError)}</div>` : ''}<div class="v3-seller-page">${page}</div></section>`
}

function attachV3SurfaceHandlers() {
  const action = (name: string, handler: () => void) => fields.actionView.querySelector<HTMLButtonElement>(`[data-v3-action="${name}"]`)?.addEventListener('click', handler)
  if ((state.v3SellerTab === 'local_api' || state.v3SellerTab === 'cloud_api') && !providerIntegrationsLoaded && !providerIntegrationsLoading) void refreshProviderIntegrations()
  fields.actionView.querySelector<HTMLButtonElement>('[data-provider-integrations-refresh]')?.addEventListener('click', () => void refreshProviderIntegrations())
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-marketplace-refresh]')?.addEventListener('click', () => {
    state.v3CatalogLoaded = false
    void loadV3Catalog()
  })
  fields.actionView.querySelectorAll<HTMLElement>('[data-open-api-identity]').forEach((trigger) => trigger.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    providerPricingBookOpenKey = ''
    providerContractGuideOpenAPIId = ''
    providerContractEditorOpenKey = ''
    providerIdentityEditorOpenAPIId = String(trigger.dataset.openApiIdentity || '')
    renderDecisionPanel()
    window.setTimeout(() => app.querySelector<HTMLInputElement>('[data-api-identity-modal] input[name="displayName"]')?.focus(), 0)
  }))
  const closeIdentityEditor = () => {
    const apiId = providerIdentityEditorOpenAPIId
    providerIdentityEditorOpenAPIId = ''
    renderDecisionPanel()
    if (apiId) window.setTimeout(() => fields.actionView.querySelector<HTMLElement>(`[data-open-api-identity="${CSS.escape(apiId)}"]`)?.focus(), 0)
  }
  app.querySelectorAll<HTMLButtonElement>('[data-close-api-identity]').forEach((button) => button.addEventListener('click', closeIdentityEditor))
  app.querySelectorAll<HTMLFormElement>('[data-api-identity-form]').forEach((form) => {
    const name = form.querySelector<HTMLInputElement>('input[name="displayName"]')
    const iconField = form.querySelector<HTMLInputElement>('input[name="icon"]')
    const preview = form.querySelector<HTMLElement>('.v4-api-identity-preview')
    const save = form.querySelector<HTMLButtonElement>('.v4-api-identity-save')
    const syncIdentityState = () => {
      const changed = name?.value.trim() !== String(form.dataset.apiCurrentName || '') || iconField?.value !== String(form.dataset.apiCurrentIcon || '')
      if (save) save.disabled = !name?.value.trim() || !changed
    }
    form.querySelectorAll<HTMLButtonElement>('[data-api-icon-option]').forEach((button) => button.addEventListener('click', () => {
      const option = providerIconOptions.find((candidate) => candidate.key === button.dataset.apiIconOption)
      if (!option || !iconField) return
      iconField.value = option.key
      form.querySelectorAll<HTMLButtonElement>('[data-api-icon-option]').forEach((candidate) => {
        const selected = candidate === button
        candidate.classList.toggle('selected', selected)
        candidate.setAttribute('aria-pressed', String(selected))
      })
      if (preview) preview.innerHTML = icon(option.node)
      syncIdentityState()
    }))
    name?.addEventListener('input', syncIdentityState)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const apiId = String(form.dataset.apiId || '')
      const api = providerIntegrations.find((candidate) => candidate.apiId === apiId)
      const displayName = String(name?.value || '').trim()
      const iconName = String(iconField?.value || '')
      if (!api || !displayName || !providerIconOptions.some((option) => option.key === iconName)) return
      void run(async () => {
        const result = await invoke<{ apiDraft?: ProviderIntegration }>('provider_api_update_identity', { input: { apiId, expectedVersion: api.version, displayName, icon: iconName } })
        applyProviderIntegration(result.apiDraft)
        providerIdentityEditorOpenAPIId = ''
        providerIntegrationsLoaded = false
        await refreshProviderIntegrations()
      }, 'API name and icon saved.')
    })
  })
  fields.actionView.querySelector<HTMLButtonElement>('[data-api-add-toggle]')?.addEventListener('click', () => {
    const deliveryMode = state.v3SellerTab === 'local_api' ? 'local_dock' : 'cloud_direct'
    void run(async () => {
      const result = await invoke<{ apiDraft?: ProviderIntegration }>('provider_api_create', { input: { deliveryMode, source: 'manual' } })
      const apiId = String(result.apiDraft?.apiId || '')
      if (!apiId) throw new Error('Dock did not return a stable API UID.')
      state.v3ExpandedListingId = providerPreparationKey(apiId)
      providerIntegrationsLoaded = false
      await refreshProviderIntegrations()
      window.setTimeout(() => fields.actionView.querySelector<HTMLTextAreaElement>(`[data-api-id="${CSS.escape(apiId)}"] textarea[name="title"]`)?.focus(), 0)
    }, 'Persistent API draft created.')
  })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-draft-remove]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    const apiId = String(button.dataset.apiDraftRemove || '')
    const expectedVersion = Number(button.dataset.apiVersion || 0)
    const api = providerIntegrations.find((candidate) => candidate.apiId === apiId)
    if (!apiId || !api) return
    void (async () => {
      const confirmed = await requestAppConfirmation({
        eyebrow: 'Provider API',
        title: 'Remove API draft?',
        detail: api.title || 'Untitled API',
        message: `The synchronized draft ${providerUIDLabel(apiId)} will be removed from this device and Exora Cloud.`,
        impact: 'Test evidence, capability confirmation, and pricing attached to this draft will also be deleted. This action cannot be undone.',
        confirmLabel: 'Remove draft',
      })
      if (!confirmed) return
      await run(async () => {
        await invoke('provider_api_delete', { input: { apiId, expectedVersion } })
        clearCachedProviderPreparationFields(apiId)
        Array.from(providerIntegrationEditKeys).filter((key) => key.startsWith(`${apiId}:`)).forEach((key) => providerIntegrationEditKeys.delete(key))
        if (state.v3ExpandedListingId === providerPreparationKey(apiId)) state.v3ExpandedListingId = undefined
        providerIntegrationsLoaded = false
        await refreshProviderIntegrations()
      }, 'API draft removed.')
    })()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-operation-view]').forEach((button) => button.addEventListener('click', () => {
    const key = String(button.dataset.operationKey || '')
    const requestedView = button.dataset.apiOperationView
    const view: ProviderOperationView = requestedView === 'operations' ? 'operations' : 'contract'
    if (!key || button.disabled) return
    const row = button.closest<HTMLElement>('[data-api-operation-row]')
    const progress = button.closest<HTMLElement>('.v4-operation-progress')
    if (!row || !progress) return
    providerOperationViews[key] = view
    progress.dataset.activeStep = view
    progress.querySelectorAll<HTMLButtonElement>('[data-api-operation-view]').forEach((stepButton) => {
      const active = stepButton.dataset.apiOperationView === view
      stepButton.classList.toggle('active', active)
      stepButton.setAttribute('aria-selected', String(active))
      if (active) stepButton.setAttribute('aria-current', 'step')
      else stepButton.removeAttribute('aria-current')
    })
    row.querySelectorAll<HTMLElement>('[data-api-operation-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.apiOperationPanel !== view
    })
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-contract-browse]').forEach((button) => button.addEventListener('click', () => {
    const key = String(button.dataset.apiContractBrowse || '')
    fields.actionView.querySelector<HTMLInputElement>(`[data-api-contract-file="${CSS.escape(key)}"]`)?.click()
  }))
  fields.actionView.querySelectorAll<HTMLElement>('[data-api-contract-edit]').forEach((dropzone) => {
    const openEditor = () => {
      providerPricingBookOpenKey = ''
      providerContractGuideOpenAPIId = ''
      providerContractEditorOpenKey = String(dropzone.dataset.apiContractEdit || '')
      renderDecisionPanel()
      window.setTimeout(() => app.querySelector<HTMLTextAreaElement>('[data-contract-json-editor]')?.focus(), 0)
    }
    dropzone.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-api-contract-clear]')) return
      openEditor()
    })
    dropzone.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target === dropzone) {
        event.preventDefault()
        openEditor()
      }
    })
  })
  const importProviderContractFile = async (input: HTMLInputElement, file: File) => {
    const apiId = String(input.dataset.apiId || '')
    const api = providerIntegrations.find((candidate) => candidate.apiId === apiId)
    const key = String(input.dataset.apiContractFile || '')
    const dropzone = fields.actionView.querySelector<HTMLElement>(`[data-api-contract-drop="${CSS.escape(key)}"]`)
    if (!api) return
    if (!file.name.toLowerCase().endsWith('.json')) {
      showToast('Choose a JSON contract file.')
      input.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('The API contract JSON must be 5 MiB or smaller.')
      input.value = ''
      return
    }
    dropzone?.classList.add('is-importing')
    dropzone?.setAttribute('aria-busy', 'true')
    try {
      let contract: Record<string, any>
      try {
        const parsed = JSON.parse(await file.text())
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root')
        contract = parsed
      } catch {
        showToast('The selected contract must contain one valid JSON object.')
        return
      }
      const hasExistingContract = Boolean(api.contractPackage && Object.keys(api.contractPackage).length) || Boolean(api.contractPackageSha256)
      const replacingConfirmed = hasExistingContract && Object.values(api.operationReviews || {}).some((review) => review.integrationStatus === 'locked' || review.pricingStatus === 'locked' || review.pricingStatus === 'awaiting_confirmation')
      if (replacingConfirmed) {
        const confirmed = await requestAppConfirmation({
          eyebrow: 'Replace API contract',
          title: 'Invalidate current test evidence?',
          detail: api.title || api.apiId,
          message: 'Changing the source contract requires integration and billing validation again.',
          impact: 'The Operation remains offline until the replacement passes both validations and is confirmed again.',
          confirmLabel: 'Replace contract',
        })
        if (!confirmed) return
      }
      await run(async () => {
        const latest = await fetchLatestProviderIntegration(apiId) || api
        const result = await invoke<{ apiDraft?: ProviderIntegration }>('provider_api_contract_submit', { input: { apiId, expectedVersion: latest.version, contract, replaceLockedContract: replacingConfirmed, source: 'manual', idempotencyKey: `desktop-contract:${apiId}:${crypto.randomUUID()}` } })
        applyProviderIntegration(result.apiDraft)
        const operationId = Object.keys(result.apiDraft?.operationReviews || {})[0] || ''
        state.v3ExpandedListingId = operationId ? providerOperationKey(apiId, operationId) : providerPreparationKey(apiId)
        if (operationId) providerOperationViews[providerOperationKey(apiId, operationId)] = 'contract'
        providerIntegrationsLoaded = false
        await refreshProviderIntegrations()
      }, `${file.name} imported. Run the combined validation when ready.`)
    } finally {
      dropzone?.classList.remove('is-importing', 'is-dragging')
      dropzone?.removeAttribute('aria-busy')
      input.value = ''
    }
  }
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-api-contract-file]').forEach((input) => input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) void importProviderContractFile(input, file)
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-contract-clear]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    const key = String(button.dataset.apiContractClear || '')
    const { apiId, api } = operationContext(key)
    if (!api || button.disabled) return
    const hasEvidence = Object.values(api.operationReviews || {}).some((review) => Boolean(review.validationReceipt) || Boolean(review.pricingBillingReceipt) || review.integrationStatus === 'locked' || review.pricingStatus === 'awaiting_confirmation' || review.pricingStatus === 'locked')
    void (async () => {
      if (hasEvidence) {
        const confirmed = await requestAppConfirmation({
          eyebrow: 'Remove API contract',
          title: 'Clear the uploaded file and test evidence?',
          detail: api.title || api.apiId,
          message: 'Removing the source contract clears every derived Operation, validation receipt and billing projection.',
          impact: 'The stable API UID remains. Upload a contract again to restart validation.',
          confirmLabel: 'Remove contract',
        })
        if (!confirmed) return
      }
      await run(async () => {
        await invoke('provider_api_contract_clear', { input: { apiId, expectedVersion: api.version, invalidateEvidence: hasEvidence } })
        state.v3ExpandedListingId = providerPreparationKey(apiId)
        delete providerOperationViews[key]
        providerIntegrationsLoaded = false
        await refreshProviderIntegrations()
      }, 'Uploaded API contract removed. The stable API UID was preserved.')
    })()
  }))
  const closeContractEditor = () => {
    const key = providerContractEditorOpenKey
    providerContractEditorOpenKey = ''
    renderDecisionPanel()
    if (key) window.setTimeout(() => fields.actionView.querySelector<HTMLElement>(`[data-api-contract-edit="${CSS.escape(key)}"]`)?.focus(), 0)
  }
  app.querySelectorAll<HTMLButtonElement>('[data-close-contract-editor]').forEach((button) => button.addEventListener('click', closeContractEditor))
  const contractEditor = app.querySelector<HTMLTextAreaElement>('[data-contract-json-editor]')
  const contractEditorStatus = app.querySelector<HTMLElement>('[data-contract-editor-status]')
  contractEditor?.addEventListener('input', () => {
    contractEditor.classList.remove('has-error')
    if (contractEditorStatus) {
      contractEditorStatus.className = 'v4-contract-editor-status is-dirty'
      contractEditorStatus.textContent = 'Unsaved changes.'
    }
  })
  app.querySelector<HTMLButtonElement>('[data-format-contract-json]')?.addEventListener('click', () => {
    if (!contractEditor || !contractEditorStatus) return
    try {
      const parsed = JSON.parse(contractEditor.value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The contract root must be one JSON object.')
      contractEditor.value = JSON.stringify(parsed, null, 2)
      contractEditor.classList.remove('has-error')
      contractEditorStatus.className = 'v4-contract-editor-status is-valid'
      contractEditorStatus.textContent = 'JSON syntax is valid and formatting is complete.'
    } catch (error) {
      contractEditor.classList.add('has-error')
      contractEditorStatus.className = 'v4-contract-editor-status has-error'
      contractEditorStatus.textContent = humanizeError(error)
      contractEditor.focus()
    }
  })
  app.querySelector<HTMLButtonElement>('[data-save-contract-json]')?.addEventListener('click', () => {
    if (!contractEditor || !contractEditorStatus) return
    let contract: Record<string, any>
    try {
      const parsed = JSON.parse(contractEditor.value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The contract root must be one JSON object.')
      contract = parsed
    } catch (error) {
      contractEditor.classList.add('has-error')
      contractEditorStatus.className = 'v4-contract-editor-status has-error'
      contractEditorStatus.textContent = humanizeError(error)
      contractEditor.focus()
      return
    }
    const key = providerContractEditorOpenKey
    const { apiId, api } = operationContext(key)
    if (!api) return
    const hasEvidence = Object.values(api.operationReviews || {}).some((review) => Boolean(review.validationReceipt) || Boolean(review.pricingBillingReceipt) || review.integrationStatus === 'locked' || review.pricingStatus === 'awaiting_confirmation' || review.pricingStatus === 'locked')
    void (async () => {
      if (hasEvidence) {
        const confirmed = await requestAppConfirmation({
          eyebrow: 'Replace API contract',
          title: 'Invalidate current test evidence?',
          detail: api.title || api.apiId,
          message: 'Saving JSON changes replaces the source contract and requires validation again.',
          impact: 'The Operation remains offline until the edited contract passes both validations and is confirmed again.',
          confirmLabel: 'Save changes',
        })
        if (!confirmed) return
      }
      await run(async () => {
        let result: { apiDraft?: ProviderIntegration }
        try {
          const latest = await fetchLatestProviderIntegration(apiId) || api
          result = await invoke<{ apiDraft?: ProviderIntegration }>('provider_api_contract_submit', { input: { apiId, expectedVersion: latest.version, contract, replaceLockedContract: hasEvidence, source: 'manual', idempotencyKey: `desktop-contract-edit:${apiId}:${crypto.randomUUID()}` } })
        } catch (error) {
          contractEditor.classList.add('has-error')
          contractEditorStatus.className = 'v4-contract-editor-status has-error'
          contractEditorStatus.textContent = humanizeError(error)
          throw error
        }
        applyProviderIntegration(result.apiDraft)
        providerContractEditorOpenKey = ''
        const operationId = Object.keys(result.apiDraft?.operationReviews || {})[0] || ''
        state.v3ExpandedListingId = operationId ? providerOperationKey(apiId, operationId) : providerPreparationKey(apiId)
        if (operationId) providerOperationViews[providerOperationKey(apiId, operationId)] = 'contract'
        providerIntegrationsLoaded = false
        await refreshProviderIntegrations()
      }, 'API contract JSON saved. Run the contract test when ready.')
    })()
  })
  providerContractDragHandlers?.abort()
  providerContractDragHandlers = undefined
  fields.actionView.classList.remove('is-contract-file-dragging')
  const contractDropzones = Array.from(fields.actionView.querySelectorAll<HTMLElement>('[data-api-contract-drop]'))
  if (contractDropzones.length) {
    const controller = new AbortController()
    providerContractDragHandlers = controller
    let dragDepth = 0
    let activeDropzone: HTMLElement | undefined
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files')
    const visibleDropzone = () => contractDropzones.find((dropzone) => dropzone.getClientRects().length > 0) || contractDropzones[0]
    const setContractDragging = (dragging: boolean) => {
      activeDropzone?.classList.remove('is-dragging')
      activeDropzone = dragging ? visibleDropzone() : undefined
      fields.actionView.classList.toggle('is-contract-file-dragging', dragging)
      activeDropzone?.classList.add('is-dragging')
    }
    const clearContractDragging = () => {
      dragDepth = 0
      setContractDragging(false)
    }
    fields.actionView.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth += 1
      setContractDragging(true)
    }, { signal: controller.signal })
    fields.actionView.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setContractDragging(true)
    }, { signal: controller.signal })
    fields.actionView.addEventListener('dragleave', () => {
      if (!fields.actionView.classList.contains('is-contract-file-dragging')) return
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) clearContractDragging()
    }, { signal: controller.signal })
    fields.actionView.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      const dropzone = activeDropzone || visibleDropzone()
      const key = String(dropzone?.dataset.apiContractDrop || '')
      const input = key ? fields.actionView.querySelector<HTMLInputElement>(`[data-api-contract-file="${CSS.escape(key)}"]`) : null
      const files = Array.from(event.dataTransfer?.files || [])
      clearContractDragging()
      if (!input) return
      if (files.length !== 1) {
        showToast('Drop exactly one API contract JSON file.')
        return
      }
      void importProviderContractFile(input, files[0])
    }, { signal: controller.signal })
    window.addEventListener('dragend', clearContractDragging, { signal: controller.signal })
    window.addEventListener('drop', clearContractDragging, { signal: controller.signal })
  }
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-contract-validate]').forEach((button) => button.addEventListener('click', () => {
    const key = String(button.dataset.apiContractValidate || '')
    const { apiId, operationId, api } = operationContext(key)
    if (!api || !operationId) return
    void run(async () => {
      const idempotencyKey = `desktop-contract-validation:${apiId}:${operationId}:${crypto.randomUUID()}`
      const validate = (draft: ProviderIntegration) => invoke<{ apiDraft?: ProviderIntegration }>('provider_api_contract_validate', { input: { apiId, operationId, expectedVersion: draft.version, idempotencyKey } })
      let latest = await fetchLatestProviderIntegration(apiId) || api
      let result: { apiDraft?: ProviderIntegration }
      try {
        result = await validate(latest)
      } catch (error) {
        if (!isAPIDraftVersionConflict(error)) throw error
        latest = await fetchLatestProviderIntegration(apiId) || latest
        result = await validate(latest)
      }
      applyProviderIntegration(result.apiDraft)
      await refreshProviderWorkflow(key, 'contract')
    }, 'Integration and billing validation passed. Review and confirm the contract.')
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-contract-confirm]').forEach((button) => button.addEventListener('click', () => {
    const key = String(button.dataset.apiContractConfirm || '')
    const { apiId, operationId, api, review } = operationContext(key)
    if (!api || !review) return
    void run(async () => {
      await invoke('provider_api_contract_confirm', { input: { apiId, operationId, expectedVersion: api.version, operationSha256: review.operationSha256 } })
      await refreshProviderWorkflow(key, 'operations')
    }, 'Contract confirmed. Operations are now available.')
  }))
  fields.actionView.querySelectorAll<HTMLFormElement>('[data-api-preparation-form]').forEach((form) => {
    form.querySelector<HTMLTextAreaElement>('.v4-api-title-field')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.preventDefault()
    })
    form.addEventListener('input', () => {
      const apiId = String(form.dataset.apiId || '')
      const operationId = String(form.dataset.operationId || '')
      const api = providerIntegrations.find((item) => item.apiId === apiId)
      if (!api) return
      const fields = providerPreparationFieldsFromForm(form)
      const key = operationId ? providerOperationKey(apiId, operationId) : ''
      if (!key || !providerIntegrationEditKeys.has(key)) cacheProviderPreparationFields(api, fields)
      const test = form.querySelector<HTMLButtonElement>('[data-api-connectivity-test-form]')
      if (test) test.disabled = !providerPreparationFieldsAreTestable(fields, String(form.dataset.deliveryMode || api.deliveryMode))
      const save = form.querySelector<HTMLButtonElement>('[data-api-save-integration-edit]')
      if (!save) return
      try {
        save.disabled = providerCapabilitiesMatch(providerCapabilityFromFields(fields, String(form.dataset.deliveryMode || api.deliveryMode)), api.capability || {})
      } catch {
        save.disabled = true
      }
    })
    form.addEventListener('submit', (event) => event.preventDefault())
  })
  const refreshProviderWorkflow = async (key: string, view: ProviderOperationView) => {
    providerOperationViews[key] = view
    providerIntegrationsLoaded = false
    await refreshProviderIntegrations()
  }
  fields.actionView.querySelectorAll<HTMLFormElement>('[data-api-pricing-form]').forEach((form) => {
    const apiId = String(form.dataset.apiId || '')
    const operationId = String(form.dataset.operationId || '')
    const key = providerOperationKey(apiId, operationId)
    const api = providerIntegrations.find((item) => item.apiId === apiId)
    const review = api?.operationReviews?.[operationId]
    const operation = (Array.isArray(api?.capability?.operations) ? api?.capability.operations : []).find((candidate: Record<string, any>) => String(candidate.operationId || '') === operationId) || {}
    const dimensions = [...providerVerifiedMeteringDimensions(operation, review), 'delivered']
    let pricingRenderTimer = 0
    const schedulePricingRender = (selector: string) => {
      window.clearTimeout(pricingRenderTimer)
      window.clearTimeout(providerConsolePollTimer)
      pricingRenderTimer = window.setTimeout(() => {
        renderDecisionPanel()
        const field = fields.actionView.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
        field?.focus()
        field?.setSelectionRange(field.value.length, field.value.length)
      }, 140)
    }
    form.querySelectorAll<HTMLInputElement>('[data-api-price-maximum], [data-price-sample]').forEach((field) => field.addEventListener('input', () => {
      syncProviderPricingDraft(form)
      const selector = field.dataset.priceSample !== undefined ? `[data-price-sample="${CSS.escape(String(field.dataset.priceSample || ''))}"]` : '[data-api-price-maximum]'
      schedulePricingRender(selector)
    }))
    form.querySelector<HTMLTextAreaElement>('[data-api-price-formula]')?.addEventListener('input', () => { syncProviderPricingDraft(form); schedulePricingRender('[data-api-price-formula]') })
    form.querySelector<HTMLButtonElement>('[data-price-format]')?.addEventListener('click', () => {
      const draft = syncProviderPricingDraft(form)
      try { draft.expression = compilePriceFormula(draft.expression, dimensions).formatted }
      catch (error) { showToast(humanizeError(error)); return }
      renderDecisionPanel()
    })
    form.querySelectorAll<HTMLButtonElement>('[data-price-insert-variable]').forEach((button) => button.addEventListener('click', () => {
      const editor = form.querySelector<HTMLTextAreaElement>('[data-api-price-formula]')
      if (!editor) return
      const variable = String(button.dataset.priceInsertVariable || '')
      editor.setRangeText(variable, editor.selectionStart, editor.selectionEnd, 'end')
      syncProviderPricingDraft(form)
      renderDecisionPanel()
    }))
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      if (!api || !review) return
      let pricing: Record<string, unknown>
      try { pricing = canonicalProviderPricing(api, operationId, review, syncProviderPricingDraft(form)) }
      catch (error) { showToast(humanizeError(error)); return }
      void run(async () => {
        await invoke('provider_api_billing_test', { input: { apiId, operationId, expectedVersion: api.version, operationSha256: review.operationSha256, pricing, idempotencyKey: `desktop-billing:${apiId}:${operationId}:${crypto.randomUUID()}` } })
        providerPricingEditKeys.delete(key)
        delete providerPricingDrafts[key]
        clearCachedProviderPricingDraft(key)
        await refreshProviderWorkflow(key, 'billing')
      }, 'Sandbox billing test passed. Review the receipt before confirming pricing.')
    })
  })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-open-contract-guide]').forEach((button) => button.addEventListener('click', () => {
    providerPricingBookOpenKey = ''
    providerContractEditorOpenKey = ''
    providerContractGuideOpenAPIId = String(button.dataset.openContractGuide || '')
    renderDecisionPanel()
    window.setTimeout(() => app.querySelector<HTMLButtonElement>('[data-contract-guide-modal] .app-modal-close')?.focus(), 0)
  }))
  app.querySelectorAll<HTMLButtonElement>('[data-close-contract-guide]').forEach((button) => button.addEventListener('click', () => {
    const apiId = providerContractGuideOpenAPIId
    providerContractGuideOpenAPIId = ''
    renderDecisionPanel()
    if (apiId) window.setTimeout(() => fields.actionView.querySelector<HTMLButtonElement>(`[data-open-contract-guide="${CSS.escape(apiId)}"]`)?.focus(), 0)
  }))
  app.querySelectorAll<HTMLButtonElement>('[data-contract-guide-section]').forEach((button) => button.addEventListener('click', () => {
    const sectionId = String(button.dataset.contractGuideSection || '')
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    if (sectionId) app.querySelector<HTMLElement>(`#${CSS.escape(sectionId)}`)?.scrollIntoView({ block: 'start', behavior })
  }))
  app.querySelector<HTMLButtonElement>('[data-copy-contract-guide-template]')?.addEventListener('click', () => {
    const template = app.querySelector<HTMLElement>('[data-contract-guide-template]')?.textContent || ''
    if (template) void writeClipboardText(template).then(() => showToast('API contract template copied.')).catch((error) => showToast(humanizeError(error)))
  })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-open-pricing-book]').forEach((button) => button.addEventListener('click', () => {
    const form = button.closest<HTMLFormElement>('[data-api-pricing-form]')
    if (form) syncProviderPricingDraft(form)
    providerContractGuideOpenAPIId = ''
    providerContractEditorOpenKey = ''
    providerPricingBookOpenKey = String(button.dataset.openPricingBook || '')
    renderDecisionPanel()
  }))
  app.querySelectorAll<HTMLButtonElement>('[data-close-pricing-book]').forEach((button) => button.addEventListener('click', () => {
    const key = providerPricingBookOpenKey
    providerPricingBookOpenKey = ''
    if (key) providerOperationViews[key] = 'billing'
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-connectivity-test-form]').forEach((button) => button.addEventListener('click', () => {
    const form = button.closest<HTMLFormElement>('[data-api-preparation-form]')
    const apiId = String(form?.dataset.apiId || '')
    const api = providerIntegrations.find((item) => item.apiId === apiId)
    if (!form || !api) return
    let capability: Record<string, any>
    try { capability = providerCapabilityFromFields(providerPreparationFieldsFromForm(form), String(form.dataset.deliveryMode || api.deliveryMode)) }
    catch (error) { showToast(humanizeError(error)); return }
    void run(async () => {
      let current = api
      if (!providerCapabilitiesMatch(capability, api.capability || {})) {
        const result = await invoke<{ apiDraft?: ProviderIntegration }>('provider_api_update', { input: { apiId, expectedVersion: api.version, capability } })
        if (!result.apiDraft) throw new Error('The integration draft was saved but no current API snapshot was returned.')
        current = result.apiDraft
      }
      const operationId = String(form.dataset.operationId || (Array.isArray(capability.operations) ? capability.operations : []).map((candidate: Record<string, any>) => String(candidate?.operationId || '')).find(Boolean) || '')
      const review = current.operationReviews?.[operationId]
      if (!operationId || !review) throw new Error('Add at least one valid Operation before running connectivity validation.')
      clearCachedProviderPreparationFields(apiId)
      await invoke('provider_api_connectivity_test', { input: { apiId, operationId, expectedVersion: current.version, operationSha256: review.operationSha256, idempotencyKey: `desktop-validation:${apiId}:${operationId}:${crypto.randomUUID()}` } })
      delete providerPricingDrafts[providerOperationKey(apiId, operationId)]
      clearCachedProviderPricingDraft(providerOperationKey(apiId, operationId))
      await refreshProviderWorkflow(providerOperationKey(apiId, operationId), 'integration')
    }, 'Connectivity validation started for the saved integration snapshot.')
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-begin-integration-edit]').forEach((button) => button.addEventListener('click', () => {
    const key = String(button.dataset.apiBeginIntegrationEdit || '')
    const { api, review } = operationContext(key)
    if (!api || !review) return
    void (async () => {
      if (review.operationalState === 'live' || api.status === 'live') {
        await requestAppConfirmation({
          eyebrow: 'Integration change blocked',
          title: 'Take this Operation offline first',
          detail: String(review.operationId || api.title || 'Operation'),
          message: 'A live Operation cannot be changed. Stop accepting new calls from the Operations console first.',
          impact: 'Changes remain blocked until every existing order finishes and the Operation reaches Offline.',
          confirmLabel: 'Understood',
        })
        return
      }
      if (review.operationalState === 'draining' || api.status === 'draining') {
        await requestAppConfirmation({
          eyebrow: 'Integration change blocked',
          title: 'Existing orders are still finishing',
          detail: String(review.operationId || api.title || 'Operation'),
          message: 'This Operation is draining and no longer accepts new calls.',
          impact: 'Changes become available automatically after every existing order finishes and the Operation reaches Offline.',
          confirmLabel: 'Understood',
        })
        return
      }
      const hasDownstreamState = Object.values(api.operationReviews || {}).some((candidate) => candidate.pricingStatus !== 'blocked' || Boolean(candidate.pricingDraft) || Boolean(candidate.pricing) || Boolean(candidate.pricingBillingReceipt))
      const confirmed = await requestAppConfirmation({
        eyebrow: 'Change submitted integration',
        title: 'Create an editable working copy?',
        detail: String(review.operationId || api.title || 'Operation'),
        message: hasDownstreamState ? 'Changing integration content requires connectivity and billing validation again.' : 'Changing integration content requires connectivity validation again.',
        impact: hasDownstreamState ? 'The Operation remains offline until both validations pass again. Existing pricing is cleared only after valid changes are saved.' : 'The submitted version remains unchanged until valid changes are saved.',
        confirmLabel: 'Change integration',
      })
      if (!confirmed) return
      providerIntegrationEditKeys.add(key)
      renderDecisionPanel()
    })()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-cancel-integration-edit]').forEach((button) => button.addEventListener('click', () => {
    providerIntegrationEditKeys.delete(String(button.dataset.apiCancelIntegrationEdit || ''))
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-save-integration-edit]').forEach((button) => button.addEventListener('click', () => {
    const key = String(button.dataset.apiSaveIntegrationEdit || '')
    const { apiId, api } = operationContext(key)
    const form = button.closest<HTMLFormElement>('[data-api-preparation-form]')
    if (!api || !form) return
    let capability: Record<string, any>
    try { capability = providerCapabilityFromFields(providerPreparationFieldsFromForm(form), String(form.dataset.deliveryMode || api.deliveryMode)) }
    catch (error) { showToast(humanizeError(error)); return }
    if (providerCapabilitiesMatch(capability, api.capability || {})) return
    void run(async () => {
      await invoke('provider_api_update', { input: { apiId, expectedVersion: api.version, capability, replaceLockedIntegration: true } })
      providerIntegrationEditKeys.delete(key)
      clearCachedProviderPreparationFields(apiId)
      Object.keys(providerPricingDrafts).filter((draftKey) => draftKey.startsWith(`${apiId}:`)).forEach((draftKey) => { providerPricingEditKeys.delete(draftKey); delete providerPricingDrafts[draftKey]; clearCachedProviderPricingDraft(draftKey) })
      await refreshProviderWorkflow(key, 'integration')
    }, 'Integration changes saved. Connectivity and billing validation must run again.')
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-lock-integration]').forEach((button) => button.addEventListener('click', () => {
    const key = String(button.dataset.apiLockIntegration || '')
    const { apiId, operationId, api, review } = operationContext(key)
    if (!api || !review) return
    void run(async () => {
      await invoke('provider_api_lock_integration', { input: { apiId, operationId, expectedVersion: api.version, operationSha256: review.operationSha256 } })
      providerPricingEditKeys.delete(key)
      delete providerPricingDrafts[key]
      clearCachedProviderPricingDraft(key)
      await refreshProviderWorkflow(key, 'billing')
    }, 'Integration submitted and locked.')
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-begin-pricing-edit]').forEach((button) => button.addEventListener('click', () => {
    const key = String(button.dataset.apiBeginPricingEdit || '')
    const { api, review } = operationContext(key)
    if (!api || !review) return
    void (async () => {
      if (review.operationalState === 'live' || api.status === 'live') {
        await requestAppConfirmation({
          eyebrow: 'Pricing change blocked',
          title: 'Take this Operation offline first',
          detail: String(review.operationId || api.title || 'Operation'),
          message: 'A live Operation cannot change its confirmed pricing rule.',
          impact: 'Stop accepting new calls and wait for existing orders to finish before changing pricing.',
          confirmLabel: 'Understood',
        })
        return
      }
      if (review.operationalState === 'draining' || api.status === 'draining') {
        await requestAppConfirmation({
          eyebrow: 'Pricing change blocked',
          title: 'Existing orders are still finishing',
          detail: String(review.operationId || api.title || 'Operation'),
          message: 'This Operation is draining and its confirmed price remains in force for in-flight work.',
          impact: 'Pricing changes become available after the Operation reaches Offline.',
          confirmLabel: 'Understood',
        })
        return
      }
      providerPricingEditKeys.add(key)
      renderDecisionPanel()
    })()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-cancel-pricing-edit]').forEach((button) => button.addEventListener('click', () => {
    const key = String(button.dataset.apiCancelPricingEdit || '')
    providerPricingEditKeys.delete(key)
    delete providerPricingDrafts[key]
    clearCachedProviderPricingDraft(key)
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-lock-pricing]').forEach((button) => button.addEventListener('click', () => {
    const key = String(button.dataset.apiLockPricing || '')
    const { apiId, operationId, api, review } = operationContext(key)
    if (!api || !review) return
    const input: Record<string, unknown> = { apiId, operationId, expectedVersion: api.version, operationSha256: review.operationSha256 }
    void run(async () => {
      await invoke('provider_api_lock_pricing', { input })
      providerPricingEditKeys.delete(key)
      delete providerPricingDrafts[key]
      clearCachedProviderPricingDraft(key)
      await refreshProviderWorkflow(key, 'console')
    }, 'Pricing confirmed and locked.')
  }))
  fields.actionView.querySelectorAll<HTMLFormElement>('[data-api-concurrency-form]').forEach((form) => {
    const key = String(form.dataset.apiConcurrencyForm || '')
    const input = form.querySelector<HTMLInputElement>('input[name="concurrencyLimit"]')
    const apply = form.querySelector<HTMLButtonElement>('.v4-console-concurrency-apply')
    if (!input || !apply) return
    const original = Number(input.value)
    const sync = () => {
      const value = Number(input.value)
      const minimum = Number(input.min || 1)
      const maximum = Number(input.max || minimum)
      apply.disabled = !Number.isInteger(value) || value < minimum || value > maximum || value === original
      input.setAttribute('aria-invalid', String(!Number.isInteger(value) || value < minimum || value > maximum))
    }
    input.addEventListener('input', sync)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      sync()
      if (apply.disabled) return
      const { apiId, operationId, api, review } = operationContext(key)
      if (!api || !review) return
      const concurrencyLimit = Number(input.value)
      void run(async () => {
        await invoke('provider_api_operational_settings', { input: { apiId, operationId, expectedVersion: api.version, operationSha256: review.operationSha256, concurrencyLimit } })
        await refreshProviderWorkflow(key, 'operations')
      }, `Open concurrency updated to ${concurrencyLimit}.`)
    })
  })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-publish]').forEach((button) => button.addEventListener('click', () => {
    const key = String(button.dataset.apiPublish || '')
    const { apiId, api } = operationContext(key)
    if (!api) return
    void (async () => {
      if (!await requestSimpleAppConfirmation('The Operation will become available to buyers and begin accepting new invocations.', { eyebrow: 'Publish Operation', title: 'Begin accepting invocations?', detail: api.title || apiId, impact: 'Operational billing and fulfillment start immediately after publication.', confirmLabel: 'Publish', tone: 'primary' })) return
      await run(async () => {
        await invoke('provider_api_publish', { input: { apiId, expectedVersion: api.version } })
        await refreshProviderWorkflow(key, 'console')
      }, 'Operation is live.')
    })()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-api-lifecycle]').forEach((button) => button.addEventListener('click', () => {
    const key = String(button.dataset.apiLifecycle || '')
    const action = String(button.dataset.lifecycleAction || '')
    const { apiId, operationId, api, review } = operationContext(key)
    if (!api || !review) return
    const forceStop = action === 'force_stop'
    const message = forceStop ? 'Unfinished fulfillment will be cancelled and fully refunded.' : action === 'take_offline' ? 'New calls will stop while in-flight fulfillment drains normally.' : 'The drained Operation will be marked offline.'
    void (async () => {
      if (!await requestSimpleAppConfirmation(message, { eyebrow: 'Operation lifecycle', title: forceStop ? 'Force stop this Operation?' : action === 'take_offline' ? 'Take this Operation offline?' : 'Complete offline transition?', detail: operationId, impact: forceStop ? 'Seller responsibility is recorded for cancelled work.' : 'Existing work is preserved.', confirmLabel: forceStop ? 'Force stop' : 'Continue', tone: forceStop ? 'danger' : 'primary' })) return
      await run(async () => {
        await invoke('provider_api_lifecycle', { input: { apiId, operationId, expectedVersion: api.version, operationSha256: review.operationSha256, action } })
        await refreshProviderWorkflow(key, 'console')
      }, forceStop ? 'Operation force-stopped.' : action === 'take_offline' ? 'Operation is draining.' : 'Operation is offline.')
    })()
  }))
  action('activity-back', closeV3ActivityDetail)
  action('activity-refresh', () => { const sessionId = state.selectedV3ActivitySessionId; if (sessionId) void loadV3ActivityDetail(sessionId) })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-copy-v3-identifier]').forEach((button) => button.addEventListener('click', () => {
    const value = button.dataset.copyV3Identifier || ''
    if (value) void writeClipboardText(value).then(() => showToast(t('toast.identifierCopied'))).catch((error) => showToast(humanizeError(error)))
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-api-order-action]').forEach((button) => button.addEventListener('click', () => void updateAPIOrder(button.dataset.v3ApiOrderAction as 'deactivate' | 'request-reactivation')))
  fields.actionView.querySelectorAll<HTMLFormElement>('[data-v3-approval-form]').forEach((form) => form.addEventListener('submit', (event) => {
    event.preventDefault()
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null
    const decision = submitter?.value === 'reject' ? 'reject' : 'approve'
    const pin = String(new FormData(form).get('pin') || '').trim()
    void decideV3Approval(form.dataset.v3ApprovalForm || '', decision, pin).catch((error) => showToast(humanizeError(error)))
  }))

  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-seller-tab-target]').forEach((button) => button.addEventListener('click', () => {
    providerPricingBookOpenKey = ''
    providerContractGuideOpenAPIId = ''
    providerContractEditorOpenKey = ''
    state.v3SellerTab = button.dataset.v3SellerTabTarget === 'cloud_api' ? 'cloud_api' : 'local_api'
    renderDecisionPanel()
  }))
  const listingSearch = fields.actionView.querySelector<HTMLInputElement>('[data-v3-listing-search]')
  const applyListingFilters = () => {
    const query = listingSearch?.value.trim().toLocaleLowerCase() || ''
    state.v3ListingQuery = listingSearch?.value || ''
    const listings = Array.from(fields.actionView.querySelectorAll<HTMLElement>('.v3-listing-application'))
    let visible = 0
    listings.forEach((listing) => { const matches = !query || (listing.dataset.listingSearch || '').includes(query); listing.classList.toggle('filtered-out', !matches); if (matches) visible += 1 })
    fields.actionView.querySelector<HTMLElement>('.v3-listing-no-results')?.classList.toggle('hidden', listings.length === 0 || visible > 0)
  }
  listingSearch?.addEventListener('input', applyListingFilters)
  applyListingFilters()
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-listing-agent-copy]')?.addEventListener('click', copyMCPAgentInstruction)
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-listing-agent-details]')?.addEventListener('click', openMCPInfoModal)
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-expand]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.v3ListingExpand || ''
    const previous = state.v3ExpandedListingId
    const changed = previous !== id
    if (!changed && collapseV3Listing(button, id)) return
    state.v3ExpandedListingId = changed ? id : undefined
    renderDecisionPanel()
    if (changed) expandV3Listing(id)
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-delete], [data-v3-listing-delete-unavailable]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    void run(() => deleteV3ProviderListing(String(button.dataset.listingId || '')))
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-action]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    const listingId = String(button.dataset.listingId || '')
    const desiredListed = button.getAttribute('aria-checked') !== 'true'
    void runControlAction(button, async () => { await transitionV3ProviderListing(listingId, desiredListed) })
  }))
}

function expandV3Listing(id: string) {
  if (!id || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  const button = fields.actionView.querySelector<HTMLButtonElement>(`[data-v3-listing-expand="${CSS.escape(id)}"]`)
  const article = button?.closest<HTMLElement>('.v3-listing-application')
  const body = article?.querySelector<HTMLElement>('.v3-listing-application-body')
  if (!article || !body) return false

  const bodyStyle = window.getComputedStyle(body)
  const bodyHeight = body.getBoundingClientRect().height
  const paddingTop = bodyStyle.paddingTop
  const paddingBottom = bodyStyle.paddingBottom
  const borderTopWidth = bodyStyle.borderTopWidth
  article.classList.add('is-expanding')
  body.classList.add('is-animating')
  body.style.height = '0px'
  body.style.opacity = '0'
  body.style.paddingTop = '0px'
  body.style.paddingBottom = '0px'
  body.style.borderTopWidth = '0px'
  body.getBoundingClientRect()

  let finished = false
  let fallbackTimer = 0
  const finishExpand = () => {
    if (finished) return
    finished = true
    window.clearTimeout(fallbackTimer)
    body.removeEventListener('transitionend', handleTransitionEnd)
    article.classList.remove('is-expanding')
    body.classList.remove('is-animating')
    body.style.removeProperty('height')
    body.style.removeProperty('opacity')
    body.style.removeProperty('padding-top')
    body.style.removeProperty('padding-bottom')
    body.style.removeProperty('border-top-width')
  }
  const handleTransitionEnd = (event: TransitionEvent) => {
    if (event.target === body && event.propertyName === 'height') finishExpand()
  }
  body.addEventListener('transitionend', handleTransitionEnd)
  window.requestAnimationFrame(() => {
    if (!body.isConnected) { finishExpand(); return }
    body.style.height = `${bodyHeight}px`
    body.style.opacity = '1'
    body.style.paddingTop = paddingTop
    body.style.paddingBottom = paddingBottom
    body.style.borderTopWidth = borderTopWidth
    fallbackTimer = window.setTimeout(finishExpand, 240)
  })
  return true
}

function collapseV3Listing(button: HTMLButtonElement, id: string) {
  const article = button.closest<HTMLElement>('.v3-listing-application')
  const body = article?.querySelector<HTMLElement>('.v3-listing-application-body')
  if (!article || !body || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (article.classList.contains('is-collapsing')) return true

  const bodyStyle = window.getComputedStyle(body)
  const bodyHeight = body.getBoundingClientRect().height
  article.classList.add('is-collapsing')
  article.classList.remove('expanded')
  button.setAttribute('aria-expanded', 'false')
  body.classList.add('is-animating')

  body.style.height = `${bodyHeight}px`
  body.style.opacity = '1'
  body.style.paddingTop = bodyStyle.paddingTop
  body.style.paddingBottom = bodyStyle.paddingBottom
  body.style.borderTopWidth = bodyStyle.borderTopWidth
  body.getBoundingClientRect()

  let finished = false
  let fallbackTimer = 0
  const finishCollapse = () => {
    if (finished) return
    finished = true
    window.clearTimeout(fallbackTimer)
    body.removeEventListener('transitionend', handleTransitionEnd)
    if (state.v3ExpandedListingId !== id) return
    state.v3ExpandedListingId = undefined
    renderDecisionPanel()
  }
  const handleTransitionEnd = (event: TransitionEvent) => {
    if (event.target === body && event.propertyName === 'height') finishCollapse()
  }
  body.addEventListener('transitionend', handleTransitionEnd)
  window.requestAnimationFrame(() => {
    if (!body.isConnected) { finishCollapse(); return }
    body.style.height = '0px'
    body.style.opacity = '0'
    body.style.paddingTop = '0px'
    body.style.paddingBottom = '0px'
    body.style.borderTopWidth = '0px'
    fallbackTimer = window.setTimeout(finishCollapse, 240)
  })
  return true
}

function renderDecisionPanel() {
  app.querySelector<HTMLElement>('[data-pricing-book-modal]')?.remove()
  app.querySelector<HTMLElement>('[data-contract-guide-modal]')?.remove()
  app.querySelector<HTMLElement>('[data-contract-editor-modal]')?.remove()
  app.querySelector<HTMLElement>('[data-api-identity-modal]')?.remove()
  renderViewTabs()
  const showingActivityDetail = Boolean(state.selectedV3ActivitySessionId)
  fields.appShell.classList.add('market-console-mode', 'seller-surface-mode', 'right-workspace-white')
  syncV3SellerTabsVisibility()
  fields.actionView.classList.remove('hidden')
  syncV3SellerTabs()
  localize(fields.sellerSurfaceTabs)
  fields.decisionContent.innerHTML = showingActivityDetail ? renderV3ActivityDetail() : renderV3SellerSurface()
  if (providerPricingBookOpenKey) app.querySelector<HTMLElement>('[data-global-modal-layer]')?.insertAdjacentHTML('beforeend', renderProviderPricingBook())
  if (providerContractGuideOpenAPIId) app.querySelector<HTMLElement>('[data-global-modal-layer]')?.insertAdjacentHTML('beforeend', renderProviderContractGuide())
  if (providerContractEditorOpenKey) app.querySelector<HTMLElement>('[data-global-modal-layer]')?.insertAdjacentHTML('beforeend', renderProviderContractEditor())
  if (providerIdentityEditorOpenAPIId) app.querySelector<HTMLElement>('[data-global-modal-layer]')?.insertAdjacentHTML('beforeend', renderProviderIdentityModal())
  attachV3SurfaceHandlers()
  ensureV3SurfaceData()
  localize(fields.actionView)
  if (state.settingsOpen) renderSettingsSurface()
}

function renderViewTabs() {
  renderChromeControls()
  fields.appShell.classList.toggle('settings-mode', state.settingsOpen)
  fields.appShell.classList.add('right-workspace-white')
  const side = state.workOrderSide
  app.querySelectorAll<HTMLButtonElement>('[data-order-side-tab]').forEach((button) => {
    const tabSide = button.dataset.orderSideTab as OrderSide
    const isActive = tabSide === side
    button.classList.toggle('active', isActive)
    button.setAttribute('aria-pressed', String(isActive))
  })
}



function v3ActivityRetentionHint(record: V3ActivityDisplayRecord) {
  if (record.manuallyArchived) return v3HistoryCopy('Manually archived', '已手动收纳')
  if (record.bucket === 'history') {
    return v3HistoryCopy('24-hour window ended', '24 小时保留期已结束')
  }
  if (v3ActivityIsBusy(record)) {
    if (record.productKind === 'api_operation') return v3HistoryCopy('Call in flight', '有调用进行中')
    return v3HistoryCopy('Runtime active', '运行中')
  }
  const retainUntil = v3ActivityRetainUntil(record)
  const remaining = Math.max(0, sortTime(retainUntil) - Date.now())
  const minutes = Math.max(1, Math.ceil(remaining / 60_000))
  const duration = minutes >= 60 ? `${Math.ceil(minutes / 60)}h` : `${minutes}m`
  return v3HistoryCopy(`Retained ${duration}`, `保留 ${duration}`)
}

function renderOrderActivitySidebar() {
  closeV3OrderContextMenu()
  const side = state.workOrderSide
  const currentRecords = v3ActivityDisplayRecords(side, 'current')
  const historyRecords = v3ActivityDisplayRecords(side, 'history')
  const historyOpen = state.v3ActivityBucket[side] === 'history'
  const activeRecords = currentRecords.filter((record) => record.status !== 'completed')
  const inactiveRecords = [...currentRecords.filter((record) => record.status === 'completed'), ...historyRecords]
    .sort((a, b) => sortTime(b.updatedAt) - sortTime(a.updatedAt))
  const sideLabel = state.workOrderSide === 'buyer' ? t('orderSide.buyer') : t('orderSide.seller')
  setLedgerEmpty(false)
  fields.ledgerList.classList.remove('settings-list')
  const loading = state.v3ActivityLoading[side]
  const error = state.v3ActivityErrors[side]
  const historyToggleLabel = historyOpen
    ? v3HistoryCopy('Collapse order history', '收起历史订单')
    : v3HistoryCopy('Pull up order history', '上拉展开历史订单')
  fields.ledgerList.innerHTML = `
    <section class="v3-history-sidebar ${historyOpen ? 'is-history-open' : ''}" aria-label="${escapeAttr(sideLabel)} order history">
      <div class="v3-history-list-header">
        <span><i aria-hidden="true"></i>${escapeHTML(v3HistoryCopy('Active orders', '活跃订单'))}</span><em>${activeRecords.length}</em>
      </div>
      <div class="v3-history-list v3-history-active-list ${error && !activeRecords.length ? 'is-centered' : ''}" data-v3-active-order-list aria-live="polite">
        ${loading && !activeRecords.length ? '<div class="v3-history-state is-compact is-loading"><span class="v3-history-state-spinner" aria-hidden="true"></span><strong>Loading orders&hellip;</strong></div>' : ''}
        ${error ? `<div class="v3-history-state error" role="status"><span class="v3-history-state-icon" aria-hidden="true">${toolbarIcons.emptyContent}</span><p>Order history is currently unavailable.</p></div>` : ''}
        ${!loading && !error && !activeRecords.length ? `<div class="v3-history-state is-compact is-empty"><span class="v3-history-state-icon" aria-hidden="true">${toolbarIcons.emptyContent}</span><strong>${escapeHTML(v3HistoryCopy('No active orders', '暂无活跃订单'))}</strong><small>${escapeHTML(v3HistoryCopy('New and in-progress orders will appear automatically.', '新的和进行中的订单会自动显示。'))}</small></div>` : ''}
        ${activeRecords.map(renderV3HistoryRow).join('')}
      </div>
      <section class="v3-history-pull-drawer" data-v3-history-drawer>
        <button class="v3-history-drawer-toggle" type="button" data-v3-history-toggle aria-label="${escapeAttr(historyToggleLabel)}" aria-expanded="${historyOpen}" aria-controls="v3-history-drawer-panel">
          <span class="v3-history-drawer-label">
            <i class="v3-history-drawer-chevron" aria-hidden="true"></i>
            <strong>${escapeHTML(v3HistoryCopy('History', '历史记录'))}</strong>
            <em>${inactiveRecords.length}</em>
          </span>
        </button>
        <div class="v3-history-drawer-panel" id="v3-history-drawer-panel" ${historyOpen ? '' : 'inert aria-hidden="true"'}>
          <div class="v3-history-list v3-history-archive-list" data-v3-history-list aria-live="polite">
            ${!loading && !error && !inactiveRecords.length ? `<div class="v3-history-state is-compact is-empty"><span class="v3-history-state-icon" aria-hidden="true">${toolbarIcons.emptyContent}</span><strong>${escapeHTML(v3HistoryCopy('No history yet', '暂无历史记录'))}</strong><small>${escapeHTML(v3HistoryCopy('Completed and past orders will appear here.', '已完成和过往订单会显示在这里。'))}</small></div>` : ''}
            ${inactiveRecords.map(renderV3HistoryRow).join('')}
          </div>
        </div>
      </section>
    </section>
  `
  attachV3HistoryHandlers()
}

function v3ActivityKindLabel(_kind: string) {
  return 'API'
}

function v3ActivityStatusLabel(status: string) {
  if (status === 'active') return v3HistoryCopy('Active', '进行中')
  if (status === 'needs_attention') return v3HistoryCopy('Needs review', '需要检查')
  if (status === 'completed') return v3HistoryCopy('Completed', '已完成')
  if (status === 'pending') return v3HistoryCopy('Pending', '等待中')
  if (status === 'provisioning') return v3HistoryCopy('Provisioning', '正在配置')
  if (status === 'upstream_error') return v3HistoryCopy('Upstream error', '上游错误')
  if (status === 'meter_failed') return v3HistoryCopy('Metering failed', '计量失败')
  if (status === 'settlement_failed') return v3HistoryCopy('Settlement failed', '结算失败')
  if (status === 'failed') return v3HistoryCopy('Failed', '失败')
  if (status === 'degraded') return v3HistoryCopy('Degraded', '服务降级')
  if (status === 'revoked') return v3HistoryCopy('Revoked', '已撤销')
  return status.replaceAll('_', ' ')
}

function v3AtomicMoney(value: number, asset = 'USDC') {
  const amount = Number(value || 0) / 1_000_000
  const digits = amount >= 100 ? 2 : amount >= 1 ? 3 : 4
  return `${amount.toFixed(digits).replace(/\.?0+$/, '') || '0'} ${asset || 'USDC'}`
}

function renderV3HistoryRow(record: V3ActivityDisplayRecord) {
  const active = record.displayId === state.selectedV3ActivitySessionId
  const statusLabel = v3ActivityStatusLabel(record.status)
  const contextLabel = [record.counterpartyLabel, v3ActivityRetentionHint(record)].filter(Boolean).join(' · ')
  return `
    <article class="v3-history-row-shell ${record.orderUid ? 'has-order-uid' : ''} ${active ? 'active' : ''}" data-v3-history-shell="${escapeAttr(record.displayId)}">
      <button class="v3-history-row" type="button" data-v3-history-record="${escapeAttr(record.displayId)}" title="${escapeAttr([record.orderUid, record.productTitle, record.outcome, v3AtomicMoney(record.amountAtomic, record.asset), compactTimestamp(record.updatedAt)].filter(Boolean).join(' / '))}" aria-pressed="${active}">
        <span class="v3-history-kind kind-${escapeAttr(record.productKind)}" aria-hidden="true">${v3ActivityKindLabel(record.productKind)}</span>
        <span class="v3-history-copy">
          <strong>${escapeHTML(record.productTitle || 'API session')}</strong>
          <small>${record.orderUid ? `<code>${escapeHTML(record.orderUid)}</code>` : ''}<span>${escapeHTML(contextLabel)}</span></small>
        </span>
        <span class="v3-history-meta">
          <span class="v3-history-amount">${escapeHTML(v3AtomicMoney(record.amountAtomic, record.asset))}</span>
          <span class="v3-history-status ${escapeAttr(record.status)}"><i aria-hidden="true"></i>${escapeHTML(statusLabel)}</span>
        </span>
      </button>
      ${record.orderUid ? `<button class="v3-history-uid-copy" type="button" data-copy-order-uid="${escapeAttr(record.orderUid)}" aria-label="${escapeAttr(v3HistoryCopy('Copy Order UID', '复制订单 UID'))}" title="${escapeAttr(v3HistoryCopy('Copy Order UID', '复制订单 UID'))}">${toolbarIcons.copy}</button>` : ''}
    </article>
  `
}

let v3OrderContextMenu: HTMLElement | undefined

function closeV3OrderContextMenu() {
  v3OrderContextMenu?.remove()
  v3OrderContextMenu = undefined
}

function openV3OrderContextMenu(record: V3ActivityDisplayRecord, clientX: number, clientY: number) {
  closeV3OrderContextMenu()
  if (record.role !== 'buyer') return
  const menu = document.createElement('div')
  menu.className = 'v3-order-context-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', v3HistoryCopy('Buyer order actions', 'Buyer 订单操作'))
  const archiveDisabled = record.bucket !== 'current' || !record.canArchive
  menu.innerHTML = `
    <div class="v3-order-context-heading"><strong>${escapeHTML(record.productTitle || v3HistoryCopy('Buyer order', 'Buyer 订单'))}</strong><small>${escapeHTML(record.orderUid || '')}</small></div>
    <button type="button" role="menuitem" data-v3-order-context-action="archive" ${archiveDisabled ? 'disabled' : ''}>
      <span aria-hidden="true">${icon(Archive)}</span><span><strong>${escapeHTML(v3HistoryCopy('Move to History', '转为历史'))}</strong><small>${escapeHTML(record.bucket === 'history' ? v3HistoryCopy('Already in History', '已在历史中') : record.canArchive ? v3HistoryCopy('Keep the order record for later', '保留订单记录供以后查看') : v3HistoryCopy('An API call is still in progress', '仍有 API 调用正在进行'))}</small></span>
    </button>
    <button class="danger" type="button" role="menuitem" data-v3-order-context-action="delete">
      <span aria-hidden="true">${icon(Trash2)}</span><span><strong>${escapeHTML(v3HistoryCopy('Delete order', '删除订单'))}</strong><small>${escapeHTML(record.status === 'active' ? v3HistoryCopy('Deactivate and remove from this list', '停用并从此列表移除') : v3HistoryCopy('Remove from this list', '从此列表移除'))}</small></span>
    </button>
  `
  document.body.append(menu)
  v3OrderContextMenu = menu
  const margin = 8
  const bounds = menu.getBoundingClientRect()
  menu.style.left = `${Math.max(margin, Math.min(clientX, window.innerWidth - bounds.width - margin))}px`
  menu.style.top = `${Math.max(margin, Math.min(clientY, window.innerHeight - bounds.height - margin))}px`
  menu.addEventListener('click', (event) => {
    const action = (event.target as Element).closest<HTMLButtonElement>('[data-v3-order-context-action]')
    if (!action || action.disabled) return
    event.preventDefault()
    event.stopPropagation()
    closeV3OrderContextMenu()
    if (action.dataset.v3OrderContextAction === 'archive') archiveV3BuyerActivity(record.displayId)
    if (action.dataset.v3OrderContextAction === 'delete') void deleteV3BuyerActivity(record.displayId)
  })
  window.setTimeout(() => menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(), 0)
}

function attachV3HistoryHandlers() {
  const sidebar = fields.ledgerList.querySelector<HTMLElement>('.v3-history-sidebar')
  const toggle = fields.ledgerList.querySelector<HTMLButtonElement>('[data-v3-history-toggle]')
  const drawerPanel = fields.ledgerList.querySelector<HTMLElement>('#v3-history-drawer-panel')
  toggle?.addEventListener('click', () => {
    const historyOpen = !sidebar?.classList.contains('is-history-open')
    state.v3ActivityBucket[state.workOrderSide] = historyOpen ? 'history' : 'current'
    sidebar?.classList.toggle('is-history-open', historyOpen)
    toggle.setAttribute('aria-expanded', String(historyOpen))
    toggle.setAttribute('aria-label', historyOpen
      ? v3HistoryCopy('Collapse order history', '收起历史订单')
      : v3HistoryCopy('Pull up order history', '上拉展开历史订单'))
    if (drawerPanel) {
      drawerPanel.inert = !historyOpen
      if (historyOpen) drawerPanel.removeAttribute('aria-hidden')
      else drawerPanel.setAttribute('aria-hidden', 'true')
    }
  })
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-v3-history-record]').forEach((button) => {
    button.addEventListener('click', () => selectV3ActivityDisplayRecord(button.dataset.v3HistoryRecord || ''))
    button.addEventListener('contextmenu', (event) => {
      if (state.workOrderSide !== 'buyer') return
      const record = findV3ActivityDisplayRecord(button.dataset.v3HistoryRecord || '', 'buyer')
      if (!record) return
      event.preventDefault()
      openV3OrderContextMenu(record, event.clientX, event.clientY)
    })
    button.addEventListener('keydown', (event) => {
      if (state.workOrderSide !== 'buyer' || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))) return
      const record = findV3ActivityDisplayRecord(button.dataset.v3HistoryRecord || '', 'buyer')
      if (!record) return
      event.preventDefault()
      const bounds = button.getBoundingClientRect()
      openV3OrderContextMenu(record, bounds.left + Math.min(36, bounds.width / 2), bounds.top + Math.min(36, bounds.height / 2))
    })
  })
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-copy-order-uid]').forEach((button) => {
    button.addEventListener('click', () => {
      const uid = button.dataset.copyOrderUid || ''
      if (uid) void writeClipboardText(uid).then(() => showToast(t('toast.identifierCopied'))).catch((error) => showToast(humanizeError(error)))
    })
  })
}

function sortTime(value?: string) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : Number(value || 0)
}

function compactTimestamp(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function escapeAttr(value: unknown) {
  return escapeHTML(String(value ?? '')).replaceAll('`', '&#96;')
}

function renderAll() {
  applyUserPreferences()
  renderProfileSummary()
  renderWalletModal()
  renderLedger()
  renderDecisionPanel()
  renderSettingsSurface()
  renderPINSettingsModal()
  renderMCPInfoModal()
  renderAgentMcpOnboarding()
  localize()
}

const actionBusyControls = new WeakSet<HTMLButtonElement>()

function activeActionControl() {
  const active = document.activeElement
  if (active instanceof HTMLButtonElement) return active
  if (active instanceof HTMLElement) return active.closest('form')?.querySelector<HTMLButtonElement>('button[type="submit"]') || undefined
  return undefined
}

async function runControlAction(control: HTMLButtonElement, action: () => Promise<unknown>, success?: string) {
  if (actionBusyControls.has(control)) return
  const wasDisabled = control.disabled
  actionBusyControls.add(control)
  control.disabled = true
  control.classList.add('is-action-busy')
  control.setAttribute('aria-busy', 'true')
  try {
    await action()
    if (success) showToast(success)
  } catch (error) {
    showToast(humanizeError(error))
  } finally {
    actionBusyControls.delete(control)
    control.classList.remove('is-action-busy')
    control.removeAttribute('aria-busy')
    if (control.isConnected && !wasDisabled) control.disabled = false
  }
}

async function run(action: () => Promise<unknown>, success?: string) {
  const control = activeActionControl()
  if (control && actionBusyControls.has(control)) return
  const wasDisabled = control?.disabled === true
  if (control) {
    actionBusyControls.add(control)
    control.disabled = true
    control.classList.add('is-action-busy')
    control.setAttribute('aria-busy', 'true')
  }
  setBusy(true)
  try {
    await action()
    if (success) showToast(success)
  } catch (error) {
    showToast(humanizeError(error))
  } finally {
    setBusy(false)
    if (control) {
      actionBusyControls.delete(control)
      control.classList.remove('is-action-busy')
      control.removeAttribute('aria-busy')
      if (control.isConnected && !wasDisabled) control.disabled = false
    }
    void refreshStatus()
  }
}

let busyOperationCount = 0

function setBusy(next: boolean) {
  busyOperationCount = Math.max(0, busyOperationCount + (next ? 1 : -1))
  state.busy = busyOperationCount > 0
  renderChromeControls()
}

function showToast(message: string) {
  const text = translatePhrase(message, state.language).trim()
  if (!text) return
  window.clearTimeout(toastTimer)
  fields.message.textContent = text
  fields.message.classList.add('show')
  toastTimer = window.setTimeout(() => {
    fields.message.classList.remove('show')
    toastTimer = window.setTimeout(() => {
      if (!fields.message.classList.contains('show')) fields.message.textContent = ''
    }, 180)
  }, TOAST_DURATION_MS)
}

function renderSettingsPanel() {
  const meta = settingsPageMeta()[state.activeSettingsView]
  if (fields.mainKicker) fields.mainKicker.textContent = sx('Settings', '设置')
  if (fields.decisionTitle) fields.decisionTitle.textContent = meta.title
  if (fields.decisionStep) fields.decisionStep.textContent = 'settings'
  fields.settingsView.innerHTML = `
    <header class="app-settings-head">
      <div><span>${escapeHTML(meta.kicker)}</span><h1 id="app-settings-title">${escapeHTML(meta.title)}</h1><p>${escapeHTML(meta.description)}</p></div>
      ${state.settingsStatusLoading ? '<span class="app-settings-refreshing" role="status"><i></i></span>' : ''}
    </header>
    ${state.settingsStatusError ? `<div class="app-settings-banner warning"><strong>${escapeHTML(sx('Some system details are unavailable', '部分系统信息暂不可用'))}</strong><span>${escapeHTML(state.settingsStatusError)}</span><button type="button" data-settings-action="refresh-status">${escapeHTML(sx('Retry', '重试'))}</button></div>` : ''}
    <div class="app-settings-content" data-settings-page="${escapeAttr(state.activeSettingsView)}">${renderActiveSettingsPage()}</div>
  `
}

function sx(english: string, chinese: string) {
  return state.language === 'zh' ? chinese : english
}

function settingsPageMeta(): Record<SettingsView, { kicker: string; title: string; description: string }> {
  return {
    general: { kicker: sx('PREFERENCES', '偏好'), title: sx('General', '通用'), description: sx('Choose how Exora Dock looks, starts, and behaves as a desktop application.', '设置 Exora Dock 的语言、外观、启动方式与桌面行为。') },
    'account-security': { kicker: sx('ACCOUNT', '账户'), title: sx('Account & Security', '账户与安全'), description: sx('Review your Cloud identity and protect sensitive account actions.', '查看 Cloud 账户状态并保护涉及资金与身份的敏感操作。') },
    'agent-permissions': { kicker: sx('AGENT ACCESS', 'AGENT 访问'), title: sx('Agent Connections & Permissions', 'Agent 连接与权限'), description: sx('Connect local Agent clients to Dock and keep spending behind explicit boundaries.', '将本地 Agent 客户端连接到 Dock，并为消费与外部副作用保留明确边界。') },
    notifications: { kicker: sx('PREFERENCES', '偏好'), title: sx('Notifications', '通知'), description: sx('Choose which API, billing, and account events deserve your attention.', '选择需要提醒你的 API、资金与账户事件。') },
    'data-storage': { kicker: sx('LOCAL DATA', '本地数据'), title: sx('Data & Storage', '数据与存储'), description: sx('Inspect local usage, choose download locations, and clear only disposable data.', '查看本地占用、设置下载目录，并仅清理可安全移除的数据。') },
    'system-about': { kicker: sx('SYSTEM', '系统'), title: sx('System & About', '系统与关于'), description: sx('Check Cloud connectivity, component versions, and updates.', '检查 Cloud 连接、组件版本与更新。') },
  }
}

function renderActiveSettingsPage() {
  if (state.activeSettingsView === 'general') return renderGeneralSettings()
  if (state.activeSettingsView === 'account-security') return renderAccountSettings()
  if (state.activeSettingsView === 'agent-permissions') return renderAgentSettings()
  if (state.activeSettingsView === 'notifications') return renderNotificationSettings()
  if (state.activeSettingsView === 'data-storage') return renderDataSettings()
  return renderSystemSettings()
}

function settingsSection(kicker: string, title: string, description: string, rows: string) {
  return `<section class="app-settings-section"><div class="app-settings-section-head"><span>${escapeHTML(kicker)}</span><h2>${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p></div><div class="app-setting-list">${rows}</div></section>`
}

function settingRow(iconMarkup: string, title: string, description: string, control: string, className = '') {
  return `<div class="app-setting-row ${className}"><span class="app-setting-icon" aria-hidden="true">${iconMarkup}</span><div class="app-setting-copy"><strong>${escapeHTML(title)}</strong><p>${escapeHTML(description)}</p></div><div class="app-setting-control">${control}</div></div>`
}

function settingSegment(key: string, options: Array<{ value: string; label: string }>, active: string) {
  return `<div class="app-setting-segment" role="group">${options.map((option) => `<button type="button" data-setting-segment="${escapeAttr(key)}" data-setting-value="${escapeAttr(option.value)}" class="${option.value === active ? 'active' : ''}" aria-pressed="${option.value === active}">${escapeHTML(option.label)}</button>`).join('')}</div>`
}

function settingBooleanSegment(key: string, checked: boolean) {
  return settingSegment(key, [{ value: 'off', label: sx('Off', '关闭') }, { value: 'on', label: sx('On', '开启') }], checked ? 'on' : 'off')
}

function settingScopeSegment(scope: string, checked: boolean) {
  return `<div class="agent-session-scope-control"><input type="checkbox" data-agent-session-scope="${escapeAttr(scope)}" ${checked ? 'checked' : ''} hidden>${settingBooleanSegment(`agentSessionScope.${scope}`, checked)}</div>`
}

function settingButton(action: string, label: string, tone: 'primary' | 'soft' | 'outline' | 'danger' = 'outline', extra = '') {
  return `<button class="app-setting-button ${tone}" type="button" data-settings-action="${escapeAttr(action)}" ${extra}>${escapeHTML(label)}</button>`
}

function settingStatus(label: string, tone: 'running' | 'success' | 'warning' | 'danger' | 'neutral' = 'neutral') {
  return `<span class="app-setting-status ${tone}"><i aria-hidden="true"></i>${escapeHTML(label)}</span>`
}

function renderGeneralSettings() {
  const preferenceRows = [
    settingRow(icon(Languages), sx('Language', '语言'), sx('Applies to settings, dialogs, the tray menu, and system notifications.', '应用于设置、对话框、托盘菜单与系统通知。'), settingSegment('language', [{ value: 'en', label: 'English' }, { value: 'zh', label: '中文' }], state.language)),
    settingRow(icon(Moon), sx('Appearance', '外观'), sx('Follow the operating system or keep a fixed light or dark appearance.', '跟随操作系统，或固定使用浅色或深色外观。'), settingSegment('theme', [{ value: 'system', label: sx('System', '系统') }, { value: 'light', label: sx('Light', '浅色') }, { value: 'dark', label: sx('Dark', '深色') }], state.theme)),
  ].join('')
  const startupRows = [
    settingRow(icon(Settings2), sx('Launch at login', '开机启动'), sx('Start Exora Dock after you sign in to this computer.', '登录此电脑后自动启动 Exora Dock。'), settingBooleanSegment('launchAtLogin', state.launchAtLogin)),
    settingRow(icon(Minus), sx('Start minimized', '启动后最小化'), sx('Open quietly in the tray instead of showing the workspace.', '静默进入托盘，不立即显示工作区。'), settingBooleanSegment('startMinimized', state.startMinimized)),
    settingRow(icon(X), sx('When the window closes', '关闭窗口时'), sx('Keep Dock available from the tray or quit the application completely.', '继续在托盘运行 Dock，或完全退出应用。'), settingSegment('closeBehavior', [{ value: 'tray', label: sx('Tray', '托盘') }, { value: 'quit', label: sx('Quit', '退出') }], state.closeBehavior)),
  ].join('')
  return settingsSection(sx('DISPLAY', '显示'), sx('Language & appearance', '语言与外观'), sx('These choices take effect immediately.', '这些设置会立即生效。'), preferenceRows)
    + settingsSection(sx('DESKTOP', '桌面'), sx('Startup & window behavior', '启动与窗口行为'), sx('System-level changes are applied by the Electron main process.', '系统级行为由 Electron 主进程统一执行。'), startupRows)
}

function renderAccountSettings() {
  const email = state.authAccount?.email || sx('Workspace preview', '工作区预览')
  const verified = Boolean(state.authAccount?.emailVerifiedAt)
  const apiKey = state.accountAPIKeyStatus
  const apiKeyStatus = apiKey?.accessKey
    ? apiKey.requiresImport ? settingStatus(sx('Import required', '需要导入'), 'warning') : settingStatus(apiKey.accessKey.maskedKey || sx('Active', '有效'), 'success')
    : settingStatus(sx('Not created', '尚未创建'), 'warning')
  const apiKeyActions = apiKey?.accessKey
    ? `${apiKey.requiresImport ? settingButton('account-key-import', sx('Import', '导入'), 'soft') : ''}${settingButton('account-key-rotate', sx('Regenerate', '重新随机'), 'outline')}${settingButton('account-key-revoke', sx('Revoke', '撤销'), 'danger')}`
    : settingButton('account-key-ensure', sx('Create', '创建'), 'soft')
  const identityRows = [
    settingRow(icon(BadgeCheck), sx('Cloud account', 'Cloud 账户'), email, verified ? settingStatus(sx('Verified', '已验证'), 'success') : settingStatus(sx('Verification unknown', '验证状态未知'), 'warning')),
    settingRow(icon(KeyRound), sx('Login password', '登录密码'), sx('Reset your password through a one-time code sent to the verified email.', '通过发送到已验证邮箱的一次性验证码重置密码。'), settingButton('change-password', sx('Change password', '修改密码'), 'soft')),
    settingRow(icon(ShieldCheck), sx('Payment PIN', '支付 PIN'), state.cloudPaymentPINConfigured === false ? sx('A six-digit PIN is still required before sensitive payments.', '执行敏感支付前仍需设置六位 PIN。') : sx('Used to approve spending, withdrawals, and other sensitive actions.', '用于批准消费、提现与其他敏感操作。'), `<div class="app-setting-actions">${settingStatus(state.cloudPaymentPINConfigured === false ? sx('Not set', '未设置') : sx('Protected', '已保护'), state.cloudPaymentPINConfigured === false ? 'warning' : 'success')}${settingButton('change-pin', sx('Change', '修改'), 'outline')}${settingButton('reset-pin', sx('Reset', '重置'), 'outline')}</div>`),
    settingRow(icon(KeyRound), sx('Account API key', '账户 API 密钥'), sx('One long-lived sk-exora key for SDKs and servers. Cloud stores only its hash; this device stores the secret in the operating system vault.', '用于 SDK 与服务器的一把长期 sk-exora 密钥。Cloud 仅保存哈希，本机原文保存在系统凭据库。'), `<div class="app-setting-actions">${apiKeyStatus}${apiKeyActions}</div>`),
  ].join('')
  const accountRows = [
    settingRow(icon(LogOut), sx('Sign out', '退出登录'), sx('Take every live API offline, then remove the Cloud session and Provider Dock link from this device.', '先下架全部在线 API，再移除此设备上的 Cloud 会话与 Provider Dock 连接。'), settingButton('sign-out', sx('Sign out', '退出登录'), 'outline')),
    settingRow(icon(ShieldAlert), sx('Delete account', '删除账户'), sx('Account deletion requires a Cloud support review and permanently removes account access.', '账户删除需要 Cloud 支持审核，并将永久移除账户访问权限。'), settingButton('delete-account', sx('Request deletion', '申请删除'), 'danger'), 'danger'),
  ].join('')
  return settingsSection(sx('IDENTITY', '身份'), sx('Identity & credentials', '身份与凭据'), sx('Exora Cloud owns account credentials; Dock only shows their state.', '账户凭据由 Exora Cloud 管理，Dock 只展示状态。'), identityRows)
    + settingsSection(sx('ACCOUNT ACTIONS', '账户操作'), sx('Session & account', '会话与账户'), sx('Destructive actions always require confirmation.', '破坏性操作始终需要二次确认。'), accountRows)
}

function renderAgentSettings() {
  const runtime = state.settingsSystemStatus?.runtime || state.appStatus
  const healthy = runtime?.daemon === 'healthy'
  const policy = state.walletStatus?.agentSpendPolicy
  const spendText = policy?.enabled
    ? sx(`Enabled · ${formatWalletAtomic(Number(policy.periodLimitAtomic || 0), walletUSDCDecimals())} USDC / 24h`, `已启用 · ${formatWalletAtomic(Number(policy.periodLimitAtomic || 0), walletUSDCDecimals())} USDC / 24 小时`)
    : sx('Disabled · every purchase requires human approval', '未启用 · 每笔消费均需人工批准')
  const sessionPolicy = state.agentSessionPolicy
  const enabledScopes = new Set(sessionPolicy?.scopes || ['market.read', 'api.invoke', 'account.read', 'provider.integrate'])
  const scopeChoices: Array<[string, string, string]> = [
    ['market.read', sx('Market read', '市场读取'), sx('Browse published APIs and Operations.', '浏览已发布的 API 与 Operation。')],
    ['api.invoke', sx('Invoke APIs', '调用 API'), sx('Estimate and invoke published Operations.', '估价并调用已发布的 Operation。')],
    ['account.read', sx('Usage & activity', '用量与活动'), sx('Read account usage, jobs, and activity.', '读取账户用量、任务与活动记录。')],
    ['provider.integrate', sx('Create API drafts', '创建 API 草稿'), sx('Submit API drafts and pricing suggestions; review and publishing stay owner-only.', '提交 API 草稿与价格建议；审核和发布仍仅限所有者。')],
  ]
  const scopeRows = scopeChoices.map(([scope, label, detail]) => settingRow(icon(ShieldCheck), label, detail, settingScopeSegment(scope, enabledScopes.has(scope)))).join('')
  const agentClientRows = state.agentMcpClients.length
    ? state.agentMcpClients.map((client) => {
      const clientState = String(client.state || '').replaceAll('_', '-') as AgentMcpClientStatus['state']
      const labels: Record<AgentMcpClientStatus['state'], string> = {
        registered: sx('Connected', '已连接'), stale: sx('Update needed', '需要更新'), conflict: sx('Conflict', '配置冲突'),
        available: sx('Available', '可连接'), 'not-detected': sx('Not detected', '未检测到'), error: sx('Error', '错误'),
      }
      const tones: Record<AgentMcpClientStatus['state'], 'success' | 'warning' | 'danger' | 'neutral'> = {
        registered: 'success', stale: 'warning', conflict: 'danger', available: 'neutral', 'not-detected': 'neutral', error: 'danger',
      }
      const extra = `data-agent-client-id="${escapeAttr(client.clientId)}" data-agent-instance-id="${escapeAttr(client.instanceId || '')}"`
      const redetect = settingButton('agent-client-refresh', sx('Redetect', '重新检测'), 'outline', extra)
      let actions = redetect
      if (clientState === 'registered') actions = `${settingButton('agent-client-probe', sx('Test', '测试'), 'soft', extra)}${redetect}${settingButton('agent-client-remove', sx('Remove', '删除'), 'outline', extra)}`
      else if (clientState === 'stale' || clientState === 'conflict') actions = `${settingButton('agent-client-repair', sx('Repair', '修复'), 'soft', extra)}${redetect}${settingButton('agent-client-remove', sx('Remove', '删除'), 'outline', extra)}`
      else if (clientState === 'available' && client.canRegister !== false) actions = `${settingButton('agent-client-connect', sx('Connect', '连接'), 'soft', extra)}${redetect}`
      const location = client.configPath || client.installPath || ''
      const shared = Number(client.sharedTargetCount || 0) > 1 ? sx(`Shared config · ${client.sharedTargetCount} installs`, `共享配置 · ${client.sharedTargetCount} 个安装实例`) : ''
      const version = client.versions?.length ? client.versions.map((value) => `v${value}`).join(' / ') : client.version ? `v${client.version}` : ''
      const detail = [version, shared, location, client.detail || client.message || ''].filter(Boolean).join(' · ') || sx('Detected local Agent client.', '检测到本地 Agent 客户端。')
      return settingRow(icon(Network), client.instanceLabel || client.displayName, detail, `<div class="app-setting-actions">${settingStatus(labels[clientState] || sx('Unknown', '未知'), tones[clientState] || 'neutral')}${actions}</div>`)
    }).join('')
    : settingRow(icon(Network), sx('Agent clients', 'Agent 客户端'), state.settingsStatusLoading ? sx('Detecting installed clients…', '正在检测已安装的客户端…') : sx('No supported Agent clients were detected.', '未检测到受支持的 Agent 客户端。'), settingButton('agent-client-refresh', sx('Refresh', '刷新'), 'outline'))
  const connectionRows = [
    settingRow(icon(Activity), sx('Dock MCP runtime', 'Dock MCP 运行时'), settingsRuntimeMessage(runtime), `<div class="app-setting-actions">${settingStatus(healthy ? sx('Running', '运行中') : sx('Offline', '离线'), healthy ? 'running' : 'danger')}${settingButton('test-connection', sx('Test', '测试'), 'soft')}</div>`),
    settingRow(icon(Copy), sx('Client configurations', '客户端配置'), sx('Copy a ready-to-use configuration without exposing tokens or account credentials.', '复制可直接使用的配置，不暴露 Token 或账户凭据。'), `<div class="app-setting-actions compact">${settingButton('copy-config', 'Codex', 'outline', 'data-settings-command="copy_mcp_command"')}${settingButton('copy-config', 'Claude', 'outline', 'data-settings-command="copy_mcp_command"')}${settingButton('copy-config', 'OpenCode', 'outline', 'data-settings-command="copy_opencode_config"')}${settingButton('copy-config', sx('Generic', '通用'), 'outline', 'data-settings-command="copy_mcp_command"')}</div>`),
    settingRow(icon(FolderOpen), 'Manifest', sx('Open the read-only discovery document used by local Agent clients.', '打开本地 Agent 客户端使用的只读发现文档。'), settingButton('open-manifest', sx('Open manifest', '打开 Manifest'), 'outline')),
  ].join('')
  const permissionRows = [
    settingRow(icon(Hand), sx('Default approval policy', '默认审批策略'), sx('Spending, renewals, and APIs with external side effects require human approval by default.', '消费、续费与具有外部副作用的 API 默认要求人工批准。'), settingStatus(sx('Human approval', '人工批准'), 'warning')),
    settingRow(icon(Wallet), sx('Agent spending limit', 'Agent 消费限额'), spendText, settingButton('open-agent-limit', sx('Open Wallet', '前往 Wallet'), 'soft')),
    scopeRows,
  ].join('')
  return settingsSection(sx('AGENT CLIENTS', 'AGENT 客户端'), sx('Automatic MCP registration', 'MCP 自动注册'), sx('Connect, repair, or remove Exora Dock without overwriting unrelated client settings.', '连接、修复或删除 Exora Dock，不覆盖客户端中的其他设置。'), agentClientRows)
    + settingsSection(sx('CONNECTION', '连接'), sx('Dock & MCP', 'Dock 与 MCP'), sx('Dock publishes one local connection surface for supported Agent clients.', 'Dock 为受支持的 Agent 客户端提供统一的本地连接入口。'), connectionRows)
    + settingsSection(sx('BOUNDARIES', '边界'), sx('Approval & Agent access', '审批与 Agent 权限'), sx('Control spending and the capabilities available to future Agent connections. Permission changes save immediately.', '控制消费以及后续 Agent 连接可使用的能力；权限更改会立即保存。'), permissionRows)
}

function renderNotificationSettings() {
  const supported = state.settingsSystemStatus?.notificationsSupported
  const permissionRows = settingRow(icon(Bell), sx('System notifications', '系统通知'), supported === false ? sx('This operating system does not expose notifications to Exora Dock.', '此操作系统未向 Exora Dock 提供通知能力。') : sx('Send a test notification without changing your category preferences.', '发送测试通知，不改变你的分类偏好。'), `<div class="app-setting-actions">${settingStatus(supported === false ? sx('Unavailable', '不可用') : sx('Available', '可用'), supported === false ? 'danger' : 'success')}${settingButton('test-notification', sx('Send test', '发送测试'), 'soft', supported === false ? 'disabled' : '')}</div>`)
  const definitions: Array<[NotificationPreferenceKey, IconNode, string, string, string, string]> = [
    ['approvals', Hand, 'Approvals & confirmations', '审批与确认', 'Payments, API Order reactivation, and operations with external side effects waiting for you.', '等待你处理的支付、API Order 恢复与外部副作用操作。'],
    ['apiActivity', Activity, 'API calls', 'API 调用', 'Invocation and async-job completion, failure, cancellation, or expiry.', 'API 调用与异步任务的完成、失败、取消或过期。'],
    ['billing', BadgeDollarSign, 'Billing & wallet', '资金与账单', 'Low balance, charges, refunds, deposits, and withdrawal status.', '余额不足、扣费、退款、充值与提现状态。'],
    ['providerApis', Cloud, 'API integration & publishing', 'API 接入与发布', 'Integration steps awaiting confirmation, qualification results, and publishing outcomes.', '等待确认的接入步骤、资格检查与发布结果。'],
    ['security', KeyRound, 'Account & access', '账户与访问', 'Sign-in, account keys, payment PIN, and Agent connection changes.', '登录、账户密钥、支付 PIN 与 Agent 连接变化。'],
  ]
  const categoryRows = definitions.map(([key, rowIcon, en, zh, enDetail, zhDetail]) => settingRow(icon(rowIcon), sx(en, zh), sx(enDetail, zhDetail), settingBooleanSegment(`notification.${key}`, state.notifications[key]))).join('')
  return settingsSection(sx('PERMISSION', '权限'), sx('Delivery', '通知能力'), sx('If system permission is denied, the same records remain available in Activity, Wallet, APIs, and Account.', '如果系统权限被拒绝，同一记录仍可在活动、钱包、API 与账户页面中查看。'), permissionRows)
    + settingsSection(sx('CATEGORIES', '分类'), sx('Events to notify', '需要通知的事件'), sx('Changes save immediately on this device.', '更改会立即保存在此设备上。'), categoryRows)
}

function renderDataSettings() {
  const storage = state.settingsSystemStatus?.storage
  const usageRows = [
    settingRow(icon(Archive), sx('Application data', '应用数据'), `${formatByteSize(storage?.dataBytes)} · ${sx('Cloud history and purchased/provider files are not cleared here.', 'Cloud 历史与购买文件、Provider 资源不会在此清理。')}`, settingButton('open-data', sx('Open', '打开'), 'outline')),
    settingRow(icon(Info), sx('Logs', '日志'), `${formatByteSize(storage?.logsBytes)} · ${sx('Operational logs used for local troubleshooting.', '用于本地故障排查的运行日志。')}`, `<div class="app-setting-actions">${settingButton('open-logs', sx('Open', '打开'), 'outline')}${settingButton('clear-logs', sx('Clear', '清理'), 'outline')}</div>`),
    settingRow(icon(RefreshCw), sx('Cache & temporary files', '缓存与临时文件'), `${formatByteSize(Number(storage?.cacheBytes || 0) + Number(storage?.tempBytes || 0))} · ${sx('Safe to recreate; credentials and purchased files are excluded.', '可安全重建；凭据与购买文件不在此范围。')}`, `<div class="app-setting-actions">${settingButton('clear-cache', sx('Clear cache', '清理缓存'), 'soft')}${settingButton('clear-temporary', sx('Clear temporary', '清理临时文件'), 'outline')}</div>`),
  ].join('')
  const downloads = state.downloadDirectory || state.settingsSystemStatus?.paths?.downloads || sx('System Downloads folder', '系统下载目录')
  const locationRows = settingRow(icon(Folder), sx('Default download directory', '默认下载目录'), downloads, `<div class="app-setting-actions">${settingButton('open-downloads', sx('Open', '打开'), 'outline')}${settingButton('choose-downloads', sx('Choose', '选择'), 'soft')}</div>`)
  return settingsSection(sx('USAGE', '占用'), sx('Local storage', '本地存储'), sx('Only disposable local data can be cleared from this page.', '此页面只能清理可丢弃的本地数据。'), usageRows)
    + settingsSection(sx('LOCATIONS', '位置'), sx('Downloads', '下载'), sx('The selected path is stored as a normal preference; file access remains local.', '所选路径作为普通偏好保存，文件访问仍仅发生在本地。'), locationRows)
}

function renderSystemSettings() {
  const system = state.settingsSystemStatus
  const cloudURL = system?.cloudURL || state.cloudAuthState?.cloudURL || sx('Not configured', '未配置')
  const update = system?.update
  const statusRows = [
    settingRow(icon(Network), 'Cloud', cloudURL, settingStatus(state.cloudAuthState?.offline ? sx('Offline', '离线') : sx('Connected', '已连接'), state.cloudAuthState?.offline ? 'danger' : 'running')),
    settingRow(icon(Info), sx('Components', '组件版本'), `Exora Dock ${system?.appVersion || '—'} · Electron ${system?.electronVersion || '—'} · ${system?.platform || '—'} ${system?.arch || ''}`, settingStatus(system?.packaged === false ? sx('Development', '开发构建') : sx('Stable', '稳定版'), 'neutral')),
  ].join('')
  const updateRows = settingRow(icon(RefreshCw), sx('Update notifications', '更新提醒'), settingsUpdateMessage(update), `<div class="app-setting-actions">${update?.state === 'available' ? settingStatus(sx('Verified update', '已验证更新'), 'success') : ''}${settingButton('check-update', sx('Check now', '立即检查'), 'soft')}${update?.state === 'available' ? settingButton('install-update', sx('Open download', '打开下载页'), 'primary') : ''}</div>`)
  return settingsSection(sx('SYSTEM', '系统'), sx('Cloud & versions', 'Cloud 与版本'), sx('Cloud URL is read-only in production builds.', '生产环境中的 Cloud URL 仅可读。'), statusRows)
    + settingsSection(sx('UPDATES', '更新'), sx('Signed Technical Preview channel', '签名技术预览通道'), sx('The app verifies the Ed25519 release manifest and shows the expected installer SHA-256. Downloads open in your browser and are never installed silently.', '应用会验证 Ed25519 发布清单并显示安装包的预期 SHA-256；下载将在浏览器中打开，绝不会静默安装。'), updateRows)
}

function formatByteSize(value: unknown) {
  const bytes = Number(value || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const amount = bytes / (1024 ** index)
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`
}

function settingsRuntimeMessage(runtime?: AppStatus) {
  if (state.language !== 'zh') return runtime?.message || 'Local MCP and REST runtime.'
  if (runtime?.daemon === 'healthy') return 'Dock 已准备好接受本地 Agent 连接。'
  if (runtime?.daemon === 'starting') return 'Dock 正在启动本地 MCP 与 REST 运行时。'
  if (runtime?.image === 'missing') return '未找到 Dock 运行组件，请重新安装或修复应用。'
  return 'Dock 当前离线，可在此页启动或重试连接。'
}

function settingsUpdateMessage(update?: DesktopSystemStatus['update']) {
  if (state.language !== 'zh') return update?.message || 'Stable channel updates install only when no active task would be interrupted.'
  if (update?.state === 'checking') return '正在检查稳定通道更新…'
  if (update?.state === 'available') return '发现可用更新。'
  if (update?.state === 'downloading') return `正在下载更新${Number(update.progress || 0) > 0 ? ` · ${Math.round(Number(update.progress))}%` : '…'}`
  if (update?.state === 'downloaded') return '更新已下载；请在活动任务结束后重启安装。'
  if (update?.state === 'current') return 'Exora Dock 已是最新版本。'
  if (update?.state === 'error') return '更新检查失败，请稍后重试。'
  if (update?.state === 'unavailable') return '当前发行版尚未配置更新源。'
  if (update?.state === 'development') return '开发构建不启用自动更新。'
  return '稳定通道更新只会在不打断活动任务时安装。'
}

function renderWalletStatus() {
  const wallet = state.walletStatus
  const accountWallet = wallet?.accountBound === true
  const address = accountWallet ? wallet?.address?.trim() || '' : ''
  const readyToReceive = Boolean(address)
  const balance = walletUSDCBalance(wallet)
  const balanceStatus = balance?.status?.trim() || ''
  const decimals = walletUSDCDecimals(wallet)

  fields.walletState.textContent = readyToReceive ? uiText('receive ready') : uiText(wallet ? 'preparing' : 'checking')
  fields.walletState.classList.toggle('ready', readyToReceive)
  fields.walletAddress.textContent = address || uiText('not configured')
  fields.walletAddressShort.textContent = address ? compactWalletAddress(address) : uiText('not configured')
  fields.walletAddressShort.setAttribute('title', address)
  fields.walletBalance.textContent = formatWalletAtomic(balance?.amountAtomic || 0, decimals)
  fields.walletBalanceStatus.textContent = balanceStatus && balanceStatus !== 'ready'
    ? `Balance ${balanceStatus.replaceAll('_', ' ')}`
    : balance?.updatedAt
      ? `Updated ${new Date(balance.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : readyToReceive ? 'Wallet ready' : 'Preparing your wallet'
  fields.walletCopyButton.disabled = !readyToReceive
  fields.walletWithdrawButton.disabled = !readyToReceive || state.walletWithdrawalBusy
  fields.walletWithdrawButton.textContent = state.walletWithdrawalBusy
    ? 'Processing…'
    : state.walletWithdrawalChallenge ? 'Confirm withdrawal' : 'Send email code'
  fields.walletWithdrawForm.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
	input.disabled = state.walletWithdrawalBusy || (input.name === 'emailCode' ? !state.walletWithdrawalChallenge : input.name === 'paymentPin' ? false : Boolean(state.walletWithdrawalChallenge))
  })
  const fee = wallet?.feePolicy
  const activeQuote = state.walletWithdrawalChallenge?.quote
  fields.walletFeeNote.textContent = activeQuote
    ? `Quoted fees: ${formatWalletAtomic(Number(activeQuote.totalFeeAtomic || 0), decimals)} USDC; recipient receives ${formatWalletAtomic(Number(activeQuote.netAmountAtomic || 0), decimals)} USDC.`
    : Number(fee?.relayFeeAtomic || 0) > 0
    ? `Relay fee: ${formatWalletAtomic(Number(fee?.relayFeeAtomic || 0), decimals)} ${fee?.currency || 'USDC'}`
    : fee?.relayFeeDescription || 'Network fees are covered by Exora.'
  renderWalletWithdrawalStatus()
  renderWalletSpendPolicy()
  renderWalletHistory()

  if (readyToReceive) {
    void renderWalletQRCode(address)
  } else {
    fields.walletQR.innerHTML = `<span>${escapeHTML(uiText('QR'))}</span>`
  }
  renderWalletCodeInputs()
}

function walletUSDCBalance(wallet = state.walletStatus) {
  if (!wallet?.balances) return undefined
  return wallet.balances.usdc || Object.values(wallet.balances).find((balance) => String(balance.currency || '').toUpperCase() === 'USDC')
}

function walletUSDCDecimals(wallet = state.walletStatus) {
  const decimals = Number(walletUSDCBalance(wallet)?.decimals ?? 6)
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 12 ? decimals : 6
}

function formatWalletAtomic(amountAtomic: number, decimals = 6) {
  const amount = Number(amountAtomic || 0) / (10 ** decimals)
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(amount)
}

function walletAtomicInput(amountAtomic: number, decimals = 6) {
  const base = 10 ** decimals
  return (Number(amountAtomic || 0) / base).toFixed(decimals).replace(/\.?0+$/, '') || '0'
}

function compactWalletAddress(address: string) {
  return address.length > 18 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address
}

function renderWalletWithdrawalStatus() {
  const target = fields.walletWithdrawStatus
  const withdrawal = state.walletWithdrawal
  const challenge = state.walletWithdrawalChallenge
  const error = state.walletWithdrawalError
  target.classList.toggle('hidden', !withdrawal && !challenge && !error)
  target.classList.toggle('error', Boolean(error))
  if (error) {
    target.innerHTML = `<strong>Withdrawal not authorized</strong><span>${escapeHTML(error)}</span>`
    return
  }
  if (!withdrawal) {
	const expiresRemaining = challenge?.challenge.expiresAt ? Math.max(0, Math.ceil((new Date(challenge.challenge.expiresAt).getTime() - Date.now()) / 1000)) : 0
	const resendRemaining = challenge?.challenge.resendAfter ? Math.max(0, Math.ceil((new Date(challenge.challenge.resendAfter).getTime() - Date.now()) / 1000)) : 0
    target.innerHTML = challenge
	  ? `<strong>Verification email sent</strong><span>Enter the six-digit code${challenge.challenge.email ? ` sent to ${escapeHTML(challenge.challenge.email)}` : ''}. Expires in ${Math.floor(expiresRemaining / 60)}:${String(expiresRemaining % 60).padStart(2, '0')}.</span><button class="secondary" type="button" data-wallet-resend-code ${resendRemaining > 0 || state.walletWithdrawalBusy ? 'disabled' : ''}>${resendRemaining > 0 ? `Resend in ${resendRemaining}s` : 'Resend code'}</button>`
      : ''
    return
  }
  const decimals = Number(withdrawal.decimals ?? walletUSDCDecimals())
  target.innerHTML = withdrawal.status === 'relayer_required'
    ? `<strong>Ready for relayer</strong><span>${escapeHTML(formatWalletAtomic(Number(withdrawal.amountAtomic || 0), decimals))} ${escapeHTML(withdrawal.currency || 'USDC')} · Signed securely on this Desktop; Exora relayer submission is still required.</span>`
    : `<strong>Withdrawal authorized</strong><span>${escapeHTML(formatWalletAtomic(Number(withdrawal.amountAtomic || 0), decimals))} ${escapeHTML(withdrawal.currency || 'USDC')} · ${escapeHTML(withdrawal.status || 'Processing')}</span>`
}

function walletSolscanURL(signature: string) {
	return `https://solscan.io/tx/${encodeURIComponent(signature)}`
}

function renderWalletHistory() {
	const deposits = Array.isArray(state.walletStatus?.deposits) ? state.walletStatus!.deposits! : []
	const withdrawals = Array.isArray(state.walletStatus?.withdrawals) ? state.walletStatus!.withdrawals! : []
  const allRows = [
    ...deposits.map((item) => ({
      id: item.depositId || item.signature || '', kind: 'deposit' as const, amount: Number(item.amountAtomic || 0), status: item.status || 'pending',
      signature: item.signature || '', at: item.finalizedAt || item.creditedAt || item.detectedAt || '', detail: item.network || 'Solana', fee: 0,
    })),
    ...withdrawals.map((item) => ({
      id: item.withdrawalId || item.signature || '', kind: 'withdrawal' as const, amount: Number(item.amountAtomic || 0), status: item.status || 'pending',
      signature: item.signature || '', at: item.finalizedAt || item.updatedAt || item.createdAt || '', detail: item.destination || item.toAddress || 'External wallet', fee: Number(item.totalFeeAtomic || 0),
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const rows = state.walletHistoryFilter === 'all' ? allRows : allRows.filter((item) => item.kind === state.walletHistoryFilter)
  fields.walletHistoryFilters.forEach((button) => {
    const active = button.dataset.walletHistoryFilter === state.walletHistoryFilter
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  if (!rows.length) {
    fields.walletHistory.innerHTML = `<div class="wallet-history-empty"><span aria-hidden="true">${icon(Activity)}</span><strong>No ${state.walletHistoryFilter === 'all' ? 'funding activity' : `${state.walletHistoryFilter}s`} yet</strong><p>Completed and pending wallet transfers will appear here.</p></div>`
    return
  }
  fields.walletHistory.innerHTML = `<div class="wallet-history-list">${rows.map((item) => {
    const label = item.kind === 'deposit' ? 'Deposit' : 'Withdrawal'
    const amount = `${item.kind === 'deposit' ? '+' : '−'}${formatWalletAtomic(item.amount, walletUSDCDecimals())} USDC`
    const detail = item.kind === 'withdrawal' && item.detail.length > 18 ? compactWalletAddress(item.detail) : item.detail
    return `<article class="wallet-history-row ${item.kind}"><span class="wallet-history-kind" aria-hidden="true">${item.kind === 'deposit' ? walletSurfaceIcon : toolbarIcons.forward}</span><div class="wallet-history-copy"><strong>${label}</strong><small>${escapeHTML(item.status.replaceAll('_', ' '))}${item.at ? ` · ${escapeHTML(new Date(item.at).toLocaleString())}` : ''}</small><code title="${escapeAttr(item.detail)}">${escapeHTML(detail || item.id)}</code></div><div class="wallet-history-amount"><strong>${escapeHTML(amount)}</strong>${item.fee > 0 ? `<small>Fee ${escapeHTML(formatWalletAtomic(item.fee, walletUSDCDecimals()))} USDC</small>` : '<small>No Exora fee</small>'}${item.signature ? `<a href="${escapeAttr(walletSolscanURL(item.signature))}" target="_blank" rel="noreferrer">View on Solscan</a>` : ''}</div></article>`
  }).join('')}</div>`
}

function walletPolicyAmountToAtomic(value: string, decimals = 6) {
  const normalized = value.trim() || '0'
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('Enter valid USDC limits.')
  const [whole, fraction = ''] = normalized.split('.')
  if (fraction.length > decimals) throw new Error(`USDC supports up to ${decimals} decimal places.`)
  const atomic = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(fraction.padEnd(decimals, '0') || '0')
  if (atomic > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('The payment limit is too large.')
  return Number(atomic)
}

function syncWalletSpendFormDisabled() {
  const enabled = fields.walletLimitEnabled.checked
  fields.walletLimitForm.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
    input.disabled = state.walletSpendBusy || (input.name !== 'paymentPin' && !enabled)
  })
  fields.walletLimitEnabled.disabled = state.walletSpendBusy
  fields.walletLimitSave.disabled = state.walletSpendBusy
  fields.walletLimitSave.textContent = state.walletSpendBusy ? 'Saving…' : 'Save limits'
}

function renderWalletSpendPolicy() {
  const policy = state.walletStatus?.agentSpendPolicy
  const enabled = policy?.enabled === true
  fields.walletLimitState.textContent = enabled ? 'on' : 'off'
  fields.walletLimitState.classList.toggle('ready', enabled)
  const singleInput = fields.walletLimitForm.querySelector<HTMLInputElement>('input[name="singleLimit"]')!
  const periodInput = fields.walletLimitForm.querySelector<HTMLInputElement>('input[name="periodLimit"]')!
  const fingerprint = policy ? [policy.enabled, policy.singleLimitAtomic, policy.periodLimitAtomic, policy.spentAtomic, policy.updatedAt].join(':') : 'empty'
  if (fields.walletLimitForm.dataset.policyFingerprint !== fingerprint && !fields.walletLimitForm.contains(document.activeElement)) {
    fields.walletLimitEnabled.checked = enabled
    singleInput.value = walletAtomicInput(Number(policy?.singleLimitAtomic || 0), walletUSDCDecimals())
    periodInput.value = walletAtomicInput(Number(policy?.periodLimitAtomic || 0), walletUSDCDecimals())
    fields.walletLimitForm.dataset.policyFingerprint = fingerprint
  }
  const spent = Number(policy?.spentAtomic || 0)
  const periodLimit = Number(policy?.periodLimitAtomic || 0)
  const remaining = Math.max(0, periodLimit - spent)
  const resetsAt = policy?.periodStartedAt
    ? new Date(new Date(policy.periodStartedAt).getTime() + Math.max(1, Number(policy.periodSeconds || 86400)) * 1000)
    : undefined
  fields.walletLimitUsage.innerHTML = `
    <div><span>Used this period</span><strong>${escapeHTML(formatWalletAtomic(spent, walletUSDCDecimals()))} USDC</strong></div>
    <div><span>Remaining</span><strong>${enabled ? `${escapeHTML(formatWalletAtomic(remaining, walletUSDCDecimals()))} USDC` : '—'}</strong></div>
    <div><span>Resets</span><strong>${enabled && resetsAt ? escapeHTML(resetsAt.toLocaleString()) : 'When enabled'}</strong></div>`
  fields.walletLimitError.textContent = state.walletSpendError || ''
  fields.walletLimitError.classList.toggle('show', Boolean(state.walletSpendError))
  syncWalletSpendFormDisabled()
  renderWalletCodeInputs()
}

async function submitWalletSpendPolicy() {
  if (state.walletSpendBusy) return
  const data = new FormData(fields.walletLimitForm)
  const enabled = fields.walletLimitEnabled.checked
  const pin = String(data.get('paymentPin') || '').trim()
  if (!/^\d{6}$/.test(pin)) throw new Error('Cloud payment PIN must be exactly 6 digits.')
  const singleLimitAtomic = walletPolicyAmountToAtomic(String(data.get('singleLimit') || ''), walletUSDCDecimals())
  const periodLimitAtomic = walletPolicyAmountToAtomic(String(data.get('periodLimit') || ''), walletUSDCDecimals())
  if (enabled && (singleLimitAtomic <= 0 || periodLimitAtomic <= 0)) throw new Error('Enabled limits must be greater than zero.')
  if (enabled && periodLimitAtomic < singleLimitAtomic) throw new Error('The 24-hour limit must be at least the per-payment limit.')
  state.walletSpendBusy = true
  state.walletSpendError = undefined
  renderWalletSpendPolicy()
  try {
    const response = await invoke<{ spendPolicy?: AgentSpendPolicy }>('wallet_spend_policy_save', { input: { enabled, singleLimitAtomic, periodLimitAtomic, pin } })
    if (!state.walletStatus) state.walletStatus = {}
    state.walletStatus.agentSpendPolicy = response.spendPolicy || (response as unknown as AgentSpendPolicy)
    fields.walletLimitForm.querySelector<HTMLInputElement>('input[name="paymentPin"]')!.value = ''
    fields.walletLimitForm.dataset.policyFingerprint = ''
    showToast(t(enabled ? 'toast.agentLimitsUpdated' : 'toast.agentPaymentsDisabled'))
  } catch (error) {
    state.walletSpendError = humanizeError(error)
  } finally {
    state.walletSpendBusy = false
    renderWalletSpendPolicy()
  }
}

function walletAmountToAtomic(value: string, decimals = 6) {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('Enter a valid USDC amount.')
  const [whole, fraction = ''] = normalized.split('.')
  if (fraction.length > decimals) throw new Error(`USDC supports up to ${decimals} decimal places.`)
  const scale = 10n ** BigInt(decimals)
  const atomic = BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, '0') || '0')
  if (atomic <= 0n) throw new Error('Withdrawal amount must be greater than zero.')
  if (atomic > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Withdrawal amount is too large.')
  return Number(atomic)
}

async function submitWalletWithdrawal(form: HTMLFormElement) {
  if (state.walletWithdrawalBusy) return
  if (state.walletWithdrawalChallenge?.challenge.expiresAt && new Date(state.walletWithdrawalChallenge.challenge.expiresAt).getTime() <= Date.now()) {
    state.walletWithdrawalChallenge = undefined
    throw new Error('The withdrawal verification code expired. Request a new code.')
  }
  const data = new FormData(form)
  const pending = state.walletWithdrawalChallenge
  const toAddress = pending?.toAddress || String(data.get('toAddress') || '').trim()
  const emailCode = String(data.get('emailCode') || '').trim()
	const paymentPin = String(data.get('paymentPin') || '').trim()
  const decimals = walletUSDCDecimals()
  const amountAtomic = pending?.amountAtomic || walletAmountToAtomic(String(data.get('amount') || ''), decimals)
  if (!toAddress) throw new Error('Enter a destination Solana address.')
	if (!pending && !/^\d{6}$/.test(paymentPin)) throw new Error('Cloud payment PIN must be exactly 6 digits.')
  if (state.walletWithdrawalChallenge && !/^\d{6}$/.test(emailCode)) throw new Error('Email verification code must be exactly 6 digits.')
  const balance = walletUSDCBalance()
  if (balance?.status === 'ready' && amountAtomic > Number(balance.amountAtomic || 0)) {
    throw new Error('Withdrawal amount exceeds the available balance.')
  }

  state.walletWithdrawalBusy = true
  state.walletWithdrawal = undefined
  state.walletWithdrawalError = undefined
  renderWalletStatus()
  try {
    const response = await invoke<WalletWithdrawalResponse>('wallet_withdraw', {
      input: pending
        ? { toAddress: pending.toAddress, amountAtomic: pending.amountAtomic, quoteId: pending.quote.quoteId, challengeId: pending.challenge.challengeId, code: emailCode, idempotencyKey: pending.idempotencyKey }
		: { toAddress, amountAtomic, pin: paymentPin },
    })
    if (!pending) {
      if (!response.quote || !response.challenge) throw new Error('Cloud did not return a withdrawal verification challenge.')
      state.walletWithdrawalChallenge = { quote: response.quote, challenge: response.challenge, toAddress, amountAtomic, idempotencyKey: `electron-${crypto.randomUUID()}` }
      fields.walletEmailCodeInput.value = ''
	  form.querySelector<HTMLInputElement>('input[name="paymentPin"]')!.value = ''
      renderWalletStatus()
      fields.walletEmailCodeInput.focus()
      return
    }
    if (!response.withdrawal) throw new Error('Cloud did not return a withdrawal record.')
    state.walletWithdrawal = response.withdrawal
    state.walletWithdrawalChallenge = undefined
    form.querySelector<HTMLInputElement>('input[name="amount"]')!.value = ''
    form.querySelector<HTMLInputElement>('input[name="emailCode"]')!.value = ''
	form.querySelector<HTMLInputElement>('input[name="paymentPin"]')!.value = ''
    await refreshWalletStatus()
  } catch (error) {
    state.walletWithdrawalError = humanizeError(error)
  } finally {
    state.walletWithdrawalBusy = false
    renderWalletStatus()
  }
}

async function resendWalletWithdrawalCode() {
	const pending = state.walletWithdrawalChallenge
	if (!pending || state.walletWithdrawalBusy) return
	const pinInput = fields.walletWithdrawForm.querySelector<HTMLInputElement>('input[name="paymentPin"]')!
	const pin = pinInput.value.trim()
	if (!/^\d{6}$/.test(pin)) throw new Error('Enter the six-digit Cloud payment PIN to resend the email code.')
	state.walletWithdrawalBusy = true
	state.walletWithdrawalError = undefined
	renderWalletStatus()
	try {
		const response = await invoke<WalletWithdrawalResponse>('wallet_withdraw', { input: {
			resend: true, pin, quoteId: pending.quote.quoteId, quote: pending.quote,
		} })
		if (!response.challenge) throw new Error('Cloud did not return a replacement verification challenge.')
		state.walletWithdrawalChallenge = { ...pending, challenge: response.challenge }
		pinInput.value = ''
		fields.walletEmailCodeInput.value = ''
		fields.walletEmailCodeInput.focus()
	} catch (error) {
		state.walletWithdrawalError = humanizeError(error)
	} finally {
		state.walletWithdrawalBusy = false
		renderWalletStatus()
	}
}

async function renderWalletQRCode(address: string) {
  const currentAddress = address.trim()
  if (!currentAddress) {
    fields.walletQR.innerHTML = `<span>${escapeHTML(uiText('QR'))}</span>`
    return
  }
  try {
    const svg = await qrToString(currentAddress, {
      type: 'svg',
      margin: SETTINGS_QR_MARGIN,
      width: SETTINGS_QR_WIDTH,
      color: SETTINGS_QR_COLOR,
    })
    const wallet = state.walletStatus
    const accountWallet = wallet?.accountBound === true
    if (accountWallet && wallet?.address?.trim() === currentAddress) {
      fields.walletQR.innerHTML = svg
    }
  } catch {
    fields.walletQR.innerHTML = `<span>${escapeHTML(uiText('QR'))}</span>`
  }
}

function renderWalletPanelState() {
  fields.walletPanelTabs.forEach((button) => {
    const active = button.dataset.walletTab === state.walletPanel
    button.classList.toggle('active', active)
    button.setAttribute('aria-selected', String(active))
    button.tabIndex = active ? 0 : -1
  })
  fields.walletPanels.forEach((panel) => {
    const active = panel.dataset.walletPanel === state.walletPanel
    panel.classList.toggle('hidden', !active)
    panel.setAttribute('aria-hidden', String(!active))
  })
}

function selectWalletPanel(panel: WalletPanel, focus = false) {
  state.walletPanel = panel
  renderWalletPanelState()
  if (focus) fields.walletPanelTabs.find((button) => button.dataset.walletTab === panel)?.focus()
}

function renderWalletCodeInputs() {
  fields.walletCodeControls.forEach((control) => {
    const input = control.querySelector<HTMLInputElement>('input')
    const cells = Array.from(control.querySelectorAll<HTMLElement>('.wallet-code-cells > i'))
    if (!input || !cells.length) return
    const digits = input.value.replace(/\D/g, '').slice(0, cells.length)
    if (input.value !== digits) input.value = digits
    const focused = document.activeElement === input
    const activeIndex = Math.min(digits.length, cells.length - 1)
    cells.forEach((cell, index) => {
      cell.textContent = control.classList.contains('plain') ? digits[index] || '' : ''
      cell.classList.toggle('filled', index < digits.length)
      cell.classList.toggle('active', focused && index === activeIndex)
    })
    control.classList.toggle('complete', digits.length === cells.length)
    control.classList.toggle('disabled', input.disabled)
  })
}

function renderWalletModal() {
  fields.walletModal.classList.toggle('hidden', !state.walletModalOpen)
  fields.walletModal.setAttribute('aria-hidden', String(!state.walletModalOpen))
  if (!state.walletModalOpen) return
  renderWalletPanelState()
  renderWalletStatus()
  renderWalletCodeInputs()
  localize(fields.walletModal)
}

function copyMCPAgentInstruction() {
  const providerMode = state.v3SellerTab === 'local_api' ? 'local_dock' : state.v3SellerTab === 'cloud_api' ? 'cloud_direct' : ''
  const expandedAPI = providerIntegrations.find((api) => state.v3ExpandedListingId === providerPreparationKey(api.apiId) || state.v3ExpandedListingId?.startsWith(`${api.apiId}:`))
  const instruction = providerMode
    ? providerAPIAgentInstruction(providerMode, expandedAPI)
    : t('listings.agentPrompt')
  void writeClipboardText(instruction)
    .then(() => showToast(t('toast.agentPromptCopied')))
    .catch((error) => showToast(humanizeError(error)))
}

async function writeClipboardText(text: string) {
  if (hasDesktopBridge()) {
    await invoke('copy_agent_prompt', { input: { text } })
    return
  }
  await navigator.clipboard.writeText(text)
}

function providerAPIAgentInstruction(providerMode: 'local_dock' | 'cloud_direct', api?: ProviderIntegration) {
  const target = api ? ` Update the existing stable API UID ${api.apiId} in place by passing apiId ${api.apiId}, expectedVersion ${api.version}, and one complete exora.api-contract.v1 object to exora.submit_api_contract; do not create a second draft.` : ''
  return `Use Exora MCP to prepare and submit this ${providerMode} API.${target} Discover the provider tools available in the current MCP session and follow their instructions, required evidence, checklists, and blockers. Submit the complete Capability Form, then stop for my per-Operation review.`
}

function mcpInfoSteps(keys: string[]) {
  return `<ol>${keys.map((key) => `<li>${escapeHTML(t(key))}</li>`).join('')}</ol>`
}

function renderAgentMcpOnboarding() {
  fields.agentMcpOnboarding.classList.toggle('hidden', !state.agentMcpOnboardingOpen)
  fields.agentMcpOnboarding.setAttribute('aria-hidden', String(!state.agentMcpOnboardingOpen))
  if (!state.agentMcpOnboardingOpen) return
  fields.agentMcpOnboardingTitle.textContent = sx('Connect your Agent clients', '连接你的 Agent 客户端')
  fields.agentMcpOnboardingSubtitle.textContent = sx('Choose the detected clients that should use Exora Dock.', '选择要接入 Exora Dock 的已检测客户端。')
  const detected = state.agentMcpClients.filter((client) => client.detected)
  fields.agentMcpOnboardingBody.innerHTML = detected.map((client) => {
    const selectionKey = client.instanceId || client.clientId
    const selectable = client.state === 'available' && client.canRegister !== false
    const checked = state.agentMcpSelected.includes(selectionKey)
    const status = client.state === 'registered' ? sx('Already connected', '已连接')
      : client.state === 'conflict' ? sx('Existing configuration needs review in Settings', '现有配置需要在设置中检查')
        : client.state === 'stale' ? sx('An older registration can be repaired in Settings', '可在设置中修复旧注册')
          : sx('Ready to connect', '可以连接')
    const version = client.versions?.length ? client.versions.map((value) => `v${value}`).join(' / ') : client.version ? `v${client.version}` : ''
    const installs = Number(client.installationCount || 0) > 1 ? sx(`${client.installationCount} installations`, `${client.installationCount} 个安装实例`) : client.installKind === 'desktop' ? sx('Desktop app', '桌面应用') : client.installKind === 'cli' ? 'CLI' : ''
    const configTarget = client.configPath || client.installPath || ''
    const metadata = [version, installs, status].filter(Boolean).join(' · ')
    return `<label class="agent-mcp-onboarding-client ${selectable ? '' : 'is-disabled'}" title="${escapeAttr(configTarget)}"><input type="checkbox" data-agent-mcp-instance="${escapeAttr(selectionKey)}" ${checked ? 'checked' : ''} ${selectable ? '' : 'disabled'}><span><strong>${escapeHTML(client.instanceLabel || client.displayName)}</strong><small>${escapeHTML(metadata)}</small><em>${escapeHTML(configTarget)}</em></span></label>`
  }).join('')
  const connect = fields.agentMcpOnboarding.querySelector<HTMLButtonElement>('[data-agent-mcp-action="connect"]')
  if (connect) {
    connect.disabled = state.agentMcpBusy || state.agentMcpSelected.length === 0
    connect.textContent = state.agentMcpBusy ? sx('Connecting…', '正在连接…') : sx('Connect selected', '连接所选客户端')
  }
  const later = fields.agentMcpOnboarding.querySelector<HTMLButtonElement>('[data-agent-mcp-action="later"]:not(.app-modal-scrim)')
  if (later) {
    later.disabled = state.agentMcpBusy
    later.textContent = sx('Not now', '暂不连接')
  }
}

function completeAgentMcpOnboarding() {
  const inlineSetup = state.pinSettingsModalOpen && state.pinSettingsMode === 'setup' && state.pinSettingsSetupStep === 'agent'
  state.agentMcpOnboardingVersion = AGENT_MCP_ONBOARDING_VERSION
  state.agentMcpOnboardingOpen = false
  state.agentMcpSelected = []
  if (inlineSetup) dismissPINSettingsModal()
  scheduleSaveAppSettings(0)
  renderAgentMcpOnboarding()
}

function groupAgentMcpClientsByConfigurationTarget(clients: AgentMcpClientStatus[]) {
  const targets = new Map<string, AgentMcpClientStatus>()
  for (const client of clients) {
    const configTarget = client.registrationTarget
      || (client.configPath ? `${client.clientId}|${client.configPath.toLocaleLowerCase()}` : '')
      || `${client.clientId}|${client.instanceId || client.displayName}`
    const current = targets.get(configTarget)
    const clientVersions = client.versions?.length ? client.versions : client.version ? [client.version] : []
    const installationCount = Math.max(1, Number(client.installationCount || 0))
    if (!current) {
      targets.set(configTarget, {
        ...client,
        instanceLabel: client.displayName,
        installationCount,
        sharedTargetCount: installationCount,
        versions: [...new Set(clientVersions)],
      })
      continue
    }
    current.installationCount = Number(current.installationCount || 1) + installationCount
    current.sharedTargetCount = current.installationCount
    current.versions = [...new Set([...(current.versions || []), ...clientVersions])]
    current.detected = current.detected || client.detected
    current.canRegister = current.canRegister !== false || client.canRegister !== false
  }
  return [...targets.values()]
}

async function detectAgentMcpClientsForSetup() {
  const response = hasDesktopBridge()
    ? await invoke<{ clients?: AgentMcpClientStatus[] }>('agent_mcp_status')
    : { clients: previewAgentMcpClients() }
  state.agentMcpClients = groupAgentMcpClientsByConfigurationTarget(response.clients || [])
  state.agentMcpSelected = state.agentMcpClients
    .filter((client) => client.detected && client.state === 'available' && client.canRegister !== false)
    .map((client) => client.instanceId || client.clientId)
}

async function advancePINSetupToAgentStep() {
  const accountRevision = accountContextRevision
  state.pinSettingsBusy = true
  fields.pinSettingsMessage.textContent = 'Detecting installed Agent clients…'
  fields.pinSettingsMessage.dataset.tone = 'info'
  renderPINSettingsModal()
  try {
    await detectAgentMcpClientsForSetup()
    advancePINSettingsStep('agent')
  } catch (error) {
    state.agentMcpClients = []
    state.agentMcpSelected = []
    fields.pinSettingsMessage.textContent = humanizeError(error)
    fields.pinSettingsMessage.dataset.tone = 'error'
    advancePINSettingsStep('agent', true)
  } finally {
    if (accountRevision !== accountContextRevision) return
    state.pinSettingsBusy = false
    renderPINSettingsModal()
  }
}

async function maybeOpenAgentMcpOnboarding() {
  if (state.agentMcpOnboardingVersion >= AGENT_MCP_ONBOARDING_VERSION || state.cloudAuthState?.phase !== 'authenticated') return
  closeProfileMenu()
  closeMCPInfoModal()
  closeWalletModal()
  closeOrderSearch()
  fields.pinSettingsForm.reset()
  fields.pinSettingsMessage.textContent = ''
  fields.pinSettingsMessage.dataset.tone = ''
  state.pinSettingsMode = 'setup'
  state.pinSettingsSetupStep = 'agent'
  state.pinSettingsCurrentValue = ''
  state.pinSettingsSetupValue = ''
  state.pinSettingsAccountKeyValue = ''
  state.pinSettingsModalOpen = true
  state.pinSettingsBusy = true
  renderPINSettingsModal()
  try {
    await detectAgentMcpClientsForSetup()
  } catch (error) {
    state.agentMcpClients = []
    state.agentMcpSelected = []
    fields.pinSettingsMessage.textContent = humanizeError(error)
    fields.pinSettingsMessage.dataset.tone = 'error'
  } finally {
    state.pinSettingsBusy = false
    renderPINSettingsModal()
  }
}

async function connectSelectedAgentMcpClients() {
  if (state.agentMcpBusy || !state.agentMcpSelected.length) return
  state.agentMcpBusy = true
  renderAgentMcpOnboarding()
  try {
    const result = await invoke<{ clients?: Array<AgentMcpClientStatus & { ok?: boolean }> }>('agent_mcp_register', { input: { instanceIds: state.agentMcpSelected } })
    const failures = (result.clients || []).filter((client) => client.ok === false)
    if (!failures.length) {
      void invoke('agent_mcp_probe').catch((error) => console.warn('Agent MCP handshake probe failed:', error))
      showToast(sx('Selected Agent clients are connected. Restart an open client to load the change.', '所选 Agent 客户端已连接。请重启已打开的客户端以加载更改。'))
    } else {
      showToast(sx('Some Agent clients could not be connected. Review them in Settings.', '部分 Agent 客户端无法连接，请在设置中检查。'))
    }
    completeAgentMcpOnboarding()
  } catch (error) {
    if (state.pinSettingsModalOpen && state.pinSettingsSetupStep === 'agent') {
      fields.pinSettingsMessage.textContent = humanizeError(error)
      fields.pinSettingsMessage.dataset.tone = 'error'
      renderPINSettingsModal()
    }
    showToast(humanizeError(error))
  } finally {
    state.agentMcpBusy = false
    renderAgentMcpOnboarding()
    renderPINSettingsModal()
  }
}

function renderMCPInfoModal() {
  fields.mcpInfoModal.classList.toggle('hidden', !state.mcpInfoModalOpen)
  fields.mcpInfoModal.setAttribute('aria-hidden', String(!state.mcpInfoModalOpen))
  if (!state.mcpInfoModalOpen) return
  const providerMode = state.v3SellerTab === 'local_api' ? 'local_dock' : state.v3SellerTab === 'cloud_api' ? 'cloud_direct' : ''
  if (providerMode) {
    fields.mcpInfoTitle.textContent = 'Prepare an API with Exora MCP'
    fields.mcpInfoSubtitle.textContent = 'A session-scoped workflow for your Seller Agent'
    fields.mcpInfoFooter.textContent = 'Dock stores only the complete accepted API Draft.'
    const prompt = providerAPIAgentInstruction(providerMode)
    fields.mcpInfoBody.innerHTML = `
      <section class="mcp-info-intro"><p>Exora MCP exposes only the tools allowed for the current Agent session. The bundled Skill helps the Agent discover and follow the available preparation workflow.</p><div class="mcp-info-command"><span>Tell your Agent</span><code>“${escapeHTML(prompt)}”</code><button type="button" data-mcp-info-action="copy">${icon(Copy)}<span>Copy instruction</span></button></div></section>
      <div class="mcp-info-routes"><section class="mcp-info-route agent"><header><span aria-hidden="true">${icon(BrainCircuit)}</span><div><small>Seller Agent + MCP</small><h3>Preparation route</h3></div></header><ol><li>Assess the authorized starting material.</li><li>Make the API runnable when needed.</li><li>Define Operations and document OpenAPI.</li><li>Prepare safe qualification declarations.</li><li>Assemble and automatically submit the complete form.</li></ol></section><section class="mcp-info-route manual"><header><span aria-hidden="true">${icon(ShieldCheck)}</span><div><small>Owner + Dock</small><h3>Review boundary</h3></div></header><ol><li>Review every Operation.</li><li>Confirm capability and pricing separately.</li><li>Approve Runtime execution and rights.</li><li>Publish only after Qualification passes.</li></ol></section></div>`
    return
  }
  fields.mcpInfoTitle.textContent = t('listings.guide.title')
  fields.mcpInfoSubtitle.textContent = t('listings.guide.subtitle')
  fields.mcpInfoFooter.textContent = t('listings.guide.footer')
  fields.mcpInfoBody.innerHTML = `
    <section class="mcp-info-intro">
      <p>${escapeHTML(t('listings.guide.intro'))}</p>
      <div class="mcp-info-command"><span>${escapeHTML(t('listings.guide.promptLabel'))}</span><code>\u201c${escapeHTML(t('listings.agentPrompt'))}\u201d</code><button type="button" data-mcp-info-action="copy">${icon(Copy)}<span>${escapeHTML(t('listings.agentCopy'))}</span></button></div>
    </section>
    <div class="mcp-info-routes">
      <section class="mcp-info-route agent">
        <header><span aria-hidden="true">${icon(BrainCircuit)}</span><div><small>Agent + MCP</small><h3>${escapeHTML(t('listings.guide.agentTitle'))}</h3></div></header>
        ${mcpInfoSteps(['listings.guide.agentStep1', 'listings.guide.agentStep2', 'listings.guide.agentStep3', 'listings.guide.agentStep4'])}
      </section>
      <section class="mcp-info-route manual">
        <header><span aria-hidden="true">${icon(ShoppingBag)}</span><div><small>Listings + Desktop</small><h3>${escapeHTML(t('listings.guide.manualTitle'))}</h3></div></header>
        ${mcpInfoSteps(['listings.guide.manualStep1', 'listings.guide.manualStep2', 'listings.guide.manualStep3', 'listings.guide.manualStep4'])}
      </section>
    </div>
    <section class="mcp-info-products">
      <header><span>${escapeHTML(t('listings.guide.productsTitle'))}</span></header>
      <div><article><span aria-hidden="true">${icon(SquareKanban)}</span><div><strong>${escapeHTML(t('listings.guide.computeTitle'))}</strong><p>${escapeHTML(t('listings.guide.computeBody'))}</p></div></article><article><span aria-hidden="true">${icon(Archive)}</span><div><strong>${escapeHTML(t('listings.guide.downloadTitle'))}</strong><p>${escapeHTML(t('listings.guide.downloadBody'))}</p></div></article><article><span aria-hidden="true">${icon(Network)}</span><div><strong>${escapeHTML(t('listings.guide.apiTitle'))}</strong><p>${escapeHTML(t('listings.guide.apiBody'))}</p></div></article></div>
    </section>
    <section class="mcp-info-boundaries">
      <header>${icon(ShieldCheck)}<strong>${escapeHTML(t('listings.guide.realityTitle'))}</strong></header>
      <ul>${['listings.guide.reality1', 'listings.guide.reality2', 'listings.guide.reality3', 'listings.guide.reality4'].map((key) => `<li>${escapeHTML(t(key))}</li>`).join('')}</ul>
    </section>`
}

function openMCPInfoModal() {
  closeProfileMenu()
  closeWalletModal()
  closeOrderSearch()
  closePINSettingsModal()
  state.mcpInfoModalOpen = true
  renderMCPInfoModal()
  window.setTimeout(() => fields.mcpInfoModal.querySelector<HTMLButtonElement>('.app-modal-close')?.focus(), 0)
}

function closeMCPInfoModal() {
  if (!state.mcpInfoModalOpen) return
  state.mcpInfoModalOpen = false
  renderMCPInfoModal()
}

function openWalletModal(panel: WalletPanel = state.walletPanel) {
  closeProfileMenu()
  closeMCPInfoModal()
  closePermissionMenu()
  closeOrderSearch()
  closePINSettingsModal()
  state.walletPanel = panel
  state.walletModalOpen = true
  renderWalletModal()
  renderProfileSummary()
  void refreshWalletModalStatus()
}

function closeWalletModal() {
  if (!state.walletModalOpen) return
  state.walletModalOpen = false
  state.walletWithdrawalChallenge = undefined
  fields.walletCodeControls.forEach((control) => {
    const input = control.querySelector<HTMLInputElement>('input')
    if (input) input.value = ''
  })
	renderWalletCodeInputs()
  renderWalletModal()
  renderProfileSummary()
}

let walletModalRefreshRequest: Promise<void> | undefined

function refreshWalletModalStatus() {
  if (!state.walletModalOpen) return Promise.resolve()
  if (walletModalRefreshRequest) return walletModalRefreshRequest
  const refreshButton = app.querySelector<HTMLButtonElement>('[data-action="wallet-refresh"]')
  refreshButton?.setAttribute('aria-busy', 'true')
  if (refreshButton) refreshButton.disabled = true
  const request = (async () => {
    const walletError = await refreshWalletStatus()
    if (!state.walletModalOpen) return
    renderWalletModal()
    if (walletError) {
      fields.walletState.textContent = uiText('offline')
      fields.walletState.classList.remove('ready')
      fields.walletAddress.textContent = walletError
    }
  })().finally(() => {
    if (walletModalRefreshRequest === request) walletModalRefreshRequest = undefined
    refreshButton?.removeAttribute('aria-busy')
    if (refreshButton?.isConnected) refreshButton.disabled = false
  })
  walletModalRefreshRequest = request
  return request
}

function renderSettingsSurface() {
  fields.settingsView.classList.toggle('hidden', !state.settingsOpen)
  fields.actionView.classList.toggle('hidden', state.settingsOpen)
  syncV3SellerTabsVisibility()
  fields.appShell.classList.toggle('settings-mode', state.settingsOpen)
  fields.settingsButton.classList.toggle('active', state.settingsOpen)
  fields.settingsButton.setAttribute('aria-pressed', String(state.settingsOpen))
  if (state.settingsOpen) renderSettingsPanel()
}

function openSettings(view?: SettingsView) {
  state.activeSettingsView = view || 'general'
  closeMCPInfoModal()
  closeWalletModal()
  closeOrderSearch()
  closePINSettingsModal()
  state.profileMenuOpen = false
  state.profileSubmenu = undefined
  state.settingsOpen = true
  renderSettingsSurface()
  renderLedger()
  renderProfileSummary()
  void refreshSettingsStatus()
}

async function refreshSettingsStatus() {
  if (state.settingsStatusLoading) return
  const accountRevision = accountContextRevision
  state.settingsStatusLoading = true
  state.settingsStatusError = undefined
  if (state.settingsOpen) renderSettingsPanel()
  try {
    if (hasDesktopBridge()) {
      const [system, accountKey, agentSessionPolicy, agentMcp] = await Promise.all([
        invoke<DesktopSystemStatus>('system_settings_status'),
        invoke<AccountAPIKeyStatus>('account_api_key_status').catch(() => undefined),
        invoke<AgentSessionPolicy>('agent_session_policy_get').catch(() => undefined),
        invoke<{ clients?: AgentMcpClientStatus[] }>('agent_mcp_status').catch(() => ({ clients: [] })),
      ])
      if (accountRevision !== accountContextRevision) return
      state.settingsSystemStatus = system
      state.accountAPIKeyStatus = accountKey
      state.agentSessionPolicy = agentSessionPolicy
      state.agentMcpClients = groupAgentMcpClientsByConfigurationTarget(agentMcp.clients || [])
    } else {
      state.settingsSystemStatus = previewSystemSettingsStatus()
      state.agentMcpClients = groupAgentMcpClientsByConfigurationTarget(previewAgentMcpClients())
    }
    if (state.settingsSystemStatus.runtime) state.appStatus = state.settingsSystemStatus.runtime
  } catch (error) {
    if (accountRevision !== accountContextRevision) return
    state.settingsStatusError = humanizeError(error)
  } finally {
    if (accountRevision !== accountContextRevision) return
    state.settingsStatusLoading = false
    if (state.settingsOpen) renderSettingsPanel()
  }
}

function previewAgentMcpClients(): AgentMcpClientStatus[] {
  return [
    { clientId: 'codex', instanceId: 'preview-codex', displayName: 'Codex', instanceLabel: 'Codex', installKind: 'config', configPath: '.codex/config.toml', versions: ['0.143.0', '26.715.3651.0'], installationCount: 2, sharedTargetCount: 2, detected: true, state: 'available', detail: sx('Shared by Codex CLI and Desktop.', '由 Codex CLI 与 Desktop 共用。') },
    { clientId: 'claude-code', instanceId: 'preview-claude', displayName: 'Claude Code', instanceLabel: 'Claude Code CLI', installKind: 'cli', version: '2.1.92', detected: true, state: 'registered', managed: true, detail: sx('Registered by Exora Dock.', '已由 Exora Dock 注册。') },
    { clientId: 'cursor', instanceId: 'preview-cursor', displayName: 'Cursor', detected: true, state: 'available', detail: '.cursor/mcp.json' },
    { clientId: 'opencode', instanceId: '', displayName: 'OpenCode', detected: false, state: 'not-detected' },
    { clientId: 'openclaw', instanceId: '', displayName: 'OpenClaw', detected: false, state: 'not-detected' },
  ]
}

function previewSystemSettingsStatus(): DesktopSystemStatus {
  return {
    appVersion: '0.1.0', electronVersion: 'preview', platform: navigator.platform || 'web', arch: '—', packaged: false,
    secureStorageAvailable: true, notificationsSupported: 'Notification' in window, notificationPermission: 'preview',
    paths: { data: 'ExoraDock/data', logs: 'ExoraDock/logs', downloads: state.downloadDirectory || sx('System Downloads folder', '系统下载目录') },
    storage: { dataBytes: 18_874_368, logsBytes: 786_432, cacheBytes: 5_242_880, tempBytes: 262_144 },
    runtime: state.appStatus || { docker: 'native', container: 'running', daemon: 'healthy', image: 'available', containerName: 'exora-dockd', imageTag: 'preview', baseUrl: 'http://127.0.0.1:8080', dataDir: '', configPath: '', discoveryPath: '', mcpCommand: '', agentPrompt: '', opencodeConfig: '', message: sx('Dock is ready for local Agent connections.', 'Dock 已准备好接受本地 Agent 连接。') },
    cloudURL: state.cloudAuthState?.cloudURL || 'https://api.exoradock.com',
    update: { supported: false, channel: 'technical-preview', state: 'development', message: sx('Updates are disabled in the browser preview.', '浏览器预览中不启用更新。') },
  }
}

function agentMcpClientCards() {
  return state.agentMcpClients.filter((client) => client.detected).map((client) => {
    const selectionKey = client.instanceId || client.clientId
    const selectable = client.state === 'available' && client.canRegister !== false
    const checked = state.agentMcpSelected.includes(selectionKey)
    const status = client.state === 'registered' ? sx('Already connected', '已连接')
      : client.state === 'conflict' ? sx('Configuration conflict', '配置冲突')
        : client.state === 'stale' ? sx('Registration needs repair', '注册需要修复')
          : sx('Ready to connect', '可以连接')
    const version = client.versions?.length ? client.versions.map((value) => `v${value}`).join(' / ') : client.version ? `v${client.version}` : ''
    const installs = Number(client.installationCount || 0) > 1
      ? sx(`${client.installationCount} installations`, `${client.installationCount} 个安装实例`)
      : client.installKind === 'desktop' ? sx('Desktop app', '桌面应用') : client.installKind === 'cli' ? 'CLI' : ''
    const configTarget = client.configPath || client.installPath || ''
    const metadata = [version, installs, status].filter(Boolean).join(' · ')
    return `<label class="agent-mcp-onboarding-client ${selectable ? '' : 'is-disabled'}" title="${escapeAttr(configTarget)}"><input type="checkbox" data-agent-mcp-instance="${escapeAttr(selectionKey)}" ${checked ? 'checked' : ''} ${selectable ? '' : 'disabled'}><span><strong>${escapeHTML(client.instanceLabel || client.displayName)}</strong><small>${escapeHTML(metadata)}</small><em>${escapeHTML(configTarget)}</em></span></label>`
  }).join('')
}

function returnFromSettings() {
  state.settingsOpen = false
  renderSettingsSurface()
  renderLedger()
  renderProfileSummary()
}

function renderPINSettingsModal() {
  const setup = state.pinSettingsMode === 'setup'
  const step = state.pinSettingsSetupStep
  const current = !setup && step === 'current'
  const confirming = step === 'confirmation'
  const accountKey = setup && step === 'account_key'
  const agent = setup && step === 'agent'
  const stepNumber = setup ? step === 'entry' ? 1 : confirming ? 2 : accountKey ? 3 : 4 : current ? 1 : step === 'entry' ? 2 : 3
  const stepCount = setup ? 4 : 3
  fields.pinSettingsModal.classList.toggle('hidden', !state.pinSettingsModalOpen)
  fields.pinSettingsModal.setAttribute('aria-hidden', String(!state.pinSettingsModalOpen))
  fields.pinSettingsModal.dataset.pinStepCount = String(stepCount)
  fields.pinSettingsEyebrow.textContent = setup ? 'Secure workspace setup' : 'Account security'
  fields.pinSettingsTitle.textContent = setup
    ? agent ? 'Connect your Agent'
      : accountKey ? 'Save your account key'
        : confirming ? 'Confirm your payment PIN' : 'Create your payment PIN'
    : current ? 'Change payment PIN' : confirming ? 'Confirm your new PIN' : 'Choose a new PIN'
  fields.pinSettingsDetail.textContent = setup
    ? agent
      ? 'Choose which detected Agent clients should use Exora Dock.'
      : accountKey
        ? 'This sk-exora key is displayed inside the setup window only once.'
        : confirming
          ? 'Enter the same six-digit PIN again to make sure it was recorded correctly.'
          : 'Choose a six-digit PIN for payments and other sensitive actions.'
    : current
      ? 'Verify your current six-digit PIN before choosing a replacement.'
      : confirming
        ? 'Enter the new six-digit PIN once more to make sure it was recorded correctly.'
        : 'Choose the six-digit PIN you want to use from now on.'
  fields.pinSettingsProgressLabel.textContent = `Step ${stepNumber} of ${stepCount}`
  const progressSteps = Array.from(fields.pinSettingsProgress.querySelectorAll<HTMLElement>('i'))
  progressSteps.forEach((progressStep, index) => {
    progressStep.classList.toggle('active', index === stepNumber - 1)
    progressStep.classList.toggle('complete', index < stepNumber - 1)
    progressStep.hidden = index >= stepCount
  })
  fields.pinSettingsCodeStage.hidden = accountKey || agent
  fields.pinSettingsKeyStage.hidden = !accountKey
  fields.pinSettingsAgentStage.hidden = !agent
  fields.pinSettingsAccountKey.textContent = state.pinSettingsAccountKeyValue || 'Account key was not returned. Create or import one later in Account & Security.'
  if (agent) fields.pinSettingsAgentList.innerHTML = agentMcpClientCards()
  const copyKey = fields.pinSettingsKeyStage.querySelector<HTMLButtonElement>('[data-pin-settings-action="copy-key"]')
  if (copyKey) copyKey.disabled = state.pinSettingsBusy || !state.pinSettingsAccountKeyValue
  const skipAgent = fields.pinSettingsAgentStage.querySelector<HTMLButtonElement>('[data-pin-settings-action="skip-agent"]')
  if (skipAgent) skipAgent.disabled = state.pinSettingsBusy || state.agentMcpBusy
  fields.pinSettingsCodeInput.disabled = state.pinSettingsBusy || accountKey || agent
  fields.pinSettingsCodeInput.required = !accountKey && !agent
  fields.pinSettingsCodeInput.autocomplete = current ? 'current-password' : 'new-password'
  fields.pinSettingsCodeInput.setAttribute('aria-label', current
    ? 'Current six digit payment PIN'
    : confirming ? 'Confirm new six digit payment PIN' : 'New six digit payment PIN')
  fields.pinSettingsCodeLabel.textContent = current
    ? 'Current PIN'
    : confirming ? (setup ? 'Confirm payment PIN' : 'Confirm new PIN') : (setup ? 'Payment PIN' : 'New PIN')
  fields.pinSettingsStepHint.textContent = current
    ? 'Enter the PIN you currently use to approve payments.'
    : confirming ? 'Enter the same PIN again.' : 'Use exactly six digits.'
  fields.pinSettingsSubmit.textContent = agent
    ? state.agentMcpBusy ? 'Connecting…' : state.agentMcpSelected.length ? 'Connect selected' : 'Finish'
    : confirming ? (setup ? 'Create PIN' : 'Change PIN') : 'Continue'
  const onFirstStep = (setup && step === 'entry') || current
  fields.pinSettingsCancel.hidden = accountKey
  fields.pinSettingsCancel.textContent = agent ? 'Back' : onFirstStep ? (setup ? 'Not now' : 'Cancel') : 'Back'
  fields.pinSettingsFooter.textContent = setup
    ? agent ? 'Agent registration updates only the selected local client configurations.'
      : accountKey ? 'Keep this key private. Exora Cloud stores only its hash.'
        : 'Payments stay locked until you create a PIN.'
    : 'Your PIN protects sensitive account actions.'
  fields.pinSettingsSubmit.disabled = state.pinSettingsBusy || state.agentMcpBusy
  renderPINSettingsCodeInput()
}

function renderPINSettingsCodeInput() {
  const control = fields.pinSettingsCodeControl
  const input = fields.pinSettingsCodeInput
  const cells = Array.from(control.querySelectorAll<HTMLElement>('.wallet-code-cells > i'))
  const digits = input.value.replace(/\D/g, '').slice(0, cells.length)
  if (input.value !== digits) input.value = digits
  const focused = document.activeElement === input
  const activeIndex = Math.min(digits.length, cells.length - 1)
  cells.forEach((cell, index) => {
    cell.classList.toggle('filled', index < digits.length)
    cell.classList.toggle('active', focused && index === activeIndex)
  })
  control.classList.toggle('complete', digits.length === cells.length)
  control.classList.toggle('disabled', input.disabled)
}

function openPINSettingsModal() {
  closeProfileMenu()
  closeMCPInfoModal()
  closeWalletModal()
  closeOrderSearch()
  fields.pinSettingsForm.reset()
  fields.pinSettingsMessage.textContent = ''
  fields.pinSettingsMessage.dataset.tone = ''
  state.pinSettingsMode = 'change'
  state.pinSettingsSetupStep = 'current'
  state.pinSettingsCurrentValue = ''
  state.pinSettingsSetupValue = ''
  state.pinSettingsAccountKeyValue = ''
  state.pinSettingsModalOpen = true
  renderPINSettingsModal()
  window.setTimeout(() => fields.pinSettingsCodeInput.focus(), 0)
}

function openPINSetupModal() {
  closeProfileMenu()
  closeMCPInfoModal()
  closeWalletModal()
  closeOrderSearch()
  fields.pinSettingsForm.reset()
  fields.pinSettingsMessage.textContent = ''
  fields.pinSettingsMessage.dataset.tone = ''
  state.pinSettingsMode = 'setup'
  state.pinSettingsSetupStep = 'entry'
  state.pinSettingsCurrentValue = ''
  state.pinSettingsSetupValue = ''
  state.pinSettingsAccountKeyValue = ''
  state.pinSettingsModalOpen = true
  renderPINSettingsModal()
  window.setTimeout(() => fields.pinSettingsCodeInput.focus(), 0)
}

function closePINSettingsModal() {
  if (!state.pinSettingsModalOpen || state.pinSettingsBusy || state.agentMcpBusy) return
  dismissPINSettingsModal()
}

function dismissPINSettingsModal() {
  state.pinSettingsModalOpen = false
  state.pinSettingsMode = 'change'
  state.pinSettingsSetupStep = 'current'
  state.pinSettingsCurrentValue = ''
  state.pinSettingsSetupValue = ''
  state.pinSettingsAccountKeyValue = ''
  fields.pinSettingsForm.reset()
  fields.pinSettingsMessage.textContent = ''
  fields.pinSettingsMessage.dataset.tone = ''
  renderPINSettingsModal()
}

async function submitPINSettings() {
  if (state.pinSettingsBusy) return
  const setup = state.pinSettingsMode === 'setup'
  if (setup && state.pinSettingsSetupStep === 'account_key') {
    await advancePINSetupToAgentStep()
    return
  }
  if (setup && state.pinSettingsSetupStep === 'agent') {
    if (state.agentMcpSelected.length) await connectSelectedAgentMcpClients()
    else completeAgentMcpOnboarding()
    return
  }
  const entered = fields.pinSettingsCodeInput.value.trim()
  if (!/^\d{6}$/.test(entered)) {
    fields.pinSettingsMessage.textContent = 'Enter all six digits before continuing.'
    fields.pinSettingsMessage.dataset.tone = 'error'
    return
  }
  if (!setup && state.pinSettingsSetupStep === 'current') {
    state.pinSettingsCurrentValue = entered
    advancePINSettingsStep('entry')
    return
  }
  if (state.pinSettingsSetupStep === 'entry') {
    state.pinSettingsSetupValue = entered
    advancePINSettingsStep('confirmation')
    return
  }
  if (entered !== state.pinSettingsSetupValue) {
    state.pinSettingsSetupValue = ''
    fields.pinSettingsMessage.textContent = 'The PINs did not match. Enter the new PIN again.'
    fields.pinSettingsMessage.dataset.tone = 'error'
    advancePINSettingsStep('entry', true)
    return
  }
  state.pinSettingsBusy = true
  fields.pinSettingsMessage.textContent = 'Updating payment PIN...'
  fields.pinSettingsMessage.dataset.tone = 'info'
  renderPINSettingsModal()
  try {
    if (setup) {
      const result = await invoke<CloudAuthState & { accountKey?: { token?: string; error?: string } }>('auth_pin_set', { input: { pin: state.pinSettingsSetupValue, pinConfirm: state.pinSettingsSetupValue } })
      state.cloudPaymentPINConfigured = true
      state.cloudAuthState = result
      state.authAccount = result.account || state.authAccount
      state.pinSettingsAccountKeyValue = String(result.accountKey?.token || '')
      if (result.accountKey?.error) {
        fields.pinSettingsMessage.textContent = result.accountKey.error
        fields.pinSettingsMessage.dataset.tone = 'error'
      }
      advancePINSettingsStep('account_key', Boolean(result.accountKey?.error))
      showToast('Payment PIN created.')
    } else {
      await invoke<CloudAuthState>('auth_pin_change', {
        input: {
          currentPIN: state.pinSettingsCurrentValue,
          newPIN: state.pinSettingsSetupValue,
          pinConfirm: entered,
        },
      })
      dismissPINSettingsModal()
      showToast(t('toast.paymentPinChanged'))
    }
  } catch (error) {
    fields.pinSettingsMessage.textContent = humanizeError(error)
    fields.pinSettingsMessage.dataset.tone = 'error'
  } finally {
    state.pinSettingsBusy = false
    renderPINSettingsModal()
  }
}

function advancePINSettingsStep(step: 'current' | 'entry' | 'confirmation' | 'account_key' | 'agent', keepMessage = false) {
  state.pinSettingsSetupStep = step
  fields.pinSettingsCodeInput.value = ''
  if (!keepMessage) {
    fields.pinSettingsMessage.textContent = ''
    fields.pinSettingsMessage.dataset.tone = ''
  }
  renderPINSettingsModal()
  window.setTimeout(() => {
    if (step === 'account_key') fields.pinSettingsKeyStage.querySelector<HTMLButtonElement>('[data-pin-settings-action="copy-key"]')?.focus()
    else if (step === 'agent') {
      const option = fields.pinSettingsAgentList.querySelector<HTMLInputElement>('input:not(:disabled)')
      if (option) option.focus()
      else fields.pinSettingsSubmit.focus()
    }
    else fields.pinSettingsCodeInput.focus()
  }, 0)
}

function goBackPINSettingsStep() {
  if (state.pinSettingsBusy || state.agentMcpBusy) return
  const setup = state.pinSettingsMode === 'setup'
  if (setup && state.pinSettingsSetupStep === 'agent') {
    advancePINSettingsStep('account_key')
    return
  }
  if (state.pinSettingsSetupStep === 'confirmation') {
    advancePINSettingsStep('entry')
    return
  }
  if (!setup && state.pinSettingsSetupStep === 'entry') {
    state.pinSettingsCurrentValue = ''
    advancePINSettingsStep('current')
    return
  }
  closePINSettingsModal()
}

async function copyPINSetupAccountKey() {
  if (!state.pinSettingsAccountKeyValue) return
  await writeClipboardText(state.pinSettingsAccountKeyValue)
  showToast('Account key copied.')
}

let walletStatusRequest: Promise<string> | undefined

function refreshWalletStatus() {
  if (walletStatusRequest) return walletStatusRequest
  const accountRevision = accountContextRevision
  const request = (async () => {
    const wallet = await invoke<{ wallet?: WalletStatus }>('wallet_status').catch((error) => ({ error: humanizeError(error) }))
    if (accountRevision !== accountContextRevision) return ''
    if ('wallet' in wallet) {
      state.walletStatus = wallet.wallet || {}
      if (state.walletModalOpen) renderWalletStatus()
      return ''
    }
    return 'error' in wallet ? wallet.error : 'Wallet status unavailable.'
  })()
  walletStatusRequest = request
  void request.then(
    () => { if (walletStatusRequest === request) walletStatusRequest = undefined },
    () => { if (walletStatusRequest === request) walletStatusRequest = undefined },
  )
  return request
}

function selectOrderSide(side: OrderSide) {
  if (state.workOrderSide === side) return
  const hadActivityDetail = Boolean(state.selectedV3ActivitySessionId)
  state.workOrderSide = side
  state.selectedV3ActivitySessionId = undefined
  state.v3ActivityDetail = undefined
  state.v3ActivityDetailError = undefined
  state.v3ActivityDetailLoading = false
  scheduleSaveAppSettings()
  renderLedger()
  void loadV3ActivitySessions(side)
  if (hadActivityDetail) renderDecisionPanel()
}


app.querySelectorAll<HTMLButtonElement>('[data-order-side-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    const side = button.dataset.orderSideTab as OrderSide
    if (side === 'buyer' || side === 'seller') selectOrderSide(side)
  })
})

app.querySelectorAll<HTMLButtonElement>('[data-window-action]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.windowAction === 'minimize') {
      invoke('window_minimize').catch((error) => showToast(humanizeError(error)))
    } else if (button.dataset.windowAction === 'maximize') {
      invoke('window_toggle_maximize').catch((error) => showToast(humanizeError(error)))
    } else if (button.dataset.windowAction === 'close') {
      invoke('window_close').catch((error) => showToast(humanizeError(error)))
    }
  })
})

app.querySelector<HTMLButtonElement>('[data-sidebar-action="search"]')!.addEventListener('click', openOrderSearch)

fields.profileIdentity.addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
  toggleProfileMenu()
})

fields.profileMenu.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const choice = target.closest<HTMLButtonElement>('[data-profile-choice]')
  if (choice) {
    event.preventDefault()
    event.stopPropagation()
    const kind = choice.dataset.profileChoice as ProfileSubmenu | undefined
    const value = choice.dataset.profileValue
    if (kind === 'language' && (value === 'en' || value === 'zh')) setLanguage(value)
    if (kind === 'theme' && (value === 'light' || value === 'dark')) setTheme(value)
    return
  }
  const button = target.closest<HTMLButtonElement>('[data-profile-action]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  const action = button.dataset.profileAction
  if (action === 'sign-out') signOutProfile()
  if (action === 'change-pin') {
    closeProfileMenu()
    openPINSettingsModal()
  }
})

fields.profileMenu.addEventListener('pointerover', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const submenu = target.closest<HTMLElement>('[data-profile-submenu]')?.dataset.profileSubmenu
  if (submenu === 'language' || submenu === 'theme') {
    openProfileSubmenu(submenu)
    return
  }
  if (target.closest('[data-profile-action="sign-out"]')) clearProfileSubmenu()
})

fields.profileMenu.addEventListener('focusin', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const submenu = target.closest<HTMLElement>('[data-profile-submenu]')?.dataset.profileSubmenu
  if (submenu === 'language' || submenu === 'theme') openProfileSubmenu(submenu)
})

fields.orderSearchInput.addEventListener('input', renderOrderSearchResults)
fields.orderSearchInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  const result = fields.orderSearchResults.querySelector<HTMLButtonElement>('[data-order-search-session]')
  if (!result) return
  event.preventDefault()
  openOrderSearchResult(result.dataset.orderSearchSession || '')
})

fields.orderSearchModal.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const result = target.closest<HTMLButtonElement>('[data-order-search-session]')
  if (result) {
    event.preventDefault()
    openOrderSearchResult(result.dataset.orderSearchSession || '')
    return
  }
  if (target.closest('[data-action="close-order-search"]')) {
    event.preventDefault()
    closeOrderSearch()
  }
})

fields.walletModal.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('[data-action="close-wallet"]')) {
    event.preventDefault()
    event.stopPropagation()
    closeWalletModal()
  }
})

fields.settingsButton.addEventListener('click', () => {
  if (state.settingsOpen) returnFromSettings()
  else openSettings()
})

fields.settingsReturnButton.addEventListener('click', returnFromSettings)

fields.settingsView.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const segment = target.closest<HTMLButtonElement>('[data-setting-segment]')
  if (segment) {
    event.preventDefault()
    applySettingsSegment(segment.dataset.settingSegment || '', segment.dataset.settingValue || '')
    return
  }
  if (target.closest('[data-settings-action="close"]')) {
    event.preventDefault()
    returnFromSettings()
    return
  }
  const button = target.closest<HTMLButtonElement>('[data-settings-action]')
  if (!button) return
  event.preventDefault()
  void handleSettingsAction(button.dataset.settingsAction || '', button)
})

fields.settingsView.addEventListener('change', (event) => {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.matches('[data-setting-switch]')) return
  applySettingsSwitch(input.dataset.settingSwitch || '', input.checked)
})

function scheduleAgentPermissionSave() {
  const scopes = Array.from(document.querySelectorAll<HTMLInputElement>('[data-agent-session-scope]:checked')).map((input) => input.dataset.agentSessionScope || '').filter(Boolean)
  state.agentSessionPolicy = {
    scopes,
    idleSeconds: state.agentSessionPolicy?.idleSeconds || 1800,
    maxLifetimeSeconds: state.agentSessionPolicy?.maxLifetimeSeconds || 86400,
  }
  if (!hasDesktopBridge()) return
  if (agentPermissionSaveTimer !== undefined) window.clearTimeout(agentPermissionSaveTimer)
  agentPermissionSaveTimer = window.setTimeout(async () => {
    agentPermissionSaveTimer = undefined
    try {
      state.agentSessionPolicy = await invoke<AgentSessionPolicy>('agent_session_policy_save', { input: { scopes } })
    } catch (error) {
      showToast(humanizeError(error))
      await refreshSettingsStatus()
    }
  }, 180)
}

function applySettingsSegment(key: string, value: string) {
  if (key === 'language' && isAppLanguage(value)) {
    setLanguage(value)
    scheduleSaveAppSettings(0)
    return
  }
  if (key.startsWith('agentSessionScope.') && (value === 'off' || value === 'on')) {
    const scope = key.slice('agentSessionScope.'.length)
    const input = Array.from(document.querySelectorAll<HTMLInputElement>('[data-agent-session-scope]')).find((candidate) => candidate.dataset.agentSessionScope === scope)
    if (!input) return
    input.checked = value === 'on'
    input.closest('.agent-session-scope-control')?.querySelectorAll<HTMLButtonElement>('[data-setting-segment]').forEach((button) => {
      const active = button.dataset.settingValue === value
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    })
    scheduleAgentPermissionSave()
    return
  }
  if ((key.startsWith('notification.') || key === 'launchAtLogin' || key === 'startMinimized') && (value === 'off' || value === 'on')) {
    applySettingsSwitch(key, value === 'on')
    return
  }
  if (key === 'theme' && isAppTheme(value)) setTheme(value)
  else if (key === 'closeBehavior' && (value === 'tray' || value === 'quit')) state.closeBehavior = value
  else return
  scheduleSaveAppSettings(0)
  renderSettingsPanel()
}

function applySettingsSwitch(key: string, checked: boolean) {
  if (key.startsWith('notification.')) {
    const notificationKey = key.slice('notification.'.length) as NotificationPreferenceKey
    if (!Object.hasOwn(state.notifications, notificationKey)) return
    state.notifications[notificationKey] = checked
  } else if (key === 'launchAtLogin') state.launchAtLogin = checked
  else if (key === 'startMinimized') state.startMinimized = checked
  else return
  scheduleSaveAppSettings(0)
  renderSettingsPanel()
}

async function handleSettingsAction(action: string, button: HTMLButtonElement) {
  if (button.disabled) return
  const invokeAction = async <T = unknown>(command: string, payload?: Record<string, unknown>) => {
    button.disabled = true
    try { return await invoke<T>(command, payload) } finally { button.disabled = false }
  }
  try {
    if (action === 'refresh-status') return void refreshSettingsStatus()
    if (action === 'agent-client-refresh') return void refreshSettingsStatus()
    if (action === 'agent-client-connect') {
      const clientId = button.dataset.agentClientId as AgentMcpClientId
      const instanceId = button.dataset.agentInstanceId || clientId
      const result = await invokeAction<{ clients?: Array<{ ok?: boolean; message?: string }> }>('agent_mcp_register', { input: { instanceIds: [instanceId] } })
      const client = result.clients?.[0]
      showToast(client?.ok === false ? (client.message || sx('Client registration failed.', '客户端注册失败。')) : sx('Agent client connected. Restart it if it is currently open.', 'Agent 客户端已连接；如果当前正在运行，请重启。'))
      await refreshSettingsStatus()
      return
    }
    if (action === 'agent-client-repair') {
      const clientId = button.dataset.agentClientId as AgentMcpClientId
      const instanceId = button.dataset.agentInstanceId || ''
      if (!await requestSimpleAppConfirmation(sx('The current configuration will be backed up before repair.', '当前配置会在修复前先备份。'), { eyebrow: 'Agent client', title: 'Repair Exora Dock registration?', impact: 'The Agent client may need to restart after repair.', confirmLabel: 'Repair', tone: 'primary' })) return
      const result = await invokeAction<{ ok?: boolean; message?: string }>('agent_mcp_repair', { input: { clientId, instanceId } })
      showToast(result.ok === false ? (result.message || sx('Repair failed.', '修复失败。')) : sx('Registration repaired. Restart the Agent client to reload it.', '注册已修复，请重启 Agent 客户端。'))
      await refreshSettingsStatus()
      return
    }
    if (action === 'agent-client-remove') {
      const clientId = button.dataset.agentClientId as AgentMcpClientId
      const instanceId = button.dataset.agentInstanceId || ''
      const selected = state.agentMcpClients.find((client) => client.clientId === clientId && client.instanceId === instanceId)
      const shared = Number(selected?.sharedTargetCount || 0) > 1
      const question = shared
        ? sx(`This configuration is shared by ${selected?.sharedTargetCount} installations. Remove Exora Dock from all of them?`, `该配置由 ${selected?.sharedTargetCount} 个安装实例共享。要从它们中全部删除 Exora Dock 吗？`)
        : sx('Remove only the Exora Dock MCP registration from this client?', '仅从该客户端删除 Exora Dock MCP 注册吗？')
      if (!await requestSimpleAppConfirmation(question, { eyebrow: 'Agent client', title: 'Remove Exora Dock registration?', impact: shared ? 'The shared registration will be removed from every linked installation.' : 'Only the selected client registration will be removed.', confirmLabel: 'Remove', tone: 'danger' })) return
      const result = await invokeAction<{ ok?: boolean; message?: string }>('agent_mcp_remove', { input: { clientId, instanceId } })
      showToast(result.ok === false ? (result.message || sx('Removal failed.', '删除失败。')) : sx('Exora Dock registration removed.', 'Exora Dock 注册已删除。'))
      await refreshSettingsStatus()
      return
    }
    if (action === 'agent-client-probe') {
      const result = await invokeAction<{ ok?: boolean }>('agent_mcp_probe')
      showToast(result.ok ? sx('MCP handshake succeeded.', 'MCP 握手成功。') : sx('MCP handshake failed.', 'MCP 握手失败。'))
      return
    }
    if (action === 'change-pin') { openPINSettingsModal(); return }
    if (action === 'reset-pin') {
      returnFromSettings()
      authGate.openPINReset()
      return
    }
    if (action === 'change-password') {
      returnFromSettings()
      authGate.openPasswordReset()
      return
    }
    if (action === 'account-key-ensure') {
      const result = await invokeAction<{ token?: string; dockSyncPending?: boolean }>('account_api_key_ensure')
      if (result.token) await revealAccountKey(result.token)
      if (result.dockSyncPending) showToast(sx('Account key created. Dock synchronization is pending; start or update Dock to retry.', '账户密钥已创建。本地 Dock 同步待完成；启动或更新 Dock 后将重试。'))
      await refreshSettingsStatus()
      return
    }
    if (action === 'account-key-import') {
      const key = (await requestAppInput({ eyebrow: 'Account security', title: 'Import account key', detail: 'Encrypted local storage', message: sx('Paste your existing sk-exora account key. It will be encrypted in the operating system vault.', '粘贴已有的 sk-exora 账户密钥。它会被加密保存到系统凭据库。'), label: 'Account key', confirmLabel: 'Import key', type: 'password', placeholder: 'sk-exora…' }))?.trim()
      if (!key) return
      await invokeAction('account_api_key_import', { input: { key } })
      await refreshSettingsStatus()
      return
    }
    if (action === 'account-key-rotate' || action === 'account-key-revoke') {
      const pin = (await requestAppInput({ eyebrow: 'Payment security', title: 'Enter Payment PIN', detail: 'Trusted Desktop input', message: sx('Enter your six-digit Payment PIN in this trusted Desktop window.', '请在此可信 Desktop 窗口中输入六位支付 PIN。'), label: 'Six-digit PIN', confirmLabel: 'Continue', type: 'password', inputMode: 'numeric', placeholder: '••••••' }))?.trim()
      if (!pin) return
      if (action === 'account-key-revoke' && !await requestSimpleAppConfirmation(sx('All clients using the current key will stop immediately.', '所有使用当前密钥的客户端都会立即停止工作。'), { eyebrow: 'Account security', title: 'Revoke current account key?', impact: 'This key cannot be restored after revocation.', confirmLabel: 'Revoke key', tone: 'danger' })) return
      const result = await invokeAction<{ token?: string }>(action === 'account-key-rotate' ? 'account_api_key_rotate' : 'account_api_key_revoke', { input: { pin } })
      if (result.token) await revealAccountKey(result.token, 'New account key')
      await refreshSettingsStatus()
      return
    }
    if (action === 'sign-out') {
      if (await requestSimpleAppConfirmation(sx('Your local session will end on this device.', '此设备上的本地会话将结束。'), { eyebrow: 'Account', title: 'Sign out of Exora Cloud?', impact: 'Local Agent access remains unavailable until you sign in again.', confirmLabel: 'Sign out', tone: 'primary' })) signOutProfile()
      return
    }
    if (action === 'delete-account') {
      if (await requestSimpleAppConfirmation(sx('Account deletion is permanent. Continue to the support review notice?', '删除账户不可撤销。是否继续查看支持审核说明？'), { eyebrow: 'Account', title: 'Review account deletion?', impact: 'No account is deleted until the support review is completed.', confirmLabel: 'Continue', tone: 'danger' })) {
        showToast(sx('Self-service deletion is not enabled. Contact Exora Cloud support for a reviewed deletion request.', '暂未开放自助删除。请联系 Exora Cloud 支持提交审核删除申请。'))
      }
      return
    }
    if (action === 'open-agent-limit') { returnFromSettings(); openWalletModal('agent-limit'); return }
    if (action === 'copy-config') {
      const command = button.dataset.settingsCommand || 'copy_mcp_command'
      const value = await invokeAction<string>(command)
      await writeClipboardText(String(value || ''))
      showToast(sx('Configuration copied.', '配置已复制。'))
      return
    }
    if (action === 'test-connection') {
      const result = await invokeAction<{ ok?: boolean; categories?: Array<{ applicationSource?: string; ok?: boolean }> }>('mcp_connectivity_test')
      const runtime = await invokeAction<AppStatus>('app_status')
      state.appStatus = runtime
      if (state.settingsSystemStatus) state.settingsSystemStatus.runtime = runtime
      const connected = Array.isArray(result.categories) && result.categories.length === 4 && result.categories.every((category) => category.ok)
      showToast(connected ? sx('MCP and the API marketplace are connected.', 'MCP 与 API 市场均已连通。') : sx('MCP connectivity is incomplete.', 'MCP 连通性不完整。'))
      renderSettingsPanel()
      return
    }
    const openKinds: Record<string, string> = { 'open-manifest': 'manifest', 'open-data': 'data', 'open-logs': 'logs', 'open-downloads': 'downloads' }
    if (openKinds[action]) { await invokeAction('system_open_path', { input: { kind: openKinds[action] } }); return }
    if (action === 'choose-downloads') {
      const result = await invokeAction<{ canceled?: boolean; path?: string }>('system_choose_download_directory')
      if (!result.canceled && result.path) {
        state.downloadDirectory = result.path
        scheduleSaveAppSettings(0)
        await refreshSettingsStatus()
      }
      return
    }
    const clearKinds: Record<string, string> = { 'clear-cache': 'cache', 'clear-logs': 'logs', 'clear-temporary': 'temporary' }
    if (clearKinds[action]) {
      if (!await requestSimpleAppConfirmation(sx('The selected disposable local data will be removed now.', '所选的可丢弃本地数据将立即被清理。'), { eyebrow: 'Storage', title: 'Clear local data?', impact: 'Cleared cache, logs, or temporary files cannot be restored.', confirmLabel: 'Clear data', tone: 'danger' })) return
      await invokeAction('system_clear_storage', { input: { kind: clearKinds[action] } })
      showToast(sx('Local data cleared.', '本地数据已清理。'))
      await refreshSettingsStatus()
      return
    }
    if (action === 'test-notification') {
      await invokeAction('system_notification_test', { input: { language: state.language } })
      showToast(sx('Test notification sent.', '测试通知已发送。'))
      return
    }
    if (action === 'check-update') {
      const update = await invokeAction<NonNullable<DesktopSystemStatus['update']>>('system_update_check')
      if (state.settingsSystemStatus) state.settingsSystemStatus.update = update
      showToast(settingsUpdateMessage(update))
      renderSettingsPanel()
      return
    }
    if (action === 'install-update') {
      const activeWork = hasActiveSettingsWork()
      if (activeWork) {
        showToast(sx('Finish active purchases, downloads, leases, and provider tasks before installing.', '请先完成正在进行的购买、下载、租约与卖家任务，再安装更新。'))
        return
      }
      if (!await requestSimpleAppConfirmation(sx('Exora Dock will restart to install the downloaded update.', 'Exora Dock 将重启并安装已经下载的更新。'), { eyebrow: 'Software update', title: 'Install update now?', impact: 'The application will close briefly during installation.', confirmLabel: 'Restart and install', tone: 'primary' })) return
      await invokeAction('system_update_install', { input: { activeWork } })
      return
    }
  } catch (error) {
    showToast(humanizeError(error))
  }
}

function hasActiveSettingsWork() {
  const activeActivity = [...state.v3ActivitySessions.buyer, ...state.v3ActivitySessions.seller]
    .some((session) => session.status === 'active' || Number(session.inFlightCount || 0) > 0)
  return activeActivity || state.v3ListingsLoading || state.walletWithdrawalBusy
}

fields.appConfirmModal.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const action = target.closest<HTMLElement>('[data-app-confirm-action]')?.dataset.appConfirmAction
  if (!action) return
  event.preventDefault()
  closeAppConfirmation(action === 'confirm')
})

fields.appInputModal.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const action = target.closest<HTMLElement>('[data-app-input-action]')?.dataset.appInputAction
  if (!action) return
  event.preventDefault()
  closeAppInput(action === 'confirm')
})

fields.appInputField.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  closeAppInput(true)
})

fields.pinSettingsModal.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('[data-pin-settings-action="close"]')) {
    event.preventDefault()
    closePINSettingsModal()
  } else if (target.closest('[data-pin-settings-action="back"]')) {
    event.preventDefault()
    goBackPINSettingsStep()
  } else if (target.closest('[data-pin-settings-action="copy-key"]')) {
    event.preventDefault()
    void copyPINSetupAccountKey()
  } else if (target.closest('[data-pin-settings-action="skip-agent"]')) {
    event.preventDefault()
    completeAgentMcpOnboarding()
  }
})

fields.pinSettingsAgentList.addEventListener('change', (event) => {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.dataset.agentMcpInstance) return
  const instanceId = input.dataset.agentMcpInstance
  state.agentMcpSelected = input.checked
    ? Array.from(new Set([...state.agentMcpSelected, instanceId]))
    : state.agentMcpSelected.filter((value) => value !== instanceId)
  renderPINSettingsModal()
})

fields.mcpInfoModal.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const action = target.closest<HTMLElement>('[data-mcp-info-action]')?.dataset.mcpInfoAction
  if (action === 'close') {
    event.preventDefault()
    closeMCPInfoModal()
  } else if (action === 'copy') {
    event.preventDefault()
    copyMCPAgentInstruction()
  }
})

document.addEventListener('pointerdown', (event) => {
  if (event.target instanceof Element && event.target.closest('.v3-order-context-menu')) return
  closeV3OrderContextMenu()
})

window.addEventListener('blur', closeV3OrderContextMenu)
window.addEventListener('resize', closeV3OrderContextMenu)

fields.pinSettingsForm.addEventListener('input', (event) => {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  input.value = input.value.replace(/\D/g, '').slice(0, 6)
  if (input === fields.pinSettingsCodeInput) renderPINSettingsCodeInput()
})

fields.pinSettingsCodeInput.addEventListener('focus', renderPINSettingsCodeInput)
fields.pinSettingsCodeInput.addEventListener('blur', renderPINSettingsCodeInput)

fields.pinSettingsForm.addEventListener('submit', (event) => {
  event.preventDefault()
  void submitPINSettings()
})

app.addEventListener('click', (event) => {
  const target = event.target
  if (target instanceof Element) {
    const sellerStoreAction = target.closest<HTMLButtonElement>('[data-seller-store-action]')
    if (sellerStoreAction) {
      event.preventDefault()
      event.stopPropagation()
      const action = sellerStoreAction.dataset.sellerStoreAction
      if (action === 'api') state.v3SellerTab = 'cloud_api'
      if (action === 'seller') state.v3SellerTab = 'buyer'
      if (action === 'card') state.v3SellerTab = 'buyer'
      selectOrderSide('seller')
      return
    }
  }
  if (state.profileMenuOpen && !(target instanceof Element && target.closest('.profile-panel'))) closeProfileMenu()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (v3OrderContextMenu) {
      closeV3OrderContextMenu()
      return
    }
    if (!fields.appInputModal.classList.contains('hidden')) {
      closeAppInput(false)
      return
    }
    if (!fields.appConfirmModal.classList.contains('hidden')) {
      closeAppConfirmation(false)
      return
    }
    if (providerIdentityEditorOpenAPIId) {
      providerIdentityEditorOpenAPIId = ''
      renderDecisionPanel()
      return
    }
    if (providerContractEditorOpenKey) {
      providerContractEditorOpenKey = ''
      renderDecisionPanel()
      return
    }
    if (providerContractGuideOpenAPIId) {
      providerContractGuideOpenAPIId = ''
      renderDecisionPanel()
      return
    }
    if (providerPricingBookOpenKey) {
      const key = providerPricingBookOpenKey
      providerPricingBookOpenKey = ''
      providerOperationViews[key] = 'billing'
      renderDecisionPanel()
      return
    }
    closeProfileMenu()
    if (state.agentMcpOnboardingOpen && !state.agentMcpBusy) {
      completeAgentMcpOnboarding()
      return
    }
    if (state.mcpInfoModalOpen) {
      closeMCPInfoModal()
      return
    }
    closeOrderSearch()
    closeWalletModal()
    if (state.pinSettingsModalOpen) closePINSettingsModal()
    else if (state.settingsOpen) returnFromSettings()
  }
})

fields.sidebarResizeHandle.addEventListener('pointerdown', (event) => {
  if (state.sidebarCollapsed || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  sidebarResizePointerId = event.pointerId
  fields.appShell.classList.add('sidebar-resizing')
  fields.sidebarResizeHandle.setPointerCapture(event.pointerId)
  updateSidebarWidthFromPointer(event)
})

fields.sidebarResizeHandle.addEventListener('pointermove', (event) => {
  if (sidebarResizePointerId !== event.pointerId) return
  event.preventDefault()
  updateSidebarWidthFromPointer(event)
})

fields.sidebarResizeHandle.addEventListener('pointerup', stopSidebarResize)
fields.sidebarResizeHandle.addEventListener('pointercancel', stopSidebarResize)

fields.sidebarResizeHandle.addEventListener('lostpointercapture', () => {
  if (sidebarResizePointerId === undefined) return
  sidebarResizePointerId = undefined
  fields.appShell.classList.remove('sidebar-resizing')
  scheduleSaveAppSettings()
})

fields.sidebarResizeHandle.addEventListener('keydown', (event) => {
  if (state.sidebarCollapsed) return
  const step = event.shiftKey ? 24 : 12
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    state.sidebarWidth = normalizeSidebarWidth(state.sidebarWidth - step)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    state.sidebarWidth = normalizeSidebarWidth(state.sidebarWidth + step)
  } else if (event.key === 'Home') {
    event.preventDefault()
    state.sidebarWidth = SIDEBAR_MIN_WIDTH
  } else if (event.key === 'End') {
    event.preventDefault()
    state.sidebarWidth = SIDEBAR_MAX_WIDTH
  } else {
    return
  }
  applySidebarWidth()
  scheduleSaveAppSettings()
})

fields.sidebarButton.addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
  closeProfileMenu()
  setSidebarCollapsed(!state.sidebarCollapsed)
})

function paymentPINRequiredForElement(target: Element, submitter?: HTMLElement | null) {
  if (target.closest('[data-pin-settings-modal]')) return false
  if (target.closest('[data-action="open-wallet"], [data-settings-action="change-pin"], [data-profile-action="change-pin"]')) return true
  if (target.closest('[data-wallet-withdraw-form], [data-wallet-limit-form], [data-wallet-tab="withdraw"], [data-wallet-tab="agent-limit"]')) return true
  const approvalForm = target.closest<HTMLFormElement>('[data-v3-approval-form]')
  if (approvalForm) {
    const decision = submitter?.getAttribute('value') || target.closest<HTMLButtonElement>('button')?.value
    return decision !== 'reject'
  }
  return Boolean(target.closest('[data-pin-form]'))
}

function reopenPINSetupForPayment(event: Event) {
  if (state.cloudPaymentPINConfigured !== false || state.pinSettingsModalOpen) return
  const target = event.target
  if (!(target instanceof Element)) return
  const submitter = event instanceof SubmitEvent ? event.submitter as HTMLElement | null : undefined
  if (!paymentPINRequiredForElement(target, submitter)) return
  event.preventDefault()
  event.stopImmediatePropagation()
  openPINSetupModal()
}

app.addEventListener('click', reopenPINSetupForPayment, true)
app.addEventListener('submit', reopenPINSetupForPayment, true)

fields.walletButton.addEventListener('click', () => {
  if (state.walletModalOpen) closeWalletModal()
  else openWalletModal()
})

fields.walletPanelTabs.forEach((button, index) => {
  button.addEventListener('click', () => selectWalletPanel(button.dataset.walletTab as WalletPanel))
  button.addEventListener('keydown', (event) => {
    let nextIndex = index
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % fields.walletPanelTabs.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + fields.walletPanelTabs.length) % fields.walletPanelTabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = fields.walletPanelTabs.length - 1
    else return
    event.preventDefault()
    selectWalletPanel(fields.walletPanelTabs[nextIndex].dataset.walletTab as WalletPanel, true)
  })
})

app.querySelector<HTMLButtonElement>('[data-action="wallet-refresh"]')!.addEventListener('click', () => {
  void refreshWalletModalStatus()
})

fields.walletCodeControls.forEach((control) => {
  const input = control.querySelector<HTMLInputElement>('input')
  if (!input) return
  input.addEventListener('input', renderWalletCodeInputs)
  input.addEventListener('focus', renderWalletCodeInputs)
  input.addEventListener('blur', renderWalletCodeInputs)
})

fields.walletWithdrawStatus.addEventListener('click', (event) => {
	if (!(event.target as HTMLElement).closest('[data-wallet-resend-code]')) return
	void run(resendWalletWithdrawalCode)
})

let lastWalletFundsPoll = 0
window.setInterval(() => {
	if (!state.walletModalOpen) return
	if (state.walletWithdrawalChallenge) renderWalletWithdrawalStatus()
	const terminalWithdrawals = new Set(['finalized', 'rejected', 'failed'])
	const terminalDeposits = new Set(['credited', 'swept', 'failed'])
	const hasPendingFunds = (state.walletStatus?.withdrawals || []).some((item) => !terminalWithdrawals.has(String(item.status || '')))
		|| (state.walletStatus?.deposits || []).some((item) => !terminalDeposits.has(String(item.status || '')))
	if (!hasPendingFunds || state.walletWithdrawalBusy || Date.now() - lastWalletFundsPoll < 5_000) return
	lastWalletFundsPoll = Date.now()
	void refreshWalletStatus()
}, 1_000)

window.addEventListener('focus', () => {
  void autoRefreshV3Listings(true)
  if (!state.signedOut) {
    void loadV3ActivitySessions('buyer', true)
    void loadV3ActivitySessions('seller', true)
  }
})

fields.agentMcpOnboarding.addEventListener('change', (event) => {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.dataset.agentMcpInstance) return
  const instanceId = input.dataset.agentMcpInstance
  state.agentMcpSelected = input.checked
    ? Array.from(new Set([...state.agentMcpSelected, instanceId]))
    : state.agentMcpSelected.filter((value) => value !== instanceId)
  renderAgentMcpOnboarding()
})

fields.agentMcpOnboarding.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const action = target.closest<HTMLElement>('[data-agent-mcp-action]')?.dataset.agentMcpAction
  if (action === 'later' && !state.agentMcpBusy) {
    event.preventDefault()
    completeAgentMcpOnboarding()
  } else if (action === 'connect') {
    event.preventDefault()
    void connectSelectedAgentMcpClients()
  }
})

window.setInterval(() => {
  void autoRefreshV3Listings()
}, 15_000)

window.setInterval(() => {
  if (state.signedOut || document.visibilityState !== 'visible') return
  void loadV3ActivitySessions('buyer', true)
  void loadV3ActivitySessions('seller', true)
}, 15_000)

app.querySelector<HTMLButtonElement>('[data-action="wallet-withdraw-max"]')!.addEventListener('click', () => {
  const balance = walletUSDCBalance()
  const amountInput = fields.walletWithdrawForm.querySelector<HTMLInputElement>('input[name="amount"]')!
  amountInput.value = walletAtomicInput(Number(balance?.amountAtomic || 0), walletUSDCDecimals())
  amountInput.focus()
})

fields.walletWithdrawForm.addEventListener('submit', (event) => {
  event.preventDefault()
  void run(() => submitWalletWithdrawal(fields.walletWithdrawForm))
})

fields.walletLimitEnabled.addEventListener('change', () => {
  state.walletSpendError = undefined
  syncWalletSpendFormDisabled()
  renderWalletCodeInputs()
})

fields.walletLimitForm.addEventListener('submit', (event) => {
  event.preventDefault()
  void submitWalletSpendPolicy().catch((error) => {
    state.walletSpendError = humanizeError(error)
    renderWalletSpendPolicy()
  })
})

fields.walletHistoryFilters.forEach((button) => {
  button.addEventListener('click', () => {
    state.walletHistoryFilter = button.dataset.walletHistoryFilter as WalletHistoryFilter
    renderWalletHistory()
  })
})

app.querySelector<HTMLButtonElement>('[data-action="wallet-copy-address"]')!.addEventListener('click', () => {
  run(async () => {
    const address = state.walletStatus?.address
    if (!address) throw new Error('Wallet address is not configured.')
    await writeClipboardText(address)
  }, t('toast.walletAddressCopied'))
})

let workspaceBootstrapped = false
let workspaceBootPromise: Promise<void> | undefined
let requestedWindowMode: 'auth' | 'workspace' | undefined
let windowModeTransition: Promise<void> | undefined

async function requestWindowMode(mode: 'auth' | 'workspace') {
  if (requestedWindowMode === mode) {
    await windowModeTransition
    return
  }
  requestedWindowMode = mode
  const transition = invoke('window_set_mode', { mode }).then(() => undefined).catch((error) => {
    requestedWindowMode = undefined
    throw error
  }).finally(() => {
    if (windowModeTransition === transition) windowModeTransition = undefined
  })
  windowModeTransition = transition
  await transition
}

function resetWorkspaceLanding() {
  state.v3SellerTab = 'buyer'
  state.v3ListingMode = 'buyer'
  state.v3SelectedProduct = undefined
  state.v3SelectedCatalogListingId = undefined
  state.v3ExpandedListingId = undefined
  state.selectedV3ActivitySessionId = undefined
  state.v3ActivityDetail = undefined
  state.v3ActivityDetailError = undefined
  state.v3ActivityDetailLoading = false
  state.mcpInfoModalOpen = false
}

function resetAccountActivityState() {
  activityAccountRevision += 1
  state.v3APIOrder = undefined
  state.v3APIOrderBusy = false
  state.v3ApprovalBusyId = undefined
  state.v3ActivitySessions = { buyer: [], seller: [] }
  state.v3ActivityLoaded = { buyer: false, seller: false }
  state.v3ActivityLoading = { buyer: false, seller: false }
  state.v3ActivityErrors = {}
  state.v3ActivityBucket = { buyer: 'current', seller: 'current' }
  state.v3ActivityArchiveUndo = undefined
  state.selectedV3ActivitySessionId = undefined
  state.v3ActivityDetail = undefined
  state.v3ActivityDetailLoading = false
  state.v3ActivityDetailError = undefined
}

function resetAccountState() {
  accountContextRevision += 1
  resetAccountActivityState()
  walletStatusRequest = undefined
  walletModalRefreshRequest = undefined
  v3LifecycleRefreshPromise = undefined
  lastV3LifecycleRefreshAt = 0
  state.walletModalOpen = false
  state.walletStatus = undefined
  state.walletWithdrawal = undefined
  state.walletWithdrawalChallenge = undefined
  state.walletWithdrawalBusy = false
  state.walletWithdrawalError = undefined
  state.walletSpendBusy = false
  state.walletSpendError = undefined
  state.accountAPIKeyStatus = undefined
  state.agentSessionPolicy = undefined
  state.settingsStatusLoading = false
  state.settingsStatusError = undefined
  state.settingsOpen = false
  state.v3Listings = []
  state.v3ListingApplications = []
  state.v3ListingsLoading = false
  state.v3ListingsLoaded = false
  state.v3SellerError = undefined
  state.v3HighlightedListingId = undefined
  state.v3ExpandedListingId = undefined
  providerIntegrationsRevision += 1
  providerIntegrations = []
  providerIntegrationsLoaded = false
  providerIntegrationsLoading = false
  providerIntegrationsError = ''
  providerPricingBookOpenKey = ''
  providerContractGuideOpenAPIId = ''
  providerContractEditorOpenKey = ''
  providerIdentityEditorOpenAPIId = ''
  providerIntegrationEditKeys.clear()
  providerPricingEditKeys.clear()
  for (const key of Object.keys(providerOperationViews)) delete providerOperationViews[key]
  for (const key of Object.keys(providerPricingDrafts)) delete providerPricingDrafts[key]
  window.clearTimeout(providerConsolePollTimer)
  providerConsolePollTimer = 0
}

function waitForWorkspacePaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  })
}

async function openWorkspace(authState?: CloudAuthState) {
  const previousAccountID = state.authAccount?.accountId
  const nextAccountID = authState?.account?.accountId
  if (nextAccountID && nextAccountID !== previousAccountID) resetAccountState()
  if (authState) {
    state.authAccount = authState.account
    state.cloudAuthState = authState
    state.signedOut = false
    if (authState.phase === 'needs_pin') state.cloudPaymentPINConfigured = false
    else if (authState.phase === 'authenticated') state.cloudPaymentPINConfigured = true
  }
  resetWorkspaceLanding()
  await bootstrapWorkspace()
  renderAll()
  if (nextAccountID) {
    void refreshWalletStatus()
    void loadV3ActivitySessions('buyer', true)
    void loadV3ActivitySessions('seller', true)
  }
  await requestWindowMode('workspace')
  await waitForWorkspacePaint()
  if (authState?.phase === 'needs_pin') openPINSetupModal()
  else if (authState?.phase === 'authenticated') void maybeOpenAgentMcpOnboarding()
}

const authGate = createAuthGate(app, {
  invoke,
  language: () => state.language,
  setLanguage,
  onVisibilityChange: (visible) => {
    authPresentationActive = visible
    applyUserPreferences()
  },
  onAuthenticated: async (authState) => {
    await openWorkspace(authState)
  },
  onSignedOut: (authState) => {
    void requestWindowMode('auth').catch((error) => console.warn('Failed to restore the authentication window:', error))
    resetAccountState()
    state.authAccount = undefined
    state.cloudAuthState = authState
    state.signedOut = true
    state.cloudPaymentPINConfigured = undefined
    state.profileMenuOpen = false
    dismissPINSettingsModal()
    renderProfileSummary()
  },
})

async function bootstrapWorkspace() {
  if (workspaceBootstrapped) return
  if (workspaceBootPromise) return workspaceBootPromise
  workspaceBootPromise = (async () => {
    await hydrateDesktopPersistence()
    applyUserPreferences()
    renderAll()
    workspaceBootstrapped = true
  })().catch((error) => {
    workspaceBootPromise = undefined
    workspaceBootstrapped = false
    throw error
  })
  return workspaceBootPromise
}

async function bootstrap() {
  clearRetiredRendererStorage()
  applyUserPreferences()
  window.exora?.onAuthStateChanged?.((payload) => {
    if (payload && typeof payload === 'object') void authGate.applyState(payload as CloudAuthState).catch(() => undefined)
  })
  await authGate.initialize()
}

function clearRetiredRendererStorage() {
  for (const key of [
    'exora.permissionMode',
    'exora.transactionDetailWidth',
    'exora.buyerAgentSettings',
    WORK_TASK_STATE_KEY,
  ]) localStorage.removeItem(key)
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index) || ''
    if (key.startsWith('exora.providerPreparationDraft.') || key.startsWith('exora.providerPricingDraft.')) localStorage.removeItem(key)
  }
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.theme === 'system') applyUserPreferences()
})

void bootstrap()
