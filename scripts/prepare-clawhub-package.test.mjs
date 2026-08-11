import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { packPackageDirectory } from "./package-variant.mjs";
import {
  CLAWHUB_INSTALL_SPEC,
  CLAWHUB_PACKAGE_NAME,
  extractPackageArchive,
  prepareClawHubPackage,
} from "./prepare-clawhub-package.mjs";

const temporaryDirectories = [];

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
    files: ["index.ts", "dist/", "openclaw.plugin.json", "payload.txt"],
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

async function createCanonicalArchive(updateManifest = (manifest) => manifest) {
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

  it("changes only the package name and ClawHub install choice", async () => {
    const source = await createCanonicalArchive();
    const outputDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-output-");
    const extractionDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-extract-");

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
    const extractedPackage = await extractPackageArchive(archive, extractionDirectory);
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
    expect(JSON.parse(readFileSync(join(source.packageDirectory, "package.json"), "utf8"))).toEqual(
      canonicalManifest(),
    );
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
