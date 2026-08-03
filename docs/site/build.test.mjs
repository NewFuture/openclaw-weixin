import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Marked } from "marked";

import {
  buildSite,
  createPageIndex,
  createSlugger,
  extractAlert,
  LANGUAGES,
  normalizeBaseUrl,
  PAGES,
  parseArguments,
  rewriteLink,
  rewriteMarkdownLinks,
  siblingsFor,
  slugify,
  trimDocumentHeader,
} from "./build.mjs";

const SITE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SITE_DIR, "..", "..");

function lex(markdown) {
  return new Marked({ gfm: true, breaks: false }).lexer(markdown);
}

function linkContext(overrides = {}) {
  return {
    sourcePath: "README.md",
    extension: ".html",
    pageIndex: createPageIndex(),
    language: "zh",
    currentPage: createPageIndex().byId.get("index"),
    ...overrides,
  };
}

describe("slugify", () => {
  it("matches the GitHub anchor for ASCII headings", () => {
    assert.equal(slugify("Install or replace"), "install-or-replace");
    assert.equal(slugify("Custom BotAgent (optional)"), "custom-botagent-optional");
  });

  it("keeps CJK characters and drops full-width punctuation", () => {
    assert.equal(slugify("安装或替换"), "安装或替换");
    assert.equal(slugify("自定义 BotAgent（可选）"), "自定义-botagent可选");
    assert.equal(slugify("通过 Agent 命令安装"), "通过-agent-命令安装");
  });

  it("preserves hyphens and underscores but removes other symbols", () => {
    assert.equal(slugify("llms.txt and llms-full.txt"), "llmstxt-and-llms-fulltxt");
    assert.equal(slugify("sync_buf state"), "sync_buf-state");
  });
});

describe("createSlugger", () => {
  it("suffixes repeated headings so anchors stay unique", () => {
    const slug = createSlugger();
    assert.equal(slug("Usage"), "usage");
    assert.equal(slug("Usage"), "usage-1");
    assert.equal(slug("Usage"), "usage-2");
  });

  it("falls back to a stable name for headings without slug characters", () => {
    const slug = createSlugger();
    assert.equal(slug("###"), "section");
  });
});

describe("createPageIndex", () => {
  it("registers every configured source and the compatibility alias", () => {
    const pageIndex = createPageIndex();
    for (const page of PAGES) {
      for (const source of Object.values(page.sources)) {
        assert.ok(pageIndex.bySource.has(source), `${source} should resolve to a page`);
      }
    }
    assert.deepEqual(
      {
        page: pageIndex.bySource.get("README.zh_CN.md").page.id,
        language: pageIndex.bySource.get("README.zh_CN.md").language,
      },
      { page: "index", language: "zh" },
    );
  });
});

describe("rewriteLink", () => {
  it("points documentation links at the page in the current language", () => {
    assert.equal(rewriteLink("docs/guide.zh_CN.md", linkContext()), "./guide.html");
    assert.equal(rewriteLink("./docs/backend-api.zh_CN.md", linkContext()), "./backend-api.html");
  });

  it("keeps the anchor and honors the requested extension", () => {
    assert.equal(rewriteLink("docs/guide.zh_CN.md#故障排查", linkContext()), "./guide.html#故障排查");
    assert.equal(rewriteLink("docs/guide.zh_CN.md", linkContext({ extension: ".md" })), "./guide.md");
  });

  it("sends the translation link of the current page to the other language", () => {
    assert.equal(rewriteLink("./README_EN.md", linkContext()), "../en/index.html");
  });

  it("keeps a link to another page inside the current language", () => {
    const pageIndex = createPageIndex();
    const context = linkContext({
      sourcePath: "docs/guide.zh_CN.md",
      language: "zh",
      currentPage: pageIndex.byId.get("guide"),
      pageIndex,
    });
    assert.equal(rewriteLink("../README.md", context), "./index.html");
  });

  it("falls back to GitHub for repository files that are not published pages", () => {
    assert.equal(
      rewriteLink("package.json", linkContext()),
      "https://github.com/NewFuture/openclaw-weixin/blob/main/package.json",
    );
    assert.equal(
      rewriteLink("docs/site/build.mjs#L1", linkContext()),
      "https://github.com/NewFuture/openclaw-weixin/blob/main/docs/site/build.mjs#L1",
    );
  });

  it("leaves external links, anchors, and empty targets untouched", () => {
    assert.equal(rewriteLink("https://example.invalid/a", linkContext()), "https://example.invalid/a");
    assert.equal(rewriteLink("//example.invalid/a", linkContext()), "//example.invalid/a");
    assert.equal(rewriteLink("mailto:nobody@example.invalid", linkContext()), "mailto:nobody@example.invalid");
    assert.equal(rewriteLink("#安装或替换", linkContext()), "#安装或替换");
    assert.equal(rewriteLink("", linkContext()), "");
  });
});

describe("rewriteMarkdownLinks", () => {
  it("rewrites links outside fenced code blocks only", () => {
    const markdown = [
      "See [guide](docs/guide.zh_CN.md).",
      "",
      "```markdown",
      "[guide](docs/guide.zh_CN.md)",
      "```",
      "",
      "~~~text",
      "[guide](docs/guide.zh_CN.md)",
      "~~~",
      "",
      "And [again](docs/guide.zh_CN.md).",
    ].join("\n");
    const rewritten = rewriteMarkdownLinks(markdown, linkContext({ extension: ".md" }));
    const lines = rewritten.split("\n");
    assert.equal(lines[0], "See [guide](./guide.md).");
    assert.equal(lines[3], "[guide](docs/guide.zh_CN.md)");
    assert.equal(lines[7], "[guide](docs/guide.zh_CN.md)");
    assert.equal(lines[10], "And [again](./guide.md).");
  });

  it("does not close a fence opened with a different marker", () => {
    const markdown = ["```text", "~~~", "[guide](docs/guide.zh_CN.md)", "```", "[guide](docs/guide.zh_CN.md)"].join(
      "\n",
    );
    const lines = rewriteMarkdownLinks(markdown, linkContext({ extension: ".md" })).split("\n");
    assert.equal(lines[2], "[guide](docs/guide.zh_CN.md)");
    assert.equal(lines[4], "[guide](./guide.md)");
  });
});

describe("trimDocumentHeader", () => {
  it("drops the title and the language navigation line", () => {
    const tokens = trimDocumentHeader(
      lex("# openclaw-weixin\n\n[English](./README_EN.md) · [文档站点](https://example.invalid/)\n\nBody text.\n"),
    );
    assert.equal(tokens[0].type, "paragraph");
    assert.equal(tokens[0].text, "Body text.");
  });

  it("keeps a leading paragraph that is not a navigation line", () => {
    const tokens = trimDocumentHeader(lex("# Title\n\nThis release adds [the guide](docs/guide.md) and more.\n"));
    assert.equal(tokens[0].type, "paragraph");
    assert.match(tokens[0].text, /^This release adds/);
  });

  it("keeps documents that do not start with a heading", () => {
    const tokens = trimDocumentHeader(lex("Body only.\n"));
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].text, "Body only.");
  });
});

describe("extractAlert", () => {
  it("detects a GitHub alert and removes its marker", () => {
    const [token] = lex("> [!WARNING]\n> Do not uninstall first.\n");
    assert.equal(extractAlert(token), "warning");
    assert.equal(token.tokens[0].tokens[0].text, "Do not uninstall first.");
  });

  it("ignores ordinary blockquotes and unknown markers", () => {
    const [quote] = lex("> Just a quote.\n");
    assert.equal(extractAlert(quote), null);
    const [unknown] = lex("> [!SPONSOR]\n> Not a GitHub alert.\n");
    assert.equal(extractAlert(unknown), null);
  });
});

describe("siblingsFor", () => {
  it("links neighbouring pages and stops at both ends", () => {
    const ordered = [{ id: "a" }, { id: "b" }, { id: "c" }];
    assert.deepEqual(siblingsFor("a", ordered), { previous: null, next: { id: "b" } });
    assert.deepEqual(siblingsFor("b", ordered), { previous: { id: "a" }, next: { id: "c" } });
    assert.deepEqual(siblingsFor("c", ordered), { previous: { id: "b" }, next: null });
  });
});

describe("normalizeBaseUrl", () => {
  it("removes trailing slashes", () => {
    assert.equal(normalizeBaseUrl("https://example.invalid/site///"), "https://example.invalid/site");
    assert.equal(normalizeBaseUrl("https://example.invalid"), "https://example.invalid");
  });
});

describe("parseArguments", () => {
  it("reads the output directory and base URL", () => {
    const options = parseArguments(["--out", "build/site", "--base-url", "https://example.invalid/docs/"]);
    assert.equal(options.outDir, path.resolve("build/site"));
    assert.equal(options.baseUrl, "https://example.invalid/docs/");
  });
});

describe("buildSite", () => {
  let outDir;
  let result;

  before(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), "openclaw-weixin-site-"));
    result = await buildSite({
      repoRoot: REPO_ROOT,
      outDir,
      baseUrl: "https://example.invalid/docs/",
      now: new Date("2026-01-02T03:04:05.000Z"),
    });
  });

  after(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  const read = (relativePath) => readFile(path.join(outDir, relativePath), "utf8");

  it("emits every page as HTML and Markdown in every language", async () => {
    assert.equal(result.documents.length, PAGES.length * LANGUAGES.length);
    for (const document of result.documents) {
      assert.ok((await read(document.htmlPath)).startsWith("<!doctype html>"));
      assert.ok((await read(document.markdownPath)).endsWith("\n"));
    }
  });

  it("writes the supporting files GitHub Pages needs", async () => {
    for (const file of ["index.html", "404.html", ".nojekyll", "robots.txt", "sitemap.xml"]) {
      await read(file);
    }
    for (const asset of ["assets/style.css", "assets/app.js", "assets/logo.svg"]) {
      await read(asset);
    }
    assert.match(await read("robots.txt"), /Sitemap: https:\/\/example\.invalid\/docs\/sitemap\.xml/);
    assert.match(await read("sitemap.xml"), /<lastmod>2026-01-02<\/lastmod>/);
  });

  it("normalizes the base URL in canonical and alternate links", async () => {
    const html = await read("zh/guide.html");
    assert.match(html, /<link rel="canonical" href="https:\/\/example\.invalid\/docs\/zh\/guide\.html" \/>/);
    assert.match(html, /hreflang="en" href="https:\/\/example\.invalid\/docs\/en\/guide\.html"/);
    assert.match(html, /hreflang="x-default" href="https:\/\/example\.invalid\/docs\/en\/guide\.html"/);
    assert.equal(result.baseUrl, "https://example.invalid/docs");
  });

  it("indexes every Markdown document in llms.txt and marks untranslated pages", async () => {
    const llms = await read("llms.txt");
    assert.match(llms, new RegExp(`- Version: ${result.version.replace(/\./g, "\\.")}`));
    assert.match(llms, /- Generated: 2026-01-02T03:04:05\.000Z/);
    for (const document of result.documents) {
      assert.ok(
        llms.includes(`(https://example.invalid/docs/${document.markdownPath})`),
        `${document.markdownPath} should be listed in llms.txt`,
      );
    }
    assert.match(llms, /zh\/architecture\.md\).*\(English source, not translated yet\)/);
    assert.doesNotMatch(llms, /zh\/guide\.md\).*\(English source, not translated yet\)/);
  });

  it("inlines the rewritten Markdown of every document in llms-full.txt", async () => {
    const full = await read("llms-full.txt");
    assert.match(full, /- Index: https:\/\/example\.invalid\/docs\/llms\.txt/);
    for (const document of result.documents) {
      assert.ok(
        full.includes(`<!-- source: ${document.sourcePath} | language: ${document.language} |`),
        `${document.sourcePath} should be inlined for ${document.language}`,
      );
    }
  });

  it("rewrites cross-document links in the generated Markdown", async () => {
    const markdown = await read("zh/index.md");
    assert.ok(markdown.includes("](./guide.md)"));
    assert.ok(markdown.includes("](../en/index.md)"));
    assert.ok(!markdown.includes("](docs/guide.zh_CN.md)"));
  });

  it("publishes a search index per language", async () => {
    for (const language of LANGUAGES) {
      const index = JSON.parse(await read(`assets/search-${language.id}.json`));
      assert.ok(index.entries.length > PAGES.length);
      assert.ok(index.entries.every((entry) => typeof entry.u === "string" && entry.u.endsWith !== undefined));
    }
  });
});
