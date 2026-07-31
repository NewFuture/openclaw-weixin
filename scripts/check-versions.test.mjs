import { describe, expect, it } from "vitest";

import {
  assertReleaseTag,
  assertVersionIncrease,
  checkVersionMetadata,
  findReleaseTransition,
} from "./check-versions.mjs";

function validMetadata() {
  return {
    packageJson: { version: "3.0.0" },
    packageLock: {
      version: "3.0.0",
      packages: { "": { version: "3.0.0" } },
    },
    pluginManifest: { version: "3.0.0" },
    chineseChangelog: "## [未发布]\n\n## [3.0.0] - 2026-07-31\n",
    englishChangelog: "## [Unreleased]\n\n## [3.0.0] - 2026-07-31\n",
  };
}

describe("checkVersionMetadata", () => {
  it("accepts aligned release metadata", () => {
    expect(checkVersionMetadata(validMetadata())).toEqual({
      releaseDate: "2026-07-31",
      tag: "v3.0.0",
      version: "3.0.0",
    });
  });

  it("rejects mismatched lockfile and plugin versions", () => {
    const lockfileMismatch = validMetadata();
    lockfileMismatch.packageLock.version = "2.4.6";
    expect(() => checkVersionMetadata(lockfileMismatch)).toThrow(
      'package-lock.json version "2.4.6" does not match package.json version 3.0.0',
    );

    const rootPackageMismatch = validMetadata();
    rootPackageMismatch.packageLock.packages[""].version = "2.4.6";
    expect(() => checkVersionMetadata(rootPackageMismatch)).toThrow(
      'package-lock.json root package version "2.4.6" does not match package.json version 3.0.0',
    );

    const pluginMismatch = validMetadata();
    pluginMismatch.pluginManifest.version = "2.4.6";
    expect(() => checkVersionMetadata(pluginMismatch)).toThrow(
      'openclaw.plugin.json version "2.4.6" does not match package.json version 3.0.0',
    );
  });

  it("requires matching bilingual changelog releases", () => {
    const metadata = validMetadata();
    metadata.englishChangelog = "## [Unreleased]\n\n## [3.0.0] - 2026-08-01\n";
    expect(() => checkVersionMetadata(metadata)).toThrow(
      "changelog release dates do not match for 3.0.0: 2026-07-31 and 2026-08-01",
    );
  });

  it("requires a stable semantic version", () => {
    const metadata = validMetadata();
    metadata.packageJson.version = "3.0.0-rc.1";
    expect(() => checkVersionMetadata(metadata)).toThrow(
      'package.json must use a stable MAJOR.MINOR.PATCH version, found "3.0.0-rc.1"',
    );
  });
});

describe("release version transition", () => {
  it("pins a release to the first commit that introduced its version", () => {
    expect(
      findReleaseTransition(
        [
          { commit: "same-version-fix", version: "3.0.0" },
          { commit: "release-transition", version: "3.0.0" },
          { commit: "previous-release", version: "2.4.6" },
        ],
        "3.0.0",
      ),
    ).toEqual({
      previousVersion: "2.4.6",
      releaseCommit: "release-transition",
    });
  });

  it("requires the release version to increase", () => {
    expect(() => assertVersionIncrease("2.4.6", "3.0.0")).not.toThrow();
    expect(() => assertVersionIncrease("3.0.0", "3.0.0")).toThrow(
      "release version must increase from 3.0.0, found 3.0.0",
    );
    expect(() => assertVersionIncrease("3.1.0", "3.0.0")).toThrow(
      "release version must increase from 3.1.0, found 3.0.0",
    );
  });

  it("requires the release tag to match the version", () => {
    expect(() => assertReleaseTag("v3.0.0", "3.0.0")).not.toThrow();
    expect(() => assertReleaseTag("v2.4.6", "3.0.0")).toThrow("release tag must be v3.0.0, found v2.4.6");
  });
});
