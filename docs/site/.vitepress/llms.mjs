/**
 * Machine-readable outputs that VitePress does not provide: the raw Markdown of
 * every page plus the `llms.txt` and `llms-full.txt` indexes.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createDocumentBySource, createPages, createPathResolver, DEFAULT_LOCALE, LOCALES, SITE } from "./docs.mjs";
import { rewriteLinks } from "./links.mjs";

/** Machine-readable marker for a locale page that carries the English text. */
const UNTRANSLATED_NOTE = "(English source, not translated yet)";

export function renderLlmsTxt({ baseUrl, version, generatedAt, pages }) {
  const lines = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.summary}`,
    "",
    `- Version: ${version}`,
    `- Generated: ${generatedAt}`,
    `- Repository: ${SITE.repositoryUrl}`,
    `- npm: ${SITE.npmUrl}`,
    `- Full text: ${baseUrl}/llms-full.txt`,
    "",
  ];
  for (const locale of LOCALES) {
    lines.push(`## ${locale.id === DEFAULT_LOCALE ? "Docs" : `Docs (${locale.label})`}`, "");
    for (const page of pages.filter((entry) => entry.locale === locale.id)) {
      const note = page.translated ? "" : ` ${UNTRANSLATED_NOTE}`;
      lines.push(`- [${page.title}](${baseUrl}/${page.path}.md): ${page.description}${note}`);
    }
    lines.push("");
  }
  lines.push(
    "## Optional",
    "",
    `- [HTML documentation](${baseUrl}/): Same content rendered for humans.`,
    `- [Upstream project](${SITE.upstreamUrl}): Original Tencent distribution this package is derived from.`,
    "",
  );
  return lines.join("\n");
}

/** Inline each document once; untranslated locale copies repeat their source. */
export function renderLlmsFullTxt({ baseUrl, version, generatedAt, pages }) {
  const parts = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.summary}`,
    "",
    `- Version: ${version}`,
    `- Generated: ${generatedAt}`,
    `- Index: ${baseUrl}/llms.txt`,
    "",
  ];
  for (const page of pages.filter((entry) => entry.translated)) {
    parts.push(
      "---",
      "",
      `<!-- source: ${page.source} | locale: ${page.locale} | url: ${baseUrl}/${page.path}.md -->`,
      "",
      page.markdown.trim(),
      "",
    );
  }
  return parts.join("\n");
}

export function renderRobotsTxt(baseUrl) {
  return ["User-agent: *", "Allow: /", "", `Sitemap: ${baseUrl}/sitemap.xml`, ""].join("\n");
}

/**
 * Emit the machine-readable artifacts next to the generated HTML. Called from
 * the VitePress `buildEnd` hook, once the output directory exists.
 */
export async function emitMachineReadable({ repoRoot, outDir, baseUrl, now = new Date() }) {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const pages = createPages();
  const documentBySource = createDocumentBySource();
  const resolverByLocale = new Map();

  for (const page of pages) {
    if (!resolverByLocale.has(page.locale)) {
      resolverByLocale.set(page.locale, createPathResolver(page.locale, documentBySource));
    }
    const resolvePath = resolverByLocale.get(page.locale);
    const markdown = await readFile(path.join(repoRoot, page.source), "utf8");
    page.markdown = rewriteLinks(markdown, {
      source: page.source,
      resolve: (target) => {
        const resolved = resolvePath(target);
        return resolved ? `${baseUrl}/${resolved}.md` : undefined;
      },
    });
    const destination = path.join(outDir, `${page.path}.md`);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `${page.markdown.trimEnd()}\n`, "utf8");
  }

  const context = { baseUrl, version: packageJson.version, generatedAt: now.toISOString(), pages };
  await writeFile(path.join(outDir, "llms.txt"), renderLlmsTxt(context), "utf8");
  await writeFile(path.join(outDir, "llms-full.txt"), renderLlmsFullTxt(context), "utf8");
  await writeFile(path.join(outDir, "robots.txt"), renderRobotsTxt(baseUrl), "utf8");
  await writeFile(path.join(outDir, ".nojekyll"), "", "utf8");

  return { pages, ...context };
}
