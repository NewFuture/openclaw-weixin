---
name: release-preparation
description: Prepare a narrow openclaw-weixin version release pull request without publishing or changing release automation.
---

# Release preparation

Use this playbook only to prepare a version-release pull request. Do not expand
the scope into compatibility, packaging, documentation-site, or publication
work unless the user explicitly requests it.

## Determine the release

1. Read the current version in `package.json` and the `Unreleased` sections in
   `CHANGELOG.md` and `CHANGELOG_EN.md`.
2. If the target version is explicit, use it. Otherwise ask for it; for
   release-only fixes, recommend the next patch version.
3. Preserve every Unreleased entry. Do not add a changelog entry unless
   repository policy specifically requires one for this developer tooling.

## Change only release metadata

Use one identical version and date in exactly these five files:

- `package.json`
- `package-lock.json`: the top-level `version` and `packages[""].version`
- `openclaw.plugin.json`
- `CHANGELOG.md`
- `CHANGELOG_EN.md`

Move each changelog's existing Unreleased content beneath its matching dated
release heading, leaving an empty Unreleased heading in each file. Do not
change the plugin/channel identity, minimum-host metadata, dependency
versions, or unrelated content.

## Validate and hand off

By default, run only:

```shell
npm run check:versions
node scripts/render-release-notes.mjs
git diff -- package.json package-lock.json openclaw.plugin.json CHANGELOG.md CHANGELOG_EN.md
```

Do not run `npm ci`, `npm run check`, host compatibility matrices,
`npm run pack:check`, or documentation-site builds for a metadata-only release.
Run broader checks only when explicitly requested or when the actual diff
extends beyond release metadata.

Commit the prepared changes, push the branch, and open a release pull request
using `.github/pull_request_template.md`. Never create or move tags, publish
packages, approve protected environments, or trigger any irreversible release
operation. Merge-time CI owns tagging and coordinated publication.
