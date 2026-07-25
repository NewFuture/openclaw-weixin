import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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

describe("CDN download privacy", () => {
  it("never includes an invalid AES key in errors or logs", async () => {
    const aesKeyCanary = Buffer.from("invalid-key-canary").toString("base64");
    let error: unknown;

    try {
      await downloadAndDecryptBuffer(
        "synthetic-query",
        aesKeyCanary,
        "https://cdn.example.test",
        "inbound image",
        "https://cdn.example.test/download",
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(aesKeyCanary);
    expect(loggedText()).not.toContain(aesKeyCanary);
  });

  it("redacts CDN query parameters from successful download logs", async () => {
    const queryCanary = "cdn-query-canary-91ef";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))));

    await downloadPlainCdnBuffer(
      "unused-query",
      "https://cdn.example.test",
      "inbound image",
      `https://cdn.example.test/download?encrypted=${queryCanary}`,
    );

    expect(loggedText()).not.toContain(queryCanary);
    expect(loggedText()).toContain("https://cdn.example.test/download?<redacted>");
  });

  it("does not expose response bodies or network error details", async () => {
    const responseCanary = "cdn-response-canary-a83b";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(responseCanary, { status: 403, statusText: "Forbidden" }))
        .mockRejectedValueOnce(new Error(`request failed with ${responseCanary}`)),
    );

    await expect(
      downloadPlainCdnBuffer(
        "unused-query",
        "https://cdn.example.test",
        "inbound image",
        "https://cdn.example.test/download",
      ),
    ).rejects.not.toThrow(responseCanary);
    await expect(
      downloadPlainCdnBuffer(
        "unused-query",
        "https://cdn.example.test",
        "inbound image",
        "https://cdn.example.test/download",
      ),
    ).rejects.not.toThrow(responseCanary);

    expect(loggedText()).not.toContain(responseCanary);
  });
});
