# Exora Dock: An Agent-Native Capability Economy

Draft status: protocol and economy design
Last updated: 2026-07-01

This document is not legal, financial, investment, tax, or regulatory advice. EXORA token allocations, sales, airdrops, staking, mining rewards, and burn mechanics are protocol design assumptions for simulation and discussion. Any public sale, crowdfunding campaign, airdrop, or staking program requires jurisdiction-specific legal review before launch.

## Abstract

Exora Dock is an agent-native marketplace for temporary capabilities. A human expresses intent, grants bounded authority, and lets an agent extend its own boundary by leasing what it needs: compute, GPU time, browser sessions, VPS capacity, execution sandboxes, temporary storage, paid datasets, paid APIs, and other machine-usable services.

The network is designed for speed first. Hot market data stays offchain in a shard-centralized network operated by miners. Onchain state records the parts that must be durable and punishable: miner identity, stake, service endpoints, epoch roots, settlement records, reputation changes, and signed evidence for slashing.

The economic system uses SOL and USDC as the primary payment assets for low-friction settlement. EXORA is the protocol token for miner rewards, staking requirements, DAO governance, insurance, buyback, and burn. This avoids forcing every agent payment through a volatile token while still giving EXORA a direct role in protocol security and ownership.

## 1. Thesis

The web is moving from human-operated software to agent-operated software. Existing clouds, data marketplaces, and payment rails are still mostly built around human accounts, human billing flows, human dashboards, and slow procurement. Exora Dock treats agents as first-class economic actors.

The core product is not an API marketplace that agents can optionally use. The core product is an operating layer where agents can buy, sell, maintain, audit, and arbitrate capabilities with minimal human intervention.

Exora Dock has three claims:

1. Agents need resources that are short-lived, programmable, and composable.
2. Users should be able to become part of the network by running Exora Dock.
3. The network should be fast enough for agents, but verifiable enough for money, reputation, and punishment.

This leads to a distributed-centralized architecture:

- Centralized where latency matters: listing discovery, order shards, local storage, routing, caching, and matching.
- Distributed where trust matters: multiple Long Miner indexes, multiple Short Miner responses, signed receipts, Merkle roots, challenge evidence, and DAO-governed slashing.
- Onchain where final accountability matters: stake, roots, endpoints, settlement anchors, treasury, EXORA emissions, buyback, burn, and governance.

## 2. Verified Market Basis

The market direction is already visible.

- Agent sandboxes exist as a category. E2B positions itself as cloud infrastructure for AI agents with secure execution environments.
- Cloud browsers exist as an agent capability. Browserbase provides browser sessions for agents that need to interact with the web like human users.
- GPU capacity is already sold by workload and duration. RunPod exposes GPU products such as Pods, Serverless, and Clusters with usage-based pricing.
- Paid data marketplaces are established. AWS Data Exchange and Snowflake Marketplace support paid data products, listings, offers, and data subscriptions.
- Agent payments are becoming real infrastructure. x402 uses HTTP 402 for programmatic stablecoin payments; AWS AgentCore Payments and Stripe Machine Payments show that paid APIs, MCP servers, browser access, and other agent resources can be monetized through machine payment flows.

Exora Dock differs by joining these categories into one agent-operated economy. It is not only a resource marketplace. It is a miner-operated agent capability network with identity, reputation, staking, slashing, DAO control, and a path for users to become providers.

## 3. Network Actors

### User

A user owns intent, budget, risk limits, and permission boundaries. The user can operate through a visual app or run a headless node. The user may be a buyer, a provider, or both.

### Agent

An agent interprets user intent and leases capabilities on Exora Dock. It can discover listings, compare prices, pay for resources, verify receipts, report failures, and submit disputes. Agents are expected to operate with scoped delegation, spending limits, nonces, expiries, and revocation paths.

### Exora Dock

Exora Dock is the local capability endpoint. It can run as:

- Connect Mode: exposes user-approved capabilities to agents.
- Mine Mode: turns user hardware or accounts into a Short Miner endpoint.
- Audit Mode: verifies disputes, checks proofs, and participates in agent-assisted review.

Exora Dock is both a local agent runtime and a future mini miner endpoint.

### Short Miner

A Short Miner provides temporary capability supply. Examples include short-lived VPS capacity, GPU time, browser sessions, execution environments, datasets, storage slices, API access, proxy access, and specialized task execution.

Short Miners store hot order objects and data shards locally. They respond to agent requests with signed availability, signed prices, signed receipts, and proof material. They earn the majority of lease revenue.

### Long Miner

A Long Miner is a high-reputation shard operator. Long Miners do not need to store every hot object in full. Their main responsibilities are:

- Maintain shard indexes for Short Miner listings.
- Anchor epoch roots onchain.
- Publish service endpoints and availability status.
- Route agents to Short Miners.
- Co-sign index state for accountability.
- Hold higher stake and accept higher slashing risk.

Long Miners are the backbone of the distributed-centralized market layer.

### Auditor Agent

An Auditor Agent checks signed evidence. It can verify Merkle proofs, compare signed responses, replay task receipts, inspect uptime reports, and recommend slashing or dismissal. Auditor Agents earn from the auditor pool and may be slashed for false or malicious judgments.

### DAO

The DAO governs protocol parameters, treasury spending, miner admission policy, slashing rules, appeal paths, emissions, buyback, burn, and upgrades. The DAO should not vote on normal transactions. It governs the rules of the market, not every action inside the market.

### Treasury

The Treasury receives a portion of protocol fees and token allocation. It funds development, grants, liquidity, audits, insurance reserves, public goods, and ecosystem growth.

## 4. Capability Market

Exora Dock lists machine-usable capabilities rather than physical goods.

Initial capability categories:

- Temporary project workspaces.
- Temporary VPS capacity.
- GPU micro-rentals.
- Browser sessions and browser automation.
- Secure execution sandboxes.
- Temporary storage and data shards.
- Paid datasets.
- Paid APIs and MCP servers.
- Proxy and reverse-gateway style access.
- Agent-operated task services.

Each listing should be represented as a signed machine-readable object:

- `listing_id`
- `provider_account_id`
- `resource_type`
- `price_asset`
- `price_amount`
- `billing_unit`
- `min_duration`
- `max_duration`
- `region`
- `capability_manifest_hash`
- `policy`
- `expires_at`
- `nonce`
- `signature`

The listing object is stored offchain by Short Miners and indexed by Long Miners. The hash of listing batches is committed into epoch roots.

## 5. Shard-Centralized Data Layer

The data layer optimizes for immediate agent use.

### Hot Path

1. A Short Miner publishes a signed listing or accepts delegated inventory from a user.
2. The listing is assigned to one or more shards.
3. Long Miners index the listing hash, provider endpoint, shard id, expiry, and availability metadata.
4. Agents ask two or three Long Miners for index data.
5. Agents ask two or three Short Miners for the full listing or order object.
6. Agents verify signatures, hashes, expiries, and Merkle inclusion proofs.
7. If responses match, the agent proceeds.
8. If responses conflict, the agent expands the query set and prepares signed evidence.

Truth is not determined by majority alone. Truth is determined by signatures, hashes, Merkle roots, epoch roots, and the latest valid signed state. Majority query is a fast discovery and fault-detection method, not the final source of truth.

### Epoch Roots

Long Miners periodically create epoch roots for shard indexes:

- `epoch_id`
- `chain_id`
- `long_miner_account_id`
- `shard_range`
- `index_root`
- `listing_count`
- `previous_epoch_root`
- `created_at`
- `signature`

The root is anchored onchain. The full index remains offchain for speed. This mirrors the general design of compressed state: keep heavy data offchain while storing a compact commitment onchain.

### Data Availability

Short Miners are responsible for serving the hot objects they advertise. Long Miners are responsible for keeping enough index redundancy that agents can route around failures.

Default redundancy targets:

- Each active listing is indexed by at least three Long Miners.
- Each hot order object is replicated or reconstructable across at least three Short Miner paths.
- Any high-value order requires stronger replication, shorter epoch intervals, or higher provider stake.

### Challenge Flow

A challenge may be opened when an agent or miner produces:

- A signed index response that conflicts with an anchored root.
- A signed listing that fails hash inclusion.
- A signed acceptance followed by non-delivery.
- A stale listing presented as current.
- A forged receipt.
- A double-settlement attempt.

The challenger submits signed evidence. Auditor Agents verify the evidence. If the case is clear, slashing can be automatic. If the case is ambiguous, it enters DAO appeal or council review.

## 6. Settlement Layer

Exora Dock should be Solana-first but chain-agnostic.

Solana is suitable for the first settlement layer because it has low transaction fees, native token tooling, and an existing AI agent direction. However, Exora Dock should not bind agent identity or payments to a single chain forever.

Settlement design:

- Use SOL and USDC as primary settlement assets.
- Use x402-style HTTP 402 flows for paid resources.
- Use CAIP-10 account identifiers for chain-agnostic actor identity.
- Use CCTP where native USDC needs to move across chains.
- Anchor critical protocol state on Solana first.
- Allow future settlement adapters for Base, Ethereum L2s, and other chains.

Onchain state should be minimal:

- Miner registry.
- Stake and lock status.
- Endpoint hash and metadata hash.
- Long Miner online/offline events.
- Epoch roots.
- Settlement receipt anchors.
- Slashing records.
- Reputation checkpoints.
- DAO proposals and executed parameter changes.
- EXORA mint, vesting, reward, buyback, and burn records.

## 7. EXORA Token

EXORA is required for protocol launch, miner rewards, staking requirements, DAO governance, and burn mechanics. It is not the primary payment asset for every resource lease. This separation is intentional.

SOL and USDC maximize agent payment usability. EXORA secures and governs the network.

### Utility

EXORA is used for:

- Long Miner stake.
- Short Miner bond.
- Auditor Agent stake.
- DAO voting.
- Miner rewards.
- Reputation weighting.
- Slashing penalties.
- Insurance backstop accounting.
- Buyback and burn.
- Priority admission for scarce miner slots, subject to DAO rules.

EXORA should not be presented as a guaranteed yield instrument. Rewards depend on real network usage, protocol emissions, miner performance, and DAO-governed parameters.

### Genesis Supply

Default total supply: `1,000,000,000 EXORA`

| Allocation | Share | Amount |
| --- | ---: | ---: |
| Miner rewards | 35% | 350,000,000 |
| Airdrop and community bootstrap | 20% | 200,000,000 |
| DAO Treasury | 15% | 150,000,000 |
| Team and contributors | 15% | 150,000,000 |
| Public sale and crowdfunding | 10% | 100,000,000 |
| Liquidity | 5% | 50,000,000 |

### Vesting Defaults

- Miner rewards: emitted over time according to DAO-approved schedules.
- Airdrop: claim windows, Sybil filters, and task-based eligibility.
- DAO Treasury: controlled by governance, with spending transparency.
- Team and contributors: 12 month cliff, 48 month linear vesting.
- Public sale and crowdfunding: legal review required before launch.
- Liquidity: DAO-controlled market-making and exchange liquidity budget.

### Emission Policy

The network should not depend on permanent inflation. Emissions bootstrap supply and behavior in early phases. Over time, real protocol fees should become the main reward source.

Default emission split for simulation:

- 60% to Short Miner incentives.
- 30% to Long Miner incentives.
- 10% to Auditor Agent incentives.

The DAO may reduce emissions as lease volume grows.

## 8. Fee Model

Default lease fee split:

- 94% to the Short Miner or provider that fulfills the lease.
- 6% protocol fee.

Default protocol fee split:

| Destination | Share of protocol fee |
| --- | ---: |
| Long Miner rewards | 25% |
| Auditor pool | 15% |
| DAO Treasury | 25% |
| Insurance and slashing reward pool | 15% |
| EXORA buyback and burn | 20% |

Formula:

```text
gmv = daily_leases * average_lease_price * days
provider_income = gmv * 0.94
protocol_fee = gmv * 0.06
long_miner_pool = protocol_fee * 0.25
auditor_pool = protocol_fee * 0.15
treasury_income = protocol_fee * 0.25
insurance_pool = protocol_fee * 0.15
buyback_burn_budget = protocol_fee * 0.20
```

This model makes Short Miners the main economic winners from real work, while Long Miners and Auditor Agents are paid for coordination, availability, verification, and trust.

## 9. Staking and Slashing

Staking creates economic accountability for machine-operated work.

### Genesis Stake Defaults

| Role | Minimum EXORA stake | Lock default |
| --- | ---: | ---: |
| Long Miner | 1,000,000 | 30 days |
| Short Miner | 10,000 | 7 days |
| Auditor Agent | 100,000 | 14 days |

These are genesis parameters for modeling. The DAO can change them after launch.

### Slashing Events

Slashable behavior includes:

- Signing a false index.
- Serving data that does not match a committed hash.
- Accepting payment and failing to deliver.
- Replaying expired listings.
- Double-signing incompatible state.
- Forging receipts or proof material.
- Censoring valid listings after accepting Long Miner duties.
- Falling below required uptime after repeated warnings.
- Auditor collusion or knowingly false verdicts.

Suggested slashing ranges:

| Severity | Slash range |
| --- | ---: |
| Minor availability fault | 0.1% to 1% |
| Repeated availability fault | 1% to 5% |
| False signed data | 5% to 20% |
| Payment fraud or forged proof | 20% to 100% |
| Auditor collusion | 20% to 100% |

Slashed value can be split between the harmed party, the challenger, the insurance pool, and burn according to DAO parameters.

## 10. Reputation

Reputation should be portable, machine-readable, and hard to fake.

Signals:

- Completed leases.
- Successful challenge history.
- Uptime.
- Response latency.
- Stake size and lock duration.
- Dispute rate.
- Slashing history.
- Agent feedback.
- DAO or council attestations.

Reputation should not be a simple popularity score. It should be scoped by capability type. A miner that is excellent at browser sessions is not automatically trusted for GPU workloads or paid datasets.

## 11. DAO Design

The DAO evolves in stages.

### v0: Multisig Bootstrap

The initial DAO uses a multisig for:

- Treasury control.
- Emergency parameter changes.
- Miner admission policy.
- Initial emissions.
- Smart contract upgrade authority.

This is faster and safer before the network has enough real participants.

### v1: EXORA Governance

EXORA holders govern core parameters:

- Protocol fee.
- Fee split.
- Stake minimums.
- Slashing ranges.
- Emission schedules.
- Treasury grants.
- Miner admission constraints.
- Supported settlement adapters.
- Supported resource classes.

Voting should include safeguards against instant governance capture, such as timelocks, quorum, proposal deposits, and optional reputation weighting.

### v2: Agent-Assisted Governance

Agent Auditors and governance agents can:

- Summarize proposals.
- Simulate parameter changes.
- Flag malicious proposals.
- Verify onchain and offchain evidence.
- Draft slashing recommendations.
- Maintain public dashboards.

Agents can assist governance, but the DAO should retain explicit execution rules and appeal paths.

## 12. Agent Permission Model

Exora Dock depends on users safely delegating authority.

Every agent mandate should include:

- User account.
- Agent account.
- Budget.
- Asset allowlist.
- Resource allowlist.
- Time window.
- Maximum price per unit.
- Maximum total spend.
- Revocation path.
- Required receipt type.
- Policy hash.
- Nonce.
- Expiry.
- Signature.

Agents should never receive unlimited authority by default. Delegation should be narrow, typed, inspectable, and revocable.

## 13. Security Model

The protocol assumes some miners will fail or lie. The system must make lying expensive and failure routeable.

Security primitives:

- Signed listings.
- Signed index responses.
- Signed acceptances.
- Signed delivery receipts.
- Nonces and expiries.
- Merkle roots and inclusion proofs.
- Epoch root anchoring.
- Chain-agnostic account ids.
- Stake locks.
- Slashing evidence.
- Auditor Agent review.
- DAO appeals.

The hot path is optimistic. The dispute path is cryptographic.

## 14. Economic Sustainability

The healthiest version of Exora Dock is not powered by emissions alone. It is powered by useful work.

Short Miners earn because agents need real resources.
Long Miners earn because agents need fast indexes and reliable routing.
Auditor Agents earn because the network needs low-cost enforcement.
The DAO earns because the protocol coordinates trust, settlement, and liquidity.
EXORA accrues utility because miners need it for stake, agents need trustworthy miners, and protocol fees can buy and burn it.

The key loop is:

1. More useful capabilities attract more agents.
2. More agent demand increases lease volume.
3. More lease volume pays miners in real assets.
4. Higher miner revenue attracts more supply.
5. More supply increases agent capability.
6. Protocol fees fund treasury, auditors, insurance, and EXORA burn.
7. EXORA staking and slashing secure the next cycle.

## 15. Roadmap

### Phase 0: Documentation and Simulation

- Publish the English whitepaper.
- Publish the economic simulation script.
- Define genesis fee and stake parameters.

### Phase 1: Centralized Alpha

- Exora Dock capability registry.
- Basic Short Miner listings.
- Centralized matching server.
- SOL/USDC manual or semi-automated settlement.
- Signed receipts and local audit logs.

### Phase 2: Shard-Centralized Market

- Long Miner index service.
- Short Miner hot object storage.
- Multi-miner query.
- Merkle roots and signed responses.
- Agent challenge flow.

### Phase 3: Onchain Anchoring

- Miner registry.
- Stake locks.
- Epoch root anchoring.
- Settlement receipt anchors.
- Basic slashing.
- DAO treasury.

### Phase 4: EXORA Launch

- Public sale or crowdfunding, subject to legal review.
- Airdrop and community bootstrap.
- Miner reward emissions.
- EXORA staking requirements.
- Buyback and burn from protocol fees.

### Phase 5: Agent-Operated Network

- Agent Auditors.
- Agent-assisted governance.
- Multi-chain settlement adapters.
- Automated miner admission.
- Reputation-weighted routing.
- DAO-controlled protocol upgrades.

## 16. Reference Basis

- Solana transaction fees: https://solana.com/docs/core/fees
- Solana Token Extensions: https://solana.com/docs/tokens/extensions
- Realms and SPL Governance: https://docs.realms.today/developer-resources/spl-governance
- Coinbase x402: https://docs.cdp.coinbase.com/x402/welcome
- AWS AgentCore Payments: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html
- Stripe Machine Payments x402: https://docs.stripe.com/payments/machine/x402
- CAIP-10 account identifiers: https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-10.md
- Circle CCTP: https://developers.circle.com/cctp
- Ethereum state channels: https://ethereum.org/developers/docs/scaling/state-channels/
- Solana account compression: https://github.com/solana-labs/solana-program-library/blob/master/docs/src/account-compression.md
- AWS Data Exchange: https://docs.aws.amazon.com/marketplace/latest/userguide/data-products.html
- Snowflake Marketplace listings: https://docs.snowflake.com/en/collaboration/collaboration-listings-about
- E2B: https://e2b.dev/
- Browserbase: https://www.browserbase.com/
- RunPod pricing: https://www.runpod.io/pricing
