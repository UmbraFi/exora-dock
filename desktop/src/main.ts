import { invoke } from './bridge'
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
  Check,
  ChevronRight,
  Copy,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  Hand,
  IdCard,
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
  PencilLine,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Search,
  SendHorizontal,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SquareKanban,
  Smartphone,
  WalletCards,
  X,
  type IconNode,
} from 'lucide'
import { toString as qrToString } from 'qrcode'
import {
  agentSourceLabel,
  approvalAmount,
  escapeHTML,
  humanizeError,
  optionCapability,
  optionIsPaid,
  optionPrice,
  paymentAmount,
  shortID,
  statusRank,
  targetSummary,
  taskAmount,
  taskTitle,
  type AgentCard,
  type AgentCardDiagnostics,
  type AgentCardRole,
  type AgentCardsMine,
  type BuyerManualFields,
  type AppStatus,
  type Approval,
  type LLMCapabilities,
  type MarketSearchResult,
  type OrderDraftOption,
  type OrderPlan,
  type PaymentRecord,
  type SellerCandidate,
  type SellerManualFields,
  type SellerMarketStatus,
  type SellerSettings,
  type Task,
} from './domain'
import './styles.css'

type ChatMessage = {
  id: string
  kind?: 'message' | 'order_event'
  role: 'assistant' | 'user' | 'system'
  actor?: 'buyer_agent' | 'seller_agent' | 'buyer_human' | 'seller_human'
  text: string
  meta?: string
  providerPubkey?: string
  eventRef?: { taskId?: string; orderId?: string; approvalId?: string; paymentId?: string }
  result?: MarketSearchResult
  pending?: boolean
}

type ChatThread = {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  projectPath?: string
  origin?: 'market-card'
  orderId?: string
  taskIds?: string[]
  status?: string
  participants?: Array<'buyer_agent' | 'seller_agent' | 'buyer_human' | 'seller_human'>
  providerPubkey?: string
}

type SelectedKind = 'plan' | 'approval' | 'task' | 'payment'
type ActiveView = 'work' | 'market' | 'chat' | 'settings'
type ChatMode = 'expanded' | 'compact'
type OrderSide = 'buyer' | 'seller'
type SettingsView = 'api' | 'buyer-agent' | 'buyer-card' | 'seller-card' | 'seller' | 'pwa' | 'wallet' | 'archives'
type AppTheme = 'light' | 'dark'
type LLMTestStatus = 'passed' | 'failed'
type ProfileSubmenu = 'language' | 'theme'
type ProjectFolderMenuAction = 'open' | 'rename' | 'archive' | 'remove'
type TaskMenuAction = 'pin' | 'rename' | 'archive' | 'unread' | 'open-project' | 'copy-id'
type PermissionMode = 'ask' | 'approve' | 'full' | 'custom'

type BuyerAgentSettings = {
  enabled: boolean
  agentId: string
}

type CardDiagnosticsTask = {
  id: number
  role: AgentCardRole
  running: boolean
  stopRequested: boolean
  message: string
}

type LedgerEntry = {
  id: string
  kind: SelectedKind
  title: string
  status: string
  subtitle: string
  source: string
  timestamp: string
}

type OrderActivityRecord = {
  id: string
  threadId: string
  title: string
  subtitle: string
  timestamp: string
  projectPath: string
  chatId?: string
  primarySelectionId?: string
}

type WorkThread = {
  id: string
  title: string
  subtitle: string
  timestamp: string
  projectPath?: string
  origin?: 'market-card'
  side: OrderSide
  orderId?: string
  chatId?: string
  providerPubkey?: string
  status?: string
  participants: Array<'buyer_agent' | 'seller_agent' | 'buyer_human' | 'seller_human'>
  taskIds: string[]
  planIds: string[]
  approvalIds: string[]
  paymentIds: string[]
  primarySelectionId?: string
}

type ArchivedWorkRecord = {
  id: string
  threadId: string
  title: string
  projectPath: string
  projectName: string
  archivedAt: string
  sourceKind: 'chat' | 'order' | 'task' | 'approval' | 'payment'
  side?: OrderSide
  status?: string
  chatSnapshot?: ChatThread
}

type WorkTaskState = {
  pinnedIds: Set<string>
  unreadIds: Set<string>
  titleOverrides: Record<string, string>
  archivedRecords: ArchivedWorkRecord[]
}

type PersistedWorkTaskState = {
  pinnedIds?: string[]
  unreadIds?: string[]
  titleOverrides?: Record<string, string>
  archivedRecords?: ArchivedWorkRecord[]
}

type PersistedAppSettings = {
  language?: AppLanguage
  theme?: AppTheme
  permissionMode?: PermissionMode
  buyerAgentSettings?: Partial<BuyerAgentSettings>
  activeSettingsView?: SettingsView
  workOrderSide?: OrderSide
  marketOrderSide?: OrderSide
  sidebarCollapsed?: boolean
  sidebarWidth?: number
  projectFolderCollapsed?: boolean
  expandedProjectFolderPaths?: string[]
  seenProjectFolderPaths?: string[]
  workTaskState?: PersistedWorkTaskState
}

type DesktopConversationRecord = {
  storageKey?: string
  thread?: ChatThread
}

type DesktopPersistenceLoad = {
  version?: number
  settings?: PersistedAppSettings
  conversations?: DesktopConversationRecord[]
}

type TransactionSnapshotRecord = {
  id: string
  orderId?: string
  taskId?: string
  side: OrderSide
  projectPath: string
  status?: string
  providerPubkey?: string
  updatedAt?: string
  task?: Task
  orderPlans: OrderPlan[]
  approvals: Approval[]
  payments: PaymentRecord[]
}

type PinAction =
  | { kind: 'select_plan'; planId: string; optionId: string }
  | { kind: 'approve'; approvalId: string }

type PinStep = {
  action: PinAction
  setup: boolean
  pin: string
  confirm: string
  error?: string
}

type WorkspaceSnapshot = {
  online?: boolean
  orderPlans?: OrderPlan[]
  approvals?: Approval[]
  tasks?: Task[]
  payments?: PaymentRecord[]
  mcpConnections?: MCPConnection[]
  workMcpLeases?: WorkMCPLease[]
  workRuns?: WorkRun[]
  workRunEvents?: Record<string, WorkRunEvent[]>
  projectFolder?: ProjectFolder
  projectFolders?: ProjectFolder[]
  activeProjectFolderPath?: string
  errors?: string[]
}

type ProjectFolder = {
  name: string
  path: string
  daemonRestarted?: boolean
}

type WorkMCPContext = {
  workUid: string
  projectPath: string
  projectName?: string
  task?: string
}

type WorkMCPLease = {
  workUid: string
  projectPath: string
  projectName?: string
  controller?: string
  source?: string
  clientName?: string
  sessionId?: string
  status?: string
  startedAt?: string
  lastSeenAt?: string
  expiresAt?: string
  updatedAt?: string
}

type WorkRun = {
  schemaVersion?: string
  runId: string
  workUid?: string
  projectPath?: string
  controller?: string
  status?: string
  currentStep?: string
  nextAction?: string
  lastCheckpointId?: string
  intent?: string
  summary?: string
  error?: string
  entities?: {
    orderPlanId?: string
    orderPlanIds?: string[]
    negotiationIds?: string[]
    taskId?: string
    approvalId?: string
    paymentId?: string
    paymentEvidenceId?: string
    escrowPda?: string
    txSignature?: string
    providerJobId?: string
    workerId?: string
  }
  activeWorker?: {
    workerId?: string
    type?: string
    status?: string
    providerPubkey?: string
    jobId?: string
    updatedAt?: string
  }
  publicDisclosure?: Record<string, unknown>
  ownerDisclosure?: Record<string, unknown>
  updatedAt?: string
  createdAt?: string
  completedAt?: string
}

type WorkRunEvent = {
  eventId: string
  type: string
  runId: string
  workUid?: string
  checkpointId?: string
  stepId?: string
  step?: string
  status?: string
  summary?: string
  data?: Record<string, unknown>
  createdAt?: string
}

type TransactionProgressStage = {
  id: string
  title: string
  detail: string
  status: 'complete' | 'active' | 'waiting' | 'blocked' | 'failed' | 'pending'
}

type TransactionProgressEvent = {
  id: string
  type: string
  label: string
  detail?: string
  timestamp?: string
  tone?: 'normal' | 'good' | 'warn' | 'bad'
}

type TransactionProgressSnapshot = {
  title: string
  side: OrderSide
  state: string
  owner: string
  waitingFor: string
  nextAction: string
  updatedAt: string
  syncStatus: string
  currentStageId: string
  terminal: boolean
  needsFastRefresh: boolean
  stages: TransactionProgressStage[]
  events: TransactionProgressEvent[]
  ids: Array<{ label: string; value?: string }>
  quote?: string
  payment?: string
  provider?: string
  artifacts?: string
}

type TransactionProgressData = {
  thread: WorkThread
  plans: OrderPlan[]
  tasks: Task[]
  approvals: Approval[]
  payments: PaymentRecord[]
  workRuns: WorkRun[]
  workRunEvents: WorkRunEvent[]
}

type MCPConnection = {
  id: string
  role?: string
  cwd?: string
  projectPath?: string
  projectName?: string
  source?: string
  clientName?: string
  createdAt?: string
  lastSeen?: string
}

type ProjectChatsArchiveResult = {
  folder: ProjectFolder
  archivedCount: number
  archivePath?: string
}

type BrowserDirectoryHandle = {
  name: string
}

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<BrowserDirectoryHandle>
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
}

type PwaLinkStatus = {
  status?: string
  userCode?: string
  verificationUrl?: string
  expiresAt?: string
  cloudUrl?: string
  dockId?: string
  deviceCode?: string
  accountId?: string
  tokenPath?: string
  qrPayload?: string
  qrSvg?: string
  linked?: boolean
  daemonRestarted?: boolean
  message?: string
}

const app = document.querySelector<HTMLDivElement>('#app')!
const isMacPlatform = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
const TOP_WINDOW_DRAG_HEIGHT = 64
const agentComposerPlaceholder = () => t('agentComposer.placeholder')
const agentComposerLockedPlaceholder = () => t('agentComposer.lockedPlaceholder')
const WORK_TASK_STATE_KEY = 'exora.workTaskState.v1'
const APP_SETTINGS_SAVE_DELAY = 250
const DEFAULT_SIDEBAR_WIDTH = 277
const SIDEBAR_MIN_WIDTH = 236
const SIDEBAR_MAX_WIDTH = 480
const CHAT_SAVE_DELAY = 500
const MASKED_API_KEY_VALUE = '************'
const DRAFT_LLM_PROFILE_ID = '__draft_llm_profile__'
const SETTINGS_QR_WIDTH = 236
const SETTINGS_QR_MARGIN = 1
const SETTINGS_QR_COLOR = { dark: '#17211e', light: '#ffffff' } as const
app.dataset.platform = isMacPlatform ? 'mac' : 'windows'

type LLMProviderPreset = {
  id: string
  label: string
  baseUrl: string
  wireApi: 'responses' | 'chat_completions'
  model: string
  note: string
  capabilities: LLMCapabilities
}

type LLMProfile = {
  id: string
  name: string
  providerPreset: string
  llmBaseUrl: string
  wireApi: 'responses' | 'chat_completions'
  capabilities: LLMCapabilities
  researchModel: string
  researchReasoningEffort: string
  utilityModel: string
  utilityReasoningEffort: string
  disableResponseStorage: boolean
  hasApiKey?: boolean
  keyFormat?: string
  useForBuyer?: boolean
  useForSeller?: boolean
  createdAt?: string
  updatedAt?: string
}

type LLMProfileStatus = {
  profiles: LLMProfile[]
  activeProfileId?: string
  buyerProfileId?: string
  sellerProfileId?: string
  keyStorageAvailable?: boolean
}

const llmPresets: LLMProviderPreset[] = [
  {
    id: 'openai_responses',
    label: 'OpenAI Responses',
    baseUrl: 'https://api.openai.com/v1',
    wireApi: 'responses',
    model: 'gpt-5.5',
    note: 'Best for latest OpenAI reasoning models. Supports Responses, tools, JSON format, and reasoning effort.',
    capabilities: { supportsResponses: true, supportsChatCompletions: true, supportsSystemMessage: true, supportsJsonResponseFormat: true, supportsStreaming: true, supportsTools: true, supportsReasoningEffort: true },
  },
  {
    id: 'openai_chat',
    label: 'OpenAI Chat Completions',
    baseUrl: 'https://api.openai.com/v1',
    wireApi: 'chat_completions',
    model: 'gpt-4o',
    note: 'Use for OpenAI-compatible chat providers that do not support Responses.',
    capabilities: { supportsResponses: false, supportsChatCompletions: true, supportsSystemMessage: true, supportsJsonResponseFormat: true, supportsStreaming: true, supportsTools: true, supportsReasoningEffort: false },
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    wireApi: 'chat_completions',
    model: '~openai/gpt-latest',
    note: 'Unified hosted gateway for many model providers through Chat Completions.',
    capabilities: { supportsResponses: false, supportsChatCompletions: true, supportsSystemMessage: true, supportsJsonResponseFormat: true, supportsStreaming: true, supportsTools: true, supportsReasoningEffort: false },
  },
  {
    id: 'litellm',
    label: 'LiteLLM Proxy',
    baseUrl: 'http://127.0.0.1:4000/v1',
    wireApi: 'chat_completions',
    model: 'my-model',
    note: 'Self-hosted gateway for routing many providers through one OpenAI-compatible endpoint.',
    capabilities: { supportsResponses: false, supportsChatCompletions: true, supportsSystemMessage: true, supportsJsonResponseFormat: true, supportsStreaming: true, supportsTools: true, supportsReasoningEffort: false },
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    wireApi: 'chat_completions',
    model: 'llama3',
    note: 'Local models. API key can be blank or any placeholder value.',
    capabilities: { supportsResponses: false, supportsChatCompletions: true, supportsSystemMessage: true, supportsJsonResponseFormat: true, supportsStreaming: true, supportsTools: false, supportsReasoningEffort: false },
  },
  {
    id: 'lm_studio',
    label: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    wireApi: 'chat_completions',
    model: 'local-model',
    note: 'Local desktop model server. API key can usually be blank.',
    capabilities: { supportsResponses: false, supportsChatCompletions: true, supportsSystemMessage: true, supportsJsonResponseFormat: true, supportsStreaming: true, supportsTools: false, supportsReasoningEffort: false },
  },
  {
    id: 'vllm',
    label: 'vLLM / llama.cpp / LocalAI',
    baseUrl: 'http://127.0.0.1:8000/v1',
    wireApi: 'chat_completions',
    model: 'local-model',
    note: 'Generic local OpenAI-compatible server. If system messages fail, use LiteLLM or a compatible model template.',
    capabilities: { supportsResponses: false, supportsChatCompletions: true, supportsSystemMessage: true, supportsJsonResponseFormat: true, supportsStreaming: true, supportsTools: false, supportsReasoningEffort: false },
  },
  {
    id: 'textgen',
    label: 'Text Generation WebUI / KoboldCpp',
    baseUrl: 'http://127.0.0.1:5000/v1',
    wireApi: 'chat_completions',
    model: 'local-model',
    note: 'Local model backends often vary by version; test connection after choosing this preset.',
    capabilities: { supportsResponses: false, supportsChatCompletions: true, supportsSystemMessage: true, supportsJsonResponseFormat: true, supportsStreaming: true, supportsTools: false, supportsReasoningEffort: false },
  },
  {
    id: 'custom_openai_compatible',
    label: 'Custom OpenAI-compatible',
    baseUrl: 'http://127.0.0.1:8000/v1',
    wireApi: 'chat_completions',
    model: 'model-id',
    note: 'Use this for any endpoint exposing /v1/chat/completions.',
    capabilities: { supportsResponses: false, supportsChatCompletions: true, supportsSystemMessage: true, supportsJsonResponseFormat: true, supportsStreaming: true, supportsTools: false, supportsReasoningEffort: false },
  },
]

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

const tabIcons: Record<ActiveView, string> = {
  work: icon(SquareKanban),
  market: icon(ShoppingBag),
  chat: icon(MessagesSquare),
  settings: icon(Settings2),
}

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
  forward: icon(ArrowRight),
  back: icon(ArrowLeft),
  disclosure: icon(ChevronRight),
  folder: icon(Folder),
  folderPlus: icon(FolderPlus),
  projectMenu: icon(Ellipsis),
  plus: icon(Plus),
  hand: icon(Hand),
  refresh: icon(RefreshCw),
}

const profileIcons = {
  phone: icon(Smartphone),
  settings: icon(Settings2),
}

const settingsNavIcons: Record<SettingsView, string> = {
  api: icon(KeyRound),
  'buyer-agent': icon(ShoppingCart),
  'buyer-card': icon(IdCard),
  'seller-card': icon(BadgeCheck),
  seller: icon(ShoppingBag),
  pwa: icon(QrCode),
  wallet: icon(WalletCards),
  archives: icon(Archive),
}
const localAgentIcon = icon(Network)

const profileMenuIcons = {
  language: icon(Languages),
  theme: icon(Moon),
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

const DEFAULT_BUYER_AGENT_SETTINGS: BuyerAgentSettings = {
  enabled: true,
  agentId: 'exora-desktop-agent',
}

const BUYER_AGENT_SEARCH_DEFAULTS = {
  negotiationFirst: true,
  maxResults: 8,
  maxCandidates: 3,
  maxOptions: 6,
} as const

const projectFolderMenuIcons = {
  open: icon(FolderOpen),
  rename: icon(PencilLine),
  archive: icon(Archive),
  remove: icon(X),
}

function projectFolderMenuActions(): Array<{ action: ProjectFolderMenuAction; label: string; icon: string }> {
  return [
    { action: 'open', label: t('taskMenu.openProject'), icon: projectFolderMenuIcons.open },
    { action: 'rename', label: t('prompt.renameProject'), icon: projectFolderMenuIcons.rename },
    { action: 'archive', label: translatePhrase('Archive chats'), icon: projectFolderMenuIcons.archive },
    { action: 'remove', label: translatePhrase('Remove'), icon: projectFolderMenuIcons.remove },
  ]
}

const taskMenuIcons: Record<TaskMenuAction, string> = {
  pin: icon(BadgeCheck),
  rename: icon(PencilLine),
  archive: icon(Archive),
  unread: icon(Activity),
  'open-project': icon(FolderOpen),
  'copy-id': icon(Copy),
}

const cardActionIcons = {
  diagnose: icon(Activity),
  save: icon(Save),
  saved: icon(Check),
  publish: icon(BadgeCheck),
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
    <div class="sidebar-chrome">
      <div class="workspace-toolbar" aria-label="Workspace tools">
        <button type="button" data-toolbar-action="search" aria-label="Search" title="Search">${toolbarIcons.search}</button>
        <button type="button" data-toolbar-action="toggle-sidebar" aria-label="Toggle sidebar" title="Toggle sidebar">${toolbarIcons.sidebarExpanded}</button>
        <button type="button" data-toolbar-action="back" aria-label="Back" title="Back">${toolbarIcons.back}</button>
        <button type="button" data-toolbar-action="forward" aria-label="Forward" title="Forward">${toolbarIcons.forward}</button>
      </div>
    </div>
    <div class="sidebar-drag-strip" data-drag-region></div>
    <aside class="task-sidebar">
      <div class="sidebar-resize-handle no-drag" data-sidebar-resize-handle role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin="${SIDEBAR_MIN_WIDTH}" aria-valuemax="${SIDEBAR_MAX_WIDTH}" tabindex="0" title="Resize sidebar"></div>
      <nav class="view-switch" aria-label="Workspace views">
        <div class="view-tab-cell"><button type="button" data-view-tab="chat"><span class="tab-icon">${tabIcons.work}</span><span>Work</span></button></div>
        <div class="view-tab-cell"><button type="button" data-view-tab="market"><span class="tab-icon">${tabIcons.market}</span><span>Market</span></button></div>
        <div class="settings-return-cell"><button type="button" data-action="return-from-settings"><span class="tab-icon">${toolbarIcons.back}</span><span>Return to App</span></button></div>
      </nav>
      <div class="order-role-row">
        <div class="order-role-control">
          <button class="order-side-toggle" type="button" data-order-side-toggle aria-label="Switch order side" title="Switch order side">
            <span class="order-side-track" aria-hidden="true">
              <span class="order-side-knob"></span>
            </span>
          </button>
          <span class="order-side-state" data-order-side-state>Buyer</span>
        </div>
        <button class="folder-picker-button" type="button" data-action="choose-folder" aria-label="Add project folder" title="Add project folder">${toolbarIcons.folderPlus}</button>
      </div>
      <div class="brand-block drag-region" data-drag-region>
        <div class="brand-mark">E</div>
        <div>
          <p class="eyebrow">Exora Dock</p>
          <h1>Agent Workspace</h1>
        </div>
      </div>
      <div class="runtime-line">
        <span class="status-dot" data-daemon>checking</span>
        <button class="tiny-button" data-action="refresh-workspace">Refresh</button>
      </div>
      <div class="project-folder-head" data-project-folder-head>
        <button class="project-folder-toggle" type="button" data-action="toggle-project-folder" aria-expanded="true" title="Collapse folder tasks">
          <span class="project-folder-disclosure">${toolbarIcons.disclosure}</span>
          <span class="project-folder-icon">${toolbarIcons.folder}</span>
          <span data-project-folder-name>AgenStaff_Project</span>
        </button>
        <button class="project-folder-menu-button" type="button" data-action="project-folder-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Project actions" title="Project actions">${toolbarIcons.projectMenu}</button>
        <button class="new-chat-button" type="button" data-action="new-chat" aria-label="New conversation" title="New conversation">${toolbarIcons.plus}</button>
      </div>
      <div class="project-folder-menu hidden" data-project-folder-menu role="menu" aria-label="Project actions"></div>
      <div class="task-context-menu hidden" data-task-context-menu role="menu" aria-label="Task actions"></div>
      <div class="sidebar-section-head">
        <div class="sidebar-section-title">
          <span data-sidebar-title>Order Threads</span>
          <strong data-ledger-count>0</strong>
        </div>
      </div>
      <div class="ledger-list" data-ledger-list>
        <p class="empty-copy ledger-empty-copy">Ask to start</p>
      </div>
      <div class="profile-panel" aria-label="Personal profile">
        <button class="profile-identity" type="button" data-action="open-profile-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Open account menu" title="Account menu">
          <span class="profile-avatar profile-avatar-large" data-profile-avatar>E</span>
          <span class="profile-name" data-profile-name>Exora User</span>
        </button>
        <div class="profile-actions">
          <button class="profile-icon-button" type="button" data-action="open-pwa-link" aria-label="Connect PWA" title="Connect PWA">${profileIcons.phone}</button>
          <button class="profile-icon-button" type="button" data-action="open-api-settings" aria-label="Open settings" title="Settings">${profileIcons.settings}</button>
        </div>
        <div class="profile-menu hidden" data-profile-menu role="menu" aria-label="Account menu"></div>
      </div>
    </aside>

    <section class="main-workspace">
      <header class="main-header drag-region" data-drag-region>
        <div>
          <p class="eyebrow" data-main-kicker>Built-in Market Agent</p>
          <h2 data-decision-title>Ask Exora Dock</h2>
        </div>
        <div class="main-head-actions">
          <span class="mode-pill" data-decision-step>work</span>
          <div class="window-controls ${isMacPlatform ? 'traffic-lights' : ''}" aria-label="Window controls">
            ${windowControlButtons}
          </div>
        </div>
      </header>
      <div class="context-strip" data-context-strip>
        Select order activity on the left, or ask for a capability below.
      </div>
      <section class="workspace-view chat-view" data-view-panel="chat">
        <div class="chat-feed" data-chat-feed aria-live="polite"></div>
        <section class="local-agent-card" data-local-agent-card>
          <div class="local-agent-card-head">
            <span class="local-agent-icon">${localAgentIcon}</span>
            <div>
              <strong>Local agent via MCP</strong>
              <p>Copy a task prompt for an external local agent. It will operate through MCP while this app keeps seller choice, approvals, payment, and secrets under owner control.</p>
            </div>
          </div>
          <div class="local-agent-copy-row">
            <textarea data-local-agent-task rows="2" placeholder="Describe the task your local agent should order or negotiate..."></textarea>
            <div class="composer-footer">
              <button class="composer-action-button local-agent-copy-button" type="button" data-action="copy-local-agent-prompt" aria-label="Copy local agent MCP prompt" title="Copy">${toolbarIcons.copy}</button>
            </div>
          </div>
        </section>
        <div class="work-or-divider" aria-hidden="true"><span>or</span></div>
        <div class="external-work-lock hidden" data-external-work-lock>
          <span data-external-work-lock-text>External local agent is working on this Work.</span>
          <button class="secondary compact-action" type="button" data-action="take-over-work">${toolbarIcons.hand}<span>Take over</span></button>
        </div>
        <form class="chat-composer" data-agent-chat-form>
          <textarea data-agent-query rows="1" placeholder="${agentComposerPlaceholder()}"></textarea>
          <div class="composer-footer">
            <div class="permission-control">
              <button class="permission-button" type="button" data-action="toggle-permission-menu" aria-haspopup="menu" aria-expanded="false" title="Permission mode"></button>
              <div class="permission-menu hidden" data-permission-menu role="menu" aria-label="Permission mode"></div>
            </div>
            <button class="composer-action-button" type="submit" aria-label="Send message" title="Send" data-agent-send>${toolbarIcons.send}</button>
          </div>
        </form>
      </section>
      <section class="workspace-view action-view hidden" data-view-panel="action">
        <div class="decision-content" data-decision-content>
          <p class="empty-copy">Seller choices, approvals, and payment PIN steps appear here.</p>
        </div>
      </section>

      <section class="workspace-view settings-view hidden" data-view-panel="settings">
        <section class="settings-detail">
          <section class="settings-page" data-settings-page="api">
            <div class="api-profiles-section">
              <div class="section-title">
                <strong>API Settings</strong>
                <span data-key-state>No API key saved.</span>
              </div>
              <div class="api-profiles-layout">
                <section class="api-profile-sidebar">
                  <div class="api-profile-list" data-llm-profile-list></div>
                </section>
                <form class="api-settings-form agent-card-form card-setup-list api-profile-config-form" data-llm-form>
                  <label class="card-setup-row card-field-row"><span class="field-label">API name</span><small class="field-help">Display name for this saved API profile.</small><input data-chat-api-field="profileName" placeholder="New API Setting" /></label>
                  <div class="card-setup-row api-check-row api-status-check-row">
                    <span class="field-label">Status</span>
                    <div class="api-check-control api-status-check-control">
                      <strong class="diagnostic-value api-profile-status" data-llm-profile-status>No profile loaded.</strong>
                      <button class="api-form-button" type="button" data-action="test-llm"><span>Check</span></button>
                      <strong class="diagnostic-value test-note api-check-status" data-llm-test-note>Not checked</strong>
                    </div>
                  </div>
                  <label class="card-setup-row card-field-row"><span class="field-label">API key</span><small class="field-help">Leave blank to keep the saved key.</small><input data-chat-api-field="apiKey" type="password" autocomplete="off" placeholder="Leave blank to keep saved key" /></label>
                  <label class="card-setup-row card-field-row inline-check-row">
                    <span class="field-label">Clear key</span>
                    <small class="field-help">Remove the saved key from this profile.</small>
                    <span class="inline-check-control"><input data-chat-api-field="clearApiKey" type="checkbox" /> Clear saved API key</span>
                  </label>
                  <label class="card-setup-row card-field-row"><span class="field-label">API website</span><small class="field-help">OpenAI-compatible endpoint, for example https://api.openai.com/v1.</small><input data-chat-api-field="llmBaseUrl" placeholder="https://api.openai.com/v1" /></label>
                  <div class="api-model-grid">
                    <label class="card-setup-row card-field-row"><span class="field-label">Main model</span><small class="field-help">Used for planning and harder work.</small><input data-chat-api-field="researchModel" list="llm-model-options" placeholder="gpt-5.5" /><datalist id="llm-model-options"></datalist></label>
                    <label class="card-setup-row card-field-row"><span class="field-label">Secondary model</span><small class="field-help">Blank means same as main model.</small><input data-chat-api-field="utilityModel" list="llm-model-options" placeholder="same as main" /></label>
                  </div>
                  <div class="card-setup-row card-field-row inline-check-row">
                    <span class="field-label">Use this setting for</span>
                    <small class="field-help">One setting can serve buyer, seller, or both.</small>
                    <span class="api-role-controls">
                      <label class="api-role-choice"><span class="api-role-text">Buyer</span><input class="api-role-input" data-chat-api-field="useForBuyer" type="checkbox" /><span class="api-role-dot" aria-hidden="true"></span></label>
                      <label class="api-role-choice"><span class="api-role-text">Seller</span><input class="api-role-input" data-chat-api-field="useForSeller" type="checkbox" /><span class="api-role-dot" aria-hidden="true"></span></label>
                    </span>
                  </div>
                  <input data-chat-api-field="providerPreset" type="hidden" />
                  <input data-chat-api-field="wireApi" type="hidden" />
                  <input data-chat-api-field="researchReasoningEffort" type="hidden" value="high" />
                  <input data-chat-api-field="utilityReasoningEffort" type="hidden" value="low" />
                  <input data-chat-api-field="disableResponseStorage" type="checkbox" class="hidden" checked />
                  <span class="hidden" data-provider-note></span>
                  <span class="hidden" data-capability-note></span>
                  <div class="api-form-actions">
                    <button class="api-form-button" type="button" data-action="new-llm-profile">${toolbarIcons.plus}<span>New</span></button>
                    <button class="api-form-button" type="button" data-action="delete-llm-profile"><span>Delete</span></button>
                    <button class="api-form-button primary" type="submit"><span>Save</span></button>
                  </div>
                </form>
              </div>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="pwa">
            <div class="settings-section">
              <div class="section-title">
                <strong>PWA connection</strong>
                <span data-pwa-link-state>not started</span>
              </div>
              <div class="pwa-link-grid settings-qr-layout">
                <div class="pwa-qr-frame settings-qr-frame" data-pwa-qr>
                  <span>QR</span>
                </div>
                <div class="pwa-link-details settings-qr-details">
                  <dl class="compact-list pwa-link-meta settings-qr-meta">
                    <div><dt>User code</dt><dd data-pwa-user-code>not generated</dd></div>
                    <div><dt>Cloud</dt><dd data-pwa-cloud-url>not configured</dd></div>
                    <div><dt>Expires</dt><dd data-pwa-expires>not started</dd></div>
                    <div><dt>Token</dt><dd data-pwa-token-path>local after scan</dd></div>
                  </dl>
                  <p class="muted pwa-link-note" data-pwa-link-note>Start a QR session, then scan it from the Exora PWA Remote Console.</p>
                  <div class="settings-actions two-col pwa-link-actions">
                    <button type="button" data-action="pwa-link-start">New QR</button>
                    <button class="secondary" type="button" data-action="pwa-link-check">Check Link</button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="buyer-agent">
            <div class="settings-section">
              <div class="section-title">
                <strong>Buyer agent</strong>
                <span data-buyer-agent-chip>enabled</span>
              </div>
              <form class="agent-card-form card-setup-list" data-buyer-agent-form>
                <label class="card-setup-row card-field-row inline-check-row">
                  <span class="field-label">Enabled</span>
                  <small class="field-help">Controls the built-in buyer agent composer.</small>
                  <span class="inline-check-control"><input data-buyer-field="enabled" type="checkbox" /> Enable buyer agent</span>
                </label>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">Agent ID</span>
                  <small class="field-help">Written into plans, negotiations, tasks, and approvals.</small>
                  <input data-buyer-field="agentId" placeholder="exora-desktop-agent" />
                </label>
                <div class="card-setup-row card-setup-section-row"><strong>Local MCP entry</strong><span>Use the Work prompt controls to connect Codex, Claude Code, OpenCode, or another local agent.</span></div>
                <button type="submit">Save Buyer Agent</button>
              </form>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="buyer-card">
            <div class="settings-section agent-card-settings-shell" data-settings-card-content="buyer"></div>
          </section>

          <section class="settings-page hidden" data-settings-page="seller-card">
            <div class="settings-section agent-card-settings-shell" data-settings-card-content="seller"></div>
          </section>

          <section class="settings-page hidden" data-settings-page="seller">
            <div class="settings-section">
              <div class="section-title">
                <strong>Seller agent</strong>
                <span data-seller-market-chip>checking</span>
              </div>
              <form class="agent-card-form card-setup-list seller-agent-form" data-seller-form>
                <label class="card-setup-row card-field-row inline-check-row">
                  <span class="field-label">Enabled</span>
                  <small class="field-help">Lets this dock receive requests and quote work as a provider.</small>
                  <span class="inline-check-control"><input type="checkbox" data-field="enabled" /> Enable seller agent</span>
                </label>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">Provider ID</span>
                  <small class="field-help">Public provider identity used in quotes, tasks, and market records.</small>
                  <input data-field="providerId" placeholder="local-dev-miner" />
                </label>
                <div class="card-setup-row card-setup-section-row"><strong>Quote defaults</strong><span>Fallback terms used when the seller agent prepares a quote</span></div>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">ETA seconds</span>
                  <small class="field-help">Default estimated execution time for lightweight tasks.</small>
                  <input data-field="estimatedSeconds" type="number" min="1" step="1" />
                </label>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">Quote price</span>
                  <small class="field-help">Default amount offered before task-specific adjustments.</small>
                  <input data-field="quotePrice" type="number" min="0" step="0.01" />
                </label>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">Currency</span>
                  <small class="field-help">Currency label used in seller quotes.</small>
                  <input data-field="currency" />
                </label>
                <label class="card-setup-row card-field-row inline-check-row">
                  <span class="field-label">Auto quote</span>
                  <small class="field-help">Let the seller agent answer new negotiations without opening this screen.</small>
                  <span class="inline-check-control"><input type="checkbox" data-field="autoQuote" /> Auto quote new tasks</span>
                </label>
                <label class="card-setup-row card-field-row inline-check-row">
                  <span class="field-label">Low-risk auto accept</span>
                  <small class="field-help">Allow automatic acceptance and completion only for low-risk, text-only work.</small>
                  <span class="inline-check-control"><input type="checkbox" data-field="autoAcceptLowRisk" /> Auto accept low-risk work</span>
                </label>
                <button type="submit">Save Seller Agent</button>
              </form>
              <p class="muted">Seller agent uses the LLM provider configured in the API category.</p>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="wallet">
            <div class="settings-section">
              <div class="section-title">
                <strong>USDC receive wallet</strong>
                <span data-wallet-state>checking</span>
              </div>
              <p class="muted">Your Exora account wallet receives USDC on Solana.</p>
              <div class="wallet-receive wallet-dashboard settings-qr-layout" data-wallet-receive>
                <div class="wallet-visual">
                  <div class="wallet-qr settings-qr-frame" data-wallet-qr><span>QR</span></div>
                  <div class="wallet-token-row">
                    <span>USDC</span>
                    <span>Solana</span>
                  </div>
                </div>
                <div class="wallet-details settings-qr-details">
                  <dl class="wallet-metadata settings-qr-meta">
                    <div><dt>Asset</dt><dd>USDC</dd></div>
                    <div><dt>Network</dt><dd>Solana</dd></div>
                    <div><dt>Custody</dt><dd>Account wallet</dd></div>
                  </dl>
                  <div class="wallet-address-card">
                    <span>Deposit address</span>
                    <code data-wallet-address>not configured</code>
                  </div>
                  <div class="settings-actions two-col wallet-actions">
                    <button type="button" data-action="wallet-copy-address">${toolbarIcons.copy}<span>Copy Address</span></button>
                    <button class="secondary" type="button" data-action="wallet-refresh">${toolbarIcons.refresh}<span>Refresh</span></button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="archives">
            <div class="settings-section archive-records-section" data-archive-records>
              <div class="section-title">
                <strong>Archive records</strong>
                <span>local task archive</span>
              </div>
              <p class="muted">Archived Work tasks appear here.</p>
            </div>
          </section>
        </section>
      </section>
    </section>

    <div class="market-project-picker hidden" data-market-project-picker>
      <button class="market-project-scrim" type="button" data-action="close-market-project-picker" aria-label="Close project picker"></button>
      <section class="market-project-dialog" data-market-project-dialog role="dialog" aria-modal="true" aria-label="Choose project"></section>
    </div>

    <div class="toast" data-message>Starting local Dock...</div>

    <template data-legacy-settings-overlay>
      <button class="settings-scrim" data-action="close-settings" aria-label="Close settings"></button>
      <aside class="settings-drawer">
        <nav class="settings-nav">
          <header class="settings-brand">
            <span class="profile-avatar">EX</span>
            <div>
              <p class="eyebrow">Personal Settings</p>
              <h2>Dock Control</h2>
            </div>
          </header>
          <button class="settings-nav-item" data-settings-tab="api" type="button"><span>API</span><small>LLM providers</small></button>
          <button class="settings-nav-item" data-settings-tab="seller" type="button"><span>Seller</span><small>market listing agent</small></button>
          <button class="settings-nav-item" data-settings-tab="wallet" type="button"><span>Wallet</span><small>identity and local access</small></button>
        </nav>

        <section class="settings-detail">
          <header class="settings-head">
            <div>
              <p class="eyebrow" data-settings-kicker>API</p>
              <h2 data-settings-title>LLM Provider</h2>
            </div>
            <button class="icon-button" data-action="close-settings" aria-label="Close settings">x</button>
          </header>

          <section class="settings-page" data-settings-page="api">
            <div class="settings-section">
              <div class="section-title">
                <strong>LLM API</strong>
                <span data-key-state>No API key saved.</span>
              </div>
              <form class="api-settings-form" data-llm-form>
                <label>
                  <span>API name</span>
                  <input data-chat-api-field="profileName" placeholder="New API Setting" />
                </label>
                <label>
                  <span>Provider</span>
                  <select data-chat-api-field="providerPreset">
                    ${llmPresets.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.label)}</option>`).join('')}
                  </select>
                </label>
                <p class="provider-note" data-provider-note></p>
                <label>
                  <span>API key</span>
                  <input data-chat-api-field="apiKey" type="password" autocomplete="off" placeholder="Leave blank to keep saved key" />
                </label>
                <label class="toggle">
                  <input data-chat-api-field="clearApiKey" type="checkbox" />
                  <span>Clear saved API key</span>
                </label>
                <div class="two">
                  <label>
                    <span>Base URL</span>
                    <input data-chat-api-field="llmBaseUrl" placeholder="https://api.openai.com/v1" />
                  </label>
                  <label>
                    <span>Wire API</span>
                    <select data-chat-api-field="wireApi">
                      <option value="responses">Responses</option>
                      <option value="chat_completions">Chat completions</option>
                    </select>
                  </label>
                </div>
                <div class="two">
                  <label>
                    <span>Chat / research model</span>
                    <input data-chat-api-field="researchModel" list="llm-model-options" placeholder="gpt-5.5" />
                  </label>
                  <label>
                    <span>Research effort</span>
                    <input data-chat-api-field="researchReasoningEffort" placeholder="high" />
                  </label>
                </div>
                <div class="two">
                  <label>
                    <span>Utility model</span>
                    <input data-chat-api-field="utilityModel" list="llm-model-options" placeholder="gpt-5.5" />
                    <datalist id="llm-model-options"></datalist>
                  </label>
                  <label>
                    <span>Utility effort</span>
                    <input data-chat-api-field="utilityReasoningEffort" placeholder="low" />
                  </label>
                </div>
                <label class="toggle">
                  <input data-chat-api-field="disableResponseStorage" type="checkbox" />
                  <span>Disable response storage</span>
                </label>
                <p class="capability-note" data-capability-note></p>
                <p class="test-note hidden" data-llm-test-note></p>
                <div class="settings-actions two-col">
                  <button class="secondary" type="button" data-action="test-llm">Test Connection</button>
                  <button class="secondary" type="button" data-action="load-models">Load Models</button>
                </div>
                <button type="submit">Save API Settings</button>
              </form>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="seller">
            <div class="settings-section">
              <div class="section-title">
                <strong>Seller agent</strong>
                <span data-seller-market-chip>checking</span>
              </div>
              <form class="agent-card-form card-setup-list seller-agent-form" data-seller-form>
                <label class="card-setup-row card-field-row inline-check-row">
                  <span class="field-label">Enabled</span>
                  <small class="field-help">Lets this dock receive requests and quote work as a provider.</small>
                  <span class="inline-check-control"><input type="checkbox" data-field="enabled" /> Enable seller agent</span>
                </label>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">Provider ID</span>
                  <small class="field-help">Public provider identity used in quotes, tasks, and market records.</small>
                  <input data-field="providerId" placeholder="local-dev-miner" />
                </label>
                <div class="card-setup-row card-setup-section-row"><strong>Quote defaults</strong><span>Fallback terms used when the seller agent prepares a quote</span></div>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">ETA seconds</span>
                  <small class="field-help">Default estimated execution time for lightweight tasks.</small>
                  <input data-field="estimatedSeconds" type="number" min="1" step="1" />
                </label>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">Quote price</span>
                  <small class="field-help">Default amount offered before task-specific adjustments.</small>
                  <input data-field="quotePrice" type="number" min="0" step="0.01" />
                </label>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">Currency</span>
                  <small class="field-help">Currency label used in seller quotes.</small>
                  <input data-field="currency" />
                </label>
                <label class="card-setup-row card-field-row inline-check-row">
                  <span class="field-label">Auto quote</span>
                  <small class="field-help">Let the seller agent answer new negotiations without opening this screen.</small>
                  <span class="inline-check-control"><input type="checkbox" data-field="autoQuote" /> Auto quote new tasks</span>
                </label>
                <label class="card-setup-row card-field-row inline-check-row">
                  <span class="field-label">Low-risk auto accept</span>
                  <small class="field-help">Allow automatic acceptance and completion only for low-risk, text-only work.</small>
                  <span class="inline-check-control"><input type="checkbox" data-field="autoAcceptLowRisk" /> Auto accept low-risk work</span>
                </label>
                <button type="submit">Save Seller Agent</button>
              </form>
              <p class="muted">Seller agent uses the LLM provider configured in the API category.</p>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="wallet">
            <div class="settings-section">
              <div class="section-title">
                <strong>USDC receive wallet</strong>
                <span data-wallet-state>checking</span>
              </div>
              <p class="muted">Your Exora account wallet receives USDC on Solana.</p>
              <div class="wallet-receive wallet-dashboard settings-qr-layout" data-wallet-receive>
                <div class="wallet-visual">
                  <div class="wallet-qr settings-qr-frame" data-wallet-qr><span>QR</span></div>
                  <div class="wallet-token-row">
                    <span>USDC</span>
                    <span>Solana</span>
                  </div>
                </div>
                <div class="wallet-details settings-qr-details">
                  <dl class="wallet-metadata settings-qr-meta">
                    <div><dt>Asset</dt><dd>USDC</dd></div>
                    <div><dt>Network</dt><dd>Solana</dd></div>
                    <div><dt>Custody</dt><dd>Account wallet</dd></div>
                  </dl>
                  <div class="wallet-address-card">
                    <span>Deposit address</span>
                    <code data-wallet-address>not configured</code>
                  </div>
                  <div class="settings-actions two-col wallet-actions">
                    <button type="button" data-action="wallet-copy-address">${toolbarIcons.copy}<span>Copy Address</span></button>
                    <button class="secondary" type="button" data-action="wallet-refresh">${toolbarIcons.refresh}<span>Refresh</span></button>
                  </div>
                </div>
              </div>
            </div>
          </section>

        </section>
      </aside>
    </template>
  </main>
`

const fields = {
  appShell: app.querySelector<HTMLElement>('.app-shell')!,
  daemon: app.querySelector<HTMLElement>('[data-daemon]')!,
  message: app.querySelector<HTMLElement>('[data-message]')!,
  keyState: app.querySelector<HTMLElement>('[data-key-state]')!,
  buyerAgentChip: app.querySelector<HTMLElement>('[data-buyer-agent-chip]')!,
  sellerMarketChip: app.querySelector<HTMLElement>('[data-seller-market-chip]')!,
  profileIdentity: app.querySelector<HTMLButtonElement>('[data-action="open-profile-menu"]')!,
  profileAvatar: app.querySelector<HTMLElement>('[data-profile-avatar]')!,
  profileName: app.querySelector<HTMLElement>('[data-profile-name]')!,
  profileMenu: app.querySelector<HTMLElement>('[data-profile-menu]')!,
  projectFolderHead: app.querySelector<HTMLElement>('[data-project-folder-head]')!,
  projectFolderToggle: app.querySelector<HTMLButtonElement>('[data-action="toggle-project-folder"]')!,
  projectFolderName: app.querySelector<HTMLElement>('[data-project-folder-name]')!,
  projectFolderMenuButton: app.querySelector<HTMLButtonElement>('[data-action="project-folder-menu"]')!,
  projectFolderMenu: app.querySelector<HTMLElement>('[data-project-folder-menu]')!,
  taskContextMenu: app.querySelector<HTMLElement>('[data-task-context-menu]')!,
  orderSideToggle: app.querySelector<HTMLButtonElement>('[data-order-side-toggle]')!,
  orderSideState: app.querySelector<HTMLElement>('[data-order-side-state]')!,
  orderRoleRow: app.querySelector<HTMLElement>('.order-role-row')!,
  folderPickerButton: app.querySelector<HTMLButtonElement>('[data-action="choose-folder"]')!,
  sidebarSectionHead: app.querySelector<HTMLElement>('.sidebar-section-head')!,
  sidebarTitle: app.querySelector<HTMLElement>('[data-sidebar-title]')!,
  ledgerList: app.querySelector<HTMLElement>('[data-ledger-list]')!,
  ledgerCount: app.querySelector<HTMLElement>('[data-ledger-count]')!,
  newChatButton: app.querySelector<HTMLButtonElement>('[data-action="new-chat"]')!,
  settingsReturnButton: app.querySelector<HTMLButtonElement>('[data-action="return-from-settings"]')!,
  localAgentCard: app.querySelector<HTMLElement>('[data-local-agent-card]')!,
  localAgentTask: app.querySelector<HTMLTextAreaElement>('[data-local-agent-task]')!,
  localAgentCopyButton: app.querySelector<HTMLButtonElement>('[data-action="copy-local-agent-prompt"]')!,
  externalWorkLock: app.querySelector<HTMLElement>('[data-external-work-lock]')!,
  externalWorkLockText: app.querySelector<HTMLElement>('[data-external-work-lock-text]')!,
  externalWorkTakeoverButton: app.querySelector<HTMLButtonElement>('[data-action="take-over-work"]')!,
  permissionButton: app.querySelector<HTMLButtonElement>('[data-action="toggle-permission-menu"]')!,
  permissionMenu: app.querySelector<HTMLElement>('[data-permission-menu]')!,
  chatFeed: app.querySelector<HTMLElement>('[data-chat-feed]')!,
  contextStrip: app.querySelector<HTMLElement>('[data-context-strip]')!,
  mainKicker: app.querySelector<HTMLElement>('[data-main-kicker]')!,
  decisionTitle: app.querySelector<HTMLElement>('[data-decision-title]')!,
  decisionStep: app.querySelector<HTMLElement>('[data-decision-step]')!,
  decisionContent: app.querySelector<HTMLElement>('[data-decision-content]')!,
  chatView: app.querySelector<HTMLElement>('[data-view-panel="chat"]')!,
  actionView: app.querySelector<HTMLElement>('[data-view-panel="action"]')!,
  settingsView: app.querySelector<HTMLElement>('[data-view-panel="settings"]')!,
  marketProjectPicker: app.querySelector<HTMLElement>('[data-market-project-picker]')!,
  marketProjectDialog: app.querySelector<HTMLElement>('[data-market-project-dialog]')!,
  backButton: app.querySelector<HTMLButtonElement>('[data-toolbar-action="back"]')!,
  forwardButton: app.querySelector<HTMLButtonElement>('[data-toolbar-action="forward"]')!,
  sidebarButton: app.querySelector<HTMLButtonElement>('[data-toolbar-action="toggle-sidebar"]')!,
  sidebarResizeHandle: app.querySelector<HTMLElement>('[data-sidebar-resize-handle]')!,
  providerNote: app.querySelector<HTMLElement>('[data-provider-note]')!,
  capabilityNote: app.querySelector<HTMLElement>('[data-capability-note]')!,
  llmTestNote: app.querySelector<HTMLElement>('[data-llm-test-note]')!,
  llmProfileList: app.querySelector<HTMLElement>('[data-llm-profile-list]')!,
  llmProfileStatus: app.querySelector<HTMLElement>('[data-llm-profile-status]')!,
  walletState: app.querySelector<HTMLElement>('[data-wallet-state]')!,
  walletReceive: app.querySelector<HTMLElement>('[data-wallet-receive]')!,
  walletQR: app.querySelector<HTMLElement>('[data-wallet-qr]')!,
  walletAddress: app.querySelector<HTMLElement>('[data-wallet-address]')!,
  walletCopyButton: app.querySelector<HTMLButtonElement>('[data-action="wallet-copy-address"]')!,
  pwaLinkState: app.querySelector<HTMLElement>('[data-pwa-link-state]')!,
  pwaQR: app.querySelector<HTMLElement>('[data-pwa-qr]')!,
  pwaUserCode: app.querySelector<HTMLElement>('[data-pwa-user-code]')!,
  pwaCloudURL: app.querySelector<HTMLElement>('[data-pwa-cloud-url]')!,
  pwaExpires: app.querySelector<HTMLElement>('[data-pwa-expires]')!,
  pwaTokenPath: app.querySelector<HTMLElement>('[data-pwa-token-path]')!,
  pwaLinkNote: app.querySelector<HTMLElement>('[data-pwa-link-note]')!,
  archiveRecords: app.querySelector<HTMLElement>('[data-archive-records]')!,
}

const buyerAgentForm = app.querySelector<HTMLFormElement>('[data-buyer-agent-form]')!
const sellerForm = app.querySelector<HTMLFormElement>('[data-seller-form]')!
const llmSettingsForm = app.querySelector<HTMLFormElement>('[data-llm-form]')!
const agentChatForm = app.querySelector<HTMLFormElement>('[data-agent-chat-form]')!
const agentQuery = app.querySelector<HTMLTextAreaElement>('[data-agent-query]')!
const agentSendButton = app.querySelector<HTMLButtonElement>('[data-agent-send]')!

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
  return localStorage.getItem('exora.theme') === 'dark' ? 'dark' : 'light'
}

function storedTheme(): AppTheme {
  return hasDesktopBridge() ? 'light' : legacyStoredTheme()
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

function normalizeBuyerAgentSettings(value: unknown): BuyerAgentSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<BuyerAgentSettings>
    : {}
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_BUYER_AGENT_SETTINGS.enabled,
    agentId: String(input.agentId || '').trim() || DEFAULT_BUYER_AGENT_SETTINGS.agentId,
  }
}

function legacyStoredBuyerAgentSettings(): BuyerAgentSettings {
  try {
    return normalizeBuyerAgentSettings(JSON.parse(localStorage.getItem('exora.buyerAgentSettings') || '{}'))
  } catch {
    return normalizeBuyerAgentSettings({})
  }
}

function storedBuyerAgentSettings(): BuyerAgentSettings {
  return hasDesktopBridge() ? normalizeBuyerAgentSettings({}) : legacyStoredBuyerAgentSettings()
}

function normalizeArchivedRecord(value: unknown): ArchivedWorkRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Partial<ArchivedWorkRecord>
  const threadId = String(record.threadId || '').trim()
  const projectPath = String(record.projectPath || '').trim()
  if (!threadId || !projectPath) return undefined
  const sourceKind = record.sourceKind === 'order' || record.sourceKind === 'task' || record.sourceKind === 'approval' || record.sourceKind === 'payment' ? record.sourceKind : 'chat'
  const title = String(record.title || threadId).trim() || threadId
  const projectName = String(record.projectName || projectPath.split(/[\\/]/).filter(Boolean).pop() || 'project').trim()
  return {
    id: String(record.id || `archive-${threadId}`).trim(),
    threadId,
    title,
    projectPath,
    projectName,
    archivedAt: String(record.archivedAt || new Date().toISOString()),
    sourceKind,
    side: record.side === 'seller' ? 'seller' : record.side === 'buyer' ? 'buyer' : undefined,
    status: record.status ? String(record.status) : undefined,
    chatSnapshot: record.chatSnapshot && typeof record.chatSnapshot === 'object' && !Array.isArray(record.chatSnapshot) ? cloneChatThread(record.chatSnapshot as ChatThread) : undefined,
  }
}

function emptyWorkTaskState(): WorkTaskState {
  return { pinnedIds: new Set(), unreadIds: new Set(), titleOverrides: {}, archivedRecords: [] }
}

function normalizeWorkTaskStateValue(value: unknown): WorkTaskState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyWorkTaskState()
  const parsed = value as {
    pinnedIds?: unknown
    unreadIds?: unknown
    titleOverrides?: unknown
    archivedRecords?: unknown
  }
  const titleOverrides: Record<string, string> = {}
  if (parsed.titleOverrides && typeof parsed.titleOverrides === 'object' && !Array.isArray(parsed.titleOverrides)) {
    for (const [key, override] of Object.entries(parsed.titleOverrides)) {
      const title = String(override || '').trim()
      if (key && title) titleOverrides[key] = title
    }
  }
  return {
    pinnedIds: new Set(Array.isArray(parsed.pinnedIds) ? parsed.pinnedIds.map(String).filter(Boolean) : []),
    unreadIds: new Set(Array.isArray(parsed.unreadIds) ? parsed.unreadIds.map(String).filter(Boolean) : []),
    titleOverrides,
    archivedRecords: Array.isArray(parsed.archivedRecords)
      ? parsed.archivedRecords.map(normalizeArchivedRecord).filter((record): record is ArchivedWorkRecord => Boolean(record))
      : [],
  }
}

function legacyStoredWorkTaskState(): WorkTaskState {
  try {
    return normalizeWorkTaskStateValue(JSON.parse(localStorage.getItem(WORK_TASK_STATE_KEY) || '{}'))
  } catch {
    return emptyWorkTaskState()
  }
}

function storedWorkTaskState(): WorkTaskState {
  return hasDesktopBridge() ? emptyWorkTaskState() : legacyStoredWorkTaskState()
}

function persistedWorkTaskStateSnapshot(): PersistedWorkTaskState {
  return {
    pinnedIds: [...state.workTaskState.pinnedIds],
    unreadIds: [...state.workTaskState.unreadIds],
    titleOverrides: state.workTaskState.titleOverrides,
    archivedRecords: state.workTaskState.archivedRecords,
  }
}

function saveWorkTaskState() {
  const snapshot = persistedWorkTaskStateSnapshot()
  if (!hasDesktopBridge()) {
    localStorage.setItem(WORK_TASK_STATE_KEY, JSON.stringify(snapshot))
  }
  scheduleSaveAppSettings()
}

const state: {
  busy: boolean
  profileMenuOpen: boolean
  profileSubmenu?: ProfileSubmenu
  permissionMenuOpen: boolean
  permissionMode: PermissionMode
  signedOut: boolean
  language: AppLanguage
  theme: AppTheme
  orderPlans: OrderPlan[]
  approvals: Approval[]
  tasks: Task[]
  payments: PaymentRecord[]
  buyerAgentSettings: BuyerAgentSettings
  sellerSettings?: SellerSettings
  sellerMarketStatus?: SellerMarketStatus
  agentCards: AgentCardsMine
  cardDrafts: Partial<Record<AgentCardRole, AgentCard>>
  cardDiagnosticsTasks: Partial<Record<AgentCardRole, CardDiagnosticsTask>>
  activeCardEditor?: AgentCardRole
  cardMessage?: string
  marketDetailProvider?: string
  marketProjectPickerProvider?: string
  llmTestMessage?: string
  llmTestStatus?: LLMTestStatus
  llmModels: string[]
  llmProfiles: LLMProfile[]
  activeLLMProfileId?: string
  buyerLLMProfileId?: string
  sellerLLMProfileId?: string
  editingLLMProfileId?: string
  llmDraftProfile?: LLMProfile
  llmKeyStorageAvailable: boolean
  activeSettingsView: SettingsView
  walletStatus?: WalletStatus
  pwaLink?: PwaLinkStatus
  pwaLinkMessage?: string
  appStatus?: AppStatus
  projectFolder?: ProjectFolder
  projectFolders: ProjectFolder[]
  activeProjectFolderPath?: string
  mcpConnections: MCPConnection[]
  workMcpLeases: WorkMCPLease[]
  workRuns: WorkRun[]
  workRunEvents: Record<string, WorkRunEvent[]>
  workspaceOnline: boolean
  workspaceErrors: string[]
  expandedProjectFolderPaths: Set<string>
  seenProjectFolderPaths: Set<string>
  projectFolderCollapsed: boolean
  projectFolderMenuOpen: boolean
  projectFolderMenuPosition?: { x: number; y: number }
  taskMenuOpen: boolean
  taskMenuThreadId?: string
  taskMenuPosition?: { x: number; y: number }
  workTaskState: WorkTaskState
  activeView: ActiveView
  chatMode: ChatMode
  workOrderSide: OrderSide
  marketOrderSide: OrderSide
  sidebarCollapsed: boolean
  sidebarWidth: number
  viewHistory: ActiveView[]
  viewHistoryIndex: number
  selectedId?: string
  selectedChatId?: string
  selectedWorkThreadId?: string
  marketSelectedId?: string
  newConversationDraft: boolean
  chatThreads: ChatThread[]
  pinStep?: PinStep
  seenPlanIds: Set<string>
  seenApprovalIds: Set<string>
  statusLoading: boolean
  workspaceLoading: boolean
} = {
  busy: false,
  profileMenuOpen: false,
  profileSubmenu: undefined,
  permissionMenuOpen: false,
  permissionMode: storedPermissionMode(),
  signedOut: false,
  language: storedLanguage(),
  theme: storedTheme(),
  orderPlans: [],
  approvals: [],
  tasks: [],
  payments: [],
  buyerAgentSettings: storedBuyerAgentSettings(),
  llmModels: [],
  llmProfiles: [],
  activeLLMProfileId: undefined,
  buyerLLMProfileId: undefined,
  sellerLLMProfileId: undefined,
  editingLLMProfileId: undefined,
  llmDraftProfile: undefined,
  llmKeyStorageAvailable: false,
  agentCards: {},
  cardDrafts: {},
  cardDiagnosticsTasks: {},
  llmTestStatus: undefined,
  activeSettingsView: 'api',
  projectFolders: [],
  mcpConnections: [],
  workMcpLeases: [],
  workRuns: [],
  workRunEvents: {},
  workspaceOnline: true,
  workspaceErrors: [],
  expandedProjectFolderPaths: new Set(),
  seenProjectFolderPaths: new Set(),
  projectFolderCollapsed: false,
  projectFolderMenuOpen: false,
  projectFolderMenuPosition: undefined,
  taskMenuOpen: false,
  taskMenuThreadId: undefined,
  taskMenuPosition: undefined,
  workTaskState: storedWorkTaskState(),
  activeView: 'chat',
  chatMode: 'expanded',
  workOrderSide: 'buyer',
  marketOrderSide: 'buyer',
  sidebarCollapsed: false,
  sidebarWidth: storedSidebarWidth(),
  viewHistory: ['chat'],
  viewHistoryIndex: 0,
  newConversationDraft: true,
  chatThreads: [],
  seenPlanIds: new Set(),
  seenApprovalIds: new Set(),
  statusLoading: false,
  workspaceLoading: false,
}

let pwaLinkPollTimer: number | undefined
let transactionProgressPollTimer: number | undefined
let transactionProgressPollKey = ''
let cardDiagnosticsTaskSequence = 0
let settingsPersistenceReady = false
let appSettingsSaveTimer: number | undefined
let lastTransactionsFingerprint = ''
let sidebarResizePointerId: number | undefined
const chatSaveTimers = new Map<string, number>()
const chatSaveQueues = new Map<string, Promise<void>>()
const threadStorageKeys = new Map<string, string>()

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
  return value === 'light' || value === 'dark'
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'ask' || value === 'approve' || value === 'full' || value === 'custom'
}

function isOrderSide(value: unknown): value is OrderSide {
  return value === 'buyer' || value === 'seller'
}

function normalizeSettingsView(value: unknown): SettingsView | undefined {
  if (value === 'security') return 'wallet'
  if (value === 'diagnostics' || value === 'runtime') return 'api'
  if (value === 'api' || value === 'buyer-agent' || value === 'buyer-card' || value === 'seller-card' || value === 'seller' || value === 'pwa' || value === 'wallet' || value === 'archives') {
    return value
  }
  return undefined
}

function isSettingsView(value: unknown): value is SettingsView {
  return normalizeSettingsView(value) === value
}

function legacyAppSettingsSnapshot(): PersistedAppSettings {
  return {
    language: legacyStoredLanguage(),
    theme: legacyStoredTheme(),
    permissionMode: legacyStoredPermissionMode(),
    buyerAgentSettings: legacyStoredBuyerAgentSettings(),
    sidebarWidth: legacyStoredSidebarWidth(),
    workTaskState: workTaskStateToPersisted(legacyStoredWorkTaskState()),
  }
}

function normalizePersistedSettings(value: unknown): PersistedAppSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as PersistedAppSettings : {}
  return {
    language: isAppLanguage(input.language) ? input.language : undefined,
    theme: isAppTheme(input.theme) ? input.theme : undefined,
    permissionMode: isPermissionMode(input.permissionMode) ? input.permissionMode : undefined,
    buyerAgentSettings: input.buyerAgentSettings && typeof input.buyerAgentSettings === 'object' ? normalizeBuyerAgentSettings(input.buyerAgentSettings) : undefined,
    activeSettingsView: normalizeSettingsView(input.activeSettingsView),
    workOrderSide: isOrderSide(input.workOrderSide) ? input.workOrderSide : undefined,
    marketOrderSide: isOrderSide(input.marketOrderSide) ? input.marketOrderSide : undefined,
    sidebarCollapsed: typeof input.sidebarCollapsed === 'boolean' ? input.sidebarCollapsed : undefined,
    sidebarWidth: input.sidebarWidth === undefined ? undefined : normalizeSidebarWidth(input.sidebarWidth),
    projectFolderCollapsed: typeof input.projectFolderCollapsed === 'boolean' ? input.projectFolderCollapsed : undefined,
    expandedProjectFolderPaths: Array.isArray(input.expandedProjectFolderPaths) ? input.expandedProjectFolderPaths.map(String).filter(Boolean) : undefined,
    seenProjectFolderPaths: Array.isArray(input.seenProjectFolderPaths) ? input.seenProjectFolderPaths.map(String).filter(Boolean) : undefined,
    workTaskState: input.workTaskState && typeof input.workTaskState === 'object' ? input.workTaskState : undefined,
  }
}

function mergePersistedSettings(fallback: PersistedAppSettings, value: PersistedAppSettings): PersistedAppSettings {
  return {
    language: value.language ?? fallback.language,
    theme: value.theme ?? fallback.theme,
    permissionMode: value.permissionMode ?? fallback.permissionMode,
    buyerAgentSettings: value.buyerAgentSettings ?? fallback.buyerAgentSettings,
    activeSettingsView: value.activeSettingsView ?? fallback.activeSettingsView,
    workOrderSide: value.workOrderSide ?? fallback.workOrderSide,
    marketOrderSide: value.marketOrderSide ?? fallback.marketOrderSide,
    sidebarCollapsed: value.sidebarCollapsed ?? fallback.sidebarCollapsed,
    sidebarWidth: value.sidebarWidth ?? fallback.sidebarWidth,
    projectFolderCollapsed: value.projectFolderCollapsed ?? fallback.projectFolderCollapsed,
    expandedProjectFolderPaths: value.expandedProjectFolderPaths ?? fallback.expandedProjectFolderPaths,
    seenProjectFolderPaths: value.seenProjectFolderPaths ?? fallback.seenProjectFolderPaths,
    workTaskState: value.workTaskState ?? fallback.workTaskState,
  }
}

function workTaskStateToPersisted(value: WorkTaskState): PersistedWorkTaskState {
  return {
    pinnedIds: [...value.pinnedIds],
    unreadIds: [...value.unreadIds],
    titleOverrides: value.titleOverrides,
    archivedRecords: value.archivedRecords,
  }
}

function applyPersistedSettings(settings: PersistedAppSettings) {
  if (settings.language) state.language = settings.language
  if (settings.theme) state.theme = settings.theme
  if (settings.permissionMode) state.permissionMode = settings.permissionMode
  if (settings.buyerAgentSettings) state.buyerAgentSettings = normalizeBuyerAgentSettings(settings.buyerAgentSettings)
  if (settings.activeSettingsView) state.activeSettingsView = settings.activeSettingsView
  if (settings.workOrderSide) state.workOrderSide = settings.workOrderSide
  if (settings.marketOrderSide) state.marketOrderSide = settings.marketOrderSide
  if (typeof settings.sidebarCollapsed === 'boolean') state.sidebarCollapsed = settings.sidebarCollapsed
  if (typeof settings.sidebarWidth === 'number') state.sidebarWidth = normalizeSidebarWidth(settings.sidebarWidth)
  if (typeof settings.projectFolderCollapsed === 'boolean') state.projectFolderCollapsed = settings.projectFolderCollapsed
  if (settings.expandedProjectFolderPaths) state.expandedProjectFolderPaths = new Set(settings.expandedProjectFolderPaths.map(projectPathKey).filter(Boolean))
  if (settings.seenProjectFolderPaths) state.seenProjectFolderPaths = new Set(settings.seenProjectFolderPaths.map(projectPathKey).filter(Boolean))
  if (settings.workTaskState) state.workTaskState = normalizeWorkTaskStateValue(settings.workTaskState)
}

function appSettingsSnapshot(): PersistedAppSettings {
  return {
    language: state.language,
    theme: state.theme,
    permissionMode: state.permissionMode,
    buyerAgentSettings: state.buyerAgentSettings,
    activeSettingsView: state.activeSettingsView,
    workOrderSide: state.workOrderSide,
    marketOrderSide: state.marketOrderSide,
    sidebarCollapsed: state.sidebarCollapsed,
    sidebarWidth: state.sidebarWidth,
    projectFolderCollapsed: state.projectFolderCollapsed,
    expandedProjectFolderPaths: [...state.expandedProjectFolderPaths],
    seenProjectFolderPaths: [...state.seenProjectFolderPaths],
    workTaskState: persistedWorkTaskStateSnapshot(),
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
    localStorage.setItem('exora.permissionMode', settings.permissionMode || 'ask')
    localStorage.setItem('exora.sidebarWidth', String(settings.sidebarWidth || DEFAULT_SIDEBAR_WIDTH))
    localStorage.setItem('exora.buyerAgentSettings', JSON.stringify(settings.buyerAgentSettings || {}))
    localStorage.setItem(WORK_TASK_STATE_KEY, JSON.stringify(settings.workTaskState || {}))
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
    settingsPersistenceReady = true
    return
  }
  try {
    const payload = await invoke<DesktopPersistenceLoad>('desktop_persistence_load')
    applyPersistedSettings(mergePersistedSettings(legacyAppSettingsSnapshot(), normalizePersistedSettings(payload.settings)))
    restorePersistedConversations(payload.conversations || [])
  } catch (error) {
    console.warn('Failed to load desktop persistence:', error)
  } finally {
    settingsPersistenceReady = true
    scheduleSaveAppSettings(0)
  }
}

function restorePersistedConversations(records: DesktopConversationRecord[]) {
  const byId = new Map<string, ChatThread>()
  const folders: ProjectFolder[] = []
  for (const record of records) {
    const thread = normalizeChatThreadForState(record.thread)
    if (!thread || thread.messages.length === 0) continue
    const existing = byId.get(thread.id)
    if (!existing || thread.updatedAt > existing.updatedAt || thread.messages.length > existing.messages.length) {
      byId.set(thread.id, thread)
      threadStorageKeys.set(thread.id, String(record.storageKey || conversationStorageKey(thread)).trim())
    }
    if (thread.projectPath) {
      const folder = normalizeProjectFolder({ path: thread.projectPath })
      if (folder && !folders.some((item) => sameProjectPath(item.path, folder.path))) folders.push(folder)
    }
  }
  const threads = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  state.chatThreads = threads
  if (folders.length) setProjectFolders(folders, state.activeProjectFolderPath || folders[0].path)
  if (threads.length && !state.selectedChatId) {
    state.newConversationDraft = false
    state.selectedChatId = threads[0].id
    state.selectedWorkThreadId = workThreadIdForChat(threads[0])
  }
}

function normalizeChatThreadForState(value: unknown): ChatThread | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Partial<ChatThread>
  const id = String(input.id || '').trim()
  if (!id) return undefined
  const now = Date.now()
  const messages = Array.isArray(input.messages)
    ? input.messages.map(normalizeChatMessageForState).filter((message): message is ChatMessage => Boolean(message))
    : []
  return {
    id,
    title: String(input.title || 'New chat').trim() || 'New chat',
    messages,
    createdAt: Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : now,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : now,
    projectPath: String(input.projectPath || '').trim() || undefined,
    origin: input.origin === 'market-card' ? 'market-card' : undefined,
    orderId: String(input.orderId || '').trim() || undefined,
    taskIds: Array.isArray(input.taskIds) ? input.taskIds.map(String).filter(Boolean) : [],
    status: String(input.status || '').trim() || undefined,
    participants: Array.isArray(input.participants) ? input.participants.filter((item): item is NonNullable<ChatThread['participants']>[number] => item === 'buyer_agent' || item === 'seller_agent' || item === 'buyer_human' || item === 'seller_human') : ['buyer_human', 'buyer_agent', 'seller_agent'],
    providerPubkey: String(input.providerPubkey || '').trim() || undefined,
  }
}

function normalizeChatMessageForState(value: unknown): ChatMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Partial<ChatMessage>
  const id = String(input.id || '').trim()
  if (!id || (input.role !== 'assistant' && input.role !== 'user' && input.role !== 'system')) return undefined
  return {
    id,
    kind: input.kind === 'order_event' ? 'order_event' : input.kind === 'message' ? 'message' : undefined,
    role: input.role,
    actor: input.actor === 'buyer_agent' || input.actor === 'seller_agent' || input.actor === 'buyer_human' || input.actor === 'seller_human' ? input.actor : undefined,
    text: String(input.text || ''),
    meta: String(input.meta || '').trim() || undefined,
    providerPubkey: String(input.providerPubkey || '').trim() || undefined,
    eventRef: input.eventRef && typeof input.eventRef === 'object' ? { ...input.eventRef } : undefined,
    result: input.result && typeof input.result === 'object' ? input.result : undefined,
    pending: input.pending === true,
  }
}

function conversationStorageKey(thread: ChatThread) {
  const taskId = (thread.taskIds || []).map(String).find(Boolean)
  if (taskId) return `task:${taskId}`
  if (thread.orderId) return `order:${thread.orderId}`
  return `chat:${thread.id}`
}

function scheduleSaveChatThread(thread?: ChatThread, delay = CHAT_SAVE_DELAY) {
  if (!thread?.messages.length || !hasDesktopBridge()) return
  const existing = chatSaveTimers.get(thread.id)
  if (existing !== undefined) window.clearTimeout(existing)
  const timer = window.setTimeout(() => {
    chatSaveTimers.delete(thread.id)
    void saveChatThreadNow(thread)
  }, delay)
  chatSaveTimers.set(thread.id, timer)
}

function flushSaveChatThread(thread?: ChatThread) {
  if (!thread?.messages.length || !hasDesktopBridge()) return undefined
  const existing = chatSaveTimers.get(thread.id)
  if (existing !== undefined) {
    window.clearTimeout(existing)
    chatSaveTimers.delete(thread.id)
  }
  return saveChatThreadNow(thread)
}

async function saveChatThreadNow(thread: ChatThread) {
  const storageKey = conversationStorageKey(thread)
  const previousStorageKey = threadStorageKeys.get(thread.id)
  const previousStorageKeys = previousStorageKey && previousStorageKey !== storageKey ? [previousStorageKey] : []
  const snapshot = cloneChatThread(thread)
  threadStorageKeys.set(thread.id, storageKey)
  const previousQueue = chatSaveQueues.get(thread.id) || Promise.resolve()
  const nextQueue = previousQueue.catch(() => undefined).then(async () => {
    try {
      const result = await invoke<{ storageKey?: string }>('save_chat_thread', {
        input: { thread: snapshot, previousStorageKeys },
      })
      threadStorageKeys.set(thread.id, result.storageKey || storageKey)
    } catch (error) {
      console.warn('Failed to save chat thread:', error)
    }
  })
  chatSaveQueues.set(thread.id, nextQueue)
  await nextQueue
}

function clearChatPersistenceState() {
  for (const timer of chatSaveTimers.values()) window.clearTimeout(timer)
  chatSaveTimers.clear()
  chatSaveQueues.clear()
  threadStorageKeys.clear()
}

async function flushAllChatSaves() {
  if (!hasDesktopBridge()) return
  const saves = state.chatThreads.map((thread) => flushSaveChatThread(thread)).filter((save): save is Promise<void> => Boolean(save))
  await Promise.all(saves)
  await Promise.all([...chatSaveQueues.values()])
}

function setActiveView(view: ActiveView, options: { recordHistory?: boolean } = {}) {
  if (view !== 'market') state.marketDetailProvider = undefined
  if (view !== 'market') state.marketProjectPickerProvider = undefined
  if (view === 'market' || view === 'settings') closeTaskContextMenu(false)
  if (state.activeView === view) return
  state.activeView = view
  if (options.recordHistory === false) return
  state.viewHistory = state.viewHistory.slice(0, state.viewHistoryIndex + 1)
  if (state.viewHistory[state.viewHistory.length - 1] !== view) {
    state.viewHistory.push(view)
  }
  state.viewHistoryIndex = state.viewHistory.length - 1
}

function navigateWorkspaceHistory(delta: -1 | 1) {
  if (delta === -1 && state.activeView === 'market' && state.marketDetailProvider) {
    state.marketDetailProvider = undefined
    renderAll()
    return
  }
  const nextIndex = state.viewHistoryIndex + delta
  if (nextIndex < 0 || nextIndex >= state.viewHistory.length) return
  state.viewHistoryIndex = nextIndex
  state.activeView = state.viewHistory[nextIndex]
  if (state.activeView !== 'market') state.marketProjectPickerProvider = undefined
  state.selectedId = defaultSelectionForView(state.activeView)
  state.pinStep = undefined
  renderAll()
  if (state.activeView === 'settings') refreshSettingsStatus()
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
  fields.appShell.classList.toggle('sidebar-collapsed', state.sidebarCollapsed)
  fields.sidebarButton.innerHTML = state.sidebarCollapsed ? toolbarIcons.sidebarCollapsed : toolbarIcons.sidebarExpanded
  fields.sidebarButton.setAttribute('aria-pressed', String(state.sidebarCollapsed))
  fields.sidebarButton.setAttribute('aria-label', state.sidebarCollapsed ? t('chrome.showSidebar') : t('chrome.hideSidebar'))
  fields.sidebarButton.setAttribute('title', state.sidebarCollapsed ? t('chrome.showSidebar') : t('chrome.hideSidebar'))
  fields.sidebarButton.disabled = false
  fields.backButton.disabled = state.busy || (state.viewHistoryIndex <= 0 && !(state.activeView === 'market' && state.marketDetailProvider))
  fields.forwardButton.disabled = state.busy || state.viewHistoryIndex >= state.viewHistory.length - 1
}

function renderProfileSummary() {
  const name = state.signedOut ? t('app.signedOut') : profileDisplayName()
  fields.profileName.textContent = name
  fields.profileAvatar.textContent = profileInitial(name)
  fields.profileIdentity.classList.toggle('active', state.profileMenuOpen)
  fields.profileIdentity.setAttribute('aria-expanded', String(state.profileMenuOpen))
  renderProfileMenu()
}

function profileDisplayName() {
  const buyerName = state.agentCards.buyer?.manualFields.buyer?.displayName?.trim()
  const sellerName = state.agentCards.seller?.manualFields.seller?.displayName?.trim()
  const providerId = state.sellerMarketStatus?.providerId?.trim() || state.sellerSettings?.providerId?.trim()
  return buyerName || sellerName || providerId || t('app.userFallback')
}

function profileInitial(name: string) {
  const first = Array.from(name.trim()).find((char) => /\p{L}|\p{N}/u.test(char))
  return first ? first.toUpperCase() : 'E'
}

function applyUserPreferences() {
  setI18nLanguage(state.language)
  document.documentElement.dataset.theme = state.theme
  document.documentElement.dataset.language = state.language
  document.documentElement.lang = htmlLangForLanguage(state.language)
}

function activePermissionOption() {
  const options = permissionOptions()
  return options.find((option) => option.mode === state.permissionMode) || options[0]
}

function renderPermissionControl() {
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

function togglePermissionMenu() {
  state.permissionMenuOpen = !state.permissionMenuOpen
  if (state.permissionMenuOpen) {
    closeProfileMenu()
    closeProjectFolderMenu(false)
  }
  renderPermissionControl()
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
  showToast(t('toast.permissionEnabled', { label: activePermissionOption().label }))
}

function permissionPolicyText(mode = state.permissionMode) {
  if (mode === 'ask') return t('permission.policy.ask')
  if (mode === 'approve') return t('permission.policy.approve')
  if (mode === 'full') return t('permission.policy.full')
  return t('permission.policy.custom')
}

function permissionTaskTemplate() {
  const requirements = { permissionMode: state.permissionMode, permissionPolicy: permissionPolicyText() }
  if (state.permissionMode === 'custom') return { requirements }
  if (state.permissionMode === 'ask') {
    return {
      requirements,
      consentPolicy: {
        requireHumanApproval: true,
        identityScopes: ['external_file_edit', 'internet_access', 'seller_selection', 'payment'],
      },
    }
  }
  if (state.permissionMode === 'approve') {
    return {
      requirements,
      consentPolicy: {
        requireHumanApproval: false,
        identityScopes: ['unsafe_actions_require_review'],
      },
    }
  }
  return {
    requirements,
    consentPolicy: {
      requireHumanApproval: false,
      identityScopes: ['full_access'],
    },
  }
}

function profileMenuCopy() {
  return {
    signOut: state.signedOut ? t('profile.signedOut') : t('profile.signOut'),
    language: t('profile.language'),
    theme: t('profile.theme'),
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
  state.signedOut = true
  state.profileMenuOpen = false
  state.profileSubmenu = undefined
  renderProfileSummary()
  showToast(t('toast.signedOut'))
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
  showToast(t(`toast.language.${state.language}`))
}

function setTheme(theme: AppTheme) {
  state.theme = theme
  if (!hasDesktopBridge()) localStorage.setItem('exora.theme', state.theme)
  scheduleSaveAppSettings()
  state.profileMenuOpen = false
  state.profileSubmenu = undefined
  applyUserPreferences()
  renderAll()
  showToast(t(state.theme === 'dark' ? 'toast.theme.dark' : 'toast.theme.light'))
}

function focusSearch() {
  setActiveView('chat')
  state.pinStep = undefined
  renderAll()
  window.setTimeout(() => agentQuery.focus(), 0)
}

function renderProjectFolder() {
  const folder = activeProjectFolder()
  const name = folder?.name || 'AgenStaff_Project'
  const expanded = !state.projectFolderCollapsed
  if (state.activeView === 'market' || state.activeView === 'settings') state.projectFolderMenuOpen = false
  fields.projectFolderName.textContent = name
  fields.projectFolderHead.setAttribute('title', folder?.path || name)
  fields.projectFolderHead.classList.toggle('collapsed', !expanded)
  fields.projectFolderToggle.setAttribute('aria-expanded', String(expanded))
  fields.projectFolderToggle.setAttribute('title', expanded ? t('folder.collapseTasks') : t('folder.expandTasks'))
  fields.projectFolderToggle.setAttribute('aria-label', expanded ? t('folder.collapseNamedTasks', { name }) : t('folder.expandNamedTasks', { name }))
  renderProjectFolderTaskVisibility()
  renderProjectFolderMenu()
  renderTaskContextMenu()
}

function renderProjectFolderTaskVisibility() {
  fields.sidebarSectionHead.classList.remove('folder-collapsed')
  fields.ledgerList.classList.remove('folder-collapsed')
}

function renderProjectFolderMenu() {
  const open = state.projectFolderMenuOpen && state.activeView !== 'market' && state.activeView !== 'settings'
  if (!open) {
    state.projectFolderMenuOpen = false
    state.projectFolderMenuPosition = undefined
  }
  fields.projectFolderMenuButton.classList.toggle('active', open)
  fields.projectFolderMenuButton.setAttribute('aria-expanded', String(open))
  fields.projectFolderMenu.classList.toggle('hidden', !open)
  if (!open) {
    fields.projectFolderMenu.innerHTML = ''
    fields.projectFolderMenu.style.left = ''
    fields.projectFolderMenu.style.right = ''
    fields.projectFolderMenu.style.top = ''
    return
  }
  if (state.projectFolderMenuPosition) {
    fields.projectFolderMenu.style.left = `${state.projectFolderMenuPosition.x}px`
    fields.projectFolderMenu.style.right = 'auto'
    fields.projectFolderMenu.style.top = `${state.projectFolderMenuPosition.y}px`
  } else {
    fields.projectFolderMenu.style.left = ''
    fields.projectFolderMenu.style.right = ''
    fields.projectFolderMenu.style.top = ''
  }
  fields.projectFolderMenu.innerHTML = projectFolderMenuActions()
    .map(({ action, label, icon }) => `
      <button class="project-folder-menu-item" type="button" data-project-folder-action="${action}" role="menuitem">
        <span class="project-folder-menu-icon">${icon}</span>
        <span class="project-folder-menu-label">${escapeHTML(label)}</span>
      </button>
    `)
    .join('')
  localize(fields.projectFolderMenu)
}

function renderTaskContextMenu() {
  const open = state.taskMenuOpen && state.activeView !== 'market' && state.activeView !== 'settings'
  const thread = open && state.taskMenuThreadId ? workThreads({ includeArchived: true, side: 'all' }).find((item) => item.id === state.taskMenuThreadId) : undefined
  if (!thread) {
    state.taskMenuOpen = false
    state.taskMenuThreadId = undefined
    state.taskMenuPosition = undefined
    fields.taskContextMenu.classList.add('hidden')
    fields.taskContextMenu.innerHTML = ''
    fields.taskContextMenu.style.left = ''
    fields.taskContextMenu.style.top = ''
    return
  }
  const pinned = state.workTaskState.pinnedIds.has(thread.id)
  const unread = state.workTaskState.unreadIds.has(thread.id)
  const actions: Array<{ action: TaskMenuAction; label: string; icon: string; dividerBefore?: boolean }> = [
    { action: 'pin', label: pinned ? t('taskMenu.unpin') : t('taskMenu.pin'), icon: taskMenuIcons.pin },
    { action: 'rename', label: t('taskMenu.rename'), icon: taskMenuIcons.rename },
    { action: 'archive', label: t('taskMenu.archive'), icon: taskMenuIcons.archive },
    { action: 'unread', label: unread ? t('taskMenu.markRead') : t('taskMenu.markUnread'), icon: taskMenuIcons.unread },
    { action: 'open-project', label: t('taskMenu.openProject'), icon: taskMenuIcons['open-project'], dividerBefore: true },
    { action: 'copy-id', label: t('taskMenu.copyId'), icon: taskMenuIcons['copy-id'] },
  ]
  if (state.taskMenuPosition) {
    const rect = (fields.taskContextMenu.parentElement || fields.projectFolderHead).getBoundingClientRect()
    const x = Math.max(2, Math.min(state.taskMenuPosition.x, rect.width - 212))
    const y = Math.max(4, Math.min(state.taskMenuPosition.y, rect.height - 8))
    fields.taskContextMenu.style.left = `${x}px`
    fields.taskContextMenu.style.top = `${y}px`
  }
  fields.taskContextMenu.classList.remove('hidden')
  fields.taskContextMenu.innerHTML = actions.map(({ action, label, icon, dividerBefore }) => `
    ${dividerBefore ? '<div class="task-context-menu-divider" role="separator"></div>' : ''}
    <button class="project-folder-menu-item task-context-menu-item" type="button" data-task-menu-action="${action}" role="menuitem">
      <span class="project-folder-menu-icon">${icon}</span>
      <span class="project-folder-menu-label">${escapeHTML(label)}</span>
    </button>
  `).join('')
  localize(fields.taskContextMenu)
}

function closeProjectFolderMenu(render = true) {
  if (!state.projectFolderMenuOpen) return
  state.projectFolderMenuOpen = false
  state.projectFolderMenuPosition = undefined
  if (render) renderProjectFolder()
}

function closeTaskContextMenu(render = true) {
  if (!state.taskMenuOpen) return
  state.taskMenuOpen = false
  state.taskMenuThreadId = undefined
  state.taskMenuPosition = undefined
  if (render) renderTaskContextMenu()
}

function toggleProjectFolderMenu() {
  closeTaskContextMenu(false)
  state.projectFolderMenuOpen = !state.projectFolderMenuOpen
  state.projectFolderMenuPosition = undefined
  if (state.projectFolderMenuOpen) closeProfileMenu()
  renderProjectFolder()
}

function openProjectFolderContextMenu(event: MouseEvent, path?: string) {
  const target = event.target
  if (target instanceof Element && target.closest('.project-folder-menu')) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (state.activeView === 'market' || state.activeView === 'settings') return
  event.preventDefault()
  event.stopPropagation()
  closeProfileMenu()
  closeTaskContextMenu(false)
  if (path) setProjectFolderContext(path)
  const rect = (fields.projectFolderMenu.parentElement || fields.projectFolderHead).getBoundingClientRect()
  const x = Math.max(2, Math.min(event.clientX - rect.left, rect.width - 8))
  const y = Math.max(4, Math.min(event.clientY - rect.top, rect.height - 8))
  state.projectFolderMenuOpen = true
  state.projectFolderMenuPosition = { x, y }
  renderProjectFolder()
}

function fallbackProjectFolder(): ProjectFolder {
  return { name: 'AgenStaff_Project', path: 'browser:AgenStaff_Project' }
}

function sameProjectPath(left?: string, right?: string) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase()
}

function projectPathKey(path?: string) {
  return String(path || '').trim().toLowerCase()
}

function projectFolderExpanded(path: string) {
  const key = projectPathKey(path)
  if (!state.seenProjectFolderPaths.has(key)) {
    state.seenProjectFolderPaths.add(key)
    state.expandedProjectFolderPaths.add(key)
  }
  return state.expandedProjectFolderPaths.has(key)
}

function normalizeProjectFolder(folder?: Partial<ProjectFolder> | null): ProjectFolder | undefined {
  const path = String(folder?.path || '').trim()
  if (!path) return undefined
  const name = String(folder?.name || '').trim() || path.split(/[\\/]/).filter(Boolean).pop() || 'Project'
  return { name, path, daemonRestarted: folder?.daemonRestarted }
}

function mergeProjectFolders(...groups: Array<Array<Partial<ProjectFolder> | undefined> | undefined>): ProjectFolder[] {
  const folders: ProjectFolder[] = []
  const push = (folder?: Partial<ProjectFolder>) => {
    const normalized = normalizeProjectFolder(folder)
    if (!normalized || folders.some((item) => sameProjectPath(item.path, normalized.path))) return
    folders.push(normalized)
  }
  for (const group of groups) {
    for (const folder of group || []) push(folder)
  }
  if (!folders.length) push(fallbackProjectFolder())
  return folders
}

function projectFoldersFromConnections(connections: MCPConnection[]): ProjectFolder[] {
  return connections
    .filter((connection) => String(connection.role || 'buyer').toLowerCase() === 'buyer')
    .map((connection) => normalizeProjectFolder({
      name: connection.projectName || (connection.projectPath || '').split(/[\\/]/).filter(Boolean).pop(),
      path: connection.projectPath,
    }))
    .filter((folder): folder is ProjectFolder => Boolean(folder))
}

function projectFoldersFromActivity(orderPlans: OrderPlan[], tasks: Task[]): ProjectFolder[] {
  return [
    ...orderPlans.map((plan) => normalizeProjectFolder({ path: plan.projectPath })),
    ...tasks.map((task) => normalizeProjectFolder({ path: task.projectPath })),
  ].filter((folder): folder is ProjectFolder => Boolean(folder))
}

function activeProjectFolder() {
  const activePath = state.activeProjectFolderPath || state.projectFolder?.path
  return state.projectFolders.find((folder) => sameProjectPath(folder.path, activePath)) || state.projectFolder || state.projectFolders[0] || fallbackProjectFolder()
}

function setProjectFolders(folders: ProjectFolder[], activePath?: string) {
  state.projectFolders = mergeProjectFolders(folders)
  for (const folder of state.projectFolders) {
    const key = projectPathKey(folder.path)
    if (!state.seenProjectFolderPaths.has(key)) {
      state.seenProjectFolderPaths.add(key)
      state.expandedProjectFolderPaths.add(key)
    }
  }
  const requested = activePath || state.activeProjectFolderPath || state.projectFolder?.path
  const active = state.projectFolders.find((folder) => sameProjectPath(folder.path, requested)) || state.projectFolders[0] || fallbackProjectFolder()
  state.activeProjectFolderPath = active.path
  state.projectFolder = active
  scheduleSaveAppSettings()
}

function setProjectFolderContext(path: string) {
  const folder = state.projectFolders.find((item) => sameProjectPath(item.path, path))
  if (!folder) return
  state.projectFolder = folder
  state.activeProjectFolderPath = folder.path
}

function selectProjectFolder(path: string) {
  setProjectFolderContext(path)
  state.projectFolderCollapsed = false
  state.newConversationDraft = true
  state.selectedWorkThreadId = undefined
  state.selectedChatId = undefined
  state.selectedId = undefined
  state.pinStep = undefined
  scheduleSaveAppSettings()
  renderAll()
}

function projectFolderNameForPath(path: string) {
  return state.projectFolders.find((folder) => sameProjectPath(folder.path, path))?.name || path.split(/[\\/]/).filter(Boolean).pop() || 'project'
}

function browserStoredProjectFolder(): ProjectFolder | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem('exora.projectFolder') || '{}') as Partial<ProjectFolder>
    if (parsed.name && parsed.path) return { name: parsed.name, path: parsed.path }
  } catch {
    // Ignore invalid browser preview state.
  }
  return undefined
}

async function chooseBrowserProjectFolder(): Promise<ProjectFolder | undefined> {
  const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker
  if (!picker) throw new Error('Folder picking is only available in the desktop app or a browser with directory picker support.')
  const handle = await picker.call(window, { mode: 'readwrite' })
  const folder = { name: handle.name || 'Project', path: `browser:${handle.name || 'Project'}` }
  localStorage.setItem('exora.projectFolder', JSON.stringify(folder))
  return folder
}

async function refreshProjectFolder() {
  if (!window.exora?.invoke) {
    const folder = browserStoredProjectFolder() || fallbackProjectFolder()
    setProjectFolders([folder], folder.path)
    renderProjectFolder()
    return
  }
  const folder = await invoke<ProjectFolder>('project_folder_status').catch(() => null)
  if (!folder) return
  setProjectFolders([folder, ...state.projectFolders], folder.path)
  renderProjectFolder()
}

async function chooseProjectFolder() {
  if (state.busy) return
  closeProjectFolderMenu()
  setBusy(true)
  const previousPath = state.activeProjectFolderPath || state.projectFolder?.path
  try {
    const folder = window.exora?.invoke
      ? await invoke<ProjectFolder>('choose_project_folder', { input: { select: false } })
      : await chooseBrowserProjectFolder()
    if (folder) {
      setProjectFolders([folder, ...state.projectFolders], previousPath || folder.path)
      state.expandedProjectFolderPaths.add(projectPathKey(folder.path))
      scheduleSaveAppSettings()
      renderProjectFolder()
      if (folder.path !== previousPath) {
        showToast(t(folder.daemonRestarted ? 'toast.projectFolderApplied' : 'toast.projectFolder', { name: folder.name }))
      }
      if (folder.daemonRestarted) await refreshStatus()
    }
  } catch (error) {
    showToast(humanizeError(error))
  } finally {
    setBusy(false)
    renderAll()
  }
}

async function openProjectFolderInExplorer() {
  if (state.busy) return
  if (!window.exora?.invoke) {
    showToast(t('toast.openExplorerDesktopOnly'))
    return
  }
  setBusy(true)
  try {
    const folder = await invoke<ProjectFolder>('open_project_folder')
    setProjectFolders([folder, ...state.projectFolders], folder.path)
    renderProjectFolder()
    showToast(t('toast.opened', { name: folder.name }))
  } catch (error) {
    const message = humanizeError(error)
    if (message.includes('unknown desktop command: open_project_folder')) {
      await navigator.clipboard?.writeText(activeProjectFolder().path).catch(() => undefined)
      showToast(t('toast.restartForExplorer'))
    } else {
      showToast(message)
    }
  } finally {
    setBusy(false)
    renderAll()
  }
}

function renameBrowserProjectFolder(name: string): ProjectFolder {
  const current = state.projectFolder || { name: 'AgenStaff_Project', path: 'browser:AgenStaff_Project' }
  const folder = { name, path: current.path.startsWith('browser:') ? `browser:${name}` : current.path }
  localStorage.setItem('exora.projectFolder', JSON.stringify(folder))
  return folder
}

async function renameProjectFolder() {
  if (state.busy) return
  const currentName = state.projectFolder?.name || 'AgenStaff_Project'
  const nextName = window.prompt(t('prompt.renameProject'), currentName)?.trim()
  if (!nextName || nextName === currentName) return
  setBusy(true)
  try {
    const folder = window.exora?.invoke
      ? await invoke<ProjectFolder>('rename_project_folder', { input: { name: nextName } })
      : renameBrowserProjectFolder(nextName)
    state.projectFolder = folder
    setProjectFolders([folder, ...state.projectFolders], folder.path)
    renderProjectFolder()
    showToast(t('toast.projectRenamed', { name: folder.name }))
    if (folder.daemonRestarted) await refreshStatus()
  } catch (error) {
    showToast(humanizeError(error))
  } finally {
    setBusy(false)
    renderAll()
  }
}

function browserArchiveProjectChats(threads: ChatThread[], archivedAt: string): ProjectChatsArchiveResult {
  const folder = activeProjectFolder()
  const key = 'exora.archivedChatBatches'
  const batch = {
    id: `archive-${Date.now()}`,
    project: folder,
    archivedAt,
    threadCount: threads.length,
    threads,
  }
  try {
    const existing = JSON.parse(localStorage.getItem(key) || '[]')
    const batches = Array.isArray(existing) ? existing : []
    batches.push(batch)
    localStorage.setItem(key, JSON.stringify(batches))
  } catch {
    localStorage.setItem(key, JSON.stringify([batch]))
  }
  return { folder, archivedCount: threads.length, archivePath: `localStorage:${key}` }
}

function clearArchivedProjectChats() {
  state.chatThreads = []
  clearChatPersistenceState()
  state.selectedChatId = undefined
  state.selectedWorkThreadId = undefined
  state.selectedId = defaultSelectionForView(state.activeView)
  state.newConversationDraft = true
  state.pinStep = undefined
}

async function archiveProjectChats() {
  if (state.busy) return
  const count = state.chatThreads.length
  if (!count) {
    showToast(t('toast.noChatsToArchive'))
    return
  }
  const archivedAt = new Date().toISOString()
  const threads = state.chatThreads.map((thread) => ({
    ...thread,
    messages: thread.messages.map((message) => ({ ...message })),
    taskIds: [...(thread.taskIds || [])],
    participants: [...(thread.participants || [])],
  }))
  const storageKeys = state.chatThreads
    .map((thread) => threadStorageKeys.get(thread.id) || conversationStorageKey(thread))
    .filter(Boolean)
  setBusy(true)
  try {
    await flushAllChatSaves()
    const result = window.exora?.invoke
      ? await invoke<ProjectChatsArchiveResult>('archive_project_chats', { input: { threads, archivedAt, storageKeys } })
      : browserArchiveProjectChats(threads, archivedAt)
    clearArchivedProjectChats()
    renderAll()
    showToast(t('toast.archivedChats', { count: result.archivedCount }))
  } catch (error) {
    showToast(humanizeError(error))
  } finally {
    setBusy(false)
    renderAll()
  }
}

async function removeProjectFolder() {
  if (state.busy) return
  const confirmed = window.confirm('Remove this project from Exora Dock? Files on disk will not be deleted.')
  if (!confirmed) return
  setBusy(true)
  try {
    let folder: ProjectFolder
    if (window.exora?.invoke) {
      folder = await invoke<ProjectFolder>('remove_project_folder')
    } else {
      localStorage.removeItem('exora.projectFolder')
      folder = fallbackProjectFolder()
    }
    setProjectFolders([folder, ...state.projectFolders], folder.path)
    state.projectFolderCollapsed = false
    scheduleSaveAppSettings()
    renderProjectFolder()
    showToast(t('toast.projectRemoved', { name: folder.name }))
    if (folder.daemonRestarted) await refreshStatus()
  } catch (error) {
    showToast(humanizeError(error))
  } finally {
    setBusy(false)
    renderAll()
  }
}

async function handleProjectFolderMenuAction(action: ProjectFolderMenuAction) {
  closeProjectFolderMenu()
  if (action === 'open') return openProjectFolderInExplorer()
  if (action === 'rename') return renameProjectFolder()
  if (action === 'archive') return archiveProjectChats()
  if (action === 'remove') return removeProjectFolder()
}

async function refreshStatus() {
  if (state.statusLoading) return
  state.statusLoading = true
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
  state.statusLoading = false
}

async function startDockOnLaunch() {
  if (!hasDesktopBridge()) return
  fields.daemon.textContent = 'starting'
  fields.daemon.dataset.state = 'starting'
  try {
    renderStatus(await invoke<AppStatus>('start_dock'))
  } catch (error) {
    showToast(humanizeError(error))
    await refreshStatus()
  }
}

async function refreshSeller(options: { market?: boolean } = {}) {
  const settings = await invoke<SellerSettings>('seller_settings').catch(() => null)
  if (settings) {
    state.sellerSettings = settings
    await refreshLLMProfiles({ render: false })
    renderSeller(settings)
    renderProfileSummary()
    if (state.activeView === 'chat' || state.activeView === 'market' || state.activeView === 'settings') renderDecisionPanel()
  }
  if (options.market) {
    const marketStatus = await invoke<SellerMarketStatus>('seller_market_status').catch(() => null)
    if (marketStatus) {
      state.sellerMarketStatus = marketStatus
      renderProfileSummary()
      renderSellerMarketStatus(marketStatus)
      if (state.activeView === 'market' || state.activeView === 'settings') renderDecisionPanel()
    }
  }
}

function isDraftLLMProfileId(id?: string) {
  return id === DRAFT_LLM_PROFILE_ID
}

function editingDraftLLMProfile() {
  return isDraftLLMProfileId(state.editingLLMProfileId) ? state.llmDraftProfile : undefined
}

function savedEditingLLMProfileId() {
  return isDraftLLMProfileId(state.editingLLMProfileId) ? '' : state.editingLLMProfileId || ''
}

async function refreshLLMProfiles(options: { render?: boolean } = {}) {
  const status = await invoke<LLMProfileStatus>('llm_profiles').catch(() => null)
  if (!status) return
  state.llmProfiles = status.profiles || []
  state.activeLLMProfileId = status.activeProfileId
  state.buyerLLMProfileId = status.buyerProfileId
  state.sellerLLMProfileId = status.sellerProfileId
  state.llmKeyStorageAvailable = Boolean(status.keyStorageAvailable)
  if (editingDraftLLMProfile()) {
    if (options.render !== false) renderLLMSettings(state.sellerSettings)
    return
  }
  if (!state.editingLLMProfileId || !state.llmProfiles.some((profile) => profile.id === state.editingLLMProfileId)) {
    state.editingLLMProfileId = state.activeLLMProfileId || state.llmProfiles[0]?.id
  }
  if (options.render !== false) renderLLMSettings(state.sellerSettings)
}

async function refreshAgentCards() {
  const cards = await invoke<AgentCardsMine>('agent_cards_mine').catch(() => null)
  if (!cards) return
  state.agentCards = cards
  renderProfileSummary()
  if (state.activeView === 'market' || state.activeView === 'settings') renderDecisionPanel()
}

function renderAgentCardSurfaces() {
  if (state.activeView === 'market' || state.activeView === 'settings') renderDecisionPanel()
}

async function generateAgentCardDraft(role: AgentCardRole, form?: HTMLFormElement, options: { render?: boolean; track?: boolean } = {}) {
  const shouldRender = options.render !== false
  const shouldTrack = options.track !== false
  const input = agentCardDraftPayload(role, form)
  let taskId = 0
  if (shouldTrack) {
    taskId = ++cardDiagnosticsTaskSequence
    state.cardDiagnosticsTasks[role] = {
      id: taskId,
      role,
      running: true,
      stopRequested: false,
      message: 'Scanning environment...',
    }
    state.activeCardEditor = role
    state.cardMessage = 'Scanning environment...'
    if (shouldRender) renderAgentCardSurfaces()
  }
  try {
    const response = await invoke<{ card?: AgentCard }>('agent_card_draft', { input })
    const task = shouldTrack ? state.cardDiagnosticsTasks[role] : undefined
    if (shouldTrack && (!task || task.id !== taskId || task.stopRequested)) return undefined
    if (response.card) {
      state.cardDrafts[role] = response.card
      state.activeCardEditor = role
      state.cardMessage = 'Environment scan complete. System and dependency details are ready.'
      if (task) {
        task.running = false
        task.message = state.cardMessage
      }
    }
    return response.card
  } catch (error) {
    const task = shouldTrack ? state.cardDiagnosticsTasks[role] : undefined
    if (task && task.id === taskId && !task.stopRequested) {
      task.running = false
      task.message = humanizeError(error)
      state.activeCardEditor = role
      state.cardMessage = task.message
    }
    throw error
  } finally {
    const task = shouldTrack ? state.cardDiagnosticsTasks[role] : undefined
    if (task && task.id === taskId) {
      task.running = false
      if (task.stopRequested) task.message = 'Environment scan stopped.'
    }
    if (shouldRender) renderAgentCardSurfaces()
  }
}

function startAgentCardDiagnostics(role: AgentCardRole, root: ParentNode = fields.decisionContent) {
  const current = state.cardDiagnosticsTasks[role]
  if (current?.running) {
    stopAgentCardDiagnostics(role)
    return
  }
  const form = findAgentCardForm(role, root)
  generateAgentCardDraft(role, form).catch((error) => {
    const task = state.cardDiagnosticsTasks[role]
    if (task?.stopRequested) {
      renderAgentCardSurfaces()
      return
    }
    if (task?.running) {
      task.running = false
      task.message = humanizeError(error)
    }
    showToast(humanizeError(error))
    renderAgentCardSurfaces()
  })
}

function stopAgentCardDiagnostics(role: AgentCardRole) {
  const task = state.cardDiagnosticsTasks[role]
  if (!task?.running) return
  task.stopRequested = true
  task.running = false
  task.message = 'Environment scan stopped.'
  state.activeCardEditor = role
  state.cardMessage = task.message
  renderAgentCardSurfaces()
}

function agentCardDraftPayload(role: AgentCardRole, form?: HTMLFormElement) {
  const card = cardForRole(role)
  if (!form) return { role }
  return {
    role,
    ...agentCardRoleManualFieldsFromForm(role, new FormData(form), card?.manualFields || {}),
  }
}

async function saveAgentCardFromForm(form: HTMLFormElement, role: AgentCardRole) {
  let card = cardForRole(role)
  if (!card) {
    card = await generateAgentCardDraft(role, form, { render: false, track: false })
  }
  if (!card) return
  const next: AgentCard = {
    ...card,
    manualFields: agentCardManualFieldsFromForm(role, form, card.manualFields),
  }
  const response = await invoke<{ card?: AgentCard }>('save_agent_card', { input: { role, card: next } })
  if (response.card) {
    state.agentCards = { ...state.agentCards, [role]: response.card }
    state.cardDrafts[role] = undefined
    state.cardMessage = 'Card saved locally.'
    renderProfileSummary()
  }
  return response.card
}

async function publishAgentCard(role: AgentCardRole, root: ParentNode = fields.decisionContent) {
  const form = findAgentCardForm(role, root)
  if (form) {
    const saved = await saveAgentCardFromForm(form, role)
    if (!saved && !cardForRole(role)) return
  }
  state.cardMessage = 'Publishing card to Exora Cloud...'
  renderDecisionPanel()
  const response = await invoke<{ card?: AgentCard; cloudPublished?: boolean }>('publish_agent_card', { input: { role } })
  if (response.card) {
    state.agentCards = { ...state.agentCards, [role]: response.card }
    state.cardDrafts[role] = undefined
    state.activeCardEditor = undefined
    state.cardMessage = response.cloudPublished ? 'Card published to Exora Cloud.' : 'Card saved, but Cloud did not confirm publication.'
    renderProfileSummary()
  }
  renderDecisionPanel()
}

async function startPwaLink() {
  state.pwaLinkMessage = 'Creating PWA link QR...'
  renderPwaLinkStatus()
  try {
    const response = await invoke<PwaLinkStatus>('pwa_link_start')
    const qrPayload = response.qrPayload || response.userCode || ''
    const qrSvg = qrPayload
      ? await qrToString(qrPayload, {
        type: 'svg',
        width: SETTINGS_QR_WIDTH,
        margin: SETTINGS_QR_MARGIN,
        color: SETTINGS_QR_COLOR,
      })
      : ''
    state.pwaLink = { ...response, qrSvg }
    state.pwaLinkMessage = 'Scan this QR from the Exora PWA Remote Console.'
    renderPwaLinkStatus()
    schedulePwaLinkPoll()
  } catch (error) {
    clearPwaLinkPoll()
    state.pwaLink = undefined
    state.pwaLinkMessage = pwaLinkErrorMessage(error)
    renderPwaLinkStatus()
    throw error
  }
}

async function checkPwaLink() {
  if (!state.pwaLink?.deviceCode) {
    await startPwaLink()
    return
  }
  const response = await invoke<PwaLinkStatus>('pwa_link_status', { input: state.pwaLink })
  state.pwaLink = { ...state.pwaLink, ...response }
  if (response.linked || response.status === 'approved') {
    state.pwaLinkMessage = response.daemonRestarted
      ? 'PWA linked. Dock was restarted so remote commands can connect.'
      : response.message || 'PWA linked. Remote Console can now control this Dock.'
    clearPwaLinkPoll()
    await refreshStatus()
  } else {
    state.pwaLinkMessage = response.message || 'Waiting for the PWA to confirm this code.'
    schedulePwaLinkPoll()
  }
  renderPwaLinkStatus()
}

function schedulePwaLinkPoll() {
  clearPwaLinkPoll()
  if (!state.pwaLink?.deviceCode || state.pwaLink.linked) return
  pwaLinkPollTimer = window.setTimeout(() => {
    if (state.activeSettingsView !== 'pwa') return
    run(() => checkPwaLink()).catch(() => undefined)
  }, 2500)
}

function clearPwaLinkPoll() {
  if (pwaLinkPollTimer !== undefined) {
    window.clearTimeout(pwaLinkPollTimer)
    pwaLinkPollTimer = undefined
  }
}

function compactTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function pwaLinkErrorMessage(error: unknown) {
  const message = humanizeError(error)
  const lower = message.toLowerCase()
  if (lower.includes('timed out') || lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('network')) {
    return `${message}. Start Exora Cloud or set cloud_url to a reachable Exora Cloud endpoint, then create a new QR.`
  }
  return `Could not create PWA QR: ${message}`
}

function findAgentCardForm(role: AgentCardRole, root: ParentNode = fields.decisionContent, origin?: Element | null) {
  const nested = origin?.closest<HTMLFormElement>(`[data-agent-card-form="${role}"]`)
  return nested || root.querySelector<HTMLFormElement>(`[data-agent-card-form="${role}"]`) || undefined
}

function agentCardRoleManualFieldsFromForm(role: AgentCardRole, data: FormData, current: AgentCard['manualFields'] = {}): AgentCard['manualFields'] {
  if (role === 'buyer') return { buyer: buyerFieldsFromForm(data, current.buyer || {}) }
  return { seller: sellerFieldsFromForm(data, current.seller || {}) }
}

function agentCardManualFieldsFromForm(role: AgentCardRole, form: HTMLFormElement, current: AgentCard['manualFields'] = {}): AgentCard['manualFields'] {
  return {
    ...current,
    ...agentCardRoleManualFieldsFromForm(role, new FormData(form), current),
  }
}

function formText(data: FormData, name: string) {
  return String(data.get(name) || '').trim()
}

function formCheckbox(data: FormData, name: string, fallback = false) {
  const values = data.getAll(name).map((value) => String(value))
  if (!values.length) return fallback
  return values.some((value) => value === 'true' || value === 'on' || value === '1')
}

function buyerFieldsFromForm(data: FormData, current: BuyerManualFields): BuyerManualFields {
  return {
    ...current,
    displayName: formText(data, 'displayName'),
    supportedAgentTypes: parseListInput(data.get('supportedAgentTypes')),
    notes: formText(data, 'notes'),
    budget: formText(data, 'budget'),
    preferences: parseListInput(data.get('preferences')),
    riskBoundary: formText(data, 'riskBoundary'),
    authorizationStrategy: formText(data, 'authorizationStrategy'),
    acceptedTaskTypes: parseListInput(data.get('acceptedTaskTypes')),
    identityDisclosure: formText(data, 'identityDisclosure'),
    fileDisclosure: formText(data, 'fileDisclosure'),
    dataRetention: formText(data, 'dataRetention'),
    escrowPreference: formText(data, 'escrowPreference'),
  }
}

function sellerFieldsFromForm(data: FormData, current: SellerManualFields): SellerManualFields {
  const settings = state.sellerSettings
  return {
    ...current,
    displayName: formText(data, 'displayName'),
    capabilitySummary: formText(data, 'capabilitySummary'),
    capabilityTypes: parseListInput(data.get('capabilityTypes')),
    pricing: formText(data, 'pricing') || sellerPricingSummary(settings),
    availability: formText(data, 'availability') || sellerAvailabilitySummary(settings),
    humanConfirmation: formText(data, 'humanConfirmation'),
    dataBoundary: formText(data, 'dataBoundary'),
    managedApis: parseListInput(data.get('managedApis')),
    outputFormats: parseListInput(data.get('outputFormats')),
    autoQuote: formCheckbox(data, 'autoQuote', Boolean(settings?.autoQuote)),
    autoAcceptLowRisk: formCheckbox(data, 'autoAcceptLowRisk', Boolean(settings?.autoAcceptLowRisk || settings?.autoCompleteTextTasks)),
    externalWritePolicy: formText(data, 'externalWritePolicy'),
  }
}

async function refreshWorkspace(options: { quiet?: boolean } = {}) {
  if (state.workspaceLoading) return
  state.workspaceLoading = true
  const previousSelected = state.selectedId
  const previousSnapshot = {
    orderPlans: state.orderPlans,
    approvals: state.approvals,
    tasks: state.tasks,
    payments: state.payments,
    mcpConnections: state.mcpConnections,
    workRuns: state.workRuns,
    workRunEvents: state.workRunEvents,
  }
  try {
    const snapshot = await invoke<WorkspaceSnapshot>('workspace_snapshot').catch((error) => ({
      online: false,
      orderPlans: previousSnapshot.orderPlans,
      approvals: previousSnapshot.approvals,
      tasks: previousSnapshot.tasks,
      payments: previousSnapshot.payments,
      mcpConnections: previousSnapshot.mcpConnections,
      workMcpLeases: state.workMcpLeases,
      workRuns: previousSnapshot.workRuns,
      workRunEvents: previousSnapshot.workRunEvents,
      projectFolders: state.projectFolders,
      activeProjectFolderPath: state.activeProjectFolderPath,
      errors: [humanizeError(error)],
    }))
    const offline = snapshot.online === false && Boolean(snapshot.errors?.length)
    state.workspaceOnline = snapshot.online !== false
    state.workspaceErrors = snapshot.errors || []
    state.orderPlans = offline ? previousSnapshot.orderPlans : snapshot.orderPlans || []
    state.approvals = offline ? previousSnapshot.approvals : snapshot.approvals || []
    state.tasks = offline ? previousSnapshot.tasks : snapshot.tasks || []
    state.payments = offline ? previousSnapshot.payments : snapshot.payments || []
    state.mcpConnections = offline ? previousSnapshot.mcpConnections : snapshot.mcpConnections || []
    state.workMcpLeases = snapshot.workMcpLeases || []
    state.workRuns = offline ? previousSnapshot.workRuns : snapshot.workRuns || []
    state.workRunEvents = snapshot.workRunEvents || previousSnapshot.workRunEvents || {}
    const connectionFolders = projectFoldersFromConnections(state.mcpConnections)
    const activityFolders = projectFoldersFromActivity(state.orderPlans, state.tasks)
    const activePath = snapshot.activeProjectFolderPath || state.activeProjectFolderPath
    setProjectFolders([...(snapshot.projectFolders || []), ...connectionFolders, ...activityFolders, ...(state.projectFolders || [])], activePath)
    if (snapshot.errors?.length && options.quiet !== true) {
      showToast(snapshot.errors[0])
    }
    notifyExternalRequests(false)
    chooseDefaultSelection(previousSelected)
    if (snapshot.online === true && !(snapshot.errors || []).length) {
      void saveTransactionsSnapshot()
    }
    renderLedger()
    renderContextStrip()
    renderDecisionPanel()
    renderExternalWorkLockControls()
    syncTransactionProgressPolling()
  } finally {
    state.workspaceLoading = false
  }
}

function selectedProgressThread() {
  if (state.activeView === 'chat' || state.activeView === 'work') return selectedWorkThread()
  const selected = selectedObjectForActiveView()
  if (!selected) return undefined
  const threadId = selected.kind === 'plan'
    ? workThreadIdForPlan(selected.value)
    : selected.kind === 'approval'
      ? workThreadIdForApproval(selected.value)
      : selected.kind === 'task'
        ? workThreadIdForTask(selected.value)
        : workThreadIdForPayment(selected.value)
  return workThreadById(threadId, { includeArchived: true, side: 'all' })
}

function selectedProgressPollKeyFor(thread?: WorkThread) {
  if (!thread) return ''
  return `${state.workOrderSide}:${thread.id}:${thread.timestamp}:${state.workspaceOnline ? 'online' : 'offline'}`
}

function clearTransactionProgressPolling() {
  if (transactionProgressPollTimer !== undefined) {
    window.clearTimeout(transactionProgressPollTimer)
    transactionProgressPollTimer = undefined
  }
  transactionProgressPollKey = ''
}

function syncTransactionProgressPolling() {
  const thread = selectedProgressThread()
  if (!thread || !workThreadHasTransactionProgress(thread)) {
    clearTransactionProgressPolling()
    return
  }
  const snapshot = buildTransactionProgressSnapshot(thread, state.workOrderSide)
  const key = selectedProgressPollKeyFor(thread)
  if (!snapshot.needsFastRefresh) {
    clearTransactionProgressPolling()
    return
  }
  if (transactionProgressPollTimer !== undefined && transactionProgressPollKey === key) return
  clearTransactionProgressPolling()
  transactionProgressPollKey = key
  transactionProgressPollTimer = window.setTimeout(() => {
    transactionProgressPollTimer = undefined
    if (transactionProgressPollKey !== key) return
    void refreshWorkspace({ quiet: true }).finally(() => {
      if (transactionProgressPollKey === key && transactionProgressPollTimer === undefined) {
        syncTransactionProgressPolling()
      }
    })
  }, 2000)
}

function transactionSnapshotRecords(): TransactionSnapshotRecord[] {
  const records = new Map<string, TransactionSnapshotRecord>()
  const ensure = (id: string, fallback: Partial<TransactionSnapshotRecord> = {}) => {
    const existing = records.get(id)
    if (existing) return existing
    const record: TransactionSnapshotRecord = {
      id,
      orderId: fallback.orderId,
      taskId: fallback.taskId,
      side: fallback.side || 'buyer',
      projectPath: fallback.projectPath || defaultWorkProjectPath(),
      status: fallback.status,
      providerPubkey: fallback.providerPubkey,
      updatedAt: fallback.updatedAt,
      task: fallback.task,
      orderPlans: [],
      approvals: [],
      payments: [],
    }
    records.set(id, record)
    return record
  }
  const touch = (record: TransactionSnapshotRecord, timestamp?: string) => {
    if (sortTime(timestamp) > sortTime(record.updatedAt)) record.updatedAt = timestamp
  }
  for (const task of state.tasks) {
    const id = `task:${task.id}`
    const record = ensure(id, {
      orderId: task.orderId || task.id,
      taskId: task.id,
      side: orderSideForTask(task),
      projectPath: projectPathForTask(task),
      status: task.status,
      providerPubkey: task.providerPubkey || task.quote?.providerPubkey,
      updatedAt: task.updatedAt || task.completedAt || task.createdAt,
      task,
    })
    record.task = task
    record.status = task.status || record.status
    record.providerPubkey = task.providerPubkey || task.quote?.providerPubkey || record.providerPubkey
    touch(record, task.updatedAt || task.completedAt || task.createdAt)
  }
  for (const plan of state.orderPlans) {
    const task = taskForPlan(plan)
    const id = task ? `task:${task.id}` : `order:${plan.planId}`
    const record = ensure(id, {
      orderId: task?.orderId || plan.planId,
      taskId: task?.id || plan.taskId,
      side: orderSideForPlan(plan),
      projectPath: projectPathForPlan(plan),
      status: plan.status,
      updatedAt: plan.updatedAt || plan.createdAt || plan.expiresAt,
      task,
    })
    if (!record.orderPlans.some((item) => item.planId === plan.planId)) record.orderPlans.push(plan)
    record.status ||= plan.status
    touch(record, plan.updatedAt || plan.createdAt || plan.expiresAt)
  }
  for (const approval of state.approvals) {
    const task = state.tasks.find((item) => item.id === approval.taskId)
    const id = task ? `task:${task.id}` : `order:${approval.taskId}`
    const record = ensure(id, {
      orderId: task?.orderId || approval.taskId,
      taskId: approval.taskId,
      side: orderSideForApproval(approval),
      projectPath: projectPathForApproval(approval),
      status: approval.status,
      providerPubkey: approval.providerPubkey,
      updatedAt: approval.createdAt || approval.expiresAt,
      task,
    })
    if (!record.approvals.some((item) => item.approvalId === approval.approvalId)) record.approvals.push(approval)
    record.providerPubkey = approval.providerPubkey || record.providerPubkey
    touch(record, approval.createdAt || approval.expiresAt)
  }
  for (const payment of state.payments) {
    const task = payment.taskId ? state.tasks.find((item) => item.id === payment.taskId) : undefined
    const id = task ? `task:${task.id}` : `payment:${payment.paymentId}`
    const record = ensure(id, {
      orderId: task?.orderId || payment.taskId || payment.paymentId,
      taskId: payment.taskId,
      side: orderSideForPayment(payment),
      projectPath: projectPathForPayment(payment),
      status: payment.status,
      providerPubkey: payment.providerPubkey,
      updatedAt: payment.updatedAt || payment.confirmedAt || payment.createdAt,
      task,
    })
    if (!record.payments.some((item) => item.paymentId === payment.paymentId)) record.payments.push(payment)
    record.providerPubkey = payment.providerPubkey || record.providerPubkey
    record.status = payment.status || record.status
    touch(record, payment.updatedAt || payment.confirmedAt || payment.createdAt)
  }
  return [...records.values()].sort((a, b) => sortTime(b.updatedAt) - sortTime(a.updatedAt))
}

async function saveTransactionsSnapshot() {
  if (!hasDesktopBridge()) return
  const records = transactionSnapshotRecords()
  const fingerprint = JSON.stringify(records)
  if (fingerprint === lastTransactionsFingerprint) return
  lastTransactionsFingerprint = fingerprint
  try {
    await invoke('save_transactions', { input: { savedAt: new Date().toISOString(), records } })
  } catch (error) {
    console.warn('Failed to save transactions:', error)
  }
}

async function submitAgentMessage() {
  const query = agentQuery.value.trim()
  if (!query || state.busy) return
  const activeLease = activeExternalWorkLease()
  if (activeLease) {
    renderExternalWorkLockControls()
    showToast(t('toast.externalWorkLocked'))
    return
  }
  if (!state.buyerAgentSettings.enabled) {
    showToast(t('toast.buyerAgentDisabled'))
    return
  }

  closePermissionMenu()
  setActiveView('chat')
  renderViewTabs()
  agentQuery.value = ''
  resizeAgentComposer()
  pushMessage({ role: 'user', text: query })
  const pendingID = pushMessage({
    role: 'assistant',
    text: 'Searching Exora Market and preparing seller choices for owner review...',
    meta: 'Built-in Agent',
    pending: true,
  })

  setBusy(true)
  try {
    const response = await invoke<MarketSearchResult>('agent_search_sellers', {
      input: buyerAgentSearchInput(query, {
        projectPath: activeProjectFolder().path,
        permissionMode: state.permissionMode,
        taskTemplate: permissionTaskTemplate(),
      }),
    })
    updateMessage(pendingID, {
      text: marketResponseText(response),
      meta: response.selectionRequest ? `Work plan ${shortID(response.selectionRequest.planId)}` : 'Search complete',
      result: response,
      pending: false,
    })
    if (response.selectionRequest?.planId) {
      state.selectedId = selectionId('plan', response.selectionRequest.planId)
      bindActiveChatToOrder(response.selectionRequest.planId, response.selectionRequest.status)
    }
    await refreshWorkspace({ quiet: true })
  } catch (error) {
    updateMessage(pendingID, {
      text: `I could not search the market yet: ${humanizeError(error)}`,
      meta: 'Search failed',
      pending: false,
    })
  } finally {
    setBusy(false)
    await refreshStatus()
    await refreshSeller()
  }
}

function renderStatus(status: AppStatus) {
  state.appStatus = status
  fields.daemon.textContent = status.daemon
  fields.daemon.dataset.state = status.daemon
  fields.message.textContent = translatePhrase(status.message, state.language)
  renderLocalAgentPromptControls()
}

function renderChat() {
  renderChatSurface()
  if (state.newConversationDraft) {
    fields.chatFeed.innerHTML = `<div class="chat-empty-state"><h2>${t('chat.empty')}</h2></div>`
    localize(fields.chatFeed)
    return
  }
  const workThread = selectedWorkThread()
  const chatThread = workThread
    ? workThread.chatId
      ? state.chatThreads.find((thread) => thread.id === workThread.chatId)
      : undefined
    : selectedChatThread()
  const messages = chatThread?.messages || []
  const events = workThread ? workEventsForThread(workThread) : []
  const progressPanel = workThread && workThreadHasTransactionProgress(workThread) ? renderTransactionProgressPanel(workThread, state.workOrderSide) : ''
  if (!workThread && messages.length === 0 && events.length === 0) {
    fields.chatFeed.innerHTML = `<div class="chat-empty-state"><h2>${t('chat.empty')}</h2></div>`
    localize(fields.chatFeed)
    return
  }
  if (!progressPanel && messages.length === 0 && events.length === 0) {
    fields.chatFeed.innerHTML = `<div class="chat-empty-state"><h2>${t('chat.empty')}</h2></div>`
    localize(fields.chatFeed)
    return
  }
  fields.chatFeed.innerHTML = [
    progressPanel,
    ...messages.map(renderChatMessage),
    ...events.map(renderWorkEventCard),
  ].filter(Boolean).join('')
  attachDecisionHandlers(fields.chatFeed)
  localize(fields.chatFeed)
  fields.chatFeed.scrollTop = fields.chatFeed.scrollHeight
}

function renderChatMessage(message: ChatMessage) {
  if (message.kind === 'order_event') {
    return `
      <article class="chat-order-event">
        <div class="message-meta">${escapeHTML(message.meta || actorLabel(message.actor) || t('chat.orderEvent'))}</div>
        <p data-no-i18n>${escapeHTML(message.text)}</p>
      </article>
    `
  }
  return `
    <article class="chat-message ${message.role}${message.pending ? ' pending' : ''}">
      <div class="message-meta">${escapeHTML(message.meta || actorLabel(message.actor) || messageRoleLabel(message.role))}</div>
      <p data-no-i18n>${escapeHTML(message.text)}</p>
      ${message.result ? renderSearchResult(message.result) : ''}
    </article>
  `
}

function actorLabel(actor?: ChatMessage['actor']) {
  if (actor === 'buyer_agent') return t('chat.ourAgent')
  if (actor === 'seller_agent') return t('chat.sellerAgent')
  if (actor === 'buyer_human') return t('chat.you')
  if (actor === 'seller_human') return t('chat.seller')
  return ''
}

function messageRoleLabel(role: ChatMessage['role']) {
  if (role === 'user') return t('chat.you')
  if (role === 'assistant') return 'Exora'
  return t('chat.system')
}

function renderSearchResult(result: MarketSearchResult) {
  const candidates = (result.candidates || []).slice(0, 3)
  if (candidates.length === 0) return ''
  return `
    <div class="result-strip">
      <span>${escapeHTML(targetSummary(result.normalizedQuery))}</span>
      <span>${t('chat.optionCount', { count: (result.orderDraftOptions || []).length || candidates.length })}</span>
    </div>
    <div class="candidate-list">
      ${candidates.map(renderCandidateSummary).join('')}
    </div>
  `
}

function workEventsForThread(thread: WorkThread) {
  const events: Array<{ kind: SelectedKind; id: string; timestamp: string }> = []
  state.orderPlans
    .filter((plan) => thread.planIds.includes(plan.planId) || workThreadIdForPlan(plan) === thread.id)
    .forEach((plan) => events.push({ kind: 'plan', id: plan.planId, timestamp: plan.updatedAt || plan.createdAt || plan.expiresAt || '' }))
  state.approvals
    .filter((approval) => thread.approvalIds.includes(approval.approvalId) || workThreadIdForApproval(approval) === thread.id)
    .forEach((approval) => events.push({ kind: 'approval', id: approval.approvalId, timestamp: approval.createdAt || approval.expiresAt || '' }))
  state.tasks
    .filter((task) => thread.taskIds.includes(task.id) || workThreadIdForTask(task) === thread.id)
    .forEach((task) => events.push({ kind: 'task', id: task.id, timestamp: task.updatedAt || task.completedAt || task.createdAt || '' }))
  state.payments
    .filter((payment) => thread.paymentIds.includes(payment.paymentId) || workThreadIdForPayment(payment) === thread.id)
    .forEach((payment) => events.push({ kind: 'payment', id: payment.paymentId, timestamp: payment.updatedAt || payment.confirmedAt || payment.createdAt || '' }))
  return events.sort((a, b) => sortTime(a.timestamp) - sortTime(b.timestamp))
}

function renderWorkEventCard(event: { kind: SelectedKind; id: string }) {
  if (event.kind === 'plan') {
    const plan = state.orderPlans.find((item) => item.planId === event.id)
    if (!plan) return ''
    return `<article class="chat-order-event" data-event-kind="plan">${renderOrderPlanDecision(plan)}</article>`
  }
  if (event.kind === 'approval') {
    const approval = state.approvals.find((item) => item.approvalId === event.id)
    if (!approval) return ''
    return `<article class="chat-order-event" data-event-kind="approval">${renderApprovalDecision(approval)}</article>`
  }
  if (event.kind === 'task') {
    const task = state.tasks.find((item) => item.id === event.id)
    if (!task) return ''
    return `<article class="chat-order-event" data-event-kind="task">${renderTaskDecision(task)}</article>`
  }
  const payment = state.payments.find((item) => item.paymentId === event.id)
  if (!payment) return ''
  return `<article class="chat-order-event" data-event-kind="payment">${renderPaymentDecision(payment)}</article>`
}

function renderTransactionProgressPanel(thread: WorkThread, side: OrderSide) {
  const snapshot = buildTransactionProgressSnapshot(thread, side)
  const sideLabel = side === 'seller' ? 'Seller' : 'Buyer'
  const eventHTML = snapshot.events.length
    ? snapshot.events.map((event) => `
      <div class="transaction-event ${event.tone ? `tone-${event.tone}` : ''}">
        <span>${escapeHTML(event.label)}</span>
        <small>${escapeHTML([event.detail, event.timestamp ? compactTimestamp(event.timestamp) : ''].filter(Boolean).join(' / '))}</small>
      </div>
    `).join('')
    : '<p class="empty-copy">No progress events recorded yet.</p>'
  const facts = [
    ...snapshot.ids.filter((item) => item.value).map((item) => `<div><dt>${escapeHTML(item.label)}</dt><dd>${escapeHTML(shortID(item.value))}</dd></div>`),
    snapshot.provider ? `<div><dt>Provider</dt><dd>${escapeHTML(shortID(snapshot.provider))}</dd></div>` : '',
    snapshot.quote ? `<div><dt>Quote</dt><dd>${escapeHTML(snapshot.quote)}</dd></div>` : '',
    snapshot.payment ? `<div><dt>Payment</dt><dd>${escapeHTML(snapshot.payment)}</dd></div>` : '',
    snapshot.artifacts ? `<div><dt>Artifacts</dt><dd>${escapeHTML(snapshot.artifacts)}</dd></div>` : '',
  ].filter(Boolean).join('')
  return `
    <section class="transaction-progress-panel ${snapshot.terminal ? 'terminal' : ''}" data-progress-state="${escapeAttr(snapshot.state)}">
      <div class="transaction-progress-head">
        <div>
          <span class="transaction-role-chip">${escapeHTML(sideLabel)} progress</span>
          <h3>${escapeHTML(snapshot.title)}</h3>
          <p>${escapeHTML(snapshot.syncStatus)}</p>
        </div>
        <span class="transaction-state-chip">${escapeHTML(progressStateLabel(snapshot.state))}</span>
      </div>
      <div class="transaction-progress-summary">
        <div><span>Owner</span><strong>${escapeHTML(progressStateLabel(snapshot.owner || 'unknown'))}</strong></div>
        <div><span>Waiting for</span><strong>${escapeHTML(progressStateLabel(snapshot.waitingFor || 'none'))}</strong></div>
        <div><span>Next</span><strong>${escapeHTML(snapshot.nextAction || 'No action required')}</strong></div>
      </div>
      <div class="transaction-progress-steps" aria-label="Transaction progress">
        ${snapshot.stages.map((stage, index) => `
          <div class="transaction-stage ${stage.status}" data-stage="${escapeAttr(stage.id)}">
            <span class="transaction-stage-dot">${index + 1}</span>
            <div>
              <strong>${escapeHTML(stage.title)}</strong>
              <small>${escapeHTML(stage.detail)}</small>
            </div>
          </div>
        `).join('')}
      </div>
      ${facts ? `<dl class="transaction-progress-facts">${facts}</dl>` : ''}
      <div class="transaction-event-log">
        <div class="transaction-event-title">
          <strong>Recent activity</strong>
          <span>${escapeHTML(snapshot.updatedAt ? compactTimestamp(snapshot.updatedAt) : 'local snapshot')}</span>
        </div>
        ${eventHTML}
      </div>
    </section>
  `
}

function buildTransactionProgressSnapshot(thread: WorkThread, side: OrderSide): TransactionProgressSnapshot {
  const data = transactionProgressData(thread)
  const primaryPlan = latestBy(data.plans, (plan) => plan.updatedAt || plan.createdAt || plan.expiresAt || '')
  const primaryTask = latestBy(data.tasks, (task) => task.updatedAt || task.completedAt || task.createdAt || '')
  const primaryApproval = latestBy(data.approvals, (approval) => approval.createdAt || approval.expiresAt || '')
  const primaryPayment = latestBy(data.payments, (payment) => payment.updatedAt || payment.confirmedAt || payment.createdAt || '')
  const activeRun = latestBy(data.workRuns, (run) => run.updatedAt || run.createdAt || '')
  const orderState = deriveTransactionOrderState(data, primaryPlan, primaryTask, activeRun)
  const currentStageId = currentProgressStageId(side, orderState.state, activeRun)
  const failed = Boolean(orderState.terminalReason || primaryTask?.status === 'failed' || activeRun?.status === 'failed')
  const blocked = orderState.state === 'execution_blocked' || activeRun?.status === 'waiting_owner_approval' || activeRun?.status === 'waiting_owner_choice'
  const terminal = ['closed', 'settlement_or_dispute'].includes(orderState.state) || failed
  const stages = transactionStageDefinitions(side).map((stage, index, all) => {
    const currentIndex = all.findIndex((item) => item.id === currentStageId)
    let status: TransactionProgressStage['status'] = 'pending'
    if (currentIndex >= 0 && index < currentIndex) status = 'complete'
    if (stage.id === currentStageId) status = failed ? 'failed' : blocked ? 'blocked' : orderState.waitingFor === 'user_input' || orderState.waitingFor === 'buyer_user' ? 'waiting' : 'active'
    if (terminal && !failed && index <= currentIndex) status = 'complete'
    return { ...stage, status }
  })
  const provider = primaryTask?.providerPubkey || primaryTask?.quote?.providerPubkey || (primaryPlan ? selectedProviderForPlan(primaryPlan) : '')
  const quote = primaryTask ? taskAmount(primaryTask) : primaryPlan ? selectedQuoteForPlan(primaryPlan) : ''
  const payment = primaryPayment ? `${primaryPayment.status || 'payment'} / ${paymentAmount(primaryPayment)}` : primaryApproval?.paymentRequired ? 'required' : ''
  const artifacts = primaryTask?.artifacts?.length ? `${primaryTask.artifacts.length} file(s)` : primaryTask?.artifactHashes ? `${Object.keys(primaryTask.artifactHashes).length} hash(es)` : ''
  return {
    title: thread.title || primaryTask?.goal || primaryPlan?.query || 'Transaction',
    side,
    state: orderState.state,
    owner: orderState.owner,
    waitingFor: orderState.waitingFor,
    nextAction: orderState.nextAction,
    updatedAt: orderState.updatedAt,
    syncStatus: transactionSyncStatus(data),
    currentStageId,
    terminal,
    needsFastRefresh: transactionNeedsFastRefresh(orderState.state, data),
    stages,
    events: transactionProgressEvents(data, primaryTask, primaryApproval, primaryPayment),
    ids: [
      { label: 'Order', value: orderState.orderId || thread.orderId || orderIdFromWorkThreadId(thread.id) },
      { label: 'Plan', value: primaryPlan?.planId },
      { label: 'Task', value: primaryTask?.id },
      { label: 'Job', value: primaryPlan?.providerJobId || activeRun?.entities?.providerJobId },
      { label: 'Run', value: activeRun?.runId },
    ],
    quote,
    payment,
    provider,
    artifacts,
  }
}

function workThreadHasTransactionProgress(thread: WorkThread) {
  if (thread.orderId || thread.planIds.length || thread.taskIds.length || thread.approvalIds.length || thread.paymentIds.length) return true
  const data = transactionProgressData(thread)
  return Boolean(data.plans.length || data.tasks.length || data.approvals.length || data.payments.length || data.workRuns.length)
}

function transactionProgressData(thread: WorkThread): TransactionProgressData {
  const orderID = thread.orderId || orderIdFromWorkThreadId(thread.id)
  const plans = state.orderPlans.filter((plan) => (
    thread.planIds.includes(plan.planId) ||
    plan.planId === orderID ||
    Boolean(plan.taskId && thread.taskIds.includes(plan.taskId)) ||
    workThreadIdForPlan(plan) === thread.id
  ))
  const planIds = new Set([...thread.planIds, ...plans.map((plan) => plan.planId)].filter(Boolean))
  const tasks = state.tasks.filter((task) => (
    thread.taskIds.includes(task.id) ||
    task.orderId === orderID ||
    Boolean(task.orderId && planIds.has(task.orderId)) ||
    plans.some((plan) => plan.taskId === task.id) ||
    workThreadIdForTask(task) === thread.id
  ))
  const taskIds = new Set([...thread.taskIds, ...tasks.map((task) => task.id)].filter(Boolean))
  const approvals = state.approvals.filter((approval) => (
    thread.approvalIds.includes(approval.approvalId) ||
    taskIds.has(approval.taskId) ||
    plans.some((plan) => plan.approvalId === approval.approvalId)
  ))
  const approvalIds = new Set([...thread.approvalIds, ...approvals.map((approval) => approval.approvalId)].filter(Boolean))
  const payments = state.payments.filter((payment) => (
    thread.paymentIds.includes(payment.paymentId) ||
    Boolean(payment.taskId && taskIds.has(payment.taskId)) ||
    Boolean(payment.approvalId && approvalIds.has(payment.approvalId)) ||
    plans.some((plan) => plan.paymentId === payment.paymentId)
  ))
  const paymentIds = new Set([...thread.paymentIds, ...payments.map((payment) => payment.paymentId)].filter(Boolean))
  const workUids = new Set([
    ...plans.map((plan) => plan.workUid),
    ...tasks.map((task) => task.workUid),
  ].filter((value): value is string => Boolean(value)))
  const workRuns = state.workRuns.filter((run) => {
    const entities = run.entities
    return (
      Boolean(run.workUid && workUids.has(run.workUid)) ||
      Boolean(entities?.orderPlanId && planIds.has(entities.orderPlanId)) ||
      Boolean(entities?.orderPlanIds?.some((id) => planIds.has(id))) ||
      Boolean(entities?.taskId && taskIds.has(entities.taskId)) ||
      Boolean(entities?.approvalId && approvalIds.has(entities.approvalId)) ||
      Boolean(entities?.paymentId && paymentIds.has(entities.paymentId)) ||
      Boolean(orderID && entities?.providerJobId && plans.some((plan) => plan.providerJobId === entities.providerJobId)) ||
      Boolean(!plans.length && !tasks.length && run.projectPath && thread.projectPath && sameProjectPath(run.projectPath, thread.projectPath) && run.intent === thread.title)
    )
  })
  const runIds = new Set(workRuns.map((run) => run.runId))
  const workRunEvents = [...runIds].flatMap((runId) => state.workRunEvents[runId] || [])
  return { thread, plans, tasks, approvals, payments, workRuns, workRunEvents }
}

function deriveTransactionOrderState(data: TransactionProgressData, plan?: OrderPlan, task?: Task, run?: WorkRun) {
  const fromPlan = plan?.orderState
  let derivedState = fromPlan?.state || 'plan_first'
  let owner = fromPlan?.owner || 'buyer_agent'
  let waitingFor = fromPlan?.waitingFor || 'local_agent'
  let terminalReason = fromPlan?.terminalReason || ''
  if (plan && !fromPlan?.state) {
    if (plan.status === 'pending_selection') {
      derivedState = plan.candidates?.some((item) => ['pending', 'requested', 'quoting'].includes(item.status || '')) ? 'seller_valuation' : 'quote_review'
      owner = 'buyer_user'
      waitingFor = 'user_input'
    } else if (plan.status === 'selected') {
      derivedState = 'order_authorized'
      owner = 'buyer_user'
      waitingFor = 'user_input'
    } else if (plan.status === 'expired' || plan.status === 'invalidated') {
      derivedState = 'closed'
      owner = 'cloud'
      waitingFor = 'none'
      terminalReason = plan.invalidationCause || plan.status
    }
  }
  if (task) {
    if (task.status === 'pending_consent') {
      derivedState = 'order_authorized'
      owner = 'buyer_user'
      waitingFor = 'user_input'
    } else if (task.status === 'consented' || task.status === 'claimed') {
      derivedState = 'input_transfer'
      owner = 'provider_docker'
      waitingFor = 'provider_response'
    } else if (task.status === 'running') {
      derivedState = 'provider_execution'
      owner = 'provider_docker'
      waitingFor = 'local_supervisor'
    } else if (task.status === 'completed') {
      derivedState = 'buyer_verification'
      owner = 'buyer_user'
      waitingFor = 'user_input'
    } else if (task.status === 'failed') {
      derivedState = 'settlement_or_dispute'
      owner = 'buyer_user'
      waitingFor = 'user_input'
      terminalReason = task.error || 'provider_task_failed'
    }
  }
  if (!plan && !task && run?.currentStep) {
    derivedState = run.currentStep === 'discover_agent_cards' || run.currentStep === 'start_task_flow' ? 'cloud_matching' : 'seller_valuation'
  }
  const approval = latestBy(data.approvals, (item) => item.createdAt || item.expiresAt || '')
  const payment = latestBy(data.payments, (item) => item.updatedAt || item.confirmedAt || item.createdAt || '')
  const nextAction = firstDisplayText(
    run?.nextAction,
    approval && approval.status !== 'approved' ? `Review approval ${shortID(approval.approvalId)}` : '',
    payment && payment.status && !['confirmed', 'confirmed_simulated', 'found_finalized'].includes(payment.status) ? `Confirm payment ${shortID(payment.paymentId)}` : '',
    task?.status === 'completed' ? 'Verify delivered artifacts' : '',
    task?.status === 'failed' ? 'Review failure and dispute evidence' : '',
    plan?.nextAction,
    derivedState === 'provider_execution' ? 'Wait for Provider Docker terminal report' : '',
  )
  return {
    state: derivedState,
    owner,
    waitingFor,
    terminalReason,
    nextAction,
    orderId: fromPlan?.orderId || plan?.planId || task?.orderId,
    updatedAt: latestTimestamp([
      fromPlan?.updatedAt,
      plan?.updatedAt,
      task?.updatedAt,
      task?.completedAt,
      run?.updatedAt,
      payment?.updatedAt,
      approval?.createdAt,
    ]),
  }
}

function transactionStageDefinitions(side: OrderSide): Array<Omit<TransactionProgressStage, 'status'>> {
  if (side === 'seller') {
    return [
      { id: 'task_valuation', title: 'Valuation', detail: 'Read manifest, pricing policy, and device snapshot.' },
      { id: 'quote_response', title: 'Quote response', detail: 'Return quote, negotiation request, or rejection.' },
      { id: 'wait_buyer', title: 'Buyer authorization', detail: 'Wait for buyer approval, payment evidence, and inputs.' },
      { id: 'execution_plan', title: 'Execution plan', detail: 'Create resumable step list before running.' },
      { id: 'provider_execution', title: 'Docker execution', detail: 'Run the authorized container job.' },
      { id: 'local_supervisor', title: 'Local supervisor', detail: 'Keep local execution alive without cloud heartbeat.' },
      { id: 'terminal_report', title: 'Terminal report', detail: 'Return success or unrecoverable failure.' },
      { id: 'settlement', title: 'Settlement', detail: 'Wait for buyer verification, release, or dispute.' },
    ]
  }
  return [
    { id: 'plan_first', title: 'Plan first', detail: 'Gather complete local requirements and manifests.' },
    { id: 'cloud_matching', title: 'Matching', detail: 'Send approved task to Cloud and collect seller valuations.' },
    { id: 'quote_review', title: 'Quote review', detail: 'Compare quotes, negotiation notes, and rejections.' },
    { id: 'authorization', title: 'Authorization', detail: 'Approve seller, sensitive inputs, and escrow evidence.' },
    { id: 'input_transfer', title: 'Input transfer', detail: 'Make authorized files and hashes available to provider.' },
    { id: 'provider_execution', title: 'Provider execution', detail: 'Provider Docker runs the job under seller policy.' },
    { id: 'buyer_verification', title: 'Verification', detail: 'Inspect artifacts, hashes, and terminal report.' },
    { id: 'settlement', title: 'Settlement', detail: 'Release payment, refund, dispute, or close.' },
  ]
}

function currentProgressStageId(side: OrderSide, orderState: string, run?: WorkRun) {
  const step = run?.currentStep || ''
  if (side === 'seller') {
    if (['cloud_matching', 'seller_valuation'].includes(orderState)) return 'task_valuation'
    if (orderState === 'quote_review') return 'quote_response'
    if (orderState === 'order_authorized') return 'wait_buyer'
    if (orderState === 'input_transfer') return 'execution_plan'
    if (orderState === 'provider_execution') return step === 'poll_worker_job' ? 'local_supervisor' : 'provider_execution'
    if (orderState === 'buyer_verification') return 'terminal_report'
    if (orderState === 'settlement_or_dispute' || orderState === 'closed') return 'settlement'
    return 'task_valuation'
  }
  if (step === 'discover_agent_cards' || step === 'start_task_flow') return 'plan_first'
  if (step === 'negotiate_task' || step === 'compare_quotes' || step === 'create_order_plan' || step === 'wait_owner_seller_choice') return 'quote_review'
  if (step === 'request_approval' || step === 'wait_owner_approval_payment' || step === 'create_payment_intent' || step === 'fund_chain_escrow' || step === 'sync_payment_evidence' || step === 'verify_payment_evidence') return 'authorization'
  if (step === 'submit_worker_job' || step === 'poll_worker_job') return 'provider_execution'
  if (step === 'fetch_artifacts' || step === 'verify_artifacts') return 'buyer_verification'
  if (orderState === 'cloud_matching' || orderState === 'seller_valuation') return 'cloud_matching'
  if (orderState === 'quote_review') return 'quote_review'
  if (orderState === 'order_authorized') return 'authorization'
  if (orderState === 'input_transfer') return 'input_transfer'
  if (orderState === 'provider_execution' || orderState === 'execution_blocked') return 'provider_execution'
  if (orderState === 'buyer_verification') return 'buyer_verification'
  if (orderState === 'settlement_or_dispute' || orderState === 'closed') return 'settlement'
  return 'plan_first'
}

function transactionNeedsFastRefresh(orderState: string, data: TransactionProgressData) {
  if (!state.workspaceOnline) return false
  if (data.workRuns.some((run) => ['queued', 'running', 'waiting_owner_choice', 'waiting_owner_approval', 'waiting_worker', 'stop_requested'].includes(run.status || ''))) return true
  return ['cloud_matching', 'seller_valuation', 'quote_review', 'input_transfer', 'provider_execution', 'execution_blocked'].includes(orderState)
}

function transactionSyncStatus(data: TransactionProgressData) {
  const offline = !state.workspaceOnline
  const errors = state.workspaceErrors.length ? ` / ${state.workspaceErrors[0]}` : ''
  const source = data.workRuns.length ? `${data.workRuns.length} checkpoint${data.workRuns.length === 1 ? '' : 's'}` : 'local transaction records'
  return offline ? `Local snapshot, waiting to sync${errors}` : `Live local sync from ${source}`
}

function transactionProgressEvents(data: TransactionProgressData, task?: Task, approval?: Approval, payment?: PaymentRecord): TransactionProgressEvent[] {
  const events: TransactionProgressEvent[] = []
  for (const plan of data.plans) {
    for (const event of plan.events || []) {
      events.push({
        id: `plan:${plan.planId}:${event.type}:${event.time || event.optionId || events.length}`,
        type: event.type,
        label: progressStateLabel(event.type),
        detail: event.message || event.optionId,
        timestamp: event.time,
        tone: progressEventTone(event.type),
      })
    }
  }
  for (const event of data.workRunEvents) {
    events.push({
      id: event.eventId || `run:${event.runId}:${event.type}:${event.createdAt}`,
      type: event.type,
      label: progressStateLabel(event.type),
      detail: event.summary || event.step || event.status,
      timestamp: event.createdAt,
      tone: progressEventTone(event.type || event.status || ''),
    })
  }
  if (task) {
    events.push({
      id: `task:${task.id}:${task.status}`,
      type: task.status,
      label: `Task ${progressStateLabel(task.status)}`,
      detail: task.error || task.goal,
      timestamp: task.updatedAt || task.completedAt || task.createdAt,
      tone: progressEventTone(task.status),
    })
  }
  if (approval) {
    events.push({
      id: `approval:${approval.approvalId}:${approval.status}`,
      type: approval.status,
      label: `Approval ${progressStateLabel(approval.status)}`,
      detail: approval.riskSummary || approval.action,
      timestamp: approval.createdAt || approval.expiresAt,
      tone: progressEventTone(approval.status),
    })
  }
  if (payment) {
    events.push({
      id: `payment:${payment.paymentId}:${payment.status}`,
      type: payment.status || 'payment',
      label: `Payment ${progressStateLabel(payment.status || 'recorded')}`,
      detail: payment.proofRef || paymentAmount(payment),
      timestamp: payment.updatedAt || payment.confirmedAt || payment.createdAt,
      tone: progressEventTone(payment.status || ''),
    })
  }
  return events
    .filter((event, index, all) => event.timestamp || all.findIndex((item) => item.id === event.id) === index)
    .sort((a, b) => sortTime(b.timestamp) - sortTime(a.timestamp))
    .slice(0, 7)
}

function progressEventTone(value: string): TransactionProgressEvent['tone'] {
  const lower = value.toLowerCase()
  if (lower.includes('fail') || lower.includes('reject') || lower.includes('invalid') || lower.includes('expired')) return 'bad'
  if (lower.includes('block') || lower.includes('required') || lower.includes('waiting') || lower.includes('pending')) return 'warn'
  if (lower.includes('complete') || lower.includes('success') || lower.includes('approved') || lower.includes('quoted') || lower.includes('confirmed')) return 'good'
  return 'normal'
}

function progressStateLabel(value?: string) {
  const text = String(value || '').trim()
  if (!text) return 'Unknown'
  return text.replace(/[._-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function selectedQuoteForPlan(plan: OrderPlan) {
  const option = selectedOptionForPlan(plan)
  if (option) return optionPrice(option)
  const candidate = (plan.candidates || []).find((item) => item.status === 'quoted' && item.priceAmount)
  if (candidate?.priceAmount) return `${candidate.priceAmount} ${candidate.currency || 'USDC'}`
  return ''
}

function latestBy<T>(items: T[], timestamp: (item: T) => string | undefined): T | undefined {
  return [...items].sort((a, b) => sortTime(timestamp(b)) - sortTime(timestamp(a)))[0]
}

function latestTimestamp(values: Array<string | undefined>) {
  return values.filter(Boolean).sort((a, b) => sortTime(b) - sortTime(a))[0] || ''
}

function firstDisplayText(...values: Array<string | undefined | false>) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || ''
}

function renderChatSurface() {
  const started = chatSurfaceStarted()
  fields.chatView.classList.remove('compact')
  fields.chatView.classList.toggle('empty-mode', !started)
  fields.chatView.classList.toggle('conversation-mode', started)
  fields.chatFeed.classList.remove('hidden')
  fields.localAgentCard.classList.toggle('hidden', started)
  app.querySelector<HTMLElement>('.work-or-divider')?.classList.toggle('hidden', started)
  agentChatForm.classList.remove('hidden')
  renderExternalWorkLockControls()
  resizeAgentComposer()
}

function chatSurfaceStarted() {
  if (state.newConversationDraft) return false
  const workThread = selectedWorkThread()
  const chatThread = workThread
    ? workThread.chatId
      ? state.chatThreads.find((thread) => thread.id === workThread.chatId)
      : undefined
    : selectedChatThread()
  const messages = chatThread?.messages || []
  const events = workThread ? workEventsForThread(workThread) : []
  const progressData = workThread ? transactionProgressData(workThread) : undefined
  const hasProgress = Boolean(progressData && (progressData.plans.length || progressData.tasks.length || progressData.approvals.length || progressData.payments.length || progressData.workRuns.length))
  return messages.length > 0 || events.length > 0 || hasProgress
}

function rightWorkspaceIsWhite() {
  if (state.activeView === 'settings' || state.activeView === 'market') return true
  if (state.activeView === 'chat' || state.activeView === 'work') return chatSurfaceStarted()
  return false
}

function resizeAgentComposer() {
  agentQuery.style.height = 'auto'
  const maxHeight = 168
  const nextHeight = Math.min(Math.max(agentQuery.scrollHeight, 38), maxHeight)
  agentQuery.style.height = `${nextHeight}px`
  agentQuery.style.overflowY = agentQuery.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

function renderCandidateSummary(candidate: SellerCandidate) {
  const res = candidate.resource
  const spec = res?.spec || {}
  const detail = [
    res?.type,
    spec.vramGb ? `${spec.vramGb}GB VRAM` : '',
    spec.gpuModel || '',
    spec.datasetSizeGb ? `${spec.datasetSizeGb}GB dataset` : '',
  ].filter(Boolean).join(' / ')
  return `
    <div class="candidate-row">
      <strong>${escapeHTML(res?.name || shortID(candidate.providerPubkey))}</strong>
      <span>score ${candidate.score}${detail ? ` / ${escapeHTML(detail)}` : ''}</span>
    </div>
  `
}

async function searchCardMarket(query: string) {
  const trimmed = query.trim()
  if (!trimmed || state.busy) return
  if (!state.buyerAgentSettings.enabled) {
    showToast(t('toast.buyerAgentDisabled'))
    return
  }
  setActiveView('market')
  state.marketSelectedId = undefined
  const pendingID = pushMessage({
    role: 'assistant',
    text: `Searching card market for "${trimmed}"...`,
    meta: 'Card Market',
    pending: true,
  })
  setBusy(true)
  try {
    const response = await invoke<MarketSearchResult>('agent_search_sellers', {
      input: buyerAgentSearchInput(trimmed),
    })
    updateMessage(pendingID, {
      text: marketResponseText(response),
      meta: response.selectionRequest ? `Work plan ${shortID(response.selectionRequest.planId)}` : 'Card search complete',
      result: response,
      pending: false,
    })
    if (response.selectionRequest?.planId) {
      state.selectedId = selectionId('plan', response.selectionRequest.planId)
      bindActiveChatToOrder(response.selectionRequest.planId, response.selectionRequest.status)
    }
    await refreshWorkspace({ quiet: true })
  } catch (error) {
    updateMessage(pendingID, {
      text: `I could not search the card market yet: ${humanizeError(error)}`,
      meta: 'Card search failed',
      pending: false,
    })
    showToast(humanizeError(error))
  } finally {
    setBusy(false)
    await refreshStatus()
    await refreshSeller()
    renderAll()
  }
}

const settingsNavItems: Array<{ view: SettingsView; titleKey: string }> = [
  { view: 'api', titleKey: 'settings.api.nav' },
  { view: 'buyer-card', titleKey: 'settings.buyerCard.nav' },
  { view: 'seller-card', titleKey: 'settings.sellerCard.nav' },
  { view: 'buyer-agent', titleKey: 'settings.buyerAgent.nav' },
  { view: 'seller', titleKey: 'settings.seller.nav' },
  { view: 'pwa', titleKey: 'settings.pwa.nav' },
  { view: 'wallet', titleKey: 'settings.wallet.nav' },
  { view: 'archives', titleKey: 'settings.archives.nav' },
]

function renderLedger() {
  renderViewTabs()
  fields.ledgerList.classList.toggle('settings-list', state.activeView === 'settings')
  if (state.activeView === 'settings') {
    renderSettingsSidebar()
    localize()
    return
  }
  if (state.activeView === 'market') {
    renderMarketTransactionSidebar()
    localize()
    return
  }
  renderOrderActivitySidebar()
  localize()
}

function renderMarketTransactionSidebar() {
  const entries = marketTransactionEntries()
  fields.sidebarTitle.textContent = 'Transactions'
  fields.ledgerCount.textContent = String(entries.length)
  if (!entries.length) {
    renderLedgerEmpty(`No ${state.marketOrderSide} traded orders yet`)
    return
  }
  setLedgerEmpty(false)
  fields.ledgerList.innerHTML = entries.map((entry) => `
    <button class="ledger-item history-record ${entry.id === state.marketSelectedId ? 'active' : ''}" data-market-select="${escapeHTML(entry.id)}" title="${escapeHTML([entry.status, entry.subtitle].filter(Boolean).join(' / '))}">
      <strong>${escapeHTML(entry.title)}</strong>
      ${entry.subtitle ? `<small>${escapeHTML(compactText(entry.subtitle, 76))}</small>` : ''}
    </button>
  `).join('')
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-market-select]').forEach((button) => {
    button.addEventListener('click', () => {
      state.marketSelectedId = button.dataset.marketSelect
      state.marketDetailProvider = undefined
      state.pinStep = undefined
      renderAll()
    })
  })
}

function renderSettingsSidebar() {
  fields.sidebarTitle.textContent = 'Settings'
  fields.ledgerCount.textContent = String(settingsNavItems.length)
  setLedgerEmpty(false)
  fields.ledgerList.innerHTML = settingsNavItems.map((item) => {
    const title = t(item.titleKey)
    return `
    <button class="ledger-item history-record settings-record ${item.view === state.activeSettingsView ? 'active' : ''}" data-settings-tab="${escapeHTML(item.view)}" title="${escapeAttr(title)}">
      <span class="settings-record-icon">${settingsNavIcons[item.view]}</span>
      <strong>${escapeHTML(title)}</strong>
    </button>
  `
  }).join('')
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeSettingsView = button.dataset.settingsTab as SettingsView
      scheduleSaveAppSettings()
      renderAll()
      if (state.activeSettingsView === 'wallet') {
        refreshSettingsStatus()
      }
      if (state.activeSettingsView === 'pwa') {
        schedulePwaLinkPoll()
      }
    })
  })
}

function renderLedgerEmpty(message: string) {
  setLedgerEmpty(true)
  fields.ledgerList.innerHTML = `<p class="empty-copy ledger-empty-copy">${escapeHTML(message)}</p>`
}

function setLedgerEmpty(empty: boolean) {
  fields.sidebarSectionHead.classList.toggle('hidden', empty)
  fields.ledgerList.classList.toggle('empty', empty)
}

function renderContextStrip() {
  fields.contextStrip.classList.toggle('hidden', state.activeView === 'market' || state.activeView === 'chat' || state.activeView === 'settings')
  if (state.activeView === 'chat') {
    fields.contextStrip.textContent = ''
    return
  }
  if (state.activeView === 'settings') {
    fields.contextStrip.textContent = ''
    return
  }
  if (state.activeView === 'market') {
    fields.contextStrip.textContent = ''
    return
  }
  const selected = selectedObjectForActiveView()
  if (!selected) {
    fields.contextStrip.textContent = t('context.selectOrder')
    return
  }
  if (selected.kind === 'plan') {
    fields.contextStrip.textContent = t('context.sellerChoice', { query: selected.value.query || translatePhrase('market request') })
  } else if (selected.kind === 'approval') {
    fields.contextStrip.textContent = t('context.approval', { action: selected.value.action || t('common.request'), task: shortID(selected.value.taskId) })
  } else if (selected.kind === 'task') {
    fields.contextStrip.textContent = t('context.task', { title: taskTitle(selected.value) })
  } else {
    fields.contextStrip.textContent = t('context.payment', { status: selected.value.status || t('common.record'), amount: paymentAmount(selected.value) })
  }
}

function renderTransactionProgressForSelection(selected: ReturnType<typeof selectedObject>) {
  if (!selected) return ''
  const threadId = selected.kind === 'plan'
    ? workThreadIdForPlan(selected.value)
    : selected.kind === 'approval'
      ? workThreadIdForApproval(selected.value)
      : selected.kind === 'task'
        ? workThreadIdForTask(selected.value)
        : workThreadIdForPayment(selected.value)
  const thread = workThreadById(threadId, { includeArchived: true, side: 'all' })
  return thread ? renderTransactionProgressPanel(thread, state.workOrderSide) : ''
}

function renderDecisionPanel() {
  window.queueMicrotask(() => localize())
  renderViewTabs()
  const selected = selectedObjectForActiveView()

  const showingChat = (state.activeView === 'chat' || state.activeView === 'work') && !state.pinStep
  const showingSettings = state.activeView === 'settings' && !state.pinStep
  const hideMainHeading = showingChat || (state.activeView === 'market' && !state.pinStep)
  fields.chatView.classList.toggle('hidden', !showingChat)
  fields.actionView.classList.toggle('hidden', showingChat || showingSettings)
  fields.settingsView.classList.toggle('hidden', !showingSettings)
  fields.mainKicker.classList.toggle('hidden', hideMainHeading)
  fields.decisionTitle.classList.toggle('hidden', hideMainHeading)
  fields.decisionStep.classList.toggle('hidden', state.activeView === 'market' || showingChat || showingSettings)

  if (showingChat) {
    renderChat()
    renderChatSurface()
    fields.mainKicker.textContent = 'Work'
    fields.decisionTitle.textContent = 'Work'
    fields.decisionStep.textContent = 'work'
    renderContextStrip()
    return
  }

  if (showingSettings) {
    renderSettingsPanel()
    renderContextStrip()
    return
  }

  if (state.pinStep) {
    fields.mainKicker.textContent = 'Work'
    fields.decisionTitle.textContent = state.pinStep.setup ? 'Set Payment PIN' : 'Enter Payment PIN'
    fields.decisionStep.textContent = 'Enter PIN'
    fields.decisionContent.innerHTML = renderPinStep(state.pinStep)
    attachPinHandlers()
    return
  }

  if (state.activeView === 'market') {
    const detailCandidate = state.marketDetailProvider ? marketCardByProvider(state.marketDetailProvider) : undefined
    fields.mainKicker.textContent = 'Market'
    const marketSelection = selectedMarketTransaction()
    fields.decisionTitle.textContent = marketSelection
      ? 'Order Detail'
      : detailCandidate?.resource?.name || (detailCandidate ? shortID(detailCandidate.providerPubkey) : 'Cards')
    fields.decisionStep.textContent = 'market'
    fields.decisionContent.innerHTML = marketSelection ? renderMarketTransactionDetail(marketSelection) : renderCardMarket()
    if (marketSelection) {
      attachMarketTransactionHandlers()
    } else {
      attachCardHandlers()
      attachCardMarketHandlers()
    }
    renderContextStrip()
    return
  }

  if (!selected) {
    fields.mainKicker.textContent = 'Work'
    fields.decisionTitle.textContent = 'Work'
    fields.decisionStep.textContent = 'empty'
    fields.decisionContent.innerHTML = '<p class="empty-copy">No seller choices, approvals, tasks, or payments yet. Use Work or Market to start.</p>'
    return
  }

  if (selected.kind === 'plan') {
    fields.mainKicker.textContent = 'Work'
    fields.decisionTitle.textContent = 'Review Sellers'
    fields.decisionStep.textContent = 'Review sellers'
    fields.decisionContent.innerHTML = renderTransactionProgressForSelection(selected) + renderOrderPlanDecision(selected.value)
  } else if (selected.kind === 'approval') {
    fields.mainKicker.textContent = 'Work'
    fields.decisionTitle.textContent = 'Approval Request'
    fields.decisionStep.textContent = selected.value.paymentRequired ? 'Payment required' : 'Review'
    fields.decisionContent.innerHTML = renderTransactionProgressForSelection(selected) + renderApprovalDecision(selected.value)
  } else if (selected.kind === 'task') {
    fields.mainKicker.textContent = 'Work'
    fields.decisionTitle.textContent = 'Task Status'
    fields.decisionStep.textContent = selected.value.status || 'task'
    fields.decisionContent.innerHTML = renderTransactionProgressForSelection(selected) + renderTaskDecision(selected.value)
  } else {
    fields.mainKicker.textContent = 'Work'
    fields.decisionTitle.textContent = 'Payment Proof'
    fields.decisionStep.textContent = selected.value.status || 'payment'
    fields.decisionContent.innerHTML = renderTransactionProgressForSelection(selected) + renderPaymentDecision(selected.value)
  }
  attachDecisionHandlers()
}

function renderOrderPlanDecision(plan: OrderPlan) {
  const options = (plan.options || []).slice(0, 6)
  const realtime = plan.realtimeRequired ? '<span>Realtime Docker quotes</span>' : ''
  if (plan.status !== 'pending_selection') {
    return `
      <section class="decision-card">
        <h3>${escapeHTML(plan.status)}</h3>
        <p class="muted">${escapeHTML(plan.nextAction || 'This seller choice is no longer pending.')}</p>
        ${renderOrderPlanProgress(plan)}
      </section>
    `
  }
  return `
    <section class="decision-card">
      <div class="decision-summary">
        <span>${escapeHTML(agentSourceLabel(plan.agentId))}</span>
        <strong>${escapeHTML(plan.query || 'Seller choice')}</strong>
        <small>${escapeHTML(targetSummary(plan.normalizedQuery))}</small>
      </div>
      ${realtime ? `<div class="chip-row">${realtime}</div>` : ''}
      ${renderOrderPlanProgress(plan)}
      <div class="seller-options">
        ${options.length ? options.map((option, index) => renderOrderOption(plan, option, index)).join('') : '<p class="empty-copy">No realtime-confirmed provider quote is selectable yet.</p>'}
      </div>
      <button class="danger ghost full-width" data-cancel-plan="${escapeHTML(plan.planId)}">Cancel seller choice</button>
    </section>
  `
}

function renderOrderOption(plan: OrderPlan, option: OrderDraftOption, index: number) {
  const paid = optionIsPaid(option)
  const status = option.realtimeStatus || (plan.realtimeRequired ? 'unconfirmed' : '')
  return `
    <article class="seller-option">
      <div class="option-rank">${index + 1}</div>
      <div class="option-main">
        <div class="option-title">
          <strong>${escapeHTML(shortID(option.providerPubkey))}</strong>
          <span>score ${option.score || 0}</span>
        </div>
        <p>${escapeHTML(option.reason || option.draft?.goal || 'Prepared seller option.')}</p>
        <div class="chip-row">
          <span>${escapeHTML(optionCapability(option) || option.resourceId || 'resource')}</span>
          <span>${escapeHTML(optionPrice(option))}</span>
          ${status ? `<span>${escapeHTML(status)}</span>` : ''}
          <span>${escapeHTML(option.expiresAt || plan.expiresAt || 'expires soon')}</span>
        </div>
      </div>
      <button data-select-plan="${escapeHTML(plan.planId)}" data-option-id="${escapeHTML(option.optionId)}">
        ${paid ? 'Choose + PIN' : 'Choose'}
      </button>
    </article>
  `
}

function renderOrderPlanProgress(plan: OrderPlan) {
  const candidates = (plan.candidates || []).slice(0, 6)
  const events = (plan.events || []).slice(-4)
  if (!candidates.length && !events.length) return ''
  return `
    <div class="flow-progress">
      ${candidates.length ? candidates.map((item) => `
        <div class="flow-row">
          <strong>${escapeHTML(shortID(item.providerPubkey || item.resourceId || item.optionId || 'provider'))}</strong>
          <span>${escapeHTML(item.status || 'pending')}</span>
          <small>${escapeHTML(item.message || item.quoteId || '')}</small>
        </div>
      `).join('') : ''}
      ${events.length ? `<div class="flow-events">${events.map((event) => `
        <span>${escapeHTML(event.type)}${event.message ? ` / ${escapeHTML(event.message)}` : ''}</span>
      `).join('')}</div>` : ''}
    </div>
  `
}

function renderApprovalDecision(approval: Approval) {
  const files = approval.fileScope?.length ? `${approval.fileScope.length} file(s)` : 'no files'
  return `
    <section class="decision-card">
      <div class="decision-summary">
        <span>${escapeHTML(agentSourceLabel(approval.agentId))}</span>
        <strong>${escapeHTML(approval.action || 'Approval request')}</strong>
        <small>${escapeHTML(approval.riskSummary || 'Approval required before this action can continue.')}</small>
      </div>
      <dl class="detail-grid">
        <div><dt>Task</dt><dd>${escapeHTML(shortID(approval.taskId))}</dd></div>
        <div><dt>Provider</dt><dd>${escapeHTML(shortID(approval.providerPubkey))}</dd></div>
        <div><dt>Amount</dt><dd>${escapeHTML(approvalAmount(approval))}</dd></div>
        <div><dt>Payment</dt><dd>${approval.paymentRequired ? 'PIN required' : 'not required'}</dd></div>
        <div><dt>Files</dt><dd>${escapeHTML(files)}</dd></div>
      </dl>
      <div class="decision-actions single-action">
        <button data-approve="${escapeHTML(approval.approvalId)}">${approval.paymentRequired ? 'Approve + PIN' : 'Approve'}</button>
        <button class="danger ghost" data-reject="${escapeHTML(approval.approvalId)}">Reject</button>
      </div>
    </section>
  `
}

function renderTaskDecision(task: Task) {
  const payment = state.payments.find((item) => item.taskId === task.id)
  const approval = state.approvals.find((item) => item.taskId === task.id)
  return `
    <section class="decision-card">
      <div class="decision-summary">
        <span>${escapeHTML(agentSourceLabel(task.agentId))}</span>
        <strong>${escapeHTML(taskTitle(task))}</strong>
        <small>${escapeHTML(task.status || 'task')}</small>
      </div>
      <dl class="detail-grid">
        <div><dt>Task ID</dt><dd>${escapeHTML(shortID(task.id))}</dd></div>
        <div><dt>Provider</dt><dd>${escapeHTML(shortID(task.providerPubkey || task.quote?.providerPubkey))}</dd></div>
        <div><dt>Quote</dt><dd>${escapeHTML(taskAmount(task))}</dd></div>
        <div><dt>Payment</dt><dd>${escapeHTML(payment ? `${payment.status} / ${paymentAmount(payment)}` : 'none')}</dd></div>
        <div><dt>Updated</dt><dd>${escapeHTML(task.updatedAt || task.createdAt || '')}</dd></div>
      </dl>
      ${task.error ? `<p class="error-copy">${escapeHTML(task.error)}</p>` : ''}
      ${approval ? `<button data-focus-approval="${escapeHTML(approval.approvalId)}">Review approval</button>` : ''}
      ${payment ? `<button class="secondary" data-focus-payment="${escapeHTML(payment.paymentId)}">View payment proof</button>` : ''}
    </section>
  `
}

function renderPaymentDecision(payment: PaymentRecord) {
  return `
    <section class="decision-card">
      <div class="decision-summary">
        <span>${escapeHTML(payment.mode || 'payment')}</span>
        <strong>${escapeHTML(payment.status || 'payment record')}</strong>
        <small>${escapeHTML(paymentAmount(payment))}</small>
      </div>
      <dl class="detail-grid">
        <div><dt>Payment</dt><dd>${escapeHTML(shortID(payment.paymentId))}</dd></div>
        <div><dt>Task</dt><dd>${escapeHTML(shortID(payment.taskId))}</dd></div>
        <div><dt>Provider</dt><dd>${escapeHTML(shortID(payment.providerPubkey))}</dd></div>
        <div><dt>Proof</dt><dd>${escapeHTML(payment.proofRef || 'pending')}</dd></div>
        <div><dt>Confirmed</dt><dd>${escapeHTML(payment.confirmedAt || 'not confirmed')}</dd></div>
      </dl>
    </section>
  `
}

function renderBuyerCard() {
  const card = state.agentCards.buyer
  if (!card) {
    return renderUnsetAgentCardWindow('buyer')
  }
  const buyer = card.manualFields.buyer || {}
  return `
    <article class="agent-card buyer-agent-card">
      <div class="agent-card-head">
        <span class="profile-avatar">BY</span>
        <div>
          <p class="message-meta">Buyer Card</p>
          <h3>${escapeHTML(buyer.displayName || 'Exora Buyer')}</h3>
        </div>
      </div>
      <p>${escapeHTML(buyer.notes || 'Request resources, compare provider cards, approve work, and keep transaction records under local owner control.')}</p>
      <dl class="detail-grid">
        <div><dt>Status</dt><dd>${escapeHTML(card.status)}</dd></div>
        <div><dt>Budget</dt><dd>${escapeHTML(buyer.budget || 'not set')}</dd></div>
        <div><dt>Tasks</dt><dd>${escapeHTML(listSummary(buyer.acceptedTaskTypes))}</dd></div>
        <div><dt>Risk</dt><dd>${escapeHTML(buyer.riskBoundary || 'not set')}</dd></div>
        <div><dt>Authorization</dt><dd>${escapeHTML(buyer.authorizationStrategy || 'not set')}</dd></div>
        <div><dt>Disclosure</dt><dd>${escapeHTML(disclosureSummary(card))}</dd></div>
        <div><dt>Agent</dt><dd>${escapeHTML(card.agentId || 'not set')}</dd></div>
        <div><dt>Diagnostics</dt><dd>${escapeHTML(diagnosticsSummary(card.diagnostics))}</dd></div>
        <div><dt>Updated</dt><dd>${escapeHTML(shortDate(card.updatedAt))}</dd></div>
      </dl>
      ${renderSystemAttributes(card)}
      <div class="decision-actions">
        <button type="button" data-card-action="edit" data-card-role="buyer">Edit card</button>
        <button type="button" data-card-action="publish" data-card-role="buyer">Publish</button>
        <button type="button" class="secondary" data-card-action="open-work">Records</button>
      </div>
    </article>
  `
}

function renderSellerCard() {
  const card = state.agentCards.seller
  const settings = state.sellerSettings
  const market = state.sellerMarketStatus
  if (!card) {
    return renderUnsetAgentCardWindow('seller')
  }
  const seller = card.manualFields.seller || {}
  const providerId = market?.providerId || settings?.providerId || 'not configured'
  const sellerNote = seller.capabilitySummary || 'Offer local provider capability, let buyer agents discover this card, and keep risky actions under local owner control.'
  return `
    <article class="agent-card seller-agent-card">
      <div class="agent-card-head">
        <span class="profile-avatar">SL</span>
        <div>
          <p class="message-meta">Seller Card</p>
          <h3>${escapeHTML(seller.displayName || providerId || 'Exora Seller')}</h3>
        </div>
      </div>
      <p>${escapeHTML(sellerNote)}</p>
      <dl class="detail-grid">
        <div><dt>Status</dt><dd>${escapeHTML(card.status)}</dd></div>
        <div><dt>Capabilities</dt><dd>${escapeHTML(listSummary(seller.capabilityTypes))}</dd></div>
        <div><dt>Pricing</dt><dd>${escapeHTML(seller.pricing || 'not set')}</dd></div>
        <div><dt>Availability</dt><dd>${escapeHTML(seller.availability || 'not set')}</dd></div>
        <div><dt>Policy</dt><dd>${escapeHTML(seller.humanConfirmation || 'not set')}</dd></div>
        <div><dt>Outputs</dt><dd>${escapeHTML(listSummary(seller.outputFormats))}</dd></div>
        <div><dt>Disclosure</dt><dd>${escapeHTML(disclosureSummary(card))}</dd></div>
        <div><dt>Agent</dt><dd>${escapeHTML(card.agentId || 'not set')}</dd></div>
        <div><dt>Diagnostics</dt><dd>${escapeHTML(diagnosticsSummary(card.diagnostics))}</dd></div>
        <div><dt>Updated</dt><dd>${escapeHTML(shortDate(card.updatedAt))}</dd></div>
      </dl>
      ${renderSystemAttributes(card)}
      <div class="decision-actions">
        <button type="button" data-card-action="edit" data-card-role="seller">Edit card</button>
        <button type="button" data-card-action="publish" data-card-role="seller">Publish</button>
        <button type="button" class="secondary" data-card-action="open-work">Records</button>
      </div>
    </article>
  `
}

function renderUnsetAgentCardWindow(role: AgentCardRole) {
  const isBuyer = role === 'buyer'
  return `
    <article class="agent-card ${isBuyer ? 'buyer-agent-card' : 'seller-agent-card'} setup-agent-card setup-window-card">
      <div class="agent-setup-window">
        <div class="setup-window-titlebar">
          <span></span><span></span><span></span>
          <strong>${isBuyer ? 'Buyer Card' : 'Seller Card'}</strong>
        </div>
        <div class="setup-window-body">
          <span class="profile-avatar">${isBuyer ? 'BY' : 'SL'}</span>
          <h3>${isBuyer ? 'Buyer card not set' : 'Seller card not set'}</h3>
          <p>${isBuyer ? 'Add a short note and scan the local environment.' : 'Add a short provider note and scan the local environment.'}</p>
          <button type="button" data-card-action="setup-card" data-card-role="${role}">${isBuyer ? 'Set up buyer card' : 'Set up seller card'}</button>
        </div>
      </div>
    </article>
  `
}

function renderAgentCardEditor(role: AgentCardRole) {
  return renderAgentCardSetupList(role)
}

function renderAgentCardSettingsPage(role: AgentCardRole) {
  return renderAgentCardSetupList(role)
}

function renderAgentCardSetupList(role: AgentCardRole) {
  const isBuyer = role === 'buyer'
  const card = cardForRole(role)
  const manual = isBuyer ? card?.manualFields.buyer || {} : card?.manualFields.seller || {}
  const fields = isBuyer ? renderBuyerCardFields(manual as BuyerManualFields) : renderSellerCardFields(manual as SellerManualFields)
  const diagnosticsTask = state.cardDiagnosticsTasks[role]
  const actionMessage = state.activeCardEditor === role ? state.cardMessage : ''
  const messageText = actionMessage && actionMessage !== diagnosticsTask?.message ? actionMessage : ''
  const message = messageText
    ? `
      <div class="card-setup-row card-message-row">
        <span class="field-label">${t('card.status')}</span>
        <small class="field-help">${t('card.recentAction')}</small>
        <strong class="diagnostic-value">${escapeHTML(messageText)}</strong>
      </div>
    `
    : ''
  return `
    <form class="agent-card-form card-setup-list agent-card-settings-form" data-agent-card-form="${role}">
      ${message}
      ${fields}
      ${renderAgentCardDiagnosticRows(card)}
    </form>
    ${renderAgentCardActionBar(role)}
  `
}

function renderAgentCardActionBar(role: AgentCardRole) {
  const diagnosing = state.cardDiagnosticsTasks[role]?.running === true
  const hasUnsavedChanges = agentCardHasUnsavedChanges(role)
  const scanStatus = agentCardScanStatusText(role)
  return `
    <div class="card-setup-actionbar card-scan-actionbar" aria-label="Agent card environment scan">
      <button type="button" class="card-action-button diagnose-card-action ${diagnosing ? 'is-running' : ''}" data-card-action="${diagnosing ? 'stop-diagnose' : 'diagnose'}" data-card-role="${role}" ${diagnosing ? 'aria-busy="true"' : ''}>
        <span class="card-action-icon">${diagnosing ? windowIcons.close : cardActionIcons.diagnose}</span>
        <span class="card-action-text">${diagnosing ? 'Stop scan' : 'Scan environment'}</span>
      </button>
      <span class="card-scan-status" title="${escapeAttr(scanStatus)}">${escapeHTML(scanStatus)}</span>
    </div>
    <div class="card-setup-actionbar card-save-actionbar" aria-label="Agent card actions">
      <button type="button" class="card-action-button save-card-action ${hasUnsavedChanges ? 'is-dirty' : 'is-saved'}" data-card-action="save" data-card-role="${role}" title="${hasUnsavedChanges ? 'Save local changes' : 'Current card is saved'}">
        <span class="card-action-icon">${hasUnsavedChanges ? cardActionIcons.save : cardActionIcons.saved}</span>
        <span class="card-action-text">${hasUnsavedChanges ? 'Save local' : 'Saved'}</span>
      </button>
      <button type="button" class="card-action-button publish-card-action" data-card-action="publish" data-card-role="${role}" title="Save and publish this card to Exora Cloud">
        <span class="card-action-icon">${cardActionIcons.publish}</span>
        <span class="card-action-text">Publish</span>
      </button>
    </div>
  `
}

function agentCardScanStatusText(role: AgentCardRole) {
  const task = state.cardDiagnosticsTasks[role]
  if (task?.message) return uiText(task.message)
  const card = cardForRole(role)
  if (card?.diagnostics) return uiText('Environment scan complete. System and dependency details are ready.')
  return uiText('Not checked')
}

function renderAgentCardDiagnosticRows(card?: AgentCard) {
  if (!card) {
    return `
      <div class="agent-env-empty">
        <strong>Environment diagnostics are not collected yet.</strong>
        <span>Run diagnostics to fill system, GPU, code runtime, and dependency versions.</span>
      </div>
    `
  }
  const diagnostics = card.diagnostics
  return `
    <div class="agent-env-dashboard">
      ${renderDiagnosticGroup('System', diagnosticSystemItems(diagnostics))}
      ${renderDiagnosticGroup('GPU / CUDA', diagnosticGpuCudaItems(diagnostics))}
      ${renderDiagnosticGroup('Python Environment', diagnosticPythonEnvironmentItems(diagnostics))}
      ${renderDiagnosticGroup('Python Packages', diagnosticPythonPackageItems(diagnostics))}
      ${renderOptionalDiagnosticGroup('Other Runtime', diagnosticOtherRuntimeItems(diagnostics))}
      ${renderOptionalDiagnosticGroup('Other Dependencies', diagnosticOtherDependencyItems(diagnostics))}
    </div>
  `
}

function renderDiagnosticGroup(title: string, items: Array<[string, string]>) {
  const visible = items.filter(([, value]) => value && value !== 'not detected')
  const rows = (visible.length ? visible : [['Status', 'not detected']]).map(([label, value]) => `
    <div class="agent-env-item">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
    </div>
  `).join('')
  const wideClass = title.includes('Packages') || title.includes('Dependencies') ? ' wide' : ''
  return `
    <section class="agent-env-group${wideClass}">
      <h3>${escapeHTML(title)}</h3>
      <div class="agent-env-grid">${rows}</div>
    </section>
  `
}

function renderOptionalDiagnosticGroup(title: string, items: Array<[string, string]>) {
  const visible = items.filter(([, value]) => value && value !== 'not detected')
  if (!visible.length) return ''
  return renderDiagnosticGroup(title, items)
}

function renderBuyerCardFields(buyer: BuyerManualFields) {
  return `
    <label class="card-setup-row card-field-row"><span class="field-label">Display name</span><small class="field-help">Public name for this local buyer card.</small><input name="displayName" value="${escapeAttr(buyer.displayName || '')}" placeholder="Local buyer agent" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Supported agents</span><small class="field-help">Comma-separated local agents that can drive this buyer card.</small><input name="supportedAgentTypes" value="${escapeAttr(listInput(buyer.supportedAgentTypes))}" placeholder="Codex, Claude Code, OpenCode, Exora agent" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Budget</span><small class="field-help">Default budget boundary shown to sellers.</small><input name="budget" value="${escapeAttr(buyer.budget || '')}" placeholder="80 USDC / task" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Accepted tasks</span><small class="field-help">Comma-separated task categories this buyer may route externally.</small><input name="acceptedTaskTypes" value="${escapeAttr(listInput(buyer.acceptedTaskTypes))}" placeholder="compute, research, data, code, automation" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Preferences</span><small class="field-help">Comma-separated seller or execution preferences.</small><input name="preferences" value="${escapeAttr(listInput(buyer.preferences))}" placeholder="escrow, reproducible output, short retention" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Risk boundary</span><small class="field-help">What this buyer will not route without owner review.</small><textarea name="riskBoundary" placeholder="Low-risk compute, research, data, code, and automation only.">${escapeHTML(buyer.riskBoundary || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Authorization</span><small class="field-help">Owner approval rules for payments, disclosure, writes, and publishing.</small><textarea name="authorizationStrategy" placeholder="Human confirmation is required for payments, file disclosure, external writes, and public publishing.">${escapeHTML(buyer.authorizationStrategy || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Identity disclosure</span><small class="field-help">Identity information allowed before consent.</small><textarea name="identityDisclosure" placeholder="Minimal identity disclosure before consent.">${escapeHTML(buyer.identityDisclosure || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">File disclosure</span><small class="field-help">File metadata and content rules for seller matching.</small><textarea name="fileDisclosure" placeholder="Task-scoped file metadata only unless the owner confirms more.">${escapeHTML(buyer.fileDisclosure || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Data retention</span><small class="field-help">How long sellers may retain task inputs.</small><textarea name="dataRetention" placeholder="Inputs may only be retained for the active task unless separately approved.">${escapeHTML(buyer.dataRetention || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Escrow preference</span><small class="field-help">Payment proof or escrow preference for paid work.</small><textarea name="escrowPreference" placeholder="Use escrow or verifiable payment proof for paid work.">${escapeHTML(buyer.escrowPreference || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Note</span><small class="field-help">Short owner-facing summary for this buyer card.</small><textarea name="notes" placeholder="Local buyer card for testing seller discovery and order approval.">${escapeHTML(buyer.notes || '')}</textarea></label>
  `
}

function renderSellerCardFields(seller: SellerManualFields) {
  const settings = state.sellerSettings
  const autoQuote = seller.autoQuote ?? settings?.autoQuote ?? false
  const autoAcceptLowRisk = seller.autoAcceptLowRisk ?? Boolean(settings?.autoAcceptLowRisk || settings?.autoCompleteTextTasks)
  return `
    <label class="card-setup-row card-field-row"><span class="field-label">Display name</span><small class="field-help">Public name for this local seller card.</small><input name="displayName" value="${escapeAttr(seller.displayName || '')}" placeholder="Local provider agent" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Capability summary</span><small class="field-help">Short provider capability description shown in market search.</small><textarea name="capabilitySummary" placeholder="Local seller card for safely offering compute, code, or agent work.">${escapeHTML(seller.capabilitySummary || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Capability types</span><small class="field-help">Comma-separated capability classes.</small><input name="capabilityTypes" value="${escapeAttr(listInput(seller.capabilityTypes))}" placeholder="Skill Capability, Managed API Capability" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Pricing</span><small class="field-help">Public pricing policy or quote default summary.</small><textarea name="pricing" placeholder="10 USDC per lightweight job; task-specific quotes may adjust.">${escapeHTML(seller.pricing || sellerPricingSummary(settings))}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Availability</span><small class="field-help">When this seller agent can accept work.</small><textarea name="availability" placeholder="Enabled locally; availability is checked during seller-agent negotiation.">${escapeHTML(seller.availability || sellerAvailabilitySummary(settings))}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Human confirmation</span><small class="field-help">Actions requiring provider owner confirmation.</small><textarea name="humanConfirmation" placeholder="Human confirmation is required for external writes, payments, credential use, and public disclosure.">${escapeHTML(seller.humanConfirmation || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Data boundary</span><small class="field-help">How buyer inputs are scoped and retained.</small><textarea name="dataBoundary" placeholder="Buyer inputs are task-scoped and are not reused for training or resale without consent.">${escapeHTML(seller.dataBoundary || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Managed APIs</span><small class="field-help">Names only; do not include keys, tokens, or private endpoints.</small><input name="managedApis" value="${escapeAttr(listInput(seller.managedApis))}" placeholder="OpenAI-compatible LLM, browser automation" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">Output formats</span><small class="field-help">Comma-separated outputs this seller returns.</small><input name="outputFormats" value="${escapeAttr(listInput(seller.outputFormats))}" placeholder="artifact, log summary, receipt" /></label>
    <label class="card-setup-row card-field-row inline-check-row"><span class="field-label">Auto quote</span><small class="field-help">Mirrors the seller-agent quote policy.</small><input name="autoQuote" type="hidden" value="false" /><span class="inline-check-control"><input name="autoQuote" type="checkbox" value="true"${autoQuote ? ' checked' : ''} /> Auto quote new tasks</span></label>
    <label class="card-setup-row card-field-row inline-check-row"><span class="field-label">Low-risk auto accept</span><small class="field-help">Mirrors the seller-agent low-risk acceptance policy.</small><input name="autoAcceptLowRisk" type="hidden" value="false" /><span class="inline-check-control"><input name="autoAcceptLowRisk" type="checkbox" value="true"${autoAcceptLowRisk ? ' checked' : ''} /> Auto accept low-risk work</span></label>
    <label class="card-setup-row card-field-row"><span class="field-label">External write policy</span><small class="field-help">Rules for writing outside local task outputs.</small><textarea name="externalWritePolicy" placeholder="External writes require explicit owner approval.">${escapeHTML(seller.externalWritePolicy || '')}</textarea></label>
  `
}

function cardForRole(role: AgentCardRole) {
  return state.cardDrafts[role] || (role === 'buyer' ? state.agentCards.buyer : state.agentCards.seller)
}

function savedCardForRole(role: AgentCardRole) {
  return role === 'buyer' ? state.agentCards.buyer : state.agentCards.seller
}

function agentCardHasUnsavedChanges(role: AgentCardRole, form?: HTMLFormElement) {
  const saved = savedCardForRole(role)
  const working = cardForRole(role)
  if (!saved) return true
  if (!working) return true
  return stableComparable(agentCardComparable(working, role, form)) !== stableComparable(agentCardComparable(saved, role))
}

function agentCardComparable(card: AgentCard, role: AgentCardRole, form?: HTMLFormElement) {
  const manualFields = form ? agentCardManualFieldsFromForm(role, form, card.manualFields) : { ...card.manualFields }
  return {
    role: card.role,
    status: card.status,
    dockId: card.dockId,
    agentId: card.agentId,
    cardVersion: card.cardVersion,
    manualFields,
    diagnostics: card.diagnostics,
    disclosure: card.disclosure,
  }
}

function stableComparable(value: unknown) {
  return JSON.stringify(normalizeComparable(value) ?? null)
}

function normalizeComparable(value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (Array.isArray(value)) {
    const items = value.map(normalizeComparable).filter((item) => item !== undefined)
    return items.length ? items : undefined
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      const next = normalizeComparable(source[key])
      if (next !== undefined) result[key] = next
    }
    return Object.keys(result).length ? result : undefined
  }
  return value
}

function renderSystemAttributes(card: AgentCard) {
  const diagnostics = card.diagnostics
  const visibility = card.status === 'published' ? 'published card payload' : 'local until published'
  return `
    <section class="system-attributes">
      <div class="system-attributes-head">
        <strong>Environment</strong>
        <span>${visibility}</span>
      </div>
      <dl class="detail-grid system-attribute-grid">
        <div><dt>OS</dt><dd>${escapeHTML(systemOSSummary(diagnostics))}</dd></div>
        <div><dt>CPU</dt><dd>${escapeHTML(systemCPUSummary(diagnostics))}</dd></div>
        <div><dt>Memory</dt><dd>${escapeHTML(diagnostics.ramGb ? `${diagnostics.ramGb}GB RAM` : 'not detected')}</dd></div>
        <div><dt>GPU</dt><dd>${escapeHTML(systemGPUSummary(diagnostics))}</dd></div>
        <div><dt>Disk</dt><dd>${escapeHTML(systemStorageSummary(diagnostics))}</dd></div>
        <div><dt>Python</dt><dd>${escapeHTML(systemPythonSummary(diagnostics))}</dd></div>
        <div><dt>Packages</dt><dd>${escapeHTML(pythonPackageSummary(diagnostics))}</dd></div>
      </dl>
    </section>
  `
}

function systemOSSummary(diagnostics: AgentCardDiagnostics) {
  const kernel = diagnostics.kernelVersion ? `kernel ${diagnostics.kernelVersion}` : ''
  return [diagnostics.osVersion || diagnostics.os, diagnostics.arch, kernel].filter(Boolean).join(' / ') || 'not detected'
}

function systemCPUSummary(diagnostics: AgentCardDiagnostics) {
  const cores = diagnostics.cpuCores ? `${diagnostics.cpuCores} CPU` : ''
  return [cores, diagnostics.cpuModel].filter(Boolean).join(' / ') || 'not detected'
}

function systemGPUSummary(diagnostics: AgentCardDiagnostics) {
  const gpus = diagnostics.gpus || []
  if (!gpus.length) return 'not detected'
  return gpus.map(gpuSummary).join(' / ')
}

function diagnosticSystemItems(diagnostics: AgentCardDiagnostics): Array<[string, string]> {
  return [
    ['OS', systemOSSummary(diagnostics)],
    ['CPU', systemCPUSummary(diagnostics)],
    ['Memory', diagnostics.ramGb ? `${diagnostics.ramGb}GB RAM` : 'not detected'],
    ['Storage', systemStorageSummary(diagnostics)],
  ]
}

function diagnosticGpuCudaItems(diagnostics: AgentCardDiagnostics): Array<[string, string]> {
  const rows: Array<[string, string]> = []
  const gpus = diagnostics.gpus || []
  if (gpus.length) {
    rows.push(...gpus.map((gpu, index) => [`GPU ${index + 1}`, gpuSummary(gpu)] as [string, string]))
  } else {
    rows.push(['GPU', 'not detected'])
  }
  rows.push(...diagnosticCodeEnvironmentItems(diagnostics).filter(isCudaEnvironmentItem).map((item) => [item.name, formatDependencyValue(item)] as [string, string]))
  return rows
}

function gpuSummary(gpu: NonNullable<AgentCardDiagnostics['gpus']>[number]) {
  const details = [
    gpu.chip && !sameText(gpu.chip, gpu.name) ? gpu.chip : '',
    gpu.deviceId ? `ID ${gpu.deviceId}` : '',
    gpu.vramGb ? `${gpu.vramGb}GB VRAM` : '',
    gpu.driverVersion ? `driver ${gpu.driverVersion}` : '',
  ].filter(Boolean)
  return [gpu.name, details.length ? `(${details.join(' / ')})` : ''].filter(Boolean).join(' ')
}

function sameText(left?: string, right?: string) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase()
}

function systemStorageSummary(diagnostics: AgentCardDiagnostics) {
  const storage = diagnostics.storage?.[0]
  if (!storage) return 'not detected'
  const parts = [
    typeof storage.freeGb === 'number' ? `${storage.freeGb}GB free` : '',
    typeof storage.totalGb === 'number' ? `${storage.totalGb}GB total` : '',
    typeof storage.usedPercent === 'number' ? `${storage.usedPercent}% used` : '',
  ].filter(Boolean)
  return parts.join(' / ') || 'not detected'
}

function systemPythonSummary(diagnostics: AgentCardDiagnostics) {
  const parts = diagnosticPythonEnvironmentItems(diagnostics, { location: false }).map(([, value]) => value)
  return parts.join(' / ') || 'not detected'
}

function pythonPackageSummary(diagnostics: AgentCardDiagnostics) {
  const packages = diagnosticPythonPackageDependencies(diagnostics)
  return packages.length ? `${packages.length} Python packages recorded` : 'not detected'
}

function diagnosticPythonEnvironmentItems(diagnostics: AgentCardDiagnostics, options: { location?: boolean; source?: boolean } = {}): Array<[string, string]> {
  const fromDiagnostics = diagnosticCodeEnvironmentItems(diagnostics)
    .filter(isPythonEnvironmentItem)
    .map((item) => [item.name, formatDependencyValue(item, options)] as [string, string])
  if (fromDiagnostics.length) return fromDiagnostics
  return [
    diagnostics.pythonVersion ? ['Python', diagnostics.pythonVersion] : undefined,
  ].filter(Boolean) as Array<[string, string]>
}

function diagnosticPythonPackageItems(diagnostics: AgentCardDiagnostics): Array<[string, string]> {
  const packages = diagnosticPythonPackageDependencies(diagnostics)
  if (!packages.length) return [['Python packages', 'not detected']]
  const selected = packages.slice(0, 18)
  const rows = selected.map((item) => [item.name, formatDependencyValue(item)] as [string, string])
  if (packages.length > selected.length) {
    rows.push(['More', `${packages.length - selected.length} more Python packages recorded in the card payload`])
  }
  return rows
}

function diagnosticOtherRuntimeItems(diagnostics: AgentCardDiagnostics): Array<[string, string]> {
  const fromDiagnostics = diagnosticCodeEnvironmentItems(diagnostics)
    .filter((item) => !isPythonEnvironmentItem(item) && !isCudaEnvironmentItem(item))
    .slice(0, 10)
    .map((item) => [item.name, formatDependencyValue(item)] as [string, string])
  if (fromDiagnostics.length) return fromDiagnostics
  return [
    diagnostics.dockerAvailable ? ['Docker', diagnostics.dockerVersion || 'Docker'] : undefined,
    diagnostics.nodeVersion ? ['Node.js', `Node ${diagnostics.nodeVersion}`] : undefined,
    diagnostics.npmVersion ? ['npm', `npm ${diagnostics.npmVersion}`] : undefined,
    diagnostics.mcpAvailable ? ['MCP', diagnostics.mcpEntrypoint || 'available'] : undefined,
  ].filter(Boolean) as Array<[string, string]>
}

function diagnosticOtherDependencyItems(diagnostics: AgentCardDiagnostics): Array<[string, string]> {
  const dependencies = diagnostics.dependencies || []
  if (!dependencies.length) return []
  const otherDeps = dependencies.filter((item) => !isPythonPackageItem(item) && !isCudaEnvironmentItem(item))
  const desktopDeps = otherDeps.filter((item) => item.source?.includes('desktop'))
  const goDeps = otherDeps.filter((item) => item.source === 'go module')
  const selected = uniqueDiagnosticDependencies([...desktopDeps, ...goDeps, ...otherDeps]).slice(0, 10)
  const rows = selected.map((item) => [item.name, formatDependencyValue(item, { source: true })] as [string, string])
  if (otherDeps.length > selected.length) {
    rows.push(['More', `${otherDeps.length - selected.length} more secondary dependencies recorded`])
  }
  return rows
}

function diagnosticCodeEnvironmentItems(diagnostics: AgentCardDiagnostics) {
  return diagnostics.codeEnvironment || []
}

function diagnosticPythonPackageDependencies(diagnostics: AgentCardDiagnostics) {
  return uniqueDiagnosticDependencies((diagnostics.dependencies || []).filter(isPythonPackageItem))
}

function uniqueDiagnosticDependencies(items: NonNullable<AgentCardDiagnostics['dependencies']>) {
  const seen = new Set<string>()
  const out: NonNullable<AgentCardDiagnostics['dependencies']> = []
  for (const item of items) {
    const key = `${item.source || ''}:${item.name}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function isPythonEnvironmentItem(item: { name?: string; source?: string }) {
  const name = String(item.name || '').toLowerCase()
  const source = String(item.source || '').toLowerCase()
  return source.includes('python') || name === 'python' || name === 'pip'
}

function isPythonPackageItem(item: { name?: string; source?: string }) {
  return String(item.source || '').toLowerCase().includes('python package')
}

function isCudaEnvironmentItem(item: { name?: string; source?: string }) {
  const name = String(item.name || '').toLowerCase()
  const source = String(item.source || '').toLowerCase()
  return source.includes('cuda') || name.includes('cuda') || name.includes('cudnn') || name.includes('nvidia')
}

function formatDependencyValue(item: { version?: string; source?: string; location?: string }, options: { location?: boolean; source?: boolean } = {}) {
  const showLocation = options.location !== false
  return [
    item.version || 'detected',
    options.source ? item.source : '',
    showLocation ? item.location : '',
  ].filter(Boolean).join(' / ') || 'detected'
}

function diagnosticsSummary(diagnostics?: AgentCardDiagnostics) {
  if (!diagnostics) return 'not detected'
  const parts = [
    diagnostics.os || '',
    diagnostics.cpuCores ? `${diagnostics.cpuCores} CPU` : '',
    diagnostics.ramGb ? `${diagnostics.ramGb}GB RAM` : '',
    diagnostics.gpus?.length ? `${diagnostics.gpus.length} GPU` : '',
    diagnostics.storage?.[0]?.freeGb ? `${diagnostics.storage[0].freeGb}GB free` : '',
    diagnostics.dockerAvailable ? 'Docker' : '',
  ].filter(Boolean)
  return parts.join(' / ') || 'safe diagnostics'
}

function listSummary(values?: string[]) {
  if (!values?.length) return 'not set'
  return values.slice(0, 3).join(', ')
}

function disclosureSummary(card: AgentCard) {
  const entries = Object.entries(card.disclosure || {})
  if (!entries.length) return 'default disclosure'
  return entries
    .filter(([key]) => key !== 'credentials')
    .slice(0, 4)
    .map(([key, level]) => `${key}: ${level}`)
    .join(', ')
}

function listInput(values?: string[]) {
  return values?.join(', ') || ''
}

function parseListInput(value: FormDataEntryValue | null) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function sellerPricingSummary(settings?: SellerSettings) {
  if (!settings) return ''
  const price = Number(settings.quotePrice || 0)
  const currency = settings.currency || 'USDC'
  const eta = Number(settings.estimatedSeconds || 0)
  const parts = [
    price > 0 ? `${price} ${currency}` : '',
    eta > 0 ? `${eta}s ETA` : '',
  ].filter(Boolean)
  return parts.length ? `${parts.join(' / ')} default; task-specific quotes may adjust.` : ''
}

function sellerAvailabilitySummary(settings?: SellerSettings) {
  if (!settings?.enabled) return ''
  return 'Enabled locally; availability is checked during seller-agent negotiation.'
}

function shortDate(value?: string) {
  if (!value) return 'not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function escapeAttr(value: unknown) {
  return escapeHTML(value).replace(/`/g, '&#96;')
}

function renderCardMarket() {
  if (state.marketDetailProvider) {
    const candidate = marketCardByProvider(state.marketDetailProvider)
    if (candidate) return renderMarketDetailPage(candidate)
    state.marketDetailProvider = undefined
  }
  const cards = marketCandidateCards()
  return `
    <section class="card-market-panel">
      ${renderMarketSearchBar()}
      <div class="agent-card-grid">
        ${renderBuyerCard()}
        ${renderSellerCard()}
        ${cards.map(renderMarketCard).join('')}
        ${marketTransactionEntries().length ? renderPreparedWorkCard() : ''}
      </div>
    </section>
  `
}

function renderMarketSearchBar() {
  return `
    <form class="card-market-form" data-card-market-form>
      <input name="query" placeholder="${t('market.searchPlaceholder')}" autocomplete="off" />
      <button class="card-market-search-button" type="submit" aria-label="${t('market.searchCards')}" title="${translatePhrase('Search')}">${toolbarIcons.search}</button>
    </form>
  `
}

function renderPreparedWorkCard() {
  const count = marketTransactionEntries().length
  return `
    <article class="agent-card prepared-work-card">
      <div class="agent-card-head">
        <span class="profile-avatar">WK</span>
        <div>
          <p class="message-meta">Transactions</p>
          <h3>${count} traded order${count === 1 ? '' : 's'}</h3>
        </div>
      </div>
      <p>Market keeps the traded order ledger here. Active requests and task conversations stay in Work.</p>
      <button type="button" class="secondary" data-card-action="open-work">Open Work</button>
    </article>
  `
}

function renderMarketCard(candidate: SellerCandidate) {
  const resource = candidate.resource
  const title = resource?.name || shortID(candidate.providerPubkey)
  const capability = [
    resource?.type || 'provider',
    resource?.spec?.vramGb ? `${resource.spec.vramGb}GB VRAM` : '',
    resource?.spec?.gpuModel || '',
    resource?.spec?.region || '',
  ].filter(Boolean).join(' / ')
  const price = resource?.pricePerUnit
    ? `${trimDisplayNumber(resource.pricePerUnit)} / ${resource.billingUnit || 'unit'}`
    : 'quote on request'
  return `
    <article class="agent-card opponent-agent-card">
      <div class="agent-card-head">
        <span class="profile-avatar">${escapeHTML(title.slice(0, 2).toUpperCase())}</span>
        <div>
          <h3>${escapeHTML(title)}</h3>
          <p>${escapeHTML(shortID(candidate.providerPubkey))}</p>
        </div>
      </div>
      <p>${escapeHTML(resource?.summary || candidate.reasons?.[0] || 'Provider card discovered from market search.')}</p>
      <div class="chip-row">
        <span>${escapeHTML(capability || 'agent card')}</span>
        <span>score ${escapeHTML(String(candidate.score || 0))}</span>
        <span>${escapeHTML(price)}</span>
      </div>
      <div class="decision-actions two-buttons">
        <button type="button" class="secondary" data-market-card-detail="${escapeAttr(candidate.providerPubkey)}">${t('market.detail')}</button>
        <button type="button" data-market-card-chat="${escapeAttr(candidate.providerPubkey)}">${t('market.startChat')}</button>
      </div>
    </article>
  `
}

function renderMarketDetailPage(candidate: SellerCandidate) {
  const resource = candidate.resource
  const title = resource?.name || shortID(candidate.providerPubkey)
  const spec = resource?.spec || {}
  const price = resource?.pricePerUnit
    ? `${trimDisplayNumber(resource.pricePerUnit)} / ${resource.billingUnit || 'unit'}`
    : 'quote on request'
  return `
    <article class="agent-card market-detail-card opponent-agent-card">
      <div class="market-detail-top">
        <button type="button" class="secondary" data-market-detail-back>${t('market.backToCards')}</button>
      </div>
      <div class="agent-card-head">
        <span class="profile-avatar">${escapeHTML(title.slice(0, 2).toUpperCase())}</span>
        <div>
          <p class="message-meta">Seller Card</p>
          <h3>${escapeHTML(title)}</h3>
        </div>
      </div>
      <p>${escapeHTML(resource?.summary || candidate.reasons?.[0] || 'Provider card discovered from market search.')}</p>
      <dl class="detail-grid market-card-details">
        <div><dt>Provider</dt><dd>${escapeHTML(candidate.providerPubkey)}</dd></div>
        <div><dt>Resource</dt><dd>${escapeHTML(resource?.id || 'agent card')}</dd></div>
        <div><dt>Type</dt><dd>${escapeHTML(resource?.type || 'provider')}</dd></div>
        <div><dt>Score</dt><dd>${escapeHTML(String(candidate.score || 0))}</dd></div>
        <div><dt>Price</dt><dd>${escapeHTML(price)}</dd></div>
        <div><dt>Region</dt><dd>${escapeHTML(spec.region || 'not declared')}</dd></div>
        <div><dt>Runtime</dt><dd>${escapeHTML(spec.runtime || spec.gpuModel || resource?.type || 'agent')}</dd></div>
        <div><dt>GPU</dt><dd>${escapeHTML(spec.vramGb ? `${spec.gpuCount || 1} x ${spec.vramGb}GB ${spec.gpuModel || ''}` : 'not declared')}</dd></div>
        <div><dt>Dataset</dt><dd>${escapeHTML(spec.datasetSizeGb ? `${spec.datasetSizeGb}GB` : 'not declared')}</dd></div>
        <div><dt>Reason</dt><dd>${escapeHTML(candidate.reasons?.[0] || 'Matched from the card market.')}</dd></div>
      </dl>
      <div class="decision-actions">
        <button type="button" data-market-card-chat="${escapeAttr(candidate.providerPubkey)}">${t('market.startChat')}</button>
      </div>
    </article>
  `
}

function marketCandidateCards() {
  const byProvider = new Map<string, SellerCandidate>()
  for (const message of allChatMessages()) {
    for (const candidate of message.result?.candidates || []) {
      if (!byProvider.has(candidate.providerPubkey)) byProvider.set(candidate.providerPubkey, candidate)
    }
  }
  for (const plan of state.orderPlans) {
    for (const option of plan.options || []) {
      if (byProvider.has(option.providerPubkey)) continue
      byProvider.set(option.providerPubkey, {
        providerPubkey: option.providerPubkey,
        score: option.score || 0,
        reasons: [option.reason || plan.query || 'Prepared seller option.'],
        resource: {
          id: option.resourceId,
          name: option.resourceId || shortID(option.providerPubkey),
          type: option.draft?.requirements?.type ? String(option.draft.requirements.type) : 'resource',
          pricePerUnit: option.priceSnapshot?.pricePerUnit,
          billingUnit: option.priceSnapshot?.billingUnit,
        },
      })
    }
  }
  for (const card of featuredMarketCards()) {
    if (!byProvider.has(card.providerPubkey)) byProvider.set(card.providerPubkey, card)
  }
  return [...byProvider.values()].slice(0, 12)
}

function allChatMessages() {
  return state.chatThreads.flatMap((thread) => thread.messages)
}

function marketCardByProvider(providerPubkey: string) {
  return marketCandidateCards().find((candidate) => candidate.providerPubkey === providerPubkey)
}

function openMarketProjectPicker(candidate: SellerCandidate) {
  state.marketProjectPickerProvider = candidate.providerPubkey
  closeProfileMenu()
  closeProjectFolderMenu(false)
  closePermissionMenu(false)
  renderMarketProjectPicker()
}

function closeMarketProjectPicker() {
  if (!state.marketProjectPickerProvider) return
  state.marketProjectPickerProvider = undefined
  renderMarketProjectPicker()
}

function renderMarketProjectPicker() {
  const provider = state.marketProjectPickerProvider
  const candidate = provider ? marketCardByProvider(provider) : undefined
  fields.marketProjectPicker.classList.toggle('hidden', !candidate)
  if (!candidate) {
    fields.marketProjectDialog.innerHTML = ''
    return
  }

  const folders = state.projectFolders.length ? state.projectFolders : [activeProjectFolder()]
  const sellerTitle = candidate.resource?.name || shortID(candidate.providerPubkey)
  fields.marketProjectDialog.innerHTML = `
    <header class="market-project-head">
      <span class="market-project-icon">${toolbarIcons.folder}</span>
      <div>
        <strong>${t('market.chooseProject')}</strong>
        <small>${escapeHTML(t('market.startWithSeller', { seller: sellerTitle }))}</small>
      </div>
    </header>
    <div class="market-project-list">
      ${folders.map((folder) => `
        <button class="market-project-option" type="button" data-market-project-path="${escapeAttr(folder.path)}" title="${escapeAttr(folder.path)}">
          <span class="market-project-option-icon">${toolbarIcons.folder}</span>
          <span>${escapeHTML(compactText(folder.name, 42))}</span>
        </button>
      `).join('')}
    </div>
    <footer class="market-project-actions">
      <button class="secondary" type="button" data-action="close-market-project-picker">Cancel</button>
    </footer>
  `
  localize(fields.marketProjectDialog)
}

function selectMarketProject(path: string) {
  const provider = state.marketProjectPickerProvider
  const candidate = provider ? marketCardByProvider(provider) : undefined
  const folder = state.projectFolders.find((item) => sameProjectPath(item.path, path)) || activeProjectFolder()
  closeMarketProjectPicker()
  if (candidate) startMarketConversation(candidate, folder)
}

function startMarketConversation(candidate: SellerCandidate, folder: ProjectFolder) {
  const sellerTitle = candidate.resource?.name || shortID(candidate.providerPubkey)
  setProjectFolders([folder, ...state.projectFolders], folder.path)
  state.expandedProjectFolderPaths.add(projectPathKey(folder.path))
  const existing = state.chatThreads.find((thread) => (
    thread.providerPubkey === candidate.providerPubkey &&
    sameProjectPath(projectPathForChat(thread), folder.path)
  ))
  if (!existing) {
    const thread = createChatThread({
      title: t('market.taskTitle', { seller: sellerTitle }),
      providerPubkey: candidate.providerPubkey,
      projectPath: folder.path,
      origin: 'market-card',
      select: false,
    })
    thread.messages.push({
      id: nextID(),
      role: 'user',
      text: t('market.taskUserText', { seller: sellerTitle }),
      meta: 'Market Card',
      providerPubkey: candidate.providerPubkey,
    })
    thread.messages.push({
      id: nextID(),
      role: 'assistant',
      text: t('market.taskAssistantText', { seller: sellerTitle }),
      meta: `Seller Card / ${shortID(candidate.providerPubkey)}`,
      providerPubkey: candidate.providerPubkey,
    })
    thread.updatedAt = Date.now()
  }
  state.workOrderSide = 'buyer'
  state.chatMode = 'expanded'
  state.newConversationDraft = true
  state.selectedChatId = undefined
  state.selectedWorkThreadId = undefined
  state.selectedId = undefined
  state.marketDetailProvider = undefined
  setActiveView('chat')
  state.pinStep = undefined
  renderAll()
  showToast(t(existing ? 'toast.marketTaskExists' : 'toast.marketTaskAdded'))
}

function featuredMarketCards(): SellerCandidate[] {
  return [
    {
      providerPubkey: 'gpu-forge-a6000',
      score: 94,
      reasons: ['High-memory GPU card for model runs and evaluation batches.'],
      resource: {
        id: 'gpu-a6000-night-window',
        name: 'GPU Forge A6000',
        type: 'gpu',
        summary: '48GB VRAM workstation window for training, inference, and benchmark sweeps.',
        pricePerUnit: 2.4,
        billingUnit: 'hour',
        spec: { vramGb: 48, gpuCount: 1, gpuModel: 'RTX A6000', region: 'US West' },
      },
    },
    {
      providerPubkey: 'dataset-harbor',
      score: 88,
      reasons: ['Curated dataset access with fast handoff for research agents.'],
      resource: {
        id: 'filings-dataset-card',
        name: 'Dataset Harbor',
        type: 'dataset',
        summary: 'Structured filing snapshots and normalized metadata for diligence workflows.',
        pricePerUnit: 18,
        billingUnit: 'day',
        spec: { datasetSizeGb: 64, region: 'US East' },
      },
    },
    {
      providerPubkey: 'repo-maintainer-desk',
      score: 84,
      reasons: ['Codebase maintenance card for issue triage, tests, and patch preparation.'],
      resource: {
        id: 'repo-maintainer-card',
        name: 'Repo Maintainer Desk',
        type: 'repository',
        summary: 'On-demand repo worker for test triage, CI fixes, and small implementation tasks.',
        pricePerUnit: 12,
        billingUnit: 'task',
        spec: { region: 'Remote' },
      },
    },
    {
      providerPubkey: 'browser-runner-lab',
      score: 81,
      reasons: ['Reliable browser automation card for scraping and verification jobs.'],
      resource: {
        id: 'browser-runner-card',
        name: 'Browser Runner Lab',
        type: 'automation',
        summary: 'Headless browser sessions for market checks, screenshots, and web workflow QA.',
        pricePerUnit: 0.8,
        billingUnit: 'run',
        spec: { region: 'EU Central' },
      },
    },
  ]
}

function attachCardHandlers(root: ParentNode = fields.decisionContent) {
  root.querySelectorAll<HTMLButtonElement>('[data-card-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.cardAction || ''
      const role = button.dataset.cardRole as AgentCardRole | undefined
      if ((action === 'diagnose' || action === 'detect') && role) {
        startAgentCardDiagnostics(role, root)
      } else if (action === 'stop-diagnose' && role) {
        stopAgentCardDiagnostics(role)
      } else if (action === 'save' && role) {
        const form = findAgentCardForm(role, root, button)
        if (form) {
          run(async () => {
            await saveAgentCardFromForm(form, role)
            state.activeCardEditor = undefined
            renderDecisionPanel()
          }, 'Agent card saved.')
        }
      } else if (action === 'setup-card' && role) {
        openSettings(settingsViewForCardRole(role))
      } else if (action === 'edit' && role) {
        state.activeCardEditor = undefined
        state.cardMessage = ''
        openSettings(settingsViewForCardRole(role))
      } else if (action === 'publish' && role) {
        run(() => publishAgentCard(role, root))
      } else if (action === 'seller-settings') {
        openSettings('seller')
      } else if (action === 'cancel-edit') {
        state.activeCardEditor = undefined
        state.cardMessage = ''
        renderDecisionPanel()
      } else if (action === 'open-work') {
        setActiveView('chat')
        state.selectedId = defaultSelectionForView('work')
        renderAll()
      } else if (action === 'refresh') {
        run(async () => {
          await refreshSeller({ market: true })
          await refreshAgentCards()
        })
      }
    })
  })
  root.querySelectorAll<HTMLFormElement>('[data-agent-card-form]').forEach((form) => {
    const role = form.dataset.agentCardForm as AgentCardRole
    const syncSaveAction = () => updateCardSaveActionState(role, root)
    form.addEventListener('input', syncSaveAction)
    form.addEventListener('change', syncSaveAction)
    syncSaveAction()
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      run(async () => {
        await saveAgentCardFromForm(form, role)
        state.activeCardEditor = undefined
        renderDecisionPanel()
      }, 'Agent card saved.')
    })
  })
}

function updateCardSaveActionState(role: AgentCardRole, root: ParentNode = fields.decisionContent) {
  const button = root.querySelector<HTMLButtonElement>(`[data-card-action="save"][data-card-role="${role}"]`)
  const form = findAgentCardForm(role, root)
  if (!button || !form) return
  const hasUnsavedChanges = agentCardHasUnsavedChanges(role, form)
  button.classList.toggle('is-dirty', hasUnsavedChanges)
  button.classList.toggle('is-saved', !hasUnsavedChanges)
  button.title = hasUnsavedChanges ? t('card.saveDirtyTitle') : t('card.saveSavedTitle')
  button.setAttribute('aria-label', hasUnsavedChanges ? t('card.saveDirtyTitle') : t('card.saveSavedTitle'))
  const iconSlot = button.querySelector<HTMLElement>('.card-action-icon')
  const textSlot = button.querySelector<HTMLElement>('.card-action-text')
  if (iconSlot) iconSlot.innerHTML = hasUnsavedChanges ? cardActionIcons.save : cardActionIcons.saved
  if (textSlot) textSlot.textContent = hasUnsavedChanges ? t('card.saveDirtyText') : t('card.saveSavedText')
}

function attachCardMarketHandlers() {
  const searchForm = fields.decisionContent.querySelector<HTMLFormElement>('[data-card-market-form]')
  if (searchForm) {
    const searchInput = searchForm.querySelector<HTMLInputElement>('input[name="query"]')
    const syncSearchValueState = () => {
      searchForm.classList.toggle('has-value', Boolean(searchInput?.value.trim()))
    }
    syncSearchValueState()
    searchInput?.addEventListener('input', syncSearchValueState)
    searchInput?.addEventListener('blur', syncSearchValueState)
    searchForm.addEventListener('submit', (event) => {
      event.preventDefault()
      const query = new FormData(searchForm).get('query')?.toString().trim() || ''
      state.marketDetailProvider = undefined
      searchCardMarket(query)
    })
  }
  fields.decisionContent.querySelectorAll<HTMLButtonElement>('[data-market-card-query]').forEach((button) => {
    button.addEventListener('click', () => searchCardMarket(button.dataset.marketCardQuery || ''))
  })
  fields.decisionContent.querySelectorAll<HTMLButtonElement>('[data-market-card-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      const provider = button.dataset.marketCardDetail || ''
      state.marketSelectedId = undefined
      state.marketDetailProvider = provider
      renderDecisionPanel()
    })
  })
  fields.decisionContent.querySelectorAll<HTMLButtonElement>('[data-market-detail-back]').forEach((button) => {
    button.addEventListener('click', () => {
      state.marketDetailProvider = undefined
      renderDecisionPanel()
    })
  })
  fields.decisionContent.querySelectorAll<HTMLButtonElement>('[data-market-card-chat]').forEach((button) => {
    button.addEventListener('click', () => {
      const candidate = marketCardByProvider(button.dataset.marketCardChat || '')
      if (candidate) openMarketProjectPicker(candidate)
    })
  })
}

function renderPinStep(step: PinStep) {
  const actionText = pinActionText(step.action)
  return `
    <form class="pin-inline-form" data-pin-form>
      <section class="decision-card">
        <div class="decision-summary">
          <span>${step.setup ? 'local setup' : 'owner payment'}</span>
          <strong>${step.setup ? 'Set six-digit payment PIN' : 'Enter six-digit payment PIN'}</strong>
          <small>${escapeHTML(actionText)}</small>
        </div>
        <input data-pin-input type="password" inputmode="numeric" maxlength="6" autocomplete="off" aria-label="Payment PIN" />
        <div class="pin-grid" data-pin-grid>${pinCells(step.pin)}</div>
        ${step.setup ? `
          <input data-pin-confirm type="password" inputmode="numeric" maxlength="6" autocomplete="off" aria-label="Confirm payment PIN" />
          <div class="pin-grid" data-pin-confirm-grid>${pinCells(step.confirm)}</div>
        ` : ''}
        <div class="pin-error">${escapeHTML(step.error || '')}</div>
        <div class="decision-actions">
          <button class="secondary" type="button" data-pin-cancel>Cancel</button>
          <button type="submit">${step.setup ? 'Set PIN and Continue' : 'Confirm Payment'}</button>
        </div>
      </section>
    </form>
  `
}

function pinCells(value: string) {
  return Array.from({ length: 6 }).map((_, index) => `<span class="${value[index] ? 'filled' : ''}">${value[index] ? '*' : ''}</span>`).join('')
}

function attachDecisionHandlers(container: ParentNode = fields.decisionContent) {
  container.querySelectorAll<HTMLButtonElement>('[data-select-plan]').forEach((button) => {
    const plan = state.orderPlans.find((item) => item.planId === button.dataset.selectPlan)
    const option = plan?.options?.find((item) => item.optionId === button.dataset.optionId)
    button.addEventListener('click', () => plan && option && chooseOrderOption(plan, option))
  })
  container.querySelectorAll<HTMLButtonElement>('[data-cancel-plan]').forEach((button) => {
    const plan = state.orderPlans.find((item) => item.planId === button.dataset.cancelPlan)
    button.addEventListener('click', () => plan && cancelOrderPlan(plan))
  })
  container.querySelectorAll<HTMLButtonElement>('[data-approve]').forEach((button) => {
    const approval = state.approvals.find((item) => item.approvalId === button.dataset.approve)
    button.addEventListener('click', () => approval && chooseApproval(approval, true))
  })
  container.querySelectorAll<HTMLButtonElement>('[data-reject]').forEach((button) => {
    const approval = state.approvals.find((item) => item.approvalId === button.dataset.reject)
    button.addEventListener('click', () => approval && chooseApproval(approval, false))
  })
  container.querySelectorAll<HTMLButtonElement>('[data-focus-approval]').forEach((button) => {
    button.addEventListener('click', () => {
      const approval = state.approvals.find((item) => item.approvalId === button.dataset.focusApproval)
      if (approval) {
        const projectPath = projectPathForApproval(approval)
        setProjectFolderContext(projectPath)
        state.expandedProjectFolderPaths.add(projectPathKey(projectPath))
        state.selectedWorkThreadId = workThreadIdForApproval(approval)
      }
      state.newConversationDraft = false
      state.selectedId = selectionId('approval', button.dataset.focusApproval || '')
      setActiveView('chat')
      renderAll()
    })
  })
  container.querySelectorAll<HTMLButtonElement>('[data-focus-payment]').forEach((button) => {
    button.addEventListener('click', () => {
      const payment = state.payments.find((item) => item.paymentId === button.dataset.focusPayment)
      if (payment) {
        const projectPath = projectPathForPayment(payment)
        setProjectFolderContext(projectPath)
        state.expandedProjectFolderPaths.add(projectPathKey(projectPath))
        state.selectedWorkThreadId = workThreadIdForPayment(payment)
      }
      state.newConversationDraft = false
      state.selectedId = selectionId('payment', button.dataset.focusPayment || '')
      setActiveView('chat')
      renderAll()
    })
  })
}

function attachPinHandlers() {
  const form = fields.decisionContent.querySelector<HTMLFormElement>('[data-pin-form]')!
  const input = fields.decisionContent.querySelector<HTMLInputElement>('[data-pin-input]')!
  const confirm = fields.decisionContent.querySelector<HTMLInputElement>('[data-pin-confirm]')
  const sanitize = (value: string) => value.replace(/\D/g, '').slice(0, 6)
  input.value = state.pinStep?.pin || ''
  if (confirm) confirm.value = state.pinStep?.confirm || ''
  input.addEventListener('input', () => {
    if (!state.pinStep) return
    state.pinStep.pin = sanitize(input.value)
    input.value = state.pinStep.pin
    updatePinGrid('[data-pin-grid]', state.pinStep.pin)
    if (!state.pinStep.setup && state.pinStep.pin.length === 6) form.requestSubmit()
  })
  confirm?.addEventListener('input', () => {
    if (!state.pinStep) return
    state.pinStep.confirm = sanitize(confirm.value)
    confirm.value = state.pinStep.confirm
    updatePinGrid('[data-pin-confirm-grid]', state.pinStep.confirm)
  })
  fields.decisionContent.querySelector<HTMLButtonElement>('[data-pin-cancel]')?.addEventListener('click', () => {
    state.pinStep = undefined
    renderDecisionPanel()
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    submitPinStep()
  })
  input.focus()
}

function updatePinGrid(selector: string, value: string) {
  const grid = fields.decisionContent.querySelector<HTMLElement>(selector)
  if (grid) grid.innerHTML = pinCells(value)
}

async function chooseOrderOption(plan: OrderPlan, option: OrderDraftOption) {
  const projectPath = projectPathForPlan(plan)
  setProjectFolderContext(projectPath)
  state.expandedProjectFolderPaths.add(projectPathKey(projectPath))
  state.newConversationDraft = false
  state.selectedId = selectionId('plan', plan.planId)
  state.selectedWorkThreadId = workThreadIdForPlan(plan)
  setActiveView('chat')
  if (!optionIsPaid(option)) {
    await executePlanSelection(plan.planId, option.optionId)
    return
  }
  const setup = !(await paymentPinConfigured())
  state.pinStep = { action: { kind: 'select_plan', planId: plan.planId, optionId: option.optionId }, setup, pin: '', confirm: '' }
  renderAll()
}

async function chooseApproval(approval: Approval, approved: boolean) {
  const projectPath = projectPathForApproval(approval)
  setProjectFolderContext(projectPath)
  state.expandedProjectFolderPaths.add(projectPathKey(projectPath))
  state.newConversationDraft = false
  state.selectedId = selectionId('approval', approval.approvalId)
  state.selectedWorkThreadId = workThreadIdForApproval(approval)
  setActiveView('chat')
  if (!approved) {
    await executeApproval(approval.approvalId, false)
    return
  }
  if (!approval.paymentRequired) {
    await executeApproval(approval.approvalId, true)
    return
  }
  const setup = !(await paymentPinConfigured())
  state.pinStep = { action: { kind: 'approve', approvalId: approval.approvalId }, setup, pin: '', confirm: '' }
  renderAll()
}

async function submitPinStep() {
  const step = state.pinStep
  if (!step) return
  if (!/^\d{6}$/.test(step.pin)) {
    step.error = 'Payment PIN must be exactly 6 digits.'
    renderDecisionPanel()
    return
  }
  if (step.setup && step.pin !== step.confirm) {
    step.error = 'PIN confirmation did not match.'
    renderDecisionPanel()
    return
  }

  setBusy(true)
  try {
    if (step.setup) {
      await invoke('set_payment_pin', { input: { pin: step.pin } })
    }
    if (step.action.kind === 'select_plan') {
      await executePlanSelection(step.action.planId, step.action.optionId, step.pin, false)
    } else if (step.action.kind === 'approve') {
      await executeApproval(step.action.approvalId, true, step.pin, false)
    }
  } catch (error) {
    step.error = humanizeError(error)
    renderDecisionPanel()
  } finally {
    setBusy(false)
    await refreshStatus()
    await refreshSeller()
  }
}

async function executePlanSelection(planId: string, optionId: string, paymentPin?: string, manageBusy = true) {
  if (manageBusy) setBusy(true)
  try {
    const response = await invoke<{ orderPlan?: OrderPlan; task?: Task; payment?: PaymentRecord }>('select_order_plan', {
      input: {
        planId,
        optionId,
        userNote: 'Seller selected in Exora Desktop Work view',
        paymentPin,
      },
    })
    state.pinStep = undefined
    bindActiveChatToTask(response.task)
    if (response.task?.id) state.selectedId = selectionId('task', response.task.id)
    pushMessage({ role: 'assistant', text: 'Owner selected a seller. The local ledger has been updated.', meta: 'Work' })
    await refreshWorkspace({ quiet: true })
  } catch (error) {
    if (!manageBusy) throw error
    showToast(humanizeError(error))
  } finally {
    if (manageBusy) {
      setBusy(false)
      await refreshStatus()
      await refreshSeller()
    }
  }
}

async function executeApproval(approvalId: string, approved: boolean, paymentPin?: string, manageBusy = true) {
  if (manageBusy) setBusy(true)
  try {
    const response = await invoke<{ task?: Task; payment?: PaymentRecord }>('decide_approval', {
      input: {
        approvalId,
        approved,
        userNote: approved ? 'Approved in Exora Desktop Work view' : 'Rejected in Exora Desktop Work view',
        paymentPin,
      },
    })
    state.pinStep = undefined
    bindActiveChatToTask(response.task)
    if (response.task?.id) state.selectedId = selectionId('task', response.task.id)
    pushMessage({ role: 'assistant', text: approved ? 'Approval accepted.' : 'Approval rejected.', meta: 'Work' })
    await refreshWorkspace({ quiet: true })
  } catch (error) {
    if (!manageBusy) throw error
    showToast(humanizeError(error))
  } finally {
    if (manageBusy) {
      setBusy(false)
      await refreshStatus()
      await refreshSeller()
    }
  }
}

async function cancelOrderPlan(plan: OrderPlan) {
  await run(
    async () => {
      await invoke('cancel_order_plan', {
        input: { planId: plan.planId, userNote: 'Cancelled in Exora Desktop Work view' },
      })
      pushMessage({ role: 'system', text: `Cancelled seller choice ${shortID(plan.planId)}.`, meta: 'Work' })
      await refreshWorkspace({ quiet: true })
    },
    'Seller choice cancelled.',
  )
}

async function paymentPinConfigured() {
  const status = await invoke<{ paymentPin?: { configured?: boolean } }>('payment_pin_status')
  return status.paymentPin?.configured === true
}

function localRequesterIds() {
  return new Set([state.walletStatus?.accountBound ? state.walletStatus.address : ''].map((item) => String(item || '').trim()).filter(Boolean))
}

function localProviderIds() {
  return new Set([
    state.sellerMarketStatus?.providerId,
    state.sellerSettings?.providerId,
    state.walletStatus?.accountBound ? state.walletStatus.address : '',
  ].map((item) => String(item || '').trim()).filter(Boolean))
}

function idMatches(id: string | undefined, ids: Set<string>) {
  const trimmed = String(id || '').trim()
  return Boolean(trimmed && ids.has(trimmed))
}

function selectedOptionForPlan(plan: OrderPlan) {
  return (plan.options || []).find((option) => option.optionId === plan.selectedOptionId) ||
    (plan.options || []).find((option) => option.realtimeStatus === 'quoted') ||
    (plan.options || [])[0]
}

function selectedProviderForPlan(plan: OrderPlan) {
  const option = selectedOptionForPlan(plan)
  return option?.providerPubkey ||
    (plan.candidates || []).find((candidate) => candidate.status === 'quoted')?.providerPubkey ||
    (plan.candidates || [])[0]?.providerPubkey ||
    ''
}

function orderSideForPlan(plan: OrderPlan): OrderSide {
  const task = taskForPlan(plan)
  if (task) return orderSideForTask(task)
  if (idMatches(selectedProviderForPlan(plan), localProviderIds())) return 'seller'
  if (idMatches(plan.requesterPubkey, localRequesterIds())) return 'buyer'
  return 'buyer'
}

function orderSideForApproval(approval: Approval): OrderSide {
  const task = state.tasks.find((item) => item.id === approval.taskId)
  if (task) return orderSideForTask(task)
  if (idMatches(approval.providerPubkey, localProviderIds())) return 'seller'
  return 'buyer'
}

function orderSideForTask(task: Task): OrderSide {
  if (idMatches(task.requesterPubkey, localRequesterIds())) return 'buyer'
  if (idMatches(task.providerPubkey || task.quote?.providerPubkey, localProviderIds())) return 'seller'
  return 'buyer'
}

function orderSideForPayment(payment: PaymentRecord): OrderSide {
  const task = payment.taskId ? state.tasks.find((item) => item.id === payment.taskId) : undefined
  if (task) return orderSideForTask(task)
  const approval = payment.approvalId ? state.approvals.find((item) => item.approvalId === payment.approvalId) : undefined
  if (approval) return orderSideForApproval(approval)
  return 'buyer'
}

function orderSideForChat(thread: ChatThread): OrderSide {
  for (const taskId of thread.taskIds || []) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (task) return orderSideForTask(task)
  }
  if (thread.orderId) {
    const task = state.tasks.find((item) => item.id === thread.orderId || item.orderId === thread.orderId)
    if (task) return orderSideForTask(task)
  }
  return 'buyer'
}

function defaultWorkProjectPath() {
  return state.projectFolders[0]?.path || fallbackProjectFolder().path
}

function projectPathForPlan(plan: OrderPlan) {
  if (plan.projectPath) return plan.projectPath
  if (plan.taskId) {
    const task = state.tasks.find((item) => item.id === plan.taskId)
    if (task?.projectPath) return task.projectPath
  }
  return defaultWorkProjectPath()
}

function projectPathForTask(task: Task) {
  if (task.projectPath) return task.projectPath
  const plan = state.orderPlans.find((item) => item.taskId === task.id || item.planId === task.orderId)
  if (plan?.projectPath) return plan.projectPath
  return defaultWorkProjectPath()
}

function projectPathForApproval(approval: Approval) {
  const task = state.tasks.find((item) => item.id === approval.taskId)
  return task ? projectPathForTask(task) : defaultWorkProjectPath()
}

function projectPathForPayment(payment: PaymentRecord) {
  const task = payment.taskId ? state.tasks.find((item) => item.id === payment.taskId) : undefined
  if (task) return projectPathForTask(task)
  const approval = payment.approvalId ? state.approvals.find((item) => item.approvalId === payment.approvalId) : undefined
  return approval ? projectPathForApproval(approval) : defaultWorkProjectPath()
}

function projectPathForChat(thread: ChatThread) {
  if (thread.projectPath) return thread.projectPath
  for (const taskId of thread.taskIds || []) {
    const task = state.tasks.find((item) => item.id === taskId)
    if (task) return projectPathForTask(task)
  }
  if (thread.orderId) {
    const plan = state.orderPlans.find((item) => item.planId === thread.orderId)
    if (plan) return projectPathForPlan(plan)
    const task = state.tasks.find((item) => item.id === thread.orderId || item.orderId === thread.orderId)
    if (task) return projectPathForTask(task)
  }
  return activeProjectFolder().path
}

function projectPathForSelection(selectionIdValue?: string) {
  const parsed = parseSelection(selectionIdValue)
  if (!parsed) return defaultWorkProjectPath()
  if (parsed.kind === 'plan') {
    const plan = state.orderPlans.find((item) => item.planId === parsed.id)
    return plan ? projectPathForPlan(plan) : defaultWorkProjectPath()
  }
  if (parsed.kind === 'approval') {
    const approval = state.approvals.find((item) => item.approvalId === parsed.id)
    return approval ? projectPathForApproval(approval) : defaultWorkProjectPath()
  }
  if (parsed.kind === 'task') {
    const task = state.tasks.find((item) => item.id === parsed.id)
    return task ? projectPathForTask(task) : defaultWorkProjectPath()
  }
  const payment = state.payments.find((item) => item.paymentId === parsed.id)
  return payment ? projectPathForPayment(payment) : defaultWorkProjectPath()
}

function projectPathIsActive(projectPath?: string) {
  return sameProjectPath(projectPath || defaultWorkProjectPath(), activeProjectFolder().path)
}

function workMCPLeaseIsActive(lease?: WorkMCPLease) {
  if (!lease || lease.status !== 'active') return false
  const expiresAt = sortTime(lease.expiresAt)
  return expiresAt > Date.now()
}

function activeExternalWorkLease() {
  const folder = activeProjectFolder()
  return state.workMcpLeases
    .filter((lease) => workMCPLeaseIsActive(lease) && sameProjectPath(lease.projectPath, folder.path))
    .sort((a, b) => sortTime(b.lastSeenAt || b.updatedAt || b.startedAt) - sortTime(a.lastSeenAt || a.updatedAt || a.startedAt))[0]
}

function workRunIsActive(run?: WorkRun) {
  if (!run || run.controller !== 'external-mcp') return false
  return ['queued', 'running', 'waiting_owner_choice', 'waiting_owner_approval', 'waiting_worker', 'stop_requested'].includes(run.status || '')
}

function activeExternalWorkRun() {
  const folder = activeProjectFolder()
  return state.workRuns
    .filter((run) => workRunIsActive(run) && sameProjectPath(run.projectPath || defaultWorkProjectPath(), folder.path))
    .sort((a, b) => sortTime(b.updatedAt || b.createdAt) - sortTime(a.updatedAt || a.createdAt))[0]
}

function builtInBuyerInputLocked() {
  return Boolean(activeExternalWorkLease() || activeExternalWorkRun())
}

function renderExternalWorkLockControls() {
  const lease = activeExternalWorkLease()
  const run = activeExternalWorkRun()
  const locked = Boolean(lease || run)
  fields.externalWorkLock.classList.toggle('hidden', !locked)
  if (lease || run) {
    const projectPath = lease?.projectPath || run?.projectPath || activeProjectFolder().path
    const name = lease?.projectName || projectFolderNameForPath(projectPath) || activeProjectFolder().name
    const client = lease?.clientName || 'external MCP agent'
    const step = run?.currentStep ? t('externalWork.step', { step: run.currentStep }) : ''
    fields.externalWorkLockText.textContent = t('externalWork.lockText', { client, name, step })
    fields.externalWorkTakeoverButton.disabled = state.busy
    fields.externalWorkTakeoverButton.setAttribute('title', t('externalWork.takeoverTitle'))
  }
  agentQuery.disabled = state.busy || locked
  agentSendButton.disabled = state.busy || locked
  agentQuery.placeholder = locked ? agentComposerLockedPlaceholder() : agentComposerPlaceholder()
}

function mergeOrderSide(thread: WorkThread, side: OrderSide) {
  if (side === 'seller') thread.side = 'seller'
}

function ledgerEntries(side: OrderSide = state.workOrderSide): LedgerEntry[] {
  const plans = state.orderPlans.filter((plan) => orderSideForPlan(plan) === side && projectPathIsActive(projectPathForPlan(plan))).map((plan) => ({
    id: selectionId('plan', plan.planId),
    kind: 'plan' as const,
    title: plan.query || 'Seller choice',
    status: plan.status || 'pending_selection',
    subtitle: targetSummary(plan.normalizedQuery),
    source: agentSourceLabel(plan.agentId),
    timestamp: plan.updatedAt || plan.createdAt || plan.expiresAt || '',
  }))
  const approvals = state.approvals.filter((approval) => orderSideForApproval(approval) === side && projectPathIsActive(projectPathForApproval(approval))).map((approval) => ({
    id: selectionId('approval', approval.approvalId),
    kind: 'approval' as const,
    title: approval.action || 'Approval request',
    status: approval.paymentRequired ? 'payment_required' : approval.status || 'pending',
    subtitle: `Task ${shortID(approval.taskId)} / ${approvalAmount(approval)}`,
    source: agentSourceLabel(approval.agentId),
    timestamp: approval.createdAt || approval.expiresAt || '',
  }))
  const tasks = state.tasks.filter((task) => orderSideForTask(task) === side && projectPathIsActive(projectPathForTask(task))).map((task) => ({
    id: selectionId('task', task.id),
    kind: 'task' as const,
    title: taskTitle(task),
    status: task.status || 'task',
    subtitle: `${taskAmount(task)} / ${shortID(task.providerPubkey || task.quote?.providerPubkey)}`,
    source: agentSourceLabel(task.agentId),
    timestamp: task.updatedAt || task.createdAt || task.completedAt || '',
  }))
  const payments = state.payments.filter((payment) => orderSideForPayment(payment) === side && projectPathIsActive(projectPathForPayment(payment))).map((payment) => ({
    id: selectionId('payment', payment.paymentId),
    kind: 'payment' as const,
    title: payment.status || 'Payment',
    status: payment.status || 'payment',
    subtitle: `${paymentAmount(payment)} / task ${shortID(payment.taskId)}`,
    source: payment.mode || 'payment',
    timestamp: payment.updatedAt || payment.createdAt || payment.confirmedAt || '',
  }))
  return [...plans, ...approvals, ...tasks, ...payments].sort((a, b) => {
    const rank = statusRank(a.status) - statusRank(b.status)
    if (rank !== 0) return rank
    return (b.timestamp || '').localeCompare(a.timestamp || '')
  })
}

function marketTransactionEntries(side: OrderSide = state.marketOrderSide): LedgerEntry[] {
  return state.tasks
    .filter(isTransactedTask)
    .filter((task) => orderSideForTask(task) === side)
    .map((task) => {
      const payment = state.payments.find((item) => item.taskId === task.id)
      const provider = task.providerPubkey || task.quote?.providerPubkey
      const orderRef = task.orderId && task.orderId !== task.id ? `Order ${shortID(task.orderId)}` : ''
      return {
        id: selectionId('task', task.id),
        kind: 'task' as const,
        title: taskTitle(task),
        status: task.status || 'order',
        subtitle: [orderRef, taskAmount(task), payment?.status, shortID(provider)].filter(Boolean).join(' / '),
        source: agentSourceLabel(task.agentId),
        timestamp: task.updatedAt || task.completedAt || task.consentedAt || task.createdAt || '',
      }
    })
    .sort((a, b) => sortTime(b.timestamp) - sortTime(a.timestamp))
}

function selectedMarketTransaction() {
  const selection = parseSelection(state.marketSelectedId)
  if (!selection || selection.kind !== 'task') return undefined
  return state.tasks.find((task) => task.id === selection.id && isTransactedTask(task) && orderSideForTask(task) === state.marketOrderSide)
}

function renderMarketTransactionDetail(task: Task) {
  const payment = state.payments.find((item) => item.taskId === task.id)
  const approval = state.approvals.find((item) => item.taskId === task.id)
  const provider = task.providerPubkey || task.quote?.providerPubkey
  return `
    <section class="decision-card market-transaction-detail">
      <div class="market-detail-top">
        <button type="button" class="secondary" data-market-transaction-back>Back to market</button>
      </div>
      <div class="decision-summary">
        <span>market_transaction</span>
        <strong>${escapeHTML(taskTitle(task))}</strong>
        <small>${escapeHTML([task.status || 'order', taskAmount(task), shortID(provider)].filter(Boolean).join(' / '))}</small>
      </div>
      <dl class="detail-grid">
        <div><dt>Order</dt><dd>${escapeHTML(shortID(task.orderId || task.id))}</dd></div>
        <div><dt>Task</dt><dd>${escapeHTML(shortID(task.id))}</dd></div>
        <div><dt>Provider</dt><dd>${escapeHTML(shortID(provider))}</dd></div>
        <div><dt>Quote</dt><dd>${escapeHTML(taskAmount(task))}</dd></div>
        <div><dt>Approval</dt><dd>${escapeHTML(approval ? approval.status : 'none')}</dd></div>
        <div><dt>Payment</dt><dd>${escapeHTML(payment ? `${payment.status} / ${paymentAmount(payment)}` : 'none')}</dd></div>
        <div><dt>Updated</dt><dd>${escapeHTML(task.updatedAt || task.createdAt || '')}</dd></div>
        <div><dt>Completed</dt><dd>${escapeHTML(task.completedAt || 'not completed')}</dd></div>
      </dl>
      ${task.error ? `<p class="error-copy">${escapeHTML(task.error)}</p>` : ''}
    </section>
  `
}

function attachMarketTransactionHandlers() {
  fields.decisionContent.querySelector<HTMLButtonElement>('[data-market-transaction-back]')?.addEventListener('click', () => {
    state.marketSelectedId = undefined
    renderAll()
  })
}

function isTransactedTask(task: Task) {
  const status = task.status || ''
  if (status === 'consented' || status === 'claimed' || status === 'running' || status === 'completed') return true
  if (status !== 'failed') return false
  const payment = state.payments.find((item) => item.taskId === task.id && item.status === 'confirmed_simulated')
  return Boolean(task.consentedAt || task.claimedAt || task.completedAt || payment)
}

function chooseDefaultSelection(previous?: string) {
  if (state.activeView !== 'work') return
  const entries = visibleLedgerEntries()
  if (previous && entries.some((entry) => entry.id === previous)) return
  state.selectedId = entries[0]?.id
}

function renderViewTabs() {
  renderChromeControls()
  renderProjectFolder()
  fields.appShell.classList.toggle('settings-mode', state.activeView === 'settings')
  fields.appShell.classList.toggle('right-workspace-white', rightWorkspaceIsWhite())
  fields.orderRoleRow.classList.toggle('hidden', state.activeView === 'settings')
  fields.folderPickerButton.classList.toggle('hidden', state.activeView !== 'chat' && state.activeView !== 'work')
  if (state.activeView !== 'settings') renderOrderRoleControls()
  fields.sidebarTitle.textContent = state.activeView === 'settings' ? 'Settings' : state.activeView === 'market' ? 'Market' : 'Order Threads'
  fields.projectFolderHead.classList.add('hidden')
  fields.newChatButton.classList.add('hidden')
  app.querySelectorAll<HTMLButtonElement>('[data-view-tab]').forEach((button) => {
    const view = button.dataset.viewTab as ActiveView
    const isActive = view === state.activeView || (view === 'chat' && state.activeView === 'work')
    button.classList.toggle('active', isActive)
    button.setAttribute('aria-pressed', String(isActive))
  })
}

function renderOrderRoleControls() {
  const side = state.activeView === 'market' ? state.marketOrderSide : state.workOrderSide
  const label = side === 'buyer' ? t('orderSide.buyer') : t('orderSide.seller')
  const next = side === 'buyer' ? t('orderSide.seller') : t('orderSide.buyer')
  fields.orderSideToggle.dataset.side = side
  fields.orderSideToggle.setAttribute('aria-pressed', String(side === 'seller'))
  fields.orderSideToggle.setAttribute('aria-label', t('orderSide.label', { label, next }))
  fields.orderSideToggle.setAttribute('title', t('orderSide.title', { next }))
  fields.orderSideState.textContent = label
}

function renderOrderActivitySidebar() {
  const records = orderActivityRecords()
  const folders = state.projectFolders.length ? state.projectFolders : [activeProjectFolder()]
  fields.sidebarTitle.textContent = 'Order Threads'
  fields.ledgerCount.textContent = String(records.length)
  if (!state.newConversationDraft && state.selectedWorkThreadId && !records.some((record) => record.threadId === state.selectedWorkThreadId)) {
    state.newConversationDraft = true
    state.selectedWorkThreadId = undefined
    state.selectedChatId = undefined
    state.selectedId = undefined
  }
  setLedgerEmpty(false)
  const selectedChat = state.activeView === 'chat' ? selectedChatThread() : undefined
  const pinnedRecords = records.filter((record) => state.workTaskState.pinnedIds.has(record.threadId))
  fields.ledgerList.innerHTML = `
    <div class="work-folder-tree" aria-label="Work folders and tasks">
      ${pinnedRecords.length ? `
        <section class="work-pinned-strip" aria-label="Pinned tasks">
          <div class="work-pinned-label">Pinned</div>
          <div class="work-pinned-list">
            ${pinnedRecords.map((record) => renderWorkTaskRecord(record, selectedChat, 'pinned-task-record')).join('')}
          </div>
        </section>
      ` : ''}
      ${folders.map((folder) => {
        const expanded = projectFolderExpanded(folder.path)
        const folderRecords = records.filter((record) => sameProjectPath(record.projectPath, folder.path) && !state.workTaskState.pinnedIds.has(record.threadId))
        return `
          <section class="work-folder-group" data-work-folder-group="${escapeAttr(folder.path)}">
            <div class="work-folder-row" data-work-folder-row="${escapeAttr(folder.path)}">
              <button class="work-folder-toggle ${expanded ? 'expanded' : 'collapsed'}" type="button" data-work-folder-toggle="${escapeAttr(folder.path)}" aria-expanded="${expanded}" title="${escapeAttr(folder.path)}">
                <span class="work-folder-icon">${toolbarIcons.folder}</span>
                <strong>${escapeHTML(compactText(folder.name, 34))}</strong>
                <span class="work-folder-disclosure">${toolbarIcons.disclosure}</span>
              </button>
              <button class="work-folder-new-task" type="button" data-work-folder-new="${escapeAttr(folder.path)}" aria-label="New task in ${escapeAttr(folder.name)}" title="New task">${toolbarIcons.plus}</button>
            </div>
            ${folderRecords.length ? `<div class="work-task-list ${expanded ? '' : 'hidden'}">
              ${folderRecords.map((record) => renderWorkTaskRecord(record, selectedChat)).join('')}
            </div>` : ''}
          </section>
        `
      }).join('')}
    </div>
  `
  attachWorkTreeHandlers()
}

function renderWorkTaskRecord(record: OrderActivityRecord, selectedChat?: ChatThread, extraClass = '') {
  const active = orderActivityIsActive(record, selectedChat)
  const unread = state.workTaskState.unreadIds.has(record.threadId)
  const pinned = state.workTaskState.pinnedIds.has(record.threadId)
  const classes = [
    'ledger-item',
    'history-record',
    'chat-record',
    'work-task-record',
    extraClass,
    active ? 'active' : '',
    unread ? 'unread' : '',
    pinned ? 'pinned' : '',
  ].filter(Boolean).join(' ')
  return `
    <button class="${classes}" data-order-activity data-order-thread-id="${escapeAttr(record.threadId)}" data-order-chat-id="${escapeAttr(record.chatId || '')}" data-order-select="${escapeAttr(record.primarySelectionId || '')}" data-order-project-path="${escapeAttr(record.projectPath)}" title="${escapeAttr([record.title, record.subtitle].filter(Boolean).join(' / '))}">
      <strong>${escapeHTML(compactText(record.title, 52))}</strong>
      ${record.subtitle ? `<small>${escapeHTML(compactText(record.subtitle, 76))}</small>` : ''}
    </button>
  `
}

function attachWorkTreeHandlers() {
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-work-folder-toggle]').forEach((button) => {
    button.addEventListener('click', () => toggleWorkFolder(button.dataset.workFolderToggle || ''))
  })
  fields.ledgerList.querySelectorAll<HTMLElement>('[data-work-folder-row]').forEach((row) => {
    row.addEventListener('contextmenu', (event) => {
      const path = row.dataset.workFolderRow || ''
      if (path) openProjectFolderContextMenu(event, path)
    })
  })
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-work-folder-new]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const folder = state.projectFolders.find((item) => sameProjectPath(item.path, button.dataset.workFolderNew)) || (sameProjectPath(activeProjectFolder().path, button.dataset.workFolderNew) ? activeProjectFolder() : undefined)
      if (folder) startNewConversation(folder)
    })
  })
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-order-activity]').forEach((button) => {
    button.addEventListener('click', () => selectWorkThreadFromButton(button))
    button.addEventListener('contextmenu', (event) => {
      const threadId = button.dataset.orderThreadId
      if (threadId) openTaskContextMenu(event, threadId)
    })
  })
}

function openTaskContextMenu(event: MouseEvent, threadId: string) {
  if (state.activeView === 'market' || state.activeView === 'settings') return
  event.preventDefault()
  event.stopPropagation()
  closeProfileMenu()
  closeProjectFolderMenu(false)
  closePermissionMenu(false)
  closeMarketProjectPicker()
  const rect = (fields.taskContextMenu.parentElement || fields.ledgerList).getBoundingClientRect()
  state.taskMenuOpen = true
  state.taskMenuThreadId = threadId
  state.taskMenuPosition = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  }
  renderTaskContextMenu()
}

function toggleWorkFolder(path: string) {
  const key = projectPathKey(path)
  if (!key) return
  if (state.expandedProjectFolderPaths.has(key)) state.expandedProjectFolderPaths.delete(key)
  else state.expandedProjectFolderPaths.add(key)
  scheduleSaveAppSettings()
  renderLedger()
}

function selectWorkThreadFromButton(button: HTMLButtonElement) {
  const threadId = button.dataset.orderThreadId
  const chatId = button.dataset.orderChatId
  const selection = button.dataset.orderSelect
  const projectPath = button.dataset.orderProjectPath
  if (projectPath) setProjectFolderContext(projectPath)
  state.newConversationDraft = false
  if (threadId) state.selectedWorkThreadId = threadId
  if (chatId) {
    setActiveView('chat')
    state.selectedChatId = chatId
  } else {
    state.selectedChatId = undefined
  }
  if (selection) {
    const parsed = parseSelection(selection)
    state.selectedId = selection
    if (parsed) setActiveView('chat')
  } else {
    state.selectedId = undefined
  }
  state.pinStep = undefined
  renderAll()
}

function renderProjectFolderSwitcher() {
  if (state.activeView !== 'chat' && state.activeView !== 'work') return ''
  const folders = state.projectFolders.length ? state.projectFolders : [activeProjectFolder()]
  if (folders.length <= 1) return ''
  return `
    <div class="project-folder-switcher" aria-label="Work project folders">
      ${folders.map((folder) => `
        <button class="project-folder-record" type="button" data-project-folder-select="${escapeHTML(folder.path)}" title="${escapeHTML(folder.path)}">
          <span class="project-folder-record-icon">${toolbarIcons.folder}</span>
          <strong>${escapeHTML(compactText(folder.name, 34))}</strong>
        </button>
      `).join('')}
    </div>
  `
}

function attachProjectFolderSwitcherHandlers() {
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-project-folder-select]').forEach((button) => {
    button.addEventListener('click', () => {
      const path = button.dataset.projectFolderSelect
      if (path) selectProjectFolder(path)
    })
    button.addEventListener('contextmenu', (event) => {
      const path = button.dataset.projectFolderSelect
      if (path) setProjectFolderContext(path)
      openProjectFolderContextMenu(event, path)
    })
  })
}

function orderActivityIsActive(record: OrderActivityRecord, selectedChat?: ChatThread) {
  if (state.newConversationDraft) return false
  if (record.threadId) return record.threadId === state.selectedWorkThreadId
  if (record.chatId) return state.activeView === 'chat' && record.chatId === selectedChat?.id
  if (record.primarySelectionId) return record.primarySelectionId === state.selectedId
  return false
}

function cloneChatThread(thread: ChatThread): ChatThread {
  return {
    ...thread,
    messages: Array.isArray(thread.messages) ? thread.messages.map((message) => ({
      ...message,
      eventRef: message.eventRef ? { ...message.eventRef } : undefined,
      result: message.result ? { ...message.result } : undefined,
    })) : [],
    taskIds: [...(thread.taskIds || [])],
    participants: [...(thread.participants || [])],
  }
}

function workThreadSessionID(thread: WorkThread) {
  return thread.chatId || thread.primarySelectionId || thread.taskIds[0] || thread.planIds[0] || thread.approvalIds[0] || thread.paymentIds[0] || thread.orderId || thread.id
}

function workThreadSourceKind(thread: WorkThread): ArchivedWorkRecord['sourceKind'] {
  if (thread.taskIds.length) return 'task'
  if (thread.approvalIds.length) return 'approval'
  if (thread.paymentIds.length) return 'payment'
  if (thread.planIds.length || thread.orderId) return 'order'
  return 'chat'
}

async function handleTaskMenuAction(action: TaskMenuAction) {
  const threadId = state.taskMenuThreadId
  const thread = threadId ? workThreadById(threadId, { includeArchived: true, side: 'all' }) : undefined
  closeTaskContextMenu()
  if (!thread) {
    showToast(t('toast.taskUnavailable'))
    return
  }
  if (action === 'pin') return togglePinnedWorkThread(thread)
  if (action === 'rename') return renameWorkThread(thread)
  if (action === 'archive') return archiveWorkThread(thread)
  if (action === 'unread') return toggleUnreadWorkThread(thread)
  if (action === 'copy-id') return copyWorkThreadID(thread)
  if (action === 'open-project') return openProjectForWorkThread(thread)
}

function togglePinnedWorkThread(thread: WorkThread) {
  if (state.workTaskState.pinnedIds.has(thread.id)) {
    state.workTaskState.pinnedIds.delete(thread.id)
    showToast(t('toast.taskUnpinned'))
  } else {
    state.workTaskState.pinnedIds.add(thread.id)
    showToast(t('toast.taskPinned'))
  }
  saveWorkTaskState()
  renderLedger()
}

function toggleUnreadWorkThread(thread: WorkThread) {
  if (state.workTaskState.unreadIds.has(thread.id)) {
    state.workTaskState.unreadIds.delete(thread.id)
    showToast(t('toast.taskRead'))
  } else {
    state.workTaskState.unreadIds.add(thread.id)
    showToast(t('toast.taskUnread'))
  }
  saveWorkTaskState()
  renderLedger()
}

function renameWorkThread(thread: WorkThread) {
  const next = window.prompt(t('prompt.renameTask'), thread.title)?.trim()
  if (!next || next === thread.title) return
  if (thread.chatId) {
    const chat = state.chatThreads.find((item) => item.id === thread.chatId)
    if (chat) {
      chat.title = next
      chat.updatedAt = Date.now()
      flushSaveChatThread(chat)
    }
  } else {
    state.workTaskState.titleOverrides[thread.id] = next
  }
  saveWorkTaskState()
  renderAll()
  showToast(t('toast.taskRenamed'))
}

function archiveWorkThread(thread: WorkThread) {
  if (workThreadIsArchived(thread.id)) {
    showToast(t('toast.taskAlreadyArchived'))
    return
  }
  const chatSnapshot = thread.chatId ? state.chatThreads.find((item) => item.id === thread.chatId) : undefined
  const projectPath = thread.projectPath || defaultWorkProjectPath()
  const record: ArchivedWorkRecord = {
    id: `archive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    threadId: thread.id,
    title: thread.title,
    projectPath,
    projectName: projectFolderNameForPath(projectPath),
    archivedAt: new Date().toISOString(),
    sourceKind: workThreadSourceKind(thread),
    side: thread.side,
    status: thread.status,
    chatSnapshot: chatSnapshot ? cloneChatThread(chatSnapshot) : undefined,
  }
  state.workTaskState.archivedRecords = [record, ...state.workTaskState.archivedRecords.filter((item) => item.threadId !== thread.id)]
  state.workTaskState.pinnedIds.delete(thread.id)
  state.workTaskState.unreadIds.delete(thread.id)
  if (state.selectedWorkThreadId === thread.id || state.selectedChatId === thread.chatId) {
    state.selectedWorkThreadId = undefined
    state.selectedChatId = undefined
    state.selectedId = undefined
    state.newConversationDraft = true
  }
  saveWorkTaskState()
  renderAll()
  showToast(t('toast.taskArchived'))
}

async function copyWorkThreadID(thread: WorkThread) {
  await navigator.clipboard.writeText(workThreadSessionID(thread))
  showToast(t('toast.sessionCopied'))
}

async function openProjectForWorkThread(thread: WorkThread) {
  const projectPath = thread.projectPath || defaultWorkProjectPath()
  setProjectFolderContext(projectPath)
  if (!window.exora?.invoke) {
    await navigator.clipboard.writeText(projectPath)
    showToast(t('toast.projectPathCopied'))
    return
  }
  const folder = await invoke<ProjectFolder>('open_project_folder', { input: { path: projectPath } })
  setProjectFolders([folder, ...state.projectFolders], folder.path)
  renderProjectFolder()
  showToast(t('toast.opened', { name: folder.name }))
}

function archivedRecordCanRestore(record: ArchivedWorkRecord) {
  if (record.chatSnapshot) return true
  return Boolean(workThreadById(record.threadId, { includeArchived: true, side: 'all' }))
}

function restoreArchivedRecord(recordID: string) {
  const record = state.workTaskState.archivedRecords.find((item) => item.id === recordID)
  if (!record) return
  const current = workThreadById(record.threadId, { includeArchived: true, side: 'all' })
  if (!record.chatSnapshot && !current) {
    showToast(t('toast.originalTaskMissing'))
    renderArchiveRecords()
    return
  }
  if (record.chatSnapshot && !state.chatThreads.some((thread) => thread.id === record.chatSnapshot?.id)) {
    state.chatThreads.push(cloneChatThread(record.chatSnapshot))
  }
  state.workTaskState.archivedRecords = state.workTaskState.archivedRecords.filter((item) => item.id !== record.id)
  state.expandedProjectFolderPaths.add(projectPathKey(record.projectPath))
  setProjectFolderContext(record.projectPath)
  if (record.side) state.workOrderSide = record.side
  state.selectedWorkThreadId = record.threadId
  state.selectedChatId = record.chatSnapshot?.id
  state.newConversationDraft = false
  saveWorkTaskState()
  if (record.chatSnapshot) flushSaveChatThread(record.chatSnapshot)
  renderAll()
  showToast(t('toast.taskRestored'))
}

async function copyArchivedRecordID(recordID: string) {
  const record = state.workTaskState.archivedRecords.find((item) => item.id === recordID)
  if (!record) return
  await navigator.clipboard.writeText(record.chatSnapshot?.id || record.threadId)
  showToast(t('toast.archiveIdCopied'))
}

function viewForKind(kind: SelectedKind): ActiveView {
  return 'work'
}

function visibleLedgerEntries() {
  const entries = orderCommunicationEntries()
  return state.activeView === 'work' ? entries : []
}

function defaultSelectionForView(view: ActiveView) {
  if (view !== 'work') return undefined
  return orderCommunicationEntries()[0]?.id
}

function workThreads(options: { includeArchived?: boolean; side?: OrderSide | 'all' } = {}): WorkThread[] {
  const threads = new Map<string, WorkThread>()
  const ensure = (id: string, title: string, timestamp: string, projectPath = defaultWorkProjectPath()): WorkThread => {
    const existing = threads.get(id)
    if (existing) {
      if (sortTime(timestamp) > sortTime(existing.timestamp)) existing.timestamp = timestamp
      if (!existing.title || existing.title === 'New chat') existing.title = title
      if (!existing.projectPath) existing.projectPath = projectPath
      return existing
    }
    const thread: WorkThread = {
      id,
      title: title || 'New order',
      subtitle: '',
      timestamp,
      projectPath,
      side: 'buyer',
      participants: ['buyer_human', 'buyer_agent', 'seller_agent'],
      taskIds: [],
      planIds: [],
      approvalIds: [],
      paymentIds: [],
    }
    threads.set(id, thread)
    return thread
  }

  for (const chat of state.chatThreads) {
    if (chat.messages.length === 0 && !chat.orderId && !(chat.taskIds || []).length && !chat.status) continue
    const id = workThreadIdForChat(chat)
    const thread = ensure(id, chatThreadTitle(chat), String(chat.updatedAt || chat.createdAt), projectPathForChat(chat))
    thread.chatId = chat.id
    thread.providerPubkey = chat.providerPubkey || thread.providerPubkey
    thread.origin = chat.origin || thread.origin
    thread.orderId = chat.orderId || thread.orderId
    thread.status = chat.status || thread.status
    mergeOrderSide(thread, orderSideForChat(chat))
    for (const taskId of chat.taskIds || []) addUnique(thread.taskIds, taskId)
    for (const participant of chat.participants || []) addUnique(thread.participants, participant)
  }

  for (const plan of state.orderPlans) {
    const thread = ensure(workThreadIdForPlan(plan), plan.query || 'Seller choice', plan.updatedAt || plan.createdAt || plan.expiresAt || '', projectPathForPlan(plan))
    mergeOrderSide(thread, orderSideForPlan(plan))
    addUnique(thread.planIds, plan.planId)
    thread.status = plan.status || thread.status
    thread.subtitle = `${plan.status || 'seller choice'} / ${targetSummary(plan.normalizedQuery)}`
    thread.primarySelectionId ||= selectionId('plan', plan.planId)
  }

  for (const task of state.tasks) {
    const thread = ensure(workThreadIdForTask(task), taskTitle(task), task.updatedAt || task.completedAt || task.createdAt || '', projectPathForTask(task))
    mergeOrderSide(thread, orderSideForTask(task))
    addUnique(thread.taskIds, task.id)
    thread.orderId = task.orderId || task.id
    thread.providerPubkey = task.providerPubkey || task.quote?.providerPubkey || thread.providerPubkey
    thread.status = task.status || thread.status
    thread.subtitle = `${task.status || 'task'} / ${taskAmount(task)} / ${shortID(thread.providerPubkey)}`
    thread.primarySelectionId = selectionId('task', task.id)
  }

  for (const approval of state.approvals) {
    const thread = ensure(workThreadIdForApproval(approval), approval.action || 'Approval request', approval.createdAt || approval.expiresAt || '', projectPathForApproval(approval))
    mergeOrderSide(thread, orderSideForApproval(approval))
    addUnique(thread.approvalIds, approval.approvalId)
    thread.providerPubkey = approval.providerPubkey || thread.providerPubkey
    thread.status = approval.status || thread.status
    thread.subtitle ||= `${approval.status || 'approval'} / ${approvalAmount(approval)}`
    thread.primarySelectionId ||= selectionId('approval', approval.approvalId)
  }

  for (const payment of state.payments) {
    const thread = ensure(workThreadIdForPayment(payment), payment.status || 'Payment', payment.updatedAt || payment.confirmedAt || payment.createdAt || '', projectPathForPayment(payment))
    mergeOrderSide(thread, orderSideForPayment(payment))
    addUnique(thread.paymentIds, payment.paymentId)
    thread.providerPubkey = payment.providerPubkey || thread.providerPubkey
    thread.subtitle ||= `${payment.status || 'payment'} / ${paymentAmount(payment)}`
  }

  return [...threads.values()]
    .map((thread) => ({
      ...thread,
      title: state.workTaskState.titleOverrides[thread.id] || thread.title,
      subtitle: thread.subtitle || workThreadSubtitle(thread),
    }))
    .filter((thread) => options.side === 'all' || thread.side === (options.side || state.workOrderSide))
    .filter((thread) => options.includeArchived || !workThreadIsArchived(thread.id))
    .sort((a, b) => sortTime(b.timestamp) - sortTime(a.timestamp))
}

function selectedWorkThread() {
  if (state.newConversationDraft) return undefined
  const threads = workThreads()
  if (!threads.length) return undefined
  const selected = threads.find((thread) => thread.id === state.selectedWorkThreadId)
  if (selected) return selected
  const selectedChat = state.selectedChatId ? threads.find((thread) => thread.chatId === state.selectedChatId) : undefined
  if (selectedChat) return selectedChat
  return undefined
}

function workThreadIsArchived(threadId: string) {
  return state.workTaskState.archivedRecords.some((record) => record.threadId === threadId)
}

function workThreadById(threadId: string, options: { includeArchived?: boolean; side?: OrderSide | 'all' } = {}) {
  return workThreads(options).find((thread) => thread.id === threadId)
}

function workThreadSubtitle(thread: WorkThread) {
  const hasOrderRecords = Boolean(thread.taskIds.length || thread.planIds.length || thread.approvalIds.length || thread.paymentIds.length)
  if (!hasOrderRecords && (thread.status === 'draft' || (thread.origin === 'market-card' && !thread.status))) return ''
  const pieces = [thread.status, thread.taskIds.length ? `${thread.taskIds.length} task${thread.taskIds.length === 1 ? '' : 's'}` : '', shortID(thread.providerPubkey)]
  return pieces.filter(Boolean).join(' / ') || 'Agent conversation'
}

function workThreadIdForChat(thread: ChatThread) {
  if (thread.orderId) return `order:${thread.orderId}`
  const task = thread.taskIds?.map((id) => state.tasks.find((item) => item.id === id)).find(Boolean)
  if (task) return workThreadIdForTask(task)
  return `chat:${thread.id}`
}

function workThreadIdForPlan(plan: OrderPlan) {
  const task = taskForPlan(plan)
  if (task) return workThreadIdForTask(task)
  return `order:${plan.planId}`
}

function workThreadIdForApproval(approval: Approval) {
  const task = state.tasks.find((item) => item.id === approval.taskId)
  return task ? workThreadIdForTask(task) : `order:${approval.taskId}`
}

function workThreadIdForTask(task: Task) {
  return `order:${task.orderId || task.id}`
}

function workThreadIdForPayment(payment: PaymentRecord) {
  const task = state.tasks.find((item) => item.id === payment.taskId)
  return task ? workThreadIdForTask(task) : `order:${payment.taskId || payment.paymentId}`
}

function taskForPlan(plan: OrderPlan) {
  if (plan.taskId) return state.tasks.find((task) => task.id === plan.taskId)
  return undefined
}

function addUnique<T>(items: T[], value?: T) {
  if (value === undefined || value === null || items.includes(value)) return
  items.push(value)
}

function orderIdFromWorkThreadId(threadId?: string) {
  return threadId?.startsWith('order:') ? threadId.slice('order:'.length) : undefined
}

function orderActivityRecords(): OrderActivityRecord[] {
  return workThreads().map((thread) => ({
    id: thread.id,
    threadId: thread.id,
    title: thread.title,
    subtitle: thread.subtitle,
    timestamp: thread.timestamp,
    projectPath: thread.projectPath || defaultWorkProjectPath(),
    chatId: thread.chatId,
    primarySelectionId: thread.primarySelectionId,
  }))
}

function orderCommunicationEntries() {
  return ledgerEntries()
    .filter((entry) => entry.kind !== 'payment')
    .sort((a, b) => sortTime(b.timestamp) - sortTime(a.timestamp))
}

function chatHistoryRecords(side: OrderSide = state.workOrderSide) {
  return [...state.chatThreads]
    .filter((thread) => orderSideForChat(thread) === side)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((thread) => ({
      id: thread.id,
      title: chatThreadTitle(thread),
      subtitle: chatThreadSubtitle(thread),
      timestamp: thread.updatedAt,
    }))
}

function selectedChatThread() {
  if (state.newConversationDraft) return undefined
  const activeWorkThread = state.selectedWorkThreadId ? workThreads().find((thread) => thread.id === state.selectedWorkThreadId) : undefined
  if (activeWorkThread?.chatId) {
    const active = state.chatThreads.find((thread) => thread.id === activeWorkThread.chatId)
    if (active) return active
  }
  const selected = state.chatThreads.find((thread) => thread.id === state.selectedChatId)
  if (selected && orderSideForChat(selected) === state.workOrderSide) return selected
  return undefined
}

function chatThreadTitle(thread: ChatThread) {
  const lastUserMessage = [...thread.messages].reverse().find((message) => message.role === 'user')
  const lastMessage = thread.messages[thread.messages.length - 1]
  return compactText(thread.title || lastUserMessage?.text || lastMessage?.text || 'New chat', 52)
}

function chatThreadSubtitle(thread: ChatThread) {
  const lastMessage = thread.messages[thread.messages.length - 1]
  if (!lastMessage) return 'Agent conversation'
  return `${lastMessage.meta || messageRoleLabel(lastMessage.role)} / ${chatSubtitle(lastMessage)}`
}

function chatTitle(message: ChatMessage) {
  const text = compactText(message.text, 52)
  if (!text) return message.meta || message.role
  return text
}

function compactText(value: string, limit: number) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function sortTime(value?: string) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

function trimDisplayNumber(value?: number) {
  if (!Number.isFinite(value)) return '0'
  return Number(value).toFixed(6).replace(/\.?0+$/, '')
}

function chatSubtitle(message: ChatMessage) {
  if (message.result?.summary) return message.result.summary
  return message.text.length > 96 ? `${message.text.slice(0, 96)}...` : message.text
}

function selectedObjectForActiveView() {
  const selected = selectedObject()
  if (state.activeView !== 'work') return undefined
  if (selected) return selected
  const fallback = orderCommunicationEntries()[0]
  if (!fallback) return undefined
  state.selectedId = fallback.id
  return selectedObject()
}

function selectedObject():
  | { kind: 'plan'; value: OrderPlan }
  | { kind: 'approval'; value: Approval }
  | { kind: 'task'; value: Task }
  | { kind: 'payment'; value: PaymentRecord }
  | undefined {
  const parsed = parseSelection(state.selectedId)
  if (!parsed) return undefined
  if (parsed.kind === 'plan') {
    const value = state.orderPlans.find((item) => item.planId === parsed.id)
    return value ? { kind: 'plan', value } : undefined
  }
  if (parsed.kind === 'approval') {
    const value = state.approvals.find((item) => item.approvalId === parsed.id)
    return value ? { kind: 'approval', value } : undefined
  }
  if (parsed.kind === 'task') {
    const value = state.tasks.find((item) => item.id === parsed.id)
    return value ? { kind: 'task', value } : undefined
  }
  const value = state.payments.find((item) => item.paymentId === parsed.id)
  return value ? { kind: 'payment', value } : undefined
}

function notifyExternalRequests(quiet: boolean) {
  for (const plan of state.orderPlans) {
    if (state.seenPlanIds.has(plan.planId)) continue
    state.seenPlanIds.add(plan.planId)
    if (!quiet && plan.agentId !== 'exora-desktop-agent') {
      if (projectPathIsActive(projectPathForPlan(plan))) {
        pushMessage({ role: 'system', text: `External agent requested seller selection: ${plan.query || shortID(plan.planId)}.`, meta: agentSourceLabel(plan.agentId) })
        focusExternalOrderPlan(plan)
      } else {
        showToast(t('toast.newMcpOrder', { project: projectFolderNameForPath(projectPathForPlan(plan)) }))
      }
    }
  }
  for (const approval of state.approvals) {
    if (state.seenApprovalIds.has(approval.approvalId)) continue
    state.seenApprovalIds.add(approval.approvalId)
    if (!quiet && approval.agentId !== 'exora-desktop-agent') {
      if (projectPathIsActive(projectPathForApproval(approval))) {
        pushMessage({ role: 'system', text: `External agent requested approval for task ${shortID(approval.taskId)}.`, meta: agentSourceLabel(approval.agentId) })
      } else {
        showToast(t('toast.newMcpApproval', { project: projectFolderNameForPath(projectPathForApproval(approval)) }))
      }
    }
  }
}

function focusExternalOrderPlan(plan: OrderPlan) {
  if (plan.status !== 'pending_selection') return
  const projectPath = projectPathForPlan(plan)
  setProjectFolderContext(projectPath)
  state.expandedProjectFolderPaths.add(projectPathKey(projectPath))
  state.newConversationDraft = false
  state.selectedId = selectionId('plan', plan.planId)
  state.selectedWorkThreadId = workThreadIdForPlan(plan)
  state.selectedChatId = undefined
  state.pinStep = undefined
  setActiveView('chat')
  showToast(t('toast.sellerSelectionReady', { query: plan.query || shortID(plan.planId) }))
}

function renderAll() {
  applyUserPreferences()
  renderProfileSummary()
  renderPermissionControl()
  renderBuyerAgentSettings()
  renderLedger()
  renderContextStrip()
  renderDecisionPanel()
  renderLocalAgentPromptControls()
  renderExternalWorkLockControls()
  renderMarketProjectPicker()
  syncTransactionProgressPolling()
  localize()
}

function renderSeller(settings: SellerSettings) {
  renderLLMSettings(settings)
  setChecked('enabled', settings.enabled)
  setValue('providerId', settings.providerId)
  setValue('quotePrice', String(settings.quotePrice))
  setValue('currency', settings.currency)
  setValue('estimatedSeconds', String(settings.estimatedSeconds))
  setChecked('autoQuote', settings.autoQuote)
  setChecked('autoAcceptLowRisk', Boolean(settings.autoAcceptLowRisk || settings.autoCompleteTextTasks))
}

function buyerAgentInput(name: string) {
  return buyerAgentForm.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-buyer-field="${name}"]`)!
}

function buyerAgentValue(name: string) {
  return buyerAgentInput(name).value.trim()
}

function setBuyerAgentValue(name: string, next: string) {
  buyerAgentInput(name).value = next
}

function buyerAgentChecked(name: string) {
  return (buyerAgentInput(name) as HTMLInputElement).checked
}

function setBuyerAgentChecked(name: string, next: boolean) {
  ;(buyerAgentInput(name) as HTMLInputElement).checked = next
}

function renderBuyerAgentSettings() {
  const settings = state.buyerAgentSettings
  setBuyerAgentChecked('enabled', settings.enabled)
  setBuyerAgentValue('agentId', settings.agentId)
  fields.buyerAgentChip.textContent = uiText(settings.enabled ? 'enabled' : 'disabled')
  fields.buyerAgentChip.dataset.state = settings.enabled ? 'ok' : 'warn'
}

function buyerAgentPayload(): BuyerAgentSettings {
  return normalizeBuyerAgentSettings({
    enabled: buyerAgentChecked('enabled'),
    agentId: buyerAgentValue('agentId'),
  })
}

function saveBuyerAgentSettings() {
  state.buyerAgentSettings = buyerAgentPayload()
  scheduleSaveAppSettings()
  renderBuyerAgentSettings()
  renderPermissionControl()
  showToast(t('toast.buyerAgentSaved'))
}

function buyerAgentSearchInput(query: string, extra: Record<string, unknown> = {}) {
  const settings = state.buyerAgentSettings
  return {
    ...extra,
    query,
    agentId: settings.agentId,
    buyerAgentCardId: state.agentCards.buyer?.id || undefined,
    ...BUYER_AGENT_SEARCH_DEFAULTS,
  }
}

function currentLLMProfile(settings?: SellerSettings): LLMProfile {
  const draft = editingDraftLLMProfile()
  if (draft) return draft
  const found = state.llmProfiles.find((profile) => profile.id === state.editingLLMProfileId)
    || state.llmProfiles.find((profile) => profile.id === state.activeLLMProfileId)
  if (found) return found
  const preset = presetById(settings?.providerPreset)
  return {
    id: 'current',
    name: 'Current API',
    providerPreset: settings?.providerPreset || preset.id,
    llmBaseUrl: settings?.llmBaseUrl || preset.baseUrl,
    wireApi: (settings?.wireApi || preset.wireApi) as LLMProfile['wireApi'],
    capabilities: settings?.capabilities || preset.capabilities,
    researchModel: settings?.researchModel || preset.model,
    researchReasoningEffort: settings?.researchReasoningEffort || 'high',
    utilityModel: settings?.utilityModel || settings?.researchModel || preset.model,
    utilityReasoningEffort: settings?.utilityReasoningEffort || 'low',
    disableResponseStorage: settings?.disableResponseStorage ?? true,
    hasApiKey: settings?.hasApiKey,
    keyFormat: settings?.keyFormat,
  }
}

function renderLLMSettings(settings?: SellerSettings) {
  const profile = currentLLMProfile(settings)
  const preset = presetById(profile.providerPreset || inferProviderPreset(profile.llmBaseUrl))
  const draftApiKey = isDraftLLMProfileId(profile.id)
    ? (() => {
      const input = llmInput('apiKey') as HTMLInputElement | null
      return input && !isMaskedApiKeyInput(input) ? input.value : ''
    })()
    : ''
  setLLMValue('profileName', profile.name || '')
  setLLMValue('providerPreset', profile.providerPreset || preset.id)
  setLLMValue('llmBaseUrl', profile.llmBaseUrl || preset.baseUrl)
  setLLMValue('apiKey', draftApiKey)
  setLLMChecked('clearApiKey', false)
  setLLMValue('wireApi', profile.wireApi || preset.wireApi)
  setLLMValue('researchModel', profile.researchModel || preset.model)
  setLLMValue('researchReasoningEffort', profile.researchReasoningEffort || 'high')
  setLLMValue('utilityModel', profile.utilityModel || profile.researchModel || preset.model)
  setLLMValue('utilityReasoningEffort', profile.utilityReasoningEffort || 'low')
  setLLMChecked('disableResponseStorage', profile.disableResponseStorage ?? true)
  setLLMChecked('useForBuyer', Boolean(profile.useForBuyer || profile.id === state.buyerLLMProfileId))
  setLLMChecked('useForSeller', Boolean(profile.useForSeller || profile.id === state.sellerLLMProfileId))
  const datalist = llmSettingsForm.querySelector<HTMLDataListElement>('#llm-model-options')
  if (datalist) {
    datalist.innerHTML = state.llmModels.map((model) => `<option value="${escapeHTML(model)}"></option>`).join('')
  }
  fields.providerNote.textContent = preset.note
  fields.capabilityNote.textContent = capabilitySummary(profile.capabilities || preset.capabilities)
  renderLLMProfileList()
  renderLLMProfileMeta(profile)
  renderLLMTestNote()
}

function llmProfileRoleLabels(profile: LLMProfile) {
  const active = profile.id === state.activeLLMProfileId
  return [
    profile.useForBuyer || profile.id === state.buyerLLMProfileId ? uiText('Buyer') : '',
    profile.useForSeller || profile.id === state.sellerLLMProfileId ? uiText('Seller') : '',
    active && profile.id !== state.buyerLLMProfileId && profile.id !== state.sellerLLMProfileId ? uiText('Active') : '',
  ].filter(Boolean)
}

function renderLLMProfileList() {
  const draft = editingDraftLLMProfile()
  if (!state.llmProfiles.length && !draft) {
    fields.llmProfileList.innerHTML = `
      <div class="api-profile-menu is-disabled">
        <button class="api-profile-trigger" type="button" disabled>
          <span class="api-profile-trigger-label">${escapeHTML(uiText('No profiles yet.'))}</span>
        </button>
      </div>
    `
    return
  }
  const selectedProfile = draft || state.llmProfiles.find((profile) => profile.id === state.editingLLMProfileId) || state.llmProfiles[0]
  fields.llmProfileList.innerHTML = `
    <div class="api-profile-menu" data-llm-profile-menu>
      <button class="api-profile-trigger" type="button" data-llm-profile-toggle aria-haspopup="listbox" aria-expanded="false" title="${escapeAttr(selectedProfile.name || uiText('API Profile'))}">
        <span class="api-profile-trigger-label">${escapeHTML(compactText(selectedProfile.name || uiText('API Profile'), 48))}</span>
      </button>
      <div class="api-profile-menu-list hidden" data-llm-profile-menu-list role="listbox" aria-label="${escapeAttr(uiText('Saved settings'))}">
        ${draft ? `
          <button class="api-profile-menu-option active" type="button" disabled role="option" aria-selected="true" title="${escapeAttr(uiText('Unsaved draft'))}">
            <span class="api-profile-option-copy">
              <strong>${escapeHTML(compactText(draft.name || uiText('API Profile'), 34))}</strong>
              <small>${escapeHTML(uiText('Unsaved draft'))}</small>
            </span>
            <span class="api-profile-badges"><em>${escapeHTML(uiText('Draft'))}</em></span>
          </button>
        ` : ''}
        ${state.llmProfiles.map((profile) => {
    const editing = !draft && profile.id === selectedProfile.id
    const roles = llmProfileRoleLabels(profile)
    return `
          <button class="api-profile-menu-option ${editing ? 'active' : ''}" type="button" data-llm-profile-option="${escapeAttr(profile.id)}" role="option" aria-selected="${editing}" title="${escapeAttr(profile.llmBaseUrl)}">
            <span class="api-profile-option-copy">
              <strong>${escapeHTML(compactText(profile.name || uiText('API Profile'), 34))}</strong>
              <small>${escapeHTML(compactText([profile.researchModel || 'model', hostLabelForURL(profile.llmBaseUrl)].filter(Boolean).join(' / '), 52))}</small>
            </span>
            <span class="api-profile-badges">
              ${roles.map((role) => `<em>${escapeHTML(role)}</em>`).join('')}
            </span>
          </button>
        `
  }).join('')}
      </div>
    </div>
  `
}

function renderLLMProfileMeta(profile: LLMProfile) {
  const savedKeyFormat = profile.keyFormat || 'stored'
  const roles = [
    profile.useForBuyer || profile.id === state.buyerLLMProfileId ? uiText('Buyer') : '',
    profile.useForSeller || profile.id === state.sellerLLMProfileId ? uiText('Seller') : '',
  ].filter(Boolean).join(' / ') || uiText('not assigned')
  const keyStatus = profile.hasApiKey
    ? profile.keyFormat === 'not_required'
      ? t('api.keyNotRequiredShort')
      : t('api.keySavedShort')
    : state.llmKeyStorageAvailable
      ? t('api.noKeySavedShort')
      : t('api.secureStorageUnavailableShort')
  const keyText = profile.hasApiKey
    ? profile.keyFormat === 'not_required'
      ? t('api.keyNotRequired')
      : t('api.savedKey', { format: uiText(savedKeyFormat) })
    : state.llmKeyStorageAvailable
      ? t('api.noKeySaved')
      : t('api.secureStorageUnavailable')
  fields.keyState.textContent = keyText
  fields.llmProfileStatus.textContent = `${roles} - ${keyStatus}`
  fields.llmProfileStatus.title = `${roles}. ${keyText}`
  const apiKeyInput = llmInput('apiKey') as HTMLInputElement | null
  const clearInput = llmInput('clearApiKey') as HTMLInputElement | null
  if (apiKeyInput) {
    apiKeyInput.disabled = !state.llmKeyStorageAvailable
    apiKeyInput.placeholder = state.llmKeyStorageAvailable ? t('api.keepSavedKey') : t('api.secureStorageUnavailable')
    if (profile.hasApiKey) {
      setMaskedApiKeyInput(apiKeyInput)
    } else {
      if (!isDraftLLMProfileId(profile.id)) apiKeyInput.value = ''
      clearMaskedApiKeyInput(apiKeyInput)
    }
  }
  if (clearInput) {
    clearInput.disabled = !state.llmKeyStorageAvailable || !profile.hasApiKey
    if (!profile.hasApiKey) clearInput.checked = false
  }
}

function renderLLMTestNote() {
  fields.llmTestNote.classList.remove('passed', 'failed')
  fields.llmTestNote.removeAttribute('title')
  fields.llmTestNote.classList.remove('hidden')
  if (!state.llmTestStatus) {
    fields.llmTestNote.textContent = uiText('Not checked')
    return
  }
  const passed = state.llmTestStatus === 'passed'
  fields.llmTestNote.classList.add(passed ? 'passed' : 'failed')
  if (state.llmTestMessage) fields.llmTestNote.title = uiText(state.llmTestMessage)
  fields.llmTestNote.innerHTML = `${passed ? icon(Check) : icon(X)}<span>${escapeHTML(t(passed ? 'api.testPassed' : 'api.testFailed'))}</span>`
}

const llmTestInvalidatingFields = new Set([
  'apiKey',
  'clearApiKey',
  'llmBaseUrl',
  'providerPreset',
  'wireApi',
  'researchModel',
  'utilityModel',
  'useForBuyer',
  'useForSeller',
])

function clearLLMTestStatus() {
  if (!state.llmTestStatus && !state.llmTestMessage) return
  state.llmTestStatus = undefined
  state.llmTestMessage = undefined
  renderLLMTestNote()
}

function handleLLMSettingsTestInvalidation(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
  const field = target.getAttribute('data-chat-api-field') || ''
  if (!llmTestInvalidatingFields.has(field)) return
  clearLLMTestStatus()
}

function handleLLMSettingsDraftSync(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
  if (!target.hasAttribute('data-chat-api-field')) return
  syncLLMDraftProfileFromForm()
  if (editingDraftLLMProfile() && target.getAttribute('data-chat-api-field') === 'profileName') renderLLMProfileList()
}

function handleLLMApiKeyFocus(event: FocusEvent) {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !target.matches('[data-chat-api-field="apiKey"]')) return
  if (isMaskedApiKeyInput(target)) target.select()
}

function handleLLMApiKeyBeforeInput(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !target.matches('[data-chat-api-field="apiKey"]')) return
  if (!isMaskedApiKeyInput(target)) return
  target.value = ''
  clearMaskedApiKeyInput(target)
}

function handleLLMApiKeyInput(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !target.matches('[data-chat-api-field="apiKey"]')) return
  if (target.value !== MASKED_API_KEY_VALUE) clearMaskedApiKeyInput(target)
}

function handleLLMApiKeyBlur(event: FocusEvent) {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !target.matches('[data-chat-api-field="apiKey"]')) return
  const clearInput = llmInput('clearApiKey') as HTMLInputElement | null
  const profile = currentLLMProfile(state.sellerSettings)
  if (profile.hasApiKey && !clearInput?.checked && !target.value.trim()) setMaskedApiKeyInput(target)
}

function handleLLMApiKeyClearChange(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !target.matches('[data-chat-api-field="clearApiKey"]')) return
  const apiKeyInput = llmInput('apiKey') as HTMLInputElement | null
  if (!apiKeyInput) return
  if (target.checked) {
    apiKeyInput.value = ''
    clearMaskedApiKeyInput(apiKeyInput)
    return
  }
  if (currentLLMProfile(state.sellerSettings).hasApiKey) setMaskedApiKeyInput(apiKeyInput)
}

function renderSellerMarketStatus(status: SellerMarketStatus) {
  fields.sellerMarketChip.textContent = uiText(status.discoverable ? 'market searchable' : 'not discoverable')
  fields.sellerMarketChip.dataset.state = status.discoverable ? 'ok' : 'warn'
}

async function run(action: () => Promise<unknown>, success?: string) {
  if (state.busy) return
  setBusy(true)
  try {
    await action()
    if (success) showToast(success)
  } catch (error) {
    showToast(humanizeError(error))
  } finally {
    setBusy(false)
    await refreshStatus()
    await refreshSeller({ market: state.activeView === 'settings' })
  }
}

function renderLocalAgentPromptControls() {
  const ready = Boolean(state.appStatus?.mcpCommand && state.appStatus.discoveryPath)
  fields.localAgentCopyButton.disabled = state.busy || !ready
  fields.localAgentCopyButton.setAttribute('title', uiText(ready ? 'Copy local agent MCP prompt' : 'Starting local Dock'))
}

function composeLocalAgentPrompt(task: string, work: WorkMCPContext) {
  const status = state.appStatus
  const folder = { ...activeProjectFolder(), path: work.projectPath || activeProjectFolder().path }
  const discoveryPath = status?.discoveryPath || ''
  const mcpCommand = status?.mcpCommand || ''
  return [
    'External agent instructions for Exora Dock:',
    '',
    'You are the external local agent for the user task at the end of this prompt. Use my local Exora Dock through MCP as the order and seller-selection control plane.',
    '',
    'Connect to Exora Dock:',
    `1. Read the local discovery manifest: ${discoveryPath}`,
    `2. Start the stdio MCP server with: ${mcpCommand}`,
    '3. Use the Exora MCP tools. Start with exora.run_buyer_work for end-to-end seller discovery, seller-agent negotiation, and owner-selectable order-plan creation.',
    '',
    `Work UID: ${work.workUid}`,
    `Project folder: ${folder.path}`,
    `Permission mode: ${activePermissionOption().label}`,
    `Permission policy: ${permissionPolicyText()}`,
    '',
    'Required MCP request fields:',
    `- Include workUid: "${work.workUid}" on every related Exora MCP call.`,
    `- Include projectPath: "${folder.path}" on the first related MCP call and whenever a tool accepts it; Dock will create/register this Work folder if needed and can resolve later calls from workUid.`,
    '- Do not ask me to advance each step. Continue calling resume_negotiation, create_order_plan_from_quote, and resume_task_flow when nextAction asks for it.',
    '- If Exora Dock returns no suitable task card, seller card, quote, or order option, stop and tell the user that Exora Dock cannot help with this task right now. Include the Dock/MCP reason and do not invent a provider.',
    '',
    'Safety boundaries:',
    '- Do not approve payments, enter payment PINs, or treat MCP tool calls as user payment consent.',
    '- Do not expose secrets, private keys, cloud tokens, or unrelated local files.',
    '- Follow the permission policy above for file and internet access; seller choice, approval, payment, and secrets still stay under Exora Dock owner control.',
    '- Keep all order/task context associated with the project folder above unless the user explicitly asks otherwise.',
    '',
    'User task:',
    task,
  ].join('\n')
}

function localAgentTaskFromInput(value: string) {
  const marker = '\nUser task:\n'
  const index = value.lastIndexOf(marker)
  if (index >= 0) return value.slice(index + marker.length).trim()
  return value.trim()
}

async function createWorkMCPContext(task: string): Promise<WorkMCPContext> {
  const folder = activeProjectFolder()
  try {
    return await invoke<WorkMCPContext>('create_work_mcp_uid', {
      input: { projectPath: folder.path, task },
    })
  } catch (error) {
    const message = humanizeError(error)
    if (!message.includes('unknown desktop command: create_work_mcp_uid')) throw error
    return {
      workUid: `work-${crypto.randomUUID()}`,
      projectPath: folder.path,
      projectName: folder.name,
      task,
    }
  }
}

async function copyLocalAgentPrompt() {
  const task = localAgentTaskFromInput(fields.localAgentTask.value)
    || agentQuery.value.trim()
    || '[Describe the user task here before sending this prompt to the external agent.]'
  if (!state.appStatus?.mcpCommand || !state.appStatus.discoveryPath) {
    showToast(t('toast.refreshRuntimeBeforePrompt'))
    return
  }
  const work = await createWorkMCPContext(task)
  const prompt = composeLocalAgentPrompt(task, work)
  await navigator.clipboard.writeText(prompt)
  setProjectFolders([{ name: work.projectName || projectFolderNameForPath(work.projectPath), path: work.projectPath }, ...state.projectFolders], work.projectPath)
  showToast(t('toast.localAgentPromptCopied', { id: shortID(work.workUid) }))
}

async function takeOverExternalWork() {
  const lease = activeExternalWorkLease()
  const run = activeExternalWorkRun()
  if (!lease && !run) {
    renderExternalWorkLockControls()
    return
  }
  fields.externalWorkTakeoverButton.disabled = true
  try {
    if (run) {
      await invoke('stop_work_run', {
        input: {
          runId: run.runId,
          workUid: run.workUid || lease?.workUid,
          projectPath: run.projectPath || lease?.projectPath || activeProjectFolder().path,
          reason: 'Owner took over this Work in Exora Dock.',
        },
      })
      state.workRuns = state.workRuns.filter((item) => item.runId !== run.runId)
    }
    if (lease) {
      await invoke('release_work_mcp_lease', {
        input: {
          workUid: lease.workUid,
          projectPath: lease.projectPath || activeProjectFolder().path,
        },
      })
      state.workMcpLeases = state.workMcpLeases.filter((item) => item.workUid !== lease.workUid)
    }
    renderExternalWorkLockControls()
    await refreshWorkspace({ quiet: true })
    showToast(t('toast.buyerControlRestored'))
    agentQuery.focus()
  } catch (error) {
    showToast(humanizeError(error))
  } finally {
    renderExternalWorkLockControls()
  }
}

function marketResponseText(result: MarketSearchResult) {
  const candidates = result.candidates?.length || 0
  const options = result.orderDraftOptions?.length || 0
  if (result.selectionRequest) {
    return `${result.summary || `Found ${candidates} matching seller(s).`} I prepared ${Math.min(options || candidates, 6)} owner-selectable option(s) in Work.`
  }
  if (!candidates) return result.summary || 'No matching sellers were found. Try loosening the constraints.'
  return result.summary || `Found ${candidates} matching seller(s).`
}

function sellerPayload() {
  return {
    enabled: checked('enabled'),
    autoQuote: checked('autoQuote'),
    autoAcceptLowRisk: checked('autoAcceptLowRisk'),
    providerId: value('providerId'),
    quotePrice: Number(value('quotePrice') || '0'),
    currency: value('currency') || 'USDC',
    estimatedSeconds: Number(value('estimatedSeconds') || '60'),
  }
}

function apiSettingsPayload(form: HTMLFormElement) {
  const settings = state.sellerSettings
  const apiValue = (name: string) => form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-chat-api-field="${name}"]`)?.value.trim() || ''
  const apiChecked = (name: string) => form.querySelector<HTMLInputElement>(`[data-chat-api-field="${name}"]`)?.checked === true
  const baseUrl = apiValue('llmBaseUrl') || settings?.llmBaseUrl || 'https://api.openai.com/v1'
  const preset = presetById(inferProviderPreset(baseUrl))
  const model = apiValue('researchModel') || settings?.researchModel || preset.model
  return {
    profileId: savedEditingLLMProfileId(),
    enabled: settings?.enabled ?? false,
    autoQuote: settings?.autoQuote ?? false,
    autoAcceptLowRisk: settings?.autoAcceptLowRisk ?? settings?.autoCompleteTextTasks ?? false,
    autoCompleteTextTasks: settings?.autoCompleteTextTasks ?? false,
    llmBaseUrl: baseUrl,
    apiKey: apiKeyValueForPayload(form),
    clearApiKey: apiChecked('clearApiKey'),
    providerPreset: preset.id,
    wireApi: apiValue('wireApi') || settings?.wireApi || defaultWireForPreset(preset.id),
    capabilities: capabilitiesForWire(preset.capabilities, apiValue('wireApi') || settings?.wireApi || defaultWireForPreset(preset.id)),
    researchModel: model,
    researchReasoningEffort: apiValue('researchReasoningEffort') || settings?.researchReasoningEffort || 'high',
    utilityModel: apiValue('utilityModel') || settings?.utilityModel || model,
    utilityReasoningEffort: apiValue('utilityReasoningEffort') || settings?.utilityReasoningEffort || 'low',
    disableResponseStorage: form.querySelector(`[data-chat-api-field="disableResponseStorage"]`) ? apiChecked('disableResponseStorage') : true,
    providerId: settings?.providerId || '',
    quotePrice: settings?.quotePrice ?? 0,
    currency: settings?.currency || 'USDC',
    estimatedSeconds: settings?.estimatedSeconds ?? 60,
  }
}

function llmProfilePayload(form: HTMLFormElement, options: { id?: string; duplicate?: boolean } = {}) {
  const apiValue = (name: string) => form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-chat-api-field="${name}"]`)?.value.trim() || ''
  const apiChecked = (name: string) => form.querySelector<HTMLInputElement>(`[data-chat-api-field="${name}"]`)?.checked === true
  const baseUrl = apiValue('llmBaseUrl') || 'https://api.openai.com/v1'
  const preset = presetById(inferProviderPreset(baseUrl))
  const model = apiValue('researchModel') || preset.model
  const source = currentLLMProfile(state.sellerSettings)
  const editingId = options.id || savedEditingLLMProfileId()
  const sourceId = source.id && !isDraftLLMProfileId(source.id) && source.id !== 'current' ? source.id : undefined
  const useForBuyer = apiChecked('useForBuyer')
  const useForSeller = apiChecked('useForSeller')
  return {
    id: options.duplicate ? undefined : editingId || sourceId,
    cloneKeyFromId: options.duplicate ? sourceId : undefined,
    name: apiValue('profileName') || source.name || `${hostLabelForURL(baseUrl)} / ${model}`,
    providerPreset: preset.id,
    llmBaseUrl: baseUrl,
    apiKey: apiKeyValueForPayload(form),
    clearApiKey: apiChecked('clearApiKey'),
    wireApi: apiValue('wireApi') || defaultWireForPreset(preset.id),
    capabilities: capabilitiesForWire(preset.capabilities, apiValue('wireApi') || defaultWireForPreset(preset.id)),
    researchModel: model,
    researchReasoningEffort: apiValue('researchReasoningEffort') || 'high',
    utilityModel: apiValue('utilityModel') || model,
    utilityReasoningEffort: apiValue('utilityReasoningEffort') || 'low',
    disableResponseStorage: form.querySelector(`[data-chat-api-field="disableResponseStorage"]`) ? apiChecked('disableResponseStorage') : true,
    useForBuyer,
    useForSeller,
  }
}

function syncLLMDraftProfileFromForm() {
  const draft = editingDraftLLMProfile()
  if (!draft) return
  const apiValue = (name: string) => llmSettingsForm.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-chat-api-field="${name}"]`)?.value.trim() || ''
  const apiChecked = (name: string) => llmSettingsForm.querySelector<HTMLInputElement>(`[data-chat-api-field="${name}"]`)?.checked === true
  const baseUrl = apiValue('llmBaseUrl') || draft.llmBaseUrl || 'https://api.openai.com/v1'
  const preset = presetById(inferProviderPreset(baseUrl))
  const wire = (apiValue('wireApi') || draft.wireApi || defaultWireForPreset(preset.id)) as LLMProfile['wireApi']
  const model = apiValue('researchModel') || draft.researchModel || preset.model
  state.llmDraftProfile = {
    ...draft,
    name: apiValue('profileName') || draft.name,
    providerPreset: preset.id,
    llmBaseUrl: baseUrl,
    wireApi: wire,
    capabilities: capabilitiesForWire(preset.capabilities, wire),
    researchModel: model,
    researchReasoningEffort: apiValue('researchReasoningEffort') || draft.researchReasoningEffort || 'high',
    utilityModel: apiValue('utilityModel') || draft.utilityModel || model,
    utilityReasoningEffort: apiValue('utilityReasoningEffort') || draft.utilityReasoningEffort || 'low',
    disableResponseStorage: llmSettingsForm.querySelector('[data-chat-api-field="disableResponseStorage"]')
      ? apiChecked('disableResponseStorage')
      : draft.disableResponseStorage,
    useForBuyer: apiChecked('useForBuyer'),
    useForSeller: apiChecked('useForSeller'),
  }
}

async function syncLLMProfilesFromStatus(status: LLMProfileStatus, preferredId?: string) {
  if (preferredId && !isDraftLLMProfileId(preferredId)) state.llmDraftProfile = undefined
  state.llmProfiles = status.profiles || []
  state.activeLLMProfileId = status.activeProfileId
  state.buyerLLMProfileId = status.buyerProfileId
  state.sellerLLMProfileId = status.sellerProfileId
  state.llmKeyStorageAvailable = Boolean(status.keyStorageAvailable)
  state.editingLLMProfileId = preferredId && state.llmProfiles.some((profile) => profile.id === preferredId)
    ? preferredId
    : editingDraftLLMProfile()
      ? DRAFT_LLM_PROFILE_ID
    : state.editingLLMProfileId && state.llmProfiles.some((profile) => profile.id === state.editingLLMProfileId)
      ? state.editingLLMProfileId
      : state.activeLLMProfileId || state.llmProfiles[0]?.id
  renderLLMSettings(state.sellerSettings)
}

async function saveLLMProfile(options: { apply?: boolean; duplicate?: boolean } = {}) {
  const payload = llmProfilePayload(llmSettingsForm, { duplicate: options.duplicate })
  if (options.duplicate) payload.name = `${payload.name} Copy`
  const previousProfileId = payload.id || state.editingLLMProfileId || ''
  const wasForBuyer = Boolean(previousProfileId && state.buyerLLMProfileId === previousProfileId)
  const wasForSeller = Boolean(previousProfileId && state.sellerLLMProfileId === previousProfileId)
  const status = await invoke<LLMProfileStatus>('save_llm_profile', { input: payload })
  const saved = options.duplicate || !payload.id
    ? status.profiles[0]
    : status.profiles.find((profile) => profile.id === payload.id)
  await syncLLMProfilesFromStatus(status, saved?.id)
  if (options.apply && saved?.id) {
    const applied = await invoke<LLMProfileStatus>('apply_llm_profile', {
      input: {
        id: saved.id,
        useForBuyer: Boolean(payload.useForBuyer),
        useForSeller: Boolean(payload.useForSeller),
        wasForBuyer,
        wasForSeller,
      },
    })
    await syncLLMProfilesFromStatus(applied, saved.id)
    await refreshSeller({ market: true })
    showToast(t('toast.apiProfileSavedApplied'))
  } else {
    showToast(t(options.duplicate ? 'toast.apiProfileDuplicated' : 'toast.apiProfileSaved'))
  }
}

async function deleteLLMProfile() {
  if (editingDraftLLMProfile()) {
    state.llmDraftProfile = undefined
    state.editingLLMProfileId = state.activeLLMProfileId || state.llmProfiles[0]?.id
    clearLLMTestStatus()
    renderLLMSettings(state.sellerSettings)
    return
  }
  const profile = currentLLMProfile(state.sellerSettings)
  if (!profile.id || !window.confirm(`Delete API profile "${profile.name}"?`)) return
  const status = await invoke<LLMProfileStatus>('delete_llm_profile', { input: { id: profile.id } })
  await syncLLMProfilesFromStatus(status)
  showToast(t('toast.apiProfileDeleted'))
}

async function newLLMProfile() {
  if (editingDraftLLMProfile()) return
  const preset = llmPresets[0]
  state.llmDraftProfile = {
    id: DRAFT_LLM_PROFILE_ID,
    name: uniqueLLMProfileName('New API Setting'),
    providerPreset: preset.id,
    llmBaseUrl: preset.baseUrl,
    wireApi: preset.wireApi,
    capabilities: preset.capabilities,
    researchModel: preset.model,
    researchReasoningEffort: 'high',
    utilityModel: preset.model,
    utilityReasoningEffort: 'low',
    disableResponseStorage: true,
    hasApiKey: false,
    keyFormat: 'missing',
    useForBuyer: false,
    useForSeller: false,
  }
  state.editingLLMProfileId = DRAFT_LLM_PROFILE_ID
  clearLLMTestStatus()
  renderLLMSettings(state.sellerSettings)
}

function presetById(id?: string) {
  return llmPresets.find((preset) => preset.id === id) || llmPresets[0]
}

function inferProviderPreset(baseUrl: string) {
  const base = String(baseUrl || '').trim().toLowerCase()
  if (base.includes('openrouter.ai')) return 'openrouter'
  if (base.includes('api.openai.com')) return 'openai_responses'
  if (base.includes('127.0.0.1:11434') || base.includes('localhost:11434')) return 'ollama'
  if (base.includes('127.0.0.1:1234') || base.includes('localhost:1234')) return 'lm_studio'
  return 'custom_openai_compatible'
}

function defaultWireForPreset(presetId: string) {
  return presetId === 'openai_responses' ? 'responses' : 'chat_completions'
}

function capabilitiesForWire(base: LLMCapabilities, wire: string): LLMCapabilities {
  if (wire === 'responses') {
    return {
      ...base,
      supportsResponses: true,
      supportsChatCompletions: true,
      supportsSystemMessage: true,
      supportsJsonResponseFormat: true,
      supportsStreaming: true,
      supportsTools: true,
      supportsReasoningEffort: true,
    }
  }
  return {
    ...base,
    supportsResponses: false,
    supportsChatCompletions: true,
    supportsReasoningEffort: false,
  }
}

function hostLabelForURL(baseUrl: string) {
  try {
    return new URL(baseUrl).host || 'API'
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').split('/')[0] || 'API'
  }
}

function uniqueLLMProfileName(name: string, currentId = '') {
  const requested = name.trim() || 'API Profile'
  const current = currentId.trim()
  const existingNames = new Set(
    state.llmProfiles
      .filter((profile) => profile.id !== current)
      .map((profile) => profile.name.trim().toLowerCase())
      .filter(Boolean),
  )
  if (!existingNames.has(requested.toLowerCase())) return requested

  const numbered = requested.match(/^(.*?)\s+(\d+)$/)
  const numberedBase = numbered?.[1]?.trim()
  const base = numberedBase && existingNames.has(numberedBase.toLowerCase()) ? numberedBase : requested
  let index = numberedBase && base === numberedBase ? Math.max(2, Number(numbered?.[2] || 1) + 1) : 2
  let candidate = `${base} ${index}`
  while (existingNames.has(candidate.toLowerCase())) {
    index += 1
    candidate = `${base} ${index}`
  }
  return candidate
}

function capabilitySummary(capabilities: LLMCapabilities) {
  const flags = [
    capabilities.supportsResponses ? 'Responses' : '',
    capabilities.supportsChatCompletions ? 'Chat' : '',
    capabilities.supportsJsonResponseFormat ? 'JSON' : '',
    capabilities.supportsTools ? 'tools' : '',
    capabilities.supportsReasoningEffort ? 'reasoning' : '',
    capabilities.supportsStreaming ? 'streaming' : '',
  ].filter(Boolean)
  return `Capabilities: ${flags.join(' / ') || 'basic chat'}`
}

function applyPresetToForm(form: HTMLFormElement, preset: LLMProviderPreset) {
  const set = (name: string, value: string) => {
    const input = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-chat-api-field="${name}"]`)
    if (input) input.value = value
  }
  set('llmBaseUrl', preset.baseUrl)
  set('wireApi', preset.wireApi)
  set('researchModel', preset.model)
  set('utilityModel', preset.model)
  const note = form.querySelector<HTMLElement>('[data-provider-note]')
  if (note) note.textContent = preset.note
  const capability = form.querySelector<HTMLElement>('[data-capability-note]')
  if (capability) capability.textContent = capabilitySummary(preset.capabilities)
}

function bindActiveChatToOrder(orderId: string, status?: string) {
  const thread = activeChatThread()
  if (!thread) return
  thread.orderId = orderId
  thread.status = status || thread.status
  thread.updatedAt = Date.now()
  state.selectedWorkThreadId = workThreadIdForChat(thread)
  flushSaveChatThread(thread)
}

function bindActiveChatToTask(task?: Task) {
  if (!task) return
  const thread = activeChatThread()
  if (!thread) {
    state.selectedWorkThreadId = workThreadIdForTask(task)
    return
  }
  if (task.projectPath) {
    thread.projectPath = task.projectPath
    setProjectFolderContext(task.projectPath)
    state.expandedProjectFolderPaths.add(projectPathKey(task.projectPath))
  }
  thread.orderId = task.orderId || task.id
  thread.status = task.status || thread.status
  addUnique(thread.taskIds || (thread.taskIds = []), task.id)
  thread.providerPubkey = task.providerPubkey || task.quote?.providerPubkey || thread.providerPubkey
  thread.updatedAt = Date.now()
  state.selectedWorkThreadId = workThreadIdForChat(thread)
  scheduleSaveAppSettings()
  flushSaveChatThread(thread)
}

function createChatThread(input: { title?: string; providerPubkey?: string; orderId?: string; taskIds?: string[]; status?: string; participants?: ChatThread['participants']; projectPath?: string; origin?: ChatThread['origin']; select?: boolean } = {}) {
  const now = Date.now()
  const thread: ChatThread = {
    id: nextChatID(),
    title: input.title || 'New chat',
    messages: [],
    createdAt: now,
    updatedAt: now,
    projectPath: input.projectPath || activeProjectFolder().path,
    origin: input.origin,
    orderId: input.orderId,
    taskIds: input.taskIds || [],
    status: input.status,
    participants: input.participants || ['buyer_human', 'buyer_agent', 'seller_agent'],
    providerPubkey: input.providerPubkey,
  }
  state.chatThreads.push(thread)
  if (input.select !== false) {
    setProjectFolderContext(thread.projectPath || activeProjectFolder().path)
    state.expandedProjectFolderPaths.add(projectPathKey(thread.projectPath))
    scheduleSaveAppSettings()
    state.selectedChatId = thread.id
    state.selectedWorkThreadId = workThreadIdForChat(thread)
    state.newConversationDraft = false
  }
  return thread
}

function nextDraftTaskTitle(folder: ProjectFolder) {
  const used = new Set<number>()
  const pattern = /^New task(?: (\d+))?$/
  for (const thread of state.chatThreads) {
    if (!sameProjectPath(projectPathForChat(thread), folder.path)) continue
    const match = pattern.exec(thread.title)
    if (!match) continue
    used.add(match[1] ? Number(match[1]) : 1)
  }
  let index = 1
  while (used.has(index)) index += 1
  return index === 1 ? 'New task' : `New task ${index}`
}

function startNewConversation(folder: ProjectFolder = activeProjectFolder()) {
  setProjectFolders([folder, ...state.projectFolders], folder.path)
  state.expandedProjectFolderPaths.add(projectPathKey(folder.path))
  scheduleSaveAppSettings()
  setActiveView('chat')
  agentQuery.value = ''
  createChatThread({ title: nextDraftTaskTitle(folder), status: 'draft', projectPath: folder.path })
  state.selectedId = undefined
  state.pinStep = undefined
  renderAll()
  window.setTimeout(() => agentQuery.focus(), 0)
}

function activeChatThread() {
  return state.chatThreads.find((thread) => thread.id === state.selectedChatId)
}

function ensureChatThread() {
  if (state.newConversationDraft) return createChatThread()
  const workThread = selectedWorkThread()
  const active = activeChatThread()
  if (active && (!workThread || workThread.chatId === active.id || workThreadIdForChat(active) === workThread.id)) return active
  if (workThread) {
    return createChatThread({
      title: workThread.title,
      providerPubkey: workThread.providerPubkey,
      orderId: orderIdFromWorkThreadId(workThread.id),
      taskIds: workThread.taskIds,
      status: workThread.status,
      participants: workThread.participants,
      projectPath: workThread.projectPath,
      origin: workThread.origin,
    })
  }
  return createChatThread()
}

function pushMessage(input: Omit<ChatMessage, 'id'>) {
  const id = nextID()
  const thread = ensureChatThread()
  const message = { id, ...input }
  thread.messages.push(message)
  thread.updatedAt = Date.now()
  if (thread.messages.length === 1 && (thread.title === 'New chat' || /^New task(?: \d+)?$/.test(thread.title) || !thread.title)) {
    thread.title = input.role === 'user' ? compactText(input.text, 52) : compactText(input.meta || input.text, 52)
  }
  if (input.providerPubkey && !thread.providerPubkey) thread.providerPubkey = input.providerPubkey
  state.selectedChatId = thread.id
  state.selectedWorkThreadId = workThreadIdForChat(thread)
  renderChat()
  renderLedger()
  scheduleSaveChatThread(thread)
  return id
}

function updateMessage(id: string, patch: Partial<ChatMessage>) {
  let changedThread: ChatThread | undefined
  for (const thread of state.chatThreads) {
    const message = thread.messages.find((item) => item.id === id)
    if (!message) continue
    Object.assign(message, patch)
    thread.updatedAt = Date.now()
    if (thread.title === 'New chat' && message.role === 'user') {
      thread.title = chatTitle(message)
    }
    changedThread = thread
    break
  }
  renderChat()
  renderLedger()
  if (changedThread) {
    if (patch.pending === false) flushSaveChatThread(changedThread)
    else scheduleSaveChatThread(changedThread)
  }
}

function nextChatID() {
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function nextID() {
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function selectionId(kind: SelectedKind, id: string) {
  return `${kind}:${id}`
}

function parseSelection(value?: string): { kind: SelectedKind; id: string } | undefined {
  if (!value) return undefined
  const [kind, ...rest] = value.split(':')
  const id = rest.join(':')
  if (!id) return undefined
  if (kind === 'plan' || kind === 'approval' || kind === 'task' || kind === 'payment') return { kind, id }
  return undefined
}

function pinActionText(action: PinAction) {
  if (action.kind === 'select_plan') return `Choose seller option ${shortID(action.optionId)}`
  if (action.kind === 'approve') return `Approve request ${shortID(action.approvalId)}`
  return 'Set local payment PIN'
}

function setBusy(next: boolean) {
  state.busy = next
  app.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    if (button.dataset.windowAction) return
    if (button.dataset.toolbarAction === 'toggle-sidebar') return
    button.disabled = next
  })
  agentQuery.disabled = next || builtInBuyerInputLocked()
  fields.localAgentTask.disabled = next
  renderLocalAgentPromptControls()
  renderExternalWorkLockControls()
  renderChromeControls()
}

function showToast(message: string) {
  fields.message.textContent = translatePhrase(message, state.language)
}

function settingsTitles(): Record<SettingsView, { kicker: string; title: string }> {
  return {
    api: { kicker: t('settings.api.kicker'), title: t('settings.api.title') },
    'buyer-agent': { kicker: t('settings.buyerAgent.kicker'), title: t('settings.buyerAgent.title') },
    'buyer-card': { kicker: t('settings.buyerCard.kicker'), title: t('settings.buyerCard.title') },
    'seller-card': { kicker: t('settings.sellerCard.kicker'), title: t('settings.sellerCard.title') },
    seller: { kicker: t('settings.seller.kicker'), title: t('settings.seller.title') },
    pwa: { kicker: t('settings.pwa.kicker'), title: t('settings.pwa.title') },
    wallet: { kicker: t('settings.wallet.kicker'), title: t('settings.wallet.title') },
    archives: { kicker: t('settings.archives.kicker'), title: t('settings.archives.title') },
  }
}

function settingsViewForCardRole(role: AgentCardRole): SettingsView {
  return role === 'buyer' ? 'buyer-card' : 'seller-card'
}

function renderSettingsAgentCardPages() {
  app.querySelectorAll<HTMLElement>('[data-settings-card-content]').forEach((container) => {
    const role = container.dataset.settingsCardContent as AgentCardRole | undefined
    if (role !== 'buyer' && role !== 'seller') return
    container.innerHTML = renderAgentCardSettingsPage(role)
    attachCardHandlers(container)
  })
}

function renderSettingsPanel() {
  const meta = settingsTitles()[state.activeSettingsView]
  fields.mainKicker.textContent = meta.kicker
  fields.decisionTitle.textContent = meta.title
  fields.decisionStep.textContent = 'settings'
  app.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
    const view = button.dataset.settingsTab as SettingsView
    button.classList.toggle('active', view === state.activeSettingsView)
    button.setAttribute('aria-pressed', String(view === state.activeSettingsView))
  })
  app.querySelectorAll<HTMLElement>('[data-settings-page]').forEach((page) => {
    page.classList.toggle('hidden', page.dataset.settingsPage !== state.activeSettingsView)
  })
  if (state.activeSettingsView === 'api') renderLLMSettings(state.sellerSettings)
  renderSettingsAgentCardPages()
  renderLLMTestNote()
  renderPwaLinkStatus()
  renderWalletStatus()
  renderArchiveRecords()
  localize(fields.settingsView)
}

function renderArchiveRecords() {
  const records = state.workTaskState.archivedRecords
  fields.archiveRecords.innerHTML = `
    <div class="section-title">
      <strong>Archive records</strong>
      <span>${records.length ? `${records.length} local` : 'empty'}</span>
    </div>
    ${records.length ? `
      <div class="archive-record-list">
        ${records.map((record) => renderArchiveRecord(record)).join('')}
      </div>
    ` : '<p class="muted">Archived Work tasks appear here.</p>'}
  `
}

function renderArchiveRecord(record: ArchivedWorkRecord) {
  const canRestore = archivedRecordCanRestore(record)
  return `
    <article class="archive-record-card" data-archive-record="${escapeAttr(record.id)}">
      <div class="archive-record-main">
        <strong>${escapeHTML(compactText(record.title, 70))}</strong>
        <span>${escapeHTML(record.projectName)} / ${escapeHTML(record.side || 'work')} / ${escapeHTML(record.sourceKind)} / ${escapeHTML(compactTimestamp(record.archivedAt))}</span>
        <code>${escapeHTML(record.chatSnapshot?.id || record.threadId)}</code>
      </div>
      <div class="archive-record-actions">
        <button class="secondary" type="button" data-archive-action="restore" data-archive-id="${escapeAttr(record.id)}" ${canRestore ? '' : 'disabled'}>Restore</button>
        <button class="secondary" type="button" data-archive-action="copy-id" data-archive-id="${escapeAttr(record.id)}">Copy ID</button>
      </div>
    </article>
  `
}

function renderPwaLinkStatus() {
  const link = state.pwaLink
  fields.pwaLinkState.textContent = uiText(link?.linked ? 'linked' : link?.status || 'not started')
  fields.pwaUserCode.textContent = link?.userCode || uiText('not generated')
  fields.pwaCloudURL.textContent = link?.cloudUrl || uiText('not configured')
  fields.pwaExpires.textContent = link?.expiresAt ? compactTimestamp(link.expiresAt) : uiText('not started')
  fields.pwaTokenPath.textContent = link?.tokenPath || uiText('local after scan')
  fields.pwaLinkNote.textContent = uiText(state.pwaLinkMessage || link?.message || 'Start a QR session, then scan it from the Exora PWA Remote Console.')
  if (link?.qrSvg) {
    fields.pwaQR.innerHTML = link.qrSvg
  } else {
    fields.pwaQR.innerHTML = `<span>${escapeHTML(uiText('QR'))}</span>`
  }
}

function renderWalletStatus() {
  const wallet = state.walletStatus
  const accountWallet = wallet?.accountBound === true
  const address = accountWallet ? wallet?.address?.trim() || '' : ''
  const readyToReceive = Boolean(address)

  fields.walletState.textContent = readyToReceive ? uiText('receive ready') : uiText(wallet ? 'preparing' : 'checking')
  fields.walletReceive.classList.remove('hidden')
  fields.walletAddress.textContent = address || uiText('not configured')
  fields.walletCopyButton.disabled = !readyToReceive

  if (readyToReceive) {
    void renderWalletQRCode(address)
  } else {
    fields.walletQR.innerHTML = `<span>${escapeHTML(uiText('QR'))}</span>`
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

function openSettings(view?: SettingsView) {
  if (view) state.activeSettingsView = view
  state.profileMenuOpen = false
  state.profileSubmenu = undefined
  state.pinStep = undefined
  setActiveView('settings')
  scheduleSaveAppSettings()
  renderAll()
  refreshSeller({ market: true })
  refreshAgentCards()
  refreshSettingsStatus()
}

function returnFromSettings() {
  state.profileMenuOpen = false
  state.profileSubmenu = undefined
  state.pinStep = undefined
  clearPwaLinkPoll()
  const previousIndex = state.viewHistory
    .slice(0, state.viewHistoryIndex)
    .map((view, index) => ({ view, index }))
    .reverse()
    .find((entry) => entry.view !== 'settings')?.index
  if (previousIndex !== undefined) {
    state.viewHistoryIndex = previousIndex
    state.activeView = state.viewHistory[previousIndex]
  } else {
    setActiveView('chat')
  }
  renderAll()
}

async function refreshSettingsStatus() {
  if (state.activeView !== 'settings') return
  const walletError = await refreshWalletStatus()
  renderSettingsPanel()
  if (walletError) {
    fields.walletState.textContent = uiText('offline')
    fields.walletAddress.textContent = walletError
  }
}

async function refreshWalletStatus() {
  const wallet = await invoke<{ wallet?: WalletStatus }>('wallet_status').catch((error) => ({ error: humanizeError(error) }))
  if ('wallet' in wallet) {
    state.walletStatus = wallet.wallet || {}
    if (state.activeView === 'settings') renderWalletStatus()
    return ''
  }
  return 'error' in wallet ? wallet.error : 'Wallet status unavailable.'
}

function input(name: string) {
  return sellerForm.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${name}"]`)!
}

function value(name: string) {
  return input(name).value.trim()
}

function setValue(name: string, next: string) {
  input(name).value = next
}

function checked(name: string) {
  return (input(name) as HTMLInputElement).checked
}

function setChecked(name: string, next: boolean) {
  ;(input(name) as HTMLInputElement).checked = next
}

function llmInput(name: string) {
  return llmSettingsForm.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-chat-api-field="${name}"]`)
}

function setLLMValue(name: string, next: string) {
  const input = llmInput(name)
  if (input) input.value = next
}

function setLLMChecked(name: string, next: boolean) {
  const input = llmInput(name) as HTMLInputElement | null
  if (input) input.checked = next
}

function isMaskedApiKeyInput(input: HTMLInputElement | null | undefined) {
  return Boolean(input && input.dataset.maskedApiKey === 'true' && input.value === MASKED_API_KEY_VALUE)
}

function setMaskedApiKeyInput(input: HTMLInputElement) {
  input.value = MASKED_API_KEY_VALUE
  input.dataset.maskedApiKey = 'true'
}

function clearMaskedApiKeyInput(input: HTMLInputElement) {
  delete input.dataset.maskedApiKey
}

function apiKeyValueForPayload(form: HTMLFormElement) {
  const input = form.querySelector<HTMLInputElement>('[data-chat-api-field="apiKey"]')
  if (!input || isMaskedApiKeyInput(input)) return ''
  return input.value.trim()
}

function selectOrderSide(side: OrderSide) {
  if (state.activeView === 'market') {
    if (state.marketOrderSide === side) return
    state.marketOrderSide = side
    state.marketSelectedId = undefined
    state.marketDetailProvider = undefined
  } else {
    if (state.workOrderSide === side) return
    state.workOrderSide = side
    state.newConversationDraft = true
    state.selectedWorkThreadId = undefined
    state.selectedChatId = undefined
    state.selectedId = undefined
    state.pinStep = undefined
  }
  scheduleSaveAppSettings()
  renderAll()
}

app.querySelector<HTMLButtonElement>('[data-action="refresh-workspace"]')!.addEventListener('click', () => {
  run(() => refreshWorkspace())
})

app.querySelectorAll<HTMLButtonElement>('[data-view-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.viewTab as ActiveView
    if (view === 'market') state.marketDetailProvider = undefined
    setActiveView(view)
    state.selectedId = defaultSelectionForView(view)
    state.pinStep = undefined
    renderAll()
  })
})

fields.orderSideToggle.addEventListener('click', () => {
  const side = state.activeView === 'market' ? state.marketOrderSide : state.workOrderSide
  selectOrderSide(side === 'buyer' ? 'seller' : 'buyer')
})

app.querySelector<HTMLButtonElement>('[data-window-action="minimize"]')!.addEventListener('click', () => {
  invoke('window_minimize').catch((error) => showToast(humanizeError(error)))
})

app.querySelector<HTMLButtonElement>('[data-window-action="maximize"]')!.addEventListener('click', () => {
  invoke('window_toggle_maximize').catch((error) => showToast(humanizeError(error)))
})

app.querySelector<HTMLButtonElement>('[data-window-action="close"]')!.addEventListener('click', () => {
  invoke('window_close').catch((error) => showToast(humanizeError(error)))
})

app.querySelector<HTMLButtonElement>('[data-toolbar-action="search"]')!.addEventListener('click', focusSearch)

fields.settingsReturnButton.addEventListener('click', returnFromSettings)

fields.profileIdentity.addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
  closeProjectFolderMenu()
  closeTaskContextMenu()
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

fields.taskContextMenu.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLButtonElement>('[data-task-menu-action]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  const action = button.dataset.taskMenuAction as TaskMenuAction | undefined
  if (action) handleTaskMenuAction(action).catch((error) => showToast(humanizeError(error)))
})

fields.archiveRecords.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLButtonElement>('[data-archive-action]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  const action = button.dataset.archiveAction
  const id = button.dataset.archiveId || ''
  if (action === 'restore') restoreArchivedRecord(id)
  if (action === 'copy-id') copyArchivedRecordID(id).catch((error) => showToast(humanizeError(error)))
})

fields.marketProjectPicker.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const option = target.closest<HTMLButtonElement>('[data-market-project-path]')
  if (option) {
    event.preventDefault()
    event.stopPropagation()
    selectMarketProject(option.dataset.marketProjectPath || '')
    return
  }
  if (target.closest('[data-action="close-market-project-picker"]')) {
    event.preventDefault()
    event.stopPropagation()
    closeMarketProjectPicker()
  }
})

app.addEventListener('click', (event) => {
  const target = event.target
  if (target instanceof Element) {
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLInputElement &&
      activeElement.closest('[data-card-market-form]') &&
      !target.closest('[data-card-market-form]')
    ) {
      activeElement.blur()
    }
  }
  if (state.profileMenuOpen && !(target instanceof Element && target.closest('.profile-panel'))) closeProfileMenu()
  if (state.projectFolderMenuOpen && !(target instanceof Element && target.closest('.project-folder-head'))) closeProjectFolderMenu()
  if (state.taskMenuOpen && !(target instanceof Element && target.closest('.task-context-menu'))) closeTaskContextMenu()
  if (state.permissionMenuOpen && !(target instanceof Element && target.closest('.permission-control'))) closePermissionMenu()
  if (!(target instanceof Element && target.closest('[data-llm-profile-menu]'))) closeLLMProfileMenu()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeProfileMenu()
    closeProjectFolderMenu()
    closeTaskContextMenu()
    closePermissionMenu()
    closeLLMProfileMenu()
    closeMarketProjectPicker()
  }
})

fields.newChatButton.addEventListener('click', () => {
  closeProjectFolderMenu()
  closeTaskContextMenu()
  startNewConversation()
})

fields.projectFolderMenuButton.addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
  closeTaskContextMenu()
  toggleProjectFolderMenu()
})

fields.projectFolderMenu.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLButtonElement>('[data-project-folder-action]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  const action = button.dataset.projectFolderAction as ProjectFolderMenuAction | undefined
  if (action === 'open' || action === 'rename' || action === 'archive' || action === 'remove') {
    void handleProjectFolderMenuAction(action)
  }
})

fields.projectFolderHead.addEventListener('contextmenu', openProjectFolderContextMenu)

fields.projectFolderToggle.addEventListener('click', () => {
  closeProjectFolderMenu()
  state.projectFolderCollapsed = !state.projectFolderCollapsed
  scheduleSaveAppSettings()
  renderProjectFolder()
})

fields.permissionButton.addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
  closeTaskContextMenu()
  togglePermissionMenu()
})

fields.permissionMenu.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLButtonElement>('[data-permission-mode]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  const mode = button.dataset.permissionMode as PermissionMode | undefined
  if (mode === 'ask' || mode === 'approve' || mode === 'full' || mode === 'custom') setPermissionMode(mode)
})

app.querySelector<HTMLButtonElement>('[data-action="choose-folder"]')!.addEventListener('click', () => {
  closeTaskContextMenu()
  chooseProjectFolder()
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
  closeProjectFolderMenu()
  state.sidebarCollapsed = !state.sidebarCollapsed
  scheduleSaveAppSettings()
  renderAll()
})

fields.forwardButton.addEventListener('click', () => navigateWorkspaceHistory(1))
fields.backButton.addEventListener('click', () => navigateWorkspaceHistory(-1))

app.addEventListener('dblclick', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('button, input, select, textarea, a, [role="button"], .no-drag')) return
  const isDragRegion = Boolean(target.closest('[data-drag-region]'))
  const isTopDragStrip = event.clientY <= TOP_WINDOW_DRAG_HEIGHT
  if (!isDragRegion && !isTopDragStrip) return
  invoke('window_toggle_maximize').catch((error) => showToast(humanizeError(error)))
})

app.querySelectorAll<HTMLButtonElement>('[data-action="open-settings"]').forEach((button) => {
  button.addEventListener('click', () => openSettings())
})

app.querySelectorAll<HTMLButtonElement>('[data-action="open-api-settings"]').forEach((button) => {
  button.addEventListener('click', () => {
    if (state.activeView === 'settings') {
      returnFromSettings()
      return
    }
    openSettings('api')
  })
})

app.querySelectorAll<HTMLButtonElement>('[data-action="open-pwa-link"]').forEach((button) => {
  button.addEventListener('click', () => {
    openSettings('pwa')
    if (!state.pwaLink?.deviceCode || state.pwaLink.linked) {
      run(() => startPwaLink()).catch(() => undefined)
    }
  })
})

fields.localAgentCopyButton.addEventListener('click', () => {
  copyLocalAgentPrompt().catch((error) => showToast(humanizeError(error)))
})

fields.externalWorkTakeoverButton.addEventListener('click', () => {
  takeOverExternalWork().catch((error) => showToast(humanizeError(error)))
})

llmSettingsForm.querySelector<HTMLSelectElement>('[data-chat-api-field="providerPreset"]')?.addEventListener('change', (event) => {
  applyPresetToForm(llmSettingsForm, presetById((event.currentTarget as HTMLSelectElement).value))
})
llmSettingsForm.addEventListener('focusin', handleLLMApiKeyFocus)
llmSettingsForm.addEventListener('beforeinput', handleLLMApiKeyBeforeInput)
llmSettingsForm.addEventListener('input', handleLLMApiKeyInput)
llmSettingsForm.addEventListener('input', handleLLMSettingsDraftSync)
llmSettingsForm.addEventListener('input', handleLLMSettingsTestInvalidation)
llmSettingsForm.addEventListener('focusout', handleLLMApiKeyBlur)
llmSettingsForm.addEventListener('change', handleLLMApiKeyClearChange)
llmSettingsForm.addEventListener('change', handleLLMSettingsDraftSync)
llmSettingsForm.addEventListener('change', handleLLMSettingsTestInvalidation)

function setLLMProfileMenuOpen(open: boolean) {
  const menu = fields.llmProfileList.querySelector<HTMLElement>('[data-llm-profile-menu]')
  const toggle = fields.llmProfileList.querySelector<HTMLButtonElement>('[data-llm-profile-toggle]')
  const list = fields.llmProfileList.querySelector<HTMLElement>('[data-llm-profile-menu-list]')
  if (!menu || !toggle || !list) return
  menu.classList.toggle('open', open)
  toggle.setAttribute('aria-expanded', String(open))
  list.classList.toggle('hidden', !open)
}

function closeLLMProfileMenu() {
  setLLMProfileMenuOpen(false)
}

fields.llmProfileList.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const toggle = target.closest<HTMLButtonElement>('[data-llm-profile-toggle]')
  if (toggle) {
    event.preventDefault()
    event.stopPropagation()
    setLLMProfileMenuOpen(toggle.getAttribute('aria-expanded') !== 'true')
    return
  }
  const option = target.closest<HTMLButtonElement>('[data-llm-profile-option]')
  if (!option) return
  event.preventDefault()
  event.stopPropagation()
  const profileId = option.dataset.llmProfileOption
  if (!profileId) return
  state.llmDraftProfile = undefined
  state.editingLLMProfileId = profileId
  state.llmTestMessage = undefined
  state.llmTestStatus = undefined
  renderLLMSettings(state.sellerSettings)
})

app.querySelector<HTMLButtonElement>('[data-action="new-llm-profile"]')!.addEventListener('click', () => {
  run(() => newLLMProfile())
})

llmSettingsForm.querySelector<HTMLButtonElement>('[data-action="duplicate-llm-profile"]')?.addEventListener('click', () => {
  run(() => saveLLMProfile({ duplicate: true }))
})

llmSettingsForm.querySelector<HTMLButtonElement>('[data-action="delete-llm-profile"]')?.addEventListener('click', () => {
  run(() => deleteLLMProfile())
})

llmSettingsForm.querySelector<HTMLButtonElement>('[data-action="save-llm-profile"]')?.addEventListener('click', () => {
  run(() => saveLLMProfile())
})

llmSettingsForm.querySelector<HTMLButtonElement>('[data-action="test-llm"]')!.addEventListener('click', () => {
  run(async () => {
    try {
      const result = await invoke<{ ok: boolean; status: string; message: string; route: string; llmBaseUrl?: string; wireApi?: LLMProfile['wireApi']; providerPreset?: string; capabilities?: LLMCapabilities; models?: string[] }>('test_llm_connection', {
        input: apiSettingsPayload(llmSettingsForm),
      })
      if (result.ok) {
        if (result.llmBaseUrl) setLLMValue('llmBaseUrl', result.llmBaseUrl)
        if (result.wireApi) setLLMValue('wireApi', result.wireApi)
        if (result.providerPreset) setLLMValue('providerPreset', result.providerPreset)
        if (result.models?.length) state.llmModels = result.models
        syncLLMDraftProfileFromForm()
      }
      state.llmTestStatus = result.ok ? 'passed' : 'failed'
      state.llmTestMessage = result.message
      const datalist = llmSettingsForm.querySelector<HTMLDataListElement>('#llm-model-options')
      if (datalist) datalist.innerHTML = state.llmModels.map((model) => `<option value="${escapeHTML(model)}"></option>`).join('')
      renderLLMTestNote()
    } catch (error) {
      state.llmTestStatus = 'failed'
      state.llmTestMessage = humanizeError(error)
      renderLLMTestNote()
      throw error
    }
  })
})

llmSettingsForm.querySelector<HTMLButtonElement>('[data-action="load-models"]')?.addEventListener('click', () => {
  run(async () => {
    const result = await invoke<{ ok: boolean; models: string[]; message: string; llmBaseUrl?: string }>('list_llm_models', {
      input: apiSettingsPayload(llmSettingsForm),
    })
    if (result.ok && result.llmBaseUrl) setLLMValue('llmBaseUrl', result.llmBaseUrl)
    syncLLMDraftProfileFromForm()
    state.llmModels = result.models || []
    state.llmTestStatus = result.ok ? 'passed' : 'failed'
    state.llmTestMessage = result.message
    const datalist = llmSettingsForm.querySelector<HTMLDataListElement>('#llm-model-options')
    if (datalist) datalist.innerHTML = state.llmModels.map((model) => `<option value="${escapeHTML(model)}"></option>`).join('')
    renderLLMTestNote()
  })
})

llmSettingsForm.addEventListener('submit', (event) => {
  event.preventDefault()
  run(async () => {
    await saveLLMProfile({ apply: true })
    state.chatMode = 'expanded'
    state.llmTestMessage = undefined
    state.llmTestStatus = undefined
    renderAll()
  })
})

app.querySelector<HTMLButtonElement>('[data-action="wallet-refresh"]')!.addEventListener('click', () => {
  run(() => refreshSettingsStatus())
})

app.querySelector<HTMLButtonElement>('[data-action="wallet-copy-address"]')!.addEventListener('click', () => {
  run(async () => {
    const address = state.walletStatus?.address
    if (!address) throw new Error('Wallet address is not configured.')
    await navigator.clipboard.writeText(address)
  }, 'Wallet address copied.')
})

app.querySelector<HTMLButtonElement>('[data-action="pwa-link-start"]')!.addEventListener('click', () => {
  run(() => startPwaLink()).catch(() => undefined)
})

app.querySelector<HTMLButtonElement>('[data-action="pwa-link-check"]')!.addEventListener('click', () => {
  run(() => checkPwaLink()).catch(() => undefined)
})

buyerAgentForm.addEventListener('submit', (event) => {
  event.preventDefault()
  saveBuyerAgentSettings()
})

sellerForm.addEventListener('submit', (event) => {
  event.preventDefault()
  run(() => invoke('save_seller_settings', { input: sellerPayload() }), 'Seller agent saved.')
})

agentChatForm.addEventListener('submit', (event) => {
  event.preventDefault()
  submitAgentMessage()
})

agentQuery.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  if (event.shiftKey) return
  if (!event.isComposing) {
    event.preventDefault()
    submitAgentMessage()
  }
})

agentQuery.addEventListener('input', resizeAgentComposer)

async function bootstrap() {
  await hydrateDesktopPersistence()
  applyUserPreferences()
  renderChat()
  renderAll()
  refreshProjectFolder()
  void startDockOnLaunch()
  refreshWalletStatus().catch(() => undefined)
  refreshSeller({ market: true })
  refreshAgentCards()
  window.setTimeout(() => refreshWorkspace({ quiet: true }), 250)
  setInterval(refreshStatus, 5000)
  setInterval(() => refreshWorkspace({ quiet: true }), 12000)
}

void bootstrap()
