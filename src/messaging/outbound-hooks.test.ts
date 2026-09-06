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
    info: vi.fn(),
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
import { applyWeixinMessageSendingHook, emitWeixinMessageSent, sendWeixinWithHooks } from "./outbound-hooks.js";

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

  describe("sendWeixinWithHooks", () => {
    const params = { to: "user-1", text: "original", accountId: "account-1", sessionKey: "session-1", runId: "run-1" };
    const sending = vi.fn();
    const sent = vi.fn();

    beforeEach(() => {
      sending.mockReset().mockResolvedValue({ content: "modified" });
      sent.mockReset().mockResolvedValue(undefined);
      mocks.getGlobalHookRunner.mockReturnValue({
        hasHooks: () => true,
        runMessageSending: sending,
        runMessageSent: sent,
      });
    });

    it.each([undefined, { messageIds: ["", "message-1"] }])("settles successful delivery %j once", async (result) => {
      const send = vi.fn(async () => result);

      expect(await sendWeixinWithHooks(params, send)).toBe(result);

      expect(send).toHaveBeenCalledExactlyOnceWith("modified");
      expect(sending).toHaveBeenCalledOnce();
      expect(sent).toHaveBeenCalledOnce();
      expect(mocks.buildCanonicalSentMessageHookContext).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "modified",
          success: true,
          accountId: "account-1",
          sessionKey: "session-1",
          runId: "run-1",
          messageId: result ? "message-1" : undefined,
        }),
      );
    });

    it("cancels before transport without emitting a sent event", async () => {
      sending.mockResolvedValue({ cancel: true });
      const send = vi.fn();

      expect(await sendWeixinWithHooks(params, send)).toEqual({ visibleReplySent: false });
      expect(send).not.toHaveBeenCalled();
      expect(sent).not.toHaveBeenCalled();
    });

    it("preserves an intentionally non-visible result", async () => {
      const result = { visibleReplySent: false };
      expect(await sendWeixinWithHooks(params, async () => result)).toBe(result);
      expect(sent).not.toHaveBeenCalled();
    });

    it("reports a sanitized transport failure once and preserves the original rejection", async () => {
      const failure = new Error("synthetic private transport detail");
      const send = vi.fn().mockRejectedValue(failure);

      await expect(sendWeixinWithHooks(params, send)).rejects.toBe(failure);
      expect(send).toHaveBeenCalledOnce();
      expect(sent).toHaveBeenCalledOnce();
      expect(mocks.buildCanonicalSentMessageHookContext).toHaveBeenCalledWith(
        expect.objectContaining({ content: "modified", success: false, error: "Error" }),
      );
    });

    it("does not reinterpret an observation failure as another transport result", async () => {
      const failure = new Error("synthetic observer failure");
      sent.mockImplementation(() => {
        throw failure;
      });
      const send = vi.fn(async () => ({ messageIds: ["message-1"] }));

      await expect(sendWeixinWithHooks(params, send)).rejects.toBe(failure);
      expect(send).toHaveBeenCalledOnce();
      expect(sent).toHaveBeenCalledOnce();
      expect(mocks.buildCanonicalSentMessageHookContext).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ success: true, messageId: "message-1" }),
      );
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
        sessionKey: "session-test",
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
      { channelId: "openclaw-weixin", accountId: "acc-1", sessionKey: "session-test" },
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
      sessionKey: "session-test",
      messageId: "message-test",
    });

    expect(mocks.buildCanonicalSentMessageHookContext).toHaveBeenCalledWith({
      to: "user-1",
      content: "hello",
      success: false,
      error: "network",
      channelId: "openclaw-weixin",
      accountId: "acc-1",
      conversationId: "user-1",
      sessionKey: "session-test",
      messageId: "message-test",
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
