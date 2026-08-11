# npmjs, GitHub Packages, GitHub Release, and ClawHub process

`openclaw-weixin` publishes the canonical package to the official npm registry,
publishes the matching ClawPack to the ClawHub listing `openclaw-wechat`, mirrors
the package to GitHub Packages as `@newfuture/openclaw-weixin`, and creates a
matching GitHub Release. The ClawPack's embedded plugin/channel id remains
`openclaw-weixin`. Never commit a registry token. npmjs and ClawHub publishing
share one protected GitHub OIDC job; the GitHub Packages job exposes only its
ephemeral `GITHUB_TOKEN` as `NODE_AUTH_TOKEN`.

## Release prerequisites

1. Make the GitHub repository public so npm can verify the package provenance.
2. For a new release, confirm the target version is not already published to
   npmjs, ClawHub, GitHub Packages, or as a GitHub Release. Recovery runs may
   reconcile missing destinations.
3. Confirm the protected GitHub environment `npm-publish` requires approval from
   a repository administrator and allows deployments only from tags that match
   `v*`.
4. Confirm a repository tag ruleset permits CI to create `v*` tags but blocks
   their update and deletion. The workflow also resolves the live remote tag
   immediately before every irreversible publication.
5. Confirm the npm package has a GitHub Actions Trusted Publisher for owner
   `NewFuture`, repository `openclaw-weixin`, workflow `release.yml`, and
   environment `npm-publish`. The environment name is case-sensitive.
6. Confirm the ClawHub package has a trusted publisher for repository
   `NewFuture/openclaw-weixin`, workflow `release.yml`, and environment
   `npm-publish`. Follow the post-merge migration below before the first unified
   release; do not change the npm trusted publisher.
7. Confirm the repository permits workflows to write GitHub Packages. The first
   `@newfuture/openclaw-weixin` publication is private by default; set its
   visibility in GitHub package settings if a public listing is desired. npm
   packages on GitHub require authentication even when public.
8. From the exact clean release commit, run `npm ci`, `npm run check:versions`,
   `npm run audit:deps`, `npm run check`, and `npm run pack:check`.
9. Confirm `package.json`, `package-lock.json`, `openclaw.plugin.json`,
   `CHANGELOG.md`, and `CHANGELOG_EN.md` use the same release version.
10. Merge release pull requests with a squash or merge commit. Rebase merge is
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

`.github/workflows/release.yml` verifies the exact tag and release-transition
commit, installs from the lockfile, runs the dependency audit, type checking,
tests, build, package-content check, ClawPack structural conversion, ClawHub
validation, and credential-free publish dry-run. It then checks npmjs and
ClawHub independently. An existing ClawHub version is accepted only when its
package, owner, source repository, source commit, source tag, and embedded
plugin/channel identity match the release exactly.

If either registry target is missing, one job requests approval for the
protected `npm-publish` environment. It rebuilds and revalidates both artifacts,
rechecks both registries after approval, publishes npmjs and ClawHub as separate
sequential steps, waits for a definitive ClawHub result, and verifies both exact
versions again. This is the only release job with `id-token: write`. A
least-privilege GitHub Packages job then packs the same validated source tree,
changes only its package name, install spec, and registry metadata, and
publishes `@newfuture/openclaw-weixin` with the repository's `GITHUB_TOKEN`.
Another least-privilege job creates the matching GitHub Release with notes
rendered from the versioned Chinese and English changelog sections. OIDC,
GitHub Packages write, and GitHub contents write permissions remain isolated to
their respective jobs.

| npmjs target | ClawHub target | Protected-job behavior |
| --- | --- | --- |
| Missing | Missing | Approve once, publish npmjs, then publish ClawHub |
| Exact version exists | Missing | Approve once, skip npmjs, publish ClawHub |
| Missing | Exact matching version exists | Approve once, publish npmjs, skip ClawHub |
| Exact version exists | Exact matching version exists | Skip approval and continue recovery jobs |
| Either state | ClawHub missing with prior publication boundary | Recover npmjs if needed, then stop before a duplicate ClawHub request |
| Either state | Version exists with mismatched source or runtime identity | Fail; never treat it as recovery success |

CI explicitly dispatches the workflow at its newly created tag because tags
created with `GITHUB_TOKEN` do not recursively trigger tag-push workflows. A
maintainer can rerun a failed release by manually dispatching `release.yml`
from the existing release tag; branch dispatches are rejected, and every
new npmjs publish attempt requires environment approval. Each package registry
is checked independently. Before ClawHub publication can start, the workflow
persists a tag-and-commit-specific boundary artifact. If ClawHub remains absent,
and the 90-day artifact has expired, the matching durable check run still makes
later runs fail closed instead of submitting a duplicate. An existing exact
version is still skipped while a missing npmjs version, GitHub Packages mirror,
or GitHub Release is reconciled without republishing.
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
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Post-merge trusted-publisher migration

The unified workflow and external trust configuration must change in this order.
Do not mutate either trusted publisher from an unmerged branch:

1. Merge the reviewed workflow to `main`. Until it is present on `main`, keep
   ClawHub bound to `clawhub-publish.yml` and `clawhub-publish`; do not start
   another release.
2. Add the deployment tag policy `v*` to the existing `npm-publish` environment
   while retaining its required reviewer. This protects both OIDC issuers from
   branch dispatches.
3. Add or verify a repository tag ruleset that allows the CI coordinator to
   create `v*` tags but denies updates and deletions. This makes the exact source
   ref immutable across approval and publication.
4. Reconfirm that npm remains bound to `release.yml` and `npm-publish`. Do not
   replace or otherwise edit the npm trusted publisher.
5. Rebind the ClawHub package only after steps 1-4:

   ```shell
   npx --yes clawhub@0.23.3 package trusted-publisher set openclaw-wechat \
     --repository NewFuture/openclaw-weixin \
     --workflow-filename release.yml \
     --environment npm-publish
   npx --yes clawhub@0.23.3 package trusted-publisher get openclaw-wechat --json
   ```

6. Verify that the saved ClawHub repository, workflow filename, and environment
   match exactly before starting the next coordinated release. The `set` command
   replaces the old ClawHub binding; the old environment is deliberately kept
   as a recovery reference at this stage.
7. Run the next release only through the CI-created exact tag and explicit
   `release.yml` dispatch. Approve `npm-publish` once and verify npmjs, ClawHub,
   GitHub Packages, the GitHub Release, and the sanitized workflow reports.
8. Retire the now-unused `clawhub-publish` environment only after a successful
   unified release. It no longer grants workflow authority after step 5, but
   keeping it until verification avoids destroying the previous protection
   record prematurely.

Never add a long-lived `CLAWHUB_TOKEN` secret. The standalone
`.github/workflows/clawhub-publish.yml` remains only for credential-free pull
request ClawPack validation and dry-run; it has no production dispatch or OIDC
authority.

## Trusted ClawHub release recovery

The coordinated workflow waits for a definitive ClawHub publication result and
uploads sanitized inspector and JSON reports. If npmjs succeeds but ClawHub
fails before the durable publication boundary is created, rerun `release.yml`
from the same exact tag: after the single approval, the target recheck skips
npmjs and retries ClawHub. The reverse partial state is handled symmetrically.
If both exact targets already match, the protected job is skipped while GitHub
Packages and GitHub Release recovery continues.

ClawHub CLI 0.23.3 has no supported standalone attempt status or resume command.
Its authenticated attempt endpoint is an internal implementation detail, and
submitting the same package version while an attempt is active is rejected
rather than treated as an idempotent resume. Therefore the workflow creates a
durable GitHub check run and uploads a 90-day
`clawhub-publication-boundary-v<version>-<commit>` artifact immediately before
the only real publish command. The check is completed successfully only after
the exact public version and source/runtime identity are verified. Validation,
build, dry-run, registry lookup, tag verification, npmjs publication, and npmjs
verification all happen before that boundary and can be retried safely. A
failure after the check is created is an unknown ClawHub outcome even if the
command may not have reached the server; automation must not infer safety from
an absent public version.

If a run fails, first inspect the package and version history:

```shell
npx --yes clawhub@0.23.3 package inspect openclaw-wechat --versions --json
npx --yes clawhub@0.23.3 package moderation-status openclaw-wechat --json
npx --yes clawhub@0.23.3 package readiness openclaw-wechat --json
```

If the target version is absent and no publication-boundary check or artifact
exists, the failure occurred before the irreversible command boundary and the
exact tag can be rerun. If the boundary exists, inspect its originating run and
sanitized reports for an attempt ID or terminal status, then obtain authoritative
ClawHub confirmation that no active or accepted attempt exists. Only after that
confirmation may a maintainer complete that one check run with the `neutral`
conclusion and remove its matching artifact before rerunning the exact tag. The
check remains after artifact retention expires, so expiry alone never authorizes
a retry. If the version appears with the expected identity, rerun the workflow
and it will skip ClawHub. If a version exists with different source metadata or
embedded runtime identity, automation fails instead of claiming success; do not
republish or rewrite that version. Resolve a rejected artifact in a new release.

After authoritative confirmation, clear only the matching boundary (substitute
the exact version, commit, check-run ID, and artifact ID reported by the failed
workflow):

```shell
boundary=clawhub-publication-boundary-v<version>-<commit>
gh api "repos/NewFuture/openclaw-weixin/commits/<commit>/check-runs" \
  -f check_name="$boundary" -f filter=all
gh api --method PATCH \
  "repos/NewFuture/openclaw-weixin/check-runs/<check-run-id>" \
  -f status=completed -f conclusion=neutral \
  -f completed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
gh api --method DELETE \
  "repos/NewFuture/openclaw-weixin/actions/artifacts/<artifact-id>"
```

Do not clear a check created for another version or commit.
Once the public package is ready, install it in an isolated OpenClaw state,
confirm `openclaw plugins list` still reports the `openclaw-weixin`
plugin/channel id, and inspect the listing's source commit, icon, summary,
compatibility, and scan status.
