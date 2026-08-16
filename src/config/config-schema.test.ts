import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import plugin from "../../index.js";
import { weixinPlugin } from "../channel.js";

const pluginManifest = JSON.parse(readFileSync(new URL("../../openclaw.plugin.json", import.meta.url), "utf8")) as {
  channelConfigs: Record<
    string,
    {
      schema: {
        additionalProperties?: boolean;
        properties?: Record<string, unknown>;
      };
    }
  >;
};

function parseConfig(value: unknown) {
  const result = plugin.configSchema.runtime?.safeParse(value);
  expect(result).toMatchObject({ success: true });
  if (!result?.success) {
    throw new Error("expected config to parse");
  }
  return result.data;
}

describe("plugin config schema", () => {
  it("applies root and account defaults", () => {
    expect(parseConfig({ accounts: { account1: {} } })).toMatchObject({
      baseUrl: "https://ilinkai.weixin.qq.com",
      cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
      replyProgressMessages: true,
      accounts: {
        account1: {
          baseUrl: "https://ilinkai.weixin.qq.com",
          cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
        },
      },
    });
  });

  it("accepts every declared config option", () => {
    const config = {
      name: "Primary Bot",
      enabled: false,
      baseUrl: "https://custom.api.test",
      cdnBaseUrl: "https://custom.cdn.test",
      routeTag: "route-primary",
      botAgent: "MyBot/1.2.0",
      replyProgressMessages: false,
      channelConfigUpdatedAt: "2026-08-16T00:00:00.000Z",
      accounts: {
        account1: {
          name: "Account Bot",
          enabled: true,
          baseUrl: "https://account.api.test",
          cdnBaseUrl: "https://account.cdn.test",
          routeTag: 42,
        },
      },
    };

    expect(parseConfig(config)).toMatchObject(config);
    expect(parseConfig({ routeTag: 42 })).toMatchObject({ routeTag: 42 });
  });

  it("keeps unknown fields permissive", () => {
    const config = {
      futureOption: "value",
      accounts: {
        account1: { futureAccountOption: true },
      },
    };

    expect(parseConfig(config)).toMatchObject(config);
  });

  it.each([
    ["root value", null],
    ["root array", []],
    ["name", { name: 1 }],
    ["enabled", { enabled: "yes" }],
    ["baseUrl", { baseUrl: false }],
    ["cdnBaseUrl", { cdnBaseUrl: 1 }],
    ["routeTag", { routeTag: false }],
    ["botAgent", { botAgent: 1 }],
    ["replyProgressMessages", { replyProgressMessages: "yes" }],
    ["channelConfigUpdatedAt", { channelConfigUpdatedAt: 1 }],
    ["accounts container", { accounts: [] }],
    ["account value", { accounts: { account1: "invalid" } }],
    ["account field", { accounts: { account1: { enabled: "yes" } } }],
    ["account routeTag", { accounts: { account1: { routeTag: false } } }],
  ])("rejects invalid %s types", (_label, value) => {
    expect(plugin.configSchema.runtime?.safeParse(value)).toMatchObject({
      success: false,
    });
  });

  it("uses the same runtime schema for entry and channel registration", () => {
    expect(weixinPlugin.configSchema).toBe(plugin.configSchema);
  });

  it("advertises documented settings in the static channel manifest", () => {
    expect(pluginManifest.channelConfigs["openclaw-weixin"]?.schema).toMatchObject({
      additionalProperties: true,
      properties: {
        botAgent: { type: "string" },
        replyProgressMessages: { type: "boolean", default: true },
      },
    });
  });
});
