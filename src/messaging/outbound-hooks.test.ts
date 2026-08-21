import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildCanonicalSentMessageHookContext: vi.fn((context: unknown) => ({
    canonical: true,
    context,
  })),
  fireAndForgetHook: vi.fn(),
  getGlobalHookRunner: vi.fn(),
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
  sendMessageWeixin: vi.fn(),
  toPluginMessageContext: vi.fn((context: unknown) => ({
    pluginContext: context,
  })),
  toPluginMessageSentEvent: vi.fn((context: unknown) => ({
    event: context,
  })),
}));

vi.mock("openclaw/plugin-sdk/hook-runtime", () => ({
  buildCanonicalSentMessageHookContext: mocks.buildCanonicalSentMessageHookContext,
  fireAndForgetHook: mocks.fireAndForgetHook,
  toPluginMessageContext: mocks.toPluginMessageContext,
  toPluginMessageSentEvent: mocks.toPluginMessageSentEvent,
}));

vi.mock("openclaw/plugin-sdk/plugin-runtime", () => ({
  getGlobalHookRunner: mocks.getGlobalHookRunner,
}));

vi.mock("../util/logger.js", () => ({
  logger: mocks.logger,
}));

vi.mock("./send.js", () => ({
  sendMessageWeixin: mocks.sendMessageWeixin,
}));

import { sendWeixinErrorNotice } from "./error-notice.js";
import { applyWeixinMessageSendingHook, emitWeixinMessageSent } from "./outbound-hooks.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyWeixinMessageSendingHook", () => {
  it("returns original text when no hook runner is registered", async () => {
    mocks.getGlobalHookRunner.mockReturnValue(undefined);

    await expect(applyWeixinMessageSendingHook({ to: "user-1", text: "hello" })).resolves.toEqual({
      cancelled: false,
      text: "hello",
    });
  });

  it("returns original text when no message_sending hooks exist", async () => {
    const hookRunner = { hasHooks: vi.fn().mockReturnValue(false) };
    mocks.getGlobalHookRunner.mockReturnValue(hookRunner);

    await expect(applyWeixinMessageSendingHook({ to: "user-1", text: "hello" })).resolves.toEqual({
      cancelled: false,
      text: "hello",
    });
    expect(hookRunner.hasHooks).toHaveBeenCalledWith("message_sending");
  });

  it("applies hook-modified content with channel metadata", async () => {
    const runMessageSending = vi.fn().mockResolvedValue({ content: "changed" });
    const hookRunner = {
      hasHooks: vi.fn().mockReturnValue(true),
      runMessageSending,
    };
    mocks.getGlobalHookRunner.mockReturnValue(hookRunner);

    await expect(
      applyWeixinMessageSendingHook({
        to: "user-1",
        text: "hello",
        accountId: "acc-1",
        mediaUrl: "https://example.invalid/a.png",
      }),
    ).resolves.toEqual({ cancelled: false, text: "changed" });

    expect(runMessageSending).toHaveBeenCalledWith(
      {
        to: "user-1",
        content: "hello",
        metadata: {
          channel: "openclaw-weixin",
          accountId: "acc-1",
          mediaUrls: ["https://example.invalid/a.png"],
        },
      },
      { channelId: "openclaw-weixin", accountId: "acc-1" },
    );
  });

  it("reports cancellation while preserving original text", async () => {
    const hookRunner = {
      hasHooks: vi.fn().mockReturnValue(true),
      runMessageSending: vi.fn().mockResolvedValue({ cancel: true, content: "ignored" }),
    };
    mocks.getGlobalHookRunner.mockReturnValue(hookRunner);

    await expect(applyWeixinMessageSendingHook({ to: "user-1", text: "hello" })).resolves.toEqual({
      cancelled: true,
      text: "hello",
    });
  });

  it("logs hook errors and proceeds with original text", async () => {
    const hookRunner = {
      hasHooks: vi.fn().mockReturnValue(true),
      runMessageSending: vi.fn().mockRejectedValue(new Error("boom")),
    };
    mocks.getGlobalHookRunner.mockReturnValue(hookRunner);

    await expect(applyWeixinMessageSendingHook({ to: "user-1", text: "hello" })).resolves.toEqual({
      cancelled: false,
      text: "hello",
    });
    expect(mocks.logger.warn).toHaveBeenCalledWith("message_sending hook error, proceeding with send: Error");
    expect(mocks.logger.warn.mock.calls.flat().join(" ")).not.toContain("boom");
  });
});

describe("outbound diagnostic privacy", () => {
  it("does not log any recipient ID prefix after a successful error notice", async () => {
    const recipientId = "oSYNTH0000000000000000000000@im.wechat";
    mocks.sendMessageWeixin.mockResolvedValueOnce({ messageId: "m1" });

    await sendWeixinErrorNotice({
      to: recipientId,
      contextToken: "ctx-tok",
      message: "Something went wrong",
      baseUrl: "https://api.com",
      errLog: vi.fn(),
    });

    const logs = mocks.logger.debug.mock.calls.flat().join(" ");
    expect(logs).not.toContain(recipientId);
    expect(logs).not.toContain(recipientId.slice(0, 6));
  });
});

describe("emitWeixinMessageSent", () => {
  it("does nothing when no message_sent hooks exist", () => {
    const hookRunner = { hasHooks: vi.fn().mockReturnValue(false) };
    mocks.getGlobalHookRunner.mockReturnValue(hookRunner);

    emitWeixinMessageSent({ to: "user-1", content: "hello", success: true });

    expect(hookRunner.hasHooks).toHaveBeenCalledWith("message_sent");
    expect(mocks.fireAndForgetHook).not.toHaveBeenCalled();
  });

  it("emits message_sent through fireAndForgetHook", () => {
    const runMessageSent = vi.fn().mockResolvedValue(undefined);
    const hookRunner = {
      hasHooks: vi.fn().mockReturnValue(true),
      runMessageSent,
    };
    mocks.getGlobalHookRunner.mockReturnValue(hookRunner);

    emitWeixinMessageSent({
      to: "user-1",
      content: "hello",
      success: false,
      error: "network",
      accountId: "acc-1",
    });

    expect(mocks.buildCanonicalSentMessageHookContext).toHaveBeenCalledWith({
      to: "user-1",
      content: "hello",
      success: false,
      error: "network",
      channelId: "openclaw-weixin",
      accountId: "acc-1",
      conversationId: "user-1",
    });
    expect(runMessageSent).toHaveBeenCalledWith(
      {
        event: {
          canonical: true,
          context: expect.objectContaining({
            to: "user-1",
            content: "hello",
          }),
        },
      },
      {
        pluginContext: {
          canonical: true,
          context: expect.objectContaining({
            channelId: "openclaw-weixin",
            accountId: "acc-1",
          }),
        },
      },
    );
    expect(mocks.fireAndForgetHook).toHaveBeenCalledWith(
      expect.any(Promise),
      "weixin: message_sent plugin hook failed",
    );
  });
});
