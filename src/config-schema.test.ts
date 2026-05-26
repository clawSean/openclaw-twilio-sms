import { describe, expect, it } from "vitest";
import { TwilioSmsConfigSchema } from "./config-schema.js";

describe("TwilioSmsConfigSchema", () => {
  it("defaults direct-message policy to pairing", () => {
    const parsed = TwilioSmsConfigSchema.parse({});
    expect(parsed.dmPolicy).toBe("pairing");
  });

  it("requires an explicit wildcard when direct messages are open", () => {
    expect(TwilioSmsConfigSchema.safeParse({ dmPolicy: "open" }).success).toBe(false);
    expect(TwilioSmsConfigSchema.safeParse({ dmPolicy: "open", allowFrom: ["*"] }).success).toBe(
      true,
    );
  });

  it("accepts account-scoped Twilio credentials and sender config", () => {
    const result = TwilioSmsConfigSchema.safeParse({
      accounts: {
        production: {
          accountSid: "AC123",
          authToken: "secret",
          fromNumber: "+15551230000",
          allowFrom: ["+15551230001"],
        },
      },
      defaultAccount: "production",
    });
    expect(result.success).toBe(true);
  });
});
