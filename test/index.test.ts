import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/channel.js", () => ({
  weixinPlugin: { id: "openclaw-weixin" },
}));
vi.mock("../src/util/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import plugin from "../index.js";
import { weixinPlugin } from "../src/channel.js";

type RegistrationMode = OpenClawPluginApi["registrationMode"];

function register(api: {
  registrationMode?: RegistrationMode;
  runtime: { version: string };
  registerChannel: OpenClawPluginApi["registerChannel"];
}) {
  // Only the entry point's consumed API surface is supplied by this unit harness.
  plugin.register(api as OpenClawPluginApi);
}

describe("plugin registration", () => {
  it("does not read the runtime getter during CLI metadata collection", () => {
    const runtime = vi.fn((): never => {
      throw new Error("runtime getter must not be read");
    });
    const registerChannel = vi.fn<OpenClawPluginApi["registerChannel"]>();

    expect(() =>
      register({
        registrationMode: "cli-metadata",
        get runtime() {
          return runtime();
        },
        registerChannel,
      }),
    ).not.toThrow();
    expect(runtime).not.toHaveBeenCalled();
    expect(registerChannel).not.toHaveBeenCalled();
  });

  it("does not read a runtime Proxy or register a channel during CLI metadata collection", () => {
    const get = vi.fn((): never => {
      throw new Error("runtime properties must not be read");
    });
    const registerChannel = vi.fn<OpenClawPluginApi["registerChannel"]>();

    expect(() =>
      register({
        registrationMode: "cli-metadata",
        runtime: new Proxy({ version: "2026.10.3" }, { get }),
        registerChannel,
      }),
    ).not.toThrow();
    expect(get).not.toHaveBeenCalled();
    expect(registerChannel).not.toHaveBeenCalled();
  });

  it("does not run the runtime version guard during CLI metadata collection", () => {
    const registerChannel = vi.fn<OpenClawPluginApi["registerChannel"]>();

    expect(() =>
      register({
        registrationMode: "cli-metadata",
        runtime: { version: "2026.5.31" },
        registerChannel,
      }),
    ).not.toThrow();
    expect(registerChannel).not.toHaveBeenCalled();
  });

  const runtimeModes = ["full", "discovery", "tool-discovery", "setup-only", "setup-runtime", undefined] as const;

  it.each(runtimeModes)("registers exactly one canonical channel in %s mode", (registrationMode) => {
    const registerChannel = vi.fn<OpenClawPluginApi["registerChannel"]>();

    register({ registrationMode, runtime: { version: "2026.6.1" }, registerChannel });

    expect(plugin.id).toBe("openclaw-weixin");
    expect(registerChannel).toHaveBeenCalledExactlyOnceWith({ plugin: weixinPlugin });
    expect(weixinPlugin.id).toBe(plugin.id);
  });

  it.each(runtimeModes)("still rejects an unsupported runtime host in %s mode", (registrationMode) => {
    const registerChannel = vi.fn<OpenClawPluginApi["registerChannel"]>();

    expect(() => register({ registrationMode, runtime: { version: "2026.5.31" }, registerChannel })).toThrowError(
      /requires OpenClaw >=2026\.6\.1/,
    );
    expect(registerChannel).not.toHaveBeenCalled();
  });
});
