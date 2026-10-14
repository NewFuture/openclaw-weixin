import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REMOVED_SUBPATHS = [
  "openclaw/plugin-sdk/infra-runtime",
  "openclaw/plugin-sdk/channel-message",
  "openclaw/plugin-sdk/command-auth",
  "openclaw/plugin-sdk/config-runtime",
];

function sourceFiles(directory: string, extension: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      files.push(...sourceFiles(fullPath, extension));
      continue;
    }
    if (fullPath.endsWith(extension) && !fullPath.endsWith(".test.ts")) files.push(fullPath);
  }
  return files;
}

describe("OpenClaw 2026.10 SDK subpaths", () => {
  const productionFiles = [path.join(ROOT, "index.ts"), ...sourceFiles(path.join(ROOT, "src"), ".ts")];
  const scriptFiles = sourceFiles(path.join(ROOT, "scripts"), ".mjs");

  it("does not statically import SDK subpaths removed in OpenClaw 2026.10.1", () => {
    const offenders: string[] = [];
    for (const file of [...productionFiles, ...scriptFiles]) {
      const source = readFileSync(file, "utf8");
      for (const specifier of REMOVED_SUBPATHS) {
        if (source.includes(`from "${specifier}"`) || source.includes(`import("${specifier}")`)) {
          offenders.push(`${path.relative(ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the typed replacements and does not ban every plugin-sdk import", () => {
    const source = productionFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).toContain('from "openclaw/plugin-sdk/core"');
    expect(source).toContain('from "openclaw/plugin-sdk/temp-path"');
    expect(source).toContain('from "openclaw/plugin-sdk/channel-outbound"');
    expect(source).toContain('from "openclaw/plugin-sdk/channel-ingress-runtime"');
    expect(source).toContain("openclaw/plugin-sdk/file-lock");
    expect(source).not.toContain('from "openclaw/plugin-sdk/infra-runtime"');
  });
});
