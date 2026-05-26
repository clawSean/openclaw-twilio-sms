import {
  createMessageReceiptFromOutboundResults,
  type MessageReceipt,
  type MessageReceiptPartKind,
} from "openclaw/plugin-sdk/channel-message";
import { TWILIO_SMS_CHANNEL_ID } from "./constants.js";

export function createTwilioSmsSendReceipt(params: {
  messageId: string;
  to: string;
  from?: string;
  status?: string;
  kind?: MessageReceiptPartKind;
}): MessageReceipt {
  return createMessageReceiptFromOutboundResults({
    kind: params.kind ?? "text",
    results: [
      {
        channel: TWILIO_SMS_CHANNEL_ID,
        messageId: params.messageId,
        chatId: params.to,
        toJid: params.to,
        meta: {
          ...(params.from ? { from: params.from } : {}),
          ...(params.status ? { status: params.status } : {}),
        },
      },
    ],
  });
}
