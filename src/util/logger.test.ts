import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

afterEach(() => {
  vi.doUnmock("openclaw/plugin-sdk/infra-runtime");
  vi.resetModules();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("logger account scope", () => {
  it("masks the account identifier in persisted logger names and messages", async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-logger-"));
    tempDirs.push(logDir);
    vi.doMock("openclaw/plugin-sdk/infra-runtime", () => ({
      resolvePreferredOpenClawTmpDir: () => logDir,
    }));

    const { logger, setLogLevel } = await import("./logger.js");
    setLogLevel("INFO");
    logger.withAccount("account-secret-1").info("monitor started");

    const persisted = fs.readFileSync(logger.getLogFilePath(), "utf8");
    expect(persisted).not.toContain("account-secret-1");
    expect(persisted).toContain("****(len=16)");
    expect(persisted).toContain("monitor started");
  });
});
