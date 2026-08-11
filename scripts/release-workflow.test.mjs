import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { GITHUB_PACKAGE_NAME, GITHUB_PACKAGE_REGISTRY } from "./prepare-github-package.mjs";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

function occurrences(value, fragment) {
  return value.split(fragment).length - 1;
}

describe("release workflow contract", () => {
  it("skips the protected environment only when both exact registry targets match", () => {
    expect(workflow).toContain("npmjs_published: $" + "{{ steps.targets.outputs.npmjs_published }}");
    expect(workflow).toContain("clawhub_published: $" + "{{ steps.targets.outputs.clawhub_published }}");
    expect(workflow).toContain("publication_required: $" + "{{ steps.targets.outputs.publication_required }}");
    expect(workflow).toContain("if: needs.validate.outputs.publication_required == 'true'");
    expect(workflow).toContain("node scripts/resolve-release-targets.mjs");
    expect(workflow).toContain("Recheck registry publication targets");
    expect(workflow).toContain("Verify coordinated publication");
    expect(workflow).toContain("Require both registry versions");
    expect(workflow).toContain(
      "coordinated-release-preflight-$" + "{{ github.run_id }}-$" + "{{ github.run_attempt }}",
    );
    expect(workflow).toContain(
      "coordinated-release-publication-$" + "{{ github.run_id }}-$" + "{{ github.run_attempt }}",
    );
  });

  it("uses one approval and one OIDC job for sequential npmjs and ClawHub publication", () => {
    const validateJobStart = workflow.indexOf("\n  validate:\n");
    const npmJobStart = workflow.indexOf("\n  publish:\n");
    const githubPackageJobStart = workflow.indexOf("\n  github-package:\n");
    const githubJobStart = workflow.indexOf("\n  github-release:\n");
    expect(validateJobStart).toBeGreaterThan(-1);
    expect(npmJobStart).toBeGreaterThan(-1);
    expect(githubPackageJobStart).toBeGreaterThan(npmJobStart);
    expect(githubJobStart).toBeGreaterThan(githubPackageJobStart);

    const validateJob = workflow.slice(validateJobStart, npmJobStart);
    const registryJob = workflow.slice(npmJobStart, githubPackageJobStart);
    const githubPackageJob = workflow.slice(githubPackageJobStart, githubJobStart);
    const githubJob = workflow.slice(githubJobStart);
    expect(validateJob).toContain("--dry-run");
    expect(validateJob).toContain("clawhub@0.23.3 package validate");
    expect(validateJob).not.toContain("id-token: write");
    expect(registryJob).toContain("environment:\n      name: npm-publish");
    expect(registryJob).toContain("id-token: write");
    expect(registryJob).not.toContain("contents: write");
    expect(registryJob).not.toContain("packages: write");
    expect(registryJob).not.toContain("actions: write");
    expect(occurrences(workflow, "environment:\n      name: npm-publish")).toBe(1);
    expect(occurrences(workflow, "id-token: write")).toBe(1);
    expect(registryJob.indexOf("Publish npm package with provenance")).toBeLessThan(
      registryJob.indexOf("Publish ClawPack"),
    );
    expect(registryJob).toContain("if: steps.targets.outputs.npmjs_published != 'true'");
    expect(registryJob).toContain("if: steps.targets.outputs.clawhub_published != 'true'");
    expect(registryJob).toContain('--source-commit "$GITHUB_SHA"');
    expect(registryJob).toContain('--source-ref "$GITHUB_REF"');
    expect(registryJob).toContain("--wait");
    expect(registryJob).toContain("--wait-timeout 2400");
    expect(registryJob).toContain('result.publicationStatus !== "published"');
    expect(registryJob.indexOf("Verify live release tag before npmjs publication")).toBeLessThan(
      registryJob.indexOf("Publish npm package with provenance"),
    );
    expect(registryJob.indexOf("Verify live release tag before ClawHub publication")).toBeLessThan(
      registryJob.indexOf("Publish ClawPack"),
    );
    expect(githubPackageJob).toContain("- publish");
    expect(githubPackageJob).toContain("packages: write");
    expect(githubPackageJob).not.toContain("id-token: write");
    expect(githubPackageJob).not.toContain("contents: write");
    expect(githubPackageJob).toContain(`GITHUB_PACKAGE_NAME: "${GITHUB_PACKAGE_NAME}"`);
    expect(githubPackageJob).toContain(`GITHUB_PACKAGE_REGISTRY: ${GITHUB_PACKAGE_REGISTRY}`);
    expect(githubPackageJob).toContain(`echo "PREVIOUS_RELEASE_VERSION=\${previous_release_version}" >> "$GITHUB_ENV"`);
    expect(githubPackageJob).toContain('if [[ "$latest_version" != "$PREVIOUS_RELEASE_VERSION" ]]');
    expect(githubPackageJob).toContain(
      `GitHub Packages is empty; publish \${GITHUB_PACKAGE_NAME}@\${PREVIOUS_RELEASE_VERSION} before \${target_version}.`,
    );
    expect(githubPackageJob).not.toContain("bootstrapping");
    expect(githubPackageJob).toContain("node scripts/prepare-github-package.mjs");
    expect(githubPackageJob).toContain('cd "$package_root/package"');
    expect(githubPackageJob).toContain("npm pack --dry-run --ignore-scripts");
    expect(githubPackageJob).toContain("npm publish --ignore-scripts --registry=https://npm.pkg.github.com");
    expect(githubPackageJob.indexOf("Verify live release tag before GitHub Packages publication")).toBeLessThan(
      githubPackageJob.indexOf("Publish GitHub package"),
    );
    expect(githubJob).toContain("- github-package");
    expect(githubJob).toContain("contents: write");
    expect(githubJob).not.toContain("id-token: write");
    expect(githubJob).not.toContain("packages: write");
    expect(githubJob).toContain("needs.github-package.result == 'success'");
    expect(githubJob).toContain("node scripts/render-release-notes.mjs");
    expect(githubJob.indexOf("Verify live release tag before GitHub Release publication")).toBeLessThan(
      githubJob.indexOf("Create or finalize GitHub release"),
    );
    expect(githubJob).toContain('gh release create "$RELEASE_TAG"');
  });

  it("keeps exact-tag validation and downstream recovery dependencies", () => {
    expect(occurrences(workflow, 'if [ "$RELEASE_REF_TYPE" != "tag" ]')).toBeGreaterThanOrEqual(3);
    expect(occurrences(workflow, 'if [[ "$release_commit" != "$GITHUB_SHA" ]]')).toBeGreaterThanOrEqual(3);
    expect(workflow).toContain("&& (needs.publish.result == 'success' || needs.publish.result == 'skipped')");
    expect(workflow).not.toContain("actions: write");
    expect(workflow).not.toContain("CLAWHUB_TOKEN");
    expect(occurrences(workflow, "node scripts/verify-release-tag.mjs")).toBe(4);
  });
});
