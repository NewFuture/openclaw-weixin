import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { checkVersionFiles } from "./check-versions.mjs";
import { prepareRelease, renderReleasePullRequest } from "./prepare-release.mjs";
import { renderReleaseNotesFiles } from "./render-release-notes.mjs";

const temporaryDirectories = [];
const template = readFileSync(new URL("../.github/pull_request_template.md", import.meta.url), "utf8");
const releaseFiles = ["package.json", "package-lock.json", "openclaw.plugin.json", "CHANGELOG.md", "CHANGELOG_EN.md"];
const previousVersion = "3.9.9";
const version = "3.10.0";
const releaseDate = "2026-10-15";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "openclaw-weixin-release-"));
  temporaryDirectories.push(directory);
  const files = {
    "package.json": `${JSON.stringify(
      {
        name: "openclaw-weixin",
        version: previousVersion,
        dependencies: { example: previousVersion },
        peerDependencies: { openclaw: ">=2026.6.1" },
      },
      null,
      2,
    )}\n`,
    "package-lock.json": `${JSON.stringify(
      {
        version: previousVersion,
        lockfileVersion: 3,
        packages: {
          "": { version: previousVersion, dependencies: { example: previousVersion } },
          "node_modules/example": { version: previousVersion, integrity: "synthetic-integrity" },
        },
      },
      null,
      2,
    )}\n`,
    "openclaw.plugin.json": `{\n  "id": "openclaw-weixin",\n  "version": "${previousVersion}",\n  "channels": ["openclaw-weixin"]\n}\n`,
    "CHANGELOG.md": `# 变更日志\n\n## [未发布]\n\n### 修复\n\n- 合成修复。\n\n## [${previousVersion}] - 2026-10-01\n\n- 旧版本。\n`,
    "CHANGELOG_EN.md": `# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- A synthetic fix.\n\n## [${previousVersion}] - 2026-10-01\n\n- An older release.\n`,
  };
  for (const [filename, contents] of Object.entries(files)) {
    writeFileSync(join(directory, filename), contents);
  }
  return { directory, files };
}

function readReleaseFiles(directory) {
  return Object.fromEntries(
    releaseFiles.map((filename) => [filename, readFileSync(join(directory, filename), "utf8")]),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("release preparation", () => {
  it("updates exactly the five release files and preserves dependencies, identity, and all changelog entries", () => {
    const { directory, files } = fixture();

    expect(prepareRelease(directory, version, releaseDate)).toEqual({ previousVersion, version });
    expect(readdirSync(directory).sort()).toEqual([...releaseFiles].sort());
    const result = readReleaseFiles(directory);
    for (const filename of releaseFiles.slice(0, 3)) {
      const expected = JSON.parse(files[filename]);
      expected.version = version;
      if (filename === "package-lock.json") expected.packages[""].version = version;
      expect(JSON.parse(result[filename])).toEqual(expected);
    }
    expect(result["openclaw.plugin.json"]).toBe(files["openclaw.plugin.json"].replace(previousVersion, version));
    for (const [filename, heading] of [
      ["CHANGELOG.md", "## [未发布]"],
      ["CHANGELOG_EN.md", "## [Unreleased]"],
    ]) {
      expect(result[filename]).toBe(
        files[filename].replace(`${heading}\n`, `${heading}\n\n## [${version}] - ${releaseDate}\n`),
      );
    }
    expect(checkVersionFiles(directory)).toEqual({ version, releaseDate, tag: `v${version}` });
    expect(renderReleaseNotesFiles(directory)).toBe(
      "## 简体中文\n\n### 修复\n\n- 合成修复。\n\n## English\n\n### Fixed\n\n- A synthetic fix.\n",
    );
  });

  it.each(["3.9.10", "3.10.0", "4.0.0"])("accepts the numeric version increase %s", (target) => {
    const { directory } = fixture();
    expect(prepareRelease(directory, target, releaseDate).version).toBe(target);
    expect(checkVersionFiles(directory).version).toBe(target);
  });

  it.each([undefined, "", "v3.10.0", "03.10.0", "3.10.0-beta.1", "3.10.0+build", "3.10.0\ninvalid", "3.9.9", "3.9.8"])(
    "rejects invalid, unchanged, or decreasing version %s without writing files",
    (target) => {
      const { directory, files } = fixture();
      expect(() => prepareRelease(directory, target, releaseDate)).toThrow();
      expect(readReleaseFiles(directory)).toEqual(files);
    },
  );

  it.each([
    ["CHANGELOG.md", "## [未发布]", "### 修复\n\n- 合成修复。"],
    ["CHANGELOG_EN.md", "## [Unreleased]", "### Fixed\n\n- A synthetic fix."],
  ])("rejects missing, empty, or misplaced Unreleased in %s before any write", (filename, heading, notes) => {
    const { directory, files } = fixture();
    for (const contents of [
      files[filename].replace(heading, "## [Other]"),
      files[filename].replace(notes, ""),
      files[filename].replace(notes, "### Fixed"),
      `## [0.1.0] - 2026-01-01\n\n- Earlier section.\n\n${files[filename]}`,
    ]) {
      writeFileSync(join(directory, filename), contents);
      const before = readReleaseFiles(directory);
      expect(() => prepareRelease(directory, version, releaseDate)).toThrow(/Unreleased|release notes/);
      expect(readReleaseFiles(directory)).toEqual(before);
    }
  });

  it.each(["CHANGELOG.md", "CHANGELOG_EN.md"])(
    "rejects an existing target release in %s without writing files",
    (filename) => {
      const { directory, files } = fixture();
      writeFileSync(
        join(directory, filename),
        `${files[filename]}\n## [${version}] - 2026-10-02\n\n- Existing release.\n`,
      );
      const before = readReleaseFiles(directory);
      expect(() => prepareRelease(directory, version, releaseDate)).toThrow(/already contains/);
      expect(readReleaseFiles(directory)).toEqual(before);
    },
  );

  it("rejects inconsistent source metadata without partially updating it", () => {
    const { directory, files } = fixture();
    writeFileSync(
      join(directory, "openclaw.plugin.json"),
      files["openclaw.plugin.json"].replace(previousVersion, "3.9.8"),
    );
    const before = readReleaseFiles(directory);
    expect(() => prepareRelease(directory, version, releaseDate)).toThrow(/does not match/);
    expect(readReleaseFiles(directory)).toEqual(before);
  });

  it("preserves CRLF changelog content and previous release sections", () => {
    const { directory, files } = fixture();
    for (const filename of ["CHANGELOG.md", "CHANGELOG_EN.md"]) {
      writeFileSync(join(directory, filename), files[filename].replaceAll("\n", "\r\n"));
    }
    prepareRelease(directory, version, releaseDate);
    for (const [filename, heading] of [
      ["CHANGELOG.md", "## [未发布]"],
      ["CHANGELOG_EN.md", "## [Unreleased]"],
    ]) {
      expect(readFileSync(join(directory, filename), "utf8")).toBe(
        files[filename]
          .replace(`${heading}\n`, `${heading}\n\n## [${version}] - ${releaseDate}\n`)
          .replaceAll("\n", "\r\n"),
      );
    }
  });

  it("runs the CLI without installed packages and renders a template-based PR body", () => {
    const { directory } = fixture();
    mkdirSync(join(directory, ".github"));
    writeFileSync(join(directory, ".github", "pull_request_template.md"), template);
    const body = execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./prepare-release.mjs", import.meta.url)), version],
      { cwd: directory, encoding: "utf8" },
    );
    expect(checkVersionFiles(directory).version).toBe(version);
    expect(body).toContain(`Prepare release ${version}`);
    expect(body).toContain(`node scripts/prepare-release.mjs ${version}`);
    expect(body).toContain("Not run");
    expect(body).not.toContain("[x]");
    for (const pattern of [/^#{2,3} .+$/gm, /<!--[\s\S]*?-->/g, /^- \[ \] .+$/gm]) {
      expect(body.match(pattern)).toEqual(template.match(pattern));
    }
  });

  it("fails explicitly when the PR template is missing a required section", () => {
    expect(() => renderReleasePullRequest(template.replace("## 验收标准", "## Removed"), version)).toThrow(/template/);
  });

  it.each([
    [false, version, "file operation failed (ENOENT)"],
    [true, previousVersion, "release version must increase"],
  ])("fails the CLI without writes or raw paths (template: %s, version: %s)", (hasTemplate, target, error) => {
    const { directory, files } = fixture();
    if (hasTemplate) {
      mkdirSync(join(directory, ".github"));
      writeFileSync(join(directory, ".github", "pull_request_template.md"), template);
    }
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./prepare-release.mjs", import.meta.url)), target],
      { cwd: directory, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`Release preparation failed: ${error}`);
    expect(result.stderr).not.toContain(directory);
    expect(result.stderr).not.toContain("at run");
    expect(readReleaseFiles(directory)).toEqual(files);
  });
});
