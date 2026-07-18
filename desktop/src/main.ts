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
  Archive,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bell,
  BrainCircuit,
  Check,
  ChevronRight,
  Copy,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
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
  Wallet,
  WalletCards,
  X,
  type IconNode,
} from 'lucide'
import { toString as qrToString } from 'qrcode'
import {
  escapeHTML,
  humanizeError,
  type AppStatus,
} from './domain'
import './styles.css'
import './styles/v3-shell.css'
import './styles/v3-api.css'
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
type V3SellerTab = 'vm' | 'resources' | 'endpoint' | 'api_bridge' | 'listings'
type V3WizardStepState = 'locked' | 'available' | 'busy' | 'complete' | 'error'

type V3Product = {
  productId: string
  productKind: 'compute' | 'download' | 'api_operation' | string
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
  creationActor?: 'agent' | 'human' | string
  draftRunId?: string
  sourceFingerprint?: string
  mcpConnection?: string
  sellerPolicyReceipt?: { policyId: string; version: number; hash: string; approvedAt?: string }
}

type SellerAutomationPolicy = {
  policyId?: string
  version?: number
  enabled: boolean
  enabledKinds: string[]
  allowedRoots: Array<{ id: string; path: string; displayName?: string; kinds?: string[] }>
  allowedServices: Array<{ id: string; displayName?: string; mode: 'endpoint' | 'api_bridge'; baseUrl: string; credentialRef?: string }>
  defaults: Record<string, Record<string, unknown>>
  attestations: { pricing: boolean; rights: boolean; runtime: boolean; apiUsage: boolean }
  limits: { maxBatch: number; maxFiles: number; maxBundleBytes: number; maxConcurrentRuns: number }
  autoInstallImages?: boolean
  hash?: string
}
type SellerAutomationCredential = { credentialRef: string; label: string; authType: string; serviceIds?: string[]; apiKeyHeader?: string; updatedAt?: string }
type SellerDraftRunSummary = { runId: string; kind: string; status: string; progress: number; currentStep?: string; error?: string; missingFields?: string[]; result?: { listingId?: string; readyToPublish?: boolean }; updatedAt?: string }
type SellerAutomationStatus = { configured: boolean; policy?: SellerAutomationPolicy; credentials: SellerAutomationCredential[]; runs: SellerDraftRunSummary[] }

type V3ReadinessCheck = { id: string; label: string; ready: boolean; detail?: string }
type V3ListingApplication = {
  listing: V3Listing
  product: V3Product
  source: V3ApplicationSource | 'unclassified'
  readiness: { ready: boolean; checks: V3ReadinessCheck[] }
  runtime?: { tunnelOnline: boolean; endpointHealthy: boolean; lastSeenAt?: string; contractSha256?: string; error?: string }
  resourceItems?: V3CatalogResourceItem[]
  lifecycle: { listed: boolean; allowedActions: string[]; statusReason?: string }
}
type V3VMListingConstraint = { limit: number; used: number; available: boolean; listingId?: string; status?: string; deletedAt?: string }
type V3CatalogListing = {
  listing: V3Listing
  productManifest: V3Product
  availability?: Record<string, unknown>
  ownerMetadata?: { providerDockId?: string; isOwner?: boolean }
  resourceItems?: V3CatalogResourceItem[]
}
type V3CatalogResourceItem = { resourceItemId: string; productId: string; listingId: string; title: string; description: string; fileName: string; contentType?: string; license: string; tags?: string[]; price: Record<string, any>; grantHours: number; sizeBytes: number; sha256: string; status: string; version: number }
type V3APIOrder = { orderId: string; listingId: string; status: 'active' | 'inactive'; activatedAt?: string; deactivatedAt?: string; lastUsedAt?: string; createdAt?: string; updatedAt?: string }
type V3ConsumerBalance = { accountId?: string; asset: string; availableAtomic: number; reservedAtomic: number; pendingAtomic: number }
type V3LocalEndpoint = { endpointId: string; localBaseUrl: string; healthPath: string; contractSha256: string; lastProbeHealthy: boolean; lastProbeAt?: string; timeoutSeconds: number; concurrency: number }

type V3ActivitySession = {
  sessionId: string
  activitySessionId?: string
  role: OrderSide
  productKind: 'compute' | 'download' | 'api_operation' | string
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

type V3ResourceSource = { token: string; name: string; sizeBytes: number; sha256: string; title: string; description: string; price: number; tags: string[]; license: string; grantHours: number; status?: 'ready' | 'uploading' | 'verified' | 'failed' }
type V3ResourceArchive = { token: string; name: string; sizeBytes: number; sourceBytes: number; sourceCount: number; format: 'zip'; status?: 'ready' | 'uploading' | 'verified' | 'failed' }
type V3AssetProgress = { phase: 'selecting' | 'packaging' | 'complete' | 'uploading'; percent: number; completedFiles?: number; totalFiles?: number; inputBytes?: number; sourceBytes?: number; outputBytes?: number; completed?: number; total?: number }
type V3ResourceSelectName = 'license'
type V3ListingProject = 'vm' | 'resources' | 'api'
type V3EnvironmentImage = { imageId: string; version: string; status: string; signature?: string; cloudAvailable?: boolean; manifest: Record<string, any> }
type V3ImageProgress = { imageId: string; phase: string; bytesDownloaded?: number; sizeBytes?: number }
type V3HostScanProgress = { phase: string; percent: number; bytes?: number; samples?: number }
type V3UpstreamAuthType = 'none' | 'bearer' | 'basic' | 'api_key' | 'header_api_key' | 'query_api_key' | 'cookie_api_key' | 'oauth2_client_credentials' | 'mtls'
type V3APIPricingComponent = { dimension: 'request' | 'successful_request' | 'input_tokens' | 'output_tokens' | 'input_bytes' | 'output_bytes' | 'execution_second' | 'image' | 'provider_reported'; rateAtomic: number; per: number; meterSource: string; selector?: string; chargeOn: 'started' | 'succeeded' | 'completed' }
type V3APIOperationReview = { id: string; operationId: string; method: string; path: string; title: string; displayName?: string; selected: boolean; price: number; pricingMode: 'default' | 'override'; pricing: V3APIPricingComponent[]; maxChargePerInvocationAtomic?: number; streaming: 'request_response' | 'server_stream'; sideEffect: boolean; idempotent: boolean; limits: { timeoutSeconds: number; maxRequestBytes: number; maxResponseBytes: number; maxConcurrency: number }; meteringCapabilities: string[] }
type V3APIMaterial = { id: string; name: string; extension: string; sizeBytes: number; localPath: string; sha256?: string }
type V3ServiceManifest = { interface: Record<string, any>; delivery: 'dock_tunnel' | 'cloud_direct'; operationPolicies: Array<{ operationId: string; interaction: 'request_response' | 'server_stream'; sideEffect: boolean; idempotent: boolean; limits: { timeoutSeconds: number; maxRequestBytes: number; maxResponseBytes: number; maxConcurrency: number }; meteringCapabilities: string[] }>; pricingTemplate: { currency: 'USDC'; defaults: V3APIPricingComponent[]; defaultMaxChargePerInvocationAtomic?: number; overrides?: Record<string, { components: V3APIPricingComponent[]; maxChargePerInvocationAtomic?: number }> } }
type V3APIBridgeDraft = { draftId: string; version: number; status: string; applicationSource: 'endpoint' | 'api_bridge'; title: string; description: string; serviceManifest: V3ServiceManifest; normalization: { mode: 'agent' | 'manual_fallback'; runId?: string; failedRunId?: string; fallbackReason?: string; sourceSha256: string; outputSha256: string; actor: string }; unresolvedFields?: string[]; operationReviews: V3APIOperationReview[]; agentNotes?: string }
type V3APIProbe = { ok: boolean; status?: number; latencyMs?: number; contentType?: string; checkedURL?: string; checkedAt?: string; error?: string }
type SettingsView = 'general' | 'account-security' | 'agent-permissions' | 'notifications' | 'data-storage' | 'system-about'
type WalletPanel = 'receive' | 'withdraw' | 'agent-limit' | 'history'
type WalletHistoryFilter = 'all' | 'deposit' | 'withdrawal'
type AppTheme = 'system' | 'light' | 'dark'
type CloseBehavior = 'tray' | 'quit'
type NotificationPreferenceKey = 'approvals' | 'purchases' | 'downloads' | 'leases' | 'wallet' | 'security' | 'sellerOrders' | 'sellerListings' | 'runtime'
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
  update?: { supported?: boolean; channel?: string; automatic?: boolean; state?: string; version?: string; progress?: number; checkedAt?: string; message?: string }
}
type AccountAPIKeyStatus = { accessKey?: { tokenId?: string; maskedKey?: string; status?: string; createdAt?: string; lastUsedAt?: string } | null; secureStorageAvailable?: boolean; stored?: boolean; dockConfigured?: boolean; requiresImport?: boolean }
type AgentSessionStatus = { sessionId: string; clientName?: string; scopes?: string[]; createdAt?: string; lastUsedAt?: string; idleAt?: string; expiresAt?: string }
type AgentSessionPolicy = { scopes: string[]; idleSeconds: number; maxLifetimeSeconds: number; restBaseUrl?: string }
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
  startDockOnLaunch?: boolean
  autoUpdate?: boolean
  downloadDirectory?: string
  notifications?: Partial<NotificationPreferences>
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
const vmProviderAvailable = !isMacPlatform
const normalizeV3SellerTab = (tab: V3SellerTab): V3SellerTab => !vmProviderAvailable && tab === 'vm' ? 'listings' : tab
const v3ProviderApplicationSources = (): V3ApplicationSource[] => vmProviderAvailable
  ? ['vm', 'resources', 'endpoint', 'api_bridge']
  : ['resources', 'endpoint', 'api_bridge']
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
app.dataset.vmProvider = String(vmProviderAvailable)

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
        <div class="v3-file-drop-backdrop" data-v3-file-drop-backdrop aria-hidden="true">
          <span class="v3-file-drop-backdrop-card">
            <i aria-hidden="true">+</i>
            <strong data-v3-file-drop-title>Release to add files</strong>
            <small data-v3-file-drop-detail>Files stay on this computer until you submit.</small>
          </span>
        </div>
      </section>

      <section class="workspace-view app-settings-view hidden" data-view-panel="app-settings" aria-labelledby="app-settings-title">
        <div class="app-settings-loading" role="status">Opening settings…</div>
      </section>

    </section>
  </main>

  <div class="global-modal-layer" data-global-modal-layer>
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
          <input type="search" data-order-search-input placeholder="Search title, status, counterparty, amount, or ID" aria-label="Search orders" autocomplete="off" />
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
            <span data-pin-settings-progress-label>Step 1 of 3</span>
            <div aria-hidden="true"><i></i><i></i><i></i></div>
          </div>
          <div class="pin-settings-stage">
            <label class="pin-settings-code-field">
              <span data-pin-settings-code-label>Current PIN</span>
              <span class="wallet-code-control masked pin-settings-code-control" data-pin-settings-code-control>
                <input name="pinEntry" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6" aria-label="Current six digit payment PIN" required />
                <span class="wallet-code-cells" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
              </span>
              <small data-pin-settings-step-hint>Enter the PIN you currently use to approve payments.</small>
            </label>
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
  pinSettingsCodeControl: app.querySelector<HTMLElement>('[data-pin-settings-code-control]')!,
  pinSettingsCodeInput: app.querySelector<HTMLInputElement>('[data-pin-settings-code-control] input')!,
  pinSettingsCodeLabel: app.querySelector<HTMLElement>('[data-pin-settings-code-label]')!,
  pinSettingsStepHint: app.querySelector<HTMLElement>('[data-pin-settings-step-hint]')!,
  pinSettingsMessage: app.querySelector<HTMLElement>('[data-pin-settings-message]')!,
  pinSettingsSubmit: app.querySelector<HTMLButtonElement>('[data-pin-settings-submit]')!,
  pinSettingsCancel: app.querySelector<HTMLButtonElement>('[data-pin-settings-cancel]')!,
  pinSettingsFooter: app.querySelector<HTMLElement>('[data-pin-settings-footer]')!,
  mcpInfoModal: app.querySelector<HTMLElement>('[data-mcp-info-modal]')!,
  mcpInfoTitle: app.querySelector<HTMLElement>('[data-mcp-info-title]')!,
  mcpInfoSubtitle: app.querySelector<HTMLElement>('[data-mcp-info-subtitle]')!,
  mcpInfoBody: app.querySelector<HTMLElement>('[data-mcp-info-body]')!,
  mcpInfoFooter: app.querySelector<HTMLElement>('[data-mcp-info-footer]')!,
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

fields.sellerSurfaceTabs.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-v3-seller-tab]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  const nextTab = normalizeV3SellerTab(button.dataset.v3SellerTab as V3SellerTab)
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
  startDockOnLaunch: boolean
  autoUpdate: boolean
  downloadDirectory: string
  notifications: NotificationPreferences
  settingsSystemStatus?: DesktopSystemStatus
  sellerAutomation?: SellerAutomationStatus
  settingsStatusLoading: boolean
  settingsStatusError?: string
  activeSettingsView: SettingsView
  settingsOpen: boolean
  pinSettingsModalOpen: boolean
  pinSettingsBusy: boolean
  pinSettingsMode: 'setup' | 'change'
  pinSettingsSetupStep: 'current' | 'entry' | 'confirmation'
  pinSettingsCurrentValue: string
  pinSettingsSetupValue: string
  cloudPaymentPINConfigured?: boolean
  accountAPIKeyStatus?: AccountAPIKeyStatus
  agentSessions: AgentSessionStatus[]
  agentSessionPolicy?: AgentSessionPolicy
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
  v3ListingSourceFilter: V3ListingProject
  v3ListingQuery: string
  v3ListingMode: 'buyer' | 'seller'
  v3ConsumerMinutes: number
  v3ConsumerOperationId: string
  v3ConsumerRequestBody: string
  v3ConsumerParameters: Record<string, string | boolean>
  v3ConsumerResponse?: Record<string, any>
  v3ConsumerBusy: boolean
  v3ConsumerError?: string
  v3ConsumerBalance?: V3ConsumerBalance
  v3ConsumerGrant?: Record<string, any>
  v3ConsumerTransferProgress?: { phase: string; bytesDownloaded: number; sizeBytes: number }
  v3ConsumerPurchase?: Record<string, any>
  v3ConsumerLease?: Record<string, any>
  v3ConsumerEstimate?: Record<string, any>
  v3ConsumerEstimateLoading: boolean
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
  v3VMListingConstraint: V3VMListingConstraint
  v3ListingsLoading: boolean
  v3ListingsLoaded: boolean
  v3HighlightedListingId?: string
  v3ExpandedListingId?: string
  v3EditingListingId?: string
  v3PublishConfirmListingId?: string
  v3ApplicationAttemptKeys: Record<string, { fingerprint: string; key: string }>
  v3LocalEndpoints: V3LocalEndpoint[]
  v3SellerError?: string
  v3VMProbe?: Record<string, unknown>
  v3VMDomains: Array<Record<string, unknown>>
  v3VMTemplate?: Record<string, unknown>
  v3EnvironmentImages: V3EnvironmentImage[]
  v3EnvironmentImagesLoaded: boolean
  v3EnvironmentCatalogOffline: boolean
  v3EnvironmentCloudOpen: boolean
  v3EnvironmentCloudFilter: 'all' | 'ubuntu' | 'cuda'
  v3EnvironmentRoot: string
  v3EnvironmentRootFreeBytes: number
  v3EnvironmentWorkspaceGiB: number
  v3BaseFee: number
  v3BaseFeeEnabled: boolean
  v3PricePerMinute: number
  v3MinimumMinutes: number
  v3MaximumMinutes: number
  v3LongDiscountAfterMinutes: number
  v3LongDiscountPercent: number
  v3LongDiscountMinimumPricePercent: number
  v3LongDiscountEnabled: boolean
  v3AllowSustainedCompute: boolean
  v3EnvironmentSaving: boolean
  v3InstalledEnvironments: Array<Record<string, any>>
  v3ImageProgress?: V3ImageProgress
  v3SelectedEnvironmentImageId?: string
  v3HostScanning: boolean
  v3HostScanProgress?: V3HostScanProgress
  v3ResourceArchive?: V3ResourceArchive
  v3ResourceSources: V3ResourceSource[]
  v3SelectedResourceToken?: string
  v3AssetProgress?: V3AssetProgress
  v3ResourceLicense: string
  v3ResourceTitle: string
  v3ResourceDescription: string
  v3ResourceCategory: string
  v3ResourceVersion: string
  v3ResourceGrantHours: number
  v3ResourcePrice: number
  v3ResourceSubmitting: boolean
  v3ResourceTargetSheet?: { listingId: string; productId: string; title: string; description: string }
  v3APITitle: string
  v3APIDescription: string
  v3APIBaseURL: string
  v3APIHealthPath: string
  v3APIAuthType: V3UpstreamAuthType
  v3APIKeyHeader: string
  v3APIDefaultPrice: number
  v3APIPriceUnit: 'request' | 'successful_request' | 'tokens' | 'image' | 'second'
  v3APIOperations: V3APIOperationReview[]
  v3APIProbe?: V3APIProbe
  v3APIProbing: boolean
  v3APIStep: 1 | 2 | 3
  v3APIDraftId: string
  v3APIDraft?: V3APIBridgeDraft
  v3APIDraftVersion: number
  v3APIMaterials: V3APIMaterial[]
  v3APIMaterialsImporting: boolean
  v3APIUnresolvedFields: string[]
  v3APIAgentNotes: string
  v3APIFailedRunId: string
  v3APIFallbackReason: string
  v3APIFallbackManifest: string
  v3APISellerAttestation: boolean
  v3APIAttestPricing: boolean
  v3APIAttestUsage: boolean
  v3APIAttestRights: boolean
  v3APICredentialConfigured: boolean
  v3APISecret: string
  v3APIBasicUsername: string
  v3APIOAuthTokenURL: string
  v3APIOAuthClientID: string
  v3APIOAuthClientSecret: string
  v3APIOAuthScope: string
  v3APIOAuthAudience: string
  v3APIMTLSCertificate: string
  v3APIMTLSPrivateKey: string
  v3APIMTLSCA: string
  v3APIMTLSServerName: string
  v3APIMaterialNote: string
  v3APISavingListing: boolean
  v3APISaveAttemptKey?: string
  v3APIMaterialsLoaded: boolean
  v3APIReviewIndex: number
  v3APIReviewFilter: 'all' | 'pending' | 'warnings'
  v3APIReviewStatus: Record<string, 'pending' | 'modified' | 'confirmed'>
  v3APIDraftDirty: boolean
  v3APIDraftMaterialFingerprint: string
  v3APIRequiredDraftVersion: number
  v3EndpointDraftId: string
  v3EndpointAgentReady: boolean
  v3EndpointFailedRunId: string
  v3EndpointFallbackReason: string
  v3EndpointFallbackManifest: string
  v3EndpointDraftDirty: boolean
  v3EndpointDraft?: V3APIBridgeDraft
  v3EndpointMaterials: V3APIMaterial[]
  v3EndpointMaterialsImporting: boolean
  v3EndpointMaterialsLoaded: boolean
  v3EndpointConfirmed: string[]
  v3EndpointReviewIndex: number
  v3EndpointReviewFilter: 'all' | 'pending' | 'warnings'
  v3EndpointReviewStatus: Record<string, 'pending' | 'modified' | 'confirmed'>
  v3EndpointDraftMaterialFingerprint: string
  v3EndpointRequiredDraftVersion: number
  v3EndpointSaveAttemptKey?: string
  v3EndpointSubmitting: boolean
  v3EndpointProbing: boolean
  v3EndpointLocalURL: string
  v3EndpointHealthPath: string
  v3EndpointAuthType: V3UpstreamAuthType
  v3EndpointSecret: string
  v3EndpointAPIKeyHeader: string
  v3EndpointBasicUsername: string
  v3EndpointOAuthTokenURL: string
  v3EndpointOAuthClientID: string
  v3EndpointOAuthClientSecret: string
  v3EndpointOAuthScope: string
  v3EndpointOAuthAudience: string
  v3EndpointMTLSCertificate: string
  v3EndpointMTLSPrivateKey: string
  v3EndpointMTLSCA: string
  v3EndpointMTLSServerName: string
  v3EndpointMaterialNote: string
  v3EndpointConcurrency: number
  v3EndpointTimeout: number
  v3EndpointProbe?: V3APIProbe
  v3EndpointRouteTestPath: string
  v3EndpointRouteTestQuery: string
  v3EndpointRouteTestContentType: string
  v3EndpointRouteTestBody: string
  v3EndpointRouteTestDangerConfirmed: boolean
  v3EndpointRouteTestResult?: { ok: boolean; status?: number; latencyMs?: number; firstEventLatencyMs?: number; streamEndStatus?: string; contentType?: string; bytesRead?: number; truncated?: boolean; preview?: string; sseEvents?: string[]; checkedAt?: string; error?: string }
  v3EndpointAttestPricing: boolean
  v3EndpointAttestRuntime: boolean
  v3EndpointAttestRights: boolean
  v3ServiceAgentSessionsLoaded: boolean
  v3ServiceAgentSessionsLoading: boolean
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
  startDockOnLaunch: true,
  autoUpdate: true,
  downloadDirectory: '',
  notifications: {
    approvals: true, purchases: true, downloads: true, leases: true, wallet: true,
    security: true, sellerOrders: true, sellerListings: true, runtime: true,
  },
  settingsSystemStatus: undefined,
  sellerAutomation: undefined,
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
  cloudPaymentPINConfigured: undefined,
  accountAPIKeyStatus: undefined,
  agentSessions: [],
  agentSessionPolicy: undefined,
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
  v3ListingSourceFilter: 'vm',
  v3ListingQuery: '',
  v3ListingMode: 'buyer',
  v3ConsumerMinutes: 10,
  v3ConsumerOperationId: '',
  v3ConsumerRequestBody: '{}',
  v3ConsumerParameters: {},
  v3ConsumerResponse: undefined,
  v3ConsumerBusy: false,
  v3ConsumerError: undefined,
  v3ConsumerBalance: undefined,
  v3ConsumerGrant: undefined,
  v3ConsumerTransferProgress: undefined,
  v3ConsumerPurchase: undefined,
  v3ConsumerLease: undefined,
  v3ConsumerEstimate: undefined,
  v3ConsumerEstimateLoading: false,
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
  v3SellerTab: 'listings',
  v3Listings: [],
  v3ListingApplications: [],
  v3VMListingConstraint: { limit: 1, used: 0, available: true },
  v3ListingsLoading: false,
  v3ListingsLoaded: false,
  v3HighlightedListingId: undefined,
  v3ExpandedListingId: undefined,
  v3EditingListingId: undefined,
  v3PublishConfirmListingId: undefined,
  v3ApplicationAttemptKeys: {},
  v3LocalEndpoints: [],
  v3VMDomains: [],
  v3EnvironmentImages: [],
  v3EnvironmentImagesLoaded: false,
  v3EnvironmentCatalogOffline: false,
  v3EnvironmentCloudOpen: false,
  v3EnvironmentCloudFilter: 'all',
  v3EnvironmentRoot: '',
  v3EnvironmentRootFreeBytes: 0,
  v3EnvironmentWorkspaceGiB: 100,
  v3BaseFee: 0,
  v3BaseFeeEnabled: false,
  v3PricePerMinute: 0,
  v3MinimumMinutes: 10,
  v3MaximumMinutes: 240,
  v3LongDiscountAfterMinutes: 60,
  v3LongDiscountPercent: 0,
  v3LongDiscountMinimumPricePercent: 50,
  v3LongDiscountEnabled: false,
  v3AllowSustainedCompute: true,
  v3EnvironmentSaving: false,
  v3InstalledEnvironments: [],
  v3HostScanning: false,
  v3ResourceSources: [],
  v3SelectedResourceToken: undefined,
  v3ResourceLicense: 'commercial',
  v3ResourceTitle: '',
  v3ResourceDescription: '',
  v3ResourceCategory: 'software',
  v3ResourceVersion: '1.0.0',
  v3ResourceGrantHours: 24,
  v3ResourcePrice: 0,
  v3ResourceSubmitting: false,
  v3ResourceTargetSheet: undefined,
  v3APITitle: '',
  v3APIDescription: '',
  v3APIBaseURL: '',
  v3APIHealthPath: '/health',
  v3APIAuthType: 'bearer',
  v3APIKeyHeader: 'X-API-Key',
  v3APIDefaultPrice: 0.01,
  v3APIPriceUnit: 'request',
  v3APIOperations: [],
  v3APIProbing: false,
  v3APIStep: 1,
  v3APIDraftId: localStorage.getItem('exora.apiBridgeDraftId') || `apid_${crypto.randomUUID().replace(/-/g, '')}`,
  v3APIDraft: undefined,
  v3APIDraftVersion: 0,
  v3APIMaterials: [],
  v3APIMaterialsImporting: false,
  v3APIUnresolvedFields: [],
  v3APIAgentNotes: '',
  v3APIFailedRunId: '',
  v3APIFallbackReason: '',
  v3APIFallbackManifest: '',
  v3APISellerAttestation: false,
  v3APIAttestPricing: false,
  v3APIAttestUsage: false,
  v3APIAttestRights: false,
  v3APICredentialConfigured: false,
  v3APISecret: '',
  v3APIBasicUsername: '',
  v3APIOAuthTokenURL: '',
  v3APIOAuthClientID: '',
  v3APIOAuthClientSecret: '',
  v3APIOAuthScope: '',
  v3APIOAuthAudience: '',
  v3APIMTLSCertificate: '',
  v3APIMTLSPrivateKey: '',
  v3APIMTLSCA: '',
  v3APIMTLSServerName: '',
  v3APIMaterialNote: '',
  v3APISavingListing: false,
  v3APISaveAttemptKey: undefined,
  v3APIMaterialsLoaded: false,
  v3APIReviewIndex: 0,
  v3APIReviewFilter: 'all',
  v3APIReviewStatus: {},
  v3APIDraftDirty: false,
  v3APIDraftMaterialFingerprint: '',
  v3APIRequiredDraftVersion: 0,
  v3EndpointDraftId: localStorage.getItem('exora.endpointDraftId') || `apid_${crypto.randomUUID().replace(/-/g, '')}`,
  v3EndpointAgentReady: false,
  v3EndpointFailedRunId: '',
  v3EndpointFallbackReason: '',
  v3EndpointFallbackManifest: '',
  v3EndpointDraftDirty: false,
  v3EndpointDraft: undefined,
  v3EndpointMaterials: [],
  v3EndpointMaterialsImporting: false,
  v3EndpointMaterialsLoaded: false,
  v3EndpointConfirmed: [],
  v3EndpointReviewIndex: 0,
  v3EndpointReviewFilter: 'all',
  v3EndpointReviewStatus: {},
  v3EndpointDraftMaterialFingerprint: '',
  v3EndpointRequiredDraftVersion: 0,
  v3EndpointSaveAttemptKey: undefined,
  v3EndpointSubmitting: false,
  v3EndpointProbing: false,
  v3EndpointLocalURL: 'http://127.0.0.1:8000',
  v3EndpointHealthPath: '/health',
  v3EndpointAuthType: 'none',
  v3EndpointSecret: '',
  v3EndpointAPIKeyHeader: 'X-API-Key',
  v3EndpointBasicUsername: '',
  v3EndpointOAuthTokenURL: '',
  v3EndpointOAuthClientID: '',
  v3EndpointOAuthClientSecret: '',
  v3EndpointOAuthScope: '',
  v3EndpointOAuthAudience: '',
  v3EndpointMTLSCertificate: '',
  v3EndpointMTLSPrivateKey: '',
  v3EndpointMTLSCA: '',
  v3EndpointMTLSServerName: '',
  v3EndpointMaterialNote: '',
  v3EndpointConcurrency: 1,
  v3EndpointTimeout: 120,
  v3EndpointRouteTestPath: '',
  v3EndpointRouteTestQuery: '',
  v3EndpointRouteTestContentType: 'application/json',
  v3EndpointRouteTestBody: '',
  v3EndpointRouteTestDangerConfirmed: false,
  v3EndpointRouteTestResult: undefined,
  v3EndpointAttestPricing: false,
  v3EndpointAttestRuntime: false,
  v3EndpointAttestRights: false,
  v3ServiceAgentSessionsLoaded: false,
  v3ServiceAgentSessionsLoading: false,
}

let settingsPersistenceReady = false
let appSettingsSaveTimer: number | undefined
let sidebarResizePointerId: number | undefined
let toastTimer: number | undefined

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
    return [{ id: String(input.id), accountId: input.accountId ? String(input.accountId) : undefined, archiveKey: String(input.archiveKey), role: input.role, productKind: String(input.productKind), archivedAt: String(input.archivedAt), archivedThrough: String(input.archivedThrough), records, baselines, detailAfterBySession }]
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
    startDockOnLaunch: typeof input.startDockOnLaunch === 'boolean' ? input.startDockOnLaunch : undefined,
    autoUpdate: typeof input.autoUpdate === 'boolean' ? input.autoUpdate : undefined,
    downloadDirectory: typeof input.downloadDirectory === 'string' ? input.downloadDirectory : undefined,
    notifications: normalizeNotificationPreferences(input.notifications),
  }
}

function normalizeNotificationPreferences(value: unknown): Partial<NotificationPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Partial<NotificationPreferences>
  return Object.fromEntries((['approvals', 'purchases', 'downloads', 'leases', 'wallet', 'security', 'sellerOrders', 'sellerListings', 'runtime'] as NotificationPreferenceKey[])
    .flatMap((key) => typeof input[key] === 'boolean' ? [[key, input[key]]] : []))
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
    startDockOnLaunch: value.startDockOnLaunch ?? fallback.startDockOnLaunch,
    autoUpdate: value.autoUpdate ?? fallback.autoUpdate,
    downloadDirectory: value.downloadDirectory ?? fallback.downloadDirectory,
    notifications: { ...fallback.notifications, ...value.notifications },
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
  if (typeof settings.startDockOnLaunch === 'boolean') state.startDockOnLaunch = settings.startDockOnLaunch
  if (typeof settings.autoUpdate === 'boolean') state.autoUpdate = settings.autoUpdate
  if (typeof settings.downloadDirectory === 'string') state.downloadDirectory = settings.downloadDirectory
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
    startDockOnLaunch: state.startDockOnLaunch,
    autoUpdate: state.autoUpdate,
    downloadDirectory: state.downloadDirectory,
    notifications: state.notifications,
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

function signOutProfile() {
  state.profileMenuOpen = false
  state.profileSubmenu = undefined
  void invoke<CloudAuthState>('auth_logout').then((next) => {
    authGate.applyState(next)
  }).catch((error) => showToast(humanizeError(error)))
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

function v3ActivityIsLocallyBusy(record: V3ActivitySession) {
  const listingMatches = !state.v3ExpandedListingId || state.v3ExpandedListingId === record.listingId
  if (record.productKind === 'api_operation' && state.v3ConsumerBusy && listingMatches) return true
  if (record.productKind !== 'download' || !state.v3ConsumerTransferProgress) return false
  const grantListingID = String(state.v3ConsumerGrant?.listingId || '')
  if (grantListingID && grantListingID !== record.listingId) return false
  return !['complete', 'completed', 'verified', 'failed', 'cancelled'].includes(state.v3ConsumerTransferProgress.phase.toLowerCase())
}

function v3ActivityRetainUntil(record: V3ActivitySession) {
  if (record.productKind !== 'api_operation' && record.productKind !== 'download') return undefined
  if (record.retainUntil) return record.retainUntil
  const anchor = record.productKind === 'api_operation' ? record.updatedAt : record.startedAt
  const timestamp = sortTime(anchor)
  return timestamp ? new Date(timestamp + V3_ACTIVITY_RETENTION_MS).toISOString() : undefined
}

function v3ActivityNaturallyCurrent(record: V3ActivitySession) {
  if (v3ActivityIsBusy(record)) return true
  if (record.productKind === 'compute') return false
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
    canArchive: bucket === 'current' && baselines.every((item) => !v3ActivityIsBusy(item) && !v3ActivityIsLocallyBusy(item)),
    manuallyArchived: Boolean(options.manuallyArchived),
    archiveMarkerId: options.archiveMarkerId,
    detailAfterBySession: Object.keys(detailAfterBySession).length ? detailAfterBySession : undefined,
    detailThroughBySession: options.detailThroughBySession,
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
  const apiGroups = new Map<string, V3ActivityDisplaySource[]>()
  for (const candidate of candidates.filter((item) => item.bucket === bucket)) {
    if (candidate.summary.productKind === 'api_operation') {
      const grouped = apiGroups.get(candidate.archiveKey) || []
      grouped.push(candidate)
      apiGroups.set(candidate.archiveKey, grouped)
      continue
    }
    output.push(v3AggregateActivityDisplay([candidate], bucket, candidate.archiveKey, `${bucket}:${candidate.summary.sessionId}`))
  }
  for (const [archiveKey, sources] of apiGroups) {
    output.push(v3AggregateActivityDisplay(sources, bucket, archiveKey, `${bucket}:${archiveKey}`))
  }

  if (bucket === 'history') {
    for (const marker of state.v3ActivityArchiveMarkers.filter((item) => item.role === side && item.accountId === v3ActivityAccountScope())) {
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


function orderSearchMatches(record: V3ActivitySession, query: string) {
  if (!query) return true
  const searchable = [
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
    fields.orderSearchResults.innerHTML = `<div class="order-search-state"><strong>${query ? 'No matching orders' : 'No orders yet'}</strong><span>${query ? 'Try a title, status, counterparty, amount, or order ID.' : 'Orders will appear here when activity is available.'}</span></div>`
    return
  }
  fields.orderSearchResults.innerHTML = matches.slice(0, 50).map((record) => `
    <button class="order-search-result" type="button" role="option" data-order-search-session="${escapeAttr(record.displayId)}" title="${escapeAttr([record.productTitle, record.counterpartyLabel, record.status, record.displayId].filter(Boolean).join(' / '))}">
      <span class="order-search-kind kind-${escapeAttr(record.productKind)}" aria-hidden="true">${v3ActivityKindLabel(record.productKind)}</span>
      <span class="order-search-result-copy">
        <strong>${escapeHTML(record.productTitle || 'Resource session')}</strong>
        <small>${escapeHTML([record.bucket === 'current' ? v3HistoryCopy('Current', '当前') : v3HistoryCopy('History', '历史'), record.counterpartyLabel, v3ActivityStatusLabel(record.status), compactTimestamp(record.updatedAt)].filter(Boolean).join(' · '))}</small>
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

async function startDockOnLaunch() {
  if (!hasDesktopBridge() || !state.startDockOnLaunch) return
  try {
    await invoke<AppStatus>('start_dock')
  } catch (error) {
    showToast(humanizeError(error))
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
      state.activeSettingsView = button.dataset.settingsTab as SettingsView
      scheduleSaveAppSettings()
      renderSettingsSidebar()
      renderSettingsPanel()
      fields.settingsView.scrollTop = 0
    })
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
    const response = await invoke<{ listings?: V3CatalogListing[] }>('catalog_listings', { input: { q: state.v3ListingQuery, applicationSource: state.v3ListingSourceFilter === 'api' ? '' : state.v3ListingSourceFilter } })
    state.v3CatalogListings = response.listings || []
    state.v3Products = state.v3CatalogListings.map((item) => item.productManifest)
    state.v3CatalogLoaded = true
  } catch (error) {
    state.v3CatalogError = humanizeError(error)
  } finally {
    state.v3CatalogLoading = false
    renderDecisionPanel()
  }
}

async function runV3Consumer<T extends Record<string, any>>(task: () => Promise<T>) {
  if (state.v3ConsumerBusy) return undefined
  state.v3ConsumerBusy = true
  state.v3ConsumerError = undefined
  renderDecisionPanel()
  try {
    const response = await task()
    state.v3ConsumerResponse = response
    const balance = await invoke<{ balance?: V3ConsumerBalance }>('consumer_account_balance').catch(() => ({ balance: undefined }))
    state.v3ConsumerBalance = balance.balance
    state.v3ActivityLoaded.buyer = false
    state.v3ActivityLoaded.seller = false
    void loadV3ActivitySessions(state.workOrderSide, true)
    return response
  } catch (error) {
    state.v3ConsumerError = humanizeError(error)
    return undefined
  } finally {
    state.v3ConsumerBusy = false
    renderDecisionPanel()
  }
}

function v3AtomicFromPrice(price: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const value = Number(price[key] || 0)
    if (value > 0) return Math.round(value)
  }
  const amount = Number(price.amount || 0)
  return amount > 0 ? Math.round(amount * 1_000_000) : 0
}

function v3ServiceManifestOperations(productManifest: Record<string, any>) {
  const serviceManifest = productManifest?.serviceManifest as V3ServiceManifest | undefined
  if (!serviceManifest?.interface || !Array.isArray(serviceManifest.operationPolicies)) return []
  const policies = new Map(serviceManifest.operationPolicies.map((policy) => [policy.operationId, policy]))
  const overrides = serviceManifest.pricingTemplate?.overrides || {}
  const operations: Array<Record<string, any>> = []
  for (const [operationPath, rawPathItem] of Object.entries(serviceManifest.interface.paths || {})) {
    const pathItem = rawPathItem as Record<string, any>
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const operation = pathItem[method] as Record<string, any> | undefined
      if (!operation?.operationId) continue
      const operationId = String(operation.operationId)
      const pricing = overrides[operationId]
      operations.push({
        operationId,
        method: method.toUpperCase(),
        path: operationPath,
        title: String(operation.summary || operationId),
        policy: policies.get(operationId),
        pricing: pricing?.components?.length ? pricing.components : serviceManifest.pricingTemplate.defaults || [],
        maxChargePerInvocationAtomic: pricing?.maxChargePerInvocationAtomic || serviceManifest.pricingTemplate.defaultMaxChargePerInvocationAtomic || 0,
      })
    }
  }
  return operations
}

function v3ConsumerMaxCharge(listing: V3Listing, product: V3Product, quantity = 1) {
  const price = listing.price || {}
  if (product.productKind === 'compute') return v3AtomicFromPrice(price, ['amountAtomicPerMinute', 'pricePerMinuteAtomic', 'amountAtomic']) * Math.max(1, quantity)
  if (product.productKind === 'api_operation') {
    const operations = v3ServiceManifestOperations(product.manifest || {})
    return Math.max(v3AtomicFromPrice(price, ['maxChargePerInvocationAtomic', 'amountAtomic']), ...operations.map((operation) => Number(operation.maxChargePerInvocationAtomic || 0)))
  }
  return v3AtomicFromPrice(price, ['amountAtomic', 'fixedAmountAtomic'])
}

let v3ComputeEstimateTimer: number | undefined
let v3ComputeEstimateSequence = 0

function v3ComputeListingLimits(listing: V3Listing, product: V3Product) {
  const limits = (listing.limits || product.manifest?.limits || {}) as Record<string, any>
  const v2 = (listing.price as Record<string, any> | undefined)?.model === 'compute_time_v2'
  const minMinutes = v2 ? Math.max(1, Number(limits.minMinutes || 10)) : 1
  const maxMinutes = v2 ? Math.max(minMinutes, Number(limits.maxMinutes || 240)) : 10080
  return { minMinutes, maxMinutes }
}

function syncV3ComputeEstimateDOM() {
  const estimate = state.v3ConsumerEstimate
  const charge = fields.actionView.querySelector<HTMLElement>('.v3-consumer-charge strong')
  const detail = fields.actionView.querySelector<HTMLElement>('[data-v3-compute-estimate-detail]')
  const submit = fields.actionView.querySelector<HTMLButtonElement>('[data-v3-compute-submit]')
  const error = fields.actionView.querySelector<HTMLElement>('[data-v3-compute-estimate-error]')
  if (charge) charge.textContent = state.v3ConsumerEstimateLoading ? 'Calculating…' : estimate ? v3AtomicMoney(Number(estimate.amountAtomic || 0), 'USDC') : '—'
  if (detail) detail.textContent = estimate ? `${Number(estimate.baseFeeAtomic || 0) > 0 ? `${v3AtomicMoney(Number(estimate.baseFeeAtomic), 'USDC')} start · ` : ''}${Number(estimate.discountAtomic || 0) > 0 ? `${v3AtomicMoney(Number(estimate.discountAtomic), 'USDC')} discount · ` : ''}${Number(estimate.cumulativeMinutes || estimate.durationMinutes || 0)} cumulative min` : 'Cloud-authoritative quote required'
  if (submit) {
    const form = submit.closest<HTMLFormElement>('[data-v3-consumer-form]')
    const expectedMode = form?.dataset.v3ConsumerForm === 'compute-extension' ? 'extension' : 'initial'
    submit.disabled = state.v3ConsumerEstimateLoading || !estimate || estimate.mode !== expectedMode || state.v3ConsumerBusy
  }
  if (error) error.textContent = state.v3ConsumerError || ''
}

async function refreshV3ComputeEstimate(listingId: string, durationMinutes: number, purchaseId?: string) {
  const sequence = ++v3ComputeEstimateSequence
  state.v3ConsumerEstimateLoading = true
  state.v3ConsumerEstimate = undefined
  state.v3ConsumerError = undefined
  syncV3ComputeEstimateDOM()
  try {
    const response = purchaseId
      ? await invoke<{ estimate?: Record<string, any> }>('consumer_estimate_compute_extension', { input: { purchaseId, durationMinutes } })
      : await invoke<{ estimate?: Record<string, any> }>('consumer_purchase_estimate', { input: { listingId, durationMinutes } })
    if (sequence !== v3ComputeEstimateSequence) return undefined
    state.v3ConsumerEstimate = { ...(response.estimate || {}), mode: purchaseId ? 'extension' : 'initial' }
    return state.v3ConsumerEstimate
  } catch (error) {
    if (sequence === v3ComputeEstimateSequence) state.v3ConsumerError = humanizeError(error)
    return undefined
  } finally {
    if (sequence === v3ComputeEstimateSequence) {
      state.v3ConsumerEstimateLoading = false
      syncV3ComputeEstimateDOM()
    }
  }
}

function scheduleV3ComputeEstimate(listingId: string, durationMinutes: number, purchaseId?: string) {
  if (v3ComputeEstimateTimer !== undefined) window.clearTimeout(v3ComputeEstimateTimer)
  v3ComputeEstimateTimer = window.setTimeout(() => { void refreshV3ComputeEstimate(listingId, durationMinutes, purchaseId) }, 250)
}

async function loadV3ActivitySessions(side: OrderSide = state.workOrderSide, force = false) {
  if (state.v3ActivityLoading[side] || (!force && (state.v3ActivityLoaded[side] || state.v3ActivityErrors[side]))) return
  state.v3ActivityLoading[side] = true
  delete state.v3ActivityErrors[side]
  if (side === state.workOrderSide) renderLedger()
  try {
    const response = await invoke<{ sessions?: V3ActivitySession[] }>('activity_sessions', { input: { role: side, limit: 200 } })
    state.v3ActivitySessions[side] = response.sessions || []
    state.v3ActivityLoaded[side] = true
  } catch (error) {
    state.v3ActivityErrors[side] = humanizeError(error)
  } finally {
    state.v3ActivityLoading[side] = false
    if (side === state.workOrderSide) renderLedger()
    if (!fields.orderSearchModal.classList.contains('hidden') && side === state.workOrderSide) renderOrderSearchResults()
  }
}

async function fetchV3ActivitySessionDetail(sessionId: string) {
  const response = await invoke<{ session?: V3ActivityDetail }>('activity_session', { input: { id: sessionId } })
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
    const details = await Promise.all(display.sessionIds.map(fetchV3ActivitySessionDetail))
    if (state.selectedV3ActivitySessionId !== displayId) return
    state.v3ActivityDetail = mergeV3ActivityDetails(display, details)
    if (display.role === 'buyer' && state.v3ActivityDetail.productKind === 'api_operation') void loadAPIOrderStatus(state.v3ActivityDetail.listingId)
  } catch (error) {
    if (state.selectedV3ActivitySessionId === displayId) state.v3ActivityDetailError = humanizeError(error)
  } finally {
    if (state.selectedV3ActivitySessionId === displayId) {
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
  state.v3APIOrderBusy = true
  renderDecisionPanel()
  try {
    const response = await invoke<{ order?: V3APIOrder }>('api_order_status', { input: { listingId } })
    if (state.v3ActivityDetail?.listingId !== listingId) return
    state.v3APIOrder = response.order
  } catch (error) {
    if (state.v3ActivityDetail?.listingId === listingId) showToast(humanizeError(error))
  } finally {
    if (state.v3ActivityDetail?.listingId === listingId) {
      state.v3APIOrderBusy = false
      renderDecisionPanel()
    }
  }
}

async function loadV3Listings() {
  if (state.v3ListingsLoading) return
  state.v3ListingsLoading = true
  state.v3SellerError = undefined
  renderDecisionPanel()
  try {
    const [response, local, draftRuns] = await Promise.all([
      invoke<{ listings?: V3Listing[]; applications?: V3ListingApplication[]; constraints?: { vmListing?: V3VMListingConstraint }; offline?: boolean }>('provider_listings'),
      invoke<{ endpoints?: V3LocalEndpoint[] }>('provider_endpoint_local_list').catch(() => ({ endpoints: [] })),
      invoke<{ runs?: SellerDraftRunSummary[] }>('seller_automation_draft_runs', { input: { limit: 20 } }).catch(() => ({ runs: [] })),
    ])
    state.v3Listings = response.listings || []
    state.v3ListingApplications = response.applications || []
    state.v3VMListingConstraint = response.constraints?.vmListing || { limit: 1, used: 0, available: true }
    state.v3LocalEndpoints = local.endpoints || []
    state.sellerAutomation = { ...(state.sellerAutomation || { configured: false, credentials: [] }), runs: draftRuns.runs || [] }
    state.v3ListingsLoaded = true
    state.v3SellerError = undefined
  } catch (error) {
    state.v3SellerError = humanizeError(error)
  } finally {
    state.v3ListingsLoading = false
    renderDecisionPanel()
  }
}

function v3EnvironmentImageKey(image: Pick<V3EnvironmentImage, 'imageId' | 'version'>) {
  return `${String(image.imageId || '').trim()}@${String(image.version || '').trim()}`
}

function v3InstalledEnvironmentCatalogImage(environment: Record<string, any>): V3EnvironmentImage | undefined {
  const attestation = environment.attestation || {}
  if (attestation.status !== 'ready' || !attestation.imageId || !attestation.imageVersion) return undefined
  const report = attestation.report || {}
  const suppliedManifest = environment.manifest || attestation.manifest || report.manifest || {}
  const cuda = Boolean(report.cuda || suppliedManifest.gpu?.required)
  return {
    imageId: String(attestation.imageId),
    version: String(attestation.imageVersion),
    status: 'ready_local',
    cloudAvailable: false,
    manifest: {
      schema: 'exora.environment_image.v3alpha1',
      name: String(suppliedManifest.name || report.imageName || attestation.imageId),
      description: String(suppliedManifest.description || sx('Installed and validated environment on this PC.', '已在本机安装并验证的环境。')),
      architecture: suppliedManifest.architecture || 'amd64',
      runtimeBackends: suppliedManifest.runtimeBackends || ['wsl2'],
      os: suppliedManifest.os || { distribution: String(report.osDistribution || (String(attestation.imageId).includes('ubuntu') ? 'Ubuntu' : 'Linux')), version: String(report.osVersion || '') },
      components: suppliedManifest.components || [cuda ? 'NVIDIA CUDA' : 'CPU', 'Exora Guest Contract'],
      gpu: suppliedManifest.gpu || { required: cuda, vendor: cuda ? 'nvidia' : 'none' },
      artifact: suppliedManifest.artifact || { format: 'wsl', sizeBytes: Number(report.imageSizeBytes || 0) },
    },
  }
}

function v3MergeEnvironmentImages(catalogImages: V3EnvironmentImage[], installedEnvironments: Array<Record<string, any>>) {
  const images = new Map<string, V3EnvironmentImage>()
  catalogImages.forEach((image) => images.set(v3EnvironmentImageKey(image), image))
  installedEnvironments.forEach((environment) => {
    const localImage = v3InstalledEnvironmentCatalogImage(environment)
    if (localImage && !images.has(v3EnvironmentImageKey(localImage))) images.set(v3EnvironmentImageKey(localImage), localImage)
  })
  return Array.from(images.values())
}

async function loadV3WindowsEnvironments() {
  if (state.v3EnvironmentImagesLoaded) return
  state.v3EnvironmentImagesLoaded = true
  try {
    const [runtime, catalog, installed] = await Promise.all([
      invoke<{ result?: Record<string, unknown>; measuredAt?: string }>('provider_host_snapshot'),
      invoke<{ images?: V3EnvironmentImage[]; offline?: boolean }>('provider_environment_catalog'),
      invoke<{ local?: { environments?: Array<Record<string, any>> }; attestations?: Array<Record<string, any>>; storage?: { rootPath?: string; workspaceGiB?: number; freeBytes?: number; pricing?: { baseFee?: number; baseFeeEnabled?: boolean; pricePerMinute?: number; minimumMinutes?: number; maximumMinutes?: number; longDiscountAfterMinutes?: number; longDiscountPercent?: number; longDiscountMinimumPricePercent?: number; longDiscountEnabled?: boolean; allowSustainedCompute?: boolean } } }>('provider_environment_installed'),
    ])
    if (runtime.result && Object.keys(runtime.result).length) state.v3VMProbe = runtime.result
    state.v3EnvironmentCatalogOffline = Boolean(catalog.offline)
    const attestations = installed.attestations || []
    state.v3InstalledEnvironments = (installed.local?.environments || []).map((environment) => ({
      ...environment,
      attestation: attestations.find((item) => item.report?.environmentId === environment.environmentId || `${item.imageId}-${item.imageVersion}`.replace(/[^a-zA-Z0-9._-]/g, '-') === environment.environmentId),
    }))
    state.v3EnvironmentImages = v3MergeEnvironmentImages(catalog.images || [], state.v3InstalledEnvironments)
    state.v3EnvironmentRoot = installed.storage?.rootPath || ''
    state.v3EnvironmentWorkspaceGiB = Math.max(20, Number(installed.storage?.workspaceGiB || 100))
    state.v3EnvironmentRootFreeBytes = Number(installed.storage?.freeBytes || 0)
    state.v3BaseFee = Math.max(0, Number(installed.storage?.pricing?.baseFee || 0))
    state.v3BaseFeeEnabled = installed.storage?.pricing?.baseFeeEnabled ?? state.v3BaseFee > 0
    state.v3PricePerMinute = Math.max(0, Number(installed.storage?.pricing?.pricePerMinute || 0))
    state.v3MinimumMinutes = Math.max(1, Number(installed.storage?.pricing?.minimumMinutes || 10))
    state.v3MaximumMinutes = Math.max(state.v3MinimumMinutes, Math.min(10080, Number(installed.storage?.pricing?.maximumMinutes || 240)))
    state.v3LongDiscountAfterMinutes = Math.max(1, Number(installed.storage?.pricing?.longDiscountAfterMinutes || 60))
    state.v3LongDiscountPercent = Math.max(0, Number(installed.storage?.pricing?.longDiscountPercent || 0))
    state.v3LongDiscountMinimumPricePercent = Math.max(1, Math.min(100, Number(installed.storage?.pricing?.longDiscountMinimumPricePercent || 50)))
    state.v3LongDiscountEnabled = installed.storage?.pricing?.longDiscountEnabled ?? state.v3LongDiscountPercent > 0
    state.v3AllowSustainedCompute = installed.storage?.pricing?.allowSustainedCompute ?? true
    const ready = state.v3InstalledEnvironments.find((item) => item.attestation?.status === 'ready')
    if (ready) state.v3VMTemplate = { ...ready.attestation.report, imageId: ready.attestation.imageId, imageVersion: ready.attestation.imageVersion, environmentId: ready.environmentId, valid: true, runtimeBackend: 'wsl2' }
    state.v3EnvironmentImagesLoaded = true
    state.v3SellerError = undefined
  } catch (error) {
    state.v3EnvironmentImagesLoaded = false
    state.v3SellerError = humanizeError(error)
  }
  renderDecisionPanel()
}

let v3LinuxPricingLoaded = false
async function loadV3LinuxPricingSettings() {
  if (v3LinuxPricingLoaded) return
  v3LinuxPricingLoaded = true
  try {
    const storage = await invoke<Record<string, any>>('provider_environment_storage')
    const pricing = storage.pricing || {}
    state.v3BaseFee = Math.max(0, Number(pricing.baseFee || 0))
    state.v3BaseFeeEnabled = pricing.baseFeeEnabled ?? state.v3BaseFee > 0
    state.v3PricePerMinute = Math.max(0, Number(pricing.pricePerMinute || 0))
    state.v3MinimumMinutes = Math.max(1, Number(pricing.minimumMinutes || 10))
    state.v3MaximumMinutes = Math.max(state.v3MinimumMinutes, Math.min(10080, Number(pricing.maximumMinutes || 240)))
    state.v3LongDiscountAfterMinutes = Math.max(1, Number(pricing.longDiscountAfterMinutes || 60))
    state.v3LongDiscountPercent = Math.max(0, Number(pricing.longDiscountPercent || 0))
    state.v3LongDiscountMinimumPricePercent = Math.max(1, Math.min(100, Number(pricing.longDiscountMinimumPricePercent || 50)))
    state.v3LongDiscountEnabled = pricing.longDiscountEnabled ?? state.v3LongDiscountPercent > 0
    state.v3AllowSustainedCompute = pricing.allowSustainedCompute ?? true
    renderDecisionPanel()
  } catch {
    v3LinuxPricingLoaded = false
  }
}

async function runV3WindowsHostScan() {
  if (state.v3HostScanning) return
  state.v3HostScanning = true
  state.v3HostScanProgress = { phase: 'hardware', percent: 0 }
  renderDecisionPanel()
  let reloadEnvironments = false
  try {
    const scanned = await invoke<{ result: Record<string, unknown> }>('provider_host_scan')
    state.v3VMProbe = scanned.result
    state.v3EnvironmentImagesLoaded = false
    reloadEnvironments = true
  } catch (error) {
    const message = humanizeError(error)
    showToast(message.includes('unknown desktop command') ? 'Restart Exora Dock to activate the updated Windows provider bridge.' : message)
  } finally {
    state.v3HostScanning = false
    state.v3HostScanProgress = undefined
    renderDecisionPanel()
  }
  if (reloadEnvironments) void loadV3WindowsEnvironments()
}

let v3ConsumerBalanceRequest: Promise<void> | undefined

function updateV3ConsumerBalanceLabels() {
  const balance = state.v3ConsumerBalance
  const label = balance ? v3AtomicMoney(balance.availableAtomic, balance.asset || 'USDC') : 'Checking balance…'
  fields.actionView.querySelectorAll<HTMLElement>('[data-v3-consumer-balance]').forEach((element) => { element.textContent = label })
}

function refreshV3ConsumerBalance() {
  if (v3ConsumerBalanceRequest) return v3ConsumerBalanceRequest
  v3ConsumerBalanceRequest = invoke<{ balance?: V3ConsumerBalance }>('consumer_account_balance')
    .then((response) => {
      state.v3ConsumerBalance = response.balance
      updateV3ConsumerBalanceLabels()
    })
    .catch(() => undefined)
    .finally(() => { v3ConsumerBalanceRequest = undefined })
  return v3ConsumerBalanceRequest
}

function ensureV3SurfaceData() {
  void loadV3ActivitySessions(state.workOrderSide)
  if (!state.v3CatalogLoading && !state.v3CatalogLoaded && !state.v3CatalogError) void loadV3Catalog()
  if (!state.v3ListingsLoading && !state.v3ListingsLoaded && !state.v3SellerError) void loadV3Listings()
  if (!state.v3ConsumerBalance) void refreshV3ConsumerBalance()
}

function v3ActivityUsageLabel(key: string) {
  const labels: Record<string, [string, string]> = {
    request: ['Requests', '请求'], successful_request: ['Successful', '成功'], input_bytes: ['Input', '输入'], output_bytes: ['Output', '输出'],
    execution_second: ['Execution', '执行时长'], input_tokens: ['Input tokens', '输入 Token'], output_tokens: ['Output tokens', '输出 Token'],
    duration_minutes: ['Reserved time', '预留时长'], transfer_bytes: ['Transferred', '传输量'], downloads: ['Downloads', '下载次数'],
  }
  const label = labels[key]
  return label ? v3HistoryCopy(label[0], label[1]) : key.replaceAll('_', ' ')
}

function v3ActivityUsageValue(key: string, value: number) {
  if (key.endsWith('_bytes') || key === 'transfer_bytes') return v3FormatBytes(value)
  if (key === 'execution_second') return value >= 60 ? `${(value / 60).toFixed(1)} min` : `${value} sec`
  if (key === 'duration_minutes') return `${value} min`
  return new Intl.NumberFormat().format(value)
}

function v3ActivityKindName(kind: string) {
  if (kind === 'compute') return v3HistoryCopy('Compute', '计算')
  if (kind === 'download') return v3HistoryCopy('Download', '资源下载')
  if (kind === 'api_operation') return v3HistoryCopy('API operation', 'API 调用')
  return kind.replaceAll('_', ' ')
}

function v3ActivitySource(detail: V3ActivityDetail): V3ApplicationSource | 'unclassified' {
  const product = detail.product || {}
  const explicitSource = String(product.applicationSource || '')
  if (explicitSource === 'vm' || explicitSource === 'resources' || explicitSource === 'endpoint' || explicitSource === 'api_bridge') return explicitSource
  return 'unclassified'
}

function v3ActivityRoleName(role: OrderSide) {
  return role === 'seller' ? v3HistoryCopy('Seller', '卖家') : v3HistoryCopy('Buyer', '买家')
}

function v3ActivityItemLabel(detail: V3ActivitySession) {
  if (detail.productKind === 'api_operation') return v3HistoryCopy(detail.itemCount === 1 ? 'call' : 'calls', '次调用')
  return v3HistoryCopy(detail.itemCount === 1 ? 'event' : 'events', '条事件')
}

function v3ActivityAccessWindow(detail: V3ActivitySession) {
  if (detail.status === 'active') return v3HistoryCopy('Open while the order is active', '订单进行期间可用')
  const retainUntil = v3ActivityRetainUntil(detail)
  if (!retainUntil) return v3HistoryCopy('Closed', '已关闭')
  return sortTime(retainUntil) > Date.now()
    ? v3HistoryCopy(`Available until ${compactTimestamp(retainUntil)}`, `可用至 ${compactTimestamp(retainUntil)}`)
    : v3HistoryCopy(`Ended ${compactTimestamp(retainUntil)}`, `已于 ${compactTimestamp(retainUntil)} 结束`)
}

function v3ActivityIdentifier(detail: V3ActivityDetail, key: string) {
  return String(detail.identifiers?.[key] || '')
}

function renderV3ActivityContextFacts(facts: Array<{ label: string; value: string; mono?: boolean }>) {
  return `<dl class="v3-activity-context-facts">${facts.filter((fact) => fact.value).map((fact) => `<div><dt>${escapeHTML(fact.label)}</dt><dd class="${fact.mono ? 'mono' : ''}">${escapeHTML(fact.value)}</dd></div>`).join('')}</dl>`
}

function renderV3ActivityDelivery(detail: V3ActivityDetail) {
  const operations = detail.operations || []
  if (detail.productKind === 'api_operation') {
    const requestCount = Number(detail.usage?.request || detail.itemCount || 0)
    const successfulCount = Number(detail.usage?.successful_request || 0)
    return `
      <section class="v3-activity-panel v3-activity-delivery kind-api_operation">
        <header><span>${escapeHTML(v3HistoryCopy('ORDER CONTEXT', '订单上下文'))}</span><h3>${escapeHTML(v3HistoryCopy('API session', 'API 会话'))}</h3></header>
        ${renderV3ActivityContextFacts([
          { label: v3HistoryCopy('Requests', '请求'), value: new Intl.NumberFormat().format(requestCount) },
          { label: v3HistoryCopy('Successful', '成功'), value: new Intl.NumberFormat().format(successfulCount) },
          { label: v3HistoryCopy('In flight', '进行中'), value: new Intl.NumberFormat().format(Number(detail.inFlightCount || 0)) },
          { label: v3HistoryCopy('Order access', '订单访问'), value: v3ActivityAccessWindow(detail) },
        ])}
        <div class="v3-activity-subsection-title"><span>${escapeHTML(v3HistoryCopy('Operations used', '已调用操作'))}</span><em>${operations.length}</em></div>
        <div class="v3-activity-operation-list">${operations.length ? operations.map((item) => `<span>${escapeHTML(item)}</span>`).join('') : `<span>${escapeHTML(v3HistoryCopy('No operation metadata', '暂无操作元数据'))}</span>`}</div>
      </section>
    `
  }
  if (detail.productKind === 'compute') {
    const leaseId = v3ActivityIdentifier(detail, 'leaseId')
    return `
      <section class="v3-activity-panel v3-activity-delivery kind-compute">
        <header><span>${escapeHTML(v3HistoryCopy('ORDER CONTEXT', '订单上下文'))}</span><h3>${escapeHTML(v3HistoryCopy('Exclusive compute lease', '独占计算租约'))}</h3></header>
        ${renderV3ActivityContextFacts([
          { label: v3HistoryCopy('Lease state', '租约状态'), value: v3ActivityStatusLabel(detail.status) },
          { label: v3HistoryCopy('Reserved', '预留时长'), value: detail.usage?.duration_minutes ? v3ActivityUsageValue('duration_minutes', Number(detail.usage.duration_minutes)) : '—' },
          { label: v3HistoryCopy('Started', '开始时间'), value: compactTimestamp(detail.startedAt) },
          { label: detail.endedAt ? v3HistoryCopy('Ended', '结束时间') : v3HistoryCopy('Last heartbeat', '最近心跳'), value: compactTimestamp(detail.endedAt || detail.updatedAt) },
        ])}
        ${leaseId ? `<p class="v3-activity-context-note"><span>${escapeHTML(v3HistoryCopy('Lease reference', '租约标识'))}</span><code>${escapeHTML(leaseId)}</code></p>` : ''}
      </section>
    `
  }
  const grantId = v3ActivityIdentifier(detail, 'grantId')
  return `
    <section class="v3-activity-panel v3-activity-delivery kind-download">
      <header><span>${escapeHTML(v3HistoryCopy('ORDER CONTEXT', '订单上下文'))}</span><h3>${escapeHTML(v3HistoryCopy('Download grant', '下载授权'))}</h3></header>
      ${renderV3ActivityContextFacts([
        { label: v3HistoryCopy('Grant state', '授权状态'), value: v3ActivityStatusLabel(detail.status) },
        { label: v3HistoryCopy('Downloads', '下载次数'), value: new Intl.NumberFormat().format(Number(detail.usage?.downloads || 0)) },
        { label: v3HistoryCopy('Transferred', '传输量'), value: v3ActivityUsageValue('transfer_bytes', Number(detail.usage?.transfer_bytes || 0)) },
        { label: v3HistoryCopy('Retry window', '重试窗口'), value: v3ActivityAccessWindow(detail) },
      ])}
      ${grantId ? `<p class="v3-activity-context-note"><span>${escapeHTML(v3HistoryCopy('Grant reference', '授权标识'))}</span><code>${escapeHTML(grantId)}</code></p>` : ''}
    </section>
  `
}

function renderV3APIOrder(detail: V3ActivityDetail) {
  if (detail.role !== 'buyer' || detail.productKind !== 'api_operation') return ''
  const order = state.v3APIOrder
  const active = order?.status === 'active'
  return `<section class="v3-activity-panel v3-order-access-key ${active ? 'is-active' : ''}">
    <header><span>${escapeHTML(v3HistoryCopy('API ORDER', 'API 订单'))}</span><h3>${escapeHTML(v3HistoryCopy('Persistent access state', '持久访问状态'))}</h3></header>
    <div class="v3-order-key-status"><span>${icon(KeyRound)}</span><div><strong>${escapeHTML(order?.orderId || v3HistoryCopy('Loading order', '正在加载订单'))}</strong><small>${escapeHTML(v3HistoryCopy('This state is shared by human clients and every local Agent session.', '此状态由真人客户端和全部本地 Agent 会话共享。'))}</small></div><em>${escapeHTML(order?.status || '—')}</em></div>
    ${order ? `<dl><div><dt>${escapeHTML(v3HistoryCopy('Listing', '商品'))}</dt><dd>${escapeHTML(order.listingId)}</dd></div><div><dt>${escapeHTML(v3HistoryCopy('Last used', '最近使用'))}</dt><dd>${escapeHTML(compactTimestamp(order.lastUsedAt) || v3HistoryCopy('Never', '从未使用'))}</dd></div></dl>` : ''}
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
    if (action === 'deactivate' && !window.confirm(v3HistoryCopy('Deactivate this API Order? Existing sessions will be blocked immediately.', '停用此 API 订单吗？现有会话会立即被阻止。'))) return
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
    return `<section class="v3-activity-loading"><span class="v3-history-spinner"></span><strong>${escapeHTML(v3HistoryCopy('Loading order detail', '正在加载订单详情'))}</strong><p>${escapeHTML(v3HistoryCopy('Reading the authoritative session, usage and ledger projection.', '正在读取权威会话、用量与账本数据。'))}</p></section>`
  }
  const activitySource = v3ActivitySource(detail)
  const usageOrder = detail.productKind === 'compute'
    ? ['duration_minutes', 'input_bytes', 'output_bytes']
    : detail.productKind === 'download'
      ? ['downloads', 'transfer_bytes']
      : ['request', 'successful_request', 'input_tokens', 'output_tokens', 'input_bytes', 'output_bytes', 'execution_second']
  const usage = Object.entries(detail.usage || {})
    .filter(([key, value]) => Number.isFinite(Number(value)) && (Number(value) !== 0 || (key === 'successful_request' && Number(detail.usage?.request || 0) > 0)))
    .sort(([left], [right]) => {
      const leftIndex = usageOrder.indexOf(left)
      const rightIndex = usageOrder.indexOf(right)
      return (leftIndex < 0 ? usageOrder.length : leftIndex) - (rightIndex < 0 ? usageOrder.length : rightIndex) || left.localeCompare(right)
    })
  const invocations = detail.invocations || []
  const events = detail.events || []
  const supplementalEvents = invocations.length ? events.filter((event) => event.type !== 'api_invocation') : events
  const identifierOrder = ['sessionId', 'activitySessionId', 'activityBatchId', 'leaseId', 'grantId', 'productId', 'listingId', 'counterpartyId', 'sessionCount']
  const identifiers = Object.entries(detail.identifiers || {}).filter(([, value]) => Boolean(value)).sort(([left], [right]) => {
    const leftIndex = identifierOrder.indexOf(left)
    const rightIndex = identifierOrder.indexOf(right)
    return (leftIndex < 0 ? identifierOrder.length : leftIndex) - (rightIndex < 0 ? identifierOrder.length : rightIndex) || left.localeCompare(right)
  })
  const roleAmountLabel = detail.role === 'seller' ? v3HistoryCopy('Net revenue', '净收入') : v3HistoryCopy('Paid', '已支付')
  const productDescription = String(detail.product?.description || '')
  const updated = detail.updatedAt ? compactTimestamp(detail.updatedAt) : '—'
  const started = detail.startedAt ? compactTimestamp(detail.startedAt) : '—'
  const counterpartyRole = detail.role === 'seller' ? v3HistoryCopy('Buyer', '买家') : v3HistoryCopy('Provider', '服务方')
  const activityLabel = `${detail.itemCount} ${v3ActivityItemLabel(detail)}`
  const productSnapshotTitle = detail.role === 'seller' ? v3HistoryCopy('Sold resource', '售出资源') : v3HistoryCopy('Purchased resource', '已购资源')
  const buyerLedger = detail.role === 'buyer'
  const ledgerRows = buyerLedger
    ? [
        [v3HistoryCopy('Order total', '订单总额'), v3AtomicMoney(detail.grossAmountAtomic, detail.asset), ''],
        [v3HistoryCopy('Platform fee (included)', '平台费（已包含）'), v3AtomicMoney(detail.platformFeeAtomic, detail.asset), ''],
        [roleAmountLabel, v3AtomicMoney(detail.amountAtomic, detail.asset), 'total'],
      ]
    : [
        [v3HistoryCopy('Buyer paid', '买家支付'), v3AtomicMoney(detail.grossAmountAtomic, detail.asset), ''],
        [v3HistoryCopy('Platform fee', '平台费'), `− ${v3AtomicMoney(detail.platformFeeAtomic, detail.asset)}`, ''],
        [roleAmountLabel, v3AtomicMoney(detail.amountAtomic, detail.asset), 'total'],
      ]
  const identifierLabels: Record<string, [string, string]> = {
    sessionId: ['Session', '会话'],
    activitySessionId: ['Agent task', 'Agent 任务'],
    activityBatchId: ['Activity batch', '活动批次'],
    leaseId: ['Lease', '租约'],
    grantId: ['Download grant', '下载授权'],
    productId: ['Product', '商品'],
    listingId: ['Listing', '上架记录'],
    counterpartyId: ['Counterparty', '交易方'],
    sessionCount: ['Sessions', '会话数量'],
  }
  return `
    <section class="v3-activity-detail" data-v3-activity-detail data-kind="${escapeAttr(detail.productKind)}" data-source="${escapeAttr(activitySource)}" data-status="${escapeAttr(detail.status)}" data-role="${escapeAttr(detail.role)}">
      <nav class="v3-activity-nav">
        <button type="button" data-v3-action="activity-back">${toolbarIcons.back}<span>${escapeHTML(v3HistoryCopy(`Back to ${detail.role === 'seller' ? 'seller' : 'buyer'} workspace`, `返回${detail.role === 'seller' ? '卖家' : '买家'}工作区`))}</span></button>
        <button type="button" data-v3-action="activity-refresh">${toolbarIcons.refresh}<span>${escapeHTML(v3HistoryCopy('Refresh', '刷新'))}</span></button>
      </nav>
      <header class="v3-activity-hero">
        <div class="v3-activity-hero-mark kind-${escapeAttr(detail.productKind)}">${v3ActivityKindLabel(detail.productKind)}</div>
        <div class="v3-activity-hero-copy">
          <span>${escapeHTML(v3ActivityKindName(detail.productKind))} · ${escapeHTML(v3ActivityRoleName(detail.role))}</span>
          <h2>${escapeHTML(detail.productTitle || 'Resource session')}</h2>
          <p>${escapeHTML(detail.outcome || v3HistoryCopy('Authoritative activity session.', '权威交易活动会话。'))}</p>
          <div class="v3-activity-hero-meta"><span><b>${escapeHTML(counterpartyRole)}</b>${escapeHTML(detail.counterpartyLabel || v3HistoryCopy('Counterparty', '交易方'))}</span><span><b>${escapeHTML(v3HistoryCopy('Started', '开始'))}</b>${escapeHTML(started)}</span></div>
        </div>
        <em class="v3-activity-state ${escapeAttr(detail.status)}"><i></i>${escapeHTML(v3ActivityStatusLabel(detail.status))}</em>
      </header>
      ${detail.attentionRequired ? `<div class="v3-activity-attention">${icon(ShieldAlert)}<div><strong>${escapeHTML(v3HistoryCopy('Review required', '需要检查'))}</strong><span>${escapeHTML(v3HistoryCopy('One or more operations failed or could not be metered. The original evidence remains unchanged below.', '一个或多个操作失败或无法计量；原始证据保持不变并列于下方。'))}</span></div></div>` : ''}
      <section class="v3-activity-summary">
        <div class="v3-activity-total"><span>${roleAmountLabel}</span><strong>${escapeHTML(v3AtomicMoney(detail.amountAtomic, detail.asset))}</strong><small>${escapeHTML(detail.role === 'seller' ? v3HistoryCopy('After platform fee', '扣除平台费后') : v3HistoryCopy('Across this resource session', '此资源会话累计'))}</small></div>
        <dl>
          <div><dt>${escapeHTML(v3HistoryCopy('Status', '状态'))}</dt><dd><span class="v3-summary-status ${escapeAttr(detail.status)}"><i></i>${escapeHTML(v3ActivityStatusLabel(detail.status))}</span></dd></div>
          <div><dt>${escapeHTML(v3HistoryCopy('Activity', '活动'))}</dt><dd>${escapeHTML(activityLabel)}</dd></div>
          <div><dt>${escapeHTML(counterpartyRole)}</dt><dd title="${escapeAttr(detail.counterpartyLabel || '')}">${escapeHTML(detail.counterpartyLabel || '—')}</dd></div>
          <div><dt>${escapeHTML(v3HistoryCopy('Last update', '最近更新'))}</dt><dd>${escapeHTML(updated)}</dd></div>
        </dl>
      </section>
      <div class="v3-activity-grid">
        <div class="v3-activity-main-column">
          ${renderV3ActivityDelivery(detail)}
          <section class="v3-activity-panel">
            <header><span>${escapeHTML(v3HistoryCopy('MEASURED FACTS', '计量数据'))}</span><h3>${escapeHTML(v3HistoryCopy('Usage', '用量'))}</h3></header>
            ${usage.length ? `<div class="v3-activity-usage">${usage.map(([key, value]) => `<div><span>${escapeHTML(v3ActivityUsageLabel(key))}</span><strong>${escapeHTML(v3ActivityUsageValue(key, Number(value)))}</strong></div>`).join('')}</div>` : `<p class="v3-activity-empty">${escapeHTML(v3HistoryCopy('No metered usage has been attached to this session.', '此会话尚未附加计量用量。'))}</p>`}
          </section>
          <section class="v3-activity-panel">
            <header class="v3-activity-section-heading"><div><span>${escapeHTML(v3HistoryCopy('SESSION ACTIVITY', '会话活动'))}</span><h3>${escapeHTML(detail.productKind === 'api_operation' ? v3HistoryCopy('Invocations', '调用记录') : v3HistoryCopy('Timeline', '事件时间线'))}</h3></div><em>${detail.productKind === 'api_operation' ? invocations.length : supplementalEvents.length}</em></header>
            ${invocations.length ? `<div class="v3-activity-invocations">${invocations.map((item) => `<article><span class="v3-activity-event-dot ${escapeAttr(item.status)}"></span><div><strong>${escapeHTML(item.operationId || v3HistoryCopy('API invocation', 'API 调用'))}</strong><small>${escapeHTML(compactTimestamp(item.completedAt || item.startedAt))} · ${escapeHTML(item.invocationId)}</small></div><em>${escapeHTML(v3AtomicMoney(item.chargedAtomic, detail.asset))}</em><b class="status-${escapeAttr(item.status)}">${escapeHTML(v3ActivityStatusLabel(item.status))}</b></article>`).join('')}</div>` : ''}
            ${supplementalEvents.length ? `<div class="v3-activity-events">${renderV3ActivityEvents(supplementalEvents)}</div>` : ''}
            ${!invocations.length && !supplementalEvents.length ? `<p class="v3-activity-empty">${escapeHTML(v3HistoryCopy('No activity events have been recorded yet.', '尚未记录活动事件。'))}</p>` : ''}
          </section>
        </div>
        <aside class="v3-activity-side-column">
          ${renderV3APIOrder(detail)}
          <section class="v3-activity-panel v3-activity-money">
            <header><span>${escapeHTML(v3HistoryCopy('MONEY', '资金'))}</span><h3>${escapeHTML(v3HistoryCopy('Ledger summary', '账本摘要'))}</h3></header>
            <dl>${ledgerRows.map(([label, value, className]) => `<div class="${className}"><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>
            <p>${escapeHTML(v3HistoryCopy('Refunds and corrections appear as new reversing entries; prior history is never edited.', '退款和更正会作为新的冲正分录出现，既有历史不会被改写。'))}</p>
          </section>
          <section class="v3-activity-panel v3-activity-product">
            <header><span>${escapeHTML(v3HistoryCopy('PRODUCT SNAPSHOT', '商品快照'))}</span><h3>${escapeHTML(productSnapshotTitle)}</h3></header>
            <strong>${escapeHTML(detail.productTitle)}</strong>
            ${productDescription ? `<p>${escapeHTML(productDescription)}</p>` : ''}
            <div><span>${escapeHTML(v3HistoryCopy('Type', '类型'))}</span><b>${escapeHTML(v3ActivityKindName(detail.productKind))}</b></div>
            <div><span>${escapeHTML(v3HistoryCopy('Version', '版本'))}</span><b>${escapeHTML(String(detail.product?.version ?? '—'))}</b></div>
          </section>
          ${identifiers.length ? `<section class="v3-activity-panel v3-activity-identifiers">
            <header><span>${escapeHTML(v3HistoryCopy('AUDIT REFERENCES', '审计引用'))}</span><h3>${escapeHTML(v3HistoryCopy('Identifiers', '标识符'))}</h3></header>
            ${identifiers.map(([label, value]) => {
              const displayLabel = identifierLabels[label]
              return `<button type="button" data-copy-v3-identifier="${escapeAttr(value)}"><span>${escapeHTML(displayLabel ? v3HistoryCopy(displayLabel[0], displayLabel[1]) : label.replace(/([A-Z])/g, ' $1'))}</span><code>${escapeHTML(value)}</code>${toolbarIcons.copy}</button>`
            }).join('')}
          </section>` : ''}
        </aside>
      </div>
    </section>
  `
}




function renderV3SellerTabs() {
  state.v3SellerTab = normalizeV3SellerTab(state.v3SellerTab)
  const applicationCount = state.v3ListingApplications.filter(({ listing }) => ['draft', 'unhealthy', 'provider_busy', 'capacity_insufficient', 'performance_degraded'].includes(listing.status)).length
  const allTabs: Array<[V3SellerTab, string, IconNode]> = [
    ['listings', 'Listings', SquareKanban],
    ['vm', 'VM', Activity],
    ['resources', 'Resources', Folder],
    ['endpoint', 'Endpoint', BrainCircuit],
    ['api_bridge', 'API Bridge', Network],
  ]
  const tabs = allTabs.filter(([id]) => vmProviderAvailable || id !== 'vm')
  const activeIndex = Math.max(0, tabs.findIndex(([id]) => state.v3SellerTab === id))
  return `<nav class="v3-seller-tabs" role="tablist" aria-label="Main workspace" style="--v3-seller-active-offset: ${activeIndex * 124}px">
    <span class="v3-seller-active-bar" aria-hidden="true"></span>
    ${tabs.map(([id, label, tabIcon]) => `<button type="button" role="tab" aria-selected="${state.v3SellerTab === id}" data-v3-seller-tab="${id}" class="${state.v3SellerTab === id ? 'active' : ''}">${icon(tabIcon)}<span>${label}${id === 'listings' && applicationCount ? `<em class="v3-tab-count">${applicationCount}</em>` : ''}</span></button>`).join('')}
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

  const listingsLabel = fields.sellerSurfaceTabs.querySelector<HTMLElement>('[data-v3-seller-tab="listings"] > span')
  const applicationCount = state.v3ListingApplications.filter(({ listing }) => ['draft', 'unhealthy', 'provider_busy', 'capacity_insufficient', 'performance_degraded'].includes(listing.status)).length
  const existingCount = listingsLabel?.querySelector<HTMLElement>('.v3-tab-count')
  if (applicationCount > 0) {
    const count = existingCount || document.createElement('em')
    count.className = 'v3-tab-count'
    count.textContent = String(applicationCount)
    if (!existingCount) listingsLabel?.append(count)
  } else {
    existingCount?.remove()
  }
}

function syncV3SellerTabsVisibility() {
  const hidden = state.settingsOpen || Boolean(state.selectedV3ActivitySessionId)
  fields.sellerSurfaceTabs.classList.toggle('hidden', hidden)
}

function v3HostScanPhaseLabel(phase: string) {
  return ({
    hardware: 'Reading hardware',
    geolocation: 'Locating public IP',
    latency: 'Measuring latency',
    download: 'Testing download',
    upload: 'Testing upload',
    saving: 'Saving snapshot',
    complete: 'Scan complete',
  } as Record<string, string>)[phase] || 'Scanning'
}

function renderV3HostScanButton(hasProbe: boolean) {
  if (!state.v3HostScanning) {
    return `<button class="ghost" type="button" data-v3-action="vm-probe">${hasProbe ? 'Scan again' : 'Scan hardware'}</button>`
  }
  const progress = state.v3HostScanProgress || { phase: 'hardware', percent: 0 }
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)))
  const label = v3HostScanPhaseLabel(progress.phase)
  return `<button class="ghost v3-scan-progress-button" type="button" data-v3-action="vm-probe" disabled style="--v3-scan-progress: ${percent}%" aria-label="${escapeAttr(`${label}, ${percent} percent`)}">${percent}% · ${escapeHTML(label)}</button>`
}

function updateV3HostScanProgressButton() {
  const button = fields.actionView.querySelector<HTMLButtonElement>('[data-v3-action="vm-probe"]')
  const progress = state.v3HostScanProgress
  if (!button || !state.v3HostScanning || !progress) return
  button.classList.add('v3-scan-progress-button')
  button.disabled = true
  button.style.setProperty('--v3-scan-progress', `${progress.percent}%`)
  button.textContent = `${progress.percent}% · ${v3HostScanPhaseLabel(progress.phase)}`
  button.setAttribute('aria-label', `${v3HostScanPhaseLabel(progress.phase)}, ${progress.percent} percent`)
}

function v3DiskRate(value: unknown) {
  const mbps = Number(value || 0)
  if (!(mbps > 0)) return ''
  return mbps >= 1024 ? `${(mbps / 1024).toFixed(1)} GB/s` : `${Math.round(mbps)} MB/s`
}

function v3MaterialFingerprint(materials: V3APIMaterial[]) {
  return JSON.stringify(materials.map((item) => [item.id, item.name.toLowerCase(), item.extension.toLowerCase(), item.sizeBytes, item.sha256 || '']).sort((left, right) => String(left[0]).localeCompare(String(right[0]))))
}

function v3AgentMaterialReceiptKey(kind: 'endpoint' | 'api_bridge', draftId: string) {
  return `exora.agentMaterials.${kind}.${draftId}`
}

function restoreV3AgentMaterialReceipt(kind: 'endpoint' | 'api_bridge', draftId: string, version: number, materials: V3APIMaterial[]) {
  try {
    const saved = JSON.parse(localStorage.getItem(v3AgentMaterialReceiptKey(kind, draftId)) || '{}') as { draftVersion?: number; materialFingerprint?: string }
    const fingerprint = v3MaterialFingerprint(materials)
    if (materials.length && saved.draftVersion === version && saved.materialFingerprint === fingerprint) return fingerprint
  } catch { /* A malformed local receipt only makes the Agent draft stale. */ }
  return ''
}

function recordV3AgentMaterialReceipt(kind: 'endpoint' | 'api_bridge', draftId: string, version: number, materials: V3APIMaterial[]) {
  const materialFingerprint = v3MaterialFingerprint(materials)
  localStorage.setItem(v3AgentMaterialReceiptKey(kind, draftId), JSON.stringify({ draftId, draftVersion: version, materialFingerprint, checkedAt: new Date().toISOString() }))
  return materialFingerprint
}

function v3WizardStepClass(step: V3WizardStepState) {
  return `v3-wizard-step is-${step}`
}

function v3AgentMaterialsCurrent(kind: 'endpoint' | 'api_bridge') {
  if (kind === 'endpoint') return Boolean(state.v3EndpointMaterials.length && state.v3EndpointDraft && state.v3EndpointDraft.version >= state.v3EndpointRequiredDraftVersion && state.v3EndpointDraftMaterialFingerprint === v3MaterialFingerprint(state.v3EndpointMaterials))
  return Boolean(state.v3APIMaterials.length && state.v3APIDraftVersion > 0 && state.v3APIDraftVersion >= state.v3APIRequiredDraftVersion && state.v3APIDraftMaterialFingerprint === v3MaterialFingerprint(state.v3APIMaterials))
}

function invalidateV3AgentMaterials(kind: 'endpoint' | 'api_bridge') {
  if (kind === 'endpoint') {
    state.v3EndpointRequiredDraftVersion = Math.max(state.v3EndpointRequiredDraftVersion, (state.v3EndpointDraft?.version || 0) + 1)
    state.v3EndpointDraftMaterialFingerprint = ''
    state.v3EndpointProbe = undefined
    state.v3EndpointRouteTestResult = undefined
    localStorage.removeItem(v3AgentMaterialReceiptKey(kind, state.v3EndpointDraftId))
    return
  }
  state.v3APIRequiredDraftVersion = Math.max(state.v3APIRequiredDraftVersion, state.v3APIDraftVersion + 1)
  state.v3APIDraftMaterialFingerprint = ''
  state.v3APIProbe = undefined
  clearV3ApplicationAttempt('api_bridge')
  localStorage.removeItem(v3AgentMaterialReceiptKey(kind, state.v3APIDraftId))
}

function updateV3DiskSpeedFact() {
  const facts = Array.from(fields.actionView.querySelectorAll<HTMLElement>('.v3-host-facts > span'))
  const storageFact = facts.find((fact) => fact.querySelector('small')?.textContent?.trim().toLowerCase() === 'storage')
  if (!storageFact) return
  const disk = (state.v3VMProbe?.disk || {}) as Record<string, unknown>
  const read = v3DiskRate(disk.readMBps)
  const write = v3DiskRate(disk.writeMBps)
  const label = storageFact.querySelector('small')
  const value = storageFact.querySelector('strong')
  const detail = storageFact.querySelector('em')
  if (label) label.textContent = 'Disk speed'
  if (value) value.textContent = read && write ? `R ${read} · W ${write}` : 'Not measured'
  if (detail) detail.textContent = read && write ? 'Sequential unbuffered test' : 'Run Scan again to benchmark'
}

function v3ReadyInstalledEnvironment(image?: V3EnvironmentImage) {
  if (!image) return undefined
  return state.v3InstalledEnvironments.find((item) => item.attestation?.imageId === image.imageId && item.attestation?.imageVersion === image.version && item.attestation?.status === 'ready')
}

function renderV3EnvironmentSaveControls() {
  const selectedImage = state.v3EnvironmentImages.find((item) => item.imageId === state.v3SelectedEnvironmentImageId)
  const selectedInstalled = v3ReadyInstalledEnvironment(selectedImage)
  const imageSizeBytes = Number(selectedImage?.manifest?.artifact?.sizeBytes || 0)
  const maximumWorkspaceGiB = Math.floor((state.v3EnvironmentRootFreeBytes - 10 * 1024 ** 3 - imageSizeBytes) / 1024 ** 3)
  const capacityAllowed = maximumWorkspaceGiB >= 20 && state.v3EnvironmentWorkspaceGiB <= maximumWorkspaceGiB
  const savePhase = state.v3ImageProgress?.phase || 'saving'
  const saveLabel = state.v3EnvironmentSaving ? ({ reserving: sx('Reserving space…', '正在预留空间…'), starting: sx('Starting download…', '正在开始下载…'), downloading: sx('Downloading…', '正在下载…'), verifying: sx('Verifying…', '正在校验…'), importing: sx('Installing…', '正在安装…'), validating: sx('Validating…', '正在验证…'), saving: sx('Saving…', '正在保存…') } as Record<string, string>)[savePhase] || sx('Preparing…', '正在准备…') : selectedInstalled ? sx('Use ready environment', '使用已就绪环境') : sx('Download and save', '下载并保存')
  const available = Boolean(selectedImage && (selectedInstalled || selectedImage.cloudAvailable !== false))
  return `<div class="v3-environment-save-bar"><button type="button" data-v3-action="environment-save" ${available && state.v3EnvironmentRoot && capacityAllowed && !state.v3EnvironmentSaving ? '' : 'disabled'}>${escapeHTML(saveLabel)}</button></div>`
}

function renderV3EnvironmentCloudLauncher() {
  const localPackageCount = state.v3InstalledEnvironments.length
  const selectedImage = state.v3EnvironmentImages.find((item) => item.imageId === state.v3SelectedEnvironmentImageId)
  const selectedInstalled = v3ReadyInstalledEnvironment(selectedImage)
  const selectedName = selectedImage ? String(selectedImage.manifest?.name || selectedImage.imageId) : 'Choose an environment configuration'
  const freeGiB = Math.floor(state.v3EnvironmentRootFreeBytes / 1024 ** 3)
  const imageBytes = Number(selectedImage?.manifest?.artifact?.sizeBytes || 0)
  const imageGiB = selectedImage ? Math.ceil(imageBytes / 1024 ** 3) : 0
  const systemReserveGiB = 10
  const calculatedMaxGiB = Math.floor((state.v3EnvironmentRootFreeBytes - systemReserveGiB * 1024 ** 3 - imageBytes) / 1024 ** 3)
  const maxGiB = Math.min(2000, Math.max(0, calculatedMaxGiB))
  const allocationAvailable = Boolean(state.v3EnvironmentRoot && maxGiB >= 20)
  const workspaceGiB = allocationAvailable ? Math.min(maxGiB, Math.max(20, state.v3EnvironmentWorkspaceGiB)) : 20
  if (allocationAvailable) state.v3EnvironmentWorkspaceGiB = workspaceGiB
  const capacityText = state.v3EnvironmentRoot
    ? `${freeGiB} GiB free · ${systemReserveGiB} GiB system${selectedImage ? ` · ${imageGiB} GiB image` : ''}`
    : 'Choose a storage root first'
  return `<div class="v3-environment-configurator"><div class="v3-environment-setup-grid"><section class="v3-environment-cloud-launcher"><header><span class="v3-cloud-mark">☁</span><div><strong>Exora Environment Cloud</strong><small>Official images download to Exora's managed cache</small></div><em>${localPackageCount} local package${localPackageCount === 1 ? '' : 's'}</em></header><button class="v3-cloud-selection-bar" type="button" data-v3-action="environment-cloud-open"><strong>${escapeHTML(selectedName)}${selectedInstalled ? ' · installed' : ''}</strong><em>${selectedImage ? 'Change' : 'Choose'} →</em></button></section><section class="v3-environment-storage ${allocationAvailable ? '' : 'capacity-blocked'}"><header><span class="v3-storage-mark">▰</span><div><strong>Virtual environment storage</strong><small>${escapeHTML(capacityText)}</small></div><span class="v3-storage-size-input"><input data-environment-workspace type="number" min="20" max="${Math.max(20, maxGiB)}" step="1" value="${workspaceGiB}" inputmode="numeric" aria-label="Virtual disk allocation in GiB" ${allocationAvailable ? '' : 'disabled'}/><em>GiB</em></span></header><button class="v3-storage-path" type="button" data-v3-action="environment-root-choose"><span>${escapeHTML(state.v3EnvironmentRoot || 'Choose a root folder')}${state.v3EnvironmentRoot && selectedImage && !allocationAvailable ? ' · insufficient capacity' : ''}</span><em>${state.v3EnvironmentRoot ? 'Change' : 'Browse'} →</em></button></section></div></div>`
}

function renderV3EnvironmentCloudModal() {
  if (!state.v3EnvironmentCloudOpen) return ''
  const gpu = (state.v3VMProbe?.gpu || {}) as Record<string, any>
  const visibleImages = state.v3EnvironmentImages.filter((image) => state.v3EnvironmentCloudFilter === 'all' || (state.v3EnvironmentCloudFilter === 'cuda' ? Boolean(image.manifest?.gpu?.required) : String(image.manifest?.os?.distribution || '').toLowerCase() === 'ubuntu'))
  const cards = visibleImages.map((image) => {
    const manifest = image.manifest || {}
    const needsGPU = Boolean(manifest.gpu?.required)
    const compatible = !needsGPU || Boolean(gpu.name)
    const components = Array.isArray(manifest.components) ? manifest.components : []
    const selected = state.v3SelectedEnvironmentImageId === image.imageId
    const installed = v3ReadyInstalledEnvironment(image)
    const downloadable = image.cloudAvailable !== false
    const selectable = compatible && Boolean(installed || downloadable)
    const statusKind = installed ? 'ready' : downloadable ? 'downloadable' : 'unavailable'
    const statusLabel = installed ? sx('Ready locally', '已就绪') : downloadable ? sx('Available to download', '可下载') : sx('Preview only', '暂不可下载')
    const actionLabel = !compatible ? sx('NVIDIA GPU required', '需要 NVIDIA GPU') : !selectable ? sx('Unavailable', '暂不可用') : installed ? selected ? sx('Selected · ready', '已选择 · 已就绪') : sx('Use ready environment', '使用已就绪环境') : selected ? sx('Selected · downloads on save', '已选择 · 保存时下载') : sx('Select to download', '选择并下载')
    const selectionAttributes = selectable ? `data-v3-image-select="${escapeAttr(image.imageId)}" tabindex="0"` : 'aria-disabled="true"'
    const action = `<button type="button" ${selectable ? `data-v3-image-pick="${escapeAttr(image.imageId)}"` : ''} ${selectable ? '' : 'disabled'}>${escapeHTML(actionLabel)}</button>`
    return `<article class="v3-cloud-image-card ${needsGPU ? 'gpu' : 'cpu'} ${selected ? 'selected' : ''} ${statusKind}" ${selectionAttributes}><header><span>${needsGPU ? 'CUDA' : 'LINUX'}</span><em class="v3-cloud-image-status ${statusKind}">${escapeHTML(statusLabel)}</em></header><div class="v3-cloud-image-symbol">${needsGPU ? 'Cu' : 'U'}</div><h3>${escapeHTML(String(manifest.name || image.imageId))}</h3><p>${escapeHTML(String(manifest.description || 'Official Exora environment'))}</p><div class="v3-cloud-image-facts"><span><small>System</small><strong>${escapeHTML(`${manifest.os?.distribution || 'Ubuntu'} ${manifest.os?.version || '24.04'}`)}</strong></span><span><small>Download</small><strong>${v3FormatBytes(Number(manifest.artifact?.sizeBytes || 0))}</strong></span><span><small>Backend</small><strong>WSL2 · amd64</strong></span><span><small>Acceleration</small><strong>${needsGPU ? `NVIDIA · CUDA ${escapeHTML(String(manifest.gpu?.cudaVersion || '12.8'))}` : 'CPU'}</strong></span></div><div class="v3-cloud-components">${components.map((item: string) => `<span>${escapeHTML(item)}</span>`).join('')}</div>${action}</article>`
  }).join('')
  return `<div class="v3-environment-cloud" role="dialog" aria-modal="true" aria-labelledby="v3-environment-cloud-title"><button class="v3-environment-cloud-scrim" type="button" data-v3-action="environment-cloud-close" aria-label="Close environment cloud"></button><section class="v3-environment-cloud-panel"><header class="v3-environment-cloud-head"><div><span>EXORA CLOUD</span><h2 id="v3-environment-cloud-title">${escapeHTML(sx('Environment library', '环境库'))}</h2><p>${escapeHTML(sx('Choose a ready local environment or download a signed environment from Exora Cloud.', '选择本地已就绪环境，或从 Exora Cloud 下载签名环境。'))}</p></div><button class="ghost" type="button" data-v3-action="environment-cloud-close" aria-label="Close">×</button></header><nav class="v3-environment-cloud-filters"><button class="${state.v3EnvironmentCloudFilter === 'all' ? 'active' : ''}" type="button" data-v3-environment-filter="all">${escapeHTML(sx('All environments', '全部环境'))} <em>${state.v3EnvironmentImages.length}</em></button><button class="${state.v3EnvironmentCloudFilter === 'ubuntu' ? 'active' : ''}" type="button" data-v3-environment-filter="ubuntu">Ubuntu</button><button class="${state.v3EnvironmentCloudFilter === 'cuda' ? 'active' : ''}" type="button" data-v3-environment-filter="cuda">CUDA</button><span>WSL2 · Windows x64</span></nav><div class="v3-environment-cloud-grid">${cards}</div><footer><span>${escapeHTML(sx('Ready environments are already installed and validated on this PC.', '已就绪环境已在本机安装并通过验证。'))}</span><strong>${escapeHTML(sx('Signed cloud catalog', '签名云目录'))}</strong></footer></section></div>`
}

function v3ComputePriceFromState() {
  return {
    model: 'compute_time_v2', currency: 'USDC', unit: 'minute',
    amountAtomicPerMinute: Math.max(1, Math.round(state.v3PricePerMinute * 1_000_000)),
    baseFeeAtomic: state.v3BaseFeeEnabled ? Math.max(0, Math.round(state.v3BaseFee * 1_000_000)) : 0,
    ...(state.v3LongDiscountEnabled && state.v3LongDiscountPercent > 0 ? { longDurationDiscount: {
      everyMinutes: state.v3LongDiscountAfterMinutes,
      additionalBpsOff: Math.round(state.v3LongDiscountPercent * 100),
      minimumRateBps: Math.round(state.v3LongDiscountMinimumPricePercent * 100),
    } } : {}),
  }
}

function v3ComputeLimitsFromState() {
  return { minMinutes: state.v3MinimumMinutes, maxMinutes: state.v3MaximumMinutes }
}

function v3ComputeWorkloadPolicy() {
  return { policyVersion: 'compute_load_v1', sustainedCompute: state.v3AllowSustainedCompute ? 'allowed' : 'burst_only', cryptocurrencyMining: 'prohibited' }
}

function v3ComputePerformancePolicy() {
  return { probeVersion: 'dual_probe_v1', minimumDeliveryBps: 8500 }
}

function v3EnvironmentPricingSettings() {
  return {
    baseFee: state.v3BaseFee, baseFeeEnabled: state.v3BaseFeeEnabled,
    pricePerMinute: state.v3PricePerMinute, minimumMinutes: state.v3MinimumMinutes, maximumMinutes: state.v3MaximumMinutes,
    longDiscountAfterMinutes: state.v3LongDiscountAfterMinutes, longDiscountPercent: state.v3LongDiscountPercent,
    longDiscountMinimumPricePercent: state.v3LongDiscountMinimumPricePercent, longDiscountEnabled: state.v3LongDiscountEnabled,
    allowSustainedCompute: state.v3AllowSustainedCompute,
  }
}

function v3ComputePreviewAtomic(durationMinutes: number) {
  const price = v3ComputePriceFromState()
  const rate = price.amountAtomicPerMinute
  const duration = Math.max(1, Math.round(durationMinutes))
  let weighted = 0
  const discount = price.longDurationDiscount
  if (discount) {
    let position = 0
    while (position < duration) {
      const step = Math.floor(position / discount.everyMinutes)
      const rateBps = Math.max(discount.minimumRateBps, 10000 - step * discount.additionalBpsOff)
      const segment = Math.min(duration - position, (step + 1) * discount.everyMinutes - position)
      weighted += rate * segment * rateBps
      position += segment
    }
  }
  const compute = discount ? Math.round(weighted / 10000) : rate * duration
  return compute + price.baseFeeAtomic
}

function renderV3ComputeOfferFacts() {
  const probe = state.v3VMProbe || {}
  const hardware = (probe.hardware || {}) as Record<string, any>
  const network = (probe.network || {}) as Record<string, any>
  const gpu = (probe.gpu || {}) as Record<string, any>
  const windows = probe.hostOS === 'windows' || navigator.userAgent.includes('Windows')
  const facts = [
    'No direct Internet · Exora terminal · WebRTC P2P files',
    windows ? 'Managed WSL2 · shared driver' : 'KVM/libvirt · hardware isolated',
    `${Number(hardware.Cores || 0) || 'Measured'} CPU · ${hardware.MemoryBytes ? `${Math.round(Number(hardware.MemoryBytes) / 1024 ** 3)} GiB RAM` : 'measured RAM'}`,
    gpu.name || 'CPU environment',
    `${state.v3EnvironmentWorkspaceGiB} GiB reset workspace`,
    network.downloadMbps ? `${Math.round(Number(network.downloadMbps))} Mbps measured` : 'Network measured before publish',
    'Failed provisioning refunded · early release non-refundable',
    'Cryptocurrency mining prohibited',
    'Dual performance monitoring',
  ]
  const mode = state.v3AllowSustainedCompute ? 'Sustained compute allowed' : windows ? 'Burst only · Windows monitoring-only Preview' : 'Burst only · Linux host throttling'
  return `<div class="v3-performance-policy"><div><strong>Allow sustained high-performance workloads</strong><small>${escapeHTML(mode)}</small></div><button class="v3-discount-toggle" type="button" role="switch" aria-checked="${state.v3AllowSustainedCompute}" data-v3-action="sustained-performance-toggle"><span></span><em>${state.v3AllowSustainedCompute ? 'On' : 'Off'}</em></button></div><div class="v3-offer-facts">${facts.map((fact) => `<span>${escapeHTML(String(fact))}</span>`).join('')}</div>`
}

function renderV3ComputePricing(recommendedPrice: string) {
  if (!(state.v3PricePerMinute > 0)) state.v3PricePerMinute = Math.max(0.001, Number(recommendedPrice || 0.01))
  const previewMinutes = [...new Set([state.v3MinimumMinutes, state.v3LongDiscountEnabled ? state.v3LongDiscountAfterMinutes : 60, state.v3MaximumMinutes])].filter((minutes) => minutes >= state.v3MinimumMinutes && minutes <= state.v3MaximumMinutes)
  const previews = previewMinutes.map((minutes) => `<span><small>${minutes} min</small><strong>${v3AtomicMoney(v3ComputePreviewAtomic(minutes), 'USDC')}</strong></span>`).join('')
  return `<div class="v3-pricing-inline"><div class="v3-inline-base-fee ${state.v3BaseFeeEnabled ? 'enabled' : 'disabled'}" role="group" aria-label="Base fee settings"><span class="v3-price-field-title"><i>1</i><strong>Start fee</strong><button class="v3-discount-toggle" type="button" role="switch" aria-checked="${state.v3BaseFeeEnabled}" data-v3-action="base-fee-toggle"><span></span><em>${state.v3BaseFeeEnabled ? 'On' : 'Off'}</em></button></span><span class="v3-inline-price-input"><b>$</b><input aria-label="Start fee per lease" data-v3-pricing="baseFee" type="number" min="0" step="0.01" value="${state.v3BaseFee || ''}" placeholder="0.00" inputmode="decimal" ${state.v3BaseFeeEnabled ? '' : 'disabled'}/><em>once</em></span></div><label><span class="v3-price-field-title"><i>2</i><strong>Minute price</strong></span><span class="v3-inline-price-input"><b>$</b><input aria-label="Price per minute" data-v3-pricing="pricePerMinute" type="number" min="0.000001" step="0.000001" value="${state.v3PricePerMinute}" inputmode="decimal" required/><em>USDC/min</em></span></label><div class="v3-inline-rental-window" role="group" aria-label="Rental time limits"><span class="v3-price-field-title"><i>3</i><strong>Rental time</strong></span><span class="v3-inline-rental-inputs"><span class="v3-inline-price-input"><input aria-label="Minimum rental minutes" data-v3-pricing="minimumMinutes" type="number" min="1" max="10080" step="1" value="${state.v3MinimumMinutes}" required/><em>min</em></span><span class="v3-inline-price-input"><input aria-label="Maximum cumulative rental minutes" data-v3-pricing="maximumMinutes" type="number" min="1" max="10080" step="1" value="${state.v3MaximumMinutes}" required/><em>max</em></span></span></div><div class="v3-inline-discount ${state.v3LongDiscountEnabled ? 'enabled' : 'disabled'}" role="group" aria-label="Tiered discount settings"><span class="v3-price-field-title"><i>4</i><strong>Long-rental discount</strong><button class="v3-discount-toggle" type="button" role="switch" aria-checked="${state.v3LongDiscountEnabled}" data-v3-action="discount-toggle"><span></span><em>${state.v3LongDiscountEnabled ? 'On' : 'Off'}</em></button></span><span class="v3-inline-discount-inputs"><span class="v3-inline-price-input"><input aria-label="Discount interval in minutes" data-v3-pricing="longDiscountAfterMinutes" type="number" min="1" max="${state.v3MaximumMinutes}" step="1" value="${state.v3LongDiscountAfterMinutes}" ${state.v3LongDiscountEnabled ? '' : 'disabled'}/><em>min each</em></span><span class="v3-inline-price-input"><input aria-label="Additional discount percentage per interval" data-v3-pricing="longDiscountPercent" type="number" min="1" max="90" step="1" value="${state.v3LongDiscountPercent || ''}" placeholder="5" ${state.v3LongDiscountEnabled ? '' : 'disabled'}/><em>% each</em></span><span class="v3-inline-price-input"><input aria-label="Minimum payable percentage of normal price" data-v3-pricing="longDiscountMinimumPricePercent" type="number" min="1" max="100" step="1" value="${state.v3LongDiscountMinimumPricePercent}" ${state.v3LongDiscountEnabled ? '' : 'disabled'}/><em>% floor</em></span></span></div></div><div class="v3-price-preview"><div><strong>Buyer price preview</strong><small>Start fee included · settled in USDC</small></div>${previews}</div>${renderV3ComputeOfferFacts()}<input type="hidden" name="workspaceGiB" value="${state.v3EnvironmentWorkspaceGiB}"/><input type="hidden" name="price" value="${state.v3PricePerMinute}"/>`
}

function loadV3ComputeTermsForEditing(listing: V3Listing) {
  const price = (listing.price || {}) as Record<string, any>
  const limits = (listing.limits || {}) as Record<string, any>
  const isV2 = price.model === 'compute_time_v2'
  state.v3PricePerMinute = isV2
    ? Math.max(0.000001, Number(price.amountAtomicPerMinute || 0) / 1_000_000)
    : Math.max(0.000001, Number(price.amount || price.rate || 0.01))
  state.v3BaseFee = isV2 ? Math.max(0, Number(price.baseFeeAtomic || 0) / 1_000_000) : 0
  state.v3BaseFeeEnabled = state.v3BaseFee > 0
  state.v3MinimumMinutes = Math.max(1, Math.min(10080, Math.trunc(Number(limits.minMinutes || 10))))
  state.v3MaximumMinutes = Math.max(state.v3MinimumMinutes, Math.min(10080, Math.trunc(Number(limits.maxMinutes || 240))))
  const discount = isV2 && price.longDurationDiscount && typeof price.longDurationDiscount === 'object'
    ? price.longDurationDiscount as Record<string, any>
    : undefined
  state.v3LongDiscountEnabled = Boolean(discount)
  state.v3LongDiscountAfterMinutes = Math.max(1, Math.trunc(Number(discount?.everyMinutes || 60)))
  state.v3LongDiscountPercent = Math.max(0, Number(discount?.additionalBpsOff || 0) / 100)
  state.v3LongDiscountMinimumPricePercent = Math.max(1, Math.min(100, Number(discount?.minimumRateBps || 5000) / 100))
  state.v3AllowSustainedCompute = String(listing.workloadPolicy?.sustainedCompute || 'allowed') !== 'burst_only'
}

function renderV3ComputeTermsEditor(listing: V3Listing) {
  if (state.v3EditingListingId !== listing.listingId) return ''
  return `<form class="v3-listing-detail-section v3-listing-terms-editor" data-v3-compute-terms-form data-listing-id="${escapeAttr(listing.listingId)}"><header><span>COMMERCIAL TERMS</span><strong>Changes apply only to new leases</strong></header>${renderV3ComputePricing('0.01')}<div class="v3-form-actions"><button class="ghost" type="button" data-v3-compute-terms-cancel>Cancel</button><button type="submit">Save terms</button></div></form>`
}

function renderV3VMPage() {
  if (!state.v3ListingsLoaded) {
    const failed = Boolean(state.v3SellerError)
    return `<div class="v3-vm-onboarding v3-application-flow"><section class="v3-console-panel v3-vm-slot-check"><div class="v3-step-heading"><span>${icon(failed ? ShieldAlert : RefreshCw)}</span><div><strong>${failed ? 'Could not verify this device\'s VM Listing slot' : 'Checking this device\'s VM Listing slot'}</strong><small>${escapeHTML(failed ? state.v3SellerError || 'Cloud verification failed.' : 'Cloud must confirm that this Dock has no existing VM Listing before scanning or reserving disk space.')}</small></div><button type="button" data-v3-vm-slot-refresh ${failed ? '' : 'disabled'}>${failed ? 'Try again' : 'Checking…'}</button></div></section></div>`
  }
  const slot = state.v3VMListingConstraint
  if (!slot.available && slot.listingId) {
    const status = v3ListingStatusMeta(slot.status || 'draft')
    return `<div class="v3-vm-onboarding v3-application-flow"><section class="v3-console-panel v3-vm-slot-occupied"><div class="v3-step-heading"><span>${icon(ShieldCheck)}</span><div><strong>This device already has a VM Listing</strong><small>One Dock can keep one VM offer. Manage or delete the existing Listing before creating another.</small></div><button type="button" data-v3-vm-existing-listing="${escapeAttr(slot.listingId)}">Manage Listing</button></div><div class="v3-host-facts"><span><small>Listing</small><strong>${escapeHTML(slot.listingId)}</strong><em>Provider device slot</em></span><span><small>Status</small><strong>${escapeHTML(status.label)}</strong><em>The slot is released only after deletion</em></span></div></section></div>`
  }
  const probe = state.v3VMProbe
  const windows = probe?.hostOS === 'windows'
  if (windows || (!probe && navigator.userAgent.includes('Windows'))) {
    const hardware = (probe?.hardware || {}) as Record<string, any>
    const network = (probe?.network || {}) as Record<string, any>
    const gpu = (probe?.gpu || {}) as Record<string, any>
    const selectedImage = state.v3EnvironmentImages.find((image) => image.imageId === state.v3SelectedEnvironmentImageId) || state.v3EnvironmentImages[0]
    const selectedInstalled = selectedImage ? state.v3InstalledEnvironments.find((item) => item.attestation?.imageId === selectedImage.imageId && item.attestation?.imageVersion === selectedImage.version) : undefined
    const memoryGiB = Number(hardware.MemoryBytes || 0) / 1024 ** 3
    const freeDiskGiB = Math.floor(Number(hardware.FreeDiskBytes || 0) / 1024 ** 3)
    const recommendedPrice = Math.max(0.01, 0.008 + Number(gpu.memoryMiB || 0) / 1024 * 0.0015 + Number(hardware.Cores || 0) * 0.00035 + memoryGiB * 0.00012 + (selectedImage?.manifest?.gpu?.required ? 0.008 : 0) + (Number(network.downloadMbps || 0) > 500 ? 0.003 : 0)).toFixed(3)
    const images = renderV3EnvironmentCloudLauncher()
    const environmentReady = Boolean(probe && selectedInstalled && state.v3VMTemplate?.valid)
    const step1: V3WizardStepState = state.v3HostScanning ? 'busy' : probe ? 'complete' : 'available'
    const step2: V3WizardStepState = !probe ? 'locked' : state.v3EnvironmentSaving ? 'busy' : environmentReady ? 'complete' : 'available'
    const step3: V3WizardStepState = !environmentReady ? 'locked' : 'available'
    return `<div class="v3-vm-onboarding v3-application-flow"><section class="v3-console-panel v3-host-scan ${v3WizardStepClass(step1)}"><div class="v3-step-heading"><span>1</span><div><strong>Scan this PC</strong><small>Hardware, available capacity, network speed and public location</small></div>${renderV3HostScanButton(Boolean(probe))}</div>${probe ? `<div class="v3-host-facts"><span><small>Processor</small><strong>${escapeHTML(String(hardware.Cpu || 'Unknown CPU'))}</strong><em>${Number(hardware.Cores || 0)} cores · ${Number(hardware.LogicalProcessors || 0)} threads</em></span><span><small>Memory</small><strong>${memoryGiB.toFixed(0)} GiB</strong><em>${(Number(hardware.FreeMemoryBytes || 0) / 1024 ** 3).toFixed(0)} GiB currently free</em></span><span><small>GPU</small><strong>${escapeHTML(String(gpu.name || 'No NVIDIA GPU detected'))}</strong><em>${gpu.memoryMiB ? `${(Number(gpu.memoryMiB) / 1024).toFixed(0)} GiB VRAM · driver ${escapeHTML(String(gpu.driverVersion || ''))}` : 'CPU environments available'}</em></span><span><small>Storage</small><strong>${freeDiskGiB} GiB free</strong><em>Fixed reservation before listing</em></span><span><small>Network</small><strong>↓ ${Number(network.downloadMbps || 0)} · ↑ ${Number(network.uploadMbps || 0)} Mbps</strong><em>${Number(network.latencyMs || 0)} ms to Exora Cloud</em></span><span><small>Public location</small><strong>${escapeHTML([network.city, network.region, network.country].filter(Boolean).join(', ') || 'Location unavailable')}</strong><em>${escapeHTML(String(network.publicIp || 'IP unavailable'))}</em></span></div>` : '<div class="v3-scan-empty"><strong>Know exactly what can be listed</strong><span>Exora reads capacity locally and measures the route to Exora Cloud. No hardware names need to be entered manually.</span></div>'}</section>
      <section class="v3-console-panel ${v3WizardStepClass(step2)}" ${step2 === 'locked' ? 'inert aria-disabled="true"' : ''}><div class="v3-step-heading v3-environment-step-heading"><span>2</span><div><strong>Choose an environment</strong><small>${step2 === 'locked' ? 'Complete Step 1 to choose storage and a signed environment' : 'Install and validate a signed, disposable Linux package'}</small></div>${renderV3EnvironmentSaveControls()}</div><div class="v3-environment-list">${images || (state.v3EnvironmentCatalogOffline ? '<div class="v3-scan-empty"><strong>Connect Exora Cloud to load environments</strong><span>The local hardware scan remains available, but signed Ubuntu and CUDA packages require a linked Dock account.</span></div>' : '<p class="empty-copy">Scan this PC to load compatible environments.</p>')}</div></section>
      <form class="v3-console-panel v3-provider-form ${v3WizardStepClass(step3)}" data-v3-form="vm" ${step3 === 'locked' ? 'inert aria-disabled="true"' : ''}><div class="v3-step-heading"><span>3</span><div><strong>Price and submit</strong><small>${step3 === 'locked' ? 'Complete Step 2 to configure pricing' : 'Creates a private Listing draft; publication happens only in Listings'}</small></div><button type="submit" class="v3-direct-publish" ${environmentReady ? '' : 'disabled'}>Submit to Listings</button></div>${renderV3ComputePricing(recommendedPrice)}<p class="v3-listing-note">Submission saves a private draft and does not publish it.</p></form></div>`
  }
  const domains = state.v3VMDomains.map((domain) => `<label class="v3-domain-row"><input type="radio" name="domain" value="${escapeAttr(domain.name)}" ${domain.eligible ? '' : 'disabled'}/><span><strong>${escapeHTML(domain.name)}</strong><small>${escapeHTML(domain.state)}</small></span></label>`).join('')
  const linuxTemplateReady = Boolean(state.v3VMTemplate?.valid)
  return `<div class="v3-seller-grid v3-vm-onboarding"><section class="v3-console-panel ${v3WizardStepClass(probe ? 'complete' : 'available')}"><div class="v3-step-heading"><span>1</span><div><strong>Scan Linux KVM host</strong><small>Choose an eligible powered-off domain after the hardware scan.</small></div><button class="ghost" type="button" data-v3-action="vm-probe">${probe ? 'Scan again' : 'Scan host'}</button></div>${probe ? `<div class="v3-metric-grid"><span><small>KVM</small><strong>${escapeHTML(probe.kvm)}</strong></span><span><small>IOMMU</small><strong>${escapeHTML(probe.iommu)}</strong></span><span><small>GPUs</small><strong>${Array.isArray(probe.gpus) ? probe.gpus.length : 0}</strong></span><span><small>OS</small><strong>${escapeHTML(probe.os)}</strong></span></div>` : '<p class="empty-copy">Scan a Linux provider host. Windows and macOS return unsupported_host.</p>'}<div class="v3-domain-list">${domains}</div></section>
    <form class="v3-application-flow v3-provider-form" data-v3-form="vm"><section class="v3-console-panel ${v3WizardStepClass(!probe ? 'locked' : linuxTemplateReady ? 'complete' : 'available')}" ${probe ? '' : 'inert aria-disabled="true"'}><div class="v3-step-heading"><span>2</span><div><strong>Import and validate Golden Image</strong><small>${probe ? 'Import the selected domain, then validate its disposable runtime.' : 'Complete Step 1 to import a Golden Image.'}</small></div></div><div class="v3-form-actions"><button type="button" class="ghost" data-v3-action="vm-import" ${probe ? '' : 'disabled'}>Import</button><button type="button" data-v3-action="vm-validate" ${state.v3VMTemplate ? '' : 'disabled'}>Run validation</button></div>${state.v3VMTemplate ? `<pre>${escapeHTML(JSON.stringify(state.v3VMTemplate, null, 2))}</pre>` : '<p class="empty-copy">No Golden Image has been imported.</p>'}</section><section class="v3-console-panel ${v3WizardStepClass(linuxTemplateReady ? 'available' : 'locked')}" ${linuxTemplateReady ? '' : 'inert aria-disabled="true"'}><div class="v3-step-heading"><span>3</span><div><strong>Capacity, price and submit</strong><small>${linuxTemplateReady ? 'Creates a private Listing draft; publication happens only in Listings.' : 'Complete image validation to configure the offer.'}</small></div><button type="submit" class="v3-direct-publish" ${linuxTemplateReady ? '' : 'disabled'}>Submit to Listings</button></div><label>Title<input name="title" required placeholder="H100 CUDA environment"/></label><label>Text description<textarea name="description" required></textarea></label>${renderV3ComputePricing('0.01')}</section></form></div>`
}

const v3ResourceSelectOptions: Record<V3ResourceSelectName, Array<{ value: string; label: string }>> = {
  license: [
    { value: 'commercial', label: 'Commercial use' },
    { value: 'research', label: 'Research only' },
    { value: 'personal', label: 'Personal use' },
    { value: 'custom', label: 'Custom terms' },
  ],
}

function renderV3ResourceSelect(name: V3ResourceSelectName, label: string, value: string) {
  const options = v3ResourceSelectOptions[name]
  const selected = options.find((option) => option.value === value) || options[0]
  const listId = `v3-resource-${name}-listbox`
  return `<div class="v3-resource-custom-select" data-v3-resource-select="${name}">
    <input type="hidden" name="${name}" value="${escapeAttr(selected.value)}" data-v3-resource-select-input="${name}"/>
    <button class="v3-resource-select-trigger" type="button" role="combobox" aria-label="${escapeAttr(label)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${listId}" data-v3-resource-select-trigger="${name}"><span>${escapeHTML(selected.label)}</span><i aria-hidden="true"></i></button>
    <div class="v3-resource-select-popover" id="${listId}" role="listbox" aria-label="${escapeAttr(label)}" data-v3-resource-select-list="${name}">
      ${options.map((option) => `<button type="button" role="option" aria-selected="${option.value === selected.value}" tabindex="-1" class="${option.value === selected.value ? 'selected' : ''}" data-v3-resource-select-option="${name}" data-value="${escapeAttr(option.value)}"><span>${escapeHTML(option.label)}</span><i aria-hidden="true">✓</i></button>`).join('')}
    </div>
  </div>`
}

function renderV3ResourcesPage() {
  const progress = state.v3AssetProgress
  const packaging = progress?.phase === 'selecting' || progress?.phase === 'packaging'
  const busy = packaging || state.v3ResourceSubmitting
  const filesReady = state.v3ResourceSources.length > 0
  const detailsReady = Boolean(state.v3ResourceTitle.trim() && state.v3ResourceDescription.trim() && state.v3ResourceCategory && state.v3ResourceLicense && state.v3ResourceGrantHours >= 1 && state.v3ResourceGrantHours <= 720)
  const itemsReady = filesReady && state.v3ResourceSources.every((file) => file.price > 0)
  const step1: V3WizardStepState = packaging ? 'busy' : itemsReady ? 'complete' : 'available'
  const step2: V3WizardStepState = !filesReady ? 'locked' : detailsReady ? 'complete' : 'available'
  const canSubmit = itemsReady && detailsReady && !busy
  const itemCards = state.v3ResourceSources.map((file) => {
    const extension = (file.name.split('.').pop() || 'FILE').slice(0, 5).toUpperCase()
    return `<article class="v3-resource-file-config" data-resource-token="${escapeAttr(file.token)}"><div class="v3-resource-file-summary"><span class="v3-resource-file-type">${escapeHTML(extension)}</span><div class="v3-resource-file-identity"><strong>${escapeHTML(file.name)}</strong><small>${escapeHTML(v3FormatBytes(file.sizeBytes))} · SHA-256 ${escapeHTML(file.sha256.slice(0, 12))}…</small></div></div><label class="v3-resource-file-tags"><span>Tags</span><input name="itemTags:${escapeAttr(file.token)}" value="${escapeAttr(file.tags.join(', '))}" placeholder="source, windows, template"/></label><label class="v3-resource-file-price"><span>Price</span><span class="v3-resource-input-unit"><b>$</b><input name="itemPrice:${escapeAttr(file.token)}" type="number" min="0.01" step="0.01" value="${file.price || ''}" required/><em>USDC</em></span></label><button class="ghost danger v3-resource-file-remove" type="button" data-v3-resource-remove="${escapeAttr(file.token)}" aria-label="Remove ${escapeAttr(file.name)}">×</button></article>`
  }).join('')
  const pickerStatus = packaging ? `${progress?.percent || 0}%` : `${state.v3ResourceSources.length} selected`
  const submitLabel = state.v3ResourceSubmitting ? `Uploading ${progress?.percent || 0}%` : state.v3ResourceTargetSheet ? 'Add files to Res sheet' : 'Create private Res sheet'
  return `<form class="v3-application-flow v3-provider-form" data-v3-form="resources">
    <section class="v3-console-panel ${v3WizardStepClass(step1)}"><div class="v3-step-heading"><span>1</span><div><strong>Add files, prices and tags</strong><small>Every file is sold independently, so configure its price and tags as soon as you add it.</small></div>${filesReady ? `<button class="danger ghost" type="button" data-v3-action="resource-clear-files" ${busy ? 'disabled' : ''}>Clear</button>` : ''}</div><fieldset class="v3-wizard-step-content" ${busy ? 'disabled' : ''}>${renderV3SharedFilePicker('choose-files', packaging ? 'Hashing selected files…' : 'Choose or drop files', ['Any file format · 1 GiB per file', 'Multiple files stay separate and are never auto-packaged'], pickerStatus, busy)}<div class="v3-resource-safety-strip"><span><strong>One file = one purchase</strong><small>Each item gets its own price and tags</small></span><span><strong>Folders are rejected</strong><small>Compress programs or complete datasets first</small></span><span><strong>Immutable delivery</strong><small>New content creates a new sellable item</small></span></div><div class="v3-resource-file-config-list">${itemCards || renderV3SharedFileEmpty('No sellable items', 'Choose or drop files above to configure them.')}</div></fieldset></section>
    <section class="v3-console-panel ${v3WizardStepClass(step2)}"><div class="v3-step-heading"><span>2</span><div><strong>${state.v3ResourceTargetSheet ? 'Review existing Res sheet and submit' : 'Describe and submit the Res sheet'}</strong><small>${state.v3ResourceTargetSheet ? 'New files inherit the existing category, authorization scope and access window.' : 'Set shared context and authorization once; every file inherits it.'}</small></div><button type="submit" class="v3-direct-publish" ${canSubmit ? '' : 'disabled'}>${escapeHTML(submitLabel)}</button></div><fieldset class="v3-wizard-step-content" ${step2 === 'locked' || busy || state.v3ResourceTargetSheet ? 'disabled' : ''}><div class="v3-resource-sheet-settings"><label>Sheet title<input name="title" value="${escapeAttr(state.v3ResourceTitle)}" required placeholder="Developer tools and releases"/></label><label>Resource type<select name="category" required><option value="software" ${state.v3ResourceCategory === 'software' ? 'selected' : ''}>Software &amp; code</option><option value="dataset" ${state.v3ResourceCategory === 'dataset' ? 'selected' : ''}>Dataset</option><option value="design" ${state.v3ResourceCategory === 'design' ? 'selected' : ''}>Design assets</option><option value="document" ${state.v3ResourceCategory === 'document' ? 'selected' : ''}>Documents</option><option value="media" ${state.v3ResourceCategory === 'media' ? 'selected' : ''}>Media</option><option value="other" ${state.v3ResourceCategory === 'other' ? 'selected' : ''}>Other</option></select></label><label class="v3-resource-description">Detailed content<textarea name="description" required placeholder="Explain what this resource collection contains, prerequisites, versions and intended use.">${escapeHTML(state.v3ResourceDescription)}</textarea></label><label>Authorization scope${renderV3ResourceSelect('license', 'Authorization scope', state.v3ResourceLicense)}</label><label>Access window<input name="grantHours" type="number" min="1" max="720" step="1" value="${state.v3ResourceGrantHours}" required/><small>Hours after each file purchase</small></label></div></fieldset></section>
  </form>`
}

function endpointAgentPrompt() {
  const files = state.v3EndpointMaterials.map((file) => `- ${file.name}: ${file.localPath}`).join('\n') || '- No files selected yet'
  return `You are normalizing a seller-operated local HTTP service for Exora Endpoint. Read every material and call exora.save_endpoint_draft exactly once.\n\nDraft ID: ${state.v3EndpointDraftId}\nExpected version: ${state.v3EndpointDraft?.version || 0}\n\nMaterials:\n${files}\n\nRules:\n- Produce ExoraServiceManifest v1 with exactly interface, delivery, operationPolicies, and pricingTemplate.\n- Normalize the complete interface to OpenAPI 3.1 without changing confirmed Method, Path, or Schema semantics.\n- Set delivery to dock_tunnel. Support only HTTP/JSON request_response and text/event-stream server_stream.\n- Never include a URL, endpointId, credentials, runtime settings, seller attestation, or publish instructions.\n- Every OpenAPI operationId must have exactly one policy. Variable pricing requires a per-invocation cap.\n- Include an Agent normalization audit and put uncertain fields in unresolvedFields.`
}

function renderV3SharedFilePicker(action: string, title: string, details: string[], status = '', disabled = false) {
  const acceptsDrop = action === 'choose-files' || action === 'endpoint-materials-add' || action === 'api-materials-add'
  return `<button class="v3-shared-file-picker" type="button" data-v3-action="${escapeAttr(action)}" ${acceptsDrop ? `data-v3-file-drop="${escapeAttr(action)}"` : ''} ${disabled ? 'disabled' : ''}><span class="v3-shared-file-picker-icon" aria-hidden="true">+</span><span><strong>${escapeHTML(title)}</strong>${details.map((detail) => `<small>${escapeHTML(detail)}</small>`).join('')}</span>${status ? `<em>${escapeHTML(status)}</em>` : ''}</button>`
}

function renderV3AgentMaterialPicker(action: 'endpoint-materials-add' | 'api-materials-add') {
  const importing = action === 'endpoint-materials-add' ? state.v3EndpointMaterialsImporting : state.v3APIMaterialsImporting
  return renderV3SharedFilePicker(action, importing ? 'Adding files…' : 'Choose or drop files here', ['OpenAPI, docs, examples and text code files · 5 MiB each, 20 files, 20 MiB total', 'Binary files are rejected; all accepted materials remain local'], importing ? 'Processing…' : 'Browse or drop', importing)
}

function renderV3SharedFileRow(file: { name: string; sizeBytes: number; extension?: string }, trailing: string) {
  const extension = (file.extension || (file.name.includes('.') ? file.name.split('.').pop() : '') || 'FILE').slice(0, 8).toUpperCase()
  return `<div class="v3-shared-file-row"><span class="v3-shared-file-type">${escapeHTML(extension)}</span><span class="v3-shared-file-name"><strong>${escapeHTML(file.name)}</strong><small>${v3FormatBytes(file.sizeBytes)} · stored locally</small></span>${trailing}</div>`
}

function renderV3SharedFileEmpty(title: string, detail: string) {
  return `<div class="v3-shared-file-empty"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(detail)}</span></div>`
}

function renderV3AgentPromptPanel(options: {
  title: string
  draftId: string
  expectedVersion: number
  prompt: string
  copyAction: string
  refreshAction: string
  checkAction: string
  checkDisabled?: boolean
}) {
  const promptKind = options.copyAction.startsWith('endpoint-') ? 'endpoint' : 'api_bridge'
  const expanded = localStorage.getItem(`exora.agentPrompt.${promptKind}.expanded`) === 'true'
  const compactDraftId = options.draftId.length > 24
    ? `${options.draftId.slice(0, 10)}…${options.draftId.slice(-7)}`
    : options.draftId
  return `<div class="v3-api-prompt"><details class="v3-api-prompt-disclosure" data-v3-agent-prompt="${promptKind}" ${expanded ? 'open' : ''}>
    <summary class="v3-api-prompt-header">
      <div class="v3-api-prompt-heading"><div><small>Agent workspace</small><strong>${escapeHTML(options.title)}</strong></div></div>
      <div class="v3-api-prompt-summary-side"><div class="v3-api-prompt-meta"><span><small>Draft</small><code title="${escapeAttr(options.draftId)}">${escapeHTML(compactDraftId)}</code></span><span><small>Expected</small><strong>v${options.expectedVersion}</strong></span></div><span class="v3-api-prompt-toggle"><em class="show">Show prompt</em><em class="hide">Hide prompt</em><i aria-hidden="true"></i></span></div>
    </summary>
    <textarea readonly spellcheck="false" aria-label="${escapeAttr(options.title)}">${escapeHTML(options.prompt)}</textarea>
  </details><footer class="v3-api-prompt-footer"><p><strong>Next</strong><span>Run these instructions in your connected Agent, then check the saved draft.</span></p><div><button type="button" data-v3-action="${escapeAttr(options.copyAction)}">Copy prompt</button><button class="ghost" type="button" data-v3-action="${escapeAttr(options.refreshAction)}">Refresh</button><button class="ghost" type="button" data-v3-action="${escapeAttr(options.checkAction)}" ${options.checkDisabled ? 'disabled' : ''}>Check draft</button></div></footer></div>`
}

function renderV3ManualServiceFallback(kind: 'endpoint' | 'api_bridge') {
  const endpoint = kind === 'endpoint'
  const failedRunId = endpoint ? state.v3EndpointFailedRunId : state.v3APIFailedRunId
  if (!failedRunId) return ''
  const reason = endpoint ? state.v3EndpointFallbackReason : state.v3APIFallbackReason
  const manifest = endpoint ? state.v3EndpointFallbackManifest : state.v3APIFallbackManifest
  const title = endpoint ? state.v3EndpointDraft?.title || '' : state.v3APITitle
  const description = endpoint ? state.v3EndpointDraft?.description || '' : state.v3APIDescription
  const prefix = endpoint ? 'endpoint' : 'api'
  return `<details class="v3-api-auth-card v3-manual-fallback" open><summary><strong>Audited manual fallback</strong></summary><p>The Agent draft check failed. Paste a complete ExoraServiceManifest v1; the same deterministic OpenAPI 3.1 validation still applies.</p><div class="v3-api-connection-grid"><label>Service title<input name="${prefix}FallbackTitle" value="${escapeAttr(title)}"/></label><label>Failure reason<input name="${prefix}FallbackReason" value="${escapeAttr(reason)}" placeholder="Why manual fallback is required"/></label></div><label>Description<textarea name="${prefix}FallbackDescription">${escapeHTML(description)}</textarea></label><label>ExoraServiceManifest JSON<textarea name="${prefix}FallbackManifest" spellcheck="false">${escapeHTML(manifest)}</textarea></label><small>Failed run: ${escapeHTML(failedRunId)}. Credentials, runtime targets and seller declarations are forbidden here.</small><button type="button" data-v3-action="${prefix}-fallback-save">Validate and save manual draft</button></details>`
}

const v3ServiceMeterLabels: Record<string, string> = {
  request: 'Requests', successful_request: 'Successful requests', input_tokens: 'Input tokens', output_tokens: 'Output tokens',
  input_bytes: 'Input bytes', output_bytes: 'Output bytes', execution_second: 'Execution time', image: 'Images', provider_reported: 'Provider reported usage',
}

function v3ServiceAgentSession() {
  return state.agentSessions.find((session) => (session.scopes || []).includes('seller.draft'))
}

function v3OperationCounts(manifest?: V3ServiceManifest) {
  let json = 0
  let sse = 0
  for (const policy of manifest?.operationPolicies || []) policy.interaction === 'server_stream' ? sse++ : json++
  return { total: json + sse, json, sse }
}

function v3PricingIssues(components: V3APIPricingComponent[], maximum: number, capabilities?: string[]) {
  const issues: string[] = []
  if (!components.length) issues.push('Add at least one pricing component.')
  components.forEach((component, index) => {
    const label = `Price component ${index + 1}`
    if (!v3ServiceMeterLabels[component.dimension]) issues.push(`${label} uses an unsupported meter.`)
    if (capabilities && !capabilities.includes(component.dimension)) issues.push(`${label} must use an enabled metering capability.`)
    if (!Number.isFinite(component.rateAtomic) || component.rateAtomic < 0) issues.push(`${label} has an invalid USDC price.`)
    if (!Number.isFinite(component.per) || component.per < 1) issues.push(`${label} requires a positive unit size.`)
    if (component.dimension === 'provider_reported' && !component.selector?.trim()) issues.push(`${label} requires a provider-reported usage selector.`)
  })
  const variable = components.some((component) => !['request', 'successful_request'].includes(component.dimension))
  if (variable && maximum < 1) issues.push('Variable pricing requires a maximum charge per invocation.')
  return issues
}

function v3ServiceReviewIssues(mode: 'endpoint' | 'api_bridge', id: string) {
  const draft = mode === 'endpoint' ? state.v3EndpointDraft : state.v3APIDraft
  if (!draft) return ['Load a service contract first.']
  if (id === 'service') {
    const issues = v3PricingIssues(draft.serviceManifest.pricingTemplate.defaults || [], draft.serviceManifest.pricingTemplate.defaultMaxChargePerInvocationAtomic || 0)
    if (!draft.title.trim()) issues.unshift('Service title is required.')
    if (!draft.description.trim()) issues.unshift('Service description is required.')
    return issues
  }
  const operation = draft.operationReviews.find((item) => `operation:${item.operationId}` === id)
  if (!operation) return ['Operation contract is missing.']
  const issues: string[] = []
  const limits = operation.limits
  if (limits.timeoutSeconds < 1 || limits.timeoutSeconds > 900) issues.push('Timeout must be between 1 and 900 seconds.')
  if (limits.maxRequestBytes < 1 || limits.maxRequestBytes > 64 * 1024 * 1024) issues.push('Request limit must be between 1 byte and 64 MiB.')
  if (limits.maxResponseBytes < 1 || limits.maxResponseBytes > 64 * 1024 * 1024) issues.push('Response limit must be between 1 byte and 64 MiB.')
  if (limits.maxConcurrency < 1 || limits.maxConcurrency > 64) issues.push('Concurrency must be between 1 and 64.')
  if (!operation.meteringCapabilities.length) issues.push('Enable at least one metering capability.')
  issues.push(...v3PricingIssues(operation.pricing || [], operation.maxChargePerInvocationAtomic || 0, operation.meteringCapabilities))
  return issues
}

function renderV3ServicePricingEditor(mode: 'endpoint' | 'api_bridge', operation?: V3APIOperationReview) {
  const draft = mode === 'endpoint' ? state.v3EndpointDraft : state.v3APIDraft
  if (!draft) return ''
  const inherited = Boolean(operation && operation.pricingMode === 'default')
  const components = operation ? operation.pricing || [] : draft.serviceManifest.pricingTemplate.defaults || []
  const maximum = operation ? operation.maxChargePerInvocationAtomic || 0 : draft.serviceManifest.pricingTemplate.defaultMaxChargePerInvocationAtomic || 0
  const target = `${mode}|${operation?.operationId || 'default'}`
  const rows = components.map((component, index) => `<div class="v3-api-price-component ${component.dimension === 'provider_reported' ? 'seller-reported' : ''}">
    <label>Meter<select data-v3-service-price-dimension="${escapeAttr(`${target}|${index}`)}" ${inherited ? 'disabled' : ''}>${Object.entries(v3ServiceMeterLabels).map(([value, label]) => `<option value="${value}" ${component.dimension === value ? 'selected' : ''}>${escapeHTML(label)}</option>`).join('')}</select></label>
    <label>Price (USDC)<input type="number" min="0" step="0.000001" value="${(component.rateAtomic / 1_000_000).toFixed(6)}" data-v3-service-price-usdc="${escapeAttr(`${target}|${index}`)}" ${inherited ? 'disabled' : ''}/></label>
    <label>Per units<input type="number" min="1" value="${component.per}" data-v3-service-price-per="${escapeAttr(`${target}|${index}`)}" ${inherited ? 'disabled' : ''}/></label>
    <label>Measured by<select data-v3-service-price-source="${escapeAttr(`${target}|${index}`)}" ${inherited ? 'disabled' : ''}><option value="gateway" ${component.meterSource === 'gateway' ? 'selected' : ''}>Exora gateway</option><option value="openai_usage" ${component.meterSource === 'openai_usage' ? 'selected' : ''}>Standard OpenAI usage</option><option value="provider_response" ${component.meterSource === 'provider_response' ? 'selected' : ''}>Provider response</option></select></label>
    <label>Charge when<select data-v3-service-price-charge="${escapeAttr(`${target}|${index}`)}" ${inherited ? 'disabled' : ''}><option value="started" ${component.chargeOn === 'started' ? 'selected' : ''}>Request accepted</option><option value="succeeded" ${component.chargeOn === 'succeeded' ? 'selected' : ''}>Request succeeds</option><option value="completed" ${component.chargeOn === 'completed' ? 'selected' : ''}>Response or stream completes</option></select></label>
    ${component.dimension === 'provider_reported' ? `<label class="v3-api-selector">Usage selector<span>Seller reported</span><input value="${escapeAttr(component.selector || '')}" data-v3-service-price-selector="${escapeAttr(`${target}|${index}`)}" placeholder="usage.units" ${inherited ? 'disabled' : ''}/></label>` : ''}
    ${inherited ? '' : `<button class="danger ghost" type="button" data-v3-service-price-remove="${escapeAttr(`${target}|${index}`)}">Remove</button>`}
  </div>`).join('')
  return `<div class="v3-api-components" data-v3-service-pricing="${escapeAttr(target)}"><div class="v3-api-components-heading"><div><strong>${operation ? 'Operation pricing' : 'Default pricing template'}</strong><small>${inherited ? 'Inherited from the service default.' : 'Seller-defined prices shown to buyers in USDC.'}</small></div>${inherited ? '' : `<button class="ghost" type="button" data-v3-service-price-add="${escapeAttr(target)}">Add component</button>`}</div>${rows || '<div class="v3-api-review-warning"><strong>Pricing required</strong><small>Add at least one supported pricing component.</small></div>'}<div class="v3-api-max-charge"><label>Maximum charge per invocation (USDC)<input type="number" min="0" step="0.000001" value="${(maximum / 1_000_000).toFixed(6)}" data-v3-service-price-cap="${escapeAttr(target)}" ${inherited ? 'disabled' : ''}/></label></div></div>`
}

function renderV3ServiceOperationReview(mode: 'endpoint' | 'api_bridge', operation: V3APIOperationReview) {
  const target = `${mode}|${operation.operationId}`
  return `<div class="v3-api-review-form" data-v3-service-operation="${escapeAttr(target)}">
    <div class="v3-api-product-grid"><label>Operation ID<input value="${escapeAttr(operation.operationId)}" readonly/></label><label>Method<input value="${escapeAttr(operation.method)}" readonly/></label><label>Path<input value="${escapeAttr(operation.path)}" readonly/></label><label>Display name<input value="${escapeAttr(operation.title)}" data-v3-service-operation-title="${escapeAttr(target)}"/></label><label>Interaction<input value="${operation.streaming === 'server_stream' ? 'SSE server stream' : 'HTTP/JSON request-response'}" readonly/></label></div>
    <div class="v3-api-components"><div class="v3-api-components-heading"><div><strong>Risk and behavior</strong><small>These declarations are part of the public Operation Policy.</small></div></div><div class="v3-api-connection-grid"><label><input type="checkbox" data-v3-service-policy="${escapeAttr(`${target}|sideEffect`)}" ${operation.sideEffect ? 'checked' : ''}/> Has external side effects</label><label><input type="checkbox" data-v3-service-policy="${escapeAttr(`${target}|idempotent`)}" ${operation.idempotent ? 'checked' : ''}/> Idempotent</label></div></div>
    <div class="v3-api-components"><div class="v3-api-components-heading"><div><strong>Operation limits</strong><small>Enforced contract limits for every invocation.</small></div></div><div class="v3-api-product-grid"><label>Timeout seconds<input type="number" min="1" max="900" value="${operation.limits.timeoutSeconds}" data-v3-service-limit="${escapeAttr(`${target}|timeoutSeconds`)}"/></label><label>Request limit (bytes)<input type="number" min="1" max="67108864" value="${operation.limits.maxRequestBytes}" data-v3-service-limit="${escapeAttr(`${target}|maxRequestBytes`)}"/></label><label>Response limit (bytes)<input type="number" min="1" max="67108864" value="${operation.limits.maxResponseBytes}" data-v3-service-limit="${escapeAttr(`${target}|maxResponseBytes`)}"/></label><label>Maximum concurrency<input type="number" min="1" max="64" value="${operation.limits.maxConcurrency}" data-v3-service-limit="${escapeAttr(`${target}|maxConcurrency`)}"/></label></div></div>
    <div class="v3-api-components"><div class="v3-api-components-heading"><div><strong>Metering capabilities</strong><small>Pricing may only use enabled meters.</small></div></div><div class="v3-api-attestations">${Object.entries(v3ServiceMeterLabels).map(([value, label]) => `<label><span><b>${escapeHTML(label)}</b></span><input type="checkbox" data-v3-service-meter="${escapeAttr(`${target}|${value}`)}" ${operation.meteringCapabilities.includes(value) ? 'checked' : ''}/></label>`).join('')}</div></div>
    <div class="v3-api-components"><label>Pricing source<select data-v3-service-pricing-mode="${escapeAttr(target)}"><option value="default" ${operation.pricingMode === 'default' ? 'selected' : ''}>Use service default</option><option value="override" ${operation.pricingMode === 'override' ? 'selected' : ''}>Custom Operation price</option></select></label></div>
    ${renderV3ServicePricingEditor(mode, operation)}
  </div>`
}

function renderV3ServiceAuthFields(mode: 'endpoint' | 'api_bridge') {
  const endpoint = mode === 'endpoint'
  const authType = endpoint ? state.v3EndpointAuthType : state.v3APIAuthType
  const secret = endpoint ? state.v3EndpointSecret : state.v3APISecret
  const username = endpoint ? state.v3EndpointBasicUsername : state.v3APIBasicUsername
  const authName = endpoint ? state.v3EndpointAPIKeyHeader : state.v3APIKeyHeader
  const option = (value: V3UpstreamAuthType, label: string) => `<option value="${value}" ${authType === value ? 'selected' : ''}>${label}</option>`
  let fields = ''
  if (authType === 'bearer') fields = `<label>Bearer token<input name="secret" type="password" value="${escapeAttr(secret)}" autocomplete="off"/></label>`
  else if (authType === 'basic') fields = `<label>Username<input name="basicUsername" value="${escapeAttr(username)}" autocomplete="username"/></label><label>Password<input name="secret" type="password" value="${escapeAttr(secret)}" autocomplete="current-password"/></label>`
  else if (['api_key', 'header_api_key', 'query_api_key', 'cookie_api_key'].includes(authType)) fields = `<label>${authType === 'query_api_key' ? 'Query parameter' : authType === 'cookie_api_key' ? 'Cookie name' : 'Header name'}<input name="apiKeyHeader" value="${escapeAttr(authName)}"/></label><label>API key value<input name="secret" type="password" value="${escapeAttr(secret)}" autocomplete="off"/></label>`
  else if (authType === 'oauth2_client_credentials') {
    const tokenURL = endpoint ? state.v3EndpointOAuthTokenURL : state.v3APIOAuthTokenURL
    const clientID = endpoint ? state.v3EndpointOAuthClientID : state.v3APIOAuthClientID
    const clientSecret = endpoint ? state.v3EndpointOAuthClientSecret : state.v3APIOAuthClientSecret
    const scope = endpoint ? state.v3EndpointOAuthScope : state.v3APIOAuthScope
    const audience = endpoint ? state.v3EndpointOAuthAudience : state.v3APIOAuthAudience
    fields = `<label>Token URL<input name="oauthTokenUrl" value="${escapeAttr(tokenURL)}" placeholder="https://provider.example/oauth/token"/></label><label>Client ID<input name="oauthClientId" value="${escapeAttr(clientID)}"/></label><label>Client secret<input name="oauthClientSecret" type="password" value="${escapeAttr(clientSecret)}" autocomplete="off"/></label><label>Scope<input name="oauthScope" value="${escapeAttr(scope)}"/></label><label>Audience<input name="oauthAudience" value="${escapeAttr(audience)}"/></label>`
  } else if (authType === 'mtls') {
    const certificate = endpoint ? state.v3EndpointMTLSCertificate : state.v3APIMTLSCertificate
    const privateKey = endpoint ? state.v3EndpointMTLSPrivateKey : state.v3APIMTLSPrivateKey
    const ca = endpoint ? state.v3EndpointMTLSCA : state.v3APIMTLSCA
    const serverName = endpoint ? state.v3EndpointMTLSServerName : state.v3APIMTLSServerName
    fields = `<label>Client certificate PEM<textarea name="mtlsCertificate" spellcheck="false">${escapeHTML(certificate)}</textarea></label><label>Private key PEM<textarea name="mtlsPrivateKey" spellcheck="false">${escapeHTML(privateKey)}</textarea></label><label>CA bundle PEM (optional)<textarea name="mtlsCA" spellcheck="false">${escapeHTML(ca)}</textarea></label><label>Server name (optional)<input name="mtlsServerName" value="${escapeAttr(serverName)}"/></label>`
  }
  return `<label>Authentication<select name="authType">${option('none', 'None')}${option('bearer', 'Bearer token')}${option('basic', 'Basic authentication')}${option('header_api_key', 'Header API key')}${option('query_api_key', 'Query API key')}${option('cookie_api_key', 'Cookie API key')}${option('oauth2_client_credentials', 'OAuth2 client credentials')}${option('mtls', 'mTLS client certificate')}</select></label>${fields}`
}

function v3CredentialReady(mode: 'endpoint' | 'api_bridge') {
  const endpoint = mode === 'endpoint'
  const authType = endpoint ? state.v3EndpointAuthType : state.v3APIAuthType
  if (authType === 'none') return true
  if (authType === 'basic') return Boolean((endpoint ? state.v3EndpointBasicUsername : state.v3APIBasicUsername).trim() && (endpoint ? state.v3EndpointSecret : state.v3APISecret))
  if (authType === 'oauth2_client_credentials') return Boolean((endpoint ? state.v3EndpointOAuthTokenURL : state.v3APIOAuthTokenURL).trim() && (endpoint ? state.v3EndpointOAuthClientID : state.v3APIOAuthClientID).trim() && (endpoint ? state.v3EndpointOAuthClientSecret : state.v3APIOAuthClientSecret))
  if (authType === 'mtls') return Boolean((endpoint ? state.v3EndpointMTLSCertificate : state.v3APIMTLSCertificate).trim() && (endpoint ? state.v3EndpointMTLSPrivateKey : state.v3APIMTLSPrivateKey).trim())
  return Boolean(endpoint ? state.v3EndpointSecret : state.v3APISecret)
}

function v3RuntimeCredential(mode: 'endpoint' | 'api_bridge') {
  const endpoint = mode === 'endpoint'
  const authType = endpoint ? state.v3EndpointAuthType : state.v3APIAuthType
  if (authType === 'none') return ''
  if (authType === 'basic') return `${endpoint ? state.v3EndpointBasicUsername : state.v3APIBasicUsername}:${endpoint ? state.v3EndpointSecret : state.v3APISecret}`
  if (authType === 'oauth2_client_credentials') return JSON.stringify({ tokenUrl: endpoint ? state.v3EndpointOAuthTokenURL : state.v3APIOAuthTokenURL, clientId: endpoint ? state.v3EndpointOAuthClientID : state.v3APIOAuthClientID, clientSecret: endpoint ? state.v3EndpointOAuthClientSecret : state.v3APIOAuthClientSecret, scope: endpoint ? state.v3EndpointOAuthScope : state.v3APIOAuthScope, audience: endpoint ? state.v3EndpointOAuthAudience : state.v3APIOAuthAudience })
  if (authType === 'mtls') return JSON.stringify({ certificatePem: endpoint ? state.v3EndpointMTLSCertificate : state.v3APIMTLSCertificate, privateKeyPem: endpoint ? state.v3EndpointMTLSPrivateKey : state.v3APIMTLSPrivateKey, caPem: endpoint ? state.v3EndpointMTLSCA : state.v3APIMTLSCA, serverName: endpoint ? state.v3EndpointMTLSServerName : state.v3APIMTLSServerName })
  return endpoint ? state.v3EndpointSecret : state.v3APISecret
}

function syncV3RuntimeAuthFromForm(mode: 'endpoint' | 'api_bridge', data: FormData) {
  const endpoint = mode === 'endpoint'
  const authType = String(data.get('authType') || 'none') as V3UpstreamAuthType
  if (endpoint) {
    state.v3EndpointAuthType = authType
    state.v3EndpointSecret = String(data.get('secret') || state.v3EndpointSecret)
    state.v3EndpointBasicUsername = String(data.get('basicUsername') || state.v3EndpointBasicUsername).trim()
    state.v3EndpointAPIKeyHeader = String(data.get('apiKeyHeader') || state.v3EndpointAPIKeyHeader).trim() || (authType === 'query_api_key' || authType === 'cookie_api_key' ? 'api_key' : 'X-API-Key')
    state.v3EndpointOAuthTokenURL = String(data.get('oauthTokenUrl') || state.v3EndpointOAuthTokenURL).trim()
    state.v3EndpointOAuthClientID = String(data.get('oauthClientId') || state.v3EndpointOAuthClientID).trim()
    state.v3EndpointOAuthClientSecret = String(data.get('oauthClientSecret') || state.v3EndpointOAuthClientSecret)
    state.v3EndpointOAuthScope = String(data.get('oauthScope') || state.v3EndpointOAuthScope).trim()
    state.v3EndpointOAuthAudience = String(data.get('oauthAudience') || state.v3EndpointOAuthAudience).trim()
    state.v3EndpointMTLSCertificate = String(data.get('mtlsCertificate') || state.v3EndpointMTLSCertificate)
    state.v3EndpointMTLSPrivateKey = String(data.get('mtlsPrivateKey') || state.v3EndpointMTLSPrivateKey)
    state.v3EndpointMTLSCA = String(data.get('mtlsCA') || state.v3EndpointMTLSCA)
    state.v3EndpointMTLSServerName = String(data.get('mtlsServerName') || state.v3EndpointMTLSServerName).trim()
    return
  }
  state.v3APIAuthType = authType
  state.v3APISecret = String(data.get('secret') || state.v3APISecret)
  state.v3APIBasicUsername = String(data.get('basicUsername') || state.v3APIBasicUsername).trim()
  state.v3APIKeyHeader = String(data.get('apiKeyHeader') || state.v3APIKeyHeader).trim() || (authType === 'query_api_key' || authType === 'cookie_api_key' ? 'api_key' : 'X-API-Key')
  state.v3APIOAuthTokenURL = String(data.get('oauthTokenUrl') || state.v3APIOAuthTokenURL).trim()
  state.v3APIOAuthClientID = String(data.get('oauthClientId') || state.v3APIOAuthClientID).trim()
  state.v3APIOAuthClientSecret = String(data.get('oauthClientSecret') || state.v3APIOAuthClientSecret)
  state.v3APIOAuthScope = String(data.get('oauthScope') || state.v3APIOAuthScope).trim()
  state.v3APIOAuthAudience = String(data.get('oauthAudience') || state.v3APIOAuthAudience).trim()
  state.v3APIMTLSCertificate = String(data.get('mtlsCertificate') || state.v3APIMTLSCertificate)
  state.v3APIMTLSPrivateKey = String(data.get('mtlsPrivateKey') || state.v3APIMTLSPrivateKey)
  state.v3APIMTLSCA = String(data.get('mtlsCA') || state.v3APIMTLSCA)
  state.v3APIMTLSServerName = String(data.get('mtlsServerName') || state.v3APIMTLSServerName).trim()
  state.v3APICredentialConfigured = v3CredentialReady(mode)
}

function renderV3ServiceWizard(mode: 'endpoint' | 'api_bridge') {
  const endpoint = mode === 'endpoint'
  const draft = endpoint ? state.v3EndpointDraft : state.v3APIDraft
  const operations = endpoint ? draft?.operationReviews || [] : state.v3APIOperations
  const materials = endpoint ? state.v3EndpointMaterials : state.v3APIMaterials
  const note = endpoint ? state.v3EndpointMaterialNote : state.v3APIMaterialNote
  const statuses = endpoint ? state.v3EndpointReviewStatus : state.v3APIReviewStatus
  const reviewIndex = endpoint ? state.v3EndpointReviewIndex : state.v3APIReviewIndex
  const reviewFilter = endpoint ? state.v3EndpointReviewFilter : state.v3APIReviewFilter
  const draftID = endpoint ? state.v3EndpointDraftId : state.v3APIDraftId
  const failedRunID = endpoint ? state.v3EndpointFailedRunId : state.v3APIFailedRunId
  const materialCurrent = v3AgentMaterialsCurrent(mode)
  const ids = ['service', ...operations.map((operation) => `operation:${operation.operationId}`)]
  const unresolvedFor = (id: string) => endpoint ? endpointUnresolvedForReview(id) : apiBridgeUnresolvedForReview(id)
  const confirmedCount = ids.filter((id) => statuses[id] === 'confirmed').length
  const unresolved = draft?.unresolvedFields || []
  const dirty = endpoint ? state.v3EndpointDraftDirty : state.v3APIDraftDirty
  const reviewComplete = Boolean(materialCurrent && draft && !dirty && !unresolved.length && ids.length && confirmedCount === ids.length)
  const activeIndex = Math.max(0, Math.min(reviewIndex, Math.max(0, ids.length - 1)))
  const activeID = ids[activeIndex] || 'service'
  const activeOperation = activeID.startsWith('operation:') ? operations.find((operation) => `operation:${operation.operationId}` === activeID) : undefined
  const activeUnresolved = unresolvedFor(activeID)
  const activeIssues = draft ? v3ServiceReviewIssues(mode, activeID) : []
  const busy = endpoint ? state.v3EndpointSubmitting || state.v3EndpointProbing : state.v3APISavingListing || state.v3APIProbing
  const agentSession = v3ServiceAgentSession()
  const counts = v3OperationCounts(draft?.serviceManifest)
  const prefix = endpoint ? 'endpoint' : 'api'
  const pickerAction = endpoint ? 'endpoint-materials-add' : 'api-materials-add'
  const checkAction = endpoint ? 'endpoint-draft-check' : 'api-draft-check'
  const prompt = endpoint ? endpointAgentPrompt() : apiBridgeAgentPrompt()
  const materialRows = materials.map((file) => renderV3SharedFileRow(file, `<button class="danger ghost" type="button" ${endpoint ? `data-v3-endpoint-material-remove="${escapeAttr(file.id)}"` : `data-v3-api-material-remove="${escapeAttr(file.id)}"`}>Remove</button>`)).join('')
  const visibleItems = ids.map((id, index) => ({ id, index })).filter(({ id }) => reviewFilter === 'all' || (reviewFilter === 'pending' ? statuses[id] !== 'confirmed' : unresolvedFor(id).length > 0))
  const reviewList = visibleItems.map(({ id, index }) => {
    const operation = operations.find((item) => `operation:${item.operationId}` === id)
    const status = statuses[id] || 'pending'
    return `<button type="button" class="v3-api-review-item ${index === activeIndex ? 'selected' : ''} ${status} ${unresolvedFor(id).length ? 'warning' : ''}" ${endpoint ? `data-v3-endpoint-review-index="${index}"` : `data-v3-review-index="${index}"`}><span>${status === 'confirmed' ? '✓' : status === 'modified' ? '!' : index + 1}</span><div><strong>${escapeHTML(id === 'service' ? 'Service information' : `${operation?.method} ${operation?.path}`)}</strong><small>${escapeHTML(id === 'service' ? draft?.title || '' : operation?.title || operation?.operationId || '')}</small></div><em>${status === 'confirmed' ? 'Confirmed' : status === 'modified' ? 'Modified · confirm again' : 'Pending review'}</em></button>`
  }).join('') || '<div class="v3-api-review-filter-empty">No items match this filter.</div>'
  const titleAttr = endpoint ? 'data-v3-endpoint-draft="title"' : 'name="title" data-v3-api-draft="title"'
  const descriptionAttr = endpoint ? 'data-v3-endpoint-draft="description"' : 'name="description" data-v3-api-draft="description"'
  const serviceTitle = endpoint ? draft?.title || '' : state.v3APITitle
  const serviceDescription = endpoint ? draft?.description || '' : state.v3APIDescription
  const serviceReview = draft ? `<div class="v3-api-review-form"><div class="v3-api-product-grid"><label>Title<input ${titleAttr} value="${escapeAttr(serviceTitle)}"/></label><label>Interface<input value="OpenAPI 3.1 · HTTP/JSON + SSE" readonly/></label><label>Contract SHA-256<input value="${escapeAttr(draft.normalization.outputSha256 || '')}" readonly/></label><label>Operations<input value="${counts.total} total · ${counts.json} JSON · ${counts.sse} SSE" readonly/></label></div><label>Description<textarea ${descriptionAttr}>${escapeHTML(serviceDescription)}</textarea></label><p class="v3-api-agent-note"><strong>Normalization audit</strong><span>${escapeHTML(draft.agentNotes || 'Normalization audit recorded.')}</span></p><details class="v3-api-auth-card"><summary><strong>Canonical OpenAPI 3.1 JSON</strong></summary><pre>${escapeHTML(JSON.stringify(draft.serviceManifest.interface, null, 2))}</pre></details>${renderV3ServicePricingEditor(mode)}</div>` : ''
  const reviewBody = activeOperation ? renderV3ServiceOperationReview(mode, activeOperation) : serviceReview
  const previousAttr = endpoint ? 'data-v3-endpoint-review-previous' : 'data-v3-review-previous'
  const nextAttr = endpoint ? 'data-v3-endpoint-review-next' : 'data-v3-review-next'
  const confirmAttr = endpoint ? `data-v3-endpoint-review-confirm="${escapeAttr(activeID)}"` : `data-v3-review-confirm="${escapeAttr(activeID)}"`
  const promptRefreshAction = endpoint ? 'endpoint-prompt-refresh' : 'api-prompt-regenerate'
  const reviewWarning = [...activeUnresolved, ...activeIssues]
  const agentStatus = `<p class="v3-api-agent-note"><strong>${agentSession ? 'Seller Agent connected' : state.v3ServiceAgentSessionsLoading ? 'Checking Agent connection' : 'No active Seller Agent'}</strong><span>${agentSession ? `${escapeHTML(agentSession.clientName || 'Local Agent')} · last active ${escapeHTML(compactTimestamp(agentSession.lastUsedAt || agentSession.createdAt || ''))} · expires ${escapeHTML(compactTimestamp(agentSession.expiresAt || ''))}` : 'Connect an Agent with seller.draft permission, or record unavailability for the audited manual fallback.'}</span><button class="ghost" type="button" data-v3-action="service-agent-refresh">Refresh status</button>${!agentSession && state.v3ServiceAgentSessionsLoaded && materials.length && !failedRunID ? `<button class="ghost" type="button" data-v3-action="${prefix}-agent-unavailable">Record Agent unavailable</button>` : ''}</p>`
  const step1 = `<section class="v3-console-panel ${v3WizardStepClass(materialCurrent ? 'complete' : materials.length && draft ? 'error' : 'available')}"><div class="v3-step-heading"><span>1</span><div><strong>Import materials and prepare contract</strong><small>Files and notes remain local; the Agent saves only the normalized public ServiceManifest.</small></div></div>${renderV3AgentMaterialPicker(pickerAction)}<div class="v3-api-material-list">${materialRows || renderV3SharedFileEmpty('No materials selected', 'Add OpenAPI, documentation, examples, code, or a service description to unlock Step 2.')}</div><details class="v3-api-auth-card"><summary><strong>Service description / examples</strong></summary><label>Plain-language material<textarea name="${prefix}MaterialNote" placeholder="Describe operations, request and response examples, metering, or pricing assumptions.">${escapeHTML(note)}</textarea></label><button type="button" data-v3-action="${prefix}-material-note-save">Save as local material</button></details>${agentStatus}${renderV3AgentPromptPanel({ title: endpoint ? 'Endpoint Agent Prompt' : 'API Bridge Agent Prompt', draftId: draftID, expectedVersion: draft?.version || 0, prompt, copyAction: `${prefix}-prompt-copy`, refreshAction: promptRefreshAction, checkAction, checkDisabled: !materials.length })}${renderV3ManualServiceFallback(mode)}</section>`
  const step2 = `<section class="v3-console-panel ${v3WizardStepClass(!materialCurrent ? 'locked' : reviewComplete ? 'complete' : 'available')}" ${!materialCurrent ? 'inert aria-disabled="true"' : ''}><div class="v3-step-heading"><span>2</span><div><strong>Review service contract and pricing</strong><small>Confirm the canonical OpenAPI interface, every Operation Policy, and seller-defined USDC pricing.</small></div></div>${unresolved.length ? `<div class="v3-api-unresolved-list"><strong>Needs review</strong>${unresolved.map((field) => `<span>${escapeHTML(field)}</span>`).join('')}<small>Edit the matching contract item before confirming it.</small></div>` : ''}${draft ? `<div class="v3-api-review-workspace"><aside><div><strong>Contract review</strong><small>Version ${draft.version} · ${confirmedCount}/${ids.length} confirmed</small></div><div class="v3-api-review-filters"><span>All ${ids.length}</span><span>Pending ${ids.length - confirmedCount}</span><span>Warnings ${unresolved.length + activeIssues.length}</span></div>${reviewList}</aside><main><header><div><small>Item ${activeIndex + 1} of ${ids.length}</small><strong>${escapeHTML(activeID === 'service' ? 'Service information' : `${activeOperation?.method} ${activeOperation?.path}`)}</strong></div><span class="${statuses[activeID] || 'pending'}">${statuses[activeID] === 'confirmed' ? 'Confirmed' : statuses[activeID] === 'modified' ? 'Modified' : 'Pending review'}</span></header>${reviewBody}${reviewWarning.length ? `<div class="v3-api-review-warning"><strong>Complete this contract item</strong><span>${reviewWarning.map(escapeHTML).join(', ')}</span></div>` : ''}<footer><button class="ghost" type="button" data-v3-service-review-nav ${previousAttr} ${activeIndex === 0 ? 'disabled' : ''}>Previous</button><button type="button" data-v3-service-review-nav ${confirmAttr} ${reviewWarning.length ? 'disabled' : ''}>Confirm and review next</button><button class="ghost" type="button" data-v3-service-review-nav ${nextAttr} ${activeIndex + 1 >= ids.length ? 'disabled' : ''}>Next</button></footer></main></div><div class="v3-form-actions"><button type="button" data-v3-action="${prefix}-draft-save">Save revised draft</button><span>${reviewComplete ? 'All contract items confirmed' : `${ids.length - confirmedCount} items still require approval`}</span></div>` : renderV3AgentDraftWaiting(mode)}</section>`
  const runtimeReady = endpoint ? Boolean(state.v3EndpointProbe?.ok) : Boolean(state.v3APIProbe?.ok)
  const attestationsReady = endpoint ? state.v3EndpointAttestPricing && state.v3EndpointAttestRuntime && state.v3EndpointAttestRights : state.v3APIAttestPricing && state.v3APIAttestUsage && state.v3APIAttestRights
  const canSubmit = reviewComplete && runtimeReady && v3CredentialReady(mode) && attestationsReady && !busy
  let runtimeBody = ''
  if (endpoint) {
    const smokeOperation = activeOperation || operations[0]
    const smoke = state.v3EndpointRouteTestResult
    const dangerous = Boolean(smokeOperation && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(smokeOperation.method) && smokeOperation.sideEffect)
    const smokePreview = smoke?.sseEvents?.length
      ? `${smoke.sseEvents.length} SSE events · first event ${smoke.firstEventLatencyMs || 0} ms · ${smoke.streamEndStatus || 'completed'}${smoke.truncated ? ' · preview truncated' : ''}`
      : `${smoke?.bytesRead || 0} bytes${smoke?.truncated ? ' · preview truncated' : ''}`
    runtimeBody = `<div class="v3-api-runtime-heading"><div><strong>Private Dock runtime</strong><small>These settings stay on this computer and never enter the public Manifest.</small></div><span>Dock only</span></div><div class="v3-api-connection-grid"><label>Local service URL<input name="localBaseUrl" value="${escapeAttr(state.v3EndpointLocalURL)}" placeholder="http://127.0.0.1:8000"/></label><label>Health Path<input name="healthPath" value="${escapeAttr(state.v3EndpointHealthPath)}"/></label>${renderV3ServiceAuthFields(mode)}<label>Runtime timeout seconds<input name="timeoutSeconds" type="number" min="1" max="300" value="${state.v3EndpointTimeout}"/></label><label>Runtime concurrency<input name="concurrency" type="number" min="1" max="64" value="${state.v3EndpointConcurrency}"/></label></div><div class="v3-wizard-inline-action"><button class="ghost" type="button" data-v3-action="endpoint-probe" ${reviewComplete && !busy ? '' : 'disabled'}>${state.v3EndpointProbing ? 'Checking…' : state.v3EndpointProbe?.ok ? 'Check health again' : 'Test local health'}</button></div><div class="v3-api-probe ${state.v3EndpointProbe?.ok ? 'passed' : state.v3EndpointProbe ? 'failed' : 'idle'}"><span>${state.v3EndpointProbe?.ok ? '✓' : state.v3EndpointProbe ? '!' : '→'}</span><div><strong>${state.v3EndpointProbe?.ok ? 'Local Health Path passed' : 'Local connectivity must pass'}</strong><small>${escapeHTML(state.v3EndpointProbe?.error || 'Dock validates this private target without sending its URL or credential to Cloud.')}</small></div></div>${smokeOperation ? `<details class="v3-api-auth-card"><summary><strong>Optional Operation smoke test · ${escapeHTML(smokeOperation.method)} ${escapeHTML(smokeOperation.path)}${smokeOperation.streaming === 'server_stream' ? ' · SSE' : ''}</strong></summary><div class="v3-api-connection-grid"><label>Concrete test path<input name="routeTestPath" value="${escapeAttr(state.v3EndpointRouteTestPath || smokeOperation.path)}"/></label><label>Query string<input name="routeTestQuery" value="${escapeAttr(state.v3EndpointRouteTestQuery)}" placeholder="limit=1"/></label><label>Content type<input name="routeTestContentType" value="${escapeAttr(state.v3EndpointRouteTestContentType)}"/></label></div><label>Request body<textarea name="routeTestBody">${escapeHTML(state.v3EndpointRouteTestBody)}</textarea></label>${dangerous ? `<label><input name="routeTestDanger" type="checkbox" ${state.v3EndpointRouteTestDangerConfirmed ? 'checked' : ''}/> I understand this test may change local service state.</label>` : ''}<button class="ghost" type="button" data-v3-action="endpoint-route-test" ${dangerous && !state.v3EndpointRouteTestDangerConfirmed ? 'disabled' : ''}>Run optional Operation test</button>${smoke ? `<div class="v3-api-probe ${smoke.ok ? 'passed' : 'failed'}"><span>${smoke.ok ? '✓' : '!'}</span><div><strong>${smoke.status ? `HTTP ${smoke.status}` : 'Operation test failed'} · ${smoke.latencyMs || 0} ms</strong><small>${escapeHTML(smoke.error || smokePreview)}</small><pre>${escapeHTML(smoke.preview || '')}</pre></div></div>` : ''}</details>` : ''}${renderV3SellerAttestations(mode)}`
  } else {
    const probe = state.v3APIProbe
    runtimeBody = `<div class="v3-api-runtime-heading"><div><strong>Private Cloud connection</strong><small>The provider URL and encrypted credential never enter the public Manifest or Agent draft.</small></div><span>Cloud private</span></div><div class="v3-api-connection-grid"><label>Provider Base URL<input name="baseUrl" value="${escapeAttr(state.v3APIBaseURL)}" placeholder="https://api.provider.example"/></label><label>Health Path<input name="healthPath" value="${escapeAttr(state.v3APIHealthPath)}"/></label>${renderV3ServiceAuthFields(mode)}</div><div class="v3-wizard-inline-action"><button class="ghost" type="button" data-v3-action="api-probe" ${reviewComplete && !busy ? '' : 'disabled'}>${state.v3APIProbing ? 'Checking…' : probe?.ok ? 'Check again' : 'Check connection'}</button></div><div class="v3-api-probe ${probe?.ok ? 'passed' : probe ? 'failed' : 'idle'}"><span>${probe?.ok ? '✓' : probe ? '!' : '→'}</span><div><strong>${probe?.ok ? 'Health Path reachable' : probe ? 'Connection check failed' : 'Connectivity not checked'}</strong><small>${escapeHTML(probe?.error || 'Cloud calls only the declared side-effect-free Health Path.')}</small></div></div><div class="v3-api-public-preview"><div><span>MARKET PREVIEW</span><strong>${escapeHTML(draft?.title || 'Untitled API Bridge')}</strong><small>OpenAPI 3.1 · ${counts.total} Operations · ${counts.sse ? `${counts.sse} SSE` : 'HTTP/JSON'}</small></div><p>Exora verifies connectivity, forwarding, metering, and settlement. The seller remains responsible for service behavior, pricing, rights, and reported usage.</p></div>${renderV3SellerAttestations(mode)}`
  }
  const step3 = `<section class="v3-console-panel ${v3WizardStepClass(!reviewComplete ? 'locked' : busy ? 'busy' : 'available')} v3-api-publish-panel" ${!reviewComplete ? 'inert aria-disabled="true"' : ''}><div class="v3-step-heading"><span>3</span><div><strong>${endpoint ? 'Configure private Dock runtime and submit' : 'Configure private Cloud connection and submit'}</strong><small>${endpoint ? 'Dock must remain online; local targets and credentials stay on this computer.' : 'Cloud connects to the public HTTPS provider; Dock is not required at invocation time.'}</small></div><button type="submit" class="v3-direct-publish" ${canSubmit ? '' : 'disabled'}>${busy ? 'Submitting…' : 'Submit to Listings'}</button></div>${runtimeBody}</section>`
  return `<form class="v3-application-flow v3-provider-form" data-v3-form="${endpoint ? 'endpoint-agent' : 'api_bridge'}">${step1}${step2}${step3}</form>`
}

function endpointReviewIDs() {
  return state.v3EndpointDraft ? ['service', ...state.v3EndpointDraft.operationReviews.map((route) => `operation:${route.operationId}`)] : []
}

function endpointReviewFingerprint(id: string) {
  const draft = state.v3EndpointDraft
  if (!draft) return ''
  if (id === 'service') return JSON.stringify({ title: draft.title, description: draft.description, interface: draft.serviceManifest.interface, pricingTemplate: draft.serviceManifest.pricingTemplate })
  const route = draft.operationReviews.find((item) => `operation:${item.operationId}` === id)
  if (!route) return ''
  const pricing = (route.pricing || []).map((item) => ({ dimension: item.dimension, rateAtomic: item.rateAtomic, per: item.per, meterSource: item.meterSource, ...(item.selector ? { selector: item.selector } : {}), chargeOn: item.chargeOn }))
  return JSON.stringify({ operationId: route.operationId, method: route.method, path: route.path, title: route.title, streaming: route.streaming, sideEffect: route.sideEffect, idempotent: route.idempotent, limits: route.limits, meteringCapabilities: route.meteringCapabilities, pricingMode: route.pricingMode, pricing, maxChargePerInvocationAtomic: route.maxChargePerInvocationAtomic })
}

function endpointUnresolvedForReview(id: string) {
  const draft = state.v3EndpointDraft
  if (!draft) return []
  const operationIDs = draft.operationReviews.map((operation) => operation.operationId)
  if (id === 'service') return (draft.unresolvedFields || []).filter((field) => !operationIDs.some((operationId) => field.includes(operationId)))
  const route = draft.operationReviews.find((item) => `operation:${item.operationId}` === id)
  const index = route ? draft.operationReviews.indexOf(route) : -1
  if (!route || index < 0) return []
  return (draft.unresolvedFields || []).filter((field) => field.includes(route.operationId) || field.includes(`operationPolicies.${index}`) || field.includes(`operationPolicies[${index}]`))
}

function endpointPathField(path: string) {
  return String(path).match(/(?:^|\.)(title|description|operationId|method|path|displayName|interaction|sideEffect|idempotent|timeoutSeconds|maxRequestBytes|maxResponseBytes|maxConcurrency|meteringCapabilities|maxChargePerInvocationAtomic|dimension|rateAtomic|per|meterSource|selector|chargeOn)$/)?.[1]
}

function resolveEndpointBoundField(reviewID: string, fieldName: string, componentIndex?: number) {
  const draft = state.v3EndpointDraft
  if (!draft) return
  const route = draft.operationReviews.find((item) => `operation:${item.operationId}` === reviewID)
  const routeIndex = route ? draft.operationReviews.indexOf(route) : -1
  draft.unresolvedFields = (draft.unresolvedFields || []).filter((path) => {
    if (endpointPathField(path) !== fieldName) return true
    if (reviewID === 'service') return draft.operationReviews.some((operation) => path.includes(operation.operationId))
    const routeMatches = route && (path.includes(route.operationId) || path.includes(`operationPolicies.${routeIndex}`) || path.includes(`operationPolicies[${routeIndex}]`))
    if (!routeMatches) return true
    if (componentIndex !== undefined && !path.includes(`pricing.${componentIndex}.`) && !path.includes(`pricing[${componentIndex}].`)) return true
    return false
  })
}

function persistEndpointReview() {
  const items = Object.fromEntries(endpointReviewIDs().map((id) => [id, { status: state.v3EndpointReviewStatus[id] || 'pending', fingerprint: endpointReviewFingerprint(id) }]))
  localStorage.setItem(`exora.endpointReview.${state.v3EndpointDraftId}`, JSON.stringify({ version: state.v3EndpointDraft?.version, items }))
}

function restoreEndpointReview() {
  try {
    const saved = JSON.parse(localStorage.getItem(`exora.endpointReview.${state.v3EndpointDraftId}`) || '{}') as { items?: Record<string, { status?: 'pending' | 'modified' | 'confirmed'; fingerprint?: string }> }
    state.v3EndpointReviewStatus = Object.fromEntries(endpointReviewIDs().map((id) => { const item = saved.items?.[id]; return [id, item?.fingerprint === endpointReviewFingerprint(id) ? item.status || 'pending' : item?.status === 'confirmed' ? 'modified' : 'pending'] }))
  } catch { state.v3EndpointReviewStatus = {} }
  state.v3EndpointConfirmed = endpointReviewIDs().filter((id) => state.v3EndpointReviewStatus[id] === 'confirmed')
}

function hydrateV3ServiceDraft(input: V3APIBridgeDraft): V3APIBridgeDraft {
  const draft = structuredClone(input) as V3APIBridgeDraft
  const manifest = draft.serviceManifest
  if (!manifest || !manifest.interface || !Array.isArray(manifest.operationPolicies)) throw new Error('Cloud returned an invalid ExoraServiceManifest.')
  const policyByID = new Map(manifest.operationPolicies.map((policy) => [policy.operationId, policy]))
  const overrides = manifest.pricingTemplate?.overrides || {}
  const operationReviews: V3APIBridgeDraft['operationReviews'] = []
  for (const [routePath, rawPathItem] of Object.entries(manifest.interface.paths || {})) {
    const pathItem = rawPathItem as Record<string, any>
    for (const method of ['get','post','put','patch','delete','head','options']) {
      const operation = pathItem?.[method] as Record<string, any> | undefined
      if (!operation?.operationId) continue
      const operationId = String(operation.operationId)
      const policy = policyByID.get(operationId)
      if (!policy) throw new Error(`Cloud returned no Operation Policy for ${operationId}.`)
      const pricing = overrides[operationId]
      const title = String(operation.summary || operationId)
      operationReviews.push({
        id: operationId,
        operationId,
        method: method.toUpperCase(),
        path: routePath,
        title,
        displayName: title,
        selected: true,
        price: 0,
        pricingMode: pricing ? 'override' : 'default',
        pricing: structuredClone(pricing?.components?.length ? pricing.components : manifest.pricingTemplate.defaults || []),
        maxChargePerInvocationAtomic: pricing?.maxChargePerInvocationAtomic || manifest.pricingTemplate.defaultMaxChargePerInvocationAtomic || 0,
        streaming: policy.interaction,
        sideEffect: policy.sideEffect,
        idempotent: policy.idempotent,
        limits: structuredClone(policy.limits),
        meteringCapabilities: [...policy.meteringCapabilities],
      })
    }
  }
  draft.operationReviews = operationReviews
  draft.agentNotes = draft.normalization?.mode === 'manual_fallback' ? `Manual fallback: ${draft.normalization.fallbackReason || 'audited'}` : `Agent normalization run ${draft.normalization?.runId || ''}`.trim()
  return draft
}

function syncReviewedOperationsIntoServiceManifest(manifest: V3ServiceManifest, reviewed: V3APIOperationReview[]) {
  const byID = new Map(reviewed.map((operation) => [operation.operationId, operation]))
  for (const rawPathItem of Object.values(manifest.interface.paths || {})) {
    const pathItem = rawPathItem as Record<string, any>
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const operation = pathItem[method] as Record<string, any> | undefined
      const review = operation?.operationId ? byID.get(String(operation.operationId)) : undefined
      if (operation && review?.title) operation.summary = review.title
    }
  }
  for (const policy of manifest.operationPolicies) {
    const review = byID.get(policy.operationId)
    if (!review) continue
    policy.interaction = review.streaming
    policy.sideEffect = review.sideEffect
    policy.idempotent = review.idempotent
    policy.limits = { ...review.limits }
    policy.meteringCapabilities = [...review.meteringCapabilities].sort()
  }
  manifest.pricingTemplate.overrides = Object.fromEntries(reviewed.filter((operation) => operation.pricingMode === 'override').map((operation) => [operation.operationId, {
    components: operation.pricing || [],
    maxChargePerInvocationAtomic: operation.maxChargePerInvocationAtomic || 0,
  }]))
}

async function serviceReviewSHA256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

async function serviceDraftReviewReceipt(draft: V3APIBridgeDraft) {
  const receipt = [{ id: 'service', fingerprint: await serviceReviewSHA256({ interface: draft.serviceManifest.interface, pricingTemplate: draft.serviceManifest.pricingTemplate }) }]
  for (const policy of draft.serviceManifest.operationPolicies) receipt.push({ id: `operation:${policy.operationId}`, fingerprint: await serviceReviewSHA256(policy) })
  return receipt
}

function applyV3EndpointDraft(input: V3APIBridgeDraft) {
  const draft = hydrateV3ServiceDraft(input)
  if (draft.applicationSource !== 'endpoint' || draft.serviceManifest.delivery !== 'dock_tunnel') throw new Error('Endpoint Agent draft must use dock_tunnel delivery.')
  state.v3EndpointDraftId = draft.draftId
  state.v3EndpointDraft = draft
  state.v3EndpointAgentReady = true
  state.v3EndpointDraftDirty = false
  state.v3EndpointReviewIndex = 0
  state.v3EndpointProbe = undefined
  state.v3EndpointRouteTestResult = undefined
  restoreEndpointReview()
}

function currentV3EndpointDraft() {
  const draft = state.v3EndpointDraft
  if (!draft) throw new Error('Load the Endpoint Agent draft first.')
  syncReviewedOperationsIntoServiceManifest(draft.serviceManifest, draft.operationReviews)
  return { draftId: draft.draftId, expectedVersion: draft.version, applicationSource: 'endpoint', title: draft.title, description: draft.description, serviceManifest: draft.serviceManifest, normalization: draft.normalization, unresolvedFields: draft.unresolvedFields || [] }
}

function endpointRuntimeOperations(draft: V3APIBridgeDraft) {
  return draft.operationReviews.map((route) => ({ operationId: route.operationId, method: route.method.toUpperCase(), path: route.path }))
}

function renderV3SellerAttestations(mode: 'endpoint' | 'api_bridge') {
  const endpoint = mode === 'endpoint'
  const items = endpoint ? [
    { key: 'pricing', checked: state.v3EndpointAttestPricing, title: 'I define and accept responsibility for Endpoint pricing.', detail: 'Exora does not assess price fairness.' },
    { key: 'runtime', checked: state.v3EndpointAttestRuntime, title: 'I will operate this local service and report usage accurately.', detail: 'Tunnel availability and reported usage remain my responsibility.' },
    { key: 'rights', checked: state.v3EndpointAttestRights, title: 'I have the right to sell access to this service.', detail: 'This confirmation cannot be supplied by an Agent.' },
  ] : [
    { key: 'pricing', checked: state.v3APIAttestPricing, title: 'I define and accept responsibility for the published prices.', detail: 'Exora does not assess price fairness.' },
    { key: 'usage', checked: state.v3APIAttestUsage, title: 'I am responsible for API behavior and reported usage accuracy.', detail: 'Seller-reported meters are labeled for buyers.' },
    { key: 'rights', checked: state.v3APIAttestRights, title: 'I have the right to sell access to this API.', detail: 'This confirmation cannot be supplied by an Agent.' },
  ]
  const attribute = endpoint ? 'data-v3-endpoint-attest' : 'data-v3-attestation'
  return `<div class="v3-api-attestations"><strong>Seller confirmation</strong>${items.map((item) => `<label><span><b>${escapeHTML(item.title)}</b><small>${escapeHTML(item.detail)}</small></span><input type="checkbox" ${attribute}="${item.key}" ${item.checked ? 'checked' : ''}/></label>`).join('')}</div>`
}

function renderV3AgentDraftWaiting(mode: 'endpoint' | 'api_bridge') {
  const subject = mode === 'endpoint' ? 'Endpoint' : 'Public API'
  return `<div class="v3-api-review-waiting"><span aria-hidden="true">AI</span><div><strong>Waiting for the Agent draft</strong><small>Run the Step 1 prompt in your connected Agent, then choose Check draft to load the standardized ${subject} structure.</small></div></div>`
}

function renderV3EndpointAgentPage() {
  return renderV3ServiceWizard('endpoint')
}

function apiBridgeAgentPrompt() {
  const files = state.v3APIMaterials.map((file) => `- ${file.name}: ${file.localPath}`).join('\n') || '- No files selected yet'
  return `You are normalizing an existing public API for Exora API Bridge. Read every material and call exora.save_api_bridge_draft exactly once.\n\nDraft ID: ${state.v3APIDraftId}\nExpected version: ${state.v3APIDraftVersion}\n\nMaterials:\n${files}\n\nRules:\n- Produce ExoraServiceManifest v1 with exactly interface, delivery, operationPolicies, and pricingTemplate.\n- Normalize to OpenAPI 3.1 and set delivery to cloud_direct.\n- Support only HTTP/JSON request_response and text/event-stream server_stream. OpenAI-compatible APIs are ordinary OpenAPI operations.\n- Never send Base URL, credentials, runtime settings, seller attestation, Listing state, or publish instructions.\n- Do not invent uncertain values. Include the Agent normalization audit and put uncertainty in unresolvedFields.\n- Variable pricing requires maxChargePerInvocationAtomic.`
}

function renderV3APIBridgePage() {
  return renderV3ServiceWizard('api_bridge')
}

function syncV3APIDraftFromForm(form?: HTMLFormElement | null) {
  if (!form) return
  const data = new FormData(form)
  state.v3APITitle = String(data.get('title') || '').trim()
  state.v3APIDescription = String(data.get('description') || '').trim()
  state.v3APIBaseURL = String(data.get('baseUrl') || '').trim()
  state.v3APIHealthPath = String(data.get('healthPath') || '').trim() || '/health'
  syncV3RuntimeAuthFromForm('api_bridge', data)
  const priceUnit = String(data.get('priceUnit') || 'request')
  if (priceUnit === 'request' || priceUnit === 'successful_request' || priceUnit === 'tokens' || priceUnit === 'image' || priceUnit === 'second') state.v3APIPriceUnit = priceUnit
}

function rerenderV3APIKeepingSecret(form?: HTMLFormElement | null) {
  syncV3APIDraftFromForm(form)
  const secret = form?.querySelector<HTMLInputElement>('input[name="secret"]')?.value || ''
  renderDecisionPanel()
  const nextSecret = fields.actionView.querySelector<HTMLInputElement>('[data-v3-form="api_bridge"] input[name="secret"]')
  if (nextSecret) nextSecret.value = secret
}

function apiBridgeReviewFingerprint(id: string) {
  if (id === 'service') return JSON.stringify({ title: state.v3APITitle, description: state.v3APIDescription, interface: state.v3APIDraft?.serviceManifest.interface, pricingTemplate: state.v3APIDraft?.serviceManifest.pricingTemplate })
  const route = state.v3APIOperations.find((item) => `operation:${item.operationId}` === id)
  if (!route) return ''
  const pricing = (route.pricing || []).map((item) => ({ dimension: item.dimension, rateAtomic: item.rateAtomic, per: item.per, meterSource: item.meterSource, ...(item.selector ? { selector: item.selector } : {}), chargeOn: item.chargeOn }))
  return JSON.stringify({ operationId: route.operationId, method: route.method, path: route.path, title: route.title, streaming: route.streaming, sideEffect: route.sideEffect, idempotent: route.idempotent, limits: route.limits, meteringCapabilities: route.meteringCapabilities, pricingMode: route.pricingMode, pricing, maxChargePerInvocationAtomic: route.maxChargePerInvocationAtomic })
}

function apiBridgeUnresolvedForReview(id: string) {
  const operationIDs = state.v3APIOperations.map((operation) => operation.operationId)
  if (id === 'service') return state.v3APIUnresolvedFields.filter((field) => !operationIDs.some((operationId) => field.includes(operationId)))
  const route = state.v3APIOperations.find((item) => `operation:${item.operationId}` === id)
  const routeIndex = state.v3APIOperations.indexOf(route as V3APIOperationReview)
  if (!route || routeIndex < 0) return []
  return state.v3APIUnresolvedFields.filter((field) => field.includes(route.operationId) || field.includes(`operationPolicies.${routeIndex}`) || field.includes(`operationPolicies[${routeIndex}]`))
}

function apiBridgePathField(path: string) {
  const match = String(path).match(/(?:^|\.)(title|description|operationId|method|path|displayName|interaction|sideEffect|idempotent|timeoutSeconds|maxRequestBytes|maxResponseBytes|maxConcurrency|meteringCapabilities|maxChargePerInvocationAtomic|dimension|rateAtomic|per|meterSource|selector|chargeOn)$/)
  return match?.[1]
}

function resolveAPIBridgeBoundField(reviewId: string, fieldName: string, componentIndex?: number) {
  const route = state.v3APIOperations.find((item) => `operation:${item.operationId}` === reviewId)
  const routeIndex = route ? state.v3APIOperations.indexOf(route) : -1
  state.v3APIUnresolvedFields = state.v3APIUnresolvedFields.filter((path) => {
    if (apiBridgePathField(path) !== fieldName) return true
    if (reviewId === 'service') return state.v3APIOperations.some((operation) => path.includes(operation.operationId))
    const routeMatches = route && (path.includes(route.operationId) || path.includes(`operationPolicies.${routeIndex}`) || path.includes(`operationPolicies[${routeIndex}]`))
    if (!routeMatches) return true
    if (componentIndex !== undefined && !path.includes(`pricing.${componentIndex}.`) && !path.includes(`pricing[${componentIndex}].`)) return true
    return false
  })
}

function persistAPIBridgeReview() {
  const items = Object.fromEntries(Object.entries(state.v3APIReviewStatus).map(([id, status]) => [id, { status, fingerprint: apiBridgeReviewFingerprint(id) }]))
  localStorage.setItem(`exora.apiBridgeReview.${state.v3APIDraftId}`, JSON.stringify({ draftId: state.v3APIDraftId, items, updatedAt: new Date().toISOString() }))
}

function restoreAPIBridgeReview() {
  try {
    const saved = JSON.parse(localStorage.getItem(`exora.apiBridgeReview.${state.v3APIDraftId}`) || '{}') as { items?: Record<string, { status?: 'pending' | 'modified' | 'confirmed'; fingerprint?: string }> }
    const ids = ['service', ...state.v3APIOperations.map((route) => `operation:${route.operationId}`)]
    state.v3APIReviewStatus = Object.fromEntries(ids.map((id) => { const item = saved.items?.[id]; return [id, item?.fingerprint === apiBridgeReviewFingerprint(id) ? item.status || 'pending' : item?.status === 'confirmed' ? 'modified' : 'pending'] }))
  } catch { state.v3APIReviewStatus = {} }
}

function applyV3APIBridgeDraft(input: V3APIBridgeDraft) {
  const draft = hydrateV3ServiceDraft(input)
  if (draft.applicationSource !== 'api_bridge' || draft.serviceManifest.delivery !== 'cloud_direct') throw new Error('API Bridge Agent draft must use cloud_direct delivery.')
  state.v3APIDraftId = draft.draftId
  state.v3APIDraft = draft
  state.v3APIDraftVersion = draft.version
  state.v3APITitle = draft.title || ''
  state.v3APIDescription = draft.description || ''
  state.v3APIOperations = (draft.operationReviews || []).map((operation, index) => ({ ...structuredClone(operation), id: operation.operationId || `draft-operation-${index}`, title: operation.title || operation.displayName || operation.operationId, selected: true, price: 0 }))
  state.v3APIUnresolvedFields = [...(draft.unresolvedFields || [])]
  state.v3APIAgentNotes = draft.agentNotes || ''
  state.v3APIProbe = undefined
  clearV3ApplicationAttempt('api_bridge')
  state.v3APIReviewIndex = 0
  state.v3APIDraftDirty = false
  restoreAPIBridgeReview()
}

function currentV3APIBridgeDraft() {
  if (!state.v3APIDraft) throw new Error('Load the API Bridge Agent draft first.')
  syncReviewedOperationsIntoServiceManifest(state.v3APIDraft.serviceManifest, state.v3APIOperations)
  return { draftId: state.v3APIDraftId, expectedVersion: state.v3APIDraftVersion, applicationSource: 'api_bridge', title: state.v3APITitle, description: state.v3APIDescription, serviceManifest: state.v3APIDraft.serviceManifest, normalization: state.v3APIDraft.normalization, unresolvedFields: state.v3APIUnresolvedFields }
}


function v3ListingPriceLabel(price: Record<string, any> = {}) {
	if (price.model === 'resource_items') return 'Files priced independently'
  if (price.model === 'compute_time_v2') {
    const minute = v3AtomicMoney(Number(price.amountAtomicPerMinute || 0), 'USDC').replace(' USDC', '')
    const parts = [`${minute} USDC / min`]
    if (Number(price.baseFeeAtomic || 0) > 0) parts.push(`${v3AtomicMoney(Number(price.baseFeeAtomic), 'USDC')} start`)
    const floor = Number(price.longDurationDiscount?.minimumRateBps || 10000)
    if (floor < 10000) parts.push(`up to ${Math.round((10000 - floor) / 100)}% off`)
    return parts.join(' · ')
  }
  const currency = String(price.currency || 'USD')
  if (Number.isFinite(Number(price.amount))) return `${Number(price.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${currency}${price.unit ? ` / ${price.unit}` : ''}`
  if (price.model === 'metered' || price.pricingVersion) return `Operation-based · ${currency}`
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
  const components = Array.isArray(route.pricing) ? route.pricing : []
  if (!components.length) return 'Pricing not declared'
  return components.map((component: Record<string, any>) => {
    const rate = Number(component.rateAtomic || 0) / 1_000_000
    return `${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC / ${component.per || 1} ${String(component.dimension || 'request').replaceAll('_', ' ')}`
  }).join(' · ')
}

function renderV3ApplicationManifest(source: string, manifest: Record<string, any>, listing?: V3Listing) {
  const operations = v3ServiceManifestOperations(manifest)
  const serviceManifest = manifest.serviceManifest as V3ServiceManifest | undefined
  let details = ''
  if (source === 'vm') {
    const hardware = manifest.hardware || {}
    const gpu = hardware.Gpu || hardware.gpu || manifest.validationReceipt?.gpu || {}
    const memoryGiB = Number(hardware.MemoryBytes || hardware.memoryBytes || 0) / 1024 ** 3
    details = [
      v3ManifestDetail('Runtime', manifest.runtimeBackend || manifest.template?.runtime || 'Validated compute environment'),
      v3ManifestDetail('Processor', hardware.Cpu || hardware.cpu),
      v3ManifestDetail('CPU capacity', hardware.Cores ? `${hardware.Cores} cores` : undefined),
      v3ManifestDetail('Memory', memoryGiB > 0 ? `${memoryGiB.toFixed(0)} GiB` : undefined),
      v3ManifestDetail('GPU', gpu.name || manifest.gpuAccessMode),
      v3ManifestDetail('Environment image', manifest.environmentImageId || manifest.template?.imageId),
      v3ManifestDetail('Image version', manifest.environmentImageVersion || manifest.template?.imageVersion),
      v3ManifestDetail('Workspace', manifest.workspaceGiB ? `${manifest.workspaceGiB} GiB` : undefined),
      v3ManifestDetail('Region', manifest.region),
      v3ManifestDetail('Capacity reservation', manifest.diskReservation || manifest.capacitySnapshot ? 'Recorded' : 'Not recorded'),
      v3ManifestDetail('Isolation', manifest.isolationClass || manifest.resourceGuarantees?.cpuMemory),
      v3ManifestDetail('Control', 'Exora terminal'),
      v3ManifestDetail('File transfer', 'WebRTC direct transfer'),
      v3ManifestDetail('Minimum rental', listing?.limits?.minMinutes ? `${listing.limits.minMinutes} minutes` : undefined),
      v3ManifestDetail('Maximum rental', listing?.limits?.maxMinutes ? `${listing.limits.maxMinutes} minutes` : undefined),
      v3ManifestDetail('Current price', listing ? v3ListingPriceLabel(listing.price || {}) : undefined),
    ].join('')
  } else if (source === 'resources') {
    details = [
      v3ManifestDetail('Resource type', String(manifest.category || 'other').replaceAll('_', ' ')),
      v3ManifestDetail('Authorization scope', String(manifest.license || 'Not declared').replaceAll('_', ' ')),
      v3ManifestDetail('Access window', manifest.grantHours ? `${manifest.grantHours} hours per purchase` : undefined),
      v3ManifestDetail('Delivery', 'Independent resource files'),
      v3ManifestDetail('Pricing', 'Per file'),
      v3ManifestDetail('Authorization', 'One DownloadGrant per purchased file'),
      v3ManifestDetail('Folder handling', 'Seller-created archive uploaded as one file'),
    ].join('')
  } else {
    details = [
      v3ManifestDetail('Interface', 'OpenAPI 3.1'),
      v3ManifestDetail('Delivery', serviceManifest?.delivery === 'dock_tunnel' ? 'Dock tunnel' : 'Cloud direct'),
      v3ManifestDetail('Interactions', operations.some((operation) => operation.policy?.interaction === 'server_stream') ? 'HTTP/JSON + SSE' : 'HTTP/JSON'),
      v3ManifestDetail('Operations', operations.length),
    ].join('')
  }
  const operationList = operations.length ? `<div class="v3-listing-route-list">${operations.map((operation: Record<string, any>) => `<div><span>${escapeHTML(String(operation.method || 'ANY'))}</span><strong>${escapeHTML(String(operation.path || '/'))}</strong><small>${escapeHTML(String(operation.title || operation.operationId || 'Operation'))} · ${escapeHTML(v3OperationPricingLabel(operation))}</small></div>`).join('')}</div>` : ''
  return `<section class="v3-listing-manifest"><dl class="detail-grid v3-listing-source-details">${details}</dl>${operationList}<details><summary>Technical manifest</summary><pre>${escapeHTML(JSON.stringify(manifest, null, 2))}</pre></details></section>`
}

function v3ListingSourceMeta(source: string) {
  const sources: Record<string, { label: string; shortLabel: string; description: string; icon: IconNode }> = {
    vm: { label: 'Virtual Machine', shortLabel: 'VM', description: 'Measured compute and disposable environments', icon: Activity },
    resources: { label: 'Resource sheet', shortLabel: 'Resources', description: 'Independently priced files with protected delivery', icon: Folder },
    endpoint: { label: 'Local Endpoint', shortLabel: 'Endpoint', description: 'Private services through a Dock tunnel', icon: BrainCircuit },
    api_bridge: { label: 'Public API Bridge', shortLabel: 'API Bridge', description: 'Public APIs normalized for Agent usage', icon: Network },
    unclassified: { label: 'Needs reclassification', shortLabel: 'Unclassified', description: 'Seller confirmation is required before publishing', icon: ShieldAlert },
  }
  return sources[source] || { label: source.replaceAll('_', ' '), shortLabel: source.replaceAll('_', ' '), description: 'Exora provider application', icon: SquareKanban }
}

function v3ListingStatusMeta(status: string) {
  const statuses: Record<string, { label: string; tone: string }> = {
    draft: { label: sx('Private draft', '草稿'), tone: 'draft' },
    validating: { label: sx('Validating', '验证中'), tone: 'validating' },
    published: { label: sx('Live', '上架中'), tone: 'published' },
    paused: { label: sx('Paused', '已下架'), tone: 'paused' },
    provider_busy: { label: sx('Provider busy', '设备忙碌'), tone: 'attention' },
    unhealthy: { label: sx('Unhealthy', '运行异常'), tone: 'attention' },
    capacity_insufficient: { label: sx('Capacity full', '容量不足'), tone: 'attention' },
    performance_degraded: { label: sx('Performance degraded', '性能降级'), tone: 'attention' },
    retired: { label: sx('Retired', '已退役'), tone: 'retired' },
  }
  return statuses[status] || { label: status.replaceAll('_', ' '), tone: 'neutral' }
}

function v3DisplayReadinessCheck(check: V3ReadinessCheck): V3ReadinessCheck {
  if (check.id !== 'ssh_ingress') return check
  return {
    ...check,
    id: 'terminal_webrtc_delivery',
    label: sx('Exora Terminal and WebRTC delivery ready', 'Exora 终端与 WebRTC 交付就绪'),
    detail: sx(
      'Terminal and WebRTC delivery is unavailable until Cloud completes the delivery upgrade.',
      'Cloud 完成交付能力升级前，终端与 WebRTC 交付暂不可用。',
    ),
  }
}

function renderV3ListingEmptyState() {
  const sources = v3ProviderApplicationSources()
  return `<section class="v3-listing-empty v3-console-panel">
    <div class="v3-listing-empty-mark">${icon(SquareKanban)}</div>
    <span>LISTING PIPELINE</span>
    <h3>No listing applications yet</h3>
    <p>Start in one of the provider workflows below. Submitting creates a private draft here, so nothing reaches the market until you review and publish it.</p>
    <div class="v3-listing-source-grid">
      ${sources.map((source) => { const meta = v3ListingSourceMeta(source); return `<button type="button" class="source-${source}" data-v3-listing-source="${source}"><span>${icon(meta.icon)}</span><div><strong>${escapeHTML(meta.shortLabel)}</strong><small>${escapeHTML(meta.description)}</small></div>${toolbarIcons.disclosure}</button>` }).join('')}
    </div>
    <footer><span>${icon(ShieldCheck)}</span><strong>Private by default</strong><small>Applications remain read-only here; publishing is always an explicit action.</small></footer>
  </section>`
}


type V3UnifiedListingItem = { listing: V3Listing; product: V3Product; application?: V3ListingApplication; resourceItems?: V3CatalogResourceItem[]; focusResourceItem?: V3CatalogResourceItem; rowId?: string; isOwner: boolean }

function v3UnifiedListingItems() {
  const items = new Map<string, V3UnifiedListingItem>()
  state.v3CatalogListings.forEach((catalog) => {
    const resources = catalog.resourceItems || []
    if (catalog.productManifest.applicationSource === 'resources' && resources.length) {
      resources.forEach((resource) => items.set(`${catalog.listing.listingId}:${resource.resourceItemId}`, { listing: catalog.listing, product: catalog.productManifest, resourceItems: [resource], focusResourceItem: resource, rowId: `${catalog.listing.listingId}:${resource.resourceItemId}`, isOwner: false }))
    } else {
      items.set(catalog.listing.listingId, { listing: catalog.listing, product: catalog.productManifest, resourceItems: resources, rowId: catalog.listing.listingId, isOwner: false })
    }
  })
  state.v3ListingApplications.forEach((application) => {
    for (const key of [...items.keys()]) if (key === application.listing.listingId || key.startsWith(`${application.listing.listingId}:`)) items.delete(key)
    items.set(application.listing.listingId, { listing: application.listing, product: application.product, application, resourceItems: application.resourceItems || [], rowId: application.listing.listingId, isOwner: true })
  })
  return [...items.values()].sort((left, right) => {
    const time = new Date(right.listing.updatedAt || right.product.updatedAt || 0).getTime() - new Date(left.listing.updatedAt || left.product.updatedAt || 0).getTime()
    return time || left.listing.listingId.localeCompare(right.listing.listingId)
  })
}

function v3SourceForProduct(product: V3Product) {
  const source = String(product.applicationSource || '')
  return source === 'vm' || source === 'resources' || source === 'endpoint' || source === 'api_bridge' ? source : 'unclassified'
}

function v3RedactedConsumerJSON(value: unknown) {
  const redact = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(redact)
    if (!item || typeof item !== 'object') return item
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, nested]) => [key, /account.*key|authorization|access.*token|provider.*secret/i.test(key) ? '[redacted]' : redact(nested)]))
  }
  return JSON.stringify(redact(value), null, 2)
}

function renderV3APIConsumerPanel(item: V3UnifiedListingItem, operations: Array<Record<string, any>>, configured: boolean, balanceLabel: string, maxCharge: number, keyAction: string, error: string, result: string) {
  const { listing } = item
  const operation = operations.find((candidate) => String(candidate.operationId || '') === state.v3ConsumerOperationId) || operations[0] || { operationId: 'default', method: 'POST', path: '/' }
  const operationId = String(operation.operationId || 'default')
  const parameters = Array.isArray(operation.parameters) ? operation.parameters as Array<Record<string, any>> : []
  const requestSchema = operation.requestSchema || operation.requestBody?.content?.['application/json']?.schema || operation.schema || {}
  const schemaProperties = requestSchema && typeof requestSchema === 'object' && requestSchema.properties && typeof requestSchema.properties === 'object' ? requestSchema.properties as Record<string, Record<string, any>> : {}
  const requiredBody = new Set(Array.isArray(requestSchema.required) ? requestSchema.required.map(String) : [])
  const parameterFields = [
    ...parameters.map((parameter) => {
      const name = String(parameter.name || '')
      const location = String(parameter.in || 'query')
      const schema = parameter.schema || {}
      const type = schema.type === 'integer' || schema.type === 'number' ? 'number' : 'text'
      const field = `parameter:${location}:${name}`
      const value = state.v3ConsumerParameters[field] ?? schema.default ?? ''
      return `<label>${escapeHTML(name)} <small>${escapeHTML(location)}</small><input name="${escapeAttr(field)}" type="${type}" ${parameter.required ? 'required' : ''} value="${escapeAttr(String(value))}"/></label>`
    }),
    ...Object.entries(schemaProperties).map(([name, schema]) => {
      const type = schema.type === 'integer' || schema.type === 'number' ? 'number' : schema.type === 'boolean' ? 'checkbox' : 'text'
      const field = `schema:${name}`
      const value = state.v3ConsumerParameters[field] ?? schema.default ?? ''
      return `<label>${escapeHTML(name)} <small>body</small><input name="${escapeAttr(field)}" type="${type}" ${requiredBody.has(name) ? 'required' : ''} ${type === 'checkbox' ? (value === true || value === 'true' ? 'checked' : '') : `value="${escapeAttr(String(value))}"`}/></label>`
    }),
  ].join('')
  const operationOptions = operations.length
    ? operations.map((candidate) => { const id = String(candidate.operationId || ''); return `<option value="${escapeAttr(id)}" ${id === operationId ? 'selected' : ''}>${escapeHTML(`${String(candidate.method || 'POST').toUpperCase()} ${candidate.path || '/'} - ${candidate.title || id}`)}</option>` }).join('')
    : '<option value="default">Default operation</option>'
  const payload = `{"listingId":"${listing.listingId}","operationId":"${operationId}","idempotencyKey":"YOUR_STABLE_KEY","maxChargeAtomic":${maxCharge},"body":{}}`
  const curl = `curl -X POST "$EXORA_CLOUD_URL/v3/invocations" \\\n+  -H "Authorization: Bearer $EXORA_API_KEY" \\\n+  -H "Content-Type: application/json" \\\n+  -d '${payload}'`
  const javascript = `const response = await fetch(process.env.EXORA_CLOUD_URL + "/v3/invocations", {\n  method: "POST",\n  headers: { Authorization: "Bearer " + process.env.EXORA_API_KEY, "Content-Type": "application/json" },\n  body: JSON.stringify(${payload})\n});\nconsole.log(await response.json());`
  const python = `import os, requests\nresponse = requests.post(\n    os.environ["EXORA_CLOUD_URL"] + "/v3/invocations",\n    headers={"Authorization": "Bearer " + os.environ["EXORA_API_KEY"]},\n    json={"listingId": "${listing.listingId}", "operationId": "${operationId}", "idempotencyKey": "YOUR_STABLE_KEY", "maxChargeAtomic": ${maxCharge}, "body": {}}\n)\nprint(response.json())`
  return `<section class="v3-consumer-panel"><header><div><span>MANUAL API CLIENT</span><strong>Invoke this operation</strong></div><em data-v3-consumer-balance>${escapeHTML(balanceLabel)}</em></header>${error}<form data-v3-consumer-form="api" data-listing-id="${escapeAttr(listing.listingId)}"><label>Operation<select name="operationId" data-v3-consumer-operation>${operationOptions}</select></label>${parameterFields ? `<fieldset class="v3-consumer-parameters"><legend>Manifest parameters</legend>${parameterFields}</fieldset>` : ''}<label>JSON request body<textarea name="body" spellcheck="false">${escapeHTML(state.v3ConsumerRequestBody)}</textarea></label><div class="v3-consumer-charge"><span>Maximum charge</span><strong>${escapeHTML(v3AtomicMoney(maxCharge, 'USDC'))}</strong></div><button type="submit" ${configured && !state.v3ConsumerBusy ? '' : 'disabled'}>${state.v3ConsumerBusy ? 'Invoking...' : 'Invoke operation'}</button>${keyAction}</form><details class="v3-consumer-code"><summary>curl</summary><pre>${escapeHTML(curl)}</pre></details><details class="v3-consumer-code"><summary>JavaScript</summary><pre>${escapeHTML(javascript)}</pre></details><details class="v3-consumer-code"><summary>Python</summary><pre>${escapeHTML(python)}</pre></details>${result}</section>`
}

function renderV3ComputeControl(lease: Record<string, any>) {
  const leaseId = escapeAttr(String(lease.leaseId || ''))
  if (lease.securityMode !== 'isolated_control_p2p_v1' || lease.status !== 'active') return ''
  return `<section class="v3-compute-control" data-v3-compute-control data-lease-id="${leaseId}">
    <header><div><span>ISOLATED VM CONTROL</span><strong>Exora terminal and direct files</strong></div><em>No direct Internet</em></header>
    <form data-v3-compute-command data-lease-id="${leaseId}"><label>Root command<textarea name="command" rows="3" spellcheck="false" placeholder="uname -a"></textarea></label><button type="submit">Run through Exora</button></form>
    <pre data-v3-compute-command-output>Command output is kept locally for this view.</pre>
    <div class="v3-compute-file-grid">
      <form data-v3-compute-transfer="upload" data-lease-id="${leaseId}"><strong>Upload to /workspace</strong><label>Local file<div class="v3-file-picker"><input name="localPath" readonly required/><button class="ghost" type="button" data-v3-compute-file-pick="upload">Choose</button></div></label><label>VM relative path<input name="workspaceRelativePath" placeholder="models/model.bin" required/></label><button type="submit">Start P2P upload</button></form>
      <form data-v3-compute-transfer="download" data-lease-id="${leaseId}"><strong>Download from /workspace</strong><label>VM relative path<input name="workspaceRelativePath" placeholder="outputs/result.bin" required/></label><label>Expected bytes<input name="sizeBytes" type="number" min="0" step="1" required/></label><label>Expected SHA-256<input name="sha256" minlength="64" maxlength="64" required/></label><label>Local destination<div class="v3-file-picker"><input name="localPath" readonly required/><button class="ghost" type="button" data-v3-compute-file-pick="download">Choose</button></div></label><button type="submit">Start P2P download</button></form>
    </div>
    <div class="v3-compute-transfer-status" data-v3-compute-transfer-status>Files use WebRTC DTLS directly between Docks; Cloud stores only transfer receipts and SHA-256.</div>
  </section>`
}

async function pollV3ComputeTransfer(transferId: string, target: HTMLElement) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const response = await invoke<{ transfer?: Record<string, any> }>('consumer_compute_transfer_status', { input: { transferId } })
    const transfer = response.transfer || {}
    const completed = Number(transfer.bytesComplete || 0)
    const total = Number(transfer.sizeBytes || 0)
    target.textContent = `${String(transfer.status || 'connecting')} · ${v3FormatBytes(completed)}${total ? ` / ${v3FormatBytes(total)}` : ''}${transfer.error ? ` · ${String(transfer.error)}` : ''}`
    if (transfer.status === 'completed' || transfer.status === 'failed') return
    await new Promise((resolve) => window.setTimeout(resolve, 1000))
  }
  target.textContent = 'Transfer status timed out; the direct transfer may still be running.'
}

function renderV3ConsumerPanel(item: V3UnifiedListingItem) {
  const { listing, product } = item
  const configured = true
  const balance = state.v3ConsumerBalance
  const balanceLabel = balance ? v3AtomicMoney(balance.availableAtomic, balance.asset || 'USDC') : 'Checking balance…'
  const maxCharge = v3ConsumerMaxCharge(listing, product, product.productKind === 'compute' ? state.v3ConsumerMinutes : 1)
  const operations = v3ServiceManifestOperations(product.manifest || {})
  const disclosure = product.productKind === 'compute' && product.manifest?.runtimeBackend === 'wsl2'
    ? `<div class="v3-consumer-disclosure"><strong>Managed WSL2 · shared host</strong><span>One Exora lease per host. CPU and memory are configured caps; the Windows GPU driver is shared and is not hardware passthrough.</span></div>`
    : product.productKind === 'compute' ? `<div class="v3-consumer-disclosure kvm"><strong>KVM/libvirt hardware isolation</strong><span>Disposable encrypted write layer, Guest Root, and provider-controlled reset.</span></div>` : ''
  const workloadMode = String(listing.workloadPolicy?.sustainedCompute || 'allowed')
  const performanceDisclosure = product.productKind === 'compute'
    ? `<div class="v3-consumer-disclosure"><strong>${workloadMode === 'burst_only' ? 'Burst workloads only' : 'Sustained compute allowed'} · Cryptocurrency mining prohibited</strong><span>Dual performance monitoring${workloadMode === 'burst_only' ? product.manifest?.runtimeBackend === 'wsl2' ? ' · Windows monitoring-only Preview' : ' · Linux host throttling after the grace period' : ' · load is observed but not restricted'}.</span></div>`
    : ''
  const result = state.v3ConsumerResponse ? `<section class="v3-consumer-result"><header><strong>Latest result</strong><span>Secrets and provider credentials are redacted</span></header><pre>${escapeHTML(v3RedactedConsumerJSON(state.v3ConsumerResponse))}</pre></section>` : ''
  const transfer = state.v3ConsumerTransferProgress
  const transferStatus = transfer ? `<div class="v3-consumer-transfer"><span>${escapeHTML(transfer.phase)}</span><progress max="${Math.max(1, transfer.sizeBytes || transfer.bytesDownloaded || 1)}" value="${transfer.bytesDownloaded}"></progress><strong>${escapeHTML(v3FormatBytes(transfer.bytesDownloaded))}${transfer.sizeBytes ? ` / ${escapeHTML(v3FormatBytes(transfer.sizeBytes))}` : ''}</strong></div>` : ''
  const error = `${state.v3ConsumerError ? `<div class="v3-error">${escapeHTML(state.v3ConsumerError)}</div>` : ''}${transferStatus}`
  const keyAction = ''
  if (product.productKind === 'api_operation') {
    return renderV3APIConsumerPanel(item, operations, configured, balanceLabel, maxCharge, keyAction, error, result)
    const operationOptions = operations.length ? operations.map((operation) => `<option value="${escapeAttr(String(operation.operationId || ''))}">${escapeHTML(`${String(operation.method || 'POST').toUpperCase()} ${operation.path || '/'} · ${operation.title || operation.operationId}`)}</option>`).join('') : '<option value="default">Default operation</option>'
    const curl = `curl -X POST "$EXORA_CLOUD_URL/v3/invocations" \\\n  -H "Authorization: Bearer $EXORA_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"listingId":"${listing.listingId}","operationId":"${String((operations[0] || {}).operationId || 'default')}","idempotencyKey":"YOUR_STABLE_KEY","maxChargeAtomic":${maxCharge},"body":{}}'`
    return `<section class="v3-consumer-panel">${disclosure}<header><div><span>MANUAL API CLIENT</span><strong>Invoke this operation</strong></div><em data-v3-consumer-balance>${escapeHTML(balanceLabel)}</em></header>${error}<form data-v3-consumer-form="api" data-listing-id="${escapeAttr(listing.listingId)}"><label>Operation<select name="operationId">${operationOptions}</select></label><label>JSON request body<textarea name="body" spellcheck="false">${escapeHTML(state.v3ConsumerRequestBody)}</textarea></label><div class="v3-consumer-charge"><span>Maximum charge</span><strong>${escapeHTML(v3AtomicMoney(maxCharge, 'USDC'))}</strong></div><button type="submit" ${configured && !state.v3ConsumerBusy ? '' : 'disabled'}>${state.v3ConsumerBusy ? 'Invoking…' : 'Invoke operation'}</button>${keyAction}</form><details class="v3-consumer-code"><summary>Use in your own code</summary><pre>${escapeHTML(curl)}</pre></details>${result}</section>`
  }
  if (product.productKind === 'download') {
    const resourceItems = item.focusResourceItem ? [item.focusResourceItem] : item.resourceItems || []
    const cards = resourceItems.map((resource) => {
      const amountAtomic = Math.round(Number(resource.price?.amount || 0) * 1_000_000)
      const currentGrant = state.v3ConsumerGrant
      const ownsCurrent = currentGrant?.resourceItemId === resource.resourceItemId
      return `<article class="v3-resource-purchase-item"><header><div><strong>${escapeHTML(resource.title)}</strong><small>${escapeHTML(resource.fileName)} · ${escapeHTML(v3FormatBytes(resource.sizeBytes))}</small></div><em>${escapeHTML(v3AtomicMoney(amountAtomic, 'USDC'))}</em></header><p>${escapeHTML(resource.description)}</p>${resource.tags?.length ? `<div class="v3-resource-tag-list">${resource.tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join('')}</div>` : ''}<dl class="detail-grid"><div><dt>License</dt><dd>${escapeHTML(resource.license)}</dd></div><div><dt>Access</dt><dd>${resource.grantHours} hours</dd></div><div><dt>SHA-256</dt><dd>${escapeHTML(resource.sha256.slice(0, 16))}…</dd></div></dl><div class="v3-consumer-actions"><button type="button" data-v3-consumer-action="purchase-download" data-listing-id="${escapeAttr(listing.listingId)}" data-resource-item-id="${escapeAttr(resource.resourceItemId)}" data-max-charge="${amountAtomic}" ${configured && !state.v3ConsumerBusy ? '' : 'disabled'}>${state.v3ConsumerBusy ? 'Purchasing…' : 'Purchase this file'}</button>${ownsCurrent ? `<button class="ghost" type="button" data-v3-consumer-action="create-transfer" data-grant-id="${escapeAttr(String(currentGrant?.grantId || ''))}">Download file</button>` : ''}</div></article>`
    }).join('')
    return `<section class="v3-consumer-panel">${disclosure}<header><div><span>RESOURCE SHEET</span><strong>Files are priced and purchased independently</strong></div><em data-v3-consumer-balance>${escapeHTML(balanceLabel)}</em></header>${error}<div class="v3-resource-purchase-list">${cards || '<div class="v3-error">This sheet has no published files.</div>'}</div>${result}</section>`
  }
  const lease = state.v3ConsumerLease
  const leasePerformance = (lease?.performance || {}) as Record<string, any>
  const limits = v3ComputeListingLimits(listing, product)
  const cumulative = Number(lease?.durationMinutes || 0)
  const remaining = Math.max(0, limits.maxMinutes - cumulative)
  const estimate = state.v3ConsumerEstimate
  const quoted = estimate ? v3AtomicMoney(Number(estimate.amountAtomic || 0), 'USDC') : state.v3ConsumerEstimateLoading ? 'Calculating…' : '—'
  const estimateDetail = estimate ? `${Number(estimate.baseFeeAtomic || 0) > 0 ? `${v3AtomicMoney(Number(estimate.baseFeeAtomic), 'USDC')} start · ` : ''}${Number(estimate.discountAtomic || 0) > 0 ? `${v3AtomicMoney(Number(estimate.discountAtomic), 'USDC')} discount · ` : ''}${Number(estimate.cumulativeMinutes || estimate.durationMinutes || 0)} cumulative min` : 'Cloud-authoritative quote required'
  const purchaseForm = !lease ? `<form data-v3-consumer-form="compute" data-listing-id="${escapeAttr(listing.listingId)}"><label>Duration in minutes<input name="durationMinutes" type="number" min="${limits.minMinutes}" max="${limits.maxMinutes}" step="1" value="${state.v3ConsumerMinutes}"/></label><div class="v3-consumer-charge"><span>Current estimate</span><strong>${escapeHTML(quoted)}</strong><small data-v3-compute-estimate-detail>${escapeHTML(estimateDetail)}</small></div><small class="v3-compute-estimate-error" data-v3-compute-estimate-error>${escapeHTML(state.v3ConsumerError || '')}</small><button type="submit" data-v3-compute-submit ${configured && estimate?.mode === 'initial' && !state.v3ConsumerBusy && !state.v3ConsumerEstimateLoading ? '' : 'disabled'}>${state.v3ConsumerBusy ? 'Provisioning…' : 'Purchase and provision'}</button>${keyAction}</form>` : ''
  const leasePanel = lease ? `<section class="v3-consumer-lease"><header><strong>Lease ${escapeHTML(String(lease.leaseId || ''))}</strong><span>${escapeHTML(String(lease.status || ''))}</span></header><dl class="detail-grid"><div><dt>Backend</dt><dd>${escapeHTML(String(lease.backend || ''))}</dd></div><div><dt>Expires</dt><dd>${escapeHTML(lease.expiresAt ? new Date(String(lease.expiresAt)).toLocaleString() : 'Provisioning')}</dd></div><div><dt>Rental time</dt><dd>${cumulative} / ${limits.maxMinutes} cumulative minutes</dd></div><div><dt>Extension capacity</dt><dd>${remaining} minutes remaining</dd></div><div><dt>Performance</dt><dd>${escapeHTML(leasePerformance.deliveryBps ? `${Number(leasePerformance.deliveryBps) / 100}% delivery` : 'Dual probes starting')} · ${leasePerformance.throttled ? 'throttled' : escapeHTML(String(lease.enforcementMode || 'observe_only'))}</dd></div></dl>${remaining > 0 ? `<form data-v3-consumer-form="compute-extension" data-listing-id="${escapeAttr(listing.listingId)}" data-purchase-id="${escapeAttr(String(state.v3ConsumerPurchase?.purchaseId || ''))}"><label>Extend minutes<input name="durationMinutes" type="number" min="1" max="${remaining}" step="1" value="${Math.min(state.v3ConsumerMinutes, remaining)}"/></label><div class="v3-consumer-charge"><span>Extension estimate</span><strong>${escapeHTML(quoted)}</strong><small data-v3-compute-estimate-detail>${escapeHTML(estimateDetail)}</small></div><small class="v3-compute-estimate-error" data-v3-compute-estimate-error>${escapeHTML(state.v3ConsumerError || '')}</small><button type="submit" data-v3-compute-submit ${estimate?.mode === 'extension' && !state.v3ConsumerBusy && !state.v3ConsumerEstimateLoading ? '' : 'disabled'}>Extend lease</button></form>` : '<div class="v3-consumer-limit-reached">Maximum rental time reached</div>'}<pre>${escapeHTML(v3RedactedConsumerJSON(lease.capability || {}))}</pre>${renderV3ComputeControl(lease)}<div class="v3-consumer-actions"><button class="danger ghost" type="button" data-v3-consumer-action="release-lease" data-lease-id="${escapeAttr(String(lease.leaseId || ''))}">Release lease</button></div></section>` : ''
  return `<section class="v3-consumer-panel">${disclosure}${performanceDisclosure}<header><div><span>COMPUTE PURCHASE</span><strong>${lease ? 'Active lease and extension' : `Reserve ${limits.minMinutes}–${limits.maxMinutes} whole minutes`}</strong></div><em data-v3-consumer-balance>${escapeHTML(balanceLabel)}</em></header>${error}${purchaseForm}${leasePanel}${result}</section>`
}

function renderV3OwnedResourceItems(item: V3UnifiedListingItem) {
  const { listing, product } = item
  const cards = (item.resourceItems || []).map((resource) => {
    const amount = Number(resource.price?.amount || 0)
    const actions = [
      resource.status === 'published' ? `<button class="ghost" type="button" data-v3-resource-item-action="pause" data-resource-item-id="${escapeAttr(resource.resourceItemId)}">Pause</button>` : '',
      resource.status === 'paused' ? `<button type="button" data-v3-resource-item-action="resume" data-resource-item-id="${escapeAttr(resource.resourceItemId)}">Resume</button>` : '',
      resource.status === 'ready' && listing.status === 'published' ? `<button type="button" data-v3-resource-item-action="publish" data-resource-item-id="${escapeAttr(resource.resourceItemId)}">Publish</button>` : '',
      resource.status !== 'retired' ? `<button class="danger ghost" type="button" data-v3-resource-item-action="retire" data-resource-item-id="${escapeAttr(resource.resourceItemId)}">Retire</button>` : '',
    ].join('')
    return `<form class="v3-resource-owner-item" data-v3-resource-item-form data-resource-item-id="${escapeAttr(resource.resourceItemId)}"><header><div><strong>${escapeHTML(resource.fileName)}</strong><small>${escapeHTML(v3FormatBytes(resource.sizeBytes))} · ${escapeHTML(resource.status)}</small></div><em>v${resource.version}</em></header><div class="v3-resource-owner-fields"><label>Title<input name="title" value="${escapeAttr(resource.title)}" required/></label><label>Description<textarea name="description" required>${escapeHTML(resource.description)}</textarea></label><label>Tags<input name="tags" value="${escapeAttr((resource.tags || []).join(', '))}"/></label><label>Price (USDC)<input name="price" type="number" min="0.000001" step="0.000001" value="${escapeAttr(String(amount))}" required/></label><label>License<input name="license" value="${escapeAttr(resource.license)}" required/></label><label>Grant hours<input name="grantHours" type="number" min="1" max="720" step="1" value="${resource.grantHours}" required/></label></div><div class="v3-resource-owner-actions"><button type="submit">Save terms</button>${actions}</div></form>`
  }).join('')
  return `<section class="v3-listing-detail-section"><header><span>RESOURCE ITEMS</span><strong>${item.resourceItems?.length || 0} independently purchasable files</strong></header><div class="v3-resource-owner-list">${cards || '<p>No files have been added.</p>'}</div>${listing.status !== 'retired' ? `<button type="button" data-v3-resource-add-files data-listing-id="${escapeAttr(listing.listingId)}" data-product-id="${escapeAttr(product.productId)}" data-title="${escapeAttr(product.title)}" data-description="${escapeAttr(product.description)}">Add files</button>` : ''}</section>`
}


function renderV3UnifiedListingRow(item: V3UnifiedListingItem) {
  const { listing, product, application, isOwner } = item
  const source = application?.source || listing.applicationSource || v3SourceForProduct(product)
  const sourceMeta = v3ListingSourceMeta(source)
  const statusMeta = v3ListingStatusMeta(listing.status)
  const rowId = item.rowId || listing.listingId
  const expanded = state.v3ExpandedListingId === rowId
  const readiness = application?.readiness
  const checks = (readiness?.checks || []).map(v3DisplayReadinessCheck)
  const passedChecks = checks.filter((check) => check.ready).length
  const fallbackActions = listing.status === 'published' ? ['pause'] : listing.status === 'draft' && readiness?.ready ? ['publish'] : ['paused', 'unhealthy', 'provider_busy', 'capacity_insufficient'].includes(listing.status) && readiness?.ready ? ['resume'] : []
  const lifecycle = application?.lifecycle || { listed: listing.status === 'published' && listing.availability?.availableNow !== false, allowedActions: fallbackActions, statusReason: String(listing.availability?.reason || '') }
  const deleteAllowed = lifecycle.allowedActions.includes('delete')
  const ownerStatusReason = deleteAllowed
    ? lifecycle.statusReason || 'You cannot purchase your own listing.'
    : sx('Connected Cloud must be upgraded before Listing deletion is available.', '连接的 Cloud 升级后才能删除挂单。')
  const toggleAction = lifecycle.listed ? (lifecycle.allowedActions.includes('pause') ? 'pause' : '') : lifecycle.allowedActions.includes('publish') ? 'publish' : lifecycle.allowedActions.includes('resume') ? 'resume' : ''
  const attention = ['unhealthy', 'provider_busy', 'capacity_insufficient', 'performance_degraded'].includes(listing.status)
  const displayTitle = item.focusResourceItem?.title || product.title || listing.productId
  const displayDescription = item.focusResourceItem?.description || product.description
  const displayPrice = item.focusResourceItem ? v3ListingPriceLabel(item.focusResourceItem.price) : v3ListingPriceLabel(listing.price || {})
  const searchable = [listing.listingId, product.productId, displayTitle, displayDescription, item.focusResourceItem?.fileName, sourceMeta.label, statusMeta.label, isOwner ? 'owner mine' : 'marketplace'].filter(Boolean).join(' ').toLowerCase()
  const ownerActions = [
    product.productKind === 'compute' && ['draft', 'published'].includes(listing.status) ? `<button class="ghost" type="button" data-v3-compute-terms-edit data-listing-id="${escapeAttr(listing.listingId)}">${state.v3EditingListingId === listing.listingId ? 'Editing terms' : 'Edit terms'}</button>` : '',
    `<button class="danger ghost" type="button" ${deleteAllowed ? 'data-v3-listing-delete' : 'data-v3-listing-delete-unavailable'} data-listing-id="${escapeAttr(listing.listingId)}" title="${escapeAttr(deleteAllowed ? 'Delete this Listing' : ownerStatusReason)}">Delete listing</button>`,
  ].join('')
  const agentProvenance = listing.creationActor === 'agent' ? `<section class="v3-listing-detail-section v3-agent-provenance"><header><span>AGENT SOURCE</span><strong>Created by Dock seller automation</strong></header><dl class="detail-grid"><div><dt>Draft run</dt><dd>${escapeHTML(listing.draftRunId || 'Not recorded')}</dd></div><div><dt>Source fingerprint</dt><dd>${escapeHTML((listing.sourceFingerprint || '').slice(0, 32) || 'Not recorded')}</dd></div><div><dt>MCP connection</dt><dd>${escapeHTML(listing.mcpConnection || 'Local Agent')}</dd></div><div><dt>Seller policy</dt><dd>${escapeHTML(listing.sellerPolicyReceipt ? `${listing.sellerPolicyReceipt.policyId} v${listing.sellerPolicyReceipt.version}` : 'Not recorded')}</dd></div></dl></section>` : ''
  const readinessPanel = `<section class="v3-listing-detail-section"><header><span>PUBLISH READINESS</span><strong>${checks.length ? `${passedChecks} of ${checks.length} checks passed` : 'Waiting for Cloud checks'}</strong></header><div class="v3-listing-checks">${checks.map((check) => `<div class="${check.ready ? 'passed' : 'failed'}"><span>${check.ready ? '&#10003;' : '!'}</span><div><strong>${escapeHTML(check.label)}</strong><small>${escapeHTML(check.detail || '')}</small></div></div>`).join('') || '<div class="failed"><span>!</span><div><strong>No readiness report</strong><small>Refresh to request current checks.</small></div></div>'}</div></section>`
  return `<article class="v3-listing-application ${expanded ? 'expanded' : ''}" data-listing-row="${escapeAttr(rowId)}" data-listing-source="${escapeAttr(source)}" data-listing-kind="${escapeAttr(product.productKind)}" data-listing-status="${escapeAttr(listing.status)}" data-listing-ready="${String(Boolean(readiness?.ready))}" data-listing-attention="${String(attention)}" data-listing-owner="${String(isOwner)}" data-listing-search="${escapeAttr(searchable)}">
    <button type="button" class="v3-listing-summary" data-v3-listing-expand="${escapeAttr(rowId)}" aria-expanded="${String(expanded)}">
      <span class="v3-listing-source-icon source-${escapeAttr(source)}">${icon(sourceMeta.icon)}</span>
      <span class="v3-listing-primary"><strong>${escapeHTML(displayTitle)}</strong><small><em class="v3-source-badge source-${escapeAttr(source)}">${escapeHTML(sourceMeta.shortLabel)}</em><em class="v3-owner-badge ${isOwner ? 'owner' : 'market'}">${isOwner ? 'Owner' : 'Marketplace'}</em>${listing.creationActor === 'agent' ? '<em class="v3-source-badge agent-created">Agent created</em>' : ''}<span>${escapeHTML(item.focusResourceItem ? `${product.title} · ${item.focusResourceItem.fileName}` : product.providerDockId || listing.listingId)}</span></small></span>
      <span class="v3-listing-summary-metrics"><span><small>Price</small><strong>${escapeHTML(displayPrice)}</strong></span><span><small>${isOwner ? 'Readiness' : 'Availability'}</small><strong>${isOwner ? checks.length ? `${passedChecks}/${checks.length} checks` : readiness?.ready ? 'Ready' : 'Pending' : listing.availability?.availableNow === false ? 'Unavailable' : 'Available now'}</strong></span></span>
      ${isOwner ? '<span class="v3-listing-state-slot" aria-hidden="true"></span>' : `<span class="v3-listing-state-pill tone-${escapeAttr(statusMeta.tone)}"><i></i>${escapeHTML(statusMeta.label)}</span>`}<span class="v3-listing-chevron">${toolbarIcons.disclosure}</span>
    </button>
    ${isOwner ? `<button type="button" class="v3-listing-state-pill v3-listing-lifecycle-switch tone-${escapeAttr(statusMeta.tone)} ${lifecycle.listed ? 'is-listed' : ''}" role="switch" aria-checked="${String(lifecycle.listed)}" aria-label="${escapeAttr(lifecycle.listed ? 'Take Listing offline' : 'List this offer')}" title="${escapeAttr(lifecycle.statusReason || statusMeta.label)}" data-v3-listing-action="${escapeAttr(toggleAction)}" data-listing-id="${escapeAttr(listing.listingId)}" ${toggleAction ? '' : 'disabled'}><i></i>${escapeHTML(statusMeta.label)}</button>` : ''}
    ${expanded ? `<div class="v3-listing-application-body"><div class="v3-listing-detail-head"><div><small>${isOwner ? 'YOUR LISTING' : 'MARKETPLACE OFFER'}</small><strong>${isOwner ? 'Manage this offer without leaving the market' : 'Review the manifest and use this product manually'}</strong></div><span class="${isOwner ? 'ready' : 'market'}">${isOwner ? `${icon(ShieldCheck)} Owner controls` : `${icon(BadgeCheck)} Public listing`}</span></div>${agentProvenance}<section class="v3-listing-detail-section"><header><span>PRODUCT MANIFEST</span><strong>${escapeHTML(product.description || 'Machine-readable Exora product')}</strong></header>${renderV3ApplicationManifest(source, product.manifest || {}, listing)}</section>${isOwner ? `${source === 'resources' ? renderV3OwnedResourceItems(item) : ''}${readinessPanel}${renderV3ComputeTermsEditor(listing)}<div class="v3-listing-actions"><span><strong>Owner controls</strong><small>${escapeHTML(ownerStatusReason)}</small></span>${ownerActions}</div>` : renderV3ConsumerPanel(item)}</div>` : ''}
  </article>`
}

function renderV3UnifiedListingsPageV2() {
  const items = v3UnifiedListingItems()
  const isBuyer = state.v3ListingMode === 'buyer'
  const visibleItems = items.filter((item) => {
    if (isBuyer ? item.isOwner : !item.isOwner) return false
    const source = item.application?.source || item.listing.applicationSource || v3SourceForProduct(item.product)
    return state.v3ListingSourceFilter === 'api'
      ? source === 'endpoint' || source === 'api_bridge'
      : source === state.v3ListingSourceFilter
  })
  const rows = visibleItems.map(renderV3UnifiedListingRow).join('')
  const sourceLoading = isBuyer ? state.v3CatalogLoading : state.v3ListingsLoading
  const sourceError = isBuyer ? state.v3CatalogError : state.v3SellerError
  const initialLoading = !rows && sourceLoading ? '<div class="v3-listing-loading"><span><i></i><b></b><em></em></span><span><i></i><b></b><em></em></span></div>' : ''
  const buyerEmpty = '<div class="v3-marketplace-empty"><span>' + icon(Search) + '</span><strong>No marketplace listings found</strong><small>Published products from other sellers will appear here.</small></div>'
  const empty = !rows && !sourceLoading && (!isBuyer || !sourceError) ? (isBuyer ? buyerEmpty : renderV3ListingEmptyState()) : ''
  const placeholder = isBuyer ? 'Search the marketplace' : 'Search your listings and applications'
  const activeRuns = (state.sellerAutomation?.runs || []).filter((run) => !['completed', 'cancelled'].includes(run.status)).slice(0, 5)
  const runPanel = !isBuyer && activeRuns.length ? `<section class="v3-agent-draft-runs"><header><span>${icon(BrainCircuit)}</span><div><strong>Agent draft runs</strong><small>Dock-owned progress before a private Listing exists</small></div></header>${activeRuns.map((run) => `<article class="status-${escapeAttr(run.status)}"><span>${escapeHTML(run.kind)}</span><div><strong>${escapeHTML(run.status.replaceAll('_', ' '))}</strong><progress max="100" value="${Math.max(0, Math.min(100, Number(run.progress || 0)))}"></progress><small>${escapeHTML(run.error || (run.missingFields || []).join(', ') || run.currentStep || '')}</small></div><em>${Math.max(0, Math.min(100, Number(run.progress || 0)))}%</em></article>`).join('')}</section>` : ''
  return `<section class="v3-listings-page">
    <header class="v3-listing-fixed-header">
      <section class="v3-listing-search-switch">
        <label class="v3-listing-search">${toolbarIcons.search}<input type="search" data-v3-listing-search value="${escapeAttr(state.v3ListingQuery)}" placeholder="${placeholder}" aria-label="${placeholder}"/></label>
        <div class="v3-listing-mode-switch v3-listing-project-switch" role="group" aria-label="Project">
          <button type="button" data-v3-listing-project="vm" aria-pressed="${String(state.v3ListingSourceFilter === 'vm')}" class="${state.v3ListingSourceFilter === 'vm' ? 'active' : ''}">VM</button>
          <button type="button" data-v3-listing-project="resources" aria-pressed="${String(state.v3ListingSourceFilter === 'resources')}" class="${state.v3ListingSourceFilter === 'resources' ? 'active' : ''}">RES</button>
          <button type="button" data-v3-listing-project="api" aria-pressed="${String(state.v3ListingSourceFilter === 'api')}" class="${state.v3ListingSourceFilter === 'api' ? 'active' : ''}">API</button>
        </div>
        <div class="v3-listing-mode-switch" role="group" aria-label="Listings view">
          <button type="button" data-v3-listing-mode="buyer" aria-pressed="${String(isBuyer)}" class="${isBuyer ? 'active' : ''}"><span class="tab-icon">${roleTabIcons.buyer}</span><span>Buyer</span></button>
          <button type="button" data-v3-listing-mode="seller" aria-pressed="${String(!isBuyer)}" class="${isBuyer ? '' : 'active'}"><span class="tab-icon">${roleTabIcons.seller}</span><span>Seller</span></button>
        </div>
      </section>
      ${isBuyer ? `<div class="v3-listing-agent-hint">${icon(MessagesSquare)}<span>${escapeHTML(t('listings.agentHint'))}</span><span class="v3-listing-agent-actions"><button type="button" data-v3-listing-agent-copy aria-label="${escapeAttr(t('listings.agentCopy'))}" title="${escapeAttr(t('listings.agentCopy'))}">${icon(Copy)}</button><button type="button" data-v3-listing-agent-details aria-label="${escapeAttr(t('listings.agentDetails'))}" title="${escapeAttr(t('listings.agentDetails'))}">${icon(Info)}</button></span></div>` : ''}
    </header>
    <section class="v3-listing-workspace v3-listing-${state.v3ListingMode}-view scroll-area">${sourceError ? `<div class="v3-market-view-error">${escapeHTML(sourceError)}</div>` : ''}${runPanel}${rows ? `<div class="v3-listing-list">${rows}</div>` : ''}${initialLoading}${empty}<div class="v3-listing-no-results hidden"><strong>No matching listings</strong><small>Try a different search.</small></div></section>
  </section>`
}

function renderV3SellerSurface() {
  state.v3SellerTab = normalizeV3SellerTab(state.v3SellerTab)
  const page = state.v3SellerTab === 'vm' ? renderV3VMPage() : state.v3SellerTab === 'resources' ? renderV3ResourcesPage() : state.v3SellerTab === 'endpoint' ? renderV3EndpointAgentPage() : state.v3SellerTab === 'api_bridge' ? renderV3APIBridgePage() : renderV3UnifiedListingsPageV2()
  const headings: Record<V3SellerTab, { kicker: string; title: string; description: string }> = {
    vm: { kicker: 'COMPUTE SUPPLY', title: 'List this computer', description: 'Measure this PC, install a disposable Linux environment, reserve capacity, then submit a private Listing draft.' },
    resources: { kicker: 'DIGITAL RESOURCES', title: 'Package files and data', description: 'Bundle versioned files, define delivery rights and pricing, then submit a private Listing draft.' },
    endpoint: { kicker: 'LOCAL ENDPOINT', title: 'Expose a local or private service', description: 'Dock must stay online. The local URL and credentials remain only on this Dock while Cloud carries routing and metering contracts.' },
    api_bridge: { kicker: 'PUBLIC API BRIDGE', title: 'Connect a public provider API', description: 'Cloud calls the seller public HTTPS API and keeps its credential encrypted. Dock is not required while buyers invoke it.' },
    listings: { kicker: 'UNIFIED MARKET', title: 'Browse and manage listings', description: 'Discover available products, use them manually, and manage your own drafts and published offers in one list.' },
  }
  const heading = headings[state.v3SellerTab]
  const surfaceHeading = state.v3SellerTab === 'listings' ? '' : `<div class="v3-surface-heading"><div><span>${escapeHTML(heading.kicker)}</span><h2>${escapeHTML(heading.title)}</h2><p>${escapeHTML(heading.description)}</p></div></div>`
  return `<section class="v3-market-surface v3-seller-surface">${surfaceHeading}${state.v3SellerTab !== 'listings' && state.v3SellerError ? `<div class="v3-error">${escapeHTML(state.v3SellerError)}</div>` : ''}<div class="v3-seller-page">${page}</div></section>${vmProviderAvailable ? renderV3EnvironmentCloudModal() : ''}`
}

type V3ApplicationSource = 'vm' | 'resources' | 'endpoint' | 'api_bridge'

function v3ApplicationAttemptStorageKey(source: V3ApplicationSource) {
  return `exora.v3ApplicationAttempt.${source}`
}

function v3StableApplicationAttempt(source: V3ApplicationSource, fingerprint: string) {
  let prior = state.v3ApplicationAttemptKeys[source]
  if (!prior) {
    try { prior = JSON.parse(localStorage.getItem(v3ApplicationAttemptStorageKey(source)) || 'null') || undefined } catch { /* Replace malformed local state. */ }
  }
  if (prior?.fingerprint === fingerprint && prior.key) {
    state.v3ApplicationAttemptKeys[source] = prior
    return prior.key
  }
  const next = { fingerprint, key: `${source}:${crypto.randomUUID()}` }
  state.v3ApplicationAttemptKeys[source] = next
  localStorage.setItem(v3ApplicationAttemptStorageKey(source), JSON.stringify(next))
  return next.key
}

function clearV3ApplicationAttempt(source: V3ApplicationSource) {
  delete state.v3ApplicationAttemptKeys[source]
  localStorage.removeItem(v3ApplicationAttemptStorageKey(source))
  if (source === 'endpoint') state.v3EndpointSaveAttemptKey = undefined
  if (source === 'api_bridge') state.v3APISaveAttemptKey = undefined
}

async function v3CreateProductAndListing(productInput: Record<string, unknown>, price: Record<string, unknown>, valid: boolean, source: 'vm' | 'resources' | 'endpoint' | 'api_bridge' | boolean) {
  const applicationSource = typeof source === 'boolean' ? 'vm' : source
  let effectivePrice = price
  if (productInput.productKind === 'compute') {
    effectivePrice = v3ComputePriceFromState()
    const limits = v3ComputeLimitsFromState()
    const manifest = (productInput.manifest || {}) as Record<string, any>
    productInput.manifest = { ...manifest, price: effectivePrice, limits: { ...(manifest.limits || {}), ...limits }, workloadPolicy: v3ComputeWorkloadPolicy(), performancePolicy: v3ComputePerformancePolicy() }
  }
  const attemptManifest = (productInput.manifest || {}) as Record<string, any>
  const attemptFingerprint = productInput.productKind === 'compute'
    ? JSON.stringify({ applicationSource, productKind: productInput.productKind, title: productInput.title, description: attemptManifest.runtimeBackend ? undefined : productInput.description, effectivePrice, limits: attemptManifest.limits, workloadPolicy: v3ComputeWorkloadPolicy(), performancePolicy: v3ComputePerformancePolicy(), valid, runtimeBackend: attemptManifest.runtimeBackend, environmentImageId: attemptManifest.environmentImageId || attemptManifest.template?.imageId, environmentImageVersion: attemptManifest.environmentImageVersion || attemptManifest.template?.imageVersion, template: attemptManifest.runtimeBackend ? undefined : attemptManifest.template, workspaceGiB: attemptManifest.workspaceGiB })
    : JSON.stringify({ productInput, effectivePrice, valid })
  const idempotencyKey = v3StableApplicationAttempt(applicationSource, attemptFingerprint)
  const manifest = (productInput.manifest || {}) as Record<string, unknown>
  const created = await invoke<{ product: V3Product }>('provider_product_create', { input: { ...productInput, applicationSource, manifest: { ...manifest, applicationSource }, idempotencyKey } })
  const saved = await invoke<{ listing: V3Listing }>('provider_listing_save', { input: { productId: created.product.productId, applicationSource, status: 'draft', price: effectivePrice, limits: productInput.productKind === 'compute' ? v3ComputeLimitsFromState() : undefined, workloadPolicy: productInput.productKind === 'compute' ? v3ComputeWorkloadPolicy() : undefined, performancePolicy: productInput.productKind === 'compute' ? v3ComputePerformancePolicy() : undefined, validation: { valid }, availability: { availableNow: false }, idempotencyKey } })
  state.v3HighlightedListingId = saved.listing.listingId
  state.v3ExpandedListingId = saved.listing.listingId
  state.v3SellerTab = 'listings'
  state.v3ListingsLoaded = false
  await loadV3Listings()
  clearV3ApplicationAttempt(applicationSource)
  return saved.listing
}

function closeV3ResourceSelectPopovers(except?: HTMLElement) {
  fields.actionView.querySelectorAll<HTMLElement>('[data-v3-resource-select].open').forEach((root) => {
    if (root === except) return
    root.classList.remove('open', 'open-upward')
    root.querySelector<HTMLButtonElement>('[data-v3-resource-select-trigger]')?.setAttribute('aria-expanded', 'false')
  })
}

function attachV3ResourceSelectHandlers() {
  fields.actionView.querySelectorAll<HTMLElement>('[data-v3-resource-select]').forEach((root) => {
    const name = root.dataset.v3ResourceSelect as V3ResourceSelectName
    const trigger = root.querySelector<HTMLButtonElement>(`[data-v3-resource-select-trigger="${name}"]`)
    const popover = root.querySelector<HTMLElement>(`[data-v3-resource-select-list="${name}"]`)
    const hidden = root.querySelector<HTMLInputElement>(`[data-v3-resource-select-input="${name}"]`)
    const options = Array.from(root.querySelectorAll<HTMLButtonElement>(`[data-v3-resource-select-option="${name}"]`))
    if (!trigger || !popover || !hidden || !options.length) return

    const close = (restoreFocus = false) => {
      root.classList.remove('open', 'open-upward')
      trigger.setAttribute('aria-expanded', 'false')
      if (restoreFocus) trigger.focus()
    }
    const open = (direction: 'current' | 'first' | 'last' = 'current') => {
      closeV3ResourceSelectPopovers(root)
      root.classList.add('open')
      trigger.setAttribute('aria-expanded', 'true')
      root.classList.remove('open-upward')
      const triggerRect = trigger.getBoundingClientRect()
      if (triggerRect.bottom + popover.offsetHeight + 10 > window.innerHeight && triggerRect.top > popover.offsetHeight + 10) root.classList.add('open-upward')
      const selectedIndex = Math.max(0, options.findIndex((option) => option.getAttribute('aria-selected') === 'true'))
      const focusIndex = direction === 'first' ? 0 : direction === 'last' ? options.length - 1 : selectedIndex
      window.requestAnimationFrame(() => options[focusIndex]?.focus())
    }
    const choose = (option: HTMLButtonElement) => {
      const value = option.dataset.value || ''
      const selectedOption = v3ResourceSelectOptions[name].find((item) => item.value === value)
      if (!selectedOption) return
      if (name === 'license') {
        state.v3ResourceLicense = value
        state.v3ResourceSources = state.v3ResourceSources.map((file) => ({ ...file, license: value }))
      }
      hidden.value = value
      const valueNode = trigger.querySelector('span')
      if (valueNode) valueNode.textContent = selectedOption.label
      options.forEach((item) => {
        const selected = item === option
        item.classList.toggle('selected', selected)
        item.setAttribute('aria-selected', String(selected))
      })
      close(true)
    }

    trigger.addEventListener('click', () => root.classList.contains('open') ? close() : open())
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return }
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        open(event.key === 'ArrowUp' ? 'last' : event.key === 'ArrowDown' ? 'first' : 'current')
        return
      }
      if (event.key.length === 1 && /\S/.test(event.key)) {
        const match = options.find((option) => option.textContent?.trim().toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()))
        if (match) { event.preventDefault(); choose(match) }
      }
    })
    options.forEach((option, index) => {
      option.addEventListener('click', () => choose(option))
      option.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); close(true); return }
        if (event.key === 'Tab') { close(); return }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(option); return }
        let nextIndex: number | undefined
        if (event.key === 'ArrowDown') nextIndex = (index + 1) % options.length
        if (event.key === 'ArrowUp') nextIndex = (index - 1 + options.length) % options.length
        if (event.key === 'Home') nextIndex = 0
        if (event.key === 'End') nextIndex = options.length - 1
        if (nextIndex !== undefined) { event.preventDefault(); options[nextIndex]?.focus() }
      })
    })
  })
}

function v3ListingBody(listingId: string | undefined) {
  if (!listingId) return null
  return fields.actionView.querySelector<HTMLElement>(`[data-listing-row="${CSS.escape(listingId)}"] .v3-listing-application-body`)
}

function animateV3ListingExpansion(listingId: string | undefined) {
  const body = v3ListingBody(listingId)
  if (!body || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  body.classList.add('is-animating')
  const animation = body.animate([
    { height: '0px', opacity: 0 },
    { height: `${body.scrollHeight}px`, opacity: 1 },
  ], { duration: 240, easing: 'cubic-bezier(.2, .8, .2, 1)' })
  const cleanup = () => body.classList.remove('is-animating')
  animation.addEventListener('finish', cleanup, { once: true })
  animation.addEventListener('cancel', cleanup, { once: true })
}

function animateV3ListingCollapse(listingId: string | undefined, complete: () => void) {
  const body = v3ListingBody(listingId)
  if (!body || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { complete(); return }
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-expand]').forEach((button) => { button.disabled = true })
  body.classList.add('is-animating')
  let completed = false
  const finish = () => {
    if (completed) return
    completed = true
    complete()
  }
  const animation = body.animate([
    { height: `${body.scrollHeight}px`, opacity: 1 },
    { height: '0px', opacity: 0 },
  ], { duration: 190, easing: 'cubic-bezier(.4, 0, 1, 1)' })
  animation.addEventListener('finish', finish, { once: true })
  animation.addEventListener('cancel', finish, { once: true })
}

type V3AgentMaterialKind = 'endpoint' | 'api_bridge'
type V3AgentMaterialImportResult = {
  files?: V3APIMaterial[]
  canceled?: boolean
}

const v3AgentMaterialRevisions: Record<V3AgentMaterialKind, number> = { endpoint: 0, api_bridge: 0 }
let v3ResourceFileSelectionPending = false

function setV3AgentMaterialImporting(kind: V3AgentMaterialKind, importing: boolean) {
  if (kind === 'endpoint') state.v3EndpointMaterialsImporting = importing
  else state.v3APIMaterialsImporting = importing
}

function updateV3AgentMaterialPickerState(kind: V3AgentMaterialKind) {
  const action = kind === 'endpoint' ? 'endpoint-materials-add' : 'api-materials-add'
  const picker = fields.actionView.querySelector<HTMLButtonElement>(`[data-v3-action="${action}"]`)
  if (!picker) return
  picker.disabled = true
  picker.classList.remove('is-dragging')
  const title = picker.querySelector<HTMLElement>('strong')
  const status = picker.querySelector<HTMLElement>('em')
  if (title) title.textContent = 'Adding files…'
  if (status) status.textContent = 'Processing…'
}

function applyV3AgentMaterialImport(kind: V3AgentMaterialKind, result: V3AgentMaterialImportResult) {
  if (result.canceled) return
  v3AgentMaterialRevisions[kind] += 1
  if (kind === 'endpoint') {
    state.v3EndpointMaterials = result.files || []
    invalidateV3AgentMaterials('endpoint')
    return
  }
  state.v3APIMaterials = result.files || []
  invalidateV3AgentMaterials('api_bridge')
}

async function importV3AgentMaterials(kind: V3AgentMaterialKind, filePaths?: string[]) {
  const importing = kind === 'endpoint' ? state.v3EndpointMaterialsImporting : state.v3APIMaterialsImporting
  if (importing) return
  const draftId = kind === 'endpoint' ? state.v3EndpointDraftId : state.v3APIDraftId
  localStorage.setItem(kind === 'endpoint' ? 'exora.endpointDraftId' : 'exora.apiBridgeDraftId', draftId)
  setV3AgentMaterialImporting(kind, true)
  updateV3AgentMaterialPickerState(kind)
  try {
    const command = filePaths ? 'provider_api_bridge_materials_add' : 'provider_api_bridge_materials_choose'
    const result = await invoke<V3AgentMaterialImportResult>(command, { input: { draftId, ...(filePaths ? { filePaths } : {}) } })
    applyV3AgentMaterialImport(kind, result)
  } catch (error) {
    showToast(humanizeError(error))
  } finally {
    setV3AgentMaterialImporting(kind, false)
    renderDecisionPanel()
  }
}

async function removeV3AgentMaterial(kind: V3AgentMaterialKind, button: HTMLButtonElement) {
  const draftId = kind === 'endpoint' ? state.v3EndpointDraftId : state.v3APIDraftId
  const id = kind === 'endpoint' ? button.dataset.v3EndpointMaterialRemove : button.dataset.v3ApiMaterialRemove
  if (!id) {
    showToast(humanizeError(new Error('The selected material no longer has a valid id.')))
    return
  }
  if (kind === 'endpoint') v3AgentMaterialRevisions.endpoint += 1
  else v3AgentMaterialRevisions.api_bridge += 1
  await runControlAction(button, async () => {
    const before = kind === 'endpoint' ? state.v3EndpointMaterials : state.v3APIMaterials
    const result = await invoke<{ files?: V3APIMaterial[]; removed?: boolean; cleanupPending?: boolean }>('provider_api_bridge_material_remove', { input: { draftId, id } })
    const currentDraftId = kind === 'endpoint' ? state.v3EndpointDraftId : state.v3APIDraftId
    if (currentDraftId !== draftId) return
    const files = result.files || []
    const changed = v3MaterialFingerprint(before) !== v3MaterialFingerprint(files)
    if (kind === 'endpoint') state.v3EndpointMaterials = files
    else state.v3APIMaterials = files
    if (changed) invalidateV3AgentMaterials(kind)
    renderDecisionPanel()
  })
}

async function refreshV3ServiceAgentSessions() {
  if (state.v3ServiceAgentSessionsLoading) return
  state.v3ServiceAgentSessionsLoading = true
  try {
    const result = await invoke<{ sessions?: AgentSessionStatus[] }>('agent_session_status')
    state.agentSessions = result.sessions || []
    state.v3ServiceAgentSessionsLoaded = true
  } catch {
    state.agentSessions = []
    state.v3ServiceAgentSessionsLoaded = true
  } finally {
    state.v3ServiceAgentSessionsLoading = false
    renderDecisionPanel()
  }
}

async function saveV3ServiceMaterialNote(kind: V3AgentMaterialKind, form: HTMLFormElement) {
  const endpoint = kind === 'endpoint'
  const data = new FormData(form)
  const text = String(data.get(endpoint ? 'endpointMaterialNote' : 'apiMaterialNote') || '').trim()
  if (!text) throw new Error('Enter a service description or request/response example first.')
  const draftId = endpoint ? state.v3EndpointDraftId : state.v3APIDraftId
  const result = await invoke<V3AgentMaterialImportResult>('provider_service_material_note_save', { input: { draftId, text } })
  if (endpoint) state.v3EndpointMaterialNote = text
  else state.v3APIMaterialNote = text
  applyV3AgentMaterialImport(kind, result)
  renderDecisionPanel()
}

function recordV3AgentDraftFailure(kind: V3AgentMaterialKind, error: unknown) {
  const failure = humanizeError(error)
  if (kind === 'endpoint') {
    state.v3EndpointFailedRunId ||= `agent_failed_${crypto.randomUUID().replace(/-/g, '')}`
    state.v3EndpointFallbackReason ||= failure
  } else {
    state.v3APIFailedRunId ||= `agent_failed_${crypto.randomUUID().replace(/-/g, '')}`
    state.v3APIFallbackReason ||= failure
  }
}

async function saveV3ManualServiceFallback(kind: V3AgentMaterialKind, form: HTMLFormElement) {
  const endpoint = kind === 'endpoint'
  const prefix = endpoint ? 'endpoint' : 'api'
  const data = new FormData(form)
  const title = String(data.get(`${prefix}FallbackTitle`) || '').trim()
  const description = String(data.get(`${prefix}FallbackDescription`) || '').trim()
  const reason = String(data.get(`${prefix}FallbackReason`) || '').trim()
  const rawManifest = String(data.get(`${prefix}FallbackManifest`) || '').trim()
  const failedRunId = endpoint ? state.v3EndpointFailedRunId : state.v3APIFailedRunId
  if (!failedRunId || !title || !reason || !rawManifest) throw new Error('Title, failure reason, and a complete ServiceManifest JSON are required.')
  let serviceManifest: V3ServiceManifest
  try { serviceManifest = JSON.parse(rawManifest) as V3ServiceManifest } catch { throw new Error('ServiceManifest must be valid JSON.') }
  const materials = endpoint ? state.v3EndpointMaterials : state.v3APIMaterials
  const sourceSha256 = await serviceReviewSHA256(materials.map(({ name, sizeBytes, sha256 }) => ({ name, sizeBytes, sha256: sha256 || '' })))
  const draftId = endpoint ? state.v3EndpointDraftId : state.v3APIDraftId
  const expectedVersion = endpoint ? state.v3EndpointDraft?.version || 0 : state.v3APIDraftVersion
  const result = await invoke<{ draft: V3APIBridgeDraft }>('provider_service_draft_save', { input: {
    draftId,
    expectedVersion,
    applicationSource: kind,
    title,
    description,
    serviceManifest,
    normalization: { mode: 'manual_fallback', failedRunId, fallbackReason: reason, sourceSha256, actor: 'human' },
    unresolvedFields: [],
  } })
  if (endpoint) {
    applyV3EndpointDraft(result.draft)
    state.v3EndpointFailedRunId = ''
    state.v3EndpointFallbackReason = ''
    state.v3EndpointFallbackManifest = ''
    state.v3EndpointDraftMaterialFingerprint = recordV3AgentMaterialReceipt('endpoint', draftId, result.draft.version, materials)
    state.v3EndpointRequiredDraftVersion = result.draft.version
  } else {
    applyV3APIBridgeDraft(result.draft)
    state.v3APIFailedRunId = ''
    state.v3APIFallbackReason = ''
    state.v3APIFallbackManifest = ''
    state.v3APIDraftMaterialFingerprint = recordV3AgentMaterialReceipt('api_bridge', draftId, result.draft.version, materials)
    state.v3APIRequiredDraftVersion = result.draft.version
  }
  renderDecisionPanel()
}

async function chooseV3ResourceFiles(filePaths?: string[]) {
  if (v3ResourceFileSelectionPending) return
  v3ResourceFileSelectionPending = true
  if (filePaths) {
    state.v3AssetProgress = { phase: 'packaging', percent: 0 }
    renderDecisionPanel()
  }
  try {
    const response = await invoke<{ canceled?: boolean; files?: Array<Pick<V3ResourceSource, 'token' | 'name' | 'sizeBytes' | 'sha256'>> }>(
      'provider_asset_choose_files',
      filePaths ? { input: { filePaths } } : undefined,
    )
    if (!response.canceled && response.files?.length) {
      clearV3ApplicationAttempt('resources')
      const additions = response.files.map((file) => ({ ...file, title: file.name, description: state.v3ResourceDescription, price: 0, tags: [], license: state.v3ResourceLicense, grantHours: state.v3ResourceGrantHours, status: 'ready' as const }))
      const existing = new Set(state.v3ResourceSources.map((file) => file.token))
      state.v3ResourceSources = [...state.v3ResourceSources, ...additions.filter((file) => !existing.has(file.token))]
    }
  } finally {
    v3ResourceFileSelectionPending = false
    state.v3AssetProgress = undefined
    renderDecisionPanel()
  }
}

function startV3ResourceFileSelection(filePaths?: string[]) {
  void chooseV3ResourceFiles(filePaths).catch((error) => showToast(humanizeError(error)))
}

function attachV3AgentMaterialDropHandlers() {
  if (fields.actionView.dataset.v3FileDropHandlers === 'ready') return
  fields.actionView.dataset.v3FileDropHandlers = 'ready'

  const acceptsFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files')
  const activeDropzone = () => fields.actionView.querySelector<HTMLButtonElement>('[data-v3-file-drop]:not(:disabled)')
  const resetDragState = () => {
    fields.actionView.classList.remove('is-file-dragging')
    fields.actionView.querySelectorAll('.is-dragging').forEach((element) => element.classList.remove('is-dragging'))
  }
  const showDragState = (dropzone: HTMLButtonElement) => {
    const action = dropzone.dataset.v3FileDrop
    const title = fields.actionView.querySelector<HTMLElement>('[data-v3-file-drop-title]')
    const detail = fields.actionView.querySelector<HTMLElement>('[data-v3-file-drop-detail]')
    if (title) title.textContent = action === 'choose-files' ? 'Release to package these files' : 'Release to add these files'
    if (detail) detail.textContent = action === 'choose-files'
      ? 'Dock will validate them and create one immutable ZIP.'
      : 'Supported documents stay local while they are being prepared.'
    fields.actionView.classList.add('is-file-dragging')
    dropzone.classList.add('is-dragging')
  }

  fields.actionView.addEventListener('dragenter', (event) => {
    const dropzone = activeDropzone()
    if (!dropzone || !acceptsFiles(event)) return
    event.preventDefault()
    showDragState(dropzone)
  })
  fields.actionView.addEventListener('dragover', (event) => {
    const dropzone = activeDropzone()
    if (!dropzone || !acceptsFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    showDragState(dropzone)
  })
  fields.actionView.addEventListener('dragleave', (event) => {
    if (event.relatedTarget instanceof Node && fields.actionView.contains(event.relatedTarget)) return
    resetDragState()
  })
  fields.actionView.addEventListener('drop', (event) => {
    const dropzone = activeDropzone()
    resetDragState()
    if (!dropzone || !acceptsFiles(event)) return
    event.preventDefault()
    const resolver = window.exora?.getPathForFile
    if (!resolver) {
      showToast(humanizeError(new Error('Drag-and-drop requires the Electron desktop bridge.')))
      return
    }
    const filePaths = Array.from(event.dataTransfer?.files || []).map((file) => {
      try { return resolver(file) } catch { return '' }
    }).filter(Boolean)
    if (!filePaths.length) {
      showToast(humanizeError(new Error('No local files were found in the drop.')))
      return
    }
    const action = dropzone.dataset.v3FileDrop
    if (action === 'choose-files') {
      startV3ResourceFileSelection(filePaths)
      return
    }
    const kind: V3AgentMaterialKind = action === 'endpoint-materials-add' ? 'endpoint' : 'api_bridge'
    void importV3AgentMaterials(kind, filePaths)
  })
  window.addEventListener('dragend', resetDragState)
  window.addEventListener('blur', resetDragState)
}

function attachV3SurfaceHandlers() {
  updateV3DiskSpeedFact()
  attachV3ResourceSelectHandlers()
  attachV3AgentMaterialDropHandlers()
  fields.actionView.querySelectorAll<HTMLSelectElement>('select[name="authType"]').forEach((select) => {
    const choices: Array<[V3UpstreamAuthType, string]> = [['header_api_key', 'Header API key'], ['query_api_key', 'Query API key'], ['cookie_api_key', 'Cookie API key'], ['oauth2_client_credentials', 'OAuth2 client credentials'], ['mtls', 'mTLS client certificate']]
    for (const [value, label] of choices) {
      if (!select.querySelector(`option[value="${value}"]`)) select.add(new Option(label, value))
    }
    const endpointForm = Boolean(select.closest('[data-v3-form="endpoint-agent"]'))
    const selected = endpointForm ? state.v3EndpointAuthType : state.v3APIAuthType
    select.value = selected
    if (selected.endsWith('_api_key') && !select.parentElement?.parentElement?.querySelector('input[name="apiKeyHeader"]')) {
      const label = document.createElement('label')
      label.textContent = selected === 'header_api_key' ? 'API key header' : selected === 'query_api_key' ? 'API key query parameter' : 'API key cookie name'
      const input = document.createElement('input')
      input.name = 'apiKeyHeader'
      input.value = endpointForm ? state.v3EndpointAPIKeyHeader : state.v3APIKeyHeader
      label.append(input)
      select.parentElement?.parentElement?.append(label)
    }
  })
  fields.actionView.querySelectorAll<HTMLDetailsElement>('[data-v3-agent-prompt]').forEach((details) => details.addEventListener('toggle', () => {
    const promptKind = details.dataset.v3AgentPrompt
    if (promptKind) localStorage.setItem(`exora.agentPrompt.${promptKind}.expanded`, String(details.open))
  }))
  if (state.v3SellerTab === 'vm' && navigator.userAgent.includes('Windows') && !state.v3EnvironmentImagesLoaded) void loadV3WindowsEnvironments()
  if (state.v3SellerTab === 'vm' && !navigator.userAgent.includes('Windows')) void loadV3LinuxPricingSettings()
  fields.actionView.querySelector<HTMLFormElement>('[data-v3-catalog-search]')?.addEventListener('submit', (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; state.v3CatalogQuery = String(new FormData(form).get('query') || ''); void loadV3Catalog() })
  fields.actionView.querySelectorAll<HTMLElement>('.v3-product-card[data-v3-product]').forEach((card) => {
    const open = () => { state.v3SelectedProduct = state.v3Products.find((item) => item.productId === card.dataset.v3Product); renderDecisionPanel() }
    card.addEventListener('click', open)
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } })
  })
  const action = (name: string, handler: () => void) => fields.actionView.querySelector<HTMLButtonElement>(`[data-v3-action="${name}"]`)?.addEventListener('click', handler)
  if ((state.v3SellerTab === 'endpoint' || state.v3SellerTab === 'api_bridge') && !state.v3ServiceAgentSessionsLoaded && !state.v3ServiceAgentSessionsLoading) void refreshV3ServiceAgentSessions()
  action('service-agent-refresh', () => void refreshV3ServiceAgentSessions())
  action('endpoint-agent-unavailable', () => { recordV3AgentDraftFailure('endpoint', new Error('No active local Agent session has seller.draft permission.')); renderDecisionPanel() })
  action('api-agent-unavailable', () => { recordV3AgentDraftFailure('api_bridge', new Error('No active local Agent session has seller.draft permission.')); renderDecisionPanel() })
  action('activity-back', closeV3ActivityDetail)
  action('activity-refresh', () => {
    const sessionId = state.selectedV3ActivitySessionId
    if (sessionId) void loadV3ActivityDetail(sessionId)
  })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-copy-v3-identifier]').forEach((button) => button.addEventListener('click', () => {
    const value = button.dataset.copyV3Identifier || ''
    if (value) void navigator.clipboard.writeText(value).then(() => showToast(t('toast.identifierCopied')))
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-api-order-action]').forEach((button) => button.addEventListener('click', () => {
    void updateAPIOrder(button.dataset.v3ApiOrderAction as 'deactivate' | 'request-reactivation')
  }))
  fields.actionView.querySelectorAll<HTMLFormElement>('[data-v3-approval-form]').forEach((form) => form.addEventListener('submit', (event) => {
    event.preventDefault()
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null
    const decision = submitter?.value === 'reject' ? 'reject' : 'approve'
    const pin = String(new FormData(form).get('pin') || '').trim()
    void decideV3Approval(form.dataset.v3ApprovalForm || '', decision, pin).catch((error) => showToast(humanizeError(error)))
  }))
  action('catalog-back', () => { state.v3SelectedProduct = undefined; renderDecisionPanel() })
  action('catalog-refresh', () => void loadV3Catalog())
  action('listings-refresh', () => {
    state.v3CatalogLoaded = false
    state.v3ListingsLoaded = false
    void Promise.all([loadV3Catalog(), loadV3Listings()])
  })
  const endpointForm = fields.actionView.querySelector<HTMLFormElement>('[data-v3-form="endpoint-agent"]')
  if (endpointForm && !state.v3EndpointMaterialsLoaded) {
    state.v3EndpointMaterialsLoaded = true
    const draftId = state.v3EndpointDraftId
    const materialRevision = v3AgentMaterialRevisions.endpoint
    const materialsRequest = invoke<{ files: V3APIMaterial[] }>('provider_api_bridge_materials_get', { input: { draftId } }).catch(() => ({ files: [] }))
    const savedDraftRequest = invoke<{ draft: V3APIBridgeDraft }>('provider_service_draft_get', { input: { draftId } }).catch(() => undefined)
    void materialsRequest.then((materials) => {
      if (state.v3EndpointDraftId !== draftId || v3AgentMaterialRevisions.endpoint !== materialRevision) return
      state.v3EndpointMaterials = materials.files || []
      renderDecisionPanel()
    })
    void savedDraftRequest.then((savedDraft) => {
      if (state.v3EndpointDraftId !== draftId) return
      if (savedDraft?.draft) {
        applyV3EndpointDraft(savedDraft.draft)
        state.v3EndpointDraftMaterialFingerprint = restoreV3AgentMaterialReceipt('endpoint', state.v3EndpointDraftId, savedDraft.draft.version, state.v3EndpointMaterials)
        state.v3EndpointRequiredDraftVersion = state.v3EndpointDraftMaterialFingerprint ? savedDraft.draft.version : savedDraft.draft.version + 1
      }
      renderDecisionPanel()
    })
  }
  const syncEndpointForm = () => {
    if (!endpointForm) return
    const data = new FormData(endpointForm)
    state.v3EndpointLocalURL = String(data.get('localBaseUrl') || '').trim()
    state.v3EndpointHealthPath = String(data.get('healthPath') || state.v3EndpointHealthPath).trim() || '/health'
    syncV3RuntimeAuthFromForm('endpoint', data)
    state.v3EndpointTimeout = Math.max(1, Math.min(300, Number(data.get('timeoutSeconds') || 120)))
    state.v3EndpointConcurrency = Math.max(1, Math.min(64, Number(data.get('concurrency') || 1)))
    state.v3EndpointRouteTestPath = String(data.get('routeTestPath') || state.v3EndpointRouteTestPath).trim()
    state.v3EndpointRouteTestQuery = String(data.get('routeTestQuery') || '').trim()
    state.v3EndpointRouteTestContentType = String(data.get('routeTestContentType') || 'application/json').trim()
    state.v3EndpointRouteTestBody = String(data.get('routeTestBody') || '')
    state.v3EndpointRouteTestDangerConfirmed = data.get('routeTestDanger') === 'on'
  }
  const endpointCredentialSecret = () => v3RuntimeCredential('endpoint')
  action('endpoint-material-note-save', () => { if (endpointForm) void run(() => saveV3ServiceMaterialNote('endpoint', endpointForm)) })
  action('endpoint-materials-add', () => void importV3AgentMaterials('endpoint'))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-endpoint-material-remove]').forEach((button) => button.addEventListener('click', () => void removeV3AgentMaterial('endpoint', button)))
  action('endpoint-prompt-copy', () => void navigator.clipboard.writeText(endpointAgentPrompt()).then(() => showToast(t('toast.agentPromptCopied'))))
  action('endpoint-prompt-refresh', () => { renderDecisionPanel() })
  action('endpoint-draft-check', () => void run(async () => {
    if (!state.v3EndpointMaterials.length) throw new Error('Add at least one supported document before checking the Agent draft.')
    try {
    const materialRevisionChanged = !v3AgentMaterialsCurrent('endpoint')
    const result = await invoke<{ draft: V3APIBridgeDraft }>('provider_service_draft_get', { input: { draftId: state.v3EndpointDraftId } })
    if (result.draft.version < state.v3EndpointRequiredDraftVersion) throw new Error(`The Agent draft is stale. Save version ${state.v3EndpointRequiredDraftVersion} or newer for the current materials.`)
    applyV3EndpointDraft(result.draft)
    if (materialRevisionChanged) {
      state.v3EndpointReviewStatus = Object.fromEntries(endpointReviewIDs().map((id) => [id, 'pending']))
      state.v3EndpointConfirmed = []
      persistEndpointReview()
    }
    state.v3EndpointDraftMaterialFingerprint = recordV3AgentMaterialReceipt('endpoint', state.v3EndpointDraftId, result.draft.version, state.v3EndpointMaterials)
    state.v3EndpointRequiredDraftVersion = result.draft.version
    renderDecisionPanel()
    } catch (error) {
      recordV3AgentDraftFailure('endpoint', error)
      renderDecisionPanel()
      throw error
    }
  }))
  action('endpoint-fallback-save', () => void run(async () => { if (endpointForm) await saveV3ManualServiceFallback('endpoint', endpointForm) }))
  const markEndpointReviewModified = (id: string) => {
    if (!id) return
    state.v3EndpointReviewStatus[id] = 'modified'
    state.v3EndpointConfirmed = state.v3EndpointConfirmed.filter((item) => item !== id)
    state.v3EndpointDraftDirty = true
    state.v3EndpointProbe = undefined
    state.v3EndpointRouteTestResult = undefined
    persistEndpointReview()
  }
  endpointForm?.querySelectorAll<HTMLElement>('.v3-api-review-filters span').forEach((filter, index) => {
    const value = (['all', 'pending', 'warnings'] as const)[index]
    filter.setAttribute('role', 'button'); filter.tabIndex = 0; filter.classList.toggle('selected', state.v3EndpointReviewFilter === value)
    const select = () => { state.v3EndpointReviewFilter = value; const ids = endpointReviewIDs(); const next = value === 'pending' ? ids.findIndex((id) => state.v3EndpointReviewStatus[id] !== 'confirmed') : value === 'warnings' ? ids.findIndex((id) => endpointUnresolvedForReview(id).length > 0) : state.v3EndpointReviewIndex; if (next >= 0) state.v3EndpointReviewIndex = next; renderDecisionPanel() }
    filter.addEventListener('click', select); filter.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select() } })
  })
  endpointForm?.querySelectorAll<HTMLButtonElement>('[data-v3-endpoint-review-index]').forEach((button) => button.addEventListener('click', () => { const previous = state.v3EndpointReviewIndex; state.v3EndpointReviewIndex = Number(button.dataset.v3EndpointReviewIndex || 0); if (previous !== state.v3EndpointReviewIndex) { state.v3EndpointRouteTestPath = ''; state.v3EndpointRouteTestDangerConfirmed = false; state.v3EndpointRouteTestResult = undefined } renderDecisionPanel() }))
  endpointForm?.querySelector<HTMLButtonElement>('[data-v3-endpoint-review-previous]')?.addEventListener('click', () => { state.v3EndpointReviewIndex = Math.max(0, state.v3EndpointReviewIndex - 1); state.v3EndpointRouteTestPath = ''; state.v3EndpointRouteTestDangerConfirmed = false; renderDecisionPanel() })
  endpointForm?.querySelector<HTMLButtonElement>('[data-v3-endpoint-review-next]')?.addEventListener('click', () => { state.v3EndpointReviewIndex = Math.min(endpointReviewIDs().length - 1, state.v3EndpointReviewIndex + 1); state.v3EndpointRouteTestPath = ''; state.v3EndpointRouteTestDangerConfirmed = false; renderDecisionPanel() })
  endpointForm?.querySelector<HTMLButtonElement>('[data-v3-endpoint-review-confirm]')?.addEventListener('click', (event) => { const id = (event.currentTarget as HTMLButtonElement).dataset.v3EndpointReviewConfirm || ''; if (id && endpointUnresolvedForReview(id).length === 0 && v3ServiceReviewIssues('endpoint', id).length === 0) { state.v3EndpointReviewStatus[id] = 'confirmed'; state.v3EndpointConfirmed = [...new Set([...state.v3EndpointConfirmed, id])]; persistEndpointReview(); state.v3EndpointReviewIndex = Math.min(endpointReviewIDs().length - 1, state.v3EndpointReviewIndex + 1) } renderDecisionPanel() })
  endpointForm?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-v3-endpoint-draft]').forEach((input) => input.addEventListener('input', () => { const draft = state.v3EndpointDraft; if (!draft) return; const field = input.dataset.v3EndpointDraft as 'title' | 'description'; draft[field] = input.value; resolveEndpointBoundField('service', field); markEndpointReviewModified('service') }))
  endpointForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-v3-endpoint-draft]').forEach((input) => input.addEventListener('change', () => renderDecisionPanel()))
  endpointUnresolvedForReview(state.v3EndpointReviewIndex === 0 ? 'service' : `operation:${state.v3EndpointDraft?.operationReviews[state.v3EndpointReviewIndex - 1]?.operationId}`).filter((path) => !endpointPathField(path)).forEach((path) => { const warning = endpointForm?.querySelector<HTMLElement>('.v3-api-review-warning'); const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost v3-api-explicit-resolution'; button.textContent = `Mark handled: ${path}`; button.addEventListener('click', () => { if (state.v3EndpointDraft) state.v3EndpointDraft.unresolvedFields = (state.v3EndpointDraft.unresolvedFields || []).filter((item) => item !== path); const id = state.v3EndpointReviewIndex === 0 ? 'service' : `operation:${state.v3EndpointDraft?.operationReviews[state.v3EndpointReviewIndex - 1]?.operationId}`; markEndpointReviewModified(id); renderDecisionPanel() }); warning?.append(button) })
  action('endpoint-draft-save', () => void run(async () => { const previous = new Map(endpointReviewIDs().map((id) => [endpointReviewFingerprint(id), state.v3EndpointReviewStatus[id]])); const result = await invoke<{ draft: V3APIBridgeDraft }>('provider_service_draft_save', { input: currentV3EndpointDraft() }); applyV3EndpointDraft(result.draft); state.v3EndpointDraftMaterialFingerprint = recordV3AgentMaterialReceipt('endpoint', state.v3EndpointDraftId, result.draft.version, state.v3EndpointMaterials); state.v3EndpointRequiredDraftVersion = result.draft.version; endpointReviewIDs().forEach((id) => { const status = previous.get(endpointReviewFingerprint(id)); if (status) state.v3EndpointReviewStatus[id] = status }); state.v3EndpointConfirmed = endpointReviewIDs().filter((id) => state.v3EndpointReviewStatus[id] === 'confirmed'); persistEndpointReview(); renderDecisionPanel() }))
  endpointForm?.querySelectorAll<HTMLInputElement>('[data-v3-endpoint-attest]').forEach((input) => input.addEventListener('change', () => { if (input.dataset.v3EndpointAttest === 'pricing') state.v3EndpointAttestPricing = input.checked; if (input.dataset.v3EndpointAttest === 'runtime') state.v3EndpointAttestRuntime = input.checked; if (input.dataset.v3EndpointAttest === 'rights') state.v3EndpointAttestRights = input.checked; syncEndpointForm(); renderDecisionPanel() }))
  endpointForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[name="localBaseUrl"], input[name="healthPath"], select[name="authType"], input[name="secret"], input[name="apiKeyHeader"], input[name="basicUsername"], input[name^="oauth"], textarea[name^="mtls"], input[name="mtlsServerName"], input[name="timeoutSeconds"], input[name="concurrency"]').forEach((input) => {
    input.addEventListener('input', () => { syncEndpointForm(); state.v3EndpointProbe = undefined; state.v3EndpointRouteTestResult = undefined; clearV3ApplicationAttempt('endpoint') })
    input.addEventListener('change', () => { syncEndpointForm(); state.v3EndpointProbe = undefined; state.v3EndpointRouteTestResult = undefined; clearV3ApplicationAttempt('endpoint'); renderDecisionPanel() })
  })
  endpointForm?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[name^="routeTest"], textarea[name="routeTestBody"]').forEach((input) => input.addEventListener('change', () => { syncEndpointForm(); state.v3EndpointRouteTestResult = undefined; renderDecisionPanel() }))
  action('endpoint-route-test', () => void run(async () => { syncEndpointForm(); const draft = state.v3EndpointDraft; const publicOperation = draft?.operationReviews[state.v3EndpointReviewIndex - 1] || draft?.operationReviews[0]; if (!draft || !publicOperation) throw new Error('Select a reviewed operation first.'); const operations = endpointRuntimeOperations(draft); const operation = operations.find((item) => item.operationId === publicOperation.operationId) || operations[0]; if (publicOperation.sideEffect && ['POST','PUT','PATCH','DELETE'].includes(operation.method) && !state.v3EndpointRouteTestDangerConfirmed) throw new Error(`Confirm that the ${operation.method} smoke test may change local state.`); const endpointId = `epd_${state.v3EndpointDraftId.replace(/^apid_/, '')}`; const result = await invoke<{ result: typeof state.v3EndpointRouteTestResult }>('provider_endpoint_test_route', { input: { endpointId, localBaseUrl: state.v3EndpointLocalURL, healthPath: state.v3EndpointHealthPath, serviceManifest: draft.serviceManifest, timeoutSeconds: state.v3EndpointTimeout, concurrency: state.v3EndpointConcurrency, route: operation, testPath: state.v3EndpointRouteTestPath || operation.path, rawQuery: state.v3EndpointRouteTestQuery, contentType: state.v3EndpointRouteTestContentType, body: state.v3EndpointRouteTestBody, authType: state.v3EndpointAuthType, apiKeyHeader: state.v3EndpointAPIKeyHeader, secret: endpointCredentialSecret() } }); state.v3EndpointRouteTestResult = result.result; renderDecisionPanel() }))
  action('endpoint-probe', () => void run(async () => {
    if (state.v3EndpointProbing) return
    syncEndpointForm()
    const draft = state.v3EndpointDraft
    if (!v3AgentMaterialsCurrent('endpoint') || !draft) throw new Error('Load and review a fresh Endpoint Agent draft first.')
    state.v3EndpointProbing = true
    state.v3EndpointProbe = undefined
    renderDecisionPanel()
    try {
      const endpointId = `epd_${state.v3EndpointDraftId.replace(/^apid_/, '')}`
      const result = await invoke<{ status: { healthy: boolean; status?: number; latencyMs?: number; contentType?: string; checkedAt?: string; error?: string; contractSha256?: string } }>('provider_endpoint_probe', { input: { endpointId, localBaseUrl: state.v3EndpointLocalURL, healthPath: state.v3EndpointHealthPath, serviceManifest: draft.serviceManifest, authType: state.v3EndpointAuthType, apiKeyHeader: state.v3EndpointAPIKeyHeader, secret: endpointCredentialSecret(), timeoutSeconds: state.v3EndpointTimeout, concurrency: state.v3EndpointConcurrency } })
      state.v3EndpointProbe = { ok: result.status.healthy, status: result.status.status, latencyMs: result.status.latencyMs, contentType: result.status.contentType, checkedAt: result.status.checkedAt || new Date().toISOString(), error: result.status.error }
    } finally {
      state.v3EndpointProbing = false
      renderDecisionPanel()
    }
  }))
  endpointForm?.addEventListener('submit', (event) => {
    event.preventDefault()
    if (state.v3EndpointSubmitting) return
    void run(async () => {
      syncEndpointForm()
      const draft = state.v3EndpointDraft
      if (!v3AgentMaterialsCurrent('endpoint') || !draft || state.v3EndpointDraftDirty || !state.v3EndpointProbe?.ok) throw new Error('Load and review a fresh Endpoint Agent draft, then pass local health.')
      if ((draft.unresolvedFields || []).length || endpointReviewIDs().some((id) => state.v3EndpointReviewStatus[id] !== 'confirmed')) throw new Error('Resolve and confirm every Agent draft item before submitting to Listings.')
      if (endpointReviewIDs().some((id) => v3ServiceReviewIssues('endpoint', id).length)) throw new Error('Complete every ServiceManifest policy and pricing requirement before submitting to Listings.')
      if (!v3CredentialReady('endpoint')) throw new Error('Complete every field required by the selected provider authentication method.')
      if (!state.v3EndpointAttestPricing || !state.v3EndpointAttestRuntime || !state.v3EndpointAttestRights) throw new Error('Accept all three seller confirmations before submitting to Listings.')
      state.v3EndpointSubmitting = true
      renderDecisionPanel()
      try {
        const endpointId = `epd_${state.v3EndpointDraftId.replace(/^apid_/, '')}`
        const reviewReceipt = await serviceDraftReviewReceipt(draft)
        const attemptFingerprint = JSON.stringify({ draftId: draft.draftId, draftVersion: draft.version, reviewReceipt, localBaseUrl: state.v3EndpointLocalURL, healthPath: state.v3EndpointHealthPath, authType: state.v3EndpointAuthType, apiKeyHeader: state.v3EndpointAPIKeyHeader, timeoutSeconds: state.v3EndpointTimeout, concurrency: state.v3EndpointConcurrency })
        state.v3EndpointSaveAttemptKey = v3StableApplicationAttempt('endpoint', attemptFingerprint)
        let credentialRef = ''
        if (state.v3EndpointAuthType !== 'none') {
          const savedCredential = await invoke<{ credential: SellerAutomationCredential }>('seller_automation_credential_save', { input: { label: `Endpoint ${draft.title || endpointId}`, authType: state.v3EndpointAuthType, apiKeyHeader: state.v3EndpointAPIKeyHeader, serviceIds: [], secret: endpointCredentialSecret() } })
          credentialRef = savedCredential.credential.credentialRef
        }
        await invoke('provider_endpoint_local_save', { input: { endpointId, localBaseUrl: state.v3EndpointLocalURL, healthPath: state.v3EndpointHealthPath, serviceManifest: draft.serviceManifest, authType: state.v3EndpointAuthType, credentialRef, lastProbeHealthy: true, lastProbeAt: state.v3EndpointProbe.checkedAt, timeoutSeconds: state.v3EndpointTimeout, concurrency: state.v3EndpointConcurrency } })
        const imported = await invoke<{ product: V3Product; listing: V3Listing }>('provider_service_draft_submit', { input: { idempotencyKey: state.v3EndpointSaveAttemptKey, draftId: draft.draftId, expectedVersion: draft.version, endpointId, healthPath: state.v3EndpointHealthPath, reviewReceipt, credentialConfigured: state.v3EndpointAuthType === 'none' || Boolean(credentialRef), connectivityPassed: true, sellerAttestationConfirmed: true } })
        state.v3HighlightedListingId = imported.listing.listingId
        state.v3ExpandedListingId = imported.listing.listingId
        state.v3SellerTab = 'listings'
        state.v3ListingsLoaded = false
        await loadV3Listings()
        state.v3EndpointSubmitting = false
        clearV3ApplicationAttempt('endpoint')
      } catch (error) {
        state.v3EndpointSubmitting = false
        renderDecisionPanel()
        throw error
      }
    })
  })
  const apiForm = fields.actionView.querySelector<HTMLFormElement>('[data-v3-form="api_bridge"]')
  action('api-material-note-save', () => { if (apiForm) void run(() => saveV3ServiceMaterialNote('api_bridge', apiForm)) })
  const markAPIReviewModified = (id: string) => {
    state.v3APIReviewStatus[id] = 'modified'
    state.v3APIDraftDirty = true
    clearV3ApplicationAttempt('api_bridge')
    persistAPIBridgeReview()
    const selected = apiForm?.querySelector<HTMLElement>('.v3-api-review-item.selected')
    selected?.classList.remove('confirmed', 'pending')
    selected?.classList.add('modified')
    const selectedIcon = selected?.querySelector<HTMLElement>(':scope > span')
    const selectedStatus = selected?.querySelector<HTMLElement>('em')
    if (selectedIcon) selectedIcon.textContent = '!'
    if (selectedStatus) selectedStatus.textContent = 'Modified · confirm again'
    const headerStatus = apiForm?.querySelector<HTMLElement>('.v3-api-review-workspace > main > header > span')
    if (headerStatus) { headerStatus.className = 'modified'; headerStatus.textContent = 'Modified' }
    const confirm = apiForm?.querySelector<HTMLButtonElement>('[data-v3-review-confirm]')
    if (confirm) confirm.disabled = apiBridgeUnresolvedForReview(id).length > 0 || v3ServiceReviewIssues('api_bridge', id).length > 0
    const save = apiForm?.querySelector<HTMLButtonElement>('button[type="submit"]')
    if (save) save.disabled = true
  }
  const invalidateProbe = () => {
    state.v3APIProbe = undefined
    clearV3ApplicationAttempt('api_bridge')
    const card = apiForm?.querySelector<HTMLElement>('.v3-api-probe')
    if (!card) return
    card.classList.remove('passed', 'failed')
    card.classList.add('idle')
    const icon = card.querySelector<HTMLElement>(':scope > span')
    const title = card.querySelector<HTMLElement>('strong')
    const detail = card.querySelector<HTMLElement>('small')
    if (icon) icon.textContent = '→'
    if (title) title.textContent = 'Connectivity not checked'
    if (detail) detail.textContent = 'Connection settings changed. Run the Health Path check again.'
  }
  const activeReviewID = state.v3APIReviewIndex === 0 ? 'service' : state.v3APIOperations[state.v3APIReviewIndex - 1] ? `operation:${state.v3APIOperations[state.v3APIReviewIndex - 1].operationId}` : ''
  const serviceOperation = (mode: 'endpoint' | 'api_bridge', operationId: string) => mode === 'endpoint' ? state.v3EndpointDraft?.operationReviews.find((operation) => operation.operationId === operationId) : state.v3APIOperations.find((operation) => operation.operationId === operationId)
  const serviceDraft = (mode: 'endpoint' | 'api_bridge') => mode === 'endpoint' ? state.v3EndpointDraft : state.v3APIDraft
  const markServiceItem = (mode: 'endpoint' | 'api_bridge', operationId: string, field?: string, componentIndex?: number) => {
    const reviewID = operationId === 'default' ? 'service' : `operation:${operationId}`
    if (mode === 'endpoint') {
      if (field) resolveEndpointBoundField(reviewID, field, componentIndex)
      markEndpointReviewModified(reviewID)
    } else {
      if (field) resolveAPIBridgeBoundField(reviewID, field, componentIndex)
      markAPIReviewModified(reviewID)
    }
  }
  const parseServiceTarget = (encoded?: string) => {
    const [rawMode, operationId = '', third = '0', fourth = ''] = String(encoded || '').split('|')
    const numericIndex = /^\d+$/.test(third)
    return { mode: rawMode as 'endpoint' | 'api_bridge', operationId, index: numericIndex ? Number(third) : 0, field: numericIndex ? fourth : third }
  }
  const markDefaultPricingChanged = (mode: 'endpoint' | 'api_bridge') => {
    const draft = serviceDraft(mode)
    if (!draft) return
    markServiceItem(mode, 'default')
    for (const operation of mode === 'endpoint' ? draft.operationReviews : state.v3APIOperations) {
      if (operation.pricingMode !== 'default') continue
      operation.pricing = structuredClone(draft.serviceManifest.pricingTemplate.defaults)
      operation.maxChargePerInvocationAtomic = draft.serviceManifest.pricingTemplate.defaultMaxChargePerInvocationAtomic || 0
      markServiceItem(mode, operation.operationId)
    }
  }
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-service-operation-title]').forEach((input) => input.addEventListener('input', () => {
    const { mode, operationId } = parseServiceTarget(input.dataset.v3ServiceOperationTitle)
    const operation = serviceOperation(mode, operationId)
    if (!operation) return
    operation.title = input.value
    operation.displayName = input.value
    markServiceItem(mode, operationId, 'displayName')
  }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-service-policy]').forEach((input) => input.addEventListener('change', () => {
    const { mode, operationId, field } = parseServiceTarget(input.dataset.v3ServicePolicy)
    const operation = serviceOperation(mode, operationId)
    if (!operation || !['sideEffect', 'idempotent'].includes(field)) return
    ;(operation as any)[field] = input.checked
    markServiceItem(mode, operationId, field)
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-service-limit]').forEach((input) => input.addEventListener('input', () => {
    const { mode, operationId, field } = parseServiceTarget(input.dataset.v3ServiceLimit)
    const operation = serviceOperation(mode, operationId)
    if (!operation || !['timeoutSeconds', 'maxRequestBytes', 'maxResponseBytes', 'maxConcurrency'].includes(field)) return
    ;(operation.limits as any)[field] = Math.max(1, Math.round(Number(input.value || 1)))
    markServiceItem(mode, operationId, field)
  }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-service-meter]').forEach((input) => input.addEventListener('change', () => {
    const { mode, operationId, field: meter } = parseServiceTarget(input.dataset.v3ServiceMeter)
    const operation = serviceOperation(mode, operationId)
    if (!operation || !v3ServiceMeterLabels[meter]) return
    operation.meteringCapabilities = input.checked ? [...new Set([...operation.meteringCapabilities, meter])].sort() : operation.meteringCapabilities.filter((value) => value !== meter)
    markServiceItem(mode, operationId, 'meteringCapabilities')
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLSelectElement>('[data-v3-service-pricing-mode]').forEach((input) => input.addEventListener('change', () => {
    const { mode, operationId } = parseServiceTarget(input.dataset.v3ServicePricingMode)
    const operation = serviceOperation(mode, operationId)
    const draft = serviceDraft(mode)
    if (!operation || !draft) return
    operation.pricingMode = input.value === 'override' ? 'override' : 'default'
    if (operation.pricingMode === 'default') {
      operation.pricing = structuredClone(draft.serviceManifest.pricingTemplate.defaults)
      operation.maxChargePerInvocationAtomic = draft.serviceManifest.pricingTemplate.defaultMaxChargePerInvocationAtomic || 0
    }
    markServiceItem(mode, operationId, 'pricingTemplate')
    markServiceItem(mode, 'default')
    renderDecisionPanel()
  }))
  const servicePriceComponent = (encoded?: string) => {
    const target = parseServiceTarget(encoded)
    const draft = serviceDraft(target.mode)
    const operation = target.operationId === 'default' ? undefined : serviceOperation(target.mode, target.operationId)
    const components = operation ? operation.pricing : draft?.serviceManifest.pricingTemplate.defaults
    return { ...target, draft, operation, components, component: components?.[target.index] }
  }
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-service-price-add]').forEach((button) => button.addEventListener('click', () => {
    const target = parseServiceTarget(button.dataset.v3ServicePriceAdd)
    const draft = serviceDraft(target.mode)
    const operation = target.operationId === 'default' ? undefined : serviceOperation(target.mode, target.operationId)
    const components = operation ? operation.pricing : draft?.serviceManifest.pricingTemplate.defaults
    if (!components) return
    components.push({ dimension: 'request', rateAtomic: 0, per: 1, meterSource: 'gateway', chargeOn: 'started' })
    operation ? markServiceItem(target.mode, target.operationId, 'dimension', components.length - 1) : markDefaultPricingChanged(target.mode)
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-service-price-remove]').forEach((button) => button.addEventListener('click', () => {
    const target = servicePriceComponent(button.dataset.v3ServicePriceRemove)
    if (!target.components) return
    target.components.splice(target.index, 1)
    target.operation ? markServiceItem(target.mode, target.operationId, 'dimension', target.index) : markDefaultPricingChanged(target.mode)
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLSelectElement>('[data-v3-service-price-dimension], [data-v3-service-price-source], [data-v3-service-price-charge]').forEach((input) => input.addEventListener('change', () => {
    const encoded = input.dataset.v3ServicePriceDimension || input.dataset.v3ServicePriceSource || input.dataset.v3ServicePriceCharge
    const target = servicePriceComponent(encoded)
    if (!target.component) return
    const field = input.dataset.v3ServicePriceDimension ? 'dimension' : input.dataset.v3ServicePriceSource ? 'meterSource' : 'chargeOn'
    ;(target.component as any)[field] = input.value
    if (field === 'dimension') target.component.meterSource = input.value === 'provider_reported' ? 'provider_response' : 'gateway'
    target.operation ? markServiceItem(target.mode, target.operationId, field, target.index) : markDefaultPricingChanged(target.mode)
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-service-price-usdc], [data-v3-service-price-per], [data-v3-service-price-selector]').forEach((input) => input.addEventListener('input', () => {
    const encoded = input.dataset.v3ServicePriceUsdc || input.dataset.v3ServicePricePer || input.dataset.v3ServicePriceSelector
    const target = servicePriceComponent(encoded)
    if (!target.component) return
    const field = input.dataset.v3ServicePriceUsdc ? 'rateAtomic' : input.dataset.v3ServicePricePer ? 'per' : 'selector'
    ;(target.component as any)[field] = field === 'rateAtomic' ? Math.max(0, Math.round(Number(input.value || 0) * 1_000_000)) : field === 'per' ? Math.max(1, Math.round(Number(input.value || 1))) : input.value.trim()
    target.operation ? markServiceItem(target.mode, target.operationId, field, target.index) : markDefaultPricingChanged(target.mode)
  }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-service-price-cap]').forEach((input) => input.addEventListener('input', () => {
    const target = parseServiceTarget(input.dataset.v3ServicePriceCap)
    const atomic = Math.max(0, Math.round(Number(input.value || 0) * 1_000_000))
    const draft = serviceDraft(target.mode)
    const operation = target.operationId === 'default' ? undefined : serviceOperation(target.mode, target.operationId)
    if (operation) { operation.maxChargePerInvocationAtomic = atomic; markServiceItem(target.mode, target.operationId, 'maxChargePerInvocationAtomic') }
    else if (draft) { draft.serviceManifest.pricingTemplate.defaultMaxChargePerInvocationAtomic = atomic; markDefaultPricingChanged(target.mode) }
  }))
  const unresolvedWarning = apiForm?.querySelector<HTMLElement>('.v3-api-review-warning')
  apiBridgeUnresolvedForReview(activeReviewID).filter((path) => !apiBridgePathField(path)).forEach((path) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ghost v3-api-explicit-resolution'
    button.textContent = `Mark handled: ${path}`
    button.addEventListener('click', () => { state.v3APIUnresolvedFields = state.v3APIUnresolvedFields.filter((candidate) => candidate !== path); markAPIReviewModified(activeReviewID); rerenderV3APIKeepingSecret(apiForm) })
    unresolvedWarning?.append(button)
  })
  if (apiForm && state.v3APIDraftVersion === 0) {
    apiForm.querySelector<HTMLButtonElement>('[data-v3-action="api-route-add"]')?.setAttribute('disabled', '')
  }
  apiForm?.querySelectorAll<HTMLElement>('.v3-api-review-filters span').forEach((filter, index) => {
    const value = (['all', 'pending', 'warnings'] as const)[index]
    filter.setAttribute('role', 'button')
    filter.tabIndex = 0
    filter.classList.toggle('selected', state.v3APIReviewFilter === value)
    const select = () => {
      state.v3APIReviewFilter = value
      const nextIndex = value === 'pending'
        ? ['service', ...state.v3APIOperations.map((route) => `operation:${route.operationId}`)].findIndex((id) => state.v3APIReviewStatus[id] !== 'confirmed')
        : value === 'warnings'
          ? ['service', ...state.v3APIOperations.map((route) => `operation:${route.operationId}`)].findIndex((id) => apiBridgeUnresolvedForReview(id).length > 0)
          : state.v3APIReviewIndex
      if (nextIndex >= 0) state.v3APIReviewIndex = nextIndex
      rerenderV3APIKeepingSecret(apiForm)
    }
    filter.addEventListener('click', select)
    filter.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select() } })
  })
  const apiReviewComplete = state.v3APIDraftVersion > 0 && state.v3APIReviewStatus.service === 'confirmed' && state.v3APIOperations.every((route) => state.v3APIReviewStatus[`operation:${route.operationId}`] === 'confirmed')
  if (!apiReviewComplete) apiForm?.querySelectorAll<HTMLInputElement>('[data-v3-attestation]').forEach((input) => { input.disabled = true })
  if (apiForm && !state.v3APIMaterialsLoaded) {
    state.v3APIMaterialsLoaded = true
    const draftId = state.v3APIDraftId
    const materialRevision = v3AgentMaterialRevisions.api_bridge
    const materialsRequest = invoke<{ files: V3APIMaterial[] }>('provider_api_bridge_materials_get', { input: { draftId } }).catch(() => ({ files: [] }))
    const draftRequest = invoke<{ draft: V3APIBridgeDraft }>('provider_service_draft_get', { input: { draftId } }).catch(() => undefined)
    void materialsRequest.then((materialsResult) => {
      if (state.v3APIDraftId !== draftId || v3AgentMaterialRevisions.api_bridge !== materialRevision) return
      state.v3APIMaterials = materialsResult.files || []
      renderDecisionPanel()
    })
    void draftRequest.then((draftResult) => {
      if (state.v3APIDraftId !== draftId) return
      if (draftResult?.draft) {
        applyV3APIBridgeDraft(draftResult.draft)
        state.v3APIDraftMaterialFingerprint = restoreV3AgentMaterialReceipt('api_bridge', state.v3APIDraftId, draftResult.draft.version, state.v3APIMaterials)
        state.v3APIRequiredDraftVersion = state.v3APIDraftMaterialFingerprint ? draftResult.draft.version : draftResult.draft.version + 1
      }
      renderDecisionPanel()
    })
  }
  action('api-materials-add', () => void importV3AgentMaterials('api_bridge'))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-api-material-remove]').forEach((button) => button.addEventListener('click', () => void removeV3AgentMaterial('api_bridge', button)))
  action('api-prompt-copy', () => void navigator.clipboard.writeText(apiBridgeAgentPrompt()).then(() => showToast(t('toast.agentPromptCopied'))))
  action('api-prompt-regenerate', () => { renderDecisionPanel() })
  action('api-draft-check', () => void run(async () => {
    if (!state.v3APIMaterials.length) throw new Error('Add at least one supported document before checking the Agent draft.')
    try {
    const materialRevisionChanged = !v3AgentMaterialsCurrent('api_bridge')
    const result = await invoke<{ draft: V3APIBridgeDraft }>('provider_service_draft_get', { input: { draftId: state.v3APIDraftId } })
    if (result.draft.version < state.v3APIRequiredDraftVersion) throw new Error(`The Agent draft is stale. Save version ${state.v3APIRequiredDraftVersion} or newer for the current materials.`)
    applyV3APIBridgeDraft(result.draft)
    if (materialRevisionChanged) {
      state.v3APIReviewStatus = Object.fromEntries(['service', ...state.v3APIOperations.map((route) => `operation:${route.operationId}`)].map((id) => [id, 'pending']))
      persistAPIBridgeReview()
    }
    state.v3APIDraftMaterialFingerprint = recordV3AgentMaterialReceipt('api_bridge', state.v3APIDraftId, result.draft.version, state.v3APIMaterials)
    state.v3APIRequiredDraftVersion = result.draft.version
    state.v3APIStep = 2
    renderDecisionPanel()
    } catch (error) {
      recordV3AgentDraftFailure('api_bridge', error)
      renderDecisionPanel()
      throw error
    }
  }))
  action('api-fallback-save', () => void run(async () => { if (apiForm) await saveV3ManualServiceFallback('api_bridge', apiForm) }))
  action('api-draft-save', () => void run(async () => {
    syncV3APIDraftFromForm(apiForm)
    const previousReview = new Map(Object.keys(state.v3APIReviewStatus).map((id) => [apiBridgeReviewFingerprint(id), state.v3APIReviewStatus[id]]))
    const result = await invoke<{ draft: V3APIBridgeDraft }>('provider_service_draft_save', { input: currentV3APIBridgeDraft() })
    applyV3APIBridgeDraft(result.draft)
    state.v3APIDraftMaterialFingerprint = recordV3AgentMaterialReceipt('api_bridge', state.v3APIDraftId, result.draft.version, state.v3APIMaterials)
    state.v3APIRequiredDraftVersion = result.draft.version
    for (const id of ['service', ...state.v3APIOperations.map((route) => `operation:${route.operationId}`)]) {
      const previous = previousReview.get(apiBridgeReviewFingerprint(id))
      if (previous) state.v3APIReviewStatus[id] = previous
    }
    persistAPIBridgeReview()
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-review-index]').forEach((button) => button.addEventListener('click', () => { state.v3APIReviewIndex = Number(button.dataset.v3ReviewIndex || 0); rerenderV3APIKeepingSecret(apiForm) }))
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-review-previous]')?.addEventListener('click', () => { state.v3APIReviewIndex = Math.max(0, state.v3APIReviewIndex - 1); rerenderV3APIKeepingSecret(apiForm) })
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-review-next]')?.addEventListener('click', () => { state.v3APIReviewIndex = Math.min(state.v3APIOperations.length, state.v3APIReviewIndex + 1); rerenderV3APIKeepingSecret(apiForm) })
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-review-confirm]')?.addEventListener('click', (event) => { const id = (event.currentTarget as HTMLButtonElement).dataset.v3ReviewConfirm || ''; if (id && apiBridgeUnresolvedForReview(id).length === 0 && v3ServiceReviewIssues('api_bridge', id).length === 0) { state.v3APIReviewStatus[id] = 'confirmed'; persistAPIBridgeReview(); state.v3APIReviewIndex = Math.min(state.v3APIOperations.length, state.v3APIReviewIndex + 1) }; rerenderV3APIKeepingSecret(apiForm) })
  apiForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-v3-api-draft]').forEach((input) => input.addEventListener('input', () => {
    syncV3APIDraftFromForm(apiForm)
    resolveAPIBridgeBoundField('service', input.getAttribute('data-v3-api-draft') || '')
    markAPIReviewModified('service')
  }))
  apiForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-v3-api-draft]').forEach((input) => input.addEventListener('change', () => rerenderV3APIKeepingSecret(apiForm)))
  const apiAuth = apiForm?.querySelector<HTMLSelectElement>('select[name="authType"]')
  apiAuth?.addEventListener('change', () => { syncV3APIDraftFromForm(apiForm); invalidateProbe(); rerenderV3APIKeepingSecret(apiForm) })
  apiForm?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[name="baseUrl"], input[name="healthPath"], input[name="secret"], input[name="apiKeyHeader"], input[name="basicUsername"], input[name^="oauth"], textarea[name^="mtls"], input[name="mtlsServerName"]').forEach((input) => {
    input.addEventListener('input', () => { syncV3APIDraftFromForm(apiForm); invalidateProbe() })
    input.addEventListener('change', () => { syncV3APIDraftFromForm(apiForm); rerenderV3APIKeepingSecret(apiForm) })
  })
  apiForm?.querySelectorAll<HTMLInputElement>('[data-v3-attestation]').forEach((input) => input.addEventListener('change', () => { if (input.dataset.v3Attestation === 'pricing') state.v3APIAttestPricing = input.checked; if (input.dataset.v3Attestation === 'usage') state.v3APIAttestUsage = input.checked; if (input.dataset.v3Attestation === 'rights') state.v3APIAttestRights = input.checked; state.v3APISellerAttestation = state.v3APIAttestPricing && state.v3APIAttestUsage && state.v3APIAttestRights; rerenderV3APIKeepingSecret(apiForm) }))
  action('api-probe', () => void run(async () => {
    syncV3APIDraftFromForm(apiForm)
    if (!state.v3APIBaseURL) throw new Error('Enter the public HTTPS Base URL first.')
    if (!v3CredentialReady('api_bridge')) throw new Error('Complete every field required by the selected Provider authentication method.')
    state.v3APIProbe = undefined
    state.v3APIProbing = true
    rerenderV3APIKeepingSecret(apiForm)
    try {
      state.v3APIProbe = await invoke<V3APIProbe>('provider_api_probe', { input: { baseUrl: state.v3APIBaseURL, healthPath: state.v3APIHealthPath, authType: state.v3APIAuthType, apiKeyHeader: state.v3APIKeyHeader, secret: v3RuntimeCredential('api_bridge') } })
      state.v3APIProbe.checkedAt = new Date().toISOString()
      if (!state.v3APIProbe.ok) state.v3APIProbe.error = `${state.v3APIProbe.error || 'Connection check failed'} · HTTP ${state.v3APIProbe.status || 0} · ${state.v3APIProbe.latencyMs || 0} ms · ${state.v3APIProbe.contentType || 'unknown content type'} · ${new Date(state.v3APIProbe.checkedAt).toLocaleString()}`
    } catch (error) {
      state.v3APIProbe = { ok: false, error: `${humanizeError(error)} · checked ${new Date().toLocaleString()}`, checkedAt: new Date().toISOString() }
      throw error
    } finally {
      state.v3APIProbing = false
      renderDecisionPanel()
    }
  }))
  action('environment-cloud-open', () => { state.v3EnvironmentCloudOpen = true; renderDecisionPanel() })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-action="environment-cloud-close"]').forEach((button) => button.addEventListener('click', () => { state.v3EnvironmentCloudOpen = false; renderDecisionPanel() }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-environment-filter]').forEach((button) => button.addEventListener('click', () => { state.v3EnvironmentCloudFilter = (button.dataset.v3EnvironmentFilter || 'all') as 'all' | 'ubuntu' | 'cuda'; renderDecisionPanel() }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-action="environment-root-choose"]').forEach((button) => button.addEventListener('click', () => void run(async () => {
    const storage = await invoke<{ rootPath: string; workspaceGiB: number; freeBytes: number }>('provider_environment_choose_root', { input: { workspaceGiB: state.v3EnvironmentWorkspaceGiB } })
    state.v3EnvironmentRoot = storage.rootPath || ''
    state.v3EnvironmentWorkspaceGiB = Math.max(20, Number(storage.workspaceGiB || 100))
    state.v3EnvironmentRootFreeBytes = Number(storage.freeBytes || 0)
    state.v3VMTemplate = undefined
    renderDecisionPanel()
  })))
  const environmentWorkspace = fields.actionView.querySelector<HTMLInputElement>('[data-environment-workspace]')
  environmentWorkspace?.addEventListener('input', () => {
    state.v3EnvironmentWorkspaceGiB = Number(environmentWorkspace.value)
    const hidden = fields.actionView.querySelector<HTMLInputElement>('[data-v3-form="vm"] input[name="workspaceGiB"]')
    if (hidden) hidden.value = environmentWorkspace.value
  })
  environmentWorkspace?.addEventListener('change', () => {
    const minimum = Number(environmentWorkspace.min || 20)
    const maximum = Number(environmentWorkspace.max || 2000)
    const normalized = Math.min(maximum, Math.max(minimum, Math.round(Number(environmentWorkspace.value || minimum))))
    environmentWorkspace.value = String(normalized)
    state.v3EnvironmentWorkspaceGiB = normalized
    state.v3VMTemplate = undefined
    const hidden = fields.actionView.querySelector<HTMLInputElement>('[data-v3-form="vm"] input[name="workspaceGiB"]')
    if (hidden) hidden.value = String(normalized)
    void invoke('provider_environment_update_storage', { input: { rootPath: state.v3EnvironmentRoot, workspaceGiB: normalized } }).finally(() => renderDecisionPanel())
  })
  action('base-fee-toggle', () => {
    const toggle = fields.actionView.querySelector<HTMLButtonElement>('[data-v3-action="base-fee-toggle"]')
    const card = toggle?.closest<HTMLElement>('.v3-inline-base-fee')
    const input = card?.querySelector<HTMLInputElement>('[data-v3-pricing="baseFee"]')
    if (!toggle || !card || !input) return
    const previousEnabled = state.v3BaseFeeEnabled
    const applyToggleState = () => {
      toggle.setAttribute('aria-checked', String(state.v3BaseFeeEnabled))
      const label = toggle.querySelector('em')
      if (label) label.textContent = state.v3BaseFeeEnabled ? 'On' : 'Off'
      card.classList.toggle('enabled', state.v3BaseFeeEnabled)
      card.classList.toggle('disabled', !state.v3BaseFeeEnabled)
      input.disabled = !state.v3BaseFeeEnabled
    }
    state.v3BaseFeeEnabled = !state.v3BaseFeeEnabled
    applyToggleState()
    void invoke('provider_environment_update_storage', { input: { rootPath: state.v3EnvironmentRoot, workspaceGiB: state.v3EnvironmentWorkspaceGiB, pricing: v3EnvironmentPricingSettings() } }).then(() => renderDecisionPanel()).catch((error) => {
      state.v3BaseFeeEnabled = previousEnabled
      applyToggleState()
      showToast(humanizeError(error))
    })
  })
  action('discount-toggle', () => {
    const toggle = fields.actionView.querySelector<HTMLButtonElement>('[data-v3-action="discount-toggle"]')
    const discount = toggle?.closest<HTMLElement>('.v3-inline-discount')
    const inputs = discount?.querySelectorAll<HTMLInputElement>('[data-v3-pricing]')
    if (!toggle || !discount || !inputs) return
    const previousEnabled = state.v3LongDiscountEnabled
    const previousPercent = state.v3LongDiscountPercent
    const applyToggleState = () => {
      toggle.setAttribute('aria-checked', String(state.v3LongDiscountEnabled))
      const label = toggle.querySelector('em')
      if (label) label.textContent = state.v3LongDiscountEnabled ? 'On' : 'Off'
      discount.classList.toggle('enabled', state.v3LongDiscountEnabled)
      discount.classList.toggle('disabled', !state.v3LongDiscountEnabled)
      inputs.forEach((input) => { input.disabled = !state.v3LongDiscountEnabled })
      const percent = discount.querySelector<HTMLInputElement>('[data-v3-pricing="longDiscountPercent"]')
      if (percent) percent.value = state.v3LongDiscountPercent > 0 ? String(state.v3LongDiscountPercent) : ''
    }
    state.v3LongDiscountEnabled = !state.v3LongDiscountEnabled
    if (state.v3LongDiscountEnabled && state.v3LongDiscountPercent <= 0) state.v3LongDiscountPercent = 5
    applyToggleState()
    void invoke('provider_environment_update_storage', { input: { rootPath: state.v3EnvironmentRoot, workspaceGiB: state.v3EnvironmentWorkspaceGiB, pricing: v3EnvironmentPricingSettings() } }).then(() => renderDecisionPanel()).catch((error) => {
      state.v3LongDiscountEnabled = previousEnabled
      state.v3LongDiscountPercent = previousPercent
      applyToggleState()
      showToast(humanizeError(error))
    })
  })
  action('sustained-performance-toggle', () => {
    const previous = state.v3AllowSustainedCompute
    state.v3AllowSustainedCompute = !previous
    void invoke('provider_environment_update_storage', { input: { rootPath: state.v3EnvironmentRoot, workspaceGiB: state.v3EnvironmentWorkspaceGiB, pricing: v3EnvironmentPricingSettings() } }).then(() => renderDecisionPanel()).catch((error) => {
      state.v3AllowSustainedCompute = previous
      renderDecisionPanel()
      showToast(humanizeError(error))
    })
  })
  const pricingInputs = fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-pricing]')
  pricingInputs.forEach((input) => input.addEventListener('input', () => {
    const value = Math.max(0, Number(input.value || 0))
    if (input.dataset.v3Pricing === 'baseFee') state.v3BaseFee = value
    if (input.dataset.v3Pricing === 'pricePerMinute') state.v3PricePerMinute = value
    if (input.dataset.v3Pricing === 'minimumMinutes') state.v3MinimumMinutes = Math.max(1, Math.round(value))
    if (input.dataset.v3Pricing === 'maximumMinutes') state.v3MaximumMinutes = Math.max(1, Math.min(10080, Math.round(value)))
    if (input.dataset.v3Pricing === 'longDiscountAfterMinutes') state.v3LongDiscountAfterMinutes = Math.max(1, Math.round(value))
    if (input.dataset.v3Pricing === 'longDiscountPercent') state.v3LongDiscountPercent = Math.min(90, value)
    if (input.dataset.v3Pricing === 'longDiscountMinimumPricePercent') state.v3LongDiscountMinimumPricePercent = Math.max(1, Math.min(100, value))
    const hiddenPrice = fields.actionView.querySelector<HTMLInputElement>('[data-v3-form="vm"] input[name="price"]')
    if (hiddenPrice) hiddenPrice.value = String(state.v3PricePerMinute)
  }))
  pricingInputs.forEach((input) => input.addEventListener('change', () => void run(async () => {
    if (!(state.v3PricePerMinute > 0)) throw new Error('Minute price must be greater than zero.')
    if (!(state.v3MinimumMinutes >= 1)) throw new Error('Minimum minutes must be at least one.')
    if (state.v3MaximumMinutes < state.v3MinimumMinutes || state.v3MaximumMinutes > 10080) throw new Error('Maximum minutes must be between the minimum and 10,080.')
    if (state.v3LongDiscountEnabled && state.v3LongDiscountAfterMinutes > state.v3MaximumMinutes) throw new Error('The discount interval cannot exceed the maximum rental time.')
    if (state.v3LongDiscountEnabled && state.v3LongDiscountPercent <= 0) throw new Error('The tiered discount must add at least 1% at each interval.')
    if (state.v3LongDiscountEnabled && !(state.v3LongDiscountMinimumPricePercent >= 1 && state.v3LongDiscountMinimumPricePercent <= 100)) throw new Error('The tiered discount price floor must be between 1% and 100% of the normal minute price.')
    await invoke('provider_environment_update_storage', { input: { rootPath: state.v3EnvironmentRoot, workspaceGiB: state.v3EnvironmentWorkspaceGiB, pricing: v3EnvironmentPricingSettings() } })
    renderDecisionPanel()
  })))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-image-cloud-unavailable]').forEach((button) => button.addEventListener('click', () => { state.v3SellerError = 'Link this Dock to Exora Cloud to download the signed Ubuntu and CUDA artifacts.'; state.v3EnvironmentCloudOpen = false; renderDecisionPanel() }))
  action('vm-probe', () => {
    if (navigator.userAgent.includes('Windows')) {
      void runV3WindowsHostScan()
      return
    }
    void run(async () => {
      const probe = await invoke<{ result: Record<string, unknown> }>('provider_vm_probe')
      state.v3VMProbe = probe.result
      const domains = await invoke<{ result: { domains?: Array<Record<string, unknown>> } }>('provider_vm_domains')
      state.v3VMDomains = domains.result.domains || []
      renderDecisionPanel()
    })
  })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-image-pick]').forEach((button) => button.addEventListener('click', () => {
    state.v3SelectedEnvironmentImageId = button.dataset.v3ImagePick
    state.v3VMTemplate = undefined
    const image = state.v3EnvironmentImages.find((item) => item.imageId === button.dataset.v3ImagePick)
    const installed = v3ReadyInstalledEnvironment(image)
    if (installed) state.v3VMTemplate = { ...installed.attestation.report, imageId: installed.attestation.imageId, imageVersion: installed.attestation.imageVersion, environmentId: installed.environmentId, valid: true, runtimeBackend: 'wsl2' }
    state.v3EnvironmentCloudOpen = false
    renderDecisionPanel()
  }))
  action('environment-save', () => void run(async () => {
    const image = state.v3EnvironmentImages.find((item) => item.imageId === state.v3SelectedEnvironmentImageId)
    if (!image) throw new Error('Choose an environment configuration first.')
    const readyInstalled = v3ReadyInstalledEnvironment(image)
    if (!readyInstalled && image.cloudAvailable === false) throw new Error('This environment is a preview and is not currently available to download.')
    if (!state.v3EnvironmentRoot) throw new Error('Choose a virtual environment root first.')
    const imageSizeBytes = Number(image.manifest?.artifact?.sizeBytes || 0)
    const maximumWorkspaceGiB = Math.floor((state.v3EnvironmentRootFreeBytes - 10 * 1024 ** 3 - imageSizeBytes) / 1024 ** 3)
    if (maximumWorkspaceGiB < 20) throw new Error('Insufficient disk capacity. Exora must keep 10 GiB free for the system and reserve space for the selected environment image.')
    if (state.v3EnvironmentWorkspaceGiB > maximumWorkspaceGiB) throw new Error(`Virtual disk allocation cannot exceed ${maximumWorkspaceGiB} GiB after the 10 GiB system reserve and environment image are deducted.`)
    const environmentId = `${image.imageId}-${image.version}`.replace(/[^a-zA-Z0-9._-]/g, '-')
    state.v3EnvironmentSaving = true
    state.v3ImageProgress = { imageId: image.imageId, phase: 'reserving' }
    renderDecisionPanel()
    let createdReservation = false
    try {
      await invoke('provider_environment_update_storage', { input: { rootPath: state.v3EnvironmentRoot, workspaceGiB: state.v3EnvironmentWorkspaceGiB } })
      const hold = await invoke<{ reservation?: { created?: boolean } }>('provider_environment_reserve', { input: { environmentId, imageId: image.imageId, imageVersion: image.version, workspaceGiB: state.v3EnvironmentWorkspaceGiB } })
      createdReservation = Boolean(hold.reservation?.created)
      const installed = v3ReadyInstalledEnvironment(image)
      if (installed) {
        state.v3VMTemplate = { ...installed.attestation.report, imageId: installed.attestation.imageId, imageVersion: installed.attestation.imageVersion, environmentId: installed.environmentId, valid: true, runtimeBackend: 'wsl2' }
      } else {
        const result = await invoke<Record<string, any>>('provider_environment_download', { input: { imageId: image.imageId, version: image.version } })
        state.v3VMTemplate = { ...result, valid: result.status === 'ready', runtimeBackend: 'wsl2' }
      }
      state.v3EnvironmentImagesLoaded = false
      await loadV3WindowsEnvironments()
    } catch (error) {
      if (createdReservation) await invoke('provider_environment_release', { input: { environmentId } }).catch(() => undefined)
      throw error
    } finally {
      state.v3EnvironmentSaving = false
      state.v3ImageProgress = undefined
      renderDecisionPanel()
    }
  }))
  fields.actionView.querySelectorAll<HTMLElement>('[data-v3-image-select]').forEach((card) => {
    const select = () => {
      state.v3SelectedEnvironmentImageId = card.dataset.v3ImageSelect
      state.v3VMTemplate = undefined
      const image = state.v3EnvironmentImages.find((item) => item.imageId === card.dataset.v3ImageSelect)
      const installed = v3ReadyInstalledEnvironment(image)
      if (installed) state.v3VMTemplate = { ...installed.attestation.report, imageId: installed.attestation.imageId, imageVersion: installed.attestation.imageVersion, environmentId: installed.environmentId, valid: true, runtimeBackend: 'wsl2' }
      state.v3EnvironmentCloudOpen = false
      renderDecisionPanel()
    }
    card.addEventListener('click', (event) => { if (!(event.target as HTMLElement).closest('button')) select() })
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select() } })
  })
  const workspace = fields.actionView.querySelector<HTMLInputElement>('input[name="workspaceGiB"]')
  workspace?.addEventListener('input', () => { const output = fields.actionView.querySelector<HTMLOutputElement>('[data-workspace-output]'); if (output) output.value = `${workspace.value} GiB` })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-image-download]').forEach((button) => button.addEventListener('click', () => void run(async () => { const imageId = button.dataset.v3ImageDownload || ''; const version = button.dataset.imageVersion || ''; state.v3SelectedEnvironmentImageId = imageId; state.v3ImageProgress = { imageId, phase: 'starting' }; renderDecisionPanel(); const result = await invoke<Record<string, any>>('provider_environment_download', { input: { imageId, version } }); state.v3VMTemplate = { ...result, valid: result.status === 'ready', runtimeBackend: 'wsl2' }; state.v3ImageProgress = undefined; state.v3EnvironmentImagesLoaded = false; await loadV3WindowsEnvironments() })))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-image-cancel]').forEach((button) => button.addEventListener('click', () => void invoke('provider_environment_cancel', { input: { imageId: button.dataset.v3ImageCancel } })))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-image-delete]').forEach((button) => button.addEventListener('click', () => void run(async () => { await invoke('provider_environment_delete', { input: { environmentId: button.dataset.v3ImageDelete } }); state.v3EnvironmentImagesLoaded = false; await loadV3WindowsEnvironments() })))
  action('vm-import', () => void run(async () => { const domain = fields.actionView.querySelector<HTMLInputElement>('input[name="domain"]:checked')?.value; if (!domain) throw new Error('Choose an eligible powered-off libvirt domain.'); const response = await invoke<{ result: Record<string, unknown> }>('provider_vm_import', { input: { domain, templateId: `template-${Date.now()}` } }); state.v3VMTemplate = response.result; renderDecisionPanel() }))
  action('vm-validate', () => void run(async () => { if (!state.v3VMTemplate) throw new Error('Import a Golden Image first.'); const workspaceGiB = Number(fields.actionView.querySelector<HTMLInputElement>('input[name="workspaceGiB"]')?.value || 100); const response = await invoke<{ result: Record<string, unknown> }>('provider_vm_validate', { input: { templateId: state.v3VMTemplate.templateId, workspaceGiB } }); state.v3VMTemplate = { ...state.v3VMTemplate, ...response.result }; renderDecisionPanel() }))
  const resourceForm = fields.actionView.querySelector<HTMLFormElement>('[data-v3-form="resources"]')
  const syncResourceForm = () => {
    if (!resourceForm) return
    const data = new FormData(resourceForm)
    state.v3ResourceTitle = String(data.get('title') || '').trim()
    state.v3ResourceDescription = String(data.get('description') || '').trim()
    state.v3ResourceCategory = String(data.get('category') || state.v3ResourceCategory)
    state.v3ResourceGrantHours = Math.max(1, Math.min(720, Number(data.get('grantHours') || state.v3ResourceGrantHours)))
    state.v3ResourceSources = state.v3ResourceSources.map((file) => ({
      ...file,
      title: file.name,
      description: state.v3ResourceDescription,
      price: Math.max(0, Number(data.get(`itemPrice:${file.token}`) || 0)),
      tags: String(data.get(`itemTags:${file.token}`) || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
      grantHours: state.v3ResourceGrantHours,
      license: state.v3ResourceLicense,
    }))
  }
  resourceForm?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((input) => {
    input.addEventListener('input', syncResourceForm)
    input.addEventListener('change', () => { syncResourceForm(); renderDecisionPanel() })
  })
  action('choose-files', () => startV3ResourceFileSelection())
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-resource-remove]').forEach((button) => button.addEventListener('click', () => {
    state.v3ResourceSources = state.v3ResourceSources.filter((file) => file.token !== button.dataset.v3ResourceRemove)
    renderDecisionPanel()
  }))
  fields.actionView.querySelector<HTMLFormElement>('[data-v3-form="vm"]')?.addEventListener('submit', (event) => {
    if (state.v3VMListingConstraint.available) return
    event.preventDefault()
    event.stopImmediatePropagation()
    showToast(sx(`This device already has VM Listing ${state.v3VMListingConstraint.listingId || ''}. Delete it before creating another.`, `此设备已有 VM 挂单 ${state.v3VMListingConstraint.listingId || ''}，请先删除后再创建。`))
  }, { capture: true })
  action('resource-clear-files', () => void run(async () => {
    await invoke('provider_asset_clear_selection')
    state.v3ResourceArchive = undefined
    state.v3ResourceSources = []
    state.v3AssetProgress = undefined
    clearV3ApplicationAttempt('resources')
    renderDecisionPanel()
  }))
  fields.actionView.querySelector<HTMLFormElement>('[data-v3-form="vm"]')?.addEventListener('submit', (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; void run(async () => { if (!state.v3VMTemplate || !state.v3VMTemplate.valid) throw new Error('Install and validate the selected environment first.'); if (!(state.v3PricePerMinute > 0) || state.v3MinimumMinutes < 1 || state.v3MaximumMinutes < state.v3MinimumMinutes || state.v3MaximumMinutes > 10080) throw new Error('Configure a valid minute price and rental range.'); if (state.v3LongDiscountEnabled && state.v3LongDiscountAfterMinutes > state.v3MaximumMinutes) throw new Error('The discount interval cannot exceed the maximum rental time.'); const data = Object.fromEntries(new FormData(form)); const windows = navigator.userAgent.includes('Windows'); if (windows) { const rescanned = await invoke<{ result: Record<string, unknown> }>('provider_host_scan', { input: { reason: 'pre_publish' } }); state.v3VMProbe = rescanned.result; renderDecisionPanel() } const price = v3ComputePriceFromState(); const hold = windows ? await invoke<Record<string, any>>('provider_environment_reserve', { input: { environmentId: state.v3VMTemplate.environmentId, imageId: state.v3VMTemplate.imageId, imageVersion: state.v3VMTemplate.imageVersion, workspaceGiB: Number(data.workspaceGiB) } }) : undefined; const selected = state.v3EnvironmentImages.find((image) => image.imageId === state.v3VMTemplate?.imageId); const hardware = state.v3VMProbe?.hardware as Record<string, any> || {}; const gpu = state.v3VMProbe?.gpu as Record<string, any> || {}; const network = state.v3VMProbe?.network as Record<string, any> || {}; const title = windows ? `${gpu.name || hardware.Cpu || 'Windows PC'} · ${selected?.manifest?.name || state.v3VMTemplate.imageId}` : String(data.title || 'Verified compute environment'); const description = windows ? `Verified ${selected?.manifest?.os?.distribution || 'Linux'} environment on ${gpu.name || hardware.Cpu || 'Windows hardware'} with ${Number(data.workspaceGiB)} GiB reserved workspace and ${network.downloadMbps || 0} Mbps measured download capacity.` : String(data.description || 'Verified compute environment'); const manifest = windows ? { runtimeBackend: 'wsl2', hostOS: 'windows', isolationClass: 'managed_wsl2_shared_host', capacityGuarantee: 'disclosed_best_effort', gpuAccessMode: state.v3VMTemplate.cuda ? 'shared_windows_driver' : 'none', resourceGuarantees: { singleLeasePerHost: true, diskReservation: 'hard', cpuMemory: 'configured_caps', gpu: state.v3VMTemplate.cuda ? 'shared_best_effort' : 'none', hardwarePassthroughExclusive: false }, environmentImageId: state.v3VMTemplate.imageId, environmentImageVersion: state.v3VMTemplate.imageVersion, environmentRoot: hold?.environmentRoot, validationReceipt: state.v3VMTemplate, hardware, network, capacitySnapshot: hold?.capacity, diskReservation: hold?.reservation, price, limits: v3ComputeLimitsFromState(), workspaceGiB: Number(data.workspaceGiB), region: [network.city, network.region, network.country].filter(Boolean).join(', ') } : { runtimeBackend: 'kvm_libvirt', isolationClass: 'hardware_virtualized', templateId: state.v3VMTemplate.templateId, template: state.v3VMTemplate, price, limits: v3ComputeLimitsFromState() }; await v3CreateProductAndListing({ productKind: 'compute', title, description, manifest }, price, true, windows) }) })
  resourceForm?.addEventListener('submit', (event) => {
    event.preventDefault()
    void run(async () => {
      syncResourceForm()
      if (!state.v3ResourceSources.length) throw new Error('Choose at least one Resource file.')
      if (!state.v3ResourceTitle || !state.v3ResourceDescription) throw new Error('Complete the Res sheet title and description first.')
      if (!state.v3ResourceCategory || !state.v3ResourceLicense || state.v3ResourceGrantHours < 1) throw new Error('Complete the resource type, authorization scope, and access window in the Res sheet settings.')
      if (state.v3ResourceSources.some((file) => !(file.price > 0))) throw new Error('Set an independent price for every file.')
      const attemptFingerprint = JSON.stringify({ title: state.v3ResourceTitle, description: state.v3ResourceDescription, category: state.v3ResourceCategory, license: state.v3ResourceLicense, grantHours: state.v3ResourceGrantHours, items: state.v3ResourceSources.map(({ token, price, tags, sha256 }) => ({ token, price, tags, sha256 })) })
      const idempotencyKey = v3StableApplicationAttempt('resources', attemptFingerprint)
      state.v3ResourceSubmitting = true
      renderDecisionPanel()
      try {
        const targetSheet = state.v3ResourceTargetSheet
        const created = targetSheet ? undefined : await invoke<{ product: V3Product; listing: V3Listing }>('provider_asset_create', { input: { title: state.v3ResourceTitle, description: state.v3ResourceDescription, category: state.v3ResourceCategory, license: state.v3ResourceLicense, grantHours: state.v3ResourceGrantHours, idempotencyKey } })
        const sheetId = targetSheet?.listingId || created?.listing.listingId || ''
        state.v3ResourceSources = state.v3ResourceSources.map((file) => ({ ...file, status: 'uploading' }))
        state.v3AssetProgress = { phase: 'uploading', percent: 0, completed: 0, total: state.v3ResourceSources.length }
        renderDecisionPanel()
        await invoke('provider_asset_upload', { input: { sheetId, idempotencyKey: `${idempotencyKey}:items`, items: state.v3ResourceSources.map((file) => ({ fileToken: file.token, title: file.name, description: state.v3ResourceDescription, tags: file.tags, license: state.v3ResourceLicense, grantHours: state.v3ResourceGrantHours, price: { amount: file.price, currency: 'USDC', unit: 'download' } })) } })
        state.v3AssetProgress = undefined
        state.v3ResourceArchive = undefined
        state.v3ResourceSources = []
        state.v3ResourceSubmitting = false
        state.v3ResourceTargetSheet = undefined
        state.v3SellerTab = 'listings'
        state.v3HighlightedListingId = sheetId
        state.v3ExpandedListingId = sheetId
        state.v3ListingsLoaded = false
        await loadV3Listings()
        clearV3ApplicationAttempt('resources')
      } catch (error) {
        state.v3ResourceSources = state.v3ResourceSources.map((file) => ({ ...file, status: file.status === 'uploading' ? 'failed' : file.status }))
        state.v3AssetProgress = undefined
        state.v3ResourceSubmitting = false
        renderDecisionPanel()
        throw error
      }
    })
  })
  apiForm?.addEventListener('submit', (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; void run(async () => {
    syncV3APIDraftFromForm(form)
    if (!v3AgentMaterialsCurrent('api_bridge') || state.v3APIDraftDirty) throw new Error('Load, save, and review a fresh Agent draft for the current materials.')
    if (!state.v3APIProbe?.ok) throw new Error('Check the Health Path before submitting to Listings.')
    if (!state.v3APIAttestPricing || !state.v3APIAttestUsage || !state.v3APIAttestRights || state.v3APIUnresolvedFields.length) throw new Error('Resolve all fields and accept all three seller confirmations.')
    if (state.v3APIReviewStatus.service !== 'confirmed' || state.v3APIOperations.some((route) => state.v3APIReviewStatus[`operation:${route.operationId}`] !== 'confirmed')) throw new Error('Approve every Agent draft item before submitting to Listings.')
    if (['service', ...state.v3APIOperations.map((route) => `operation:${route.operationId}`)].some((id) => v3ServiceReviewIssues('api_bridge', id).length)) throw new Error('Complete every ServiceManifest policy and pricing requirement before submitting to Listings.')
    if (!v3CredentialReady('api_bridge')) throw new Error('Complete every field required by the selected Provider authentication method.')
    if (!state.v3APIOperations.length) throw new Error('Expose at least one OpenAPI operation.')
    const providerSecret = v3RuntimeCredential('api_bridge')
    if (!state.v3APIDraft) throw new Error('Load the API Bridge Agent draft first.')
    const reviewReceipt = await serviceDraftReviewReceipt(state.v3APIDraft)
    const materialFingerprint = v3MaterialFingerprint(state.v3APIMaterials)
    const attemptFingerprint = JSON.stringify({ draftId: state.v3APIDraftId, draftVersion: state.v3APIDraftVersion, materialFingerprint, reviewReceipt, authType: state.v3APIAuthType, apiKeyHeader: state.v3APIKeyHeader, price: { currency: 'USDC', pricingVersion: 1 } })
    state.v3APISaveAttemptKey = v3StableApplicationAttempt('api_bridge', attemptFingerprint)
    state.v3APISavingListing = true
    rerenderV3APIKeepingSecret(form)
    try {
      const finalized = await invoke<{ product: V3Product; listing: V3Listing }>('provider_service_draft_submit', { input: {
        idempotencyKey: state.v3APISaveAttemptKey,
        draftId: state.v3APIDraftId,
        expectedVersion: state.v3APIDraftVersion,
        reviewReceipt,
        authType: state.v3APIAuthType,
        authName: state.v3APIKeyHeader,
        secret: providerSecret,
        baseUrl: state.v3APIBaseURL,
        healthPath: state.v3APIHealthPath,
        credentialConfigured: state.v3APIAuthType === 'none' || Boolean(providerSecret),
        connectivityPassed: true,
        sellerAttestationConfirmed: true,
      } })
      state.v3APICredentialConfigured = state.v3APIAuthType === 'none'
      state.v3APISecret = ''
      state.v3APIBasicUsername = ''
      state.v3APIOAuthClientSecret = ''
      state.v3APIMTLSPrivateKey = ''
      state.v3APISavingListing = false
      state.v3HighlightedListingId = finalized.listing.listingId
      state.v3ExpandedListingId = finalized.listing.listingId
      state.v3ListingsLoaded = false
      state.v3SellerTab = 'listings'
      await loadV3Listings()
      clearV3ApplicationAttempt('api_bridge')
      window.setTimeout(() => fields.actionView.querySelector<HTMLElement>(`[data-listing-row="${CSS.escape(finalized.listing.listingId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
    } catch (error) {
      state.v3APISavingListing = false
      renderDecisionPanel()
      throw error
    }
  }) })
  state.v3ListingApplications.filter((application) => application.source === 'endpoint').forEach((application) => {
    const endpointId = String(application.product.manifest?.tunnelEndpointId || '')
    const local = state.v3LocalEndpoints.find((endpoint) => endpoint.endpointId === endpointId)
    const details = fields.actionView.querySelector<HTMLElement>(`[data-listing-row="${CSS.escape(application.listing.listingId)}"] .detail-grid`)
    if (!local || !details) return
    const item = document.createElement('div')
    const term = document.createElement('dt')
    const value = document.createElement('dd')
    term.textContent = 'Local service (Dock only)'
    value.textContent = `${local.localBaseUrl}${local.healthPath} · timeout ${local.timeoutSeconds}s · concurrency ${local.concurrency}`
    item.append(term, value)
    details.append(item)
  })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-expand]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.v3ListingExpand
    const changed = state.v3ExpandedListingId !== id
    const previousId = state.v3ExpandedListingId
    const commit = () => {
      state.v3ExpandedListingId = changed ? id : undefined
      if (state.v3EditingListingId && state.v3EditingListingId !== id) state.v3EditingListingId = undefined
      state.v3PublishConfirmListingId = undefined
      if (changed) {
        state.v3SelectedCatalogListingId = id
        state.v3ConsumerResponse = undefined
        state.v3ConsumerError = undefined
        state.v3ConsumerOperationId = ''
        state.v3ConsumerParameters = {}
        state.v3ConsumerGrant = undefined
        state.v3ConsumerTransferProgress = undefined
        state.v3ConsumerPurchase = undefined
        state.v3ConsumerLease = undefined
        state.v3ConsumerEstimate = undefined
        state.v3ConsumerEstimateLoading = false
        const computeItem = v3UnifiedListingItems().find((candidate) => candidate.listing.listingId === id)
        if (computeItem?.product.productKind === 'compute' && !computeItem.isOwner) state.v3ConsumerMinutes = v3ComputeListingLimits(computeItem.listing, computeItem.product).minMinutes
        void refreshV3ConsumerBalance()
      }
      renderDecisionPanel()
      if (changed) {
        animateV3ListingExpansion(id)
        const computeItem = v3UnifiedListingItems().find((candidate) => candidate.listing.listingId === id)
        if (computeItem?.product.productKind === 'compute' && !computeItem.isOwner) scheduleV3ComputeEstimate(String(id || ''), state.v3ConsumerMinutes)
      }
    }
    if (previousId) animateV3ListingCollapse(previousId, commit)
    else commit()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-source]').forEach((button) => button.addEventListener('click', () => { state.v3SellerTab = normalizeV3SellerTab((button.dataset.v3ListingSource || 'vm') as V3SellerTab); renderDecisionPanel() }))
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-vm-existing-listing]')?.addEventListener('click', (event) => {
    const listingId = (event.currentTarget as HTMLButtonElement).dataset.v3VmExistingListing || ''
    state.v3SellerTab = 'listings'
    state.v3ListingMode = 'seller'
    state.v3ListingSourceFilter = 'vm'
    state.v3ExpandedListingId = listingId
    state.v3HighlightedListingId = listingId
    renderDecisionPanel()
  })
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-vm-slot-refresh]')?.addEventListener('click', () => {
    state.v3SellerError = undefined
    state.v3ListingsLoaded = false
    void loadV3Listings()
  })
  const listingSearch = fields.actionView.querySelector<HTMLInputElement>('[data-v3-listing-search]')
  const applyListingFilters = () => {
    const query = listingSearch?.value.trim().toLocaleLowerCase() || ''
    state.v3ListingQuery = listingSearch?.value || ''
    const listings = Array.from(fields.actionView.querySelectorAll<HTMLElement>('.v3-listing-application'))
    let visible = 0
    listings.forEach((listing) => {
      const searchMatches = !query || (listing.dataset.listingSearch || '').includes(query)
      listing.classList.toggle('filtered-out', !searchMatches)
      if (searchMatches) visible += 1
    })
    fields.actionView.querySelector<HTMLElement>('.v3-listing-no-results')?.classList.toggle('hidden', listings.length === 0 || visible > 0)
  }
  listingSearch?.addEventListener('input', applyListingFilters)
  const animateV3ListingSegment = (button: HTMLButtonElement, onComplete: () => void) => {
    const group = button.closest<HTMLElement>('.v3-listing-mode-switch')
    if (!group || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onComplete()
      return
    }
    group.querySelectorAll<HTMLButtonElement>(':scope > button').forEach((candidate) => {
      const active = candidate === button
      candidate.classList.toggle('active', active)
      candidate.setAttribute('aria-pressed', String(active))
    })
    group.classList.add('is-switching')
    window.setTimeout(onComplete, 220)
  }
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-project]').forEach((button) => button.addEventListener('click', () => {
    const project = button.dataset.v3ListingProject as V3ListingProject
    if (state.v3ListingSourceFilter === project) return
    state.v3ListingSourceFilter = project
    state.v3ExpandedListingId = undefined
    animateV3ListingSegment(button, () => {
      if (state.v3ListingSourceFilter !== project) return
      if (state.v3ListingMode === 'buyer') {
        state.v3CatalogLoaded = false
        void loadV3Catalog()
        return
      }
      renderDecisionPanel()
    })
  }))
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-listing-agent-copy]')?.addEventListener('click', () => {
    copyMCPAgentInstruction()
  })
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-listing-agent-details]')?.addEventListener('click', openMCPInfoModal)
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-mode]').forEach((button) => button.addEventListener('click', () => {
    const mode = button.dataset.v3ListingMode === 'seller' ? 'seller' : 'buyer'
    if (state.v3ListingMode === mode) return
    state.v3ListingMode = mode
    state.v3ListingScopeFilter = mode === 'buyer' ? 'market' : 'mine'
    state.v3ExpandedListingId = undefined
    state.v3PublishConfirmListingId = undefined
    animateV3ListingSegment(button, () => {
      if (state.v3ListingMode === mode) renderDecisionPanel()
    })
  }))
  applyListingFilters()
  fields.actionView.querySelector<HTMLSelectElement>('[data-v3-consumer-operation]')?.addEventListener('change', (event) => {
    state.v3ConsumerOperationId = (event.currentTarget as HTMLSelectElement).value
    state.v3ConsumerResponse = undefined
    state.v3ConsumerError = undefined
    renderDecisionPanel()
  })
  fields.actionView.querySelector<HTMLTextAreaElement>('[data-v3-consumer-form="api"] textarea[name="body"]')?.addEventListener('input', (event) => {
    state.v3ConsumerRequestBody = (event.currentTarget as HTMLTextAreaElement).value
  })
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-consumer-form="api"] input[name^="parameter:"], [data-v3-consumer-form="api"] input[name^="schema:"]').forEach((input) => input.addEventListener('input', () => {
    state.v3ConsumerParameters[input.name] = input.type === 'checkbox' ? input.checked : input.value
  }))
  fields.actionView.querySelector<HTMLFormElement>('[data-v3-consumer-form="api"]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    void runV3Consumer(async () => {
      const data = new FormData(form)
      const listingId = String(form.dataset.listingId || '')
      state.v3ConsumerRequestBody = String(data.get('body') || '{}')
      let body: unknown
      try { body = JSON.parse(state.v3ConsumerRequestBody || '{}') } catch { throw new Error('Request body must be valid JSON.') }
      if (!body || typeof body !== 'object' || Array.isArray(body)) body = { value: body }
      const query: Record<string, unknown> = {}
      const headers: Record<string, string> = {}
      for (const [field, raw] of data.entries()) {
        if (field.startsWith('schema:')) (body as Record<string, unknown>)[field.slice('schema:'.length)] = raw === 'on' ? true : String(raw)
        if (!field.startsWith('parameter:')) continue
        const [, location, ...nameParts] = field.split(':')
        const name = nameParts.join(':')
        if (location === 'query') query[name] = String(raw)
        else if (location === 'header') headers[name] = String(raw)
        else (body as Record<string, unknown>)[name] = String(raw)
      }
      const item = v3UnifiedListingItems().find((candidate) => candidate.listing.listingId === listingId)
      if (!item || item.isOwner) throw new Error('This marketplace listing is not available for purchase.')
      return invoke<Record<string, any>>('consumer_invoke_operation', { input: {
        listingId,
        operationId: String(data.get('operationId') || 'default'),
        query,
        headers,
        body,
        idempotencyKey: `desktop:${crypto.randomUUID()}`,
        maxChargeAtomic: v3ConsumerMaxCharge(item.listing, item.product),
        activitySessionId: `desktop:${listingId}:${crypto.randomUUID()}`,
      } })
    })
  })
  fields.actionView.querySelectorAll<HTMLFormElement>('[data-v3-consumer-form="compute"], [data-v3-consumer-form="compute-extension"]').forEach((form) => form.addEventListener('input', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[name="durationMinutes"]')
    if (!input) return
    const minimum = Number(input.min || 1)
    const maximum = Number(input.max || 10080)
    const rawRequested = Number(input.value || 0)
    const requested = Math.trunc(rawRequested)
    if (!Number.isFinite(rawRequested) || rawRequested !== requested || requested < minimum || requested > maximum) {
      if (v3ComputeEstimateTimer !== undefined) window.clearTimeout(v3ComputeEstimateTimer)
      v3ComputeEstimateTimer = undefined
      state.v3ConsumerEstimate = undefined
      state.v3ConsumerEstimateLoading = false
      state.v3ConsumerError = `Enter a whole-minute duration from ${minimum} to ${maximum}.`
      syncV3ComputeEstimateDOM()
      return
    }
    state.v3ConsumerMinutes = requested
    state.v3ConsumerEstimate = undefined
    state.v3ConsumerError = undefined
    const listingId = String(form.dataset.listingId || '')
    scheduleV3ComputeEstimate(listingId, state.v3ConsumerMinutes, form.dataset.purchaseId)
    syncV3ComputeEstimateDOM()
  }))
  fields.actionView.querySelector<HTMLFormElement>('[data-v3-consumer-form="compute"]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    void runV3Consumer(async () => {
      const listingId = String(form.dataset.listingId || '')
      const minutes = Math.max(1, Math.trunc(Number(new FormData(form).get('durationMinutes') || 1)))
      state.v3ConsumerMinutes = minutes
      const item = v3UnifiedListingItems().find((candidate) => candidate.listing.listingId === listingId)
      if (!item || item.isOwner) throw new Error('This marketplace listing is not available for purchase.')
      const estimate = await refreshV3ComputeEstimate(listingId, minutes)
      if (!estimate) throw new Error(state.v3ConsumerError || 'Cloud could not quote this purchase.')
      const maxChargeAtomic = Number(estimate.amountAtomic || 0)
      const response = await invoke<Record<string, any>>('consumer_purchase_compute', { input: { listingId, durationMinutes: minutes, idempotencyKey: `desktop:${crypto.randomUUID()}`, maxChargeAtomic, activitySessionId: `desktop:${listingId}:${crypto.randomUUID()}` } })
      state.v3ConsumerPurchase = response.purchase
      state.v3ConsumerLease = { ...(response.lease || {}), performance: response.performance || {} }
      state.v3ConsumerEstimate = undefined
      const remaining = v3ComputeListingLimits(item.listing, item.product).maxMinutes - Number(response.lease?.durationMinutes || minutes)
      if (remaining > 0) scheduleV3ComputeEstimate(listingId, Math.min(minutes, remaining), String(response.purchase?.purchaseId || ''))
      return response
    })
  })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-consumer-action="purchase-download"]').forEach((button) => button.addEventListener('click', () => void runV3Consumer(async () => {
    const listingId = String(button.dataset.listingId || '')
    const resourceItemId = String(button.dataset.resourceItemId || '')
    const item = v3UnifiedListingItems().find((candidate) => candidate.listing.listingId === listingId)
    if (!item || item.isOwner) throw new Error('This marketplace listing is not available for purchase.')
    const maxChargeAtomic = Number(button.dataset.maxCharge || 0)
    await invoke('consumer_purchase_estimate', { input: { listingId, resourceItemId } })
    const response = await invoke<Record<string, any>>('consumer_purchase_download', { input: { listingId, resourceItemId, idempotencyKey: `desktop:${crypto.randomUUID()}`, maxChargeAtomic, activitySessionId: `desktop:${listingId}:${crypto.randomUUID()}` } })
    state.v3ConsumerGrant = response.grant
    return response
  })))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-consumer-action="create-transfer"]').forEach((button) => button.addEventListener('click', () => {
    state.v3ConsumerTransferProgress = { phase: 'starting', bytesDownloaded: 0, sizeBytes: Number(state.v3ConsumerGrant?.sizeBytes || 0) }
    void runV3Consumer(() => invoke<Record<string, any>>('consumer_create_transfer', { input: { grantId: button.dataset.grantId, download: true } }))
  }))
  fields.actionView.querySelector<HTMLFormElement>('[data-v3-consumer-form="compute-extension"]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    void runV3Consumer(async () => {
      const purchaseId = String(form.dataset.purchaseId || '')
      const listingId = String(form.dataset.listingId || '')
      const minutes = Math.max(1, Math.trunc(Number(new FormData(form).get('durationMinutes') || 1)))
      if (!purchaseId) throw new Error('Compute purchase is unavailable.')
      const estimate = await refreshV3ComputeEstimate(listingId, minutes, purchaseId)
      if (!estimate) throw new Error(state.v3ConsumerError || 'Cloud could not quote this extension.')
      const response = await invoke<Record<string, any>>('consumer_extend_compute', { input: { purchaseId, durationMinutes: minutes, idempotencyKey: `desktop:${crypto.randomUUID()}`, maxChargeAtomic: Number(estimate.amountAtomic || 0) } })
      state.v3ConsumerPurchase = response.purchase || state.v3ConsumerPurchase
      state.v3ConsumerLease = response.lease || state.v3ConsumerLease
      state.v3ConsumerEstimate = undefined
      const item = v3UnifiedListingItems().find((candidate) => candidate.listing.listingId === listingId)
      if (item) {
        const remaining = v3ComputeListingLimits(item.listing, item.product).maxMinutes - Number(response.lease?.durationMinutes || 0)
        if (remaining > 0) scheduleV3ComputeEstimate(listingId, Math.min(minutes, remaining), purchaseId)
      }
      return response
    })
  })
  fields.actionView.querySelector<HTMLFormElement>('[data-v3-compute-command]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const output = form.closest<HTMLElement>('[data-v3-compute-control]')?.querySelector<HTMLElement>('[data-v3-compute-command-output]')
    void run(async () => {
      const command = String(new FormData(form).get('command') || '')
      if (!command.trim()) throw new Error('Enter a VM command.')
      if (output) output.textContent = 'Running through Exora…'
      const response = await invoke<{ command?: Record<string, any> }>('consumer_run_compute_command', { input: { leaseId: form.dataset.leaseId, command } })
      const result = response.command || {}
      if (output) output.textContent = `${String(result.stdout || '')}${result.stderr ? `\n${String(result.stderr)}` : ''}\n[exit ${Number(result.exitCode || 0)}]`
    })
  })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-compute-file-pick]').forEach((button) => button.addEventListener('click', () => void run(async () => {
    const direction = button.dataset.v3ComputeFilePick || 'upload'
    const form = button.closest<HTMLFormElement>('[data-v3-compute-transfer]')
    const workspacePath = String((form ? new FormData(form) : new FormData()).get('workspaceRelativePath') || '')
    const response = direction === 'upload'
      ? await invoke<{ path?: string; canceled?: boolean }>('consumer_choose_compute_upload')
      : await invoke<{ path?: string; canceled?: boolean }>('consumer_choose_compute_download', { input: { suggestedName: workspacePath.split('/').pop() || 'vm-file.bin' } })
    if (!response.canceled && form) {
      const input = form.querySelector<HTMLInputElement>('input[name="localPath"]')
      if (input) input.value = String(response.path || '')
    }
  })))
  fields.actionView.querySelectorAll<HTMLFormElement>('[data-v3-compute-transfer]').forEach((form) => form.addEventListener('submit', (event) => {
    event.preventDefault()
    const status = form.closest<HTMLElement>('[data-v3-compute-control]')?.querySelector<HTMLElement>('[data-v3-compute-transfer-status]')
    void run(async () => {
      const data = new FormData(form)
      const direction = form.dataset.v3ComputeTransfer || ''
      const response = await invoke<{ transferId?: string }>('consumer_start_compute_transfer', { input: {
        leaseId: form.dataset.leaseId,
        direction,
        localPath: String(data.get('localPath') || ''),
        workspaceRelativePath: String(data.get('workspaceRelativePath') || ''),
        sizeBytes: Number(data.get('sizeBytes') || 0),
        sha256: String(data.get('sha256') || ''),
      } })
      if (!response.transferId) throw new Error('Direct transfer did not start.')
      if (status) { status.textContent = 'Connecting directly…'; void pollV3ComputeTransfer(response.transferId, status) }
    })
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-consumer-action="release-lease"]').forEach((button) => button.addEventListener('click', () => void runV3Consumer(async () => {
    const response = await invoke<Record<string, any>>('consumer_release_lease', { input: { leaseId: button.dataset.leaseId } })
    state.v3ConsumerLease = response.lease || state.v3ConsumerLease
    return response
  })))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-publish-request]').forEach((button) => button.addEventListener('click', () => { state.v3PublishConfirmListingId = button.dataset.v3PublishRequest; renderDecisionPanel() }))
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-publish-cancel]')?.addEventListener('click', () => { state.v3PublishConfirmListingId = undefined; renderDecisionPanel() })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-recreate-source]').forEach((button) => button.addEventListener('click', () => {
    const source = (button.dataset.v3RecreateSource || 'vm') as V3ApplicationSource
    clearV3ApplicationAttempt(source)
    if (source === 'endpoint') state.v3EndpointSubmitting = false
    if (source === 'api_bridge') state.v3APISavingListing = false
    state.v3SellerTab = normalizeV3SellerTab(source)
    state.v3HighlightedListingId = undefined
    state.v3ExpandedListingId = undefined
    showToast(t('toast.listingReplacementStarted'))
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-compute-terms-edit]').forEach((button) => button.addEventListener('click', () => {
    const listingId = String(button.dataset.listingId || '')
    const item = v3UnifiedListingItems().find((candidate) => candidate.listing.listingId === listingId)
    if (!item?.isOwner || item.product.productKind !== 'compute') return
    loadV3ComputeTermsForEditing(item.listing)
    state.v3EditingListingId = listingId
    renderDecisionPanel()
  }))
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-compute-terms-cancel]')?.addEventListener('click', () => {
    state.v3EditingListingId = undefined
    renderDecisionPanel()
  })
  fields.actionView.querySelector<HTMLFormElement>('[data-v3-compute-terms-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    void run(async () => {
      const listingId = String(form.dataset.listingId || '')
      const item = v3UnifiedListingItems().find((candidate) => candidate.listing.listingId === listingId)
      if (!item?.isOwner || item.product.productKind !== 'compute') throw new Error('Compute listing is unavailable for editing.')
      if (!(state.v3PricePerMinute > 0)) throw new Error('Minute price must be greater than zero.')
      if (state.v3MinimumMinutes < 1 || state.v3MaximumMinutes < state.v3MinimumMinutes || state.v3MaximumMinutes > 10080) throw new Error('Configure a valid rental range up to 10,080 minutes.')
      if (state.v3LongDiscountEnabled && (state.v3LongDiscountAfterMinutes > state.v3MaximumMinutes || state.v3LongDiscountPercent <= 0)) throw new Error('Configure a valid long-rental discount within the maximum rental time.')
      const saved = await invoke<{ listing: V3Listing }>('provider_listing_save', { input: {
        listingId,
        version: Number(item.listing.version || 0),
        price: v3ComputePriceFromState(),
        limits: v3ComputeLimitsFromState(),
        workloadPolicy: v3ComputeWorkloadPolicy(),
        performancePolicy: v3ComputePerformancePolicy(),
        availability: item.listing.availability || {},
      } })
      state.v3EditingListingId = undefined
      state.v3HighlightedListingId = saved.listing.listingId
      state.v3ListingsLoaded = false
      state.v3CatalogLoaded = false
      await Promise.all([loadV3Listings(), loadV3Catalog()])
    })
  })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-resource-add-files]').forEach((button) => button.addEventListener('click', () => {
    state.v3ResourceTargetSheet = { listingId: String(button.dataset.listingId || ''), productId: String(button.dataset.productId || ''), title: String(button.dataset.title || ''), description: String(button.dataset.description || '') }
    const existing = v3UnifiedListingItems().find((item) => item.listing.listingId === state.v3ResourceTargetSheet?.listingId && item.isOwner)
    state.v3ResourceTitle = state.v3ResourceTargetSheet.title
    state.v3ResourceDescription = state.v3ResourceTargetSheet.description
    state.v3ResourceCategory = String(existing?.product.manifest?.category || 'other')
    state.v3ResourceLicense = String(existing?.product.manifest?.license || 'commercial')
    state.v3ResourceGrantHours = Number(existing?.product.manifest?.grantHours || 24)
    state.v3ResourceSources = []
    state.v3SellerTab = 'resources'
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLFormElement>('[data-v3-resource-item-form]').forEach((form) => form.addEventListener('submit', (event) => {
    event.preventDefault()
    void run(async () => {
      const data = new FormData(form)
      await invoke('provider_resource_item_update', { input: { resourceItemId: form.dataset.resourceItemId, title: String(data.get('title') || '').trim(), description: String(data.get('description') || '').trim(), tags: String(data.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12), license: String(data.get('license') || '').trim(), grantHours: Number(data.get('grantHours') || 0), price: { amount: Number(data.get('price') || 0), currency: 'USDC', unit: 'download' } } })
      state.v3ListingsLoaded = false
      state.v3CatalogLoaded = false
      await Promise.all([loadV3Listings(), loadV3Catalog()])
    })
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-resource-item-action]').forEach((button) => button.addEventListener('click', () => void run(async () => {
    await invoke('provider_resource_item_action', { input: { resourceItemId: button.dataset.resourceItemId, action: button.dataset.v3ResourceItemAction } })
    state.v3ListingsLoaded = false
    state.v3CatalogLoaded = false
    await Promise.all([loadV3Listings(), loadV3Catalog()])
  })))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-delete-unavailable]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    showToast(sx(
      'This Cloud deployment does not support Listing deletion yet. Deploy migration 033 and the matching Cloud binary, then retry.',
      '当前 Cloud 尚不支持删除挂单。请先部署 migration 033 和匹配的 Cloud 二进制，再重试。',
    ))
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-delete]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    const listingId = String(button.dataset.listingId || '')
    if (!listingId || !window.confirm(sx('Delete this Listing? It will be removed from the market and cannot be restored. Existing transactions and audit history will be kept.', '删除这个挂单吗？它会立即下架且无法恢复；现有交易和审计历史将被保留。'))) return
    void run(async () => {
      await invoke('provider_listing_delete', { input: { listingId } })
      if (state.v3ExpandedListingId === listingId) state.v3ExpandedListingId = undefined
      if (state.v3HighlightedListingId === listingId) state.v3HighlightedListingId = undefined
      state.v3ListingsLoaded = false
      state.v3CatalogLoaded = false
      await Promise.all([loadV3Listings(), loadV3Catalog()])
      showToast(sx('Listing deleted.', '挂单已删除。'))
    })
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-action]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    const listingId = String(button.dataset.listingId || '')
    const listingAction = String(button.dataset.v3ListingAction || '')
    if (!listingAction) return
    const originalContent = button.innerHTML
    const originalLabel = button.getAttribute('aria-label')
    button.innerHTML = `<i></i>${escapeHTML(sx('Updating…', '处理中…'))}`
    button.setAttribute('aria-label', sx('Updating Listing', '正在更新挂单'))
    void runControlAction(button, async () => {
      const application = state.v3ListingApplications.find((item) => item.listing.listingId === listingId)
      if (listingAction === 'publish' && application?.source === 'vm') {
        const capacity = await invoke<{ result?: { providerBusy?: boolean } }>('provider_vm_capacity')
        if (capacity.result?.providerBusy) throw new Error('VM capacity changed and the provider is currently busy. Recheck or recreate the draft before publishing.')
      }
      await invoke('provider_listing_action', { input: { listingId, action: listingAction } })
      state.v3PublishConfirmListingId = undefined
      state.v3ListingsLoaded = false
      state.v3CatalogLoaded = false
      await Promise.all([loadV3Listings(), loadV3Catalog()])
    }).finally(() => {
      if (!button.isConnected) return
      button.innerHTML = originalContent
      if (originalLabel === null) button.removeAttribute('aria-label')
      else button.setAttribute('aria-label', originalLabel)
    })
  }))
}

function renderDecisionPanel() {
  renderViewTabs()
  const showingActivityDetail = Boolean(state.selectedV3ActivitySessionId)
  fields.appShell.classList.add('resource-console-mode', 'seller-surface-mode', 'right-workspace-white')
  syncV3SellerTabsVisibility()
  fields.actionView.classList.remove('hidden')
  syncV3SellerTabs()
  localize(fields.sellerSurfaceTabs)
  fields.decisionContent.innerHTML = showingActivityDetail ? renderV3ActivityDetail() : renderV3SellerSurface()
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
    if (record.productKind === 'compute') return v3HistoryCopy('Session ended', '会话已结束')
    return v3HistoryCopy('24-hour window ended', '24 小时保留期已结束')
  }
  if (v3ActivityIsBusy(record)) {
    if (record.productKind === 'api_operation') return v3HistoryCopy('Call in flight', '有调用进行中')
    if (record.productKind === 'download') return v3HistoryCopy('Transfer in progress', '传输或校验中')
    return v3HistoryCopy('Runtime active', '运行中')
  }
  const retainUntil = v3ActivityRetainUntil(record)
  const remaining = Math.max(0, sortTime(retainUntil) - Date.now())
  const minutes = Math.max(1, Math.ceil(remaining / 60_000))
  const duration = minutes >= 60 ? `${Math.ceil(minutes / 60)}h` : `${minutes}m`
  return record.productKind === 'download'
    ? v3HistoryCopy(`Grant retained ${duration}`, `授权保留 ${duration}`)
    : v3HistoryCopy(`Retained ${duration}`, `保留 ${duration}`)
}

function renderOrderActivitySidebar() {
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

function v3ActivityKindLabel(kind: string) {
  if (kind === 'compute') return 'VM'
  if (kind === 'download') return 'FILE'
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
  return `
    <article class="v3-history-row-shell ${active ? 'active' : ''}">
      <button class="v3-history-row" type="button" data-v3-history-record="${escapeAttr(record.displayId)}" title="${escapeAttr([record.productTitle, record.outcome, v3AtomicMoney(record.amountAtomic, record.asset), compactTimestamp(record.updatedAt)].join(' / '))}" aria-pressed="${active}">
        <span class="v3-history-kind kind-${escapeAttr(record.productKind)}" aria-hidden="true">${v3ActivityKindLabel(record.productKind)}</span>
        <span class="v3-history-copy">
          <strong>${escapeHTML(record.productTitle || 'Resource session')}</strong>
          <small>${escapeHTML([record.counterpartyLabel, v3ActivityRetentionHint(record)].filter(Boolean).join(' · '))}</small>
        </span>
        <span class="v3-history-meta">
          <span class="v3-history-amount">${escapeHTML(v3AtomicMoney(record.amountAtomic, record.asset))}</span>
          <span class="v3-history-status ${escapeAttr(record.status)}"><i aria-hidden="true"></i>${escapeHTML(statusLabel)}</span>
        </span>
      </button>
    </article>
  `
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
    notifications: { kicker: sx('PREFERENCES', '偏好'), title: sx('Notifications', '通知'), description: sx('Choose which approvals, transactions, and runtime events deserve your attention.', '选择需要提醒你的审批、交易、安全与运行时事件。') },
    'data-storage': { kicker: sx('LOCAL DATA', '本地数据'), title: sx('Data & Storage', '数据与存储'), description: sx('Inspect local usage, choose download locations, and clear only disposable data.', '查看本地占用、设置下载目录，并仅清理可安全移除的数据。') },
    'system-about': { kicker: sx('SYSTEM', '系统'), title: sx('System & About', '系统与关于'), description: sx('Check Dock, Cloud, component versions, updates, and privacy-safe diagnostics.', '检查 Dock、Cloud、组件版本、更新与隐私安全的诊断信息。') },
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

function settingSwitch(key: string, checked: boolean, label: string) {
  return `<label class="app-setting-switch" title="${escapeAttr(label)}"><input type="checkbox" data-setting-switch="${escapeAttr(key)}" ${checked ? 'checked' : ''}><span aria-hidden="true"></span><em>${escapeHTML(label)}</em></label>`
}

function settingSegment(key: string, options: Array<{ value: string; label: string }>, active: string) {
  return `<div class="app-setting-segment" role="group">${options.map((option) => `<button type="button" data-setting-segment="${escapeAttr(key)}" data-setting-value="${escapeAttr(option.value)}" class="${option.value === active ? 'active' : ''}" aria-pressed="${option.value === active}">${escapeHTML(option.label)}</button>`).join('')}</div>`
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
    settingRow(icon(Settings2), sx('Launch at login', '开机启动'), sx('Start Exora Dock after you sign in to this computer.', '登录此电脑后自动启动 Exora Dock。'), settingSwitch('launchAtLogin', state.launchAtLogin, sx('Launch at login', '开机启动'))),
    settingRow(icon(Minus), sx('Start minimized', '启动后最小化'), sx('Open quietly in the tray instead of showing the workspace.', '静默进入托盘，不立即显示工作区。'), settingSwitch('startMinimized', state.startMinimized, sx('Start minimized', '启动后最小化'))),
    settingRow(icon(X), sx('When the window closes', '关闭窗口时'), sx('Keep Dock available from the tray or quit the application completely.', '继续在托盘运行 Dock，或完全退出应用。'), settingSegment('closeBehavior', [{ value: 'tray', label: sx('Tray', '托盘') }, { value: 'quit', label: sx('Quit', '退出') }], state.closeBehavior)),
    settingRow(icon(Activity), sx('Start Dock with the app', '随应用启动 Dock'), sx('Bring the local MCP and REST runtime online automatically.', '自动启动本地 MCP 与 REST 运行时。'), settingSwitch('startDockOnLaunch', state.startDockOnLaunch, sx('Start Dock', '启动 Dock'))),
  ].join('')
  return settingsSection(sx('DISPLAY', '显示'), sx('Language & appearance', '语言与外观'), sx('These choices take effect immediately.', '这些设置会立即生效。'), preferenceRows)
    + settingsSection(sx('DESKTOP', '桌面'), sx('Startup & window behavior', '启动与窗口行为'), sx('System-level changes are applied by the Electron main process.', '系统级行为由 Electron 主进程统一执行。'), startupRows)
}

function renderAccountSettings() {
  const email = state.authAccount?.email || sx('Workspace preview', '工作区预览')
  const verified = Boolean(state.authAccount?.emailVerifiedAt)
  const secure = state.cloudAuthState?.storageAvailable ?? state.settingsSystemStatus?.secureStorageAvailable
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
    settingRow(icon(Archive), sx('Secure storage', '安全存储'), sx('Sessions use the operating system credential vault; secrets never enter the settings file.', '会话使用操作系统凭据保险库；密钥不会写入普通设置文件。'), settingStatus(secure === false ? sx('Unavailable', '不可用') : sx('Available', '可用'), secure === false ? 'danger' : 'success')),
  ].join('')
  const accountRows = [
    settingRow(icon(LogOut), sx('Sign out', '退出登录'), sx('Remove the Cloud session from this device while keeping local non-secret preferences.', '移除此设备上的 Cloud 会话，并保留本地非敏感偏好。'), settingButton('sign-out', sx('Sign out', '退出登录'), 'outline')),
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
  const enabledScopes = new Set(sessionPolicy?.scopes || ['market.read', 'compute.use', 'resources.use', 'api.invoke', 'account.read'])
  const scopeChoices: Array<[string, string]> = [
    ['market.read', sx('Market read', '市场读取')], ['compute.use', 'VM'], ['resources.use', 'Resources'],
    ['api.invoke', 'Endpoint / API Bridge'], ['account.read', sx('Usage & activity', '用量与活动')], ['seller.draft', sx('Seller drafts', '卖家草稿')],
  ]
  const scopeControls = `<div class="agent-session-scope-grid">${scopeChoices.map(([scope, label]) => `<label><input type="checkbox" data-agent-session-scope="${escapeAttr(scope)}" ${enabledScopes.has(scope) ? 'checked' : ''}>${escapeHTML(label)}</label>`).join('')}</div>${settingButton('agent-session-policy-save', sx('Save permissions', '保存权限'), 'soft')}`
  const connectionRows = [
    settingRow(icon(Activity), sx('Dock MCP runtime', 'Dock MCP 运行时'), settingsRuntimeMessage(runtime), `<div class="app-setting-actions">${settingStatus(healthy ? sx('Running', '运行中') : sx('Offline', '离线'), healthy ? 'running' : 'danger')}${settingButton('test-connection', sx('Test', '测试'), 'soft')}</div>`),
    settingRow(icon(Copy), sx('Client configurations', '客户端配置'), sx('Copy a ready-to-use configuration without exposing tokens or account credentials.', '复制可直接使用的配置，不暴露 Token 或账户凭据。'), `<div class="app-setting-actions compact">${settingButton('copy-config', 'Codex', 'outline', 'data-settings-command="copy_mcp_command"')}${settingButton('copy-config', 'Claude', 'outline', 'data-settings-command="copy_mcp_command"')}${settingButton('copy-config', 'OpenCode', 'outline', 'data-settings-command="copy_opencode_config"')}${settingButton('copy-config', sx('Generic', '通用'), 'outline', 'data-settings-command="copy_mcp_command"')}</div>`),
    settingRow(icon(FolderOpen), 'Manifest', sx('Open the read-only discovery document used by local Agent clients.', '打开本地 Agent 客户端使用的只读发现文档。'), settingButton('open-manifest', sx('Open manifest', '打开 Manifest'), 'outline')),
    settingRow(icon(Network), sx('Local REST entry', '本地 REST 入口'), sessionPolicy?.restBaseUrl || 'http://127.0.0.1:8080', settingStatus(sx('Session SK only', '仅会话 SK'), 'success')),
    settingRow(icon(Network), sx('Supported service interface', '支持的服务接口'), 'OpenAPI 3.1 · HTTP/JSON + SSE', settingStatus(sx('Locked', '已锁定'), 'success')),
  ].join('')
  const permissionRows = [
    settingRow(icon(Hand), sx('Default approval policy', '默认审批策略'), sx('Spending, renewals, and APIs with external side effects require human approval by default.', '消费、续费与具有外部副作用的 API 默认要求人工批准。'), settingStatus(sx('Human approval', '人工批准'), 'warning')),
    settingRow(icon(Wallet), sx('Agent spending limit', 'Agent 消费限额'), spendText, settingButton('open-agent-limit', sx('Open Wallet', '前往 Wallet'), 'soft')),
    settingRow(icon(ShieldCheck), sx('Default session permissions', '默认会话权限'), sx('Applied to the next MCP initialize. Existing sessions keep their issued scopes.', '应用于下一次 MCP 初始化；现有会话保留签发时的权限。'), scopeControls),
  ].join('')
  const sessionRows = state.agentSessions.length
    ? state.agentSessions.map((session) => settingRow(icon(Activity), session.clientName || sx('Agent session', 'Agent 会话'), `${(session.scopes || []).join(' · ')} · ${sx('expires', '到期')} ${compactTimestamp(session.expiresAt || '')}`, `<div class="app-setting-actions">${settingStatus(sx('Active', '有效'), 'running')}${settingButton('agent-session-revoke', sx('Revoke', '撤销'), 'outline', `data-session-id="${escapeAttr(session.sessionId)}"`)}</div>`)).join('')
    : settingRow(icon(Activity), sx('Active sessions', '活动会话'), sx('Every MCP initialize creates a different local-only session key.', '每次 MCP initialize 都会创建不同的仅本机会话密钥。'), settingStatus(sx('None', '无'), 'neutral'))
  return settingsSection(sx('CONNECTION', '连接'), sx('Dock & MCP', 'Dock 与 MCP'), sx('Dock publishes one local connection surface for supported Agent clients.', 'Dock 为受支持的 Agent 客户端提供统一的本地连接入口。'), connectionRows)
    + settingsSection(sx('BOUNDARIES', '边界'), sx('Approval & spending', '审批与消费'), sx('Wallet remains the source of truth for balances and spending limits.', '余额与消费限额仍以 Wallet 为唯一事实来源。'), permissionRows)
    + settingsSection(sx('SESSIONS', '会话'), sx('Local Agent sessions', '本地 Agent 会话'), sx('Session keys expire after 30 minutes idle or 24 hours maximum and never work against Cloud directly.', '会话密钥空闲 30 分钟或最长 24 小时后失效，且永远不能直接访问 Cloud。'), sessionRows)
    + renderSellerAutomationSettings()
}

function defaultSellerAutomationPolicy(): SellerAutomationPolicy {
  return {
    enabled: false,
    enabledKinds: v3ProviderApplicationSources(),
    allowedRoots: [], allowedServices: [], defaults: {},
    attestations: { pricing: false, rights: false, runtime: false, apiUsage: false },
    limits: { maxBatch: 10, maxFiles: 200, maxBundleBytes: 1024 ** 3, maxConcurrentRuns: 1 },
    autoInstallImages: false,
  }
}

function renderSellerAutomationSettings() {
  const automation = state.sellerAutomation
  const policy = automation?.policy || defaultSellerAutomationPolicy()
  const credentials = automation?.credentials || []
  const runs = automation?.runs || []
  const allKinds: Array<[string, string]> = [['vm', 'VM'], ['resources', 'Resources'], ['endpoint', 'Endpoint'], ['api_bridge', 'API Bridge']]
  const kinds = allKinds.filter(([value]) => vmProviderAvailable || value !== 'vm')
  const roots = policy.allowedRoots.length
    ? policy.allowedRoots.map((root) => `<div class="seller-automation-root"><input data-seller-root-id="${escapeAttr(root.id)}" value="${escapeAttr(root.path)}" readonly><button type="button" class="app-setting-button outline" data-settings-action="seller-root-remove" data-seller-root-remove="${escapeAttr(root.id)}">${escapeHTML(sx('Remove', '移除'))}</button></div>`).join('')
    : `<small>${escapeHTML(sx('No folder is authorized. The Agent cannot scan the computer.', '尚未授权目录，Agent 无法扫描电脑。'))}</small>`
  const credentialRows = credentials.length
    ? credentials.map((credential) => `<span class="seller-automation-chip"><strong>${escapeHTML(credential.label)}</strong><small>${escapeHTML(credential.authType)} · ${escapeHTML((credential.serviceIds || []).join(', ') || sx('Any authorized service', '任一授权服务'))}</small><button type="button" data-settings-action="seller-credential-delete" data-credential-ref="${escapeAttr(credential.credentialRef)}">×</button></span>`).join('')
    : `<small>${escapeHTML(sx('No credential aliases saved.', '尚未保存凭据别名。'))}</small>`
  const runRows = runs.slice(0, 5).map((run) => `<div class="seller-automation-run"><span>${escapeHTML(run.kind)}</span><strong>${escapeHTML(run.status)} · ${Math.max(0, Math.min(100, Number(run.progress || 0)))}%</strong><small>${escapeHTML(run.result?.listingId || (run.missingFields || []).join(', ') || run.error || run.currentStep || '')}</small></div>`).join('') || `<small>${escapeHTML(sx('No Agent draft runs yet.', '尚无 Agent 草稿运行记录。'))}</small>`
  const status = policy.enabled ? settingStatus(sx('Enabled', '已启用'), 'success') : settingStatus(sx('Setup required', '需要配置'), 'warning')
  return `<section class="app-settings-section seller-automation-settings"><div class="app-settings-section-head"><span>SELLER AUTOMATION</span><h2>${escapeHTML(sx('One-command private Listing drafts', '一句指令创建私有 Listing 草稿'))}</h2><p>${escapeHTML(sx('Authorize only the folders and services an Agent may inspect. MCP can create private drafts, but can never publish, pause, resume, or retire a Listing.', '仅授权 Agent 可检查的目录与服务。MCP 可以创建私有草稿，但永远不能发布、暂停、恢复或退役 Listing。'))}</p></div><div class="app-setting-list"><div class="app-setting-row seller-automation-summary"><span class="app-setting-icon">${icon(ShieldCheck)}</span><div class="app-setting-copy"><strong>${escapeHTML(sx('ProviderAgent boundary', 'ProviderAgent 权限边界'))}</strong><p>${escapeHTML(policy.policyId ? `Policy v${policy.version || 1} · ${String(policy.hash || '').slice(0, 12)}` : sx('Complete the setup once before using Agent commands.', '首次使用前完成一次配置。'))}</p></div><div class="app-setting-control">${status}</div></div><div class="seller-automation-form" data-seller-automation-form>
    <fieldset><legend>${escapeHTML(sx('1. Resource types and authorized folders', '1. 资源类型与授权目录'))}</legend><div class="seller-automation-kinds">${kinds.map(([value, label]) => `<label><input type="checkbox" data-seller-kind="${value}" ${policy.enabledKinds.includes(value) ? 'checked' : ''}>${label}</label>`).join('')}</div><div class="seller-automation-roots">${roots}</div><button type="button" class="app-setting-button soft" data-settings-action="seller-root-add">${escapeHTML(sx('Authorize folder', '授权目录'))}</button></fieldset>
    <fieldset><legend>${escapeHTML(sx('2. Authorized services', '2. 授权服务'))}</legend><p>${escapeHTML(sx('Endpoint accepts loopback/private URLs; API Bridge accepts public HTTPS only.', 'Endpoint 仅允许回环/私网 URL；API Bridge 仅允许公网 HTTPS。'))}</p><textarea data-seller-services rows="5" spellcheck="false">${escapeHTML(JSON.stringify(policy.allowedServices, null, 2))}</textarea></fieldset>
    <fieldset><legend>${escapeHTML(sx('3. Four commercial default templates', '3. 四类商业默认模板'))}</legend><p>${escapeHTML(sx('Agent uses these only for missing fields. Explicit values in your instruction override them; the Agent must not invent overrides.', 'Agent 仅用它们补齐缺失字段。指令中的明确值会覆盖默认值；Agent 不得自行推断覆盖值。'))}</p><textarea data-seller-defaults rows="9" spellcheck="false">${escapeHTML(JSON.stringify(policy.defaults, null, 2))}</textarea></fieldset>
    <fieldset><legend>${escapeHTML(sx('4. Limits and responsibility confirmation', '4. 限制与责任确认'))}</legend><div class="seller-automation-limits"><label>Batch<input type="number" min="1" max="10" data-seller-limit="maxBatch" value="${policy.limits.maxBatch}"></label><label>Files<input type="number" min="1" max="1000" data-seller-limit="maxFiles" value="${policy.limits.maxFiles}"></label><label>Concurrent<input type="number" min="1" max="4" data-seller-limit="maxConcurrentRuns" value="${policy.limits.maxConcurrentRuns}"></label></div><div class="seller-automation-attestations"><label><input type="checkbox" data-seller-attestation="pricing" ${policy.attestations.pricing ? 'checked' : ''}>${escapeHTML(sx('I accept responsibility for saved and explicit pricing.', '我对保存和明确给出的定价负责。'))}</label><label><input type="checkbox" data-seller-attestation="rights" ${policy.attestations.rights ? 'checked' : ''}>${escapeHTML(sx('I have the right to sell these resources.', '我有权出售这些资源。'))}</label><label><input type="checkbox" data-seller-attestation="runtime" ${policy.attestations.runtime ? 'checked' : ''}>${escapeHTML(sx('I accept runtime and availability responsibility.', '我承担运行与可用性责任。'))}</label><label><input type="checkbox" data-seller-attestation="apiUsage" ${policy.attestations.apiUsage ? 'checked' : ''}>${escapeHTML(sx('I accept API usage and metering responsibility.', '我承担 API 用量与计量责任。'))}</label><label><input type="checkbox" data-seller-auto-install ${policy.autoInstallImages ? 'checked' : ''}>${escapeHTML(sx('Allow automatic large VM image downloads', '允许自动下载大型 VM 镜像'))}</label></div></fieldset>
    <fieldset><legend>${escapeHTML(sx('Credential aliases', '凭据别名'))}</legend><div class="seller-automation-credentials">${credentialRows}</div><button type="button" class="app-setting-button outline" data-settings-action="seller-credential-add">${escapeHTML(sx('Add credential alias', '添加凭据别名'))}</button></fieldset>
    <div class="seller-automation-actions"><label><input type="checkbox" data-seller-enabled ${policy.enabled ? 'checked' : ''}>${escapeHTML(sx('Enable seller MCP tools after saving', '保存后启用卖家 MCP 工具'))}</label><button type="button" class="app-setting-button primary" data-settings-action="seller-automation-save">${escapeHTML(sx('Save seller automation policy', '保存卖家自动化策略'))}</button></div>
    <fieldset><legend>${escapeHTML(sx('Recent Agent draft runs', '最近的 Agent 草稿运行'))}</legend><div class="seller-automation-runs">${runRows}</div></fieldset>
  </div></div></section>`
}

function renderNotificationSettings() {
  const supported = state.settingsSystemStatus?.notificationsSupported
  const permissionRows = settingRow(icon(Bell), sx('System notifications', '系统通知'), supported === false ? sx('This operating system does not expose notifications to Exora Dock.', '此操作系统未向 Exora Dock 提供通知能力。') : sx('Send a test notification without changing your category preferences.', '发送测试通知，不改变你的分类偏好。'), `<div class="app-setting-actions">${settingStatus(supported === false ? sx('Unavailable', '不可用') : sx('Available', '可用'), supported === false ? 'danger' : 'success')}${settingButton('test-notification', sx('Send test', '发送测试'), 'soft', supported === false ? 'disabled' : '')}</div>`)
  const definitions: Array<[NotificationPreferenceKey, string, string, string, string]> = [
    ['approvals', 'Approvals', '审批', 'Agent actions waiting for your decision.', '等待你决定的 Agent 操作。'],
    ['purchases', 'Purchases', '购买', 'Purchase completion, failure, and refund events.', '购买完成、失败与退款事件。'],
    ['downloads', 'Downloads', '下载', 'Download readiness, progress failures, and expiry.', '下载就绪、传输失败与授权到期。'],
    ['leases', 'Leases & renewals', '租约与续费', 'Compute lease lifecycle and renewal requests.', '计算租约生命周期与续费请求。'],
    ['wallet', 'Balance & withdrawals', '余额与提现', 'Low balance, deposits, and withdrawal status.', '余额不足、充值与提现状态。'],
    ['security', 'Security events', '安全事件', 'Sign-in, credential, PIN, and account protection events.', '登录、凭据、PIN 与账户保护事件。'],
    ['sellerOrders', 'Seller orders', '卖家订单', 'New orders and buyer actions that need a provider response.', '需要 Provider 响应的新订单与买家操作。'],
    ['sellerListings', 'Listing health', 'Listing 状态', 'Listing pauses, validation failures, and availability changes.', 'Listing 暂停、验证失败与可用性变化。'],
    ['runtime', 'Runtime & settlement', '运行时与结算', 'Dock, Worker, provider runtime, and settlement failures.', 'Dock、Worker、Provider 运行时与结算异常。'],
  ]
  const visibleDefinitions = definitions.filter(([key]) => state.workOrderSide === 'seller'
    ? !['purchases', 'downloads', 'leases'].includes(key)
    : !['sellerOrders', 'sellerListings'].includes(key))
  const categoryRows = visibleDefinitions.map(([key, en, zh, enDetail, zhDetail]) => settingRow(icon(key === 'security' ? ShieldCheck : key === 'runtime' ? Activity : Bell), sx(en, zh), sx(enDetail, zhDetail), settingSwitch(`notification.${key}`, state.notifications[key], sx(en, zh)))).join('')
  return settingsSection(sx('PERMISSION', '权限'), sx('Delivery', '通知能力'), sx('If system permission is denied, critical events remain visible inside the app.', '如果系统权限被拒绝，关键事件仍会保留在应用内。'), permissionRows)
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
  const runtime = system?.runtime || state.appStatus
  const healthy = runtime?.daemon === 'healthy'
  const cloudURL = system?.cloudURL || state.cloudAuthState?.cloudURL || sx('Not configured', '未配置')
  const update = system?.update
  const workerRow = ''
  const statusRows = [
    settingRow(icon(Activity), 'Dock', settingsRuntimeMessage(runtime), `<div class="app-setting-actions">${settingStatus(healthy ? sx('Running', '运行中') : sx('Offline', '离线'), healthy ? 'running' : 'danger')}${healthy ? settingButton('stop-dock', sx('Stop', '停止'), 'outline') : settingButton('start-dock', sx('Start', '启动'), 'soft')}${settingButton('restart-dock', sx('Restart', '重启'), 'outline')}</div>`),
    workerRow,
    settingRow(icon(Network), 'Cloud', cloudURL, settingStatus(state.cloudAuthState?.offline ? sx('Offline', '离线') : sx('Connected', '已连接'), state.cloudAuthState?.offline ? 'danger' : 'running')),
    settingRow(icon(Info), sx('Components', '组件版本'), `Exora Dock ${system?.appVersion || '—'} · Electron ${system?.electronVersion || '—'} · ${system?.platform || '—'} ${system?.arch || ''}`, settingStatus(system?.packaged === false ? sx('Development', '开发构建') : sx('Stable', '稳定版'), 'neutral')),
  ].join('')
  const updateRows = settingRow(icon(RefreshCw), sx('Update notifications', '更新提醒'), settingsUpdateMessage(update), `<div class="app-setting-actions">${update?.state === 'available' ? settingStatus(sx('Verified update', '已验证更新'), 'success') : ''}${settingSwitch('autoUpdate', state.autoUpdate, sx('Check signed manifest on startup', '启动时检查签名清单'))}${settingButton('check-update', sx('Check now', '立即检查'), 'soft')}${update?.state === 'available' ? settingButton('install-update', sx('Open download', '打开下载页'), 'primary') : ''}</div>`)
  const supportRows = [
    settingRow(icon(Archive), sx('Redacted diagnostics', '脱敏诊断包'), sx('Exports versions, runtime state, and storage metrics. PINs, tokens, keys, authorization headers, and account details are excluded.', '导出版本、运行状态与存储指标；排除 PIN、Token、密钥、Authorization Header 与账户详情。'), settingButton('export-diagnostics', sx('Export', '导出'), 'soft')),
    settingRow(icon(ShieldCheck), sx('Legal & privacy', '许可证与隐私'), sx('Review the software license and Exora privacy architecture.', '查看软件许可证与 Exora 隐私架构说明。'), `<div class="app-setting-actions">${settingButton('open-license', sx('License', '许可证'), 'outline')}${settingButton('open-privacy', sx('Privacy', '隐私'), 'outline')}</div>`),
  ].join('')
  return settingsSection(sx('HEALTH', '健康状态'), sx('Services & versions', '服务与版本'), sx('Cloud URL is read-only in production builds.', '生产环境中的 Cloud URL 仅可读。'), statusRows)
    + settingsSection(sx('UPDATES', '更新'), sx('Signed Technical Preview channel', '签名技术预览通道'), sx('The app verifies the Ed25519 release manifest and shows the expected installer SHA-256. Downloads open in your browser and are never installed silently.', '应用会验证 Ed25519 发布清单并显示安装包的预期 SHA-256；下载将在浏览器中打开，绝不会静默安装。'), updateRows)
    + settingsSection(sx('SUPPORT', '支持'), sx('Diagnostics & policy', '诊断与政策'), sx('Advanced details are disclosed only when you ask for them.', '仅在你主动请求时展示高级信息。'), supportRows)
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
  void navigator.clipboard.writeText(t('listings.agentPrompt'))
    .then(() => showToast(t('toast.agentPromptCopied')))
    .catch((error) => showToast(humanizeError(error)))
}

function mcpInfoSteps(keys: string[]) {
  return `<ol>${keys.map((key) => `<li>${escapeHTML(t(key))}</li>`).join('')}</ol>`
}

function renderMCPInfoModal() {
  fields.mcpInfoModal.classList.toggle('hidden', !state.mcpInfoModalOpen)
  fields.mcpInfoModal.setAttribute('aria-hidden', String(!state.mcpInfoModalOpen))
  if (!state.mcpInfoModalOpen) return
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
  state.settingsStatusLoading = true
  state.settingsStatusError = undefined
  if (state.settingsOpen) renderSettingsPanel()
  try {
    if (hasDesktopBridge()) {
      const [system, policy, credentials, runs, accountKey, agentSessions, agentSessionPolicy] = await Promise.all([
        invoke<DesktopSystemStatus>('system_settings_status'),
        invoke<{ configured?: boolean; policy?: SellerAutomationPolicy }>('seller_automation_policy_get').catch(() => ({ configured: false, policy: undefined })),
        invoke<{ credentials?: SellerAutomationCredential[] }>('seller_automation_credentials').catch(() => ({ credentials: [] })),
        invoke<{ runs?: SellerDraftRunSummary[] }>('seller_automation_draft_runs', { input: { limit: 20 } }).catch(() => ({ runs: [] })),
        invoke<AccountAPIKeyStatus>('account_api_key_status').catch(() => undefined),
        invoke<{ sessions?: AgentSessionStatus[] }>('agent_session_status').catch(() => ({ sessions: [] })),
        invoke<AgentSessionPolicy>('agent_session_policy_get').catch(() => undefined),
      ])
      state.settingsSystemStatus = system
      state.sellerAutomation = { configured: Boolean(policy.configured), policy: policy.policy, credentials: credentials.credentials || [], runs: runs.runs || [] }
      state.accountAPIKeyStatus = accountKey
      state.agentSessions = agentSessions.sessions || []
      state.agentSessionPolicy = agentSessionPolicy
    } else {
      state.settingsSystemStatus = previewSystemSettingsStatus()
      state.sellerAutomation = { configured: false, credentials: [], runs: [] }
    }
    if (state.settingsSystemStatus.runtime) state.appStatus = state.settingsSystemStatus.runtime
  } catch (error) {
    state.settingsStatusError = humanizeError(error)
  } finally {
    state.settingsStatusLoading = false
    if (state.settingsOpen) renderSettingsPanel()
  }
}

function previewSystemSettingsStatus(): DesktopSystemStatus {
  return {
    appVersion: '0.1.0', electronVersion: 'preview', platform: navigator.platform || 'web', arch: '—', packaged: false,
    secureStorageAvailable: true, notificationsSupported: 'Notification' in window, notificationPermission: 'preview',
    paths: { data: 'ExoraDock/data', logs: 'ExoraDock/logs', downloads: state.downloadDirectory || sx('System Downloads folder', '系统下载目录') },
    storage: { dataBytes: 18_874_368, logsBytes: 786_432, cacheBytes: 5_242_880, tempBytes: 262_144 },
    runtime: state.appStatus || { docker: 'native', container: 'running', daemon: 'healthy', image: 'available', containerName: 'exora-dockd', imageTag: 'preview', baseUrl: 'http://127.0.0.1:8080', dataDir: '', configPath: '', discoveryPath: '', mcpCommand: '', agentPrompt: '', opencodeConfig: '', message: sx('Dock is ready for local Agent connections.', 'Dock 已准备好接受本地 Agent 连接。') },
    cloudURL: state.cloudAuthState?.cloudURL || 'https://api.exoradock.com',
    update: { supported: false, channel: 'stable', automatic: state.autoUpdate, state: 'development', message: sx('Updates are disabled in the browser preview.', '浏览器预览中不启用更新。') },
  }
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
  const stepNumber = setup ? (confirming ? 2 : 1) : current ? 1 : step === 'entry' ? 2 : 3
  const stepCount = setup ? 2 : 3
  fields.pinSettingsModal.classList.toggle('hidden', !state.pinSettingsModalOpen)
  fields.pinSettingsModal.setAttribute('aria-hidden', String(!state.pinSettingsModalOpen))
  fields.pinSettingsModal.dataset.pinStepCount = String(stepCount)
  fields.pinSettingsEyebrow.textContent = setup ? 'One last security step' : 'Account security'
  fields.pinSettingsTitle.textContent = setup
    ? confirming ? 'Confirm your payment PIN' : 'Create your payment PIN'
    : current ? 'Change payment PIN' : confirming ? 'Confirm your new PIN' : 'Choose a new PIN'
  fields.pinSettingsDetail.textContent = setup
    ? confirming
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
  fields.pinSettingsCodeInput.disabled = state.pinSettingsBusy
  fields.pinSettingsCodeInput.required = true
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
  fields.pinSettingsSubmit.textContent = confirming ? (setup ? 'Create PIN' : 'Change PIN') : 'Continue'
  const onFirstStep = (setup && step === 'entry') || current
  fields.pinSettingsCancel.textContent = onFirstStep ? (setup ? 'Not now' : 'Cancel') : 'Back'
  fields.pinSettingsFooter.textContent = setup
    ? 'Payments stay locked until you create a PIN.'
    : 'Your PIN protects sensitive account actions.'
  fields.pinSettingsSubmit.disabled = state.pinSettingsBusy
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
  state.pinSettingsModalOpen = true
  renderPINSettingsModal()
  window.setTimeout(() => fields.pinSettingsCodeInput.focus(), 0)
}

function closePINSettingsModal() {
  if (!state.pinSettingsModalOpen || state.pinSettingsBusy) return
  dismissPINSettingsModal()
}

function dismissPINSettingsModal() {
  state.pinSettingsModalOpen = false
  state.pinSettingsMode = 'change'
  state.pinSettingsSetupStep = 'current'
  state.pinSettingsCurrentValue = ''
  state.pinSettingsSetupValue = ''
  fields.pinSettingsForm.reset()
  fields.pinSettingsMessage.textContent = ''
  fields.pinSettingsMessage.dataset.tone = ''
  renderPINSettingsModal()
}

async function submitPINSettings() {
  if (state.pinSettingsBusy) return
  const setup = state.pinSettingsMode === 'setup'
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
      if (result.accountKey?.token) window.prompt(sx('Copy this account key now. It will not be shown again.', '请立即复制账户密钥，之后不会再次显示。'), result.accountKey.token)
      else if (result.accountKey?.error) showToast(result.accountKey.error)
    } else {
      await invoke<CloudAuthState>('auth_pin_change', {
        input: {
          currentPIN: state.pinSettingsCurrentValue,
          newPIN: state.pinSettingsSetupValue,
          pinConfirm: entered,
        },
      })
    }
    dismissPINSettingsModal()
    showToast(setup ? 'Payment PIN created.' : t('toast.paymentPinChanged'))
  } catch (error) {
    fields.pinSettingsMessage.textContent = humanizeError(error)
    fields.pinSettingsMessage.dataset.tone = 'error'
  } finally {
    state.pinSettingsBusy = false
    renderPINSettingsModal()
  }
}

function advancePINSettingsStep(step: 'current' | 'entry' | 'confirmation', keepMessage = false) {
  state.pinSettingsSetupStep = step
  fields.pinSettingsCodeInput.value = ''
  if (!keepMessage) {
    fields.pinSettingsMessage.textContent = ''
    fields.pinSettingsMessage.dataset.tone = ''
  }
  renderPINSettingsModal()
  window.setTimeout(() => fields.pinSettingsCodeInput.focus(), 0)
}

function goBackPINSettingsStep() {
  if (state.pinSettingsBusy) return
  const setup = state.pinSettingsMode === 'setup'
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

let walletStatusRequest: Promise<string> | undefined

function refreshWalletStatus() {
  if (walletStatusRequest) return walletStatusRequest
  const request = (async () => {
    const wallet = await invoke<{ wallet?: WalletStatus }>('wallet_status').catch((error) => ({ error: humanizeError(error) }))
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

function applySettingsSegment(key: string, value: string) {
  if (key === 'language' && isAppLanguage(value)) {
    setLanguage(value)
    scheduleSaveAppSettings(0)
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
  else if (key === 'startDockOnLaunch') state.startDockOnLaunch = checked
  else if (key === 'autoUpdate') state.autoUpdate = checked
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
    if (action === 'seller-root-add') {
      const draft = readSellerAutomationPolicyForm()
      const result = await invokeAction<{ canceled?: boolean; path?: string }>('seller_automation_choose_root')
      if (!result.canceled && result.path) {
        draft.allowedRoots.push({ id: `root_${Date.now()}`, path: result.path, displayName: result.path.split(/[\\/]/).filter(Boolean).pop() || result.path, kinds: ['resources', 'endpoint', 'api_bridge'] })
        state.sellerAutomation = { ...(state.sellerAutomation || { configured: false, credentials: [], runs: [] }), policy: draft }
        renderSettingsPanel()
      }
      return
    }
    if (action === 'seller-root-remove') {
      const draft = readSellerAutomationPolicyForm()
      draft.allowedRoots = draft.allowedRoots.filter((root) => root.id !== button.dataset.sellerRootRemove)
      state.sellerAutomation = { ...(state.sellerAutomation || { configured: false, credentials: [], runs: [] }), policy: draft }
      renderSettingsPanel()
      return
    }
    if (action === 'seller-credential-add') {
      const label = window.prompt(sx('Credential alias label', '凭据别名名称'))?.trim()
      if (!label) return
      const authType = (window.prompt(sx('Authentication type: bearer, api_key, or basic', '认证类型：bearer、api_key 或 basic'), 'bearer') || '').trim()
      if (!['bearer', 'api_key', 'basic'].includes(authType)) throw new Error('Authentication type must be bearer, api_key, or basic.')
      const serviceIds = (window.prompt(sx('Authorized service IDs, comma separated (blank for any authorized service)', '适用服务 ID，逗号分隔（留空表示任一已授权服务）'), '') || '').split(',').map((value) => value.trim()).filter(Boolean)
      const apiKeyHeader = authType === 'api_key' ? (window.prompt(sx('API key header', 'API Key Header'), 'X-API-Key') || 'X-API-Key').trim() : ''
      const secret = window.prompt(sx('Credential value (stored encrypted locally and never returned)', '凭据内容（本地加密保存，永不返回）')) || ''
      if (!secret) return
      await invokeAction('seller_automation_credential_save', { input: { label, authType, serviceIds, apiKeyHeader, secret } })
      showToast(sx('Credential alias saved.', '凭据别名已保存。'))
      await refreshSettingsStatus()
      return
    }
    if (action === 'seller-credential-delete') {
      const credentialRef = button.dataset.credentialRef || ''
      if (!credentialRef || !window.confirm(sx('Delete this local credential alias?', '删除这个本地凭据别名吗？'))) return
      await invokeAction('seller_automation_credential_delete', { input: { credentialRef } })
      await refreshSettingsStatus()
      return
    }
    if (action === 'seller-automation-save') {
      const policy = readSellerAutomationPolicyForm()
      const response = await invokeAction<{ policy?: SellerAutomationPolicy }>('seller_automation_policy_save', { input: policy as unknown as Record<string, unknown> })
      state.sellerAutomation = { ...(state.sellerAutomation || { configured: false, credentials: [], runs: [] }), configured: true, policy: response.policy || policy }
      showToast(policy.enabled ? sx('Seller Agent draft tools are enabled.', '卖家 Agent 草稿工具已启用。') : sx('Seller automation policy saved but remains disabled.', '卖家自动化策略已保存但仍未启用。'))
      await refreshSettingsStatus()
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
      const result = await invokeAction<{ token?: string }>('account_api_key_ensure')
      if (result.token) window.prompt(sx('Copy this account key now. It will not be shown again.', '请立即复制账户密钥，之后不会再次显示。'), result.token)
      await refreshSettingsStatus()
      return
    }
    if (action === 'account-key-import') {
      const key = window.prompt(sx('Paste your existing sk-exora account key. It will be encrypted in the operating system vault.', '粘贴已有的 sk-exora 账户密钥。它会被加密保存到系统凭据库。'))?.trim()
      if (!key) return
      await invokeAction('account_api_key_import', { input: { key } })
      await refreshSettingsStatus()
      return
    }
    if (action === 'account-key-rotate' || action === 'account-key-revoke') {
      const pin = window.prompt(sx('Enter your six-digit Payment PIN in this trusted Desktop window.', '请在此可信 Desktop 窗口中输入六位支付 PIN。'))?.trim()
      if (!pin) return
      if (action === 'account-key-revoke' && !window.confirm(sx('Revoke the current account key? All clients using it will stop immediately.', '撤销当前账户密钥吗？所有使用它的客户端会立即停止工作。'))) return
      const result = await invokeAction<{ token?: string }>(action === 'account-key-rotate' ? 'account_api_key_rotate' : 'account_api_key_revoke', { input: { pin } })
      if (result.token) window.prompt(sx('Copy the new account key now. It will not be shown again.', '请立即复制新的账户密钥，之后不会再次显示。'), result.token)
      await refreshSettingsStatus()
      return
    }
    if (action === 'agent-session-policy-save') {
      const scopes = Array.from(document.querySelectorAll<HTMLInputElement>('[data-agent-session-scope]:checked')).map((input) => input.dataset.agentSessionScope || '').filter(Boolean)
      state.agentSessionPolicy = await invokeAction<AgentSessionPolicy>('agent_session_policy_save', { input: { scopes } })
      showToast(sx('Default Agent session permissions saved.', '默认 Agent 会话权限已保存。'))
      await refreshSettingsStatus()
      return
    }
    if (action === 'agent-session-revoke') {
      const sessionId = button.dataset.sessionId || ''
      if (!sessionId) return
      await invokeAction('agent_session_revoke', { input: { sessionId } })
      await refreshSettingsStatus()
      return
    }
    if (action === 'sign-out') {
      if (window.confirm(sx('Sign out of Exora Cloud on this device?', '确定要在此设备上退出 Exora Cloud 吗？'))) signOutProfile()
      return
    }
    if (action === 'delete-account') {
      if (window.confirm(sx('Account deletion is permanent. Continue to the support review notice?', '删除账户不可撤销。是否继续查看支持审核说明？'))) {
        showToast(sx('Self-service deletion is not enabled. Contact Exora Cloud support for a reviewed deletion request.', '暂未开放自助删除。请联系 Exora Cloud 支持提交审核删除申请。'))
      }
      return
    }
    if (action === 'open-agent-limit') { returnFromSettings(); openWalletModal('agent-limit'); return }
    if (action === 'copy-config') {
      const command = button.dataset.settingsCommand || 'copy_mcp_command'
      const value = await invokeAction<string>(command)
      await navigator.clipboard.writeText(String(value || ''))
      showToast(sx('Configuration copied.', '配置已复制。'))
      return
    }
    if (action === 'test-connection') {
      const result = await invokeAction<{ ok?: boolean; categories?: Array<{ applicationSource?: string; ok?: boolean }> }>('mcp_connectivity_test')
      const runtime = await invokeAction<AppStatus>('app_status')
      state.appStatus = runtime
      if (state.settingsSystemStatus) state.settingsSystemStatus.runtime = runtime
      const connected = Array.isArray(result.categories) && result.categories.length === 4 && result.categories.every((category) => category.ok)
      showToast(connected ? sx('MCP and all four categories are connected.', 'MCP 与四个分类均已连通。') : sx('MCP connectivity is incomplete.', 'MCP 连通性不完整。'))
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
      if (!window.confirm(sx('Clear this disposable local data now?', '现在清理这部分可丢弃的本地数据吗？'))) return
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
    if (action === 'export-diagnostics') {
      const result = await invokeAction<{ canceled?: boolean }>('system_export_diagnostics')
      if (!result.canceled) showToast(sx('Redacted diagnostics exported.', '脱敏诊断包已导出。'))
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
      if (!window.confirm(sx('Restart Exora Dock and install the downloaded update now?', '现在重启 Exora Dock 并安装已下载的更新吗？'))) return
      await invokeAction('system_update_install', { input: { activeWork } })
      return
    }
    if (action === 'open-license' || action === 'open-privacy') {
      await invokeAction('system_open_legal', { input: { kind: action === 'open-privacy' ? 'privacy' : 'license' } })
      return
    }
    if (action === 'start-dock' || action === 'stop-dock' || action === 'restart-dock') {
      if (action !== 'start-dock' && !window.confirm(action === 'stop-dock' ? sx('Stop Dock now? Agent connections will be interrupted.', '现在停止 Dock 吗？Agent 连接将被中断。') : sx('Restart Dock now? Active local connections may reconnect.', '现在重启 Dock 吗？活动的本地连接可能需要重新连接。'))) return
      const command = action === 'start-dock' ? 'start_dock' : action === 'stop-dock' ? 'stop_dock' : 'restart_dock'
      const runtime = await invokeAction<AppStatus>(command)
      state.appStatus = runtime
      if (state.settingsSystemStatus) state.settingsSystemStatus.runtime = runtime
      renderSettingsPanel()
      return
    }
  } catch (error) {
    showToast(humanizeError(error))
  }
}

function readSellerAutomationPolicyForm(): SellerAutomationPolicy {
  const container = fields.settingsView.querySelector<HTMLElement>('[data-seller-automation-form]')
  const prior = state.sellerAutomation?.policy || defaultSellerAutomationPolicy()
  if (!container) return structuredClone(prior)
  const servicesText = container.querySelector<HTMLTextAreaElement>('[data-seller-services]')?.value || '[]'
  const defaultsText = container.querySelector<HTMLTextAreaElement>('[data-seller-defaults]')?.value || '{}'
  let allowedServices: SellerAutomationPolicy['allowedServices']
  let defaults: SellerAutomationPolicy['defaults']
  try { allowedServices = JSON.parse(servicesText) } catch { throw new Error(sx('Authorized services must be valid JSON.', '授权服务必须是有效 JSON。')) }
  try { defaults = JSON.parse(defaultsText) } catch { throw new Error(sx('Commercial defaults must be valid JSON.', '商业默认模板必须是有效 JSON。')) }
  if (!Array.isArray(allowedServices) || !defaults || Array.isArray(defaults) || typeof defaults !== 'object') throw new Error(sx('Seller automation JSON fields have the wrong shape.', '卖家自动化 JSON 字段格式错误。'))
  const limit = (key: keyof SellerAutomationPolicy['limits'], fallback: number) => Number(container.querySelector<HTMLInputElement>(`[data-seller-limit="${key}"]`)?.value || fallback)
  const attestation = (key: keyof SellerAutomationPolicy['attestations']) => Boolean(container.querySelector<HTMLInputElement>(`[data-seller-attestation="${key}"]`)?.checked)
  const roots = [...container.querySelectorAll<HTMLInputElement>('[data-seller-root-id]')].map((input) => prior.allowedRoots.find((root) => root.id === input.dataset.sellerRootId) || { id: input.dataset.sellerRootId || `root_${Date.now()}`, path: input.value, kinds: ['resources', 'endpoint', 'api_bridge'] })
  return {
    ...prior,
    enabled: Boolean(container.querySelector<HTMLInputElement>('[data-seller-enabled]')?.checked),
    enabledKinds: [...container.querySelectorAll<HTMLInputElement>('[data-seller-kind]:checked')].map((input) => input.dataset.sellerKind || '').filter(Boolean),
    allowedRoots: roots,
    allowedServices,
    defaults,
    attestations: { pricing: attestation('pricing'), rights: attestation('rights'), runtime: attestation('runtime'), apiUsage: attestation('apiUsage') },
    limits: { maxBatch: limit('maxBatch', 10), maxFiles: limit('maxFiles', 200), maxBundleBytes: prior.limits?.maxBundleBytes || 1024 ** 3, maxConcurrentRuns: limit('maxConcurrentRuns', 1) },
    autoInstallImages: vmProviderAvailable && Boolean(container.querySelector<HTMLInputElement>('[data-seller-auto-install]')?.checked),
  }
}

function hasActiveSettingsWork() {
  const activeActivity = [...state.v3ActivitySessions.buyer, ...state.v3ActivitySessions.seller]
    .some((session) => session.status === 'active' || Number(session.inFlightCount || 0) > 0)
  return activeActivity || state.v3ConsumerBusy || state.v3ListingsLoading || state.v3ResourceSubmitting || state.v3APISavingListing || state.v3EndpointSubmitting || state.walletWithdrawalBusy
}

fields.pinSettingsModal.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('[data-pin-settings-action="close"]')) {
    event.preventDefault()
    closePINSettingsModal()
  } else if (target.closest('[data-pin-settings-action="back"]')) {
    event.preventDefault()
    goBackPINSettingsStep()
  }
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
      if (action === 'api') state.v3SellerTab = 'api_bridge'
      if (action === 'seller') state.v3SellerTab = 'listings'
      if (action === 'card') state.v3SellerTab = 'listings'
      selectOrderSide('seller')
      return
    }
  }
  if (state.profileMenuOpen && !(target instanceof Element && target.closest('.profile-panel'))) closeProfileMenu()
  if (!(target instanceof Element && target.closest('[data-v3-resource-select]'))) closeV3ResourceSelectPopovers()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeProfileMenu()
    closeV3ResourceSelectPopovers()
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
  if (target.closest('[data-v3-consumer-form="api"], [data-v3-consumer-form="compute"], [data-v3-consumer-form="compute-extension"]')) return true
  if (target.closest('[data-v3-consumer-action="purchase-download"], [data-v3-consumer-action="extend-compute"]')) return true
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
    await navigator.clipboard.writeText(address)
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
  state.v3SellerTab = 'listings'
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

function waitForWorkspacePaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  })
}

async function openWorkspace(authState?: CloudAuthState) {
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
  await requestWindowMode('workspace')
  await waitForWorkspacePaint()
  if (authState?.phase === 'needs_pin') openPINSetupModal()
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
    window.exora?.onV3Progress?.((payload) => {
    if (!payload || typeof payload !== 'object') return
    const event = payload as Partial<V3ImageProgress & V3HostScanProgress & V3AssetProgress> & { kind?: string }
    if (event.kind === 'host_scan' && event.phase && typeof event.percent === 'number') {
      if (!state.v3HostScanning) return
      state.v3HostScanProgress = { phase: event.phase, percent: event.percent, bytes: event.bytes, samples: event.samples }
      updateV3HostScanProgressButton()
      return
    }
    if ((event.kind === 'asset_packaging' || event.kind === 'asset_hashing') && event.phase && typeof event.percent === 'number') {
      state.v3AssetProgress = {
        phase: event.phase === 'complete' ? 'complete' : 'packaging',
        percent: event.percent,
        completedFiles: event.completedFiles,
        totalFiles: event.totalFiles,
        inputBytes: event.inputBytes,
        sourceBytes: event.sourceBytes,
        outputBytes: event.outputBytes,
      }
      if (state.v3SellerTab === 'resources') renderDecisionPanel()
      return
    }
    if (event.kind === 'asset_upload' && typeof event.completed === 'number' && typeof event.total === 'number') {
      state.v3AssetProgress = { phase: 'uploading', percent: event.total > 0 ? Math.round(event.completed / event.total * 100) : 0, completed: event.completed, total: event.total }
      if (state.v3SellerTab === 'resources') renderDecisionPanel()
      return
    }
    if (event.kind === 'marketplace_download' && event.phase && typeof event.bytesDownloaded === 'number') {
      state.v3ConsumerTransferProgress = { phase: event.phase, bytesDownloaded: event.bytesDownloaded, sizeBytes: Number(event.sizeBytes || 0) }
      if (state.v3SellerTab === 'listings') renderDecisionPanel()
      return
    }
    if (event.kind !== 'environment_image' || !event.imageId || !event.phase) return
    state.v3ImageProgress = { imageId: event.imageId, phase: event.phase, bytesDownloaded: event.bytesDownloaded, sizeBytes: event.sizeBytes }
    if (state.v3SellerTab === 'vm') renderDecisionPanel()
    })
    applyUserPreferences()
    renderAll()
    workspaceBootstrapped = true
    void startWorkspaceBackgroundTasks()
  })().catch((error) => {
    workspaceBootPromise = undefined
    workspaceBootstrapped = false
    throw error
  })
  return workspaceBootPromise
}

async function startWorkspaceBackgroundTasks() {
  await startDockOnLaunch()
  refreshWalletStatus().catch(() => undefined)
  void loadV3ActivitySessions('buyer')
  void loadV3ActivitySessions('seller')
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
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.theme === 'system') applyUserPreferences()
})

void bootstrap()
