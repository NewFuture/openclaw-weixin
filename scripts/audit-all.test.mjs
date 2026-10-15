import { describe, expect, it } from "vitest";

import { assertAuditReport, blockingAuditFindings } from "./audit-all.mjs";

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

  it("rejects an error payload that has no vulnerability report", () => {
    expect(() => assertAuditReport({ error: { code: "EAUDIT", summary: "audit endpoint failed" } }, 1)).toThrow(
      "did not return a vulnerability report",
    );
    expect(() => assertAuditReport({ vulnerabilities: {} }, null)).toThrow("exited with status");
    expect(() => assertAuditReport({ vulnerabilities: [] }, 1)).toThrow("did not return a vulnerability report");
  });

  it("keeps a status 1 vulnerability report eligible for the bundled-npm exception", () => {
    const report = assertAuditReport(
      { vulnerabilities: { "brace-expansion": { nodes: ["node_modules/npm/node_modules/brace-expansion"] } } },
      1,
    );
    expect(blockingAuditFindings(report)).toEqual([]);
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
