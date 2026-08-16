import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CANONICAL_ID = "openclaw-weixin";
const COMPATIBILITY_ALIAS = "openclaw-wechat";
const UNRELATED_ID = "openclaw-unrelated";
const CHANNEL_ALIAS_MIN_VERSION = [2026, 7, 1];

export function hostSupportsChannelAliases(hostVersion) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(hostVersion.trim());
  if (!match) {
    throw new Error(`cannot compare invalid OpenClaw version ${JSON.stringify(hostVersion)}`);
  }
  const version = match.slice(1).map(Number);
  for (let index = 0; index < CHANNEL_ALIAS_MIN_VERSION.length; index += 1) {
    if (version[index] > CHANNEL_ALIAS_MIN_VERSION[index]) return true;
    if (version[index] < CHANNEL_ALIAS_MIN_VERSION[index]) return false;
  }
  return true;
}

function runOpenClaw(rootDirectory, args, env) {
  const result = spawnSync(
    process.execPath,
    [path.join(rootDirectory, "node_modules", "openclaw", "openclaw.mjs"), ...args],
    {
      cwd: rootDirectory,
      encoding: "utf8",
      env,
      timeout: 180_000,
    },
  );
  if (result.error) {
    throw new Error(`OpenClaw ${args.join(" ")} failed to start: ${result.error.message}`);
  }
  return result;
}

function readSuccessfulJson(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim() || result.stdout.trim() || result.status}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertUnknownChannel(result, channelId) {
  if (result.status === 0 || !`${result.stderr}\n${result.stdout}`.includes(`Unknown channel "${channelId}"`)) {
    throw new Error(`channel id ${channelId} unexpectedly resolved`);
  }
}

function assertConfigSchema(configSchema, label) {
  const parsed = configSchema?.runtime?.safeParse({
    botAgent: "CompatibilityBot/1.0",
    routeTag: "route-test",
    accounts: {
      "account-1": {},
    },
  });
  if (
    !parsed?.success ||
    parsed.data?.botAgent !== "CompatibilityBot/1.0" ||
    parsed.data?.routeTag !== "route-test" ||
    parsed.data?.replyProgressMessages !== true
  ) {
    throw new Error(`${label} config schema did not preserve values and defaults`);
  }
  if (configSchema?.runtime?.safeParse({ botAgent: 42 })?.success !== false) {
    throw new Error(`${label} config schema accepted an invalid botAgent`);
  }
}

async function checkHostChannelAliasResolution(rootDirectory, hostVersion) {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "openclaw-weixin-compat-"));
  const configPath = path.join(stateDirectory, "openclaw.json");
  const env = {
    ...process.env,
    CI: "1",
    NO_COLOR: "1",
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_HOME: stateDirectory,
    OPENCLAW_STATE_DIR: stateDirectory,
  };

  try {
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          plugins: {
            entries: { [CANONICAL_ID]: { enabled: true } },
            load: { paths: [rootDirectory] },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const canonicalCapabilities = readSuccessfulJson(
      runOpenClaw(rootDirectory, ["channels", "capabilities", "--channel", CANONICAL_ID, "--json"], env),
      `channel id check for ${CANONICAL_ID}`,
    );
    if (canonicalCapabilities.channels?.length !== 1 || canonicalCapabilities.channels[0]?.channel !== CANONICAL_ID) {
      throw new Error(`channel id ${CANONICAL_ID} did not resolve to itself`);
    }

    const aliasResult = runOpenClaw(
      rootDirectory,
      ["channels", "capabilities", "--channel", COMPATIBILITY_ALIAS, "--json"],
      env,
    );
    if (hostSupportsChannelAliases(hostVersion)) {
      const aliasCapabilities = readSuccessfulJson(aliasResult, `channel id check for ${COMPATIBILITY_ALIAS}`);
      if (aliasCapabilities.channels?.length !== 1 || aliasCapabilities.channels[0]?.channel !== CANONICAL_ID) {
        throw new Error(`channel id ${COMPATIBILITY_ALIAS} did not resolve to ${CANONICAL_ID}`);
      }
    } else {
      assertUnknownChannel(aliasResult, COMPATIBILITY_ALIAS);
    }

    const unrelatedChannel = runOpenClaw(
      rootDirectory,
      ["channels", "capabilities", "--channel", UNRELATED_ID, "--json"],
      env,
    );
    assertUnknownChannel(unrelatedChannel, UNRELATED_ID);
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
}

export async function checkHostCompatibility(rootDirectory = process.cwd()) {
  const hostPackage = JSON.parse(
    await readFile(path.join(rootDirectory, "node_modules", "openclaw", "package.json"), "utf8"),
  );
  const expectedVersion = process.env.OPENCLAW_EXPECTED_VERSION?.trim();
  if (expectedVersion && hostPackage.version !== expectedVersion) {
    throw new Error(`expected OpenClaw ${expectedVersion}, found ${hostPackage.version}`);
  }

  const channelMessageExport = hostPackage.exports?.["./plugin-sdk/channel-message"];
  if (!channelMessageExport) {
    throw new Error(`OpenClaw ${hostPackage.version} does not export plugin-sdk/channel-message`);
  }
  if (
    process.env.OPENCLAW_COMPATIBILITY_PROFILE === "channel-message-only" &&
    hostPackage.exports?.["./plugin-sdk/channel-runtime"]
  ) {
    throw new Error(`OpenClaw ${hostPackage.version} still exports plugin-sdk/channel-runtime`);
  }

  const { createTypingCallbacks } = await import("openclaw/plugin-sdk/channel-message");
  if (typeof createTypingCallbacks !== "function") {
    throw new Error(`OpenClaw ${hostPackage.version} does not export createTypingCallbacks`);
  }
  const typingCallbacks = createTypingCallbacks({
    start: async () => {},
    stop: async () => {},
    onStartError: (error) => {
      throw error;
    },
    onStopError: (error) => {
      throw error;
    },
    keepaliveIntervalMs: 60_000,
  });
  if (
    typeof typingCallbacks?.onReplyStart !== "function" ||
    typeof typingCallbacks?.onIdle !== "function" ||
    typeof typingCallbacks?.onCleanup !== "function"
  ) {
    throw new Error(`OpenClaw ${hostPackage.version} returned invalid typing callbacks`);
  }
  await typingCallbacks.onReplyStart();
  typingCallbacks.onCleanup();

  const changedModule =
    process.env.OPENCLAW_CHANGED_MODULE?.trim() || path.join("dist", "src", "messaging", "process-message.js");
  await import(pathToFileURL(path.resolve(rootDirectory, changedModule)).href);
  const plugin = (await import(pathToFileURL(path.join(rootDirectory, "dist", "index.js")).href)).default;
  assertConfigSchema(plugin.configSchema, "plugin entry");
  const channels = [];
  plugin.register({
    runtime: { version: hostPackage.version },
    registerChannel(entry) {
      channels.push(entry);
    },
  });
  if (
    plugin.id !== CANONICAL_ID ||
    channels.length !== 1 ||
    channels[0]?.plugin?.id !== plugin.id ||
    channels[0]?.plugin?.meta?.aliases?.length !== 1 ||
    channels[0]?.plugin?.meta?.aliases?.[0] !== COMPATIBILITY_ALIAS
  ) {
    throw new Error("plugin registration smoke check failed");
  }
  assertConfigSchema(channels[0]?.plugin?.configSchema, "registered channel");

  if (process.env.OPENCLAW_COMPATIBILITY_PROFILE !== "channel-message-only") {
    await checkHostChannelAliasResolution(rootDirectory, hostPackage.version);
  }

  console.log(`Validated ${plugin.id} against OpenClaw ${hostPackage.version}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedPath) {
  await checkHostCompatibility();
}
