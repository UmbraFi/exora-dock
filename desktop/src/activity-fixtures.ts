export type LocalActivityRole = 'buyer' | 'seller'

export type LocalActivitySession = {
  sessionId: string
  activitySessionId?: string
  role: LocalActivityRole
  productKind: 'compute' | 'download' | 'api_operation'
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

export type LocalActivityDetail = LocalActivitySession & {
  product?: Record<string, unknown>
  operations?: string[]
  usage?: Record<string, number>
  invocations?: Array<{
    invocationId: string
    operationId: string
    status: string
    chargedAtomic: number
    platformFeeAtomic: number
    usage?: Record<string, number>
    startedAt: string
    completedAt?: string
  }>
  events?: Array<{
    eventId: string
    type: string
    status: string
    title: string
    detail: string
    occurredAt: string
  }>
  identifiers?: Record<string, string>
  delivery?: Record<string, unknown>
  purchases?: Array<Record<string, unknown>>
  transfers?: Array<Record<string, unknown>>
}

const localActivityFixtures: LocalActivityDetail[] = [
  {
    sessionId: 'local-test-buyer-compute-active',
    activitySessionId: 'test-task-buyer-gpu-001',
    role: 'buyer',
    productKind: 'compute',
    productId: 'prd_test_h100_compute',
    listingId: 'lst_test_h100_compute',
    productTitle: '测试 · H100 模型评测环境',
    counterpartyLabel: 'Shanghai GPU Lab',
    status: 'active',
    outcome: '独占计算租约正在运行，环境与计费心跳正常。',
    attentionRequired: false,
    itemCount: 3,
    amountAtomic: 12_600_000,
    grossAmountAtomic: 12_600_000,
    platformFeeAtomic: 756_000,
    asset: 'USDC',
    startedAt: '2026-07-15T03:20:00.000Z',
    updatedAt: '2026-07-15T04:05:00.000Z',
    product: { version: 3, description: '配备 80 GB 显存的 H100 测试节点，按分钟结算并提供隔离工作区。' },
    usage: { duration_minutes: 45, input_bytes: 1_879_048_192, output_bytes: 384_827_392 },
    events: [
      { eventId: 'evt_test_buyer_compute_3', type: 'heartbeat', status: 'active', title: 'Runtime heartbeat', detail: 'Guest environment is healthy and the lease remains active.', occurredAt: '2026-07-15T04:05:00.000Z' },
      { eventId: 'evt_test_buyer_compute_2', type: 'provisioned', status: 'completed', title: 'Environment provisioned', detail: 'CUDA 12.4 image and the reserved workspace passed validation.', occurredAt: '2026-07-15T03:23:00.000Z' },
      { eventId: 'evt_test_buyer_compute_1', type: 'purchase', status: 'completed', title: 'Compute purchase authorized', detail: 'The buyer hold was accepted before the provider started provisioning.', occurredAt: '2026-07-15T03:20:00.000Z' },
    ],
    identifiers: { sessionId: 'local-test-buyer-compute-active', activitySessionId: 'test-task-buyer-gpu-001', productId: 'prd_test_h100_compute', listingId: 'lst_test_h100_compute', leaseId: 'lea_test_h100_001' },
  },
  {
    sessionId: 'local-test-buyer-download-completed',
    activitySessionId: 'test-task-buyer-lidar-002',
    role: 'buyer',
    productKind: 'download',
    productId: 'prd_test_lidar_bundle',
    listingId: 'lst_test_lidar_bundle',
    productTitle: '测试 · 华东道路 LiDAR 数据集',
    counterpartyLabel: 'GeoData Studio',
    status: 'completed',
    outcome: '授权文件已下载并通过 SHA-256 校验。',
    attentionRequired: false,
    itemCount: 2,
    amountAtomic: 4_800_000,
    grossAmountAtomic: 4_800_000,
    platformFeeAtomic: 288_000,
    asset: 'USDC',
    startedAt: '2026-07-14T08:10:00.000Z',
    updatedAt: '2026-07-14T08:42:00.000Z',
    endedAt: '2026-07-14T08:42:00.000Z',
    product: { version: 7, description: '道路点云、标注与许可证组成的固定版本资料包。' },
    usage: { transfer_bytes: 12_884_901_888, downloads: 2 },
    events: [
      { eventId: 'evt_test_buyer_download_3', type: 'verified', status: 'completed', title: 'Checksum verified', detail: 'The downloaded archive matched the published SHA-256 digest.', occurredAt: '2026-07-14T08:42:00.000Z' },
      { eventId: 'evt_test_buyer_download_2', type: 'transfer', status: 'completed', title: 'Resumable transfer completed', detail: 'The second range request resumed from the retained partial archive.', occurredAt: '2026-07-14T08:40:00.000Z' },
      { eventId: 'evt_test_buyer_download_1', type: 'grant', status: 'completed', title: 'Download grant issued', detail: 'A 24-hour non-transferable grant was attached to this session.', occurredAt: '2026-07-14T08:10:00.000Z' },
    ],
    identifiers: { sessionId: 'local-test-buyer-download-completed', activitySessionId: 'test-task-buyer-lidar-002', productId: 'prd_test_lidar_bundle', listingId: 'lst_test_lidar_bundle', grantId: 'grt_test_lidar_002' },
  },
  {
    sessionId: 'local-test-buyer-api-attention',
    activitySessionId: 'test-task-buyer-ocr-003',
    role: 'buyer',
    productKind: 'api_operation',
    productId: 'prd_test_invoice_ocr',
    listingId: 'lst_test_invoice_ocr',
    productTitle: '测试 · 发票 OCR 批处理 API',
    counterpartyLabel: 'Vision Tools CN',
    status: 'needs_attention',
    outcome: '三次调用中有一次上游超时，需要检查失败记录。',
    attentionRequired: true,
    itemCount: 3,
    amountAtomic: 2_340_000,
    grossAmountAtomic: 2_340_000,
    platformFeeAtomic: 140_400,
    asset: 'USDC',
    startedAt: '2026-07-13T11:00:00.000Z',
    updatedAt: '2026-07-13T11:08:30.000Z',
    endedAt: '2026-07-13T11:08:30.000Z',
    product: { version: 2, description: '将发票图片转换为结构化 JSON 的按次计费 API。' },
    operations: ['extract_invoice', 'validate_invoice'],
    usage: { request: 3, successful_request: 2, input_bytes: 18_772_992, output_bytes: 92_160 },
    invocations: [
      { invocationId: 'inv_test_ocr_003', operationId: 'extract_invoice', status: 'upstream_error', chargedAtomic: 0, platformFeeAtomic: 0, usage: { request: 1 }, startedAt: '2026-07-13T11:08:00.000Z', completedAt: '2026-07-13T11:08:30.000Z' },
      { invocationId: 'inv_test_ocr_002', operationId: 'validate_invoice', status: 'completed', chargedAtomic: 780_000, platformFeeAtomic: 46_800, usage: { request: 1, successful_request: 1 }, startedAt: '2026-07-13T11:04:00.000Z', completedAt: '2026-07-13T11:04:02.000Z' },
      { invocationId: 'inv_test_ocr_001', operationId: 'extract_invoice', status: 'completed', chargedAtomic: 1_560_000, platformFeeAtomic: 93_600, usage: { request: 1, successful_request: 1 }, startedAt: '2026-07-13T11:00:00.000Z', completedAt: '2026-07-13T11:00:05.000Z' },
    ],
    identifiers: { sessionId: 'local-test-buyer-api-attention', activitySessionId: 'test-task-buyer-ocr-003', productId: 'prd_test_invoice_ocr', listingId: 'lst_test_invoice_ocr' },
  },
  {
    sessionId: 'local-test-seller-compute-active',
    activitySessionId: 'test-task-seller-cuda-101',
    role: 'seller',
    productKind: 'compute',
    productId: 'prd_test_cuda_node',
    listingId: 'lst_test_cuda_node',
    productTitle: '测试 · CUDA 12 推理节点',
    counterpartyLabel: 'Buyer acct_test_8F21',
    status: 'active',
    outcome: '买家工作负载正在隔离环境中运行，卖家收益持续累计。',
    attentionRequired: false,
    itemCount: 4,
    amountAtomic: 16_920_000,
    grossAmountAtomic: 18_000_000,
    platformFeeAtomic: 1_080_000,
    asset: 'USDC',
    startedAt: '2026-07-15T01:40:00.000Z',
    updatedAt: '2026-07-15T04:10:00.000Z',
    product: { version: 5, description: '卖家本地 RTX 6000 Ada 节点提供的隔离 CUDA 推理环境。' },
    usage: { duration_minutes: 150, input_bytes: 4_294_967_296, output_bytes: 901_775_360 },
    events: [
      { eventId: 'evt_test_seller_compute_3', type: 'heartbeat', status: 'active', title: 'Lease heartbeat accepted', detail: 'Capacity and runtime checks remain healthy for the active buyer lease.', occurredAt: '2026-07-15T04:10:00.000Z' },
      { eventId: 'evt_test_seller_compute_2', type: 'lease', status: 'active', title: 'Buyer lease started', detail: 'The disposable environment started after the payment hold settled.', occurredAt: '2026-07-15T01:44:00.000Z' },
      { eventId: 'evt_test_seller_compute_1', type: 'reservation', status: 'completed', title: 'Capacity reserved', detail: 'Disk, memory and GPU capacity were reserved for one exclusive lease.', occurredAt: '2026-07-15T01:40:00.000Z' },
    ],
    identifiers: { sessionId: 'local-test-seller-compute-active', activitySessionId: 'test-task-seller-cuda-101', productId: 'prd_test_cuda_node', listingId: 'lst_test_cuda_node', leaseId: 'lea_test_cuda_101' },
  },
  {
    sessionId: 'local-test-seller-download-completed',
    activitySessionId: 'test-task-seller-defect-102',
    role: 'seller',
    productKind: 'download',
    productId: 'prd_test_defect_images',
    listingId: 'lst_test_defect_images',
    productTitle: '测试 · 工业缺陷图像包',
    counterpartyLabel: 'Buyer acct_test_45C0',
    status: 'completed',
    outcome: '买家已完成下载，扣除平台费后的收益进入结算记录。',
    attentionRequired: false,
    itemCount: 1,
    amountAtomic: 7_520_000,
    grossAmountAtomic: 8_000_000,
    platformFeeAtomic: 480_000,
    asset: 'USDC',
    startedAt: '2026-07-14T05:35:00.000Z',
    updatedAt: '2026-07-14T06:02:00.000Z',
    endedAt: '2026-07-14T06:02:00.000Z',
    product: { version: 4, description: '包含钢材表面缺陷图片、类别标注和商业使用许可证。' },
    usage: { transfer_bytes: 6_442_450_944, downloads: 1 },
    events: [
      { eventId: 'evt_test_seller_download_3', type: 'settlement', status: 'completed', title: 'Seller revenue recorded', detail: 'Net revenue was recorded after the platform fee.', occurredAt: '2026-07-14T06:02:00.000Z' },
      { eventId: 'evt_test_seller_download_2', type: 'transfer', status: 'completed', title: 'Buyer transfer verified', detail: 'The delivered archive matched the immutable product version.', occurredAt: '2026-07-14T06:00:00.000Z' },
      { eventId: 'evt_test_seller_download_1', type: 'purchase', status: 'completed', title: 'Purchase accepted', detail: 'A fixed-price purchase created the buyer download grant.', occurredAt: '2026-07-14T05:35:00.000Z' },
    ],
    identifiers: { sessionId: 'local-test-seller-download-completed', activitySessionId: 'test-task-seller-defect-102', productId: 'prd_test_defect_images', listingId: 'lst_test_defect_images', grantId: 'grt_test_defect_102' },
  },
  {
    sessionId: 'local-test-seller-api-completed',
    activitySessionId: 'test-task-seller-pdf-103',
    role: 'seller',
    productKind: 'api_operation',
    productId: 'prd_test_pdf_table_api',
    listingId: 'lst_test_pdf_table_api',
    productTitle: '测试 · PDF 表格提取 API',
    counterpartyLabel: 'Buyer acct_test_B910',
    status: 'completed',
    outcome: '三次调用均成功完成，计量与收益记录一致。',
    attentionRequired: false,
    itemCount: 3,
    amountAtomic: 4_230_000,
    grossAmountAtomic: 4_500_000,
    platformFeeAtomic: 270_000,
    asset: 'USDC',
    startedAt: '2026-07-12T09:15:00.000Z',
    updatedAt: '2026-07-12T09:22:10.000Z',
    endedAt: '2026-07-12T09:22:10.000Z',
    product: { version: 6, description: '从 PDF 中提取表格并输出规范化 CSV 或 JSON。' },
    operations: ['extract_tables', 'export_csv'],
    usage: { request: 3, successful_request: 3, input_bytes: 31_457_280, output_bytes: 1_245_184, execution_second: 29 },
    invocations: [
      { invocationId: 'inv_test_pdf_103', operationId: 'export_csv', status: 'completed', chargedAtomic: 900_000, platformFeeAtomic: 54_000, usage: { request: 1, successful_request: 1 }, startedAt: '2026-07-12T09:22:06.000Z', completedAt: '2026-07-12T09:22:10.000Z' },
      { invocationId: 'inv_test_pdf_102', operationId: 'extract_tables', status: 'completed', chargedAtomic: 1_800_000, platformFeeAtomic: 108_000, usage: { request: 1, successful_request: 1 }, startedAt: '2026-07-12T09:18:00.000Z', completedAt: '2026-07-12T09:18:13.000Z' },
      { invocationId: 'inv_test_pdf_101', operationId: 'extract_tables', status: 'completed', chargedAtomic: 1_800_000, platformFeeAtomic: 108_000, usage: { request: 1, successful_request: 1 }, startedAt: '2026-07-12T09:15:00.000Z', completedAt: '2026-07-12T09:15:12.000Z' },
    ],
    identifiers: { sessionId: 'local-test-seller-api-completed', activitySessionId: 'test-task-seller-pdf-103', productId: 'prd_test_pdf_table_api', listingId: 'lst_test_pdf_table_api' },
  },
]

function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function activitySummary(detail: LocalActivityDetail): LocalActivitySession {
  const { product: _product, operations: _operations, usage: _usage, invocations: _invocations, events: _events, identifiers: _identifiers, delivery: _delivery, purchases: _purchases, transfers: _transfers, ...summary } = detail
  return cloneFixture(summary)
}

export function localActivitySessionsForRole(role: LocalActivityRole): LocalActivitySession[] {
  return localActivityFixtures.filter((fixture) => fixture.role === role).map(activitySummary)
}

export function localActivityDetailForSession(sessionId: string): LocalActivityDetail | undefined {
  const fixture = localActivityFixtures.find((item) => item.sessionId === sessionId)
  return fixture ? cloneFixture(fixture) : undefined
}
