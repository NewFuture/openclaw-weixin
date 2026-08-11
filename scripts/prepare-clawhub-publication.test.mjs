import { describe, expect, it } from "vitest";

import { getClawHubPublicationBoundaryName, prepareClawHubPublication } from "./prepare-clawhub-publication.mjs";

const VERSION = "3.2.0";
const SOURCE_COMMIT = "1234567890abcdef1234567890abcdef12345678";
const SOURCE_REF = `refs/tags/v${VERSION}`;
const BOUNDARY_NAME = getClawHubPublicationBoundaryName({
  sourceCommit: SOURCE_COMMIT,
  version: VERSION,
});

function prepare(artifacts, { npmjsPublishedBeforeJob = false, recoveryAuthorized = false, runAttempt = "1" } = {}) {
  return prepareClawHubPublication({
    artifactListing: {
      artifacts,
      total_count: artifacts.length,
    },
    boundaryName: BOUNDARY_NAME,
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

  it("does not let another release's boundary block the current exact tag and commit", () => {
    const marker = prepare([
      {
        id: 67890,
        name: "clawhub-publication-boundary-v3.1.1-abcdef1234567890abcdef1234567890abcdef12",
      },
    ]);

    expect(marker).toMatchObject({
      boundary: "publication-command-may-start",
      packageName: "openclaw-wechat",
      sourceCommit: SOURCE_COMMIT,
      sourceRef: SOURCE_REF,
      version: VERSION,
    });
  });

  it("requires explicit authorization for a new dispatch of an older partial release", () => {
    expect(() => prepare([], { npmjsPublishedBeforeJob: true })).toThrow(
      /dispatch the exact tag with authorize_clawhub_recovery enabled/,
    );
    expect(prepare([], { npmjsPublishedBeforeJob: true, runAttempt: "2" })).toMatchObject({
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
});
