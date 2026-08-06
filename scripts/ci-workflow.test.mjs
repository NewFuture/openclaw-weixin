import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

describe("CI workflow contract", () => {
  it("uses npm 11 for Node.js 22 before installing dependencies", () => {
    const npmSetup = [
      "      - name: Use lockfile-compatible npm",
      "        if: startsWith(matrix.node-version, '22.')",
      "        run: npm install --global npm@11.12.1 --no-audit --no-fund",
    ].join("\n");
    const npmSetupIndex = workflow.indexOf(npmSetup);
    const installIndex = workflow.indexOf("      - name: Install dependencies");

    expect(npmSetupIndex).toBeGreaterThan(-1);
    expect(installIndex).toBeGreaterThan(npmSetupIndex);
  });

  it("runs strict checks on current Node.js and smoke checks on compatibility versions", () => {
    expect(
      workflow.match(/node-version: "24\.15\.0"\n\s+openclaw_version: "2026\.7\.1"\n\s+validation: strict/g),
    ).toHaveLength(2);
    expect(
      workflow.match(
        /node-version: "22\.22\.3"\n\s+openclaw_version: "2026\.(?:7\.1|6\.1)"\n\s+validation: compatibility/g,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain(
      "      - name: Build compatibility runtime\n        if: matrix.validation == 'compatibility'",
    );
    expect(workflow).toContain(
      "      - name: Smoke test compatibility runtime\n        if: matrix.validation == 'compatibility'",
    );
    expect(workflow).toContain("      - name: Check project\n        if: matrix.validation == 'strict'");
  });
});
