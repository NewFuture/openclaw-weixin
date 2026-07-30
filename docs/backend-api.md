# Backend API Protocol

[Back to detailed guide](./guide.md) |
[简体中文](./backend-api.zh_CN.md)

This document covers every Weixin backend endpoint used by the plugin for QR
login, lifecycle notifications, messaging, and media. The two QR login requests
always use Tencent's fixed service. A backend selected by the account's
post-login `baseurl` must implement the lifecycle, messaging, and media
endpoints.

QR creation and all post-login endpoints use `POST`; QR status polling uses
`GET`. All requests include:

| Header | Description |
|--------|-------------|
| `iLink-App-Id` | Plugin application ID |
| `iLink-App-ClientVersion` | Plugin version encoded as an unsigned integer |
| `SKRouteTag` | Optional configured route tag |

`POST` requests additionally include `Content-Type: application/json`,
`AuthorizationType: ilink_bot_token`, and a random base64-encoded
`X-WECHAT-UIN`. Authenticated post-login requests also include
`Authorization: Bearer <bot-token>`; QR status `GET` requests do not include
these `POST`-specific headers.

Authenticated post-login `POST` bodies include `base_info`; QR creation does
not. The message examples below omit it for readability.

```json
{
  "base_info": {
    "channel_version": "<plugin version>",
    "bot_agent": "OpenClaw"
  }
}
```

`bot_agent` is for observability only. Its supported format and configuration
are documented in the [detailed guide](./guide.md#custom-botagent-optional).

## Endpoint List

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/ilink/bot/get_bot_qrcode?bot_type=3` | Create a QR login session |
| `GET` | `/ilink/bot/get_qrcode_status?qrcode=<opaque-id>` | Poll QR login status; accepts optional `verify_code` |
| `POST` | `/ilink/bot/msg/notifystart` | Notify backend that the channel started |
| `POST` | `/ilink/bot/msg/notifystop` | Notify backend that the channel stopped |
| `POST` | `/ilink/bot/getupdates` | Long-poll for new messages |
| `POST` | `/ilink/bot/sendmessage` | Send a message (text/image/video/file) |
| `POST` | `/ilink/bot/getuploadurl` | Get CDN upload pre-signed parameters |
| `POST` | `/ilink/bot/getconfig` | Get account config (typing ticket, etc.) |
| `POST` | `/ilink/bot/sendtyping` | Send/cancel typing status |

The first two rows describe the fixed QR login service. They are not sent to the
account's post-login `baseurl`.

## QR Login and Lifecycle

Create a QR session with:

```http
POST /ilink/bot/get_bot_qrcode?bot_type=3
Content-Type: application/json
```

```json
{
  "local_token_list": []
}
```

The response contains an opaque `qrcode` identifier and
`qrcode_img_content`, the URL rendered as the QR code. Poll
`GET /ilink/bot/get_qrcode_status?qrcode=<opaque-id>` until it reaches a
terminal state. The optional `verify_code` query parameter handles verification
challenges.

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | `wait`, `scaned`, `need_verifycode`, `verify_code_blocked`, `expired`, `scaned_but_redirect`, `binded_redirect`, or `confirmed` |
| `bot_token` | `string?` | Bot credential returned after confirmation |
| `ilink_bot_id` | `string?` | Required account ID after confirmation |
| `baseurl` | `string?` | Account API base URL |
| `ilink_user_id` | `string?` | ID of the user who scanned the QR code |
| `redirect_host` | `string?` | New polling host for `scaned_but_redirect` |

After authentication, call `/ilink/bot/msg/notifystart` when the channel starts
and `/ilink/bot/msg/notifystop` when it stops. Both receive the standard
`base_info` body and return:

```json
{
  "ret": 0,
  "errmsg": ""
}
```

QR identifiers, verification codes, bot tokens, account IDs, user IDs, and
context tokens are sensitive. Never place real values in logs or examples.

## getUpdates

Long-polling endpoint. The server responds when new messages arrive or on
timeout.

**Request body:**

```json
{
  "get_updates_buf": ""
}
```

| Field | Type | Description |
|-------|------|-------------|
| `get_updates_buf` | `string` | Sync cursor from the previous response; empty string for the first request |

**Response body:**

```json
{
  "ret": 0,
  "msgs": [],
  "get_updates_buf": "<new cursor>",
  "longpolling_timeout_ms": 35000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ret` | `number` | Return code, `0` = success |
| `errcode` | `number?` | Error code (e.g., `-14` = stale token) |
| `errmsg` | `string?` | Error description |
| `msgs` | `WeixinMessage[]` | Message list (structure below) |
| `get_updates_buf` | `string` | New sync cursor to pass in the next request |
| `longpolling_timeout_ms` | `number?` | Server-suggested long-poll timeout for the next request (ms) |

## sendMessage

Send a message to a user.

**Request body:**

```json
{
  "msg": {
    "to_user_id": "<target user ID>",
    "context_token": "<conversation context token>",
    "item_list": [
      {
        "type": 1,
        "text_item": { "text": "Hello" }
      }
    ]
  }
}
```

**Response body:**

```json
{
  "ret": 0,
  "errmsg": ""
}
```

## getUploadUrl

Get CDN upload pre-signed parameters. Call this endpoint before uploading a file
to obtain `upload_param` and `thumb_upload_param`.

**Request body:**

```json
{
  "filekey": "<file identifier>",
  "media_type": 1,
  "to_user_id": "<target user ID>",
  "rawsize": 12345,
  "rawfilemd5": "<plaintext MD5>",
  "filesize": 12352,
  "no_need_thumb": true,
  "aeskey": "<32-character hex AES key>"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `filekey` | `string` | Per-upload file identifier |
| `media_type` | `number` | `1` = IMAGE, `2` = VIDEO, `3` = FILE, `4` = VOICE |
| `to_user_id` | `string` | Target user ID |
| `rawsize` | `number` | Original file plaintext size |
| `rawfilemd5` | `string` | Original file plaintext MD5 |
| `filesize` | `number` | Ciphertext size after AES-128-ECB encryption |
| `no_need_thumb` | `boolean?` | Set `true` to omit thumbnail upload parameters |
| `aeskey` | `string?` | AES-128 key as 32 hexadecimal characters |
| `thumb_rawsize` | `number?` | Thumbnail plaintext size when a thumbnail is requested |
| `thumb_rawfilemd5` | `string?` | Thumbnail plaintext MD5 when requested |
| `thumb_filesize` | `number?` | Thumbnail ciphertext size when requested |

**Response body:**

```json
{
  "upload_param": "<original image upload encrypted parameters>",
  "upload_full_url": "https://cdn.example.test/upload",
  "thumb_upload_param": "<optional thumbnail upload parameters>"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `upload_param` | `string?` | Parameters used to construct the CDN upload URL |
| `upload_full_url` | `string?` | Complete CDN upload URL; takes precedence over `upload_param` |
| `thumb_upload_param` | `string?` | Optional thumbnail upload parameters |

## getConfig

Get account configuration, including the typing ticket.

**Request body:**

```json
{
  "ilink_user_id": "<user ID>",
  "context_token": "<optional, conversation context token>"
}
```

**Response body:**

```json
{
  "ret": 0,
  "errmsg": "",
  "typing_ticket": "<base64-encoded typing ticket>"
}
```

## sendTyping

Send or cancel the typing status indicator.

**Request body:**

```json
{
  "ilink_user_id": "<user ID>",
  "typing_ticket": "<obtained from getConfig>",
  "status": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `number` | `1` = typing, `2` = cancel typing |

**Response body:**

```json
{
  "ret": 0,
  "errmsg": ""
}
```

## Message Structure

### WeixinMessage

| Field | Type | Description |
|-------|------|-------------|
| `seq` | `number?` | Message sequence number |
| `message_id` | `number?` | Unique message ID |
| `from_user_id` | `string?` | Sender ID |
| `to_user_id` | `string?` | Receiver ID |
| `client_id` | `string?` | Client-generated message ID |
| `create_time_ms` | `number?` | Creation timestamp (ms) |
| `update_time_ms` | `number?` | Update timestamp (ms) |
| `delete_time_ms` | `number?` | Deletion timestamp (ms) |
| `session_id` | `string?` | Session ID |
| `group_id` | `string?` | Group ID |
| `message_type` | `number?` | `1` = USER, `2` = BOT |
| `message_state` | `number?` | `0` = NEW, `1` = GENERATING, `2` = FINISH |
| `item_list` | `MessageItem[]?` | Message content list |
| `context_token` | `string?` | Conversation context token, must be passed back when replying |
| `run_id` | `string?` | OpenClaw run ID for generated replies |

### MessageItem

| Field | Type | Description |
|-------|------|-------------|
| `type` | `number` | `1` TEXT, `2` IMAGE, `3` VOICE, `4` FILE, `5` VIDEO, `11` TOOL_CALL_START, `12` TOOL_CALL_RESULT |
| `create_time_ms` | `number?` | Item creation timestamp |
| `update_time_ms` | `number?` | Item update timestamp |
| `is_completed` | `boolean?` | Whether a progress item is complete |
| `msg_id` | `string?` | Item message ID |
| `text_item` | `{ text: string }?` | Text content |
| `image_item` | `ImageItem?` | Image (with CDN reference and AES key) |
| `voice_item` | `VoiceItem?` | Voice (SILK encoded) |
| `file_item` | `FileItem?` | File attachment |
| `video_item` | `VideoItem?` | Video |
| `ref_msg` | `RefMessage?` | Referenced message |
| `tool_call_start_item` | `{ tool_name?: string; tool_call_id?: string }?` | Tool invocation metadata |
| `tool_call_result_item` | `{ tool_name?: string; tool_call_id?: string; status?: string }?` | Tool completion metadata |

### Nested Item Structures

| Structure | Fields |
|-----------|--------|
| `RefMessage` | `message_item?: MessageItem`, `title?: string` |
| `ImageItem` | `media?: CDNMedia`, `thumb_media?: CDNMedia`, `aeskey?: string`, `url?: string`, `mid_size?: number`, `thumb_size?: number`, `thumb_height?: number`, `thumb_width?: number`, `hd_size?: number` |
| `VoiceItem` | `media?: CDNMedia`, `encode_type?: number`, `bits_per_sample?: number`, `sample_rate?: number`, `playtime?: number`, `text?: string` |
| `FileItem` | `media?: CDNMedia`, `file_name?: string`, `md5?: string`, `len?: string` |
| `VideoItem` | `media?: CDNMedia`, `video_size?: number`, `play_length?: number`, `video_md5?: string`, `thumb_media?: CDNMedia`, `thumb_size?: number`, `thumb_height?: number`, `thumb_width?: number` |
| `ToolCallStartItem` | `tool_name?: string`, `tool_call_id?: string` |
| `ToolCallResultItem` | `tool_name?: string`, `tool_call_id?: string`, `status?: string` |

### CDN Media Reference (CDNMedia)

All media types (image/voice/file/video) are transferred via CDN using
AES-128-ECB encryption:

| Field | Type | Description |
|-------|------|-------------|
| `encrypt_query_param` | `string?` | Encrypted parameters for CDN download/upload |
| `aes_key` | `string?` | Base64-encoded AES-128 key |
| `encrypt_type` | `number?` | Encryption metadata mode |
| `full_url` | `string?` | Complete download URL returned by the backend |

## CDN Upload Flow

1. Calculate the file's plaintext size, MD5, and ciphertext size after
   AES-128-ECB encryption
2. If a thumbnail is needed (image/video), calculate the thumbnail's plaintext
   and ciphertext parameters as well
3. Call `getUploadUrl` to get `upload_full_url` or `upload_param` (and optional
   `thumb_upload_param`)
4. Encrypt the file content with AES-128-ECB and `POST` it to the CDN URL as
   `application/octet-stream`
5. Encrypt and upload the thumbnail in the same way when requested
6. Read `x-encrypted-param` from the CDN response and use it as
   `encrypt_query_param` in the `CDNMedia` reference
7. Include the reference in the `MessageItem` and send
