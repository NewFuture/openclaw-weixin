# npmjs、GitHub Packages、GitHub Release 与 ClawHub 发布流程

[English](../en/release.md)

`openclaw-weixin` 将规范包发布到官方 npm registry，将对应的 ClawPack 发布到
ClawHub 条目 `openclaw-wechat`，将包镜像到 GitHub Packages，名称为
`@newfuture/openclaw-weixin`，并创建对应的 GitHub Release。ClawPack 内嵌的
插件/channel ID 保持为 `openclaw-weixin`。绝不可提交 registry token。npmjs 与
ClawHub 的发布分别使用独立的受保护 GitHub OIDC job 和环境；GitHub Packages job
仅将其临时 `GITHUB_TOKEN` 作为 `NODE_AUTH_TOKEN` 暴露。

## 发布前提条件

1. 将 GitHub 仓库设为公开，以便 npm 验证包的来源证明。
2. 对于新发布，确认目标版本尚未发布到 npmjs、ClawHub、GitHub Packages，也尚未作为
   GitHub Release 发布。恢复运行可补齐缺失的发布目标。
3. 确认受保护 GitHub 环境 `npm-publish` 和 `clawhub-publish` 均要求仓库管理员
   `NewFuture` 批准，并且仅允许从匹配 `v*` 的标签部署。永久保留两个环境，以确保其
   信任和部署历史始终相互隔离。
4. 确认仓库标签规则集允许 CI 创建 `v*` 标签，但阻止更新和删除它们。工作流还会在每次
   不可逆发布前立即解析远端标签的当前指向。
5. 确认 npm 包已配置 GitHub Actions Trusted Publisher：所有者为 `NewFuture`，仓库为
   `openclaw-weixin`，工作流为 `release.yml`，环境为 `npm-publish`。环境名称区分
   大小写。
6. 在拆分后的工作流合并前，ClawHub 包的可信发布者应继续使用仓库
   `NewFuture/openclaw-weixin`、工作流 `release.yml` 和环境 `npm-publish`。合并后，
   按照下文迁移步骤只将其环境改为 `clawhub-publish`；不得改动 npm 可信发布者。
7. 确认仓库允许工作流写入 GitHub Packages。首次发布
   `@newfuture/openclaw-weixin` 默认是私有的；如果需要公开条目，请在 GitHub 包设置中
   设置其可见性。GitHub 上的 npm 包即使公开也需要认证。
8. 在精确且干净的发布 commit 上运行 `npm ci`、`npm run check:versions`、
   `npm run audit:deps`、`npm run check` 和 `npm run pack:check`。
9. 确认 `package.json`、`package-lock.json`、`openclaw.plugin.json`、
   `CHANGELOG.md` 和 `CHANGELOG_EN.md` 使用相同的发布版本。
10. 通过 squash 或 merge commit 合并发布 pull request。禁止 rebase merge，因为其中间
    版本变更 commit 不是在 `main` 上完成验证的最终目录树。

## 可信发布

配置 Trusted Publishing 后：

1. 更新 `package.json`、`package-lock.json` 中的两个版本字段和
   `openclaw.plugin.json`，然后将两个 changelog 的未发布条目移入同一个带日期的发布
   章节。`CHANGELOG.md` 中的中文仍为默认语言；英文维护在 `CHANGELOG_EN.md` 中。
2. 创建 pull request。CI 会拒绝元数据不匹配、缺少双语 changelog 发布、不稳定版本及
   版本降级。
3. 通过 squash-merge 或 merge 合并干净的发布 commit。`main` 上所有必需的 Linux 和
   Windows 检查均通过后，CI 会创建缺失的对应标签，例如 `v3.0.0`，并分派对应的协同
   发布流程。

`.github/workflows/release.yml` 会验证精确标签和 `release-transition` commit，从 lockfile 安装，
执行依赖审计、类型检查、测试、构建、包内容检查、ClawPack 结构转换、ClawHub 验证和
无需凭据的发布 dry-run。随后它会独立检查 npmjs 和 ClawHub。仅当现有 ClawHub 版本的
包、所有者、源仓库、源 commit、源标签及内嵌插件/channel 身份与该发布完全一致时，
才会接受该版本。

`npm-publish`、`clawhub-publish` 和 `github-package` job 均直接依赖共享验证 job，
因此三个包目标可以并发推进。缺失的 npmjs 和 ClawHub 目标会请求各自的受保护环境。
当两者都缺失时，等待两者都出现在 **Review deployments** 中，选中两个环境，然后只点击
一次 **Approve and deploy**。GitHub 会将这一次 UI 操作应用到两个 job，但每个 job
仅获得其自身环境和 OIDC 信任边界。如果仅缺失一个目标，只批准对应环境。如果两个精确
目标都存在，两个环境都不会请求批准。GitHub Packages job 使用仓库的 `GITHUB_TOKEN`，
并执行自己的精确版本预检查。会报告缺失的中间镜像版本，但不会阻止精确当前目标。

在不可逆命令之前，每个包 job 都会验证远端标签的当前指向，并重新检查自己的目标。GitHub Packages
还会在该边界重新读取 `latest`，以免构建期间的另一项发布导致本次发布将 dist-tag
回退。npmjs 和 GitHub Packages job 将成功的 `npm publish` 响应视为完成，而不会立即
查询可能仍在传播新版本的 registry。ClawHub job 等待其发布响应，并要求
`publicationStatus` 为 `published`。ClawHub 会存储上传的 ClawPack，且该包的默认
`clawhub:` installer 会直接下载该 artifact。npmjs 和 ClawHub job 是仅有的拥有
`id-token: write` 的 job。

三个包发布 job 全部成功，或者正确跳过现有目标后，一个最小权限 job 会使用从已版本化的
中英文 changelog 章节渲染的说明创建对应 GitHub Release。OIDC、GitHub Packages 写入
权限和 GitHub contents 写入权限始终隔离在各自的 job 中。

| npmjs 目标 | ClawHub 目标 | 受保护 job 行为 |
| --- | --- | --- |
| 缺失 | 缺失 | 等待两个环境，选中两个环境，批准一次；npmjs、ClawHub 和 GitHub Packages 独立推进 |
| 精确版本存在 | 缺失 | 仅 `clawhub-publish` 请求批准；GitHub Packages 独立推进 |
| 缺失 | 精确匹配的版本存在 | 仅 `npm-publish` 请求批准；GitHub Packages 独立推进 |
| 精确版本存在 | 精确匹配的版本存在 | 两个环境均不请求批准；在完成 GitHub Release 前检查 GitHub Packages |
| 任一状态 | ClawHub 缺失且已有先前发布边界 | npmjs 和 GitHub Packages 可以独立完成，但要在重复发起 ClawHub 请求之前停止，且不得完成 GitHub Release |
| 任一状态 | 版本存在但源或运行时身份不匹配 | 失败；绝不将其视为恢复成功 |

CI 会在其新创建的标签上显式分派该工作流，因为使用 `GITHUB_TOKEN` 创建的标签不会递归
触发标签推送工作流。维护者通过重新运行原始 workflow run 来恢复失败的发布；拒绝从分支
发起的 dispatch，且每次新的受保护 registry 发布尝试都需要各自的环境批准。每个包目标
均会在其发布命令前独立检查。
ClawHub 发布开始前，工作流会同时持久化一个与特定标签和 commit 绑定的 `check run`
以及一个保存 90 天的边界 artifact。如果 ClawHub 仍缺失，任一标记都会使自动化按
失败关闭（fail-closed）原则终止，而不是提交重复请求。`check run` 会在 artifact 过期后保留。存在的
精确包版本会被跳过，而缺失的包目标继续独立推进；仅在全部三个包 job 完成后，才运行
GitHub Release。
npmjs 发布前，后续 `main` 推送可以协调中断的标签或工作流分派。一旦 npmjs 包含该
版本，`main` 协调器就将该发布视为已分派；ClawHub、GitHub Packages 或最终 GitHub
Release job 的失败必须通过从现有标签重新运行 `release.yml` 来恢复。只有在引入该版本的
first-parent commit 上运行的 CI 才能创建缺失标签。后续同版本运行可以协调现有标签，
但不能凭空创建标签；满足了仓库可见性等受阻前提条件后，请重新运行原始发布 commit 的
工作流。如果 npmjs 已包含某个版本但其标签缺失，自动化会失败，而不会创建可能错误表述
已发布 artifact 来源的标签。
npmjs 和 GitHub Packages 可以跳过未发布的中间仓库版本。创建新的不可变标签前，`main`
协调器检查精确 npmjs 目标，要求仓库公开以满足来源证明，然后读取 `latest`，并要求它
低于提议版本。它不会等待紧邻的前一个仓库版本。GitHub Packages 同样会报告当前镜像
状态；当 `latest` 更低或镜像为空时，允许精确当前目标缺失。除 not-found 响应外，
精确目标查询错误仍会按 fail-closed 原则终止。GitHub Packages 会在发布前立即重新检查
精确目标和 `latest`，以消除精确版本检查和 dist-tag 更新中的构建期间竞态。缺失但早于
registry 当前 `latest`
的目标会失败，而不会将该 dist-tag 回退。

绝不可移动或复用一个已跳过的不可变标签来填补 registry 缺口。应准备一个独立的版本发布。

## ClawHub 包身份

ClawHub 分发刻意与 npm 身份分离：

| 层面 | 身份 |
| --- | --- |
| 规范 npm 包 | `openclaw-weixin` |
| GitHub Packages 镜像 | `@newfuture/openclaw-weixin` |
| ClawHub 包 | `openclaw-wechat` |
| 插件和 channel ID | `openclaw-weixin` |
| ClawHub 发布者 | `newfuture` |

`scripts/prepare-clawhub-package.mjs` 接受一个恰好包含一个规范 npm tarball 的目录（或
tarball 路径本身）。它会验证规范名称、npm fallback、入口点、宿主元数据、manifest
版本及插件/channel 身份。它还要求每份本地化 README 都恰好包含一组相邻的 npm 与
ClawHub 安装块，使用匹配的精确命令且不包含相对 registry link。在临时解压副本中，它会更改
`package.json.name`，添加 `clawhub:openclaw-wechat`，选择 ClawHub 作为该副本的默认
installer，以英文源作为其主 `README.md` 和 `README_EN.md`，将完整的中文源写入
`README.zh_CN.md`，将所有暂存 README 标题改为 `openclaw-wechat`，并保留每种本地化
prompt。中文 prompt 先尝试 npm 后尝试 ClawHub，英文 prompt 先尝试 ClawHub 后尝试 npm，
使每个包的主 README 与其默认来源一致。转换器随后将直接来源块从 npm-first 重新排序为
ClawHub-first。
它绝不会修改源 tarball，也不会创建 `openclaw-wechat` npm 包。

在任何 ClawHub 发布前，运行 `npm ci`、`npm run check` 和 `npm run pack:check`，然后按
[贡献指南](./contributing.md)中的命令构建并验证 ClawPack。绝不可复用或覆盖
现有 ClawHub 版本。每个新的 ClawHub 版本都必须来自对应的新规范 npm/GitHub 发布标签。

## 合并后的可信发布者迁移

工作流和外部信任配置必须按以下顺序变更。不得从未合并的分支修改任一可信发布者：

1. 在经过审核的拆分工作流存在于 `main` 前，保持 ClawHub 绑定到 `release.yml` 和
   `npm-publish`；不要开始另一项发布。
2. 将经过审核的工作流合并到 `main`。
3. 验证 `npm-publish` 和 `clawhub-publish` 都仍要求审核者 `NewFuture`，仅允许 `v*`
   标签，并且仍是独立环境。验证活动的 `refs/tags/v*` 规则集仍阻止标签更新和删除。
4. 再次确认 npm 仍绑定到 `release.yml` 和 `npm-publish`。不要替换 npm 可信发布者，
   也不要以其他方式编辑它。
5. 仅在完成步骤 1–4 后重新绑定 ClawHub 包：

   ```shell
   npx --yes clawhub@0.23.3 package trusted-publisher set openclaw-wechat \
     --repository NewFuture/openclaw-weixin \
     --workflow-filename release.yml \
     --environment clawhub-publish
   npx --yes clawhub@0.23.3 package trusted-publisher get openclaw-wechat --json
   ```

6. 验证 npm 仍绑定到 `release.yml` 加 `npm-publish`，且已保存的 ClawHub 仓库、工作流
   文件名和环境精确为 `NewFuture/openclaw-weixin`、`release.yml` 和
   `clawhub-publish`。
7. 仅通过 CI 创建的精确标签和显式 `release.yml` 分派运行下一次发布。如果两个 registry
   目标都缺失，等待两个环境均处于 Pending，选中两个环境，然后只点击一次
   **Approve and deploy**。验证 npmjs、ClawHub、GitHub Packages、GitHub Release
   以及已脱敏的工作流报告。
8. 永久保留两个受保护环境。迁移后不要合并、重命名或删除任一环境。

绝不可添加长期有效的 `CLAWHUB_TOKEN` secret。独立的
`.github/workflows/clawhub-publish.yml` 仅用于无需凭据的 pull request ClawPack 验证和
dry-run；它没有生产分派或 OIDC 权限。

## 可信 ClawHub 发布恢复

协调工作流会等待确定的 ClawHub 发布结果，并上传已脱敏的 inspector 和 JSON 报告。如果
npmjs 成功，但 ClawHub 在创建发布边界前失败，请重新运行原始工作流：仅
`clawhub-publish` 请求批准；若故障期间出现精确目标版本，复查会跳过该版本。ClawHub
成功而 npmjs 失败的反向部分成功状态由 `npm-publish` 独立处理，GitHub Packages 保留
自己的幂等预检查。如果两个
精确受保护 registry 目标都已匹配，两个受保护 job 都会被跳过，同时会在完成 GitHub
Release 前协调 GitHub Packages。

ClawHub CLI 0.23.3 不提供受支持的独立尝试状态查询命令或恢复命令。其需要认证的
attempt endpoint 是内部实现细节，并且在尝试处于活动状态时提交相同包版本会被拒绝，
而不会被视为幂等恢复。
因此，工作流会在唯一的实际发布命令之前立即创建持久化 `check run`，然后上传一个保存 90 天的
`clawhub-publication-boundary-v<version>-<commit>` artifact。`check run` 会在 artifact
过期后保留该边界；artifact 在完整的 30 天工作流重新运行窗口期间提供可直接下载的
标记。验证、构建、dry-run、精确 ClawHub registry 查询和标签验证都发生在任一边界之前，
可安全重试。`check run` 创建后的失败是未知的 ClawHub 结果，即使命令可能尚未到达服务器；
自动化不得根据不存在的公开版本推断安全。

如果运行失败，首先检查包和版本历史：

```shell
npx --yes clawhub@0.23.3 package inspect openclaw-wechat --versions --json
npx --yes clawhub@0.23.3 package moderation-status openclaw-wechat --json
npx --yes clawhub@0.23.3 package readiness openclaw-wechat --json
```

如果目标版本不存在，且发布边界检查和 artifact 都不存在，则失败发生在不可逆命令边界
之前，精确标签工作流可以安全地重试 ClawHub。只有在存在持久化边界且权威审核已确认再次请求
安全后，才需要显式恢复输入。

如果任一边界存在，检查创建它的原始 workflow run 和已脱敏报告，寻找 attempt ID 或终态，然后取得
ClawHub 的权威确认：不存在活动或已接受的尝试。确认后，如果匹配 artifact 仍存在，则
仅删除该 artifact，然后从精确标签分派启用 `authorize_clawhub_recovery` 的
`release.yml`。持久化 `check run` 会刻意保留为审计记录；显式输入允许新的受保护运行
在已有边界的情况下继续执行。如果
版本以预期身份出现，工作流会跳过 ClawHub。如果版本存在但源元数据或内嵌运行时身份不同，
自动化会失败而不是声称成功；不得重新发布或重写该版本。应在新的发布中处理被拒绝的
artifact。

公开包准备就绪后，在隔离的 OpenClaw 状态目录中安装它，确认 `openclaw plugins list` 仍
报告 `openclaw-weixin` 插件/channel ID，并检查条目的源 commit、图标、摘要、兼容性和
扫描状态。也要检查两种已渲染的 README 语言：主 README 必须是英文，标题必须为
`openclaw-wechat`，其 prompt 必须先尝试 ClawHub 后尝试 npm。中文 prompt 必须先尝试 npm
后尝试 ClawHub。每条 prompt 都必须让两种 source spec 各出现一次，并只说明一次
`--force`，将其限定为非交互 npm 来源确认。npm 和 ClawHub 的直接命令必须依赖交互确认
并省略该参数。ClawHub 必须排在来源标记首位，npm 必须仍然可用；所有语言切换和文档
链接都必须使用绝对地址。规范 npm tarball 和仓库 README 必须仍以 `openclaw-weixin`
为标题并且 npm-first。
