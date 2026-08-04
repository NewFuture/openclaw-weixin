import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// OpenClaw ships its own npm-shrinkwrap.json, so root overrides cannot move any
// dependency pinned beneath node_modules/openclaw. Those advisories are only
// fixable by upgrading the openclaw devDependency, so they are reported instead
// of failing the gate.
const SUPPRESSED_PREFIX = "node_modules/openclaw/";
const FAILING_SEVERITIES = new Set(["moderate", "high", "critical"]);

function isSuppressedNode(node) {
  return node === "node_modules/openclaw" || node.startsWith(SUPPRESSED_PREFIX);
}

export function classifyAuditReport(report) {
  const blocking = [];
  const suppressed = [];
  const vulnerabilities = report?.vulnerabilities ?? {};

  for (const name of Object.keys(vulnerabilities).sort()) {
    const vulnerability = vulnerabilities[name] ?? {};
    const severity = vulnerability.severity;
    if (!FAILING_SEVERITIES.has(severity)) continue;

    const nodes = Array.isArray(vulnerability.nodes) ? vulnerability.nodes : [];
    const finding = { name, nodes, severity };
    if (nodes.length > 0 && nodes.every(isSuppressedNode)) {
      suppressed.push(finding);
      continue;
    }
    blocking.push(finding);
  }

  return { blocking, suppressed };
}

export function formatFinding({ name, nodes, severity }) {
  return `${severity}: ${name} (${nodes.join(", ") || "unknown path"})`;
}

function runAudit(rootDirectory) {
  const result = spawnSync("npm", ["audit", "--json"], {
    cwd: rootDirectory,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });

  if (result.error) throw result.error;
  const stdout = result.stdout ?? "";
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`npm audit did not return JSON: ${(result.stderr || stdout).trim()}`);
  }
}

function run(rootDirectory = process.cwd()) {
  try {
    const { blocking, suppressed } = classifyAuditReport(runAudit(rootDirectory));

    for (const finding of suppressed) {
      console.log(`Dependency audit ignored openclaw-pinned advisory: ${formatFinding(finding)}`);
    }

    if (blocking.length > 0) {
      console.error("Dependency audit failed for moderate or higher advisories:");
      for (const finding of blocking) {
        console.error(`  ${formatFinding(finding)}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(
      `Dependency audit passed: no moderate or higher advisories outside node_modules/openclaw (${suppressed.length} ignored)`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Dependency audit failed: ${message}`);
    process.exitCode = 1;
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedUrl) {
  run();
}
