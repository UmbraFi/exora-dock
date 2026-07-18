# 四个核心项目的架构边界

Exora 市场只公开四个一级业务分类。`V3Product.applicationSource` 是权威分类；`productKind` 只描述计费与执行模型，不能替代业务分类。

| `applicationSource` | `productKind` | 交付路径 | 凭据权威 | 运行时依赖 |
|---|---|---|---|---|
| `vm` | `compute` | Lease 鉴权的 Exora 终端控制与 Dock 间 WebRTC 文件直传 | Worker / Lease 临时身份 | Worker、容量、Guest 控制通道和两端 Dock 必须可用 |
| `resources` | `download` | S3 兼容对象存储与逐 ResourceItem DownloadGrant | 无 VM 凭据 | 已验证且不可原位替换的 ResourceItem 对象版本 |
| `endpoint` | `api_operation` | 在线 Dock 出站隧道 | 仅 Dock 本地安全存储 | Dock 必须在线且健康检查通过 |
| `api_bridge` | `api_operation` | Cloud 透明代理公网 HTTPS API | Cloud 加密凭据 | 发布后不依赖 Dock 在线 |

## 分类合同

- Product 顶层 `applicationSource` 必须显式提交且只能是四个枚举值之一。Manifest 内同名字段仅为兼容镜像。
- Listing 的 `applicationSource` 只能从 Product 派生，客户端不能创建或修改为其他分类。
- `vm` 固定映射到 `compute`；`resources` 固定映射到 `download`；`endpoint` 与 `api_bridge` 固定映射到 `api_operation`，并分别要求 `dock_tunnel` 与 `cloud_direct`。
- 缺失、未知或互相矛盾的字段返回 `application_contract_mismatch`，不得回退为 API Bridge。
- Environment image、InventorySlot 等内部记录不属于市场商品，分类保持为空且不得创建 Listing。

## 不可跨越的交付边界

Resources 与 VM 永久独立。一个 Resource sheet 是主题容器，包含一个或多个 ResourceItem；每个文件都有独立标题、说明、价格、许可证和 DownloadGrant 时长，也必须独立购买。平台接受任意常规文件格式但不接收目录；若卖家希望把程序目录或整套文件作为一个商品，必须自行压缩后把压缩包作为一个普通 ResourceItem 上传。Resources 不关联 Lease、不挂载 VM，也不会自动接收 VM 里的代码或运行结果。

VM 文件只存在于 Lease 的受控 `/workspace`。命令通过 Lease 鉴权的 Exora 控制通道执行；正式文件通过 Consumer Dock 与 Provider Dock 之间的 WebRTC DTLS DataChannel 直传，Cloud 只转发短期 signaling，不提供 TURN 或文件中继。公开 SSH、SFTP、SCP、rsync、端口转发和 Provider Host 端口均不是 Lease 能力。平台不会把 VM 工作区自动发布成 Resources。

Endpoint 的本地 URL、明文 Secret 与 `credentialRef` 只保存在 Dock，不进入 Cloud 数据库、API 响应或日志。Cloud 只保存已配置证明、路由和计量合同。Dock 离线或健康检查失败时，Endpoint 必须不可用。

API Bridge 只能指向通过校验的公网 HTTPS `baseUrl`，禁止 `tunnelEndpointId`。其 Secret 由 Cloud 加密存储，Cloud Gateway 可在 Dock 离线时继续代理已发布操作。

## 旧数据迁移

迁移只回填能由既有 `productKind`、`bridgeMode` 与交付字段明确证明的分类。模糊或矛盾的 Listing 会暂停、移出目录并标记 `reclassification_required`。旧 Resources 的 `environment_only` 或组合交付不会自动扩大为下载权限；携带 Cloud Secret 引用的 Endpoint 会暂停、清除引用，并要求卖家在 Dock 本地重新配置。

订单、账本、已结算金额和历史活动不会因重新分类迁移而改写。
