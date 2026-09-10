import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const REPORT_GITHUB_TOOLS = ["get_commit", "get_file_contents", "list_commits", "search_pull_requests"];

function readWorkflow(extension) {
  return readFileSync(
    new URL(`../.github/workflows/maintenance-report.${extension}`, import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
}

function frontmatter() {
  const source = readWorkflow("md");
  expect(source).toMatch(/^---\n/);
  const end = source.indexOf("\n---\n", 4);
  expect(end).toBeGreaterThan(4);
  return source.slice(4, end);
}

function compiledJob(name, nextName) {
  const workflow = readWorkflow("lock.yml");
  const start = workflow.indexOf(`\n  ${name}:\n`);
  const end = nextName ? workflow.indexOf(`\n  ${nextName}:\n`, start + 1) : workflow.length;
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

function proxyPolicy(job) {
  const match = job.match(/printf '%s\\n' '(\{[^\r\n]+\})' > "\$\{RUNNER_TEMP\}\/gh-aw\/awf-config\.json"/);
  expect(match).not.toBeNull();
  return JSON.parse(match[1]).apiProxy;
}

describe("Maintenance report workflow contract", () => {
  it("only accepts manual runs on the trusted default branch", () => {
    const config = frontmatter();

    expect(config).toContain("on:\n  workflow_dispatch:\n");
    expect(config).toContain("if: github.ref == 'refs/heads/main'");
    expect(config).not.toMatch(
      /^\s{2}(?:schedule|push|pull_request|pull_request_target|issues|issue_comment|workflow_run):/m,
    );
  });

  it("keeps the agent read-only and scoped without shell or CLI proxy access", () => {
    const config = frontmatter();

    expect(config).toContain("permissions:\n  contents: read\n  pull-requests: read");
    expect(config).not.toMatch(/^\s+[\w-]+: write$/m);
    expect(config).toContain("  bash: false\n  cli-proxy: false");
    expect(config).toContain("    mode: local\n    read-only: true");
    expect(config).toContain("    toolsets: [repos, pull_requests]");
    expect(config).toContain(`    allowed: [${REPORT_GITHUB_TOOLS.join(", ")}]`);
    expect(config).toContain('    allowed-repos: ["newfuture/openclaw-weixin"]');
    expect(config).toContain("    min-integrity: approved");
    expect(config).not.toMatch(/^(?:imports|steps|jobs|environment|secrets):/m);
  });

  it("previews the report and suppresses diagnostic issue creation on every exit", () => {
    const config = frontmatter();
    const outputs = config.slice(config.indexOf("\nsafe-outputs:\n"));

    expect(outputs).toContain("\nsafe-outputs:\n  staged: true\n");
    expect(outputs).toContain("  create-issue:\n    max: 1\n");
    expect(outputs).toContain("  noop:\n    report-as-issue: false");
    for (const kind of ["missing-tool", "missing-data", "report-incomplete"]) {
      expect(outputs).toContain(`  ${kind}:\n    create-issue: false`);
    }
    expect(outputs).toContain("  report-failure-as-issue: false");
    expect(outputs).toContain("  report-failed-jobs: false");
    expect([...outputs.matchAll(/^ {2}([\w-]+):/gm)].map((match) => match[1])).toEqual([
      "staged",
      "create-issue",
      "noop",
      "missing-tool",
      "missing-data",
      "report-incomplete",
      "report-failure-as-issue",
      "report-failed-jobs",
      "threat-detection",
    ]);
  });

  it("bounds the main agent and detection independently", () => {
    const config = frontmatter();

    expect(config).toContain("engine: copilot\n");
    expect(config).toContain("timeout-minutes: 10\nmax-turns: 20\nmax-ai-credits: 100");
    expect(config).toContain("  threat-detection:\n    max-ai-credits: 50");
    expect(config).toContain("concurrency:\n  group: gh-aw-maintenance-report\n  cancel-in-progress: false");
  });

  it("ships a strictly compiled, SHA-pinned workflow with the same manual entry point", () => {
    const workflow = readWorkflow("lock.yml");
    const metadata = JSON.parse(workflow.match(/^# gh-aw-metadata: (.+)$/m)[1]);
    const triggers = workflow.slice(workflow.indexOf("\non:\n"), workflow.indexOf("\npermissions:"));
    const actionPins = [...workflow.matchAll(/^\s+uses: ([^\s]+).*$/gm)].map((match) => match[1]);

    expect(metadata).toMatchObject({ compiler_version: "v0.88.2", strict: true, agent_id: "copilot" });
    expect([...triggers.matchAll(/^ {2}([\w_]+):/gm)].map((match) => match[1])).toEqual(["workflow_dispatch"]);
    expect(compiledJob("activation", "agent")).toContain("    if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("\npermissions: {}\n");
    expect(actionPins.length).toBeGreaterThan(0);
    for (const reference of actionPins) {
      expect(reference).toMatch(/^[\w./-]+@[a-f0-9]{40}$/);
    }
    expect(workflow).not.toMatch(/^\s+(?:contents|issues|pull-requests|packages|id-token): write$/m);
  });

  it("excludes comment, repository search, and star APIs from the compiled tool inventory", () => {
    const workflow = readWorkflow("lock.yml");
    const manifest = JSON.parse(workflow.match(/^# gh-aw-manifest: (.+)$/m)[1]);
    const github = manifest.mcp_servers.find((server) => server.name === "github");
    const agent = compiledJob("agent", "conclusion");
    const permissions = [
      ...new Set([...agent.matchAll(/--allow-tool\s+['\\]*github\(([^)]+)\)/g)].map((match) => match[1])),
    ];

    expect(github.tools).toEqual(REPORT_GITHUB_TOOLS);
    expect(permissions.sort()).toEqual(REPORT_GITHUB_TOOLS);
    expect(agent).not.toMatch(/--allow-tool\s+['\\]*github(?:['\\]*\s|$)/);
    expect(agent).not.toContain("--allow-all-tools");
  });

  it("carries staged mode and disabled diagnostics through to the output jobs", () => {
    const outputs = compiledJob("safe_outputs");
    const conclusion = compiledJob("conclusion", "detection");

    expect(outputs).toContain("    permissions: {}");
    expect(outputs).toContain('GH_AW_SAFE_OUTPUTS_STAGED: "true"');
    expect(outputs).toContain("needs.detection.result == 'success'");
    for (const variable of [
      "GH_AW_NOOP_REPORT_AS_ISSUE",
      "GH_AW_MISSING_TOOL_CREATE_ISSUE",
      "GH_AW_REPORT_INCOMPLETE_CREATE_ISSUE",
      "GH_AW_FAILURE_REPORT_AS_ISSUE",
    ]) {
      expect(conclusion).toContain(`${variable}: "false"`);
    }
    expect(conclusion.includes('GH_AW_REPORT_FAILED_JOBS: "true"')).toBe(false);
  });

  it("applies the limits to the emitted agent and detection proxies, not just the Markdown", () => {
    const agent = compiledJob("agent", "conclusion");
    const detection = compiledJob("detection", "safe_outputs");

    expect(agent).toContain("    permissions:\n      contents: read\n      pull-requests: read");
    expect(agent).toContain('"GITHUB_READ_ONLY": "1"');
    expect(agent).not.toMatch(/--allow-tool (?:shell|bash)\b/);
    expect(agent).toContain("GH_AW_MAX_TURNS: 20");
    expect(agent).toContain("GH_AW_TIMEOUT_MINUTES: 10");
    expect(proxyPolicy(agent)).toMatchObject({ enabled: true, maxRuns: 20, maxAiCredits: 100 });
    expect(proxyPolicy(detection)).toMatchObject({ enabled: true, maxAiCredits: 50 });
  });
});
