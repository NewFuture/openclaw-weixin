import { describe, expect, it } from "vitest";

import {
  getClawHubPublicationBoundaryName,
  getClawHubPublicationCheckRequest,
  prepareClawHubPublication,
} from "./prepare-clawhub-publication.mjs";

const VERSION = "3.2.0";
const SOURCE_COMMIT = "1234567890abcdef1234567890abcdef12345678";
const SOURCE_REF = `refs/tags/v${VERSION}`;
const BOUNDARY_NAME = getClawHubPublicationBoundaryName({
  sourceCommit: SOURCE_COMMIT,
  version: VERSION,
});

function prepare(
  artifacts,
  {
    checkRuns = [],
    firstAttemptJobs = [],
    npmjsPublishedBeforeJob = false,
    recoveryAuthorized = false,
    runAttempt = "1",
  } = {},
) {
  return prepareClawHubPublication({
    artifactListing: {
      artifacts,
      total_count: artifacts.length,
    },
    boundaryName: BOUNDARY_NAME,
    checkRunListing: {
      check_runs: checkRuns,
      total_count: checkRuns.length,
    },
    firstAttemptJobListing: {
      jobs: firstAttemptJobs,
      total_count: firstAttemptJobs.length,
    },
    npmjsPublishedBeforeJob,
    recoveryAuthorized,
    runAttempt,
    runId: "12345",
    sourceCommit: SOURCE_COMMIT,
    sourceRef: SOURCE_REF,
    version: VERSION,
  });
}

describe("ClawHub publication recovery boundary", () => {
  it("blocks a duplicate publish after a prior run crossed the command boundary", () => {
    const boundary = [{ id: 67890, name: BOUNDARY_NAME }];
    expect(() => prepare(boundary)).toThrow(/A prior run may have submitted this version\. Do not publish it again/);
    expect(() => prepare(boundary, { recoveryAuthorized: true })).toThrow(
      /A prior run may have submitted this version\. Do not publish it again/,
    );
  });

  it("blocks a duplicate publish after the boundary artifact expires", () => {
    const checkRuns = [{ id: 78901, name: BOUNDARY_NAME }];
    expect(() => prepare([], { checkRuns })).toThrow(
      /durable publication check .* already exists.*A prior run may have submitted this version/,
    );
  });

  it("requires explicit recovery authorization to cross a prior durable check", () => {
    const checkRuns = [{ id: 78901, name: BOUNDARY_NAME }];

    expect(prepare([], { checkRuns, recoveryAuthorized: true })).toMatchObject({
      sourceCommit: SOURCE_COMMIT,
      version: VERSION,
    });
  });

  it("fails closed when the durable check listing is incomplete", () => {
    expect(() =>
      prepareClawHubPublication({
        artifactListing: {
          artifacts: [],
          total_count: 0,
        },
        boundaryName: BOUNDARY_NAME,
        checkRunListing: {
          check_runs: [],
          total_count: 1,
        },
        npmjsPublishedBeforeJob: false,
        recoveryAuthorized: false,
        runAttempt: "1",
        runId: "12345",
        sourceCommit: SOURCE_COMMIT,
        sourceRef: SOURCE_REF,
        version: VERSION,
      }),
    ).toThrow("incomplete check-run listing");
  });

  it("does not let another release's boundary block the current exact tag and commit", () => {
    const unrelatedBoundaryName = "clawhub-publication-boundary-v3.1.1-abcdef1234567890abcdef1234567890abcdef12";
    const marker = prepare([{ id: 67890, name: unrelatedBoundaryName }], {
      checkRuns: [{ id: 78901, name: unrelatedBoundaryName }],
    });

    expect(marker).toMatchObject({
      boundary: "publication-command-may-start",
      packageName: "openclaw-wechat",
      sourceCommit: SOURCE_COMMIT,
      sourceRef: SOURCE_REF,
      version: VERSION,
    });
  });

  it("directs evidence-based artifact recovery through an explicitly authorized dispatch", () => {
    expect(() => prepare([{ id: 67890, name: BOUNDARY_NAME }])).toThrow(
      /remove only that boundary artifact and dispatch the exact tag with authorize_clawhub_recovery enabled/,
    );
  });

  it("requires explicit authorization for a new dispatch of an older partial release", () => {
    expect(() => prepare([], { npmjsPublishedBeforeJob: true })).toThrow(
      /dispatch the exact tag with authorize_clawhub_recovery enabled/,
    );
    expect(
      prepare([], {
        firstAttemptJobs: [{ conclusion: "success", name: "Approve and publish npmjs" }],
        npmjsPublishedBeforeJob: true,
        runAttempt: "2",
      }),
    ).toMatchObject({
      sourceCommit: SOURCE_COMMIT,
      version: VERSION,
    });
    expect(
      prepare([], {
        npmjsPublishedBeforeJob: true,
        recoveryAuthorized: true,
      }),
    ).toMatchObject({
      sourceCommit: SOURCE_COMMIT,
      version: VERSION,
    });
  });

  it("does not let a rerun turn an unauthorized npm-only dispatch into recovery", () => {
    expect(() =>
      prepare([], {
        firstAttemptJobs: [{ conclusion: "skipped", name: "Approve and publish npmjs" }],
        npmjsPublishedBeforeJob: true,
        runAttempt: "2",
      }),
    ).toThrow(/dispatch the exact tag with authorize_clawhub_recovery enabled/);
  });

  it("creates a run-attempt-specific durable check request for the exact boundary", () => {
    expect(
      getClawHubPublicationCheckRequest({
        boundaryName: BOUNDARY_NAME,
        repository: "NewFuture/openclaw-weixin",
        runAttempt: "2",
        runId: "12345",
        sourceCommit: SOURCE_COMMIT,
      }),
    ).toEqual({
      name: BOUNDARY_NAME,
      head_sha: SOURCE_COMMIT,
      status: "completed",
      conclusion: "neutral",
      external_id: "release-12345-2",
      details_url: "https://github.com/NewFuture/openclaw-weixin/actions/runs/12345/attempts/2",
      output: {
        title: "ClawHub publication boundary recorded",
        summary:
          "A ClawHub request may start after this durable marker. If the version remains absent, require authoritative attempt evidence before authorizing another request.",
      },
    });
  });
});
