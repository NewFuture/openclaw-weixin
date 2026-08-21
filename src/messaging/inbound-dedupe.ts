import { createHash } from "node:crypto";
import path from "node:path";

import { createClaimableDedupe } from "openclaw/plugin-sdk/persistent-dedupe";

import type { MessageItem, WeixinMessage } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { resolveStateDir } from "../storage/state-dir.js";
import { logger } from "../util/logger.js";
import { redactError } from "../util/redact.js";

/**
 * Replay-dedupe tombstone TTL for getUpdates at-least-once delivery.
 * Covers ~1s iLink replays and longer redeliveries (e.g. 30–50 min after a
 * stuck long turn). Not a content-dedupe window: a new user send with a new
 * `message_id` is always claimed.
 *
 * Uses OpenClaw `createClaimableDedupe` with the resolveFilePath shape that
 * works on the minimum host (2026.6.1 JSON files) and newer hosts (path used
 * as a stable SQLite namespace). Account isolation is via claim `namespace`
 * (= accountId) and per-account files under
 * `$OPENCLAW_STATE_DIR/openclaw-weixin/replay-dedupe/`.
 */
export const WEIXIN_INBOUND_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const WEIXIN_INBOUND_DEDUPE_MEMORY_MAX = 20_000;
const WEIXIN_INBOUND_DEDUPE_FILE_MAX = 20_000;

function sanitizeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "global";
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function resolveReplayDedupeFilePath(namespace: string): string {
  return path.join(resolveStateDir(), "openclaw-weixin", "replay-dedupe", `${sanitizeSegment(namespace)}.json`);
}

function onReplayDedupeDiskError(error: unknown): void {
  logger.warn(`[weixin] inbound replay-dedupe disk error: ${redactError(error)}`);
}

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
    fileMaxEntries: WEIXIN_INBOUND_DEDUPE_FILE_MAX,
    resolveFilePath: resolveReplayDedupeFilePath,
    onDiskError: onReplayDedupeDiskError,
  });
}

let inboundDedupe = createWeixinInboundDedupe();

function extractTextForFallback(itemList?: MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (!item) continue;
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return String(item.voice_item.text);
    }
  }
  return "";
}

/** Canonical sorted item msg_id list for collision-safe media identity. */
export function collectWeixinItemMsgIds(itemList?: MessageItem[]): string[] {
  if (!itemList?.length) return [];
  const ids: string[] = [];
  for (const item of itemList) {
    const id = item?.msg_id?.trim();
    if (id) ids.push(id);
  }
  return ids.sort();
}

/**
 * Stable inbound identity for dedupe + MessageSid.
 * Prefer transport ids from iLink; then item msg_id digests; then text body.
 * Returns null when no message-specific identity exists (never key by sender alone).
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

  const itemIds = collectWeixinItemMsgIds(msg.item_list);
  if (itemIds.length > 0) {
    const digest = createHash("sha256").update(itemIds.join("\0")).digest("hex").slice(0, 16);
    return `weixin:v1:${accountId}:${from}:items:${digest}`;
  }

  const body = extractTextForFallback(msg.item_list);
  if (!body) {
    // Empty-body media without transport/item ids must not share a sender-only key.
    return null;
  }
  const t = msg.create_time_ms ?? 0;
  const digest = createHash("sha256").update(body).update("\0").update(String(t)).digest("hex").slice(0, 16);
  return `weixin:v1:${accountId}:${from}:body:${digest}`;
}

/** Non-sensitive identity kind for logs (no account / user / client ids). */
export function describeWeixinInboundDedupeIdentity(key: string): "mid" | "cid" | "seq" | "items" | "body" | "unknown" {
  if (key.includes(":mid:")) return "mid";
  if (key.includes(":cid:")) return "cid";
  if (key.includes(":seq:")) return "seq";
  if (key.includes(":items:")) return "items";
  if (key.includes(":body:")) return "body";
  return "unknown";
}

export type WeixinInboundDedupeOptions = {
  /** Account-scoped namespace for persistent isolation. */
  namespace?: string;
  now?: number;
};

export type WeixinInboundClaimAttempt =
  | { kind: "claimed" }
  | { kind: "duplicate" }
  | { kind: "inflight"; pending: Promise<boolean> };

/**
 * Non-blocking claim attempt for admission lanes.
 * Callers must not await `inflight.pending` while holding a lane slot.
 */
export async function tryClaimWeixinInboundMessage(
  key: string,
  options?: WeixinInboundDedupeOptions,
): Promise<WeixinInboundClaimAttempt> {
  const result = await inboundDedupe.claim(key, {
    namespace: options?.namespace,
    now: options?.now,
  });
  if (result.kind === "claimed") return { kind: "claimed" };
  if (result.kind === "duplicate") return { kind: "duplicate" };
  return { kind: "inflight", pending: result.pending };
}

/** Observe an in-flight owner without holding an admission lane. */
export async function waitForInflightWeixinInboundOwner(pending: Promise<boolean>): Promise<"duplicate" | "released"> {
  try {
    await pending;
    return "duplicate";
  } catch {
    return "released";
  }
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

export function logWeixinInboundDuplicate(params: { key: string; messageId?: number; seq?: number }): void {
  const identity = describeWeixinInboundDedupeIdentity(params.key);
  logger.info(
    `[weixin] dropping duplicate inbound message identity=${identity} hasMsgId=${params.messageId != null} hasSeq=${params.seq != null}`,
  );
}
