import { describe, expect, it, vi } from "vitest";
import { sendFormattedTwilioSmsText, toTwilioSmsPlainText } from "./outbound.js";
import { createTwilioSmsSendReceipt } from "./receipt.js";

describe("Twilio SMS outbound formatting", () => {
  it("strips Markdown for plain SMS delivery", () => {
    expect(toTwilioSmsPlainText("**Hello** [OpenClaw](https://openclaw.ai)")).toBe(
      "Hello OpenClaw (https://openclaw.ai)",
    );
  });

  it("chunks formatted text and sends through the channel dependency", async () => {
    let index = 0;
    const send = vi.fn(async (to: string, text: string) => {
      index += 1;
      const messageId = "SM" + index;
      return {
        messageId,
        chatId: to,
        toJid: to,
        receipt: createTwilioSmsSendReceipt({ messageId, to, kind: "text" }),
      };
    });
    const cfg = {
      channels: {
        "twilio-sms": {
          accountSid: "AC123",
          authToken: "secret",
          fromNumber: "+15551230000",
          textChunkLimit: 8,
        },
      },
    };

    const results = await sendFormattedTwilioSmsText({
      cfg,
      to: "twilio:+15551230001",
      text: "**hello** there friend",
      deps: { "twilio-sms": send },
    });

    expect(results.map((result) => result.messageId)).toEqual(["SM1", "SM2", "SM3"]);
    expect(send.mock.calls.map((call) => call[1])).toEqual(["hello", "there", "friend"]);
  });
});
