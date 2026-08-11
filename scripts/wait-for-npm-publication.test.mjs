import { describe, expect, it, vi } from "vitest";

import { waitForNpmPublication } from "./wait-for-npm-publication.mjs";

const VERSION = "3.2.0";

function npmResult(status, stderr = "", stdout = "") {
  return { status, stderr, stdout };
}

describe("exact npm publication wait", () => {
  it("returns immediately when the exact official-registry version exists", async () => {
    const run = vi.fn(() => npmResult(0, "", `${VERSION}\n`));
    const sleep = vi.fn();
    const report = vi.fn();

    await expect(
      waitForNpmPublication({ attempts: 3, intervalMs: 1, report, run, sleep, version: VERSION }),
    ).resolves.toEqual({
      attempts: 1,
      version: VERSION,
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith("npm", [
      "view",
      `openclaw-weixin@${VERSION}`,
      "version",
      "--registry=https://registry.npmjs.org",
    ]);
  });

  it("waits only on exact-version absence and then succeeds", async () => {
    const run = vi
      .fn()
      .mockReturnValueOnce(npmResult(1, "npm error code E404\n404 Not Found"))
      .mockReturnValueOnce(npmResult(0, "", `${VERSION}\n`));
    const sleep = vi.fn();

    await expect(
      waitForNpmPublication({ attempts: 3, intervalMs: 7, report: vi.fn(), run, sleep, version: VERSION }),
    ).resolves.toEqual({
      attempts: 2,
      version: VERSION,
    });
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(7);
  });

  it("fails closed on registry errors instead of treating them as propagation delay", async () => {
    const sleep = vi.fn();

    await expect(
      waitForNpmPublication({
        attempts: 3,
        intervalMs: 1,
        report: vi.fn(),
        run: () => npmResult(1, "registry request timed out"),
        sleep,
        version: VERSION,
      }),
    ).rejects.toThrow("registry request timed out");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rejects an unexpected exact-version response", async () => {
    await expect(
      waitForNpmPublication({
        attempts: 3,
        intervalMs: 1,
        report: vi.fn(),
        run: () => npmResult(0, "", "3.1.1\n"),
        sleep: vi.fn(),
        version: VERSION,
      }),
    ).rejects.toThrow('npmjs version mismatch: expected "3.2.0", found "3.1.1"');
  });

  it("stops after the configured number of absent exact checks", async () => {
    const run = vi.fn(() => npmResult(1, "npm error code E404\n404 Not Found"));
    const sleep = vi.fn();

    await expect(
      waitForNpmPublication({ attempts: 3, intervalMs: 1, report: vi.fn(), run, sleep, version: VERSION }),
    ).rejects.toThrow("after 3 exact checks");
    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
