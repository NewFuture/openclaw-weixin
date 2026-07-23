import { createPluginRuntimeMock } from "openclaw/plugin-sdk/channel-test-helpers";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { vi } from "vitest";

type ChannelRuntime = PluginRuntime["channel"];

const DEFAULT_ROUTE = {
  agentId: "agent-test",
  channel: "openclaw-weixin",
  accountId: "account-test",
  sessionKey: "agent:agent-test:openclaw-weixin:account-test:user-test",
  mainSessionKey: "agent:agent-test:main",
  lastRoutePolicy: "session",
  matchedBy: "default",
} satisfies ReturnType<ChannelRuntime["routing"]["resolveAgentRoute"]>;

export function createChannelRuntimeHarness() {
  const resolveAgentRoute = vi.fn<ChannelRuntime["routing"]["resolveAgentRoute"]>(() => DEFAULT_ROUTE);
  const resolveStorePath = vi.fn<ChannelRuntime["session"]["resolveStorePath"]>(() => "sessions-test.json");
  const recordInboundSession = vi.fn<ChannelRuntime["session"]["recordInboundSession"]>(async () => {});
  const saveMediaBuffer = vi.fn<ChannelRuntime["media"]["saveMediaBuffer"]>(async () => ({
    id: "media-test",
    path: "C:\\synthetic\\media-test.bin",
    size: 1,
    contentType: "application/octet-stream",
  }));
  const finalizeInboundContext: ChannelRuntime["reply"]["finalizeInboundContext"] = (ctx) => ({
    ...ctx,
    CommandAuthorized: ctx.CommandAuthorized === true,
  });
  const resolveHumanDelayConfig = vi.fn<ChannelRuntime["reply"]["resolveHumanDelayConfig"]>(() => undefined);
  const markDispatchIdle = vi.fn();
  const markRunComplete = vi.fn();
  const dispatcher = {
    sendToolResult: vi.fn(() => true),
    sendBlockReply: vi.fn(() => true),
    sendFinalReply: vi.fn(() => true),
    waitForIdle: vi.fn(async () => {}),
    getQueuedCounts: vi.fn(() => ({ tool: 0, block: 0, final: 0 })),
    getFailedCounts: vi.fn(() => ({ tool: 0, block: 0, final: 0 })),
    markComplete: vi.fn(),
  } satisfies ReturnType<ChannelRuntime["reply"]["createReplyDispatcherWithTyping"]>["dispatcher"];
  const createReplyDispatcherWithTyping = vi.fn<ChannelRuntime["reply"]["createReplyDispatcherWithTyping"]>(() => ({
    dispatcher,
    replyOptions: {},
    markDispatchIdle,
    markRunComplete,
  }));
  const dispatchReplyFromConfig = vi.fn<ChannelRuntime["reply"]["dispatchReplyFromConfig"]>(async () => ({
    queuedFinal: false,
    counts: { tool: 0, block: 0, final: 1 },
  }));
  const withReplyDispatcher: ChannelRuntime["reply"]["withReplyDispatcher"] = async ({ run, onSettled }) => {
    try {
      return await run();
    } finally {
      await onSettled?.();
    }
  };

  const runtime = createPluginRuntimeMock({
    channel: {
      routing: { resolveAgentRoute },
      session: {
        resolveStorePath,
        recordInboundSession,
      },
      media: { saveMediaBuffer },
      reply: {
        finalizeInboundContext,
        resolveHumanDelayConfig,
        createReplyDispatcherWithTyping,
        dispatchReplyFromConfig,
        withReplyDispatcher,
      },
    },
  });

  return {
    channelRuntime: runtime.channel,
    mocks: {
      createReplyDispatcherWithTyping,
      dispatchReplyFromConfig,
      markDispatchIdle,
      recordInboundSession,
      resolveAgentRoute,
      resolveStorePath,
      saveMediaBuffer,
    },
  };
}

export type ChannelRuntimeHarness = ReturnType<typeof createChannelRuntimeHarness>;
