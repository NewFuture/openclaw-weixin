import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareStagedPackageVariant } from "./package-variant.mjs";
import { extractPackageArchive, resolveSourceArchive } from "./prepare-clawhub-package.mjs";
import {
  assertRegistryPromptOrder,
  assertRegistryReadmeInstallCommands,
  assertRegistryReadmeLinksAbsolute,
  assertRegistryReadmeOrder,
  assertRegistryReadmeTitle,
  preferRegistryPromptSource,
  preferRegistryReadmeSource,
  REGISTRY_README_FILES,
} from "./registry-readme.mjs";

export function createNpmReadmeVariant(markdown, fileName) {
  assertRegistryReadmeTitle(markdown, "npm", { fileName });
  assertRegistryReadmeOrder(markdown, "clawhub", { fileName });
  assertRegistryPromptOrder(markdown, "clawhub", { fileName });
  assertRegistryReadmeInstallCommands(markdown, { fileName });
  assertRegistryReadmeLinksAbsolute(markdown, { fileName });
  return preferRegistryPromptSource(preferRegistryReadmeSource(markdown, "npm", { fileName }), "npm", { fileName });
}

export async function prepareNpmReadmes(packageDirectory) {
  await Promise.all(
    REGISTRY_README_FILES.map(async (fileName) => {
      const filePath = path.join(packageDirectory, fileName);
      const markdown = await readFile(filePath, "utf8");
      await writeFile(filePath, createNpmReadmeVariant(markdown, fileName), "utf8");
    }),
  );
}

export async function prepareNpmPackage(source, outputDirectory = process.cwd()) {
  const sourceArchive = await resolveSourceArchive(source);
  const stagingRoot = await mkdtemp(path.join(tmpdir(), "openclaw-npm-"));
  try {
    const packageDirectory = await extractPackageArchive(sourceArchive, stagingRoot);
    await prepareNpmReadmes(packageDirectory);
    return await prepareStagedPackageVariant(packageDirectory, path.resolve(outputDirectory), {
      name: "openclaw-weixin",
    });
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function main() {
  const [source, outputDirectory] = process.argv.slice(2);
  if (!source) {
    throw new Error("usage: node scripts/prepare-npm-package.mjs <source-package.tgz-or-directory> [output-directory]");
  }
  const archivePath = await prepareNpmPackage(source, outputDirectory);
  console.log(archivePath);
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedUrl) {
  try {
    await main();
  } catch (error) {
    console.error(`npm package preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
