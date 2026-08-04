import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { rewriteLinks } from "./.vitepress/links.mjs";
import { syncContent, withUntranslatedNotice } from "./.vitepress/sync.mjs";

const SITE_DIR = fileURLToPath(new URL(".", import.meta.url));

describe("rewriteLinks", () => {
  const resolve = (target) => (target === "docs/guide.zh_CN.md" ? "/guide.md" : undefined);

  it("resolves links relative to the source document", () => {
    const markdown = "[指南](docs/guide.zh_CN.md)";
    assert.equal(rewriteLinks(markdown, { source: "README.md", resolve }), "[指南](/guide.md)");
    assert.equal(
      rewriteLinks("[指南](./guide.zh_CN.md)", { source: "docs/backend-api.zh_CN.md", resolve }),
      "[指南](/guide.md)",
    );
  });

  it("keeps anchors and leaves external links untouched", () => {
    assert.equal(
      rewriteLinks("[安装](docs/guide.zh_CN.md#安装)", { source: "README.md", resolve }),
      "[安装](/guide.md#安装)",
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

  it("writes one page per document and locale", async () => {
    assert.ok(pages.length >= 18);
    for (const page of pages) {
      await readFile(path.join(contentDir, `${page.path}.md`), "utf8");
    }
  });

  it("prefixes every page with its title and description", async () => {
    const overview = await readFile(path.join(contentDir, "index.md"), "utf8");
    assert.match(overview, /^---\ntitle: "概览"\ndescription: "[^"]+"\n---\n/);
    assert.match(overview, /# openclaw-weixin/);
  });

  it("rewrites cross-document links onto same-locale site paths", async () => {
    const overview = await readFile(path.join(contentDir, "index.md"), "utf8");
    assert.match(overview, /\[详细指南\]\(\/guide\.md\)/);
    assert.match(overview, /\[架构说明\]\(\/architecture\.md\)/);
    assert.match(overview, /\[English\]\(\/en\/index\.md\)/);

    const english = await readFile(path.join(contentDir, "en", "index.md"), "utf8");
    assert.match(english, /\[Detailed guide\]\(\/en\/guide\.md\)/);
    assert.match(english, /\[简体中文\]\(\/index\.md\)/);
  });

  it("marks locale copies that still carry the English text", async () => {
    const architecture = await readFile(path.join(contentDir, "architecture.md"), "utf8");
    assert.match(architecture, /^---\ntitle: "架构说明"/);
    assert.match(architecture, /\n# Architecture\n\n::: warning 尚未翻译\n本页尚无中文翻译，以下为英文原文。\n:::\n/);

    const translated = await readFile(path.join(contentDir, "guide.md"), "utf8");
    assert.doesNotMatch(translated, /尚未翻译/);
    const english = await readFile(path.join(contentDir, "en", "architecture.md"), "utf8");
    assert.doesNotMatch(english, /::: warning/);
  });

  it("publishes the logo so the theme can reference it", async () => {
    const logo = await readFile(path.join(contentDir, "public", "logo.svg"), "utf8");
    assert.equal(logo, await readFile(path.join(SITE_DIR, "logo.svg"), "utf8"));
  });
});

describe("withUntranslatedNotice", () => {
  const notice = { title: "尚未翻译", body: "本页尚无中文翻译，以下为英文原文。" };

  it("leaves translated pages untouched", () => {
    assert.equal(withUntranslatedNotice("# Title\n\nBody", undefined), "# Title\n\nBody");
  });

  it("inserts the notice after the document title", () => {
    assert.equal(
      withUntranslatedNotice("# Title\n\nBody", notice),
      "# Title\n\n::: warning 尚未翻译\n本页尚无中文翻译，以下为英文原文。\n:::\n\nBody",
    );
  });

  it("prepends the notice when the document has no title", () => {
    assert.match(withUntranslatedNotice("Body", notice), /^::: warning 尚未翻译\n/);
  });
});
