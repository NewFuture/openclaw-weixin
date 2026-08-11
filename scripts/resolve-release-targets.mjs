import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NPM_PACKAGE_NAME = "openclaw-weixin";
const NPM_REGISTRY = "https://registry.npmjs.org";
const CLAWHUB_CLI_VERSION = "0.23.3";
const CLAWHUB_PACKAGE_NAME = "openclaw-wechat";
const CLAWHUB_OWNER = "newfuture";
const PLUGIN_ID = "openclaw-weixin";
const SOURCE_REPOSITORY = "NewFuture/openclaw-weixin";

export function runReleaseCommand(command, args, options = {}) {
  let executable = command;
  let executableArgs = args;
  if (process.platform === "win32") {
    const commandParts = [`${command}.cmd`, ...args];
    if (commandParts.some((part) => !/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(part))) {
      throw new Error(`refusing to pass an unsafe argument to ${command}.cmd`);
    }
    executable = process.env.ComSpec ?? "cmd.exe";
    executableArgs = ["/d", "/s", "/c", commandParts.join(" ")];
  }
  const result = spawnSync(executable, executableArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env,
    },
  });
  if (result.error) {
    throw new Error(`could not run ${command}: ${result.error.message}`);
  }
  return {
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function commandFailure(command, args, result) {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`;
  return new Error(`${command} ${args.join(" ")} failed: ${detail}`);
}

function runRequired(run, command, args, options) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw commandFailure(command, args, result);
  }
  return result.stdout.trim();
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`);
  }
}

function inspectExactNpmTarget({ run, version }) {
  const exactArgs = ["view", `${NPM_PACKAGE_NAME}@${version}`, "version", `--registry=${NPM_REGISTRY}`];
  const exactResult = run("npm", exactArgs);
  if (exactResult.status === 0) {
    const publishedVersion = exactResult.stdout.trim();
    assertEqual(publishedVersion, version, "npmjs version");
    return {
      published: true,
      version: publishedVersion,
    };
  }
  if (!/E404|404 Not Found/i.test(exactResult.stderr)) {
    throw commandFailure("npm", exactArgs, exactResult);
  }
  return {
    published: false,
    version: null,
  };
}

export function inspectNpmTarget({ run, version }) {
  const exactTarget = inspectExactNpmTarget({ run, version });
  if (exactTarget.published) {
    return exactTarget;
  }

  const latestVersion = runRequired(run, "npm", [
    "view",
    `${NPM_PACKAGE_NAME}@latest`,
    "version",
    `--registry=${NPM_REGISTRY}`,
  ]);
  runRequired(run, "npm", ["run", "check:versions"], {
    env: {
      RELEASE_PREVIOUS_VERSION: latestVersion,
    },
  });
  return {
    latestVersion,
    published: false,
    version: null,
  };
}

function validateClawHubInspection(inspection, expected) {
  assertEqual(inspection.package?.name, CLAWHUB_PACKAGE_NAME, "ClawHub package name");
  assertEqual(inspection.owner?.handle, CLAWHUB_OWNER, "ClawHub owner");
  assertEqual(inspection.version?.version, expected.version, "ClawHub version");

  const verification = inspection.version?.verification;
  assertEqual(verification?.sourceRepo, expected.sourceRepo, "ClawHub source repository");
  assertEqual(verification?.sourceCommit, expected.sourceCommit, "ClawHub source commit");
  assertEqual(verification?.sourceTag, expected.sourceRef, "ClawHub source ref");
  assertEqual(inspection.file?.path, "openclaw.plugin.json", "ClawHub runtime manifest path");

  const manifest = parseJson(inspection.file?.content ?? "", "ClawHub runtime manifest");
  assertEqual(manifest.id, PLUGIN_ID, "ClawHub runtime plugin id");
  assertEqual(manifest.version, expected.version, "ClawHub runtime plugin version");
  if (!Array.isArray(manifest.channels) || manifest.channels.length !== 1 || manifest.channels[0] !== PLUGIN_ID) {
    throw new Error(
      `ClawHub runtime channel ids mismatch: expected ${JSON.stringify([PLUGIN_ID])}, found ${JSON.stringify(
        manifest.channels,
      )}`,
    );
  }

  return {
    owner: inspection.owner.handle,
    packageName: inspection.package.name,
    runtimeIdentity: {
      channels: manifest.channels,
      id: manifest.id,
      version: manifest.version,
    },
    source: {
      commit: verification.sourceCommit,
      ref: verification.sourceTag,
      repository: verification.sourceRepo,
    },
    version: inspection.version.version,
  };
}

export function inspectClawHubTarget({ run, sourceCommit, sourceRef, sourceRepo, version }) {
  const baseArgs = ["--yes", `clawhub@${CLAWHUB_CLI_VERSION}`, "package", "inspect", CLAWHUB_PACKAGE_NAME];
  const exactArgs = [...baseArgs, "--version", version, "--file", "openclaw.plugin.json", "--json"];
  const exactResult = run("npx", exactArgs);
  if (exactResult.status !== 0) {
    const errorLines = `${exactResult.stderr}\n${exactResult.stdout}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^Error:\s*/, "").replace(/\s+\(reset in \d+s\)$/, ""));
    if (errorLines.length === 0 || errorLines.some((line) => line !== "Version not found")) {
      throw commandFailure("npx", exactArgs, exactResult);
    }
    return {
      packageName: CLAWHUB_PACKAGE_NAME,
      published: false,
      version: null,
    };
  }

  const inspection = parseJson(exactResult.stdout.trim(), "ClawHub exact-version inspection");
  return {
    ...validateClawHubInspection(inspection, {
      sourceCommit,
      sourceRef,
      sourceRepo,
      version,
    }),
    published: true,
  };
}

export function resolveReleaseTargets({
  run = runReleaseCommand,
  scope = "all",
  sourceCommit,
  sourceRef,
  sourceRepo,
  version,
}) {
  if (!["all", "clawhub", "npmjs"].includes(scope)) {
    throw new Error(`release target scope must be all, clawhub, or npmjs, found ${JSON.stringify(scope)}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    throw new Error(`release version must be a stable semantic version, found ${JSON.stringify(version)}`);
  }
  assertEqual(sourceRepo, SOURCE_REPOSITORY, "release source repository");
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) {
    throw new Error(`release source commit must be a full lowercase Git SHA, found ${JSON.stringify(sourceCommit)}`);
  }
  assertEqual(sourceRef, `refs/tags/v${version}`, "release ref");
  const npmjs = scope === "all" || scope === "npmjs" ? inspectNpmTarget({ run, version }) : undefined;
  const clawHub =
    scope === "all" || scope === "clawhub"
      ? inspectClawHubTarget({
          run,
          sourceCommit,
          sourceRef,
          sourceRepo,
          version,
        })
      : undefined;
  return {
    ...(clawHub ? { clawHub } : {}),
    ...(npmjs ? { npmjs } : {}),
    publicationRequired: (npmjs ? !npmjs.published : false) || (clawHub ? !clawHub.published : false),
    targetVersion: version,
  };
}

function appendOutputs(outputPath, result) {
  appendFileSync(
    outputPath,
    [
      ...(result.npmjs ? [`npmjs_published=${String(result.npmjs.published)}`] : []),
      ...(result.clawHub ? [`clawhub_published=${String(result.clawHub.published)}`] : []),
      `publication_required=${String(result.publicationRequired)}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function main() {
  try {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const result = resolveReleaseTargets({
      scope: process.env.RELEASE_TARGETS_SCOPE ?? "all",
      sourceCommit: process.env.GITHUB_SHA,
      sourceRef: process.env.GITHUB_REF,
      sourceRepo: process.env.GITHUB_REPOSITORY,
      version: packageJson.version,
    });
    if (process.env.RELEASE_TARGETS_REPORT) {
      writeFileSync(path.resolve(process.env.RELEASE_TARGETS_REPORT), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    }
    if (process.env.GITHUB_OUTPUT) {
      appendOutputs(process.env.GITHUB_OUTPUT, result);
    }
    console.log(
      [
        result.npmjs ? `npmjs=${result.npmjs.published ? "published" : "missing"}` : null,
        result.clawHub ? `ClawHub=${result.clawHub.published ? "published and matched" : "missing"}` : null,
      ]
        .filter(Boolean)
        .join(", ")
        .replace(/^/, "Release targets: ")
        .concat("."),
    );
  } catch (error) {
    console.error(`Release target resolution failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
