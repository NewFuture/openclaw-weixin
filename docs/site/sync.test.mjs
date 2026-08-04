import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { rewriteLinks } from "./.vitepress/links.mjs";
import { syncContent } from "./.vitepress/sync.mjs";

const SITE_DIR = fileURLToPath(new URL(".", import.meta.url));

describe("rewriteLinks", () => {
  const resolve = (target) => (target === "docs/guide.zh_CN.md" ? "/zh/guide.md" : undefined);

  it("resolves links relative to the source document", () => {
    const markdown = "[指南](docs/guide.zh_CN.md)";
    assert.equal(rewriteLinks(markdown, { source: "README.md", resolve }), "[指南](/zh/guide.md)");
    assert.equal(
      rewriteLinks("[指南](./guide.zh_CN.md)", { source: "docs/backend-api.zh_CN.md", resolve }),
      "[指南](/zh/guide.md)",
    );
  });

  it("keeps anchors and leaves external links untouched", () => {
    assert.equal(
      rewriteLinks("[安装](docs/guide.zh_CN.md#安装)", { source: "README.md", resolve }),
      "[安装](/zh/guide.md#安装)",
    );
    assert.equal(
      rewriteLinks("[上游](https://example.test)", { source: "README.md", resolve }),
      "[上游](https://example.test)",
    );
    assert.equal(rewriteLinks("[本页](#安装)", { source: "README.md", resolve }), "[本页](#安装)");
  });

  it("falls back to GitHub for repository files the site does not publish", () => {
    assert.equal(
      rewriteLinks("[license](LICENSE)", { source: "README.md", resolve }),
      "[license](https://github.com/NewFuture/openclaw-weixin/blob/main/LICENSE)",
    );
  });
});

describe("syncContent", () => {
  let contentDir;
  let pages;

  before(async () => {
    contentDir = path.join(await mkdtemp(path.join(os.tmpdir(), "openclaw-site-")), "content");
    ({ pages } = await syncContent({ contentDir }));
  });

  after(async () => {
    await rm(path.dirname(contentDir), { recursive: true, force: true });
  });

  it("writes one page per translated source", async () => {
    assert.ok(pages.length >= 13);
    for (const page of pages) {
      await readFile(path.join(contentDir, `${page.path}.md`), "utf8");
    }
  });

  it("prefixes every page with its title and description", async () => {
    const overview = await readFile(path.join(contentDir, "zh", "index.md"), "utf8");
    assert.match(overview, /^---\ntitle: "概览"\ndescription: "[^"]+"\n---\n/);
    assert.match(overview, /# openclaw-weixin/);
  });

  it("rewrites cross-document links onto site paths", async () => {
    const overview = await readFile(path.join(contentDir, "zh", "index.md"), "utf8");
    assert.match(overview, /\[详细指南\]\(\/zh\/guide\.md\)/);
    assert.match(overview, /\[架构说明\]\(\/architecture\.md\)/);
    assert.match(overview, /\[English\]\(\/index\.md\)/);
  });

  it("publishes the logo so the theme can reference it", async () => {
    const logo = await readFile(path.join(contentDir, "public", "logo.svg"), "utf8");
    assert.equal(logo, await readFile(path.join(SITE_DIR, "logo.svg"), "utf8"));
  });
});
