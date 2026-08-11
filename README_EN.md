# openclaw-weixin

<!-- docs-site:repo-only:start -->
[简体中文](./README.md) · [Documentation site](https://openclaw-weixin.newfuture.cc/en/)
<!-- docs-site:repo-only:end -->

<p class="product-tagline">Bring OpenClaw into WeChat</p>

<p class="product-summary">
This community-maintained distribution of
<a href="https://github.com/Tencent/openclaw-weixin">Tencent/openclaw-weixin</a>
installs or replaces the plugin using either one prompt or one command.
</p>

<h2 id="connect-wechat">Choose one installation method</h2>

<p class="choice-lead"><strong>We recommend the prompt; you can also run the command directly.</strong>
Both produce the same result. Choose one; do not run both. If you run the
command directly, use the same user and environment that run OpenClaw.</p>

<div class="install-choice">
  <a href="#agent-install"><strong>Copy a prompt</strong><span>Paste it into an OpenClaw chat</span></a>
  <span class="choice-or" aria-hidden="true">or</span>
  <a href="#cli-install"><strong>Run a command</strong><span>Execute one line in your terminal</span></a>
</div>

<h3 id="agent-install">Copy the prompt</h3>

<p class="prompt-lead">Copy this prompt, paste it into an OpenClaw chat, and send it:</p>

```text
Install or replace the plugin with OpenClaw's plugin installer by running exactly
`openclaw plugins install npm:openclaw-weixin --force`. Do not uninstall first or
use plain `npm install`; do not delete existing configuration or login data.
If you cannot run terminal commands, say so. After a successful install, run
`openclaw channels status --probe` if the Gateway restarted automatically. If it
did not, ask me whether to restart it and run the probe only after the restart is
confirmed complete. If the probe reports that WeChat is not logged in, tell me to run
`openclaw channels login --channel openclaw-weixin` and scan the QR code. Finally,
report the actual result.
```

<h3 id="cli-install">Run one command</h3>

```bash
openclaw plugins install npm:openclaw-weixin --force
```

<p class="replacement-note"><strong>Do not uninstall Tencent's package first.</strong>
Installing directly preserves the existing configuration and login state.
<code>--force</code> overwrites an existing plugin installation; it does not
change source-trust or security policy. OpenClaw rotates configuration backups
automatically.</p>

> **Name compatibility:** `openclaw-wechat` is the ClawHub package name and
> channel compatibility alias; `openclaw-weixin` remains the canonical
> plugin/channel ID. On OpenClaw 2026.7.1 and later,
> `--channel openclaw-wechat` selects the same channel; earlier supported hosts
> must continue to use `openclaw-weixin`. Plugin enable/disable commands, config,
> and state paths always use `openclaw-weixin`. Do not install both
> distributions at once.

<p class="install-done"><strong>If this OpenClaw instance already has a WeChat login,
either option is usually all you need.</strong> For a new installation, open the full
check and scan the QR code. Use it as well when installation fails, the connection
does not return automatically, or you need to confirm the intended account.</p>

<details id="verify-connection" class="full-check">
<summary>Full check, QR login, and recovery</summary>

### The install command reports an incompatible version

Check only when installation reports an incompatible version. Requires
[OpenClaw](https://docs.openclaw.ai/install) `>=2026.6.1`:

```bash
openclaw --version
```

If the version is too old or Nix mode disables installation, do not uninstall the
existing plugin. Follow the
[installation limitations and troubleshooting](docs/guide_EN.md#limitations).

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
| Channel shows `OK` but does not connect | Follow [connection troubleshooting](docs/guide_EN.md#channel-shows-ok-but-doesnt-connect) to reload the actual runtime |

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

## Multiple Accounts

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

Without `--account` (the host passes its `default` sentinel) only the server bot id is indexed; a `default` account file is never created. Re-running `login --account <alias>` against an already-bound hash-only install records an alias mapping when unambiguous (no online rename, no state-namespace move).

</details>

## Documentation

- [Detailed guide](docs/guide_EN.md): install behavior, BotAgent, uninstall, and
  troubleshooting
- [Backend API protocol](docs/backend-api_EN.md)
- [Architecture](docs/architecture_EN.md)
- [llms.txt](https://openclaw-weixin.newfuture.cc/llms.txt): machine-readable
  documentation index
