import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createPages,
  createSidebar,
  createSourceByPage,
  DEFAULT_LOCALE,
  DOCUMENTS,
  GROUPS,
  isTranslated,
  LOCALES,
  linkFor,
} from "./.vitepress/docs.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("documentation map", () => {
  it("points every document at Markdown that exists in the repository", async () => {
    for (const document of DOCUMENTS) {
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
    assert.ok(!byPath.has("zh/architecture"), "untranslated documents must not be published");
  });

  it("maps generated pages back to their repository source for edit links", () => {
    const sourceByPage = createSourceByPage();
    assert.equal(sourceByPage["index.md"], "README_EN.md");
    assert.equal(sourceByPage["zh/changelog.md"], "CHANGELOG.md");
    assert.equal(sourceByPage["security.md"], "SECURITY.md");
  });

  it("falls back to the English page for untranslated documents", () => {
    const architecture = DOCUMENTS.find((document) => document.slug === "architecture");
    assert.equal(linkFor(architecture, "zh"), "/architecture");
    assert.equal(linkFor(architecture, "en"), "/architecture");

    const sidebar = createSidebar("zh").flatMap((group) => group.items);
    const entry = sidebar.find((item) => item.link === "/architecture");
    assert.equal(entry.text, "架构说明（EN）");
    assert.ok(sidebar.some((item) => item.link === "/zh/guide" && item.text === "详细指南"));
  });

  it("links the localized home page at the locale root", () => {
    const index = DOCUMENTS.find((document) => document.slug === "index");
    assert.equal(linkFor(index, "en"), "/");
    assert.equal(linkFor(index, "zh"), "/zh/");
  });
});
