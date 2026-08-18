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
  vi.clearAllMocks();
});

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
    const logs = [
      ...mocks.logger.info.mock.calls,
      ...mocks.logger.debug.mock.calls,
      ...mocks.logger.warn.mock.calls,
      ...mocks.logger.error.mock.calls,
    ]
      .flat()
      .join(" ");
    for (const sensitive of [qrcode, qrcodeUrl, botToken, accountId, sessionKey]) {
      expect(logs).not.toContain(sensitive);
    }
  });
});
