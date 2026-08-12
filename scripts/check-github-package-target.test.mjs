import { describe, expect, it, vi } from "vitest";

import { inspectGitHubPackageTarget } from "./check-github-package-target.mjs";

function result(status, stdout = "", stderr = "") {
  return { status, stderr, stdout };
}

describe("GitHub Packages target inspection", () => {
  it("skips an existing exact target without reading latest", () => {
    const run = vi.fn(() => result(0, "3.1.3\n"));

    expect(inspectGitHubPackageTarget({ run, version: "3.1.3" })).toEqual({
      latestVersion: null,
      published: true,
      version: "3.1.3",
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("allows a missing exact target when latest has an intermediate-version gap", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce(result(1, "", "npm error code E404"))
      .mockReturnValueOnce(result(0, "3.1.1\n"));

    expect(inspectGitHubPackageTarget({ run, version: "3.1.3" })).toEqual({
      latestVersion: "3.1.1",
      published: false,
      version: null,
    });
  });

  it("allows a missing exact target when the mirror is empty", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce(result(1, "", "404 Not Found"))
      .mockReturnValueOnce(result(1, "", "npm error code E404"));

    expect(inspectGitHubPackageTarget({ run, version: "3.1.3" })).toEqual({
      latestVersion: null,
      published: false,
      version: null,
    });
  });

  it("fails explicit lookup errors instead of treating them as missing", () => {
    expect(() =>
      inspectGitHubPackageTarget({
        run: () => result(1, "", "npm error code E401"),
        version: "3.1.3",
      }),
    ).toThrow("npm view @newfuture/openclaw-weixin@3.1.3");

    const run = vi
      .fn()
      .mockReturnValueOnce(result(1, "", "npm error code E404"))
      .mockReturnValueOnce(result(1, "", "npm error code E503"));
    expect(() => inspectGitHubPackageTarget({ run, version: "3.1.3" })).toThrow(
      "npm view @newfuture/openclaw-weixin@latest",
    );
  });

  it("rejects a malformed successful latest response", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce(result(1, "", "npm error code E404"))
      .mockReturnValueOnce(result(0, "unknown\n"));

    expect(() => inspectGitHubPackageTarget({ run, version: "3.1.3" })).toThrow(
      'GitHub Packages latest returned an invalid version: "unknown"',
    );
  });

  it("refuses to move the latest dist-tag backward for an older missing target", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce(result(1, "", "npm error code E404"))
      .mockReturnValueOnce(result(0, "3.2.0\n"));

    expect(() => inspectGitHubPackageTarget({ run, version: "3.1.3" })).toThrow(
      "GitHub Packages latest 3.2.0 is not older than missing target 3.1.3",
    );
  });

  it("supports an exact-only race recheck", () => {
    const run = vi.fn(() => result(1, "", "npm error code E404"));

    expect(
      inspectGitHubPackageTarget({
        checkLatest: false,
        run,
        version: "3.1.3",
      }),
    ).toEqual({
      latestVersion: null,
      published: false,
      version: null,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
