# 虚拟文本摘要 API

[English](README.md) | 简体中文

此本地测试样例不依赖外部服务，用于验证 Exora Provider 工作流。

## 运行时

从 `exora-dock` 目录启动现有测试服务：

```powershell
node .\scripts\dev-summary-test-api.cjs
```

服务提供：

- `GET http://127.0.0.1:3000/health`
- `POST http://127.0.0.1:3000/summarize`

## API 合约

使用 [`contract.json`](./contract.json) 作为唯一源文件，在 **Contract validation** 中上传该 JSON。JSON 不含 API UID；Dock 注入当前打开 Draft 的稳定 UID。同一文件包含 API 能力、Seller 案例和自动计费规则，没有单独的表单。

两个 Seller 测试样例分别验证成功响应和声明的 `invalid_text` 业务错误封装。它们有意检查状态码、媒体类型和 OpenAPI 响应 Schema，不比较摘要文本的精确值。

## 合并验证

选择 **Test contract**。Dock 首先验证连通性和返回格式，再在 Cloud Sandbox Ledger 中测试 `delivered * 0.03`，单次调用上限为 `0.05` USDC。沙盒不移动真实 USDC。两份凭证都通过后，所有者只需选择一次 **Confirm contract**，随后解锁 Operations。
