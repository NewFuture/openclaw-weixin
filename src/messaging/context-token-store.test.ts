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
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
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

  it("restores persisted tokens after a fresh module load", async () => {
    const firstStore = await loadStore();
    firstStore.setContextToken("account-restart", "user-restart", "token-persisted");

    vi.resetModules();
    const restartedStore = await loadStore();
    expect(restartedStore.getContextToken("account-restart", "user-restart")).toBeUndefined();

    restartedStore.restoreContextTokens("account-restart");

    expect(restartedStore.getContextToken("account-restart", "user-restart")).toBe("token-persisted");
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
  });

  it("surfaces malformed persisted state through the logger without restoring data", async () => {
    const filePath = accountFilePath("account-invalid");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{not-json", "utf-8");
    const store = await loadStore();

    expect(() => store.restoreContextTokens("account-invalid")).not.toThrow();
    expect(store.getContextToken("account-invalid", "user-a")).toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining("restoreContextTokens: failed"));
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
