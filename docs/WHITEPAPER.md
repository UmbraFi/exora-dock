# Exora V3.2 AI-First 资源市场协议白皮书

**版本：V3.2 Alpha**  
**状态：协议规范草案**  
**定位：主要由 AI Agent 搜索、购买和调用的即时资源市场**

> 卖家只需安装 Dock、上传资料或提交 OpenAPI，即可把闲置能力变成收益；买家的 AI Agent 通过 MCP/API 搜索、购买和调用，人类界面只承担管理、审批与阅览。

## 1. 摘要

Exora V3.2 将已经准备完成的数字资源转换为 Agent 可搜索、可购买、可调用的标准商品。卖家可以安装 Exora Dock 自动出售空闲 Linux 物理机，上传一个可按次购买的资料包，或提交 OpenAPI 将每个 operation 标准化上架。Exora Cloud 管理市场、购买、租约、用量、平台账本与卖家打款；Dock 管理本地授权、真实环境、文件传输和执行。

协议主线是：

```text
Resource → Listing → Lease → Usage → Settlement
```

市场包含三种 Agent 商品：`compute` 预购整数分钟的独占服务器 VM；`download` 付费获得固定 AssetVersion 的限时 DownloadGrant；`api_operation` 购买一行数据、报表、查询、转换或带副作用的 OpenAPI operation。所有商品都由统一 `AgentProductManifest` 描述。

计算产品继续采用严格 1:1 模型：一台物理机只对应一个 `InventorySlot` 和一台 Consumer VM。Worker 自动检测卖家本地占用，资源不足时无需卖家手动下架；空闲恢复后经过三次完整检查自动重新上架。Host 只保留 Exora 控制域；Consumer Agent 获得 VM 内 root。租约结束后从签名 Golden Image 恢复干净 VM。

Exora 不要求卖家提供 Agent，也不提供新的聊天入口。MCP/API 是权威市场入口；图形化内容只是可选的人类辅助，不能成为 Agent 理解商品所必需的信息。人类伴随界面用于卖家上传、OpenAPI 导入、定价、收入、资源状态、审批、账单、提现和可选市场阅览。

本白皮书是 V3.2 的目标协议，不代表仓库当前 V2 实现已经具备这些能力。

## 2. 原则与非目标

### 2.1 原则

1. **AI-First Market**：MCP/API 是权威购买入口，Agent 不依赖视觉页面理解商品。
2. **Bring Your Own Agent**：用户继续使用自己的 Codex、Claude Code、Cursor 或其他 MCP 客户端。
3. **Ready Means Reserved**：标记为 `availableNow` 的资源必须已经准备环境并满足真实容量保证。
4. **One Host, One Slot, One VM**：一台物理机只能出售为一个独占计算库存。
5. **Automatic Availability**：卖家使用自己的机器时自动暂停，恢复空闲后自动重新上架。
6. **Guest Root, Host Control**：Agent 可以控制租赁 VM，但不能控制 Worker、Hypervisor、Golden Image 或计量域。
7. **Protocol over Chat**：文本、Schema、价格、权限、用量和结果全部由结构化协议表达。
8. **Control/Data Separation**：MCP 与 HTTPS 负责控制，大文件和日志走独立数据通道。
9. **Lease-scoped Cleanliness**：每个 Lease 使用独立加密写入层，结束后必须恢复并验证干净状态。
10. **Meter before Settlement**：只有可验证、可去重的 UsageRecord 可以进入账本。
11. **Human Ownership**：账户、资金、发布、预算、敏感资料和争议决定属于人类。

### 2.2 非目标

V3.2 Alpha 不：

- 提供或转售模型推理与模型 Token；
- 要求 Provider 提供 Agent、Prompt 或模型凭据；
- 提供通用聊天界面；
- 要求商品依赖图片、视频或图形界面才能被 Agent 理解；
- 支持一台 Host 的多 VM 出售、共享 GPU、MIG 分售或资源超卖；
- 首发支持 Hyper-V、VMware 或 Windows Provider Host；
- 将大文件正文放入 MCP 消息；
- 推断没有 OpenAPI 的 API 业务语义；
- 把订餐等现实履约定义为第四类商品，或结算餐费、运费等外部购买金额；
- 向 Consumer 或 Agent 暴露 Host Root、libvirt socket、Provider SSH、支付凭据或平台 Owner Token；
- 把清理脚本视为 Golden Image Reset 的等价证明；
- 声称当前代码已经实现本协议。

## 3. 参与者与权威边界

### 3.1 Consumer 与 Consumer Agent

Consumer 是购买资源的人类账户，拥有预算、付款方式、Lease、产物与授权策略。Consumer Agent 是用户自带的 MCP 客户端，可以搜索、估价、申请租约和在有效 Capability 内执行动作，但不能扩大自身权限、修改历史计量或代表人类裁决争议。

### 3.2 Provider

Provider 上传资料、连接物理计算机或发布 API，并对可用性、描述、价格、许可证和合法性负责。Provider 可以自助上架；自动验证失败的资源不得发布。支付渠道要求时，首次打款前必须完成身份与收款账户验证。

### 3.3 Exora Dock

同一 Dock 程序支持两种可同时启用的模式：

- **Consumer MCP**：向本地 Agent 暴露 Exora 工具并执行本地预算与审批策略。
- **Provider Worker**：运行在 Linux Host 控制域，检测硬件、控制 KVM/libvirt、维护唯一 InventorySlot、执行租约、采集计量并恢复 VM。

Dock 设备密钥保存在操作系统安全存储中。Worker 永远运行在它所创建和销毁的 Consumer VM 之外。

### 3.4 Exora Cloud

Cloud 是账户、Resource、Listing、InventorySlot 投影、Lease、UsageRecord、平台账本与 Settlement 的权威。Cloud 负责市场搜索、CapacityHold、排他租赁、短期 Capability、对象存储授权、API Gateway、退款和 Payout。

### 3.5 权威边界

```text
Cloud          目录、租约、预算、用量归并、账本与结算
Provider Worker 物理硬件、实时容量、VM 生命周期、执行与 Reset 事实
Hypervisor     CPU/内存/设备分配和 VM 隔离事实
Object Store   托管文件字节与对象版本
API Gateway    API 请求、响应状态、字节数和调用计量
Payment Rail   充值、提现、拒付和外部资金移动
Human          发布、预算、敏感授权、证据披露和争议决定
```

## 4. 公共协议对象

所有公共对象使用不可变 ID、RFC 3339 UTC 时间与显式 `schemaVersion`。业务写入必须携带 8–128 字符的 `idempotencyKey`；更新投影时还必须携带 `expectedVersion`。金额使用 ISO 4217 货币与整数最小货币单位，禁止浮点金额。

HTTP 主版本保持 `/v3`；Schema 使用 `exora.<object>.v3alpha1`。V3 尚未稳定，因此文档升级为 V3.2 不改变 Alpha Schema 主版本。

### 4.1 AgentProductManifest

`AgentProductManifest` 是 AI 市场的权威商品描述。`productKind` 仅允许 `compute`、`download`、`api_operation`。自然语言说明用于检索和解释，JSON Schema、价格、限制和错误语义用于确定性调用。图片或人类页面不得增加 Manifest 中不存在的能力。

```json
{
  "schemaVersion": "exora.agent_product_manifest.v3alpha1",
  "productId": "prd_01",
  "productKind": "api_operation",
  "title": "Generate one sales report",
  "description": "Returns a structured monthly sales report.",
  "inputSchema": {"type": "object", "required": ["month"]},
  "outputSchema": {"type": "object", "required": ["report"]},
  "price": {"currency": "USD", "amount": 500, "unit": "invocation"},
  "delivery": {"protocol": "exora_gateway", "operationId": "generateSalesReport"},
  "availability": {"availableNow": true, "lastCheckedAt": "2026-07-13T08:00:00Z"},
  "sideEffect": "none",
  "version": 3
}
```

Manifest 必须提供稳定 ID、文本描述、输入输出、价格、交付协议、可用性、隐私、幂等与副作用信息。Agent 搜索、比较和购买以 Manifest 为准；人类界面只渲染同一事实。

### 4.2 PhysicalResource

PhysicalResource 描述一台不可分售的 Linux Host。序列号、管理地址和 Host 凭据不公开。

```json
{
  "schemaVersion": "exora.physical_resource.v3alpha1",
  "resourceId": "res_host_01",
  "providerDockId": "dock_provider_01",
  "kind": "compute_host",
  "host": {"os": "linux", "hypervisor": "kvm_libvirt"},
  "gpu": {"model": "NVIDIA H100", "uuid": "GPU-...", "memoryBytes": 85899345920},
  "physicalCapacity": {"cpuCores": 32, "memoryBytes": 137438953472, "diskBytes": 4000000000000},
  "controlReserve": {"cpuCores": 1, "memoryBytes": 4294967296, "diskBytes": 100000000000},
  "status": "verified",
  "version": 4
}
```

一个 PhysicalResource 在任何时间最多关联一个可售 InventorySlot。

### 4.3 EnvironmentImage

EnvironmentImage 是签名、不可原地修改的 Golden Image：

```json
{
  "schemaVersion": "exora.environment_image.v3alpha1",
  "imageId": "img_h100_cuda_01",
  "version": 4,
  "sha256": "...",
  "format": "qcow2",
  "os": "ubuntu-24.04",
  "cuda": "12.4",
  "frameworks": ["pytorch-2.5"],
  "allocatedBytes": 487214563328,
  "state": "verified",
  "lastBootVerifiedAt": "2026-07-12T10:00:00Z",
  "signature": "..."
}
```

更新环境必须创建新版本、校验哈希并启动测试 VM。活跃 Lease 始终锁定创建时的镜像版本。

### 4.4 InventorySlot

InventorySlot 是市场中唯一可租的计算库存：

```json
{
  "schemaVersion": "exora.inventory_slot.v3alpha1",
  "slotId": "slot_h100_01",
  "resourceId": "res_host_01",
  "environmentImageId": "img_h100_cuda_01:v4",
  "vm": {"mode": "one_to_one", "consumerPrivilege": "guest_root", "gpuAssignment": "pci_passthrough"},
  "guaranteedCapacity": {"cpuCores": 31, "memoryBytes": 133143986176, "gpuMemoryBytes": 85000000000},
  "diskReservation": {"poolId": "pool_nvme_01", "workspaceBytes": 1000000000000, "allocationPolicy": "thick_accounted"},
  "availability": {"state": "ready", "availableNow": true, "lastCheckedAt": "2026-07-12T10:05:00Z"},
  "version": 9
}
```

同一 PhysicalResource 不能出现第二个可售 Slot。一个 Slot 不能存在重叠的 CapacityHold 或 Lease。

### 4.5 CapacitySnapshot

Worker 对容量检测结果签名：

```json
{
  "schemaVersion": "exora.capacity_snapshot.v3alpha1",
  "snapshotId": "snap_01",
  "slotId": "slot_h100_01",
  "checkLevel": "full",
  "checkedAt": "2026-07-12T10:05:00Z",
  "available": {"memoryBytes": 134000000000, "gpuMemoryBytes": 85200000000, "diskReservationValid": true},
  "checks": {"gpuUuidMatch": true, "unknownGpuProcesses": 0, "cudaReady": true, "imageBootable": true},
  "eligible": true,
  "failureReasons": [],
  "sequence": 81,
  "signature": "..."
}
```

`checkLevel` 为 `light`、`full` 或 `lease_recheck`。Snapshot 只证明一个时点；创建 Lease 必须使用新的 `lease_recheck`。

### 4.6 CapacityHold

CapacityHold 在资金预留和实时复检期间排他锁定 Slot：

```json
{
  "schemaVersion": "exora.capacity_hold.v3alpha1",
  "holdId": "hold_01",
  "slotId": "slot_h100_01",
  "consumerAccountId": "acct_buyer",
  "state": "verified",
  "nonce": "random-cloud-challenge",
  "recheckSnapshotId": "snap_lease_01",
  "expiresAt": "2026-07-12T10:07:00Z",
  "version": 2
}
```

Hold 使用短 TTL。复检失败、资金预留失败或 TTL 到期时自动释放且不计费。

### 4.7 Listing、Lease 与 Capability

Listing 将 Resource 或 InventorySlot 包装为价格、限制、交付策略和许可证。价格变更只影响新 Lease；已创建 Lease 使用不可变 PriceSnapshot。

Lease 绑定 Consumer、Listing、Slot、EnvironmentImage 版本、最大预算、能力、epoch 和计费边界：

```json
{
  "schemaVersion": "exora.lease.v3alpha1",
  "leaseId": "lea_01",
  "listingId": "lst_h100_01",
  "slotId": "slot_h100_01",
  "environmentImageId": "img_h100_cuda_01:v4",
  "state": "active",
  "leaseEpoch": 1,
  "startsAt": "2026-07-12T10:08:00Z",
  "expiresAt": "2026-07-12T10:38:00Z",
  "billingStartedAt": "2026-07-12T10:08:12Z",
  "maxBudget": {"currency": "USD", "amount": 5000},
  "capabilities": ["guest_ssh", "run_command", "transfer", "artifacts"],
  "version": 5
}
```

Lease Capability Token 至少绑定 Lease、Consumer、Resource/Slot、允许动作、预算、Guest 工作区、epoch 和到期时间。Token 生命周期短于 Lease，并且不能调用 Host、libvirt、Golden Image、账本或 Payout 接口。

### 4.8 ComputePurchase

计算购买采用整段预购分钟：

```json
{
  "schemaVersion": "exora.compute_purchase.v3alpha1",
  "purchaseId": "cp_01",
  "leaseId": "lea_01",
  "durationMinutes": 30,
  "pricePerMinute": {"currency": "USD", "amount": 20},
  "prepaidAmount": {"currency": "USD", "amount": 600},
  "state": "active",
  "activatedAt": "2026-07-13T08:00:00Z",
  "expiresAt": "2026-07-13T08:30:00Z",
  "voluntaryReleaseRefundable": false,
  "providerFaultRefundMinutes": 0
}
```

`durationMinutes` 必须是正整数。CapacityHold 阶段预留全部金额；VM 与 Guest 验证通过后一次性结算。Consumer 主动提前释放不退未使用分钟；Provisioning 失败不扣款；Provider 或平台故障按 SLA 退还尚未消费的完整分钟。续租是新的整数分钟购买。

### 4.9 ProviderActivitySnapshot

```json
{
  "schemaVersion": "exora.provider_activity_snapshot.v3alpha1",
  "snapshotId": "act_01",
  "slotId": "slot_h100_01",
  "checkLevel": "light",
  "checkedAt": "2026-07-13T08:00:30Z",
  "providerGpuProcesses": 1,
  "availableGpuMemoryBytes": 12000000000,
  "availableMemoryBytes": 64000000000,
  "diskReservationValid": true,
  "availabilityState": "provider_busy",
  "pauseReasons": ["provider_gpu_process_detected"],
  "signature": "..."
}
```

Snapshot 将卖家自己的本地占用与 Exora Lease 进程区分开。只要本地任务导致保证容量不足，Listing 立即暂停，无需卖家手动操作。

### 4.10 AssetBundle、DownloadGrant 与 TransferSession

AssetBundle 将一个或多个文件、文本说明、许可证与固定 AssetVersion 打包成可按次购买的 `download` 商品。买家付款后获得不可转让的 DownloadGrant：

```json
{
  "schemaVersion": "exora.download_grant.v3alpha1",
  "downloadGrantId": "dg_01",
  "productId": "prd_dataset_01",
  "assetVersionId": "asset_sales_2026:v3",
  "consumerAccountId": "acct_buyer",
  "pricePaid": {"currency": "USD", "amount": 900},
  "issuedAt": "2026-07-13T08:00:00Z",
  "expiresAt": "2026-07-14T08:00:00Z",
  "state": "active",
  "urlReissueCount": 2,
  "rangeRequestsAllowed": true
}
```

卖家为每个 Download Listing 配置 1 小时至 30 天的授权期限。Grant 有效期内可重复签发短期 URL、断点续传并重新下载同一 AssetVersion，不重复收费。TransferSession 只保存短期 URL、Range、大小、SHA-256 和传输状态，不扩大 Grant 权限。

### 4.11 ApiOperationProduct 与 ApprovalRequest

每个获准 OpenAPI operation 被标准化为独立商品。现实副作用用结构化审批表达：

```json
{
  "schemaVersion": "exora.approval_request.v3alpha1",
  "approvalId": "apr_01",
  "productId": "prd_order_meal_01",
  "operationId": "placeMealOrder",
  "sideEffect": "external_action",
  "targetSummary": "Place one meal order with merchant M123",
  "parameterSummary": {"items": 2, "deliveryArea": "Pudong"},
  "capabilityFee": {"currency": "USD", "amount": 25},
  "externalPurchaseAmountManagedByExora": false,
  "cancellationPolicy": "Defined by target API",
  "state": "approval_required"
}
```

Exora 只展示和结算 `capabilityFee`。餐费、运费、商品价及其支付由目标 API 负责，不进入 Exora 账本。只有 Consumer 预先授权了明确 operation、商家范围和服务费预算时，`external_action` 才能免人工确认。

### 4.12 UsageRecord 与 ResetReceipt

UsageRecord 是 Provider Worker 或 Gateway 签名的不可修改计量事实。Cloud 以 `(source, leaseId, idempotencyKey)` 去重；修正通过新的正向或反向账目表达。

ResetReceipt 证明租约后的恢复结果：

```json
{
  "schemaVersion": "exora.reset_receipt.v3alpha1",
  "resetReceiptId": "reset_01",
  "leaseId": "lea_01",
  "slotId": "slot_h100_01",
  "encryptionKeyDestroyed": true,
  "writeLayerDeleted": true,
  "restrictedAssetsUnmounted": true,
  "vmRecreated": true,
  "verification": {"imageHashMatch": true, "oldUsersAbsent": true, "oldSshKeysAbsent": true, "gpuReady": true, "memoryReady": true, "diskReady": true, "networkReady": true},
  "state": "verified",
  "completedAt": "2026-07-12T10:40:00Z",
  "signature": "..."
}
```

ResetReceipt 缺失或任一关键项失败时，Slot 必须进入 `quarantined`。

## 5. 严格 1:1 计算协议

### 5.1 Host Control Domain

V3.2 Alpha 首发只规范 Linux KVM/libvirt。Host 运行 Worker、Hypervisor、网络控制、计量与镜像恢复，并保留最小 CPU、内存和磁盘。Consumer VM 通过 PCIe Passthrough 获得整张公开出售的 GPU，并获得其余保证 CPU、内存和工作盘。

Agent 拥有 Guest Root，可以安装软件、修改 Guest、运行任意被授权的工作负载和重启 Guest，但不能访问 Host Root、管理网络、libvirt socket、Worker 数据目录、Golden Image、其他凭据或宿主计量。任何把这些边界暴露给 Guest 的配置均不合规。

“独占整机”表示独占 Listing 声明的全部可售资源，不包括 Host Control Domain。Host 不能在活跃 Lease 期间运行未声明的 Provider 计算任务。

### 5.2 容量检测与自动上下架

Worker 每 30 秒执行轻量检查：

- 心跳、Worker 身份和唯一 Slot 关系；
- GPU UUID、健康、未知 GPU 进程与空闲显存；
- 可用内存、CPU 负载、磁盘预留与租约冲突；
- VM、Hypervisor 和管理网络状态。

Worker 每 5 分钟执行完整检查：

- 硬件、驱动、CUDA、IOMMU 与 PCIe Passthrough；
- Golden Image 哈希、环境文件和测试启动能力；
- 磁盘容量、IOPS、吞吐量和预留账本；
- 网络连通性与短时健康测试。

任一关键检查失败立即将 Slot 标为 `provider_busy`、`capacity_insufficient`、`unhealthy` 或 `offline`，并暂停 Listing。卖家启动本地 GPU 任务或使内存、显存低于保证值时使用 `provider_busy`，无需手动下架。占用消失后仍必须连续三次五分钟完整检查通过才能恢复，正常恢复时间约 15 分钟。Worker 也应监听 GPU 进程、内存压力、磁盘预留丢失、GPU Reset、驱动异常和关机事件并立即触发检查。

### 5.3 磁盘硬保证

`availableNow` 的计算 Listing 必须满足：

1. Golden Image 字节已完整存在并通过签名与启动验证；
2. 用户工作盘已经全额预留；
3. Host 系统盘、控制域和清理安全余量独立保留；
4. 底层即使使用快照或 Thin Provisioning，Exora 容量账本也按工作盘声明容量全额扣减。

强制不变量：

```text
system reserve
+ control reserve
+ image allocated bytes
+ published-slot disk reservations
+ active-lease disk allocations
+ cleanup-pending bytes
≤ physical allocatable bytes
```

基础镜像允许内容寻址去重，但不同 Slot 的工作盘保证不能重复计算。磁盘规格必须声明容量、介质、最低 IOPS、最低读写吞吐、临时/持久属性和 Reset 策略。

### 5.4 内存与显存保证

内存和显存不通过常驻占位进程吃满。它们由一机一 Slot 的独占账本、周期检查和租赁前满额复检保证。复检至少验证保证内存可分配、GPU UUID 正确、未知 GPU 进程为零、空闲显存达到声明值，并运行短时 CUDA 与内存测试。

检测值不足时不得创建 Lease。Provider 在活跃租约期间消耗保证资源属于 SLA 违约，并触发 `degraded`、停止续租、证据采集和退款评估。

### 5.5 CapacityHold 与激活

创建计算 Lease 的原子流程：

```text
ready
  → CapacityHold
  → funds reserved
  → lease_recheck
  → VM provisioned
  → Guest verification
  → active + billing starts
```

Cloud 先锁定 Slot，再要求 Worker 使用 Cloud nonce 实时复检。复检、资金预留、VM 启动或 Guest 验证任一步失败，都释放 Hold 与资金且不开始计费。同一 Slot 不能接受第二个 Hold。

### 5.6 Disposable VM Reset

每个 Lease 使用：

- 锁定版本的只读 Golden Image；
- 独立加密写入层和随机 Lease Disk Key；
- 临时 Guest 用户、SSH 身份和 Lease Capability；
- 可选只读挂载的 `environment_only` 资料。

释放状态机：

```text
active → draining → stopping → sanitizing → resetting → verifying → ready
                                      ↘ failure → quarantined
```

Worker 停止新动作、提供有限产物导出窗口、关闭 VM、撤销身份、卸载受限资料、销毁磁盘密钥、删除写入层、从 Golden Image 重建并启动 VM。随后验证镜像哈希、GPU、内存、磁盘、CUDA、网络以及旧用户、SSH Key、进程和文件均不存在。

清理脚本不能代替 Reset。任一步失败进入 `quarantined`，禁止新 Lease、暂停相关 Settlement 并保留证据。`draining` 之后停止计算计费；`stopping`、`sanitizing`、`resetting`、`verifying` 和 `cleaning` 不向 Consumer 计费。

## 6. 文件与资料商品协议

Provider 可以通过人类后台或 Dock/API 一次上传由一个或多个文件组成的 AssetBundle，并设置文字说明、固定 AssetVersion、许可证、SHA-256、单次下载价格和 1 小时至 30 天的 DownloadGrant 有效期。文件默认进入 Exora 管理的 S3 兼容对象存储。Provider 使用 multipart 与短期签名 URL 直接上传，Cloud 应用服务器和 MCP 不承载正文。完成时必须提交分片清单、总大小与 SHA-256，并通过 MIME、恶意文件、重复内容和许可证字段验证。替换文件创建新的不可变 AssetVersion。

Listing 可选择：

- `downloadable`：有效购买或 Lease 获得限制对象、账户、次数和期限的下载 URL；
- `environment_only`：只能只读挂载到关联 VM，不签发原始下载 URL；
- `downloadable_and_environment`：同时允许两种交付。

资料必须声明许可证、商用与衍生权限、归属、地域和退款条件。举报可以暂停新 Lease，但不能抹除历史账本和证据。

`download` 购买先完成扣款，再签发 DownloadGrant。Grant 有效期内可为同一 AssetVersion 重签短期 URL、使用 HTTP Range 断点续传并重新下载，不重复收费。Consumer 未下载、主动放弃或授权过期不退款；对象损坏、平台持续不可用或最终 SHA-256 不符属于交付故障并退款。

## 7. OpenAPI Operation 商品协议

API Provider 必须运行 Dock Provider Mode 并提供可验证的 OpenAPI 3.x。Dock 与 Cloud 验证 operationId、Schema、TLS、健康状态、请求/响应边界和确定性计量单位。没有 OpenAPI 的 API 不允许发布。

每个获准 operation 生成独立 ApiOperationProduct 与稳定 Capability。Manifest 包含自然语言说明、输入输出 JSON Schema、固定或计量价格、速率、超时、幂等性、隐私和副作用等级。一行数据、报表、查询结果、文件转换和订餐都只是 operation 的不同输出或副作用，不增加第四类商品。

Consumer Agent 只调用 Exora API Gateway；Gateway 验证 Lease、Schema、速率、预算和目标 operation，再注入 Provider 凭据。Agent 不获得源站秘密，默认禁止任意 URL、Header、私网重定向和未声明路径。

API 可以按请求、成功请求、输入/输出字节或可证明业务单位计价。Gateway 产生签名 UsageRecord；超大响应转为受控 Artifact。

`sideEffect: external_action` 默认返回 ApprovalRequest，并在执行前要求人类确认。只有明确的 operation、商家范围和 capability fee 预算已经预授权时才能自动调用。Exora 不展示、不托管也不结算餐费、运费或其他外部商品金额。

## 8. Listing、Lease 与状态机

Listing 状态：

```text
draft → validating → published → paused → removed
              ↘ rejected      ↘ suspended
```

计算 Slot 可用性：

```text
ready → provider_busy / capacity_insufficient / held / leased
provider_busy → three full checks passed → ready
leased → resetting → verifying → ready
                    ↘ quarantined
```

Lease 状态：

```text
requested → held → funded → provisioning → active → draining → releasing → closed
      ↘ rejected       ↘ failed        ↘ cancelled / disputed
```

搜索结果必须展示 `availableNow`、`lastCheckedAt`、最近失败原因、保证容量、Golden Image 版本与预计 Provisioning 时间。暂停和移除禁止新 Lease，但不删除历史 Lease、账本或证据。

Download 状态：

```text
draft → validating → published
purchase_paid → grant_active → expired / revoked
grant_active → transfer_active → verified
```

API 状态：

```text
imported → validating → normalized → published
invocation_requested → approval_required → authorized → executed
```

## 9. 计量、账本、退款与打款

文件按 DownloadGrant 购买计价；计算按整数分钟整段预购；API 按确定性 operation 调用单位计价。PriceSnapshot 在购买或 Lease 创建后不可修改。

平台使用复式、只追加账本：

```text
充值       外部资金 → Consumer 可用余额
预授权     Consumer 可用余额 → Consumer 预留余额
用量结算   Consumer 预留余额 → Provider 待结算 + 平台费用
释放       Consumer 预留余额 → Consumer 可用余额
退款       Provider 待结算/准备金 → Consumer 可用余额
打款       Provider 可打款余额 → 外部支付通道
```

计算购买金额等于 `durationMinutes × pricePerMinute`。CapacityHold 时预留整段金额，VM 和 Guest 验证成功进入 `active` 时一次性结算；到期时间按 active 时刻加预购分钟计算。Consumer 主动提前释放不退款，Reset、验证与清理不消耗分钟。Provisioning 失败不扣款；Provider 或平台故障按 SLA 退还未消费的完整分钟。续租必须在到期前购买新的整数分钟块。

DownloadGrant 在扣款后签发；有效期内的 URL 重签和断点续传不重复收费。ApiOperationProduct 只把 capability fee 写入 Exora 账本，外部购买金额不进入任何 Exora 账户。

收入先进入退款等待期，再成为可打款余额。退款、拒付和调整通过新的反向分录表达，不修改历史记录。

## 10. MCP 与接口

Consumer Agent 使用统一 `exora.` MCP 工具：

| 工具 | 作用 |
|---|---|
| `search_products` | 搜索 compute、download 与 api_operation |
| `get_product_manifest` | 读取权威文本、Schema、价格、交付与可用性 |
| `estimate_purchase` | 生成带期限的结构化购买估价 |
| `purchase_compute_minutes` | 创建 Hold 并预购整数分钟 |
| `extend_compute_minutes` | 在到期前购买新的分钟块 |
| `purchase_download` | 扣款并创建 DownloadGrant |
| `create_download_transfer` | 在 Grant 下签发短期 URL 或续传会话 |
| `invoke_operation` | 调用标准化 OpenAPI operation |
| `approve_operation` | 批准有现实副作用的 operation |
| `get_lease` | 查询状态、用量、到期与允许动作 |
| `release_lease` | 停止新动作并进入导出、Reset 与结算 |
| `run_command` / `get_execution` | 在 Guest 内执行并查询任务 |
| `stream_logs` / `get_artifacts` | 读取日志与产物 |
| `get_usage` | 查询用量、费用和剩余预算 |

工具结果不授予额外人类权限。高价 Lease、提价续租、敏感资料下载和高风险动作必须与 Consumer AutomationPolicy 求交集；需要批准时返回结构化 `approval_required`。

Cloud API 使用 `/v3/products`、`/v3/resources`、`/v3/inventory-slots`、`/v3/capacity-holds`、`/v3/compute-purchases`、`/v3/leases`、`/v3/asset-bundles`、`/v3/download-grants`、`/v3/transfers`、`/v3/api-operations`、`/v3/approvals`、`/v3/invocations`、`/v3/usage-records`、`/v3/reset-receipts`、`/v3/ledger`、`/v3/settlements` 与 `/v3/payouts`。

Worker 使用出站长连接或长轮询，不要求 Provider 开放管理端口。Typed 消息包括 `ResourceHeartbeat`、`CapacitySnapshot`、`CreateCapacityHold`、`ProvisionLease`、`RenewLeaseEpoch`、`CancelExecution`、`UsageBatch`、`ResetVM` 与 `ResetReceipt`。每条命令带 command ID、epoch、deadline 和签名，并持久化去重结果。

## 11. 数据平面

```text
小型控制数据       MCP / HTTPS JSON
大文件             S3 multipart + 短期签名 URL
工作区增量         Lease 内临时 SSH/SFTP/rsync
实时日志           有界 WebSocket/SSE 流
超大资料           environment_only 预挂载，不移动原始数据
```

Cloud 应用服务器不代理大文件正文。签名 URL 只能访问一个对象版本的一种动作，并受账户、Lease、大小、次数和过期时间限制。

## 12. 安全、隐私与争议

- Dock 私钥进入 OS 安全存储；Cloud 保存公钥和撤销状态。
- Provider Host SSH、libvirt 与 Golden Image 永不进入 Consumer Agent。
- Guest 不挂载 Host Docker socket、管理目录或特权设备；GPU 只通过声明的 PCIe Passthrough 交付。
- Provider API Secret 由 Gateway 密钥系统或 Provider Dock 注入。
- 托管文件静态和传输中加密；每个 VM Lease 使用独立磁盘密钥。
- 完整 Prompt、Agent 对话、文件正文和敏感 API 字段默认不写入 Cloud 事件。
- Gateway 防止 SSRF、Header 注入、未声明重定向、超大响应和凭据回显。

争议证据包括 Resource 检测、CapacitySnapshot、Hold、Lease、心跳、UsageRecord、Gateway 状态、Execution 摘要、Artifact 哈希、Transfer 完整性与 ResetReceipt。双方显式选择并脱敏补充证据。争议期间暂停 Settlement；裁决通过新账本调整表达。

## 13. 故障语义

- **Cloud 不可用**：不创建新 Lease；已有 Lease 只在已签发额度和期限内运行。
- **Worker 掉线**：立即停止 Listing 新租赁；活跃 Lease 进入 `degraded` 并停止续签 Capability。
- **容量不足或未知 GPU 进程**：立即暂停 Listing；连续三次完整检查通过才恢复。
- **卖家本地使用**：标记 `provider_busy` 并自动暂停，无需手动下架；占用消失后约 15 分钟自动恢复。
- **租赁前复检失败**：释放 Hold 与预算，不开始计费。
- **VM 启动或 Guest 验证失败**：Lease `failed`，Slot 进入检查或隔离状态。
- **Reset 失败**：Slot `quarantined`，禁止新租约并暂停结算审查。
- **重复消息**：Cloud 与 Worker 返回首次结果，不重复执行或计费。
- **对象存储失败**：Transfer 使用同一幂等键恢复，校验前不视为完成。

## 14. 端到端示例

### 14.1 卖家本地使用与自动恢复

```text
1. Provider 只安装 Dock 并启用 Provider Mode，Worker 自动检测 Host、镜像、磁盘和唯一 Slot。
2. Slot 检查通过后自动 published + ready，卖家无需维护在线开关。
3. 卖家在 Host 启动自己的 GPU 任务；下一次轻检发现未知 GPU 进程或保证显存不足。
4. Worker 立即设置 provider_busy 并暂停 Listing，不影响卖家本地任务。
5. 卖家任务结束；Worker 继续检测但不立即重新出售。
6. 连续三次五分钟完整检查通过后，Slot 自动恢复 ready，Listing 重新可购。
```

### 14.2 H100 分钟购买与 1:1 VM

```text
1. Provider Dock 检测 Linux Host、H100 UUID、KVM/libvirt、CUDA 与存储池。
2. Provider 创建签名 Golden Image；Worker 启动测试 VM 并验证环境。
3. Worker 为唯一 InventorySlot 硬预留工作盘；30 秒轻检和 5 分钟全检维持 availableNow。
4. Consumer Agent 搜索 H100，以每分钟价格预购 30 个整数分钟。
5. Cloud 创建排他 CapacityHold；Worker 使用 nonce 实时复检显存、内存、磁盘和 GPU 进程。
6. Cloud 预留全部 30 分钟金额；Worker 从 Golden Image 创建加密写入层、透传 GPU 并启动唯一 VM。
7. Guest 验证通过后 Lease 进入 active，整段金额结算且 30 分钟倒计时开始；Agent 获得 Guest Root。
8. Agent 上传代码、执行任务、读取日志并下载 Artifact。
9. Agent 可提前 release，但主动释放不退剩余分钟；Worker 撤销身份、销毁磁盘密钥和写入层并重建 VM。
10. ResetReceipt 验证通过后 Slot 返回 ready；失败则 quarantined。
```

### 14.3 限时文件下载授权

```text
1. Provider 将多个文件打包为 AssetBundle，填写文字摘要、许可证、固定版本和单次价格。
2. Provider 将 DownloadGrant 有效期设为 24 小时并发布。
3. Consumer Agent 搜索 Manifest、付款并取得不可转让的 DownloadGrant。
4. Agent 创建短期 TransferSession，使用 Range 下载并校验 SHA-256。
5. 网络中断后 Agent 在 24 小时内重签 URL 并续传，不重复收费。
6. Consumer 未下载或主动放弃不退款；对象损坏或校验失败按交付故障退款。
```

### 14.4 一行数据与报表 API

```text
1. Provider Dock 验证 OpenAPI、TLS、健康检查和 operationId。
2. Exora 将查询一行数据和生成报表分别标准化为 ApiOperationProduct。
3. Consumer Agent读取输入输出 Schema 与 capability fee，并调用 invoke_operation。
4. Gateway 校验 Schema、速率和预算，注入 Provider 凭据并转发。
5. 成功响应生成 UsageRecord；大响应成为短期 Artifact。
6. Lease 释放后退回未使用预算，收入进入 Provider 退款等待期。
```

### 14.5 带人工确认的订餐 API

```text
1. Provider 的 OpenAPI 包含 placeMealOrder，并标记 sideEffect: external_action。
2. Consumer Agent 构造订单后调用 invoke_operation。
3. Exora 返回 ApprovalRequest，展示商家、参数摘要、取消规则和 capability fee。
4. 人类确认后 Gateway 执行 operation；若已存在明确商家、operation 和费用预授权则可自动执行。
5. Exora 只结算 API capability fee；餐费、运费和外部支付由目标 API 负责。
```

## 15. V3.2 Alpha 承诺

V3.2 Alpha 规范：AI-first AgentProductManifest、必要的人类伴随界面、自动 `provider_busy` 上下架、约 15 分钟恢复、整数分钟预购、AssetBundle、限时 DownloadGrant、标准化 ApiOperationProduct、副作用 ApprovalRequest、严格一机一 Slot 一 VM、Golden Image Reset、OpenAPI Gateway、平台账本和 Provider Payout。

V3.2 Alpha 不承诺：多租户 VM、MIG 分售、裸 Host Root、Hyper-V/VMware、自由文本 API 推断、外部商品金额结算、去中心化存储、平台模型推理、通用聊天界面或自治争议裁决。

> Exora 不是给人类点击商品卡片的传统商城。它是 AI Agent 的结构化购买层：让任何人只需准备一台机器、一份资料或一个 OpenAPI，就能被 Agent 找到、购买、调用并直接产生收益。
