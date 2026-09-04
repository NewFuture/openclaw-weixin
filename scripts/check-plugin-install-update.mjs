import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLUGIN_ID = "openclaw-weixin";
const COMMAND_TIMEOUT_MS = 600_000;
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

  if (result.error) {
    throw new Error(`${label} could not start (${result.error.code ?? "unknown"})`);
  }
  if (result.signal) {
    throw new Error(`${label} did not finish before the ${COMMAND_TIMEOUT_MS / 1_000}s timeout`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} exited with status ${result.status}`);
  }
  return result.stdout;
}

function capabilityAcceptanceArgs(rootDirectory, command, env) {
  const help = runOpenClaw(rootDirectory, ["plugins", command, "--help"], env, `${command} command help`);
  return help.includes("--accept-capabilities") ? ["--accept-capabilities"] : [];
}

function includesPluginId(value) {
  if (Array.isArray(value)) return value.some(includesPluginId);
  if (value && typeof value === "object") {
    return value.id === PLUGIN_ID || Object.values(value).some(includesPluginId);
  }
  return false;
}

function assertPluginInstalled(rootDirectory, env, label) {
  const output = runOpenClaw(rootDirectory, ["plugins", "list", "--json"], env, `${label} plugin listing`);
  let installed;
  try {
    installed = JSON.parse(output);
  } catch {
    throw new Error(`${label} plugin listing did not return JSON`);
  }
  if (!includesPluginId(installed)) {
    throw new Error(`${label} did not register plugin id ${PLUGIN_ID}`);
  }
}

export async function checkPluginInstallUpdate(rootDirectory = process.cwd()) {
  const hostPackage = JSON.parse(
    await readFile(path.join(rootDirectory, "node_modules", "openclaw", "package.json"), "utf8"),
  );
  const expectedVersion = process.env.OPENCLAW_EXPECTED_VERSION?.trim();
  if (expectedVersion && hostPackage.version !== expectedVersion) {
    throw new Error(`expected OpenClaw ${expectedVersion}, found ${hostPackage.version}`);
  }

  const stateDirectory = await mkdtemp(path.join(tmpdir(), "openclaw-weixin-install-update-"));
  const env = {
    ...process.env,
    CI: "1",
    NO_COLOR: "1",
    OPENCLAW_CONFIG_PATH: path.join(stateDirectory, "openclaw.json"),
    OPENCLAW_HOME: stateDirectory,
    OPENCLAW_OAUTH_DIR: path.join(stateDirectory, "oauth"),
    OPENCLAW_STATE_DIR: stateDirectory,
  };

  try {
    const installCapabilityArgs = capabilityAcceptanceArgs(rootDirectory, "install", env);
    const updateCapabilityArgs = capabilityAcceptanceArgs(rootDirectory, "update", env);

    for (const target of INSTALL_TARGETS) {
      runOpenClaw(rootDirectory, [...target.args, ...installCapabilityArgs], env, `${target.name} install`);
      assertPluginInstalled(rootDirectory, env, `${target.name} install`);
      runOpenClaw(
        rootDirectory,
        ["plugins", "update", PLUGIN_ID, ...updateCapabilityArgs],
        env,
        `${target.name} update`,
      );
      assertPluginInstalled(rootDirectory, env, `${target.name} update`);
      console.log(`Validated ${target.name} install and update with OpenClaw ${hostPackage.version}`);
    }
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedPath) {
  await checkPluginInstallUpdate();
}
