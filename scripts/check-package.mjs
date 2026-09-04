import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { checkVersionFiles } from "./check-versions.mjs";
import { assertCanonicalPackageMetadata } from "./package-variant.mjs";
import { assertSourceRegistryReadme, REGISTRY_README_FILES } from "./registry-readme.mjs";

function fail(message) {
  console.error(`Package check failed: ${message}`);
  process.exit(1);
}

try {
  checkVersionFiles();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const pluginManifest = JSON.parse(readFileSync("openclaw.plugin.json", "utf8"));
const canonicalPackageName = "openclaw-weixin";
const displayName = "WeChat";
const description = "Community-maintained WeChat (Weixin) channel plugin for OpenClaw using the iLink bot API.";
const icon = "https://openclaw-weixin.newfuture.cc/logo.svg";
const docsUrl = "https://openclaw-weixin.newfuture.cc/";
const HOST_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseHostVersion(version, label) {
  if (typeof version !== "string" || !HOST_VERSION.test(version)) {
    fail(`${label} must use a stable YYYY.M.D version, found ${JSON.stringify(version)}`);
  }
  return version.split(".").map(Number);
}

function compareHostVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

try {
  assertCanonicalPackageMetadata({ packageJson, pluginManifest });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
if (packageJson.description !== description) {
  fail(`package description must be ${JSON.stringify(description)}`);
}
if (packageJson.openclaw?.channel?.docsPath !== docsUrl) {
  fail(`openclaw.channel.docsPath must remain ${docsUrl}`);
}
for (const fileName of REGISTRY_README_FILES) {
  const markdown = readFileSync(fileName, "utf8");
  try {
    assertSourceRegistryReadme(markdown, { fileName });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
const hostRange = packageJson.peerDependencies?.openclaw;
const hostRangeMatch = typeof hostRange === "string" ? /^>=(.+)$/.exec(hostRange) : null;
if (!hostRangeMatch) {
  fail("peerDependencies.openclaw must declare a minimum host version");
}
const minimumHostVersion = parseHostVersion(hostRangeMatch[1], "peerDependencies.openclaw");
const developmentHostVersion = parseHostVersion(packageJson.devDependencies?.openclaw, "devDependencies.openclaw");
if (compareHostVersions(developmentHostVersion, minimumHostVersion) < 0) {
  fail("devDependencies.openclaw must not be older than the minimum supported host");
}
if (pluginManifest.name !== displayName) {
  fail(`openclaw.plugin.json name must remain ${displayName}`);
}
if (pluginManifest.description !== description) {
  fail("openclaw.plugin.json description must match package.json");
}
if (pluginManifest.icon !== icon) {
  fail(`openclaw.plugin.json icon must remain ${icon}`);
}
const runtimePlugin = (await import(new URL("../dist/index.js", import.meta.url))).default;
if (runtimePlugin.id !== canonicalPackageName) {
  fail(`the runtime plugin id must remain ${canonicalPackageName}`);
}
if (runtimePlugin.name !== displayName) {
  fail(`the runtime plugin name must remain ${displayName}`);
}
if (runtimePlugin.description !== description) {
  fail("the runtime plugin description must match package.json");
}
const { weixinPlugin } = await import(new URL("../dist/src/channel.js", import.meta.url));
if (weixinPlugin.meta.docsPath !== docsUrl) {
  fail(`the runtime channel docsPath must remain ${docsUrl}`);
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
  "CHANGELOG.md",
  "CHANGELOG_EN.md",
  "openclaw.plugin.json",
  "index.ts",
  "dist/index.js",
  "docs/zh-CN/distributions.md",
  "docs/en/distributions.md",
  "docs/zh-CN/architecture.md",
  "docs/en/architecture.md",
  "docs/zh-CN/guide.md",
  "docs/en/guide.md",
  "docs/zh-CN/backend-api.md",
  "docs/en/backend-api.md",
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
