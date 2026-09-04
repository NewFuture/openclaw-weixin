import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatCheckFailure,
  isolatedEnvironment,
  PluginLifecycleCheckFailure,
} from "./check-plugin-install-update.mjs";

describe("plugin install and update check isolation", () => {
  it("removes inherited package credentials and configuration", () => {
    const parentEnvironment = {
      CLAWHUB_TOKEN: "synthetic-clawhub-token",
      NODE_AUTH_TOKEN: "synthetic-node-token",
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
    expect(environment.NODE_AUTH_TOKEN).toBeUndefined();
    expect(environment.npm_config_registry).toBeUndefined();
    expect(environment.NPM_TOKEN).toBeUndefined();
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
