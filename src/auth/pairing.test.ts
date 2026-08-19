import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMocks, mockWithFileLock } = vi.hoisted(() => ({
  loggerMocks: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockWithFileLock: vi.fn(async (_path: string, _opts: unknown, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../util/logger.js", () => ({
  logger: loggerMocks,
}));

vi.mock("openclaw/plugin-sdk/infra-runtime", () => ({
  withFileLock: mockWithFileLock,
}));

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pairing-test-"));
  process.env.OPENCLAW_STATE_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_OAUTH_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function loadModule() {
  vi.resetModules();
  return await import("./pairing.js");
}

describe("resolveFrameworkAllowFromPath", () => {
  it("returns correct path for a given accountId", async () => {
    const { resolveFrameworkAllowFromPath } = await loadModule();
    const result = resolveFrameworkAllowFromPath("test-account");
    expect(result).toBe(path.join(tmpDir, "credentials", "openclaw-weixin-test-account-allowFrom.json"));
  });

  it("respects OPENCLAW_OAUTH_DIR override", async () => {
    const customDir = path.join(tmpDir, "custom-creds");
    process.env.OPENCLAW_OAUTH_DIR = customDir;
    const { resolveFrameworkAllowFromPath } = await loadModule();
    const result = resolveFrameworkAllowFromPath("my-bot");
    expect(result).toBe(path.join(customDir, "openclaw-weixin-my-bot-allowFrom.json"));
  });

  it("sanitizes special characters in accountId", async () => {
    const { resolveFrameworkAllowFromPath } = await loadModule();
    const result = resolveFrameworkAllowFromPath("abc@im.bot");
    // Only [\\/:*?"<>|] and ".." are replaced; @ and dots are preserved
    expect(result).toContain("openclaw-weixin-abc@im.bot-allowFrom.json");
  });
});

describe("registerUserInFrameworkStore", () => {
  it("creates file and adds userId when file does not exist", async () => {
    const { registerUserInFrameworkStore, resolveFrameworkAllowFromPath } = await loadModule();
    const result = await registerUserInFrameworkStore({
      accountId: "acc1",
      userId: "user-abc",
    });
    expect(result.changed).toBe(true);

    const filePath = resolveFrameworkAllowFromPath("acc1");
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content).toEqual({ version: 1, allowFrom: ["user-abc"] });
  });

  it("appends userId to existing allowFrom list", async () => {
    const { registerUserInFrameworkStore, resolveFrameworkAllowFromPath } = await loadModule();
    const filePath = resolveFrameworkAllowFromPath("acc2");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, allowFrom: ["existing-user"] }), "utf-8");

    const result = await registerUserInFrameworkStore({
      accountId: "acc2",
      userId: "new-user",
    });
    expect(result.changed).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.allowFrom).toEqual(["existing-user", "new-user"]);
  });

  it("masks user and account identifiers in registration diagnostics", async () => {
    const accountId = "private-account-1234";
    const userId = "private-user-5678";
    const { registerUserInFrameworkStore } = await loadModule();

    await registerUserInFrameworkStore({ accountId, userId });

    const logged = loggerMocks.info.mock.calls.flat().join(" ");
    for (const sensitive of [accountId, accountId.slice(0, 6), userId, userId.slice(0, 6)]) {
      expect(logged).not.toContain(sensitive);
    }
  });

  it("returns changed=false when userId already exists", async () => {
    const { registerUserInFrameworkStore, resolveFrameworkAllowFromPath } = await loadModule();
    const filePath = resolveFrameworkAllowFromPath("acc3");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, allowFrom: ["user-abc"] }), "utf-8");

    const result = await registerUserInFrameworkStore({
      accountId: "acc3",
      userId: "user-abc",
    });
    expect(result.changed).toBe(false);

    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.allowFrom).toEqual(["user-abc"]);
  });

  it("returns changed=false for empty userId", async () => {
    const { registerUserInFrameworkStore } = await loadModule();
    const result = await registerUserInFrameworkStore({
      accountId: "acc4",
      userId: "  ",
    });
    expect(result.changed).toBe(false);
  });

  it("trims userId before storing", async () => {
    const { registerUserInFrameworkStore, resolveFrameworkAllowFromPath } = await loadModule();
    await registerUserInFrameworkStore({
      accountId: "acc5",
      userId: "  user-trimmed  ",
    });

    const filePath = resolveFrameworkAllowFromPath("acc5");
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.allowFrom).toEqual(["user-trimmed"]);
  });

  it("uses withFileLock for concurrency safety", async () => {
    mockWithFileLock.mockClear();
    const { registerUserInFrameworkStore } = await loadModule();
    await registerUserInFrameworkStore({
      accountId: "acc6",
      userId: "user-lock",
    });

    expect(mockWithFileLock).toHaveBeenCalledTimes(1);
    const firstCall = mockWithFileLock.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error("withFileLock was not called");
    const [lockPath, lockOpts] = firstCall;
    expect(lockPath).toContain("openclaw-weixin-acc6-allowFrom.json");
    expect(lockOpts).toHaveProperty("retries");
    expect(lockOpts).toHaveProperty("stale");
  });

  it("handles corrupted file gracefully", async () => {
    const { registerUserInFrameworkStore, resolveFrameworkAllowFromPath } = await loadModule();
    const filePath = resolveFrameworkAllowFromPath("acc7");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "not-valid-json{{{", "utf-8");

    const result = await registerUserInFrameworkStore({
      accountId: "acc7",
      userId: "user-recover",
    });
    expect(result.changed).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.allowFrom).toEqual(["user-recover"]);
  });
});
