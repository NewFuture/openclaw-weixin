import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectExactNpmTarget, runReleaseCommand } from "./resolve-release-targets.mjs";

const DEFAULT_ATTEMPTS = 40;
const DEFAULT_INTERVAL_MS = 15_000;

function parsePositiveInteger(value, label, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer, found ${JSON.stringify(value)}`);
  }
  return parsed;
}

export async function waitForNpmPublication({
  attempts = DEFAULT_ATTEMPTS,
  intervalMs = DEFAULT_INTERVAL_MS,
  report = console.log,
  run = runReleaseCommand,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  version,
}) {
  const boundedAttempts = parsePositiveInteger(attempts, "npm publication attempts", DEFAULT_ATTEMPTS);
  const boundedIntervalMs = parsePositiveInteger(intervalMs, "npm publication interval", DEFAULT_INTERVAL_MS);
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    throw new Error(`npm publication version must be a stable semantic version, found ${JSON.stringify(version)}`);
  }

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    const target = inspectExactNpmTarget({ run, version });
    if (target.published) {
      report(
        `Verified openclaw-weixin@${version} on the official npm registry (attempt ${attempt}/${boundedAttempts}).`,
      );
      return {
        attempts: attempt,
        version,
      };
    }
    if (attempt === boundedAttempts) {
      break;
    }
    report(
      `openclaw-weixin@${version} is not visible on the official npm registry; waiting ${boundedIntervalMs}ms (attempt ${attempt}/${boundedAttempts}).`,
    );
    await sleep(boundedIntervalMs);
  }

  throw new Error(
    `openclaw-weixin@${version} was not visible on the official npm registry after ${boundedAttempts} exact checks`,
  );
}

async function main() {
  try {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    await waitForNpmPublication({
      attempts: process.env.NPM_PUBLICATION_ATTEMPTS,
      intervalMs: process.env.NPM_PUBLICATION_INTERVAL_MS,
      version: packageJson.version,
    });
  } catch (error) {
    console.error(`npm publication wait failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
