export type AppStatus = {
  docker: string
  container: string
  daemon: string
  image: string
  containerName: string
  imageTag: string
  baseUrl: string
  dataDir: string
  configPath: string
  discoveryPath: string
  mcpCommand: string
  agentPrompt: string
  opencodeConfig: string
  message: string
}

export type SellerSettings = {
  enabled: boolean
  autoQuote: boolean
  autoCompleteTextTasks: boolean
  llmBaseUrl: string
  hasApiKey: boolean
  keyFormat: string
  providerPreset: string
  wireApi: string
  capabilities: LLMCapabilities
  researchModel: string
  researchReasoningEffort: string
  utilityModel: string
  utilityReasoningEffort: string
  disableResponseStorage: boolean
  providerId: string
  quotePrice: number
  currency: string
  estimatedSeconds: number
  dockerEnabled?: boolean
  dockerDefaultImage?: string
  dockerAllowedImages?: string[]
  dockerNetworkMode?: string
  dockerAllowedNetworkModes?: string[]
  dockerAllowGpu?: boolean
  dockerMaxCpus?: number
  dockerMaxMemoryMb?: number
  dockerPullPolicy?: string
}

export type LLMCapabilities = {
  supportsResponses: boolean
  supportsChatCompletions: boolean
  supportsSystemMessage: boolean
  supportsJsonResponseFormat: boolean
  supportsStreaming: boolean
  supportsTools: boolean
  supportsReasoningEffort: boolean
}

export type SellerMarketStatus = {
  discoverable: boolean
  resourceListingCount: number
  providerId: string
}

export type AgentCardRole = 'buyer' | 'seller'

export type AgentCardStatus = 'draft' | 'saved' | 'published'

export type AgentCardDiagnostics = {
  collectedAt: string
  expiresAt: string
  os: string
  osVersion?: string
  kernelVersion?: string
  arch: string
  cpuCores: number
  cpuModel?: string
  ramGb?: number
  gpus?: Array<{ name: string; vramGb?: number }>
  storage?: Array<{ label: string; totalGb?: number; freeGb?: number; usedPercent?: number }>
  dockerAvailable: boolean
  dockerVersion?: string
  pythonVersion?: string
  nodeVersion?: string
  npmVersion?: string
  mcpAvailable: boolean
  mcpEntrypoint?: string
  llmProvider?: string
  llmConfigured: boolean
  sellerAgentEnabled: boolean
  commandExecutor: boolean
  networkCheck?: string
  redactionSummary: string
  diagnosticsVersion: string
}

export type BuyerManualFields = {
  displayName?: string
  supportedAgentTypes?: string[]
  budget?: string
  preferences?: string[]
  riskBoundary?: string
  authorizationStrategy?: string
  acceptedTaskTypes?: string[]
  identityDisclosure?: string
  fileDisclosure?: string
  dataRetention?: string
  escrowPreference?: string
}

export type SellerManualFields = {
  displayName?: string
  capabilitySummary?: string
  capabilityTypes?: string[]
  pricing?: string
  availability?: string
  humanConfirmation?: string
  dataBoundary?: string
  managedApis?: string[]
  outputFormats?: string[]
  autoQuote?: boolean
  autoAcceptLowRisk?: boolean
  externalWritePolicy?: string
}

export type AgentCard = {
  id: string
  role: AgentCardRole
  status: AgentCardStatus
  dockId: string
  agentId: string
  cardVersion: string
  updatedAt: string
  expiresAt?: string
  publishedAt?: string
  manualFields: {
    buyer?: BuyerManualFields
    seller?: SellerManualFields
  }
  diagnostics: AgentCardDiagnostics
  disclosure?: Record<string, string>
  contentHash: string
  signature?: string
}

export type AgentCardsMine = {
  cards?: AgentCard[]
  buyer?: AgentCard
  seller?: AgentCard
}

export type Approval = {
  approvalId: string
  taskId: string
  action: string
  agentId: string
  providerPubkey?: string
  amount?: { value?: number; currency?: string }
  quote?: { priceAmount?: number; currency?: string; estimatedSeconds?: number; notes?: string }
  fileScope?: Array<{ name: string; sizeBytes?: number; contentType?: string }>
  status: string
  paymentRequired?: boolean
  riskSummary?: string
  createdAt: string
  expiresAt: string
}

export type Task = {
  id: string
  orderId?: string
  projectPath?: string
  workUid?: string
  requesterPubkey?: string
  agentId?: string
  type?: string
  goal?: string
  requirements?: Record<string, unknown>
  inputFiles?: Array<{ name: string; sizeBytes?: number; contentType?: string; uri?: string; sha256?: string }>
  budget?: { maxAmount?: number; currency?: string }
  timeoutSeconds?: number
  expectedOutputs?: string[]
  status: string
  providerPubkey?: string
  quote?: {
    id?: string
    providerPubkey?: string
    priceAmount?: number
    currency?: string
    estimatedSeconds?: number
    notes?: string
    createdAt?: string
    expiresAt?: string
  }
  approvalRequestId?: string
  error?: string
  createdAt?: string
  updatedAt?: string
  consentedAt?: string
  claimedAt?: string
  completedAt?: string
}

export type PaymentRecord = {
  paymentId: string
  approvalId?: string
  taskId?: string
  providerPubkey?: string
  amount?: number
  currency?: string
  mode?: string
  status?: string
  proofRef?: string
  createdAt?: string
  updatedAt?: string
  confirmedAt?: string
}

export type SellerCandidate = {
  providerPubkey: string
  score: number
  reasons?: string[]
  resource?: {
    id: string
    name: string
    type: string
    summary?: string
    pricePerUnit?: number
    billingUnit?: string
    reputation?: number
    spec?: { vramGb?: number; gpuCount?: number; gpuModel?: string; region?: string; datasetSizeGb?: number; runtime?: string }
  }
}

export type OrderDraftOption = {
  optionId: string
  resourceId: string
  providerPubkey: string
  providerEndpoint?: string
  score: number
  reason?: string
  expiresAt?: string
  quoteId?: string
  realtimeStatus?: string
  confirmedAt?: string
  priceSnapshot?: {
    pricePerUnit?: number
    billingUnit?: string
    currency?: string
    availability?: string
  }
  draft?: {
    goal?: string
    requirements?: Record<string, unknown>
  }
}

export type NormalizedQuery = {
  type?: string
  minVramGb?: number
  minGpuCount?: number
  query?: string
  region?: string
}

export type OrderPlan = {
  planId: string
  query: string
  projectPath?: string
  workUid?: string
  requesterPubkey?: string
  status: string
  agentId?: string
  options?: OrderDraftOption[]
  realtimeRequired?: boolean
  candidates?: Array<{
    optionId?: string
    resourceId?: string
    providerPubkey?: string
    endpoint?: string
    status: string
    message?: string
    quoteId?: string
    priceAmount?: number
    currency?: string
    expiresAt?: string
    updatedAt?: string
  }>
  events?: Array<{ time?: string; type: string; message?: string; optionId?: string }>
  selectedOptionId?: string
  taskId?: string
  approvalId?: string
  paymentId?: string
  providerJobId?: string
  normalizedQuery?: NormalizedQuery
  nextAction?: string
  expiresAt?: string
  createdAt?: string
  updatedAt?: string
}

export type MarketSearchResult = {
  normalizedQuery?: NormalizedQuery
  candidates?: SellerCandidate[]
  orderDraftOptions?: OrderDraftOption[]
  selectionRequest?: { planId: string; status: string; expiresAt?: string; nextAction?: string }
  summary?: string
  nextAction?: string
}

export function agentSourceLabel(agentId?: string) {
  if (agentId === 'exora-desktop-agent') return 'Built-in Agent'
  if (agentId && agentId.trim()) return `MCP / ${agentId}`
  return 'MCP / External Agent'
}

export function targetSummary(query?: NormalizedQuery) {
  if (!query) return 'market request'
  return [
    query.type || query.query || 'market',
    query.minVramGb ? `${query.minVramGb}GB+ VRAM` : '',
    query.minGpuCount ? `${query.minGpuCount}+ GPU` : '',
    query.region ? `region ${query.region}` : '',
  ].filter(Boolean).join(' / ')
}

export function optionCapability(option: OrderDraftOption) {
  const requirements = option.draft?.requirements || {}
  const type = stringValue(requirements.type)
  const minVram = numberValue(requirements.minVramGb)
  const minGpu = numberValue(requirements.minGpuCount)
  return [
    type,
    minVram ? `${minVram}GB+ VRAM` : '',
    minGpu ? `${minGpu}+ GPU` : '',
    option.resourceId,
  ].filter(Boolean).join(' / ')
}

export function optionIsPaid(option: OrderDraftOption) {
  return (option.priceSnapshot?.pricePerUnit || 0) > 0
}

export function optionPrice(option: OrderDraftOption) {
  return formatPrice(
    option.priceSnapshot?.pricePerUnit || 0,
    option.priceSnapshot?.currency || 'USD',
    option.priceSnapshot?.billingUnit || 'unit',
  )
}

export function approvalAmount(approval: Approval) {
  const value = approval.amount?.value || approval.quote?.priceAmount || 0
  const currency = approval.amount?.currency || approval.quote?.currency || 'USD'
  return value > 0 ? `${trimNumber(value)} ${currency}` : 'none'
}

export function taskAmount(task?: Task) {
  if (!task?.quote?.priceAmount) return 'none'
  return `${trimNumber(task.quote.priceAmount)} ${task.quote.currency || 'USD'}`
}

export function paymentAmount(payment?: PaymentRecord) {
  if (!payment?.amount) return 'none'
  return `${trimNumber(payment.amount)} ${payment.currency || 'USD'}`
}

export function formatPrice(amount: number, currency: string, unit?: string) {
  if (!amount || amount <= 0) return 'free'
  return `${trimNumber(amount)} ${currency}${unit ? ` / ${unit}` : ''}`
}

export function taskTitle(task: Task) {
  return task.goal || task.type || task.id
}

export function statusRank(status?: string) {
  switch (status) {
    case 'pending_selection':
    case 'pending_quote':
    case 'pending_consent':
    case 'requires_confirmation':
      return 0
    case 'consented':
    case 'confirmed_simulated':
      return 1
    case 'claimed':
    case 'running':
      return 2
    case 'completed':
      return 3
    case 'failed':
    case 'invalidated':
    case 'expired':
      return 4
    default:
      return 5
  }
}

export function trimNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

export function shortID(value?: string, head = 8, tail = 6) {
  if (!value) return 'unknown'
  if (value.length <= head + tail + 3) return value
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

export function humanizeError(error: unknown) {
  let text = String(error)
  for (let i = 0; i < 4; i += 1) {
    const next = text
      .replace(/^Error:\s*/, '')
      .replace(/^Error invoking remote method '[^']+':\s*/, '')
      .replace(/^Error occurred in handler for '[^']+':\s*/, '')
      .replace(/^TypeError:\s*/, '')
    if (next === text) break
    text = next
  }
  const jsonStart = text.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart))
      if (parsed?.error === 'offer_expired') return 'Offer changed or expired. Ask the agent to search again.'
      if (parsed?.error) return String(parsed.error)
    } catch {
      // Fall through to plain text.
    }
  }
  if (text.includes('payment_pin_required')) return 'Payment PIN is required before this paid task can continue.'
  if (text.includes('offer_expired')) return 'Offer changed or expired. Ask the agent to search again.'
  const lower = text.toLowerCase()
  if (lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('socket hang up')) {
    return 'Network request failed. Check that the local Exora Dock runtime is running, then try again.'
  }
  return text.replace(/^Error:\s*/, '')
}

export function escapeHTML(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] || ch))
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}
