import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"];

export const DEFAULT_LEVEL = "moderate";

/**
 * OpenClaw publishes an `npm-shrinkwrap.json`, so npm installs its dependency
 * tree exactly as pinned upstream: neither `overrides` nor a hand-edited
 * `package-lock.json` can move those versions. Advisories that only reach the
 * tree through `node_modules/openclaw/` are therefore reported instead of
 * failing the gate, and everything this repository can actually fix still fails
 * it.
 */
export const UPSTREAM_ROOT = "node_modules/openclaw";

export function isShrinkwrappedUpstream(advisory, { root = UPSTREAM_ROOT } = {}) {
  const nodes = Array.isArray(advisory?.nodes) ? advisory.nodes : [];
  if (nodes.length === 0) return false;
  if (!nodes.every((node) => typeof node === "string" && (node === root || node.startsWith(`${root}/`)))) {
    return false;
  }
  if (!nodes.includes(root)) return true;

  // npm also reports the host package itself once any of its shrinkwrapped
  // dependencies is vulnerable. That roll-up entry lists plain package names in
  // `via` and is not actionable here, while a real advisory against openclaw
  // carries an advisory object and is fixed by upgrading the devDependency.
  const via = Array.isArray(advisory.via) ? advisory.via : [];
  return !via.some((entry) => typeof entry === "object" && entry !== null);
}

export function partitionAdvisories(report, { level = DEFAULT_LEVEL, root = UPSTREAM_ROOT } = {}) {
  const minimum = SEVERITY_ORDER.indexOf(level);
  if (minimum < 0) {
    throw new Error(`unknown audit level ${JSON.stringify(level)}`);
  }

  const vulnerabilities = report?.vulnerabilities ?? {};
  const blocking = [];
  const upstream = [];

  for (const name of Object.keys(vulnerabilities).sort()) {
    const advisory = vulnerabilities[name] ?? {};
    const severity = advisory.severity;
    const rank = SEVERITY_ORDER.indexOf(severity);
    if (rank < minimum) continue;

    const nodes = Array.isArray(advisory.nodes) ? advisory.nodes : [];
    const entry = { name, severity, nodes };
    if (isShrinkwrappedUpstream(advisory, { root })) {
      upstream.push(entry);
    } else {
      blocking.push(entry);
    }
  }

  return { blocking, upstream };
}

function audit() {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? process.env.ComSpec : "npm";
  const npmArgs = ["audit", "--json"];
  const args = npmExecPath
    ? [npmExecPath, ...npmArgs]
    : process.platform === "win32"
      ? ["/d", "/s", "/c", `npm ${npmArgs.join(" ")}`]
      : npmArgs;

  const audited = spawnSync(command, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (audited.error) {
    throw new Error(`could not run npm audit: ${audited.error.message}`);
  }

  let report;
  try {
    report = JSON.parse(audited.stdout);
  } catch {
    if (audited.stderr) process.stderr.write(audited.stderr);
    throw new Error(`npm audit did not return valid JSON (status ${audited.status})`);
  }
  if (report.error) {
    throw new Error(`npm audit failed: ${report.error.summary ?? report.error.code}`);
  }

  return report;
}

function describe(entry) {
  return `  ${entry.severity.padEnd(8)} ${entry.name} (${entry.nodes.join(", ") || "no install path reported"})`;
}

function run() {
  try {
    const { blocking, upstream } = partitionAdvisories(audit());

    if (upstream.length > 0) {
      console.log(
        `${upstream.length} ${DEFAULT_LEVEL}+ advisories are pinned by the ${UPSTREAM_ROOT} shrinkwrap and can only be cleared by upgrading the openclaw devDependency:`,
      );
      for (const entry of upstream) console.log(describe(entry));
    }

    if (blocking.length > 0) {
      console.error(`${blocking.length} ${DEFAULT_LEVEL}+ advisories must be fixed in this repository:`);
      for (const entry of blocking) console.error(describe(entry));
      process.exitCode = 1;
      return;
    }

    console.log(`Dependency audit passed: no fixable ${DEFAULT_LEVEL}+ advisories.`);
  } catch (error) {
    console.error(`Dependency audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedUrl) {
  run();
}
