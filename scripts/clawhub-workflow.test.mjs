import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/clawhub-publish.yml", import.meta.url), "utf8").replaceAll(
  "\r\n",
  "\n",
);
const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8").replaceAll(
  "\r\n",
  "\n",
);

function job(workflowSource, name, nextName) {
  const start = workflowSource.indexOf(`\n  ${name}:\n`);
  const end = workflowSource.indexOf(`\n  ${nextName}:\n`, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return workflowSource.slice(start, end);
}

describe("ClawHub publish workflow contract", () => {
  it("limits the standalone workflow to a pinned credential-free PR dry-run", () => {
    const prepareJobStart = workflow.indexOf("\n  prepare:\n");
    expect(prepareJobStart).toBeGreaterThan(-1);

    const prepareJob = workflow.slice(prepareJobStart);
    expect(workflow).toContain("  pull_request:");
    expect(workflow).not.toContain("  workflow_dispatch:");
    expect(workflow).not.toContain("  push:");
    expect(workflow).not.toContain("\n  publish:\n");
    expect(prepareJob).toContain("clawhub@0.23.3");
    expect(prepareJob).toContain("package publish");
    expect(prepareJob).toContain("--dry-run");
    expect(prepareJob).toContain('--openclaw-version "$openclaw_version"');
    expect(prepareJob).toContain("contents: read");
    expect(prepareJob).not.toContain("id-token: write");
    expect(prepareJob).not.toContain("CLAWHUB_TOKEN");
    expect(workflow).not.toContain("environment:");
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).toContain("$RUNNER_TEMP/source-package");
    expect(workflow).not.toContain("$RUNNER_TEMP/npm-package");
    expect(workflow).not.toContain("prepare-npm-package.mjs");
    expect(workflow).not.toContain("--wait");
    expect(workflow).not.toContain("clawhub_token:");
  });

  it("publishes the staged npm README variant", () => {
    const validateJob = job(releaseWorkflow, "validate", "npm-publish");
    const npmPublishJob = job(releaseWorkflow, "npm-publish", "clawhub-publish");
    const clawHubPublishJob = job(releaseWorkflow, "clawhub-publish", "github-package");
    const githubPackageJob = job(releaseWorkflow, "github-package", "github-release");

    expect(validateJob).toContain("node scripts/prepare-npm-package.mjs");
    expect(validateJob).toContain("node scripts/prepare-clawhub-package.mjs");
    expect(validateJob).toContain("name: registry-packages");
    expect(npmPublishJob).toContain("actions/download-artifact@");
    expect(npmPublishJob).not.toContain("prepare-npm-package.mjs");
    expect(npmPublishJob).toContain('packages=("$RUNNER_TEMP/npm-package/"*.tgz)');
    expect(npmPublishJob).toContain(`npm publish "\${packages[0]}"`);
    expect(npmPublishJob).not.toContain(
      "run: npm publish --ignore-scripts --provenance --access public --registry=https://registry.npmjs.org",
    );
    expect(clawHubPublishJob).toContain("actions/download-artifact@");
    expect(clawHubPublishJob).not.toContain("prepare-clawhub-package.mjs");
    expect(githubPackageJob).toContain("actions/download-artifact@");
    expect(githubPackageJob).not.toContain("prepare-npm-package.mjs");
    expect(githubPackageJob).toContain("node scripts/prepare-github-package.mjs");
  });
});
