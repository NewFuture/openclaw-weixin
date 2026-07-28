import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

const canonicalPackageName = "@newfuture/openclaw-wechat";
const mirrorPackageName = "openclaw-weixin";
const pluginId = "openclaw-weixin";
const sourceRoot = process.cwd();
const outputRoot = resolve(process.argv[2] ?? ".release/openclaw-weixin");

function fail(message) {
  console.error(`Mirror package preparation failed: ${message}`);
  process.exit(1);
}

if (outputRoot === sourceRoot || outputRoot === parse(outputRoot).root) {
  fail("refusing to replace the source or filesystem root directory");
}

const packageJson = JSON.parse(readFileSync(resolve(sourceRoot, "package.json"), "utf8"));
const pluginManifest = JSON.parse(readFileSync(resolve(sourceRoot, "openclaw.plugin.json"), "utf8"));

if (packageJson.name !== canonicalPackageName) {
  fail(`expected source package ${canonicalPackageName}, found ${packageJson.name}`);
}
if (pluginManifest.id !== pluginId) {
  fail(`expected plugin id ${pluginId}, found ${pluginManifest.id}`);
}
if (!Array.isArray(packageJson.files)) {
  fail("package.json files must be an array");
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

for (const entry of packageJson.files) {
  const relativePath = entry.replace(/\/$/, "");
  const sourcePath = resolve(sourceRoot, relativePath);
  const outputPath = resolve(outputRoot, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  cpSync(sourcePath, outputPath, { recursive: true });
}

const mirrorPackageJson = structuredClone(packageJson);
mirrorPackageJson.name = mirrorPackageName;
mirrorPackageJson.openclaw.install.npmSpec = mirrorPackageName;
writeFileSync(resolve(outputRoot, "package.json"), `${JSON.stringify(mirrorPackageJson, null, 2)}\n`);

console.log(`Prepared ${mirrorPackageName}@${packageJson.version} in ${outputRoot}`);
