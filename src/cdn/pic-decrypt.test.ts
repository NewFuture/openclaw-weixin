import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptAesEcb: vi.fn(),
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    withAccount: vi.fn(),
    getLogFilePath: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock("../util/logger.js", () => ({ logger: mocks.logger }));
vi.mock("./aes-ecb.js", () => ({ decryptAesEcb: mocks.decryptAesEcb }));

import { downloadAndDecryptBuffer, downloadPlainCdnBuffer } from "./pic-decrypt.js";

function loggedText(): string {
  return [mocks.logger.info, mocks.logger.debug, mocks.logger.warn, mocks.logger.error]
    .flatMap((fn) => fn.mock.calls.flat())
    .join("\n");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("CDN downloads", () => {
  it("rejects an AES key with an unsupported decoded length", async () => {
    const aesKey = Buffer.from("invalid-key-canary").toString("base64");

    await expect(
      downloadAndDecryptBuffer(
        "synthetic-query",
        aesKey,
        "https://cdn.example.test",
        "inbound image",
        "https://cdn.example.test/download",
      ),
    ).rejects.toThrow("got 18 bytes");
    expect(mocks.decryptAesEcb).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain(aesKey);
  });

  it.each([
    ["raw bytes", Buffer.alloc(16, 7).toString("base64"), Buffer.alloc(16, 7)],
    [
      "base64-encoded hex",
      Buffer.from("00112233445566778899aabbccddeeff", "ascii").toString("base64"),
      Buffer.from("00112233445566778899aabbccddeeff", "hex"),
    ],
  ])("parses %s AES keys before decrypting", async (_encoding, encodedKey, expectedKey) => {
    const encrypted = Buffer.from([1, 2, 3]);
    const plaintext = Buffer.from("plaintext");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(encrypted)));
    mocks.decryptAesEcb.mockReturnValue(plaintext);

    const result = await downloadAndDecryptBuffer(
      "synthetic-query",
      encodedKey,
      "https://cdn.example.test",
      "inbound image",
      "https://cdn.example.test/download",
    );

    expect(result).toEqual(plaintext);
    expect(mocks.decryptAesEcb).toHaveBeenCalledWith(encrypted, expectedKey);
  });

  it("returns bytes from a complete plain CDN URL", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const query = "synthetic-query-canary";
    const url = `https://cdn.example.test/download?encrypted=${query}`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadPlainCdnBuffer("unused-query", "https://cdn.example.test", "inbound file", url);

    expect(result).toEqual(Buffer.from(bytes));
    expect(fetchMock).toHaveBeenCalledWith(url);
    expect(loggedText()).toContain("https://cdn.example.test/download?<redacted>");
    expect(loggedText()).not.toContain(query);
  });

  it("reports a non-success CDN response without exposing its body", async () => {
    const responseBody = "synthetic-response-body-canary";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(responseBody, { status: 403, statusText: "Forbidden" })),
    );

    await expect(
      downloadPlainCdnBuffer(
        "unused-query",
        "https://cdn.example.test",
        "inbound image",
        "https://cdn.example.test/download",
      ),
    ).rejects.toThrow("inbound image: CDN download 403 Forbidden");
    expect(loggedText()).not.toContain(responseBody);
  });

  it("surfaces a concise network failure without exposing error details or URL queries", async () => {
    const query = "synthetic-network-query-canary";
    const errorDetail = "synthetic-network-error-canary";
    const networkError = Object.assign(new Error(errorDetail), {
      cause: Object.assign(new Error("synthetic socket failure"), { code: "ECONNRESET" }),
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    await expect(
      downloadPlainCdnBuffer(
        "unused-query",
        "https://cdn.example.test",
        "inbound image",
        `https://cdn.example.test/download?encrypted=${query}`,
      ),
    ).rejects.toThrow("inbound image: CDN fetch failed (ECONNRESET)");

    expect(loggedText()).toContain("https://cdn.example.test/download?<redacted>");
    expect(loggedText()).not.toContain(query);
    expect(loggedText()).not.toContain(errorDetail);
  });
});
