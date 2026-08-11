import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLAWHUB_PACKAGE_NAME = "openclaw-wechat";
const BOUNDARY_PREFIX = "clawhub-publication-boundary";
const NPM_PUBLICATION_JOB_NAME = "Approve and publish npmjs";

function assertMatch(value, pattern, label) {
  if (!pattern.test(value ?? "")) {
    throw new Error(`${label} is invalid: ${JSON.stringify(value)}`);
  }
}

function validateFirstAttemptJobListing(listing) {
  if (!Array.isArray(listing?.jobs) || !Number.isInteger(listing?.total_count)) {
    throw new Error("GitHub Actions returned an invalid first-attempt job listing");
  }
  if (listing.total_count !== listing.jobs.length) {
    throw new Error(
      `GitHub Actions returned an incomplete first-attempt job listing (${listing.jobs.length} of ${listing.total_count})`,
    );
  }
  return listing.jobs;
}

export function getClawHubPublicationBoundaryName({ sourceCommit, version }) {
  assertMatch(version, /^\d+\.\d+\.\d+$/, "release version");
  assertMatch(sourceCommit, /^[0-9a-f]{40}$/, "release source commit");
  return `${BOUNDARY_PREFIX}-v${version}-${sourceCommit}`;
}

export function prepareClawHubPublication({
  artifactListing,
  boundaryName,
  checkRunListing,
  firstAttemptJobListing,
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
  if (!Array.isArray(checkRunListing?.check_runs) || !Number.isInteger(checkRunListing?.total_count)) {
    throw new Error("GitHub Actions returned an invalid check-run listing");
  }
  if (checkRunListing.total_count !== checkRunListing.check_runs.length) {
    throw new Error(
      `GitHub Actions returned an incomplete check-run listing (${checkRunListing.check_runs.length} of ${checkRunListing.total_count})`,
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
      }. A prior run may have submitted this version. Do not publish it again until an authoritative ClawHub attempt/package check confirms no active or accepted attempt; then remove only that boundary artifact and dispatch the exact tag with authorize_clawhub_recovery enabled.`,
    );
  }
  const priorChecks = checkRunListing.check_runs.filter((checkRun) => checkRun?.name === boundaryName);
  if (priorChecks.length > 0 && !recoveryAuthorized) {
    const checkRunIds = priorChecks
      .map((checkRun) => checkRun.id)
      .filter((id) => Number.isInteger(id))
      .join(", ");
    throw new Error(
      `ClawHub ${CLAWHUB_PACKAGE_NAME}@${version} is still missing, but durable publication check ${boundaryName} already exists${
        checkRunIds ? ` (check-run IDs: ${checkRunIds})` : ""
      }. A prior run may have submitted this version. After authoritative ClawHub confirmation and removal of any boundary artifact, dispatch the exact tag with authorize_clawhub_recovery enabled.`,
    );
  }
  const parsedRunAttempt = Number(runAttempt);
  if (!Number.isInteger(parsedRunAttempt) || parsedRunAttempt <= 0) {
    throw new Error(`GitHub run attempt is invalid: ${JSON.stringify(runAttempt)}`);
  }
  if (npmjsPublishedBeforeJob && !recoveryAuthorized) {
    const npmJobFromFirstAttempt =
      parsedRunAttempt > 1
        ? validateFirstAttemptJobListing(firstAttemptJobListing).find((job) => job?.name === NPM_PUBLICATION_JOB_NAME)
        : undefined;
    if (
      !npmJobFromFirstAttempt ||
      typeof npmJobFromFirstAttempt.conclusion !== "string" ||
      npmJobFromFirstAttempt.conclusion === "skipped"
    ) {
      throw new Error(
        `ClawHub ${CLAWHUB_PACKAGE_NAME}@${version} is missing while npmjs already contained the release before this workflow run. Re-run the original failed workflow only when its first attempt entered the npm publication job. For an older partial release, first obtain authoritative ClawHub confirmation that no active or accepted attempt exists, then dispatch the exact tag with authorize_clawhub_recovery enabled.`,
      );
    }
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

export function getClawHubPublicationCheckRequest({ boundaryName, repository, runAttempt, runId, sourceCommit }) {
  assertMatch(boundaryName, /^clawhub-publication-boundary-v\d+\.\d+\.\d+-[0-9a-f]{40}$/, "boundary name");
  assertMatch(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "GitHub repository");
  assertMatch(String(runId), /^\d+$/, "GitHub run id");
  assertMatch(String(runAttempt), /^\d+$/, "GitHub run attempt");
  assertMatch(sourceCommit, /^[0-9a-f]{40}$/, "release source commit");
  return {
    name: boundaryName,
    head_sha: sourceCommit,
    status: "completed",
    conclusion: "neutral",
    external_id: `release-${runId}-${runAttempt}`,
    details_url: `https://github.com/${repository}/actions/runs/${runId}/attempts/${runAttempt}`,
    output: {
      title: "ClawHub publication boundary recorded",
      summary:
        "A ClawHub request may start after this durable marker. If the version remains absent, require authoritative attempt evidence before authorizing another request.",
    },
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
      !process.env.CLAWHUB_BOUNDARY_CHECK_REPORT ||
      !process.env.CLAWHUB_BOUNDARY_CHECK_REQUEST ||
      !process.env.CLAWHUB_BOUNDARY_MARKER ||
      !process.env.CLAWHUB_FIRST_ATTEMPT_JOBS_REPORT ||
      !process.env.NPMJS_PUBLISHED_BEFORE_JOB
    ) {
      throw new Error(
        "CLAWHUB_BOUNDARY_REPORT, CLAWHUB_BOUNDARY_CHECK_REPORT, CLAWHUB_BOUNDARY_CHECK_REQUEST, CLAWHUB_BOUNDARY_MARKER, CLAWHUB_FIRST_ATTEMPT_JOBS_REPORT, and NPMJS_PUBLISHED_BEFORE_JOB are required",
      );
    }
    const reportPath = path.resolve(process.env.CLAWHUB_BOUNDARY_REPORT);
    const checkReportPath = path.resolve(process.env.CLAWHUB_BOUNDARY_CHECK_REPORT);
    const checkRequestPath = path.resolve(process.env.CLAWHUB_BOUNDARY_CHECK_REQUEST);
    const markerPath = path.resolve(process.env.CLAWHUB_BOUNDARY_MARKER);
    const marker = prepareClawHubPublication({
      artifactListing: parseJsonFile(reportPath, "ClawHub publication boundary report"),
      boundaryName: process.env.CLAWHUB_BOUNDARY_NAME,
      checkRunListing: parseJsonFile(checkReportPath, "ClawHub publication boundary check report"),
      firstAttemptJobListing: parseJsonFile(
        path.resolve(process.env.CLAWHUB_FIRST_ATTEMPT_JOBS_REPORT),
        "first-attempt GitHub Actions jobs report",
      ),
      recoveryAuthorized: process.env.CLAWHUB_RECOVERY_AUTHORIZED === "true",
      npmjsPublishedBeforeJob: process.env.NPMJS_PUBLISHED_BEFORE_JOB === "true",
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      runId: process.env.GITHUB_RUN_ID,
      sourceCommit: process.env.GITHUB_SHA,
      sourceRef: process.env.GITHUB_REF,
      version: packageJson.version,
    });
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    const checkRequest = getClawHubPublicationCheckRequest({
      boundaryName: process.env.CLAWHUB_BOUNDARY_NAME,
      repository: process.env.GITHUB_REPOSITORY,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      runId: process.env.GITHUB_RUN_ID,
      sourceCommit: process.env.GITHUB_SHA,
    });
    writeFileSync(checkRequestPath, `${JSON.stringify(checkRequest, null, 2)}\n`, "utf8");
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
