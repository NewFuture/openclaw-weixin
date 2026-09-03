import { buildJsonChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";

import { CDN_BASE_URL, DEFAULT_BASE_URL } from "../auth/accounts.js";

const routeTagSchema = {
  anyOf: [{ type: "number" }, { type: "string" }],
} as const;

const weixinAccountProperties = {
  name: { type: "string" },
  enabled: { type: "boolean" },
  baseUrl: { type: "string", default: DEFAULT_BASE_URL },
  cdnBaseUrl: { type: "string", default: CDN_BASE_URL },
  routeTag: { type: "number" },
  blockStreaming: {
    type: "boolean",
    description: "Send completed text blocks before the final reply.",
  },
} as const;

const weixinAccountSchema = {
  type: "object",
  additionalProperties: true,
  properties: weixinAccountProperties,
} as const;

const botAgentSchema = {
  type: "string",
  description: "Self-declared bot_agent identifier for backend observability.",
} as const;

const replyProgressMessagesSchema = {
  type: "boolean",
  default: true,
  description: "Send structured tool-call progress messages.",
} as const;

const blockStreamingSchema = {
  type: "boolean",
  default: true,
  description: "Send completed text blocks before the final reply.",
} as const;

/** Top-level weixin config schema (token is stored in credentials file, not config). */
const weixinChannelConfigJsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    ...weixinAccountProperties,
    // Section-level routing also accepts the string form read by loadConfigRouteTag.
    routeTag: routeTagSchema,
    accounts: {
      type: "object",
      additionalProperties: weixinAccountSchema,
    },
    botAgent: botAgentSchema,
    blockStreaming: blockStreamingSchema,
    replyProgressMessages: replyProgressMessagesSchema,
    /** ISO 8601; bumped on each successful login to refresh gateway config from disk. */
    channelConfigUpdatedAt: { type: "string" },
  },
} as const;

export const WeixinChannelConfigSchema = buildJsonChannelConfigSchema(weixinChannelConfigJsonSchema);
