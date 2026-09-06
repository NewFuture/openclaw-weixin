import { type AssembledInboundReply, buildChannelInboundEventContext } from "openclaw/plugin-sdk/channel-inbound";
import { vi } from "vitest";

import type { WeixinChannelRuntime } from "../../src/messaging/process-message.js";

type ChannelRuntime = WeixinChannelRuntime;

const DEFAULT_ROUTE = {
  agentId: "agent-test",
  channel: "openclaw-weixin",
  accountId: "account-test",
  sessionKey: "agent:agent-test:openclaw-weixin:account-test:user-test",
  mainSessionKey: "agent:agent-test:main",
  lastRoutePolicy: "session",
  matchedBy: "default",
} satisfies ReturnType<ChannelRuntime["routing"]["resolveAgentRoute"]>;

export function createChannelRuntimeHarness(mode: "legacy" | "routed" = "legacy") {
  const resolveAgentRoute = vi.fn<ChannelRuntime["routing"]["resolveAgentRoute"]>(() => DEFAULT_ROUTE);
  const resolveStorePath = vi.fn<ChannelRuntime["session"]["resolveStorePath"]>(() => "sessions-test.json");
  const recordInboundSession = vi.fn<ChannelRuntime["session"]["recordInboundSession"]>(async () => {});
  const saveMediaBuffer = vi.fn<ChannelRuntime["media"]["saveMediaBuffer"]>(async () => ({
    id: "media-test",
    path: "C:\\synthetic\\media-test.bin",
    size: 1,
    contentType: "application/octet-stream",
  }));
  const buildContext = vi.fn<ChannelRuntime["inbound"]["buildContext"]>(buildChannelInboundEventContext);
  const resolveHumanDelayConfig = vi.fn<ChannelRuntime["reply"]["resolveHumanDelayConfig"]>(() => undefined);
  const turnResult = {
    admission: { kind: "dispatch" },
    dispatched: true,
    ctxPayload: {},
    routeSessionKey: DEFAULT_ROUTE.sessionKey,
    dispatchResult: { queuedFinal: false, counts: { tool: 0, block: 0, final: 1 } },
  } satisfies Awaited<ReturnType<ChannelRuntime["inbound"]["dispatchReply"]>>;
  const dispatchReply = vi.fn<ChannelRuntime["inbound"]["dispatchReply"]>(async () => turnResult);
  const dispatch = vi.fn<NonNullable<ChannelRuntime["inbound"]["dispatch"]>>(async () => turnResult);
  const dispatchReplyWithBufferedBlockDispatcher = vi.fn<
    ChannelRuntime["reply"]["dispatchReplyWithBufferedBlockDispatcher"]
  >(async () => turnResult.dispatchResult);

  const channelRuntime = {
    commands: {
      resolveCommandAuthorizedFromAuthorizers: vi.fn<
        ChannelRuntime["commands"]["resolveCommandAuthorizedFromAuthorizers"]
      >(() => false),
      shouldComputeCommandAuthorized: vi.fn<ChannelRuntime["commands"]["shouldComputeCommandAuthorized"]>(),
    },
    routing: { resolveAgentRoute },
    inbound: {
      buildContext,
      dispatchReply,
      ...(mode === "routed" ? { dispatch } : {}),
    },
    session: {
      resolveStorePath,
      recordInboundSession,
    },
    media: { saveMediaBuffer },
    reply: {
      resolveHumanDelayConfig,
      dispatchReplyWithBufferedBlockDispatcher,
    },
  } satisfies ChannelRuntime;

  return {
    channelRuntime,
    route: DEFAULT_ROUTE,
    turnResult,
    mocks: {
      buildContext,
      dispatch,
      dispatchReply,
      dispatchReplyWithBufferedBlockDispatcher,
      recordInboundSession,
      resolveAgentRoute,
      resolveHumanDelayConfig,
      resolveStorePath,
      saveMediaBuffer,
    },
  };
}

export type ChannelRuntimeHarness = ReturnType<typeof createChannelRuntimeHarness>;

export async function deliverInboundReply(
  delivery: AssembledInboundReply["delivery"],
  payload: Parameters<AssembledInboundReply["delivery"]["deliver"]>[0],
  kind: Parameters<AssembledInboundReply["delivery"]["deliver"]>[1]["kind"] = "final",
) {
  const info = { kind };
  const prepared = delivery.preparePayload ? await delivery.preparePayload(payload, info) : payload;
  if (prepared === null) return { visibleReplySent: false };
  return await delivery.deliver(prepared, info);
}
