import { MessageItemType, type WeixinMessage } from "../../src/api/types.js";

export const SYNTHETIC_ACCOUNT_ID = "account-test";
export const SYNTHETIC_USER_ID = "user-test@im.wechat";
export const SYNTHETIC_CONTEXT_TOKEN = "context-token-test";

export function makeTextMessage(text: string, overrides: Partial<WeixinMessage> = {}): WeixinMessage {
  return {
    from_user_id: SYNTHETIC_USER_ID,
    context_token: SYNTHETIC_CONTEXT_TOKEN,
    create_time_ms: 1_700_000_000_000,
    item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
    ...overrides,
  };
}

export function getText(message: WeixinMessage): string {
  return message.item_list?.find((item) => item.type === MessageItemType.TEXT)?.text_item?.text ?? "";
}
