import { describe, expect, it } from "vitest";

import {
  assertConfigMutationResultPreserved,
  assertReloadConfigPreserved,
  hostSupportsChannelAliases,
} from "./check-host-compatibility.mjs";

describe("hostSupportsChannelAliases", () => {
  it.each([
    ["2026.6.1", false],
    ["2026.7.1", true],
    ["2026.8.1-beta.2", true],
    ["2027.1.1", true],
  ])("classifies OpenClaw %s", (version, expected) => {
    expect(hostSupportsChannelAliases(version)).toBe(expected);
  });

  describe("assertReloadConfigPreserved", () => {
    const source = {
      gateway: { port: 19001 },
      channels: {
        "openclaw-weixin": {
          replyProgressMessages: false,
          accounts: { "account-1": { enabled: false } },
          channelConfigUpdatedAt: "2000-01-01T00:00:00.000Z",
        },
        telegram: { enabled: false },
      },
    };

    function updatedConfig() {
      const config = structuredClone(source);
      config.channels["openclaw-weixin"].channelConfigUpdatedAt = "2026-08-23T00:00:00.000Z";
      return config;
    }

    it("accepts only the timestamp change and host-managed metadata", () => {
      const config = {
        ...updatedConfig(),
        meta: { lastTouchedVersion: "2026.8.2", lastTouchedAt: "2026-08-23T00:00:00.000Z" },
      };

      expect(() => assertReloadConfigPreserved(config, source)).not.toThrow();
      expect(config.meta.lastTouchedVersion).toBe("2026.8.2");
      expect(source.channels["openclaw-weixin"].channelConfigUpdatedAt).toBe("2000-01-01T00:00:00.000Z");
    });

    it.each([undefined, "invalid", "2000-01-01T00:00:00.000Z"])("rejects an unwritten timestamp %s", (timestamp) => {
      const config = updatedConfig();
      config.channels["openclaw-weixin"].channelConfigUpdatedAt = timestamp;

      expect(() => assertReloadConfigPreserved(config, source)).toThrow("did not update the channel timestamp");
    });

    it.each([
      ["root settings", (config) => (config.gateway.port = 18789)],
      ["channel settings", (config) => (config.channels["openclaw-weixin"].replyProgressMessages = true)],
      ["account overrides", (config) => (config.channels["openclaw-weixin"].accounts["account-1"].enabled = true)],
      ["other channels", (config) => (config.channels.telegram.enabled = true)],
      ["removed settings", (config) => (config.logging = { level: "debug" })],
    ])("rejects stale %s", (_label, change) => {
      const config = updatedConfig();
      change(config);

      expect(() => assertReloadConfigPreserved(config, source)).toThrow("changed unrelated source configuration");
    });

    describe("assertConfigMutationResultPreserved", () => {
      function mutationResult() {
        return {
          nextConfig: updatedConfig(),
          afterWrite: { mode: "auto" },
          followUp: { mode: "auto", requiresRestart: false },
        };
      }

      it("accepts runtime defaults when the persisted source is preserved", () => {
        const result = {
          ...mutationResult(),
          nextConfig: { ...updatedConfig(), agents: { list: [{ id: "main" }] } },
        };

        expect(() => assertConfigMutationResultPreserved(result, updatedConfig(), source)).not.toThrow();
      });

      it("accepts legacy results without a separate persisted source", () => {
        expect(() => assertConfigMutationResultPreserved(mutationResult(), updatedConfig(), source)).not.toThrow();
      });

      it.each(["nextConfig", "persistedSourceConfig"])("rejects disk changes even when %s is correct", (field) => {
        const result = { ...mutationResult(), [field]: updatedConfig() };
        const persisted = updatedConfig();
        persisted.gateway.port = 18789;

        expect(() => assertConfigMutationResultPreserved(result, persisted, source)).toThrow(
          "changed unrelated source configuration",
        );
      });

      it("rejects an unwritten timestamp even when the result reports success", () => {
        expect(() => assertConfigMutationResultPreserved(mutationResult(), source, source)).toThrow(
          "did not update the channel timestamp",
        );
      });

      it.each(["afterWrite", "followUp"])("rejects changed %s intent", (field) => {
        const result = { ...mutationResult(), [field]: { mode: "none" } };

        expect(() => assertConfigMutationResultPreserved(result, updatedConfig(), source)).toThrow(
          "did not retain automatic config follow-up intent",
        );
      });
    });
  });

  it("rejects malformed versions instead of guessing", () => {
    expect(() => hostSupportsChannelAliases("beta")).toThrow(/invalid OpenClaw version/);
  });
});
