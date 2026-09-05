import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatCheckFailure,
  isolatedEnvironment,
  PluginLifecycleCheckFailure,
} from "./check-plugin-install-update.mjs";

describe("plugin install and update check isolation", () => {
  it("removes inherited host, package, and credential configuration", () => {
    const parentEnvironment = {
      CLAWHUB_GITHUB_CODELOAD_BASE_URL: "https://codeload.example.test/",
      CLAWHUB_TOKEN: "synthetic-clawhub-token",
      CLAWHUB_URL: "https://clawhub.example.test/",
      NODE_AUTH_TOKEN: "synthetic-node-token",
      OPENCLAW_CLAWHUB_URL: "https://openclaw-clawhub.example.test/",
      OPENCLAW_NIX_MODE: "1",
      openclaw_workspace_dir: "synthetic-workspace",
      npm_config_registry: "https://private.example.test/",
      NPM_CONFIG_USERCONFIG: "synthetic-user-config",
      NPM_TOKEN: "synthetic-npm-token",
      PATH: "synthetic-path",
    };

    const environment = isolatedEnvironment("temporary-state", parentEnvironment);

    expect(environment).toMatchObject({
      CLAWHUB_CONFIG_PATH: path.join("temporary-state", "clawhub.json"),
      CLAWDHUB_CONFIG_PATH: path.join("temporary-state", "clawhub.json"),
      NPM_CONFIG_CACHE: path.join("temporary-state", "npm-cache"),
      NPM_CONFIG_GLOBALCONFIG: path.join("temporary-state", "npmrc-global"),
      NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
      NPM_CONFIG_USERCONFIG: path.join("temporary-state", "npmrc"),
      PATH: "synthetic-path",
    });
    expect(environment.CLAWHUB_TOKEN).toBeUndefined();
    expect(environment.CLAWHUB_GITHUB_CODELOAD_BASE_URL).toBeUndefined();
    expect(environment.CLAWHUB_URL).toBeUndefined();
    expect(environment.NODE_AUTH_TOKEN).toBeUndefined();
    expect(environment.npm_config_registry).toBeUndefined();
    expect(environment.NPM_TOKEN).toBeUndefined();
    expect(environment.OPENCLAW_CLAWHUB_URL).toBeUndefined();
    expect(environment.OPENCLAW_NIX_MODE).toBeUndefined();
    expect(environment.openclaw_workspace_dir).toBeUndefined();
  });

  it("does not expose untrusted error details", () => {
    expect(formatCheckFailure(new Error("untrusted diagnostic"))).toBe(
      "Plugin lifecycle check failed: unexpected error",
    );
    expect(formatCheckFailure(new PluginLifecycleCheckFailure("npm update exited with status 1"))).toBe(
      "Plugin lifecycle check failed: npm update exited with status 1",
    );
  });
});
