import { beforeEach, describe, expect, it, vi } from "vitest";
import { REFERENCED_IMAGE_MESSAGE } from "../../test/fixtures/inbound-messages.js";
import { createChannelRuntimeHarness } from "../../test/helpers/channel-runtime.js";
import { makeTextMessage, SYNTHETIC_ACCOUNT_ID, SYNTHETIC_USER_ID } from "../../test/helpers/messages.js";
import { MessageItemType } from "../api/types.js";
import type { ProcessMessageDeps } from "./process-message.js";

const mocks = vi.hoisted(() => ({
  applySendingHook: vi.fn(),
  createTypingCallbacks: vi.fn(() => ({
    onReplyStart: vi.fn(),
    onIdle: vi.fn(),
    onCleanup: vi.fn(),
  })),
  directDmOutcome: vi.fn(),
  downloadMedia: vi.fn(),
  emitMessageSent: vi.fn(),
  handleSlashCommand: vi.fn(),
  isDebugMode: vi.fn(),
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  resolveSenderAuthorization: vi.fn(),
  sendErrorNotice: vi.fn(),
  sendMedia: vi.fn(),
  sendMessage: vi.fn(),
  sendTyping: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/channel-message", () => ({
  createTypingCallbacks: mocks.createTypingCallbacks,
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
  logger: mocks.logger,
}));

vi.mock("./debug-mode.js", () => ({
  isDebugMode: mocks.isDebugMode,
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
    mocks.isDebugMode.mockReturnValue(false);
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
    const onReplyAdmitted = vi.fn();
    mocks.handleSlashCommand.mockResolvedValue({ handled: true });

    await processOneMessage(makeTextMessage("/echo hello"), makeDeps(harness.channelRuntime, onReplyAdmitted));

    expect(mocks.resolveSenderAuthorization).not.toHaveBeenCalled();
    expect(harness.mocks.resolveAgentRoute).not.toHaveBeenCalled();
    expect(onReplyAdmitted).not.toHaveBeenCalled();
  });

  it("drops unauthorized direct messages before dispatch", async () => {
    const harness = createChannelRuntimeHarness();
    const onReplyAdmitted = vi.fn();
    mocks.directDmOutcome.mockReturnValue("unauthorized");

    await processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime, onReplyAdmitted));

    expect(mocks.resolveSenderAuthorization).toHaveBeenCalledOnce();
    // Route is resolved early for per-agent media subdir scoping (see process-message.ts),
    // but the message is still dropped before session recording / dispatch.
    expect(harness.mocks.resolveAgentRoute).toHaveBeenCalledOnce();
    expect(harness.mocks.recordInboundSession).not.toHaveBeenCalled();
    expect(harness.mocks.dispatchReplyFromConfig).not.toHaveBeenCalled();
    expect(onReplyAdmitted).not.toHaveBeenCalled();
  });

  it("routes, records, dispatches, and reports agent-run admission", async () => {
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
    expect(mocks.createTypingCallbacks).toHaveBeenCalledWith(
      expect.objectContaining({
        start: expect.any(Function),
        stop: expect.any(Function),
        keepaliveIntervalMs: 5000,
      }),
    );
    expect(harness.mocks.createReplyDispatcherWithTyping).toHaveBeenCalledWith(
      expect.objectContaining({
        typingCallbacks: mocks.createTypingCallbacks.mock.results[0]?.value,
      }),
    );
    expect(onReplyAdmitted).toHaveBeenCalledOnce();
    expect(harness.mocks.markDispatchIdle).toHaveBeenCalledOnce();
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
    harness.mocks.dispatchReplyFromConfig.mockImplementation(async ({ replyOptions }) => {
      const deliver = harness.mocks.createReplyDispatcherWithTyping.mock.calls[0]?.[0].deliver;
      if (!deliver) throw new Error("deliver callback missing");
      if (replyOptions?.disableBlockStreaming !== true) {
        await deliver({ text: "First intermediate block" }, { kind: "block" });
        await deliver({ text: "Second intermediate block" }, { kind: "block" });
      }
      await deliver({ text: "Final content" }, { kind: "final" });
      return {
        queuedFinal: false,
        counts: { tool: 0, block: 2, final: 1 },
      };
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
    harness.mocks.dispatchReplyFromConfig.mockImplementation(async ({ replyOptions }) => {
      const lifecycle = replyOptions as {
        queuedFollowupLifecycle?: { onEnqueued?: () => void };
        onTurnAdopted?: () => void | Promise<void>;
      };
      if (admission === "queued-followup") {
        lifecycle.queuedFollowupLifecycle?.onEnqueued?.();
      } else {
        await lifecycle.onTurnAdopted?.();
      }
      return {
        queuedFinal: false,
        counts: { tool: 0, block: 0, final: 1 },
      };
    });

    await processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime, onReplyAdmitted));

    expect(onReplyAdmitted).toHaveBeenCalledOnce();
    expect(harness.mocks.markDispatchIdle).toHaveBeenCalledOnce();
  });

  it("marks dispatch idle and leaves admission unreleased when dispatch setup fails", async () => {
    const harness = createChannelRuntimeHarness();
    const onReplyAdmitted = vi.fn();
    const failure = new Error("synthetic dispatch failure with private payload");
    harness.mocks.dispatchReplyFromConfig.mockRejectedValue(failure);

    await expect(
      processOneMessage(makeTextMessage("hello"), makeDeps(harness.channelRuntime, onReplyAdmitted)),
    ).rejects.toBe(failure);

    expect(onReplyAdmitted).not.toHaveBeenCalled();
    expect(harness.mocks.markDispatchIdle).toHaveBeenCalledOnce();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/^dispatchReplyFromConfig: error agentId=\*{4}\(len=\d+\) err=Error$/),
    );
    expect(mocks.logger.error.mock.calls.flat().join(" ")).not.toContain("private payload");
  });

  it("routes safe debug timing through the outbound hook without leaking suppressed content", async () => {
    const harness = createChannelRuntimeHarness();
    mocks.isDebugMode.mockReturnValue(true);
    mocks.applySendingHook.mockResolvedValue({ cancelled: true, text: "" });
    harness.mocks.dispatchReplyFromConfig.mockImplementation(async () => {
      const deliver = harness.mocks.createReplyDispatcherWithTyping.mock.calls[0]?.[0].deliver;
      if (!deliver) throw new Error("deliver callback missing");
      await deliver({ text: "private suppressed reply" }, { kind: "final" });
      return {
        queuedFinal: false,
        counts: { tool: 0, block: 0, final: 1 },
      };
    });

    await processOneMessage(
      makeTextMessage("private inbound body", { session_id: "private-session-id" }),
      makeDeps(harness.channelRuntime),
    );

    expect(mocks.applySendingHook).toHaveBeenCalledTimes(2);
    const timingText = String(mocks.applySendingHook.mock.calls[1]?.[0].text ?? "");
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
      .mockResolvedValueOnce({ cancelled: true, text: "" })
      .mockResolvedValueOnce({ cancelled: false, text: "safe debug timing" });
    harness.mocks.dispatchReplyFromConfig.mockImplementation(async () => {
      const deliver = harness.mocks.createReplyDispatcherWithTyping.mock.calls[0]?.[0].deliver;
      if (!deliver) throw new Error("deliver callback missing");
      await deliver({ text: "suppressed reply" }, { kind: "final" });
      return {
        queuedFinal: false,
        counts: { tool: 0, block: 0, final: 1 },
      };
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
        accountId: SYNTHETIC_ACCOUNT_ID,
      }),
    );
  });

  it("emits a sanitized message_sent failure for a failed debug timing send", async () => {
    const harness = createChannelRuntimeHarness();
    const failure = new Error("private debug timing failure");
    mocks.isDebugMode.mockReturnValue(true);
    mocks.applySendingHook
      .mockResolvedValueOnce({ cancelled: true, text: "" })
      .mockResolvedValueOnce({ cancelled: false, text: "safe debug timing" });
    mocks.sendMessage.mockRejectedValueOnce(failure);
    harness.mocks.dispatchReplyFromConfig.mockImplementation(async () => {
      const deliver = harness.mocks.createReplyDispatcherWithTyping.mock.calls[0]?.[0].deliver;
      if (!deliver) throw new Error("deliver callback missing");
      await deliver({ text: "suppressed reply" }, { kind: "final" });
      return {
        queuedFinal: false,
        counts: { tool: 0, block: 0, final: 1 },
      };
    });

    await processOneMessage(makeTextMessage("private inbound body"), makeDeps(harness.channelRuntime));

    expect(mocks.emitMessageSent).toHaveBeenCalledWith(
      expect.objectContaining({
        to: SYNTHETIC_USER_ID,
        content: "safe debug timing",
        success: false,
        error: "Error",
        accountId: SYNTHETIC_ACCOUNT_ID,
      }),
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
    expect(harness.mocks.recordInboundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          MediaPath: "C:\\synthetic\\referenced-image.png",
          MediaType: "image/*",
        }),
      }),
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
      mocks.directDmOutcome.mockReturnValue("unauthorized");

      await processOneMessage(makeDirectImageMessage(), makeDeps(harness.channelRuntime));

      expect(mocks.downloadMedia).toHaveBeenCalledTimes(1);
      expect(mocks.downloadMedia.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ subdir: "weixin/agent-test/inbound" }),
      );
      expect(harness.mocks.recordInboundSession).not.toHaveBeenCalled();
      expect(harness.mocks.dispatchReplyFromConfig).not.toHaveBeenCalled();
      expect(mocks.resolveSenderAuthorization).toHaveBeenCalledOnce();
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
      const storeArgs0 = harness.mocks.recordInboundSession.mock.calls[0]?.[0];
      const storeArgs1 = harness.mocks.recordInboundSession.mock.calls[1]?.[0];
      expect(storeArgs0).toEqual(
        expect.objectContaining({ updateLastRoute: expect.objectContaining({ accountId: "account-alpha" }) }),
      );
      expect(storeArgs1).toEqual(
        expect.objectContaining({ updateLastRoute: expect.objectContaining({ accountId: "account-beta" }) }),
      );
    });
  });
});
