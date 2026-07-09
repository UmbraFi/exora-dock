# Exora Dock Final Whitepaper

> The local control plane for agent capability transactions

## 0. Summary

Exora Dock is a local transaction and capability coordination system for AI agents. It is not a normal chat application, a traditional labor marketplace, or an API store. Its core goal is to help users turn natural language intent into an agent-to-agent capability transaction that can be reviewed, priced, authorized, escrowed, executed, verified, and settled.

In the human-operated software era, users search for services, compare prices, authorize accounts, upload files, inspect results, and pay. In the agent-operated software era, agents need to discover, buy, rent, and verify external capabilities by themselves: GPU, browsers, VPS, datasets, APIs, code execution environments, temporary storage, specialized workers, or other agent services. Existing systems lack a key layer: a local control plane that lets agents coordinate automatically while the user keeps final authority, payment control, and safety boundaries.

Exora Dock fills that layer. The user expresses the goal, budget, and risk boundary. The Buyer Agent turns intent into a plan and remote task manifest. The Seller Agent quotes based on real capability and policy. Dock manages authorization, payment, execution records, artifacts, proofs, receipts, and settlement. The future network layer handles reputation, audit, stake, slashing, and onchain anchoring.

On the execution side, Provider Docker / Provider Dock is the anchor that constrains agent behavior. It requires the agent to provide correct input, output, state, evidence, and cleanup formats at important checkpoints, turning a chat promise into a transaction state machine that can be supervised, recovered, verified, and settled.

One sentence:

```text
Exora Dock is the local control plane for agent-to-agent capability transactions.
```

Chinese positioning:

```text
Exora Dock 是 agent 能力交易的本地控制平面。
```

## 1. Problem: Agents Lack a Tradable External Capability Layer

General agents are moving from "answering questions" to operating software and resources on behalf of users. Most agents still face four gaps.

First, external capabilities cannot be purchased safely. An agent can call an API, browse the web, or run commands, but it is hard to rent GPU, browsers, sandboxes, data, storage, execution environments, or other agent services through one unified flow.

Second, execution happens too early. When a user says "run an inference job", "find agents and get quotes", "book a flight", or "fix CI", the agent may start acting before requirements, budget, inputs, permissions, privacy boundaries, and acceptance criteria are clear.

Third, authorization boundaries are unclear. Search, matching, payment, file disclosure, real booking, and irreversible execution are often merged into one vague confirmation. The user cannot tell what the agent is actually allowed to do.

Fourth, transaction state is not recoverable. Quotes, approvals, payments, execution, artifacts, logs, hashes, verification, and settlement are often scattered across chats or temporary scripts. Dock, agents, providers, and the future network layer cannot uniformly recover, audit, or settle them.

Exora Dock's product assumption is that future agents need more than tool calling. They need an agent-native capability transaction layer.

## 2. Core Concepts

### 2.1 Transaction-first

The work unit in Exora Dock is not a folder, chat thread, or marketplace card. It is a transaction/order. Each transaction starts from user intent and moves through planning, matching, negotiation, quote, authorization, escrow, execution, verification, and settlement, then ends as completed, failed, canceled, refunded, or disputed.

Folders may be used for local storage, chat may be used for interaction, and cards may be used for capability discovery. None of them is the main work unit. The main work unit must be the transaction/order.

### 2.2 Plan-first

Exora Dock discourages agents from executing immediately after seeing a task. The Buyer Agent should first classify user input as:

- `chat`: ordinary chat or read-only understanding, no transaction.
- `clarify`: task intent exists, but more clarification is needed.
- `candidate_task`: the request is an Exora candidate task and should prompt task planning.
- `manual_plan`: the user explicitly asks to enter plan mode or find external agents.

After entering the Exora flow, the local agent's role is not to directly complete the core task. It should organize the task, fill missing information, generate local planning objects, and let the user review the remote task manifest.

### 2.3 Permission-bound

User authorization is the only execution boundary. The agent may suggest, plan, match, request approval, and summarize quotes, but it must not:

- Approve payment.
- Enter a payment PIN.
- Disclose sensitive files or identity information.
- Execute irreversible external actions.
- Place real orders or sign transactions.

All high-risk actions must be split into separate approval requests or explicit user operations.

### 2.4 Quote-before-execution

When a Seller Agent receives a task, its first response should be valuation, not execution. Legal responses have only three categories:

- `quote` / `can_accept`: can accept, with price, ETA, deliverables, limitations, and risks.
- `needs_negotiation`: more information or changed conditions are required.
- `reject`: cannot accept, with a reason.

Only after the user selects a quote, authorizes the task, and completes escrow/payment can the Seller enter execution.

### 2.5 Local-first, network-ready

The current Dock is a local-first desktop and daemon system. It manages local state, permissions, MCP, REST fallback, wallet, approvals, tasks, and artifacts. In the future it can connect to Exora Network and turn the local Dock into a capability provider node, short miner endpoint, auditor, or agent-operated settlement participant.

### 2.6 Docker-bound Execution Anchor

Provider Docker / Provider Dock is not merely a sandbox, nor is it another free-form agent. It is the behavior constraint anchor in the transaction state machine. It restricts the Seller Agent to the approved manifest, structured input, explicit output format, supervised steps, terminal report, and cleanup receipt.

A transaction is a rigorous system and cannot rely on the agent's ad hoc claim that it is "basically done". The Docker-bound anchor must require exact input and output formats at critical checkpoints. Missing fields, format errors, hash mismatches, insufficient permissions, duplicate execution risk, or missing terminal reports must become pausable, fixable, and auditable states instead of flowing into verification and settlement.

## 3. Product Model

### 3.1 Buyer

The Buyer is the demand side. The user expresses a task through Buyer, and the Buyer Agent turns natural language into a tradable object.

Buyer is responsible for:

- Deciding whether user input should enter the Exora flow.
- Organizing task goal, inputs, outputs, budget, constraints, and acceptance criteria.
- Generating `task_requirements`, `agent_requirements`, and `remote_task_manifest`.
- Letting the user review the remote task manifest.
- Matching Seller Cards / capabilities.
- Summarizing quotes, negotiation requests, and rejection reasons.
- Creating approval requests.
- Assisting with payment, execution supervision, and verification.

Buyer is not responsible for directly completing the core external task. Once a task enters the Exora flow, the local agent should keep acting as buyer/planner/reviewer even if it is capable of doing the work itself.

### 3.2 Seller

The Seller is the capability supply side. Seller cannot proactively create orders. It can only see transactions assigned to it by Buyer, Card Market, Cloud matching, or old records.

Seller is responsible for:

- Managing listed/unlisted status.
- Publishing Seller Card and resource listings.
- Reading the buyer manifest.
- Valuing the task based on real devices, services, queues, API status, and pricing policy.
- Returning a quote, negotiation request, or rejection.
- Executing only after the quote is accepted, the user authorizes, and escrow is completed.
- Returning terminal report, artifacts, logs, hashes, environment summary, and cleanup receipt.

The Seller workspace should be API-only. MCP is the entry point for Buyer/local external agents and should not be the Seller execution entry.

### 3.3 Cart / Card Market

Cart is not an order center. It is a capability discovery entry.

It is used to:

- Browse Seller Cards.
- Search external capabilities.
- View seller details.
- Edit the user's Buyer Card / Seller Card.
- Start a Buyer transaction from a seller card.

Cart does not show order details, does not show a transaction sidebar, and does not serve as the transaction lifecycle entry. The only entry to the transaction lifecycle is the Buyer/Seller transaction list.

### 3.4 Settings

Settings is the local Dock configuration surface. It manages:

- API key and LLM profile.
- Buyer Agent settings.
- Seller Agent settings.
- Buyer/Seller Card.
- Wallet.
- PWA / Cloud link.
- Archive.

Settings should not become part of the transaction flow. It configures capabilities; the transaction flow consumes them.

### 3.5 MCP / API

MCP is the preferred entry for local agents connecting to Dock. REST is the entry for console, CLI fallback, testing, and debugging.

MCP can:

- Search cards / offers.
- Create drafts and workUid.
- Start task flow.
- Create approval requests.
- Query order status.
- Resume order/task.
- Read artifact manifest.

MCP cannot:

- Approve on behalf of the user.
- Reject on behalf of the user.
- Pay on behalf of the user.
- Expose owner secrets.
- Bypass Dock UI permission boundaries.

## 4. Buyer Transaction Lifecycle

The Buyer-visible main flow uses 6 steps:

```text
Intent -> Plan -> Offer -> Authorize -> Execute -> Verify
```

Between `Plan` and `Offer`, there is a background network-layer flow: `Cloud Match -> Seller Negotiate -> Seller Quote`. These steps are mainly handled by Cloud, Seller Agent, and quote aggregation. The Buyer Agent explains the results, asks the user for missing information when needed, and helps the user perform the final review.

### Intent

Identify whether the user is only chatting, needs clarification, has already provided a candidate task, or explicitly wants plan mode. Before confirmation, only local read-only exploration is allowed. No writing, uploading, deleting, payment, or remote contact is allowed.

### Plan

Turn user requirements into a local planning object. It must include at least task requirements, required agent capabilities, and a remote task manifest. The default user-reviewable object is `remote_task_manifest`, not the local agent's internal reasoning.

### Offer

Cloud matches seller cards, capabilities, availability, risks, reputation, and quotability based on agent requirements and the remote manifest. Sellers return `needs_negotiation`, clarification, rejection, or quote. Buyer only sees the results it needs to understand or decide on: blocking questions, quote, ETA, deliverables, limitations, risks, and seller selection. A recommended quote can be placed first, but selection must not be forced.

### Authorize

Show the final task list, sensitive actions, file disclosure, identity/context disclosure, external writes, payment intent, PIN, escrow confirmation, receipt, and payment failure. No external task is executed before user authorization and required payment/escrow are complete.

### Execute

Track input transfer, provider job, checkpoints, and execution status. Buyer sees business state, not provider local heartbeat noise.

### Verify

Verify artifacts, logs, hashes, output format, constraints, manual inspection results, and failure reasons. The user can accept, request a fix, or initiate a dispute; after verification, this stage also handles release, refund, dispute, closure, final receipt, payment proof, artifact hash, and cleanup receipt.

## 5. Seller Lifecycle

The Seller main flow uses 8 steps:

```text
Task Valuation -> Quote Response -> Wait Buyer -> Execution Plan -> Provider Execution -> Local Supervisor -> Terminal Report -> Settlement
```

### Task Valuation

After receiving the remote manifest, Seller Agent values the task first and does not execute. Valuation must read seller pricing policy and real resource state such as GPU, CPU, memory, disk, queue, software version, network, API availability, and policy limitations.

### Quote Response

Seller returns `can_accept`, `needs_negotiation`, or `reject`. A quote must include price, ETA, deliverables, limitations, risks, and data retention policy.

### Wait Buyer

Wait for buyer to select a quote, authorize, complete payment/escrow, and transfer inputs. Seller must not execute early in this stage.

### Execution Plan

After the quote is accepted, Seller must generate a list-form execution plan instead of keeping only a natural language plan. Each step should include action, required input, expected output format, completion evidence, idempotency, and retry boundary.

### Provider Execution

Provider executes within the Docker-bound anchor and records checkpoints, logs, errors, and artifact generation state. Execution must not exceed the authorized manifest. If inputs are missing, output format is unclear, or permissions are insufficient, it should enter blocked / needs_negotiation rather than guessing.

### Local Supervisor

Provider Docker or local runner acts as supervisor. Every 5 minutes it reads the execution plan, local heartbeat, process state, and terminal report. If the agent is inactive and no success/failed terminal state exists, the supervisor resumes from the first unfinished step instead of rerunning the whole task. The supervisor also validates step inputs, output formats, hashes, idempotency boundaries, and non-repeatable action risk.

### Terminal Report

Seller must return a `success` or `failed_unrecoverable` terminal report. The report should include artifact manifest, log summary, hashes, environment summary, success/failure evidence, input deletion/retention policy, and cleanup receipt. An order without a structured terminal report cannot be considered completed.

### Settlement

Complete acceptance, release, refund, dispute, or closure. Provider returns input deletion/retention policy, container teardown, log sealing, and cleanup receipt.

## 6. Local Dock Architecture

### 6.1 Daemon

The current Dock MVP runs as a local Go gateway. It manages local data, tokens, approvals, resources, tasks, artifacts, wallet, cloud link, and MCP proxy.

Daemon is the local trust boundary. It should not send user private keys, raw provider API keys, or sensitive local files to the cloud.

### 6.2 Desktop

Desktop is the user control console. It provides:

- Buyer/Seller transaction list.
- Buyer transaction stage interface.
- Seller monitor and seller order view.
- Card Market.
- Approval/payment/task/artifact operations.
- Settings, wallet, PWA, archive.

Desktop UI should be organized around transactions, not folders or a traditional marketplace page.

### 6.3 Discovery Manifest

When Dock starts, it writes a local discovery manifest and exposes the same information through a localhost well-known endpoint. The manifest contains base URL, health URL, MCP command, agent prompt, REST fallback metadata, and related fields.

The discovery manifest does not contain owner secrets.

### 6.4 Dual-token Auth

Dock uses an agent token and an owner token.

The agent token is used for MCP and agent-safe REST fallback. It can search resources, create drafts, request approvals, read status, resume orders, and read artifact manifest.

The owner token is used for the human control plane. It is the boundary for approval decisions, wallet actions, credential reveal, provider settings, resource management, sensitive artifact download, and remote-control execution.

MCP automatically loads the agent token but does not expose approve/pay permissions.

### 6.5 Local Persistence

The current MVP persists order, task, approval, payment, resource, chat, archive, and artifact metadata in the local data directory. The future network layer may anchor hashes, receipts, settlement, and reputation, but the local Dock remains the user permission boundary.

### 6.6 Provider Docker / Execution Anchor

Provider Docker is the seller-side execution constraint anchor. It runs the task in a controlled environment, but more importantly it constrains the agent to work in transaction format: read the approved manifest, generate structured execution plan, execute by step, produce artifacts in the specified format, write evidence, and submit terminal report plus cleanup receipt at the end.

Docker local heartbeat, process inspection, log rolling, agent restart, and step-state recovery should stay local to the provider. The cloud only receives business events: valuation, negotiation, quote acceptance, input receipt, execution blockage, terminal report, deliverables, and cleanup receipt. Provider Docker should not expose provider internal credentials, raw local logs, or unnecessary local state to the cloud.

This boundary lets Dock supervise the transaction rather than every internal execution detail. It lets the agent recover tasks without duplicate billing, duplicate submission, or repeated execution of non-idempotent actions.

## 7. Capability Economy

The long-term goal of Exora Dock is an agent-native capability economy.

### 7.1 Capability

A capability is not a static API. It is a temporary rentable resource with policy, metering, proof, and execution boundaries. Examples include:

- GPU / CPU / memory / storage.
- VPS and sandbox.
- Cloud browser session.
- Dataset or paid API.
- Repository/project workspace.
- Specialized agent service.
- Temporary credential reference.

### 7.2 Provider / Short Miner

Provider or Short Miner supplies real capabilities, stores hot order objects, responds with signed availability, signed price, receipt, and proof material, and receives the primary revenue.

In the default economic model, the provider / Short Miner that completes the work receives most transaction revenue, for example 94%, and protocol fee may be 6%.

### 7.3 Long Miner

Long Miner maintains shard index, routing, epoch root, availability metadata, and a higher-reputation indexing layer. It does not need to store every hot object, but it helps agents quickly find trustworthy supply.

### 7.4 Auditor Agent

Auditor Agent verifies signed evidence, Merkle proof, receipts, uptime reports, task proofs, and dispute material. It participates in reputation, slashing, and dispute resolution.

### 7.5 EXORA Token

SOL/USDC are suitable as early low-friction payment assets. EXORA's design role is protocol security, staking, miner admission, auditor stake, DAO governance, insurance, buyback, and burn.

Token, staking, slashing, DAO, and onchain settlement are future network-layer capabilities. They should not be described as completed in the current local MVP.

## 8. Security and Permission Model

Exora Dock's security model is built around one principle: agents can organize cooperation, but they cannot override the user.

### 8.1 Do Not Merge Authorizations

The following actions must be separated:

- Start organizing a plan.
- Allow submission of agent requirements and remote manifest for matching.
- Select seller.
- Approve file / identity / context disclosure.
- Approve payment or escrow.
- Approve real external writes or irreversible actions.
- Accept delivery and release funds.

### 8.2 Data Minimization

The remote task manifest should contain only what the executor needs to know. Sensitive files, identity, API tokens, private keys, wallet secrets, and unrelated local context should not be uploaded by default.

### 8.3 Quote Integrity

Remote quotes should bind provider card, capability claim, price, ETA, expiry, timestamp, limitations, risks, and signature. Quotes without signatures or clear source can only be references and must not directly enter the transaction.

### 8.4 Execution Evidence

The executor should return artifact manifest, log summary, hashes, environment summary, terminal report, and cleanup receipt. A completion claim without evidence should not be considered trustworthy.

### 8.5 Failure Recovery

Every pause point must have a clear waiting party: user, Buyer Agent, Cloud, Seller Agent, Provider Docker, or local supervisor. Every state should be recoverable, retryable, cancelable, or terminal.

### 8.6 Format and State Constraints

Critical cross-boundary messages must have a schema or equivalent structured format, including task requirements, agent requirements, remote task manifest, provider valuation, execution plan, terminal report, artifact manifest, and cleanup receipt.

Dock and Provider Docker should validate input/output formats at important checkpoints. If required input, budget, permission, output format, acceptance criteria, hash, or receipt is missing, the system must stop at the current stage and request completion. Results that fail schema, sample, hash, or receipt validation cannot enter verification, release, or final settlement.

## 9. MVP Scope

The current desktop product should commit to:

- Local Dock daemon.
- Desktop Buyer/Seller console.
- Transaction-first order list.
- Buyer plan-first flow.
- Seller API-only monitor and order view.
- Card Market / Cart as capability discovery entry.
- MCP discovery and task handoff.
- REST fallback.
- Approval queue.
- Payment / escrow record.
- Task / work run / artifact metadata.
- Local archive / unread / pinned records.

The current product should not commit to:

- Production-grade cloud matching.
- Real onchain escrow.
- Production staking/slashing.
- Real DAO governance.
- Complete miner network.
- Complete reputation ledger.
- Automatic upload of all files.
- Agent approving/paying on behalf of the user.

## 10. Roadmap

### P0: Local Plan-first

- Buyer Agent classifies `chat / clarify / candidate_task / manual_plan`.
- Candidate task shows start confirmation.
- Generate local task requirements, agent requirements, and remote manifest.
- User reviews remote manifest.
- MCP and REST fallback can drive the task flow.

### P1: Local Mock Matching

- Match with local cards / mock sellers.
- Generate quote review.
- Create durable order plan.
- Support seller selection, approval, payment record, and task record.

### P2: Real Server Matching

- Submit `agent_requirements` and `remote_task_manifest`.
- Match at most a limited number of sellers.
- Seller enters task valuation and returns quote, needs_negotiation, or reject.

### P3: Pre-transaction Confirmation

- User selects quote.
- Dock creates approval request.
- Handle payment / escrow record.
- Input manifest and file transfer proceed through controlled flow.

### P4: Controlled Execution and Verification

- Provider generates execution plan.
- Provider Docker / local supervisor supervises execution.
- Return artifact manifest, logs, hashes, and terminal report.
- Buyer assists verification, dispute, or settlement.

### P5: Network Economy Layer

- Short Miner listing.
- Long Miner index.
- Auditor Agent.
- Signed receipt and proof.
- Reputation.
- Onchain settlement anchoring.
- EXORA staking, slashing, DAO, buyback/burn.

## 11. Relationship to Existing Documents

This document is the unified product and protocol overview for Exora Dock. Detailed specifications remain in dedicated documents:

- `docs/agent-whitepaper.md`: Agent Flow, plan-first, Buyer/Seller state machine, manifest schema, and MCP tool recommendations.
- `docs/economy/WHITEPAPER.md`: Capability economy, miner, auditor, token, fee, staking, slashing, DAO, and roadmap.
- `docs/agent-discovery.md`: Local discovery manifest, MCP entrypoint, dual-token auth, and REST fallback.
- `README.md`: Project introduction, Quick Start, development, and API index.

## 12. Conclusion

The core of Exora Dock is not to create a stronger monolithic agent. It is to let agents organize external cooperation within the user's authorization boundary.

It turns natural language tasks into transaction objects, external capabilities into quotable resources, user permissions into explicit approvals, execution results into artifacts/proofs/receipts, and delivery into a verifiable, settleable, disputable, and recoverable state machine.

Ultimately, Exora Dock aims to become the local transaction control plane for the agent era:

```text
Human intent
  -> Buyer Agent planning
  -> Seller capability matching
  -> quote and consent
  -> escrow and execution
  -> artifact, proof, verification
  -> settlement and reputation
```

This is what Exora Dock is building: a way for AI agents to safely buy, sell, supervise, and settle external capabilities.
