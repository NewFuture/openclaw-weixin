# openclaw-weixin

<!-- docs-site:repo-only:start -->
[简体中文](https://openclaw-weixin.newfuture.cc/) · [Documentation site](https://openclaw-weixin.newfuture.cc/en/)
<!-- docs-site:repo-only:end -->

<p class="product-tagline">Bring OpenClaw into WeChat</p>

<p class="product-summary">
This community-maintained distribution of
<a href="https://github.com/Tencent/openclaw-weixin">Tencent/openclaw-weixin</a>
is available from both npm and ClawHub.
</p>

<h2 id="connect-wechat">Choose an installation method</h2>

<p class="choice-lead"><strong>Copy the prompt, or run a command directly.</strong>
The prompt tries ClawHub first, falls back to npm, and completes installation
and connection checks; direct commands only install or replace the plugin.</p>

<div class="install-choice">
  <a href="#agent-install"><strong>Copy the prompt</strong><span>ClawHub first, npm fallback</span></a>
  <span class="choice-or" aria-hidden="true">or</span>
  <a href="#direct-install"><strong>Run a command</strong><span>Choose npm or ClawHub yourself</span></a>
</div>

<!-- registry-prompt:start -->
<h3 id="agent-install">Let OpenClaw complete the installation</h3>

<p class="prompt-lead">Paste this prompt into an OpenClaw chat and send it:</p>

```text
Install or replace the WeChat plugin in place for this OpenClaw instance and check its connection. Install from ClawHub `clawhub:openclaw-wechat` first; only if the ClawHub source is explicitly unavailable, fall back to npm `npm:openclaw-weixin`, and install only one.

Follow OpenClaw's install policy and use in-place replacement for an existing installation with the same `openclaw-weixin` plugin ID (the `--force` behavior), preserving configuration and login data. Use the OpenClaw plugin installation flow rather than plain `npm install`. After installation, verify that the plugin is loaded and probe the WeChat channel; prompt for QR login if needed. Briefly report the source and result, or explain the failure.
```
<!-- registry-prompt:end -->

<h3 id="direct-install">Run a command directly</h3>

<!-- registry-source:npm:start -->
<h4 id="npm-source">npm: <code>openclaw-weixin</code></h4>

<p class="source-note"><strong>The npm page, GitHub README, and documentation site
default to this source.</strong> <code>--force</code> confirms that you reviewed and
selected this npm source and allows replacement of an existing installation with
the same plugin id.</p>

<h5 id="npm-cli-install">npm command</h5>

```bash
openclaw plugins install npm:openclaw-weixin --force
```
<!-- registry-source:npm:end -->

<!-- registry-source:clawhub:start -->
<h4 id="clawhub-source">ClawHub: <code>openclaw-wechat</code></h4>

<p class="source-note"><strong>The ClawHub package page defaults to this source.</strong>
The banner command without <code>--force</code> is suitable for a fresh install
with no existing WeChat plugin. The command below keeps <code>--force</code> so it
can also replace a Tencent or npm installation that owns the
<code>openclaw-weixin</code> plugin id.</p>

<h5 id="clawhub-cli-install">ClawHub command</h5>

```bash
openclaw plugins install clawhub:openclaw-wechat --force
```
<!-- registry-source:clawhub:end -->

<p class="replacement-note"><strong>Do not uninstall Tencent's package first when
replacing it.</strong> Both community sources preserve the plugin id, channel id,
configuration, and login state. <code>--force</code> does not bypass OpenClaw's
install policy or built-in dependency denylist. OpenClaw rotates configuration
backups automatically.</p>

## Community package sources

| Source | Package name |
| --- | --- |
| npm | `openclaw-weixin` |
| ClawHub | `openclaw-wechat` |

This project is a community-maintained distribution of
[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin); Tencent's
official npm package is `@tencent-weixin/openclaw-weixin`. The community package
names and registries differ, but they keep the `openclaw-weixin` plugin, channel,
and state ID, allowing in-place replacement without losing existing configuration
or login state.

**Choose one community source; do not install both.** The plugin requires OpenClaw
`>=2026.6.1` and one of these Node.js ranges: `>=22.22.3 <23`,
`>=24.15.0 <25`, or `>=25.9.0`.

Current capabilities include direct chats, text and media transfer, QR login,
and multiple accounts. The plugin does not advertise group-chat support.

> **Name compatibility:** `openclaw-wechat` is the ClawHub package name and
> channel compatibility alias; `openclaw-weixin` remains the canonical
> plugin/channel ID. On OpenClaw 2026.7.1 and later,
> `--channel openclaw-wechat` selects the same channel; earlier supported hosts
> must continue to use `openclaw-weixin`. Plugin enable/disable commands, config,
> and state paths always use `openclaw-weixin`. Do not install both
> distributions at once.

<p class="install-done"><strong>If this OpenClaw instance already has a WeChat login,
you usually only need to confirm the connection after installation.</strong> For a
new installation, open the full check and scan the QR code. Use it as well when
installation fails, the connection does not return automatically, or you need to
confirm the intended account.</p>

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

<div class="connection-criteria">
  <strong>You are connected when all of these are true</strong>
  <ul>
    <li><code>openclaw plugins list</code> shows the plugin enabled with no load error.</li>
    <li><code>openclaw channels status --probe</code> succeeds for the intended WeChat account.</li>
    <li>With multiple accounts, the result belongs to the alias or account ID you intend to use.</li>
  </ul>
</div>

| Result | Next action |
| --- | --- |
| Plugin is disabled | Run `openclaw plugins enable openclaw-weixin`, reload the Gateway, then probe again |
| Plugin has no load error and the intended account passes the probe | You are done |
| Account is not logged in | Continue to QR login below |
| Channel shows `OK` but does not connect | Follow [connection troubleshooting](https://openclaw-weixin.newfuture.cc/en/guide.html#channel-shows-ok-but-doesn-t-connect) to reload the actual runtime |

<h3 id="bind-account">The status reports no login</h3>

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

## Documentation and support

- [Detailed guide](https://openclaw-weixin.newfuture.cc/en/guide.html): install behavior, BotAgent, uninstall, and troubleshooting
- [Backend API protocol](https://openclaw-weixin.newfuture.cc/en/backend-api.html)
- [Architecture](https://openclaw-weixin.newfuture.cc/en/architecture.html)
- [Changelog](https://openclaw-weixin.newfuture.cc/en/changelog.html)
- [Security policy](https://openclaw-weixin.newfuture.cc/en/security.html)
- [Issue tracker](https://github.com/NewFuture/openclaw-weixin/issues)
- [llms.txt](https://openclaw-weixin.newfuture.cc/llms.txt): machine-readable documentation index
