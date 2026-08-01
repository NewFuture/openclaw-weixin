# Detailed Guide

[Back to README](../README_EN.md) | [简体中文](./guide.zh_CN.md)

## Installation Details

### Package Names and State

The npm package, plugin id, and channel id are all `openclaw-weixin`. The
[install command](../README_EN.md#install-or-replace) preserves the existing
`channels.openclaw-weixin`, `plugins.entries.openclaw-weixin`, and
`~/.openclaw/openclaw-weixin/` state paths.

`--force` confirms the npm source and allows OpenClaw to replace a plugin with
the same internal id. OpenClaw rotates backups of its config automatically; do
not copy the entire state directory for this replacement.

### Limitations

- Use the CLI for this community npm package. OpenClaw's Control UI does not
  install arbitrary npm, git, or local-path plugin sources.
- In Nix mode (`OPENCLAW_NIX_MODE=1`), plugin install, update, uninstall,
  enable, and disable commands are intentionally disabled. Add the package and
  config to the Nix source, then rebuild instead.
- OpenClaw installs plugin dependencies with lifecycle scripts disabled. This
  package therefore ships its compiled `dist/index.js` runtime and does not
  build on the user's machine.

## Custom BotAgent (optional)

Every authenticated post-login request to the WeChat backend carries a
self-declared `bot_agent` identifier — analogous to an HTTP `User-Agent` — used
for log attribution and monitoring aggregation. The default is `OpenClaw`.
Declaring your own app name makes it much easier to trace your traffic in
backend logs.

Add one line to `openclaw.json`:

```json
{
  "channels": {
    "openclaw-weixin": {
      "botAgent": "MyBot/1.2.0"
    }
  }
}
```

**Format** (UA-style):

- One or more `Name/Version` tokens, space-separated
- Each token may optionally be followed by ` (comment)`
- ASCII only; total length ≤ 256 bytes
- Invalid tokens are silently dropped during sanitization; falls back to
  `OpenClaw` if nothing valid remains

Examples that pass through unchanged:

- `MyBot/1.2.0`
- `MyBot/1.2.0 (region=cn;env=prod)`
- `MyBot/1.2.0 LangChain/0.3.5`
- `MyBot/1.2.0-rc.1+build.5`

**Note**: `bot_agent` is for observability only — it is not used for
authentication or routing. All registered agents on this plugin instance
currently share the same `botAgent` declaration; per-agent overrides may be
added in a future version if needed.

## Uninstall

> [!WARNING]
> Do not uninstall when replacing Tencent's package. Use the
> [install command](../README_EN.md#install-or-replace) instead.

Back up `~/.openclaw/openclaw.json` first if you may want to reinstall: current
OpenClaw versions remove the plugin entry and owned
`channels.openclaw-weixin` configuration during uninstall.

```bash
openclaw plugins uninstall openclaw-weixin
```

## Troubleshooting

### "requires OpenClaw >=2026.6.1" error

Your OpenClaw version is too old for this plugin version. Check with:

```bash
openclaw --version
```

Upgrade OpenClaw before installing this package. The community package does not
publish a legacy compatibility line.

### Channel shows "OK" but doesn't connect

Enable the plugin, reload or restart the actual unit that runs OpenClaw, and
probe the channel again:

```bash
openclaw plugins enable openclaw-weixin
openclaw channels status --probe
```

## Developer Documentation

- [Backend API protocol](./backend-api.md)
- [Architecture](./architecture.md)
