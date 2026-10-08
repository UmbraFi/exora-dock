# 随机三张塔罗牌 API

[English](README.md) | 简体中文

一个零输入的本地 Node.js API，从完整的 78 张塔罗牌中抽取三张不同的牌。每次抽牌分别指定过去、现在、未来位置，随机决定正位或逆位，并生成一张 SVG 解读图。

## 启动

```powershell
cd C:\Users\malou\Documents\GitHub\ExoraDock\exora-dock\examples\random-tarot-api
npm start
```

默认服务地址为 `http://127.0.0.1:8792`。

- `GET` 或 `HEAD /health`：健康检查
- `POST /v1/draw-three`：零输入生成三张牌解读
- `GET /draws/{draw_id}.svg`：打开生成的 SVG

不需要请求正文，也接受空 JSON 对象。相同 `X-Exora-Invocation-Id` 返回相同结果，支持安全重试；新 Invocation 会生成新的随机抽牌。

## 测试

```powershell
npm test
```

## Exora 合约

[`contract.json`](./contract.json) 是零输入 `POST /v1/draw-three` Operation 的无 UID `exora.api-contract.v1` 源文件。Exora Dock 在创建 Draft 时生成并持有稳定 API UID，在提交合约时注入该 UID。

塔罗牌解读仅供娱乐和个人思考。
