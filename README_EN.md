# openclaw-weixin

<!-- docs-site:repo-only:start -->
[简体中文](https://openclaw-weixin.newfuture.cc/) · [Documentation site](https://openclaw-weixin.newfuture.cc/en/)
<!-- docs-site:repo-only:end -->

**Bring OpenClaw into WeChat**

A community-maintained OpenClaw WeChat channel plugin available from npm and
ClawHub.

<a id="connect-wechat"></a>

## Choose an installation method

**Copy the prompt, or run a command directly.**

The prompt tries ClawHub first, falls back to npm, and completes installation
and connection checks; direct commands only install or replace the plugin.

- [**Copy the prompt**](#agent-install)
- **or**
- [**Run a command**](#direct-install)

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

<!-- registry-source:npm:start -->
#### npm: `openclaw-weixin`

**The npm page, GitHub README, and documentation site default to this source.**
`--force` confirms that you reviewed and selected this npm source and allows
replacement of an existing installation with the same plugin id.

##### npm command

```bash
openclaw plugins install npm:openclaw-weixin --force
```
<!-- registry-source:npm:end -->

<!-- registry-source:clawhub:start -->
#### ClawHub: `openclaw-wechat`

**The ClawHub package page defaults to this source.** The banner command without
`--force` is suitable for a fresh install with no existing WeChat plugin. The
command below keeps `--force` so it can also replace a Tencent or npm
installation that owns the `openclaw-weixin` plugin id.

##### ClawHub command

```bash
openclaw plugins install clawhub:openclaw-wechat --force
```
<!-- registry-source:clawhub:end -->

> [!WARNING]
> **Do not uninstall Tencent's package first when replacing it.** Both community
> sources preserve the plugin id, channel id, configuration, and login state.
> `--force` does not bypass OpenClaw's install policy or built-in dependency
> denylist. OpenClaw rotates configuration backups automatically.

## Installation sources

| Source | Package name |
| --- | --- |
| npm | [`openclaw-weixin`](https://www.npmjs.com/package/openclaw-weixin) |
| ClawHub | [`openclaw-wechat`](https://clawhub.ai/newfuture/plugins/openclaw-wechat) |

Both installation sources publish the same community distribution. The plugin
requires OpenClaw `>=2026.6.1` and one of these Node.js ranges: `>=22.22.3 <23`,
`>=24.15.0 <25`, or `>=25.9.0`.

## Community and Tencent distributions

This project is a community-maintained distribution of
[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin); Tencent's
official npm package is `@tencent-weixin/openclaw-weixin`. This project is
maintained and published independently and is not an official Tencent or WeChat
release. Both distributions use the same WeChat backend protocol and
`openclaw-weixin` internal identity. The main differences are their publication
sources and how fixes, new features, and security updates are incorporated.

- **Shipped community fixes:** On top of Tencent upstream, this distribution
  includes inbound replay deduplication, per-agent inbound media isolation,
  stable multi-account aliases, case-insensitive context-token user IDs, and
  explicit failure instead of false success when a context token is missing. See
  the [community changelog](https://openclaw-weixin.newfuture.cc/en/changelog.html)
  for the first release of each change.
- **Explicit compatibility boundaries:** The minimum supported host and
  recommended development host are both validated, and a precompiled runtime is
  published for the documented Node.js ranges, reducing uncertainty from host
  upgrades and install-time compilation.
- **Flexible installation and migration:** The same community implementation is
  available from npm and ClawHub. It retains Tencent's plugin, channel, and state
  ID, allowing an in-place replacement that preserves configuration and login
  state.
- **Transparent maintenance:** Bilingual documentation and changelogs are paired
  with an [upstream intake tracker](https://github.com/NewFuture/openclaw-weixin/issues/36)
  that distinguishes Tencent-side status, community inclusion, and release
  status.

Current capabilities include direct chats, text and media transfer, QR login,
and multiple accounts.

> **Name compatibility:** `openclaw-wechat` is the ClawHub package name and
> channel compatibility alias; `openclaw-weixin` remains the canonical
> plugin/channel ID. On OpenClaw 2026.7.1 and later,
> `--channel openclaw-wechat` selects the same channel; earlier supported hosts
> must continue to use `openclaw-weixin`. Plugin enable/disable commands, config,
> and state paths always use `openclaw-weixin`.

> [!TIP]
> **If this OpenClaw instance already has a WeChat login, you usually only need
> to confirm the connection after installation.** For a new installation, open
> the full check and scan the QR code. Use it as well when installation fails,
> the connection does not return automatically, or you need to confirm the
> intended account.

<details id="verify-connection" class="full-check">
<summary>Full check, QR login, and recovery</summary>

### The install command reports an incompatible version

Check only when installation reports an incompatible version:

```bash
openclaw --version
node --version
```

The plugin requires OpenClaw `>=2026.6.1` and one of the Node.js ranges listed
above. If either version is too old or Nix mode disables installation, do not
uninstall the existing plugin. Follow the
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
- [Backend API protocol](https://openclaw-weixin.newfuture.cc/en/backend-api.html)
- [Architecture](https://openclaw-weixin.newfuture.cc/en/architecture.html)
- [Changelog](https://openclaw-weixin.newfuture.cc/en/changelog.html)
- [Security policy](https://openclaw-weixin.newfuture.cc/en/security.html)
- [Issue tracker](https://github.com/NewFuture/openclaw-weixin/issues)
- [llms.txt](https://openclaw-weixin.newfuture.cc/llms.txt): machine-readable documentation index
