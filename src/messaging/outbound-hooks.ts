import type { AssembledInboundReply } from "openclaw/plugin-sdk/channel-inbound";
import {
  buildCanonicalSentMessageHookContext,
  fireAndForgetHook,
  toPluginMessageContext,
  toPluginMessageSentEvent,
} from "openclaw/plugin-sdk/hook-runtime";
import { getGlobalHookRunner } from "openclaw/plugin-sdk/plugin-runtime";

import { logger } from "../util/logger.js";
import { redactError } from "../util/redact.js";

const CHANNEL_ID = "openclaw-weixin";
type DeliveryResult = Awaited<ReturnType<AssembledInboundReply["delivery"]["deliver"]>>;

/** Local sends share cancellation and settlement; host-managed sends bypass this wrapper. */
export async function sendWeixinWithHooks(
  params: Parameters<typeof applyWeixinMessageSendingHook>[0],
  send: (text: string) => Promise<DeliveryResult>,
): Promise<DeliveryResult> {
  const sending = await applyWeixinMessageSendingHook(params);
  if (sending.cancelled) {
    logger.info("outbound: cancelled by message_sending hook");
    return { visibleReplySent: false };
  }
  let result: DeliveryResult;
  try {
    result = await send(sending.text);
  } catch (error) {
    emitWeixinMessageSent({ ...params, content: sending.text, success: false, error: redactError(error) });
    throw error;
  }
  if (result?.visibleReplySent !== false) {
    emitWeixinMessageSent({
      ...params,
      content: sending.text,
      success: true,
      messageId: result?.messageIds?.find((id) => id.trim()),
    });
  }
  return result;
}

/**
 * Local hook boundary for legacy inbound replies and independent debug sends.
 * Host-managed outbound adapters and routed inbound delivery must not call it.
 * Returns the (possibly modified) text content plus a cancelled flag.
 * Hook errors are caught and logged — sending proceeds regardless.
 */
export async function applyWeixinMessageSendingHook(params: {
  to: string;
  text: string;
  accountId?: string;
  mediaUrl?: string;
  runId?: string;
  sessionKey?: string;
}): Promise<{ cancelled: boolean; text: string }> {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("message_sending")) {
    return { cancelled: false, text: params.text };
  }
  try {
    const hookResult = await hookRunner.runMessageSending(
      {
        to: params.to,
        content: params.text,
        metadata: {
          channel: CHANNEL_ID,
          accountId: params.accountId,
          runId: params.runId,
          ...(params.mediaUrl ? { mediaUrls: [params.mediaUrl] } : {}),
        },
      },
      {
        channelId: CHANNEL_ID,
        accountId: params.accountId,
        ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      },
    );
    if (hookResult?.cancel) {
      return { cancelled: true, text: params.text };
    }
    return {
      cancelled: false,
      text: hookResult?.content ?? params.text,
    };
  } catch (err) {
    logger.warn(`message_sending hook error, proceeding with send: ${redactError(err)}`);
    return { cancelled: false, text: params.text };
  }
}

/**
 * Fire message_sent hook (fire-and-forget) after a send attempt.
 */
export function emitWeixinMessageSent(params: {
  to: string;
  content: string;
  success: boolean;
  error?: string;
  accountId?: string;
  runId?: string;
  sessionKey?: string;
  messageId?: string;
}): void {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("message_sent")) return;
  const canonical = buildCanonicalSentMessageHookContext({
    to: params.to,
    content: params.content,
    success: params.success,
    error: params.error,
    channelId: CHANNEL_ID,
    accountId: params.accountId,
    conversationId: params.to,
    runId: params.runId,
    sessionKey: params.sessionKey,
    messageId: params.messageId,
  });
  fireAndForgetHook(
    Promise.resolve(hookRunner.runMessageSent(toPluginMessageSentEvent(canonical), toPluginMessageContext(canonical))),
    "weixin: message_sent plugin hook failed",
  );
}
