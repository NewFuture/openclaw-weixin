import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createNpmReadmeVariant } from "./prepare-npm-package.mjs";
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
});
