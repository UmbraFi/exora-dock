# Desktop UI 开发

[English](DESKTOP_DEV.md) | 简体中文

迭代 Desktop 前端时使用 Electron 开发运行器。它会打开实时 Desktop 窗口并重载前端修改，无需重新构建或安装 NSIS 包。

```powershell
cd C:\Users\malou\Documents\GitHub\ExoraDock\exora-dock\desktop
npm run preview:desktop
```

preview 命令会先从当前 Go 源码重建 `exora-dockd`，再启动 Electron。请先停止已运行的开发版 Desktop，让 Windows 能够替换辅助可执行文件，避免 UI 和 MCP Server 静默运行不同协议版本。

开发版依次从 `EXORA_CLOUD_URL`、持久化 Dock `cloud_url` 和默认 `http://127.0.0.1:8090` 解析 Exora Cloud。打包版本必须配置明确的 HTTPS Cloud URL：

```powershell
$env:EXORA_CLOUD_URL = "https://cloud.example.com"
npm run preview:desktop
```

邮箱/密码 Session 使用 Electron `safeStorage` 加密。若主机无法提供安全存储，Session 仅保存在内存中，并在 Electron 进程退出时失效。当审批、提现、支出策略变更或账户密钥操作需要六位 Payment PIN 时，它仅通过 HTTPS 发送给已认证的 Cloud 验证端点。Desktop 和 Dock 不持久化 PIN。

UI 迭代主要修改：

- `desktop/src/main.ts`
- `desktop/src/styles.css`

在 **Settings → Agent Connections** 中，**Test** 执行真实 stdio MCP initialize，验证必要工具接口，并对 `vm`、`resources`、`endpoint` 和 `api_bridge` 执行只读目录搜索。它不会购买、发布、调用 Operation 或创建 Draft。

仅在 UI 获得批准后构建安装程序：

```powershell
npm run build
```

Windows 安装程序生成于：

```text
desktop\release
```
