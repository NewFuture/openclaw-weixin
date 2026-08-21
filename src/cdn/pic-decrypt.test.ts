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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("CDN downloads", () => {
  it("rejects an AES key with an unsupported decoded length", async () => {
    await expect(
      downloadAndDecryptBuffer(
        "synthetic-query",
        Buffer.from("invalid-key").toString("base64"),
        "https://cdn.example.test",
        "inbound image",
        "https://cdn.example.test/download",
      ),
    ).rejects.toThrow("got 11 bytes");
    expect(mocks.decryptAesEcb).not.toHaveBeenCalled();
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
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadPlainCdnBuffer(
      "unused-query",
      "https://cdn.example.test",
      "inbound file",
      "https://cdn.example.test/download?synthetic=1",
    );

    expect(result).toEqual(Buffer.from(bytes));
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.test/download?synthetic=1");
  });

  it("reports a non-success CDN response when body cleanup fails", async () => {
    const bodyError = "synthetic-private-body-error";
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error(bodyError));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 403 })));

    const download = downloadPlainCdnBuffer(
      "unused-query",
      "https://cdn.example.test",
      "inbound image",
      "https://cdn.example.test/download",
    );
    await expect(download).rejects.toThrow(/^inbound image: CDN download failed status=403$/);
    expect(mocks.logger.debug.mock.calls.flat().join(" ")).not.toContain(bodyError);
  });
});
