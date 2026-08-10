# 详细指南

[返回 README](../README.md) | [English](./guide_EN.md)

## 安装说明

### 包名与状态兼容性

npm 包、插件 ID 和 channel ID 均为 `openclaw-weixin`。README 中的
[安装命令](../README.md#connect-wechat)会保留
`channels.openclaw-weixin`、`plugins.entries.openclaw-weixin` 和
`~/.openclaw/openclaw-weixin/` 状态路径。

`--force` 允许 OpenClaw 覆盖内部 ID 相同的现有插件安装；它不会改变来源信任或
安全策略。OpenClaw 会自动轮换配置备份；此次替换无需复制整个状态目录。

### 安装限制

- 此社区 npm 包需通过 CLI 安装；OpenClaw Control UI 不能安装任意 npm、git
  或本地路径来源的插件。
- Nix 模式（`OPENCLAW_NIX_MODE=1`）会禁止插件安装、更新、卸载、启用和停用
  命令；请改动 Nix 配置源后重新构建。
- OpenClaw 安装插件依赖时会禁用生命周期脚本，因此本包直接携带编译后的
  `dist/index.js`，无需在用户机器上构建。

## 自定义 BotAgent（可选）

登录后的每条鉴权请求会带一个自我声明的 `bot_agent` 字段——类似 HTTP
`User-Agent`——用于后台日志归因和监控聚合。**默认值为 `OpenClaw`**。声明自己的
应用名能让你的流量在后台日志中更容易识别。

在 `openclaw.json` 中加一行即可：

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

## 卸载

> [!WARNING]
> 替换腾讯版时不要卸载，请使用 README 中的
> [安装命令](../README.md#connect-wechat)原位替换。

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

- [后端 API 协议](./backend-api.md)
- [架构说明](./architecture.md)
