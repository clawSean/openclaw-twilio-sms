import {
  createMessageReceiptFromOutboundResults,
  defineChannelMessageAdapter,
  type ChannelMessageSendResult,
} from "openclaw/plugin-sdk/channel-message";
import type {
  ChannelOutboundAdapter,
  OutboundDeliveryResult,
} from "openclaw/plugin-sdk/channel-send-result";
import { resolveOutboundSendDep } from "openclaw/plugin-sdk/outbound-send-deps";
import { chunkTextForOutbound, stripMarkdown } from "openclaw/plugin-sdk/text-chunking";
import { resolveTwilioSmsAccount } from "./accounts.js";
import { TWILIO_SMS_CHANNEL_ID, TWILIO_SMS_DEFAULT_TEXT_CHUNK_LIMIT } from "./constants.js";
import { normalizeTwilioSmsPhoneNumber } from "./phone.js";
import { sendTwilioSmsMessage } from "./send.js";
import type { TwilioSmsSendResult } from "./types.js";

type TwilioSmsSendFn = typeof sendTwilioSmsMessage;

function resolveSendFn(deps: { [channelId: string]: unknown } | null | undefined): TwilioSmsSendFn {
  return (
    resolveOutboundSendDep<TwilioSmsSendFn>(deps, TWILIO_SMS_CHANNEL_ID) ?? sendTwilioSmsMessage
  );
}

export function toTwilioSmsPlainText(text: string): string {
  const withReadableLinks = (text ?? "").replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_match, label: string, url: string) => {
      const cleanLabel = label.trim();
      const cleanUrl = url.trim();
      return cleanLabel && cleanLabel !== cleanUrl ? cleanLabel + " (" + cleanUrl + ")" : cleanUrl;
    },
  );
  return stripMarkdown(withReadableLinks)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function resolveChunkLimit(params: {
  cfg: Parameters<typeof resolveTwilioSmsAccount>[0]["cfg"];
  accountId?: string | null;
  fallbackLimit?: number;
}): number {
  const account = resolveTwilioSmsAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  return (
    account.config.textChunkLimit ?? params.fallbackLimit ?? TWILIO_SMS_DEFAULT_TEXT_CHUNK_LIMIT
  );
}

function toOutboundDeliveryResult(result: TwilioSmsSendResult): OutboundDeliveryResult {
  return {
    channel: TWILIO_SMS_CHANNEL_ID,
    messageId: result.messageId,
    chatId: result.chatId,
    toJid: result.toJid,
    receipt: result.receipt,
    ...(result.status ? { meta: { status: result.status } } : {}),
  };
}

async function sendTwilioSmsOutbound(params: {
  cfg: Parameters<typeof resolveTwilioSmsAccount>[0]["cfg"];
  to: string;
  text: string;
  accountId?: string | null;
  deps?: { [channelId: string]: unknown };
}): Promise<OutboundDeliveryResult> {
  const send = resolveSendFn(params.deps);
  const result = await send(params.to, params.text, {
    cfg: params.cfg,
    accountId: params.accountId,
  });
  return toOutboundDeliveryResult(result);
}

export async function sendFormattedTwilioSmsText(params: {
  cfg: Parameters<typeof resolveTwilioSmsAccount>[0]["cfg"];
  to: string;
  text: string;
  accountId?: string | null;
  deps?: { [channelId: string]: unknown };
  abortSignal?: AbortSignal;
}): Promise<OutboundDeliveryResult[]> {
  const target = normalizeTwilioSmsPhoneNumber(params.to);
  if (!target) {
    throw new Error("Twilio SMS target must be an E.164 phone number.");
  }
  const text = toTwilioSmsPlainText(params.text);
  if (!text) {
    throw new Error("Twilio SMS send requires non-empty text.");
  }
  const limit = resolveChunkLimit({
    cfg: params.cfg,
    accountId: params.accountId,
    fallbackLimit: TWILIO_SMS_DEFAULT_TEXT_CHUNK_LIMIT,
  });
  const chunks = chunkTextForOutbound(text, limit);
  const results: OutboundDeliveryResult[] = [];
  for (const chunk of chunks) {
    params.abortSignal?.throwIfAborted();
    results.push(
      await sendTwilioSmsOutbound({
        cfg: params.cfg,
        to: target,
        text: chunk,
        accountId: params.accountId,
        deps: params.deps,
      }),
    );
  }
  return results;
}

function toChannelMessageSendResult(params: {
  results: readonly OutboundDeliveryResult[];
  threadId?: string | number | null;
  replyToId?: string | null;
}): ChannelMessageSendResult {
  const receipt = createMessageReceiptFromOutboundResults({
    results: params.results,
    kind: "text",
    threadId: params.threadId == null ? undefined : String(params.threadId),
    replyToId: params.replyToId ?? undefined,
  });
  return {
    receipt,
    ...(receipt.primaryPlatformMessageId ? { messageId: receipt.primaryPlatformMessageId } : {}),
  };
}

export const twilioSmsOutboundAdapter: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: chunkTextForOutbound,
  chunkerMode: "text",
  textChunkLimit: TWILIO_SMS_DEFAULT_TEXT_CHUNK_LIMIT,
  deliveryCapabilities: {
    durableFinal: {
      text: true,
      messageSendingHooks: true,
      batch: true,
    },
  },
  sanitizeText: ({ text }) => toTwilioSmsPlainText(text),
  resolveEffectiveTextChunkLimit: ({ cfg, accountId, fallbackLimit }) =>
    resolveChunkLimit({ cfg, accountId, fallbackLimit }),
  resolveTarget: ({ cfg, to, accountId }) => {
    const explicit = normalizeTwilioSmsPhoneNumber(to);
    if (explicit) {
      return { ok: true, to: explicit };
    }
    if (cfg) {
      const account = resolveTwilioSmsAccount({ cfg, accountId });
      if (account.defaultTo) {
        return { ok: true, to: account.defaultTo };
      }
    }
    return { ok: false, error: new Error("Twilio SMS target must be an E.164 phone number.") };
  },
  sendFormattedText: async ({ cfg, to, text, accountId, deps, abortSignal }) =>
    await sendFormattedTwilioSmsText({
      cfg,
      to,
      text,
      accountId,
      deps,
      abortSignal,
    }),
  sendText: async ({ cfg, to, text, accountId, deps }) =>
    await sendTwilioSmsOutbound({
      cfg,
      to,
      text: toTwilioSmsPlainText(text),
      accountId,
      deps,
    }),
};

export const twilioSmsMessageAdapter = defineChannelMessageAdapter({
  id: TWILIO_SMS_CHANNEL_ID,
  durableFinal: {
    capabilities: {
      text: true,
      messageSendingHooks: true,
      batch: true,
    },
  },
  send: {
    text: async (ctx) => {
      const results = await sendFormattedTwilioSmsText({
        cfg: ctx.cfg,
        to: ctx.to,
        text: ctx.text,
        accountId: ctx.accountId,
        deps: ctx.deps,
        abortSignal: ctx.signal,
      });
      return toChannelMessageSendResult({
        results,
        threadId: ctx.threadId,
        replyToId: ctx.replyToId,
      });
    },
  },
  receive: {
    defaultAckPolicy: "after_receive_record",
    supportedAckPolicies: ["after_receive_record"],
  },
});
