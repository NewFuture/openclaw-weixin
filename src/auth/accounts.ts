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

/** Atomically replace a JSON file (temp + rename) so mid-write failures keep the previous file. */
function writeJsonFileAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

/** Replace the persistent account index in a single atomic write. */
function writeAccountIndex(accountIds: string[]): void {
  writeJsonFileAtomic(resolveAccountIndexPath(), accountIds);
}

// ---------------------------------------------------------------------------
// Alias → primary hash map (logical; not a second monitor / state namespace)
// ---------------------------------------------------------------------------

function resolveAccountAliasMapPath(): string {
  return path.join(resolveWeixinStateDir(), "account-aliases.json");
}

type WeixinAccountAliasMap = Record<string, string>;

function loadAccountAliasMap(): WeixinAccountAliasMap {
  const filePath = resolveAccountAliasMapPath();
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: WeixinAccountAliasMap = {};
    for (const [alias, primary] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof alias !== "string" || typeof primary !== "string") continue;
      const a = alias.trim();
      const p = primary.trim();
      if (!a || !p) continue;
      out[a] = p;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAccountAliasMap(map: WeixinAccountAliasMap): void {
  writeJsonFileAtomic(resolveAccountAliasMapPath(), map);
}

/** Resolve alias → primary hash, or return the id itself when it is already primary. */
export function resolvePrimaryAccountId(accountId: string): string {
  const id = normalizeAccountId(accountId.trim());
  if (!id) return id;
  const mapped = loadAccountAliasMap()[id];
  return mapped ? normalizeAccountId(mapped) || id : id;
}

/** Reverse lookup: primary hash → public alias (if any). */
export function resolveAliasForPrimaryAccountId(primaryId: string): string | null {
  const primary = normalizeAccountId(primaryId.trim());
  if (!primary) return null;
  for (const [alias, target] of Object.entries(loadAccountAliasMap())) {
    if (normalizeAccountId(target) === primary) return alias;
  }
  return null;
}

/**
 * Public account id for bindings / inbound routing: alias when mapped, else primary.
 * Transport / poll cursor / context tokens / replay dedupe always stay on primary.
 */
export function resolvePublicAccountId(accountId: string): string {
  const primary = resolvePrimaryAccountId(accountId);
  return resolveAliasForPrimaryAccountId(primary) ?? primary;
}

/**
 * Bind a stable alias to a primary bot-hash id (1:1).
 * Rejects conflicts where the alias or primary is already paired differently.
 */
export function bindWeixinAccountAlias(aliasId: string, primaryId: string): void {
  const alias = normalizeAccountId(aliasId.trim());
  const primary = normalizeAccountId(primaryId.trim());
  if (!alias || !primary) {
    throw new Error("weixin: alias and primary account id are required");
  }
  if (alias === primary) {
    throw new Error("weixin: alias must differ from the primary bot id");
  }
  if (alias.toLowerCase() === HOST_DEFAULT_ACCOUNT_ID) {
    throw new Error("weixin: host default sentinel cannot be used as an alias");
  }

  const map = loadAccountAliasMap();
  const existingPrimary = map[alias] ? normalizeAccountId(map[alias]) : null;
  if (existingPrimary && existingPrimary !== primary) {
    throw new Error(
      "weixin: requested --account alias is already bound to a different bot. " +
        "Choose another alias, or clear the existing alias mapping before rebinding.",
    );
  }
  for (const [otherAlias, target] of Object.entries(map)) {
    if (otherAlias === alias) continue;
    if (normalizeAccountId(target) === primary && otherAlias !== alias) {
      throw new Error(
        "weixin: this bot already has a different --account alias. " +
          "Clear the existing alias mapping before assigning a new one.",
      );
    }
  }
  map[alias] = primary;
  writeAccountAliasMap(map);
}

function unbindAliasesForPrimaryIds(primaryIds: Iterable<string>): void {
  const drop = new Set([...primaryIds].map((id) => normalizeAccountId(id.trim())).filter(Boolean));
  if (drop.size === 0) return;
  const map = loadAccountAliasMap();
  let changed = false;
  for (const [alias, target] of Object.entries(map)) {
    if (drop.has(normalizeAccountId(target))) {
      delete map[alias];
      changed = true;
    }
  }
  if (changed) writeAccountAliasMap(map);
}

/**
 * Reject binding when a leftover alias credential file already holds a different
 * bot token. Never move sync / context / allow-list state between identities.
 */
function assertAliasCredentialCompatible(aliasId: string, primaryToken: string): void {
  const leftoverToken = loadWeixinAccount(aliasId)?.token?.trim();
  if (leftoverToken && leftoverToken !== primaryToken.trim()) {
    throw new Error(
      "weixin: requested --account alias already has credentials for a different bot. " +
        "Choose another alias, or clear the existing alias credentials before rebinding.",
    );
  }
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
 * @param keepAccountIds primary bot-hash ids that must not be deleted
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
    (Array.isArray(keepAccountIds) ? keepAccountIds : [keepAccountIds])
      .map((id) => resolvePrimaryAccountId(id.trim()))
      .filter(Boolean),
  );
  if (keep.size === 0) return;
  const allIds = listIndexedWeixinAccountIds();
  const removedPrimaries: string[] = [];
  for (const id of allIds) {
    const primary = resolvePrimaryAccountId(id);
    if (keep.has(primary)) continue;
    const data = loadWeixinAccount(primary) ?? loadWeixinAccount(id);
    if (data?.userId?.trim() === userId) {
      logger.info("clearStaleAccountsForUserId: removing stale account for same userId");
      onClearContextTokens?.(primary);
      if (id !== primary) {
        onClearContextTokens?.(id);
        clearWeixinAccount(id);
      }
      clearWeixinAccount(primary);
      unregisterWeixinAccountId(id);
      if (id !== primary) unregisterWeixinAccountId(primary);
      removedPrimaries.push(primary);
    }
  }
  unbindAliasesForPrimaryIds(removedPrimaries);
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
  /**
   * Sole id registered for gateway `listAccountIds` / monitor startup.
   * Always the primary bot-hash — aliases are logical only.
   */
  canonicalId: string;
};

/**
 * Publish the primary bot-hash into the runtime index and drop any leftover
 * alias ids (or other drop candidates) so one bot token never starts two monitors.
 */
function publishPrimaryAccountIndex(primaryId: string, dropFromIndex: readonly string[] = []): void {
  const aliasKeys = new Set(Object.keys(loadAccountAliasMap()));
  const drop = new Set([...dropFromIndex, ...aliasKeys].map((id) => id.trim()).filter((id) => id && id !== primaryId));
  const next = listIndexedWeixinAccountIds()
    .map((id) => resolvePrimaryAccountId(id))
    .filter((id) => id && id !== primaryId && !drop.has(id));
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const id of next) {
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(id);
  }
  deduped.push(primaryId);
  writeAccountIndex(deduped);
}

/**
 * Persist QR-login credentials under the server bot-hash id. When the caller
 * passed a stable `--account` alias, record a 1:1 alias→hash mapping for
 * bindings / outbound resolution — without indexing the alias or starting a
 * second monitor, and without relocating state namespaces onto the alias.
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
  if (aliasId) {
    assertAliasCredentialCompatible(aliasId, params.token);
    bindWeixinAccountAlias(aliasId, primaryId);
    logger.info("persistWeixinLoginAccounts: bound alias mapping to primary bot id");
  }

  // Publish the primary index entry before destructive stale cleanup so a
  // later failure cannot leave credentials undiscoverable after restart.
  publishPrimaryAccountIndex(primaryId, aliasId ? [aliasId] : []);

  if (params.userId?.trim()) {
    clearStaleAccountsForUserId([primaryId], params.userId.trim(), params.onClearContextTokens);
  }

  return { primaryId, aliasId, canonicalId: primaryId };
}

export type MigrateBoundAccountToAliasResult = PersistWeixinLoginAccountsResult;

/**
 * When QR login returns `alreadyConnected` / `binded_redirect`, bind a requested
 * stable `--account` alias onto an unambiguous local primary (hash) account.
 *
 * Does not rename the runtime account id: the primary hash stays indexed and
 * owns all state. Returns null when no alias was requested (including the host
 * `default` sentinel). Throws when the source binding is ambiguous / missing.
 */
export function migrateBoundAccountToAlias(params: {
  requestedAccountId?: string | null;
  onClearContextTokens?: (accountId: string) => void;
}): MigrateBoundAccountToAliasResult | null {
  // primary id unknown until we resolve the source credential; pass "" so only
  // sentinel / UUID / empty checks apply before we know the hash id.
  const aliasId = resolveLoginAccountAlias(params.requestedAccountId, "");
  if (!aliasId) return null;

  const existingPrimary = resolvePrimaryAccountId(aliasId);
  if (existingPrimary !== aliasId) {
    // Alias already mapped — ensure the primary remains the sole indexed id.
    publishPrimaryAccountIndex(existingPrimary, [aliasId]);
    return { primaryId: existingPrimary, aliasId, canonicalId: existingPrimary };
  }

  const indexedWithToken = listIndexedWeixinAccountIds()
    .map((id) => {
      const primary = resolvePrimaryAccountId(id);
      return { primary, data: loadWeixinAccount(primary) ?? loadWeixinAccount(id) };
    })
    .filter((entry): entry is { primary: string; data: WeixinAccountData } => Boolean(entry.data?.token?.trim()));

  const uniquePrimaries = new Map<string, { primary: string; data: WeixinAccountData }>();
  for (const entry of indexedWithToken) {
    uniquePrimaries.set(entry.primary, entry);
  }

  if (uniquePrimaries.size === 0) {
    throw new Error(
      "weixin: already connected, but no local credentials are available to bind the requested --account alias. " +
        "Clear stale state or re-login with a fresh QR (force) so a token is issued.",
    );
  }

  if (uniquePrimaries.size > 1) {
    throw new Error(
      `weixin: already connected, but multiple bound accounts are ambiguous (${uniquePrimaries.size}). ` +
        "Re-login with force for a single account, or remove the extra credentials before binding --account.",
    );
  }

  const source = [...uniquePrimaries.values()][0];
  const token = source.data.token?.trim();
  if (!token) {
    throw new Error(
      "weixin: already connected, but the matched account has no token to bind to the requested --account alias.",
    );
  }

  // Rerun with --account <existing-hash>: treat as no-op (not an alias bind).
  if (aliasId === source.primary) {
    return null;
  }

  assertAliasCredentialCompatible(aliasId, token);
  bindWeixinAccountAlias(aliasId, source.primary);
  publishPrimaryAccountIndex(source.primary, [aliasId]);

  if (source.data.userId?.trim()) {
    clearStaleAccountsForUserId([source.primary], source.data.userId.trim(), params.onClearContextTokens);
  }

  logger.info("migrateBoundAccountToAlias: bound alias mapping onto primary bot id");
  return { primaryId: source.primary, aliasId, canonicalId: source.primary };
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
  /**
   * Requested / host-facing account id (may be a stable alias).
   * Gateway status/start/stop for transport use {@link primaryId}.
   */
  accountId: string;
  /** Primary bot-hash id: monitor, poll cursor, context tokens, replay dedupe. */
  primaryId: string;
  /** Stable alias when one is bound to {@link primaryId}; otherwise null. */
  aliasId: string | null;
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

/**
 * List primary bot-hash account ids for gateway monitors.
 * Alias keys are never returned — they resolve via {@link resolveWeixinAccount}.
 */
export function listWeixinAccountIds(_cfg: OpenClawConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of listIndexedWeixinAccountIds()) {
    const primary = resolvePrimaryAccountId(id);
    if (!primary || seen.has(primary)) continue;
    seen.add(primary);
    out.push(primary);
  }
  return out;
}

/** Resolve a weixin account by ID (alias or primary), merging config and stored credentials. */
export function resolveWeixinAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedWeixinAccount {
  const raw = accountId?.trim();
  if (!raw) {
    throw new Error("weixin: accountId is required (no default account)");
  }
  const requestedId = normalizeAccountId(raw);
  const primaryId = resolvePrimaryAccountId(requestedId);
  const aliasId = resolveAliasForPrimaryAccountId(primaryId);
  const section = cfg.channels?.["openclaw-weixin"] as WeixinSectionConfig | undefined;
  const accounts = section?.accounts;
  const accountCfg: WeixinAccountConfig =
    accounts?.[requestedId] ?? (aliasId ? accounts?.[aliasId] : undefined) ?? accounts?.[primaryId] ?? section ?? {};

  const accountData = loadWeixinAccount(primaryId) ?? loadWeixinAccount(requestedId);
  const token = accountData?.token?.trim() || undefined;
  const stateBaseUrl = accountData?.baseUrl?.trim() || "";

  return {
    accountId: requestedId,
    primaryId,
    aliasId,
    baseUrl: stateBaseUrl || DEFAULT_BASE_URL,
    cdnBaseUrl: accountCfg.cdnBaseUrl?.trim() || CDN_BASE_URL,
    token,
    enabled: accountCfg.enabled !== false,
    configured: Boolean(token),
    name: accountCfg.name?.trim() || undefined,
  };
}
