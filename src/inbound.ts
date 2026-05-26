import { recordChannelActivity } from "openclaw/plugin-sdk/channel-activity-runtime";
import {
  formatInboundEnvelope,
  resolveInboundSessionEnvelopeContext,
} from "openclaw/plugin-sdk/channel-inbound";
import { resolveStableChannelMessageIngress } from "openclaw/plugin-sdk/channel-ingress-runtime";
import { createMessageReceiptFromOutboundResults } from "openclaw/plugin-sdk/channel-message";
import { createChannelPairingChallengeIssuer } from "openclaw/plugin-sdk/channel-pairing";
import { shouldComputeCommandAuthorized } from "openclaw/plugin-sdk/command-auth-native";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  readChannelAllowFromStore,
  resolvePairingIdLabel,
  upsertChannelPairingRequest,
} from "openclaw/plugin-sdk/conversation-runtime";
import { finalizeInboundContext } from "openclaw/plugin-sdk/reply-dispatch-runtime";
import { resolveAgentRoute, resolveInboundLastRouteSessionKey } from "openclaw/plugin-sdk/routing";
import { danger, logVerbose, type RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { normalizeStringEntries } from "openclaw/plugin-sdk/string-coerce-runtime";
import { TWILIO_SMS_CHANNEL_ID, TWILIO_SMS_PROVIDER_PREFIX } from "./constants.js";
import { sendFormattedTwilioSmsText } from "./outbound.js";
import { normalizeTwilioSmsAllowEntry } from "./phone.js";
import { getTwilioSmsRuntime } from "./runtime.js";
import type { ResolvedTwilioSmsAccount } from "./types.js";
import type { TwilioSmsWebhookEvent } from "./webhook.js";

type TwilioSmsInboundContext = {
  ctxPayload: ReturnType<typeof finalizeInboundContext>;
  route: ReturnType<typeof resolveAgentRoute>;
  turn: {
    storePath: string;
    record: {
      updateLastRoute?: {
        sessionKey: string;
        channel: string;
        to: string;
        accountId?: string;
      };
      onRecordError: (err: unknown) => void;
    };
  };
};

function prefixedPhone(phone: string): string {
  return TWILIO_SMS_PROVIDER_PREFIX + ":" + phone;
}

function maskPhone(phone: string): string {
  return "***" + phone.slice(-4);
}

function normalizeIngressPhoneEntry(value: string): string | null {
  return normalizeTwilioSmsAllowEntry(value) ?? null;
}

async function sendTwilioSmsPairingReply(params: {
  cfg: OpenClawConfig;
  account: ResolvedTwilioSmsAccount;
  senderId: string;
}): Promise<void> {
  const idLabel = (() => {
    try {
      return resolvePairingIdLabel(TWILIO_SMS_CHANNEL_ID);
    } catch {
      return "twilioSmsNumber";
    }
  })();
  await createChannelPairingChallengeIssuer({
    channel: TWILIO_SMS_CHANNEL_ID,
    upsertPairingRequest: async ({ id, meta }) =>
      await upsertChannelPairingRequest({
        channel: TWILIO_SMS_CHANNEL_ID,
        id,
        accountId: params.account.accountId,
        meta,
      }),
  })({
    senderId: params.senderId,
    senderIdLine: "Your " + idLabel + ": " + params.senderId,
    meta: { phone: params.senderId },
    sendPairingReply: async (text) => {
      await sendFormattedTwilioSmsText({
        cfg: params.cfg,
        to: params.senderId,
        text,
        accountId: params.account.accountId,
      });
    },
    onCreated: ({ code }) => {
      logVerbose(
        "twilio-sms pairing request sender=" + maskPhone(params.senderId) + " code=" + code,
      );
    },
    onReplyError: (err) => {
      logVerbose(
        "twilio-sms pairing reply failed for " + maskPhone(params.senderId) + ": " + String(err),
      );
    },
  });
}

async function shouldProcessTwilioSmsEvent(params: {
  cfg: OpenClawConfig;
  account: ResolvedTwilioSmsAccount;
  event: TwilioSmsWebhookEvent;
}) {
  const rawText = params.event.body;
  const dmPolicy = params.account.config.dmPolicy ?? "pairing";
  const access = await resolveStableChannelMessageIngress({
    channelId: TWILIO_SMS_CHANNEL_ID,
    accountId: params.account.accountId,
    identity: {
      key: "phone-number",
      kind: "phone",
      normalize: normalizeIngressPhoneEntry,
      sensitivity: "pii",
      entryIdPrefix: "phone-entry",
    },
    cfg: params.cfg,
    readStoreAllowFrom: async () =>
      await readChannelAllowFromStore(TWILIO_SMS_CHANNEL_ID, undefined, params.account.accountId),
    subject: { stableId: params.event.from },
    conversation: {
      kind: "direct",
      id: params.event.from,
    },
    event: { kind: "message", mayPair: true },
    dmPolicy,
    groupPolicy: "disabled",
    allowFrom: normalizeStringEntries(params.account.config.allowFrom),
    command: {
      hasControlCommand: shouldComputeCommandAuthorized(rawText, params.cfg),
      groupOwnerAllowFrom: "none",
      allowTextCommands: true,
    },
  });

  if (access.senderAccess.decision === "allow" && access.ingress.admission === "dispatch") {
    return access;
  }
  if (access.senderAccess.decision === "allow" && access.ingress.admission === "observe") {
    return access;
  }
  if (access.senderAccess.decision === "pairing") {
    await sendTwilioSmsPairingReply({
      cfg: params.cfg,
      account: params.account,
      senderId: params.event.from,
    });
    return null;
  }
  logVerbose(
    "twilio-sms: blocked inbound sender " +
      maskPhone(params.event.from) +
      " (" +
      access.ingress.reasonCode +
      ")",
  );
  return null;
}

async function buildTwilioSmsInboundContext(params: {
  cfg: OpenClawConfig;
  account: ResolvedTwilioSmsAccount;
  event: TwilioSmsWebhookEvent;
  commandAuthorized: boolean;
}): Promise<TwilioSmsInboundContext> {
  recordChannelActivity({
    channel: TWILIO_SMS_CHANNEL_ID,
    accountId: params.account.accountId,
    direction: "inbound",
  });

  const from = prefixedPhone(params.event.from);
  const to = prefixedPhone(params.event.to);
  const route = resolveAgentRoute({
    cfg: params.cfg,
    channel: TWILIO_SMS_CHANNEL_ID,
    accountId: params.account.accountId,
    peer: {
      kind: "direct",
      id: params.event.from,
    },
  });
  const { storePath, envelopeOptions, previousTimestamp } = resolveInboundSessionEnvelopeContext({
    cfg: params.cfg,
    agentId: route.agentId,
    sessionKey: route.sessionKey,
  });
  const body = formatInboundEnvelope({
    channel: "Twilio SMS",
    from: maskPhone(params.event.from),
    timestamp: params.event.receivedAt,
    body: params.event.body,
    chatType: "direct",
    sender: {
      id: params.event.from,
    },
    previousTimestamp,
    envelope: envelopeOptions,
  });
  const ctxPayload = finalizeInboundContext({
    Body: body,
    BodyForAgent: params.event.body,
    RawBody: params.event.body,
    CommandBody: params.event.body,
    From: from,
    To: to,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "direct",
    ConversationLabel: "SMS " + maskPhone(params.event.from),
    SenderId: params.event.from,
    SenderE164: params.event.from,
    Provider: TWILIO_SMS_CHANNEL_ID,
    Surface: "sms",
    MessageSid: params.event.messageSid,
    Timestamp: params.event.receivedAt,
    CommandAuthorized: params.commandAuthorized,
    OriginatingChannel: TWILIO_SMS_CHANNEL_ID,
    OriginatingTo: from,
  });
  const inboundLastRouteSessionKey = resolveInboundLastRouteSessionKey({
    route,
    sessionKey: route.sessionKey,
  });
  return {
    ctxPayload,
    route,
    turn: {
      storePath,
      record: {
        updateLastRoute: {
          sessionKey: inboundLastRouteSessionKey,
          channel: TWILIO_SMS_CHANNEL_ID,
          to: params.event.from,
          accountId: route.accountId,
        },
        onRecordError: (err: unknown) => {
          logVerbose("twilio-sms: failed updating session meta: " + String(err));
        },
      },
    },
  };
}

export async function handleTwilioSmsWebhookEvent(params: {
  cfg: OpenClawConfig;
  account: ResolvedTwilioSmsAccount;
  event: TwilioSmsWebhookEvent;
  runtime: RuntimeEnv;
}): Promise<void> {
  if (!params.event.body.trim()) {
    logVerbose("twilio-sms: skipped empty inbound SMS from " + maskPhone(params.event.from));
    return;
  }
  const access = await shouldProcessTwilioSmsEvent(params);
  if (!access) {
    return;
  }
  const inbound = await buildTwilioSmsInboundContext({
    cfg: params.cfg,
    account: params.account,
    event: params.event,
    commandAuthorized: access.commandAccess.authorized,
  });
  const core = getTwilioSmsRuntime();
  try {
    await core.channel.turn.runAssembled({
      cfg: params.cfg,
      channel: TWILIO_SMS_CHANNEL_ID,
      accountId: inbound.route.accountId,
      agentId: inbound.route.agentId,
      routeSessionKey: inbound.route.sessionKey,
      storePath: inbound.turn.storePath,
      ctxPayload: inbound.ctxPayload,
      recordInboundSession: core.channel.session.recordInboundSession,
      dispatchReplyWithBufferedBlockDispatcher:
        core.channel.reply.dispatchReplyWithBufferedBlockDispatcher,
      record: inbound.turn.record,
      admission:
        access.ingress.admission === "observe"
          ? { kind: "observeOnly", reason: access.ingress.reasonCode }
          : { kind: "dispatch" },
      delivery: {
        durable: () => ({
          to: params.event.from,
          requiredCapabilities: { text: true },
        }),
        deliver: async (payload) => {
          const results = await sendFormattedTwilioSmsText({
            cfg: params.cfg,
            to: params.event.from,
            text: payload.text ?? "",
            accountId: params.account.accountId,
          });
          return {
            messageIds: results.map((result) => result.messageId),
            receipt: createMessageReceiptFromOutboundResults({
              results,
              kind: "text",
            }),
            visibleReplySent: results.length > 0,
          };
        },
        onError: (err, info) => {
          params.runtime.error?.(
            danger("twilio-sms " + info.kind + " reply failed: " + String(err)),
          );
        },
      },
    });
  } catch (err) {
    params.runtime.error?.(danger("twilio-sms: auto-reply failed: " + String(err)));
    throw err;
  }
}
