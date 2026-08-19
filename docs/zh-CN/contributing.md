# 贡献指南

[English](../CONTRIBUTING.md)

本仓库是 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) 的社区维护发行版。除非经批准实施独立规划的破坏性迁移，贡献必须保留 `openclaw-weixin` 插件/channel ID 及其现有配置和状态路径。

## 前置条件

- Node.js 24.15.0
- npm

请使用 `.nvmrc` 中指定的 Node.js 版本作为推荐开发环境。发布的包支持 Node.js
`>=22.22.3`，包括 Node.js 24 和 26。CI 会验证 Node.js 22.22.3 的精确下限、推荐的
Node.js 24.15.0 环境，以及当前 Node.js 26 运行时。推荐的 Node.js 24 与 OpenClaw
2026.7.1 组合会运行完整验证流程。Node.js 22 下限作业使用 OpenClaw 2026.7.1；最低支持
宿主 OpenClaw 2026.6.1 和浮动 beta 作业使用 Node.js 24.15.0。

## 开发

安装 lockfile 中记录的精确依赖版本：

```shell
npm ci
```

请阅读 [AGENTS.md](../../AGENTS.md) 和[架构指南](./architecture.md)，了解仓库约束、
生命周期和数据流。无论改动是手动编写还是借助编码 Agent 完成，都必须遵守这些规则。

迭代时运行一个受影响的测试套件：

```shell
npm run test:unit -- src/path/to/file.test.ts
```

运行快速的类型检查、样式检查和单元测试验证流程：

```shell
npm run check:fast
```

运行与 CI 相同的格式化、lint、类型检查、覆盖率测试和构建：

```shell
npm run check
```

以与 CI 和发布相同的严重性阈值审计插件随附的生产依赖。开发工具以及由宿主提供的 OpenClaw peer dependency 会被排除：

```shell
npm run audit:deps
```

使用以下命令应用仓库格式：

```shell
npm run format
```

修改入口点、构建输出或包元数据时，检查 npm 包内容：

```shell
npm pack --dry-run --ignore-scripts
```

仓库更严格的包契约检查为：

```shell
npm run pack:check
```

## ClawHub 包检查

ClawHub 使用包名 `openclaw-wechat`；规范的 npm 包和插件/channel ID 仍为 `openclaw-weixin`。在执行 `npm run check` 和 `npm run pack:check` 后，只能从该规范 npm tarball 构建 ClawPack，且所有中间文件都必须放在仓库外：

```shell
npm pack --ignore-scripts --pack-destination <canonical-output>
node scripts/prepare-clawhub-package.mjs <canonical-output> <clawhub-output>
mkdir <clawpack-root>
tar -xzf <clawhub-output>/openclaw-wechat-<version>.tgz -C <clawpack-root>
```

源目录必须恰好包含一个 `.tgz` 文件。转换器会拒绝非规范的包名或 npm 安装 spec、
格式错误的 registry-source 标记、放在错误的直接来源块中的命令，以及相对 registry
链接。它会更改临时包名和 ClawHub 安装选项，以英文源作为主 `README.md` 和
`README_EN.md`，将完整中文源写入 `README.zh_CN.md`，把所有暂存标题从
`openclaw-weixin` 改为 `openclaw-wechat`，并保留各语言 prompt。中文 prompt 先尝试
npm，失败后回退到 ClawHub；英文 prompt 则相反，从而使每个已发布包的主 README 与其
默认来源一致。转换器随后会将直接来源块的顺序从 npm 优先改为 ClawHub 优先。

规范源文件和 npm tarball 仍应以 `openclaw-weixin` 为标题、保持 npm 优先且不作修改；两种语言都必须保留两条精确的直接命令、绝对文档链接和 `openclaw-weixin` 运行时 ID。

使用固定版本的 ClawHub 验证器，并将其报告目录置于检出目录外；随后在不提供凭据的情况下预览发布：

```shell
npx --yes clawhub@0.23.3 package validate <clawpack-root>/package \
  --out <report-output> --openclaw-version 2026.7.1 --json
npx --yes clawhub@0.23.3 package publish \
  <clawhub-output>/openclaw-wechat-<version>.tgz \
  --family code-plugin --owner newfuture --display-name WeChat \
  --categories channels --topics wechat,weixin,messaging \
  --source-repo NewFuture/openclaw-weixin --source-commit <commit-sha> \
  --source-ref <git-ref> --dry-run --json
```

这些命令验证的是下一个候选版本；它们不会发布或修改现有的公开 ClawHub 发行版。
`.github/workflows/clawhub-publish.yml` 仅针对 pull request 执行这种无需凭据的验证。
生产 npmjs、ClawHub 和 GitHub Packages 发布会从精确的 release tag 并行启动；
GitHub Release 的收尾工作会等待三个作业全部完成。npmjs 和 ClawHub 分别使用受保护的
`npm-publish` 和 `clawhub-publish` 作业。两个目标都缺失时，等待两个环境均进入
Pending，在 **Review deployments** 中同时选择二者，然后只点击一次
**Approve and deploy**；UI 操作是共享的，但 OIDC 信任仍然相互隔离。各作业以成功的
发布响应为完成依据，不会在写入 registry 后立即回读确认。不要向 pull-request 工作流
添加生产发布调度、`id-token: write` 或长期有效的 registry 凭据。在真正的 ClawHub
命令启动前，release 工作流会持久化一个 `check run`，以及一个由 tag 和 commit 精确
限定、保留 90 天的 Actions artifact。ClawHub 独立于 npmjs 上传并存储自己的
ClawPack；显式 `clawhub:` 安装器会直接下载该 artifact。在任一发布边界之后发起新的
ClawHub 请求时，必须具备可核验的权威尝试记录和明确的恢复授权。

npmjs 和 GitHub Packages 无需保持无缺口的发布历史。当精确的当前目标不存在且 registry `latest` 更低时，其发布检查允许存在一个尚未发布的中间仓库版本。GitHub Packages 还会在发布前立即重新检查精确目标和 `latest`。绝不可移动不可变的跳过 tag 来填补 registry 缺口；应准备并发布下一个版本。

编辑 Markdown 文档或 `docs/site/` 中的文件后，将文档网站构建到 `docs/site/dist/`（与 GitHub Pages 运行的命令相同）。该站点是一个 [VitePress](https://vitepress.dev/) 项目，拥有自己的依赖，以保持已发布的包 manifest 不受影响；其测试使用 Node.js 运行，而不是根目录的 Vitest 项目：

```shell
npm ci --prefix docs/site
npm test --prefix docs/site
npm run build --prefix docs/site
```

使用 `npm run dev --prefix docs/site` 通过热重载预览站点，或使用任意静态文件服务器
提供 `docs/site/dist/`。两个命令都会先将仓库 Markdown 复制到
`docs/site/content/`，因此务必编辑原始文档。生成的 `content/` 和 `dist/` 目录被
Git 忽略；在 `docs/site/` 内只提交源文件。

简体中文是网站默认语言，发布在站点根路径；英文发布在 `/en/` 下。没有翻译的文档仍会在
每种语言中发布，保留现有语言的 Markdown 内容并附上未翻译提示，因此应在
`docs/site/.vitepress/docs.mjs` 中按已存在的语言源注册新页面。

## Agent 辅助工作

对于范围明确且有可观察测试判据的工作，请使用 **AI-ready Implementation Task** issue
表单。`agent:ready` 表示任务可以委派；`risk:privileged` 标记鉴权、持久状态、工作流、
发布、安全或包/插件元数据；`maintainer-only` 表示不得委派实现。Agent 辅助创建的 PR
必须关联任务，并说明可观察结果、定向判据、最高风险和剩余不确定性。不得向 Agent 提供
微信凭据，也不得让其访问真实后端。

`.github/workflows/copilot-setup-steps.yml` 使用 `npm ci` 准备标准 Node.js 24.15.0
环境，但不能替代定向测试或 `npm run check`。

## Pull request 要求

- 保持改动聚焦，并为行为变更加入测试。
- 为面向用户的文档更新 `README.md` 和 `README_EN.md`。
- 当改动影响用户时，更新两份 changelog。仅文档改动无需 changelog 条目。
- 从测试、日志、截图和 issue 描述中移除凭据、账号标识符、二维码和私信内容。
- Pull request 必须经过审阅并解决审阅线程。maintainer bypass 仅用于单维护者确有必要的
  工作，并保留可审计记录。
- 审阅并对提交的所有改动负责，包括由 AI 协助完成的改动。
