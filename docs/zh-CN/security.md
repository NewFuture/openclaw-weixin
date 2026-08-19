# 安全策略

[English](../SECURITY.md)

## 受支持的版本

安全修复仅面向最新的社区发行版提供。在报告可能已经修复的问题前，请升级到最新发布的 `openclaw-weixin` 版本。

## 漏洞报告

请勿针对疑似漏洞创建普通 GitHub issue。请使用 [GitHub 私密漏洞报告][advisory]，并且初始仅提供：

- 受影响的插件和 OpenClaw 版本；
- 对预期影响的简要说明；以及
- 请求使用安全渠道共享复现详情。

请勿包含凭据、账号标识符、二维码或私信内容。仓库管理员会在草稿安全公告中跟踪已确认的报告。

## 诊断隐私

INFO、WARN 和 ERROR 日志会完全遮盖标识符与令牌。仅在显式启用 DEBUG 时，日志才可显示
经过脱敏的短前缀。任何日志级别都不得包含消息正文、URL 查询参数、二维码 URL 或原始文件
系统路径。报告问题时应提供事件名称、状态码、计数和耗时，而不是敏感值。

[advisory]: https://github.com/NewFuture/openclaw-weixin/security/advisories/new
