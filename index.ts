import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import { weixinPlugin } from "./src/channel.js";
import { assertHostCompatibility } from "./src/compat.js";
import { WeixinChannelConfigSchema } from "./src/config/config-schema.js";

export default {
  id: "openclaw-weixin",
  name: "WeChat",
  description: "Community-maintained WeChat (Weixin) channel plugin for OpenClaw using the iLink bot API.",
  configSchema: WeixinChannelConfigSchema,
  register(api: OpenClawPluginApi) {
    // Fail-fast: reject incompatible host versions before any side-effects.
    assertHostCompatibility(api.runtime?.version);

    api.registerChannel({ plugin: weixinPlugin });
  },
};
