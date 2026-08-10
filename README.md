# openclaw-weixin

<!-- docs-site:repo-only:start -->
[English](./README_EN.md) · [在线文档](https://openclaw-weixin.newfuture.cc/)
<!-- docs-site:repo-only:end -->

<p class="product-tagline">把 OpenClaw 接入微信</p>

<p class="product-summary">
这是 <a href="https://github.com/Tencent/openclaw-weixin">Tencent/openclaw-weixin</a>
的社区维护发行版。提示词或命令行任选一种，即可完成安装或原位替换。
</p>

<h2 id="connect-wechat">选择一种安装方式</h2>

<p class="choice-lead"><strong>推荐复制提示词，也可以直接运行命令。</strong>
两种方式效果相同，任选一种即可，不必重复执行。直接运行命令时，请使用运行 OpenClaw
的同一用户和同一环境。</p>

<div class="install-choice">
  <a href="#agent-install"><strong>复制提示词</strong><span>粘贴到 OpenClaw 聊天框</span></a>
  <span class="choice-or" aria-hidden="true">或</span>
  <a href="#cli-install"><strong>运行命令</strong><span>在终端执行一行命令</span></a>
</div>

<h3 id="agent-install">复制提示词</h3>

<p class="prompt-lead">复制下面这段话，粘贴到 OpenClaw 聊天框并发送：</p>

```text
请使用 OpenClaw 插件安装命令
`openclaw plugins install npm:openclaw-weixin --force` 安装或原位替换插件。
不要先卸载或改用普通的 `npm install`，也不要删除现有配置或登录数据。若不能运行
终端命令，请直接说明。安装成功后，若 Gateway 已自动重启，执行
`openclaw channels status --probe` 检查连接；若未自动重启，先询问我是否重启，
并在确认重启完成后再执行该探测。若探测显示微信尚未登录，再提示我运行
`openclaw channels login --channel openclaw-weixin` 扫码。最后报告实际结果。
```

<h3 id="cli-install">运行一条命令</h3>

```bash
openclaw plugins install npm:openclaw-weixin --force
```

<p class="replacement-note"><strong>替换腾讯版时不要先卸载。</strong>
直接安装会保留现有配置和登录状态；<code>--force</code> 用于覆盖现有插件安装，
不改变来源信任或安全策略。
OpenClaw 会自动轮换配置备份。</p>

<p class="install-done"><strong>如果当前 OpenClaw 已有微信登录状态，完成任一种方式后通常即可使用。</strong>
全新安装需要展开完整检查并扫码绑定；安装报错、未自动恢复连接或需要确认目标账号时，
也在此检查。</p>

<details id="verify-connection" class="full-check">
<summary>完整检查、扫码与恢复</summary>

### 安装命令报告版本不兼容

仅在安装命令报告版本不兼容时检查；需要
[OpenClaw](https://docs.openclaw.ai/install) `>=2026.6.1`：

```bash
openclaw --version
```

若版本过低或 Nix 模式禁止安装，请不要卸载现有插件；按
[安装限制与故障排查](docs/guide.md#安装限制)处理。

### 安装后没有自动连接

安装可能使启用了配置重载的受管 Gateway 自动重载。若仍未连接，请重启实际承载
OpenClaw 的服务、容器或 Pod，然后执行：

```bash
openclaw plugins list
openclaw channels status --probe
```

<div class="connection-criteria">
  <strong>满足以下条件即表示连接成功</strong>
  <ul>
    <li><code>openclaw plugins list</code> 显示插件已启用，并且没有加载错误。</li>
    <li><code>openclaw channels status --probe</code> 对目标微信账号探测成功。</li>
    <li>使用多账号时，探测结果对应你准备使用的别名或账号 ID。</li>
  </ul>
</div>

| 检查结果 | 下一步 |
| --- | --- |
| 插件显示已停用 | 执行 `openclaw plugins enable openclaw-weixin`，重载 Gateway，然后重新探测 |
| 插件无加载错误，且目标账号探测成功 | 已完成，无需继续操作 |
| 账号显示未登录 | 继续下面的扫码绑定 |
| Channel 显示 `OK` 但未连接 | 按[连接故障排查](docs/guide.md#channel-显示-ok-但未连接)重载实际运行单元 |

<h3 id="bind-account">状态显示未登录</h3>

仅在探测显示目标账号未登录时执行：

```bash
openclaw plugins enable openclaw-weixin
openclaw channels login --channel openclaw-weixin
```

登录命令会在终端显示二维码。扫码并等待登录完成，然后再次执行：

```bash
openclaw channels status --probe
```

</details>

## 多账号

如果会同时使用多个微信账号，建议先按「账号 + 渠道 + 对端」隔离私聊上下文：

```bash
openclaw config set session.dmScope per-account-channel-peer
```

这是 OpenClaw 的全局会话设置，会影响所有渠道；它不影响账号登录，只决定之后收到的
私聊消息如何分配会话。

再次执行登录命令即可绑定其他微信账号。建议为每个号使用**稳定别名**，以便
`openclaw.json` / bindings 用可读 `accountId`（而不是仅服务端 hash）：

```bash
openclaw channels login --channel openclaw-weixin --account wukong
openclaw channels login --channel openclaw-weixin --account nezha
```

<details>
<summary>账号 ID 与状态文件</summary>

登录成功后会写入：

- `openclaw-weixin/accounts/<ilink_bot_id 规范化>.json`（凭证与状态命名空间；`listAccountIds` / monitor 只用此 id）
- `openclaw-weixin/account-aliases.json`（一对一 `alias → hash` 逻辑映射，供 bindings / 出站解析；别名不会再起一条 transport）

未传 `--account` 时（宿主会传入 `default` 哨兵）只索引服务端 bot id，不会创建名为 `default` 的账号。已绑定过的 hash 账号再执行 `login --account <alias>` 时，会在不歧义的情况下登记别名映射（不在线改名、不搬迁状态命名空间）。

</details>

## 文档

- [详细指南](docs/guide.md)：安装行为、BotAgent、卸载和故障排查
- [后端 API 协议](docs/backend-api.md)
- [架构说明](docs/architecture.md)
- [llms.txt](https://openclaw-weixin.newfuture.cc/llms.txt)：面向智能体的文档索引
