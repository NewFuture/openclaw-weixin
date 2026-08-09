import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { rewriteLinks } from "./.vitepress/links.mjs";
import {
  syncContent,
  withUntranslatedNotice,
  withoutRepositoryOnlySections,
} from "./.vitepress/sync.mjs";

const SITE_DIR = fileURLToPath(new URL(".", import.meta.url));

describe("rewriteLinks", () => {
  const resolve = (target) => (target === "docs/guide.md" ? "/guide.md" : undefined);

  it("resolves links relative to the source document", () => {
    const markdown = "[指南](docs/guide.md)";
    assert.equal(rewriteLinks(markdown, { source: "README.md", resolve }), "[指南](/guide.md)");
    assert.equal(
      rewriteLinks("[指南](./guide.md)", { source: "docs/backend-api.md", resolve }),
      "[指南](/guide.md)",
    );
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
    const overview = await readFile(path.join(contentDir, "index.md"), "utf8");
    assert.match(
      overview,
      /^---\ntitle: "概览"\ndescription: "[^"]+"\npageClass: "docs-home"\nsidebar: false\naside: false\n---\n/,
    );
    assert.match(overview, /# openclaw-weixin/);
    assert.match(overview, /class="product-tagline">把 OpenClaw 接入微信/);
    assert.match(overview, /<h2 id="connect-wechat">选择一种安装方式/);
    assert.match(overview, /class="install-choice"/);
    assert.match(
      overview,
      /<strong>推荐复制提示词，也可以直接运行命令。<\/strong>/,
    );
    assert.match(overview, /两种方式效果相同，任选一种即可，不必重复执行/);
    assert.match(overview, /直接运行命令时，请使用运行 OpenClaw\s*的同一用户和同一环境/);
    assert.ok(
      overview.indexOf("同一用户和同一环境") <
        overview.indexOf('<h3 id="agent-install">'),
    );
    assert.match(overview, /openclaw plugins install npm:openclaw-weixin --force/);
    assert.match(
      overview,
      /请使用 OpenClaw 插件安装命令\n`openclaw plugins install npm:openclaw-weixin --force`/,
    );
    assert.match(overview, /不要先卸载或改用普通的 `npm install`/);
    assert.match(overview, /若不能运行\s*终端命令，请直接说明/);
    assert.match(
      overview,
      /若 Gateway 已自动重启，执行\n`openclaw channels status --probe` 检查连接；若未自动重启，先询问我是否重启，\n并在确认重启完成后再执行该探测/,
    );
    assert.match(
      overview,
      /若探测显示微信尚未登录，再提示我运行\n`openclaw channels login --channel openclaw-weixin` 扫码/,
    );
    assert.doesNotMatch(overview, /若连接没有\s*恢复，应重启/);
    assert.doesNotMatch(overview, /不要主动重启、检查状态|发起扫码/);
    assert.doesNotMatch(overview, /信任此 npm 来源/);
    assert.match(overview, /<h3 id="agent-install">复制提示词/);
    assert.match(overview, /<h3 id="cli-install">运行一条命令/);
    assert.match(overview, /<details id="verify-connection" class="full-check">/);
    assert.match(overview, /已有微信登录状态，完成任一种方式后通常即可使用/);
    assert.match(overview, /全新安装需要展开完整检查并扫码绑定/);
    assert.doesNotMatch(overview, /完成任一种方式后，通常即可使用/);
    assert.doesNotMatch(overview, /class="activation-path"/);
    assert.doesNotMatch(overview, /class="connection-path"/);
    assert.doesNotMatch(overview, /id="check-openclaw"/);
    assert.doesNotMatch(overview, /<span id=/);
    assert.match(
      overview,
      /openclaw channels login --channel openclaw-weixin --account wukong/,
    );
    assert.match(
      overview,
      /openclaw channels login --channel openclaw-weixin --account nezha/,
    );
    assert.doesNotMatch(
      overview,
      /--account (?:leader|jinjin|personal|work|alice|bob)/,
    );
    assert.ok(
      overview.indexOf(
        "openclaw config set session.dmScope per-account-channel-peer",
      ) <
        overview.indexOf(
          "openclaw channels login --channel openclaw-weixin --account wukong",
        ),
    );
    assert.match(overview, /全局会话设置，会影响所有渠道/);
    assert.ok(
      overview.indexOf("请使用 OpenClaw 插件安装命令") <
        overview.indexOf("openclaw plugins install npm:openclaw-weixin --force"),
    );

    const english = await readFile(
      path.join(contentDir, "en", "index.md"),
      "utf8",
    );
    assert.match(
      english,
      /Install or replace the plugin with OpenClaw's plugin installer by running exactly/,
    );
    assert.match(
      english,
      /<strong>We recommend the prompt; you can also run the command directly.<\/strong>/,
    );
    assert.match(
      english,
      /If you run the\s+command directly, use the same user and environment that run OpenClaw/,
    );
    assert.ok(
      english.indexOf("same user and environment") <
        english.indexOf('<h3 id="agent-install">'),
    );
    assert.match(english, /<h3 id="agent-install">Copy the prompt/);
    assert.match(english, /<h3 id="cli-install">Run one command/);
    assert.match(english, /already has a WeChat login,\s+either option is usually all you need/);
    assert.match(english, /For a new installation, open the full\s+check and scan the QR code/);
    assert.doesNotMatch(english, /After completing either option, you are usually done/);
    assert.match(
      english,
      /Do not uninstall first or\s+use plain `npm install`/,
    );
    assert.match(english, /If you cannot run terminal commands, say so/);
    assert.match(
      english,
      /run\s+`openclaw channels status --probe` if the Gateway restarted automatically/,
    );
    assert.match(
      english,
      /If it\s+did not, ask me whether to restart it and run the probe only after the restart is\s+confirmed complete/,
    );
    assert.match(
      english,
      /If the probe reports that WeChat is not logged in, tell me to run\s+`openclaw channels login --channel openclaw-weixin` and scan the QR code/,
    );
    assert.doesNotMatch(
      english,
      /restart the service that runs OpenClaw if the connection does not return/,
    );
    assert.doesNotMatch(
      english,
      /Do not restart, check status, or start QR login yourself/,
    );
    assert.match(
      english,
      /openclaw channels login --channel openclaw-weixin --account alice/,
    );
    assert.match(
      english,
      /openclaw channels login --channel openclaw-weixin --account bob/,
    );
    assert.doesNotMatch(english, /--account (?:leader|jinjin|personal|work)/);
    assert.ok(
      english.indexOf(
        "openclaw config set session.dmScope per-account-channel-peer",
      ) <
        english.indexOf(
          "openclaw channels login --channel openclaw-weixin --account alice",
        ),
    );
    assert.match(english, /global OpenClaw session setting/);
    assert.doesNotMatch(english, /trust this npm source/i);
  });

  it("rewrites cross-document links onto same-locale site paths", async () => {
    const overview = await readFile(path.join(contentDir, "index.md"), "utf8");
    assert.match(overview, /\[详细指南\]\(\/guide\.md\)/);
    assert.match(overview, /\[架构说明\]\(\/architecture\.md\)/);
    assert.doesNotMatch(overview, /docs-site:repo-only/);
    assert.doesNotMatch(overview, /\[English\]\(/);

    const english = await readFile(path.join(contentDir, "en", "index.md"), "utf8");
    assert.match(english, /\[Detailed guide\]\(\/en\/guide\.md\)/);
    assert.doesNotMatch(english, /\[简体中文\]\(/);
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
