import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/clawhub-publish.yml", import.meta.url), "utf8").replaceAll(
  "\r\n",
  "\n",
);
const releaseGuide = readFileSync(new URL("../RELEASE.md", import.meta.url), "utf8").replaceAll("\r\n", "\n");

function occurrences(value, fragment) {
  return value.split(fragment).length - 1;
}

describe("ClawHub publish workflow contract", () => {
  it("limits PRs to a pinned local dry-run", () => {
    const prepareJobStart = workflow.indexOf("\n  prepare:\n");
    const publishJobStart = workflow.indexOf("\n  publish:\n");
    expect(prepareJobStart).toBeGreaterThan(-1);
    expect(publishJobStart).toBeGreaterThan(prepareJobStart);

    const prepareJob = workflow.slice(prepareJobStart, publishJobStart);
    expect(workflow).toContain("  pull_request:");
    expect(workflow).toContain("  workflow_dispatch:");
    expect(workflow).not.toContain("  push:");
    expect(prepareJob).toContain("clawhub@0.23.3");
    expect(prepareJob).toContain("package publish");
    expect(prepareJob).toContain("--dry-run");
    expect(prepareJob).toContain('--openclaw-version "$openclaw_version"');
    expect(prepareJob).toContain("contents: read");
    expect(prepareJob).not.toContain("id-token: write");
    expect(prepareJob).not.toContain("CLAWHUB_TOKEN");
  });

  it("publishes only from a matching release tag through a protected environment", () => {
    const publishJob = workflow.slice(workflow.indexOf("\n  publish:\n"));
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain('if [[ "$GITHUB_REF" != "refs/tags/$EXPECTED_TAG" ]]');
    expect(workflow).toContain('if [[ "$tag_commit" != "$GITHUB_SHA" ]]');
    expect(workflow).toContain('if [[ "$GITHUB_SHA" != "$RELEASE_COMMIT" ]]');
    expect(publishJob).toContain("environment:\n      name: clawhub-publish");
    expect(publishJob).toContain("clawhub@0.23.3 package publish");
    expect(publishJob).toContain("--owner newfuture");
    expect(publishJob).toContain("--family code-plugin");
    expect(publishJob).toContain('--source-commit "$GITHUB_SHA"');
    expect(publishJob).toContain('--source-ref "$GITHUB_REF"');
    expect(publishJob).toContain('result.publicationStatus !== "published"');
    expect(publishJob).not.toContain("openclaw/clawhub/.github/workflows/package-publish.yml");
    expect(publishJob).toContain("id-token: write");
    expect(occurrences(workflow, "id-token: write")).toBe(1);
    expect(workflow).not.toContain("clawhub_token:");
    expect(releaseGuide).toContain("--environment clawhub-publish");
    expect(releaseGuide).toMatch(/`clawhub-publish` requires approval[\s\S]*tags that\s+match `v\*`/);
  });
});
