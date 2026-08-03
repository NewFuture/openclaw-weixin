import { createHash } from "node:crypto";
import path from "node:path";

import { createClaimableDedupe } from "openclaw/plugin-sdk/persistent-dedupe";

import type { MessageItem, WeixinMessage } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { resolveStateDir } from "../storage/state-dir.js";
import { logger } from "../util/logger.js";

/**
 * Replay-dedupe tombstone TTL for getUpdates at-least-once delivery.
 * Covers ~1s iLink replays and longer redeliveries (e.g. 30–50 min after a
 * stuck long turn). Not a content-dedupe window: a new user send with a new
 * `message_id` is always claimed. Body-fingerprint keys include create_time_ms.
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
/** Cap reclaim attempts after an in-flight owner releases without committing. */
const WEIXIN_INBOUND_ADMIT_MAX_ATTEMPTS = 3;

function sanitizeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "global";
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function resolveReplayDedupeFilePath(namespace: string): string {
  return path.join(resolveStateDir(), "openclaw-weixin", "replay-dedupe", `${sanitizeSegment(namespace)}.json`);
}

function onReplayDedupeDiskError(error: unknown): void {
  logger.warn(`[weixin] inbound replay-dedupe disk error: ${error instanceof Error ? error.message : String(error)}`);
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

/** Non-sensitive identity kind for logs (no account / user / client ids). */
export function describeWeixinInboundDedupeIdentity(key: string): "mid" | "cid" | "seq" | "body" | "unknown" {
  if (key.includes(":mid:")) return "mid";
  if (key.includes(":cid:")) return "cid";
  if (key.includes(":seq:")) return "seq";
  if (key.includes(":body:")) return "body";
  return "unknown";
}

export type WeixinInboundDedupeOptions = {
  /** Account-scoped namespace for persistent isolation. */
  namespace?: string;
  now?: number;
};

export type WeixinInboundAdmitResult = "process" | "duplicate";

/**
 * Admit a logical inbound message for processing.
 *
 * - `process`: this delivery owns the claim
 * - `duplicate`: a tombstone already exists, or an in-flight owner committed
 *
 * In-flight replays wait for the owner. If the owner releases (failure/abort),
 * this delivery reclaims so the message is not lost.
 */
export async function admitWeixinInboundMessage(
  key: string,
  options?: WeixinInboundDedupeOptions,
): Promise<WeixinInboundAdmitResult> {
  for (let attempt = 0; attempt < WEIXIN_INBOUND_ADMIT_MAX_ATTEMPTS; attempt++) {
    const result = await inboundDedupe.claim(key, {
      namespace: options?.namespace,
      now: options?.now,
    });
    if (result.kind === "claimed") return "process";
    if (result.kind === "duplicate") return "duplicate";

    try {
      await result.pending;
      // Owner committed a tombstone — this delivery is a replay.
      return "duplicate";
    } catch {
      // Owner released without commit — reclaim on the next attempt.
    }
  }
  return "duplicate";
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
