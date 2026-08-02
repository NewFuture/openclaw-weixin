import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { GITHUB_PACKAGE_NAME, GITHUB_PACKAGE_REGISTRY } from "./prepare-github-package.mjs";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

describe("release workflow contract", () => {
  it("skips an npmjs version that is already published", () => {
    expect(workflow).toContain("npmjs_published: $" + "{{ steps.npmjs-status.outputs.published }}");
    expect(workflow).toContain("if: needs.validate.outputs.npmjs_published != 'true'");
    expect(workflow).toContain("if: steps.npmjs-status.outputs.published != 'true'");
  });

  it("publishes npmjs, GitHub Packages, and the GitHub Release with separate permissions", () => {
    const npmJobStart = workflow.indexOf("\n  publish:\n");
    const githubPackageJobStart = workflow.indexOf("\n  github-package:\n");
    const githubJobStart = workflow.indexOf("\n  github-release:\n");
    expect(npmJobStart).toBeGreaterThan(-1);
    expect(githubPackageJobStart).toBeGreaterThan(npmJobStart);
    expect(githubJobStart).toBeGreaterThan(githubPackageJobStart);

    const npmJob = workflow.slice(npmJobStart, githubPackageJobStart);
    const githubPackageJob = workflow.slice(githubPackageJobStart, githubJobStart);
    const githubJob = workflow.slice(githubJobStart);
    expect(npmJob).toContain("id-token: write");
    expect(npmJob).not.toContain("contents: write");
    expect(npmJob).not.toContain("packages: write");
    expect(githubPackageJob).toContain("- publish");
    expect(githubPackageJob).toContain("packages: write");
    expect(githubPackageJob).not.toContain("id-token: write");
    expect(githubPackageJob).not.toContain("contents: write");
    expect(githubPackageJob).toContain(`GITHUB_PACKAGE_NAME: "${GITHUB_PACKAGE_NAME}"`);
    expect(githubPackageJob).toContain(`GITHUB_PACKAGE_REGISTRY: ${GITHUB_PACKAGE_REGISTRY}`);
    expect(githubPackageJob).toContain("node scripts/prepare-github-package.mjs");
    expect(githubPackageJob).toContain('cd "$package_root/package"');
    expect(githubPackageJob).toContain("npm pack --dry-run --ignore-scripts");
    expect(githubPackageJob).toContain("npm publish --ignore-scripts --registry=https://npm.pkg.github.com");
    expect(githubJob).toContain("- github-package");
    expect(githubJob).toContain("contents: write");
    expect(githubJob).not.toContain("id-token: write");
    expect(githubJob).not.toContain("packages: write");
    expect(githubJob).toContain("needs.github-package.result == 'success'");
    expect(githubJob).toContain("node scripts/render-release-notes.mjs");
    expect(githubJob).toContain('gh release create "$RELEASE_TAG"');
  });
});
