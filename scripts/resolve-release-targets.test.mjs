import { describe, expect, it } from "vitest";

import { resolveReleaseTargets } from "./resolve-release-targets.mjs";

const VERSION = "3.2.0";
const PREVIOUS_VERSION = "3.1.1";
const SOURCE_COMMIT = "1234567890abcdef1234567890abcdef12345678";
const SOURCE_REF = `refs/tags/v${VERSION}`;
const SOURCE_REPO = "NewFuture/openclaw-weixin";

function validInspection() {
  return {
    package: {
      name: "openclaw-wechat",
    },
    owner: {
      handle: "newfuture",
    },
    version: {
      verification: {
        sourceCommit: SOURCE_COMMIT,
        sourceRepo: SOURCE_REPO,
        sourceTag: SOURCE_REF,
      },
      version: VERSION,
    },
    file: {
      content: JSON.stringify({
        channels: ["openclaw-weixin"],
        id: "openclaw-weixin",
        version: VERSION,
      }),
      path: "openclaw.plugin.json",
    },
  };
}

function createRunner({ clawHubPublished, inspection = validInspection(), npmjsPublished }) {
  const calls = [];
  const run = (command, args, options = {}) => {
    calls.push({ args, command, options });
    const invocation = `${command} ${args.join(" ")}`;
    if (invocation.includes(`npm view openclaw-weixin@${VERSION} version`)) {
      return npmjsPublished
        ? { status: 0, stderr: "", stdout: `${VERSION}\n` }
        : { status: 1, stderr: "npm error code E404\n404 Not Found", stdout: "" };
    }
    if (invocation.includes("npm view openclaw-weixin@latest version")) {
      return { status: 0, stderr: "", stdout: `${PREVIOUS_VERSION}\n` };
    }
    if (invocation === "npm run check:versions") {
      return { status: 0, stderr: "", stdout: "versions match\n" };
    }
    if (invocation.includes("npx --yes clawhub@0.23.3 package inspect openclaw-wechat --versions")) {
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          owner: {
            handle: "newfuture",
          },
          package: {
            name: "openclaw-wechat",
          },
          versions: clawHubPublished
            ? [{ version: VERSION }, { version: PREVIOUS_VERSION }]
            : [{ version: PREVIOUS_VERSION }],
        }),
      };
    }
    if (invocation.includes(`npx --yes clawhub@0.23.3 package inspect openclaw-wechat --version ${VERSION}`)) {
      return { status: 0, stderr: "", stdout: JSON.stringify(inspection) };
    }
    throw new Error(`unexpected command: ${invocation}`);
  };
  return { calls, run };
}

function resolveWith(run) {
  return resolveReleaseTargets({
    run,
    sourceCommit: SOURCE_COMMIT,
    sourceRef: SOURCE_REF,
    sourceRepo: SOURCE_REPO,
    version: VERSION,
  });
}

describe("release target resolution", () => {
  it.each([
    {
      clawHubPublished: false,
      expectedRequired: true,
      label: "publishes both missing targets",
      npmjsPublished: false,
    },
    {
      clawHubPublished: false,
      expectedRequired: true,
      label: "resumes ClawHub after npmjs succeeds",
      npmjsPublished: true,
    },
    {
      clawHubPublished: true,
      expectedRequired: true,
      label: "resumes npmjs when ClawHub already matches",
      npmjsPublished: false,
    },
    {
      clawHubPublished: true,
      expectedRequired: false,
      label: "skips approval when both targets match",
      npmjsPublished: true,
    },
  ])("$label", ({ clawHubPublished, expectedRequired, npmjsPublished }) => {
    const { calls, run } = createRunner({ clawHubPublished, npmjsPublished });

    const result = resolveWith(run);

    expect(result.npmjs.published).toBe(npmjsPublished);
    expect(result.clawHub.published).toBe(clawHubPublished);
    expect(result.publicationRequired).toBe(expectedRequired);
    expect(calls.some(({ args, command }) => command === "npm" && args.join(" ") === "run check:versions")).toBe(
      !npmjsPublished,
    );
    expect(
      calls.some(
        ({ args, command }) => command === "npx" && args.includes("--version") && args.includes("openclaw.plugin.json"),
      ),
    ).toBe(clawHubPublished);
  });

  it.each([
    {
      label: "source commit",
      mutate(inspection) {
        inspection.version.verification.sourceCommit = "abcdef1234567890abcdef1234567890abcdef12";
      },
    },
    {
      label: "source ref",
      mutate(inspection) {
        inspection.version.verification.sourceTag = "refs/tags/v3.1.1";
      },
    },
    {
      label: "runtime plugin id",
      mutate(inspection) {
        inspection.file.content = JSON.stringify({
          channels: ["openclaw-weixin"],
          id: "openclaw-wechat",
          version: VERSION,
        });
      },
    },
    {
      label: "runtime channel id",
      mutate(inspection) {
        inspection.file.content = JSON.stringify({
          channels: ["openclaw-wechat"],
          id: "openclaw-weixin",
          version: VERSION,
        });
      },
    },
  ])("rejects an existing version with a mismatched $label", ({ mutate }) => {
    const inspection = validInspection();
    mutate(inspection);
    const { run } = createRunner({
      clawHubPublished: true,
      inspection,
      npmjsPublished: true,
    });

    expect(() => resolveWith(run)).toThrow(/mismatch/);
  });

  it("rejects a non-tag release ref before querying registries", () => {
    const { calls, run } = createRunner({
      clawHubPublished: false,
      npmjsPublished: false,
    });

    expect(() =>
      resolveReleaseTargets({
        run,
        sourceCommit: SOURCE_COMMIT,
        sourceRef: "refs/heads/main",
        sourceRepo: SOURCE_REPO,
        version: VERSION,
      }),
    ).toThrow(`release ref mismatch: expected "${SOURCE_REF}", found "refs/heads/main"`);
    expect(calls).toEqual([]);
  });
});
