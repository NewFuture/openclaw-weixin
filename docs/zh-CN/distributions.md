# 社区版与腾讯版

[返回概览](https://openclaw-weixin.newfuture.cc/) |
[English](https://openclaw-weixin.newfuture.cc/en/distributions.html)

本项目是 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) 的
社区维护发行版；腾讯官方 npm 包是 `@tencent-weixin/openclaw-weixin`。本项目由社区
独立维护和发布，不是腾讯或微信官方版本。两者使用相同的微信后端协议及
`openclaw-weixin` 内部标识，差异主要在发布来源、修复纳入和新功能支持以及安全更新。

- **已发布的社区修复：** 在腾讯上游基础上，已加入入站重放去重、按 Agent 隔离入站
  媒体、稳定多账号别名、context token 用户 ID 大小写兼容，以及缺少 context token
  时拒绝“假成功”；具体首发版本见[社区变更日志](https://openclaw-weixin.newfuture.cc/changelog.html)。
- **明确的兼容边界：** 同时验证最低支持宿主与推荐开发宿主，并发布预编译运行时，
  减少宿主升级或安装期编译带来的不确定性。
- **灵活的安装与迁移：** 同一套社区实现提供 npm 和 ClawHub 两个安装源，并沿用腾讯版的
  插件、Channel 和状态 ID，可原位替换并保留现有配置与登录状态。
- **透明的维护过程：** 提供中英文文档与变更日志，并在
  [上游合入跟踪](https://github.com/NewFuture/openclaw-weixin/issues/36)中区分腾讯侧
  状态、社区版合入和正式发布。

当前能力包括微信私聊、文本与媒体收发、扫码登录和多账号。

> **名称兼容：** `openclaw-wechat` 是 ClawHub 包名及 channel 兼容别名，
> `openclaw-weixin` 仍是规范 plugin/channel ID。在 OpenClaw 2026.7.1 及以上版本，
> 可以使用 `--channel openclaw-wechat` 选择同一 channel；较早的受支持宿主仍需使用
> `openclaw-weixin`。插件启停命令、配置和状态路径始终使用 `openclaw-weixin`。
