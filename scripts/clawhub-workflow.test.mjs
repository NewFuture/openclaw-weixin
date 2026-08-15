import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/clawhub-publish.yml", import.meta.url), "utf8").replaceAll(
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
    expect(workflow).not.toContain("--wait");
    expect(releaseGuide).toContain("uses the English source for its primary `README.md`");
    expect(releaseGuide).toContain("changes\nall staged README titles to `openclaw-wechat`");
    expect(releaseGuide).toMatch(
      /Chinese prompt tries npm before ClawHub[\s\S]*English prompt\s+tries ClawHub before npm/,
    );
    expect(releaseGuide).toMatch(/direct-source blocks\s+from npm-first to\s+ClawHub-first/);
    expect(releaseGuide).toMatch(/repository\s+READMEs must remain titled\s+`openclaw-weixin` and npm-first/);
    expect(releaseGuide).not.toContain("## First ClawHub publication");
    expect(workflow).not.toContain("clawhub_token:");
  });
});
