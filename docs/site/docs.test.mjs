import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createNav,
  createPageByFile,
  createPages,
  createPathResolver,
  createSidebar,
  DEFAULT_LOCALE,
  DOCUMENTS,
  GROUPS,
  htmlPathFor,
  LOCALES,
  linkFor,
  SITE,
  sourceFor,
} from "./.vitepress/docs.mjs";
import { configureSidebarCaret, labelsForLanguage } from "./.vitepress/theme/accessibility.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("documentation map", () => {
  it("publishes Simplified Chinese as the default locale", () => {
    assert.equal(DEFAULT_LOCALE, "zh");
    assert.deepEqual(
      LOCALES.map((locale) => [locale.id, locale.prefix]),
      [
        ["zh", "/"],
        ["en", "/en/"],
      ],
    );
  });

  it("publishes both community package sources", () => {
    assert.equal(SITE.npmUrl, "https://www.npmjs.com/package/openclaw-weixin");
    assert.equal(SITE.clawHubUrl, "https://clawhub.ai/newfuture/plugins/openclaw-wechat");
  });

  it("points every document at Markdown that exists in the repository", async () => {
    for (const document of DOCUMENTS) {
      assert.ok(Object.keys(document.sources).length > 0, `missing sources for ${document.slug}`);
      for (const locale of LOCALES) {
        await access(path.join(REPO_ROOT, sourceFor(document, locale.id)));
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
    assert.equal(byPath.get("index").source, "README.md");
    assert.equal(byPath.get("guide").locale, DEFAULT_LOCALE);
    assert.equal(byPath.get("guide").source, "docs/zh-CN/guide.md");
    assert.equal(byPath.get("en/guide").source, "docs/en/guide.md");
    assert.equal(byPath.get("architecture").source, "docs/zh-CN/architecture.md");
    assert.equal(byPath.get("en/architecture").source, "docs/en/architecture.md");
    assert.equal(byPath.get("en/index").source, "README_EN.md");
  });

  it("keeps every document explicitly translated", () => {
    for (const document of DOCUMENTS) {
      assert.ok(document.sources.zh, `missing Simplified Chinese source for ${document.slug}`);
      assert.ok(document.sources.en, `missing English source for ${document.slug}`);
    }
    for (const slug of ["guide", "distributions", "architecture", "backend-api"]) {
      const document = DOCUMENTS.find((entry) => entry.slug === slug);
      assert.match(document.sources.zh, /^docs\/zh-CN\/[^/]+\.md$/);
      assert.match(document.sources.en, /^docs\/en\/[^/]+\.md$/);
      assert.doesNotMatch(document.sources.en, /_EN\.md$/);
    }
    assert.equal(DOCUMENTS.find((entry) => entry.slug === "release").sources.zh, "docs/zh-CN/release.md");
    assert.equal(DOCUMENTS.find((entry) => entry.slug === "release").sources.en, "docs/en/release.md");
  });

  it("publishes every document in every locale so language switching never 404s", () => {
    const pages = createPages();
    assert.equal(pages.length, DOCUMENTS.length * LOCALES.length);
    const architecture = pages.find((page) => page.path === "architecture");
    assert.equal(architecture.source, "docs/zh-CN/architecture.md");
    assert.equal(architecture.sourceLocale, "zh");
    assert.equal(architecture.translated, true);
    assert.equal(architecture.canonicalPath, "architecture");
    const contributing = pages.find((page) => page.path === "contributing");
    assert.equal(contributing.source, "docs/zh-CN/contributing.md");
    assert.equal(contributing.sourceLocale, "zh");
    assert.equal(contributing.translated, true);
    assert.equal(contributing.canonicalPath, "contributing");
    const guide = pages.find((page) => page.path === "guide");
    assert.equal(guide.translated, true);
    assert.equal(guide.canonicalPath, "guide");
    assert.ok(pages.every((page) => page.translated));
  });

  it("maps generated pages back to their repository source for edit links", () => {
    const pageByFile = createPageByFile();
    assert.equal(pageByFile["index.md"].source, "README.md");
    assert.equal(pageByFile["en/index.md"].source, "README_EN.md");
    assert.equal(pageByFile["changelog.md"].source, "CHANGELOG.md");
    assert.equal(pageByFile["contributing.md"].source, "docs/zh-CN/contributing.md");
    assert.equal(pageByFile["release.md"].source, "docs/zh-CN/release.md");
    assert.equal(pageByFile["security.md"].source, "docs/zh-CN/security.md");
    assert.equal(pageByFile["en/security.md"].source, "docs/SECURITY.md");
  });

  it("keeps every locale link inside its own locale", () => {
    const architecture = DOCUMENTS.find((document) => document.slug === "architecture");
    assert.equal(linkFor(architecture, "zh"), "/architecture");
    assert.equal(linkFor(architecture, "en"), "/en/architecture");

    const chineseSidebar = createSidebar("zh");
    assert.deepEqual(
      chineseSidebar.map((group) => group.collapsed),
      [false, true, true],
    );
    const sidebar = chineseSidebar.flatMap((group) => group.items);
    const entry = sidebar.find((item) => item.link === "/architecture");
    assert.equal(entry.text, "架构说明");
    assert.ok(sidebar.some((item) => item.link === "/contributing" && item.text === "参与贡献"));
    assert.ok(sidebar.some((item) => item.link === "/guide" && item.text === "详细指南"));
    assert.ok(
      createSidebar("en")
        .flatMap((group) => group.items)
        .every((item) => !item.text.includes("（")),
    );
  });

  it("groups top navigation by documentation section", () => {
    const chinese = createNav("zh");
    assert.deepEqual(
      chinese.map((group) => group.text),
      ["快速开始", "指南与参考", "项目信息"],
    );
    assert.deepEqual(
      chinese.map((group) => group.items.map((item) => item.link)),
      [
        ["/", "/guide"],
        ["/distributions", "/architecture", "/backend-api", "/changelog"],
        ["/contributing", "/release", "/security"],
      ],
    );
    assert.equal(chinese.flatMap((group) => group.items).length, DOCUMENTS.length);

    const english = createNav("en");
    assert.deepEqual(
      english.map((group) => group.text),
      ["Start", "Reference", "Project"],
    );
    assert.ok(english.flatMap((group) => group.items).every((item) => item.link.startsWith("/en/")));
  });

  it("resolves a source document to the reader's locale", () => {
    const resolve = createPathResolver("zh");
    assert.equal(resolve("docs/zh-CN/guide.md"), "guide");
    assert.equal(resolve("docs/zh-CN/architecture.md"), "architecture");
    assert.equal(resolve("LICENSE"), undefined);
  });

  it("honours an explicit link to another locale's translation", () => {
    assert.equal(createPathResolver("zh")("README_EN.md"), "en/index");
    assert.equal(createPathResolver("en")("README.md"), "index");
    assert.equal(createPathResolver("zh")("docs/en/architecture.md"), "en/architecture");
    assert.equal(createPathResolver("en")("docs/zh-CN/architecture.md"), "architecture");
    assert.equal(createPathResolver("en")("docs/en/architecture.md"), "en/architecture");
  });

  it("maps page paths onto the published HTML files", () => {
    assert.equal(htmlPathFor("index"), "");
    assert.equal(htmlPathFor("en/index"), "en/");
    assert.equal(htmlPathFor("en/architecture"), "en/architecture.html");
  });

  it("links the localized home page at the locale root", () => {
    const index = DOCUMENTS.find((document) => document.slug === "index");
    assert.equal(linkFor(index, "zh"), "/");
    assert.equal(linkFor(index, "en"), "/en/");
  });
});

describe("theme accessibility labels", () => {
  it("provides complete labels for both supported languages", () => {
    assert.equal(labelsForLanguage("zh-CN").copyCode, "复制代码");
    assert.equal(labelsForLanguage("zh-CN").mainNavigation, "主导航");
    assert.equal(labelsForLanguage("en-US").copyCode, "Copy code");
    assert.equal(labelsForLanguage("en-US").openMobileNavigation, "Open mobile navigation");
  });

  it("removes the redundant sidebar caret from the accessibility order", () => {
    const attributes = new Map([
      ["aria-label", "toggle section"],
      ["role", "button"],
      ["tabindex", "0"],
    ]);
    const section = { classList: { contains: (name) => name === "collapsed" } };
    const rowAttributes = new Map([["role", "button"]]);
    let expandedWrites = 0;
    const row = {
      classList: section.classList,
      getAttribute: (name) => rowAttributes.get(name),
      parentElement: section,
      setAttribute: (name, value) => {
        if (name === "aria-expanded") expandedWrites += 1;
        rowAttributes.set(name, value);
      },
    };
    const caret = {
      parentElement: row,
      removeAttribute: (name) => attributes.delete(name),
      setAttribute: (name, value) => attributes.set(name, value),
    };

    configureSidebarCaret(caret, "Expand or collapse section");
    configureSidebarCaret(caret, "Expand or collapse section");

    assert.equal(attributes.get("aria-hidden"), "true");
    assert.equal(attributes.has("role"), false);
    assert.equal(attributes.has("tabindex"), false);
    assert.equal(attributes.has("aria-label"), false);
    assert.equal(rowAttributes.get("aria-expanded"), "false");
    assert.equal(expandedWrites, 1);
  });

  it("keeps a linked group's caret available as its collapse control", () => {
    const attributes = new Map([
      ["role", "button"],
      ["tabindex", "0"],
    ]);
    const caret = {
      parentElement: { getAttribute: () => undefined },
      removeAttribute: (name) => attributes.delete(name),
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name),
    };

    configureSidebarCaret(caret, "Expand or collapse section");

    assert.equal(attributes.get("aria-label"), "Expand or collapse section");
    assert.equal(attributes.get("role"), "button");
    assert.equal(attributes.get("tabindex"), "0");
    assert.equal(attributes.has("aria-hidden"), false);
  });
});
