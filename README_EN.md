# openclaw-weixin

[简体中文](./README.md)

Community-maintained distribution of
[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) that
connects OpenClaw with WeChat for a better messaging experience.
Requires [OpenClaw](https://docs.openclaw.ai/install) `>=2026.7.1`.

## Install or Replace


### CLI — one-command install or replacement

> Run in the same user and environment as OpenClaw. Do not uninstall `@tencent-weixin/openclaw-weixin`.

```bash
openclaw plugins install npm:openclaw-weixin --force
```

<details>
<summary>Bind a WeChat account</summary>

To bind a WeChat account to this OpenClaw instance without use wechat before, enable the plugin and start
the QR flow:

```bash
openclaw plugins enable openclaw-weixin
openclaw channels login --channel openclaw-weixin
```

The login command displays a QR code in the terminal or web.

</details>

<details>
<summary>Reload and check</summary>

Ensure the running Gateway has reloaded the plugin. If needed, restart the
service, container, or pod that runs OpenClaw, then run:

```bash
openclaw plugins list
openclaw channels status --probe
```

It is ready when the plugin has no load error and the intended account passes
the probe. If the probe reports no login, use the login command above.

</details>

### Install Through an Agent via messages

On OpenClaw `>=2026.7.2-beta.1`, if `commands.plugins: true` is set and you are
an owner/admin, send this command to the chat:

```text
/plugins install npm:openclaw-weixin --force
```

Then follow **Reload and check** above.

### Shell Agent Prompt

Copy and send this prompt directly to an agent with Shell access. It safely
installs or replaces the plugin in place, while leaving any Gateway restart or
QR scan to you:

```text
Install or replace `openclaw-weixin` in place without changing its existing
configuration or login state. Verify `openclaw --version` is at least 2026.7.1.
I trust the npm source `openclaw-weixin`. Run
`openclaw plugins install npm:openclaw-weixin --force`; do not uninstall first
or inspect or copy workspace, credential, or account-state files. Enable the
plugin only if `openclaw plugins list` shows it disabled. Do not restart the
Gateway or start QR login. Tell me what to reload; after I reload it, run
`openclaw channels status --probe` and report only redacted results. If not
logged in, ask me to scan manually.
```

## Multiple Accounts

Run the login command again to bind another WeChat account:

```bash
openclaw channels login --channel openclaw-weixin
```

For multiple logged-in accounts, isolate context by account + channel + sender:

```bash
openclaw config set session.dmScope per-account-channel-peer
```

## Documentation

- [Detailed guide](docs/guide.md): install behavior, BotAgent, uninstall, and
  troubleshooting
- [Backend API protocol](docs/backend-api.md)
- [Architecture](docs/architecture.md)
