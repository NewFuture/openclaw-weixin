import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertVersionIncrease } from "./check-versions.mjs";
import { runReleaseCommand } from "./resolve-release-targets.mjs";

export const GITHUB_PACKAGE_NAME = "@newfuture/openclaw-weixin";
export const GITHUB_PACKAGE_REGISTRY = "https://npm.pkg.github.com";

function commandFailure(args, result) {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`;
  return new Error(`npm ${args.join(" ")} failed: ${detail}`);
}

function isNotFound(result) {
  return /E404|404 Not Found/i.test(`${result.stderr}\n${result.stdout}`);
}

export function inspectGitHubPackageTarget({ run = runReleaseCommand, version }) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    throw new Error(`GitHub Packages target must be a stable semantic version, found ${JSON.stringify(version)}`);
  }

  const exactArgs = ["view", `${GITHUB_PACKAGE_NAME}@${version}`, "version", `--registry=${GITHUB_PACKAGE_REGISTRY}`];
  const exactResult = run("npm", exactArgs);
  if (exactResult.status === 0) {
    const publishedVersion = exactResult.stdout.trim();
    if (publishedVersion !== version) {
      throw new Error(
        `GitHub Packages version mismatch: expected ${JSON.stringify(version)}, found ${JSON.stringify(
          publishedVersion,
        )}`,
      );
    }
    return { latestVersion: null, published: true, version };
  }
  if (!isNotFound(exactResult)) {
    throw commandFailure(exactArgs, exactResult);
  }
  const latestArgs = ["view", `${GITHUB_PACKAGE_NAME}@latest`, "version", `--registry=${GITHUB_PACKAGE_REGISTRY}`];
  const latestResult = run("npm", latestArgs);
  if (latestResult.status === 0) {
    const latestVersion = latestResult.stdout.trim();
    if (!/^\d+\.\d+\.\d+$/.test(latestVersion)) {
      throw new Error(`GitHub Packages latest returned an invalid version: ${JSON.stringify(latestVersion)}`);
    }
    try {
      assertVersionIncrease(latestVersion, version);
    } catch {
      throw new Error(
        `GitHub Packages latest ${latestVersion} is not older than missing target ${version}; refusing to move the latest dist-tag backward.`,
      );
    }
    return {
      latestVersion,
      published: false,
      version: null,
    };
  }
  if (!isNotFound(latestResult)) {
    throw commandFailure(latestArgs, latestResult);
  }
  return { latestVersion: null, published: false, version: null };
}

function main() {
  try {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const result = inspectGitHubPackageTarget({
      version: packageJson.version,
    });

    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `published=${String(result.published)}\n`, "utf8");
    }
    if (result.published) {
      console.log(`${GITHUB_PACKAGE_NAME}@${packageJson.version} is already published.`);
    } else if (result.latestVersion) {
      console.log(
        `::warning::GitHub Packages latest is ${result.latestVersion}; proceeding with the missing exact target ${packageJson.version} without requiring intermediate mirror versions.`,
      );
    } else {
      console.log(
        `::warning::GitHub Packages has no latest version; proceeding with the missing exact target ${packageJson.version}.`,
      );
    }
  } catch (error) {
    console.error(`GitHub Packages target check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
