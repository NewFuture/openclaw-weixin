# 后端 API 协议

[返回详细指南](./guide.md) | [English](./backend-api_EN.md)

本文档覆盖插件用于扫码登录、生命周期通知、消息和媒体的全部微信后端接口。两个扫码
登录请求始终使用腾讯固定服务；账号登录后 `baseurl` 指定的后端需要实现生命周期、
消息和媒体接口。

二维码创建和登录后的接口使用 `POST`；二维码状态轮询使用 `GET`。所有 API
请求均携带：

| Header | 说明 |
|--------|------|
| `iLink-App-Id` | 插件应用 ID |
| `iLink-App-ClientVersion` | 编码为无符号整数的插件版本 |
| `SKRouteTag` | 可选的配置路由标签 |

`POST` 请求还会携带 `Content-Type: application/json`、
`AuthorizationType: ilink_bot_token` 和随机 uint32 的 base64 编码
`X-WECHAT-UIN`。登录后的鉴权请求还会携带
`Authorization: Bearer <bot-token>`；二维码状态 `GET` 请求不携带这些 `POST`
专用请求头。

登录后的 `POST` 请求体包含 `base_info`，二维码创建请求则不包含。下方消息示例
为简洁起见将其省略。

```json
{
  "base_info": {
    "channel_version": "<插件版本>",
    "bot_agent": "OpenClaw"
  }
}
```

`bot_agent` 仅用于观测，其格式和配置方式见
[详细指南](./guide.md#自定义-botagent可选)。

## 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/ilink/bot/get_bot_qrcode?bot_type=3` | 创建扫码登录会话 |
| `GET` | `/ilink/bot/get_qrcode_status?qrcode=<opaque-id>` | 轮询扫码状态；可选传入 `verify_code` |
| `POST` | `/ilink/bot/msg/notifystart` | 通知后端 channel 已启动 |
| `POST` | `/ilink/bot/msg/notifystop` | 通知后端 channel 已停止 |
| `POST` | `/ilink/bot/getupdates` | 长轮询获取新消息 |
| `POST` | `/ilink/bot/sendmessage` | 发送消息（文本/图片/视频/文件） |
| `POST` | `/ilink/bot/getuploadurl` | 获取 CDN 上传预签名参数 |
| `POST` | `/ilink/bot/getconfig` | 获取账号配置（typing ticket 等） |
| `POST` | `/ilink/bot/sendtyping` | 发送或取消输入状态 |

前两行描述固定的扫码登录服务，不会发送到账号登录后的 `baseurl`。

## 扫码登录与生命周期

创建扫码会话：

```http
POST /ilink/bot/get_bot_qrcode?bot_type=3
Content-Type: application/json
```

```json
{
  "local_token_list": []
}
```

响应包含不透明的 `qrcode` 标识，以及用于生成二维码的 URL
`qrcode_img_content`。随后轮询
`GET /ilink/bot/get_qrcode_status?qrcode=<opaque-id>`，直到进入终止状态。遇到
验证挑战时，可通过 `verify_code` 查询参数提交验证码。

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `string` | `wait`、`scaned`、`need_verifycode`、`verify_code_blocked`、`expired`、`scaned_but_redirect`、`binded_redirect` 或 `confirmed` |
| `bot_token` | `string?` | 确认后返回的 bot 凭据 |
| `ilink_bot_id` | `string?` | 确认后必需的账号 ID |
| `baseurl` | `string?` | 账号 API 基础 URL |
| `ilink_user_id` | `string?` | 扫码用户 ID |
| `redirect_host` | `string?` | `scaned_but_redirect` 返回的新轮询主机 |

鉴权完成后，channel 启动时调用 `/ilink/bot/msg/notifystart`，停止时调用
`/ilink/bot/msg/notifystop`。两者均接收标准 `base_info` 请求体，并返回
以下结构：

```json
{
  "ret": 0,
  "errmsg": ""
}
```

二维码标识、验证码、bot token、账号 ID、用户 ID 和 context token 均属敏感
信息，不要在日志或示例中写入真实值。

## getUpdates

长轮询接口。服务端在有新消息或超时后返回。

**请求体：**

```json
{
  "get_updates_buf": ""
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `get_updates_buf` | `string` | 上次响应返回的同步游标，首次请求传空字符串 |

**响应体：**

```json
{
  "ret": 0,
  "msgs": [],
  "get_updates_buf": "<新游标>",
  "longpolling_timeout_ms": 35000
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `ret` | `number` | 返回码，`0` = 成功 |
| `errcode` | `number?` | 错误码（如 `-14` = token 失效） |
| `errmsg` | `string?` | 错误描述 |
| `msgs` | `WeixinMessage[]` | 消息列表（结构见下方） |
| `get_updates_buf` | `string` | 新的同步游标，下次请求时回传 |
| `longpolling_timeout_ms` | `number?` | 服务端建议的下次长轮询超时（ms） |

## sendMessage

发送一条消息给用户。

**请求体：**

```json
{
  "msg": {
    "to_user_id": "<目标用户 ID>",
    "context_token": "<会话上下文令牌>",
    "item_list": [
      {
        "type": 1,
        "text_item": { "text": "你好" }
      }
    ]
  }
}
```

**响应体：**

```json
{
  "ret": 0,
  "errmsg": ""
}
```

## getUploadUrl

获取 CDN 上传预签名参数。上传文件前需先调用此接口获取 `upload_param` 和
`thumb_upload_param`。

**请求体：**

```json
{
  "filekey": "<文件标识>",
  "media_type": 1,
  "to_user_id": "<目标用户 ID>",
  "rawsize": 12345,
  "rawfilemd5": "<明文 MD5>",
  "filesize": 12352,
  "no_need_thumb": true,
  "aeskey": "<32 位十六进制 AES 密钥>"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `filekey` | `string` | 本次上传的文件标识 |
| `media_type` | `number` | `1` = IMAGE、`2` = VIDEO、`3` = FILE、`4` = VOICE |
| `to_user_id` | `string` | 目标用户 ID |
| `rawsize` | `number` | 原文件明文大小 |
| `rawfilemd5` | `string` | 原文件明文 MD5 |
| `filesize` | `number` | AES-128-ECB 加密后的密文大小 |
| `no_need_thumb` | `boolean?` | 设为 `true` 时不请求缩略图上传参数 |
| `aeskey` | `string?` | 32 位十六进制 AES-128 密钥 |
| `thumb_rawsize` | `number?` | 请求缩略图时的明文大小 |
| `thumb_rawfilemd5` | `string?` | 请求缩略图时的明文 MD5 |
| `thumb_filesize` | `number?` | 请求缩略图时的密文大小 |

**响应体：**

```json
{
  "upload_param": "<原图上传加密参数>",
  "upload_full_url": "https://cdn.example.test/upload",
  "thumb_upload_param": "<可选的缩略图上传参数>"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `upload_param` | `string?` | 用于构造 CDN 上传 URL 的参数 |
| `upload_full_url` | `string?` | 完整 CDN 上传 URL；优先于 `upload_param` |
| `thumb_upload_param` | `string?` | 可选的缩略图上传参数 |

## getConfig

获取账号配置，包括 typing ticket。

**请求体：**

```json
{
  "ilink_user_id": "<用户 ID>",
  "context_token": "<可选，会话上下文令牌>"
}
```

**响应体：**

```json
{
  "ret": 0,
  "errmsg": "",
  "typing_ticket": "<base64 编码的 typing ticket>"
}
```

## sendTyping

发送或取消输入状态指示。

**请求体：**

```json
{
  "ilink_user_id": "<用户 ID>",
  "typing_ticket": "<从 getConfig 获取>",
  "status": 1
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `number` | `1` = 正在输入，`2` = 取消输入 |

**响应体：**

```json
{
  "ret": 0,
  "errmsg": ""
}
```

## 消息结构

### WeixinMessage

| 字段 | 类型 | 说明 |
|------|------|------|
| `seq` | `number?` | 消息序列号 |
| `message_id` | `number?` | 消息唯一 ID |
| `from_user_id` | `string?` | 发送者 ID |
| `to_user_id` | `string?` | 接收者 ID |
| `client_id` | `string?` | 客户端生成的消息 ID |
| `create_time_ms` | `number?` | 创建时间戳（ms） |
| `update_time_ms` | `number?` | 更新时间戳（ms） |
| `delete_time_ms` | `number?` | 删除时间戳（ms） |
| `session_id` | `string?` | 会话 ID |
| `group_id` | `string?` | 群组 ID |
| `message_type` | `number?` | `1` = USER, `2` = BOT |
| `message_state` | `number?` | `0` = NEW, `1` = GENERATING, `2` = FINISH |
| `item_list` | `MessageItem[]?` | 消息内容列表 |
| `context_token` | `string?` | 会话上下文令牌，回复时需回传 |
| `run_id` | `string?` | 生成回复对应的 OpenClaw run ID |

### MessageItem

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `number` | `1` TEXT、`2` IMAGE、`3` VOICE、`4` FILE、`5` VIDEO、`11` TOOL_CALL_START、`12` TOOL_CALL_RESULT |
| `create_time_ms` | `number?` | 条目创建时间戳 |
| `update_time_ms` | `number?` | 条目更新时间戳 |
| `is_completed` | `boolean?` | 进度条目是否完成 |
| `msg_id` | `string?` | 条目消息 ID |
| `text_item` | `{ text: string }?` | 文本内容 |
| `image_item` | `ImageItem?` | 图片（含 CDN 引用和 AES 密钥） |
| `voice_item` | `VoiceItem?` | 语音（SILK 编码） |
| `file_item` | `FileItem?` | 文件附件 |
| `video_item` | `VideoItem?` | 视频 |
| `ref_msg` | `RefMessage?` | 引用消息 |
| `tool_call_start_item` | `{ tool_name?: string; tool_call_id?: string }?` | 工具调用信息 |
| `tool_call_result_item` | `{ tool_name?: string; tool_call_id?: string; status?: string }?` | 工具完成信息 |

### 嵌套条目结构

| 结构 | 字段 |
|------|------|
| `RefMessage` | `message_item?: MessageItem`、`title?: string` |
| `ImageItem` | `media?: CDNMedia`、`thumb_media?: CDNMedia`、`aeskey?: string`、`url?: string`、`mid_size?: number`、`thumb_size?: number`、`thumb_height?: number`、`thumb_width?: number`、`hd_size?: number` |
| `VoiceItem` | `media?: CDNMedia`、`encode_type?: number`、`bits_per_sample?: number`、`sample_rate?: number`、`playtime?: number`、`text?: string` |
| `FileItem` | `media?: CDNMedia`、`file_name?: string`、`md5?: string`、`len?: string` |
| `VideoItem` | `media?: CDNMedia`、`video_size?: number`、`play_length?: number`、`video_md5?: string`、`thumb_media?: CDNMedia`、`thumb_size?: number`、`thumb_height?: number`、`thumb_width?: number` |
| `ToolCallStartItem` | `tool_name?: string`、`tool_call_id?: string` |
| `ToolCallResultItem` | `tool_name?: string`、`tool_call_id?: string`、`status?: string` |

### CDN 媒体引用 (CDNMedia)

所有媒体类型（图片/语音/文件/视频）通过 CDN 传输，使用 AES-128-ECB 加密：

| 字段 | 类型 | 说明 |
|------|------|------|
| `encrypt_query_param` | `string?` | CDN 下载/上传的加密参数 |
| `aes_key` | `string?` | base64 编码的 AES-128 密钥 |
| `encrypt_type` | `number?` | 加密元数据模式 |
| `full_url` | `string?` | 后端返回的完整下载 URL |

## CDN 上传流程

1. 计算文件明文大小、MD5，以及 AES-128-ECB 加密后的密文大小
2. 如需缩略图（图片/视频），同样计算缩略图的明文和密文参数
3. 调用 `getUploadUrl` 获取 `upload_full_url` 或 `upload_param`（以及可选的
   `thumb_upload_param`）
4. 使用 AES-128-ECB 加密文件内容，以 `application/octet-stream` 通过 `POST`
   上传到 CDN URL
5. 需要缩略图时，同理加密并上传
6. 从 CDN 响应读取 `x-encrypted-param`，作为 `CDNMedia` 引用中的
   `encrypt_query_param`
7. 将引用放入 `MessageItem` 后发送
