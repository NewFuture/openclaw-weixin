# npmjs, GitHub Packages, and GitHub Release process

`openclaw-weixin` publishes the canonical package to the official npm registry,
mirrors it to GitHub Packages as `@newfuture/openclaw-weixin`, and creates a
matching GitHub Release. Never commit a registry token. npmjs uses GitHub OIDC;
the GitHub Packages job exposes only its ephemeral `GITHUB_TOKEN` as
`NODE_AUTH_TOKEN`.

## Release prerequisites

1. Make the GitHub repository public so npm can verify the package provenance.
2. For a new release, confirm the target version is not already published to
   npmjs, GitHub Packages, or as a GitHub Release. Recovery runs may reconcile
   missing destinations.
3. Confirm the protected GitHub environment `npm-publish` requires approval from
   a repository administrator.
4. Confirm the npm package has a GitHub Actions Trusted Publisher for owner
   `NewFuture`, repository `openclaw-weixin`, workflow `release.yml`, and
   environment `npm-publish`. The environment name is case-sensitive.
5. Confirm the repository permits workflows to write GitHub Packages. The first
   `@newfuture/openclaw-weixin` publication is private by default; set its
   visibility in GitHub package settings if a public listing is desired. npm
   packages on GitHub require authentication even when public.
6. From the exact clean release commit, run `npm ci`, `npm run check:versions`,
   `npm run audit:deps`, `npm run check`, and `npm run pack:check`.
7. Confirm `package.json`, `package-lock.json`, `openclaw.plugin.json`,
   `CHANGELOG.md`, and `CHANGELOG_EN.md` use the same release version.
8. Merge release pull requests with a squash or merge commit. Rebase merge is
   rejected because its intermediate version-bump commit is not the final tree
   validated on `main`.

## Trusted releases

After Trusted Publishing is configured:

1. Update `package.json`, both version fields in `package-lock.json`, and
   `openclaw.plugin.json`, then move both changelogs' unreleased entries into the
   same dated release section. Chinese remains the default in `CHANGELOG.md`;
   English is maintained in `CHANGELOG_EN.md`.
2. Open a pull request. CI rejects mismatched metadata, missing bilingual
   changelog releases, unstable versions, and version downgrades.
3. Squash-merge or merge the clean release commit. After every required Linux
   and Windows check passes on `main`, CI creates the missing matching tag, for
   example `v3.0.0`, and dispatches its coordinated release.

`.github/workflows/release.yml` verifies the tag, installs from the lockfile,
runs the dependency audit, type checking, tests, the build, and the
package-content check before requesting approval for the protected
`npm-publish` environment. After approval, a separate job rebuilds and
rechecks the package, then publishes `openclaw-weixin` with npm provenance over
GitHub OIDC. A least-privilege GitHub Packages job then packs the same validated
source tree, changes only its package name, install spec, and registry metadata,
and publishes `@newfuture/openclaw-weixin` with the repository's `GITHUB_TOKEN`.
Once both registries contain the version, another
least-privilege job creates the matching GitHub Release with notes rendered
from the versioned Chinese and English changelog sections. OIDC permission,
GitHub Packages write permission, and GitHub contents write permission are
isolated to their respective jobs.

CI explicitly dispatches the workflow at its newly created tag because tags
created with `GITHUB_TOKEN` do not recursively trigger tag-push workflows. A
maintainer can rerun a failed release by manually dispatching `release.yml`
from the existing release tag; branch dispatches are rejected, and every
new npmjs publish attempt requires environment approval. Each package registry
is checked independently, so an existing version is skipped while a missing
GitHub Packages mirror or GitHub Release is reconciled without republishing.
Before npmjs publication, later `main` pushes can reconcile an interrupted tag
or workflow dispatch. Once npmjs contains the version, the `main` coordinator
considers that release dispatched; failures in the downstream GitHub Packages
or GitHub Release jobs must be recovered by rerunning `release.yml` from the
existing tag. Only CI running on the first-parent commit that introduced the
version may create its missing tag. Later same-version runs can reconcile an
existing tag, but cannot invent one; after satisfying a blocked prerequisite
such as repository visibility, rerun the original release commit's workflow.
If npmjs already contains a version whose tag is missing, automation fails
instead of creating a tag that could misrepresent the published artifact's
source.
Consecutive releases wait for the preceding repository version to appear on
npmjs. The GitHub Packages mirror must contain the immediately preceding
repository release as `latest` before the next mirror version can publish. If
the mirror is empty, backfill the preceding release before publishing a later
mirror version.
