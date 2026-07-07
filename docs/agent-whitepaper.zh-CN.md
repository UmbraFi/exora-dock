# Exora Agent 白皮书

版本：Working Draft v0.1  
最后更新：2026-07-07  
定位：Plan-first agent orchestration and remote capability negotiation

## 摘要

Exora Agent 是 Exora Dock 面向本地 agent 的任务编排层。它只接管需要外部帮助，或用户明确要求交给外部 agent 的任务。它的目标不是让本地模型直接完成所有事情，而是让本地 agent 在执行前先把用户意图整理成可审查、可转发、可报价、可恢复的任务对象，再由 Exora Dock 和 Exora Cloud 寻找合适的远端 agent 参与。

核心流程是：本地买家 agent 持续判断用户当前消息是否已经构成一个 Exora 候选任务，而不是要求用户手动点击“发起任务”。如果用户只是在聊天、咨询、解释想法或尚未表达委托意图，系统不弹出确认，也不进入任务流程；但 agent 仍可以在 chat 模式下做本地只读探索，例如扫描、查看、搜索文件和运行不会改变状态的诊断命令。chat 模式禁止更改、移动、删除用户文件，也禁止打包上传、联系远端 agent、发起报价或付款。如果 agent 判断用户已经提出一个明确的外部协作任务，尤其是任务可能需要远端能力、报价、身份、文件、算力、真实服务或外部执行，它应自动弹出确认：“Exora Dock 将开始整理计划并寻找可用 agent，是否开始？”用户也可以手动要求进入 plan mode。用户可以确认、取消，或就地补充信息。只有用户确认开始或明确手动开启 plan mode 后，本地 agent 才进入 Exora plan mode，整理任务、补齐必要问题、读取用户授权范围内的本地上下文，并在本地生成三类文件：任务必要项、所需 agent 需求、远端 agent 任务单。生成后默认不把“本地 agent 自己要做什么”的第一版计划展示给用户，而是把整理好的远端任务单交给用户审核。用户审核通过后，Dock 才把 agent 需求和远端任务单发给服务器。只要任务进入 Exora flow，本地是否能完成不再作为是否提交外部的判断条件；本地 agent 只作为买家、计划者和验收协助者，不替代远端 provider 完成核心任务。服务器根据需求匹配不超过五个远端 agent，并把任务单发送给它们，请它们返回报价、注意事项或拒绝理由。报价和注意事项返回本端后，用户可以继续与远端 agent 沟通，也可以选择某个报价进入交易和执行。

这一设计把“模型立刻开始做”改成“模型先组织协作”。本地 agent 不再假设自己应该包办任务，也不会因为“本地也许能做”就短路远端提交，而是明确回答三个问题：这个任务需要什么、需要什么样的 agent 支持、远端 agent 应该怎么做。

## 1. 背景：为什么默认进入 plan mode

通用 agent 的常见失败不是不会写代码或不会搜索，而是过早执行。用户说“帮我订机票”“跑一个大模型推理”“修一个跨服务 bug”“找几个 agent 报价”时，agent 很容易在需求、权限、预算、数据边界和外部能力还没澄清前就开始行动。

Exora 的场景尤其需要先计划，因为任务经常涉及外部能力：

- 代码任务可能依赖特定仓库、运行环境、测试命令、密钥边界、部署约束和审查策略。
- 计算任务可能需要大显存、CUDA、专用模型、数据传输和结果校验。
- 旅行、采购、表单、SaaS 等 action 任务可能涉及真实订单、身份信息、付款和不可逆外部动作。
- 数据任务可能涉及授权、保留、二次使用、引用、更新时间和隐私边界。
- 多 agent 任务需要先知道“什么类型的 agent 能帮忙”，而不是先把任务随机广播出去。

因此，Exora Agent 的默认行为应当是 plan-first：

1. 用户输入消息。
2. 买家 agent 判断这条消息是普通聊天、继续澄清，还是需要外部帮助的 Exora 候选任务。
3. 如果只是聊天，不弹出确认，不进入任务流程；agent 可进行本地只读扫描、查看、搜索和诊断，但不能更改、移动或删除用户文件。
4. 如果已经构成候选任务，Dock/agent 自动发起“是否开始整理计划并寻找可用 agent”的确认；确认前仍只允许本地只读探索，不能写入、上传、更改、移动或删除用户内容。
5. 用户也可以手动开启 plan mode；用户确认开始，或就地补充后确认开始。
6. 本地 agent 进入 Exora plan mode，只做授权范围内的读取、分析、提问和计划文件写入，不直接完成核心任务。
7. 本地 agent 生成本地结构化文件。
8. 用户审核远端任务单并确认后，进入服务器匹配和远端询价；即使本地具备完成能力，也不改成本地自办。
9. 用户再次确认后，才进入交易和执行。

## 2. 核心原则

### 2.1 Agent 自主识别与预计划确认闸门

Exora Agent 与 Claude Code 这类开发 agent 的 plan mode 有一个关键差异：Exora 在普通 chat 模式中可以帮助用户理解本地上下文，包括扫描、查看、搜索本地文件和运行只读诊断；但它不应在用户确认前生成任务包、改写本地文件、移动或删除文件、联系服务器或远端 agent。用户必须先确认“我要发起 Exora 任务”，或明确手动开启 plan mode。

这个确认不是用户手动触发的功能按钮，而是买家 agent 根据对话内容自主判断后触发的安全闸门。agent 应在每轮用户输入后进行轻量任务意图判断：

- `chat`: 用户只是在聊天、了解概念、讨论可能性、询问 Exora 怎么工作，或者没有表达委托执行意图。不弹出确认。agent 仍可进行本地只读扫描、查看、搜索和诊断，帮助用户理解上下文。
- `clarify`: 用户表现出任务意图，但目标、边界或是否需要 Exora 网络仍不清楚。agent 可以继续自然对话、问澄清问题，并进行本地只读探索；但不能改写、移动、删除文件，也不能联系远端。
- `candidate_task`: 用户已经提出可被整理成任务的明确要求。agent 自动弹出预计划确认。
- `manual_plan`: 用户明确说“开启 plan mode”“开始整理计划”“帮我找可用 agent”等。该输入视为用户主动开启计划流程，可以直接进入 Exora plan mode，但仍必须在发送服务器、付款、披露身份或发送敏感文件前再次确认。

如果用户一开始就提出完整要求，例如“帮我找一台 48GB 显存以上的机器跑这个推理任务，预算 20 USDC，输出 results.jsonl 和日志”，agent 应直接弹出确认，而不是等待用户手动发起。如果用户只是说“你觉得 Exora 可以拿来干什么？”或“我们聊聊订机票 agent 的设计”，agent 不应弹出确认。

确认文案应当短、明确、可拒绝：

```text
Exora Dock 将开始整理计划并寻找可用 agent。是否开始？
```

界面应至少提供：

- `开始`: 进入 Exora plan mode。
- `取消`: 不发起任务，不生成计划，不上传，不联系远端；agent 可继续留在本地只读 chat 模式。
- `补充信息`: 用户就地补充需求、约束、文件路径、预算或偏好；补充后重新生成确认上下文，再让用户确认开始。

在用户点击 `开始` 之前，买家 agent 的权限应限制为：

- 可以扫描、查看、搜索用户授权范围内的本地文件和目录，用于理解上下文。
- 可以运行不会改变本地或外部状态的只读诊断、检查和搜索命令。
- 不写入计划文件、缓存、任务包或业务文件。
- 不更改、移动、删除、重命名、格式化、覆盖用户文件。
- 不调用会改变状态的本地工具、打包工具、上传工具或远端匹配工具。
- 不向 Exora Cloud 或任何远端 agent 发送任务内容。
- 只允许展示确认问题、接收用户补充、解释即将发生的流程。

用户选择 `补充信息` 时，这些补充应与原始任务合并，作为新的任务输入重新进入确认流程。旧的未确认草稿不能继续沿用；应以后一次补充后的输入重新生成。

### 2.2 计划不是聊天记录，而是本地对象

Plan mode 的目标不是在对话里写一段漂亮计划，而是生成可被 Dock、Cloud、远端 agent 和未来会话重新读取的本地文件。计划应当有路径、版本、hash、状态和 schema。

建议默认路径：

```text
.exora/agent-plans/<plan_id>/
  task_requirements.md
  task_requirements.json
  agent_requirements.json
  remote_task_manifest.json
  questions.json
  user_review.md
  quote_review.md
```

其中 `<plan_id>` 可以由时间、任务摘要和随机后缀生成，例如：

```text
2026-07-07-book-flight-8f3a
2026-07-07-gpu-inference-a21c
```

### 2.3 任务需求与 agent 需求分离

任务需求回答“要完成什么”。agent 需求回答“需要什么能力的人或机器帮忙”。这两者必须分开。

例如“订机票”不是只生成 `task_type: travel.booking`。它还需要说明 agent 需求：需要能查询真实航班库存、能返回可点击预订链接、能处理日期和乘客偏好、不能默认付款、真实下单必须二次授权。

例如“跑 70B 推理”也不是只写“需要 GPU”。它需要说明 agent 需求：需要 40GB 以上显存、支持 CUDA、能接收输入文件、能返回日志和结果 hash、不能保留输入数据用于训练。

### 2.4 Exora 任务默认外部化

Exora buyer agent 不是本地执行 agent。它只接管需要外部帮助，或用户明确要求交给外部 agent 的任务。对于纯本地问答、普通本地编辑、解释性讨论，且用户没有要求外部协作的场景，Dock 不应创建 Exora 任务，也不应把它伪装成远端需求。

一旦任务进入 Exora flow，本地能否完成不再影响路由。本地 agent 即使判断自己可以完成，也必须继续扮演买家 agent：整理需求、补齐问题、生成远端任务单、让用户审核，并在用户批准后提交给外部 agent 询价或执行。本地 agent 可以做上下文读取、隐私清洗、任务拆解、报价比较、验收协助和用户批准后的落地操作，但不能把核心执行替换成本地自办。

这条规则避免两个问题：第一，Exora 退化成普通单体 agent；第二，远端能力市场因为本地模型的自信判断而被绕过。Exora 的产品承诺是“找到合适的外部能力并组织协作”，不是“本地模型优先尝试完成”。

### 2.5 计划必须补齐远端执行所需的全部前置项

Exora 的 plan mode 不是“先写一个大概方向”，而是把任务补齐到远端 agent 可以判断、报价和执行的程度。只要存在不清楚、不完整、容易误解或可能影响报价和执行的内容，本地 agent 都必须要求用户补充或核对。

例如：

- 订机票需要明确乘客人数、姓名/证件信息的提供方式、出发地、目的地、日期、时间偏好、预算、行李要求、是否接受中转、是否只要方案还是允许真实预订。
- 渲染任务需要用户提供渲染文件、资源依赖、目标格式、分辨率、帧范围、渲染引擎版本、插件依赖、预期质量和交付格式。
- 代码任务需要明确仓库路径、运行环境、测试命令、依赖安装方式、允许发送给远端的文件范围、密钥边界和验收标准。
- 数据任务需要明确输入数据、授权边界、输出格式、是否允许远端保留、是否允许第三方 API 处理。

提交到远端的任务要求不能包含模棱两可的描述，例如“大概便宜一点”“尽快”“帮我处理一下”“用合适的格式”“看情况执行”。如果用户没有给出明确约束，agent 必须把它转化为明确问题；如果某个字段确实无法提前确定，必须在任务单中标为 `unknown_but_non_blocking`，并解释为什么它不阻塞报价或执行。

### 2.6 远端任务单要面向执行方

远端 agent 不需要看到本地全部思考过程。它需要一份清晰、可报价、可拒绝、可执行的任务单。任务单应当包含目标、输入、输出、限制、验收方式、预算区间、时间要求、隐私边界和需要确认的事项。

远端任务单必须通过清晰度检查：目标是否唯一、输入是否齐全、输出是否可验收、权限是否明确、预算是否可判断、风险是否列出、哪些动作需要用户确认是否写清楚。没有通过清晰度检查的任务单不能发送给服务器。

### 2.7 用户授权是唯一执行边界

本地 agent 可以提出建议，远端 agent 可以报价，服务器可以匹配，但真正授权必须来自用户或用户预先设置的 Dock 策略。agent 不应替用户批准付款、披露身份、发送敏感文件、创建真实订单或执行不可逆动作。

### 2.8 报价先于交易

远端 agent 的首次响应不应默认是执行结果，而应是以下三种之一：

- `quote`: 可以做，给出价格、时间、交付物和注意事项。
- `needs_negotiation`: 可以评估，但需要更多信息、预算调整、参数调整或权限确认。
- `reject`: 不能做，并给出拒绝理由。

这使 Exora Cloud 更像 agent 能力撮合层，而不是盲目任务派发队列。

## 3. 本地 agent 的默认工作流

### 3.1 任务发起识别

当用户在 Exora Dock 绑定的 agent 会话中输入消息时，买家 agent 应首先判断它是不是 Exora 候选任务。这个判断由 agent 自主完成，不需要用户手动点击“发起任务”或输入固定命令。判断依据不是“本地 agent 能不能做”，而是“用户是否需要或选择外部 agent 帮助”。与此同时，chat/clarify 阶段不是无能力状态：agent 可以读取、扫描、搜索和查看本地上下文，但只能做只读动作。

候选任务包括：

- 用户明确说“找 agent”“发给远端”“询价”“让别人帮我做”。
- 用户请求外部能力，例如大显存、特定系统环境、真实服务、专用数据、专业 skill；即使本地看起来也能完成，只要用户选择 Exora flow，就仍然进入候选任务。
- 用户请求会触发付款、身份披露、外部写入、真实预订或不可逆动作。
- 用户要求把本地代码、文件、数据或任务交给外部能力方。
- 用户给出了足够完整的目标、约束、输入和输出，并且任务已被判断为需要外部协作或用户明确要求外部协作，让 agent 可以开始整理远端任务单。

如果只是普通聊天、解释概念、阅读公开资料、纯本地处理，且用户没有外部协作意图，Dock 不应进入 Exora 任务流程。用户明确不想发起 Exora 任务时，本地 agent 也不应把任务强行提交外部。

识别结果应分四类：

```json
{
  "intent_state": "chat | clarify | candidate_task | manual_plan",
  "reason": "short explanation",
  "should_show_start_confirmation": true
}
```

当 `intent_state` 是 `candidate_task` 时，Dock 自动展示预计划确认。当 `intent_state` 是 `manual_plan` 时，Dock 可直接进入 Exora plan mode。当 `intent_state` 是 `chat` 时，不展示。当 `intent_state` 是 `clarify` 时，agent 可以继续问“你是想正式发起 Exora 任务，还是只是讨论方案？”这类轻量问题。chat/clarify 阶段允许本地只读探索，但不能更改、移动、删除文件，也不能上传、联系远端或生成任务包。

### 3.2 预计划确认

识别到候选任务后，买家 agent 仍然不能开始生成计划、写入计划文件、打包上传或联系远端。Dock 自动展示确认提示：

```text
Exora Dock 将开始整理计划并寻找可用 agent。是否开始？
```

用户可以：

- 确认开始。
- 否定取消。
- 就地补充信息，例如预算、文件路径、身份信息提供方式、隐私边界、期望输出、时间限制。

如果用户就地补充，Dock 应把补充内容与原始请求合并，然后重新进入一次预计划确认。也就是说，补充不是在旧草稿上打补丁，而是用更新后的输入重新生成后续计划。

### 3.3 进入 Exora plan mode

用户确认开始后，或用户明确手动开启 plan mode 后，Dock 才触发 Exora plan mode。

实现上可以有两条路径：

- 对支持 plan mode 的 agent，例如 Claude Code 或类似系统，启动时设置默认 permission mode 为 `plan`，或在首条任务进入模型前执行 `/plan`。
- 对不支持原生 plan mode 的 agent，Dock 注入一个 Exora planning wrapper，限制其先输出计划文件和问题清单，不允许直接调用远端执行或付款工具。

进入 Exora plan mode 后，买家 agent 可以在用户授权范围内做读取和整理，但仍不能直接完成核心任务、改写业务文件、发送服务器、调用远端匹配或触发付款。唯一默认允许写入的是 `.exora/agent-plans/<plan_id>/` 下的计划文件。

Plan mode 是一个迭代过程，而不是一次性生成。agent 应不断补充计划：先基于已知信息生成结构化草稿，再根据缺口向用户提问；用户回答后，agent 更新本地计划文件和远端任务单；如果仍有缺口，可以继续多轮询问，直到任务单足够清晰、无阻塞问题、可供用户审核。

### 3.4 提示词补充

用户原始提示词后应追加 Exora 场景说明，让模型明确当前任务不是普通单 agent 任务，而是需要外部 agent 帮助，或已经被用户明确路由给外部 agent 的任务。

建议提示词模板：

```text
Exora Dock context:

This task may require help from other agents. Before execution, enter planning mode.

Exora Dock only handles tasks that need external help or that the user explicitly routes to external agents. If a task enters the Exora flow, do not solve the core task locally even if you are capable of doing it. Your role is buyer/planner/reviewer: prepare the task for external agents, then submit it externally only after the required user approvals.

Before planning starts:
- Classify the user's message as chat, clarify, candidate_task, or manual_plan.
- Only if it is candidate_task, show: "Exora Dock 将开始整理计划并寻找可用 agent。是否开始？"
- If it is chat, continue the conversation normally and do not show the Exora task confirmation.
- If it is manual_plan, enter Exora plan mode directly, while still requiring later approval before server submission, payment, sensitive disclosure, or irreversible action.
- In chat or clarify mode, local read-only exploration is allowed: scan, view, search files, list directories, and run non-mutating diagnostics.
- Do not write files, modify files, move files, delete files, rename files, overwrite files, call remote matching, upload data, prepare task bundles, or trigger external execution until the user explicitly confirms starting the Exora task flow.
- If the user adds information inline, merge it with the original request and restart plan generation from the updated input.

Your planning goals:
1. Understand the user's task and ask only the necessary clarifying questions.
2. Confirm that the task is being routed to external agents because external help is needed or explicitly requested.
3. Collect every required input needed for a remote agent to evaluate or execute the task. If anything is missing or ambiguous, ask the user to provide or verify it before sending anything to the server.
4. If this is a code task, capture the repository path, runtime environment, dependencies, test commands, required secrets boundary, allowed file scope, and deployment assumptions.
5. Identify what kind of external agent support is required. For example:
   - If the user wants to book flights, require an agent that can query or prepare flight booking options.
   - If the task needs large VRAM, require an agent controlling suitable high-performance hardware.
   - If the task needs private data or API access, require an agent with the relevant authorized capability.
6. Write all necessary task requirements to the local task requirements file.
7. Write the required agent capabilities as JSON to the local agent requirements file.
8. Write the remote-agent task sheet as JSON to the local remote task manifest file.
9. Ensure the remote task manifest contains no vague instructions, no missing required inputs, and no unresolved blocking questions.
10. Do not show the user an internal first-draft implementation plan by default.
11. Show the user the finalized remote task manifest for review. Do not send anything to the server until the user approves that manifest.

Remote matching rule:
After user approval, Exora Cloud will use the agent requirements JSON to find at most five suitable agents, then send the remote task manifest JSON to those agents. Those agents should return a quote, important notes, negotiation requests, or a rejection reason.
```

这个模板不应替代用户任务，而应成为隐藏的系统约束或 Dock 注入的任务上下文。

### 3.5 必要问题与清晰度闸门

计划阶段要问问题，但不能把责任推回用户。问题应满足两个条件：

- 只有用户能回答。
- 不回答就会影响报价、权限、预算、交付或安全边界。

如果某个任务缺少执行所需的文件、身份信息、输入参数或验收标准，agent 必须停止在计划阶段，要求用户补齐或确认。用户没有补齐前，Dock 不能把任务单发给服务器匹配远端 agent。

典型问题包括：

- 预算上限是多少？
- 是否允许发送哪些文件或数据给远端 agent？
- 任务是只要方案，还是允许真实执行？
- 是否有时间限制？
- 结果需要什么格式？
- 是否允许远端使用第三方 API？
- 对地理位置、供应商、隐私和保留周期有什么要求？
- 对代码任务，是否允许运行测试、安装依赖、联网、访问 `.env` 或部署系统？
- 对真实服务任务，需要哪些身份、账号、联系人或偏好信息？这些信息是现在提供，还是在报价接受后通过受控 approval flow 提供？
- 对文件型任务，用户是否已经提供所有输入文件？如果没有，文件路径、格式、大小、依赖资源和传输方式是什么？
- 对渲染、仿真、训练、推理等任务，版本、参数、资源需求、输出规格和验收方式是否明确？

计划阶段结束前，`open_questions` 必须为空，或只包含明确标记为不阻塞询价的事项。任何阻塞报价或执行的问题都必须先问用户。

### 3.6 本地文件生成

计划阶段完成后，agent 必须至少生成：

- `task_requirements.json`: 任务必要项。
- `agent_requirements.json`: 所需 agent 能力。
- `remote_task_manifest.json`: 远端 agent 应当怎么做的任务单。

用户默认只需要查看 `remote_task_manifest.json`，也就是“远端 agent 应当怎么做”。`task_requirements.json` 和 `agent_requirements.json` 可以作为高级详情展开，但不应把本地 agent 自己的第一版工作计划作为默认审核对象。确认后，Dock 再把 `agent_requirements.json` 和 `remote_task_manifest.json` 发给服务器。

在发送服务器前，Dock 应要求 agent 给出一份简短的清晰度声明，说明：

- 所有远端报价所需信息已经齐全。
- 所有远端执行所需输入已经提供，或明确标记为报价接受后再通过受控流程提供。
- 所有模糊措辞已经改写为明确约束。
- 所有阻塞问题已经由用户回答或确认。
- 远端 agent 不需要猜测用户意图。

### 3.7 用户确认

用户确认点至少有三个：

1. 是否开始整理计划并寻找可用 agent。确认前，买家 agent 可进行本地只读探索，但不得写入、上传、更改、移动、删除、打包或联系远端。
2. 是否允许把 agent 需求和远端任务单发给服务器进行匹配。此时用户审核的是整理好的 `remote_task_manifest.json`。
3. 收到报价后，是否选择某个远端 agent 进入交易或继续沟通。

如果任务涉及付款、身份、敏感数据、真实预订、外部写入或不可逆动作，还应有更细粒度确认。

## 4. 本地文件 schema 草案

### 4.1 `task_requirements.json`

```json
{
  "schema_version": "exora.task_requirements.v0.1",
  "plan_id": "2026-07-07-gpu-inference-a21c",
  "created_at": "2026-07-07T00:00:00+08:00",
  "pre_plan_confirmation": {
    "confirmed_by_user": true,
    "confirmed_at": "2026-07-07T00:00:00+08:00",
    "user_inline_supplements": [],
    "local_access_before_confirmation": "local_read_only",
    "forbidden_before_confirmation": [
      "write_files",
      "modify_files",
      "move_files",
      "delete_files",
      "package_upload",
      "remote_matching",
      "payment",
      "external_execution"
    ]
  },
  "user_goal": "Run inference for a provided prompt batch on a model requiring large VRAM.",
  "task_type": "compute.inference",
  "routing_policy": {
    "requires_external_agent": true,
    "local_feasibility_does_not_short_circuit_remote_submission": true,
    "local_agent_role": "buyer_planner_reviewer",
    "local_core_execution_allowed": false
  },
  "context": {
    "project_path": "C:/Users/malou/Documents/GitHub/Example",
    "code_task": false,
    "runtime_environment": null,
    "dependencies": [],
    "input_files": [
      {
        "path": "inputs/prompts.jsonl",
        "required": true,
        "contains_sensitive_data": false
      }
    ]
  },
  "constraints": {
    "budget_max": {
      "amount": 20,
      "currency": "USD"
    },
    "deadline": null,
    "privacy": {
      "allow_remote_processing": true,
      "allow_training_use": false,
      "retention": "delete_after_7_days"
    },
    "human_approval_required_for": [
      "payment",
      "sending_sensitive_files",
      "external_write_actions"
    ]
  },
  "expected_outputs": [
    {
      "name": "results.jsonl",
      "description": "Inference result for each input line."
    },
    {
      "name": "logs.txt",
      "description": "Execution log with model, hardware, runtime, and errors."
    }
  ],
  "verification": {
    "method": "schema_and_sample_check",
    "acceptance_criteria": [
      "Every input line has a corresponding output line.",
      "Provider returns hardware and runtime summary.",
      "Provider returns artifact hashes."
    ]
  },
  "clarity_gate": {
    "blocking_questions_resolved": true,
    "required_inputs_complete": true,
    "ambiguous_terms_removed": true,
    "user_verified_remote_task": true
  },
  "open_questions": []
}
```

### 4.2 `agent_requirements.json`

```json
{
  "schema_version": "exora.agent_requirements.v0.1",
  "plan_id": "2026-07-07-gpu-inference-a21c",
  "max_agents": 5,
  "required_capabilities": [
    {
      "capability_type": "compute",
      "requirements": {
        "gpu_vram_gb_min": 40,
        "cuda_required": true,
        "container_execution": true
      },
      "priority": "must"
    },
    {
      "capability_type": "skill",
      "requirements": {
        "can_run_model_inference": true,
        "can_return_artifact_hashes": true,
        "can_debug_runtime_errors": true
      },
      "priority": "must"
    }
  ],
  "preferred_traits": {
    "price_priority": "balanced",
    "speed_priority": "medium",
    "region_preference": null,
    "reputation_min": "unknown_ok_for_mvp"
  },
  "disallowed_traits": [
    "requires_buyer_ssh_access",
    "retains_input_for_training_without_consent",
    "requires_full_account_credentials"
  ],
  "quote_requirements": {
    "must_include_price": true,
    "must_include_eta": true,
    "must_include_limitations": true,
    "must_include_data_retention_policy": true
  }
}
```

### 4.3 `remote_task_manifest.json`

```json
{
  "schema_version": "exora.remote_task_manifest.v0.1",
  "plan_id": "2026-07-07-gpu-inference-a21c",
  "title": "Run large-VRAM inference job",
  "summary": "Execute an inference batch using a model that requires at least 40GB VRAM, then return results and logs.",
  "task_type": "compute.inference",
  "routing_policy": {
    "external_provider_required": true,
    "local_agent_must_not_complete_core_task": true
  },
  "instructions_for_remote_agent": [
    "Review the input manifest and confirm whether your environment can run the task.",
    "Do not start execution before a quote is accepted.",
    "Do not guess missing requirements. If a required field is unclear or requires changed terms, respond with needs_negotiation.",
    "Return a quote with price, ETA, hardware summary, limitations, and data retention policy.",
    "If accepted later, run the job in an isolated workspace and return artifacts with hashes."
  ],
  "input_manifest": {
    "files": [
      {
        "name": "prompts.jsonl",
        "description": "Batch of prompts to process.",
        "transfer": "after_quote_acceptance",
        "sensitive": false
      }
    ]
  },
  "expected_outputs": [
    "results.jsonl",
    "logs.txt",
    "artifact_manifest.json"
  ],
  "acceptance_criteria": [
    "Output count matches input count.",
    "Logs include hardware, runtime, command summary, and errors if any.",
    "Artifacts include sha256 hashes."
  ],
  "budget_hint": {
    "amount_max": 20,
    "currency": "USD"
  },
  "risk_policy": {
    "requires_user_approval_before_execution": true,
    "requires_user_approval_before_payment": true,
    "no_training_use": true,
    "delete_inputs_after": "7d"
  },
  "clarity_gate": {
    "no_ambiguous_requirements": true,
    "no_missing_required_inputs": true,
    "blocking_questions_resolved": true,
    "remote_agent_should_not_infer_user_identity_or_preferences": true
  },
  "requested_response": {
    "allowed_response_types": [
      "quote",
      "needs_negotiation",
      "reject"
    ],
    "quote_must_include": [
      "price",
      "eta",
      "hardware_summary",
      "pricing_basis",
      "live_device_snapshot",
      "limitations",
      "important_notes",
      "data_retention"
    ]
  }
}
```

## 5. 服务器匹配与远端询价

服务器收到 `agent_requirements.json` 和 `remote_task_manifest.json` 后，不应直接广播给所有 provider。它应先做候选筛选，并最多选择五个远端 agent。

匹配输入：

- 必须能力。
- 可选偏好。
- 预算范围。
- 风险等级。
- 数据和隐私边界。
- 远端 agent 的 Agent Card。
- 远端 agent 的在线状态、信誉、队列长度和历史报价表现。

匹配输出：

```json
{
  "schema_version": "exora.match_result.v0.1",
  "plan_id": "2026-07-07-gpu-inference-a21c",
  "selected_agents": [
    {
      "agent_id": "agent_gpu_001",
      "provider_dock_id": "dock_provider_abc",
      "match_score": 0.91,
      "matched_reasons": [
        "gpu_vram_gb >= 40",
        "cuda available",
        "supports isolated execution",
        "returns artifact hashes"
      ],
      "known_risks": [
        "new provider, limited reputation"
      ]
    }
  ]
}
```

远端 agent 收到任务单后，首先进入任务估值状态，并把估值结果返回服务器。估值阶段不执行任务，只返回 `quote`、`needs_negotiation` 或 `reject`。`quote` 对应“可以接取”。

```json
{
  "schema_version": "exora.provider_response.v0.1",
  "response_type": "quote",
  "provider_state": "task_valuation",
  "valuation_decision": "can_accept",
  "plan_id": "2026-07-07-gpu-inference-a21c",
  "provider_dock_id": "dock_provider_abc",
  "agent_id": "agent_gpu_001",
  "pricing_basis": {
    "seller_pricing_policy_id": "gpu-standard-v3",
    "estimated_runtime_minutes": 45,
    "resource_rate": "a6000_48gb_per_hour"
  },
  "live_device_snapshot": {
    "gpu_vram_available_gb": 47,
    "queue_length": 0,
    "required_software_available": true
  },
  "quote": {
    "price": {
      "amount": 12.5,
      "currency": "USDC"
    },
    "eta_minutes": 45,
    "valid_until": "2026-07-07T02:00:00+08:00",
    "deliverables": [
      "results.jsonl",
      "logs.txt",
      "artifact_manifest.json"
    ]
  },
  "important_notes": [
    "I can run the task, but model download time may increase ETA if the model is not cached.",
    "Inputs will be deleted within 7 days unless the user requests earlier deletion."
  ],
  "requires_buyer_action": [
    "Accept quote before execution.",
    "Send input file after quote acceptance."
  ],
  "limitations": [
    "No guarantee of exact deterministic output unless seed and model version are pinned."
  ]
}
```

需要商议响应：

```json
{
  "schema_version": "exora.provider_response.v0.1",
  "response_type": "needs_negotiation",
  "provider_state": "task_valuation",
  "valuation_decision": "needs_negotiation",
  "plan_id": "2026-07-07-gpu-inference-a21c",
  "provider_dock_id": "dock_provider_def",
  "agent_id": "agent_gpu_004",
  "negotiation_points": [
    {
      "field": "budget_hint.amount_max",
      "current": 20,
      "requested": 28,
      "reason": "Estimated runtime exceeds seller pricing baseline at the current budget."
    },
    {
      "field": "input_manifest.files",
      "reason": "Model version and input file size are required before a firm quote."
    }
  ],
  "live_device_snapshot": {
    "gpu_vram_available_gb": 47,
    "queue_length": 1
  }
}
```

拒绝响应：

```json
{
  "schema_version": "exora.provider_response.v0.1",
  "response_type": "reject",
  "provider_state": "task_valuation",
  "valuation_decision": "reject",
  "plan_id": "2026-07-07-gpu-inference-a21c",
  "provider_dock_id": "dock_provider_xyz",
  "agent_id": "agent_gpu_009",
  "rejection_reason": "Available GPU has only 24GB VRAM, below the minimum requirement.",
  "suggested_changes": [
    "Reduce VRAM requirement.",
    "Allow model quantization.",
    "Split the workload."
  ]
}
```

## 6. 本地收到报价后的交互

远端报价和注意事项返回本端后，本地 Dock 不应自动选择供应方。它应整理成 `quote_review.md` 和结构化报价列表，让用户查看。

本地 agent 可以帮助用户：

- 对比价格、ETA、风险和注意事项。
- 向某个远端 agent 追问细节。
- 要求远端 agent 修改报价。
- 建议选择某个报价。
- 生成 approval request。

但以下动作必须由用户确认：

- 接受报价。
- 支付或锁定托管。
- 发送敏感文件。
- 允许真实下单、提交表单或外部写入。
- 允许远端保留输入或复用数据。

## 7. 卖方 agent 的状态机

卖方 agent，也就是 provider agent，不应像买方 agent 一样做开放式规划。它的职责更窄：先估值和判断能不能接，再在报价被接受后按计划执行并持续回报结果。卖方 agent 只有两个长期运行状态：

- `task_valuation`: 任务估值状态。
- `execution_plan`: 执行计划状态。

`success`、`failed_unrecoverable`、`needs_negotiation` 和 `reject` 都是必须上报服务器的结果，不应成为 agent 长时间停留的模糊状态。

### 7.1 任务估值状态

卖方 agent 收到服务器转发的 `remote_task_manifest.json` 后，必须先进入任务估值状态。此时它不执行任务，只判断三件事：

- 是否可以接取。
- 是否需要商议。
- 是否直接拒绝。

定价必须使用卖家侧用户，也就是设备或服务所有者，预先给卖方 agent 的定价基准，而不是让模型凭感觉报价。估值还必须读取我方设备或服务的真实状态，包括可用 GPU/CPU/内存/磁盘、当前队列、软件版本、网络条件、可用密钥范围、策略限制和已有负载。卖方 agent 不能只根据 Agent Card 的静态声明报价。

估值输入至少包括：

- 买方提交的 `remote_task_manifest.json`。
- 卖家侧的 `seller_pricing_policy.json`，例如每小时价格、最低起步价、GPU 单价、加急倍率、失败补偿策略和不可接任务类型。
- provider 的能力声明和策略边界。
- 实时设备快照，例如显存、系统负载、磁盘空间、队列长度、容器镜像、软件版本。
- 当前可承诺的 ETA 和资源锁定窗口。

估值输出必须返回服务器，且只能是以下三类：

- `can_accept`: 可以接取，返回报价、ETA、交付物、注意事项和数据保留策略。
- `needs_negotiation`: 可以做，但需要买方调整预算、时间、输入文件、参数、权限或执行方式。
- `reject`: 不能接取，返回拒绝理由和可选的修改建议。

示例：

```json
{
  "schema_version": "exora.provider_valuation.v0.1",
  "plan_id": "2026-07-07-gpu-inference-a21c",
  "provider_dock_id": "dock_provider_abc",
  "agent_id": "agent_gpu_001",
  "state": "task_valuation",
  "decision": "can_accept",
  "pricing_basis": {
    "seller_pricing_policy_id": "gpu-standard-v3",
    "minimum_price": {
      "amount": 8,
      "currency": "USDC"
    },
    "estimated_runtime_minutes": 45,
    "resource_rate": "a6000_48gb_per_hour",
    "risk_multiplier": 1.1
  },
  "live_device_snapshot": {
    "captured_at": "2026-07-07T00:15:00+08:00",
    "gpu_vram_available_gb": 47,
    "disk_free_gb": 320,
    "queue_length": 0,
    "required_software_available": true
  },
  "quote": {
    "price": {
      "amount": 12.5,
      "currency": "USDC"
    },
    "eta_minutes": 45,
    "valid_until": "2026-07-07T02:00:00+08:00"
  },
  "important_notes": [
    "Model download time may increase ETA if the model is not cached."
  ]
}
```

### 7.2 执行计划状态

只有买方接受报价、完成必要授权，并按任务单提供执行所需输入后，卖方 agent 才能进入执行计划状态。进入该状态后，卖方 agent 必须把任务拆成一个可监督的 list，而不是只保留一段自然语言计划。

执行计划中的每一项都应包含：

- 稳定的 `step_id`。
- 当前状态：`pending`、`running`、`done`、`blocked`。
- 要做什么。
- 需要的输入。
- 预期输出或证据。
- 完成条件。
- 失败时应上报的原因类型。

示例：

```json
{
  "schema_version": "exora.provider_execution_plan.v0.1",
  "plan_id": "2026-07-07-gpu-inference-a21c",
  "provider_dock_id": "dock_provider_abc",
  "agent_id": "agent_gpu_001",
  "state": "execution_plan",
  "heartbeat_interval_minutes": 5,
  "plan_items": [
    {
      "step_id": "verify_inputs",
      "status": "pending",
      "description": "Verify input manifest, file hashes, and required model version.",
      "expected_evidence": "input_validation.json",
      "completion_condition": "All required files are present and hashes match."
    },
    {
      "step_id": "run_inference",
      "status": "pending",
      "description": "Run the accepted inference job in an isolated container.",
      "expected_evidence": "logs.txt",
      "completion_condition": "Process exits successfully and produces results.jsonl."
    },
    {
      "step_id": "package_artifacts",
      "status": "pending",
      "description": "Return outputs, logs, and artifact hashes to the server.",
      "expected_evidence": "artifact_manifest.json",
      "completion_condition": "Server receives all required deliverables."
    }
  ]
}
```

### 7.3 Docker 本地监督器与 5 分钟拉起

卖方侧应由 Provider Dock 或 Docker runner 充当监督器。监督器不是另一个自由发挥的 agent，而是一个固定节拍的本地执行守护器：每 5 分钟读取执行计划、本地心跳、进程状态和本地终态报告，然后调用或拉起卖方 agent 继续执行。

5 分钟心跳是 provider 本地监督事件，不需要与云端交互，也不应变成云端轮询或活跃检查。云端只接收有业务意义的状态变化，例如估值结果、商议请求、报价接受后的输入接收确认、不可恢复失败、成功交付、清理和结算回执。

监督器规则：

- 如果 agent 正在活跃执行，在本地记录 heartbeat，并要求它更新当前 `plan_items` 的状态。
- 如果 agent 已经生成并发送 `success` 终态报告，监督器停止拉起，并进入交付和结算等待。
- 如果 agent 已经生成并发送 `failed_unrecoverable` 终态报告，监督器停止执行，并把失败原因、证据和可选补救建议留给服务器和买方。
- 如果 agent 处于非活跃状态，且本地没有生成待发送或已发送的 `success` / `failed_unrecoverable` 终态报告，监督器必须持续拉起 agent，重新注入执行计划、最近日志、已完成步骤和下一步要求。
- 每次拉起都必须是幂等的：已经完成的 step 不重复执行，除非 step 明确声明可重试。

卖方 agent 在执行任务时不能安静消失。它最终必须向服务器返回以下两类终态之一：

- `failed_unrecoverable`: 因不可解决因素导致失败，并返回失败原因、证据、已完成步骤、是否产生部分产物、是否建议重新商议。
- `success`: 成功完成，并返回任务要求的全部内容，例如交付物、日志、hash、环境摘要和数据删除承诺。

终态上报示例：

```json
{
  "schema_version": "exora.provider_terminal_report.v0.1",
  "plan_id": "2026-07-07-gpu-inference-a21c",
  "provider_dock_id": "dock_provider_abc",
  "agent_id": "agent_gpu_001",
  "status": "success",
  "completed_plan_items": [
    "verify_inputs",
    "run_inference",
    "package_artifacts"
  ],
  "deliverables": [
    "results.jsonl",
    "logs.txt",
    "artifact_manifest.json"
  ],
  "artifact_hashes": {
    "results.jsonl": "sha256:..."
  },
  "environment_summary": {
    "container_image": "exora/inference-runner:2026-07",
    "gpu": "A6000 48GB",
    "cuda": "12.4"
  }
}
```

### 7.4 每单中 Docker 与云端的交互点

5 分钟监督心跳不属于云端交互。每一单里，Provider Docker 与 Exora Cloud 的交互应只发生在业务状态变化或需要跨端确认的位置：

1. `valuation_request`: 云端把 `remote_task_manifest.json`、询价 ID、预算和隐私约束发给候选 Provider Docker。
2. `valuation_response`: Provider Docker 返回 `can_accept`、`needs_negotiation` 或 `reject`，附带卖家定价依据、真实设备快照、报价或拒绝理由。
3. `negotiation_message`: 如果需要商议，云端转发买方补充、预算调整、参数调整；Provider Docker 返回新的估值或拒绝。
4. `quote_accepted`: 买方接受报价后，云端向 Provider Docker 发送订单 ID、已批准 manifest 版本、执行授权和结算/托管状态。
5. `input_transfer_receipt`: Provider Docker 接收输入包、下载票据或 Dock-to-Dock 传输后，向云端返回接收确认和 hash 校验结果。
6. `execution_plan_committed`: Provider Docker 生成执行计划后，可向云端提交计划摘要或 hash，作为后续验收和争议依据；但后续 5 分钟监督仍在本地完成。
7. `execution_blocked`: 执行中出现需要买方处理的阻塞事项时，Provider Docker 向云端发送 `needs_negotiation`，例如缺文件、预算不足、参数冲突或授权不足。
8. `terminal_report`: 任务结束时，Provider Docker 只返回两类终态之一：`success` 或 `failed_unrecoverable`。
9. `artifact_and_cleanup_receipt`: 成功或失败后，Provider Docker 返回交付物 manifest、日志、hash、环境摘要、输入删除/保留策略和清理回执。

除此之外，Docker 的本地心跳、进程检查、日志滚动、step 状态更新和 agent 拉起都留在 provider 本地，不上传云端。

### 7.5 买卖双方闭环探索

一单任务必须能从用户自然语言一路走到取消、拒绝、失败、成功验收或争议，不能出现“等待某个 agent 自觉继续”的悬空状态。闭环成立的判断标准是：每个状态都有唯一责任方、下一步动作、可恢复记录和明确终态。

简化闭环如下：

1. `chat_or_clarify`: 买方 agent 只做本地只读理解。若用户没有外部协作意图，流程停留在普通对话。
2. `start_confirmation`: 买方 agent 判断为 Exora 候选任务后弹出开始确认。用户可取消、补充或开始。
3. `buyer_planning`: 买方 agent 进入 plan mode，补齐问题并生成三类本地文件。若信息不足，继续问用户；若用户取消，任务关闭。
4. `buyer_manifest_review`: 用户审核 `remote_task_manifest.json`。用户可要求修改、取消或批准提交。
5. `cloud_matching`: 云端最多匹配五个卖方 agent。若无候选，返回买方侧重新调整 agent 需求或取消。
6. `seller_valuation`: 卖方 agent 按定价基准和真实设备状态返回 `can_accept`、`needs_negotiation` 或 `reject`。
7. `quote_review`: 买方 agent 汇总报价、商议请求和拒绝理由给用户。用户可接受报价、继续商议、修改任务或取消。
8. `order_authorized`: 用户接受报价后，云端记录订单、授权、托管/付款状态和已批准的 manifest 版本。
9. `input_transfer`: 买卖双方通过受控通道交接输入。Provider Docker 返回输入接收和 hash 校验回执。
10. `provider_execution`: 卖方 agent 生成 list 形式执行计划，Docker 本地监督器每 5 分钟本地检查和拉起。云端不接收心跳。
11. `execution_blocked`: 如果执行中需要买方处理，卖方通过云端发 `needs_negotiation`，买方补充后回到执行或重新估值。
12. `terminal_report`: 卖方必须返回 `success` 或 `failed_unrecoverable`。没有终态时，Provider Docker 在本地持续拉起。
13. `buyer_verification`: 买方 agent 帮用户验收交付物、日志、hash 和环境摘要。用户可接受、要求解释、要求补救或发起争议。
14. `settlement_or_dispute`: 用户接受则结算，用户不接受则进入争议流程。
15. `cleanup_receipt`: Provider Docker 返回输入删除/保留、容器销毁、日志封存和 artifact manifest 回执，订单关闭。

闭环不变量：

- 买方侧没有用户确认，不能提交云端、付款、发送敏感文件或发起真实外部动作。
- 一旦进入 Exora flow，本地 agent 不直接完成核心任务。
- 卖方侧估值不等于执行；报价被接受前不能启动执行。
- 卖方执行必须有 list 计划，本地监督器只按计划推进。
- 5 分钟心跳只在 provider 本地保存，不上传云端。
- 云端只接收业务事件：估值、商议、报价接受、输入回执、阻塞、终态、交付和清理回执。
- 每个跨端消息都绑定 `plan_id`、`order_id`、manifest 版本、签名或来源标识。
- 每个暂停点都有明确等待对象：用户、买方 agent、云端、卖方 agent 或 Provider Docker。
- 每个终态都可恢复和审计：取消、全部拒绝、不可恢复失败、成功结算、争议关闭。

最小订单状态可以压成：

```json
{
  "schema_version": "exora.order_state.v0.1",
  "plan_id": "2026-07-07-gpu-inference-a21c",
  "order_id": "ord_01J...",
  "state": "buyer_planning | buyer_manifest_review | cloud_matching | seller_valuation | quote_review | order_authorized | input_transfer | provider_execution | execution_blocked | buyer_verification | settlement_or_dispute | closed",
  "owner": "buyer_user | buyer_agent | cloud | provider_docker | seller_agent",
  "approved_manifest_version": "remote_task_manifest@sha256:...",
  "last_business_event": "valuation_response | quote_accepted | terminal_report | cleanup_receipt",
  "waiting_for": "user_input | provider_response | cloud_match | local_supervisor | none",
  "terminal_reason": null
}
```

这次闭环探索的结论是：买方 agent、云端、卖方 agent 和 Provider Docker 的职责已经能形成闭环；关键实现点是维护统一的 `order_state`，并强制所有跨端消息和本地监督动作都回写状态机。

## 8. 示例：订机票

用户说：“帮我订下周三上海到东京的机票，上午出发，尽量便宜。”

本地 agent 不应直接订票。它应先问必要问题：

- 乘客人数、姓名、证件类型、证件号码、出生日期和联系方式是否已经提供，或是否将在报价接受后通过受控 approval flow 提供？
- 是否只需要方案，还是允许创建真实订单？
- 预算上限是多少？
- 是否接受中转？
- 行李要求是什么？
- 出发机场和到达机场是否有限制？
- 价格、时间、航空公司、退改签和行李额度之间的优先级是什么？

如果用户选择“只要方案”，远端任务单不能要求真实下单，也不能要求完整身份信息。如果用户选择“允许真实预订”，计划必须把身份信息和付款确认拆成单独的用户授权步骤；没有这些信息和授权前，任务单只能要求远端 agent 返回可预订方案、链接、价格有效期和注意事项。

`agent_requirements.json` 应声明需要 travel capability：

```json
{
  "required_capabilities": [
    {
      "capability_type": "managed_api",
      "requirements": {
        "domain": "travel.flight",
        "can_query_live_flight_options": true,
        "can_return_booking_links": true,
        "must_not_pay_without_user_approval": true
      },
      "priority": "must"
    }
  ]
}
```

`remote_task_manifest.json` 应要求远端 agent 先返回方案和报价，而不是直接下单：

```json
{
  "task_type": "travel.flight_options",
  "instructions_for_remote_agent": [
    "Find viable flight options matching the user's route and preferences.",
    "Return prices, times, baggage assumptions, cancellation notes, and booking links if available.",
    "If passenger identity details are required for actual booking, request them through a separate approval-controlled step.",
    "Do not create a real booking or payment before explicit user approval."
  ]
}
```

## 9. 示例：渲染任务

用户说：“帮我找一台机器渲染这个动画。”

本地 agent 不能把这个描述原样发给远端。它必须要求用户补齐或确认：

- 渲染文件路径，例如 `.blend`、`.ma`、`.c4d`、`.hip` 或工程压缩包。
- 所有贴图、缓存、字体、插件、引用文件和外部资源是否已经打包。
- 渲染软件和版本，例如 Blender 4.x、Maya、Cinema 4D、Houdini。
- 渲染引擎和设备要求，例如 Cycles GPU、Arnold CPU、Redshift、Octane。
- 输出规格，例如分辨率、帧范围、帧率、格式、色彩空间、是否需要 alpha。
- 质量参数，例如采样数、降噪、最大噪点、是否接受低清预览。
- 预算、截止时间、是否需要先渲染测试帧。
- 是否允许远端保存源文件和渲染结果，保存多久。

`remote_task_manifest.json` 应明确写成可执行任务：

```json
{
  "task_type": "compute.render",
  "instructions_for_remote_agent": [
    "Review the provided render project manifest and confirm whether all assets and plugins are available.",
    "Do not guess missing assets, plugins, frame ranges, output format, or render settings.",
    "If required files or render parameters are missing, respond with needs_negotiation.",
    "Return a quote for rendering the requested frame range and include ETA, hardware, software version, output format, and limitations."
  ],
  "required_inputs": [
    "render_project_archive",
    "software_version",
    "frame_range",
    "output_format",
    "render_engine",
    "asset_manifest"
  ]
}
```

## 10. 示例：代码任务

用户说：“帮我修复这个仓库里的 CI 失败，用 Exora 找 agent 报价。”

本地 agent 应先整理：

- 仓库路径。
- 语言和包管理器。
- CI 命令。
- 本地能否复现，作为远端任务上下文和后续验收依据；即使本地可复现，也不能因此改为本地直接修复。
- 是否需要 Linux、macOS、Windows、GPU、移动模拟器或浏览器环境。
- 是否允许发送代码包给远端 agent。
- 是否允许远端运行测试。
- 是否禁止发送 `.env`、密钥、私有数据或大型产物。

对于这类已经进入 Exora flow 的代码任务，`agent_requirements.json` 应声明远端执行环境需求，例如：

```json
{
  "required_capabilities": [
    {
      "capability_type": "execution_environment",
      "requirements": {
        "os": "linux",
        "can_run_tests": true,
        "can_receive_redacted_source_bundle": true,
        "can_return_patch_suggestions": true
      },
      "priority": "must"
    }
  ]
}
```

远端任务单应避免直接要求远端改仓库主线。更安全的 MVP 方式是让远端返回诊断、patch 建议和测试日志，本地 agent 再由用户批准后应用。

## 11. MVP 产品边界

MVP 不需要一次性完成真实交易闭环。建议分五阶段。

### P0：本地 plan-first

- 绑定外部 agent。
- Exora flow 只接管需要外部帮助或用户明确要求外部协作的任务。
- 由买家 agent 自主识别用户输入是 `chat`、`clarify`、`candidate_task` 还是 `manual_plan`。
- 对 `chat` 不展示任务确认，对 `candidate_task` 自动展示“Exora Dock 将开始整理计划并寻找可用 agent。是否开始？”。
- 支持用户确认、取消、就地补充，也支持用户手动开启 plan mode。
- 用户确认前允许本地只读扫描、查看、搜索和诊断；禁止写入、更改、移动、删除、上传、打包、远端匹配和付款。
- 用户确认后，或用户手动开启 plan mode 后，进入 Exora plan mode。
- 一旦进入 Exora flow，本地是否有能力完成不再阻止提交外部；本地 agent 不直接完成核心任务。
- 注入 Exora planning context。
- 写入本地三类文件。
- 默认只显示 `remote_task_manifest.json` 给用户审核。

### P1：本地模拟匹配

- 用本地 mock agent cards 进行匹配。
- 返回模拟报价和拒绝理由。
- 完善 `quote_review.md` 体验。

### P2：真实服务器匹配

- 发送 `agent_requirements.json` 和 `remote_task_manifest.json`。
- 服务器最多选择五个远端 agent。
- 候选卖方 agent 进入任务估值状态，基于卖家定价基准和真实设备状态返回 quote、needs_negotiation、reject。
- 本地显示报价和注意事项。

### P3：交易前确认

- 用户选择报价。
- Dock 创建 approval request。
- 记录 consent receipt。
- 发送任务包或输入 manifest。

### P4：受控执行与验收

- Provider Dock 接受报价后生成 `provider_execution_plan.json`。
- Provider Dock 或 Docker runner 每 5 分钟在本地监督一次执行计划、心跳和进程状态，不向云端发送心跳。
- 如果卖方 agent 非活跃且本地未生成 success 或 failed_unrecoverable 终态报告，监督器持续拉起并要求继续执行。
- 卖方 agent 必须向服务器返回 success 及交付物，或 failed_unrecoverable 及失败原因。
- 返回 artifact manifest、日志和收据。
- 本地 agent 协助验收。
- 用户确认结算或发起争议。

## 12. 与现有 Exora Dock 的关系

现有 Exora Dock 白皮书定义了 agent-native negotiation network、Agent Card、task envelope、quote、consent、escrow、deliver、verify 和 settle。本文补充的是本地 agent 进入该网络前的“计划与任务成形层”。

可以理解为：

- Exora Dock 白皮书定义市场和协议。
- Agent Discovery 文档定义本地 agent 如何找到 Dock。
- 本文定义本地 agent 如何把用户自然语言任务整理成可匹配、可报价、可执行的 Exora 任务。

## 13. 实现建议

### 13.1 Agent 会话入口

Dock 在生成“复制给 agent 的一行提示词”时，应包含：

- Dock discovery 路径。
- MCP 配置。
- 当前 `workUid`。
- 当前项目路径。
- 候选任务自主识别规则。
- 手动开启 plan mode 的入口。
- 预计划确认要求。
- plan-first 要求。
- 本地 plan 输出目录。
- 三类 JSON 文件路径。

### 13.2 MCP 工具

可以增加或强化以下 MCP 工具：

```text
exora.classify_task_intent
exora.enter_manual_plan_mode
exora.create_task_start_confirmation
exora.record_task_start_confirmation
exora.start_task_flow
exora.write_task_requirements
exora.write_agent_requirements
exora.write_remote_task_manifest
exora.validate_task_plan
exora.request_plan_approval
exora.submit_agent_match_request
exora.list_provider_responses
exora.create_quote_review
exora.create_order_state
exora.update_order_state
exora.record_business_event
exora.close_order
exora.provider_evaluate_task
exora.provider_write_execution_plan
exora.provider_update_plan_item
exora.provider_record_local_heartbeat
exora.provider_report_success
exora.provider_report_unrecoverable_failure
exora.provider_supervisor_tick
exora.provider_resume_execution
```

这些工具不应让 agent 直接批准、付款或下单。它们只负责准备、校验、提交和查询。

其中 `exora.classify_task_intent` 可以作为本地辅助分类器，帮助 agent 判断是否应自动展示确认。`exora.enter_manual_plan_mode` 应记录用户手动开启计划的意图。`exora.start_task_flow` 必须要求存在 `record_task_start_confirmation` 或手动 plan 记录，防止 agent 绕过确认直接写入任务包、上传内容、提交远端匹配或触发交易。

订单状态工具负责闭环。`exora.create_order_state` 在用户批准提交或接受报价时创建可恢复状态，`exora.record_business_event` 记录估值、商议、报价接受、输入回执、终态和清理回执，`exora.close_order` 只能在取消、全部拒绝、不可恢复失败、成功结算或争议关闭时调用。

卖方侧工具必须围绕两个状态设计。`exora.provider_evaluate_task` 只能返回估值结论，不能启动执行。`exora.provider_write_execution_plan` 必须生成 list 形式的执行计划。`exora.provider_record_local_heartbeat` 只写入 provider 本地状态，不发送云端。`exora.provider_supervisor_tick` 每 5 分钟由 Provider Dock 或 Docker runner 在本地调用一次；如果没有本地终态报告且 agent 非活跃，它应调用 `exora.provider_resume_execution` 重新拉起任务。

### 13.3 本地校验

在用户确认发送服务器前，Dock 应校验：

- 是否存在用户开始整理计划的确认记录，或用户手动开启 plan mode 的记录。
- JSON schema 是否通过。
- 是否遗漏预算、输出、隐私、验收方式。
- 是否声明任务必须交给外部 agent，且本地 agent 不承担核心执行。
- 是否包含敏感文件路径。
- 是否请求了超过用户策略的权限。
- 是否把用户未确认的真实动作写进远端任务单。

### 13.4 失败恢复

每个 plan 都应能 resume：

- 本地 agent 退出后可读取 plan 文件继续。
- 服务器匹配中断后可用 `plan_id` 恢复。
- 远端 agent 报价超时后可重试或替换候选。
- 用户隔天回来仍能看到“当前在哪一步、需要谁确认、下一步是什么”。

## 14. 风险与约束

### 14.1 过度提问

Plan-first 不等于把所有问题都问用户。agent 应先读本地上下文和已有文件，只问真正阻塞报价和执行的问题。

### 14.2 任务单泄露

远端任务单不应包含不必要的隐私、密钥、完整身份、未授权文件路径或内部业务信息。必要时只发摘要和 hash，等报价接受后再发送最小输入包。

### 14.3 远端 agent 幻觉报价

远端 agent 返回报价时必须绑定 provider card、能力声明、时间戳、有效期和签名。没有签名的报价只能作为参考，不能直接进入交易。

### 14.4 用户误授权

Dock 应把高风险动作分开确认，不能把“允许匹配远端 agent”与“允许付款或真实下单”合并成一个按钮。

### 14.5 服务器过度中心化

服务器负责匹配和控制消息，不应默认托管大文件、私钥、敏感输入或 provider 内部凭据。数据面应优先走 Dock-to-Dock 或受控加密传输。

### 14.6 卖方监督器失控

Docker 监督器需要持续拉起非活跃 agent，但不能造成重复计费、重复提交或重复执行不可幂等动作。执行计划中的每个 step 都必须声明幂等性、完成证据和可重试边界；监督器每次拉起都应从第一项未完成 step 继续，而不是重跑整个任务。

## 15. 结论

Exora Agent 的关键不是创造一个更聪明的单体 agent，而是让 agent 学会在执行前组织外部协作。它只处理需要外部帮助，或用户明确要求外部 agent 参与的任务；一旦进入 Exora flow，本地能否完成不再阻止提交外部。默认 plan mode 让用户意图先变成可审查的任务对象；本地三类文件让任务可以被恢复、验证和转发；卖方 agent 用估值状态和执行计划状态约束报价与执行；远端 agent 报价协议让能力市场从“静态商品列表”变成“agent 间的实时协商”。

当用户说出一个任务时，Exora Agent 应先回答：

1. 这个任务到底需要什么？
2. 远端需要什么能力，本地只负责哪些准备和验收？
3. 需要什么样的 agent？
4. 远端 agent 应该收到怎样的任务单？
5. 哪些动作必须由用户批准？

只有这些问题被整理清楚后，执行才应该开始。
