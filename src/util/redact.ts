const DEFAULT_TOKEN_PREFIX_LEN = 0;
const SAFE_ERROR_NAMES = new Set([
  "AbortError",
  "AggregateError",
  "Error",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);
const SAFE_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "EACCES",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EEXIST",
  "EHOSTUNREACH",
  "EISDIR",
  "EMFILE",
  "ENETUNREACH",
  "ENOENT",
  "ENOSPC",
  "ENOTDIR",
  "ENOTFOUND",
  "EPERM",
  "ERR_SSL_PROTOCOL_ERROR",
  "ETIMEDOUT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * Truncate a string, appending a length indicator when trimmed.
 * Returns `""` for empty/undefined input.
 */
export function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(len=${s.length})`;
}

/**
 * Redact a token/identifier, optionally showing a short prefix for opt-in debug
 * diagnostics. Normal logs use the default prefix length of zero.
 * Returns `"(none)"` when absent.
 */
export function redactToken(token: string | undefined, prefixLen = DEFAULT_TOKEN_PREFIX_LEN): string {
  if (!token) return "(none)";
  const safePrefixLen = Number.isFinite(prefixLen) ? Math.max(0, Math.floor(prefixLen)) : 0;
  if (safePrefixLen === 0 || token.length <= safePrefixLen) return `****(len=${token.length})`;
  return `${token.slice(0, safePrefixLen)}…(len=${token.length})`;
}

/**
 * Return non-payload error metadata suitable for persisted diagnostics.
 */
export function redactError(error: unknown): string {
  if (!(error instanceof Error)) return "Error";
  const name = SAFE_ERROR_NAMES.has(error.name) ? error.name : "Error";
  const directCode = (error as NodeJS.ErrnoException).code;
  const cause = (error as NodeJS.ErrnoException).cause;
  const causeCode =
    typeof cause === "object" && cause !== null && "code" in cause ? (cause as { code?: unknown }).code : undefined;
  const code = directCode ?? causeCode;
  return typeof code === "string" && SAFE_ERROR_CODES.has(code) ? `${name}(code=${code})` : name;
}

/**
 * Strip query string (which often contains signatures/tokens) from a URL,
 * keeping only origin + pathname.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const base = `${u.origin}${u.pathname}`;
    return u.search || u.hash ? `${base}?<redacted>` : base;
  } catch {
    return "(invalid-url)";
  }
}
