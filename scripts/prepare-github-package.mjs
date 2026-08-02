import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const GITHUB_PACKAGE_NAME = "@newfuture/openclaw-weixin";
export const GITHUB_PACKAGE_REGISTRY = "https://npm.pkg.github.com";

export function createGitHubPackageManifest(packageJson) {
  if (packageJson?.name !== "openclaw-weixin") {
    throw new Error(`expected canonical package name openclaw-weixin, found ${JSON.stringify(packageJson?.name)}`);
  }
  if (packageJson.openclaw?.install?.npmSpec !== packageJson.name) {
    throw new Error("canonical openclaw.install.npmSpec must match the npmjs package name");
  }

  const publishConfig = { ...packageJson.publishConfig };
  delete publishConfig.access;
  publishConfig.registry = GITHUB_PACKAGE_REGISTRY;

  return {
    ...packageJson,
    name: GITHUB_PACKAGE_NAME,
    openclaw: {
      ...packageJson.openclaw,
      install: {
        ...packageJson.openclaw.install,
        npmSpec: GITHUB_PACKAGE_NAME,
      },
    },
    publishConfig,
  };
}

export function prepareGitHubPackage(packageDirectory) {
  const manifestPath = resolve(packageDirectory, "package.json");
  const packageJson = JSON.parse(readFileSync(manifestPath, "utf8"));
  const githubPackageJson = createGitHubPackageManifest(packageJson);
  writeFileSync(manifestPath, `${JSON.stringify(githubPackageJson, null, 2)}\n`, "utf8");
  return githubPackageJson;
}

function run() {
  try {
    const packageDirectory = process.argv[2];
    if (!packageDirectory) {
      throw new Error("package directory argument is required");
    }
    const packageJson = prepareGitHubPackage(packageDirectory);
    console.log(`Prepared ${packageJson.name}@${packageJson.version} for ${packageJson.publishConfig.registry}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`GitHub package preparation failed: ${message}`);
    process.exitCode = 1;
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedUrl) {
  run();
}
