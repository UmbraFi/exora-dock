---
name: prepare-exora-api
description: 从获授权的卖家材料准备一份完整 exora.api-contract.v1 源文件，包含 API 能力、安全 Seller 案例和显式的卖家指定计费规则；Dock 单独执行并确认验证。
---

# 准备 Exora API

[English](SKILL.md) | 简体中文

权威输出是一份不含 UID 的 `exora.api-contract.v1` JSON 文件。Dock 在提交时将它绑定到所选稳定 API UID。文件包含完整 `exora.api.v3` 能力、带参数语义的 OpenAPI 输入和输出 Schema、安全 Seller 案例、可信计量，以及每个 Operation 恰好一项显式自动计费规则。Agent 可以编码卖家明确提供的定价意图，但绝不能选择或推荐费率。

使用 `exora.submit_api_contract` 提交完整文件后停止。只有所有者可以执行独立的接入和计费验证，对同一份受测合约确认一次、发布或变更生命周期。

使用 Exora MCP 作为准备手册和分步说明来源。

1. 连接卖家的 Exora Dock MCP Server。若 `exora.get_api_preparation_guide` 不可用，停止并请卖家连接或重启 Dock。
2. 识别最接近的 `startingPoint` 和预期 `deliveryMode`。
3. 从 `assess` 开始，遵循每一步返回的证据要求，遇到阻塞即停止。
4. 在 `assemble_form` 阶段构建一份无 UID 的 `exora.api-contract.v1`；不要在根节点或 capability 中写 `apiId`。包含完整 `exora.api.v3` 能力、权威 OpenAPI 3.1 响应契约、安全且针对具体能力的测试样例、可信计量声明和每个 Operation 恰好一项显式计费规则。固定价格不要虚构 `request` 计量。测试样例选择预期协议格式，绝不能包含预期动态业务结果。
5. 在 `submit` 阶段选择预期的现有非 Live Draft。若不存在，使用卖家提供的标题、交付方式和可安全重试的幂等键调用一次 `exora.create_api_draft`。随后以返回的 `apiId`、当前 `expectedVersion`、完整合约和另一个可安全重试的幂等键调用 `exora.submit_api_contract`。
6. 解决静态合约问题，读取当前 Draft，然后停止，等待所有者执行 Contract validation 并一次确认两份凭证。

绝不提交凭证、所有者确认、执行批准、商业权利声明或生命周期变更。绝不代卖家选择价格值。Dock 验证和仓库内合约是权威依据。
