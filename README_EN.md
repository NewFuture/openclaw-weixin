# openclaw-weixin

<!-- docs-site:repo-only:start -->
[简体中文](https://openclaw-weixin.newfuture.cc/) · [Documentation site](https://openclaw-weixin.newfuture.cc/en/)
<!-- docs-site:repo-only:end -->

**Bring OpenClaw into WeChat**

A community-maintained OpenClaw WeChat channel plugin available from npm and
ClawHub.
This plugin requires OpenClaw `>=2026.6.1`.

<a id="connect-wechat"></a>

## Choose an installation method

[**Copy the prompt**](#agent-install) **or** [**Run a command**](#direct-install)

<!-- registry-prompt:start -->
<a id="agent-install"></a>

### Let OpenClaw complete the installation

Paste this prompt into an OpenClaw chat and send it:

```text
Install or replace the WeChat plugin in place for this OpenClaw instance and check its connection. Install from ClawHub `clawhub:openclaw-wechat` first; only if the ClawHub source is explicitly unavailable, fall back to npm `npm:openclaw-weixin`, and install only one.
Follow OpenClaw's install policy and use in-place replacement for an existing installation with the same `openclaw-weixin` plugin ID (the `--force` behavior), preserving configuration and login data. Use the OpenClaw plugin installation flow rather than plain `npm install`. After installation, verify that the plugin is loaded and probe the WeChat channel; prompt for QR login if needed. Briefly report the source and result, or explain the failure.
```
<!-- registry-prompt:end -->

<a id="direct-install"></a>

### Run a command directly

**Do not uninstall Tencent's package first when replacing it.** Both community
sources preserve the plugin id, channel id, configuration, and login state.
`--force` does not bypass OpenClaw's install policy or built-in dependency
denylist. OpenClaw rotates configuration backups automatically.

`--force` allows replacement of an existing installation with the same plugin
id.

| Source | Package name |
| --- | --- |
| npm | [`openclaw-weixin`](https://www.npmjs.com/package/openclaw-weixin) |
| ClawHub | [`openclaw-wechat`](https://clawhub.ai/newfuture/plugins/openclaw-wechat) |

<!-- registry-source:npm:start -->
<a id="npm-source"></a>

#### npm: `openclaw-weixin`

<a id="npm-cli-install"></a>

```bash
openclaw plugins install npm:openclaw-weixin --force
```
<!-- registry-source:npm:end -->

<!-- registry-source:clawhub:start -->
<a id="clawhub-source"></a>

#### ClawHub: `openclaw-wechat`

The command can also replace a Tencent or npm installation that owns the
`openclaw-weixin` plugin id.

<a id="clawhub-cli-install"></a>

```bash
openclaw plugins install clawhub:openclaw-wechat --force
```
<!-- registry-source:clawhub:end -->

**If this OpenClaw instance already has a WeChat login, you usually only need
to confirm the connection after installation.** For a new installation, open
the full check and scan the QR code. Use it as well when installation fails,
the connection does not return automatically, or you need to confirm the
intended account.

<details id="verify-connection" class="full-check">
<summary>Full check, QR login, and recovery</summary>

### The install command reports an incompatible version

Check only when installation reports an incompatible version:

```bash
openclaw --version
```

The plugin requires OpenClaw `>=2026.6.1`. If the host is too old or Nix mode
disables installation, do not uninstall the existing plugin. Follow the
[installation limitations and troubleshooting](https://openclaw-weixin.newfuture.cc/en/guide.html#limitations).

### The connection does not return after installation

Installation can automatically reload a managed Gateway with configuration
reload enabled. If it remains disconnected, restart the service, container, or
pod that actually runs OpenClaw, then run:

```bash
openclaw plugins list
openclaw channels status --probe
```

**You are connected when all of these are true:**

- `openclaw plugins list` shows the plugin enabled with no load error.
- `openclaw channels status --probe` succeeds for the intended WeChat account.
- With multiple accounts, the result belongs to the alias or account ID you
  intend to use.

| Result | Next action |
| --- | --- |
| Plugin is disabled | Run `openclaw plugins enable openclaw-weixin`, reload the Gateway, then probe again |
| Plugin has no load error and the intended account passes the probe | You are done |
| Account is not logged in | Continue to QR login below |
| Channel shows `OK` but does not connect | Follow [connection troubleshooting](https://openclaw-weixin.newfuture.cc/en/guide.html#channel-shows-ok-but-doesn-t-connect) to reload the actual runtime |

<a id="bind-account"></a>

### The status reports no login

Run this only when the probe reports that the intended account is not logged in:

```bash
openclaw plugins enable openclaw-weixin
openclaw channels login --channel openclaw-weixin
```

The login command displays a QR code in the terminal. Scan it, wait for login to
finish, then run:

```bash
openclaw channels status --probe
```

</details>

## Multiple accounts

Before using multiple WeChat accounts, consider isolating direct-message context
by account + channel + sender:

```bash
openclaw config set session.dmScope per-account-channel-peer
```

This is a global OpenClaw session setting that affects every channel. It does not
change account login; it controls how subsequent direct messages are assigned to
sessions.

Run the login command again to bind another WeChat account. Prefer a **stable
alias** per number so `openclaw.json` / bindings can use a readable `accountId`
instead of only the server hash:

```bash
openclaw channels login --channel openclaw-weixin --account alice
openclaw channels login --channel openclaw-weixin --account bob
```

<details>
<summary>Account IDs and state files</summary>

A successful login writes:

- `openclaw-weixin/accounts/<normalized ilink_bot_id>.json` (credential + state namespace; `listAccountIds` / monitors use only this id)
- `openclaw-weixin/account-aliases.json` (1:1 `alias → hash` map for bindings / outbound resolution; aliases never start a second transport)

Without `--account` (the host passes its `default` sentinel), only the server bot
id is indexed; a `default` account file is never created. Re-running
`login --account <alias>` against an already-bound hash-only install records an
alias mapping when unambiguous, without an online rename or state-namespace move.

Credentials, account IDs, and context tokens are sensitive. Do not share state
files from `~/.openclaw/openclaw-weixin/`.

</details>

## Block replies

By default, the plugin sends completed text blocks produced between multi-step
tool calls in order, followed by the final reply. Block replies are not token
streaming; OpenClaw may combine short blocks according to the channel coalescing
policy. Tool-call progress messages remain controlled separately by
`replyProgressMessages`.

To send only the final reply, disable block replies:

```bash
openclaw config set channels.openclaw-weixin.blockStreaming false
```

The channel setting can be overridden per account at
`channels.openclaw-weixin.accounts.<accountId>.blockStreaming`.

## Proactive and scheduled sends

The WeChat backend requires every outbound message to carry an account-scoped
context token issued by an inbound message from that recipient. The plugin
stores the token under the receiving account:

- If the recipient has not messaged the bot or the token is missing, the plugin
  refuses delivery instead of returning a local success result.
- A stored token can still become stale. If a send fails after a long idle
  period, ask the recipient to message the corresponding bot once to refresh
  the token, then retry.

Scheduled jobs in multi-account deployments should explicitly set both
`delivery.to` and `delivery.accountId`. Without `accountId`, delivery proceeds
only when account-scoped context selects exactly one account; missing or
ambiguous context fails. Context tokens are sensitive: never copy them between
accounts or put them in job configuration.

## Documentation and support

- [Detailed guide](https://openclaw-weixin.newfuture.cc/en/guide.html): install behavior, optional settings, proactive-send constraints, uninstall, and troubleshooting
- [Community and Tencent distributions](https://openclaw-weixin.newfuture.cc/en/distributions.html)
- [Backend API protocol](https://openclaw-weixin.newfuture.cc/en/backend-api.html)
- [Architecture](https://openclaw-weixin.newfuture.cc/en/architecture.html)
- [Contributing and agent workflows](https://openclaw-weixin.newfuture.cc/en/contributing.html): open issues, fix bugs, and develop features
- [Coding agent guide](https://github.com/NewFuture/openclaw-weixin/blob/main/AGENTS.md)
- [Changelog](https://openclaw-weixin.newfuture.cc/en/changelog.html)
- [Security policy](https://openclaw-weixin.newfuture.cc/en/security.html)
- [Issue tracker](https://github.com/NewFuture/openclaw-weixin/issues)
- [llms.txt](https://openclaw-weixin.newfuture.cc/llms.txt): machine-readable documentation index
