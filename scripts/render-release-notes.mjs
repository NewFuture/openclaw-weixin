import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { checkVersionFiles } from "./check-versions.mjs";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractReleaseNotesSection(changelog, label, version) {
  const escapedVersion = escapeRegExp(version);
  const heading = new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}\\r?$`, "m");
  const match = heading.exec(changelog);
  if (!match) {
    throw new Error(`${label} must contain a release heading for ${version}`);
  }

  const remaining = changelog.slice(match.index + match[0].length).replace(/^\r?\n/, "");
  const nextHeadingIndex = remaining.search(/^## \[/m);
  const section = (nextHeadingIndex === -1 ? remaining : remaining.slice(0, nextHeadingIndex)).trim();
  if (!section) {
    throw new Error(`${label} release notes for ${version} must not be empty`);
  }

  return section;
}

export function renderReleaseNotes({ version, chineseChangelog, englishChangelog }) {
  const chineseNotes = extractReleaseNotesSection(chineseChangelog, "CHANGELOG.md", version);
  const englishNotes = extractReleaseNotesSection(englishChangelog, "CHANGELOG_EN.md", version);

  return ["## 简体中文", "", chineseNotes, "", "## English", "", englishNotes, ""].join("\n");
}

export function renderReleaseNotesFiles(rootDirectory = process.cwd()) {
  const { version } = checkVersionFiles(rootDirectory);
  return renderReleaseNotes({
    version,
    chineseChangelog: readFileSync(resolve(rootDirectory, "CHANGELOG.md"), "utf8"),
    englishChangelog: readFileSync(resolve(rootDirectory, "CHANGELOG_EN.md"), "utf8"),
  });
}

function run() {
  try {
    process.stdout.write(renderReleaseNotesFiles());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Release notes rendering failed: ${message}`);
    process.exitCode = 1;
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedUrl) {
  run();
}
