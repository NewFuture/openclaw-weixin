import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function fail(message) {
  console.error(`Package check failed: ${message}`);
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const pluginManifest = JSON.parse(readFileSync("openclaw.plugin.json", "utf8"));

if (packageJson.name !== "openclaw-wechat") {
  fail(`expected package name openclaw-wechat, found ${packageJson.name}`);
}
if (packageJson.openclaw?.install?.npmSpec !== packageJson.name) {
  fail("openclaw.install.npmSpec must match the npm package name");
}
if (pluginManifest.id !== "openclaw-weixin") {
  fail("the compatibility plugin id must remain openclaw-weixin");
}
if (
  !Array.isArray(pluginManifest.channels) ||
  pluginManifest.channels.length !== 1 ||
  pluginManifest.channels[0] !== "openclaw-weixin"
) {
  fail("the compatibility channel id must remain openclaw-weixin");
}
if (pluginManifest.version !== packageJson.version) {
  fail("package.json and openclaw.plugin.json versions must match");
}

const npmArgs = ["pack", "--dry-run", "--json", "--ignore-scripts"];
const npmExecPath = process.env.npm_execpath;
const command = npmExecPath
  ? process.execPath
  : process.platform === "win32"
    ? process.env.ComSpec
    : "npm";
const args = npmExecPath
  ? [npmExecPath, ...npmArgs]
  : process.platform === "win32"
    ? ["/d", "/s", "/c", `npm ${npmArgs.join(" ")}`]
    : npmArgs;
const packed = spawnSync(command, args, { encoding: "utf8" });
if (packed.error) {
  fail(`could not run npm pack: ${packed.error.message}`);
}
if (packed.status !== 0) {
  if (packed.stderr) process.stderr.write(packed.stderr);
  fail(`npm pack exited with status ${packed.status}`);
}

let report;
try {
  report = JSON.parse(packed.stdout);
} catch {
  fail("npm pack did not return valid JSON");
}

const files = new Set(report[0]?.files?.map((file) => file.path.replaceAll("\\", "/")) ?? []);
for (const required of [
  "package.json",
  "LICENSE",
  "README.md",
  "openclaw.plugin.json",
  "index.ts",
  "dist/index.js",
]) {
  if (!files.has(required)) {
    fail(`missing required file ${required}`);
  }
}

for (const file of files) {
  if (
    file.startsWith("src/") ||
    file.includes("/node_modules/") ||
    /(^|\/)\.env(?:\.|$)/.test(file) ||
    /(?:^|\/).+\.test\.[cm]?[jt]s$/.test(file) ||
    (file.endsWith(".ts") && file !== "index.ts") ||
    /\.(?:key|pem|p12|pfx)$/.test(file)
  ) {
    fail(`unexpected source, dependency, test, or secret-like file ${file}`);
  }
}

console.log(`Package check passed: ${report[0].name}@${report[0].version}, ${files.size} files`);
