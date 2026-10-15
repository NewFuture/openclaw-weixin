import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertVersionIncrease, checkVersionFiles, checkVersionMetadata } from "./check-versions.mjs";
import { extractReleaseNotesSection } from "./render-release-notes.mjs";

function releaseChangelog(source, label, unreleased, version, date) {
  const heading = new RegExp(`^## \\[${unreleased}\\](?=\\r?$)`, "m").exec(source);
  if (!heading || heading.index !== source.search(/^## \[/m)) {
    throw new Error(`${label} must start with an Unreleased section`);
  }
  if (new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\]`, "m").test(source)) {
    throw new Error(`${label} already contains the target release`);
  }

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const insertion = heading.index + heading[0].length;
  const result = `${source.slice(0, insertion)}${newline}${newline}## [${version}] - ${date}${source.slice(insertion)}`;
  const notes = extractReleaseNotesSection(result, label, version);
  if (
    !notes
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^### .+$/gm, "")
      .trim()
  ) {
    throw new Error(`${label} Unreleased notes must not be empty`);
  }

  return result;
}

export function prepareRelease(rootDirectory, version, date = new Date().toISOString().slice(0, 10)) {
  const { version: previousVersion } = checkVersionFiles(rootDirectory);
  assertVersionIncrease(previousVersion, version);

  const files = Object.fromEntries(
    ["package.json", "package-lock.json", "openclaw.plugin.json", "CHANGELOG.md", "CHANGELOG_EN.md"].map((filename) => [
      filename,
      readFileSync(resolve(rootDirectory, filename), "utf8"),
    ]),
  );
  const packageJson = JSON.parse(files["package.json"]);
  const packageLock = JSON.parse(files["package-lock.json"]);
  packageJson.version = version;
  packageLock.version = version;
  packageLock.packages[""].version = version;
  files["package.json"] = `${JSON.stringify(packageJson, null, 2)}\n`;
  files["package-lock.json"] = `${JSON.stringify(packageLock, null, 2)}\n`;
  // Keep the manifest's compact arrays and other formatting unchanged.
  files["openclaw.plugin.json"] = files["openclaw.plugin.json"].replace(
    /^(\x20{2}"version": ")[^"]+(")/m,
    (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
  );
  files["CHANGELOG.md"] = releaseChangelog(files["CHANGELOG.md"], "CHANGELOG.md", "未发布", version, date);
  files["CHANGELOG_EN.md"] = releaseChangelog(files["CHANGELOG_EN.md"], "CHANGELOG_EN.md", "Unreleased", version, date);
  checkVersionMetadata({
    packageJson,
    packageLock,
    pluginManifest: JSON.parse(files["openclaw.plugin.json"]),
    chineseChangelog: files["CHANGELOG.md"],
    englishChangelog: files["CHANGELOG_EN.md"],
  });

  for (const [filename, contents] of Object.entries(files)) {
    writeFileSync(resolve(rootDirectory, filename), contents);
  }
  return { previousVersion, version };
}

export function renderReleasePullRequest(template, version) {
  const sections = {
    变更说明: `Prepare release ${version}; synchronize the five release metadata files and move both Unreleased sections without changing their notes.`,
    验收标准: `All version fields equal ${version}; both changelogs use the same UTC release date and retain empty Unreleased headings. Review the PR checks, then squash-merge or merge.`,
    非目标与替代方案:
      "No runtime, dependency, host-compatibility, or publication-workflow changes. Manual metadata preparation remains available.",
    关联任务与风险:
      "Maintainer-requested, bounded release preparation; no issue required. Highest risk: release metadata (`risk:privileged`). Full CI remains pending.",
    风险与不变量:
      "Plugin/channel IDs, host requirements, dependencies, account state, and privacy boundaries remain unchanged. This workflow does not merge, tag, publish, or approve deployments.",
    自动化测试用例: `\`node scripts/prepare-release.mjs ${version}\` — passed: stable version increase, aligned metadata, and non-empty bilingual release notes. Runtime cases: Not applicable (metadata only).`,
    兼容性验证: "Not applicable: no host APIs, dependency versions, or compatibility claims change.",
    整机实测结果: "Not applicable: release metadata only; no plugin runtime behavior changes.",
    其他验证命令:
      "`npm run check` — Not run by the preparation workflow; required PR CI must pass before merge. Approve workflows to run if GitHub requests it.",
    检查清单:
      "Unchecked items remain for maintainer review; this automated PR does not assert human validation or full CI success.",
  };
  let body = template;
  for (const [heading, contents] of Object.entries(sections)) {
    const marker = `## ${heading}\n`;
    if (!body.includes(marker)) throw new Error(`PR template is missing required section: ${heading}`);
    body = body.replace(marker, `${marker}\n${contents}\n`);
  }
  body = body.replace("### 脱敏关键日志\n", "### 脱敏关键日志\n\n无\n");
  body = body.replace(/^(- [^：\r\n]+：)/gm, "$1 Not applicable ");
  return body.replace("|  |  |  |", "| Not applicable | Metadata only | No runtime change |");
}

function run() {
  try {
    const rootDirectory = process.cwd();
    const version = process.argv[2];
    const template = readFileSync(resolve(rootDirectory, ".github", "pull_request_template.md"), "utf8").replaceAll(
      "\r\n",
      "\n",
    );
    const body = renderReleasePullRequest(template, version);
    prepareRelease(rootDirectory, version);
    process.stdout.write(body);
  } catch (error) {
    const message = error?.code
      ? `file operation failed (${error.code})`
      : error instanceof Error
        ? error.message
        : "unknown error";
    console.error(`Release preparation failed: ${message}`);
    process.exitCode = 1;
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedUrl) {
  run();
}
