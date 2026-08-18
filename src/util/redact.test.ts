import { describe, expect, it } from "vitest";

import { redactError, redactToken, redactUrl, truncate } from "./redact.js";

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
});

describe("redactError", () => {
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

  it("normalizes an unsafe error name", () => {
    const error = new Error("secret");
    error.name = "SecretToken123";
    expect(redactError(error)).toBe("Error");
  });
});

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
});
