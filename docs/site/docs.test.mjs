import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createPageByFile,
  createPages,
  createPathResolver,
  createSidebar,
  DEFAULT_LOCALE,
  DOCUMENTS,
  GROUPS,
  htmlPathFor,
  isTranslated,
  LOCALES,
  linkFor,
} from "./.vitepress/docs.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("documentation map", () => {
  it("points every document at Markdown that exists in the repository", async () => {
    for (const document of DOCUMENTS) {
      assert.ok(document.sources[DEFAULT_LOCALE], `missing default source for ${document.slug}`);
      for (const locale of LOCALES) {
        if (!isTranslated(document, locale.id)) continue;
        await access(path.join(REPO_ROOT, document.sources[locale.id]));
      }
    }
  });

  it("lists every document in exactly one navigation group", () => {
    const grouped = GROUPS.flatMap((group) => group.documents);
    assert.deepEqual([...grouped].sort(), [...new Set(grouped)].sort());
    assert.deepEqual([...grouped].sort(), DOCUMENTS.map((document) => document.slug).sort());
  });

  it("describes and titles every document in every locale", () => {
    for (const document of DOCUMENTS) {
      for (const locale of LOCALES) {
        assert.ok(document.title[locale.id], `missing ${locale.id} title for ${document.slug}`);
        assert.ok(document.description[locale.id], `missing ${locale.id} description for ${document.slug}`);
      }
    }
  });

  it("publishes the default locale at the root and other locales under their prefix", () => {
    const pages = createPages();
    const byPath = new Map(pages.map((page) => [page.path, page]));
    assert.equal(byPath.get("index").source, "README_EN.md");
    assert.equal(byPath.get("guide").locale, DEFAULT_LOCALE);
    assert.equal(byPath.get("zh/guide").source, "docs/guide.zh_CN.md");
    assert.equal(byPath.get("zh/index").source, "README.md");
  });

  it("publishes every document in every locale so language switching never 404s", () => {
    const pages = createPages();
    assert.equal(pages.length, DOCUMENTS.length * LOCALES.length);
    const architecture = pages.find((page) => page.path === "zh/architecture");
    assert.equal(architecture.source, "docs/architecture.md");
    assert.equal(architecture.translated, false);
    assert.equal(architecture.canonicalPath, "architecture");
    const guide = pages.find((page) => page.path === "zh/guide");
    assert.equal(guide.translated, true);
    assert.equal(guide.canonicalPath, "zh/guide");
  });

  it("maps generated pages back to their repository source for edit links", () => {
    const pageByFile = createPageByFile();
    assert.equal(pageByFile["index.md"].source, "README_EN.md");
    assert.equal(pageByFile["zh/changelog.md"].source, "CHANGELOG.md");
    assert.equal(pageByFile["security.md"].source, "SECURITY.md");
    assert.equal(pageByFile["zh/security.md"].source, "SECURITY.md");
  });

  it("keeps every locale link inside its own locale", () => {
    const architecture = DOCUMENTS.find((document) => document.slug === "architecture");
    assert.equal(linkFor(architecture, "zh"), "/zh/architecture");
    assert.equal(linkFor(architecture, "en"), "/architecture");

    const sidebar = createSidebar("zh").flatMap((group) => group.items);
    const entry = sidebar.find((item) => item.link === "/zh/architecture");
    assert.equal(entry.text, "架构说明（EN）");
    assert.ok(sidebar.some((item) => item.link === "/zh/guide" && item.text === "详细指南"));
  });

  it("resolves a source document to the reader's locale", () => {
    const resolve = createPathResolver("zh");
    assert.equal(resolve("docs/guide.zh_CN.md"), "zh/guide");
    assert.equal(resolve("docs/architecture.md"), "zh/architecture");
    assert.equal(resolve("LICENSE"), undefined);
  });

  it("honours an explicit link to another locale's translation", () => {
    assert.equal(createPathResolver("zh")("README_EN.md"), "index");
    assert.equal(createPathResolver("en")("README.md"), "zh/index");
    assert.equal(createPathResolver("en")("docs/architecture.md"), "architecture");
  });

  it("maps page paths onto the published HTML files", () => {
    assert.equal(htmlPathFor("index"), "");
    assert.equal(htmlPathFor("zh/index"), "zh/");
    assert.equal(htmlPathFor("zh/architecture"), "zh/architecture.html");
  });

  it("links the localized home page at the locale root", () => {
    const index = DOCUMENTS.find((document) => document.slug === "index");
    assert.equal(linkFor(index, "en"), "/");
    assert.equal(linkFor(index, "zh"), "/zh/");
  });
});
