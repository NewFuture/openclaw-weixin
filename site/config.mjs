/**
 * Static configuration for the documentation website.
 *
 * The site is generated from the Markdown that already lives in the repository,
 * so this file only declares how those files are grouped, translated, and
 * labelled. `scripts/build-site.mjs` consumes it.
 */

export const SITE = {
  name: "openclaw-weixin",
  repository: "NewFuture/openclaw-weixin",
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
export const LANGUAGES = [
  { id: "en", htmlLang: "en", label: "English", shortLabel: "EN" },
  { id: "zh", htmlLang: "zh-CN", label: "简体中文", shortLabel: "中文" },
];

export const DEFAULT_LANGUAGE = LANGUAGES[0].id;

/**
 * Documentation pages. `sources` maps a language to a repository-relative
 * Markdown file; a missing language falls back to the default language and the
 * page is marked as untranslated.
 */
export const PAGES = [
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
export const NAV = [
  {
    id: "start",
    title: { en: "Getting Started", zh: "快速开始" },
    pages: ["index", "guide"],
  },
  {
    id: "reference",
    title: { en: "Reference", zh: "参考文档" },
    pages: ["architecture", "backend-api", "changelog"],
  },
  {
    id: "project",
    title: { en: "Project", zh: "项目信息" },
    pages: ["contributing", "agents", "release", "security"],
  },
];

/**
 * Extra repository paths that should resolve to a page when rewriting links.
 * Every path listed in `PAGES[].sources` is registered automatically.
 */
export const SOURCE_ALIASES = {
  "README.zh_CN.md": { page: "index", language: "zh" },
};

/** Interface strings, one entry per supported language. */
export const UI = {
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
    diagram: "Diagram",
    untranslated: "This page has no Chinese translation yet, so the English source is shown.",
    footerLicense: "Released under the MIT License.",
    footerSource: "Generated from the repository Markdown sources.",
    footerLlms: "Machine-readable index",
    notFoundTitle: "Page not found",
    notFoundBody: "The page you requested does not exist. Try the documentation home page.",
    notFoundAction: "Go to documentation",
    redirectTitle: "Redirecting…",
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
    diagram: "图表",
    untranslated: "本页暂无中文翻译，以下为英文原文。",
    footerLicense: "基于 MIT 许可证发布。",
    footerSource: "由仓库中的 Markdown 源文件生成。",
    footerLlms: "机器可读索引",
    notFoundTitle: "页面不存在",
    notFoundBody: "请求的页面不存在，请返回文档首页。",
    notFoundAction: "前往文档首页",
    redirectTitle: "正在跳转…",
    redirectBody: "请选择语言",
    llmsSummary: "社区维护的 OpenClaw 微信渠道插件。本索引列出全部文档页面的 Markdown 源文件，包含英文与简体中文。",
  },
};
