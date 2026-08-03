import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WeixinMessage } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { logger } from "../util/logger.js";
import {
  buildWeixinInboundDedupeKey,
  claimWeixinInboundMessage,
  commitWeixinInboundMessage,
  logWeixinInboundDuplicate,
  releaseWeixinInboundMessage,
  resetWeixinInboundDedupeForTests,
  WEIXIN_INBOUND_DEDUPE_TTL_MS,
} from "./inbound-dedupe.js";

vi.mock("../util/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

beforeEach(() => {
  resetWeixinInboundDedupeForTests({ persistent: false });
});

afterEach(() => {
  resetWeixinInboundDedupeForTests({ persistent: false });
});

function textMsg(overrides: Partial<WeixinMessage> = {}): WeixinMessage {
  return {
    from_user_id: "user-1",
    message_id: 42,
    create_time_ms: 1_700_000_000_000,
    item_list: [{ type: MessageItemType.TEXT, text_item: { text: "你好" } }],
    ...overrides,
  };
}

describe("buildWeixinInboundDedupeKey", () => {
  it("prefers message_id", () => {
    expect(buildWeixinInboundDedupeKey("jinjin", textMsg())).toBe("weixin:v1:jinjin:user-1:mid:42");
  });

  it("falls back to client_id then seq then body fingerprint", () => {
    expect(buildWeixinInboundDedupeKey("jinjin", textMsg({ message_id: undefined, client_id: "c-9" }))).toBe(
      "weixin:v1:jinjin:user-1:cid:c-9",
    );
    expect(
      buildWeixinInboundDedupeKey("jinjin", textMsg({ message_id: undefined, client_id: undefined, seq: 7 })),
    ).toBe("weixin:v1:jinjin:user-1:seq:7");
    const bodyKey = buildWeixinInboundDedupeKey(
      "jinjin",
      textMsg({ message_id: undefined, client_id: undefined, seq: undefined }),
    );
    expect(bodyKey).toMatch(/^weixin:v1:jinjin:user-1:body:[0-9a-f]{16}$/);
  });

  it("returns null only when identity is empty", () => {
    expect(buildWeixinInboundDedupeKey("", {})).toBeNull();
    expect(buildWeixinInboundDedupeKey("acc", {})).toBeNull();
  });
});

describe("claimWeixinInboundMessage", () => {
  it("claims once, rejects in-flight/duplicate, allows after TTL", async () => {
    const key = buildWeixinInboundDedupeKey("jinjin", textMsg());
    expect(key).toBeTruthy();
    if (!key) return;
    const t0 = 1_000_000;
    const ns = { namespace: "jinjin", now: t0 };

    expect(await claimWeixinInboundMessage(key, ns)).toBe(true);
    expect(await claimWeixinInboundMessage(key, { ...ns, now: t0 + 900 })).toBe(false);

    await commitWeixinInboundMessage(key, ns);
    expect(await claimWeixinInboundMessage(key, { ...ns, now: t0 + 60_000 })).toBe(false);
    expect(
      await claimWeixinInboundMessage(key, {
        namespace: "jinjin",
        now: t0 + WEIXIN_INBOUND_DEDUPE_TTL_MS + 1,
      }),
    ).toBe(true);
  });

  it("release allows retry after failure", async () => {
    const key = buildWeixinInboundDedupeKey("jinjin", textMsg());
    expect(key).toBeTruthy();
    if (!key) return;
    const ns = { namespace: "jinjin", now: 1_000_000 };
    expect(await claimWeixinInboundMessage(key, ns)).toBe(true);
    releaseWeixinInboundMessage(key, { ...ns, error: new Error("boom") });
    expect(await claimWeixinInboundMessage(key, ns)).toBe(true);
  });

  it("isolates claims across account namespaces", async () => {
    const key = "weixin:v1:shared:user-1:mid:99";
    expect(await claimWeixinInboundMessage(key, { namespace: "acc-a" })).toBe(true);
    expect(await claimWeixinInboundMessage(key, { namespace: "acc-b" })).toBe(true);
    await commitWeixinInboundMessage(key, { namespace: "acc-a" });
    expect(await claimWeixinInboundMessage(key, { namespace: "acc-a" })).toBe(false);
    expect(await claimWeixinInboundMessage(key, { namespace: "acc-b" })).toBe(false);
  });

  it("covers long-turn redelivery window (30–50 min)", async () => {
    const key = buildWeixinInboundDedupeKey("jinjin", textMsg());
    expect(key).toBeTruthy();
    if (!key) return;
    const t0 = 5_000_000;
    expect(await claimWeixinInboundMessage(key, { namespace: "jinjin", now: t0 })).toBe(true);
    await commitWeixinInboundMessage(key, { namespace: "jinjin", now: t0 });
    expect(
      await claimWeixinInboundMessage(key, {
        namespace: "jinjin",
        now: t0 + 50 * 60 * 1000,
      }),
    ).toBe(false);
  });

  it("persists committed claims across restart via plugin-state SQLite", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-replay-dedupe-"));
    const previous = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    try {
      resetWeixinInboundDedupeForTests({ persistent: true });
      const key = buildWeixinInboundDedupeKey("jinjin", textMsg());
      expect(key).toBeTruthy();
      if (!key) return;
      expect(await claimWeixinInboundMessage(key, { namespace: "jinjin" })).toBe(true);
      await commitWeixinInboundMessage(key, { namespace: "jinjin" });

      resetWeixinInboundDedupeForTests({ persistent: true });
      expect(await claimWeixinInboundMessage(key, { namespace: "jinjin" })).toBe(false);
      expect(fs.existsSync(path.join(dir, "state", "openclaw.sqlite"))).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previous;
      }
      resetWeixinInboundDedupeForTests({ persistent: false });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("logWeixinInboundDuplicate", () => {
  it("logs account and key", () => {
    logWeixinInboundDuplicate({
      accountId: "jinjin",
      key: "weixin:v1:jinjin:u:mid:1",
      messageId: 1,
      seq: 2,
      from: "u",
    });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("dropping duplicate inbound message"));
  });
});
