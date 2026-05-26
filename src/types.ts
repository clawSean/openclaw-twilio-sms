import type { BaseProbeResult } from "openclaw/plugin-sdk/channel-contract";
import type { MessageReceipt } from "openclaw/plugin-sdk/channel-message";

export type TwilioSmsCredentialSource = "config" | "env" | "file" | "none";

export interface TwilioSmsAccountBaseConfig {
  enabled?: boolean;
  name?: string;
  accountSid?: string;
  authToken?: string;
  accountSidFile?: string;
  authTokenFile?: string;
  fromNumber?: string | number;
  messagingServiceSid?: string;
  defaultTo?: string | number;
  allowFrom?: Array<string | number>;
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  webhookPath?: string;
  publicUrl?: string;
  textChunkLimit?: number;
}

export interface TwilioSmsConfig extends TwilioSmsAccountBaseConfig {
  accounts?: Record<string, TwilioSmsAccountConfig>;
  defaultAccount?: string;
}

export interface TwilioSmsAccountConfig extends TwilioSmsAccountBaseConfig {}

export interface ResolvedTwilioSmsAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  accountSid: string;
  authToken: string;
  fromNumber?: string;
  messagingServiceSid?: string;
  defaultTo?: string;
  credentialSource: TwilioSmsCredentialSource;
  fromNumberSource: TwilioSmsCredentialSource;
  config: TwilioSmsConfig & TwilioSmsAccountConfig;
}

export interface TwilioSmsSendResult {
  messageId: string;
  chatId: string;
  toJid: string;
  receipt: MessageReceipt;
  status?: string;
}

export type TwilioSmsProbeResult = BaseProbeResult<string> & {
  accountSid?: string;
};
