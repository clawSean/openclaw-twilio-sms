import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedTwilioSmsAccount } from "./types.js";
import {
  clearTwilioSmsWebhookReplayCacheForTests,
  buildTwilioSmsSignatureBase,
} from "./webhook-security.js";
import {
  createTwilioSmsNodeWebhookHandler,
  parseTwilioSmsWebhookEvent,
  type TwilioSmsWebhookTarget,
} from "./webhook.js";

async function signature(url: string, token: string, form: URLSearchParams): Promise<string> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha1", token).update(buildTwilioSmsSignatureBase(url, form)).digest("base64");
}

function request(params: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  return {
    method: params.method ?? "POST",
    url: params.url ?? "/twilio-sms/webhook",
    headers: params.headers ?? {},
  } as unknown as IncomingMessage;
}

function response() {
  const headers = new Map<string, string>();
  const res = {
    statusCode: 0,
    headersSent: false,
    body: "",
    setHeader: vi.fn((key: string, value: string) => {
      headers.set(key, value);
    }),
    end: vi.fn((body?: string) => {
      res.headersSent = true;
      res.body = body ?? "";
      return res as unknown as ServerResponse;
    }),
  };
  return res as unknown as ServerResponse & { body: string; setHeader: ReturnType<typeof vi.fn> };
}

function account(overrides?: Partial<ResolvedTwilioSmsAccount>): ResolvedTwilioSmsAccount {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    accountSid: "AC123",
    authToken: "auth-token",
    fromNumber: "+15551230000",
    credentialSource: "config",
    fromNumberSource: "config",
    config: {
      accountSid: "AC123",
      authToken: "auth-token",
      fromNumber: "+15551230000",
      publicUrl: "https://sms.example.com/twilio-sms/webhook",
      dmPolicy: "pairing",
    },
    ...overrides,
  };
}

function runtime(): RuntimeEnv {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  } as unknown as RuntimeEnv;
}

async function bodyAndHeaders(params?: { signature?: string; body?: string }) {
  const form = new URLSearchParams();
  form.set("AccountSid", "AC123");
  form.set("MessageSid", "SM123");
  form.set("From", "+15551230001");
  form.set("To", "+15551230000");
  form.set("Body", params?.body ?? "hello");
  const rawBody = form.toString();
  const sig =
    params?.signature ??
    (await signature("https://sms.example.com/twilio-sms/webhook", "auth-token", form));
  return {
    rawBody,
    headers: {
      host: "internal.local",
      "x-twilio-signature": sig,
    },
  };
}

describe("Twilio SMS webhook handler", () => {
  beforeEach(() => {
    clearTwilioSmsWebhookReplayCacheForTests();
  });

  it("parses required Twilio SMS webhook fields", async () => {
    const { rawBody } = await bodyAndHeaders();
    expect(parseTwilioSmsWebhookEvent(rawBody)).toMatchObject({
      accountSid: "AC123",
      from: "+15551230001",
      to: "+15551230000",
      body: "hello",
      messageSid: "SM123",
    });
  });

  it("acks valid webhooks and dispatches the event asynchronously", async () => {
    const { rawBody, headers } = await bodyAndHeaders();
    const handleEvent = vi.fn<() => Promise<void>>(async () => {});
    const target: TwilioSmsWebhookTarget = {
      accountId: "default",
      account: account(),
      cfg: {} as OpenClawConfig,
      path: "/twilio-sms/webhook",
      runtime: runtime(),
      handleEvent,
    };
    const handler = createTwilioSmsNodeWebhookHandler({
      path: "/twilio-sms/webhook",
      targets: () => [target],
      runtime: target.runtime,
      readBody: async () => rawBody,
    });
    const res = response();

    await handler(request({ headers }), res);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(JSON.stringify({ status: "ok" }));
    expect(handleEvent).toHaveBeenCalledOnce();
  });

  it("rejects invalid signatures before dispatch", async () => {
    const { rawBody, headers } = await bodyAndHeaders({ signature: "bad" });
    const handleEvent = vi.fn<() => Promise<void>>(async () => {});
    const target: TwilioSmsWebhookTarget = {
      accountId: "default",
      account: account(),
      cfg: {} as OpenClawConfig,
      path: "/twilio-sms/webhook",
      runtime: runtime(),
      handleEvent,
    };
    const handler = createTwilioSmsNodeWebhookHandler({
      path: "/twilio-sms/webhook",
      targets: () => [target],
      runtime: target.runtime,
      readBody: async () => rawBody,
    });
    const res = response();

    await handler(request({ headers }), res);

    expect(res.statusCode).toBe(401);
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it("acks replayed webhooks without dispatching twice", async () => {
    const { rawBody, headers } = await bodyAndHeaders();
    const handleEvent = vi.fn<() => Promise<void>>(async () => {});
    const target: TwilioSmsWebhookTarget = {
      accountId: "default",
      account: account(),
      cfg: {} as OpenClawConfig,
      path: "/twilio-sms/webhook",
      runtime: runtime(),
      handleEvent,
    };
    const handler = createTwilioSmsNodeWebhookHandler({
      path: "/twilio-sms/webhook",
      targets: () => [target],
      runtime: target.runtime,
      readBody: async () => rawBody,
    });
    const first = response();
    const second = response();

    await handler(request({ headers }), first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await handler(request({ headers }), second);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.body).toBe(JSON.stringify({ status: "replayed" }));
    expect(handleEvent).toHaveBeenCalledOnce();
  });
});
