import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listTwilioSmsAccountIds,
  resolveDefaultTwilioSmsAccountId,
  resolveTwilioSmsAccount,
} from "./accounts.js";

describe("Twilio SMS account resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves the default account from environment variables", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACENV");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "env-token");
    vi.stubEnv("TWILIO_SMS_FROM", "+15551230000");

    const account = resolveTwilioSmsAccount({ cfg: {} });

    expect(account.accountId).toBe("default");
    expect(account.configured).toBe(true);
    expect(account.accountSid).toBe("ACENV");
    expect(account.fromNumber).toBe("+15551230000");
    expect(account.credentialSource).toBe("env");
  });

  it("resolves named accounts from channel config", () => {
    const cfg = {
      channels: {
        "twilio-sms": {
          defaultAccount: "prod",
          accounts: {
            prod: {
              accountSid: "AC123",
              authToken: "token",
              fromNumber: "twilio:+1 (555) 123-0000",
              defaultTo: "+15551230001",
            },
          },
        },
      },
    };

    expect(resolveDefaultTwilioSmsAccountId(cfg)).toBe("prod");
    expect(listTwilioSmsAccountIds(cfg)).toEqual(["default", "prod"]);

    const account = resolveTwilioSmsAccount({ cfg, accountId: "prod" });
    expect(account.configured).toBe(true);
    expect(account.fromNumber).toBe("+15551230000");
    expect(account.defaultTo).toBe("+15551230001");
  });

  it("lists and resolves multiple configured accounts", () => {
    const cfg = {
      channels: {
        "twilio-sms": {
          accountSid: "ACBASE",
          authToken: "base-token",
          fromNumber: "+15551230000",
          defaultAccount: "ops",
          accounts: {
            ops: {
              accountSid: "ACOPS",
              authToken: "ops-token",
              messagingServiceSid: "MGOPS",
            },
            alerts: {
              accountSid: "ACALERTS",
              authToken: "alerts-token",
              fromNumber: "+15551230002",
            },
          },
        },
      },
    };

    expect(listTwilioSmsAccountIds(cfg)).toEqual(["default", "ops", "alerts"]);
    expect(resolveTwilioSmsAccount({ cfg }).accountId).toBe("ops");
    expect(resolveTwilioSmsAccount({ cfg }).messagingServiceSid).toBe("MGOPS");
    expect(resolveTwilioSmsAccount({ cfg, accountId: "alerts" }).fromNumber).toBe(
      "+15551230002",
    );
  });
});
