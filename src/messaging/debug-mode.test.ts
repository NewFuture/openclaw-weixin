import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../util/logger.js";

const mockStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "debug-mode-test-"));

vi.mock("../storage/state-dir.js", () => ({
  resolveStateDir: () => mockStateDir,
}));

vi.mock("../util/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { _resetForTest, isDebugMode, toggleDebugMode } from "./debug-mode.js";

describe("debug-mode", () => {
  beforeEach(() => {
    _resetForTest();
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetForTest();
    vi.restoreAllMocks();
  });

  it("defaults to off", () => {
    expect(isDebugMode("acc1")).toBe(false);
  });

  it("toggles on then off", () => {
    expect(toggleDebugMode("acc1")).toBe(true);
    expect(isDebugMode("acc1")).toBe(true);

    expect(toggleDebugMode("acc1")).toBe(false);
    expect(isDebugMode("acc1")).toBe(false);
  });

  it("is per-account", () => {
    toggleDebugMode("acc1");
    expect(isDebugMode("acc1")).toBe(true);
    expect(isDebugMode("acc2")).toBe(false);
  });

  it("toggles independently across accounts", () => {
    toggleDebugMode("acc1");
    toggleDebugMode("acc2");
    toggleDebugMode("acc1");

    expect(isDebugMode("acc1")).toBe(false);
    expect(isDebugMode("acc2")).toBe(true);
  });

  it("persists state to disk", () => {
    toggleDebugMode("acc1");

    const filePath = path.join(mockStateDir, "openclaw-weixin", "debug-mode.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(raw.accounts.acc1).toBe(true);
  });

  it("redacts save failures while preserving the toggled result", () => {
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw new Error("private-debug-payload C:\\sensitive\\debug-mode.json");
    });

    expect(toggleDebugMode("acc-failure")).toBe(true);

    expect(logger.error).toHaveBeenCalledWith("debug-mode: failed to persist state: Error");
    const diagnostics = vi.mocked(logger.error).mock.calls.flat().join(" ");
    expect(diagnostics).not.toContain("private-debug-payload");
    expect(diagnostics).not.toContain("debug-mode.json");
  });

  it("state survives re-read from disk (simulates restart)", () => {
    toggleDebugMode("acc1");
    expect(isDebugMode("acc1")).toBe(true);

    // isDebugMode re-reads from disk each time, so it reflects persisted state
    expect(isDebugMode("acc1")).toBe(true);
  });

  it("clean state after file deletion", () => {
    toggleDebugMode("acc1");
    _resetForTest();
    expect(isDebugMode("acc1")).toBe(false);
  });
});
