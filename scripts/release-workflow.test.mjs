import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { GITHUB_PACKAGE_NAME, GITHUB_PACKAGE_REGISTRY } from "./prepare-github-package.mjs";

const workflowSource = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8").replaceAll(
  "\r\n",
  "\n",
);

function jobSource(jobId, nextJobId) {
  const start = workflowSource.indexOf(`\n  ${jobId}:\n`);
  const end = nextJobId ? workflowSource.indexOf(`\n  ${nextJobId}:\n`, start + 1) : workflowSource.length;
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return workflowSource.slice(start, end);
}

function occurrences(value, fragment) {
  return value.split(fragment).length - 1;
}

describe("release workflow contract", () => {
  it("requests both missing registry environments concurrently from one validated target resolution", () => {
    const validateJob = jobSource("validate", "npm-publish");
    const npmJob = jobSource("npm-publish", "clawhub-publish");
    const clawHubJob = jobSource("clawhub-publish", "verify-registries");

    expect(validateJob).toContain("clawhub_published: $" + "{{ steps.targets.outputs.clawhub_published }}");
    expect(validateJob).toContain("npmjs_published: $" + "{{ steps.targets.outputs.npmjs_published }}");
    expect(npmJob).toContain("needs: validate");
    expect(clawHubJob).toContain("needs: validate");
    expect(npmJob).toContain("if: needs.validate.outputs.npmjs_published != 'true'");
    expect(clawHubJob).toContain("if: needs.validate.outputs.clawhub_published != 'true'");
    expect(npmJob).toContain("environment:\n      name: npm-publish");
    expect(clawHubJob).toContain("environment:\n      name: clawhub-publish");
    expect(npmJob).not.toContain("\n      - clawhub-publish");
    expect(clawHubJob).not.toContain("\n      - npm-publish");
  });

  it("isolates registry trust and permissions to two environment-bound OIDC jobs", () => {
    const npmJob = jobSource("npm-publish", "clawhub-publish");
    const clawHubJob = jobSource("clawhub-publish", "verify-registries");

    expect(occurrences(workflowSource, "id-token: write")).toBe(2);
    expect(npmJob).toContain("permissions:\n      contents: read\n      id-token: write");
    expect(npmJob).not.toContain("checks: write");
    expect(clawHubJob).toContain(
      "permissions:\n      actions: read\n      checks: write\n      contents: read\n      id-token: write",
    );
    expect(workflowSource).not.toContain("actions: write");
    expect(workflowSource).not.toContain("CLAWHUB_TOKEN");
  });

  it("rechecks and verifies npm independently after approval", () => {
    const npmJob = jobSource("npm-publish", "clawhub-publish");

    expect(npmJob).toContain("Recheck npmjs publication target");
    expect(npmJob).toContain("RELEASE_TARGETS_SCOPE: npmjs");
    expect(npmJob).toContain("Verify live release tag before npmjs publication");
    expect(npmJob).toContain("Publish npm package with provenance");
    expect(npmJob).toContain("Verify exact npmjs publication");
    expect(npmJob.indexOf("Recheck npmjs publication target")).toBeLessThan(
      npmJob.indexOf("Publish npm package with provenance"),
    );
    expect(npmJob.indexOf("Verify live release tag before npmjs publication")).toBeLessThan(
      npmJob.indexOf("Publish npm package with provenance"),
    );
    expect(npmJob).not.toContain("Publish ClawPack");
    expect(npmJob).not.toContain("ClawHub publication boundary");
  });

  it("waits for exact npm availability before creating the durable ClawHub boundary", () => {
    const clawHubJob = jobSource("clawhub-publish", "verify-registries");

    expect(clawHubJob).toContain("Recheck exact ClawHub publication target");
    expect(clawHubJob).toContain("RELEASE_TARGETS_SCOPE: clawhub");
    expect(clawHubJob).toContain("Wait for exact npmjs publication");
    expect(clawHubJob).toContain("node scripts/wait-for-npm-publication.mjs");
    expect(clawHubJob).toContain("Check prior ClawHub publication boundary");
    expect(clawHubJob).toContain("CLAWHUB_FIRST_ATTEMPT_JOBS_REPORT");
    expect(clawHubJob).toContain("actions/runs/$" + "{GITHUB_RUN_ID}/attempts/1/jobs");
    expect(clawHubJob).toContain("Persist durable ClawHub publication check");
    expect(clawHubJob).toContain("Persist ClawHub publication boundary artifact");
    expect(clawHubJob).toContain("checks: write");
    expect(clawHubJob).toContain("--wait");
    expect(clawHubJob).toContain("--wait-timeout 2400");
    expect(clawHubJob).toContain('result.publicationStatus !== "published"');
    expect(clawHubJob.indexOf("Wait for exact npmjs publication")).toBeLessThan(
      clawHubJob.indexOf("Check prior ClawHub publication boundary"),
    );
    expect(clawHubJob.indexOf("Persist durable ClawHub publication check")).toBeLessThan(
      clawHubJob.indexOf("Publish ClawPack"),
    );
    expect(clawHubJob.indexOf("Persist ClawHub publication boundary artifact")).toBeLessThan(
      clawHubJob.indexOf("Publish ClawPack"),
    );
    expect(clawHubJob.indexOf("Verify live release tag before ClawHub publication")).toBeLessThan(
      clawHubJob.indexOf("Check prior ClawHub publication boundary"),
    );
    expect(clawHubJob).toContain("retention-days: 90");
    expect(clawHubJob).toContain(
      "clawhub-release-publication-$" + "{{ github.run_id }}-$" + "{{ github.run_attempt }}",
    );
  });

  it("keeps GitHub Packages and GitHub Release least-privilege and dependent on both registries", () => {
    const verifyRegistriesJob = jobSource("verify-registries", "github-package");
    const githubPackageJob = jobSource("github-package", "github-release");
    const githubReleaseJob = jobSource("github-release");

    expect(verifyRegistriesJob).toContain("needs:\n      - validate\n      - npm-publish\n      - clawhub-publish");
    expect(verifyRegistriesJob).toContain("permissions:\n      contents: read");
    expect(verifyRegistriesJob).toContain("if: >-\n      $" + "{{\n        !cancelled()");
    expect(verifyRegistriesJob).not.toContain("if: >-\n      $" + "{{\n        always()");
    expect(verifyRegistriesJob).toContain("Resolve final registry publication targets");
    expect(verifyRegistriesJob).toContain("Require both exact registry versions");
    expect(verifyRegistriesJob).toContain("node scripts/resolve-release-targets.mjs");
    expect(verifyRegistriesJob).toContain("node scripts/verify-release-tag.mjs");
    expect(verifyRegistriesJob).not.toContain("id-token: write");
    expect(githubPackageJob).toContain(
      "needs:\n      - validate\n      - npm-publish\n      - clawhub-publish\n      - verify-registries",
    );
    expect(githubReleaseJob).toContain(
      "needs:\n      - validate\n      - npm-publish\n      - clawhub-publish\n      - verify-registries\n      - github-package",
    );
    for (const downstreamJob of [githubPackageJob, githubReleaseJob]) {
      expect(downstreamJob).toContain(
        "(needs.npm-publish.result == 'success' || needs.npm-publish.result == 'skipped')",
      );
      expect(downstreamJob).toContain(
        "(needs.clawhub-publish.result == 'success' || needs.clawhub-publish.result == 'skipped')",
      );
      expect(downstreamJob).toContain("needs.verify-registries.result == 'success'");
      expect(downstreamJob).toContain("if: >-\n      $" + "{{\n        !cancelled()");
      expect(downstreamJob).not.toContain("if: >-\n      $" + "{{\n        always()");
    }

    expect(githubPackageJob).toContain("permissions:\n      contents: read\n      packages: write");
    expect(githubPackageJob).toContain(`GITHUB_PACKAGE_NAME: "${GITHUB_PACKAGE_NAME}"`);
    expect(githubPackageJob).toContain(`GITHUB_PACKAGE_REGISTRY: ${GITHUB_PACKAGE_REGISTRY}`);
    expect(githubPackageJob).toContain("node scripts/prepare-github-package.mjs");
    expect(githubPackageJob).not.toContain("id-token: write");
    expect(githubReleaseJob).toContain("permissions:\n      contents: write");
    expect(githubReleaseJob).toContain("node scripts/render-release-notes.mjs");
    expect(githubReleaseJob).not.toContain("id-token: write");
  });

  it("keeps exact-tag checks and run-attempt-safe reports at every irreversible boundary", () => {
    expect(occurrences(workflowSource, 'if [ "$RELEASE_REF_TYPE" != "tag" ]')).toBeGreaterThanOrEqual(5);
    expect(occurrences(workflowSource, 'if [[ "$release_commit" != "$GITHUB_SHA" ]]')).toBeGreaterThanOrEqual(5);
    expect(occurrences(workflowSource, "node scripts/verify-release-tag.mjs")).toBe(6);
    expect(workflowSource).toContain(
      "coordinated-release-preflight-$" + "{{ github.run_id }}-$" + "{{ github.run_attempt }}",
    );
    expect(workflowSource).toContain("npmjs-release-$" + "{{ github.run_id }}-$" + "{{ github.run_attempt }}");
  });
});
