import { describe, expect, it } from "vitest";

import { getSafeErrorCode, redactBody, redactError, redactToken, redactUrl, truncate } from "./redact.js";

describe("truncate", () => {
  it("returns empty string for undefined", () => {
    expect(truncate(undefined, 10)).toBe("");
  });

  it("returns original when within limit", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("truncates and appends length", () => {
    const result = truncate("a]long-string-here", 5);
    expect(result).toBe("a]lon…(len=18)");
  });
});

describe("redactToken", () => {
  it("returns (none) for undefined", () => {
    expect(redactToken(undefined)).toBe("(none)");
  });

  it("returns (none) for empty string", () => {
    expect(redactToken("")).toBe("(none)");
  });

  it("masks short tokens entirely", () => {
    expect(redactToken("abc", 6)).toBe("****(len=3)");
  });

  it("fully masks tokens by default", () => {
    expect(redactToken("abcdef1234567890")).toBe("****(len=16)");
  });

  it("shows an explicit prefix for opt-in debug diagnostics", () => {
    expect(redactToken("abcdef1234567890", 3)).toBe("abc…(len=16)");
  });

  it("does not reveal a short token even when a longer debug prefix is requested", () => {
    expect(redactToken("abc", 6)).toBe("****(len=3)");
  });

  it("bounds an oversized debug prefix", () => {
    expect(redactToken("abcdefghijklmnopqrstuvwxyz", 100)).toBe("abcdef…(len=26)");
  });
});

describe("redactBody", () => {
  it("returns (empty) for undefined", () => {
    expect(redactBody(undefined)).toBe("(empty)");
  });

  it("returns original when within limit", () => {
    const body = '{"key":"value"}';
    expect(redactBody(body)).toBe(body);
  });

  it("truncates long bodies", () => {
    const body = "x".repeat(300);
    const result = redactBody(body);
    expect(result).toContain("…(truncated, totalLen=300)");
    expect(result.length).toBeLessThan(300);
  });

  it("respects custom max length", () => {
    const body = "x".repeat(50);
    const result = redactBody(body, 10);
    expect(result).toBe("xxxxxxxxxx…(truncated, totalLen=50)");
  });

  it("redacts context_token values", () => {
    const body = '{"to":"user1","context_token":"secret123","text":"hello"}';
    expect(redactBody(body)).toBe('{"to":"user1","context_token":"<redacted>","text":"hello"}');
  });

  it("redacts bot_token values", () => {
    const body = '{"bot_token":"abc-xyz-secret"}';
    expect(redactBody(body)).toBe('{"bot_token":"<redacted>"}');
  });

  it("redacts token values", () => {
    const body = '{"token":"my-secret-token"}';
    expect(redactBody(body)).toBe('{"token":"<redacted>"}');
  });
});

describe("redactError", () => {
  it("allows only known non-payload error codes", () => {
    expect(getSafeErrorCode("ENOTFOUND")).toBe("ENOTFOUND");
    expect(getSafeErrorCode("ENOTFOUND-secretToken")).toBeUndefined();
  });

  it("keeps only the error type and safe code", () => {
    const error = new Error("request failed for https://example.test/?token=secret");
    Object.assign(error, { code: "ETIMEDOUT" });
    expect(redactError(error)).toBe("Error(code=ETIMEDOUT)");
  });

  it("omits arbitrary thrown values and unsafe codes", () => {
    expect(redactError("secret message")).toBe("Error");
    const error = Object.assign(new Error("secret message"), { code: "token-abc123" });
    expect(redactError(error)).toBe("Error");
  });

  it("uses a safe cause code when the direct code is unsafe", () => {
    const error = Object.assign(new Error("secret message"), {
      code: "ERR_NETWORK",
      cause: { code: "ETIMEDOUT" },
    });
    expect(redactError(error)).toBe("Error(code=ETIMEDOUT)");
  });

  it("normalizes an unsafe error name", () => {
    const error = new Error("secret");
    error.name = "SecretToken123";
    expect(redactError(error)).toBe("Error");
  });

  it.each([
    ["name", () => Object.defineProperty(new Error("secret"), "name", { get: () => assertMetadataAccessThrows() })],
    ["code", () => Object.defineProperty(new Error("secret"), "code", { get: () => assertMetadataAccessThrows() })],
    ["cause", () => Object.defineProperty(new Error("secret"), "cause", { get: () => assertMetadataAccessThrows() })],
    [
      "cause.code",
      () =>
        Object.assign(new Error("secret"), {
          cause: Object.defineProperty({}, "code", { get: () => assertMetadataAccessThrows() }),
        }),
    ],
    [
      "proxy metadata",
      () =>
        new Proxy(new Error("secret"), {
          get(target, property, receiver) {
            if (property === "name") return assertMetadataAccessThrows();
            return Reflect.get(target, property, receiver);
          },
        }),
    ],
  ])("returns a fixed fallback when %s access throws", (_label, createError) => {
    expect(redactError(createError())).toBe("Error");
  });
});

function assertMetadataAccessThrows(): never {
  throw new Error("private metadata accessor");
}

describe("redactUrl", () => {
  it("preserves URL without query", () => {
    expect(redactUrl("https://example.com/api/test")).toBe("https://example.com/api/test");
  });

  it("strips query parameters", () => {
    expect(redactUrl("https://example.com/upload?sig=secret&token=abc")).toBe("https://example.com/upload?<redacted>");
  });

  it("strips URL fragments", () => {
    expect(redactUrl("https://example.com/upload#secret")).toBe("https://example.com/upload?<redacted>");
  });

  it("does not echo invalid URLs", () => {
    expect(redactUrl("not-a-url?token=secret")).toBe("(invalid-url)");
  });

  it("does not echo data URL payloads", () => {
    const result = redactUrl("data:text/plain,secret");
    expect(result).toBe("(unsupported-url)");
    expect(result).not.toContain("secret");
  });

  it("does not echo file URL paths", () => {
    const result = redactUrl("file:///private/path");
    expect(result).toBe("(unsupported-url)");
    expect(result).not.toContain("/private/path");
  });
});
