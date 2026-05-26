import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";

type ParsedTwilioApiError = {
  code?: number;
  message?: string;
};

export type TwilioSmsApiMessageResponse = {
  sid?: string;
  status?: string;
  to?: string;
  from?: string;
  date_created?: string;
  error_code?: number | null;
  error_message?: string | null;
};

const TWILIO_API_TIMEOUT_MS = 30_000;
const TWILIO_API_HOSTNAME = "api.twilio.com";

function parseTwilioApiError(text: string): ParsedTwilioApiError {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    return {
      code: typeof record.code === "number" ? record.code : undefined,
      message: typeof record.message === "string" ? record.message : undefined,
    };
  } catch {
    return {};
  }
}

export class TwilioSmsApiError extends Error {
  readonly httpStatus: number;
  readonly responseText: string;
  readonly twilioCode?: number;

  constructor(httpStatus: number, responseText: string) {
    const parsed = parseTwilioApiError(responseText);
    const detail = parsed.message ?? responseText;
    super("Twilio SMS API error: " + httpStatus + " " + detail);
    this.name = "TwilioSmsApiError";
    this.httpStatus = httpStatus;
    this.responseText = responseText;
    this.twilioCode = parsed.code;
  }
}

async function twilioSmsApiRequest<T = unknown>(params: {
  accountSid: string;
  authToken: string;
  endpoint: string;
  body: URLSearchParams | Record<string, string | undefined>;
}): Promise<T> {
  const bodyParams =
    params.body instanceof URLSearchParams
      ? params.body
      : Object.entries(params.body).reduce((acc, [key, value]) => {
          if (typeof value === "string" && value.trim()) {
            acc.append(key, value);
          }
          return acc;
        }, new URLSearchParams());
  const requestUrl =
    "https://" +
    TWILIO_API_HOSTNAME +
    "/2010-04-01/Accounts/" +
    encodeURIComponent(params.accountSid) +
    params.endpoint;
  const { response, release } = await fetchWithSsrFGuard({
    url: requestUrl,
    init: {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(params.accountSid + ":" + params.authToken).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: bodyParams,
    },
    policy: { allowedHostnames: [TWILIO_API_HOSTNAME] },
    timeoutMs: TWILIO_API_TIMEOUT_MS,
    auditContext: "twilio-sms.api",
  });
  try {
    const text = await response.text();
    if (!response.ok) {
      throw new TwilioSmsApiError(response.status, text);
    }
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("Twilio SMS API returned malformed JSON.");
    }
  } finally {
    await release();
  }
}

export async function sendTwilioSmsApiMessage(params: {
  accountSid: string;
  authToken: string;
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
}): Promise<TwilioSmsApiMessageResponse> {
  if (!params.from && !params.messagingServiceSid) {
    throw new Error("Twilio SMS send requires fromNumber or messagingServiceSid.");
  }
  return await twilioSmsApiRequest<TwilioSmsApiMessageResponse>({
    accountSid: params.accountSid,
    authToken: params.authToken,
    endpoint: "/Messages.json",
    body: {
      To: params.to,
      Body: params.body,
      From: params.from,
      MessagingServiceSid: params.messagingServiceSid,
    },
  });
}
