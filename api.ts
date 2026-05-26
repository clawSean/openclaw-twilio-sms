export { twilioSmsPlugin } from "./src/channel.js";
export {
  listTwilioSmsAccountIds,
  resolveDefaultTwilioSmsAccountId,
  resolveTwilioSmsAccount,
} from "./src/accounts.js";
export {
  looksLikeTwilioSmsTarget,
  normalizeTwilioSmsAllowEntry,
  normalizeTwilioSmsMessagingTarget,
  normalizeTwilioSmsPhoneNumber,
} from "./src/phone.js";
export { sendTwilioSmsMessage, type TwilioSmsSendOptions } from "./src/send.js";
export type {
  ResolvedTwilioSmsAccount,
  TwilioSmsAccountConfig,
  TwilioSmsConfig,
  TwilioSmsSendResult,
} from "./src/types.js";
