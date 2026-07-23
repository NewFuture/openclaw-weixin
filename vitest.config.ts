import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        // Type-only declarations do not contain executable behavior.
        "src/**/*.test.ts",
        "src/api/types.ts",
        "src/vendor.d.ts",
        // Host/UI integration needs dedicated runtime harnesses in a later ratchet.
        "src/util/logger.ts",
        "src/auth/login-qr.ts",
        // Media transport and crypto fallbacks need deterministic binary fixtures.
        "src/media/media-download.ts",
        "src/cdn/pic-decrypt.ts",
        "src/cdn/aes-ecb.ts",
        "src/cdn/cdn-url.ts",
      ],
      thresholds: {
        // Honest baseline after adding channel, account, monitor, and inbound
        // orchestration to coverage. Ratchet these values upward only.
        lines: 75,
        branches: 83,
        functions: 76,
        statements: 75,
        "src/channel.ts": {
          lines: 35,
          branches: 77,
          functions: 14,
          statements: 35,
        },
        "src/auth/accounts.ts": {
          lines: 73,
          branches: 77,
          functions: 85,
          statements: 73,
        },
        "src/messaging/process-message.ts": {
          lines: 47,
          branches: 52,
          functions: 22,
          statements: 47,
        },
        "src/monitor/monitor.ts": {
          lines: 67,
          branches: 52,
          functions: 83,
          statements: 67,
        },
      },
    },
  },
});
