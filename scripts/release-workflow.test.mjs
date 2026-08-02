import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

describe("release workflow contract", () => {
  it("skips an npm version that is already published", () => {
    expect(workflow).toContain("npm_published: $" + "{{ steps.npm-status.outputs.published }}");
    expect(workflow).toContain("if: needs.validate.outputs.npm_published != 'true'");
    expect(workflow).toContain("if: steps.npm-status.outputs.published != 'true'");
  });

  it("publishes the GitHub release after npm with separate permissions", () => {
    const npmJobStart = workflow.indexOf("\n  publish:\n");
    const githubJobStart = workflow.indexOf("\n  github-release:\n");
    expect(npmJobStart).toBeGreaterThan(-1);
    expect(githubJobStart).toBeGreaterThan(npmJobStart);

    const npmJob = workflow.slice(npmJobStart, githubJobStart);
    const githubJob = workflow.slice(githubJobStart);
    expect(npmJob).toContain("id-token: write");
    expect(npmJob).not.toContain("contents: write");
    expect(githubJob).toContain("- publish");
    expect(githubJob).toContain("contents: write");
    expect(githubJob).not.toContain("id-token: write");
    expect(githubJob).toContain("node scripts/render-release-notes.mjs");
    expect(githubJob).toContain('gh release create "$RELEASE_TAG"');
  });
});
