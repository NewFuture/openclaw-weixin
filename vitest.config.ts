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
        // Minimum observed baseline across supported Node.js 22 and 24 after
        // adding channel, account, monitor, and inbound orchestration.
        // Re-baselined for vitest 4.x / @vitest/coverage-v8 4.x, which
        // instruments more branch points than the 3.x series.
        lines: 73,
        branches: 65,
        functions: 72,
        statements: 74,
        "src/channel.ts": {
          lines: 20,
          branches: 15,
          functions: 13,
          statements: 20,
        },
        "src/auth/accounts.ts": {
          lines: 71,
          branches: 51,
          functions: 85,
          statements: 71,
        },
        "src/messaging/process-message.ts": {
          lines: 43,
          branches: 29,
          functions: 22,
          statements: 42,
        },
        "src/monitor/monitor.ts": {
          lines: 64,
          branches: 54,
          functions: 55,
          statements: 63,
        },
      },
    },
  },
});
