import type { createTypingCallbacks } from "openclaw/plugin-sdk/channel-outbound";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REFERENCED_IMAGE_MESSAGE } from "../../test/fixtures/inbound-messages.js";
import { createChannelRuntimeHarness, deliverInboundReply } from "../../test/helpers/channel-runtime.js";
import { createDeferred } from "../../test/helpers/deferred.js";
import {
  makeTextMessage,
  SYNTHETIC_ACCOUNT_ID,
  SYNTHETIC_CONTEXT_TOKEN,
  SYNTHETIC_USER_ID,
} from "../../test/helpers/messages.js";
import { type MessageItem, MessageItemType, TypingStatus } from "../api/types.js";
import { buildWeixinInboundDedupeKey } from "./inbound-dedupe.js";
import type { WeixinInboundTurn } from "./inbound-turn.js";
import type { ProcessMessageDeps } from "./process-message.js";

const mocks = vi.hoisted(() => ({
  applySendingHook: vi.fn(),
  createTypingCallbacks: vi.fn<typeof createTypingCallbacks>(() => ({
    onReplyStart: vi.fn(),
    onIdle: vi.fn(),
    onCleanup: vi.fn(),
  })),
  resolveSenderAccess: vi.fn(),
  downloadMedia: vi.fn(),
  downloadRemote: vi.fn(),
  emitMessageSent: vi.fn(),
  handleSlashCommand: vi.fn(),
  isDebugMode: vi.fn(),
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  replyProgressEnabled: vi.fn(),
  sendErrorNotice: vi.fn(),
  sendMedia: vi.fn(),
  sendMessage: vi.fn(),
  sendMessageItem: vi.fn(),
  sendTyping: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/channel-outbound", () => ({
  createTypingCallbacks: mocks.createTypingCallbacks,
}));

vi.mock("openclaw/plugin-sdk/temp-path", () => ({
  resolvePreferredOpenClawTmpDir: vi.fn(() => "C:\\synthetic\\tmp"),
}));

vi.mock("./sender-access.js", () => ({
  resolveWeixinSenderAccess: mocks.resolveSenderAccess,
}));

vi.mock("../api/api.js", () => ({
  sendTyping: mocks.sendTyping,
}));

vi.mock("../auth/accounts.js", () => ({
  loadWeixinAccount: vi.fn(() => ({ userId: SYNTHETIC_USER_ID })),
}));

vi.mock("../auth/pairing.js", () => ({
  readFrameworkAllowFromList: vi.fn(() => [SYNTHETIC_USER_ID]),
}));

vi.mock("../cdn/upload.js", () => ({
  downloadRemoteImageToTemp: mocks.downloadRemote,
}));

vi.mock("../config/reply-progress.js", () => ({
  resolveReplyProgressMessagesEnabled: mocks.replyProgressEnabled,
}));

vi.mock("../media/media-download.js", () => ({
  downloadMediaFromItem: mocks.downloadMedia,
}));

vi.mock("../util/logger.js", () => ({
  logger: mocks.logger,
}));

vi.mock("./debug-mode.js", () => ({
  isDebugMode: mocks.isDebugMode,
}));

vi.mock("./error-notice.js", () => ({
  sendWeixinErrorNotice: mocks.sendErrorNotice,
}));

vi.mock("openclaw/plugin-sdk/plugin-runtime", () => ({
  getGlobalHookRunner: () => ({
    hasHooks: () => true,
    runMessageSending: mocks.applySendingHook,
    runMessageSent: mocks.emitMessageSent,
  }),
}));

vi.mock("./send.js", () => ({
  sendMessageWeixin: mocks.sendMessage,
  sendMessageItemWeixin: mocks.sendMessageItem,
}));

vi.mock("./send-media.js", () => ({
  sendWeixinMediaFile: mocks.sendMedia,
}));

vi.mock("./slash-commands.js", () => ({
  handleSlashCommand: mocks.handleSlashCommand,
}));

import { processOneMessage } from "./process-message.js";

function makeDeps(channelRuntime: ProcessMessageDeps["channelRuntime"], onReplyAdmitted = vi.fn()): ProcessMessageDeps {
  return {
    accountId: SYNTHETIC_ACCOUNT_ID,
    config: {},
    channelRuntime,
    baseUrl: "https://api.example.test",
    cdnBaseUrl: "https://cdn.example.test",
    token: "token-test",
    log: vi.fn(),
    errLog: vi.fn(),
    onReplyAdmitted,
  };
}

describe("processOneMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applySendingHook.mockImplementation(async ({ content }: { content: string }) => ({ content }));
    mocks.emitMessageSent.mockResolvedValue(undefined);
    mocks.downloadMedia.mockResolvedValue({});
    mocks.downloadRemote.mockResolvedValue("C:\\synthetic\\remote.png");
    mocks.handleSlashCommand.mockResolvedValue({ handled: false });
    mocks.isDebugMode.mockReturnValue(false);
    mocks.replyProgressEnabled.mockReturnValue(false);
    mocks.resolveSenderAccess.mockResolvedValue({ dropped: false, commandAuthorized: true });
    mocks.sendMessage.mockResolvedValue({ messageId: "message-test" });
    mocks.sendMessageItem.mockResolvedValue({ messageId: "progress-test" });
    mocks.sendMedia.mockResolvedValue({ messageId: "media-message-test" });
  });

  describe("inbound voice", () => {
    const placeholder = "[语音消息，暂无法获取语音内容，请发送文字或重试]";
    const media = {
      encrypt_query_param: "synthetic-voice-query",
      aes_key: Buffer.alloc(16).toString("base64"),
    };
    const voice: MessageItem = { type: MessageItemType.VOICE, voice_item: { media } };

    it.each([
      { label: "missing voice payload", voice_item: undefined, downloads: false },
      { label: "missing media and text", voice_item: {}, downloads: false },
      { label: "empty media and text", voice_item: { media: {}, text: "" }, downloads: false },
      {
        label: "missing media reference",
        voice_item: { media: { aes_key: media.aes_key } },
        downloads: false,
      },
      {
        label: "missing encryption key",
        voice_item: { media: { full_url: "https://cdn.example.test/voice" } },
        downloads: true,
      },
      { label: "failed media download", voice_item: { media }, downloads: true },
    ])("dispatches a visible fallback for $label", async ({ voice_item, downloads }) => {
      const harness = createChannelRuntimeHarness();
      const message = makeTextMessage("", {
        message_id: "9007199254740993",
        item_list: [{ type: MessageItemType.VOICE, voice_item }],
      });
      const originalKey = buildWeixinInboundDedupeKey(SYNTHETIC_ACCOUNT_ID, message);

      await processOneMessage(message, makeDeps(harness.channelRuntime));

      expect(mocks.downloadMedia).toHaveBeenCalledTimes(downloads ? 1 : 0);
      expect(harness.mocks.dispatchReply.mock.calls[0]?.[0].ctxPayload).toMatchObject({
        Body: placeholder,
        BodyForAgent: placeholder,
        RawBody: placeholder,
        MessageSid: originalKey,
      });
      expect(mocks.resolveSenderAccess).toHaveBeenCalledWith(expect.objectContaining({ rawBody: "" }));
      expect(mocks.logger.warn).toHaveBeenCalledExactlyOnceWith("inbound voice unavailable: count=1 hasMsgId=true");
      const logs = Object.values(mocks.logger)
        .flatMap((mock) => mock.mock.calls)
        .flat()
        .join(" ");
      for (const sensitive of [
        message.message_id,
        SYNTHETIC_ACCOUNT_ID,
        SYNTHETIC_USER_ID,
        SYNTHETIC_CONTEXT_TOKEN,
        media.encrypt_query_param,
        media.aes_key,
        "https://cdn.example.test/voice",
        placeholder,
      ]) {
        expect(logs).not.toContain(sensitive);
      }
    });

    it.each(["legacy", "routed"] as const)("passes the fallback through %s dispatch", async (mode) => {
      const harness = createChannelRuntimeHarness(mode);
      const selected = mode === "routed" ? harness.mocks.dispatch : harness.mocks.dispatchReply;

      await processOneMessage(
        makeTextMessage("", { item_list: [{ type: MessageItemType.VOICE }] }),
        makeDeps(harness.channelRuntime),
      );

      expect(selected).toHaveBeenCalledOnce();
      expect(selected.mock.calls[0]?.[0].ctxPayload.BodyForAgent).toBe(placeholder);
    });

    it.each([
      { label: "without media", voice_item: { text: "synthetic transcript" } },
      { label: "with media", voice_item: { media, text: "synthetic transcript" } },
    ])("preserves supplied transcription $label", async ({ voice_item }) => {
      const harness = createChannelRuntimeHarness();

      await processOneMessage(
        makeTextMessage("", { item_list: [{ type: MessageItemType.VOICE, voice_item }] }),
        makeDeps(harness.channelRuntime),
      );

      expect(harness.mocks.dispatchReply.mock.calls[0]?.[0].ctxPayload.BodyForAgent).toBe("synthetic transcript");
      expect(mocks.downloadMedia).not.toHaveBeenCalled();
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it.each(["audio/wav", "audio/silk"])("preserves a successful %s voice download", async (voiceMediaType) => {
      const harness = createChannelRuntimeHarness();
      mocks.downloadMedia.mockResolvedValue({
        decryptedVoicePath: "C:\\synthetic\\voice.bin",
        voiceMediaType,
      });

      await processOneMessage(makeTextMessage("", { item_list: [voice] }), makeDeps(harness.channelRuntime));

      expect(mocks.downloadMedia).toHaveBeenCalledWith(voice, expect.objectContaining({ label: "inbound" }));
      expect(harness.mocks.dispatchReply.mock.calls[0]?.[0].ctxPayload).toMatchObject({
        BodyForAgent: "",
        media: [{ path: "C:\\synthetic\\voice.bin", contentType: voiceMediaType }],
      });
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: "image",
        item: { type: MessageItemType.IMAGE, image_item: { media } },
        downloaded: { decryptedPicPath: "C:\\synthetic\\image.bin" },
      },
      {
        label: "video",
        item: { type: MessageItemType.VIDEO, video_item: { media } },
        downloaded: { decryptedVideoPath: "C:\\synthetic\\video.bin" },
      },
      {
        label: "file",
        item: { type: MessageItemType.FILE, file_item: { media } },
        downloaded: { decryptedFilePath: "C:\\synthetic\\file.bin" },
      },
    ])(
      "does not mark valid voice skipped for a higher-priority $label as unavailable",
      async ({ item, downloaded }) => {
        const harness = createChannelRuntimeHarness();
        mocks.downloadMedia.mockResolvedValue(downloaded);

        await processOneMessage(makeTextMessage("", { item_list: [voice, item] }), makeDeps(harness.channelRuntime));

        expect(mocks.downloadMedia).toHaveBeenCalledExactlyOnceWith(
          item,
          expect.objectContaining({ label: "inbound" }),
        );
        expect(harness.mocks.dispatchReply.mock.calls[0]?.[0].ctxPayload.BodyForAgent).toBe("");
        expect(mocks.logger.warn).not.toHaveBeenCalled();
      },
    );

    it("does not mark a second valid voice as unavailable when only the first is downloaded", async () => {
      const harness = createChannelRuntimeHarness();
      const secondVoice: MessageItem = {
        type: MessageItemType.VOICE,
        voice_item: { media: { full_url: "https://cdn.example.test/voice", aes_key: media.aes_key } },
      };
      mocks.downloadMedia.mockResolvedValue({ decryptedVoicePath: "C:\\synthetic\\voice.wav" });

      await processOneMessage(
        makeTextMessage("", { item_list: [voice, secondVoice] }),
        makeDeps(harness.channelRuntime),
      );

      expect(mocks.downloadMedia).toHaveBeenCalledExactlyOnceWith(voice, expect.objectContaining({ label: "inbound" }));
      expect(harness.mocks.dispatchReply.mock.calls[0]?.[0].ctxPayload).toMatchObject({
        BodyForAgent: "",
        media: [{ path: "C:\\synthetic\\voice.wav", contentType: "audio/wav" }],
      });
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it("counts only genuinely unavailable voice items alongside a successful voice download", async () => {
      const harness = createChannelRuntimeHarness();
      mocks.downloadMedia.mockResolvedValue({ decryptedVoicePath: "C:\\synthetic\\voice.wav" });

      await processOneMessage(
        makeTextMessage("", {
          item_list: [
            { type: MessageItemType.VOICE },
            voice,
            { type: MessageItemType.VOICE, voice_item: { media: { ...media } } },
            { type: MessageItemType.VOICE, voice_item: { media: { full_url: "https://cdn.example.test/voice" } } },
          ],
        }),
        makeDeps(harness.channelRuntime),
      );

      expect(harness.mocks.dispatchReply.mock.calls[0]?.[0].ctxPayload).toMatchObject({
        BodyForAgent: placeholder,
        media: [{ path: "C:\\synthetic\\voice.wav", contentType: "audio/wav" }],
      });
      expect(mocks.logger.warn).toHaveBeenCalledExactlyOnceWith("inbound voice unavailable: count=2 hasMsgId=false");
    });

    it("preserves accompanying text and media while reporting missing voice content", async () => {
      const harness = createChannelRuntimeHarness();
      mocks.downloadMedia.mockResolvedValue({ decryptedPicPath: "C:\\synthetic\\image.png" });

      await processOneMessage(
        makeTextMessage("synthetic caption", {
          item_list: [
            { type: MessageItemType.VOICE },
            { type: MessageItemType.TEXT, text_item: { text: "synthetic caption" } },
            { type: MessageItemType.IMAGE, image_item: { media } },
          ],
        }),
        makeDeps(harness.channelRuntime),
      );

      expect(harness.mocks.dispatchReply.mock.calls[0]?.[0].ctxPayload).toMatchObject({
        BodyForAgent: `synthetic caption\n${placeholder}`,
        media: [{ path: "C:\\synthetic\\image.png", contentType: "image/*" }],
      });
      expect(mocks.resolveSenderAccess).toHaveBeenCalledWith(expect.objectContaining({ rawBody: "synthetic caption" }));
      expect(mocks.logger.warn).toHaveBeenCalledExactlyOnceWith("inbound voice unavailable: count=1 hasMsgId=false");
    });

    it("does not add a fallback for quoted voice", async () => {
      const harness = createChannelRuntimeHarness();

      await processOneMessage(
        makeTextMessage("", {
          item_list: [
            {
              type: MessageItemType.TEXT,
              text_item: { text: "synthetic reply" },
              ref_msg: { message_item: { type: MessageItemType.VOICE } },
            },
          ],
        }),
        makeDeps(harness.channelRuntime),
      );

      expect(harness.mocks.dispatchReply.mock.calls[0]?.[0].ctxPayload.BodyForAgent).toBe("synthetic reply");
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it("does not add a fallback for other missing media", async () => {
      const harness = createChannelRuntimeHarness();

      await processOneMessage(
        makeTextMessage("", { item_list: [{ type: MessageItemType.IMAGE }] }),
        makeDeps(harness.channelRuntime),
      );

      expect(harness.mocks.dispatchReply.mock.calls[0]?.[0].ctxPayload.BodyForAgent).toBe("");
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it("does not dispatch or emit a voice-unavailable warning for an unauthorized sender", async () => {
      const harness = createChannelRuntimeHarness();
      mocks.resolveSenderAccess.mockResolvedValue({ dropped: true, commandAuthorized: false });

      await processOneMessage(
        makeTextMessage("", { item_list: [{ type: MessageItemType.VOICE }] }),
        makeDeps(harness.channelRuntime),
      );

      expect(harness.mocks.buildContext).not.toHaveBeenCalled();
      expect(harness.mocks.dispatchReply).not.toHaveBeenCalled();
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it("does not turn the placeholder into a shared identity for messages without IDs", async () => {
      const harness = createChannelRuntimeHarness();

      for (let i = 0; i < 2; i++) {
        const message = makeTextMessage("", { item_list: [{ type: MessageItemType.VOICE }] });
        await processOneMessage(message, makeDeps(harness.channelRuntime));
        expect(buildWeixinInboundDedupeKey(SYNTHETIC_ACCOUNT_ID, message)).toBeNull();
      }

      const contexts = harness.mocks.dispatchReply.mock.calls.map(([turn]) => turn.ctxPayload);
      expect(contexts).toHaveLength(2);
      expect(contexts.every((ctx) => ctx.BodyForAgent === placeholder)).toBe(true);
      expect(contexts[0]?.MessageSid).not.toBe(contexts[1]?.MessageSid);
    });
  });

  it("stops before authorization when a slash command handles the message", async () => {
    const harness = createChannelRuntimeHarness();
    const onReplyAdmitted = vi.fn();
    mocks.handleSlashCommand.mockResolvedValue({ handled: true });

    await processOneMessage(makeTextMessage("/echo hello"), makeDeps(harness.channelRuntime, onReplyAdmitted));

    expect(mocks.resolveSenderAccess).not.toHaveBeenCalled();
    expect(harness.mocks.resolveAgentRoute).not.toHaveBeenCalled();
    expect(onReplyAdmitted).not.toHaveBeenCalled();
  });

  it("drops unauthorized direct messages before dispatch", async () => {
    const harness = createChannelRuntimeHarness();
    const onReplyAdmitted = vi.fn();
    mocks.resolveSenderAccess.mockResolvedValue({ dropped: true, commandAuthorized: false });

    await processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime, onReplyAdmitted));

    expect(mocks.resolveSenderAccess).toHaveBeenCalledOnce();
    // Route is resolved early for per-agent media subdir scoping (see process-message.ts),
    // but the message is still dropped before session recording / dispatch.
    expect(harness.mocks.resolveAgentRoute).toHaveBeenCalledOnce();
    expect(harness.mocks.recordInboundSession).not.toHaveBeenCalled();
    expect(harness.mocks.dispatchReply).not.toHaveBeenCalled();
    expect(onReplyAdmitted).not.toHaveBeenCalled();
  });

  it("forwards a denied command authorization without dropping an admitted sender", async () => {
    const harness = createChannelRuntimeHarness();
    mocks.resolveSenderAccess.mockResolvedValue({ dropped: false, commandAuthorized: false });

    await processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime));

    expect(harness.mocks.buildContext).toHaveBeenCalledWith(
      expect.objectContaining({
        access: { commands: { authorized: false } },
      }),
    );
    expect(harness.mocks.dispatchReply.mock.calls[0]?.[0]?.ctxPayload).toMatchObject({
      CommandAuthorized: false,
    });
  });

  it.each(["legacy", "routed"] as const)("routes through public %s dispatch and reports admission", async (mode) => {
    const harness = createChannelRuntimeHarness(mode);
    const onReplyAdmitted = vi.fn();
    const run = async ({ replyOptions }: Pick<WeixinInboundTurn, "replyOptions">) => {
      await replyOptions?.onAgentRunStart?.("run-test");
      return harness.turnResult;
    };
    harness.mocks.dispatchReply.mockImplementation(run);
    harness.mocks.dispatch.mockImplementation(run);
    const selected = mode === "routed" ? harness.mocks.dispatch : harness.mocks.dispatchReply;
    const unused = mode === "routed" ? harness.mocks.dispatchReply : harness.mocks.dispatch;

    await processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime, onReplyAdmitted));

    expect(harness.mocks.buildContext).toHaveBeenCalledOnce();
    expect(selected).toHaveBeenCalledOnce();
    expect(unused).not.toHaveBeenCalled();
    expect(harness.mocks.resolveAgentRoute).toHaveBeenCalledWith({
      cfg: {},
      channel: "openclaw-weixin",
      accountId: SYNTHETIC_ACCOUNT_ID,
      peer: { kind: "direct", id: SYNTHETIC_USER_ID },
    });
    expect(selected).toHaveBeenCalledWith(
      expect.objectContaining({
        ctxPayload: expect.objectContaining({
          CommandAuthorized: true,
          SessionKey: "agent:agent-test:openclaw-weixin:account-test:user-test",
        }),
        record: expect.objectContaining({
          updateLastRoute: expect.objectContaining({
            channel: "openclaw-weixin",
            to: SYNTHETIC_USER_ID,
            accountId: SYNTHETIC_ACCOUNT_ID,
          }),
        }),
        dispatcherOptions: expect.objectContaining({
          typingCallbacks: mocks.createTypingCallbacks.mock.results[0]?.value,
        }),
      }),
    );
    expect(mocks.createTypingCallbacks).toHaveBeenCalledWith(
      expect.objectContaining({
        start: expect.any(Function),
        stop: expect.any(Function),
        keepaliveIntervalMs: 5000,
      }),
    );
    expect(onReplyAdmitted).toHaveBeenCalledOnce();
    expect(harness.mocks.recordInboundSession).not.toHaveBeenCalled();
    expect(harness.mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    const logs = [
      ...mocks.logger.info.mock.calls,
      ...mocks.logger.debug.mock.calls,
      ...mocks.logger.warn.mock.calls,
      ...mocks.logger.error.mock.calls,
    ]
      .flat()
      .join(" ");
    for (const sensitive of [
      "hello",
      SYNTHETIC_ACCOUNT_ID,
      SYNTHETIC_USER_ID,
      "sessions-test.json",
      "agent:agent-test:openclaw-weixin:account-test:user-test",
    ]) {
      expect(logs).not.toContain(sensitive);
    }
  });

  it.each([undefined, "typing-ticket-test"])("preserves typing start and stop for ticket %s", async (typingTicket) => {
    const harness = createChannelRuntimeHarness();
    const deps = makeDeps(harness.channelRuntime);
    deps.typingTicket = typingTicket;

    await processOneMessage(makeTextMessage("hello"), deps);
    const callbacks = mocks.createTypingCallbacks.mock.calls[0]?.[0];
    await callbacks?.start();
    await callbacks?.stop?.();

    expect(mocks.sendTyping.mock.calls.map(([request]) => request.body.status)).toEqual(
      typingTicket ? [TypingStatus.TYPING, TypingStatus.CANCEL] : [],
    );
    for (const [request] of mocks.sendTyping.mock.calls) {
      expect(request).toMatchObject({
        baseUrl: deps.baseUrl,
        token: deps.token,
        body: { ilink_user_id: SYNTHETIC_USER_ID, typing_ticket: typingTicket },
      });
    }
  });

  it.each(["legacy", "routed"] as const)(
    "keeps alias routing separate from the primary account on %s",
    async (mode) => {
      const harness = createChannelRuntimeHarness(mode);
      const sessionKey = "agent:agent-test:openclaw-weixin:leader:user-test";
      harness.mocks.resolveAgentRoute.mockReturnValue({
        agentId: "agent-test",
        channel: "openclaw-weixin",
        accountId: "leader",
        sessionKey,
        mainSessionKey: "agent:agent-test:main",
        lastRoutePolicy: "session",
        matchedBy: "default",
        ...(mode === "routed" ? { dmScope: "per-account-channel-peer" as const } : {}),
      });
      const deps = makeDeps(harness.channelRuntime);
      deps.routeAccountId = "leader";

      await processOneMessage(makeTextMessage("hello"), deps);

      expect(harness.mocks.resolveAgentRoute).toHaveBeenCalledWith(expect.objectContaining({ accountId: "leader" }));
      expect(harness.mocks.buildContext).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: SYNTHETIC_ACCOUNT_ID,
          route: {
            agentId: "agent-test",
            routeSessionKey: sessionKey,
            ...(mode === "routed" ? { dmScope: "per-account-channel-peer" } : {}),
          },
        }),
      );
      const turn =
        mode === "routed" ? harness.mocks.dispatch.mock.calls[0]?.[0] : harness.mocks.dispatchReply.mock.calls[0]?.[0];
      expect(turn?.ctxPayload).toMatchObject({ AccountId: SYNTHETIC_ACCOUNT_ID, SessionKey: sessionKey });
      expect(turn?.record?.updateLastRoute).toMatchObject({
        sessionKey: "agent:agent-test:main",
        accountId: SYNTHETIC_ACCOUNT_ID,
        to: SYNTHETIC_USER_ID,
      });
    },
  );

  it.each([
    {
      label: "the default",
      config: {},
      expected: ["First intermediate block", "Second intermediate block", "Final content"],
    },
    {
      label: "a channel opt-out",
      config: { channels: { "openclaw-weixin": { blockStreaming: false } } },
      expected: ["Final content"],
    },
    {
      label: "an account override",
      config: {
        channels: {
          "openclaw-weixin": {
            blockStreaming: false,
            accounts: { [SYNTHETIC_ACCOUNT_ID]: { blockStreaming: true } },
          },
        },
      },
      expected: ["First intermediate block", "Second intermediate block", "Final content"],
    },
    {
      label: "an alias-scoped account opt-out",
      config: {
        channels: {
          "openclaw-weixin": {
            blockStreaming: true,
            accounts: { leader: { blockStreaming: false } },
          },
        },
      },
      routeAccountId: "leader",
      expected: ["Final content"],
    },
  ])("delivers reply blocks in order with $label", async ({ config, expected, routeAccountId }) => {
    const harness = createChannelRuntimeHarness();
    harness.mocks.dispatchReply.mockImplementation(async ({ replyOptions, delivery }) => {
      if (replyOptions?.disableBlockStreaming !== true) {
        await deliverInboundReply(delivery, { text: "First intermediate block" }, "block");
        await deliverInboundReply(delivery, { text: "Second intermediate block" }, "block");
      }
      await deliverInboundReply(delivery, { text: "Final content" });
      return harness.turnResult;
    });
    const deps = makeDeps(harness.channelRuntime);
    deps.config = config;
    deps.routeAccountId = routeAccountId;

    await processOneMessage(makeTextMessage("hello"), deps);

    expect(mocks.sendMessage.mock.calls.map(([request]) => request.text)).toEqual(expected);
    expect(mocks.applySendingHook).toHaveBeenCalledTimes(expected.length);
    expect(mocks.emitMessageSent).toHaveBeenCalledTimes(expected.length);
  });

  it.each(["queued-followup", "adopted-turn"] as const)("reports %s admission", async (admission) => {
    const harness = createChannelRuntimeHarness();
    const onReplyAdmitted = vi.fn();
    harness.mocks.dispatchReply.mockImplementation(async ({ replyOptions }) => {
      const lifecycle = replyOptions as {
        queuedFollowupLifecycle?: { onEnqueued?: () => void };
        onTurnAdopted?: () => void | Promise<void>;
      };
      if (admission === "queued-followup") {
        lifecycle.queuedFollowupLifecycle?.onEnqueued?.();
      } else {
        await lifecycle.onTurnAdopted?.();
      }
      return harness.turnResult;
    });

    await processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime, onReplyAdmitted));

    expect(onReplyAdmitted).toHaveBeenCalledOnce();
    expect(harness.mocks.dispatchReply).toHaveBeenCalledOnce();
  });

  it.each(["legacy", "routed"] as const)(
    "keeps %s deferred progress alive after dispatch returns and closes it on settlement without adoption",
    async (mode) => {
      const harness = createChannelRuntimeHarness(mode);
      const onReplyAdmitted = vi.fn();
      const progressSent = createDeferred();
      mocks.replyProgressEnabled.mockReturnValue(true);
      mocks.sendMessageItem.mockImplementation(async () => {
        progressSent.resolve();
        return { messageId: "progress-test" };
      });
      harness.mocks.dispatchReply.mockImplementation(async ({ replyOptions }) => {
        const legacy = replyOptions as { queuedFollowupLifecycle?: { onEnqueued?: () => void } };
        legacy.queuedFollowupLifecycle?.onEnqueued?.();
        return harness.turnResult;
      });
      harness.mocks.dispatch.mockImplementation(async ({ replyOptions }) => {
        replyOptions?.turnAdoptionLifecycle?.onDeferred?.();
        return harness.turnResult;
      });

      await processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime, onReplyAdmitted));

      const options =
        mode === "routed"
          ? harness.mocks.dispatch.mock.calls[0]?.[0].replyOptions
          : harness.mocks.dispatchReply.mock.calls[0]?.[0].replyOptions;
      expect(onReplyAdmitted).toHaveBeenCalledOnce();
      await options?.onItemEvent?.({ kind: "tool", phase: "start", name: "synthetic-tool", itemId: "tool-1" });
      expect(mocks.sendMessageItem).toHaveBeenCalledOnce();
      await progressSent.promise;
      if (mode === "routed") {
        options?.turnAdoptionLifecycle?.onSettled?.();
      } else {
        const legacy = options as { queuedFollowupLifecycle?: { onComplete?: () => void } };
        legacy.queuedFollowupLifecycle?.onComplete?.();
      }
      await options?.onItemEvent?.({ kind: "tool", phase: "end", name: "synthetic-tool", itemId: "tool-1" });
      expect(mocks.sendMessageItem).toHaveBeenCalledOnce();
    },
  );

  it.each(
    [
      { mediaUrl: undefined, media: false },
      { mediaUrl: "C:\\synthetic\\reply.png", media: true },
      { mediaUrl: "reply.png", media: true },
      { mediaUrl: "file:///C:/synthetic/reply.png", media: true },
      { mediaUrl: "https://media.example.test/reply.png", media: true },
      { mediaUrl: "unsupported://synthetic", media: false },
    ].flatMap((entry) => (["legacy", "routed"] as const).map((mode) => ({ ...entry, mode }))),
  )("returns the transport identity for $mode delivery $mediaUrl", async ({ mediaUrl, media, mode }) => {
    const harness = createChannelRuntimeHarness(mode);
    const dispatch = async ({ delivery }: Pick<WeixinInboundTurn, "delivery">) => {
      const result = await deliverInboundReply(delivery, {
        text: "##### **reply**",
        ...(mediaUrl ? { mediaUrls: [mediaUrl] } : {}),
      });
      expect(result).toMatchObject({
        messageIds: [media ? "media-message-test" : "message-test"],
        content: "**reply**",
      });
      return harness.turnResult;
    };
    harness.mocks.dispatchReply.mockImplementation(dispatch);
    harness.mocks.dispatch.mockImplementation(dispatch);

    await processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime));

    const transport = media ? mocks.sendMedia : mocks.sendMessage;
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        to: SYNTHETIC_USER_ID,
        text: "**reply**",
        opts: expect.objectContaining({ contextToken: SYNTHETIC_CONTEXT_TOKEN }),
      }),
    );
    if (mode === "legacy") {
      expect(mocks.applySendingHook).toHaveBeenCalledWith(
        expect.objectContaining({ content: "**reply**" }),
        expect.objectContaining({ accountId: SYNTHETIC_ACCOUNT_ID }),
      );
    }
    expect(mocks.applySendingHook).toHaveBeenCalledTimes(mode === "legacy" ? 1 : 0);
    expect(mocks.emitMessageSent).toHaveBeenCalledTimes(mode === "legacy" ? 1 : 0);
  });

  it("propagates public dispatch failures without another dispatch or admission", async () => {
    const harness = createChannelRuntimeHarness();
    const onReplyAdmitted = vi.fn();
    const failure = new Error("synthetic dispatch failure with private payload");
    harness.mocks.dispatchReply.mockRejectedValue(failure);

    await expect(
      processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime, onReplyAdmitted)),
    ).rejects.toBe(failure);

    expect(onReplyAdmitted).not.toHaveBeenCalled();
    expect(harness.mocks.dispatchReply).toHaveBeenCalledOnce();
    expect(harness.mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/^inbound\.dispatch: error agentId=\*{4}\(len=\d+\) err=Error$/),
    );
    expect(mocks.logger.error.mock.calls.flat().join(" ")).not.toContain("private payload");
  });

  it("does not fall back to sending text after media transport fails", async () => {
    const harness = createChannelRuntimeHarness();
    const failure = new Error("synthetic media failure");
    mocks.sendMedia.mockRejectedValueOnce(failure);
    harness.mocks.dispatchReply.mockImplementation(async ({ delivery }) => {
      await expect(
        deliverInboundReply(delivery, { text: "caption", mediaUrl: "C:\\synthetic\\reply.png" }),
      ).rejects.toBe(failure);
      return harness.turnResult;
    });

    await processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime));

    expect(mocks.sendMedia).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.emitMessageSent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ success: false, error: "Error" }),
      expect.objectContaining({ accountId: SYNTHETIC_ACCOUNT_ID }),
    );
  });
  it("routes safe debug timing through the outbound hook without leaking suppressed content", async () => {
    const harness = createChannelRuntimeHarness();
    mocks.isDebugMode.mockReturnValue(true);
    mocks.applySendingHook.mockResolvedValue({ cancel: true, content: "" });
    harness.mocks.dispatchReply.mockImplementation(async ({ delivery }) => {
      await deliverInboundReply(delivery, { text: "private suppressed reply" });
      return harness.turnResult;
    });

    await processOneMessage(
      makeTextMessage("private inbound body", { session_id: "private-session-id" }),
      makeDeps(harness.channelRuntime),
    );

    expect(mocks.applySendingHook).toHaveBeenCalledTimes(2);
    const timingText = String(mocks.applySendingHook.mock.calls[1]?.[0].content ?? "");
    expect(timingText).toContain("⏱ Debug 全链路");
    for (const sensitive of [
      "private suppressed reply",
      "private inbound body",
      "private-session-id",
      SYNTHETIC_ACCOUNT_ID,
      SYNTHETIC_USER_ID,
      "agent:agent-test:openclaw-weixin:account-test:user-test",
    ]) {
      expect(timingText).not.toContain(sensitive);
    }
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.emitMessageSent).not.toHaveBeenCalled();
  });

  it("emits message_sent after a successful debug timing send", async () => {
    const harness = createChannelRuntimeHarness();
    mocks.isDebugMode.mockReturnValue(true);
    mocks.applySendingHook
      .mockResolvedValueOnce({ cancel: true, content: "" })
      .mockResolvedValueOnce({ content: "safe debug timing" });
    harness.mocks.dispatchReply.mockImplementation(async ({ delivery }) => {
      await deliverInboundReply(delivery, { text: "suppressed reply" });
      return harness.turnResult;
    });

    await processOneMessage(makeTextMessage("private inbound body"), makeDeps(harness.channelRuntime));

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: SYNTHETIC_USER_ID, text: "safe debug timing" }),
    );
    expect(mocks.emitMessageSent).toHaveBeenCalledWith(
      expect.objectContaining({
        to: SYNTHETIC_USER_ID,
        content: "safe debug timing",
        success: true,
      }),
      expect.objectContaining({ accountId: SYNTHETIC_ACCOUNT_ID }),
    );
  });

  it("emits a sanitized message_sent failure for a failed debug timing send", async () => {
    const harness = createChannelRuntimeHarness();
    const failure = new Error("private debug timing failure");
    mocks.isDebugMode.mockReturnValue(true);
    mocks.applySendingHook
      .mockResolvedValueOnce({ cancel: true, content: "" })
      .mockResolvedValueOnce({ content: "safe debug timing" });
    mocks.sendMessage.mockRejectedValueOnce(failure);
    harness.mocks.dispatchReply.mockImplementation(async ({ delivery }) => {
      await deliverInboundReply(delivery, { text: "suppressed reply" });
      return harness.turnResult;
    });

    await processOneMessage(makeTextMessage("private inbound body"), makeDeps(harness.channelRuntime));

    expect(mocks.emitMessageSent).toHaveBeenCalledWith(
      expect.objectContaining({
        to: SYNTHETIC_USER_ID,
        content: "safe debug timing",
        success: false,
        error: "Error",
      }),
      expect.objectContaining({ accountId: SYNTHETIC_ACCOUNT_ID }),
    );
    expect(mocks.emitMessageSent.mock.calls.flat().join(" ")).not.toContain("private debug timing failure");
  });

  it("downloads referenced media and records it in the inbound context", async () => {
    const harness = createChannelRuntimeHarness();
    mocks.downloadMedia.mockResolvedValue({
      decryptedPicPath: "C:\\synthetic\\referenced-image.png",
    });

    await processOneMessage(REFERENCED_IMAGE_MESSAGE, makeDeps(harness.channelRuntime));

    expect(mocks.downloadMedia).toHaveBeenCalledWith(
      expect.objectContaining({ type: 2 }),
      expect.objectContaining({ label: "ref" }),
    );
    expect(harness.mocks.buildContext).toHaveBeenCalledWith(
      expect.objectContaining({
        media: [
          expect.objectContaining({
            path: "C:\\synthetic\\referenced-image.png",
            contentType: "image/*",
          }),
        ],
      }),
    );
    expect(harness.mocks.dispatchReply.mock.calls[0]?.[0].ctxPayload.media).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "C:\\synthetic\\referenced-image.png", contentType: "image/*" }),
      ]),
    );
  });

  /**
   * Build a minimal inbound IMAGE message that the resolver picks up as the
   * primary downloadable media item (no `ref_msg` indirection needed).
   */
  function makeDirectImageMessage() {
    return {
      from_user_id: SYNTHETIC_USER_ID,
      context_token: "context-token-test",
      create_time_ms: 1_700_000_000_000,
      item_list: [
        {
          type: MessageItemType.IMAGE,
          image_item: {
            media: {
              full_url: "https://media.example.test/synthetic-direct-image",
            },
          },
        },
      ],
    };
  }

  describe("per-agent media isolation", () => {
    it("routes media from distinct agents into distinct subdirectories", async () => {
      const harness = createChannelRuntimeHarness();

      // First run resolves to "agent-alpha" — capture the deps subdir.
      harness.mocks.resolveAgentRoute.mockImplementationOnce(() => ({
        agentId: "agent-alpha",
        channel: "openclaw-weixin",
        accountId: SYNTHETIC_ACCOUNT_ID,
        sessionKey: "agent:agent-alpha:openclaw-weixin:account-test:user-test",
        mainSessionKey: "agent:agent-alpha:main",
        lastRoutePolicy: "session",
        matchedBy: "default",
      }));
      await processOneMessage(makeDirectImageMessage(), makeDeps(harness.channelRuntime));
      const firstDeps = mocks.downloadMedia.mock.calls[0]?.[1];

      // Second run resolves to "agent-beta" — capture again.
      harness.mocks.resolveAgentRoute.mockImplementationOnce(() => ({
        agentId: "agent-beta",
        channel: "openclaw-weixin",
        accountId: SYNTHETIC_ACCOUNT_ID,
        sessionKey: "agent:agent-beta:openclaw-weixin:account-test:user-test",
        mainSessionKey: "agent:agent-beta:main",
        lastRoutePolicy: "session",
        matchedBy: "default",
      }));
      await processOneMessage(makeDirectImageMessage(), makeDeps(harness.channelRuntime));
      const secondDeps = mocks.downloadMedia.mock.calls[1]?.[1];

      expect(firstDeps).toEqual(expect.objectContaining({ subdir: "weixin/agent-alpha/inbound" }));
      expect(secondDeps).toEqual(expect.objectContaining({ subdir: "weixin/agent-beta/inbound" }));
      expect(mocks.downloadMedia).toHaveBeenCalledTimes(2);
    });

    it("drops unauthorized senders but still routes media before dispatch", async () => {
      // Per-agent isolation downloads media BEFORE authorization (because the
      // agentId is needed to scope the storage path). When auth rejects the
      // message, the download already happened; dispatch is gated cleanly.
      const harness = createChannelRuntimeHarness();
      mocks.resolveSenderAccess.mockResolvedValue({ dropped: true, commandAuthorized: false });

      await processOneMessage(makeDirectImageMessage(), makeDeps(harness.channelRuntime));

      expect(mocks.downloadMedia).toHaveBeenCalledTimes(1);
      expect(mocks.downloadMedia.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ subdir: "weixin/agent-test/inbound" }),
      );
      expect(harness.mocks.recordInboundSession).not.toHaveBeenCalled();
      expect(harness.mocks.dispatchReply).not.toHaveBeenCalled();
      expect(mocks.resolveSenderAccess).toHaveBeenCalledOnce();
    });

    it("falls back to the legacy 'inbound' subdir when no agentId resolves", async () => {
      // Unresolved route: framework returns no agentId, so media is saved under
      // the historical "inbound" path, keeping previously stored media accessible.
      const harness = createChannelRuntimeHarness();
      harness.mocks.resolveAgentRoute.mockImplementationOnce(() => ({
        agentId: "",
        channel: "openclaw-weixin",
        accountId: SYNTHETIC_ACCOUNT_ID,
        // Match the harness default shape so we still type-check under `satisfies` boundaries.
        // Only `agentId` is intentionally empty.
        sessionKey: "agent::openclaw-weixin:account-test:user-test",
        mainSessionKey: "agent::main",
        lastRoutePolicy: "session",
        matchedBy: "default",
      }));

      await processOneMessage(makeDirectImageMessage(), makeDeps(harness.channelRuntime));

      expect(mocks.downloadMedia).toHaveBeenCalledTimes(1);
      expect(mocks.downloadMedia.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ subdir: "inbound" }));
    });

    it("sanitizes unsafe agentId characters before building the subdir", async () => {
      // Path traversal / separators in agentId must not reach the media store.
      // normalizeAgentId collapses the unsafe input into a safe `[a-z0-9_-]{1,64}` value.
      const harness = createChannelRuntimeHarness();
      harness.mocks.resolveAgentRoute.mockImplementationOnce(() => ({
        agentId: "/../etc/passwd",
        channel: "openclaw-weixin",
        accountId: SYNTHETIC_ACCOUNT_ID,
        sessionKey: "agent:sanitized:openclaw-weixin:account-test:user-test",
        mainSessionKey: "agent:sanitized:main",
        lastRoutePolicy: "session",
        matchedBy: "default",
      }));

      await processOneMessage(makeDirectImageMessage(), makeDeps(harness.channelRuntime));

      expect(mocks.downloadMedia).toHaveBeenCalledTimes(1);
      const subdir = mocks.downloadMedia.mock.calls[0]?.[1]?.subdir as string;
      // Must NOT contain slashes, '..', or absolute-path markers.
      expect(subdir.startsWith("weixin/")).toBe(true);
      expect(subdir.endsWith("/inbound")).toBe(true);
      expect(subdir).not.toContain("..");
      expect(subdir).not.toContain("\\");
      const middle = subdir.slice("weixin/".length, -"/inbound".length);
      expect(middle).toMatch(/^[a-z0-9_-]+$/);
    });

    it("preserves distinct subdirs for JS-reserved agentId names instead of collapsing them to 'default'", async () => {
      // Regression: a previous version of this PR used `normalizeAccountId`, which
      // routes JS-reserved names (`constructor`, `prototype`, `__proto__`) through
      // `isBlockedObjectKey` and maps them to `default`. That would cause two
      // distinct agents (e.g. an agent literally named `default` and an agent
      // literally named `constructor`) to share the same `weixin/default/inbound`
      // directory, defeating the per-agent isolation this PR provides.
      // `normalizeAgentId` from `openclaw/plugin-sdk/routing` preserves those
      // names verbatim.
      const harness = createChannelRuntimeHarness();

      // Agent named `constructor` — must NOT collapse to `default`.
      harness.mocks.resolveAgentRoute.mockImplementationOnce(() => ({
        agentId: "constructor",
        channel: "openclaw-weixin",
        accountId: SYNTHETIC_ACCOUNT_ID,
        sessionKey: "agent:constructor:openclaw-weixin:account-test:user-test",
        mainSessionKey: "agent:constructor:main",
        lastRoutePolicy: "session",
        matchedBy: "default",
      }));
      await processOneMessage(makeDirectImageMessage(), makeDeps(harness.channelRuntime));
      const constructorSubdir = mocks.downloadMedia.mock.calls[0]?.[1]?.subdir as string;

      // Agent named `default` — its own canonical subdir.
      harness.mocks.resolveAgentRoute.mockImplementationOnce(() => ({
        agentId: "default",
        channel: "openclaw-weixin",
        accountId: SYNTHETIC_ACCOUNT_ID,
        sessionKey: "agent:default:openclaw-weixin:account-test:user-test",
        mainSessionKey: "agent:default:main",
        lastRoutePolicy: "session",
        matchedBy: "default",
      }));
      await processOneMessage(makeDirectImageMessage(), makeDeps(harness.channelRuntime));
      const defaultSubdir = mocks.downloadMedia.mock.calls[1]?.[1]?.subdir as string;

      expect(constructorSubdir).toBe("weixin/constructor/inbound");
      expect(defaultSubdir).toBe("weixin/default/inbound");
      expect(constructorSubdir).not.toBe(defaultSubdir);
    });

    it("scopes media by agent only, not by accountId — accounts for the same agent share storage", async () => {
      // Account isolation: same agent across different accounts produces the same
      // subdir, with each call's session bound to its account. Per-agent storage
      // isolation is independent of multi-account binding.
      const harness = createChannelRuntimeHarness();
      const depsAlpha = makeDeps(harness.channelRuntime);
      depsAlpha.accountId = "account-alpha";
      const depsBeta = makeDeps(harness.channelRuntime);
      depsBeta.accountId = "account-beta";

      // Default route already returns agentId "agent-test" — no override needed.
      await processOneMessage(makeDirectImageMessage(), depsAlpha);
      await processOneMessage(makeDirectImageMessage(), depsBeta);

      expect(mocks.downloadMedia).toHaveBeenCalledTimes(2);
      expect(mocks.downloadMedia.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ subdir: "weixin/agent-test/inbound" }),
      );
      expect(mocks.downloadMedia.mock.calls[1]?.[1]).toEqual(
        expect.objectContaining({ subdir: "weixin/agent-test/inbound" }),
      );
      const storeArgs0 = harness.mocks.dispatchReply.mock.calls[0]?.[0].record;
      const storeArgs1 = harness.mocks.dispatchReply.mock.calls[1]?.[0].record;
      expect(storeArgs0).toEqual(
        expect.objectContaining({ updateLastRoute: expect.objectContaining({ accountId: "account-alpha" }) }),
      );
      expect(storeArgs1).toEqual(
        expect.objectContaining({ updateLastRoute: expect.objectContaining({ accountId: "account-beta" }) }),
      );
    });
  });
});
