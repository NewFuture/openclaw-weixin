import { fileURLToPath } from "node:url";

import { defineConfig } from "vitepress";

import { createNav, createSidebar, createSourceByPage, LOCALES, SITE } from "./docs.mjs";
import { emitMachineReadable } from "./llms.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SOURCE_BY_PAGE = createSourceByPage();

/** GitHub Pages passes the deployed origin and path; fall back to the project page. */
const baseUrl = (process.env.SITE_BASE_URL || SITE.defaultBaseUrl).replace(/\/+$/, "");
const base = `${new URL(baseUrl).pathname.replace(/\/+$/, "")}/`;

const editLink = {
  pattern: `${SITE.repositoryUrl}/edit/${SITE.defaultBranch}/:path`,
};

export default defineConfig({
  title: SITE.name,
  description: SITE.description.en,
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
    root: {
      label: LOCALES[0].label,
      lang: LOCALES[0].lang,
      description: SITE.description.en,
      themeConfig: {
        nav: createNav("en"),
        sidebar: createSidebar("en"),
        outline: { level: [2, 3], label: "On this page" },
        docFooter: { prev: "Previous", next: "Next" },
        editLink: { ...editLink, text: "Edit this page on GitHub" },
        footer: {
          message: `${SITE.tagline.en} · Released under the MIT License.`,
          copyright: `Derived from <a href="${SITE.upstreamUrl}">Tencent/openclaw-weixin</a>`,
        },
      },
    },
    zh: {
      label: LOCALES[1].label,
      lang: LOCALES[1].lang,
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
        editLink: { ...editLink, text: "在 GitHub 上编辑此页" },
        footer: {
          message: `${SITE.tagline.zh} · 基于 MIT 许可证发布。`,
          copyright: `衍生自 <a href="${SITE.upstreamUrl}">Tencent/openclaw-weixin</a>`,
        },
      },
    },
  },

  themeConfig: {
    logo: "/logo.svg",
    socialLinks: [
      { icon: "github", link: SITE.repositoryUrl },
      { icon: "npm", link: SITE.npmUrl },
    ],
    search: {
      provider: "local",
      options: {
        locales: {
          zh: {
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

  /** Point the GitHub edit link at the repository source, not the generated copy. */
  transformPageData(pageData) {
    const source = SOURCE_BY_PAGE[pageData.relativePath];
    if (source) pageData.filePath = source;
  },

  async buildEnd(siteConfig) {
    await emitMachineReadable({ repoRoot: REPO_ROOT, outDir: siteConfig.outDir, baseUrl });
  },
});
