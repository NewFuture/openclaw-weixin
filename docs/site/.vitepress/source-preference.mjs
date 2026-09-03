import { preferRegistryReadmeSource } from "../../../scripts/registry-readme.mjs";

const CHINESE_NPM_PRIORITY =
  "优先使用 npm `npm:openclaw-weixin`；仅在 npm 明确不可用时使用 ClawHub `clawhub:openclaw-wechat`";
const CHINESE_CLAWHUB_PRIORITY =
  "优先使用 ClawHub `clawhub:openclaw-wechat`；仅在 ClawHub 明确不可用时使用 npm `npm:openclaw-weixin`";

export function preferClawHubForWebsiteHome(page, markdown) {
  if (page.slug !== "index") return markdown;

  const reordered = preferRegistryReadmeSource(markdown, "clawhub", { fileName: page.source });
  if (page.locale !== "zh") return reordered;

  const occurrences = reordered.split(CHINESE_NPM_PRIORITY).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${page.source}: expected one Chinese npm-first prompt, found ${occurrences}`);
  }
  return reordered.replace(CHINESE_NPM_PRIORITY, CHINESE_CLAWHUB_PRIORITY);
}
