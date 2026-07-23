import { beforeEach, describe, expect, it, vi } from "vitest";

import { REFERENCED_IMAGE_MESSAGE } from "../../test/fixtures/inbound-messages.js";
import { createChannelRuntimeHarness } from "../../test/helpers/channel-runtime.js";
import { makeTextMessage, SYNTHETIC_ACCOUNT_ID, SYNTHETIC_USER_ID } from "../../test/helpers/messages.js";
import type { ProcessMessageDeps } from "./process-message.js";

const mocks = vi.hoisted(() => ({
  applySendingHook: vi.fn(),
  directDmOutcome: vi.fn(),
  downloadMedia: vi.fn(),
  emitMessageSent: vi.fn(),
  handleSlashCommand: vi.fn(),
  resolveSenderAuthorization: vi.fn(),
  sendErrorNotice: vi.fn(),
  sendMedia: vi.fn(),
  sendMessage: vi.fn(),
  sendTyping: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/channel-runtime", () => ({
  createTypingCallbacks: vi.fn(() => ({})),
}));

vi.mock("openclaw/plugin-sdk/command-auth", () => ({
  resolveDirectDmAuthorizationOutcome: mocks.directDmOutcome,
  resolveSenderCommandAuthorizationWithRuntime: mocks.resolveSenderAuthorization,
}));

vi.mock("openclaw/plugin-sdk/infra-runtime", () => ({
  resolvePreferredOpenClawTmpDir: vi.fn(() => "C:\\synthetic\\tmp"),
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
  downloadRemoteImageToTemp: vi.fn(),
}));

vi.mock("../config/reply-progress.js", () => ({
  resolveReplyProgressMessagesEnabled: vi.fn(() => false),
}));

vi.mock("../media/media-download.js", () => ({
  downloadMediaFromItem: mocks.downloadMedia,
}));

vi.mock("../util/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("./debug-mode.js", () => ({
  isDebugMode: vi.fn(() => false),
}));

vi.mock("./error-notice.js", () => ({
  sendWeixinErrorNotice: mocks.sendErrorNotice,
}));

vi.mock("./outbound-hooks.js", () => ({
  applyWeixinMessageSendingHook: mocks.applySendingHook,
  emitWeixinMessageSent: mocks.emitMessageSent,
}));

vi.mock("./send.js", () => ({
  sendMessageWeixin: mocks.sendMessage,
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
    mocks.applySendingHook.mockImplementation(async ({ text }: { text: string }) => ({
      cancelled: false,
      text,
    }));
    mocks.directDmOutcome.mockReturnValue("allowed");
    mocks.downloadMedia.mockResolvedValue({});
    mocks.handleSlashCommand.mockResolvedValue({ handled: false });
    mocks.resolveSenderAuthorization.mockResolvedValue({
      shouldComputeAuth: true,
      effectiveAllowFrom: [SYNTHETIC_USER_ID],
      effectiveGroupAllowFrom: [],
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    mocks.sendMessage.mockResolvedValue({ messageId: "message-test" });
  });

  it("stops before authorization when a slash command handles the message", async () => {
    const harness = createChannelRuntimeHarness();
    mocks.handleSlashCommand.mockResolvedValue({ handled: true });

    await processOneMessage(makeTextMessage("/echo hello"), makeDeps(harness.channelRuntime));

    expect(mocks.resolveSenderAuthorization).not.toHaveBeenCalled();
    expect(harness.mocks.resolveAgentRoute).not.toHaveBeenCalled();
  });

  it("drops unauthorized direct messages before routing", async () => {
    const harness = createChannelRuntimeHarness();
    mocks.directDmOutcome.mockReturnValue("unauthorized");

    await processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime));

    expect(mocks.resolveSenderAuthorization).toHaveBeenCalledOnce();
    expect(harness.mocks.resolveAgentRoute).not.toHaveBeenCalled();
    expect(harness.mocks.recordInboundSession).not.toHaveBeenCalled();
  });

  it("routes, records, dispatches, and reports turn admission", async () => {
    const harness = createChannelRuntimeHarness();
    const onReplyAdmitted = vi.fn();
    harness.mocks.dispatchReplyFromConfig.mockImplementation(async ({ replyOptions }) => {
      await replyOptions?.onAgentRunStart?.("run-test");
      return {
        queuedFinal: false,
        counts: { tool: 0, block: 0, final: 1 },
      };
    });

    await processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime, onReplyAdmitted));

    expect(harness.mocks.resolveAgentRoute).toHaveBeenCalledWith({
      cfg: {},
      channel: "openclaw-weixin",
      accountId: SYNTHETIC_ACCOUNT_ID,
      peer: { kind: "direct", id: SYNTHETIC_USER_ID },
    });
    expect(harness.mocks.recordInboundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        storePath: "sessions-test.json",
        sessionKey: "agent:agent-test:openclaw-weixin:account-test:user-test",
        updateLastRoute: expect.objectContaining({
          channel: "openclaw-weixin",
          to: SYNTHETIC_USER_ID,
          accountId: SYNTHETIC_ACCOUNT_ID,
        }),
      }),
    );
    expect(harness.mocks.dispatchReplyFromConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          CommandAuthorized: true,
          SessionKey: "agent:agent-test:openclaw-weixin:account-test:user-test",
        }),
      }),
    );
    expect(onReplyAdmitted).toHaveBeenCalledOnce();
    expect(harness.mocks.markDispatchIdle).toHaveBeenCalledOnce();
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
    expect(harness.mocks.recordInboundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          MediaPath: "C:\\synthetic\\referenced-image.png",
          MediaType: "image/*",
        }),
      }),
    );
  });
});
