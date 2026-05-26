import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  normalizeOptionalAccountId,
} from "openclaw/plugin-sdk/account-id";
import type { OpenClawConfig } from "openclaw/plugin-sdk/account-resolution";
import { resolveAccountEntry } from "openclaw/plugin-sdk/account-resolution";
import { tryReadSecretFileSync } from "openclaw/plugin-sdk/core";
import { TWILIO_SMS_CHANNEL_ID } from "./constants.js";
import { normalizeTwilioSmsPhoneNumber } from "./phone.js";
import type {
  ResolvedTwilioSmsAccount,
  TwilioSmsAccountConfig,
  TwilioSmsConfig,
  TwilioSmsCredentialSource,
} from "./types.js";

export { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";

function readFileIfExists(filePath: string | undefined, label: string): string | undefined {
  return tryReadSecretFileSync(filePath, label, { rejectSymlink: true });
}

function resolveAccountSid(params: {
  accountId: string;
  baseConfig?: TwilioSmsConfig;
  accountConfig?: TwilioSmsAccountConfig;
}): { value: string; source: TwilioSmsCredentialSource } {
  if (params.accountConfig?.accountSid?.trim()) {
    return { value: params.accountConfig.accountSid.trim(), source: "config" };
  }
  const accountFile = readFileIfExists(params.accountConfig?.accountSidFile, "Twilio Account SID");
  if (accountFile) {
    return { value: accountFile.trim(), source: "file" };
  }
  if (params.accountId === DEFAULT_ACCOUNT_ID) {
    if (params.baseConfig?.accountSid?.trim()) {
      return { value: params.baseConfig.accountSid.trim(), source: "config" };
    }
    const baseFile = readFileIfExists(params.baseConfig?.accountSidFile, "Twilio Account SID");
    if (baseFile) {
      return { value: baseFile.trim(), source: "file" };
    }
    const envValue = process.env.TWILIO_ACCOUNT_SID?.trim();
    if (envValue) {
      return { value: envValue, source: "env" };
    }
  }
  return { value: "", source: "none" };
}

function resolveAuthToken(params: {
  accountId: string;
  baseConfig?: TwilioSmsConfig;
  accountConfig?: TwilioSmsAccountConfig;
}): { value: string; source: TwilioSmsCredentialSource } {
  if (params.accountConfig?.authToken?.trim()) {
    return { value: params.accountConfig.authToken.trim(), source: "config" };
  }
  const accountFile = readFileIfExists(params.accountConfig?.authTokenFile, "Twilio Auth Token");
  if (accountFile) {
    return { value: accountFile.trim(), source: "file" };
  }
  if (params.accountId === DEFAULT_ACCOUNT_ID) {
    if (params.baseConfig?.authToken?.trim()) {
      return { value: params.baseConfig.authToken.trim(), source: "config" };
    }
    const baseFile = readFileIfExists(params.baseConfig?.authTokenFile, "Twilio Auth Token");
    if (baseFile) {
      return { value: baseFile.trim(), source: "file" };
    }
    const envValue = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (envValue) {
      return { value: envValue, source: "env" };
    }
  }
  return { value: "", source: "none" };
}

function resolveFromNumber(params: {
  accountId: string;
  baseConfig?: TwilioSmsConfig;
  accountConfig?: TwilioSmsAccountConfig;
}): { value?: string; source: TwilioSmsCredentialSource } {
  const accountValue = normalizeTwilioSmsPhoneNumber(params.accountConfig?.fromNumber);
  if (accountValue) {
    return { value: accountValue, source: "config" };
  }
  if (params.accountId === DEFAULT_ACCOUNT_ID) {
    const baseValue = normalizeTwilioSmsPhoneNumber(params.baseConfig?.fromNumber);
    if (baseValue) {
      return { value: baseValue, source: "config" };
    }
    const envValue = normalizeTwilioSmsPhoneNumber(process.env.TWILIO_SMS_FROM);
    if (envValue) {
      return { value: envValue, source: "env" };
    }
  }
  return { source: "none" };
}

function resolveMessagingServiceSid(params: {
  accountId: string;
  baseConfig?: TwilioSmsConfig;
  accountConfig?: TwilioSmsAccountConfig;
}): string | undefined {
  const accountValue = params.accountConfig?.messagingServiceSid?.trim();
  if (accountValue) {
    return accountValue;
  }
  if (params.accountId === DEFAULT_ACCOUNT_ID) {
    const baseValue = params.baseConfig?.messagingServiceSid?.trim();
    if (baseValue) {
      return baseValue;
    }
    const envValue = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
    if (envValue) {
      return envValue;
    }
  }
  return undefined;
}

function resolveMergedConfig(params: {
  baseConfig?: TwilioSmsConfig;
  accountConfig?: TwilioSmsAccountConfig;
}): TwilioSmsConfig & TwilioSmsAccountConfig {
  const { accounts: _accounts, defaultAccount: _defaultAccount, ...base } = params.baseConfig ?? {};
  return {
    ...base,
    ...params.accountConfig,
  };
}

export function resolveDefaultTwilioSmsAccountId(cfg: OpenClawConfig): string {
  const channelConfig = cfg.channels?.[TWILIO_SMS_CHANNEL_ID] as TwilioSmsConfig | undefined;
  return normalizeOptionalAccountId(channelConfig?.defaultAccount) ?? DEFAULT_ACCOUNT_ID;
}

export function listTwilioSmsAccountIds(cfg: OpenClawConfig): string[] {
  const channelConfig = cfg.channels?.[TWILIO_SMS_CHANNEL_ID] as TwilioSmsConfig | undefined;
  const ids = new Set<string>([DEFAULT_ACCOUNT_ID]);
  const defaultAccount = normalizeOptionalAccountId(channelConfig?.defaultAccount);
  if (defaultAccount) {
    ids.add(defaultAccount);
  }
  for (const accountId of Object.keys(channelConfig?.accounts ?? {})) {
    ids.add(normalizeAccountId(accountId));
  }
  return Array.from(ids);
}

export function resolveTwilioSmsAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedTwilioSmsAccount {
  const cfg = params.cfg;
  const accountId = normalizeAccountId(params.accountId ?? resolveDefaultTwilioSmsAccountId(cfg));
  const channelConfig = cfg.channels?.[TWILIO_SMS_CHANNEL_ID] as TwilioSmsConfig | undefined;
  const accounts = channelConfig?.accounts;
  const accountConfig =
    accountId !== DEFAULT_ACCOUNT_ID ? resolveAccountEntry(accounts, accountId) : undefined;
  const config = resolveMergedConfig({
    baseConfig: channelConfig,
    accountConfig,
  });
  const accountSid = resolveAccountSid({ accountId, baseConfig: channelConfig, accountConfig });
  const authToken = resolveAuthToken({ accountId, baseConfig: channelConfig, accountConfig });
  const fromNumber = resolveFromNumber({ accountId, baseConfig: channelConfig, accountConfig });
  const messagingServiceSid = resolveMessagingServiceSid({
    accountId,
    baseConfig: channelConfig,
    accountConfig,
  });
  const defaultTo = normalizeTwilioSmsPhoneNumber(config.defaultTo);
  const configured = Boolean(
    accountSid.value && authToken.value && (fromNumber.value || messagingServiceSid),
  );

  return {
    accountId,
    name: config.name,
    enabled: config.enabled !== false,
    configured,
    accountSid: accountSid.value,
    authToken: authToken.value,
    ...(fromNumber.value ? { fromNumber: fromNumber.value } : {}),
    ...(messagingServiceSid ? { messagingServiceSid } : {}),
    ...(defaultTo ? { defaultTo } : {}),
    credentialSource: accountSid.source === "none" ? authToken.source : accountSid.source,
    fromNumberSource: fromNumber.source,
    config,
  };
}
