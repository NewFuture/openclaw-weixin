# openclaw-wechat

[简体中文](./README.zh_CN.md)

Community-maintained distribution of
[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin), providing
OpenClaw's WeChat channel with QR-code login.

> The canonical npm package is `@newfuture/openclaw-wechat`;
> `openclaw-weixin` is its unscoped install-compatible mirror. Both packages use
> the single `openclaw-weixin` plugin and channel id. Existing
> `channels.openclaw-weixin`, `plugins.entries.openclaw-weixin`, and
> `~/.openclaw/openclaw-weixin/` data continue to use that id.

## Compatibility

| Requirement | Minimum |
|-------------|---------|
| OpenClaw | `2026.7.1` |
| Node.js | `>=22.22.3 <23`, `>=24.15.0 <25`, or `>=25.9.0` |

The plugin checks the OpenClaw host version at startup and refuses to load on
older hosts. Node.js 24.15.0 is the recommended runtime.

## Prerequisites

[OpenClaw](https://docs.openclaw.ai/install) must be installed and the
`openclaw` CLI must be available.

Check your version: `openclaw --version`

## Install

```bash
openclaw plugins install npm:@newfuture/openclaw-wechat
openclaw config set plugins.entries.openclaw-weixin.enabled true
openclaw channels login --channel openclaw-weixin
openclaw gateway restart
```

The mirror name installs the same plugin and uses the same configuration and
state:

```bash
openclaw plugins install npm:openclaw-weixin
```

A QR code appears in the terminal. Scan it with your phone and confirm the
authorization. Credentials are saved locally. Verify the installation after the
restart:

```bash
openclaw plugins list
openclaw channels status --probe
```

## Switch from Tencent's package

Switch in place from `@tencent-weixin/openclaw-weixin`; **do not uninstall the
Tencent package first**. Current OpenClaw uninstall behavior removes channel
configuration owned by the plugin.

```bash
openclaw plugins install npm:@newfuture/openclaw-wechat --force
openclaw gateway restart
openclaw plugins list
openclaw channels status --probe
```

The forced install replaces the package that owns the same internal
`openclaw-weixin` plugin/channel id. The old and community packages must not be
enabled at the same time. Because the internal id and state paths are unchanged,
channel configuration and login credentials are normally retained.

## Installation limitations

- Use the CLI for this community npm package. OpenClaw's Control UI does not
  install arbitrary npm, git, or local-path plugin sources.
- In Nix mode (`OPENCLAW_NIX_MODE=1`), plugin install, update, uninstall,
  enable, and disable commands are intentionally disabled. Add the package and
  config to the Nix source, then rebuild instead.
- OpenClaw installs plugin dependencies with lifecycle scripts disabled. This
  package therefore ships its compiled `dist/index.js` runtime and does not
  build on the user's machine.

## Adding More WeChat Accounts

```bash
openclaw channels login --channel openclaw-weixin
```

Each QR code login creates a new account entry, supporting multiple WeChat accounts online simultaneously.

## Multi-Account Context Isolation

By default, DMs can share one session bucket. For **multiple logged-in WeChat accounts**, isolate by account + channel + sender:

```bash
openclaw config set session.dmScope per-account-channel-peer
```

## Custom BotAgent (optional)

Every outbound request to the WeChat backend carries a self-declared `bot_agent`
identifier — analogous to an HTTP `User-Agent` — used for log attribution and
monitoring aggregation. The default is `OpenClaw`. Declaring your own app name
makes it much easier to trace your traffic in backend logs.

Add one line to `openclaw.json`:

```json
{
  "channels": {
    "openclaw-weixin": {
      "botAgent": "MyBot/1.2.0"
    }
  }
}
```

**Format** (UA-style):

- One or more `Name/Version` tokens, space-separated
- Each token may optionally be followed by ` (comment)`
- ASCII only; total length ≤ 256 bytes
- Invalid tokens are silently dropped during sanitization; falls back to
  `OpenClaw` if nothing valid remains

Examples that pass through unchanged:

- `MyBot/1.2.0`
- `MyBot/1.2.0 (region=cn;env=prod)`
- `MyBot/1.2.0 LangChain/0.3.5`
- `MyBot/1.2.0-rc.1+build.5`

**Note**: `bot_agent` is for observability only — it is not used for
authentication or routing. All registered agents on this plugin instance
currently share the same `botAgent` declaration; per-agent overrides may be
added in a future version if needed.

## Backend API Protocol

This plugin communicates with the backend gateway via HTTP JSON API. Developers integrating with their own backend need to implement the following interfaces.

All endpoints use `POST` with JSON request and response bodies. Common request headers:

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `AuthorizationType` | Fixed value `ilink_bot_token` |
| `Authorization` | `Bearer <token>` (obtained after login) |
| `X-WECHAT-UIN` | Base64-encoded random uint32 |

### Endpoint List

| Endpoint | Path | Description |
|----------|------|-------------|
| getUpdates | `getupdates` | Long-poll for new messages |
| sendMessage | `sendmessage` | Send a message (text/image/video/file) |
| getUploadUrl | `getuploadurl` | Get CDN upload pre-signed URL |
| getConfig | `getconfig` | Get account config (typing ticket, etc.) |
| sendTyping | `sendtyping` | Send/cancel typing status indicator |

### getUpdates

Long-polling endpoint. The server responds when new messages arrive or on timeout.

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
  "msgs": [...],
  "get_updates_buf": "<new cursor>",
  "longpolling_timeout_ms": 35000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ret` | `number` | Return code, `0` = success |
| `errcode` | `number?` | Error code (e.g., `-14` = session timeout) |
| `errmsg` | `string?` | Error description |
| `msgs` | `WeixinMessage[]` | Message list (structure below) |
| `get_updates_buf` | `string` | New sync cursor to pass in the next request |
| `longpolling_timeout_ms` | `number?` | Server-suggested long-poll timeout for the next request (ms) |

### sendMessage

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

### getUploadUrl

Get CDN upload pre-signed parameters. Call this endpoint before uploading a file to obtain `upload_param` and `thumb_upload_param`.

**Request body:**

```json
{
  "filekey": "<file identifier>",
  "media_type": 1,
  "to_user_id": "<target user ID>",
  "rawsize": 12345,
  "rawfilemd5": "<plaintext MD5>",
  "filesize": 12352,
  "thumb_rawsize": 1024,
  "thumb_rawfilemd5": "<thumbnail plaintext MD5>",
  "thumb_filesize": 1040
}
```

| Field | Type | Description |
|-------|------|-------------|
| `media_type` | `number` | `1` = IMAGE, `2` = VIDEO, `3` = FILE |
| `rawsize` | `number` | Original file plaintext size |
| `rawfilemd5` | `string` | Original file plaintext MD5 |
| `filesize` | `number` | Ciphertext size after AES-128-ECB encryption |
| `thumb_rawsize` | `number?` | Thumbnail plaintext size (required for IMAGE/VIDEO) |
| `thumb_rawfilemd5` | `string?` | Thumbnail plaintext MD5 (required for IMAGE/VIDEO) |
| `thumb_filesize` | `number?` | Thumbnail ciphertext size (required for IMAGE/VIDEO) |

**Response body:**

```json
{
  "upload_param": "<original image upload encrypted parameters>",
  "thumb_upload_param": "<thumbnail upload encrypted parameters>"
}
```

### getConfig

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
  "typing_ticket": "<base64-encoded typing ticket>"
}
```

### sendTyping

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

### Message Structure

#### WeixinMessage

| Field | Type | Description |
|-------|------|-------------|
| `seq` | `number?` | Message sequence number |
| `message_id` | `number?` | Unique message ID |
| `from_user_id` | `string?` | Sender ID |
| `to_user_id` | `string?` | Receiver ID |
| `create_time_ms` | `number?` | Creation timestamp (ms) |
| `session_id` | `string?` | Session ID |
| `message_type` | `number?` | `1` = USER, `2` = BOT |
| `message_state` | `number?` | `0` = NEW, `1` = GENERATING, `2` = FINISH |
| `item_list` | `MessageItem[]?` | Message content list |
| `context_token` | `string?` | Conversation context token, must be passed back when replying |

#### MessageItem

| Field | Type | Description |
|-------|------|-------------|
| `type` | `number` | `1` TEXT, `2` IMAGE, `3` VOICE, `4` FILE, `5` VIDEO |
| `text_item` | `{ text: string }?` | Text content |
| `image_item` | `ImageItem?` | Image (with CDN reference and AES key) |
| `voice_item` | `VoiceItem?` | Voice (SILK encoded) |
| `file_item` | `FileItem?` | File attachment |
| `video_item` | `VideoItem?` | Video |
| `ref_msg` | `RefMessage?` | Referenced message |

#### CDN Media Reference (CDNMedia)

All media types (image/voice/file/video) are transferred via CDN using AES-128-ECB encryption:

| Field | Type | Description |
|-------|------|-------------|
| `encrypt_query_param` | `string?` | Encrypted parameters for CDN download/upload |
| `aes_key` | `string?` | Base64-encoded AES-128 key |

### CDN Upload Flow

1. Calculate the file's plaintext size, MD5, and ciphertext size after AES-128-ECB encryption
2. If a thumbnail is needed (image/video), calculate the thumbnail's plaintext and ciphertext parameters as well
3. Call `getUploadUrl` to get `upload_param` (and `thumb_upload_param`)
4. Encrypt the file content with AES-128-ECB and PUT upload to the CDN URL
5. Encrypt and upload the thumbnail in the same way
6. Use the returned `encrypt_query_param` to construct a `CDNMedia` reference, include it in the `MessageItem`, and send

> For complete type definitions, see [`src/api/types.ts`](src/api/types.ts). For API call implementations, see [`src/api/api.ts`](src/api/api.ts).

## Uninstall

Back up `~/.openclaw/openclaw.json` first if you may want to reinstall: current
OpenClaw versions remove the plugin entry and owned
`channels.openclaw-weixin` configuration during uninstall.

```bash
openclaw plugins uninstall openclaw-weixin
```

## Troubleshooting

### "requires OpenClaw >=2026.7.1" error

Your OpenClaw version is too old for this plugin version. Check with:

```bash
openclaw --version
```

Upgrade OpenClaw before installing this package. The community package does not
publish a legacy compatibility line.

### Channel shows "OK" but doesn't connect

Ensure `plugins.entries.openclaw-weixin.enabled` is `true` in `~/.openclaw/openclaw.json`:

```bash
openclaw config set plugins.entries.openclaw-weixin.enabled true
openclaw gateway restart
```
