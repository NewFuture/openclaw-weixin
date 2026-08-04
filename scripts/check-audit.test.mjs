import { describe, expect, it } from "vitest";

import { partitionAdvisories } from "./check-audit.mjs";

function report() {
  return {
    vulnerabilities: {
      tar: { severity: "moderate", nodes: ["node_modules/openclaw/node_modules/tar"] },
      undici: { severity: "high", nodes: ["node_modules/openclaw/node_modules/undici"] },
      openclaw: { severity: "moderate", nodes: ["node_modules/openclaw"], via: ["tar", "undici"] },
      vite: { severity: "high", nodes: ["node_modules/vite"] },
      "dev-only": { severity: "low", nodes: ["node_modules/dev-only"] },
    },
  };
}

describe("partitionAdvisories", () => {
  it("only fails on advisories this repository can fix", () => {
    const { blocking, upstream } = partitionAdvisories(report());
    expect(blocking.map((entry) => entry.name)).toEqual(["vite"]);
    expect(upstream.map((entry) => entry.name)).toEqual(["openclaw", "tar", "undici"]);
  });

  it("ignores advisories below the requested level", () => {
    const { blocking } = partitionAdvisories(report(), { level: "critical" });
    expect(blocking).toEqual([]);
  });

  it("includes low severity findings when asked", () => {
    const { blocking } = partitionAdvisories(report(), { level: "low" });
    expect(blocking.map((entry) => entry.name)).toEqual(["dev-only", "vite"]);
  });

  it("blocks a direct advisory against the openclaw devDependency", () => {
    const direct = report();
    direct.vulnerabilities.openclaw.via = [{ name: "openclaw", title: "example", severity: "moderate" }];
    expect(partitionAdvisories(direct).blocking.map((entry) => entry.name)).toEqual(["openclaw", "vite"]);
  });

  it("blocks advisories that also reach the tree outside openclaw", () => {
    const shared = report();
    shared.vulnerabilities.tar.nodes.push("node_modules/tar");
    expect(partitionAdvisories(shared).blocking.map((entry) => entry.name)).toContain("tar");
  });

  it("blocks advisories with no reported install path", () => {
    const unknown = { vulnerabilities: { mystery: { severity: "high" } } };
    expect(partitionAdvisories(unknown).blocking.map((entry) => entry.name)).toEqual(["mystery"]);
  });

  it("accepts an empty audit report", () => {
    expect(partitionAdvisories({})).toEqual({ blocking: [], upstream: [] });
  });

  it("rejects an unknown audit level", () => {
    expect(() => partitionAdvisories(report(), { level: "severe" })).toThrow('unknown audit level "severe"');
  });
});
