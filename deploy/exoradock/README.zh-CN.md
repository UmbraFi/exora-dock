# 旧版独立 Dock 部署

[English](README.md) | 简体中文

> 此目录保留为运维参考，用于在容器中运行 Dock daemon。它不是 Exora V3.2 的生产拓扑，不得作为公开 Exora Cloud API 暴露。

当前正式运行时的职责划分如下：

- Exora Cloud 负责身份、设备、V3 目录、购买、Lease、DownloadGrant、API Order、计费、托管、结算和 API Bridge 执行。
- Exora Dock 是关联账户的软件，负责本地 Agent 授权、VM Worker 控制、Endpoint 凭证与出站隧道、WebRTC VM 文件传输，以及私有 Seller Draft 准备。
- Provider Dock 主动发起到 Cloud 的出站连接。Cloud 不需要访问 Provider 机器上的入站管理端口。

此目录中的 Compose 和 Nginx 文件早于上述职责划分。尤其是旧版 `/v1/buyer-flows`、seller-quote、simulated-payment、chat、planning、revision、artifact-delivery 和 rating 工作流均已退役，没有兼容路由。

当前本地开发请从仓库根目录运行 daemon：

```powershell
go run ./cmd/exora-dock .\config.example.yaml
```

连接本地 Agent 时，单独运行 MCP Server：

```powershell
go run ./cmd/exora-dock mcp .\config.example.yaml
```

生产运维应使用 `../../../exora-cloud/deploy/production` 中的服务、Nginx、备份、Vault/KMS、托管和迁移资料部署 Exora Cloud，再通过当前设备注册流程关联 Provider Dock。绝不可通过 Nginx 公开 Dock owner token、本地 Agent session key、账户 API key、Endpoint 凭证或 `data/auth.json`。
