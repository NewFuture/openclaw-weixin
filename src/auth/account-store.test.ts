import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearStaleAccountsForUserId,
  clearWeixinAccount,
  listIndexedWeixinAccountIds,
  loadWeixinAccount,
  registerWeixinAccountId,
  saveWeixinAccount,
} from "./accounts.js";
import { resolveFrameworkAllowFromPath } from "./pairing.js";

// Mock dependencies before importing module under test
vi.mock("../util/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Use a temp directory for all fs operations
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "account-store-test-"));
  process.env.OPENCLAW_STATE_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.OPENCLAW_STATE_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadWeixinAccount", () => {
  it("returns null when no account file exists", () => {
    expect(loadWeixinAccount("nonexistent")).toBeNull();
  });

  it("loads account data from primary path", () => {
    const dir = path.join(tmpDir, "openclaw-weixin", "accounts");
    fs.mkdirSync(dir, { recursive: true });
    const data = { token: "tk", savedAt: "2024-01-01", baseUrl: "https://example.com" };
    fs.writeFileSync(path.join(dir, "myacc.json"), JSON.stringify(data));
    const result = loadWeixinAccount("myacc");
    expect(result).toEqual(data);
  });

  it("falls back to raw accountId (compat path) for -im-bot suffix", () => {
    const dir = path.join(tmpDir, "openclaw-weixin", "accounts");
    fs.mkdirSync(dir, { recursive: true });
    const data = { token: "old-token" };
    // Write at old raw ID path
    fs.writeFileSync(path.join(dir, "abc@im.bot.json"), JSON.stringify(data));
    const result = loadWeixinAccount("abc-im-bot");
    expect(result).toEqual(data);
  });

  it("falls back to legacy credentials path", () => {
    const legacyDir = path.join(tmpDir, "credentials", "openclaw-weixin");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "credentials.json"), JSON.stringify({ token: "legacy-tk" }));
    const result = loadWeixinAccount("some-acc");
    expect(result).toEqual({ token: "legacy-tk" });
  });

  it("returns null on corrupted file", () => {
    const dir = path.join(tmpDir, "openclaw-weixin", "accounts");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "bad.json"), "not json");
    expect(loadWeixinAccount("bad")).toBeNull();
  });
});

describe("saveWeixinAccount", () => {
  it("saves token and baseUrl", () => {
    saveWeixinAccount("acc1", { token: "tok", baseUrl: "https://api.example.com" });
    const data = loadWeixinAccount("acc1");
    expect(data?.token).toBe("tok");
    expect(data?.baseUrl).toBe("https://api.example.com");
    expect(data?.savedAt).toBeDefined();
  });

  it("merges with existing data", () => {
    saveWeixinAccount("acc3", { token: "tok1", baseUrl: "https://a.com" });
    saveWeixinAccount("acc3", { baseUrl: "https://b.com" });
    const data = loadWeixinAccount("acc3");
    expect(data?.token).toBe("tok1");
    expect(data?.baseUrl).toBe("https://b.com");
  });

  it("creates directory if it does not exist", () => {
    const accountsDir = path.join(tmpDir, "openclaw-weixin", "accounts");
    expect(fs.existsSync(accountsDir)).toBe(false);
    saveWeixinAccount("new-acc", { token: "tok" });
    expect(fs.existsSync(accountsDir)).toBe(true);
  });
});

describe("clearWeixinAccount", () => {
  it("removes all account-owned state files", () => {
    saveWeixinAccount("acc-del", { token: "tok" });
    const accountsDir = path.join(tmpDir, "openclaw-weixin", "accounts");
    const syncPath = path.join(accountsDir, "acc-del.sync.json");
    const contextPath = path.join(accountsDir, "acc-del.context-tokens.json");
    const allowFromPath = resolveFrameworkAllowFromPath("acc-del");
    fs.mkdirSync(path.dirname(allowFromPath), { recursive: true });
    fs.writeFileSync(syncPath, "{}");
    fs.writeFileSync(contextPath, "{}");
    fs.writeFileSync(allowFromPath, "{}");

    expect(loadWeixinAccount("acc-del")).not.toBeNull();
    clearWeixinAccount("acc-del");

    expect(loadWeixinAccount("acc-del")).toBeNull();
    expect(fs.existsSync(syncPath)).toBe(false);
    expect(fs.existsSync(contextPath)).toBe(false);
    expect(fs.existsSync(allowFromPath)).toBe(false);
  });

  it("does not throw when file does not exist", () => {
    expect(() => clearWeixinAccount("nonexistent")).not.toThrow();
  });
});

describe("clearStaleAccountsForUserId", () => {
  it("removes only older accounts linked to the same user", () => {
    saveWeixinAccount("account-current", {
      token: "token-current",
      userId: "user-shared",
    });
    saveWeixinAccount("account-stale", {
      token: "token-stale",
      userId: "user-shared",
    });
    saveWeixinAccount("account-other", {
      token: "token-other",
      userId: "user-other",
    });
    registerWeixinAccountId("account-current");
    registerWeixinAccountId("account-stale");
    registerWeixinAccountId("account-other");
    const clearContextTokens = vi.fn();

    clearStaleAccountsForUserId("account-current", "user-shared", clearContextTokens);

    expect(listIndexedWeixinAccountIds()).toEqual(["account-current", "account-other"]);
    expect(loadWeixinAccount("account-stale")).toBeNull();
    expect(loadWeixinAccount("account-current")).not.toBeNull();
    expect(clearContextTokens).toHaveBeenCalledOnce();
    expect(clearContextTokens).toHaveBeenCalledWith("account-stale");
  });
});
