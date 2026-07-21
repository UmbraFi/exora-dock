# Exora V4 API-only 白皮书

## 一份合约、两类验证、两个产品步骤

卖家或其授权 Agent 只提交一份 `exora.api-contract.v1` JSON。该文件同时包含
可调用 API 规则、安全的卖家测试案例和显式自动计费规则。测试计划、分区哈希、
签名回执和所有者确认状态由 Exora 生成，源文件不得声明这些结果。

验证时，每项源计费规则会生成平台所有的 `exora.operation-pricing.v4` 投影，
并由 `exora.operation-settlement.v4` 约束结算。

Provider 工作流只有两个可见步骤。第一步“合约验证”依次且独立验证连通性/返回
格式与计费/结算，全部通过后由所有者对同一份受测合约确认一次。第二步“运营”
负责发布、上下架、履约、用量、收入和自动保护。修改源合约会同时使两类验证失效。

Exora 是面向 Agent 的商业 API 市场。公开 `applicationSource` 固定为 `api`，能力统一为 API Operation，交付模式为 `local_dock` 或 `cloud_direct`。身份入口保留 `/v1`，市场能力统一通过 `/v4` 暴露。

## Local API 接入

卖家可以把已有本地程序、函数、CLI 或 HTTP 服务通过 Exora Adapter 接入 Exora。现有 Agent 通过受 Dock 约束的 Integration Session 完成发现、契约草稿和静态准备。`exora.service_manifest.v2` 继续描述 Adapter 运行接口；Provider Operation V3 则负责公开能力、格式验证、计量和计费。Dock 不执行 Shell 字符串，不自动安装依赖，也不会把凭证写入能力契约。只有所有者可以批准可执行入口、选择 Vault 凭证、接受副作用、确认能力和价格以及发布。

Dock 在创建草稿时生成持久、稳定的公开 `apiId`，并以同一 UID 同步 Cloud。Agent 可以用 `apiId + expectedVersion` 更新未上线草稿，但不能覆盖 Live 内容或绕过版本检查。

## Provider Operation 两步工作流

每个 Operation 必须依次完成：

1. **合约验证**：上传或由 Agent 提交一份 `exora.api-contract.v1`，系统从中分别生成接入与计费投影；先验证连通性、请求/返回格式和协议，再通过 Cloud Sandbox Ledger 验证显式计费规则；所有者审阅两份凭证后一次确认并锁定同一受测合约。
2. **运营**：管理 `offline / live / draining`、上架、下架、在途履约、用量、收入、退款、异常和保护策略。

修改源合约会清除两类验证凭证和后续锁。`live` 或 `draining` 状态禁止修改和删除。

## 验证边界：格式，不是业务结果

Seller 每个 Operation 至少提供一个安全、可重复的成功调用案例。案例保存真实请求和 `expectedProtocol`，用于选择 OpenAPI 响应分支；不保存完整 `expectedResponse`，也不逐值比较动态业务输出。

Exora 只验证机器可以客观判断的内容：HTTP 状态码、Content-Type、JSON Schema 2020-12、必填字段、类型、格式、范围、枚举、Schema 明确声明的 `const`、响应大小、超时、公开错误契约、SSE/Async/Artifact 协议以及计量证据。摘要质量、生成内容准确度、预测正确性等业务语义由所有者根据实际测试输出确认。

交互模式包括同步 `request_response`、SSE `server_stream` 和 `async_job`。Streaming 必须声明事件、结束、错误、序号和超时；Async Job 必须声明 Job ID、状态、轮询、终态、最大等待时间，并在支持取消时提供取消案例。

保存接入草稿会从规范确定性编译 `exora.operation-validation-plan.v3`。相同规范得到相同 `planHash`。验证运行拥有独立 run ID，凭证绑定 API UID、Operation、版本、接入/OpenAPI/计划哈希、逐项结果和计量证据哈希。系统不保存凭证、认证头或完整请求响应正文，只保留不超过 4 KiB 的脱敏摘要。

## 自动计费规则与沙盒结算

每个 Operation 的源合约必须显式包含计费公式和正数单次最高收费；币种固定为 USDC，结算策略固定为 V4。平台没有自动模板、模板参数或静默默认值；独立定价公式书只读。Agent 只能编码卖家明确给出的计费意图，不能替卖家选择费率，也不能运行验证或确认合约。

公式只能引用已锁定接入凭证确认的计量维度和 Cloud 权威变量 `delivered`，除数只能是正数常量，并且在声明范围内始终有定义、非负且受最高收费限制。成功时 `delivered=1`，执行后取消时为 `0`；执行前取消、业务错误和系统故障不执行公式。Provider 上报计量必须包含标准证据位置；缺失、冲突、非法或越界时，本次调用全额退款并阻断新调用。

Cloud Sandbox Ledger 覆盖零用量、单位用量、Seller 样例、上限、条件边界、成功、业务错误、取消、Provider/Cloud/超时/Schema/Artifact 故障和强制停止，并证明：

`chargedAtomic + refundedAtomic = reservedAtomic`

Cloud 返回绑定 UID、版本、接入凭证、价格、公式 AST 和计费计划哈希的 Ed25519 签名 V4 凭证。Dock 在所有者确认价格前验证签名和全部哈希，Cloud 在发布前再次验证。Desktop Preview 只是估算，不是计费证据。

## 生命周期与保护

普通下架立即拒绝新调用并等待在途履约结束；强制停止取消未完成履约、全额退款并记录卖家责任。控制台优先使用 SSE，断线后每 15 秒轮询。

任一计量异常、连续两次健康检查失败，或 15 分钟内至少 10 次调用且 Provider 故障率达到 10% 时，系统自动阻断新调用。

## Agent 权限边界

Agent 可以创建和更新非 Live 接入草稿、根据 OpenAPI 与卖家描述生成案例草稿、解释缺失案例和字段、查询验证计划与失败原因。Agent 不可以自动运行外部验证、确认能力、写入或锁定正式价格、发布、下架或强制停止。

## 买家、评价与仲裁

买家通过 API Order 调用已上架 Operation。至少一次成功付费调用后可以提交一次 Verified Purchase 评价，并可在七天内更新。连接、超时、Schema/SSE、Artifact 完整性和计量故障按机器证据自动结算；主观业务争议绑定具体 Invocation，需在 72 小时内发起。默认不保留调用正文，只保存脱敏摘要、哈希和审计记录。

## Pricing V4 切换

V4 的唯一公式、测试计划和签名凭证契约分别为 `exora.price-formula.v4`、`exora.operation-billing-plan.v4` 和 `exora.operation-billing-receipt.v4`。

Pricing V3、旧模板定价和旧计费凭证不迁移。Cloud 先部署 Pricing、Formula、Billing Plan、Billing Receipt 与 Settlement V4，Dock 与 Desktop 随后启用 V4；旧 V3 文件和兼容读取路径全部删除。
