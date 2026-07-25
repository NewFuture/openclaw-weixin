const DEFAULT_BODY_MAX_LEN = 200;
const DEFAULT_TOKEN_PREFIX_LEN = 6;
const SENSITIVE_BODY_KEYS = new Set([
  "account_id",
  "accountid",
  "aes_key",
  "aeskey",
  "authorization",
  "body",
  "bodyforagent",
  "bot_token",
  "client_id",
  "content",
  "context_token",
  "encrypt_query_param",
  "from",
  "from_user_id",
  "full_url",
  "get_updates_buf",
  "group_id",
  "ilink_bot_id",
  "ilink_user_id",
  "local_token_list",
  "mediapath",
  "mediaurl",
  "mediaurls",
  "originatingto",
  "qrcode",
  "qrcode_img_content",
  "run_id",
  "senderid",
  "session_id",
  "text",
  "thumb_upload_param",
  "to",
  "to_user_id",
  "token",
  "typing_ticket",
  "upload_param",
  "verify_code",
]);

function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactJsonValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_BODY_KEYS.has(key.toLowerCase()) ? "<redacted>" : redactJsonValue(nested),
    ]),
  );
}

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
 * Redact a token/secret: show only the first few chars + total length.
 * Returns `"(none)"` when absent.
 */
export function redactToken(token: string | undefined, prefixLen = DEFAULT_TOKEN_PREFIX_LEN): string {
  if (!token) return "(none)";
  if (token.length <= prefixLen) return `****(len=${token.length})`;
  return `${token.slice(0, prefixLen)}…(len=${token.length})`;
}

/**
 * Truncate a JSON body string to `maxLen` chars for safe logging.
 * Redacts known sensitive fields before truncating.
 */
export function redactBody(body: string | undefined, maxLen = DEFAULT_BODY_MAX_LEN): string {
  if (!body) return "(empty)";
  let redacted: string;
  try {
    redacted = JSON.stringify(redactJsonValue(JSON.parse(body)));
  } catch {
    const keys = [...SENSITIVE_BODY_KEYS].join("|");
    redacted = body.replace(new RegExp(`"(${keys})"\\s*:\\s*"[^"]*"`, "gi"), '"$1":"<redacted>"');
  }
  if (redacted.length <= maxLen) return redacted;
  return `${redacted.slice(0, maxLen)}…(truncated, totalLen=${redacted.length})`;
}

/**
 * Strip query string (which often contains signatures/tokens) from a URL,
 * keeping only origin + pathname.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const base = `${u.origin}${u.pathname}`;
    return u.search ? `${base}?<redacted>` : base;
  } catch {
    return truncate(rawUrl, 80);
  }
}
