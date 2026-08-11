import { describe, expect, it } from "vitest";

import { getClawHubPublicationBoundaryName, prepareClawHubPublication } from "./prepare-clawhub-publication.mjs";

const VERSION = "3.2.0";
const SOURCE_COMMIT = "1234567890abcdef1234567890abcdef12345678";
const SOURCE_REF = `refs/tags/v${VERSION}`;
const BOUNDARY_NAME = getClawHubPublicationBoundaryName({
  sourceCommit: SOURCE_COMMIT,
  version: VERSION,
});

function prepare(artifacts, checkRuns = []) {
  return prepareClawHubPublication({
    artifactListing: {
      artifacts,
      total_count: artifacts.length,
    },
    boundaryName: BOUNDARY_NAME,
    checkListing: {
      check_runs: checkRuns,
      total_count: checkRuns.length,
    },
    runAttempt: "2",
    runId: "12345",
    sourceCommit: SOURCE_COMMIT,
    sourceRef: SOURCE_REF,
    version: VERSION,
  });
}

describe("ClawHub publication recovery boundary", () => {
  it("blocks a duplicate publish after a prior run crossed the command boundary", () => {
    expect(() => prepare([{ id: 67890, name: BOUNDARY_NAME }])).toThrow(
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

  it("blocks after artifact expiry while allowing an authoritatively cleared boundary", () => {
    const activeBoundary = {
      app: { slug: "github-actions" },
      conclusion: null,
      id: 78901,
      name: BOUNDARY_NAME,
      status: "in_progress",
    };
    expect(() => prepare([], [activeBoundary])).toThrow(/durable publication boundary/);

    expect(
      prepare(
        [],
        [
          {
            ...activeBoundary,
            conclusion: "neutral",
            status: "completed",
          },
        ],
      ),
    ).toMatchObject({
      sourceCommit: SOURCE_COMMIT,
      version: VERSION,
    });
  });
});
