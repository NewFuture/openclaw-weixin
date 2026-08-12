import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { checkVersionFiles, findReleaseTransition } from "./check-versions.mjs";

function runGit(rootDirectory, args) {
  const result = spawnSync("git", args, {
    cwd: rootDirectory,
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`could not run git ${args[0]}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || `exit status ${result.status}`}`);
  }
  return result.stdout.trim();
}

function readVersionAtCommit(rootDirectory, commit) {
  const packageJson = JSON.parse(runGit(rootDirectory, ["show", `${commit}:package.json`]));
  return packageJson.version;
}

export function resolveReleaseTransition(rootDirectory = process.cwd()) {
  const { tag, version } = checkVersionFiles(rootDirectory);
  const commits = runGit(rootDirectory, ["rev-list", "--first-parent", "HEAD"]).split(/\r?\n/).filter(Boolean);
  const history = commits.map((commit) => ({
    commit,
    version: readVersionAtCommit(rootDirectory, commit),
  }));
  const { previousVersion, releaseCommit } = findReleaseTransition(history, version);

  return {
    previousReleaseVersion: previousVersion,
    releaseCommit,
    tag,
    version,
  };
}

function run() {
  try {
    const result = resolveReleaseTransition();
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        [`release_commit=${result.releaseCommit}`, `tag=${result.tag}`, `version=${result.version}`, ""].join("\n"),
        "utf8",
      );
    }
    console.log(
      `Release transition resolved: ${result.tag} at ${result.releaseCommit}, after ${result.previousReleaseVersion}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Release transition failed: ${message}`);
    process.exitCode = 1;
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedUrl) {
  run();
}
