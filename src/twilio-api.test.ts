import { describe, expect, it, vi } from "vitest";

const { fetchWithSsrFGuardMock } = vi.hoisted(() => ({
  fetchWithSsrFGuardMock: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/ssrf-runtime", () => ({
  fetchWithSsrFGuard: fetchWithSsrFGuardMock,
}));

import { sendTwilioSmsApiMessage, TwilioSmsApiError } from "./twilio-api.js";

describe("sendTwilioSmsApiMessage", () => {
  it("posts a guarded Twilio Messages API request", async () => {
    const release = vi.fn();
    fetchWithSsrFGuardMock.mockResolvedValue({
      response: new Response(JSON.stringify({ sid: "SM123", status: "queued" }), {
        status: 201,
      }),
      release,
    });

    const result = await sendTwilioSmsApiMessage({
      accountSid: "AC123",
      authToken: "secret",
      to: "+15551230001",
      from: "+15551230000",
      body: "hello",
    });

    const [call] = fetchWithSsrFGuardMock.mock.calls[0] ?? [];
    expect(call.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(call.policy).toEqual({ allowedHostnames: ["api.twilio.com"] });
    expect(call.auditContext).toBe("twilio-sms.api");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers.Authorization).toMatch(/^Basic /);
    expect(String(call.init.body)).toBe("To=%2B15551230001&Body=hello&From=%2B15551230000");
    expect(result.sid).toBe("SM123");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("throws structured Twilio API errors", async () => {
    fetchWithSsrFGuardMock.mockResolvedValue({
      response: new Response(JSON.stringify({ code: 21610, message: "blocked" }), {
        status: 400,
      }),
      release: vi.fn(),
    });

    await expect(
      sendTwilioSmsApiMessage({
        accountSid: "AC123",
        authToken: "secret",
        to: "+15551230001",
        from: "+15551230000",
        body: "hello",
      }),
    ).rejects.toMatchObject({
      name: "TwilioSmsApiError",
      httpStatus: 400,
      twilioCode: 21610,
    } satisfies Partial<TwilioSmsApiError>);
  });
});
