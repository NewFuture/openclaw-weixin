import { describe, expect, it } from "vitest";

import { blockingAuditFindings } from "./audit-all.mjs";

describe("dependency audit gate", () => {
  it("ignores advisories that exist only inside OpenClaw's bundled npm package", () => {
    expect(
      blockingAuditFindings({
        vulnerabilities: {
          "brace-expansion": { nodes: ["node_modules/npm/node_modules/brace-expansion"] },
        },
      }),
    ).toEqual([]);
  });

  it("still fails advisories in the plugin dependency tree", () => {
    expect(
      blockingAuditFindings({
        vulnerabilities: {
          "brace-expansion": { nodes: ["node_modules/brace-expansion"] },
        },
      }),
    ).toEqual([{ name: "brace-expansion", nodes: ["node_modules/brace-expansion"] }]);
  });
});
