import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { describe, expect, it } from "vitest";
import { appendWeixinExecApprovalQuickReplies, splitWeixinExecApprovalOtherOptions } from "./approval-quick-replies.js";

const FULL_APPROVAL_ID = "11111111-2222-4333-8444-555555555555";
const FORWARDED_HEADING = "🔒 Exec approval required";
const DECISIONS = ["allow-once", "allow-always", "deny"] as const;

type Decision = (typeof DECISIONS)[number];

const execApprovalHint = {
  kind: "approval-pending",
  approvalKind: "exec",
} as const;

function asPayload(value: unknown): ReplyPayload {
  return value as ReplyPayload;
}

function isDecision(value: unknown): value is Decision {
  return DECISIONS.some((decision) => decision === value);
}

function canonicalDecisions(values: readonly unknown[]): Decision[] {
  const supplied = new Set(values.filter(isDecision));
  return DECISIONS.filter((decision) => supplied.has(decision));
}

function formatApprovalBlock(command: string): string {
  return `\`\`\`txt\n${command}\n\`\`\``;
}

function formatQuickReplyFooter(slug: string, decisions: readonly Decision[]): string {
  return [
    "Quick replies (short ID):",
    "",
    ...decisions.flatMap((decision, index) => [
      ...(index === 0 ? [] : [""]),
      "```txt",
      `/approve ${slug} ${decision}`,
      "```",
    ]),
  ].join("\n");
}

function makeForwardedPayload(
  options: {
    allowedDecisions?: unknown;
    approvalId?: unknown;
    approvalKind?: unknown;
    approvalSlug?: unknown;
    text?: string;
  } = {},
): ReplyPayload {
  return {
    text: options.text ?? `${FORWARDED_HEADING}\nID: ${FULL_APPROVAL_ID}`,
    channelData: {
      execApproval: {
        approvalId: options.approvalId ?? FULL_APPROVAL_ID,
        approvalSlug: options.approvalSlug ?? "approval",
        approvalKind: options.approvalKind ?? "exec",
        allowedDecisions: options.allowedDecisions ?? DECISIONS,
        state: "pending",
      },
    },
  };
}

type DirectPayloadOptions = {
  allowedDecisions?: readonly unknown[];
  approvalCommandId?: string;
  approvalId?: string;
  approvalKind?: string;
  approvalSlug?: string;
  footer?: string;
  pendingCommand?: string;
  pendingFence?: string;
  renderedDecisions?: readonly Decision[];
  unavailableText?: string | null;
  warningText?: string;
};

function makeDirectPayload(options: DirectPayloadOptions = {}): ReplyPayload {
  const allowedDecisions = options.allowedDecisions ?? DECISIONS;
  const renderedDecisions = options.renderedDecisions ?? canonicalDecisions(allowedDecisions);
  const approvalId = options.approvalId ?? FULL_APPROVAL_ID;
  const approvalSlug = options.approvalSlug ?? "approval";
  const approvalCommandId = options.approvalCommandId?.trim() || approvalSlug;
  const pendingFence = options.pendingFence ?? "```";
  const actions = renderedDecisions.map((decision) => `/approve ${approvalCommandId} ${decision}`);
  const lines: string[] = [];
  const warningText = options.warningText?.trim();
  if (warningText) {
    lines.push(warningText);
  }
  lines.push("Approval required.");
  if (actions[0]) {
    lines.push("Run:", formatApprovalBlock(actions[0]));
  }
  lines.push("Pending command:", `${pendingFence}sh\n${options.pendingCommand ?? 'echo "safe"'}\n${pendingFence}`);
  if (actions.length > 1) {
    lines.push("Other options:", formatApprovalBlock(actions.slice(1).join("\n")));
  }
  if (!allowedDecisions.includes("allow-always") && options.unavailableText !== null) {
    lines.push(
      options.unavailableText ??
        "The effective approval policy requires approval every time, so Allow Always is unavailable.",
    );
  }
  lines.push(
    options.footer ?? ["Host: gateway", "CWD: C:\\synthetic\\workspace", `Full id: \`${approvalId}\``].join("\n"),
  );

  return {
    text: lines.join("\n\n"),
    channelData: {
      execApproval: {
        approvalId,
        approvalSlug,
        approvalKind: options.approvalKind ?? "exec",
        allowedDecisions,
      },
    },
  };
}

function updatePayloadText(payload: ReplyPayload, transform: (text: string) => string): ReplyPayload {
  if (!payload.text) {
    throw new Error("Synthetic approval payload is missing text");
  }
  const text = transform(payload.text);
  if (text === payload.text) {
    throw new Error("Synthetic approval mutation did not change the payload");
  }
  payload.text = text;
  return payload;
}

describe("appendWeixinExecApprovalQuickReplies", () => {
  const decisionSubsets = Array.from({ length: 8 }, (_, mask) => {
    const decisions = DECISIONS.filter((_, index) => (mask & (1 << index)) !== 0);
    return {
      name: decisions.length > 0 ? decisions.join(" + ") : "empty",
      decisions,
    };
  });

  it.each(decisionSubsets.filter(({ decisions }) => decisions.length > 0))(
    "appends the canonical blocks for the $name decision subset",
    ({ decisions }) => {
      const payload = makeForwardedPayload({
        allowedDecisions: [...decisions].reverse(),
      });
      const originalText = payload.text;

      appendWeixinExecApprovalQuickReplies({ payload, hint: execApprovalHint });

      expect(payload.text).toBe(`${originalText}\n\n${formatQuickReplyFooter("approval", decisions)}`);
    },
  );

  it("filters unknown and duplicate metadata decisions into canonical order", () => {
    const payload = makeForwardedPayload({
      allowedDecisions: ["deny", "unknown", "allow-once", "deny", "allow-always", 7],
    });

    appendWeixinExecApprovalQuickReplies({ payload, hint: execApprovalHint });

    expect(payload.text).toContain(formatQuickReplyFooter("approval", ["allow-once", "allow-always", "deny"]));
  });

  it("uses metadata for forwarded prompts with warning and multiline command text", () => {
    const source = [
      FORWARDED_HEADING,
      `ID: ${FULL_APPROVAL_ID}`,
      "",
      "Synthetic warning.",
      "",
      "Command:",
      "````sh",
      "printf '```'",
      "````",
      "",
      "Host: gateway",
    ].join("\n");
    const payload = makeForwardedPayload({
      allowedDecisions: ["allow-once", "deny"],
      text: source,
    });

    appendWeixinExecApprovalQuickReplies({ payload, hint: execApprovalHint });

    expect(payload.text).toBe(`${source}\n\n${formatQuickReplyFooter("approval", ["allow-once", "deny"])}`);
  });

  it.each([
    { name: "empty decision list", allowedDecisions: [] },
    { name: "unknown decisions", allowedDecisions: ["always", "maybe"] },
    { name: "non-array decisions", allowedDecisions: "allow-once" },
  ])("does not append for $name", ({ allowedDecisions }) => {
    const payload = makeForwardedPayload({ allowedDecisions });
    const originalText = payload.text;

    appendWeixinExecApprovalQuickReplies({ payload, hint: execApprovalHint });

    expect(payload.text).toBe(originalText);
  });

  it.each([
    {
      name: "missing text",
      create: () => {
        const payload = makeForwardedPayload();
        delete payload.text;
        return payload;
      },
    },
    {
      name: "missing channel data",
      create: () => asPayload({ text: `${FORWARDED_HEADING}\nID: ${FULL_APPROVAL_ID}` }),
    },
    {
      name: "array channel data",
      create: () =>
        asPayload({
          text: `${FORWARDED_HEADING}\nID: ${FULL_APPROVAL_ID}`,
          channelData: [],
        }),
    },
    {
      name: "missing approval metadata",
      create: () =>
        asPayload({
          text: `${FORWARDED_HEADING}\nID: ${FULL_APPROVAL_ID}`,
          channelData: {},
        }),
    },
    {
      name: "missing allowed decisions",
      create: () =>
        asPayload({
          text: `${FORWARDED_HEADING}\nID: ${FULL_APPROVAL_ID}`,
          channelData: {
            execApproval: {
              approvalId: FULL_APPROVAL_ID,
              approvalSlug: "approval",
              approvalKind: "exec",
            },
          },
        }),
    },
    {
      name: "array approval metadata",
      create: () =>
        asPayload({
          text: `${FORWARDED_HEADING}\nID: ${FULL_APPROVAL_ID}`,
          channelData: { execApproval: [] },
        }),
    },
    {
      name: "missing full ID",
      create: () => makeForwardedPayload({ approvalId: "" }),
    },
    {
      name: "injection-prone full ID",
      create: () => makeForwardedPayload({ approvalId: "bad id\ninjected" }),
    },
    {
      name: "non-string full ID",
      create: () => makeForwardedPayload({ approvalId: 7 }),
    },
    {
      name: "plugin approval",
      create: () => makeForwardedPayload({ approvalKind: "plugin" }),
    },
    {
      name: "missing approval kind",
      create: () => makeForwardedPayload({ approvalKind: "" }),
    },
    {
      name: "blank slug",
      create: () => makeForwardedPayload({ approvalSlug: "  " }),
    },
    {
      name: "injection-prone slug",
      create: () => makeForwardedPayload({ approvalSlug: "bad slug\n/approve injected deny" }),
    },
    {
      name: "non-string slug",
      create: () => makeForwardedPayload({ approvalSlug: 7 }),
    },
  ])("leaves $name unchanged", ({ create }) => {
    const payload = create();
    const originalText = payload.text;

    appendWeixinExecApprovalQuickReplies({ payload, hint: execApprovalHint });

    expect(payload.text).toBe(originalText);
  });

  it.each([
    { name: "missing hint", hint: undefined },
    {
      name: "resolved hint",
      hint: { kind: "approval-resolved", approvalKind: "exec" },
    },
    {
      name: "expired hint",
      hint: { kind: "approval-expired", approvalKind: "exec" },
    },
    {
      name: "plugin hint",
      hint: { kind: "approval-pending", approvalKind: "plugin" },
    },
  ])("does not append for a $name", ({ hint }) => {
    const payload = makeForwardedPayload();
    const originalText = payload.text;

    appendWeixinExecApprovalQuickReplies({ payload, hint });

    expect(payload.text).toBe(originalText);
  });

  it("does not append to a native direct-style approval payload", () => {
    const payload = makeDirectPayload();
    const originalText = payload.text;

    appendWeixinExecApprovalQuickReplies({ payload, hint: execApprovalHint });

    expect(payload.text).toBe(originalText);
  });

  it("does not append to unrelated text carrying approval metadata", () => {
    const payload = makeForwardedPayload({ text: "Synthetic approval notice" });

    appendWeixinExecApprovalQuickReplies({ payload, hint: execApprovalHint });

    expect(payload.text).toBe("Synthetic approval notice");
  });

  it("does not append when the visible and metadata full IDs differ", () => {
    const payload = makeForwardedPayload({ approvalId: "another-full-id" });
    const originalText = payload.text;

    appendWeixinExecApprovalQuickReplies({ payload, hint: execApprovalHint });

    expect(payload.text).toBe(originalText);
  });

  it("does not append the same quick replies twice", () => {
    const payload = makeForwardedPayload({
      allowedDecisions: ["allow-once", "deny"],
    });

    appendWeixinExecApprovalQuickReplies({ payload, hint: execApprovalHint });
    const once = payload.text;
    appendWeixinExecApprovalQuickReplies({ payload, hint: execApprovalHint });

    expect(payload.text).toBe(once);
  });
});

describe("splitWeixinExecApprovalOtherOptions", () => {
  const decisionSubsets = Array.from({ length: 8 }, (_, mask) => {
    const decisions = DECISIONS.filter((_, index) => (mask & (1 << index)) !== 0);
    return {
      name: decisions.length > 0 ? decisions.join(" + ") : "empty",
      decisions,
      shouldSplit: decisions.length === 3,
    };
  });

  it.each(decisionSubsets)("handles the upstream renderer's $name decision subset", ({ decisions, shouldSplit }) => {
    const payload = makeDirectPayload({ allowedDecisions: decisions });
    const result = splitWeixinExecApprovalOtherOptions(payload);

    if (!shouldSplit) {
      expect(result).toBe(payload);
      return;
    }
    expect(result).not.toBe(payload);
    expect(result.text).toContain(
      [
        "Other options:",
        "",
        "```txt",
        "/approve approval allow-always",
        "```",
        "",
        "```txt",
        "/approve approval deny",
        "```",
      ].join("\n"),
    );
  });

  it.each([
    {
      name: "slug fallback without a warning",
      approvalCommandId: undefined,
      warningText: undefined,
      expectedId: "approval",
    },
    {
      name: "blank command ID fallback with a warning",
      approvalCommandId: "   ",
      warningText: "  Synthetic policy warning.  ",
      expectedId: "approval",
    },
    {
      name: "explicit command ID",
      approvalCommandId: "approval-command-7",
      warningText: "Synthetic policy warning.",
      expectedId: "approval-command-7",
    },
    {
      name: "full approval ID",
      approvalCommandId: FULL_APPROVAL_ID,
      warningText: undefined,
      expectedId: FULL_APPROVAL_ID,
    },
  ])("preserves the rendered ID for $name", ({ approvalCommandId, warningText, expectedId }) => {
    const payload = makeDirectPayload({ approvalCommandId, warningText });

    const result = splitWeixinExecApprovalOtherOptions(payload);

    expect(result.text).toContain(`/approve ${expectedId} allow-always\n\`\`\``);
    expect(result.text).toContain(`/approve ${expectedId} deny\n\`\`\``);
    expect(payload.text).toContain(`/approve ${expectedId} allow-always\n/approve ${expectedId} deny`);
    if (warningText) {
      expect(result.text?.startsWith("Synthetic policy warning.\n\nApproval required.")).toBe(true);
    }
  });

  it("supports longer pending-command fences and preserves the full suffix", () => {
    const footer = [
      "Host: sandbox",
      "Node: node-test",
      "CWD: C:\\synthetic\\workspace",
      "Expires in: 30m",
      `Full id: \`${FULL_APPROVAL_ID}\``,
    ].join("\n");
    const payload = makeDirectPayload({
      footer,
      pendingCommand: "echo ```synthetic```",
      pendingFence: "````",
    });

    const result = splitWeixinExecApprovalOtherOptions(payload);

    expect(result.text).toContain("````sh\necho ```synthetic```\n````");
    expect(result.text?.endsWith(footer)).toBe(true);
  });

  it("normalizes unordered, duplicate, and unknown metadata decisions", () => {
    const payload = makeDirectPayload({
      allowedDecisions: ["deny", "unknown", "allow-once", "allow-always", "allow-once"],
    });

    const result = splitWeixinExecApprovalOtherOptions(payload);

    expect(result).not.toBe(payload);
    expect(result.text).toContain("/approve approval allow-always\n```");
    expect(result.text).toContain("/approve approval deny\n```");
  });

  it.each([
    "The effective approval policy requires approval every time, so Allow Always is unavailable.",
    "Allow Always is unavailable for this command.",
  ])("preserves the no-allow-always footer: %s", (unavailableText) => {
    const payload = makeDirectPayload({
      allowedDecisions: ["allow-once", "deny"],
      unavailableText,
    });
    const originalText = payload.text;

    const result = splitWeixinExecApprovalOtherOptions(payload);

    expect(result).toBe(payload);
    expect(result.text).toBe(originalText);
    expect(result.text).toContain(unavailableText);
  });

  it.each([
    {
      name: "missing Approval required heading",
      mutate: (text: string) => text.replace("Approval required.", "Native approval required."),
    },
    {
      name: "missing Run heading",
      mutate: (text: string) => text.replace("\n\nRun:", "\n\nExecute:"),
    },
    {
      name: "non-txt Run fence",
      mutate: (text: string) =>
        text.replace("```txt\n/approve approval allow-once", "```text\n/approve approval allow-once"),
    },
    {
      name: "unclosed Run fence",
      mutate: (text: string) => {
        const command = "/approve approval allow-once";
        return `${text.slice(0, text.indexOf(command) + command.length)}\n\nFull id: \`${FULL_APPROVAL_ID}\``;
      },
    },
    {
      name: "bot-addressed primary command",
      mutate: (text: string) => text.replace("/approve approval allow-once", "/approve@bot approval allow-once"),
    },
    {
      name: "always alias in the primary command",
      mutate: (text: string) => text.replace("/approve approval allow-once", "/approve approval always"),
    },
    {
      name: "case variant in the primary command",
      mutate: (text: string) => text.replace("/approve approval allow-once", "/APPROVE approval allow-once"),
    },
    {
      name: "extra primary command argument",
      mutate: (text: string) => text.replace("/approve approval allow-once", "/approve approval allow-once extra"),
    },
    {
      name: "noncanonical primary whitespace",
      mutate: (text: string) => text.replace("/approve approval allow-once", "/approve  approval allow-once"),
    },
    {
      name: "missing Pending command heading",
      mutate: (text: string) => text.replace("\n\nPending command:", "\n\nShell command:"),
    },
    {
      name: "non-sh pending command fence",
      mutate: (text: string) => text.replace("\n\n```sh\n", "\n\n```bash\n"),
    },
    {
      name: "pending command opener without a newline",
      mutate: (text: string) => {
        const opener = "Pending command:\n\n```sh";
        return `${text.slice(0, text.indexOf(opener) + opener.length)}Full id: \`${FULL_APPROVAL_ID}\``;
      },
    },
    {
      name: "mismatched pending command fence",
      mutate: (text: string) => text.replace("\n```\n\nOther options:", "\n````\n\nOther options:"),
    },
    {
      name: "missing pending command closing fence",
      mutate: (text: string) => {
        const command = 'echo "safe"';
        return `${text.slice(0, text.indexOf(command) + command.length)}\n\nFull id: \`${FULL_APPROVAL_ID}\``;
      },
    },
    {
      name: "missing Other options heading",
      mutate: (text: string) => text.replace("\n\nOther options:", "\n\nAlternatives:"),
    },
    {
      name: "non-txt options fence",
      mutate: (text: string) => text.replace("Other options:\n\n```txt", "Other options:\n\n```text"),
    },
    {
      name: "unclosed options fence",
      mutate: (text: string) =>
        text.replace("/approve approval deny\n```\n\nHost:", "/approve approval deny\n````\n\nHost:"),
    },
    {
      name: "missing options closing fence",
      mutate: (text: string) => {
        const command = "/approve approval deny";
        return `${text.slice(0, text.indexOf(command) + command.length)}\n\nFull id: \`${FULL_APPROVAL_ID}\``;
      },
    },
    {
      name: "options suffix without a blank separator",
      mutate: (text: string) =>
        text.replace("/approve approval deny\n```\n\nHost:", "/approve approval deny\n```\nHost:"),
    },
    {
      name: "missing Full id footer",
      mutate: (text: string) => text.replace("Full id:", "Request id:"),
    },
    {
      name: "mismatched Full id footer",
      mutate: (text: string) => text.replace(FULL_APPROVAL_ID, "another-full-id"),
    },
    {
      name: "blank option command",
      mutate: (text: string) =>
        text.replace(
          "/approve approval allow-always\n/approve approval deny",
          "/approve approval allow-always\n\n/approve approval deny",
        ),
    },
    {
      name: "unknown option decision",
      mutate: (text: string) => text.replace("/approve approval allow-always", "/approve approval always"),
    },
    {
      name: "mismatched option command ID",
      mutate: (text: string) => text.replace("/approve approval deny", "/approve another-id deny"),
    },
    {
      name: "duplicate option decision",
      mutate: (text: string) => text.replace("/approve approval deny", "/approve approval allow-always"),
    },
    {
      name: "primary decision repeated as an option",
      mutate: (text: string) => text.replace("/approve approval deny", "/approve approval allow-once"),
    },
  ])("leaves a payload with $name unchanged", ({ mutate }) => {
    const payload = updatePayloadText(makeDirectPayload(), mutate);
    const originalText = payload.text;

    const result = splitWeixinExecApprovalOtherOptions(payload);

    expect(result).toBe(payload);
    expect(result.text).toBe(originalText);
  });

  it.each([
    {
      name: "missing text",
      create: () => {
        const payload = makeDirectPayload();
        delete payload.text;
        return payload;
      },
    },
    {
      name: "plugin approval metadata",
      create: () => makeDirectPayload({ approvalKind: "plugin" }),
    },
    {
      name: "blank full ID",
      create: () => makeDirectPayload({ approvalId: "" }),
    },
    {
      name: "injection-prone full ID",
      create: () => makeDirectPayload({ approvalId: "bad id\ninjected" }),
    },
    {
      name: "blank slug",
      create: () => makeDirectPayload({ approvalSlug: "  " }),
    },
    {
      name: "injection-prone slug",
      create: () => makeDirectPayload({ approvalSlug: "bad slug\ninjected" }),
    },
    {
      name: "primary decision outside metadata",
      create: () =>
        makeDirectPayload({
          allowedDecisions: ["allow-always", "deny"],
          renderedDecisions: DECISIONS,
        }),
    },
    {
      name: "option decision outside metadata",
      create: () =>
        makeDirectPayload({
          allowedDecisions: ["allow-once", "allow-always"],
          renderedDecisions: DECISIONS,
        }),
    },
    {
      name: "missing metadata",
      create: () => {
        const payload = makeDirectPayload();
        payload.channelData = {};
        return payload;
      },
    },
    {
      name: "missing allowed decisions",
      create: () => {
        const payload = makeDirectPayload();
        payload.channelData = {
          execApproval: {
            approvalId: FULL_APPROVAL_ID,
            approvalSlug: "approval",
            approvalKind: "exec",
          },
        };
        return payload;
      },
    },
  ])("leaves direct text with $name unchanged", ({ create }) => {
    const payload = create();
    const originalText = payload.text;

    const result = splitWeixinExecApprovalOtherOptions(payload);

    expect(result).toBe(payload);
    expect(result.text).toBe(originalText);
  });

  it("is idempotent when OpenClaw normalizes the payload twice", () => {
    const once = splitWeixinExecApprovalOtherOptions(makeDirectPayload());

    expect(splitWeixinExecApprovalOtherOptions(once)).toBe(once);
  });
});
