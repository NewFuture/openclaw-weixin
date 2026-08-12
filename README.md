# openclaw-weixin

<!-- docs-site:repo-only:start -->
[English](https://openclaw-weixin.newfuture.cc/en/) · [在线文档](https://openclaw-weixin.newfuture.cc/)
<!-- docs-site:repo-only:end -->

<p class="product-tagline">把 OpenClaw 接入微信</p>

<p class="product-summary">
这是 <a href="https://github.com/Tencent/openclaw-weixin">Tencent/openclaw-weixin</a>
的社区维护发行版，提供 npm 与 ClawHub 两个发布入口。
</p>

<h2 id="connect-wechat">选择一种安装方式</h2>

<p class="choice-lead"><strong>推荐复制提示词，也可以直接运行命令。</strong>
提示词让 OpenClaw 优先使用 npm、失败时回退 ClawHub，并完成安装与连接检查；直接命令只安装或替换插件。</p>

<div class="install-choice">
  <a href="#agent-install"><strong>复制提示词</strong><span>npm 优先，ClawHub 兜底</span></a>
  <span class="choice-or" aria-hidden="true">或</span>
  <a href="#direct-install"><strong>运行命令</strong><span>自己选择 npm 或 ClawHub</span></a>
</div>

<!-- registry-prompt:start -->
<h3 id="agent-install">让 OpenClaw 自动完成安装</h3>

<p class="prompt-lead">把下面这段话粘贴到 OpenClaw 聊天框并发送：</p>

```text
请为当前 OpenClaw 安装或原位替换微信插件，并检查微信连接。优先安装 npm 的 `npm:openclaw-weixin`；仅当 npm 来源明确不可用时，改用 ClawHub 的 `clawhub:openclaw-wechat`，全程只安装一个。

请遵循 OpenClaw 的安装策略，对所用来源执行同一 `openclaw-weixin` 插件 ID 的原位替换（对应 `--force`），并保留现有配置和登录数据；请使用 OpenClaw 插件安装流程，而不是普通的 `npm install`。安装后确认插件已加载并探测微信 Channel；未登录时提示扫码。最后简要报告来源和结果；失败时说明原因。
```
<!-- registry-prompt:end -->

<h3 id="direct-install">直接运行命令</h3>

<!-- registry-source:npm:start -->
<h4 id="npm-source">npm：<code>openclaw-weixin</code></h4>

<p class="source-note"><strong>npm 页面、GitHub README 和文档站默认使用此来源。</strong>
<code>--force</code> 表示你已审阅并明确选择该 npm 来源，同时允许覆盖相同插件 ID
的现有安装。</p>

<h5 id="npm-cli-install">npm 命令</h5>

```bash
openclaw plugins install npm:openclaw-weixin --force
```
<!-- registry-source:npm:end -->

<!-- registry-source:clawhub:start -->
<h4 id="clawhub-source">ClawHub：<code>openclaw-wechat</code></h4>

<p class="source-note"><strong>ClawHub 包页面默认使用此来源。</strong>
页面顶部不带 <code>--force</code> 的命令适合没有现有微信插件的全新安装；下面保留
<code>--force</code>，使同一条命令也能原位替换占用 <code>openclaw-weixin</code>
插件 ID 的腾讯版或 npm 版。</p>

<h5 id="clawhub-cli-install">ClawHub 命令</h5>

```bash
openclaw plugins install clawhub:openclaw-wechat --force
```
<!-- registry-source:clawhub:end -->

<p class="replacement-note"><strong>替换腾讯版时不要先卸载。</strong>
两个社区发布源都保留插件 ID、Channel ID、配置和登录状态。
<code>--force</code> 不会绕过 OpenClaw 的安装策略或内置依赖拒绝列表；OpenClaw
会自动轮换配置备份。</p>

## 两个社区入口

| 安装来源 | 包名 |
| --- | --- |
| npm | `openclaw-weixin` |
| ClawHub | `openclaw-wechat` |

本项目是 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) 的
社区维护发行版；腾讯官方 npm 包是 `@tencent-weixin/openclaw-weixin`。社区版的包名和
发布渠道不同，但沿用 `openclaw-weixin` 插件、Channel 和状态 ID，因此可以原位替换并
保留现有配置与登录状态。

**两个社区入口任选一个即可，不要同时安装。**本插件需要 OpenClaw `>=2026.6.1`，并遵循
以下 Node.js 范围：`>=22.22.3 <23`、`>=24.15.0 <25` 或 `>=25.9.0`。

当前能力包括微信私聊、文本与媒体收发、扫码登录和多账号；插件没有声明群聊能力。

> **名称兼容：** `openclaw-wechat` 是 ClawHub 包名及 channel 兼容别名，
> `openclaw-weixin` 仍是规范 plugin/channel ID。在 OpenClaw 2026.7.1 及以上版本，
> 可以使用 `--channel openclaw-wechat` 选择同一 channel；较早的受支持宿主仍需使用
> `openclaw-weixin`。插件启停命令、配置和状态路径始终使用 `openclaw-weixin`，并且不要
> 同时安装两个发行包。

<p class="install-done"><strong>如果当前 OpenClaw 已有微信登录状态，安装后通常只需确认连接。</strong>
全新安装需要展开完整检查并扫码绑定；安装报错、未自动恢复连接或需要确认目标账号时，
也在此检查。</p>

<details id="verify-connection" class="full-check">
<summary>完整检查、扫码与恢复</summary>

### 安装命令报告版本不兼容

仅在安装命令报告版本不兼容时检查：

```bash
openclaw --version
node --version
```

需要 OpenClaw `>=2026.6.1` 以及上文列出的 Node.js 范围。若版本过低或 Nix 模式禁止
安装，请不要卸载现有插件；按
[安装限制与故障排查](https://openclaw-weixin.newfuture.cc/guide.html#安装限制)处理。

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
| Channel 显示 `OK` 但未连接 | 按[连接故障排查](https://openclaw-weixin.newfuture.cc/guide.html#channel-显示-ok-但未连接)重载实际运行单元 |

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

未传 `--account` 时（宿主会传入 `default` 哨兵）只索引服务端 bot id，不会创建名为
`default` 的账号。已绑定过的 hash 账号再执行 `login --account <alias>` 时，会在
不歧义的情况下登记别名映射（不在线改名、不搬迁状态命名空间）。

凭证、账号 ID 和 context token 均为敏感数据；不要共享
`~/.openclaw/openclaw-weixin/` 下的状态文件。

</details>

## 文档与支持

- [详细指南](https://openclaw-weixin.newfuture.cc/guide.html)：安装行为、BotAgent、卸载和故障排查
- [后端 API 协议](https://openclaw-weixin.newfuture.cc/backend-api.html)
- [架构说明](https://openclaw-weixin.newfuture.cc/architecture.html)
- [变更日志](https://openclaw-weixin.newfuture.cc/changelog.html)
- [安全策略](https://openclaw-weixin.newfuture.cc/security.html)
- [问题反馈](https://github.com/NewFuture/openclaw-weixin/issues)
- [llms.txt](https://openclaw-weixin.newfuture.cc/llms.txt)：面向智能体的文档索引
