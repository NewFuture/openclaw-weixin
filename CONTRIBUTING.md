# Contributing

This repository is the community-maintained distribution of
[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin).
Contributions should preserve the `openclaw-weixin` plugin/channel id and its
existing config and state paths unless a separately planned breaking migration
is approved.

## Prerequisites

- Node.js 24.15.0
- npm

Use the Node.js version in `.nvmrc` for the recommended development
environment. The published package follows OpenClaw's supported Node.js ranges:
`>=22.22.3 <23`, `>=24.15.0 <25`, or `>=25.9.0`. CI validates the exact
Node.js 22.22.3 and 24.15.0 lower bounds.
The lockfile uses OpenClaw 2026.7.1 for normal development, while a dedicated
CI job builds and tests against the minimum supported host, OpenClaw 2026.6.1.

## Development

Install the exact dependency versions recorded in the lockfile:

```shell
npm ci
```

Use `npm ci` rather than `npm install` so the lockfile stays authoritative. When
a dependency change does require refreshing it, run `npm install` against the
public registry and confirm the diff only touches the intended packages.

Read [AGENTS.md](./AGENTS.md) for repository invariants and
[the architecture guide](./docs/architecture.md) for lifecycle and data flow.
These rules apply whether a change is written manually or with coding-agent
assistance.

Run one affected suite while iterating:

```shell
npm run test:unit -- src/path/to/file.test.ts
```

Run the fast type, style, and unit-test gate:

```shell
npm run check:fast
```

Run the same formatting, linting, type checking, coverage tests, and build used
by CI:

```shell
npm run check
```

Audit dependencies at the same severity used by CI and releases:

```shell
npm run audit:deps
```

This gate fails on `moderate` or higher advisories that this repository can fix,
and reports the remaining ones. OpenClaw publishes an `npm-shrinkwrap.json`, so
npm resolves everything under `node_modules/openclaw/` from that file: root
`overrides` and hand-edited `package-lock.json` entries do not change what
`npm ci` installs there, they only change what `npm audit` reads. Clear those
advisories by upgrading the `openclaw` devDependency once upstream ships a fix,
and re-run the audit in that pull request. Never pin a transitive OpenClaw
dependency to silence a report; `npm run check:lockfile` rejects overrides the
lockfile does not actually apply, along with tarballs resolved from a registry
mirror or recorded with a weaker-than-sha512 integrity.

Apply repository formatting with:

```shell
npm run format
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
- Update `README.md` and `README_EN.md` for user-facing documentation.
- Update both changelogs when a change affects users.
- Remove credentials, account identifiers, QR codes, and private message
  content from tests, logs, screenshots, and issue descriptions.
- Review and take responsibility for all submitted changes, including
  AI-assisted changes.
