import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function fail(message) {
  console.error(`Package check failed: ${message}`);
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const pluginManifest = JSON.parse(readFileSync("openclaw.plugin.json", "utf8"));

if (packageJson.name !== "openclaw-weixin") {
  fail(`expected package name openclaw-weixin, found ${packageJson.name}`);
}
if (packageJson.openclaw?.install?.npmSpec !== packageJson.name) {
  fail("openclaw.install.npmSpec must match the npm package name");
}
const expectedHostRange = `>=${packageJson.devDependencies?.openclaw}`;
if (packageJson.peerDependencies?.openclaw !== expectedHostRange) {
  fail("peerDependencies.openclaw must match the tested development version");
}
if (packageJson.openclaw?.install?.minHostVersion !== expectedHostRange) {
  fail("openclaw.install.minHostVersion must match the tested development version");
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

const npmExecPath = process.env.npm_execpath;
const command = npmExecPath ? process.execPath : process.platform === "win32" ? process.env.ComSpec : "npm";

function pack() {
  const npmArgs = ["pack", "--dry-run", "--json", "--ignore-scripts"];
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

  try {
    return JSON.parse(packed.stdout)[0];
  } catch {
    fail("npm pack did not return valid JSON");
  }
}

function packageFiles(report) {
  return new Set(report?.files?.map((file) => file.path.replaceAll("\\", "/")) ?? []);
}

const report = pack();
const files = packageFiles(report);
for (const required of [
  "package.json",
  "LICENSE",
  "NOTICE",
  "README.md",
  "README_EN.md",
  "README.zh_CN.md",
  "openclaw.plugin.json",
  "index.ts",
  "dist/index.js",
  "docs/architecture.md",
  "docs/guide.md",
  "docs/guide.zh_CN.md",
  "docs/backend-api.md",
  "docs/backend-api.zh_CN.md",
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

console.log(`Package check passed: ${report.name}@${report.version}, ${files.size} files`);
