import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/string-coerce-runtime";
import { normalizeE164 } from "openclaw/plugin-sdk/text-utility-runtime";
import { TWILIO_SMS_ALT_PROVIDER_PREFIX, TWILIO_SMS_PROVIDER_PREFIX } from "./constants.js";

const E164_PATTERN = /^\+\d{3,15}$/;
const TWILIO_PREFIX_PATTERN = new RegExp(
  "^(?:" + TWILIO_SMS_PROVIDER_PREFIX + "|" + TWILIO_SMS_ALT_PROVIDER_PREFIX + "):",
  "i",
);

export function stripTwilioSmsTargetPrefix(raw: string): string {
  return raw.trim().replace(TWILIO_PREFIX_PATTERN, "").trim();
}

export function normalizeTwilioSmsPhoneNumber(raw: string | number | null | undefined) {
  if (raw == null) {
    return undefined;
  }
  const value = String(raw).trim();
  if (!value || /^sms:/i.test(value)) {
    return undefined;
  }
  const stripped = stripTwilioSmsTargetPrefix(value);
  if (!stripped) {
    return undefined;
  }
  const normalized = normalizeE164(stripped);
  return E164_PATTERN.test(normalized) ? normalized : undefined;
}

export function normalizeTwilioSmsMessagingTarget(raw: string): string | undefined {
  return normalizeTwilioSmsPhoneNumber(raw);
}

export function normalizeTwilioSmsAllowEntry(raw: string | number): string | undefined {
  const value = String(raw).trim();
  if (!value) {
    return undefined;
  }
  if (value === "*") {
    return "*";
  }
  return normalizeTwilioSmsPhoneNumber(value);
}

export function formatTwilioSmsAllowFrom(allowFrom: Array<string | number>): string[] {
  return allowFrom
    .map((entry) => normalizeTwilioSmsAllowEntry(entry))
    .filter((entry): entry is string => Boolean(entry));
}

export function looksLikeTwilioSmsTarget(raw: string, normalized?: string): boolean {
  const candidates = [raw, normalized ?? ""].map((value) => value.trim()).filter(Boolean);
  for (const candidate of candidates) {
    if (/^sms:/i.test(candidate)) {
      continue;
    }
    if (TWILIO_PREFIX_PATTERN.test(candidate)) {
      return Boolean(normalizeTwilioSmsPhoneNumber(candidate));
    }
    const lower = normalizeLowercaseStringOrEmpty(candidate);
    if (lower.startsWith("tel:")) {
      continue;
    }
    if (normalizeTwilioSmsPhoneNumber(candidate)) {
      return true;
    }
  }
  return false;
}
