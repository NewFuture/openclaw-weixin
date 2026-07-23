import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedWeixinAccount } from "./auth/accounts.js";

const mocks = vi.hoisted(() => ({
  applySendingHook:
    vi.fn<(params: { to: string; text: string; accountId: string }) => Promise<{ cancelled: boolean; text: string }>>(),
  assertSessionActive: vi.fn<(accountId: string) => void>(),
  emitMessageSent: vi.fn(),
  findAccountIdsByContextToken: vi.fn<(accountIds: string[], userId: string) => string[]>(),
  getContextToken: vi.fn<(accountId: string, userId: string) => string | undefined>(),
  listAccountIds: vi.fn<(cfg: OpenClawConfig) => string[]>(),
  resolveAccount: vi.fn<(cfg: OpenClawConfig, accountId?: string | null) => ResolvedWeixinAccount>(),
  sendMessage:
    vi.fn<
      (params: {
        to: string;
        text: string;
        opts: { baseUrl: string; token?: string; contextToken?: string };
      }) => Promise<{ messageId: string }>
    >(),
}));

vi.mock("./api/api.js", () => ({
  notifyStart: vi.fn(),
  notifyStop: vi.fn(),
}));

vi.mock("./api/session-guard.js", () => ({
  assertSessionActive: mocks.assertSessionActive,
}));

vi.mock("./auth/accounts.js", () => ({
  DEFAULT_BASE_URL: "https://api.example.test",
  clearStaleAccountsForUserId: vi.fn(),
  listWeixinAccountIds: mocks.listAccountIds,
  loadWeixinAccount: vi.fn(),
  registerWeixinAccountId: vi.fn(),
  resolveWeixinAccount: mocks.resolveAccount,
  saveWeixinAccount: vi.fn(),
  triggerWeixinChannelReload: vi.fn(),
}));

vi.mock("./auth/login-qr.js", () => ({
  DEFAULT_ILINK_BOT_TYPE: "3",
  displayQRCode: vi.fn(),
  startWeixinLoginWithQr: vi.fn(),
  waitForWeixinLogin: vi.fn(),
}));

vi.mock("./cdn/upload.js", () => ({
  downloadRemoteImageToTemp: vi.fn(),
}));

vi.mock("./messaging/inbound.js", () => ({
  clearContextTokensForAccount: vi.fn(),
  findAccountIdsByContextToken: mocks.findAccountIdsByContextToken,
  getContextToken: mocks.getContextToken,
  restoreContextTokens: vi.fn(),
}));

vi.mock("./messaging/outbound-hooks.js", () => ({
  applyWeixinMessageSendingHook: mocks.applySendingHook,
  emitWeixinMessageSent: mocks.emitMessageSent,
}));

vi.mock("./messaging/send.js", () => ({
  StreamingMarkdownFilter: class {
    feed(value: string): string {
      return value;
    }

    flush(): string {
      return "";
    }
  },
  sendMessageWeixin: mocks.sendMessage,
}));

vi.mock("./messaging/send-media.js", () => ({
  sendWeixinMediaFile: vi.fn(),
}));

vi.mock("./util/logger.js", () => {
  const accountLogger = {
    debug: vi.fn(),
    error: vi.fn(),
    getLogFilePath: vi.fn(() => "C:\\synthetic\\weixin.log"),
    info: vi.fn(),
    warn: vi.fn(),
  };
  return {
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      withAccount: vi.fn(() => accountLogger),
    },
  };
});

import { weixinPlugin } from "./channel.js";

const cfg: OpenClawConfig = {};
const recipient = "user-test@im.wechat";

function makeAccount(accountId: string): ResolvedWeixinAccount {
  return {
    accountId,
    baseUrl: "https://api.example.test",
    cdnBaseUrl: "https://cdn.example.test",
    token: `token-${accountId}`,
    enabled: true,
    configured: true,
  };
}

function requireSendText() {
  const sendText = weixinPlugin.outbound?.sendText;
  if (!sendText) throw new Error("Weixin sendText adapter is missing");
  return sendText;
}

describe("weixinPlugin outbound account resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applySendingHook.mockImplementation(async ({ text }) => ({
      cancelled: false,
      text,
    }));
    mocks.assertSessionActive.mockReturnValue(undefined);
    mocks.findAccountIdsByContextToken.mockReturnValue([]);
    mocks.getContextToken.mockReturnValue("context-token-test");
    mocks.resolveAccount.mockImplementation((_config, accountId) => makeAccount(accountId ?? "account-test"));
    mocks.sendMessage.mockResolvedValue({ messageId: "message-test" });
  });

  it("uses the only registered account and propagates its context token", async () => {
    mocks.listAccountIds.mockReturnValue(["account-a"]);

    const result = await requireSendText()({
      cfg,
      to: recipient,
      text: "hello",
    });

    expect(mocks.resolveAccount).toHaveBeenCalledWith(cfg, "account-a");
    expect(mocks.getContextToken).toHaveBeenCalledWith("account-a", recipient);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      to: recipient,
      text: "hello",
      opts: {
        baseUrl: "https://api.example.test",
        token: "token-account-a",
        contextToken: "context-token-test",
      },
    });
    expect(result).toEqual({ channel: "openclaw-weixin", messageId: "message-test" });
  });

  it("selects the unique account with context for the recipient", async () => {
    mocks.listAccountIds.mockReturnValue(["account-a", "account-b"]);
    mocks.findAccountIdsByContextToken.mockReturnValue(["account-b"]);

    await requireSendText()({ cfg, to: recipient, text: "hello" });

    expect(mocks.findAccountIdsByContextToken).toHaveBeenCalledWith(["account-a", "account-b"], recipient);
    expect(mocks.resolveAccount).toHaveBeenCalledWith(cfg, "account-b");
  });

  it("rejects ambiguous account context instead of choosing a sender", async () => {
    mocks.listAccountIds.mockReturnValue(["account-a", "account-b"]);
    mocks.findAccountIdsByContextToken.mockReturnValue(["account-a", "account-b"]);

    await expect(requireSendText()({ cfg, to: recipient, text: "hello" })).rejects.toThrow("weixin: ambiguous account");
    expect(mocks.resolveAccount).not.toHaveBeenCalled();
  });

  it("rejects missing account context instead of choosing a sender", async () => {
    mocks.listAccountIds.mockReturnValue(["account-a", "account-b"]);

    await expect(requireSendText()({ cfg, to: recipient, text: "hello" })).rejects.toThrow(
      "weixin: cannot determine which account to use",
    );
    expect(mocks.resolveAccount).not.toHaveBeenCalled();
  });

  it("rejects outbound sends when no accounts are registered", async () => {
    mocks.listAccountIds.mockReturnValue([]);

    await expect(requireSendText()({ cfg, to: recipient, text: "hello" })).rejects.toThrow(
      "weixin: no accounts registered",
    );
  });

  it("honors hook cancellation without contacting the backend", async () => {
    mocks.applySendingHook.mockResolvedValue({
      cancelled: true,
      text: "blocked",
    });

    const result = await requireSendText()({
      cfg,
      to: recipient,
      text: "hello",
      accountId: "account-a",
    });

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ channel: "openclaw-weixin", messageId: "" });
  });
});
