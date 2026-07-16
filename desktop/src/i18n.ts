export type AppLanguage = 'en' | 'zh'

type Params = Record<string, string | number | boolean | undefined | null>

const appLanguageStorageKey = 'exora.language'

const namedMessages = {
  en: {
    'listings.agentHint': 'Tell your Agent: \u201cUse Exora MCP.\u201d',
    'listings.agentPrompt': 'Use Exora MCP.',
    'listings.agentCopy': 'Copy Agent instruction',
    'listings.agentDetails': 'About Exora MCP',
    'listings.guide.title': 'Use Exora with your Agent or buy manually',
    'listings.guide.subtitle': 'Both paths use the same published Listings, prices, availability, and account history.',
    'listings.guide.intro': 'Exora Dock does not include another chat Agent. Continue with your own MCP-capable Agent, or expand any product and complete the purchase directly in this desktop app.',
    'listings.guide.promptLabel': 'Tell your Agent',
    'listings.guide.agentTitle': 'Buy through your own Agent',
    'listings.guide.agentStep1': 'Keep Exora Dock running and sign in to your account.',
    'listings.guide.agentStep2': 'Tell the Agent to use Exora MCP. It can connect through the local Dock, search the same market, and read manifests, prices, availability, and isolation disclosures.',
    'listings.guide.agentStep3': 'The Agent can estimate charges, purchase compute minutes or a download grant, invoke paid API operations, create transfers, read usage, and release leases.',
    'listings.guide.agentStep4': 'Paid calls require a stable idempotency key and maximum authorized charge. Cloud balance, budget, and approval rules still apply.',
    'listings.guide.manualTitle': 'Buy directly in Listings',
    'listings.guide.manualStep1': 'Expand a Buyer Listing and review its manifest, provider, price, availability, license, and isolation disclosures before continuing.',
    'listings.guide.manualStep2': 'Stay signed in, then use the controls inside the expanded Listing. Manual purchases use your Cloud session and do not require an API key.',
    'listings.guide.manualStep3': 'Use the controls inside the product to purchase compute, obtain a fixed-version download grant, or invoke a declared API operation.',
    'listings.guide.manualStep4': 'Purchases, leases, usage, and ledger results appear in Buyer activity history.',
    'listings.guide.productsTitle': 'What the current desktop supports',
    'listings.guide.computeTitle': 'Compute',
    'listings.guide.computeBody': 'Estimate and purchase whole minutes, inspect the provisioned lease, extend it, or release it early. Unused minutes are not refunded after voluntary release.',
    'listings.guide.downloadTitle': 'Downloads',
    'listings.guide.downloadBody': 'Pay once for a non-transferable, time-limited DownloadGrant. Transfers are resumable and the package is verified with SHA-256 before delivery.',
    'listings.guide.apiTitle': 'API operations',
    'listings.guide.apiBody': 'Choose a declared operation, fill its parameters and request body, review the maximum charge, then invoke it and inspect the redacted result.',
    'listings.guide.realityTitle': 'Current boundaries',
    'listings.guide.reality1': 'Only published and currently available marketplace Listings can be purchased; you cannot purchase your own Listing.',
    'listings.guide.reality2': 'Actual completion depends on Exora Cloud, provider readiness, your account balance, and any required approval.',
    'listings.guide.reality3': 'The desktop is a management and manual-purchase surface, not a built-in Agent chat. Your Agent remains your own MCP client.',
    'listings.guide.reality4': 'Never give an Agent your payment PIN, wallet private key, provider credential, or owner token. Your unified buyer SK remains active until you manually rotate or revoke it.',
    'listings.guide.footer': 'Exora Dock must remain running for local MCP access.',
    'toast.agentPromptCopied': 'Agent instruction copied.',
    'app.signedOut': 'Signed out',
    'app.userFallback': 'Exora User',
    'toast.identifierCopied': 'Identifier copied.',
    'toast.listingReplacementStarted': 'Replacement draft started. Submit again to create a new private Listing.',
    'toast.paymentPinChanged': 'Payment PIN changed successfully.',
    'toast.orderKeyRevoked': 'Unified buyer SK revoked.',
    'toast.orderKeyCopied': 'Unified buyer SK copied. Clipboard clears in 60 seconds.',
    'toast.orderKeyCreated': 'Unified buyer SK created.',
    'toast.approvalApproved': 'Payment approved. Your Agent can retry the action.',
    'toast.approvalRejected': 'Payment request rejected.',
    'toast.agentLimitsUpdated': 'Agent automatic payment limits updated.',
    'toast.agentPaymentsDisabled': 'Agent automatic payments disabled.',
    'toast.walletAddressCopied': 'Wallet address copied.',
    'profile.signOut': 'Sign out',
    'profile.signedOut': 'Signed out',
    'profile.language': 'Language',
    'profile.theme': 'Theme',
    'profile.english': 'English',
    'profile.chinese': 'Chinese',
    'profile.light': 'Light',
    'profile.dark': 'Dark',
    'permission.ask.label': 'Ask for approval',
    'permission.ask.description': 'Always ask to edit external files and use the internet',
    'permission.approve.label': 'Approve for me',
    'permission.approve.description': 'Only ask for actions detected as potentially unsafe',
    'permission.full.label': 'Full access',
    'permission.full.description': 'Unrestricted access to the internet and any file on your computer',
    'permission.custom.label': 'Custom (config.toml)',
    'permission.custom.description': 'Uses permissions defined in config.toml',
    'chrome.showSidebar': 'Show sidebar',
    'chrome.hideSidebar': 'Hide sidebar',
    'orderSide.buyer': 'Buyer',
    'orderSide.seller': 'Seller',
  },
  zh: {
    'listings.agentHint': '\u544a\u8bc9\u4f60\u7684 Agent\uff1a\u201c\u4f7f\u7528 Exora MCP\u3002\u201d',
    'listings.agentPrompt': '\u4f7f\u7528 Exora MCP\u3002',
    'listings.agentCopy': '\u590d\u5236 Agent \u6307\u4ee4',
    'listings.agentDetails': '\u4e86\u89e3 Exora MCP',
    'listings.guide.title': '\u4f7f\u7528 Agent \u6216\u76f4\u63a5\u5728 Listings \u4e2d\u8d2d\u4e70',
    'listings.guide.subtitle': '\u4e24\u79cd\u65b9\u5f0f\u4f7f\u7528\u540c\u4e00\u5957\u5df2\u53d1\u5e03\u5546\u54c1\u3001\u4ef7\u683c\u3001\u53ef\u7528\u6027\u4e0e\u8d26\u6237\u8bb0\u5f55\u3002',
    'listings.guide.intro': 'Exora Dock \u4e0d\u4f1a\u518d\u63d0\u4f9b\u4e00\u4e2a\u5185\u7f6e\u804a\u5929 Agent\u3002\u4f60\u53ef\u4ee5\u7ee7\u7eed\u4f7f\u7528\u81ea\u5df1\u7684 MCP Agent\uff0c\u4e5f\u53ef\u4ee5\u5c55\u5f00\u4efb\u610f\u5546\u54c1\uff0c\u5728\u684c\u9762\u7a0b\u5e8f\u4e2d\u624b\u52a8\u5b8c\u6210\u8d2d\u4e70\u3002',
    'listings.guide.promptLabel': '\u544a\u8bc9\u4f60\u7684 Agent',
    'listings.guide.agentTitle': '\u901a\u8fc7\u81ea\u5df1\u7684 Agent \u8d2d\u4e70',
    'listings.guide.agentStep1': '\u4fdd\u6301 Exora Dock \u6b63\u5728\u8fd0\u884c\uff0c\u5e76\u767b\u5f55\u4f60\u7684\u8d26\u6237\u3002',
    'listings.guide.agentStep2': '\u544a\u8bc9 Agent \u4f7f\u7528 Exora MCP\u3002\u5b83\u53ef\u4ee5\u901a\u8fc7\u672c\u5730 Dock \u8fde\u63a5\u5e02\u573a\uff0c\u641c\u7d22\u540c\u4e00\u76ee\u5f55\uff0c\u5e76\u8bfb\u53d6\u5546\u54c1\u6e05\u5355\u3001\u4ef7\u683c\u3001\u53ef\u7528\u6027\u4e0e\u9694\u79bb\u8bf4\u660e\u3002',
    'listings.guide.agentStep3': 'Agent \u53ef\u4ee5\u4f30\u4ef7\u3001\u8d2d\u4e70\u8ba1\u7b97\u65f6\u957f\u6216\u4e0b\u8f7d\u6388\u6743\u3001\u8c03\u7528\u4ed8\u8d39 API\u3001\u521b\u5efa\u4e0b\u8f7d\u4f20\u8f93\u3001\u8bfb\u53d6\u7528\u91cf\u5e76\u91ca\u653e\u79df\u7ea6\u3002',
    'listings.guide.agentStep4': '\u4ed8\u8d39\u8c03\u7528\u5fc5\u987b\u5305\u542b\u7a33\u5b9a\u7684\u5e42\u7b49\u952e\u4e0e\u6700\u9ad8\u6388\u6743\u91d1\u989d\uff1bCloud \u7684\u4f59\u989d\u3001\u9884\u7b97\u4e0e\u5ba1\u6279\u89c4\u5219\u4ecd\u7136\u6709\u6548\u3002',
    'listings.guide.manualTitle': '\u76f4\u63a5\u5728 Listings \u4e2d\u8d2d\u4e70',
    'listings.guide.manualStep1': '\u5728 Buyer Listings \u4e2d\u5c55\u5f00\u5546\u54c1\uff0c\u7ee7\u7eed\u524d\u67e5\u770b\u6e05\u5355\u3001\u63d0\u4f9b\u65b9\u3001\u4ef7\u683c\u3001\u53ef\u7528\u6027\u3001\u8bb8\u53ef\u8bc1\u4e0e\u9694\u79bb\u8bf4\u660e\u3002',
    'listings.guide.manualStep2': '\u4fdd\u6301\u767b\u5f55\uff0c\u7136\u540e\u76f4\u63a5\u4f7f\u7528\u5c55\u5f00 Listing \u5185\u7684\u64cd\u4f5c\u63a7\u4ef6\u3002\u624b\u52a8\u8d2d\u4e70\u4f7f\u7528 Cloud \u767b\u5f55\u4f1a\u8bdd\uff0c\u4e0d\u9700\u8981 API \u5bc6\u94a5\u3002',
    'listings.guide.manualStep3': '\u4f7f\u7528\u5546\u54c1\u5185\u7684\u64cd\u4f5c\uff1a\u8d2d\u4e70\u8ba1\u7b97\u8d44\u6e90\u3001\u83b7\u5f97\u56fa\u5b9a\u7248\u672c\u4e0b\u8f7d\u6388\u6743\uff0c\u6216\u8c03\u7528\u5df2\u58f0\u660e\u7684 API \u64cd\u4f5c\u3002',
    'listings.guide.manualStep4': '\u8d2d\u4e70\u3001\u79df\u7ea6\u3001\u7528\u91cf\u4e0e\u8d26\u672c\u7ed3\u679c\u90fd\u4f1a\u8fdb\u5165 Buyer \u6d3b\u52a8\u5386\u53f2\u3002',
    'listings.guide.productsTitle': '\u5f53\u524d\u684c\u9762\u7248\u652f\u6301\u7684\u5185\u5bb9',
    'listings.guide.computeTitle': '\u8ba1\u7b97\u8d44\u6e90',
    'listings.guide.computeBody': '\u4f30\u4ef7\u540e\u8d2d\u4e70\u6574\u6570\u5206\u949f\uff0c\u67e5\u770b\u5df2\u5f00\u901a\u79df\u7ea6\uff0c\u5e76\u53ef\u7eed\u65f6\u6216\u63d0\u524d\u91ca\u653e\u3002\u4e3b\u52a8\u63d0\u524d\u91ca\u653e\u4e0d\u9000\u8fd8\u672a\u4f7f\u7528\u5206\u949f\u3002',
    'listings.guide.downloadTitle': '\u4e0b\u8f7d\u5546\u54c1',
    'listings.guide.downloadBody': '\u4e00\u6b21\u4ed8\u8d39\u83b7\u5f97\u4e0d\u53ef\u8f6c\u8ba9\u3001\u6709\u65f6\u9650\u7684 DownloadGrant\u3002\u4f20\u8f93\u652f\u6301\u65ad\u70b9\u7eed\u4f20\uff0c\u4ea4\u4ed8\u524d\u4f1a\u9a8c\u8bc1 SHA-256\u3002',
    'listings.guide.apiTitle': 'API \u64cd\u4f5c',
    'listings.guide.apiBody': '\u9009\u62e9\u5df2\u58f0\u660e\u7684\u64cd\u4f5c\uff0c\u586b\u5199\u53c2\u6570\u4e0e\u8bf7\u6c42\u4f53\uff0c\u67e5\u770b\u6700\u9ad8\u8d39\u7528\u540e\u53d1\u8d77\u8c03\u7528\uff0c\u5e76\u67e5\u770b\u5df2\u9690\u85cf\u654f\u611f\u4fe1\u606f\u7684\u7ed3\u679c\u3002',
    'listings.guide.realityTitle': '\u5f53\u524d\u8fb9\u754c',
    'listings.guide.reality1': '\u53ea\u80fd\u8d2d\u4e70\u5df2\u53d1\u5e03\u4e14\u5f53\u524d\u53ef\u7528\u7684\u5e02\u573a Listing\uff1b\u4e0d\u80fd\u8d2d\u4e70\u81ea\u5df1\u7684 Listing\u3002',
    'listings.guide.reality2': '\u5b9e\u9645\u5b8c\u6210\u53d6\u51b3\u4e8e Exora Cloud\u3001\u5356\u5bb6\u5c31\u7eea\u72b6\u6001\u3001\u8d26\u6237\u4f59\u989d\u4e0e\u6240\u9700\u5ba1\u6279\u3002',
    'listings.guide.reality3': '\u684c\u9762\u7a0b\u5e8f\u662f\u7ba1\u7406\u4e0e\u624b\u52a8\u8d2d\u4e70\u754c\u9762\uff0c\u4e0d\u662f\u5185\u7f6e Agent \u804a\u5929\u3002\u4f60\u7684 Agent \u4ecd\u7136\u662f\u81ea\u5df1\u7684 MCP \u5ba2\u6237\u7aef\u3002',
    'listings.guide.reality4': '\u5207\u52ff\u628a\u652f\u4ed8 PIN\u3001\u94b1\u5305\u79c1\u94a5\u3001Provider \u51ed\u636e\u6216 Owner Token \u4ea4\u7ed9 Agent\u3002\u4e70\u5bb6\u7edf\u4e00 SK \u4f1a\u6301\u7eed\u6709\u6548\uff0c\u76f4\u5230\u4f60\u624b\u52a8\u91cd\u65b0\u968f\u673a\u6216\u64a4\u9500\u3002',
    'listings.guide.footer': '\u672c\u5730 MCP \u8bbf\u95ee\u671f\u95f4\u5fc5\u987b\u4fdd\u6301 Exora Dock \u6b63\u5728\u8fd0\u884c\u3002',
    'toast.agentPromptCopied': 'Agent \u6307\u4ee4\u5df2\u590d\u5236\u3002',
    'app.signedOut': '已退出登录',
    'app.userFallback': 'Exora 用户',
    'toast.identifierCopied': '标识符已复制。',
    'toast.listingReplacementStarted': '替换草稿已开始。再次提交将创建新的私有 Listing。',
    'toast.paymentPinChanged': '支付 PIN 已修改。',
    'toast.orderKeyRevoked': '买家统一 SK 已撤销。',
    'toast.orderKeyCopied': '买家统一 SK 已复制，剪贴板将在 60 秒后清除。',
    'toast.orderKeyCreated': '买家统一 SK 已创建。',
    'toast.approvalApproved': '付款已批准，Agent 可以重试该操作。',
    'toast.approvalRejected': '付款请求已拒绝。',
    'toast.agentLimitsUpdated': 'Agent 自动付款限额已更新。',
    'toast.agentPaymentsDisabled': 'Agent 自动付款已关闭。',
    'toast.walletAddressCopied': '钱包地址已复制。',
    'profile.signOut': '退出登录',
    'profile.signedOut': '已退出登录',
    'profile.language': '语言',
    'profile.theme': '主题',
    'profile.english': 'English',
    'profile.chinese': '中文',
    'profile.light': '浅色',
    'profile.dark': '深色',
    'permission.ask.label': '每次询问',
    'permission.ask.description': '编辑外部文件或使用互联网前始终询问',
    'permission.approve.label': '自动批准',
    'permission.approve.description': '仅对可能不安全的操作询问',
    'permission.full.label': '完全访问',
    'permission.full.description': '允许访问互联网和电脑上的任意文件',
    'permission.custom.label': '自定义 (config.toml)',
    'permission.custom.description': '使用 config.toml 中定义的权限',
    'chrome.showSidebar': '显示侧栏',
    'chrome.hideSidebar': '隐藏侧栏',
    'orderSide.buyer': '买家',
    'orderSide.seller': '卖家',
  },
} satisfies Record<AppLanguage, Record<string, string>>

const phraseTranslations: Record<string, string> = {
  'Workspace tools': '工作区工具',
  'Resize sidebar': '调整侧栏宽度',
  'Workspace views': '工作区视图',
  Work: '工作',
  Market: '市场',
  Settings: '设置',
  Search: '搜索',
  Back: '后退',
  'Toggle sidebar': '切换侧栏',
  'Account menu': '账户菜单',
  Copy: '复制',
  or: '或',
  Send: '发送',
  Delete: '删除',
  Duplicate: '复制',
  Apply: '应用',
  'API key': 'API key',
  Provider: '提供方',
  'Base URL': 'Base URL',
  Capabilities: '能力',
  Runtime: '运行时',
  native: '原生',
  Image: '镜像',
  Data: '数据',
  Support: '支持',
  'local files': '本地文件',
  pending: '待处理',
  QR: '二维码',
  Cloud: '云端',
  Expires: '过期时间',
  Token: 'Token',
  enabled: '已启用',
  Currency: '币种',
  Wallet: '钱包',
  missing: '缺失',
  Address: '地址',
  Mode: '模式',
  Refresh: '刷新',
  local: '本地',
  'Payment PIN': '付款 PIN',
  checking: '检查中',
  hidden: '隐藏',
  empty: '空',
  Cancel: '取消',
  Remove: '移除',
  Review: '审核',
  Note: '说明',
  Agent: 'Agent',
  Diagnostics: '诊断',
  Updated: '更新时间',
  Publish: '发布',
  Records: '记录',
  Environment: '环境',
  'Display name': '显示名称',
  active: '已激活',
  inactive: '未激活',
  'not configured': '未配置',
  configured: '已配置',
  Close: '关闭',
  Minimize: '最小化',
  'Maximize or restore': '最大化或还原',
  'Window controls': '窗口控制',
  Buyer: '买家',
  Seller: '卖家',
  'Exora User': 'Exora 用户',
  Status: '状态',
  Profile: '配置',
  Models: '模型',
  Test: '测试',
  Stop: '停止',
  Restart: '重启',
  linked: '已连接',
  approved: '已批准',
  Enabled: '已启用',
  disabled: '已禁用',
  'Owner control': '所有者控制',
  resource: '资源',
  Choose: '选择',
  Task: '任务',
  Amount: '金额',
  Payment: '付款',
  'not required': '不需要',
  Files: '文件',
  Approve: '批准',
  Reject: '拒绝',
  task: '任务',
  Quote: '报价',
  none: '无',
  payment: '付款',
  Confirmed: '确认时间',
  Memory: '内存',
  Disk: '磁盘',
  Python: 'Python',
  Resource: '资源',
  Type: '类型',
  Price: '价格',
  Region: '地区',
  Dataset: '数据集',
  'not declared': '未声明',
  Order: '订单',
  Approval: '审批',
  Completed: '完成时间',
  Active: '当前使用',
  Draft: '草稿',
  'Not checked': '未检查',
  stored: '已存储',
  offline: '离线',
  Cards: '卡片',
  'Personal profile': '个人资料',
  'Open account menu': '打开账户菜单',
  'Open settings': '打开设置',
  'Confirm payment PIN': '确认付款 PIN',
}

Object.assign(phraseTranslations, {
  'API Settings': 'API 设置',
  Check: '检查',
  New: '新建',
  Save: '保存',
  'API website': 'API 地址',
  'OpenAI-compatible endpoint, for example https://api.openai.com/v1.': 'OpenAI 兼容端点，例如 https://api.openai.com/v1。',
  'Main model': '主模型',
  'Used for planning and harder work.': '用于规划和更复杂的工作。',
  'Secondary model': '辅助模型',
  'Blank means same as main model.': '留空表示与主模型相同。',
  'same as main': '与主模型相同',
  'Use this setting for': '此设置用于',
  'One setting can serve buyer, seller, or both.': '一个设置可以用于买家、卖家，或同时用于两者。',

  'Local MCP entry': '本地 MCP 入口',
  'Use the Work prompt controls to connect Codex, Claude Code, OpenCode, or another local agent.': '使用 Work 提示词控件连接 Codex、Claude Code、OpenCode 或其他本地 Agent。',
  'Lets this dock receive requests and quote work as a provider.': '允许此 Dock 作为提供方接收请求并报价。',
  'Public provider identity used in quotes, tasks, and market records.': '用于报价、任务和市场记录的公开提供方身份。',
  'Quote defaults': '报价默认值',
  'Fallback terms used when the seller agent prepares a quote': '卖家 Agent 准备报价时使用的兜底条款',
  'ETA seconds': '预计秒数',
  'Default estimated execution time for lightweight tasks.': '轻量任务的默认预计执行时间。',
  'Quote price': '报价价格',
  'Default amount offered before task-specific adjustments.': '按任务调整前的默认报价金额。',
  'Currency label used in seller quotes.': '卖家报价中使用的币种标签。',
  'Low-risk auto accept': '低风险自动接受',
  'Allow automatic acceptance and completion only for low-risk, text-only work.': '仅允许低风险、纯文本工作自动接受和完成。',
  'Auto accept low-risk work': '自动接受低风险工作',

  Budget: '预算',
  Tasks: '任务类型',
  Risk: '风险',
  Authorization: '授权',
  Disclosure: '披露',
  Capabilities: '能力',
  Pricing: '定价',
  Availability: '可用性',
  Policy: '策略',
  Outputs: '输出',
  'default disclosure': '默认披露级别',
  'published card payload': '已发布卡片负载',
  'local until published': '发布前仅本地保存',
  'safe diagnostics': '安全诊断',

  'Supported agents': '支持的 Agent',
  'Comma-separated local agents that can drive this buyer card.': '用英文逗号分隔可驱动此买家卡片的本地 Agent。',
  'Default budget boundary shown to sellers.': '展示给卖家的默认预算边界。',
  'Accepted tasks': '接受的任务',
  'Comma-separated task categories this buyer may route externally.': '用英文逗号分隔此买家可外部路由的任务类别。',
  'compute, research, data, code, automation': '计算、研究、数据、代码、自动化',
  Preferences: '偏好',
  'Comma-separated seller or execution preferences.': '用英文逗号分隔卖家或执行偏好。',
  'escrow, reproducible output, short retention': '托管付款、可复现输出、短期保留',
  'Risk boundary': '风险边界',
  'What this buyer will not route without owner review.': '未经所有者审核时，此买家不会路由的内容。',
  'Low-risk compute, research, data, code, and automation only.': '仅限低风险计算、研究、数据、代码和自动化。',
  'Owner approval rules for payments, disclosure, writes, and publishing.': '付款、披露、写入和发布的所有者审批规则。',
  'Human confirmation is required for payments, file disclosure, external writes, and public publishing.': '付款、文件披露、外部写入和公开发布都需要人工确认。',
  'Identity disclosure': '身份披露',
  'Identity information allowed before consent.': '获得同意前允许披露的身份信息。',
  'Minimal identity disclosure before consent.': '获得同意前只进行最小身份披露。',
  'File disclosure': '文件披露',
  'File metadata and content rules for seller matching.': '用于卖家匹配的文件元数据和内容规则。',
  'Task-scoped file metadata only unless the owner confirms more.': '除非所有者确认更多内容，否则仅披露任务范围内的文件元数据。',
  'Data retention': '数据保留',
  'How long sellers may retain task inputs.': '卖家可保留任务输入的时长。',
  'Inputs may only be retained for the active task unless separately approved.': '除非另行批准，输入只能为当前任务保留。',
  'Escrow preference': '托管偏好',
  'Payment proof or escrow preference for paid work.': '付费工作的付款证明或托管偏好。',
  'Use escrow or verifiable payment proof for paid work.': '付费工作使用托管或可验证的付款证明。',
  'Short owner-facing summary for this buyer card.': '面向所有者的买家卡片简短摘要。',

  'Capability summary': '能力摘要',
  'Short provider capability description shown in market search.': '市场搜索中展示的提供方能力简述。',
  'Capability types': '能力类型',
  'Comma-separated capability classes.': '用英文逗号分隔能力类别。',
  'Skill Capability, Managed API Capability': '技能能力、托管 API 能力',
  'Public pricing policy or quote default summary.': '公开定价策略或默认报价摘要。',
  '10 USDC per lightweight job; task-specific quotes may adjust.': '轻量任务每次 10 USDC；具体任务报价可能调整。',
  'When this seller agent can accept work.': '此卖家 Agent 可接受工作的时间。',
  'Human confirmation': '人工确认',
  'Actions requiring provider owner confirmation.': '需要提供方所有者确认的操作。',
  'Human confirmation is required for external writes, payments, credential use, and public disclosure.': '外部写入、付款、凭据使用和公开披露都需要人工确认。',
  'Data boundary': '数据边界',
  'How buyer inputs are scoped and retained.': '买家输入的作用范围与保留方式。',
  'Buyer inputs are task-scoped and are not reused for training or resale without consent.': '买家输入仅限任务范围；未经同意不得用于训练或转售。',
  'Managed APIs': '托管 API',
  'Names only; do not include keys, tokens, or private endpoints.': '仅填写名称；不要包含密钥、token 或私有端点。',
  'OpenAI-compatible LLM, browser automation': 'OpenAI 兼容 LLM、浏览器自动化',
  'Output formats': '输出格式',
  'Comma-separated outputs this seller returns.': '用英文逗号分隔此卖家返回的输出类型。',
  'artifact, log summary, receipt': '产物、日志摘要、收据',
  'Mirrors the seller-agent quote policy.': '与卖家 Agent 的报价策略保持一致。',
  'Mirrors the seller-agent low-risk acceptance policy.': '与卖家 Agent 的低风险接受策略保持一致。',
  'External write policy': '外部写入策略',
  'Rules for writing outside local task outputs.': '写入本地任务输出之外位置的规则。',
  'External writes require explicit owner approval.': '外部写入需要所有者明确批准。',

  'Save and publish this card to Exora Cloud': '保存并将此卡片发布到 Exora Cloud',
  'Stop scan': '停止扫描',
  'Environment scan complete. System and dependency details are ready.': '环境扫描完成。系统与依赖详情已就绪。',
  'Scanning environment...': '正在扫描环境...',
  'Environment scan stopped.': '环境扫描已停止。',
  'Seller agent saved.': '卖家 Agent 已保存。',
  'buyer displayName required': '买家显示名称为必填项。',
  'buyer riskBoundary required': '买家风险边界为必填项。',
  'buyer authorizationStrategy required': '买家授权策略为必填项。',
  'buyer identityDisclosure required': '买家身份披露为必填项。',
  'buyer fileDisclosure required': '买家文件披露为必填项。',
  'seller displayName required': '卖家显示名称为必填项。',
  'seller capability required': '卖家能力信息为必填项。',
  'seller pricing required': '卖家定价为必填项。',
  'seller availability required': '卖家可用性为必填项。',
  'seller humanConfirmation required': '卖家人工确认策略为必填项。',
  'Order history': '订单历史',
  'Search history': '搜索历史记录',
  'Search order history': '搜索订单历史',
  'Filter by product type': '按商品类型筛选',
  'Filter by status': '按状态筛选',
  'All types': '全部类型',
  Compute: '计算资源',
  Download: '下载资源',
  'All states': '全部状态',
  Active: '进行中',
  Completed: '已完成',
  'Needs review': '需要审阅',
  'Refresh history': '刷新历史记录',
  'History unavailable': '历史记录暂不可用',
  'Order history is currently unavailable.': '订单历史目前暂不可用。',
  'Order history detail': '订单历史详情',
  'History detail unavailable': '订单详情暂不可用',
  'Try again': '重试',
  'Loading history…': '正在加载历史记录…',
  'Loading order detail': '正在加载订单详情',
  'Review required': '需要审阅',
  Activity: '活动',
  Counterparty: '交易对方',
  'Last update': '最近更新',
  Usage: '用量',
  Invocations: '调用记录',
  Events: '事件',
  'Ledger summary': '账本摘要',
  'Gross charge': '总金额',
  'Platform fee': '平台费',
  Paid: '已支付',
  'Net revenue': '净收入',
  'Purchased resource': '已购资源',
  Version: '版本',
  Identifiers: '标识符',
})

const reversePhraseTranslations: Record<string, string> = Object.fromEntries(
  Object.entries(phraseTranslations).map(([en, zh]) => [zh, en]),
)

let currentLanguage: AppLanguage = normalizeAppLanguage(initialLanguageValue())

export function normalizeAppLanguage(value: unknown): AppLanguage {
  const text = String(value || '').trim().toLowerCase()
  return text === 'zh' || text.startsWith('zh-') || text.startsWith('zh_') ? 'zh' : 'en'
}

export function htmlLangForLanguage(language: AppLanguage) {
  return language === 'zh' ? 'zh-CN' : 'en'
}

export function chromiumLocaleForLanguage(language: AppLanguage) {
  return language === 'zh' ? 'zh-CN' : 'en-US'
}

export function initialI18nLanguage() {
  return currentLanguage
}

export function getI18nLanguage() {
  return currentLanguage
}

export function setI18nLanguage(language: AppLanguage) {
  currentLanguage = normalizeAppLanguage(language)
}

export function t(key: string, params: Params = {}) {
  const table = namedMessages[currentLanguage] as Record<string, string>
  const fallback = (namedMessages.en as Record<string, string>)[key] || key
  const template = table[key] || fallback
  return formatMessage(template, params)
}

export function translatePhrase(value: string, language: AppLanguage = currentLanguage) {
  const text = String(value || '')
  if (!text.trim()) return text
  const trimmed = text.trim()
  const translated = phraseForLanguage(trimmed, language)
  if (!translated || translated === trimmed) return text
  const leading = text.match(/^\s*/)?.[0] || ''
  const trailing = text.match(/\s*$/)?.[0] || ''
  return `${leading}${translated}${trailing}`
}

export function translateDom(root: ParentNode, language: AppLanguage = currentLanguage) {
  translateTextNodes(root, language)
  translateAttributes(root, language)
}

function initialLanguageValue() {
  const exora = (globalThis as { window?: { exora?: { initialLocale?: { language?: string } } } }).window?.exora
  const bridgeLanguage = exora?.initialLocale?.language
  if (bridgeLanguage) return bridgeLanguage
  try {
    return window.localStorage.getItem(appLanguageStorageKey) || window.navigator.language
  } catch {
    return 'en'
  }
}

function formatMessage(template: string, params: Params) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
    const value = params[name]
    return value === undefined || value === null ? match : String(value)
  })
}

function phraseForLanguage(value: string, language: AppLanguage) {
  if (language === 'zh') return phraseTranslations[value] || value
  return reversePhraseTranslations[value] || value
}

function translateTextNodes(root: ParentNode, language: AppLanguage) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || shouldSkipTextElement(parent)) return NodeFilter.FILTER_REJECT
      return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    node.nodeValue = translatePhrase(node.nodeValue || '', language)
  }
}

function translateAttributes(root: ParentNode, language: AppLanguage) {
  const elements = root instanceof Element ? [root, ...Array.from(root.querySelectorAll('*'))] : Array.from(root.querySelectorAll('*'))
  for (const element of elements) {
    if (shouldSkipAttributeElement(element)) continue
    for (const attr of ['title', 'aria-label', 'placeholder', 'aria-valuetext']) {
      const value = element.getAttribute(attr)
      if (!value) continue
      const translated = translatePhrase(value, language)
      if (translated !== value) element.setAttribute(attr, translated)
    }
  }
}

function shouldSkipTextElement(element: Element) {
  if (element.closest('[data-no-i18n]')) return true
  return ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(element.tagName)
}

function shouldSkipAttributeElement(element: Element) {
  if (element.closest('[data-no-i18n]')) return true
  return ['SCRIPT', 'STYLE'].includes(element.tagName)
}
