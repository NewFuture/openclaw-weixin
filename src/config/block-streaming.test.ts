import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { describe, expect, it } from "vitest";

import { resolveWeixinBlockStreamingEnabled } from "./block-streaming.js";

function config(openclawWeixin: unknown): OpenClawConfig {
  return { channels: { "openclaw-weixin": openclawWeixin } } as OpenClawConfig;
}

describe("resolveWeixinBlockStreamingEnabled", () => {
  it("defaults to enabled", () => {
    expect(resolveWeixinBlockStreamingEnabled({} as OpenClawConfig, "account-1")).toBe(true);
  });

  it("uses the channel setting", () => {
    expect(resolveWeixinBlockStreamingEnabled(config({ blockStreaming: false }), "account-1")).toBe(false);
  });

  it("lets the account setting override the channel setting", () => {
    expect(
      resolveWeixinBlockStreamingEnabled(
        config({
          blockStreaming: false,
          accounts: { "account-1": { blockStreaming: true } },
        }),
        "account-1",
      ),
    ).toBe(true);
    expect(
      resolveWeixinBlockStreamingEnabled(
        config({
          blockStreaming: true,
          accounts: { "account-1": { blockStreaming: false } },
        }),
        "account-1",
      ),
    ).toBe(false);
  });

  it("prefers a public alias and falls back to the primary account id", () => {
    const cfg = config({
      blockStreaming: true,
      accounts: {
        leader: { blockStreaming: false },
        "bot-im-bot": { blockStreaming: true },
      },
    });

    expect(resolveWeixinBlockStreamingEnabled(cfg, "leader", "bot-im-bot")).toBe(false);
    expect(resolveWeixinBlockStreamingEnabled(cfg, "missing-alias", "bot-im-bot")).toBe(true);
  });
});
