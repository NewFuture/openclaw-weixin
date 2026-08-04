import { describe, expect, it } from "vitest";

import { classifyAuditReport, formatFinding } from "./check-audit.mjs";

describe("classifyAuditReport", () => {
  it("suppresses advisories pinned beneath node_modules/openclaw", () => {
    const report = {
      vulnerabilities: {
        tar: {
          severity: "high",
          nodes: ["node_modules/openclaw/node_modules/tar"],
        },
        openclaw: { severity: "moderate", nodes: ["node_modules/openclaw"] },
      },
    };

    const { blocking, suppressed } = classifyAuditReport(report);
    expect(blocking).toEqual([]);
    expect(suppressed.map((finding) => finding.name)).toEqual(["openclaw", "tar"]);
  });

  it("fails for moderate or higher advisories elsewhere in the tree", () => {
    const report = {
      vulnerabilities: {
        vitest: { severity: "moderate", nodes: ["node_modules/vitest"] },
        shared: {
          severity: "critical",
          nodes: ["node_modules/openclaw/node_modules/shared", "node_modules/shared"],
        },
        noise: { severity: "low", nodes: ["node_modules/noise"] },
        unknown: { severity: "high", nodes: [] },
      },
    };

    const { blocking, suppressed } = classifyAuditReport(report);
    expect(blocking.map((finding) => finding.name)).toEqual(["shared", "unknown", "vitest"]);
    expect(suppressed).toEqual([]);
  });

  it("accepts an empty report", () => {
    expect(classifyAuditReport({})).toEqual({ blocking: [], suppressed: [] });
  });
});

describe("formatFinding", () => {
  it("renders severity, name, and paths", () => {
    expect(formatFinding({ name: "tar", nodes: ["node_modules/tar"], severity: "high" })).toBe(
      "high: tar (node_modules/tar)",
    );
    expect(formatFinding({ name: "tar", nodes: [], severity: "high" })).toBe("high: tar (unknown path)");
  });
});
