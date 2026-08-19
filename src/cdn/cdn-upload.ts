import { logger } from "../util/logger.js";
import { redactError, redactUrl } from "../util/redact.js";
import { encryptAesEcb } from "./aes-ecb.js";
import { buildCdnUploadUrl } from "./cdn-url.js";

/** Maximum retry attempts for CDN upload. */
const UPLOAD_MAX_RETRIES = 3;

async function discardResponseBody(res: Response, label: string): Promise<void> {
  try {
    await res.body?.cancel();
  } catch (err) {
    logger.debug(`${label}: failed to discard CDN response body error=${redactError(err)}`);
  }
}

/**
 * Upload one buffer to the Weixin CDN with AES-128-ECB encryption.
 * Returns the download encrypted_query_param from the CDN response.
 * Retries up to UPLOAD_MAX_RETRIES times on server errors; client errors (4xx) abort immediately.
 */
export async function uploadBufferToCdn(params: {
  buf: Buffer;
  /** From getUploadUrl.upload_full_url; POST target when set (takes precedence over uploadParam). */
  uploadFullUrl?: string;
  uploadParam?: string;
  filekey: string;
  cdnBaseUrl: string;
  label: string;
  aeskey: Buffer;
}): Promise<{ downloadParam: string }> {
  const { buf, uploadFullUrl, uploadParam, filekey, cdnBaseUrl, label, aeskey } = params;
  const ciphertext = encryptAesEcb(buf, aeskey);
  const trimmedFull = uploadFullUrl?.trim();
  let cdnUrl: string;
  if (trimmedFull) {
    cdnUrl = trimmedFull;
  } else if (uploadParam) {
    cdnUrl = buildCdnUploadUrl({ cdnBaseUrl, uploadParam, filekey });
  } else {
    throw new Error(`${label}: CDN upload URL missing (need upload_full_url or upload_param)`);
  }
  logger.debug(`${label}: CDN POST url=${redactUrl(cdnUrl)} ciphertextSize=${ciphertext.length}`);

  let downloadParam: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(cdnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
      });
      if (res.status >= 400 && res.status < 500) {
        await discardResponseBody(res, label);
        logger.error(`${label}: CDN client error attempt=${attempt} status=${res.status}`);
        throw new Error(`CDN upload client error ${res.status}`);
      }
      if (res.status !== 200) {
        await discardResponseBody(res, label);
        logger.error(`${label}: CDN server error attempt=${attempt} status=${res.status}`);
        throw new Error(`CDN upload server error ${res.status}`);
      }
      downloadParam = res.headers.get("x-encrypted-param") ?? undefined;
      if (!downloadParam) {
        logger.error(`${label}: CDN response missing x-encrypted-param header attempt=${attempt}`);
        throw new Error("CDN upload response missing x-encrypted-param header");
      }
      logger.debug(`${label}: CDN upload success attempt=${attempt}`);
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message.includes("client error")) throw err;
      if (attempt < UPLOAD_MAX_RETRIES) {
        logger.error(
          `${label}: attempt ${attempt} failed, retrying... url=${redactUrl(cdnUrl)} error=${redactError(err)}`,
        );
      } else {
        logger.error(
          `${label}: all ${UPLOAD_MAX_RETRIES} attempts failed url=${redactUrl(cdnUrl)} error=${redactError(err)}`,
        );
      }
    }
  }

  if (!downloadParam) {
    throw lastError instanceof Error ? lastError : new Error(`CDN upload failed after ${UPLOAD_MAX_RETRIES} attempts`);
  }
  return { downloadParam };
}
