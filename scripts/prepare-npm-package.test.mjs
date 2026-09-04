import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareNpmReadmes } from "./prepare-npm-package.mjs";
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

const temporaryDirectories = [];

async function createReadmeDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "openclaw-npm-readmes-"));
  temporaryDirectories.push(directory);
  await Promise.all(
    REGISTRY_README_FILES.map(async (fileName) => {
      const markdown = await readFile(new URL(`../${fileName}`, import.meta.url), "utf8");
      await writeFile(path.join(directory, fileName), markdown, "utf8");
    }),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("npm package README preparation", () => {
  it("creates npm-first README variants from ClawHub-first sources", async () => {
    const directory = await createReadmeDirectory();
    await prepareNpmReadmes(directory);

    for (const fileName of REGISTRY_README_FILES) {
      const markdown = await readFile(path.join(directory, fileName), "utf8");
      expect(assertRegistryReadmeTitle(markdown, "npm", { fileName })).toBe("openclaw-weixin");
      expect(assertRegistryReadmeOrder(markdown, "npm", { fileName }).order).toEqual(["npm", "clawhub"]);
      expect(assertRegistryPromptOrder(markdown, "npm", { fileName }).order).toEqual(["npm", "clawhub"]);
      expect(() => assertRegistryReadmeInstallCommands(markdown, { fileName })).not.toThrow();
      expect(() => assertRegistryReadmeLinksAbsolute(markdown, { fileName })).not.toThrow();
    }
  });

  it.each([
    {
      label: "direct blocks",
      transform: (markdown, fileName) => preferRegistryReadmeSource(markdown, "npm", { fileName }),
      expected: "expected clawhub source first, found npm",
    },
    {
      label: "prompt",
      transform: (markdown, fileName) => preferRegistryPromptSource(markdown, "npm", { fileName }),
      expected: "expected clawhub prompt source first, found npm",
    },
  ])("rejects npm-first source $label", async ({ transform, expected }) => {
    const directory = await createReadmeDirectory();
    const fileName = REGISTRY_README_FILES[0];
    const filePath = path.join(directory, fileName);
    await writeFile(filePath, transform(await readFile(filePath, "utf8"), fileName), "utf8");

    await expect(prepareNpmReadmes(directory)).rejects.toThrow(`${fileName}: ${expected}`);
  });
});
