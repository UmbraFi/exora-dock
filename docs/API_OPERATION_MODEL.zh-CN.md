# Exora Provider Operation 模型 V3

[English](API_OPERATION_MODEL.md) | 简体中文

## 卖家源合约与两步工作流

Provider 接入只有一份由卖家编写的源文档：`exora.api-contract.v1`。它包含完整 `exora.api.v3` 能力（包括 OpenAPI 输入/输出 Schema、参数语义、可信计量和安全 Seller 测试样例），以及每个 Operation 的一项自动计费规则。它不包含测试结果、所有者批准、运行凭证或发布状态。

Dock 将该源文件投影为两个独立计算哈希的验证域：

1. **合约验证**首先执行接入验证（可达性、协议和返回格式），然后执行计费验证（公式安全与 Sandbox Ledger 结算）。Seller 测试样例选择状态码/媒体类型/Schema；动态业务值绝不作为判定标准。两份凭证都必须通过后，所有者才能一次确认同一份合约。
2. **运营**仅在确认后解锁，负责发布、offline/live/draining 生命周期、履约、用量、收入和保护。

离线状态替换源合约会使两项投影和两份凭证均失效。Live 或 Draining Operation 不可变更。

Exora 使用标准关系 `API -> Operation -> Invocation -> optional Job / Artifact`。OpenAPI 3.1 是请求和响应格式的唯一权威。Operation 是可独立验证、计费、发布和保护的最小单位。

## Exora 验证的内容

Seller 声明能力、协议以及至少一个安全且可重复的成功测试样例。用量计量是可选的，仅在定价公式需要实际用量维度时声明；固定调用收费不需要虚构 `request` 计量。测试样例包含真实请求，并通过 `expectedProtocol` 选择 OpenAPI 响应分支，不包含 `expectedResponse`。

Exora 验证 HTTP 状态码、媒体类型、JSON Schema 2020-12、声明的常量、限制、错误封装、SSE/Async/Artifact 协议和计量证据。动态业务值可以随运行变化，绝不按语义判定。所有者审阅观察到的行为，并独自确认它是否代表所宣传的能力。

## 权威契约

- `exora.api.v3.schema.json`
- `exora.operation.v3.schema.json`
- `exora.operation-validation-plan.v3.schema.json`
- `exora.operation-validation-receipt.v3.schema.json`
- `exora.operation-pricing.v4.schema.json`
- `exora.price-formula.v4.conformance.json`
- `exora.operation-billing-plan.v4.schema.json`
- `exora.operation-billing-receipt.v4.schema.json`
- `exora.operation-estimate.v3.schema.json`
- `exora.operation-settlement.v4.schema.json`

V1 和 V2 Provider Operation 契约不被接受，也不迁移。

## 所有者两步工作流

1. **合约验证**：上传或由 Agent 提交一份源合约；依次运行派生的接入计划和计费计划；审阅两份凭证；一次确认并锁定同一组受测投影。
2. **运营**：发布、下架、drain 或强制停止 Operation，检查在途工作、用量、收入、退款、故障和保护事件。

替换源合约会清除两个验证域、全部凭证和下游锁。Live 或 Draining Operation 不可变更，也不可删除。

## 确定性接入验证

验证计划仅从规范化 OpenAPI、Seller 测试样例、交互方式、公开错误、Artifact、限制和计量声明派生。相同输入产生相同 `planHash`；计划只读，不能成为第二个测试定义编辑器。

运行使用受控 HTTP 执行并持久化 run ID。凭证绑定 API UID、Operation ID 和版本、接入/OpenAPI/计划哈希、每项机器检查、时间、状态码、媒体类型、响应大小、Schema 结果、计量摘要和证据哈希。仅保留最多 4 KiB 的脱敏摘要，不存储秘密值、认证头或完整请求/响应正文。

## 自动计费规则 V4

每份卖家源合约必须为每个 Operation 显式提供 `chargeFormula`、正数 `maximumChargePerInvocationAtomic`、`currency: USDC` 和 `settlementPolicy: exora.operation-settlement.v4`。没有模板 ID、自动生成公式或静默默认值。Agent 可以编码卖家提供的意图，但不能选择费率、运行验证或确认合约。独立的 Exora Pricing Book 只读。

公式仅可引用锁定接入凭证验证过的计量维度和 Cloud 所有的 `delivered` 变量。成功交付时 `delivered` 为 `1`，执行取消时为 `0`。每个计量维度必须声明单位、来源、单次调用上限，以及适用时的 Provider 证据位置。未知变量、动态或非正除数、隐藏负值、溢出和未定义范围都会被拒绝。允许常量公式，总收费始终受上限约束。

Desktop 估算仅供预览，不是证据。Cloud Sandbox Ledger 是权威来源，其 Ed25519 签名凭证绑定 API UID、Operation/版本、接入凭证、价格哈希、公式 AST 和计费计划哈希。生产 Cloud 部署持久化 `EXORA_BILLING_SIGNING_SECRET`，让签名身份在重启后保持不变。沙盒不移动真实 USDC，并在成功、错误、取消、故障、强制停止、零/单位/样例/最大用量和公式边界场景证明 `chargedAtomic + refundedAtomic = reservedAtomic`。

## 生命周期、计量与保护

生命周期为 `offline | live | draining`。普通下架拒绝新调用并等待在途工作完成。强制停止取消未完成工作、退款并记录 Seller 责任。控制台使用 SSE，失败时回退为每 15 秒轮询。

Cloud 测量结果为权威。Provider 签证的计量证据会出现在买家可见的结算凭证中。缺失、冲突、非法或越界计量会导致本次调用退款并阻断新调用。连续两次健康检查失败，或 15 分钟窗口内至少十次调用且 Provider 故障率达到百分之十时，也会阻断新调用。

## Agent 边界与稳定 UID

Agent 可以创建或更新非 Live 接入草稿、编写测试样例草稿、解释缺失声明，并读取计划、运行和失败信息。Agent 不能运行外部验证、确认能力、写入或锁定正式价格、发布、下架或强制停止。

Dock 在创建 Draft 时生成标准持久 `apiId`，并将同一 UID 同步到 Cloud。卖家编写的合约 JSON 不含 UID；Dock 在提交时注入当前 Draft UID。所有更新仍在合约正文之外使用 `apiId + expectedVersion`。Cloud 发布必须返回完全相同的 UID，否则拒绝。
