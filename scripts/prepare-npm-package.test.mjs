import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createNpmReadmeVariant, prepareNpmPackage } from "./prepare-npm-package.mjs";
import {
  assertRegistryPromptOrder,
  assertRegistryReadmeOrder,
  preferRegistryPromptSource,
  preferRegistryReadmeSource,
  REGISTRY_README_FILES,
} from "./registry-readme.mjs";

const readReadme = (fileName) => readFile(new URL(`../${fileName}`, import.meta.url), "utf8");

describe("npm package README preparation", () => {
  it("creates npm-first README variants from ClawHub-first sources", async () => {
    for (const fileName of REGISTRY_README_FILES) {
      const variant = createNpmReadmeVariant(await readReadme(fileName), fileName);
      expect(assertRegistryReadmeOrder(variant, "npm", { fileName }).order).toEqual(["npm", "clawhub"]);
      expect(assertRegistryPromptOrder(variant, "npm", { fileName }).order).toEqual(["npm", "clawhub"]);
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
    const fileName = REGISTRY_README_FILES[0];
    const markdown = transform(await readReadme(fileName), fileName);
    expect(() => createNpmReadmeVariant(markdown, fileName)).toThrow(`${fileName}: ${expected}`);
  });

  it("does not overwrite its source archive", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "openclaw-npm-overwrite-"));
    const sourceArchive = path.join(directory, "openclaw-weixin-3.1.6.tgz");
    await writeFile(sourceArchive, "");
    try {
      await expect(prepareNpmPackage(sourceArchive, directory)).rejects.toThrow(
        "npm output directory must differ from the source archive directory",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
