#!/usr/bin/env node
/**
 * Build the static documentation website from the repository Markdown sources.
 *
 * Every page is emitted twice: as HTML for humans and as Markdown for machines,
 * once per supported language. The build also emits `llms.txt` and
 * `llms-full.txt` so that language models can discover the latest index.
 *
 * Usage: node docs/site/build.mjs [--out <dir>] [--base-url <url>]
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Marked } from "marked";

const SITE = {
  name: "openclaw-weixin",
  repositoryUrl: "https://github.com/NewFuture/openclaw-weixin",
  npmUrl: "https://www.npmjs.com/package/openclaw-weixin",
  upstreamUrl: "https://github.com/Tencent/openclaw-weixin",
  defaultBaseUrl: "https://newfuture.github.io/openclaw-weixin",
  defaultBranch: "main",
};

/**
 * Supported site languages. The first entry is the fallback used for pages that
 * have no translated source file and for browsers that request an unknown
 * language.
 */
const LANGUAGES = [
  { id: "en", htmlLang: "en", label: "English", shortLabel: "EN" },
  { id: "zh", htmlLang: "zh-CN", label: "简体中文", shortLabel: "中文" },
];

const DEFAULT_LANGUAGE = LANGUAGES[0].id;

/**
 * Documentation pages. `sources` maps a language to a repository-relative
 * Markdown file; a missing language falls back to the default language and the
 * page is marked as untranslated.
 */
const PAGES = [
  {
    id: "index",
    slug: "index",
    hero: true,
    sources: { en: "README_EN.md", zh: "README.md" },
    title: { en: "Overview", zh: "概览" },
    description: {
      en: "Install the community-maintained WeChat channel plugin for OpenClaw and bind one or more accounts.",
      zh: "安装社区维护的 OpenClaw 微信渠道插件，并绑定一个或多个微信账号。",
    },
  },
  {
    id: "guide",
    slug: "guide",
    sources: { en: "docs/guide.md", zh: "docs/guide.zh_CN.md" },
    title: { en: "Detailed Guide", zh: "详细指南" },
    description: {
      en: "Installation behavior, custom BotAgent, uninstall, and troubleshooting.",
      zh: "安装行为、自定义 BotAgent、卸载与故障排查。",
    },
  },
  {
    id: "architecture",
    slug: "architecture",
    sources: { en: "docs/architecture.md" },
    title: { en: "Architecture", zh: "架构说明" },
    description: {
      en: "Component map, plugin lifecycle, inbound and outbound flows, and persistent state.",
      zh: "组件划分、插件生命周期、收发消息流程与持久化状态。",
    },
  },
  {
    id: "backend-api",
    slug: "backend-api",
    sources: { en: "docs/backend-api.md", zh: "docs/backend-api.zh_CN.md" },
    title: { en: "Backend API Protocol", zh: "后端 API 协议" },
    description: {
      en: "Every Weixin backend endpoint used for QR login, lifecycle, messages, and media.",
      zh: "插件用于扫码登录、生命周期、消息与媒体的全部微信后端接口。",
    },
  },
  {
    id: "changelog",
    slug: "changelog",
    sources: { en: "CHANGELOG_EN.md", zh: "CHANGELOG.md" },
    title: { en: "Changelog", zh: "变更日志" },
    description: {
      en: "Released versions and user-visible changes.",
      zh: "已发布版本与用户可见的变更。",
    },
  },
  {
    id: "contributing",
    slug: "contributing",
    sources: { en: "CONTRIBUTING.md" },
    title: { en: "Contributing", zh: "参与贡献" },
    description: {
      en: "Prerequisites, local development commands, and pull request expectations.",
      zh: "环境要求、本地开发命令与提交 Pull Request 的要求。",
    },
  },
  {
    id: "agents",
    slug: "agents",
    sources: { en: "AGENTS.md" },
    title: { en: "Coding Agent Guide", zh: "编码智能体指南" },
    description: {
      en: "Repository invariants, module map, validation ladder, and definition of done.",
      zh: "仓库约束、模块地图、验证流程与完成标准。",
    },
  },
  {
    id: "release",
    slug: "release",
    sources: { en: "RELEASE.md" },
    title: { en: "Release Process", zh: "发布流程" },
    description: {
      en: "How npmjs, GitHub Packages, and GitHub Releases are published together.",
      zh: "npmjs、GitHub Packages 与 GitHub Release 的协同发布流程。",
    },
  },
  {
    id: "security",
    slug: "security",
    sources: { en: "SECURITY.md" },
    title: { en: "Security Policy", zh: "安全策略" },
    description: {
      en: "Supported versions and how to report a vulnerability privately.",
      zh: "受支持的版本以及如何私下报告安全漏洞。",
    },
  },
];

/** Sidebar grouping. Every page id must appear exactly once. */
const NAV = [
  { id: "start", title: { en: "Getting Started", zh: "快速开始" }, pages: ["index", "guide"] },
  { id: "reference", title: { en: "Reference", zh: "参考文档" }, pages: ["architecture", "backend-api", "changelog"] },
  { id: "project", title: { en: "Project", zh: "项目信息" }, pages: ["contributing", "agents", "release", "security"] },
];

/**
 * Extra repository paths that should resolve to a page when rewriting links.
 * Every path listed in `PAGES[].sources` is registered automatically.
 */
const SOURCE_ALIASES = {
  "README.zh_CN.md": { page: "index", language: "zh" },
};

/** Interface strings, one entry per supported language. */
const UI = {
  en: {
    tagline: "Community-maintained OpenClaw WeChat channel plugin",
    heroSummary:
      "Connect OpenClaw with WeChat: one-command install, in-place replacement, QR login, and multi-account support.",
    heroPrimary: "Get started",
    heroSecondary: "Detailed guide",
    documentation: "Documentation",
    skipToContent: "Skip to content",
    menu: "Menu",
    language: "Language",
    theme: "Theme",
    search: "Search",
    searchPlaceholder: "Search documentation",
    searchEmpty: "No matching sections.",
    onThisPage: "On this page",
    previous: "Previous",
    next: "Next",
    viewMarkdown: "View Markdown",
    editOnGitHub: "Edit on GitHub",
    copy: "Copy",
    copied: "Copied",
    copyCode: "Copy code",
    alerts: { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" },
    untranslated: "This page has no Chinese translation yet, so the English source is shown.",
    footerLicense: "Released under the MIT License.",
    footerSource: "Generated from the repository Markdown sources.",
    footerLlms: "Machine-readable index",
    notFoundTitle: "Page not found",
    notFoundBody: "The page you requested does not exist. Try the documentation home page.",
    notFoundAction: "Go to documentation",
    redirectBody: "Choose a language",
    llmsSummary:
      "Community-maintained OpenClaw WeChat (Weixin) channel plugin. This index lists the Markdown source of every documentation page in English and Simplified Chinese.",
  },
  zh: {
    tagline: "社区维护的 OpenClaw 微信渠道插件",
    heroSummary: "连接 OpenClaw 与微信：一行命令安装、原位替换、扫码登录，并支持多账号。",
    heroPrimary: "快速开始",
    heroSecondary: "详细指南",
    documentation: "文档",
    skipToContent: "跳到主要内容",
    menu: "目录",
    language: "语言",
    theme: "主题",
    search: "搜索",
    searchPlaceholder: "搜索文档",
    searchEmpty: "没有匹配的章节。",
    onThisPage: "本页目录",
    previous: "上一页",
    next: "下一页",
    viewMarkdown: "查看 Markdown",
    editOnGitHub: "在 GitHub 上编辑",
    copy: "复制",
    copied: "已复制",
    copyCode: "复制代码",
    alerts: { note: "注意", tip: "提示", important: "重要", warning: "警告", caution: "小心" },
    untranslated: "本页暂无中文翻译，以下为英文原文。",
    footerLicense: "基于 MIT 许可证发布。",
    footerSource: "由仓库中的 Markdown 源文件生成。",
    footerLlms: "机器可读索引",
    notFoundTitle: "页面不存在",
    notFoundBody: "请求的页面不存在，请返回文档首页。",
    notFoundAction: "前往文档首页",
    redirectBody: "请选择语言",
    llmsSummary: "社区维护的 OpenClaw 微信渠道插件。本索引列出全部文档页面的 Markdown 源文件，包含英文与简体中文。",
  },
};

/** Static files copied verbatim into `<out>/assets/`. */
const ASSETS = ["style.css", "app.js", "logo.svg"];

const SITE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SITE_DIR, "..", "..");
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const EXTERNAL_LINK = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/** Slugify a heading the way GitHub does, so existing `#anchor` links keep working. */
function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, (character) => (character === "-" || character === "_" ? character : ""))
    .replace(/\s+/g, "-");
}

function createSlugger() {
  const seen = new Map();
  return (text) => {
    const base = slugify(text) || "section";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

function plainText(tokens) {
  if (!Array.isArray(tokens)) return "";
  return tokens
    .map((token) => {
      if (token.type === "text" || token.type === "codespan" || token.type === "escape") return token.text ?? "";
      if (Array.isArray(token.tokens)) return plainText(token.tokens);
      return token.raw ?? "";
    })
    .join("");
}

/** Map every known repository Markdown path to the page and language it belongs to. */
function createPageIndex(pages = PAGES, aliases = SOURCE_ALIASES) {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const bySource = new Map();
  for (const page of pages) {
    for (const [language, source] of Object.entries(page.sources)) {
      bySource.set(source, { page, language });
    }
  }
  for (const [source, alias] of Object.entries(aliases)) {
    const page = byId.get(alias.page);
    if (page) bySource.set(source, { page, language: alias.language });
  }
  return { byId, bySource };
}

function sourceFor(page, language) {
  return page.sources[language] ?? page.sources[DEFAULT_LANGUAGE];
}

function isTranslated(page, language) {
  return Boolean(page.sources[language]);
}

function splitTarget(href) {
  const hashIndex = href.indexOf("#");
  if (hashIndex < 0) return { target: href, hash: "" };
  return { target: href.slice(0, hashIndex), hash: href.slice(hashIndex) };
}

/**
 * Rewrite a repository-relative link so that it points at the generated site.
 *
 * Links stay inside the language the reader picked. The only exception is a
 * "read this page in the other language" link, which is what the Markdown
 * sources use at the top of each document. Links that leave the documentation
 * set fall back to the repository on GitHub.
 */
function rewriteLink(href, { sourcePath, extension, pageIndex, language, currentPage }) {
  if (!href || href.startsWith("#") || EXTERNAL_LINK.test(href)) return href;
  const { target, hash } = splitTarget(href);
  if (!target) return href;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), target));
  const entry = pageIndex.bySource.get(resolved);
  if (!entry) return `${SITE.repositoryUrl}/blob/${SITE.defaultBranch}/${resolved}${hash}`;
  const translation = entry.language && entry.language !== language && entry.page.id === currentPage?.id;
  if (translation) return `../${entry.language}/${entry.page.slug}${extension}${hash}`;
  return `./${entry.page.slug}${extension}${hash}`;
}

/** Rewrite inline Markdown links outside fenced code blocks. */
function rewriteMarkdownLinks(markdown, context) {
  const fence = /^(\s*)(`{3,}|~{3,})/;
  let openFence = null;
  return markdown
    .split("\n")
    .map((line) => {
      const match = fence.exec(line);
      if (match) {
        const marker = match[2][0];
        if (openFence === null) openFence = marker;
        else if (openFence === marker) openFence = null;
        return line;
      }
      if (openFence !== null) return line;
      return line.replace(/(\]\()([^()\s]+)(\))/g, (_whole, open, href, close) => {
        const rewritten = rewriteLink(href, context);
        return `${open}${rewritten}${close}`;
      });
    })
    .join("\n");
}

function isNavigationParagraph(token) {
  if (token?.type !== "paragraph" || !Array.isArray(token.tokens)) return false;
  let links = 0;
  for (const child of token.tokens) {
    if (child.type === "link") {
      links += 1;
      continue;
    }
    if (child.type === "space") continue;
    if (child.type === "text" && /^[\s|·,，、/]*$/.test(child.text ?? "")) continue;
    return false;
  }
  return links > 0;
}

/** Drop the leading H1 and the "back to README | other language" navigation line. */
function trimDocumentHeader(tokens) {
  const trimmed = [...tokens];
  while (trimmed.length > 0 && trimmed[0].type === "space") trimmed.shift();
  if (trimmed[0]?.type === "heading" && trimmed[0].depth === 1) trimmed.shift();
  while (trimmed.length > 0 && trimmed[0].type === "space") trimmed.shift();
  if (isNavigationParagraph(trimmed[0])) {
    trimmed.shift();
    while (trimmed.length > 0 && trimmed[0].type === "space") trimmed.shift();
  }
  return trimmed;
}

const ALERT_TYPES = new Set(["note", "tip", "important", "warning", "caution"]);
const ALERT_MARKER = /^\[!([a-z]+)\][^\S\n]*\n?/i;

/**
 * Detect a GitHub alert blockquote (`> [!WARNING]`) and remove its marker.
 *
 * Returns the alert type, or `null` when the blockquote is an ordinary quote.
 */
function extractAlert(token) {
  if (token?.type !== "blockquote") return null;
  const paragraph = token.tokens?.[0];
  if (paragraph?.type !== "paragraph" || !Array.isArray(paragraph.tokens)) return null;
  const first = paragraph.tokens[0];
  if (first?.type !== "text" || typeof first.text !== "string") return null;
  const match = ALERT_MARKER.exec(first.text);
  if (!match) return null;
  const type = match[1].toLowerCase();
  if (!ALERT_TYPES.has(type)) return null;
  first.text = first.text.slice(match[0].length);
  first.raw = first.text;
  if (!first.text) paragraph.tokens.shift();
  if (paragraph.tokens.length === 0) token.tokens.shift();
  return type;
}

function renderCodeBlock(token, strings) {
  const language = (token.lang ?? "").split(/\s+/)[0];
  const label = language ? escapeHtml(language) : "";
  const languageClass = language ? ` class="language-${escapeHtml(language)}"` : "";
  const header = label ? `<span class="code-lang">${label}</span>` : "";
  return [
    `<div class="code-block" data-language="${label}">`,
    `<div class="code-head">${header}<button class="code-copy" type="button" data-copy`,
    ` data-copy-label="${escapeHtml(strings.copy)}" data-copied-label="${escapeHtml(strings.copied)}"`,
    ` aria-label="${escapeHtml(strings.copyCode)}">${escapeHtml(strings.copy)}</button></div>`,
    `<pre><code${languageClass}>${escapeHtml(token.text)}\n</code></pre>`,
    "</div>\n",
  ].join("");
}

/** Render one Markdown document to HTML and collect its heading outline. */
function renderMarkdown(markdown, { sourcePath, pageIndex, strings, language, currentPage }) {
  const headings = [];
  const slug = createSlugger();
  const renderer = {
    heading(token) {
      const text = plainText(token.tokens);
      const id = slug(text);
      if (token.depth >= 2 && token.depth <= 3) headings.push({ id, depth: token.depth, text });
      const content = this.parser.parseInline(token.tokens);
      return [
        `<h${token.depth} id="${escapeHtml(id)}">`,
        `<a class="heading-anchor" href="#${escapeHtml(id)}" aria-hidden="true" tabindex="-1">#</a>`,
        `${content}</h${token.depth}>\n`,
      ].join("");
    },
    code(token) {
      return renderCodeBlock(token, strings);
    },
    blockquote(token) {
      const body = this.parser.parse(token.tokens);
      if (!token.alertType) return `<blockquote>\n${body}</blockquote>\n`;
      const label = strings.alerts?.[token.alertType] ?? token.alertType;
      return [
        `<blockquote class="alert alert-${token.alertType}">`,
        `<p class="alert-title">${escapeHtml(label)}</p>\n`,
        body,
        "</blockquote>\n",
      ].join("");
    },
  };
  const instance = new Marked({ gfm: true, breaks: false }, { renderer });
  const tokens = trimDocumentHeader(instance.lexer(markdown));
  for (const token of walkAllTokens(tokens)) {
    if (token.type === "blockquote") token.alertType = extractAlert(token);
    if (token.type === "link" || token.type === "image") {
      token.href = rewriteLink(token.href, { sourcePath, extension: ".html", pageIndex, language, currentPage });
    }
  }
  const html = instance
    .parser(tokens)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");
  return { html, headings };
}

function* walkAllTokens(tokens) {
  for (const token of tokens ?? []) {
    yield token;
    if (Array.isArray(token.tokens)) yield* walkAllTokens(token.tokens);
    if (Array.isArray(token.items)) yield* walkAllTokens(token.items);
    if (Array.isArray(token.rows)) {
      for (const row of token.rows) yield* walkAllTokens(row);
    }
    if (Array.isArray(token.header)) yield* walkAllTokens(token.header);
  }
}

function relativeAsset(depth, file) {
  return `${"../".repeat(depth)}assets/${file}`;
}

function renderNav(language, currentPageId, pageIndex) {
  const groups = NAV.map((group) => {
    const items = group.pages
      .map((pageId) => pageIndex.byId.get(pageId))
      .filter(Boolean)
      .map((page) => {
        const current = page.id === currentPageId;
        const ariaCurrent = current ? ' aria-current="page"' : "";
        const className = current ? ' class="nav-link is-current"' : ' class="nav-link"';
        return `<li><a href="./${page.slug}.html"${className}${ariaCurrent}>${escapeHtml(page.title[language])}</a></li>`;
      })
      .join("");
    return [
      '<div class="nav-group">',
      `<p class="nav-title">${escapeHtml(group.title[language])}</p>`,
      `<ul>${items}</ul>`,
      "</div>",
    ].join("");
  }).join("");
  return `<nav class="nav" aria-label="${escapeHtml(UI[language].documentation)}">${groups}</nav>`;
}

function renderToc(headings, strings) {
  if (headings.length === 0) return "";
  const items = headings
    .map(
      (heading) =>
        `<li class="toc-h${heading.depth}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join("");
  return [
    `<aside class="toc" aria-label="${escapeHtml(strings.onThisPage)}">`,
    `<p class="toc-title">${escapeHtml(strings.onThisPage)}</p>`,
    `<ul>${items}</ul>`,
    "</aside>",
  ].join("");
}

function renderLanguageSwitch(language, page, strings) {
  const options = LANGUAGES.map((entry) => {
    const current = entry.id === language;
    const href = `../${entry.id}/${page.slug}.html`;
    const className = current ? "lang-link is-current" : "lang-link";
    const ariaCurrent = current ? ' aria-current="true"' : "";
    return [
      `<a class="${className}" href="${href}" hreflang="${entry.htmlLang}" data-lang="${entry.id}"`,
      `${ariaCurrent} lang="${entry.htmlLang}">${escapeHtml(entry.shortLabel)}</a>`,
    ].join("");
  }).join("");
  return `<div class="lang-switch" role="group" aria-label="${escapeHtml(strings.language)}">${options}</div>`;
}

function renderHero(strings, version, anchorId) {
  const primaryHref = anchorId ? `#${encodeURIComponent(anchorId)}` : "./guide.html";
  return [
    '<section class="hero">',
    `<p class="hero-eyebrow">v${escapeHtml(version)} · npm <code>openclaw-weixin</code></p>`,
    `<h1 class="hero-title">${escapeHtml(SITE.name)}</h1>`,
    `<p class="hero-tagline">${escapeHtml(strings.tagline)}</p>`,
    `<p class="hero-summary">${escapeHtml(strings.heroSummary)}</p>`,
    '<p class="hero-actions">',
    `<a class="button button-primary" href="${escapeHtml(primaryHref)}">${escapeHtml(strings.heroPrimary)}</a>`,
    `<a class="button" href="./guide.html">${escapeHtml(strings.heroSecondary)}</a>`,
    `<a class="button button-ghost" href="${SITE.repositoryUrl}">GitHub</a>`,
    "</p>",
    "</section>",
  ].join("");
}

function renderDocumentHead({ language, title, description, canonical, alternates, depth, pageId }) {
  const entry = LANGUAGES.find((item) => item.id === language);
  const alternateTags = alternates
    .map((item) => `<link rel="alternate" hreflang="${item.hreflang}" href="${escapeHtml(item.href)}" />`)
    .join("\n    ");
  return [
    "<!doctype html>",
    `<html lang="${entry.htmlLang}" data-page="${escapeHtml(pageId)}" data-site-lang="${language}">`,
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <title>${escapeHtml(title)}</title>`,
    `    <meta name="description" content="${escapeHtml(description)}" />`,
    `    <meta property="og:title" content="${escapeHtml(title)}" />`,
    `    <meta property="og:description" content="${escapeHtml(description)}" />`,
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:url" content="${escapeHtml(canonical)}" />`,
    '    <meta name="color-scheme" content="light dark" />',
    `    <link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `    ${alternateTags}`,
    `    <link rel="icon" href="${relativeAsset(depth, "logo.svg")}" type="image/svg+xml" />`,
    `    <link rel="stylesheet" href="${relativeAsset(depth, "style.css")}" />`,
    "    <script>",
    "      (function () {",
    "        try {",
    '          var stored = localStorage.getItem("openclaw-weixin:theme");',
    '          if (stored === "light" || stored === "dark") {',
    "            document.documentElement.dataset.theme = stored;",
    "          }",
    "        } catch (error) {}",
    "      })();",
    "    </script>",
    "  </head>",
  ].join("\n");
}

function renderTopbar({ language, strings, page, depth }) {
  const home = `${"../".repeat(depth)}${language}/index.html`;
  return [
    '<header class="topbar">',
    '<button class="icon-button menu-toggle" type="button" data-menu-toggle aria-expanded="false"',
    ` aria-controls="sidebar" aria-label="${escapeHtml(strings.menu)}"><span class="menu-icon"></span></button>`,
    `<a class="brand" href="${home}"><img class="brand-mark" src="${relativeAsset(depth, "logo.svg")}" alt="" width="26" height="26" />`,
    `<span class="brand-name">${escapeHtml(SITE.name)}</span></a>`,
    '<div class="topbar-search">',
    `<input class="search-input" type="search" data-search placeholder="${escapeHtml(strings.searchPlaceholder)}"`,
    ` aria-label="${escapeHtml(strings.search)}" autocomplete="off" />`,
    `<div class="search-results" data-search-results hidden role="listbox"`,
    ` data-empty="${escapeHtml(strings.searchEmpty)}"></div>`,
    "</div>",
    '<div class="topbar-actions">',
    page ? renderLanguageSwitch(language, page, strings) : "",
    `<button class="icon-button" type="button" data-theme-toggle aria-label="${escapeHtml(strings.theme)}"`,
    ` title="${escapeHtml(strings.theme)}"><span class="theme-icon" aria-hidden="true"></span></button>`,
    `<a class="icon-button" href="${SITE.repositoryUrl}" aria-label="GitHub" title="GitHub">`,
    '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.19c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"/></svg>',
    "</a>",
    "</div>",
    "</header>",
  ].join("");
}

function renderFooter({ strings, depth, version, generatedAt }) {
  const llms = `${"../".repeat(depth)}llms.txt`;
  return [
    '<footer class="site-footer">',
    `<p>${escapeHtml(strings.footerLicense)} ${escapeHtml(strings.footerSource)}</p>`,
    "<p>",
    `<a href="${SITE.repositoryUrl}">GitHub</a> · <a href="${SITE.npmUrl}">npm</a> · `,
    `<a href="${llms}">${escapeHtml(strings.footerLlms)}</a> · `,
    `<span>v${escapeHtml(version)} · ${escapeHtml(generatedAt.slice(0, 10))}</span>`,
    "</p>",
    "</footer>",
  ].join("");
}

function renderPageDocument(options) {
  const { language, page, strings, body, headings, siblings, sourcePath, version, generatedAt, canonical, alternates } =
    options;
  const depth = 1;
  const title = page.hero ? `${SITE.name} · ${strings.tagline}` : `${page.title[language]} · ${SITE.name}`;
  const editUrl = `${SITE.repositoryUrl}/blob/${SITE.defaultBranch}/${sourcePath}`;
  const untranslated = isTranslated(page, language)
    ? ""
    : `<p class="callout callout-info">${escapeHtml(strings.untranslated)}</p>`;
  const previous = siblings.previous
    ? `<a class="pager-link" href="./${siblings.previous.slug}.html"><span>${escapeHtml(strings.previous)}</span><strong>${escapeHtml(siblings.previous.title[language])}</strong></a>`
    : "<span></span>";
  const next = siblings.next
    ? `<a class="pager-link pager-next" href="./${siblings.next.slug}.html"><span>${escapeHtml(strings.next)}</span><strong>${escapeHtml(siblings.next.title[language])}</strong></a>`
    : "<span></span>";
  return [
    renderDocumentHead({
      language,
      title,
      description: page.description[language],
      canonical,
      alternates,
      depth,
      pageId: page.id,
    }),
    "  <body>",
    `    <a class="skip-link" href="#main">${escapeHtml(strings.skipToContent)}</a>`,
    `    ${renderTopbar({ language, strings, page, depth })}`,
    '    <div class="layout">',
    `      <div class="sidebar" id="sidebar" data-sidebar>${renderNav(language, page.id, options.pageIndex)}</div>`,
    '      <div class="sidebar-scrim" data-sidebar-scrim hidden></div>',
    '      <main class="content" id="main">',
    '        <article class="markdown">',
    page.hero ? renderHero(strings, version, headings[0]?.id) : "",
    page.hero ? "" : `<h1 class="page-title">${escapeHtml(page.title[language])}</h1>`,
    page.hero ? "" : `<p class="page-lede">${escapeHtml(page.description[language])}</p>`,
    untranslated,
    body,
    "        </article>",
    '        <div class="page-meta">',
    `          <a href="./${page.slug}.md">${escapeHtml(strings.viewMarkdown)}</a>`,
    `          <a href="${editUrl}">${escapeHtml(strings.editOnGitHub)}</a>`,
    "        </div>",
    `        <nav class="pager" aria-label="${escapeHtml(strings.documentation)}">${previous}${next}</nav>`,
    `        ${renderFooter({ strings, depth, version, generatedAt })}`,
    "      </main>",
    `      ${renderToc(headings, strings)}`,
    "    </div>",
    `    <script type="module" src="${relativeAsset(depth, "app.js")}"></script>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function renderRootRedirect({ version, generatedAt }) {
  const links = LANGUAGES.map(
    (entry) =>
      `<a class="button button-primary" href="./${entry.id}/" hreflang="${entry.htmlLang}" lang="${entry.htmlLang}">${escapeHtml(entry.label)}</a>`,
  ).join("");
  const known = JSON.stringify(LANGUAGES.map((entry) => entry.id));
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <title>${escapeHtml(SITE.name)} · ${escapeHtml(UI.en.tagline)}</title>`,
    `    <meta name="description" content="${escapeHtml(UI.en.tagline)}" />`,
    '    <meta name="color-scheme" content="light dark" />',
    `    <link rel="canonical" href="${SITE.defaultBaseUrl}/${DEFAULT_LANGUAGE}/" />`,
    ...LANGUAGES.map((entry) => `    <link rel="alternate" hreflang="${entry.htmlLang}" href="./${entry.id}/" />`),
    `    <link rel="alternate" hreflang="x-default" href="./${DEFAULT_LANGUAGE}/" />`,
    '    <link rel="icon" href="./assets/logo.svg" type="image/svg+xml" />',
    '    <link rel="stylesheet" href="./assets/style.css" />',
    "    <script>",
    "      (function () {",
    `        var supported = ${known};`,
    `        var fallback = ${JSON.stringify(DEFAULT_LANGUAGE)};`,
    "        var choice = null;",
    "        try {",
    '          var stored = localStorage.getItem("openclaw-weixin:lang");',
    "          if (supported.indexOf(stored) >= 0) choice = stored;",
    "        } catch (error) {}",
    "        if (!choice) {",
    "          var wanted = navigator.languages && navigator.languages.length",
    "            ? navigator.languages",
    "            : [navigator.language || fallback];",
    "          for (var index = 0; index < wanted.length && !choice; index += 1) {",
    "            var tag = String(wanted[index]).toLowerCase();",
    "            for (var offset = 0; offset < supported.length; offset += 1) {",
    "              if (tag === supported[offset] || tag.indexOf(supported[offset] + '-') === 0) {",
    "                choice = supported[offset];",
    "                break;",
    "              }",
    "            }",
    "          }",
    "        }",
    '        location.replace("./" + (choice || fallback) + "/");',
    "      })();",
    "    </script>",
    "  </head>",
    '  <body class="standalone">',
    '    <main class="standalone-card">',
    `      <h1>${escapeHtml(SITE.name)}</h1>`,
    `      <p>${escapeHtml(UI.en.redirectBody)} / ${escapeHtml(UI.zh.redirectBody)}</p>`,
    `      <p class="hero-actions">${links}</p>`,
    `      <p class="muted">v${escapeHtml(version)} · ${escapeHtml(generatedAt.slice(0, 10))}</p>`,
    "    </main>",
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function renderNotFound({ basePath }) {
  const prefix = basePath ? `${basePath}/` : "/";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <title>${escapeHtml(UI.en.notFoundTitle)} · ${escapeHtml(SITE.name)}</title>`,
    '    <meta name="robots" content="noindex" />',
    '    <meta name="color-scheme" content="light dark" />',
    `    <link rel="icon" href="${prefix}assets/logo.svg" type="image/svg+xml" />`,
    `    <link rel="stylesheet" href="${prefix}assets/style.css" />`,
    "  </head>",
    '  <body class="standalone">',
    '    <main class="standalone-card">',
    `      <h1>404</h1>`,
    `      <p>${escapeHtml(UI.en.notFoundTitle)} / ${escapeHtml(UI.zh.notFoundTitle)}</p>`,
    `      <p class="muted">${escapeHtml(UI.en.notFoundBody)}</p>`,
    `      <p class="hero-actions"><a class="button button-primary" href="${prefix}">${escapeHtml(UI.en.notFoundAction)}</a></p>`,
    "    </main>",
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function renderLlmsTxt({ baseUrl, version, generatedAt, documents }) {
  const lines = [
    `# ${SITE.name}`,
    "",
    `> ${UI.en.llmsSummary}`,
    "",
    `- Version: ${version}`,
    `- Generated: ${generatedAt}`,
    `- Repository: ${SITE.repositoryUrl}`,
    `- npm: ${SITE.npmUrl}`,
    `- Full text: ${baseUrl}/llms-full.txt`,
    "",
  ];
  for (const language of LANGUAGES) {
    const heading = language.id === DEFAULT_LANGUAGE ? "Docs" : `Docs (${language.label})`;
    lines.push(`## ${heading}`, "");
    for (const document of documents.filter((item) => item.language === language.id)) {
      const note = document.translated ? "" : " (English source, not translated yet)";
      lines.push(`- [${document.title}](${baseUrl}/${document.markdownPath}): ${document.description}${note}`);
    }
    lines.push("");
  }
  lines.push(
    "## Optional",
    "",
    `- [HTML documentation](${baseUrl}/): Same content rendered for humans, with language auto-detection.`,
    `- [Upstream project](${SITE.upstreamUrl}): Original Tencent distribution this package is derived from.`,
    "",
  );
  return lines.join("\n");
}

function renderLlmsFullTxt({ baseUrl, version, generatedAt, documents }) {
  const parts = [
    `# ${SITE.name}`,
    "",
    `> ${UI.en.llmsSummary}`,
    "",
    `- Version: ${version}`,
    `- Generated: ${generatedAt}`,
    `- Index: ${baseUrl}/llms.txt`,
    "",
  ];
  for (const document of documents) {
    parts.push(
      "---",
      "",
      `<!-- source: ${document.sourcePath} | language: ${document.language} | url: ${baseUrl}/${document.markdownPath} -->`,
      "",
      document.markdown.trim(),
      "",
    );
  }
  return parts.join("\n");
}

function renderSitemap({ baseUrl, documents, generatedAt }) {
  const lastmod = generatedAt.slice(0, 10);
  const urls = [`${baseUrl}/`, ...documents.map((document) => `${baseUrl}/${document.htmlPath}`)];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escapeHtml(url)}</loc><lastmod>${lastmod}</lastmod></url>`),
    "</urlset>",
    "",
  ].join("\n");
}

function renderRobots({ baseUrl }) {
  return ["User-agent: *", "Allow: /", "", `Sitemap: ${baseUrl}/sitemap.xml`, ""].join("\n");
}

function buildSearchEntries(documents, language) {
  const entries = [];
  for (const document of documents.filter((item) => item.language === language)) {
    entries.push({
      u: `${document.slug}.html`,
      p: document.title,
      t: document.title,
      s: document.description,
    });
    for (const heading of document.headings) {
      entries.push({ u: `${document.slug}.html#${heading.id}`, p: document.title, t: heading.text, s: "" });
    }
  }
  return entries;
}

function siblingsFor(pageId, orderedPages) {
  const index = orderedPages.findIndex((page) => page.id === pageId);
  return {
    previous: index > 0 ? orderedPages[index - 1] : null,
    next: index >= 0 && index < orderedPages.length - 1 ? orderedPages[index + 1] : null,
  };
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

async function buildSite({
  repoRoot = REPO_ROOT,
  outDir = path.join(SITE_DIR, "dist"),
  baseUrl = process.env.SITE_BASE_URL || SITE.defaultBaseUrl,
  now = new Date(),
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const basePath = normalizeBaseUrl(new URL(`${normalizedBaseUrl}/`).pathname);
  const generatedAt = now.toISOString();
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const version = packageJson.version;
  const pageIndex = createPageIndex();
  const orderedPages = NAV.flatMap((group) => group.pages)
    .map((pageId) => pageIndex.byId.get(pageId))
    .filter(Boolean);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "assets"), { recursive: true });
  for (const asset of ASSETS) {
    await cp(path.join(SITE_DIR, asset), path.join(outDir, "assets", asset));
  }

  const documents = [];
  for (const language of LANGUAGES) {
    const strings = UI[language.id];
    await mkdir(path.join(outDir, language.id), { recursive: true });
    for (const page of orderedPages) {
      const sourcePath = sourceFor(page, language.id);
      const markdown = await readFile(path.join(repoRoot, sourcePath), "utf8");
      const linkContext = { sourcePath, pageIndex, language: language.id, currentPage: page };
      const { html, headings } = renderMarkdown(markdown, { ...linkContext, strings });
      const markdownOut = rewriteMarkdownLinks(markdown, { ...linkContext, extension: ".md" });
      const htmlPath = `${language.id}/${page.slug}.html`;
      const markdownPath = `${language.id}/${page.slug}.md`;
      const alternates = [
        ...LANGUAGES.map((entry) => ({
          hreflang: entry.htmlLang,
          href: `${normalizedBaseUrl}/${entry.id}/${page.slug}.html`,
        })),
        { hreflang: "x-default", href: `${normalizedBaseUrl}/${DEFAULT_LANGUAGE}/${page.slug}.html` },
      ];
      const document = renderPageDocument({
        language: language.id,
        page,
        pageIndex,
        strings,
        body: html,
        headings,
        siblings: siblingsFor(page.id, orderedPages),
        sourcePath,
        version,
        generatedAt,
        canonical: `${normalizedBaseUrl}/${htmlPath}`,
        alternates,
      });
      await writeFile(path.join(outDir, htmlPath), document, "utf8");
      await writeFile(path.join(outDir, markdownPath), `${markdownOut.trimEnd()}\n`, "utf8");
      documents.push({
        language: language.id,
        slug: page.slug,
        title: page.title[language.id],
        description: page.description[language.id],
        translated: isTranslated(page, language.id),
        headings,
        htmlPath,
        markdownPath,
        sourcePath,
        markdown: markdownOut,
      });
    }
    await writeFile(
      path.join(outDir, "assets", `search-${language.id}.json`),
      `${JSON.stringify({ entries: buildSearchEntries(documents, language.id) })}\n`,
      "utf8",
    );
  }

  await writeFile(path.join(outDir, "index.html"), renderRootRedirect({ version, generatedAt }), "utf8");
  await writeFile(path.join(outDir, "404.html"), renderNotFound({ basePath }), "utf8");
  await writeFile(
    path.join(outDir, "llms.txt"),
    renderLlmsTxt({ baseUrl: normalizedBaseUrl, version, generatedAt, documents }),
    "utf8",
  );
  await writeFile(
    path.join(outDir, "llms-full.txt"),
    renderLlmsFullTxt({ baseUrl: normalizedBaseUrl, version, generatedAt, documents }),
    "utf8",
  );
  await writeFile(
    path.join(outDir, "sitemap.xml"),
    renderSitemap({ baseUrl: normalizedBaseUrl, documents, generatedAt }),
    "utf8",
  );
  await writeFile(path.join(outDir, "robots.txt"), renderRobots({ baseUrl: normalizedBaseUrl }), "utf8");
  await writeFile(path.join(outDir, ".nojekyll"), "", "utf8");

  return { outDir, baseUrl: normalizedBaseUrl, documents, version, generatedAt };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out") options.outDir = path.resolve(argv[++index]);
    else if (argument === "--base-url") options.baseUrl = argv[++index];
  }
  return options;
}

const result = await buildSite(parseArguments(process.argv.slice(2)));
console.log(
  `Site built: ${result.documents.length} documents for ${LANGUAGES.length} languages in ${path.relative(REPO_ROOT, result.outDir) || "."}`,
);
