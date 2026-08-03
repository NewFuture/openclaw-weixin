import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WeixinMessage } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { logger } from "../util/logger.js";
import {
  admitWeixinInboundMessage,
  buildWeixinInboundDedupeKey,
  commitWeixinInboundMessage,
  describeWeixinInboundDedupeIdentity,
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

describe("describeWeixinInboundDedupeIdentity", () => {
  it("returns a non-sensitive identity kind", () => {
    expect(describeWeixinInboundDedupeIdentity("weixin:v1:acc:user:mid:1")).toBe("mid");
    expect(describeWeixinInboundDedupeIdentity("weixin:v1:acc:user:cid:x")).toBe("cid");
    expect(describeWeixinInboundDedupeIdentity("weixin:v1:acc:user:seq:9")).toBe("seq");
    expect(describeWeixinInboundDedupeIdentity("weixin:v1:acc:user:body:abcd")).toBe("body");
  });
});

describe("admitWeixinInboundMessage", () => {
  it("admits once, rejects committed duplicates, allows after TTL", async () => {
    const key = buildWeixinInboundDedupeKey("jinjin", textMsg());
    expect(key).toBeTruthy();
    if (!key) return;
    const t0 = 1_000_000;
    const ns = { namespace: "jinjin", now: t0 };

    expect(await admitWeixinInboundMessage(key, ns)).toBe("process");
    const inFlight = admitWeixinInboundMessage(key, { ...ns, now: t0 + 900 });
    await commitWeixinInboundMessage(key, ns);
    expect(await inFlight).toBe("duplicate");
    expect(await admitWeixinInboundMessage(key, { ...ns, now: t0 + 60_000 })).toBe("duplicate");
    expect(
      await admitWeixinInboundMessage(key, {
        namespace: "jinjin",
        now: t0 + WEIXIN_INBOUND_DEDUPE_TTL_MS + 1,
      }),
    ).toBe("process");
  });

  it("reclaims after the in-flight owner releases", async () => {
    const key = buildWeixinInboundDedupeKey("jinjin", textMsg());
    expect(key).toBeTruthy();
    if (!key) return;
    const ns = { namespace: "jinjin", now: 1_000_000 };

    expect(await admitWeixinInboundMessage(key, ns)).toBe("process");
    const waiting = admitWeixinInboundMessage(key, ns);
    // Let the waiter observe the in-flight claim before release.
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseWeixinInboundMessage(key, { ...ns, error: new Error("boom") });
    expect(await waiting).toBe("process");
  });

  it("isolates claims across account namespaces", async () => {
    const key = "weixin:v1:shared:user-1:mid:99";
    expect(await admitWeixinInboundMessage(key, { namespace: "acc-a" })).toBe("process");
    expect(await admitWeixinInboundMessage(key, { namespace: "acc-b" })).toBe("process");
    await commitWeixinInboundMessage(key, { namespace: "acc-a" });
    expect(await admitWeixinInboundMessage(key, { namespace: "acc-a" })).toBe("duplicate");
    const waitingB = admitWeixinInboundMessage(key, { namespace: "acc-b" });
    await commitWeixinInboundMessage(key, { namespace: "acc-b" });
    expect(await waitingB).toBe("duplicate");
  });

  it("covers long-turn redelivery window (30–50 min)", async () => {
    const key = buildWeixinInboundDedupeKey("jinjin", textMsg());
    expect(key).toBeTruthy();
    if (!key) return;
    const t0 = 5_000_000;
    expect(await admitWeixinInboundMessage(key, { namespace: "jinjin", now: t0 })).toBe("process");
    await commitWeixinInboundMessage(key, { namespace: "jinjin", now: t0 });
    expect(
      await admitWeixinInboundMessage(key, {
        namespace: "jinjin",
        now: t0 + 50 * 60 * 1000,
      }),
    ).toBe("duplicate");
  });

  it("persists committed claims across restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-replay-dedupe-"));
    const previous = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    try {
      resetWeixinInboundDedupeForTests({ persistent: true });
      const key = buildWeixinInboundDedupeKey("jinjin", textMsg());
      expect(key).toBeTruthy();
      if (!key) return;
      expect(await admitWeixinInboundMessage(key, { namespace: "jinjin" })).toBe("process");
      await commitWeixinInboundMessage(key, { namespace: "jinjin" });

      resetWeixinInboundDedupeForTests({ persistent: true });
      expect(await admitWeixinInboundMessage(key, { namespace: "jinjin" })).toBe("duplicate");

      const jsonPath = path.join(dir, "openclaw-weixin", "replay-dedupe", "jinjin.json");
      const sqlitePath = path.join(dir, "state", "openclaw.sqlite");
      expect(fs.existsSync(jsonPath) || fs.existsSync(sqlitePath)).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previous;
      }
      resetWeixinInboundDedupeForTests({ persistent: false });
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may keep the OpenClaw state DB open until process exit.
      }
    }
  });
});

describe("logWeixinInboundDuplicate", () => {
  it("logs only non-sensitive identity metadata", () => {
    logWeixinInboundDuplicate({
      key: "weixin:v1:jinjin:user-secret:mid:1",
      messageId: 1,
      seq: 2,
    });
    expect(logger.info).toHaveBeenCalledWith(
      "[weixin] dropping duplicate inbound message identity=mid hasMsgId=true hasSeq=true",
    );
    const logged = String(vi.mocked(logger.info).mock.calls[0]?.[0] ?? "");
    expect(logged).not.toContain("jinjin");
    expect(logged).not.toContain("user-secret");
    expect(logged).not.toContain("weixin:v1");
  });
});
