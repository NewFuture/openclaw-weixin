import {
  defineStableChannelIngressIdentity,
  type ResolvedChannelMessageIngress,
  resolveChannelMessageIngress,
} from "openclaw/plugin-sdk/channel-ingress-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import { loadWeixinAccount } from "../auth/accounts.js";
import { readFrameworkAllowFromList } from "../auth/pairing.js";

const CHANNEL_ID = "openclaw-weixin";
const LEGACY_COMMAND_AUTH_SPECIFIER = "openclaw/plugin-sdk/command-auth";
const COMMAND_DETECTION_SPECIFIER = "openclaw/plugin-sdk/command-detection";

export type WeixinCommandRuntime = {
  shouldComputeCommandAuthorized: (rawBody: string, cfg: OpenClawConfig) => boolean;
  resolveCommandAuthorizedFromAuthorizers?: (params: {
    useAccessGroups: boolean;
    authorizers: Array<{ configured: boolean; allowed: boolean }>;
  }) => boolean;
};

export type WeixinSenderAccess = {
  commandAuthorized: boolean;
  dropped: boolean;
};

type CommandDetection = {
  shouldComputeCommandAuthorized: (text: string, cfg: OpenClawConfig) => boolean;
  isControlCommandMessage: (text: string, cfg: OpenClawConfig) => boolean;
};

type CommandOwnerConfig = {
  ownerAllowFrom?: Array<string | number>;
  allowFrom?: Record<string, Array<string | number> | undefined>;
};

type LegacyCommandAuth = {
  resolveDirectDmAuthorizationOutcome: (params: {
    isGroup: boolean;
    dmPolicy: string;
    senderAllowedForCommands: boolean;
  }) => "disabled" | "unauthorized" | "allowed";
  resolveSenderCommandAuthorizationWithRuntime: (params: {
    cfg: OpenClawConfig;
    rawBody: string;
    isGroup: boolean;
    dmPolicy: string;
    configuredAllowFrom: string[];
    configuredGroupAllowFrom: string[];
    senderId: string;
    isSenderAllowed: (id: string, list: string[]) => boolean;
    readAllowFromStore: () => Promise<string[]>;
    runtime: WeixinCommandRuntime;
  }) => Promise<{ senderAllowedForCommands: boolean; commandAuthorized?: boolean }>;
};

export function isMissingSdkSubpath(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" || error.code === "ERR_MODULE_NOT_FOUND";
}

export function readWeixinAllowFromStore(accountId: string): string[] {
  const fromStore = readFrameworkAllowFromList(accountId);
  if (fromStore.length > 0) return fromStore;
  const userId = loadWeixinAccount(accountId)?.userId?.trim();
  return userId ? [userId] : [];
}

export function droppedFromLegacyOutcome(outcome: "disabled" | "unauthorized" | "allowed"): boolean {
  return outcome === "disabled" || outcome === "unauthorized";
}

export function senderAccessFromIngress(result: ResolvedChannelMessageIngress): WeixinSenderAccess {
  return {
    dropped: result.ingress.decision !== "allow",
    commandAuthorized: result.commandAccess.authorized === true,
  };
}

export function commandOwnerAllowFromForHost(config: OpenClawConfig): Array<string | number> | undefined {
  const commands = (config as { commands?: unknown }).commands;
  if (!commands || typeof commands !== "object") return undefined;
  const commandConfig = commands as CommandOwnerConfig;
  const lists: Array<Array<string | number>> = [];
  const allowFrom = commandConfig.allowFrom;
  if (allowFrom && typeof allowFrom === "object" && !Array.isArray(allowFrom)) {
    const channelList = allowFrom[CHANNEL_ID] ?? allowFrom["*"];
    if (Array.isArray(channelList)) lists.push(channelList);
  }
  if (Array.isArray(commandConfig.ownerAllowFrom) && commandConfig.ownerAllowFrom.length > 0) {
    lists.push(commandConfig.ownerAllowFrom);
  }
  if (lists.length === 0) return undefined;
  return lists.reduce((current, next) => {
    const allowed = new Set(next.map(String));
    return current.filter((entry) => allowed.has(String(entry)));
  });
}

export async function loadCommandDetection(): Promise<CommandDetection> {
  const specifier: string = COMMAND_DETECTION_SPECIFIER;
  const loaded = (await import(specifier)) as Partial<CommandDetection>;
  if (
    typeof loaded.shouldComputeCommandAuthorized !== "function" ||
    typeof loaded.isControlCommandMessage !== "function"
  ) {
    throw new Error("weixin: host command detection is missing");
  }
  return loaded as CommandDetection;
}

export async function loadLegacyCommandAuth(): Promise<LegacyCommandAuth | null> {
  try {
    const specifier: string = LEGACY_COMMAND_AUTH_SPECIFIER;
    const loaded = (await import(specifier)) as Partial<LegacyCommandAuth>;
    if (
      typeof loaded.resolveDirectDmAuthorizationOutcome !== "function" ||
      typeof loaded.resolveSenderCommandAuthorizationWithRuntime !== "function"
    ) {
      return null;
    }
    return loaded as LegacyCommandAuth;
  } catch (error) {
    if (isMissingSdkSubpath(error)) return null;
    throw error;
  }
}

type SenderAccessDeps = {
  loadLegacy?: () => Promise<LegacyCommandAuth | null>;
  loadCommandDetection?: () => Promise<CommandDetection>;
  resolveIngress?: typeof resolveChannelMessageIngress;
};

export async function resolveWeixinSenderAccess(
  params: {
    accountId: string;
    senderId: string;
    rawBody: string;
    config: OpenClawConfig;
    commands?: WeixinCommandRuntime;
    readAllowFromStore?: () => Promise<string[]>;
  },
  deps: SenderAccessDeps = {},
): Promise<WeixinSenderAccess> {
  const loadLegacy = deps.loadLegacy ?? loadLegacyCommandAuth;
  const legacy = await loadLegacy();
  const readAllowFromStore = params.readAllowFromStore ?? (async () => readWeixinAllowFromStore(params.accountId));
  if (legacy) {
    if (!params.commands) {
      throw new Error("weixin: host command runtime is missing");
    }
    const authorization = await legacy.resolveSenderCommandAuthorizationWithRuntime({
      cfg: params.config,
      rawBody: params.rawBody,
      isGroup: false,
      dmPolicy: "pairing",
      configuredAllowFrom: [],
      configuredGroupAllowFrom: [],
      senderId: params.senderId,
      isSenderAllowed: (id, list) => list.length === 0 || list.includes(id),
      readAllowFromStore,
      runtime: params.commands,
    });
    return {
      dropped: droppedFromLegacyOutcome(
        legacy.resolveDirectDmAuthorizationOutcome({
          isGroup: false,
          dmPolicy: "pairing",
          senderAllowedForCommands: authorization.senderAllowedForCommands,
        }),
      ),
      commandAuthorized: authorization.commandAuthorized === true,
    };
  }

  const resolveIngress = deps.resolveIngress ?? resolveChannelMessageIngress;
  const loadDetection = deps.loadCommandDetection ?? loadCommandDetection;
  const detection = await loadDetection();
  const storeAllowFrom = await readAllowFromStore();
  const commandOwners = commandOwnerAllowFromForHost(params.config);
  const mayAuthorizeCommand = detection.shouldComputeCommandAuthorized(params.rawBody, params.config);
  const result = await resolveIngress({
    channelId: CHANNEL_ID,
    accountId: params.accountId,
    identity: defineStableChannelIngressIdentity({ key: "weixin-user-id", kind: "stable-id" }),
    subject: { stableId: params.senderId },
    conversation: { kind: "direct", id: params.senderId },
    event: { kind: "message", authMode: "inbound", mayPair: true },
    policy: { dmPolicy: "pairing", groupPolicy: "allowlist" },
    // Legacy command-auth treated an empty pairing store as allowed. Keep that
    // admission for token-only accounts that have no saved user id.
    allowFrom: storeAllowFrom.length === 0 ? [params.senderId] : [],
    readStoreAllowFrom: async () => storeAllowFrom,
    ...(mayAuthorizeCommand
      ? {
          command: {
            allowTextCommands: true,
            hasControlCommand: detection.isControlCommandMessage(params.rawBody, params.config),
            ...(commandOwners ? { commandOwnerAllowFrom: commandOwners } : {}),
          },
        }
      : {}),
  });
  return senderAccessFromIngress(result);
}
