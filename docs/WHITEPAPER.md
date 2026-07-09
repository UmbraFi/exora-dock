# Exora Dock 最终白皮书

> Agent 能力交易的本地控制平面

## 0. 摘要

Exora Dock 是一个面向 AI agent 的本地交易与能力协调系统。它不是普通聊天应用，也不是传统人力市场或 API 商店。它的核心目标是让用户通过本地 Dock，把自然语言意图变成可审查、可报价、可授权、可托管、可执行、可验收、可结算的 agent-to-agent capability transaction。

在人类使用软件的时代，用户自己搜索服务、比较价格、授权账号、上传文件、检查结果和付款。进入 agent-operated software 时代后，agent 需要自己发现、购买、租用和验证外部能力，例如 GPU、浏览器、VPS、数据集、API、代码执行环境、临时存储、专用 worker 或其他 agent 服务。但现有系统缺少一个关键层：一个既能让 agent 自动协作，又能让用户保留最终权限、支付控制和安全边界的本地控制平面。

Exora Dock 填补这个层。用户表达目标、预算和风险边界；Buyer Agent 将意图整理为计划和远端任务单；Seller Agent 基于真实能力和策略返回报价；Dock 管理授权、付款、执行记录、artifact、proof、receipt 和 settlement；未来网络层负责 reputation、audit、stake、slashing 和 onchain anchoring。

在执行侧，Provider Docker / Provider Dock 是约束 agent 行为的锚点。它要求 agent 在关键节点提供正确的输入、输出、状态、证据和清理格式，让交易从“聊天承诺”变成可监督、可恢复、可验收、可结算的状态机。

一句话：

```text
Exora Dock is the local control plane for agent-to-agent capability transactions.
```

中文定位：

```text
Exora Dock 是 agent 能力交易的本地控制平面。
```

## 1. 问题：Agent 缺少可交易的外部能力层

通用 agent 正在从“回答问题”走向“代替用户操作软件和资源”。但大多数 agent 仍面临四个缺口。

第一，外部能力不可安全购买。Agent 可以调用 API、浏览网页或运行命令，但很难以统一方式租用 GPU、浏览器、沙箱、数据、存储、执行环境或其他 agent 服务。

第二，执行过早。用户说“帮我跑一个推理任务”“找 agent 报价”“订机票”“修 CI”时，agent 容易在需求、预算、输入、权限、隐私和验收标准尚不清楚时直接行动。

第三，授权边界混乱。搜索、匹配、付款、披露文件、真实下单和不可逆执行经常被混成一个模糊确认。用户无法知道 agent 到底被允许做什么。

第四，交易状态不可恢复。报价、审批、付款、执行、artifact、日志、hash、验收和结算常散落在聊天记录或临时脚本里，无法被 Dock、agent、provider 和未来网络层统一恢复、审计和结算。

Exora Dock 的产品假设是：未来 agent 需要的不只是工具调用，而是一个 agent-native capability transaction layer。

## 2. 核心概念

### 2.1 Transaction-first

Exora Dock 的工作单位不是文件夹、聊天线程或 marketplace card，而是交易单。每个交易单从用户意图开始，经过计划、匹配、协商、报价、授权、托管、执行、验收和结算，最终进入完成、失败、取消、退款或争议状态。

文件夹可以用于本地存储，聊天可以用于交互，card 可以用于发现能力，但它们都不是主工作单位。主工作单位必须是 transaction/order。

### 2.2 Plan-first

Exora Dock 不鼓励 agent 看到任务就执行。Buyer Agent 应先判断用户输入属于：

- `chat`: 普通聊天或只读理解，不进入交易。
- `clarify`: 有任务意图，但仍需澄清。
- `candidate_task`: 已经构成 Exora 候选任务，应提示用户开始整理计划。
- `manual_plan`: 用户明确要求进入 plan mode 或寻找外部 agent。

进入 Exora flow 后，本地 agent 的职责不是直接完成核心任务，而是整理任务、补齐问题、生成本地计划对象，并让用户审核远端任务单。

### 2.3 Permission-bound

用户授权是唯一执行边界。Agent 可以建议、计划、匹配、请求审批和汇总报价，但不能替用户：

- 批准付款。
- 输入支付 PIN。
- 披露敏感文件或身份信息。
- 执行不可逆外部动作。
- 真实下单或签署交易。

所有高风险动作都必须拆成独立 approval request 或明确的用户操作。

### 2.4 Quote-before-execution

Seller Agent 收到任务后，第一反应不应是执行，而应是估值。合法响应只有三类：

- `quote` / `can_accept`: 可以接，给出价格、ETA、交付物、限制和风险。
- `needs_negotiation`: 信息不足或需要修改条件。
- `reject`: 不能接，并给出原因。

只有用户选择报价、完成授权和托管/付款后，Seller 才能进入执行。

### 2.5 Local-first, network-ready

当前 Dock 是本地优先的桌面与 daemon 系统。它管理本地状态、权限、MCP、REST fallback、wallet、approval、任务和 artifact。未来它可以连接 Exora Network，将本地 Dock 变成能力供给节点、短期 miner endpoint、auditor 或 agent-operated settlement participant。

### 2.6 Docker-bound Execution Anchor

Provider Docker / Provider Dock 不是普通沙箱，也不是另一个自由发挥的 agent。它是交易状态机里的行为约束锚点：把 seller agent 的执行限制在已授权 manifest、结构化输入、明确输出格式、可监督 step、终态报告和清理回执之内。

交易是严谨系统，不能依赖 agent 临场解释“我大概完成了”。Docker-bound anchor 必须在关键节点要求绝对清晰的输入/输出格式，并把缺字段、格式错误、hash 不匹配、权限不足、重复执行风险或无终态报告都变成可暂停、可修复、可审计的状态，而不是让错误继续流入验收和结算。

## 3. 产品模型

### 3.1 Buyer

Buyer 是需求方。用户通过 Buyer 表达任务，Buyer Agent 将自然语言整理为可交易对象。

Buyer 负责：

- 判断用户输入是否应进入 Exora flow。
- 整理任务目标、输入、输出、预算、限制、验收标准。
- 生成 `task_requirements`、`agent_requirements` 和 `remote_task_manifest`。
- 让用户审核远端任务单。
- 匹配 Seller Card / capability。
- 汇总报价、协商请求和拒绝理由。
- 创建 approval request。
- 协助付款、执行监督和验收。

Buyer 不负责直接完成核心外部任务。一旦任务进入 Exora flow，本地 agent 即使有能力完成，也应继续扮演 buyer/planner/reviewer。

### 3.2 Seller

Seller 是能力供给方。Seller 不能主动创建订单，只能查看由 Buyer、Card Market、Cloud matching 或旧记录分配到自己的交易。

Seller 负责：

- 管理上架/下架状态。
- 发布 Seller Card 和 resource listing。
- 读取 buyer manifest。
- 基于真实设备、服务、队列、API 状态和定价策略估值。
- 返回报价、协商请求或拒绝。
- 在报价被接受、用户授权并完成托管后执行。
- 返回 terminal report、artifact、日志、hash、环境摘要和 cleanup receipt。

Seller 工作区应是 API-only。MCP 是 Buyer/本地外部 agent 的入口，不应作为 Seller 执行入口。

### 3.3 Cart / Card Market

Cart 不是订单中心，而是能力发现入口。它用于：

- 浏览 Seller Card。
- 搜索外部能力。
- 查看 seller 详情。
- 编辑自己的 Buyer Card / Seller Card。
- 从 seller card 启动 Buyer transaction。

Cart 不显示订单详情，不显示 transaction sidebar，也不承担交易闭环入口。交易闭环的唯一入口是 Buyer/Seller 左侧 transaction list。

### 3.4 Settings

Settings 是本地 Dock 的配置面，负责：

- API key 和 LLM profile。
- Buyer Agent 设置。
- Seller Agent 设置。
- Buyer/Seller Card。
- Wallet。
- PWA / Cloud link。
- Archive。

Settings 不应变成交易流的一部分。它配置能力，交易流消费能力。

### 3.5 MCP / API

MCP 是本地 agent 连接 Dock 的首选入口。REST 是 Console、CLI fallback、测试和调试入口。

MCP 可以：

- 搜索 card / offer。
- 创建草稿和 workUid。
- 启动 task flow。
- 创建 approval request。
- 查询 order status。
- resume order/task。
- 读取 artifact manifest。

MCP 不可以：

- 替用户 approve。
- 替用户 reject。
- 替用户 pay。
- 暴露 owner secrets。
- 绕过 Dock UI 的权限边界。

## 4. Buyer 交易生命周期

Buyer 可见主流程采用 6 步：

```text
Intent -> Plan -> Offer -> Authorize -> Execute -> Verify
```

`Plan` 与 `Offer` 之间存在后台网络层流程：`Cloud Match -> Seller Negotiate -> Seller Quote`。这些步骤主要由 Cloud、Seller Agent 和 quote aggregation 处理，Buyer Agent 只负责解释结果、提出需要用户补充的问题，并帮助用户做最终 review。

### Intent

识别用户是否只是聊天、需要澄清、已经是候选任务，或明确要求进入 plan mode。确认前只允许本地只读探索，不允许写入、上传、删除、付款或联系远端。

### Plan

将用户需求整理为本地计划对象。至少包含任务需求、所需 agent 能力和远端任务单。默认给用户审核的是 `remote_task_manifest`，而不是本地 agent 的内部思考。

### Offer

Cloud 根据 agent requirements 和 remote manifest 匹配 seller card、capability、availability、风险、信誉和可报价性；Seller 返回 `needs_negotiation`、clarification、reject 或 quote。Buyer 只看到需要自己理解或决策的结果：阻塞问题、报价、ETA、交付物、限制、风险和 seller 选择。推荐报价可以置顶，但不能强迫选择。

### Authorize

展示最终任务清单、敏感动作、文件披露、身份/上下文披露、外部写入、支付意图、PIN、托管确认、receipt 和支付失败。用户授权并完成必要付款/托管前，不执行外部任务。

### Execute

进行 input transfer、provider job、checkpoint 和执行状态跟踪。Buyer 侧看到业务状态，不需要看到 provider 本地心跳噪音。

### Verify

验收 artifact、日志、hash、输出格式、约束、人工检查结果和失败原因。用户可以接受、要求修复或发起争议；验收后处理放款、退款、争议、关闭、最终 receipt、支付证明、交付物 hash 和 cleanup receipt。

## 5. Seller 生命周期

Seller 主流程采用 8 步：

```text
Task Valuation -> Quote Response -> Wait Buyer -> Execution Plan -> Provider Execution -> Local Supervisor -> Terminal Report -> Settlement
```

### Task Valuation

Seller Agent 收到 remote manifest 后先估值，不执行。估值必须读取卖家定价策略和真实资源状态，例如 GPU、CPU、内存、磁盘、队列、软件版本、网络、API 可用性和策略限制。

### Quote Response

Seller 返回 `can_accept`、`needs_negotiation` 或 `reject`。报价必须包括价格、ETA、交付物、限制、风险和数据保留策略。

### Wait Buyer

等待 buyer 选择报价、完成授权、付款/托管和输入传递。Seller 不应在此阶段抢先执行。

### Execution Plan

报价被接受后，Seller 必须生成 list 形式的执行计划，而不是只保留自然语言计划。每一步应包含动作、所需输入、预期输出格式、完成证据、幂等性和可重试边界。

### Provider Execution

Provider 在 Docker-bound anchor 内执行任务，记录 checkpoint、日志、错误和 artifact 生成状态。执行不得超出已授权 manifest；缺少输入、输出格式不明确或权限不足时，应进入 blocked / needs_negotiation，而不是猜测执行。

### Local Supervisor

Provider Docker 或本地 runner 作为监督器，每 5 分钟读取执行计划、本地心跳、进程状态和终态报告。如果 agent 非活跃且没有 success/failed 终态，监督器应从未完成 step 继续拉起，而不是重跑整个任务。监督器也负责校验 step 输入、输出格式、hash、幂等边界和不可重复动作风险。

### Terminal Report

Seller 必须返回 `success` 或 `failed_unrecoverable` 终态报告。报告应包含 artifact manifest、日志摘要、hash、环境摘要、失败/成功证据、输入删除/保留策略和 cleanup receipt。没有结构化终态报告的订单不能被视为已完成。

### Settlement

完成验收、放款、退款、争议或关闭。Provider 返回输入删除/保留策略、容器销毁、日志封存和 cleanup receipt。

## 6. 本地 Dock 架构

### 6.1 Daemon

当前 Dock MVP 运行为本地 Go gateway，管理本地数据、token、approval、resource、task、artifact、wallet、cloud link 和 MCP proxy。

Daemon 是本地可信边界，不应把用户私钥、原始 provider API key 或敏感本地文件交给云端。

### 6.2 Desktop

Desktop 是用户控制台。它提供：

- Buyer/Seller transaction list。
- Buyer 交易阶段界面。
- Seller monitor 和 seller 订单视图。
- Card Market。
- Approval/payment/task/artifact 操作。
- Settings、wallet、PWA、archive。

Desktop 的 UI 应围绕 transaction，而不是 folder 或传统 marketplace 页面。

### 6.3 Discovery Manifest

Dock 启动时写入本地 discovery manifest，并通过 localhost well-known endpoint 暴露相同信息。Manifest 包含 base URL、health URL、MCP command、agent prompt、REST fallback metadata 等。

Discovery manifest 不包含 owner secrets。

### 6.4 Dual-token Auth

Dock 使用 agent token 和 owner token。

Agent token 用于 MCP 和 agent-safe REST fallback。它可以搜索资源、创建草稿、请求 approval、读取状态、resume order 和读取 artifact manifest。

Owner token 用于人类控制面。它是 approval decision、wallet action、credential reveal、provider setting、resource management、敏感 artifact download 和 remote-control execution 的边界。

MCP 自动加载 agent token，但不暴露 approve/pay 权限。

### 6.5 Local Persistence

当前 MVP 使用本地数据目录持久化 order、task、approval、payment、resource、chat、archive 和 artifact metadata。未来网络层可以锚定 hash、receipt、settlement 和 reputation，但本地 Dock 仍然是用户权限边界。

### 6.6 Provider Docker / Execution Anchor

Provider Docker 是卖方侧的执行约束锚点。它把任务运行在受控环境里，但更重要的是约束 agent 必须按交易格式工作：读取已批准 manifest，生成结构化 execution plan，按 step 执行，产出指定格式 artifact，回写 evidence，并在结束时提交 terminal report 和 cleanup receipt。

Docker 本地心跳、进程检查、日志滚动、agent 拉起和 step 状态恢复应留在 provider 本地。云端只接收业务事件：估值、协商、报价接受、输入回执、执行阻塞、终态报告、交付物和清理回执。Provider Docker 不应向云端暴露 provider 内部凭据、原始本地日志或不必要的本地状态。

这个边界让 Dock 可以监督交易，而不是监督每一次内部执行细节；让 agent 可以恢复任务，而不是重复计费、重复提交或重复执行不可幂等动作。

## 7. Capability Economy

Exora Dock 的长期目标是 agent-native capability economy。

### 7.1 Capability

Capability 不是静态 API，而是带策略、计量、证明和执行边界的临时可租用资源。示例包括：

- GPU / CPU / memory / storage。
- VPS 和 sandbox。
- Cloud browser session。
- Dataset 或 paid API。
- Repository/project workspace。
- Specialized agent service。
- Temporary credential reference。

### 7.2 Provider / Short Miner

Provider 或 Short Miner 提供真实能力，存储 hot order objects，响应 signed availability、signed price、receipt 和 proof material，并获得主要收入。

默认经济模型中，完成工作的 provider / Short Miner 获得交易收入的大部分，例如 94%，协议费例如 6%。

### 7.3 Long Miner

Long Miner 维护 shard index、路由、epoch root、availability metadata 和更高信誉索引层。它不需要存储所有 hot object，但负责让 agent 快速找到可信供给。

### 7.4 Auditor Agent

Auditor Agent 验证 signed evidence、Merkle proof、receipt、uptime report、task proof 和 dispute material。它参与 reputation、slashing 和 dispute resolution。

### 7.5 EXORA Token

SOL/USDC 适合作为早期低摩擦支付资产。EXORA 的设计角色是协议安全、staking、miner admission、auditor stake、DAO governance、insurance、buyback 和 burn。

Token、staking、slashing、DAO 和 onchain settlement 是未来网络层能力，不应写成当前本地 MVP 已完成能力。

## 8. 安全与权限模型

Exora Dock 的安全模型围绕一条原则：agent 可以组织协作，但不能替用户越权。

### 8.1 不合并授权

以下动作必须分开：

- 开始整理计划。
- 允许提交 agent requirements 和 remote manifest 进行匹配。
- 选择 seller。
- 批准文件/身份/上下文披露。
- 批准付款或托管。
- 批准真实外部写入或不可逆动作。
- 验收交付并放款。

### 8.2 数据最小化

远端任务单只应包含执行方需要知道的信息。敏感文件、身份、API token、私钥、钱包 secret 和不相关本地上下文不应默认上传。

### 8.3 Quote Integrity

远端报价应绑定 provider card、能力声明、价格、ETA、有效期、时间戳、限制、风险和签名。没有签名或来源不明的报价只能作为参考，不能直接进入交易。

### 8.4 Execution Evidence

执行方应返回 artifact manifest、日志摘要、hash、环境摘要、terminal report 和 cleanup receipt。没有证据的 “已完成” 不应被视为可信完成。

### 8.5 Failure Recovery

每个暂停点都必须有明确等待对象：用户、Buyer Agent、Cloud、Seller Agent、Provider Docker 或本地 supervisor。每个状态都应可恢复、可重试、可取消或进入终态。

### 8.6 Format and State Constraints

关键跨端消息必须有 schema 或等价的结构化格式，包括 task requirements、agent requirements、remote task manifest、provider valuation、execution plan、terminal report、artifact manifest 和 cleanup receipt。

Dock 和 Provider Docker 应在重要节点校验输入/输出格式。缺少必要输入、预算、权限、输出格式、验收标准、hash 或 receipt 时，系统必须停在当前阶段并请求补齐。未通过 schema、sample、hash 或 receipt 校验的结果不能进入验收、放款或最终结算。

## 9. MVP 范围

当前桌面产品应承诺：

- 本地 Dock daemon。
- Desktop Buyer/Seller 控制台。
- Transaction-first order list。
- Buyer plan-first flow。
- Seller API-only monitor 和订单视图。
- Card Market / Cart 作为能力发现入口。
- MCP discovery 和 task handoff。
- REST fallback。
- Approval queue。
- Payment / escrow record。
- Task / work run / artifact metadata。
- Local archive / unread / pinned records。

当前不应承诺：

- 生产级云端匹配。
- 真实链上 escrow。
- 生产 staking/slashing。
- 真实 DAO governance。
- 完整 miner network。
- 完整 reputation ledger。
- 自动上传所有文件。
- Agent 替用户 approve/pay。

## 10. Roadmap

### P0: 本地 Plan-first

- Buyer Agent 判断 `chat / clarify / candidate_task / manual_plan`。
- Candidate task 展示开始确认。
- 生成本地任务需求、agent 需求和 remote manifest。
- 用户审核 remote manifest。
- MCP 与 REST fallback 可驱动任务流。

### P1: 本地模拟匹配

- 使用本地 card / mock seller 进行匹配。
- 生成 quote review。
- 创建 durable order plan。
- 支持 seller selection、approval、payment record 和 task record。

### P2: 真实服务器匹配

- 提交 `agent_requirements` 和 `remote_task_manifest`。
- 最多匹配有限数量 seller。
- Seller 进入 task valuation，返回 quote、needs_negotiation 或 reject。

### P3: 交易前确认

- 用户选择报价。
- Dock 创建 approval request。
- 处理付款/托管记录。
- 输入 manifest 和文件传递受控进行。

### P4: 受控执行与验收

- Provider 生成 execution plan。
- Provider Docker / local supervisor 监督执行。
- 返回 artifact manifest、日志、hash、terminal report。
- Buyer 协助验收、争议或结算。

### P5: 网络经济层

- Short Miner listing。
- Long Miner index。
- Auditor Agent。
- Signed receipt 和 proof。
- Reputation。
- Onchain settlement anchoring。
- EXORA staking、slashing、DAO、buyback/burn。

## 11. 与现有文档的关系

本文件是 Exora Dock 的统一产品与协议总纲。详细规范继续保留在专项文档中：

- `docs/agent-whitepaper.md`: Agent Flow、plan-first、Buyer/Seller 状态机、manifest schema 和 MCP 工具建议。
- `docs/economy/WHITEPAPER.md`: Capability economy、miner、auditor、token、fee、staking、slashing、DAO 和 roadmap。
- `docs/agent-discovery.md`: 本地 discovery manifest、MCP entrypoint、dual-token auth 和 REST fallback。
- `README.md`: 项目介绍、Quick Start、开发和接口索引。

## 12. 结论

Exora Dock 的核心不是创造一个更强的单体 agent，而是让 agent 能够在用户授权边界内组织外部协作。

它把自然语言任务变成交易对象，把外部能力变成可报价资源，把用户权限变成明确 approval，把执行结果变成 artifact/proof/receipt，把交付变成可验收、可结算、可争议、可恢复的状态机。

最终，Exora Dock 要成为 agent 时代的本地交易控制平面：

```text
Human intent
  -> Buyer Agent planning
  -> Seller capability matching
  -> quote and consent
  -> escrow and execution
  -> artifact, proof, verification
  -> settlement and reputation
```

这就是 Exora Dock 要做的内容：让 AI agent 安全地购买、出售、监督和结算外部能力。
