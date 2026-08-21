# Security Policy

[简体中文](./zh-CN/security.md)

## Supported versions

Security fixes are provided for the latest community release. Upgrade to the
latest published `openclaw-weixin` version before reporting an issue that may
already be fixed.

## Reporting a vulnerability

Do not open a regular GitHub issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting][advisory] and initially include only:

- the affected plugin and OpenClaw versions;
- a brief description of the expected impact; and
- a request for a secure channel where reproduction details can be shared.

Do not include credentials, account identifiers, QR codes, or private message
content. Repository administrators track confirmed reports in a draft security
advisory.

## Diagnostic privacy

INFO, WARN, and ERROR logs fully mask identifiers and tokens. Opt-in DEBUG logs
may show only a short redacted prefix. Logs never include message text, URL query
strings, QR URLs, or raw filesystem paths. Reports should include event names,
status codes, counts, and timings instead of sensitive values.

[advisory]: https://github.com/NewFuture/openclaw-weixin/security/advisories/new
