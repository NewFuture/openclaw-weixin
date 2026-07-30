import { afterEach, describe, expect, it, vi } from "vitest";

import { redactToken } from "../util/redact.js";

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

function loggedText(): string {
  return [mocks.logger.info, mocks.logger.debug, mocks.logger.warn, mocks.logger.error]
    .flatMap((fn) => fn.mock.calls.flat())
    .join("\n");
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("QR login lifecycle", () => {
  it("starts a QR session and returns confirmed credentials", async () => {
    const qrcode = "synthetic-qrcode-canary";
    const qrcodeUrl = `https://login.example.test/scan?qrcode=${qrcode}`;
    const botToken = "synthetic-bot-token-canary";
    const accountId = "synthetic-bot-account-canary";
    const userId = "synthetic-user-account-canary";
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
        ilink_user_id: userId,
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
      userId,
    });
    expect(mocks.apiPostFetch).toHaveBeenCalledWith({
      baseUrl: "https://ilinkai.weixin.qq.com",
      endpoint: "ilink/bot/get_bot_qrcode?bot_type=3",
      body: JSON.stringify({ local_token_list: [] }),
      label: "fetchQRCode",
      logBodies: false,
    });
    expect(mocks.apiGetFetch).toHaveBeenCalledWith({
      baseUrl: "https://ilinkai.weixin.qq.com",
      endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      timeoutMs: 35_000,
      label: "pollQRStatus",
      logBodies: false,
    });
    expect(loggedText()).toContain(`ilink_bot_id=${redactToken(accountId)}`);
    expect(loggedText()).not.toContain(qrcode);
    expect(loggedText()).not.toContain(qrcodeUrl);
    expect(loggedText()).not.toContain(botToken);
    expect(loggedText()).not.toContain(accountId);
    expect(loggedText()).not.toContain(userId);
  });

  it("redacts session keys when no login is active", async () => {
    const sessionKey = "synthetic-session-key-canary";

    await expect(
      waitForWeixinLogin({
        sessionKey,
        apiBaseUrl: "https://ignored.example.test",
      }),
    ).resolves.toMatchObject({ connected: false });

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      `waitForWeixinLogin: no active login sessionKey=${redactToken(sessionKey)}`,
    );
    expect(loggedText()).not.toContain(sessionKey);
  });
});
