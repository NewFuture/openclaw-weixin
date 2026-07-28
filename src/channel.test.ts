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
  monitorProvider: vi.fn<(opts: { accountId: string; abortSignal?: AbortSignal }) => Promise<void>>(),
  notifyStart: vi.fn(),
  notifyStop: vi.fn(),
  resolveAccount: vi.fn<(cfg: OpenClawConfig, accountId?: string | null) => ResolvedWeixinAccount>(),
  restoreContextTokens: vi.fn<(accountId: string) => void>(),
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
  notifyStart: mocks.notifyStart,
  notifyStop: mocks.notifyStop,
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
  restoreContextTokens: mocks.restoreContextTokens,
}));

vi.mock("./monitor/monitor.js", () => ({
  monitorWeixinProvider: mocks.monitorProvider,
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

type GatewayAdapter = NonNullable<typeof weixinPlugin.gateway>;
type StartAccount = NonNullable<GatewayAdapter["startAccount"]>;
type StopAccount = NonNullable<GatewayAdapter["stopAccount"]>;
type GatewayContext = Parameters<StartAccount>[0];

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

function requireStartAccount(): StartAccount {
  const startAccount = weixinPlugin.gateway?.startAccount;
  if (!startAccount) throw new Error("Weixin startAccount adapter is missing");
  return startAccount;
}

function requireStopAccount(): StopAccount {
  const stopAccount = weixinPlugin.gateway?.stopAccount;
  if (!stopAccount) throw new Error("Weixin stopAccount adapter is missing");
  return stopAccount;
}

function makeGatewayContext(account: ResolvedWeixinAccount, overrides: Partial<GatewayContext> = {}): GatewayContext {
  return {
    cfg,
    accountId: account.accountId,
    account,
    runtime: {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    },
    abortSignal: new AbortController().signal,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getStatus: () => ({ accountId: account.accountId }),
    setStatus: vi.fn(),
    channelRuntime: {} as NonNullable<GatewayContext["channelRuntime"]>,
    ...overrides,
  };
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

describe("weixinPlugin gateway lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifyStart.mockResolvedValue({ ret: 0 });
    mocks.notifyStop.mockResolvedValue({ ret: 0 });
    mocks.monitorProvider.mockResolvedValue(undefined);
  });

  it("restores account state, notifies the backend, and passes the exact abort signal to the monitor", async () => {
    const abortController = new AbortController();
    const setStatus = vi.fn();
    let monitorSettled = false;
    mocks.monitorProvider.mockImplementation(
      async ({ abortSignal }) =>
        await new Promise<void>((resolve) => {
          abortSignal?.addEventListener("abort", () => resolve(), { once: true });
        }),
    );

    const start = requireStartAccount()(
      makeGatewayContext(makeAccount("account-lifecycle"), {
        abortSignal: abortController.signal,
        setStatus,
      }),
    );
    void start.then(() => {
      monitorSettled = true;
    });

    await vi.waitFor(() => expect(mocks.monitorProvider).toHaveBeenCalledOnce());
    expect(monitorSettled).toBe(false);
    expect(mocks.restoreContextTokens).toHaveBeenCalledWith("account-lifecycle");
    expect(mocks.restoreContextTokens.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.monitorProvider.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.notifyStart).toHaveBeenCalledWith({
      baseUrl: "https://api.example.test",
      token: "token-account-lifecycle",
    });
    expect(mocks.monitorProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-lifecycle",
        abortSignal: abortController.signal,
        setStatus,
      }),
    );
    expect(setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-lifecycle",
        running: true,
      }),
    );

    abortController.abort();
    await expect(start).resolves.toBeUndefined();
    expect(monitorSettled).toBe(true);
  });

  it("marks an unconfigured account stopped and rejects before contacting the backend", async () => {
    const setStatus = vi.fn();

    await expect(
      requireStartAccount()(
        makeGatewayContext(
          { ...makeAccount("account-unconfigured"), configured: false },
          {
            setStatus,
          },
        ),
      ),
    ).rejects.toThrow("weixin not configured: missing token");

    expect(setStatus).toHaveBeenLastCalledWith({
      accountId: "account-unconfigured",
      running: false,
    });
    expect(mocks.notifyStart).not.toHaveBeenCalled();
    expect(mocks.monitorProvider).not.toHaveBeenCalled();
  });

  it("marks startup failed when the host omits channelRuntime", async () => {
    const setStatus = vi.fn();

    await expect(
      requireStartAccount()(
        makeGatewayContext(makeAccount("account-old-host"), {
          channelRuntime: undefined,
          setStatus,
        }),
      ),
    ).rejects.toThrow("ctx.channelRuntime missing");

    expect(setStatus).toHaveBeenLastCalledWith({
      accountId: "account-old-host",
      running: false,
    });
    expect(mocks.monitorProvider).not.toHaveBeenCalled();
  });

  it("continues startup when notifyStart fails", async () => {
    mocks.notifyStart.mockRejectedValue(new Error("synthetic notify failure"));

    await expect(requireStartAccount()(makeGatewayContext(makeAccount("account-notify")))).resolves.toBeUndefined();

    expect(mocks.monitorProvider).toHaveBeenCalledOnce();
  });

  it("notifies stop only for configured accounts and ignores backend failures", async () => {
    mocks.notifyStop.mockRejectedValue(new Error("synthetic notify failure"));

    await expect(requireStopAccount()(makeGatewayContext(makeAccount("account-stop")))).resolves.toBeUndefined();
    await expect(
      requireStopAccount()(makeGatewayContext({ ...makeAccount("account-disabled"), configured: false })),
    ).resolves.toBeUndefined();

    expect(mocks.notifyStop).toHaveBeenCalledOnce();
    expect(mocks.notifyStop).toHaveBeenCalledWith({
      baseUrl: "https://api.example.test",
      token: "token-account-stop",
    });
  });
});
