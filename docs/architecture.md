# 架构说明

[English](./architecture_EN.md)

`openclaw-weixin` 将微信 HTTP/CDN 协议适配到 OpenClaw channel 运行时。插件负责
登录、账号状态、长轮询、消息转换和出站媒体传输；OpenClaw 负责路由、会话、命令
授权、回复生成、hook 和统一媒体存储。

线级接口与消息结构详见[后端 API 协议](./backend-api.md)。

## 组件地图

| 组件 | 职责 |
| --- | --- |
| `index.ts` | 校验宿主兼容性并注册 channel |
| `src/channel.ts` | 实现 OpenClaw channel 契约与账号生命周期 |
| `src/auth/` | 扫码登录、账号持久化、ID 兼容和配对 |
| `src/api/` | 构造已鉴权的后端请求并分类失败 |
| `src/monitor/monitor.ts` | 轮询更新、持久化游标并调度入站任务 |
| `src/messaging/process-message.ts` | 授权、路由、记录并分派单条入站消息 |
| `src/messaging/send*.ts` | 将出站文本和媒体转换为后端消息条目 |
| `src/cdn/`、`src/media/` | 加密、上传、下载、解密并转码媒体 |
| `src/storage/` | 解析状态路径并持久化轮询游标 |

## 插件与账号生命周期

```mermaid
flowchart TD
  A[index.ts 注册] --> B[检查 OpenClaw 宿主版本]
  B --> C[注册 weixinPlugin]
  C --> D{操作}
  D -->|登录| E[启动扫码会话]
  E --> F[等待确认]
  F --> G[持久化账号与配对状态]
  G --> H[触发 channel 重载]
  D -->|启动账号| I[恢复 context token]
  I --> J[通知后端启动]
  J --> K[运行 monitor 循环]
  D -->|停止或重载| L[中止活跃轮询]
  L --> M[通知后端停止]
```

插件/channel ID 和状态目录结构都是兼容性边界。登录成功后，可以替换同一微信用户的
过期账号记录，但不得静默合并无关账号。

## 入站流程

```mermaid
sequenceDiagram
  participant Backend as 微信后端
  participant Monitor as monitorWeixinProvider
  participant Processor as processOneMessage
  participant Runtime as OpenClaw channel 运行时

  Monitor->>Backend: getUpdates（游标、中止信号）
  Backend-->>Monitor: 消息与下一游标
  Monitor->>Monitor: 持久化游标与账号级 context token
  Monitor->>Processor: 调度消息
  Processor->>Processor: 处理斜杠命令或下载媒体
  Processor->>Runtime: 授权发送者并解析 agent 路由
  Processor->>Runtime: 记录入站会话
  Processor->>Runtime: 分派回复
  Runtime-->>Processor: 文本、媒体与条目生命周期事件
```

普通消息会串行处理，直到 OpenClaw 接受当前 turn；随后轮询即可接纳下一条消息。插件
审批命令使用独立调度通道，因此活跃的普通 turn 不会阻塞审批。

## 出站流程

```mermaid
flowchart LR
  A[OpenClaw 出站请求] --> B{是否提供账号 ID？}
  B -->|是| C[解析已配置账号]
  B -->|否| D[按账号级 context token 解析]
  D --> C
  C --> E[检查活跃会话]
  E --> F[运行 message_sending hook]
  F -->|已取消| G[不向后端发送并返回]
  F -->|继续| H{文本还是媒体？}
  H -->|文本| I[过滤 Markdown 并调用 sendMessage]
  H -->|媒体| J[远程资源则先下载]
  J --> K[加密并上传至 CDN]
  K --> L[构造媒体消息条目]
  I --> M[触发 message_sent hook]
  L --> M
```

存在多个账号时，只有恰好能选出一个账号，才允许省略账号 ID。上下文缺失或存在歧义时
必须失败，不得冒险使用错误的 bot 发送消息。

## 持久化状态

除非框架已有覆盖设置，以下路径均相对于 OpenClaw 状态目录。

| 路径 | 内容 |
| --- | --- |
| `openclaw-weixin/accounts.json` | 已注册的主 bot-hash 账号 ID（monitor） |
| `openclaw-weixin/account-aliases.json` | 可选的 1:1 `别名 → hash` 映射，用于绑定和出站 |
| `openclaw-weixin/accounts/<accountId>.json` | token、后端 URL、保存时间和关联用户 ID |
| `openclaw-weixin/accounts/<accountId>.sync.json` | `getUpdates` 游标 |
| `openclaw-weixin/accounts/<accountId>.context-tokens.json` | 该账号的收件人 context token |
| `openclaw-weixin/replay-dedupe/<accountId>.json` | 入站 `getUpdates` 重放墓碑（保留 24 小时；较新的宿主可能将路径映射到 SQLite） |
| `credentials/openclaw-weixin-<accountId>-allowFrom.json` | 框架配对允许列表 |
| `openclaw.json` | channel 配置和账号覆盖项 |

加载器保留对旧版原始 ID、旧版单账号凭据文件和旧版同步游标路径的回退兼容。更改这些
回退逻辑时必须添加迁移测试。

## 失败与隐私边界

- 后端 HTTP 错误会附带可操作的上下文，但不会暴露原始 authorization token 或
  context token。
- token 过期后，该账号的所有请求都会暂停，之后才恢复轮询。
- 长轮询接收 Gateway 中止信号，因此停止或重载无需等待服务端超时。
- 媒体日志必须隐去 URL 和加密查询参数。
- 测试和示例使用 `account-1`、`user-1` 等合成 ID。

## 测试接缝

- API 测试替换 `fetch`，并断言请求和响应边界。
- monitor 测试模拟轮询、游标持久化、context 存储和消息处理。
- 消息处理测试使用最小化的强类型 channel 运行时 fake。
- 账号和存储测试将 `OPENCLAW_STATE_DIR` 指向隔离的临时目录。
- 共用 builder 位于 `test/helpers/`；测试专用文件不得输出到 `dist/`。
