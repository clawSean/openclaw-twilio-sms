import { describe, expect, it } from "vitest";
import {
  formatTwilioSmsAllowFrom,
  looksLikeTwilioSmsTarget,
  normalizeTwilioSmsMessagingTarget,
  normalizeTwilioSmsPhoneNumber,
} from "./phone.js";

describe("twilio-sms phone normalization", () => {
  it("normalizes bare and twilio-prefixed E.164-ish numbers", () => {
    expect(normalizeTwilioSmsPhoneNumber("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizeTwilioSmsPhoneNumber("twilio:+1.555.123.4567")).toBe("+15551234567");
    expect(normalizeTwilioSmsPhoneNumber("twilio-sms:15551234567")).toBe("+15551234567");
  });

  it("does not claim the generic sms: service prefix", () => {
    expect(normalizeTwilioSmsPhoneNumber("sms:+15551234567")).toBeUndefined();
    expect(looksLikeTwilioSmsTarget("sms:+15551234567")).toBe(false);
  });

  it("normalizes message targets and allowlists", () => {
    expect(normalizeTwilioSmsMessagingTarget("twilio:+15551234567")).toBe("+15551234567");
    expect(formatTwilioSmsAllowFrom(["*", "twilio:+1 (555) 123-4567", "sms:+15550000000"])).toEqual(
      ["*", "+15551234567"],
    );
  });

  it("recognizes valid explicit targets", () => {
    expect(looksLikeTwilioSmsTarget("twilio:+15551234567")).toBe(true);
    expect(looksLikeTwilioSmsTarget("+15551234567")).toBe(true);
    expect(looksLikeTwilioSmsTarget("twilio:not-a-number")).toBe(false);
  });
});
