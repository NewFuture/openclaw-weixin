import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLAWHUB_PACKAGE_NAME = "openclaw-wechat";
const BOUNDARY_PREFIX = "clawhub-publication-boundary";

function assertMatch(value, pattern, label) {
  if (!pattern.test(value ?? "")) {
    throw new Error(`${label} is invalid: ${JSON.stringify(value)}`);
  }
}

export function getClawHubPublicationBoundaryName({ sourceCommit, version }) {
  assertMatch(version, /^\d+\.\d+\.\d+$/, "release version");
  assertMatch(sourceCommit, /^[0-9a-f]{40}$/, "release source commit");
  return `${BOUNDARY_PREFIX}-v${version}-${sourceCommit}`;
}

export function prepareClawHubPublication({
  artifactListing,
  boundaryName,
  recoveryAuthorized,
  npmjsPublishedBeforeJob,
  runAttempt,
  runId,
  sourceCommit,
  sourceRef,
  version,
}) {
  const expectedBoundaryName = getClawHubPublicationBoundaryName({ sourceCommit, version });
  if (boundaryName !== expectedBoundaryName) {
    throw new Error(
      `ClawHub publication boundary name mismatch: expected ${JSON.stringify(expectedBoundaryName)}, found ${JSON.stringify(boundaryName)}`,
    );
  }
  if (!Array.isArray(artifactListing?.artifacts) || !Number.isInteger(artifactListing?.total_count)) {
    throw new Error("GitHub Actions returned an invalid artifact listing");
  }
  if (artifactListing.total_count !== artifactListing.artifacts.length) {
    throw new Error(
      `GitHub Actions returned an incomplete artifact listing (${artifactListing.artifacts.length} of ${artifactListing.total_count})`,
    );
  }
  const priorBoundaries = artifactListing.artifacts.filter((artifact) => artifact?.name === boundaryName);
  if (priorBoundaries.length > 0) {
    const artifactIds = priorBoundaries
      .map((artifact) => artifact.id)
      .filter((id) => Number.isInteger(id))
      .join(", ");
    throw new Error(
      `ClawHub ${CLAWHUB_PACKAGE_NAME}@${version} is still missing, but publication boundary ${boundaryName} already exists${
        artifactIds ? ` (artifact IDs: ${artifactIds})` : ""
      }. A prior run may have submitted this version. Do not publish it again until an authoritative ClawHub attempt/package check confirms no active or accepted attempt; then remove only that boundary artifact before rerunning the exact tag.`,
    );
  }
  const parsedRunAttempt = Number(runAttempt);
  if (!Number.isInteger(parsedRunAttempt) || parsedRunAttempt <= 0) {
    throw new Error(`GitHub run attempt is invalid: ${JSON.stringify(runAttempt)}`);
  }
  if (npmjsPublishedBeforeJob && parsedRunAttempt === 1 && !recoveryAuthorized) {
    throw new Error(
      `ClawHub ${CLAWHUB_PACKAGE_NAME}@${version} is missing while npmjs already contained the release before this workflow run. Re-run the original failed workflow attempt instead of starting a new dispatch. For an older partial release, first obtain authoritative ClawHub confirmation that no active or accepted attempt exists, then dispatch the exact tag with authorize_clawhub_recovery enabled.`,
    );
  }

  if (sourceRef !== `refs/tags/v${version}`) {
    throw new Error(`release ref mismatch: expected "refs/tags/v${version}", found ${JSON.stringify(sourceRef)}`);
  }
  assertMatch(String(runId), /^\d+$/, "GitHub run id");
  return {
    boundary: "publication-command-may-start",
    packageName: CLAWHUB_PACKAGE_NAME,
    runAttempt: parsedRunAttempt,
    runId: Number(runId),
    sourceCommit,
    sourceRef,
    version,
  };
}

function parseJsonFile(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function main() {
  try {
    const packageJson = parseJsonFile("package.json", "package.json");
    if (
      !process.env.CLAWHUB_BOUNDARY_REPORT ||
      !process.env.CLAWHUB_BOUNDARY_MARKER ||
      !process.env.NPMJS_PUBLISHED_BEFORE_JOB
    ) {
      throw new Error("CLAWHUB_BOUNDARY_REPORT, CLAWHUB_BOUNDARY_MARKER, and NPMJS_PUBLISHED_BEFORE_JOB are required");
    }
    const reportPath = path.resolve(process.env.CLAWHUB_BOUNDARY_REPORT);
    const markerPath = path.resolve(process.env.CLAWHUB_BOUNDARY_MARKER);
    const marker = prepareClawHubPublication({
      artifactListing: parseJsonFile(reportPath, "ClawHub publication boundary report"),
      boundaryName: process.env.CLAWHUB_BOUNDARY_NAME,
      recoveryAuthorized: process.env.CLAWHUB_RECOVERY_AUTHORIZED === "true",
      npmjsPublishedBeforeJob: process.env.NPMJS_PUBLISHED_BEFORE_JOB === "true",
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      runId: process.env.GITHUB_RUN_ID,
      sourceCommit: process.env.GITHUB_SHA,
      sourceRef: process.env.GITHUB_REF,
      version: packageJson.version,
    });
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `name=${process.env.CLAWHUB_BOUNDARY_NAME}\n`, "utf8");
    }
    console.log(`Prepared ClawHub publication boundary ${process.env.CLAWHUB_BOUNDARY_NAME}.`);
  } catch (error) {
    console.error(
      `ClawHub publication recovery check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
