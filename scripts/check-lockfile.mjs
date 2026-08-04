import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REGISTRY_PREFIX = "https://registry.npmjs.org/";

export const SHRINKWRAPPED_HOST = "node_modules/openclaw";

function installedPaths(packages, name) {
  return Object.keys(packages).filter(
    (path) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`),
  );
}

/**
 * OpenClaw publishes an `npm-shrinkwrap.json`, so npm resolves everything under
 * `node_modules/openclaw/` from that shrinkwrap and ignores this package's
 * `overrides`. A pin npm cannot apply only changes what `npm audit` reads out of
 * the lockfile while `npm ci` keeps installing the original version, so reject
 * any override the lockfile does not actually reflect.
 */
export function checkOverrideEffects({ packageJson, packageLock }) {
  const overrides = packageJson?.overrides ?? {};
  const packages = packageLock?.packages ?? {};
  const checked = [];

  for (const name of Object.keys(overrides).sort()) {
    const requested = overrides[name];
    if (typeof requested !== "string" || !EXACT_VERSION.test(requested)) {
      throw new Error(
        `overrides.${name} must pin an exact MAJOR.MINOR.PATCH version, found ${JSON.stringify(requested)}`,
      );
    }

    const paths = installedPaths(packages, name);
    if (paths.length === 0) {
      throw new Error(`overrides.${name} does not match any package-lock.json entry; remove the unused override`);
    }

    for (const path of paths) {
      const installed = packages[path]?.version;
      if (installed === requested) continue;
      const reason = path.startsWith(`${SHRINKWRAPPED_HOST}/`)
        ? `${SHRINKWRAPPED_HOST} ships an npm-shrinkwrap.json that npm applies instead of overrides`
        : "the lockfile was refreshed without the override";
      throw new Error(
        `overrides.${name} pins ${requested} but package-lock.json ${path} resolves ${installed}: ${reason}`,
      );
    }

    checked.push({ name, paths, version: requested });
  }

  return checked;
}

/**
 * Mirror registries hand out different tarball URLs and weaker integrity
 * hashes, so a lockfile refreshed behind one stops resolving for everyone else.
 */
export function checkRegistrySources({ packageLock }) {
  const packages = packageLock?.packages ?? {};

  for (const path of Object.keys(packages)) {
    const entry = packages[path];
    if (!entry?.resolved) continue;
    if (!entry.resolved.startsWith(REGISTRY_PREFIX)) {
      throw new Error(`package-lock.json ${path} resolves ${entry.resolved} instead of ${REGISTRY_PREFIX}`);
    }
    if (typeof entry.integrity !== "string" || !entry.integrity.startsWith("sha512-")) {
      throw new Error(
        `package-lock.json ${path} must record a sha512 integrity, found ${JSON.stringify(entry.integrity)}`,
      );
    }
  }

  return Object.keys(packages).length;
}

export function checkLockfile(rootDirectory = process.cwd()) {
  const readJson = (filename) => JSON.parse(readFileSync(resolve(rootDirectory, filename), "utf8"));
  const files = { packageJson: readJson("package.json"), packageLock: readJson("package-lock.json") };

  return { entries: checkRegistrySources(files), overrides: checkOverrideEffects(files) };
}

function run() {
  try {
    const { entries, overrides } = checkLockfile();
    console.log(
      `Lockfile check passed: ${entries} entries resolve from the public registry, ${overrides.length} overrides applied`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Lockfile check failed: ${message}`);
    process.exitCode = 1;
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedUrl) {
  run();
}
