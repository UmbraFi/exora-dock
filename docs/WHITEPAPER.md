# Exora V3.2 AI-First 资源市场协议白皮书

**版本：V3.2 Alpha**<br>
**状态：已实现的 Alpha 协议，受 Technical Preview 边界约束**<br>
**定位：通过 MCP 连接的快速、便捷、Agent 优先资源交换市场**

> 将现有 Agent 通过 MCP 连接到 Exora，即可买卖计算环境、独立计价的资料文件、本地 Endpoint 与公网 API Bridge。Dock 将本地权限和 Endpoint 凭据留在受控边界内；资金、公开发布、审批与提现始终由人掌握。

## 1. 摘要

Exora V3.2 将准备完成的数字资源转换为 Agent 可搜索、可购买、可调用、也可协助创建出售草稿的标准商品。卖家可以通过 Exora Dock 出售经过验证的 KVM 或托管 WSL2 环境，把一个或多个本地文件作为独立计价的 ResourceItem 放入主题 Resource sheet，将私有本地服务接入为 Endpoint，或把公网 HTTPS 服务接入为 API Bridge。Exora Cloud 管理目录、购买、租约、API Order、用量、平衡账本与卖家收入；Dock 管理本地授权、Endpoint 凭据、运行时验证、文件传输、隧道和执行。

协议主线是：

```text
Product → Listing → Purchase / Lease / API Order → Delivery / Invocation → Settlement
```

市场公开四个一级业务分类：`vm`、`resources`、`endpoint` 与 `api_bridge`。顶层 `applicationSource` 决定商品职责；底层 `productKind` 只表示计费/执行模型：`compute` 预购整数分钟的 VM，`download` 购买固定 ResourceItem 版本的限时 DownloadGrant，`api_operation` 购买一次被声明的操作。所有商品都由统一 `AgentProductManifest` 描述。

计算产品继续采用严格 1:1 模型：一台物理机只对应一个 `InventorySlot` 和一台 Consumer VM。Worker 自动检测卖家本地占用，资源不足时无需卖家手动下架；空闲恢复后经过三次完整检查自动重新上架。Host 只保留 Exora 控制域；Consumer Agent 获得 VM 内 root。租约结束后从签名 Golden Image 恢复干净 VM。

Exora 不要求卖家提供 Agent，也不提供新的聊天入口。卖家可以选择让自己的 Agent 只在预先授权的本地资源中发现候选项并创建私有 Listing 草稿；卖家 Agent 不能读取任意路径、返回秘密、推断商业条款或公开发布。MCP/API 是权威市场入口；图形化内容只是可选的人类辅助，不能成为 Agent 理解商品所必需的信息。Electron 伴随程序提供 Listings、VM、Resources、Endpoint、API Bridge、审批、账单与提现工作区。

### 1.1 当前实现概况

Dock 守护进程、Electron 应用与 Cloud 仓库已经实现 V3 市场主路径。公开协议仍处于 Alpha，因此本文明确区分当前行为与更严格的目标保证：

| 范围 | 当前实现 | Alpha 边界 |
|---|---|---|
| 买家 MCP | 搜索、Manifest、估价、购买/续租计算、资料授权/续传、operation 调用、Lease、用量与释放 | 用户继续使用自己的 MCP Agent；Dock 不是聊天 Agent |
| 卖家 MCP | 针对 VM、Resources、Endpoint、API Bridge 的授权发现与持久化私有草稿 | 只能创建草稿；公开发布、卖家声明、凭据和未保存的商业决策仍由人控制 |
| 计算 | Linux KVM 与 Windows `managed_wsl2_shared_host`；每台 Host 同时只有一个活跃 Lease | KVM 是硬件隔离路径；WSL2 必须披露共享 Host 隔离，不能声称 GPU 独占直通 |
| Resources | 主题资源单、逐文件定价与说明、SHA-256 校验、逐文件付费限时 DownloadGrant | 单文件上限 1 GiB，账户默认总空间 5 GiB；目录由卖家自行压缩 |
| Endpoint / API Bridge | 授权私有或 loopback 服务走 `dock_tunnel`；授权公网 HTTPS 服务走 Cloud `cloud_direct` Gateway | OpenAPI 3.1 是权威接口；每条 Operation、Policy 与价格都必须复核 |
| 计费 | 统一 reserve、capture、release、refund，平衡分录，卖家收入冻结 24 小时，以及配置后可用的原生 USDC 充提 | 托管与提现就绪依赖生产级 Postgres、SMTP、Solana 与 KMS 配置 |

当前桌面版为 `0.1.0-preview.2`，面向 Windows x64、macOS ARM64 与 Linux x64，仍属于 Technical Preview 而非生产发行版。Windows 尚未做 Authenticode 签名，macOS 使用 ad-hoc 签名且未公证，Linux 依赖签名发布索引；用户必须校验发布的 SHA-256，并应预期对应的平台安全提示。

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
- 支持 Hyper-V 或 VMware，或把托管 WSL2 描述成与 KVM 等价的硬件隔离；
- 将大文件正文放入 MCP 消息；
- 推断没有 OpenAPI 的 API 业务语义；
- 把订餐等现实履约定义为新的一级业务分类，或结算餐费、运费等外部购买金额；
- 向 Consumer 或 Agent 暴露 Host Root、libvirt socket、Provider SSH、支付凭据或平台 Owner Token；
- 把清理脚本视为 Golden Image Reset 的等价证明；
- 声称 Alpha 或本地配置的部署已经获得生产可用性、资金托管或安全认证。

## 3. 参与者与权威边界

### 3.1 Consumer 与 Consumer Agent

Consumer 是购买资源的人类账户，拥有预算、付款方式、Lease、DownloadGrant、API Order、结果文件与授权策略。Consumer Agent 是用户自带的 MCP 客户端，可以搜索、估价、购买、调用并在有效 Capability 内执行动作，但不能扩大自身权限、修改历史计量或代表人类裁决争议。

### 3.2 Provider

Provider 上传资料、连接物理计算机，或发布 Endpoint/API Bridge，并对可用性、描述、价格、许可证、Operations、凭据和合法性负责。Provider 可以完全通过 Electron 伴随程序操作，也可以授权自己的 Agent 准备私有草稿。公开发布必须由 Provider 在 Listings 工作区执行；草稿或自动验证失败的资源永远不会进入公开目录。支付渠道要求时，首次打款前必须完成身份与收款账户验证。

### 3.3 Exora Dock

同一 Dock 程序支持三种可同时启用的能力：

- **Consumer MCP**：向本地 Agent 暴露 Exora 工具并执行本地预算与审批策略。
- **Seller Draft MCP**：针对授权目录、已注册服务和已验证 VM 运行时，提供受策略约束且只能创建草稿的工具。
- **Provider Worker**：运行在 Consumer 环境之外，验证 Linux KVM 或 Windows 托管 WSL2 容量，维护唯一 InventorySlot、执行租约、采集计量并恢复环境。

Dock 设备密钥保存在操作系统安全存储中。Worker 永远运行在它所创建和销毁的 Consumer VM 之外。

### 3.4 Exora Cloud

Cloud 是账户、Resource、Listing、InventorySlot 投影、Lease、UsageRecord、平台平衡账本与 Settlement 的权威。Cloud 负责目录搜索、CapacityHold、排他租赁、短期 Capability、对象存储授权、API Gateway、退款、卖家 24 小时收入冻结，以及配置后可用的原生 USDC 充值与 Solana 提现。

### 3.5 权威边界

```text
Cloud          目录、租约、预算、用量归并、账本与结算
Provider Worker 物理硬件、实时容量、VM 生命周期、执行与 Reset 事实
Runtime        KVM 设备隔离，或已披露的托管 WSL2 共享 Host 边界
Object Store   托管文件字节与对象版本
API Gateway    API 请求、响应状态、字节数和调用计量
Payment Rail   充值、提现、拒付和外部资金移动
Human          发布、预算、敏感授权、证据披露和争议决定
```

## 4. 公共协议对象

所有公共对象使用不可变 ID、RFC 3339 UTC 时间与显式 `schemaVersion`。业务写入必须携带 8–128 字符的 `idempotencyKey`；更新投影时还必须携带 `expectedVersion`。金额使用 ISO 4217 货币与整数最小货币单位，禁止浮点金额。

HTTP 主版本保持 `/v3`；Schema 使用 `exora.<object>.v3alpha1`。V3 尚未稳定，因此文档升级为 V3.2 不改变 Alpha Schema 主版本。

### 4.1 AgentProductManifest

`AgentProductManifest` 是 AI 市场的权威商品描述；`V3Product.applicationSource` 是权威业务分类，只允许 `vm`、`resources`、`endpoint`、`api_bridge`。Manifest 内同名字段暂时作为兼容镜像，Listing 只能从 Product 派生分类且不可修改。`productKind` 仅允许 `compute`、`download`、`api_operation`。缺失、未知或矛盾的映射返回 `application_contract_mismatch`，不得猜测或回退到 API Bridge。自然语言说明用于检索和解释，JSON Schema、价格、限制和错误语义用于确定性调用。

```json
{
  "schemaVersion": "exora.agent_product_manifest.v3alpha1",
  "productId": "prd_01",
  "applicationSource": "api_bridge",
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
  "capabilities": ["guest_isolation_v1", "lease_terminal_v1", "lease_transfer_webrtc_v1"],
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
  "priceSnapshot": {"model": "compute_time_v2", "currency": "USDC", "unit": "minute", "amountAtomicPerMinute": 29000, "baseFeeAtomic": 500000, "longDurationDiscount": {"everyMinutes": 60, "additionalBpsOff": 500, "minimumRateBps": 5000}},
  "limitsSnapshot": {"minMinutes": 10, "maxMinutes": 240},
  "amountAtomic": 1370000,
  "state": "active",
  "activatedAt": "2026-07-13T08:00:00Z",
  "expiresAt": "2026-07-13T08:30:00Z",
  "voluntaryReleaseRefundable": false,
  "providerFaultRefundMinutes": 0
}
```

初购 `durationMinutes` 必须是 Listing 最短与最长租期之间的正整数。启动费只在首次创建 Lease 时收取；每完成一个折扣区间，只降低后续分钟费。计算全程使用 USDC atomic 与 basis points，所有分段求和后统一四舍五入一次。续租最少 1 分钟，折扣从 Lease 累计购买分钟继续计算，并且累计时长不得超过创建时快照中的最长租期。CapacityHold 阶段预留全部报价；VM 与 Guest 验证通过后一次性结算。Consumer 主动提前释放不退未使用分钟；Provisioning 失败退还启动费与分钟费；Provider 或平台故障按 SLA 退还尚未消费的完整分钟。

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

### 4.10 ResourceSheet、ResourceItem、DownloadGrant 与 TransferSession

ResourceSheet 是主题容器，本身不授予整包下载权。它包含一个或多个独立 ResourceItem；每个普通文件都有自己的标题、说明、许可证、固定版本、价格与 Grant 时长，并且必须独立购买。买家付款后获得只绑定一个 ResourceItem 的不可转让 DownloadGrant：

```json
{
  "grantId": "dgr_01",
  "listingId": "lst_dataset_01",
  "productId": "prd_dataset_01",
  "resourceItemId": "rit_sales_2026_01",
  "buyerAccountId": "acct_buyer",
  "status": "active",
  "amountAtomic": 900000,
  "resourceItemVersion": 3,
  "priceSnapshot": {"currency": "USDC", "unit": "download", "amountAtomic": 900000},
  "grantHoursSnapshot": 24,
  "createdAt": "2026-07-13T08:00:00Z",
  "expiresAt": "2026-07-14T08:00:00Z",
  "sha256": "..."
}
```

卖家为每个 ResourceItem 配置 1 小时至 30 天的授权期限。Grant 有效期内可重复签发短期 URL、断点续传并重新下载购买时锁定的同一 ResourceItem 版本，不重复收费。TransferSession 只保存短期 URL、Range、大小、SHA-256 和传输状态，不扩大 Grant 权限。平台不接收目录；若卖家要把目录作为一个商品，必须先自行压缩，并把压缩包作为一个普通 ResourceItem 上传。

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
  "vmRecreated": true,
  "verification": {"imageHashMatch": true, "oldUsersAbsent": true, "oldSshKeysAbsent": true, "gpuReady": true, "memoryReady": true, "diskReady": true, "networkReady": true},
  "state": "verified",
  "completedAt": "2026-07-12T10:40:00Z",
  "signature": "..."
}
```

ResetReceipt 缺失或任一关键项失败时，Slot 必须进入 `quarantined`。

## 5. 严格 1:1 计算协议

### 5.1 Runtime 与 Host Control Domain

硬件隔离方案使用 Linux KVM/libvirt。Host 运行 Worker、Hypervisor、网络控制、计量与镜像恢复，并保留最小 CPU、内存和磁盘。Consumer VM 通过 PCIe Passthrough 获得整张公开出售的 GPU，并获得其余保证 CPU、内存和工作盘。

Windows Technical Preview 使用 `managed_wsl2_shared_host`。Dock 验证签名的托管 Linux 环境，强制每台 Host 只有一个活跃 Lease，由宿主 Hyper-V 防火墙阻断 WSL 入站、出站与回环网络，并通过宿主侧 stdio 执行 Exora 控制通道。Manifest 与 Lease 必须披露：CPU/内存是配置上限，GPU 使用 Windows Host 驱动，并且不存在硬件直通独占。买家可以拒绝这种隔离等级。

Agent 拥有 Guest Root；该权限仅位于租赁 Linux 环境内。Agent 可以安装软件、修改 Guest、运行被授权的工作负载和重启 Guest，但不能访问 Host Root、管理网络、libvirt 控制、Worker 数据目录、Golden Image、其他凭据或宿主计量。任何把这些边界暴露给 Guest 的配置均不合规。

“独占 Host”表示同时只有一个 Exora Lease，并独占 Listing 声明的全部可售资源，不包括 Host Control Domain。Host 不能在活跃 Lease 期间运行未声明的 Provider 计算任务。

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
- 临时 Guest 控制身份和 Lease Capability。

释放状态机：

```text
active → draining → stopping → sanitizing → resetting → verifying → ready
                                      ↘ failure → quarantined
```

Worker 停止新动作、提供有限直传产物导出窗口、关闭 VM、撤销身份、销毁磁盘密钥、删除写入层、从 Golden Image 重建并启动 VM。随后验证镜像哈希、GPU、内存、磁盘、CUDA、隔离策略以及旧用户、控制身份、进程和文件均不存在。

清理脚本不能代替 Reset。任一步失败进入 `quarantined`，禁止新 Lease、暂停相关 Settlement 并保留证据。`draining` 之后停止计算计费；`stopping`、`sanitizing`、`resetting`、`verifying` 和 `cleaning` 不向 Consumer 计费。

## 6. 文件与资料商品协议

Provider 通过 Resources 工作区或已授权的卖家草稿 MCP 创建一个主题 Resource sheet，并选择一个或多个本地文件。每个文件都是独立 ResourceItem，必须分别填写标题、说明、价格、许可证和 1 小时至 30 天的 DownloadGrant 有效期；购买与授权也只针对一个文件。平台接受任意常规文件格式但不接收目录，若要把程序目录或整套内容作为一个商品，卖家必须自行压缩后上传该压缩包。单文件上限 1 GiB，每个账户默认硬配额 5 GiB。Provider 使用 multipart 与短期签名 URL 直接上传，Cloud 应用服务器和 MCP 不承载正文；完成时逐文件校验大小与 SHA-256。文件内容不可原位替换，新内容必须创建新 ResourceItem；已购买授权保留购买时的条款快照。

Resources Listing 的交付固定为 `downloadable`：有效购买获得限制对象、账户、次数和期限的 DownloadGrant。Resources 不关联 VM 或 Lease，不挂载计算环境，也不会自动接收 VM 的代码或运行结果。旧 `environment_only` 与 `downloadable_and_environment` Listing 会暂停并要求卖家重新确认，系统不会自动扩大下载权限。

资料必须声明许可证、商用与衍生权限、归属、地域和退款条件。举报可以暂停新的 ResourceItem 购买，但不能抹除历史账本、既有 Grant 或证据。

`download` 购买先完成扣款，再签发 DownloadGrant。Grant 有效期内可为购买时锁定的同一 ResourceItem 版本重签短期 URL、使用 HTTP Range 断点续传并重新下载，不重复收费。Consumer 未下载、主动放弃或授权过期不退款；对象损坏、平台持续不可用或最终 SHA-256 不符属于交付故障并退款。

## 7. Endpoint 与 API Bridge Operation 协议

Endpoint 与 API Bridge 共享唯一权威的 `ExoraServiceManifest v1`，并嵌套在 `AgentProductManifest.serviceManifest` 中。它只包含规范化 OpenAPI 3.1 `interface`、锁定的 `delivery`、严格一一对应的 `operationPolicies` 和 USDC `pricingTemplate`。

- **Endpoint**：`delivery` 固定为 `dock_tunnel`。本地目标与凭据只进入 Dock 私有 Runtime；Dock 离线或不健康时服务不可用。
- **API Bridge**：`delivery` 固定为 `cloud_direct`。公网 HTTPS 目标与加密凭据只进入 Cloud 私有 Runtime；发布后的调用不依赖 Dock 在线。

公开产品接口只支持 HTTP/JSON 请求响应与 HTTP SSE 服务端流。OpenAI 兼容路径只是普通 OpenAPI Operation。gRPC、Webhook/Callback、公开 WebSocket、GraphQL、SOAP、JSON-RPC、OData、消息协议、WebRTC、原始 TCP/UDP 与 FTP 都不是产品接口。Cloud–Dock 私有隧道内部可以使用 WebSocket 或二进制帧，但只能承载已声明的 HTTP/JSON 与 SSE Operation。

Agent 默认负责审核或把卖家材料规范化为 OpenAPI 3.1，不得臆造或静默改变 Method、Path 与 Schema 语义。确定性校验器负责 Canonical JSON 和 SHA-256，拒绝外部引用、Multipart/二进制正文、Callback、Webhook、真实 Server URL 与未声明响应，并要求每个唯一 `operationId` 恰好对应一条 Policy。只有记录 Agent 不可用或失败后，才开放带审计记录的人工兜底。

卖家必须审核接口、每条 Operation Policy、副作用、幂等性、限制、计量能力与价格。运行目标、Secret、Credential Ref、健康状态和 Endpoint ID 永不进入公开 Manifest。发布时价格会展开为不可变的逐 Operation 快照，所有 Invocation 只按该快照计费。

## 8. Listing、Lease 与状态机

Listing 状态：

```text
draft → validating → published → paused → removed
              ↘ rejected      ↘ suspended
```

Electron 与 Seller Draft MCP 首先创建私有 `draft`。只有人类卖家复核技术信息、明确商业参数、凭据/声明，并在 Listings 中执行发布动作后，商品才会进入公开目录。任何卖家 Agent 工具都不能执行 `publish`、`pause` 或 `retire`。

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
draft/imported → validating → normalized → seller_review → published
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

对 `compute_time_v2`，初购金额为 `baseFeeAtomic + round(sum(segmentMinutes × amountAtomicPerMinute × segmentRateBps) / 10000)`。第一段使用 10,000 bps；每完成一个区间，只降低后续分钟的费率，直到 `minimumRateBps`。续租不再收启动费，并从 Lease 累计购买分钟处继续同一套边际分段计算。Lease 创建时会同时保存价格与租期限制快照，因此卖家之后修改 Listing 只影响新 Lease。CapacityHold 时预留整段报价，VM 和 Guest 验证成功进入 `active` 时一次性结算；到期时间按 active 时刻加预购分钟计算。Consumer 主动提前释放不退款，Reset、验证与清理不消耗分钟。Provisioning 失败全额退款；Provider 或平台故障按 SLA 退还未消费的完整分钟。

DownloadGrant 在扣款后签发；有效期内的 URL 重签和断点续传不重复收费。ApiOperationProduct 只把 capability fee 写入 Exora 账本，外部购买金额不进入任何 Exora 账户。

当前 Alpha 计费引擎让 VM、Resources、Endpoint 与 API Bridge 共享 reserve、capture、release、refund 分录；每一组 Journal 必须平衡为零。商品完成后，卖家收入保持 pending 24 小时。市场佣金从卖家收入中扣除，而不是加在买家看到的价格上。退款、拒付和调整通过新的反向分录表达，不修改历史记录。

只有 Cloud 已配置托管密钥、RPC、价格源、SMTP 验证与 KMS 包装密钥时，原生 USDC 充值地址和 Solana 提现才可用。本地开发密钥回退与内存持久化不属于生产资金托管。

## 10. MCP 与接口

当前市场实现向 Consumer Agent 暴露以下 `exora.` MCP 工具：

| 工具 | 作用 |
|---|---|
| `search_products` | 按 `vm`、`resources`、`endpoint`、`api_bridge` 搜索公开商品 |
| `get_product_manifest` | 读取权威文本、Schema、价格、交付与可用性 |
| `estimate_purchase` | 生成带期限的结构化购买估价 |
| `purchase_compute_minutes` | 创建 Hold 并预购整数分钟 |
| `estimate_compute_extension` | 按 Lease 累计时长与价格快照估算续租分钟 |
| `extend_compute_minutes` | 在到期前购买新的分钟块 |
| `purchase_download` | 扣款并创建 DownloadGrant |
| `create_download_transfer` | 在 Grant 下签发短期 URL 或续传会话 |
| `invoke_operation` | 调用标准化 OpenAPI operation |
| `run_compute_command` / `read_compute_command_output` | 通过 Exora 控制通道执行命令并读取最长保留 15 分钟的临时输出 |
| `transfer_compute_file` / `get_compute_transfer` | 在两端 Dock 之间启动并查询 `/workspace` WebRTC 文件直传 |
| `get_lease` | 查询状态、用量、到期与允许动作 |
| `release_lease` | 停止新动作并进入导出、Reset 与结算 |
| `get_usage` | 查询用量、费用和剩余预算 |

计算任务通过 Lease 披露的 Exora 终端与 WebRTC 文件能力执行。MCP 提供 `run_compute_command`、临时输出读取、文件直传与传输状态，不虚构 SSH 或端口转发能力。财务动作的审批仍由账户的人类会话决定；普通 Lease 命令与文件不需要逐次卖家批准。

每次 MCP 初始化都会签发不同的 `sk-exora-session-...`，该密钥只被本机 Dock 接受。初始化响应同时返回本地 HTTP 入口、Session ID、权限和过期时间。Dock 删除会话 Authorization 与受保护 Metadata，再注入仅存在内存中的账户 `sk-exora-...` 转发到 Cloud。当 Owner 启用 `seller.draft` 会话权限后，同一个 MCP 连接还可以暴露只能创建草稿的工具：

| 工具 | 用途与权限边界 |
|---|---|
| `get_seller_draft_capabilities` | 读取已启用类型、授权目录/服务、安全默认值、Host 支持和凭据元数据；永不返回秘密 |
| `discover_sellable_resources` | 只为授权文件、已注册服务和已验证运行时返回短期 candidate ID |
| `read_seller_material` | 从授权文本候选项读取最大 256 KiB 的有界分块 |
| `create_vm_listing_draft` | 验证 WSL2/KVM、预留容量 24 小时并创建私有 compute 草稿 |
| `create_resource_listing_draft` | 逐文件重新验证、上传、校验 SHA-256，并按独立说明、价格和许可证创建私有 Resource sheet 草稿 |
| `save_endpoint_draft` | 保存经过 Agent 规范化的 `dock_tunnel` OpenAPI 3.1 私有服务草稿；不得包含 Runtime 或凭据 |
| `save_api_bridge_draft` | 保存经过 Agent 规范化的 `cloud_direct` OpenAPI 3.1 私有服务草稿；不得包含 Runtime 或凭据 |
| `get_seller_draft_run` / `list_my_listing_drafts` | 读取持久化进度与可供人发布的私有结果 |
| `resume_seller_draft_run` / `cancel_seller_draft_run` | 使用卖家提供的值继续，或协作清理未完成运行 |

卖家发现不接受 Agent 提供的任意文件系统路径。Candidate ID 会过期，资料读取有界，`mcpConnectionId` 来源由 Dock 赋值，明文凭据永不返回，商业参数必须明确提供而不能推断。公开 Listing 操作始终不可用。

工具结果不授予额外人类权限。高价 Lease、提价续租、敏感资料下载和高风险动作必须与 Consumer AutomationPolicy 求交集；需要批准时返回结构化 `approval_required`。

已实现的 Cloud API 包括公开目录 `/v3/catalog/products`、`/v3/catalog/listings` 与 `/v3/catalog/resource-items`；买家路径 `/v3/purchase-estimates`、`/v3/compute-purchases`、`/v3/compute-purchases/{id}/extension-estimates`、`/v3/download-grants`、`/v3/invocations`、`/v3/leases`、`/v3/approvals` 与 `/v3/ledger`；卖家路径 `/v3/provider/products`、`/v3/provider/listings`、`/v3/provider/resource-sheets`、`/v3/provider/resource-items`、`/v3/provider/service-drafts` 与 `/v3/provider/tunnels/connect`；以及 `/v3/billing/balance`、`/v3/billing/ledger`、充值地址、充值、提现报价、提现验证和提现路径。

Worker 使用出站长连接或长轮询，不要求 Provider 开放管理端口。Typed 消息包括 `ResourceHeartbeat`、`CapacitySnapshot`、`CreateCapacityHold`、`ProvisionLease`、`RenewLeaseEpoch`、`CancelExecution`、`UsageBatch`、`ResetVM` 与 `ResetReceipt`。每条命令带 command ID、epoch、deadline 和签名，并持久化去重结果。

## 11. 数据平面

```text
小型控制数据       MCP / HTTPS JSON
大文件             S3 multipart + 短期签名 URL
工作区文件         Dock 间 WebRTC DataChannel；Guest 保持离线
实时日志           有界事件流
Resources 资料     独立 S3 对象版本 + DownloadGrant
```

Cloud 应用服务器不代理大文件正文。签名 URL 只能访问一个对象版本的一种动作，并受账户、Lease、大小、次数和过期时间限制。

## 12. 安全、隐私与争议

- Dock 私钥进入 OS 安全存储；Cloud 保存公钥和撤销状态。
- Provider Host 控制身份、libvirt 与 Golden Image 永不进入 Consumer Agent；公开 SSH、SFTP、SCP、rsync、端口转发和 Host 端口均不是 Lease 能力。
- Guest 不挂载 Host Docker socket、管理目录或特权设备；GPU 只通过声明的 PCIe Passthrough 交付。
- Endpoint Secret 仅由 Provider Dock 注入；API Bridge Secret 由 Cloud Gateway 加密存储并注入。
- 卖家 MCP 只能引用保存在本地的 credential alias，不能获取明文凭据，也不能把秘密写入草稿。
- 托管文件静态和传输中加密；每个 VM Lease 使用独立磁盘密钥。
- 完整 Prompt、Agent 对话、文件正文和敏感 API 字段默认不写入 Cloud 事件。
- Gateway 防止 SSRF、Header 注入、未声明重定向、超大响应和凭据回显。
- `managed_wsl2_shared_host` 必须披露为隔离较弱的 Preview 等级，不能描述为等同 KVM 的 GPU 硬件直通。

争议证据包括 ResourceItem 上传与校验记录、CapacitySnapshot、Hold、Lease、心跳、UsageRecord、Gateway 状态、Execution 摘要、Compute Transfer 最终哈希、Download Transfer 完整性与 ResetReceipt。双方显式选择并脱敏补充证据。争议期间暂停 Settlement；裁决通过新账本调整表达。

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
- **卖家草稿中断**：持久化进度进入 `needs_input`、`failed` 或 `cancelled`；重试使用乐观并发和相同幂等键，且不会创建公开 Listing。

## 14. 端到端示例

### 14.1 卖家 Agent 创建私有 Listing 草稿

```text
1. 卖家启用卖家自动化，选择允许的资源目录/服务，保存商业默认值，启用 `seller.draft` 会话权限，并通过 MCP 初始化自己的 Agent。
2. Agent 读取能力，只能在该策略内发现短期 candidate ID。
3. Agent 可以读取有界的授权文本资料，但不能读取任意路径或明文凭据。
4. Agent 使用明确商业参数启动 VM、Resources、Endpoint 或 API Bridge 草稿运行。
5. Dock 重新验证候选项，完成对应类型的上传、探测或容量预留，并保存持久化私有 Listing 草稿。
6. 若缺少输入，运行停在 needs_input，并使用带版本校验的卖家值继续。
7. 卖家在 Electron Listings 中复核结果并明确发布；Agent 不能执行最后一步。
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
8. Agent 通过 Dock 间 WebRTC 将代码上传到 `/workspace`，通过 Exora 控制通道执行任务和读取日志，再把结果文件直传回本机。
9. Agent 可提前 release，但主动释放不退剩余分钟；Worker 撤销身份、销毁磁盘密钥和写入层并重建 VM。
10. ResetReceipt 验证通过后 Slot 返回 ready；失败则 quarantined。
```

如果卖家使用 Windows Preview，同一购买流程会使用一个托管 WSL2 环境，并强制每台 Host 只有一个活跃 Lease。买家通过 Exora 获得 root 控制权，宿主 Hyper-V 策略阻断 Guest 网络；Manifest 同时披露 CPU/内存配置上限、共享 Windows GPU 驱动访问，以及不存在硬件直通独占。释放时删除租约身份与托管环境状态，从所选签名环境重建并产生 ResetReceipt。

### 14.3 限时文件下载授权

```text
1. Provider 创建 Resource sheet，并为每个普通文件独立填写标题、说明、许可证、固定版本、价格和 Grant 时长；目录必须由卖家先压缩。
2. Provider 将目标 ResourceItem 的 DownloadGrant 有效期设为 24 小时并发布。
3. Consumer Agent 搜索 Manifest，选择一个 ResourceItem，付款并取得只绑定该文件版本的不可转让 DownloadGrant。
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
5. JSON 或 SSE 响应直接返回，并按 Gateway 可观察或卖家声明的计量维度生成 UsageRecord。
6. 调用完成后退回未使用预留额，收入进入 Provider 退款等待期。
```

### 14.5 带人工确认的订餐 API

```text
1. Provider 的 OpenAPI 包含 placeMealOrder，并标记 sideEffect: external_action。
2. Consumer Agent 构造订单后调用 invoke_operation。
3. Exora 返回 ApprovalRequest，展示商家、参数摘要、取消规则和 capability fee。
4. 人类确认后 Gateway 执行 operation；若已存在明确商家、operation 和费用预授权则可自动执行。
5. Exora 只结算 API capability fee；餐费、运费和外部支付由目标 API 负责。
```

## 15. 隔离 VM 控制与文件直传

新的计算 Lease 使用 `isolated_control_p2p_v1`。买家在 Guest 内拥有 root 或 Administrator 权限；网络边界由卖家宿主机强制执行，Guest 无法修改。KVM Guest 不连接可路由虚拟网卡，只通过宿主专用 Guest 通道与 Worker 通信；托管 WSL2 由宿主 Hyper-V 防火墙阻断入站、出站与回环网络。公开 SSH、SFTP、SCP、端口转发和卖家宿主端口都不是 Lease 能力。

命令与终端输出通过经过 Lease 鉴权的 Exora 控制面传递，终端正文不写入业务历史。每个买家账户每个 UTC 日前 100 MiB 全速，之后的终端字节共享 256 KiB/s 限速。由于任意终端文本仍可编码字节，Exora 不宣称 Cloud 绝不可能经过具有文件形态的终端数据。

官方 VM 文件全部通过 Consumer Dock 与 Provider Dock 之间的 WebRTC DTLS DataChannel 直传。Cloud 只转发短期 signaling，拒绝 relay ICE candidate，不提供 TURN 或文件中继。两端 Dock 自动验证活动 Lease，并签署本地审阅回执和最终哈希回执，不需要逐文件卖家确认。VM 文件入口和出口仅限 `/workspace`，采用临时文件、原子替换、大小校验与 SHA-256 校验。Cloud 只保存双方、方向、字节数、状态、签名与最终 SHA-256，不保存文件名、本地路径、VM 路径、SDP、ICE 或文件正文。

计算价格使用 `compute_time_v2`：首次启动费加边际阶梯分钟费。第一段按原价，后续折扣只影响未来分钟；续租从累计购买分钟继续计算，并始终使用 Lease 创建时保存的价格和租期快照。

### 15.1 双探针与持续高性能策略

每个新计算 Listing 固定声明 `dual_probe_v1`。Host Enforcement Probe 每 30 秒只采集 Lease 级 CPU、GPU、内存、工作盘与宿主争用聚合指标，不读取进程名、命令、文件、网络正文或算法类型。Guest Experience Probe 在 Provisioning 阶段运行三次两秒以内的固定挑战并取中位基线，Active 阶段每五分钟复测；挑战负载从买家利用率窗口中排除。Guest Agent 不可用只标记 `guest_probe_unavailable`，不会独立处罚任何一方。

卖家交付不足必须同时出现 Guest `deliveryBps < 8500` 与 Host 资源分配、steal time、异常降频、宿主争用或热/功耗节流证据，并连续三个五分钟窗口成立。确认后 Listing 进入 `performance_degraded`，活动 Lease 保持运行；受影响的完整分钟按 Lease 创建时的边际价格快照退款，不退启动费。两个合格窗口结束事件，三个合格窗口后 Listing 自动恢复。

Listing 默认允许持续使用已购买算力，并固定声明禁止加密货币挖矿。该禁令是合同条款，探针不识别挖矿或任务语义。若卖家选择 `burst_only`，CPU 或 GPU 的十五分钟滚动平均达到 80% 后先警告并提供五分钟宽限；Linux/KVM 随后将承诺性能限制到 50%，滚动负载低于 60% 并持续十分钟后自动解除。Windows/WSL2 首版只记录同样事件，并明确展示 `monitor_only_preview`，不宣称具备硬限速。

## 16. V3.2 Alpha 承诺

V3.2 Alpha 已实现：AI-first AgentProductManifest、自带 Agent 的买家 MCP、可选且只能创建草稿的卖家 MCP、Electron Listings/VM/Resources/Endpoint/API Bridge 工作区、自动 `provider_busy` 上下架、约 15 分钟恢复、整数分钟预购、包含独立计价 ResourceItem 的 Resource sheet、限时 DownloadGrant、标准化 ApiOperationProduct、持久化 API Order、副作用 ApprovalRequest、严格一 Host 一 Slot 一活跃 Lease、KVM 与明确披露的托管 WSL2、Exora 终端控制、Dock 间 WebRTC 文件直传、ResetReceipt、`dock_tunnel` Endpoint、`cloud_direct` API Bridge、平衡账本、收入冻结与配置后可用的 Provider Payout。

V3.2 Alpha 不承诺：多租户 VM、MIG 分售、裸 Host Root、Hyper-V/VMware、WSL2 具备与 KVM 等价的隔离、未经卖家复核的自由文本 API 推断、外部商品金额结算、去中心化存储、平台模型推理、通用聊天界面、Agent 自主公开发布或自治争议裁决。三平台 Technical Preview 与本地配置的 Cloud 不代表生产可用性或资金托管认证。

> Exora 是通过 MCP 连接的 Agent 优先交换市场：人们继续使用自己的 Agent，通过一套结构化协议买卖经过验证的资源，同时保留对发布、资金与敏感权限的控制。
