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
const releaseGuide = readFileSync(new URL("../docs/en/release.md", import.meta.url), "utf8").replaceAll("\r\n", "\n");

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
    expect(releaseGuide).toContain("uses English as the\nprimary README");
    expect(releaseGuide).toContain("Source README prompts are ClawHub-first; npm variants are npm-first");
    expect(releaseGuide).toMatch(/Repository and website \| Title `openclaw-weixin`; ClawHub-first/);
    expect(releaseGuide).not.toContain("## First ClawHub publication");
    expect(workflow).not.toContain("clawhub_token:");
  });

  it("publishes the staged npm README variant", () => {
    expect(releaseWorkflow).toContain("node scripts/prepare-npm-package.mjs");
    expect(releaseWorkflow).toContain(`npm publish "\${packages[0]}"`);
    expect(releaseWorkflow).not.toContain(
      "run: npm publish --ignore-scripts --provenance --access public --registry=https://registry.npmjs.org",
    );
    expect(releaseWorkflow.indexOf("node scripts/prepare-npm-package.mjs")).toBeLessThan(
      releaseWorkflow.indexOf("node scripts/prepare-github-package.mjs"),
    );
  });
});
