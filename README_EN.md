# openclaw-weixin

[简体中文](./README.md) · [Documentation site](https://openclaw-weixin.newfuture.cc/en/)

Community-maintained distribution of
[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) that
connects OpenClaw with WeChat for a better messaging experience.

## Install or Replace

Requires [OpenClaw](https://docs.openclaw.ai/install) `>=2026.6.1`. Run commands
as the same user and in the same environment as OpenClaw.

**CLI—one-command install or replacement:**

> Tip: **Do not** uninstall `@tencent-weixin/openclaw-weixin` first; replacing it
> in place usually preserves the existing configuration and login state.

```bash
openclaw plugins install npm:openclaw-weixin --force
```

<details>
<summary>Bind a WeChat account (new installations)</summary>

To bind a WeChat account to this OpenClaw instance, enable the plugin and start
the QR flow:

```bash
openclaw plugins enable openclaw-weixin
openclaw channels login --channel openclaw-weixin
```

The login command displays a QR code in the terminal.

</details>

<details>
<summary>Reload check</summary>

Ensure the running Gateway has reloaded the plugin. If needed, restart the
service, container, or pod that runs OpenClaw, then run:

```bash
openclaw plugins list
openclaw channels status --probe
```

It is ready when the plugin has no load error and the intended account passes
the probe. If the probe reports no login, use the login command above.

</details>

### Automatic Installation Prompt

Send the following prompt directly to an OpenClaw Agent to safely install or
replace the plugin in place:

```text
Install or replace `openclaw-weixin` without changing the existing configuration
or login state:
1. Verify that `openclaw --version` is at least 2026.6.1.
2. I trust the npm source `openclaw-weixin`. Run
   `openclaw plugins install npm:openclaw-weixin --force`; do not uninstall first.
3. Enable the plugin only if `openclaw plugins list` shows it disabled. Do not
   restart the Gateway yourself or start QR login. Installation may automatically
   restart a managed Gateway with config reload enabled. If it does, run
   `openclaw channels status --probe`; otherwise, ask whether to restart the Gateway.
4. Report only the result. If WeChat is not logged in, ask me to manually run
   `openclaw channels login --channel openclaw-weixin` and scan the QR code.
```

### Install Through an Agent Command

On OpenClaw `>=2026.7.2-beta.1`, if `commands.plugins: true` is set and you are
an owner/admin, send:

```text
/plugins install npm:openclaw-weixin --force
```

Then follow **Reload check** above.

## Multiple Accounts

Run the login command again to bind another WeChat account. Prefer a **stable
alias** per number so `openclaw.json` / bindings can use a readable `accountId`
instead of only the server hash:

```bash
openclaw channels login --channel openclaw-weixin --account leader
openclaw channels login --channel openclaw-weixin --account jinjin
```

A successful login writes:

- `openclaw-weixin/accounts/<normalized ilink_bot_id>.json` (credential + state namespace; `listAccountIds` / monitors use only this id)
- `openclaw-weixin/account-aliases.json` (1:1 `alias → hash` map for bindings / outbound resolution; aliases never start a second transport)

Without `--account` (the host passes its `default` sentinel) only the server bot id is indexed; a `default` account file is never created. Re-running `login --account <alias>` against an already-bound hash-only install records an alias mapping when unambiguous (no online rename, no state-namespace move).

For multiple logged-in accounts, isolate context by account + channel + sender:

```bash
openclaw config set session.dmScope per-account-channel-peer
```

## Documentation

- [Detailed guide](docs/guide.md): install behavior, BotAgent, uninstall, and
  troubleshooting
- [Backend API protocol](docs/backend-api.md)
- [Architecture](docs/architecture.md)
- [Documentation site](https://openclaw-weixin.newfuture.cc/en/): multilingual
  documentation that also serves the raw Markdown and an
  [llms.txt](https://openclaw-weixin.newfuture.cc/llms.txt) index
