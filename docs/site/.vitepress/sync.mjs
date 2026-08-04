#!/usr/bin/env node
/**
 * Copy the repository Markdown into the VitePress source tree.
 *
 * The documents stay where contributors and GitHub expect them; the website
 * consumes a generated copy so that VitePress sees a plain, locale-shaped page
 * tree. Only links are rewritten, never prose.
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createPages } from "./docs.mjs";
import { rewriteLinks } from "./links.mjs";

const SITE_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = path.resolve(SITE_DIR, "..", "..");
const CONTENT_DIR = path.join(SITE_DIR, "content");

/** Published page for each repository source, as a site-absolute link. */
export function createLinkBySource(pages) {
  return new Map(pages.map((page) => [page.source, `/${page.path}.md`]));
}

function escapeFrontmatter(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderPage(page, markdown, linkBySource) {
  const body = rewriteLinks(markdown, {
    source: page.source,
    resolve: (target) => linkBySource.get(target),
  });
  const frontmatter = [
    "---",
    `title: ${escapeFrontmatter(page.title)}`,
    `description: ${escapeFrontmatter(page.description)}`,
    "---",
    "",
  ].join("\n");
  return `${frontmatter}\n${body.trimEnd()}\n`;
}

export async function syncContent({ repoRoot = REPO_ROOT, siteDir = SITE_DIR, contentDir = CONTENT_DIR } = {}) {
  const pages = createPages();
  const linkBySource = createLinkBySource(pages);

  await rm(contentDir, { recursive: true, force: true });
  await mkdir(path.join(contentDir, "public"), { recursive: true });
  await cp(path.join(siteDir, "logo.svg"), path.join(contentDir, "public", "logo.svg"));

  for (const page of pages) {
    const markdown = await readFile(path.join(repoRoot, page.source), "utf8");
    const destination = path.join(contentDir, `${page.path}.md`);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, renderPage(page, markdown, linkBySource), "utf8");
  }

  return { contentDir, pages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pages } = await syncContent();
  console.log(`Synced ${pages.length} documentation pages into docs/site/content`);
}
