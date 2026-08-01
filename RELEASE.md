# npm release process

`openclaw-weixin` publishes only to the official npm registry. Never commit an
npm token or add `NODE_AUTH_TOKEN` to the release workflow.

## Release prerequisites

1. Make the GitHub repository public so npm can verify the package provenance.
2. Confirm the target version is not already published to npm.
3. Confirm the protected GitHub environment `npm-publish` requires approval from
   a repository administrator.
4. Confirm the npm package has a GitHub Actions Trusted Publisher for owner
   `NewFuture`, repository `openclaw-weixin`, workflow `release.yml`, and
   environment `npm-publish`. The environment name is case-sensitive.
5. From the exact clean release commit, run `npm ci`, `npm run check:versions`,
   `npm run audit:deps`, `npm run check`, and `npm run pack:check`.
6. Confirm `package.json`, `package-lock.json`, `openclaw.plugin.json`,
   `CHANGELOG.md`, and `CHANGELOG_EN.md` use the same release version.
7. Merge release pull requests with a squash or merge commit. Rebase merge is
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
   example `v3.0.0`, and dispatches its npm release.

`.github/workflows/release.yml` verifies the tag, installs from the lockfile,
runs the dependency audit, type checking, tests, the build, and the
package-content check before requesting approval for the protected
`npm-publish` environment. After approval, a separate job rebuilds and
rechecks the package, then publishes `openclaw-weixin` with npm provenance over
GitHub OIDC. The OIDC permission is granted only to this approved publish job.

CI explicitly dispatches the workflow at its newly created tag because tags
created with `GITHUB_TOKEN` do not recursively trigger tag-push workflows. A
maintainer can rerun a failed release by manually dispatching `release.yml`
from the existing release tag; branch dispatches are rejected, and every
publish attempt requires environment approval. Every `main` push retains its
own run and reconciles the tag, npm registry, and release-run state, so an
interrupted tag or dispatch step is recoverable without moving an existing tag
or republishing a version. Only CI running on the first-parent commit that
introduced the version may create its missing tag. Later same-version runs can
reconcile an existing tag, but cannot invent one; after satisfying a blocked
prerequisite such as repository visibility, rerun the original release
commit's workflow. If npm already contains a version whose tag is missing,
automation fails instead of creating a tag that could misrepresent the
published artifact's source.
Consecutive releases wait for the preceding repository version to appear on
npm, and npm publication is globally serialized with a final check that the
new version is greater than the current `latest` version.
