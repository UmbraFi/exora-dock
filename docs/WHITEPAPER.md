# Exora V2 白皮书

**版本：V2 Alpha**
**定位：用户自带 Agent 的轻量交易监督器**

> Agent 负责想和做；Exora 负责醒、限、批、证、续。

## 1. 定位与非目标

Exora Dock 连接用户自己的本地 Agent、交易状态和人类权利。它在交易事件到来时启动或恢复 Agent，向 Agent 暴露权威状态与允许动作，在需要权利时请求人类决定，并形成可复核的交易记录。

Exora 遵循六条原则：

1. **Bring Your Own Agent**：模型、订阅和登录关系属于用户。
2. **Local First**：Agent 会话、工作区、密钥和原始材料留在用户设备。
3. **State Machine First**：业务推进依赖显式状态，而不是聊天文本猜测。
4. **Human Authority**：Agent 只能在用户授予的范围内自动推进。
5. **Minimal Cloud**：Cloud 只承担跨主体一致性、唤醒、确权与证据账本。
6. **Vendor Neutral**：Driver 接口不绑定模型厂商；V2 Alpha 首发 Codex。

Exora 明确不做：

- 不提供或转售模型推理、模型 API、模型 token；
- 不保存用户的模型凭证；
- 不在 Cloud 运行内置审核或仲裁模型；
- 不成为通用 Agent、远程桌面或任意本地命令代理；
- 不发行 EXORA 平台币，不承诺挖矿、质押或 DAO。

## 2. 产品角色与权威边界

### 人类用户

买家和卖家拥有身份、资产、授权策略、证据披露与争议立场。用户可以预先授予自动化权限，也可以随时撤销。

### 用户 Agent

Agent 分析意图、提出计划或报价、执行已授权工作、生成交付物并验证结果。Agent 永远拿不到 Owner Token、钱包私钥、支付 PIN 或仲裁权限。

### Dock Supervisor

Dock 是本地常驻的参考监控器：

- 管理 Agent Driver 与外部会话；
- 为每笔交易、每个角色绑定独立 thread；
- 发放短期、可撤销的 Run Capability；
- 校验工作区、工具、Docker 和本地副作用边界；
- 保存原始会话、执行日志和证据候选；
- 在断线或重启后恢复同一工作。

### Exora Cloud

Cloud 是交易业务状态的权威，负责参与关系、版本化状态、事件排序、WakeJob、HumanRequest、Agent Card 目录、选择性证据披露和人工仲裁。Cloud 不是本地 Agent，也不持有本地模型或钱包凭证。

### 链与执行适配器

Solana/托管合约是资金状态的事实源；Docker 是可选执行适配器。两者都不是 Dock 或 Agent 的使用前提。

## 3. 双状态机

交易状态与 Agent 运行状态严格分离。

### 交易状态

`phase` 表示业务阶段：

```text
intent → plan → offer → authorize → execute → deliver → verify → settle → closed
```

`condition` 表示当前条件：

```text
active | waiting_user | waiting_agent | waiting_counterparty | blocked
disputed | failed | completed | cancelled
```

每次写入携带 `expectedVersion` 和 `idempotencyKey`。Cloud 在一个事务中追加事件、更新投影，并生成 WakeJob 或 HumanRequest。`allowedActions` 由状态机和角色推导，客户端不得自行猜测。

### Agent Run 状态

```text
queued → leased → starting → running
       → waiting_input / waiting_approval / blocked
       → completed / failed / cancelled
```

Agent Run 保存 Driver、交易角色、vendor thread/turn、触发事件、租约 epoch、权限配置和事件游标，但不取代交易状态。

## 4. 自动唤醒、提问与恢复

1. 交易事件提交到 Cloud。
2. Cloud 为目标 Dock 生成 typed WakeJob。
3. Dock 长轮询领取租约，并用 `(transactionId, role)` 查找本地 Agent thread。
4. Codex Driver 启动或精确恢复 app-server thread。
5. Codex 通过交易级 MCP 读取当前状态与允许动作。
6. Agent 提交 proposal、progress、question、offer 或 deliverable。
7. 若需要人类，当前 turn 结束；HumanRequest 进入 Electron/PWA Inbox。
8. 回答形成新事件和新 WakeJob，Dock 恢复同一 thread。

WakeJob 支持 lease、renew、complete、retry、deadline 与 dead-letter。同一幂等键不会启动两个 turn。

V2 Alpha 仅实现 Windows Codex app-server Driver。启动时探测本机版本和协议 schema；Codex 缺失、未登录或协议不兼容时，交易进入 `waiting_agent`，不会回退到 Exora 模型服务或 GUI 键盘模拟。

## 5. 买家与卖家流程

### 买家

买家创建私有 intent。买家 Codex 可补齐范围、预算、隐私、交付和验收条件；之后从公开卖家 Agent Card 目录选择交易对手并发起 offer。买家可以手动操作，Agent 并非使用 Exora 的前置条件。

### 卖家

卖家发布经人工审核的 Agent Card，并将 Card 绑定到本地 Codex、工作区策略和可选执行适配器。收到 offer 后，Cloud 唤醒卖家 Dock；卖家自己的 Codex 读取 manifest，提问、报价、拒绝或提出修改，然后在授权成立后执行和交付。

公开市场只包含卖家 Agent Card。Card 用于发现能力，不是商品购物车，也不暴露本地路径、模型凭证或私有 Agent 配置。Cloud 使用结构校验、确定性规则与人工审核，不调用模型审核。

## 6. 自动化授权与人类权利

AutomationPolicy 支持：

- `manual`：所有业务动作由人确认；
- `guarded`：低风险动作自动，不可逆动作请求人类；
- `autonomous`：用户明确授予的价格、对手方、工具、工作区、期限和副作用范围内自动推进。

Agent 始终只提出动作。Dock 与 Cloud 分别校验本地执行授权和业务授权，再代表授权主体提交审计事件。

永久不可委托：最终争议裁决。
V2 Alpha 暂时不可委托：托管充值、释放和退款。

## 7. 钱包、托管与 Docker

Wallet & Escrow 是独立功能中心：

- 私钥、恢复密码和 PIN 只在本地 Electron/Dock 中处理；
- PWA 只能查看状态或发起人类请求，不能传输 PIN；
- Cloud 记录 payment intent 和证据，链上最终确认决定资金事实；
- 争议打开后自动冻结释放；
- 广播、确认、到账、释放和退款是不同状态。

Docker Execution Center 是卖家可选能力：

- Agent Card 可声明 Docker、GPU、镜像和网络策略；
- 交易 manifest 决定是否使用；
- Supervisor 校验输入、资源、网络和产物边界；
- 不需要 Docker 的 Agent 工作直接在授权工作区完成。

## 8. 证据与人工仲裁

Cloud 默认保存结构化交互：计划版本、报价、问题/回答、proposal、确权、运行摘要、交付物 hash、支付证据和失败记录。完整 Prompt、vendor thread、本地路径、工作区和原始文件默认不上云。

每个 TransactionEvent 包含顺序号、前序 hash、事件 hash、actor、角色、设备、版本、幂等键和签名。Cloud 返回带服务器时间的账本回执。

争议发生时，双方从本地证据候选中选择材料，完成脱敏并显式上传 EvidenceBundle。未披露或已经丢失的原始材料只能以历史 hash 参与判断。

Exora 仲裁员使用独立、受审计、启用 MFA 的运营身份，引用具体证据并填写理由。任何 Agent 输出只能作为非约束建议，不能成为裁决。打开争议立即冻结自动结算。

## 9. 隐私、安全与失败恢复

- PWA 直接读取 Cloud 投影，Dock 离线时仍可查看历史；
- PWA 离线缓存只读并显示 stale，不离线排队确权；
- Web Push 只携带 event ID，不含交易正文；
- Run Capability 绑定交易、角色、动作、工作区、有效期和单次运行；
- Agent 不能调用通用本地命令、Owner API、钱包或仲裁接口；
- Cloud 断线时，只允许可逆的本地分析；不可逆业务状态必须成功提交 Cloud；
- Electron 关闭窗口后保持托盘常驻；显式退出会 checkpoint 并暂停自动化。

## 10. V2 Alpha 范围

V2 Alpha 必须交付：

- Windows Electron 托盘 Dock；
- Codex app-server 探测、启动、精确 thread 恢复与中断；
- 交易状态机、事件账本、WakeJob 与 HumanRequest；
- 交易级 MCP 与短期 capability；
- 公开卖家 Agent Card 目录；
- Inbox、Transactions、Market、Wallet、Execution 与 Nodes/Agents 界面；
- Solana 手动托管与 Docker 可选执行；
- 选择性证据披露和 Exora 人工仲裁；
- Postgres 生产持久化和只用于测试的 MemoryStore。

暂不交付 Claude/ACP Driver、GUI 自动化、自动资金签名、云端 Agent、平台币、矿工网络、质押或 DAO。
