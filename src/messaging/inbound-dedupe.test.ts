import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WeixinMessage } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { logger } from "../util/logger.js";
import {
  buildWeixinInboundDedupeKey,
  collectWeixinItemMsgIds,
  commitWeixinInboundMessage,
  describeWeixinInboundDedupeIdentity,
  logWeixinInboundDuplicate,
  releaseWeixinInboundMessage,
  resetWeixinInboundDedupeForTests,
  tryClaimWeixinInboundMessage,
  WEIXIN_INBOUND_DEDUPE_TTL_MS,
  waitForInflightWeixinInboundOwner,
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

  it.each([0, -7, 42, Number.MAX_SAFE_INTEGER])("keeps the legacy key for safe integer %s", (id) => {
    const legacyKey = buildWeixinInboundDedupeKey("account-test", textMsg({ message_id: id }));
    expect(buildWeixinInboundDedupeKey("account-test", textMsg({ message_id: String(id) }))).toBe(legacyKey);
    expect(legacyKey).toBe(`weixin:v1:account-test:user-1:mid:${id}`);
  });

  it("canonicalizes negative zero to the legacy zero key", () => {
    expect(buildWeixinInboundDedupeKey("account-test", textMsg({ message_id: "-0" }))).toBe(
      buildWeixinInboundDedupeKey("account-test", textMsg({ message_id: -0 })),
    );
  });

  it.each([
    undefined,
    "",
    " ",
    "42\n",
    "NaN",
    "1.5",
    "1e30",
    "0042",
    "42:extra",
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("uses the existing fallback chain for an unreliable message_id (%s)", (message_id) => {
    const msg = textMsg({ message_id });
    expect(buildWeixinInboundDedupeKey("account-test", { ...msg, client_id: "client-test" })).toContain(
      ":cid:client-test",
    );
    expect(buildWeixinInboundDedupeKey("account-test", { ...msg, seq: 7 })).toContain(":seq:7");
    expect(
      buildWeixinInboundDedupeKey("account-test", {
        ...msg,
        item_list: [{ type: MessageItemType.IMAGE, msg_id: "item-test" }],
      }),
    ).toContain(":items:");
    expect(buildWeixinInboundDedupeKey("account-test", msg)).toContain(":body:");
    expect(
      buildWeixinInboundDedupeKey("account-test", { ...msg, item_list: [{ type: MessageItemType.IMAGE }] }),
    ).toBeNull();
  });

  it("ignores malformed item IDs instead of crashing or keying media by sender alone", () => {
    const msg: WeixinMessage = JSON.parse(
      '{"from_user_id":"user-test","message_id":null,"item_list":[{"type":2,"msg_id":1.5},{"msg_id":true},{"msg_id":{}}]}',
    );
    expect(buildWeixinInboundDedupeKey("account-test", msg)).toBeNull();
  });

  it("falls back to client_id then seq then item msg_ids then body fingerprint", () => {
    expect(buildWeixinInboundDedupeKey("jinjin", textMsg({ message_id: undefined, client_id: "c-9" }))).toBe(
      "weixin:v1:jinjin:user-1:cid:c-9",
    );
    expect(
      buildWeixinInboundDedupeKey("jinjin", textMsg({ message_id: undefined, client_id: undefined, seq: 7 })),
    ).toBe("weixin:v1:jinjin:user-1:seq:7");

    const itemsKey = buildWeixinInboundDedupeKey(
      "jinjin",
      textMsg({
        message_id: undefined,
        client_id: undefined,
        seq: undefined,
        item_list: [
          { type: MessageItemType.IMAGE, msg_id: "img-b" },
          { type: MessageItemType.IMAGE, msg_id: "img-a" },
        ],
      }),
    );
    expect(itemsKey).toMatch(/^weixin:v1:jinjin:user-1:items:[0-9a-f]{16}$/);
    expect(collectWeixinItemMsgIds([{ msg_id: "img-b" }, { msg_id: "img-a" }])).toEqual(["img-a", "img-b"]);

    const bodyKey = buildWeixinInboundDedupeKey(
      "jinjin",
      textMsg({ message_id: undefined, client_id: undefined, seq: undefined }),
    );
    expect(bodyKey).toMatch(/^weixin:v1:jinjin:user-1:body:[0-9a-f]{16}$/);
  });

  it("does not collide identifierless media messages from the same sender", () => {
    const mediaA: WeixinMessage = {
      from_user_id: "user-1",
      item_list: [{ type: MessageItemType.IMAGE, msg_id: "media-a" }],
    };
    const mediaB: WeixinMessage = {
      from_user_id: "user-1",
      item_list: [{ type: MessageItemType.IMAGE, msg_id: "media-b" }],
    };
    const keyA = buildWeixinInboundDedupeKey("jinjin", mediaA);
    const keyB = buildWeixinInboundDedupeKey("jinjin", mediaB);
    expect(keyA).toBeTruthy();
    expect(keyB).toBeTruthy();
    expect(keyA).not.toBe(keyB);

    const bareMedia: WeixinMessage = {
      from_user_id: "user-1",
      item_list: [{ type: MessageItemType.IMAGE }],
    };
    expect(buildWeixinInboundDedupeKey("jinjin", bareMedia)).toBeNull();
    expect(buildWeixinInboundDedupeKey("jinjin", { from_user_id: "user-1", item_list: [null as never] })).toBeNull();
  });

  it("returns null only when identity is empty", () => {
    expect(buildWeixinInboundDedupeKey("", {})).toBeNull();
    expect(buildWeixinInboundDedupeKey("acc", {})).toBeNull();
  });
});

describe("describeWeixinInboundDedupeIdentity", () => {
  it("returns a non-sensitive identity kind", () => {
    expect(describeWeixinInboundDedupeIdentity("weixin:v1:acc:user:mid:1")).toBe("mid");
    expect(describeWeixinInboundDedupeIdentity("weixin:v1:acc:user:cid:x")).toBe("cid");
    expect(describeWeixinInboundDedupeIdentity("weixin:v1:acc:user:seq:9")).toBe("seq");
    expect(describeWeixinInboundDedupeIdentity("weixin:v1:acc:user:items:abcd")).toBe("items");
    expect(describeWeixinInboundDedupeIdentity("weixin:v1:acc:user:body:abcd")).toBe("body");
  });
});

describe("tryClaimWeixinInboundMessage", () => {
  it("claims once, reports inflight, drops after commit, allows after TTL", async () => {
    const key = buildWeixinInboundDedupeKey("jinjin", textMsg());
    expect(key).toBeTruthy();
    if (!key) return;
    const t0 = 1_000_000;
    const ns = { namespace: "jinjin", now: t0 };

    expect(await tryClaimWeixinInboundMessage(key, ns)).toEqual({ kind: "claimed" });
    const second = await tryClaimWeixinInboundMessage(key, { ...ns, now: t0 + 900 });
    expect(second.kind).toBe("inflight");
    if (second.kind !== "inflight") return;

    await commitWeixinInboundMessage(key, ns);
    expect(await waitForInflightWeixinInboundOwner(second.pending)).toBe("duplicate");
    expect(await tryClaimWeixinInboundMessage(key, { ...ns, now: t0 + 60_000 })).toEqual({ kind: "duplicate" });
    expect(
      await tryClaimWeixinInboundMessage(key, {
        namespace: "jinjin",
        now: t0 + WEIXIN_INBOUND_DEDUPE_TTL_MS + 1,
      }),
    ).toEqual({ kind: "claimed" });
  });

  it("reports released so callers can reclaim after the owner fails", async () => {
    const key = buildWeixinInboundDedupeKey("jinjin", textMsg());
    expect(key).toBeTruthy();
    if (!key) return;
    const ns = { namespace: "jinjin", now: 1_000_000 };

    expect(await tryClaimWeixinInboundMessage(key, ns)).toEqual({ kind: "claimed" });
    const waiting = await tryClaimWeixinInboundMessage(key, ns);
    expect(waiting.kind).toBe("inflight");
    if (waiting.kind !== "inflight") return;

    releaseWeixinInboundMessage(key, { ...ns, error: new Error("boom") });
    expect(await waitForInflightWeixinInboundOwner(waiting.pending)).toBe("released");
    expect(await tryClaimWeixinInboundMessage(key, ns)).toEqual({ kind: "claimed" });
  });

  it("isolates claims across account namespaces", async () => {
    const key = "weixin:v1:shared:user-1:mid:99";
    expect(await tryClaimWeixinInboundMessage(key, { namespace: "acc-a" })).toEqual({ kind: "claimed" });
    expect(await tryClaimWeixinInboundMessage(key, { namespace: "acc-b" })).toEqual({ kind: "claimed" });
    await commitWeixinInboundMessage(key, { namespace: "acc-a" });
    expect(await tryClaimWeixinInboundMessage(key, { namespace: "acc-a" })).toEqual({ kind: "duplicate" });
    await commitWeixinInboundMessage(key, { namespace: "acc-b" });
    expect(await tryClaimWeixinInboundMessage(key, { namespace: "acc-b" })).toEqual({ kind: "duplicate" });
  });

  it("covers long-turn redelivery window (30–50 min)", async () => {
    const key = buildWeixinInboundDedupeKey("jinjin", textMsg());
    expect(key).toBeTruthy();
    if (!key) return;
    const t0 = 5_000_000;
    expect(await tryClaimWeixinInboundMessage(key, { namespace: "jinjin", now: t0 })).toEqual({ kind: "claimed" });
    await commitWeixinInboundMessage(key, { namespace: "jinjin", now: t0 });
    expect(
      await tryClaimWeixinInboundMessage(key, {
        namespace: "jinjin",
        now: t0 + 50 * 60 * 1000,
      }),
    ).toEqual({ kind: "duplicate" });
  });

  it("preserves legacy safe-number tombstones and exact large IDs across restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-replay-dedupe-"));
    try {
      const script = fileURLToPath(new URL("../../test/helpers/inbound-dedupe-persistence.mjs", import.meta.url));
      for (const stage of ["legacy", "current", "replay"]) {
        // Each process owns its host SQLite workers and closes them before cleanup.
        await promisify(execFile)(process.execPath, [script, stage], {
          env: {
            ...process.env,
            OPENCLAW_STATE_DIR: dir,
            OPENCLAW_OAUTH_DIR: path.join(dir, "oauth"),
          },
          timeout: 60_000,
        });
      }

      const jsonPath = path.join(dir, "openclaw-weixin", "replay-dedupe", "account-test.json");
      const sqlitePath = path.join(dir, "state", "openclaw.sqlite");
      expect(fs.existsSync(jsonPath) || fs.existsSync(sqlitePath)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it("redacts persistent commit errors and still allows released claims to retry", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-replay-dedupe-error-"));
    const blockedStateDir = path.join(dir, "blocked-state");
    fs.writeFileSync(blockedStateDir, "not-a-directory", "utf-8");
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    const previousOauthDir = process.env.OPENCLAW_OAUTH_DIR;
    process.env.OPENCLAW_STATE_DIR = blockedStateDir;
    process.env.OPENCLAW_OAUTH_DIR = path.join(dir, "oauth");
    try {
      resetWeixinInboundDedupeForTests({ persistent: true });
      const diskKey = buildWeixinInboundDedupeKey("account-disk", textMsg());
      expect(diskKey).toBeTruthy();
      if (!diskKey) return;

      expect(await tryClaimWeixinInboundMessage(diskKey, { namespace: "account-disk" })).toEqual({ kind: "claimed" });
      await commitWeixinInboundMessage(diskKey, { namespace: "account-disk" });
      const warnings = vi.mocked(logger.warn).mock.calls.flat().join(" ");
      expect(warnings).toContain("inbound replay-dedupe disk error: Error");
      expect(warnings).not.toContain("blocked-state");
      expect(warnings).not.toContain(dir);

      const releasedKey = buildWeixinInboundDedupeKey("account-disk", textMsg({ message_id: 43 }));
      expect(releasedKey).toBeTruthy();
      if (!releasedKey) return;
      expect(await tryClaimWeixinInboundMessage(releasedKey, { namespace: "account-disk" })).toEqual({
        kind: "claimed",
      });
      releaseWeixinInboundMessage(releasedKey, { namespace: "account-disk", error: new Error("owner failed") });
      expect(await tryClaimWeixinInboundMessage(releasedKey, { namespace: "account-disk" })).toEqual({
        kind: "claimed",
      });
      releaseWeixinInboundMessage(releasedKey, { namespace: "account-disk" });
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
      if (previousOauthDir === undefined) {
        delete process.env.OPENCLAW_OAUTH_DIR;
      } else {
        process.env.OPENCLAW_OAUTH_DIR = previousOauthDir;
      }
      resetWeixinInboundDedupeForTests({ persistent: false });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("logWeixinInboundDuplicate", () => {
  it.each([1, "9007199254740993"])("logs only non-sensitive identity metadata for ID %s", (messageId) => {
    logWeixinInboundDuplicate({
      key: "weixin:v1:jinjin:user-secret:mid:1",
      messageId,
      seq: 2,
    });
    expect(logger.info).toHaveBeenCalledWith(
      "[weixin] dropping duplicate inbound message identity=mid hasMsgId=true hasSeq=true",
    );
    const logged = String(vi.mocked(logger.info).mock.calls[0]?.[0] ?? "");
    expect(logged).not.toContain("jinjin");
    expect(logged).not.toContain("user-secret");
    expect(logged).not.toContain("weixin:v1");
    expect(logged).not.toContain("9007199254740993");
  });
});
