# 详细指南

[返回概览](https://openclaw-weixin.newfuture.cc/) |
[English](https://openclaw-weixin.newfuture.cc/en/guide.html)

## 安装说明

这是腾讯上游项目的社区维护发行版；腾讯官方 npm 包是
`@tencent-weixin/openclaw-weixin`。社区版的包名和发布渠道不同，但沿用
`openclaw-weixin` 插件、Channel 和状态 ID。任选一个社区来源即可；README 中的
[安装命令](https://openclaw-weixin.newfuture.cc/#connect-wechat)会保留
`channels.openclaw-weixin`、`plugins.entries.openclaw-weixin` 和
`~/.openclaw/openclaw-weixin/` 状态路径。

之前使用下方 ClawHub 或 npm 命令安装社区版时，运行
`openclaw plugins update openclaw-weixin`。首次安装、替换腾讯官方包，或现有插件通过其他来源
安装时，直接运行所选来源的安装命令，不要先卸载。Agent 执行 npm 安装及任何替换安装时加
`--force`。配置和登录状态会保留。

### 安装限制

- 两个社区包均通过 OpenClaw CLI 安装；不要使用普通 `npm install`，也不要同时安装
  npm 与 ClawHub 版本。OpenClaw Control UI 不能安装任意 npm、git 或本地路径来源
  的插件。
- Nix 模式（`OPENCLAW_NIX_MODE=1`）会禁止插件安装、更新、卸载、启用和停用
  命令；请改动 Nix 配置源后重新构建。
- OpenClaw 安装插件依赖时会禁用生命周期脚本，因此本包直接携带编译后的
  `dist/index.js`，无需在用户机器上构建。

## 自定义 BotAgent（可选）

登录后的每条鉴权请求会带一个自我声明的 `bot_agent` 字段——类似 HTTP
`User-Agent`——用于后台日志归因和监控聚合。**默认值为 `OpenClaw`**。声明自己的
应用名能让你的流量在后台日志中更容易识别。

以下两种方式任选其一。

使用命令：

```bash
openclaw config set channels.openclaw-weixin.botAgent MyBot/1.2.0
```

或直接编辑 `openclaw.json`：

```json
{
  "channels": {
    "openclaw-weixin": {
      "botAgent": "MyBot/1.2.0"
    }
  }
}
```

**格式规范**（UA 风格）：

- 一个或多个 `Name/Version` token，空格分隔
- 每个 token 可选地跟一个 ` (comment)`
- 仅允许 ASCII 字符；总长 ≤ 256 字节
- 不合规的 token 在清洗时静默丢弃；如果最终为空，回退到 `OpenClaw`

可直接使用的示例：

- `MyBot/1.2.0`
- `MyBot/1.2.0 (region=cn;env=prod)`
- `MyBot/1.2.0 LangChain/0.3.5`
- `MyBot/1.2.0-rc.1+build.5`

**注意**：`bot_agent` 仅用于观测，**不参与鉴权或路由**。当前本插件实例下所有
已注册的 agent 共享同一个 `botAgent` 声明；如有需要按 agent 单独标识的场景，
可在后续版本扩展配置。

## 工具调用进度消息（可选）

`replyProgressMessages` 默认为 `true`。模型调用工具时，插件会发送结构化的
`TOOL_CALL_START` 和 `TOOL_CALL_RESULT` 进度消息。若不希望显示这些额外消息，以下
两种方式任选其一。

使用命令：

```bash
openclaw config set channels.openclaw-weixin.replyProgressMessages false
```

或直接编辑 `openclaw.json`：

```json
{
  "channels": {
    "openclaw-weixin": {
      "replyProgressMessages": false
    }
  }
}
```

设为 `false` 只会停止工具调用进度消息，不会关闭最终回复或普通文本与媒体消息。

## 分块回复

插件默认按顺序发送模型在多步工具调用之间完成的文本块，再发送最终回复。分块回复不是逐
token 流式输出；OpenClaw 可能按 Channel 的合并策略组合较短文本。工具调用进度消息由
独立的 `replyProgressMessages` 设置控制。

如需仅发送最终回复，可关闭分块回复。以下两种方式任选其一。

使用命令：

```bash
openclaw config set channels.openclaw-weixin.blockStreaming false
```

或直接编辑 `openclaw.json`：

```json
{
  "channels": {
    "openclaw-weixin": {
      "blockStreaming": false
    }
  }
}
```

如需为单个账号覆盖频道设置，可使用命令（将 `account-1` 替换为目标账号的稳定别名或
账号 ID）：

```bash
openclaw config set channels.openclaw-weixin.accounts.account-1.blockStreaming false
```

或在 `openclaw.json` 中配置：

```json
{
  "channels": {
    "openclaw-weixin": {
      "accounts": {
        "account-1": {
          "blockStreaming": false
        }
      }
    }
  }
}
```

## 主动与定时发送

微信后端要求每条出站消息携带由该收件人入站消息下发的账号级 context token。插件收到
消息后会按账号保存该 token。

- 尚未收到该收件人的消息或 token 缺失时，插件会拒绝发送消息，不会返回本地“成功”
  结果。
- 已保存的 token 仍可能失效；长时间无交互后发送失败时，请让收件人先向对应 bot
  发送一条消息以刷新 token，再重试。
- 多账号部署的定时任务应同时显式设置 `delivery.to` 和 `delivery.accountId`。未指定
  `accountId` 时，只有恰好能从账号级上下文选出一个账号才会发送；缺失或歧义都会
  失败。

context token 属于敏感数据，不要跨账号复制、写入任务配置或分享状态文件。

## 卸载

> [!WARNING]
> 替换腾讯版时不要卸载，请使用 README 中的
> [安装命令](https://openclaw-weixin.newfuture.cc/#connect-wechat)原位替换。

如果以后可能重装，请先备份 `~/.openclaw/openclaw.json`：新版 OpenClaw
卸载时会删除插件条目及其拥有的 `channels.openclaw-weixin` 配置。

```bash
openclaw plugins uninstall openclaw-weixin
```

## 故障排查

### "requires OpenClaw >=2026.6.1" 报错

你的 OpenClaw 版本太旧，不兼容当前插件版本。检查版本：

```bash
openclaw --version
```

请先升级 OpenClaw。社区包不发布旧宿主兼容版本线。

### Channel 显示 "OK" 但未连接

启用插件，重载或重启实际承载 OpenClaw 的运行单元，然后再次探测：

```bash
openclaw plugins enable openclaw-weixin
openclaw channels status --probe
```

## 开发者文档

- [社区版与腾讯版](https://openclaw-weixin.newfuture.cc/distributions.html)
- [后端 API 协议](https://openclaw-weixin.newfuture.cc/backend-api.html)
- [架构说明](https://openclaw-weixin.newfuture.cc/architecture.html)
