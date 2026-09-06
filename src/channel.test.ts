import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDeferred } from "../test/helpers/deferred.js";
import type { ResolvedWeixinAccount } from "./auth/accounts.js";

const mocks = vi.hoisted(() => ({
  applySendingHook:
    vi.fn<(params: { to: string; text: string; accountId: string }) => Promise<{ cancelled: boolean; text: string }>>(),
  assertSessionActive: vi.fn<(accountId: string) => void>(),
  displayQRCode: vi.fn(),
  downloadRemote: vi.fn(),
  emitMessageSent: vi.fn(),
  findAccountIdsByContextToken: vi.fn<(accountIds: string[], userId: string) => string[]>(),
  getContextToken: vi.fn<(accountId: string, userId: string) => string | undefined>(),
  listAccountIds: vi.fn<(cfg: OpenClawConfig) => string[]>(),
  migrateBoundAccount: vi.fn(),
  monitorProvider: vi.fn<(opts: { accountId: string; abortSignal?: AbortSignal }) => Promise<void>>(),
  notifyStart: vi.fn(),
  notifyStop: vi.fn(),
  persistLoginAccounts: vi.fn(),
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
  sendMedia: vi.fn(),
  startLogin: vi.fn(),
  triggerChannelReload: vi.fn<() => Promise<void>>(),
  waitLogin: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => {
  const accountLogger = {
    debug: vi.fn(),
    error: vi.fn(),
    getLogFilePath: vi.fn(() => "C:\\synthetic\\weixin.log"),
    info: vi.fn(),
    warn: vi.fn(),
  };
  return {
    accountLogger,
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      withAccount: vi.fn(() => accountLogger),
    },
  };
});

vi.mock("./api/api.js", () => ({
  notifyStart: mocks.notifyStart,
  notifyStop: mocks.notifyStop,
}));

vi.mock("./api/session-guard.js", () => ({
  assertSessionActive: mocks.assertSessionActive,
}));

vi.mock("./auth/accounts.js", () => ({
  CDN_BASE_URL: "https://cdn.example.test",
  DEFAULT_BASE_URL: "https://api.example.test",
  listWeixinAccountIds: mocks.listAccountIds,
  loadWeixinAccount: vi.fn(),
  persistWeixinLoginAccounts: mocks.persistLoginAccounts,
  migrateBoundAccountToAlias: mocks.migrateBoundAccount,
  resolvePrimaryAccountId: (accountId: string) => accountId,
  resolveWeixinAccount: mocks.resolveAccount,
  triggerWeixinChannelReload: mocks.triggerChannelReload,
}));

vi.mock("./auth/login-qr.js", () => ({
  DEFAULT_ILINK_BOT_TYPE: "3",
  displayQRCode: mocks.displayQRCode,
  startWeixinLoginWithQr: mocks.startLogin,
  waitForWeixinLogin: mocks.waitLogin,
}));

vi.mock("./cdn/upload.js", () => ({
  downloadRemoteImageToTemp: mocks.downloadRemote,
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
  sendWeixinMediaFile: mocks.sendMedia,
}));

vi.mock("./util/logger.js", () => ({ logger: loggerMocks.logger }));

import { weixinPlugin } from "./channel.js";

type GatewayAdapter = NonNullable<typeof weixinPlugin.gateway>;
type StartAccount = NonNullable<GatewayAdapter["startAccount"]>;
type StopAccount = NonNullable<GatewayAdapter["stopAccount"]>;
type GatewayContext = Parameters<StartAccount>[0];

describe("weixinPlugin identity", () => {
  it("exposes openclaw-wechat only as an alias of the canonical channel", () => {
    expect(weixinPlugin.id).toBe("openclaw-weixin");
    expect(weixinPlugin.meta.id).toBe("openclaw-weixin");
    expect(weixinPlugin.meta.aliases).toEqual(["openclaw-wechat"]);
  });
});

const cfg: OpenClawConfig = {};
const recipient = "user-test@im.wechat";

function makeAccount(accountId: string, overrides: Partial<ResolvedWeixinAccount> = {}): ResolvedWeixinAccount {
  const primaryId = overrides.primaryId ?? accountId;
  return {
    baseUrl: "https://api.example.test",
    cdnBaseUrl: "https://cdn.example.test",
    token: `token-${primaryId}`,
    enabled: true,
    configured: true,
    ...overrides,
    accountId,
    primaryId,
    aliasId: overrides.aliasId ?? null,
  };
}

function requireSendText() {
  const sendText = weixinPlugin.outbound?.sendText;
  if (!sendText) throw new Error("Weixin sendText adapter is missing");
  return sendText;
}

function requireSendMedia() {
  const sendMedia = weixinPlugin.outbound?.sendMedia;
  if (!sendMedia) throw new Error("Weixin sendMedia adapter is missing");
  return sendMedia;
}

function requireBeforeDeliverPayload() {
  const beforeDeliverPayload = weixinPlugin.outbound?.beforeDeliverPayload;
  if (!beforeDeliverPayload) throw new Error("Weixin beforeDeliverPayload adapter is missing");
  return beforeDeliverPayload;
}

function requireNormalizePayload() {
  const normalizePayload = weixinPlugin.outbound?.normalizePayload;
  if (!normalizePayload) throw new Error("Weixin normalizePayload adapter is missing");
  return normalizePayload;
}

function requireLogin() {
  const login = weixinPlugin.auth?.login;
  if (!login) throw new Error("Weixin login adapter is missing");
  return login;
}

function requireLoginWithQrWait() {
  const loginWithQrWait = weixinPlugin.gateway?.loginWithQrWait;
  if (!loginWithQrWait) throw new Error("Weixin QR login adapter is missing");
  return loginWithQrWait;
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

describe("weixinPlugin metadata", () => {
  it("links setup and status surfaces to the community documentation", () => {
    expect(weixinPlugin.meta.docsPath).toBe("https://openclaw-weixin.newfuture.cc/");
  });
});

describe("weixinPlugin config.isEnabled", () => {
  it("enables only primary hash accounts so host start(alias) is rejected before a task", () => {
    const isEnabled = weixinPlugin.config?.isEnabled;
    if (!isEnabled) throw new Error("Weixin config.isEnabled is missing");

    expect(isEnabled(makeAccount("bot-im-bot", { primaryId: "bot-im-bot", aliasId: "leader" }), cfg)).toBe(true);
    expect(isEnabled(makeAccount("leader", { primaryId: "bot-im-bot", aliasId: "leader" }), cfg)).toBe(false);
    expect(isEnabled(makeAccount("bot-im-bot", { primaryId: "bot-im-bot", enabled: false }), cfg)).toBe(false);
  });
});

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
    mocks.sendMedia.mockResolvedValue({ messageId: "media-message-test" });
    mocks.downloadRemote.mockResolvedValue("C:\\synthetic\\remote.png");
    mocks.persistLoginAccounts.mockReturnValue({
      primaryId: "bot-im-bot",
      aliasId: null,
      canonicalId: "bot-im-bot",
    });
  });

  it("uses the only registered account and propagates its context token", async () => {
    mocks.listAccountIds.mockReturnValue(["account-a"]);

    const result = await requireSendText()({
      cfg,
      to: recipient,
      text: "hello",
    });

    expect(mocks.resolveAccount).toHaveBeenCalledExactlyOnceWith(cfg, "account-a");
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

  it("does not rerun host-owned hooks in the direct transport adapter", async () => {
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

    expect(mocks.applySendingHook).not.toHaveBeenCalled();
    expect(mocks.emitMessageSent).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(result).toEqual({ channel: "openclaw-weixin", messageId: "message-test" });
  });

  it.each([
    { kind: "text", mediaUrl: undefined, hasMedia: false },
    { kind: "media", mediaUrl: "C:\\synthetic\\reply.png", hasMedia: true },
    { kind: "media", mediaUrl: "https://media.example.test/reply.png", hasMedia: true },
    { kind: "media", mediaUrl: undefined, hasMedia: false },
    { kind: "media", mediaUrl: "unsupported://synthetic", hasMedia: false },
  ])(
    "keeps $kind adapter $mediaUrl hook-free and uses the primary account context",
    async ({ kind, mediaUrl, hasMedia }) => {
      mocks.resolveAccount.mockReturnValue(makeAccount("leader", { primaryId: "primary-test", aliasId: "leader" }));
      mocks.applySendingHook.mockResolvedValue({ cancelled: true, text: "must not run" });

      const send = kind === "text" ? requireSendText() : requireSendMedia();
      const result = await send({ cfg, to: recipient, text: "caption", mediaUrl, accountId: "leader" });

      expect(mocks.resolveAccount).toHaveBeenCalledExactlyOnceWith(cfg, "leader");
      expect(mocks.assertSessionActive).toHaveBeenCalledWith("primary-test");
      expect(mocks.getContextToken).toHaveBeenCalledWith("primary-test", recipient);
      expect(hasMedia ? mocks.sendMedia : mocks.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          to: recipient,
          text: "caption",
          opts: expect.objectContaining({ token: "token-primary-test", contextToken: "context-token-test" }),
        }),
      );
      expect(result).toEqual({
        channel: "openclaw-weixin",
        messageId: hasMedia ? "media-message-test" : "message-test",
      });
      expect(mocks.applySendingHook).not.toHaveBeenCalled();
      expect(mocks.emitMessageSent).not.toHaveBeenCalled();
    },
  );

  it.each(["unconfigured", "paused"])("rejects %s text accounts before transport", async (state) => {
    mocks.resolveAccount.mockReturnValue(
      makeAccount("leader", { primaryId: "primary-test", configured: state !== "unconfigured" }),
    );
    if (state === "paused") {
      mocks.assertSessionActive.mockImplementationOnce(() => {
        throw new Error("synthetic paused session");
      });
    }

    await expect(requireSendText()({ cfg, to: recipient, text: "reply", accountId: "leader" })).rejects.toThrow(
      state === "paused" ? "synthetic paused session" : "weixin not configured",
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.sendMedia).not.toHaveBeenCalled();
  });

  it.each(["text", "media", "download"] as const)(
    "propagates %s failure without a second hook emission",
    async (kind) => {
      const failure = new Error("synthetic transport failure");
      if (kind === "text") {
        mocks.sendMessage.mockRejectedValueOnce(failure);
      } else if (kind === "media") {
        mocks.sendMedia.mockRejectedValueOnce(failure);
      } else {
        mocks.downloadRemote.mockRejectedValueOnce(failure);
      }
      const result =
        kind === "text"
          ? requireSendText()({ cfg, to: recipient, text: "reply", accountId: "account-a" })
          : requireSendMedia()({
              cfg,
              to: recipient,
              text: "caption",
              mediaUrl: "https://media.example.test/reply.png",
              accountId: "account-a",
            });
      await expect(result).rejects.toBe(failure);
      expect(mocks.applySendingHook).not.toHaveBeenCalled();
      expect(mocks.emitMessageSent).not.toHaveBeenCalled();
    },
  );
});

describe("weixinPlugin auth.login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccount.mockReturnValue(makeAccount("account-login"));
    mocks.startLogin.mockResolvedValue({
      qrcodeUrl: "https://qr.example.test/code",
      message: "scan",
      sessionKey: "session-login",
    });
    mocks.waitLogin.mockResolvedValue({
      connected: true,
      botToken: "token-login",
      accountId: "bot-im-login",
      baseUrl: "https://api.example.test",
      userId: "user-login",
      message: "connected",
    });
  });

  it("shows a generic persistence failure while propagating the original error", async () => {
    const failure = new Error("private-save-payload C:\\sensitive\\accounts.json");
    const runtimeLog = vi.fn();
    mocks.persistLoginAccounts.mockImplementation(() => {
      throw failure;
    });

    await expect(
      requireLogin()({
        cfg,
        accountId: "account-login",
        verbose: false,
        runtime: { log: runtimeLog, error: vi.fn(), exit: vi.fn() },
      }),
    ).rejects.toBe(failure);

    expect(runtimeLog).toHaveBeenLastCalledWith("⚠️  保存账号数据失败，请稍后重试。");
    expect(loggerMocks.logger.error).toHaveBeenCalledWith("auth.login: failed to save account data err=Error");
    const diagnostics = [...runtimeLog.mock.calls, ...loggerMocks.logger.error.mock.calls].flat().join(" ");
    expect(diagnostics).not.toContain("private-save-payload");
    expect(diagnostics).not.toContain("accounts.json");
  });
});

describe.each(["CLI", "Gateway"] as const)("weixinPlugin %s login reload", (adapter) => {
  const persisted = { primaryId: "bot-im-bot", aliasId: "account-alias", canonicalId: "bot-im-bot" };

  function login() {
    return adapter === "CLI"
      ? requireLogin()({
          cfg,
          accountId: "account-alias",
          verbose: false,
          runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
        })
      : requireLoginWithQrWait()({ accountId: "account-alias", timeoutMs: 1000 });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccount.mockReturnValue(makeAccount("account-alias"));
    mocks.startLogin.mockResolvedValue({
      qrcodeUrl: "https://qr.example.test/code",
      sessionKey: "session-login",
      message: "scan",
    });
    mocks.waitLogin.mockResolvedValue({
      connected: true,
      botToken: "token-current",
      accountId: "bot-im-bot",
      userId: "user-current",
      message: "connected",
    });
    mocks.persistLoginAccounts.mockReset().mockReturnValue(persisted);
    mocks.migrateBoundAccount.mockReset().mockReturnValue(persisted);
    mocks.triggerChannelReload.mockReset().mockResolvedValue(undefined);
  });

  it.each(["credentials", "alias"] as const)("requests reload after saving %s without blocking login", async (kind) => {
    if (kind === "alias") {
      mocks.waitLogin.mockResolvedValue({ connected: false, alreadyConnected: true, message: "connected" });
    }
    const reloadStarted = createDeferred();
    const reloadFinished = createDeferred();
    mocks.triggerChannelReload.mockImplementation(() => {
      reloadStarted.resolve();
      return reloadFinished.promise;
    });
    let returned = false;
    const completion = login().then(() => {
      returned = true;
    });

    try {
      await reloadStarted.promise;
      await Promise.resolve();
      const persist = kind === "credentials" ? mocks.persistLoginAccounts : mocks.migrateBoundAccount;
      expect(persist).toHaveBeenCalledOnce();
      expect(mocks.triggerChannelReload).toHaveBeenCalledOnce();
      expect(persist.mock.invocationCallOrder[0]).toBeLessThan(mocks.triggerChannelReload.mock.invocationCallOrder[0]);
      expect(returned).toBe(true);
    } finally {
      reloadFinished.resolve();
      await completion;
    }
  });

  it("does not request reload for an unchanged already-connected binding", async () => {
    mocks.waitLogin.mockResolvedValue({ connected: false, alreadyConnected: true, message: "connected" });
    mocks.migrateBoundAccount.mockReturnValue(null);

    await login();

    expect(mocks.migrateBoundAccount).toHaveBeenCalledOnce();
    expect(mocks.persistLoginAccounts).not.toHaveBeenCalled();
    expect(mocks.triggerChannelReload).not.toHaveBeenCalled();
  });

  it.each(["credentials", "alias"] as const)("does not request reload when saving %s fails", async (kind) => {
    const failure = new Error("synthetic persistence failure");
    const persist = kind === "credentials" ? mocks.persistLoginAccounts : mocks.migrateBoundAccount;
    if (kind === "alias") {
      mocks.waitLogin.mockResolvedValue({ connected: false, alreadyConnected: true, message: "connected" });
    }
    persist.mockImplementation(() => {
      throw failure;
    });

    await expect(login()).rejects.toBe(failure);

    expect(mocks.triggerChannelReload).not.toHaveBeenCalled();
  });

  it("does not request reload for an incomplete login", async () => {
    mocks.waitLogin.mockResolvedValue({ connected: false, message: "incomplete" });

    if (adapter === "CLI") {
      await expect(login()).rejects.toThrow("incomplete");
    } else {
      await expect(login()).resolves.toMatchObject({ connected: false });
    }

    expect(mocks.persistLoginAccounts).not.toHaveBeenCalled();
    expect(mocks.migrateBoundAccount).not.toHaveBeenCalled();
    expect(mocks.triggerChannelReload).not.toHaveBeenCalled();
  });
});

describe("weixinPlugin approval forwarding", () => {
  it("adds copy-friendly commands to forwarded exec approvals", async () => {
    const payload = {
      text: "🔒 Exec approval required\nID: approval-full-id",
      channelData: {
        execApproval: {
          approvalId: "approval-full-id",
          approvalSlug: "approval",
          approvalKind: "exec",
          allowedDecisions: ["allow-once", "deny"],
          state: "pending",
        },
      },
    };

    await requireBeforeDeliverPayload()({
      cfg,
      target: {
        channel: "openclaw-weixin",
        to: recipient,
        accountId: "account-a",
      },
      payload,
      hint: {
        kind: "approval-pending",
        approvalKind: "exec",
      },
    });

    expect(payload.text).toContain("/approve approval allow-once");
    expect(payload.text).toContain("/approve approval deny");
    expect(payload.text).not.toContain("allow-always");
  });

  it("splits direct approval alternatives into separate copyable blocks", () => {
    const approvalText = [
      "Approval required.",
      "Run:",
      "```txt\n/approve approval allow-once\n```",
      "Pending command:",
      '```sh\necho "safe"\n```',
      "Other options:",
      "```txt\n/approve approval allow-always\n/approve approval deny\n```",
      "Host: gateway\nFull id: `approval-full-id`",
    ].join("\n\n");
    const payload = {
      text: approvalText,
      channelData: {
        execApproval: {
          approvalId: "approval-full-id",
          approvalSlug: "approval",
          approvalKind: "exec",
          allowedDecisions: ["allow-once", "allow-always", "deny"],
        },
      },
    };

    const normalized = requireNormalizePayload()({ payload, cfg });

    expect(normalized?.text).toBe(
      [
        "Approval required.",
        "",
        "Run:",
        "",
        "```txt",
        "/approve approval allow-once",
        "```",
        "",
        "Pending command:",
        "",
        "```sh",
        'echo "safe"',
        "```",
        "",
        "Other options:",
        "",
        "```txt",
        "/approve approval allow-always",
        "```",
        "",
        "```txt",
        "/approve approval deny",
        "```",
        "",
        "Host: gateway",
        "Full id: `approval-full-id`",
      ].join("\n"),
    );
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

  it("skips transport when the host starts an alias lifecycle task", async () => {
    const setStatus = vi.fn();

    await expect(
      requireStartAccount()(
        makeGatewayContext(makeAccount("leader", { primaryId: "bot-im-bot", aliasId: "leader" }), {
          setStatus,
        }),
      ),
    ).resolves.toBeUndefined();

    expect(mocks.monitorProvider).not.toHaveBeenCalled();
    expect(mocks.notifyStart).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith({
      accountId: "leader",
      running: false,
    });
  });

  it("starts the primary monitor with routeAccountId set to the bound alias", async () => {
    const setStatus = vi.fn();
    const abortController = new AbortController();
    let resolveMonitor: (() => void) | undefined;
    mocks.monitorProvider.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveMonitor = resolve;
          abortController.signal.addEventListener("abort", () => resolve());
        }),
    );

    const start = requireStartAccount()(
      makeGatewayContext(makeAccount("bot-im-bot", { primaryId: "bot-im-bot", aliasId: "leader" }), {
        abortSignal: abortController.signal,
        setStatus,
      }),
    );

    await vi.waitFor(() => expect(mocks.monitorProvider).toHaveBeenCalledOnce());
    expect(mocks.monitorProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "bot-im-bot",
        routeAccountId: "leader",
      }),
    );

    abortController.abort();
    resolveMonitor?.();
    await expect(start).resolves.toBeUndefined();
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
