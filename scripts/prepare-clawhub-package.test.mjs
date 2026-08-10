import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

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
    packageDirectory,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("ClawHub package preparation", () => {
  it("changes only the package name and ClawHub install choice", async () => {
    const source = await createCanonicalArchive();
    const outputDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-output-");
    const extractionDirectory = createTemporaryDirectory("openclaw-weixin-clawhub-extract-");

    const npmExecPath = process.env.npm_execpath;
    delete process.env.npm_execpath;
    let archive;
    try {
      archive = await prepareClawHubPackage(source.archive, outputDirectory);
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
