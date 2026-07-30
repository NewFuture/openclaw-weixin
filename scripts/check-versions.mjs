import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseStableVersion(version, label) {
  if (typeof version !== "string" || !STABLE_SEMVER.test(version)) {
    throw new Error(`${label} must use a stable MAJOR.MINOR.PATCH version, found ${JSON.stringify(version)}`);
  }

  return version.split(".").map((part) => BigInt(part));
}

function findReleaseDate(changelog, label, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## \\[${escapedVersion}\\] - (\\d{4}-\\d{2}-\\d{2})\\r?$`, "m");
  const match = changelog.match(heading);
  if (!match) {
    throw new Error(`${label} must contain a release heading for ${version}`);
  }

  return match[1];
}

export function checkVersionMetadata({ packageJson, packageLock, pluginManifest, changelog, chineseChangelog }) {
  const version = packageJson?.version;
  parseStableVersion(version, "package.json");

  for (const [label, candidate] of [
    ["package-lock.json", packageLock?.version],
    ["package-lock.json root package", packageLock?.packages?.[""]?.version],
    ["openclaw.plugin.json", pluginManifest?.version],
  ]) {
    if (candidate !== version) {
      throw new Error(`${label} version ${JSON.stringify(candidate)} does not match package.json version ${version}`);
    }
  }

  const releaseDate = findReleaseDate(changelog, "CHANGELOG.md", version);
  const chineseReleaseDate = findReleaseDate(chineseChangelog, "CHANGELOG.zh_CN.md", version);
  if (chineseReleaseDate !== releaseDate) {
    throw new Error(`changelog release dates do not match for ${version}: ${releaseDate} and ${chineseReleaseDate}`);
  }

  return { releaseDate, tag: `v${version}`, version };
}

export function assertVersionIncrease(previousVersion, version) {
  const previous = parseStableVersion(previousVersion, "previous package.json version");
  const current = parseStableVersion(version, "package.json");

  for (let index = 0; index < current.length; index += 1) {
    if (current[index] > previous[index]) return;
    if (current[index] < previous[index]) break;
  }

  throw new Error(`release version must increase from ${previousVersion}, found ${version}`);
}

export function assertReleaseTag(tag, version) {
  const expected = `v${version}`;
  if (tag !== expected) {
    throw new Error(`release tag must be ${expected}, found ${tag}`);
  }
}

function readJson(rootDirectory, filename) {
  return JSON.parse(readFileSync(resolve(rootDirectory, filename), "utf8"));
}

export function checkVersionFiles(rootDirectory = process.cwd()) {
  return checkVersionMetadata({
    packageJson: readJson(rootDirectory, "package.json"),
    packageLock: readJson(rootDirectory, "package-lock.json"),
    pluginManifest: readJson(rootDirectory, "openclaw.plugin.json"),
    changelog: readFileSync(resolve(rootDirectory, "CHANGELOG.md"), "utf8"),
    chineseChangelog: readFileSync(resolve(rootDirectory, "CHANGELOG.zh_CN.md"), "utf8"),
  });
}

function run() {
  try {
    const result = checkVersionFiles();
    if (process.env.RELEASE_PREVIOUS_VERSION) {
      assertVersionIncrease(process.env.RELEASE_PREVIOUS_VERSION, result.version);
    }
    if (process.env.RELEASE_TAG) {
      assertReleaseTag(process.env.RELEASE_TAG, result.version);
    }

    console.log(
      `Version check passed: ${result.version} (${result.releaseDate}) across package, plugin, lockfile, and changelogs`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Version check failed: ${message}`);
    process.exitCode = 1;
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedUrl) {
  run();
}
