# Community and Tencent distributions

[Back to overview](https://openclaw-weixin.newfuture.cc/en/) |
[简体中文](https://openclaw-weixin.newfuture.cc/distributions.html)

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
  published to reduce uncertainty from host upgrades and install-time
  compilation.
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
