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
    const overview = await readFile(path.join(outDir, "index.md"), "utf8");
    assert.match(overview, /\[详细指南\]\(https:\/\/openclaw-weixin\.newfuture\.cc\/guide\.html\)/);
    assert.match(overview, /\[架构说明\]\(https:\/\/openclaw-weixin\.newfuture\.cc\/architecture\.html\)/);
  });

  it("indexes every page in llms.txt, Chinese first", async () => {
    const llms = await readFile(path.join(outDir, "llms.txt"), "utf8");
    assert.match(llms, /^# openclaw-weixin\n/);
    assert.match(llms, /^# openclaw-weixin\n\n> 社区维护的 OpenClaw 微信渠道插件。/);
    assert.match(llms, /- Generated: 2026-01-02T03:04:05\.000Z\n/);
    assert.match(llms, /- npm: https:\/\/www\.npmjs\.com\/package\/openclaw-weixin\n/);
    assert.match(llms, /- ClawHub: https:\/\/clawhub\.ai\/newfuture\/plugins\/openclaw-wechat\n/);
    assert.ok(llms.indexOf("## Docs (简体中文)\n") < llms.indexOf("## Docs (English)\n"));
    for (const page of result.pages) {
      assert.ok(llms.includes(`(${BASE_URL}/${page.path}.md)`), `llms.txt is missing ${page.path}`);
    }
  });

  it("marks locale pages that still carry the English source", async () => {
    const llms = await readFile(path.join(outDir, "llms.txt"), "utf8");
    assert.match(llms, /\/contributing\.md\): [^\n]+ \(English source, not translated yet\)\n/);
    assert.doesNotMatch(llms, /\/architecture\.md\): [^\n]*English source/);
    assert.doesNotMatch(llms, /\/guide\.md\): [^\n]*English source/);
  });

  it("inlines every translated page in llms-full.txt with its repository source", async () => {
    const full = await readFile(path.join(outDir, "llms-full.txt"), "utf8");
    for (const page of result.pages.filter((entry) => entry.translated)) {
      assert.ok(
        full.includes(`<!-- source: ${page.source} | locale: ${page.locale} | url: ${BASE_URL}/${page.path}.md -->`),
        `llms-full.txt is missing ${page.source}`,
      );
    }
    assert.ok(full.includes(`url: ${BASE_URL}/architecture.md`), "Chinese architecture must be inlined");
    assert.ok(!full.includes(`url: ${BASE_URL}/contributing.md`), "untranslated copies must not be duplicated");
  });

  it("points robots.txt at the sitemap and disables Jekyll", async () => {
    const robots = await readFile(path.join(outDir, "robots.txt"), "utf8");
    assert.match(robots, /Sitemap: https:\/\/example\.test\/openclaw-weixin\/sitemap\.xml/);
    assert.equal(await readFile(path.join(outDir, ".nojekyll"), "utf8"), "");
  });
});
