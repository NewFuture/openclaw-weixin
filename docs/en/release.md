# npmjs, GitHub Packages, GitHub Release, and ClawHub process

[简体中文](../zh-CN/release.md)

`openclaw-weixin` publishes the canonical package to the official npm registry,
publishes the matching ClawPack to the ClawHub listing `openclaw-wechat`, mirrors
the package to GitHub Packages as `@newfuture/openclaw-weixin`, and creates a
matching GitHub Release. The ClawPack's embedded plugin/channel id remains
`openclaw-weixin`. Never commit a registry token. npmjs and ClawHub publishing
use separate protected GitHub OIDC jobs and environments; the GitHub Packages
job exposes only its ephemeral `GITHUB_TOKEN` as `NODE_AUTH_TOKEN`.

## Release prerequisites

1. Make the GitHub repository public so npm can verify the package provenance.
2. For a new release, confirm the target version is not already published to
   npmjs, ClawHub, GitHub Packages, or as a GitHub Release. Recovery runs may
   reconcile missing destinations.
3. Confirm the protected GitHub environments `npm-publish` and
   `clawhub-publish` each require approval from repository administrator
   `NewFuture` and allow deployments only from tags that match `v*`. Retain both
   environments permanently so their trust and deployment histories remain
   isolated.
4. Confirm a repository tag ruleset permits CI to create `v*` tags but blocks
   their update and deletion. The workflow also resolves the live remote tag
   immediately before every irreversible publication.
5. Confirm the npm package has a GitHub Actions Trusted Publisher for owner
   `NewFuture`, repository `openclaw-weixin`, workflow `release.yml`, and
   environment `npm-publish`. The environment name is case-sensitive.
6. Until the split workflow has merged, keep the ClawHub package trusted
   publisher on repository `NewFuture/openclaw-weixin`, workflow `release.yml`,
   and environment `npm-publish`. After merge, follow the migration below to
   change only its environment to `clawhub-publish`; do not change the npm
   trusted publisher.
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

The `npm-publish`, `clawhub-publish`, and `github-package` jobs all depend
directly on the shared validation job, so the three package targets can proceed
concurrently. Missing npmjs and ClawHub targets request their respective
protected environments. When both are missing, wait until both appear in
**Review deployments**, select both environments, and click **Approve and
deploy** once. GitHub applies that one UI action to both jobs, while each job
receives only its own environment and OIDC trust boundary. If only one target is
missing, approve only that environment. If both exact targets exist, neither
environment requests approval. The GitHub Packages job uses the repository's
`GITHUB_TOKEN` and performs its own exact-version precheck. A missing intermediate
mirror version is reported but does not block the exact current target.

Before an irreversible command, each package job verifies the live tag and
rechecks its own target. GitHub Packages also rereads `latest` at that boundary
so another publication during the build cannot make this release move the
dist-tag backward. The npmjs and GitHub Packages jobs treat a successful `npm
publish` response as completion instead of immediately querying a registry that
may still be propagating the new version. The ClawHub job waits for its publish
response and requires `publicationStatus` to be `published`. ClawHub stores its
uploaded ClawPack, and the package's default `clawhub:` installer downloads that
artifact directly. The npmjs and ClawHub jobs are the only jobs with `id-token:
write`.

After all three package jobs succeed or correctly skip an existing target, a
least-privilege job creates the matching GitHub Release with notes rendered from
the versioned Chinese and English changelog sections. OIDC, GitHub Packages
write, and GitHub contents write permissions remain isolated to their respective
jobs.

| npmjs target | ClawHub target | Protected-job behavior |
| --- | --- | --- |
| Missing | Missing | Wait for both environments, select both, approve once; npmjs, ClawHub, and GitHub Packages proceed independently |
| Exact version exists | Missing | Only `clawhub-publish` requests approval; GitHub Packages proceeds independently |
| Missing | Exact matching version exists | Only `npm-publish` requests approval; GitHub Packages proceeds independently |
| Exact version exists | Exact matching version exists | Neither environment requests approval; GitHub Packages is checked before finalizing GitHub Release |
| Either state | ClawHub missing with prior publication boundary | npmjs and GitHub Packages may complete independently, but stop before a duplicate ClawHub request and do not finalize GitHub Release |
| Either state | Version exists with mismatched source or runtime identity | Fail; never treat it as recovery success |

CI explicitly dispatches the workflow at its newly created tag because tags
created with `GITHUB_TOKEN` do not recursively trigger tag-push workflows. A
maintainer recovers a failed release by re-running that original workflow run;
branch dispatches are rejected, and every new protected-registry publish attempt
requires its own environment approval. Each package target is checked
independently before its publish command.
Before ClawHub publication can start, the workflow persists both a durable
tag-and-commit-specific check run and a 90-day boundary artifact. If ClawHub
remains absent, either marker makes automation fail closed instead of
submitting a duplicate. The check run remains after artifact expiry. An
existing exact package version is skipped while missing package targets proceed
independently; GitHub Release runs only after all three package jobs complete.
Before npmjs publication, later `main` pushes can reconcile an interrupted tag
or workflow dispatch. Once npmjs contains the version, the `main` coordinator
considers that release dispatched; failures in ClawHub, GitHub Packages, or the
final GitHub Release job must be recovered by rerunning `release.yml` from the
existing tag. Only CI running on the first-parent commit that introduced the
version may create its missing tag. Later same-version runs can reconcile an
existing tag, but cannot invent one; after satisfying a blocked prerequisite
such as repository visibility, rerun the original release commit's workflow.
If npmjs already contains a version whose tag is missing, automation fails
instead of creating a tag that could misrepresent the published artifact's
source.
npmjs and GitHub Packages may skip an unpublished intermediate repository
version. Before creating a new immutable tag, the `main` coordinator checks the
exact npmjs target, requires a public repository for provenance, then reads
`latest` and requires it to be lower than the proposed version. It does not wait
for the immediately preceding repository version. GitHub Packages likewise
reports the current mirror state and permits a missing exact current target when
`latest` is lower or the mirror is empty. Exact-target lookups remain fail-closed
for errors other than a not-found response. GitHub Packages rechecks both the
exact target and `latest` immediately before publication to close exact-version
and dist-tag build-time races. A missing target older than the registry's
current `latest` fails rather than moving that dist-tag backward.

Never move or reuse an immutable skipped tag to fill a registry gap. Prepare a
separate version release instead.

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
plugin/channel identity. It also requires one adjacent npm and ClawHub install
block in each localized README, with the matching exact command and no relative
registry link. In a temporary extracted copy it changes
`package.json.name`, adds `clawhub:openclaw-wechat`, selects ClawHub as that
copy's default installer, uses the English source for its primary `README.md`
and `README_EN.md`, writes the full Chinese source to `README.zh_CN.md`, changes
all staged README titles to `openclaw-wechat`, and preserves each localized
prompt. The Chinese prompt tries npm before ClawHub, while the English prompt
tries ClawHub before npm, aligning each package's primary README with its default
source. The converter then reorders the direct-source blocks from npm-first to
ClawHub-first.
It never modifies the source tarball or creates an `openclaw-wechat` npm package.

Before any ClawHub release, run `npm ci`, `npm run check`, and
`npm run pack:check`, then build and validate the ClawPack with the commands in
[CONTRIBUTING.md](../CONTRIBUTING.md). Never reuse or overwrite an existing
ClawHub version. Each new ClawHub version must come from the matching new
canonical npm/GitHub release tag.

## Post-merge trusted-publisher migration

The workflow and external trust configuration must change in this order. Do
not mutate either trusted publisher from an unmerged branch:

1. Until the reviewed split workflow is present on `main`, keep ClawHub bound to
   `release.yml` and `npm-publish`; do not start another release.
2. Merge the reviewed workflow to `main`.
3. Verify that both `npm-publish` and `clawhub-publish` still require reviewer
   `NewFuture`, allow only `v*` tags, and remain separate environments. Verify
   the active `refs/tags/v*` ruleset still blocks tag update and deletion.
4. Reconfirm that npm remains bound to `release.yml` and `npm-publish`. Do not
   replace or otherwise edit the npm trusted publisher.
5. Rebind only the ClawHub package after steps 1-4:

   ```shell
   npx --yes clawhub@0.23.3 package trusted-publisher set openclaw-wechat \
     --repository NewFuture/openclaw-weixin \
     --workflow-filename release.yml \
     --environment clawhub-publish
   npx --yes clawhub@0.23.3 package trusted-publisher get openclaw-wechat --json
   ```

6. Verify that npm is still bound to `release.yml` plus `npm-publish`, and that
   the saved ClawHub repository, workflow filename, and environment are exactly
   `NewFuture/openclaw-weixin`, `release.yml`, and `clawhub-publish`.
7. Run the next release only through the CI-created exact tag and explicit
   `release.yml` dispatch. If both registry targets are missing, wait until both
   environments are Pending, select both, and click **Approve and deploy** once.
   Verify npmjs, ClawHub, GitHub Packages, the GitHub Release, and the sanitized
   workflow reports.
8. Retain both protected environments permanently. Do not merge, rename, or
   delete either environment after migration.

Never add a long-lived `CLAWHUB_TOKEN` secret. The standalone
`.github/workflows/clawhub-publish.yml` remains only for credential-free pull
request ClawPack validation and dry-run; it has no production dispatch or OIDC
authority.

## Trusted ClawHub release recovery

The coordinated workflow waits for a definitive ClawHub publication result and
uploads sanitized inspector and JSON reports. If npmjs succeeds but ClawHub
fails before the publication boundary is created, re-run the original workflow:
only `clawhub-publish` requests approval, while its target recheck skips any
exact version that appeared during the failure. The reverse partial state is
handled independently by `npm-publish`, and GitHub Packages retains its own
idempotent precheck. If both exact protected-registry targets already match,
both protected jobs are skipped while GitHub Packages is reconciled before the
GitHub Release is finalized.

ClawHub CLI 0.23.3 has no supported standalone attempt status or resume command.
Its authenticated attempt endpoint is an internal implementation detail, and
submitting the same package version while an attempt is active is rejected
rather than treated as an idempotent resume. Therefore the workflow creates a
durable check run and then uploads a 90-day
`clawhub-publication-boundary-v<version>-<commit>` artifact immediately before
the only real publish command. The check run preserves the boundary after
artifact expiry; the artifact provides a directly downloadable marker during
the complete 30-day workflow re-run window. Validation, build, dry-run, exact
ClawHub registry lookup, and tag verification all happen before either boundary
and can be retried safely. A failure after the check run is created is an
unknown ClawHub outcome even if the command may not have reached the server;
automation must not infer safety from an absent public version.

If a run fails, first inspect the package and version history:

```shell
npx --yes clawhub@0.23.3 package inspect openclaw-wechat --versions --json
npx --yes clawhub@0.23.3 package moderation-status openclaw-wechat --json
npx --yes clawhub@0.23.3 package readiness openclaw-wechat --json
```

If the target version is absent and neither a publication-boundary check nor
artifact exists, the failure occurred before the irreversible command boundary
and the exact-tag workflow can safely retry ClawHub. The explicit recovery input
is required only after a durable boundary exists and authoritative review has
confirmed another request is safe.

If either boundary exists, inspect its originating run and sanitized reports
for an attempt ID or terminal status, then obtain authoritative ClawHub
confirmation that no active or accepted attempt exists. After confirmation,
delete only the matching artifact if it still exists, then dispatch
`release.yml` from the exact tag with `authorize_clawhub_recovery` enabled. The
durable check intentionally remains as the audit record; the explicit input
authorizes crossing it for that new protected run. If the version appears with
the expected identity, the workflow skips ClawHub. If a version exists with
different source metadata or embedded runtime identity, automation fails
instead of claiming success; do not republish or rewrite that version. Resolve
a rejected artifact in a new release.

Once the public package is ready, install it in an isolated OpenClaw state,
confirm `openclaw plugins list` still reports the `openclaw-weixin`
plugin/channel id, and inspect the listing's source commit, icon, summary,
compatibility, and scan status. Inspect both rendered
README languages as well: the primary README must be English, the title must be
`openclaw-wechat`, and its prompt must try ClawHub before npm. The Chinese prompt
must try npm before ClawHub. Each prompt must name both source specs once and
describe `--force` once as noninteractive npm source confirmation. Direct npm
and ClawHub commands must rely on interactive confirmation and omit the flag.
ClawHub must be the first marked source, npm must remain available, and every
language or documentation link must be absolute. The canonical npm tarball and
repository READMEs must remain titled `openclaw-weixin` and npm-first.
