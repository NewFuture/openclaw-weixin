import { afterEach, describe, expect, it, vi } from "vitest";

import type { MessageItem } from "../api/types.js";
import { MessageItemType } from "../api/types.js";

const mocks = vi.hoisted(() => ({
  downloadAndDecryptBuffer: vi.fn(),
  silkToWav: vi.fn(),
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
vi.mock("./silk-transcode.js", () => ({ silkToWav: mocks.silkToWav }));

import { downloadMediaFromItem } from "./media-download.js";

const COMMON_DEPS = {
  cdnBaseUrl: "https://cdn.example.test",
  log: vi.fn(),
  errLog: vi.fn(),
  label: "inbound",
} as const;

function makeImageItem(): MessageItem {
  return {
    type: MessageItemType.IMAGE,
    image_item: {
      media: {
        encrypt_query_param: "synthetic-encrypted-query",
        aes_key: Buffer.alloc(16).toString("base64"),
      },
    },
  };
}

function makeVoiceItem(): MessageItem {
  return {
    type: MessageItemType.VOICE,
    voice_item: {
      media: {
        encrypt_query_param: "synthetic-voice-query",
        aes_key: Buffer.alloc(16).toString("base64"),
      },
    },
  };
}

function makeFileItem(): MessageItem {
  return {
    type: MessageItemType.FILE,
    file_item: {
      media: {
        encrypt_query_param: "synthetic-file-query",
        aes_key: Buffer.alloc(16).toString("base64"),
      },
      file_name: "synthetic.txt",
    },
  };
}

function makeVideoItem(): MessageItem {
  return {
    type: MessageItemType.VIDEO,
    video_item: {
      media: {
        encrypt_query_param: "synthetic-video-query",
        aes_key: Buffer.alloc(16).toString("base64"),
      },
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("downloadMediaFromItem", () => {
  it("downloads and stores an encrypted image under the legacy 'inbound' subdir by default", async () => {
    const item = makeImageItem();
    const saveMedia = vi.fn().mockResolvedValue({ path: "C:\\synthetic\\image.bin" });
    mocks.downloadAndDecryptBuffer.mockResolvedValue(Buffer.from("image"));

    const result = await downloadMediaFromItem(item, {
      ...COMMON_DEPS,
      saveMedia,
    });

    expect(mocks.downloadAndDecryptBuffer).toHaveBeenCalledWith(
      "synthetic-encrypted-query",
      Buffer.alloc(16).toString("base64"),
      "https://cdn.example.test",
      "inbound image",
      undefined,
    );
    expect(saveMedia).toHaveBeenCalledWith(Buffer.from("image"), undefined, "inbound", 100 * 1024 * 1024);
    expect(result).toEqual({ decryptedPicPath: "C:\\synthetic\\image.bin" });
  });

  it("propagates a caller-supplied subdir through every media branch", async () => {
    // Per-agent isolation relies on the calling layer (process-message.ts) passing
    // a per-agent subdir. This test pins the contract that `downloadMediaFromItem`
    // threads `deps.subdir` through every save site.
    const perAgentSubdir = "weixin/agent-x/inbound";
    const saveMedia = vi.fn().mockResolvedValue({ path: "C:\\synthetic\\media.bin" });
    mocks.downloadAndDecryptBuffer.mockResolvedValue(Buffer.from("payload"));

    // Image branch (encrypted path).
    await downloadMediaFromItem(makeImageItem(), { ...COMMON_DEPS, saveMedia, subdir: perAgentSubdir });
    expect(saveMedia).toHaveBeenLastCalledWith(Buffer.from("payload"), undefined, perAgentSubdir, 100 * 1024 * 1024);

    // Voice branch — WAV path: silk->wav transcode succeeds, contentType is "audio/wav".
    mocks.silkToWav.mockResolvedValueOnce(Buffer.from("synthetic-wav-payload"));
    await downloadMediaFromItem(makeVoiceItem(), { ...COMMON_DEPS, saveMedia, subdir: perAgentSubdir });
    expect(saveMedia).toHaveBeenLastCalledWith(
      Buffer.from("synthetic-wav-payload"),
      "audio/wav",
      perAgentSubdir,
      100 * 1024 * 1024,
    );

    // Voice branch — SILK fallback: silk->wav transcode unavailable, raw SILK is saved.
    mocks.silkToWav.mockResolvedValueOnce(null);
    await downloadMediaFromItem(makeVoiceItem(), { ...COMMON_DEPS, saveMedia, subdir: perAgentSubdir });
    expect(saveMedia).toHaveBeenLastCalledWith(Buffer.from("payload"), "audio/silk", perAgentSubdir, 100 * 1024 * 1024);

    // File branch.
    await downloadMediaFromItem(makeFileItem(), { ...COMMON_DEPS, saveMedia, subdir: perAgentSubdir });
    expect(saveMedia).toHaveBeenLastCalledWith(
      Buffer.from("payload"),
      expect.any(String),
      perAgentSubdir,
      100 * 1024 * 1024,
      "synthetic.txt",
    );

    // Video branch.
    await downloadMediaFromItem(makeVideoItem(), { ...COMMON_DEPS, saveMedia, subdir: perAgentSubdir });
    expect(saveMedia).toHaveBeenLastCalledWith(Buffer.from("payload"), "video/mp4", perAgentSubdir, 100 * 1024 * 1024);

    // Five distinct saveMedia calls, one per media branch (image + WAV + SILK + file + video).
    expect(saveMedia).toHaveBeenCalledTimes(5);
  });
});
