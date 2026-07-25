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

function loggedText(): string {
  return [mocks.logger.info, mocks.logger.debug, mocks.logger.warn, mocks.logger.error]
    .flatMap((fn) => fn.mock.calls.flat())
    .join("\n");
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("QR login privacy", () => {
  it("does not log QR contents, bot tokens, or complete account identifiers", async () => {
    const qrCanary = "qr-secret-canary-219e";
    const qrUrlCanary = `https://login.example.test/scan?qrcode=${qrCanary}`;
    const botTokenCanary = "bot-token-canary-37bd";
    const accountCanary = "bot-account-canary-49c0";
    const sessionKey = "synthetic-session-key";
    mocks.apiPostFetch.mockResolvedValue(
      JSON.stringify({
        qrcode: qrCanary,
        qrcode_img_content: qrUrlCanary,
      }),
    );
    mocks.apiGetFetch.mockResolvedValue(
      JSON.stringify({
        status: "confirmed",
        bot_token: botTokenCanary,
        ilink_bot_id: accountCanary,
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

    expect(result).toMatchObject({
      connected: true,
      botToken: botTokenCanary,
      accountId: accountCanary,
    });
    expect(loggedText()).not.toContain(qrCanary);
    expect(loggedText()).not.toContain(qrUrlCanary);
    expect(loggedText()).not.toContain(botTokenCanary);
    expect(loggedText()).not.toContain(accountCanary);
  });
});
