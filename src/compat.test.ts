import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  assertHostCompatibility,
  compareVersions,
  isHostVersionSupported,
  parseOpenClawVersion,
  SUPPORTED_HOST_MIN,
} from "./compat.js";

interface PackageCompatibility {
  devDependencies: { openclaw: string };
  engines: { node: string };
  files: string[];
  openclaw: {
    build: { openclawVersion: string };
    channel: { aliases: string[]; id: string };
    compat: { pluginApi: string };
    install: { minHostVersion: string };
  };
  peerDependencies: { openclaw: string };
}

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as PackageCompatibility;
const pluginManifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8")) as {
  channels: string[];
  description: string;
  id: string;
  name: string;
};

describe("compatibility metadata", () => {
  it("matches the runtime host guard", () => {
    const expectedRange = `>=${SUPPORTED_HOST_MIN}`;

    expect(packageJson.peerDependencies.openclaw).toBe(expectedRange);
    expect(packageJson.openclaw.install.minHostVersion).toBe(expectedRange);
    expect(packageJson.openclaw.compat.pluginApi).toBe(expectedRange);
    expect(packageJson.openclaw.build.openclawVersion).toBe(packageJson.devDependencies.openclaw);
    expect(isHostVersionSupported(packageJson.devDependencies.openclaw)).toBe(true);
  });

  it("provides stable ClawHub display metadata", () => {
    expect(pluginManifest).toMatchObject({
      name: "WeChat",
      description: "Community-maintained WeChat (Weixin) channel plugin for OpenClaw using the iLink bot API.",
    });
    expect(pluginManifest).not.toHaveProperty("icon");
  });

  it("ships a portable PNG brand icon rather than relying on a manifest URL or an activity SVG", () => {
    expect(packageJson.files).toContain("assets/icon.png");
    const icon = readFileSync(new URL("../assets/icon.png", import.meta.url));
    expect(icon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(icon.toString("ascii", 12, 16)).toBe("IHDR");
    expect(icon.readUInt32BE(16)).toBe(512);
    expect(icon.readUInt32BE(20)).toBe(512);
  });

  it("accepts the ClawHub package name as a channel alias without changing canonical identities", () => {
    expect(pluginManifest.id).toBe("openclaw-weixin");
    expect(pluginManifest.channels).toEqual(["openclaw-weixin"]);
    expect(packageJson.openclaw.channel.id).toBe("openclaw-weixin");
    expect(packageJson.openclaw.channel.aliases).toEqual(["openclaw-wechat"]);
  });

  it("declares the supported Node.js floor", () => {
    expect(packageJson.engines.node).toBe(">=22.22.3");
  });
});

describe("parseOpenClawVersion", () => {
  it("parses a standard version", () => {
    expect(parseOpenClawVersion("2026.3.22")).toEqual({ year: 2026, month: 3, day: 22 });
  });

  it("parses a version with pre-release suffix", () => {
    expect(parseOpenClawVersion("2026.3.22-beta.1")).toEqual({ year: 2026, month: 3, day: 22 });
  });

  it("returns null for malformed strings", () => {
    expect(parseOpenClawVersion("")).toBeNull();
    expect(parseOpenClawVersion("abc")).toBeNull();
    expect(parseOpenClawVersion("2026.3")).toBeNull();
    expect(parseOpenClawVersion("2026.3.22.1")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions({ year: 2026, month: 3, day: 22 }, { year: 2026, month: 3, day: 22 })).toBe(0);
  });

  it("compares by year first", () => {
    expect(compareVersions({ year: 2025, month: 12, day: 31 }, { year: 2026, month: 1, day: 1 })).toBe(-1);
  });

  it("compares by month then day", () => {
    expect(compareVersions({ year: 2026, month: 3, day: 22 }, { year: 2026, month: 3, day: 21 })).toBe(1);
    expect(compareVersions({ year: 2026, month: 3, day: 22 }, { year: 2026, month: 4, day: 1 })).toBe(-1);
  });
});

describe("isHostVersionSupported", () => {
  it("accepts the minimum version", () => {
    expect(isHostVersionSupported(SUPPORTED_HOST_MIN)).toBe(true);
  });

  it("rejects the day before the minimum", () => {
    expect(isHostVersionSupported("2026.5.31")).toBe(false);
  });

  it("accepts a version above the minimum", () => {
    expect(isHostVersionSupported("2026.6.2")).toBe(true);
  });

  it("accepts a future version", () => {
    expect(isHostVersionSupported("2026.8.0")).toBe(true);
    expect(isHostVersionSupported("2027.1.1")).toBe(true);
  });

  it("rejects garbage input", () => {
    expect(isHostVersionSupported("not-a-version")).toBe(false);
  });
});

describe("assertHostCompatibility", () => {
  it("does not throw for a supported version", () => {
    expect(() => assertHostCompatibility("2026.6.1")).not.toThrow();
  });

  it("does not throw when version is undefined (graceful skip)", () => {
    expect(() => assertHostCompatibility(undefined)).not.toThrow();
  });

  it("throws for an unsupported version with a helpful message", () => {
    expect(() => assertHostCompatibility("2026.1.5")).toThrowError(
      new RegExp(`This version of openclaw-weixin requires.*${SUPPORTED_HOST_MIN}`),
    );
  });

  it("points unsupported hosts to the community package", () => {
    expect(() => assertHostCompatibility("2026.5.31")).toThrowError(
      /openclaw plugins install npm:openclaw-weixin --force/,
    );
  });
});
