/**
 * Documentation map shared by the VitePress config and the machine-readable
 * index. Every page is sourced from Markdown that already lives in the
 * repository, so the website never duplicates documentation content.
 */

export const SITE = {
  name: "openclaw-weixin",
  repositoryUrl: "https://github.com/NewFuture/openclaw-weixin",
  npmUrl: "https://www.npmjs.com/package/openclaw-weixin",
  upstreamUrl: "https://github.com/Tencent/openclaw-weixin",
  defaultBaseUrl: "https://openclaw-weixin.newfuture.cc",
  defaultBranch: "main",
  tagline: {
    en: "Community-maintained OpenClaw WeChat channel plugin",
    zh: "社区维护的 OpenClaw 微信渠道插件",
  },
  description: {
    en: "Connect OpenClaw with WeChat: one-command install, in-place replacement, QR login, and multi-account support.",
    zh: "连接 OpenClaw 与微信：一行命令安装、原位替换、扫码登录，并支持多账号。",
  },
  summary: "社区维护的 OpenClaw 微信渠道插件。此索引列出每个文档页面的简体中文与英文 Markdown 源文件。",
};

/**
 * Supported locales, in fallback order. The first entry is the default locale
 * published at the site root; a page without a translation carries the Markdown
 * of the first locale that has one, prefixed with `untranslatedNotice`.
 */
export const LOCALES = [
  {
    id: "zh",
    lang: "zh-CN",
    label: "简体中文",
    shortLabel: "中文",
    prefix: "/",
    untranslatedNotice: {
      title: "尚未翻译",
      body: "本页尚无中文翻译，以下为英文原文。",
    },
  },
  {
    id: "en",
    lang: "en-US",
    label: "English",
    shortLabel: "EN",
    prefix: "/en/",
    untranslatedNotice: {
      title: "Not translated yet",
      body: "This page has no English translation yet; the Simplified Chinese source is shown below.",
    },
  },
];

export const DEFAULT_LOCALE = LOCALES[0].id;

export function localeById(id) {
  const locale = LOCALES.find((entry) => entry.id === id);
  if (!locale) throw new Error(`Unknown locale: ${id}`);
  return locale;
}

/**
 * Documentation pages. `sources` maps a locale to a repository-relative
 * Markdown file; a missing locale falls back to another locale's Markdown.
 */
export const DOCUMENTS = [
  {
    slug: "index",
    sources: { en: "README_EN.md", zh: "README.md" },
    title: { en: "Overview", zh: "概览" },
    description: {
      en: "Install the community-maintained WeChat channel plugin for OpenClaw and bind one or more accounts.",
      zh: "安装社区维护的 OpenClaw 微信渠道插件，并绑定一个或多个微信账号。",
    },
  },
  {
    slug: "guide",
    sources: { zh: "docs/guide.md", en: "docs/guide_EN.md" },
    title: { en: "Detailed Guide", zh: "详细指南" },
    description: {
      en: "Installation behavior, custom BotAgent, uninstall, and troubleshooting.",
      zh: "安装行为、自定义 BotAgent、卸载与故障排查。",
    },
  },
  {
    slug: "architecture",
    sources: { zh: "docs/architecture.md", en: "docs/architecture_EN.md" },
    title: { en: "Architecture", zh: "架构说明" },
    description: {
      en: "Component map, plugin lifecycle, inbound and outbound flows, and persistent state.",
      zh: "组件划分、插件生命周期、收发消息流程与持久化状态。",
    },
  },
  {
    slug: "backend-api",
    sources: { zh: "docs/backend-api.md", en: "docs/backend-api_EN.md" },
    title: { en: "Backend API Protocol", zh: "后端 API 协议" },
    description: {
      en: "Every Weixin backend endpoint used for QR login, lifecycle, messages, and media.",
      zh: "插件用于扫码登录、生命周期、消息与媒体的全部微信后端接口。",
    },
  },
  {
    slug: "changelog",
    sources: { en: "CHANGELOG_EN.md", zh: "CHANGELOG.md" },
    title: { en: "Changelog", zh: "变更日志" },
    description: {
      en: "Released versions and user-visible changes.",
      zh: "已发布版本与用户可见的变更。",
    },
  },
  {
    slug: "contributing",
    sources: { en: "CONTRIBUTING.md" },
    title: { en: "Contributing", zh: "参与贡献" },
    description: {
      en: "Prerequisites, local development commands, and pull request expectations.",
      zh: "环境要求、本地开发命令与提交 Pull Request 的要求。",
    },
  },
  {
    slug: "agents",
    sources: { en: "AGENTS.md" },
    title: { en: "Coding Agent Guide", zh: "编码智能体指南" },
    description: {
      en: "Repository invariants, module map, validation ladder, and definition of done.",
      zh: "仓库约束、模块地图、验证流程与完成标准。",
    },
  },
  {
    slug: "release",
    sources: { en: "RELEASE.md" },
    title: { en: "Release Process", zh: "发布流程" },
    description: {
      en: "How npmjs, GitHub Packages, GitHub Releases, and ClawHub are published.",
      zh: "npmjs、GitHub Packages、GitHub Release 与 ClawHub 的发布流程。",
    },
  },
  {
    slug: "security",
    sources: { en: "SECURITY.md" },
    title: { en: "Security Policy", zh: "安全策略" },
    description: {
      en: "Supported versions and how to report a vulnerability privately.",
      zh: "受支持的版本以及如何私下报告安全漏洞。",
    },
  },
];

/** Navigation grouping. Every document slug must appear exactly once. */
export const GROUPS = [
  { title: { en: "Getting Started", zh: "快速开始" }, documents: ["index", "guide"], collapsed: false },
  {
    title: { en: "Reference", zh: "参考文档" },
    documents: ["architecture", "backend-api", "changelog"],
    collapsed: true,
  },
  {
    title: { en: "Project", zh: "项目信息" },
    documents: ["contributing", "agents", "release", "security"],
    collapsed: true,
  },
];

const TASK_NAV = {
  en: {
    install: "Install",
    verify: "Full check",
    troubleshoot: "Troubleshoot",
    more: "More",
    guides: "Guides and reference",
    project: "Project",
  },
  zh: {
    install: "安装",
    verify: "完整检查",
    troubleshoot: "故障排查",
    more: "更多",
    guides: "指南与参考",
    project: "项目信息",
  },
};

const MORE_NAV_GROUPS = [
  { label: "guides", documents: ["guide", "architecture", "backend-api", "changelog"] },
  { label: "project", documents: ["contributing", "agents", "release", "security"] },
];

export function documentBySlug(slug) {
  const document = DOCUMENTS.find((entry) => entry.slug === slug);
  if (!document) throw new Error(`Unknown document slug: ${slug}`);
  return document;
}

export function isTranslated(document, locale) {
  return Boolean(document.sources[locale]);
}

/**
 * Locale whose Markdown a page carries: the reader's own when the document is
 * translated, otherwise the first locale, in `LOCALES` order, that has a source.
 */
export function sourceLocaleFor(document, locale) {
  if (isTranslated(document, locale)) return locale;
  const fallback = LOCALES.find((entry) => isTranslated(document, entry.id));
  if (!fallback) throw new Error(`Document has no source: ${document.slug}`);
  return fallback.id;
}

/** Repository Markdown published for a locale, falling back to a translated one. */
export function sourceFor(document, locale) {
  return document.sources[sourceLocaleFor(document, locale)];
}

/** Page path inside the generated content tree, without its extension. */
export function pagePathFor(document, locale) {
  const prefix = locale === DEFAULT_LOCALE ? "" : `${locale}/`;
  return `${prefix}${document.slug}`;
}

/** Site link for a page. Every document is published in every locale. */
export function linkFor(document, locale) {
  const { prefix } = localeById(locale);
  return document.slug === "index" ? prefix : `${prefix}${document.slug}`;
}

/**
 * Every page the site publishes, in navigation order. Documents without a
 * translation are still published per locale, carrying the fallback locale's
 * Markdown, so that the language switcher never lands on a missing page.
 */
export function createPages() {
  const pages = [];
  for (const locale of LOCALES) {
    for (const slug of GROUPS.flatMap((group) => group.documents)) {
      const document = documentBySlug(slug);
      const sourceLocale = sourceLocaleFor(document, locale.id);
      pages.push({
        locale: locale.id,
        slug,
        source: document.sources[sourceLocale],
        sourceLocale,
        translated: sourceLocale === locale.id,
        path: pagePathFor(document, locale.id),
        canonicalPath: pagePathFor(document, sourceLocale),
        title: document.title[locale.id],
        description: document.description[locale.id],
      });
    }
  }
  return pages;
}

/**
 * Repository Markdown path to the document it belongs to. Cross-document links
 * are resolved per locale, so a link is rewritten to the reader's language
 * whichever translation of the target the source document happened to link to.
 */
export function createDocumentBySource() {
  const index = new Map();
  for (const document of DOCUMENTS) {
    for (const source of Object.values(document.sources)) index.set(source, document);
  }
  return index;
}

/**
 * Resolve a repository Markdown path to its published page path in `locale`.
 *
 * A link that points at another locale's translation is an explicit language
 * switch, such as the README language header, and is honoured. A link to a
 * document that has no translation in `locale` keeps the reader inside their
 * own locale, where the fallback copy is published.
 */
export function createPathResolver(locale, documentBySource = createDocumentBySource()) {
  return (source) => {
    const document = documentBySource.get(source);
    if (!document) return undefined;
    if (!isTranslated(document, locale) || document.sources[locale] === source) {
      return pagePathFor(document, locale);
    }
    const owner = LOCALES.find((entry) => document.sources[entry.id] === source);
    return pagePathFor(document, owner.id);
  };
}

/** Published URL path of a page, matching the `cleanUrls: false` output. */
export function htmlPathFor(pagePath) {
  return pagePath === "index" || pagePath.endsWith("/index") ? pagePath.slice(0, -"index".length) : `${pagePath}.html`;
}

/** Generated page file to its page record, used for edit links and canonicals. */
export function createPageByFile(pages = createPages()) {
  return Object.fromEntries(pages.map((page) => [`${page.path}.md`, page]));
}

function localizedDocumentTitle(document, locale) {
  const title = document.title[locale];
  const sourceLocale = sourceLocaleFor(document, locale);
  return sourceLocale === locale ? title : `${title}（${localeById(sourceLocale).shortLabel}）`;
}

export function createNav(locale) {
  const labels = TASK_NAV[locale];
  const home = linkFor(documentBySlug("index"), locale);
  const guide = linkFor(documentBySlug("guide"), locale);
  const troubleshootingHash = locale === "zh" ? "故障排查" : "troubleshooting";
  return [
    { text: labels.install, link: `${home}#connect-wechat` },
    { text: labels.verify, link: `${home}#verify-connection` },
    { text: labels.troubleshoot, link: `${guide}#${troubleshootingHash}` },
    {
      text: labels.more,
      items: MORE_NAV_GROUPS.map((group) => ({
        text: labels[group.label],
        items: group.documents.map((slug) => {
          const document = documentBySlug(slug);
          return { text: localizedDocumentTitle(document, locale), link: linkFor(document, locale) };
        }),
      })),
    },
  ];
}

export function createSidebar(locale) {
  return GROUPS.map((group) => ({
    text: group.title[locale],
    collapsed: group.collapsed,
    items: group.documents.map((slug) => {
      const document = documentBySlug(slug);
      return {
        text: localizedDocumentTitle(document, locale),
        link: linkFor(document, locale),
      };
    }),
  }));
}
