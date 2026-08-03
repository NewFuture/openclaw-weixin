import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_LANGUAGE, LANGUAGES, NAV, PAGES } from "../site/config.mjs";
import {
  buildSite,
  createPageIndex,
  createSlugger,
  isTranslated,
  renderMarkdown,
  rewriteLink,
  rewriteMarkdownLinks,
  slugify,
  sourceFor,
  trimDocumentHeader,
} from "./build-site.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pageIndex = createPageIndex();

function linkContext(sourcePath, language, extension = ".html") {
  const entry = pageIndex.bySource.get(sourcePath);
  return { sourcePath, extension, pageIndex, language, currentPage: entry?.page };
}

describe("slugify", () => {
  it("matches the GitHub anchors used by the existing documentation", () => {
    expect(slugify("Custom BotAgent (optional)")).toBe("custom-botagent-optional");
    expect(slugify("安装或替换")).toBe("安装或替换");
    expect(slugify("自定义 BotAgent（可选）")).toBe("自定义-botagent可选");
    expect(slugify("Node.js 22+")).toBe("nodejs-22");
    expect(slugify("snake_case and kebab-case")).toBe("snake_case-and-kebab-case");
  });

  it("numbers repeated headings like GitHub does", () => {
    const slug = createSlugger();
    expect(slug("Usage")).toBe("usage");
    expect(slug("Usage")).toBe("usage-1");
    expect(slug("Usage")).toBe("usage-2");
    expect(slug("!!!")).toBe("section");
  });
});

describe("createPageIndex", () => {
  it("maps every configured source and alias to a page and language", () => {
    expect(pageIndex.bySource.get("README.md")).toMatchObject({ language: "zh" });
    expect(pageIndex.bySource.get("README_EN.md")).toMatchObject({ language: "en" });
    expect(pageIndex.bySource.get("README.zh_CN.md")).toMatchObject({ language: "zh" });
    expect(pageIndex.bySource.get("README.md").page.id).toBe("index");
    expect(pageIndex.bySource.get("README.zh_CN.md").page.id).toBe("index");
  });

  it("falls back to the default language source for untranslated pages", () => {
    const architecture = pageIndex.byId.get("architecture");
    expect(sourceFor(architecture, "zh")).toBe(architecture.sources[DEFAULT_LANGUAGE]);
    expect(isTranslated(architecture, DEFAULT_LANGUAGE)).toBe(true);
    expect(isTranslated(architecture, "zh")).toBe(false);
  });
});

describe("rewriteLink", () => {
  it("keeps links inside the language the reader picked", () => {
    expect(rewriteLink("docs/guide.zh_CN.md", linkContext("README.md", "zh"))).toBe("./guide.html");
    expect(rewriteLink("./backend-api.md", linkContext("docs/guide.md", "en"))).toBe("./backend-api.html");
    expect(rewriteLink("../CHANGELOG_EN.md#unreleased", linkContext("docs/guide.md", "en"))).toBe(
      "./changelog.html#unreleased",
    );
  });

  it("sends the same page in another language to the other language tree", () => {
    expect(rewriteLink("README_EN.md", linkContext("README.md", "zh"))).toBe("../en/index.html");
    expect(rewriteLink("README.md", linkContext("README_EN.md", "en"))).toBe("../zh/index.html");
    expect(rewriteLink("guide.zh_CN.md", linkContext("docs/guide.md", "en", ".md"))).toBe("../zh/guide.md");
  });

  it("falls back to the repository for files that are not part of the site", () => {
    expect(rewriteLink("package.json", linkContext("README.md", "zh"))).toBe(
      "https://github.com/NewFuture/openclaw-weixin/blob/main/package.json",
    );
    expect(rewriteLink("../LICENSE", linkContext("docs/guide.md", "en"))).toBe(
      "https://github.com/NewFuture/openclaw-weixin/blob/main/LICENSE",
    );
  });

  it("leaves anchors and absolute links untouched", () => {
    const context = linkContext("README.md", "zh");
    expect(rewriteLink("#安装或替换", context)).toBe("#安装或替换");
    expect(rewriteLink("https://example.com/docs", context)).toBe("https://example.com/docs");
    expect(rewriteLink("mailto:nobody@example.com", context)).toBe("mailto:nobody@example.com");
    expect(rewriteLink("//example.com/x", context)).toBe("//example.com/x");
  });
});

describe("rewriteMarkdownLinks", () => {
  it("rewrites prose links but never touches fenced code blocks", () => {
    const markdown = [
      "See [the guide](docs/guide.md).",
      "",
      "```md",
      "[the guide](docs/guide.md)",
      "```",
      "",
      "~~~text",
      "[the guide](docs/guide.md)",
      "~~~",
      "",
      "Also [changelog](CHANGELOG_EN.md).",
    ].join("\n");
    const rewritten = rewriteMarkdownLinks(markdown, linkContext("README_EN.md", "en", ".md"));
    expect(rewritten).toContain("See [the guide](./guide.md).");
    expect(rewritten).toContain("Also [changelog](./changelog.md).");
    expect(rewritten.split("\n").filter((line) => line === "[the guide](docs/guide.md)")).toHaveLength(2);
  });
});

describe("trimDocumentHeader", () => {
  it("drops the title and the language navigation line", () => {
    const { html } = renderMarkdown(
      ["# openclaw-weixin", "", "[English](README_EN.md) | [简体中文](README.md)", "", "## Install", "", "Body."].join(
        "\n",
      ),
      { ...linkContext("README.md", "zh"), strings: { copy: "复制", copied: "已复制", copyCode: "复制代码" } },
    );
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("../en/index.html");
    expect(html).toContain('id="install"');
    expect(html).toContain("Body.");
  });

  it("keeps a paragraph that is more than a navigation line", () => {
    const tokens = [
      { type: "heading", depth: 1, tokens: [] },
      { type: "paragraph", tokens: [{ type: "text", text: "Read " }, { type: "link" }] },
    ];
    expect(trimDocumentHeader(tokens)).toHaveLength(1);
  });
});

describe("renderMarkdown", () => {
  it("adds heading anchors, code block controls and table wrappers", () => {
    const { html, headings } = renderMarkdown(
      ["## Setup", "", "| a | b |", "| - | - |", "| 1 | 2 |", "", "```bash", "echo '<hi>'", "```"].join("\n"),
      { ...linkContext("docs/guide.md", "en"), strings: { copy: "Copy", copied: "Copied", copyCode: "Copy code" } },
    );
    expect(headings).toEqual([{ id: "setup", depth: 2, text: "Setup" }]);
    expect(html).toContain('<a class="heading-anchor" href="#setup"');
    expect(html).toContain('<div class="table-wrap">');
    expect(html).toContain('data-language="bash"');
    expect(html).toContain("echo &#39;&lt;hi&gt;&#39;");
  });
});

describe("buildSite", () => {
  let outDir;
  let result;

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), "openclaw-weixin-site-"));
    result = await buildSite({
      repoRoot: REPO_ROOT,
      outDir,
      baseUrl: "https://example.test/openclaw-weixin/",
      now: new Date("2026-01-02T03:04:05.000Z"),
    });
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("emits an HTML and a Markdown copy of every page in every language", async () => {
    expect(result.documents).toHaveLength(PAGES.length * LANGUAGES.length);
    for (const document of result.documents) {
      await expect(stat(path.join(outDir, document.htmlPath))).resolves.toBeDefined();
      await expect(stat(path.join(outDir, document.markdownPath))).resolves.toBeDefined();
    }
    const navigated = NAV.flatMap((group) => group.pages);
    expect(new Set(navigated)).toEqual(new Set(PAGES.map((page) => page.id)));
  });

  it("localises each page and links to the other language", async () => {
    const english = await readFile(path.join(outDir, "en", "index.html"), "utf8");
    const chinese = await readFile(path.join(outDir, "zh", "index.html"), "utf8");
    expect(english).toContain('<html lang="en"');
    expect(chinese).toContain('<html lang="zh-CN"');
    expect(english).toContain('href="../zh/index.html"');
    expect(chinese).toContain('href="../en/index.html"');
    expect(english).toContain('<link rel="canonical" href="https://example.test/openclaw-weixin/en/index.html" />');
    expect(english).toContain('hreflang="x-default"');
  });

  it("marks untranslated pages instead of pretending they are translated", async () => {
    const chinese = await readFile(path.join(outDir, "zh", "architecture.html"), "utf8");
    expect(chinese).toContain("暂无中文翻译");
    expect(result.documents.find((item) => item.language === "zh" && item.slug === "architecture").translated).toBe(
      false,
    );
  });

  it("rewrites relative links in the Markdown copies", async () => {
    const markdown = await readFile(path.join(outDir, "zh", "index.md"), "utf8");
    expect(markdown).toContain("../en/index.md");
    expect(markdown).not.toContain("](docs/guide.zh_CN.md)");
    expect(markdown).toContain("](./guide.md)");
  });

  it("detects the browser language from the root entry page", async () => {
    const root = await readFile(path.join(outDir, "index.html"), "utf8");
    expect(root).toContain("navigator.languages");
    for (const language of LANGUAGES) {
      expect(root).toContain(`./${language.id}/`);
    }
    expect(root).toContain(`./${DEFAULT_LANGUAGE}/`);
  });

  it("publishes an llms.txt index of every Markdown document", async () => {
    const llms = await readFile(path.join(outDir, "llms.txt"), "utf8");
    expect(llms.startsWith("# openclaw-weixin\n")).toBe(true);
    expect(llms).toContain(`- Version: ${result.version}`);
    expect(llms).toContain("- Generated: 2026-01-02T03:04:05.000Z");
    expect(llms).toContain("https://example.test/openclaw-weixin/llms-full.txt");
    for (const document of result.documents) {
      expect(llms).toContain(`(https://example.test/openclaw-weixin/${document.markdownPath})`);
    }
    expect(llms).toContain("(English source, not translated yet)");

    const full = await readFile(path.join(outDir, "llms-full.txt"), "utf8");
    expect(full).toContain("<!-- source: README_EN.md | language: en |");
    expect(full).toContain("https://example.test/openclaw-weixin/llms.txt");
  });

  it("publishes the supporting files GitHub Pages needs", async () => {
    const sitemap = await readFile(path.join(outDir, "sitemap.xml"), "utf8");
    const robots = await readFile(path.join(outDir, "robots.txt"), "utf8");
    expect(sitemap).toContain("<loc>https://example.test/openclaw-weixin/en/index.html</loc>");
    expect(robots).toContain("Sitemap: https://example.test/openclaw-weixin/sitemap.xml");
    await expect(stat(path.join(outDir, ".nojekyll"))).resolves.toBeDefined();
    await expect(stat(path.join(outDir, "404.html"))).resolves.toBeDefined();
    await expect(stat(path.join(outDir, "assets", "styles.css"))).resolves.toBeDefined();
    await expect(stat(path.join(outDir, "assets", "app.js"))).resolves.toBeDefined();
    for (const language of LANGUAGES) {
      const search = JSON.parse(await readFile(path.join(outDir, "assets", `search-${language.id}.json`), "utf8"));
      expect(search.entries.length).toBeGreaterThan(PAGES.length);
      expect(search.entries.every((entry) => entry.u.endsWith(".html") || entry.u.includes(".html#"))).toBe(
        true,
      );
    }
  });
});
