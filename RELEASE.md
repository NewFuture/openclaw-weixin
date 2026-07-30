# npm release process

`openclaw-weixin` publishes only to the official npm registry. Never commit an
npm token or add `NODE_AUTH_TOKEN` to the release workflow.

## Release prerequisites

1. Confirm the target version is not already published to npm.
2. Confirm the npm package has a GitHub Actions Trusted Publisher for owner
   `NewFuture`, repository `openclaw-weixin`, and workflow `release.yml`.
3. From the exact clean release commit, run `npm ci`, `npm run audit:deps`,
   `npm run check`, and `npm run pack:check`.
4. Confirm `package.json`, `package-lock.json`, `openclaw.plugin.json`, and both
   changelogs use the same release version.

## Trusted releases

After Trusted Publishing is configured:

1. Update the package and plugin manifest versions together and move both
   changelogs' unreleased entries into the matching release section.
2. Merge a clean release commit whose checks pass.
3. Create and push the matching tag, for example `v3.0.0`.

`.github/workflows/release.yml` verifies the tag, installs from the lockfile,
runs the dependency audit, type checking, tests, the build, and the
package-content check, then publishes `openclaw-weixin` with npm provenance
over GitHub OIDC.
