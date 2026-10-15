import { describe, expect, it, vi } from "vitest";

import { loadHostFileLock } from "./file-lock.js";

describe("host file lock", () => {
  it("returns the host lock function", async () => {
    const withFileLock = vi.fn(async (_filePath: string, _options: unknown, fn: () => Promise<unknown>) => fn());
    await expect(loadHostFileLock(async () => ({ withFileLock: withFileLock as never }))).resolves.toBe(withFileLock);
  });

  it("rejects a file-lock module that does not export the function", async () => {
    await expect(loadHostFileLock(async () => ({}))).rejects.toThrow(
      "openclaw/plugin-sdk/file-lock does not export withFileLock",
    );
  });
});
