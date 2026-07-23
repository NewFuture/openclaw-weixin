# Contributing

This repository is the community-maintained distribution of
[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin).
Contributions should preserve the `openclaw-weixin` plugin/channel id and its
existing config and state paths unless a separately planned breaking migration
is approved.

## Prerequisites

- Node.js 24 or newer
- npm

Use the Node.js version in `.nvmrc` for the recommended development
environment. The published package remains compatible with Node.js 22, and CI
validates both Node.js 22 and 24.

## Development

Install the exact dependency versions recorded in the lockfile:

```shell
npm ci
```

Run the same type checking, coverage tests, and build used by CI:

```shell
npm run check
```

Inspect the npm package contents when changing entry points, build output, or
package metadata:

```shell
npm pack --dry-run --ignore-scripts
```

The repository's stricter package contract check is:

```shell
npm run pack:check
```

## Pull requests

- Keep changes focused and include tests for behavior changes.
- Update `README.md` and `README.zh_CN.md` for user-facing documentation.
- Update both changelogs when a change affects users.
- Remove credentials, account identifiers, QR codes, and private message
  content from tests, logs, screenshots, and issue descriptions.
