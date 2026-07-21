type ExoraBridge = {
  isPackaged?: boolean
  initialTheme?: 'system' | 'light' | 'dark'
  initialLocale?: {
    language?: 'en' | 'zh'
    chromiumLocale?: string
  }
  invoke<T = unknown>(command: string, payload?: Record<string, unknown>): Promise<T>
  getPathForFile?(file: File): string
  onV3Progress?(callback: (payload: unknown) => void): () => void
  onAuthStateChanged?(callback: (payload: unknown) => void): () => void
}

declare global {
  interface Window {
    exora?: ExoraBridge
  }
}

function previewProviderAPIDrafts() {
  const operationSha256 = '69184684b98ba5db0ede090e0de071a4571280cad6c1af2d021ca101bc80817c'
  const pricingDraft: any = {
    apiId: 'api_preview_manual_pricing_v3',
    version: 7,
    source: 'manual',
    status: 'local_draft',
    deliveryMode: 'local_dock',
    title: 'Summarize Text',
    description: 'Generate a concise summary from submitted text.',
    validation: { status: 'passed', capabilitySha256: operationSha256, operationSha256: { summarize_text: operationSha256 }, issues: [] },
    capability: {
      schemaVersion: 'exora.api.v3',
      title: 'Summarize Text',
      description: 'Generate a concise summary from submitted text.',
      deliveryMode: 'local_dock',
      runtime: { publicBaseUrl: 'http://127.0.0.1:8787', healthPath: '/health' },
      interface: { openapi: '3.1.0', info: { title: 'Summarize Text', version: '1.0.0' }, paths: { '/summarize': { post: { operationId: 'summarize_text', requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1 } } } } } }, responses: { '200': { description: 'Summary', content: { 'application/json': { schema: { type: 'object', required: ['summary', 'usage'], properties: { summary: { type: 'string', minLength: 1 }, usage: { type: 'object' } } } } } } } } } } },
      operations: [{
        schemaVersion: 'exora.operation.v3', operationId: 'summarize_text', title: 'Summarize Text', description: 'Generate a concise summary from submitted text.',
        usage: { useCases: ['Summarize supplied text'], instructions: ['Send non-empty text.'] },
        api: { method: 'POST', path: '/summarize', openapiOperationRef: '#/paths/~1summarize/post', errors: [{ code: 'invalid_text', httpStatus: 400, description: 'Text is empty.', retryable: false }] },
        behavior: { sideEffect: { present: false, description: 'No external changes.', reversible: false, testMode: 'none' }, idempotency: { supported: true, retentionSeconds: 86400 } },
        interaction: { mode: 'request_response' }, limits: { timeoutSeconds: 30, maximumRequestBytes: 1048576, maximumResponseBytes: 1048576, maximumConcurrency: 4 },
        metering: { capabilities: [{ dimension: 'input_characters', unit: 'character', description: 'Characters accepted from the request.', source: 'cloud', maximumPerInvocation: 100000 }] },
        qualification: { fixtures: [{ id: 'summary_basic', kind: 'success', request: { body: { text: 'Exora connects agents to APIs.' } }, safeToRepeat: true, expectedProtocol: { status: 200, mediaType: 'application/json', openapiResponseRef: '#/paths/~1summarize/post/responses/200' } }] },
      }],
    },
    operationReviews: {
      summarize_text: {
        operationId: 'summarize_text', operationSha256, enabled: true,
        integrationStatus: 'locked', pricingStatus: 'editable', operationalState: 'offline',
        validationPlan: { schemaVersion: 'exora.operation-validation-plan.v3', planSha256: operationSha256, checks: [{ id: 'seller_case:summary_basic', category: 'seller_case', type: 'success' }] },
        validationReceipt: { schemaVersion: 'exora.operation-validation-receipt.v3', passed: true, verifiedMetering: [{ dimension: 'input_characters', unit: 'character', source: 'cloud', maximumPerInvocation: 100000 }], sampleUsage: { input_characters: 30 } },
        operationalMetrics: { inFlight: 0, invocations: 0, grossRevenueAtomic: 0, refundedAtomic: 0, providerFaultRate: 0, healthFailureStreak: 0, blocked: false },
        operationalSettings: { concurrencyLimit: 4, contractMaximumConcurrency: 4 },
      },
    },
  }
  const consoleDraft = structuredClone(pricingDraft)
  consoleDraft.apiId = 'api_preview_operations_console_v3'
  consoleDraft.title = 'Translate Text'
  consoleDraft.capability.title = 'Translate Text'
  consoleDraft.capability.description = 'Translate submitted text and monitor live fulfillment.'
  consoleDraft.capability.operations[0].title = 'Translate Text'
  consoleDraft.capability.operations[0].description = 'Translate submitted text and monitor live fulfillment.'
  consoleDraft.operationReviews.summarize_text.pricingStatus = 'locked'
  consoleDraft.operationReviews.summarize_text.pricingDraft = {
    schemaVersion: 'exora.operation-pricing.v4', currency: 'USDC',
    chargeFormula: { language: 'exora.price-formula.v4', expression: 'input_characters * 0.00001 + delivered * 0.01' },
    maximumChargePerInvocationAtomic: 1000000,
    settlementPolicy: 'exora.operation-settlement.v4', reviewStatus: 'confirmed',
  }
  consoleDraft.operationReviews.summarize_text.pricing = structuredClone(consoleDraft.operationReviews.summarize_text.pricingDraft)
  consoleDraft.operationReviews.summarize_text.pricingBillingReceipt = { schemaVersion: 'exora.operation-billing-receipt.v4', passed: true, sandbox: true, receiptId: 'bill_preview_v4', formulaAstSha256: operationSha256, planSha256: operationSha256, scenarios: [{ schemaVersion: 'exora.operation-settlement.v4', outcome: 'success', delivered: 1, actualUsage: { input_characters: 30 }, reservedAtomic: 1000000, formulaChargeAtomic: 10300, chargedAtomic: 10300, refundedAtomic: 989700 }] }
  pricingDraft.contractPackage = {
    schemaVersion: 'exora.api-contract.v1', apiId: pricingDraft.apiId, capability: structuredClone(pricingDraft.capability),
    billing: [{ operationId: 'summarize_text', currency: 'USDC', chargeFormula: { language: 'exora.price-formula.v4', expression: 'input_characters * 0.00001 + delivered * 0.01' }, maximumChargePerInvocationAtomic: 1000000, settlementPolicy: 'exora.operation-settlement.v4' }],
  }
  pricingDraft.contractPackage.capability.apiId = pricingDraft.apiId
  pricingDraft.contractPackageSha256 = operationSha256
  consoleDraft.contractPackage = structuredClone(pricingDraft.contractPackage)
  consoleDraft.contractPackage.apiId = consoleDraft.apiId
  consoleDraft.contractPackage.capability.apiId = consoleDraft.apiId
  consoleDraft.contractPackageSha256 = operationSha256
  return [pricingDraft, consoleDraft]
}

export function invoke<T = unknown>(command: string, payload?: Record<string, unknown>): Promise<T> {
  if (!window.exora?.invoke) {
    const developmentPreview = window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1'
    if (developmentPreview && command === 'app_settings_load') {
      return Promise.resolve({ version: 6, settings: {} } as T)
    }
    if (developmentPreview && command === 'auth_status') {
      return Promise.resolve({ phase: 'authenticated', authenticated: true, cloudURL: 'https://api.exoradock.com', account: { accountId: 'preview-owner', email: 'owner@example.test', emailVerifiedAt: new Date(0).toISOString() }, dock: { linked: true } } as T)
    }
    if (developmentPreview && ['window_set_mode', 'window_minimize', 'window_toggle_maximize', 'window_close'].includes(command)) {
      return Promise.resolve(undefined as T)
    }
    if (developmentPreview && ['app_status', 'restart_dock'].includes(command)) {
      return Promise.resolve({ docker: 'native', container: 'running', daemon: 'healthy', image: 'available', containerName: 'exora-dockd', imageTag: 'preview', baseUrl: 'http://127.0.0.1:8080', dataDir: '', configPath: '', discoveryPath: '', mcpCommand: '', agentPrompt: '', opencodeConfig: '', message: 'Dock is ready for local Agent connections.' } as T)
    }
    if (developmentPreview && command === 'mcp_connectivity_test') {
      return Promise.resolve({ ok: true, protocolVersion: '2025-06-18', serverName: 'exora-dock', toolCount: 17, categories: [{ applicationSource: 'api', deliveryModes: ['local_dock', 'cloud_direct'], ok: true, itemCount: 0 }] } as T)
    }
    if (developmentPreview && command === 'catalog_listings') {
      return Promise.resolve({ operations: [{
        apiId: 'api_preview_marketplace_v4', operationId: 'summarize_text', title: 'Summarize Text',
        description: 'Generate a concise summary from submitted text.', interaction: 'request_response', availability: 'available',
        pricing: { currency: 'USDC', chargeFormula: { language: 'exora.price-formula.v4', expression: '0.02' }, maximumChargePerInvocationAtomic: 20_000 },
        api: { apiId: 'api_preview_marketplace_v4', title: 'Virtual Text Summary API', deliveryMode: 'local_dock', lifecycle: 'live', runtimeHealth: 'healthy' },
      }] } as T)
    }
    if (developmentPreview && command === 'provider_api_drafts') {
      return Promise.resolve({ apiDrafts: previewProviderAPIDrafts() } as T)
    }
    if (developmentPreview && command === 'agent_mcp_status') {
      return Promise.resolve({ clients: [
        { clientId: 'codex', instanceId: 'preview-codex-cli', instanceLabel: 'Codex CLI', installKind: 'cli', installPath: 'AppData/Roaming/npm/codex.cmd', version: '0.143.0', displayName: 'Codex', detected: true, state: 'available', message: 'Ready to connect.' },
        { clientId: 'codex', instanceId: 'preview-codex-desktop', instanceLabel: 'Codex Desktop', installKind: 'desktop', installPath: 'Applications/Codex.app', version: '26.715.3651.0', displayName: 'Codex', detected: true, state: 'available', message: 'Ready to connect.' },
        { clientId: 'claude-code', instanceId: 'preview-claude', displayName: 'Claude Code', detected: true, state: 'registered', managed: true, message: 'Registered by Exora Dock.' },
        { clientId: 'cursor', instanceId: 'preview-cursor', displayName: 'Cursor', detected: true, state: 'available', message: 'Ready to connect.' },
        { clientId: 'opencode', instanceId: '', displayName: 'OpenCode', detected: false, state: 'not-detected' },
        { clientId: 'openclaw', instanceId: '', displayName: 'OpenClaw', detected: false, state: 'not-detected' },
      ] } as T)
    }
    if (developmentPreview && command === 'agent_mcp_register') {
      const input = payload?.input as { clientIds?: string[]; instanceIds?: string[] } | undefined
      const ids = Array.isArray(input?.instanceIds) ? input.instanceIds : Array.isArray(input?.clientIds) ? input.clientIds : []
      return Promise.resolve({ onboardingVersion: 2, clients: ids.map((instanceId) => ({ instanceId, ok: true, state: 'registered' })) } as T)
    }
    if (developmentPreview && ['agent_mcp_remove', 'agent_mcp_repair', 'agent_mcp_probe'].includes(command)) return Promise.resolve({ ok: true } as T)
    if (developmentPreview && ['copy_mcp_command', 'copy_opencode_config'].includes(command)) {
      return Promise.resolve((command === 'copy_opencode_config' ? '{"mcp":{"exora-dock":{"command":"exora-dockd"}}}' : 'exora-dockd --config ./config.yaml') as T)
    }
    if (developmentPreview && command === 'system_update_check') {
      return Promise.resolve({ supported: false, channel: 'stable', state: 'development', message: 'Updates are disabled in the browser preview.' } as T)
    }
    if (developmentPreview && command === 'system_choose_download_directory') return Promise.resolve({ canceled: true, path: '' } as T)
    if (developmentPreview && ['save_app_settings', 'set_locale', 'system_notification_test', 'system_open_path', 'system_clear_storage'].includes(command)) return Promise.resolve({ ok: true } as T)
    return Promise.reject(new Error('Exora Desktop bridge is not available. Open this screen in the Electron app.'))
  }
  return window.exora.invoke<T>(command, payload)
}
