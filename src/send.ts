import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { requireRuntimeConfig } from "openclaw/plugin-sdk/plugin-config-runtime";
import { resolveTwilioSmsAccount } from "./accounts.js";
import { TWILIO_SMS_CHANNEL_ID } from "./constants.js";
import { normalizeTwilioSmsPhoneNumber } from "./phone.js";
import { createTwilioSmsSendReceipt } from "./receipt.js";
import { sendTwilioSmsApiMessage, type TwilioSmsApiMessageResponse } from "./twilio-api.js";
import type { TwilioSmsSendResult } from "./types.js";

type TwilioSmsApiSend = typeof sendTwilioSmsApiMessage;

export type TwilioSmsSendOptions = {
  cfg: OpenClawConfig;
  accountId?: string | null;
  sendApi?: TwilioSmsApiSend;
};

function resolveMessageSid(response: TwilioSmsApiMessageResponse): string {
  const sid = response.sid?.trim();
  if (!sid) {
    throw new Error("Twilio SMS API response did not include a Message SID.");
  }
  return sid;
}

export async function sendTwilioSmsMessage(
  to: string,
  text: string,
  opts: TwilioSmsSendOptions,
): Promise<TwilioSmsSendResult> {
  const cfg = requireRuntimeConfig(opts.cfg, "Twilio SMS send");
  const account = resolveTwilioSmsAccount({ cfg, accountId: opts.accountId });
  if (!account.configured) {
    throw new Error(
      "Twilio SMS is not configured. Set channels." +
        TWILIO_SMS_CHANNEL_ID +
        " credentials or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN plus TWILIO_SMS_FROM.",
    );
  }
  const target = normalizeTwilioSmsPhoneNumber(to);
  if (!target) {
    throw new Error("Twilio SMS target must be an E.164 phone number.");
  }
  const body = text.trim();
  if (!body) {
    throw new Error("Twilio SMS send requires non-empty text.");
  }
  const sendApi = opts.sendApi ?? sendTwilioSmsApiMessage;
  const response = await sendApi({
    accountSid: account.accountSid,
    authToken: account.authToken,
    to: target,
    body,
    from: account.fromNumber,
    messagingServiceSid: account.messagingServiceSid,
  });
  const messageId = resolveMessageSid(response);
  const from = response.from?.trim() || account.fromNumber;
  const receipt = createTwilioSmsSendReceipt({
    messageId,
    to: response.to?.trim() || target,
    from,
    status: response.status?.trim(),
    kind: "text",
  });
  return {
    messageId,
    chatId: target,
    toJid: target,
    receipt,
    ...(response.status ? { status: response.status } : {}),
  };
}
