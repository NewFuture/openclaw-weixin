import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { GITHUB_PACKAGE_NAME, GITHUB_PACKAGE_REGISTRY } from "./prepare-github-package.mjs";

const workflowSource = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8").replaceAll(
  "\r\n",
  "\n",
);
const workflow = parse(workflowSource);
const jobs = workflow.jobs;

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
    expect(jobs.validate.outputs).toMatchObject({
      clawhub_published: "$" + "{{ steps.targets.outputs.clawhub_published }}",
      npmjs_published: "$" + "{{ steps.targets.outputs.npmjs_published }}",
    });
    expect(jobs["npm-publish"].needs).toBe("validate");
    expect(jobs["clawhub-publish"].needs).toBe("validate");
    expect(jobs["npm-publish"].if).toBe("needs.validate.outputs.npmjs_published != 'true'");
    expect(jobs["clawhub-publish"].if).toBe("needs.validate.outputs.clawhub_published != 'true'");
    expect(jobs["npm-publish"].environment.name).toBe("npm-publish");
    expect(jobs["clawhub-publish"].environment.name).toBe("clawhub-publish");
    expect(jobs["npm-publish"].needs).not.toBe("clawhub-publish");
    expect(jobs["clawhub-publish"].needs).not.toBe("npm-publish");
  });

  it.each([
    { clawHubPublished: false, npmjsPublished: false, pending: ["npm-publish", "clawhub-publish"] },
    { clawHubPublished: false, npmjsPublished: true, pending: ["clawhub-publish"] },
    { clawHubPublished: true, npmjsPublished: false, pending: ["npm-publish"] },
    { clawHubPublished: true, npmjsPublished: true, pending: [] },
  ])(
    "gates only missing exact targets when npmjs=$npmjsPublished and ClawHub=$clawHubPublished",
    ({ clawHubPublished, npmjsPublished, pending }) => {
      const requested = [];
      if (!npmjsPublished) requested.push("npm-publish");
      if (!clawHubPublished) requested.push("clawhub-publish");
      expect(requested).toEqual(pending);
    },
  );

  it("isolates registry trust and permissions to two environment-bound OIDC jobs", () => {
    const oidcJobs = Object.entries(jobs)
      .filter(([, job]) => job.permissions?.["id-token"] === "write")
      .map(([jobId]) => jobId);

    expect(oidcJobs).toEqual(["npm-publish", "clawhub-publish"]);
    expect(jobs["npm-publish"].permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });
    expect(jobs["clawhub-publish"].permissions).toEqual({
      actions: "read",
      checks: "write",
      contents: "read",
      "id-token": "write",
    });
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
    const clawHubJob = jobSource("clawhub-publish", "github-package");

    expect(clawHubJob).toContain("Recheck exact ClawHub publication target");
    expect(clawHubJob).toContain("RELEASE_TARGETS_SCOPE: clawhub");
    expect(clawHubJob).toContain("Wait for exact npmjs publication");
    expect(clawHubJob).toContain("node scripts/wait-for-npm-publication.mjs");
    expect(clawHubJob).toContain("Check prior ClawHub publication boundary");
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

  it.each([
    { clawhub: "success", npmjs: "success", allowed: true },
    { clawhub: "success", npmjs: "skipped", allowed: true },
    { clawhub: "skipped", npmjs: "success", allowed: true },
    { clawhub: "skipped", npmjs: "skipped", allowed: true },
    { clawhub: "failure", npmjs: "success", allowed: false },
    { clawhub: "success", npmjs: "failure", allowed: false },
    { clawhub: "cancelled", npmjs: "skipped", allowed: false },
    { clawhub: "skipped", npmjs: "cancelled", allowed: false },
  ])("allows downstream recovery=$allowed for npmjs=$npmjs and ClawHub=$clawhub", ({ allowed, clawhub, npmjs }) => {
    const accepted = (result) => result === "success" || result === "skipped";
    expect(accepted(npmjs) && accepted(clawhub)).toBe(allowed);
  });

  it("keeps GitHub Packages and GitHub Release least-privilege and dependent on both registries", () => {
    const verifyRegistriesJob = jobSource("verify-registries", "github-package");
    const githubPackageJob = jobSource("github-package", "github-release");
    const githubReleaseJob = jobSource("github-release");

    expect(jobs["verify-registries"].needs).toEqual(["validate", "npm-publish", "clawhub-publish"]);
    expect(jobs["verify-registries"].permissions).toEqual({ contents: "read" });
    expect(jobs["verify-registries"].if).toContain("!cancelled()");
    expect(jobs["verify-registries"].if).not.toContain("always()");
    expect(verifyRegistriesJob).toContain("Resolve final registry publication targets");
    expect(verifyRegistriesJob).toContain("Require both exact registry versions");
    expect(verifyRegistriesJob).toContain("node scripts/resolve-release-targets.mjs");
    expect(verifyRegistriesJob).toContain("node scripts/verify-release-tag.mjs");
    expect(verifyRegistriesJob).not.toContain("id-token: write");
    expect(jobs["github-package"].needs).toEqual(["validate", "npm-publish", "clawhub-publish", "verify-registries"]);
    expect(jobs["github-release"].needs).toEqual([
      "validate",
      "npm-publish",
      "clawhub-publish",
      "verify-registries",
      "github-package",
    ]);
    for (const downstreamJob of [jobs["github-package"], jobs["github-release"]]) {
      expect(downstreamJob.if).toContain(
        "(needs.npm-publish.result == 'success' || needs.npm-publish.result == 'skipped')",
      );
      expect(downstreamJob.if).toContain(
        "(needs.clawhub-publish.result == 'success' || needs.clawhub-publish.result == 'skipped')",
      );
      expect(downstreamJob.if).toContain("needs.verify-registries.result == 'success'");
      expect(downstreamJob.if).toContain("!cancelled()");
      expect(downstreamJob.if).not.toContain("always()");
    }

    expect(jobs["github-package"].permissions).toEqual({
      contents: "read",
      packages: "write",
    });
    expect(githubPackageJob).toContain(`GITHUB_PACKAGE_NAME: "${GITHUB_PACKAGE_NAME}"`);
    expect(githubPackageJob).toContain(`GITHUB_PACKAGE_REGISTRY: ${GITHUB_PACKAGE_REGISTRY}`);
    expect(githubPackageJob).toContain("node scripts/prepare-github-package.mjs");
    expect(githubPackageJob).not.toContain("id-token: write");
    expect(jobs["github-release"].permissions).toEqual({ contents: "write" });
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
