---
name: openclaw-host-compatibility
description: Review, implement, or test openclaw-weixin changes involving OpenClaw SDK imports or exported subpaths, host APIs, plugin registration, entry points, peer or minimum host versions, build output, packaging, or compatibility claims.
---

# OpenClaw host compatibility

Use this playbook with `AGENTS.md` whenever a change crosses the plugin/host
boundary. A mocked unit test or a build against the lockfile SDK alone is not
evidence for another host version.

## Define the compatibility claim

List the exact versions the change claims to support:

- the lockfile development version;
- the declared minimum host version;
- any additional exact stable, beta, or prerelease version named by the task or
  PR.

Do not silently broaden the claim to untested versions. Routine compatibility
fixes do not bump package, lockfile, or plugin versions or create a dated release
section.

## Inspect the real SDK boundary

For every claimed version:

1. Inspect `node_modules/openclaw/package.json` exports and the installed `.d.ts`
   declarations.
2. Confirm the exact exported subpath, symbol name, signature, and return shape.
3. Check all production imports and callers of the changed symbol.
4. Keep NodeNext source imports on `.js` specifiers where required by this
   repository.

Do not infer compatibility from a similarly named subpath or an unchanged-looking
signature.

## Keep mocks honest

- Search for every mock of the old and new module specifier.
- Mock the exact specifier imported by production code.
- Assert the relevant symbol is exercised when the mock represents a compatibility
  seam.
- Keep a separate unmocked check; mocks prove local behavior, not package exports.

## Validate every claimed version without mocks

Use an isolated or disposable dependency installation so manifests and the
lockfile remain unchanged. For each exact claimed host version:

1. Install that exact OpenClaw version and assert the version actually present in
   `node_modules`.
2. Run type checking and build **after** installing the target version.
3. Start a fresh Node process with no Vitest mocks and import the compiled plugin
   entry point and any changed production module.
4. Register the plugin and verify the `openclaw-weixin` plugin/channel ID and
   expected registration count.
5. Exercise the smallest runtime boundary needed to prove the changed export can
   be called, without contacting the live Weixin backend.

Restore the lockfile dependency installation before the normal full validation.

## Packaging and documentation

- Run `npm run pack:check` when entry points, build output, package metadata,
  dependencies, or published files change.
- Keep the declared minimum host consistent across the `package.json`
  `peerDependencies` and `openclaw.install.minHostVersion` fields, bilingual
  READMEs, `CONTRIBUTING.md`, and CI.
- Update matching English and Chinese `Unreleased` notes for user-visible
  compatibility changes, but leave release versioning to the maintainer flow.
- State exact tested versions and commands in the PR; do not use total test count
  as compatibility evidence.

## Completion evidence

- Unit mocks match production import specifiers.
- Each claimed host version passes post-install type checking, build, fresh-process
  import, and registration smoke.
- No compatibility claim depends only on the current SDK, a mock, or a green
  unrelated CI job.
- The normal `npm run check` and applicable `npm run pack:check` pass afterward.
