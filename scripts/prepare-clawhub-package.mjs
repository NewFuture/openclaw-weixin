import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extract, list } from "tar";

import { prepareStagedPackageVariant } from "./package-variant.mjs";

export const CLAWHUB_PACKAGE_NAME = "openclaw-wechat";
export const CLAWHUB_INSTALL_SPEC = `clawhub:${CLAWHUB_PACKAGE_NAME}`;

const SAFE_ARCHIVE_ENTRY_TYPES = new Set(["File", "OldFile", "Directory"]);

async function resolveSourceArchive(source) {
  const resolvedSource = path.resolve(source);
  const sourceStat = await stat(resolvedSource);
  if (sourceStat.isFile()) {
    return resolvedSource;
  }
  if (!sourceStat.isDirectory()) {
    throw new Error(`canonical package source must be a .tgz file or directory: ${resolvedSource}`);
  }

  const archives = (await readdir(resolvedSource)).filter((entry) => entry.endsWith(".tgz")).sort();
  if (archives.length !== 1) {
    throw new Error(`canonical package directory must contain exactly one .tgz file, found ${archives.length}`);
  }
  return path.join(resolvedSource, archives[0]);
}

export async function extractPackageArchive(sourceArchive, outputDirectory) {
  const entries = [];
  let validationError;
  await list({
    file: sourceArchive,
    strict: true,
    onReadEntry(entry) {
      if (entry.meta || validationError) return;
      const normalized = entry.path.replaceAll("\\", "/");
      const segments = normalized.split("/").filter(Boolean);
      if (!SAFE_ARCHIVE_ENTRY_TYPES.has(entry.type) || entry.invalid || entry.unsupported) {
        validationError = new Error(
          `canonical package archive contains an unsupported entry type ${entry.type}: ${entry.path}`,
        );
        return;
      }
      if (normalized.startsWith("/") || segments[0] !== "package" || segments.some((segment) => segment === "..")) {
        validationError = new Error(`canonical package archive contains an unsafe path: ${entry.path}`);
        return;
      }
      entries.push(entry.path);
    },
  });
  if (validationError) {
    throw validationError;
  }
  if (entries.length === 0) {
    throw new Error("canonical package archive is empty");
  }

  await mkdir(outputDirectory, { recursive: true });
  await extract({
    cwd: outputDirectory,
    file: sourceArchive,
    preserveOwner: false,
    preservePaths: false,
    strict: true,
    unlink: true,
  });
  return path.join(outputDirectory, "package");
}

export async function prepareClawHubPackage(source, outputDirectory = process.cwd()) {
  const sourceArchive = await resolveSourceArchive(source);
  const stagingRoot = await mkdtemp(path.join(tmpdir(), "openclaw-clawhub-"));
  try {
    const packageDirectory = await extractPackageArchive(sourceArchive, stagingRoot);
    return await prepareStagedPackageVariant(packageDirectory, path.resolve(outputDirectory), {
      name: CLAWHUB_PACKAGE_NAME,
      install: {
        clawhubSpec: CLAWHUB_INSTALL_SPEC,
        defaultChoice: "clawhub",
      },
    });
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function main() {
  const [source, outputDirectory] = process.argv.slice(2);
  if (!source) {
    throw new Error(
      "usage: node scripts/prepare-clawhub-package.mjs <canonical-package.tgz-or-directory> [output-directory]",
    );
  }
  const archivePath = await prepareClawHubPackage(source, outputDirectory);
  console.log(archivePath);
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedUrl) {
  try {
    await main();
  } catch (error) {
    console.error(`ClawHub package preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
