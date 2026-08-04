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

Audit the production dependencies shipped with the plugin at the same severity
used by CI and releases. Development tools and the host-provided OpenClaw peer
dependency are omitted:

```shell
npm run audit:deps
```

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

Build the documentation website into `docs/site/dist/` (the same command GitHub
Pages runs) after editing Markdown documents or the files in `docs/site/`. The
site is a [VitePress](https://vitepress.dev/) project that keeps its own
dependencies so that the published package manifest stays untouched, and its
tests run with Node.js instead of the root Vitest project:

```shell
npm ci --prefix docs/site
npm test --prefix docs/site
npm run build --prefix docs/site
```

Preview the site with hot reload using `npm run dev --prefix docs/site`, or serve
`docs/site/dist/` with any static file server. Both commands first copy the
repository Markdown into `docs/site/content/`, so always edit the original
documents. The generated `content/` and `dist/` directories are ignored by Git;
only the sources in `docs/site/` are committed.

Simplified Chinese is the site's default locale and is published at the site
root; English is published under `/en/`. A document without a translation is
still published in every locale, carrying the Markdown it does have plus an
untranslated notice, so register new pages in `docs/site/.vitepress/docs.mjs`
with whichever locale sources exist.

## Pull requests

- Keep changes focused and include tests for behavior changes.
- Update `README.md` and `README_EN.md` for user-facing documentation.
- Update both changelogs when a change affects users.
- Remove credentials, account identifiers, QR codes, and private message
  content from tests, logs, screenshots, and issue descriptions.
- Review and take responsibility for all submitted changes, including
  AI-assisted changes.
