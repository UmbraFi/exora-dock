# Exora Dock

Exora Dock 是 Exora API-only 商业能力市场的桌面工作台、本地运行时和 MCP 安全边界。它让 Buyer Agent 调用经过验证和计费的 API Operation，也让 Seller 把本地程序或公共 HTTPS API 接入同一个市场，同时把凭证、价格确认、发布和生命周期操作保留在人类可控的边界内。

> 当前版本：`0.1.0-preview.3` Technical Preview。本文基于 2026-07-22 的当前工作区；“已实现”表示代码和自动化检查已经存在，不代表真实 Cloud、资金或生产环境已经完成验收。

## 唯一产品模型

Exora 当前只有一个公开市场和一种公开能力来源。Buyer 看到的是统一的 API Operation Catalog，运行位置不会形成新的商品分类。

| 维度 | 当前值 | 含义 |
| --- | --- | --- |
| `applicationSource` | `api` | 唯一公开能力来源 |
| `deliveryMode` | `local_dock` | Seller 保持 Dock 在线，通过出站 Tunnel 提供获批的本地 Adapter；服务地址和凭证留在 Seller 设备 |
| `deliveryMode` | `cloud_direct` | Exora Cloud 调用 Seller 授权的公共 HTTPS API；运行凭证由 Cloud 加密保存 |
| `interaction` | `request_response` | 同步请求与响应 |
| `interaction` | `server_stream` | 通过 SSE 返回流式进度或结果 |
| `interaction` | `async_job` | 创建可查询、可监听并按声明取消的异步 Job |

公开调用关系固定为：

`API → Operation → Invocation → optional Job / Artifact`

`vm`、`resources`、`endpoint`、`api_bridge` 四种旧 `applicationSource` 已全部取消；V4 不提供这些商品分类、购买流程或兼容回退。Artifact 只是 API Invocation 的经过校验的大文件输入输出，不是独立的可下载资源商品；短期下载授权也只用于安全传输 Artifact。

### 版本名称说明

- 身份、注册和设备连接继续使用 `/v1`。
- 市场、API、Operation、Invocation、Job、Artifact、Order 和 Ledger 统一使用 `/v4`，没有 `/v3` 市场路由。
- `exora.api.v3` 是当前 Provider 能力 Schema 的版本名，不代表旧市场模型。
- Seller 提交的单一源文件是 `exora.api-contract.v1`；自动计费使用 Pricing 与 Settlement V4 契约。
- 公开协议没有按 `productKind` 分支；最小的独立验证、计费、发布和保护单位是 Operation。

## Exora Dock 做什么

### Buyer

- 搜索可调用的 Operation，并读取所属 API、交付方式、可用性和价格信息。
- 在调用前获取费用预估，创建 Invocation，并在断线或重启后恢复结果。
- 查询或取消声明支持取消的 Job，监听 SSE 进度。
- 为大型输入创建 Artifact Upload，完成上传校验，并获取输出 Artifact 的短期下载授权。
- 查看 API Order、订单内调用、账户 Ledger 和结算结果。
- 停用 API Order；重新启用必须回到人类 PIN 审批边界。

### Seller

- 在 Desktop 中创建 `Local API` 或 `Cloud API` Draft；两者属于同一个 API 市场，只是 `deliveryMode` 不同。
- 由 Dock 创建稳定 `apiId`，并通过幂等键和版本号安全地创建、更新与重试 Draft。
- 使用 Seller 现有的 Codex、Cursor、OpenCode、Claude 或 OpenClaw，通过受限 MCP 工具准备完整 API 合约。
- 从 OpenAPI 3.1、Operation Policy、安全测试案例、计量声明和 Owner 指定的计费规则生成确定性验证计划。
- 在 Owner 确认后发布、重新发布、下架、drain 或强制停止 Operation，并查看履约、用量、收入、退款、故障和保护状态。

### Dock 安全边界

- MCP 初始化创建有作用域、可过期、可撤销的本地 Agent Session；持久层只保存令牌哈希。
- Agent 可以准备和更新非 Live Draft，但不能替人类运行外部验证、确认合约、选择价格、发布、下架或强制停止。
- 生成文件只能写入 `<authorized-root>/.exora/generated/<integrationId>`；拒绝绝对路径、目录穿越和符号链接。
- 每个生成文件最多 256 KiB，每个 Integration 最多 100 个文件和 5 MiB；Dock 不执行 Shell 字符串，也不自动安装依赖。
- Local API 凭证保存在账户隔离的本地 Vault 中，只在调用时解析；合约和日志不得包含秘密值。
- Desktop 使用 Electron `safeStorage` 保护 Cloud Session；系统安全存储不可用时只保留进程内 Session。Payment PIN 不落盘。
- Desktop IPC、导航、外部链接、网络超时、响应读取和凭证脱敏均有独立约束与测试。

## Provider 两步工作流

每个 API Draft 可以包含一个或多个 Operation。Seller 或其授权 Agent 只提交一份 `exora.api-contract.v1`，其中包含完整 `exora.api.v3` 能力、安全可重复的 Seller 案例，以及每个 Operation 的显式计费规则。源文件不携带正式测试结果、签名回执、Owner 确认状态或运行凭证。

### 1. Contract validation

Dock 从同一份源合约生成并锁定两类相互绑定的证据：

1. Integration validation 检查连通性、HTTP 状态、Content-Type、OpenAPI 3.1 / JSON Schema、错误协议、SSE、Async、Artifact、限制和计量证据。
2. Billing validation 检查 `exora.price-formula.v4` 公式、单次最高收费和 Settlement V4 守恒，并通过不移动真实 USDC 的 Cloud Sandbox Ledger 取得签名回执。

两类验证都通过后，Owner 对同一份受测合约确认一次。Exora 只验证机器能够客观判断的协议与格式；摘要质量、生成内容准确度等业务语义仍由 Owner 根据真实输出判断。

### 2. Operations

确认后进入运营阶段，管理 `offline / live / draining`、发布、在途履约、用量、收入、退款、异常和自动保护。修改源合约会使两类验证证据和后续锁失效；Live 或 Draining Operation 不能被直接修改或删除。

普通下架立即拒绝新调用并等待在途调用结束。强制停止会取消未完成履约、退款并记录 Seller 责任。计量异常、连续健康检查失败或达到 Provider 故障率阈值时，系统会阻断新调用。

## 当前完成情况

### Dock 与 MCP

- Go daemon 已提供健康检查、公开发现清单、Cloud Link、本地授权、V4 HTTP 路由和 stdio MCP Server。
- Buyer MCP 已覆盖 Catalog、Estimate、Invocation、Job、Artifact、API Order 和 Ledger。
- Provider MCP 已覆盖准备指南、幂等 Draft 创建、完整合约提交、Draft 查询和验证状态查询。
- 本地服务健康探测、请求转发、SSE 分块、Tunnel Ping 保活、账户隔离和凭证解析已有自动化测试。
- 旧市场路由和旧 MCP 工具不在当前 V4 公开 Surface 中，并由静态检查阻止重新引入。

### Desktop

- 主界面只保留 `Market`、`Local API` 和 `Cloud API` 三个工作区。
- 已实现注册、登录、邮箱验证、PIN 操作边界、Account Key 同步、Session 过期和离线退出补偿。
- 已实现统一 Operation 市场、远程刷新、买卖双方订单历史、订单内调用、结算汇总、Wallet 和设置。
- 已实现 API Draft 创建、稳定 UID、名称/图标编辑、合约验证、运营控制台、发布和生命周期操作。
- 已实现 Agent MCP 配置的检测、注册、冲突保护和显式修复。
- Electron 负责捆绑 Dock daemon 的构建、启动、健康检查和退出，并隐藏 Windows 子进程控制台。

### Schema、计费与示例

- `exora.api-contract.v1`、`exora.api.v3`、Operation、Validation、Pricing、Billing Receipt、Estimate 和 Settlement 契约已纳入仓库。
- Pricing V4 已实现公式解析、复杂度限制、精确金额计算、计量范围验证、单次上限和结算守恒。
- [`virtual-text-summary`](./examples/virtual-text-summary/README.md) 演示同步文本摘要与按成功交付计费。
- [`mock-render-api`](./examples/mock-render-api/README.md) 演示零输入、本地 SVG 输出和 Invocation 幂等重试。
- [`random-tarot-api`](./examples/random-tarot-api/README.md) 演示零输入、结构化随机结果、SVG 输出与错误契约。

## 当前自动化验证

以下结果已于 2026-07-22 在 Windows 开发环境重新验证：

| 检查 | 结果 |
| --- | --- |
| `go test -count=1 ./...` | 通过 |
| `go build ./cmd/exora-dock` | 通过 |
| `npm run build:frontend` | TypeScript 与 Vite 构建通过 |
| `npm run build:electron` | 79 项测试通过，API-only Electron 静态检查通过 |
| `examples/mock-render-api` 的 `npm test` | 5 项测试通过 |
| `examples/random-tarot-api` 的 `npm test` | 4 项测试通过 |

这些结果验证本地代码、协议约束、状态迁移和 UI 结构，但不等同于真实 Cloud、真实资金、长时间负载或跨平台安装验收。

## 尚未完全验证

| 范围 | 当前证据 | 仍需完成 |
| --- | --- | --- |
| 真实 Cloud | Client、认证、代理、签名回执和错误处理已有实现与单测 | 在共享环境完成注册、PIN、Account Key、发布、购买、调用、结算、重连和撤销的 golden path |
| 两种交付方式 | Draft、契约、凭证边界和本地 Tunnel 已实现 | 分别验证本地出站 Tunnel 与公共 HTTPS 服务的首次发布、更新、故障恢复和重新发布 |
| 三种交互方式 | 同步、SSE、Async 和 Artifact 协议边界已实现 | 当前示例主要覆盖同步调用；仍需 SSE、长 Job、取消、断线恢复和大文件端到端样例 |
| 生命周期 | Offline、Live、Draining、强停、退款和保护状态机已有测试 | 在真实并发和在途调用下验证 draining、强停、健康故障、计量异常和退款一致性 |
| 多账户 | Store、Vault、请求防串号、退出清理和迁移有测试 | 真实账号 A/B 连续切换、崩溃恢复、离线退出与旧数据人工验收 |
| 桌面安全 | IPC、导航、网络超时、凭证脱敏和安全存储降级有测试 | Windows 与 macOS 的系统密钥库、证书、代理和系统权限场景 |
| 发布 | Preview 3 workflow 目标为 Windows x64 与 macOS ARM64，并生成签名发布清单与 SHA-256 | 完成两平台 clean build、安装、首次启动、升级、卸载和数据保留 smoke test |
| UI | 主要按钮、工作区、字号和操作边界有静态检查 | 完成人工视觉回归、键盘、屏幕阅读器、高 DPI、小窗口和中英文完整性检查 |

### 已知工程缺口

- 部分 Desktop 市场指南仍显示已取消商品的旧文案；`docs/DESKTOP_DEV.md` 与 `deploy/exoradock/README.md` 也仍描述过时模型。它们不能作为当前 V4 产品事实来源。
- 部分 CSS、Go 文件和内部函数仍保留 V3 历史命名。当前公开协议已经是 V4，但内部命名清理尚未完成。
- `desktop/package.json` 的 Electron 测试命令仍引用不存在的 `electron/ui-system.test.cjs`；Node 当前不会因此失败，对应覆盖需要补回或显式移除。
- Preview 3 暂不发布 Linux 包。Windows 尚未 Authenticode 签名；macOS 使用 ad-hoc signing 且尚未 notarize。
- 现有自动化主要验证结构和状态机，不能替代 API 业务结果、真实资金和生产运行验收。

## 下一步目标

### P0：完成 API-only 收口

- 删除 Desktop、开发文档、部署参考、构建脚本和样式中的旧产品文案与失效入口。
- 为公开 Surface 增加统一回归门禁：只允许 `applicationSource=api`，交付方式只允许 `local_dock / cloud_direct`。
- 统一 README、白皮书、Schema、Desktop 和 Cloud 的两步 Provider 工作流表述。

### P1：建立真实 Cloud golden path

- 使用现有示例完成 Provider 的 Draft、验证、Owner 确认、发布、更新、下架和重新发布。
- 完成 Buyer 的搜索、预估、调用、结算、结果恢复、Order 停用和 PIN 恢复申请。
- 固化 Dock/Desktop 与 Cloud 的 V4 请求、错误、签名回执和版本兼容契约。

### P2：补齐交互与可靠性验证

- 增加 SSE、Async Job、取消和大文件 Artifact 示例。
- 对本地 Tunnel 做并发、背压、慢响应、超时、断线重连和长时间运行测试。
- 在真实在途调用下验证 Draining、强停、自动保护和退款守恒。

### P3：打通可重复发布

- 修复缺失测试文件和仍存在的旧构建残留，让 CI 对缺失输入直接失败。
- 完成 Windows x64 与 macOS ARM64 的 clean build、安装、升级、卸载和回滚测试。
- 补齐 Windows 签名、macOS signing/notarization，并在验证通过后再评估恢复 Linux 发布。

## 本地开发

### 环境要求

- Go `1.25.x`
- Node.js `22.x` 与 npm；当前 CI 使用 Node `22.23.1`
- Windows 或 macOS；核心 Go 代码也可在 Linux 开发，但 Preview 3 不发布 Linux 桌面包

### 运行 Dock daemon

```powershell
go run ./cmd/exora-dock .\config.example.yaml
```

默认配置见 [`config.example.yaml`](./config.example.yaml)。开发环境可以通过 `cloud_url` 或 `EXORA_CLOUD_URL` 指向本地 Exora Cloud。

### 运行 MCP Server

先启动 Dock daemon，再打开另一个终端：

```powershell
go run ./cmd/exora-dock mcp .\config.example.yaml
```

Desktop 也可以为受支持的 Agent 检测、生成或修复 MCP 配置。

### 运行 Desktop

```powershell
cd desktop
npm ci
$env:EXORA_CLOUD_URL = "http://127.0.0.1:8090"
npm run preview:desktop
```

`preview:desktop` 会从当前 Go 源码重建捆绑 daemon，再启动 Vite 与 Electron。Packaged build 必须配置明确的 HTTPS Cloud URL。

### 运行测试

```powershell
go test -count=1 ./...

cd desktop
npm run build:frontend
npm run build:electron

cd ..\examples\mock-render-api
npm test

cd ..\random-tarot-api
npm test
```

## 目录结构

| 路径 | 内容 |
| --- | --- |
| [`cmd/exora-dock`](./cmd/exora-dock) | Dock daemon、MCP、认证和 Cloud Link CLI |
| [`api`](./api) | 本地 V4 HTTP Handler 与 Cloud Proxy |
| [`internal`](./internal) | MCP、账户隔离、本地交付、Tunnel、Provider Draft、验证、计费与生命周期 |
| [`desktop`](./desktop) | Electron + TypeScript/Vite 桌面端 |
| [`contracts`](./contracts) | API、Operation、Validation、Pricing 与 Settlement Schema/fixture |
| [`examples`](./examples) | API-only Provider 示例和测试合约 |
| [`skills/prepare-exora-api`](./skills/prepare-exora-api/SKILL.md) | Seller Agent 的 API 准备流程指南 |

## 进一步阅读

- [V4 中文白皮书](./docs/WHITEPAPER.md)
- [V4 English Whitepaper](./docs/WHITEPAPER.en.md)
- [API Operation 技术模型](./docs/API_OPERATION_MODEL.md)
- [MIT License](./LICENSE)
