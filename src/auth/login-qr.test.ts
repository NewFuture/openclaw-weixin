import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGetFetch: vi.fn(),
  apiPostFetch: vi.fn(),
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

vi.mock("../api/api.js", () => ({
  apiGetFetch: mocks.apiGetFetch,
  apiPostFetch: mocks.apiPostFetch,
}));
vi.mock("../util/logger.js", () => ({ logger: mocks.logger }));
vi.mock("./accounts.js", () => ({
  listIndexedWeixinAccountIds: vi.fn(() => []),
  loadWeixinAccount: vi.fn(),
}));

import { startWeixinLoginWithQr, waitForWeixinLogin } from "./login-qr.js";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function getLogs(): string {
  return [
    ...mocks.logger.info.mock.calls,
    ...mocks.logger.debug.mock.calls,
    ...mocks.logger.warn.mock.calls,
    ...mocks.logger.error.mock.calls,
  ]
    .flat()
    .join(" ");
}

describe("QR login lifecycle", () => {
  it("starts a QR session and returns confirmed credentials", async () => {
    const qrcode = "synthetic-qrcode";
    const qrcodeUrl = "https://login.example.test/synthetic-qr";
    const botToken = "synthetic-bot-token";
    const accountId = "synthetic-bot-account";
    const sessionKey = "synthetic-session-key";
    mocks.apiPostFetch.mockResolvedValue(
      JSON.stringify({
        qrcode,
        qrcode_img_content: qrcodeUrl,
      }),
    );
    mocks.apiGetFetch.mockResolvedValue(
      JSON.stringify({
        status: "confirmed",
        bot_token: botToken,
        ilink_bot_id: accountId,
      }),
    );

    const start = await startWeixinLoginWithQr({
      accountId: sessionKey,
      apiBaseUrl: "https://ignored.example.test",
    });
    const result = await waitForWeixinLogin({
      sessionKey: start.sessionKey,
      apiBaseUrl: "https://ignored.example.test",
    });

    expect(start).toEqual({
      qrcodeUrl,
      message: "用手机微信扫描以下二维码，以继续连接：",
      sessionKey,
    });
    expect(result).toMatchObject({
      connected: true,
      botToken,
      accountId,
    });
    expect(mocks.apiPostFetch).toHaveBeenCalledWith({
      baseUrl: "https://ilinkai.weixin.qq.com",
      endpoint: "ilink/bot/get_bot_qrcode?bot_type=3",
      body: JSON.stringify({ local_token_list: [] }),
      label: "fetchQRCode",
    });
    expect(mocks.apiGetFetch).toHaveBeenCalledWith({
      baseUrl: "https://ilinkai.weixin.qq.com",
      endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      timeoutMs: 35_000,
      label: "pollQRStatus",
    });
    const logs = getLogs();
    for (const sensitive of [qrcode, qrcodeUrl, botToken, accountId, sessionKey]) {
      expect(logs).not.toContain(sensitive);
    }
    expect(logs).not.toContain(qrcode.slice(0, 6));
  });

  it("sanitizes startup failures in logs and the returned message", async () => {
    const secret = "startup-secret-path";
    mocks.apiPostFetch.mockRejectedValueOnce(Object.assign(new Error(secret), { code: "ETIMEDOUT" }));

    const result = await startWeixinLoginWithQr({
      accountId: "startup-session",
      apiBaseUrl: "https://ignored.example.test",
    });

    expect(result.message).toBe("Failed to start login.");
    expect(result.message).not.toContain(secret);
    expect(getLogs()).toContain("Error(code=ETIMEDOUT)");
    expect(getLogs()).not.toContain(secret);
  });

  it("sanitizes QR refresh failures in logs and the returned message", async () => {
    const qrcode = "refresh-qrcode";
    const secret = "refresh-secret-path";
    mocks.apiPostFetch
      .mockResolvedValueOnce(
        JSON.stringify({
          qrcode,
          qrcode_img_content: "https://login.example.test/refresh-qr",
        }),
      )
      .mockRejectedValueOnce(Object.assign(new Error(secret), { code: "ENOENT" }));
    mocks.apiGetFetch.mockResolvedValueOnce(JSON.stringify({ status: "expired" }));

    const start = await startWeixinLoginWithQr({
      accountId: "refresh-session",
      apiBaseUrl: "https://ignored.example.test",
    });
    const result = await waitForWeixinLogin({
      sessionKey: start.sessionKey,
      apiBaseUrl: "https://ignored.example.test",
    });

    expect(result).toEqual({
      connected: false,
      message: "刷新二维码失败，请稍后重试。",
    });
    expect(getLogs()).toContain("Error(code=ENOENT)");
    expect(getLogs()).not.toContain(secret);
  });

  it("sanitizes polling failures before timing out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T00:00:00Z"));
    const secret = "polling-secret-url";
    mocks.apiPostFetch.mockResolvedValueOnce(
      JSON.stringify({
        qrcode: "polling-qrcode",
        qrcode_img_content: "https://login.example.test/polling-qr",
      }),
    );
    mocks.apiGetFetch.mockRejectedValue(Object.assign(new Error(secret), { code: "ECONNRESET" }));

    const start = await startWeixinLoginWithQr({
      accountId: "polling-session",
      apiBaseUrl: "https://ignored.example.test",
    });
    const pending = waitForWeixinLogin({
      sessionKey: start.sessionKey,
      apiBaseUrl: "https://ignored.example.test",
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    expect(result).toEqual({
      connected: false,
      message: "登录超时，请重试。",
    });
    expect(getLogs()).toContain("Error(code=ECONNRESET)");
    expect(getLogs()).not.toContain(secret);
  });
});
