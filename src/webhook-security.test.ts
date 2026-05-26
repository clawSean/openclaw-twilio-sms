import type { IncomingMessage } from "node:http";
import { describe, expect, it, beforeEach } from "vitest";
import {
  buildTwilioSmsSignatureBase,
  buildTwilioSmsWebhookReplayKey,
  claimTwilioSmsWebhookReplayKey,
  clearTwilioSmsWebhookReplayCacheForTests,
  resolveTwilioSmsWebhookUrl,
  validateTwilioSmsWebhookSignature,
} from "./webhook-security.js";

async function signature(url: string, token: string, form: URLSearchParams): Promise<string> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha1", token).update(buildTwilioSmsSignatureBase(url, form)).digest("base64");
}

function request(params: { url?: string; headers?: Record<string, string> }): IncomingMessage {
  return {
    url: params.url ?? "/twilio-sms/webhook",
    headers: params.headers ?? {},
  } as unknown as IncomingMessage;
}

describe("Twilio SMS webhook security", () => {
  beforeEach(() => {
    clearTwilioSmsWebhookReplayCacheForTests();
  });

  it("validates Twilio HMAC signatures with sorted form params", async () => {
    const url = "https://sms.example.com/twilio-sms/webhook";
    const token = "auth-token";
    const form = new URLSearchParams();
    form.set("To", "+15551230000");
    form.set("Body", "hello");
    form.set("From", "+15551230001");
    const sig = await signature(url, token, form);

    expect(
      validateTwilioSmsWebhookSignature({
        authToken: token,
        signature: sig,
        url,
        form,
      }),
    ).toBe(true);
    expect(
      validateTwilioSmsWebhookSignature({
        authToken: token,
        signature: "wrong",
        url,
        form,
      }),
    ).toBe(false);
  });

  it("claims replay keys only once during the replay window", () => {
    const form = new URLSearchParams("MessageSid=SM123&From=%2B15551230001");
    const key = buildTwilioSmsWebhookReplayKey({
      accountId: "default",
      signature: "sig",
      rawBody: form.toString(),
      form,
    });

    expect(claimTwilioSmsWebhookReplayKey(key, 1_000)).toBe(true);
    expect(claimTwilioSmsWebhookReplayKey(key, 1_001)).toBe(false);
  });

  it("uses configured public URL origin with the actual request path and query", () => {
    expect(
      resolveTwilioSmsWebhookUrl({
        req: request({
          url: "/twilio-sms/webhook?tenant=one",
          headers: {
            host: "internal.local",
            "x-forwarded-host": "evil.example.com",
          },
        }),
        path: "/twilio-sms/webhook",
        publicUrl: "https://sms.example.com/base",
      }),
    ).toBe("https://sms.example.com/twilio-sms/webhook?tenant=one");
  });

  it("does not trust forwarded host when publicUrl is not configured", () => {
    expect(
      resolveTwilioSmsWebhookUrl({
        req: request({
          url: "/twilio-sms/webhook",
          headers: {
            host: "sms.example.com",
            "x-forwarded-host": "evil.example.com",
          },
        }),
        path: "/twilio-sms/webhook",
      }),
    ).toBe("https://sms.example.com/twilio-sms/webhook");
  });
});
