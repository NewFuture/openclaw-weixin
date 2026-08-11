import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../util/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { mockSendMessageWeixin } = vi.hoisted(() => ({
  mockSendMessageWeixin: vi.fn(),
}));

vi.mock("./send.js", () => ({
  sendMessageWeixin: mockSendMessageWeixin,
}));

import { logger } from "../util/logger.js";
import { sendWeixinErrorNotice } from "./error-notice.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendWeixinErrorNotice", () => {
  it("sends error message when contextToken is provided", async () => {
    mockSendMessageWeixin.mockResolvedValueOnce({ messageId: "m1" });
    await sendWeixinErrorNotice({
      to: "user1",
      contextToken: "ctx-tok",
      message: "Something went wrong",
      baseUrl: "https://api.com",
      token: "tok",
      runId: "run-1",
      errLog: vi.fn(),
    });
    expect(mockSendMessageWeixin).toHaveBeenCalledOnce();
    expect(mockSendMessageWeixin).toHaveBeenCalledWith({
      to: "user1",
      text: "Something went wrong",
      opts: {
        baseUrl: "https://api.com",
        token: "tok",
        contextToken: "ctx-tok",
        runId: "run-1",
      },
    });
  });

  it("skips the error notice when contextToken is undefined", async () => {
    const recipientId = "oSYNTH0000000000000000000000@im.wechat";
    const errLog = vi.fn();
    await sendWeixinErrorNotice({
      to: recipientId,
      contextToken: undefined,
      message: "err",
      baseUrl: "https://api.com",
      errLog,
    });
    expect(mockSendMessageWeixin).not.toHaveBeenCalled();
    expect(errLog).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "sendWeixinErrorNotice: no contextToken for oSYNTH…(len=38), skipping error notice",
    );
    expect(vi.mocked(logger.warn).mock.calls.flat().join(" ")).not.toContain(recipientId);
  });

  it("catches and logs errors from sendMessageWeixin", async () => {
    mockSendMessageWeixin.mockRejectedValueOnce(new Error("send failed"));
    const errLog = vi.fn();
    await sendWeixinErrorNotice({
      to: "user1",
      contextToken: "ctx",
      message: "err msg",
      baseUrl: "https://api.com",
      errLog,
    });
    // Should not throw
    expect(errLog).toHaveBeenCalledWith(expect.stringContaining("sendWeixinErrorNotice failed"));
  });
});
