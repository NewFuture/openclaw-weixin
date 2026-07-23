import { MessageItemType, type WeixinMessage } from "../../src/api/types.js";
import { SYNTHETIC_CONTEXT_TOKEN, SYNTHETIC_USER_ID } from "../helpers/messages.js";

export const REFERENCED_IMAGE_MESSAGE = {
  from_user_id: SYNTHETIC_USER_ID,
  context_token: SYNTHETIC_CONTEXT_TOKEN,
  create_time_ms: 1_700_000_000_000,
  item_list: [
    {
      type: MessageItemType.TEXT,
      text_item: { text: "describe the referenced image" },
      ref_msg: {
        message_item: {
          type: MessageItemType.IMAGE,
          image_item: {
            media: {
              full_url: "https://media.example.test/synthetic-image",
            },
          },
        },
      },
    },
  ],
} satisfies WeixinMessage;
