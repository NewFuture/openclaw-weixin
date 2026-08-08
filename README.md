# openclaw-weixin

[English](./README_EN.md) · [文档站点](https://openclaw-weixin.newfuture.cc/)

这是 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)
的社区维护发行版，用于连接 OpenClaw 与微信，并提供更好的使用体验。

## 安装或替换

需要 [OpenClaw](https://docs.openclaw.ai/install) `>=2026.6.1`。请使用运行
OpenClaw 的同一用户，并在同一环境中执行。

**命令行——一行安装或替换：**

> 提示：**不要**先卸载 `@tencent-weixin/openclaw-weixin`；直接原位替换通常会保留现有配置和登录状态。

```bash
openclaw plugins install npm:openclaw-weixin --force
```

<details>
<summary>绑定微信账号（全新安装）</summary>

如需将微信账号绑定到当前 OpenClaw，请启用插件并开始扫码绑定：

```bash
openclaw plugins enable openclaw-weixin
openclaw channels login --channel openclaw-weixin
```

登录命令会在终端显示二维码。

</details>

<details>
<summary>重载检查</summary>

确保正在运行的 Gateway 已重载插件。必要时重启承载 OpenClaw 的服务、容器或
Pod，然后执行：

```bash
openclaw plugins list
openclaw channels status --probe
```

插件无加载错误且目标账号探测成功即完成；若显示未登录，请执行上面的登录命令。

</details>


### 提示词自动安装

将下面的提示词直接发送 OpenClaw Agent，用于安全安装或原位替换插件：

```text
请在不改变现有配置和登录状态的前提下，安装或原位替换 `openclaw-weixin`：
1. 先确认 `openclaw --version` 不低于 2026.6.1。
2. 我信任 npm 来源 `openclaw-weixin`。执行
   `openclaw plugins install npm:openclaw-weixin --force`，不要先卸载。
3. 仅在 `openclaw plugins list` 显示已停用时启用插件。不要主动重启 Gateway 或发起
   扫码登录；安装可能使启用了配置重载的受管 Gateway 自动重启。若已自动重启，执行
   `openclaw channels status --probe`；否则询问是否重启 Gateway。
4. 只报告结果；若未登录过微信，提示我手动运行
   `openclaw channels login --channel openclaw-weixin` 扫码绑定微信。
```

### 通过 Agent 命令安装

OpenClaw `>=2026.7.2-beta.1` 时，如果已设置 `commands.plugins: true`，并且你是
owner/admin，直接发送：

```text
/plugins install npm:openclaw-weixin --force
```

然后按上面的**重载检查**操作。

## 多账号

再次执行登录命令即可绑定其他微信账号。建议为每个号使用**稳定别名**，以便
`openclaw.json` / bindings 用可读 `accountId`（而不是仅服务端 hash）：

```bash
openclaw channels login --channel openclaw-weixin --account leader
openclaw channels login --channel openclaw-weixin --account jinjin
```

登录成功后会写入：

- `openclaw-weixin/accounts/<ilink_bot_id 规范化>.json`（凭证与状态命名空间；`listAccountIds` / monitor 只用此 id）
- `openclaw-weixin/account-aliases.json`（一对一 `alias → hash` 逻辑映射，供 bindings / 出站解析；别名不会再起一条 transport）

未传 `--account` 时（宿主会传入 `default` 哨兵）只索引服务端 bot id，不会创建名为 `default` 的账号。已绑定过的 hash 账号再执行 `login --account <alias>` 时，会在不歧义的情况下登记别名映射（不在线改名、不搬迁状态命名空间）。

多个账号同时登录时，建议按「账号 + 渠道 + 对端」隔离上下文：

```bash
openclaw config set session.dmScope per-account-channel-peer
```

## 文档

- [详细指南](docs/guide.zh_CN.md)：安装行为、BotAgent、卸载和故障排查
- [后端 API 协议](docs/backend-api.zh_CN.md)
- [架构说明](docs/architecture.md)
- [文档站点](https://openclaw-weixin.newfuture.cc/)：多语言在线文档，同时提供
  Markdown 原文与 [llms.txt](https://openclaw-weixin.newfuture.cc/llms.txt) 索引
