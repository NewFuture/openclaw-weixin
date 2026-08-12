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
  const resolve = (target) => (target === "docs/guide.md" ? "/guide.md" : undefined);

  it("resolves links relative to the source document", () => {
    const markdown = "[指南](docs/guide.md)";
    assert.equal(rewriteLinks(markdown, { source: "README.md", resolve }), "[指南](/guide.md)");
    assert.equal(rewriteLinks("[指南](./guide.md)", { source: "docs/backend-api.md", resolve }), "[指南](/guide.md)");
  });

  it("keeps anchors and leaves external links untouched", () => {
    assert.equal(
      rewriteLinks("[安装](docs/guide.md#安装)", { source: "README.md", resolve }),
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
    assert.ok(pages.length >= 18);
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
    assert.match(overview, /class="product-tagline">把 OpenClaw 接入微信/);
    assert.match(overview, /<h2 id="connect-wechat">选择一种安装方式/);
    assert.deepEqual(assertRegistryReadmeOrder(overview, "npm", { fileName: "index.md" }).order, ["npm", "clawhub"]);
    const chinesePrompt = assertRegistryPrompt(overview, { fileName: "index.md" });
    assert.match(overview, /ClawHub \| `openclaw-wechat`/);
    assert.match(overview, /npm \| `openclaw-weixin`/);
    assert.match(chinesePrompt.value, /全程只安装一个。\r?\n请遵循 OpenClaw 的安装策略/);
    assert.match(overview, /腾讯官方 npm 包是 `@tencent-weixin\/openclaw-weixin`/);
    assert.match(overview, /当前能力包括微信私聊、文本与媒体收发、扫码登录和多账号/);
    assert.match(overview, /插件没有声明群聊能力/);
    assert.match(overview, /OpenClaw `>=2026\.6\.1`/);
    assert.match(overview, /`>=22\.22\.3 <23`、`>=24\.15\.0 <25` 或 `>=25\.9\.0`/);
    assert.match(overview, /\*\*任选一个即可，不要同时安装。\*\* 本插件需要/);
    assert.match(overview, /推荐复制提示词，也可以直接运行命令/);
    assert.match(
      overview,
      /class="install-choice"[\s\S]*href="#agent-install"[\s\S]*复制提示词[\s\S]*href="#direct-install"[\s\S]*运行命令/,
    );
    assert.equal((overview.match(/class="install-choice"/g) ?? []).length, 1);
    assert.ok(
      chinesePrompt.value.indexOf("npm:openclaw-weixin") < chinesePrompt.value.indexOf("clawhub:openclaw-wechat"),
    );
    assert.match(overview, /<h3 id="direct-install">直接运行命令/);
    assert.match(overview, /<h4 id="npm-source">npm：/);
    assert.match(overview, /<h4 id="clawhub-source">ClawHub：/);
    assert.equal((overview.match(/class="prompt-lead"/g) ?? []).length, 1);
    assert.doesNotMatch(overview, /id="(?:npm|clawhub)-agent-install"/);
    assert.match(overview, /<h5 id="clawhub-cli-install">ClawHub 命令/);
    assert.match(overview, /不会绕过 OpenClaw 的安装策略或内置依赖拒绝列表/);
    assert.ok(chinesePrompt.start < overview.indexOf('<h3 id="direct-install">'));
    assert.ok(overview.indexOf('<h4 id="clawhub-source">') < overview.indexOf("## 两个社区入口"));
    assert.match(overview, /<details id="verify-connection" class="full-check">/);
    assert.match(overview, /已有微信登录状态，安装后通常只需确认连接/);
    assert.match(overview, /全新安装需要展开完整检查并扫码绑定/);
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
    assert.match(english, /<h2 id="connect-wechat">Choose an installation method/);
    assert.match(english, /Copy the prompt, or run a command directly/);
    assert.match(
      english,
      /class="install-choice"[\s\S]*href="#agent-install"[\s\S]*Copy the prompt[\s\S]*href="#direct-install"[\s\S]*Run a command/,
    );
    assert.equal((english.match(/class="install-choice"/g) ?? []).length, 1);
    assert.equal((english.match(/class="prompt-lead"/g) ?? []).length, 1);
    assert.doesNotMatch(english, /id="(?:npm|clawhub)-agent-install"/);
    assert.match(english, /<h3 id="direct-install">Run a command directly/);
    assert.match(english, /<h4 id="npm-source">npm:/);
    assert.match(english, /<h4 id="clawhub-source">ClawHub:/);
    assert.match(english, /openclaw plugins install clawhub:openclaw-wechat --force/);
    assert.match(english, /already has a WeChat login,\s+you usually only need to confirm the connection/);
    assert.match(english, /For a\s+new installation, open the full\s+check and scan the QR code/);
    assert.match(english, /openclaw channels login --channel openclaw-weixin --account alice/);
    assert.match(english, /openclaw channels login --channel openclaw-weixin --account bob/);
    assert.doesNotMatch(english, /--account (?:leader|jinjin|personal|work)/);
    assert.ok(
      english.indexOf("openclaw config set session.dmScope per-account-channel-peer") <
        english.indexOf("openclaw channels login --channel openclaw-weixin --account alice"),
    );
    assert.match(english, /global OpenClaw session setting/);
    assert.match(english, /does not bypass OpenClaw's\s+install policy or built-in dependency denylist/);
    assert.ok(englishPrompt.start < english.indexOf('<h3 id="direct-install">'));
    assert.ok(english.indexOf('<h4 id="clawhub-source">') < english.indexOf("## Community package sources"));
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
    assert.match(overview, /## 两个社区入口/);
    assert.match(overview, /npm \| `openclaw-weixin`/);
    assert.match(overview, /ClawHub \| `openclaw-wechat`/);
    assert.doesNotMatch(overview, /\| 安装后 \|/);
    assert.doesNotMatch(overview, /\| 腾讯上游独立包 \|/);
    assert.match(overview, /社区维护发行版；腾讯官方 npm 包是 `@tencent-weixin\/openclaw-weixin`/);
    assert.match(overview, /沿用腾讯版的\s+插件、Channel 和状态 ID/);
    assert.match(overview, /可原位替换并保留现有配置与登录状态/);

    const english = await readFile(path.join(contentDir, "en", "index.md"), "utf8");
    assert.match(english, /## Community package sources/);
    assert.match(english, /npm \| `openclaw-weixin`/);
    assert.match(english, /ClawHub \| `openclaw-wechat`/);
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

  it("marks locale copies that still carry the English text", async () => {
    const contributing = await readFile(path.join(contentDir, "contributing.md"), "utf8");
    assert.match(contributing, /^---\ntitle: "参与贡献"/);
    assert.match(contributing, /\n# Contributing\n\n::: warning 尚未翻译\n本页尚无中文翻译，以下为英文原文。\n:::\n/);

    const translated = await readFile(path.join(contentDir, "guide.md"), "utf8");
    assert.doesNotMatch(translated, /尚未翻译/);
    const architecture = await readFile(path.join(contentDir, "architecture.md"), "utf8");
    assert.match(architecture, /\n# 架构说明\r?\n/);
    assert.doesNotMatch(architecture, /尚未翻译/);
    const english = await readFile(path.join(contentDir, "en", "architecture.md"), "utf8");
    assert.doesNotMatch(english, /::: warning/);
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
