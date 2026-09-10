import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const validateJob = workflow.slice(workflow.indexOf("\n  validate:\n"), workflow.indexOf("\n  gate:\n"));
const [matrix, steps] = validateJob.split("\n    steps:\n");
const matrixRows = matrix.split("\n          - ").slice(1);

describe("OpenClaw CI compatibility matrix", () => {
  it.each([
    ["ubuntu-latest", "24.15.0", "2026.6.1", "compatibility"],
    ["ubuntu-latest", "22.22.3", "2026.7.1", "compatibility"],
    ["ubuntu-latest", "24.15.0", "2026.8.2", "compatibility"],
    ["windows-latest", "24.15.0", "2026.8.2", "compatibility"],
    ["ubuntu-latest", "24.15.0", "2026.9.1", "compatibility"],
    ["ubuntu-latest", "22.22.3", "2026.9.2", "compatibility"],
    ["ubuntu-latest", "24.15.0", "2026.9.2", "strict"],
    ["ubuntu-latest", "26", "2026.9.2", "compatibility"],
    ["windows-latest", "24.15.0", "2026.9.2", "strict"],
    ["ubuntu-latest", "24", "beta", "compatibility"],
  ])("covers %s / Node.js %s / OpenClaw %s with %s validation", (os, node, host, validation) => {
    const hostValue = host === "beta" ? host : JSON.stringify(host);
    const row = matrixRows.find(
      (candidate) =>
        candidate.startsWith(`os: ${os}\n`) &&
        candidate.includes(`            node-version: "${node}"\n`) &&
        candidate.includes(`            openclaw_version: ${hostValue}\n`),
    );

    expect(row).toBeDefined();
    expect(row).toContain(`            validation: ${validation}`);
  });

  it("pins the development SDK, lockfile, and build metadata without raising the minimum host", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

    expect(packageJson.devDependencies.openclaw).toBe("2026.9.2");
    expect(packageJson.openclaw.build.openclawVersion).toBe("2026.9.2");
    expect(lockfile.packages[""].devDependencies.openclaw).toBe("2026.9.2");
    expect(lockfile.packages["node_modules/openclaw"].version).toBe("2026.9.2");
    expect(packageJson.peerDependencies.openclaw).toBe(">=2026.6.1");
    expect(packageJson.openclaw.install.minHostVersion).toBe(">=2026.6.1");
    expect(packageJson.engines.node).toBe(">=22.22.3");
    expect(readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim()).toBe("24.15.0");
    expect(validateJob).not.toContain("continue-on-error:");
  });

  it("checks for the latest Node.js patch only for the moving beta host", () => {
    const setup = steps.slice(
      steps.indexOf("      - name: Set up Node.js\n"),
      steps.indexOf("      - name: Use lockfile-compatible npm\n"),
    );

    expect(setup).toContain(`node-version: \${{ matrix.node-version }}`);
    expect(setup).toContain(`check-latest: \${{ matrix.openclaw_version == 'beta' }}`);
  });

  it("checks exact pins before building instead of accepting any installed version", () => {
    const install = steps.slice(
      steps.indexOf("      - name: Install compatibility OpenClaw\n"),
      steps.indexOf("      - name: Verify plugin install and update commands\n"),
    );

    expect(install).toContain('if [[ "$OPENCLAW_SPEC" != "beta" && "$installed_version" != "$OPENCLAW_SPEC" ]]; then');
    expect(install).toContain("exit 1");
    expect(install).toContain(`echo "installed_version=\${installed_version}" >> "$GITHUB_OUTPUT"`);
    expect(install).toContain("npm install --no-save --package-lock=false --ignore-scripts");
  });

  it("rebuilds the full target SDK runtime before the unmocked compatibility smoke", () => {
    const installIndex = steps.indexOf("      - name: Install compatibility OpenClaw\n");
    const buildIndex = steps.indexOf("      - name: Typecheck and build compatibility runtime\n");
    const smokeIndex = steps.indexOf("      - name: Smoke test compatibility runtime\n");

    expect(installIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(installIndex);
    expect(smokeIndex).toBeGreaterThan(buildIndex);
    const build = steps.slice(buildIndex, smokeIndex);
    expect(build).toContain("if: matrix.validation == 'compatibility'");
    expect(build).toContain("run: npm run typecheck && npm run build");
    expect(steps.slice(smokeIndex)).toContain("run: node scripts/check-host-compatibility.mjs");
    expect(steps).not.toContain("channel-message-only");
    expect(steps).not.toContain(".host-compat-dist");
    expect(steps).not.toContain("OPENCLAW_CHANGED_MODULE");
  });
});
