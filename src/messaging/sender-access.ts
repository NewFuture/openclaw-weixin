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
  const result = await resolveIngress({
    channelId: CHANNEL_ID,
    accountId: params.accountId,
    identity: defineStableChannelIngressIdentity({ key: "weixin-user-id", kind: "stable-id" }),
    subject: { stableId: params.senderId },
    conversation: { kind: "direct", id: params.senderId },
    event: { kind: "message", authMode: "inbound", mayPair: true },
    policy: { dmPolicy: "pairing", groupPolicy: "allowlist" },
    allowFrom: [],
    readStoreAllowFrom: async () => readAllowFromStore(),
    ...(params.rawBody.startsWith("/") ? { command: { allowTextCommands: true, hasControlCommand: true } } : {}),
  });
  return senderAccessFromIngress(result);
}
