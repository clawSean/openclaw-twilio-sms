import { describe, expect, it, vi } from "vitest";
import { sendTwilioSmsMessage } from "./send.js";

describe("sendTwilioSmsMessage", () => {
  it("sends through the Twilio Messages API and returns a durable receipt", async () => {
    const sendApi = vi.fn(async () => ({
      sid: "SM123",
      status: "queued",
      to: "+15551230001",
      from: "+15551230000",
    }));
    const cfg = {
      channels: {
        "twilio-sms": {
          accountSid: "AC123",
          authToken: "secret",
          fromNumber: "+15551230000",
        },
      },
    };

    const result = await sendTwilioSmsMessage("twilio:+15551230001", "hello", {
      cfg,
      sendApi,
    });

    expect(sendApi).toHaveBeenCalledWith({
      accountSid: "AC123",
      authToken: "secret",
      to: "+15551230001",
      body: "hello",
      from: "+15551230000",
      messagingServiceSid: undefined,
    });
    expect(result.messageId).toBe("SM123");
    expect(result.receipt.primaryPlatformMessageId).toBe("SM123");
    expect(result.receipt.parts[0]?.kind).toBe("text");
  });

  it("requires configured credentials and sender identity", async () => {
    await expect(
      sendTwilioSmsMessage("+15551230001", "hello", {
        cfg: {
          channels: {
            "twilio-sms": {
              accountSid: "AC123",
              authToken: "secret",
            },
          },
        },
        sendApi: vi.fn(),
      }),
    ).rejects.toThrow(/not configured/i);
  });
});
