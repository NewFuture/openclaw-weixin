import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { assertRegistryPrompt, assertRegistryReadmeOrder } from "../../scripts/registry-readme.mjs";
import { rewriteLinks } from "./.vitepress/links.mjs";
import { syncContent, withoutRepositoryOnlySections, withUntranslatedNotice } from "./.vitepress/sync.mjs";

const SITE_DIR = fileURLToPath(new URL(".", import.meta.url));

describe("rewriteLinks", () => {
  const resolve = (target) => (target === "docs/zh-CN/guide.md" ? "/guide.md" : undefined);

  it("resolves links relative to the source document", () => {
    const markdown = "[指南](docs/zh-CN/guide.md)";
    assert.equal(rewriteLinks(markdown, { source: "README.md", resolve }), "[指南](/guide.md)");
    assert.equal(
      rewriteLinks("[指南](./guide.md)", { source: "docs/zh-CN/backend-api.md", resolve }),
      "[指南](/guide.md)",
    );
  });

  it("keeps anchors and leaves external links untouched", () => {
    assert.equal(
      rewriteLinks("[安装](docs/zh-CN/guide.md#安装)", { source: "README.md", resolve }),
      "[安装](/guide.md#安装)",
    );
    assert.equal(
      rewriteLinks("[上游](https://example.test)", { source: "README.md", resolve }),
      "[上游](https://example.test)",
    );
    assert.equal(rewriteLinks("[本页](#安装)", { source: "README.md", resolve }), "[本页](#安装)");
  });

  it("falls back to GitHub for repository files the site does not publish", () => {
    assert.equal(
      rewriteLinks("[license](LICENSE)", { source: "README.md", resolve }),
      "[license](https://github.com/NewFuture/openclaw-weixin/blob/main/LICENSE)",
    );
  });
});

describe("syncContent", () => {
  let contentDir;
  let pages;

  before(async () => {
    contentDir = path.join(await mkdtemp(path.join(os.tmpdir(), "openclaw-site-")), "content");
    ({ pages } = await syncContent({ contentDir }));
  });

  after(async () => {
    await rm(path.dirname(contentDir), { recursive: true, force: true });
  });

  it("writes one page per document and locale", async () => {
    assert.ok(pages.length >= 16);
    for (const page of pages) {
      await readFile(path.join(contentDir, `${page.path}.md`), "utf8");
    }
  });

  it("prefixes every page with its title and description", async () => {
    const overview = (await readFile(path.join(contentDir, "index.md"), "utf8")).replaceAll("\r\n", "\n");
    assert.match(
      overview,
      /^---\ntitle: "概览"\ndescription: "[^"]+"\npageClass: "docs-home"\nsidebar: false\naside: false\n---\n/,
    );
    assert.match(overview, /# openclaw-weixin/);
    assert.match(overview, /\*\*把 OpenClaw 接入微信\*\*/);
    assert.match(overview, /<a id="connect-wechat"><\/a>\n\n## 选择一种安装方式/);
    assert.deepEqual(assertRegistryReadmeOrder(overview, "npm", { fileName: "index.md" }).order, ["npm", "clawhub"]);
    const chinesePrompt = assertRegistryPrompt(overview, { fileName: "index.md" });
    assert.match(chinesePrompt.value, /全程只安装一个。\r?\n请遵循 OpenClaw 的安装策略/);
    assert.match(overview, /腾讯官方 npm 包是 `@tencent-weixin\/openclaw-weixin`/);
    assert.match(overview, /当前能力包括微信私聊、文本与媒体收发、扫码登录和多账号/);
    assert.doesNotMatch(overview, /### 为什么选择社区版|\| 对比项 \|/);
    assert.doesNotMatch(overview, /npm 优先，ClawHub 兜底|自己选择 npm 或 ClawHub/);
    assert.match(overview, /OpenClaw `>=2026\.6\.1`/);
    assert.match(overview, /`>=22\.22\.3 <23`、`>=24\.15\.0 <25` 或 `>=25\.9\.0`/);
    assert.match(overview, /## 两个安装源/);
    assert.match(overview, /\[`openclaw-weixin`\]\(https:\/\/www\.npmjs\.com\/package\/openclaw-weixin\)/);
    assert.match(overview, /\[`openclaw-wechat`\]\(https:\/\/clawhub\.ai\/newfuture\/plugins\/openclaw-wechat\)/);
    assert.doesNotMatch(overview, /不要同时安装/);
    assert.match(overview, /推荐复制提示词，也可以直接运行命令/);
    assert.match(overview, /- \[\*\*复制提示词\*\*\]\(#agent-install\)\n- \[\*\*运行命令\*\*\]\(#direct-install\)/);
    assert.doesNotMatch(overview, /<(?:p|div|h[1-6]|strong|ul|li|code)\b/);
    assert.ok(
      chinesePrompt.value.indexOf("npm:openclaw-weixin") < chinesePrompt.value.indexOf("clawhub:openclaw-wechat"),
    );
    assert.match(overview, /<a id="direct-install"><\/a>\n\n### 直接运行命令/);
    assert.match(overview, /#### npm：`openclaw-weixin`/);
    assert.match(overview, /#### ClawHub：`openclaw-wechat`/);
    assert.match(overview, /把下面这段话粘贴到 OpenClaw 聊天框并发送/);
    assert.doesNotMatch(overview, /id="(?:npm|clawhub)-agent-install"/);
    assert.match(overview, /##### ClawHub 命令/);
    assert.match(overview, /不会绕过 OpenClaw 的安装策略或内置依赖拒绝列表/);
    assert.ok(chinesePrompt.start < overview.indexOf("### 直接运行命令"));
    assert.ok(overview.indexOf("#### ClawHub：") < overview.indexOf("## 两个安装源"));
    assert.match(overview, /<details id="verify-connection" class="full-check">/);
    assert.match(overview, /已有微信登录状态，安装后通常只需确认连接/);
    assert.match(overview, /全新安装需要[\s>]+展开完整检查并扫码绑定/);
    assert.match(overview, /openclaw channels login --channel openclaw-weixin --account wukong/);
    assert.match(overview, /openclaw channels login --channel openclaw-weixin --account nezha/);
    assert.doesNotMatch(overview, /--account (?:leader|jinjin|personal|work|alice|bob)/);
    assert.ok(
      overview.indexOf("openclaw config set session.dmScope per-account-channel-peer") <
        overview.indexOf("openclaw channels login --channel openclaw-weixin --account wukong"),
    );
    assert.match(overview, /全局会话设置，会影响所有渠道/);
    assert.doesNotMatch(overview, /\]\((?:\.\/)?README|\]\(docs\//);

    const english = (await readFile(path.join(contentDir, "en", "index.md"), "utf8")).replaceAll("\r\n", "\n");
    assert.deepEqual(assertRegistryReadmeOrder(english, "npm", { fileName: "en/index.md" }).order, ["npm", "clawhub"]);
    const englishPrompt = assertRegistryPrompt(english, { fileName: "en/index.md" });
    assert.match(englishPrompt.value, /and install only one\.\r?\nFollow OpenClaw's install policy/);
    assert.ok(
      englishPrompt.value.indexOf("clawhub:openclaw-wechat") < englishPrompt.value.indexOf("npm:openclaw-weixin"),
    );
    assert.match(english, /<a id="connect-wechat"><\/a>\n\n## Choose an installation method/);
    assert.match(english, /Copy the prompt, or run a command directly/);
    assert.match(english, /how fixes, new features, and security updates are incorporated/);
    assert.match(
      english,
      /Current capabilities include direct chats, text and media transfer, QR login,\s+and multiple accounts/,
    );
    assert.doesNotMatch(english, /### Why choose the community distribution|\| Comparison \|/);
    assert.doesNotMatch(english, /ClawHub first, npm fallback|Choose npm or ClawHub yourself/);
    assert.doesNotMatch(english, /does not advertise group-chat support/);
    assert.match(english, /## Installation sources/);
    assert.doesNotMatch(english, /do not install both|Do not install multiple distributions/);
    assert.match(
      english,
      /- \[\*\*Copy the prompt\*\*\]\(#agent-install\)\n- \[\*\*Run a command\*\*\]\(#direct-install\)/,
    );
    assert.doesNotMatch(english, /<(?:p|div|h[1-6]|strong|ul|li|code)\b/);
    assert.doesNotMatch(english, /id="(?:npm|clawhub)-agent-install"/);
    assert.match(english, /<a id="direct-install"><\/a>\n\n### Run a command directly/);
    assert.match(english, /#### npm: `openclaw-weixin`/);
    assert.match(english, /#### ClawHub: `openclaw-wechat`/);
    assert.match(english, /openclaw plugins install clawhub:openclaw-wechat --force/);
    assert.match(english, /already has a WeChat login,[\s>]+you usually only need[\s>]+to confirm the connection/);
    assert.match(english, /For a new installation, open[\s>]+the full check and scan the QR code/);
    assert.match(english, /openclaw channels login --channel openclaw-weixin --account alice/);
    assert.match(english, /openclaw channels login --channel openclaw-weixin --account bob/);
    assert.doesNotMatch(english, /--account (?:leader|jinjin|personal|work)/);
    assert.ok(
      english.indexOf("openclaw config set session.dmScope per-account-channel-peer") <
        english.indexOf("openclaw channels login --channel openclaw-weixin --account alice"),
    );
    assert.match(english, /global OpenClaw session setting/);
    assert.match(english, /does not bypass OpenClaw's[\s>]+install policy or built-in dependency[\s>]+denylist/);
    assert.ok(englishPrompt.start < english.indexOf("### Run a command directly"));
    assert.ok(english.indexOf("#### ClawHub:") < english.indexOf("## Installation sources"));
    assert.match(
      english,
      /https:\/\/openclaw-weixin\.newfuture\.cc\/en\/guide\.html#channel-shows-ok-but-doesn-t-connect/,
    );
    assert.doesNotMatch(english, /\]\((?:\.\/)?README|\]\(docs\//);
  });

  it("keeps registry-safe documentation links absolute", async () => {
    const overview = (await readFile(path.join(contentDir, "index.md"), "utf8")).replaceAll("\r\n", "\n");
    assert.match(overview, /\[详细指南\]\(https:\/\/openclaw-weixin\.newfuture\.cc\/guide\.html\)/);
    assert.match(overview, /\[架构说明\]\(https:\/\/openclaw-weixin\.newfuture\.cc\/architecture\.html\)/);
    assert.doesNotMatch(overview, /docs-site:repo-only/);
    assert.doesNotMatch(overview, /\[English\]\(/);

    const english = (await readFile(path.join(contentDir, "en", "index.md"), "utf8")).replaceAll("\r\n", "\n");
    assert.match(english, /\[Detailed guide\]\(https:\/\/openclaw-weixin\.newfuture\.cc\/en\/guide\.html\)/);
    assert.doesNotMatch(english, /\[简体中文\]\(/);
  });

  it("keeps source choices in the table and explains Tencent compatibility below it", async () => {
    const overview = await readFile(path.join(contentDir, "index.md"), "utf8");
    assert.match(overview, /## 两个安装源/);
    assert.match(overview, /npm \| \[`openclaw-weixin`\]\(https:\/\/www\.npmjs\.com\/package\/openclaw-weixin\)/);
    assert.match(
      overview,
      /ClawHub \| \[`openclaw-wechat`\]\(https:\/\/clawhub\.ai\/newfuture\/plugins\/openclaw-wechat\)/,
    );
    assert.doesNotMatch(overview, /\| 安装后 \|/);
    assert.doesNotMatch(overview, /\| 腾讯上游独立包 \|/);
    assert.match(overview, /社区维护发行版；腾讯官方 npm 包是 `@tencent-weixin\/openclaw-weixin`/);
    assert.match(overview, /沿用腾讯版的\s+插件、Channel 和状态 ID/);
    assert.match(overview, /可原位替换并保留现有配置与登录状态/);

    const english = await readFile(path.join(contentDir, "en", "index.md"), "utf8");
    assert.match(english, /## Installation sources/);
    assert.match(english, /npm \| \[`openclaw-weixin`\]\(https:\/\/www\.npmjs\.com\/package\/openclaw-weixin\)/);
    assert.match(
      english,
      /ClawHub \| \[`openclaw-wechat`\]\(https:\/\/clawhub\.ai\/newfuture\/plugins\/openclaw-wechat\)/,
    );
    assert.doesNotMatch(english, /\| After installation \|/);
    assert.doesNotMatch(english, /\| Tencent upstream distribution \|/);
    assert.match(
      english,
      /community-maintained distribution of[\s\S]*Tencent's\s+official npm package is `@tencent-weixin\/openclaw-weixin`/,
    );
    assert.match(english, /retains Tencent's plugin, channel, and state\s+ID/);
    assert.match(english, /in-place replacement that preserves configuration and login\s+state/);

    const guide = await readFile(path.join(contentDir, "guide.md"), "utf8");
    assert.match(guide, /### 在不同场景使用哪个名称/);
    assert.doesNotMatch(guide, /\| 安装后 \|/);
    assert.match(guide, /腾讯官方 npm 包是\s+`@tencent-weixin\/openclaw-weixin`/);
    assert.match(guide, /沿用\s+`openclaw-weixin` 插件、Channel 和状态 ID/);

    const englishGuide = await readFile(path.join(contentDir, "en", "guide.md"), "utf8");
    assert.match(englishGuide, /### Which name to use/);
    assert.doesNotMatch(englishGuide, /\| After installation \|/);
    assert.match(englishGuide, /Tencent's official npm package is `@tencent-weixin\/openclaw-weixin`/);
    assert.match(englishGuide, /keep the `openclaw-weixin` plugin,\s+channel, and state ID/);
  });

  it("documents current backend and outbound behavior in both locales", async () => {
    const chineseBackend = await readFile(path.join(contentDir, "backend-api.md"), "utf8");
    assert.match(chineseBackend, /`local_token_list` 最多包含账号索引中最近注册的 10 个本地 `bot_token`/);
    assert.match(chineseBackend, /当前插件始终传入 `no_need_thumb: true`，只上传原始媒体/);
    assert.doesNotMatch(chineseBackend, /获取 `upload_param` 和\s+`thumb_upload_param`/);

    const englishBackend = await readFile(path.join(contentDir, "en", "backend-api.md"), "utf8");
    assert.match(englishBackend, /`local_token_list` contains up to 10 local `bot_token` values/);
    assert.match(
      englishBackend,
      /current plugin always sends `no_need_thumb: true`, uploads only the original\s+media/,
    );
    assert.doesNotMatch(englishBackend, /obtain `upload_param` and `thumb_upload_param`/);

    const overview = await readFile(path.join(contentDir, "index.md"), "utf8");
    assert.match(overview, /## 主动与定时发送/);
    assert.match(overview, /token 缺失时，插件会拒绝发送消息，不会返回本地“成功”\s+结果/);
    assert.match(overview, /`delivery\.to` 和 `delivery\.accountId`/);

    const englishOverview = await readFile(path.join(contentDir, "en", "index.md"), "utf8");
    assert.match(englishOverview, /## Proactive and scheduled sends/);
    assert.match(
      englishOverview,
      /token is missing, the plugin\s+refuses delivery instead of returning a local success result/,
    );
    assert.match(englishOverview, /`delivery\.to` and `delivery\.accountId`/);

    const guide = await readFile(path.join(contentDir, "guide.md"), "utf8");
    assert.match(guide, /`replyProgressMessages` 默认为 `true`/);
    assert.match(guide, /"replyProgressMessages": false/);
    assert.match(guide, /设为 `false` 只会停止工具调用进度消息/);

    const englishGuide = await readFile(path.join(contentDir, "en", "guide.md"), "utf8");
    assert.match(englishGuide, /`replyProgressMessages` defaults to `true`/);
    assert.match(englishGuide, /"replyProgressMessages": false/);
    assert.match(englishGuide, /suppresses only tool-call progress messages/);
  });

  it("publishes explicit translations without fallback notices", async () => {
    const contributing = await readFile(path.join(contentDir, "contributing.md"), "utf8");
    assert.match(contributing, /^---\ntitle: "参与贡献"/);
    assert.match(contributing, /\n# 贡献指南\r?\n/);
    assert.match(await readFile(path.join(contentDir, "release.md"), "utf8"), /\n# npmjs、GitHub Packages/);
    assert.match(await readFile(path.join(contentDir, "security.md"), "utf8"), /\n# 安全策略\r?\n/);
    for (const page of pages) {
      const markdown = await readFile(path.join(contentDir, `${page.path}.md`), "utf8");
      assert.doesNotMatch(markdown, /::: warning (?:尚未翻译|Not translated yet)/);
    }
  });

  it("publishes the logo so the theme can reference it", async () => {
    const logo = await readFile(path.join(contentDir, "public", "logo.svg"), "utf8");
    assert.equal(logo, await readFile(path.join(SITE_DIR, "logo.svg"), "utf8"));
  });
});

describe("withoutRepositoryOnlySections", () => {
  it("removes repository navigation while preserving adjacent content", () => {
    const source = [
      "# Title",
      "<!-- docs-site:repo-only:start -->",
      "[Language](README.md)",
      "<!-- docs-site:repo-only:end -->",
      "Body",
    ].join("\n");
    assert.equal(withoutRepositoryOnlySections(source), "# Title\nBody");
  });
});

describe("withUntranslatedNotice", () => {
  const notice = { title: "尚未翻译", body: "本页尚无中文翻译，以下为英文原文。" };

  it("leaves translated pages untouched", () => {
    assert.equal(withUntranslatedNotice("# Title\n\nBody", undefined), "# Title\n\nBody");
  });

  it("inserts the notice after the document title", () => {
    assert.equal(
      withUntranslatedNotice("# Title\n\nBody", notice),
      "# Title\n\n::: warning 尚未翻译\n本页尚无中文翻译，以下为英文原文。\n:::\n\nBody",
    );
  });

  it("prepends the notice when the document has no title", () => {
    assert.match(withUntranslatedNotice("Body", notice), /^::: warning 尚未翻译\n/);
  });
});
