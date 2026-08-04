import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { emitMachineReadable } from "./.vitepress/llms.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASE_URL = "https://example.test/openclaw-weixin";

describe("emitMachineReadable", () => {
  let outDir;
  let result;

  before(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-llms-"));
    result = await emitMachineReadable({
      repoRoot: REPO_ROOT,
      outDir,
      baseUrl: BASE_URL,
      now: new Date("2026-01-02T03:04:05.000Z"),
    });
  });

  after(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("publishes the Markdown source of every page next to its HTML", async () => {
    for (const page of result.pages) {
      const markdown = await readFile(path.join(outDir, `${page.path}.md`), "utf8");
      assert.ok(markdown.trim().length > 0);
    }
    const overview = await readFile(path.join(outDir, "zh", "index.md"), "utf8");
    assert.match(overview, /\[详细指南\]\(https:\/\/example\.test\/openclaw-weixin\/zh\/guide\.md\)/);
  });

  it("indexes every page in llms.txt, grouped by locale", async () => {
    const llms = await readFile(path.join(outDir, "llms.txt"), "utf8");
    assert.match(llms, /^# openclaw-weixin\n/);
    assert.match(llms, /- Generated: 2026-01-02T03:04:05\.000Z\n/);
    assert.match(llms, /## Docs\n/);
    assert.match(llms, /## Docs \(简体中文\)\n/);
    for (const page of result.pages) {
      assert.ok(llms.includes(`(${BASE_URL}/${page.path}.md)`), `llms.txt is missing ${page.path}`);
    }
  });

  it("inlines every page in llms-full.txt with its repository source", async () => {
    const full = await readFile(path.join(outDir, "llms-full.txt"), "utf8");
    for (const page of result.pages) {
      assert.ok(
        full.includes(`<!-- source: ${page.source} | locale: ${page.locale} | url: ${BASE_URL}/${page.path}.md -->`),
        `llms-full.txt is missing ${page.source}`,
      );
    }
  });

  it("points robots.txt at the sitemap and disables Jekyll", async () => {
    const robots = await readFile(path.join(outDir, "robots.txt"), "utf8");
    assert.match(robots, /Sitemap: https:\/\/example\.test\/openclaw-weixin\/sitemap\.xml/);
    assert.equal(await readFile(path.join(outDir, ".nojekyll"), "utf8"), "");
  });
});
