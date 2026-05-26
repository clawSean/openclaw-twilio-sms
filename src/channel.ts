import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import {
  createHybridChannelConfigAdapter,
  createScopedDmSecurityResolver,
} from "openclaw/plugin-sdk/channel-config-helpers";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { PAIRING_APPROVED_MESSAGE } from "openclaw/plugin-sdk/channel-status";
import {
  buildChannelOutboundSessionRoute,
  type ChannelOutboundSessionRouteParams,
  type ChannelPlugin,
} from "openclaw/plugin-sdk/core";
import { createEmptyChannelDirectoryAdapter } from "openclaw/plugin-sdk/directory-runtime";
import {
  buildBaseChannelStatusSummary,
  collectStatusIssuesFromLastError,
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import {
  DEFAULT_ACCOUNT_ID,
  listTwilioSmsAccountIds,
  resolveDefaultTwilioSmsAccountId,
  resolveTwilioSmsAccount,
} from "./accounts.js";
import { TwilioSmsChannelConfigSchema } from "./config-schema.js";
import { TWILIO_SMS_CHANNEL_ID, TWILIO_SMS_PROVIDER_PREFIX } from "./constants.js";
import { twilioSmsGatewayAdapter } from "./gateway.js";
import { twilioSmsMessageAdapter, twilioSmsOutboundAdapter } from "./outbound.js";
import {
  formatTwilioSmsAllowFrom,
  looksLikeTwilioSmsTarget,
  normalizeTwilioSmsAllowEntry,
  normalizeTwilioSmsMessagingTarget,
  normalizeTwilioSmsPhoneNumber,
} from "./phone.js";
import { sendTwilioSmsMessage } from "./send.js";
import type { ResolvedTwilioSmsAccount } from "./types.js";

function maskPhoneNumber(phone: string | undefined): string | undefined {
  if (!phone) {
    return undefined;
  }
  const suffix = phone.slice(-4);
  return suffix ? "***" + suffix : "***";
}

const twilioSmsConfigAdapter = createHybridChannelConfigAdapter<ResolvedTwilioSmsAccount>({
  sectionKey: TWILIO_SMS_CHANNEL_ID,
  listAccountIds: listTwilioSmsAccountIds,
  resolveAccount: (cfg, accountId) => resolveTwilioSmsAccount({ cfg, accountId }),
  defaultAccountId: resolveDefaultTwilioSmsAccountId,
  preserveSectionOnDefaultDelete: true,
  clearBaseFields: [
    "name",
    "accountSid",
    "authToken",
    "accountSidFile",
    "authTokenFile",
    "fromNumber",
    "messagingServiceSid",
    "defaultTo",
    "allowFrom",
    "dmPolicy",
    "webhookPath",
    "publicUrl",
    "textChunkLimit",
  ],
  resolveAllowFrom: (account) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) => formatTwilioSmsAllowFrom(allowFrom),
  resolveDefaultTo: (account) => account.config.defaultTo,
});

const resolveTwilioSmsDmPolicy = createScopedDmSecurityResolver<ResolvedTwilioSmsAccount>({
  channelKey: TWILIO_SMS_CHANNEL_ID,
  resolvePolicy: (account) => account.config.dmPolicy,
  resolveAllowFrom: (account) => account.config.allowFrom,
  defaultPolicy: "pairing",
  policyPathSuffix: "dmPolicy",
  approveHint: "openclaw pairing approve twilio-sms <code>",
  normalizeEntry: (raw) => normalizeTwilioSmsAllowEntry(raw) ?? raw.trim(),
});

function resolveTwilioSmsOutboundSessionRoute(params: ChannelOutboundSessionRouteParams) {
  const target = normalizeTwilioSmsMessagingTarget(params.target);
  if (!target) {
    return null;
  }
  return buildChannelOutboundSessionRoute({
    cfg: params.cfg,
    agentId: params.agentId,
    channel: TWILIO_SMS_CHANNEL_ID,
    accountId: params.accountId,
    peer: {
      kind: "direct",
      id: target,
    },
    chatType: "direct",
    from: TWILIO_SMS_PROVIDER_PREFIX + ":" + target,
    to: TWILIO_SMS_PROVIDER_PREFIX + ":" + target,
  });
}

export const twilioSmsPlugin: ChannelPlugin<ResolvedTwilioSmsAccount> = createChatChannelPlugin({
  base: {
    id: TWILIO_SMS_CHANNEL_ID,
    meta: {
      id: TWILIO_SMS_CHANNEL_ID,
      label: "Twilio SMS",
      selectionLabel: "Twilio SMS",
      detailLabel: "Twilio Programmable SMS",
      docsPath: "/channels/twilio-sms",
      docsLabel: "twilio-sms",
      blurb: "Hosted SMS via Twilio Programmable Messaging.",
      systemImage: "message.badge",
      quickstartAllowFrom: true,
    },
    capabilities: {
      chatTypes: ["direct"],
      media: false,
      reactions: false,
      threads: false,
      nativeCommands: false,
      blockStreaming: true,
    },
    reload: { configPrefixes: ["channels.twilio-sms"] },
    configSchema: TwilioSmsChannelConfigSchema,
    config: {
      ...twilioSmsConfigAdapter,
      isConfigured: (account) => account.configured,
      describeAccount: (account) =>
        describeAccountSnapshot({
          account,
          configured: account.configured,
          extra: {
            credentialSource: account.credentialSource,
            fromNumber: maskPhoneNumber(account.fromNumber),
            messagingServiceSid: account.messagingServiceSid ? "configured" : undefined,
          },
        }),
    },
    messaging: {
      targetPrefixes: [TWILIO_SMS_PROVIDER_PREFIX, TWILIO_SMS_CHANNEL_ID],
      normalizeTarget: normalizeTwilioSmsMessagingTarget,
      inferTargetChatType: () => "direct",
      resolveOutboundSessionRoute: resolveTwilioSmsOutboundSessionRoute,
      targetResolver: {
        looksLikeId: looksLikeTwilioSmsTarget,
        hint: "<+E.164|twilio:+E.164>",
      },
      defaultMarkdownTableMode: "bullets",
    },
    directory: createEmptyChannelDirectoryAdapter(),
    message: twilioSmsMessageAdapter,
    gateway: twilioSmsGatewayAdapter,
    status: createComputedAccountStatusAdapter<ResolvedTwilioSmsAccount>({
      defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
      collectStatusIssues: (accounts) =>
        collectStatusIssuesFromLastError(TWILIO_SMS_CHANNEL_ID, accounts),
      buildChannelSummary: ({ snapshot }) => buildBaseChannelStatusSummary(snapshot),
      resolveAccountSnapshot: ({ account }) => ({
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        extra: {
          credentialSource: account.credentialSource,
          fromNumber: maskPhoneNumber(account.fromNumber),
          messagingServiceSid: account.messagingServiceSid ? "configured" : undefined,
        },
      }),
    }),
  },
  pairing: {
    text: {
      idLabel: "twilioSmsNumber",
      message: PAIRING_APPROVED_MESSAGE,
      normalizeAllowEntry: (entry) => normalizeTwilioSmsAllowEntry(entry) ?? entry.trim(),
      notify: async ({ cfg, id, message, accountId }) => {
        await sendTwilioSmsMessage(id, message, {
          cfg,
          accountId,
        });
      },
    },
  },
  security: {
    resolveDmPolicy: resolveTwilioSmsDmPolicy,
  },
  outbound: twilioSmsOutboundAdapter,
});
