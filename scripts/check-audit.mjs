import { spawnSync } from "node:child_process";

const LEVEL = "moderate";
const BLOCKING = ["moderate", "high", "critical"];

// OpenClaw ships an npm-shrinkwrap.json, so npm resolves everything under
// node_modules/openclaw/ from that file. Root overrides and lockfile edits
// cannot move those versions; they only change what npm audit reads. Report
// such advisories and clear them by upgrading the openclaw devDependency.
const UPSTREAM = "node_modules/openclaw";

const audited = spawnSync("npm", ["audit", "--json", `--audit-level=${LEVEL}`], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
  shell: process.platform === "win32",
});

let report;
try {
  report = JSON.parse(audited.stdout);
} catch {
  if (audited.stderr) process.stderr.write(audited.stderr);
  console.error(`Dependency audit failed: npm audit did not return JSON (status ${audited.status})`);
  process.exit(1);
}

const blocking = [];
const upstream = [];
for (const [name, advisory] of Object.entries(report.vulnerabilities ?? {})) {
  if (!BLOCKING.includes(advisory.severity)) continue;
  const nodes = advisory.nodes ?? [];
  const pinnedUpstream =
    nodes.length > 0 && nodes.every((node) => node === UPSTREAM || node.startsWith(`${UPSTREAM}/`));
  (pinnedUpstream ? upstream : blocking).push(`  ${advisory.severity.padEnd(8)} ${name}`);
}

if (upstream.length > 0) {
  console.log(`${upstream.length} ${LEVEL}+ advisories are pinned by the ${UPSTREAM} shrinkwrap:`);
  for (const line of upstream.sort()) console.log(line);
  console.log("Upgrade the openclaw devDependency to clear them.");
}

if (blocking.length > 0) {
  console.error(`${blocking.length} ${LEVEL}+ advisories must be fixed in this repository:`);
  for (const line of blocking.sort()) console.error(line);
  process.exit(1);
}

console.log(`Dependency audit passed: no fixable ${LEVEL}+ advisories.`);
