import { describe, expect, it } from "vitest";

import { assertAuditReport, blockingAuditFindings, npmAuditLaunch } from "./audit-all.mjs";

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

  it("launches npm through node when npm_execpath is set, including on Windows", () => {
    expect(npmAuditLaunch({ npm_execpath: "C:\\npm\\bin\\npm-cli.js" }, "win32", "C:\\node.exe")).toEqual({
      command: "C:\\node.exe",
      args: ["C:\\npm\\bin\\npm-cli.js", "audit", "--json", "--registry", "https://registry.npmjs.org"],
    });
  });

  it("launches npm through the Windows command interpreter when npm_execpath is absent", () => {
    expect(npmAuditLaunch({ ComSpec: "C:\\Windows\\System32\\cmd.exe" }, "win32", "C:\\node.exe")).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm audit --json --registry https://registry.npmjs.org"],
    });
    expect(npmAuditLaunch({}, "linux", "/usr/bin/node")).toEqual({
      command: "npm",
      args: ["audit", "--json", "--registry", "https://registry.npmjs.org"],
    });
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
