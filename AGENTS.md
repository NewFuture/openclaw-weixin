# Coding Agent Guide

This repository publishes the community-maintained `openclaw-weixin` channel
plugin. Keep changes small, preserve compatibility, and use tests as the behavior
contract.

## Start here

1. Read [the architecture guide](docs/architecture.md) for lifecycle and data flow.
2. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and validation commands.
3. Read the relevant implementation and colocated tests before editing.
4. Use synthetic identifiers and credentials in every test and example.

## Module map

| Area | Entry points |
| --- | --- |
| Plugin registration and channel contract | `index.ts`, `src/channel.ts` |
| Login, accounts, and pairing | `src/auth/` |
| Backend protocol and request lifecycle | `src/api/` |
| Long polling and dispatch scheduling | `src/monitor/monitor.ts` |
| Inbound and outbound messages | `src/messaging/` |
| Media download, encryption, and upload | `src/media/`, `src/cdn/` |
| Persistent state | `src/storage/`, `src/auth/accounts.ts` |
| Documentation website | `docs/site/` |

## Non-negotiable contracts

- The npm package, plugin, and channel ID is `openclaw-weixin`. Do not change the
  ID or `~/.openclaw/openclaw-weixin/` state paths without an approved migration.
- Keep the published package compatible with Node.js 22. CI also validates the
  recommended Node.js 24 development environment.
- This is a NodeNext ESM project. TypeScript imports use `.js` specifiers.
- Tokens, context tokens, account IDs, QR codes, message bodies, and CDN query
  parameters are sensitive. Never add real values to source, fixtures, logs,
  issues, screenshots, or examples. Route diagnostic output through the existing
  redaction helpers.
- Account state and context tokens are account-scoped. Do not introduce a global
  fallback that can send from the wrong account.
- Stop and hot-reload must abort an in-flight long poll. Polling must continue
  while accepted turns run, and plugin approval messages must retain their
  independent scheduling lane.
- Preserve legacy account IDs, credential files, and sync-buffer migrations unless
  the change explicitly owns a tested migration.
- `dist/`, `coverage/`, and `docs/site/dist/` are generated. Do not hand-edit or
  commit them.
- User-facing behavior changes require matching English and Chinese README or
  changelog updates.

## Validation ladder

Install exactly what the lockfile records:

```shell
npm ci
```

Run one affected suite while iterating:

```shell
npm run test:unit -- src/path/to/file.test.ts
```

Run the fast local gate:

```shell
npm run check:fast
```

Run the full CI-equivalent gate before finishing:

```shell
npm run check
```

When entry points, build output, package metadata, or dependencies change, also
run:

```shell
npm run pack:check
```

When Markdown documents or the website sources change, rebuild the site. It has
its own dependencies so that the published package manifest stays untouched:

```shell
npm ci --prefix docs/site
npm run build --prefix docs/site
```

Use `npm run format` for mechanical formatting. Do not mix broad formatting with
behavioral changes when the work can be separated.

## Testing rules

- Add or update a regression test for every behavior change.
- Tests must not call the live Weixin backend, perform QR login, or depend on a
  developer's OpenClaw state.
- Prefer builders from `test/helpers/` and sanitized data from `test/fixtures/`.
  Keep test-only support outside `src/` so it cannot enter the npm package.
- Keep tests safe under Vitest's default parallelism. Restore environment
  variables, timers, globals, mocks, and temporary directories.
- Prefer fake timers and explicit deferred promises over sleeps.
- Assert observable boundary behavior instead of private implementation details.

## Definition of done

- The focused test demonstrates the requested behavior or original regression.
- `npm run check` passes without warnings or generated-file drift.
- `npm run pack:check` passes when packaging surfaces changed.
- Compatibility, privacy, state migration, and multi-account behavior have been
  considered explicitly.
- Related developer and bilingual user documentation is updated.
