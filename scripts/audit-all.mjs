import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BUNDLED_NPM_PREFIX = "node_modules/npm/";

export function blockingAuditFindings(report) {
  const vulnerabilities = report?.vulnerabilities ?? {};
  const blocking = [];
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    const nodes = Array.isArray(vulnerability?.nodes) ? vulnerability.nodes : [];
    const outsideBundledNpm = nodes.filter(
      (node) => !String(node).replaceAll("\\", "/").startsWith(BUNDLED_NPM_PREFIX),
    );
    if (nodes.length === 0 || outsideBundledNpm.length > 0) {
      blocking.push({ name, nodes: outsideBundledNpm.length > 0 ? outsideBundledNpm : nodes });
    }
  }
  return blocking;
}

function readAuditReport() {
  const npmExec = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmExec, ["audit", "--json", "--registry", "https://registry.npmjs.org"], {
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`npm audit failed to start: ${result.error.message}`);
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const jsonStart = output.indexOf("{");
  if (jsonStart < 0) {
    throw new Error(output || "npm audit did not return JSON");
  }
  return JSON.parse(output.slice(jsonStart));
}

function main() {
  const report = readAuditReport();
  const blocking = blockingAuditFindings(report);
  if (blocking.length === 0) {
    const bundled = Object.keys(report.vulnerabilities ?? {});
    if (bundled.length > 0) {
      console.log(
        `Ignoring ${bundled.length} advisories bundled inside OpenClaw's npm dependency: ${bundled.join(", ")}`,
      );
    }
    return;
  }
  console.error("npm audit found vulnerabilities outside OpenClaw's bundled npm package:");
  for (const finding of blocking) {
    console.error(`- ${finding.name}: ${finding.nodes.join(", ") || "unknown path"}`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
