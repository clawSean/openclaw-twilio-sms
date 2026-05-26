import type { IncomingMessage, ServerResponse } from "node:http";
import { createMessageReceiveContext } from "openclaw/plugin-sdk/channel-message";
import { danger, logVerbose, type RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "openclaw/plugin-sdk/webhook-request-guards";
import { TWILIO_SMS_CHANNEL_ID } from "./constants.js";
import { normalizeTwilioSmsPhoneNumber } from "./phone.js";
import type { ResolvedTwilioSmsAccount } from "./types.js";
import {
  buildTwilioSmsWebhookReplayKey,
  claimTwilioSmsWebhookReplayKey,
  resolveTwilioSmsWebhookUrl,
  validateTwilioSmsWebhookSignature,
} from "./webhook-security.js";

const TWILIO_SMS_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
const TWILIO_SMS_WEBHOOK_BODY_TIMEOUT_MS = 5_000;

export type TwilioSmsWebhookEvent = {
  accountSid: string;
  from: string;
  to: string;
  body: string;
  messageSid: string;
  rawBody: string;
  receivedAt: number;
  form: URLSearchParams;
};

export type TwilioSmsWebhookTarget = {
  accountId: string;
  account: ResolvedTwilioSmsAccount;
  cfg: Parameters<typeof import("./accounts.js").resolveTwilioSmsAccount>[0]["cfg"];
  path: string;
  runtime: RuntimeEnv;
  handleEvent: (event: TwilioSmsWebhookEvent) => Promise<void>;
};

export async function readTwilioSmsWebhookRequestBody(
  req: IncomingMessage,
  maxBytes = TWILIO_SMS_WEBHOOK_MAX_BODY_BYTES,
  timeoutMs = TWILIO_SMS_WEBHOOK_BODY_TIMEOUT_MS,
): Promise<string> {
  return await readRequestBodyWithLimit(req, {
    maxBytes,
    timeoutMs,
  });
}

export function parseTwilioSmsWebhookEvent(rawBody: string): TwilioSmsWebhookEvent | null {
  const form = new URLSearchParams(rawBody);
  const from = normalizeTwilioSmsPhoneNumber(form.get("From"));
  const to = normalizeTwilioSmsPhoneNumber(form.get("To"));
  const body = form.get("Body")?.trim() ?? "";
  const accountSid = form.get("AccountSid")?.trim() ?? "";
  const messageSid =
    form.get("MessageSid")?.trim() ||
    form.get("SmsSid")?.trim() ||
    form.get("SmsMessageSid")?.trim() ||
    "";
  if (!from || !to || !accountSid || !messageSid) {
    return null;
  }
  return {
    accountSid,
    from,
    to,
    body,
    messageSid,
    rawBody,
    receivedAt: Date.now(),
    form,
  };
}

function getSignature(req: IncomingMessage): string | undefined {
  const header = req.headers["x-twilio-signature"];
  return Array.isArray(header) ? header[0] : header;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

type TwilioSmsWebhookTargetMatch =
  | { kind: "single"; target: TwilioSmsWebhookTarget }
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "url" };

function matchTwilioSmsWebhookTarget(params: {
  req: IncomingMessage;
  path: string;
  rawBody: string;
  form: URLSearchParams;
  signature: string | undefined;
  targets: readonly TwilioSmsWebhookTarget[];
}): TwilioSmsWebhookTargetMatch {
  let matched: TwilioSmsWebhookTarget | undefined;
  for (const target of params.targets) {
    const url = resolveTwilioSmsWebhookUrl({
      req: params.req,
      path: params.path,
      publicUrl: target.account.config.publicUrl,
    });
    if (!url) {
      return { kind: "url" };
    }
    const ok = validateTwilioSmsWebhookSignature({
      authToken: target.account.authToken,
      signature: params.signature,
      url,
      form: params.form,
    });
    if (!ok) {
      continue;
    }
    if (matched) {
      return { kind: "ambiguous" };
    }
    matched = target;
  }
  return matched ? { kind: "single", target: matched } : { kind: "none" };
}

function logTwilioSmsWebhookDispatchError(runtime: RuntimeEnv | undefined, err: unknown): void {
  runtime?.error?.(danger("twilio-sms webhook dispatch failed: " + String(err)));
}

export function createTwilioSmsNodeWebhookHandler(params: {
  path: string;
  targets: () => readonly TwilioSmsWebhookTarget[];
  runtime: RuntimeEnv;
  readBody?: typeof readTwilioSmsWebhookRequestBody;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const readBody = params.readBody ?? readTwilioSmsWebhookRequestBody;
  return async (req, res) => {
    if (req.method === "GET" || req.method === "HEAD") {
      res.statusCode = req.method === "HEAD" ? 204 : 200;
      if (req.method !== "HEAD") {
        res.setHeader("Content-Type", "text/plain");
      }
      res.end(req.method === "HEAD" ? undefined : "OK");
      return;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD, POST");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }

    const signature = getSignature(req);
    if (!signature) {
      logVerbose("twilio-sms: webhook missing X-Twilio-Signature header");
      sendJson(res, 400, { error: "Missing X-Twilio-Signature header" });
      return;
    }

    let receiveContext:
      | ReturnType<typeof createMessageReceiveContext<TwilioSmsWebhookEvent>>
      | undefined;
    try {
      const rawBody = await readBody(
        req,
        TWILIO_SMS_WEBHOOK_MAX_BODY_BYTES,
        TWILIO_SMS_WEBHOOK_BODY_TIMEOUT_MS,
      );
      const form = new URLSearchParams(rawBody);
      const match = matchTwilioSmsWebhookTarget({
        req,
        path: params.path,
        rawBody,
        form,
        signature,
        targets: params.targets(),
      });
      if (match.kind === "url") {
        sendJson(res, 400, { error: "Unable to resolve webhook URL" });
        return;
      }
      if (match.kind === "none") {
        logVerbose("twilio-sms: webhook signature validation failed");
        sendJson(res, 401, { error: "Invalid signature" });
        return;
      }
      if (match.kind === "ambiguous") {
        logVerbose("twilio-sms: webhook signature matched multiple accounts");
        sendJson(res, 401, { error: "Ambiguous webhook target" });
        return;
      }
      const target = match.target;

      const event = parseTwilioSmsWebhookEvent(rawBody);
      if (!event || event.accountSid !== target.account.accountSid) {
        sendJson(res, 400, { error: "Invalid webhook payload" });
        return;
      }

      const replayKey = buildTwilioSmsWebhookReplayKey({
        accountId: target.accountId,
        signature,
        rawBody,
        form,
      });
      if (!claimTwilioSmsWebhookReplayKey(replayKey)) {
        logVerbose("twilio-sms: skipped replayed webhook event " + event.messageSid);
        sendJson(res, 200, { status: "replayed" });
        return;
      }

      receiveContext = createMessageReceiveContext({
        id: event.messageSid,
        channel: TWILIO_SMS_CHANNEL_ID,
        message: event,
        ackPolicy: "after_receive_record",
        onAck: () => {
          sendJson(res, 200, { status: "ok" });
        },
      });

      if (receiveContext.shouldAckAfter("receive_record")) {
        await receiveContext.ack();
      }

      void Promise.resolve()
        .then(() => target.handleEvent(event))
        .catch((err) => logTwilioSmsWebhookDispatchError(target.runtime, err));
    } catch (err) {
      await receiveContext?.nack(err);
      if (isRequestBodyLimitError(err, "PAYLOAD_TOO_LARGE")) {
        sendJson(res, 413, { error: "Payload too large" });
        return;
      }
      if (isRequestBodyLimitError(err, "REQUEST_BODY_TIMEOUT")) {
        sendJson(res, 408, { error: requestBodyErrorToText("REQUEST_BODY_TIMEOUT") });
        return;
      }
      params.runtime.error?.(danger("twilio-sms webhook error: " + String(err)));
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal server error" });
      }
    }
  };
}
