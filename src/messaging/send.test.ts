import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../util/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { mockSendMessageApi } = vi.hoisted(() => ({
  mockSendMessageApi: vi.fn(),
}));

vi.mock("../api/api.js", () => ({
  sendMessage: mockSendMessageApi,
}));

vi.mock("node:crypto", () => ({
  default: {
    randomBytes: vi.fn(() => Buffer.from("deadbeef", "hex")),
  },
}));

vi.mock("openclaw/plugin-sdk", () => ({
  stripMarkdown: (text: string) =>
    text
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^[*-]\s+/gm, "")
      .replace(/^\d+\.\s+/gm, ""),
}));

import { MessageItemType } from "../api/types.js";
import type { UploadedFileInfo } from "../cdn/upload.js";
import {
  sendFileMessageWeixin,
  sendImageMessageWeixin,
  sendMessageItemWeixin,
  sendMessageWeixin,
  sendVideoMessageWeixin,
} from "./send.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(1700000000000);
});

describe("sendMessageWeixin", () => {
  it("sends without contextToken (no throw)", async () => {
    mockSendMessageApi.mockResolvedValueOnce(undefined);
    const result = await sendMessageWeixin({
      to: "user1",
      text: "hello",
      opts: { baseUrl: "https://api.com" },
    });
    expect(result.messageId).toBeDefined();
  });

  it("sends text message successfully", async () => {
    mockSendMessageApi.mockResolvedValueOnce(undefined);
    const result = await sendMessageWeixin({
      to: "user1",
      text: "hello",
      opts: { baseUrl: "https://api.com", token: "tok", contextToken: "ctx" },
    });
    expect(result.messageId).toBeDefined();
    expect(mockSendMessageApi).toHaveBeenCalledOnce();
    const callArgs = mockSendMessageApi.mock.calls[0][0];
    expect(callArgs.body.msg.to_user_id).toBe("user1");
    expect(callArgs.body.msg.context_token).toBe("ctx");
  });

  it("includes run_id when provided", async () => {
    mockSendMessageApi.mockResolvedValueOnce(undefined);
    await sendMessageWeixin({
      to: "user1",
      text: "hello",
      opts: { baseUrl: "https://api.com", contextToken: "ctx", runId: "run-1" },
    });
    const callArgs = mockSendMessageApi.mock.calls[0][0];
    expect(callArgs.body.msg.run_id).toBe("run-1");
  });

  it("sends message with empty text (no item_list)", async () => {
    mockSendMessageApi.mockResolvedValueOnce(undefined);
    const result = await sendMessageWeixin({
      to: "user1",
      text: "",
      opts: { baseUrl: "https://api.com", contextToken: "ctx" },
    });
    expect(result.messageId).toBeDefined();
    const callArgs = mockSendMessageApi.mock.calls[0][0];
    expect(callArgs.body.msg.item_list).toBeUndefined();
  });

  it("re-throws API errors", async () => {
    mockSendMessageApi.mockRejectedValueOnce(new Error("api fail"));
    await expect(
      sendMessageWeixin({
        to: "user1",
        text: "hello",
        opts: { baseUrl: "https://api.com", contextToken: "ctx" },
      }),
    ).rejects.toThrow("api fail");
  });
});

describe("sendMessageItemWeixin", () => {
  it("sends structured message item with run_id", async () => {
    mockSendMessageApi.mockResolvedValueOnce(undefined);
    await sendMessageItemWeixin({
      to: "user1",
      item: {
        type: MessageItemType.TOOL_CALL_START,
        is_completed: false,
        tool_call_start_item: {
          tool_name: "read",
          tool_call_id: "tool:call-1",
        },
      },
      opts: { baseUrl: "https://api.com", contextToken: "ctx", runId: "run-1" },
    });
    const callArgs = mockSendMessageApi.mock.calls[0][0];
    expect(callArgs.body.msg.run_id).toBe("run-1");
    expect(callArgs.body.msg.item_list).toEqual([
      {
        type: MessageItemType.TOOL_CALL_START,
        is_completed: false,
        tool_call_start_item: {
          tool_name: "read",
          tool_call_id: "tool:call-1",
        },
      },
    ]);
  });
});

function makeUploadedFileInfo(overrides?: Partial<UploadedFileInfo>): UploadedFileInfo {
  return {
    filekey: "fk",
    downloadEncryptedQueryParam: "param",
    aeskey: "0123456789abcdef0123456789abcdef",
    fileSize: 1024,
    fileSizeCiphertext: 1040,
    ...overrides,
  };
}

describe("sendImageMessageWeixin", () => {
  it("sends without contextToken (no throw)", async () => {
    mockSendMessageApi.mockResolvedValueOnce(undefined);
    const result = await sendImageMessageWeixin({
      to: "u",
      text: "",
      uploaded: makeUploadedFileInfo(),
      opts: { baseUrl: "https://api.com" },
    });
    expect(result.messageId).toBeDefined();
  });

  it("sends image caption before the media item", async () => {
    mockSendMessageApi.mockResolvedValue(undefined);
    const result = await sendImageMessageWeixin({
      to: "user1",
      text: "caption",
      uploaded: makeUploadedFileInfo(),
      opts: { baseUrl: "https://api.com", contextToken: "ctx" },
    });
    expect(result.messageId).toBeDefined();
    expect(mockSendMessageApi).toHaveBeenCalledTimes(2);
  });

  it("includes run_id on media caption and item sends", async () => {
    mockSendMessageApi.mockResolvedValue(undefined);
    await sendImageMessageWeixin({
      to: "user1",
      text: "caption",
      uploaded: makeUploadedFileInfo(),
      opts: { baseUrl: "https://api.com", contextToken: "ctx", runId: "run-media" },
    });
    expect(mockSendMessageApi).toHaveBeenCalledTimes(2);
    expect(mockSendMessageApi.mock.calls[0][0].body.msg.run_id).toBe("run-media");
    expect(mockSendMessageApi.mock.calls[1][0].body.msg.run_id).toBe("run-media");
  });

  it("sends image message without caption (single call)", async () => {
    mockSendMessageApi.mockResolvedValue(undefined);
    const result = await sendImageMessageWeixin({
      to: "user1",
      text: "",
      uploaded: makeUploadedFileInfo(),
      opts: { baseUrl: "https://api.com", contextToken: "ctx" },
    });
    expect(result.messageId).toBeDefined();
    expect(mockSendMessageApi).toHaveBeenCalledTimes(1);
  });

  it("re-throws error from sendMediaItems on API failure", async () => {
    mockSendMessageApi.mockRejectedValueOnce(new Error("cdn fail"));
    await expect(
      sendImageMessageWeixin({
        to: "user1",
        text: "",
        uploaded: makeUploadedFileInfo(),
        opts: { baseUrl: "https://api.com", contextToken: "ctx" },
      }),
    ).rejects.toThrow("cdn fail");
  });
});

describe("sendVideoMessageWeixin", () => {
  it("sends without contextToken (no throw)", async () => {
    mockSendMessageApi.mockResolvedValueOnce(undefined);
    const result = await sendVideoMessageWeixin({
      to: "u",
      text: "",
      uploaded: makeUploadedFileInfo(),
      opts: { baseUrl: "https://api.com" },
    });
    expect(result.messageId).toBeDefined();
  });

  it("sends video message", async () => {
    mockSendMessageApi.mockResolvedValue(undefined);
    const result = await sendVideoMessageWeixin({
      to: "user1",
      text: "",
      uploaded: makeUploadedFileInfo(),
      opts: { baseUrl: "https://api.com", contextToken: "ctx" },
    });
    expect(result.messageId).toBeDefined();
  });

  it("uses the ciphertext size in the video payload", async () => {
    mockSendMessageApi.mockResolvedValue(undefined);
    await sendVideoMessageWeixin({
      to: "user1",
      text: "",
      uploaded: makeUploadedFileInfo({ fileSizeCiphertext: 2048 }),
      opts: { baseUrl: "https://api.com", contextToken: "ctx" },
    });
    expect(mockSendMessageApi.mock.calls[0][0].body.msg.item_list[0].video_item?.video_size).toBe(2048);
  });
});

describe("sendFileMessageWeixin", () => {
  it("sends without contextToken (no throw)", async () => {
    mockSendMessageApi.mockResolvedValueOnce(undefined);
    const result = await sendFileMessageWeixin({
      to: "u",
      text: "",
      fileName: "file.pdf",
      uploaded: makeUploadedFileInfo(),
      opts: { baseUrl: "https://api.com" },
    });
    expect(result.messageId).toBeDefined();
  });

  it("sends file message", async () => {
    mockSendMessageApi.mockResolvedValue(undefined);
    const result = await sendFileMessageWeixin({
      to: "user1",
      text: "see attached",
      fileName: "doc.pdf",
      uploaded: makeUploadedFileInfo(),
      opts: { baseUrl: "https://api.com", contextToken: "ctx" },
    });
    expect(result.messageId).toBeDefined();
    expect(mockSendMessageApi).toHaveBeenCalledTimes(2);
  });
});
