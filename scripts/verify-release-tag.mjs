import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function runGit(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`could not run git ${args[0]}: ${result.error.message}`);
  }
  return {
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

export function verifyReleaseTag({ expectedCommit, expectedRef, repository = "origin", run = runGit }) {
  if (!/^[0-9a-f]{40}$/.test(expectedCommit ?? "")) {
    throw new Error(
      `expected release commit must be a full lowercase Git SHA, found ${JSON.stringify(expectedCommit)}`,
    );
  }
  if (!/^refs\/tags\/v\d+\.\d+\.\d+$/.test(expectedRef ?? "")) {
    throw new Error(`expected release ref must be an exact stable version tag, found ${JSON.stringify(expectedRef)}`);
  }

  const result = run(["ls-remote", "--exit-code", repository, expectedRef]);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`;
    throw new Error(`could not resolve live release tag ${expectedRef}: ${detail}`);
  }
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(`expected one live release tag result for ${expectedRef}, found ${lines.length}`);
  }
  const [actualCommit, actualRef, ...extraFields] = lines[0].split(/\s+/);
  if (extraFields.length > 0 || actualRef !== expectedRef || !/^[0-9a-f]{40}$/.test(actualCommit ?? "")) {
    throw new Error(`live release tag query returned an invalid result for ${expectedRef}`);
  }
  if (actualCommit !== expectedCommit) {
    throw new Error(
      `live release tag ${expectedRef} resolves to ${actualCommit}, not workflow commit ${expectedCommit}`,
    );
  }
  return {
    commit: actualCommit,
    ref: actualRef,
  };
}

function main() {
  try {
    const result = verifyReleaseTag({
      expectedCommit: process.env.GITHUB_SHA,
      expectedRef: process.env.GITHUB_REF,
    });
    console.log(`Live release tag verified: ${result.ref} at ${result.commit}.`);
  } catch (error) {
    console.error(`Live release tag verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
