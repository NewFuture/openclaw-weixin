# npm release process

`openclaw-weixin` publishes only to the official npm registry. Never commit an
npm token or add `NODE_AUTH_TOKEN` to the release workflow.

## First publication

npm normally requires a package to exist before its Trusted Publisher can be
configured. A maintainer must therefore bootstrap the unscoped package once:

1. Confirm the unscoped `openclaw-weixin` name and version are available and
   that the publishing npm account uses two-factor authentication.
2. From the exact clean release commit, run `npm ci`, `npm run audit:deps`, and
   `npm run check`.
3. Inspect the package with `npm run pack:check`, then publish it with
   `npm publish --access public`.
4. In the npm package settings, add a GitHub Actions Trusted Publisher for
   owner `NewFuture`, repository `openclaw-weixin`, and workflow `release.yml`.

The initial community package keeps version `2.4.6`, matching the code and
plugin manifest inherited from the upstream release. If that exact
`openclaw-weixin@2.4.6` version already exists, stop and update
`package.json`, `package-lock.json`, `openclaw.plugin.json`, and both
changelogs together before publishing.

## Trusted releases

After Trusted Publishing is configured:

1. Update the package and plugin manifest versions together and update both
   changelogs.
2. Merge a clean release commit whose checks pass.
3. Create and push the matching tag, for example `v2.4.7`.

`.github/workflows/release.yml` verifies the tag, installs from the lockfile,
runs the dependency audit, type checking, tests, the build, and the
package-content check, then publishes `openclaw-weixin` with npm provenance
over GitHub OIDC.
