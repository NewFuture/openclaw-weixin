import { afterEach, describe, expect, it, vi } from "vitest";

import type { MessageItem } from "../api/types.js";
import { MessageItemType } from "../api/types.js";

const mocks = vi.hoisted(() => ({
  downloadAndDecryptBuffer: vi.fn(),
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

vi.mock("../cdn/pic-decrypt.js", () => ({
  downloadAndDecryptBuffer: mocks.downloadAndDecryptBuffer,
  downloadPlainCdnBuffer: vi.fn(),
}));
vi.mock("../util/logger.js", () => ({ logger: mocks.logger }));

import { downloadMediaFromItem } from "./media-download.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("downloadMediaFromItem", () => {
  it("downloads and stores an encrypted image", async () => {
    const encryptedQuery = "synthetic-encrypted-query";
    const aesKey = Buffer.alloc(16).toString("base64");
    const item: MessageItem = {
      type: MessageItemType.IMAGE,
      image_item: {
        media: {
          encrypt_query_param: encryptedQuery,
          aes_key: aesKey,
        },
      },
    };
    const saveMedia = vi.fn().mockResolvedValue({ path: "C:\\synthetic\\image.bin" });
    mocks.downloadAndDecryptBuffer.mockResolvedValue(Buffer.from("image"));

    const result = await downloadMediaFromItem(item, {
      cdnBaseUrl: "https://cdn.example.test",
      saveMedia,
      log: vi.fn(),
      errLog: vi.fn(),
      label: "inbound",
    });

    expect(mocks.downloadAndDecryptBuffer).toHaveBeenCalledWith(
      encryptedQuery,
      aesKey,
      "https://cdn.example.test",
      "inbound image",
      undefined,
    );
    expect(saveMedia).toHaveBeenCalledWith(Buffer.from("image"), undefined, "inbound", 100 * 1024 * 1024);
    expect(result).toEqual({ decryptedPicPath: "C:\\synthetic\\image.bin" });
  });
});
