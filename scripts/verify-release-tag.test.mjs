import { describe, expect, it, vi } from "vitest";

import { resolveReleaseTagExpectation, verifyReleaseTag } from "./verify-release-tag.mjs";

const EXPECTED_COMMIT = "1234567890abcdef1234567890abcdef12345678";
const EXPECTED_REF = "refs/tags/v3.2.0";

describe("live release tag verification", () => {
  it("prefers explicit recovery expectations over workflow event values", () => {
    expect(
      resolveReleaseTagExpectation({
        GITHUB_REF: "refs/heads/main",
        GITHUB_SHA: "abcdef1234567890abcdef1234567890abcdef12",
        RELEASE_COMMIT: EXPECTED_COMMIT,
        RELEASE_REF: EXPECTED_REF,
      }),
    ).toEqual({
      expectedCommit: EXPECTED_COMMIT,
      expectedRef: EXPECTED_REF,
    });
  });

  it("falls back to workflow event values for coordinated releases", () => {
    expect(
      resolveReleaseTagExpectation({
        GITHUB_REF: EXPECTED_REF,
        GITHUB_SHA: EXPECTED_COMMIT,
      }),
    ).toEqual({
      expectedCommit: EXPECTED_COMMIT,
      expectedRef: EXPECTED_REF,
    });
  });

  it("accepts the one exact remote tag result", () => {
    const run = vi.fn(() => ({
      status: 0,
      stderr: "",
      stdout: `${EXPECTED_COMMIT}\t${EXPECTED_REF}\n`,
    }));

    expect(
      verifyReleaseTag({
        expectedCommit: EXPECTED_COMMIT,
        expectedRef: EXPECTED_REF,
        run,
      }),
    ).toEqual({
      commit: EXPECTED_COMMIT,
      ref: EXPECTED_REF,
    });
    expect(run).toHaveBeenCalledWith(["ls-remote", "--exit-code", "origin", EXPECTED_REF]);
  });

  it("rejects a tag moved after the workflow started", () => {
    const movedCommit = "abcdef1234567890abcdef1234567890abcdef12";

    expect(() =>
      verifyReleaseTag({
        expectedCommit: EXPECTED_COMMIT,
        expectedRef: EXPECTED_REF,
        run: () => ({
          status: 0,
          stderr: "",
          stdout: `${movedCommit}\t${EXPECTED_REF}\n`,
        }),
      }),
    ).toThrow(`live release tag ${EXPECTED_REF} resolves to ${movedCommit}, not workflow commit ${EXPECTED_COMMIT}`);
  });
});
