# npmjs, GitHub Packages, GitHub Release, and ClawHub process

`openclaw-weixin` publishes the canonical package to the official npm registry,
mirrors it to GitHub Packages as `@newfuture/openclaw-weixin`, and creates a
matching GitHub Release. A separate ClawPack is prepared for the future ClawHub
listing `openclaw-wechat`; its embedded plugin/channel id remains
`openclaw-weixin`. Never commit a registry token. npmjs and post-bootstrap
ClawHub publishing use GitHub OIDC; the GitHub Packages job exposes only its
ephemeral `GITHUB_TOKEN` as `NODE_AUTH_TOKEN`.

## Release prerequisites

1. Make the GitHub repository public so npm can verify the package provenance.
2. For a new release, confirm the target version is not already published to
   npmjs, GitHub Packages, or as a GitHub Release. Recovery runs may reconcile
   missing destinations.
3. Confirm the protected GitHub environment `npm-publish` requires approval from
   a repository administrator.
4. Confirm the protected GitHub environment `clawhub-publish` requires approval
   from a repository administrator and allows deployments only from tags that
   match `v*`.
5. Confirm the npm package has a GitHub Actions Trusted Publisher for owner
   `NewFuture`, repository `openclaw-weixin`, workflow `release.yml`, and
   environment `npm-publish`. The environment name is case-sensitive.
6. Confirm the repository permits workflows to write GitHub Packages. The first
   `@newfuture/openclaw-weixin` publication is private by default; set its
   visibility in GitHub package settings if a public listing is desired. npm
   packages on GitHub require authentication even when public.
7. From the exact clean release commit, run `npm ci`, `npm run check:versions`,
   `npm run audit:deps`, `npm run check`, and `npm run pack:check`.
8. Confirm `package.json`, `package-lock.json`, `openclaw.plugin.json`,
   `CHANGELOG.md`, and `CHANGELOG_EN.md` use the same release version.
9. Merge release pull requests with a squash or merge commit. Rebase merge is
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

## ClawHub package identity

ClawHub distribution is intentionally separate from npm identity:

| Surface | Identity |
| --- | --- |
| Canonical npm package | `openclaw-weixin` |
| GitHub Packages mirror | `@newfuture/openclaw-weixin` |
| ClawHub package | `openclaw-wechat` |
| Plugin and channel id | `openclaw-weixin` |
| ClawHub publisher | `newfuture` |

`scripts/prepare-clawhub-package.mjs` accepts a directory containing exactly one
canonical npm tarball (or the tarball path itself). It validates the canonical
name, npm fallback, entry points, host metadata, manifest version, and
plugin/channel identity. In a temporary extracted copy it changes only
`package.json.name`, adds `clawhub:openclaw-wechat`, and selects ClawHub as that
copy's default installer. It never modifies the source tarball or creates an
`openclaw-wechat` npm package.

Before any ClawHub release, run `npm ci`, `npm run check`, and
`npm run pack:check`, then build and validate the ClawPack with the commands in
[CONTRIBUTING.md](./CONTRIBUTING.md). Do not reuse any existing release tag,
including `v3.0.2` or `v3.1.0`: the first ClawHub version must come from a later
release tag that contains this publishing support.

## First ClawHub publication

The first publication is a one-time authenticated bootstrap because GitHub OIDC
cannot publish a package until that package has a trusted publisher:

1. Reconfirm that `openclaw-wechat` is unclaimed. If it belongs to another
   publisher, stop rather than overriding or republishing it.
2. Log in locally with `npx --yes clawhub@0.23.3 login`. Create the publisher
   once, if needed:

   ```shell
   npx --yes clawhub@0.23.3 publisher create newfuture \
     --display-name NewFuture --json
   ```

3. Check out the next clean release tag, generate the canonical npm tarball and
   its ClawPack, and repeat validation plus dry-run against that exact commit.
4. Publish the ClawPack, supplying the real tag and commit:

   ```shell
   npx --yes clawhub@0.23.3 package publish \
     <clawpack-path>/openclaw-wechat-<version>.tgz \
     --family code-plugin --owner newfuture --display-name WeChat \
     --categories channels --topics wechat,weixin,messaging \
     --source-repo NewFuture/openclaw-weixin \
     --source-commit <release-commit-sha> --source-ref refs/tags/v<version> \
     --wait --wait-timeout 2400 --json
   ```

5. After ClawHub has created the package, bind its trusted publisher and inspect
   the saved configuration:

   ```shell
   npx --yes clawhub@0.23.3 package trusted-publisher set openclaw-wechat \
     --repository NewFuture/openclaw-weixin \
     --workflow-filename clawhub-publish.yml \
     --environment clawhub-publish
   npx --yes clawhub@0.23.3 package trusted-publisher get openclaw-wechat --json
   ```

Configure and protect the `clawhub-publish` environment before saving this
trusted publisher. Without the environment binding, a workflow modified on
another ref could request a publish token. Do not add a long-lived
`CLAWHUB_TOKEN` GitHub secret. Categories and topics are set during bootstrap;
later publishes preserve them.

## Trusted ClawHub releases and recovery

`.github/workflows/clawhub-publish.yml` runs a credential-free ClawHub dry-run
for pull requests. A real publish runs only through `workflow_dispatch` from the
matching `v<package-version>` release tag. The prepare job repeats the full
project and package checks, uploads the generated ClawPack, and has read-only
repository access. Only the publish job protected by the `clawhub-publish`
environment receives `id-token: write`.

After the normal coordinated release has completed, select the exact tag in the
GitHub Actions **ClawHub Publish** workflow or run:

```shell
gh workflow run clawhub-publish.yml --ref v<version>
```

The workflow waits for a definitive publication result and uploads its inspector
and JSON reports. If a run fails, first inspect the package and version history:

```shell
npx --yes clawhub@0.23.3 package inspect openclaw-wechat --versions --json
npx --yes clawhub@0.23.3 package moderation-status openclaw-wechat --json
npx --yes clawhub@0.23.3 package readiness openclaw-wechat --json
```

If the target version was not created, rerun the workflow from the same tag. If
it exists or is still being scanned, do not republish or rewrite that version;
resolve a rejected artifact in a new release. Once the public package is ready,
install it in an isolated OpenClaw state, confirm `openclaw plugins list` still
reports the `openclaw-weixin` plugin/channel id, and inspect the listing's source
commit, icon, summary, compatibility, and scan status. Only then change the
bilingual README installation path from npm-first to ClawHub-first.
