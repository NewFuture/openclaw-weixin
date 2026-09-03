#!/usr/bin/env node
/**
 * Copy the repository Markdown into the VitePress source tree.
 *
 * The documents stay where contributors and GitHub expect them; the website
 * consumes a generated copy so that VitePress sees a plain, locale-shaped page
 * tree. Links are rewritten, explicitly marked repository-only navigation is
 * removed, and the website homepage prefers its default ClawHub source.
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createDocumentBySource, createPages, createPathResolver, localeById } from "./docs.mjs";
import { rewriteLinks } from "./links.mjs";
import { preferClawHubForWebsiteHome } from "./source-preference.mjs";

const SITE_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = path.resolve(SITE_DIR, "..", "..");
const CONTENT_DIR = path.join(SITE_DIR, "content");
const REPOSITORY_ONLY = /<!--\s*docs-site:repo-only:start\s*-->[\s\S]*?<!--\s*docs-site:repo-only:end\s*-->\s*/g;

function escapeFrontmatter(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Tell readers that a locale copy carries the default-locale text. The notice
 * goes after the document title so the page still opens with its heading.
 */
export function withUntranslatedNotice(markdown, notice) {
  if (!notice) return markdown;
  const block = `::: warning ${notice.title}\n${notice.body}\n:::`;
  const heading = markdown.match(/^# .*(?:\r?\n|$)/);
  if (!heading) return `${block}\n\n${markdown}`;
  return `${heading[0]}\n${block}\n${markdown.slice(heading[0].length)}`;
}

/** Remove repository-only navigation that duplicates the website chrome. */
export function withoutRepositoryOnlySections(markdown) {
  return markdown.replace(REPOSITORY_ONLY, "");
}

export function renderPage(page, markdown, resolvePath = createPathResolver(page.locale)) {
  const body = rewriteLinks(withoutRepositoryOnlySections(markdown), {
    source: page.source,
    resolve: (target) => {
      const resolved = resolvePath(target);
      return resolved ? `/${resolved}.md` : undefined;
    },
  });
  const pageFrontmatter = page.slug === "index" ? ['pageClass: "docs-home"', "sidebar: false", "aside: false"] : [];
  const frontmatter = [
    "---",
    `title: ${escapeFrontmatter(page.title)}`,
    `description: ${escapeFrontmatter(page.description)}`,
    ...pageFrontmatter,
    "---",
    "",
  ].join("\n");
  const notice = page.translated ? undefined : localeById(page.locale).untranslatedNotice;
  return `${frontmatter}\n${withUntranslatedNotice(body.trimEnd(), notice)}\n`;
}

export async function syncContent({ repoRoot = REPO_ROOT, siteDir = SITE_DIR, contentDir = CONTENT_DIR } = {}) {
  const pages = createPages();
  const documentBySource = createDocumentBySource();
  const resolverByLocale = new Map();

  await rm(contentDir, { recursive: true, force: true });
  await mkdir(path.join(contentDir, "public"), { recursive: true });
  await cp(path.join(siteDir, "logo.svg"), path.join(contentDir, "public", "logo.svg"));

  for (const page of pages) {
    if (!resolverByLocale.has(page.locale)) {
      resolverByLocale.set(page.locale, createPathResolver(page.locale, documentBySource));
    }
    const markdown = preferClawHubForWebsiteHome(page, await readFile(path.join(repoRoot, page.source), "utf8"));
    const destination = path.join(contentDir, `${page.path}.md`);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, renderPage(page, markdown, resolverByLocale.get(page.locale)), "utf8");
  }

  return { contentDir, pages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pages } = await syncContent();
  console.log(`Synced ${pages.length} documentation pages into docs/site/content`);
}
