import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const validateJob = workflow.slice(workflow.indexOf("\n  validate:\n"), workflow.indexOf("\n  gate:\n"));
const [matrix, steps] = validateJob.split("\n    steps:\n");
const matrixRows = matrix.split("\n          - ").slice(1);

describe("OpenClaw CI compatibility matrix", () => {
  it.each([
    ["ubuntu-latest", "24.15.0", "2026.6.x", "compatibility"],
    ["ubuntu-latest", "22.22.3", "2026.7.x", "compatibility"],
    ["ubuntu-latest", "24.15.0", "2026.8.x", "compatibility"],
    ["windows-latest", "24.15.0", "2026.8.x", "compatibility"],
    ["ubuntu-latest", "24.16.0", "2026.9.x", "compatibility"],
    ["ubuntu-latest", "24.16.0", "2026.10.5", "strict"],
    ["ubuntu-latest", "26", "2026.10.x", "compatibility"],
    ["windows-latest", "24.16.0", "2026.10.5", "strict"],
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

  it("uses monthly ranges for compatibility hosts while pinning the lockfile SDK", () => {
    const versions = [...matrix.matchAll(/openclaw_version: "([^"]+)"/g)].map(([, version]) => version);

    expect([...new Set(versions)]).toEqual(["2026.6.x", "2026.7.x", "2026.8.x", "2026.9.x", "2026.10.5", "2026.10.x"]);
  });

  it("pins the development SDK, lockfile, and build metadata without raising the minimum host", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

    expect(packageJson.devDependencies.openclaw).toBe("2026.10.5");
    expect(packageJson.openclaw.build.openclawVersion).toBe("2026.10.5");
    expect(lockfile.packages[""].devDependencies.openclaw).toBe("2026.10.5");
    expect(lockfile.packages["node_modules/openclaw"].version).toBe("2026.10.5");
    expect(packageJson.peerDependencies.openclaw).toBe(">=2026.6.1");
    expect(packageJson.openclaw.install.minHostVersion).toBe(">=2026.6.1");
    expect(packageJson.engines.node).toBe(">=22.22.3");
    expect(readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim()).toBe("24.16.0");
    expect(validateJob).not.toContain("continue-on-error:");
  });

  it("installs the SDK on a supported Node.js before switching to the compatibility runtime", () => {
    const dependencySetupIndex = steps.indexOf("      - name: Set up dependency Node.js\n");
    const installIndex = steps.indexOf("      - name: Install dependencies\n");
    const hostInstallIndex = steps.indexOf("      - name: Install compatibility OpenClaw\n");
    const runtimeSetupIndex = steps.indexOf("      - name: Set up Node.js\n");
    const verifyIndex = steps.indexOf("      - name: Verify plugin install and update commands\n");

    expect(dependencySetupIndex).toBeGreaterThan(-1);
    expect(installIndex).toBeGreaterThan(dependencySetupIndex);
    expect(hostInstallIndex).toBeGreaterThan(installIndex);
    expect(runtimeSetupIndex).toBeGreaterThan(hostInstallIndex);
    expect(verifyIndex).toBeGreaterThan(runtimeSetupIndex);
    const dependencySetup = steps.slice(dependencySetupIndex, installIndex);
    expect(dependencySetup).toContain(
      `node-version: \${{ (matrix.openclaw_version == 'beta' || matrix.openclaw_version == '2026.10.x') && '24' || '24.16.0' }}`,
    );
    expect(dependencySetup).toContain(
      `check-latest: \${{ matrix.openclaw_version == 'beta' || matrix.openclaw_version == '2026.10.x' }}`,
    );
    expect(steps.slice(runtimeSetupIndex, verifyIndex)).toContain("if: matrix.validation == 'compatibility'");
  });

  it.each([
    ["copilot-setup-steps.yml", "copilot-setup-steps", "Install dependencies"],
    ["clawhub-publish.yml", "prepare", "Install dependencies"],
    ["release.yml", "validate", "Install dependencies"],
    ["release.yml", "clawhub-publish", "Validate and dry-run ClawHub publish"],
  ])("uses the development Node.js version in %s / %s before %s", (file, job, boundary) => {
    const contents = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8").replaceAll(
      "\r\n",
      "\n",
    );
    const jobIndex = contents.indexOf(`\n  ${job}:\n`);
    const boundaryIndex = contents.indexOf(`      - name: ${boundary}`, jobIndex);

    expect(jobIndex).toBeGreaterThan(-1);
    expect(boundaryIndex).toBeGreaterThan(jobIndex);
    expect(contents.slice(jobIndex, boundaryIndex)).toContain('node-version: "24.16.0"');
  });

  it("checks for the latest Node.js patch for moving host targets", () => {
    const setup = steps.slice(
      steps.indexOf("      - name: Set up Node.js\n"),
      steps.indexOf("      - name: Use lockfile-compatible npm\n"),
    );

    expect(setup).toContain(`node-version: \${{ matrix.node-version }}`);
    expect(setup).toContain(
      `check-latest: \${{ matrix.openclaw_version == 'beta' || matrix.openclaw_version == '2026.10.x' }}`,
    );
  });

  it("validates the resolved version and passes the exact result to runtime checks", () => {
    const install = steps.slice(
      steps.indexOf("      - name: Install compatibility OpenClaw\n"),
      steps.indexOf("      - name: Verify plugin install and update commands\n"),
    );

    expect(install).toContain('import { assertHostVersionSpec } from "./scripts/check-host-compatibility.mjs";');
    expect(install).toContain("assertHostVersionSpec(process.env.OPENCLAW_SPEC, process.argv[1]);");
    expect(install).toContain(`' "$installed_version"`);
    expect(install).toContain(`echo "installed_version=\${installed_version}" >> "$GITHUB_OUTPUT"`);
    expect(install).toContain("npm install --no-save --package-lock=false --ignore-scripts");
    expect(steps).toContain(
      `OPENCLAW_EXPECTED_VERSION: \${{ steps.openclaw.outputs.installed_version || matrix.openclaw_version }}`,
    );
    expect(steps).toContain(`OPENCLAW_EXPECTED_VERSION: \${{ steps.openclaw.outputs.installed_version }}`);
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
