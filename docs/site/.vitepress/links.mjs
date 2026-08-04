/**
 * Rewrite repository-relative Markdown links. The documents are written for
 * GitHub, where links point at sibling files; the published copies need links
 * that resolve on the website instead.
 */

import path from "node:path";

import { SITE } from "./docs.mjs";

const MARKDOWN_LINK = /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g;
const ABSOLUTE_LINK = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** Repository file that is not published as a page, linked on GitHub instead. */
export function githubUrlFor(source) {
  return `${SITE.repositoryUrl}/blob/${SITE.defaultBranch}/${source}`;
}

/**
 * @param markdown Source document text.
 * @param source Repository-relative path of that document.
 * @param resolve Maps a repository-relative path to its published URL, or
 *   returns nothing when the target is not published.
 */
export function rewriteLinks(markdown, { source, resolve }) {
  const directory = path.posix.dirname(source);
  return markdown.replace(MARKDOWN_LINK, (match, prefix, href, suffix) => {
    if (ABSOLUTE_LINK.test(href)) return match;
    const hashIndex = href.indexOf("#");
    const target = hashIndex === -1 ? href : href.slice(0, hashIndex);
    const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
    if (!target) return match;
    const resolved = path.posix.normalize(path.posix.join(directory, target));
    return `${prefix}${resolve(resolved) ?? githubUrlFor(resolved)}${hash}${suffix}`;
  });
}
