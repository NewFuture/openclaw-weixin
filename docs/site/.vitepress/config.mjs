import { fileURLToPath } from "node:url";

import { defineConfig } from "vitepress";

import { createNav, createPageByFile, createSidebar, htmlPathFor, localeById, SITE } from "./docs.mjs";
import { emitMachineReadable } from "./llms.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PAGE_BY_FILE = createPageByFile();

/** GitHub Pages passes the deployed origin and path; fall back to the project page. */
const baseUrl = (process.env.SITE_BASE_URL || SITE.defaultBaseUrl).replace(/\/+$/, "");
const base = `${new URL(baseUrl).pathname.replace(/\/+$/, "")}/`;

const editLink = {
  pattern: `${SITE.repositoryUrl}/edit/${SITE.defaultBranch}/:path`,
};
const clawHubIcon = {
  svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 3h4v4H6V3Zm8 0h4v4h-4V3ZM4 10h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4ZM6 17h4v4H6v-4Zm8 0h4v4h-4v-4Z"/></svg>',
};

export default defineConfig({
  title: SITE.name,
  description: SITE.description.zh,
  base,
  // `content/` is generated from the repository Markdown by `.vitepress/sync.mjs`.
  srcDir: "content",
  outDir: "dist",
  cleanUrls: false,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: `${base}logo.svg` }],
    ["meta", { name: "theme-color", content: "#07c160" }],
  ],
  sitemap: { hostname: `${baseUrl}/` },

  locales: {
    // Simplified Chinese is the default locale and is served from the root.
    root: {
      label: localeById("zh").label,
      lang: localeById("zh").lang,
      description: SITE.description.zh,
      themeConfig: {
        nav: createNav("zh"),
        sidebar: createSidebar("zh"),
        outline: { level: [2, 3], label: "本页目录" },
        docFooter: { prev: "上一页", next: "下一页" },
        darkModeSwitchLabel: "主题",
        lightModeSwitchTitle: "切换到浅色模式",
        darkModeSwitchTitle: "切换到深色模式",
        sidebarMenuLabel: "目录",
        returnToTopLabel: "回到顶部",
        langMenuLabel: "切换语言",
        skipToContentLabel: "跳到正文",
        editLink: { ...editLink, text: "在 GitHub 上编辑此页" },
        socialLinks: [
          { icon: "github", link: SITE.repositoryUrl, ariaLabel: "GitHub 仓库" },
          { icon: "npm", link: SITE.npmUrl, ariaLabel: "npm 软件包" },
          { icon: clawHubIcon, link: SITE.clawHubUrl, ariaLabel: "ClawHub 软件包" },
        ],
        footer: {
          message: `${SITE.tagline.zh} · <a href="${SITE.npmUrl}">npm</a> · <a href="${SITE.clawHubUrl}">ClawHub</a> · MIT 许可证`,
          copyright: `衍生自 <a href="${SITE.upstreamUrl}">Tencent/openclaw-weixin</a>`,
        },
      },
    },
    en: {
      label: localeById("en").label,
      lang: localeById("en").lang,
      description: SITE.description.en,
      themeConfig: {
        nav: createNav("en"),
        sidebar: createSidebar("en"),
        outline: { level: [2, 3], label: "On this page" },
        docFooter: { prev: "Previous", next: "Next" },
        darkModeSwitchLabel: "Appearance",
        lightModeSwitchTitle: "Switch to light theme",
        darkModeSwitchTitle: "Switch to dark theme",
        sidebarMenuLabel: "Menu",
        returnToTopLabel: "Return to top",
        langMenuLabel: "Change language",
        skipToContentLabel: "Skip to content",
        editLink: { ...editLink, text: "Edit this page on GitHub" },
        socialLinks: [
          { icon: "github", link: SITE.repositoryUrl, ariaLabel: "GitHub repository" },
          { icon: "npm", link: SITE.npmUrl, ariaLabel: "npm package" },
          { icon: clawHubIcon, link: SITE.clawHubUrl, ariaLabel: "ClawHub package" },
        ],
        footer: {
          message: `${SITE.tagline.en} · <a href="${SITE.npmUrl}">npm</a> · <a href="${SITE.clawHubUrl}">ClawHub</a> · MIT License`,
          copyright: `Derived from <a href="${SITE.upstreamUrl}">Tencent/openclaw-weixin</a>`,
        },
      },
    },
  },

  themeConfig: {
    logo: { src: "/logo.svg", alt: "openclaw-weixin" },
    search: {
      provider: "local",
      options: {
        // `root` is the Chinese locale; the other locales keep the English defaults.
        locales: {
          root: {
            translations: {
              button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
              modal: {
                displayDetails: "显示详情",
                resetButtonTitle: "清除查询条件",
                backButtonTitle: "返回",
                noResultsText: "没有匹配的结果",
                footer: { selectText: "选择", navigateText: "切换", closeText: "关闭" },
              },
            },
          },
        },
      },
    },
  },

  /**
   * Point the GitHub edit link at the repository source, not the generated
   * copy, and mark locale copies of untranslated documents as duplicates of
   * the default-locale page.
   */
  transformPageData(pageData) {
    const page = PAGE_BY_FILE[pageData.relativePath];
    if (!page) return;
    pageData.filePath = page.source;
    pageData.frontmatter.head = [
      ...(pageData.frontmatter.head ?? []),
      ["link", { rel: "canonical", href: `${baseUrl}/${htmlPathFor(page.canonicalPath)}` }],
    ];
  },

  async buildEnd(siteConfig) {
    await emitMachineReadable({ repoRoot: REPO_ROOT, outDir: siteConfig.outDir, baseUrl });
  },
});
