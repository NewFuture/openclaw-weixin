import { describe, expect, it } from "vitest";

import { readNpmPackFilename } from "./package-variant.mjs";

describe("npm pack report", () => {
  it("reads the filename from an npm 10 array report", () => {
    expect(readNpmPackFilename(JSON.stringify([{ filename: "openclaw-weixin-3.2.3.tgz" }]))).toBe(
      "openclaw-weixin-3.2.3.tgz",
    );
  });

  it("reads the filename from an npm 12 object report", () => {
    expect(readNpmPackFilename(JSON.stringify({ "openclaw-weixin": { filename: "openclaw-weixin-3.2.3.tgz" } }))).toBe(
      "openclaw-weixin-3.2.3.tgz",
    );
  });

  it("rejects a report that does not name exactly one archive", () => {
    expect(() => readNpmPackFilename(JSON.stringify([]))).toThrow(/exactly one package archive/);
    expect(() => readNpmPackFilename(JSON.stringify({ a: {}, b: {} }))).toThrow(/exactly one package archive/);
  });
});
