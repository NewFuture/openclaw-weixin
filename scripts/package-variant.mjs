import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const CANONICAL_PACKAGE_NAME = "openclaw-weixin";
export const CANONICAL_PLUGIN_ID = "openclaw-weixin";
export const COMPATIBILITY_ALIAS = "openclaw-wechat";
export const CANONICAL_REPOSITORY_URL = "git+https://github.com/NewFuture/openclaw-weixin.git";
export const SOURCE_EXTENSION = "./index.ts";
export const RUNTIME_EXTENSION = "./dist/index.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasExactItems(value, expected) {
  return (
    Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index])
  );
}

export async function readPackageMetadata(packageDirectory) {
  const [packageJson, pluginManifest, sourceEntry, runtimeEntry] = await Promise.all([
    readFile(path.join(packageDirectory, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(packageDirectory, "openclaw.plugin.json"), "utf8").then(JSON.parse),
    stat(path.join(packageDirectory, SOURCE_EXTENSION)),
    stat(path.join(packageDirectory, RUNTIME_EXTENSION)),
  ]);
  assert(sourceEntry.isFile(), `${SOURCE_EXTENSION} must be a file in the canonical package`);
  assert(runtimeEntry.isFile(), `${RUNTIME_EXTENSION} must be a file in the canonical package`);
  return { packageJson, pluginManifest };
}

export function assertCanonicalPackageManifest(packageJson) {
  assert(
    packageJson.name === CANONICAL_PACKAGE_NAME,
    `expected canonical package name ${CANONICAL_PACKAGE_NAME}, found ${JSON.stringify(packageJson.name)}`,
  );
  assert(
    packageJson.openclaw?.install?.npmSpec === CANONICAL_PACKAGE_NAME,
    "canonical openclaw.install.npmSpec must match the npmjs package name",
  );
  assert(
    packageJson.repository?.url === CANONICAL_REPOSITORY_URL,
    `canonical package repository must remain ${CANONICAL_REPOSITORY_URL}`,
  );
}

export function assertCanonicalPackageMetadata({ packageJson, pluginManifest }) {
  assertCanonicalPackageManifest(packageJson);
  assert(
    packageJson.openclaw?.install?.defaultChoice === "npm",
    "the canonical package openclaw.install.defaultChoice must be npm",
  );
  assert(
    packageJson.openclaw?.install?.clawhubSpec === undefined,
    "the canonical package must not declare openclaw.install.clawhubSpec",
  );
  assert(
    hasExactItems(packageJson.openclaw?.extensions, [SOURCE_EXTENSION]),
    `openclaw.extensions must contain only ${SOURCE_EXTENSION}`,
  );
  assert(
    hasExactItems(packageJson.openclaw?.runtimeExtensions, [RUNTIME_EXTENSION]),
    `openclaw.runtimeExtensions must contain only ${RUNTIME_EXTENSION}`,
  );
  assert(
    packageJson.openclaw?.channel?.id === CANONICAL_PLUGIN_ID,
    `openclaw.channel.id must remain ${CANONICAL_PLUGIN_ID}`,
  );
  assert(
    hasExactItems(packageJson.openclaw?.channel?.aliases, [COMPATIBILITY_ALIAS]),
    `openclaw.channel.aliases must contain only ${COMPATIBILITY_ALIAS}`,
  );
  assert(
    packageJson.openclaw?.install?.minHostVersion === packageJson.peerDependencies?.openclaw,
    "openclaw.install.minHostVersion must match peerDependencies.openclaw",
  );
  assert(
    packageJson.openclaw?.compat?.pluginApi === packageJson.peerDependencies?.openclaw,
    "openclaw.compat.pluginApi must match peerDependencies.openclaw",
  );
  assert(
    packageJson.openclaw?.build?.openclawVersion === packageJson.devDependencies?.openclaw,
    "openclaw.build.openclawVersion must match devDependencies.openclaw",
  );
  assert(pluginManifest.id === CANONICAL_PLUGIN_ID, `openclaw.plugin.json id must remain ${CANONICAL_PLUGIN_ID}`);
  assert(
    hasExactItems(pluginManifest.channels, [CANONICAL_PLUGIN_ID]),
    `openclaw.plugin.json channels must contain only ${CANONICAL_PLUGIN_ID}`,
  );
  assert(pluginManifest.version === packageJson.version, "openclaw.plugin.json version must match package.json");
}

export function writePackageManifestSync(packageDirectory, packageJson) {
  writeFileSync(path.join(packageDirectory, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

export function createPackageVariantManifest(packageJson, { name, install = {} }) {
  const variant = structuredClone(packageJson);
  variant.name = name;
  Object.assign(variant.openclaw.install, install);
  return variant;
}

function resolveNpmCommand(args) {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, ...args],
    };
  }
  if (process.platform === "win32") {
    const bundledNpmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (!existsSync(bundledNpmCli)) {
      throw new Error(`could not locate the npm CLI next to Node.js: ${bundledNpmCli}`);
    }
    return { command: process.execPath, args: [bundledNpmCli, ...args] };
  }
  return { command: "npm", args };
}

export async function packPackageDirectory(packageDirectory, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const npmArgs = ["pack", "--ignore-scripts", "--json", "--pack-destination", outputDirectory];
  const invocation = resolveNpmCommand(npmArgs);
  const packed = spawnSync(invocation.command, invocation.args, {
    cwd: packageDirectory,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (packed.error) {
    throw new Error(`could not run npm pack: ${packed.error.message}`);
  }
  if (packed.status !== 0) {
    throw new Error(
      `npm pack failed: ${packed.stderr.trim() || packed.stdout.trim() || `exit status ${packed.status}`}`,
    );
  }

  let report;
  try {
    report = JSON.parse(packed.stdout);
  } catch {
    throw new Error("npm pack did not return valid JSON");
  }
  if (!Array.isArray(report) || report.length !== 1 || typeof report[0]?.filename !== "string") {
    throw new Error("npm pack did not report exactly one package archive");
  }
  return path.resolve(outputDirectory, report[0].filename);
}

export async function prepareStagedPackageVariant(packageDirectory, outputDirectory, options) {
  const metadata = await readPackageMetadata(packageDirectory);
  assertCanonicalPackageMetadata(metadata);

  const variantManifest = createPackageVariantManifest(metadata.packageJson, options);
  await writeFile(path.join(packageDirectory, "package.json"), `${JSON.stringify(variantManifest, null, 2)}\n`, "utf8");

  return packPackageDirectory(packageDirectory, outputDirectory);
}
