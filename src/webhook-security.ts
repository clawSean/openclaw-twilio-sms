import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import { safeEqualSecret } from "openclaw/plugin-sdk/security-runtime";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/string-coerce-runtime";

const TWILIO_SMS_REPLAY_WINDOW_MS = 10 * 60 * 1000;
const TWILIO_SMS_REPLAY_CACHE_MAX_ENTRIES = 10_000;
const TWILIO_SMS_REPLAY_CACHE_PRUNE_INTERVAL = 64;

type ReplayCache = {
  seenUntil: Map<string, number>;
  calls: number;
};

const twilioSmsReplayCache: ReplayCache = {
  seenUntil: new Map<string, number>(),
  calls: 0,
};

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function pruneReplayCache(cache: ReplayCache, now: number): void {
  for (const [key, expiresAt] of cache.seenUntil) {
    if (expiresAt <= now) {
      cache.seenUntil.delete(key);
    }
  }
  while (cache.seenUntil.size > TWILIO_SMS_REPLAY_CACHE_MAX_ENTRIES) {
    const oldest = cache.seenUntil.keys().next().value;
    if (!oldest) {
      break;
    }
    cache.seenUntil.delete(oldest);
  }
}

export function claimTwilioSmsWebhookReplayKey(replayKey: string, now = Date.now()): boolean {
  twilioSmsReplayCache.calls += 1;
  if (twilioSmsReplayCache.calls % TWILIO_SMS_REPLAY_CACHE_PRUNE_INTERVAL === 0) {
    pruneReplayCache(twilioSmsReplayCache, now);
  }

  const existing = twilioSmsReplayCache.seenUntil.get(replayKey);
  if (existing && existing > now) {
    return false;
  }

  twilioSmsReplayCache.seenUntil.set(replayKey, now + TWILIO_SMS_REPLAY_WINDOW_MS);
  if (twilioSmsReplayCache.seenUntil.size > TWILIO_SMS_REPLAY_CACHE_MAX_ENTRIES) {
    pruneReplayCache(twilioSmsReplayCache, now);
  }
  return true;
}

export function clearTwilioSmsWebhookReplayCacheForTests(): void {
  twilioSmsReplayCache.seenUntil.clear();
  twilioSmsReplayCache.calls = 0;
}

export function buildTwilioSmsWebhookReplayKey(params: {
  accountId: string;
  signature: string;
  rawBody: string;
  form: URLSearchParams;
}): string {
  const messageSid =
    params.form.get("MessageSid")?.trim() ||
    params.form.get("SmsSid")?.trim() ||
    params.form.get("SmsMessageSid")?.trim();
  if (messageSid) {
    return params.accountId + ":message:" + messageSid;
  }
  return params.accountId + ":body:" + sha256Hex(params.signature + "\n" + params.rawBody);
}

function sortedTwilioParams(form: URLSearchParams): Array<[string, string]> {
  return Array.from(form.entries()).toSorted((a, b) => {
    if (a[0] === b[0]) {
      return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
    }
    return a[0] < b[0] ? -1 : 1;
  });
}

export function buildTwilioSmsSignatureBase(url: string, form: URLSearchParams): string {
  let data = url;
  for (const [key, value] of sortedTwilioParams(form)) {
    data += key + value;
  }
  return data;
}

export function validateTwilioSmsWebhookSignature(params: {
  authToken: string;
  signature: string | undefined;
  url: string;
  form: URLSearchParams;
}): boolean {
  const signature = params.signature?.trim();
  if (!signature || !params.authToken) {
    return false;
  }
  const expected = crypto
    .createHmac("sha1", params.authToken)
    .update(buildTwilioSmsSignatureBase(params.url, params.form))
    .digest("base64");
  return safeEqualSecret(signature, expected);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeHostHeader(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw || raw.includes("@")) {
    return undefined;
  }
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 0 ? normalizeLowercaseStringOrEmpty(raw.slice(1, end)) : undefined;
  }
  const host = raw.split(":")[0]?.trim();
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) {
    return undefined;
  }
  return normalizeLowercaseStringOrEmpty(host);
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : "/" + path;
}

function requestPathWithSearch(req: IncomingMessage, fallbackPath: string): string {
  try {
    const parsed = new URL(req.url ?? fallbackPath, "http://localhost");
    return parsed.pathname + parsed.search;
  } catch {
    return normalizePath(fallbackPath);
  }
}

function appendRequestPathToUrl(
  baseUrl: string,
  req: IncomingMessage,
  path: string,
): string | undefined {
  try {
    const parsed = new URL(baseUrl);
    if (!parsed.protocol.startsWith("http")) {
      return undefined;
    }
    const requestUrl = new URL(requestPathWithSearch(req, path), parsed);
    parsed.pathname = requestUrl.pathname;
    parsed.search = requestUrl.search;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function resolveTwilioSmsWebhookUrl(params: {
  req: IncomingMessage;
  path: string;
  publicUrl?: string;
}): string | undefined {
  const explicit = appendRequestPathToUrl(params.publicUrl?.trim() ?? "", params.req, params.path);
  if (explicit) {
    return explicit;
  }

  const host = normalizeHostHeader(firstHeaderValue(params.req.headers.host));
  if (!host) {
    return undefined;
  }
  const proto = host === "localhost" || host === "127.0.0.1" ? "http" : "https";
  return proto + "://" + host + requestPathWithSearch(params.req, params.path);
}
