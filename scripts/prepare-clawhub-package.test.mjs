import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { packPackageDirectory } from "./package-variant.mjs";
import {
  CLAWHUB_INSTALL_SPEC,
  CLAWHUB_PACKAGE_NAME,
  CLAWHUB_README_LAYOUT,
  extractPackageArchive,
  prepareClawHubPackage,
} from "./prepare-clawhub-package.mjs";
import { prepareNpmPackage } from "./prepare-npm-package.mjs";
import {
  assertRegistryPrompt,
  assertRegistryPromptOrder,
  assertRegistryReadmeLinksAbsolute,
  assertRegistryReadmeOrder,
  preferRegistryReadmeSource,
  preferRegistryReadmeTitle,
  REGISTRY_README_FILES,
  registryPromptMarker,
  registrySourceMarker,
} from "./registry-readme.mjs";

const temporaryDirectories = [];
const PACKAGED_README_FILES = [...REGISTRY_README_FILES, "README.zh_CN.md"];
const CHINESE_REDIRECT_README =
  "# openclaw-weixin\n\n中文文档已移至 [在线文档](https://openclaw-weixin.newfuture.cc/)。\n";

function createTemporaryDirectory(label) {
  const directory = mkdtempSync(join(tmpdir(), label));
  temporaryDirectories.push(directory);
  return directory;
}

function writeTarField(header, offset, length, value) {
  const field = Buffer.from(value, "utf8");
  if (field.length > length) {
    throw new Error(`tar field exceeds ${length} bytes: ${value}`);
  }
  field.copy(header, offset);
}

function createTarArchive(entries) {
  const blocks = [];
  for (const { contents = "", linkName = "", name, type = "0" } of entries) {
    const body = Buffer.from(contents, "utf8");
    const header = Buffer.alloc(512);
    writeTarField(header, 0, 100, name);
    writeTarField(header, 100, 8, "0000644\0");
    writeTarField(header, 108, 8, "0000000\0");
    writeTarField(header, 116, 8, "0000000\0");
    writeTarField(header, 124, 12, `${body.length.toString(8).padStart(11, "0")}\0`);
    writeTarField(header, 136, 12, "00000000000\0");
    header.fill(0x20, 148, 156);
    writeTarField(header, 156, 1, type);
    writeTarField(header, 157, 100, linkName);
    writeTarField(header, 257, 6, "ustar\0");
    writeTarField(header, 263, 2, "00");

    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeTarField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
    blocks.push(header, body, padding);
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function writeTarArchive(entries) {
  const archivePath = join(createTemporaryDirectory("openclaw-weixin-clawhub-tar-"), "fixture.tgz");
  writeFileSync(archivePath, createTarArchive(entries));
  return archivePath;
}

function canonicalManifest() {
  return {
    name: "openclaw-weixin",
    version: "3.1.0",
    type: "module",
    files: ["index.ts", "dist/", "openclaw.plugin.json", "README.md", "README_EN.md", "README.zh_CN.md", "payload.txt"],
    repository: {
      type: "git",
      url: "git+https://github.com/NewFuture/openclaw-weixin.git",
    },
    peerDependencies: {
      openclaw: ">=2026.6.1",
    },
    devDependencies: {
      openclaw: "2026.7.1",
    },
    openclaw: {
      compat: {
        pluginApi: ">=2026.6.1",
      },
      build: {
        openclawVersion: "2026.7.1",
      },
      extensions: ["./index.ts"],
      runtimeExtensions: ["./dist/index.js"],
      channel: {
        id: "openclaw-weixin",
        aliases: ["openclaw-wechat"],
        docsPath: "https://openclaw-weixin.newfuture.cc/",
      },
      install: {
        npmSpec: "openclaw-weixin",
        defaultChoice: "npm",
        minHostVersion: ">=2026.6.1",
      },
    },
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org/",
    },
  };
}

function canonicalReadme(language) {
  const isEnglish = language === "en";
  return [
    "# openclaw-weixin",
    "",
    registryPromptMarker("start"),
    isEnglish ? "## Let OpenClaw choose a source" : "## 让 OpenClaw 选择来源",
    "",
    "`clawhub:openclaw-wechat`",
    "`npm:openclaw-weixin`",
    "`openclaw plugins update openclaw-weixin`",
    isEnglish ? "Use `--force` when the target source is npm." : "目标来源为 npm 时使用 `--force`。",
    registryPromptMarker("end"),
    "",
    registrySourceMarker("clawhub", "start"),
    isEnglish ? "## ClawHub" : "## ClawHub",
    "",
    "`openclaw plugins install clawhub:openclaw-wechat`",
    registrySourceMarker("clawhub", "end"),
    "",
    registrySourceMarker("npm", "start"),
    isEnglish ? "## npm" : "## npm",
    "",
    "`openclaw plugins install npm:openclaw-weixin`",
    registrySourceMarker("npm", "end"),
    "",
    `[${isEnglish ? "Guide" : "指南"}](https://openclaw-weixin.newfuture.cc/${isEnglish ? "en/" : ""}guide.html)`,
    "",
  ].join("\n");
}

function canonicalReadmes() {
  return {
    "README.md": canonicalReadme("zh"),
    "README_EN.md": canonicalReadme("en"),
  };
}

const pluginManifest = {
  id: "openclaw-weixin",
  name: "WeChat",
  version: "3.1.0",
  channels: ["openclaw-weixin"],
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
};

async function createCanonicalArchive(updateManifest = (manifest) => manifest, updateReadmes = (readmes) => readmes) {
  const packageDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-source-");
  const archiveDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-canonical-");
  mkdirSync(join(packageDirectory, "dist"));
  writeFileSync(join(packageDirectory, "index.ts"), "export default {};\n", "utf8");
  writeFileSync(join(packageDirectory, "dist", "index.js"), "export default {};\n", "utf8");
  writeFileSync(join(packageDirectory, "payload.txt"), "payload\n", "utf8");
  writeFileSync(
    join(packageDirectory, "package.json"),
    `${JSON.stringify(updateManifest(canonicalManifest()), null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(packageDirectory, "openclaw.plugin.json"), `${JSON.stringify(pluginManifest, null, 2)}\n`, "utf8");
  const readmes = updateReadmes(canonicalReadmes());
  for (const fileName of REGISTRY_README_FILES) {
    writeFileSync(join(packageDirectory, fileName), readmes[fileName], "utf8");
  }
  writeFileSync(join(packageDirectory, "README.zh_CN.md"), CHINESE_REDIRECT_README, "utf8");
  return {
    archive: await packPackageDirectory(packageDirectory, archiveDirectory),
    archiveDirectory,
    packageDirectory,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("ClawHub package preparation", () => {
  it("extracts valid nested paths below the package root", async () => {
    const archive = writeTarArchive([{ name: "package/nested/payload.txt", contents: "nested payload\n" }]);
    const extractionDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-safe-extract-");

    const packageDirectory = await extractPackageArchive(archive, extractionDirectory);

    expect(readFileSync(join(packageDirectory, "nested", "payload.txt"), "utf8")).toBe("nested payload\n");
  });

  it("rejects parent traversal before extracting the archive", async () => {
    const archive = writeTarArchive([{ name: "package/../outside.txt", contents: "must not escape\n" }]);
    const extractionDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-unsafe-extract-");

    await expect(extractPackageArchive(archive, extractionDirectory)).rejects.toThrow(
      "canonical package archive contains an unsafe path: package/../outside.txt",
    );
    expect(existsSync(join(extractionDirectory, "outside.txt"))).toBe(false);
  });

  it("rejects symbolic links before they can modify an external target", async () => {
    const targetDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-link-target-");
    const targetPath = join(targetDirectory, "package.json");
    writeFileSync(targetPath, "original target\n", "utf8");
    const archive = writeTarArchive([
      {
        name: "package/package.json",
        type: "2",
        linkName: targetPath.replaceAll("\\", "/"),
      },
    ]);
    const extractionDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-link-extract-");

    await expect(extractPackageArchive(archive, extractionDirectory)).rejects.toThrow(
      "canonical package archive contains an unsupported entry type SymbolicLink: package/package.json",
    );
    expect(readFileSync(targetPath, "utf8")).toBe("original target\n");
    expect(existsSync(join(extractionDirectory, "package", "package.json"))).toBe(false);
  });

  for (const [type, entryType] of [
    ["1", "Link"],
    ["3", "CharacterDevice"],
    ["4", "BlockDevice"],
    ["6", "FIFO"],
  ]) {
    it(`rejects ${entryType} archive entries`, async () => {
      const entryPath = `package/unsafe-${type}`;
      const archive = writeTarArchive([{ name: entryPath, type, linkName: type === "1" ? "package/target" : "" }]);

      await expect(
        extractPackageArchive(archive, createTemporaryDirectory("openclaw-weixin-clawhub-type-extract-")),
      ).rejects.toThrow(`canonical package archive contains an unsupported entry type ${entryType}: ${entryPath}`);
    });
  }

  it("rejects an empty archive", async () => {
    const archive = writeTarArchive([]);

    await expect(
      extractPackageArchive(archive, createTemporaryDirectory("openclaw-weixin-clawhub-empty-extract-")),
    ).rejects.toThrow("TAR_BAD_ARCHIVE");
  });

  it("requires exactly one archive in a source directory", async () => {
    const emptyDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-empty-source-");
    await expect(
      prepareClawHubPackage(emptyDirectory, createTemporaryDirectory("openclaw-weixin-clawhub-output-")),
    ).rejects.toThrow("canonical package directory must contain exactly one .tgz file, found 0");

    const multipleDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-multiple-source-");
    writeFileSync(join(multipleDirectory, "first.tgz"), "");
    writeFileSync(join(multipleDirectory, "second.tgz"), "");
    await expect(
      prepareClawHubPackage(multipleDirectory, createTemporaryDirectory("openclaw-weixin-clawhub-output-")),
    ).rejects.toThrow("canonical package directory must contain exactly one .tgz file, found 2");
  });

  it("makes the primary ClawHub README English and every staged variant ClawHub-first", async () => {
    const source = await createCanonicalArchive();
    const outputDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-output-");
    const extractionDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-extract-");
    const npmOutputDirectory = createTemporaryDirectory("openclaw-weixin-npm-output-");
    const npmExtractionDirectory = createTemporaryDirectory("openclaw-weixin-npm-extract-");
    const canonicalExtractionDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-canonical-extract-");
    const originalReadmes = Object.fromEntries(
      PACKAGED_README_FILES.map((fileName) => [
        fileName,
        readFileSync(join(source.packageDirectory, fileName), "utf8"),
      ]),
    );

    const npmExecPath = process.env.npm_execpath;
    delete process.env.npm_execpath;
    let archive;
    try {
      archive = await prepareClawHubPackage(source.archiveDirectory, outputDirectory);
    } finally {
      if (npmExecPath === undefined) {
        delete process.env.npm_execpath;
      } else {
        process.env.npm_execpath = npmExecPath;
      }
    }
    const npmArchive = await prepareNpmPackage(source.archiveDirectory, npmOutputDirectory);
    const extractedPackage = await extractPackageArchive(archive, extractionDirectory);
    const extractedNpmPackage = await extractPackageArchive(npmArchive, npmExtractionDirectory);
    const extractedCanonicalPackage = await extractPackageArchive(source.archive, canonicalExtractionDirectory);
    const variantManifest = JSON.parse(readFileSync(join(extractedPackage, "package.json"), "utf8"));
    const expectedManifest = canonicalManifest();
    expectedManifest.name = CLAWHUB_PACKAGE_NAME;
    expectedManifest.openclaw.install.clawhubSpec = CLAWHUB_INSTALL_SPEC;
    expectedManifest.openclaw.install.defaultChoice = "clawhub";

    expect(basename(archive)).toBe(`${CLAWHUB_PACKAGE_NAME}-3.1.0.tgz`);
    expect(variantManifest).toEqual(expectedManifest);
    expect(JSON.parse(readFileSync(join(extractedPackage, "openclaw.plugin.json"), "utf8"))).toEqual(pluginManifest);
    expect(variantManifest.openclaw.install.npmSpec).toBe("openclaw-weixin");
    expect(variantManifest.openclaw.channel.id).toBe("openclaw-weixin");
    expect(variantManifest.openclaw.channel.aliases).toEqual(["openclaw-wechat"]);
    expect(variantManifest.openclaw.channel.docsPath).toBe("https://openclaw-weixin.newfuture.cc/");
    expect(JSON.parse(readFileSync(join(source.packageDirectory, "package.json"), "utf8"))).toEqual(
      canonicalManifest(),
    );
    const expectedVariants = Object.fromEntries(
      REGISTRY_README_FILES.map((fileName) => [
        fileName,
        preferRegistryReadmeTitle(originalReadmes[fileName], "clawhub", { fileName }),
      ]),
    );
    for (const [targetFileName, sourceFileName] of Object.entries(CLAWHUB_README_LAYOUT)) {
      const stagedReadme = readFileSync(join(extractedPackage, targetFileName), "utf8");
      expect(stagedReadme).toBe(expectedVariants[sourceFileName]);
    }
    expect(readFileSync(join(extractedPackage, "README.md"), "utf8")).toBe(
      readFileSync(join(extractedPackage, "README_EN.md"), "utf8"),
    );
    expect(readFileSync(join(extractedPackage, "README.md"), "utf8")).not.toBe(
      readFileSync(join(extractedPackage, "README.zh_CN.md"), "utf8"),
    );
    expect(basename(npmArchive)).toBe("openclaw-weixin-3.1.0.tgz");
    expect(JSON.parse(readFileSync(join(extractedNpmPackage, "package.json"), "utf8"))).toEqual(canonicalManifest());
    for (const fileName of REGISTRY_README_FILES) {
      const npmReadme = readFileSync(join(extractedNpmPackage, fileName), "utf8");
      expect(assertRegistryReadmeOrder(npmReadme, "npm", { fileName }).order).toEqual(["npm", "clawhub"]);
      expect(assertRegistryPromptOrder(npmReadme, "npm", { fileName }).order).toEqual(["npm", "clawhub"]);
    }
    for (const fileName of REGISTRY_README_FILES) {
      const canonicalArchiveReadme = readFileSync(join(extractedCanonicalPackage, fileName), "utf8");
      expect(readFileSync(join(source.packageDirectory, fileName), "utf8")).toBe(originalReadmes[fileName]);
      expect(canonicalArchiveReadme).toBe(originalReadmes[fileName]);
    }
    expect(readFileSync(join(source.packageDirectory, "README.zh_CN.md"), "utf8")).toBe(CHINESE_REDIRECT_README);
    expect(readFileSync(join(extractedCanonicalPackage, "README.zh_CN.md"), "utf8")).toBe(CHINESE_REDIRECT_README);
  }, 90_000);

  it.each([
    {
      label: "missing marker",
      mutate: (readme) => readme.replace(registrySourceMarker("clawhub", "end"), ""),
      expected: "clawhub source markers must appear exactly once",
    },
    {
      label: "missing prompt marker",
      mutate: (readme) => readme.replace(registryPromptMarker("end"), ""),
      expected: "prompt markers must appear exactly once",
    },
    {
      label: "missing noninteractive npm confirmation",
      mutate: (readme) => readme.replace("`--force`", "noninteractive npm confirmation"),
      expected: "shared prompt must describe `--force` exactly once (found 0)",
    },
    {
      label: "force scoped to ClawHub",
      mutate: (readme) => readme.replace("target source is npm", "target source is ClawHub"),
      expected: "shared prompt must scope `--force` to npm",
    },
    {
      label: "full CLI inside the natural-language prompt",
      mutate: (readme) =>
        readme.replace(
          registryPromptMarker("start"),
          `${registryPromptMarker("start")}\nOpEnClAw  plugins\tinstall npm:openclaw-weixin --force`,
        ),
      expected: "shared prompt must describe installation in natural language, not embed a full CLI",
    },
    {
      label: "suffixed prompt spec",
      mutate: (readme) => readme.replace("`npm:openclaw-weixin`", "`npm:openclaw-weixin-typo`"),
      expected: "shared prompt must include `npm:openclaw-weixin` exactly once (found 0)",
    },
    {
      label: "missing update command",
      mutate: (readme) => readme.replace("`openclaw plugins update openclaw-weixin`", "update the existing plugin"),
      expected: "shared prompt must include `openclaw plugins update openclaw-weixin` exactly once (found 0)",
    },
    {
      label: "duplicate marker",
      mutate: (readme) =>
        readme.replace(
          registrySourceMarker("npm", "start"),
          `${registrySourceMarker("npm", "start")}\n${registrySourceMarker("npm", "start")}`,
        ),
      expected: "npm source markers must appear exactly once",
    },
    {
      label: "content between source blocks",
      mutate: (readme) =>
        readme.replace(
          `${registrySourceMarker("clawhub", "end")}\n\n${registrySourceMarker("npm", "start")}`,
          `${registrySourceMarker("clawhub", "end")}\nnot movable\n${registrySourceMarker("npm", "start")}`,
        ),
      expected: "registry source blocks must be adjacent and separated only by whitespace",
    },
    {
      label: "nested source blocks",
      mutate: () =>
        [
          "# openclaw-weixin",
          "",
          registrySourceMarker("npm", "start"),
          "npm",
          registrySourceMarker("clawhub", "start"),
          "clawhub",
          registrySourceMarker("npm", "end"),
          registrySourceMarker("clawhub", "end"),
          "",
        ].join("\n"),
      expected: "registry source blocks overlap or are nested",
    },
    {
      label: "swapped source commands",
      mutate: (readme) => {
        const promptEnd = registryPromptMarker("end");
        const promptEndIndex = readme.indexOf(promptEnd) + promptEnd.length;
        return (
          readme.slice(0, promptEndIndex) +
          readme
            .slice(promptEndIndex)
            .replaceAll("npm:openclaw-weixin", "registry-command-placeholder")
            .replaceAll("clawhub:openclaw-wechat", "npm:openclaw-weixin")
            .replaceAll("registry-command-placeholder", "clawhub:openclaw-wechat")
        );
      },
      expected: "npm source block must include `openclaw plugins install npm:openclaw-weixin` exactly once (found 0)",
    },
    {
      label: "duplicate direct command",
      mutate: (readme) => {
        const promptEnd = registryPromptMarker("end");
        const promptEndIndex = readme.indexOf(promptEnd) + promptEnd.length;
        const command = "openclaw plugins install npm:openclaw-weixin";
        return (
          readme.slice(0, promptEndIndex) +
          readme.slice(promptEndIndex).replace(`\`${command}\``, `\`${command}\`\n\`${command}\``)
        );
      },
      expected: "npm source block must include `openclaw plugins install npm:openclaw-weixin` exactly once (found 2)",
    },
    {
      label: "forced direct command",
      mutate: (readme) => {
        const promptEnd = registryPromptMarker("end");
        const promptEndIndex = readme.indexOf(promptEnd) + promptEnd.length;
        const command = "openclaw plugins install npm:openclaw-weixin";
        return (
          readme.slice(0, promptEndIndex) +
          readme.slice(promptEndIndex).replace(`\`${command}\``, `\`${command}\`\n\`${command} --force\``)
        );
      },
      expected: "npm source block must not include `openclaw plugins install npm:openclaw-weixin --force`",
    },
    {
      label: "direct command with appended shell command",
      mutate: (readme) => {
        const promptEnd = registryPromptMarker("end");
        const promptEndIndex = readme.indexOf(promptEnd) + promptEnd.length;
        const command = "openclaw plugins install npm:openclaw-weixin";
        return (
          readme.slice(0, promptEndIndex) +
          readme.slice(promptEndIndex).replace(command, `${command} && echo unexpected`)
        );
      },
      expected: "npm source block must include `openclaw plugins install npm:openclaw-weixin` exactly once (found 0)",
    },
    {
      label: "relative Markdown link",
      mutate: (readme) => `${readme}[Broken guide](../docs/en/guide.md)\n`,
      expected: 'link target must be absolute or fragment-only: "../docs/en/guide.md"',
    },
    {
      label: "relative HTML link",
      mutate: (readme) => `${readme}<a href="./docs/en/guide.md">Broken guide</a>\n`,
      expected: 'link target must be absolute or fragment-only: "./docs/en/guide.md"',
    },
  ])("rejects $label in a localized README", async ({ mutate, expected }) => {
    const source = await createCanonicalArchive(undefined, (readmes) => ({
      ...readmes,
      "README_EN.md": mutate(readmes["README_EN.md"]),
    }));

    await expect(
      prepareClawHubPackage(source.archive, createTemporaryDirectory("openclaw-weixin-clawhub-rejected-")),
    ).rejects.toThrow(`README_EN.md: ${expected}`);
  });

  it("accepts absolute, mail, and fragment-only registry links", () => {
    const readme = `${canonicalReadme("en")}\n[Section](#section)\n[Support](mailto:support@example.test)\n<a href="https://example.test/docs">Docs</a>\n`;

    expect(assertRegistryReadmeLinksAbsolute(readme, { fileName: "README_EN.md" })).toEqual([
      "https://openclaw-weixin.newfuture.cc/en/guide.html",
      "#section",
      "mailto:support@example.test",
      "https://example.test/docs",
    ]);
  });

  it("allows the npm force explanation to wrap within a sentence", () => {
    const readme = canonicalReadme("en").replace("target source is npm", "target\nsource is npm");
    expect(() => assertRegistryPrompt(readme, { fileName: "README_EN.md" })).not.toThrow();
  });

  it.each([
    ["dot-relative Markdown", "[Guide](./docs/en/guide.md)", "./docs/en/guide.md"],
    ["parent-relative Markdown", "[Guide](../docs/en/guide.md)", "../docs/en/guide.md"],
    ["bare Markdown", "[Changelog](CHANGELOG.md)", "CHANGELOG.md"],
    ["linked-image Markdown", "[![Build](https://example.test/badge.svg)](docs/en/guide.md)", "docs/en/guide.md"],
    ["even-backslash inline Markdown", "[x\\\\](docs/en/guide.md)", "docs/en/guide.md"],
    ["escaped-bracket reference Markdown", "[foo\\]]: docs/en/guide.md", "docs/en/guide.md"],
    ["multiline reference Markdown", "[foo\nbar]: docs/en/guide.md", "docs/en/guide.md"],
    ["three-line reference Markdown", "[foo\nbar\nbaz]: docs/en/guide.md", "docs/en/guide.md"],
    ["blockquote reference Markdown", "> [guide]: docs/en/guide.md\n> [guide]", "docs/en/guide.md"],
    ["list reference Markdown", "- [guide]: docs/en/guide.md\n- [guide]", "docs/en/guide.md"],
    ["quoted HTML", '<a href="./docs/en/guide.md">Guide</a>', "./docs/en/guide.md"],
    ["multiline quoted HTML", '<a href="docs/en/\nguide.md">Guide</a>', "docs/en/\nguide.md"],
    [
      "HTML after an unmatched quote",
      '<!-- href="https://example.test -->\n<a href="docs/en/guide.md">Guide</a>',
      "docs/en/guide.md",
    ],
    ["unquoted HTML", "<a href=docs/en/guide.md>Guide</a>", "docs/en/guide.md"],
    ["fenced-code Markdown", "````text\n[Guide](docs/en/guide.md)\n````", "docs/en/guide.md"],
    ["fence-like raw HTML", '<div>\n```text\n<a href="docs/en/guide.md">Guide</a>\n```\n</div>', "docs/en/guide.md"],
  ])("rejects %s links", (_label, link, target) => {
    expect(() =>
      assertRegistryReadmeLinksAbsolute(`${canonicalReadme("en")}\n${link}\n`, {
        fileName: "README_EN.md",
      }),
    ).toThrow(`README_EN.md: link target must be absolute or fragment-only: ${JSON.stringify(target)}`);
  });

  it("does not interpret an odd-backslash escaped bracket as an inline link", () => {
    expect(() =>
      assertRegistryReadmeLinksAbsolute(`${canonicalReadme("en")}\n[x\\](docs/en/guide.md)\n`, {
        fileName: "README_EN.md",
      }),
    ).not.toThrow();
  });

  it("rejects a source package whose README is npm-first", async () => {
    const source = await createCanonicalArchive(undefined, (readmes) => ({
      ...readmes,
      "README.md": preferRegistryReadmeSource(readmes["README.md"], "npm", {
        fileName: "README.md",
      }),
    }));

    await expect(
      prepareClawHubPackage(source.archive, createTemporaryDirectory("openclaw-weixin-clawhub-rejected-")),
    ).rejects.toThrow("README.md: expected clawhub source first, found npm");
  });

  it("rejects a canonical package whose README already uses the ClawHub title", async () => {
    const source = await createCanonicalArchive(undefined, (readmes) => ({
      ...readmes,
      "README_EN.md": preferRegistryReadmeTitle(readmes["README_EN.md"], "clawhub", {
        fileName: "README_EN.md",
      }),
    }));

    await expect(
      prepareClawHubPackage(source.archive, createTemporaryDirectory("openclaw-weixin-clawhub-rejected-")),
    ).rejects.toThrow("README_EN.md: expected title openclaw-weixin, found openclaw-wechat");
  });

  it("rejects a shared prompt that omits one package source", async () => {
    const source = await createCanonicalArchive(undefined, (readmes) => ({
      ...readmes,
      "README_EN.md": readmes["README_EN.md"].replace("`clawhub:openclaw-wechat`", "`npm:openclaw-weixin`"),
    }));

    await expect(
      prepareClawHubPackage(source.archive, createTemporaryDirectory("openclaw-weixin-clawhub-rejected-")),
    ).rejects.toThrow("README_EN.md: shared prompt must include `npm:openclaw-weixin` exactly once (found 2)");
  });

  it("rejects a tarball whose source package name is not canonical", async () => {
    const source = await createCanonicalArchive((manifest) => ({
      ...manifest,
      name: "@other/package",
    }));

    await expect(
      prepareClawHubPackage(source.archive, createTemporaryDirectory("openclaw-weixin-clawhub-rejected-")),
    ).rejects.toThrow('expected canonical package name openclaw-weixin, found "@other/package"');
  });

  it("rejects a canonical package with a different npm install spec", async () => {
    const source = await createCanonicalArchive((manifest) => ({
      ...manifest,
      openclaw: {
        ...manifest.openclaw,
        install: {
          ...manifest.openclaw.install,
          npmSpec: "@other/package",
        },
      },
    }));

    await expect(
      prepareClawHubPackage(source.archive, createTemporaryDirectory("openclaw-weixin-clawhub-rejected-")),
    ).rejects.toThrow("canonical openclaw.install.npmSpec must match the npmjs package name");
  });
});
