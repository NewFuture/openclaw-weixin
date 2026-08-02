import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createGitHubPackageManifest,
  GITHUB_PACKAGE_NAME,
  GITHUB_PACKAGE_REGISTRY,
  prepareGitHubPackage,
} from "./prepare-github-package.mjs";

const temporaryDirectories = [];

function canonicalManifest() {
  return {
    name: "openclaw-weixin",
    version: "3.1.0",
    repository: {
      type: "git",
      url: "git+https://github.com/NewFuture/openclaw-weixin.git",
    },
    openclaw: {
      install: {
        npmSpec: "openclaw-weixin",
        minHostVersion: ">=2026.6.1",
      },
      channel: {
        id: "openclaw-weixin",
      },
    },
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org/",
    },
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("GitHub package preparation", () => {
  it("changes only registry-specific package metadata", () => {
    const source = canonicalManifest();
    const result = createGitHubPackageManifest(source);

    expect(result).toEqual({
      ...source,
      name: GITHUB_PACKAGE_NAME,
      openclaw: {
        ...source.openclaw,
        install: {
          ...source.openclaw.install,
          npmSpec: GITHUB_PACKAGE_NAME,
        },
      },
      publishConfig: {
        registry: GITHUB_PACKAGE_REGISTRY,
      },
    });
    expect(source).toEqual(canonicalManifest());
    expect(result.openclaw.channel.id).toBe("openclaw-weixin");
  });

  it("writes the transformed manifest into the staged package", () => {
    const directory = mkdtempSync(join(tmpdir(), "openclaw-weixin-github-package-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, "package.json"), JSON.stringify(canonicalManifest()), "utf8");

    const result = prepareGitHubPackage(directory);

    expect(JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))).toEqual(result);
    expect(result.name).toBe(GITHUB_PACKAGE_NAME);
  });

  it("rejects a non-canonical source package", () => {
    expect(() => createGitHubPackageManifest({ ...canonicalManifest(), name: "@other/package" })).toThrow(
      'expected canonical package name openclaw-weixin, found "@other/package"',
    );
    expect(() =>
      createGitHubPackageManifest({
        ...canonicalManifest(),
        openclaw: {
          ...canonicalManifest().openclaw,
          install: {
            ...canonicalManifest().openclaw.install,
            npmSpec: "@other/package",
          },
        },
      }),
    ).toThrow("canonical openclaw.install.npmSpec must match the npmjs package name");
  });
});
