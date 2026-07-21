# Random Puppy Card API

这是一个零外部依赖的 Exora `local_dock` Provider 示例。用户不需要填写任何字段；每次新调用都会生成一张随机小狗 SVG 名片，并返回名片地址和结构化资料。

名片包含：小狗名字、年龄、品种、喜欢的食物、喜欢做的事、喜欢的玩家和虚构家庭地址。

## 启动

```powershell
cd C:\Users\malou\Documents\GitHub\ExoraDock\exora-dock\examples\mock-render-api
npm start
```

默认监听 `http://127.0.0.1:8791`：

- `GET` 或 `HEAD /health`：健康检查
- `POST /v1/puppy-card`：零输入生成随机小狗名片
- `GET /renders/{render_id}.svg`：打开生成的 SVG

## 本地调用

请求不需要 body：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8791/v1/puppy-card
```

也可以发送空对象 `{}`。Dock 转发的同一个 `X-Exora-Invocation-Id` 会得到相同结果，新 invocation 会生成新的随机名片。

## 生成可上传合同

```powershell
npm run prepare
```

生成的 `contract.ready.json` 不含 UID。请将它上传到现有 API Draft，Dock 会注入该 Draft 的稳定 UID。新名称是 **Random Puppy Card API**，操作名是 **Generate Random Puppy Card**，`operationId` 是 `generate_puppy_card`。

当前合同价格保持每次成功交付 `0.01 USDC`，单次上限 `0.01 USDC`。

## 测试

```powershell
npm test
```

服务只绑定 IPv4 回环地址。最多缓存最近 200 张 SVG，服务重启后缓存清空；名片里的家庭地址均为虚构地址。
