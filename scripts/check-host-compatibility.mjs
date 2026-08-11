import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  const channels = [];
  plugin.register({
    runtime: { version: hostPackage.version },
    registerChannel(entry) {
      channels.push(entry);
    },
  });
  if (
    plugin.id !== "openclaw-weixin" ||
    channels.length !== 1 ||
    channels[0]?.plugin?.id !== plugin.id ||
    channels[0]?.plugin?.meta?.aliases?.length !== 1 ||
    channels[0]?.plugin?.meta?.aliases?.[0] !== "openclaw-wechat"
  ) {
    throw new Error("plugin registration smoke check failed");
  }

  console.log(`Validated ${plugin.id} against OpenClaw ${hostPackage.version}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedPath) {
  await checkHostCompatibility();
}
