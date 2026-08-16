import { describe, expect, it } from "vitest";

import { hostSupportsChannelAliases } from "./check-host-compatibility.mjs";

describe("hostSupportsChannelAliases", () => {
  it.each([
    ["2026.6.1", false],
    ["2026.7.1", true],
    ["2026.8.1-beta.2", true],
    ["2027.1.1", true],
  ])("classifies OpenClaw %s", (version, expected) => {
    expect(hostSupportsChannelAliases(version)).toBe(expected);
  });

  it("rejects malformed versions instead of guessing", () => {
    expect(() => hostSupportsChannelAliases("beta")).toThrow(/invalid OpenClaw version/);
  });
});
