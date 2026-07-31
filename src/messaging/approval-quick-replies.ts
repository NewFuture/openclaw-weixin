import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";

const APPROVAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const FORWARDED_EXEC_APPROVAL_HEADING = "🔒 Exec approval required";
const QUICK_REPLIES_HEADING = "Quick replies (short ID):";
const OTHER_OPTIONS_HEADER = "Other options:\n\n";
const TXT_FENCE_OPEN = "```txt\n";
const FENCE_CLOSE = "\n```";
const EXEC_APPROVAL_DECISIONS = ["allow-once", "allow-always", "deny"] as const;

type ExecApprovalDecision = (typeof EXEC_APPROVAL_DECISIONS)[number];
type ApprovalPendingHint = {
  kind?: unknown;
  approvalKind?: unknown;
};
type ParsedApprovalCommand = {
  approvalCommandId: string;
  decision: ExecApprovalDecision;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readExecApprovalDetails(payload: ReplyPayload): {
  approvalId: string;
  approvalSlug: string;
  allowedDecisions: ExecApprovalDecision[];
} | null {
  if (!isRecord(payload.channelData)) {
    return null;
  }
  const metadata = payload.channelData.execApproval;
  if (!isRecord(metadata) || metadata.approvalKind !== "exec") {
    return null;
  }

  const approvalId = typeof metadata.approvalId === "string" ? metadata.approvalId.trim() : "";
  const approvalSlug = typeof metadata.approvalSlug === "string" ? metadata.approvalSlug.trim() : "";
  if (
    !APPROVAL_ID_RE.test(approvalId) ||
    !APPROVAL_ID_RE.test(approvalSlug) ||
    !Array.isArray(metadata.allowedDecisions)
  ) {
    return null;
  }

  const allowed = new Set(metadata.allowedDecisions);
  const allowedDecisions = EXEC_APPROVAL_DECISIONS.filter((decision) => allowed.has(decision));
  return allowedDecisions.length > 0 ? { approvalId, approvalSlug, allowedDecisions } : null;
}

function formatApprovalCommandBlock(command: string): string {
  return `${TXT_FENCE_OPEN}${command}${FENCE_CLOSE}`;
}

function isExecApprovalDecision(value: string): value is ExecApprovalDecision {
  return EXEC_APPROVAL_DECISIONS.some((decision) => decision === value);
}

function parseApprovalCommand(command: string): ParsedApprovalCommand | null {
  const match = command.match(/^\/approve ([A-Za-z0-9][A-Za-z0-9._:-]*) (allow-once|allow-always|deny)$/);
  if (!match || !isExecApprovalDecision(match[2])) {
    return null;
  }
  return {
    approvalCommandId: match[1],
    decision: match[2],
  };
}

function readPrimaryApprovalCommand(text: string): { command: ParsedApprovalCommand; blockEnd: number } | null {
  const marker = `Approval required.\n\nRun:\n\n${TXT_FENCE_OPEN}`;
  const markerStart = text.startsWith(marker) ? 0 : text.indexOf(`\n\n${marker}`);
  if (markerStart < 0) {
    return null;
  }
  const commandStart = markerStart + marker.length + (markerStart === 0 ? 0 : 2);
  const commandEnd = text.indexOf(FENCE_CLOSE, commandStart);
  if (commandEnd < 0) {
    return null;
  }
  const command = parseApprovalCommand(text.slice(commandStart, commandEnd));
  return command ? { command, blockEnd: commandEnd + FENCE_CLOSE.length } : null;
}

function readPendingCommandBlockEnd(text: string, start: number): number | null {
  const marker = "\n\nPending command:\n\n";
  if (!text.startsWith(marker, start)) {
    return null;
  }

  const fenceStart = start + marker.length;
  const openerEnd = text.indexOf("\n", fenceStart);
  if (openerEnd < 0) {
    return null;
  }
  const opener = text.slice(fenceStart, openerEnd);
  const openerMatch = opener.match(/^(`{3,})sh$/);
  if (!openerMatch) {
    return null;
  }

  const closingFence = `\n${openerMatch[1]}`;
  const closingStart = text.indexOf(closingFence, openerEnd + 1);
  return closingStart < 0 ? null : closingStart + closingFence.length;
}

function splitOtherOptionsText(
  text: string,
  approvalId: string,
  allowedDecisions: readonly ExecApprovalDecision[],
): string | null {
  if (!text.endsWith(`Full id: \`${approvalId}\``)) {
    return null;
  }

  const primary = readPrimaryApprovalCommand(text);
  if (!primary) {
    return null;
  }

  const pendingBlockEnd = readPendingCommandBlockEnd(text, primary.blockEnd);
  if (pendingBlockEnd === null) {
    return null;
  }

  const sectionMarker = `\n\n${OTHER_OPTIONS_HEADER}${TXT_FENCE_OPEN}`;
  if (!text.startsWith(sectionMarker, pendingBlockEnd)) {
    return null;
  }

  const blockStart = pendingBlockEnd + 2 + OTHER_OPTIONS_HEADER.length;
  const commandsStart = blockStart + TXT_FENCE_OPEN.length;
  const commandsEnd = text.indexOf(FENCE_CLOSE, commandsStart);
  if (commandsEnd < 0) {
    return null;
  }
  const blockEnd = commandsEnd + FENCE_CLOSE.length;
  const suffix = text.slice(blockEnd);
  if (suffix && !suffix.startsWith("\n\n")) {
    return null;
  }

  const commands = text.slice(commandsStart, commandsEnd).split("\n");
  if (commands.length < 2 || commands.some((command) => !command)) {
    return null;
  }

  const parsedCommands = commands.map(parseApprovalCommand);
  if (parsedCommands.some((command) => command === null)) {
    return null;
  }
  const validCommands = parsedCommands.filter((command): command is ParsedApprovalCommand => command !== null);
  const allowed = new Set(allowedDecisions);
  if (
    !allowed.has(primary.command.decision) ||
    validCommands.some((command) => !allowed.has(command.decision)) ||
    validCommands.some((command) => command.approvalCommandId !== primary.command.approvalCommandId) ||
    validCommands.some((command) => command.decision === primary.command.decision) ||
    new Set(validCommands.map((command) => command.decision)).size !== validCommands.length
  ) {
    return null;
  }

  return [text.slice(0, blockStart), commands.map(formatApprovalCommandBlock).join("\n\n"), text.slice(blockEnd)].join(
    "",
  );
}

/**
 * Add copy-friendly commands to forwarded exec approval prompts.
 *
 * OpenClaw supplies the collision-aware short ID and the request-scoped decision
 * set in channel metadata, so the channel never derives either value from text.
 */
export function appendWeixinExecApprovalQuickReplies(params: {
  payload: ReplyPayload;
  hint?: ApprovalPendingHint;
}): void {
  if (
    params.hint?.kind !== "approval-pending" ||
    params.hint.approvalKind !== "exec" ||
    !params.payload.text?.startsWith(`${FORWARDED_EXEC_APPROVAL_HEADING}\n`)
  ) {
    return;
  }

  const details = readExecApprovalDetails(params.payload);
  if (!details) {
    return;
  }
  const forwardedPrefix = `${FORWARDED_EXEC_APPROVAL_HEADING}\nID: ${details.approvalId}`;
  if (params.payload.text !== forwardedPrefix && !params.payload.text.startsWith(`${forwardedPrefix}\n`)) {
    return;
  }

  const commandBlocks = details.allowedDecisions
    .map((decision) => formatApprovalCommandBlock(`/approve ${details.approvalSlug} ${decision}`))
    .join("\n\n");
  const quickReplies = `${QUICK_REPLIES_HEADING}\n\n${commandBlocks}`;
  const text = params.payload.text.trimEnd();
  if (text.endsWith(quickReplies)) {
    return;
  }
  params.payload.text = `${text}\n\n${quickReplies}`;
}

/**
 * Split OpenClaw's direct exec-approval alternatives into individually copyable
 * code blocks while preserving the exact command IDs rendered by OpenClaw.
 */
export function splitWeixinExecApprovalOtherOptions(payload: ReplyPayload): ReplyPayload {
  if (!payload.text) {
    return payload;
  }
  const details = readExecApprovalDetails(payload);
  if (!details) {
    return payload;
  }

  const text = splitOtherOptionsText(payload.text, details.approvalId, details.allowedDecisions);
  return text ? { ...payload, text } : payload;
}
