import fs from "node:fs";
import path from "node:path";

import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import { resolveStateDir } from "../storage/state-dir.js";
import { logger } from "../util/logger.js";
import { resolveFrameworkAllowFromPath } from "./pairing.js";

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

// ---------------------------------------------------------------------------
// Account ID compatibility (legacy raw ID → normalized ID)
// ---------------------------------------------------------------------------

/**
 * Pattern-based reverse of normalizeWeixinAccountId for known weixin ID suffixes.
 * Used only as a compatibility fallback when loading accounts / sync bufs stored
 * under the old raw ID.
 * e.g. "b0f5860fdecb-im-bot" → "b0f5860fdecb@im.bot"
 */
export function deriveRawAccountId(normalizedId: string): string | undefined {
  if (normalizedId.endsWith("-im-bot")) {
    return `${normalizedId.slice(0, -7)}@im.bot`;
  }
  if (normalizedId.endsWith("-im-wechat")) {
    return `${normalizedId.slice(0, -10)}@im.wechat`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Account index (persistent list of registered account IDs)
// ---------------------------------------------------------------------------

function resolveWeixinStateDir(): string {
  return path.join(resolveStateDir(), "openclaw-weixin");
}

function resolveAccountIndexPath(): string {
  return path.join(resolveWeixinStateDir(), "accounts.json");
}

/** Returns all accountIds registered via QR login. */
export function listIndexedWeixinAccountIds(): string[] {
  const filePath = resolveAccountIndexPath();
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.trim() !== "");
  } catch {
    return [];
  }
}

/**
 * OpenClaw host sentinel passed to `auth.login` when the user omits `--account`.
 * Must never become a durable runtime / credential alias.
 */
export const HOST_DEFAULT_ACCOUNT_ID = "default";

/** Replace the persistent account index in a single write. */
function writeAccountIndex(accountIds: string[]): void {
  const dir = resolveWeixinStateDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify(accountIds, null, 2), "utf-8");
}

/** Add accountId to the persistent index (no-op if already present). */
export function registerWeixinAccountId(accountId: string): void {
  const existing = listIndexedWeixinAccountIds();
  if (existing.includes(accountId)) return;
  writeAccountIndex([...existing, accountId]);
}

/** Remove accountId from the persistent index. */
export function unregisterWeixinAccountId(accountId: string): void {
  const existing = listIndexedWeixinAccountIds();
  const updated = existing.filter((id) => id !== accountId);
  if (updated.length !== existing.length) {
    writeAccountIndex(updated);
  }
}

/**
 * Remove stale accounts that share the same userId as the newly-bound account.
 * Called after a successful QR login to ensure only the latest account remains
 * for a given WeChat user, preventing ambiguous contextToken matches.
 *
 * @param keepAccountIds canonical runtime id and optional companion credential
 *   ids that must not be deleted (e.g. bot-hash file kept for lookup while only
 *   the alias is indexed)
 * @param userId WeChat user id whose other indexed accounts should be removed
 * @param onClearContextTokens callback to clear context tokens for the removed account
 */
export function clearStaleAccountsForUserId(
  keepAccountIds: string | readonly string[],
  userId: string,
  onClearContextTokens?: (accountId: string) => void,
): void {
  if (!userId) return;
  const keep = new Set(
    (Array.isArray(keepAccountIds) ? keepAccountIds : [keepAccountIds]).map((id) => id.trim()).filter(Boolean),
  );
  if (keep.size === 0) return;
  const allIds = listIndexedWeixinAccountIds();
  for (const id of allIds) {
    if (keep.has(id)) continue;
    const data = loadWeixinAccount(id);
    if (data?.userId?.trim() === userId) {
      logger.info(`clearStaleAccountsForUserId: removing stale account=${id} (same userId=${userId})`);
      onClearContextTokens?.(id);
      clearWeixinAccount(id);
      unregisterWeixinAccountId(id);
    }
  }
}

/**
 * Resolve a stable human alias to persist alongside the primary bot id.
 * Returns null for missing input, the primary bot id itself, the OpenClaw
 * `default` host sentinel, or an ephemeral UUID session key.
 */
export function resolveLoginAccountAlias(
  requestedAccountId: string | null | undefined,
  primaryNormalizedId: string,
): string | null {
  const raw = requestedAccountId?.trim();
  if (!raw) return null;
  const alias = normalizeAccountId(raw);
  if (!alias || alias === primaryNormalizedId) return null;
  if (alias.toLowerCase() === HOST_DEFAULT_ACCOUNT_ID) return null;
  // Ephemeral login session keys must never become durable account files.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(alias)) {
    return null;
  }
  return alias;
}

export type PersistWeixinLoginAccountsResult = {
  primaryId: string;
  aliasId: string | null;
  /** Sole id registered for gateway `listAccountIds` / monitor startup. */
  canonicalId: string;
};

/**
 * Publish exactly one canonical runtime account id into the index.
 * Drops the bot-hash id from the index when an alias is canonical so OpenClaw
 * does not start two monitors for the same bot token.
 */
function publishCanonicalAccountIndex(canonicalId: string, dropFromIndex: readonly string[]): void {
  const drop = new Set(dropFromIndex.filter((id) => id && id !== canonicalId));
  const next = listIndexedWeixinAccountIds().filter((id) => id !== canonicalId && !drop.has(id));
  next.push(canonicalId);
  writeAccountIndex(next);
}

/**
 * Persist QR-login credentials under the server bot id and, when the caller
 * passed a stable `--account` alias, also under that alias (same token/userId).
 *
 * Only the canonical runtime id is indexed (`alias` when present, otherwise the
 * bot hash). The bot-hash credential file may still exist for lookup/compat, but
 * must not create a second gateway monitor.
 */
export function persistWeixinLoginAccounts(params: {
  botAccountId: string;
  token: string;
  baseUrl?: string;
  userId?: string;
  requestedAccountId?: string | null;
  onClearContextTokens?: (accountId: string) => void;
}): PersistWeixinLoginAccountsResult {
  const primaryId = normalizeAccountId(params.botAccountId);
  if (!primaryId) {
    throw new Error("weixin: bot accountId is required after login");
  }
  const creds = {
    token: params.token,
    baseUrl: params.baseUrl,
    userId: params.userId,
  };
  saveWeixinAccount(primaryId, creds);

  const aliasId = resolveLoginAccountAlias(params.requestedAccountId, primaryId);
  const canonicalId = aliasId ?? primaryId;
  if (aliasId) {
    saveWeixinAccount(aliasId, creds);
    logger.info(`persistWeixinLoginAccounts: wrote alias=${aliasId} alongside primary=${primaryId}`);
  }

  // Publish the canonical index entry before destructive stale cleanup so a
  // later failure cannot leave credentials undiscoverable after restart.
  publishCanonicalAccountIndex(canonicalId, aliasId ? [primaryId] : []);

  if (params.userId?.trim()) {
    clearStaleAccountsForUserId(
      aliasId ? [canonicalId, primaryId] : [canonicalId],
      params.userId.trim(),
      params.onClearContextTokens,
    );
  }

  return { primaryId, aliasId, canonicalId };
}

export type MigrateBoundAccountToAliasResult = PersistWeixinLoginAccountsResult;

/**
 * When QR login returns `alreadyConnected` / `binded_redirect`, migrate an
 * unambiguous hash-only binding onto a requested stable `--account` alias.
 *
 * Returns null when no alias was requested (including the host `default`
 * sentinel). Throws when multiple token-bearing indexed accounts make the
 * source binding ambiguous, or when no local credentials exist to migrate.
 */
export function migrateBoundAccountToAlias(params: {
  requestedAccountId?: string | null;
  onClearContextTokens?: (accountId: string) => void;
}): MigrateBoundAccountToAliasResult | null {
  // primary id unknown until we resolve the source credential; pass "" so only
  // sentinel / UUID / empty checks apply before we know the hash id.
  const aliasId = resolveLoginAccountAlias(params.requestedAccountId, "");
  if (!aliasId) return null;

  const indexedWithToken = listIndexedWeixinAccountIds()
    .map((id) => ({ id, data: loadWeixinAccount(id) }))
    .filter((entry): entry is { id: string; data: WeixinAccountData } => Boolean(entry.data?.token?.trim()));

  const aliasEntry = indexedWithToken.find((entry) => entry.id === aliasId);
  if (aliasEntry) {
    const aliasToken = aliasEntry.data.token?.trim() ?? "";
    const companion = (aliasToken ? findCompanionBotAccountId(aliasToken, aliasId) : null) ?? aliasId;
    return { primaryId: companion, aliasId, canonicalId: aliasId };
  }

  if (indexedWithToken.length === 0) {
    throw new Error(
      `weixin: already connected, but no local credentials are available to migrate to --account ${aliasId}. ` +
        `Clear stale state or re-login with a fresh QR (force) so a token is issued.`,
    );
  }

  if (indexedWithToken.length > 1) {
    const ids = indexedWithToken.map((entry) => entry.id).join(", ");
    throw new Error(
      `weixin: already connected, but multiple bound accounts are ambiguous (${ids}). ` +
        `Re-login with force for a single account, or remove the extra credentials before migrating to --account ${aliasId}.`,
    );
  }

  const source = indexedWithToken[0];
  const token = source.data.token?.trim();
  if (!token) {
    throw new Error(
      `weixin: already connected, but the matched account ${source.id} has no token to migrate to --account ${aliasId}.`,
    );
  }
  const creds = {
    token,
    baseUrl: source.data.baseUrl,
    userId: source.data.userId,
  };
  saveWeixinAccount(aliasId, creds);
  // Keep the source credential file for lookup; only the alias is indexed.
  if (source.id !== aliasId) {
    saveWeixinAccount(source.id, creds);
  }

  publishCanonicalAccountIndex(aliasId, source.id !== aliasId ? [source.id] : []);

  if (creds.userId?.trim()) {
    clearStaleAccountsForUserId(
      source.id === aliasId ? [aliasId] : [aliasId, source.id],
      creds.userId.trim(),
      params.onClearContextTokens,
    );
  }

  logger.info(`migrateBoundAccountToAlias: canonical=${aliasId} from source=${source.id}`);
  return { primaryId: source.id, aliasId, canonicalId: aliasId };
}

/** Best-effort companion bot-hash id sharing the same token (unindexed lookup). */
function findCompanionBotAccountId(token: string, excludeId: string): string | null {
  const dir = resolveAccountsDir();
  try {
    if (!fs.existsSync(dir)) return null;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json") || name.includes(".sync.") || name.includes(".context-tokens.")) {
        continue;
      }
      const id = name.slice(0, -".json".length);
      if (!id || id === excludeId) continue;
      const data = loadWeixinAccount(id);
      if (data?.token?.trim() === token && id.includes("-im-bot")) {
        return id;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

// ---------------------------------------------------------------------------
// Account store (per-account credential files)
// ---------------------------------------------------------------------------

/** Unified per-account data: token + baseUrl in one file. */
export type WeixinAccountData = {
  token?: string;
  savedAt?: string;
  baseUrl?: string;
  /** Last linked Weixin user id from QR login (optional). */
  userId?: string;
};

function resolveAccountsDir(): string {
  return path.join(resolveWeixinStateDir(), "accounts");
}

function resolveAccountPath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.json`);
}

/**
 * Legacy single-file token: `credentials/openclaw-weixin/credentials.json` (pre per-account files).
 */
function loadLegacyToken(): string | undefined {
  const legacyPath = path.join(resolveStateDir(), "credentials", "openclaw-weixin", "credentials.json");
  try {
    if (!fs.existsSync(legacyPath)) return undefined;
    const raw = fs.readFileSync(legacyPath, "utf-8");
    const parsed = JSON.parse(raw) as { token?: string };
    return typeof parsed.token === "string" ? parsed.token : undefined;
  } catch {
    return undefined;
  }
}

function readAccountFile(filePath: string): WeixinAccountData | null {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as WeixinAccountData;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Load account data by ID, with compatibility fallbacks. */
export function loadWeixinAccount(accountId: string): WeixinAccountData | null {
  // Primary: try given accountId (normalized IDs written after this change).
  const primary = readAccountFile(resolveAccountPath(accountId));
  if (primary) return primary;

  // Compatibility: if the given ID is normalized, derive the old raw filename
  // (e.g. "b0f5860fdecb-im-bot" → "b0f5860fdecb@im.bot") for existing installs.
  const rawId = deriveRawAccountId(accountId);
  if (rawId) {
    const compat = readAccountFile(resolveAccountPath(rawId));
    if (compat) return compat;
  }

  // Legacy fallback: read token from old single-account credentials file.
  const token = loadLegacyToken();
  if (token) return { token };

  return null;
}

/**
 * Persist account data after QR login (merges into existing file).
 * - token: overwritten when provided.
 * - baseUrl: stored when non-empty; resolveWeixinAccount falls back to DEFAULT_BASE_URL.
 * - userId: set when `update.userId` is provided; omitted from file when cleared to empty.
 */
export function saveWeixinAccount(
  accountId: string,
  update: { token?: string; baseUrl?: string; userId?: string },
): void {
  const dir = resolveAccountsDir();
  fs.mkdirSync(dir, { recursive: true });

  const existing = loadWeixinAccount(accountId) ?? {};

  const token = update.token?.trim() || existing.token;
  const baseUrl = update.baseUrl?.trim() || existing.baseUrl;
  const userId = update.userId !== undefined ? update.userId.trim() || undefined : existing.userId?.trim() || undefined;

  const data: WeixinAccountData = {
    ...(token ? { token, savedAt: new Date().toISOString() } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(userId ? { userId } : {}),
  };

  const filePath = resolveAccountPath(accountId);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

/**
 * Remove all files associated with an account:
 *   - accounts/{accountId}.json                  (credentials)
 *   - accounts/{accountId}.sync.json             (getUpdates sync buf)
 *   - accounts/{accountId}.context-tokens.json   (context tokens on disk)
 *   - credentials/openclaw-weixin-{accountId}-allowFrom.json (authorized users)
 */
export function clearWeixinAccount(accountId: string): void {
  const dir = resolveAccountsDir();
  const accountFiles = [`${accountId}.json`, `${accountId}.sync.json`, `${accountId}.context-tokens.json`];
  for (const file of accountFiles) {
    try {
      fs.unlinkSync(path.join(dir, file));
    } catch {
      // ignore if not found
    }
  }
  try {
    fs.unlinkSync(resolveFrameworkAllowFromPath(accountId));
  } catch {
    // ignore if not found
  }
}

/**
 * Resolve the openclaw.json config file path.
 * Checks OPENCLAW_CONFIG env var, then state dir.
 */
function resolveConfigPath(): string {
  const envPath = process.env.OPENCLAW_CONFIG?.trim();
  if (envPath) return envPath;
  return path.join(resolveStateDir(), "openclaw.json");
}

/**
 * Read `routeTag` from openclaw.json (for callers without an `OpenClawConfig` object).
 * Checks per-account `channels.<id>.accounts[accountId].routeTag` first, then section-level
 * `channels.<id>.routeTag`. Matches `feat_weixin_extension` behavior; channel key is `"openclaw-weixin"`.
 *
 * The config is cached after the first read since routeTag does not change at runtime.
 */
let cachedRouteTagSection: Record<string, unknown> | null | undefined;

function loadRouteTagSection(): Record<string, unknown> | null {
  if (cachedRouteTagSection !== undefined) return cachedRouteTagSection;
  try {
    const configPath = resolveConfigPath();
    if (!fs.existsSync(configPath)) {
      cachedRouteTagSection = null;
      return null;
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    const channels = cfg.channels as Record<string, unknown> | undefined;
    const section = (channels?.["openclaw-weixin"] as Record<string, unknown>) ?? null;
    cachedRouteTagSection = section;
    return section;
  } catch {
    cachedRouteTagSection = null;
    return null;
  }
}

export function loadConfigRouteTag(accountId?: string): string | undefined {
  const section = loadRouteTagSection();
  if (!section) return undefined;
  if (accountId) {
    const accounts = section.accounts as Record<string, Record<string, unknown>> | undefined;
    const tag = accounts?.[accountId]?.routeTag;
    if (typeof tag === "number") return String(tag);
    if (typeof tag === "string" && tag.trim()) return tag.trim();
  }
  if (typeof section.routeTag === "number") return String(section.routeTag);
  return typeof section.routeTag === "string" && section.routeTag.trim() ? section.routeTag.trim() : undefined;
}

/**
 * Read `botAgent` from `channels.openclaw-weixin.botAgent` in openclaw.json.
 * Returns the raw configured string (caller is responsible for sanitization)
 * or undefined when not set. Reuses the cached channel section.
 */
export function loadConfigBotAgent(): string | undefined {
  const section = loadRouteTagSection();
  if (!section) return undefined;
  const value = section.botAgent;
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Bump `channels.openclaw-weixin.channelConfigUpdatedAt` in openclaw.json on each successful login
 * so the gateway reloads config from disk (no empty `accounts: {}` placeholder).
 */
export async function triggerWeixinChannelReload(): Promise<void> {
  try {
    const { loadConfig, writeConfigFile } = await import("openclaw/plugin-sdk/config-runtime");
    const cfg = loadConfig();
    const channels = (cfg.channels ?? {}) as Record<string, unknown>;
    const existing = (channels["openclaw-weixin"] as Record<string, unknown> | undefined) ?? {};
    const updated: OpenClawConfig = {
      ...cfg,
      channels: {
        ...channels,
        "openclaw-weixin": {
          ...existing,
          channelConfigUpdatedAt: new Date().toISOString(),
        },
      },
    };
    await writeConfigFile(updated);
    logger.info("triggerWeixinChannelReload: wrote channel config to openclaw.json");
  } catch (err) {
    logger.warn(`triggerWeixinChannelReload: failed to update config: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Account resolution (merge config + stored credentials)
// ---------------------------------------------------------------------------

export type ResolvedWeixinAccount = {
  accountId: string;
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  enabled: boolean;
  /** true when a token has been obtained via QR login. */
  configured: boolean;
  name?: string;
};

type WeixinAccountConfig = {
  name?: string;
  enabled?: boolean;
  cdnBaseUrl?: string;
  /** Optional SKRouteTag source; read from openclaw.json when `accountId` is passed to `loadConfigRouteTag`. */
  routeTag?: number | string;
};

type WeixinSectionConfig = WeixinAccountConfig & {
  accounts?: Record<string, WeixinAccountConfig>;
  /** Written on each successful login; see triggerWeixinChannelReload. */
  channelConfigUpdatedAt?: string;
};

/** List accountIds from the index file (written at QR login). */
export function listWeixinAccountIds(_cfg: OpenClawConfig): string[] {
  return listIndexedWeixinAccountIds();
}

/** Resolve a weixin account by ID, merging config and stored credentials. */
export function resolveWeixinAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedWeixinAccount {
  const raw = accountId?.trim();
  if (!raw) {
    throw new Error("weixin: accountId is required (no default account)");
  }
  const id = normalizeAccountId(raw);
  const section = cfg.channels?.["openclaw-weixin"] as WeixinSectionConfig | undefined;
  const accountCfg: WeixinAccountConfig = section?.accounts?.[id] ?? section ?? {};

  const accountData = loadWeixinAccount(id);
  const token = accountData?.token?.trim() || undefined;
  const stateBaseUrl = accountData?.baseUrl?.trim() || "";

  return {
    accountId: id,
    baseUrl: stateBaseUrl || DEFAULT_BASE_URL,
    cdnBaseUrl: accountCfg.cdnBaseUrl?.trim() || CDN_BASE_URL,
    token,
    enabled: accountCfg.enabled !== false,
    configured: Boolean(token),
    name: accountCfg.name?.trim() || undefined,
  };
}
