#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob
clawpacks=("$RUNNER_TEMP/clawhub-package/"*.tgz)
if (( ${#clawpacks[@]} != 1 )); then
  echo "::error::Expected exactly one ClawPack, found ${#clawpacks[@]}."
  exit 1
fi

clawpack="${clawpacks[0]}"
openclaw_version="$(
  node -p "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).openclaw.build.openclawVersion"
)"
package_root="$RUNNER_TEMP/clawhub-package-root"
mkdir -p "$package_root"
tar -xzf "$clawpack" -C "$package_root"
npx --yes clawhub@0.23.3 package validate \
  "$package_root/package" \
  --out "$RUNNER_TEMP/clawhub-inspector" \
  --openclaw-version "$openclaw_version" \
  --json |
  tee "$RUNNER_TEMP/clawhub-validate.json"
npx --yes clawhub@0.23.3 package publish "$clawpack" \
  --family code-plugin \
  --owner newfuture \
  --display-name WeChat \
  --categories channels \
  --topics wechat,weixin,messaging \
  --source-repo "$GITHUB_REPOSITORY" \
  --source-commit "$GITHUB_SHA" \
  --source-ref "$GITHUB_REF" \
  --dry-run \
  --json |
  tee "$RUNNER_TEMP/clawhub-dry-run.json"
