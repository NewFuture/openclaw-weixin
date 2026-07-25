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

describe("downloadMediaFromItem privacy", () => {
  it("logs only the presence of an encrypted CDN query", async () => {
    const queryCanary = "encrypted-query-canary-e247";
    const item: MessageItem = {
      type: MessageItemType.IMAGE,
      image_item: {
        media: {
          encrypt_query_param: queryCanary,
          aes_key: Buffer.alloc(16).toString("base64"),
        },
      },
    };
    mocks.downloadAndDecryptBuffer.mockResolvedValue(Buffer.from("image"));

    await downloadMediaFromItem(item, {
      cdnBaseUrl: "https://cdn.example.test",
      saveMedia: vi.fn().mockResolvedValue({ path: "C:\\synthetic\\image.bin" }),
      log: vi.fn(),
      errLog: vi.fn(),
      label: "inbound",
    });

    const logText = mocks.logger.debug.mock.calls.flat().join("\n");
    expect(logText).toContain("hasEncryptQuery=true");
    expect(logText).not.toContain(queryCanary);
  });
});
