# Electron 运行时

[English](README.md) | 简体中文

此目录负责包裹本地 Exora Dock daemon 的桌面外壳。

## 文件

- `main.cjs` 启动 Electron、创建主窗口、管理捆绑 daemon、持久化桌面专用状态，并把所有者批准的操作代理到本地 Dock HTTP API。
- `preload.cjs` 仅暴露 `window.exora.invoke(command, payload)` 窄桥接接口和启动语言元数据，不暴露 Node.js API。
- `ipc.cjs` 包含通用 IPC 注册辅助函数和重复命令检查；命令的领域归属仍在 `main.cjs` 中分组。
- `security.cjs` 包含渲染器信任策略、导航防护、外部链接处理和 IPC 发送方验证。
- `legacy-frontend-cleanup.cjs` 一次性清理已退役的 chat、transaction、project-session 和 local-Agent 桌面数据，支持安全重试。
- `check.cjs` 在 `npm run build:electron` 期间检查此目录中每个 CommonJS 脚本的语法。

## IPC 结构

渲染器调用唯一通道 `exora:invoke`，并传入命令字符串。`main.cjs` 按领域分组命令：

- `window`：最小化、关闭、最大化，以及切换认证/工作区窗口尺寸。
- `cloudIdentity`：Cloud Session、注册、恢复、PIN 和退出登录。
- `dockRuntime`：daemon 生命周期、健康状态、日志、MCP 提示词/配置字符串。
- `persistence`：仅包含 v2 应用偏好设置和语言。
- `apiMarket`：API Listing、分阶段 Integration Session、Invocation 和活动历史。
- `walletAndSecurity`：平台钱包、提现和安全状态。

添加命令时，把处理函数放在 `main.cjs` 中对应领域逻辑附近，将其加入 `createIpcHandlerGroups()` 的相关分组，并保持渲染器 payload 为普通可 JSON 序列化数据。

## 安全模型

仅可信应用 URL 可以使用 IPC：

- 开发环境信任 `EXORA_DOCK_DESKTOP_DEV_URL` 配置的 Vite Origin，默认 `http://127.0.0.1:1420`。
- 打包版本仅信任 `dist/` 下的文件。

禁止离开应用的顶层导航。渲染器打开的 HTTP、HTTPS 和邮件链接交给操作系统浏览器处理，不会让桌面桥接接口继续附着在外部页面上。
