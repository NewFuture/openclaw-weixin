import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configRuntimeMocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  writeConfigFile: vi.fn(),
}));

import {
  clearStaleAccountsForUserId,
  clearWeixinAccount,
  listIndexedWeixinAccountIds,
  listWeixinAccountIds,
  loadConfigBotAgent,
  loadConfigRouteTag,
  loadWeixinAccount,
  migrateBoundAccountToAlias,
  persistWeixinLoginAccounts,
  registerWeixinAccountId,
  resolveAliasForPrimaryAccountId,
  resolveLoginAccountAlias,
  resolvePrimaryAccountId,
  resolvePublicAccountId,
  resolveWeixinAccount,
  saveWeixinAccount,
  triggerWeixinChannelReload,
} from "./accounts.js";
import { resolveFrameworkAllowFromPath } from "./pairing.js";

vi.mock("openclaw/plugin-sdk/config-runtime", () => configRuntimeMocks);

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
  configRuntimeMocks.loadConfig.mockReset();
  configRuntimeMocks.writeConfigFile.mockReset();
});

afterEach(() => {
  delete process.env.OPENCLAW_STATE_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("raw channel config", () => {
  it("loads documented botAgent and numeric routeTag values", () => {
    const configPath = path.join(tmpDir, "openclaw.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        channels: {
          "openclaw-weixin": {
            botAgent: "MyBot/1.2.0",
            routeTag: 42,
          },
        },
      }),
    );
    const previousConfigPath = process.env.OPENCLAW_CONFIG;
    process.env.OPENCLAW_CONFIG = configPath;

    try {
      expect(loadConfigBotAgent()).toBe("MyBot/1.2.0");
      expect(loadConfigRouteTag()).toBe("42");
    } finally {
      if (previousConfigPath === undefined) {
        delete process.env.OPENCLAW_CONFIG;
      } else {
        process.env.OPENCLAW_CONFIG = previousConfigPath;
      }
    }
  });

  it("preserves channel config while bumping the reload timestamp", async () => {
    configRuntimeMocks.loadConfig.mockReturnValue({
      channels: {
        "openclaw-weixin": {
          botAgent: "MyBot/1.2.0",
          replyProgressMessages: false,
        },
      },
    });
    configRuntimeMocks.writeConfigFile.mockResolvedValue(undefined);

    await triggerWeixinChannelReload();

    expect(configRuntimeMocks.writeConfigFile).toHaveBeenCalledOnce();
    expect(configRuntimeMocks.writeConfigFile).toHaveBeenCalledWith({
      channels: {
        "openclaw-weixin": {
          botAgent: "MyBot/1.2.0",
          replyProgressMessages: false,
          channelConfigUpdatedAt: expect.any(String),
        },
      },
    });
    const written = configRuntimeMocks.writeConfigFile.mock.calls[0]?.[0] as {
      channels?: Record<string, { channelConfigUpdatedAt?: string }>;
    };
    expect(Number.isNaN(Date.parse(written.channels?.["openclaw-weixin"]?.channelConfigUpdatedAt ?? ""))).toBe(false);
  });
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

  it("keeps the primary when listed and removes other same-user accounts", () => {
    saveWeixinAccount("bot-im-bot", { token: "tok", userId: "user-a" });
    saveWeixinAccount("stale-im-bot", { token: "old", userId: "user-a" });
    registerWeixinAccountId("bot-im-bot");
    registerWeixinAccountId("stale-im-bot");

    clearStaleAccountsForUserId(["bot-im-bot"], "user-a");

    expect(listIndexedWeixinAccountIds()).toEqual(["bot-im-bot"]);
    expect(loadWeixinAccount("stale-im-bot")).toBeNull();
    expect(loadWeixinAccount("bot-im-bot")?.token).toBe("tok");
  });
});

describe("resolveLoginAccountAlias", () => {
  it("returns a stable human alias distinct from the bot id", () => {
    expect(resolveLoginAccountAlias("collin", "9ff4830b870e-im-bot")).toBe("collin");
  });

  it("returns null when alias matches the primary bot id", () => {
    expect(resolveLoginAccountAlias("9ff4830b870e-im-bot", "9ff4830b870e-im-bot")).toBeNull();
    expect(resolveLoginAccountAlias("9ff4830b870e@im.bot", "9ff4830b870e-im-bot")).toBeNull();
  });

  it("returns null for ephemeral UUID session keys", () => {
    expect(resolveLoginAccountAlias("550e8400-e29b-41d4-a716-446655440000", "bot-im-bot")).toBeNull();
  });

  it("returns null for the OpenClaw DEFAULT_ACCOUNT_ID sentinel", () => {
    expect(resolveLoginAccountAlias("default", "bot-im-bot")).toBeNull();
    expect(resolveLoginAccountAlias("Default", "bot-im-bot")).toBeNull();
  });
});

describe("persistWeixinLoginAccounts", () => {
  it("indexes only the bot id when no stable alias is requested", () => {
    const result = persistWeixinLoginAccounts({
      botAccountId: "abc@im.bot",
      token: "tok-1",
      baseUrl: "https://ilink.example.test",
      userId: "user-1@im.wechat",
    });

    expect(result).toEqual({
      primaryId: "abc-im-bot",
      aliasId: null,
      canonicalId: "abc-im-bot",
    });
    expect(listIndexedWeixinAccountIds()).toEqual(["abc-im-bot"]);
    expect(listWeixinAccountIds({})).toEqual(["abc-im-bot"]);
    expect(loadWeixinAccount("abc-im-bot")).toMatchObject({
      token: "tok-1",
      userId: "user-1@im.wechat",
    });
    expect(loadWeixinAccount("collin")).toBeNull();
  });

  it("treats host DEFAULT_ACCOUNT_ID as no alias and indexes only the bot id", () => {
    const result = persistWeixinLoginAccounts({
      botAccountId: "abc@im.bot",
      token: "tok-default",
      userId: "user-1@im.wechat",
      requestedAccountId: "default",
    });

    expect(result).toEqual({
      primaryId: "abc-im-bot",
      aliasId: null,
      canonicalId: "abc-im-bot",
    });
    expect(listIndexedWeixinAccountIds()).toEqual(["abc-im-bot"]);
    expect(loadWeixinAccount("default")).toBeNull();
  });

  it("indexes only the primary hash and stores a 1:1 alias mapping", () => {
    const result = persistWeixinLoginAccounts({
      botAccountId: "9ff4830b870e@im.bot",
      token: "tok-alias",
      baseUrl: "https://ilink.example.test",
      userId: "user-alias-synth@im.wechat",
      requestedAccountId: "collin",
    });

    expect(result).toEqual({
      primaryId: "9ff4830b870e-im-bot",
      aliasId: "collin",
      canonicalId: "9ff4830b870e-im-bot",
    });
    // Gateway monitors only the primary hash — never the alias.
    expect(listIndexedWeixinAccountIds()).toEqual(["9ff4830b870e-im-bot"]);
    expect(listWeixinAccountIds({})).toEqual(["9ff4830b870e-im-bot"]);
    expect(resolvePrimaryAccountId("collin")).toBe("9ff4830b870e-im-bot");
    expect(resolvePublicAccountId("9ff4830b870e-im-bot")).toBe("collin");
    expect(resolveAliasForPrimaryAccountId("9ff4830b870e-im-bot")).toBe("collin");
    expect(loadWeixinAccount("9ff4830b870e-im-bot")).toMatchObject({
      token: "tok-alias",
      userId: "user-alias-synth@im.wechat",
    });
    // Alias is logical only — no second credential / state namespace.
    expect(loadWeixinAccount("collin")).toBeNull();
  });

  it("publishes the primary index entry before clearing stale accounts", () => {
    saveWeixinAccount("old-im-bot", { token: "old", userId: "user-shared@im.wechat" });
    registerWeixinAccountId("old-im-bot");

    persistWeixinLoginAccounts({
      botAccountId: "new@im.bot",
      token: "fresh",
      userId: "user-shared@im.wechat",
      requestedAccountId: "staff",
    });

    expect(loadWeixinAccount("old-im-bot")).toBeNull();
    expect(loadWeixinAccount("staff")).toBeNull();
    expect(loadWeixinAccount("new-im-bot")?.token).toBe("fresh");
    expect(listIndexedWeixinAccountIds()).toEqual(["new-im-bot"]);
    expect(resolvePrimaryAccountId("staff")).toBe("new-im-bot");
  });

  it("leaves the previous index intact when publishing the primary id fails", () => {
    saveWeixinAccount("old-im-bot", { token: "old", userId: "user-shared@im.wechat" });
    registerWeixinAccountId("old-im-bot");
    const indexPath = path.join(tmpDir, "openclaw-weixin", "accounts.json");
    expect(listIndexedWeixinAccountIds()).toEqual(["old-im-bot"]);

    const originalWrite = fs.writeFileSync.bind(fs);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (String(file) === indexPath || String(file).startsWith(`${indexPath}.`)) {
        throw new Error("injected index write failure");
      }
      return originalWrite(file, data, options as never);
    });

    expect(() =>
      persistWeixinLoginAccounts({
        botAccountId: "new@im.bot",
        token: "fresh",
        userId: "user-shared@im.wechat",
        requestedAccountId: "staff",
      }),
    ).toThrow(/injected index write failure/);

    writeSpy.mockRestore();
    expect(listIndexedWeixinAccountIds()).toEqual(["old-im-bot"]);
    expect(loadWeixinAccount("old-im-bot")?.token).toBe("old");
  });

  it("resolves credentials and config through the alias without renaming the primary", () => {
    persistWeixinLoginAccounts({
      botAccountId: "bot@im.bot",
      token: "tok-resolve",
      userId: "user-resolve@im.wechat",
      requestedAccountId: "leader",
    });

    const resolved = resolveWeixinAccount(
      {
        channels: {
          "openclaw-weixin": {
            accounts: {
              leader: {
                name: "Leader Desk",
                enabled: false,
                cdnBaseUrl: "https://cdn.example.test",
              },
            },
          },
        },
      },
      "leader",
    );

    expect(resolved).toMatchObject({
      accountId: "leader",
      primaryId: "bot-im-bot",
      aliasId: "leader",
      configured: true,
      cdnBaseUrl: "https://cdn.example.test",
      enabled: false,
      name: "Leader Desk",
      token: "tok-resolve",
    });
  });

  it("rejects persist when a leftover alias credential belongs to another bot", () => {
    saveWeixinAccount("leader", { token: "tok-other", userId: "user-other@im.wechat" });

    expect(() =>
      persistWeixinLoginAccounts({
        botAccountId: "bot@im.bot",
        token: "tok-fresh",
        userId: "user-fresh@im.wechat",
        requestedAccountId: "leader",
      }),
    ).toThrow(/different bot/i);

    expect(loadWeixinAccount("leader")?.token).toBe("tok-other");
    expect(resolveAliasForPrimaryAccountId("bot-im-bot")).toBeNull();
  });
});

describe("migrateBoundAccountToAlias", () => {
  it("returns null when no stable alias was requested", () => {
    saveWeixinAccount("hash-im-bot", { token: "tok", userId: "user-a@im.wechat" });
    registerWeixinAccountId("hash-im-bot");
    expect(migrateBoundAccountToAlias({ requestedAccountId: "default" })).toBeNull();
    expect(migrateBoundAccountToAlias({})).toBeNull();
    expect(listIndexedWeixinAccountIds()).toEqual(["hash-im-bot"]);
  });

  it("binds an unambiguous hash-only account to the requested alias without reindexing", () => {
    saveWeixinAccount("hash-im-bot", {
      token: "tok",
      baseUrl: "https://ilink.example.test",
      userId: "user-a@im.wechat",
    });
    registerWeixinAccountId("hash-im-bot");

    const result = migrateBoundAccountToAlias({ requestedAccountId: "leader" });

    expect(result).toEqual({
      primaryId: "hash-im-bot",
      aliasId: "leader",
      canonicalId: "hash-im-bot",
    });
    expect(listIndexedWeixinAccountIds()).toEqual(["hash-im-bot"]);
    expect(resolvePrimaryAccountId("leader")).toBe("hash-im-bot");
    expect(loadWeixinAccount("leader")).toBeNull();
    expect(loadWeixinAccount("hash-im-bot")?.token).toBe("tok");
  });

  it("is a no-op success when the alias mapping already points at the primary", () => {
    saveWeixinAccount("hash-im-bot", { token: "tok", userId: "user-a@im.wechat" });
    registerWeixinAccountId("hash-im-bot");
    persistWeixinLoginAccounts({
      botAccountId: "hash@im.bot",
      token: "tok",
      userId: "user-a@im.wechat",
      requestedAccountId: "leader",
    });

    const result = migrateBoundAccountToAlias({ requestedAccountId: "leader" });

    expect(result).toEqual({
      primaryId: "hash-im-bot",
      aliasId: "leader",
      canonicalId: "hash-im-bot",
    });
    expect(listIndexedWeixinAccountIds()).toEqual(["hash-im-bot"]);
  });

  it("fails with an actionable error when multiple bound accounts are ambiguous", () => {
    saveWeixinAccount("a-im-bot", { token: "tok-a", userId: "user-a@im.wechat" });
    saveWeixinAccount("b-im-bot", { token: "tok-b", userId: "user-b@im.wechat" });
    registerWeixinAccountId("a-im-bot");
    registerWeixinAccountId("b-im-bot");

    expect(() => migrateBoundAccountToAlias({ requestedAccountId: "leader" })).toThrow(/ambiguous|multiple/i);
    expect(listIndexedWeixinAccountIds()).toEqual(["a-im-bot", "b-im-bot"]);
  });

  it("is a no-op when re-login requests the existing primary hash", () => {
    saveWeixinAccount("hash-im-bot", { token: "tok", userId: "user-a@im.wechat" });
    registerWeixinAccountId("hash-im-bot");

    expect(migrateBoundAccountToAlias({ requestedAccountId: "hash-im-bot" })).toBeNull();
    expect(migrateBoundAccountToAlias({ requestedAccountId: "hash@im.bot" })).toBeNull();
    expect(listIndexedWeixinAccountIds()).toEqual(["hash-im-bot"]);
    expect(resolveAliasForPrimaryAccountId("hash-im-bot")).toBeNull();
  });

  it("rejects binding when a leftover alias credential belongs to another bot", () => {
    saveWeixinAccount("hash-im-bot", { token: "tok-new", userId: "user-b@im.wechat" });
    saveWeixinAccount("leader", { token: "tok-old", userId: "user-a@im.wechat" });
    registerWeixinAccountId("hash-im-bot");

    expect(() => migrateBoundAccountToAlias({ requestedAccountId: "leader" })).toThrow(/different bot/i);
    expect(listIndexedWeixinAccountIds()).toEqual(["hash-im-bot"]);
    expect(resolveAliasForPrimaryAccountId("hash-im-bot")).toBeNull();
    // State namespaces must stay put — no adopt/move.
    expect(loadWeixinAccount("leader")?.token).toBe("tok-old");
    expect(loadWeixinAccount("hash-im-bot")?.token).toBe("tok-new");
  });
});
