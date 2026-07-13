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
  KeyRound,
  Languages,
  ListFilter,
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
  PencilLine,
  Plus,
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
  type MarketRailCard,
  type MarketRailResponse,
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
  stageId?: string
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
  side?: OrderSide
  workThreadId?: string
  orderId?: string
  taskIds?: string[]
  status?: string
  participants?: Array<'buyer_agent' | 'seller_agent' | 'buyer_human' | 'seller_human'>
  providerPubkey?: string
  agentSessionId?: string
  agentDriverId?: string
  agentEventCursor?: number
}

type LocalAgentSessionStatus = 'starting' | 'ready' | 'busy' | 'waiting_user' | 'failed' | 'stopped'

type InteractiveAgentSession = {
  id: string
  conversationId: string
  role: OrderSide
  purpose?: 'seller_card'
  driver: string
  status: LocalAgentSessionStatus
  vendorSessionId?: string
  vendorTurnId?: string
  workspace?: string
  permissionMode: PermissionMode
  workUid?: string
  transactionId?: string
  eventCursor: number
  lastError?: string
  binding?: { bindingId?: string; driver?: string; version?: string }
}

type AgentSessionEvent = {
  seq: number
  kind: string
  messageId?: string
  turnId?: string
  text?: string
  payload?: Record<string, unknown>
  createdAt?: string
}

type SelectedKind = 'plan' | 'approval' | 'task' | 'payment'
type ActiveView = 'work' | 'market' | 'chat' | 'settings'
type ChatMode = 'expanded' | 'compact'
type OrderSide = 'buyer' | 'seller'
type SellerWorkspaceMode = 'transactions' | 'monitor'
type V3SellerTab = 'vm' | 'resources' | 'endpoint' | 'api_bridge' | 'openapi' | 'listings'
type V3WizardStepState = 'locked' | 'available' | 'busy' | 'complete' | 'error'

type V3Product = {
  productId: string
  productKind: 'compute' | 'download' | 'api_operation' | string
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
  availability?: Record<string, unknown>
  validation?: Record<string, unknown>
  version?: number
  updatedAt?: string
  applicationSource?: 'vm' | 'resources' | 'endpoint' | 'api_bridge' | string
}

type V3ReadinessCheck = { id: string; label: string; ready: boolean; detail?: string }
type V3ListingApplication = {
  listing: V3Listing
  product: V3Product
  source: 'vm' | 'resources' | 'endpoint' | 'api_bridge' | string
  readiness: { ready: boolean; checks: V3ReadinessCheck[] }
  runtime?: { tunnelOnline: boolean; endpointHealthy: boolean; lastSeenAt?: string; routeFingerprint?: string; error?: string }
}
type V3LocalEndpoint = { endpointId: string; localBaseUrl: string; healthPath: string; routeFingerprint: string; lastProbeHealthy: boolean; lastProbeAt?: string; timeoutSeconds: number; concurrency: number }

type V3ActivitySession = {
  sessionId: string
  activitySessionId?: string
  role: OrderSide
  productKind: 'compute' | 'download' | 'api_operation' | string
  productId: string
  listingId: string
  productTitle: string
  counterpartyLabel: string
  status: string
  outcome: string
  attentionRequired: boolean
  itemCount: number
  amountAtomic: number
  grossAmountAtomic: number
  platformFeeAtomic: number
  asset: string
  startedAt: string
  updatedAt: string
  endedAt?: string
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
  events?: Array<{ eventId: string; type: string; status: string; title: string; detail: string; occurredAt: string }>
  identifiers?: Record<string, string>
  delivery?: Record<string, any>
  purchases?: Array<Record<string, any>>
  transfers?: Array<Record<string, any>>
}

type V3ResourceSource = { name: string; sizeBytes: number }
type V3ResourceArchive = { token: string; name: string; sizeBytes: number; sourceBytes: number; sourceCount: number; format: 'zip'; status?: 'ready' | 'uploading' | 'verified' | 'failed' }
type V3AssetProgress = { phase: 'selecting' | 'packaging' | 'complete' | 'uploading'; percent: number; completedFiles?: number; totalFiles?: number; inputBytes?: number; sourceBytes?: number; outputBytes?: number; completed?: number; total?: number }
type V3ResourceSelectName = 'license' | 'delivery'
type V3EnvironmentImage = { imageId: string; version: string; status: string; signature?: string; cloudAvailable?: boolean; manifest: Record<string, any> }
type V3ImageProgress = { imageId: string; phase: string; bytesDownloaded?: number; sizeBytes?: number }
type V3HostScanProgress = { phase: string; percent: number; bytes?: number; samples?: number }
type V3APIBridgeProtocol = 'openapi' | 'openai' | 'generic_http' | 'sse'
type V3APIPricingComponent = { dimension: 'request' | 'successful_request' | 'input_tokens' | 'output_tokens' | 'input_bytes' | 'output_bytes' | 'execution_second' | 'image' | 'provider_reported'; rateAtomic: number; per: number; meterSource: string; selector?: string; chargeOn: string }
type V3APIRoute = { id: string; routeId: string; operationId: string; method: string; path: string; title: string; selected: boolean; price: number; pricing?: V3APIPricingComponent[]; maxChargePerInvocationAtomic?: number }
type V3APIMaterial = { id: string; name: string; extension: string; sizeBytes: number; localPath: string; sha256?: string }
type V3APIBridgeDraft = { draftId: string; version: number; status: string; bridgeMode?: 'transparent' | 'dock_tunnel'; title: string; description: string; protocol: V3APIBridgeProtocol; baseUrl: string; healthPath: string; routes: Array<{ routeId: string; operationId: string; method: string; path: string; displayName: string; pricing: V3APIPricingComponent[]; maxChargePerInvocationAtomic: number }>; agentNotes?: string; unresolvedFields?: string[] }
type V3APIProbe = { ok: boolean; status?: number; latencyMs?: number; contentType?: string; checkedURL?: string; checkedAt?: string; error?: string }
type SettingsView = 'wallet' | 'archives'
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

type LocalAgentAuthState = 'authenticated' | 'not_authenticated' | 'configured' | 'unknown'
type LocalAgentProtocolState = 'supported' | 'preview' | 'limited' | 'unsupported'
type LocalAgentStatus = 'ready' | 'available' | 'login_required' | 'not_installed' | 'probe_failed' | 'detected_only'

type LocalAgentInstallation = {
  driverId: string
  name: string
  vendor: string
  installed: boolean
  bindable: boolean
  bound: boolean
  status: LocalAgentStatus
  authState: LocalAgentAuthState
  executablePath?: string
  version?: string
  detail?: string
  protocol: string
  protocolState: LocalAgentProtocolState
  protocolLabel: string
  capabilities: string[]
  note?: string
}

type LocalAgentBinding = {
  bindingId: string
  driverId: string
  name: string
  vendor: string
  executablePath: string
  version?: string
  protocol: string
  protocolState: LocalAgentProtocolState
  protocolLabel: string
  capabilities: string[]
  boundAt: string
  lastVerifiedAt: string
  status: LocalAgentStatus
  authState: LocalAgentAuthState
  valid: boolean
}

type LocalAgentScanResult = {
  agents: LocalAgentInstallation[]
  binding?: LocalAgentBinding | null
  scannedAt?: string | null
  hasSnapshot: boolean
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

type AgentCardSearchResponse = {
  cards?: AgentCard[]
  source?: string
}

type SampleTransactionStageStatus = 'complete' | 'active' | 'waiting' | 'blocked' | 'failed' | 'pending'

type SampleMarketTransaction = {
  id: string
  side: OrderSide
  tone: string
  title: string
  status: string
  subtitle: string
  summary: string
  state: string
  currentStageId: string
  currentStageStatus: Exclude<SampleTransactionStageStatus, 'complete' | 'pending'>
  owner: string
  waitingFor: string
  nextAction: string
  terminalReason?: string
  provider: string
  amount: string
  updatedAt: string
  metrics: Array<{ label: string; value: string; hint?: string }>
  chips: string[]
  facts: Array<{ label: string; value: string }>
  events: Array<{ label: string; detail: string; timestamp: string; tone: 'good' | 'warn' | 'bad' | 'normal' }>
}

type OrderActivityRecord = {
  id: string
  threadId: string
  title: string
  subtitle: string
  timestamp: string
  projectPath: string
  side: OrderSide
  stageLabel: string
  stageStatus: TransactionProgressStage['status']
  statusLabel: string
  amountLabel: string
  providerLabel: string
  timestampLabel: string
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
  transactionDetailWidth?: number
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

type DemoTransactionBundle = {
  conversations?: DesktopConversationRecord[]
  orderPlans?: OrderPlan[]
  approvals?: Approval[]
  tasks?: Task[]
  payments?: PaymentRecord[]
  workRuns?: WorkRun[]
  workRunEvents?: Record<string, WorkRunEvent[]>
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
  | { kind: 'gpu_demo_payment' }

type PinStep = {
  action: PinAction
  setup: boolean
  pin: string
  confirm: string
  error?: string
}

type GpuDemoStage =
  | 'idle'
  | 'ready'
  | 'thinking'
  | 'questions'
  | 'manifest_review'
  | 'matching'
  | 'seller_options'
  | 'seller_confirming'
  | 'seller_accepted'
  | 'pin'
  | 'paid'
  | 'queued'
  | 'pulling_image'
  | 'running'
  | 'uploading_artifacts'
  | 'completed'

type GpuDemoSeller = {
  id: string
  name: string
  providerPubkey: string
  resourceId: string
  gpu: string
  vramGb: number
  region: string
  price: number
  eta: string
  score: number
  success: string
  reason: string
  risk: string
}

type GpuDemoAnswers = {
  gpuProfile: string
  budget: string
  dataset: string
  outputs: string
}

type GpuDemoIds = {
  base: string
  workUid: string
  planId: string
  orderId: string
  taskId: string
  approvalId: string
  paymentId: string
  runId: string
}

type GpuDemoState = {
  active: boolean
  stage: GpuDemoStage
  ids: GpuDemoIds
  taskText: string
  projectPath: string
  projectName: string
  chatId?: string
  selectedSellerId?: string
  answers: GpuDemoAnswers
  startedAt: string
  updatedAt: string
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

type SellerCardGeneration = {
  sessionId?: string
  eventCursor: number
  responseText: string
  status: 'collecting' | 'starting_agent' | 'analyzing' | 'waiting_user' | 'completed' | 'failed'
  questions?: SellerCardSetupQuestion[]
  round: number
  error?: string
}

type SellerCardSetupQuestion = {
  id: string
  question: string
  why?: string
  placeholder?: string
  required: boolean
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

type CloudTransactionProjection = {
  transactionId: string
  version: number
  phase: string
  condition: string
  supervision?: {
    status?: 'driving' | 'waiting_user' | 'waiting_counterparty' | 'retry_scheduled' | 'blocked' | 'completed'
    responsibleRole?: 'buyer' | 'seller'
    activeRunId?: string
    nextWakeAt?: string
    consecutiveNoProgress?: number
    reason?: string
    updatedAt?: string
  }
}

type TransactionProgressStage = {
  id: string
  title: string
  detail: string
  status: 'complete' | 'active' | 'waiting' | 'blocked' | 'failed' | 'pending'
}

type BuyerTransactionStageId =
  | 'intent'
  | 'plan'
  | 'offer'
  | 'authorize'
  | 'execute'
  | 'verify'

type SellerTransactionStageId =
  | 'task_valuation'
  | 'quote_response'
  | 'wait_buyer'
  | 'execution_plan'
  | 'provider_execution'
  | 'local_supervisor'
  | 'terminal_report'
  | 'settlement'

type TransactionStageId = BuyerTransactionStageId | SellerTransactionStageId

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
const DEFAULT_TRANSACTION_DETAIL_WIDTH = DEFAULT_SIDEBAR_WIDTH
const TRANSACTION_DETAIL_MIN_WIDTH = SIDEBAR_MIN_WIDTH
const TRANSACTION_DETAIL_MAX_WIDTH = SIDEBAR_MAX_WIDTH
const CHAT_SAVE_DELAY = 500
const TOAST_DURATION_MS = 3200
const MASKED_API_KEY_VALUE = '************'
const DRAFT_LLM_PROFILE_ID = '__draft_llm_profile__'
const SETTINGS_QR_WIDTH = 236
const SETTINGS_QR_MARGIN = 1
const SETTINGS_QR_COLOR = { dark: '#17182b', light: '#ffffff' } as const
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
  filter: icon(ListFilter),
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
  emptyContent: icon(Inbox),
}

const roleTabIcons: Record<OrderSide, string> = {
  buyer: icon(ShoppingCart),
  seller: icon(ShoppingBag),
}

const profileIcons = {
  settings: icon(Settings2),
}

const settingsNavIcons: Record<SettingsView, string> = {
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

const DEFAULT_WORK_FOLDER_NAME = 'AgenStaff'
const GPU_DEMO_PREFIX = 'gpu-job-demo'
const GPU_DEMO_TASK = 'Run a GPU inference job for a small evaluation batch. Use one high-memory GPU, keep the budget under 15 USDC, and return results.jsonl, metrics.json, logs.txt, and receipt.json.'
const GPU_DEMO_STAGE_ORDER: GpuDemoStage[] = [
  'idle',
  'ready',
  'thinking',
  'questions',
  'manifest_review',
  'matching',
  'seller_options',
  'seller_confirming',
  'seller_accepted',
  'pin',
  'paid',
  'queued',
  'pulling_image',
  'running',
  'uploading_artifacts',
  'completed',
]
const GPU_DEMO_DEFAULT_ANSWERS: GpuDemoAnswers = {
  gpuProfile: 'A6000 48GB or better',
  budget: '15',
  dataset: '320 prompt evaluation batch with model outputs to score',
  outputs: 'results.jsonl, metrics.json, logs.txt, receipt.json',
}
const GPU_DEMO_SELLERS: GpuDemoSeller[] = [
  {
    id: 'gpu-forge-a6000',
    name: 'GPU Forge A6000',
    providerPubkey: 'gpu-forge-a6000',
    resourceId: 'gpu-a6000-night-window',
    gpu: 'RTX A6000',
    vramGb: 48,
    region: 'US West',
    price: 12.5,
    eta: '45 min',
    score: 94,
    success: '97%',
    reason: 'Best budget fit with enough VRAM, CUDA 12, Docker isolation, and artifact hash support.',
    risk: 'Model download can add a few minutes if the requested weights are not cached.',
  },
  {
    id: 'h100-spot-runner',
    name: 'H100 Spot Runner',
    providerPubkey: 'h100-spot-runner',
    resourceId: 'gpu-h100-spot-25m',
    gpu: 'H100',
    vramGb: 80,
    region: 'US Central',
    price: 18,
    eta: '25 min',
    score: 97,
    success: '99%',
    reason: 'Fastest completion and highest memory headroom, but it exceeds the default budget.',
    risk: 'Spot availability can change before payment confirmation.',
  },
  {
    id: 'lab-node-4090',
    name: '4090 Lab Node',
    providerPubkey: 'lab-node-4090',
    resourceId: 'gpu-4090-lab-node',
    gpu: 'RTX 4090',
    vramGb: 24,
    region: 'US East',
    price: 8.5,
    eta: '70 min',
    score: 87,
    success: '92%',
    reason: 'Lowest price, acceptable for smaller batches, with slower runtime and tighter VRAM.',
    risk: 'May require smaller batch size if the model memory footprint is high.',
  },
]

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
  edit: icon(PencilLine),
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
    <div class="window-control-rail global-window-controls" data-global-window-controls aria-label="Window controls">
      <div class="window-controls ${isMacPlatform ? 'traffic-lights' : ''}" aria-label="Window controls">
        ${windowControlButtons}
      </div>
    </div>
    <div class="seller-surface-tabs hidden" data-seller-surface-tabs></div>
    <div class="sidebar-chrome">
      <div class="workspace-toolbar" aria-label="Workspace tools">
        <button type="button" data-toolbar-action="toggle-sidebar" aria-label="Toggle sidebar" title="Toggle sidebar">${toolbarIcons.sidebarExpanded}</button>
        <button type="button" data-toolbar-action="back" aria-label="Back" title="Back">${toolbarIcons.back}</button>
        <button type="button" data-toolbar-action="forward" aria-label="Forward" title="Forward">${toolbarIcons.forward}</button>
      </div>
    </div>
    <div class="sidebar-drag-strip" data-drag-region></div>
    <aside class="task-sidebar">
      <div class="sidebar-resize-handle no-drag" data-sidebar-resize-handle role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin="${SIDEBAR_MIN_WIDTH}" aria-valuemax="${SIDEBAR_MAX_WIDTH}" tabindex="0" title="Resize sidebar"></div>
      <div class="sidebar-brand-row drag-region" data-drag-region>
        <div class="sidebar-brand-identity" aria-label="Exora">
          <span class="sidebar-brand-name"><span class="sidebar-brand-exora">Exora</span> <span class="sidebar-brand-dock">Dock</span></span>
        </div>
        <button class="sidebar-brand-search no-drag" type="button" data-sidebar-action="search" aria-label="Search orders" title="Search orders">${toolbarIcons.search}</button>
      </div>
      <nav class="view-switch" aria-label="Workspace views">
        <div class="view-tab-cell"><button type="button" data-order-side-tab="buyer"><span class="tab-icon">${roleTabIcons.buyer}</span><span>Buyer</span></button></div>
        <div class="view-tab-cell"><button type="button" data-order-side-tab="seller"><span class="tab-icon">${roleTabIcons.seller}</span><span>Seller</span></button></div>
        <div class="settings-return-cell"><button type="button" data-action="return-from-settings"><span class="tab-icon">${toolbarIcons.back}</span><span>Return to App</span></button></div>
      </nav>
      <div class="order-role-row hidden" aria-hidden="true">
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
          <span data-project-folder-name>AgenStaff</span>
        </button>
        <button class="project-folder-menu-button" type="button" data-action="project-folder-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Project actions" title="Project actions">${toolbarIcons.projectMenu}</button>
      </div>
      <div class="project-folder-menu hidden" data-project-folder-menu role="menu" aria-label="Project actions"></div>
      <div class="task-context-menu hidden" data-task-context-menu role="menu" aria-label="Task actions"></div>
      <div class="sidebar-section-head">
        <div class="sidebar-section-title">
          <span data-sidebar-title>Transactions</span>
          <strong data-ledger-count>0</strong>
        </div>
        <button class="new-chat-button" type="button" data-action="new-chat" aria-label="Start transaction" title="Start transaction">${toolbarIcons.plus}</button>
      </div>
      <div class="ledger-list" data-ledger-list>
        <p class="empty-copy ledger-empty-copy">Start a transaction</p>
      </div>
      <div class="profile-panel" aria-label="Personal profile">
        <button class="profile-identity" type="button" data-action="open-profile-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Open account menu" title="Account menu">
          <span class="profile-avatar profile-avatar-large" data-profile-avatar>E</span>
          <span class="profile-name" data-profile-name>Exora User</span>
        </button>
        <div class="profile-actions">
          <button class="profile-icon-button" type="button" data-action="open-api-settings" aria-label="Open settings" title="Settings">${profileIcons.settings}</button>
        </div>
        <div class="profile-menu hidden" data-profile-menu role="menu" aria-label="Account menu"></div>
      </div>
    </aside>

    <section class="main-workspace">
      <div class="main-window-drag-strip" data-window-drag-handle data-drag-region aria-hidden="true"></div>
      <header class="main-header drag-region" data-drag-region>
        <div>
          <p class="eyebrow" data-main-kicker>Transaction Agent</p>
          <h2 data-decision-title>Ask Exora Dock</h2>
        </div>
        <div class="main-head-actions">
          <span data-decision-step hidden aria-hidden="true"></span>
        </div>
      </header>
      <div class="context-strip" data-context-strip>
        Select order activity on the left, or ask for a capability below.
      </div>
      <section class="workspace-view chat-view" data-view-panel="chat">
        <div class="chat-top-drag-layer" data-drag-region aria-hidden="true"></div>
        <div class="transaction-overlay" data-transaction-overlay></div>
        <div class="chat-feed" data-chat-feed aria-live="polite"></div>
        <div class="buyer-entry-stack" data-buyer-entry-stack>
          <div class="external-work-lock hidden" data-external-work-lock>
            <span data-external-work-lock-text>External local agent is working on this transaction.</span>
            <button class="secondary compact-action" type="button" data-action="take-over-work">${toolbarIcons.hand}<span>Take over</span></button>
          </div>
          <form class="chat-composer" data-agent-chat-form>
            <textarea data-agent-query rows="1" placeholder="${agentComposerPlaceholder()}"></textarea>
            <div class="composer-footer">
              <div class="composer-action-group">
                <div class="chat-agent-control">
                  <button class="composer-action-button composer-mcp-copy-button chat-agent-button" type="button" data-action="toggle-chat-agent" aria-label="Connect local Agent" title="Connect local Agent" aria-haspopup="menu" aria-expanded="false">${localAgentIcon}<span class="chat-agent-status-dot" data-chat-agent-status-dot aria-hidden="true"></span></button>
                  <div class="permission-menu chat-agent-menu hidden" data-chat-agent-menu role="menu" aria-label="Local Agent session"></div>
                </div>
                <button class="composer-action-button" type="submit" aria-label="Send message" title="Send" data-agent-send>${toolbarIcons.send}</button>
              </div>
            </div>
          </form>
        </div>
      </section>
      <section class="workspace-view action-view hidden" data-view-panel="action">
        <div class="decision-content" data-decision-content>
          <p class="empty-copy">Seller choices, approvals, and payment PIN steps appear here.</p>
        </div>
      </section>

      <section class="workspace-view settings-view hidden" data-view-panel="settings">
        <section class="settings-detail">
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
              <p class="muted">Archived transactions appear here.</p>
            </div>
          </section>
        </section>
      </section>
    </section>

    <aside class="transaction-detail-sidebar" data-transaction-detail-sidebar aria-hidden="true">
      <div class="transaction-detail-resize-handle no-drag" data-transaction-detail-resize-handle role="separator" aria-label="Resize detail panel" aria-orientation="vertical" aria-valuemin="${TRANSACTION_DETAIL_MIN_WIDTH}" aria-valuemax="${TRANSACTION_DETAIL_MAX_WIDTH}" tabindex="0" title="Resize detail panel"></div>
      <div class="transaction-detail-content" data-transaction-detail-content></div>
    </aside>

    <header class="transaction-detail-head" aria-label="Detail panel controls">
      <div class="window-control-rail transaction-detail-controls">
        <button class="transaction-detail-panel-toggle" type="button" data-action="close-transaction-detail" aria-label="Collapse stage detail" title="Collapse detail">${toolbarIcons.detailCollapse}</button>
        <div class="window-controls ${isMacPlatform ? 'traffic-lights' : ''}" aria-label="Window controls">
        ${windowControlButtons}
        </div>
      </div>
    </header>

    <div class="window-control-rail transaction-detail-popout-controls" data-transaction-detail-popout-controls aria-hidden="true">
      <div class="window-controls ${isMacPlatform ? 'traffic-lights' : ''}" aria-label="Window controls">
        ${windowControlButtons}
      </div>
    </div>

    <div class="market-project-picker hidden" data-market-project-picker>
      <button class="market-project-scrim" type="button" data-action="close-market-project-picker" aria-label="Close project picker"></button>
      <section class="market-project-dialog" data-market-project-dialog role="dialog" aria-modal="true" aria-label="Choose project"></section>
    </div>

    <div class="order-search-modal hidden" data-order-search-modal aria-hidden="true">
      <button class="order-search-scrim" type="button" data-action="close-order-search" aria-label="Close order search"></button>
      <section class="order-search-panel" role="dialog" aria-modal="true" aria-labelledby="order-search-title">
        <header class="order-search-head">
          <div class="order-search-head-copy">
            <span class="order-search-head-mark" aria-hidden="true">${toolbarIcons.search}</span>
            <div>
              <p class="eyebrow">Exora Search</p>
              <h2 id="order-search-title" data-order-search-title>Search orders</h2>
              <span>Find activity across your current workspace.</span>
            </div>
          </div>
          <button class="order-search-close" type="button" data-action="close-order-search" aria-label="Close order search" title="Close">${windowIcons.close}</button>
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
        <footer class="order-search-footer">
          <span>Searches the current Buyer or Seller workspace</span>
          <span><kbd>Esc</kbd> to close</span>
        </footer>
      </section>
    </div>

    <div class="cart-modal hidden" data-cart-modal aria-hidden="true">
      <button class="cart-modal-scrim" type="button" data-action="close-cart" aria-label="Close cart"></button>
      <section class="cart-modal-panel" data-cart-modal-panel role="dialog" aria-modal="true" aria-labelledby="cart-modal-title">
        <header class="cart-modal-head">
          <div>
            <p class="eyebrow" data-cart-kicker>Cart</p>
            <h2 id="cart-modal-title" data-cart-title>Cards</h2>
          </div>
          <button class="cart-modal-close" type="button" data-action="close-cart" aria-label="Close cart" title="Close cart">${windowIcons.close}</button>
        </header>
        <div class="cart-modal-content" data-cart-content></div>
      </section>
    </div>

    <div class="toast" data-message role="status" aria-live="polite" aria-atomic="true"></div>

  </main>
`

const fields = {
  appShell: app.querySelector<HTMLElement>('.app-shell')!,
  taskSidebar: app.querySelector<HTMLElement>('.task-sidebar')!,
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
  externalWorkLock: app.querySelector<HTMLElement>('[data-external-work-lock]')!,
  externalWorkLockText: app.querySelector<HTMLElement>('[data-external-work-lock-text]')!,
  externalWorkTakeoverButton: app.querySelector<HTMLButtonElement>('[data-action="take-over-work"]')!,
  permissionButton: app.querySelector<HTMLButtonElement>('[data-action="toggle-permission-menu"]'),
  permissionMenu: app.querySelector<HTMLElement>('[data-permission-menu]'),
  chatAgentButton: app.querySelector<HTMLButtonElement>('[data-action="toggle-chat-agent"]')!,
  chatAgentMenu: app.querySelector<HTMLElement>('[data-chat-agent-menu]')!,
  transactionOverlay: app.querySelector<HTMLElement>('[data-transaction-overlay]')!,
  transactionDetailSidebar: app.querySelector<HTMLElement>('[data-transaction-detail-sidebar]')!,
  transactionDetailPopoutControls: app.querySelector<HTMLElement>('[data-transaction-detail-popout-controls]')!,
  transactionDetailContent: app.querySelector<HTMLElement>('[data-transaction-detail-content]')!,
  transactionDetailCloseButton: app.querySelector<HTMLButtonElement>('[data-action="close-transaction-detail"]')!,
  transactionDetailOpenButtons: Array.from(app.querySelectorAll<HTMLButtonElement>('[data-action="open-transaction-detail"]')),
  transactionDetailResizeHandle: app.querySelector<HTMLElement>('[data-transaction-detail-resize-handle]')!,
  chatFeed: app.querySelector<HTMLElement>('[data-chat-feed]')!,
  contextStrip: app.querySelector<HTMLElement>('[data-context-strip]')!,
  sellerSurfaceTabs: app.querySelector<HTMLElement>('[data-seller-surface-tabs]')!,
  mainKicker: app.querySelector<HTMLElement>('[data-main-kicker]')!,
  decisionTitle: app.querySelector<HTMLElement>('[data-decision-title]')!,
  decisionStep: app.querySelector<HTMLElement>('[data-decision-step]')!,
  decisionContent: app.querySelector<HTMLElement>('[data-decision-content]')!,
  chatView: app.querySelector<HTMLElement>('[data-view-panel="chat"]')!,
  actionView: app.querySelector<HTMLElement>('[data-view-panel="action"]')!,
  settingsView: app.querySelector<HTMLElement>('[data-view-panel="settings"]')!,
  localAgentsContent: app.querySelector<HTMLElement>('[data-local-agents-content]')!,
  marketProjectPicker: app.querySelector<HTMLElement>('[data-market-project-picker]')!,
  marketProjectDialog: app.querySelector<HTMLElement>('[data-market-project-dialog]')!,
  orderSearchModal: app.querySelector<HTMLElement>('[data-order-search-modal]')!,
  orderSearchTitle: app.querySelector<HTMLElement>('[data-order-search-title]')!,
  orderSearchInput: app.querySelector<HTMLInputElement>('[data-order-search-input]')!,
  orderSearchResults: app.querySelector<HTMLElement>('[data-order-search-results]')!,
  orderSearchCount: app.querySelector<HTMLElement>('[data-order-search-count]')!,
  cartModal: app.querySelector<HTMLElement>('[data-cart-modal]')!,
  cartModalPanel: app.querySelector<HTMLElement>('[data-cart-modal-panel]')!,
  cartKicker: app.querySelector<HTMLElement>('[data-cart-kicker]')!,
  cartTitle: app.querySelector<HTMLElement>('[data-cart-title]')!,
  cartContent: app.querySelector<HTMLElement>('[data-cart-content]')!,
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
  archiveRecords: app.querySelector<HTMLElement>('[data-archive-records]')!,
}

const buyerAgentForm = app.querySelector<HTMLFormElement>('[data-buyer-agent-form]')!
const sellerForm = app.querySelector<HTMLFormElement>('[data-seller-form]')!
const llmSettingsForm = app.querySelector<HTMLFormElement>('[data-llm-form]')!
const agentChatForm = app.querySelector<HTMLFormElement>('[data-agent-chat-form]')!
const agentQuery = app.querySelector<HTMLTextAreaElement>('[data-agent-query]')!
const agentSendButton = app.querySelector<HTMLButtonElement>('[data-agent-send]')!

fields.sellerSurfaceTabs.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-v3-seller-tab]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  const nextTab = button.dataset.v3SellerTab as V3SellerTab
  if (!nextTab || nextTab === state.v3SellerTab) return
  state.v3SellerTab = nextTab
  renderDecisionPanel()
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

function normalizeTransactionDetailWidth(value: unknown, fallback = DEFAULT_TRANSACTION_DETAIL_WIDTH) {
  return clampInteger(value, fallback, TRANSACTION_DETAIL_MIN_WIDTH, TRANSACTION_DETAIL_MAX_WIDTH)
}

function legacyStoredTransactionDetailWidth() {
  return normalizeTransactionDetailWidth(localStorage.getItem('exora.transactionDetailWidth'))
}

function storedTransactionDetailWidth() {
  return hasDesktopBridge() ? DEFAULT_TRANSACTION_DETAIL_WIDTH : legacyStoredTransactionDetailWidth()
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
  marketRail?: MarketRailResponse
  marketRailLoading: boolean
  marketRailError?: string
  marketCardSearchCandidates: SellerCandidate[]
  marketCardSearchQuery?: string
  marketCardSearchLoading: boolean
  marketCardSearchError?: string
  cardDrafts: Partial<Record<AgentCardRole, AgentCard>>
  cardDiagnosticsTasks: Partial<Record<AgentCardRole, CardDiagnosticsTask>>
  sellerCardGeneration?: SellerCardGeneration
  cartOpen: boolean
  activeCardEditor?: AgentCardRole
  cardMessage?: string
  marketDetailProvider?: string
  marketRailDetailId?: string
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
  localAgents: LocalAgentInstallation[]
  localAgentBinding?: LocalAgentBinding
  localAgentScanning: boolean
  localAgentSnapshotLoaded: boolean
  localAgentSnapshotLoading: boolean
  localAgentScannedAt?: string
  localAgentError?: string
  localAgentSessions: Record<string, InteractiveAgentSession>
  chatAgentMenuOpen: boolean
  chatAgentConnecting: boolean
  walletStatus?: WalletStatus
  appStatus?: AppStatus
  projectFolder?: ProjectFolder
  projectFolders: ProjectFolder[]
  activeProjectFolderPath?: string
  mcpConnections: MCPConnection[]
  workMcpLeases: WorkMCPLease[]
  workRuns: WorkRun[]
  workRunEvents: Record<string, WorkRunEvent[]>
  cloudTransactions: CloudTransactionProjection[]
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
  sellerWorkspaceMode: SellerWorkspaceMode
  sidebarCollapsed: boolean
  sidebarWidth: number
  transactionDetailWidth: number
  viewHistory: ActiveView[]
  viewHistoryIndex: number
  selectedId?: string
  selectedChatId?: string
  selectedWorkThreadId?: string
  transactionStageSelections: Record<string, string>
  transactionStageDetailCollapsed: Record<string, boolean>
  transactionStageInspectorOpen: boolean
  buyerFirstStepTransition: boolean
  gpuDemo?: GpuDemoState
  newConversationDraft: boolean
  chatThreads: ChatThread[]
  pinStep?: PinStep
  seenPlanIds: Set<string>
  seenApprovalIds: Set<string>
  statusLoading: boolean
  workspaceLoading: boolean
  v3Products: V3Product[]
  v3CatalogQuery: string
  v3CatalogLoading: boolean
  v3CatalogLoaded: boolean
  v3CatalogError?: string
  v3SelectedProduct?: V3Product
  v3ActivitySessions: Record<OrderSide, V3ActivitySession[]>
  v3ActivityLoaded: Record<OrderSide, boolean>
  v3ActivityLoading: Record<OrderSide, boolean>
  v3ActivityErrors: Partial<Record<OrderSide, string>>
  v3ActivityKindFilter: 'all' | 'compute' | 'download' | 'api_operation'
  v3ActivityStatusFilter: 'all' | 'active' | 'completed' | 'needs_attention'
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
  v3LongDiscountAfterMinutes: number
  v3LongDiscountPercent: number
  v3LongDiscountMinimumPricePercent: number
  v3LongDiscountEnabled: boolean
  v3EnvironmentSaving: boolean
  v3InstalledEnvironments: Array<Record<string, any>>
  v3ImageProgress?: V3ImageProgress
  v3SelectedEnvironmentImageId?: string
  v3HostScanning: boolean
  v3HostScanProgress?: V3HostScanProgress
  v3ResourceArchive?: V3ResourceArchive
  v3ResourceSources: V3ResourceSource[]
  v3AssetProgress?: V3AssetProgress
  v3ResourceLicense: string
  v3ResourceDelivery: string
  v3ResourceTitle: string
  v3ResourceDescription: string
  v3ResourceVersion: string
  v3ResourceGrantHours: number
  v3ResourcePrice: number
  v3ResourceSubmitting: boolean
  v3OpenAPIDocument: string
  v3OpenAPIName: string
  v3APIProtocol: V3APIBridgeProtocol
  v3APITitle: string
  v3APIDescription: string
  v3APIBaseURL: string
  v3APIHealthPath: string
  v3APIAuthType: 'bearer' | 'api_key' | 'basic' | 'none'
  v3APIKeyHeader: string
  v3APIDefaultPrice: number
  v3APIPriceUnit: 'request' | 'successful_request' | 'tokens' | 'image' | 'second'
  v3APIRoutes: V3APIRoute[]
  v3APIProbe?: V3APIProbe
  v3APIProbing: boolean
  v3APIStep: 1 | 2 | 3
  v3APIDraftId: string
  v3APIDraftVersion: number
  v3APIMaterials: V3APIMaterial[]
  v3APIUnresolvedFields: string[]
  v3APIAgentNotes: string
  v3APISellerAttestation: boolean
  v3APIAttestPricing: boolean
  v3APIAttestUsage: boolean
  v3APIAttestRights: boolean
  v3APICredentialConfigured: boolean
  v3APIBasicUsername: string
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
  v3EndpointDraftDirty: boolean
  v3EndpointDraft?: V3APIBridgeDraft
  v3EndpointMaterials: V3APIMaterial[]
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
  v3EndpointAuthType: 'bearer' | 'api_key' | 'basic' | 'none'
  v3EndpointSecret: string
  v3EndpointAPIKeyHeader: string
  v3EndpointBasicUsername: string
  v3EndpointConcurrency: number
  v3EndpointTimeout: number
  v3EndpointProbe?: V3APIProbe
  v3EndpointRouteTestPath: string
  v3EndpointRouteTestQuery: string
  v3EndpointRouteTestContentType: string
  v3EndpointRouteTestBody: string
  v3EndpointRouteTestDangerConfirmed: boolean
  v3EndpointRouteTestResult?: { ok: boolean; status?: number; latencyMs?: number; contentType?: string; bytesRead?: number; truncated?: boolean; preview?: string; sseEvents?: string[]; checkedAt?: string; error?: string }
  v3EndpointAttestPricing: boolean
  v3EndpointAttestRuntime: boolean
  v3EndpointAttestRights: boolean
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
  marketRailLoading: false,
  marketCardSearchCandidates: [],
  marketCardSearchLoading: false,
  cardDrafts: {},
  cardDiagnosticsTasks: {},
  sellerCardGeneration: undefined,
  cartOpen: false,
  llmTestStatus: undefined,
  activeSettingsView: 'wallet',
  localAgents: [],
  localAgentSessions: {},
  chatAgentMenuOpen: false,
  chatAgentConnecting: false,
  localAgentBinding: undefined,
  localAgentScanning: false,
  localAgentSnapshotLoaded: false,
  localAgentSnapshotLoading: false,
  localAgentScannedAt: undefined,
  localAgentError: undefined,
  projectFolders: [],
  mcpConnections: [],
  workMcpLeases: [],
  workRuns: [],
  workRunEvents: {},
  cloudTransactions: [],
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
  sellerWorkspaceMode: 'transactions',
  sidebarCollapsed: false,
  sidebarWidth: storedSidebarWidth(),
  transactionDetailWidth: storedTransactionDetailWidth(),
  viewHistory: ['chat'],
  viewHistoryIndex: 0,
  transactionStageSelections: {},
  transactionStageDetailCollapsed: {},
  transactionStageInspectorOpen: false,
  buyerFirstStepTransition: false,
  gpuDemo: undefined,
  newConversationDraft: true,
  chatThreads: [],
  seenPlanIds: new Set(),
  seenApprovalIds: new Set(),
  statusLoading: false,
  workspaceLoading: false,
  v3Products: [],
  v3CatalogQuery: '',
  v3CatalogLoading: false,
  v3CatalogLoaded: false,
  v3ActivitySessions: { buyer: [], seller: [] },
  v3ActivityLoaded: { buyer: false, seller: false },
  v3ActivityLoading: { buyer: false, seller: false },
  v3ActivityErrors: {},
  v3ActivityKindFilter: 'all',
  v3ActivityStatusFilter: 'all',
  selectedV3ActivitySessionId: undefined,
  v3ActivityDetail: undefined,
  v3ActivityDetailLoading: false,
  v3ActivityDetailError: undefined,
  v3SellerTab: 'vm',
  v3Listings: [],
  v3ListingApplications: [],
  v3ListingsLoading: false,
  v3ListingsLoaded: false,
  v3HighlightedListingId: undefined,
  v3ExpandedListingId: undefined,
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
  v3LongDiscountAfterMinutes: 60,
  v3LongDiscountPercent: 0,
  v3LongDiscountMinimumPricePercent: 50,
  v3LongDiscountEnabled: false,
  v3EnvironmentSaving: false,
  v3InstalledEnvironments: [],
  v3HostScanning: false,
  v3ResourceSources: [],
  v3ResourceLicense: 'commercial',
  v3ResourceDelivery: 'downloadable',
  v3ResourceTitle: '',
  v3ResourceDescription: '',
  v3ResourceVersion: '1.0.0',
  v3ResourceGrantHours: 24,
  v3ResourcePrice: 0,
  v3ResourceSubmitting: false,
  v3OpenAPIDocument: '',
  v3OpenAPIName: '',
  v3APIProtocol: 'openapi',
  v3APITitle: '',
  v3APIDescription: '',
  v3APIBaseURL: '',
  v3APIHealthPath: '/health',
  v3APIAuthType: 'bearer',
  v3APIKeyHeader: 'X-API-Key',
  v3APIDefaultPrice: 0.01,
  v3APIPriceUnit: 'request',
  v3APIRoutes: [],
  v3APIProbing: false,
  v3APIStep: 1,
  v3APIDraftId: localStorage.getItem('exora.apiBridgeDraftId') || `apid_${crypto.randomUUID().replace(/-/g, '')}`,
  v3APIDraftVersion: 0,
  v3APIMaterials: [],
  v3APIUnresolvedFields: [],
  v3APIAgentNotes: '',
  v3APISellerAttestation: false,
  v3APIAttestPricing: false,
  v3APIAttestUsage: false,
  v3APIAttestRights: false,
  v3APICredentialConfigured: false,
  v3APIBasicUsername: '',
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
  v3EndpointDraftDirty: false,
  v3EndpointDraft: undefined,
  v3EndpointMaterials: [],
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
}

let transactionProgressPollTimer: number | undefined
let transactionProgressPollKey = ''
let localAgentEventUnsubscribe: (() => void) | undefined
let v3ProgressUnsubscribe: (() => void) | undefined
const localAgentAssistantMessages = new Map<string, string>()
const localAgentAssistantBuffers = new Map<string, string>()
let cardDiagnosticsTaskSequence = 0
let buyerFirstStepTransitionTimer: number | undefined
let sellerListingToggleInFlight = false
let settingsPersistenceReady = false
let appSettingsSaveTimer: number | undefined
let lastTransactionsFingerprint = ''
let sidebarResizePointerId: number | undefined
let transactionDetailResizePointerId: number | undefined
let pendingTransactionStageScroll: { threadId: string; stageId: string } | undefined
let lastChatFeedRenderKey = ''
let lastTransactionDetailRenderKey = ''
let forceChatFeedScrollBottom = false
const gpuDemoTimers = new Set<number>()
const chatFeedScrollPositions = new Map<string, number>()
const chatSaveTimers = new Map<string, number>()
const chatSaveQueues = new Map<string, Promise<void>>()
const threadStorageKeys = new Map<string, string>()
let toastTimer: number | undefined
let workspaceRefreshInFlight: Promise<void> | undefined
let workspaceRefreshQueued = false
let workspaceRefreshQueuedQuiet = true

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
  if (value === 'wallet' || value === 'archives') {
    return value
  }
  return 'wallet'
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
    transactionDetailWidth: legacyStoredTransactionDetailWidth(),
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
    transactionDetailWidth: input.transactionDetailWidth === undefined ? undefined : normalizeTransactionDetailWidth(input.transactionDetailWidth),
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
    transactionDetailWidth: value.transactionDetailWidth ?? fallback.transactionDetailWidth,
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
  if (settings.workOrderSide) {
    state.workOrderSide = settings.workOrderSide
    state.sellerWorkspaceMode = 'transactions'
  }
  if (settings.marketOrderSide) state.marketOrderSide = settings.marketOrderSide
  if (typeof settings.sidebarCollapsed === 'boolean') state.sidebarCollapsed = settings.sidebarCollapsed
  if (typeof settings.sidebarWidth === 'number') state.sidebarWidth = normalizeSidebarWidth(settings.sidebarWidth)
  if (typeof settings.transactionDetailWidth === 'number') state.transactionDetailWidth = normalizeTransactionDetailWidth(settings.transactionDetailWidth)
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
    transactionDetailWidth: state.transactionDetailWidth,
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
    localStorage.setItem('exora.transactionDetailWidth', String(settings.transactionDetailWidth || DEFAULT_TRANSACTION_DETAIL_WIDTH))
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
    applyDemoTransactionsToState()
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
    if (!thread || (thread.messages.length === 0 && !thread.agentSessionId)) continue
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
    side: input.side === 'seller' ? 'seller' : input.side === 'buyer' ? 'buyer' : undefined,
    workThreadId: String(input.workThreadId || '').trim() || undefined,
    orderId: String(input.orderId || '').trim() || undefined,
    taskIds: Array.isArray(input.taskIds) ? input.taskIds.map(String).filter(Boolean) : [],
    status: String(input.status || '').trim() || undefined,
    participants: Array.isArray(input.participants) ? input.participants.filter((item): item is NonNullable<ChatThread['participants']>[number] => item === 'buyer_agent' || item === 'seller_agent' || item === 'buyer_human' || item === 'seller_human') : ['buyer_human', 'buyer_agent', 'seller_agent'],
    providerPubkey: String(input.providerPubkey || '').trim() || undefined,
    agentSessionId: String(input.agentSessionId || '').trim() || undefined,
    agentDriverId: String(input.agentDriverId || '').trim() || undefined,
    agentEventCursor: Math.max(0, Number(input.agentEventCursor || 0) || 0),
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
    stageId: String(input.stageId || '').trim() || undefined,
    text: String(input.text || ''),
    meta: String(input.meta || '').trim() || undefined,
    providerPubkey: String(input.providerPubkey || '').trim() || undefined,
    eventRef: input.eventRef && typeof input.eventRef === 'object' ? { ...input.eventRef } : undefined,
    result: input.result && typeof input.result === 'object' ? input.result : undefined,
    pending: input.pending === true,
  }
}

function isDemoIdentifier(value?: string) {
  const text = String(value || '')
  return text.startsWith('mvp-demo-') || text.startsWith('demo-')
}

function isDemoChatThread(thread?: ChatThread) {
  return Boolean(thread && (
    isDemoIdentifier(thread.id) ||
    isDemoIdentifier(thread.orderId) ||
    (thread.taskIds || []).some(isDemoIdentifier)
  ))
}

function isDemoOrderPlan(plan?: OrderPlan) {
  return Boolean(plan && (isDemoIdentifier(plan.planId) || isDemoIdentifier(plan.taskId)))
}

function isDemoApproval(approval?: Approval) {
  return Boolean(approval && (
    isDemoIdentifier(approval.approvalId) ||
    isDemoIdentifier(approval.taskId) ||
    isDemoIdentifier(approval.planId)
  ))
}

function isDemoTask(task?: Task) {
  return Boolean(task && (isDemoIdentifier(task.id) || isDemoIdentifier(task.orderId)))
}

function isDemoPayment(payment?: PaymentRecord) {
  return Boolean(payment && (
    isDemoIdentifier(payment.paymentId) ||
    isDemoIdentifier(payment.taskId) ||
    isDemoIdentifier(payment.approvalId)
  ))
}

function isDemoWorkRun(run?: WorkRun) {
  return Boolean(run && (
    isDemoIdentifier(run.runId) ||
    isDemoIdentifier(run.workUid) ||
    isDemoIdentifier(run.entities?.taskId) ||
    isDemoIdentifier(run.entities?.orderPlanId) ||
    (run.entities?.orderPlanIds || []).some(isDemoIdentifier)
  ))
}

function mergeDemoRecords<T>(current: T[], demo: T[] | undefined, isDemoRecord: (item: T) => boolean, keyFor: (item: T) => string) {
  if (!demo?.length) return current.filter((item) => !isDemoRecord(item))
  const byKey = new Map<string, T>()
  for (const item of current) {
    if (!isDemoRecord(item)) byKey.set(keyFor(item), item)
  }
  for (const item of demo) byKey.set(keyFor(item), item)
  return [...byKey.values()]
}

function applyDemoTransactionsToState() {
  const demo = mvpDemoTransactionBundle()
  const demoThreads = (demo.conversations || [])
    .map((record) => normalizeChatThreadForState(record.thread))
    .filter((thread): thread is ChatThread => Boolean(thread))
  state.chatThreads = mergeDemoRecords(state.chatThreads, demoThreads, isDemoChatThread, (thread) => thread.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  state.orderPlans = mergeDemoRecords(state.orderPlans, demo.orderPlans, isDemoOrderPlan, (plan) => plan.planId)
  state.approvals = mergeDemoRecords(state.approvals, demo.approvals, isDemoApproval, (approval) => approval.approvalId)
  state.tasks = mergeDemoRecords(state.tasks, demo.tasks, isDemoTask, (task) => task.id)
  state.payments = mergeDemoRecords(state.payments, demo.payments, isDemoPayment, (payment) => payment.paymentId)
  state.workRuns = mergeDemoRecords(state.workRuns, demo.workRuns, isDemoWorkRun, (run) => run.runId)
  const demoRunIds = new Set((demo.workRuns || []).map((run) => run.runId))
  const workRunEvents = { ...state.workRunEvents }
  for (const runId of Object.keys(workRunEvents)) {
    if (isDemoIdentifier(runId) || demoRunIds.has(runId)) delete workRunEvents[runId]
  }
  state.workRunEvents = {
    ...workRunEvents,
    ...(demo.workRunEvents || {}),
  }
}

function isGpuDemoIdentifier(value?: string) {
  return String(value || '').startsWith(GPU_DEMO_PREFIX)
}

function isGpuDemoOrderPlan(plan?: OrderPlan) {
  return Boolean(plan && isGpuDemoIdentifier(plan.planId))
}

function isGpuDemoApproval(approval?: Approval) {
  return Boolean(approval && (isGpuDemoIdentifier(approval.approvalId) || isGpuDemoIdentifier(approval.taskId) || isGpuDemoIdentifier(approval.planId)))
}

function isGpuDemoTask(task?: Task) {
  return Boolean(task && (isGpuDemoIdentifier(task.id) || isGpuDemoIdentifier(task.orderId)))
}

function isGpuDemoPayment(payment?: PaymentRecord) {
  return Boolean(payment && (isGpuDemoIdentifier(payment.paymentId) || isGpuDemoIdentifier(payment.taskId) || isGpuDemoIdentifier(payment.approvalId)))
}

function isGpuDemoWorkRun(run?: WorkRun) {
  return Boolean(run && (isGpuDemoIdentifier(run.runId) || isGpuDemoIdentifier(run.workUid) || isGpuDemoIdentifier(run.entities?.taskId) || isGpuDemoIdentifier(run.entities?.orderPlanId)))
}

function gpuDemoStageIndex(stage?: GpuDemoStage) {
  return Math.max(0, GPU_DEMO_STAGE_ORDER.indexOf(stage || 'idle'))
}

function gpuDemoAtLeast(stage: GpuDemoStage) {
  const demo = state.gpuDemo
  return Boolean(demo?.active && gpuDemoStageIndex(demo.stage) >= gpuDemoStageIndex(stage))
}

function selectedGpuDemoSeller(demo = state.gpuDemo) {
  return GPU_DEMO_SELLERS.find((seller) => seller.id === demo?.selectedSellerId) || GPU_DEMO_SELLERS[0]
}

function gpuDemoOptionId(seller: GpuDemoSeller, demo = state.gpuDemo) {
  return `${demo?.ids.base || GPU_DEMO_PREFIX}-option-${seller.id}`
}

function gpuDemoSellerFromOption(option?: OrderDraftOption) {
  if (!option) return undefined
  return GPU_DEMO_SELLERS.find((seller) => option.optionId === gpuDemoOptionId(seller) || option.providerPubkey === seller.providerPubkey)
}

function createGpuDemoIds(): GpuDemoIds {
  const base = `${GPU_DEMO_PREFIX}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const planId = `${base}-plan`
  return {
    base,
    workUid: `${base}-work`,
    planId,
    orderId: planId,
    taskId: `${base}-task`,
    approvalId: `${base}-approval`,
    paymentId: `${base}-payment`,
    runId: `${base}-run`,
  }
}

function createGpuDemoState(): GpuDemoState {
  const folder = defaultWorkProjectFolder()
  const now = new Date().toISOString()
  return {
    active: true,
    stage: 'ready',
    ids: createGpuDemoIds(),
    taskText: GPU_DEMO_TASK,
    projectPath: folder.path,
    projectName: folder.name,
    answers: { ...GPU_DEMO_DEFAULT_ANSWERS },
    startedAt: now,
    updatedAt: now,
  }
}

function clearGpuDemoTimers() {
  for (const timer of gpuDemoTimers) window.clearTimeout(timer)
  gpuDemoTimers.clear()
}

function scheduleGpuDemo(callback: () => void, delayMs: number) {
  const timer = window.setTimeout(() => {
    gpuDemoTimers.delete(timer)
    callback()
  }, delayMs)
  gpuDemoTimers.add(timer)
}

function removeGpuDemoRecordsFromState() {
  state.orderPlans = state.orderPlans.filter((item) => !isGpuDemoOrderPlan(item))
  state.approvals = state.approvals.filter((item) => !isGpuDemoApproval(item))
  state.tasks = state.tasks.filter((item) => !isGpuDemoTask(item))
  state.payments = state.payments.filter((item) => !isGpuDemoPayment(item))
  state.workRuns = state.workRuns.filter((item) => !isGpuDemoWorkRun(item))
  for (const runId of Object.keys(state.workRunEvents)) {
    if (isGpuDemoIdentifier(runId)) delete state.workRunEvents[runId]
  }
}

function gpuDemoTaskType(demo: GpuDemoState) {
  return demo.answers.gpuProfile.toLowerCase().includes('h100') ? 'compute.gpu.h100_inference' : 'compute.gpu.inference'
}

function gpuDemoSelectedPrice(demo: GpuDemoState) {
  return selectedGpuDemoSeller(demo).price
}

function gpuDemoTaskStatus(stage: GpuDemoStage): Task['status'] {
  if (stage === 'completed') return 'completed'
  if (stage === 'pulling_image' || stage === 'running' || stage === 'uploading_artifacts') return 'running'
  if (stage === 'paid' || stage === 'queued') return 'consented'
  return 'pending_consent'
}

function gpuDemoRunStatus(stage: GpuDemoStage) {
  if (stage === 'completed') return 'completed'
  if (stage === 'pulling_image' || stage === 'running' || stage === 'uploading_artifacts') return 'running'
  return 'queued'
}

function gpuDemoCurrentStep(stage: GpuDemoStage) {
  if (stage === 'pulling_image') return 'submit_worker_job'
  if (stage === 'running') return 'provider_execution'
  if (stage === 'uploading_artifacts') return 'fetch_artifacts'
  if (stage === 'completed') return 'terminal_report'
  if (stage === 'seller_confirming') return 'seller_valuation'
  if (stage === 'seller_accepted' || stage === 'pin') return 'wait_owner_approval_payment'
  if (stage === 'paid' || stage === 'queued') return 'input_transfer'
  return 'quote_review'
}

function gpuDemoOrderState(demo: GpuDemoState): NonNullable<OrderPlan['orderState']> | undefined {
  if (!gpuDemoAtLeast('seller_options')) return undefined
  const selected = Boolean(demo.selectedSellerId)
  const stateByStage: Record<GpuDemoStage, string> = {
    idle: 'plan_first',
    ready: 'plan_first',
    thinking: 'plan_first',
    questions: 'plan_first',
    manifest_review: 'plan_first',
    matching: 'cloud_matching',
    seller_options: 'quote_review',
    seller_confirming: 'quote_review',
    seller_accepted: 'order_authorized',
    pin: 'order_authorized',
    paid: 'input_transfer',
    queued: 'input_transfer',
    pulling_image: 'provider_execution',
    running: 'provider_execution',
    uploading_artifacts: 'provider_execution',
    completed: 'buyer_verification',
  }
  const waitingFor = demo.stage === 'seller_confirming'
    ? 'seller_agent'
    : demo.stage === 'seller_options'
      ? 'user_input'
      : demo.stage === 'completed'
        ? 'user_input'
        : gpuDemoAtLeast('paid')
          ? 'provider_response'
          : 'buyer_user'
  return {
    planId: demo.ids.planId,
    orderId: demo.ids.orderId,
    taskId: gpuDemoAtLeast('seller_accepted') ? demo.ids.taskId : undefined,
    state: stateByStage[demo.stage],
    owner: demo.stage === 'seller_confirming' ? 'seller_agent' : gpuDemoAtLeast('paid') ? 'provider_docker' : 'buyer_agent',
    waitingFor,
    updatedAt: demo.updatedAt,
    terminalReason: undefined,
  }
}

function gpuDemoPlanEvents(demo: GpuDemoState): NonNullable<OrderPlan['events']> {
  const seller = selectedGpuDemoSeller(demo)
  const events: NonNullable<OrderPlan['events']> = [
    { time: demo.startedAt, type: 'agent_session_ready', message: 'Local Agent session prepared for the GPU job demo.' },
    { time: demo.updatedAt, type: 'buyer_manifest_ready', message: `GPU job manifest requires ${demo.answers.gpuProfile}, budget ${demo.answers.budget} USDC, outputs ${demo.answers.outputs}.` },
  ]
  if (gpuDemoAtLeast('seller_options')) events.push({ time: demo.updatedAt, type: 'seller_quotes_ready', message: 'Three local demo sellers returned fixed quotes.' })
  if (demo.selectedSellerId) events.push({ time: demo.updatedAt, type: 'seller_selected', message: `${seller.name} selected by the buyer.` })
  if (gpuDemoAtLeast('seller_accepted')) events.push({ time: demo.updatedAt, type: 'seller_confirmed', message: `${seller.name} accepted the local demo job.` })
  if (gpuDemoAtLeast('paid')) events.push({ time: demo.updatedAt, type: 'payment_confirmed', message: 'Simulated payment proof was recorded locally.' })
  if (gpuDemoAtLeast('completed')) events.push({ time: demo.updatedAt, type: 'terminal_report', message: 'Result files, logs, metrics, and receipt are ready.' })
  return events.slice(-6)
}

function gpuDemoWorkRunEvents(demo: GpuDemoState): WorkRunEvent[] {
  const runId = demo.ids.runId
  const events: WorkRunEvent[] = [
    {
      eventId: `${runId}-payment`,
      type: 'verify_payment_evidence',
      runId,
      workUid: demo.ids.workUid,
      step: 'Payment proof',
      status: gpuDemoAtLeast('paid') ? 'confirmed_simulated' : 'pending',
      summary: gpuDemoAtLeast('paid') ? 'Local demo payment proof is confirmed; no real chain payment was made.' : 'Waiting for owner PIN.',
      createdAt: demo.updatedAt,
    },
  ]
  if (gpuDemoAtLeast('queued')) {
    events.push({
      eventId: `${runId}-queued`,
      type: 'submit_worker_job',
      runId,
      workUid: demo.ids.workUid,
      step: 'Queue job',
      status: 'queued',
      summary: 'GPU job queued with Docker isolation and bounded inputs.',
      createdAt: demo.updatedAt,
    })
  }
  if (gpuDemoAtLeast('pulling_image')) {
    events.push({
      eventId: `${runId}-pull`,
      type: 'pulling_image',
      runId,
      workUid: demo.ids.workUid,
      step: 'Pull image',
      status: 'running',
      summary: 'Worker is preparing the CUDA runtime image and cached model files.',
      createdAt: demo.updatedAt,
    })
  }
  if (gpuDemoAtLeast('running')) {
    events.push({
      eventId: `${runId}-running`,
      type: 'provider_execution',
      runId,
      workUid: demo.ids.workUid,
      step: 'GPU execution',
      status: 'running',
      summary: 'Inference batch is running and writing checkpointed outputs.',
      createdAt: demo.updatedAt,
    })
  }
  if (gpuDemoAtLeast('uploading_artifacts')) {
    events.push({
      eventId: `${runId}-uploading`,
      type: 'fetch_artifacts',
      runId,
      workUid: demo.ids.workUid,
      step: 'Upload artifacts',
      status: 'running',
      summary: 'Seller is packaging results, metrics, logs, receipt, and hashes.',
      createdAt: demo.updatedAt,
    })
  }
  if (gpuDemoAtLeast('completed')) {
    events.push({
      eventId: `${runId}-terminal`,
      type: 'terminal_report',
      runId,
      workUid: demo.ids.workUid,
      step: 'Terminal report',
      status: 'completed',
      summary: 'Artifact manifest, receipt, and cleanup evidence were returned to the buyer.',
      createdAt: demo.updatedAt,
    })
  }
  return events.slice(-6)
}

function gpuDemoTransactionBundle(demo = state.gpuDemo): DemoTransactionBundle {
  const bundle: DemoTransactionBundle = { orderPlans: [], approvals: [], tasks: [], payments: [], workRuns: [], workRunEvents: {} }
  if (!demo?.active || !gpuDemoAtLeast('seller_options')) return bundle
  const seller = selectedGpuDemoSeller(demo)
  const selected = Boolean(demo.selectedSellerId)
  const selectedOptionId = selected ? gpuDemoOptionId(seller, demo) : undefined
  const price = gpuDemoSelectedPrice(demo)
  const stage = demo.stage
  const hasTask = gpuDemoAtLeast('seller_accepted')
  const hasPayment = gpuDemoAtLeast('seller_accepted')
  const hasRun = gpuDemoAtLeast('paid')
  const options = GPU_DEMO_SELLERS.map((item): OrderDraftOption => ({
    optionId: gpuDemoOptionId(item, demo),
    resourceId: item.resourceId,
    providerPubkey: item.providerPubkey,
    score: item.score,
    reason: item.reason,
    quoteId: `${demo.ids.base}-quote-${item.id}`,
    realtimeStatus: selected && item.id === demo.selectedSellerId ? 'selected' : 'quoted',
    expiresAt: 'local demo',
    priceSnapshot: { pricePerUnit: item.price, billingUnit: 'job', currency: 'USDC', availability: item.eta },
    draft: {
      goal: demo.taskText,
      requirements: {
        type: gpuDemoTaskType(demo),
        minVramGb: item.vramGb,
        gpuModel: item.gpu,
        outputs: demo.answers.outputs,
      },
    },
  }))
  bundle.orderPlans?.push({
    planId: demo.ids.planId,
    query: 'GPU inference job demo',
    projectPath: demo.projectPath,
    workUid: demo.ids.workUid,
    requesterPubkey: 'gpu-demo-buyer-owner',
    status: selected ? 'selected' : 'pending_selection',
    agentId: 'external-mcp-gpu-demo-agent',
    selectedOptionId,
    taskId: hasTask ? demo.ids.taskId : undefined,
    approvalId: hasTask ? demo.ids.approvalId : undefined,
    paymentId: hasPayment ? demo.ids.paymentId : undefined,
    providerJobId: hasRun ? `${demo.ids.base}-provider-job` : undefined,
    normalizedQuery: { type: gpuDemoTaskType(demo), minVramGb: seller.vramGb, minGpuCount: 1, query: demo.answers.gpuProfile, region: seller.region },
    nextAction: gpuDemoNextAction(demo),
    createdAt: demo.startedAt,
    updatedAt: demo.updatedAt,
    expiresAt: 'local demo',
    options,
    candidates: GPU_DEMO_SELLERS.map((item) => ({
      optionId: gpuDemoOptionId(item, demo),
      resourceId: item.resourceId,
      providerPubkey: item.providerPubkey,
      status: selected && item.id === demo.selectedSellerId ? 'selected' : 'quoted',
      message: item.reason,
      quoteId: `${demo.ids.base}-quote-${item.id}`,
      priceAmount: item.price,
      currency: 'USDC',
      expiresAt: 'local demo',
      updatedAt: demo.updatedAt,
    })),
    events: gpuDemoPlanEvents(demo),
    orderState: gpuDemoOrderState(demo),
  })
  if (hasTask) {
    const taskStatus = gpuDemoTaskStatus(stage)
    bundle.approvals?.push({
      approvalId: demo.ids.approvalId,
      taskId: demo.ids.taskId,
      planId: demo.ids.planId,
      action: 'Authorize GPU job manifest and simulated payment',
      agentId: 'external-mcp-gpu-demo-agent',
      providerPubkey: seller.providerPubkey,
      amount: { value: price, currency: 'USDC' },
      quote: { priceAmount: price, currency: 'USDC', estimatedSeconds: etaMinutes(seller.eta) * 60, notes: seller.reason },
      fileScope: [{ name: 'gpu-eval-inputs.zip', sizeBytes: 2140000, contentType: 'application/zip' }],
      status: gpuDemoAtLeast('paid') ? 'approved' : 'pending',
      paymentRequired: true,
      riskSummary: 'Local demo only: no cloud match, no real chain payment, no real Docker or GPU execution.',
      createdAt: demo.updatedAt,
      expiresAt: 'local demo',
    })
    bundle.payments?.push({
      paymentId: demo.ids.paymentId,
      approvalId: demo.ids.approvalId,
      taskId: demo.ids.taskId,
      providerPubkey: seller.providerPubkey,
      amount: price,
      currency: 'USDC',
      mode: 'simulated_escrow',
      status: gpuDemoAtLeast('paid') ? 'confirmed_simulated' : 'pending_pin',
      proofRef: gpuDemoAtLeast('paid') ? `${demo.ids.base}-local-payment-proof` : 'waiting for demo PIN',
      createdAt: demo.updatedAt,
      updatedAt: demo.updatedAt,
      confirmedAt: gpuDemoAtLeast('paid') ? demo.updatedAt : undefined,
    })
    bundle.tasks?.push({
      id: demo.ids.taskId,
      orderId: demo.ids.orderId,
      projectPath: demo.projectPath,
      workUid: demo.ids.workUid,
      requesterPubkey: 'gpu-demo-buyer-owner',
      agentId: 'external-mcp-gpu-demo-agent',
      type: gpuDemoTaskType(demo),
      goal: demo.taskText,
      requirements: {
        gpu: demo.answers.gpuProfile,
        dataset: demo.answers.dataset,
        outputs: demo.answers.outputs,
        acceptance: 'Artifact files exist, hashes match, logs summarize runtime, and receipt records cleanup.',
      },
      inputFiles: [{ name: 'gpu-eval-inputs.zip', sizeBytes: 2140000, contentType: 'application/zip', sha256: `${demo.ids.base}-input-hash` }],
      budget: { maxAmount: Number(demo.answers.budget) || price, currency: 'USDC' },
      expectedOutputs: ['result.md', 'metrics.json', 'logs.txt', 'receipt.json'],
      status: taskStatus,
      providerPubkey: seller.providerPubkey,
      quote: {
        id: `${demo.ids.base}-quote-${seller.id}`,
        providerPubkey: seller.providerPubkey,
        priceAmount: price,
        currency: 'USDC',
        estimatedSeconds: etaMinutes(seller.eta) * 60,
        notes: seller.reason,
        createdAt: demo.updatedAt,
      },
      approvalRequestId: demo.ids.approvalId,
      artifacts: gpuDemoAtLeast('completed') ? [
        { name: 'result.md', contentType: 'text/markdown', sizeBytes: 18432, sha256: `${demo.ids.base}-result-hash` },
        { name: 'metrics.json', contentType: 'application/json', sizeBytes: 4096, sha256: `${demo.ids.base}-metrics-hash` },
        { name: 'logs.txt', contentType: 'text/plain', sizeBytes: 12288, sha256: `${demo.ids.base}-logs-hash` },
        { name: 'receipt.json', contentType: 'application/json', sizeBytes: 2048, sha256: `${demo.ids.base}-receipt-hash` },
      ] : undefined,
      artifactHashes: gpuDemoAtLeast('completed') ? {
        'result.md': `${demo.ids.base}-result-hash`,
        'metrics.json': `${demo.ids.base}-metrics-hash`,
        'logs.txt': `${demo.ids.base}-logs-hash`,
        'receipt.json': `${demo.ids.base}-receipt-hash`,
      } : undefined,
      createdAt: demo.updatedAt,
      updatedAt: demo.updatedAt,
      consentedAt: gpuDemoAtLeast('paid') ? demo.updatedAt : undefined,
      claimedAt: gpuDemoAtLeast('running') ? demo.updatedAt : undefined,
      completedAt: gpuDemoAtLeast('completed') ? demo.updatedAt : undefined,
    })
  }
  if (hasRun) {
    bundle.workRuns?.push({
      schemaVersion: 'gpu-demo.v1',
      runId: demo.ids.runId,
      workUid: demo.ids.workUid,
      projectPath: demo.projectPath,
      controller: 'seller-gpu-demo-agent',
      status: gpuDemoRunStatus(stage),
      currentStep: gpuDemoCurrentStep(stage),
      nextAction: gpuDemoNextAction(demo),
      intent: demo.taskText,
      summary: 'Local simulated GPU provider execution for the first MCP demo.',
      entities: {
        orderPlanId: demo.ids.planId,
        taskId: demo.ids.taskId,
        approvalId: demo.ids.approvalId,
        paymentId: demo.ids.paymentId,
        providerJobId: `${demo.ids.base}-provider-job`,
        workerId: `${demo.ids.base}-worker`,
      },
      activeWorker: gpuDemoAtLeast('completed') ? undefined : {
        workerId: `${demo.ids.base}-worker`,
        type: 'docker',
        status: gpuDemoRunStatus(stage),
        providerPubkey: seller.providerPubkey,
        jobId: `${demo.ids.base}-provider-job`,
        updatedAt: demo.updatedAt,
      },
      createdAt: demo.updatedAt,
      updatedAt: demo.updatedAt,
      completedAt: gpuDemoAtLeast('completed') ? demo.updatedAt : undefined,
    })
    bundle.workRunEvents = { [demo.ids.runId]: gpuDemoWorkRunEvents(demo) }
  }
  return bundle
}

function etaMinutes(value: string) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 45
}

function gpuDemoNextAction(demo: GpuDemoState) {
  switch (demo.stage) {
    case 'ready':
      return 'Copy the MCP prompt and send it to the external agent.'
    case 'thinking':
      return 'External agent is thinking through the task and preparing questions.'
    case 'questions':
      return 'Answer the buyer-agent questions.'
    case 'manifest_review':
      return 'Review the task checklist before sending it to matching.'
    case 'matching':
      return 'Local demo matching is preparing three seller options.'
    case 'seller_options':
      return 'Choose one seller option.'
    case 'seller_confirming':
      return 'Wait for seller confirmation.'
    case 'seller_accepted':
    case 'pin':
      return 'Enter demo payment PIN.'
    case 'paid':
    case 'queued':
      return 'Wait for provider job pickup.'
    case 'pulling_image':
      return 'Worker is preparing the CUDA image.'
    case 'running':
      return 'GPU job is running.'
    case 'uploading_artifacts':
      return 'Seller is packaging artifacts.'
    case 'completed':
      return 'Review result files and receipt.'
    default:
      return 'Start the GPU Job Demo.'
  }
}

function applyGpuDemoRecordsToState() {
  removeGpuDemoRecordsFromState()
  const demo = state.gpuDemo
  if (!demo?.active) return
  const bundle = gpuDemoTransactionBundle(demo)
  state.orderPlans = [...state.orderPlans, ...(bundle.orderPlans || [])]
  state.approvals = [...state.approvals, ...(bundle.approvals || [])]
  state.tasks = [...state.tasks, ...(bundle.tasks || [])]
  state.payments = [...state.payments, ...(bundle.payments || [])]
  state.workRuns = [...state.workRuns, ...(bundle.workRuns || [])]
  state.workRunEvents = {
    ...state.workRunEvents,
    ...(bundle.workRunEvents || {}),
  }
  syncGpuDemoChatThread()
}

function syncGpuDemoChatThread() {
  const demo = state.gpuDemo
  if (!demo?.chatId) return
  const thread = state.chatThreads.find((item) => item.id === demo.chatId)
  if (!thread) return
  thread.projectPath = demo.projectPath
  thread.status = demo.stage
  thread.orderId = gpuDemoAtLeast('seller_options') ? demo.ids.orderId : undefined
  thread.taskIds = gpuDemoAtLeast('seller_accepted') ? [demo.ids.taskId] : []
  thread.providerPubkey = demo.selectedSellerId ? selectedGpuDemoSeller(demo).providerPubkey : thread.providerPubkey
  thread.updatedAt = Date.now()
  state.selectedChatId = thread.id
  state.selectedWorkThreadId = workThreadIdForChat(thread)
}

type MvpDemoStage = 'intent' | 'plan' | 'offer' | 'authorize' | 'execute' | 'verify' | 'settlement'

type MvpDemoChatTurn = Pick<ChatMessage, 'kind' | 'role' | 'actor' | 'stageId' | 'text' | 'meta' | 'providerPubkey' | 'eventRef'>

type MvpDemoRunEventSpec = {
  type: string
  step?: string
  status?: string
  summary: string
  minuteOffset?: number
  data?: Record<string, unknown>
}

type MvpDemoSpec = {
  side: OrderSide
  slug: string
  title: string
  stage: MvpDemoStage
  status: string
  message: string
  planStatus?: string
  candidateStatus?: string
  selected?: boolean
  taskStatus?: string
  approvalStatus?: string
  paymentStatus?: string
  paymentConfirmed?: boolean
  runStatus?: string
  currentStep?: string
  orderState?: string
  owner?: string
  waitingFor?: string
  nextAction?: string
  amount?: number
  error?: string
  artifacts?: boolean
  messages?: MvpDemoChatTurn[]
  events?: MvpDemoRunEventSpec[]
}

const mvpBuyerDemoSpecs: MvpDemoSpec[] = [
  { side: 'buyer', slug: 'buyer-intent-draft', title: 'Draft GPU invoice OCR request', stage: 'intent', status: 'draft', message: 'I need scanned invoices converted into a CSV with totals and vendor names.' },
  { side: 'buyer', slug: 'buyer-plan-review', title: 'Review contract summary plan', stage: 'plan', status: 'manifest_review', message: 'The remote manifest is ready. Confirm files, output format, and disclosure boundary.', planStatus: 'manifest_review', runStatus: 'waiting_owner_choice', currentStep: 'review_remote_manifest', nextAction: 'Review manifest before matching sellers.' },
  { side: 'buyer', slug: 'buyer-offer-quoted', title: 'Choose benchmark seller offer', stage: 'offer', status: 'pending_selection', message: 'Two sellers returned quotes; the recommended option is ready for review.', planStatus: 'pending_selection', candidateStatus: 'quoted', runStatus: 'waiting_owner_choice', currentStep: 'quote_review', amount: 18, nextAction: 'Choose a seller offer.' },
  { side: 'buyer', slug: 'buyer-offer-negotiation', title: 'Clarify dataset size for quote', stage: 'offer', status: 'needs_negotiation', message: 'One seller needs the dataset row count before returning a final quote.', planStatus: 'pending_selection', candidateStatus: 'needs_negotiation', runStatus: 'waiting_owner_choice', currentStep: 'seller_valuation', amount: 24, nextAction: 'Answer seller clarification.' },
  { side: 'buyer', slug: 'buyer-authorize-approval', title: 'Approve compliance appendix scope', stage: 'authorize', status: 'pending_consent', message: 'Approve file disclosure, sensitive action boundaries, and seller quote.', planStatus: 'selected', selected: true, taskStatus: 'pending_consent', approvalStatus: 'pending', amount: 35, nextAction: 'Approve scope and file release.' },
  { side: 'buyer', slug: 'buyer-authorize-escrow', title: 'Confirm escrow for policy rewrite', stage: 'authorize', status: 'pending_pin', message: 'Scope is approved. Escrow is waiting for payment PIN confirmation.', planStatus: 'selected', selected: true, taskStatus: 'pending_consent', approvalStatus: 'approved', paymentStatus: 'pending_pin', amount: 42, nextAction: 'Enter payment PIN.' },
  { side: 'buyer', slug: 'buyer-execute-queued', title: 'Queued report packaging job', stage: 'execute', status: 'queued', message: 'Inputs are transferred and the provider job is queued.', planStatus: 'selected', selected: true, taskStatus: 'consented', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'queued', currentStep: 'submit_worker_job', amount: 14, nextAction: 'Wait for provider to start.' },
  { side: 'buyer', slug: 'buyer-execute-running', title: 'Running Docker data transform', stage: 'execute', status: 'running', message: 'Provider Docker is running and sending checkpoints.', planStatus: 'selected', selected: true, taskStatus: 'running', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'running', currentStep: 'provider_execution', amount: 28, nextAction: 'Track execution checkpoint.' },
  { side: 'buyer', slug: 'buyer-verify-completed', title: 'Verify delivered research brief', stage: 'verify', status: 'completed', message: 'Artifacts, receipt, and hashes are ready for acceptance.', planStatus: 'selected', selected: true, taskStatus: 'completed', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'completed', currentStep: 'buyer_verification', amount: 12, artifacts: true, nextAction: 'Verify artifacts and close.' },
  { side: 'buyer', slug: 'buyer-verify-dispute', title: 'Review failed website audit', stage: 'verify', status: 'failed', message: 'Execution failed. Review logs and decide whether to request repair or dispute.', planStatus: 'selected', selected: true, taskStatus: 'failed', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'failed', currentStep: 'settlement_or_dispute', amount: 16, error: 'Provider returned incomplete audit evidence.', nextAction: 'Review failure evidence.' },
  { side: 'buyer', slug: 'buyer-legal-clause-extraction', title: 'Extract indemnity clauses from vendor MSAs', stage: 'plan', status: 'manifest_review', message: 'Plan requires clause labels, source page numbers, and a no-retention file boundary before sellers can quote.', planStatus: 'manifest_review', runStatus: 'waiting_owner_choice', currentStep: 'review_remote_manifest', nextAction: 'Confirm legal file disclosure boundary.' },
  { side: 'buyer', slug: 'buyer-spreadsheet-cleanup-offer', title: 'Clean CRM spreadsheet duplicates', stage: 'offer', status: 'pending_selection', message: 'Cloud matching returned sellers that can normalize contacts and produce a change log.', planStatus: 'pending_selection', candidateStatus: 'quoted', runStatus: 'waiting_owner_choice', currentStep: 'quote_review', amount: 11, nextAction: 'Review seller price and output format.' },
  { side: 'buyer', slug: 'buyer-api-smoke-test-authorize', title: 'Authorize API smoke test report', stage: 'authorize', status: 'pending_consent', message: 'Buyer approval is required before endpoint metadata is disclosed to the seller.', planStatus: 'selected', selected: true, taskStatus: 'pending_consent', approvalStatus: 'pending', amount: 8, nextAction: 'Approve endpoint disclosure and test scope.' },
  { side: 'buyer', slug: 'buyer-design-qa-running', title: 'Run design QA on settings flow', stage: 'execute', status: 'running', message: 'Seller Docker is checking screenshot diffs and producing a compact QA report.', planStatus: 'selected', selected: true, taskStatus: 'running', approvalStatus: 'approved', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'running', currentStep: 'provider_execution', amount: 22, nextAction: 'Wait for screenshot checkpoint.' },
  { side: 'buyer', slug: 'buyer-dataset-normalization-queued', title: 'Normalize supplier dataset schema', stage: 'execute', status: 'queued', message: 'Escrow proof is confirmed and the provider job is queued behind one active worker.', planStatus: 'selected', selected: true, taskStatus: 'consented', approvalStatus: 'approved', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'queued', currentStep: 'submit_worker_job', amount: 31, nextAction: 'Wait for worker pickup.' },
  { side: 'buyer', slug: 'buyer-contract-risk-scan-offer', title: 'Compare contract risk across three drafts', stage: 'offer', status: 'needs_negotiation', message: 'Seller needs confirmation that redlines are advisory only before quoting.', planStatus: 'pending_selection', candidateStatus: 'needs_negotiation', runStatus: 'waiting_owner_choice', currentStep: 'seller_valuation', amount: 27, nextAction: 'Answer advisory-use clarification.' },
  { side: 'buyer', slug: 'buyer-pdf-table-extraction-completed', title: 'Verify PDF table extraction artifacts', stage: 'verify', status: 'completed', message: 'CSV, extraction notes, receipt, and hashes are available for buyer verification.', planStatus: 'selected', selected: true, taskStatus: 'completed', approvalStatus: 'approved', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'completed', currentStep: 'verify_artifacts', amount: 18, artifacts: true, nextAction: 'Accept or request fixes.' },
  { side: 'buyer', slug: 'buyer-repo-test-triage-plan', title: 'Plan repo test failure triage', stage: 'plan', status: 'manifest_review', message: 'Manifest limits seller access to logs, failing test names, and a patch suggestion only.', planStatus: 'manifest_review', runStatus: 'waiting_owner_choice', currentStep: 'write_plan_files', nextAction: 'Review repository disclosure scope.' },
  { side: 'buyer', slug: 'buyer-artifact-verification-closed', title: 'Closed artifact verification bundle', stage: 'verify', status: 'closed', message: 'Buyer accepted artifacts; receipt, proof reference, and cleanup record are closed.', planStatus: 'closed', selected: true, taskStatus: 'completed', approvalStatus: 'approved', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'completed', currentStep: 'closed', orderState: 'closed', amount: 20, artifacts: true, nextAction: 'No action required.' },
  { side: 'buyer', slug: 'buyer-repair-dispute-review', title: 'Review repair request for failed extraction', stage: 'verify', status: 'failed', message: 'Terminal report shows missing rows; buyer can request repair or keep dispute review open.', planStatus: 'selected', selected: true, taskStatus: 'failed', approvalStatus: 'approved', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'failed', currentStep: 'settlement_or_dispute', amount: 13, error: 'Artifact row count did not match manifest acceptance criteria.', nextAction: 'Choose repair or dispute.' },
]

const mvpSellerDemoSpecs: MvpDemoSpec[] = [
  { side: 'seller', slug: 'seller-valuation-new', title: 'Incoming OCR valuation', stage: 'offer', status: 'seller_valuation', message: 'New buyer manifest received for invoice OCR.', planStatus: 'pending_selection', candidateStatus: 'pending', runStatus: 'running', currentStep: 'seller_valuation', orderState: 'seller_valuation', nextAction: 'Evaluate manifest.' },
  { side: 'seller', slug: 'seller-valuation-clarify', title: 'Need dataset row count', stage: 'offer', status: 'needs_negotiation', message: 'Ask buyer for row count before a safe quote.', planStatus: 'pending_selection', candidateStatus: 'needs_negotiation', runStatus: 'running', currentStep: 'seller_valuation', orderState: 'seller_valuation', nextAction: 'Request missing row count.' },
  { side: 'seller', slug: 'seller-quote-accept', title: 'Quote API smoke test', stage: 'offer', status: 'quoted', message: 'Seller can accept and returned a quote.', planStatus: 'pending_selection', candidateStatus: 'quoted', runStatus: 'completed', currentStep: 'seller_valuation_response', orderState: 'quote_review', amount: 9, nextAction: 'Wait for buyer selection.' },
  { side: 'seller', slug: 'seller-quote-reject', title: 'Reject unsafe browser automation', stage: 'offer', status: 'rejected', message: 'Rejected because the manifest requested irreversible external writes.', planStatus: 'pending_selection', candidateStatus: 'rejected', runStatus: 'completed', currentStep: 'seller_valuation_response', orderState: 'quote_review', error: 'Unsafe external write policy.', nextAction: 'No seller action.' },
  { side: 'seller', slug: 'seller-wait-buyer', title: 'Wait for buyer approval', stage: 'authorize', status: 'pending_consent', message: 'Buyer selected this seller; approval and escrow are pending.', planStatus: 'selected', selected: true, taskStatus: 'pending_consent', approvalStatus: 'pending', paymentStatus: 'created', amount: 21, nextAction: 'Wait for buyer authorization.' },
  { side: 'seller', slug: 'seller-execution-plan', title: 'Prepare execution plan', stage: 'execute', status: 'execution_plan', message: 'Inputs arrived and the Docker execution plan is ready.', planStatus: 'selected', selected: true, taskStatus: 'consented', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'queued', currentStep: 'input_transfer', amount: 19, nextAction: 'Commit execution plan.' },
  { side: 'seller', slug: 'seller-provider-running', title: 'Run provider Docker job', stage: 'execute', status: 'running', message: 'Provider Docker is running the approved job.', planStatus: 'selected', selected: true, taskStatus: 'running', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'running', currentStep: 'provider_execution', amount: 30, nextAction: 'Wait for terminal report.' },
  { side: 'seller', slug: 'seller-supervisor-blocked', title: 'Supervisor waiting for worker', stage: 'execute', status: 'blocked', message: 'Local supervisor detected a blocked worker heartbeat.', planStatus: 'selected', selected: true, taskStatus: 'running', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'waiting_worker', currentStep: 'poll_worker_job', amount: 17, error: 'Worker heartbeat delayed.', nextAction: 'Recover worker or report blocked state.' },
  { side: 'seller', slug: 'seller-terminal-report', title: 'Terminal report submitted', stage: 'verify', status: 'completed', message: 'Terminal report and artifacts were returned to the buyer.', planStatus: 'selected', selected: true, taskStatus: 'completed', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'completed', currentStep: 'terminal_report', amount: 26, artifacts: true, nextAction: 'Wait for buyer verification.' },
  { side: 'seller', slug: 'seller-settlement-closed', title: 'Settlement closed with cleanup', stage: 'settlement', status: 'closed', message: 'Buyer accepted delivery; settlement and cleanup receipt are closed.', planStatus: 'closed', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'completed', currentStep: 'closed', orderState: 'closed', amount: 16, nextAction: 'No action required.' },
  { side: 'seller', slug: 'seller-can-accept-legal-extract', title: 'Can accept legal clause extraction', stage: 'offer', status: 'quoted', message: 'Seller can extract clauses with page references and no document retention.', planStatus: 'pending_selection', candidateStatus: 'quoted', runStatus: 'completed', currentStep: 'seller_valuation_response', orderState: 'quote_review', amount: 29, nextAction: 'Wait for buyer selection.' },
  { side: 'seller', slug: 'seller-clarify-spreadsheet-columns', title: 'Clarify spreadsheet required columns', stage: 'offer', status: 'needs_negotiation', message: 'Seller needs the buyer to confirm whether phone normalization is in scope.', planStatus: 'pending_selection', candidateStatus: 'needs_negotiation', runStatus: 'running', currentStep: 'seller_valuation', orderState: 'seller_valuation', nextAction: 'Send clarification request.' },
  { side: 'seller', slug: 'seller-reject-credentialed-browser', title: 'Reject credentialed browser request', stage: 'offer', status: 'rejected', message: 'Seller rejected the request because it required logging into a third-party account.', planStatus: 'pending_selection', candidateStatus: 'rejected', runStatus: 'completed', currentStep: 'seller_valuation_response', orderState: 'quote_review', error: 'Credentialed browser action is outside seller policy.', nextAction: 'No seller action.' },
  { side: 'seller', slug: 'seller-quote-design-qa', title: 'Quote design QA screenshot review', stage: 'offer', status: 'quoted', message: 'Seller returned a fixed quote for screenshot diff review and concise UX notes.', planStatus: 'pending_selection', candidateStatus: 'quoted', runStatus: 'completed', currentStep: 'seller_valuation_response', orderState: 'quote_review', amount: 22, nextAction: 'Wait for buyer choice.' },
  { side: 'seller', slug: 'seller-wait-escrow-dataset', title: 'Wait for dataset escrow proof', stage: 'authorize', status: 'pending_payment', message: 'Buyer selected this seller; escrow proof has not arrived yet.', planStatus: 'selected', selected: true, taskStatus: 'pending_consent', approvalStatus: 'approved', paymentStatus: 'created', amount: 31, nextAction: 'Wait for escrow evidence.' },
  { side: 'seller', slug: 'seller-input-receipt-repo-triage', title: 'Input receipt for repo test triage', stage: 'execute', status: 'execution_plan', message: 'Inputs were received with hash receipts; seller is preparing a Docker-bounded plan.', planStatus: 'selected', selected: true, taskStatus: 'consented', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'queued', currentStep: 'input_transfer', amount: 15, nextAction: 'Commit execution plan hash.' },
  { side: 'seller', slug: 'seller-docker-running-pdf-tables', title: 'Docker running PDF table extraction', stage: 'execute', status: 'running', message: 'Local supervisor is tracking Docker checkpoints for the extraction job.', planStatus: 'selected', selected: true, taskStatus: 'running', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'running', currentStep: 'provider_execution', amount: 18, nextAction: 'Send next checkpoint.' },
  { side: 'seller', slug: 'seller-blocked-heartbeat-contract-risk', title: 'Blocked heartbeat on contract risk scan', stage: 'execute', status: 'blocked', message: 'Worker heartbeat is delayed; supervisor will retry without changing buyer inputs.', planStatus: 'selected', selected: true, taskStatus: 'running', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'waiting_worker', currentStep: 'poll_worker_job', amount: 27, error: 'Heartbeat missed the local supervisor window.', nextAction: 'Retry worker heartbeat.' },
  { side: 'seller', slug: 'seller-terminal-report-api-smoke', title: 'Terminal report for API smoke test', stage: 'verify', status: 'completed', message: 'Seller submitted terminal report, request log summary, and receipt hash.', planStatus: 'selected', selected: true, taskStatus: 'completed', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'completed', currentStep: 'terminal_report', amount: 8, artifacts: true, nextAction: 'Wait for buyer verification.' },
  { side: 'seller', slug: 'seller-cleanup-receipt-closed', title: 'Cleanup receipt after accepted delivery', stage: 'settlement', status: 'closed', message: 'Delivery was accepted; local cleanup receipt and simulated payout proof are closed.', planStatus: 'closed', paymentStatus: 'confirmed_simulated', paymentConfirmed: true, runStatus: 'completed', currentStep: 'closed', orderState: 'closed', amount: 20, artifacts: true, nextAction: 'No action required.' },
]

function mvpDemoTransactionBundle(): DemoTransactionBundle {
  const projectPath = defaultWorkProjectPath()
  const localProvider = state.sellerMarketStatus?.providerId || state.sellerSettings?.providerId || 'local-dev-miner'
  const bundle: DemoTransactionBundle = { conversations: [], orderPlans: [], approvals: [], tasks: [], payments: [], workRuns: [], workRunEvents: {} }
  for (const [index, spec] of [...mvpBuyerDemoSpecs, ...mvpSellerDemoSpecs].entries()) {
    addMvpDemoSpec(bundle, spec, index, projectPath, localProvider)
  }
  return bundle
}

function addMvpDemoSpec(bundle: DemoTransactionBundle, spec: MvpDemoSpec, index: number, projectPath: string, localProvider: string) {
  const createdAt = mvpDemoTimestamp(index, 0)
  const updatedAt = mvpDemoTimestamp(index, 24)
  const createdMs = Date.parse(createdAt)
  const updatedMs = Date.parse(updatedAt)
  const provider = spec.side === 'seller' ? localProvider : `seller-mvp-demo-${index + 1}`
  const requester = spec.side === 'buyer' ? 'mvp-demo-buyer-owner' : `buyer-mvp-demo-${index + 1}`
  const workUid = `mvp-demo-work-${spec.slug}`
  const planId = `mvp-demo-plan-${spec.slug}`
  const orderId = `mvp-demo-order-${spec.slug}`
  const taskId = `mvp-demo-task-${spec.slug}`
  const approvalId = `mvp-demo-approval-${spec.slug}`
  const paymentId = `mvp-demo-payment-${spec.slug}`
  const runId = `mvp-demo-run-${spec.slug}`
  const hasPlan = spec.stage !== 'intent'
  const hasTask = Boolean(spec.taskStatus)
  const hasApproval = Boolean(spec.approvalStatus)
  const hasPayment = Boolean(spec.paymentStatus)
  const hasRun = Boolean(spec.runStatus || spec.currentStep)
  const conversationOrderId = hasTask ? orderId : hasPlan ? planId : undefined
  const participants = mvpDemoParticipants(spec)
  const messages = mvpDemoChatMessages(spec, provider, { planId, orderId, taskId, approvalId, paymentId }, hasPlan, hasTask, hasApproval, hasPayment, hasRun)

  bundle.conversations?.push({
    storageKey: `mvp-demo:${spec.slug}`,
    thread: {
      id: `mvp-demo-chat-${spec.slug}`,
      side: spec.side,
      title: spec.title,
      messages,
      createdAt: createdMs,
      updatedAt: updatedMs,
      projectPath,
      orderId: conversationOrderId,
      taskIds: hasTask ? [taskId] : [],
      status: spec.status,
      providerPubkey: provider,
      participants,
    },
  })

  if (hasPlan) {
    const optionId = `mvp-demo-option-${spec.slug}`
    const candidateStatus = spec.candidateStatus || (spec.selected ? 'quoted' : 'pending')
    bundle.orderPlans?.push({
      planId,
      query: spec.title,
      projectPath,
      workUid,
      requesterPubkey: requester,
      status: spec.planStatus || (spec.selected ? 'selected' : 'pending_selection'),
      agentId: `${spec.side}-agent-mvp-demo`,
      selectedOptionId: spec.selected ? optionId : undefined,
      taskId: hasTask ? taskId : undefined,
      approvalId: hasApproval ? approvalId : undefined,
      paymentId: hasPayment ? paymentId : undefined,
      providerJobId: hasRun ? `mvp-demo-job-${spec.slug}` : undefined,
      normalizedQuery: { type: spec.side === 'seller' ? 'seller_mvp_demo' : 'buyer_mvp_demo', query: spec.title },
      nextAction: spec.nextAction,
      createdAt,
      updatedAt,
      options: candidateStatus !== 'pending' || spec.selected
        ? [{
          optionId,
          resourceId: `mvp-demo-resource-${spec.slug}`,
          providerPubkey: provider,
          score: candidateStatus === 'rejected' ? 42 : 86,
          reason: spec.error || spec.message,
          quoteId: `mvp-demo-quote-${spec.slug}`,
          realtimeStatus: candidateStatus,
          priceSnapshot: spec.amount ? { pricePerUnit: spec.amount, billingUnit: 'job', currency: 'USDC', availability: spec.status } : undefined,
          draft: { goal: spec.title },
        }]
        : [],
      candidates: [{
        optionId,
        resourceId: `mvp-demo-resource-${spec.slug}`,
        providerPubkey: provider,
        status: candidateStatus,
        message: spec.error || spec.message,
        quoteId: spec.amount ? `mvp-demo-quote-${spec.slug}` : undefined,
        priceAmount: spec.amount,
        currency: spec.amount ? 'USDC' : undefined,
        updatedAt,
      }],
      events: mvpDemoPlanEvents(spec, index, createdAt, updatedAt),
      orderState: spec.orderState
        ? {
          planId,
          orderId,
          taskId: hasTask ? taskId : undefined,
          state: spec.orderState,
          owner: spec.owner || (spec.side === 'seller' ? 'seller_agent' : 'buyer_agent'),
          waitingFor: spec.waitingFor || (spec.orderState === 'closed' ? 'none' : 'local_agent'),
          terminalReason: spec.error,
          updatedAt,
        }
        : undefined,
    })
  }

  if (hasApproval) {
    bundle.approvals?.push({
      approvalId,
      taskId,
      planId,
      action: `Authorize ${spec.title}`,
      agentId: `${spec.side}-agent-mvp-demo`,
      providerPubkey: provider,
      amount: spec.amount ? { value: spec.amount, currency: 'USDC' } : undefined,
      quote: spec.amount ? { priceAmount: spec.amount, currency: 'USDC', estimatedSeconds: 900, notes: spec.message } : undefined,
      fileScope: [{ name: `${spec.slug}-inputs.zip`, sizeBytes: 2048000, contentType: 'application/zip' }],
      status: spec.approvalStatus || 'pending',
      paymentRequired: true,
      riskSummary: spec.error || 'MVP demo approval boundary: no external execution before buyer authorization.',
      createdAt,
      expiresAt: mvpDemoTimestamp(index, 180),
    })
  }

  if (hasPayment) {
    bundle.payments?.push({
      paymentId,
      approvalId: hasApproval ? approvalId : undefined,
      taskId: hasTask ? taskId : spec.orderState === 'closed' ? planId : undefined,
      providerPubkey: provider,
      amount: spec.amount || 0,
      currency: 'USDC',
      mode: 'simulated_escrow',
      status: spec.paymentStatus,
      proofRef: spec.paymentConfirmed ? `mvp-demo-proof-${spec.slug}` : 'waiting for buyer confirmation',
      createdAt,
      updatedAt,
      confirmedAt: spec.paymentConfirmed ? updatedAt : undefined,
    })
  }

  if (hasTask) {
    bundle.tasks?.push({
      id: taskId,
      orderId,
      projectPath,
      workUid,
      requesterPubkey: requester,
      agentId: `${spec.side}-agent-mvp-demo`,
      type: spec.side === 'seller' ? 'seller_mvp_demo' : 'buyer_mvp_demo',
      goal: spec.title,
      requirements: { goal: spec.title, boundary: 'MVP demo data only', expected: spec.message },
      inputFiles: [{ name: `${spec.slug}-input.txt`, sizeBytes: 4096, contentType: 'text/plain', sha256: `mvp-demo-input-${spec.slug}` }],
      budget: spec.amount ? { maxAmount: spec.amount, currency: 'USDC' } : undefined,
      expectedOutputs: ['result.md', 'receipt.json'],
      status: spec.taskStatus || 'pending_consent',
      providerPubkey: provider,
      quote: spec.amount ? {
        id: `mvp-demo-quote-${spec.slug}`,
        providerPubkey: provider,
        priceAmount: spec.amount,
        currency: 'USDC',
        estimatedSeconds: 900,
        notes: spec.message,
        createdAt,
      } : undefined,
      approvalRequestId: hasApproval ? approvalId : undefined,
      artifacts: spec.artifacts ? [
        { name: 'result.md', contentType: 'text/markdown', sizeBytes: 18000, sha256: `mvp-demo-result-hash-${spec.slug}` },
        { name: 'receipt.json', contentType: 'application/json', sizeBytes: 1400, sha256: `mvp-demo-receipt-hash-${spec.slug}` },
      ] : undefined,
      artifactHashes: spec.artifacts ? {
        'result.md': `mvp-demo-result-hash-${spec.slug}`,
        'receipt.json': `mvp-demo-receipt-hash-${spec.slug}`,
      } : undefined,
      error: spec.error,
      createdAt,
      updatedAt,
      consentedAt: ['consented', 'claimed', 'running', 'completed', 'failed'].includes(spec.taskStatus || '') ? mvpDemoTimestamp(index, 8) : undefined,
      claimedAt: ['claimed', 'running', 'completed', 'failed'].includes(spec.taskStatus || '') ? mvpDemoTimestamp(index, 12) : undefined,
      completedAt: ['completed', 'failed'].includes(spec.taskStatus || '') ? updatedAt : undefined,
    })
  }

  if (hasRun) {
    bundle.workRuns?.push({
      schemaVersion: 'mvp-demo.v1',
      runId,
      workUid,
      projectPath,
      controller: spec.side === 'seller' ? 'seller-agent-mvp-demo' : 'buyer-agent-mvp-demo',
      status: spec.runStatus,
      currentStep: spec.currentStep,
      nextAction: spec.nextAction,
      intent: spec.title,
      summary: spec.message,
      error: spec.error,
      entities: {
        orderPlanId: hasPlan ? planId : undefined,
        taskId: hasTask ? taskId : undefined,
        approvalId: hasApproval ? approvalId : undefined,
        paymentId: hasPayment ? paymentId : undefined,
        providerJobId: `mvp-demo-job-${spec.slug}`,
        workerId: `mvp-demo-worker-${spec.slug}`,
      },
      activeWorker: spec.currentStep?.includes('provider') || spec.currentStep === 'poll_worker_job'
        ? { workerId: `mvp-demo-worker-${spec.slug}`, type: 'docker', status: spec.runStatus, providerPubkey: provider, jobId: `mvp-demo-job-${spec.slug}`, updatedAt }
        : undefined,
      createdAt,
      updatedAt,
      completedAt: spec.runStatus === 'completed' || spec.runStatus === 'failed' ? updatedAt : undefined,
    })
    bundle.workRunEvents = bundle.workRunEvents || {}
    bundle.workRunEvents[runId] = mvpDemoWorkRunEvents(spec, runId, index, updatedAt)
  }
}

function mvpDemoChatMessages(
  spec: MvpDemoSpec,
  provider: string,
  refs: { planId: string; orderId: string; taskId: string; approvalId: string; paymentId: string },
  hasPlan: boolean,
  hasTask: boolean,
  hasApproval: boolean,
  hasPayment: boolean,
  hasRun: boolean,
): ChatMessage[] {
  const eventRef: ChatMessage['eventRef'] | undefined = hasTask
    ? { taskId: refs.taskId, orderId: refs.orderId }
    : hasApproval
      ? { approvalId: refs.approvalId }
      : hasPayment
        ? { paymentId: refs.paymentId }
        : hasPlan
          ? { orderId: refs.planId }
          : undefined
  const turns = spec.messages?.length
    ? spec.messages
    : defaultMvpDemoChatTurns(spec, provider, hasPlan, hasTask, hasApproval, hasPayment, hasRun)
  return turns.slice(0, 16).map((turn, index) => ({
    id: `mvp-demo-msg-${spec.slug}-${index + 1}`,
    kind: turn.kind || (spec.side === 'seller' && index === 0 ? 'order_event' : 'message'),
    role: turn.role,
    actor: turn.actor,
    stageId: normalizeDemoMessageStageId(spec.side, turn.stageId || mvpDemoVisibleStageId(spec)),
    text: turn.text,
    meta: turn.meta,
    providerPubkey: turn.providerPubkey || (turn.actor === 'seller_agent' ? provider : undefined),
    eventRef: turn.eventRef || eventRef,
  }))
}

function defaultMvpDemoChatTurns(
  spec: MvpDemoSpec,
  provider: string,
  hasPlan: boolean,
  hasTask: boolean,
  hasApproval: boolean,
  hasPayment: boolean,
  hasRun: boolean,
): MvpDemoChatTurn[] {
  const turns = spec.side === 'seller'
    ? defaultMvpSellerDemoChatTurns(spec, provider, hasTask, hasApproval, hasPayment, hasRun)
    : defaultMvpBuyerDemoChatTurns(spec, provider, hasPlan, hasApproval, hasPayment, hasRun)
  return normalizeMvpDemoTurnCount(spec, turns)
}

const mvpBuyerStageOrder: BuyerTransactionStageId[] = ['intent', 'plan', 'offer', 'authorize', 'execute', 'verify']
const mvpSellerStageOrder: SellerTransactionStageId[] = ['task_valuation', 'quote_response', 'wait_buyer', 'execution_plan', 'provider_execution', 'local_supervisor', 'terminal_report', 'settlement']

function mvpDemoParticipants(spec: MvpDemoSpec): ChatThread['participants'] {
  const participants: NonNullable<ChatThread['participants']> = spec.side === 'seller'
    ? ['buyer_agent', 'seller_agent']
    : ['buyer_human', 'buyer_agent', 'seller_agent']
  if (spec.side === 'seller' && (spec.selected || spec.approvalStatus || spec.paymentStatus || spec.taskStatus || spec.orderState === 'closed')) participants.push('buyer_human')
  if (spec.side === 'seller' || spec.error || spec.candidateStatus === 'rejected' || spec.status === 'blocked') participants.push('seller_human')
  return Array.from(new Set(participants)) as ChatThread['participants']
}

function mvpReachedBuyerStage(spec: MvpDemoSpec, stageId: BuyerTransactionStageId) {
  const current = normalizeDemoMessageStageId('buyer', mvpDemoVisibleStageId(spec)) as BuyerTransactionStageId
  return mvpBuyerStageOrder.indexOf(stageId) <= Math.max(0, mvpBuyerStageOrder.indexOf(current))
}

function mvpReachedSellerStage(spec: MvpDemoSpec, stageId: SellerTransactionStageId) {
  const current = normalizeDemoMessageStageId('seller', mvpDemoVisibleStageId(spec)) as SellerTransactionStageId
  return mvpSellerStageOrder.indexOf(stageId) <= Math.max(0, mvpSellerStageOrder.indexOf(current))
}

function defaultMvpBuyerDemoChatTurns(
  spec: MvpDemoSpec,
  provider: string,
  hasPlan: boolean,
  hasApproval: boolean,
  hasPayment: boolean,
  hasRun: boolean,
): MvpDemoChatTurn[] {
  const turns: MvpDemoChatTurn[] = [
    mvpDemoTurn('user', 'buyer_human', 'intent', 'Buyer request', `I need help with "${spec.title}". ${spec.message}`),
    mvpDemoTurn('assistant', 'buyer_agent', 'intent', 'Intent classification', 'I am treating this as a candidate Exora transaction, not local execution. I will keep a draft until requirements, budget, output format, and acceptance checks are explicit.'),
    mvpDemoTurn('user', 'buyer_human', 'intent', 'Human boundary', 'Do not disclose files, contact sellers, or spend funds until the transaction scope is reviewable.'),
    mvpDemoTurn('assistant', 'buyer_agent', 'intent', 'Draft checkpoint', `Current visible state is ${progressStateLabel(spec.status)}. ${spec.nextAction || 'I am waiting for enough information to form the remote manifest.'}`),
  ]

  if (hasPlan && mvpReachedBuyerStage(spec, 'plan')) {
    turns.push(
      mvpDemoTurn('assistant', 'buyer_agent', 'plan', 'Remote manifest', `I drafted a remote manifest for ${spec.title}: inputs are bounded, expected outputs are result.md and receipt.json, and sellers cannot execute before authorization.`),
      mvpDemoTurn('assistant', 'buyer_agent', 'plan', 'Agent requirements', 'The requested seller capability is derived from the task, not from a free-form chat promise. The manifest asks for quoteable scope, evidence format, hashable artifacts, and retention limits.'),
    )
    if (spec.status === 'manifest_review' || spec.currentStep === 'review_remote_manifest' || spec.currentStep === 'write_plan_files') {
      turns.push(mvpDemoTurn('user', 'buyer_human', 'plan', 'Manifest review', 'Keep the disclosure narrow and make the seller return page, row, file, or log references where applicable.'))
    }
  }

  if (mvpReachedBuyerStage(spec, 'offer')) {
    turns.push(
      mvpDemoTurn('assistant', 'seller_agent', 'offer', 'Seller valuation', mvpDemoQuoteResponseText(spec, provider)),
      mvpDemoTurn('assistant', 'buyer_agent', 'offer', 'Offer review', mvpDemoBuyerOfferReviewText(spec, provider)),
    )
    if (spec.candidateStatus === 'needs_negotiation') {
      turns.push(
        mvpDemoTurn('user', 'buyer_human', 'offer', 'Clarification', `Answer the seller clarification without expanding the scope: ${spec.nextAction || spec.message}`),
        mvpDemoTurn('assistant', 'buyer_agent', 'offer', 'Negotiation relay', 'I will relay only the missing quote-affecting fact, then keep the buyer decision at Offer until a safe quote returns.'),
      )
    } else if (spec.candidateStatus === 'rejected') {
      turns.push(mvpDemoTurn('assistant', 'buyer_agent', 'offer', 'Rejected seller', `I am keeping the rejected seller as evidence only. Reason: ${spec.error || spec.message}`))
    } else if (spec.amount) {
      turns.push(mvpDemoTurn('user', 'buyer_human', 'offer', 'Offer preference', `Use the bounded ${spec.amount} USDC offer if the approval screen keeps file disclosure and deliverables unchanged.`))
    }
  }

  if (hasApproval && mvpReachedBuyerStage(spec, 'authorize')) {
    turns.push(
      mvpDemoTurn('assistant', 'buyer_agent', 'authorize', 'Approval request', `I created an approval request for seller ${shortID(provider)}. It separates file disclosure, sensitive actions, external writes, and payment consent.`),
      mvpDemoTurn('assistant', 'seller_agent', 'authorize', 'Seller waiting', 'I will not start provider execution until the buyer approval and escrow/payment evidence are both visible to the transaction state.'),
    )
    turns.push(spec.approvalStatus === 'pending'
      ? mvpDemoTurn('user', 'buyer_human', 'authorize', 'Human decision pending', 'Show the manifest, file scope, and price before I approve this transaction.')
      : mvpDemoTurn('user', 'buyer_human', 'authorize', 'Human approval', 'The scope is acceptable for this demo record. Keep execution blocked until payment evidence is recorded.'))
  }

  if (hasPayment && mvpReachedBuyerStage(spec, 'authorize')) {
    turns.push(mvpDemoTurn('assistant', 'buyer_agent', 'authorize', 'Escrow boundary', spec.paymentConfirmed
      ? 'Simulated escrow proof is linked to this order. This is local MVP evidence only and does not call real chain payment.'
      : 'Payment intent exists, but execution remains blocked until the owner completes PIN/escrow confirmation.'))
  }

  if (hasRun && mvpReachedBuyerStage(spec, 'execute')) {
    turns.push(
      mvpDemoTurn('assistant', 'buyer_agent', 'execute', 'Input transfer', 'Authorized inputs are transferred as structured transaction inputs. I am tracking business checkpoints, not raw provider-local heartbeat noise.'),
      mvpDemoTurn('assistant', 'seller_agent', 'execute', 'Docker checkpoint', mvpDemoExecutionText(spec)),
    )
  }

  if (mvpReachedBuyerStage(spec, 'verify')) {
    if (spec.error || spec.taskStatus === 'failed') {
      turns.push(
        mvpDemoTurn('assistant', 'seller_agent', 'verify', 'Failure report', `The terminal report is failed and includes bounded evidence: ${spec.error || spec.message}`),
        mvpDemoTurn('assistant', 'buyer_agent', 'verify', 'Buyer verification', 'I will keep settlement paused and ask the human whether to request repair, open dispute review, or mark the failed delivery as accepted evidence.'),
        mvpDemoTurn('user', 'buyer_human', 'verify', 'Human review', 'Do not release funds yet. Keep this in repair or dispute review until the missing evidence is resolved.'),
      )
    } else {
      turns.push(
        mvpDemoTurn('assistant', 'seller_agent', 'verify', 'Terminal report', 'I submitted artifact metadata, receipt.json, hashes, environment summary, and cleanup-retention notes for buyer verification.'),
        mvpDemoTurn('assistant', 'buyer_agent', 'verify', 'Verification review', 'Artifacts and hashes are ready for inspection. If the user accepts, settlement can close against this local MVP receipt record.'),
      )
      if (spec.orderState === 'closed') turns.push(mvpDemoTurn('user', 'buyer_human', 'verify', 'Human acceptance', 'I accept the delivered artifacts for this demo record and allow the transaction to close.'))
    }
  }

  return turns
}

function defaultMvpSellerDemoChatTurns(
  spec: MvpDemoSpec,
  provider: string,
  hasTask: boolean,
  hasApproval: boolean,
  hasPayment: boolean,
  hasRun: boolean,
): MvpDemoChatTurn[] {
  const turns: MvpDemoChatTurn[] = [
    mvpDemoTurn('system', 'seller_agent', 'task_valuation', 'Inbound manifest', `Buyer Agent submitted a remote manifest for "${spec.title}".`, 'order_event'),
    mvpDemoTurn('assistant', 'buyer_agent', 'task_valuation', 'Buyer manifest', `Requested outcome: ${spec.message} The manifest is quoteable, but no seller execution is authorized yet.`),
    mvpDemoTurn('assistant', 'seller_agent', 'task_valuation', 'Valuation start', `I loaded the manifest, checked Seller Card policy, queue state, API readiness, and resource listing for provider ${shortID(provider)}.`),
    mvpDemoTurn('user', 'seller_human', 'task_valuation', 'Seller policy', 'Keep this API-only. Quote or reject from the published policy; do not run Docker until buyer authorization and escrow are visible.'),
    mvpDemoTurn('assistant', 'seller_agent', 'task_valuation', 'No early execution', 'Execution remains blocked. I can only return can_accept, needs_negotiation, or reject from valuation.'),
  ]

  if (mvpReachedSellerStage(spec, 'quote_response')) {
    turns.push(
      mvpDemoTurn('assistant', 'seller_agent', 'quote_response', 'Quote response', mvpDemoQuoteResponseText(spec, provider)),
      mvpDemoTurn('assistant', 'buyer_agent', 'quote_response', 'Buyer-side receipt', mvpDemoSellerQuoteReceiptText(spec)),
    )
    if (spec.candidateStatus === 'rejected') {
      turns.push(mvpDemoTurn('user', 'seller_human', 'quote_response', 'Reject boundary', `Reject this manifest rather than negotiating around policy. ${spec.error || spec.message}`))
    } else if (spec.candidateStatus === 'needs_negotiation') {
      turns.push(mvpDemoTurn('assistant', 'seller_agent', 'quote_response', 'Clarification request', `I need one blocking answer before quote finalization: ${spec.nextAction || spec.message}`))
    }
  }

  if (hasApproval && mvpReachedSellerStage(spec, 'wait_buyer')) {
    turns.push(
      mvpDemoTurn('assistant', 'buyer_agent', 'wait_buyer', 'Buyer selection', spec.approvalStatus === 'pending' ? 'Buyer selected this seller, but human approval is still pending.' : 'Buyer selected this seller and the approval record is moving through the owner boundary.'),
      mvpDemoTurn('assistant', 'seller_agent', 'wait_buyer', 'Seller waiting', 'I am waiting for approval, file disclosure scope, and escrow/payment evidence before accepting any input transfer.'),
    )
  }

  if (hasPayment && mvpReachedSellerStage(spec, 'wait_buyer')) {
    turns.push(spec.paymentConfirmed
      ? mvpDemoTurn('assistant', 'buyer_agent', 'wait_buyer', 'Escrow evidence', 'Simulated escrow evidence is attached. It is enough for this MVP state to move toward execution, but no real chain payment was made.')
      : mvpDemoTurn('user', 'buyer_human', 'wait_buyer', 'Payment pending', 'I still need to complete the payment/PIN step before the seller can execute.'))
  }

  if (hasTask && mvpReachedSellerStage(spec, 'execution_plan')) {
    turns.push(
      mvpDemoTurn('assistant', 'buyer_agent', 'execution_plan', 'Input receipt', 'Authorized inputs are transferred with hash receipts and the manifest boundary remains unchanged.'),
      mvpDemoTurn('assistant', 'seller_agent', 'execution_plan', 'Execution plan', 'I committed a step list with required input, expected output format, completion evidence, idempotency, and retry boundaries before starting Docker.'),
    )
  }

  if (hasRun && mvpReachedSellerStage(spec, 'provider_execution')) {
    turns.push(
      mvpDemoTurn('assistant', 'seller_agent', 'provider_execution', 'Provider execution', mvpDemoExecutionText(spec)),
      mvpDemoTurn('assistant', 'seller_agent', 'provider_execution', 'Structured output', 'The Docker-bound anchor will reject missing fields, wrong output shape, hash mismatch, or attempts to execute outside the authorized manifest.'),
    )
  }

  if (hasRun && mvpReachedSellerStage(spec, 'local_supervisor')) {
    turns.push(
      mvpDemoTurn('assistant', 'seller_agent', 'local_supervisor', 'Supervisor heartbeat', spec.error || 'Local supervisor is checking worker heartbeat, checkpoint recovery, and duplicate-execution risk.'),
      mvpDemoTurn('user', 'seller_human', 'local_supervisor', 'Recovery boundary', 'If the worker is blocked, resume from the first unfinished step. Do not rerun the whole task or mutate buyer inputs.'),
    )
  }

  if (mvpReachedSellerStage(spec, 'terminal_report')) {
    if (spec.error || spec.taskStatus === 'failed') {
      turns.push(
        mvpDemoTurn('assistant', 'seller_agent', 'terminal_report', 'Failed terminal report', `I submitted a failed terminal report with error evidence: ${spec.error || spec.message}`),
        mvpDemoTurn('assistant', 'buyer_agent', 'terminal_report', 'Buyer review', 'Buyer verification should keep release paused until repair or dispute review is chosen.'),
      )
    } else {
      turns.push(
        mvpDemoTurn('assistant', 'seller_agent', 'terminal_report', 'Terminal report', 'I submitted result.md, receipt.json, artifact hashes, log summary, and cleanup-retention notes for buyer verification.'),
        mvpDemoTurn('assistant', 'buyer_agent', 'terminal_report', 'Buyer review', 'The terminal report is ready for human verification. Settlement is still a separate decision/result.'),
      )
    }
  }

  if (mvpReachedSellerStage(spec, 'settlement')) {
    turns.push(
      mvpDemoTurn('assistant', 'buyer_agent', 'settlement', 'Settlement result', spec.orderState === 'closed' ? 'Buyer accepted the delivery and the local MVP record is closed.' : 'Settlement or dispute handling is still open.'),
      mvpDemoTurn('assistant', 'seller_agent', 'settlement', 'Cleanup receipt', 'I attached cleanup receipt metadata and simulated payout proof. This remains local demo evidence only.'),
    )
  }

  return turns
}

function mvpDemoTurn(
  role: ChatMessage['role'],
  actor: ChatMessage['actor'],
  stageId: string,
  meta: string,
  text: string,
  kind?: ChatMessage['kind'],
): MvpDemoChatTurn {
  return { kind, role, actor, stageId, meta, text }
}

function mvpDemoQuoteResponseText(spec: MvpDemoSpec, provider: string) {
  if (spec.candidateStatus === 'rejected') return `Rejected by ${shortID(provider)}. ${spec.error || spec.message} This should remain visible as a rejection reason, not as an executable path.`
  if (spec.candidateStatus === 'needs_negotiation') return `Needs negotiation before quote finalization. Blocking question: ${spec.nextAction || spec.message}`
  if (spec.candidateStatus === 'pending' || spec.status === 'seller_valuation') return `Valuation is in progress for ${shortID(provider)}. I am checking resource availability, policy limits, and whether the manifest is quoteable.`
  if (spec.amount) return `Can accept with a bounded ${spec.amount} USDC quote. Deliverables, ETA, retention limits, and Docker output evidence are part of the quote.`
  return `Seller signal for ${shortID(provider)}: ${spec.message}`
}

function mvpDemoBuyerOfferReviewText(spec: MvpDemoSpec, provider: string) {
  if (spec.candidateStatus === 'needs_negotiation') return 'I will keep the transaction in Offer because the seller needs a blocking clarification before price and ETA are reliable.'
  if (spec.candidateStatus === 'rejected') return 'This rejected seller is not selectable. I will preserve the reason and wait for another quote or buyer revision.'
  if (spec.amount) return `I compared the returned offer from ${shortID(provider)}. Buyer should review price, ETA, deliverables, limits, and risk before choosing.`
  return 'Offer aggregation is still waiting for seller valuation. No buyer approval or payment can occur yet.'
}

function mvpDemoSellerQuoteReceiptText(spec: MvpDemoSpec) {
  if (spec.candidateStatus === 'rejected') return 'Buyer Agent will show the rejection reason and not ask the user to approve or pay for this seller.'
  if (spec.candidateStatus === 'needs_negotiation') return 'Buyer Agent will ask the human only for the missing quote-affecting input, then return to quote review.'
  if (spec.amount) return `Buyer Agent received the ${spec.amount} USDC quote and will present it as an option, not an automatic selection.`
  return 'Buyer Agent is waiting for seller valuation to resolve into quote, clarification, or rejection.'
}

function mvpDemoExecutionText(spec: MvpDemoSpec) {
  if (spec.runStatus === 'queued') return 'The provider job is queued. Docker execution has not started, and the transaction is waiting for worker pickup.'
  if (spec.runStatus === 'waiting_worker' || spec.status === 'blocked') return `Execution is blocked by local supervisor evidence: ${spec.error || spec.nextAction || spec.message}`
  if (spec.runStatus === 'failed' || spec.taskStatus === 'failed') return `Execution failed inside the transaction boundary: ${spec.error || spec.message}`
  if (spec.runStatus === 'completed' || spec.taskStatus === 'completed') return 'Docker execution reached a terminal state and produced artifact metadata for verification.'
  if (spec.runStatus === 'running' || spec.taskStatus === 'running') return `Docker is running the approved manifest. Current checkpoint: ${progressStateLabel(spec.currentStep || spec.runStatus || spec.status)}.`
  return `Execution checkpoint: ${progressStateLabel(spec.currentStep || spec.runStatus || spec.status)}.`
}

function normalizeMvpDemoTurnCount(spec: MvpDemoSpec, turns: MvpDemoChatTurn[]) {
  const visibleStageId = mvpDemoVisibleStageId(spec)
  const agentActor: ChatMessage['actor'] = spec.side === 'seller' ? 'seller_agent' : 'buyer_agent'
  const counterpartActor: ChatMessage['actor'] = spec.side === 'seller'
    ? 'buyer_agent'
    : mvpReachedBuyerStage(spec, 'offer')
      ? 'seller_agent'
      : 'buyer_agent'
  const fillers = [
    mvpDemoTurn('assistant', agentActor, visibleStageId, 'State summary', `${spec.nextAction || spec.message} This is represented by local MVP records only.`),
    mvpDemoTurn('assistant', counterpartActor, visibleStageId, 'Continuation note', 'The next actor can read this state and continue from the same transaction checkpoint.'),
    mvpDemoTurn('assistant', agentActor, visibleStageId, 'Safety boundary', 'No demo message approves payment, discloses secrets, or executes real external work.'),
  ]
  const result = [...turns]
  for (const filler of fillers) {
    if (result.length >= 10) break
    result.push(filler)
  }
  return result.slice(0, 16)
}

function normalizeDemoMessageStageId(side: OrderSide, stageId?: string) {
  const normalized = normalizeTransactionStageId(stageId)
  if (side === 'seller') {
    if (normalized === 'intent' || normalized === 'plan') return 'task_valuation'
    if (normalized === 'offer') return 'quote_response'
    if (normalized === 'authorize') return 'wait_buyer'
    if (normalized === 'execute') return 'provider_execution'
    if (normalized === 'verify') return 'terminal_report'
  }
  return normalized || (side === 'seller' ? 'task_valuation' : 'intent')
}

function mvpDemoVisibleStageId(spec: MvpDemoSpec) {
  if (spec.side === 'buyer') return spec.stage === 'settlement' ? 'verify' : spec.stage
  if (spec.stage === 'settlement') return 'settlement'
  if (spec.stage === 'verify') return 'terminal_report'
  if (spec.stage === 'authorize') return 'wait_buyer'
  if (spec.stage === 'execute') return mvpDemoRunStageId(spec)
  if (spec.stage === 'offer') {
    return spec.status === 'seller_valuation' || spec.candidateStatus === 'pending' || spec.currentStep === 'seller_valuation'
      ? 'task_valuation'
      : 'quote_response'
  }
  return 'task_valuation'
}

function mvpDemoRunStageId(spec: MvpDemoSpec) {
  const step = String(spec.currentStep || '').toLowerCase()
  if (spec.side === 'buyer') {
    if (includesAny(step, ['verify', 'terminal', 'artifact', 'settlement', 'closed'])) return 'verify'
    if (includesAny(step, ['approval', 'authorized', 'payment', 'escrow', 'pin'])) return 'authorize'
    if (includesAny(step, ['seller_valuation', 'quote', 'matching', 'cloud'])) return 'offer'
    if (includesAny(step, ['manifest', 'plan'])) return 'plan'
    return spec.stage === 'settlement' ? 'verify' : spec.stage
  }
  if (includesAny(step, ['closed', 'settlement', 'dispute', 'cleanup'])) return 'settlement'
  if (includesAny(step, ['terminal', 'artifact', 'verify', 'buyer_verification']) || spec.taskStatus === 'completed' || spec.taskStatus === 'failed') return 'terminal_report'
  if (includesAny(step, ['poll_worker', 'heartbeat', 'supervisor']) || spec.status === 'blocked' || spec.runStatus === 'waiting_worker') return 'local_supervisor'
  if (includesAny(step, ['provider_execution', 'execution_blocked']) || spec.taskStatus === 'running') return 'provider_execution'
  if (includesAny(step, ['input_transfer', 'submit_worker_job', 'execution_plan']) || spec.status === 'execution_plan' || spec.runStatus === 'queued') return 'execution_plan'
  if (includesAny(step, ['approval', 'authorized', 'payment', 'escrow', 'pin']) || spec.stage === 'authorize') return 'wait_buyer'
  if (includesAny(step, ['quote', 'valuation_response', 'negotiate', 'compare']) || spec.candidateStatus && spec.candidateStatus !== 'pending') return 'quote_response'
  return 'task_valuation'
}

function mvpDemoPlanEvents(spec: MvpDemoSpec, index: number, createdAt: string, updatedAt: string): NonNullable<OrderPlan['events']> {
  const defaults: NonNullable<OrderPlan['events']> = [
    { time: createdAt, type: spec.side === 'seller' ? 'manifest_received' : 'intent_recorded', message: spec.title },
    { time: mvpDemoTimestamp(index, 5), type: spec.side === 'seller' ? 'seller_valuation' : 'remote_manifest', message: spec.message },
  ]
  if (spec.amount) defaults.push({ time: mvpDemoTimestamp(index, 11), type: 'quote_snapshot', message: `${spec.amount} USDC simulated quote` })
  if (spec.selected) defaults.push({ time: mvpDemoTimestamp(index, 13), type: 'seller_selected', message: 'Seller selection is linked to the local demo plan.' })
  defaults.push({ time: updatedAt, type: spec.currentStep || spec.orderState || spec.status, message: spec.error || spec.nextAction || spec.message })
  const scripted = (spec.events || []).map((event, eventIndex) => ({
    time: mvpDemoTimestamp(index, event.minuteOffset ?? 14 + eventIndex),
    type: event.type,
    message: event.summary,
  }))
  return [...defaults, ...scripted].slice(0, 6)
}

function mvpDemoWorkRunEvents(spec: MvpDemoSpec, runId: string, index: number, updatedAt: string): WorkRunEvent[] {
  const defaults: MvpDemoRunEventSpec[] = [
    { type: 'plan_first_boundary', step: 'Plan boundary', status: 'recorded', summary: 'Docker execution remains blocked until the manifest, authorization, and payment records allow the next phase.', minuteOffset: 6 },
    { type: spec.currentStep || spec.orderState || spec.status, step: progressStateLabel(spec.currentStep || spec.stage), status: spec.runStatus || spec.status, summary: spec.error || spec.message, minuteOffset: 18 },
  ]
  if (spec.paymentConfirmed) defaults.splice(1, 0, { type: 'verify_payment_evidence', step: 'Escrow evidence', status: 'confirmed_simulated', summary: 'Simulated escrow evidence is linked to the run; no real chain payment is executed.', minuteOffset: 10 })
  if (spec.artifacts) defaults.push({ type: 'terminal_report', step: 'Terminal report', status: 'completed', summary: 'Artifact manifest, receipt, and hashes were attached for verification.', minuteOffset: 22 })
  if (spec.error) defaults.push({ type: 'execution_blocked', step: 'Failure evidence', status: 'failed', summary: spec.error, minuteOffset: 23 })
  const events = [...defaults, ...(spec.events || [])]
  const limitedEvents = events.slice(0, 6)
  return limitedEvents.map((event, eventIndex) => ({
    eventId: `mvp-demo-event-${spec.slug}-${eventIndex + 1}`,
    type: event.type,
    runId,
    step: event.step || progressStateLabel(spec.currentStep || spec.stage),
    status: event.status || spec.runStatus || spec.status,
    summary: event.summary,
    data: event.data,
    createdAt: eventIndex === limitedEvents.length - 1 ? updatedAt : mvpDemoTimestamp(index, event.minuteOffset ?? 8 + eventIndex * 3),
  }))
}

function mvpDemoTimestamp(index: number, minuteOffset: number) {
  return new Date(Date.UTC(2026, 6, 8, 1, 0 + index * 17 + minuteOffset, 0)).toISOString()
}

function conversationStorageKey(thread: ChatThread) {
  const taskId = (thread.taskIds || []).map(String).find(Boolean)
  if (taskId) return `task:${taskId}`
  if (thread.orderId) return `order:${thread.orderId}`
  return `chat:${thread.id}`
}

function scheduleSaveChatThread(thread?: ChatThread, delay = CHAT_SAVE_DELAY) {
  if ((!thread?.messages.length && !thread?.agentSessionId) || !hasDesktopBridge()) return
  if (isDemoChatThread(thread)) return
  const existing = chatSaveTimers.get(thread.id)
  if (existing !== undefined) window.clearTimeout(existing)
  const timer = window.setTimeout(() => {
    chatSaveTimers.delete(thread.id)
    void saveChatThreadNow(thread)
  }, delay)
  chatSaveTimers.set(thread.id, timer)
}

function flushSaveChatThread(thread?: ChatThread) {
  if ((!thread?.messages.length && !thread?.agentSessionId) || !hasDesktopBridge()) return undefined
  if (isDemoChatThread(thread)) return undefined
  const existing = chatSaveTimers.get(thread.id)
  if (existing !== undefined) {
    window.clearTimeout(existing)
    chatSaveTimers.delete(thread.id)
  }
  return saveChatThreadNow(thread)
}

async function saveChatThreadNow(thread: ChatThread) {
  if (isDemoChatThread(thread)) return
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
  if (view !== 'market') state.marketRailDetailId = undefined
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
  const nextIndex = state.viewHistoryIndex + delta
  if (nextIndex < 0 || nextIndex >= state.viewHistory.length) return
  state.viewHistoryIndex = nextIndex
  state.activeView = state.viewHistory[nextIndex]
  if (state.activeView !== 'market') state.marketProjectPickerProvider = undefined
  if (state.activeView !== 'market') state.marketRailDetailId = undefined
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

function applyTransactionDetailWidth() {
  const width = normalizeTransactionDetailWidth(state.transactionDetailWidth)
  state.transactionDetailWidth = width
  fields.appShell.style.setProperty('--transaction-detail-width', `${width}px`)
  fields.transactionDetailResizeHandle.setAttribute('aria-valuenow', String(width))
  fields.transactionDetailResizeHandle.setAttribute('aria-valuetext', `${width}px`)
}

function transactionDetailWidthFromPointer(event: PointerEvent) {
  const shellRect = fields.appShell.getBoundingClientRect()
  const shellStyle = window.getComputedStyle(fields.appShell)
  const shellPaddingRight = Number.parseFloat(shellStyle.paddingRight) || 0
  return normalizeTransactionDetailWidth(shellRect.right - shellPaddingRight - event.clientX, state.transactionDetailWidth)
}

function updateTransactionDetailWidthFromPointer(event: PointerEvent) {
  const width = transactionDetailWidthFromPointer(event)
  if (width === state.transactionDetailWidth) return
  state.transactionDetailWidth = width
  applyTransactionDetailWidth()
}

function stopTransactionDetailResize(event?: PointerEvent) {
  if (transactionDetailResizePointerId === undefined) return
  const pointerId = transactionDetailResizePointerId
  transactionDetailResizePointerId = undefined
  if (event && event.pointerId === pointerId) updateTransactionDetailWidthFromPointer(event)
  if (fields.transactionDetailResizeHandle.hasPointerCapture(pointerId)) {
    fields.transactionDetailResizeHandle.releasePointerCapture(pointerId)
  }
  fields.appShell.classList.remove('transaction-detail-resizing')
  scheduleSaveAppSettings()
}

function renderChromeControls() {
  applySidebarWidth()
  applyTransactionDetailWidth()
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
  fields.backButton.disabled = state.busy || state.viewHistoryIndex <= 0
  fields.forwardButton.disabled = state.busy || state.viewHistoryIndex >= state.viewHistory.length - 1
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
  renderProfileMenu()
}

function profileDisplayName() {
  const sellerName = state.agentCards.seller?.manualFields.seller?.displayName?.trim()
  const providerId = state.sellerMarketStatus?.providerId?.trim() || state.sellerSettings?.providerId?.trim()
  return sellerName || providerId || t('app.userFallback')
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
  const records = [...state.v3ActivitySessions[side]].sort((a, b) => sortTime(b.updatedAt) - sortTime(a.updatedAt))
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
    <button class="order-search-result" type="button" role="option" data-order-search-session="${escapeAttr(record.sessionId)}" title="${escapeAttr([record.productTitle, record.counterpartyLabel, record.status, record.sessionId].filter(Boolean).join(' / '))}">
      <span class="order-search-kind kind-${escapeAttr(record.productKind)}" aria-hidden="true">${v3ActivityKindLabel(record.productKind)}</span>
      <span class="order-search-result-copy">
        <strong>${escapeHTML(record.productTitle || 'Resource session')}</strong>
        <small>${escapeHTML([record.counterpartyLabel, v3ActivityStatusLabel(record.status), compactTimestamp(record.updatedAt)].filter(Boolean).join(' · '))}</small>
      </span>
      <span class="order-search-result-amount">${escapeHTML(v3AtomicMoney(record.amountAtomic, record.asset))}</span>
      <span class="order-search-result-arrow" aria-hidden="true">${toolbarIcons.disclosure}</span>
    </button>
  `).join('')
}

function openOrderSearch() {
  closeProfileMenu()
  closeProjectFolderMenu(false)
  closeTaskContextMenu(false)
  closePermissionMenu(false)
  closeMarketProjectPicker()
  closeCartModal()
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

function openOrderSearchResult(sessionId: string) {
  if (!sessionId) return
  closeOrderSearch()
  state.sellerWorkspaceMode = 'transactions'
  setActiveView('work')
  selectV3ActivitySession(sessionId)
}

function renderProjectFolder() {
  const folder = activeProjectFolder()
  const name = folder?.name || DEFAULT_WORK_FOLDER_NAME
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
  return { name: DEFAULT_WORK_FOLDER_NAME, path: `browser:${DEFAULT_WORK_FOLDER_NAME}` }
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

function isDefaultWorkFolder(folder?: ProjectFolder) {
  if (!folder) return false
  if (folder.name === DEFAULT_WORK_FOLDER_NAME) return true
  return folder.path.split(/[\\/]/).filter(Boolean).pop() === DEFAULT_WORK_FOLDER_NAME
}

function defaultWorkProjectFolder() {
  return state.projectFolders.find(isDefaultWorkFolder) || state.projectFolders[0] || fallbackProjectFolder()
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
  const current = state.projectFolder || fallbackProjectFolder()
  const folder = { name, path: current.path.startsWith('browser:') ? `browser:${name}` : current.path }
  localStorage.setItem('exora.projectFolder', JSON.stringify(folder))
  return folder
}

async function renameProjectFolder() {
  if (state.busy) return
  const currentName = state.projectFolder?.name || DEFAULT_WORK_FOLDER_NAME
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
  if (state.cartOpen) renderCartModal()
  if (state.activeView === 'market' || state.activeView === 'settings') renderDecisionPanel()
}

async function refreshMarketRailCards(options: { render?: boolean } = {}) {
  if (state.marketRailLoading) return
  state.marketRailLoading = true
  if (options.render !== false && state.cartOpen) renderCartModal()
  if (options.render !== false && state.activeView === 'market') renderDecisionPanel()
  try {
    const response = await invoke<MarketRailResponse>('market_rail_cards')
    state.marketRail = response
    state.marketRailError = undefined
  } catch (error) {
    state.marketRail = fallbackMarketRailResponse()
    state.marketRailError = undefined
  } finally {
    state.marketRailLoading = false
    if (options.render !== false && state.cartOpen) renderCartModal()
    if (options.render !== false && state.activeView === 'market') renderDecisionPanel()
  }
}

function fallbackMarketRailResponse(): MarketRailResponse {
  return {
    buyerSettings: {
      displayName: 'Exora Buyer Sample',
      budget: '20 USDC default task cap unless the owner approves more.',
      riskBoundary: 'Low-risk compute, data, code, and managed API research only before explicit consent.',
      authorizationStrategy: 'Human confirmation is required for payments, identity disclosure, file transfer, external writes, and public publishing.',
      dataRetention: 'Inputs may only be retained for the active task unless separately approved.',
      preferences: ['balanced price and speed', 'privacy first', 'prefer verifiable artifacts'],
      acceptedTaskTypes: ['compute', 'research', 'data', 'code', 'managed_api'],
    },
    cards: [
      {
        id: 'sample-seller-card-gpu',
        stage: 'Seller Agent Card',
        status: 'published',
        title: 'A6000 Inference Seller',
        provider: 'sample-provider-a6000',
        summary: '48GB VRAM A6000 worker with CUDA 12, Docker isolation, Python 3.11, and gpu-standard-v3. Low-risk inference quotes can be automated; external writes, credentials, or public disclosure require human confirmation.',
        metrics: [
          { label: 'VRAM', value: '48GB', hint: 'A6000 available memory' },
          { label: 'Runtime', value: 'CUDA 12', hint: 'Docker isolated' },
          { label: 'Policy', value: 'low-risk auto', hint: 'gpu-standard-v3' },
        ],
        chips: ['A6000', 'Docker isolation', 'Python 3.11', 'gpu-standard-v3'],
        risk: 'External writes, credential use, public disclosure, and payment require human confirmation.',
        nextAction: 'Use this public card for matching; disclose task files only after consent.',
      },
      {
        id: 'sample-match-gpu',
        stage: 'Match',
        status: 'matched',
        title: '40GB+ inference match',
        provider: 'sample-provider-a6000',
        summary: 'Buyer intent asks for a large-VRAM inference run. The seller matches VRAM, CUDA, isolated execution, and verifiable output requirements.',
        metrics: [
          { label: 'Score', value: '0.91', hint: 'Capability and risk fit' },
          { label: 'Requirement', value: '40GB+', hint: 'Minimum VRAM' },
          { label: 'Evidence', value: 'hashes', hint: 'Artifact manifest required' },
        ],
        chips: ['gpu_vram_gb >= 40', 'cuda available', 'isolated execution', 'returns artifact hashes'],
        risk: 'New provider with limited reputation history; keep budget and input scope bounded.',
        nextAction: 'Contact up to three sellers for valuation before asking the user to choose.',
      },
      {
        id: 'sample-quote-gpu',
        stage: 'Quote',
        status: 'can_accept',
        title: 'Inference quote ready',
        provider: 'sample-provider-a6000',
        summary: 'Seller can accept for 12.5 USDC with a 45m ETA. Live snapshot is 47GB VRAM available, queue 0, and 320GB disk; deliver results.jsonl, logs.txt, and artifact_manifest.json.',
        metrics: [
          { label: 'Price', value: '12.5 USDC', hint: 'Minimum plus runtime estimate' },
          { label: 'ETA', value: '45m', hint: 'Quote valid for 30 minutes' },
          { label: 'Snapshot', value: '47GB / q0', hint: '320GB disk free' },
        ],
        chips: ['results.jsonl', 'logs.txt', 'artifact_manifest.json'],
        risk: 'Model download time can extend ETA if the requested model is not cached.',
        nextAction: 'Create owner selection and payment approval; do not execute before acceptance.',
      },
      {
        id: 'sample-needs-render',
        stage: 'Needs Negotiation',
        status: 'needs_negotiation',
        title: 'Render task missing inputs',
        provider: 'sample-render-provider',
        summary: 'Seller can quote the render job only after the task manifest includes the project package and concrete render settings.',
        metrics: [
          { label: 'Budget', value: '20 -> 28 USDC', hint: 'Requested adjustment' },
          { label: 'Missing', value: '6 fields', hint: 'Inputs needed for firm quote' },
          { label: 'State', value: 'valuation', hint: 'No execution yet' },
        ],
        chips: ['project archive', 'software version', 'frame range', 'render engine', 'output format', 'asset manifest'],
        risk: 'Do not guess assets, plugins, frame ranges, or output format.',
        nextAction: 'Ask buyer to provide missing fields or relax price/deadline before quote review.',
      },
      {
        id: 'sample-reject-data',
        stage: 'Reject',
        status: 'rejected',
        title: 'Data request rejected',
        provider: 'sample-data-vault',
        summary: 'Provider refuses to sell unauthorized or non-retainable data, and suggests a public filings dataset with source summaries and 7-day input deletion.',
        metrics: [
          { label: 'Decision', value: 'reject', hint: 'Policy boundary' },
          { label: 'Retention', value: '7d', hint: 'For accepted public data tasks' },
          { label: 'Output', value: 'sourced summary', hint: 'Include timestamps' },
        ],
        chips: ['public filings', 'source citations', 'updated-at', 'no resale'],
        risk: 'Data provider must declare provenance, update time, license scope, and allowed use.',
        nextAction: 'Revise task to use licensed sources or request an aggregated answer with provenance.',
      },
      {
        id: 'sample-consent-travel',
        stage: 'Consent',
        status: 'managed_api_guarded',
        title: 'Managed travel API guardrail',
        provider: 'sample-travel-agent',
        summary: 'Seller can query live flight options and booking links, but booking, payment, and identity disclosure require a separate approval.',
        metrics: [
          { label: 'Action', value: 'query only', hint: 'Before consent' },
          { label: 'Writes', value: 'blocked', hint: 'No booking without approval' },
          { label: 'Receipt', value: 'redacted', hint: 'Trace after execution' },
        ],
        chips: ['prices', 'times', 'baggage', 'cancellation', 'booking links', 'receipt summary'],
        risk: 'Real booking, payment, passenger identity, and external account writes must enter the Dock approval queue.',
        nextAction: 'Return options first; ask for explicit consent before any irreversible action.',
      },
    ],
  }
}

function renderAgentCardSurfaces() {
  if (state.cartOpen) renderCartModal()
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
  if (role === 'seller' && cardForRole('seller')?.manualFields.seller?.setupStatus !== 'complete') {
    throw new Error('Complete the Seller Setup questions and permission boundary before publishing.')
  }
  const form = findAgentCardForm(role, root)
  if (form) {
    const saved = await saveAgentCardFromForm(form, role)
    if (!saved && !cardForRole(role)) return
  }
  state.cardMessage = 'Publishing card to Exora Cloud...'
  renderAgentCardSurfaces()
  const response = await invoke<{ card?: AgentCard; cloudPublished?: boolean }>('publish_agent_card', { input: { role } })
  if (response.card) {
    state.agentCards = { ...state.agentCards, [role]: response.card }
    state.cardDrafts[role] = undefined
    state.activeCardEditor = undefined
    state.cardMessage = response.cloudPublished ? 'Card published to Exora Cloud.' : 'Card saved, but Cloud did not confirm publication.'
    renderProfileSummary()
  }
  renderAgentCardSurfaces()
}

function compactTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
  return {
    ...current,
    sellIntent: formText(data, 'sellIntent'),
    pricingPrinciples: formText(data, 'pricingPrinciples'),
  }
}

async function generateSellerCardWithAgent(root: ParentNode = fields.decisionContent) {
  const form = findAgentCardForm('seller', root)
  if (!form) throw new Error('Seller Card form is unavailable.')
  const manual = sellerFieldsFromForm(new FormData(form), cardForRole('seller')?.manualFields.seller || {})
  if (!manual.sellIntent) throw new Error('Describe what you want to sell before generating the Seller Card.')
  if (!manual.pricingPrinciples) throw new Error('Enter your pricing principles before generating the Seller Card.')
  if (containsLikelySecret(`${manual.sellIntent}\n${manual.pricingPrinciples}`)) {
    throw new Error('Do not paste real credentials into Seller Card fields. Use a credential alias and describe only its permission boundary.')
  }
  const bindingResult = await invoke<{ binding?: LocalAgentBinding | null }>('local_agent_binding')
  const binding = bindingResult.binding || undefined
  state.localAgentBinding = binding
  if (!binding?.valid || binding.status !== 'ready') throw new Error('Bind and verify a supported local Agent before generating the Seller Card.')

  state.sellerCardGeneration = { eventCursor: 0, responseText: '', status: 'collecting', round: 1 }
  state.activeCardEditor = 'seller'
  state.cardMessage = 'Inspecting the local environment with Exora tools...'

  const draft = await generateAgentCardDraft('seller', form, { render: false, track: false })
  if (!draft) throw new Error('Exora could not collect a Seller Card environment snapshot.')
  const incompleteSeller: SellerManualFields = {
    ...(draft.manualFields.seller || {}),
    ...manual,
    setupStatus: 'incomplete',
    structuredByAgent: undefined,
    structuredAt: undefined,
    allowedAgentActions: [],
    approvalRequiredActions: [],
    credentialPolicy: '',
    networkPolicy: '',
  }
  const incompleteDraft: AgentCard = {
    ...draft,
    manualFields: { ...draft.manualFields, seller: incompleteSeller },
  }
  const saved = await invoke<{ card?: AgentCard }>('save_agent_card', { input: { role: 'seller', card: incompleteDraft } })
  const setupCard = saved.card || incompleteDraft
  state.agentCards = { ...state.agentCards, seller: setupCard }
  state.cardDrafts.seller = undefined
  state.sellerCardGeneration.status = 'starting_agent'
  state.cardMessage = `Starting ${localAgentDisplayName(binding.driverId)}...`
  renderAgentCardSurfaces()

  const conversationId = `seller-card-${crypto.randomUUID()}`
  const response = await invoke<{ session: InteractiveAgentSession }>('local_agent_session_start', {
    input: {
      conversationId,
      role: 'seller',
      purpose: 'seller_card',
      workspace: activeProjectFolder().path,
      permissionMode: 'ask',
      transactionId: '',
      workUid: conversationId,
      runId: '',
      idempotencyKey: `seller-card:${conversationId}`,
    },
  })
  const session = response.session
  state.localAgentSessions[session.id] = session
  state.sellerCardGeneration.sessionId = session.id
  await invoke('local_agent_session_subscribe', { input: { sessionId: session.id, after: 0 } })
  const clientMessageId = `seller-card-message-${crypto.randomUUID()}`
  state.sellerCardGeneration.status = 'analyzing'
  state.cardMessage = `${localAgentDisplayName(binding.driverId)} is structuring offerings and pricing...`
  renderAgentCardSurfaces()
  await invoke('local_agent_session_send', {
    input: {
      sessionId: session.id,
      clientMessageId,
      text: sellerCardAgentPrompt(setupCard),
      idempotencyKey: `send:${clientMessageId}`,
    },
  })
}

function sellerCardAgentPrompt(card: AgentCard) {
  const seller = card.manualFields.seller || {}
  const diagnostics = card.diagnostics
  const input = {
    sellerIntent: seller.sellIntent,
    pricingPrinciples: seller.pricingPrinciples,
    environment: {
      os: diagnostics.os,
      osVersion: diagnostics.osVersion,
      arch: diagnostics.arch,
      cpuCores: diagnostics.cpuCores,
      cpuModel: diagnostics.cpuModel,
      ramGb: diagnostics.ramGb,
      gpus: diagnostics.gpus?.map(({ name, chip, driverVersion, vramGb }) => ({ name, chip, driverVersion, vramGb })),
      storage: diagnostics.storage?.map(({ label, totalGb, freeGb }) => ({ label, totalGb, freeGb })),
      docker: diagnostics.dockerAvailable ? diagnostics.dockerVersion || 'available' : 'not available',
      python: diagnostics.pythonVersion,
      node: diagnostics.nodeVersion,
      codeEnvironment: diagnostics.codeEnvironment?.map(({ name, version, source }) => ({ name, version, source })),
      dependencies: diagnostics.dependencies?.map(({ name, version, source }) => ({ name, version, source })),
    },
  }
  return [
    'You are conducting a Seller Setup conversation. Create a truthful public Seller Card and settle the local Agent permission boundary before declaring setup complete.',
    'Do not invent installed software, credentials, APIs, performance, availability, or certifications that are not supported by the input.',
    'The seller intent and pricing principles are authoritative. Turn them into concise buyer-facing offerings and a deterministic quote workflow.',
    'Ask compact batches of required questions when any important commercial, execution, or permission boundary is unclear. Multiple rounds are allowed.',
    'If APIs or credentials may be involved, settle credential aliases (names only), permitted read/query/write/publish actions, permitted domains or endpoint classes, rate or spend limits, approval cases, and retention/logging boundaries.',
    'Never ask for or accept API keys, access tokens, passwords, private keys, recovery codes, cookie values, or other secret material. Refer to credentials only by a human-readable alias.',
    'Return exactly one JSON object using one of these two envelopes:',
    '{"status":"needs_input","questions":[{"id":"stable_id","question":"string","why":"string","placeholder":"string","required":true}]}',
    '{"status":"complete","card":{"displayName":"string","capabilitySummary":"string","capabilityTypes":["string"],"pricing":"string","availability":"string","offerings":["string"],"pricingProcess":["string"],"humanConfirmation":"string","dataBoundary":"string","managedApis":["string"],"outputFormats":["string"],"externalWritePolicy":"string","allowedAgentActions":["string"],"approvalRequiredActions":["string"],"credentialPolicy":"string","networkPolicy":"string"}}',
    'Do not return complete until the permission boundary is unambiguous. A complete card requires at least one allowed Agent action and at least one action that always requires human approval.',
    'Use 1-8 offerings and 3-8 pricing steps. Keep every string concise. managedApis must contain product or credential alias names only and must be empty unless explicitly supported.',
    'Human confirmation must always remain required for secret creation or replacement, payments, public disclosure, privilege expansion, and writes outside the accepted task boundary.',
    '',
    JSON.stringify(input),
  ].join('\n')
}

function handleSellerCardAgentEvent(envelope: { sessionId?: unknown; event?: unknown; error?: unknown }) {
  const generation = state.sellerCardGeneration
  const sessionId = String(envelope.sessionId || '').trim()
  if (!generation?.sessionId || generation.sessionId !== sessionId) return false
  if (envelope.error) {
    failSellerCardGeneration(String(envelope.error))
    return true
  }
  if (!envelope.event || typeof envelope.event !== 'object' || Array.isArray(envelope.event)) return true
  const event = envelope.event as AgentSessionEvent
  const seq = Number(event.seq)
  if (!Number.isFinite(seq) || seq <= generation.eventCursor) return true
  generation.eventCursor = seq
  if (event.kind === 'agent.message.delta') generation.responseText += String(event.text || '')
  if (event.kind === 'agent.message.completed' && event.text) generation.responseText = String(event.text)
  if (event.kind === 'driver.failure' || event.kind === 'turn.failed') {
    failSellerCardGeneration(event.text || 'The bound local Agent failed while generating the Seller Card.')
  } else if (event.kind === 'turn.completed') {
    try {
      applySellerCardAgentResult(generation.responseText)
    } catch (error) {
      failSellerCardGeneration(humanizeError(error))
    }
  }
  return true
}

function applySellerCardAgentResult(text: string) {
  const parsed = parseSellerCardAgentResult(text)
  if (parsed.status === 'needs_input') {
    const generation = state.sellerCardGeneration
    if (!generation) throw new Error('Seller Setup session disappeared before questions were received.')
    generation.status = 'waiting_user'
    generation.questions = parsed.questions
    generation.responseText = ''
    state.cardMessage = `Setup incomplete: answer ${parsed.questions.filter((question) => question.required).length} required permission question(s).`
    renderAgentCardSurfaces()
    return
  }
  const card = cardForRole('seller')
  if (!card) throw new Error('Seller Card draft disappeared before Agent generation completed.')
  const current = card.manualFields.seller || {}
  const nextSeller: SellerManualFields = {
    ...current,
    displayName: parsed.card.displayName || current.displayName || state.sellerSettings?.providerId || 'Exora Seller',
    capabilitySummary: parsed.card.capabilitySummary,
    capabilityTypes: parsed.card.capabilityTypes,
    pricing: parsed.card.pricing,
    availability: parsed.card.availability,
    offerings: parsed.card.offerings,
    pricingProcess: parsed.card.pricingProcess,
    structuredByAgent: state.localAgentBinding?.driverId || 'local-agent',
    structuredAt: new Date().toISOString(),
    setupStatus: 'complete',
    allowedAgentActions: parsed.card.allowedAgentActions,
    approvalRequiredActions: parsed.card.approvalRequiredActions,
    credentialPolicy: parsed.card.credentialPolicy,
    networkPolicy: parsed.card.networkPolicy,
    humanConfirmation: parsed.card.humanConfirmation || 'Human confirmation is required for secret changes, payment, public disclosure, privilege expansion, and writes outside the accepted task.',
    dataBoundary: parsed.card.dataBoundary || 'Buyer inputs remain scoped to the accepted task and are not reused without consent.',
    managedApis: parsed.card.managedApis,
    outputFormats: parsed.card.outputFormats,
    externalWritePolicy: parsed.card.externalWritePolicy || 'Writes outside the accepted task boundary require explicit seller authorization.',
  }
  state.cardDrafts.seller = { ...card, manualFields: { ...card.manualFields, seller: nextSeller } }
  if (state.sellerCardGeneration) state.sellerCardGeneration.status = 'completed'
  state.cardMessage = 'Seller Card generated. Review the offerings and pricing workflow before publishing.'
  finishSellerCardGenerationSession()
  renderAgentCardSurfaces()
}

function parseSellerCardAgentResult(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The local Agent did not return a structured Seller Card. Retry generation.')
  let value: Record<string, unknown>
  try {
    value = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new Error('The local Agent returned invalid Seller Card JSON. Retry generation.')
  }
  const status = String(value.status || '').trim()
  if (status === 'needs_input') {
    const questions = (Array.isArray(value.questions) ? value.questions as unknown[] : [])
      .map((item, index): SellerCardSetupQuestion | undefined => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined
        const question = item as Record<string, unknown>
        const prompt = String(question.question || '').trim().slice(0, 600)
        if (!prompt) return undefined
        return {
          id: String(question.id || `question_${index + 1}`).trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80),
          question: prompt,
          why: String(question.why || '').trim().slice(0, 500),
          placeholder: String(question.placeholder || '').trim().slice(0, 300),
          required: question.required !== false,
        }
      })
      .filter((item): item is SellerCardSetupQuestion => Boolean(item))
      .slice(0, 12)
    if (!questions.length) throw new Error('The local Agent marked setup incomplete but returned no questions.')
    return { status: 'needs_input' as const, questions }
  }
  if (status !== 'complete' || !value.card || typeof value.card !== 'object' || Array.isArray(value.card)) {
    throw new Error('The local Agent did not return a valid Seller Setup envelope.')
  }
  const card = value.card as Record<string, unknown>
  const stringValue = (key: string, required = false) => {
    const result = String(card[key] || '').trim().slice(0, 1200)
    if (required && !result) throw new Error(`The generated Seller Card is missing ${key}.`)
    return result
  }
  const stringList = (key: string, required = false) => {
    const result = (Array.isArray(card[key]) ? card[key] as unknown[] : [])
      .map((item) => String(item || '').trim().slice(0, 320))
      .filter(Boolean)
      .slice(0, 12)
    if (required && !result.length) throw new Error(`The generated Seller Card is missing ${key}.`)
    return result
  }
  return {
    status: 'complete' as const,
    card: {
      displayName: stringValue('displayName'),
      capabilitySummary: stringValue('capabilitySummary', true),
      capabilityTypes: stringList('capabilityTypes', true),
      pricing: stringValue('pricing', true),
      availability: stringValue('availability', true),
      offerings: stringList('offerings', true),
      pricingProcess: stringList('pricingProcess', true),
      humanConfirmation: stringValue('humanConfirmation'),
      dataBoundary: stringValue('dataBoundary'),
      managedApis: stringList('managedApis'),
      outputFormats: stringList('outputFormats'),
      externalWritePolicy: stringValue('externalWritePolicy'),
      allowedAgentActions: stringList('allowedAgentActions', true),
      approvalRequiredActions: stringList('approvalRequiredActions', true),
      credentialPolicy: stringValue('credentialPolicy', true),
      networkPolicy: stringValue('networkPolicy', true),
    },
  }
}

function containsLikelySecret(value: string) {
  return /(?:sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|AIza[a-z0-9_-]{20,}|-----BEGIN [^-]*PRIVATE KEY-----|eyJ[a-z0-9_-]+\.eyJ[a-z0-9_-]+\.[a-z0-9_-]+|(?:api[_ -]?key|access[_ -]?token|secret|password)\s*[:=]\s*\S{8,})/i.test(value)
}

async function continueSellerCardSetup(root: ParentNode = fields.decisionContent) {
  const generation = state.sellerCardGeneration
  if (!generation?.sessionId || generation.status !== 'waiting_user' || !generation.questions?.length) {
    throw new Error('There is no Seller Setup question waiting for an answer.')
  }
  const form = findAgentCardForm('seller', root)
  if (!form) throw new Error('Seller Card form is unavailable.')
  const controls = Array.from(form.querySelectorAll<HTMLTextAreaElement>('[data-seller-card-question]'))
  const values = new Map(controls.map((control) => [control.dataset.sellerCardQuestion || '', control.value.trim()]))
  const pendingQuestions = generation.questions
  const answers = pendingQuestions.map((question) => ({
    id: question.id,
    question: question.question,
    answer: values.get(question.id) || '',
  }))
  const missing = pendingQuestions.filter((question) => question.required && !values.get(question.id))
  if (missing.length) throw new Error(`Answer every required Seller Setup question (${missing.length} remaining).`)
  const secretAnswer = answers.find((answer) => containsLikelySecret(answer.answer))
  if (secretAnswer) {
    throw new Error('Do not paste real credentials into Seller Setup. Use an alias such as “GitHub seller account” and describe its permission boundary.')
  }
  generation.status = 'analyzing'
  generation.questions = undefined
  generation.responseText = ''
  generation.round += 1
  state.cardMessage = `The local Agent is reviewing Seller Setup round ${generation.round}...`
  renderAgentCardSurfaces()
  const clientMessageId = `seller-card-answer-${crypto.randomUUID()}`
  try {
    await invoke('local_agent_session_send', {
      input: {
        sessionId: generation.sessionId,
        clientMessageId,
        text: [
          `Seller Setup answers for round ${generation.round}:`,
          JSON.stringify({ answers }),
          'Continue the same Seller Setup. Never request secret values. Return exactly one needs_input or complete JSON envelope using the schema from the initial instruction.',
        ].join('\n'),
        idempotencyKey: `send:${clientMessageId}`,
      },
    })
  } catch (error) {
    generation.status = 'waiting_user'
    generation.questions = pendingQuestions
    generation.round = Math.max(1, generation.round - 1)
    state.cardMessage = humanizeError(error)
    renderAgentCardSurfaces()
    throw error
  }
}

function failSellerCardGeneration(message: string) {
  if (state.sellerCardGeneration) {
    state.sellerCardGeneration.status = 'failed'
    state.sellerCardGeneration.error = message
  }
  state.cardMessage = message
  finishSellerCardGenerationSession()
  renderAgentCardSurfaces()
}

function finishSellerCardGenerationSession() {
  const sessionId = state.sellerCardGeneration?.sessionId
  if (!sessionId) return
  invoke('local_agent_session_unsubscribe', { input: { sessionId } }).catch(() => undefined)
  invoke('local_agent_session_stop', { input: { sessionId } }).catch(() => undefined)
}

function signaturePart(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function signatureRow(values: unknown[]) {
  return values.map(signaturePart).join('\x1f')
}

function workspaceRenderSignature() {
  const workRunEventRows = Object.keys(state.workRunEvents || {}).sort().map((runId) => {
    const events = state.workRunEvents[runId] || []
    const last = events[events.length - 1]
    return signatureRow([runId, events.length, last?.eventId, last?.type, last?.status, last?.checkpointId, last?.step, last?.createdAt])
  })
  return JSON.stringify({
    online: state.workspaceOnline,
    errors: state.workspaceErrors,
    activeProjectFolderPath: state.activeProjectFolderPath,
    selectedId: state.selectedId,
    selectedWorkThreadId: state.selectedWorkThreadId,
    plans: state.orderPlans.map((plan) => signatureRow([
      plan.planId,
      plan.status,
      plan.updatedAt,
      plan.createdAt,
      plan.expiresAt,
      plan.selectedOptionId,
      plan.taskId,
      plan.approvalId,
      plan.paymentId,
      plan.providerJobId,
      plan.invalidationCause,
      plan.nextAction,
      plan.orderState?.state,
      plan.orderState?.waitingFor,
      plan.orderState?.updatedAt,
      plan.options?.length || 0,
      (plan.options || []).map((option) => signatureRow([
        option.optionId,
        option.realtimeStatus,
        option.quoteId,
        option.confirmedAt,
        option.expiresAt,
        option.priceSnapshot?.pricePerUnit,
        option.priceSnapshot?.currency,
      ])).join('\x1e'),
      plan.candidates?.length || 0,
      (plan.candidates || []).map((candidate) => signatureRow([
        candidate.optionId,
        candidate.providerPubkey,
        candidate.status,
        candidate.message,
        candidate.quoteId,
        candidate.updatedAt,
      ])).join('\x1e'),
      plan.events?.length || 0,
      (plan.events || []).slice(-3).map((event) => signatureRow([event.time, event.type, event.message, event.optionId])).join('\x1e'),
    ])),
    approvals: state.approvals.map((approval) => signatureRow([
      approval.approvalId,
      approval.status,
      approval.taskId,
      approval.planId,
      approval.workRunId,
      approval.providerPubkey,
      approval.paymentRequired,
      approval.action,
      approval.createdAt,
      approval.expiresAt,
      approval.amount?.value,
      approval.amount?.currency,
      approval.quote?.priceAmount,
      approval.quote?.currency,
    ])),
    tasks: state.tasks.map((task) => signatureRow([
      task.id,
      task.orderId,
      task.status,
      task.providerPubkey,
      task.updatedAt,
      task.createdAt,
      task.consentedAt,
      task.claimedAt,
      task.completedAt,
      task.error,
      task.quote?.id,
      task.quote?.providerPubkey,
      task.quote?.priceAmount,
      task.quote?.currency,
      task.artifacts?.length || 0,
    ])),
    payments: state.payments.map((payment) => signatureRow([
      payment.paymentId,
      payment.approvalId,
      payment.taskId,
      payment.status,
      payment.mode,
      payment.proofRef,
      payment.amount,
      payment.currency,
      payment.createdAt,
      payment.updatedAt,
      payment.confirmedAt,
    ])),
    mcpConnections: state.mcpConnections.map((connection) => signatureRow([
      connection.id,
      connection.role,
      connection.cwd,
      connection.projectPath,
      connection.projectName,
      connection.source,
      connection.clientName,
      connection.lastSeen,
    ])),
    leases: state.workMcpLeases.map((lease) => signatureRow([
      lease.workUid,
      lease.projectPath,
      lease.controller,
      lease.status,
      lease.clientName,
      lease.lastSeenAt,
      lease.updatedAt,
      lease.expiresAt,
    ])),
    runs: state.workRuns.map((run) => signatureRow([
      run.runId,
      run.workUid,
      run.projectPath,
      run.status,
      run.currentStep,
      run.nextAction,
      run.lastCheckpointId,
      run.error,
      run.updatedAt,
      run.completedAt,
      run.entities?.orderPlanId,
      run.entities?.taskId,
      run.entities?.approvalId,
      run.entities?.paymentId,
      run.entities?.providerJobId,
      run.activeWorker?.workerId,
      run.activeWorker?.status,
      run.activeWorker?.jobId,
      run.activeWorker?.updatedAt,
    ])),
    runEvents: workRunEventRows,
    projectFolders: state.projectFolders.map((folder) => signatureRow([folder.path, folder.name, folder.daemonRestarted])),
  })
}

async function refreshWorkspace(options: { quiet?: boolean } = {}) {
  if (workspaceRefreshInFlight) {
    workspaceRefreshQueued = true
    workspaceRefreshQueuedQuiet = workspaceRefreshQueuedQuiet && options.quiet === true
    return workspaceRefreshInFlight
  }
  workspaceRefreshQueued = false
  workspaceRefreshQueuedQuiet = options.quiet === true
  workspaceRefreshInFlight = refreshWorkspaceLoop(options).finally(() => {
    workspaceRefreshInFlight = undefined
  })
  return workspaceRefreshInFlight
}

async function refreshWorkspaceLoop(options: { quiet?: boolean }) {
  let nextOptions = options
  do {
    workspaceRefreshQueued = false
    await refreshWorkspaceNow(nextOptions)
    nextOptions = { quiet: workspaceRefreshQueuedQuiet }
    workspaceRefreshQueuedQuiet = true
  } while (workspaceRefreshQueued)
}

async function refreshWorkspaceNow(options: { quiet?: boolean } = {}) {
  if (state.workspaceLoading) return
  state.workspaceLoading = true
  const previousSelected = state.selectedId
  const previousSignature = workspaceRenderSignature()
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
    if (snapshot.online !== false) {
      const cloud = await invoke<{ transactions?: CloudTransactionProjection[] }>('cloud_transactions').catch(() => undefined)
      if (cloud?.transactions) state.cloudTransactions = cloud.transactions
    }
    applyDemoTransactionsToState()
    applyGpuDemoRecordsToState()
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
    if (workspaceRenderSignature() !== previousSignature) {
      renderLedger()
      renderContextStrip()
      renderDecisionPanel()
      renderExternalWorkLockControls()
    }
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
    if (isDemoTask(task)) continue
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
    if (isDemoOrderPlan(plan)) continue
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
    if (isDemoApproval(approval)) continue
    const task = approval.taskId ? state.tasks.find((item) => item.id === approval.taskId) : undefined
    const id = task ? `task:${task.id}` : approvalThreadKey(approval)
    const record = ensure(id, {
      orderId: task?.orderId || approval.taskId || approval.planId || approval.subjectId || approval.approvalId,
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
    if (isDemoPayment(payment)) continue
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

function activeBuyerAgentContinuationContext() {
  if (state.newConversationDraft || state.workOrderSide !== 'buyer') {
    return { hasTransaction: false, projectPath: defaultWorkProjectPath() }
  }
  const thread = selectedWorkThread()
  if (!thread) return { hasTransaction: false, projectPath: defaultWorkProjectPath() }
  const data = transactionProgressData(thread)
  const plan = latestBy(data.plans, (item) => item.updatedAt || item.createdAt || item.expiresAt || '')
  const approval = latestBy(data.approvals, (item) => item.createdAt || item.expiresAt || '')
  const task = latestBy(data.tasks, (item) => item.updatedAt || item.completedAt || item.createdAt || '')
  const payment = latestBy(data.payments, (item) => item.updatedAt || item.confirmedAt || item.createdAt || '')
  const threadOrderId = orderIdFromWorkThreadId(thread.id)
  const planId = plan?.planId
    || thread.planIds[0]
    || (!thread.taskIds.length && !task && (thread.orderId || threadOrderId) ? thread.orderId || threadOrderId : undefined)
  return {
    hasTransaction: workThreadHasTransactionProgress(thread),
    projectPath: thread.projectPath || plan?.projectPath || task?.projectPath || defaultWorkProjectPath(),
    planId,
    approvalId: approval?.approvalId || thread.approvalIds[0],
    workUid: plan?.workUid || task?.workUid,
    taskId: task?.id || thread.taskIds[0],
    paymentId: payment?.paymentId || thread.paymentIds[0],
  }
}

function planIdFromAgentResponse(response: MarketSearchResult) {
  const payload = response as MarketSearchResult & { planId?: unknown; plan_id?: unknown }
  return String(response.selectionRequest?.planId || payload.planId || payload.plan_id || '').trim()
}

function agentSessionChatThread(sessionId?: string) {
  const id = String(sessionId || '').trim()
  return id ? state.chatThreads.find((thread) => thread.agentSessionId === id) : undefined
}

function currentAgentChatThread() {
  if (state.newConversationDraft) return undefined
  return activeChatThread() || selectedChatThread()
}

function currentInteractiveAgentSession() {
  const sessionId = currentAgentChatThread()?.agentSessionId
  return sessionId ? state.localAgentSessions[sessionId] : undefined
}

function currentAgentTransactionId() {
  const thread = selectedWorkThread()
  return String(thread?.orderId || orderIdFromWorkThreadId(thread?.id) || thread?.taskIds[0] || '').trim()
}

function agentSessionCanReceiveMessage(session?: InteractiveAgentSession) {
  return Boolean(session && (session.status === 'ready' || session.status === 'busy' || session.status === 'waiting_user'))
}

function renderChatAgentControl() {
  const session = currentInteractiveAgentSession()
  const sellerTransactionMissing = state.workOrderSide === 'seller' && !currentAgentTransactionId()
  const status = state.chatAgentConnecting ? 'starting' : session?.status || 'stopped'
  const agentName = localAgentDisplayName(session?.driver || currentAgentChatThread()?.agentDriverId || state.localAgentBinding?.driverId)
  fields.chatAgentButton.dataset.sessionStatus = status
  fields.chatAgentButton.classList.remove('hidden')
  fields.chatAgentButton.disabled = state.busy || sellerTransactionMissing
  fields.chatAgentButton.setAttribute('aria-expanded', String(state.chatAgentMenuOpen && Boolean(session)))
  fields.chatAgentButton.setAttribute('aria-label', session ? `${agentName} session: ${status}` : `Connect ${agentName || 'local Agent'}`)
  fields.chatAgentButton.setAttribute('title', sellerTransactionMissing
    ? 'Select a seller transaction before connecting a local Agent.'
    : session
      ? `${agentName} · ${status}`
      : `Connect ${agentName || 'local Agent'}`)

  fields.chatAgentMenu.classList.toggle('hidden', !state.chatAgentMenuOpen || !session)
  if (state.chatAgentMenuOpen && session) {
    const canResume = session.status === 'stopped' || session.status === 'failed'
    const canStop = session.status !== 'stopped'
    const switchedBinding = Boolean(state.localAgentBinding?.driverId && state.localAgentBinding.driverId !== session.driver)
    fields.chatAgentMenu.innerHTML = `
      <div class="chat-agent-menu-copy"><strong>${escapeHTML(agentName)}</strong><span>${escapeHTML(session.status.replace('_', ' '))}${session.lastError ? ` · ${escapeHTML(compactText(session.lastError, 80))}` : ''}</span></div>
      ${canResume ? `<button class="permission-menu-item" type="button" data-chat-agent-action="resume" role="menuitem"><span class="permission-menu-text"><strong>Resume session</strong><small>Reuse ${escapeHTML(shortID(session.vendorSessionId || session.id))}</small></span></button>` : ''}
      ${switchedBinding ? `<button class="permission-menu-item" type="button" data-chat-agent-action="switch" role="menuitem"><span class="permission-menu-text"><strong>Switch to ${escapeHTML(localAgentDisplayName(state.localAgentBinding?.driverId))}</strong><small>Start a fresh vendor session for this chat</small></span></button>` : ''}
      ${canStop ? `<button class="permission-menu-item" type="button" data-chat-agent-action="stop" role="menuitem"><span class="permission-menu-text"><strong>Stop session</strong><small>Keep the vendor session ID for later resume</small></span></button>` : ''}
    `
  } else {
    fields.chatAgentMenu.innerHTML = ''
  }
  const externallyLocked = Boolean(activeExternalWorkLease() || activeExternalWorkRun()) && !session
  const sessionStarting = state.chatAgentConnecting || session?.status === 'starting'
  agentSendButton.disabled = state.busy || externallyLocked || sellerTransactionMissing || sessionStarting
}

function localAgentDisplayName(driverId?: string) {
  const id = String(driverId || '').trim()
  const bindingName = state.localAgentBinding?.driverId === id ? state.localAgentBinding.name : ''
  return state.localAgents.find((agent) => agent.driverId === id)?.name
    || bindingName
    || ({ codex: 'Codex', 'claude-code': 'Claude Code', gemini: 'Gemini CLI', 'github-copilot': 'GitHub Copilot CLI', opencode: 'OpenCode' } as Record<string, string>)[id]
    || 'Local Agent'
}

async function connectCurrentChatAgent(options: { switchAgent?: boolean } = {}): Promise<InteractiveAgentSession | undefined> {
  if (state.chatAgentConnecting) return
  if (!window.exora?.invoke) throw new Error('Local Agent sessions require the Electron app.')
  if (state.workOrderSide === 'seller' && !currentAgentTransactionId()) throw new Error('Select a seller transaction before connecting a local Agent.')
  const thread = ensureChatThread()
  thread.side = state.workOrderSide
  state.chatAgentConnecting = true
  state.chatAgentMenuOpen = false
  renderChatAgentControl()
  try {
    const response = await invoke<{ session: InteractiveAgentSession }>('local_agent_session_start', {
      input: {
        conversationId: thread.id,
        role: state.workOrderSide,
        workspace: thread.projectPath || defaultWorkProjectPath(),
        permissionMode: 'ask',
        transactionId: currentAgentTransactionId(),
        workUid: '',
        runId: '',
        idempotencyKey: `connect:${thread.id}:${state.workOrderSide}:${options.switchAgent ? crypto.randomUUID() : thread.agentSessionId || 'default'}`,
      },
    })
    const session = response.session
    state.localAgentSessions[session.id] = session
    thread.agentSessionId = session.id
    thread.agentDriverId = session.driver
    thread.agentEventCursor = thread.agentEventCursor || 0
    thread.updatedAt = Date.now()
    flushSaveChatThread(thread)
    await subscribeLocalAgentSession(thread, session)
    showToast(`${localAgentDisplayName(session.driver)} connected in the background.`)
    return session
  } finally {
    state.chatAgentConnecting = false
    renderChatAgentControl()
    renderChat()
  }
}

async function resumeCurrentChatAgent(): Promise<InteractiveAgentSession | undefined> {
  const session = currentInteractiveAgentSession()
  if (!session) return
  const response = await invoke<{ session: InteractiveAgentSession }>('local_agent_session_resume', { input: { sessionId: session.id } })
  state.localAgentSessions[session.id] = response.session
  state.chatAgentMenuOpen = false
  const thread = agentSessionChatThread(session.id)
  if (thread) await subscribeLocalAgentSession(thread, response.session)
  renderChatAgentControl()
  return response.session
}

async function stopCurrentChatAgent() {
  const session = currentInteractiveAgentSession()
  if (!session) return
  const response = await invoke<{ session: InteractiveAgentSession }>('local_agent_session_stop', { input: { sessionId: session.id } })
  state.localAgentSessions[session.id] = response.session
  state.chatAgentMenuOpen = false
  renderChatAgentControl()
}

async function switchCurrentChatAgent() {
  const old = currentInteractiveAgentSession()
  if (old && old.status !== 'stopped') await invoke('local_agent_session_stop', { input: { sessionId: old.id } })
  const thread = currentAgentChatThread()
  if (thread) {
    thread.agentSessionId = undefined
    thread.agentDriverId = undefined
    thread.agentEventCursor = 0
    flushSaveChatThread(thread)
  }
  await connectCurrentChatAgent({ switchAgent: true })
}

async function subscribeLocalAgentSession(thread: ChatThread, session: InteractiveAgentSession) {
  await invoke('local_agent_session_subscribe', { input: { sessionId: session.id, after: thread.agentEventCursor || 0 } })
}

async function hydrateLocalAgentChatSessions() {
  try {
    const result = await invoke<{ binding?: LocalAgentBinding | null }>('local_agent_binding')
    state.localAgentBinding = result.binding || undefined
    state.localAgentSnapshotLoaded = true
  } catch {
    // Dock startup can race hydration; the connect action retries through main.
  }
  for (const thread of state.chatThreads) {
    if (!thread.agentSessionId) continue
    try {
      const response = await invoke<{ session: InteractiveAgentSession }>('local_agent_session_get', { input: { sessionId: thread.agentSessionId } })
      state.localAgentSessions[response.session.id] = response.session
      await subscribeLocalAgentSession(thread, response.session)
    } catch (error) {
      console.warn(`Failed to restore local Agent session ${thread.agentSessionId}:`, error)
    }
  }
  renderChatAgentControl()
}

function appendAgentSessionMessage(thread: ChatThread, input: Omit<ChatMessage, 'id'>) {
  const message: ChatMessage = { id: nextID(), ...input }
  thread.messages.push(message)
  thread.updatedAt = Date.now()
  if (thread.title === 'New chat' && message.role === 'user') thread.title = chatTitle(message)
  scheduleSaveChatThread(thread)
  if (thread.id === state.selectedChatId) {
    forceChatFeedScrollBottom = true
    renderChat()
    renderLedger()
  }
  return message.id
}

function handleLocalAgentEventPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  const envelope = payload as { sessionId?: unknown; event?: unknown; error?: unknown }
  if (handleSellerCardAgentEvent(envelope)) return
  const sessionId = String(envelope.sessionId || '').trim()
  const thread = agentSessionChatThread(sessionId)
  const session = state.localAgentSessions[sessionId]
  if (!thread || !session) return
  if (envelope.error) {
    session.status = 'failed'
    session.lastError = String(envelope.error)
    renderChatAgentControl()
    return
  }
  if (!envelope.event || typeof envelope.event !== 'object' || Array.isArray(envelope.event)) return
  const event = envelope.event as AgentSessionEvent
  if (!Number.isFinite(Number(event.seq)) || Number(event.seq) <= Number(thread.agentEventCursor || 0)) return
  thread.agentEventCursor = Number(event.seq)
  session.eventCursor = Math.max(session.eventCursor || 0, Number(event.seq))
  const messageKey = `${sessionId}:${event.messageId || event.turnId || 'turn'}`
  if (event.kind === 'turn.started') session.status = 'busy'
  if (event.kind === 'session.ready' || event.kind === 'turn.completed' || event.kind === 'turn.interrupted') session.status = 'ready'
  if (event.kind === 'session.stopped') session.status = 'stopped'
  if (event.kind === 'driver.failure' || event.kind === 'turn.failed') {
    session.status = 'failed'
    session.lastError = event.text || 'Local Agent failed.'
  }
  if (event.kind === 'agent.message.delta' || event.kind === 'agent.message.completed') {
    const existingId = localAgentAssistantMessages.get(messageKey)
    const previous = localAgentAssistantBuffers.get(messageKey) || ''
    const nextText = event.kind === 'agent.message.delta' ? previous + String(event.text || '') : String(event.text || '') || previous
    localAgentAssistantBuffers.set(messageKey, nextText)
    if (existingId) {
      const message = thread.messages.find((item) => item.id === existingId)
      if (message) {
        message.text = nextText
        message.pending = event.kind !== 'agent.message.completed'
      }
    } else if (nextText) {
      const id = appendAgentSessionMessage(thread, {
        role: 'assistant',
        actor: session.role === 'seller' ? 'seller_agent' : 'buyer_agent',
        text: nextText,
        meta: localAgentDisplayName(session.driver),
        pending: event.kind !== 'agent.message.completed',
      })
      localAgentAssistantMessages.set(messageKey, id)
    }
    if (event.kind === 'agent.message.completed') flushSaveChatThread(thread)
  } else if (event.kind === 'mcp.event') {
    appendAgentSessionMessage(thread, { kind: 'order_event', role: 'assistant', actor: session.role === 'seller' ? 'seller_agent' : 'buyer_agent', text: event.text || 'Exora MCP recorded a structured Agent event.', meta: 'Exora MCP' })
  } else if ((event.kind === 'driver.failure' || event.kind === 'turn.failed') && event.text) {
    appendAgentSessionMessage(thread, { role: 'system', text: event.text, meta: 'Local Agent' })
  }
  thread.updatedAt = Date.now()
  scheduleSaveChatThread(thread)
  renderChatAgentControl()
}

async function submitAgentMessage() {
  const query = agentQuery.value.trim()
  if (!query || state.busy) return
  let session = currentInteractiveAgentSession()
  if (!agentSessionCanReceiveMessage(session)) {
    try {
      session = session?.status === 'stopped' || session?.status === 'failed'
        ? await resumeCurrentChatAgent()
        : await connectCurrentChatAgent()
    } catch (error) {
      const message = humanizeError(error)
      showToast(message)
      return
    }
    if (!agentSessionCanReceiveMessage(session)) {
      showToast(session?.lastError || 'The bound local Agent could not start a chat session.')
      return
    }
  }
  closePermissionMenu()
  setActiveView('chat')
  renderViewTabs()
  agentQuery.value = ''
  resizeAgentComposer()
  const clientMessageId = `agent-message-${crypto.randomUUID()}`
  pushMessage({ role: 'user', actor: state.workOrderSide === 'seller' ? 'seller_human' : 'buyer_human', text: query })
  try {
    await invoke('local_agent_session_send', { input: { sessionId: session!.id, clientMessageId, text: query, idempotencyKey: `send:${clientMessageId}` } })
  } catch (error) {
    appendAgentSessionMessage(currentAgentChatThread()!, { role: 'system', text: humanizeError(error), meta: 'Local Agent' })
  }
}

function renderStatus(status: AppStatus) {
  state.appStatus = status
  fields.daemon.textContent = status.daemon
  fields.daemon.dataset.state = status.daemon
}

type ChatFeedScrollSnapshot = {
  key: string
  previousTop: number
  wasNearBottom: boolean
  keyChanged: boolean
  savedTop?: number
  forceBottom: boolean
}

function chatFeedIsNearBottom() {
  return fields.chatFeed.scrollHeight - fields.chatFeed.scrollTop - fields.chatFeed.clientHeight <= 48
}

function prepareChatFeedRender(key: string): ChatFeedScrollSnapshot {
  if (lastChatFeedRenderKey) {
    chatFeedScrollPositions.set(lastChatFeedRenderKey, fields.chatFeed.scrollTop)
  }
  return {
    key,
    previousTop: fields.chatFeed.scrollTop,
    wasNearBottom: chatFeedIsNearBottom(),
    keyChanged: key !== lastChatFeedRenderKey,
    savedTop: chatFeedScrollPositions.get(key),
    forceBottom: forceChatFeedScrollBottom,
  }
}

function applyChatFeedScroll(snapshot: ChatFeedScrollSnapshot, options: { defaultToBottom?: boolean } = {}) {
  const maxTop = Math.max(0, fields.chatFeed.scrollHeight - fields.chatFeed.clientHeight)
  const shouldStickToBottom = snapshot.forceBottom || (!snapshot.keyChanged && snapshot.wasNearBottom)
  const nextTop = shouldStickToBottom
    ? maxTop
    : snapshot.keyChanged
      ? snapshot.savedTop ?? (options.defaultToBottom ? maxTop : 0)
      : snapshot.previousTop
  fields.chatFeed.scrollTop = Math.min(Math.max(0, nextTop), maxTop)
  lastChatFeedRenderKey = snapshot.key
  forceChatFeedScrollBottom = false
  chatFeedScrollPositions.set(snapshot.key, fields.chatFeed.scrollTop)
}

function renderChat() {
  renderChatSurface()
  fields.transactionOverlay.innerHTML = ''
  fields.chatView.classList.remove('has-transaction-flow')
  if (sellerMonitorActive()) {
    const scrollSnapshot = prepareChatFeedRender(`seller-monitor:${state.workOrderSide}`)
    renderTransactionDetailSidebar()
    fields.chatFeed.innerHTML = renderSellerMonitorDashboard()
    attachSellerMonitorHandlers()
    localize(fields.chatFeed)
    applyChatFeedScroll(scrollSnapshot)
    return
  }
  if (state.newConversationDraft) {
    const scrollSnapshot = prepareChatFeedRender(`draft:${state.workOrderSide}`)
    renderTransactionDetailSidebar()
    fields.chatFeed.innerHTML = state.workOrderSide === 'seller'
      ? renderSellerMonitorDashboard()
      : `<div class="chat-empty-state"><h2>${t('chat.empty')}</h2></div>`
    if (state.workOrderSide === 'seller') attachSellerMonitorHandlers()
    localize(fields.chatFeed)
    applyChatFeedScroll(scrollSnapshot)
    return
  }
  const workThread = selectedWorkThread()
  const workSide = workThread?.side || state.workOrderSide
  const chatThread = workThread
    ? workThread.chatId
      ? state.chatThreads.find((thread) => thread.id === workThread.chatId)
      : undefined
    : selectedChatThread()
  const messages = chatThread?.messages || []
  const events = workThread ? workEventsForThread(workThread) : []
  const buyerDraftTransaction = Boolean(workThread && workSide === 'buyer' && messages.length > 0)
  const progressPanel = workThread && (workThreadHasTransactionProgress(workThread) || buyerDraftTransaction) ? renderTransactionProgressPanel(workThread, workSide) : ''
  const transactionFlow = progressPanel
    ? `<section class="transaction-flow-frame">${progressPanel}</section>`
    : ''
  const chatStream = progressPanel && workThread
    ? renderTransactionTimeline(workThread, workSide, messages)
    : renderContinuousChatStream(messages)
  const chatFeedRenderKey = workThread
    ? `work:${workThread.id}`
    : chatThread
      ? `chat:${chatThread.id}`
      : `empty:${workSide}`
  if (!workThread && messages.length === 0 && events.length === 0) {
    const scrollSnapshot = prepareChatFeedRender(chatFeedRenderKey)
    renderTransactionDetailSidebar()
    fields.chatFeed.innerHTML = state.workOrderSide === 'seller'
      ? renderSellerMonitorDashboard()
      : `<div class="chat-empty-state"><h2>${t('chat.empty')}</h2></div>`
    if (state.workOrderSide === 'seller') attachSellerMonitorHandlers()
    localize(fields.chatFeed)
    applyChatFeedScroll(scrollSnapshot)
    return
  }
  if (!progressPanel && messages.length === 0 && events.length === 0) {
    const scrollSnapshot = prepareChatFeedRender(chatFeedRenderKey)
    renderTransactionDetailSidebar()
    fields.chatFeed.innerHTML = `<div class="chat-empty-state"><h2>${t('chat.empty')}</h2></div>`
    localize(fields.chatFeed)
    applyChatFeedScroll(scrollSnapshot)
    return
  }
  if (transactionFlow) {
    fields.transactionOverlay.innerHTML = transactionFlow
    fields.chatView.classList.add('has-transaction-flow')
    attachTransactionStageHandlers(fields.transactionOverlay)
    localize(fields.transactionOverlay)
  }
  const scrollSnapshot = prepareChatFeedRender(chatFeedRenderKey)
  renderTransactionDetailSidebar()
  fields.chatFeed.innerHTML = chatStream
  attachTransactionStageHandlers(fields.chatFeed)
  attachDecisionHandlers(fields.chatFeed)
  localize(fields.chatFeed)
  const pendingScroll = pendingTransactionStageScroll
  if (pendingScroll && workThread && pendingScroll.threadId === workThread.id) {
    pendingTransactionStageScroll = undefined
    applyChatFeedScroll(scrollSnapshot, { defaultToBottom: Boolean(chatStream) })
    window.requestAnimationFrame(() => {
      fields.chatFeed.querySelector<HTMLElement>(`[data-transaction-stage-card="${CSS.escape(pendingScroll.stageId)}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest' })
      chatFeedScrollPositions.set(scrollSnapshot.key, fields.chatFeed.scrollTop)
    })
  } else {
    applyChatFeedScroll(scrollSnapshot, { defaultToBottom: Boolean(chatStream) })
  }
}

function renderSellerMonitorDashboard() {
  const records = orderActivityRecords()
  const metrics = sellerMonitorMetrics(records)
  const seller = state.agentCards.seller?.manualFields.seller
  const status = state.sellerMarketStatus
  const apiReady = sellerApiReady()
  const apiProfile = state.sellerLLMProfileId
    ? state.llmProfiles.find((profile) => profile.id === state.sellerLLMProfileId)
    : undefined
  const listed = Boolean(state.sellerSettings?.enabled)
  const discoverable = Boolean(status?.discoverable)
  const resourceCount = status?.resourceListingCount ?? 0
  const providerId = status?.providerId || state.sellerSettings?.providerId || 'not set'
  const storeName = seller?.displayName || 'Seller Store'
  const listingTitle = listed ? 'Unlist seller' : 'List seller'
  const listingStateText = listed ? '\u4e0a\u67b6\u4e2d' : '\u5df2\u4e0b\u67b6'
  const listingStateDetail = listed
    ? 'Accepting buyer signals when store requirements are ready.'
    : 'Hidden from new buyer matching until you list again.'
  const discoverableCopy = discoverable ? 'Discoverable' : listed ? 'Not discoverable' : 'Unlisted'
  const discoverableTone = discoverable ? 'good' : listed ? 'warn' : 'neutral'
  const sellerCardPublished = state.agentCards.seller?.status === 'published'
  const discoverabilityIssues = [
    !listed ? 'not listed' : '',
    !apiReady ? 'API profile missing' : '',
    !sellerCardPublished ? 'Seller Card unpublished' : '',
    resourceCount <= 0 ? 'no resource listings' : '',
  ].filter(Boolean)
  const readinessItems = [
    {
      label: 'API profile',
      value: apiReady ? `${apiProfile?.name || 'Seller API'} ready` : 'Required',
      detail: 'Seller valuation and execution are API-only.',
      tone: apiReady ? 'good' : 'warn',
    },
    {
      label: 'Listing',
      value: listed ? 'Listed' : 'Unlisted',
      detail: listed ? 'Seller can receive buyer valuation requests.' : 'Hidden from incoming seller work.',
      tone: listed ? 'good' : 'neutral',
    },
    {
      label: 'Seller Card',
      value: state.agentCards.seller ? progressStateLabel(state.agentCards.seller.status) : 'Missing',
      detail: sellerCardPublished ? 'Buyer matching can read this seller profile.' : 'Publish a card so buyers can match your store.',
      tone: sellerCardPublished ? 'good' : 'warn',
    },
    {
      label: 'Market discoverable',
      value: discoverableCopy,
      detail: discoverable
        ? `${resourceCount} resource listing(s)`
        : discoverabilityIssues.length
          ? `Missing: ${discoverabilityIssues.join(', ')}.`
          : 'Market status has not loaded yet.',
      tone: discoverableTone,
    },
  ] as const
  return `
    <section class="seller-monitor-view" aria-label="Seller monitor">
      <div class="seller-monitor-head">
        <div class="seller-monitor-title">
          <span class="seller-monitor-eyebrow">${roleTabIcons.seller}<span>Store Status</span></span>
          <h2><span>${escapeHTML(storeName)}</span></h2>
          <div class="seller-monitor-status-strip" aria-label="Store status">
            ${renderSellerMonitorPill('Provider', shortID(providerId), 'neutral')}
            ${renderSellerMonitorPill('Market', discoverableCopy, discoverableTone)}
            ${renderSellerMonitorPill('Resources', String(resourceCount), resourceCount > 0 ? 'good' : 'warn')}
            ${renderSellerMonitorPill('API', apiReady ? 'Ready' : 'Required', apiReady ? 'good' : 'warn')}
          </div>
        </div>
        <div class="seller-monitor-head-actions">
          <div class="seller-listing-row ${listed ? 'listed' : 'unlisted'}">
            <div class="seller-listing-copy">
              <strong>Marketplace listing</strong>
              <small>${escapeHTML(listingStateDetail)}</small>
            </div>
            <button class="seller-listing-toggle ${listed ? 'listed' : 'unlisted'}" type="button" role="switch" data-seller-listing-toggle data-state="${listed ? 'listed' : 'unlisted'}" aria-checked="${listed}" aria-pressed="${listed}" title="${escapeAttr(listingTitle)}">
              <span class="seller-listing-toggle-dot" aria-hidden="true"></span>
              <span>${escapeHTML(listingStateText)}</span>
            </button>
          </div>
          <div class="seller-monitor-actions" aria-label="Seller setup shortcuts">
            <button type="button" data-seller-store-action="api" title="API settings">${profileIcons.settings}<span>API</span></button>
            <button type="button" data-seller-store-action="seller" title="Seller agent">${roleTabIcons.seller}<span>Agent</span></button>
            <button type="button" data-seller-store-action="card" title="Seller card">${cardActionIcons.edit}<span>Card</span></button>
          </div>
        </div>
      </div>
      <div class="seller-monitor-kpis">
        ${renderSellerMonitorKpi('Revenue', metrics.revenue, `Net est. ${metrics.providerNet}; protocol fee ${metrics.protocolFee}.`, WalletCards, 'good')}
        ${renderSellerMonitorKpi('Pending escrow', metrics.pendingEscrow, 'Unconfirmed local payment records.', ShieldCheck, metrics.pendingEscrow === '0 USDC' ? 'neutral' : 'warn')}
        ${renderSellerMonitorKpi('Orders', String(records.length), 'Local order signals.', SquareKanban, records.length ? 'good' : 'neutral')}
        ${renderSellerMonitorKpi('Token usage', metrics.tokens, 'Usage accounting is not tracked yet.', Activity, 'neutral')}
        ${renderSellerMonitorKpi('Quote rate', metrics.quoteRate, `${metrics.accepted} accepted from ${metrics.valuationRequests} valuation signal(s).`, BadgeCheck, metrics.accepted ? 'good' : 'neutral')}
        ${renderSellerMonitorKpi('Execution health', metrics.executionHealth, `${metrics.completed} completed / ${metrics.failed} failed.`, Network, metrics.blocked || metrics.failed ? 'warn' : 'good')}
      </div>
      <div class="seller-monitor-sections">
        <section class="seller-monitor-section seller-monitor-flow" aria-label="Seller flow">
          <div class="seller-monitor-section-head">
            <h3>Seller flow</h3>
            <span>local signals</span>
          </div>
          <div class="seller-flow-grid">
            ${renderSellerFlowMetric('Valuation', metrics.valuationRequests, 'Buyer manifests received', 'normal')}
            ${renderSellerFlowMetric('Negotiate', metrics.needsNegotiation, 'Blocking quote questions', metrics.needsNegotiation ? 'warn' : 'normal')}
            ${renderSellerFlowMetric('Accepted', metrics.accepted, 'Quote accepted or task created', metrics.accepted ? 'good' : 'normal')}
            ${renderSellerFlowMetric('Running', metrics.running, 'Provider execution active', metrics.running ? 'warn' : 'normal')}
            ${renderSellerFlowMetric('Blocked', metrics.blocked, 'Needs buyer or local supervisor', metrics.blocked ? 'warn' : 'normal')}
            ${renderSellerFlowMetric('Terminal', metrics.terminalReports, 'Success/failure reports', metrics.terminalReports ? 'good' : 'normal')}
            ${renderSellerFlowMetric('Cleanup', metrics.cleanupReceipts, 'Artifact and cleanup receipts', metrics.cleanupReceipts ? 'good' : 'normal')}
          </div>
        </section>
        <section class="seller-monitor-section seller-monitor-readiness" aria-label="Store readiness">
          <div class="seller-monitor-section-head">
            <h3>Store status</h3>
            <span>${escapeHTML(discoverableCopy)}</span>
          </div>
          <div class="seller-readiness-list">
            ${readinessItems.map(renderSellerReadinessItem).join('')}
          </div>
        </section>
      </div>
      <section class="seller-monitor-orders">
        <div class="seller-monitor-section-head">
          <h3>Orders</h3>
          <span>${records.length} local</span>
        </div>
        <div class="seller-monitor-order-list">
          ${records.length ? records.map(renderSellerMonitorOrderRow).join('') : renderStageEmpty('No seller orders yet. Seller orders appear after buyer matching, quote, payment, execution, or old readable records exist.')}
        </div>
      </section>
    </section>
  `
}

function renderSellerMonitorPill(label: string, value: string, tone: 'neutral' | 'good' | 'warn' | 'bad') {
  return `
    <span class="seller-monitor-pill ${tone}">
      <small>${escapeHTML(label)}</small>
      <strong>${escapeHTML(value)}</strong>
    </span>
  `
}

function renderSellerMonitorKpi(label: string, value: string, hint: string, iconNode: IconNode, tone: 'neutral' | 'good' | 'warn' | 'bad') {
  return `
    <article class="seller-monitor-kpi ${tone}">
      <span class="seller-monitor-kpi-icon">${icon(iconNode)}</span>
      <span class="seller-monitor-kpi-label">${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
      <small>${escapeHTML(hint)}</small>
    </article>
  `
}

function renderSellerFlowMetric(label: string, value: number, detail: string, tone: 'normal' | 'good' | 'warn' | 'bad') {
  return `
    <div class="seller-flow-metric ${tone}">
      <strong>${escapeHTML(String(value))}</strong>
      <span>${escapeHTML(label)}</span>
      <small>${escapeHTML(detail)}</small>
    </div>
  `
}

function renderSellerReadinessItem(item: { label: string; value: string; detail: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }) {
  return `
    <div class="seller-readiness-item ${item.tone}">
      <span aria-hidden="true"></span>
      <div>
        <strong>${escapeHTML(item.label)}</strong>
        <small>${escapeHTML(item.detail)}</small>
      </div>
      <em>${escapeHTML(item.value)}</em>
    </div>
  `
}

function sellerMonitorMetrics(records: OrderActivityRecord[]) {
  const confirmedStatuses = new Set(['confirmed', 'confirmed_simulated', 'found_finalized'])
  const grossTotals = new Map<string, number>()
  const pendingTotals = new Map<string, number>()
  for (const payment of state.payments) {
    if (orderSideForPayment(payment) !== 'seller') continue
    const amount = Number(payment.amount || 0)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const currency = payment.currency || 'USDC'
    const target = confirmedStatuses.has(payment.status || '') ? grossTotals : pendingTotals
    target.set(currency, (target.get(currency) || 0) + amount)
  }
  const sellerPlans = state.orderPlans.filter((plan) => orderSideForPlan(plan) === 'seller')
  const sellerTasks = state.tasks.filter((task) => orderSideForTask(task) === 'seller')
  const sellerRunsAndEvents = sellerMonitorRunsAndEvents(records)
  const candidates = sellerPlans.flatMap((plan) => plan.candidates || [])
  const quotedCandidates = candidates.filter((candidate) => candidate.status === 'quoted' || Number(candidate.priceAmount || 0) > 0)
  const needsNegotiation = candidates.filter((candidate) => candidate.status === 'needs_negotiation').length
  const rejected = candidates.filter((candidate) => ['reject', 'rejected'].includes(candidate.status || '')).length
  const acceptedPlans = sellerPlans.filter((plan) => Boolean(plan.selectedOptionId || plan.taskId)).length
  const accepted = acceptedPlans + sellerTasks.length
  const runStatus = (run: WorkRun) => [run.status, run.currentStep].filter(Boolean).join(' ').toLowerCase()
  const eventText = (event: WorkRunEvent) => [event.type, event.status, event.step, event.summary].filter(Boolean).join(' ').toLowerCase()
  const running = sellerTasks.filter((task) => ['consented', 'claimed', 'running'].includes(task.status || '')).length
    + sellerRunsAndEvents.runs.filter((run) => ['queued', 'running', 'waiting_worker'].includes(run.status || '')).length
  const blocked = sellerRunsAndEvents.runs.filter((run) => runStatus(run).includes('blocked')).length
    + sellerRunsAndEvents.events.filter((event) => eventText(event).includes('blocked')).length
  const failed = sellerTasks.filter((task) => task.status === 'failed').length
    + sellerRunsAndEvents.runs.filter((run) => run.status === 'failed').length
  const completed = sellerTasks.filter((task) => task.status === 'completed').length
    + sellerRunsAndEvents.runs.filter((run) => run.status === 'completed').length
  const terminalReports = sellerTasks.filter((task) => ['completed', 'failed'].includes(task.status || '')).length
    + sellerRunsAndEvents.events.filter((event) => includesAny(eventText(event), ['terminal_report', 'artifact', 'fetch_artifacts'])).length
  const cleanupReceipts = sellerRunsAndEvents.events.filter((event) => includesAny(eventText(event), ['cleanup', 'cleanup_receipt', 'artifact_and_cleanup_receipt'])).length
  return {
    tokens: 'Not tracked',
    revenue: currencyTotalsText(grossTotals),
    providerNet: currencyTotalsText(scaleCurrencyTotals(grossTotals, 0.94)),
    protocolFee: currencyTotalsText(scaleCurrencyTotals(grossTotals, 0.06)),
    pendingEscrow: currencyTotalsText(pendingTotals),
    requests: `${records.length} local`,
    valuationRequests: sellerPlans.length,
    canAccept: quotedCandidates.length + sellerTasks.filter((task) => task.quote).length,
    needsNegotiation,
    rejected,
    accepted,
    quoteRate: sellerPlans.length ? `${Math.round((accepted / sellerPlans.length) * 100)}%` : '0%',
    executionHealth: `${running} running / ${blocked} blocked`,
    running,
    blocked,
    failed,
    completed,
    terminalReports,
    cleanupReceipts,
  }
}

function sellerMonitorRunsAndEvents(records: OrderActivityRecord[]) {
  const runs = new Map<string, WorkRun>()
  const events = new Map<string, WorkRunEvent>()
  for (const record of records) {
    const thread = workThreadById(record.threadId, { includeArchived: true, side: 'seller' })
    if (!thread) continue
    const data = transactionProgressData(thread)
    for (const run of data.workRuns) runs.set(run.runId, run)
    for (const event of data.workRunEvents) events.set(event.eventId || `${event.runId}:${event.type}:${event.createdAt}`, event)
  }
  return { runs: [...runs.values()], events: [...events.values()] }
}

function scaleCurrencyTotals(totals: Map<string, number>, factor: number) {
  const next = new Map<string, number>()
  for (const [currency, amount] of totals) next.set(currency, amount * factor)
  return next
}

function currencyTotalsText(totals: Map<string, number>) {
  return [...totals.entries()]
    .map(([currency, amount]) => `${trimDisplayNumber(amount)} ${currency}`)
    .join(' / ') || '0 USDC'
}

function renderSellerMonitorOrderRow(record: OrderActivityRecord) {
  const thread = workThreadById(record.threadId, { includeArchived: true, side: 'seller' })
  const unread = state.workTaskState.unreadIds.has(record.threadId)
  const pinned = state.workTaskState.pinnedIds.has(record.threadId)
  const status = thread?.status || record.subtitle.split('/')[0]?.trim() || 'transaction'
  const classes = ['seller-monitor-order', unread ? 'unread' : '', pinned ? 'pinned' : ''].filter(Boolean).join(' ')
  return `
    <button class="${classes}" type="button" data-order-activity data-order-thread-id="${escapeAttr(record.threadId)}" data-order-chat-id="${escapeAttr(record.chatId || '')}" data-order-select="${escapeAttr(record.primarySelectionId || '')}" data-order-project-path="${escapeAttr(record.projectPath)}" title="${escapeAttr([record.title, record.subtitle].filter(Boolean).join(' / '))}">
      <span class="seller-monitor-order-main">
        <strong>${escapeHTML(compactText(record.title, 78))}</strong>
        <small>${escapeHTML(record.subtitle || 'Seller transaction')}</small>
      </span>
      <span class="seller-monitor-order-meta">
        <em>${escapeHTML(progressStateLabel(status))}</em>
        <small>${escapeHTML(compactTimestamp(record.timestamp))}</small>
      </span>
    </button>
  `
}

function attachSellerMonitorHandlers() {
  attachSellerStoreSummaryHandlers(fields.chatFeed)
  fields.chatFeed.querySelector<HTMLButtonElement>('[data-seller-listing-toggle]')?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    void toggleSellerListing()
  })
  attachOrderActivityHandlers(fields.chatFeed, false)
}

function renderContinuousChatStream(messages: ChatMessage[]) {
  const content = messages.map(renderChatMessage).join('')
  return content ? `<section class="transaction-chat-stream">${content}</section>` : ''
}

function renderTransactionTimeline(thread: WorkThread, side: OrderSide, messages: ChatMessage[]) {
  const snapshot = buildTransactionProgressSnapshot(thread, side)
  const selectedStageId = selectedTransactionStageId(thread, snapshot)
  const messagesByStage = transactionMessagesByStage(side, snapshot, messages)
  const content = snapshot.stages.map((stage, index) => {
    const stageMessages = messagesByStage.get(stage.id) || []
    if (!transactionTimelineShouldRenderStage(stage, snapshot, selectedStageId, stageMessages)) return ''
    return `
      <section class="transaction-stage-segment" data-transaction-stage-segment="${escapeAttr(stage.id)}">
        ${renderTransactionStageCard(stage, index, snapshot, selectedStageId)}
        ${renderContinuousChatStream(stageMessages)}
      </section>
    `
  }).filter(Boolean).join('')
  return content
    ? `<section class="transaction-timeline" aria-label="Transaction timeline">${content}</section>`
    : renderContinuousChatStream(messages)
}

function transactionTimelineShouldRenderStage(stage: TransactionProgressStage, snapshot: TransactionProgressSnapshot, selectedStageId: string, messages: ChatMessage[]) {
  return Boolean(
    messages.length ||
    stage.status === 'complete' ||
    stage.status === 'failed' ||
    stage.id === selectedStageId ||
    stage.id === snapshot.currentStageId ||
    ['active', 'waiting', 'blocked'].includes(stage.status),
  )
}

function transactionMessagesByStage(side: OrderSide, snapshot: TransactionProgressSnapshot, messages: ChatMessage[]) {
  const stageIds = new Set(snapshot.stages.map((stage) => stage.id))
  const fallbackStageId = stageIds.has(snapshot.currentStageId) ? snapshot.currentStageId : snapshot.stages[0]?.id || ''
  const grouped = new Map<string, ChatMessage[]>()
  let lastStageWithContent = ''
  for (const message of messages) {
    const explicitStageId = normalizeMessageStageIdForSide(side, message.stageId)
    const inferredStageId = explicitStageId && stageIds.has(explicitStageId)
      ? explicitStageId
      : inferTransactionMessageStageId(side, message, snapshot)
    const stageId = stageIds.has(inferredStageId)
      ? inferredStageId
      : lastStageWithContent || fallbackStageId
    if (!stageId) continue
    const existing = grouped.get(stageId) || []
    existing.push(message)
    grouped.set(stageId, existing)
    lastStageWithContent = stageId
  }
  return grouped
}

function normalizeMessageStageIdForSide(side: OrderSide, stageId?: string) {
  const normalized = normalizeTransactionStageId(stageId)
  if (side === 'seller') {
    if (normalized === 'intent' || normalized === 'plan') return 'task_valuation'
    if (normalized === 'offer') return 'quote_response'
    if (normalized === 'authorize') return 'wait_buyer'
    if (normalized === 'execute') return 'provider_execution'
    if (normalized === 'verify') return 'terminal_report'
  }
  return normalized
}

function inferTransactionMessageStageId(side: OrderSide, message: ChatMessage, snapshot: TransactionProgressSnapshot) {
  const haystack = [message.meta, message.text, message.result?.summary, message.result?.nextAction]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (side === 'seller') {
    if (includesAny(haystack, ['settlement', 'cleanup receipt', 'cleanup', 'release', 'refund', 'dispute', 'closed', 'payout'])) return 'settlement'
    if (includesAny(haystack, ['terminal report', 'artifact', 'hash', 'delivery', 'completed', 'failed', 'failure evidence', 'log summary'])) return 'terminal_report'
    if (includesAny(haystack, ['supervisor', 'heartbeat', 'blocked', 'recover', 'waiting_worker', 'worker heartbeat'])) return 'local_supervisor'
    if (includesAny(haystack, ['provider execution', 'docker', 'container', 'running', 'checkpoint', 'provider job'])) return 'provider_execution'
    if (includesAny(haystack, ['input receipt', 'input transfer', 'execution plan', 'plan hash', 'step list', 'submit worker'])) return 'execution_plan'
    if (includesAny(haystack, ['approval', 'authorization', 'authorize', 'escrow', 'payment', 'pin', 'buyer selected', 'wait for buyer'])) return 'wait_buyer'
    if (includesAny(haystack, ['quote', 'price', 'eta', 'can accept', 'reject', 'rejected', 'clarification', 'clarify', 'negotiate', 'negotiation'])) return 'quote_response'
    if (includesAny(haystack, ['manifest', 'valuation', 'seller card', 'capability', 'inbound'])) return 'task_valuation'
    return snapshot.currentStageId
  }
  if (includesAny(haystack, ['settlement', 'release', 'refund', 'dispute', 'closed', 'accept', 'accepted', 'artifact', 'hash', 'verify', 'verification', 'terminal', 'completed', 'failed', 'repair'])) return 'verify'
  if (includesAny(haystack, ['execute', 'execution', 'provider', 'docker', 'worker', 'running', 'checkpoint', 'queued', 'input transfer'])) return 'execute'
  if (includesAny(haystack, ['approval', 'authorize', 'authorization', 'permission', 'sensitive', 'payment', 'escrow', 'pin', 'proof'])) return 'authorize'
  if (message.result || includesAny(haystack, ['offer', 'quote', 'seller', 'price', 'matching', 'cloud', 'candidate', 'clarify', 'negotiation', 'valuation', 'rejected'])) return 'offer'
  if (includesAny(haystack, ['plan', 'manifest', 'requirement', 'constraint', 'budget', 'output', 'review'])) return 'plan'
  if (message.role === 'user' || includesAny(haystack, ['intent', 'request', 'need', 'draft'])) return 'intent'
  return snapshot.currentStageId
}

function renderTransactionStageCards(thread: WorkThread, side: OrderSide) {
  const snapshot = buildTransactionProgressSnapshot(thread, side)
  const selectedStageId = selectedTransactionStageId(thread, snapshot)
  return `
    <section class="transaction-stage-card-list" aria-label="Transaction stage cards">
      ${snapshot.stages.map((stage, index) => renderTransactionStageCard(stage, index, snapshot, selectedStageId)).join('')}
    </section>
  `
}

function renderTransactionStageCard(stage: TransactionProgressStage, index: number, snapshot: TransactionProgressSnapshot, selectedStageId: string) {
  const facts = transactionStageCardFacts(stage, snapshot)
  const selected = stage.id === selectedStageId
  return `
    <button class="transaction-stage-card ${stage.status}${selected ? ' selected' : ''}" type="button" data-transaction-stage-card="${escapeAttr(stage.id)}" aria-pressed="${selected ? 'true' : 'false'}">
      <span class="transaction-stage-card-index">${index + 1}</span>
      <span class="transaction-stage-card-body">
        <span class="transaction-stage-card-top">
          <strong>${escapeHTML(stage.title)}</strong>
          <span class="transaction-stage-card-status">${escapeHTML(progressStateLabel(stage.status))}</span>
        </span>
        <span class="transaction-stage-card-summary">${escapeHTML(transactionStageCardSummary(stage, snapshot))}</span>
        ${facts.length ? `<span class="transaction-stage-card-facts">${facts.map((fact) => `<em class="transaction-stage-card-fact">${escapeHTML(fact)}</em>`).join('')}</span>` : ''}
      </span>
    </button>
  `
}

function transactionStageCardSummary(stage: TransactionProgressStage, snapshot: TransactionProgressSnapshot) {
  if (stage.id === snapshot.currentStageId) return snapshot.nextAction || stage.detail
  if (stage.status === 'complete') return 'Completed in this transaction.'
  if (stage.status === 'failed') return snapshot.nextAction || 'Needs review before this transaction can close.'
  if (stage.status === 'blocked' || stage.status === 'waiting') return snapshot.nextAction || stage.detail
  return stage.detail
}

function transactionStageCardFacts(stage: TransactionProgressStage, snapshot: TransactionProgressSnapshot) {
  const facts: string[] = []
  if (stage.id === snapshot.currentStageId && snapshot.state) facts.push(progressStateLabel(snapshot.state))
  if (snapshot.quote && ['offer', 'authorize', 'execute', 'verify', 'quote_response', 'wait_buyer', 'settlement'].includes(stage.id)) facts.push(snapshot.quote)
  if (snapshot.payment && ['authorize', 'execute', 'verify', 'wait_buyer', 'settlement'].includes(stage.id)) facts.push(snapshot.payment)
  if (snapshot.artifacts && ['verify', 'terminal_report', 'settlement'].includes(stage.id)) facts.push(snapshot.artifacts)
  if (snapshot.provider && ['offer', 'execute', 'verify', 'quote_response', 'provider_execution', 'terminal_report', 'settlement'].includes(stage.id)) facts.push(`Provider ${shortID(snapshot.provider)}`)
  return facts.slice(0, 3)
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
  const meta = message.role === 'user'
    ? ''
    : message.meta || actorLabel(message.actor) || messageRoleLabel(message.role)
  return `
    <article class="chat-message ${message.role}${message.pending ? ' pending' : ''}">
      ${meta ? `<div class="message-meta">${escapeHTML(meta)}</div>` : ''}
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
  const selectedStageId = selectedTransactionStageId(thread, snapshot)
  const { progressIndex, progressPercent } = transactionProgressPosition(snapshot)
  return `
    <section class="transaction-progress-panel transaction-progress-bar ${snapshot.terminal ? 'terminal' : ''}" data-progress-state="${escapeAttr(snapshot.state)}" style="--progress-percent: ${progressPercent}%; --stage-count: ${snapshot.stages.length}; --stage-scroll-width: ${snapshot.stages.length * 96}px">
      <div class="transaction-progress-strip">
        <div class="transaction-progress-track" aria-label="Transaction progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}">
          <span class="transaction-progress-track-fill"></span>
        </div>
        <div class="transaction-progress-steps" aria-label="Transaction stages">
          ${snapshot.stages.map((stage, index) => `
            <div class="transaction-progress-step ${stage.status}${stage.id === selectedStageId ? ' selected' : ''}">
              <button class="transaction-stage-button ${stage.status}${stage.id === selectedStageId ? ' selected' : ''}" type="button" data-transaction-stage-select="${escapeAttr(stage.id)}" aria-pressed="${stage.id === selectedStageId ? 'true' : 'false'}" aria-current="${index === progressIndex ? 'step' : 'false'}" title="${escapeAttr(`${stage.title}: ${stage.detail}`)}">
                <span class="transaction-stage-dot" aria-hidden="true">${index + 1}</span>
                <strong>${escapeHTML(stage.title)}</strong>
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `
}

function transactionProgressPosition(snapshot: TransactionProgressSnapshot) {
  const currentIndex = snapshot.stages.findIndex((stage) => ['active', 'waiting', 'blocked', 'failed'].includes(stage.status))
  const completedIndex = snapshot.stages.reduce((latest, stage, index) => stage.status === 'complete' ? index : latest, -1)
  const terminalSuccess = snapshot.terminal && !snapshot.stages.some((stage) => stage.status === 'failed')
  const progressIndex = snapshot.terminal && !snapshot.stages.some((stage) => stage.status === 'failed')
    ? snapshot.stages.length - 1
    : currentIndex >= 0
      ? Math.max(0, currentIndex)
      : Math.max(0, completedIndex)
  const progressPercent = snapshot.stages.length > 0
    ? terminalSuccess
      ? 100
      : Math.round(((progressIndex + 0.5) / snapshot.stages.length) * 100)
    : 0
  return { progressIndex, progressPercent }
}

function selectedTransactionStageId(thread: WorkThread, snapshot: TransactionProgressSnapshot) {
  const stored = normalizeTransactionStageId(state.transactionStageSelections[thread.id])
  if (stored && snapshot.stages.some((stage) => stage.id === stored)) return stored
  const current = normalizeTransactionStageId(snapshot.currentStageId)
  return current || snapshot.stages[0]?.id || ''
}

function normalizeTransactionStageId(stageId?: string) {
  if (stageId === 'match' || stageId === 'negotiate' || stageId === 'quote') return 'offer'
  if (stageId === 'consent' || stageId === 'escrow') return 'authorize'
  if (stageId === 'settle') return 'verify'
  if (stageId === 'discover') return 'plan'
  if (stageId === 'deliver') return 'verify'
  return stageId || ''
}

function transactionStageDetailCollapseKey(thread: WorkThread, stageId: string) {
  return `${thread.id}:${stageId}`
}

function transactionStageDetailIsCollapsed(thread: WorkThread, stageId: string) {
  return state.transactionStageDetailCollapsed[transactionStageDetailCollapseKey(thread, stageId)] !== false
}

type TransactionStageFact = { label: string; value?: unknown }
type TransactionStageItem = {
  title: string
  meta?: string
  detail?: string
  chips?: Array<string | undefined>
  actions?: string
  tone?: 'normal' | 'good' | 'warn' | 'bad'
}
type TransactionStagePanel = {
  title: string
  detail?: string
  facts?: TransactionStageFact[]
  body?: string
  emptyText?: string
}
type TransactionStageCheckItem = {
  label: string
  detail?: string
  checked?: boolean
  meta?: string
  tone?: 'normal' | 'good' | 'warn' | 'bad'
}
type TransactionStageTableCell = string | { html: string }
type TransactionStageTableRow = {
  cells: TransactionStageTableCell[]
  tone?: 'normal' | 'good' | 'warn' | 'bad'
}

function renderTransactionStageContent(thread: WorkThread, chatThread: ChatThread | undefined, messages: ChatMessage[], side: OrderSide) {
  return side === 'seller'
    ? renderSellerTransactionStageContent(thread, chatThread, messages)
    : renderBuyerTransactionStageContent(thread, chatThread, messages)
}

function renderTransactionSupervision(thread: WorkThread) {
  const ids = new Set([thread.orderId, thread.id, ...thread.taskIds, ...thread.planIds].filter((value): value is string => Boolean(value)))
  const transaction = state.cloudTransactions.find((item) => ids.has(item.transactionId))
  const supervision = transaction?.supervision
  if (!transaction || !supervision?.status) return ''
  const labels: Record<string, string> = {
    driving: `Exora is driving the ${supervision.responsibleRole || 'local'} Agent`,
    waiting_user: 'Waiting for your confirmation',
    waiting_counterparty: `Waiting for the ${supervision.responsibleRole || 'counterparty'} Agent`,
    retry_scheduled: supervision.nextWakeAt ? `Retry scheduled for ${compactTimestamp(supervision.nextWakeAt)}` : 'Agent retry scheduled',
    blocked: 'Progress Supervisor stopped',
    completed: 'Supervision completed',
  }
  return `
    <div class="transaction-supervision ${escapeAttr(supervision.status)}">
      <span class="transaction-supervision-dot" aria-hidden="true"></span>
      <div><strong>${escapeHTML(labels[supervision.status] || supervision.status)}</strong><small>${escapeHTML(supervision.reason || (supervision.activeRunId ? `Run ${shortID(supervision.activeRunId)}` : `Transaction version ${transaction.version}`))}</small></div>
      ${supervision.consecutiveNoProgress ? `<em>${supervision.consecutiveNoProgress}/3 no progress</em>` : ''}
    </div>
  `
}

function renderTransactionStageDetailFrame(thread: WorkThread, snapshot: TransactionProgressSnapshot, stageId: TransactionStageId, body: string) {
  const stage = snapshot.stages.find((item) => item.id === stageId) || snapshot.stages[0]
  const currentStage = snapshot.stages.find((item) => item.id === snapshot.currentStageId)
  const collapsed = transactionStageDetailIsCollapsed(thread, stageId)
  const status = stage?.id === snapshot.currentStageId ? progressStateLabel(snapshot.state) : `Viewing ${stage?.title || 'stage'}`
  const toggleButton = `
    <button class="transaction-stage-detail-toggle" type="button" data-transaction-stage-detail-toggle="${escapeAttr(stageId)}" aria-expanded="${collapsed ? 'false' : 'true'}">
      ${toolbarIcons.disclosure}
      <span>${collapsed ? 'Show' : 'Hide'}</span>
    </button>
  `
  return `
    <section class="transaction-stage-detail ${collapsed ? 'collapsed' : ''}" data-selected-transaction-stage="${escapeAttr(stageId)}">
      <div class="transaction-stage-detail-compact">
        ${toggleButton}
        <span class="transaction-stage-collapsed-label">${escapeHTML(stage?.title || 'Stage')} details</span>
      </div>
      <div class="transaction-stage-detail-expanded">
        <div class="transaction-stage-detail-expanded-inner">
          <header class="transaction-stage-detail-head">
            <div>
              <span>${escapeHTML(status)}</span>
              <h3>${escapeHTML(stage?.title || 'Stage')}</h3>
              <p>${escapeHTML(stage?.detail || '')}</p>
            </div>
            <small>${escapeHTML(currentStage ? `Current: ${currentStage.title}` : '')}</small>
          </header>
          ${renderTransactionSupervision(thread)}
          ${renderStageTopline(snapshot)}
          ${body}
        </div>
      </div>
    </section>
  `
}

function canInspectTransactionDetail(thread = selectedWorkThread()) {
  return Boolean(thread && (state.activeView === 'chat' || state.activeView === 'work') && !state.pinStep && !sellerMonitorActive() && !state.newConversationDraft)
}

function updateTransactionDetailOpenButtons(canInspect: boolean, visible: boolean) {
  const disabled = !canInspect || visible
  const label = !canInspect
    ? 'Select a transaction to inspect details'
    : visible
      ? 'Transaction details are open'
      : 'Open transaction details'
  for (const button of fields.transactionDetailOpenButtons) {
    button.disabled = disabled
    button.setAttribute('aria-disabled', String(disabled))
    button.setAttribute('aria-label', label)
    button.setAttribute('title', label)
  }
}

function transactionDetailRenderKey(
  thread: WorkThread,
  side: OrderSide,
  stageId: string,
  snapshot: TransactionProgressSnapshot,
  data: TransactionProgressData,
  messages: ChatMessage[],
) {
  const lastEvent = snapshot.events[snapshot.events.length - 1]
  const lastMessage = messages[messages.length - 1]
  return JSON.stringify({
    language: state.language,
    thread: [
      thread.id,
      thread.timestamp,
      thread.status,
      thread.primarySelectionId,
      thread.taskIds.join(','),
      thread.planIds.join(','),
      thread.approvalIds.join(','),
      thread.paymentIds.join(','),
    ],
    side,
    stageId,
    snapshot: [
      snapshot.state,
      snapshot.owner,
      snapshot.waitingFor,
      snapshot.nextAction,
      snapshot.updatedAt,
      snapshot.syncStatus,
      snapshot.currentStageId,
      snapshot.terminal,
      snapshot.quote,
      snapshot.payment,
      snapshot.provider,
      snapshot.artifacts,
      snapshot.events.length,
      lastEvent?.id,
      lastEvent?.timestamp,
    ],
    plans: data.plans.map((plan) => [
      plan.planId,
      plan.status,
      plan.updatedAt,
      plan.selectedOptionId,
      plan.taskId,
      plan.approvalId,
      plan.paymentId,
      plan.providerJobId,
      plan.orderState?.state,
      plan.orderState?.updatedAt,
      plan.options?.length || 0,
      plan.candidates?.length || 0,
      plan.events?.length || 0,
    ]),
    tasks: data.tasks.map((task) => [
      task.id,
      task.status,
      task.providerPubkey,
      task.updatedAt,
      task.completedAt,
      task.error,
      task.artifacts?.length || 0,
    ]),
    approvals: data.approvals.map((approval) => [
      approval.approvalId,
      approval.status,
      approval.paymentRequired,
      approval.createdAt,
      approval.expiresAt,
    ]),
    payments: data.payments.map((payment) => [
      payment.paymentId,
      payment.status,
      payment.updatedAt,
      payment.confirmedAt,
      payment.proofRef,
    ]),
    runs: data.workRuns.map((run) => [
      run.runId,
      run.status,
      run.currentStep,
      run.lastCheckpointId,
      run.updatedAt,
      run.error,
      run.activeWorker?.status,
      run.activeWorker?.updatedAt,
    ]),
    runEvents: data.workRunEvents.map((event) => [
      event.eventId,
      event.type,
      event.status,
      event.step,
      event.createdAt,
    ]),
    messages: [
      messages.length,
      lastMessage?.id,
      lastMessage?.text,
      lastMessage?.stageId,
    ],
  })
}

function renderTransactionDetailSidebar() {
  state.transactionStageInspectorOpen = false
  fields.appShell.classList.remove('transaction-detail-dockable', 'transaction-detail-open', 'transaction-detail-popout-available')
  fields.transactionDetailSidebar.setAttribute('aria-hidden', 'true')
  fields.transactionDetailSidebar.toggleAttribute('inert', true)
  fields.transactionDetailPopoutControls.setAttribute('aria-hidden', 'true')
  fields.transactionDetailPopoutControls.toggleAttribute('inert', true)
  fields.transactionDetailContent.innerHTML = ''
  lastTransactionDetailRenderKey = ''
}

function renderTransactionDetailEmpty() {
  return `
    <section class="transaction-detail-empty" data-no-i18n>
      <span class="transaction-detail-empty-icon" aria-hidden="true">${toolbarIcons.emptyContent}</span>
      <span class="transaction-detail-empty-label">No content</span>
    </section>
  `
}

function renderTransactionStageBodyForSide(
  side: OrderSide,
  stageId: TransactionStageId,
  data: TransactionProgressData,
  thread: WorkThread,
  chatThread: ChatThread | undefined,
  messages: ChatMessage[],
  snapshot: TransactionProgressSnapshot,
) {
  return side === 'seller'
    ? renderSellerTransactionStageBody(stageId as SellerTransactionStageId, data, thread, chatThread, messages, snapshot)
    : renderBuyerTransactionStageBody(stageId as BuyerTransactionStageId, data, thread, chatThread, messages, snapshot)
}

function closeTransactionStageInspector(render = true) {
  state.transactionStageInspectorOpen = false
  if (render) renderTransactionDetailSidebar()
}

function openTransactionStageInspector() {
  const thread = selectedWorkThread()
  if (!thread || !canInspectTransactionDetail(thread)) return
  state.transactionStageInspectorOpen = true
  renderTransactionDetailSidebar()
}

function renderBuyerTransactionStageContent(thread: WorkThread, chatThread: ChatThread | undefined, messages: ChatMessage[]) {
  const data = transactionProgressData(thread)
  const snapshot = buildTransactionProgressSnapshot(thread, 'buyer')
  const stageId = selectedTransactionStageId(thread, snapshot) as BuyerTransactionStageId
  const body = renderBuyerTransactionStageBody(stageId, data, thread, chatThread, messages, snapshot)
  return renderTransactionStageDetailFrame(thread, snapshot, stageId, body)
}

function renderBuyerTransactionStageBody(
  stageId: BuyerTransactionStageId,
  data: TransactionProgressData,
  thread: WorkThread,
  chatThread: ChatThread | undefined,
  messages: ChatMessage[],
  snapshot: TransactionProgressSnapshot,
) {
  switch (stageId) {
    case 'intent':
      return renderIntentStage(data, thread, chatThread, messages, snapshot)
    case 'plan':
      return renderPlanStage(data)
    case 'offer':
      return renderQuoteStage(data)
    case 'authorize':
      return renderAuthorizeStage(data)
    case 'execute':
      return renderExecuteStage(data, snapshot)
    case 'verify':
      return renderBuyerVerifyStage(data, snapshot)
  }
}

function renderIntentStage(data: TransactionProgressData, thread: WorkThread, chatThread: ChatThread | undefined, messages: ChatMessage[], snapshot: TransactionProgressSnapshot) {
  const task = latestBy(data.tasks, (item) => item.updatedAt || item.createdAt || '')
  const plan = latestBy(data.plans, (item) => item.updatedAt || item.createdAt || item.expiresAt || '')
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  const selectedOption = plan ? selectedOptionForPlan(plan) : undefined
  const requirementSummary = formatRecordSummary(task?.requirements || selectedOption?.draft?.requirements)
  const need = task?.goal || plan?.query || lastUserMessage?.text || chatThread?.title || thread.title
  const budget = taskBudgetLabel(task) || state.agentCards.buyer?.manualFields.buyer?.budget
  const outputs = task?.expectedOutputs?.join(', ') || selectedOption?.draft?.goal || ''
  const intentClass = data.tasks.length || data.plans.length
    ? 'candidate_task'
    : snapshot.waitingFor === 'user_input'
      ? 'clarify'
      : 'chat'
  const panels = renderStageSplitPanels([
    {
      title: 'User need',
      detail: 'The local buyer agent keeps this readable before anything external can execute.',
      facts: [
        { label: 'Original need', value: need },
        { label: 'Intent class', value: intentClass },
        { label: 'Draft source', value: thread.origin === 'market-card' ? 'Seller card start' : chatThread ? 'Buyer chat' : 'Transaction record' },
      ],
      emptyText: 'No user need has been captured yet.',
    },
    {
      title: 'Quote boundaries',
      detail: 'Only quote, permission, budget, delivery, and safety blockers belong here.',
      facts: [
        { label: 'Constraints', value: requirementSummary },
        { label: 'Budget', value: budget },
        { label: 'Outputs', value: outputs },
        { label: 'Files', value: task?.inputFiles?.length ? `${task.inputFiles.length} file(s)` : '' },
      ],
      emptyText: 'No quote-affecting constraints have been recorded yet.',
    },
  ])
  const checks = renderStageChecklist([
    { label: 'Task objective', checked: Boolean(need), detail: need ? compactText(need, 110) : 'Needed before planning or seller matching.' },
    { label: 'Quote-affecting constraints', checked: Boolean(requirementSummary), detail: requirementSummary || 'Add constraints that change scope, price, timeline, or safety.' },
    { label: 'Budget boundary', checked: Boolean(budget), detail: budget || 'Optional, but useful before asking sellers to quote.' },
    { label: 'Delivery format', checked: Boolean(outputs), detail: outputs || 'Define the artifact, report, API result, or confirmation expected.' },
    {
      label: 'Authorization boundary',
      checked: Boolean(state.agentCards.buyer?.manualFields.buyer?.authorizationStrategy || state.agentCards.buyer?.manualFields.buyer?.riskBoundary),
      detail: state.agentCards.buyer?.manualFields.buyer?.authorizationStrategy || state.agentCards.buyer?.manualFields.buyer?.riskBoundary || 'External execution remains blocked until explicit owner consent.',
    },
  ], 'No intent checklist is available yet.')
  const intentItems: Array<TransactionStageItem | undefined> = [
    plan ? {
      title: 'Draft transaction',
      meta: shortID(plan.planId),
      detail: plan.nextAction || targetSummary(plan.normalizedQuery),
      chips: [plan.status, plan.createdAt ? compactTimestamp(plan.createdAt) : undefined],
    } : undefined,
    task ? {
      title: taskTitle(task),
      meta: shortID(task.id),
      detail: task.type || task.status,
      chips: [task.status, task.timeoutSeconds ? `${task.timeoutSeconds}s timeout` : undefined],
    } : undefined,
  ]
  const items = intentItems.filter((item): item is TransactionStageItem => item !== undefined)
  return renderStageWorkspace(
    panels,
    renderStageSection('Required before external work', checks),
    renderStageSection('Draft record', renderTransactionStageItems(items, 'No structured draft has been recorded yet.')),
  )
}

function renderPlanStage(data: TransactionProgressData) {
  const plan = latestBy(data.plans, (item) => item.updatedAt || item.createdAt || item.expiresAt || '')
  const task = latestBy(data.tasks, (item) => item.updatedAt || item.createdAt || '')
  const normalized = plan?.normalizedQuery
  const selectedOption = plan ? selectedOptionForPlan(plan) : undefined
  const manifestApproval = data.approvals.find((approval) => approval.manifestHash || approval.planId || includesAny([approval.action, approval.riskSummary].filter(Boolean).join(' ').toLowerCase(), ['manifest', 'remote task']))
  const planRun = latestBy(data.workRuns, (run) => run.updatedAt || run.createdAt || '')
  const planEvents = renderWorkRunEventItems(workRunEventsForStage(data, ['confirm_exora_plan', 'write_plan_files', 'review_remote_manifest', 'manifest', 'plan']))
  const readiness = renderStageChecklist([
    {
      label: 'Task requirements',
      checked: Boolean(task?.goal || selectedOption?.draft?.goal || plan?.query),
      detail: task?.goal || selectedOption?.draft?.goal || plan?.query || 'Define what the remote seller must complete.',
    },
    {
      label: 'Agent requirements',
      checked: Boolean(normalized?.type || selectedOption || state.agentCards.buyer?.manualFields.buyer?.riskBoundary),
      detail: normalized?.type || (selectedOption ? optionCapability(selectedOption) : '') || state.agentCards.buyer?.manualFields.buyer?.riskBoundary || 'Define required capability, tools, permissions, and risk level.',
    },
    {
      label: 'Remote manifest',
      checked: Boolean(manifestApproval?.manifestHash || planRun?.publicDisclosure || planRun?.ownerDisclosure || plan?.planId),
      detail: manifestApproval?.manifestHash ? `Manifest ${shortID(manifestApproval.manifestHash, 12, 8)}` : 'Remote task manifest is not ready for owner review yet.',
      tone: manifestApproval?.manifestHash ? 'good' : 'warn',
    },
    {
      label: 'Blocking gaps',
      checked: !includesAny([plan?.nextAction, planRun?.nextAction].filter(Boolean).join(' ').toLowerCase(), ['clarify', 'missing', 'review', 'confirm']),
      detail: plan?.nextAction || planRun?.nextAction || 'No blocking planning gap is currently recorded.',
    },
  ], 'No plan readiness data has been recorded yet.')
  return renderStageWorkspace(
    renderStageSplitPanels([
      {
        title: 'Task Requirements',
        detail: 'What the remote seller must complete and how success is judged.',
        facts: [
          { label: 'Goal', value: task?.goal || selectedOption?.draft?.goal || plan?.query },
          { label: 'Inputs', value: task?.inputFiles?.length ? `${task.inputFiles.length} file(s)` : '' },
          { label: 'Expected outputs', value: task?.expectedOutputs?.join(', ') || selectedOption?.draft?.goal },
          { label: 'Acceptance', value: task?.artifactHashes ? `${Object.keys(task.artifactHashes).length} hash target(s)` : '' },
          { label: 'Requirements', value: task?.requirements || selectedOption?.draft?.requirements },
        ],
        emptyText: 'Task requirements have not been structured yet.',
      },
      {
        title: 'Agent Requirements',
        detail: 'What kind of external capability is allowed to quote.',
        facts: [
          { label: 'Capability type', value: normalized?.type || (selectedOption ? optionCapability(selectedOption) : '') },
          { label: 'Query', value: normalized?.query || plan?.query },
          { label: 'GPU', value: normalized?.minVramGb ? `${normalized.minVramGb}GB+ VRAM` : '' },
          { label: 'Region', value: normalized?.region },
          { label: 'Risk boundary', value: state.agentCards.buyer?.manualFields.buyer?.riskBoundary },
        ],
        emptyText: 'Agent requirements have not been extracted yet.',
      },
    ]),
    renderStageSection('Manifest readiness', readiness),
    renderStageSection('Plan evidence', renderTransactionStageItems(planEvents, 'No plan file, manifest, or review checkpoint has been recorded yet.')),
  )
}

function renderQuoteStage(data: TransactionProgressData) {
  const candidates = data.plans.flatMap((plan) => plan.candidates || [])
  const matchingEvents = workRunEventsForStage(data, ['discover_agent_cards', 'cloud_matching', 'submit_manifest_for_matching', 'seller card', 'match'])
  const negotiationEvents = workRunEventsForStage(data, ['negotiate', 'compare', 'clarify', 'risk', 'missing', 'seller_valuation'])
  const pendingCount = candidates.filter((candidate) => ['pending', 'requested', 'quoting'].includes(candidate.status || '')).length
  const negotiateCount = candidates.filter((candidate) => candidate.status === 'needs_negotiation').length
  const rejectedCount = candidates.filter((candidate) => candidate.status === 'rejected').length
  const quotedCount = candidates.filter((candidate) => candidate.status === 'quoted' || candidate.quoteId || candidate.priceAmount).length + data.plans.reduce((total, plan) => total + (plan.options?.length || 0), 0)
  const backstagePanel = renderStagePanel({
    title: 'Cloud / Seller backstage',
    detail: 'Cloud matches sellers, sellers negotiate or quote, and Buyer only reviews returned options.',
    facts: [
      { label: 'Matching signals', value: matchingEvents.length ? `${matchingEvents.length} checkpoint(s)` : '' },
      { label: 'Seller valuation', value: pendingCount ? `${pendingCount} pending` : '' },
      { label: 'Needs negotiation', value: negotiateCount ? `${negotiateCount} seller(s)` : '' },
      { label: 'Rejected', value: rejectedCount ? `${rejectedCount} seller(s)` : '' },
      { label: 'Quote returned', value: quotedCount ? `${quotedCount} option(s)` : '' },
    ],
    emptyText: 'Cloud matching, seller valuation, and quote aggregation have not started yet.',
  })
  const blockingText = uniqueDisplayStrings([
    ...data.plans.map((plan) => plan.nextAction),
    ...data.plans.flatMap((plan) => (plan.events || [])
      .filter((event) => includesAny(`${event.type} ${event.message || ''}`.toLowerCase(), ['clarify', 'missing', 'question', 'negotiate', 'risk']))
      .map((event) => event.message || progressStateLabel(event.type))),
    ...candidates
      .filter((candidate) => ['needs_negotiation', 'rejected'].includes(candidate.status || ''))
      .map((candidate) => candidate.message || progressStateLabel(candidate.status)),
  ]).slice(0, 6)
  const blocking = renderStageChecklist(blockingText.map((text) => ({
    label: text,
    detail: 'Only blockers that affect quote quality, permission clarity, payment safety, or delivery acceptance are shown here.',
    checked: false,
    tone: 'warn' as const,
  })), 'No blocking seller question is waiting right now.')
  const sellerFeedbackItems = candidates
    .filter((candidate) => ['pending', 'requested', 'quoting', 'needs_negotiation', 'rejected', 'quoted'].includes(candidate.status || '') || candidate.message)
    .map((candidate): TransactionStageItem => ({
      title: shortID(candidate.providerPubkey || candidate.resourceId || candidate.optionId || 'seller'),
      meta: progressStateLabel(candidate.status || 'seller response'),
      detail: candidate.message || candidate.quoteId || 'Seller response for this quote review.',
      chips: [
        candidate.priceAmount ? `${candidate.priceAmount} ${candidate.currency || 'USDC'}` : undefined,
        candidate.quoteId ? `Quote ${shortID(candidate.quoteId)}` : undefined,
        candidate.updatedAt ? compactTimestamp(candidate.updatedAt) : undefined,
      ],
      tone: candidate.status === 'quoted' ? 'good' : candidate.status === 'rejected' ? 'bad' : candidate.status === 'needs_negotiation' ? 'warn' : 'normal',
    }))
  const backstageEvents = renderWorkRunEventItems([...matchingEvents, ...negotiationEvents].slice(-10))
  const sections = data.plans.map((plan) => {
    const selectedOption = selectedOptionForPlan(plan)
    const rows = quoteRowsForPlan(plan)
    const summary = renderStagePanel({
      title: plan.status === 'pending_selection' ? 'Buyer quote review' : 'Quote state',
      detail: 'Compare price, ETA, deliverable, constraints, and seller status before consent.',
      facts: [
        { label: 'Plan', value: shortID(plan.planId) },
        { label: 'Request', value: plan.query || targetSummary(plan.normalizedQuery) },
        { label: 'Recommended', value: selectedOption ? `${shortID(selectedOption.providerPubkey)} / ${optionPrice(selectedOption)}` : '' },
        { label: 'Selected', value: plan.selectedOptionId ? shortID(plan.selectedOptionId) : '' },
      ],
      emptyText: 'No quote summary has been produced yet.',
    })
    const cancel = plan.status === 'pending_selection' && !isDemoOrderPlan(plan)
      ? renderStageActionBar([`<button class="danger ghost" type="button" data-cancel-plan="${escapeAttr(plan.planId)}">Cancel seller choice</button>`])
      : ''
    return renderStageSection(
      plan.status === 'pending_selection' ? 'Choose seller quote' : progressStateLabel(plan.status),
      `${summary}${renderStageTable(['Seller', 'Price', 'ETA / Capability', 'Deliverable', 'Status', 'Action'], rows, 'No selectable quote has arrived yet.')}${cancel}`,
    )
  })
  return renderStageWorkspace(
    backstagePanel,
    renderStageSection('Blocking questions', blocking),
    renderStageSection('Seller feedback', renderTransactionStageItems([...sellerFeedbackItems, ...backstageEvents].slice(0, 12), 'No seller feedback, negotiation note, or matching checkpoint has been recorded yet.')),
    ...sections,
    data.plans.length ? '' : renderStageEmpty('No quote review record for this transaction yet.'),
  )
}

function renderConsentStage(data: TransactionProgressData) {
  const task = latestBy(data.tasks, (item) => item.updatedAt || item.createdAt || '')
  const plan = latestBy(data.plans, (item) => item.updatedAt || item.createdAt || '')
  const approval = latestBy(data.approvals, (item) => item.createdAt || item.expiresAt || '')
  const buyer = state.agentCards.buyer?.manualFields.buyer
  const ownerApproved = approval ? !approvalNeedsDecision(approval) : false
  const checklist = renderStageChecklist([
    {
      label: 'Owner authorization',
      checked: ownerApproved,
      detail: approval ? progressStateLabel(approval.status) : 'No approval request yet.',
      tone: approval?.status === 'rejected' ? 'bad' : ownerApproved ? 'good' : 'warn',
    },
    { label: 'Sensitive action review', checked: Boolean(approval?.riskSummary), detail: approval?.riskSummary || 'Review external writes, credentials, disclosure, or irreversible actions before approval.' },
    { label: 'File transfer scope', checked: Boolean(approval?.fileScope?.length), detail: approval?.fileScope?.length ? `${approval.fileScope.length} file(s) disclosed` : buyer?.fileDisclosure || 'No file scope recorded.' },
    { label: 'Payment consent', checked: Boolean(approval && (!approval.paymentRequired || ownerApproved)), detail: approval?.paymentRequired ? approvalAmount(approval) : 'No payment required by this approval.' },
  ], 'No authorization checklist is available yet.')
  const approvalItems = data.approvals.map((item): TransactionStageItem => ({
    title: item.action || 'Approval request',
    meta: progressStateLabel(item.status),
    detail: item.riskSummary || 'Review before the transaction can continue.',
    chips: [
      approvalSubjectLabel(item),
      approvalAmount(item),
      item.fileScope?.length ? `${item.fileScope.length} file(s)` : 'no files',
      item.manifestHash ? `Manifest ${shortID(item.manifestHash, 12, 8)}` : undefined,
    ],
    actions: approvalNeedsDecision(item) && !isDemoApproval(item) ? `
      <button type="button" data-approve="${escapeAttr(item.approvalId)}">${item.paymentRequired ? 'Approve + PIN' : 'Approve'}</button>
      <button class="danger ghost" type="button" data-reject="${escapeAttr(item.approvalId)}">Reject</button>
    ` : '',
    tone: item.status === 'approved' ? 'good' : item.status === 'rejected' ? 'bad' : 'warn',
  }))
  return renderStageWorkspace(
    renderStageSplitPanels([
      {
        title: 'Remote task manifest',
        detail: 'The remote task sheet must be quoteable, rejectable, and executable before approval.',
        facts: [
          { label: 'Goal', value: task?.goal || plan?.query },
          { label: 'Inputs', value: task?.inputFiles?.length ? task.inputFiles.map((file) => file.name).join(', ') : '' },
          { label: 'Outputs', value: task?.expectedOutputs?.join(', ') },
          { label: 'Manifest', value: approval?.manifestHash ? shortID(approval.manifestHash, 12, 8) : '' },
          { label: 'Provider', value: approval?.providerPubkey ? shortID(approval.providerPubkey) : plan ? selectedProviderForPlan(plan) : '' },
          { label: 'Privacy', value: buyer?.identityDisclosure || buyer?.fileDisclosure || buyer?.dataRetention },
        ],
        emptyText: 'No manifest has reached approval yet.',
      },
      { title: 'Authorization checklist', body: checklist },
    ]),
    renderStageSection('Approval requests', renderTransactionStageItems(approvalItems, 'No approval request is attached to this stage yet.')),
  )
}

function renderEscrowStage(data: TransactionProgressData) {
  const confirmedStatuses = ['confirmed', 'confirmed_simulated', 'found_finalized']
  const hasSelectedQuote = data.plans.some((plan) => Boolean(plan.selectedOptionId)) || data.tasks.length > 0
  const hasApproval = data.approvals.some((approval) => !approvalNeedsDecision(approval))
  const hasPayment = data.payments.length > 0
  const confirmedPayment = data.payments.some((payment) => confirmedStatuses.includes(payment.status || ''))
  const flow = renderStageChecklist([
    { label: 'Quote selected', checked: hasSelectedQuote, detail: hasSelectedQuote ? 'Seller and quote have been chosen.' : 'Payment cannot start before quote selection.' },
    { label: 'Owner approved scope', checked: hasApproval, detail: hasApproval ? 'Approval is recorded.' : 'Approval must precede payment or execution.', tone: hasApproval ? 'good' : 'warn' },
    { label: 'Escrow/payment record', checked: hasPayment, detail: hasPayment ? `${data.payments.length} payment record(s)` : 'Waiting for payment intent or proof.' },
    { label: 'Proof confirmed', checked: confirmedPayment, detail: confirmedPayment ? 'Payment proof is confirmed.' : 'Execution stays blocked until proof is accepted.', tone: confirmedPayment ? 'good' : 'warn' },
  ], 'No escrow flow exists yet.')
  const paymentItems = data.payments.map((payment): TransactionStageItem => ({
    title: payment.status || 'Payment record',
    meta: paymentAmount(payment),
    detail: payment.proofRef || 'Payment or escrow proof is not confirmed yet.',
    chips: [
      payment.mode,
      payment.providerPubkey ? `Provider ${shortID(payment.providerPubkey)}` : undefined,
      payment.confirmedAt ? `Confirmed ${compactTimestamp(payment.confirmedAt)}` : undefined,
    ],
    tone: confirmedStatuses.includes(payment.status || '') ? 'good' : 'warn',
  }))
  const requiredItems = data.approvals
    .filter((approval) => approval.paymentRequired && !data.payments.some((payment) => payment.approvalId === approval.approvalId))
    .map((approval): TransactionStageItem => ({
      title: 'Escrow required',
      meta: approvalAmount(approval),
      detail: approval.riskSummary || 'Approval will request payment PIN before execution.',
      chips: [approvalSubjectLabel(approval)],
      actions: approvalNeedsDecision(approval) && !isDemoApproval(approval) ? `<button type="button" data-approve="${escapeAttr(approval.approvalId)}">Approve + PIN</button>` : '',
      tone: 'warn',
    }))
  return renderStageWorkspace(
    renderStageSection('Payment state', flow),
    renderStageSection('Escrow evidence', renderTransactionStageItems([...paymentItems, ...requiredItems], 'No escrow or payment proof has been created yet.')),
  )
}

function renderAuthorizeStage(data: TransactionProgressData) {
  return renderStageWorkspace(
    renderStageSection('Authorization scope', renderConsentStage(data), 'Approve task scope, sensitive actions, file disclosure, identity/context disclosure, and external writes.'),
    renderStageSection('Payment and escrow', renderEscrowStage(data), 'Confirm payment intent, PIN, escrow record, receipt, and proof before execution.'),
  )
}

function renderExecuteStage(data: TransactionProgressData, snapshot: TransactionProgressSnapshot) {
  const activeRun = latestBy(data.workRuns, (run) => run.updatedAt || run.createdAt || '')
  const activeTask = latestBy(data.tasks, (task) => task.updatedAt || task.createdAt || '')
  const runPanel = renderStagePanel({
    title: 'Run status',
    detail: 'Remote execution stays inside the authorized seller Dock boundary.',
    facts: [
      { label: 'Task', value: activeTask ? taskTitle(activeTask) : '' },
      { label: 'Run', value: activeRun?.runId ? shortID(activeRun.runId) : '' },
      { label: 'Status', value: activeRun?.status || activeTask?.status || snapshot.state },
      { label: 'Current step', value: activeRun?.currentStep },
      { label: 'Next action', value: activeRun?.nextAction || snapshot.nextAction },
      { label: 'Worker', value: activeRun?.activeWorker?.workerId || activeRun?.entities?.workerId },
      { label: 'Job', value: activeRun?.entities?.providerJobId || activeRun?.activeWorker?.jobId },
      { label: 'Error', value: activeRun?.error || activeTask?.error },
    ],
    emptyText: 'No execution run has been created yet.',
  })
  const taskItems = data.tasks.map((task): TransactionStageItem => ({
    title: taskTitle(task),
    meta: progressStateLabel(task.status),
    detail: task.error || snapshot.nextAction || 'Provider Dock execution state.',
    chips: [
      task.providerPubkey || task.quote?.providerPubkey ? `Provider ${shortID(task.providerPubkey || task.quote?.providerPubkey)}` : undefined,
      taskAmount(task),
      task.updatedAt ? compactTimestamp(task.updatedAt) : undefined,
    ],
    tone: task.status === 'failed' ? 'bad' : task.status === 'completed' ? 'good' : ['running', 'claimed', 'consented'].includes(task.status || '') ? 'warn' : 'normal',
  }))
  const runItems = data.workRuns.map((run): TransactionStageItem => ({
    title: run.intent || run.summary || 'Work run',
    meta: progressStateLabel(run.status || run.currentStep || 'run'),
    detail: run.error || run.nextAction || run.currentStep || 'Execution checkpoint',
    chips: [
      run.entities?.providerJobId ? `Job ${shortID(run.entities.providerJobId)}` : undefined,
      run.activeWorker?.status ? `Worker ${run.activeWorker.status}` : undefined,
      run.updatedAt ? compactTimestamp(run.updatedAt) : undefined,
    ],
      tone: run.status === 'failed' ? 'bad' : run.status === 'completed' ? 'good' : 'warn',
  }))
  const checkpointItems = renderWorkRunEventItems(workRunEventsForStage(data, ['submit_worker_job', 'poll_worker_job', 'execute', 'running', 'worker', 'checkpoint']))
  return renderStageWorkspace(
    runPanel,
    renderStageSection('Execution records', renderTransactionStageItems([...taskItems, ...runItems].slice(0, 10), 'No execution task has started yet.')),
    renderStageSection('Checkpoints', renderTransactionStageItems(checkpointItems, 'No execution checkpoints have been recorded yet.')),
  )
}

function renderVerifyStage(data: TransactionProgressData, snapshot: TransactionProgressSnapshot) {
  const task = latestBy(data.tasks, (item) => item.completedAt || item.updatedAt || item.createdAt || '')
  const expected = task?.expectedOutputs?.length ? task.expectedOutputs : ['Delivery exists', 'Hashes match', 'No unresolved failure']
  const artifactRows = data.tasks.flatMap((task) => (task.artifacts || []).map((artifact): TransactionStageTableRow => ({
    cells: [
      artifact.name || 'Artifact',
      artifact.contentType || 'delivery',
      artifact.sizeBytes ? `${artifact.sizeBytes} bytes` : '',
      artifact.sha256 ? shortID(artifact.sha256, 12, 8) : '',
      taskTitle(task),
    ],
    tone: 'good',
  })))
  const checks = expected.map((output): TransactionStageCheckItem => ({
    label: output,
    checked: Boolean(task?.status === 'completed' && (task.artifacts?.length || task.artifactHashes)),
    detail: task?.error || (task?.status === 'completed' ? 'Ready for buyer inspection.' : snapshot.nextAction || 'Waiting for delivery evidence.'),
    tone: task?.status === 'failed' ? 'bad' : task?.status === 'completed' ? 'good' : 'normal',
  }))
  const hashRows = data.tasks.flatMap((item) => Object.entries(item.artifactHashes || {}).map(([name, hash]): TransactionStageTableRow => ({
    cells: [name, shortID(hash, 14, 10), taskTitle(item), item.completedAt ? compactTimestamp(item.completedAt) : ''],
    tone: item.status === 'failed' ? 'bad' : 'good',
  })))
  const failureItems = data.tasks.filter((item) => item.error || item.status === 'failed').map((item): TransactionStageItem => ({
    title: item.status === 'failed' ? 'Failure reason' : 'Review note',
    meta: progressStateLabel(item.status),
    detail: item.error || snapshot.nextAction || 'Inspect delivery output and acceptance evidence.',
    chips: [shortID(item.id), item.completedAt ? compactTimestamp(item.completedAt) : undefined],
    tone: item.status === 'failed' ? 'bad' : 'warn',
  }))
  const receiptItems = renderWorkRunEventItems(workRunEventsForStage(data, ['fetch_artifacts', 'verify_artifacts', 'artifact', 'receipt', 'terminal_report', 'hash', 'deliver', 'error']))
  return renderStageWorkspace(
    renderStageSection('Artifacts and receipts', renderStageTable(['Artifact', 'Type', 'Size', 'Hash', 'Source'], artifactRows, 'No artifacts have been delivered yet.')),
    renderStageSection('Acceptance checklist', renderStageChecklist(checks, 'No acceptance criteria have been recorded yet.')),
    renderStageSection('Hash verification', renderStageTable(['Artifact', 'Hash', 'Task', 'Completed'], hashRows, 'No hash evidence has been recorded yet.')),
    renderStageSection('Review notes', renderTransactionStageItems([...failureItems, ...receiptItems].slice(0, 10), 'No manual review note, receipt, or failure reason has been recorded yet.')),
  )
}

function renderSettleStage(data: TransactionProgressData, snapshot: TransactionProgressSnapshot) {
  const confirmedStatuses = ['confirmed', 'confirmed_simulated', 'found_finalized']
  const finalTask = latestBy(data.tasks, (task) => task.completedAt || task.updatedAt || task.createdAt || '')
  const finalPayment = latestBy(data.payments, (payment) => payment.updatedAt || payment.confirmedAt || payment.createdAt || '')
  const settlementPanel = renderStagePanel({
    title: 'Settlement state',
    detail: 'Close the loop with release, refund, dispute, or final closure evidence.',
    facts: [
      { label: 'State', value: snapshot.state },
      { label: 'Task', value: finalTask ? `${progressStateLabel(finalTask.status)} / ${taskTitle(finalTask)}` : '' },
      { label: 'Payment', value: finalPayment ? `${progressStateLabel(finalPayment.status || '')} / ${paymentAmount(finalPayment)}` : '' },
      { label: 'Provider', value: finalTask?.providerPubkey || finalTask?.quote?.providerPubkey ? shortID(finalTask.providerPubkey || finalTask.quote?.providerPubkey) : snapshot.provider ? shortID(snapshot.provider) : '' },
      { label: 'Artifacts', value: snapshot.artifacts },
      { label: 'Updated', value: snapshot.updatedAt ? compactTimestamp(snapshot.updatedAt) : '' },
    ],
    emptyText: 'No settlement state is available yet.',
  })
  const paymentItems = data.payments.map((payment): TransactionStageItem => ({
    title: payment.status || 'Payment',
    meta: paymentAmount(payment),
    detail: payment.proofRef || 'Settlement evidence pending.',
    chips: [
      payment.confirmedAt ? `Confirmed ${compactTimestamp(payment.confirmedAt)}` : undefined,
      payment.updatedAt ? `Updated ${compactTimestamp(payment.updatedAt)}` : undefined,
    ],
    tone: confirmedStatuses.includes(payment.status || '') ? 'good' : 'warn',
  }))
  const terminalItems = data.tasks
    .filter((task) => ['completed', 'failed'].includes(task.status || ''))
    .map((task): TransactionStageItem => ({
      title: task.status === 'failed' ? 'Dispute or refund review' : 'Ready to close',
      meta: progressStateLabel(task.status),
      detail: task.error || snapshot.nextAction || 'Release, refund, dispute, or close the order.',
      chips: [shortID(task.id), task.completedAt ? compactTimestamp(task.completedAt) : undefined],
      tone: task.status === 'failed' ? 'bad' : 'good',
    }))
  const auditItems = snapshot.events.map((event): TransactionStageItem => ({
    title: event.label,
    meta: event.timestamp ? compactTimestamp(event.timestamp) : event.type,
    detail: event.detail || '',
    chips: [event.type],
    tone: event.tone,
  }))
  return renderStageWorkspace(
    settlementPanel,
    renderStageSection('Payment and closure evidence', renderTransactionStageItems([...paymentItems, ...terminalItems], 'No settlement, dispute, refund, or close record yet.')),
    renderStageSection('Final audit trail', renderTransactionStageItems(auditItems, 'No audit events have been recorded yet.')),
  )
}

function renderBuyerVerifyStage(data: TransactionProgressData, snapshot: TransactionProgressSnapshot) {
  return renderStageWorkspace(
    renderStageSection('Delivery verification', renderVerifyStage(data, snapshot), 'Inspect artifacts, logs, hashes, terminal evidence, failure reasons, and fix/dispute needs.'),
    renderStageSection('Settlement result', renderSettleStage(data, snapshot), 'Release, refund, dispute, close, and archive final receipts after verification.'),
  )
}

function renderSellerTransactionStageContent(thread: WorkThread, chatThread: ChatThread | undefined, messages: ChatMessage[]) {
  const data = transactionProgressData(thread)
  const snapshot = buildTransactionProgressSnapshot(thread, 'seller')
  const stageId = selectedTransactionStageId(thread, snapshot) as SellerTransactionStageId
  const body = renderSellerTransactionStageBody(stageId, data, thread, chatThread, messages, snapshot)
  return renderTransactionStageDetailFrame(thread, snapshot, stageId, body)
}

function renderSellerTransactionStageBody(
  stageId: SellerTransactionStageId,
  data: TransactionProgressData,
  thread: WorkThread,
  chatThread: ChatThread | undefined,
  messages: ChatMessage[],
  snapshot: TransactionProgressSnapshot,
) {
  switch (stageId) {
    case 'task_valuation':
      return renderSellerTaskValuationStage(data, thread, chatThread, messages, snapshot)
    case 'quote_response':
      return renderSellerQuoteResponseStage(data)
    case 'wait_buyer':
      return renderSellerWaitBuyerStage(data, snapshot)
    case 'execution_plan':
      return renderSellerExecutionPlanStage(data, snapshot)
    case 'provider_execution':
      return renderSellerProviderExecutionStage(data, snapshot)
    case 'local_supervisor':
      return renderSellerLocalSupervisorStage(data, snapshot)
    case 'terminal_report':
      return renderSellerTerminalReportStage(data, snapshot)
    case 'settlement':
      return renderSellerSettlementStage(data, snapshot)
  }
}

function renderSellerTaskValuationStage(data: TransactionProgressData, thread: WorkThread, chatThread: ChatThread | undefined, messages: ChatMessage[], snapshot: TransactionProgressSnapshot) {
  const plan = latestBy(data.plans, (item) => item.updatedAt || item.createdAt || item.expiresAt || '')
  const task = latestBy(data.tasks, (item) => item.updatedAt || item.createdAt || '')
  const run = latestBy(data.workRuns, (item) => item.updatedAt || item.createdAt || '')
  const seller = state.agentCards.seller?.manualFields.seller
  const lastBuyerMessage = [...messages].reverse().find((message) => message.actor === 'buyer_human' || message.role === 'user')
  const manifestSummary: TransactionStagePanel = {
    title: 'Buyer manifest',
    detail: 'Seller only prices the scoped manifest; no execution starts here.',
    facts: [
      { label: 'Request', value: plan?.query || task?.goal || lastBuyerMessage?.text || chatThread?.title || thread.title },
      { label: 'Task', value: task ? `${progressStateLabel(task.status)} / ${taskTitle(task)}` : '' },
      { label: 'Inputs', value: task?.inputFiles?.length ? `${task.inputFiles.length} file(s)` : '' },
      { label: 'Requirements', value: formatRecordSummary(task?.requirements) || targetSummary(plan?.normalizedQuery) },
      { label: 'Budget', value: taskBudgetLabel(task) },
      { label: 'Order', value: snapshot.ids.find((item) => item.label === 'Order')?.value },
    ],
    emptyText: 'No buyer manifest has reached this seller yet.',
  }
  const sellerSnapshot: TransactionStagePanel = {
    title: 'Seller policy snapshot',
    detail: 'Pricing should come from seller policy and live resource state, not a loose model guess.',
    facts: [
      { label: 'Seller', value: seller?.displayName || state.agentCards.seller?.agentId || 'Local seller' },
      { label: 'Provider', value: state.sellerMarketStatus?.providerId || state.sellerSettings?.providerId },
      { label: 'Pricing', value: seller?.pricing || sellerPricingSummary(state.sellerSettings) },
      { label: 'Availability', value: seller?.availability || sellerAvailabilitySummary(state.sellerSettings) },
      { label: 'Resources', value: state.sellerMarketStatus ? `${state.sellerMarketStatus.resourceListingCount} listing(s)` : '' },
      { label: 'Discoverable', value: state.sellerMarketStatus ? (state.sellerMarketStatus.discoverable ? 'yes' : 'no') : '' },
    ],
    emptyText: 'Seller policy and resource status are not loaded yet.',
  }
  const checks = renderStageChecklist([
    { label: 'Manifest readable', checked: Boolean(plan || task || lastBuyerMessage), detail: plan?.query || task?.goal || 'Waiting for a scoped buyer manifest.' },
    { label: 'Pricing policy loaded', checked: Boolean(seller?.pricing || state.sellerSettings), detail: seller?.pricing || sellerPricingSummary(state.sellerSettings) || 'Seller pricing policy is missing.', tone: seller?.pricing || state.sellerSettings ? 'good' : 'warn' },
    { label: 'API profile ready', checked: sellerApiReady(), detail: sellerApiReady() ? 'Seller API profile is configured for valuation.' : 'Configure a Seller API profile before automated valuation.', tone: sellerApiReady() ? 'good' : 'warn' },
    { label: 'External execution blocked', checked: true, detail: 'Whitepaper boundary: valuation can quote, negotiate, or reject, but cannot execute.' },
  ], 'No valuation checklist is available yet.')
  const valuationEvents = renderWorkRunEventItems(workRunEventsForStage(data, ['valuation', 'seller_valuation', 'manifest', 'pricing', 'policy']))
  const runItem = run ? renderTransactionStageItems([{
    title: run.intent || run.summary || 'Valuation run',
    meta: progressStateLabel(run.status || run.currentStep || 'run'),
    detail: run.error || run.nextAction || run.currentStep || '',
    chips: [run.runId ? `Run ${shortID(run.runId)}` : undefined, run.updatedAt ? compactTimestamp(run.updatedAt) : undefined],
    tone: run.status === 'failed' ? 'bad' : 'normal',
  }], 'No valuation run yet.') : ''
  return renderStageWorkspace(
    renderStageSplitPanels([manifestSummary, sellerSnapshot]),
    renderStageSection('Valuation gates', checks),
    renderStageSection('Valuation evidence', `${runItem}${renderTransactionStageItems(valuationEvents, 'No valuation checkpoint has been recorded yet.')}`),
  )
}

function renderSellerQuoteResponseStage(data: TransactionProgressData) {
  const planRows = data.plans.flatMap((plan) => (plan.candidates || []).map((candidate): TransactionStageTableRow => ({
    cells: [
      shortID(candidate.providerPubkey || candidate.resourceId || candidate.optionId || 'seller'),
      progressStateLabel(candidate.status),
      candidate.priceAmount ? `${candidate.priceAmount} ${candidate.currency || 'USDC'}` : selectedQuoteForPlan(plan),
      candidate.expiresAt ? compactTimestamp(candidate.expiresAt) : '',
      candidate.message || candidate.quoteId || plan.nextAction || '',
    ],
    tone: candidate.status === 'quoted' ? 'good' : candidate.status === 'rejected' ? 'bad' : candidate.status === 'needs_negotiation' ? 'warn' : 'normal',
  })))
  const taskRows = data.tasks.map((task): TransactionStageTableRow => ({
    cells: [
      shortID(task.providerPubkey || task.quote?.providerPubkey || 'local seller'),
      progressStateLabel(task.status || 'task'),
      taskAmount(task),
      task.quote?.estimatedSeconds ? `${task.quote.estimatedSeconds}s` : '',
      task.quote?.notes || task.error || taskTitle(task),
    ],
    tone: task.status === 'failed' ? 'bad' : task.quote ? 'good' : 'normal',
  }))
  const negotiationItems = data.plans.flatMap((plan) => (plan.candidates || [])
    .filter((candidate) => ['needs_negotiation', 'rejected', 'pending', 'requested', 'quoting'].includes(candidate.status || ''))
    .map((candidate): TransactionStageItem => ({
      title: progressStateLabel(candidate.status),
      meta: shortID(candidate.providerPubkey || candidate.resourceId || candidate.optionId || 'seller'),
      detail: candidate.message || (candidate.status === 'rejected' ? 'Seller rejected this manifest.' : 'Seller response is not a final quote yet.'),
      chips: [candidate.quoteId ? `Quote ${shortID(candidate.quoteId)}` : undefined, candidate.updatedAt ? compactTimestamp(candidate.updatedAt) : undefined],
      tone: candidate.status === 'rejected' ? 'bad' : candidate.status === 'needs_negotiation' ? 'warn' : 'normal',
    })))
  const quoteEvents = renderWorkRunEventItems(workRunEventsForStage(data, ['quote', 'can_accept', 'needs_negotiation', 'reject', 'valuation_response']))
  return renderStageWorkspace(
    renderStageSection('Quote response table', renderStageTable(['Seller', 'Decision', 'Price', 'ETA / Expiry', 'Notes'], [...taskRows, ...planRows], 'No seller quote, negotiation request, or rejection has been recorded yet.')),
    renderStageSection('Negotiation or rejection notes', renderTransactionStageItems([...negotiationItems, ...quoteEvents].slice(0, 10), 'No quote response detail has been recorded yet.')),
  )
}

function renderSellerWaitBuyerStage(data: TransactionProgressData, snapshot: TransactionProgressSnapshot) {
  const approval = latestBy(data.approvals, (item) => item.createdAt || item.expiresAt || '')
  const payment = latestBy(data.payments, (item) => item.updatedAt || item.confirmedAt || item.createdAt || '')
  const confirmedStatuses = ['confirmed', 'confirmed_simulated', 'found_finalized']
  const selectedQuote = data.plans.some((plan) => Boolean(plan.selectedOptionId)) || data.tasks.length > 0
  const approvalDone = approval ? !approvalNeedsDecision(approval) : false
  const paymentDone = payment ? confirmedStatuses.includes(payment.status || '') : !approval?.paymentRequired
  const inputReady = data.tasks.some((task) => task.inputFiles?.length || ['consented', 'claimed', 'running', 'completed'].includes(task.status || ''))
  const checklist = renderStageChecklist([
    { label: 'Buyer selected quote', checked: selectedQuote, detail: selectedQuote ? 'A seller quote is selected or task exists.' : 'Waiting for buyer to choose a quote.', tone: selectedQuote ? 'good' : 'warn' },
    { label: 'Buyer authorized scope', checked: approvalDone, detail: approval ? `${progressStateLabel(approval.status)} / ${approval.riskSummary || approval.action}` : 'No approval record yet.', tone: approvalDone ? 'good' : 'warn' },
    { label: 'Payment or escrow proof', checked: paymentDone, detail: payment ? `${progressStateLabel(payment.status || '')} / ${paymentAmount(payment)}` : 'No payment required or payment not created yet.', tone: paymentDone ? 'good' : 'warn' },
    { label: 'Authorized input ready', checked: inputReady, detail: inputReady ? 'Task inputs are present or task has moved past consent.' : 'Waiting for scoped input transfer.' },
  ], 'No buyer authorization state is available yet.')
  const waitingItems: TransactionStageItem[] = []
  if (approval) {
    waitingItems.push({
      title: approval.action || 'Buyer approval',
      meta: progressStateLabel(approval.status),
      detail: approval.riskSummary || approvalSubjectLabel(approval),
      chips: [approvalAmount(approval), approval.expiresAt ? `Expires ${compactTimestamp(approval.expiresAt)}` : undefined],
      tone: approvalDone ? 'good' as const : 'warn' as const,
    })
  }
  if (payment) {
    waitingItems.push({
      title: payment.status || 'Payment proof',
      meta: paymentAmount(payment),
      detail: payment.proofRef || snapshot.nextAction || 'Payment proof is not confirmed yet.',
      chips: [payment.mode, payment.updatedAt ? compactTimestamp(payment.updatedAt) : undefined],
      tone: confirmedStatuses.includes(payment.status || '') ? 'good' as const : 'warn' as const,
    })
  }
  return renderStageWorkspace(
    renderStageSection('Buyer-side gates', checklist),
    renderStageSection('Authorization and payment records', renderTransactionStageItems(waitingItems, 'Waiting for buyer authorization, escrow proof, or input transfer.')),
  )
}

function renderSellerExecutionPlanStage(data: TransactionProgressData, snapshot: TransactionProgressSnapshot) {
  const run = latestBy(data.workRuns, (item) => item.updatedAt || item.createdAt || '')
  const task = latestBy(data.tasks, (item) => item.updatedAt || item.createdAt || '')
  const inputRows = data.tasks.flatMap((item) => (item.inputFiles || []).map((file): TransactionStageTableRow => ({
    cells: [
      file.name || 'input',
      file.contentType || 'file',
      file.sizeBytes ? `${file.sizeBytes} bytes` : '',
      file.sha256 ? shortID(file.sha256, 12, 8) : '',
      taskTitle(item),
    ],
  })))
  const planPanel = renderStagePanel({
    title: 'Committed execution plan',
    detail: 'A seller should commit a resumable plan before running provider work.',
    facts: [
      { label: 'Task', value: task ? taskTitle(task) : '' },
      { label: 'Run', value: run?.runId ? shortID(run.runId) : '' },
      { label: 'Current step', value: run?.currentStep || snapshot.state },
      { label: 'Plan hash', value: run?.lastCheckpointId },
      { label: 'Worker', value: run?.activeWorker?.workerId || run?.entities?.workerId },
      { label: 'Job', value: run?.entities?.providerJobId || run?.activeWorker?.jobId },
    ],
    emptyText: 'No execution plan has been committed yet.',
  })
  const planEvents = renderWorkRunEventItems(workRunEventsForStage(data, ['input_transfer', 'execution_plan', 'plan_committed', 'hash', 'submit_worker_job']))
  return renderStageWorkspace(
    planPanel,
    renderStageSection('Authorized inputs', renderStageTable(['Name', 'Type', 'Size', 'Hash', 'Task'], inputRows, 'No input transfer receipt has been recorded yet.')),
    renderStageSection('Plan evidence', renderTransactionStageItems(planEvents, 'No execution plan checkpoint has been recorded yet.')),
  )
}

function renderSellerProviderExecutionStage(data: TransactionProgressData, snapshot: TransactionProgressSnapshot) {
  const activeRun = latestBy(data.workRuns, (run) => run.updatedAt || run.createdAt || '')
  const activeTask = latestBy(data.tasks, (task) => task.updatedAt || task.createdAt || '')
  const runPanel = renderStagePanel({
    title: 'Provider execution',
    detail: 'Only authorized input and approved scope may run on the seller side.',
    facts: [
      { label: 'Task', value: activeTask ? taskTitle(activeTask) : '' },
      { label: 'Status', value: activeRun?.status || activeTask?.status || snapshot.state },
      { label: 'Current step', value: activeRun?.currentStep },
      { label: 'Next action', value: activeRun?.nextAction || snapshot.nextAction },
      { label: 'Worker', value: activeRun?.activeWorker?.workerId || activeRun?.entities?.workerId },
      { label: 'Job', value: activeRun?.entities?.providerJobId || activeRun?.activeWorker?.jobId },
      { label: 'Error', value: activeRun?.error || activeTask?.error },
    ],
    emptyText: 'No provider execution is running yet.',
  })
  const taskItems = data.tasks.map((task): TransactionStageItem => ({
    title: taskTitle(task),
    meta: progressStateLabel(task.status),
    detail: task.error || snapshot.nextAction || 'Provider execution state.',
    chips: [taskAmount(task), task.updatedAt ? compactTimestamp(task.updatedAt) : undefined, task.providerPubkey || task.quote?.providerPubkey ? `Provider ${shortID(task.providerPubkey || task.quote?.providerPubkey)}` : undefined],
    tone: task.status === 'failed' ? 'bad' : task.status === 'completed' ? 'good' : ['running', 'claimed', 'consented'].includes(task.status || '') ? 'warn' : 'normal',
  }))
  const runItems = data.workRuns.map((run): TransactionStageItem => ({
    title: run.intent || run.summary || 'Seller run',
    meta: progressStateLabel(run.status || run.currentStep || 'run'),
    detail: run.error || run.nextAction || run.currentStep || '',
    chips: [run.entities?.providerJobId ? `Job ${shortID(run.entities.providerJobId)}` : undefined, run.activeWorker?.status ? `Worker ${run.activeWorker.status}` : undefined, run.updatedAt ? compactTimestamp(run.updatedAt) : undefined],
    tone: run.status === 'failed' ? 'bad' : run.status === 'completed' ? 'good' : 'warn',
  }))
  const checkpointItems = renderWorkRunEventItems(workRunEventsForStage(data, ['provider_execution', 'execution_blocked', 'running', 'worker', 'checkpoint', 'docker']))
  return renderStageWorkspace(
    runPanel,
    renderStageSection('Execution records', renderTransactionStageItems([...taskItems, ...runItems].slice(0, 10), 'No seller execution record has started yet.')),
    renderStageSection('Execution checkpoints', renderTransactionStageItems(checkpointItems, 'No provider execution checkpoint has been recorded yet.')),
  )
}

function renderSellerLocalSupervisorStage(data: TransactionProgressData, snapshot: TransactionProgressSnapshot) {
  const run = latestBy(data.workRuns, (item) => item.updatedAt || item.createdAt || '')
  const supervisorPanel = renderStagePanel({
    title: 'Local supervisor',
    detail: 'Local Docker heartbeat stays local; cloud only receives meaningful state changes.',
    facts: [
      { label: 'Run', value: run?.runId ? shortID(run.runId) : '' },
      { label: 'Worker', value: run?.activeWorker?.workerId || run?.entities?.workerId },
      { label: 'Worker status', value: run?.activeWorker?.status },
      { label: 'Job', value: run?.activeWorker?.jobId || run?.entities?.providerJobId },
      { label: 'Last update', value: run?.activeWorker?.updatedAt ? compactTimestamp(run.activeWorker.updatedAt) : run?.updatedAt ? compactTimestamp(run.updatedAt) : '' },
      { label: 'Next action', value: run?.nextAction || snapshot.nextAction },
    ],
    emptyText: 'No local supervisor state has been recorded yet.',
  })
  const supervisorChecks = renderStageChecklist([
    { label: 'Local heartbeat only', checked: true, detail: 'Five-minute Docker heartbeat should not pollute the cloud transaction log.' },
    { label: 'Recoverable state known', checked: Boolean(run?.lastCheckpointId || run?.activeWorker?.status), detail: run?.lastCheckpointId || run?.activeWorker?.status || 'Waiting for a checkpoint or worker state.' },
    { label: 'Blocked state surfaced', checked: !snapshot.state.includes('blocked'), detail: snapshot.state.includes('blocked') ? snapshot.nextAction || 'Execution is blocked.' : 'No execution block is currently recorded.', tone: snapshot.state.includes('blocked') ? 'warn' : 'good' },
  ], 'No supervisor checklist is available yet.')
  const events = renderWorkRunEventItems(workRunEventsForStage(data, ['poll_worker_job', 'heartbeat', 'supervisor', 'resume', 'blocked', 'waiting_worker']))
  return renderStageWorkspace(
    supervisorPanel,
    renderStageSection('Supervisor gates', supervisorChecks),
    renderStageSection('Local run events', renderTransactionStageItems(events, 'No local supervisor event has been recorded yet.')),
  )
}

function renderSellerTerminalReportStage(data: TransactionProgressData, snapshot: TransactionProgressSnapshot) {
  const artifactRows = data.tasks.flatMap((task) => (task.artifacts || []).map((artifact): TransactionStageTableRow => ({
    cells: [
      artifact.name || 'Artifact',
      artifact.contentType || 'delivery',
      artifact.sizeBytes ? `${artifact.sizeBytes} bytes` : '',
      artifact.sha256 ? shortID(artifact.sha256, 12, 8) : '',
      taskTitle(task),
    ],
    tone: task.status === 'failed' ? 'bad' : 'good',
  })))
  const hashRows = data.tasks.flatMap((task) => Object.entries(task.artifactHashes || {}).map(([name, hash]): TransactionStageTableRow => ({
    cells: [name, shortID(hash, 14, 10), taskTitle(task), task.completedAt ? compactTimestamp(task.completedAt) : ''],
    tone: task.status === 'failed' ? 'bad' : 'good',
  })))
  const reportItems = [
    ...data.tasks.filter((task) => ['completed', 'failed'].includes(task.status || '') || task.error).map((task): TransactionStageItem => ({
      title: task.status === 'failed' ? 'Failed terminal report' : 'Terminal report',
      meta: progressStateLabel(task.status),
      detail: task.error || snapshot.nextAction || 'Seller terminal report is ready for buyer verification.',
      chips: [shortID(task.id), task.completedAt ? compactTimestamp(task.completedAt) : undefined],
      tone: task.status === 'failed' ? 'bad' : 'good',
    })),
    ...renderWorkRunEventItems(workRunEventsForStage(data, ['terminal_report', 'fetch_artifacts', 'artifact', 'receipt', 'cleanup', 'log', 'error'])),
  ]
  return renderStageWorkspace(
    renderStageSection('Artifacts', renderStageTable(['Artifact', 'Type', 'Size', 'Hash', 'Task'], artifactRows, 'No artifact has been attached to a terminal report yet.')),
    renderStageSection('Hash evidence', renderStageTable(['Artifact', 'Hash', 'Task', 'Completed'], hashRows, 'No artifact hash evidence has been recorded yet.')),
    renderStageSection('Terminal evidence', renderTransactionStageItems(reportItems.slice(0, 10), 'No terminal report, failure report, log, or cleanup receipt has been recorded yet.')),
  )
}

function renderSellerSettlementStage(data: TransactionProgressData, snapshot: TransactionProgressSnapshot) {
  const confirmedStatuses = ['confirmed', 'confirmed_simulated', 'found_finalized']
  const finalTask = latestBy(data.tasks, (task) => task.completedAt || task.updatedAt || task.createdAt || '')
  const finalPayment = latestBy(data.payments, (payment) => payment.updatedAt || payment.confirmedAt || payment.createdAt || '')
  const settlementPanel = renderStagePanel({
    title: 'Seller settlement',
    detail: 'Close with payout, refund, dispute, or cleanup evidence after buyer verification.',
    facts: [
      { label: 'State', value: snapshot.state },
      { label: 'Task', value: finalTask ? `${progressStateLabel(finalTask.status)} / ${taskTitle(finalTask)}` : '' },
      { label: 'Payment', value: finalPayment ? `${progressStateLabel(finalPayment.status || '')} / ${paymentAmount(finalPayment)}` : '' },
      { label: 'Provider', value: snapshot.provider ? shortID(snapshot.provider) : '' },
      { label: 'Artifacts', value: snapshot.artifacts },
      { label: 'Updated', value: snapshot.updatedAt ? compactTimestamp(snapshot.updatedAt) : '' },
    ],
    emptyText: 'No seller settlement state is available yet.',
  })
  const paymentItems = data.payments.map((payment): TransactionStageItem => ({
    title: payment.status || 'Payment',
    meta: paymentAmount(payment),
    detail: payment.proofRef || 'Waiting for release, refund, dispute, or close evidence.',
    chips: [payment.mode, payment.confirmedAt ? `Confirmed ${compactTimestamp(payment.confirmedAt)}` : undefined, payment.updatedAt ? `Updated ${compactTimestamp(payment.updatedAt)}` : undefined],
    tone: confirmedStatuses.includes(payment.status || '') ? 'good' : 'warn',
  }))
  const cleanupItems = renderWorkRunEventItems(workRunEventsForStage(data, ['settlement', 'dispute', 'refund', 'release', 'closed', 'cleanup_receipt', 'cleanup']))
  const terminalItems = data.tasks
    .filter((task) => ['completed', 'failed'].includes(task.status || ''))
    .map((task): TransactionStageItem => ({
      title: task.status === 'failed' ? 'Dispute or refund risk' : 'Ready for payout',
      meta: progressStateLabel(task.status),
      detail: task.error || snapshot.nextAction || 'Buyer verification controls release or dispute.',
      chips: [shortID(task.id), task.completedAt ? compactTimestamp(task.completedAt) : undefined],
      tone: task.status === 'failed' ? 'bad' : 'good',
    }))
  return renderStageWorkspace(
    settlementPanel,
    renderStageSection('Payment and cleanup evidence', renderTransactionStageItems([...paymentItems, ...terminalItems, ...cleanupItems].slice(0, 12), 'No settlement, dispute, payout, refund, or cleanup evidence has been recorded yet.')),
  )
}

function renderStageTopline(snapshot: TransactionProgressSnapshot) {
  const items = [
    { label: 'State', value: progressStateLabel(snapshot.state) },
    { label: 'Owner', value: progressStateLabel(snapshot.owner) },
    { label: 'Waiting', value: progressStateLabel(snapshot.waitingFor) },
    { label: 'Updated', value: snapshot.updatedAt ? compactTimestamp(snapshot.updatedAt) : '' },
  ].filter((item) => item.value)
  return `
    <div class="transaction-stage-topline">
      <div class="transaction-stage-topline-grid">
        ${items.map((item) => `
          <div>
            <span>${escapeHTML(item.label)}</span>
            <strong>${escapeHTML(item.value)}</strong>
          </div>
        `).join('')}
      </div>
      ${snapshot.nextAction ? `<p>${escapeHTML(snapshot.nextAction)}</p>` : ''}
    </div>
  `
}

function renderStageWorkspace(...sections: Array<string | undefined | false>) {
  const body = sections.filter(Boolean).join('')
  return body ? `<div class="transaction-stage-workspace">${body}</div>` : renderStageEmpty('No stage data yet.')
}

function renderStageSection(title: string, body: string, detail?: string) {
  return `
    <section class="transaction-stage-section">
      <div class="transaction-stage-section-head">
        <h4>${escapeHTML(title)}</h4>
        ${detail ? `<p>${escapeHTML(detail)}</p>` : ''}
      </div>
      ${body}
    </section>
  `
}

function renderStageSplitPanels(panels: TransactionStagePanel[]) {
  return `
    <div class="transaction-stage-panels">
      ${panels.map(renderStagePanel).join('')}
    </div>
  `
}

function renderStagePanel(panel: TransactionStagePanel) {
  const body = panel.body || (panel.facts ? renderTransactionStageFacts(panel.facts) : '')
  return `
    <section class="transaction-stage-panel">
      <div class="transaction-stage-section-head">
        <h4>${escapeHTML(panel.title)}</h4>
        ${panel.detail ? `<p>${escapeHTML(panel.detail)}</p>` : ''}
      </div>
      ${body || renderStageEmpty(panel.emptyText || 'No data for this panel yet.')}
    </section>
  `
}

function renderStageChecklist(items: TransactionStageCheckItem[], emptyText: string) {
  if (!items.length) return renderStageEmpty(emptyText)
  return `
    <ul class="transaction-stage-checklist">
      ${items.map((item) => {
        const tone = item.tone || (item.checked ? 'good' : 'normal')
        return `
          <li class="${tone}${item.checked ? ' checked' : ''}">
            <span aria-hidden="true"></span>
            <div>
              <strong>${escapeHTML(item.label)}</strong>
              ${item.meta ? `<em>${escapeHTML(item.meta)}</em>` : ''}
              ${item.detail ? `<p>${escapeHTML(item.detail)}</p>` : ''}
            </div>
          </li>
        `
      }).join('')}
    </ul>
  `
}

function renderStageActionBar(actions: string[]) {
  const html = actions.filter(Boolean).join('')
  return html ? `<div class="transaction-stage-actions transaction-stage-action-bar">${html}</div>` : ''
}

function renderStageTable(headers: string[], rows: TransactionStageTableRow[], emptyText: string) {
  if (!rows.length) return renderStageEmpty(emptyText)
  return `
    <div class="transaction-stage-table-wrap">
      <table class="transaction-stage-table">
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHTML(header)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr class="${row.tone || 'normal'}">
              ${row.cells.map((cell) => `<td>${renderStageTableCell(cell)}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `
}

function renderStageTableCell(cell: TransactionStageTableCell) {
  if (typeof cell !== 'string') return cell.html
  return escapeHTML(compactText(cell, 120))
}

function quoteRowsForPlan(plan: OrderPlan): TransactionStageTableRow[] {
  const optionRows = (plan.options || []).slice(0, 6).map((option): TransactionStageTableRow => {
    const paid = optionIsPaid(option)
    const selected = plan.selectedOptionId === option.optionId
    const status = selected ? 'selected' : option.realtimeStatus || (plan.realtimeRequired ? 'unconfirmed' : 'quote')
    const actions = plan.status === 'pending_selection' && !isDemoOrderPlan(plan)
      ? `<button type="button" data-select-plan="${escapeAttr(plan.planId)}" data-option-id="${escapeAttr(option.optionId)}">${paid ? 'Choose + PIN' : 'Choose'}</button>`
      : ''
    return {
      cells: [
        shortID(option.providerPubkey),
        optionPrice(option),
        optionCapability(option),
        option.reason || option.draft?.goal || 'Prepared seller option.',
        [status, option.expiresAt ? `expires ${compactTimestamp(option.expiresAt)}` : ''].filter(Boolean).join(' / '),
        { html: actions || '<span class="transaction-stage-muted">No action</span>' },
      ],
      tone: selected ? 'good' : status === 'unconfirmed' ? 'warn' : 'normal',
    }
  })
  const optionKeys = new Set(optionRows.map((row) => stageDisplayValue(row.cells[0]).toLowerCase()).filter(Boolean))
  const candidateRows = (plan.candidates || [])
    .filter((candidate) => !optionKeys.has(shortID(candidate.providerPubkey || candidate.resourceId || candidate.optionId || 'seller').toLowerCase()))
    .map((candidate): TransactionStageTableRow => ({
      cells: [
        shortID(candidate.providerPubkey || candidate.resourceId || candidate.optionId || 'seller'),
        candidate.priceAmount ? `${candidate.priceAmount} ${candidate.currency || 'USDC'}` : '',
        candidate.quoteId ? `Quote ${shortID(candidate.quoteId)}` : '',
        candidate.message || 'Seller response',
        progressStateLabel(candidate.status),
        { html: '<span class="transaction-stage-muted">No action</span>' },
      ],
      tone: candidate.status === 'quoted' ? 'good' : candidate.status === 'rejected' ? 'bad' : candidate.status === 'needs_negotiation' ? 'warn' : 'normal',
    }))
  return [...optionRows, ...candidateRows]
}

function uniqueDisplayStrings(values: Array<string | undefined>) {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const value of values) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(text)
  }
  return unique
}

function messagesForBuyerTransactionStage(stageId: BuyerTransactionStageId, messages: ChatMessage[]) {
  const matches = messages.filter((message) => {
    const haystack = [message.meta, message.text, message.result?.summary, message.result?.nextAction].filter(Boolean).join(' ').toLowerCase()
    if (stageId === 'intent') return message.role === 'user' && !message.result
    if (stageId === 'plan') return includesAny(haystack, ['plan', 'manifest', 'requirements', 'draft', 'classify', 'review'])
    if (stageId === 'offer') return Boolean(message.result) || includesAny(haystack, ['search', 'seller card', 'candidate', 'discover', 'matching', 'negotiate', 'clarify', 'missing', 'risk', 'feasible', 'rejected', 'quote', 'price', 'seller choice', 'transaction plan', 'choose seller'])
    if (stageId === 'authorize') return includesAny(haystack, ['approval', 'authorize', 'permission', 'manifest', 'sensitive', 'payment', 'escrow', 'pin', 'fund', 'proof'])
    if (stageId === 'execute') return includesAny(haystack, ['execute', 'provider', 'docker', 'worker', 'running', 'task'])
    return includesAny(haystack, ['deliver', 'artifact', 'receipt', 'log', 'error', 'verify', 'hash', 'inspect', 'completed', 'failed', 'settle', 'release', 'refund', 'dispute', 'closed'])
  })
  return matches.slice(-12)
}

function renderTransactionStageFacts(items: TransactionStageFact[]) {
  const rows = items
    .map((item) => ({ label: item.label, value: stageDisplayValue(item.value) }))
    .filter((item) => item.value)
  if (!rows.length) return ''
  return `
    <dl class="transaction-stage-facts">
      ${rows.map((item) => `
        <div>
          <dt>${escapeHTML(item.label)}</dt>
          <dd>${escapeHTML(compactText(item.value, 140))}</dd>
        </div>
      `).join('')}
    </dl>
  `
}

function renderTransactionStageItems(items: TransactionStageItem[], emptyText: string) {
  if (!items.length) return renderStageEmpty(emptyText)
  return `
    <div class="transaction-stage-list">
      ${items.map(renderTransactionStageItem).join('')}
    </div>
  `
}

function renderTransactionStageItem(item: TransactionStageItem) {
  const chips = (item.chips || []).map(stageDisplayValue).filter(Boolean)
  return `
    <article class="transaction-stage-item ${item.tone || 'normal'}">
      <div class="transaction-stage-item-main">
        <div class="transaction-stage-item-title">
          <strong>${escapeHTML(item.title)}</strong>
          ${item.meta ? `<span>${escapeHTML(item.meta)}</span>` : ''}
        </div>
        ${item.detail ? `<p>${escapeHTML(item.detail)}</p>` : ''}
        ${chips.length ? `<div class="transaction-stage-chips">${chips.map((chip) => `<span>${escapeHTML(chip)}</span>`).join('')}</div>` : ''}
      </div>
      ${item.actions ? `<div class="transaction-stage-actions">${item.actions}</div>` : ''}
    </article>
  `
}

function renderTransactionStageMessages(messages: ChatMessage[]) {
  if (!messages.length) return ''
  return `
    <section class="transaction-stage-section">
      <h4>Stage chat</h4>
      <div class="transaction-stage-messages">
        ${messages.map(renderChatMessage).join('')}
      </div>
    </section>
  `
}

function renderStageEmpty(text: string) {
  return `<p class="transaction-stage-empty">${escapeHTML(text)}</p>`
}

function approvalNeedsDecision(approval: Approval) {
  return !['approved', 'rejected', 'denied', 'cancelled', 'expired'].includes((approval.status || '').toLowerCase())
}

function taskBudgetLabel(task?: Task) {
  if (!task?.budget?.maxAmount) return ''
  return `${task.budget.maxAmount} ${task.budget.currency || 'USDC'} max`
}

function formatRecordSummary(record?: Record<string, unknown>) {
  if (!record) return ''
  return Object.entries(record)
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${stageDisplayValue(value)}`)
    .join(' / ')
}

function stageDisplayValue(value?: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stageDisplayValue).filter(Boolean).join(', ')
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle))
}

function workRunEventsForStage(data: TransactionProgressData, keywords: string[]) {
  return data.workRunEvents
    .filter((event) => includesAny([event.type, event.step, event.status, event.summary].filter(Boolean).join(' ').toLowerCase(), keywords))
    .sort((a, b) => sortTime(b.createdAt) - sortTime(a.createdAt))
    .slice(0, 6)
}

function renderWorkRunEventItems(events: WorkRunEvent[]): TransactionStageItem[] {
  return events.map((event): TransactionStageItem => ({
    title: progressStateLabel(event.type || event.status || 'Checkpoint'),
    meta: event.step || event.status || 'event',
    detail: event.summary || stageDisplayValue(event.data) || event.checkpointId || '',
    chips: [event.createdAt ? compactTimestamp(event.createdAt) : undefined, event.runId ? `Run ${shortID(event.runId)}` : undefined],
    tone: progressEventTone(event.type || event.status || ''),
  }))
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
    Boolean(approval.taskId && taskIds.has(approval.taskId)) ||
    Boolean(approval.planId && planIds.has(approval.planId)) ||
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
    { id: 'intent', title: 'Intent', detail: 'User need, task goal, constraints, budget, and draft starting point.' },
    { id: 'plan', title: 'Plan', detail: 'Shape task requirements, agent requirements, remote manifest, and review blockers.' },
    { id: 'offer', title: 'Offer', detail: 'Cloud matches sellers, sellers negotiate/quote, buyer reviews returned options.' },
    { id: 'authorize', title: 'Authorize', detail: 'Approve scope, sensitive actions, payment, escrow, and input release.' },
    { id: 'execute', title: 'Execute', detail: 'Transfer approved inputs, run provider work, and track checkpoints.' },
    { id: 'verify', title: 'Verify', detail: 'Inspect delivery evidence, accept, dispute, release, refund, or close.' },
  ]
}

function currentProgressStageId(side: OrderSide, orderState: string, run?: WorkRun) {
  const step = run?.currentStep || ''
  if (side === 'seller') {
    if (['cloud_matching', 'seller_valuation'].includes(orderState)) return 'task_valuation'
    if (step === 'seller_valuation' || step === 'valuation_request') return 'task_valuation'
    if (step === 'negotiate_task' || step === 'compare_quotes' || step === 'quote_review' || step === 'seller_valuation_response') return 'quote_response'
    if (orderState === 'quote_review') return 'quote_response'
    if (step === 'request_approval' || step === 'order_authorized' || step === 'wait_owner_approval_payment' || step === 'create_payment_intent' || step === 'fund_chain_escrow' || step === 'sync_payment_evidence' || step === 'verify_payment_evidence') return 'wait_buyer'
    if (orderState === 'order_authorized') return 'wait_buyer'
    if (step === 'input_transfer' || step === 'submit_worker_job' || step === 'execution_plan_committed') return 'execution_plan'
    if (orderState === 'input_transfer') return 'execution_plan'
    if (step === 'poll_worker_job') return 'local_supervisor'
    if (step === 'provider_execution' || step === 'execution_blocked') return 'provider_execution'
    if (orderState === 'provider_execution' || orderState === 'execution_blocked') return step === 'poll_worker_job' ? 'local_supervisor' : 'provider_execution'
    if (step === 'terminal_report' || step === 'fetch_artifacts' || step === 'verify_artifacts' || step === 'buyer_verification') return 'terminal_report'
    if (orderState === 'buyer_verification') return 'terminal_report'
    if (step === 'settlement_or_dispute' || step === 'closed') return 'settlement'
    if (orderState === 'settlement_or_dispute' || orderState === 'closed') return 'settlement'
    return 'task_valuation'
  }
  if (step === 'classify_intent' || step === 'start_task_flow') return 'intent'
  if (step === 'confirm_exora_plan' || step === 'write_plan_files' || step === 'review_remote_manifest') return 'plan'
  if (step === 'discover_agent_cards' || step === 'cloud_matching' || step === 'submit_manifest_for_matching') return 'offer'
  if (step === 'negotiate_task' || step === 'compare_quotes' || step === 'seller_valuation') return 'offer'
  if (step === 'create_order_plan' || step === 'wait_owner_seller_choice' || step === 'quote_review') return 'offer'
  if (step === 'request_approval' || step === 'order_authorized' || step === 'wait_owner_approval_payment') return 'authorize'
  if (step === 'create_payment_intent' || step === 'fund_chain_escrow' || step === 'sync_payment_evidence' || step === 'verify_payment_evidence') return 'authorize'
  if (step === 'input_transfer' || step === 'submit_worker_job' || step === 'poll_worker_job' || step === 'provider_execution' || step === 'execution_blocked') return 'execute'
  if (step === 'fetch_artifacts' || step === 'verify_artifacts' || step === 'buyer_verification' || step === 'terminal_report') return 'verify'
  if (step === 'settlement_or_dispute' || step === 'closed') return 'verify'
  if (orderState === 'plan_first') return 'intent'
  if (orderState === 'cloud_matching') return 'offer'
  if (orderState === 'seller_valuation') return 'offer'
  if (orderState === 'quote_review') return 'offer'
  if (orderState === 'order_authorized') return 'authorize'
  if (orderState === 'input_transfer') return 'execute'
  if (orderState === 'provider_execution' || orderState === 'execution_blocked') return 'execute'
  if (orderState === 'buyer_verification') return 'verify'
  if (orderState === 'settlement_or_dispute' || orderState === 'closed') return 'verify'
  return 'intent'
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

function triggerBuyerFirstStepTransition() {
  if (state.workOrderSide !== 'buyer') return
  state.buyerFirstStepTransition = true
  if (buyerFirstStepTransitionTimer) window.clearTimeout(buyerFirstStepTransitionTimer)
  buyerFirstStepTransitionTimer = window.setTimeout(() => {
    state.buyerFirstStepTransition = false
    fields.chatView.classList.remove('buyer-first-step-transition')
    buyerFirstStepTransitionTimer = undefined
  }, 420)
}

function renderChatSurface() {
  const started = chatSurfaceStarted()
  const buyerInitialSetup = state.workOrderSide === 'buyer' && !started
  const sellerMode = state.workOrderSide === 'seller'
  const sellerMonitor = sellerMonitorActive() || (sellerMode && !started)
  const sellerEmptySetup = false
  fields.chatView.classList.remove('compact')
  fields.chatView.classList.toggle('empty-mode', !started && !sellerMonitor)
  fields.chatView.classList.toggle('conversation-mode', started && !sellerMonitor)
  fields.chatView.classList.toggle('buyer-initial-setup', buyerInitialSetup && !sellerMonitor)
  fields.chatView.classList.toggle('seller-api-only', sellerMode)
  fields.chatView.classList.toggle('seller-empty-setup', sellerEmptySetup && !sellerMonitor)
  fields.chatView.classList.toggle('seller-monitor-mode', sellerMonitor)
  fields.chatView.classList.toggle('buyer-first-step-transition', state.buyerFirstStepTransition && state.workOrderSide === 'buyer')
  fields.chatFeed.classList.remove('hidden')
  agentChatForm.classList.toggle('hidden', sellerEmptySetup || sellerMonitor)
  renderExternalWorkLockControls()
  renderChatAgentControl()
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
  if (state.activeView === 'chat' || state.activeView === 'work') {
    const showingResourceConsole = !state.pinStep && !activeGpuDemoPanel()
    return showingResourceConsole || state.buyerFirstStepTransition || chatSurfaceStarted()
  }
  return false
}

function resizeAgentComposer() {
  agentQuery.style.height = 'auto'
  const maxHeight = 168
  const nextHeight = Math.min(Math.max(agentQuery.scrollHeight, 38), maxHeight)
  agentQuery.style.height = `${nextHeight}px`
  agentQuery.style.overflowY = agentQuery.scrollHeight > maxHeight ? 'auto' : 'hidden'
  updateComposerOverlaySpace()
}

function updateComposerOverlaySpace() {
  const stack = app.querySelector<HTMLElement>('[data-buyer-entry-stack]')
  if (!stack) return
  const height = Math.max(agentChatForm.offsetHeight, stack.offsetHeight, 72)
  fields.chatView.style.setProperty('--composer-overlay-height', `${Math.ceil(height)}px`)
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
  state.cartOpen = true
  state.marketRailDetailId = undefined
  state.marketDetailProvider = undefined
  state.activeCardEditor = undefined
  state.marketCardSearchQuery = trimmed
  state.marketCardSearchError = undefined
  state.marketCardSearchLoading = true
  renderCartModal()
  setBusy(true)
  try {
    const response = await invoke<AgentCardSearchResponse>('agent_card_search', {
      input: { role: 'seller', q: trimmed },
    })
    state.marketCardSearchCandidates = agentCardSearchCandidates(response)
  } catch (error) {
    state.marketCardSearchCandidates = []
    state.marketCardSearchError = humanizeError(error)
    showToast(humanizeError(error))
  } finally {
    state.marketCardSearchLoading = false
    setBusy(false)
    renderCartModal()
  }
}

const settingsNavItems: Array<{ view: SettingsView; titleKey: string }> = [
  { view: 'wallet', titleKey: 'settings.wallet.nav' },
  { view: 'archives', titleKey: 'settings.archives.nav' },
]

function renderLedger() {
  renderViewTabs()
  fields.ledgerList.classList.toggle('settings-list', state.activeView === 'settings')
  if (state.activeView === 'settings') {
    renderSettingsSidebar()
    localize(fields.taskSidebar)
    return
  }
  renderOrderActivitySidebar()
  localize(fields.taskSidebar)
}

function renderSettingsSidebar() {
  fields.sidebarTitle.textContent = 'Settings'
  fields.ledgerCount.classList.remove('hidden')
  fields.ledgerCount.textContent = String(settingsNavItems.length)
  setLedgerEmpty(false)
  fields.sidebarSectionHead.classList.add('hidden')
  const settingItems = settingsNavItems.map((item) => {
    const title = t(item.titleKey)
    return `
    <button class="ledger-item history-record settings-record ${item.view === state.activeSettingsView ? 'active' : ''}" data-settings-tab="${escapeHTML(item.view)}" title="${escapeAttr(title)}">
      <span class="settings-record-icon">${settingsNavIcons[item.view]}</span>
      <strong>${escapeHTML(title)}</strong>
    </button>
  `
  }).join('')
  fields.ledgerList.innerHTML = `<div class="settings-sidebar-heading">Setting</div>${settingItems}`
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeSettingsView = button.dataset.settingsTab as SettingsView
      scheduleSaveAppSettings()
      renderAll()
      if (state.activeSettingsView === 'wallet') {
        refreshSettingsStatus()
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
    fields.contextStrip.textContent = t('context.approval', { action: selected.value.action || t('common.request'), task: approvalSubjectLabel(selected.value) })
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
  return thread ? renderTransactionProgressPanel(thread, thread.side || state.workOrderSide) : ''
}

function v3FormatBytes(value: unknown) {
  const bytes = Number(value || 0)
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${bytes} B`
}

function v3PriceLabel(value?: Record<string, unknown>) {
  if (!value) return 'Price in manifest'
  const amount = value.amount ?? value.pricePerMinute ?? '—'
  return `${amount} ${value.currency || ''}${value.unit ? ` / ${value.unit}` : ''}`.trim()
}

function v3ProductMetrics(product: V3Product) {
  const manifest = product.manifest || {}
  const price = (manifest.price || {}) as Record<string, unknown>
  const limits = (manifest.limits || {}) as Record<string, unknown>
  if (product.productKind === 'compute') return [
    { label: 'Price', value: v3PriceLabel(price) },
    { label: 'Minimum', value: `${limits.minMinutes || 1} min` },
    { label: 'Workspace', value: `${manifest.workspaceGiB || '—'} GiB` },
  ]
  if (product.productKind === 'download') return [
    { label: 'Price', value: v3PriceLabel(price) },
    { label: 'Grant', value: `${manifest.grantHours || '—'} h` },
    { label: 'Version', value: String(manifest.version || 'fixed') },
  ]
  const operations = Array.isArray(manifest.operations) ? manifest.operations.length : 1
  return [
    { label: 'Fee', value: v3PriceLabel(price) },
    { label: 'Operations', value: String(operations) },
    { label: 'Schema', value: 'OpenAPI 3.x' },
  ]
}

function v3ProductChips(product: V3Product) {
  const manifest = product.manifest || {}
  if (product.productKind === 'compute') return ['Guest Root', '1:1 VM', String(manifest.region || 'region declared')]
  if (product.productKind === 'download') return [String(manifest.license || 'licensed'), String(manifest.delivery || 'downloadable'), 'SHA-256']
  return ['JSON Schema', manifest.secretConfigured ? 'Gateway auth' : 'No secret', 'Agent callable']
}

async function loadV3Catalog() {
  if (state.v3CatalogLoading) return
  state.v3CatalogLoading = true
  state.v3CatalogError = undefined
  renderDecisionPanel()
  try {
    const response = await invoke<{ products?: V3Product[] }>('catalog_products', { input: { query: state.v3CatalogQuery } })
    state.v3Products = response.products || []
    state.v3CatalogLoaded = true
  } catch (error) {
    state.v3CatalogError = humanizeError(error)
  } finally {
    state.v3CatalogLoading = false
    renderDecisionPanel()
  }
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

async function loadV3ActivityDetail(sessionId: string) {
  if (!sessionId) return
  state.v3ActivityDetailLoading = true
  state.v3ActivityDetailError = undefined
  state.v3ActivityDetail = undefined
  renderDecisionPanel()
  try {
    const response = await invoke<{ session?: V3ActivityDetail }>('activity_session', { input: { id: sessionId } })
    if (state.selectedV3ActivitySessionId !== sessionId) return
    state.v3ActivityDetail = response.session
  } catch (error) {
    if (state.selectedV3ActivitySessionId === sessionId) state.v3ActivityDetailError = humanizeError(error)
  } finally {
    if (state.selectedV3ActivitySessionId === sessionId) {
      state.v3ActivityDetailLoading = false
      renderDecisionPanel()
      renderLedger()
    }
  }
}

function selectV3ActivitySession(sessionId: string) {
  if (!sessionId) return
  state.selectedV3ActivitySessionId = sessionId
  state.v3SelectedProduct = undefined
  const cached = state.v3ActivitySessions[state.workOrderSide].find((item) => item.sessionId === sessionId)
  state.v3ActivityDetail = cached as V3ActivityDetail | undefined
  state.v3ActivityDetailError = undefined
  renderLedger()
  void loadV3ActivityDetail(sessionId)
}

function closeV3ActivityDetail() {
  state.selectedV3ActivitySessionId = undefined
  state.v3ActivityDetail = undefined
  state.v3ActivityDetailError = undefined
  state.v3ActivityDetailLoading = false
  renderAll()
}

async function loadV3Listings() {
  if (state.v3ListingsLoading) return
  state.v3ListingsLoading = true
  state.v3SellerError = undefined
  renderDecisionPanel()
  try {
    const [response, local] = await Promise.all([
      invoke<{ listings?: V3Listing[]; applications?: V3ListingApplication[]; offline?: boolean }>('provider_listings'),
      invoke<{ endpoints?: V3LocalEndpoint[] }>('provider_endpoint_local_list').catch(() => ({ endpoints: [] })),
    ])
    state.v3Listings = response.listings || []
    state.v3ListingApplications = response.applications || []
    state.v3LocalEndpoints = local.endpoints || []
    state.v3ListingsLoaded = true
    state.v3SellerError = undefined
  } catch (error) {
    state.v3SellerError = humanizeError(error)
  } finally {
    state.v3ListingsLoading = false
    renderDecisionPanel()
  }
}

async function loadV3WindowsEnvironments() {
  if (state.v3EnvironmentImagesLoaded) return
  state.v3EnvironmentImagesLoaded = true
  try {
    const [runtime, catalog, installed] = await Promise.all([
      invoke<{ result?: Record<string, unknown>; measuredAt?: string }>('provider_host_snapshot'),
      invoke<{ images?: V3EnvironmentImage[]; offline?: boolean }>('provider_environment_catalog'),
      invoke<{ local?: { environments?: Array<Record<string, any>> }; attestations?: Array<Record<string, any>>; storage?: { rootPath?: string; workspaceGiB?: number; freeBytes?: number; pricing?: { baseFee?: number; baseFeeEnabled?: boolean; pricePerMinute?: number; minimumMinutes?: number; longDiscountAfterMinutes?: number; longDiscountPercent?: number; longDiscountMinimumPricePercent?: number; longDiscountEnabled?: boolean } } }>('provider_environment_installed'),
    ])
    if (runtime.result && Object.keys(runtime.result).length) state.v3VMProbe = runtime.result
    state.v3EnvironmentImages = catalog.images || []
    state.v3EnvironmentCatalogOffline = Boolean(catalog.offline)
    const attestations = installed.attestations || []
    state.v3InstalledEnvironments = (installed.local?.environments || []).map((environment) => ({
      ...environment,
      attestation: attestations.find((item) => item.report?.environmentId === environment.environmentId),
    }))
    state.v3EnvironmentRoot = installed.storage?.rootPath || ''
    state.v3EnvironmentWorkspaceGiB = Math.max(20, Number(installed.storage?.workspaceGiB || 100))
    state.v3EnvironmentRootFreeBytes = Number(installed.storage?.freeBytes || 0)
    state.v3BaseFee = Math.max(0, Number(installed.storage?.pricing?.baseFee || 0))
    state.v3BaseFeeEnabled = installed.storage?.pricing?.baseFeeEnabled ?? state.v3BaseFee > 0
    state.v3PricePerMinute = Math.max(0, Number(installed.storage?.pricing?.pricePerMinute || 0))
    state.v3MinimumMinutes = Math.max(1, Number(installed.storage?.pricing?.minimumMinutes || 10))
    state.v3LongDiscountAfterMinutes = Math.max(1, Number(installed.storage?.pricing?.longDiscountAfterMinutes || 60))
    state.v3LongDiscountPercent = Math.max(0, Number(installed.storage?.pricing?.longDiscountPercent || 0))
    state.v3LongDiscountMinimumPricePercent = Math.max(1, Math.min(100, Number(installed.storage?.pricing?.longDiscountMinimumPricePercent || 50)))
    state.v3LongDiscountEnabled = installed.storage?.pricing?.longDiscountEnabled ?? state.v3LongDiscountPercent > 0
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

function ensureV3SurfaceData() {
  void loadV3ActivitySessions(state.workOrderSide)
  if (state.workOrderSide === 'buyer' && !state.v3CatalogLoading && !state.v3CatalogLoaded && !state.v3CatalogError) void loadV3Catalog()
  if (state.workOrderSide === 'seller' && !state.v3ListingsLoading && !state.v3ListingsLoaded && !state.v3SellerError) void loadV3Listings()
}

function v3ActivityUsageLabel(key: string) {
  const labels: Record<string, string> = {
    request: 'Requests', successful_request: 'Successful', input_bytes: 'Input', output_bytes: 'Output',
    execution_second: 'Execution', input_tokens: 'Input tokens', output_tokens: 'Output tokens',
    duration_minutes: 'Reserved time', transfer_bytes: 'Transferred', downloads: 'Downloads',
  }
  return labels[key] || key.replaceAll('_', ' ')
}

function v3ActivityUsageValue(key: string, value: number) {
  if (key.endsWith('_bytes') || key === 'transfer_bytes') return v3FormatBytes(value)
  if (key === 'execution_second') return value >= 60 ? `${(value / 60).toFixed(1)} min` : `${value} sec`
  if (key === 'duration_minutes') return `${value} min`
  return new Intl.NumberFormat().format(value)
}

function renderV3ActivityDelivery(detail: V3ActivityDetail) {
  const operations = detail.operations || []
  if (detail.productKind === 'api_operation') {
    return `
      <section class="v3-activity-panel v3-activity-delivery">
        <header><span>DELIVERY & USAGE</span><h3>API session</h3></header>
        <p>${escapeHTML(detail.outcome || 'Invocation activity recorded by Exora Gateway.')}</p>
        <div class="v3-activity-operation-list">${operations.length ? operations.map((item) => `<span>${escapeHTML(item)}</span>`).join('') : '<span>No operation metadata</span>'}</div>
      </section>
    `
  }
  if (detail.productKind === 'compute') {
    return `
      <section class="v3-activity-panel v3-activity-delivery">
        <header><span>DELIVERY & USAGE</span><h3>Exclusive compute lease</h3></header>
        <p>Reserved minutes, Guest access, artifacts and Reset receipt stay attached to this Lease session.</p>
      </section>
    `
  }
  return `
    <section class="v3-activity-panel v3-activity-delivery">
      <header><span>DELIVERY & USAGE</span><h3>Download grant</h3></header>
      <p>Grant validity, transfer attempts and SHA-256 verification stay attached to this resource session.</p>
    </section>
  `
}

function renderV3ActivityDetail() {
  if (state.v3ActivityDetailError) {
    return `<section class="v3-activity-loading error"><span>History detail unavailable</span><p>${escapeHTML(state.v3ActivityDetailError)}</p><div><button class="ghost" type="button" data-v3-action="activity-back">Back</button><button type="button" data-v3-action="activity-refresh">Try again</button></div></section>`
  }
  const detail = state.v3ActivityDetail
  if (!detail || state.v3ActivityDetailLoading) {
    return `<section class="v3-activity-loading"><span class="v3-history-spinner"></span><strong>Loading order detail</strong><p>Reading the authoritative V3 session, usage and ledger projection.</p></section>`
  }
  const usage = Object.entries(detail.usage || {}).filter(([, value]) => Number(value) !== 0)
  const invocations = detail.invocations || []
  const events = detail.events || []
  const identifiers = Object.entries(detail.identifiers || {}).filter(([, value]) => Boolean(value))
  const roleAmountLabel = detail.role === 'seller' ? 'Net revenue' : 'Paid'
  const productDescription = String(detail.product?.description || '')
  const updated = detail.updatedAt ? compactTimestamp(detail.updatedAt) : '—'
  return `
    <section class="v3-activity-detail" data-v3-activity-detail>
      <nav class="v3-activity-nav">
        <button class="ghost" type="button" data-v3-action="activity-back">${toolbarIcons.back}<span>Back to ${detail.role === 'seller' ? 'seller' : 'buyer'} workspace</span></button>
        <button class="ghost" type="button" data-v3-action="activity-refresh">${toolbarIcons.refresh}<span>Refresh</span></button>
      </nav>
      <header class="v3-activity-hero">
        <div class="v3-activity-hero-mark kind-${escapeAttr(detail.productKind)}">${v3ActivityKindLabel(detail.productKind)}</div>
        <div>
          <span>${escapeHTML(detail.productKind.replaceAll('_', ' '))} · ${escapeHTML(detail.role)}</span>
          <h2>${escapeHTML(detail.productTitle || 'Resource session')}</h2>
          <p>${escapeHTML(detail.outcome || 'Authoritative V3 activity session.')} · ${escapeHTML(detail.counterpartyLabel || 'Counterparty')}</p>
        </div>
        <em class="v3-activity-state ${escapeAttr(detail.status)}"><i></i>${escapeHTML(v3ActivityStatusLabel(detail.status))}</em>
      </header>
      ${detail.attentionRequired ? `<div class="v3-activity-attention"><strong>Review required</strong><span>One or more operations failed or could not be metered. No history was rewritten; the original evidence remains below.</span></div>` : ''}
      <section class="v3-activity-summary">
        <div class="v3-activity-total"><span>${roleAmountLabel}</span><strong>${escapeHTML(v3AtomicMoney(detail.amountAtomic, detail.asset))}</strong><small>${detail.role === 'seller' ? 'After platform fee' : 'Across this resource session'}</small></div>
        <dl>
          <div><dt>Status</dt><dd>${escapeHTML(v3ActivityStatusLabel(detail.status))}</dd></div>
          <div><dt>Activity</dt><dd>${detail.itemCount} ${detail.productKind === 'api_operation' ? 'calls' : 'records'}</dd></div>
          <div><dt>Counterparty</dt><dd>${escapeHTML(detail.counterpartyLabel || '—')}</dd></div>
          <div><dt>Last update</dt><dd>${escapeHTML(updated)}</dd></div>
        </dl>
      </section>
      <div class="v3-activity-grid">
        <div class="v3-activity-main-column">
          ${renderV3ActivityDelivery(detail)}
          <section class="v3-activity-panel">
            <header><span>MEASURED FACTS</span><h3>Usage</h3></header>
            ${usage.length ? `<div class="v3-activity-usage">${usage.map(([key, value]) => `<div><span>${escapeHTML(v3ActivityUsageLabel(key))}</span><strong>${escapeHTML(v3ActivityUsageValue(key, Number(value)))}</strong></div>`).join('')}</div>` : '<p class="v3-activity-empty">No metered usage has been attached to this session.</p>'}
          </section>
          <section class="v3-activity-panel">
            <header><span>SESSION ACTIVITY</span><h3>${detail.productKind === 'api_operation' ? 'Invocations' : 'Events'}</h3></header>
            ${invocations.length ? `<div class="v3-activity-invocations">${invocations.map((item) => `<article><span class="v3-activity-event-dot ${escapeAttr(item.status)}"></span><div><strong>${escapeHTML(item.operationId || 'API invocation')}</strong><small>${escapeHTML(compactTimestamp(item.completedAt || item.startedAt))} · ${escapeHTML(item.invocationId)}</small></div><em>${escapeHTML(v3AtomicMoney(item.chargedAtomic, detail.asset))}</em><b>${escapeHTML(item.status.replaceAll('_', ' '))}</b></article>`).join('')}</div>` : events.length ? `<div class="v3-activity-events">${events.map((event) => `<article><span class="v3-activity-event-dot ${escapeAttr(event.status)}"></span><div><strong>${escapeHTML(event.title)}</strong><small>${escapeHTML(event.detail)}</small></div><time>${escapeHTML(compactTimestamp(event.occurredAt))}</time></article>`).join('')}</div>` : '<p class="v3-activity-empty">No activity events have been recorded yet.</p>'}
          </section>
        </div>
        <aside class="v3-activity-side-column">
          <section class="v3-activity-panel v3-activity-money">
            <header><span>MONEY</span><h3>Ledger summary</h3></header>
            <dl>
              <div><dt>Gross charge</dt><dd>${escapeHTML(v3AtomicMoney(detail.grossAmountAtomic, detail.asset))}</dd></div>
              <div><dt>Platform fee</dt><dd>${escapeHTML(v3AtomicMoney(detail.platformFeeAtomic, detail.asset))}</dd></div>
              <div class="total"><dt>${roleAmountLabel}</dt><dd>${escapeHTML(v3AtomicMoney(detail.amountAtomic, detail.asset))}</dd></div>
            </dl>
            <p>Refunds and corrections appear as new reversing entries; prior history is never edited.</p>
          </section>
          <section class="v3-activity-panel v3-activity-product">
            <header><span>PRODUCT SNAPSHOT</span><h3>Purchased resource</h3></header>
            <strong>${escapeHTML(detail.productTitle)}</strong>
            ${productDescription ? `<p>${escapeHTML(productDescription)}</p>` : ''}
            <div><span>Version</span><b>${escapeHTML(String(detail.product?.version || '—'))}</b></div>
          </section>
          <section class="v3-activity-panel v3-activity-identifiers">
            <header><span>AUDIT REFERENCES</span><h3>Identifiers</h3></header>
            ${identifiers.map(([label, value]) => `<button type="button" data-copy-v3-identifier="${escapeAttr(value)}"><span>${escapeHTML(label.replace(/([A-Z])/g, ' $1'))}</span><code>${escapeHTML(value)}</code>${toolbarIcons.copy}</button>`).join('')}
          </section>
        </aside>
      </div>
    </section>
  `
}

function renderV3BuyerSurface() {
  if (state.v3SelectedProduct) {
    const product = state.v3SelectedProduct
    return `<section class="v3-market-surface v3-product-detail">
      <button class="ghost v3-back-button" type="button" data-v3-action="catalog-back">${toolbarIcons.back}<span>Back to products</span></button>
      <header class="v3-product-hero"><span>${escapeHTML(product.productKind)}</span><h2>${escapeHTML(product.title)}</h2><p>${escapeHTML(product.description || 'Machine-readable Exora product.')}</p></header>
      <div class="v3-detail-grid"><section class="v3-console-panel"><div class="section-title"><strong>AgentProductManifest</strong><span>v${product.version || 1}</span></div><pre>${escapeHTML(JSON.stringify(product.manifest || {}, null, 2))}</pre></section>
      <aside class="v3-console-panel"><dl class="detail-grid"><div><dt>Status</dt><dd>${escapeHTML(product.status)}</dd></div><div><dt>Provider</dt><dd>${escapeHTML(product.providerDockId || 'Exora')}</dd></div><div><dt>Delivery</dt><dd>${escapeHTML(product.productKind)}</dd></div></dl><button type="button" disabled>Agent purchase coming next</button><p class="muted">This release supports discovery and structured preview only.</p></aside></div>
    </section>`
  }
  const cards = state.v3Products.map((product, index) => {
    const metrics = v3ProductMetrics(product)
    const chips = v3ProductChips(product)
    return `<article class="agent-card market-rail-card v3-product-card tone-${marketRailTone(index)}" data-v3-product="${escapeAttr(product.productId)}" role="button" tabindex="0" aria-label="Open ${escapeAttr(product.title)}">
      <div class="market-card-topline"><span class="market-stage-pill">${escapeHTML(product.productKind.replace('_', ' '))}</span><div class="market-card-icon-actions"><button type="button" class="market-icon-action" data-v3-product="${escapeAttr(product.productId)}" aria-label="View ${escapeAttr(product.title)}">${toolbarIcons.disclosure}</button></div></div>
      <div class="market-card-titleblock"><span>${escapeHTML(product.status)}</span><h3>${escapeHTML(product.title)}</h3><small>${escapeHTML(product.providerDockId || 'Exora provider')}</small></div>
      <p class="market-rail-summary">${escapeHTML(product.description || 'Machine-readable product ready for an AI Agent.')}</p>
      <div class="market-metric-row">${metrics.map(renderMarketMetric).join('')}</div>
      <div class="chip-row market-rail-chips">${chips.map((chip) => `<span>${escapeHTML(chip)}</span>`).join('')}</div>
      <div class="market-card-footer"><span>${escapeHTML(product.productKind === 'compute' ? 'Exclusive disposable environment' : product.productKind === 'download' ? 'Licensed versioned delivery' : 'Normalized operation manifest')}</span><strong>${toolbarIcons.disclosure}</strong></div>
    </article>`
  }).join('')
  return `<section class="v3-market-surface">
    <div class="v3-surface-heading"><div><span>AI-FIRST MARKET</span><h2>Agent-ready products</h2><p>Compute minutes, licensed resources, and normalized OpenAPI operations.</p></div><button class="ghost" type="button" data-v3-action="catalog-refresh">${toolbarIcons.refresh}<span>Refresh</span></button></div>
    <form class="card-market-form v3-catalog-search" data-v3-catalog-search><input name="query" value="${escapeAttr(state.v3CatalogQuery)}" placeholder="Search compute, downloads, or API operations"/><button class="card-market-search-button" type="submit">${toolbarIcons.search}</button></form>
    ${state.v3CatalogError ? `<div class="v3-error">${escapeHTML(state.v3CatalogError)}</div>` : ''}
    ${state.v3CatalogLoading ? '<div class="market-rail-empty"><strong>Loading V3 catalog</strong><span>Reading published and currently available listings.</span></div>' : cards ? `<div class="market-rail-grid v3-product-grid">${cards}</div>` : '<div class="market-rail-empty"><strong>No available products</strong><span>Validated provider listings will appear here.</span></div>'}
  </section>`
}

function renderV3SellerTabs() {
  const applicationCount = state.v3ListingApplications.filter(({ listing }) => ['draft', 'unhealthy', 'provider_busy', 'capacity_insufficient'].includes(listing.status)).length
  const tabs: Array<[V3SellerTab, string, IconNode]> = [
    ['vm', 'VM', Activity],
    ['resources', 'Resources', Folder],
    ['endpoint', 'Endpoint', BrainCircuit],
    ['api_bridge', 'API Bridge', Network],
    ['listings', 'Listings', SquareKanban],
  ]
  const activeIndex = Math.max(0, tabs.findIndex(([id]) => state.v3SellerTab === id))
  return `<nav class="v3-seller-tabs" role="tablist" aria-label="Seller workbench" style="--v3-seller-active-offset: ${activeIndex * 144}px">
    <span class="v3-seller-active-bar" aria-hidden="true"></span>
    ${tabs.map(([id, label, tabIcon]) => `<button type="button" role="tab" aria-selected="${state.v3SellerTab === id}" data-v3-seller-tab="${id}" class="${state.v3SellerTab === id ? 'active' : ''}">${icon(tabIcon)}<span>${label}${id === 'listings' && applicationCount ? `<em class="v3-tab-count">${applicationCount}</em>` : ''}</span></button>`).join('')}
  </nav>`
}

function syncV3SellerTabs() {
  if (!fields.sellerSurfaceTabs.querySelector('.v3-seller-tabs')) {
    fields.sellerSurfaceTabs.innerHTML = renderV3SellerTabs()
  }
  const tabs = Array.from(fields.sellerSurfaceTabs.querySelectorAll<HTMLButtonElement>('[data-v3-seller-tab]'))
  const activeIndex = Math.max(0, tabs.findIndex((button) => button.dataset.v3SellerTab === state.v3SellerTab))
  fields.sellerSurfaceTabs.querySelector<HTMLElement>('.v3-seller-tabs')?.style.setProperty('--v3-seller-active-offset', `${activeIndex * 144}px`)
  tabs.forEach((button) => {
    const active = button.dataset.v3SellerTab === state.v3SellerTab
    button.classList.toggle('active', active)
    button.setAttribute('aria-selected', String(active))
  })

  const listingsLabel = fields.sellerSurfaceTabs.querySelector<HTMLElement>('[data-v3-seller-tab="listings"] > span')
  const applicationCount = state.v3ListingApplications.filter(({ listing }) => ['draft', 'unhealthy', 'provider_busy', 'capacity_insufficient'].includes(listing.status)).length
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

function renderV3EnvironmentSaveControls() {
  const selectedImage = state.v3EnvironmentImages.find((item) => item.imageId === state.v3SelectedEnvironmentImageId)
  const imageSizeBytes = Number(selectedImage?.manifest?.artifact?.sizeBytes || 0)
  const maximumWorkspaceGiB = Math.floor((state.v3EnvironmentRootFreeBytes - 10 * 1024 ** 3 - imageSizeBytes) / 1024 ** 3)
  const capacityAllowed = maximumWorkspaceGiB >= 20 && state.v3EnvironmentWorkspaceGiB <= maximumWorkspaceGiB
  const savePhase = state.v3ImageProgress?.phase || 'saving'
  const saveLabel = state.v3EnvironmentSaving ? ({ reserving: 'Reserving space…', starting: 'Starting download…', downloading: 'Downloading…', verifying: 'Verifying…', importing: 'Installing…', validating: 'Validating…', saving: 'Saving…' } as Record<string, string>)[savePhase] || 'Preparing…' : 'Save'
  return `<div class="v3-environment-save-bar"><button type="button" data-v3-action="environment-save" ${selectedImage && state.v3EnvironmentRoot && capacityAllowed && !state.v3EnvironmentSaving ? '' : 'disabled'}>${escapeHTML(saveLabel)}</button></div>`
}

function renderV3EnvironmentCloudLauncher() {
  const installed = state.v3InstalledEnvironments.filter((item) => item.attestation?.status === 'ready').length
  const selectedImage = state.v3EnvironmentImages.find((item) => item.imageId === state.v3SelectedEnvironmentImageId)
  const selectedInstalled = selectedImage && state.v3InstalledEnvironments.some((item) => item.attestation?.imageId === selectedImage.imageId && item.attestation?.status === 'ready')
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
  return `<div class="v3-environment-configurator"><div class="v3-environment-setup-grid"><section class="v3-environment-cloud-launcher"><header><span class="v3-cloud-mark">☁</span><div><strong>Exora Environment Cloud</strong><small>Official images download to Exora's managed cache</small></div><em>${installed ? `${installed} installed` : '2 official packages'}</em></header><button class="v3-cloud-selection-bar" type="button" data-v3-action="environment-cloud-open"><strong>${escapeHTML(selectedName)}${selectedInstalled ? ' · installed' : ''}</strong><em>${selectedImage ? 'Change' : 'Choose'} →</em></button></section><section class="v3-environment-storage ${allocationAvailable ? '' : 'capacity-blocked'}"><header><span class="v3-storage-mark">▰</span><div><strong>Virtual environment storage</strong><small>${escapeHTML(capacityText)}</small></div><span class="v3-storage-size-input"><input data-environment-workspace type="number" min="20" max="${Math.max(20, maxGiB)}" step="1" value="${workspaceGiB}" inputmode="numeric" aria-label="Virtual disk allocation in GiB" ${allocationAvailable ? '' : 'disabled'}/><em>GiB</em></span></header><button class="v3-storage-path" type="button" data-v3-action="environment-root-choose"><span>${escapeHTML(state.v3EnvironmentRoot || 'Choose a root folder')}${state.v3EnvironmentRoot && selectedImage && !allocationAvailable ? ' · insufficient capacity' : ''}</span><em>${state.v3EnvironmentRoot ? 'Change' : 'Browse'} →</em></button></section></div></div>`
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
    const action = `<button type="button" data-v3-image-pick="${escapeAttr(image.imageId)}" ${compatible ? '' : 'disabled'}>${compatible ? selected ? 'Selected' : 'Select configuration' : 'NVIDIA GPU required'}</button>`
    return `<article class="v3-cloud-image-card ${needsGPU ? 'gpu' : 'cpu'} ${state.v3SelectedEnvironmentImageId === image.imageId ? 'selected' : ''}" data-v3-image-select="${escapeAttr(image.imageId)}" tabindex="0"><header><span>${needsGPU ? 'CUDA' : 'LINUX'}</span><em>${image.cloudAvailable === false ? 'Cloud preview' : 'Official · signed'}</em></header><div class="v3-cloud-image-symbol">${needsGPU ? 'Cu' : 'U'}</div><h3>${escapeHTML(String(manifest.name || image.imageId))}</h3><p>${escapeHTML(String(manifest.description || 'Official Exora environment'))}</p><div class="v3-cloud-image-facts"><span><small>System</small><strong>${escapeHTML(`${manifest.os?.distribution || 'Ubuntu'} ${manifest.os?.version || '24.04'}`)}</strong></span><span><small>Download</small><strong>${v3FormatBytes(Number(manifest.artifact?.sizeBytes || 0))}</strong></span><span><small>Backend</small><strong>WSL2 · amd64</strong></span><span><small>Acceleration</small><strong>${needsGPU ? `NVIDIA · CUDA ${escapeHTML(String(manifest.gpu?.cudaVersion || '12.8'))}` : 'CPU'}</strong></span></div><div class="v3-cloud-components">${components.map((item: string) => `<span>${escapeHTML(item)}</span>`).join('')}</div>${action}</article>`
  }).join('')
  return `<div class="v3-environment-cloud" role="dialog" aria-modal="true" aria-labelledby="v3-environment-cloud-title"><button class="v3-environment-cloud-scrim" type="button" data-v3-action="environment-cloud-close" aria-label="Close environment cloud"></button><section class="v3-environment-cloud-panel"><header class="v3-environment-cloud-head"><div><span>EXORA CLOUD</span><h2 id="v3-environment-cloud-title">Environment library</h2><p>Copy a complete, signed system package from Exora Cloud into this PC. Exora downloads, verifies, imports and validates it automatically.</p></div><button class="ghost" type="button" data-v3-action="environment-cloud-close" aria-label="Close">×</button></header><nav class="v3-environment-cloud-filters"><button class="${state.v3EnvironmentCloudFilter === 'all' ? 'active' : ''}" type="button" data-v3-environment-filter="all">All environments <em>2</em></button><button class="${state.v3EnvironmentCloudFilter === 'ubuntu' ? 'active' : ''}" type="button" data-v3-environment-filter="ubuntu">Ubuntu</button><button class="${state.v3EnvironmentCloudFilter === 'cuda' ? 'active' : ''}" type="button" data-v3-environment-filter="cuda">CUDA</button><span>WSL2 · Windows x64</span></nav><div class="v3-environment-cloud-grid">${cards}</div><footer><span>More systems and framework stacks will be added through the signed cloud catalog.</span><strong>Version 1 · Ubuntu + CUDA</strong></footer></section></div>`
}

function renderV3WindowsPricing(recommendedPrice: string) {
  if (!(state.v3PricePerMinute > 0)) state.v3PricePerMinute = Math.max(0.001, Number(recommendedPrice || 0.01))
  return `<div class="v3-pricing-inline"><div class="v3-inline-base-fee ${state.v3BaseFeeEnabled ? 'enabled' : 'disabled'}" role="group" aria-label="Base fee settings"><span class="v3-price-field-title"><i>1</i><strong>Base fee</strong><button class="v3-discount-toggle" type="button" role="switch" aria-checked="${state.v3BaseFeeEnabled}" data-v3-action="base-fee-toggle"><span></span><em>${state.v3BaseFeeEnabled ? 'On' : 'Off'}</em></button></span><span class="v3-inline-price-input"><b>$</b><input aria-label="Base fee per lease" data-v3-pricing="baseFee" type="number" min="0" step="0.01" value="${state.v3BaseFee || ''}" placeholder="0.00" inputmode="decimal" ${state.v3BaseFeeEnabled ? '' : 'disabled'}/><em>per lease</em></span></div><label><span class="v3-price-field-title"><i>2</i><strong>Minute price</strong></span><span class="v3-inline-price-input"><b>$</b><input aria-label="Price per minute" data-v3-pricing="pricePerMinute" type="number" min="0.001" step="0.001" value="${state.v3PricePerMinute}" inputmode="decimal" required/><em>per min</em></span></label><label><span class="v3-price-field-title"><i>3</i><strong>Minimum</strong></span><span class="v3-inline-price-input"><input aria-label="Minimum rental minutes" data-v3-pricing="minimumMinutes" type="number" min="1" step="1" value="${state.v3MinimumMinutes}" inputmode="numeric" required/><em>minutes</em></span></label><div class="v3-inline-discount ${state.v3LongDiscountEnabled ? 'enabled' : 'disabled'}" role="group" aria-label="Tiered discount settings"><span class="v3-price-field-title"><i>4</i><strong>Every interval adds a discount until the price floor</strong><button class="v3-discount-toggle" type="button" role="switch" aria-checked="${state.v3LongDiscountEnabled}" data-v3-action="discount-toggle"><span></span><em>${state.v3LongDiscountEnabled ? 'On' : 'Off'}</em></button></span><span class="v3-inline-discount-inputs"><span class="v3-inline-price-input" title="Apply another discount step after every interval"><input aria-label="Discount interval in minutes" data-v3-pricing="longDiscountAfterMinutes" type="number" min="1" step="1" value="${state.v3LongDiscountAfterMinutes}" inputmode="numeric" ${state.v3LongDiscountEnabled ? '' : 'disabled'}/><em>min each</em></span><span class="v3-inline-price-input" title="Additional percentage off at each interval"><input aria-label="Additional discount percentage per interval" data-v3-pricing="longDiscountPercent" type="number" min="1" max="90" step="1" value="${state.v3LongDiscountPercent || ''}" placeholder="5" inputmode="decimal" ${state.v3LongDiscountEnabled ? '' : 'disabled'}/><em>% each</em></span><span class="v3-inline-price-input" title="Never charge less than this percentage of the normal minute price"><input aria-label="Minimum payable percentage of normal price" data-v3-pricing="longDiscountMinimumPricePercent" type="number" min="1" max="100" step="1" value="${state.v3LongDiscountMinimumPricePercent}" inputmode="decimal" ${state.v3LongDiscountEnabled ? '' : 'disabled'}/><em>% floor</em></span></span></div></div><input type="hidden" name="workspaceGiB" value="${state.v3EnvironmentWorkspaceGiB}"/><input type="hidden" name="price" value="${state.v3PricePerMinute}"/>`
}

function renderV3VMPage() {
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
    const maxWorkspace = Math.max(20, Math.min(2000, freeDiskGiB - 20 || 500))
    const recommendedPrice = Math.max(0.01, 0.008 + Number(gpu.memoryMiB || 0) / 1024 * 0.0015 + Number(hardware.Cores || 0) * 0.00035 + memoryGiB * 0.00012 + (selectedImage?.manifest?.gpu?.required ? 0.008 : 0) + (Number(network.downloadMbps || 0) > 500 ? 0.003 : 0)).toFixed(3)
    const images = renderV3EnvironmentCloudLauncher()
    const environmentReady = Boolean(probe && selectedInstalled && state.v3VMTemplate?.valid)
    const step1: V3WizardStepState = state.v3HostScanning ? 'busy' : probe ? 'complete' : 'available'
    const step2: V3WizardStepState = !probe ? 'locked' : state.v3EnvironmentSaving ? 'busy' : environmentReady ? 'complete' : 'available'
    const step3: V3WizardStepState = !environmentReady ? 'locked' : 'available'
    return `<div class="v3-vm-onboarding v3-application-flow"><section class="v3-console-panel v3-host-scan ${v3WizardStepClass(step1)}"><div class="v3-step-heading"><span>1</span><div><strong>Scan this PC</strong><small>Hardware, available capacity, network speed and public location</small></div><button class="ghost" type="button" data-v3-action="vm-probe" ${state.v3HostScanning ? 'disabled' : ''}>${state.v3HostScanning ? 'Scanning…' : probe ? 'Scan again' : 'Scan hardware'}</button></div>${probe ? `<div class="v3-host-facts"><span><small>Processor</small><strong>${escapeHTML(String(hardware.Cpu || 'Unknown CPU'))}</strong><em>${Number(hardware.Cores || 0)} cores · ${Number(hardware.LogicalProcessors || 0)} threads</em></span><span><small>Memory</small><strong>${memoryGiB.toFixed(0)} GiB</strong><em>${(Number(hardware.FreeMemoryBytes || 0) / 1024 ** 3).toFixed(0)} GiB currently free</em></span><span><small>GPU</small><strong>${escapeHTML(String(gpu.name || 'No NVIDIA GPU detected'))}</strong><em>${gpu.memoryMiB ? `${(Number(gpu.memoryMiB) / 1024).toFixed(0)} GiB VRAM · driver ${escapeHTML(String(gpu.driverVersion || ''))}` : 'CPU environments available'}</em></span><span><small>Storage</small><strong>${freeDiskGiB} GiB free</strong><em>Fixed reservation before listing</em></span><span><small>Network</small><strong>↓ ${Number(network.downloadMbps || 0)} · ↑ ${Number(network.uploadMbps || 0)} Mbps</strong><em>${Number(network.latencyMs || 0)} ms to Exora Cloud</em></span><span><small>Public location</small><strong>${escapeHTML([network.city, network.region, network.country].filter(Boolean).join(', ') || 'Location unavailable')}</strong><em>${escapeHTML(String(network.publicIp || 'IP unavailable'))}</em></span></div>` : '<div class="v3-scan-empty"><strong>Know exactly what can be listed</strong><span>Exora reads capacity locally and measures the route to Exora Cloud. No hardware names need to be entered manually.</span></div>'}</section>
      <section class="v3-console-panel ${v3WizardStepClass(step2)}" ${step2 === 'locked' ? 'inert aria-disabled="true"' : ''}><div class="v3-step-heading v3-environment-step-heading"><span>2</span><div><strong>Choose an environment</strong><small>${step2 === 'locked' ? 'Complete Step 1 to choose storage and a signed environment' : 'Install and validate a signed, disposable Linux package'}</small></div>${renderV3EnvironmentSaveControls()}</div><div class="v3-environment-list">${images || (state.v3EnvironmentCatalogOffline ? '<div class="v3-scan-empty"><strong>Connect Exora Cloud to load environments</strong><span>The local hardware scan remains available, but signed Ubuntu and CUDA packages require a linked Dock account.</span></div>' : '<p class="empty-copy">Scan this PC to load compatible environments.</p>')}</div></section>
      <form class="v3-console-panel v3-provider-form ${v3WizardStepClass(step3)}" data-v3-form="vm" ${step3 === 'locked' ? 'inert aria-disabled="true"' : ''}><div class="v3-step-heading"><span>3</span><div><strong>Price and submit</strong><small>${step3 === 'locked' ? 'Complete Step 2 to configure pricing' : 'Creates a private Listing draft; publication happens only in Listings'}</small></div><button type="submit" class="v3-direct-publish" ${environmentReady ? '' : 'disabled'}>Submit to Listings</button></div>${renderV3WindowsPricing(recommendedPrice)}<p class="v3-listing-note">Submission saves a private draft and does not publish it.</p></form></div>`
  }
  const domains = state.v3VMDomains.map((domain) => `<label class="v3-domain-row"><input type="radio" name="domain" value="${escapeAttr(domain.name)}" ${domain.eligible ? '' : 'disabled'}/><span><strong>${escapeHTML(domain.name)}</strong><small>${escapeHTML(domain.state)}</small></span></label>`).join('')
  const linuxTemplateReady = Boolean(state.v3VMTemplate?.valid)
  return `<div class="v3-seller-grid v3-vm-onboarding"><section class="v3-console-panel ${v3WizardStepClass(probe ? 'complete' : 'available')}"><div class="v3-step-heading"><span>1</span><div><strong>Scan Linux KVM host</strong><small>Choose an eligible powered-off domain after the hardware scan.</small></div><button class="ghost" type="button" data-v3-action="vm-probe">${probe ? 'Scan again' : 'Scan host'}</button></div>${probe ? `<div class="v3-metric-grid"><span><small>KVM</small><strong>${escapeHTML(probe.kvm)}</strong></span><span><small>IOMMU</small><strong>${escapeHTML(probe.iommu)}</strong></span><span><small>GPUs</small><strong>${Array.isArray(probe.gpus) ? probe.gpus.length : 0}</strong></span><span><small>OS</small><strong>${escapeHTML(probe.os)}</strong></span></div>` : '<p class="empty-copy">Scan a Linux provider host. Windows and macOS return unsupported_host.</p>'}<div class="v3-domain-list">${domains}</div></section>
    <form class="v3-application-flow v3-provider-form" data-v3-form="vm"><section class="v3-console-panel ${v3WizardStepClass(!probe ? 'locked' : linuxTemplateReady ? 'complete' : 'available')}" ${probe ? '' : 'inert aria-disabled="true"'}><div class="v3-step-heading"><span>2</span><div><strong>Import and validate Golden Image</strong><small>${probe ? 'Import the selected domain, then validate its disposable runtime.' : 'Complete Step 1 to import a Golden Image.'}</small></div></div><div class="v3-form-actions"><button type="button" class="ghost" data-v3-action="vm-import" ${probe ? '' : 'disabled'}>Import</button><button type="button" data-v3-action="vm-validate" ${state.v3VMTemplate ? '' : 'disabled'}>Run validation</button></div>${state.v3VMTemplate ? `<pre>${escapeHTML(JSON.stringify(state.v3VMTemplate, null, 2))}</pre>` : '<p class="empty-copy">No Golden Image has been imported.</p>'}</section><section class="v3-console-panel ${v3WizardStepClass(linuxTemplateReady ? 'available' : 'locked')}" ${linuxTemplateReady ? '' : 'inert aria-disabled="true"'}><div class="v3-step-heading"><span>3</span><div><strong>Capacity, price and submit</strong><small>${linuxTemplateReady ? 'Creates a private Listing draft; publication happens only in Listings.' : 'Complete image validation to configure the offer.'}</small></div><button type="submit" class="v3-direct-publish" ${linuxTemplateReady ? '' : 'disabled'}>Submit to Listings</button></div><label>Title<input name="title" required placeholder="H100 CUDA environment"/></label><label>Text description<textarea name="description" required></textarea></label><div class="v3-form-grid"><label>Price / minute<input name="price" type="number" min="0.001" step="0.001" required/></label><label>Currency<input name="currency" value="USD"/></label><label>Minimum minutes<input name="minMinutes" type="number" min="1" value="1"/></label><label>Maximum minutes<input name="maxMinutes" type="number" min="1" value="240"/></label><label>Workspace GiB<input name="workspaceGiB" type="number" min="1" value="100"/></label><label>Region<input name="region" placeholder="ap-east"/></label></div></section></form></div>`
}

const v3ResourceSelectOptions: Record<V3ResourceSelectName, Array<{ value: string; label: string }>> = {
  license: [
    { value: 'commercial', label: 'Commercial use' },
    { value: 'research', label: 'Research only' },
    { value: 'personal', label: 'Personal use' },
    { value: 'custom', label: 'Custom terms' },
  ],
  delivery: [
    { value: 'downloadable', label: 'Direct download' },
    { value: 'environment_only', label: 'Environment only' },
    { value: 'downloadable_and_environment', label: 'Download + environment' },
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
  const archive = state.v3ResourceArchive
  const progress = state.v3AssetProgress
  const packaging = progress?.phase === 'selecting' || progress?.phase === 'packaging'
  const uploading = archive?.status === 'uploading'
  const busy = packaging || uploading || state.v3ResourceSubmitting
  const archiveReady = Boolean(archive && !packaging && archive.status !== 'failed')
  const detailsReady = Boolean(state.v3ResourceTitle.trim() && state.v3ResourceDescription.trim() && state.v3ResourceVersion.trim())
  const commerceReady = state.v3ResourceGrantHours >= 1 && state.v3ResourceGrantHours <= 720 && state.v3ResourcePrice > 0
  const step1: V3WizardStepState = packaging ? 'busy' : archiveReady ? 'complete' : archive?.status === 'failed' ? 'error' : 'available'
  const step2: V3WizardStepState = !archiveReady ? 'locked' : detailsReady ? 'complete' : 'available'
  const step3: V3WizardStepState = !detailsReady ? 'locked' : state.v3ResourceSubmitting || uploading ? 'busy' : 'available'
  const canSubmit = archiveReady && detailsReady && commerceReady && !busy
  const fileRows = state.v3ResourceSources.map((file) => renderV3SharedFileRow(file, '<span class="v3-resource-file-status included"><i></i>Included</span>')).join('')
  const pickerTitle = packaging ? 'Creating your ZIP package…' : archive ? 'Replace source files' : 'Choose files from this computer'
  const pickerDetails = archive ? ['A new successful selection replaces the current ZIP', 'Original files stay local and are never uploaded separately'] : ['Any file type · Dock creates one immutable ZIP', 'Original files stay local and are never uploaded separately']
  const pickerStatus = archive ? `${archive.sourceCount} selected` : packaging ? `${progress?.percent || 0}%` : 'Browse files'
  const archivePanel = packaging
    ? `<div class="v3-resource-packaging"><span class="v3-resource-spinner"></span><div><strong>${progress?.phase === 'selecting' ? 'Choose source files' : `Creating the ZIP · ${progress?.percent || 0}%`}</strong><small>${progress?.phase === 'selecting' ? 'Dock is waiting for your selection.' : `${progress?.completedFiles || 0} of ${progress?.totalFiles || 0} files · ${v3FormatBytes(progress?.outputBytes || 0)}`}</small></div><span class="v3-resource-progress"><i style="width:${Math.max(0, Math.min(100, progress?.percent || 0))}%"></i></span></div>`
    : archive ? `<div class="v3-resource-archive-card ${escapeAttr(archive.status || 'ready')}"><span class="v3-resource-zip-mark">ZIP</span><div><strong>${escapeHTML(archive.name)}</strong><small>${archive.sourceCount} source file${archive.sourceCount === 1 ? '' : 's'} · ${v3FormatBytes(archive.sizeBytes)}</small></div><em><i></i>${archive.status === 'uploading' ? `Uploading ${progress?.percent || 0}%` : archive.status === 'failed' ? 'Retry needed' : 'Ready'}</em></div>` : ''
  const submitLabel = uploading ? `Uploading ${progress?.percent || 0}%` : state.v3ResourceSubmitting ? 'Submitting…' : 'Submit to Listings'
  return `<form class="v3-application-flow v3-provider-form" data-v3-form="resources">
    <section class="v3-console-panel ${v3WizardStepClass(step1)}"><div class="v3-step-heading"><span>1</span><div><strong>Choose source files</strong><small>${step1 === 'busy' ? 'Dock is preparing one immutable ZIP' : 'Dock compresses every selection into one ZIP; maximum package size is 1 GiB'}</small></div>${archive ? `<button class="danger ghost" type="button" data-v3-action="resource-clear-files" ${busy ? 'disabled' : ''}>Clear</button>` : ''}</div><fieldset class="v3-wizard-step-content" ${busy ? 'disabled' : ''}>${renderV3SharedFilePicker('choose-files', pickerTitle, pickerDetails, pickerStatus, busy)}${archivePanel}<div class="v3-shared-file-list">${fileRows || renderV3SharedFileEmpty('No files selected', 'Choose one or more files to unlock Step 2.')}</div><div class="v3-resource-safety-strip"><span><strong>Single ZIP only</strong><small>Original files never upload separately</small></span><span><strong>1 GiB hard limit</strong><small>Oversized output stops during compression</small></span><span><strong>Immutable version</strong><small>Updates create a new bundle version</small></span></div></fieldset></section>
    <section class="v3-console-panel ${v3WizardStepClass(step2)}"><div class="v3-step-heading"><span>2</span><div><strong>Describe the bundle</strong><small>${step2 === 'locked' ? 'Complete Step 1 to edit product details' : 'Give Agents enough structured context to select the correct fixed version'}</small></div></div><fieldset class="v3-wizard-step-content" ${step2 === 'locked' || busy ? 'disabled' : ''}><div class="v3-resource-details-grid"><label>Product title<input name="title" value="${escapeAttr(state.v3ResourceTitle)}" required placeholder="Quarterly benchmark corpus"/></label><label>Version<input name="version" value="${escapeAttr(state.v3ResourceVersion)}" required/></label><label class="v3-resource-description">Description<textarea name="description" required>${escapeHTML(state.v3ResourceDescription)}</textarea></label></div><p class="v3-resource-version-note"><strong>Immutable version</strong><span>Changing these files after submission creates a new Product version.</span></p></fieldset></section>
    <section class="v3-console-panel ${v3WizardStepClass(step3)}"><div class="v3-step-heading"><span>3</span><div><strong>Rights, delivery and price</strong><small>${step3 === 'locked' ? 'Complete Step 2 to configure the offer' : 'Submission creates a private Listing draft and never publishes directly'}</small></div><button type="submit" class="v3-direct-publish" ${canSubmit ? '' : 'disabled'}>${escapeHTML(submitLabel)}</button></div><fieldset class="v3-wizard-step-content" ${step3 === 'locked' || busy ? 'disabled' : ''}><div class="v3-resource-commerce-grid"><label><span class="v3-price-field-title"><i>1</i><strong>License</strong></span>${renderV3ResourceSelect('license', 'License', state.v3ResourceLicense)}</label><label><span class="v3-price-field-title"><i>2</i><strong>Delivery</strong></span>${renderV3ResourceSelect('delivery', 'Delivery', state.v3ResourceDelivery)}</label><label><span class="v3-price-field-title"><i>3</i><strong>Access window</strong></span><span class="v3-resource-input-unit v3-resource-input-unit-no-prefix"><input name="grantHours" type="number" min="1" max="720" value="${state.v3ResourceGrantHours}" required/><em>hours</em></span></label><label><span class="v3-price-field-title"><i>4</i><strong>Price per grant</strong></span><span class="v3-resource-input-unit"><b>$</b><input name="price" type="number" min="0.01" step="0.01" value="${state.v3ResourcePrice || ''}" placeholder="0.00" required/><em>USD</em></span></label></div><div class="v3-resource-delivery-note"><span aria-hidden="true">↓</span><div><strong>Buyer receives a time-limited DownloadGrant</strong><small>Only the selected delivery mode is authorized. Provider paths and permanent credentials remain private.</small></div><em>Protected delivery</em></div></fieldset></section>
  </form>`
}

function endpointAgentPrompt() {
  const files = state.v3EndpointMaterials.map((file) => `- ${file.name}: ${file.localPath}`).join('\n') || '- No files selected yet'
  return `You are standardizing a seller-operated local HTTP service for an Exora Dock tunnel. Read every material and call exora.save_api_bridge_draft exactly once.\n\nDraft ID: ${state.v3EndpointDraftId}\nExpected version: ${state.v3EndpointDraft?.version || 0}\nBridge mode: dock_tunnel\n\nMaterials:\n${files}\n\nRules:\n- bridgeMode must be dock_tunnel.\n- Convert the materials into Exora routes, metering and pricing.\n- Never include a local URL or credential in the draft.\n- Put uncertain field paths in unresolvedFields.\n- Saving the Agent draft must not create or publish a Product or Listing.`
}

function renderV3SharedFilePicker(action: string, title: string, details: string[], status = '', disabled = false) {
  return `<button class="v3-shared-file-picker" type="button" data-v3-action="${escapeAttr(action)}" ${disabled ? 'disabled' : ''}><span class="v3-shared-file-picker-icon" aria-hidden="true">+</span><span><strong>${escapeHTML(title)}</strong>${details.map((detail) => `<small>${escapeHTML(detail)}</small>`).join('')}</span>${status ? `<em>${escapeHTML(status)}</em>` : ''}</button>`
}

function renderV3AgentMaterialPicker(action: 'endpoint-materials-add' | 'api-materials-add') {
  return renderV3SharedFilePicker(action, 'Choose files from this computer', ['Documents only · JSON, YAML, Markdown, TXT, CSV', 'File paths stay in the Dock main process and are never uploaded directly'])
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
  </details><footer class="v3-api-prompt-footer"><p><strong>Next</strong><span>Run these instructions in your connected Agent, then check the saved draft.</span></p><div><button type="button" data-v3-action="${escapeAttr(options.copyAction)}">Copy prompt</button><button class="ghost" type="button" data-v3-action="${escapeAttr(options.refreshAction)}">Refresh</button><button class="ghost" type="button" data-v3-action="${escapeAttr(options.checkAction)}">Check draft</button></div></footer></div>`
}

function endpointReviewIDs() {
  return state.v3EndpointDraft ? ['service', ...state.v3EndpointDraft.routes.map((route) => `route:${route.routeId}`)] : []
}

function endpointReviewFingerprint(id: string) {
  const draft = state.v3EndpointDraft
  if (!draft) return ''
  if (id === 'service') return JSON.stringify({ title: draft.title, description: draft.description, protocol: draft.protocol, healthPath: draft.healthPath })
  const route = draft.routes.find((item) => `route:${item.routeId}` === id)
  if (!route) return ''
  const pricing = route.pricing.map((item) => ({ dimension: item.dimension, rateAtomic: item.rateAtomic, per: item.per, meterSource: item.meterSource, ...(item.selector ? { selector: item.selector } : {}), chargeOn: item.chargeOn }))
  return JSON.stringify({ operationId: route.operationId, method: route.method, path: route.path, displayName: route.displayName, pricing, maxChargePerInvocationAtomic: route.maxChargePerInvocationAtomic })
}

function endpointUnresolvedForReview(id: string) {
  const draft = state.v3EndpointDraft
  if (!draft) return []
  if (id === 'service') return (draft.unresolvedFields || []).filter((field) => !/^routes(?:\.|\[)/.test(field))
  const route = draft.routes.find((item) => `route:${item.routeId}` === id)
  const index = route ? draft.routes.indexOf(route) : -1
  if (!route || index < 0) return []
  return (draft.unresolvedFields || []).filter((field) => field.includes(route.routeId) || field.includes(route.operationId) || field.startsWith(`routes.${index}`) || field.startsWith(`routes[${index}]`))
}

function endpointPathField(path: string) {
  return String(path).match(/(?:^|\.)(title|description|protocol|healthPath|operationId|method|path|displayName|maxChargePerInvocationAtomic|dimension|rateAtomic|per|meterSource|selector|chargeOn)$/)?.[1]
}

function resolveEndpointBoundField(reviewID: string, fieldName: string, componentIndex?: number) {
  const draft = state.v3EndpointDraft
  if (!draft) return
  const route = draft.routes.find((item) => `route:${item.routeId}` === reviewID)
  const routeIndex = route ? draft.routes.indexOf(route) : -1
  draft.unresolvedFields = (draft.unresolvedFields || []).filter((path) => {
    if (endpointPathField(path) !== fieldName) return true
    if (reviewID === 'service') return /^routes(?:\.|\[)/.test(path)
    const routeMatches = route && (path.includes(route.routeId) || path.includes(route.operationId) || path.startsWith(`routes.${routeIndex}.`) || path.startsWith(`routes[${routeIndex}].`))
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

function applyV3EndpointDraft(draft: V3APIBridgeDraft) {
  if (draft.bridgeMode !== 'dock_tunnel' || draft.baseUrl) throw new Error('Endpoint Agent draft must use dock_tunnel and cannot contain a local Base URL.')
  state.v3EndpointDraftId = draft.draftId
  state.v3EndpointDraft = draft
  state.v3EndpointAgentReady = true
  state.v3EndpointDraftDirty = false
  state.v3EndpointHealthPath = draft.healthPath || '/health'
  state.v3EndpointReviewIndex = 0
  state.v3EndpointProbe = undefined
  state.v3EndpointRouteTestResult = undefined
  restoreEndpointReview()
}

function currentV3EndpointDraft() {
  const draft = state.v3EndpointDraft
  if (!draft) throw new Error('Load the Endpoint Agent draft first.')
  return { draftId: draft.draftId, expectedVersion: draft.version, bridgeMode: 'dock_tunnel', title: draft.title, description: draft.description, protocol: draft.protocol, baseUrl: '', healthPath: draft.healthPath, routes: draft.routes, agentNotes: draft.agentNotes || '', unresolvedFields: draft.unresolvedFields || [] }
}

function renderV3EndpointAgentPageCore() {
  const draft = state.v3EndpointDraft
  const ids = endpointReviewIDs()
  const activeIndex = Math.max(0, Math.min(state.v3EndpointReviewIndex, Math.max(0, ids.length - 1)))
  const activeID = ids[activeIndex] || 'service'
  const activeRoute = activeID.startsWith('route:') ? draft?.routes.find((route) => `route:${route.routeId}` === activeID) : undefined
  const unresolved = endpointUnresolvedForReview(activeID)
  const confirmedCount = ids.filter((id) => state.v3EndpointReviewStatus[id] === 'confirmed').length
  const reviewComplete = Boolean(draft && ids.length && confirmedCount === ids.length && !(draft.unresolvedFields || []).length && !state.v3EndpointDraftDirty)
  const credentialReady = state.v3EndpointAuthType === 'none' || Boolean(state.v3EndpointSecret) && (state.v3EndpointAuthType !== 'basic' || Boolean(state.v3EndpointBasicUsername.trim())) && (state.v3EndpointAuthType !== 'api_key' || /^[A-Za-z0-9-]{1,64}$/.test(state.v3EndpointAPIKeyHeader))
  const attestationsReady = state.v3EndpointAttestPricing && state.v3EndpointAttestRuntime && state.v3EndpointAttestRights
  const localReady = Boolean(state.v3EndpointLocalURL.trim() && state.v3EndpointProbe?.ok)
  const canSubmit = Boolean(reviewComplete && credentialReady && localReady && attestationsReady)
  const materials = state.v3EndpointMaterials.map((file) => renderV3SharedFileRow(file, `<button class="danger ghost" type="button" data-v3-endpoint-material-remove="${escapeAttr(file.id)}">Remove</button>`)).join('')
  const visibleIDs = ids.map((id, index) => ({ id, index })).filter(({ id }) => state.v3EndpointReviewFilter === 'all' || (state.v3EndpointReviewFilter === 'pending' ? state.v3EndpointReviewStatus[id] !== 'confirmed' : endpointUnresolvedForReview(id).length > 0))
  const reviewList = visibleIDs.map(({ id, index }) => { const route = draft?.routes.find((item) => `route:${item.routeId}` === id); const status = state.v3EndpointReviewStatus[id] || 'pending'; return `<button type="button" class="v3-api-review-item ${index === activeIndex ? 'selected' : ''} ${status} ${endpointUnresolvedForReview(id).length ? 'warning' : ''}" data-v3-endpoint-review-index="${index}"><span>${status === 'confirmed' ? '✓' : status === 'modified' ? '!' : index + 1}</span><div><strong>${escapeHTML(id === 'service' ? 'Service information' : `${route?.method} ${route?.path}`)}</strong><small>${escapeHTML(id === 'service' ? draft?.title || '' : route?.displayName || route?.operationId || '')}</small></div><em>${status === 'confirmed' ? 'Confirmed' : status === 'modified' ? 'Modified · confirm again' : 'Pending review'}</em></button>` }).join('') || '<div class="v3-api-review-filter-empty">No items match this filter.</div>'
  const serviceEditor = draft ? `<div class="v3-api-review-form"><div class="v3-api-product-grid"><label>Title<input data-v3-endpoint-draft="title" value="${escapeAttr(draft.title)}"/></label><label>Protocol<select data-v3-endpoint-draft="protocol">${(['openapi','openai','generic_http','sse'] as V3APIBridgeProtocol[]).map((value) => `<option value="${value}" ${draft.protocol === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Health Path<input data-v3-endpoint-draft="healthPath" value="${escapeAttr(draft.healthPath)}"/></label></div><label>Description<textarea data-v3-endpoint-draft="description">${escapeHTML(draft.description)}</textarea></label><p class="v3-api-agent-note"><strong>Agent notes</strong><span>${escapeHTML(draft.agentNotes || 'No notes supplied.')}</span></p></div>` : ''
  const dimensions = ['request','successful_request','input_tokens','output_tokens','input_bytes','output_bytes','execution_second','image','provider_reported']
  const routeEditor = activeRoute ? `<div class="v3-api-review-form"><div class="v3-api-product-grid"><label>Operation ID<input data-v3-endpoint-route="operationId" value="${escapeAttr(activeRoute.operationId)}"/></label><label>Method<select data-v3-endpoint-route="method">${['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].map((value) => `<option ${activeRoute.method === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Path<input data-v3-endpoint-route="path" value="${escapeAttr(activeRoute.path)}"/></label><label>Display name<input data-v3-endpoint-route="displayName" value="${escapeAttr(activeRoute.displayName)}"/></label></div><div class="v3-api-pricing-list">${activeRoute.pricing.map((price, index) => `<div class="v3-api-price-row"><select data-v3-endpoint-price="dimension" data-price-index="${index}">${dimensions.map((value) => `<option ${price.dimension === value ? 'selected' : ''}>${value}</option>`).join('')}</select><input type="number" min="0" data-v3-endpoint-price="rateAtomic" data-price-index="${index}" value="${price.rateAtomic}" title="Atomic rate"/><input type="number" min="1" data-v3-endpoint-price="per" data-price-index="${index}" value="${price.per}" title="Per units"/><select data-v3-endpoint-price="meterSource" data-price-index="${index}">${['gateway','protocol_adapter','openai_usage','provider_response'].map((value) => `<option ${price.meterSource === value ? 'selected' : ''}>${value}</option>`).join('')}</select><select data-v3-endpoint-price="chargeOn" data-price-index="${index}">${['started','succeeded','completed'].map((value) => `<option ${price.chargeOn === value ? 'selected' : ''}>${value}</option>`).join('')}</select><input data-v3-endpoint-price="selector" data-price-index="${index}" value="${escapeAttr(price.selector || '')}" placeholder="usage selector"/><button class="ghost" type="button" data-v3-endpoint-price-remove="${index}">Remove</button></div>`).join('')}</div><button class="ghost" type="button" data-v3-action="endpoint-price-add">Add pricing component</button><label>Maximum charge per invocation (atomic)<input type="number" min="0" data-v3-endpoint-route="maxChargePerInvocationAtomic" value="${activeRoute.maxChargePerInvocationAtomic || 0}"/></label><button class="danger ghost" type="button" data-v3-action="endpoint-route-remove">Remove route</button></div>` : serviceEditor
  const authFields = state.v3EndpointAuthType === 'none' ? '' : state.v3EndpointAuthType === 'basic' ? `<label>Username<input name="basicUsername" value="${escapeAttr(state.v3EndpointBasicUsername)}" autocomplete="username"/></label><label>Password<input name="secret" type="password" value="${escapeAttr(state.v3EndpointSecret)}" autocomplete="current-password"/></label>` : `<label>${state.v3EndpointAuthType === 'bearer' ? 'Bearer token' : 'API key secret'}<input name="secret" type="password" value="${escapeAttr(state.v3EndpointSecret)}" autocomplete="off"/></label>${state.v3EndpointAuthType === 'api_key' ? `<label>API key header<input name="apiKeyHeader" value="${escapeAttr(state.v3EndpointAPIKeyHeader)}"/></label>` : ''}`
  const smokeRoute = activeRoute || draft?.routes[0]
  const dangerous = Boolean(smokeRoute && ['POST','PUT','PATCH','DELETE'].includes(smokeRoute.method))
  const smokeResult = state.v3EndpointRouteTestResult
  return `<form class="v3-api-onboarding v3-provider-form" data-v3-form="endpoint-agent"><section class="v3-console-panel"><div class="v3-step-heading"><span>1</span><div><strong>Import materials and connect an Agent</strong><small>The Agent standardizes routes, metering and pricing; local URLs and credentials never enter its draft.</small></div><button type="button" data-v3-action="endpoint-materials-add">Add files</button></div><div class="v3-api-material-list">${materials || '<div class="v3-scan-empty"><strong>No Endpoint materials selected</strong><span>Add OpenAPI, docs, examples or pricing tables.</span></div>'}</div>${renderV3AgentPromptPanel({ title: 'Endpoint Agent Prompt', draftId: state.v3EndpointDraftId, expectedVersion: draft?.version || 0, prompt: endpointAgentPrompt(), copyAction: 'endpoint-prompt-copy', refreshAction: 'endpoint-prompt-refresh', checkAction: 'endpoint-draft-check' })}</section><section class="v3-console-panel"><div class="v3-step-heading"><span>2</span><div><strong>Review Agent draft</strong><small>Edit and confirm Service, every Route, and every pricing component.</small></div><button class="ghost" type="button" data-v3-action="endpoint-route-add" ${draft ? '' : 'disabled'}>Add route</button></div>${draft?.unresolvedFields?.length ? `<div class="v3-api-unresolved-list"><strong>Needs review</strong>${draft.unresolvedFields.map((field) => `<span>${escapeHTML(field)}</span>`).join('')}<small>Only editing the matching field—or explicitly marking an unbound item handled—clears it.</small></div>` : ''}${draft ? `<div class="v3-api-review-workspace"><aside><div><strong>Draft review</strong><small>Version ${draft.version} · ${confirmedCount}/${ids.length} confirmed</small></div><div class="v3-api-review-filters"><span>All ${ids.length}</span><span>Pending ${ids.length - confirmedCount}</span><span>Warnings ${(draft.unresolvedFields || []).length}</span></div>${reviewList}</aside><main><header><div><small>Item ${activeIndex + 1} of ${ids.length}</small><strong>${escapeHTML(activeID === 'service' ? 'Service information' : `${activeRoute?.method} ${activeRoute?.path}`)}</strong></div><span class="${state.v3EndpointReviewStatus[activeID] || 'pending'}">${state.v3EndpointReviewStatus[activeID] || 'Pending'}</span></header>${routeEditor}${unresolved.length ? `<div class="v3-api-review-warning"><strong>Agent needs your input</strong><span>${unresolved.map(escapeHTML).join(', ')}</span></div>` : ''}<footer><button class="ghost" type="button" data-v3-endpoint-review-previous ${activeIndex === 0 ? 'disabled' : ''}>Previous</button><button type="button" data-v3-endpoint-review-confirm="${escapeAttr(activeID)}" ${unresolved.length ? 'disabled' : ''}>Confirm and review next</button><button class="ghost" type="button" data-v3-endpoint-review-next ${activeIndex + 1 >= ids.length ? 'disabled' : ''}>Next</button></footer></main></div><div class="v3-form-actions"><button type="button" data-v3-action="endpoint-draft-save">Save revised draft</button><span>${reviewComplete ? 'All draft items confirmed' : `${ids.length - confirmedCount} items still require approval`}</span></div>` : '<div class="v3-api-review-waiting"><span>2</span><div><strong>Waiting for the Agent draft</strong><small>Agent standardization is mandatory for every Local Endpoint.</small></div></div>'}</section><section class="v3-console-panel ${reviewComplete ? '' : 'locked'}"><div class="v3-step-heading"><span>3</span><div><strong>Dock connection and seller confirmation</strong><small>Configure the private runtime, verify health, optionally test a Route, then submit a private Listing draft.</small></div><button class="ghost" type="button" data-v3-action="endpoint-probe" ${reviewComplete ? '' : 'disabled'}>${state.v3EndpointProbe?.ok ? 'Check health again' : 'Test local health'}</button></div><div class="v3-api-connection-grid"><label>Local service URL<input name="localBaseUrl" value="${escapeAttr(state.v3EndpointLocalURL)}" placeholder="http://127.0.0.1:8000"/></label><label>Health Path<input value="${escapeAttr(draft?.healthPath || '/health')}" readonly/></label><label>Authentication<select name="authType"><option value="none" ${state.v3EndpointAuthType === 'none' ? 'selected' : ''}>None</option><option value="bearer" ${state.v3EndpointAuthType === 'bearer' ? 'selected' : ''}>Bearer token</option><option value="api_key" ${state.v3EndpointAuthType === 'api_key' ? 'selected' : ''}>API key</option><option value="basic" ${state.v3EndpointAuthType === 'basic' ? 'selected' : ''}>Basic authentication</option></select></label>${authFields}<label>Timeout seconds<input name="timeoutSeconds" type="number" min="1" max="300" value="${state.v3EndpointTimeout}"/></label><label>Maximum concurrency<input name="concurrency" type="number" min="1" max="64" value="${state.v3EndpointConcurrency}"/></label></div><div class="v3-api-probe ${state.v3EndpointProbe?.ok ? 'passed' : state.v3EndpointProbe ? 'failed' : 'idle'}"><span>${state.v3EndpointProbe?.ok ? '✓' : state.v3EndpointProbe ? '!' : '→'}</span><div><strong>${state.v3EndpointProbe?.ok ? 'Local Health Path passed' : 'Local connectivity must pass'}</strong><small>${escapeHTML(state.v3EndpointProbe?.error || 'Dock validates and probes this private target without sending its URL to Cloud.')}</small></div></div>${smokeRoute ? `<details class="v3-api-auth-card"><summary><strong>Optional Route smoke test · ${escapeHTML(smokeRoute.method)} ${escapeHTML(smokeRoute.path)}</strong></summary><div class="v3-api-connection-grid"><label>Concrete test path<input name="routeTestPath" value="${escapeAttr(state.v3EndpointRouteTestPath || smokeRoute.path)}"/></label><label>Query string<input name="routeTestQuery" value="${escapeAttr(state.v3EndpointRouteTestQuery)}" placeholder="limit=1"/></label><label>Content type<input name="routeTestContentType" value="${escapeAttr(state.v3EndpointRouteTestContentType)}"/></label></div><label>Request body<textarea name="routeTestBody">${escapeHTML(state.v3EndpointRouteTestBody)}</textarea></label>${dangerous ? `<label><input name="routeTestDanger" type="checkbox" ${state.v3EndpointRouteTestDangerConfirmed ? 'checked' : ''}/> I understand this ${escapeHTML(smokeRoute.method)} test may change local service state.</label>` : ''}<button class="ghost" type="button" data-v3-action="endpoint-route-test" ${dangerous && !state.v3EndpointRouteTestDangerConfirmed ? 'disabled' : ''}>Run optional Route test</button>${smokeResult ? `<div class="v3-api-probe ${smokeResult.ok ? 'passed' : 'failed'}"><span>${smokeResult.ok ? '✓' : '!'}</span><div><strong>${smokeResult.status ? `HTTP ${smokeResult.status}` : 'Route test failed'} · ${smokeResult.latencyMs || 0} ms</strong><small>${escapeHTML(smokeResult.error || `${smokeResult.bytesRead || 0} bytes${smokeResult.truncated ? ' · preview truncated' : ''}`)}</small><pre>${escapeHTML(smokeResult.preview || '')}</pre></div></div>` : ''}</details>` : ''}<div class="v3-api-attestations"><strong>Seller confirmation</strong><label><input type="checkbox" data-v3-endpoint-attest="pricing" ${state.v3EndpointAttestPricing ? 'checked' : ''}/><span>I define and accept responsibility for Endpoint pricing.</span></label><label><input type="checkbox" data-v3-endpoint-attest="runtime" ${state.v3EndpointAttestRuntime ? 'checked' : ''}/><span>I will operate this local service and report usage accurately.</span></label><label><input type="checkbox" data-v3-endpoint-attest="rights" ${state.v3EndpointAttestRights ? 'checked' : ''}/><span>I have the right to sell access to this service.</span></label></div><div class="v3-api-readiness">${[['Draft approved',reviewComplete,`${confirmedCount}/${ids.length} items confirmed`],['Local health',localReady,state.v3EndpointProbe?.ok ? `HTTP ${state.v3EndpointProbe.status}` : 'Health probe required'],['Credential',credentialReady,credentialReady ? 'Configured' : 'Credential incomplete'],['Seller confirmation',attestationsReady,attestationsReady ? 'Accepted' : 'Three statements required']].map(([label, passed, detail]) => `<div class="${passed ? 'passed' : ''}"><span>${passed ? '✓' : '!'}</span><div><strong>${label}</strong><small>${detail}</small></div></div>`).join('')}</div><div class="v3-api-publish-actions"><div><strong>${canSubmit ? 'Ready to submit' : 'Complete every required check'}</strong><small>Creates a Product, encrypted Secret, and private Listing draft. It does not publish.</small></div><button type="submit" class="v3-direct-publish" ${canSubmit ? '' : 'disabled'}>Submit to Listings</button></div></section></form>`
}

function removeV3RenderedDiv(markup: string, className: string) {
  const start = markup.indexOf(`<div class="${className}">`)
  if (start < 0) return markup
  const tags = /<div\b[^>]*>|<\/div>/g
  tags.lastIndex = start
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = tags.exec(markup))) {
    depth += match[0].startsWith('</') ? -1 : 1
    if (depth === 0) return markup.slice(0, start) + markup.slice(tags.lastIndex)
  }
  return markup
}

function replaceV3RenderedDiv(markup: string, className: string, replacement: string) {
  const start = markup.indexOf(`<div class="${className}`)
  if (start < 0) return markup
  const tags = /<div\b[^>]*>|<\/div>/g
  tags.lastIndex = start
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = tags.exec(markup))) {
    depth += match[0].startsWith('</') ? -1 : 1
    if (depth === 0) return markup.slice(0, start) + replacement + markup.slice(tags.lastIndex)
  }
  return markup
}

function wrapV3RenderedDiv(markup: string, className: string, wrapperClassName: string) {
  const start = markup.indexOf(`<div class="${className}`)
  if (start < 0) return markup
  const tags = /<div\b[^>]*>|<\/div>/g
  tags.lastIndex = start
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = tags.exec(markup))) {
    depth += match[0].startsWith('</') ? -1 : 1
    if (depth === 0) return `${markup.slice(0, start)}<div class="${wrapperClassName}">${markup.slice(start, tags.lastIndex)}</div>${markup.slice(tags.lastIndex)}`
  }
  return markup
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

function normalizeV3AgentWizardMarkup(markup: string, mode: 'endpoint' | 'api_bridge') {
  const materialsCurrent = v3AgentMaterialsCurrent(mode)
  const hasMaterials = mode === 'endpoint' ? state.v3EndpointMaterials.length > 0 : state.v3APIMaterials.length > 0
  const reviewComplete = mode === 'endpoint'
    ? Boolean(materialsCurrent && state.v3EndpointDraft && !state.v3EndpointDraftDirty && !(state.v3EndpointDraft.unresolvedFields || []).length && endpointReviewIDs().every((id) => state.v3EndpointReviewStatus[id] === 'confirmed'))
    : Boolean(materialsCurrent && state.v3APIDraftVersion > 0 && !state.v3APIDraftDirty && !state.v3APIUnresolvedFields.length && state.v3APIReviewStatus.service === 'confirmed' && state.v3APIRoutes.every((route) => state.v3APIReviewStatus[`route:${route.routeId}`] === 'confirmed'))
  const busy = mode === 'endpoint' ? state.v3EndpointSubmitting : state.v3APISavingListing
  const checking = mode === 'endpoint' ? state.v3EndpointProbing : state.v3APIProbing
  const hasAgentDraft = mode === 'endpoint' ? Boolean(state.v3EndpointDraft) : state.v3APIDraftVersion > 0
  const oldSubmit = markup.match(/<button[^>]*type="submit"[^>]*class="v3-direct-publish"[^>]*>|<button[^>]*class="v3-direct-publish"[^>]*type="submit"[^>]*>/)?.[0] || ''
  const oldCanSubmit = oldSubmit !== '' && !oldSubmit.includes('disabled')
  const canSubmit = materialsCurrent && reviewComplete && oldCanSubmit && !busy && !checking
  const finalLabel = busy ? 'Submitting…' : 'Submit to Listings'
  const pickerAction = mode === 'endpoint' ? 'endpoint-materials-add' : 'api-materials-add'
  const probeAction = mode === 'endpoint' ? 'endpoint-probe' : 'api-probe'
  const probeLabel = mode === 'endpoint'
    ? checking ? 'Checking…' : state.v3EndpointProbe?.ok ? 'Check health again' : 'Test local health'
    : state.v3APIProbing ? 'Checking…' : state.v3APIProbe?.ok ? 'Check again' : 'Check connection'
  const stepStates: V3WizardStepState[] = [materialsCurrent ? 'complete' : hasMaterials && hasAgentDraft ? 'error' : 'available', !materialsCurrent ? 'locked' : reviewComplete ? 'complete' : 'available', !reviewComplete ? 'locked' : busy || checking ? 'busy' : 'available']
  let normalized = markup.replace('class="v3-api-onboarding v3-provider-form"', 'class="v3-application-flow v3-provider-form"')
  normalized = normalized.replace(new RegExp(`<button[^>]*data-v3-action="${pickerAction}"[^>]*>Add files</button></div><div class="v3-api-material-list">`), `</div>${renderV3AgentMaterialPicker(pickerAction)}<div class="v3-api-material-list">`)
  normalized = normalized.replace(/<div class="v3-scan-empty"><strong>[^<]*<\/strong><span>[^<]*<\/span><\/div>/, renderV3SharedFileEmpty('No documents selected', 'Choose one or more supported documents to unlock Step 2.'))
  normalized = normalized.replace(/<div class="v3-api-attestations">[\s\S]*?<\/div>/, renderV3SellerAttestations(mode))
  if (!hasAgentDraft) {
    normalized = replaceV3RenderedDiv(normalized, mode === 'endpoint' ? 'v3-api-review-waiting' : 'v3-api-review-workspace', renderV3AgentDraftWaiting(mode))
    normalized = removeV3RenderedDiv(normalized, 'v3-form-actions')
  }
  const checkAction = mode === 'endpoint' ? 'endpoint-draft-check' : 'api-draft-check'
  if (!hasMaterials) normalized = normalized.replace(new RegExp(`<button([^>]*)data-v3-action="${checkAction}"([^>]*)>`), `<button$1data-v3-action="${checkAction}"$2 disabled>`)
  let sectionIndex = 0
  normalized = normalized.replace(/<section class="v3-console-panel([^\"]*)">/g, (match, suffix: string) => {
    if (sectionIndex >= 3) return match
    const stepIndex = sectionIndex++
    const stateName = stepStates[stepIndex]
    const publishPanelClass = stepIndex === 2 && !suffix.includes('v3-api-publish-panel') ? ' v3-api-publish-panel' : ''
    return `<section class="v3-console-panel ${v3WizardStepClass(stateName)}${publishPanelClass}${suffix}" ${stateName === 'locked' ? 'inert aria-disabled="true"' : ''}>`
  })
  normalized = removeV3RenderedDiv(normalized, 'v3-api-readiness')
  normalized = removeV3RenderedDiv(normalized, 'v3-api-publish-actions')
  normalized = normalized.replace(new RegExp(`<button[^>]*data-v3-action="${probeAction}"[^>]*>.*?<\\/button>`), `<button type="submit" class="v3-direct-publish" ${canSubmit ? '' : 'disabled'}>${finalLabel}</button>`)
  const probeCard = '<div class="v3-api-probe '
  normalized = wrapV3RenderedDiv(normalized, 'v3-api-probe', 'v3-api-health-row')
  normalized = normalized.replace(probeCard, `<div class="v3-wizard-inline-action"><button class="ghost" type="button" data-v3-action="${probeAction}" ${reviewComplete && !busy && !checking ? '' : 'disabled'}>${probeLabel}</button></div>${probeCard}`)
  if (mode === 'endpoint') {
    const runtimeHeading = '<div class="v3-api-runtime-heading"><div><strong>Private Dock runtime</strong><small>These settings stay on this computer and never enter the public Manifest.</small></div><span>Dock only</span></div>'
    const lockNotice = reviewComplete ? '' : '<div class="v3-api-publish-lock"><strong>Finish reviewing the Agent draft first</strong><span>Runtime settings unlock after every structured item is confirmed.</span></div>'
    normalized = normalized.replace('<div class="v3-api-connection-grid">', `${lockNotice}${runtimeHeading}<div class="v3-api-connection-grid">`)
  }
  if (!materialsCurrent) {
    const reason = mode === 'endpoint' ? 'Add at least one document and load a fresh Endpoint Agent draft to unlock Step 2.' : 'Add at least one document and load a fresh API Agent draft to unlock Step 2.'
    normalized = normalized.replace('<section class="v3-console-panel v3-wizard-step is-locked', `<section data-lock-reason="${escapeAttr(reason)}" class="v3-console-panel v3-wizard-step is-locked`)
  }
  return normalized
}

function renderV3EndpointAgentPage() {
  return normalizeV3AgentWizardMarkup(renderV3EndpointAgentPageCore(), 'endpoint')
}

function apiBridgeAgentPrompt() {
  const files = state.v3APIMaterials.map((file) => `- ${file.name}: ${file.localPath}`).join('\n') || '- No files selected yet'
  return `You are preparing an Exora API Bridge seller draft.\n\nConnect to the Exora Dock MCP server configured by the desktop application. Read every material below, reconcile inconsistent API and pricing descriptions, then call exora.save_api_bridge_draft exactly once.\n\nDraft ID: ${state.v3APIDraftId}\nExpected version: ${state.v3APIDraftVersion}\n\nMaterials:\n${files}\n\nRules:\n- Use the supplied draftId and expectedVersion.\n- Never send credentials, secrets, seller attestation, Listing state, or publish instructions.\n- Do not invent uncertain values; put their field paths in unresolvedFields and explain them in agentNotes.\n- Use only supported meter dimensions. Variable pricing requires maxChargePerInvocationAtomic.\n- Saving this draft must not create or publish a Product or Listing.`
}

function renderV3APIBridgePageCore() {
  const unresolved = new Set(state.v3APIUnresolvedFields)
  const materials = state.v3APIMaterials.map((file) => renderV3SharedFileRow(file, `<button class="danger ghost" type="button" data-v3-api-material-remove="${escapeAttr(file.id)}">Remove</button>`)).join('')
  const dimensions = ['request','successful_request','input_tokens','output_tokens','input_bytes','output_bytes','execution_second','image','provider_reported']
  const meterSources = ['gateway', 'protocol_adapter', 'openai_usage', 'provider_response']
  const chargeEvents = ['started', 'succeeded', 'completed']
  state.v3APIRoutes.forEach((route) => { if (!route.pricing?.length) route.pricing = [{ dimension: 'request', rateAtomic: Math.max(0, Math.round(route.price * 1_000_000)), per: 1, meterSource: 'gateway', chargeOn: 'started' }] })
  const reviewItems = [{ id: 'service', label: 'Service information', detail: state.v3APITitle || 'Title, protocol and connection' }, ...state.v3APIRoutes.map((route) => ({ id: `route:${route.routeId}`, label: `${route.method} ${route.path}`, detail: route.title || route.operationId }))]
  const reviewItemUnresolved = (item: { id: string }, index: number) => state.v3APIUnresolvedFields.filter((field) => {
    if (item.id === 'service') return !/^routes(?:\.|\[)/.test(field)
    const route = state.v3APIRoutes.find((candidate) => `route:${candidate.routeId}` === item.id)
    const routeIndex = Math.max(0, index - 1)
    return Boolean(route && (field.includes(route.routeId) || field.includes(route.operationId) || field.startsWith(`routes.${routeIndex}`) || field.startsWith(`routes[${routeIndex}]`)))
  })
  const activeReviewIndex = Math.max(0, Math.min(state.v3APIReviewIndex, Math.max(0, reviewItems.length - 1)))
  const activeReview = reviewItems[activeReviewIndex]
  const activeRoute = activeReview?.id.startsWith('route:') ? state.v3APIRoutes.find((route) => `route:${route.routeId}` === activeReview.id) : undefined
  const activeUnresolved = activeReview ? reviewItemUnresolved(activeReview, activeReviewIndex) : []
  const activeCanConfirm = activeUnresolved.length === 0
  const visibleReviewItems = reviewItems.map((item, index) => ({ item, index })).filter(({ item, index }) => state.v3APIReviewFilter === 'all' || (state.v3APIReviewFilter === 'pending' ? state.v3APIReviewStatus[item.id] !== 'confirmed' : reviewItemUnresolved(item, index).length > 0))
  const reviewList = visibleReviewItems.map(({ item, index }) => { const status = state.v3APIReviewStatus[item.id] || 'pending'; return `<button type="button" class="v3-api-review-item ${index === activeReviewIndex ? 'selected' : ''} ${status} ${reviewItemUnresolved(item, index).length ? 'warning' : ''}" data-v3-review-index="${index}"><span>${status === 'confirmed' ? '✓' : status === 'modified' ? '!' : index + 1}</span><div><strong>${escapeHTML(item.label)}</strong><small>${escapeHTML(item.detail)}</small></div><em>${status === 'confirmed' ? 'Confirmed' : status === 'modified' ? 'Modified · confirm again' : 'Pending review'}</em></button>` }).join('') || '<div class="v3-api-review-filter-empty">No items match this filter.</div>'
  const serviceReview = `<div class="v3-api-review-form"><div class="v3-api-product-grid"><label class="${unresolved.has('title') ? 'v3-api-unresolved' : ''}">Title<input name="title" value="${escapeAttr(state.v3APITitle)}" data-v3-api-draft="title"/></label><label>Protocol<select name="protocol" data-v3-api-draft="protocol">${(['openapi','openai','generic_http','sse'] as V3APIBridgeProtocol[]).map((value) => `<option value="${value}" ${state.v3APIProtocol === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label class="${unresolved.has('baseUrl') ? 'v3-api-unresolved' : ''}">Base URL<input name="baseUrl" value="${escapeAttr(state.v3APIBaseURL)}" data-v3-api-draft="baseUrl"/></label><label class="${unresolved.has('healthPath') ? 'v3-api-unresolved' : ''}">Health Path<input name="healthPath" value="${escapeAttr(state.v3APIHealthPath)}" data-v3-api-draft="healthPath"/></label><label class="v3-api-description">Description<textarea name="description" data-v3-api-draft="description">${escapeHTML(state.v3APIDescription)}</textarea></label></div></div>`
  const routePricing = activeRoute ? (activeRoute.pricing?.length ? activeRoute.pricing : [{ dimension: 'request', rateAtomic: Math.round(activeRoute.price * 1_000_000), per: 1, meterSource: 'gateway', chargeOn: 'started' } as V3APIPricingComponent]) : []
  const routeComponents = activeRoute ? routePricing.map((item, index) => `<div class="v3-api-price-component ${item.dimension === 'provider_reported' ? 'seller-reported' : ''}"><label>Meter<select data-v3-price-dimension="${activeRoute.id}:${index}">${dimensions.map((dimension) => `<option value="${dimension}" ${item.dimension === dimension ? 'selected' : ''}>${dimension.replaceAll('_', ' ')}</option>`).join('')}</select></label><label>Price (USDC)<input type="number" min="0" step="0.000001" value="${(item.rateAtomic / 1_000_000).toFixed(6)}" data-v3-price-usdc="${activeRoute.id}:${index}"/></label><label>Per units<input type="number" min="1" value="${item.per}" data-v3-price-per="${activeRoute.id}:${index}"/></label>${item.dimension === 'provider_reported' ? `<label class="v3-api-selector">Seller-reported selector<span>Seller reported</span><input value="${escapeAttr(item.selector || '')}" data-v3-price-selector="${activeRoute.id}:${index}" placeholder="usage.units"/></label>` : ''}<button class="ghost" type="button" data-v3-price-remove="${activeRoute.id}:${index}">Remove</button><details class="v3-api-price-advanced"><summary>Advanced meter values</summary><div><label>Rate atomic<input type="number" min="0" value="${item.rateAtomic}" data-v3-price-rate="${activeRoute.id}:${index}"/></label><label>Meter source<select data-v3-price-meter-source="${activeRoute.id}:${index}">${meterSources.map((source) => `<option value="${source}" ${item.meterSource === source ? 'selected' : ''}>${source.replaceAll('_', ' ')}</option>`).join('')}</select></label><label>Charge on<select data-v3-price-charge-on="${activeRoute.id}:${index}">${chargeEvents.map((event) => `<option value="${event}" ${item.chargeOn === event ? 'selected' : ''}>${event}</option>`).join('')}</select></label></div></details></div>`).join('') : ''
  const routeReview = activeRoute ? `<div class="v3-api-review-form ${activeUnresolved.length ? 'v3-api-unresolved' : ''}"><div class="v3-api-route-row editable"><select data-v3-api-route-method="${activeRoute.id}">${['GET','POST','PUT','PATCH','DELETE'].map((method) => `<option ${activeRoute.method === method ? 'selected' : ''}>${method}</option>`).join('')}</select><span><input value="${escapeAttr(activeRoute.title)}" data-v3-api-route-title="${activeRoute.id}" placeholder="Display name"/><input value="${escapeAttr(activeRoute.operationId)}" data-v3-api-route-operation="${activeRoute.id}" placeholder="operationId"/><input value="${escapeAttr(activeRoute.path)}" data-v3-api-route-path="${activeRoute.id}" placeholder="/path"/></span><button class="ghost" type="button" data-v3-api-route-remove="${activeRoute.id}">Remove</button></div><div class="v3-api-components"><div class="v3-api-components-heading"><div><strong>Pricing components</strong><small>Prices are seller-defined and shown to buyers in USDC.</small></div><button class="ghost" type="button" data-v3-price-add="${activeRoute.id}">Add component</button></div>${routeComponents}<div class="v3-api-max-charge"><label>Maximum charge per invocation (USDC)<input type="number" min="0" step="0.000001" value="${((activeRoute.maxChargePerInvocationAtomic || 0) / 1_000_000).toFixed(6)}" data-v3-max-charge-usdc="${activeRoute.id}"/></label><details><summary>Atomic value</summary><input type="number" min="0" value="${activeRoute.maxChargePerInvocationAtomic || 0}" data-v3-max-charge="${activeRoute.id}"/></details></div></div></div>` : serviceReview
  const confirmedCount = reviewItems.filter((item) => state.v3APIReviewStatus[item.id] === 'confirmed').length
  const hasAgentDraft = state.v3APIDraftVersion > 0
  const reviewComplete = hasAgentDraft && reviewItems.length > 0 && confirmedCount === reviewItems.length
  const mechanicalIssues: string[] = []
  if (!hasAgentDraft) mechanicalIssues.push('Agent draft has not been loaded')
  if (!state.v3APITitle.trim()) mechanicalIssues.push('Service title is required')
  try {
    const url = new URL(state.v3APIBaseURL)
    const host = url.hostname.toLowerCase()
    const privateHost = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '0.0.0.0' || host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    if (url.protocol !== 'https:' || url.username || url.password || privateHost) mechanicalIssues.push('Base URL must use public HTTPS')
  } catch { mechanicalIssues.push('Base URL is invalid') }
  if (!state.v3APIHealthPath.startsWith('/')) mechanicalIssues.push('Health Path must start with /')
  if (!state.v3APIRoutes.length) mechanicalIssues.push('At least one Route is required')
  const routeKeys = new Set<string>()
  state.v3APIRoutes.forEach((route) => {
    const key = `${route.method} ${route.path}`
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(route.operationId) || !route.path.startsWith('/') || !route.method) mechanicalIssues.push(`Route ${route.title || route.routeId} is incomplete`)
    if (routeKeys.has(key)) mechanicalIssues.push(`Duplicate Route ${key}`)
    routeKeys.add(key)
    route.pricing?.forEach((price) => {
      if (!dimensions.includes(price.dimension) || price.rateAtomic < 0 || price.per < 1 || !['gateway', 'protocol_adapter', 'openai_usage', 'provider_response'].includes(price.meterSource) || !['started', 'succeeded', 'completed'].includes(price.chargeOn)) mechanicalIssues.push(`Invalid pricing on ${route.operationId}`)
      if (price.dimension === 'provider_reported' && !price.selector?.trim()) mechanicalIssues.push(`Seller-reported selector missing on ${route.operationId}`)
    })
    if (route.pricing?.some((price) => !['request', 'successful_request'].includes(price.dimension)) && !route.maxChargePerInvocationAtomic) mechanicalIssues.push(`Maximum invocation charge missing on ${route.operationId}`)
  })
  if (state.v3APIUnresolvedFields.length) mechanicalIssues.push(`${state.v3APIUnresolvedFields.length} Agent fields remain unresolved`)
  if (!reviewComplete) mechanicalIssues.push(`${reviewItems.length - confirmedCount} review items remain`)
  const mechanicallyComplete = mechanicalIssues.length === 0
  const probe = state.v3APIProbe
  const credentialConfigured = state.v3APIAuthType === 'none' || (state.v3APICredentialConfigured && (state.v3APIAuthType !== 'basic' || Boolean(state.v3APIBasicUsername.trim())) && (state.v3APIAuthType !== 'api_key' || /^[A-Za-z0-9-]{1,64}$/.test(state.v3APIKeyHeader)))
  const sellerConfirmationComplete = state.v3APIAttestPricing && state.v3APIAttestUsage && state.v3APIAttestRights
  const canSave = Boolean(mechanicallyComplete && probe?.ok && credentialConfigured && sellerConfirmationComplete && !state.v3APISavingListing)
  const rateValues = state.v3APIRoutes.flatMap((route) => route.pricing || []).map((item) => item.rateAtomic / 1_000_000)
  const priceSummary = rateValues.length ? `${Math.min(...rateValues).toFixed(6)}–${Math.max(...rateValues).toFixed(6)} USDC by meter` : 'Pricing requires review'
  const publishDisabled = reviewComplete ? '' : 'disabled'
  const authFields = state.v3APIAuthType === 'none' ? '' : state.v3APIAuthType === 'basic'
    ? `<label>Username<input name="basicUsername" value="${escapeAttr(state.v3APIBasicUsername)}" autocomplete="username" ${publishDisabled}/></label><label>Password<input name="secret" type="password" autocomplete="current-password" placeholder="Encrypted and never sent to Agent" ${publishDisabled}/></label>`
    : `<label>${state.v3APIAuthType === 'bearer' ? 'Bearer token' : 'API key secret'}<input name="secret" type="password" autocomplete="off" placeholder="Encrypted and never sent to Agent" ${publishDisabled}/></label>${state.v3APIAuthType === 'api_key' ? `<label>API key header<input name="apiKeyHeader" value="${escapeAttr(state.v3APIKeyHeader)}" ${publishDisabled}/></label>` : ''}`
  const readiness = [
    ['Draft approved', mechanicallyComplete, mechanicallyComplete ? `${confirmedCount} structured items confirmed` : mechanicalIssues[0] || 'Draft review is incomplete', 'review'],
    ['Connectivity passed', Boolean(probe?.ok), probe?.ok ? `HTTP ${probe.status} · ${probe.latencyMs} ms` : 'Run the side-effect-free Health Path check', 'probe'],
    ['Credential configured', credentialConfigured, credentialConfigured ? state.v3APIAuthType === 'none' ? 'No upstream authentication' : `${state.v3APIAuthType} credential ready` : 'Enter the Provider credential', 'credential'],
    ['Seller confirmation', sellerConfirmationComplete, sellerConfirmationComplete ? 'All three seller statements accepted' : 'Accept every seller responsibility statement', 'attestation'],
  ] as const
  const publishPanel = `<section class="v3-console-panel v3-api-publish-panel ${reviewComplete ? '' : 'locked'}"><div class="v3-step-heading"><span>3</span><div><strong>Public endpoint and seller confirmation</strong><small>Configure the public HTTPS provider endpoint and its private credential. Submission creates a private Listing draft.</small></div><button class="ghost" type="button" data-v3-action="api-probe" ${state.v3APIProbing || !reviewComplete ? 'disabled' : ''}>${state.v3APIProbing ? 'Checking…' : probe?.ok ? 'Check again' : 'Check connection'}</button></div>${reviewComplete ? '' : '<div class="v3-api-publish-lock"><strong>Finish reviewing the Agent draft first</strong><span>Connection settings unlock after every structured item is confirmed.</span></div>'}<div class="v3-api-connection-summary"><div><small>Provider Base URL</small><strong>${escapeHTML(state.v3APIBaseURL || 'Not configured')}</strong></div><div><small>Health Path</small><strong>${escapeHTML(state.v3APIHealthPath || '/health')}</strong></div><button class="ghost" type="button" data-v3-action="api-edit-service">Edit in review</button></div><div class="v3-api-auth-card"><div class="v3-api-auth-heading"><div><strong>Private provider authentication</strong><small>Credentials stay outside the Agent draft and public Manifest.</small></div><span>${credentialConfigured ? 'Ready' : 'Required'}</span></div><div class="v3-api-connection-grid"><label>Authentication<select name="authType" ${reviewComplete ? '' : 'disabled'}><option value="bearer" ${state.v3APIAuthType === 'bearer' ? 'selected' : ''}>Bearer token</option><option value="api_key" ${state.v3APIAuthType === 'api_key' ? 'selected' : ''}>API key</option><option value="basic" ${state.v3APIAuthType === 'basic' ? 'selected' : ''}>Basic authentication</option><option value="none" ${state.v3APIAuthType === 'none' ? 'selected' : ''}>No authentication</option></select></label>${authFields}</div></div><div class="v3-api-probe ${probe?.ok ? 'passed' : probe ? 'failed' : 'idle'}"><span>${probe?.ok ? '✓' : probe ? '!' : '→'}</span><div><strong>${probe?.ok ? 'Health Path reachable' : probe ? 'Connection check failed' : 'Connectivity not checked'}</strong><small>${probe?.ok ? `Checked ${escapeHTML(probe.checkedAt ? new Date(probe.checkedAt).toLocaleString() : 'just now')} · HTTP ${probe.status} · ${probe.latencyMs} ms · ${escapeHTML(probe.contentType || 'unknown content type')}` : escapeHTML(probe?.error || 'Only the declared side-effect-free Health Path is called.')}</small></div></div><div class="v3-api-public-preview"><div><span>MARKET PREVIEW</span><strong>${escapeHTML(state.v3APITitle || 'Untitled API Bridge')}</strong><small>${escapeHTML(state.v3APIProtocol)} · ${state.v3APIRoutes.length} routes · ${escapeHTML(priceSummary)}</small></div><div class="v3-api-preview-badges"><span>Seller-defined pricing</span>${state.v3APIRoutes.some((route) => route.pricing?.some((item) => item.dimension === 'provider_reported')) ? '<span class="warning">Seller-reported usage</span>' : ''}</div><p>Exora verifies connectivity, forwarding, metering, and settlement. The seller remains responsible for API behavior, output quality, pricing, resale rights, and seller-reported usage.</p></div><div class="v3-api-attestations"><strong>Seller confirmation</strong><label><input type="checkbox" data-v3-attestation="pricing" ${state.v3APIAttestPricing ? 'checked' : ''}/><span><b>I define and accept responsibility for the published prices.</b><small>Exora does not assess price fairness.</small></span></label><label><input type="checkbox" data-v3-attestation="usage" ${state.v3APIAttestUsage ? 'checked' : ''}/><span><b>I am responsible for API behavior and reported usage accuracy.</b><small>Seller-reported meters are labeled for buyers.</small></span></label><label><input type="checkbox" data-v3-attestation="rights" ${state.v3APIAttestRights ? 'checked' : ''}/><span><b>I have the right to sell access to this API.</b><small>This confirmation cannot be supplied by an Agent.</small></span></label></div><div class="v3-api-readiness">${readiness.map(([label, passed, detail, target]) => `<button type="button" class="${passed ? 'passed' : ''}" data-v3-readiness-target="${target}"><span>${passed ? '✓' : '!'}</span><div><strong>${label}</strong><small>${detail}</small></div></button>`).join('')}</div><div class="v3-api-publish-actions"><div><strong>${canSave ? 'Ready to submit' : 'Complete every requirement above'}</strong><small>This creates a private Listing draft. Nothing is published until you confirm in Listings.</small></div><button class="v3-direct-publish" type="submit" ${canSave ? '' : 'disabled'}>${state.v3APISavingListing ? 'Submitting…' : 'Submit to Listings'}</button></div></section>`
  return `<form class="v3-api-onboarding v3-provider-form" data-v3-form="api_bridge">
    <section class="v3-console-panel"><div class="v3-step-heading"><span>1</span><div><strong>Import materials and connect an Agent</strong><small>Files remain on this computer; Cloud receives only the structured draft.</small></div><button type="button" data-v3-action="api-materials-add">Add files</button></div><div class="v3-api-material-list">${materials || '<div class="v3-scan-empty"><strong>No API materials selected</strong><span>Add OpenAPI, JSON/YAML, Markdown, text, CSV, pricing tables, or request/response examples.</span></div>'}</div>${renderV3AgentPromptPanel({ title: 'Public API Bridge Agent Prompt', draftId: state.v3APIDraftId, expectedVersion: state.v3APIDraftVersion, prompt: apiBridgeAgentPrompt(), copyAction: 'api-prompt-copy', refreshAction: 'api-prompt-regenerate', checkAction: 'api-draft-check' })}</section>
    <section class="v3-console-panel"><div class="v3-step-heading"><span>2</span><div><strong>Review Agent draft</strong><small>Approve every structured item. Editing an approved item returns it to review.</small></div><button class="ghost" type="button" data-v3-action="api-route-add">Add route</button></div>${state.v3APIAgentNotes ? `<p class="v3-api-agent-note"><strong>Agent notes</strong><span>${escapeHTML(state.v3APIAgentNotes)}</span></p>` : ''}${state.v3APIUnresolvedFields.length ? `<div class="v3-api-unresolved-list"><strong>Needs review</strong>${state.v3APIUnresolvedFields.map((field) => `<span>${escapeHTML(field)}</span>`).join('')}<small>Edit the matching item, then confirm it.</small></div>` : ''}<div class="v3-api-review-workspace"><aside><div><strong>Draft review</strong><small>Version ${state.v3APIDraftVersion} · ${state.v3APIMaterials.length} materials · ${confirmedCount}/${reviewItems.length} confirmed</small></div><div class="v3-api-review-filters"><span>All ${reviewItems.length}</span><span>Pending ${reviewItems.length - confirmedCount}</span><span>Warnings ${state.v3APIUnresolvedFields.length}</span></div>${reviewList}</aside><main><header><div><small>Item ${activeReviewIndex + 1} of ${reviewItems.length}</small><strong>${escapeHTML(activeReview?.label || 'No review items')}</strong></div><span class="${state.v3APIReviewStatus[activeReview?.id || ''] || 'pending'}">${state.v3APIReviewStatus[activeReview?.id || ''] === 'confirmed' ? 'Confirmed' : state.v3APIReviewStatus[activeReview?.id || ''] === 'modified' ? 'Modified' : 'Pending review'}</span></header>${routeReview}${activeUnresolved.length ? `<div class="v3-api-review-warning"><strong>Agent needs your input</strong><span>${activeUnresolved.map(escapeHTML).join(', ')}</span><small>Change the relevant value before confirming this item.</small></div>` : ''}<footer><button class="ghost" type="button" data-v3-review-previous ${activeReviewIndex === 0 ? 'disabled' : ''}>Previous</button><button type="button" data-v3-review-confirm="${escapeAttr(activeReview?.id || '')}" ${activeCanConfirm ? '' : 'disabled'}>${activeReviewIndex + 1 < reviewItems.length ? 'Confirm and review next' : 'Confirm item'}</button><button class="ghost" type="button" data-v3-review-next ${activeReviewIndex + 1 >= reviewItems.length ? 'disabled' : ''}>Next</button></footer></main></div><div class="v3-form-actions"><button type="button" data-v3-action="api-draft-save">Save revised draft</button><span>${reviewComplete ? 'All draft items confirmed' : `${reviewItems.length - confirmedCount} items still require approval`}</span></div></section>
    ${publishPanel}
  </form>`
}

function renderV3APIBridgePage() {
  return normalizeV3AgentWizardMarkup(renderV3APIBridgePageCore(), 'api_bridge')
}

function syncV3APIDraftFromForm(form?: HTMLFormElement | null) {
  if (!form) return
  const data = new FormData(form)
  state.v3APITitle = String(data.get('title') || '').trim()
  state.v3APIDescription = String(data.get('description') || '').trim()
  state.v3APIBaseURL = String(data.get('baseUrl') || '').trim()
  state.v3APIHealthPath = String(data.get('healthPath') || '').trim() || '/health'
  const protocol = String(data.get('protocol') || state.v3APIProtocol)
  if (protocol === 'openapi' || protocol === 'openai' || protocol === 'generic_http' || protocol === 'sse') state.v3APIProtocol = protocol
  const authType = String(data.get('authType') || 'none')
  if (authType === 'bearer' || authType === 'api_key' || authType === 'basic' || authType === 'none') state.v3APIAuthType = authType
  state.v3APIKeyHeader = String(data.get('apiKeyHeader') || '').trim() || 'X-API-Key'
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
  if (id === 'service') return JSON.stringify({ title: state.v3APITitle, description: state.v3APIDescription, protocol: state.v3APIProtocol, baseUrl: state.v3APIBaseURL, healthPath: state.v3APIHealthPath })
  const route = state.v3APIRoutes.find((item) => `route:${item.routeId}` === id)
  return route ? JSON.stringify({ operationId: route.operationId, method: route.method, path: route.path, title: route.title, pricing: route.pricing, maxChargePerInvocationAtomic: route.maxChargePerInvocationAtomic }) : ''
}

function apiBridgeUnresolvedForReview(id: string) {
  if (id === 'service') return state.v3APIUnresolvedFields.filter((field) => !/^routes(?:\.|\[)/.test(field))
  const route = state.v3APIRoutes.find((item) => `route:${item.routeId}` === id)
  const routeIndex = state.v3APIRoutes.indexOf(route as V3APIRoute)
  if (!route || routeIndex < 0) return []
  return state.v3APIUnresolvedFields.filter((field) => field.includes(route.routeId) || field.includes(route.operationId) || field.startsWith(`routes.${routeIndex}`) || field.startsWith(`routes[${routeIndex}]`))
}

function apiBridgePathField(path: string) {
  const match = String(path).match(/(?:^|\.)(title|description|protocol|baseUrl|healthPath|operationId|method|path|displayName|maxChargePerInvocationAtomic|dimension|rateAtomic|per|meterSource|selector|chargeOn)$/)
  return match?.[1]
}

function resolveAPIBridgeBoundField(reviewId: string, fieldName: string, componentIndex?: number) {
  const route = state.v3APIRoutes.find((item) => `route:${item.routeId}` === reviewId)
  const routeIndex = route ? state.v3APIRoutes.indexOf(route) : -1
  state.v3APIUnresolvedFields = state.v3APIUnresolvedFields.filter((path) => {
    if (apiBridgePathField(path) !== fieldName) return true
    if (reviewId === 'service') return /^routes(?:\.|\[)/.test(path)
    const routeMatches = route && (path.includes(route.routeId) || path.includes(route.operationId) || path.startsWith(`routes.${routeIndex}.`) || path.startsWith(`routes[${routeIndex}].`))
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
    const ids = ['service', ...state.v3APIRoutes.map((route) => `route:${route.routeId}`)]
    state.v3APIReviewStatus = Object.fromEntries(ids.map((id) => { const item = saved.items?.[id]; return [id, item?.fingerprint === apiBridgeReviewFingerprint(id) ? item.status || 'pending' : item?.status === 'confirmed' ? 'modified' : 'pending'] }))
  } catch { state.v3APIReviewStatus = {} }
}

function applyV3APIBridgeDraft(draft: V3APIBridgeDraft) {
  state.v3APIDraftId = draft.draftId
  state.v3APIDraftVersion = draft.version
  state.v3APITitle = draft.title || ''
  state.v3APIDescription = draft.description || ''
  state.v3APIProtocol = draft.protocol || 'generic_http'
  state.v3APIBaseURL = draft.baseUrl || ''
  state.v3APIHealthPath = draft.healthPath || '/health'
  state.v3APIRoutes = (draft.routes || []).map((route, index) => ({ id: route.routeId || `draft-route-${index}-${route.operationId}`, routeId: route.routeId || `local-${crypto.randomUUID()}`, operationId: route.operationId, method: route.method, path: route.path, title: route.displayName || route.operationId, selected: true, price: 0, pricing: route.pricing?.length ? route.pricing : [{ dimension: 'request', rateAtomic: 0, per: 1, meterSource: 'gateway', chargeOn: 'started' }], maxChargePerInvocationAtomic: route.maxChargePerInvocationAtomic || 0 }))
  state.v3APIUnresolvedFields = [...(draft.unresolvedFields || [])]
  state.v3APIAgentNotes = draft.agentNotes || ''
  state.v3APIProbe = undefined
  clearV3ApplicationAttempt('api_bridge')
  state.v3APIReviewIndex = 0
  state.v3APIDraftDirty = false
  restoreAPIBridgeReview()
}

function currentV3APIBridgeDraft() {
  return { draftId: state.v3APIDraftId, expectedVersion: state.v3APIDraftVersion, bridgeMode: 'transparent', title: state.v3APITitle, description: state.v3APIDescription, protocol: state.v3APIProtocol, baseUrl: state.v3APIBaseURL, healthPath: state.v3APIHealthPath, routes: state.v3APIRoutes.map((route) => ({ routeId: route.routeId, operationId: route.operationId, method: route.method, path: route.path, displayName: route.title, pricing: route.pricing?.length ? route.pricing : [{ dimension: 'request', rateAtomic: Math.round(route.price * 1_000_000), per: 1, meterSource: 'gateway', chargeOn: 'started' }], maxChargePerInvocationAtomic: route.maxChargePerInvocationAtomic || 0 })), agentNotes: state.v3APIAgentNotes, unresolvedFields: state.v3APIUnresolvedFields }
}

function renderV3ListingsPage() {
  const rows = state.v3Listings.map((listing) => `<article class="v3-listing-row ${listing.listingId === state.v3HighlightedListingId ? 'highlighted' : ''}" data-listing-row="${escapeAttr(listing.listingId)}"><span class="transaction-record-rail"></span><div><strong>${escapeHTML(listing.listingId)}</strong><small>${escapeHTML(listing.productId)} · ${escapeHTML(listing.updatedAt || '')}</small></div><span class="status-dot" data-state="${listing.status === 'published' ? 'healthy' : 'starting'}">${escapeHTML(listing.status)}</span><div>${listing.status === 'draft' ? `<button type="button" data-v3-listing-action="publish" data-listing-id="${escapeAttr(listing.listingId)}">Publish</button>` : ''}${listing.status === 'published' ? `<button class="ghost" type="button" data-v3-listing-action="pause" data-listing-id="${escapeAttr(listing.listingId)}">Pause</button>` : ''}${listing.status === 'paused' ? `<button type="button" data-v3-listing-action="resume" data-listing-id="${escapeAttr(listing.listingId)}">Resume</button>` : ''}<button class="danger ghost" type="button" data-v3-listing-action="retire" data-listing-id="${escapeAttr(listing.listingId)}">Retire</button></div></article>`).join('')
  const savedNotice = state.v3HighlightedListingId ? '<div class="v3-listing-saved-notice"><span>✓</span><div><strong>Submitted to Listings</strong><small>Review the highlighted private draft, then publish it here when you are ready.</small></div></div>' : ''
  return `<section>${savedNotice}<div class="v3-listings-head"><span>draft / validating / published / paused / provider_busy / unhealthy / retired</span><button class="ghost" type="button" data-v3-action="listings-refresh">${toolbarIcons.refresh}<span>Refresh</span></button></div>${state.v3ListingsLoading ? '<p class="empty-copy">Loading listings…</p>' : rows || '<div class="market-rail-empty"><strong>No listings</strong><span>Create a VM, resource bundle, Exora Endpoint, or API Bridge first.</span></div>'}</section>`
}

function v3ListingPriceLabel(price: Record<string, any> = {}) {
  const currency = String(price.currency || 'USD')
  if (Number.isFinite(Number(price.amount))) return `${Number(price.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${currency}${price.unit ? ` / ${price.unit}` : ''}`
  if (price.model === 'metered' || price.pricingVersion) return `Route-based · ${currency}`
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

function v3RoutePricingLabel(route: Record<string, any>) {
  const components = Array.isArray(route.pricing) ? route.pricing : []
  if (!components.length) return 'Pricing not declared'
  return components.map((component: Record<string, any>) => {
    const rate = Number(component.rateAtomic || 0) / 1_000_000
    return `${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC / ${component.per || 1} ${String(component.dimension || 'request').replaceAll('_', ' ')}`
  }).join(' · ')
}

function renderV3ApplicationManifest(source: string, manifest: Record<string, any>) {
  const routes = Array.isArray(manifest.routes) ? manifest.routes : Array.isArray(manifest.operations) ? manifest.operations : []
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
    ].join('')
  } else if (source === 'resources') {
    const archive = manifest.archive || {}
    details = [
      v3ManifestDetail('Version', manifest.version),
      v3ManifestDetail('License', String(manifest.license || '').replaceAll('_', ' ')),
      v3ManifestDetail('Delivery', String(manifest.delivery || '').replaceAll('_', ' ')),
      v3ManifestDetail('Access window', manifest.grantHours ? `${manifest.grantHours} hours` : undefined),
      v3ManifestDetail('Archive', archive.format ? String(archive.format).toUpperCase() : undefined),
      v3ManifestDetail('Files', archive.sourceCount),
      v3ManifestDetail('Package size', archive.sizeBytes ? v3FormatBytes(Number(archive.sizeBytes)) : undefined),
    ].join('')
  } else {
    details = [
      v3ManifestDetail('Bridge mode', manifest.bridgeMode === 'dock_tunnel' ? 'Dock tunnel' : 'Public provider'),
      v3ManifestDetail('Protocol', manifest.protocol),
      ...(source === 'api_bridge' ? [v3ManifestDetail('Provider base URL', manifest.baseUrl)] : []),
      v3ManifestDetail('Health Path', manifest.healthPath),
      v3ManifestDetail('Authentication', String(manifest.authType || 'none').replaceAll('_', ' ')),
      v3ManifestDetail('Credential', manifest.secretConfigured ? 'Encrypted and configured' : 'Not configured'),
      v3ManifestDetail('Routes', routes.length),
      ...(source === 'endpoint' ? [v3ManifestDetail('Route contract', manifest.routeFingerprint ? 'Fingerprint recorded' : 'Missing')] : []),
      ...(source === 'api_bridge' ? [v3ManifestDetail('Cloud connectivity', manifest.connectivityCheckedAt ? `Checked ${new Date(manifest.connectivityCheckedAt).toLocaleString()}` : 'Not checked')] : []),
    ].join('')
  }
  const routeList = routes.length ? `<div class="v3-listing-route-list">${routes.map((route: Record<string, any>) => `<div><span>${escapeHTML(String(route.method || 'ANY'))}</span><strong>${escapeHTML(String(route.path || '/'))}</strong><small>${escapeHTML(String(route.title || route.operationId || 'Route'))} · ${escapeHTML(v3RoutePricingLabel(route))}</small></div>`).join('')}</div>` : ''
  return `<section class="v3-listing-manifest"><dl class="detail-grid v3-listing-source-details">${details}</dl>${routeList}<details><summary>Technical manifest</summary><pre>${escapeHTML(JSON.stringify(manifest, null, 2))}</pre></details></section>`
}

function v3ListingSourceMeta(source: string) {
  const sources: Record<string, { label: string; shortLabel: string; description: string; icon: IconNode }> = {
    vm: { label: 'Virtual Machine', shortLabel: 'VM', description: 'Measured compute and disposable environments', icon: Activity },
    resources: { label: 'Resource bundle', shortLabel: 'Resources', description: 'Versioned files with protected delivery', icon: Folder },
    endpoint: { label: 'Local Endpoint', shortLabel: 'Endpoint', description: 'Private services through a Dock tunnel', icon: BrainCircuit },
    api_bridge: { label: 'Public API Bridge', shortLabel: 'API Bridge', description: 'Public APIs normalized for Agent usage', icon: Network },
  }
  return sources[source] || { label: source.replaceAll('_', ' '), shortLabel: source.replaceAll('_', ' '), description: 'Exora provider application', icon: SquareKanban }
}

function v3ListingStatusMeta(status: string) {
  const statuses: Record<string, { label: string; tone: string }> = {
    draft: { label: 'Private draft', tone: 'draft' },
    validating: { label: 'Validating', tone: 'validating' },
    published: { label: 'Live', tone: 'published' },
    paused: { label: 'Paused', tone: 'paused' },
    provider_busy: { label: 'Provider busy', tone: 'attention' },
    unhealthy: { label: 'Unhealthy', tone: 'attention' },
    capacity_insufficient: { label: 'Capacity full', tone: 'attention' },
    retired: { label: 'Retired', tone: 'retired' },
  }
  return statuses[status] || { label: status.replaceAll('_', ' '), tone: 'neutral' }
}

function renderV3ListingEmptyState() {
  const sources = ['vm', 'resources', 'endpoint', 'api_bridge']
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

function renderV3ListingApplicationsPage() {
  const applicationByListing = new Map(state.v3ListingApplications.map((application) => [application.listing.listingId, application]))
  const attentionStatuses = ['unhealthy', 'provider_busy', 'capacity_insufficient']
  const publishedCount = state.v3Listings.filter((listing) => listing.status === 'published').length
  const readyCount = state.v3ListingApplications.filter(({ listing, readiness }) => listing.status === 'draft' && readiness?.ready).length
  const attentionCount = state.v3Listings.filter((listing) => attentionStatuses.includes(listing.status)).length
  const rows = state.v3Listings.map((listing) => {
    const application = applicationByListing.get(listing.listingId)
    const product = application?.product
    const source = application?.source || listing.applicationSource || 'api_bridge'
    const sourceMeta = v3ListingSourceMeta(source)
    const statusMeta = v3ListingStatusMeta(listing.status)
    const expanded = state.v3ExpandedListingId === listing.listingId
    const confirming = state.v3PublishConfirmListingId === listing.listingId
    const readiness = application?.readiness
    const checks = readiness?.checks || []
    const passedChecks = checks.filter((check) => check.ready).length
    const manifest = product?.manifest || {}
    const price = v3ListingPriceLabel(listing.price || {})
    const runtime = application?.runtime
    const updated = listing.updatedAt ? new Date(listing.updatedAt).toLocaleString() : 'Just now'
    const searchable = [listing.listingId, listing.productId, product?.title, sourceMeta.label, sourceMeta.shortLabel, statusMeta.label, price].filter(Boolean).join(' ').toLocaleLowerCase()
    const actions = `${listing.status === 'draft' ? (confirming ? `<span class="v3-inline-confirm"><small>Cloud will recalculate readiness now.</small><button type="button" data-v3-listing-action="publish" data-listing-id="${escapeAttr(listing.listingId)}">Confirm publish</button><button class="ghost" type="button" data-v3-publish-cancel>Cancel</button></span>` : `<button type="button" data-v3-publish-request="${escapeAttr(listing.listingId)}" ${readiness?.ready ? '' : 'disabled'}>Publish</button>`) : ''}${listing.status === 'published' ? `<button class="ghost" type="button" data-v3-listing-action="pause" data-listing-id="${escapeAttr(listing.listingId)}">Pause</button>` : ''}${['paused', 'unhealthy', 'provider_busy', 'capacity_insufficient'].includes(listing.status) ? `<button type="button" data-v3-listing-action="resume" data-listing-id="${escapeAttr(listing.listingId)}" ${readiness?.ready ? '' : 'disabled'}>Resume</button>` : ''}${listing.status !== 'retired' ? `<button class="danger ghost" type="button" data-v3-listing-action="retire" data-listing-id="${escapeAttr(listing.listingId)}">Retire</button>` : `<button class="ghost" type="button" data-v3-recreate-source="${escapeAttr(source)}">Create replacement</button>`}`
    return `<article class="v3-listing-application ${expanded ? 'expanded' : ''} ${listing.listingId === state.v3HighlightedListingId ? 'highlighted' : ''}" data-listing-row="${escapeAttr(listing.listingId)}" data-listing-source="${escapeAttr(source)}" data-listing-status="${escapeAttr(listing.status)}" data-listing-ready="${String(Boolean(readiness?.ready))}" data-listing-attention="${String(attentionStatuses.includes(listing.status))}" data-listing-search="${escapeAttr(searchable)}">
      <button type="button" class="v3-listing-summary" data-v3-listing-expand="${escapeAttr(listing.listingId)}" aria-expanded="${String(expanded)}">
        <span class="v3-listing-source-icon source-${escapeAttr(source)}">${icon(sourceMeta.icon)}</span>
        <span class="v3-listing-primary"><strong>${escapeHTML(product?.title || listing.productId)}</strong><small><em class="v3-source-badge source-${escapeAttr(source)}">${escapeHTML(sourceMeta.shortLabel)}</em><span>Updated ${escapeHTML(updated)}</span></small></span>
        <span class="v3-listing-summary-metrics"><span><small>Price</small><strong>${escapeHTML(price)}</strong></span><span><small>Readiness</small><strong>${checks.length ? `${passedChecks}/${checks.length} checks` : readiness?.ready ? 'Ready' : 'Pending'}</strong></span></span>
        <span class="v3-listing-state-pill tone-${escapeAttr(statusMeta.tone)}"><i></i>${escapeHTML(statusMeta.label)}</span>
        <span class="v3-listing-chevron">${toolbarIcons.disclosure}</span>
      </button>
      ${expanded ? `<div class="v3-listing-application-body">
        <div class="v3-listing-detail-head"><div><small>${escapeHTML(sourceMeta.label.toUpperCase())} APPLICATION</small><strong>Review before this offer reaches the market</strong></div><span class="${readiness?.ready ? 'ready' : 'blocked'}">${readiness?.ready ? `${icon(BadgeCheck)} Ready to publish` : `${icon(ShieldAlert)} Action required`}</span></div>
        <section class="v3-listing-detail-section"><header><span>APPLICATION SNAPSHOT</span><strong>Offer and availability</strong></header><dl class="detail-grid v3-listing-facts"><div><dt>Listing</dt><dd>${escapeHTML(listing.listingId)}</dd></div><div><dt>Product</dt><dd>${escapeHTML(listing.productId)}</dd></div><div><dt>Price</dt><dd>${escapeHTML(price)}</dd></div><div><dt>Availability</dt><dd>${listing.availability?.availableNow === true ? 'Public' : 'Private'}</dd></div>${source === 'endpoint' ? `<div><dt>Dock tunnel</dt><dd>${runtime?.tunnelOnline ? 'Online' : 'Offline'}</dd></div><div><dt>Local health</dt><dd>${runtime?.endpointHealthy ? 'Healthy' : 'Unavailable'}${runtime?.lastSeenAt ? ` · ${escapeHTML(new Date(runtime.lastSeenAt).toLocaleString())}` : ''}</dd></div>` : ''}</dl></section>
        <section class="v3-listing-detail-section"><header><span>PRODUCT MANIFEST</span><strong>Submitted configuration</strong></header>${renderV3ApplicationManifest(source, manifest)}</section>
        <section class="v3-listing-detail-section"><header><span>PUBLISH READINESS</span><strong>${checks.length ? `${passedChecks} of ${checks.length} checks passed` : 'Waiting for Cloud checks'}</strong></header><div class="v3-listing-checks">${checks.length ? checks.map((check) => `<div class="${check.ready ? 'passed' : 'failed'}"><span>${check.ready ? '✓' : '!'}</span><div><strong>${escapeHTML(check.label)}</strong><small>${escapeHTML(check.detail || '')}</small></div></div>`).join('') : '<div class="failed"><span>!</span><div><strong>No readiness report</strong><small>Refresh this application to request the latest Cloud checks.</small></div></div>'}</div></section>
        <div class="v3-listing-actions"><span><strong>Market controls</strong><small>Publishing changes public availability. Application fields remain read-only.</small></span>${actions}</div>
      </div>` : ''}
    </article>`
  }).join('')
  const savedNotice = state.v3HighlightedListingId ? '<div class="v3-listing-saved-notice"><span>✓</span><div><strong>Application received</strong><small>The highlighted draft is private. Review it here and publish only when every check passes.</small></div></div>' : ''
  const loading = `<div class="v3-listing-loading" aria-label="Loading applications">${Array.from({ length: 3 }, () => '<span><i></i><b></b><em></em></span>').join('')}</div>`
  const workspace = rows ? `<section class="v3-listing-workspace v3-console-panel">
    <div class="v3-listing-toolbar"><label class="v3-listing-search">${toolbarIcons.search}<input type="search" data-v3-listing-search placeholder="Search listings, products, status, or price" aria-label="Search listings"/></label><label><span>Source</span><select data-v3-listing-filter-source><option value="all">All sources</option><option value="vm">VM</option><option value="resources">Resources</option><option value="endpoint">Endpoint</option><option value="api_bridge">API Bridge</option></select></label><label><span>Status</span><select data-v3-listing-filter-status><option value="all">All statuses</option><option value="draft">Private drafts</option><option value="ready">Ready to publish</option><option value="published">Live</option><option value="paused">Paused</option><option value="attention">Needs attention</option><option value="retired">Retired</option></select></label><span class="v3-listing-results">${state.v3Listings.length} applications</span></div>
    <div class="v3-listing-list">${rows}</div>
    <div class="v3-listing-no-results hidden"><span>${toolbarIcons.search}</span><strong>No matching applications</strong><small>Try a different search term or filter.</small></div>
  </section>` : renderV3ListingEmptyState()
  return `<section class="v3-listings-page">${savedNotice}<section class="v3-listing-overview v3-console-panel"><div class="v3-listings-head"><div><span class="v3-listing-overview-mark">${icon(SquareKanban)}</span><span><strong>Publishing control</strong><small>Applications stay private until they pass readiness checks and you publish them here.</small></span></div><button class="ghost v3-listing-refresh" type="button" data-v3-action="listings-refresh">${toolbarIcons.refresh}<span>Refresh</span></button></div><div class="v3-listing-stats"><article><span>${icon(SquareKanban)}</span><div><strong>${state.v3Listings.length}</strong><small>Total applications</small></div></article><article class="live"><span>${icon(BadgeCheck)}</span><div><strong>${publishedCount}</strong><small>Live in market</small></div></article><article class="ready"><span>${icon(ShieldCheck)}</span><div><strong>${readyCount}</strong><small>Ready to publish</small></div></article><article class="attention"><span>${icon(ShieldAlert)}</span><div><strong>${attentionCount}</strong><small>Needs attention</small></div></article></div></section>${state.v3ListingsLoading ? loading : workspace}</section>`
}

function renderV3SellerSurface() {
  const page = state.v3SellerTab === 'vm' ? renderV3VMPage() : state.v3SellerTab === 'resources' ? renderV3ResourcesPage() : state.v3SellerTab === 'endpoint' ? renderV3EndpointAgentPage() : state.v3SellerTab === 'api_bridge' || state.v3SellerTab === 'openapi' ? renderV3APIBridgePage() : renderV3ListingApplicationsPage()
  const headings: Record<V3SellerTab, { kicker: string; title: string; description: string }> = {
    vm: { kicker: 'COMPUTE SUPPLY', title: 'List this computer', description: 'Measure this PC, install a disposable Linux environment, reserve capacity, then submit a private Listing draft.' },
    resources: { kicker: 'DIGITAL RESOURCES', title: 'Package files and data', description: 'Bundle versioned files, define delivery rights and pricing, then submit a private Listing draft.' },
    endpoint: { kicker: 'LOCAL ENDPOINT', title: 'Expose a local or private service', description: 'Connect an HTTP service running on this computer or private network through an outbound Dock tunnel.' },
    api_bridge: { kicker: 'PUBLIC API BRIDGE', title: 'Connect a public provider API', description: 'An Agent converts public API materials into Exora routes, metering and pricing. Then configure its public HTTPS endpoint with a private credential.' },
    openapi: { kicker: 'PUBLIC API BRIDGE', title: 'Connect a public provider API', description: 'An Agent converts public API materials into Exora routes, metering and pricing. Then configure its public HTTPS endpoint with a private credential.' },
    listings: { kicker: 'MARKET INVENTORY', title: 'Manage your listings', description: 'Review drafts, publish products, pause availability, inspect health, and retire offers from the market.' },
  }
  const heading = headings[state.v3SellerTab]
  return `<section class="v3-market-surface"><div class="v3-surface-heading"><div><span>${escapeHTML(heading.kicker)}</span><h2>${escapeHTML(heading.title)}</h2><p>${escapeHTML(heading.description)}</p></div></div>${state.v3SellerError ? `<div class="v3-error">${escapeHTML(state.v3SellerError)}</div>` : ''}<div class="v3-seller-page">${page}</div></section>${renderV3EnvironmentCloudModal()}`
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
    effectivePrice = {
      ...price,
      baseFee: state.v3BaseFeeEnabled && state.v3BaseFee > 0 ? { amount: state.v3BaseFee, currency: 'USD', unit: 'lease' } : undefined,
      minimumMinutes: state.v3MinimumMinutes,
      longDurationDiscount: state.v3LongDiscountEnabled && state.v3LongDiscountPercent > 0 ? { everyMinutes: state.v3LongDiscountAfterMinutes, additionalPercentOff: state.v3LongDiscountPercent, minimumPricePercent: state.v3LongDiscountMinimumPricePercent } : undefined,
    }
    const manifest = (productInput.manifest || {}) as Record<string, any>
    productInput.manifest = { ...manifest, price: effectivePrice, limits: { ...(manifest.limits || {}), minMinutes: state.v3MinimumMinutes } }
  }
  const attemptManifest = (productInput.manifest || {}) as Record<string, any>
  const attemptFingerprint = productInput.productKind === 'compute'
    ? JSON.stringify({ applicationSource, productKind: productInput.productKind, title: productInput.title, description: attemptManifest.runtimeBackend ? undefined : productInput.description, effectivePrice, valid, runtimeBackend: attemptManifest.runtimeBackend, environmentImageId: attemptManifest.environmentImageId || attemptManifest.template?.imageId, environmentImageVersion: attemptManifest.environmentImageVersion || attemptManifest.template?.imageVersion, template: attemptManifest.runtimeBackend ? undefined : attemptManifest.template, workspaceGiB: attemptManifest.workspaceGiB })
    : JSON.stringify({ productInput, effectivePrice, valid })
  const idempotencyKey = v3StableApplicationAttempt(applicationSource, attemptFingerprint)
  const manifest = (productInput.manifest || {}) as Record<string, unknown>
  const created = await invoke<{ product: V3Product }>('provider_product_create', { input: { ...productInput, manifest: { ...manifest, applicationSource }, idempotencyKey } })
  const saved = await invoke<{ listing: V3Listing }>('provider_listing_save', { input: { productId: created.product.productId, applicationSource, status: 'draft', price: effectivePrice, validation: { valid }, availability: { availableNow: false }, idempotencyKey } })
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
      if (name === 'license') state.v3ResourceLicense = value
      if (name === 'delivery') state.v3ResourceDelivery = value
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

function attachV3SurfaceHandlers() {
  updateV3DiskSpeedFact()
  attachV3ResourceSelectHandlers()
  fields.actionView.querySelectorAll<HTMLDetailsElement>('[data-v3-agent-prompt]').forEach((details) => details.addEventListener('toggle', () => {
    const promptKind = details.dataset.v3AgentPrompt
    if (promptKind) localStorage.setItem(`exora.agentPrompt.${promptKind}.expanded`, String(details.open))
  }))
  if (state.v3SellerTab === 'vm' && navigator.userAgent.includes('Windows') && !state.v3EnvironmentImagesLoaded) void loadV3WindowsEnvironments()
  fields.actionView.querySelector<HTMLFormElement>('[data-v3-catalog-search]')?.addEventListener('submit', (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; state.v3CatalogQuery = String(new FormData(form).get('query') || ''); void loadV3Catalog() })
  fields.actionView.querySelectorAll<HTMLElement>('.v3-product-card[data-v3-product]').forEach((card) => {
    const open = () => { state.v3SelectedProduct = state.v3Products.find((item) => item.productId === card.dataset.v3Product); renderDecisionPanel() }
    card.addEventListener('click', open)
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } })
  })
  const action = (name: string, handler: () => void) => fields.actionView.querySelector<HTMLButtonElement>(`[data-v3-action="${name}"]`)?.addEventListener('click', handler)
  action('activity-back', closeV3ActivityDetail)
  action('activity-refresh', () => {
    const sessionId = state.selectedV3ActivitySessionId
    if (sessionId) void loadV3ActivityDetail(sessionId)
  })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-copy-v3-identifier]').forEach((button) => button.addEventListener('click', () => {
    const value = button.dataset.copyV3Identifier || ''
    if (value) void navigator.clipboard.writeText(value).then(() => showToast('Identifier copied.'))
  }))
  action('catalog-back', () => { state.v3SelectedProduct = undefined; renderDecisionPanel() })
  action('catalog-refresh', () => void loadV3Catalog())
  action('listings-refresh', () => void loadV3Listings())
  const endpointForm = fields.actionView.querySelector<HTMLFormElement>('[data-v3-form="endpoint-agent"]')
  if (endpointForm && !state.v3EndpointMaterialsLoaded) {
    state.v3EndpointMaterialsLoaded = true
    void Promise.all([
      invoke<{ files: V3APIMaterial[] }>('provider_api_bridge_materials_get', { input: { draftId: state.v3EndpointDraftId } }).catch(() => ({ files: [] })),
      invoke<{ draft: V3APIBridgeDraft }>('provider_api_bridge_draft_get', { input: { draftId: state.v3EndpointDraftId } }).catch(() => undefined),
    ]).then(([materials, savedDraft]) => {
      state.v3EndpointMaterials = materials.files || []
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
    state.v3EndpointHealthPath = state.v3EndpointDraft?.healthPath || '/health'
    state.v3EndpointAuthType = String(data.get('authType') || 'none') as typeof state.v3EndpointAuthType
    state.v3EndpointSecret = String(data.get('secret') || '')
    state.v3EndpointAPIKeyHeader = String(data.get('apiKeyHeader') || state.v3EndpointAPIKeyHeader).trim() || 'X-API-Key'
    state.v3EndpointBasicUsername = String(data.get('basicUsername') || state.v3EndpointBasicUsername).trim()
    state.v3EndpointTimeout = Math.max(1, Math.min(300, Number(data.get('timeoutSeconds') || 120)))
    state.v3EndpointConcurrency = Math.max(1, Math.min(64, Number(data.get('concurrency') || 1)))
    state.v3EndpointRouteTestPath = String(data.get('routeTestPath') || state.v3EndpointRouteTestPath).trim()
    state.v3EndpointRouteTestQuery = String(data.get('routeTestQuery') || '').trim()
    state.v3EndpointRouteTestContentType = String(data.get('routeTestContentType') || 'application/json').trim()
    state.v3EndpointRouteTestBody = String(data.get('routeTestBody') || '')
    state.v3EndpointRouteTestDangerConfirmed = data.get('routeTestDanger') === 'on'
  }
  const endpointCredentialSecret = () => state.v3EndpointAuthType === 'basic' ? `${state.v3EndpointBasicUsername}:${state.v3EndpointSecret}` : state.v3EndpointSecret
  action('endpoint-materials-add', () => void run(async () => { localStorage.setItem('exora.endpointDraftId', state.v3EndpointDraftId); const result = await invoke<{ files: V3APIMaterial[]; canceled?: boolean }>('provider_api_bridge_materials_choose', { input: { draftId: state.v3EndpointDraftId } }); if (!result.canceled) { state.v3EndpointMaterials = result.files || []; invalidateV3AgentMaterials('endpoint') }; renderDecisionPanel() }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-endpoint-material-remove]').forEach((button) => button.addEventListener('click', () => void run(async () => { const result = await invoke<{ files: V3APIMaterial[] }>('provider_api_bridge_material_remove', { input: { draftId: state.v3EndpointDraftId, id: button.dataset.v3EndpointMaterialRemove } }); state.v3EndpointMaterials = result.files || []; invalidateV3AgentMaterials('endpoint'); renderDecisionPanel() })))
  action('endpoint-prompt-copy', () => void navigator.clipboard.writeText(endpointAgentPrompt()).then(() => showToast('Endpoint Agent Prompt copied.')))
  action('endpoint-prompt-refresh', () => { renderDecisionPanel(); showToast('Endpoint Agent Prompt refreshed.') })
  action('endpoint-draft-check', () => void run(async () => {
    if (!state.v3EndpointMaterials.length) throw new Error('Add at least one supported document before checking the Agent draft.')
    const materialRevisionChanged = !v3AgentMaterialsCurrent('endpoint')
    const result = await invoke<{ draft: V3APIBridgeDraft }>('provider_api_bridge_draft_get', { input: { draftId: state.v3EndpointDraftId } })
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
  }))
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
  endpointForm?.querySelectorAll<HTMLButtonElement>('[data-v3-endpoint-review-index]').forEach((button) => button.addEventListener('click', () => { const previous = state.v3EndpointReviewIndex; state.v3EndpointReviewIndex = Number(button.dataset.v3EndpointReviewIndex || 0); if (previous !== state.v3EndpointReviewIndex) { const route = state.v3EndpointDraft?.routes[state.v3EndpointReviewIndex - 1]; state.v3EndpointRouteTestPath = route?.path || ''; state.v3EndpointRouteTestDangerConfirmed = false; state.v3EndpointRouteTestResult = undefined } renderDecisionPanel() }))
  endpointForm?.querySelector<HTMLButtonElement>('[data-v3-endpoint-review-previous]')?.addEventListener('click', () => { state.v3EndpointReviewIndex = Math.max(0, state.v3EndpointReviewIndex - 1); state.v3EndpointRouteTestPath = state.v3EndpointDraft?.routes[state.v3EndpointReviewIndex - 1]?.path || ''; state.v3EndpointRouteTestDangerConfirmed = false; renderDecisionPanel() })
  endpointForm?.querySelector<HTMLButtonElement>('[data-v3-endpoint-review-next]')?.addEventListener('click', () => { state.v3EndpointReviewIndex = Math.min(endpointReviewIDs().length - 1, state.v3EndpointReviewIndex + 1); state.v3EndpointRouteTestPath = state.v3EndpointDraft?.routes[state.v3EndpointReviewIndex - 1]?.path || ''; state.v3EndpointRouteTestDangerConfirmed = false; renderDecisionPanel() })
  endpointForm?.querySelector<HTMLButtonElement>('[data-v3-endpoint-review-confirm]')?.addEventListener('click', (event) => { const id = (event.currentTarget as HTMLButtonElement).dataset.v3EndpointReviewConfirm || ''; if (id && endpointUnresolvedForReview(id).length === 0) { state.v3EndpointReviewStatus[id] = 'confirmed'; state.v3EndpointConfirmed = [...new Set([...state.v3EndpointConfirmed, id])]; persistEndpointReview(); state.v3EndpointReviewIndex = Math.min(endpointReviewIDs().length - 1, state.v3EndpointReviewIndex + 1) } renderDecisionPanel() })
  endpointForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-v3-endpoint-draft]').forEach((input) => input.addEventListener('input', () => { const draft = state.v3EndpointDraft; if (!draft) return; const field = input.dataset.v3EndpointDraft as 'title' | 'description' | 'protocol' | 'healthPath'; (draft as any)[field] = input.value; resolveEndpointBoundField('service', field); markEndpointReviewModified('service') }))
  endpointForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-v3-endpoint-draft]').forEach((input) => input.addEventListener('change', () => renderDecisionPanel()))
  endpointForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-v3-endpoint-route]').forEach((input) => input.addEventListener('input', () => { const route = state.v3EndpointDraft?.routes[state.v3EndpointReviewIndex - 1]; if (!route) return; const field = input.dataset.v3EndpointRoute || ''; (route as any)[field] = field === 'maxChargePerInvocationAtomic' ? Math.max(0, Number(input.value || 0)) : input.value; resolveEndpointBoundField(`route:${route.routeId}`, field); markEndpointReviewModified(`route:${route.routeId}`) }))
  endpointForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-v3-endpoint-route]').forEach((input) => input.addEventListener('change', () => renderDecisionPanel()))
  endpointForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-v3-endpoint-price]').forEach((input) => input.addEventListener('input', () => { const route = state.v3EndpointDraft?.routes[state.v3EndpointReviewIndex - 1]; const index = Number(input.dataset.priceIndex || 0); const price = route?.pricing[index]; if (!route || !price) return; const field = input.dataset.v3EndpointPrice || ''; (price as any)[field] = ['rateAtomic','per'].includes(field) ? Math.max(field === 'per' ? 1 : 0, Number(input.value || 0)) : input.value; resolveEndpointBoundField(`route:${route.routeId}`, field, index); markEndpointReviewModified(`route:${route.routeId}`) }))
  endpointForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-v3-endpoint-price]').forEach((input) => input.addEventListener('change', () => renderDecisionPanel()))
  action('endpoint-price-add', () => { const route = state.v3EndpointDraft?.routes[state.v3EndpointReviewIndex - 1]; if (!route) return; route.pricing.push({ dimension: 'request', rateAtomic: 0, per: 1, meterSource: 'gateway', chargeOn: 'started' }); markEndpointReviewModified(`route:${route.routeId}`); renderDecisionPanel() })
  endpointForm?.querySelectorAll<HTMLButtonElement>('[data-v3-endpoint-price-remove]').forEach((button) => button.addEventListener('click', () => { const route = state.v3EndpointDraft?.routes[state.v3EndpointReviewIndex - 1]; if (!route || route.pricing.length <= 1) return; route.pricing.splice(Number(button.dataset.v3EndpointPriceRemove || 0), 1); markEndpointReviewModified(`route:${route.routeId}`); renderDecisionPanel() }))
  action('endpoint-route-add', () => { const draft = state.v3EndpointDraft; if (!draft) return; const routeId = `local-${crypto.randomUUID()}`; draft.routes.push({ routeId, operationId: `operation_${draft.routes.length + 1}`, method: 'POST', path: `/operation-${draft.routes.length + 1}`, displayName: 'New operation', pricing: [{ dimension: 'request', rateAtomic: 0, per: 1, meterSource: 'gateway', chargeOn: 'started' }], maxChargePerInvocationAtomic: 0 }); state.v3EndpointReviewIndex = draft.routes.length; state.v3EndpointReviewStatus[`route:${routeId}`] = 'modified'; state.v3EndpointDraftDirty = true; renderDecisionPanel() })
  action('endpoint-route-remove', () => { const draft = state.v3EndpointDraft; const index = state.v3EndpointReviewIndex - 1; if (!draft || index < 0 || draft.routes.length <= 1) return; const [removed] = draft.routes.splice(index, 1); delete state.v3EndpointReviewStatus[`route:${removed.routeId}`]; state.v3EndpointReviewIndex = Math.max(0, index); state.v3EndpointDraftDirty = true; state.v3EndpointProbe = undefined; renderDecisionPanel() })
  endpointUnresolvedForReview(state.v3EndpointReviewIndex === 0 ? 'service' : `route:${state.v3EndpointDraft?.routes[state.v3EndpointReviewIndex - 1]?.routeId}`).filter((path) => !endpointPathField(path)).forEach((path) => { const warning = endpointForm?.querySelector<HTMLElement>('.v3-api-review-warning'); const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost v3-api-explicit-resolution'; button.textContent = `Mark handled: ${path}`; button.addEventListener('click', () => { if (state.v3EndpointDraft) state.v3EndpointDraft.unresolvedFields = (state.v3EndpointDraft.unresolvedFields || []).filter((item) => item !== path); const id = state.v3EndpointReviewIndex === 0 ? 'service' : `route:${state.v3EndpointDraft?.routes[state.v3EndpointReviewIndex - 1]?.routeId}`; markEndpointReviewModified(id); renderDecisionPanel() }); warning?.append(button) })
  action('endpoint-draft-save', () => void run(async () => { const previous = new Map(endpointReviewIDs().map((id) => [endpointReviewFingerprint(id), state.v3EndpointReviewStatus[id]])); const result = await invoke<{ draft: V3APIBridgeDraft }>('provider_api_bridge_draft_save', { input: currentV3EndpointDraft() }); applyV3EndpointDraft(result.draft); state.v3EndpointDraftMaterialFingerprint = recordV3AgentMaterialReceipt('endpoint', state.v3EndpointDraftId, result.draft.version, state.v3EndpointMaterials); state.v3EndpointRequiredDraftVersion = result.draft.version; endpointReviewIDs().forEach((id) => { const status = previous.get(endpointReviewFingerprint(id)); if (status) state.v3EndpointReviewStatus[id] = status }); state.v3EndpointConfirmed = endpointReviewIDs().filter((id) => state.v3EndpointReviewStatus[id] === 'confirmed'); persistEndpointReview(); renderDecisionPanel() }))
  endpointForm?.querySelectorAll<HTMLInputElement>('[data-v3-endpoint-attest]').forEach((input) => input.addEventListener('change', () => { if (input.dataset.v3EndpointAttest === 'pricing') state.v3EndpointAttestPricing = input.checked; if (input.dataset.v3EndpointAttest === 'runtime') state.v3EndpointAttestRuntime = input.checked; if (input.dataset.v3EndpointAttest === 'rights') state.v3EndpointAttestRights = input.checked; syncEndpointForm(); renderDecisionPanel() }))
  endpointForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[name="localBaseUrl"], select[name="authType"], input[name="secret"], input[name="apiKeyHeader"], input[name="basicUsername"], input[name="timeoutSeconds"], input[name="concurrency"]').forEach((input) => input.addEventListener('change', () => { syncEndpointForm(); state.v3EndpointProbe = undefined; state.v3EndpointRouteTestResult = undefined; clearV3ApplicationAttempt('endpoint'); renderDecisionPanel() }))
  endpointForm?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[name^="routeTest"], textarea[name="routeTestBody"]').forEach((input) => input.addEventListener('change', () => { syncEndpointForm(); state.v3EndpointRouteTestResult = undefined; renderDecisionPanel() }))
  action('endpoint-route-test', () => void run(async () => { syncEndpointForm(); const draft = state.v3EndpointDraft; const route = draft?.routes[state.v3EndpointReviewIndex - 1] || draft?.routes[0]; if (!draft || !route) throw new Error('Select a reviewed Route first.'); if (['POST','PUT','PATCH','DELETE'].includes(route.method) && !state.v3EndpointRouteTestDangerConfirmed) throw new Error(`Confirm that the ${route.method} smoke test may change local state.`); const endpointId = `epd_${state.v3EndpointDraftId.replace(/^apid_/, '')}`; const routes = draft.routes.map((item) => ({ operationId: item.operationId, method: item.method, path: item.path })); const result = await invoke<{ result: typeof state.v3EndpointRouteTestResult }>('provider_endpoint_test_route', { input: { endpointId, localBaseUrl: state.v3EndpointLocalURL, healthPath: draft.healthPath, routes, timeoutSeconds: state.v3EndpointTimeout, concurrency: state.v3EndpointConcurrency, route: { operationId: route.operationId, method: route.method, path: route.path }, testPath: state.v3EndpointRouteTestPath || route.path, rawQuery: state.v3EndpointRouteTestQuery, contentType: state.v3EndpointRouteTestContentType, body: state.v3EndpointRouteTestBody, authType: state.v3EndpointAuthType, apiKeyHeader: state.v3EndpointAPIKeyHeader, secret: endpointCredentialSecret() } }); state.v3EndpointRouteTestResult = result.result; renderDecisionPanel() }))
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
      const routes = draft.routes.map((route) => ({ operationId: route.operationId, method: route.method, path: route.path }))
      const result = await invoke<{ status: { healthy: boolean; status?: number; latencyMs?: number; contentType?: string; checkedAt?: string; error?: string; routeFingerprint?: string } }>('provider_endpoint_probe', { input: { endpointId, localBaseUrl: state.v3EndpointLocalURL, healthPath: draft.healthPath, routes, authType: state.v3EndpointAuthType, apiKeyHeader: state.v3EndpointAPIKeyHeader, secret: endpointCredentialSecret(), timeoutSeconds: state.v3EndpointTimeout, concurrency: state.v3EndpointConcurrency } })
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
      if (state.v3EndpointAuthType !== 'none' && !endpointCredentialSecret()) throw new Error('Configure the provider credential before submitting to Listings.')
      if (!state.v3EndpointAttestPricing || !state.v3EndpointAttestRuntime || !state.v3EndpointAttestRights) throw new Error('Accept all three seller confirmations before submitting to Listings.')
      state.v3EndpointSubmitting = true
      renderDecisionPanel()
      try {
        const endpointId = `epd_${state.v3EndpointDraftId.replace(/^apid_/, '')}`
        const routes = draft.routes.map((route) => ({ operationId: route.operationId, method: route.method, path: route.path }))
        const reviewReceipt = endpointReviewIDs().map((id) => ({ id, fingerprint: endpointReviewFingerprint(id) }))
        const attemptFingerprint = JSON.stringify({ draftId: draft.draftId, draftVersion: draft.version, reviewReceipt, localBaseUrl: state.v3EndpointLocalURL, healthPath: draft.healthPath, authType: state.v3EndpointAuthType, apiKeyHeader: state.v3EndpointAPIKeyHeader, timeoutSeconds: state.v3EndpointTimeout, concurrency: state.v3EndpointConcurrency })
        state.v3EndpointSaveAttemptKey = v3StableApplicationAttempt('endpoint', attemptFingerprint)
        await invoke('provider_endpoint_local_save', { input: { endpointId, localBaseUrl: state.v3EndpointLocalURL, healthPath: draft.healthPath, routes, authType: state.v3EndpointAuthType, lastProbeHealthy: true, lastProbeAt: state.v3EndpointProbe.checkedAt, timeoutSeconds: state.v3EndpointTimeout, concurrency: state.v3EndpointConcurrency } })
        const imported = await invoke<{ product: V3Product; listing: V3Listing }>('provider_endpoint_import', { input: { idempotencyKey: state.v3EndpointSaveAttemptKey, endpointId, draftId: draft.draftId, draftVersion: draft.version, reviewReceipt, authType: state.v3EndpointAuthType, apiKeyHeader: state.v3EndpointAPIKeyHeader, secret: endpointCredentialSecret(), price: { model: 'metered', currency: 'USDC' }, limits: { timeoutSeconds: state.v3EndpointTimeout, concurrency: state.v3EndpointConcurrency }, localConnectivityPassed: true, sellerAttestationConfirmed: true } })
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
    if (confirm) confirm.disabled = apiBridgeUnresolvedForReview(id).length > 0
    const readiness = apiForm?.querySelector<HTMLElement>('[data-v3-readiness-target="review"]')
    readiness?.classList.remove('passed')
    const readinessIcon = readiness?.querySelector<HTMLElement>(':scope > span')
    const readinessDetail = readiness?.querySelector<HTMLElement>('small')
    if (readinessIcon) readinessIcon.textContent = '!'
    if (readinessDetail) readinessDetail.textContent = 'Edited item must be confirmed again'
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
  const activeReviewID = state.v3APIReviewIndex === 0 ? 'service' : state.v3APIRoutes[state.v3APIReviewIndex - 1] ? `route:${state.v3APIRoutes[state.v3APIReviewIndex - 1].routeId}` : ''
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
        ? ['service', ...state.v3APIRoutes.map((route) => `route:${route.routeId}`)].findIndex((id) => state.v3APIReviewStatus[id] !== 'confirmed')
        : value === 'warnings'
          ? ['service', ...state.v3APIRoutes.map((route) => `route:${route.routeId}`)].findIndex((id) => apiBridgeUnresolvedForReview(id).length > 0)
          : state.v3APIReviewIndex
      if (nextIndex >= 0) state.v3APIReviewIndex = nextIndex
      rerenderV3APIKeepingSecret(apiForm)
    }
    filter.addEventListener('click', select)
    filter.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select() } })
  })
  const apiReviewComplete = state.v3APIDraftVersion > 0 && state.v3APIReviewStatus.service === 'confirmed' && state.v3APIRoutes.every((route) => state.v3APIReviewStatus[`route:${route.routeId}`] === 'confirmed')
  if (!apiReviewComplete) apiForm?.querySelectorAll<HTMLInputElement>('[data-v3-attestation]').forEach((input) => { input.disabled = true })
  if (apiForm && !state.v3APIMaterialsLoaded) {
    state.v3APIMaterialsLoaded = true
    void Promise.all([
      invoke<{ files: V3APIMaterial[] }>('provider_api_bridge_materials_get', { input: { draftId: state.v3APIDraftId } }).catch(() => ({ files: [] })),
      invoke<{ draft: V3APIBridgeDraft }>('provider_api_bridge_draft_get', { input: { draftId: state.v3APIDraftId } }).catch(() => undefined),
    ]).then(([materialsResult, draftResult]) => {
      state.v3APIMaterials = materialsResult.files || []
      if (draftResult?.draft) {
        applyV3APIBridgeDraft(draftResult.draft)
        state.v3APIDraftMaterialFingerprint = restoreV3AgentMaterialReceipt('api_bridge', state.v3APIDraftId, draftResult.draft.version, state.v3APIMaterials)
        state.v3APIRequiredDraftVersion = state.v3APIDraftMaterialFingerprint ? draftResult.draft.version : draftResult.draft.version + 1
      }
      renderDecisionPanel()
    })
  }
  action('api-materials-add', () => void run(async () => { localStorage.setItem('exora.apiBridgeDraftId', state.v3APIDraftId); const result = await invoke<{ files: V3APIMaterial[]; canceled?: boolean; discovery?: { title?: string; description?: string; baseUrl?: string; operations?: Array<{ operationId: string; method: string; path: string; displayName: string }> } }>('provider_api_bridge_materials_choose', { input: { draftId: state.v3APIDraftId } }); if (!result.canceled) { state.v3APIMaterials = result.files || []; invalidateV3AgentMaterials('api_bridge') }; if (!result.canceled && result.discovery && !state.v3APIDraftVersion) { state.v3APITitle ||= result.discovery.title || ''; state.v3APIDescription ||= result.discovery.description || ''; state.v3APIBaseURL ||= result.discovery.baseUrl || ''; if (!state.v3APIRoutes.length) state.v3APIRoutes = (result.discovery.operations || []).map((route, index) => ({ id: `discovered-${index}`, routeId: `local-${crypto.randomUUID()}`, operationId: route.operationId, method: route.method, path: route.path, title: route.displayName, selected: true, price: 0, pricing: [{ dimension: 'request', rateAtomic: 0, per: 1, meterSource: 'gateway', chargeOn: 'started' }], maxChargePerInvocationAtomic: 0 })) }; renderDecisionPanel() }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-api-material-remove]').forEach((button) => button.addEventListener('click', () => void run(async () => { const result = await invoke<{ files: V3APIMaterial[] }>('provider_api_bridge_material_remove', { input: { draftId: state.v3APIDraftId, id: button.dataset.v3ApiMaterialRemove } }); state.v3APIMaterials = result.files || []; invalidateV3AgentMaterials('api_bridge'); renderDecisionPanel() })))
  action('api-prompt-copy', () => void navigator.clipboard.writeText(apiBridgeAgentPrompt()).then(() => showToast('Agent Prompt copied.')))
  action('api-prompt-regenerate', () => { renderDecisionPanel(); showToast('Agent Prompt refreshed with the current files and draft version.') })
  action('api-draft-check', () => void run(async () => {
    if (!state.v3APIMaterials.length) throw new Error('Add at least one supported document before checking the Agent draft.')
    const materialRevisionChanged = !v3AgentMaterialsCurrent('api_bridge')
    const result = await invoke<{ draft: V3APIBridgeDraft }>('provider_api_bridge_draft_get', { input: { draftId: state.v3APIDraftId } })
    if (result.draft.version < state.v3APIRequiredDraftVersion) throw new Error(`The Agent draft is stale. Save version ${state.v3APIRequiredDraftVersion} or newer for the current materials.`)
    applyV3APIBridgeDraft(result.draft)
    if (materialRevisionChanged) {
      state.v3APIReviewStatus = Object.fromEntries(['service', ...state.v3APIRoutes.map((route) => `route:${route.routeId}`)].map((id) => [id, 'pending']))
      persistAPIBridgeReview()
    }
    state.v3APIDraftMaterialFingerprint = recordV3AgentMaterialReceipt('api_bridge', state.v3APIDraftId, result.draft.version, state.v3APIMaterials)
    state.v3APIRequiredDraftVersion = result.draft.version
    state.v3APIStep = 2
    renderDecisionPanel()
  }))
  action('api-draft-save', () => void run(async () => {
    syncV3APIDraftFromForm(apiForm)
    const previousReview = new Map(Object.keys(state.v3APIReviewStatus).map((id) => [apiBridgeReviewFingerprint(id), state.v3APIReviewStatus[id]]))
    const result = await invoke<{ draft: V3APIBridgeDraft }>('provider_api_bridge_draft_save', { input: currentV3APIBridgeDraft() })
    applyV3APIBridgeDraft(result.draft)
    state.v3APIDraftMaterialFingerprint = recordV3AgentMaterialReceipt('api_bridge', state.v3APIDraftId, result.draft.version, state.v3APIMaterials)
    state.v3APIRequiredDraftVersion = result.draft.version
    for (const id of ['service', ...state.v3APIRoutes.map((route) => `route:${route.routeId}`)]) {
      const previous = previousReview.get(apiBridgeReviewFingerprint(id))
      if (previous) state.v3APIReviewStatus[id] = previous
    }
    persistAPIBridgeReview()
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-review-index]').forEach((button) => button.addEventListener('click', () => { state.v3APIReviewIndex = Number(button.dataset.v3ReviewIndex || 0); rerenderV3APIKeepingSecret(apiForm) }))
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-review-previous]')?.addEventListener('click', () => { state.v3APIReviewIndex = Math.max(0, state.v3APIReviewIndex - 1); rerenderV3APIKeepingSecret(apiForm) })
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-review-next]')?.addEventListener('click', () => { state.v3APIReviewIndex = Math.min(state.v3APIRoutes.length, state.v3APIReviewIndex + 1); rerenderV3APIKeepingSecret(apiForm) })
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-review-confirm]')?.addEventListener('click', (event) => { const id = (event.currentTarget as HTMLButtonElement).dataset.v3ReviewConfirm || ''; if (id && apiBridgeUnresolvedForReview(id).length === 0) { state.v3APIReviewStatus[id] = 'confirmed'; persistAPIBridgeReview(); state.v3APIReviewIndex = Math.min(state.v3APIRoutes.length, state.v3APIReviewIndex + 1) }; rerenderV3APIKeepingSecret(apiForm) })
  apiForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-v3-api-draft]').forEach((input) => input.addEventListener('input', () => {
    syncV3APIDraftFromForm(apiForm)
    resolveAPIBridgeBoundField('service', input.getAttribute('data-v3-api-draft') || '')
    markAPIReviewModified('service')
    if (input.getAttribute('data-v3-api-draft') === 'baseUrl' || input.getAttribute('data-v3-api-draft') === 'healthPath') invalidateProbe()
  }))
  apiForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-v3-api-draft]').forEach((input) => input.addEventListener('change', () => rerenderV3APIKeepingSecret(apiForm)))
  const apiAuth = apiForm?.querySelector<HTMLSelectElement>('select[name="authType"]')
  apiAuth?.addEventListener('change', () => { invalidateProbe(); state.v3APICredentialConfigured = apiAuth.value === 'none'; rerenderV3APIKeepingSecret(apiForm) })
  const credentialInput = apiForm?.querySelector<HTMLInputElement>('input[name="secret"]')
  credentialInput?.addEventListener('input', (event) => { state.v3APICredentialConfigured = Boolean((event.currentTarget as HTMLInputElement).value); invalidateProbe() })
  credentialInput?.addEventListener('change', () => rerenderV3APIKeepingSecret(apiForm))
  apiForm?.querySelector<HTMLInputElement>('input[name="basicUsername"]')?.addEventListener('input', (event) => { state.v3APIBasicUsername = (event.currentTarget as HTMLInputElement).value; invalidateProbe() })
  apiForm?.querySelector<HTMLInputElement>('input[name="apiKeyHeader"]')?.addEventListener('input', (event) => { state.v3APIKeyHeader = (event.currentTarget as HTMLInputElement).value; invalidateProbe() })
  apiForm?.querySelector<HTMLInputElement>('input[name="basicUsername"]')?.addEventListener('change', () => rerenderV3APIKeepingSecret(apiForm))
  apiForm?.querySelector<HTMLInputElement>('input[name="apiKeyHeader"]')?.addEventListener('change', () => rerenderV3APIKeepingSecret(apiForm))
  apiForm?.querySelectorAll<HTMLInputElement>('[data-v3-attestation]').forEach((input) => input.addEventListener('change', () => { if (input.dataset.v3Attestation === 'pricing') state.v3APIAttestPricing = input.checked; if (input.dataset.v3Attestation === 'usage') state.v3APIAttestUsage = input.checked; if (input.dataset.v3Attestation === 'rights') state.v3APIAttestRights = input.checked; state.v3APISellerAttestation = state.v3APIAttestPricing && state.v3APIAttestUsage && state.v3APIAttestRights; rerenderV3APIKeepingSecret(apiForm) }))
  action('api-edit-service', () => { state.v3APIReviewIndex = 0; rerenderV3APIKeepingSecret(apiForm); fields.actionView.querySelector('.v3-api-review-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-readiness-target]').forEach((button) => button.addEventListener('click', () => { const target = button.dataset.v3ReadinessTarget; if (target === 'review') { state.v3APIReviewIndex = Math.max(0, state.v3APIReviewIndex); rerenderV3APIKeepingSecret(apiForm); fields.actionView.querySelector('.v3-api-review-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return }; fields.actionView.querySelector('.v3-api-publish-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (target === 'credential') window.setTimeout(() => fields.actionView.querySelector<HTMLInputElement>('input[name="secret"]')?.focus(), 250) }))
  action('api-route-add', () => {
    syncV3APIDraftFromForm(apiForm)
    const index = state.v3APIRoutes.length + 1
    const routeId = `local-${crypto.randomUUID()}`
    state.v3APIRoutes.push({ id: routeId, routeId, operationId: `operation${index}`, method: state.v3APIProtocol === 'sse' ? 'GET' : 'POST', path: state.v3APIProtocol === 'sse' ? `/events-${index}` : `/operation-${index}`, title: `Operation ${index}`, selected: true, price: state.v3APIDefaultPrice, pricing: [{ dimension: 'request', rateAtomic: Math.round(state.v3APIDefaultPrice * 1_000_000), per: 1, meterSource: 'gateway', chargeOn: 'started' }], maxChargePerInvocationAtomic: 0 })
    state.v3APIReviewStatus[`route:${routeId}`] = 'pending'
    state.v3APIDraftDirty = true
    clearV3ApplicationAttempt('api_bridge')
    invalidateProbe()
    persistAPIBridgeReview()
    rerenderV3APIKeepingSecret(apiForm)
  })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-api-route-remove]').forEach((button) => button.addEventListener('click', () => {
    const removed = state.v3APIRoutes.find((route) => route.id === button.dataset.v3ApiRouteRemove)
    state.v3APIRoutes = state.v3APIRoutes.filter((route) => route.id !== button.dataset.v3ApiRouteRemove)
    if (removed) delete state.v3APIReviewStatus[`route:${removed.routeId}`]
    state.v3APIDraftDirty = true
    persistAPIBridgeReview()
    invalidateProbe()
    rerenderV3APIKeepingSecret(apiForm)
  }))
  fields.actionView.querySelectorAll<HTMLSelectElement>('[data-v3-api-route-method]').forEach((input) => input.addEventListener('change', () => {
    const route = state.v3APIRoutes.find((item) => item.id === input.dataset.v3ApiRouteMethod)
    if (route) { route.method = input.value.toUpperCase(); resolveAPIBridgeBoundField(`route:${route.routeId}`, 'method'); markAPIReviewModified(`route:${route.routeId}`) }
    rerenderV3APIKeepingSecret(apiForm)
  }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-api-route-title]').forEach((input) => input.addEventListener('input', () => {
    const route = state.v3APIRoutes.find((item) => item.id === input.dataset.v3ApiRouteTitle)
    if (route) { route.title = input.value; route.operationId = input.value.trim().replace(/[^a-zA-Z0-9]+(.)/g, (_, character: string) => character.toUpperCase()).replace(/^[^a-zA-Z_]+/, '') || route.operationId; resolveAPIBridgeBoundField(`route:${route.routeId}`, 'displayName'); resolveAPIBridgeBoundField(`route:${route.routeId}`, 'title'); markAPIReviewModified(`route:${route.routeId}`) }
  }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-api-route-title]').forEach((input) => input.addEventListener('change', () => rerenderV3APIKeepingSecret(apiForm)))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-api-route-operation]').forEach((input) => input.addEventListener('input', () => { const route = state.v3APIRoutes.find((item) => item.id === input.dataset.v3ApiRouteOperation); if (route) { route.operationId = input.value.trim(); resolveAPIBridgeBoundField(`route:${route.routeId}`, 'operationId'); markAPIReviewModified(`route:${route.routeId}`) } }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-api-route-operation]').forEach((input) => input.addEventListener('change', () => rerenderV3APIKeepingSecret(apiForm)))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-api-route-path]').forEach((input) => input.addEventListener('input', () => {
    const route = state.v3APIRoutes.find((item) => item.id === input.dataset.v3ApiRoutePath)
    if (route) { route.path = input.value.startsWith('/') ? input.value : `/${input.value}`; resolveAPIBridgeBoundField(`route:${route.routeId}`, 'path'); markAPIReviewModified(`route:${route.routeId}`) }
  }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-api-route-path]').forEach((input) => input.addEventListener('change', () => rerenderV3APIKeepingSecret(apiForm)))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-api-route-price]').forEach((input) => input.addEventListener('input', () => {
    const route = state.v3APIRoutes.find((item) => item.id === input.dataset.v3ApiRoutePrice)
    if (route) route.price = Math.max(0, Number(input.value || 0))
  }))
  const pricingTarget = (encoded?: string) => { const [routeId, rawIndex] = String(encoded || '').split(':'); const route = state.v3APIRoutes.find((item) => item.id === routeId); return { route, index: Number(rawIndex) } }
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-price-add]').forEach((button) => button.addEventListener('click', () => { const route = state.v3APIRoutes.find((item) => item.id === button.dataset.v3PriceAdd); if (route) { route.pricing ||= []; route.pricing.push({ dimension: 'request', rateAtomic: 0, per: 1, meterSource: 'gateway', chargeOn: 'started' }); markAPIReviewModified(`route:${route.routeId}`) }; rerenderV3APIKeepingSecret(apiForm) }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-price-remove]').forEach((button) => button.addEventListener('click', () => { const { route, index } = pricingTarget(button.dataset.v3PriceRemove); if (route?.pricing) { route.pricing.splice(index, 1); markAPIReviewModified(`route:${route.routeId}`) }; rerenderV3APIKeepingSecret(apiForm) }))
  fields.actionView.querySelectorAll<HTMLSelectElement>('[data-v3-price-dimension]').forEach((input) => input.addEventListener('change', () => { const { route, index } = pricingTarget(input.dataset.v3PriceDimension); const component = route?.pricing?.[index]; if (component && route) { component.dimension = input.value as V3APIPricingComponent['dimension']; component.meterSource = component.dimension === 'provider_reported' ? 'provider_response' : 'gateway'; resolveAPIBridgeBoundField(`route:${route.routeId}`, 'dimension', index); markAPIReviewModified(`route:${route.routeId}`) }; rerenderV3APIKeepingSecret(apiForm) }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-price-usdc]').forEach((input) => input.addEventListener('input', () => { const { route, index } = pricingTarget(input.dataset.v3PriceUsdc); if (route?.pricing?.[index]) { route.pricing[index].rateAtomic = Math.max(0, Math.round(Number(input.value || 0) * 1_000_000)); resolveAPIBridgeBoundField(`route:${route.routeId}`, 'rateAtomic', index); markAPIReviewModified(`route:${route.routeId}`) } }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-price-rate]').forEach((input) => input.addEventListener('input', () => { const { route, index } = pricingTarget(input.dataset.v3PriceRate); if (route?.pricing?.[index]) { route.pricing[index].rateAtomic = Math.max(0, Math.round(Number(input.value || 0))); resolveAPIBridgeBoundField(`route:${route.routeId}`, 'rateAtomic', index); markAPIReviewModified(`route:${route.routeId}`) } }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-price-per]').forEach((input) => input.addEventListener('input', () => { const { route, index } = pricingTarget(input.dataset.v3PricePer); if (route?.pricing?.[index]) { route.pricing[index].per = Math.max(1, Math.round(Number(input.value || 1))); resolveAPIBridgeBoundField(`route:${route.routeId}`, 'per', index); markAPIReviewModified(`route:${route.routeId}`) } }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-price-selector]').forEach((input) => input.addEventListener('input', () => { const { route, index } = pricingTarget(input.dataset.v3PriceSelector); if (route?.pricing?.[index]) { route.pricing[index].selector = input.value.trim(); resolveAPIBridgeBoundField(`route:${route.routeId}`, 'selector', index); markAPIReviewModified(`route:${route.routeId}`) } }))
  fields.actionView.querySelectorAll<HTMLSelectElement>('[data-v3-price-meter-source]').forEach((input) => input.addEventListener('change', () => { const { route, index } = pricingTarget(input.dataset.v3PriceMeterSource); if (route?.pricing?.[index]) { route.pricing[index].meterSource = input.value; resolveAPIBridgeBoundField(`route:${route.routeId}`, 'meterSource', index); markAPIReviewModified(`route:${route.routeId}`) }; rerenderV3APIKeepingSecret(apiForm) }))
  fields.actionView.querySelectorAll<HTMLSelectElement>('[data-v3-price-charge-on]').forEach((input) => input.addEventListener('change', () => { const { route, index } = pricingTarget(input.dataset.v3PriceChargeOn); if (route?.pricing?.[index]) { route.pricing[index].chargeOn = input.value; resolveAPIBridgeBoundField(`route:${route.routeId}`, 'chargeOn', index); markAPIReviewModified(`route:${route.routeId}`) }; rerenderV3APIKeepingSecret(apiForm) }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-max-charge]').forEach((input) => input.addEventListener('input', () => { const route = state.v3APIRoutes.find((item) => item.id === input.dataset.v3MaxCharge); if (route) { route.maxChargePerInvocationAtomic = Math.max(0, Math.round(Number(input.value || 0))); resolveAPIBridgeBoundField(`route:${route.routeId}`, 'maxChargePerInvocationAtomic'); markAPIReviewModified(`route:${route.routeId}`) } }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-max-charge-usdc]').forEach((input) => input.addEventListener('input', () => { const route = state.v3APIRoutes.find((item) => item.id === input.dataset.v3MaxChargeUsdc); if (route) { route.maxChargePerInvocationAtomic = Math.max(0, Math.round(Number(input.value || 0) * 1_000_000)); resolveAPIBridgeBoundField(`route:${route.routeId}`, 'maxChargePerInvocationAtomic'); markAPIReviewModified(`route:${route.routeId}`) } }))
  fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-price-usdc], [data-v3-price-rate], [data-v3-price-per], [data-v3-price-selector], [data-v3-max-charge], [data-v3-max-charge-usdc]').forEach((input) => input.addEventListener('change', () => rerenderV3APIKeepingSecret(apiForm)))
  action('api-probe', () => void run(async () => {
    syncV3APIDraftFromForm(apiForm)
    const secret = apiForm?.querySelector<HTMLInputElement>('input[name="secret"]')?.value || ''
    if (!state.v3APIBaseURL) throw new Error('Enter the public HTTPS Base URL first.')
    if (state.v3APIAuthType === 'basic' && !state.v3APIBasicUsername.trim()) throw new Error('Enter the Provider username first.')
    if (state.v3APIAuthType !== 'none' && !secret) throw new Error('Enter the Provider credential first.')
    state.v3APIProbe = undefined
    state.v3APIProbing = true
    rerenderV3APIKeepingSecret(apiForm)
    try {
      const providerSecret = state.v3APIAuthType === 'basic' ? `${state.v3APIBasicUsername}:${secret}` : secret
      state.v3APIProbe = await invoke<V3APIProbe>('provider_api_probe', { input: { baseUrl: state.v3APIBaseURL, healthPath: state.v3APIHealthPath, authType: state.v3APIAuthType, apiKeyHeader: state.v3APIKeyHeader, secret: providerSecret } })
      state.v3APIProbe.checkedAt = new Date().toISOString()
      if (!state.v3APIProbe.ok) state.v3APIProbe.error = `${state.v3APIProbe.error || 'Connection check failed'} · HTTP ${state.v3APIProbe.status || 0} · ${state.v3APIProbe.latencyMs || 0} ms · ${state.v3APIProbe.contentType || 'unknown content type'} · ${new Date(state.v3APIProbe.checkedAt).toLocaleString()}`
    } catch (error) {
      state.v3APIProbe = { ok: false, error: `${humanizeError(error)} · checked ${new Date().toLocaleString()}`, checkedAt: new Date().toISOString() }
      throw error
    } finally {
      state.v3APIProbing = false
      renderDecisionPanel()
      const nextSecret = fields.actionView.querySelector<HTMLInputElement>('[data-v3-form="api_bridge"] input[name="secret"]')
      if (nextSecret) nextSecret.value = secret
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
    void invoke('provider_environment_update_storage', { input: { rootPath: state.v3EnvironmentRoot, workspaceGiB: state.v3EnvironmentWorkspaceGiB, pricing: { baseFee: state.v3BaseFee, baseFeeEnabled: state.v3BaseFeeEnabled, pricePerMinute: state.v3PricePerMinute, minimumMinutes: state.v3MinimumMinutes, longDiscountAfterMinutes: state.v3LongDiscountAfterMinutes, longDiscountPercent: state.v3LongDiscountPercent, longDiscountMinimumPricePercent: state.v3LongDiscountMinimumPricePercent, longDiscountEnabled: state.v3LongDiscountEnabled } } }).catch((error) => {
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
    void invoke('provider_environment_update_storage', { input: { rootPath: state.v3EnvironmentRoot, workspaceGiB: state.v3EnvironmentWorkspaceGiB, pricing: { baseFee: state.v3BaseFee, baseFeeEnabled: state.v3BaseFeeEnabled, pricePerMinute: state.v3PricePerMinute, minimumMinutes: state.v3MinimumMinutes, longDiscountAfterMinutes: state.v3LongDiscountAfterMinutes, longDiscountPercent: state.v3LongDiscountPercent, longDiscountMinimumPricePercent: state.v3LongDiscountMinimumPricePercent, longDiscountEnabled: state.v3LongDiscountEnabled } } }).catch((error) => {
      state.v3LongDiscountEnabled = previousEnabled
      state.v3LongDiscountPercent = previousPercent
      applyToggleState()
      showToast(humanizeError(error))
    })
  })
  const pricingInputs = fields.actionView.querySelectorAll<HTMLInputElement>('[data-v3-pricing]')
  pricingInputs.forEach((input) => input.addEventListener('input', () => {
    const value = Math.max(0, Number(input.value || 0))
    if (input.dataset.v3Pricing === 'baseFee') state.v3BaseFee = value
    if (input.dataset.v3Pricing === 'pricePerMinute') state.v3PricePerMinute = value
    if (input.dataset.v3Pricing === 'minimumMinutes') state.v3MinimumMinutes = Math.max(1, Math.round(value))
    if (input.dataset.v3Pricing === 'longDiscountAfterMinutes') state.v3LongDiscountAfterMinutes = Math.max(1, Math.round(value))
    if (input.dataset.v3Pricing === 'longDiscountPercent') state.v3LongDiscountPercent = Math.min(90, value)
    if (input.dataset.v3Pricing === 'longDiscountMinimumPricePercent') state.v3LongDiscountMinimumPricePercent = Math.max(1, Math.min(100, value))
    const hiddenPrice = fields.actionView.querySelector<HTMLInputElement>('[data-v3-form="vm"] input[name="price"]')
    if (hiddenPrice) hiddenPrice.value = String(state.v3PricePerMinute)
  }))
  pricingInputs.forEach((input) => input.addEventListener('change', () => void run(async () => {
    if (!(state.v3PricePerMinute > 0)) throw new Error('Minute price must be greater than zero.')
    if (!(state.v3MinimumMinutes >= 1)) throw new Error('Minimum minutes must be at least one.')
    if (state.v3LongDiscountEnabled && state.v3LongDiscountPercent <= 0) throw new Error('The tiered discount must add at least 1% at each interval.')
    if (state.v3LongDiscountEnabled && !(state.v3LongDiscountMinimumPricePercent >= 1 && state.v3LongDiscountMinimumPricePercent <= 100)) throw new Error('The tiered discount price floor must be between 1% and 100% of the normal minute price.')
    await invoke('provider_environment_update_storage', { input: { rootPath: state.v3EnvironmentRoot, workspaceGiB: state.v3EnvironmentWorkspaceGiB, pricing: { baseFee: state.v3BaseFee, baseFeeEnabled: state.v3BaseFeeEnabled, pricePerMinute: state.v3PricePerMinute, minimumMinutes: state.v3MinimumMinutes, longDiscountAfterMinutes: state.v3LongDiscountAfterMinutes, longDiscountPercent: state.v3LongDiscountPercent, longDiscountMinimumPricePercent: state.v3LongDiscountMinimumPricePercent, longDiscountEnabled: state.v3LongDiscountEnabled } } })
  })))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-image-cloud-unavailable]').forEach((button) => button.addEventListener('click', () => { state.v3SellerError = 'Link this Dock to Exora Cloud to download the signed Ubuntu and CUDA artifacts.'; state.v3EnvironmentCloudOpen = false; renderDecisionPanel() }))
  action('vm-probe', () => void run(async () => { if (navigator.userAgent.includes('Windows')) { state.v3HostScanning = true; renderDecisionPanel(); try { const scanned = await invoke<{ result: Record<string, unknown> }>('provider_host_scan'); state.v3VMProbe = scanned.result; state.v3EnvironmentImagesLoaded = false; await loadV3WindowsEnvironments() } catch (error) { if (humanizeError(error).includes('unknown desktop command')) throw new Error('Restart Exora Dock to activate the updated Windows provider bridge.'); throw error } finally { state.v3HostScanning = false; renderDecisionPanel() } return } const probe = await invoke<{ result: Record<string, unknown> }>('provider_vm_probe'); state.v3VMProbe = probe.result; const domains = await invoke<{ result: { domains?: Array<Record<string, unknown>> } }>('provider_vm_domains'); state.v3VMDomains = domains.result.domains || []; renderDecisionPanel() }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-image-pick]').forEach((button) => button.addEventListener('click', () => {
    state.v3SelectedEnvironmentImageId = button.dataset.v3ImagePick
    state.v3VMTemplate = undefined
    const installed = state.v3InstalledEnvironments.find((item) => item.attestation?.imageId === button.dataset.v3ImagePick && item.attestation?.status === 'ready')
    if (installed) state.v3VMTemplate = { ...installed.attestation.report, imageId: installed.attestation.imageId, imageVersion: installed.attestation.imageVersion, environmentId: installed.environmentId, valid: true, runtimeBackend: 'wsl2' }
    state.v3EnvironmentCloudOpen = false
    renderDecisionPanel()
  }))
  action('environment-save', () => void run(async () => {
    const image = state.v3EnvironmentImages.find((item) => item.imageId === state.v3SelectedEnvironmentImageId)
    if (!image) throw new Error('Choose an environment configuration first.')
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
      const installed = state.v3InstalledEnvironments.find((item) => item.attestation?.imageId === image.imageId && item.attestation?.imageVersion === image.version && item.attestation?.status === 'ready')
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
      const installed = state.v3InstalledEnvironments.find((item) => item.attestation?.imageId === card.dataset.v3ImageSelect && item.attestation?.status === 'ready')
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
    state.v3ResourceVersion = String(data.get('version') || '').trim()
    state.v3ResourceGrantHours = Math.max(1, Math.min(720, Number(data.get('grantHours') || 24)))
    state.v3ResourcePrice = Math.max(0, Number(data.get('price') || 0))
  }
  resourceForm?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[name="title"], input[name="version"], textarea[name="description"], input[name="grantHours"], input[name="price"]').forEach((input) => {
    input.addEventListener('input', syncResourceForm)
    input.addEventListener('change', () => { syncResourceForm(); renderDecisionPanel() })
  })
  action('choose-files', () => void run(async () => {
    state.v3AssetProgress = { phase: 'selecting', percent: 0 }
    renderDecisionPanel()
    try {
      const response = await invoke<{ canceled?: boolean; archive?: V3ResourceArchive; sources?: V3ResourceSource[] }>('provider_asset_choose_files')
      if (!response.canceled && response.archive) {
        clearV3ApplicationAttempt('resources')
        state.v3ResourceArchive = response.archive
        state.v3ResourceSources = response.sources || []
      }
    } finally {
      state.v3AssetProgress = undefined
      renderDecisionPanel()
    }
  }))
  action('resource-clear-files', () => void run(async () => {
    await invoke('provider_asset_clear_selection')
    state.v3ResourceArchive = undefined
    state.v3ResourceSources = []
    state.v3AssetProgress = undefined
    clearV3ApplicationAttempt('resources')
    renderDecisionPanel()
  }))
  fields.actionView.querySelector<HTMLFormElement>('[data-v3-form="vm"]')?.addEventListener('submit', (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; void run(async () => { if (!state.v3VMTemplate || !state.v3VMTemplate.valid) throw new Error('Install and validate the selected environment first.'); const data = Object.fromEntries(new FormData(form)); const windows = navigator.userAgent.includes('Windows'); if (windows) { const rescanned = await invoke<{ result: Record<string, unknown> }>('provider_host_scan', { input: { reason: 'pre_publish' } }); state.v3VMProbe = rescanned.result; renderDecisionPanel() } const price = { amount: Number(data.price), currency: 'USD', unit: 'minute' }; const hold = windows ? await invoke<Record<string, any>>('provider_environment_reserve', { input: { environmentId: state.v3VMTemplate.environmentId, workspaceGiB: Number(data.workspaceGiB) } }) : undefined; const selected = state.v3EnvironmentImages.find((image) => image.imageId === state.v3VMTemplate?.imageId); const hardware = state.v3VMProbe?.hardware as Record<string, any> || {}; const gpu = state.v3VMProbe?.gpu as Record<string, any> || {}; const network = state.v3VMProbe?.network as Record<string, any> || {}; const title = windows ? `${gpu.name || hardware.Cpu || 'Windows PC'} · ${selected?.manifest?.name || state.v3VMTemplate.imageId}` : String(data.title || 'Verified compute environment'); const description = windows ? `Verified ${selected?.manifest?.os?.distribution || 'Linux'} environment on ${gpu.name || hardware.Cpu || 'Windows hardware'} with ${Number(data.workspaceGiB)} GiB reserved workspace and ${network.downloadMbps || 0} Mbps measured download capacity.` : String(data.description || 'Verified compute environment'); const manifest = windows ? { runtimeBackend: 'wsl2', hostOS: 'windows', isolationClass: 'experimental_shared_host', capacityGuarantee: 'best_effort', gpuAccessMode: state.v3VMTemplate.cuda ? 'wsl_gpu_paravirtualization' : 'none', environmentImageId: state.v3VMTemplate.imageId, environmentImageVersion: state.v3VMTemplate.imageVersion, validationReceipt: state.v3VMTemplate, hardware, network, capacitySnapshot: hold?.capacity, diskReservation: hold?.reservation, price, limits: { minMinutes: 1, maxMinutes: 240 }, workspaceGiB: Number(data.workspaceGiB), region: [network.city, network.region, network.country].filter(Boolean).join(', ') } : { template: state.v3VMTemplate, price }; await v3CreateProductAndListing({ productKind: 'compute', title, description, manifest }, price, true, windows) }) })
  resourceForm?.addEventListener('submit', (event) => {
    event.preventDefault()
    void run(async () => {
      syncResourceForm()
      const archive = state.v3ResourceArchive
      if (!archive) throw new Error('Choose source files and wait for Dock to create the ZIP.')
      if (!state.v3ResourceTitle || !state.v3ResourceDescription || !state.v3ResourceVersion) throw new Error('Complete the Resource title, description, and version first.')
      if (!(state.v3ResourcePrice > 0) || state.v3ResourceGrantHours < 1) throw new Error('Configure a valid access window and price.')
      const price = { amount: state.v3ResourcePrice, currency: 'USD', unit: 'download' }
      const attemptFingerprint = JSON.stringify({ archiveToken: archive.token, title: state.v3ResourceTitle, description: state.v3ResourceDescription, version: state.v3ResourceVersion, license: state.v3ResourceLicense, grantHours: state.v3ResourceGrantHours, delivery: state.v3ResourceDelivery, price })
      const idempotencyKey = v3StableApplicationAttempt('resources', attemptFingerprint)
      state.v3ResourceSubmitting = true
      renderDecisionPanel()
      try {
        const created = await invoke<{ product: V3Product }>('provider_asset_create', { input: { productKind: 'download', title: state.v3ResourceTitle, description: state.v3ResourceDescription, idempotencyKey, manifest: { applicationSource: 'resources', version: state.v3ResourceVersion, license: state.v3ResourceLicense, grantHours: state.v3ResourceGrantHours, delivery: state.v3ResourceDelivery, archive: { format: 'zip', sizeBytes: archive.sizeBytes, sourceCount: archive.sourceCount }, price } } })
        archive.status = 'uploading'
        state.v3AssetProgress = { phase: 'uploading', percent: 0, completed: 0, total: 1 }
        renderDecisionPanel()
        await invoke('provider_asset_upload', { input: { bundleId: created.product.productId, fileToken: archive.token } })
        archive.status = 'verified'
        state.v3AssetProgress = undefined
        const saved = await invoke<{ listing: V3Listing }>('provider_listing_save', { input: { productId: created.product.productId, applicationSource: 'resources', idempotencyKey, status: 'draft', price, validation: { valid: true }, availability: { availableNow: false } } })
        state.v3ResourceArchive = undefined
        state.v3ResourceSources = []
        state.v3ResourceSubmitting = false
        state.v3SellerTab = 'listings'
        state.v3HighlightedListingId = saved.listing.listingId
        state.v3ExpandedListingId = saved.listing.listingId
        state.v3ListingsLoaded = false
        await loadV3Listings()
        clearV3ApplicationAttempt('resources')
      } catch (error) {
        if (archive.status === 'uploading') archive.status = 'failed'
        state.v3AssetProgress = undefined
        state.v3ResourceSubmitting = false
        renderDecisionPanel()
        throw error
      }
    })
  })
  apiForm?.addEventListener('submit', (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; void run(async () => {
    syncV3APIDraftFromForm(form)
    const data = Object.fromEntries(new FormData(form))
    if (!v3AgentMaterialsCurrent('api_bridge') || state.v3APIDraftDirty) throw new Error('Load, save, and review a fresh Agent draft for the current materials.')
    if (!state.v3APIProbe?.ok) throw new Error('Check the Health Path before submitting to Listings.')
    if (!state.v3APIAttestPricing || !state.v3APIAttestUsage || !state.v3APIAttestRights || state.v3APIUnresolvedFields.length) throw new Error('Resolve all fields and accept all three seller confirmations.')
    if (state.v3APIReviewStatus.service !== 'confirmed' || state.v3APIRoutes.some((route) => state.v3APIReviewStatus[`route:${route.routeId}`] !== 'confirmed')) throw new Error('Approve every Agent draft item before submitting to Listings.')
    if (state.v3APIAuthType !== 'none' && !data.secret) throw new Error('Configure the Provider credential.')
    if (state.v3APIAuthType === 'basic' && !state.v3APIBasicUsername.trim()) throw new Error('Configure the Provider username.')
    if (!state.v3APIRoutes.length) throw new Error('Expose at least one API route.')
    const secretInput = form.querySelector<HTMLInputElement>('input[name="secret"]')
    const providerSecret = state.v3APIAuthType === 'basic' ? `${state.v3APIBasicUsername}:${String(data.secret || '')}` : String(data.secret || '')
    const reviewReceipt = ['service', ...state.v3APIRoutes.map((route) => `route:${route.routeId}`)].map((id) => ({ id, fingerprint: apiBridgeReviewFingerprint(id) }))
    const materialFingerprint = v3MaterialFingerprint(state.v3APIMaterials)
    const attemptFingerprint = JSON.stringify({ draftId: state.v3APIDraftId, draftVersion: state.v3APIDraftVersion, materialFingerprint, reviewReceipt, authType: state.v3APIAuthType, apiKeyHeader: state.v3APIKeyHeader, price: { currency: 'USDC', pricingVersion: 1 } })
    state.v3APISaveAttemptKey = v3StableApplicationAttempt('api_bridge', attemptFingerprint)
    state.v3APISavingListing = true
    rerenderV3APIKeepingSecret(form)
    try {
      const finalized = await invoke<{ product: V3Product; listing: V3Listing }>('provider_api_bridge_finalize', { input: {
        idempotencyKey: state.v3APISaveAttemptKey,
        draftId: state.v3APIDraftId,
        draftVersion: state.v3APIDraftVersion,
        materialFingerprint,
        reviewReceipt,
        authType: state.v3APIAuthType,
        apiKeyHeader: state.v3APIKeyHeader,
        secret: providerSecret,
        price: { currency: 'USDC', pricingVersion: 1 },
        sellerAttestationConfirmed: true,
      } })
      if (secretInput) secretInput.value = ''
      state.v3APICredentialConfigured = state.v3APIAuthType === 'none'
      state.v3APIBasicUsername = ''
      state.v3APISavingListing = false
      state.v3HighlightedListingId = finalized.listing.listingId
      state.v3ExpandedListingId = finalized.listing.listingId
      state.v3ListingsLoaded = false
      state.v3SellerTab = 'listings'
      await loadV3Listings()
      clearV3ApplicationAttempt('api_bridge')
      showToast('Submitted to Listings — review the private draft before publishing')
      window.setTimeout(() => fields.actionView.querySelector<HTMLElement>(`[data-listing-row="${CSS.escape(finalized.listing.listingId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
    } catch (error) {
      state.v3APISavingListing = false
      renderDecisionPanel()
      const nextSecret = fields.actionView.querySelector<HTMLInputElement>('[data-v3-form="api_bridge"] input[name="secret"]')
      if (nextSecret) nextSecret.value = String(data.secret || '')
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
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-expand]').forEach((button) => button.addEventListener('click', () => { const id = button.dataset.v3ListingExpand; state.v3ExpandedListingId = state.v3ExpandedListingId === id ? undefined : id; state.v3PublishConfirmListingId = undefined; renderDecisionPanel() }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-source]').forEach((button) => button.addEventListener('click', () => { state.v3SellerTab = (button.dataset.v3ListingSource || 'vm') as V3SellerTab; renderDecisionPanel() }))
  const listingSearch = fields.actionView.querySelector<HTMLInputElement>('[data-v3-listing-search]')
  const listingSourceFilter = fields.actionView.querySelector<HTMLSelectElement>('[data-v3-listing-filter-source]')
  const listingStatusFilter = fields.actionView.querySelector<HTMLSelectElement>('[data-v3-listing-filter-status]')
  const applyListingFilters = () => {
    const query = listingSearch?.value.trim().toLocaleLowerCase() || ''
    const source = listingSourceFilter?.value || 'all'
    const status = listingStatusFilter?.value || 'all'
    const listings = Array.from(fields.actionView.querySelectorAll<HTMLElement>('.v3-listing-application'))
    let visible = 0
    listings.forEach((listing) => {
      const sourceMatches = source === 'all' || listing.dataset.listingSource === source
      const statusMatches = status === 'all' || (status === 'ready' ? listing.dataset.listingReady === 'true' && listing.dataset.listingStatus === 'draft' : status === 'attention' ? listing.dataset.listingAttention === 'true' : listing.dataset.listingStatus === status)
      const searchMatches = !query || (listing.dataset.listingSearch || '').includes(query)
      const matches = sourceMatches && statusMatches && searchMatches
      listing.classList.toggle('filtered-out', !matches)
      if (matches) visible += 1
    })
    const results = fields.actionView.querySelector<HTMLElement>('.v3-listing-results')
    if (results) results.textContent = `${visible} of ${listings.length} applications`
    fields.actionView.querySelector<HTMLElement>('.v3-listing-no-results')?.classList.toggle('hidden', visible > 0)
  }
  listingSearch?.addEventListener('input', applyListingFilters)
  listingSourceFilter?.addEventListener('change', applyListingFilters)
  listingStatusFilter?.addEventListener('change', applyListingFilters)
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-publish-request]').forEach((button) => button.addEventListener('click', () => { state.v3PublishConfirmListingId = button.dataset.v3PublishRequest; renderDecisionPanel() }))
  fields.actionView.querySelector<HTMLButtonElement>('[data-v3-publish-cancel]')?.addEventListener('click', () => { state.v3PublishConfirmListingId = undefined; renderDecisionPanel() })
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-recreate-source]').forEach((button) => button.addEventListener('click', () => {
    const source = (button.dataset.v3RecreateSource || 'vm') as V3ApplicationSource
    clearV3ApplicationAttempt(source)
    if (source === 'endpoint') state.v3EndpointSubmitting = false
    if (source === 'api_bridge') state.v3APISavingListing = false
    state.v3SellerTab = source
    state.v3HighlightedListingId = undefined
    state.v3ExpandedListingId = undefined
    showToast('Replacement started — the next submission will create a new private Listing draft')
    renderDecisionPanel()
  }))
  fields.actionView.querySelectorAll<HTMLButtonElement>('[data-v3-listing-action]').forEach((button) => button.addEventListener('click', () => void run(async () => { await invoke('provider_listing_action', { input: { listingId: button.dataset.listingId, action: button.dataset.v3ListingAction } }); state.v3PublishConfirmListingId = undefined; state.v3ListingsLoaded = false; await loadV3Listings() })))
}

function renderDecisionPanel() {
  renderViewTabs()
  const selected = selectedObjectForActiveView()
  const gpuDemoPanel = activeGpuDemoPanel()

  const showingResourceConsole = (state.activeView === 'chat' || state.activeView === 'work') && !state.pinStep && !gpuDemoPanel
  const showingActivityDetail = showingResourceConsole && Boolean(state.selectedV3ActivitySessionId)
  const showingChat = false
  const showingSettings = state.activeView === 'settings' && !state.pinStep
  const hideMainHeading = showingResourceConsole || (state.activeView === 'market' && !state.pinStep)
  const showingSellerSurfaceTabs = showingResourceConsole && state.workOrderSide === 'seller' && !showingActivityDetail
  fields.appShell.classList.toggle('resource-console-mode', showingResourceConsole)
  fields.appShell.classList.toggle('seller-surface-mode', showingSellerSurfaceTabs)
  fields.sellerSurfaceTabs.classList.toggle('hidden', !showingSellerSurfaceTabs)
  if (showingSellerSurfaceTabs) {
    syncV3SellerTabs()
    localize(fields.sellerSurfaceTabs)
  }
  if (!showingChat) renderTransactionDetailSidebar()
  fields.chatView.classList.toggle('hidden', !showingChat)
  fields.actionView.classList.toggle('hidden', showingChat || showingSettings)
  fields.settingsView.classList.toggle('hidden', !showingSettings)
  fields.mainKicker.classList.toggle('hidden', hideMainHeading)
  fields.decisionTitle.classList.toggle('hidden', hideMainHeading)
  fields.decisionStep.classList.toggle('hidden', state.activeView === 'market' || showingChat || showingSettings)

  if (showingResourceConsole) {
    fields.actionView.classList.remove('hidden')
    fields.mainKicker.textContent = showingActivityDetail ? 'Order history' : state.workOrderSide === 'buyer' ? 'AI-first catalog' : 'Provider control'
    fields.decisionTitle.textContent = showingActivityDetail ? (state.v3ActivityDetail?.productTitle || 'Order detail') : state.workOrderSide === 'buyer' ? 'Resource Market' : 'Seller Workbench'
    fields.decisionStep.textContent = showingActivityDetail ? 'detail' : state.workOrderSide === 'buyer' ? 'catalog' : state.v3SellerTab
    fields.decisionContent.innerHTML = showingActivityDetail ? renderV3ActivityDetail() : state.workOrderSide === 'buyer' ? renderV3BuyerSurface() : renderV3SellerSurface()
    attachV3SurfaceHandlers()
    ensureV3SurfaceData()
    renderContextStrip()
    localize(fields.actionView)
    return
  }

  if (showingChat) {
    renderChat()
    const sideLabel = state.workOrderSide === 'buyer' ? t('orderSide.buyer') : t('orderSide.seller')
    fields.mainKicker.textContent = sideLabel
    fields.decisionTitle.textContent = `${sideLabel} Transactions`
    fields.decisionStep.textContent = 'transactions'
    renderContextStrip()
    return
  }

  if (showingSettings) {
    renderSettingsPanel()
    renderContextStrip()
    return
  }

  if (state.pinStep) {
    fields.mainKicker.textContent = 'Transactions'
    fields.decisionTitle.textContent = state.pinStep.setup ? 'Set Payment PIN' : 'Enter Payment PIN'
    fields.decisionStep.textContent = 'Enter PIN'
    fields.decisionContent.innerHTML = renderPinStep(state.pinStep)
    attachPinHandlers()
    localize(fields.actionView)
    return
  }

  if (gpuDemoPanel) {
    fields.mainKicker.textContent = 'Local Demo'
    fields.decisionTitle.textContent = gpuDemoPanelTitle()
    fields.decisionStep.textContent = state.gpuDemo?.stage || 'demo'
    fields.decisionContent.innerHTML = renderGpuDemoPanel()
    attachGpuDemoHandlers()
    renderContextStrip()
    localize(fields.actionView)
    return
  }

  if (state.activeView === 'market') {
    const detailCandidate = state.marketDetailProvider ? marketCardByProvider(state.marketDetailProvider) : undefined
    const detailRailCard = state.marketRailDetailId ? marketRailCardById(state.marketRailDetailId) : undefined
    fields.mainKicker.textContent = 'Cart'
    fields.decisionTitle.textContent = detailRailCard?.title || detailCandidate?.resource?.name || (detailCandidate ? shortID(detailCandidate.providerPubkey) : 'Cards')
    fields.decisionStep.textContent = 'cart'
    fields.decisionContent.innerHTML = detailRailCard
        ? renderMarketRailDetailPage(detailRailCard)
        : renderCardMarket()
    attachCardHandlers()
    attachCardMarketHandlers()
    renderContextStrip()
    localize(fields.actionView)
    return
  }

  if (!selected) {
    fields.mainKicker.textContent = 'Transactions'
    fields.decisionTitle.textContent = 'Transactions'
    fields.decisionStep.textContent = 'empty'
    fields.decisionContent.innerHTML = '<p class="empty-copy">No seller choices, approvals, tasks, or payments yet. Use Buyer, Seller, or Cart to start.</p>'
    localize(fields.actionView)
    return
  }

  if (selected.kind === 'plan') {
    fields.mainKicker.textContent = 'Transactions'
    fields.decisionTitle.textContent = 'Review Sellers'
    fields.decisionStep.textContent = 'Review sellers'
    fields.decisionContent.innerHTML = renderTransactionProgressForSelection(selected) + renderOrderPlanDecision(selected.value)
  } else if (selected.kind === 'approval') {
    fields.mainKicker.textContent = 'Transactions'
    fields.decisionTitle.textContent = 'Approval Request'
    fields.decisionStep.textContent = selected.value.paymentRequired ? 'Payment required' : 'Review'
    fields.decisionContent.innerHTML = renderTransactionProgressForSelection(selected) + renderApprovalDecision(selected.value)
  } else if (selected.kind === 'task') {
    fields.mainKicker.textContent = 'Transactions'
    fields.decisionTitle.textContent = 'Task Status'
    fields.decisionStep.textContent = selected.value.status || 'task'
    fields.decisionContent.innerHTML = renderTransactionProgressForSelection(selected) + renderTaskDecision(selected.value)
  } else {
    fields.mainKicker.textContent = 'Transactions'
    fields.decisionTitle.textContent = 'Payment Proof'
    fields.decisionStep.textContent = selected.value.status || 'payment'
    fields.decisionContent.innerHTML = renderTransactionProgressForSelection(selected) + renderPaymentDecision(selected.value)
  }
  attachDecisionHandlers()
  localize(fields.actionView)
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
  const subject = approvalSubjectLabel(approval)
  const manifest = approval.manifestHash ? `<div><dt>Manifest</dt><dd>${escapeHTML(shortID(approval.manifestHash, 12, 8))}</dd></div>` : ''
  return `
    <section class="decision-card">
      <div class="decision-summary">
        <span>${escapeHTML(agentSourceLabel(approval.agentId))}</span>
        <strong>${escapeHTML(approval.action || 'Approval request')}</strong>
        <small>${escapeHTML(approval.riskSummary || 'Approval required before this action can continue.')}</small>
      </div>
      <dl class="detail-grid">
        <div><dt>Subject</dt><dd>${escapeHTML(subject)}</dd></div>
        ${manifest}
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

function approvalSubjectLabel(approval: Approval) {
  if (approval.taskId) return `Task ${shortID(approval.taskId)}`
  if (approval.planId) return `Plan ${shortID(approval.planId)}`
  if (approval.subjectType || approval.subjectId) return `${approval.subjectType || 'Subject'} ${shortID(approval.subjectId || approval.approvalId)}`
  if (approval.workRunId) return `Work ${shortID(approval.workRunId)}`
  return shortID(approval.approvalId)
}

function approvalThreadKey(approval: Approval) {
  if (approval.taskId) return `order:${approval.taskId}`
  if (approval.planId) return `order:${approval.planId}`
  if (approval.workRunId) return `work:${approval.workRunId}`
  if (approval.subjectId) return `approval-subject:${approval.subjectId}`
  return `approval:${approval.approvalId}`
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

function activeGpuDemoPanel() {
  const demo = state.gpuDemo
  return Boolean(demo?.active && !['idle', 'ready'].includes(demo.stage))
}

function gpuDemoPanelTitle() {
  const demo = state.gpuDemo
  if (!demo) return 'GPU Job Demo'
  switch (demo.stage) {
    case 'thinking':
      return 'Agent Thinking'
    case 'questions':
      return 'Agent Questions'
    case 'manifest_review':
      return 'Task Checklist'
    case 'matching':
      return 'Matching Sellers'
    case 'seller_options':
      return 'Choose Seller'
    case 'seller_confirming':
      return 'Seller Confirmation'
    case 'seller_accepted':
    case 'pin':
      return 'Payment PIN'
    case 'completed':
      return 'Result Files'
    default:
      return 'GPU Job Execution'
  }
}

function renderGpuDemoPanel() {
  const demo = state.gpuDemo
  if (!demo?.active) return ''
  if (demo.stage === 'thinking') return renderGpuDemoThinking(demo)
  if (demo.stage === 'questions') return renderGpuDemoQuestions(demo)
  if (demo.stage === 'manifest_review') return renderGpuDemoManifestReview(demo)
  if (demo.stage === 'matching') return renderGpuDemoMatching(demo)
  if (demo.stage === 'seller_options') return renderGpuDemoSellerOptions(demo)
  if (demo.stage === 'seller_confirming') return renderGpuDemoSellerConfirming(demo)
  if (demo.stage === 'seller_accepted' || demo.stage === 'pin') return renderGpuDemoSellerAccepted(demo)
  return renderGpuDemoExecution(demo)
}

function renderGpuDemoShell(demo: GpuDemoState, body: string, actions = '') {
  return `
    <section class="decision-card gpu-demo-panel" data-gpu-demo-stage="${escapeAttr(demo.stage)}">
      <div class="gpu-demo-head">
        <div class="decision-summary">
          <span>GPU Job Demo</span>
          <strong>${escapeHTML(gpuDemoPanelTitle())}</strong>
          <small>${escapeHTML(gpuDemoNextAction(demo))}</small>
        </div>
        <button class="secondary compact-action" type="button" data-gpu-demo-action="reset">Reset GPU Demo</button>
      </div>
      ${renderGpuDemoStageStrip(demo)}
      ${body}
      ${actions ? `<div class="decision-actions gpu-demo-actions">${actions}</div>` : ''}
    </section>
  `
}

function renderGpuDemoStageStrip(demo: GpuDemoState) {
  const steps: Array<{ id: GpuDemoStage; label: string }> = [
    { id: 'ready', label: 'Prompt' },
    { id: 'questions', label: 'Questions' },
    { id: 'manifest_review', label: 'Checklist' },
    { id: 'seller_options', label: 'Sellers' },
    { id: 'pin', label: 'PIN' },
    { id: 'running', label: 'Run' },
    { id: 'completed', label: 'Results' },
  ]
  const activeIndex = gpuDemoStageIndex(demo.stage)
  return `
    <div class="gpu-demo-stage-strip">
      ${steps.map((step) => {
        const status = activeIndex > gpuDemoStageIndex(step.id) ? 'complete' : activeIndex === gpuDemoStageIndex(step.id) || (step.id === 'running' && ['paid', 'queued', 'pulling_image', 'running', 'uploading_artifacts'].includes(demo.stage)) ? 'active' : 'pending'
        return `<span class="${status}"><i></i>${escapeHTML(step.label)}</span>`
      }).join('')}
    </div>
  `
}

function renderGpuDemoThinking(demo: GpuDemoState) {
  return renderGpuDemoShell(demo, `
    <div class="gpu-demo-wait">
      <div class="gpu-demo-spinner" aria-hidden="true"></div>
      <div>
        <strong>External agent is reading the MCP prompt.</strong>
        <p>It is classifying the GPU job, checking missing requirements, and preparing a small set of owner questions.</p>
      </div>
    </div>
  `)
}

function renderGpuDemoQuestions(demo: GpuDemoState) {
  const answers = demo.answers
  return renderGpuDemoShell(demo, `
    <form class="gpu-demo-question-form" data-gpu-demo-question-form>
      <label>
        <span>GPU requirement</span>
        <select name="gpuProfile">
          ${['A6000 48GB or better', 'H100 80GB preferred', 'RTX 4090 acceptable'].map((item) => `<option value="${escapeAttr(item)}"${answers.gpuProfile === item ? ' selected' : ''}>${escapeHTML(item)}</option>`).join('')}
        </select>
      </label>
      <label>
        <span>Max budget (USDC)</span>
        <input name="budget" type="number" min="1" step="0.5" value="${escapeAttr(answers.budget)}" />
      </label>
      <label>
        <span>Input batch</span>
        <textarea name="dataset" rows="2">${escapeHTML(answers.dataset)}</textarea>
      </label>
      <label>
        <span>Expected outputs</span>
        <textarea name="outputs" rows="2">${escapeHTML(answers.outputs)}</textarea>
      </label>
      <div class="decision-actions gpu-demo-actions">
        <button type="submit">Answer Questions</button>
      </div>
    </form>
  `)
}

function renderGpuDemoManifestReview(demo: GpuDemoState) {
  const items = [
    ['Goal', demo.taskText],
    ['GPU', demo.answers.gpuProfile],
    ['Budget', `${demo.answers.budget || '15'} USDC max`],
    ['Inputs', demo.answers.dataset],
    ['Outputs', demo.answers.outputs],
    ['Acceptance', 'Files exist, hashes match, logs summarize runtime, receipt confirms cleanup.'],
    ['Permission boundary', 'No cloud, no real payment, no real Docker/GPU execution in this demo.'],
  ]
  return renderGpuDemoShell(demo, `
    <div class="gpu-demo-manifest">
      <p>This is the task checklist that the buyer agent would send to matching and seller agents.</p>
      <dl class="detail-grid gpu-demo-review-grid">
        ${items.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}
      </dl>
    </div>
  `, '<button type="button" data-gpu-demo-action="send-manifest">Send To Local Matching</button>')
}

function renderGpuDemoMatching(demo: GpuDemoState) {
  return renderGpuDemoShell(demo, `
    <div class="gpu-demo-wait">
      <div class="gpu-demo-spinner" aria-hidden="true"></div>
      <div>
        <strong>Matching three local demo sellers.</strong>
        <p>The Electron demo is simulating remote marketplace matching and seller valuation locally.</p>
      </div>
    </div>
  `)
}

function renderGpuDemoSellerOptions(demo: GpuDemoState) {
  return renderGpuDemoShell(demo, `
    <div class="gpu-demo-seller-grid">
      ${GPU_DEMO_SELLERS.map((seller) => renderGpuDemoSellerCard(demo, seller)).join('')}
    </div>
  `)
}

function renderGpuDemoSellerCard(demo: GpuDemoState, seller: GpuDemoSeller) {
  const overBudget = seller.price > (Number(demo.answers.budget) || 0)
  return `
    <article class="gpu-demo-seller-card ${overBudget ? 'warn' : ''}">
      <div class="gpu-demo-seller-head">
        <strong>${escapeHTML(seller.name)}</strong>
        <span>score ${seller.score}</span>
      </div>
      <p>${escapeHTML(seller.reason)}</p>
      <dl>
        <div><dt>GPU</dt><dd>${escapeHTML(seller.gpu)} / ${seller.vramGb}GB</dd></div>
        <div><dt>Price</dt><dd>${trimDisplayNumber(seller.price)} USDC</dd></div>
        <div><dt>ETA</dt><dd>${escapeHTML(seller.eta)}</dd></div>
        <div><dt>Success</dt><dd>${escapeHTML(seller.success)}</dd></div>
      </dl>
      <small>${escapeHTML(seller.risk)}</small>
      <button type="button" data-gpu-demo-action="select-seller" data-seller-id="${escapeAttr(seller.id)}">${overBudget ? 'Choose Over Budget' : 'Choose Seller'}</button>
    </article>
  `
}

function renderGpuDemoSellerConfirming(demo: GpuDemoState) {
  const seller = selectedGpuDemoSeller(demo)
  return renderGpuDemoShell(demo, `
    <div class="gpu-demo-wait">
      <div class="gpu-demo-spinner" aria-hidden="true"></div>
      <div>
        <strong>Waiting for ${escapeHTML(seller.name)}.</strong>
        <p>The seller is confirming queue availability, input boundary, and quote terms before the PIN step opens.</p>
      </div>
    </div>
  `)
}

function renderGpuDemoSellerAccepted(demo: GpuDemoState) {
  const seller = selectedGpuDemoSeller(demo)
  return renderGpuDemoShell(demo, `
    <div class="gpu-demo-accepted">
      <strong>${escapeHTML(seller.name)} accepted the job.</strong>
      <p>Electron will ask for a local demo PIN. This records a simulated escrow proof only and does not touch the real payment PIN or chain payment.</p>
    </div>
  `, '<button type="button" data-gpu-demo-action="open-pin">Open PIN</button>')
}

function renderGpuDemoExecution(demo: GpuDemoState) {
  const seller = selectedGpuDemoSeller(demo)
  const steps: Array<{ id: GpuDemoStage; label: string; detail: string }> = [
    { id: 'paid', label: 'Payment proof', detail: 'Simulated escrow proof confirmed locally.' },
    { id: 'queued', label: 'Queued', detail: 'Provider job accepted and queued.' },
    { id: 'pulling_image', label: 'Pulling image', detail: 'Preparing CUDA image and cached model files.' },
    { id: 'running', label: 'Running', detail: 'Inference batch running with checkpointed outputs.' },
    { id: 'uploading_artifacts', label: 'Uploading', detail: 'Packaging results, logs, metrics, receipt, and hashes.' },
    { id: 'completed', label: 'Completed', detail: 'Result bundle is ready for buyer verification.' },
  ]
  const files = ['result.md', 'metrics.json', 'logs.txt', 'receipt.json']
  return renderGpuDemoShell(demo, `
    <div class="gpu-demo-execution-summary">
      <strong>${escapeHTML(seller.name)}</strong>
      <span>${trimDisplayNumber(seller.price)} USDC / ${escapeHTML(seller.eta)} / ${escapeHTML(seller.gpu)}</span>
    </div>
    <div class="gpu-demo-progress-list">
      ${steps.map((step) => {
        const status = gpuDemoStageIndex(demo.stage) > gpuDemoStageIndex(step.id) || demo.stage === step.id ? 'complete' : 'pending'
        const current = demo.stage === step.id || (step.id === 'paid' && demo.stage === 'queued')
        return `
          <div class="${status}${current ? ' current' : ''}">
            <span aria-hidden="true"></span>
            <div><strong>${escapeHTML(step.label)}</strong><small>${escapeHTML(step.detail)}</small></div>
          </div>
        `
      }).join('')}
    </div>
    ${demo.stage === 'completed' ? `
      <div class="gpu-demo-files">
        ${files.map((file) => `<article><strong>${escapeHTML(file)}</strong><span>${escapeHTML(`${demo.ids.base}-${file.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-hash`)}</span></article>`).join('')}
      </div>
    ` : ''}
  `)
}

function attachGpuDemoHandlers(container: ParentNode = fields.decisionContent) {
  container.querySelectorAll<HTMLButtonElement>('[data-gpu-demo-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.gpuDemoAction
      if (action === 'reset') resetGpuJobDemo()
      if (action === 'send-manifest') startGpuDemoMatching()
      if (action === 'select-seller') chooseGpuDemoSeller(button.dataset.sellerId || '')
      if (action === 'open-pin') openGpuDemoPin()
    })
  })
  container.querySelector<HTMLFormElement>('[data-gpu-demo-question-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitGpuDemoQuestions(event.currentTarget as HTMLFormElement)
  })
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
  if (role === 'seller') return renderSellerCardActionBar()
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
  const sellIntent = seller.sellIntent || seller.capabilitySummary || ''
  const pricingPrinciples = seller.pricingPrinciples || seller.pricing || ''
  const generated = Boolean(seller.setupStatus === 'complete' && seller.structuredByAgent && seller.structuredAt)
  const incomplete = seller.setupStatus === 'incomplete'
  return `
    <label class="card-setup-row card-field-row seller-card-intent-field"><span class="field-label">What do you want to sell?</span><small class="field-help">Describe the service, compute, software capability, data work, or deliverable you want buyers to discover.</small><textarea name="sellIntent" placeholder="For example: CUDA inference jobs, Blender rendering, data cleanup, code review, or use of a licensed local tool.">${escapeHTML(sellIntent)}</textarea></label>
    <label class="card-setup-row card-field-row seller-card-intent-field"><span class="field-label">Pricing principles</span><small class="field-help">State how price should respond to workload, runtime, urgency, resource use, minimum fees, or negotiation.</small><textarea name="pricingPrinciples" placeholder="For example: 5 USDC minimum; add GPU runtime and storage costs; urgent work carries a premium; quote uncertain jobs before acceptance.">${escapeHTML(pricingPrinciples)}</textarea></label>
    ${renderSellerCardQuestions()}
    ${generated ? renderGeneratedSellerCard(seller) : `
      <div class="agent-env-empty seller-card-agent-empty">
        <strong>${incomplete ? 'Seller Setup is incomplete.' : 'The bound local Agent has not structured this Seller Card yet.'}</strong>
        <span>${incomplete ? 'Finish every required question and permission boundary before this Card can be saved or published.' : `Enter the two fields above, then let the Agent inspect Exora's redacted environment report and generate offerings and a pricing workflow.`}</span>
      </div>
    `}
  `
}

function renderSellerCardQuestions() {
  const generation = state.sellerCardGeneration
  if (generation?.status !== 'waiting_user' || !generation.questions?.length) return ''
  return `
    <section class="seller-card-questions" aria-label="Seller Setup questions">
      <div class="seller-card-questions-head">
        <div><strong>Seller Setup · Round ${generation.round}</strong><small>The local Agent needs these answers before it can finalize capabilities and permissions.</small></div>
        <span>Incomplete</span>
      </div>
      <div class="seller-card-secret-warning">
        <strong>Never paste secrets here.</strong>
        <span>Use credential aliases only—for example “GitHub seller account”. API keys, tokens, passwords, private keys, cookies, and recovery codes stay outside the Agent conversation.</span>
      </div>
      <div class="seller-card-question-list">
        ${generation.questions.map((question, index) => `
          <label class="seller-card-question">
            <span class="field-label">${index + 1}. ${escapeHTML(question.question)}${question.required ? '<em>Required</em>' : '<em>Optional</em>'}</span>
            ${question.why ? `<small class="field-help">${escapeHTML(question.why)}</small>` : ''}
            <textarea data-seller-card-question="${escapeAttr(question.id)}" placeholder="${escapeAttr(question.placeholder || 'Describe the boundary without including any secret value.')}" ${question.required ? 'required' : ''}></textarea>
          </label>
        `).join('')}
      </div>
    </section>
  `
}

function renderSellerCardActionBar() {
  const generation = state.sellerCardGeneration
  const waitingUser = generation?.status === 'waiting_user'
  const running = Boolean(generation && generation.status !== 'completed' && generation.status !== 'failed' && generation.status !== 'waiting_user')
  const binding = state.localAgentBinding
  const bindingReady = Boolean(binding?.valid)
  const hasUnsavedChanges = agentCardHasUnsavedChanges('seller')
  const seller = cardForRole('seller')?.manualFields.seller
  const structured = Boolean(seller?.setupStatus === 'complete' && seller.structuredByAgent && seller.structuredAt)
  const cardActionsDisabled = Boolean(running || waitingUser || !structured)
  const status = running
    ? generation?.status === 'collecting' ? 'Inspecting the local environment with Exora tools...'
      : generation?.status === 'starting_agent' ? `Starting ${localAgentDisplayName(binding?.driverId)}...`
        : `${localAgentDisplayName(binding?.driverId)} is reviewing offerings and permission boundaries...`
    : waitingUser ? `Setup incomplete · answer ${generation?.questions?.filter((question) => question.required).length || 0} required question(s).`
    : generation?.status === 'failed' ? generation.error || 'Seller Card generation failed.'
      : seller?.setupStatus === 'incomplete' ? 'Seller Setup is incomplete. Restart the Agent setup to finish permissions.'
      : bindingReady ? `${localAgentDisplayName(binding?.driverId)} is ready to investigate this Seller Card.`
        : 'Bind and verify a supported local Agent before generating this Seller Card.'
  const primaryAction = waitingUser ? 'continue-seller-card' : 'generate-seller-card'
  const primaryDisabled = waitingUser ? false : Boolean(running || !bindingReady)
  const primaryText = waitingUser ? 'Continue setup' : running ? 'Agent investigating' : `Generate with ${localAgentDisplayName(binding?.driverId)}`
  return `
    <div class="card-setup-actionbar card-scan-actionbar seller-card-agent-actionbar" aria-label="Generate Seller Card with local Agent">
      <button type="button" class="card-action-button diagnose-card-action ${running ? 'is-running' : ''} ${waitingUser ? 'is-waiting' : ''}" data-card-action="${primaryAction}" data-card-role="seller" ${primaryDisabled ? 'disabled' : ''} ${running ? 'aria-busy="true"' : ''}>
        <span class="card-action-icon">${running ? cardActionIcons.diagnose : localAgentIcon}</span>
        <span class="card-action-text">${escapeHTML(primaryText)}</span>
      </button>
      <span class="card-scan-status" title="${escapeAttr(status)}">${escapeHTML(status)}</span>
    </div>
    <div class="card-setup-actionbar card-save-actionbar" aria-label="Seller Card actions">
      <button type="button" class="card-action-button save-card-action ${hasUnsavedChanges ? 'is-dirty' : 'is-saved'}" data-card-action="save" data-card-role="seller" ${cardActionsDisabled ? 'disabled' : ''} title="${!structured ? 'Generate the Seller Card with the bound Agent first' : hasUnsavedChanges ? 'Save local changes' : 'Current card is saved'}">
        <span class="card-action-icon">${hasUnsavedChanges ? cardActionIcons.save : cardActionIcons.saved}</span>
        <span class="card-action-text">${hasUnsavedChanges ? 'Save local' : 'Saved'}</span>
      </button>
      <button type="button" class="card-action-button publish-card-action" data-card-action="publish" data-card-role="seller" ${cardActionsDisabled ? 'disabled' : ''} title="${!structured ? 'Generate the Seller Card with the bound Agent first' : 'Save and publish this card to Exora Cloud'}">
        <span class="card-action-icon">${cardActionIcons.publish}</span>
        <span class="card-action-text">Publish</span>
      </button>
    </div>
  `
}

function renderGeneratedSellerCard(seller: SellerManualFields) {
  const offerings = seller.offerings || []
  const pricingProcess = seller.pricingProcess || []
  const allowedActions = seller.allowedAgentActions || []
  const approvalActions = seller.approvalRequiredActions || []
  return `
    <section class="seller-card-generated" aria-label="Agent generated Seller Card">
      <div class="seller-card-generated-head"><span>${localAgentIcon}</span><div><strong>Agent-structured Seller Card</strong><small>Generated from seller intent and redacted local diagnostics. Review before publishing.</small></div></div>
      <div class="seller-card-generated-summary">
        <div><span>Public name</span><strong>${escapeHTML(seller.displayName || 'Exora Seller')}</strong></div>
        <div><span>Capability</span><strong>${escapeHTML(seller.capabilitySummary || 'Pending Agent analysis')}</strong></div>
        <div><span>Pricing summary</span><strong>${escapeHTML(seller.pricing || 'Pending Agent analysis')}</strong></div>
        <div><span>Availability</span><strong>${escapeHTML(seller.availability || 'Checked when quoting')}</strong></div>
      </div>
      <div class="seller-card-generated-columns">
        <div><h3>What buyers can order</h3><ol>${offerings.map((item) => `<li>${escapeHTML(item)}</li>`).join('') || '<li>Pending Agent analysis</li>'}</ol></div>
        <div><h3>Pricing workflow</h3><ol>${pricingProcess.map((item) => `<li>${escapeHTML(item)}</li>`).join('') || '<li>Pending Agent analysis</li>'}</ol></div>
      </div>
      <div class="seller-card-permission-policy">
        <div><h3>Agent may do</h3><ul>${allowedActions.map((item) => `<li>${escapeHTML(item)}</li>`).join('') || '<li>No autonomous action granted</li>'}</ul></div>
        <div><h3>Always needs seller approval</h3><ul>${approvalActions.map((item) => `<li>${escapeHTML(item)}</li>`).join('') || '<li>Permission policy incomplete</li>'}</ul></div>
        <div><h3>Credentials</h3><p>${escapeHTML(seller.credentialPolicy || 'Real credential values never enter Seller Setup.')}</p></div>
        <div><h3>Network boundary</h3><p>${escapeHTML(seller.networkPolicy || 'No network boundary granted.')}</p></div>
      </div>
      ${seller.capabilityTypes?.length ? `<div class="seller-card-generated-tags">${seller.capabilityTypes.map((item) => `<span>${escapeHTML(item)}</span>`).join('')}</div>` : ''}
    </section>
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

function agentCardSearchCandidates(response: AgentCardSearchResponse) {
  return (response.cards || [])
    .filter((card) => card.role === 'seller')
    .map(sellerCardCandidate)
}

function sellerCardCandidate(card: AgentCard): SellerCandidate {
  const seller = card.manualFields?.seller || {}
  const diagnostics: Partial<AgentCardDiagnostics> = card.diagnostics || {}
  const providerPubkey = card.dockId || card.id || card.agentId
  const name = seller.displayName || card.agentId || shortID(providerPubkey)
  const capability = seller.capabilityTypes?.[0] || 'seller-card'
  const gpu = diagnostics.gpus?.[0]
  const summary = seller.capabilitySummary || seller.availability || (card.diagnostics ? diagnosticsSummary(card.diagnostics) : '')
  return {
    providerPubkey,
    score: card.status === 'published' ? 92 : 78,
    reasons: [summary || 'Seller card match'],
    resource: {
      id: card.id,
      name,
      type: capability,
      summary,
      billingUnit: seller.pricing ? 'task' : undefined,
      spec: {
        gpuModel: gpu?.name || gpu?.chip,
        vramGb: gpu?.vramGb,
        gpuCount: diagnostics.gpus?.length,
        region: seller.availability,
        runtime: diagnostics.dockerAvailable ? 'Docker' : diagnostics.os,
      },
    },
  }
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

function escapeAttr(value: unknown) {
  return escapeHTML(value).replace(/`/g, '&#96;')
}

function renderCardMarket() {
  if (state.marketDetailProvider) {
    const candidate = marketCardByProvider(state.marketDetailProvider)
    if (candidate) return renderMarketDetailPage(candidate)
    state.marketDetailProvider = undefined
  }
  return `
    <section class="card-market-panel">
      ${renderMarketSearchBar()}
      ${renderMarketSearchStatus()}
      ${renderMarketRailSection()}
    </section>
  `
}

function renderCartSurface() {
  if (state.cartOpen) {
    renderCartModal()
  } else {
    renderDecisionPanel()
  }
}

function renderCartCardEditor(role: AgentCardRole) {
  const title = role === 'buyer' ? 'Buyer Card' : 'Seller Card'
  return `
    <section class="cart-card-editor">
      <div class="market-detail-top">
        <button type="button" class="market-mini-action" data-card-action="cancel-edit" aria-label="Back to cards" title="Back to cards">${toolbarIcons.back}<span>Back to cards</span></button>
      </div>
      <div class="cart-card-editor-head">
        <span>${escapeHTML(title)}</span>
        <strong>${escapeHTML(role === 'buyer' ? 'Edit buyer card' : 'Edit seller card')}</strong>
      </div>
      ${renderAgentCardEditor(role)}
    </section>
  `
}

function cartModalTitle() {
  if (state.activeCardEditor) return state.activeCardEditor === 'buyer' ? 'Buyer Card' : 'Seller Card'
  const detailRailCard = state.marketRailDetailId ? marketRailCardById(state.marketRailDetailId) : undefined
  if (detailRailCard) return detailRailCard.title
  if (state.marketDetailProvider) {
    const candidate = marketCardByProvider(state.marketDetailProvider)
    return candidate?.resource?.name || shortID(state.marketDetailProvider)
  }
  return 'Cards'
}

function renderCartModal() {
  fields.cartModal.classList.toggle('hidden', !state.cartOpen)
  fields.cartModal.setAttribute('aria-hidden', String(!state.cartOpen))
  renderChromeControls()
  if (!state.cartOpen) {
    fields.cartContent.innerHTML = ''
    return
  }
  fields.cartKicker.textContent = state.activeCardEditor ? 'Card Editor' : 'Cart'
  fields.cartTitle.textContent = cartModalTitle()
  const detailRailCard = state.marketRailDetailId ? marketRailCardById(state.marketRailDetailId) : undefined
  fields.cartContent.innerHTML = state.activeCardEditor
    ? renderCartCardEditor(state.activeCardEditor)
    : detailRailCard
      ? renderMarketRailDetailPage(detailRailCard)
      : renderCardMarket()
  attachCardHandlers(fields.cartContent)
  if (!state.activeCardEditor) attachCardMarketHandlers(fields.cartContent)
  localize()
}

function closeCartModal(options: { render?: boolean } = {}) {
  if (!state.cartOpen) return
  state.cartOpen = false
  state.marketDetailProvider = undefined
  state.marketRailDetailId = undefined
  state.activeCardEditor = undefined
  if (options.render !== false) {
    renderCartModal()
    renderChromeControls()
  }
}

function renderMarketSearchBar() {
  return `
    <form class="card-market-form" data-card-market-form>
      <input name="query" value="${escapeAttr(state.marketCardSearchQuery || '')}" placeholder="${t('market.searchPlaceholder')}" autocomplete="off" />
      <button class="card-market-search-button" type="submit" aria-label="${t('market.searchCards')}" title="${translatePhrase('Search')}">${toolbarIcons.search}</button>
    </form>
  `
}

function renderMarketSearchStatus() {
  if (state.marketCardSearchLoading) {
    return `
      <section class="market-rail-empty">
        <strong>Searching seller cards</strong>
        <span>${escapeHTML(state.marketCardSearchQuery || '')}</span>
      </section>
    `
  }
  if (state.marketCardSearchError) {
    return `
      <section class="market-rail-empty">
        <strong>Seller card search failed</strong>
        <span>${escapeHTML(state.marketCardSearchError)}</span>
      </section>
    `
  }
  if (state.marketCardSearchQuery && !state.marketCardSearchCandidates.length) {
    return `
      <section class="market-rail-empty">
        <strong>No seller cards found</strong>
        <span>${escapeHTML(state.marketCardSearchQuery)}</span>
      </section>
    `
  }
  return ''
}

function renderMarketRailSection() {
  const cards = state.marketRail?.cards || []
  if (!cards.length && state.marketRailLoading) {
    return `
      <section class="market-rail-section">
        <div class="market-section-head">
          <span>Seller cards</span>
          <strong>Loading seller card ads</strong>
        </div>
        <div class="market-rail-grid">
          ${Array.from({ length: 3 }).map((_, index) => `
            <article class="agent-card market-rail-card market-rail-loading tone-${marketRailTone(index)}">
              <div class="market-rail-skeleton short"></div>
              <div class="market-rail-skeleton title"></div>
              <div class="market-rail-skeleton body"></div>
            </article>
          `).join('')}
        </div>
      </section>
    `
  }
  if (!cards.length) {
    return `
      <section class="market-rail-empty">
        <strong>Seller card ads are not available yet.</strong>
        <span>${escapeHTML(state.marketRailError || 'Start or refresh the local Dock to load seller cards.')}</span>
        <button type="button" class="market-mini-action text-action" data-card-action="refresh">${toolbarIcons.refresh}<span>Refresh</span></button>
      </section>
    `
  }
  return `
    <section class="market-rail-section">
      <div class="market-section-head">
        <span>Seller cards</span>
        <strong>Featured seller card ads</strong>
      </div>
      <div class="market-rail-grid">
        ${cards.map(renderMarketRailCard).join('')}
      </div>
    </section>
  `
}

function renderMarketRailCard(card: MarketRailCard, index: number) {
  const provider = card.provider || 'local sample'
  const metrics = (card.metrics || []).slice(0, 3)
  const chips = (card.chips || []).slice(0, 5)
  const tone = marketRailTone(index)
  return `
    <article class="agent-card market-rail-card tone-${tone}" data-market-rail-detail="${escapeAttr(card.id)}" role="button" tabindex="0" aria-label="Open ${escapeAttr(card.title)}">
      <div class="market-card-topline">
        <span class="market-stage-pill">${escapeHTML(card.stage)}</span>
        <div class="market-card-icon-actions" aria-label="Card actions">
          <button type="button" class="market-icon-action" data-market-rail-detail="${escapeAttr(card.id)}" aria-label="View ${escapeAttr(card.title)}" title="View details">${toolbarIcons.disclosure}</button>
        </div>
      </div>
      <div class="market-card-titleblock">
        <span>${escapeHTML(card.status)}</span>
        <h3>${escapeHTML(card.title)}</h3>
        <small>${escapeHTML(provider)}</small>
      </div>
      <p class="market-rail-summary">${escapeHTML(card.summary)}</p>
      <div class="market-metric-row">
        ${metrics.map(renderMarketMetric).join('')}
      </div>
      ${chips.length ? `<div class="chip-row market-rail-chips">${chips.map((chip) => `<span>${escapeHTML(chip)}</span>`).join('')}</div>` : ''}
      <div class="market-card-footer">
        <span>${escapeHTML(compactText(card.risk || card.nextAction || 'View seller card details.', 86))}</span>
        <strong>${toolbarIcons.disclosure}</strong>
      </div>
    </article>
  `
}

function renderMarketMetric(metric: { label: string; value: string; hint?: string }) {
  return `
    <div class="market-metric" title="${escapeAttr(metric.hint || metric.label)}">
      <span>${escapeHTML(metric.label)}</span>
      <strong>${escapeHTML(metric.value)}</strong>
    </div>
  `
}

function marketRailTone(index: number) {
  return ['mint', 'lime', 'sky', 'coral', 'lavender', 'graphite'][index % 6]
}

function renderMarketDetailPage(candidate: SellerCandidate) {
  const resource = candidate.resource
  const title = resource?.name || shortID(candidate.providerPubkey)
  const spec = resource?.spec || {}
  const price = resource?.pricePerUnit
    ? `${trimDisplayNumber(resource.pricePerUnit)} / ${resource.billingUnit || 'unit'}`
    : 'quote on request'
  return `
    <article class="agent-card market-detail-card opponent-agent-card market-modern-detail">
      <div class="market-detail-top">
        <button type="button" class="market-mini-action" data-market-detail-back aria-label="${t('market.backToCards')}" title="${t('market.backToCards')}">${toolbarIcons.back}<span>${t('market.backToCards')}</span></button>
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
    </article>
  `
}

function renderMarketRailDetailPage(card: MarketRailCard) {
  const index = Math.max(0, (state.marketRail?.cards || []).findIndex((item) => item.id === card.id))
  const metrics = card.metrics || []
  const chips = card.chips || []
  const refs = card.sourceRefs || []
  return `
    <article class="agent-card market-detail-card market-rail-detail-card tone-${marketRailTone(index)}">
      <div class="market-detail-top">
        <button type="button" class="market-mini-action" data-market-rail-back aria-label="Back to cards" title="Back to cards">${toolbarIcons.back}<span>Back</span></button>
      </div>
      <div class="market-card-titleblock detail-titleblock">
        <span>${escapeHTML(card.stage)} / ${escapeHTML(card.status)}</span>
        <h3>${escapeHTML(card.title)}</h3>
        <small>${escapeHTML(card.provider || 'local sample')}</small>
      </div>
      <p class="market-rail-summary">${escapeHTML(card.summary)}</p>
      ${metrics.length ? `
        <div class="market-metric-row detail-metrics">
          ${metrics.map(renderMarketMetric).join('')}
        </div>
      ` : ''}
      ${chips.length ? `<div class="chip-row market-rail-chips">${chips.map((chip) => `<span>${escapeHTML(chip)}</span>`).join('')}</div>` : ''}
      <dl class="detail-grid market-card-details">
        <div><dt>Provider</dt><dd>${escapeHTML(card.provider || 'not declared')}</dd></div>
        <div><dt>Stage</dt><dd>${escapeHTML(card.stage)}</dd></div>
        <div><dt>Status</dt><dd>${escapeHTML(card.status)}</dd></div>
        <div><dt>Risk</dt><dd>${escapeHTML(card.risk || 'not declared')}</dd></div>
        <div><dt>Next action</dt><dd>${escapeHTML(card.nextAction || 'Review with owner before execution.')}</dd></div>
        <div><dt>Sources</dt><dd>${escapeHTML(refs.length ? refs.map((ref) => ref.label).join(', ') : 'sample market')}</dd></div>
      </dl>
      ${refs.length ? `
        <div class="market-source-list">
          ${refs.map((ref) => `<span title="${escapeAttr(ref.path)}">${escapeHTML(ref.label)}</span>`).join('')}
        </div>
      ` : ''}
    </article>
  `
}

function marketCandidateCards(options: { includeFeatured?: boolean } = {}) {
  const byProvider = new Map<string, SellerCandidate>()
  for (const candidate of state.marketCardSearchCandidates) {
    if (!byProvider.has(candidate.providerPubkey)) byProvider.set(candidate.providerPubkey, candidate)
  }
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
  if (options.includeFeatured) {
    for (const card of featuredMarketCards()) {
      if (!byProvider.has(card.providerPubkey)) byProvider.set(card.providerPubkey, card)
    }
  }
  return [...byProvider.values()].slice(0, 12)
}

function allChatMessages() {
  return state.chatThreads.flatMap((thread) => thread.messages)
}

function marketCardByProvider(providerPubkey: string) {
  return marketCandidateCards({ includeFeatured: true }).find((candidate) => candidate.providerPubkey === providerPubkey)
    || marketRailCandidateCards().find((candidate) => candidate.providerPubkey === providerPubkey)
}

function marketRailCardById(id: string) {
  return (state.marketRail?.cards || []).find((card) => card.id === id)
}

function marketRailCandidateCards() {
  return (state.marketRail?.cards || []).map(marketRailCandidate)
}

function marketRailCandidate(card: MarketRailCard): SellerCandidate {
  const priceMetric = (card.metrics || []).find((metric) => metric.label.toLowerCase().includes('price'))
  const price = priceMetric ? Number.parseFloat(priceMetric.value) : NaN
  return {
    providerPubkey: card.provider || card.id,
    score: marketRailScore(card),
    reasons: [card.summary],
    resource: {
      id: card.id,
      name: card.title,
      type: card.stage || 'agent',
      summary: card.summary,
      pricePerUnit: Number.isFinite(price) ? price : undefined,
      billingUnit: priceMetric ? 'task' : undefined,
      spec: { region: card.chips?.find((chip) => /west|east|global|remote/i.test(chip)) || undefined },
    },
  }
}

function marketRailScore(card: MarketRailCard) {
  const scoreMetric = (card.metrics || []).find((metric) => metric.label.toLowerCase().includes('score'))
  if (!scoreMetric) return 0
  const score = Number.parseFloat(scoreMetric.value)
  if (!Number.isFinite(score)) return 0
  return score <= 1 ? Math.round(score * 100) : score
}

function openMarketProjectPicker(candidate: SellerCandidate) {
  closeProfileMenu()
  closeProjectFolderMenu(false)
  closePermissionMenu(false)
  closeMarketProjectPicker()
  startMarketConversation(candidate, defaultWorkProjectFolder())
}

function closeMarketProjectPicker() {
  if (!state.marketProjectPickerProvider) return
  state.marketProjectPickerProvider = undefined
  renderMarketProjectPicker()
}

function renderMarketProjectPicker() {
  fields.marketProjectPicker.classList.add('hidden')
  fields.marketProjectDialog.innerHTML = ''
}

function selectMarketProject(path: string) {
  const provider = state.marketProjectPickerProvider
  const candidate = provider ? marketCardByProvider(provider) : undefined
  const folder = state.projectFolders.find((item) => sameProjectPath(item.path, path)) || defaultWorkProjectFolder()
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
  const thread = existing || createChatThread({
    title: t('market.taskTitle', { seller: sellerTitle }),
    providerPubkey: candidate.providerPubkey,
    projectPath: folder.path,
    origin: 'market-card',
    status: 'draft',
    select: true,
  })
  if (!existing) {
    thread.messages.push({
      id: nextID(),
      role: 'user',
      text: t('market.taskUserText', { seller: sellerTitle }),
      meta: 'Cart Card',
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
    flushSaveChatThread(thread)
  } else {
    state.selectedChatId = existing.id
    state.selectedWorkThreadId = workThreadIdForChat(existing)
    state.newConversationDraft = false
  }
  state.workOrderSide = 'buyer'
  state.chatMode = 'expanded'
  state.selectedChatId = thread.id
  state.selectedWorkThreadId = workThreadIdForChat(thread)
  state.newConversationDraft = false
  state.selectedId = undefined
  state.marketDetailProvider = undefined
  state.marketRailDetailId = undefined
  state.activeCardEditor = undefined
  state.cartOpen = false
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
      } else if (action === 'generate-seller-card') {
        generateSellerCardWithAgent(root).catch((error) => {
          failSellerCardGeneration(humanizeError(error))
          showToast(humanizeError(error))
        })
      } else if (action === 'continue-seller-card') {
        continueSellerCardSetup(root).catch((error) => {
          state.cardMessage = humanizeError(error)
          showToast(humanizeError(error))
        })
      } else if (action === 'stop-diagnose' && role) {
        stopAgentCardDiagnostics(role)
      } else if (action === 'save' && role) {
        const form = findAgentCardForm(role, root, button)
        if (form) {
          run(async () => {
            await saveAgentCardFromForm(form, role)
            state.activeCardEditor = undefined
            renderAgentCardSurfaces()
          }, 'Agent card saved.')
        }
      } else if (action === 'setup-card' && role) {
        if (state.cartOpen) {
          state.activeCardEditor = role
          state.cardMessage = ''
          renderCartModal()
        } else {
          openSettings(settingsViewForCardRole(role))
        }
      } else if (action === 'edit' && role) {
        state.activeCardEditor = role
        state.cardMessage = ''
        if (state.cartOpen) renderCartModal()
        else openSettings(settingsViewForCardRole(role))
      } else if (action === 'publish' && role) {
        run(() => publishAgentCard(role, root))
      } else if (action === 'seller-settings') {
        selectOrderSide('seller')
      } else if (action === 'cancel-edit') {
        state.activeCardEditor = undefined
        state.cardMessage = ''
        renderAgentCardSurfaces()
      } else if (action === 'open-work') {
        state.workOrderSide = 'buyer'
        setActiveView('chat')
        state.selectedId = undefined
        renderAll()
      } else if (action === 'refresh') {
        run(async () => {
          await refreshSeller({ market: true })
          await refreshAgentCards()
          await refreshMarketRailCards()
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
        renderAgentCardSurfaces()
      }, 'Agent card saved.')
    })
  })
}

function updateCardSaveActionState(role: AgentCardRole, root: ParentNode = fields.decisionContent) {
  const button = root.querySelector<HTMLButtonElement>(`[data-card-action="save"][data-card-role="${role}"]`)
  const form = findAgentCardForm(role, root)
  if (!button || !form) return
  const hasUnsavedChanges = agentCardHasUnsavedChanges(role, form)
  const seller = role === 'seller' ? cardForRole('seller')?.manualFields.seller : undefined
  const formSeller = role === 'seller' ? sellerFieldsFromForm(new FormData(form), seller || {}) : undefined
  const sellerStructureStale = Boolean(role === 'seller' && (
    !seller?.structuredByAgent ||
    formSeller?.sellIntent !== seller.sellIntent ||
    formSeller?.pricingPrinciples !== seller.pricingPrinciples
  ))
  button.classList.toggle('is-dirty', hasUnsavedChanges)
  button.classList.toggle('is-saved', !hasUnsavedChanges)
  button.disabled = sellerStructureStale
  button.title = sellerStructureStale ? 'Regenerate the Seller Card after changing seller intent or pricing principles.' : hasUnsavedChanges ? t('card.saveDirtyTitle') : t('card.saveSavedTitle')
  button.setAttribute('aria-label', hasUnsavedChanges ? t('card.saveDirtyTitle') : t('card.saveSavedTitle'))
  const publishButton = root.querySelector<HTMLButtonElement>('[data-card-action="publish"][data-card-role="seller"]')
  if (publishButton && role === 'seller') {
    publishButton.disabled = sellerStructureStale
    if (sellerStructureStale) publishButton.title = 'Regenerate the Seller Card before publishing.'
  }
  const iconSlot = button.querySelector<HTMLElement>('.card-action-icon')
  const textSlot = button.querySelector<HTMLElement>('.card-action-text')
  if (iconSlot) iconSlot.innerHTML = hasUnsavedChanges ? cardActionIcons.save : cardActionIcons.saved
  if (textSlot) textSlot.textContent = hasUnsavedChanges ? t('card.saveDirtyText') : t('card.saveSavedText')
}

function attachCardMarketHandlers(root: ParentNode = fields.decisionContent) {
  const searchForm = root.querySelector<HTMLFormElement>('[data-card-market-form]')
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
  root.querySelectorAll<HTMLButtonElement>('[data-market-card-query]').forEach((button) => {
    button.addEventListener('click', () => {
      state.marketRailDetailId = undefined
      searchCardMarket(button.dataset.marketCardQuery || '')
    })
  })
  root.querySelectorAll<HTMLButtonElement>('[data-market-card-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      const provider = button.dataset.marketCardDetail || ''
      state.marketDetailProvider = provider
      state.marketRailDetailId = undefined
      renderCartSurface()
    })
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const target = event.target
      if (target instanceof Element && target !== button && target.closest('button')) return
      event.preventDefault()
      const provider = button.dataset.marketCardDetail || ''
      state.marketDetailProvider = provider
      state.marketRailDetailId = undefined
      renderCartSurface()
    })
  })
  root.querySelectorAll<HTMLButtonElement>('[data-market-detail-back]').forEach((button) => {
    button.addEventListener('click', () => {
      state.marketDetailProvider = undefined
      renderCartSurface()
    })
  })
  root.querySelectorAll<HTMLElement>('[data-market-rail-detail]').forEach((element) => {
    element.addEventListener('click', (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('button') && target.closest('button') !== element) event.stopPropagation()
      const id = element.dataset.marketRailDetail || ''
      state.marketDetailProvider = undefined
      state.marketRailDetailId = id
      renderCartSurface()
    })
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const target = event.target
      if (target instanceof Element && target !== element && target.closest('button')) return
      event.preventDefault()
      const id = element.dataset.marketRailDetail || ''
      state.marketDetailProvider = undefined
      state.marketRailDetailId = id
      renderCartSurface()
    })
  })
  root.querySelectorAll<HTMLButtonElement>('[data-market-rail-back]').forEach((button) => {
    button.addEventListener('click', () => {
      state.marketRailDetailId = undefined
      renderCartSurface()
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

function attachTransactionStageHandlers(container: ParentNode = fields.chatFeed) {
  container.querySelectorAll<HTMLButtonElement>('[data-transaction-stage-select]').forEach((button) => {
    button.addEventListener('click', () => {
      const thread = selectedWorkThread()
      const stageId = normalizeTransactionStageId(button.dataset.transactionStageSelect)
      if (!thread || !stageId) return
      state.transactionStageSelections[thread.id] = stageId
      pendingTransactionStageScroll = { threadId: thread.id, stageId }
      renderChat()
      const selectedStage = fields.transactionOverlay.querySelector<HTMLElement>('.transaction-stage-button.selected')
      window.requestAnimationFrame(() => selectedStage?.scrollIntoView({ block: 'nearest', inline: 'center' }))
    })
  })
  container.querySelectorAll<HTMLButtonElement>('[data-transaction-stage-card]').forEach((button) => {
    button.addEventListener('click', () => {
      const thread = selectedWorkThread()
      const stageId = normalizeTransactionStageId(button.dataset.transactionStageCard)
      if (!thread || !stageId) return
      state.transactionStageSelections[thread.id] = stageId
      updateTransactionStageSelectionDom(stageId)
    })
  })
  container.querySelectorAll<HTMLButtonElement>('[data-transaction-stage-detail-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const thread = selectedWorkThread()
      const stageId = button.dataset.transactionStageDetailToggle || ''
      if (!thread || !stageId) return
      const key = transactionStageDetailCollapseKey(thread, stageId)
      const collapsed = !transactionStageDetailIsCollapsed(thread, stageId)
      state.transactionStageDetailCollapsed[key] = collapsed
      const detail = button.closest<HTMLElement>('.transaction-stage-detail')
      detail?.classList.toggle('collapsed', collapsed)
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
      const label = button.querySelector('span')
      if (label) label.textContent = collapsed ? 'Show' : 'Hide'
      if (!collapsed) {
        detail?.querySelector<HTMLElement>('.transaction-stage-detail-expanded')?.scrollTo({ top: 0 })
      }
    })
  })
}

function updateTransactionStageSelectionDom(stageId: string) {
  fields.chatFeed.querySelectorAll<HTMLButtonElement>('[data-transaction-stage-card]').forEach((item) => {
    const selected = item.dataset.transactionStageCard === stageId
    item.classList.toggle('selected', selected)
    item.setAttribute('aria-pressed', String(selected))
  })
  fields.transactionOverlay.querySelectorAll<HTMLButtonElement>('[data-transaction-stage-select]').forEach((item) => {
    const selected = item.dataset.transactionStageSelect === stageId
    item.classList.toggle('selected', selected)
    item.setAttribute('aria-pressed', String(selected))
  })
}

function routeExpandedTransactionStageWheel(event: WheelEvent) {
  if (event.ctrlKey) return
  const target = event.target instanceof Element ? event.target : undefined
  if (target?.closest('.buyer-entry-stack, .chat-composer, textarea, input, select')) return
  const detail = fields.transactionOverlay.querySelector<HTMLElement>('.transaction-stage-detail:not(.collapsed)')
  const scroller = detail?.querySelector<HTMLElement>('.transaction-stage-detail-expanded')
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) return
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE
    ? scroller.clientHeight
    : event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : 1
  const deltaY = event.deltaY * unit
  const deltaX = event.deltaX * unit
  if (Math.abs(deltaY) < 0.5 && Math.abs(deltaX) < 0.5) return
  scroller.scrollTop += deltaY
  scroller.scrollLeft += deltaX
  event.preventDefault()
  event.stopPropagation()
}

function attachDecisionHandlers(container: ParentNode = fields.decisionContent) {
  container.querySelectorAll<HTMLButtonElement>('[data-select-plan]').forEach((button) => {
    const plan = state.orderPlans.find((item) => item.planId === button.dataset.selectPlan)
    const option = plan?.options?.find((item) => item.optionId === button.dataset.optionId)
    if (plan && isDemoOrderPlan(plan)) {
      button.disabled = true
      button.title = 'Demo transaction'
      return
    }
    button.addEventListener('click', () => plan && option && chooseOrderOption(plan, option))
  })
  container.querySelectorAll<HTMLButtonElement>('[data-cancel-plan]').forEach((button) => {
    const plan = state.orderPlans.find((item) => item.planId === button.dataset.cancelPlan)
    if (plan && isDemoOrderPlan(plan)) {
      button.disabled = true
      button.title = 'Demo transaction'
      return
    }
    button.addEventListener('click', () => plan && cancelOrderPlan(plan))
  })
  container.querySelectorAll<HTMLButtonElement>('[data-approve]').forEach((button) => {
    const approval = state.approvals.find((item) => item.approvalId === button.dataset.approve)
    if (approval && isDemoApproval(approval)) {
      button.disabled = true
      button.title = 'Demo transaction'
      return
    }
    button.addEventListener('click', () => approval && chooseApproval(approval, true))
  })
  container.querySelectorAll<HTMLButtonElement>('[data-reject]').forEach((button) => {
    const approval = state.approvals.find((item) => item.approvalId === button.dataset.reject)
    if (approval && isDemoApproval(approval)) {
      button.disabled = true
      button.title = 'Demo transaction'
      return
    }
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
  if (isGpuDemoOrderPlan(plan)) {
    const seller = gpuDemoSellerFromOption(option)
    if (seller) chooseGpuDemoSeller(seller.id)
    return
  }
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
    if (step.action.kind === 'gpu_demo_payment') {
      completeGpuDemoPayment(step.pin)
      return
    }
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
        userNote: 'Seller selected in Exora Desktop transaction view',
        paymentPin,
      },
    })
    state.pinStep = undefined
    bindActiveChatToTask(response.task)
    if (response.task?.id) state.selectedId = selectionId('task', response.task.id)
    pushMessage({ role: 'assistant', text: 'Owner selected a seller. The local ledger has been updated.', meta: 'Transaction' })
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
        userNote: approved ? 'Approved in Exora Desktop transaction view' : 'Rejected in Exora Desktop transaction view',
        paymentPin,
      },
    })
    state.pinStep = undefined
    bindActiveChatToTask(response.task)
    if (response.task?.id) state.selectedId = selectionId('task', response.task.id)
    pushMessage({ role: 'assistant', text: approved ? 'Approval accepted.' : 'Approval rejected.', meta: 'Transaction' })
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
        input: { planId: plan.planId, userNote: 'Cancelled in Exora Desktop transaction view' },
      })
      pushMessage({ role: 'system', text: `Cancelled seller choice ${shortID(plan.planId)}.`, meta: 'Transaction' })
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

function sellerApiReady() {
  const sellerProfile = state.sellerLLMProfileId
    ? state.llmProfiles.find((profile) => profile.id === state.sellerLLMProfileId)
    : undefined
  return Boolean(
    state.sellerSettings?.hasApiKey ||
    sellerProfile?.hasApiKey ||
    sellerProfile?.keyFormat === 'not_required',
  )
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
  const task = approval.taskId ? state.tasks.find((item) => item.id === approval.taskId) : undefined
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
  if (thread.side) return thread.side
  return 'buyer'
}

function defaultWorkProjectPath() {
  return defaultWorkProjectFolder().path
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
  const task = approval.taskId ? state.tasks.find((item) => item.id === approval.taskId) : undefined
  if (!task && approval.planId) {
    const plan = state.orderPlans.find((item) => item.planId === approval.planId)
    if (plan) return projectPathForPlan(plan)
  }
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
  return defaultWorkProjectPath()
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
  if (state.workOrderSide === 'seller') {
    fields.externalWorkLock.classList.add('hidden')
    agentQuery.disabled = state.busy
    agentSendButton.disabled = state.busy || !agentSessionCanReceiveMessage(currentInteractiveAgentSession())
    agentQuery.placeholder = 'Message the bound seller Agent...'
    return
  }
  app.querySelectorAll<HTMLButtonElement>('.composer-mcp-copy-button').forEach((button) => {
    button.classList.remove('hidden')
  })
  const lease = activeExternalWorkLease()
  const run = activeExternalWorkRun()
  const locked = Boolean(lease || run) && !currentInteractiveAgentSession()
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
    subtitle: `${approvalSubjectLabel(approval)} / ${approvalAmount(approval)}`,
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

const sampleWorkflowStageDefinitions = [
  { id: 'start_confirmation', title: 'Start confirmation', detail: 'Owner approves the local agent to start the market flow.' },
  { id: 'buyer_planning', title: 'Buyer planning', detail: 'Local buyer agent gathers goals, limits, files, and success criteria.' },
  { id: 'buyer_manifest_review', title: 'Manifest review', detail: 'Owner reviews the manifest before cloud matching or sensitive input disclosure.' },
  { id: 'cloud_matching', title: 'Cloud matching', detail: 'Cloud receives only the approved business event and finds seller cards.' },
  { id: 'seller_valuation', title: 'Seller valuation', detail: 'Seller returns a quote, negotiation request, or policy rejection.' },
  { id: 'quote_review', title: 'Quote review', detail: 'Buyer compares price, policy, risk, and seller terms.' },
  { id: 'order_authorized', title: 'Order authorized', detail: 'Owner approves the chosen quote, payment intent, and disclosed inputs.' },
  { id: 'input_transfer', title: 'Input transfer', detail: 'Only authorized files, hashes, and scope reach the provider.' },
  { id: 'provider_execution', title: 'Provider execution', detail: 'Provider Docker or managed API performs the approved task.' },
  { id: 'terminal_report', title: 'Terminal report', detail: 'Seller reports success, blocked state, or unrecoverable failure.' },
  { id: 'buyer_verification', title: 'Buyer verification', detail: 'Buyer validates artifacts, terminal logs, and expected outputs.' },
  { id: 'settlement_cleanup', title: 'Settlement/cleanup', detail: 'Payment is released, refunded, or disputed; cleanup receipt is archived.' },
]

const sampleMarketTransactionRecords: SampleMarketTransaction[] = [
  {
    id: 'sample-buyer-gpu-inference-completed',
    side: 'buyer',
    tone: 'mint',
    title: 'GPU inference completed',
    status: 'closed / success',
    subtitle: '2.80 USDC settled / 3 artifacts / cleanup receipt',
    summary: 'Buyer approved an A6000 quote, Provider Docker ran the inference batch, artifacts were verified by hash, escrow released, and input cleanup was receipted.',
    state: 'closed',
    currentStageId: 'settlement_cleanup',
    currentStageStatus: 'active',
    owner: 'local_agent',
    waitingFor: 'none',
    nextAction: 'No action required; receipt archived.',
    terminalReason: 'success_settled',
    provider: 'gpu-forge-a6000',
    amount: '2.80 USDC',
    updatedAt: '2026-07-07T09:24:00.000Z',
    metrics: [
      { label: 'Quote', value: '2.80 USDC', hint: 'Accepted after owner quote review' },
      { label: 'Artifacts', value: '3 files', hint: 'Results, metrics, and terminal report' },
      { label: 'Cleanup', value: 'receipt', hint: 'Provider input deletion receipt archived' },
    ],
    chips: ['manifest approved', 'hash verified', 'escrow released', 'cleanup receipt'],
    facts: [
      { label: 'Plan', value: 'plan_gpu_eval_42' },
      { label: 'Order', value: 'order_gpu_9q2m' },
      { label: 'Task', value: 'task_infer_a6000_7f1' },
      { label: 'Payment', value: 'pay_usdc_2_80_confirmed' },
      { label: 'Manifest', value: 'manifest_sha256_8bd2' },
      { label: 'Source', value: 'signed_buyer_manifest' },
      { label: 'Signature', value: 'buyer_sig_0x7b3a' },
    ],
    events: [
      { label: 'Settlement closed', detail: 'Buyer verified artifacts and released escrow.', timestamp: '2026-07-07T09:24:00.000Z', tone: 'good' },
      { label: 'Terminal report received', detail: 'Provider returned logs, hashes, and cleanup receipt.', timestamp: '2026-07-07T09:18:00.000Z', tone: 'good' },
      { label: 'Docker execution completed', detail: 'Inference batch finished inside the authorized container.', timestamp: '2026-07-07T09:12:00.000Z', tone: 'good' },
    ],
  },
  {
    id: 'sample-buyer-render-quote-inputs',
    side: 'buyer',
    tone: 'lime',
    title: 'Render quote needs inputs',
    status: 'needs negotiation',
    subtitle: 'Seller needs frame range / codec / max spend',
    summary: 'Cloud matching found a render seller, but valuation paused because the seller needs the exact frame range, output codec, and budget cap before quoting.',
    state: 'seller_valuation',
    currentStageId: 'seller_valuation',
    currentStageStatus: 'waiting',
    owner: 'buyer_user',
    waitingFor: 'user_input',
    nextAction: 'Add frame range, output codec, and max spend; no quote has been accepted.',
    provider: 'render-bay-west',
    amount: 'quote pending',
    updatedAt: '2026-07-07T08:41:00.000Z',
    metrics: [
      { label: 'Quote', value: 'pending', hint: 'Seller valuation is blocked by missing inputs' },
      { label: 'Missing', value: '3 inputs', hint: 'Frame range, codec, max spend' },
      { label: 'Payment', value: 'none', hint: 'No payment can start before quote acceptance' },
    ],
    chips: ['negotiation', 'no payment', 'manifest scoped', 'owner input'],
    facts: [
      { label: 'Plan', value: 'plan_render_aa31' },
      { label: 'Order', value: 'order_render_pending' },
      { label: 'Manifest', value: 'manifest_render_sha256_4c91' },
      { label: 'Candidate', value: 'render-bay-west' },
      { label: 'Missing scope', value: 'frames_codec_budget' },
      { label: 'Cloud event', value: 'valuation_requested' },
    ],
    events: [
      { label: 'Negotiation requested', detail: 'Seller asked for frame range, codec, and budget cap.', timestamp: '2026-07-07T08:41:00.000Z', tone: 'warn' },
      { label: 'Manifest approved', detail: 'Owner approved cloud matching for a scoped render request.', timestamp: '2026-07-07T08:34:00.000Z', tone: 'good' },
      { label: 'Local planning complete', detail: 'Buyer agent prepared the initial render manifest.', timestamp: '2026-07-07T08:30:00.000Z', tone: 'normal' },
    ],
  },
  {
    id: 'sample-buyer-travel-api-consent',
    side: 'buyer',
    tone: 'sky',
    title: 'Travel API consent required',
    status: 'approval required',
    subtitle: 'Managed API quote ready / booking blocked',
    summary: 'A managed travel API seller returned a quote and itinerary. Booking, payment, and external writes remain blocked until the owner explicitly approves the scope.',
    state: 'order_authorized',
    currentStageId: 'order_authorized',
    currentStageStatus: 'waiting',
    owner: 'buyer_user',
    waitingFor: 'user_approval',
    nextAction: 'Approve or reject the itinerary and API write scope; no booking or payment has run.',
    provider: 'concierge-api-seller',
    amount: '18.00 USDC quote',
    updatedAt: '2026-07-07T07:52:00.000Z',
    metrics: [
      { label: 'Quote', value: '18.00 USDC', hint: 'Ready for owner approval' },
      { label: 'Consent', value: 'required', hint: 'External booking is a sensitive action' },
      { label: 'Payment', value: 'none', hint: 'Escrow not funded before consent' },
    ],
    chips: ['managed API', 'external write', 'no booking yet', 'human approval'],
    facts: [
      { label: 'Plan', value: 'plan_travel_api_62' },
      { label: 'Order', value: 'order_travel_quote' },
      { label: 'Approval', value: 'approval_booking_scope' },
      { label: 'Quote', value: 'quote_18_usdc_itinerary' },
      { label: 'Scope', value: 'hold_and_book_after_consent' },
      { label: 'Payment', value: 'not_created' },
    ],
    events: [
      { label: 'Owner approval opened', detail: 'Booking and payment are blocked until consent.', timestamp: '2026-07-07T07:52:00.000Z', tone: 'warn' },
      { label: 'Quote returned', detail: 'Seller provided itinerary, fee, and managed API scope.', timestamp: '2026-07-07T07:49:00.000Z', tone: 'good' },
      { label: 'Cloud matched seller', detail: 'Only approved travel constraints were sent for matching.', timestamp: '2026-07-07T07:43:00.000Z', tone: 'normal' },
    ],
  },
  {
    id: 'sample-buyer-data-request-rejected',
    side: 'buyer',
    tone: 'coral',
    title: 'Data request rejected',
    status: 'closed / rejected',
    subtitle: 'All sellers rejected provenance boundary',
    summary: 'The buyer asked for a private dataset extraction. Sellers rejected the manifest because provenance and disclosure boundaries could not be satisfied.',
    state: 'closed',
    currentStageId: 'seller_valuation',
    currentStageStatus: 'failed',
    owner: 'cloud',
    waitingFor: 'none',
    nextAction: 'Use public filings or provide lawful provenance before restarting.',
    terminalReason: 'all_rejected_policy_boundary',
    provider: 'multiple sellers',
    amount: 'none',
    updatedAt: '2026-07-07T06:18:00.000Z',
    metrics: [
      { label: 'Rejections', value: '3 sellers', hint: 'All valuation responses rejected the request' },
      { label: 'Data sent', value: 'none', hint: 'No sensitive input was transferred' },
      { label: 'Payment', value: 'none', hint: 'No quote was accepted' },
    ],
    chips: ['all rejected', 'provenance boundary', 'no data transfer', 'auditable close'],
    facts: [
      { label: 'Plan', value: 'plan_data_extract_17' },
      { label: 'Manifest', value: 'manifest_data_boundary_sha256_12af' },
      { label: 'Rejected by', value: '3_seller_cards' },
      { label: 'Terminal', value: 'all_rejected_policy_boundary' },
      { label: 'Alternative', value: 'public_filings_search' },
      { label: 'Payment', value: 'not_created' },
    ],
    events: [
      { label: 'Terminal close', detail: 'All sellers rejected due to provenance and disclosure limits.', timestamp: '2026-07-07T06:18:00.000Z', tone: 'bad' },
      { label: 'Seller valuation rejected', detail: 'No provider accepted the requested data boundary.', timestamp: '2026-07-07T06:15:00.000Z', tone: 'bad' },
      { label: 'Manifest reviewed', detail: 'Only the business request was sent; no private dataset moved.', timestamp: '2026-07-07T06:11:00.000Z', tone: 'normal' },
    ],
  },
  {
    id: 'sample-seller-a6000-job-running',
    side: 'seller',
    tone: 'lavender',
    title: 'A6000 job running',
    status: 'provider execution',
    subtitle: 'Payment hold confirmed / Docker heartbeat local',
    summary: 'Seller accepted a scoped GPU inference order. Payment hold and input receipt are confirmed; Docker execution is running with local heartbeat only.',
    state: 'provider_execution',
    currentStageId: 'provider_execution',
    currentStageStatus: 'active',
    owner: 'provider_docker',
    waitingFor: 'local_supervisor',
    nextAction: 'Continue execution and send a terminal report when artifacts are ready.',
    provider: 'local-seller-a6000',
    amount: '2.40 USDC hold',
    updatedAt: '2026-07-07T09:03:00.000Z',
    metrics: [
      { label: 'Payment', value: 'hold ok', hint: 'Escrow evidence is confirmed before execution' },
      { label: 'Heartbeat', value: 'local', hint: 'Five-minute heartbeat remains local only' },
      { label: 'ETA', value: '14m', hint: 'Estimated time until terminal report' },
    ],
    chips: ['seller side', 'Docker running', 'payment hold', 'local heartbeat'],
    facts: [
      { label: 'Plan', value: 'plan_gpu_buyer_88' },
      { label: 'Order', value: 'order_seller_gpu_27' },
      { label: 'Task', value: 'task_provider_job_a6000' },
      { label: 'Payment', value: 'pay_hold_usdc_2_40' },
      { label: 'Worker', value: 'docker_job_6f31' },
      { label: 'Manifest', value: 'manifest_bound_inputs_9dd0' },
    ],
    events: [
      { label: 'Heartbeat local', detail: 'Supervisor recorded Docker progress; cloud was not pinged.', timestamp: '2026-07-07T09:03:00.000Z', tone: 'normal' },
      { label: 'Execution plan created', detail: 'Seller wrote the resumable step list before running.', timestamp: '2026-07-07T08:56:00.000Z', tone: 'good' },
      { label: 'Input receipt verified', detail: 'Payment hold, manifest hash, and files matched the authorization.', timestamp: '2026-07-07T08:53:00.000Z', tone: 'good' },
    ],
  },
  {
    id: 'sample-seller-managed-api-blocked',
    side: 'seller',
    tone: 'graphite',
    title: 'Managed API blocked',
    status: 'execution blocked',
    subtitle: 'API write scope waits for buyer consent',
    summary: 'Seller prepared a managed API action, but the requested write scope exceeds the consent envelope. No external write has been performed.',
    state: 'execution_blocked',
    currentStageId: 'provider_execution',
    currentStageStatus: 'blocked',
    owner: 'seller_agent',
    waitingFor: 'buyer_user',
    nextAction: 'Wait for buyer consent or return a blocked terminal report.',
    terminalReason: 'consent_missing_for_write_scope',
    provider: 'managed-api-seller',
    amount: '9.50 USDC quote',
    updatedAt: '2026-07-07T08:12:00.000Z',
    metrics: [
      { label: 'Scope', value: 'write API', hint: 'External write requires explicit approval' },
      { label: 'Consent', value: 'missing', hint: 'Buyer has not approved this scope' },
      { label: 'Payment', value: 'paused', hint: 'Execution does not proceed while blocked' },
    ],
    chips: ['seller side', 'managed API', 'blocked', 'no external write'],
    facts: [
      { label: 'Plan', value: 'plan_api_write_51' },
      { label: 'Order', value: 'order_api_blocked' },
      { label: 'Task', value: 'task_api_scope_check' },
      { label: 'Approval', value: 'approval_scope_missing' },
      { label: 'Blocked reason', value: 'consent_missing_for_write_scope' },
      { label: 'External action', value: 'not_performed' },
    ],
    events: [
      { label: 'Execution blocked', detail: 'Seller halted before managed API write because consent was missing.', timestamp: '2026-07-07T08:12:00.000Z', tone: 'warn' },
      { label: 'Scope check failed', detail: 'Requested API write exceeded the approved envelope.', timestamp: '2026-07-07T08:11:00.000Z', tone: 'warn' },
      { label: 'Quote reviewed', detail: 'Buyer reviewed price, but write consent was not granted.', timestamp: '2026-07-07T08:03:00.000Z', tone: 'normal' },
    ],
  },
]

function sampleMarketTransactions(side: OrderSide = state.marketOrderSide) {
  return sampleMarketTransactionRecords.filter((record) => record.side === side)
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
  fields.orderRoleRow.classList.add('hidden')
  fields.folderPickerButton.classList.add('hidden')
  if (state.activeView !== 'settings') renderOrderRoleControls()
  const side = state.workOrderSide
  const sideLabel = side === 'buyer' ? t('orderSide.buyer') : t('orderSide.seller')
  fields.sidebarTitle.textContent = state.activeView === 'settings'
    ? 'Settings'
    : `${sideLabel} Transactions`
  fields.projectFolderHead.classList.add('hidden')
  fields.newChatButton.classList.add('hidden')
  fields.newChatButton.classList.remove('v3-history-header-refresh', 'is-loading')
  fields.newChatButton.style.visibility = 'hidden'
  fields.newChatButton.disabled = true
  fields.newChatButton.setAttribute('aria-hidden', 'true')
  fields.newChatButton.tabIndex = -1
  fields.newChatButton.dataset.mode = 'new-chat'
  fields.newChatButton.innerHTML = toolbarIcons.plus
  app.querySelectorAll<HTMLButtonElement>('[data-order-side-tab]').forEach((button) => {
    const tabSide = button.dataset.orderSideTab as OrderSide
    const isActive = tabSide === side
    button.classList.toggle('active', isActive)
    button.setAttribute('aria-pressed', String(isActive))
  })
}

function renderOrderRoleControls() {
  const side = state.workOrderSide
  const label = side === 'buyer' ? t('orderSide.buyer') : t('orderSide.seller')
  const next = side === 'buyer' ? t('orderSide.seller') : t('orderSide.buyer')
  fields.orderSideToggle.dataset.side = side
  fields.orderSideToggle.setAttribute('aria-pressed', String(side === 'seller'))
  fields.orderSideToggle.setAttribute('aria-label', t('orderSide.label', { label, next }))
  fields.orderSideToggle.setAttribute('title', t('orderSide.title', { next }))
  fields.orderSideState.textContent = label
}

function attachSellerStoreSummaryHandlers(root: ParentNode = fields.ledgerList) {
  root.querySelectorAll<HTMLButtonElement>('[data-seller-store-action]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const action = button.dataset.sellerStoreAction
      if (action === 'api') state.v3SellerTab = 'api_bridge'
      if (action === 'seller') state.v3SellerTab = 'listings'
      if (action === 'card') state.v3SellerTab = 'listings'
      selectOrderSide('seller')
    })
  })
}

function renderOrderActivitySidebar() {
  const records = state.v3ActivitySessions[state.workOrderSide]
  const sideLabel = state.workOrderSide === 'buyer' ? t('orderSide.buyer') : t('orderSide.seller')
  const hasActiveFilters = state.v3ActivityKindFilter !== 'all' || state.v3ActivityStatusFilter !== 'all'
  fields.sidebarTitle.textContent = uiText('Order history')
  fields.ledgerCount.classList.remove('hidden')
  fields.ledgerCount.textContent = String(records.length)
  setLedgerEmpty(false)
  const loading = state.v3ActivityLoading[state.workOrderSide]
  const error = state.v3ActivityErrors[state.workOrderSide]
  fields.newChatButton.classList.remove('hidden')
  fields.newChatButton.classList.add('v3-history-header-refresh')
  fields.newChatButton.classList.toggle('is-loading', loading)
  fields.newChatButton.style.visibility = 'visible'
  fields.newChatButton.disabled = loading
  fields.newChatButton.setAttribute('aria-hidden', 'false')
  fields.newChatButton.setAttribute('aria-label', 'Refresh history')
  fields.newChatButton.setAttribute('title', 'Refresh history')
  fields.newChatButton.tabIndex = 0
  fields.newChatButton.dataset.mode = 'history-refresh'
  fields.newChatButton.innerHTML = toolbarIcons.refresh
  fields.ledgerList.innerHTML = `
    <section class="v3-history-sidebar" aria-label="${escapeAttr(sideLabel)} order history">
      <div class="v3-history-tools">
        <span class="v3-history-filter-mark" aria-hidden="true">${toolbarIcons.filter}</span>
        <div class="v3-history-filter-bar" aria-label="Order history filters">
          <label class="v3-history-filter ${state.v3ActivityKindFilter !== 'all' ? 'is-active' : ''}">
            <select data-v3-history-kind aria-label="Filter by product type" title="Filter by product type">
              <option value="all" ${state.v3ActivityKindFilter === 'all' ? 'selected' : ''}>All types</option>
              <option value="compute" ${state.v3ActivityKindFilter === 'compute' ? 'selected' : ''}>Compute</option>
              <option value="download" ${state.v3ActivityKindFilter === 'download' ? 'selected' : ''}>Download</option>
              <option value="api_operation" ${state.v3ActivityKindFilter === 'api_operation' ? 'selected' : ''}>API</option>
            </select>
          </label>
          <span class="v3-history-filter-divider" aria-hidden="true"></span>
          <label class="v3-history-filter ${state.v3ActivityStatusFilter !== 'all' ? 'is-active' : ''}">
            <select data-v3-history-status aria-label="Filter by status" title="Filter by status">
              <option value="all" ${state.v3ActivityStatusFilter === 'all' ? 'selected' : ''}>All states</option>
              <option value="active" ${state.v3ActivityStatusFilter === 'active' ? 'selected' : ''}>Active</option>
              <option value="completed" ${state.v3ActivityStatusFilter === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="needs_attention" ${state.v3ActivityStatusFilter === 'needs_attention' ? 'selected' : ''}>Needs review</option>
            </select>
          </label>
        </div>
        ${hasActiveFilters ? `<button class="v3-history-clear-filters" type="button" data-v3-history-clear aria-label="Clear history filters" title="Clear filters">${windowIcons.close}</button>` : ''}
      </div>
      <div class="v3-history-list ${error && !records.length ? 'is-centered' : ''}" data-v3-history-list aria-live="polite">
        ${loading && !records.length ? '<div class="v3-history-state is-loading"><span class="v3-history-state-spinner" aria-hidden="true"></span><strong>Loading history&hellip;</strong><small>Fetching your latest activity.</small></div>' : ''}
        ${error ? `<div class="v3-history-state error" role="status"><span class="v3-history-state-icon" aria-hidden="true">${toolbarIcons.emptyContent}</span><p>Order history is currently unavailable.</p></div>` : ''}
        ${!loading && !error && !records.length ? `<div class="v3-history-state is-empty"><span class="v3-history-state-icon" aria-hidden="true">${toolbarIcons.emptyContent}</span><strong>No ${escapeHTML(sideLabel.toLowerCase())} orders yet</strong><small>Purchases and resource sessions will appear here.</small></div>` : ''}
        ${records.length ? '<div class="v3-history-state v3-history-no-results hidden" data-v3-history-no-results><strong>No matching orders</strong><small>Try a different type or state.</small></div>' : ''}
        ${records.map(renderV3HistoryRow).join('')}
      </div>
    </section>
  `
  attachV3HistoryHandlers()
  applyV3HistoryFilters()
}

function v3ActivityKindLabel(kind: string) {
  if (kind === 'compute') return 'VM'
  if (kind === 'download') return 'FILE'
  return 'API'
}

function v3ActivityStatusLabel(status: string) {
  if (status === 'active') return 'Active'
  if (status === 'needs_attention') return 'Needs review'
  if (status === 'completed') return 'Completed'
  return status.replaceAll('_', ' ')
}

function v3AtomicMoney(value: number, asset = 'USDC') {
  const amount = Number(value || 0) / 1_000_000
  const digits = amount >= 100 ? 2 : amount >= 1 ? 3 : 4
  return `${amount.toFixed(digits).replace(/\.?0+$/, '') || '0'} ${asset || 'USDC'}`
}

function renderV3HistoryRow(record: V3ActivitySession) {
  const active = record.sessionId === state.selectedV3ActivitySessionId
  const statusLabel = v3ActivityStatusLabel(record.status)
  return `
    <button class="v3-history-row ${active ? 'active' : ''}" type="button" data-v3-history-session="${escapeAttr(record.sessionId)}" data-kind="${escapeAttr(record.productKind)}" data-status="${escapeAttr(record.status)}" title="${escapeAttr([record.productTitle, record.outcome, v3AtomicMoney(record.amountAtomic, record.asset), compactTimestamp(record.updatedAt)].join(' / '))}" aria-pressed="${active}">
      <span class="v3-history-kind kind-${escapeAttr(record.productKind)}" aria-hidden="true">${v3ActivityKindLabel(record.productKind)}</span>
      <span class="v3-history-copy">
        <strong>${escapeHTML(record.productTitle || 'Resource session')}</strong>
        <small>${escapeHTML(compactTimestamp(record.updatedAt))}</small>
      </span>
      <span class="v3-history-meta">
        <span class="v3-history-amount">${escapeHTML(v3AtomicMoney(record.amountAtomic, record.asset))}</span>
        <span class="v3-history-status ${escapeAttr(record.status)}"><i aria-hidden="true"></i>${escapeHTML(statusLabel)}</span>
      </span>
    </button>
  `
}

function applyV3HistoryFilters() {
  let visible = 0
  fields.ledgerList.querySelectorAll<HTMLElement>('[data-v3-history-session]').forEach((row) => {
    const matches = (state.v3ActivityKindFilter === 'all' || row.dataset.kind === state.v3ActivityKindFilter)
      && (state.v3ActivityStatusFilter === 'all' || row.dataset.status === state.v3ActivityStatusFilter)
    row.classList.toggle('hidden', !matches)
    if (matches) visible += 1
  })
  fields.ledgerList.querySelector<HTMLElement>('[data-v3-history-no-results]')?.classList.toggle('hidden', visible > 0)
  fields.ledgerCount.textContent = String(visible)
}

function attachV3HistoryHandlers() {
  fields.ledgerList.querySelectorAll<HTMLButtonElement>('[data-v3-history-session]').forEach((button) => {
    button.addEventListener('click', () => selectV3ActivitySession(button.dataset.v3HistorySession || ''))
  })
  fields.ledgerList.querySelector<HTMLSelectElement>('[data-v3-history-kind]')?.addEventListener('change', (event) => {
    state.v3ActivityKindFilter = (event.currentTarget as HTMLSelectElement).value as typeof state.v3ActivityKindFilter
    renderOrderActivitySidebar()
  })
  fields.ledgerList.querySelector<HTMLSelectElement>('[data-v3-history-status]')?.addEventListener('change', (event) => {
    state.v3ActivityStatusFilter = (event.currentTarget as HTMLSelectElement).value as typeof state.v3ActivityStatusFilter
    renderOrderActivitySidebar()
  })
  fields.ledgerList.querySelector<HTMLButtonElement>('[data-v3-history-clear]')?.addEventListener('click', () => {
    state.v3ActivityKindFilter = 'all'
    state.v3ActivityStatusFilter = 'all'
    renderOrderActivitySidebar()
  })
}

function renderWorkTaskRecord(record: OrderActivityRecord, selectedChat?: ChatThread, extraClass = '') {
  const active = orderActivityIsActive(record, selectedChat)
  const unread = state.workTaskState.unreadIds.has(record.threadId)
  const pinned = state.workTaskState.pinnedIds.has(record.threadId)
  const amountLabel = record.amountLabel || '--'
  const statusLabel = record.statusLabel || record.stageLabel || '--'
  const details = [amountLabel, statusLabel, record.stageLabel, record.providerLabel, record.timestampLabel].filter(Boolean)
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
    <button class="${classes}" data-order-activity data-order-thread-id="${escapeAttr(record.threadId)}" data-order-chat-id="${escapeAttr(record.chatId || '')}" data-order-select="${escapeAttr(record.primarySelectionId || '')}" data-order-project-path="${escapeAttr(record.projectPath)}" data-order-side="${escapeAttr(record.side)}" data-stage-status="${escapeAttr(record.stageStatus)}" title="${escapeAttr([record.title, record.stageLabel, record.statusLabel, ...details].filter(Boolean).join(' / '))}">
      <span class="transaction-record-rail" aria-hidden="true"></span>
      <span class="transaction-record-body">
        <span class="transaction-record-head">
          <strong>${escapeHTML(compactText(record.title, 50))}</strong>
        </span>
        <span class="transaction-record-meta">
          <span class="transaction-record-amount">${escapeHTML(compactText(amountLabel, 28))}</span>
          <span class="transaction-record-separator" aria-hidden="true">/</span>
          <span class="transaction-record-status">${escapeHTML(compactText(statusLabel, 32))}</span>
        </span>
      </span>
      <span class="transaction-record-indicators" aria-hidden="true">
        ${pinned ? '<span class="transaction-record-pin">Pinned</span>' : ''}
        ${unread ? '<span class="transaction-record-unread"></span>' : ''}
      </span>
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
  attachOrderActivityHandlers(fields.ledgerList)
}

function attachOrderActivityHandlers(root: ParentNode, contextMenu = true) {
  root.querySelectorAll<HTMLButtonElement>('[data-order-activity]').forEach((button) => {
    button.addEventListener('click', () => selectWorkThreadFromButton(button))
    button.addEventListener('contextmenu', (event) => {
      if (!contextMenu) {
        event.preventDefault()
        return
      }
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
  state.sellerWorkspaceMode = 'transactions'
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

function orderActivityRecordMeta(thread: WorkThread) {
  const snapshot = buildTransactionProgressSnapshot(thread, thread.side)
  const selectedStage = snapshot.stages.find((stage) => stage.id === snapshot.currentStageId)
  const status = firstDisplayText(thread.status, snapshot.state, selectedStage?.status)
  const provider = snapshot.provider || thread.providerPubkey || ''
  return {
    side: thread.side,
    stageLabel: selectedStage?.title || progressStateLabel(snapshot.currentStageId),
    stageStatus: (selectedStage?.status || 'pending') as TransactionProgressStage['status'],
    statusLabel: progressStateLabel(status),
    amountLabel: firstDisplayText(snapshot.quote, snapshot.payment),
    providerLabel: provider ? `Provider ${shortID(provider)}` : '',
    timestampLabel: thread.timestamp ? compactTimestamp(thread.timestamp) : '',
  }
}

function workThreadIdForChat(thread: ChatThread) {
  if (thread.orderId) return `order:${thread.orderId}`
  const task = thread.taskIds?.map((id) => state.tasks.find((item) => item.id === id)).find(Boolean)
  if (task) return workThreadIdForTask(task)
  if (thread.workThreadId) return thread.workThreadId
  return `chat:${thread.id}`
}

function workThreadIdForPlan(plan: OrderPlan) {
  const task = taskForPlan(plan)
  if (task) return workThreadIdForTask(task)
  return `order:${plan.planId}`
}

function workThreadIdForApproval(approval: Approval) {
  const task = approval.taskId ? state.tasks.find((item) => item.id === approval.taskId) : undefined
  return task ? workThreadIdForTask(task) : approvalThreadKey(approval)
}

function workThreadIdForTask(task: Task) {
  return `order:${task.orderId || task.id}`
}

function workThreadIdForPayment(payment: PaymentRecord) {
  const task = payment.taskId ? state.tasks.find((item) => item.id === payment.taskId) : undefined
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
  return workThreads().map((thread) => {
    const meta = orderActivityRecordMeta(thread)
    return {
      id: thread.id,
      threadId: thread.id,
      title: thread.title,
      subtitle: thread.subtitle,
      timestamp: thread.timestamp,
      projectPath: thread.projectPath || defaultWorkProjectPath(),
      ...meta,
      chatId: thread.chatId,
      primarySelectionId: thread.primarySelectionId,
    }
  })
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
    if (isDemoOrderPlan(plan)) continue
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
    if (isDemoApproval(approval)) continue
    if (!quiet && approval.agentId !== 'exora-desktop-agent') {
      if (projectPathIsActive(projectPathForApproval(approval))) {
        pushMessage({ role: 'system', text: `External agent requested approval for ${approvalSubjectLabel(approval)}.`, meta: agentSourceLabel(approval.agentId) })
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
  renderLedger()
  renderContextStrip()
  renderDecisionPanel()
  renderExternalWorkLockControls()
  renderChatAgentControl()
  renderMarketProjectPicker()
  renderCartModal()
  syncTransactionProgressPolling()
  localize()
}

function renderSeller(settings: SellerSettings) {
  if (!sellerForm) return
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
  if (!buyerAgentForm || !fields.buyerAgentChip) return
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
  if (!llmSettingsForm || !fields.llmProfileList) return
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
  if (!fields.llmTestNote) return
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
  if (!fields.sellerMarketChip) return
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
          reason: 'Owner took over this transaction in Exora Dock.',
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
    return `${result.summary || `Found ${candidates} matching seller(s).`} I prepared ${Math.min(options || candidates, 6)} owner-selectable option(s) in the transaction list.`
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

function sellerPayloadFromState(patch: Partial<SellerSettings> = {}) {
  const settings = state.sellerSettings
  return {
    enabled: patch.enabled ?? settings?.enabled ?? false,
    autoQuote: settings?.autoQuote ?? false,
    autoAcceptLowRisk: settings?.autoAcceptLowRisk ?? settings?.autoCompleteTextTasks ?? false,
    providerId: settings?.providerId || '',
    quotePrice: settings?.quotePrice ?? 0,
    currency: settings?.currency || 'USDC',
    estimatedSeconds: settings?.estimatedSeconds ?? 60,
  }
}

function renderSellerMonitorSurface() {
  if (!sellerMonitorActive()) return
  fields.chatFeed.innerHTML = renderSellerMonitorDashboard()
  attachSellerMonitorHandlers()
  localize(fields.chatFeed)
}

async function toggleSellerListing() {
  if (sellerListingToggleInFlight) return
  if (!state.sellerSettings) {
    showToast('Seller settings are still loading.')
    return
  }
  const nextEnabled = !Boolean(state.sellerSettings?.enabled)
  const previousSettings = state.sellerSettings
  const previousMarketStatus = state.sellerMarketStatus
  const payload = sellerPayloadFromState({ enabled: nextEnabled })
  sellerListingToggleInFlight = true
  state.sellerSettings = { ...previousSettings, enabled: nextEnabled }
  if (state.sellerMarketStatus) {
    state.sellerMarketStatus = {
      ...state.sellerMarketStatus,
      discoverable: nextEnabled && sellerApiReady() && (state.sellerMarketStatus.resourceListingCount || 0) > 0,
    }
  }
  renderSellerMonitorSurface()
  renderProfileSummary()
  if (state.sellerMarketStatus) renderSellerMarketStatus(state.sellerMarketStatus)
  try {
    await invoke('save_seller_settings', { input: payload, restart: false })
    const settings = await invoke<SellerSettings>('seller_settings').catch(() => null)
    if (settings) state.sellerSettings = settings
    const marketStatus = await invoke<SellerMarketStatus>('seller_market_status').catch(() => null)
    if (marketStatus) {
      state.sellerMarketStatus = marketStatus
      renderSellerMarketStatus(marketStatus)
    }
    renderSellerMonitorSurface()
    renderProfileSummary()
    showToast(nextEnabled ? 'Seller listed.' : 'Seller unlisted.')
  } catch (error) {
    state.sellerSettings = previousSettings
    state.sellerMarketStatus = previousMarketStatus
    renderSellerMonitorSurface()
    renderProfileSummary()
    if (previousMarketStatus) renderSellerMarketStatus(previousMarketStatus)
    showToast(humanizeError(error))
  } finally {
    sellerListingToggleInFlight = false
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

function createChatThread(input: { title?: string; providerPubkey?: string; workThreadId?: string; orderId?: string; taskIds?: string[]; status?: string; participants?: ChatThread['participants']; projectPath?: string; origin?: ChatThread['origin']; select?: boolean } = {}) {
  const now = Date.now()
  const defaultFolder = defaultWorkProjectFolder()
  const thread: ChatThread = {
    id: nextChatID(),
    title: input.title || 'New chat',
    messages: [],
    createdAt: now,
    updatedAt: now,
    projectPath: input.projectPath || defaultFolder.path,
    origin: input.origin,
    workThreadId: input.workThreadId,
    orderId: input.orderId,
    taskIds: input.taskIds || [],
    status: input.status,
    participants: input.participants || ['buyer_human', 'buyer_agent', 'seller_agent'],
    providerPubkey: input.providerPubkey,
    agentSessionId: undefined,
    agentDriverId: undefined,
    agentEventCursor: 0,
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

function startNewConversation(folder: ProjectFolder = defaultWorkProjectFolder()) {
  if (state.workOrderSide === 'seller') {
    showToast('Seller orders are created only by incoming buyer transactions.')
    return
  }
  state.sellerWorkspaceMode = 'transactions'
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

function startGpuJobDemo() {
  resetGpuJobDemo({ quiet: true })
  const demo = createGpuDemoState()
  state.gpuDemo = demo
  state.workOrderSide = 'buyer'
  state.marketOrderSide = 'buyer'
  state.sellerWorkspaceMode = 'transactions'
  setProjectFolders([{ name: demo.projectName, path: demo.projectPath }, ...state.projectFolders], demo.projectPath)
  state.expandedProjectFolderPaths.add(projectPathKey(demo.projectPath))
  agentQuery.value = demo.taskText
  setActiveView('chat')
  triggerBuyerFirstStepTransition()
  ensureGpuDemoThread()
  applyGpuDemoRecordsToState()
  renderAll()
  window.setTimeout(() => agentQuery.focus(), 0)
  showToast('GPU Job Demo ready in the local Agent chat.')
}

function resetGpuJobDemo(options: { quiet?: boolean } = {}) {
  clearGpuDemoTimers()
  const demo = state.gpuDemo
  if (demo?.chatId) state.chatThreads = state.chatThreads.filter((thread) => thread.id !== demo.chatId)
  if (demo?.ids.base) {
    state.chatThreads = state.chatThreads.filter((thread) => thread.orderId !== demo.ids.orderId && !thread.taskIds?.includes(demo.ids.taskId))
  }
  removeGpuDemoRecordsFromState()
  state.gpuDemo = undefined
  if (state.pinStep?.action.kind === 'gpu_demo_payment') state.pinStep = undefined
  if (state.selectedId && isGpuDemoIdentifier(state.selectedId)) state.selectedId = undefined
  if (state.selectedWorkThreadId && isGpuDemoIdentifier(state.selectedWorkThreadId)) state.selectedWorkThreadId = undefined
  state.newConversationDraft = true
  agentQuery.value = ''
  setActiveView('chat')
  scheduleSaveAppSettings()
  renderAll()
  if (!options.quiet) showToast('GPU Job Demo reset.')
}

function ensureGpuDemoThread() {
  const demo = state.gpuDemo
  if (!demo) return ensureChatThread()
  let thread = demo.chatId ? state.chatThreads.find((item) => item.id === demo.chatId) : undefined
  if (!thread) {
    thread = createChatThread({
      title: 'GPU job MCP demo',
      status: demo.stage,
      projectPath: demo.projectPath,
      orderId: gpuDemoAtLeast('seller_options') ? demo.ids.orderId : undefined,
      taskIds: gpuDemoAtLeast('seller_accepted') ? [demo.ids.taskId] : [],
      participants: ['buyer_human', 'buyer_agent', 'seller_agent'],
    })
    demo.chatId = thread.id
  }
  thread.title = 'GPU job MCP demo'
  thread.status = demo.stage
  thread.projectPath = demo.projectPath
  thread.orderId = gpuDemoAtLeast('seller_options') ? demo.ids.orderId : undefined
  thread.taskIds = gpuDemoAtLeast('seller_accepted') ? [demo.ids.taskId] : []
  thread.providerPubkey = demo.selectedSellerId ? selectedGpuDemoSeller(demo).providerPubkey : thread.providerPubkey
  thread.updatedAt = Date.now()
  state.selectedChatId = thread.id
  state.selectedWorkThreadId = workThreadIdForChat(thread)
  state.newConversationDraft = false
  scheduleSaveChatThread(thread)
  return thread
}

function setGpuDemoStage(stage: GpuDemoStage) {
  const demo = state.gpuDemo
  if (!demo) return
  demo.stage = stage
  demo.updatedAt = new Date().toISOString()
  ensureGpuDemoThread()
  applyGpuDemoRecordsToState()
  renderAll()
}

function submitGpuDemoQuestions(form: HTMLFormElement) {
  const demo = state.gpuDemo
  if (!demo) return
  const data = new FormData(form)
  const gpuProfile = String(data.get('gpuProfile') || '').trim() || GPU_DEMO_DEFAULT_ANSWERS.gpuProfile
  const budget = String(data.get('budget') || '').trim() || GPU_DEMO_DEFAULT_ANSWERS.budget
  const dataset = String(data.get('dataset') || '').trim() || GPU_DEMO_DEFAULT_ANSWERS.dataset
  const outputs = String(data.get('outputs') || '').trim() || GPU_DEMO_DEFAULT_ANSWERS.outputs
  demo.answers = { gpuProfile, budget, dataset, outputs }
  demo.updatedAt = new Date().toISOString()
  ensureGpuDemoThread()
  pushMessage({
    role: 'user',
    actor: 'buyer_human',
    text: `Answers: GPU ${gpuProfile}; budget ${budget} USDC; input ${dataset}; outputs ${outputs}.`,
    meta: 'Owner Answers',
  })
  pushMessage({
    role: 'assistant',
    actor: 'buyer_agent',
    text: 'I converted those answers into a seller-facing task checklist. Review it before I send the local demo request to matching.',
    meta: 'Task Checklist',
  })
  setGpuDemoStage('manifest_review')
}

function startGpuDemoMatching() {
  const demo = state.gpuDemo
  if (!demo) return
  ensureGpuDemoThread()
  pushMessage({
    role: 'assistant',
    actor: 'buyer_agent',
    text: 'Sending the checklist to local demo matching. I will return three seller agents with fixed quotes, ETA, VRAM, success rate, and fit reason.',
    meta: 'Matching',
  })
  setGpuDemoStage('matching')
  scheduleGpuDemo(() => {
    const current = state.gpuDemo
    if (!current || current.ids.base !== demo.ids.base || current.stage !== 'matching') return
    setGpuDemoStage('seller_options')
    state.selectedId = selectionId('plan', current.ids.planId)
    state.selectedWorkThreadId = workThreadIdForPlan(state.orderPlans.find((plan) => plan.planId === current.ids.planId) || gpuDemoTransactionBundle(current).orderPlans?.[0]!)
    pushMessage({
      role: 'assistant',
      actor: 'buyer_agent',
      text: 'Three seller agents matched. Choose one in the seller options panel.',
      meta: 'Seller Options',
      result: gpuDemoMarketSearchResult(current),
    })
    renderAll()
  }, 1000)
}

function gpuDemoMarketSearchResult(demo: GpuDemoState): MarketSearchResult {
  return {
    normalizedQuery: {
      type: gpuDemoTaskType(demo),
      minGpuCount: 1,
      minVramGb: selectedGpuDemoSeller(demo).vramGb,
      query: demo.answers.gpuProfile,
    },
    candidates: GPU_DEMO_SELLERS.map((seller): SellerCandidate => ({
      providerPubkey: seller.providerPubkey,
      score: seller.score,
      reasons: [seller.reason, seller.risk],
      resource: {
        id: seller.resourceId,
        name: seller.name,
        type: 'gpu_worker',
        summary: `${seller.gpu}, ${seller.vramGb}GB VRAM, ${seller.region}, ETA ${seller.eta}`,
        pricePerUnit: seller.price,
        billingUnit: 'job',
        reputation: seller.score,
        spec: { vramGb: seller.vramGb, gpuCount: 1, gpuModel: seller.gpu, region: seller.region, runtime: seller.eta },
      },
    })),
    orderDraftOptions: GPU_DEMO_SELLERS.map((seller): OrderDraftOption => ({
      optionId: gpuDemoOptionId(seller, demo),
      resourceId: seller.resourceId,
      providerPubkey: seller.providerPubkey,
      score: seller.score,
      reason: seller.reason,
      expiresAt: 'local demo',
      priceSnapshot: { pricePerUnit: seller.price, billingUnit: 'job', currency: 'USDC', availability: seller.eta },
      draft: {
        goal: demo.taskText,
        requirements: { gpu: seller.gpu, vramGb: seller.vramGb, outputs: demo.answers.outputs },
      },
    })),
    selectionRequest: { planId: demo.ids.planId, status: 'pending_selection', expiresAt: 'local demo', nextAction: 'Choose one seller option.' },
    summary: 'Local demo matching returned three fixed GPU seller agents.',
    nextAction: 'Choose a seller, then wait for seller confirmation.',
  }
}

function chooseGpuDemoSeller(sellerId: string) {
  const demo = state.gpuDemo
  const seller = GPU_DEMO_SELLERS.find((item) => item.id === sellerId)
  if (!demo || !seller) return
  demo.selectedSellerId = seller.id
  demo.updatedAt = new Date().toISOString()
  ensureGpuDemoThread()
  pushMessage({
    role: 'user',
    actor: 'buyer_human',
    text: `Choose seller: ${seller.name} at ${trimDisplayNumber(seller.price)} USDC, ETA ${seller.eta}.`,
    meta: 'Seller Selection',
  })
  pushMessage({
    role: 'assistant',
    actor: 'seller_agent',
    providerPubkey: seller.providerPubkey,
    text: `${seller.name} is checking queue availability and accepting terms.`,
    meta: 'Seller Confirmation',
  })
  setGpuDemoStage('seller_confirming')
  state.selectedId = selectionId('plan', demo.ids.planId)
  state.selectedWorkThreadId = workThreadIdForPlan(state.orderPlans.find((plan) => plan.planId === demo.ids.planId) || gpuDemoTransactionBundle(demo).orderPlans?.[0]!)
  scheduleGpuDemo(() => {
    const current = state.gpuDemo
    if (!current || current.ids.base !== demo.ids.base || current.stage !== 'seller_confirming') return
    setGpuDemoStage('seller_accepted')
    pushMessage({
      role: 'assistant',
      actor: 'seller_agent',
      providerPubkey: seller.providerPubkey,
      text: `${seller.name} accepted the job. Dock needs owner PIN to record the simulated payment proof.`,
      meta: 'Seller Accepted',
    })
    scheduleGpuDemo(() => {
      const latest = state.gpuDemo
      if (!latest || latest.ids.base !== demo.ids.base || latest.stage !== 'seller_accepted') return
      openGpuDemoPin()
    }, 800)
  }, 1400)
  renderAll()
}

function openGpuDemoPin() {
  const demo = state.gpuDemo
  if (!demo) return
  setGpuDemoStage('pin')
  state.pinStep = { action: { kind: 'gpu_demo_payment' }, setup: false, pin: '', confirm: '' }
  renderAll()
}

function completeGpuDemoPayment(pin: string) {
  void pin
  const demo = state.gpuDemo
  if (!demo) return
  state.pinStep = undefined
  ensureGpuDemoThread()
  pushMessage({
    role: 'system',
    text: 'Demo PIN accepted. A simulated escrow payment proof was written locally; no real payment was sent.',
    meta: 'Payment',
  })
  setGpuDemoStage('paid')
  pushMessage({
    role: 'assistant',
    actor: 'seller_agent',
    providerPubkey: selectedGpuDemoSeller(demo).providerPubkey,
    text: 'Payment proof confirmed. I am starting the scripted GPU execution flow.',
    meta: 'Execution',
  })
  runGpuDemoExecutionScript()
}

function runGpuDemoExecutionScript() {
  const demo = state.gpuDemo
  if (!demo) return
  const base = demo.ids.base
  const advance = (stage: GpuDemoStage, delayMs: number, text: string) => {
    scheduleGpuDemo(() => {
      const current = state.gpuDemo
      if (!current || current.ids.base !== base || gpuDemoStageIndex(current.stage) >= gpuDemoStageIndex(stage)) return
      setGpuDemoStage(stage)
      pushMessage({
        role: 'assistant',
        actor: 'seller_agent',
        providerPubkey: selectedGpuDemoSeller(current).providerPubkey,
        text,
        meta: 'GPU Job',
      })
      if (stage === 'completed') {
        state.selectedId = selectionId('task', current.ids.taskId)
        state.selectedWorkThreadId = workThreadIdForTask(state.tasks.find((task) => task.id === current.ids.taskId) || { id: current.ids.taskId, orderId: current.ids.orderId, status: 'completed' })
        renderAll()
      }
    }, delayMs)
  }
  advance('queued', 700, 'Job queued on the selected demo seller.')
  advance('pulling_image', 1800, 'Pulling the CUDA image and preparing cached model files.')
  advance('running', 3200, 'GPU inference is running over the evaluation batch.')
  advance('uploading_artifacts', 4700, 'Packaging result.md, metrics.json, logs.txt, and receipt.json.')
  advance('completed', 6200, 'Completed. Result files, metrics, logs, receipt, and hashes are ready for buyer verification.')
}

function activeChatThread() {
  return state.chatThreads.find((thread) => thread.id === state.selectedChatId)
}

function ensureChatThread() {
  if (state.newConversationDraft) return createChatThread()
  const workThread = selectedWorkThread()
  if (workThread?.chatId) {
    const linked = state.chatThreads.find((thread) => thread.id === workThread.chatId)
    if (linked) {
      state.selectedChatId = linked.id
      return linked
    }
  }
  const active = activeChatThread()
  if (active && (!workThread || workThread.chatId === active.id || workThreadIdForChat(active) === workThread.id)) return active
  if (workThread) {
    const linked = state.chatThreads.find((thread) => workThreadIdForChat(thread) === workThread.id)
    if (linked) {
      state.selectedChatId = linked.id
      return linked
    }
    return createChatThread({
      title: workThread.title,
      providerPubkey: workThread.providerPubkey,
      workThreadId: workThread.id,
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
  const message: ChatMessage = { id, ...input }
  if (!message.stageId && !state.newConversationDraft) {
    const workThread = selectedWorkThread()
    if (workThread) {
      const side = workThread.side || state.workOrderSide
      message.stageId = selectedTransactionStageId(workThread, buildTransactionProgressSnapshot(workThread, side))
    }
  }
  thread.messages.push(message)
  thread.updatedAt = Date.now()
  if (thread.messages.length === 1 && (thread.title === 'New chat' || /^New task(?: \d+)?$/.test(thread.title) || !thread.title)) {
    thread.title = input.role === 'user' ? compactText(input.text, 52) : compactText(input.meta || input.text, 52)
  }
  if (input.providerPubkey && !thread.providerPubkey) thread.providerPubkey = input.providerPubkey
  state.selectedChatId = thread.id
  state.selectedWorkThreadId = workThreadIdForChat(thread)
  forceChatFeedScrollBottom = true
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
  if (action.kind === 'gpu_demo_payment') return 'Confirm simulated GPU job payment'
  if (action.kind === 'select_plan') return `Choose seller option ${shortID(action.optionId)}`
  if (action.kind === 'approve') return `Approve request ${shortID(action.approvalId)}`
  return 'Set local payment PIN'
}

function setBusy(next: boolean) {
  state.busy = next
  app.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    if (button.dataset.windowAction) return
    if (button.dataset.toolbarAction === 'toggle-sidebar') return
    if (button.dataset.action === 'close-cart') return
    button.disabled = next
  })
  agentQuery.disabled = next || builtInBuyerInputLocked()
  renderExternalWorkLockControls()
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

function settingsTitles(): Record<SettingsView, { kicker: string; title: string }> {
  return {
    wallet: { kicker: t('settings.wallet.kicker'), title: t('settings.wallet.title') },
    archives: { kicker: t('settings.archives.kicker'), title: t('settings.archives.title') },
  }
}

function settingsViewForCardRole(role: AgentCardRole): SettingsView {
  return 'wallet'
}

function renderSettingsAgentCardPages() {
  app.querySelectorAll<HTMLElement>('[data-settings-card-content]').forEach((container) => {
    const role = container.dataset.settingsCardContent as AgentCardRole | undefined
    if (role !== 'buyer' && role !== 'seller') return
    container.innerHTML = renderAgentCardSettingsPage(role)
    attachCardHandlers(container)
  })
}

function renderLocalAgentsSettings() {
  if (!fields.localAgentsContent) return
  const binding = state.localAgentBinding
  const defaultValue = binding
    ? `${binding.vendor} ${binding.name}${binding.valid ? '' : ` · ${t('localAgents.needsAttention')}`}`
    : t('localAgents.noneBound')
  const records = state.localAgents.length
    ? state.localAgents.map(renderLocalAgentRecord).join('')
    : `
      <div class="agent-env-empty">
        <strong>${escapeHTML(state.localAgentSnapshotLoading ? t('localAgents.loadingSaved') : state.localAgentScanning ? t('localAgents.scanning') : t('localAgents.notScanned'))}</strong>
        <span>${escapeHTML(t('localAgents.scanHelp'))}</span>
      </div>
    `
  const scanStatus = state.localAgentError
    ? state.localAgentError
    : state.localAgentScanning
      ? t('localAgents.scanning')
      : state.localAgentSnapshotLoading
        ? t('localAgents.loadingSaved')
      : state.localAgentScannedAt
        ? t('localAgents.scanSummary', {
            found: state.localAgents.filter((agent) => agent.installed).length,
            total: state.localAgents.length,
            time: compactTimestamp(state.localAgentScannedAt),
          })
        : t('localAgents.notScanned')

  fields.localAgentsContent.innerHTML = `
    <div class="agent-card-form card-setup-list agent-card-settings-form">
      <div class="card-setup-row card-message-row">
        <span class="field-label">${escapeHTML(t('localAgents.default'))}</span>
        <small class="field-help">${escapeHTML(t('localAgents.defaultHelp'))}</small>
        <strong class="diagnostic-value" data-no-i18n>${escapeHTML(defaultValue)}</strong>
      </div>
      <div class="archive-record-list">
        ${records}
      </div>
    </div>
    <div class="card-setup-actionbar card-scan-actionbar" aria-label="${escapeAttr(t('localAgents.scan'))}">
      <button type="button" class="card-action-button diagnose-card-action ${state.localAgentScanning ? 'is-running' : ''}" data-local-agent-action="scan" ${state.localAgentScanning || state.localAgentSnapshotLoading || state.busy ? 'disabled aria-busy="true"' : ''}>
        <span class="card-action-icon">${state.localAgentScanning ? windowIcons.close : cardActionIcons.diagnose}</span>
        <span class="card-action-text">${escapeHTML(state.localAgentScanning ? t('localAgents.scanningShort') : t('localAgents.scan'))}</span>
      </button>
      ${binding ? `
        <button type="button" class="card-action-button" data-local-agent-action="unbind" ${state.localAgentSnapshotLoading || state.busy ? 'disabled' : ''}>
          <span class="card-action-icon">${windowIcons.close}</span>
          <span class="card-action-text">${escapeHTML(t('localAgents.unbind'))}</span>
        </button>
      ` : ''}
      <span class="card-scan-status" title="${escapeAttr(scanStatus)}">${escapeHTML(scanStatus)}</span>
    </div>
  `
}

function renderLocalAgentRecord(agent: LocalAgentInstallation) {
  const bound = state.localAgentBinding?.driverId === agent.driverId
  const status = localAgentStatusText(agent)
  const protocol = localAgentProtocolText(agent)
  const metadata = [agent.version, status].filter(Boolean).join(' · ')
  const executable = agent.executablePath || t('localAgents.notFound')
  const canBind = agent.installed && agent.bindable && (agent.status === 'ready' || agent.status === 'available')
  const action = bound
    ? `<span class="card-status-chip">${escapeHTML(t('localAgents.bound'))}</span>`
    : canBind
      ? `<button type="button" class="secondary" data-local-agent-action="bind" data-local-agent-driver="${escapeAttr(agent.driverId)}" ${state.busy || state.localAgentScanning || state.localAgentSnapshotLoading ? 'disabled' : ''}>${escapeHTML(t(state.localAgentBinding ? 'localAgents.switch' : 'localAgents.bind'))}</button>`
      : `<span class="card-status-chip">${escapeHTML(localAgentShortStatus(agent))}</span>`
  return `
    <article class="archive-record-card" data-local-agent-driver-record="${escapeAttr(agent.driverId)}">
      <div class="archive-record-main">
        <strong data-no-i18n>${escapeHTML(agent.name)}</strong>
        <span>${escapeHTML(`${agent.vendor} · ${protocol}`)}</span>
        <code data-no-i18n title="${escapeAttr(executable)}">${escapeHTML(`${metadata} · ${executable}`)}</code>
      </div>
      <div class="archive-record-actions">${action}</div>
    </article>
  `
}

function localAgentStatusText(agent: LocalAgentInstallation) {
  if (agent.status === 'not_installed') return t('localAgents.notInstalled')
  if (agent.status === 'probe_failed') return t('localAgents.probeFailed')
  if (agent.status === 'login_required') return t('localAgents.loginRequired')
  if (agent.status === 'detected_only') return t('localAgents.detectedOnly')
  if (agent.authState === 'authenticated') return t('localAgents.authenticated')
  if (agent.authState === 'configured') return t('localAgents.configured')
  return t('localAgents.authUnknown')
}

function localAgentShortStatus(agent: LocalAgentInstallation) {
  if (agent.status === 'login_required') return t('localAgents.signIn')
  if (agent.status === 'detected_only') return t('localAgents.detectOnly')
  if (agent.status === 'probe_failed') return t('localAgents.checkFailed')
  return t('localAgents.unavailable')
}

function localAgentProtocolText(agent: LocalAgentInstallation) {
  const stateLabel = agent.protocolState === 'supported'
    ? t('localAgents.supported')
    : agent.protocolState === 'preview'
      ? t('localAgents.beta')
      : agent.protocolState === 'limited'
        ? t('localAgents.limited')
        : t('localAgents.detectOnly')
  return `${agent.protocolLabel} · ${stateLabel}${agent.note ? ` · ${agent.note}` : ''}`
}

function applyLocalAgentSnapshot(result: LocalAgentScanResult) {
  state.localAgents = Array.isArray(result.agents) ? result.agents : []
  state.localAgentBinding = result.binding || undefined
  state.localAgentScannedAt = result.scannedAt || undefined
}

async function loadLocalAgentSnapshot() {
  if (state.localAgentSnapshotLoaded || state.localAgentSnapshotLoading || state.localAgentScanning) return
  if (!hasDesktopBridge()) {
    state.localAgentError = t('localAgents.desktopOnly')
    state.localAgentSnapshotLoaded = true
    renderLocalAgentsSettings()
    return
  }
  state.localAgentSnapshotLoading = true
  state.localAgentError = undefined
  renderLocalAgentsSettings()
  try {
    applyLocalAgentSnapshot(await invoke<LocalAgentScanResult>('local_agent_snapshot'))
  } catch (error) {
    state.localAgentError = humanizeError(error)
  } finally {
    state.localAgentSnapshotLoading = false
    state.localAgentSnapshotLoaded = true
    renderLocalAgentsSettings()
  }
}

async function scanLocalAgentsNow() {
  if (state.localAgentScanning || state.localAgentSnapshotLoading) return
  if (!hasDesktopBridge()) {
    state.localAgentError = t('localAgents.desktopOnly')
    renderLocalAgentsSettings()
    return
  }
  state.localAgentScanning = true
  state.localAgentError = undefined
  renderLocalAgentsSettings()
  try {
    applyLocalAgentSnapshot(await invoke<LocalAgentScanResult>('local_agent_scan'))
    state.localAgentSnapshotLoaded = true
  } catch (error) {
    state.localAgentError = humanizeError(error)
  } finally {
    state.localAgentScanning = false
    renderLocalAgentsSettings()
  }
}

async function bindLocalAgent(driverId: string) {
  const result = await invoke<{ binding: LocalAgentBinding; agent: LocalAgentInstallation }>('bind_local_agent', {
    input: { driverId },
  })
  state.localAgentBinding = result.binding
  state.localAgents = state.localAgents.map((agent) => ({
    ...agent,
    bound: agent.driverId === result.binding.driverId,
  }))
  state.localAgentError = undefined
  renderLocalAgentsSettings()
}

async function unbindLocalAgent() {
  await invoke('unbind_local_agent')
  state.localAgentBinding = undefined
  state.localAgents = state.localAgents.map((agent) => ({ ...agent, bound: false }))
  state.localAgentError = undefined
  renderLocalAgentsSettings()
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
    ` : '<p class="muted">Archived transactions appear here.</p>'}
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
  if (state.workOrderSide === side) return
  state.workOrderSide = side
  state.selectedV3ActivitySessionId = undefined
  state.v3ActivityDetail = undefined
  state.v3ActivityDetailError = undefined
  state.v3ActivityDetailLoading = false
  state.sellerWorkspaceMode = 'transactions'
  state.newConversationDraft = true
  state.selectedWorkThreadId = undefined
  state.selectedChatId = undefined
  state.selectedId = undefined
  state.pinStep = undefined
  scheduleSaveAppSettings()
  renderLedger()
  renderDecisionPanel()
  syncTransactionProgressPolling()
}

function sellerMonitorActive() {
  return state.activeView !== 'settings' && state.workOrderSide === 'seller' && state.sellerWorkspaceMode === 'monitor'
}

app.querySelector<HTMLButtonElement>('[data-action="refresh-workspace"]')!.addEventListener('click', () => {
  run(() => refreshWorkspace())
})

app.querySelectorAll<HTMLButtonElement>('[data-order-side-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    const side = button.dataset.orderSideTab as OrderSide
    if (side === 'buyer' || side === 'seller') selectOrderSide(side)
  })
})

fields.orderSideToggle.addEventListener('click', () => {
  selectOrderSide(state.workOrderSide === 'buyer' ? 'seller' : 'buyer')
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
fields.transactionDetailCloseButton.addEventListener('click', () => closeTransactionStageInspector())
fields.transactionDetailOpenButtons.forEach((button) => {
  button.addEventListener('click', openTransactionStageInspector)
})

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

fields.cartModal.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('[data-action="close-cart"]')) {
    event.preventDefault()
    event.stopPropagation()
    closeCartModal()
  }
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
  if (!(target instanceof Element && target.closest('[data-v3-resource-select]'))) closeV3ResourceSelectPopovers()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeProfileMenu()
    closeProjectFolderMenu()
    closeTaskContextMenu()
    closePermissionMenu()
    closeLLMProfileMenu()
    closeV3ResourceSelectPopovers()
    closeMarketProjectPicker()
    closeOrderSearch()
    closeCartModal()
  }
})

fields.newChatButton.addEventListener('click', () => {
  if (fields.newChatButton.dataset.mode === 'history-refresh') {
    void loadV3ActivitySessions(state.workOrderSide, true)
    return
  }
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

fields.permissionButton?.addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
  closeTaskContextMenu()
  togglePermissionMenu()
})

fields.permissionMenu?.addEventListener('click', (event) => {
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

fields.transactionDetailResizeHandle.addEventListener('pointerdown', (event) => {
  if (!fields.appShell.classList.contains('transaction-detail-open') || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  transactionDetailResizePointerId = event.pointerId
  fields.appShell.classList.add('transaction-detail-resizing')
  fields.transactionDetailResizeHandle.setPointerCapture(event.pointerId)
  updateTransactionDetailWidthFromPointer(event)
})

fields.transactionDetailResizeHandle.addEventListener('pointermove', (event) => {
  if (transactionDetailResizePointerId !== event.pointerId) return
  event.preventDefault()
  updateTransactionDetailWidthFromPointer(event)
})

fields.transactionDetailResizeHandle.addEventListener('pointerup', stopTransactionDetailResize)
fields.transactionDetailResizeHandle.addEventListener('pointercancel', stopTransactionDetailResize)

fields.transactionDetailResizeHandle.addEventListener('lostpointercapture', () => {
  if (transactionDetailResizePointerId === undefined) return
  transactionDetailResizePointerId = undefined
  fields.appShell.classList.remove('transaction-detail-resizing')
  scheduleSaveAppSettings()
})

fields.transactionDetailResizeHandle.addEventListener('keydown', (event) => {
  if (!fields.appShell.classList.contains('transaction-detail-open')) return
  const step = event.shiftKey ? 24 : 12
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    state.transactionDetailWidth = normalizeTransactionDetailWidth(state.transactionDetailWidth + step)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    state.transactionDetailWidth = normalizeTransactionDetailWidth(state.transactionDetailWidth - step)
  } else if (event.key === 'Home') {
    event.preventDefault()
    state.transactionDetailWidth = TRANSACTION_DETAIL_MIN_WIDTH
  } else if (event.key === 'End') {
    event.preventDefault()
    state.transactionDetailWidth = TRANSACTION_DETAIL_MAX_WIDTH
  } else {
    return
  }
  applyTransactionDetailWidth()
  scheduleSaveAppSettings()
})

fields.sidebarButton.addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
  closeProfileMenu()
  closeProjectFolderMenu()
  setSidebarCollapsed(!state.sidebarCollapsed)
})

fields.forwardButton.addEventListener('click', () => navigateWorkspaceHistory(1))
fields.backButton.addEventListener('click', () => navigateWorkspaceHistory(-1))

let manualWindowDragActive = false
let manualWindowDragMoveScheduled = false

const WINDOW_DRAG_CONTROL_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="separator"]',
  '[contenteditable]',
  '[tabindex]:not([tabindex="-1"])',
  '.no-drag',
].join(', ')

function isWindowDragTarget(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return false
  if (target.closest(WINDOW_DRAG_CONTROL_SELECTOR)) return false
  const isMarkedDragRegion = Boolean(target.closest('[data-window-drag-handle], [data-drag-region]'))
  const isTopWindowRegion = event.clientY >= 0 && event.clientY <= TOP_WINDOW_DRAG_HEIGHT
  return isMarkedDragRegion || isTopWindowRegion
}

app.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return
  if (!isWindowDragTarget(event)) return
  event.preventDefault()
  manualWindowDragActive = true
  invoke<boolean>('window_begin_manual_drag')
    .then((started) => {
      if (!started) {
        manualWindowDragActive = false
        return
      }
      scheduleManualWindowDragMove()
    })
    .catch(() => {
      manualWindowDragActive = false
    })
})

window.addEventListener('mousemove', () => {
  if (manualWindowDragActive) scheduleManualWindowDragMove()
})

function scheduleManualWindowDragMove() {
  if (!manualWindowDragActive || manualWindowDragMoveScheduled) return
  manualWindowDragMoveScheduled = true
  window.requestAnimationFrame(() => {
    manualWindowDragMoveScheduled = false
    if (!manualWindowDragActive) return
    invoke('window_manual_drag_move').catch(() => undefined)
  })
}

function endManualWindowDrag() {
  if (!manualWindowDragActive) return
  manualWindowDragActive = false
  manualWindowDragMoveScheduled = false
  invoke('window_end_manual_drag').catch(() => undefined)
}

window.addEventListener('mouseup', endManualWindowDrag)
window.addEventListener('blur', endManualWindowDrag)

app.addEventListener('dblclick', (event) => {
  if (!isWindowDragTarget(event)) return
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
    openSettings('wallet')
  })
})

fields.externalWorkTakeoverButton.addEventListener('click', () => {
  takeOverExternalWork().catch((error) => showToast(humanizeError(error)))
})

function setLLMProfileMenuOpen(open: boolean) {
  if (!fields.llmProfileList) return
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

app.querySelector<HTMLButtonElement>('[data-action="wallet-refresh"]')!.addEventListener('click', () => {
  run(() => refreshSettingsStatus())
})

fields.chatAgentButton.addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
  const session = currentInteractiveAgentSession()
  if (!session) {
    connectCurrentChatAgent().catch((error) => {
      const message = humanizeError(error)
      showToast(message)
    })
    return
  }
  state.chatAgentMenuOpen = !state.chatAgentMenuOpen
  closePermissionMenu(false)
  renderChatAgentControl()
})

fields.chatAgentMenu.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLButtonElement>('[data-chat-agent-action]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  const action = button.dataset.chatAgentAction
  const task = action === 'resume' ? resumeCurrentChatAgent() : action === 'stop' ? stopCurrentChatAgent() : action === 'switch' ? switchCurrentChatAgent() : undefined
  task?.catch((error) => showToast(humanizeError(error)))
})

document.addEventListener('click', (event) => {
  if (!state.chatAgentMenuOpen) return
  if (event.target instanceof Node && (fields.chatAgentMenu.contains(event.target) || fields.chatAgentButton.contains(event.target))) return
  state.chatAgentMenuOpen = false
  renderChatAgentControl()
})

app.querySelector<HTMLButtonElement>('[data-action="wallet-copy-address"]')!.addEventListener('click', () => {
  run(async () => {
    const address = state.walletStatus?.address
    if (!address) throw new Error('Wallet address is not configured.')
    await navigator.clipboard.writeText(address)
  }, 'Wallet address copied.')
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
fields.chatView.addEventListener('wheel', routeExpandedTransactionStageWheel, { passive: false })

async function bootstrap() {
  await hydrateDesktopPersistence()
  localAgentEventUnsubscribe = window.exora?.onLocalAgentEvent?.(handleLocalAgentEventPayload)
  v3ProgressUnsubscribe = window.exora?.onV3Progress?.((payload) => {
    if (!payload || typeof payload !== 'object') return
    const event = payload as Partial<V3ImageProgress & V3HostScanProgress & V3AssetProgress> & { kind?: string }
    if (event.kind === 'host_scan' && event.phase && typeof event.percent === 'number') {
      state.v3HostScanProgress = { phase: event.phase, percent: event.percent, bytes: event.bytes, samples: event.samples }
      updateV3HostScanProgressButton()
      return
    }
    if (event.kind === 'asset_packaging' && event.phase && typeof event.percent === 'number') {
      state.v3AssetProgress = {
        phase: event.phase === 'complete' ? 'complete' : 'packaging',
        percent: event.percent,
        completedFiles: event.completedFiles,
        totalFiles: event.totalFiles,
        inputBytes: event.inputBytes,
        sourceBytes: event.sourceBytes,
        outputBytes: event.outputBytes,
      }
      if (state.workOrderSide === 'seller' && state.v3SellerTab === 'resources') renderDecisionPanel()
      return
    }
    if (event.kind === 'asset_upload' && typeof event.completed === 'number' && typeof event.total === 'number') {
      state.v3AssetProgress = { phase: 'uploading', percent: event.total > 0 ? Math.round(event.completed / event.total * 100) : 0, completed: event.completed, total: event.total }
      if (state.workOrderSide === 'seller' && state.v3SellerTab === 'resources') renderDecisionPanel()
      return
    }
    if (event.kind !== 'environment_image' || !event.imageId || !event.phase) return
    state.v3ImageProgress = { imageId: event.imageId, phase: event.phase, bytesDownloaded: event.bytesDownloaded, sizeBytes: event.sizeBytes }
    if (state.workOrderSide === 'seller' && state.v3SellerTab === 'vm') renderDecisionPanel()
  })
  applyUserPreferences()
  renderChat()
  renderAll()
  refreshProjectFolder()
  await startDockOnLaunch()
  await hydrateLocalAgentChatSessions()
  refreshWalletStatus().catch(() => undefined)
  refreshSeller({ market: true })
  refreshAgentCards()
  refreshMarketRailCards({ render: false })
  window.setTimeout(() => refreshWorkspace({ quiet: true }), 250)
  setInterval(refreshStatus, 5000)
  setInterval(() => refreshWorkspace({ quiet: true }), 12000)
}

void bootstrap()
