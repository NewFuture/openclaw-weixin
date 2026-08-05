import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import { weixinPlugin } from "./src/channel.js";
import { assertHostCompatibility } from "./src/compat.js";
import { WeixinConfigSchema } from "./src/config/config-schema.js";

export default {
  id: "openclaw-weixin",
  name: "Weixin",
  description: "Weixin channel (getUpdates long-poll + sendMessage)",
  // OpenClaw 2026.7.2-beta.7 publishes duplicate Zod declaration identities.
  configSchema: buildChannelConfigSchema(WeixinConfigSchema as never),
  register(api: OpenClawPluginApi) {
    // Fail-fast: reject incompatible host versions before any side-effects.
    assertHostCompatibility(api.runtime?.version);

    api.registerChannel({ plugin: weixinPlugin });
  },
};
