# openclaw-wechat

[English](./README.md)

这是 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)
的社区维护发行版，用于连接 OpenClaw 与微信，并提供更好的使用体验。

## 安装或替换

需要 [OpenClaw](https://docs.openclaw.ai/install) `>=2026.7.1`。请使用运行
OpenClaw 的同一用户，并在同一环境中执行。

**命令行——一行安装或替换：**

```bash
openclaw plugins install npm:openclaw-weixin --force
```

<details>
<summary>替换腾讯官方插件？先看这里</summary>

> **警告：**不要先卸载 `@tencent-weixin/openclaw-weixin` 或重新扫码。直接执行
> 上面的命令；原位替换通常会保留现有配置和登录状态。

</details>

<details>
<summary>绑定微信账号</summary>

如需将微信账号绑定到当前 OpenClaw，请启用插件并开始扫码绑定：

```bash
openclaw plugins enable openclaw-weixin
openclaw channels login --channel openclaw-weixin
```

登录命令会在终端显示二维码。

</details>

<details>
<summary>重载并检查</summary>

确保正在运行的 Gateway 已重载插件。必要时重启承载 OpenClaw 的服务、容器或
Pod，然后执行：

```bash
openclaw plugins list
openclaw channels status --probe
```

插件无加载错误且目标账号探测成功即完成；若显示未登录，请执行上面的登录命令。

</details>

### 通过 Agent 安装

OpenClaw `>=2026.7.2-beta.1` 时，如果已设置 `commands.plugins: true`，并且你是
owner/admin，直接发送：

```text
/plugins install npm:openclaw-weixin --force
```

然后按上面的**重载并检查**操作。

### Shell Agent 提示词

将下面的提示词直接发送给有 Shell 权限的 Agent，即可安全安装或原位替换插件；
Gateway 重启和扫码操作仍由你完成：

```text
请在不改变现有配置和登录状态的前提下，安装或原位替换 `openclaw-weixin`。先确认
`openclaw --version` 不低于 2026.7.1。我信任 npm 来源 `openclaw-weixin`。执行
`openclaw plugins install npm:openclaw-weixin --force`；不要先卸载，也不要查看
或复制工作区、凭据及账号状态文件。仅在 `openclaw plugins list` 显示已停用时
启用插件。不要重启 Gateway 或发起扫码登录；告诉我需要重载什么。待我重载后，执行
`openclaw channels status --probe`，只报告脱敏结果；若未登录，提示我手动扫码。
```

## 多账号

再次执行登录命令即可绑定其他微信账号：

```bash
openclaw channels login --channel openclaw-weixin
```

多个账号同时登录时，建议按「账号 + 渠道 + 对端」隔离上下文：

```bash
openclaw config set session.dmScope per-account-channel-peer
```

## 文档

- [详细指南](docs/guide.zh_CN.md)：安装行为、BotAgent、卸载和故障排查
- [后端 API 协议](docs/backend-api.zh_CN.md)
- [架构说明](docs/architecture.md)
