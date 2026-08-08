import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../util/logger.js", () => ({ logger: mocks.logger }));

let stateDir: string;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-weixin-context-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  vi.stubEnv("OPENCLAW_OAUTH_DIR", path.join(stateDir, "oauth"));
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("context-token-store", () => {
  it("stores, retrieves, and overwrites an account-scoped token", async () => {
    const store = await loadStore();

    store.setContextToken("account-a", "user-a", "token-old");
    store.setContextToken("account-a", "user-a", "token-new");

    expect(store.getContextToken("account-a", "user-a")).toBe("token-new");
    expect(store.getContextToken("account-a", "unknown-user")).toBeUndefined();
  });

  it("normalizes mixed-case user IDs in memory and on disk", async () => {
    const store = await loadStore();

    store.setContextToken("account-case", "User-MiXeD@im.wechat", "token-old");
    store.setContextToken("account-case", "USER-MIXED@im.wechat", "token-new");

    expect(store.getContextToken("account-case", "user-mixed@im.wechat")).toBe("token-new");
    expect(store.findAccountIdsByContextToken(["account-case"], "USER-MIXED@im.wechat")).toEqual(["account-case"]);
    expect(readAccountFile("account-case")).toEqual({ "user-mixed@im.wechat": "token-new" });
    const debugLogs = mocks.logger.debug.mock.calls.flat().join(" ");
    expect(debugLogs).not.toContain("account-case");
    expect(debugLogs).not.toContain("User-MiXeD@im.wechat");
  });

  it("keeps distinct normalized user IDs separate within an account", async () => {
    const store = await loadStore();

    store.setContextToken("account-users", "User-One@im.wechat", "token-one");
    store.setContextToken("account-users", "User-Two@im.wechat", "token-two");

    expect(store.getContextToken("account-users", "user-one@im.wechat")).toBe("token-one");
    expect(store.getContextToken("account-users", "user-two@im.wechat")).toBe("token-two");
    expect(readAccountFile("account-users")).toEqual({
      "user-one@im.wechat": "token-one",
      "user-two@im.wechat": "token-two",
    });
  });

  it("restores a mixed-case token for lowercase lookup after a fresh module load", async () => {
    const firstStore = await loadStore();
    firstStore.setContextToken("account-restart", "User-Restart@im.wechat", "token-persisted");

    vi.resetModules();
    const restartedStore = await loadStore();
    expect(restartedStore.getContextToken("account-restart", "user-restart@im.wechat")).toBeUndefined();

    restartedStore.restoreContextTokens("account-restart");

    expect(restartedStore.getContextToken("account-restart", "user-restart@im.wechat")).toBe("token-persisted");
    const logs = [...mocks.logger.debug.mock.calls, ...mocks.logger.info.mock.calls].flat().join(" ");
    expect(logs).not.toContain("account-restart");
    expect(logs).not.toContain("User-Restart@im.wechat");
  });

  it("restores legacy persisted mixed-case keys", async () => {
    writeAccountFile("account-legacy", { "User-Legacy@im.wechat": "token-legacy" });
    const store = await loadStore();

    store.restoreContextTokens("account-legacy");

    expect(store.getContextToken("account-legacy", "user-legacy@im.wechat")).toBe("token-legacy");
  });

  it("keeps identical user IDs isolated across accounts on disk and in memory", async () => {
    const store = await loadStore();
    store.setContextToken("account-a", "shared-user", "token-account-a");
    store.setContextToken("account-b", "shared-user", "token-account-b");

    expect(store.getContextToken("account-a", "shared-user")).toBe("token-account-a");
    expect(store.getContextToken("account-b", "shared-user")).toBe("token-account-b");
    expect(store.findAccountIdsByContextToken(["account-a", "account-b", "account-c"], "shared-user")).toEqual([
      "account-a",
      "account-b",
    ]);
    expect(readAccountFile("account-a")).toEqual({ "shared-user": "token-account-a" });
    expect(readAccountFile("account-b")).toEqual({ "shared-user": "token-account-b" });
  });

  it("clears only the requested account from memory and disk", async () => {
    const store = await loadStore();
    store.setContextToken("account-a", "shared-user", "token-account-a");
    store.setContextToken("account-b", "shared-user", "token-account-b");

    store.clearContextTokensForAccount("account-a");

    expect(store.getContextToken("account-a", "shared-user")).toBeUndefined();
    expect(store.getContextToken("account-b", "shared-user")).toBe("token-account-b");
    expect(fs.existsSync(accountFilePath("account-a"))).toBe(false);
    expect(fs.existsSync(accountFilePath("account-b"))).toBe(true);
    expect(mocks.logger.info.mock.calls.flat().join(" ")).not.toContain("account-a");
  });

  it("surfaces malformed persisted state through the logger without restoring data", async () => {
    const filePath = accountFilePath("account-invalid");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{not-json", "utf-8");
    const store = await loadStore();

    expect(() => store.restoreContextTokens("account-invalid")).not.toThrow();
    expect(store.getContextToken("account-invalid", "user-a")).toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining("restoreContextTokens: failed"));
    expect(mocks.logger.warn.mock.calls.flat().join(" ")).not.toContain("account-invalid");
  });

  it("redacts account-scoped paths from filesystem error logs", async () => {
    const store = await loadStore();
    const persistPath = accountFilePath("account-persist-error");
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw new Error(`denied ${persistPath}`);
    });

    store.setContextToken("account-persist-error", "user-persist", "token-persist");

    const restorePath = accountFilePath("account-restore-error");
    writeAccountFile("account-restore-error", { "User-Restore": "token-restore" });
    vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw new Error(`denied ${restorePath}`);
    });

    store.restoreContextTokens("account-restore-error");

    const clearPath = accountFilePath("account-clear-error");
    writeAccountFile("account-clear-error", { "user-clear": "token-clear" });
    vi.spyOn(fs, "unlinkSync").mockImplementationOnce(() => {
      throw new Error(`denied ${clearPath}`);
    });

    store.clearContextTokensForAccount("account-clear-error");

    const warnings = mocks.logger.warn.mock.calls.flat().join(" ");
    expect(warnings.match(/<state-file>/g)).toHaveLength(3);
    expect(warnings).not.toContain("account-persist-error");
    expect(warnings).not.toContain("account-restore-error");
    expect(warnings).not.toContain("account-clear-error");
  });
});

async function loadStore(): Promise<typeof import("./inbound.js")> {
  return import("./inbound.js");
}

function accountFilePath(accountId: string): string {
  return path.join(stateDir, "openclaw-weixin", "accounts", `${accountId}.context-tokens.json`);
}

function readAccountFile(accountId: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(accountFilePath(accountId), "utf-8")) as Record<string, string>;
}

function writeAccountFile(accountId: string, tokens: Record<string, string>): void {
  const filePath = accountFilePath(accountId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(tokens), "utf-8");
}
