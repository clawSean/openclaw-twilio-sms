import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { twilioSmsPlugin } from "./channel.js";

describe("twilioSmsPlugin security", () => {
  it("resolves direct-message policy and normalizes phone allowlist entries", () => {
    const resolveDmPolicy = twilioSmsPlugin.security?.resolveDmPolicy;
    if (!resolveDmPolicy) {
      throw new Error("resolveDmPolicy unavailable");
    }
    const cfg = {
      channels: {
        "twilio-sms": {
          accountSid: "AC123",
          authToken: "token",
          fromNumber: "+15551230000",
          dmPolicy: "allowlist",
          allowFrom: ["  twilio:+1 (555) 123-0001  "],
        },
      },
    } as OpenClawConfig;

    const result = resolveDmPolicy({
      cfg,
      account: twilioSmsPlugin.config.resolveAccount(cfg, "default"),
    });

    expect(result?.policy).toBe("allowlist");
    expect(result?.allowFrom).toEqual(["  twilio:+1 (555) 123-0001  "]);
    expect(result?.policyPath).toBe("channels.twilio-sms.dmPolicy");
    expect(result?.normalizeEntry?.("  twilio:+1 (555) 123-0001  ")).toBe("+15551230001");
  });
});
