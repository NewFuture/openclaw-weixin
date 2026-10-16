import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  formatCheckFailure,
  isolatedEnvironment,
  PluginLifecycleCheckFailure,
} from "./check-plugin-install-update.mjs";

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
    parsed.data?.blockStreaming !== true ||
    parsed.data?.accounts?.["account-1"]?.blockStreaming !== undefined ||
    parsed.data?.replyProgressMessages !== true
  ) {
    throw new Error(`${label} config schema did not preserve values and defaults`);
  }
  const disabled = configSchema?.runtime?.safeParse({
    blockStreaming: false,
    accounts: {
      "account-1": { blockStreaming: true },
    },
  });
  if (
    !disabled?.success ||
    disabled.data?.blockStreaming !== false ||
    disabled.data?.accounts?.["account-1"]?.blockStreaming !== true
  ) {
    throw new Error(`${label} config schema did not preserve block streaming overrides`);
  }
  if (configSchema?.runtime?.safeParse({ botAgent: 42 })?.success !== false) {
    throw new Error(`${label} config schema accepted an invalid botAgent`);
  }
  if (configSchema?.runtime?.safeParse({ blockStreaming: "yes" })?.success !== false) {
    throw new Error(`${label} config schema accepted an invalid blockStreaming value`);
  }
}

export function assertReloadConfigPreserved(persisted, source) {
  const timestamp = persisted.channels?.[CANONICAL_ID]?.channelConfigUpdatedAt;
  if (
    typeof timestamp !== "string" ||
    Number.isNaN(Date.parse(timestamp)) ||
    timestamp === source.channels?.[CANONICAL_ID]?.channelConfigUpdatedAt
  ) {
    throw new PluginLifecycleCheckFailure("config mutation did not update the channel timestamp");
  }
  const actual = structuredClone(persisted);
  const expected = structuredClone(source);
  // The host stamps write metadata independently of the channel mutation.
  delete actual.meta;
  delete expected.meta;
  delete actual.channels[CANONICAL_ID].channelConfigUpdatedAt;
  delete expected.channels[CANONICAL_ID].channelConfigUpdatedAt;
  if (!isDeepStrictEqual(actual, expected)) {
    throw new PluginLifecycleCheckFailure("config mutation changed unrelated source configuration");
  }
}

export function assertConfigMutationResultPreserved(result, persisted, source) {
  if (
    !isDeepStrictEqual(result.afterWrite, { mode: "auto" }) ||
    !isDeepStrictEqual(result.followUp, { mode: "auto", requiresRestart: false })
  ) {
    throw new PluginLifecycleCheckFailure("host did not retain automatic config follow-up intent");
  }
  assertReloadConfigPreserved(persisted, source);
}

async function exerciseConfigMutation(rootDirectory) {
  const { mutateConfigFile, readConfigFileSnapshotForWrite } = await import("openclaw/plugin-sdk/config-mutation");
  const { setRuntimeConfigSnapshot, clearRuntimeConfigSnapshot } = await import(
    "openclaw/plugin-sdk/runtime-config-snapshot"
  );
  const { triggerWeixinChannelReload } = await import(
    pathToFileURL(path.join(rootDirectory, "dist", "src", "auth", "accounts.js")).href
  );
  if (typeof mutateConfigFile !== "function") {
    throw new PluginLifecycleCheckFailure("host does not expose the config mutation function");
  }
  const configPath = process.env.OPENCLAW_CONFIG_PATH;
  const initial = JSON.parse(await readFile(configPath, "utf8"));
  const { snapshot } = await readConfigFileSnapshotForWrite();
  if (!snapshot.valid) {
    throw new PluginLifecycleCheckFailure("config mutation fixture did not pass host validation");
  }

  setRuntimeConfigSnapshot(snapshot.runtimeConfig, snapshot.sourceConfig);
  try {
    const currentSource = structuredClone(initial);
    currentSource.gateway.port = 19001;
    delete currentSource.logging;
    currentSource.channels[CANONICAL_ID].botAgent = "SourceBot/2.0";
    currentSource.channels[CANONICAL_ID].replyProgressMessages = false;
    currentSource.channels[CANONICAL_ID].accounts["account-1"].enabled = false;
    currentSource.channels[CANONICAL_ID].accounts["account-2"] = { enabled: false };
    await writeFile(configPath, `${JSON.stringify(currentSource, null, 2)}\n`, "utf8");

    await triggerWeixinChannelReload();
    const persisted = JSON.parse(await readFile(configPath, "utf8"));
    assertReloadConfigPreserved(persisted, currentSource);

    const result = await mutateConfigFile({
      base: "source",
      afterWrite: { mode: "auto" },
      mutate(draft) {
        draft.channels[CANONICAL_ID].channelConfigUpdatedAt = "2001-01-01T00:00:00.000Z";
      },
    });
    assertConfigMutationResultPreserved(result, JSON.parse(await readFile(configPath, "utf8")), persisted);
  } finally {
    clearRuntimeConfigSnapshot();
  }
}

async function checkHostConfigMutation(rootDirectory) {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "openclaw-weixin-config-compat-"));
  try {
    const env = isolatedEnvironment(stateDirectory);
    await writeFile(
      env.OPENCLAW_CONFIG_PATH,
      `${JSON.stringify(
        {
          gateway: { mode: "local", port: 18789 },
          logging: { level: "info" },
          plugins: {
            allow: [CANONICAL_ID],
            entries: { [CANONICAL_ID]: { enabled: true } },
            load: { paths: [rootDirectory] },
          },
          channels: {
            [CANONICAL_ID]: {
              botAgent: "SnapshotBot/1.0",
              replyProgressMessages: true,
              channelConfigUpdatedAt: "2000-01-01T00:00:00.000Z",
              accounts: { "account-1": { enabled: true, routeTag: "route-test" } },
            },
            telegram: { enabled: false },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      [path.join(rootDirectory, "scripts", "check-host-compatibility.mjs"), "--config-mutation", rootDirectory],
      { cwd: stateDirectory, env, encoding: "utf8", timeout: 180_000 },
    );
    if (result.error || result.status !== 0) {
      throw new PluginLifecycleCheckFailure("config mutation runtime check failed");
    }
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
}

export async function stageCliPluginRoot(rootDirectory, stageDirectory) {
  await cp(path.join(rootDirectory, "package.json"), path.join(stageDirectory, "package.json"));
  await cp(path.join(rootDirectory, "openclaw.plugin.json"), path.join(stageDirectory, "openclaw.plugin.json"));
  await cp(path.join(rootDirectory, "dist"), path.join(stageDirectory, "dist"), { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(rootDirectory, "package.json"), "utf8"));
  const dependencyNames = Object.keys(manifest.dependencies ?? {});
  if (dependencyNames.length === 0) return stageDirectory;
  await mkdir(path.join(stageDirectory, "node_modules"), { recursive: true });
  for (const name of dependencyNames) {
    const segments = name.split("/");
    await cp(
      path.join(rootDirectory, "node_modules", ...segments),
      path.join(stageDirectory, "node_modules", ...segments),
      {
        recursive: true,
        dereference: true,
      },
    );
  }
  return stageDirectory;
}

async function stableTempDirectory(prefix) {
  // Windows tmpdir() can be an 8.3 path. OpenClaw's fs-safe copy rejects that
  // as a path change, so stage CLI state from the native real path.
  return mkdtemp(path.join(await realpath(tmpdir()), prefix));
}

async function exerciseCliMetadata(rootDirectory) {
  // Use the installed host's loader, including its real unavailable-runtime API.
  const { loadOpenClawPluginCliRegistry } = await import(
    pathToFileURL(path.join(rootDirectory, "node_modules", "openclaw", "dist", "plugins", "loader.js")).href
  );
  const registry = await loadOpenClawPluginCliRegistry({
    config: JSON.parse(await readFile(process.env.OPENCLAW_CONFIG_PATH, "utf8")),
    onlyPluginIds: [CANONICAL_ID],
    cache: false,
  });
  const plugins = registry.plugins.filter((entry) => entry.id === CANONICAL_ID);
  if (
    plugins.length !== 1 ||
    plugins[0].status !== "loaded" ||
    registry.channels.length !== 0 ||
    registry.cliRegistrars.length !== 0 ||
    registry.diagnostics.some((entry) => entry.level === "error")
  ) {
    throw new PluginLifecycleCheckFailure("CLI metadata must load the plugin without runtime channels or commands");
  }
}

async function checkHostChannelAliasResolution(rootDirectory, hostVersion) {
  const stateDirectory = await stableTempDirectory("openclaw-weixin-compat-");
  const pluginDirectory = await stableTempDirectory("openclaw-weixin-plugin-");
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
    await stageCliPluginRoot(rootDirectory, pluginDirectory);
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          plugins: {
            entries: { [CANONICAL_ID]: { enabled: true } },
            load: { paths: [pluginDirectory] },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const metadataResult = spawnSync(
      process.execPath,
      [path.join(rootDirectory, "scripts", "check-host-compatibility.mjs"), "--cli-metadata", rootDirectory],
      { cwd: stateDirectory, env, encoding: "utf8", timeout: 180_000 },
    );
    if (metadataResult.error || metadataResult.status !== 0) {
      throw new PluginLifecycleCheckFailure("CLI metadata registration runtime check failed");
    }

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
    await rm(pluginDirectory, { recursive: true, force: true });
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

  for (const subpath of [
    "./plugin-sdk/channel-outbound",
    "./plugin-sdk/temp-path",
    "./plugin-sdk/file-lock",
    "./plugin-sdk/channel-ingress-runtime",
    "./plugin-sdk/runtime-config-snapshot",
    "./plugin-sdk/config-mutation",
  ]) {
    if (!hostPackage.exports?.[subpath]) {
      throw new Error(`OpenClaw ${hostPackage.version} does not export ${subpath}`);
    }
  }
  if (
    process.env.OPENCLAW_COMPATIBILITY_PROFILE === "channel-message-only" &&
    hostPackage.exports?.["./plugin-sdk/channel-runtime"]
  ) {
    throw new Error(`OpenClaw ${hostPackage.version} still exports plugin-sdk/channel-runtime`);
  }

  const { createTypingCallbacks } = await import("openclaw/plugin-sdk/channel-outbound");
  const { resolvePreferredOpenClawTmpDir } = await import("openclaw/plugin-sdk/temp-path");
  if (typeof resolvePreferredOpenClawTmpDir() !== "string") {
    throw new Error(`OpenClaw ${hostPackage.version} did not resolve a temp directory`);
  }
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

  const lockDirectory = await mkdtemp(path.join(tmpdir(), "openclaw-weixin-file-lock-"));
  try {
    const lockFile = path.join(lockDirectory, "allowFrom.json");
    await writeFile(lockFile, "{}\n", "utf8");
    const { withFileLock } = await import(
      pathToFileURL(path.join(rootDirectory, "dist", "src", "compat", "file-lock.js")).href
    );
    let locked = false;
    await withFileLock(
      lockFile,
      { retries: { retries: 1, factor: 1, minTimeout: 1, maxTimeout: 5 }, stale: 1_000 },
      async () => {
        locked = true;
      },
    );
    if (!locked) {
      throw new Error(`OpenClaw ${hostPackage.version} file lock did not run the callback`);
    }
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }

  const { resolveWeixinSenderAccess, loadLegacyCommandAuth } = await import(
    pathToFileURL(path.join(rootDirectory, "dist", "src", "messaging", "sender-access.js")).href
  );
  const legacyCommandAuth = await loadLegacyCommandAuth();
  const legacySubpath = hostPackage.exports?.["./plugin-sdk/command-auth"];
  if (Boolean(legacySubpath) !== Boolean(legacyCommandAuth)) {
    throw new Error(`OpenClaw ${hostPackage.version} command-auth export did not match the legacy loader`);
  }
  const { shouldComputeCommandAuthorized, isControlCommandMessage } = await import(
    "openclaw/plugin-sdk/command-detection"
  );
  const { resolveCommandAuthorizedFromAuthorizers } = await import("openclaw/plugin-sdk/command-auth-native");
  const accessParams = {
    accountId: "account-test",
    config: {},
    commands: {
      shouldComputeCommandAuthorized,
      isControlCommandMessage,
      resolveCommandAuthorizedFromAuthorizers,
    },
    readAllowFromStore: async () => ["user-allowed"],
  };
  const cases = [
    [
      "allowlisted ordinary text",
      { senderId: "user-allowed", rawBody: "hello" },
      { dropped: false, commandAuthorized: false },
    ],
    [
      "allowlisted control command",
      { senderId: "user-allowed", rawBody: "/help" },
      { dropped: false, commandAuthorized: true },
    ],
    [
      "allowlisted inline command",
      { senderId: "user-allowed", rawBody: "hello /status" },
      { dropped: false, commandAuthorized: true },
    ],
    [
      "allowlisted abort trigger",
      { senderId: "user-allowed", rawBody: "stop" },
      { dropped: false, commandAuthorized: true },
    ],
    [
      "unlisted control command",
      { senderId: "user-blocked", rawBody: "/help" },
      { dropped: true, commandAuthorized: false },
    ],
  ];
  for (const [label, input, expected] of cases) {
    const actual = await resolveWeixinSenderAccess({ ...accessParams, ...input });
    if (!isDeepStrictEqual(actual, expected)) {
      throw new Error(
        `OpenClaw ${hostPackage.version} ${label} returned ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
      );
    }
  }
  const emptyStore = await resolveWeixinSenderAccess({
    ...accessParams,
    senderId: "user-token-only",
    rawBody: "hello",
    readAllowFromStore: async () => [],
  });
  if (emptyStore.dropped || emptyStore.commandAuthorized) {
    throw new Error(
      `OpenClaw ${hostPackage.version} empty pairing store ordinary text returned ${JSON.stringify(emptyStore)}`,
    );
  }
  const emptyStoreCommand = await resolveWeixinSenderAccess({
    ...accessParams,
    senderId: "user-token-only",
    rawBody: "/help",
    readAllowFromStore: async () => [],
  });
  const emptyStoreRestricted = await resolveWeixinSenderAccess({
    ...accessParams,
    senderId: "user-token-only",
    rawBody: "/help",
    config: { commands: { ownerAllowFrom: ["user-owner"] } },
    readAllowFromStore: async () => [],
  });
  if (legacyCommandAuth) {
    // Legacy command-auth admits an empty store but does not treat that as a configured
    // command allowlist, and it ignores commands.ownerAllowFrom.
    if (
      emptyStoreCommand.dropped ||
      emptyStoreCommand.commandAuthorized ||
      !isDeepStrictEqual(emptyStoreRestricted, emptyStoreCommand)
    ) {
      throw new Error(
        `OpenClaw ${hostPackage.version} legacy empty-store command authorization returned ${JSON.stringify({ emptyStoreCommand, emptyStoreRestricted })}`,
      );
    }
  } else if (
    !isDeepStrictEqual(emptyStoreCommand, { dropped: false, commandAuthorized: true }) ||
    !isDeepStrictEqual(emptyStoreRestricted, { dropped: true, commandAuthorized: false })
  ) {
    throw new Error(
      `OpenClaw ${hostPackage.version} ingress empty-store command authorization returned ${JSON.stringify({ emptyStoreCommand, emptyStoreRestricted })}`,
    );
  }
  if (!legacyCommandAuth) {
    const restricted = await resolveWeixinSenderAccess({
      ...accessParams,
      senderId: "user-allowed",
      rawBody: "/help",
      config: { commands: { ownerAllowFrom: ["user-owner"] } },
    });
    if (!restricted.dropped || restricted.commandAuthorized) {
      throw new Error(
        `OpenClaw ${hostPackage.version} did not deny a control command excluded by commands.ownerAllowFrom`,
      );
    }
  }

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
  await checkHostConfigMutation(rootDirectory);

  if (process.env.OPENCLAW_COMPATIBILITY_PROFILE !== "channel-message-only") {
    await checkHostChannelAliasResolution(rootDirectory, hostPackage.version);
  }

  console.log(`Validated ${plugin.id} against OpenClaw ${hostPackage.version}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedPath) {
  if (process.argv[2] === "--cli-metadata") {
    try {
      await exerciseCliMetadata(process.argv[3]);
    } catch (error) {
      console.error(formatCheckFailure(error));
      process.exitCode = 1;
    }
  } else if (process.argv[2] === "--config-mutation") {
    try {
      await exerciseConfigMutation(process.argv[3]);
    } catch (error) {
      console.error(formatCheckFailure(error));
      process.exitCode = 1;
    }
  } else {
    await checkHostCompatibility();
  }
}
