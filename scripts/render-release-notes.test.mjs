import { describe, expect, it } from "vitest";

import { extractReleaseNotesSection, renderReleaseNotes } from "./render-release-notes.mjs";

const chineseChangelog = `# 变更日志

## [未发布]

### 变更

- 后续变更。

## [3.1.0] - 2026-08-02

### 新增

- 新功能。

### 修复

- 已修复问题。

## [3.0.0] - 2026-07-31

- 旧版本。
`;

const englishChangelog = `# Changelog

## [Unreleased]

### Changed

- A later change.

## [3.1.0] - 2026-08-02

### Added

- A new feature.

### Fixed

- A fixed issue.

## [3.0.0] - 2026-07-31

- An older release.
`;

describe("release notes rendering", () => {
  it("extracts only the requested release section", () => {
    expect(extractReleaseNotesSection(englishChangelog, "CHANGELOG_EN.md", "3.1.0")).toBe(
      "### Added\n\n- A new feature.\n\n### Fixed\n\n- A fixed issue.",
    );
  });

  it("renders the matching Chinese and English sections", () => {
    expect(renderReleaseNotes({ version: "3.1.0", chineseChangelog, englishChangelog })).toBe(`## 简体中文

### 新增

- 新功能。

### 修复

- 已修复问题。

## English

### Added

- A new feature.

### Fixed

- A fixed issue.
`);
  });

  it("rejects a missing or empty release section", () => {
    expect(() => extractReleaseNotesSection(englishChangelog, "CHANGELOG_EN.md", "4.0.0")).toThrow(
      "CHANGELOG_EN.md must contain a release heading for 4.0.0",
    );
    expect(() =>
      extractReleaseNotesSection("## [3.1.0] - 2026-08-02\n\n## [3.0.0] - 2026-07-31\n", "CHANGELOG_EN.md", "3.1.0"),
    ).toThrow("CHANGELOG_EN.md release notes for 3.1.0 must not be empty");
  });
});
