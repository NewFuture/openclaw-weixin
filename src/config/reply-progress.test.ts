import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { describe, expect, it } from "vitest";

import { resolveReplyProgressMessagesEnabled } from "./reply-progress.js";

describe("resolveReplyProgressMessagesEnabled", () => {
  it("defaults to enabled when unset", () => {
    expect(resolveReplyProgressMessagesEnabled({} as OpenClawConfig)).toBe(true);
    expect(resolveReplyProgressMessagesEnabled({ channels: {} } as OpenClawConfig)).toBe(true);
  });

  it("can be disabled globally", () => {
    const cfg = {
      channels: {
        "openclaw-weixin": {
          replyProgressMessages: false,
        },
      },
    } as OpenClawConfig;

    expect(resolveReplyProgressMessagesEnabled(cfg)).toBe(false);
  });
});
