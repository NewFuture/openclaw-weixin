import { describe, expect, it } from "vitest";

import { checkOverrideEffects, checkRegistrySources } from "./check-lockfile.mjs";

function lockfile() {
  return {
    packages: {
      "": { name: "openclaw-weixin", version: "3.0.1" },
      "node_modules/openclaw": {
        version: "2026.7.1",
        resolved: "https://registry.npmjs.org/openclaw/-/openclaw-2026.7.1.tgz",
        integrity: "sha512-openclaw",
      },
      "node_modules/openclaw/node_modules/tar": {
        version: "7.5.19",
        resolved: "https://registry.npmjs.org/tar/-/tar-7.5.19.tgz",
        integrity: "sha512-tar",
      },
      "node_modules/postcss": {
        version: "8.5.25",
        resolved: "https://registry.npmjs.org/postcss/-/postcss-8.5.25.tgz",
        integrity: "sha512-postcss",
      },
    },
  };
}

describe("checkOverrideEffects", () => {
  it("accepts a lockfile without overrides", () => {
    expect(checkOverrideEffects({ packageJson: {}, packageLock: lockfile() })).toEqual([]);
  });

  it("accepts an override the lockfile actually applies", () => {
    const packageLock = lockfile();
    packageLock.packages["node_modules/postcss"].version = "8.5.25";
    expect(checkOverrideEffects({ packageJson: { overrides: { postcss: "8.5.25" } }, packageLock })).toEqual([
      { name: "postcss", paths: ["node_modules/postcss"], version: "8.5.25" },
    ]);
  });

  it("rejects an override npm drops because openclaw ships a shrinkwrap", () => {
    expect(() =>
      checkOverrideEffects({ packageJson: { overrides: { tar: "7.5.21" } }, packageLock: lockfile() }),
    ).toThrow(
      "overrides.tar pins 7.5.21 but package-lock.json node_modules/openclaw/node_modules/tar resolves 7.5.19: node_modules/openclaw ships an npm-shrinkwrap.json that npm applies instead of overrides",
    );
  });

  it("rejects an override the refreshed lockfile silently reverted", () => {
    expect(() =>
      checkOverrideEffects({ packageJson: { overrides: { postcss: "8.5.26" } }, packageLock: lockfile() }),
    ).toThrow(
      "overrides.postcss pins 8.5.26 but package-lock.json node_modules/postcss resolves 8.5.25: the lockfile was refreshed without the override",
    );
  });

  it("rejects ranges and unused overrides", () => {
    expect(() =>
      checkOverrideEffects({ packageJson: { overrides: { tar: "^7.5.21" } }, packageLock: lockfile() }),
    ).toThrow('overrides.tar must pin an exact MAJOR.MINOR.PATCH version, found "^7.5.21"');
    expect(() =>
      checkOverrideEffects({ packageJson: { overrides: { hono: "4.12.34" } }, packageLock: lockfile() }),
    ).toThrow("overrides.hono does not match any package-lock.json entry; remove the unused override");
  });
});

describe("checkRegistrySources", () => {
  it("counts entries when every tarball comes from the public registry", () => {
    expect(checkRegistrySources({ packageLock: lockfile() })).toBe(4);
  });

  it("rejects mirror tarballs that only resolve inside one network", () => {
    const packageLock = lockfile();
    packageLock.packages["node_modules/postcss"].resolved =
      "https://mirror.example.com/_packaging/npm-public/npm/registry/postcss/-/postcss-8.5.25.tgz";
    expect(() => checkRegistrySources({ packageLock })).toThrow(
      "package-lock.json node_modules/postcss resolves https://mirror.example.com/_packaging/npm-public/npm/registry/postcss/-/postcss-8.5.25.tgz instead of https://registry.npmjs.org/",
    );
  });

  it("rejects weakened integrity hashes", () => {
    const packageLock = lockfile();
    packageLock.packages["node_modules/postcss"].integrity = "sha1-Ovh4KtCMPHbTfrLmL08V9E7O9Vw=";
    expect(() => checkRegistrySources({ packageLock })).toThrow(
      'package-lock.json node_modules/postcss must record a sha512 integrity, found "sha1-Ovh4KtCMPHbTfrLmL08V9E7O9Vw="',
    );
  });
});
