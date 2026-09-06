import type {
  AssembledInboundReply,
  BuildChannelInboundEventContextParams,
  BuiltChannelInboundEventContext,
} from "openclaw/plugin-sdk/channel-inbound";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import { sendWeixinWithHooks } from "./outbound-hooks.js";

type InboundRuntime = PluginRuntime["channel"]["inbound"];

export type WeixinRoutedInboundTurn = Omit<
  AssembledInboundReply,
  "agentId" | "routeSessionKey" | "storePath" | "recordInboundSession" | "dispatchReplyWithBufferedBlockDispatcher"
> & {
  route: Pick<ReturnType<PluginRuntime["channel"]["routing"]["resolveAgentRoute"]>, "agentId" | "sessionKey">;
};

export type WeixinInboundRuntime = {
  inbound: {
    buildContext: (params: BuildChannelInboundEventContextParams) => BuiltChannelInboundEventContext;
    dispatch?: (params: WeixinRoutedInboundTurn) => ReturnType<InboundRuntime["dispatchReply"]>;
  } & Pick<InboundRuntime, "dispatchReply">;
  reply: Pick<PluginRuntime["channel"]["reply"], "dispatchReplyWithBufferedBlockDispatcher">;
  session: Pick<PluginRuntime["channel"]["session"], "recordInboundSession" | "resolveStorePath">;
};

export type WeixinInboundTurn = Pick<
  AssembledInboundReply,
  "cfg" | "channel" | "accountId" | "ctxPayload" | "dispatcherOptions" | "replyOptions" | "record" | "replyResolver"
> & {
  channelRuntime: WeixinInboundRuntime;
  route: ReturnType<PluginRuntime["channel"]["routing"]["resolveAgentRoute"]>;
  delivery: Pick<AssembledInboundReply["delivery"], "preparePayload" | "deliver" | "onDelivered" | "onError">;
  onReplyAdmitted?: () => void;
  onReplyDeferred?: () => void;
  onDeferredComplete?: () => void;
};

/** Only the two public inbound contracts are supported; a failed dispatch is never replayed. */
export async function dispatchWeixinInboundTurn(
  params: WeixinInboundTurn,
): Promise<Awaited<ReturnType<InboundRuntime["dispatchReply"]>>> {
  const { channelRuntime, route, onReplyAdmitted, onReplyDeferred, onDeferredComplete, ...turn } = params;
  const inbound = channelRuntime.inbound;
  if (!inbound) {
    throw new Error("weixin: host inbound runtime is missing");
  }

  let admitted = false;
  const admit = () => {
    if (admitted) return;
    admitted = true;
    onReplyAdmitted?.();
  };
  const defer = () => {
    onReplyDeferred?.();
    admit();
  };
  const onAgentRunStart = turn.replyOptions?.onAgentRunStart;
  const replyOptions = {
    ...turn.replyOptions,
    onAgentRunStart: (
      ...args: Parameters<NonNullable<NonNullable<AssembledInboundReply["replyOptions"]>["onAgentRunStart"]>>
    ) => {
      admit();
      return onAgentRunStart?.(...args);
    },
  };

  if ("dispatch" in inbound) {
    if (typeof inbound.dispatch !== "function") {
      throw new Error("weixin: host inbound.dispatch is not callable");
    }
    const delivery = { ...turn.delivery, observeMessageSent: true as const };
    const routedReplyOptions = {
      ...replyOptions,
      turnAdoptionLifecycle: {
        onAdopted: admit,
        onDeferred: defer,
        onSettled: onDeferredComplete,
      },
    };
    return await inbound.dispatch({
      ...turn,
      route,
      delivery,
      replyOptions: routedReplyOptions,
    });
  }

  if (
    typeof inbound.dispatchReply !== "function" ||
    typeof channelRuntime.session?.resolveStorePath !== "function" ||
    typeof channelRuntime.session?.recordInboundSession !== "function" ||
    typeof channelRuntime.reply?.dispatchReplyWithBufferedBlockDispatcher !== "function"
  ) {
    throw new Error("weixin: host legacy inbound contract is incomplete");
  }
  const to = turn.ctxPayload.To;
  if (typeof to !== "string") {
    throw new Error("weixin: inbound reply target is missing");
  }
  const hookContext = {
    to,
    accountId: turn.accountId,
    runId: turn.replyOptions?.runId,
    sessionKey: route.sessionKey,
  };
  const { preparePayload, ...rawDelivery } = turn.delivery;
  const delivery: AssembledInboundReply["delivery"] = {
    ...rawDelivery,
    deliver: async (payload, info) => {
      // Old helpers do not preserve SDK payload metadata across a preparePayload clone.
      // Prepare only inside provider delivery so the host keeps its original payload.
      const prepared = preparePayload ? await preparePayload(payload, info) : payload;
      if (prepared === null) return { visibleReplySent: false };
      return sendWeixinWithHooks(
        {
          ...hookContext,
          text: prepared.text ?? "",
          mediaUrl: prepared.mediaUrl ?? prepared.mediaUrls?.[0],
        },
        (text) => rawDelivery.deliver({ ...prepared, text }, info),
      );
    },
  };
  const legacyReplyOptions = {
    ...replyOptions,
    queuedFollowupLifecycle: { onEnqueued: defer, onComplete: onDeferredComplete },
    onTurnAdopted: admit,
  };
  return await inbound.dispatchReply({
    ...turn,
    agentId: route.agentId,
    routeSessionKey: route.sessionKey,
    storePath: channelRuntime.session.resolveStorePath(turn.cfg.session?.store, { agentId: route.agentId }),
    recordInboundSession: channelRuntime.session.recordInboundSession,
    dispatchReplyWithBufferedBlockDispatcher: channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher,
    dispatcherOptions: {
      ...turn.dispatcherOptions,
      // Replace the legacy SDK's text-only modifier; our provider wrapper owns
      // message_sending after preparation, including captionless media.
      beforeDeliver: turn.dispatcherOptions?.beforeDeliver ?? ((payload) => payload),
    },
    delivery,
    replyOptions: legacyReplyOptions,
  });
}
