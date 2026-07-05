import { invoke } from './bridge'
import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronRight,
  Copy,
  Cpu,
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
type SettingsView = 'api' | 'runtime' | 'agents' | 'buyer-agent' | 'buyer-card' | 'seller-card' | 'seller' | 'pwa' | 'wallet' | 'security' | 'diagnostics' | 'archives'
type AppLanguage = 'en' | 'zh'
type AppTheme = 'light' | 'dark'
type ProfileSubmenu = 'language' | 'theme'
type ProjectFolderMenuAction = 'open' | 'rename' | 'archive' | 'remove'
type TaskMenuAction = 'pin' | 'rename' | 'archive' | 'unread' | 'open-project' | 'copy-id'
type PermissionMode = 'ask' | 'approve' | 'full' | 'custom'

type BuyerAgentSettings = {
  enabled: boolean
  agentId: string
  negotiationFirst: boolean
  maxResults: number
  maxCandidates: number
  maxOptions: number
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
  | { kind: 'settings_pin' }

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
  boundOnly?: boolean
}

type SecurityStatus = {
  paymentPinConfigured?: boolean
  ownerTokenPresent?: boolean
  agentTokenPresent?: boolean
  authPath?: string
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
const WORK_TASK_STATE_KEY = 'exora.workTaskState.v1'
const APP_SETTINGS_SAVE_DELAY = 250
const DEFAULT_SIDEBAR_WIDTH = 277
const SIDEBAR_MIN_WIDTH = 236
const SIDEBAR_MAX_WIDTH = 480
const CHAT_SAVE_DELAY = 500
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
  createdAt?: string
  updatedAt?: string
}

type LLMProfileStatus = {
  profiles: LLMProfile[]
  activeProfileId?: string
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
}

const profileIcons = {
  phone: icon(Smartphone),
  settings: icon(Settings2),
}

const settingsNavIcons: Record<SettingsView, string> = {
  api: icon(KeyRound),
  runtime: icon(Cpu),
  agents: icon(Network),
  'buyer-agent': icon(ShoppingCart),
  'buyer-card': icon(IdCard),
  'seller-card': icon(BadgeCheck),
  seller: icon(ShoppingBag),
  pwa: icon(QrCode),
  wallet: icon(WalletCards),
  security: icon(ShieldCheck),
  diagnostics: icon(Activity),
  archives: icon(Archive),
}

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

const permissionOptions: Array<{ mode: PermissionMode; label: string; description: string }> = [
  { mode: 'ask', label: 'Ask for approval', description: 'Always ask to edit external files and use the internet' },
  { mode: 'approve', label: 'Approve for me', description: 'Only ask for actions detected as potentially unsafe' },
  { mode: 'full', label: 'Full access', description: 'Unrestricted access to the internet and any file on your computer' },
  { mode: 'custom', label: 'Custom (config.toml)', description: 'Uses permissions defined in config.toml' },
]

const DEFAULT_BUYER_AGENT_SETTINGS: BuyerAgentSettings = {
  enabled: true,
  agentId: 'exora-desktop-agent',
  negotiationFirst: true,
  maxResults: 8,
  maxCandidates: 3,
  maxOptions: 6,
}

const projectFolderMenuIcons = {
  open: icon(FolderOpen),
  rename: icon(PencilLine),
  archive: icon(Archive),
  remove: icon(X),
}

const projectFolderMenuActions: Array<{ action: ProjectFolderMenuAction; label: string; icon: string }> = [
  { action: 'open', label: 'Open in Explorer', icon: projectFolderMenuIcons.open },
  { action: 'rename', label: 'Rename project', icon: projectFolderMenuIcons.rename },
  { action: 'archive', label: 'Archive chats', icon: projectFolderMenuIcons.archive },
  { action: 'remove', label: 'Remove', icon: projectFolderMenuIcons.remove },
]

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
            <span class="local-agent-icon">${settingsNavIcons.agents}</span>
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
        <form class="chat-composer" data-agent-chat-form>
          <textarea data-agent-query rows="1" placeholder="Ask the built-in buyer agent to work inside Exora Dock..."></textarea>
          <div class="composer-footer">
            <div class="permission-control">
              <button class="permission-button" type="button" data-action="toggle-permission-menu" aria-haspopup="menu" aria-expanded="false" title="Permission mode"></button>
              <div class="permission-menu hidden" data-permission-menu role="menu" aria-label="Permission mode"></div>
            </div>
            <button class="composer-action-button" type="submit" aria-label="Send message" title="Send">${toolbarIcons.send}</button>
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
                <strong>LLM API Profiles</strong>
                <span data-key-state>No API key saved.</span>
              </div>
              <div class="api-profiles-layout">
                <section class="api-profile-sidebar">
                  <div class="api-profile-sidebar-head">
                    <div>
                      <strong>Use API</strong>
                      <small>Select the provider profile used by Exora Dock.</small>
                    </div>
                  </div>
                  <div class="api-profile-list" data-llm-profile-list></div>
                </section>
                <form class="api-settings-form agent-card-form card-setup-list api-profile-config-form" data-llm-form>
                  <div class="card-setup-row card-setup-head-row">
                    <span class="local-agent-icon">${settingsNavIcons.api}</span>
                    <strong data-llm-profile-heading>API Profile</strong>
                    <small data-llm-profile-subtitle>Configure one reusable provider profile.</small>
                    <span class="card-status-chip" data-llm-active-chip>inactive</span>
                  </div>
                  <div class="card-setup-actionbar">
                    <button class="card-action-button api-profile-mini-action" type="button" data-action="new-llm-profile"><span class="card-action-icon">${toolbarIcons.plus}</span><span class="card-action-text">New API</span></button>
                    <button class="card-action-button" type="button" data-action="duplicate-llm-profile"><span class="card-action-icon">${toolbarIcons.copy}</span><span class="card-action-text">Duplicate</span></button>
                    <button class="card-action-button" type="button" data-action="delete-llm-profile"><span class="card-action-icon">${profileMenuIcons.logout}</span><span class="card-action-text">Delete</span></button>
                    <button class="card-action-button" type="button" data-action="test-llm"><span class="card-action-text">Test Connection</span></button>
                    <button class="card-action-button" type="button" data-action="load-models"><span class="card-action-text">Load Models</span></button>
                    <button class="card-action-button save-card-action" type="button" data-action="save-llm-profile"><span class="card-action-text">Save Profile</span></button>
                    <button class="card-action-button publish-card-action" type="submit"><span class="card-action-text">Save & Use</span></button>
                  </div>
                  <div class="card-setup-row card-message-row">
                    <span class="field-label">Status</span>
                    <small class="field-help">Profile state and API key storage.</small>
                    <strong class="diagnostic-value" data-llm-profile-status>No profile loaded.</strong>
                  </div>
                  <div class="card-setup-row card-setup-section-row"><strong>Profile</strong><span>Name and saved key metadata</span></div>
                  <label class="card-setup-row card-field-row"><span class="field-label">Profile name</span><small class="field-help">Shown in the API profile list.</small><input data-chat-api-field="profileName" placeholder="OpenAI production" /></label>
                  <label class="card-setup-row card-field-row"><span class="field-label">API key</span><small class="field-help">Stored per profile with Electron safeStorage. Leave blank to keep the saved key.</small><input data-chat-api-field="apiKey" type="password" autocomplete="off" placeholder="Leave blank to keep saved key" /></label>
                  <label class="card-setup-row card-field-row inline-check-row"><span class="field-label">Clear key</span><small class="field-help">Remove the saved key from this profile.</small><span class="inline-check-control"><input data-chat-api-field="clearApiKey" type="checkbox" /> Clear saved API key</span></label>
                  <div class="card-setup-row card-setup-section-row"><strong>Provider</strong><span data-provider-note></span></div>
                  <label class="card-setup-row card-field-row"><span class="field-label">Provider</span><small class="field-help">Preset controls default URL, wire API, and capabilities.</small><select data-chat-api-field="providerPreset">${llmPresets.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.label)}</option>`).join('')}</select></label>
                  <label class="card-setup-row card-field-row"><span class="field-label">Base URL</span><small class="field-help">OpenAI-compatible endpoint root.</small><input data-chat-api-field="llmBaseUrl" placeholder="https://api.openai.com/v1" /></label>
                  <label class="card-setup-row card-field-row"><span class="field-label">Wire API</span><small class="field-help">Use Responses when supported, otherwise Chat Completions.</small><select data-chat-api-field="wireApi"><option value="responses">Responses</option><option value="chat_completions">Chat completions</option></select></label>
                  <div class="card-setup-row card-setup-section-row"><strong>Models</strong><span>Research and utility model selection</span></div>
                  <label class="card-setup-row card-field-row"><span class="field-label">Research model</span><small class="field-help">Used for planning, seller selection, and higher-reasoning work.</small><input data-chat-api-field="researchModel" list="llm-model-options" placeholder="gpt-5.5" /><datalist id="llm-model-options"></datalist></label>
                  <label class="card-setup-row card-field-row"><span class="field-label">Research effort</span><small class="field-help">Provider-specific reasoning effort, usually high.</small><input data-chat-api-field="researchReasoningEffort" placeholder="high" /></label>
                  <label class="card-setup-row card-field-row"><span class="field-label">Utility model</span><small class="field-help">Used for lower-latency utility calls.</small><input data-chat-api-field="utilityModel" list="llm-model-options" placeholder="gpt-5.5" /></label>
                  <label class="card-setup-row card-field-row"><span class="field-label">Utility effort</span><small class="field-help">Provider-specific reasoning effort, usually low.</small><input data-chat-api-field="utilityReasoningEffort" placeholder="low" /></label>
                  <div class="card-setup-row card-setup-section-row"><strong>Safety</strong><span data-capability-note></span></div>
                  <label class="card-setup-row card-field-row inline-check-row"><span class="field-label">Response storage</span><small class="field-help">Keep disabled for providers that support response storage controls.</small><span class="inline-check-control"><input data-chat-api-field="disableResponseStorage" type="checkbox" /> Disable response storage</span></label>
                  <div class="card-setup-row card-message-row">
                    <span class="field-label">Test</span>
                    <small class="field-help">Connection and model list feedback.</small>
                    <strong class="diagnostic-value test-note hidden" data-llm-test-note></strong>
                  </div>
                </form>
              </div>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="runtime">
            <div class="settings-section">
              <div class="section-title">
                <strong>Runtime</strong>
                <span data-runtime>checking</span>
              </div>
              <p class="muted" data-status-message>Checking local runtime...</p>
              <div class="settings-actions">
                <button data-action="start">Start / Repair</button>
                <button class="secondary" data-action="stop">Stop</button>
                <button class="secondary" data-action="restart">Restart</button>
              </div>
              <dl class="compact-list">
                <div><dt>REST</dt><dd data-base-url>http://127.0.0.1:8080</dd></div>
                <div><dt>Discovery</dt><dd data-discovery></dd></div>
                <div><dt>MCP</dt><dd data-mcp></dd></div>
                <div><dt>Binary</dt><dd data-image-tag></dd></div>
                <div><dt>Data</dt><dd data-data-dir></dd></div>
              </dl>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="agents">
            <div class="settings-section">
              <div class="section-title">
                <strong>External agents</strong>
                <span>Codex / Claude Code / OpenCode</span>
              </div>
              <p class="muted">Use this generic MCP setup for external agents. Task-specific Work prompts add a Work UID; agents can search, prepare order plans, and check status, but cannot approve payments or reveal secrets.</p>
              <div class="settings-actions two-col">
                <button data-action="copy-prompt">Copy Agent Prompt</button>
                <button data-action="copy-opencode">Copy OpenCode Config</button>
                <button data-action="copy-mcp">Copy MCP Command</button>
                <button data-action="copy-rest">Copy REST URL</button>
              </div>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="pwa">
            <div class="settings-section">
              <div class="section-title">
                <strong>PWA connection</strong>
                <span data-pwa-link-state>not started</span>
              </div>
              <div class="pwa-link-grid">
                <div class="pwa-qr-frame" data-pwa-qr>
                  <span>QR</span>
                </div>
                <dl class="compact-list pwa-link-meta">
                  <div><dt>User code</dt><dd data-pwa-user-code>not generated</dd></div>
                  <div><dt>Cloud</dt><dd data-pwa-cloud-url>not configured</dd></div>
                  <div><dt>Expires</dt><dd data-pwa-expires>not started</dd></div>
                  <div><dt>Token</dt><dd data-pwa-token-path>local after scan</dd></div>
                </dl>
              </div>
              <p class="muted pwa-link-note" data-pwa-link-note>Start a QR session, then scan it from the Exora PWA Remote Console.</p>
              <div class="settings-actions two-col">
                <button type="button" data-action="pwa-link-start">New QR</button>
                <button class="secondary" type="button" data-action="pwa-link-check">Check Link</button>
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
                <div class="card-setup-row card-setup-section-row"><strong>Routing</strong><span>Seller discovery and negotiation limits</span></div>
                <label class="card-setup-row card-field-row inline-check-row">
                  <span class="field-label">Negotiation first</span>
                  <small class="field-help">Ask seller agents for quotes before creating owner choices.</small>
                  <span class="inline-check-control"><input data-buyer-field="negotiationFirst" type="checkbox" /> Use seller-agent negotiation</span>
                </label>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">Search results</span>
                  <small class="field-help">Maximum seller-card or resource matches to inspect.</small>
                  <input data-buyer-field="maxResults" type="number" min="1" max="20" step="1" />
                </label>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">Seller negotiations</span>
                  <small class="field-help">Maximum seller agents contacted per buyer request.</small>
                  <input data-buyer-field="maxCandidates" type="number" min="1" max="6" step="1" />
                </label>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">Order options</span>
                  <small class="field-help">Maximum choices prepared when negotiation-first is off.</small>
                  <input data-buyer-field="maxOptions" type="number" min="1" max="6" step="1" />
                </label>
                <div class="card-setup-row card-setup-section-row"><strong>Owner control</strong><span>Default permission boundary</span></div>
                <label class="card-setup-row card-field-row">
                  <span class="field-label">Permission mode</span>
                  <small class="field-help">Applied to new buyer-agent work.</small>
                  <select data-buyer-field="permissionMode">
                    ${permissionOptions.map((item) => `<option value="${escapeHTML(item.mode)}">${escapeHTML(item.label)}</option>`).join('')}
                  </select>
                </label>
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
              <form class="seller-form" data-seller-form>
                <label class="toggle">
                  <input type="checkbox" data-field="enabled" />
                  <span>Enable seller agent</span>
                </label>
                <div class="two">
                  <label>
                    <span>Provider ID</span>
                    <input data-field="providerId" placeholder="local-dev-miner" />
                  </label>
                  <label>
                    <span>ETA Seconds</span>
                    <input data-field="estimatedSeconds" type="number" min="1" step="1" />
                  </label>
                </div>
                <div class="two">
                  <label>
                    <span>Quote Price</span>
                    <input data-field="quotePrice" type="number" min="0" step="0.01" />
                  </label>
                  <label>
                    <span>Currency</span>
                    <input data-field="currency" />
                  </label>
                </div>
                <label class="toggle">
                  <input type="checkbox" data-field="autoQuote" />
                  <span>Auto quote new tasks</span>
                </label>
                <label class="toggle">
                  <input type="checkbox" data-field="autoCompleteTextTasks" />
                  <span>Auto complete text tasks</span>
                </label>
                <label class="toggle">
                  <input type="checkbox" data-field="dockerEnabled" />
                  <span>Enable Docker jobs</span>
                </label>
                <div class="two">
                  <label>
                    <span>Default image</span>
                    <input data-field="dockerDefaultImage" placeholder="python:3.12-alpine" />
                  </label>
                  <label>
                    <span>Allowed images</span>
                    <input data-field="dockerAllowedImages" placeholder="python:3.12-alpine, node:22-alpine" />
                  </label>
                </div>
                <div class="two">
                  <label>
                    <span>Network mode</span>
                    <input data-field="dockerNetworkMode" placeholder="none" />
                  </label>
                  <label>
                    <span>Allowed networks</span>
                    <input data-field="dockerAllowedNetworkModes" placeholder="none" />
                  </label>
                </div>
                <div class="two">
                  <label>
                    <span>Max CPUs</span>
                    <input data-field="dockerMaxCpus" type="number" min="0" step="0.1" />
                  </label>
                  <label>
                    <span>Max memory MB</span>
                    <input data-field="dockerMaxMemoryMb" type="number" min="0" step="128" />
                  </label>
                </div>
                <label class="toggle">
                  <input type="checkbox" data-field="dockerAllowGpu" />
                  <span>Allow GPU containers</span>
                </label>
                <button type="submit">Save Seller Agent</button>
              </form>
              <p class="muted">Seller agent uses the LLM provider configured in the API category.</p>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="wallet">
            <div class="settings-section">
              <div class="section-title">
                <strong>On-chain wallet</strong>
                <span data-wallet-state>checking</span>
              </div>
              <p class="muted">Wallet settings stay local. Remote consoles never reveal mnemonic, private key, or raw keypair files.</p>
              <dl class="compact-list">
                <div><dt>Address</dt><dd data-wallet-address>not configured</dd></div>
                <div><dt>Mode</dt><dd data-wallet-mode>unknown</dd></div>
                <div><dt>Keypair path</dt><dd data-wallet-keypair>hidden unless local keypair exists</dd></div>
              </dl>
              <div class="settings-actions two-col">
                <button type="button" data-action="wallet-refresh">Refresh Wallet</button>
                <button class="secondary" type="button" data-action="wallet-create">Create Local Wallet</button>
              </div>
              <form class="wallet-bind-form" data-wallet-bind-form>
                <label>
                  <span>Bind existing Solana address</span>
                  <input data-wallet-address-input placeholder="Base58 public address" />
                </label>
                <button class="secondary" type="submit">Bind Address Only</button>
              </form>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="security">
            <div class="settings-section">
              <div class="section-title">
                <strong>Account security</strong>
                <span data-security-state>local</span>
              </div>
              <dl class="compact-list">
                <div><dt>Payment PIN</dt><dd data-security-pin>checking</dd></div>
                <div><dt>Owner token</dt><dd data-security-owner-token>local only</dd></div>
                <div><dt>Agent token</dt><dd data-security-agent-token>local only</dd></div>
                <div><dt>Auth file</dt><dd data-security-auth-path>hidden</dd></div>
              </dl>
              <button class="secondary full-width" data-action="settings-pin">Set / Reset Payment PIN</button>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="diagnostics">
            <div class="settings-section">
              <div class="section-title">
                <strong>Diagnostics</strong>
                <span>local files</span>
              </div>
              <div class="settings-actions two-col">
                <button class="secondary" data-action="health">Open Health</button>
                <button class="secondary" data-action="manifest">Open Manifest</button>
                <button class="secondary" data-action="logs">Open Logs</button>
                <button class="secondary" data-action="copy-rest">Copy REST URL</button>
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

    <div class="toast" data-message>Checking local runtime...</div>

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
          <button class="settings-nav-item" data-settings-tab="runtime" type="button"><span>Runtime</span><small>local daemon</small></button>
          <button class="settings-nav-item" data-settings-tab="agents" type="button"><span>MCP</span><small>external agents</small></button>
          <button class="settings-nav-item" data-settings-tab="seller" type="button"><span>Seller</span><small>market listing agent</small></button>
          <button class="settings-nav-item" data-settings-tab="wallet" type="button"><span>Wallet</span><small>on-chain identity</small></button>
          <button class="settings-nav-item" data-settings-tab="security" type="button"><span>Security</span><small>PIN and local auth</small></button>
          <button class="settings-nav-item" data-settings-tab="diagnostics" type="button"><span>Diagnostics</span><small>logs and manifests</small></button>
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

          <section class="settings-page hidden" data-settings-page="runtime">
            <div class="settings-section">
              <div class="section-title">
                <strong>Runtime</strong>
                <span data-runtime>checking</span>
              </div>
              <p class="muted" data-status-message>Checking local runtime...</p>
              <div class="settings-actions">
                <button data-action="start">Start / Repair</button>
                <button class="secondary" data-action="stop">Stop</button>
                <button class="secondary" data-action="restart">Restart</button>
              </div>
              <dl class="compact-list">
                <div><dt>REST</dt><dd data-base-url>http://127.0.0.1:8080</dd></div>
                <div><dt>Discovery</dt><dd data-discovery></dd></div>
                <div><dt>MCP</dt><dd data-mcp></dd></div>
                <div><dt>Binary</dt><dd data-image-tag></dd></div>
                <div><dt>Data</dt><dd data-data-dir></dd></div>
              </dl>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="agents">
            <div class="settings-section">
              <div class="section-title">
                <strong>External agents</strong>
                <span>Codex / Claude Code / OpenCode</span>
              </div>
              <p class="muted">Use this generic MCP setup for external agents. Task-specific Work prompts add a Work UID; agents can search, prepare order plans, and check status, but cannot approve payments or reveal secrets.</p>
              <div class="settings-actions two-col">
                <button data-action="copy-prompt">Copy Agent Prompt</button>
                <button data-action="copy-opencode">Copy OpenCode Config</button>
                <button data-action="copy-mcp">Copy MCP Command</button>
                <button data-action="copy-rest">Copy REST URL</button>
              </div>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="seller">
            <div class="settings-section">
              <div class="section-title">
                <strong>Seller agent</strong>
                <span data-seller-market-chip>checking</span>
              </div>
              <form class="seller-form" data-seller-form>
                <label class="toggle">
                  <input type="checkbox" data-field="enabled" />
                  <span>Enable seller agent</span>
                </label>
                <div class="two">
                  <label>
                    <span>Provider ID</span>
                    <input data-field="providerId" placeholder="local-dev-miner" />
                  </label>
                  <label>
                    <span>ETA Seconds</span>
                    <input data-field="estimatedSeconds" type="number" min="1" step="1" />
                  </label>
                </div>
                <div class="two">
                  <label>
                    <span>Quote Price</span>
                    <input data-field="quotePrice" type="number" min="0" step="0.01" />
                  </label>
                  <label>
                    <span>Currency</span>
                    <input data-field="currency" />
                  </label>
                </div>
                <label class="toggle">
                  <input type="checkbox" data-field="autoQuote" />
                  <span>Auto quote new tasks</span>
                </label>
                <label class="toggle">
                  <input type="checkbox" data-field="autoCompleteTextTasks" />
                  <span>Auto complete text tasks</span>
                </label>
                <label class="toggle">
                  <input type="checkbox" data-field="dockerEnabled" />
                  <span>Enable Docker jobs</span>
                </label>
                <div class="two">
                  <label>
                    <span>Default image</span>
                    <input data-field="dockerDefaultImage" placeholder="python:3.12-alpine" />
                  </label>
                  <label>
                    <span>Allowed images</span>
                    <input data-field="dockerAllowedImages" placeholder="python:3.12-alpine, node:22-alpine" />
                  </label>
                </div>
                <div class="two">
                  <label>
                    <span>Network mode</span>
                    <input data-field="dockerNetworkMode" placeholder="none" />
                  </label>
                  <label>
                    <span>Allowed networks</span>
                    <input data-field="dockerAllowedNetworkModes" placeholder="none" />
                  </label>
                </div>
                <div class="two">
                  <label>
                    <span>Max CPUs</span>
                    <input data-field="dockerMaxCpus" type="number" min="0" step="0.1" />
                  </label>
                  <label>
                    <span>Max memory MB</span>
                    <input data-field="dockerMaxMemoryMb" type="number" min="0" step="128" />
                  </label>
                </div>
                <label class="toggle">
                  <input type="checkbox" data-field="dockerAllowGpu" />
                  <span>Allow GPU containers</span>
                </label>
                <button type="submit">Save Seller Agent</button>
              </form>
              <p class="muted">Seller agent uses the LLM provider configured in the API category.</p>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="wallet">
            <div class="settings-section">
              <div class="section-title">
                <strong>On-chain wallet</strong>
                <span data-wallet-state>checking</span>
              </div>
              <p class="muted">Wallet settings stay local. Remote consoles never reveal mnemonic, private key, or raw keypair files.</p>
              <dl class="compact-list">
                <div><dt>Address</dt><dd data-wallet-address>not configured</dd></div>
                <div><dt>Mode</dt><dd data-wallet-mode>unknown</dd></div>
                <div><dt>Keypair path</dt><dd data-wallet-keypair>hidden unless local keypair exists</dd></div>
              </dl>
              <div class="settings-actions two-col">
                <button type="button" data-action="wallet-refresh">Refresh Wallet</button>
                <button class="secondary" type="button" data-action="wallet-create">Create Local Wallet</button>
              </div>
              <form class="wallet-bind-form" data-wallet-bind-form>
                <label>
                  <span>Bind existing Solana address</span>
                  <input data-wallet-address-input placeholder="Base58 public address" />
                </label>
                <button class="secondary" type="submit">Bind Address Only</button>
              </form>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="security">
            <div class="settings-section">
              <div class="section-title">
                <strong>Account security</strong>
                <span data-security-state>local</span>
              </div>
              <dl class="compact-list">
                <div><dt>Payment PIN</dt><dd data-security-pin>checking</dd></div>
                <div><dt>Owner token</dt><dd data-security-owner-token>local only</dd></div>
                <div><dt>Agent token</dt><dd data-security-agent-token>local only</dd></div>
                <div><dt>Auth file</dt><dd data-security-auth-path>hidden</dd></div>
              </dl>
              <button class="secondary full-width" data-action="settings-pin">Set / Reset Payment PIN</button>
            </div>
          </section>

          <section class="settings-page hidden" data-settings-page="diagnostics">
            <div class="settings-section">
              <div class="section-title">
                <strong>Diagnostics</strong>
                <span>local files</span>
              </div>
              <div class="settings-actions two-col">
                <button class="secondary" data-action="health">Open Health</button>
                <button class="secondary" data-action="manifest">Open Manifest</button>
                <button class="secondary" data-action="logs">Open Logs</button>
                <button class="secondary" data-action="copy-rest">Copy REST URL</button>
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
  runtime: app.querySelector<HTMLElement>('[data-runtime]')!,
  statusMessage: app.querySelector<HTMLElement>('[data-status-message]')!,
  baseUrl: app.querySelector<HTMLElement>('[data-base-url]')!,
  message: app.querySelector<HTMLElement>('[data-message]')!,
  discovery: app.querySelector<HTMLElement>('[data-discovery]')!,
  mcp: app.querySelector<HTMLElement>('[data-mcp]')!,
  imageTag: app.querySelector<HTMLElement>('[data-image-tag]')!,
  dataDir: app.querySelector<HTMLElement>('[data-data-dir]')!,
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
  sidebarSectionHead: app.querySelector<HTMLElement>('.sidebar-section-head')!,
  sidebarTitle: app.querySelector<HTMLElement>('[data-sidebar-title]')!,
  ledgerList: app.querySelector<HTMLElement>('[data-ledger-list]')!,
  ledgerCount: app.querySelector<HTMLElement>('[data-ledger-count]')!,
  newChatButton: app.querySelector<HTMLButtonElement>('[data-action="new-chat"]')!,
  settingsReturnButton: app.querySelector<HTMLButtonElement>('[data-action="return-from-settings"]')!,
  localAgentCard: app.querySelector<HTMLElement>('[data-local-agent-card]')!,
  localAgentTask: app.querySelector<HTMLTextAreaElement>('[data-local-agent-task]')!,
  localAgentCopyButton: app.querySelector<HTMLButtonElement>('[data-action="copy-local-agent-prompt"]')!,
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
  llmProfileHeading: app.querySelector<HTMLElement>('[data-llm-profile-heading]')!,
  llmProfileSubtitle: app.querySelector<HTMLElement>('[data-llm-profile-subtitle]')!,
  llmActiveChip: app.querySelector<HTMLElement>('[data-llm-active-chip]')!,
  llmProfileStatus: app.querySelector<HTMLElement>('[data-llm-profile-status]')!,
  walletState: app.querySelector<HTMLElement>('[data-wallet-state]')!,
  walletAddress: app.querySelector<HTMLElement>('[data-wallet-address]')!,
  walletMode: app.querySelector<HTMLElement>('[data-wallet-mode]')!,
  walletKeypair: app.querySelector<HTMLElement>('[data-wallet-keypair]')!,
  pwaLinkState: app.querySelector<HTMLElement>('[data-pwa-link-state]')!,
  pwaQR: app.querySelector<HTMLElement>('[data-pwa-qr]')!,
  pwaUserCode: app.querySelector<HTMLElement>('[data-pwa-user-code]')!,
  pwaCloudURL: app.querySelector<HTMLElement>('[data-pwa-cloud-url]')!,
  pwaExpires: app.querySelector<HTMLElement>('[data-pwa-expires]')!,
  pwaTokenPath: app.querySelector<HTMLElement>('[data-pwa-token-path]')!,
  pwaLinkNote: app.querySelector<HTMLElement>('[data-pwa-link-note]')!,
  securityState: app.querySelector<HTMLElement>('[data-security-state]')!,
  securityPin: app.querySelector<HTMLElement>('[data-security-pin]')!,
  securityOwnerToken: app.querySelector<HTMLElement>('[data-security-owner-token]')!,
  securityAgentToken: app.querySelector<HTMLElement>('[data-security-agent-token]')!,
  securityAuthPath: app.querySelector<HTMLElement>('[data-security-auth-path]')!,
  archiveRecords: app.querySelector<HTMLElement>('[data-archive-records]')!,
}

const buyerAgentForm = app.querySelector<HTMLFormElement>('[data-buyer-agent-form]')!
const sellerForm = app.querySelector<HTMLFormElement>('[data-seller-form]')!
const llmSettingsForm = app.querySelector<HTMLFormElement>('[data-llm-form]')!
const walletBindForm = app.querySelector<HTMLFormElement>('[data-wallet-bind-form]')!
const agentChatForm = app.querySelector<HTMLFormElement>('[data-agent-chat-form]')!
const agentQuery = app.querySelector<HTMLTextAreaElement>('[data-agent-query]')!

function hasDesktopBridge() {
  return Boolean(window.exora?.invoke)
}

function legacyStoredLanguage(): AppLanguage {
  return localStorage.getItem('exora.language') === 'zh' ? 'zh' : 'en'
}

function storedLanguage(): AppLanguage {
  return hasDesktopBridge() ? 'en' : legacyStoredLanguage()
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
    negotiationFirst: typeof input.negotiationFirst === 'boolean' ? input.negotiationFirst : DEFAULT_BUYER_AGENT_SETTINGS.negotiationFirst,
    maxResults: clampInteger(input.maxResults, DEFAULT_BUYER_AGENT_SETTINGS.maxResults, 1, 20),
    maxCandidates: clampInteger(input.maxCandidates, DEFAULT_BUYER_AGENT_SETTINGS.maxCandidates, 1, 6),
    maxOptions: clampInteger(input.maxOptions, DEFAULT_BUYER_AGENT_SETTINGS.maxOptions, 1, 6),
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
  llmModels: string[]
  llmProfiles: LLMProfile[]
  activeLLMProfileId?: string
  editingLLMProfileId?: string
  llmKeyStorageAvailable: boolean
  activeSettingsView: SettingsView
  walletStatus?: WalletStatus
  pwaLink?: PwaLinkStatus
  pwaLinkMessage?: string
  securityStatus?: SecurityStatus
  appStatus?: AppStatus
  projectFolder?: ProjectFolder
  projectFolders: ProjectFolder[]
  activeProjectFolderPath?: string
  mcpConnections: MCPConnection[]
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
  editingLLMProfileId: undefined,
  llmKeyStorageAvailable: false,
  agentCards: {},
  cardDrafts: {},
  cardDiagnosticsTasks: {},
  activeSettingsView: 'api',
  projectFolders: [],
  mcpConnections: [],
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
let cardDiagnosticsTaskSequence = 0
let settingsPersistenceReady = false
let appSettingsSaveTimer: number | undefined
let lastTransactionsFingerprint = ''
let sidebarResizePointerId: number | undefined
const chatSaveTimers = new Map<string, number>()
const chatSaveQueues = new Map<string, Promise<void>>()
const threadStorageKeys = new Map<string, string>()

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

function isSettingsView(value: unknown): value is SettingsView {
  return value === 'api' || value === 'runtime' || value === 'agents' || value === 'buyer-agent' || value === 'buyer-card' || value === 'seller-card' || value === 'seller' || value === 'pwa' || value === 'wallet' || value === 'security' || value === 'diagnostics' || value === 'archives'
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
    activeSettingsView: isSettingsView(input.activeSettingsView) ? input.activeSettingsView : undefined,
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
  fields.sidebarButton.setAttribute('aria-label', state.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar')
  fields.sidebarButton.setAttribute('title', state.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar')
  fields.sidebarButton.disabled = false
  fields.backButton.disabled = state.busy || (state.viewHistoryIndex <= 0 && !(state.activeView === 'market' && state.marketDetailProvider))
  fields.forwardButton.disabled = state.busy || state.viewHistoryIndex >= state.viewHistory.length - 1
}

function renderProfileSummary() {
  const name = state.signedOut ? (state.language === 'zh' ? '已退出登录' : 'Signed out') : profileDisplayName()
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
  return buyerName || sellerName || providerId || 'Exora User'
}

function profileInitial(name: string) {
  const first = Array.from(name.trim()).find((char) => /\p{L}|\p{N}/u.test(char))
  return first ? first.toUpperCase() : 'E'
}

function applyUserPreferences() {
  document.documentElement.dataset.theme = state.theme
  document.documentElement.lang = state.language === 'zh' ? 'zh-CN' : 'en'
}

function activePermissionOption() {
  return permissionOptions.find((option) => option.mode === state.permissionMode) || permissionOptions[0]
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
  fields.permissionMenu.innerHTML = permissionOptions.map((option) => `
    <button class="permission-menu-item ${option.mode === state.permissionMode ? 'active' : ''}" type="button" data-permission-mode="${option.mode}" role="menuitem">
      <span class="permission-menu-icon permission-icon-${option.mode}">${permissionIcons[option.mode]}</span>
      <span class="permission-menu-text">
        <strong>${escapeHTML(option.label)}</strong>
        <small>${escapeHTML(option.description)}</small>
      </span>
      <span class="permission-menu-check">${option.mode === state.permissionMode ? permissionCheckIcon : ''}</span>
    </button>
  `).join('')
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
  showToast(`${activePermissionOption().label} enabled.`)
}

function permissionPolicyText(mode = state.permissionMode) {
  if (mode === 'ask') return 'Always ask the Dock owner before editing external files, using the internet, choosing sellers, approving work, paying, or exposing sensitive data.'
  if (mode === 'approve') return 'Proceed with routine safe steps, but ask the Dock owner before potentially unsafe external writes, internet use, payments, secrets, or seller commitments.'
  if (mode === 'full') return 'Full project and internet access is allowed for this task. Payment PINs, owner tokens, and wallet/payment consent still require the Dock owner.'
  return 'Follow the permissions defined in config.toml. If that configuration is unavailable or unclear, ask the Dock owner before proceeding.'
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
  if (state.language === 'zh') {
    return {
      signOut: state.signedOut ? '已退出登录' : '退出登录',
      language: '语言',
      theme: '主题',
      english: 'English',
      chinese: '中文',
      light: '浅色',
      dark: '深色',
    }
  }
  return {
    signOut: state.signedOut ? 'Signed out' : 'Sign out',
    language: 'Language',
    theme: 'Theme',
    english: 'English',
    chinese: 'Chinese',
    light: 'Light',
    dark: 'Dark',
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
  showToast(state.language === 'zh' ? '已退出本地会话。' : 'Signed out locally.')
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
  state.language = language
  if (!hasDesktopBridge()) localStorage.setItem('exora.language', state.language)
  scheduleSaveAppSettings()
  state.profileMenuOpen = false
  state.profileSubmenu = undefined
  applyUserPreferences()
  renderAll()
  showToast(state.language === 'zh' ? '语言已切换为中文。' : 'Language switched to English.')
}

function setTheme(theme: AppTheme) {
  state.theme = theme
  if (!hasDesktopBridge()) localStorage.setItem('exora.theme', state.theme)
  scheduleSaveAppSettings()
  state.profileMenuOpen = false
  state.profileSubmenu = undefined
  applyUserPreferences()
  renderAll()
  showToast(state.theme === 'dark' ? 'Dark theme enabled.' : 'Light theme enabled.')
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
  fields.projectFolderToggle.setAttribute('title', expanded ? 'Collapse folder tasks' : 'Expand folder tasks')
  fields.projectFolderToggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${name} tasks`)
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
  fields.projectFolderMenu.innerHTML = projectFolderMenuActions
    .map(({ action, label, icon }) => `
      <button class="project-folder-menu-item" type="button" data-project-folder-action="${action}" role="menuitem">
        <span class="project-folder-menu-icon">${icon}</span>
        <span class="project-folder-menu-label">${escapeHTML(label)}</span>
      </button>
    `)
    .join('')
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
    { action: 'pin', label: pinned ? '取消置顶任务' : '置顶任务', icon: taskMenuIcons.pin },
    { action: 'rename', label: '重命名任务', icon: taskMenuIcons.rename },
    { action: 'archive', label: '归档任务', icon: taskMenuIcons.archive },
    { action: 'unread', label: unread ? '标记为已读' : '标记为未读', icon: taskMenuIcons.unread },
    { action: 'open-project', label: '在资源管理器中打开', icon: taskMenuIcons['open-project'], dividerBefore: true },
    { action: 'copy-id', label: '复制会话 ID', icon: taskMenuIcons['copy-id'] },
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
        showToast(folder.daemonRestarted ? `Project folder applied: ${folder.name}` : `Project folder: ${folder.name}`)
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
    showToast('Open in Explorer is only available in the desktop app.')
    return
  }
  setBusy(true)
  try {
    const folder = await invoke<ProjectFolder>('open_project_folder')
    setProjectFolders([folder, ...state.projectFolders], folder.path)
    renderProjectFolder()
    showToast(`Opened ${folder.name}.`)
  } catch (error) {
    const message = humanizeError(error)
    if (message.includes('unknown desktop command: open_project_folder')) {
      await navigator.clipboard?.writeText(activeProjectFolder().path).catch(() => undefined)
      showToast('Please restart Exora Dock to enable Open in Explorer. Folder path copied.')
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
  const nextName = window.prompt('Rename project', currentName)?.trim()
  if (!nextName || nextName === currentName) return
  setBusy(true)
  try {
    const folder = window.exora?.invoke
      ? await invoke<ProjectFolder>('rename_project_folder', { input: { name: nextName } })
      : renameBrowserProjectFolder(nextName)
    state.projectFolder = folder
    setProjectFolders([folder, ...state.projectFolders], folder.path)
    renderProjectFolder()
    showToast(`Project renamed: ${folder.name}.`)
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
    showToast('No chats to archive.')
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
    showToast(result.archivePath ? `Archived ${result.archivedCount} chats.` : `Archived ${result.archivedCount} chats.`)
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
    showToast(`Project removed. Current project: ${folder.name}.`)
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

async function refreshLLMProfiles(options: { render?: boolean } = {}) {
  const status = await invoke<LLMProfileStatus>('llm_profiles').catch(() => null)
  if (!status) return
  state.llmProfiles = status.profiles || []
  state.activeLLMProfileId = status.activeProfileId
  state.llmKeyStorageAvailable = Boolean(status.keyStorageAvailable)
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
      message: '诊断中...',
    }
    state.activeCardEditor = role
    state.cardMessage = '诊断中...'
    if (shouldRender) renderAgentCardSurfaces()
  }
  try {
    const response = await invoke<{ card?: AgentCard }>('agent_card_draft', { input })
    const task = shouldTrack ? state.cardDiagnosticsTasks[role] : undefined
    if (shouldTrack && (!task || task.id !== taskId || task.stopRequested)) return undefined
    if (response.card) {
      state.cardDrafts[role] = response.card
      state.activeCardEditor = role
      state.cardMessage = '诊断完成，已填入系统属性和建议内容。'
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
      if (task.stopRequested) task.message = '诊断已停止。'
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
  const form = root.querySelector<HTMLFormElement>(`[data-agent-card-form="${role}"]`) || undefined
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
  task.message = '诊断已停止。'
  state.activeCardEditor = role
  state.cardMessage = task.message
  renderAgentCardSurfaces()
}

function agentCardDraftPayload(role: AgentCardRole, form?: HTMLFormElement) {
  const card = cardForRole(role)
  if (!form) return { role }
  const data = new FormData(form)
  if (role === 'buyer') return { role, buyer: buyerFieldsFromForm(data, card?.manualFields.buyer || {}) }
  return { role, seller: sellerFieldsFromForm(data, card?.manualFields.seller || {}) }
}

async function saveAgentCardFromForm(form: HTMLFormElement, role: AgentCardRole) {
  let card = cardForRole(role)
  if (!card) {
    card = await generateAgentCardDraft(role, form, { render: false, track: false })
  }
  if (!card) return
  const data = new FormData(form)
  const next: AgentCard = {
    ...card,
    manualFields: {
      ...card.manualFields,
      buyer: role === 'buyer' ? buyerFieldsFromForm(data, card.manualFields.buyer || {}) : card.manualFields.buyer,
      seller: role === 'seller' ? sellerFieldsFromForm(data, card.manualFields.seller || {}) : card.manualFields.seller,
    },
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
  const form = root.querySelector<HTMLFormElement>(`[data-agent-card-form="${role}"]`)
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
        width: 236,
        margin: 1,
        color: { dark: '#17211e', light: '#ffffff' },
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

function buyerFieldsFromForm(data: FormData, current: BuyerManualFields): BuyerManualFields {
  return {
    ...current,
    displayName: String(data.get('displayName') || '').trim(),
    budget: String(data.get('budget') || '').trim(),
    riskBoundary: String(data.get('riskBoundary') || '').trim(),
    authorizationStrategy: String(data.get('authorizationStrategy') || '').trim(),
    preferences: parseListInput(data.get('preferences')),
    acceptedTaskTypes: parseListInput(data.get('acceptedTaskTypes')),
  }
}

function sellerFieldsFromForm(data: FormData, current: SellerManualFields): SellerManualFields {
  return {
    ...current,
    displayName: String(data.get('displayName') || '').trim(),
    capabilitySummary: String(data.get('capabilitySummary') || '').trim(),
    pricing: String(data.get('pricing') || '').trim(),
    availability: String(data.get('availability') || '').trim(),
    humanConfirmation: String(data.get('humanConfirmation') || '').trim(),
    dataBoundary: String(data.get('dataBoundary') || '').trim(),
    capabilityTypes: parseListInput(data.get('capabilityTypes')),
    managedApis: parseListInput(data.get('managedApis')),
  }
}

async function refreshWorkspace(options: { quiet?: boolean } = {}) {
  if (state.workspaceLoading) return
  state.workspaceLoading = true
  const previousSelected = state.selectedId
  try {
    const snapshot = await invoke<WorkspaceSnapshot>('workspace_snapshot').catch((error) => ({
      online: false,
      orderPlans: [],
      approvals: [],
      tasks: [],
      payments: [],
      mcpConnections: [],
      projectFolders: state.projectFolders,
      activeProjectFolderPath: state.activeProjectFolderPath,
      errors: [humanizeError(error)],
    }))
    state.orderPlans = snapshot.orderPlans || []
    state.approvals = snapshot.approvals || []
    state.tasks = snapshot.tasks || []
    state.payments = snapshot.payments || []
    state.mcpConnections = snapshot.mcpConnections || []
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
  } finally {
    state.workspaceLoading = false
  }
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
  if (!state.buyerAgentSettings.enabled) {
    showToast('Buyer agent is disabled in Settings.')
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
  fields.runtime.textContent = `${status.docker} / ${status.container} / ${status.image}`
  fields.statusMessage.textContent = status.message
  fields.baseUrl.textContent = status.baseUrl
  fields.message.textContent = status.message
  fields.discovery.textContent = status.discoveryPath
  fields.mcp.textContent = status.mcpCommand
  fields.imageTag.textContent = status.imageTag
  fields.dataDir.textContent = status.dataDir
  renderLocalAgentPromptControls()
}

function renderChat() {
  renderChatSurface()
  if (state.newConversationDraft) {
    fields.chatFeed.innerHTML = '<div class="chat-empty-state"><h2>What would you like to do?</h2></div>'
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
  if (!workThread && messages.length === 0 && events.length === 0) {
    fields.chatFeed.innerHTML = '<div class="chat-empty-state"><h2>What would you like to do?</h2></div>'
    return
  }
  if (messages.length === 0 && events.length === 0) {
    fields.chatFeed.innerHTML = '<div class="chat-empty-state"><h2>What would you like to do?</h2></div>'
    return
  }
  fields.chatFeed.innerHTML = [
    ...messages.map(renderChatMessage),
    ...events.map(renderWorkEventCard),
  ].join('')
  attachDecisionHandlers(fields.chatFeed)
  fields.chatFeed.scrollTop = fields.chatFeed.scrollHeight
}

function renderChatMessage(message: ChatMessage) {
  if (message.kind === 'order_event') {
    return `
      <article class="chat-order-event">
        <div class="message-meta">${escapeHTML(message.meta || actorLabel(message.actor) || 'Order event')}</div>
        <p>${escapeHTML(message.text)}</p>
      </article>
    `
  }
  return `
    <article class="chat-message ${message.role}${message.pending ? ' pending' : ''}">
      <div class="message-meta">${escapeHTML(message.meta || actorLabel(message.actor) || messageRoleLabel(message.role))}</div>
      <p>${escapeHTML(message.text)}</p>
      ${message.result ? renderSearchResult(message.result) : ''}
    </article>
  `
}

function actorLabel(actor?: ChatMessage['actor']) {
  if (actor === 'buyer_agent') return 'Our agent'
  if (actor === 'seller_agent') return 'Seller agent'
  if (actor === 'buyer_human') return 'You'
  if (actor === 'seller_human') return 'Seller'
  return ''
}

function messageRoleLabel(role: ChatMessage['role']) {
  if (role === 'user') return 'You'
  if (role === 'assistant') return 'Exora'
  return 'System'
}

function renderSearchResult(result: MarketSearchResult) {
  const candidates = (result.candidates || []).slice(0, 3)
  if (candidates.length === 0) return ''
  return `
    <div class="result-strip">
      <span>${escapeHTML(targetSummary(result.normalizedQuery))}</span>
      <span>${(result.orderDraftOptions || []).length || candidates.length} option(s)</span>
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

function renderChatSurface() {
  const started = chatSurfaceStarted()
  fields.chatView.classList.remove('compact')
  fields.chatView.classList.toggle('empty-mode', !started)
  fields.chatView.classList.toggle('conversation-mode', started)
  fields.chatFeed.classList.remove('hidden')
  fields.localAgentCard.classList.toggle('hidden', started)
  app.querySelector<HTMLElement>('.work-or-divider')?.classList.toggle('hidden', started)
  agentChatForm.classList.remove('hidden')
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
  return messages.length > 0 || events.length > 0
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
    showToast('Buyer agent is disabled in Settings.')
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

const settingsNavItems: Array<{ view: SettingsView; title: string }> = [
  { view: 'api', title: 'Provider API' },
  { view: 'buyer-agent', title: 'Buyer Agent' },
  { view: 'buyer-card', title: 'Buyer Card' },
  { view: 'seller-card', title: 'Seller Card' },
  { view: 'seller', title: 'Seller Agent' },
  { view: 'agents', title: 'External MCP' },
  { view: 'pwa', title: 'PWA Link' },
  { view: 'wallet', title: 'Wallet' },
  { view: 'security', title: 'Security' },
  { view: 'archives', title: 'Archive Records' },
  { view: 'runtime', title: 'Runtime' },
  { view: 'diagnostics', title: 'Diagnostics' },
]

function renderLedger() {
  renderViewTabs()
  fields.ledgerList.classList.toggle('settings-list', state.activeView === 'settings')
  if (state.activeView === 'settings') {
    renderSettingsSidebar()
    return
  }
  if (state.activeView === 'market') {
    renderMarketTransactionSidebar()
    return
  }
  renderOrderActivitySidebar()
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
  fields.ledgerList.innerHTML = settingsNavItems.map((item) => `
    <button class="ledger-item history-record settings-record ${item.view === state.activeSettingsView ? 'active' : ''}" data-settings-tab="${escapeHTML(item.view)}" title="${escapeHTML(item.title)}">
      <span class="settings-record-icon">${settingsNavIcons[item.view]}</span>
      <strong>${escapeHTML(item.title)}</strong>
    </button>
  `).join('')
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeSettingsView = button.dataset.settingsTab as SettingsView
      scheduleSaveAppSettings()
      renderAll()
      if (state.activeSettingsView === 'wallet' || state.activeSettingsView === 'security') {
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
    fields.contextStrip.textContent = 'Select order activity on the left, or ask for a capability below.'
    return
  }
  if (selected.kind === 'plan') {
    fields.contextStrip.textContent = `Seller choice: ${selected.value.query || 'market request'}`
  } else if (selected.kind === 'approval') {
    fields.contextStrip.textContent = `Approval: ${selected.value.action || 'request'} for task ${shortID(selected.value.taskId)}`
  } else if (selected.kind === 'task') {
    fields.contextStrip.textContent = `Task: ${taskTitle(selected.value)}`
  } else {
    fields.contextStrip.textContent = `Payment: ${selected.value.status || 'record'} ${paymentAmount(selected.value)}`
  }
}

function renderDecisionPanel() {
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
    fields.decisionContent.innerHTML = renderOrderPlanDecision(selected.value)
  } else if (selected.kind === 'approval') {
    fields.mainKicker.textContent = 'Work'
    fields.decisionTitle.textContent = 'Approval Request'
    fields.decisionStep.textContent = selected.value.paymentRequired ? 'Payment required' : 'Review'
    fields.decisionContent.innerHTML = renderApprovalDecision(selected.value)
  } else if (selected.kind === 'task') {
    fields.mainKicker.textContent = 'Work'
    fields.decisionTitle.textContent = 'Task Status'
    fields.decisionStep.textContent = selected.value.status || 'task'
    fields.decisionContent.innerHTML = renderTaskDecision(selected.value)
  } else {
    fields.mainKicker.textContent = 'Work'
    fields.decisionTitle.textContent = 'Payment Proof'
    fields.decisionStep.textContent = selected.value.status || 'payment'
    fields.decisionContent.innerHTML = renderPaymentDecision(selected.value)
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
      <p>${escapeHTML(buyer.riskBoundary || 'Request resources, compare provider cards, approve work, and keep transaction records under local owner control.')}</p>
      <dl class="detail-grid">
        <div><dt>Status</dt><dd>${escapeHTML(card.status)}</dd></div>
        <div><dt>Budget</dt><dd>${escapeHTML(buyer.budget || 'not set')}</dd></div>
        <div><dt>Agent</dt><dd>${escapeHTML(card.agentId || 'not set')}</dd></div>
        <div><dt>Tasks</dt><dd>${escapeHTML(listSummary(buyer.acceptedTaskTypes))}</dd></div>
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
  return `
    <article class="agent-card seller-agent-card">
      <div class="agent-card-head">
        <span class="profile-avatar">SL</span>
        <div>
          <p class="message-meta">Seller Card</p>
          <h3>${escapeHTML(seller.displayName || providerId || 'Exora Seller')}</h3>
        </div>
      </div>
      <p>${escapeHTML(seller.capabilitySummary || 'Publish capabilities, quote work, and let other agents discover this local provider card through the market.')}</p>
      <dl class="detail-grid">
        <div><dt>Status</dt><dd>${escapeHTML(card.status)}</dd></div>
        <div><dt>Pricing</dt><dd>${escapeHTML(seller.pricing || 'not set')}</dd></div>
        <div><dt>Availability</dt><dd>${escapeHTML(seller.availability || 'not set')}</dd></div>
        <div><dt>Capabilities</dt><dd>${escapeHTML(listSummary(seller.capabilityTypes))}</dd></div>
        <div><dt>Diagnostics</dt><dd>${escapeHTML(diagnosticsSummary(card.diagnostics))}</dd></div>
        <div><dt>Updated</dt><dd>${escapeHTML(shortDate(card.updatedAt))}</dd></div>
      </dl>
      ${renderSystemAttributes(card)}
      <div class="decision-actions">
        <button type="button" data-card-action="edit" data-card-role="seller">Edit card</button>
        <button type="button" data-card-action="publish" data-card-role="seller">Publish</button>
        <button type="button" class="secondary" data-card-action="refresh">Refresh</button>
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
          <h3>${isBuyer ? '买家名片未设置' : '卖家名片未设置'}</h3>
          <p>${isBuyer ? '前往设置页补充预算、风险边界和授权策略。' : '前往设置页补充能力、报价、可用性和数据边界。'}</p>
          <button type="button" data-card-action="setup-card" data-card-role="${role}">${isBuyer ? '开始设置买家名片' : '开始设置卖家名片'}</button>
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
  const setupTitle = isBuyer ? '买家名片设置' : '卖家名片设置'
  const setupCopy = isBuyer
    ? '设置预算、风险边界和授权偏好。可以先填写，再用诊断补全系统属性和建议内容。'
    : '设置能力、报价、可用性和数据边界。可以先填写，再用诊断补全系统属性和建议内容。'
  const status = card?.status || 'not set'
  const diagnosticsTask = state.cardDiagnosticsTasks[role]
  const messageText = diagnosticsTask?.message || (state.activeCardEditor === role ? state.cardMessage : '')
  const message = messageText
    ? `
      <div class="card-setup-row card-message-row">
        <span class="field-label">状态</span>
        <small class="field-help">最近操作</small>
        <strong class="diagnostic-value">${escapeHTML(messageText)}</strong>
      </div>
    `
    : ''
  return `
    ${renderAgentCardActionBar(role)}
    <form class="agent-card-form card-setup-list agent-card-settings-form" data-agent-card-form="${role}">
      ${message}
      <div class="card-setup-row card-setup-section-row">
        <strong>可填写项</strong>
        <span>${isBuyer ? '请求方偏好' : '提供方能力'}</span>
      </div>
      ${fields}
      <div class="card-setup-row card-setup-section-row">
        <strong>系统属性</strong>
        <span>${card ? (card.status === 'published' ? '公开名片信息' : '本地可见，发布后公开') : '尚未诊断'}</span>
      </div>
      ${renderAgentCardDiagnosticRows(card)}
    </form>
  `
}

function renderAgentCardActionBar(role: AgentCardRole) {
  const diagnosing = state.cardDiagnosticsTasks[role]?.running === true
  const hasUnsavedChanges = agentCardHasUnsavedChanges(role)
  return `
    <div class="card-setup-actionbar" aria-label="Agent card actions">
      <button type="button" class="card-action-button diagnose-card-action ${diagnosing ? 'is-running' : ''}" data-card-action="${diagnosing ? 'stop-diagnose' : 'diagnose'}" data-card-role="${role}" ${diagnosing ? 'aria-busy="true"' : ''}>
        <span class="card-action-icon">${diagnosing ? windowIcons.close : cardActionIcons.diagnose}</span>
        <span class="card-action-text">${diagnosing ? '停止诊断...' : '开始诊断'}</span>
        <span class="diagnose-progress" aria-hidden="true"><span></span></span>
      </button>
      <button type="button" class="card-action-button save-card-action ${hasUnsavedChanges ? 'is-dirty' : 'is-saved'}" data-card-action="save" data-card-role="${role}" title="${hasUnsavedChanges ? '保存本地更改' : '当前内容已保存'}">
        <span class="card-action-icon">${hasUnsavedChanges ? cardActionIcons.save : cardActionIcons.saved}</span>
        <span class="card-action-text">${hasUnsavedChanges ? '保存本地' : '已保存'}</span>
      </button>
      <button type="button" class="card-action-button publish-card-action" data-card-action="publish" data-card-role="${role}">
        <span class="card-action-icon">${cardActionIcons.publish}</span>
        <span class="card-action-text">发布</span>
      </button>
    </div>
  `
}

function renderAgentCardDiagnosticRows(card?: AgentCard) {
  if (!card) {
    return `
      <div class="card-setup-row card-diagnostic-row muted-diagnostics"><span class="field-label">OS</span><small class="field-help">操作系统与版本</small><strong class="diagnostic-value">尚未诊断</strong></div>
      <div class="card-setup-row card-diagnostic-row muted-diagnostics"><span class="field-label">CPU</span><small class="field-help">核心数与型号</small><strong class="diagnostic-value">尚未诊断</strong></div>
      <div class="card-setup-row card-diagnostic-row muted-diagnostics"><span class="field-label">Memory</span><small class="field-help">物理内存容量</small><strong class="diagnostic-value">尚未诊断</strong></div>
      <div class="card-setup-row card-diagnostic-row muted-diagnostics"><span class="field-label">Disk</span><small class="field-help">系统卷剩余空间</small><strong class="diagnostic-value">点击“开始诊断”后填入</strong></div>
    `
  }
  const diagnostics = card.diagnostics
  return `
      <div class="card-setup-row card-diagnostic-row"><span class="field-label">OS</span><small class="field-help">系统与内核</small><strong class="diagnostic-value">${escapeHTML(systemOSSummary(diagnostics))}</strong></div>
      <div class="card-setup-row card-diagnostic-row"><span class="field-label">CPU</span><small class="field-help">核心数与型号</small><strong class="diagnostic-value">${escapeHTML(systemCPUSummary(diagnostics))}</strong></div>
      <div class="card-setup-row card-diagnostic-row"><span class="field-label">Memory</span><small class="field-help">物理内存容量</small><strong class="diagnostic-value">${escapeHTML(diagnostics.ramGb ? `${diagnostics.ramGb}GB RAM` : 'not detected')}</strong></div>
      <div class="card-setup-row card-diagnostic-row"><span class="field-label">GPU</span><small class="field-help">显卡与显存</small><strong class="diagnostic-value">${escapeHTML(systemGPUSummary(diagnostics))}</strong></div>
      <div class="card-setup-row card-diagnostic-row"><span class="field-label">Disk</span><small class="field-help">系统卷容量</small><strong class="diagnostic-value">${escapeHTML(systemStorageSummary(diagnostics))}</strong></div>
      <div class="card-setup-row card-diagnostic-row"><span class="field-label">Runtime</span><small class="field-help">本地运行环境</small><strong class="diagnostic-value">${escapeHTML(systemRuntimeSummary(diagnostics))}</strong></div>
  `
}

function renderBuyerCardFields(buyer: BuyerManualFields) {
  return `
    <label class="card-setup-row card-field-row"><span class="field-label">显示名称</span><small class="field-help">公开展示的买家名片名称。</small><input name="displayName" value="${escapeAttr(buyer.displayName || '')}" placeholder="Local buyer agent" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">预算范围</span><small class="field-help">写清单次任务预算、报价规则或先询价。</small><input name="budget" value="${escapeAttr(buyer.budget || '')}" placeholder="80 USDC / task, quote first" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">风险边界</span><small class="field-help">说明允许和禁止代理执行的任务范围。</small><textarea name="riskBoundary" placeholder="Low-risk compute, research, and code work only">${escapeHTML(buyer.riskBoundary || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">授权策略</span><small class="field-help">定义付款、数据访问和任务确认如何批准。</small><textarea name="authorizationStrategy">${escapeHTML(buyer.authorizationStrategy || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">偏好</span><small class="field-help">用逗号分隔，例如隐私、信誉、速度。</small><input name="preferences" value="${escapeAttr(listInput(buyer.preferences))}" placeholder="privacy first, high reputation, speed" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">接受任务类型</span><small class="field-help">列出此买家愿意委托的任务类型。</small><input name="acceptedTaskTypes" value="${escapeAttr(listInput(buyer.acceptedTaskTypes))}" placeholder="research, coding, data cleanup" /></label>
  `
}

function renderSellerCardFields(seller: SellerManualFields) {
  return `
    <label class="card-setup-row card-field-row"><span class="field-label">显示名称</span><small class="field-help">公开展示的卖家名片名称。</small><input name="displayName" value="${escapeAttr(seller.displayName || '')}" placeholder="Local provider card" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">能力摘要</span><small class="field-help">概括这台机器和代理可以安全提供什么。</small><textarea name="capabilitySummary" placeholder="Describe what this machine and agent can safely do">${escapeHTML(seller.capabilitySummary || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">报价方式</span><small class="field-help">写清固定价格、按任务报价或先询价。</small><input name="pricing" value="${escapeAttr(seller.pricing || '')}" placeholder="Quote first, or 12 USDC / task" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">可用性</span><small class="field-help">说明可接单时间、人工确认和响应速度。</small><input name="availability" value="${escapeAttr(seller.availability || '')}" placeholder="Manual approval, evenings, best effort" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">确认策略</span><small class="field-help">说明哪些操作必须由真人确认。</small><textarea name="humanConfirmation">${escapeHTML(seller.humanConfirmation || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">数据边界</span><small class="field-help">说明不会接触或外发的数据范围。</small><textarea name="dataBoundary">${escapeHTML(seller.dataBoundary || '')}</textarea></label>
    <label class="card-setup-row card-field-row"><span class="field-label">能力类型</span><small class="field-help">用逗号分隔，便于 Market 匹配。</small><input name="capabilityTypes" value="${escapeAttr(listInput(seller.capabilityTypes))}" placeholder="coding, browsing, data processing" /></label>
    <label class="card-setup-row card-field-row"><span class="field-label">托管 API</span><small class="field-help">列出可由代理调度的本地或远程能力。</small><input name="managedApis" value="${escapeAttr(listInput(seller.managedApis))}" placeholder="OpenAI-compatible LLM, browser, private DB" /></label>
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
  const manualFields = { ...card.manualFields }
  if (form) {
    const data = new FormData(form)
    if (role === 'buyer') manualFields.buyer = buyerFieldsFromForm(data, card.manualFields.buyer || {})
    if (role === 'seller') manualFields.seller = sellerFieldsFromForm(data, card.manualFields.seller || {})
  }
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
  const visibility = card.status === 'published' ? '公开名片信息' : '本地可见，发布后公开'
  return `
    <section class="system-attributes">
      <div class="system-attributes-head">
        <strong>系统属性</strong>
        <span>${visibility}</span>
      </div>
      <dl class="detail-grid system-attribute-grid">
        <div><dt>OS</dt><dd>${escapeHTML(systemOSSummary(diagnostics))}</dd></div>
        <div><dt>CPU</dt><dd>${escapeHTML(systemCPUSummary(diagnostics))}</dd></div>
        <div><dt>Memory</dt><dd>${escapeHTML(diagnostics.ramGb ? `${diagnostics.ramGb}GB RAM` : 'not detected')}</dd></div>
        <div><dt>GPU</dt><dd>${escapeHTML(systemGPUSummary(diagnostics))}</dd></div>
        <div><dt>Disk</dt><dd>${escapeHTML(systemStorageSummary(diagnostics))}</dd></div>
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
  const totalVRAM = gpus.reduce((sum, gpu) => sum + (gpu.vramGb || 0), 0)
  return `${gpus.length} GPU${totalVRAM ? ` / ${totalVRAM}GB VRAM` : ''}`
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

function systemRuntimeSummary(diagnostics: AgentCardDiagnostics) {
  const parts = [
    diagnostics.dockerAvailable ? diagnostics.dockerVersion || 'Docker' : '',
    diagnostics.pythonVersion || '',
    diagnostics.nodeVersion ? `Node ${diagnostics.nodeVersion}` : '',
    diagnostics.npmVersion ? `npm ${diagnostics.npmVersion}` : '',
    diagnostics.mcpAvailable ? 'MCP' : '',
  ].filter(Boolean)
  return parts.join(' / ') || 'not detected'
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

function listInput(values?: string[]) {
  return values?.join(', ') || ''
}

function parseListInput(value: FormDataEntryValue | null) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
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
      <input name="query" placeholder="Search cards" autocomplete="off" />
      <button class="card-market-search-button" type="submit" aria-label="Search cards" title="Search">${toolbarIcons.search}</button>
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
        <button type="button" class="secondary" data-market-card-detail="${escapeAttr(candidate.providerPubkey)}">展示详情</button>
        <button type="button" data-market-card-chat="${escapeAttr(candidate.providerPubkey)}">开始沟通</button>
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
        <button type="button" class="secondary" data-market-detail-back>返回卡牌页</button>
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
        <button type="button" data-market-card-chat="${escapeAttr(candidate.providerPubkey)}">开始沟通</button>
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
        <strong>Choose project</strong>
        <small>Start communication with ${escapeHTML(sellerTitle)}</small>
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
      title: `Market task: ${sellerTitle}`,
      providerPubkey: candidate.providerPubkey,
      projectPath: folder.path,
      origin: 'market-card',
      select: false,
    })
    thread.messages.push({
      id: nextID(),
      role: 'user',
      text: `Start a market task with ${sellerTitle}.`,
      meta: 'Market Card',
      providerPubkey: candidate.providerPubkey,
    })
    thread.messages.push({
      id: nextID(),
      role: 'assistant',
      text: `I created a market task record for ${sellerTitle}. Tell me the task goal, budget, input files, and expected output so I can turn it into an Exora task draft.`,
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
  showToast(existing ? 'Market task already exists. Select it in Work to continue.' : 'Market task added. Select it in Work to continue.')
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
        const form = button.closest<HTMLFormElement>('[data-agent-card-form]') || root.querySelector<HTMLFormElement>(`[data-agent-card-form="${role}"]`)
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
  const form = root.querySelector<HTMLFormElement>(`[data-agent-card-form="${role}"]`)
  if (!button || !form) return
  const hasUnsavedChanges = agentCardHasUnsavedChanges(role, form)
  button.classList.toggle('is-dirty', hasUnsavedChanges)
  button.classList.toggle('is-saved', !hasUnsavedChanges)
  button.title = hasUnsavedChanges ? '保存本地更改' : '当前内容已保存'
  button.setAttribute('aria-label', hasUnsavedChanges ? '保存本地更改' : '当前内容已保存')
  const iconSlot = button.querySelector<HTMLElement>('.card-action-icon')
  const textSlot = button.querySelector<HTMLElement>('.card-action-text')
  if (iconSlot) iconSlot.innerHTML = hasUnsavedChanges ? cardActionIcons.save : cardActionIcons.saved
  if (textSlot) textSlot.textContent = hasUnsavedChanges ? '保存本地' : '已保存'
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
    } else {
      pushMessage({ role: 'system', text: 'Local payment PIN was updated.', meta: 'Settings' })
      state.pinStep = undefined
      await refreshWorkspace({ quiet: true })
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
  return new Set([state.walletStatus?.address].map((item) => String(item || '').trim()).filter(Boolean))
}

function localProviderIds() {
  return new Set([
    state.sellerMarketStatus?.providerId,
    state.sellerSettings?.providerId,
    state.walletStatus?.address,
  ].map((item) => String(item || '').trim()).filter(Boolean))
}

function idMatches(id: string | undefined, ids: Set<string>) {
  const trimmed = String(id || '').trim()
  return Boolean(trimmed && ids.has(trimmed))
}

function orderSideForPlan(plan: OrderPlan): OrderSide {
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
  fields.orderRoleRow.classList.toggle('hidden', state.activeView === 'settings')
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
  const label = side === 'buyer' ? 'Buyer' : 'Seller'
  const next = side === 'buyer' ? 'Seller' : 'Buyer'
  fields.orderSideToggle.dataset.side = side
  fields.orderSideToggle.setAttribute('aria-pressed', String(side === 'seller'))
  fields.orderSideToggle.setAttribute('aria-label', `Order side: ${label}. Switch to ${next}`)
  fields.orderSideToggle.setAttribute('title', `Switch to ${next} orders`)
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
    showToast('Task is no longer available.')
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
    showToast('Task unpinned.')
  } else {
    state.workTaskState.pinnedIds.add(thread.id)
    showToast('Task pinned.')
  }
  saveWorkTaskState()
  renderLedger()
}

function toggleUnreadWorkThread(thread: WorkThread) {
  if (state.workTaskState.unreadIds.has(thread.id)) {
    state.workTaskState.unreadIds.delete(thread.id)
    showToast('Task marked as read.')
  } else {
    state.workTaskState.unreadIds.add(thread.id)
    showToast('Task marked as unread.')
  }
  saveWorkTaskState()
  renderLedger()
}

function renameWorkThread(thread: WorkThread) {
  const next = window.prompt('Rename task', thread.title)?.trim()
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
  showToast('Task renamed.')
}

function archiveWorkThread(thread: WorkThread) {
  if (workThreadIsArchived(thread.id)) {
    showToast('Task is already archived.')
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
  showToast('Task archived.')
}

async function copyWorkThreadID(thread: WorkThread) {
  await navigator.clipboard.writeText(workThreadSessionID(thread))
  showToast('Session ID copied.')
}

async function openProjectForWorkThread(thread: WorkThread) {
  const projectPath = thread.projectPath || defaultWorkProjectPath()
  setProjectFolderContext(projectPath)
  if (!window.exora?.invoke) {
    await navigator.clipboard.writeText(projectPath)
    showToast('Project path copied.')
    return
  }
  const folder = await invoke<ProjectFolder>('open_project_folder', { input: { path: projectPath } })
  setProjectFolders([folder, ...state.projectFolders], folder.path)
  renderProjectFolder()
  showToast(`Opened ${folder.name}.`)
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
    showToast('Original task data is not currently available.')
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
  showToast('Task restored.')
}

async function copyArchivedRecordID(recordID: string) {
  const record = state.workTaskState.archivedRecords.find((item) => item.id === recordID)
  if (!record) return
  await navigator.clipboard.writeText(record.chatSnapshot?.id || record.threadId)
  showToast('Archive ID copied.')
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
        showToast(`New MCP order added to ${projectFolderNameForPath(projectPathForPlan(plan))}.`)
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
        showToast(`New MCP approval added to ${projectFolderNameForPath(projectPathForApproval(approval))}.`)
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
  showToast(`Seller selection ready: ${plan.query || shortID(plan.planId)}`)
}

function renderAll() {
  renderProfileSummary()
  renderPermissionControl()
  renderBuyerAgentSettings()
  renderLedger()
  renderContextStrip()
  renderDecisionPanel()
  renderLocalAgentPromptControls()
  renderMarketProjectPicker()
}

function renderSeller(settings: SellerSettings) {
  renderLLMSettings(settings)
  setChecked('enabled', settings.enabled)
  setValue('providerId', settings.providerId)
  setValue('quotePrice', String(settings.quotePrice))
  setValue('currency', settings.currency)
  setValue('estimatedSeconds', String(settings.estimatedSeconds))
  setChecked('autoQuote', settings.autoQuote)
  setChecked('autoCompleteTextTasks', settings.autoCompleteTextTasks)
  setChecked('dockerEnabled', Boolean(settings.dockerEnabled))
  setValue('dockerDefaultImage', settings.dockerDefaultImage || '')
  setValue('dockerAllowedImages', listInput(settings.dockerAllowedImages))
  setValue('dockerNetworkMode', settings.dockerNetworkMode || 'none')
  setValue('dockerAllowedNetworkModes', listInput(settings.dockerAllowedNetworkModes || ['none']))
  setValue('dockerMaxCpus', String(settings.dockerMaxCpus || 0))
  setValue('dockerMaxMemoryMb', String(settings.dockerMaxMemoryMb || 0))
  setChecked('dockerAllowGpu', Boolean(settings.dockerAllowGpu))
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
  setBuyerAgentChecked('negotiationFirst', settings.negotiationFirst)
  setBuyerAgentValue('maxResults', String(settings.maxResults))
  setBuyerAgentValue('maxCandidates', String(settings.maxCandidates))
  setBuyerAgentValue('maxOptions', String(settings.maxOptions))
  setBuyerAgentValue('permissionMode', state.permissionMode)
  fields.buyerAgentChip.textContent = settings.enabled ? (settings.negotiationFirst ? 'negotiation-first' : 'search-first') : 'disabled'
  fields.buyerAgentChip.dataset.state = settings.enabled ? 'ok' : 'warn'
}

function buyerAgentPayload(): BuyerAgentSettings {
  return normalizeBuyerAgentSettings({
    enabled: buyerAgentChecked('enabled'),
    agentId: buyerAgentValue('agentId'),
    negotiationFirst: buyerAgentChecked('negotiationFirst'),
    maxResults: buyerAgentValue('maxResults'),
    maxCandidates: buyerAgentValue('maxCandidates'),
    maxOptions: buyerAgentValue('maxOptions'),
  })
}

function saveBuyerAgentSettings() {
  state.buyerAgentSettings = buyerAgentPayload()
  const permissionMode = buyerAgentValue('permissionMode')
  if (isPermissionMode(permissionMode)) state.permissionMode = permissionMode
  if (!hasDesktopBridge()) localStorage.setItem('exora.permissionMode', state.permissionMode)
  scheduleSaveAppSettings()
  renderBuyerAgentSettings()
  renderPermissionControl()
  showToast('Buyer agent saved.')
}

function buyerAgentSearchInput(query: string, extra: Record<string, unknown> = {}) {
  const settings = state.buyerAgentSettings
  return {
    ...extra,
    query,
    agentId: settings.agentId,
    negotiationFirst: settings.negotiationFirst,
    maxResults: settings.maxResults,
    maxCandidates: settings.maxCandidates,
    maxOptions: settings.maxOptions,
  }
}

function currentLLMProfile(settings?: SellerSettings): LLMProfile {
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
  const preset = presetById(profile.providerPreset)
  setLLMValue('profileName', profile.name)
  setLLMValue('providerPreset', profile.providerPreset || preset.id)
  setLLMValue('llmBaseUrl', profile.llmBaseUrl || preset.baseUrl)
  setLLMValue('apiKey', '')
  setLLMChecked('clearApiKey', false)
  setLLMValue('wireApi', profile.wireApi || preset.wireApi)
  setLLMValue('researchModel', profile.researchModel || preset.model)
  setLLMValue('researchReasoningEffort', profile.researchReasoningEffort || 'high')
  setLLMValue('utilityModel', profile.utilityModel || profile.researchModel || preset.model)
  setLLMValue('utilityReasoningEffort', profile.utilityReasoningEffort || 'low')
  setLLMChecked('disableResponseStorage', profile.disableResponseStorage ?? true)
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

function renderLLMProfileList() {
  fields.llmProfileList.innerHTML = state.llmProfiles.map((profile) => {
    const active = profile.id === state.activeLLMProfileId
    const editing = profile.id === state.editingLLMProfileId
    return `
      <button class="api-profile-option ${editing ? 'active' : ''}" type="button" data-llm-profile-id="${escapeAttr(profile.id)}" title="${escapeAttr(profile.llmBaseUrl)}">
        <strong>${escapeHTML(compactText(profile.name, 28))}</strong>
        <span>${escapeHTML(presetById(profile.providerPreset).label)} / ${escapeHTML(compactText(profile.researchModel || 'model', 26))}</span>
        ${active ? '<em>Active</em>' : ''}
      </button>
    `
  }).join('') || '<p class="muted api-profile-empty">No profiles yet.</p>'
}

function renderLLMProfileMeta(profile: LLMProfile) {
  const active = profile.id === state.activeLLMProfileId
  fields.llmProfileHeading.textContent = profile.name || 'API Profile'
  fields.llmProfileSubtitle.textContent = `${presetById(profile.providerPreset).label} / ${profile.researchModel || 'model'}`
  fields.llmActiveChip.textContent = active ? 'active' : 'inactive'
  fields.llmActiveChip.dataset.state = active ? 'ok' : 'idle'
  const keyText = profile.hasApiKey
    ? profile.keyFormat === 'not_required'
      ? 'API key not required.'
      : `Saved key: ${profile.keyFormat || 'stored'}.`
    : state.llmKeyStorageAvailable
      ? 'No key saved for this profile.'
      : 'Secure key storage unavailable.'
  fields.keyState.textContent = keyText
  fields.llmProfileStatus.textContent = `${keyText} ${state.llmKeyStorageAvailable ? 'safeStorage available.' : 'Profile keys cannot be saved securely here.'}`
  const apiKeyInput = llmInput('apiKey') as HTMLInputElement
  const clearInput = llmInput('clearApiKey') as HTMLInputElement
  apiKeyInput.disabled = !state.llmKeyStorageAvailable
  clearInput.disabled = !state.llmKeyStorageAvailable
  apiKeyInput.placeholder = state.llmKeyStorageAvailable ? 'Leave blank to keep saved key' : 'Secure key storage unavailable'
}

function renderLLMTestNote() {
  fields.llmTestNote.textContent = state.llmTestMessage || ''
  fields.llmTestNote.classList.toggle('hidden', !state.llmTestMessage)
}

function renderSellerMarketStatus(status: SellerMarketStatus) {
  fields.sellerMarketChip.textContent = status.discoverable ? 'market searchable' : 'not discoverable'
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

async function copyFrom(command: string, success: string) {
  const value = await invoke<string>(command)
  await navigator.clipboard.writeText(value)
  showToast(success)
}

function renderLocalAgentPromptControls() {
  const ready = Boolean(state.appStatus?.mcpCommand && state.appStatus.discoveryPath)
  fields.localAgentCopyButton.disabled = state.busy || !ready
  fields.localAgentCopyButton.setAttribute('title', ready ? 'Copy local agent MCP prompt' : 'Refresh runtime before copying')
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
    showToast('Refresh runtime before copying the MCP prompt.')
    return
  }
  const work = await createWorkMCPContext(task)
  const prompt = composeLocalAgentPrompt(task, work)
  await navigator.clipboard.writeText(prompt)
  setProjectFolders([{ name: work.projectName || projectFolderNameForPath(work.projectPath), path: work.projectPath }, ...state.projectFolders], work.projectPath)
  showToast(`Local agent MCP prompt copied with Work UID ${shortID(work.workUid)}.`)
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
  const settings = state.sellerSettings
  const preset = presetById(settings?.providerPreset)
  return {
    enabled: checked('enabled'),
    autoQuote: checked('autoQuote'),
    autoCompleteTextTasks: checked('autoCompleteTextTasks'),
    llmBaseUrl: settings?.llmBaseUrl || preset.baseUrl,
    apiKey: '',
    clearApiKey: false,
    providerPreset: settings?.providerPreset || preset.id,
    wireApi: settings?.wireApi || preset.wireApi,
    capabilities: settings?.capabilities || preset.capabilities,
    researchModel: settings?.researchModel || preset.model,
    researchReasoningEffort: settings?.researchReasoningEffort || 'high',
    utilityModel: settings?.utilityModel || settings?.researchModel || preset.model,
    utilityReasoningEffort: settings?.utilityReasoningEffort || 'low',
    disableResponseStorage: settings?.disableResponseStorage ?? true,
    providerId: value('providerId'),
    quotePrice: Number(value('quotePrice') || '0'),
    currency: value('currency') || 'USD',
    estimatedSeconds: Number(value('estimatedSeconds') || '60'),
    dockerEnabled: checked('dockerEnabled'),
    dockerDefaultImage: value('dockerDefaultImage'),
    dockerAllowedImages: value('dockerAllowedImages'),
    dockerNetworkMode: value('dockerNetworkMode') || 'none',
    dockerAllowedNetworkModes: value('dockerAllowedNetworkModes') || 'none',
    dockerAllowGpu: checked('dockerAllowGpu'),
    dockerMaxCpus: Number(value('dockerMaxCpus') || '0'),
    dockerMaxMemoryMb: Number(value('dockerMaxMemoryMb') || '0'),
  }
}

function apiSettingsPayload(form: HTMLFormElement) {
  const settings = state.sellerSettings
  const apiValue = (name: string) => form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-chat-api-field="${name}"]`)?.value.trim() || ''
  const apiChecked = (name: string) => form.querySelector<HTMLInputElement>(`[data-chat-api-field="${name}"]`)?.checked === true
  const preset = presetById(apiValue('providerPreset') || settings?.providerPreset)
  const model = apiValue('researchModel') || settings?.researchModel || preset.model
  return {
    profileId: state.editingLLMProfileId,
    enabled: settings?.enabled ?? false,
    autoQuote: settings?.autoQuote ?? false,
    autoCompleteTextTasks: settings?.autoCompleteTextTasks ?? false,
    llmBaseUrl: apiValue('llmBaseUrl') || settings?.llmBaseUrl || preset.baseUrl,
    apiKey: apiValue('apiKey'),
    clearApiKey: apiChecked('clearApiKey'),
    providerPreset: preset.id,
    wireApi: apiValue('wireApi') || settings?.wireApi || preset.wireApi,
    capabilities: preset.capabilities,
    researchModel: model,
    researchReasoningEffort: apiValue('researchReasoningEffort') || settings?.researchReasoningEffort || 'high',
    utilityModel: apiValue('utilityModel') || settings?.utilityModel || model,
    utilityReasoningEffort: apiValue('utilityReasoningEffort') || settings?.utilityReasoningEffort || 'low',
    disableResponseStorage: apiChecked('disableResponseStorage'),
    providerId: settings?.providerId || '',
    quotePrice: settings?.quotePrice ?? 0,
    currency: settings?.currency || 'USD',
    estimatedSeconds: settings?.estimatedSeconds ?? 60,
  }
}

function llmProfilePayload(form: HTMLFormElement, options: { id?: string; duplicate?: boolean } = {}) {
  const apiValue = (name: string) => form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-chat-api-field="${name}"]`)?.value.trim() || ''
  const apiChecked = (name: string) => form.querySelector<HTMLInputElement>(`[data-chat-api-field="${name}"]`)?.checked === true
  const preset = presetById(apiValue('providerPreset'))
  const model = apiValue('researchModel') || preset.model
  const source = currentLLMProfile(state.sellerSettings)
  return {
    id: options.duplicate ? undefined : options.id || state.editingLLMProfileId || source.id,
    cloneKeyFromId: options.duplicate ? source.id : undefined,
    name: apiValue('profileName') || source.name || preset.label,
    providerPreset: preset.id,
    llmBaseUrl: apiValue('llmBaseUrl') || preset.baseUrl,
    apiKey: apiValue('apiKey'),
    clearApiKey: apiChecked('clearApiKey'),
    wireApi: apiValue('wireApi') || preset.wireApi,
    capabilities: preset.capabilities,
    researchModel: model,
    researchReasoningEffort: apiValue('researchReasoningEffort') || 'high',
    utilityModel: apiValue('utilityModel') || model,
    utilityReasoningEffort: apiValue('utilityReasoningEffort') || 'low',
    disableResponseStorage: apiChecked('disableResponseStorage'),
  }
}

async function syncLLMProfilesFromStatus(status: LLMProfileStatus, preferredId?: string) {
  state.llmProfiles = status.profiles || []
  state.activeLLMProfileId = status.activeProfileId
  state.llmKeyStorageAvailable = Boolean(status.keyStorageAvailable)
  state.editingLLMProfileId = preferredId && state.llmProfiles.some((profile) => profile.id === preferredId)
    ? preferredId
    : state.editingLLMProfileId && state.llmProfiles.some((profile) => profile.id === state.editingLLMProfileId)
      ? state.editingLLMProfileId
      : state.activeLLMProfileId || state.llmProfiles[0]?.id
  renderLLMSettings(state.sellerSettings)
}

async function saveLLMProfile(options: { apply?: boolean; duplicate?: boolean } = {}) {
  const payload = llmProfilePayload(llmSettingsForm, { duplicate: options.duplicate })
  if (options.duplicate) payload.name = `${payload.name} Copy`
  const status = await invoke<LLMProfileStatus>('save_llm_profile', { input: payload })
  const saved = options.duplicate
    ? status.profiles.find((profile) => profile.name === payload.name)
    : status.profiles.find((profile) => profile.id === payload.id)
  await syncLLMProfilesFromStatus(status, saved?.id)
  if (options.apply && saved?.id) {
    const applied = await invoke<LLMProfileStatus>('apply_llm_profile', { input: { id: saved.id } })
    await syncLLMProfilesFromStatus(applied, saved.id)
    await refreshSeller({ market: true })
    showToast('API profile saved and applied.')
  } else {
    showToast(options.duplicate ? 'API profile duplicated.' : 'API profile saved.')
  }
}

async function deleteLLMProfile() {
  const profile = currentLLMProfile(state.sellerSettings)
  if (!profile.id || !window.confirm(`Delete API profile "${profile.name}"?`)) return
  const status = await invoke<LLMProfileStatus>('delete_llm_profile', { input: { id: profile.id } })
  await syncLLMProfilesFromStatus(status)
  showToast('API profile deleted.')
}

async function newLLMProfile() {
  const preset = llmPresets[0]
  const status = await invoke<LLMProfileStatus>('save_llm_profile', {
    input: {
      name: 'New API Profile',
      providerPreset: preset.id,
      llmBaseUrl: preset.baseUrl,
      wireApi: preset.wireApi,
      capabilities: preset.capabilities,
      researchModel: preset.model,
      researchReasoningEffort: 'high',
      utilityModel: preset.model,
      utilityReasoningEffort: 'low',
      disableResponseStorage: true,
    },
  })
  const newest = status.profiles[0]
  await syncLLMProfilesFromStatus(status, newest?.id)
  showToast('New API profile created.')
}

function presetById(id?: string) {
  return llmPresets.find((preset) => preset.id === id) || llmPresets[0]
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
  agentQuery.disabled = next
  fields.localAgentTask.disabled = next
  renderLocalAgentPromptControls()
  renderChromeControls()
}

function showToast(message: string) {
  fields.message.textContent = message
}

const settingsTitles: Record<SettingsView, { kicker: string; title: string }> = {
  api: { kicker: 'AI & Models', title: 'Provider API' },
  'buyer-agent': { kicker: 'Agents', title: 'Buyer Agent' },
  'buyer-card': { kicker: 'Agents', title: 'Buyer Card' },
  'seller-card': { kicker: 'Agents', title: 'Seller Card' },
  seller: { kicker: 'Agents', title: 'Seller Agent' },
  agents: { kicker: 'Agents', title: 'External MCP' },
  pwa: { kicker: 'Mobile', title: 'PWA Link' },
  wallet: { kicker: 'Account', title: 'Wallet' },
  security: { kicker: 'Account', title: 'Security' },
  archives: { kicker: 'Account', title: 'Archive Records' },
  runtime: { kicker: 'System', title: 'Runtime' },
  diagnostics: { kicker: 'System', title: 'Diagnostics' },
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
  const meta = settingsTitles[state.activeSettingsView]
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
  renderSettingsAgentCardPages()
  renderLLMTestNote()
  renderPwaLinkStatus()
  renderWalletStatus()
  renderSecurityStatus()
  renderArchiveRecords()
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
  fields.pwaLinkState.textContent = link?.linked ? 'linked' : link?.status || 'not started'
  fields.pwaUserCode.textContent = link?.userCode || 'not generated'
  fields.pwaCloudURL.textContent = link?.cloudUrl || 'not configured'
  fields.pwaExpires.textContent = link?.expiresAt ? compactTimestamp(link.expiresAt) : 'not started'
  fields.pwaTokenPath.textContent = link?.tokenPath || 'local after scan'
  fields.pwaLinkNote.textContent = state.pwaLinkMessage || link?.message || 'Start a QR session, then scan it from the Exora PWA Remote Console.'
  if (link?.qrSvg) {
    fields.pwaQR.innerHTML = link.qrSvg
  } else {
    fields.pwaQR.innerHTML = '<span>QR</span>'
  }
}

function renderWalletStatus() {
  const wallet = state.walletStatus
  if (!wallet) {
    fields.walletState.textContent = 'checking'
    return
  }
  fields.walletState.textContent = wallet.configured ? 'configured' : 'missing'
  fields.walletAddress.textContent = wallet.address || 'not configured'
  fields.walletMode.textContent = wallet.localKeypair
    ? 'local keypair'
    : wallet.boundOnly
      ? 'bound address only'
      : 'not configured'
  fields.walletKeypair.textContent = wallet.localKeypair && wallet.keypairPath ? wallet.keypairPath : 'not stored or not exposed'
}

function renderSecurityStatus() {
  const security = state.securityStatus
  if (!security) {
    fields.securityState.textContent = 'checking'
    return
  }
  fields.securityState.textContent = 'local'
  fields.securityPin.textContent = security.paymentPinConfigured ? 'configured' : 'not configured'
  fields.securityOwnerToken.textContent = security.ownerTokenPresent ? 'present, hidden' : 'missing'
  fields.securityAgentToken.textContent = security.agentTokenPresent ? 'present, hidden' : 'missing'
  fields.securityAuthPath.textContent = security.authPath || 'hidden'
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
  let walletError = ''
  let securityError = ''
  const [wallet, security] = await Promise.all([
    invoke<{ wallet?: WalletStatus }>('wallet_status').catch((error) => ({ error: humanizeError(error) })),
    invoke<SecurityStatus>('security_status').catch((error) => ({ error: humanizeError(error) })),
  ])
  if ('wallet' in wallet) {
    state.walletStatus = wallet.wallet || {}
  } else if ('error' in wallet) {
    walletError = wallet.error
  }
  if ('error' in security) {
    securityError = security.error
  } else {
    state.securityStatus = security
  }
  renderSettingsPanel()
  if (walletError) {
    fields.walletState.textContent = 'offline'
    fields.walletAddress.textContent = walletError
  }
  if (securityError) {
    fields.securityState.textContent = 'offline'
    fields.securityPin.textContent = securityError
  }
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
  return llmSettingsForm.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-chat-api-field="${name}"]`)!
}

function setLLMValue(name: string, next: string) {
  llmInput(name).value = next
}

function setLLMChecked(name: string, next: boolean) {
  ;(llmInput(name) as HTMLInputElement).checked = next
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
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeProfileMenu()
    closeProjectFolderMenu()
    closeTaskContextMenu()
    closePermissionMenu()
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

app.querySelector<HTMLButtonElement>('[data-action="settings-pin"]')!.addEventListener('click', () => {
  setActiveView('work')
  state.pinStep = { action: { kind: 'settings_pin' }, setup: true, pin: '', confirm: '' }
  renderAll()
})

app.querySelector<HTMLButtonElement>('[data-action="start"]')!.addEventListener('click', () => {
  run(() => invoke('start_dock'))
})

app.querySelector<HTMLButtonElement>('[data-action="stop"]')!.addEventListener('click', () => {
  run(() => invoke('stop_dock'))
})

app.querySelector<HTMLButtonElement>('[data-action="restart"]')!.addEventListener('click', () => {
  run(() => invoke('restart_dock'))
})

app.querySelector<HTMLButtonElement>('[data-action="copy-prompt"]')!.addEventListener('click', () => {
  run(() => copyFrom('copy_agent_prompt', 'Agent prompt copied.'))
})

app.querySelector<HTMLButtonElement>('[data-action="copy-opencode"]')!.addEventListener('click', () => {
  run(() => copyFrom('copy_opencode_config', 'OpenCode MCP config copied.'))
})

app.querySelector<HTMLButtonElement>('[data-action="copy-mcp"]')!.addEventListener('click', () => {
  run(() => copyFrom('copy_mcp_command', 'MCP command copied.'))
})

fields.localAgentCopyButton.addEventListener('click', () => {
  copyLocalAgentPrompt().catch((error) => showToast(humanizeError(error)))
})

app.querySelectorAll<HTMLButtonElement>('[data-action="copy-rest"]').forEach((button) => {
  button.addEventListener('click', () => {
    run(() => copyFrom('copy_rest_base_url', 'REST base URL copied.'))
  })
})

app.querySelector<HTMLButtonElement>('[data-action="health"]')!.addEventListener('click', () => {
  run(() => invoke('open_health'))
})

app.querySelector<HTMLButtonElement>('[data-action="manifest"]')!.addEventListener('click', () => {
  run(() => invoke('open_manifest'))
})

app.querySelector<HTMLButtonElement>('[data-action="logs"]')!.addEventListener('click', () => {
  run(() => invoke('open_logs'))
})

llmSettingsForm.querySelector<HTMLSelectElement>('[data-chat-api-field="providerPreset"]')!.addEventListener('change', (event) => {
  applyPresetToForm(llmSettingsForm, presetById((event.currentTarget as HTMLSelectElement).value))
})

fields.llmProfileList.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLButtonElement>('[data-llm-profile-id]')
  if (!button) return
  const profileId = button.dataset.llmProfileId
  state.editingLLMProfileId = profileId
  state.llmTestMessage = undefined
  renderLLMSettings(state.sellerSettings)
  if (profileId && profileId !== state.activeLLMProfileId) {
    run(async () => {
      const applied = await invoke<LLMProfileStatus>('apply_llm_profile', { input: { id: profileId } })
      await syncLLMProfilesFromStatus(applied, profileId)
      showToast('API profile applied.')
    })
  }
})

app.querySelector<HTMLButtonElement>('[data-action="new-llm-profile"]')!.addEventListener('click', () => {
  run(() => newLLMProfile())
})

llmSettingsForm.querySelector<HTMLButtonElement>('[data-action="duplicate-llm-profile"]')!.addEventListener('click', () => {
  run(() => saveLLMProfile({ duplicate: true }))
})

llmSettingsForm.querySelector<HTMLButtonElement>('[data-action="delete-llm-profile"]')!.addEventListener('click', () => {
  run(() => deleteLLMProfile())
})

llmSettingsForm.querySelector<HTMLButtonElement>('[data-action="save-llm-profile"]')!.addEventListener('click', () => {
  run(() => saveLLMProfile())
})

llmSettingsForm.querySelector<HTMLButtonElement>('[data-action="test-llm"]')!.addEventListener('click', () => {
  run(async () => {
    const result = await invoke<{ ok: boolean; status: string; message: string; route: string }>('test_llm_connection', {
      input: apiSettingsPayload(llmSettingsForm),
    })
    state.llmTestMessage = `${result.ok ? 'Ready' : result.status}: ${result.message}`
    renderLLMTestNote()
  })
})

llmSettingsForm.querySelector<HTMLButtonElement>('[data-action="load-models"]')!.addEventListener('click', () => {
  run(async () => {
    const result = await invoke<{ ok: boolean; models: string[]; message: string }>('list_llm_models', {
      input: apiSettingsPayload(llmSettingsForm),
    })
    state.llmModels = result.models || []
    state.llmTestMessage = result.ok ? `Loaded ${state.llmModels.length} model(s).` : result.message
    renderLLMSettings(state.sellerSettings)
  })
})

llmSettingsForm.addEventListener('submit', (event) => {
  event.preventDefault()
  run(async () => {
    await saveLLMProfile({ apply: true })
    state.chatMode = 'expanded'
    state.llmTestMessage = 'API profile applied.'
    renderAll()
  })
})

app.querySelector<HTMLButtonElement>('[data-action="wallet-refresh"]')!.addEventListener('click', () => {
  run(() => refreshSettingsStatus())
})

app.querySelector<HTMLButtonElement>('[data-action="pwa-link-start"]')!.addEventListener('click', () => {
  run(() => startPwaLink()).catch(() => undefined)
})

app.querySelector<HTMLButtonElement>('[data-action="pwa-link-check"]')!.addEventListener('click', () => {
  run(() => checkPwaLink()).catch(() => undefined)
})

app.querySelector<HTMLButtonElement>('[data-action="wallet-create"]')!.addEventListener('click', () => {
  run(async () => {
    const response = await invoke<{ wallet?: WalletStatus }>('wallet_create')
    state.walletStatus = response.wallet || {}
    renderWalletStatus()
  }, 'Local wallet created.')
})

walletBindForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const address = walletBindForm.querySelector<HTMLInputElement>('[data-wallet-address-input]')?.value.trim() || ''
  run(async () => {
    const response = await invoke<{ wallet?: WalletStatus }>('wallet_bind', { input: { address } })
    state.walletStatus = response.wallet || {}
    renderWalletStatus()
  }, 'Wallet address bound.')
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
  refreshStatus()
  refreshSeller({ market: true })
  refreshAgentCards()
  window.setTimeout(() => refreshWorkspace({ quiet: true }), 250)
  setInterval(refreshStatus, 5000)
  setInterval(() => refreshWorkspace({ quiet: true }), 12000)
}

void bootstrap()
