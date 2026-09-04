import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLUGIN_ID = "openclaw-weixin";
const COMMAND_TIMEOUT_MS = 600_000;
const ISOLATED_ENVIRONMENT_VARIABLES = new Set([
  "CLAWHUB_AUTH_TOKEN",
  "CLAWHUB_CONFIG_PATH",
  "CLAWHUB_GITHUB_CODELOAD_BASE_URL",
  "CLAWHUB_TOKEN",
  "CLAWHUB_URL",
  "CLAWDHUB_AUTH_TOKEN",
  "CLAWDHUB_CONFIG_PATH",
  "CLAWDHUB_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_AUTH_TOKEN",
  "NPM_TOKEN",
]);
const INSTALL_TARGETS = [
  {
    name: "ClawHub",
    args: ["plugins", "install", "clawhub:openclaw-wechat"],
  },
  {
    name: "npm",
    args: ["plugins", "install", "npm:openclaw-weixin", "--force"],
  },
];

export class PluginLifecycleCheckFailure extends Error {}

function runOpenClaw(rootDirectory, args, env, label) {
  const result = spawnSync(
    process.execPath,
    [path.join(rootDirectory, "node_modules", "openclaw", "openclaw.mjs"), ...args],
    {
      cwd: rootDirectory,
      encoding: "utf8",
      env,
      maxBuffer: 20 * 1024 * 1024,
      timeout: COMMAND_TIMEOUT_MS,
    },
  );

  if (result.error?.code === "ETIMEDOUT") {
    throw new PluginLifecycleCheckFailure(`${label} did not finish before the ${COMMAND_TIMEOUT_MS / 1_000}s timeout`);
  }
  if (result.error) {
    throw new PluginLifecycleCheckFailure(`${label} could not start`);
  }
  if (result.signal) {
    throw new PluginLifecycleCheckFailure(`${label} exited with signal ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new PluginLifecycleCheckFailure(
      `${label} exited with status ${result.status} (${sanitizedCommandDiagnostic(result)})`,
    );
  }
  return result.stdout;
}

function sanitizedCommandDiagnostic(result) {
  const output = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (/unknown (?:option|argument|command)|missing required argument/.test(output)) {
    return "unsupported CLI argument";
  }
  if (/not installed|not tracked|not updateable/.test(output)) {
    return "missing install record";
  }
  if (/registry|network|download|fetch|resolve|econn|etimedout|enotfound/.test(output)) {
    return "registry request failure";
  }
  if (/incompatib|requires.*(?:openclaw|node)|unsupported.*(?:host|version)/.test(output)) {
    return "host compatibility failure";
  }
  return "unclassified command failure";
}

function capabilityAcceptanceArgs(rootDirectory, command, env) {
  const help = runOpenClaw(rootDirectory, ["plugins", command, "--help"], env, `${command} command help`);
  return help.includes("--accept-capabilities") ? ["--accept-capabilities"] : [];
}

function findPluginRecord(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const record = findPluginRecord(entry);
      if (record) return record;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    if (value.id === PLUGIN_ID && typeof value.status === "string") return value;
    for (const entry of Object.values(value)) {
      const record = findPluginRecord(entry);
      if (record) return record;
    }
  }
  return undefined;
}

function assertPluginInstalled(rootDirectory, env, label) {
  const output = runOpenClaw(rootDirectory, ["plugins", "list", "--json"], env, `${label} plugin listing`);
  let installed;
  try {
    installed = JSON.parse(output);
  } catch {
    throw new PluginLifecycleCheckFailure(`${label} plugin listing did not return JSON`);
  }
  const plugin = findPluginRecord(installed);
  if (!plugin) {
    throw new PluginLifecycleCheckFailure(`${label} did not register plugin id ${PLUGIN_ID}`);
  }
  if (plugin.status !== "loaded") {
    throw new PluginLifecycleCheckFailure(`${label} plugin id ${PLUGIN_ID} is not loaded`);
  }
}

export function isolatedEnvironment(stateDirectory, parentEnvironment = process.env) {
  const env = { ...parentEnvironment };
  for (const name of Object.keys(env)) {
    const normalizedName = name.toUpperCase();
    if (
      ISOLATED_ENVIRONMENT_VARIABLES.has(normalizedName) ||
      normalizedName.startsWith("NPM_CONFIG_") ||
      normalizedName.startsWith("OPENCLAW_")
    ) {
      delete env[name];
    }
  }
  return {
    ...env,
    CI: "1",
    NO_COLOR: "1",
    CLAWHUB_CONFIG_PATH: path.join(stateDirectory, "clawhub.json"),
    CLAWDHUB_CONFIG_PATH: path.join(stateDirectory, "clawhub.json"),
    OPENCLAW_CONFIG_PATH: path.join(stateDirectory, "openclaw.json"),
    OPENCLAW_HOME: stateDirectory,
    OPENCLAW_OAUTH_DIR: path.join(stateDirectory, "oauth"),
    OPENCLAW_STATE_DIR: stateDirectory,
    NPM_CONFIG_CACHE: path.join(stateDirectory, "npm-cache"),
    NPM_CONFIG_GLOBALCONFIG: path.join(stateDirectory, "npmrc-global"),
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_USERCONFIG: path.join(stateDirectory, "npmrc"),
  };
}

async function checkInstallUpdateForTarget(rootDirectory, hostVersion, target) {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "openclaw-weixin-install-update-"));
  const env = isolatedEnvironment(stateDirectory);

  try {
    const installCapabilityArgs = capabilityAcceptanceArgs(rootDirectory, "install", env);
    const updateCapabilityArgs = capabilityAcceptanceArgs(rootDirectory, "update", env);

    runOpenClaw(rootDirectory, [...target.args, ...installCapabilityArgs], env, `${target.name} install`);
    assertPluginInstalled(rootDirectory, env, `${target.name} install`);
    runOpenClaw(rootDirectory, ["plugins", "update", PLUGIN_ID, ...updateCapabilityArgs], env, `${target.name} update`);
    assertPluginInstalled(rootDirectory, env, `${target.name} update`);
    console.log(`Validated ${target.name} install and update with OpenClaw ${hostVersion}`);
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
}

export async function checkPluginInstallUpdate(rootDirectory = process.cwd()) {
  const hostPackage = JSON.parse(
    await readFile(path.join(rootDirectory, "node_modules", "openclaw", "package.json"), "utf8"),
  );
  const expectedVersion = process.env.OPENCLAW_EXPECTED_VERSION?.trim();
  if (expectedVersion && hostPackage.version !== expectedVersion) {
    throw new PluginLifecycleCheckFailure(`expected OpenClaw ${expectedVersion}, found ${hostPackage.version}`);
  }

  for (const target of INSTALL_TARGETS) {
    await checkInstallUpdateForTarget(rootDirectory, hostPackage.version, target);
  }
}

export function formatCheckFailure(error) {
  if (error instanceof PluginLifecycleCheckFailure) {
    return `Plugin lifecycle check failed: ${error.message}`;
  }
  return "Plugin lifecycle check failed: unexpected error";
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedPath) {
  try {
    await checkPluginInstallUpdate();
  } catch (error) {
    console.error(formatCheckFailure(error));
    process.exitCode = 1;
  }
}
