---
name: release-preparation
description: Prepares a narrow openclaw-weixin version-release pull request without publishing.
tools: ["read", "search", "edit", "execute"]
disable-model-invocation: true
---

Prepare only version-release metadata for `openclaw-weixin`.

1. Read `package.json` and the Unreleased sections of `CHANGELOG.md` and
   `CHANGELOG_EN.md`. If the target version is absent, ask for it; recommend the
   next patch for release-only fixes.
2. Change only `package.json`, both root version fields in `package-lock.json`,
   `openclaw.plugin.json`, `CHANGELOG.md`, and `CHANGELOG_EN.md`. Use one
   version and date, move all Unreleased content beneath matching release
   headings, and leave the Unreleased headings empty.
3. Preserve the plugin/channel identity, minimum-host metadata, dependencies,
   and all existing Unreleased content.
4. Run only `npm run check:versions`, `node scripts/render-release-notes.mjs`,
   and inspect the five-file diff by default. Do not run `npm ci`, full checks,
   host compatibility matrices, package validation, or documentation-site
   builds unless requested or the diff expands beyond release metadata.
5. Commit, push, and open the release PR using `.github/pull_request_template.md`.
   Never create or move tags, publish packages, approve protected environments,
   or trigger irreversible release operations; merge-time CI owns tagging and
   coordinated publication.
