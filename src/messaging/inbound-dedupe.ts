import { createHash } from "node:crypto";

import { createClaimableDedupe } from "openclaw/plugin-sdk/persistent-dedupe";

import type { MessageItem, WeixinMessage } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { logger } from "../util/logger.js";

/**
 * Replay-dedupe tombstone TTL for getUpdates at-least-once delivery.
 * Covers ~1s iLink replays and longer redeliveries (e.g. 30–50 min after a
 * stuck long turn). Not a content-dedupe window: a new user send with a new
 * `message_id` is always claimed. Body-fingerprint keys include create_time_ms.
 *
 * Uses OpenClaw `createClaimableDedupe` with the plugin-state SQLite backend
 * (`pluginId: openclaw-weixin`) so claims survive process restart. Account
 * isolation is via claim `namespace` (= accountId). Multi-replica gateways
 * without shared OPENCLAW_STATE_DIR still need a shared store / ingress drain.
 */
export const WEIXIN_INBOUND_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const WEIXIN_INBOUND_DEDUPE_MEMORY_MAX = 20_000;
const WEIXIN_INBOUND_DEDUPE_STATE_MAX = 20_000;
const WEIXIN_INBOUND_DEDUPE_NAMESPACE_PREFIX = "replay-dedupe";
const WEIXIN_PLUGIN_ID = "openclaw-weixin";

function createWeixinInboundDedupe(options?: { persistent?: boolean }) {
  const base = {
    ttlMs: WEIXIN_INBOUND_DEDUPE_TTL_MS,
    memoryMaxSize: WEIXIN_INBOUND_DEDUPE_MEMORY_MAX,
  };
  if (options?.persistent === false) {
    return createClaimableDedupe(base);
  }
  return createClaimableDedupe({
    ...base,
    pluginId: WEIXIN_PLUGIN_ID,
    namespacePrefix: WEIXIN_INBOUND_DEDUPE_NAMESPACE_PREFIX,
    stateMaxEntries: WEIXIN_INBOUND_DEDUPE_STATE_MAX,
    onDiskError: (error) => {
      logger.warn(
        `[weixin] inbound replay-dedupe disk error: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });
}

let inboundDedupe = createWeixinInboundDedupe();

function extractTextForFallback(itemList?: MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return String(item.voice_item.text);
    }
  }
  return "";
}

/**
 * Stable inbound identity for dedupe + MessageSid.
 * Prefer transport ids from iLink; fall back to content fingerprint.
 */
export function buildWeixinInboundDedupeKey(accountId: string, msg: WeixinMessage): string | null {
  const from = msg.from_user_id ?? "";
  if (!accountId) return null;

  if (msg.message_id != null && Number.isFinite(msg.message_id)) {
    return `weixin:v1:${accountId}:${from}:mid:${msg.message_id}`;
  }
  if (msg.client_id) {
    return `weixin:v1:${accountId}:${from}:cid:${msg.client_id}`;
  }
  if (msg.seq != null && Number.isFinite(msg.seq)) {
    return `weixin:v1:${accountId}:${from}:seq:${msg.seq}`;
  }

  const body = extractTextForFallback(msg.item_list);
  const t = msg.create_time_ms ?? 0;
  if (!from && !body && !t) return null;
  const digest = createHash("sha256").update(body).update("\0").update(String(t)).digest("hex").slice(0, 16);
  return `weixin:v1:${accountId}:${from}:body:${digest}`;
}

export type WeixinInboundDedupeOptions = {
  /** Account-scoped namespace for plugin-state isolation. */
  namespace?: string;
  now?: number;
};

/**
 * Claim a logical inbound message for processing.
 * @returns true if this is the first claim (process it); false if duplicate/in-flight.
 */
export async function claimWeixinInboundMessage(key: string, options?: WeixinInboundDedupeOptions): Promise<boolean> {
  const result = await inboundDedupe.claim(key, {
    namespace: options?.namespace,
    now: options?.now,
  });
  return result.kind === "claimed";
}

/** Persist the claim after successful handling (survives restart for TTL). */
export async function commitWeixinInboundMessage(key: string, options?: WeixinInboundDedupeOptions): Promise<void> {
  await inboundDedupe.commit(key, {
    namespace: options?.namespace,
    now: options?.now,
  });
}

/** Release a held claim so a later delivery can retry after a thrown failure. */
export function releaseWeixinInboundMessage(
  key: string,
  options?: WeixinInboundDedupeOptions & { error?: unknown },
): void {
  inboundDedupe.release(key, {
    namespace: options?.namespace,
    error: options?.error,
  });
}

/** Test helper — switch to memory-only guard and clear. */
export function resetWeixinInboundDedupeForTests(options?: { persistent?: boolean }): void {
  inboundDedupe.clearMemory();
  inboundDedupe = createWeixinInboundDedupe({
    persistent: options?.persistent ?? false,
  });
}

export function logWeixinInboundDuplicate(params: {
  accountId: string;
  key: string;
  messageId?: number;
  seq?: number;
  from?: string;
}): void {
  logger.info(
    `[weixin] dropping duplicate inbound message account=${params.accountId} key=${params.key} msgId=${params.messageId ?? "?"} seq=${params.seq ?? "?"} from=${params.from ?? "?"}`,
  );
}
