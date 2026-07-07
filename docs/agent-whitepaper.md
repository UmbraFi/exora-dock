# Exora Agent Whitepaper

Version: Working Draft v0.1
Last updated: 2026-07-07
Positioning: Plan-first agent orchestration and remote capability negotiation

## Summary

Exora Agent is Exora Dock's task-orchestration layer for local agents. It takes over only tasks needing external help or explicitly delegated by the user to external agents. Its purpose is not for the local model to complete everything directly, but to organize user intent before execution into reviewable, transferable, quotable, recoverable task objects, then use Exora Dock and Exora Cloud to find suitable remote participants.

The core workflow continuously lets the local buyer agent determine whether the user's current message constitutes an Exora candidate task, rather than requiring a manual “Initiate Task” click. When the user is merely chatting, asking questions, explaining an idea, or has not expressed delegation intent, the system shows no confirmation and enters no task flow; the agent can still perform local read-only exploration in chat mode, such as scanning, viewing, searching files, and running diagnostic commands that change no state. Chat mode prohibits modifying, moving, or deleting user files, packaging/uploading, contacting remote agents, requesting quotes, or paying. If the agent identifies an explicit external-collaboration task, especially one requiring remote capabilities, quotes, identity, files, compute, real services, or external execution, it automatically asks: “Exora Dock will organize a plan and find available agents. Start?” Users may also manually request plan mode, confirm, cancel, or add information in place. Only after confirmation or explicit manual activation does the local agent enter Exora plan mode, organize the task, fill necessary gaps, read authorized local context, and generate three local file types: task essentials, required-agent needs, and the remote-agent task manifest. By default, it does not show an initial plan of what the local agent itself will do; it presents the organized remote manifest for user review. Only after approval does Dock send agent requirements and the manifest to the server. Once a task enters Exora flow, local ability is no longer a condition for external submission; the local agent acts only as buyer, planner, and acceptance assistant rather than replacing the remote provider's core execution. The server matches at most five remote agents and sends them the manifest for quotes, considerations, or rejection reasons. When those return locally, the user can continue talking with remote agents or select a quote to enter transaction and execution.

This design changes immediate model execution into organizing collaboration first. The local agent neither assumes it should do everything nor bypasses remote submission because it might complete the task itself; it explicitly answers three questions: what the task requires, what agent capabilities it needs, and how the remote agent should execute it.

## 1. Background: Why Plan Mode Is the Default

A common failure of general agents is premature execution rather than inability to code or search. Requests such as “book a flight,” “run large-model inference,” “fix a cross-service bug,” or “find agents for quotes” can trigger action before requirements, permissions, budget, data boundaries, and external capabilities are clear.

Exora especially needs planning first because tasks often involve external capabilities:

- Coding tasks may depend on particular repositories, environments, test commands, key boundaries, deployment constraints, and review policies.
- Compute tasks may require large VRAM, CUDA, specific models, data transfer, and result validation.
- Travel, purchasing, forms, SaaS, and other action tasks may involve real orders, identity, payment, and irreversible external actions.
- Data tasks may involve authorization, retention, secondary use, citations, freshness, and privacy boundaries.
- Multi-agent tasks first need to identify which kinds of agents can help, rather than randomly broadcasting tasks.

Exora Agent should therefore default to plan-first:

1. The user enters a message.
2. The buyer agent classifies it as ordinary chat, further clarification, or an Exora candidate needing external help.
3. For chat, show no confirmation or task flow; allow local read-only scanning, viewing, searching, and diagnostics, but no modification, movement, or deletion of user files.
4. For a candidate task, Dock/the agent automatically asks whether to organize a plan and find agents; before confirmation, permit only local read-only exploration, without writing, uploading, modifying, moving, or deleting user content.
5. The user may also manually enable plan mode; confirm immediately or add information in place before confirming.
6. The local agent enters Exora plan mode for authorized reading, analysis, questions, and plan-file writing only, without directly completing the core task.
7. The local agent generates local structured files.
8. After the user reviews and approves the remote manifest, begin server matching and remote quote requests; local capability does not change the flow into local execution.
9. Enter transaction/execution only after another user confirmation.

## 2. Core Principles

### 2.1 Autonomous Intent Recognition and the Pre-Plan Confirmation Gate

Exora Agent differs from development agents such as Claude Code in one key aspect of plan mode: ordinary Exora chat can help users understand local context through file scanning/viewing/searching and read-only diagnostics, but must not generate task packages, rewrite/move/delete local files, or contact servers/remote agents before confirmation. The user must first confirm an Exora task or explicitly enable plan mode manually.

This confirmation is not a manually triggered feature button; it is a safety gate autonomously triggered by the buyer agent's interpretation of conversation. After every user input, perform lightweight task-intent classification:

- `chat`: the user is chatting, learning concepts, discussing possibilities, asking how Exora works, or has not expressed execution-delegation intent. Show no confirmation. Local read-only scanning, viewing, searching, and diagnostics may continue to explain context.
- `clarify`: task intent exists, but goals, boundaries, or the need for Exora's network remain unclear. Continue natural conversation, clarifying questions, and local read-only exploration without rewriting/moving/deleting files or contacting remote parties.
- `candidate_task`: the user has made an explicit request that can become an organized task. Automatically show pre-plan confirmation.
- `manual_plan`: the user explicitly says “enable plan mode,” “start organizing a plan,” or “find available agents.” Treat this as active initiation and enter Exora plan mode directly, while still separately confirming server submission, payment, identity disclosure, or sensitive-file transfer.

For a complete initial request such as “find a machine with at least 48GB VRAM for this inference task, budget 20 USDC, output results.jsonl and logs,” show confirmation immediately rather than waiting for manual initiation. For “what could Exora be used for?” or “let's discuss a flight-booking agent design,” show no confirmation.

Confirmation text should be short, clear, and rejectable:

```text
Exora Dock will organize a plan and find available agents. Start?
```

The interface must provide at least:

- `开始`: enter Exora plan mode.
- `取消`: initiate no task, plan, upload, or remote contact; the agent may stay in local read-only chat mode.
- `补充信息`: add requirements, constraints, paths, budget, or preferences in place; regenerate confirmation context and ask again before starting.

Before the user clicks `开始`, limit buyer-agent permissions to:

- Scan, view, and search authorized local files/directories to understand context.
- Run read-only diagnostics, checks, and search commands that change no local or external state.
- Do not write plan files, caches, task packages, or business files.
- Do not modify, move, delete, rename, format, or overwrite user files.
- Do not call state-changing local tools, packaging/uploading tools, or remote matching tools.
- Send no task content to Exora Cloud or any remote agent.
- Only show confirmation, receive added information, and explain the upcoming workflow.

When the user selects `补充信息`, merge the additions with the original task and restart confirmation with new input. Never continue using the old unconfirmed draft; regenerate from the latest supplemented input.

### 2.2 Plans Are Local Objects, Not Chat History

Plan mode should generate local files that Dock, Cloud, remote agents, and future sessions can reread, rather than merely writing an attractive plan in chat. Plans need paths, versions, hashes, statuses, and schemas.

Suggested default path:

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

`<plan_id>` may combine time, task summary, and a random suffix, for example:

```text
2026-07-07-book-flight-8f3a
2026-07-07-gpu-inference-a21c
```

### 2.3 Separate Task Requirements from Agent Requirements

Task requirements describe what to accomplish; agent requirements describe the capabilities needed from people or machines. Keep them separate.

“Book a flight” needs more than `task_type: travel.booking`: specify agents able to query real flight inventory, return clickable booking links, handle dates/passenger preferences, avoid payment by default, and require separate authorization for real booking.

“Run 70B inference” also needs more than “GPU required”: specify over 40GB VRAM, CUDA support, input-file reception, logs/result hashes, and prohibition on retaining inputs for training.

### 2.4 Exora Tasks Are External by Default

The Exora buyer agent is not a local execution agent. It takes over only tasks needing external help or explicitly delegated externally. For purely local Q&A, ordinary local edits, or explanatory discussion without a request for external collaboration, Dock should create no Exora task or pretend there is a remote requirement.

Once a task enters Exora flow, local ability no longer affects routing. Even if the local agent believes it can finish the task, it must remain the buyer: organize requirements, ask missing questions, generate a remote manifest, obtain user review, and submit externally for quotes/execution after approval. The local agent may read context, sanitize private information, decompose tasks, compare quotes, assist acceptance, and apply results after approval, but must not substitute local handling for core execution.

This rule prevents Exora from degenerating into an ordinary single agent or its remote marketplace being bypassed by local-model confidence. Exora promises to find suitable external capabilities and organize collaboration, rather than first attempting local-model completion.

### 2.5 Plans Must Supply Every Prerequisite for Remote Execution

Exora plan mode must complete requirements enough for remote agents to assess, quote, and execute, rather than write a broad direction. Any unclear, incomplete, easily misunderstood detail or one affecting quotes/execution requires user clarification or verification.

Examples:

- Flight booking requires passenger count, how names/identity documents will be supplied, origin, destination, dates, time preferences, budget, baggage, transfer tolerance, and whether only options or actual booking are authorized.
- Rendering requires scene files, asset dependencies, target format, resolution, frame range, engine version, plugin dependencies, expected quality, and delivery format.
- Coding requires repository paths, environment, test commands, dependency-installation approach, files allowed remotely, key boundaries, and acceptance criteria.
- Data tasks require input data, authorization boundaries, output format, remote retention rights, and whether third-party API processing is allowed.

Remote task requirements must not use ambiguous phrases such as “a bit cheaper,” “as soon as possible,” “handle this,” “a suitable format,” or “execute as appropriate.” Convert missing explicit constraints into precise questions. If a field genuinely cannot be predetermined, mark it `unknown_but_non_blocking` and explain why it does not block quoting/execution.

### 2.6 Remote Manifests Must Address the Executor

Remote agents need no complete local reasoning history; they need a clear, quotable, rejectable, executable manifest with goals, inputs, outputs, restrictions, acceptance, budget range, timing, privacy boundaries, and matters requiring confirmation.

Remote manifests must pass clarity checks: unique goal, complete inputs, verifiable outputs, explicit permissions, assessable budget, listed risks, and clear user-confirmation requirements. A manifest failing these checks cannot be sent to the server.

### 2.7 User Authorization Is the Sole Execution Boundary

Local agents may suggest, remote agents quote, and servers match, but actual authorization comes from users or their predefined Dock policies. Agents must not approve payment, disclose identity, send sensitive files, place real orders, or perform irreversible actions on the user's behalf.

### 2.8 Quotes Precede Transactions

A remote agent's first response should be one of the following rather than an execution result:

- `quote`: able to perform the task, with price, time, deliverables, and considerations.
- `needs_negotiation`: can assess it but needs more information, budget/parameter changes, or permission confirmation.
- `reject`: unable to perform it, with a rejection reason.

This makes Exora Cloud an agent-capability matching layer rather than a blind task-dispatch queue.

## 3. Default Local-Agent Workflow

### 3.1 Recognize Task Initiation

When users enter messages in a Dock-bound agent session, the buyer agent first autonomously determines whether they are Exora candidates, without requiring a manual “Initiate Task” click or fixed command. The criterion is whether the user needs or chooses external help, rather than local-agent ability. Meanwhile, chat/clarify are not incapable states: the agent may read, scan, search, and view local context, but only read-only.

Candidate tasks include:

- Explicit requests to “find agents,” “send remotely,” “request quotes,” or “have someone else help.”
- Requests for external capabilities such as large VRAM, specific environments, real services, specialized data, or skills; even if local completion seems possible, choosing Exora flow still creates a candidate.
- Requests triggering payment, identity disclosure, external writes, actual booking, or irreversible actions.
- Requests to hand local code, files, data, or tasks to external providers.
- Sufficiently complete goals, constraints, inputs, and outputs, with external collaboration judged necessary or explicitly requested, allowing organization of a remote manifest.

For ordinary chat, concept explanation, public-material reading, or purely local processing without external-collaboration intent, Dock should not enter Exora task flow. If the user explicitly declines an Exora task, the local agent must not force external submission.

Recognition has four categories:

```json
{
  "intent_state": "chat | clarify | candidate_task | manual_plan",
  "reason": "short explanation",
  "should_show_start_confirmation": true
}
```

When `intent_state` is `candidate_task`, Dock automatically shows pre-plan confirmation. When `intent_state` is `manual_plan`, Dock may enter Exora plan mode directly. When `intent_state` is `chat`, it shows none. When `intent_state` is `clarify`, the agent may ask lightweight questions such as whether to formally initiate a task or merely discuss options. Chat/clarify permit local read-only exploration but prohibit modifying, moving, or deleting files, uploading, contacting remote parties, or generating task packages.

### 3.2 Pre-Plan Confirmation

After recognizing a candidate, the buyer still cannot generate plans, write plan files, package/upload, or contact remote agents. Dock automatically displays confirmation:

```text
Exora Dock will organize a plan and find available agents. Start?
```

The user may:

- Confirm and start.
- Decline and cancel.
- Add information in place, such as budget, paths, how identity details will be supplied, privacy boundaries, expected outputs, and time limits.

When information is added in place, Dock merges it with the original request and repeats pre-plan confirmation. Additions do not patch an old draft; updated input regenerates subsequent plans.

### 3.3 Enter Exora Plan Mode

Dock triggers Exora plan mode only after the user confirms starting or explicitly enables it manually.

Implementation may follow two paths:

- For agents supporting plan mode, such as Claude Code or similar systems, set default permission mode to `plan` at startup or execute `/plan` before the first task reaches the model.
- For agents without native plan mode, inject an Exora planning wrapper requiring plan files and open questions first, without direct remote-execution/payment tool calls.

In Exora plan mode, the buyer may read and organize within authorization but still cannot complete the core task directly, rewrite business files, submit to servers, call remote matching, or trigger payment. The only writes allowed by default are plan files under `.exora/agent-plans/<plan_id>/`.

Plan mode is iterative rather than one-shot. First create a structured draft from known information, ask users about gaps, update local plans and the remote manifest from answers, and continue questioning until the manifest is clear, free of blocking issues, and ready for review.

### 3.4 Prompt Supplement

Append Exora context to the user's original prompt, explaining that the task needs external agents or has explicitly been routed externally, rather than being an ordinary single-agent task.

Suggested prompt template:

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

This template supplements rather than replaces the user's task, as a hidden system constraint or Dock-injected task context.

### 3.5 Necessary Questions and the Clarity Gate

Planning must ask questions without shifting responsibility back to users. Questions must satisfy two conditions:

- Only the user can answer.
- An unanswered question affects quotes, permissions, budget, delivery, or safety boundaries.

When execution needs missing files, identity details, input parameters, or acceptance criteria, the agent must stop in planning and request completion/confirmation. Dock cannot send the manifest for server matching until the user supplies them.

Typical questions include:

- What is the budget cap?
- Which files/data may be sent to remote agents?
- Are only options requested, or is real execution authorized?
- Is there a time limit?
- What result format is required?
- May remote agents use third-party APIs?
- What requirements apply to geography, providers, privacy, and retention?
- For coding, are tests, dependency installation, network access, `.env` access, or deployment allowed?
- For real services, which identity, account, contact, or preference details are needed? Are they supplied now or through controlled approval flow after quote acceptance?
- For file tasks, are all inputs provided? Otherwise, what are their paths, formats, sizes, asset dependencies, and transfer methods?
- For rendering, simulation, training, or inference, are versions, parameters, resource needs, output specifications, and acceptance clear?

Before planning ends, `open_questions` must be empty or contain only explicitly nonblocking quote issues. Ask users first about anything blocking quotes or execution.

### 3.6 Generate Local Files

After planning, the agent must generate at least:

- `task_requirements.json`: task essentials.
- `agent_requirements.json`: required agent capabilities.
- `remote_task_manifest.json`: instructions for remote execution.

By default, users need review only `remote_task_manifest.json`, describing what the remote agent should do. `task_requirements.json` and `agent_requirements.json` may expand as advanced details; the local agent's initial work plan is not the default review object. After confirmation, Dock sends `agent_requirements.json` and `remote_task_manifest.json` to the server.

Before submission, require a brief agent clarity statement confirming:

- All information required for remote quotes is complete.
- All execution inputs are supplied or explicitly deferred to controlled provision after quote acceptance.
- All ambiguous wording has become explicit constraints.
- The user has answered or confirmed all blocking questions.
- Remote agents need not guess user intent.

### 3.7 User Confirmation

There must be at least three confirmation points:

1. Whether to organize a plan and find agents. Before confirmation, the buyer may explore locally read-only, but must not write, upload, modify, move, delete, package, or contact remote parties.
2. Whether agent requirements and the remote manifest may be submitted for matching. The user reviews the organized `remote_task_manifest.json` at this point.
3. After quotes arrive, whether to select a remote agent for a transaction or continue discussion.

Payment, identity, sensitive data, real booking, external writes, or irreversible actions need more granular confirmation.

## 4. Draft Local-File Schemas

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

## 5. Server Matching and Remote Quote Requests

After receiving `agent_requirements.json` and `remote_task_manifest.json`, the server must not broadcast to every provider. First screen candidates and select at most five remote agents.

Matching inputs:

- Required capabilities.
- Optional preferences.
- Budget range.
- Risk level.
- Data and privacy boundaries.
- Remote agents' Agent Cards.
- Remote agents' online status, reputation, queue length, and historical quote performance.

Matching output:

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

After receiving a manifest, a remote agent first enters task valuation and returns it to the server. Valuation performs no task execution and returns only `quote`, `needs_negotiation`, or `reject`; `quote` means the task can be accepted.

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

Negotiation-needed response:

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

Rejection response:

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

## 6. Local Interaction After Quotes Arrive

After remote quotes and considerations return, local Dock must not automatically select a provider. Organize `quote_review.md` and a structured quote list for user review.

The local agent may help users:

- Compare prices, ETA, risks, and considerations.
- Ask a remote agent for details.
- Request a revised quote.
- Recommend a quote.
- Generate an approval request.

The following require user confirmation:

- Accepting quotes.
- Paying or locking escrow.
- Sending sensitive files.
- Authorizing real orders, form submission, or external writes.
- Allowing remote input retention or data reuse.

## 7. Seller-Agent State Machine

The seller/provider agent does not perform open-ended planning like the buyer. Its narrower role is to value the task and decide acceptance, then execute the accepted plan and continuously report results. It has only two long-running states:

- `task_valuation`: task valuation.
- `execution_plan`: execution plan.

`success`, `failed_unrecoverable`, `needs_negotiation`, and `reject` are results that must be reported to the server, not ambiguous states where agents linger.

### 7.1 Task Valuation State

After receiving server-forwarded `remote_task_manifest.json`, the seller must first enter task valuation. It executes nothing and decides only:

- Whether to accept.
- Whether negotiation is needed.
- Whether to reject immediately.

Pricing must use the baseline predefined by the seller-side user, the device/service owner, rather than model intuition. Valuation also reads actual device/service state, including available GPU/CPU/memory/disk, current queue, software versions, network conditions, available key scope, policies, and existing load. Static Agent Card claims alone cannot support a quote.

Valuation inputs include at least:

- Buyer-submitted `remote_task_manifest.json`.
- Seller-side `seller_pricing_policy.json`, such as hourly rates, minimum charges, GPU prices, rush multipliers, failure compensation, and prohibited task types.
- Provider capability declarations and policy boundaries.
- Live device snapshots: VRAM, system load, disk space, queue length, container images, and software versions.
- Currently committable ETA and resource-reservation window.

Valuation output must return to the server in one of only three categories:

- `can_accept`: can accept, with quote, ETA, deliverables, considerations, and data-retention policy.
- `needs_negotiation`: feasible, but the buyer must adjust budget, time, inputs, parameters, permissions, or execution approach.
- `reject`: cannot accept, with reasons and optional revision suggestions.

Example:

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

### 7.2 Execution Plan State

Only after the buyer accepts the quote, completes required authorizations, and supplies execution inputs according to the manifest may the seller enter execution planning. It must decompose the task into a supervisable list rather than retain only a natural-language plan.

Each execution-plan item should contain:

- A stable `step_id`.
- Current status: `pending`, `running`, `done`, `blocked`.
- What to do.
- Required inputs.
- Expected outputs/evidence.
- Completion conditions.
- Reason category to report on failure.

Example:

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

### 7.3 Local Docker Supervisor and Five-Minute Startup

Provider Dock or a Docker runner should supervise the seller. It is a local execution daemon with a fixed cadence, not another unconstrained agent: every 5 minutes, read the plan, local heartbeat, process state, and local terminal report, then invoke/start the seller to continue execution.

The 5-minute heartbeat is a provider-local supervision event, needing no Cloud interaction or Cloud polling/activity checks. Cloud receives only meaningful business transitions, such as valuation results, negotiation requests, post-acceptance input acknowledgment, unrecoverable failures, successful delivery, cleanup, and settlement receipts.

Supervisor rules:

- If the agent is actively executing, record a local heartbeat and require current `plan_items` status updates.
- After the agent generates and sends a `success` terminal report, stop invoking it and wait for delivery/settlement.
- After the agent generates and sends `failed_unrecoverable`, stop execution and leave reasons, evidence, and optional remediation for the server/buyer.
- If the agent is inactive and no pending/sent local `success` / `failed_unrecoverable` terminal report exists, keep starting it with the execution plan, recent logs, completed steps, and next-step requirements reinjected.
- Every startup must be idempotent: never repeat completed steps unless explicitly declared retryable.

The seller agent must not disappear silently during execution. Eventually it must return one of two terminal results to the server:

- `failed_unrecoverable`: failure due to unsolvable factors, with reasons, evidence, completed steps, partial-artifact status, and whether renegotiation is recommended.
- `success`: successful completion with everything required, such as deliverables, logs, hashes, environment summaries, and data-deletion commitments.

Terminal-report example:

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

### 7.4 Docker–Cloud Interaction Points in Each Order

Five-minute supervision heartbeats are not Cloud interactions. For each order, Provider Docker and Exora Cloud should interact only at business transitions or cross-device confirmation points:

1. `valuation_request`: Cloud sends candidate Provider Dockers `remote_task_manifest.json`, quote-request ID, budget, and privacy constraints.
2. `valuation_response`: Provider Docker returns `can_accept`, `needs_negotiation`, or `reject`, with seller pricing basis, live device snapshot, and quote/rejection reasons.
3. `negotiation_message`: Cloud forwards buyer additions and budget/parameter changes when negotiation is needed; Provider Docker returns revised valuation or rejection.
4. `quote_accepted`: after buyer acceptance, Cloud sends Provider Docker the order ID, approved manifest version, execution authorization, and settlement/escrow state.
5. `input_transfer_receipt`: after receiving an input package, download ticket, or Dock-to-Dock transfer, Provider Docker acknowledges receipt and hash validation to Cloud.
6. `execution_plan_committed`: after generating the plan, Provider Docker may submit a summary/hash for later acceptance/disputes; subsequent five-minute supervision remains local.
7. `execution_blocked`: when execution needs buyer intervention, Provider Docker sends Cloud `needs_negotiation`, such as missing files, insufficient budget, conflicting parameters, or insufficient authorization.
8. `terminal_report`: on completion, Provider Docker returns only `success` or `failed_unrecoverable`.
9. `artifact_and_cleanup_receipt`: after success/failure, Provider Docker returns the deliverable manifest, logs, hashes, environment summary, input deletion/retention policy, and cleanup receipt.

All other local Docker heartbeats, process checks, log rotation, step-status updates, and agent startups remain provider-local rather than uploading to Cloud.

### 7.5 Exploring a Complete Buyer–Seller Loop

An order must progress from user natural language to cancellation, rejection, failure, successful acceptance, or dispute, without dangling states that depend on an agent choosing to continue. Every state needs one responsible party, a next action, recoverable records, and an explicit terminal outcome.

Simplified loop:

1. `chat_or_clarify`: the buyer understands locally read-only. Without external-collaboration intent, remain in ordinary conversation.
2. `start_confirmation`: the buyer recognizes an Exora candidate and asks to start; the user can cancel, supplement, or start.
3. `buyer_planning`: enter plan mode, complete questions, and generate three local file types. Ask for missing information; close the task if the user cancels.
4. `buyer_manifest_review`: the user reviews `remote_task_manifest.json` and may request revisions, cancel, or approve submission.
5. `cloud_matching`: Cloud matches at most five sellers. With no candidates, return to the buyer to revise agent requirements or cancel.
6. `seller_valuation`: the seller uses pricing baselines and live device state to return `can_accept`, `needs_negotiation`, or `reject`.
7. `quote_review`: the buyer summarizes quotes, negotiation requests, and rejection reasons. The user may accept, negotiate, revise, or cancel.
8. `order_authorized`: after quote acceptance, Cloud records the order, authorization, escrow/payment state, and approved manifest version.
9. `input_transfer`: buyer/seller hand off inputs through controlled channels; Provider Docker returns receipt/hash-validation acknowledgments.
10. `provider_execution`: the seller generates a list-form plan; the local Docker supervisor checks/starts execution every 5 minutes. Cloud receives no heartbeat.
11. `execution_blocked`: for buyer intervention, the seller sends `needs_negotiation` through Cloud; after buyer additions, resume execution or revalue.
12. `terminal_report`: the seller must return `success` or `failed_unrecoverable`; without a terminal result, Provider Docker keeps starting it locally.
13. `buyer_verification`: the buyer helps verify deliverables, logs, hashes, and environment summaries. The user may accept, request explanation/remediation, or dispute.
14. `settlement_or_dispute`: settle on user acceptance; otherwise enter the dispute flow.
15. `cleanup_receipt`: Provider Docker returns input deletion/retention, container destruction, log sealing, and artifact-manifest receipts; close the order.

Loop invariants:

- Without user confirmation, the buyer cannot submit to Cloud, pay, send sensitive files, or initiate real external actions.
- After entering Exora flow, the local agent does not directly complete the core task.
- Seller valuation is not execution; execution cannot start before quote acceptance.
- Seller execution requires a list plan, and local supervision advances only according to it.
- Five-minute heartbeats remain provider-local, without Cloud upload.
- Cloud receives only business events: valuation, negotiation, quote acceptance, input receipts, blocks, terminal reports, delivery, and cleanup receipts.
- Each cross-device message binds `plan_id`, `order_id`, manifest version, and signature/source identity.
- Every pause has an explicit party to wait for: user, buyer, Cloud, seller, or Provider Docker.
- Every terminal state is recoverable/auditable: cancellation, all rejections, unrecoverable failure, successful settlement, or dispute closure.

The minimum order state can be condensed to:

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

This exploration shows that buyer, Cloud, seller, and Provider Docker responsibilities can form a complete loop. Key implementation requirements are a unified `order_state` and enforced state-machine writeback for every cross-device message/local supervision action.

## 8. Example: Flight Booking

The user says: “Book a flight from Shanghai to Tokyo next Wednesday, departing in the morning, as cheaply as possible.”

The local agent should not book directly; first ask necessary questions:

- Are passenger count, names, document types/numbers, birth dates, and contact details supplied, or will they come through controlled approval flow after quote acceptance?
- Are only options requested, or may a real order be created?
- What is the budget cap?
- Are transfers acceptable?
- What are the baggage requirements?
- Are departure/arrival airports restricted?
- How are price, time, airline, changes/refunds, and baggage allowance prioritized?

For “options only,” the remote manifest cannot require real booking or complete identity details. For authorized real booking, planning separates identity provision and payment confirmation into individual user-authorization steps; until supplied/authorized, request only bookable options, links, price validity, and considerations.

`agent_requirements.json` should declare travel capability:

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

`remote_task_manifest.json` should require options and quotes first rather than immediate booking:

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

## 9. Example: Rendering

The user says: “Find a machine to render this animation.”

The local agent cannot forward this description unchanged; require completion/confirmation of:

- Render-file paths, such as `.blend`, `.ma`, `.c4d`, `.hip`, or a project archive.
- Whether all textures, caches, fonts, plugins, referenced files, and external assets are packaged.
- Rendering software/version, such as Blender 4.x, Maya, Cinema 4D, or Houdini.
- Engine/device requirements, such as Cycles GPU, Arnold CPU, Redshift, or Octane.
- Output specifications: resolution, frame range/rate, format, color space, and alpha requirements.
- Quality settings: samples, denoising, maximum noise, and whether low-resolution previews are acceptable.
- Budget, deadline, and whether test frames are required first.
- Whether remote source/result retention is allowed and for how long.

`remote_task_manifest.json` should define an executable task explicitly:

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

## 10. Example: Coding

The user says: “Fix this repository's CI failure and use Exora to find agents for quotes.”

The local agent first organizes:

- Repository path.
- Language and package manager.
- CI command.
- Local reproducibility, as remote context and later acceptance evidence; local reproduction still cannot switch the task to direct local repair.
- Required Linux, macOS, Windows, GPU, mobile simulator, or browser environment.
- Whether code packages may be sent remotely.
- Whether remote tests are allowed.
- Whether `.env`, keys, private data, or large artifacts are prohibited from transfer.

For coding tasks already in Exora flow, `agent_requirements.json` declares remote execution-environment needs, such as:

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

Avoid asking remote agents to edit the repository's mainline directly. A safer MVP returns diagnosis, patch suggestions, and test logs for local application after user approval.

## 11. MVP Product Boundaries

The MVP need not implement the complete real-transaction loop immediately. Five stages are recommended.

### P0: Local Plan-First

- Bind an external agent.
- Exora flow takes over only tasks needing external help or explicitly requested external collaboration.
- The buyer autonomously classifies input as `chat`, `clarify`, `candidate_task`, or `manual_plan`.
- Show no task confirmation for `chat`; for `candidate_task`, automatically ask “Exora Dock will organize a plan and find available agents. Start?”
- Support confirmation, cancellation, additions in place, and manual plan-mode activation.
- Before confirmation, permit local read-only scanning, viewing, searching, and diagnostics; prohibit writing, modifying, moving, deleting, uploading, packaging, remote matching, and payment.
- Enter Exora plan mode after confirmation or explicit manual activation.
- Once in Exora flow, local ability no longer prevents external submission; the local agent does not directly complete the core task.
- Inject Exora planning context.
- Write the three local file types.
- By default, show only `remote_task_manifest.json` for user review.

### P1: Local Simulated Matching

- Match using local mock agent cards.
- Return simulated quotes and rejection reasons.
- Improve the `quote_review.md` experience.

### P2: Real Server Matching

- Send `agent_requirements.json` and `remote_task_manifest.json`.
- The server selects at most five remote agents.
- Candidate sellers enter valuation and return quote, needs_negotiation, or reject based on seller pricing baselines and actual device state.
- Show quotes and considerations locally.

### P3: Pre-Transaction Confirmation

- The user selects a quote.
- Dock creates an approval request.
- Record a consent receipt.
- Send the task package or input manifest.

### P4: Controlled Execution and Acceptance

- After quote acceptance, Provider Dock generates `provider_execution_plan.json`.
- Provider Dock or a Docker runner supervises the plan, heartbeats, and process state locally every 5 minutes without sending Cloud heartbeats.
- If the seller is inactive and no local success/failed_unrecoverable terminal report exists, keep starting it and requiring continued execution.
- The seller must return success with deliverables or failed_unrecoverable with failure reasons to the server.
- Return artifact manifests, logs, and receipts.
- The local agent assists acceptance.
- The user confirms settlement or initiates a dispute.

## 12. Relationship to Existing Exora Dock

The existing Exora Dock whitepaper defines the agent-native negotiation network, Agent Card, task envelope, quote, consent, escrow, deliver, verify, and settle. This document adds the planning/task-formation layer before local agents enter that network.

The relationship is:

- The Exora Dock whitepaper defines the market and protocol.
- Agent Discovery documentation defines how local agents find Dock.
- This document defines how local agents turn natural-language tasks into matchable, quotable, executable Exora tasks.

## 13. Implementation Suggestions

### 13.1 Agent Session Entry Point

The one-line prompt that Dock generates for copying to an agent should include:

- Dock discovery path.
- MCP configuration.
- Current `workUid`.
- Current project path.
- Autonomous candidate-intent recognition rules.
- Manual plan-mode entry point.
- Pre-plan confirmation requirements.
- Plan-first requirements.
- Local plan output directory.
- Paths for the three JSON file types.

### 13.2 MCP Tools

The following MCP tools may be added or strengthened:

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

These tools must not let agents approve, pay, or place orders directly; they prepare, validate, submit, and query only.

`exora.classify_task_intent` can serve as a local classifier to help decide automatic confirmation. `exora.enter_manual_plan_mode` records manual planning intent. `exora.start_task_flow` must require `record_task_start_confirmation` or a manual-plan record, preventing bypass into task packaging, upload, remote matching, or transactions.

Order-state tools maintain the complete loop. `exora.create_order_state` creates recoverable state on approved submission/quote acceptance; `exora.record_business_event` records valuation, negotiation, quote acceptance, input receipts, terminal reports, and cleanup; `exora.close_order` is permitted only for cancellation, all rejections, unrecoverable failure, successful settlement, or dispute closure.

Seller tools center on two states. `exora.provider_evaluate_task` returns only valuation without starting execution. `exora.provider_write_execution_plan` must generate a list-form plan. `exora.provider_record_local_heartbeat` writes provider-local state without Cloud submission. Provider Dock or a Docker runner calls `exora.provider_supervisor_tick` locally every 5 minutes; if no local terminal report exists and the agent is inactive, call `exora.provider_resume_execution` to restart the task.

### 13.3 Local Validation

Before the user confirms server submission, Dock validates:

- A confirmation record for starting plan organization or manual plan-mode activation exists.
- JSON schema passes.
- Budget, outputs, privacy, and acceptance are not omitted.
- The task explicitly requires external agents and assigns no core execution to the local agent.
- Whether sensitive file paths are included.
- Whether requested permissions exceed user policy.
- Whether unconfirmed real actions are included in the remote manifest.

### 13.4 Failure Recovery

Every plan should support resume:

- After local-agent exit, reread plan files to continue.
- After server-matching interruption, recover using `plan_id`.
- After remote quote timeout, retry or replace candidates.
- Users returning the next day can still see the current step, whose confirmation is required, and the next action.

## 14. Risks and Constraints

### 14.1 Excessive Questions

Plan-first does not mean asking users everything. Read local context and existing files first, then ask only questions genuinely blocking quotes/execution.

### 14.2 Manifest Leakage

Remote manifests must exclude unnecessary private information, keys, complete identity, unauthorized paths, or internal business information. Where needed, send only summaries/hashes, followed by minimal input packages after quote acceptance.

### 14.3 Hallucinated Remote Quotes

Remote quotes must bind provider card, capability declarations, timestamp, validity period, and signature. Unsigned quotes are informational only and cannot directly enter transactions.

### 14.4 Accidental User Authorization

Confirm high-risk actions separately; never merge remote-matching permission with payment/real-order authorization in one button.

### 14.5 Excessive Server Centralization

The server handles matching/control messages, without hosting large files, private keys, sensitive inputs, or internal provider credentials by default. Prefer Dock-to-Dock or controlled encrypted transfers for the data plane.

### 14.6 Uncontrolled Seller Supervision

Docker supervision must keep starting inactive agents without duplicate billing/submission or repetition of nonidempotent actions. Every plan step must declare idempotency, completion evidence, and retry boundaries; each startup resumes at the first unfinished step rather than rerunning the whole task.

## 15. Conclusion

Exora Agent's purpose is to teach agents to organize external collaboration before execution rather than create a smarter single agent. It handles only tasks needing external help or explicit external participation; once in Exora flow, local ability cannot prevent external submission. Default plan mode turns user intent into reviewable task objects; three local file types enable recovery, verification, and forwarding; seller valuation/execution-plan states constrain quotes and execution; remote quote protocols transform a static capability catalog into real-time agent negotiation.

When a user states a task, Exora Agent first answers:

1. What exactly does the task require?
2. What remote capabilities are needed, and which preparation/acceptance duties remain local?
3. What kinds of agents are required?
4. What manifest should the remote agent receive?
5. Which actions require user approval?

Execution should begin only after these questions are organized clearly.
